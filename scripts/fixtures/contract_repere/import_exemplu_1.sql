-- Import fișa contractului (executie_contract_repere) — generat de scripts/contract_repere_import_sql.mjs din exemplu_1.json (sha256 9b093b75e35f2ac95303387544e656a3d2fb51749e74cd2dc28ca896861576a9).
-- 6 rânduri. Rulează DOAR ca postgres, în tranzacția operatorului, DUPĂ: SELECT set_config('gazpet.import_contract_proiect', '<id>', true);
-- Garda: proiectul există și executie_proiecte.nume ~* '.'. Upsert pe (proiect_id, sectiune, cod); rândurile modificate din aplicație
-- (modificat_de nenul) NU se suprascriu; nimic nu se șterge; reluarea e idempotentă. Ordinea lock-urilor: advisory pe proiect, apoi rândurile
-- (aceeași ca fn_executie_contract_salveaza).
DO $imp$
DECLARE
  v_txt text := current_setting('gazpet.import_contract_proiect', true);
  v_p bigint;
  v_scrise integer;
  v_sarite text;
  v_extra text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'import contract: rulează ca postgres'; END IF;
  IF v_txt IS NULL OR v_txt !~ '^[0-9]{1,18}$' THEN RAISE EXCEPTION 'import contract: setează întâi gazpet.import_contract_proiect'; END IF;
  v_p := v_txt::bigint;
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = v_p AND nume ~* '.') THEN
    RAISE EXCEPTION 'import contract: proiectul % nu există sau nu e cel așteptat', v_p;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('executie_contract_repere:' || v_p, 0));
  DROP TABLE IF EXISTS pg_temp._imp_contract;
  CREATE TEMP TABLE _imp_contract (sectiune text, cod text, ordine integer, titlu text, clauze text, continut text, citat text, conditie text, dovezi text, dovezi_lipsa text, termen_text text, efect text, data_eveniment date, notificare text, raspuns text, stare text, termen_urmator date, termen_ce text, putere text, sursa text) ON COMMIT DROP;
  INSERT INTO _imp_contract (sectiune, cod, ordine, titlu, clauze, continut, citat, conditie, dovezi, dovezi_lipsa, termen_text, efect, data_eveniment, notificare, raspuns, stare, termen_urmator, termen_ce, putere, sursa) VALUES
    ('clauza', 'A01', 10, 'Clauză fictivă de test', '1.1', 'Text fictiv cu apostrof: l''eau și „ghilimele”.', 'Citat fictiv', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::date, NULL::text, NULL::text, NULL::text, NULL::date, NULL::text, NULL::text, 'Document fictiv p.1'),
    ('cale', 'B01', 10, 'Cale fictivă', '35.1 (i)', 'Aplicare fictivă', NULL::text, 'Condiție fictivă', 'Dovezi fictive', NULL::text, '30 de zile', 'Doar timp.', NULL::date, NULL::text, NULL::text, NULL::text, NULL::date, NULL::text, NULL::text, 'Document fictiv p.2'),
    ('termen', 'T01', 10, 'Termen fictiv', '69a.1', 'Explicație fictivă', NULL::text, NULL::text, NULL::text, NULL::text, '30 de zile', NULL::text, NULL::date, NULL::text, NULL::text, NULL::text, NULL::date, NULL::text, NULL::text, 'Document fictiv p.3'),
    ('eveniment', 'E01', 10, 'Eveniment fictiv deschis', '38.5', 'Fapt fictiv', NULL::text, NULL::text, 'Dovadă fictivă', 'Lipsă fictivă', NULL::text, '0–7 zile', '2026-01-15'::date, 'Nr. fictiv', '—', 'de_notificat', '2026-02-14'::date, 'Notificare fictivă', 'medie', 'Mail fictiv'),
    ('eveniment', 'E02', 20, 'Eveniment fictiv închis', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::date, NULL::text, NULL::text, 'inchis', NULL::date, NULL::text, NULL::text, NULL::text),
    ('sursa', 'S01', 10, 'Sursă fictivă', NULL::text, 'Conținut fictiv', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::date, NULL::text, NULL::text, NULL::text, NULL::date, NULL::text, NULL::text, 'Cale fictivă');
  -- rândurile modificate din aplicație care diferă de fișier: rămân cum le-a lăsat utilizatorul
  SELECT string_agg(t.sectiune || ':' || t.cod, ', ' ORDER BY t.sectiune, t.cod) INTO v_sarite
    FROM public.executie_contract_repere t JOIN _imp_contract s ON s.sectiune = t.sectiune AND s.cod = t.cod
   WHERE t.proiect_id = v_p AND t.modificat_de IS NOT NULL AND (t.ordine, t.titlu, t.clauze, t.continut, t.citat, t.conditie, t.dovezi, t.dovezi_lipsa, t.termen_text, t.efect, t.data_eveniment, t.notificare, t.raspuns, t.stare, t.termen_urmator, t.termen_ce, t.putere, t.sursa) IS DISTINCT FROM (s.ordine, s.titlu, s.clauze, s.continut, s.citat, s.conditie, s.dovezi, s.dovezi_lipsa, s.termen_text, s.efect, s.data_eveniment, s.notificare, s.raspuns, s.stare, s.termen_urmator, s.termen_ce, s.putere, s.sursa);
  INSERT INTO public.executie_contract_repere AS t (proiect_id, sectiune, cod, ordine, titlu, clauze, continut, citat, conditie, dovezi, dovezi_lipsa, termen_text, efect, data_eveniment, notificare, raspuns, stare, termen_urmator, termen_ce, putere, sursa)
  SELECT v_p, s.sectiune, s.cod, s.ordine, s.titlu, s.clauze, s.continut, s.citat, s.conditie, s.dovezi, s.dovezi_lipsa, s.termen_text, s.efect, s.data_eveniment, s.notificare, s.raspuns, s.stare, s.termen_urmator, s.termen_ce, s.putere, s.sursa FROM _imp_contract s ORDER BY s.sectiune, s.cod
  ON CONFLICT (proiect_id, sectiune, cod) DO UPDATE SET
    ordine = EXCLUDED.ordine,
    titlu = EXCLUDED.titlu,
    clauze = EXCLUDED.clauze,
    continut = EXCLUDED.continut,
    citat = EXCLUDED.citat,
    conditie = EXCLUDED.conditie,
    dovezi = EXCLUDED.dovezi,
    dovezi_lipsa = EXCLUDED.dovezi_lipsa,
    termen_text = EXCLUDED.termen_text,
    efect = EXCLUDED.efect,
    data_eveniment = EXCLUDED.data_eveniment,
    notificare = EXCLUDED.notificare,
    raspuns = EXCLUDED.raspuns,
    stare = EXCLUDED.stare,
    termen_urmator = EXCLUDED.termen_urmator,
    termen_ce = EXCLUDED.termen_ce,
    putere = EXCLUDED.putere,
    sursa = EXCLUDED.sursa
  WHERE t.modificat_de IS NULL AND (t.ordine, t.titlu, t.clauze, t.continut, t.citat, t.conditie, t.dovezi, t.dovezi_lipsa, t.termen_text, t.efect, t.data_eveniment, t.notificare, t.raspuns, t.stare, t.termen_urmator, t.termen_ce, t.putere, t.sursa) IS DISTINCT FROM (EXCLUDED.ordine, EXCLUDED.titlu, EXCLUDED.clauze, EXCLUDED.continut, EXCLUDED.citat, EXCLUDED.conditie, EXCLUDED.dovezi, EXCLUDED.dovezi_lipsa, EXCLUDED.termen_text, EXCLUDED.efect, EXCLUDED.data_eveniment, EXCLUDED.notificare, EXCLUDED.raspuns, EXCLUDED.stare, EXCLUDED.termen_urmator, EXCLUDED.termen_ce, EXCLUDED.putere, EXCLUDED.sursa);
  GET DIAGNOSTICS v_scrise = ROW_COUNT;
  SELECT string_agg(t.sectiune || ':' || t.cod, ', ' ORDER BY t.sectiune, t.cod) INTO v_extra
    FROM public.executie_contract_repere t
   WHERE t.proiect_id = v_p AND NOT EXISTS (SELECT 1 FROM _imp_contract s WHERE s.sectiune = t.sectiune AND s.cod = t.cod);
  RAISE NOTICE 'import contract: proiect %, % rânduri în fișier, % scrise (noi sau schimbate); sărite (modificate din aplicație): %; în BD, dar nu în fișier: %',
    v_p, 6, v_scrise, coalesce(v_sarite, '—'), coalesce(v_extra, '—');
END
$imp$;
