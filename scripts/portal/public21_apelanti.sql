-- READ ONLY. Portal E1 r23 (varianta d): CINE apeleaza azi cele 21 de functii din public executabile prin PUBLIC si ce
-- rol ar ramane FARA drept dupa REVOKE EXECUTE ... FROM PUBLIC (18a, $public_d_*). Doar catalog + statistici agregate.
-- Rulare (coordonatorul, pe productie, inaintea aplicarii lui 18a):
--   psql -X -At -F '|' -v ON_ERROR_STOP=1 -f scripts/portal/public21_apelanti.sql <conexiunea> > public21_apelanti.out
-- Optional, daca extensia pg_stat_statements exista (apelurile pe rol, de la ultima resetare a statisticilor):
--   psql -X -At -F '|' -v ON_ERROR_STOP=1 -f scripts/portal/public21_apelanti_pss.sql <conexiunea>
-- O singura tranzactie BEGIN READ ONLY ... ROLLBACK; nu afiseaza corpuri de functii, comenzi cron sau texte de interogari:
-- doar nume de obiecte / roluri, adevarat / fals si numere. Fara date personale, fara secrete.
-- Ce raspunde, pe sectiuni:
--   P_clasificare: fiecare din cele 21 - exista, intoarce trigger, DEFINER, proprietar, cate triggere o folosesc (si pe ce
--     tabele), EXECUTE explicit (nu prin PUBLIC) pentru anon / authenticated / service_role;
--   P_apelanti_corp: functiile al caror corp numeste una din cele 21 urmata de "(" (cine o apeleaza din SQL), cu DEFINER /
--     functie de trigger: un apelant INVOKER ruleaza cu rolul celui care il cheama => acel rol are nevoie de EXECUTE;
--   P_dependente: politici / DEFAULT-uri / vederi / constrangeri care o folosesc (pg_depend);
--   P_cron: joburile pg_cron vizibile sesiunii (cron.job are RLS: fiecare rol isi vede joburile) care o numesc, rolul lor;
--   P_pierde: pentru fiecare rol care se poate loga sau pe care il foloseste API-ul, functiile pe care le poate executa AZI
--     dar NU dupa retragerea PUBLIC (fara drept explicit, fara rol membru cu drept explicit, nu e proprietar). Daca un astfel
--     de rol apeleaza functia (P_apelanti_corp / P_cron / pg_stat_statements / jurnalele API), lipseste un GRANT;
--   P_statistici: apelurile numarate de pg_stat_user_functions (doar daca track_functions e pornit; altfel 0 = necunoscut).
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog, pg_temp;

