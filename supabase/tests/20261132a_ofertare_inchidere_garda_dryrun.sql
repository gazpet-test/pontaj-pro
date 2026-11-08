-- Dry-run 20261132a (rulat de chat prin run_mig dry pe clonă; NU de sesiunile de cod): aplică migrarea, testează cine poate trece o licitație
-- în 'abandonata', apoi aplică revenirea, verifică dispariția obiectelor și re-aplică migrarea — totul ÎNTR-UN SINGUR bloc DO terminat cu
-- RAISE EXCEPTION (nimic nu rămâne). Corpul migrării și al revenirii se lipesc exact în locurile marcate (:MIG / :RB; :MIG de două ori).
-- Înainte: amprentele __MD5_LA_DRY__* din migrare se completează cu md5(pg_get_functiondef(...)) citite pe clonă.
-- Identități ca în PostgREST (review Jakarinos #1027 r3 P2, L20/L25): fixture-ul se creează ca postgres cu claims de owner, dar
-- FIECARE caz de test rulează sub SET LOCAL ROLE authenticated + request.jwt.claims (RLS și garda a00 se aplică exact ca prin API).
-- Licitațiile de test se creează aici; nu se atinge nicio licitație reală.
DO $do$
DECLARE
  r text := ''; ok boolean := true;
  v_owner uuid := (SELECT id FROM profiles WHERE is_owner = true ORDER BY id LIMIT 1);
  v_a uuid := '10c105d3-536d-4ca6-b943-803592626909';     -- non-owner cu acces Ofertare (același din dry-run-ul 20261121a)
  v_b uuid := '133ab7a1-a9fc-4341-803d-4a4211ae86ee';     -- non-owner
  l_trecut bigint; l_viitor bigint; l_ident bigint; l_autonumit bigint; l_owner bigint; l_r2 bigint; l_go bigint;
  cod text;
BEGIN
  PERFORM set_config('gazpet.livrare_migrare', '20261132a_ofertare_inchidere_garda:' || txid_current(), true);
  EXECUTE $mig$:MIG$mig$;

  -- ── fixture (ca owner): responsabilii numiți de owner (dovada = true prin trigger-ul de numire existent) ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-T', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_trecut;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-V', 'test', 'test 20261132a', 'in_lucru', now() + interval '3 days', v_a) RETURNING id INTO l_viitor;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-I', 'test', 'test 20261132a', 'identificata', now() - interval '3 days', v_a) RETURNING id INTO l_ident;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere)
  VALUES ('TEST-20261132-O', 'test', 'test 20261132a', 'go', now() + interval '10 days') RETURNING id INTO l_owner;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil2_id)
  VALUES ('TEST-20261132-R2', 'test', 'test 20261132a', 'go', now() - interval '1 day', v_a) RETURNING id INTO l_r2;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-G', 'test', 'test 20261132a', 'go', now() + interval '5 days', v_a) RETURNING id INTO l_go;
  -- autonumit: A se numește singur (dovada de numire = false prin trigger-ul existent) → fără drept
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id)
  VALUES ('TEST-20261132-S', 'test', 'test 20261132a', 'in_lucru', now() - interval '3 days', v_a) RETURNING id INTO l_autonumit;
  IF (SELECT responsabil_numitor_autorizat FROM ofertare_licitatii WHERE id = l_autonumit) IS NOT FALSE
     OR (SELECT responsabil_numitor_autorizat FROM ofertare_licitatii WHERE id = l_trecut) IS NOT TRUE
     OR (SELECT responsabil2_numitor_autorizat FROM ofertare_licitatii WHERE id = l_r2) IS NOT TRUE THEN
    ok := false; r := r || 'FAIL fixture dovada de numire; ';
  END IF;

  -- ── cazuri, toate ca authenticated (SET LOCAL ROLE în sub-tranzacție; la eroare rolul revine odată cu rollback-ul ei) ──
  -- R1 (flux legitim): responsabilul 1 numit închide după termen, cu UPDATE-ul COMBINAT din UI (status + observații + updated_at)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  BEGIN EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE ofertare_licitatii SET status = 'abandonata', observatii = coalesce(observatii || E'\n', '') || '[test] Nedepusă după termen: proba', updated_at = now() WHERE id = l_trecut;
    EXECUTE 'RESET ROLE'; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  IF cod <> 'ok' OR (SELECT status FROM ofertare_licitatii WHERE id = l_trecut) <> 'abandonata' THEN ok := false; r := r || 'FAIL R1 responsabil 1 dupa termen (' || cod || '); '; END IF;

  -- R1b: responsabilul 2 numit, după termen, pe o licitație cu GO
  BEGIN EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE ofertare_licitatii SET status = 'abandonata', updated_at = now() WHERE id = l_r2; EXECUTE 'RESET ROLE'; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  IF cod <> 'ok' THEN ok := false; r := r || 'FAIL R1b responsabil 2 (' || cod || '); '; END IF;

  -- P1: responsabilul numit, ÎNAINTE de termen → 42501
  BEGIN EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_viitor; EXECUTE 'RESET ROLE'; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  IF cod <> '42501' THEN ok := false; r := r || 'FAIL P1 inainte de termen (' || cod || '); '; END IF;

  -- P2: licitație fără GO (identificata), cu termen trecut → doar ownerul
  BEGIN EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_ident; EXECUTE 'RESET ROLE'; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  IF cod <> '42501' THEN ok := false; r := r || 'FAIL P2 identificata (' || cod || '); '; END IF;

  -- P4: responsabil autonumit (fără dovadă de numire) → refuz
  BEGIN EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_autonumit; EXECUTE 'RESET ROLE'; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  IF cod <> '42501' THEN ok := false; r := r || 'FAIL P4 autonumit (' || cod || '); '; END IF;

  -- R3: celelalte tranziții nu sunt atinse — responsabilul trece go → in_lucru și editează observațiile
  BEGIN EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE ofertare_licitatii SET status = 'in_lucru', updated_at = now() WHERE id = l_go;
    UPDATE ofertare_licitatii SET observatii = 'nota test' WHERE id = l_viitor;
    EXECUTE 'RESET ROLE'; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  IF cod <> 'ok' OR (SELECT status FROM ofertare_licitatii WHERE id = l_go) <> 'in_lucru' THEN ok := false; r := r || 'FAIL R3 alte tranzitii (' || cod || '); '; END IF;

  -- P3: un coleg care nu e responsabil → refuz (indiferent de termen)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  BEGIN EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_autonumit; EXECUTE 'RESET ROLE'; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  -- 42501 de la garda nouă sau de la RLS / a00 (dacă v_b n-are acces Ofertare) — oricare înseamnă refuz; 0 rânduri = refuz tăcut, verificat mai jos
  IF cod = 'ok' AND (SELECT status FROM ofertare_licitatii WHERE id = l_autonumit) = 'abandonata' THEN ok := false; r := r || 'FAIL P3 necoleg a reusit; '; END IF;

  -- R2: ownerul închide oricând (NO-GO înainte de termen) și o licitație fără GO
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  BEGIN EXECUTE 'SET LOCAL ROLE authenticated';
    UPDATE ofertare_licitatii SET status = 'abandonata', decizie_go = 'no_go', decizie_motivare = 'test', updated_at = now() WHERE id = l_owner;
    UPDATE ofertare_licitatii SET status = 'abandonata' WHERE id = l_ident;
    EXECUTE 'RESET ROLE'; cod := 'ok';
  EXCEPTION WHEN OTHERS THEN cod := SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  IF cod <> 'ok' THEN ok := false; r := r || 'FAIL R2 owner (' || cod || '); '; END IF;

  -- ── revenire + re-aplicare ──
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
