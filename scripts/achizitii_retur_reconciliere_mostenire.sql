-- Achiziții retur (20270110a): reconcilierea MOȘTENIRII — atribuirea intrărilor vechi (mișcări intrare_achizitie legate doar de COMANDĂ,
-- ref_tip = 'comanda_furnizor') liniilor comenzii (spec §3.3b). NERULAT. Cere migrarea 20270110a aplicată.
-- DML pe date reale: modul `aplica` se rulează DOAR după preview + „da”-ul owner-ului (CLAUDE.md pct. 3), de chat, pe clonă întâi, apoi pe producție.
--
-- Rulare (ca postgres; psql ≥ 13):
--   preview (doar citire, nimic scris):   psql -X -v ON_ERROR_STOP=1 -v mod=preview -f scripts/achizitii_retur_reconciliere_mostenire.sql
--   aplica (o tranzacție, COMMIT la final): psql -X -v ON_ERROR_STOP=1 -v mod=aplica -v sistem=<system_identifier al țintei> \
--                                            -f scripts/achizitii_retur_reconciliere_mostenire.sql
--   `sistem` = pg_control_system().system_identifier al bazei pe care vrei să scrii (clona SAU producția): o țintă greșită = refuz, nimic scris.
--
-- Regulile (o singură definiție: vederea temporară v_mostenire, folosită identic de preview și de aplica; dovada de recepție = funcția migrării):
--   * „fara_miscari”: comanda nu are nicio intrare veche și linia are intrata_stoc = 0 → marcaj true, contor neatins;
--   * „fara_miscari_pe_reper”: comanda are intrări vechi, dar toate grupurile lor (denumire + UM normalizate: trim + lower) au exact o linie, iar
--     aceasta nu e printre ele și are intrata_stoc = 0 → marcaj true, contor neatins (marfa ei n-a intrat);
--   * „atribuibila”: exact O linie a comenzii are denumirea + UM grupului (gemeni = 1), niciun grup al comenzii nu e fără linie, iar suma
--     mișcărilor grupului <= primita efectivă (primita; NULL cu dovadă de recepție = cantitatea; NULL fără dovadă = 0) → intrata_stoc = suma,
--     marcaj true;
--   * orice altceva = AMBIGUĂ (listată cu motivul): linii gemene, un grup de mișcări fără linie pe comandă, suma peste primit, contor > 0 fără
--     mișcări. Rămân nereconciliate: le reconciliază un om, din ecran (fn_cf_reconciliaza_linie, owner).
-- Lock-uri (aplica): comenzi_furnizor_linii SHARE ROW EXCLUSIVE + stocuri_miscari SHARE (ordinea L06: linii → mișcări), luate ÎNAINTEA calculului,
--   lock_timeout 2 s: o recepție / un retur în curs termină întâi; nimic nu se poate scrie pe linii / mișcări între calcul și UPDATE.
-- Revenirea scrierii: ieșirea modului aplica listează (id, intrata_stoc înainte, după) pentru fiecare linie atinsă (JSON).
\set ON_ERROR_STOP 1
\if :{?mod}
\else
  \echo 'lipseste -v mod=preview|aplica'
  \quit
\endif
SELECT :'mod' = 'aplica' AS mod_aplica, :'mod' IN ('preview', 'aplica') AS mod_valid \gset
\if :mod_valid
\else
  \echo 'mod invalid (preview | aplica)'
  \quit
