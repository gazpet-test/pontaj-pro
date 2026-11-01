-- 20261124a_ofertare_poarta_cheltuiala — Ofertare faza 2 (decizia Răzvan 01.11.2026: varianta 1, cu A; runda 2: 1A 2A 3A 4A).
-- O SINGURĂ poartă pe cheltuială AI: fn_ofertare_poate_cheltui(licitație, utilizator) = true dacă utilizatorul e owner, SAU e responsabilul 1 / 2
-- al licitației și numirea lui poartă dovada că cel care l-a numit era owner / admin Ofertare ATUNCI și altcineva decât el (închide
-- autoatribuirea). A = numirile vechi, fără „numit de” și fără dovadă (toate cele 88 de licitații la 01.11), își păstrează dreptul.
-- 2A (runda 2): dovada stă în responsabil_numitor_autorizat / responsabil2_numitor_autorizat, scrise DOAR de trigger-ul
-- fn_ofertare_responsabil_setat_de la numire (clientul nu le poate scrie; o promovare / retrogradare ulterioară a numitorului nu schimbă
-- nimic). O numire nouă făcută fără utilizator (sesiune SQL, service_role) primește false = fără drept, până o refac ownerul / un admin din UI.
-- 3A (runda 2): cozile AI ale Ofertării (ingest, acoperire, clarificări, extragere) nu se mai scriu direct prin API: înscrierea / reactivarea
-- doar prin ofertare_coada_porneste (auth.uid() + poarta; cerut_de = auth.uid()), oprirea prin ofertare_coada_opreste; INSERT / UPDATE /
-- DELETE revocate, politicile de scriere scoase. Tick-ul pg_cron al extragerii trimite x-intern-secret (Vault INTERN_EDGE_SECRET, existent)
-- pe lângă cheia anon (care nu mai e acceptată singură de ofertare-cerinte) și nu lansează nimic pentru un cerut_de care nu trece poarta.
-- Folosită de: cele 11 edge-uri ofertare-* cu poartă pe cheltuială (service_role) + ofertare_plansa_coada_inscrie + fn_ofertare_j02b_activeaza
-- + ofertare_coada_porneste + ofertare_extragere_tick + workerul NAS (rescrise aici din definiția EXACTĂ din bază, garda md5).
-- NU atinge: fn_ofertare_source_pack_poate_decide (decizie, nu cheltuială), notificările, ofertare_ingest_tick (calea lui anon e deja
-- refuzată de ofertare-ingest-doc v13; workerul NAS e consumatorul real).
-- Revenire: supabase/revenire/20261124a_ofertare_poarta_cheltuiala_ROLLBACK.sql (armată). ÎNTÂI se redeployează edge-urile + UI-ul + workerul
-- pe versiunea anterioară.
-- ORDINEA LA LIVRARE (r3, PR #908 „Plan de livrare”): (1) consumatorii opriți — workerul NAS + joburile pg_cron
-- (scripts/ofertare_908_consumatori.sql „suspenda”), fără apeluri în zbor; (2) edge-urile NOI deployate ÎNAINTEA migrării: până la ea,
-- poarta lor nu găsește funcția și refuză tot (fail-closed) = suspendarea tehnică, verificabilă, a intrărilor plătite din edge; (3) această
-- migrare (garda: nicio cerere activă în cozi); (4) merge → UI; (5) workerul NAS pe codul nou + „reia”; (6) proba LIVE.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261124a_ofertare_poarta_cheltuiala:' || txid_current() THEN
    RAISE EXCEPTION '20261124a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261124a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_poate_cheltui(bigint,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '20261124a: fn_ofertare_poate_cheltui exista deja';
  END IF;
  IF md5(pg_get_functiondef('public.ofertare_plansa_coada_inscrie(bigint,text)'::regprocedure)) IS DISTINCT FROM '9b63bf01fd2bfea65c742a555cccd57e' THEN
    RAISE EXCEPTION '20261124a: ofertare_plansa_coada_inscrie nu e versiunea asteptata';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ofertare_j02b_activeaza(bigint)'::regprocedure)) IS DISTINCT FROM 'f7fbe3e03664b64b11adea38a71307c2' THEN
    RAISE EXCEPTION '20261124a: fn_ofertare_j02b_activeaza nu e versiunea asteptata';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ofertare_responsabil_setat_de()'::regprocedure)) IS DISTINCT FROM '1f37e1b3dfadaa85d6a52fb6f7fdb2d9' THEN
    RAISE EXCEPTION '20261124a: fn_ofertare_responsabil_setat_de nu e versiunea asteptata (garda: cine a numit)';
  END IF;
  IF md5(pg_get_functiondef('public.ofertare_extragere_tick()'::regprocedure)) IS DISTINCT FROM 'b70bf0b901d83f0c4345c209b8d2bf57' THEN
    RAISE EXCEPTION '20261124a: ofertare_extragere_tick nu e versiunea asteptata';
  END IF;
  -- 2A: dovada se poate fixa doar la numirile făcute de acum înainte; o numire cu „numit de” dar fără dovadă ar rămâne fără drept
  -- (nici A, nici dovadă) → oprește aplicarea, se tratează explicit cu Răzvan (la 01.11: 0 rânduri). Sub lock (r3, review r2): nicio
  -- numire nouă între verificare și ALTER TABLE.
  LOCK TABLE public.ofertare_licitatii IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE responsabil_setat_de IS NOT NULL OR responsabil2_setat_de IS NOT NULL) THEN
    RAISE EXCEPTION '20261124a: exista numiri cu numit_de completat dinaintea dovezii (2A) — decizie explicita inainte de aplicare';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_licitatii'
               AND column_name IN ('responsabil_numitor_autorizat', 'responsabil2_numitor_autorizat')) THEN
    RAISE EXCEPTION '20261124a: coloanele de dovada exista deja';
  END IF;
  -- 3A: politicile de scriere directă din 20260928p, exact cele 12 așteptate
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('ofertare_acoperire_coada', 'ofertare_clarificari_coada', 'ofertare_extragere_coada', 'ofertare_ingest_coada')
        AND policyname ~ '_all_(ins|upd|del)$') <> 12 THEN
    RAISE EXCEPTION '20261124a: politicile de scriere ale cozilor nu sunt cele 12 asteptate';
  END IF;
  -- r3 (review r2: Jakarinos P1-01 / Copilot P1-01): un rând ACTIV scris direct înainte de migrare poate purta un cerut_de falsificat
  -- (ex. UUID-ul ownerului, pus de un editor). Migrarea nu-l poate autentifica retroactiv → nu se aplică deloc cât există cereri active
  -- (consumatorii se opresc și cozile se golesc ÎNAINTE — vezi „Plan de livrare” din PR). Sub lock: nimeni nu mai scrie în cozi până la
  -- sfârșitul tranzacției; după ea, singura cale de (re)activare e ofertare_coada_porneste (cerut_de = auth.uid()). Rândurile inactive
  -- nu se consumă, iar reactivarea lor rescrie cerut_de.
  LOCK TABLE public.ofertare_acoperire_coada, public.ofertare_clarificari_coada, public.ofertare_extragere_coada, public.ofertare_ingest_coada
    IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.ofertare_acoperire_coada WHERE activ) OR EXISTS (SELECT 1 FROM public.ofertare_clarificari_coada WHERE activ)
     OR EXISTS (SELECT 1 FROM public.ofertare_extragere_coada WHERE activ) OR EXISTS (SELECT 1 FROM public.ofertare_ingest_coada WHERE activ) THEN
    RAISE EXCEPTION '20261124a: exista cereri ACTIVE in cozile AI (proveniența cerut_de nedovedita) — opreste consumatorii, inchide cererile, apoi aplica';
  END IF;
  IF to_regprocedure('public.ofertare_coada_porneste(text,bigint)') IS NOT NULL OR to_regprocedure('public.ofertare_coada_opreste(text,bigint)') IS NOT NULL THEN
    RAISE EXCEPTION '20261124a: RPC-urile cozilor exista deja';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'INTERN_EDGE_SECRET') THEN
    RAISE EXCEPTION '20261124a: lipseste INTERN_EDGE_SECRET din Vault (tick-ul extragerii)';
  END IF;
