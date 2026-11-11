-- DRY 20261213a cu măsurare: ÎNAINTE (politicile 20261209a) și DUPĂ (20261213a aplicată în aceeași tranzacție), pentru UN cont, apoi ROLLBACK.
-- Nu rămâne nimic scris. ATENȚIE: după aplicare, tranzacția ține ACCESS EXCLUSIVE pe tabelele acoperite și pe storage.objects până la
-- ROLLBACK (cât durează a doua măsurare + comparația; așteptat câteva secunde): toate citirile / scrierile pe ele (inclusiv încărcările din
-- Storage ale celorlalte module) AȘTEAPTĂ. Se rulează în afara orelor de lucru, doar cu „da”-ul chat-ului / lui Răzvan.
-- Rulare (ca postgres): psql -X -v ON_ERROR_STOP=1 -v cont=<uuid> -f scripts/executie_acces_masurare_dry_20261213a.sql
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '2s';
SELECT set_config('tacc.masurare_cont', :'cont', true) IS NOT NULL AS cont_setat, set_config('tacc.masurare_eticheta', 'inainte', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
SELECT set_config('tacc.masurare_inainte', current_setting('tacc.masurare_rez'), true) IS NOT NULL AS inainte_salvat;
SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true) IS NOT NULL AS marcaj;
\ir ../supabase/migrations/20261213a_executie_acces_proiect_perf.sql
SELECT set_config('tacc.masurare_eticheta', 'dupa', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
SELECT k AS obiect, a ->> 'clasa' AS clasa, (a ->> 'randuri')::bigint AS randuri_inainte, (d ->> 'randuri')::bigint AS randuri_dupa,
       (a ->> 'ms2')::numeric AS ms_inainte, (d ->> 'ms2')::numeric AS ms_dupa,
       (a ->> 'ms_planificare')::numeric AS ms_plan_inainte, (d ->> 'ms_planificare')::numeric AS ms_plan_dupa,
       a -> 'fn_pe_rand' AS pe_rand_inainte, d -> 'fn_pe_rand' AS pe_rand_dupa, (d ->> 'subplan_corelate')::int - (a ->> 'subplan_corelate')::int AS subplan_corelate_in_plus,
       coalesce(d ->> 'eroare', a ->> 'eroare') AS eroare
  FROM jsonb_each(current_setting('tacc.masurare_inainte')::jsonb) AS x(k, a)
  LEFT JOIN LATERAL (SELECT current_setting('tacc.masurare_rez')::jsonb -> x.k AS d) y ON true
 ORDER BY k LIKE 'storage:%', k;
ROLLBACK;