\endif
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '2s';
DO $g$
BEGIN
  IF to_regprocedure('public.fn_cf_dovada_receptie_intern(public.comenzi_furnizor_linii, public.comenzi_furnizor)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor_linii'::regclass AND a.attname = 'intrare_reconciliata' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'mostenire: migrarea 20270110a nu e aplicata';
  END IF;
END $g$;
\if :mod_aplica
\if :{?sistem}
\else
  \echo 'modul aplica cere -v sistem=<system_identifier al tintei>'
  \quit
\endif
SELECT set_config('mostenire.sistem', :'sistem', true);
DO $g$
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM current_setting('mostenire.sistem', true) THEN
    RAISE EXCEPTION 'mostenire: tinta gresita (system_identifier % <> %); nimic scris', (SELECT system_identifier FROM pg_control_system()), current_setting('mostenire.sistem', true);
  END IF;
END $g$;
LOCK TABLE public.comenzi_furnizor_linii IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.stocuri_miscari IN SHARE MODE;
\endif

CREATE TEMP VIEW v_mostenire AS
WITH miscari AS (
  SELECT m.ref_id AS cf_id, lower(btrim(m.material_denumire)) AS den_n, coalesce(lower(btrim(m.um)), '') AS um_n, sum(m.delta) AS suma, count(*) AS nr
    FROM public.stocuri_miscari m WHERE m.tip = 'intrare_achizitie' AND m.ref_tip = 'comanda_furnizor' GROUP BY 1, 2, 3
), toate_liniile AS (
  SELECT l.comanda_furnizor_id AS cf_id, lower(btrim(l.denumire)) AS den_n, coalesce(lower(btrim(l.um)), '') AS um_n, count(*) AS gemeni
    FROM public.comenzi_furnizor_linii l GROUP BY 1, 2, 3
), comenzi_cu_orfane AS (
  SELECT DISTINCT m.cf_id FROM miscari m
   WHERE NOT EXISTS (SELECT 1 FROM toate_liniile t WHERE t.cf_id = m.cf_id AND t.den_n = m.den_n AND t.um_n = m.um_n)
), linii AS (
  SELECT l.id, l.comanda_furnizor_id AS cf_id, cf.numar_comanda, l.denumire, l.um, l.cantitate, l.cantitate_primita, l.cantitate_intrata_stoc,
         CASE WHEN l.cantitate_primita IS NOT NULL THEN l.cantitate_primita
              WHEN public.fn_cf_dovada_receptie_intern(l, cf) THEN l.cantitate ELSE 0 END AS primita_efectiva,
         lower(btrim(l.denumire)) AS den_n, coalesce(lower(btrim(l.um)), '') AS um_n
    FROM public.comenzi_furnizor_linii l JOIN public.comenzi_furnizor cf ON cf.id = l.comanda_furnizor_id
   WHERE NOT l.intrare_reconciliata
)
SELECT li.id AS linie_id, li.cf_id, li.numar_comanda, li.denumire, li.um, li.primita_efectiva, li.cantitate_intrata_stoc AS intrata_acum, mi.suma, mi.nr AS nr_miscari,
       t.gemeni,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM miscari m WHERE m.cf_id = li.cf_id) AND li.cantitate_intrata_stoc = 0 THEN 'fara_miscari'
         WHEN NOT EXISTS (SELECT 1 FROM miscari m WHERE m.cf_id = li.cf_id) THEN 'ambigua_contor_fara_miscari'
         WHEN li.cf_id IN (SELECT o.cf_id FROM comenzi_cu_orfane o) THEN 'ambigua_miscari_fara_linie'
         WHEN t.gemeni > 1 THEN 'ambigua_linii_gemene'
         WHEN mi.suma IS NULL AND li.cantitate_intrata_stoc = 0 THEN 'fara_miscari_pe_reper'
         WHEN mi.suma IS NULL THEN 'ambigua_contor_fara_miscari'
         WHEN mi.suma > li.primita_efectiva THEN 'ambigua_peste_primit'
         ELSE 'atribuibila'
       END AS clasa
  FROM linii li
  JOIN toate_liniile t ON t.cf_id = li.cf_id AND t.den_n = li.den_n AND t.um_n = li.um_n
  LEFT JOIN miscari mi ON mi.cf_id = li.cf_id AND mi.den_n = li.den_n AND mi.um_n = li.um_n;

\echo '== liniile nereconciliate, pe clase =='
SELECT clasa, count(*) AS linii, count(DISTINCT cf_id) AS comenzi, sum(suma) AS suma_miscari FROM v_mostenire GROUP BY clasa ORDER BY clasa;
\echo '== atribuibile: contorul de acum fata de suma miscarilor vechi (diferentele) =='
SELECT linie_id, numar_comanda, denumire, um, primita_efectiva, intrata_acum, suma AS intrata_noua FROM v_mostenire
 WHERE clasa = 'atribuibila' AND intrata_acum IS DISTINCT FROM suma ORDER BY numar_comanda, linie_id;
\echo '== ambigue (de reconciliat de un om) =='
SELECT linie_id, numar_comanda, denumire, um, primita_efectiva, intrata_acum, suma, nr_miscari, gemeni, clasa FROM v_mostenire
 WHERE clasa LIKE 'ambigua%' ORDER BY numar_comanda, linie_id;

\if :mod_aplica
SET LOCAL app.cf_cantitati = '1';
\echo '== aplica: atribuibile (intrata_stoc = suma, marcaj) =='
WITH v AS (SELECT linie_id, intrata_acum, suma FROM v_mostenire WHERE clasa = 'atribuibila'),
     u AS (UPDATE public.comenzi_furnizor_linii l SET cantitate_intrata_stoc = v.suma, intrare_reconciliata = true FROM v
            WHERE l.id = v.linie_id AND NOT l.intrare_reconciliata
            RETURNING l.id, v.intrata_acum AS inainte, l.cantitate_intrata_stoc AS dupa)
SELECT count(*) AS linii, json_agg(u ORDER BY u.id) AS revenire FROM u;
\echo '== aplica: fara intrari vechi (doar marcajul) =='
WITH v AS (SELECT linie_id FROM v_mostenire WHERE clasa IN ('fara_miscari', 'fara_miscari_pe_reper')),
     u AS (UPDATE public.comenzi_furnizor_linii l SET intrare_reconciliata = true FROM v
            WHERE l.id = v.linie_id AND NOT l.intrare_reconciliata AND l.cantitate_intrata_stoc = 0
            RETURNING l.id)
SELECT count(*) AS linii, array_agg(u.id ORDER BY u.id) AS revenire FROM u;
SET LOCAL app.cf_cantitati = '';
\echo '== control dupa (ramase nereconciliate = ambiguele) =='
SELECT clasa, count(*) FROM v_mostenire GROUP BY clasa ORDER BY clasa;
DROP VIEW v_mostenire;
COMMIT;
\else
ROLLBACK;
\endif
