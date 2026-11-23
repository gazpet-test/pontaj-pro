-- READ ONLY, optional (doar daca extensia pg_stat_statements exista: SELECT to_regclass('extensions.pg_stat_statements')).
-- Portal E1 r23 (varianta d): de la ultima resetare a statisticilor, CE ROL a rulat instructiuni care numesc una din cele
-- 3 functii apelabile (userid = rolul efectiv al instructiunii; PostgREST ruleaza ca authenticated / anon / service_role).
-- Textul instructiunilor NU se afiseaza: doar rolul, functia (adevarat / fals pe text) si numarul de apeluri.
-- Limita: cu pg_stat_statements.track = top (implicit) se vad doar instructiunile de nivel superior; apelurile din corpul
-- altor functii / triggere apar doar cu track = all (setarea e afisata). Lipsa unui rand != functie nefolosita.
--   psql -X -At -F '|' -v ON_ERROR_STOP=1 -f scripts/portal/public21_apelanti_pss.sql <conexiunea>
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog, pg_temp;

-- Q_statements
SELECT 'Q_statements' AS sectiune, current_setting('pg_stat_statements.track', true) AS track, x.rol, x.functie,
       sum(x.calls) AS apeluri
  FROM (SELECT pg_get_userbyid(s.userid) AS rol, f.nume AS functie, s.calls
          FROM extensions.pg_stat_statements s
               CROSS JOIN unnest(ARRAY['fn_claude_context_cleanup', 'fn_notif_lipsa_fisa_service', 'get_istoric_importuri_evogps']) AS f(nume)
         WHERE s.query ~* ('(^|[^a-z0-9_$])' || f.nume || '([^a-z0-9_$]|$)')) x
 GROUP BY x.rol, x.functie
 ORDER BY x.functie COLLATE "C", x.rol COLLATE "C";

ROLLBACK;
