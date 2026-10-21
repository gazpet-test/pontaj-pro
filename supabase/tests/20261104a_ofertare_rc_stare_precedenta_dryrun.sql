-- Dry-run 20261104a (rulat de chat prin run_mig dry; NU de sesiunile de cod): aplică migrarea, testează FIECARE ramură a precedenței
-- și paritatea banner / alertă, aplică revenirea și verifică md5-ul vechi — totul ÎNTR-UN SINGUR bloc DO terminat cu RAISE EXCEPTION.
-- Corpul migrării și al revenirii se lipesc exact în locurile marcate (MIG / RB). Fixture: documente de test pe licitația 15, anulate.
DO $do$
DECLARE
  r text := ''; ok boolean := true; v_owner uuid; x record; n int;
  -- [nume, status_procesare, analiza, text, ocr pe textul curent?, ocr pe un text VECHI?, stare așteptată]
  cazuri text[][] := ARRAY[
    ['ignorat_cu_ocr',        'ignorat',    NULL,                          'T1', 'da', 'nu', 'citit'],
    ['ocr_curent_procesat',   'procesat',   '{"citire_noi":{"x":1}}',      'T2', 'da', 'nu', 'text_neverificat'],
    ['ocr_curent_partial',    'partial',    NULL,                          'T3', 'da', 'nu', 'text_neverificat'],
    ['ocr_pe_text_vechi',     'procesat',   '{"citire_noi":{"x":1}}',      'T4', 'nu', 'da', 'citit'],
    ['partial',               'partial',    NULL,                          'T5', 'nu', 'nu', 'partial'],
    ['procesat_cu_perechi',   'procesat',   '{"citire_noi":{"x":1}}',      'T6', 'nu', 'nu', 'citit'],
    ['procesat_perechi_goale','procesat',   '{"citire_noi":[]}',           'T7', 'nu', 'nu', 'citit'],
    ['procesat_fara_analiza', 'procesat',   NULL,                          'T8', 'nu', 'nu', 'perechi_necitite'],
    ['procesat_citire_null',  'procesat',   '{"citire_noi":null}',         'T9', 'nu', 'nu', 'perechi_necitite'],
    ['procesat_alta_analiza', 'procesat',   '{"rezumat":"x"}',             'TA', 'nu', 'nu', 'perechi_necitite'],
    ['neprocesat',            'neprocesat', NULL,                          'TB', 'nu', 'nu', 'necitit'],
    ['eroare',                'eroare',     NULL,                          'TC', 'nu', 'nu', 'necitit'],
    ['status_null',           NULL,         NULL,                          'TD', 'nu', 'nu', 'necitit'],
    ['status_necunoscut',     'stare_noua', NULL,                          'TE', 'nu', 'nu', 'necitit']];
  i int; v_id bigint; v_stare text; v_alerta boolean; ids bigint[] := '{}';
BEGIN
  PERFORM set_config('gazpet.livrare_migrare', '20261104a_ofertare_rc_stare_precedenta:' || txid_current(), true);
  EXECUTE $mig$:MIG$mig$;

  FOR i IN 1 .. array_length(cazuri, 1) LOOP
    INSERT INTO ofertare_documente_atribuire (licitatie_id, fisier_path, nume_original, tip, status_procesare, analiza, text_extras)
    VALUES (15, 'test/20261104a/' || cazuri[i][1] || '.pdf', 'TEST 20261104a ' || cazuri[i][1], 'raspuns_clarificare',
            cazuri[i][2], cazuri[i][3]::jsonb, cazuri[i][4]) RETURNING id INTO v_id;
    IF cazuri[i][5] = 'da' THEN
      INSERT INTO ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine)
      VALUES (15, v_id, encode(sha256(convert_to(cazuri[i][4], 'UTF8')), 'hex'), 'ocr_local_neverificat', 'test', 'integral');
    END IF;
    IF cazuri[i][6] = 'da' THEN
      INSERT INTO ofertare_doc_texte_prov (licitatie_id, document_id, sha256, origine, producator, completitudine)
      VALUES (15, v_id, encode(sha256(convert_to('text vechi', 'UTF8')), 'hex'), 'ocr_local_neverificat', 'test', 'integral');
    END IF;
    ids := ids || v_id;
    v_stare := public.ofertare_rc_doc_stare(v_id);
    v_alerta := public.ofertare_rc_doc_necitit(v_id);
    IF v_stare IS DISTINCT FROM cazuri[i][7] THEN ok := false; r := r || format('FAIL %s: %s (astept %s); ', cazuri[i][1], v_stare, cazuri[i][7]); END IF;
    -- paritate: alerta zilnică (necitit) = exact stările roșii ale bannerului
    IF v_alerta IS DISTINCT FROM (cazuri[i][7] IN ('necitit', 'perechi_necitite', 'text_neverificat')) THEN
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

  -- bannerul (RPC ofertare_rc_stari, ca utilizator cu acces Ofertare) întoarce EXACT starea funcției comune
  SELECT id INTO v_owner FROM profiles WHERE is_owner = true LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.ofertare_rc_stari(15) s WHERE s.id = ANY (ids) AND s.stare IS NOT DISTINCT FROM public.ofertare_rc_doc_stare(s.id);
  IF n <> array_length(ids, 1) THEN ok := false; r := r || format('FAIL banner %s/%s; ', n, array_length(ids, 1)); END IF;
  -- fără utilizator → refuz
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.ofertare_rc_stari(15);
    ok := false; r := r || 'FAIL rpc fara utilizator; ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  r := r || format('anon_rpc=%s auth_stare=%s; ', has_function_privilege('anon', 'public.ofertare_rc_stari(bigint)', 'EXECUTE'),
                   has_function_privilege('authenticated', 'public.ofertare_rc_doc_stare(bigint)', 'EXECUTE'));

  -- revenirea: exact funcția veche, funcțiile noi scoase
  PERFORM set_config('gazpet.revenire_20261104a', 'RC_REGULA_VECHE:' || txid_current(), true);
  EXECUTE $rb$:RB$rb$;
  ok := ok AND md5(pg_get_functiondef('public.ofertare_rc_doc_necitit(bigint)'::regprocedure)) = '76d9d9e390034133fe6aa8bd1fd116b1'
          AND to_regprocedure('public.ofertare_rc_doc_stare(bigint)') IS NULL AND to_regprocedure('public.ofertare_rc_stari(bigint)') IS NULL;
  RAISE EXCEPTION 'REZULTAT %: %', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r;
END
$do$;
