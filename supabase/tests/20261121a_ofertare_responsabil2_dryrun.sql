-- Dry-run 20261121a (rulat de chat prin run_mig dry; NU de sesiunile de cod): aplică migrarea, testează coloanele, trigger-ul „cine a numit”,
-- CHECK-ul R2 ≠ R1, destinatarii alertei RC necitit și alerta „fără responsabil” pe licitații de test (ambii / doar R2 / niciunul),
-- view-ul, apoi aplică revenirea și verifică md5-urile vechi — totul ÎNTR-UN SINGUR bloc DO terminat cu RAISE EXCEPTION (nimic nu rămâne).
-- Corpul migrării și al revenirii se lipesc exact în locurile marcate (MIG / RB). Notă: funcțiile de alertă rulează și pe licitațiile reale
-- (notificări / amprente) — totul se anulează la final.
DO $do$
DECLARE
  r text := ''; ok boolean := true; n int; x record;
  v_owner uuid := (SELECT id FROM profiles WHERE is_owner = true ORDER BY id LIMIT 1);
  v_owneri uuid[] := (SELECT array_agg(id ORDER BY id) FROM profiles WHERE is_owner = true);
  v_a uuid := '10c105d3-536d-4ca6-b943-803592626909';     -- non-owner (verificat read-only)
  v_b uuid := '133ab7a1-a9fc-4341-803d-4a4211ae86ee';     -- non-owner
  la bigint; lb bigint; lc bigint; ld bigint; le bigint;
  azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
