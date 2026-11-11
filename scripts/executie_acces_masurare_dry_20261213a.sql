-- DRY 20261213a cu măsurare, pe PRODUCȚIE (sau clonă), fără nimic rămas scris. r2 (11.11.2026): două tranzacții, blocarea plafonată.
--   1. ÎNAINTE — tranzacție READ ONLY (doar lock-urile citirilor, nu blochează pe nimeni): contul RESTRÂNS măsurat complet (count(*) de două
--      ori + EXPLAIN ANALYZE), contul NERESTRÂNS și OWNER-ul doar pe plan (EXPLAIN fără execuție: timpul de planificare și forma planului),
--      pe toate tabelele din inventar și pe bucket-urile Storage acoperite.
--   2. DUPĂ — exact ca livrarea: SET de sesiune 3000 ms ÎNAINTEA lui BEGIN (ceasul de tranzacție PostgreSQL 17 pornește la BEGIN), marcajele
--      (plafon + livrare), 20261213a aplicată, aceleași măsurători (restrânsul complet, nerestrânsul / owner-ul pe plan), ROLLBACK.
--      Tranzacția ține ACCESS EXCLUSIVE pe tabelele acoperite și pe storage.objects de la lock-uri până la ROLLBACK, dar CEL MULT ~3 s de
--      la BEGIN: dacă măsurătorile nu încap, serverul închide sesiunea (ROLLBACK, nimic scris) și se reia cu mai puține conturi
--      (-v fara_owner=1 / -v fara_nerestrans=1). Se rulează în afara orelor de lucru, doar cu „da”-ul chat-ului / lui Răzvan.
--   3. Comparația (după ROLLBACK, fără lock-uri): un rând pe obiect și cont; „atentie” = planificarea după > 2 × înainte + 1 ms sau
--      predicatul de acces încă pe rând (restrânsul) / apărut pe rând (nerestrânsul / owner-ul).
-- Rulare (ca postgres; uuid-urile NU intră în fișiere / rapoarte publice):
--   psql -X -v ON_ERROR_STOP=1 -v cont=<uuid restrâns> -v cont_nerestrans=<uuid nerestrâns> -v cont_owner=<uuid owner> \
--        -f scripts/executie_acces_masurare_dry_20261213a.sql
-- După aplicarea REALĂ, execuția pentru orice cont (și nerestrânsul): scripts/executie_acces_masurare.sql -v eticheta=dupa (doar citire).
\set ON_ERROR_STOP 1
\if :{?fara_nerestrans}
\set cont_nerestrans :cont
\endif
\if :{?fara_owner}
\set cont_owner :cont
\endif
-- ── 1. înainte (READ ONLY) ──
SET transaction_timeout = 0;
BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '2s';
SELECT set_config('tacc.masurare_cont', :'cont', true) IS NOT NULL AS cont_setat, set_config('tacc.masurare_eticheta', 'inainte restrans', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
SELECT current_setting('tacc.masurare_rez') AS inainte_b
\gset
SELECT set_config('tacc.masurare_cont', :'cont_nerestrans', true) IS NOT NULL AS cont_setat, set_config('tacc.masurare_eticheta', 'inainte nerestrans', true) AS eticheta,
       set_config('tacc.masurare_mod', 'plan', true) AS mod;
\ir executie_acces_masurare_corp.sql
SELECT current_setting('tacc.masurare_rez') AS inainte_a
\gset
SELECT set_config('tacc.masurare_cont', :'cont_owner', true) IS NOT NULL AS cont_setat, set_config('tacc.masurare_eticheta', 'inainte owner', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
SELECT current_setting('tacc.masurare_rez') AS inainte_o
\gset
ROLLBACK;

-- ── 2. după (aplicare + măsurare + ROLLBACK, plafon 3 s de la BEGIN) ──
SET transaction_timeout = 3000;
BEGIN ISOLATION LEVEL READ COMMITTED;
DO $p$ BEGIN
  IF (SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout') IS DISTINCT FROM '3000/session' THEN
    RAISE EXCEPTION 'DRY: plafonul nu e 3000/session'; END IF;
  PERFORM set_config('gazpet.plafon_tranzactie', '3000:' || txid_current(), true);
END $p$;
SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true) IS NOT NULL AS marcaj;
\ir ../supabase/migrations/20261213a_executie_acces_proiect_perf.sql
SELECT set_config('tacc.masurare_cont', :'cont', true) IS NOT NULL AS cont_setat, set_config('tacc.masurare_eticheta', 'dupa restrans', true) AS eticheta,
       set_config('tacc.masurare_mod', 'complet', true) AS mod;
\ir executie_acces_masurare_corp.sql
SELECT current_setting('tacc.masurare_rez') AS dupa_b
\gset
SELECT set_config('tacc.masurare_cont', :'cont_nerestrans', true) IS NOT NULL AS cont_setat, set_config('tacc.masurare_eticheta', 'dupa nerestrans', true) AS eticheta,
       set_config('tacc.masurare_mod', 'plan', true) AS mod;
\ir executie_acces_masurare_corp.sql
SELECT current_setting('tacc.masurare_rez') AS dupa_a
\gset
SELECT set_config('tacc.masurare_cont', :'cont_owner', true) IS NOT NULL AS cont_setat, set_config('tacc.masurare_eticheta', 'dupa owner', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
SELECT current_setting('tacc.masurare_rez') AS dupa_o
\gset
DO $d$ BEGIN
  RAISE NOTICE '20261213a DRY: % ms de la BEGIN pana la ROLLBACK (plafon 3000 ms)', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $d$;
ROLLBACK;
RESET transaction_timeout;

-- ── 3. comparația (fără lock-uri) ──
SELECT c.cont, k AS obiect, a ->> 'clasa' AS clasa,
       (a ->> 'randuri')::bigint AS randuri_inainte, (d ->> 'randuri')::bigint AS randuri_dupa,
       (a ->> 'ms2')::numeric AS ms_inainte, (d ->> 'ms2')::numeric AS ms_dupa,
       (a ->> 'ms_planificare')::numeric AS ms_plan_inainte, (d ->> 'ms_planificare')::numeric AS ms_plan_dupa,
       (a ->> 'noduri')::int AS noduri_inainte, (d ->> 'noduri')::int AS noduri_dupa,
       (a ->> 'subplanuri')::int AS subplanuri_inainte, (d ->> 'subplanuri')::int AS subplanuri_dupa,
       a -> 'fn_pe_rand' AS pe_rand_inainte, d -> 'fn_pe_rand' AS pe_rand_dupa,
       CASE WHEN coalesce(d ->> 'eroare', a ->> 'eroare') IS NOT NULL THEN 'eroare'
            WHEN (d ->> 'randuri') IS DISTINCT FROM (a ->> 'randuri') THEN 'RANDURI DIFERITE'
            WHEN c.cont = 'restrans' AND jsonb_array_length(coalesce(d -> 'fn_pe_rand', '[]')) > 0 THEN 'inca pe rand'
            WHEN c.cont <> 'restrans' AND jsonb_array_length(coalesce(d -> 'fn_pe_rand', '[]')) > jsonb_array_length(coalesce(a -> 'fn_pe_rand', '[]')) THEN 'apare pe rand'
            WHEN (d ->> 'ms_planificare')::numeric > 2 * (a ->> 'ms_planificare')::numeric + 1 THEN 'planificare mai lenta'
            ELSE '' END AS atentie,
       coalesce(d ->> 'eroare', a ->> 'eroare') AS eroare
  FROM (VALUES ('restrans', :'inainte_b', :'dupa_b'), ('nerestrans', :'inainte_a', :'dupa_a'), ('owner', :'inainte_o', :'dupa_o')) c(cont, i, du)
  CROSS JOIN LATERAL jsonb_each(c.i::jsonb) AS x(k, a)
  LEFT JOIN LATERAL (SELECT c.du::jsonb -> x.k AS d) y ON true
 ORDER BY c.cont, k LIKE 'storage:%', k;
