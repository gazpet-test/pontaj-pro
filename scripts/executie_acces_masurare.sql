-- Execuție / acces pe proiect: măsurarea citirilor pentru UN cont (timp + rânduri + forma planului), DOAR CITIRE, pe producție sau pe clonă.
-- Tranzacție READ ONLY, ANULATĂ la final; identitatea contului doar în tranzacție. Nu scrie nimic, nu ia lock-uri în afara celor ale citirilor.
-- Rulare (ca postgres, din rădăcina repo-ului; uuid-ul contului NU intră în fișiere / rapoarte publice):
--   psql -X -v ON_ERROR_STOP=1 -v cont=<uuid> -f scripts/executie_acces_masurare.sql
--   opțional: -v eticheta=inainte|dupa  (apare în fiecare linie).
-- „Înainte” = acum (20261209a); „după” = același script după aplicarea 20261213a, SAU, fără aplicare, DRY-ul din
-- scripts/executie_acces_masurare_dry_20261213a.sql (aplică 20261213a într-o tranzacție anulată, plafonată la 3 s — vezi antetul lui).
-- Pentru conturile nerestrânse / owner (regresia de planificare): același script cu -v mod=plan, înainte și după.
-- Ieșirea: liniile NOTICE + un tabel (un rând pe obiect). „pe_rand” nevid = predicatul de acces se evaluează pe fiecare rând (forma veche).
\set ON_ERROR_STOP 1
\if :{?eticheta}
\else
\set eticheta masurare
\endif
BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL statement_timeout = '180s';
SET LOCAL lock_timeout = '2s';
SELECT set_config('tacc.masurare_cont', :'cont', true) IS NOT NULL AS cont_setat, set_config('tacc.masurare_eticheta', :'eticheta', true) AS eticheta;
-- r2: opțional -v mod=plan (doar planificarea, fără execuție; implicit complet)
\if :{?mod}
SELECT set_config('tacc.masurare_mod', :'mod', true) AS mod;
\endif
\ir executie_acces_masurare_corp.sql
SELECT k AS obiect, v ->> 'clasa' AS clasa, (v ->> 'randuri')::bigint AS randuri, (v ->> 'ms1')::numeric AS ms_prima, (v ->> 'ms2')::numeric AS ms_a_doua,
       (v ->> 'ms_planificare')::numeric AS ms_planificare, v -> 'fn_pe_rand' AS pe_rand, v -> 'fn_drept_pe_rand' AS drept_pe_rand,
       (v ->> 'initplan_loops_max')::numeric AS initplan_max, (v ->> 'subplan_corelate')::int AS subplan_corelate, v ->> 'eroare' AS eroare
  FROM jsonb_each(current_setting('tacc.masurare_rez')::jsonb) AS e(k, v)
 ORDER BY k LIKE 'storage:%', k;
ROLLBACK;