END $pre$;

-- 2A: dovada autorității numitorului, fixată la numire (NULL = numire veche, fără dovadă → regula A)
ALTER TABLE public.ofertare_licitatii
  ADD COLUMN responsabil_numitor_autorizat boolean,
  ADD COLUMN responsabil2_numitor_autorizat boolean;
COMMENT ON COLUMN public.ofertare_licitatii.responsabil_numitor_autorizat IS
  '20261124a (2A): la numirea responsabilului 1, cel care a numit era owner / admin Ofertare și altcineva decât responsabilul. Scris DOAR de trigger-ul fn_ofertare_responsabil_setat_de; NULL = numire veche (regula A).';
COMMENT ON COLUMN public.ofertare_licitatii.responsabil2_numitor_autorizat IS
  '20261124a (2A): ca responsabil_numitor_autorizat, pentru responsabilul 2.';

-- Trigger-ul de numire: același „cine a numit” ca în 20261121a + dovada autorității lui în acel moment. SECURITY DEFINER ca să citească
-- profiles / user_module_access indiferent de RLS-ul apelantului (o funcție de trigger nu se poate chema direct).
CREATE OR REPLACE FUNCTION public.fn_ofertare_responsabil_setat_de()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  -- 20261124a (2A): numitorul e owner / admin Ofertare ACUM, la numire; fără utilizator (sesiune SQL, service_role) = false
  v_aut boolean := v_uid IS NOT NULL AND (
    COALESCE((SELECT pr.is_owner FROM public.profiles pr WHERE pr.id = v_uid), false)
    OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = v_uid AND u.module = 'ofertare' AND u.access_level = 'admin'));
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.responsabil_setat_de := CASE WHEN NEW.responsabil_id IS NULL THEN NULL ELSE v_uid END;
    NEW.responsabil_numitor_autorizat := CASE WHEN NEW.responsabil_id IS NULL THEN NULL ELSE (v_aut AND v_uid IS DISTINCT FROM NEW.responsabil_id) END;
  ELSIF NEW.responsabil_id IS DISTINCT FROM OLD.responsabil_id THEN
    NEW.responsabil_setat_de := v_uid;
    NEW.responsabil_numitor_autorizat := CASE WHEN NEW.responsabil_id IS NULL THEN NULL ELSE (v_aut AND v_uid IS DISTINCT FROM NEW.responsabil_id) END;
  ELSE
    NEW.responsabil_setat_de := OLD.responsabil_setat_de;
    NEW.responsabil_numitor_autorizat := OLD.responsabil_numitor_autorizat;
  END IF;
  -- 20261121a: responsabilul 2 (opțional), aceeași regulă — reține cine l-a numit, clientul nu poate scrie coloana
  IF TG_OP = 'INSERT' THEN
    NEW.responsabil2_setat_de := CASE WHEN NEW.responsabil2_id IS NULL THEN NULL ELSE v_uid END;
    NEW.responsabil2_numitor_autorizat := CASE WHEN NEW.responsabil2_id IS NULL THEN NULL ELSE (v_aut AND v_uid IS DISTINCT FROM NEW.responsabil2_id) END;
  ELSIF NEW.responsabil2_id IS DISTINCT FROM OLD.responsabil2_id THEN
    NEW.responsabil2_setat_de := v_uid;
    NEW.responsabil2_numitor_autorizat := CASE WHEN NEW.responsabil2_id IS NULL THEN NULL ELSE (v_aut AND v_uid IS DISTINCT FROM NEW.responsabil2_id) END;
  ELSE
    NEW.responsabil2_setat_de := OLD.responsabil2_setat_de;
    NEW.responsabil2_numitor_autorizat := OLD.responsabil2_numitor_autorizat;
  END IF;
  RETURN NEW;
