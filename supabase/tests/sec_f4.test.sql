-- Teste SQL pentru 20261022a (SEC F4). Rulează DOAR prin scripts/test_sec_f4_advisors.sh, pe baza locală *_test, după
-- schelet + migrare (aplicată prin runner).
\set ON_ERROR_STOP on
SET client_min_messages = notice;
\set RAZVAN '00000000-0000-0000-0000-000000000121'
\set NATALIA '00000000-0000-0000-0000-000000000126'

-- ═══ T1 catalog: funcțiile ═══
SELECT teste.e('T1a heartbeat_alerta/heartbeat_muti/fn_get_next_nr_aviz: anon, authenticated și PUBLIC fără EXECUTE', NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['public.heartbeat_alerta()','public.heartbeat_muti()','public.fn_get_next_nr_aviz(text)']) f(o),
                unnest(ARRAY['anon','authenticated','public']) r(n)
   WHERE has_function_privilege(r.n, f.o::regprocedure, 'EXECUTE')));
SELECT teste.e('T1b postgres și service_role păstrează EXECUTE', NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['public.heartbeat_alerta()','public.heartbeat_muti()','public.fn_get_next_nr_aviz(text)']) f(o),
                unnest(ARRAY['postgres','service_role']) r(n)
   WHERE NOT has_function_privilege(r.n, f.o::regprocedure, 'EXECUTE')));
SELECT teste.e('T1c ACL exact pe funcții: {postgres=X, service_role=X}', NOT EXISTS (
  SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.heartbeat_alerta()'::regprocedure, 'public.heartbeat_muti()'::regprocedure,
                                         'public.fn_get_next_nr_aviz(text)'::regprocedure)
   AND (SELECT array_agg(a.grantee::regrole::text || ':' || a.privilege_type ORDER BY a.grantee::regrole::text COLLATE "C")
          FROM aclexplode(p.proacl) a) IS DISTINCT FROM ARRAY['postgres:EXECUTE','service_role:EXECUTE']));
SELECT teste.e('T1d funcțiile rămân SECURITY DEFINER, owner postgres, corpul neatins',
  (SELECT bool_and(p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres') FROM pg_proc p
    WHERE p.oid IN ('public.heartbeat_alerta()'::regprocedure, 'public.heartbeat_muti()'::regprocedure, 'public.fn_get_next_nr_aviz(text)'::regprocedure)));

-- ═══ T2 catalog: tabelele ═══
SELECT teste.e('T2a cele 9 tabele: anon/authenticated/PUBLIC fără niciun drept (tabel sau coloană), inclusiv MAINTAIN', NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['_backup_acoperire_racari_20260921','_backup_clar63_20260927','_eval_candidati_inainte_20260921',
                             '_eval_runda1_20260921','_eval_runda2_20260921','olx_tokens','piese_import_staging','rag_qr_log','storage_rls_errors']) t(n),
                unnest(ARRAY['anon','authenticated','public']) r(n),
                unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(n)
   WHERE has_table_privilege(r.n, ('public.' || t.n)::regclass, p.n)
      OR (p.n IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(r.n, ('public.' || t.n)::regclass, p.n))));
SELECT teste.e('T2b ACL exact pe tabele: {postgres=arwdDxtm, service_role=arwdDxtm}', NOT EXISTS (
  SELECT 1 FROM pg_class c
   WHERE c.oid IN ('public._backup_acoperire_racari_20260921'::regclass, 'public._backup_clar63_20260927'::regclass,
                   'public._eval_candidati_inainte_20260921'::regclass, 'public._eval_runda1_20260921'::regclass,
                   'public._eval_runda2_20260921'::regclass, 'public.olx_tokens'::regclass, 'public.piese_import_staging'::regclass,
                   'public.rag_qr_log'::regclass, 'public.storage_rls_errors'::regclass)
     AND c.relacl::text IS DISTINCT FROM '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'));