-- P_clasificare
SELECT 'P_clasificare' AS sectiune, x.semnatura, x.exista, x.trigger_fn, x.definer, x.proprietar, x.exec_public,
       x.explicit_anon, x.explicit_authenticated, x.explicit_service_role, x.nr_triggere, x.tabele_triggere
  FROM (SELECT l.s AS semnatura, p.oid IS NOT NULL AS exista, p.prorettype = 'trigger'::regtype AS trigger_fn,
               p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS proprietar,
               EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS exec_public,
               EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = to_regrole('anon') AND a.privilege_type = 'EXECUTE') AS explicit_anon,
               EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = to_regrole('authenticated') AND a.privilege_type = 'EXECUTE') AS explicit_authenticated,
               EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        WHERE a.grantee = to_regrole('service_role') AND a.privilege_type = 'EXECUTE') AS explicit_service_role,
               (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS nr_triggere,
               (SELECT string_agg(DISTINCT t.tgrelid::regclass::text, ',' ORDER BY t.tgrelid::regclass::text)
                  FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS tabele_triggere
          FROM unnest(ARRAY[
                 'public.auto_cost_from_tichet()', 'public.auto_flag_agabaritic()', 'public.check_alerta_consum()',
                 'public.fn_claude_context_cleanup()', 'public.fn_contracte_linii_updated_at()',
                 'public.fn_executie_touch_updated_at()', 'public.fn_notif_lipsa_fisa_service(bigint)',
                 'public.fn_trg_categorie_cantitate()', 'public.gen_numar_transport()', 'public.get_istoric_importuri_evogps()',
                 'public.hr_recrutare_touch_updated_at()', 'public.notify_tichet_opener_on_resolve()', 'public.set_updated_at()',
                 'public.tg_active_lipsa_fisa()', 'public.tg_hr_employees_private_touch()', 'public.tg_lsf_touch_updated()',
                 'public.update_hr_semnaturi_modificat_la()', 'public.update_modificat_la_hr_docp()',
                 'public.update_modificat_la_ord_setari()', 'public.update_stoc_achizitie()', 'public.update_stoc_rezervor()']) AS l(s)
               LEFT JOIN pg_proc p ON p.oid = to_regprocedure(l.s)) x
 ORDER BY x.semnatura COLLATE "C";

-- P_apelanti_corp: corpul apelantului e citit DOAR prin predicatul ~ (numele tintei urmat de "("), nu e afisat
SELECT 'P_apelanti_corp' AS sectiune, x.tinta, x.apelant, x.apelant_definer, x.apelant_trigger, x.apelant_proprietar,
       x.apelant_tabele_triggere
  FROM (SELECT t.oid::regprocedure::text AS tinta,
               quote_ident(cn.nspname) || '.' || quote_ident(c.proname) || '(' || oidvectortypes(c.proargtypes) || ')' AS apelant,
               c.prosecdef AS apelant_definer, c.prorettype = 'trigger'::regtype AS apelant_trigger,
               pg_get_userbyid(c.proowner) AS apelant_proprietar,
               (SELECT string_agg(DISTINCT tg.tgrelid::regclass::text, ',' ORDER BY tg.tgrelid::regclass::text)
                  FROM pg_trigger tg WHERE tg.tgfoid = c.oid AND NOT tg.tgisinternal) AS apelant_tabele_triggere
          FROM pg_proc t JOIN pg_namespace tn ON tn.oid = t.pronamespace
               JOIN pg_proc c ON c.oid <> t.oid
               JOIN pg_namespace cn ON cn.oid = c.pronamespace
         WHERE tn.nspname = 'public'
           AND t.oid IN (to_regprocedure('public.fn_claude_context_cleanup()'), to_regprocedure('public.fn_notif_lipsa_fisa_service(bigint)'),
                         to_regprocedure('public.get_istoric_importuri_evogps()'))
           AND cn.nspname <> 'pg_catalog' AND cn.nspname !~ '^pg_(toast|temp)_'
           AND c.prosrc ~* ('(^|[^a-z0-9_$])' || t.proname || '[[:space:]]*[(]')) x
 ORDER BY x.tinta COLLATE "C", x.apelant COLLATE "C";

-- P_dependente (pg_depend: politici, DEFAULT-uri, vederi / reguli, constrangeri, indecsi care folosesc una din cele 21)
SELECT 'P_dependente' AS sectiune, x.functie, x.folosita_de, x.obiect
  FROM (SELECT d.refobjid::regprocedure::text AS functie,
               CASE d.classid WHEN 'pg_policy'::regclass THEN 'politica' WHEN 'pg_attrdef'::regclass THEN 'default'
                    WHEN 'pg_rewrite'::regclass THEN 'vedere / regula' WHEN 'pg_constraint'::regclass THEN 'constrangere'
                    WHEN 'pg_class'::regclass THEN 'index' WHEN 'pg_proc'::regclass THEN 'functie (BEGIN ATOMIC)'
                    ELSE d.classid::regclass::text END AS folosita_de,
               pg_describe_object(d.classid, d.objid, d.objsubid) AS obiect
          FROM pg_depend d
         WHERE d.refclassid = 'pg_proc'::regclass AND d.deptype = 'n'
           AND d.refobjid IN (SELECT to_regprocedure(s) FROM unnest(ARRAY[
                 'public.fn_claude_context_cleanup()', 'public.fn_notif_lipsa_fisa_service(bigint)',
                 'public.get_istoric_importuri_evogps()']) s)) x
 ORDER BY x.functie COLLATE "C", x.obiect COLLATE "C";

-- P_cron: doar numele jobului, rolul si adevarat / fals pe fiecare din cele 3 apelabile (comanda NU se afiseaza)
SELECT 'P_cron' AS sectiune, j.jobid, j.jobname::text AS job, j.username::text AS ruleaza_ca, j.active AS activ,
       j.command ~* '(^|[^a-z0-9_$])fn_claude_context_cleanup[[:space:]]*[(]' AS fn_claude_context_cleanup,
       j.command ~* '(^|[^a-z0-9_$])fn_notif_lipsa_fisa_service[[:space:]]*[(]' AS fn_notif_lipsa_fisa_service,
       j.command ~* '(^|[^a-z0-9_$])get_istoric_importuri_evogps[[:space:]]*[(]' AS get_istoric_importuri_evogps
  FROM cron.job j
 WHERE j.command ~* '(^|[^a-z0-9_$])(fn_claude_context_cleanup|fn_notif_lipsa_fisa_service|get_istoric_importuri_evogps)[[:space:]]*[(]'
 ORDER BY j.jobid;

-- P_pierde: rolurile (care se pot loga + rolurile API) care pot executa AZI o functie din cele 21 dar n-ar mai putea dupa
-- REVOKE ... FROM PUBLIC (drept doar prin PUBLIC). Pentru functiile de trigger, pierderea nu conteaza (nu se apeleaza direct).
SELECT 'P_pierde' AS sectiune, x.rol, x.functie, x.trigger_fn
  FROM (SELECT r.rolname::text AS rol, p.oid::regprocedure::text AS functie, p.prorettype = 'trigger'::regtype AS trigger_fn
          FROM pg_roles r CROSS JOIN pg_proc p
         WHERE (r.rolcanlogin OR r.rolname IN ('anon', 'authenticated', 'service_role'))
           AND p.oid IN (SELECT to_regprocedure(s) FROM unnest(ARRAY[
                 'public.auto_cost_from_tichet()', 'public.auto_flag_agabaritic()', 'public.check_alerta_consum()',
                 'public.fn_claude_context_cleanup()', 'public.fn_contracte_linii_updated_at()',
                 'public.fn_executie_touch_updated_at()', 'public.fn_notif_lipsa_fisa_service(bigint)',
                 'public.fn_trg_categorie_cantitate()', 'public.gen_numar_transport()', 'public.get_istoric_importuri_evogps()',
                 'public.hr_recrutare_touch_updated_at()', 'public.notify_tichet_opener_on_resolve()', 'public.set_updated_at()',
                 'public.tg_active_lipsa_fisa()', 'public.tg_hr_employees_private_touch()', 'public.tg_lsf_touch_updated()',
                 'public.update_hr_semnaturi_modificat_la()', 'public.update_modificat_la_hr_docp()',
                 'public.update_modificat_la_ord_setari()', 'public.update_stoc_achizitie()', 'public.update_stoc_rezervor()']) s)
           AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
           AND NOT r.rolsuper
           AND NOT pg_has_role(r.oid, p.proowner, 'USAGE')
           AND NOT EXISTS (SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee <> 0 AND a.privilege_type = 'EXECUTE' AND pg_has_role(r.oid, a.grantee, 'USAGE'))) x
 ORDER BY x.trigger_fn, x.rol COLLATE "C", x.functie COLLATE "C";

-- P_statistici: apelurile de la ultima resetare (0 cand track_functions = none: NECUNOSCUT, nu "nefolosita")
SELECT 'P_statistici' AS sectiune, y.track_functions, y.functie, y.apeluri
  FROM (SELECT current_setting('track_functions') AS track_functions, s.funcid::regprocedure::text AS functie, s.calls AS apeluri
          FROM pg_stat_user_functions s
         WHERE s.funcid IN (SELECT to_regprocedure(x) FROM unnest(ARRAY[
                 'public.fn_claude_context_cleanup()', 'public.fn_notif_lipsa_fisa_service(bigint)',
                 'public.get_istoric_importuri_evogps()']) x)) y
 ORDER BY y.functie COLLATE "C";

ROLLBACK;
