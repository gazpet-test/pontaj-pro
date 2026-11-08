-- Dry-run 20261132a (rulat de chat prin run_mig dry pe clonă; NU de sesiunile de cod): aplică migrarea, testează cine poate trece o licitație
-- în 'abandonata', apoi aplică revenirea, verifică dispariția obiectelor și re-aplică migrarea — totul ÎNTR-UN SINGUR bloc DO terminat cu
-- RAISE EXCEPTION (nimic nu rămâne). Corpul migrării și al revenirii se lipesc exact în locurile marcate (MIG / RB, MIG2 = MIG).
-- Identități ca în PostgREST: request.jwt.claims cu sub + role authenticated (auth.uid() citește claims).
-- Licitațiile de test se creează aici; nu se atinge nicio licitație reală.
DO $do$
DECLARE
  r text := ''; ok boolean := true; x record;
  v_owner uuid := (SELECT id FROM profiles WHERE is_owner = true ORDER BY id LIMIT 1);
  v_a uuid := '10c105d3-536d-4ca6-b943-803592626909';     -- non-owner (același din dry-run-ul 20261121a)
  v_b uuid := '133ab7a1-a9fc-4341-803d-4a4211ae86ee';     -- non-owner
  l_trecut bigint; l_viitor bigint; l_ident bigint; l_autonumit bigint; l_owner bigint;
  cod text;
BEGIN
  PERFORM set_config('gazpet.livrare_migrare', '20261132a_ofertare_inchidere_garda:' || txid_current(), true);
  EXECUTE $mig$:MIG$mig$;

  -- fixture (ca owner): responsabilul A numit de owner (dovada = true de trigger-ul de numire), termen trecut / viitor
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-T', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_trecut;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-V', 'test', 'test 20261132a', 'in_lucru', now() + interval '3 days', v_a) RETURNING id INTO l_viitor;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-I', 'test', 'test 20261132a', 'identificata', now() - interval '3 days', v_a) RETURNING id INTO l_ident;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere)
  VALUES ('TEST-20261132-O', 'test', 'test 20261132a', 'go', now() + interval '10 days') RETURNING id INTO l_owner;
  -- autonumit: A se numește singur (dovada de numire = false prin trigger-ul existent) → fără drept
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-S', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_autonumit;

  -- R1 (regresie/flux legitim): responsabilul numit închide după termen o licitație cu GO
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  BEGIN UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_trecut; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  IF cod <> 'ok' THEN ok := false; r := r || 'FAIL R1 responsabil dupa termen (' || cod || '); '; END IF;

  -- P1: responsabilul numit, ÎNAINTE de termen → refuz 42501
  BEGIN UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_viitor; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  IF cod <> '42501' THEN ok := false; r := r || 'FAIL P1 inainte de termen (' || cod || '); '; END IF;

  -- P2: licitație fără GO (identificata), chiar cu termen trecut → doar ownerul
  BEGIN UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_ident; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  IF cod <> '42501' THEN ok := false; r := r || 'FAIL P2 identificata (' || cod || '); '; END IF;

  -- P3: un coleg care nu e responsabil → refuz
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  BEGIN UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_autonumit; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  IF cod <> '42501' THEN ok := false; r := r || 'FAIL P3 necoleg (' || cod || '); '; END IF;

  -- P4: responsabil autonumit (fără dovadă de numire) → refuz
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  BEGIN UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_autonumit; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  IF cod <> '42501' THEN ok := false; r := r || 'FAIL P4 autonumit (' || cod || '); '; END IF;

  -- R2: ownerul închide oricând (NO-GO înainte de termen) și orice licitație fără GO
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  BEGIN UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_owner; UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_ident; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  IF cod <> 'ok' THEN ok := false; r := r || 'FAIL R2 owner (' || cod || '); '; END IF;

  -- R3: celelalte tranziții nu sunt atinse (responsabilul trece go → in_lucru și editează observațiile)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  BEGIN UPDATE ofertare_licitatii SET observatii = 'nota test' WHERE id = l_viitor; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  IF cod <> 'ok' THEN ok := false; r := r || 'FAIL R3 alte coloane (' || cod || '); '; END IF;

  -- R4: fără identitate, într-o sesiune care nu e postgres → nu se poate testa aici (dry-run-ul rulează ca postgres); consemnat.
  -- Revenirea + re-aplicarea
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('gazpet.livrare_migrare', '20261132a_ofertare_inchidere_garda_ROLLBACK:' || txid_current(), true);
  EXECUTE $rb$:RB$rb$;
  IF to_regprocedure('public.fn_ofertare_inchidere_garda()') IS NOT NULL THEN ok := false; r := r || 'FAIL revenire functie; '; END IF;
  PERFORM set_config('gazpet.livrare_migrare', '20261132a_ofertare_inchidere_garda:' || txid_current(), true);
  EXECUTE $mig2$:MIG$mig2$;
  IF to_regprocedure('public.fn_ofertare_inchidere_garda()') IS NULL THEN ok := false; r := r || 'FAIL re-aplicare; '; END IF;

  RAISE EXCEPTION 'DRYRUN 20261132a: % %', CASE WHEN ok THEN 'TOATE OK' ELSE 'ESEC' END, r;
END
$do$;