END $function$;

CREATE FUNCTION public.fn_ofertare_poate_cheltui(p_licitatie_id bigint, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_uid IS NOT NULL AND p_licitatie_id IS NOT NULL AND (
    COALESCE((SELECT pr.is_owner FROM public.profiles pr WHERE pr.id = p_uid), false)
    OR EXISTS (
      SELECT 1
        FROM public.ofertare_licitatii l
        CROSS JOIN LATERAL (VALUES (l.responsabil_id, l.responsabil_setat_de, l.responsabil_numitor_autorizat),
                                   (l.responsabil2_id, l.responsabil2_setat_de, l.responsabil2_numitor_autorizat)) AS r(resp, numit_de, dovada)
       WHERE l.id = p_licitatie_id
         AND r.resp = p_uid
         AND (
           -- 2A: dovada fixată de trigger la numire (numitorul era owner / admin Ofertare ATUNCI, altcineva decât responsabilul);
           -- rolul curent al numitorului nu mai contează
           (r.dovada IS TRUE AND r.numit_de IS DISTINCT FROM p_uid)
           -- A (Răzvan 01.11): numirile vechi, fără „numit de” și fără dovadă, își păstrează dreptul
           OR (r.dovada IS NULL AND r.numit_de IS NULL)
         )
    )
  );
$function$;
COMMENT ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) IS
  'Poarta unică pe cheltuială AI în Ofertare (20261124a): owner, sau responsabil 1/2 cu dovada de numire (numitorul era owner / admin Ofertare la numire, nu el însuși — 2A); numirile vechi fără „numit de” și fără dovadă = permise (decizia A, 01.11.2026). Doar service_role + funcțiile SECURITY DEFINER.';
