-- Dry-run 20261104a (rulat de chat prin run_mig dry; NU de sesiunile de cod): aplică migrarea, testează FIECARE ramură a precedenței,
-- paritatea banner / alertă / revalidare, RPC-ul ca rol `authenticated` (owner, non-owner cu Ofertare, fără Ofertare) și separarea pe
-- licitații, aplică revenirea și verifică md5-ul vechi — totul ÎNTR-UN SINGUR bloc DO terminat cu RAISE EXCEPTION (nimic nu rămâne).
-- Corpul migrării și al revenirii se lipesc exact în locurile marcate (MIG / RB).
-- r2 (review #834 r1): textele referențiate de proveniențe se creează întâi (FK (licitatie_id, sha256) → ofertare_doc_texte); stările
-- respectă CHECK-ul real al status_procesare; cazurile noi pentru „text verificat” (recitire ulterioară / text_confirmat / revocare).
DO $do$
DECLARE
  r text := ''; ok boolean := true; n int; i int; v_id bigint; v_id3 bigint; v_stare text; v_alerta boolean; v_dec bigint;
  ids bigint[] := '{}'; exp_stare text[]; exp_alerta boolean[];
  v_owner uuid := (SELECT id FROM profiles WHERE is_owner = true ORDER BY id LIMIT 1);
  v_cu uuid := '10c105d3-536d-4ca6-b943-803592626909';     -- non-owner, cu user_module_access 'ofertare' (verificat read-only, 21.10)
  v_fara uuid := '133ab7a1-a9fc-4341-803d-4a4211ae86ee';   -- non-owner, fără Ofertare
  -- [nume, status_procesare, analiza, text, proveniențe pe sha-ul curent în ordine ('ocr' / 'tr' / '-'), ocr pe un text VECHI?,
  --  text_confirmat ('-' / 'activ' / 'revocat'), stare așteptată]
  cazuri text[][] := ARRAY[
    ['ignorat_cu_ocr',            'ignorat',    NULL,                     'T1 20261104a', 'ocr',    'nu', '-',       'citit'],
    ['ocr_curent_procesat',       'procesat',   '{"citire_noi":{"x":1}}', 'T2 20261104a', 'ocr',    'nu', '-',       'text_neverificat'],
    ['ocr_curent_partial',        'partial',    NULL,                     'T3 20261104a', 'ocr',    'nu', '-',       'text_neverificat'],
    ['ocr_pe_text_vechi',         'procesat',   '{"citire_noi":{"x":1}}', 'T4 20261104a', '-',      'da', '-',       'citit'],
    ['ocr_apoi_transcriere',      'procesat',   '{"citire_noi":{"x":1}}', 'T5 20261104a', 'ocr,tr', 'nu', '-',       'citit'],
    ['transcriere_apoi_ocr',      'procesat',   '{"citire_noi":{"x":1}}', 'T6 20261104a', 'tr,ocr', 'nu', '-',       'text_neverificat'],
    ['ocr_text_confirmat',        'procesat',   NULL,                     'T7 20261104a', 'ocr',    'nu', 'activ',   'perechi_necitite'],
    ['ocr_text_confirmat_revocat','procesat',   NULL,                     'T8 20261104a', 'ocr',    'nu', 'revocat', 'text_neverificat'],
    ['partial',                   'partial',    NULL,                     'T9 20261104a', '-',      'nu', '-',       'partial'],
    ['procesat_cu_perechi',       'procesat',   '{"citire_noi":{"x":1}}', 'TA 20261104a', '-',      'nu', '-',       'citit'],
    ['procesat_perechi_goale',    'procesat',   '{"citire_noi":[]}',      'TB 20261104a', '-',      'nu', '-',       'citit'],
    ['procesat_fara_analiza',     'procesat',   NULL,                     'TC 20261104a', '-',      'nu', '-',       'perechi_necitite'],
    ['procesat_citire_null',      'procesat',   '{"citire_noi":null}',    'TD 20261104a', '-',      'nu', '-',       'perechi_necitite'],
    ['procesat_alta_analiza',     'procesat',   '{"rezumat":"x"}',        'TE 20261104a', '-',      'nu', '-',       'perechi_necitite'],
    ['neprocesat',                'neprocesat', NULL,                     'TF 20261104a', '-',      'nu', '-',       'necitit'],
    ['in_lucru',                  'in_lucru',   NULL,                     'TG 20261104a', '-',      'nu', '-',       'necitit'],
    ['eroare',                    'eroare',     NULL,                     'TH 20261104a', '-',      'nu', '-',       'necitit'],
    ['status_null',               NULL,         NULL,                     'TI 20261104a', '-',      'nu', '-',       'necitit']];
  v_sha text; v_prov text;
BEGIN
  PERFORM set_config('gazpet.livrare_migrare', '20261104a_ofertare_rc_stare_precedenta:' || txid_current(), true);
  EXECUTE $mig$:MIG$mig$;

  FOR i IN 1 .. array_length(cazuri, 1) LOOP
    INSERT INTO ofertare_documente_atribuire (licitatie_id, fisier_path, nume_original, tip, status_procesare, analiza, text_extras)
    VALUES (15, 'test/20261104a/' || cazuri[i][1] || '.pdf', 'TEST 20261104a ' || cazuri[i][1], 'raspuns_clarificare',
            cazuri[i][2], cazuri[i][3]::jsonb, cazuri[i][4]) RETURNING id INTO v_id;
    v_sha := encode(sha256(convert_to(cazuri[i][4], 'UTF8')), 'hex');
    -- textul referențiat de proveniențe (FK), pe sha-ul curent și pe cel „vechi”
    INSERT INTO ofertare_doc_texte (licitatie_id, sha256, text) VALUES (15, v_sha, cazuri[i][4]) ON CONFLICT DO NOTHING;
    IF cazuri[i][5] <> '-' THEN
      FOREACH v_prov IN ARRAY string_to_array(cazuri[i][5], ',') LOOP
        INSERT INTO ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine)
        VALUES (15, v_id, v_sha, CASE v_prov WHEN 'ocr' THEN 'ocr_local_neverificat' ELSE 'transcriere' END, 'test', 'integral');
      END LOOP;
    END IF;
    IF cazuri[i][6] = 'da' THEN
      INSERT INTO ofertare_doc_texte (licitatie_id, sha256, text) VALUES (15, encode(sha256(convert_to('text vechi 20261104a', 'UTF8')), 'hex'), 'text vechi 20261104a')
        ON CONFLICT DO NOTHING;
      INSERT INTO ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine)
      VALUES (15, v_id, encode(sha256(convert_to('text vechi 20261104a', 'UTF8')), 'hex'), 'ocr_local_neverificat', 'test', 'integral');
    END IF;
    IF cazuri[i][7] <> '-' THEN
      INSERT INTO ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, decizie, motiv, decis_de, decis_la)
      VALUES (15, v_id, v_sha, 'text_confirmat', 'test 20261104a', v_owner, now()) RETURNING id INTO v_dec;
      IF cazuri[i][7] = 'revocat' THEN
        INSERT INTO ofertare_cant_doc_decizii (licitatie_id, document_id, doc_sha256, decizie, revoca_id, motiv, decis_de, decis_la)
        VALUES (15, v_id, v_sha, 'revocare', v_dec, 'test 20261104a', v_owner, now());
      END IF;
    END IF;
    ids := ids || v_id;
    v_stare := public.ofertare_rc_doc_stare(v_id);
    v_alerta := public.ofertare_rc_doc_necitit(v_id);
    IF v_stare IS DISTINCT FROM cazuri[i][8] THEN ok := false; r := r || format('FAIL %s: %s (astept %s); ', cazuri[i][1], v_stare, cazuri[i][8]); END IF;
    IF v_alerta IS DISTINCT FROM (cazuri[i][8] IN ('necitit', 'perechi_necitite', 'text_neverificat')) THEN
      ok := false; r := r || format('FAIL paritate %s; ', cazuri[i][1]);
    END IF;
  END LOOP;
  r := r || format('ramuri=%s; ', array_length(cazuri, 1));

  -- alt tip de document sau inexistent → stare NULL, nu în alertă
  INSERT INTO ofertare_documente_atribuire (licitatie_id, fisier_path, nume_original, tip, status_procesare)
  VALUES (15, 'test/20261104a/alt_tip.pdf', 'TEST 20261104a alt tip', 'formular', 'neprocesat') RETURNING id INTO v_id;
  IF public.ofertare_rc_doc_stare(v_id) IS NOT NULL OR public.ofertare_rc_doc_necitit(v_id) OR public.ofertare_rc_doc_stare(-1) IS NOT NULL
     OR public.ofertare_rc_doc_necitit(-1) THEN ok := false; r := r || 'FAIL alt_tip / inexistent; '; END IF;

  -- revalidarea dinaintea mailului folosește aceeași regulă
  SELECT count(*) INTO n FROM public.ofertare_alerta_rc_necitite_acum(ids);
  IF n <> (SELECT count(*) FROM unnest(ids) d WHERE public.ofertare_rc_doc_necitit(d)) THEN ok := false; r := r || 'FAIL revalidare; '; END IF;
  r := r || format('in_alerta=%s; ', n);

  -- separarea licitațiilor: un document de test pe licitația 3 nu apare în RPC-ul licitației 15
  INSERT INTO ofertare_documente_atribuire (licitatie_id, fisier_path, nume_original, tip, status_procesare)
  VALUES (3, 'test/20261104a/lic3.pdf', 'TEST 20261104a lic3', 'raspuns_clarificare', 'neprocesat') RETURNING id INTO v_id3;

  -- RPC-ul ca rol `authenticated` (current_user schimbat, nu doar claims) — owner, non-owner cu Ofertare: vede exact starea + in_alerta
  -- funcțiilor comune, doar pe licitația cerută
  -- valorile așteptate se calculează ÎNAINTE de schimbarea rolului (authenticated nu are EXECUTE pe funcțiile interne)
  SELECT array_agg(public.ofertare_rc_doc_stare(d) ORDER BY o), array_agg(public.ofertare_rc_doc_necitit(d) ORDER BY o)
    INTO exp_stare, exp_alerta FROM unnest(ids) WITH ORDINALITY u(d, o);
  FOR i IN 1 .. 2 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', CASE i WHEN 1 THEN v_owner ELSE v_cu END, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO n FROM public.ofertare_rc_stari(15) s JOIN unnest(ids, exp_stare, exp_alerta) e(d, st, al) ON e.d = s.id
      WHERE s.stare IS NOT DISTINCT FROM e.st AND s.in_alerta IS NOT DISTINCT FROM e.al;
    IF n <> array_length(ids, 1) THEN ok := false; r := r || format('FAIL banner[%s] %s/%s; ', i, n, array_length(ids, 1)); END IF;
    IF EXISTS (SELECT 1 FROM public.ofertare_rc_stari(15) s WHERE s.id = v_id3) THEN ok := false; r := r || format('FAIL separare[%s]; ', i); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ofertare_rc_stari(3) s WHERE s.id = v_id3) THEN ok := false; r := r || format('FAIL lic3[%s]; ', i); END IF;
    -- funcția internă nu e apelabilă din API
    BEGIN
      PERFORM public.ofertare_rc_doc_stare(ids[1]);
      ok := false; r := r || format('FAIL doc_stare apelabil[%s]; ', i);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    EXECUTE 'RESET ROLE';
  END LOOP;
  -- fără Ofertare și fără utilizator → refuz (ca rol authenticated)
  FOR i IN 1 .. 2 LOOP
    PERFORM set_config('request.jwt.claims', CASE i WHEN 1 THEN json_build_object('sub', v_fara, 'role', 'authenticated')::text ELSE '{}' END, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.ofertare_rc_stari(15);
      ok := false; r := r || format('FAIL refuz[%s]; ', i);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    EXECUTE 'RESET ROLE';
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{}', true);
  r := r || format('anon_rpc=%s; ', has_function_privilege('anon', 'public.ofertare_rc_stari(bigint)', 'EXECUTE'));

  -- revenirea: exact funcția veche, funcțiile noi scoase
  PERFORM set_config('gazpet.revenire_20261104a', 'RC_REGULA_VECHE:' || txid_current(), true);
  EXECUTE $rb$:RB$rb$;
  IF NOT (md5(pg_get_functiondef('public.ofertare_rc_doc_necitit(bigint)'::regprocedure)) = '76d9d9e390034133fe6aa8bd1fd116b1'
          AND to_regprocedure('public.ofertare_rc_doc_stare(bigint)') IS NULL AND to_regprocedure('public.ofertare_rc_stari(bigint)') IS NULL) THEN
    ok := false; r := r || 'FAIL revenire; ';
  END IF;
  RAISE EXCEPTION 'REZULTAT %: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r;
END
$do$;
