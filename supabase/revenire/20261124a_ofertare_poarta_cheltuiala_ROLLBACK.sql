-- REVENIRE 20261124a_ofertare_poarta_cheltuiala (armată; doar la cererea lui Răzvan). ÎNTÂI se redeployează cele 11 edge-uri ofertare-* pe versiunea
-- dinaintea PR-ului (altfel cheamă o funcție care nu mai există = poarta refuză tot), apoi: cele două funcții EXACT ca înainte + DROP funcția nouă.
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

DROP FUNCTION public.fn_ofertare_poate_cheltui(bigint, uuid);
