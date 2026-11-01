-- 20261124a_ofertare_poarta_cheltuiala — Ofertare faza 2 (decizia Răzvan 01.11.2026: varianta 1, cu A).
-- O SINGURĂ poartă pe cheltuială AI: fn_ofertare_poate_cheltui(licitație, utilizator) = true dacă utilizatorul e owner, SAU e responsabilul 1 / 2
-- al licitației și a fost numit de owner sau de un admin Ofertare, altcineva decât el însuși (închide autoatribuirea: oricine are acces
-- la Ofertare se putea pune singur responsabil și apoi cheltui). A = numirile vechi, fără „numit de” (responsabil_setat_de NULL, toate cele
-- 88 de licitații la 01.11), își păstrează dreptul; la orice renumire trigger-ul fn_ofertare_responsabil_setat_de scrie cine a numit.
-- Folosită de: cele 11 edge-uri ofertare-* cu poartă pe cheltuială (service_role) + ofertare_plansa_coada_inscrie + fn_ofertare_j02b_activeaza
-- (rescrise aici din definiția EXACTĂ din bază, garda md5). NU atinge: fn_ofertare_source_pack_poate_decide (decizie, nu cheltuială; include deja
-- adminii Ofertare), RLS, notificările.
-- Revenire: supabase/revenire/20261124a_ofertare_poarta_cheltuiala_ROLLBACK.sql (armată). ÎNTÂI se redeployează edge-urile pe versiunea anterioară.
-- ORDINEA LA LIVRARE: migrarea ÎNAINTEA deploy-ului edge (edge-urile cheamă funcția nouă; fără ea, poarta refuză tot = fail-closed).
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
END $pre$;

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
        CROSS JOIN LATERAL (VALUES (l.responsabil_id, l.responsabil_setat_de), (l.responsabil2_id, l.responsabil2_setat_de)) AS r(resp, numit_de)
       WHERE l.id = p_licitatie_id
         AND r.resp = p_uid
         AND (
           -- A (Răzvan 01.11): numirile dinaintea gărzii (fără „numit de”) își păstrează dreptul
           r.numit_de IS NULL
           OR (r.numit_de <> p_uid AND (
                COALESCE((SELECT pr.is_owner FROM public.profiles pr WHERE pr.id = r.numit_de), false)
                OR EXISTS (SELECT 1 FROM public.user_module_access u
                            WHERE u.profile_id = r.numit_de AND u.module = 'ofertare' AND u.access_level = 'admin')))
         )
    )
  );
$function$;
COMMENT ON FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid) IS
  'Poarta unică pe cheltuială AI în Ofertare (20261124a): owner, sau responsabil 1/2 numit de owner / admin Ofertare (nu autoatribuit); numirile vechi fără „numit de” = permise (decizia A, 01.11.2026). Doar service_role + funcțiile SECURITY DEFINER.';
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
