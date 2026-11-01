-- REVENIRE 20261124a_ofertare_poarta_cheltuiala (armată; doar la cererea lui Răzvan). ÎNTÂI se redeployează cele 11 edge-uri ofertare-*, UI-ul
-- (Vercel) și workerul NAS pe versiunea dinaintea PR-ului (altfel: edge-urile cheamă o funcție care nu mai există = poarta refuză tot, iar UI-ul
-- vechi scrie direct în cozi), apoi: funcțiile EXACT ca înainte (plansa_coada_inscrie, j02b, trigger-ul de numire, tick-ul extragerii),
-- RPC-urile cozilor scoase, politicile + privilegiile de scriere ale cozilor refăcute ca în 20260928p, funcția porții și coloanele de dovadă
-- (2A) scoase dacă sunt goale; dacă au dovezi, se conservă redenumite (r3).
-- ORDINEA REVENIRII (r3, review r2 Copilot P1-03): consumatorii opriți (workerul NAS + joburile pg_cron, scripts/ofertare_908_consumatori.sql
-- „suspenda”) → edge-urile + UI pe versiunea anterioară, FĂRĂ a reporni workerul → acest fișier → workerul vechi și cron-urile repornite DOAR
-- cu acordul explicit al lui Răzvan: revenirea readuce politica veche, mai permisivă, de cheltuială (efect de securitate acceptat explicit).
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261124a', true) IS DISTINCT FROM 'POARTA_CHELTUIALA_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261124a revenire: neinarmata';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261124a revenire: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
END $pre$;