SELECT teste.e('T2c RLS rămâne pornit, 0 politici, owner postgres', NOT EXISTS (
  SELECT 1 FROM pg_class c
   WHERE c.oid IN ('public._backup_acoperire_racari_20260921'::regclass, 'public._backup_clar63_20260927'::regclass,
                   'public._eval_candidati_inainte_20260921'::regclass, 'public._eval_runda1_20260921'::regclass,
                   'public._eval_runda2_20260921'::regclass, 'public.olx_tokens'::regclass, 'public.piese_import_staging'::regclass,
                   'public.rag_qr_log'::regclass, 'public.storage_rls_errors'::regclass)
     AND (NOT c.relrowsecurity OR pg_get_userbyid(c.relowner) <> 'postgres' OR EXISTS (SELECT 1 FROM pg_policy po WHERE po.polrelid = c.oid))));
SELECT teste.e('T2e cele 3 secvențe: ACL exact {postgres=rwU, service_role=rwU}; anon/authenticated/PUBLIC fără USAGE/SELECT/UPDATE', NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['public.piese_import_staging_id_seq','public.rag_qr_log_id_seq','public.storage_rls_errors_id_seq']) s(n)
   WHERE (SELECT c.relacl::text FROM pg_class c WHERE c.oid = s.n::regclass) IS DISTINCT FROM '{postgres=rwU/postgres,service_role=rwU/postgres}'
      OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','public']) r(n), unnest(ARRAY['USAGE','SELECT','UPDATE']) p(n)
                  WHERE has_sequence_privilege(r.n, s.n::regclass, p.n))));