BEGIN
  PERFORM set_config('gazpet.livrare_migrare', '20261121a_ofertare_responsabil2:' || txid_current(), true);
  EXECUTE $mig$:MIG$mig$;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- licitații de test: A = R1 + R2 (doc de 2 zile → și ownerii), C = doar R2 (doc de ieri, depunere peste 4 zile → fără owneri),
  -- B = niciunul (doc de ieri, depunere peste 4 zile → ownerii), D = niciunul fără RC (alerta „fără responsabil”),
  -- E = R1 = owner, R2 = v_b (doc de ieri: ownerul primește o singură dată, ca R1)
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id, responsabil2_id)
  VALUES ('TEST-20261121-A', 'test', 'test 20261121a', 'go', now() + interval '4 days', v_a, v_b) RETURNING id INTO la;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil2_id)
  VALUES ('TEST-20261121-C', 'test', 'test 20261121a', 'go', now() + interval '4 days', v_a) RETURNING id INTO lc;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere)
  VALUES ('TEST-20261121-B', 'test', 'test 20261121a', 'go', now() + interval '4 days') RETURNING id INTO lb;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere)
  VALUES ('TEST-20261121-D', 'test', 'test 20261121a', 'go', now() + interval '4 days') RETURNING id INTO ld;
  INSERT INTO ofertare_licitatii (nr_anunt, autoritate, obiect, status, termen_depunere, responsabil_id, responsabil2_id)
  VALUES ('TEST-20261121-E', 'test', 'test 20261121a', 'go', now() + interval '4 days', v_owner, v_b) RETURNING id INTO le;

  -- trigger-ul „cine a numit”: la INSERT = apelantul, pentru ambii; NULL când responsabilul lipsește
  SELECT * INTO x FROM ofertare_licitatii WHERE id = la;
  IF x.responsabil_setat_de IS DISTINCT FROM v_owner OR x.responsabil2_setat_de IS DISTINCT FROM v_owner THEN ok := false; r := r || 'FAIL setat_de insert; '; END IF;
  SELECT * INTO x FROM ofertare_licitatii WHERE id = lb;
  IF x.responsabil2_setat_de IS NOT NULL THEN ok := false; r := r || 'FAIL setat_de null; '; END IF;
  -- schimbarea DOAR a lui R2 schimbă doar responsabil2_setat_de; o scriere directă a coloanei e ignorată
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  UPDATE ofertare_licitatii SET responsabil2_id = v_owner, responsabil2_setat_de = v_b WHERE id = lc;
  SELECT * INTO x FROM ofertare_licitatii WHERE id = lc;
  IF x.responsabil2_setat_de IS DISTINCT FROM v_a OR x.responsabil_setat_de IS NOT NULL THEN ok := false; r := r || 'FAIL setat_de update; '; END IF;
  UPDATE ofertare_licitatii SET responsabil2_setat_de = v_b, obiect = 'test 20261121a' WHERE id = lc;
  IF (SELECT responsabil2_setat_de FROM ofertare_licitatii WHERE id = lc) IS DISTINCT FROM v_a THEN ok := false; r := r || 'FAIL setat_de falsificat; '; END IF;
  UPDATE ofertare_licitatii SET responsabil2_id = v_a WHERE id = lc;   -- înapoi la scenariul C (doar R2 = v_a)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- review Jakarinos P2: cine poate scrie R2 = cine poate scrie R1. Poarta de scriere (fn_ofertare_licitatii_scriere) NU e atinsă de migrare
  -- și compară TOT rândul pentru service_role / financiar (to_jsonb(OLD) - … vs to_jsonb(NEW) - …), deci acoperă și coloanele noi fără
  -- modificare. O sesiune neprivilegiată nu se poate emula aici (session_user = postgres trece prin excepția administrativă) — se verifică
  -- static că poarta e neschimbată.
  IF md5(pg_get_functiondef('public.fn_ofertare_licitatii_scriere()'::regprocedure)) IS DISTINCT FROM '081cd829e8400001e1c31ea6e6506a8f'
     OR position('(to_jsonb(OLD) - ''termen_depunere''' IN pg_get_functiondef('public.fn_ofertare_licitatii_scriere()'::regprocedure)) = 0
     OR position('(to_jsonb(OLD) - ''contract_id''' IN pg_get_functiondef('public.fn_ofertare_licitatii_scriere()'::regprocedure)) = 0 THEN
    ok := false; r := r || 'FAIL poarta scriere; ';
  END IF;

  -- CHECK: R2 nu poate fi aceeași persoană cu R1
  BEGIN
    UPDATE ofertare_licitatii SET responsabil2_id = v_a WHERE id = la;
    ok := false; r := r || 'FAIL check R2=R1; ';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- RC necitit: un răspuns neprocesat pe A (de 2 zile), B, C, E (de ieri)
  INSERT INTO ofertare_documente_atribuire (licitatie_id, fisier_path, nume_original, tip, status_procesare, created_at)
  SELECT l, 'test/20261121a/' || l || '.pdf', 'TEST 20261121a ' || l, 'raspuns_clarificare', 'neprocesat',
         CASE WHEN l = la THEN now() - interval '2 days' ELSE now() - interval '1 day' END
  FROM unnest(ARRAY[la, lb, lc, le]) l;
  PERFORM public.ofertare_alerta_rc_necitit();
  FOR x IN SELECT * FROM (VALUES
      (la, (SELECT array_agg(DISTINCT u ORDER BY u) FROM unnest(ARRAY[v_a, v_b] || v_owneri) u)),
      (lc, ARRAY[v_a]),
      (lb, v_owneri),
      -- E: doc de ieri, 4 zile — ownerul doar ca R1, o singură dată
      (le, (SELECT array_agg(DISTINCT u ORDER BY u) FROM unnest(ARRAY[v_owner, v_b]) u))) t(lic, astept) LOOP
    IF (SELECT array_agg(profile_id ORDER BY profile_id) FROM notifications
        WHERE type = 'critical' AND title LIKE '%TEST-20261121-%' AND title LIKE '%' || (SELECT nr_anunt FROM ofertare_licitatii WHERE id = x.lic) || '%')
       IS DISTINCT FROM x.astept THEN
      ok := false; r := r || format('FAIL rc destinatari lic %s; ', x.lic);
    END IF;
  END LOOP;
  -- dedup: niciun destinatar de două ori pe aceeași licitație
  IF EXISTS (SELECT 1 FROM notifications WHERE title LIKE '%TEST-20261121-%' GROUP BY title, profile_id HAVING count(*) > 1) THEN
    ok := false; r := r || 'FAIL dedup; ';
  END IF;

  -- „fără responsabil” doar când lipsesc AMBII: D (niciunul) da, C (doar R2) nu
  PERFORM public.ofertare_alerte_atentie(14);
  IF NOT EXISTS (SELECT 1 FROM ofertare_alerte_amprenta WHERE licitatie_id = ld AND fel = 'fara_responsabil')
     OR EXISTS (SELECT 1 FROM ofertare_alerte_amprenta WHERE licitatie_id IN (lc, la, le) AND fel = 'fara_responsabil') THEN
    ok := false; r := r || 'FAIL fara_responsabil; ';
  END IF;

  -- view-ul arată ambii
  IF NOT EXISTS (SELECT 1 FROM v_ofertare_dashboard v WHERE v.id = la AND v.responsabil_id = v_a AND v.responsabil2_id = v_b
                 AND v.responsabil2_nume IS NOT DISTINCT FROM (SELECT name FROM profiles WHERE id = v_b)) THEN
    ok := false; r := r || 'FAIL view; ';
  END IF;
  r := r || format('notif_test=%s; ', (SELECT count(*) FROM notifications WHERE title LIKE '%TEST-20261121-%'));
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- revenirea: exact funcțiile + view-ul vechi, coloanele scoase (datele de test sunt încă în tabel — coloanele se scot cu tot cu ele)
  PERFORM set_config('gazpet.revenire_20261121a', 'RESPONSABIL2_SCOS:' || txid_current(), true);
  EXECUTE $rb$:RB$rb$;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_licitatii' AND column_name LIKE 'responsabil2%')
     OR md5(pg_get_functiondef('public.ofertare_alerta_rc_necitit()'::regprocedure)) IS DISTINCT FROM '069c87b6b8a5f99ae86466d1bba365bc' THEN
    ok := false; r := r || 'FAIL revenire; ';
  END IF;
  -- review Copilot #903 P2-06 / r6 P2-02: rezerva conține EXACT valorile sursă pentru A, C, E (R2 + cine l-a numit) și nimic pentru B, D
  IF (SELECT count(*) FROM public._bak_20261121a_responsabil2 b
      JOIN (VALUES (la, v_b, v_owner), (lc, v_a, v_a), (le, v_b, v_owner)) e(lic, r2, setat) ON e.lic = b.licitatie_id
      WHERE b.responsabil2_id = e.r2 AND b.responsabil2_setat_de = e.setat AND b.revenire_txid = txid_current()) <> 3
     OR EXISTS (SELECT 1 FROM public._bak_20261121a_responsabil2 WHERE licitatie_id IN (lb, ld))
     OR has_table_privilege('authenticated', 'public._bak_20261121a_responsabil2', 'SELECT') OR has_table_privilege('anon', 'public._bak_20261121a_responsabil2', 'SELECT') THEN
    ok := false; r := r || 'FAIL rezerva R2; ';
  END IF;
  -- review Jakarinos P2: ciclul complet apply → revenire → RE-apply (preflight-ul trebuie să treacă din nou pe starea restaurată)
  EXECUTE $mig$:MIG$mig$;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_licitatii' AND column_name LIKE 'responsabil2%') <> 2 THEN
    ok := false; r := r || 'FAIL re-apply; ';
  END IF;
  r := r || 'reapply=ok; ';
  RAISE EXCEPTION 'REZULTAT %: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r;
END
$do$;
