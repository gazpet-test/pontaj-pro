-- DRY 20270112a_ofertare_cantitati_masuratori: se ruleaza DUPA 20270112a, intr-o singura tranzactie cu ROLLBACK la final, pe clona PG17
-- (psql -X -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_ofertare_cantitati_masuratori_local.mjs). Nimic nu ramane scris.
-- Conturi, licitatii si documente SINTETICE (fara date reale): u_resp = responsabilul licitatiei (drept de decizie), u_of = doar modulul ofertare
--   (fara decizie), u_nimic = niciun modul. Fiecare pas ruleaza ca rolul authenticated cu JWT-ul contului (ambele surse: request.jwt.claim.sub si
--   request.jwt.claims), verificat la fiecare pas: auth.uid(), current_user, rol fara BYPASSRLS; pasii edge-ului ca service_role (rolul verificat).
--   t_liste            listele inchise (139 elemente, 19 tipare), citite de authenticated, nescrise de el (42501);
--   t_cazul_tichetului observatii pe AMBELE documente; 6.400 (F3) vs 3.995 (document) → diferenta + ciorna auto_surse_* propunere, view necesita_review;
--   t_dovezi           rand gresit / coloana vecina / diametru / „1.23” → respinse cu motivul; pozitie F3 fara sursa → fara_sursa, neverificat;
--   t_invalidare       reconfirmare → de_trimis → export OK; apoi, FARA extragere noua, fiecare sursa schimbata pe rand → export blocat;
--   t_circuit          ciorna auto_planse_* trece prin baza F3 (r9b) ca inainte; UPDATE text + trimisa dintr-o data → refuz;
--   t_acces            fara Ofertare: 0 randuri, RPC-uri 42501; scriere directa refuzata; doua licitatii → CM_ALTA_LICITATIE; nr dublu → 23505.
-- Rezultatul asteptat: fiecare sectiune tipareste „DRY 20270112a <nume> OK”, ultima linie „DRY 20270112a TOTUL OK”; orice FAIL opreste (ON_ERROR_STOP).
-- FIXTURI: pe clona, daca ofertare_licitatii / ofertare_documente_atribuire / profiles cer alte coloane NOT NULL, se completeaza DOAR aici.
BEGIN;
SET LOCAL search_path = public, pg_temp;
DO $fix$
DECLARE u uuid; m text; v_lic bigint; v_lic2 bigint;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DRY 20270112a PRECONDITIE: se ruleaza ca postgres (acum %)', current_user; END IF;
  IF nullif(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'DRY 20270112a PRECONDITIE: sesiune proaspata (fara JWT setat inainte)';
  END IF;
  IF to_regprocedure('public.fn_ofertare_semnale_publica(bigint,bigint,uuid)') IS NULL OR to_regclass('public.ofertare_cantitati_semnale') IS NULL THEN
    RAISE EXCEPTION 't_liste FAIL: migrarea 20270112a nu e aplicata (RPC-urile / tabelele lipsesc)';
  END IF;
  FOR u, m IN SELECT * FROM (VALUES ('f0000000-0000-4000-8000-0000000112a1'::uuid, 'ofertare'), ('f0000000-0000-4000-8000-0000000112a2'::uuid, 'ofertare'),
                                    ('f0000000-0000-4000-8000-0000000112a3'::uuid, NULL)) v LOOP
    IF to_regclass('auth.users') IS NOT NULL THEN
      EXECUTE 'INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING' USING u;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'role' AND NOT attisdropped) THEN
      EXECUTE 'INSERT INTO public.profiles (id, is_owner, role) VALUES ($1, false, ''teren'') ON CONFLICT (id) DO NOTHING' USING u;
    ELSE
      INSERT INTO public.profiles (id, is_owner) VALUES (u, false) ON CONFLICT (id) DO NOTHING;
    END IF;
    IF m IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.user_module_access'::regclass AND attname = 'access_level' AND NOT attisdropped) THEN
        EXECUTE 'INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ($1, $2, ''editor'')' USING u, m;
      ELSE
        INSERT INTO public.user_module_access (profile_id, module) VALUES (u, m);
      END IF;
    END IF;
  END LOOP;
  -- licitatiile sintetice: u_resp = responsabil (drept de decizie); fara loturi
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, responsabil_id, stare_loturi) VALUES ('DRY-0329-1', 'DRY AUTORITATE', 'DRY licitatie unu', 'f0000000-0000-4000-8000-0000000112a1', 'fara_loturi') RETURNING id INTO v_lic;
  INSERT INTO public.ofertare_licitatii (nr_anunt, autoritate, obiect, responsabil_id, stare_loturi) VALUES ('DRY-0329-2', 'DRY AUTORITATE', 'DRY licitatie doi', NULL, 'fara_loturi') RETURNING id INTO v_lic2;
  PERFORM set_config('dry.lic1', v_lic::text, true);
  PERFORM set_config('dry.lic2', v_lic2::text, true);
  INSERT INTO public.ofertare_ai_buget (licitatie_id, scop, plafon_usd) VALUES (v_lic, 'cant_extragere', 10), (v_lic2, 'cant_extragere', 10);
  INSERT INTO public.ofertare_ai_cereri (licitatie_id, lot_domeniu, scop, aprobat_de, valabil_pana) VALUES (v_lic, 'toate', 'cant_extragere', 'f0000000-0000-4000-8000-0000000112a1', now() + interval '1 day'),
    (v_lic2, 'toate', 'cant_extragere', 'f0000000-0000-4000-8000-0000000112a1', now() + interval '1 day');
