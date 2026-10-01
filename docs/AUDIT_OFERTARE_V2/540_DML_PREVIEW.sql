-- ════════════════════════════════════════════════════════════════════════════
-- #540: decizia B a lui Răzvan (01.10.2026): dezactivăm tokenurile /co ale celor 12 angajați plecați.
-- DATE REALE. NU e migrare și NU se rulează automat.
-- Ordinea: (1) preview → (2) confirmarea explicită a lui Răzvan → (3) UPDATE → (4) sanity check.
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

-- (3) APPLY: o singură tranzacție. Lista e fixată, iar garda cere exact 12 rânduri, altfel anulează tot.
BEGIN;
WITH upd AS (
  UPDATE public.hr_concediu_tokens t SET activ = false
    FROM public.employees e
   WHERE e.id = t.employee_id AND t.activ AND e.active IS FALSE
     AND t.employee_id = ANY (ARRAY[17,23,32,36,46,47,57,62,79,151,155,156])
  RETURNING t.employee_id
)
SELECT count(*) AS n, array_agg(employee_id ORDER BY employee_id) AS ids_rollback FROM upd;
-- Notează ids_rollback. Dacă n <> 12 → ROLLBACK; altfel → COMMIT;
-- COMMIT;

-- (4) SANITY CHECK
SELECT count(*) FILTER (WHERE t.activ AND e.active IS FALSE) AS active_la_plecati,  -- așteptat 0
       count(*) FILTER (WHERE t.activ)                        AS active_total        -- așteptat 105 (117 - 12)
  FROM public.hr_concediu_tokens t JOIN public.employees e ON e.id = t.employee_id;

-- ROLLBACK DE DATE (doar la cererea lui Răzvan): reactivează exact id-urile întoarse la pasul (3).
-- BEGIN;
-- UPDATE public.hr_concediu_tokens SET activ = true
--  WHERE employee_id = ANY (ARRAY[17,23,32,36,46,47,57,62,79,151,155,156]) AND activ = false
-- RETURNING employee_id;   -- așteptat 12
-- COMMIT;
