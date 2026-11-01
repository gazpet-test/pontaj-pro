-- Teste DRY 20261124a (runda 2: 1A 2A 3A 4A), rulate ÎN tranzacția de probă, după migrare (se anulează: ROLLBACK). Identități reale din bază.
-- Review #908 r1 Jakarinos P5: (a) aserțiunile sunt `IS DISTINCT FROM true / false` (un rezultat NULL pică testul, nu trece tăcut);
-- (b) scrierile „ca utilizator” rulează sub rolul Postgres `authenticated` real (SET LOCAL ROLE + request.jwt.claims), deci prin RLS și
-- privilegii, ca o cerere PostgREST — nu doar cu claims schimbate pe postgres. Verificările porții se fac înapoi pe postgres (RESET ROLE),
-- fiindcă authenticated nu are EXECUTE pe fn_ofertare_poate_cheltui (intenționat).
DO $t$
DECLARE
  v_owner uuid := (SELECT id FROM profiles WHERE is_owner LIMIT 1);
  v_admin uuid := (SELECT u.profile_id FROM user_module_access u JOIN profiles p ON p.id = u.profile_id
                    WHERE u.module = 'ofertare' AND u.access_level = 'admin' AND NOT COALESCE(p.is_owner, false) LIMIT 1);
  v_editor uuid := (SELECT u.profile_id FROM user_module_access u JOIN profiles p ON p.id = u.profile_id
                     WHERE u.module = 'ofertare' AND u.access_level = 'editor' AND NOT COALESCE(p.is_owner, false)
                       AND u.profile_id NOT IN (SELECT profile_id FROM user_module_access WHERE module = 'ofertare' AND access_level = 'admin') LIMIT 1);
  v_strain uuid;
  v_lic_act bigint; v_resp_act uuid;
  r record; n_activ int := 0; v_j jsonb; v_q record;