END $fix$;
CREATE FUNCTION pg_temp.rd_lic(i int) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT current_setting('dry.lic' || i)::bigint $f$;
CREATE FUNCTION pg_temp.rd_u(k text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE k WHEN 'resp' THEN 'f0000000-0000-4000-8000-0000000112a1' WHEN 'of' THEN 'f0000000-0000-4000-8000-0000000112a2'
                ELSE 'f0000000-0000-4000-8000-0000000112a3' END::uuid $f$;
-- devine contul k (rolul authenticated, ambele surse JWT), verificat; inapoi la postgres cu rd_postgres(); edge = rd_service()
CREATE FUNCTION pg_temp.rd_ca(k text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', pg_temp.rd_u(k)::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.rd_u(k)::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM pg_temp.rd_u(k)
     OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'rd_ca: identitate gresita (rol %, uid %)', current_user, auth.uid();
  END IF;
END $f$;
CREATE FUNCTION pg_temp.rd_service() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL ROLE service_role';
  IF current_user <> 'service_role' OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'rd_service: rol % / uid %', current_user, auth.uid(); END IF;
END $f$;
CREATE FUNCTION pg_temp.rd_postgres() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'rd_postgres: rol %', current_user; END IF;
END $f$;
-- un document (ca postgres) cu textul dat; o extragere `gata` cu o felie pe tot textul si observatiile date (jsonb: [{rol, denumire, cantitate, pagina, citat, dn, material, masura, tip, cod, e_total}])
CREATE FUNCTION pg_temp.rd_doc(lic int, tip text, nume text, txt text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE v bigint;
BEGIN
  INSERT INTO public.ofertare_documente_atribuire (licitatie_id, nume_original, tip, text_extras, revizie, status_procesare)
    VALUES (pg_temp.rd_lic(lic), nume, tip, txt, 'A', 'procesat') RETURNING id INTO v;
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.rd_extragere(doc bigint, extractor text, obs jsonb) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE d record; v_sha text; v_prov bigint; v_cerere bigint; v_ex bigint; o jsonb;
BEGIN
  SELECT * INTO d FROM public.ofertare_documente_atribuire WHERE id = doc;
  v_sha := encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex');
  INSERT INTO public.ofertare_doc_texte (licitatie_id, sha256, text) VALUES (d.licitatie_id, v_sha, coalesce(d.text_extras, '')) ON CONFLICT DO NOTHING;
  INSERT INTO public.ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine) VALUES (d.licitatie_id, doc, v_sha, 'transcriere', 'dry', 'integral') RETURNING id INTO v_prov;
  SELECT id INTO v_cerere FROM public.ofertare_ai_cereri WHERE licitatie_id = d.licitatie_id ORDER BY id LIMIT 1;
  INSERT INTO public.ofertare_cant_extrageri (licitatie_id, document_id, doc_sha256, prov_id, familie_id, extractor_id, felii_total, stare, obs_relevante, cerere_id, terminat_la)
    VALUES (d.licitatie_id, doc, v_sha, v_prov, 'dry', extractor, 1, 'gata', 0, v_cerere, now()) RETURNING id INTO v_ex;
  INSERT INTO public.ofertare_cant_felii (munca_id, incercare, extragere_id, felie_nr, de_la, pana_la, sha_felie, stare, inchisa_la)
    VALUES (doc || ':' || v_sha || ':' || extractor || ':0:' || v_sha, 1, v_ex, 0, 0, length(coalesce(d.text_extras, '')), v_sha, 'gata', now());
  FOR o IN SELECT * FROM jsonb_array_elements(obs) LOOP
    INSERT INTO public.ofertare_cant_obs (licitatie_id, document_id, doc_sha256, familie_id, extragere_id, felie_nr, lot_domeniu, lot_nr, rol_sursa, rol_decis_de, pagina, cod_articol, denumire,
        rand_interval, citat_interval, cantitate_offset, pozitie_dovedita, tip_lucrare, masura, material, dn_mm, um_norm, cantitate, e_total, citat, extractor_id, hash_rand)
    VALUES (d.licitatie_id, doc, v_sha, 'dry', v_ex, 0, 'toate', '{}', o ->> 'rol', 'model', coalesce((o ->> 'pagina')::int, 1), o ->> 'cod', o ->> 'denumire',
        '[0,10)', '[0,10)', 0, true, coalesce(o ->> 'tip', 'conducta'), coalesce(o ->> 'masura', 'lungime'), o ->> 'material',
        coalesce(ARRAY(SELECT jsonb_array_elements_text(o -> 'dn')::numeric), '{}'), 'm', (o ->> 'cantitate')::numeric, coalesce((o ->> 'e_total')::boolean, false),
        o ->> 'citat', extractor, encode(sha256(convert_to(o ->> 'citat' || coalesce(o ->> 'cantitate', ''), 'UTF8')), 'hex'));
  END LOOP;
  RETURN v_ex;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.rd_lic(int), pg_temp.rd_u(text), pg_temp.rd_ca(text), pg_temp.rd_service(), pg_temp.rd_postgres() TO authenticated, service_role;

-- ── t_liste ──
DO $t$
DECLARE v int;
BEGIN
  IF (SELECT count(*) FROM public.ofertare_elemente_masura) <> 139 OR (SELECT count(*) FROM public.ofertare_tipare_cantitate) <> 19 THEN RAISE EXCEPTION 't_liste FAIL: numarul elementelor / tiparelor'; END IF;
  PERFORM pg_temp.rd_ca('of');
  SELECT count(*) INTO v FROM public.ofertare_elemente_masura;
  IF v <> 139 THEN RAISE EXCEPTION 't_liste FAIL: authenticated vede % elemente', v; END IF;
  BEGIN
    INSERT INTO public.ofertare_elemente_masura (cod, familie, um_canonica) VALUES ('dry_test', 'teava', 'm');
    RAISE EXCEPTION 't_liste FAIL: authenticated a scris in lista';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.rd_postgres();
  RAISE NOTICE 'DRY 20270112a t_liste OK';
END $t$;

-- ── t_cazul_tichetului ──
DO $t$
DECLARE v_f3 bigint; v_atr bigint; v_cant bigint; v_foto jsonb; v_p jsonb; v_pub jsonb; s record; c record; v_view record;
  c_f3 constant text := E'⟦PAGINA 1⟧\nFormularul F3\nNr. Cod Denumire UM Cantitate\n003 SA11G1 TEAVA PE100 DN160 M 6.400\n';
  c_atr constant text := E'⟦PAGINA 1⟧\nAVIZ TEHNIC DE RACORDARE\nRețeaua este în lungime totală de 3.995 m.\n';
BEGIN
  v_f3 := pg_temp.rd_doc(1, 'formular', 'DRY_DOC_F3_T', c_f3);
  v_atr := pg_temp.rd_doc(1, 'alta', 'DRY_DOC_ATR_T', c_atr);
  PERFORM pg_temp.rd_extragere(v_f3, 'dry-A', jsonb_build_array(jsonb_build_object('rol', 'f3', 'denumire', 'TEAVA PE100 DN160', 'cantitate', 6400, 'citat', '003 SA11G1 TEAVA PE100 DN160 M 6.400', 'cod', 'SA11G1', 'dn', jsonb_build_array(160), 'material', 'PE100', 'masura', 'material')));
  PERFORM pg_temp.rd_extragere(v_atr, 'dry-A', jsonb_build_array(jsonb_build_object('rol', 'atr', 'denumire', 'conducta PE100 Dn 160', 'cantitate', 3995, 'citat', 'în lungime totală de 3.995 m', 'dn', jsonb_build_array(160), 'material', 'PE100', 'masura', 'lungime')));
  INSERT INTO public.ofertare_cantitati (licitatie_id, denumire, um, cantitate, cod_articol, surse_document_ids, status, tip_sursa, extras_de_ai)
    VALUES (pg_temp.rd_lic(1), 'Furnizare teava PE100 DN160', 'M', 6400, 'SA11G1', ARRAY[v_f3], 'validat', 'lista_f3', false) RETURNING id INTO v_cant;
  PERFORM set_config('dry.f3', v_f3::text, true); PERFORM set_config('dry.atr', v_atr::text, true); PERFORM set_config('dry.cant', v_cant::text, true);
  PERFORM pg_temp.rd_service();
  v_foto := public.fn_ofertare_semnale_fotografie(pg_temp.rd_lic(1));
  v_p := public.fn_ofertare_masuratori_propune(pg_temp.rd_lic(1), '00000000-0000-4000-8000-0000000112aa', v_foto, '{"plafon": 200, "plafon_atins": false, "pagini_necitite": [], "documente_necitite": [], "felii_incomplete": []}'::jsonb);
  IF v_p ? 'refuz' THEN RAISE EXCEPTION 't_cazul_tichetului FAIL: propune %', v_p; END IF;
  v_pub := public.fn_ofertare_semnale_publica(pg_temp.rd_lic(1), (v_p ->> 'evaluare_id')::bigint, '00000000-0000-4000-8000-0000000112aa');
  IF v_pub ? 'refuz' THEN RAISE EXCEPTION 't_cazul_tichetului FAIL: publica %', v_pub; END IF;
  PERFORM pg_temp.rd_postgres();
  SELECT * INTO s FROM public.ofertare_cantitati_semnale WHERE licitatie_id = pg_temp.rd_lic(1) AND element = 'teava_pe_dn160';
  IF s.id IS NULL OR s.verdict <> 'diferenta' OR s.valoare_a <> 6400 OR s.valoare_b <> 3995 OR s.clasa <> 'fizica' OR s.obiect_cheie <> '*' THEN
    RAISE EXCEPTION 't_cazul_tichetului FAIL: semnal % % %', s.verdict, s.valoare_a, s.valoare_b;
  END IF;
  IF (SELECT count(*) FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = s.evaluare_id AND m.verificare = 'ok') <> 2 THEN
    RAISE EXCEPTION 't_cazul_tichetului FAIL: masuratorile (astept 2 ok, F3-ul nu intra in B)';
  END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE licitatie_id = pg_temp.rd_lic(1) AND cheie = 'auto_surse_' || s.identitate;
  IF c.id IS NULL OR c.status <> 'propunere' OR c.origine <> 'automat' OR c.intrebare NOT LIKE '%6400 m%' OR c.intrebare NOT LIKE '%3995 m%'
     OR NOT (c.surse_document_ids @> ARRAY[v_f3, v_atr]) OR c.surse_cantitati_ids <> ARRAY[v_cant] THEN
    RAISE EXCEPTION 't_cazul_tichetului FAIL: ciorna % % %', c.status, c.surse_document_ids, c.surse_cantitati_ids;
  END IF;
  PERFORM set_config('dry.ciorna', c.id::text, true);
  PERFORM pg_temp.rd_ca('of');
  SELECT * INTO v_view FROM public.v_ofertare_clarificari_baza WHERE id = c.id;
  IF v_view.stare IS DISTINCT FROM 'necesita_review' OR v_view.detalii ->> 'evaluare' IS DISTINCT FROM 'surse_v1' OR v_view.mod_ciorna IS DISTINCT FROM 'surse' THEN
    RAISE EXCEPTION 't_cazul_tichetului FAIL: view % %', v_view.stare, v_view.detalii ->> 'evaluare';
  END IF;
  PERFORM pg_temp.rd_postgres();
  RAISE NOTICE 'DRY 20270112a t_cazul_tichetului OK';
END $t$;

-- ── t_dovezi ──
DO $t$
DECLARE r record; v jsonb; v_cant2 bigint; v_p jsonb; v_pub jsonb; s record;
  c_pag constant text := E'⟦PAGINA 1⟧\nNr. Cod Denumire UM DN Cantitate\n003 SA11G1 TEAVA PE100 DN160 M 160 6.400\nNr. Cod Denumire UM Cantitate\n010 Y TEAVA DN160 M 1.23\n011 Z TEAVA DN160 MM 160\nconductă DN 160, lungime 250 m\nconductă DN110, lungime 100 m; conductă DN160, lungime 250 m\n';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('rand gresit', '{"pagina": 1, "fel_dovada": "tabel", "rand": "999 INEXISTENT M 1", "celula": "1", "element": "teava_pe_dn160"}'::jsonb, 'rand_lipsa'),
      ('coloana vecina', '{"pagina": 1, "fel_dovada": "tabel", "rand": "003 SA11G1 TEAVA PE100 DN160 M 160 6.400", "celula": "160", "element": "teava_pe_dn160"}'::jsonb, 'coloana_necunoscuta'),
      ('celula corecta', '{"pagina": 1, "fel_dovada": "tabel", "rand": "003 SA11G1 TEAVA PE100 DN160 M 160 6.400", "celula": "6.400", "element": "teava_pe_dn160"}'::jsonb, 'ok'),
      ('diametru in loc de cantitate', '{"pagina": 1, "fel_dovada": "tabel", "rand": "011 Z TEAVA DN160 MM 160", "celula": "160", "element": "teava_dn160"}'::jsonb, 'diametru_nu_cantitate'),
      ('1.23 ambiguu', '{"pagina": 1, "fel_dovada": "tabel", "rand": "010 Y TEAVA DN160 M 1.23", "celula": "1.23", "element": "teava_dn160"}'::jsonb, 'numar_ambiguu'),
      ('text: lungime 250 m', '{"pagina": 1, "fel_dovada": "text", "fragment": "conductă DN 160, lungime 250 m", "element": "teava_pe_dn160"}'::jsonb, 'ok'),
      ('text: DN160 fara cuvant-cheie', '{"pagina": 1, "fel_dovada": "text", "fragment": "TEAVA DN160 M", "element": "teava_dn160"}'::jsonb, 'tipar_necunoscut'),
      ('text: doua cantitati in fragment → ambiguu, nu prima', '{"pagina": 1, "fel_dovada": "text", "fragment": "conductă DN110, lungime 100 m; conductă DN160, lungime 250 m", "element": "teava_pe_dn160"}'::jsonb, 'fragment_ambiguu')
    ) x(ce, dov, astept) LOOP
    v := public.fn_ofertare_masura_verifica(c_pag, r.dov);
    IF v ->> 'verificare' IS DISTINCT FROM r.astept THEN RAISE EXCEPTION 't_dovezi FAIL: % → % (astept %)', r.ce, v ->> 'verificare', r.astept; END IF;
  END LOOP;
  IF (public.fn_ofertare_numar_ro('1.23') ->> 'motiv') IS DISTINCT FROM 'format_numeric_ambiguu' OR (public.fn_ofertare_numar_ro('6.400') ->> 'valoare')::numeric <> 6400 THEN
    RAISE EXCEPTION 't_dovezi FAIL: regula numerica';
  END IF;
  -- pozitie F3 fara sursa → componenta fara_sursa, semnal neverificat (agregare incompleta)
  INSERT INTO public.ofertare_cantitati (licitatie_id, denumire, um, cantitate, cod_articol, surse_document_ids, status, tip_sursa, extras_de_ai)
    VALUES (pg_temp.rd_lic(1), 'Furnizare teava PE100 DN160', 'M', 100, 'SA11G9', NULL, 'validat', 'lista_f3', false) RETURNING id INTO v_cant2;
  PERFORM pg_temp.rd_service();
  v_p := public.fn_ofertare_masuratori_propune(pg_temp.rd_lic(1), '00000000-0000-4000-8000-0000000112ab', public.fn_ofertare_semnale_fotografie(pg_temp.rd_lic(1)), '{"plafon": 200, "plafon_atins": false, "pagini_necitite": [], "documente_necitite": [], "felii_incomplete": []}'::jsonb);
  v_pub := public.fn_ofertare_semnale_publica(pg_temp.rd_lic(1), (v_p ->> 'evaluare_id')::bigint, '00000000-0000-4000-8000-0000000112ab');
  PERFORM pg_temp.rd_postgres();
  SELECT * INTO s FROM public.ofertare_cantitati_semnale WHERE licitatie_id = pg_temp.rd_lic(1) AND element = 'teava_pe_dn160';
  IF s.verdict <> 'neverificat' OR s.motiv NOT LIKE 'agregare incompletă%'
     OR NOT EXISTS (SELECT 1 FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = s.evaluare_id AND m.cantitate_id = v_cant2 AND m.verificare = 'fara_sursa') THEN
    RAISE EXCEPTION 't_dovezi FAIL: pozitia fara sursa: % %', s.verdict, s.motiv;
  END IF;
  IF (SELECT status FROM public.ofertare_clarificari WHERE id = current_setting('dry.ciorna')::bigint) <> 'retrasa' THEN RAISE EXCEPTION 't_dovezi FAIL: ciorna needitata nu a fost retrasa de sistem la neverificat'; END IF;
  -- inapoi la cazul din tichet: pozitia fara sursa stearsa, reevaluare → diferenta, ciorna reactivata
  DELETE FROM public.ofertare_cantitati WHERE id = v_cant2;
  PERFORM pg_temp.rd_service();
  v_p := public.fn_ofertare_masuratori_propune(pg_temp.rd_lic(1), '00000000-0000-4000-8000-0000000112ac', public.fn_ofertare_semnale_fotografie(pg_temp.rd_lic(1)), '{"plafon": 200, "plafon_atins": false, "pagini_necitite": [], "documente_necitite": [], "felii_incomplete": []}'::jsonb);
  v_pub := public.fn_ofertare_semnale_publica(pg_temp.rd_lic(1), (v_p ->> 'evaluare_id')::bigint, '00000000-0000-4000-8000-0000000112ac');
  PERFORM pg_temp.rd_postgres();
  IF (SELECT status FROM public.ofertare_clarificari WHERE id = current_setting('dry.ciorna')::bigint) <> 'propunere' THEN RAISE EXCEPTION 't_dovezi FAIL: ciorna nu a fost reactivata'; END IF;
  RAISE NOTICE 'DRY 20270112a t_dovezi OK';
END $t$;

-- ── t_invalidare ──
DO $t$
DECLARE c bigint := current_setting('dry.ciorna')::bigint; v record; r jsonb; e jsonb; p record;
BEGIN
  PERFORM pg_temp.rd_ca('resp');
  SELECT * INTO v FROM public.v_ofertare_clarificari_baza WHERE id = c;
  r := public.ofertare_clarificare_reconfirma(c, v.amprenta_curenta, 'revizuit', 'verificat de om in dry-run');
  IF (r ->> 'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 't_invalidare FAIL: reconfirmarea %', r; END IF;
  UPDATE public.ofertare_clarificari SET status = 'de_trimis' WHERE id = c;
  e := public.ofertare_clarificari_export(pg_temp.rd_lic(1));
  IF jsonb_array_length(e) <> 1 THEN RAISE EXCEPTION 't_invalidare FAIL: exportul nu include ciorna aprobata'; END IF;
  PERFORM pg_temp.rd_postgres();
  FOR p IN SELECT * FROM (VALUES
      ('cantitate F3', format('UPDATE public.ofertare_cantitati SET cantitate = 6401 WHERE id = %s', current_setting('dry.cant')), format('UPDATE public.ofertare_cantitati SET cantitate = 6400 WHERE id = %s', current_setting('dry.cant'))),
      ('revizie document', format('UPDATE public.ofertare_documente_atribuire SET revizie = ''B'' WHERE id = %s', current_setting('dry.atr')), format('UPDATE public.ofertare_documente_atribuire SET revizie = ''A'' WHERE id = %s', current_setting('dry.atr'))),
      ('text_extras', format('UPDATE public.ofertare_documente_atribuire SET text_extras = text_extras || '' '' WHERE id = %s', current_setting('dry.atr')), format('UPDATE public.ofertare_documente_atribuire SET text_extras = left(text_extras, -1) WHERE id = %s', current_setting('dry.atr'))),
      ('prag', format('INSERT INTO public.ofertare_cantitati_setari (licitatie_id, prag) VALUES (%s, 0.1)', pg_temp.rd_lic(1)), format('DELETE FROM public.ofertare_cantitati_setari WHERE licitatie_id = %s', pg_temp.rd_lic(1))),
      ('plafon', format('INSERT INTO public.ofertare_cantitati_setari (licitatie_id, plafon_pagini) VALUES (%s, 300)', pg_temp.rd_lic(1)), format('DELETE FROM public.ofertare_cantitati_setari WHERE licitatie_id = %s', pg_temp.rd_lic(1))),
      ('stare_loturi', format('UPDATE public.ofertare_licitatii SET stare_loturi = ''are_loturi'' WHERE id = %s', pg_temp.rd_lic(1)), format('UPDATE public.ofertare_licitatii SET stare_loturi = ''fara_loturi'' WHERE id = %s', pg_temp.rd_lic(1))),
      ('document adaugat', format('INSERT INTO public.ofertare_documente_atribuire (licitatie_id, nume_original, tip, revizie, status_procesare) VALUES (%s, ''DRY_NOU'', ''alta'', ''A'', ''neprocesat'')', pg_temp.rd_lic(1)), format('DELETE FROM public.ofertare_documente_atribuire WHERE licitatie_id = %s AND nume_original = ''DRY_NOU''', pg_temp.rd_lic(1)))
    ) x(ce, schimba, revino) LOOP
    EXECUTE p.schimba;
    PERFORM pg_temp.rd_ca('resp');
    SELECT * INTO v FROM public.v_ofertare_clarificari_baza WHERE id = c;
    IF v.stare IS DISTINCT FROM 'schimbata' OR v.text IS DISTINCT FROM 'baza s-a schimbat — de reverificat' THEN RAISE EXCEPTION 't_invalidare FAIL: %: view % / %', p.ce, v.stare, v.text; END IF;
    BEGIN
      e := public.ofertare_clarificari_export(pg_temp.rd_lic(1));
      RAISE EXCEPTION 't_invalidare FAIL: %: exportul a trecut', p.ce;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Export blocat: baza s-a schimbat — de reverificat%' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE public.ofertare_clarificari SET status = 'trimisa' WHERE id = c;
      RAISE EXCEPTION 't_invalidare FAIL: %: trimisa a trecut', p.ce;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'Clarificare blocată: baza s-a schimbat%' THEN RAISE; END IF;
    END;
    PERFORM pg_temp.rd_postgres();
    EXECUTE p.revino;
    PERFORM pg_temp.rd_ca('resp');
    SELECT * INTO v FROM public.v_ofertare_clarificari_baza WHERE id = c;
    IF v.stare IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 't_invalidare FAIL: %: dupa revenire %', p.ce, v.stare; END IF;
    PERFORM pg_temp.rd_postgres();
  END LOOP;
  RAISE NOTICE 'DRY 20270112a t_invalidare OK';
END $t$;

-- ── t_circuit ──
DO $t$
DECLARE c bigint := current_setting('dry.ciorna')::bigint; cp bigint; v record; r jsonb; v_baza jsonb; v_text text := 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe' || chr(10) || chr(10) || 'text dry';
BEGIN
  -- auto_surse_*, ciorna aprobata si pusa de_trimis (t_invalidare): UPDATE text + trimisa dintr-o data → ca in R9b, editarea nu mosteneste
  -- aprobarea: textul se salveaza, statusul cade la propunere, reconfirmarea iese din baza (text_editat_de ramane)
  PERFORM pg_temp.rd_ca('resp');
  UPDATE public.ofertare_clarificari SET intrebare = intrebare || ' (modificat)', status = 'trimisa' WHERE id = c;
  SELECT * INTO v FROM public.ofertare_clarificari WHERE id = c;
  IF v.status IS DISTINCT FROM 'propunere' OR v.baza_generare ? 'reconfirmare' OR NOT (v.baza_generare ? 'text_editat_de') THEN
    RAISE EXCEPTION 't_circuit FAIL: text + trimisa pe de_trimis: % %', v.status, v.baza_generare ? 'reconfirmare';
  END IF;
  -- pe propunerea needitata-aprobata: UPDATE text + trimisa dintr-o data → refuz (starea pe NEW, fara aprobare)
  BEGIN
    UPDATE public.ofertare_clarificari SET intrebare = intrebare || ' (modificat)', status = 'trimisa' WHERE id = c;
    RAISE EXCEPTION 't_circuit FAIL: text + trimisa dintr-o data a trecut';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Clarificare blocată: necesită review%' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.rd_postgres();
  -- auto_planse_*: trece prin baza F3 (r9b) ca inainte (pe clona ofertare_f3_baza e cea reala)
  v_baza := public.ofertare_f3_baza(pg_temp.rd_lic(1));
  INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare)
    VALUES (pg_temp.rd_lic(1), 77, v_text, 'planse_auto:' || current_setting('dry.atr') || ',gen_' || left(md5(v_text), 12) || ',ev_' || left(md5('dry'), 12), 'propunere', 'automat', 'auto_planse_1',
            v_baza || jsonb_build_object('la', now(), 'sursa_generare', 'v6-r9b', 'text_hash', md5(v_text))) RETURNING id INTO cp;
  PERFORM pg_temp.rd_ca('resp');
  SELECT * INTO v FROM public.v_ofertare_clarificari_baza WHERE id = cp;
  IF v.id IS NULL OR v.detalii ->> 'evaluare' IS DISTINCT FROM 'r9b' OR v.mod_ciorna IS DISTINCT FROM 'corespondenta' THEN RAISE EXCEPTION 't_circuit FAIL: planse in view % %', v.stare, v.detalii ->> 'evaluare'; END IF;
  r := public.ofertare_clarificare_reconfirma(cp, v.amprenta_curenta, 'revizuit', 'verificat de om in dry-run');
  IF NOT (r ? 'ok' OR r ? 'error') THEN RAISE EXCEPTION 't_circuit FAIL: reconfirmarea pe planse %', r; END IF;
  BEGIN
    UPDATE public.ofertare_clarificari SET intrebare = intrebare || ' (modificat)', status = 'trimisa' WHERE id = cp;
    RAISE EXCEPTION 't_circuit FAIL: planse: text + trimisa dintr-o data a trecut';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Clarificare blocată:%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.ofertare_clarificari WHERE id = cp;
    RAISE EXCEPTION 't_circuit FAIL: planse: DELETE a trecut';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%retrage ciorna%' THEN RAISE; END IF;
  END;
  r := public.ofertare_clarificare_exceptie_identitate(c, 'x', 'motiv suficient de lung');
  IF r ->> 'error' IS DISTINCT FROM 'nu se aplică ciornelor de surse' THEN RAISE EXCEPTION 't_circuit FAIL: exceptia pe surse %', r; END IF;
  PERFORM pg_temp.rd_postgres();
  RAISE NOTICE 'DRY 20270112a t_circuit OK';
END $t$;

-- ── t_acces ──
DO $t$
DECLARE v int; s record; v_doc2 bigint; v_ev bigint;
BEGIN
  PERFORM pg_temp.rd_ca('nimic');
  SELECT count(*) INTO v FROM public.ofertare_cantitati_semnale; IF v <> 0 THEN RAISE EXCEPTION 't_acces FAIL: fara Ofertare vede % semnale', v; END IF;
  SELECT count(*) INTO v FROM public.ofertare_cantitati_masuratori; IF v <> 0 THEN RAISE EXCEPTION 't_acces FAIL: fara Ofertare vede % masuratori', v; END IF;
  SELECT count(*) INTO v FROM public.v_ofertare_clarificari_baza; IF v <> 0 THEN RAISE EXCEPTION 't_acces FAIL: fara Ofertare vede % randuri in view', v; END IF;
  BEGIN PERFORM 1 FROM public.fn_ofertare_semnale_lista(pg_temp.rd_lic(1)); RAISE EXCEPTION 't_acces FAIL: lista fara Ofertare';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.fn_ofertare_semnale_fotografie(pg_temp.rd_lic(1)); RAISE EXCEPTION 't_acces FAIL: fotografia ca authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.fn_ofertare_semnale_setari(pg_temp.rd_lic(1), 0.1, 100); RAISE EXCEPTION 't_acces FAIL: setarile fara drept';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.rd_ca('of');
  BEGIN PERFORM public.fn_ofertare_semnale_setari(pg_temp.rd_lic(1), 0.1, 100); RAISE EXCEPTION 't_acces FAIL: setarile fara drept de decizie';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.ofertare_cantitati_semnale (licitatie_id, obiect_cheie, element, clasa, um_canonica, identitate) VALUES (pg_temp.rd_lic(1), '*', 'sapatura', 'fizica', 'mc', '0123456789abcdef');
    RAISE EXCEPTION 't_acces FAIL: scriere directa acceptata';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.ofertare_cantitati_semnale SET verdict = 'in_regula'; RAISE EXCEPTION 't_acces FAIL: UPDATE direct acceptat';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- provenienta (fn_ofertare_surse_valideaza, acum INVOKER): scrierea DIRECTA a clientului pe surse_* / origine ramane refuzata (42501), cu id valid din aceeasi licitatie
  BEGIN
    UPDATE public.ofertare_clarificari SET surse_document_ids = ARRAY[current_setting('dry.atr')::bigint] WHERE id = current_setting('dry.ciorna')::bigint;
    RAISE EXCEPTION 't_acces FAIL: provenienta ciornei scrisa direct de utilizator';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.ofertare_cantitati SET surse_document_ids = NULL WHERE id = current_setting('dry.cant')::bigint;
    RAISE EXCEPTION 't_acces FAIL: provenienta pozitiei F3 scrisa direct de utilizator';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status, origine) VALUES (pg_temp.rd_lic(1), 78, 'x', 'propunere', 'automat');
    RAISE EXCEPTION 't_acces FAIL: INSERT cu origine automat acceptat de la utilizator';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.rd_postgres();
  -- doua licitatii → CM_ALTA_LICITATIE (documentul licitatiei 2 pe o masuratoare a licitatiei 1)
  SELECT * INTO s FROM public.ofertare_cantitati_semnale WHERE licitatie_id = pg_temp.rd_lic(1) AND element = 'teava_pe_dn160';
  v_doc2 := pg_temp.rd_doc(2, 'alta', 'DRY_DOC_LIC2', 'x');
  BEGIN
    INSERT INTO public.ofertare_cantitati_masuratori (licitatie_id, evaluare_id, semnal_id, parte, cantitate_id, document_id, revizie, doc_sha256, verificare)
      VALUES (pg_temp.rd_lic(1), s.evaluare_id, s.id, 'a', current_setting('dry.cant')::bigint, v_doc2, 'A', encode(sha256('x'::bytea), 'hex'), 'nedovedit');
    RAISE EXCEPTION 't_acces FAIL: documentul altei licitatii acceptat';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'CM_ALTA_LICITATIE%' THEN RAISE; END IF;
  END;
  -- nr dublu → 23505
  BEGIN
    INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, status) VALUES (pg_temp.rd_lic(1), 77, 'dublu', 'propunere');
    RAISE EXCEPTION 't_acces FAIL: nr dublu acceptat';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE NOTICE 'DRY 20270112a t_acces OK';
END $t$;
DO $t$ BEGIN RAISE NOTICE 'DRY 20270112a TOTUL OK'; END $t$;
ROLLBACK;