CREATE OR REPLACE FUNCTION public.ofertare_plansa_coada_inscrie(p_doc_id bigint, p_mod text DEFAULT 'citeste'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_doc   record;
  v_resp  uuid;
  v_owner boolean := false;
  v_sha   text;
  v_id    bigint;
  v_mod_existent text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'neautentificat'; END IF;
  IF p_mod NOT IN ('citeste', 'continua', 'reia_erori') THEN RAISE EXCEPTION 'mod invalid'; END IF;
  SELECT d.id, d.licitatie_id, d.fisier_path, d.analiza, d.tip INTO v_doc
    FROM ofertare_documente_atribuire d WHERE d.id = p_doc_id;
  SELECT l.responsabil_id INTO v_resp FROM ofertare_licitatii l WHERE l.id = v_doc.licitatie_id;
  SELECT COALESCE(p.is_owner, false) INTO v_owner FROM profiles p WHERE p.id = v_uid;
  IF v_doc.id IS NULL OR NOT (COALESCE(v_owner, false) OR (v_resp IS NOT NULL AND v_resp = v_uid)) THEN
    RAISE EXCEPTION 'Fără drept pe acest document — citirea planșei costă și o pornește doar ownerul sau responsabilul licitației.';
  END IF;
  IF v_doc.tip IS DISTINCT FROM 'plansa' THEN
    RETURN jsonb_build_object('eroare', 'documentul nu e planșă (tip ≠ plansa) — coada citește doar planșe');
  END IF;
  IF v_doc.analiza -> 'plansa' ->> 'cale_felii' IS NULL THEN
    RETURN jsonb_build_object('eroare', 'planșa nu e tăiată în felii — rulează întâi /api/plansa-felii');
  END IF;
  IF (v_doc.analiza -> 'plansa' ->> 'citibila') = 'false' THEN
    RETURN jsonb_build_object('eroare', 'planșa e marcată necitibilă');
  END IF;
  SELECT m.sha256 INTO v_sha FROM ofertare_seap_manifest m
   WHERE m.document_id = p_doc_id AND m.sha256 IS NOT NULL ORDER BY m.verificat_la DESC NULLS LAST LIMIT 1;

  INSERT INTO ofertare_plansa_coada (doc_id, licitatie_id, mod, taiat_la, cale_felii, fisier_path, doc_sha256, cerut_de)
  VALUES (p_doc_id, v_doc.licitatie_id, p_mod, v_doc.analiza -> 'plansa' ->> 'taiat_la',
          v_doc.analiza -> 'plansa' ->> 'cale_felii', v_doc.fisier_path, v_sha, v_uid)
  ON CONFLICT (doc_id, (COALESCE(taiat_la, ''))) WHERE stare IN ('asteapta', 'lucru') DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT q.id, q.mod INTO v_id, v_mod_existent FROM ofertare_plansa_coada q
     WHERE q.doc_id = p_doc_id AND COALESCE(q.taiat_la, '') = COALESCE(v_doc.analiza -> 'plansa' ->> 'taiat_la', '')
       AND q.stare IN ('asteapta', 'lucru');
    RETURN jsonb_build_object('id', v_id, 'existent', true, 'mod', v_mod_existent);
  END IF;
  RETURN jsonb_build_object('id', v_id, 'existent', false, 'mod', p_mod);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_j02b_activeaza(p_licitatie_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_owner boolean; l record; v_n int; v_rol text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'J02b: pornirea cere un utilizator autentificat' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(public.fn_are_acces_ofertare(), false) THEN
    RAISE EXCEPTION 'J02b: fără acces la Ofertare' USING ERRCODE = '42501';
  END IF;
  SELECT id, responsabil_id, responsabil_setat_de, j02b_activ INTO l FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'J02b: licitația % nu există', p_licitatie_id USING ERRCODE = 'P0002'; END IF;
  v_owner := COALESCE((SELECT is_owner FROM public.profiles WHERE id = v_uid), false);
  IF v_owner THEN v_rol := 'owner';
  ELSIF l.responsabil_id IS NOT DISTINCT FROM v_uid AND l.responsabil_setat_de IS DISTINCT FROM v_uid THEN v_rol := 'responsabil';
  ELSE
    RAISE EXCEPTION 'J02b: doar ownerul sau responsabilul licitației % (numit de altcineva, nu autoatribuit) poate porni J02b', p_licitatie_id USING ERRCODE = '42501';
  END IF;
  IF l.j02b_activ THEN
    RAISE EXCEPTION 'J02b: e deja pornit pe licitația % (comutatorul merge într-un singur sens)', p_licitatie_id USING ERRCODE = 'P0001';
  END IF;
  v_n := public.fn_ofertare_j02b_impact(p_licitatie_id);
  INSERT INTO public.ofertare_j02b_activari (licitatie_id, actor, rol_actor, n_redeschise, txid) VALUES (p_licitatie_id, v_uid, v_rol, v_n, txid_current());
  UPDATE public.ofertare_licitatii SET j02b_activ = true WHERE id = p_licitatie_id;
  RETURN v_n;
END $function$;

-- trigger-ul de numire, exact ca în 20261121a (fără dovadă, SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.fn_ofertare_responsabil_setat_de()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.responsabil_setat_de := CASE WHEN NEW.responsabil_id IS NULL THEN NULL ELSE auth.uid() END;
  ELSIF NEW.responsabil_id IS DISTINCT FROM OLD.responsabil_id THEN
    NEW.responsabil_setat_de := auth.uid();
  ELSE
    NEW.responsabil_setat_de := OLD.responsabil_setat_de;
  END IF;
  -- 20261121a: responsabilul 2 (opțional), aceeași regulă — reține cine l-a numit, clientul nu poate scrie coloana
  IF TG_OP = 'INSERT' THEN
    NEW.responsabil2_setat_de := CASE WHEN NEW.responsabil2_id IS NULL THEN NULL ELSE auth.uid() END;
  ELSIF NEW.responsabil2_id IS DISTINCT FROM OLD.responsabil2_id THEN
    NEW.responsabil2_setat_de := auth.uid();
  ELSE
    NEW.responsabil2_setat_de := OLD.responsabil2_setat_de;
  END IF;
  RETURN NEW;
END $function$
;

-- tick-ul extragerii, exact ca înainte (cheia anon, fără x-intern-secret)
CREATE OR REPLACE FUNCTION public.ofertare_extragere_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  jwt text; c record; resp record; corp jsonb; pas jsonb; rid bigint; corp_body jsonb;
  n_pasi int; continua boolean; cer int;
  LEASE constant interval := interval '4 minutes';
  MAX_INCERCARI constant int := 3;
BEGIN
  -- 22.09.2026: workerul de pe NAS (worker/ofertare) consuma aceeasi coada fara limita de 150 s;
  -- cat timp da semn de viata (sub 10 min), tick-ul nu lanseaza nimic. Daca workerul cade, tick-ul reia singur.
  IF EXISTS (SELECT 1 FROM public.worker_heartbeat WHERE nume = 'ofertare-worker' AND ultimul > now() - interval '10 minutes') THEN RETURN; END IF;
  SELECT decrypted_secret INTO jwt FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_JWT' LIMIT 1;
  IF jwt IS NULL THEN RETURN; END IF;

  FOR c IN SELECT * FROM ofertare_extragere_coada WHERE activ ORDER BY cerut_la LOOP
    n_pasi := jsonb_array_length(coalesce(c.pasi, '[]'::jsonb));

    -- (1) exista un apel in zbor?
    IF c.req_id IS NOT NULL THEN
      SELECT * INTO resp FROM net._http_response WHERE id = c.req_id;
      IF NOT FOUND THEN
        -- inca ruleaza; dupa lease se reia ACEEASI bucata, nu se sare peste ea
        IF c.lansat_la < now() - LEASE THEN
          IF c.incercari + 1 >= MAX_INCERCARI THEN
            UPDATE ofertare_extragere_coada SET req_id = NULL, incercari = 0, erori = erori + 1,
              poz = poz + 1, bucata = 0,
              jurnal = jurnal || jsonb_build_object('poz', c.poz, 'eroare', 'fara raspuns dupa ' || MAX_INCERCARI || ' incercari', 'la', now())
             WHERE licitatie_id = c.licitatie_id;
          ELSE
            UPDATE ofertare_extragere_coada SET req_id = NULL, incercari = incercari + 1
             WHERE licitatie_id = c.licitatie_id;
          END IF;
        END IF;
        CONTINUE;                       -- se asteapta raspunsul
      END IF;

      corp := NULL;
      BEGIN corp := resp.content::jsonb; EXCEPTION WHEN others THEN corp := NULL; END;
      IF resp.status_code = 200 AND coalesce((corp->>'ok')::boolean, false) THEN
        cer := coalesce((corp->>'cerinte')::int, 0);
        continua := coalesce((corp->>'continua')::boolean, false);
        UPDATE ofertare_extragere_coada SET
          req_id = NULL, incercari = 0, cerinte_noi = cerinte_noi + cer,
          bucata = CASE WHEN continua THEN coalesce((corp->>'bucata_urmatoare')::int, c.bucata + 1) ELSE 0 END,
          poz = CASE WHEN continua THEN poz ELSE poz + 1 END,
          jurnal = jurnal || jsonb_build_object('poz', c.poz, 'bucata', c.bucata, 'cerinte', cer,
                                                'bucati', corp->>'bucati', 'la', now())
         WHERE licitatie_id = c.licitatie_id;
      ELSE
        IF c.incercari + 1 >= MAX_INCERCARI THEN
          UPDATE ofertare_extragere_coada SET req_id = NULL, incercari = 0, erori = erori + 1,
            poz = poz + 1, bucata = 0,
            jurnal = jurnal || jsonb_build_object('poz', c.poz, 'bucata', c.bucata,
                       'eroare', left(coalesce(corp->>'error', 'HTTP ' || coalesce(resp.status_code::text,'?')), 200), 'la', now())
           WHERE licitatie_id = c.licitatie_id;
        ELSE
          UPDATE ofertare_extragere_coada SET req_id = NULL, incercari = incercari + 1
           WHERE licitatie_id = c.licitatie_id;
        END IF;
      END IF;
      SELECT * INTO c FROM ofertare_extragere_coada WHERE licitatie_id = c.licitatie_id;
      n_pasi := jsonb_array_length(coalesce(c.pasi, '[]'::jsonb));
    END IF;

    -- (2) s-au terminat pasii?
    IF c.poz >= n_pasi THEN
      UPDATE ofertare_extragere_coada SET activ = false, terminat_la = now(),
        nota = format('%s pași, %s cerințe noi, %s pași cu eroare', n_pasi, c.cerinte_noi, c.erori)
       WHERE licitatie_id = c.licitatie_id;
      IF c.cerut_de IS NOT NULL THEN
        INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
        SELECT c.cerut_de, 'info', 'Ofertare',
          'Ofertare: extragerea cerințelor s-a terminat la ' || coalesce(li.nr_anunt, '#' || li.id),
          format('%s pași, %s cerințe noi, %s pași cu eroare. Confirmă registrul și rulează „Propune acoperire".',
                 n_pasi, c.cerinte_noi, c.erori), '/ofertare'
        FROM ofertare_licitatii li WHERE li.id = c.licitatie_id;
      END IF;
      CONTINUE;
    END IF;

    -- (3) se lanseaza pasul curent
    pas := c.pasi -> c.poz;
    corp_body := jsonb_build_object('licitatie_id', c.licitatie_id, 'bucata', c.bucata,
                                    'bucata_max', c.bucata_max, 'model', c.model);
    IF pas ? 'doc_id' THEN
      corp_body := corp_body || jsonb_build_object('doc_id', (pas->>'doc_id')::bigint);
    ELSE
      corp_body := corp_body || jsonb_build_object('sectiune', pas->>'sectiune');
      -- reset doar la prima bucata a pasului, altfel s-ar sterge ce tocmai s-a extras
      IF coalesce((pas->>'reset')::boolean, false) AND c.bucata = 0 THEN
        corp_body := corp_body || jsonb_build_object('reset', true);
      END IF;
    END IF;

    rid := net.http_post(
      url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/ofertare-cerinte',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || jwt),
      body := corp_body, timeout_milliseconds := 150000);
    UPDATE ofertare_extragere_coada SET req_id = rid, lansat_la = now(), ultimul_tick = now()
     WHERE licitatie_id = c.licitatie_id;
  END LOOP;
END $function$
;

DROP FUNCTION public.ofertare_coada_porneste(text, bigint);
DROP FUNCTION public.ofertare_coada_opreste(text, bigint);

-- politicile + privilegiile de scriere ale cozilor, ca în 20260928p
CREATE POLICY ofertare_acoperire_coada_all_ins ON public.ofertare_acoperire_coada FOR INSERT TO authenticated WITH CHECK (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_acoperire_coada_all_upd ON public.ofertare_acoperire_coada FOR UPDATE TO authenticated USING (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)) WITH CHECK (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_acoperire_coada_all_del ON public.ofertare_acoperire_coada FOR DELETE TO authenticated USING (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_clarificari_coada_all_ins ON public.ofertare_clarificari_coada FOR INSERT TO authenticated WITH CHECK (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_clarificari_coada_all_upd ON public.ofertare_clarificari_coada FOR UPDATE TO authenticated USING (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)) WITH CHECK (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_clarificari_coada_all_del ON public.ofertare_clarificari_coada FOR DELETE TO authenticated USING (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_extragere_coada_all_ins ON public.ofertare_extragere_coada FOR INSERT TO authenticated WITH CHECK (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_extragere_coada_all_upd ON public.ofertare_extragere_coada FOR UPDATE TO authenticated USING (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)) WITH CHECK (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_extragere_coada_all_del ON public.ofertare_extragere_coada FOR DELETE TO authenticated USING (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_ingest_coada_all_ins ON public.ofertare_ingest_coada FOR INSERT TO authenticated WITH CHECK (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_ingest_coada_all_upd ON public.ofertare_ingest_coada FOR UPDATE TO authenticated USING (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)) WITH CHECK (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
CREATE POLICY ofertare_ingest_coada_all_del ON public.ofertare_ingest_coada FOR DELETE TO authenticated USING (( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare));
GRANT INSERT, SELECT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON public.ofertare_acoperire_coada, public.ofertare_clarificari_coada, public.ofertare_extragere_coada, public.ofertare_ingest_coada TO anon, authenticated;

DROP FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid);

-- r3 (review r2: Jakarinos P1-05 / Copilot P2-04): dovezile numirilor făcute după livrare NU se distrug. Sub lock: fără dovezi → coloanele
-- se scot; cu dovezi → se CONSERVĂ, redenumite *_arhiva_20261124a (codul vechi nu le citește, trigger-ul vechi nu le atinge). O reaplicare
-- ulterioară a porții cere atunci o migrare nouă care preia arhiva (garda „numit de completat” din 20261124a o oprește oricum).
DO $dovezi$
BEGIN
  LOCK TABLE public.ofertare_licitatii IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE responsabil_numitor_autorizat IS NOT NULL OR responsabil2_numitor_autorizat IS NOT NULL) THEN
    ALTER TABLE public.ofertare_licitatii RENAME COLUMN responsabil_numitor_autorizat TO responsabil_numitor_autorizat_arhiva_20261124a;
    ALTER TABLE public.ofertare_licitatii RENAME COLUMN responsabil2_numitor_autorizat TO responsabil2_numitor_autorizat_arhiva_20261124a;
    RAISE NOTICE '20261124a revenire: dovezile de numire CONSERVATE in *_arhiva_20261124a';
  ELSE
    ALTER TABLE public.ofertare_licitatii DROP COLUMN responsabil_numitor_autorizat, DROP COLUMN responsabil2_numitor_autorizat;
  END IF;
END $dovezi$;
