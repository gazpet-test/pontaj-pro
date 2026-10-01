-- ════════════════════════════════════════════════════════════════════════════
-- #540: decizia B a lui Răzvan (01.10.2026): dezactivăm tokenurile /co ale celor 12 angajați plecați.
-- DATE REALE. NU e migrare și NU se rulează automat.
-- Ordinea: (1) preview → (2) confirmarea explicită a lui Răzvan → (3) bloc DO cu gărzi → (4) sanity check.
-- r2 (după NO-GO Copilot): gărzile sunt acum în SQL (perechi fixe, ROW_COUNT = 12, stare finală), iar rollback-ul e restrâns.
-- Tabela hr_concediu_tokens n-are coloană id: cheia e employee_id (PK).
-- Edge-ul concediu-mobil acceptă doar tokenurile cu activ = true, așa că după UPDATE linkurile /co ale celor 12 nu mai merg.
-- Lista de mai jos e citită read-only pe live la 01.10.2026. Dacă preview-ul nu mai dă EXACT aceste 12 rânduri, ne oprim.
--   79  NGUYEN VAN PHUNG          2026-07-11  |  156 NASTASE MARIUS CRISTIAN    2026-07-16
--   23  BUCSAIN LAURENTIU ADELIN  2026-07-20  |  151 PANATIE COSMIN IOAN        2026-07-20
--   36  CURCA ANDREEA ALEXANDRA   2026-07-31  |  46  DUMITRU MARIAN             2026-08-07
--   32  CODITA CORNELIU CRISTIAN  2026-09-01  |  47  EBETIUC EUGEN IONEL        2026-09-01
--   155 BUTUCAN NICOLAE MARIUS    2026-09-01  |  62  KUSHWAHA SHRIRAM           2026-09-07
--   17  BAIESU DARIUS OVIDIU      2026-09-11  |  57  IOAN SORIN ALEXANDRU       2026-09-25
-- ════════════════════════════════════════════════════════════════════════════

-- (1) PREVIEW (read-only). Tokenul NU se afișează întreg.
SELECT t.employee_id, e.name, e.termination_date, e.active, left(t.token, 6) || '…' AS token_prefix, t.activ, t.created_at::date
  FROM public.hr_concediu_tokens t JOIN public.employees e ON e.id = t.employee_id
 WHERE t.activ AND e.active IS FALSE
 ORDER BY e.termination_date NULLS LAST, t.employee_id;
-- Așteptat: 12 rânduri, exact employee_id = {17,23,32,36,46,47,57,62,79,151,155,156}.

-- (2) Confirmarea lui Răzvan.

-- (3) APPLY (r2, după NO-GO Copilot): un singur bloc DO, toate gărzile sunt în SQL. Orice abatere ⇒ RAISE ⇒ nu se modifică nimic.
DO $dml540$
DECLARE
  -- perechi APROBATE (employee_id, termination_date), exact cele din preview-ul confirmat de Răzvan
  c_aprobat CONSTANT text := '17:2026-09-11,23:2026-07-20,32:2026-09-01,36:2026-07-31,46:2026-08-07,47:2026-09-01,57:2026-09-25,62:2026-09-07,79:2026-07-11,151:2026-07-20,155:2026-09-01,156:2026-07-16';
  c_ids CONSTANT int[] := ARRAY[17,23,32,36,46,47,57,62,79,151,155,156];
  v_set text; v_n bigint; v_ramase bigint; v_ids int[];