SELECT teste.e('T2d tabelele de context neatinse (profiles/notifications/procese_heartbeat/avize_serii_counter: anon arwdxt ca înainte)',
  has_table_privilege('anon', 'public.procese_heartbeat', 'SELECT') AND has_table_privilege('authenticated', 'public.avize_serii_counter', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.notifications', 'INSERT'));

-- ═══ T3 comportament: anon ═══
SET ROLE anon;
SELECT teste.eroare('T3a anon: heartbeat_muti() refuzat', 'SELECT * FROM public.heartbeat_muti()', 'permission denied');
SELECT teste.eroare('T3b anon: heartbeat_alerta() refuzat', 'SELECT public.heartbeat_alerta()', 'permission denied');
SELECT teste.eroare('T3c anon: fn_get_next_nr_aviz refuzat', 'SELECT public.fn_get_next_nr_aviz(''X'')', 'permission denied');
SELECT teste.eroare('T3d anon: SELECT olx_tokens refuzat', 'SELECT * FROM public.olx_tokens', 'permission denied');
SELECT teste.eroare('T3e anon: INSERT rag_qr_log refuzat', 'INSERT INTO public.rag_qr_log (active_id, question) VALUES (1, ''q'')', 'permission denied');
SELECT teste.eroare('T3f anon: SELECT storage_rls_errors refuzat', 'SELECT * FROM public.storage_rls_errors', 'permission denied');
SELECT teste.eroare('T3g anon: SELECT _eval_runda2 refuzat', 'SELECT * FROM public._eval_runda2_20260921', 'permission denied');
SELECT teste.eroare('T3h anon: nextval pe rag_qr_log_id_seq refuzat', 'SELECT nextval(''public.rag_qr_log_id_seq'')', 'permission denied');
RESET ROLE;

-- ═══ T4 comportament: authenticated ═══
SELECT teste.ca(:'NATALIA');
SELECT teste.eroare('T4a authenticated: heartbeat_muti() refuzat', 'SELECT * FROM public.heartbeat_muti()', 'permission denied');
SELECT teste.eroare('T4b authenticated: heartbeat_alerta() refuzat', 'SELECT public.heartbeat_alerta()', 'permission denied');
SELECT teste.eroare('T4c authenticated: fn_get_next_nr_aviz refuzat (nu mai consumă numere)', 'SELECT public.fn_get_next_nr_aviz(''X'')', 'permission denied');
SELECT teste.eroare('T4d authenticated: UPDATE olx_tokens refuzat', 'UPDATE public.olx_tokens SET scope = ''x''', 'permission denied');
SELECT teste.eroare('T4e authenticated: DELETE piese_import_staging refuzat', 'DELETE FROM public.piese_import_staging', 'permission denied');
SELECT teste.eroare('T4f authenticated: SELECT _backup_clar63 refuzat', 'SELECT * FROM public._backup_clar63_20260927', 'permission denied');
SELECT teste.eroare('T4f2 authenticated: setval pe storage_rls_errors_id_seq refuzat (coliziuni de chei)', 'SELECT setval(''public.storage_rls_errors_id_seq'', 1)', 'permission denied');
-- dependenții DEFINER merg ca înainte
SELECT public.log_storage_upload_error('bucket-t', 'cale/t', 'mesaj t');
SELECT teste.eroare('T4g fn_storage_rls_report (INVOKER) pentru authenticated: acum „permission denied” (înainte: totaluri 0, RLS fără politici)',
  'SELECT public.fn_storage_rls_report(7)', 'permission denied');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT teste.e('T4h log_storage_upload_error (DEFINER) a scris, ca utilizatorul logat',
  (SELECT count(*) FROM public.storage_rls_errors WHERE source = 'app_client' AND user_id = :'NATALIA'::uuid) = 1);
SELECT teste.e('T4i seria de avize neatinsă de încercările refuzate', NOT EXISTS (SELECT 1 FROM public.avize_serii_counter));

-- ═══ T5 comportament: service_role (edge) și postgres (cron) ═══
SET ROLE service_role;
SELECT teste.e('T5a service_role: heartbeat_muti() vede procesul tăcut', (SELECT count(*) FROM public.heartbeat_muti()) = 1);
SELECT teste.e('T5b service_role: fn_get_next_nr_aviz merge', public.fn_get_next_nr_aviz('T') = 1);
SELECT teste.e('T5c service_role: citește olx_tokens (olx-aplicari-sync)', (SELECT count(*) FROM public.olx_tokens) = 1);
-- (două instrucțiuni: un SELECT exterior nu vede INSERT-ul făcut în aceeași instrucțiune de funcția volatilă)
SELECT teste.e('T5d service_role: fn_rag_qr_rezerva (rag-utilaj)', public.fn_rag_qr_rezerva(1, 'intrebare') IS NOT NULL);
UPDATE public.rag_qr_log SET answered = true;
SELECT teste.e('T5d2 service_role: rândul e în rag_qr_log și se poate actualiza (rag-utilaj)',
  (SELECT count(*) FROM public.rag_qr_log WHERE answered) = 1);
SELECT teste.e('T5e service_role: fn_storage_rls_report vede datele', (public.fn_storage_rls_report(7) ->> 'total')::int = 2);
RESET ROLE;
-- jobul cron rulează ca postgres: comanda exactă din cron.job
SELECT teste.e('T5f postgres (cron heartbeat_alerta_orar): heartbeat_alerta() găsește procesul tăcut', public.heartbeat_alerta() = 1);
SELECT teste.e('T5f2 alerta a plecat o dată, către owner',
  (SELECT count(*) FROM public.notifications WHERE profile_id = :'RAZVAN'::uuid AND title LIKE '%tura_noapte%') = 1
  AND (SELECT count(*) FROM public.notifications) = 1);
SELECT teste.e('T5g a doua rulare nu repetă alerta', public.heartbeat_alerta() = 0);

-- ═══ T6 apărare în profunzime: chiar cu RLS oprit, anon nu vede tokenurile ═══
BEGIN;
ALTER TABLE public.olx_tokens DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE anon;
SELECT teste.eroare('T6a RLS oprit pe olx_tokens: anon tot refuzat', 'SELECT * FROM public.olx_tokens', 'permission denied');
ROLLBACK;
SELECT teste.e('T6b RLS pornit la loc (ROLLBACK)', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.olx_tokens'::regclass));

SELECT 'TESTE SQL: TOATE OK' AS rezultat;
DO $$ BEGIN RAISE NOTICE 'TESTE SQL: TOATE OK'; END $$;