BEGIN
  IF v_owner IS NULL OR v_admin IS NULL OR v_editor IS NULL THEN RAISE EXCEPTION 'PRE lipsesc identitati (owner %, admin %, editor %)', v_owner, v_admin, v_editor; END IF;
  v_strain := (SELECT id FROM profiles WHERE id NOT IN (v_editor, v_admin, v_owner) AND NOT COALESCE(is_owner, false)
                 AND id NOT IN (SELECT profile_id FROM user_module_access WHERE module = 'ofertare') LIMIT 1);

  -- (1) A: licitațiile active, responsabilii vechi (fără „numit de”, fără dovadă) trec; owner trece; un străin nu
  FOR r IN SELECT id, responsabil_id FROM ofertare_licitatii WHERE termen_depunere >= current_date AND responsabil_id IS NOT NULL LOOP
    IF fn_ofertare_poate_cheltui(r.id, r.responsabil_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST1 responsabil vechi refuzat pe %', r.id; END IF;
    IF fn_ofertare_poate_cheltui(r.id, v_owner) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST1 owner refuzat pe %', r.id; END IF;
    IF fn_ofertare_poate_cheltui(r.id, v_strain) IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST1 strain nu e false pe %', r.id; END IF;
    IF r.responsabil_id NOT IN (v_editor, v_admin, v_owner, v_strain) AND v_lic_act IS NULL AND r.id <> 95
       AND EXISTS (SELECT 1 FROM user_module_access WHERE profile_id = r.responsabil_id AND module = 'ofertare') THEN
      v_lic_act := r.id; v_resp_act := r.responsabil_id;
    END IF;
    n_activ := n_activ + 1;
  END LOOP;
  IF n_activ = 0 OR v_lic_act IS NULL THEN RAISE EXCEPTION 'TEST1 nicio licitatie activa cu responsabil cu acces Ofertare (%)', n_activ; END IF;
  IF (SELECT count(*) FROM ofertare_licitatii WHERE responsabil_numitor_autorizat IS NOT NULL OR responsabil2_numitor_autorizat IS NOT NULL) <> 0 THEN
    RAISE EXCEPTION 'TEST1 dovada completata pe randuri vechi';
  END IF;
  RAISE NOTICE 'TEST1 OK (% licitatii active, A pastrat)', n_activ;

  -- (2) parametri nuli / licitație inexistentă → exact false (nu NULL)
  IF fn_ofertare_poate_cheltui(NULL, v_owner) IS DISTINCT FROM false OR fn_ofertare_poate_cheltui(95, NULL) IS DISTINCT FROM false
     OR fn_ofertare_poate_cheltui(-1, v_editor) IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST2 null/inexistent nu e false'; END IF;
  RAISE NOTICE 'TEST2 OK';

  -- (3) numiri prin trigger, ca utilizator authenticated real
  -- 3a editorul se numește singur → numit de el, dovada false, refuz
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE ofertare_licitatii SET responsabil_id = v_editor WHERE id = 95;
  EXECUTE 'RESET ROLE';
  SELECT responsabil_setat_de, responsabil_numitor_autorizat INTO v_q FROM ofertare_licitatii WHERE id = 95;
  IF v_q.responsabil_setat_de IS DISTINCT FROM v_editor OR v_q.responsabil_numitor_autorizat IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST3a trigger: % / %', v_q.responsabil_setat_de, v_q.responsabil_numitor_autorizat; END IF;
  IF fn_ofertare_poate_cheltui(95, v_editor) IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST3a autoatribuit nu e false'; END IF;
  -- 3b clientul încearcă să-și scrie singur dovada / „numit de” → trigger-ul păstrează valorile vechi
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE ofertare_licitatii SET responsabil_numitor_autorizat = true, responsabil_setat_de = v_owner WHERE id = 95;
  EXECUTE 'RESET ROLE';
  SELECT responsabil_setat_de, responsabil_numitor_autorizat INTO v_q FROM ofertare_licitatii WHERE id = 95;
  IF v_q.responsabil_setat_de IS DISTINCT FROM v_editor OR v_q.responsabil_numitor_autorizat IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST3b dovada falsificata din client'; END IF;
  IF fn_ofertare_poate_cheltui(95, v_editor) IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST3b falsificarea a deschis poarta'; END IF;
  -- 3c 2A: editorul e promovat admin DUPĂ numire → numirea lui rămâne fără drept (dovada nu se reevaluează)
  INSERT INTO user_module_access (profile_id, module, access_level) VALUES (v_editor, 'ofertare', 'admin')
    ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM user_module_access WHERE profile_id = v_editor AND module = 'ofertare' AND access_level = 'admin') THEN
    UPDATE user_module_access SET access_level = 'admin' WHERE profile_id = v_editor AND module = 'ofertare';
  END IF;
  IF fn_ofertare_poate_cheltui(95, v_editor) IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST3c promovarea ulterioara a deschis poarta'; END IF;
  UPDATE user_module_access SET access_level = 'editor' WHERE profile_id = v_editor AND module = 'ofertare';
  DELETE FROM user_module_access WHERE profile_id = v_editor AND module = 'ofertare' AND access_level = 'admin';
  -- 3d adminul numește editorul → dovada true, trece
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE ofertare_licitatii SET responsabil_id = NULL WHERE id = 95;
  UPDATE ofertare_licitatii SET responsabil_id = v_editor WHERE id = 95;
  EXECUTE 'RESET ROLE';
  SELECT responsabil_setat_de, responsabil_numitor_autorizat INTO v_q FROM ofertare_licitatii WHERE id = 95;
  IF v_q.responsabil_setat_de IS DISTINCT FROM v_admin OR v_q.responsabil_numitor_autorizat IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST3d trigger admin: % / %', v_q.responsabil_setat_de, v_q.responsabil_numitor_autorizat; END IF;
  IF fn_ofertare_poate_cheltui(95, v_editor) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST3d numit de admin refuzat'; END IF;
  -- 3e 2A: adminul pierde rolul DUPĂ numire → numirea rămâne valabilă
  UPDATE user_module_access SET access_level = 'editor' WHERE profile_id = v_admin AND module = 'ofertare';
  IF fn_ofertare_poate_cheltui(95, v_editor) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST3e retrogradarea ulterioara a inchis poarta'; END IF;
  UPDATE user_module_access SET access_level = 'admin' WHERE profile_id = v_admin AND module = 'ofertare';
  -- 3f editorul numește un responsabil 2 → dovada false, refuz
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE ofertare_licitatii SET responsabil2_id = v_strain WHERE id = 95;
  EXECUTE 'RESET ROLE';
  IF (SELECT responsabil2_numitor_autorizat FROM ofertare_licitatii WHERE id = 95) IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST3f r2 dovada nu e false'; END IF;
  IF fn_ofertare_poate_cheltui(95, v_strain) IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST3f r2 numit de editor trece'; END IF;
  -- 3g reasignare R1 ↔ R2 de owner într-un singur UPDATE → ambele cu dovada true (owner)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE ofertare_licitatii SET responsabil_id = v_strain, responsabil2_id = v_editor WHERE id = 95;
  EXECUTE 'RESET ROLE';
  SELECT * INTO v_q FROM ofertare_licitatii WHERE id = 95;
  IF v_q.responsabil_setat_de IS DISTINCT FROM v_owner OR v_q.responsabil_numitor_autorizat IS DISTINCT FROM true
     OR v_q.responsabil2_setat_de IS DISTINCT FROM v_owner OR v_q.responsabil2_numitor_autorizat IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST3g swap R1/R2'; END IF;
  IF fn_ofertare_poate_cheltui(95, v_strain) IS DISTINCT FROM true OR fn_ofertare_poate_cheltui(95, v_editor) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST3g swap refuzat'; END IF;
  -- 3h numire fără utilizator (sesiune SQL, ca postgres) → „numit de” NULL, dovada false: NU intră în A
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE ofertare_licitatii SET responsabil_id = v_admin WHERE id = 95;
  SELECT * INTO v_q FROM ofertare_licitatii WHERE id = 95;
  IF v_q.responsabil_setat_de IS NOT NULL OR v_q.responsabil_numitor_autorizat IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST3h numire fara utilizator: % / %', v_q.responsabil_setat_de, v_q.responsabil_numitor_autorizat; END IF;
  IF fn_ofertare_poate_cheltui(95, v_admin) IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST3h numirea din SQL intra in A'; END IF;
  -- 3i responsabilul 2 rămâne neatins de schimbarea lui R1 (dovada păstrată)
  IF (SELECT responsabil2_numitor_autorizat FROM ofertare_licitatii WHERE id = 95) IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST3i r2 alterat'; END IF;
  RAISE NOTICE 'TEST3 OK (trigger sub authenticated, 2A promovare/retrogradare, swap R1/R2, numire din SQL)';

  -- (4) drepturi pe funcții
  IF has_function_privilege('authenticated', 'public.fn_ofertare_poate_cheltui(bigint,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ofertare_poate_cheltui(bigint,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ofertare_poate_cheltui(bigint,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST4 drepturi gresite pe poarta';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ofertare_coada_porneste(text,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ofertare_coada_porneste(text,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ofertare_coada_opreste(text,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ofertare_coada_opreste(text,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST4 drepturi gresite pe RPC-urile cozilor';
  END IF;
  IF has_function_privilege('authenticated', 'public.ofertare_extragere_tick()', 'EXECUTE') OR has_function_privilege('anon', 'public.ofertare_extragere_tick()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST4 tick-ul a devenit apelabil din API';
  END IF;
  RAISE NOTICE 'TEST4 OK';

  -- (5) 3A: scrierea directă în cozi e închisă pentru authenticated (chiar cu acces Ofertare), pe toate cele 4 cozi
  FOREACH v_j IN ARRAY ARRAY['"ofertare_ingest_coada"', '"ofertare_acoperire_coada"', '"ofertare_clarificari_coada"', '"ofertare_extragere_coada"']::jsonb[] LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      EXECUTE format('INSERT INTO public.%I (licitatie_id, activ, cerut_de) VALUES (%s, true, %L)', v_j #>> '{}', v_lic_act, v_strain);
      RAISE EXCEPTION 'TEST5 insert direct trecut pe %', v_j #>> '{}';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      EXECUTE format('UPDATE public.%I SET activ = true, cerut_de = %L WHERE licitatie_id = %s', v_j #>> '{}', v_owner, v_lic_act);
      RAISE EXCEPTION 'TEST5 update direct trecut pe %', v_j #>> '{}';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      EXECUTE format('DELETE FROM public.%I WHERE licitatie_id = %s', v_j #>> '{}', v_lic_act);
      RAISE EXCEPTION 'TEST5 delete direct trecut pe %', v_j #>> '{}';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE 'SET LOCAL ROLE anon';
      EXECUTE format('SELECT count(*) FROM public.%I', v_j #>> '{}');
      RAISE EXCEPTION 'TEST5 anon citeste %', v_j #>> '{}';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'TEST5 OK (insert/update/delete directe refuzate pe 4 cozi, anon fara acces)';

  -- (6) 3A: RPC-ul de pornire — poarta + cerut_de = auth.uid()
  -- 6a editor cu acces Ofertare, dar nu responsabil al licitației active → refuz (42501), nimic scris
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM ofertare_coada_porneste('acoperire', v_lic_act);
    RAISE EXCEPTION 'TEST6a editor strain a pornit coada';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- 6b utilizator fără acces Ofertare → refuz
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_strain, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM ofertare_coada_porneste('ingest', v_lic_act);
    RAISE EXCEPTION 'TEST6b fara acces a pornit coada';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- 6c anon nu poate chema RPC-ul
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM ofertare_coada_porneste('ingest', v_lic_act);
    RAISE EXCEPTION 'TEST6c anon a pornit coada';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- 6d coadă necunoscută / extragere (nu se pornește din API) → 22023
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM ofertare_coada_porneste('extragere', v_lic_act);
    RAISE EXCEPTION 'TEST6d extragere pornita din API';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  -- 6e responsabilul vechi (A) pornește ingest; ownerul pornește clarificări → activ, cerut_de = el (nu o valoare din client)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_resp_act, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_j := ofertare_coada_porneste('ingest', v_lic_act);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_j := ofertare_coada_porneste('clarificari', v_lic_act);
  v_j := ofertare_coada_porneste('acoperire', v_lic_act);
  EXECUTE 'RESET ROLE';
  IF (SELECT cerut_de FROM ofertare_ingest_coada WHERE licitatie_id = v_lic_act AND activ) IS DISTINCT FROM v_resp_act THEN RAISE EXCEPTION 'TEST6e ingest cerut_de'; END IF;
  IF (SELECT cerut_de FROM ofertare_clarificari_coada WHERE licitatie_id = v_lic_act AND activ AND rezultat IS NULL AND nota IS NULL) IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'TEST6e clarificari cerut_de'; END IF;
  IF (SELECT cerut_de FROM ofertare_acoperire_coada WHERE licitatie_id = v_lic_act AND activ AND stare IS NULL AND jurnal = '[]'::jsonb) IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'TEST6e acoperire cerut_de'; END IF;
  -- 6f oprirea: oricine cu acces Ofertare (editorul), fără acces → refuz
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_j := ofertare_coada_opreste('ingest', v_lic_act);
  EXECUTE 'RESET ROLE';
  IF (v_j ->> 'oprite')::int IS DISTINCT FROM 1 OR (SELECT activ FROM ofertare_ingest_coada WHERE licitatie_id = v_lic_act) IS DISTINCT FROM false THEN RAISE EXCEPTION 'TEST6f oprire'; END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_strain, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM ofertare_coada_opreste('acoperire', v_lic_act);
    RAISE EXCEPTION 'TEST6f oprire fara acces';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE 'TEST6 OK (RPC: poarta, cerut_de = auth.uid(), oprire)';

  -- (7) tick-ul extragerii: x-intern-secret + poarta pe cerut_de, cheia anon nu mai e singura autentificare; politicile de scriere scoase
  IF pg_get_functiondef('public.ofertare_extragere_tick()'::regprocedure) !~ 'x-intern-secret'
     OR pg_get_functiondef('public.ofertare_extragere_tick()'::regprocedure) !~ 'fn_ofertare_poate_cheltui\(c\.licitatie_id, c\.cerut_de\)' THEN
    RAISE EXCEPTION 'TEST7 tick fara secret / poarta';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
               AND tablename IN ('ofertare_acoperire_coada', 'ofertare_clarificari_coada', 'ofertare_extragere_coada', 'ofertare_ingest_coada')
               AND cmd <> 'SELECT') THEN RAISE EXCEPTION 'TEST7 politici de scriere ramase'; END IF;
  RAISE NOTICE 'TEST7 OK';
END $t$;