BEGIN
  -- a) recitește setul: tokenuri ACTIVE ale angajaților plecați, cu încetarea deja produsă (UPDATE-ul de mai jos reaplică aceleași condiții, iar ROW_COUNT + starea finală prind orice cursă)
  SELECT string_agg(t.employee_id || ':' || e.termination_date, ',' ORDER BY t.employee_id)
    INTO v_set
    FROM public.hr_concediu_tokens t JOIN public.employees e ON e.id = t.employee_id
   WHERE t.employee_id = ANY (c_ids) AND t.activ IS TRUE
     AND e.active IS FALSE AND e.termination_date IS NOT NULL AND e.termination_date <= CURRENT_DATE;
  IF v_set IS DISTINCT FROM c_aprobat THEN
    RAISE EXCEPTION 'DML 540: setul recitit ≠ cele 12 perechi aprobate (employee_id:termination_date) — nu modific nimic'
      USING DETAIL = 'găsit: ' || coalesce(v_set, '<niciunul>');
  END IF;
  -- b) UPDATE exact pe aceleași condiții
  UPDATE public.hr_concediu_tokens t SET activ = false
    FROM public.employees e
   WHERE e.id = t.employee_id AND t.employee_id = ANY (c_ids) AND t.activ IS TRUE
     AND e.active IS FALSE AND e.termination_date <= CURRENT_DATE;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION 'DML 540: ROW_COUNT = % (aștept 12) — se anulează tot', v_n;
  END IF;
  -- c) starea finală: niciunul dintre cele 12 nu mai e activ
  SELECT count(*) FILTER (WHERE activ IS TRUE), array_agg(employee_id ORDER BY employee_id) FILTER (WHERE activ IS FALSE)
    INTO v_ramase, v_ids FROM public.hr_concediu_tokens WHERE employee_id = ANY (c_ids);
  IF v_ramase IS DISTINCT FROM 0 OR v_ids IS DISTINCT FROM c_ids THEN
    RAISE EXCEPTION 'DML 540: stare finală greșită (active rămase = %, dezactivate = %) — se anulează tot', v_ramase, v_ids;
  END IF;
  RAISE NOTICE 'DML 540 OK: dezactivate % tokenuri; ids_rollback = %', v_n, v_ids;  -- NOTEAZĂ ids_rollback
END $dml540$;

-- (4) SANITY CHECK (după)
SELECT count(*) FILTER (WHERE t.activ AND e.active IS FALSE) AS active_la_plecati,  -- așteptat 0
       count(*) FILTER (WHERE t.activ)                        AS active_total        -- așteptat 105 (117 - 12)
  FROM public.hr_concediu_tokens t JOIN public.employees e ON e.id = t.employee_id;

-- ROLLBACK DE DATE: VALABIL DOAR IMEDIAT DUPĂ RULARE ȘI DUPĂ REVERIFICARE. Se rulează doar la cererea lui Răzvan.
-- Restaurează DOAR id-urile din ids_rollback (NOTICE-ul pasului 3) și doar dacă tokenurile sunt EXACT cele din momentul
-- dezactivării (același token, încă inactiv). Dacă între timp s-a reemis/modificat ceva → refuz, se reanalizează.
-- Înainte de rulare: înlocuiește ARRAY[...] cu ids_rollback EXACT din NOTICE.
-- DO $rb540$
-- DECLARE c_ids CONSTANT int[] := ARRAY[17,23,32,36,46,47,57,62,79,151,155,156];  -- = ids_rollback din NOTICE
--         v_n bigint;
-- BEGIN
--   IF (SELECT count(*) FROM public.hr_concediu_tokens WHERE employee_id = ANY (c_ids) AND activ IS FALSE) IS DISTINCT FROM cardinality(c_ids) THEN
--     RAISE EXCEPTION 'Rollback 540: starea nu mai e cea de imediat după DML — refuz';
--   END IF;
--   UPDATE public.hr_concediu_tokens SET activ = true WHERE employee_id = ANY (c_ids) AND activ IS FALSE;
--   GET DIAGNOSTICS v_n = ROW_COUNT;
--   IF v_n IS DISTINCT FROM cardinality(c_ids) THEN RAISE EXCEPTION 'Rollback 540: ROW_COUNT = %', v_n; END IF;
-- END $rb540$;