REVOKE ALL ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ofertare_plansa_coada_inscrie(p_doc_id bigint, p_mod text DEFAULT 'citeste'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_doc   record;
  v_sha   text;
  v_id    bigint;
  v_mod_existent text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'neautentificat'; END IF;
  IF p_mod NOT IN ('citeste', 'continua', 'reia_erori') THEN RAISE EXCEPTION 'mod invalid'; END IF;
  SELECT d.id, d.licitatie_id, d.fisier_path, d.analiza, d.tip INTO v_doc
    FROM ofertare_documente_atribuire d WHERE d.id = p_doc_id;
  -- 20261124a: poarta unică pe cheltuială (owner sau un responsabil numit de owner / admin Ofertare, nu autoatribuit)
  IF v_doc.id IS NULL OR NOT public.fn_ofertare_poate_cheltui(v_doc.licitatie_id, v_uid) THEN
    RAISE EXCEPTION 'Fără drept pe acest document — citirea planșei costă și o pornește doar ownerul sau un responsabil al licitației numit de owner / un admin Ofertare.';
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
  -- 20261124a: poarta unică pe cheltuială (responsabil 1 sau 2, numit de owner / admin Ofertare, nu autoatribuit)
  ELSIF public.fn_ofertare_poate_cheltui(p_licitatie_id, v_uid) THEN v_rol := 'responsabil';
  ELSE
    RAISE EXCEPTION 'J02b: doar ownerul sau un responsabil al licitației % numit de owner / un admin Ofertare (nu autoatribuit) poate porni J02b', p_licitatie_id USING ERRCODE = '42501';
  END IF;
  IF l.j02b_activ THEN
    RAISE EXCEPTION 'J02b: e deja pornit pe licitația % (comutatorul merge într-un singur sens)', p_licitatie_id USING ERRCODE = 'P0001';
  END IF;
  v_n := public.fn_ofertare_j02b_impact(p_licitatie_id);
  INSERT INTO public.ofertare_j02b_activari (licitatie_id, actor, rol_actor, n_redeschise, txid) VALUES (p_licitatie_id, v_uid, v_rol, v_n, txid_current());
  UPDATE public.ofertare_licitatii SET j02b_activ = true WHERE id = p_licitatie_id;
  RETURN v_n;
END $function$;

-- ═════ 3A: cozile AI ale Ofertării — înscriere / reactivare doar prin RPC cu poarta, fără scriere directă prin API ═════
-- Înainte (20260928p): oricine cu acces Ofertare făcea upsert direct în coadă (activ = true, cerut_de = orice), iar workerul NAS
-- (service_role) cheltuia fără să mai întrebe. Verificarea din UI (poateCheltuiUI) se ocolea cu un apel PostgREST.
CREATE FUNCTION public.ofertare_coada_porneste(p_coada text, p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Coada Ofertare: pornirea cere un utilizator autentificat' USING ERRCODE = '42501'; END IF;
  IF p_coada IS NULL OR p_coada NOT IN ('ingest', 'acoperire', 'clarificari') THEN
    RAISE EXCEPTION 'Coada Ofertare: coadă necunoscută (%)', p_coada USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(public.fn_are_acces_ofertare(), false) THEN
    RAISE EXCEPTION 'Coada Ofertare: fără acces la Ofertare' USING ERRCODE = '42501';
  END IF;
  -- poarta unică pe cheltuială: cine pornește e cel verificat aici, iar cerut_de = el (nu o valoare trimisă de client)
  IF NOT COALESCE(public.fn_ofertare_poate_cheltui(p_licitatie_id, v_uid), false) THEN
    RAISE EXCEPTION 'Procesarea costă — o pornește doar ownerul sau un responsabil al licitației numit de owner / un admin Ofertare.' USING ERRCODE = '42501';
  END IF;
  -- aceleași câmpuri ca upsert-urile de până acum din UI (OfertareLicitatii.jsx / OfertareClarificari.jsx)
  IF p_coada = 'ingest' THEN
    INSERT INTO public.ofertare_ingest_coada (licitatie_id, activ, cerut_de, cerut_la, terminat_la, nota)
    VALUES (p_licitatie_id, true, v_uid, now(), NULL, NULL)
    ON CONFLICT (licitatie_id) DO UPDATE SET activ = true, cerut_de = EXCLUDED.cerut_de, cerut_la = EXCLUDED.cerut_la, terminat_la = NULL, nota = NULL;
  ELSIF p_coada = 'acoperire' THEN
    INSERT INTO public.ofertare_acoperire_coada (licitatie_id, activ, cerut_de, cerut_la, terminat_la, nota, stare, jurnal)
    VALUES (p_licitatie_id, true, v_uid, now(), NULL, NULL, NULL, '[]'::jsonb)
    ON CONFLICT (licitatie_id) DO UPDATE SET activ = true, cerut_de = EXCLUDED.cerut_de, cerut_la = EXCLUDED.cerut_la, terminat_la = NULL,
      nota = NULL, stare = NULL, jurnal = '[]'::jsonb;
  ELSE
    INSERT INTO public.ofertare_clarificari_coada (licitatie_id, activ, cerut_de, cerut_la, terminat_la, nota, rezultat)
    VALUES (p_licitatie_id, true, v_uid, now(), NULL, NULL, NULL)
    ON CONFLICT (licitatie_id) DO UPDATE SET activ = true, cerut_de = EXCLUDED.cerut_de, cerut_la = EXCLUDED.cerut_la, terminat_la = NULL,
      nota = NULL, rezultat = NULL;
  END IF;
  RETURN jsonb_build_object('ok', true, 'coada', p_coada, 'licitatie_id', p_licitatie_id);
END $function$;
COMMENT ON FUNCTION public.ofertare_coada_porneste(text, bigint) IS
  '20261124a (3A): singura cale de înscriere / reactivare în cozile AI ingest / acoperire / clarificări — auth.uid() + fn_ofertare_poate_cheltui; cerut_de = auth.uid().';
REVOKE ALL ON FUNCTION public.ofertare_coada_porneste(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_coada_porneste(text, bigint) TO authenticated, service_role;

-- Oprirea nu costă: oricine cu acces Ofertare oprește (ca butonul „Oprește” de până acum).
CREATE FUNCTION public.ofertare_coada_opreste(p_coada text, p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.fn_are_acces_ofertare(), false) THEN
    RAISE EXCEPTION 'Coada Ofertare: fără acces la Ofertare' USING ERRCODE = '42501';
  END IF;
  IF p_coada = 'ingest' THEN
    UPDATE public.ofertare_ingest_coada SET activ = false, nota = 'oprită manual' WHERE licitatie_id = p_licitatie_id AND activ;
  ELSIF p_coada = 'acoperire' THEN
    UPDATE public.ofertare_acoperire_coada SET activ = false, nota = 'oprită manual' WHERE licitatie_id = p_licitatie_id AND activ;
  ELSIF p_coada = 'clarificari' THEN
    UPDATE public.ofertare_clarificari_coada SET activ = false, nota = 'oprită manual' WHERE licitatie_id = p_licitatie_id AND activ;
  ELSIF p_coada = 'extragere' THEN
    UPDATE public.ofertare_extragere_coada SET activ = false, nota = 'oprită manual' WHERE licitatie_id = p_licitatie_id AND activ;
  ELSE
    RAISE EXCEPTION 'Coada Ofertare: coadă necunoscută (%)', p_coada USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'oprite', v_n);
END $function$;
COMMENT ON FUNCTION public.ofertare_coada_opreste(text, bigint) IS
  '20261124a (3A): oprirea unei cozi AI Ofertare (nu costă) — doar cu acces Ofertare; scrierea directă în cozi e revocată.';
REVOKE ALL ON FUNCTION public.ofertare_coada_opreste(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_coada_opreste(text, bigint) TO authenticated, service_role;

-- Scrierea directă prin API se închide: politicile de scriere scoase + privilegiile revocate (SELECT rămâne, pentru urmărirea stării).
-- Workerul NAS și tick-urile (service_role / postgres) scriu ca până acum.
DROP POLICY ofertare_acoperire_coada_all_ins ON public.ofertare_acoperire_coada;
DROP POLICY ofertare_acoperire_coada_all_upd ON public.ofertare_acoperire_coada;
DROP POLICY ofertare_acoperire_coada_all_del ON public.ofertare_acoperire_coada;
DROP POLICY ofertare_clarificari_coada_all_ins ON public.ofertare_clarificari_coada;
DROP POLICY ofertare_clarificari_coada_all_upd ON public.ofertare_clarificari_coada;
DROP POLICY ofertare_clarificari_coada_all_del ON public.ofertare_clarificari_coada;
DROP POLICY ofertare_extragere_coada_all_ins ON public.ofertare_extragere_coada;
DROP POLICY ofertare_extragere_coada_all_upd ON public.ofertare_extragere_coada;
DROP POLICY ofertare_extragere_coada_all_del ON public.ofertare_extragere_coada;
DROP POLICY ofertare_ingest_coada_all_ins ON public.ofertare_ingest_coada;
DROP POLICY ofertare_ingest_coada_all_upd ON public.ofertare_ingest_coada;
DROP POLICY ofertare_ingest_coada_all_del ON public.ofertare_ingest_coada;
REVOKE ALL ON public.ofertare_acoperire_coada, public.ofertare_clarificari_coada, public.ofertare_extragere_coada, public.ofertare_ingest_coada FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.ofertare_acoperire_coada, public.ofertare_clarificari_coada, public.ofertare_extragere_coada, public.ofertare_ingest_coada FROM authenticated;

-- Tick-ul pg_cron al extragerii (rezerva workerului NAS): x-intern-secret din Vault (ofertare-cerinte nu mai acceptă cheia anon singură)
-- + poarta pe cerut_de înainte de a lansa un pas nou. Restul corpului = definiția EXACTĂ din bază (garda md5 de sus).
CREATE OR REPLACE FUNCTION public.ofertare_extragere_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  jwt text; secret text; c record; resp record; corp jsonb; pas jsonb; rid bigint; corp_body jsonb;
  n_pasi int; continua boolean; cer int;
  LEASE constant interval := interval '4 minutes';
  MAX_INCERCARI constant int := 3;
BEGIN
  -- 22.09.2026: workerul de pe NAS (worker/ofertare) consuma aceeasi coada fara limita de 150 s;
  -- cat timp da semn de viata (sub 10 min), tick-ul nu lanseaza nimic. Daca workerul cade, tick-ul reia singur.
  IF EXISTS (SELECT 1 FROM public.worker_heartbeat WHERE nume = 'ofertare-worker' AND ultimul > now() - interval '10 minutes') THEN RETURN; END IF;
  SELECT decrypted_secret INTO jwt FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_JWT' LIMIT 1;
  IF jwt IS NULL THEN RETURN; END IF;
  -- 20261124a (3A): cheia anon trece doar gateway-ul (verify_jwt); autentificarea reală e x-intern-secret
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET' LIMIT 1;
  IF secret IS NULL THEN RETURN; END IF;

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

    -- 20261124a (3A): un pas nou costă — doar dacă cine a cerut trece ACUM poarta pe cheltuială; altfel coada se închide, fără apel
    IF NOT COALESCE(public.fn_ofertare_poate_cheltui(c.licitatie_id, c.cerut_de), false) THEN
      UPDATE ofertare_extragere_coada SET activ = false, terminat_la = now(), req_id = NULL,
        nota = '❌ refuzat: cine a cerut extragerea nu trece poarta pe cheltuială (owner / responsabil numit de owner sau de un admin Ofertare)'
       WHERE licitatie_id = c.licitatie_id;
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
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || jwt, 'x-intern-secret', secret),
      body := corp_body, timeout_milliseconds := 150000);
    UPDATE ofertare_extragere_coada SET req_id = rid, lansat_la = now(), ultimul_tick = now()
     WHERE licitatie_id = c.licitatie_id;
  END LOOP;
END $function$;
