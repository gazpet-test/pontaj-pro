-- Teste DRY 20261124a, rulate ÎN tranzacția de probă (se anulează). Identități reale din bază, fără date noi persistate.
DO $t$
DECLARE
  v_owner uuid := (SELECT id FROM profiles WHERE is_owner LIMIT 1);
  v_admin uuid := (SELECT u.profile_id FROM user_module_access u JOIN profiles p ON p.id = u.profile_id
                    WHERE u.module = 'ofertare' AND u.access_level = 'admin' AND NOT COALESCE(p.is_owner, false) LIMIT 1);
  v_editor uuid := (SELECT u.profile_id FROM user_module_access u JOIN profiles p ON p.id = u.profile_id
                     WHERE u.module = 'ofertare' AND u.access_level = 'editor' AND NOT COALESCE(p.is_owner, false)
                       AND u.profile_id NOT IN (SELECT profile_id FROM user_module_access WHERE module = 'ofertare' AND access_level = 'admin') LIMIT 1);
  v_strain uuid;
  r record; n_activ int := 0;
BEGIN
  -- (1) A: cele 3 licitații active, responsabilii vechi (setat_de NULL) trec; owner trece; un străin nu
  FOR r IN SELECT id, responsabil_id FROM ofertare_licitatii WHERE termen_depunere >= current_date AND responsabil_id IS NOT NULL LOOP
    IF NOT fn_ofertare_poate_cheltui(r.id, r.responsabil_id) THEN RAISE EXCEPTION 'TEST1 responsabil vechi refuzat pe %', r.id; END IF;
    IF NOT fn_ofertare_poate_cheltui(r.id, v_owner) THEN RAISE EXCEPTION 'TEST1 owner refuzat pe %', r.id; END IF;
    v_strain := (SELECT id FROM profiles WHERE id <> r.responsabil_id AND NOT COALESCE(is_owner, false) LIMIT 1);
    IF fn_ofertare_poate_cheltui(r.id, v_strain) THEN RAISE EXCEPTION 'TEST1 strain trece pe %', r.id; END IF;
    n_activ := n_activ + 1;
  END LOOP;
  RAISE NOTICE 'TEST1 OK (% licitatii active)', n_activ;
  -- parametri nuli
  IF fn_ofertare_poate_cheltui(NULL, v_owner) OR fn_ofertare_poate_cheltui(95, NULL) THEN RAISE EXCEPTION 'TEST2 null trece'; END IF;
  RAISE NOTICE 'TEST2 OK';
  -- (3) renumire prin trigger, ca utilizatorul autentificat: editorul se numește singur -> refuz; numit de editor -> refuz; de admin / owner -> trece
  IF v_editor IS NULL OR v_admin IS NULL THEN RAISE EXCEPTION 'TEST3 lipsesc identitati (editor %, admin %)', v_editor, v_admin; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  UPDATE ofertare_licitatii SET responsabil_id = v_editor WHERE id = 95;
  IF (SELECT responsabil_setat_de FROM ofertare_licitatii WHERE id = 95) IS DISTINCT FROM v_editor THEN RAISE EXCEPTION 'TEST3 trigger nu a scris setat_de'; END IF;
  IF fn_ofertare_poate_cheltui(95, v_editor) THEN RAISE EXCEPTION 'TEST3 autoatribuit trece'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  UPDATE ofertare_licitatii SET responsabil_id = NULL WHERE id = 95;
  UPDATE ofertare_licitatii SET responsabil_id = v_editor WHERE id = 95;
  IF NOT fn_ofertare_poate_cheltui(95, v_editor) THEN RAISE EXCEPTION 'TEST3 numit de admin refuzat'; END IF;
  -- responsabil 2 numit de editor (non-admin) -> refuz
  v_strain := (SELECT id FROM profiles WHERE id NOT IN (v_editor, v_admin, v_owner) AND NOT COALESCE(is_owner, false) LIMIT 1);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  UPDATE ofertare_licitatii SET responsabil2_id = v_strain WHERE id = 95;
  IF fn_ofertare_poate_cheltui(95, v_strain) THEN RAISE EXCEPTION 'TEST3 r2 numit de editor trece'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  UPDATE ofertare_licitatii SET responsabil2_id = NULL WHERE id = 95;
  UPDATE ofertare_licitatii SET responsabil2_id = v_strain WHERE id = 95;
  IF NOT fn_ofertare_poate_cheltui(95, v_strain) THEN RAISE EXCEPTION 'TEST3 r2 numit de owner refuzat'; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE 'TEST3 OK';
  -- (4) drepturi: doar service_role execută funcția nouă
  IF has_function_privilege('authenticated', 'public.fn_ofertare_poate_cheltui(bigint,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ofertare_poate_cheltui(bigint,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_ofertare_poate_cheltui(bigint,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST4 drepturi gresite';
  END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;
