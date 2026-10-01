-- ════════════════════════════════════════════════════════════════════════════
-- #540: decizia B a lui Răzvan (01.10.2026): dezactivăm tokenurile /co ale celor 12 angajați plecați.
-- DATE REALE. NU e migrare și NU se rulează automat.
-- Ordinea: (1) preview → (2) confirmarea explicită a lui Răzvan → (3) bloc DO cu gărzi → (4) sanity check.
-- r3 (după NO-GO Copilot pe fb4477ca): gardă pe setul GLOBAL, FOR UPDATE, fingerprint md5(token) pentru rollback.
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

-- (3) APPLY (r3, după NO-GO Copilot pe fb4477ca): un singur bloc DO. Toate gărzile, inclusiv sanity-ul GLOBAL, sunt aici.
--     Orice abatere ⇒ RAISE ⇒ se anulează tot (nimic modificat).
DO $dml540$
DECLARE
  -- perechi APROBATE (employee_id:termination_date), exact cele din preview-ul confirmat de Răzvan
  c_aprobat CONSTANT text := '17:2026-09-11,23:2026-07-20,32:2026-09-01,36:2026-07-31,46:2026-08-07,47:2026-09-01,57:2026-09-25,62:2026-09-07,79:2026-07-11,151:2026-07-20,155:2026-09-01,156:2026-07-16';
  c_ids CONSTANT int[] := ARRAY[17,23,32,36,46,47,57,62,79,151,155,156];
  v_set text; v_n bigint; v_glob bigint; v_fp text; v_fp_n bigint; v_post text;
BEGIN
  -- a) hardening: blochează cele 12 rânduri din employees și din hr_concediu_tokens (ordonat după id), ÎNAINTE de precheck
  PERFORM 1 FROM public.employees WHERE id = ANY (c_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.hr_concediu_tokens WHERE employee_id = ANY (c_ids) ORDER BY employee_id FOR UPDATE;

  -- b) precheck GLOBAL: TOATE tokenurile active ale angajaților plecați (fără filtru pe c_ids) = exact cele 12 perechi
  SELECT string_agg(t.employee_id || ':' || coalesce(e.termination_date::text, 'NULL'), ',' ORDER BY t.employee_id)
    INTO v_set
    FROM public.hr_concediu_tokens t JOIN public.employees e ON e.id = t.employee_id
   WHERE t.activ IS TRUE AND e.active IS FALSE;
  IF v_set IS DISTINCT FROM c_aprobat THEN
    RAISE EXCEPTION 'DML 540: setul GLOBAL de tokenuri active la plecați ≠ cele 12 perechi aprobate — nu modific nimic'
      USING DETAIL = 'găsit: ' || coalesce(v_set, '<niciunul>');
  END IF;
  IF EXISTS (SELECT 1 FROM public.employees WHERE id = ANY (c_ids) AND (termination_date IS NULL OR termination_date > CURRENT_DATE)) THEN
    RAISE EXCEPTION 'DML 540: există încetări viitoare sau NULL printre cele 12 — refuz';
  END IF;

  -- c) fingerprint (md5 al tokenului; tokenul în clar NU iese din bază)
  SELECT string_agg(employee_id || ':' || md5(token), ',' ORDER BY employee_id), count(*)
    INTO v_fp, v_fp_n
    FROM public.hr_concediu_tokens WHERE employee_id = ANY (c_ids) AND activ IS TRUE;
  IF v_fp_n IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'DML 540: fingerprint pe % rânduri (aștept 12)', v_fp_n; END IF;

  -- d) UPDATE
  UPDATE public.hr_concediu_tokens t SET activ = false
    FROM public.employees e
   WHERE e.id = t.employee_id AND t.employee_id = ANY (c_ids) AND t.activ IS TRUE
     AND e.active IS FALSE AND e.termination_date <= CURRENT_DATE;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'DML 540: ROW_COUNT = % (aștept 12) — se anulează tot', v_n; END IF;

  -- e) postcondiție: sanity GLOBAL (0 tokenuri active la plecați) + cele 12 sunt tot plecați, cu aceleași date + inactive
  SELECT count(*) INTO v_glob
    FROM public.hr_concediu_tokens t JOIN public.employees e ON e.id = t.employee_id
   WHERE t.activ IS TRUE AND e.active IS FALSE;
  IF v_glob IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'DML 540: după UPDATE rămân % tokenuri active la plecați', v_glob; END IF;
  SELECT string_agg(t.employee_id || ':' || coalesce(e.termination_date::text, 'NULL'), ',' ORDER BY t.employee_id)
    INTO v_post
    FROM public.hr_concediu_tokens t JOIN public.employees e ON e.id = t.employee_id
   WHERE t.employee_id = ANY (c_ids) AND t.activ IS FALSE AND e.active IS FALSE AND e.termination_date <= CURRENT_DATE;
  IF v_post IS DISTINCT FROM c_aprobat THEN
    RAISE EXCEPTION 'DML 540: postcondiție — cele 12 nu mai sunt (plecați + inactivi + aceleași date)' USING DETAIL = coalesce(v_post, '<niciunul>');
  END IF;

  RAISE NOTICE 'DML 540 OK: dezactivate % tokenuri', v_n;
  RAISE NOTICE 'DML 540 FINGERPRINT (copiază EXACT în rollback): %', v_fp;   -- employee_id:md5(token), fără token în clar
END $dml540$;

-- (4) Informativ (sanity-ul care contează e deja în bloc): așteptat 0 / 105.
SELECT count(*) FILTER (WHERE t.activ AND e.active IS FALSE) AS active_la_plecati,
       count(*) FILTER (WHERE t.activ)                        AS active_total
  FROM public.hr_concediu_tokens t JOIN public.employees e ON e.id = t.employee_id;

-- ROLLBACK DE DATE: VALABIL DOAR IMEDIAT DUPĂ RULARE ȘI DUPĂ REVERIFICARE, doar la cererea lui Răzvan.
-- Reactivează DOAR rândurile al căror employee_id:md5(token) coincide cu FINGERPRINT-ul din NOTICE (tokenul exact,
-- nu un token reemis între timp). Orice altă stare ⇒ refuz, se reanalizează.
-- Înainte de rulare: înlocuiește '<FINGERPRINT>' cu textul EXACT din NOTICE.
-- DO $rb540$
-- DECLARE c_fp CONSTANT text := '<FINGERPRINT>';
--         v_fp text[] := string_to_array(c_fp, ',');
--         v_n bigint;
-- BEGIN
--   IF cardinality(v_fp) IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'Rollback 540: fingerprint invalid (% intrări)', cardinality(v_fp); END IF;
--   PERFORM 1 FROM public.hr_concediu_tokens WHERE employee_id || ':' || md5(token) = ANY (v_fp) ORDER BY employee_id FOR UPDATE;
--   IF (SELECT count(*) FROM public.hr_concediu_tokens WHERE employee_id || ':' || md5(token) = ANY (v_fp) AND activ IS FALSE) IS DISTINCT FROM 12 THEN
--     RAISE EXCEPTION 'Rollback 540: tokenurile nu mai sunt exact cele dezactivate (reemise/modificate) — refuz';
--   END IF;
--   UPDATE public.hr_concediu_tokens SET activ = true WHERE employee_id || ':' || md5(token) = ANY (v_fp) AND activ IS FALSE;
--   GET DIAGNOSTICS v_n = ROW_COUNT;
--   IF v_n IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'Rollback 540: ROW_COUNT = %', v_n; END IF;
-- END $rb540$;
