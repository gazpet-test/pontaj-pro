-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261022a_sec_f4_advisors_revoke_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/; validatorul de
-- livrare o refuză — n-are garda de livrare).
-- Pune înapoi EXACT drepturile de dinainte de 20261022a: EXECUTE pentru PUBLIC pe heartbeat_alerta()/heartbeat_muti(),
--   EXECUTE pentru authenticated pe fn_get_next_nr_aviz(text), SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER pentru anon și
--   authenticated pe cele 9 tabele cu RLS fără politici, USAGE/SELECT/UPDATE pe cele 3 secvențe ale lor.
-- ⚠ REDESCHIDE expunerile închise de 20261022a (anon pornește alertele și citește lista proceselor; orice cont logat consumă
--   numere de aviz). Se rulează DOAR la cererea explicită a lui Răzvan, dacă 20261022a a stricat ceva. Armarea nu e autorizare.
-- REFUZĂ dacă:
--   * drepturile celor 15 obiecte nu sunt EXACT starea lăsată de 20261022a (amprenta c_tinta) — orice schimbare ulterioară
--     (alt GRANT, o politică nouă, alt owner) ⇒ refuz, ca să nu suprascrie pe tăcute munca altei migrări. Expresia e IDENTICĂ
--     textual cu cea din migrare (verificată de scripts/test_sec_f4_advisors.sh) și nu depinde de search_path;
--   * corpul sau setările (proconfig) celor 3 funcții diferă de cele de pe live din 08.10 (review intern r1): revenirea nu
--     redă EXECUTE public unei funcții SECURITY DEFINER rescrise între timp.
-- ISTORICUL: revenirea NU șterge rândul 20261022a din supabase_migrations.schema_migrations ⇒ după ea, list_migrations arată
--   F4 tot „aplicată”, iar runnerul refuză reaplicarea aceluiași fișier (cod 11 / 21). Calea de reaplicare: un artefact NOU
--   (ex. 20261022b_…, cu garda lui — numele gărzii vine din numele fișierului), niciodată DELETE în schema_migrations fără
--   acordul explicit al lui Răzvan. (Harness-ul șterge rândul doar în baza lui de test, ca să probeze dus-întorsul.)
-- UN SINGUR bloc DO: armarea, verificările, GRANT-urile și postcondițiile sunt o singură instrucțiune.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT; ca postgres):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261022a', 'SEC_F4_REDESCHIDE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $revenire$
DECLARE
  v_acum text;
  v_lista text;
  c_live  CONSTANT text := '897081cb38888c2bba72b83532f80089';   -- starea de dinainte de 20261022a (producție 08.10.2026)
  c_tinta CONSTANT text := '5881a2f5543a8527770dd6bdcb20b7ac';  -- starea lăsată de 20261022a
  -- corpurile și setările celor 3 funcții pe live (08.10.2026, read-only): md5(prosrc) + proconfig
  c_corpuri CONSTANT text[] := ARRAY[
    'public.heartbeat_alerta()|242714d3ac5cc1e2ec9b7317b707eeb6|{"search_path=public, pg_temp"}',
    'public.heartbeat_muti()|9335a3c1b2411c114cce781c088d4dba|{"search_path=public, pg_temp"}',
    'public.fn_get_next_nr_aviz(text)|25cac16e8c21bce17e488d31753ce83b|{"search_path=public, pg_temp"}'];
BEGIN
  -- 1. armare legată de tranzacția curentă; fără armare persistentă; doar postgres
  IF current_setting('gazpet.revenire_20261022a', true) IS DISTINCT FROM 'SEC_F4_REDESCHIDE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261022a: nearmată (gazpet.revenire_20261022a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261022a=%') THEN
    RAISE EXCEPTION 'Revenire 20261022a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Revenire 20261022a: rulează ca postgres';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- 2. corpurile funcțiilor = cele de pe live (altfel nu se redă EXECUTE public unei funcții DEFINER schimbate)
  SELECT string_agg(split_part(x.e, '|', 1), ', ') INTO v_lista
    FROM unnest(c_corpuri) AS x(e)
   WHERE (SELECT md5(p.prosrc) || '|' || coalesce(p.proconfig::text, '')
            FROM pg_proc p WHERE p.oid = to_regprocedure(split_part(x.e, '|', 1)))
         IS DISTINCT FROM split_part(x.e, '|', 2) || '|' || split_part(x.e, '|', 3);
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261022a: corpul sau setările funcțiilor s-au schimbat după 20261022a (%) — refuz', v_lista;
  END IF;

  -- 3. drepturile trebuie să fie EXACT starea lăsată de 20261022a
  -- <amprenta> (expresie IDENTICĂ în migrare și în revenire — verificată textual de scripts/test_sec_f4_advisors.sh)
  SELECT md5(string_agg(o.k, E'\n' ORDER BY o.k COLLATE "C")) || ':' || count(*)
    INTO v_acum
    FROM (
      SELECT format('fn|%s.%s(%s)|%s|%s|%s', p.pronamespace::regnamespace, p.proname, pg_get_function_identity_arguments(p.oid),
               pg_get_userbyid(p.proowner), p.prosecdef,
               coalesce((SELECT string_agg(g.e, ',' ORDER BY g.e COLLATE "C")
                           FROM (SELECT format('%s=%s/%s%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                               a.privilege_type, pg_get_userbyid(a.grantor), CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS e
                                   FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) g), '')) AS k
        FROM pg_proc p
       WHERE p.oid IN (to_regprocedure('public.heartbeat_alerta()'), to_regprocedure('public.heartbeat_muti()'),
                       to_regprocedure('public.fn_get_next_nr_aviz(text)'))
      UNION ALL
      SELECT format('rel|%s.%s|%s|%s|%s|%s|%s|%s', c.relnamespace::regnamespace, c.relname, pg_get_userbyid(c.relowner), c.relkind,
               c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policy po WHERE po.polrelid = c.oid)
                 + (SELECT count(*) FROM pg_attribute at WHERE at.attrelid = c.oid AND at.attnum > 0 AND at.attacl IS NOT NULL) * 1000,
               coalesce((SELECT string_agg(g.e, ',' ORDER BY g.e COLLATE "C")
                           FROM (SELECT format('%s=%s/%s%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                               a.privilege_type, pg_get_userbyid(a.grantor), CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS e
                                   FROM aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))) a) g), '')) AS k
        FROM pg_class c
       WHERE c.oid IN (to_regclass('public._backup_acoperire_racari_20260921'), to_regclass('public._backup_clar63_20260927'),
                       to_regclass('public._eval_candidati_inainte_20260921'), to_regclass('public._eval_runda1_20260921'),
                       to_regclass('public._eval_runda2_20260921'), to_regclass('public.olx_tokens'),
                       to_regclass('public.piese_import_staging'), to_regclass('public.rag_qr_log'),
                       to_regclass('public.storage_rls_errors'), to_regclass('public.piese_import_staging_id_seq'),
                       to_regclass('public.rag_qr_log_id_seq'), to_regclass('public.storage_rls_errors_id_seq'))
    ) o;
  -- </amprenta>
  IF v_acum IS DISTINCT FROM c_tinta || ':15' THEN
    RAISE EXCEPTION 'Revenire 20261022a: drepturile celor 15 obiecte nu sunt starea lăsată de 20261022a (amprenta %, așteptat %:15) — refuz',
      v_acum, c_tinta;
  END IF;

  -- 4. drepturile de dinainte (grantor postgres, ca pe live)
  GRANT EXECUTE ON FUNCTION public.heartbeat_alerta(), public.heartbeat_muti() TO PUBLIC;
  GRANT EXECUTE ON FUNCTION public.fn_get_next_nr_aviz(text) TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
    ON TABLE public._backup_acoperire_racari_20260921, public._backup_clar63_20260927,
             public._eval_candidati_inainte_20260921, public._eval_runda1_20260921, public._eval_runda2_20260921,
             public.olx_tokens, public.piese_import_staging, public.rag_qr_log, public.storage_rls_errors
    TO anon, authenticated;
  GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.piese_import_staging_id_seq, public.rag_qr_log_id_seq, public.storage_rls_errors_id_seq
    TO anon, authenticated;

  -- 5. postcondiție: EXACT starea de dinainte (aceeași expresie) + dezarmare
  SELECT md5(string_agg(o.k, E'\n' ORDER BY o.k COLLATE "C")) || ':' || count(*)
    INTO v_acum
    FROM (
      SELECT format('fn|%s.%s(%s)|%s|%s|%s', p.pronamespace::regnamespace, p.proname, pg_get_function_identity_arguments(p.oid),
               pg_get_userbyid(p.proowner), p.prosecdef,
               coalesce((SELECT string_agg(g.e, ',' ORDER BY g.e COLLATE "C")
                           FROM (SELECT format('%s=%s/%s%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                               a.privilege_type, pg_get_userbyid(a.grantor), CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS e
                                   FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) g), '')) AS k
        FROM pg_proc p
       WHERE p.oid IN (to_regprocedure('public.heartbeat_alerta()'), to_regprocedure('public.heartbeat_muti()'),
                       to_regprocedure('public.fn_get_next_nr_aviz(text)'))
      UNION ALL
      SELECT format('rel|%s.%s|%s|%s|%s|%s|%s|%s', c.relnamespace::regnamespace, c.relname, pg_get_userbyid(c.relowner), c.relkind,
               c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policy po WHERE po.polrelid = c.oid)
                 + (SELECT count(*) FROM pg_attribute at WHERE at.attrelid = c.oid AND at.attnum > 0 AND at.attacl IS NOT NULL) * 1000,
               coalesce((SELECT string_agg(g.e, ',' ORDER BY g.e COLLATE "C")
                           FROM (SELECT format('%s=%s/%s%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                               a.privilege_type, pg_get_userbyid(a.grantor), CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS e
                                   FROM aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner))) a) g), '')) AS k
        FROM pg_class c
       WHERE c.oid IN (to_regclass('public._backup_acoperire_racari_20260921'), to_regclass('public._backup_clar63_20260927'),
                       to_regclass('public._eval_candidati_inainte_20260921'), to_regclass('public._eval_runda1_20260921'),
                       to_regclass('public._eval_runda2_20260921'), to_regclass('public.olx_tokens'),
                       to_regclass('public.piese_import_staging'), to_regclass('public.rag_qr_log'),
                       to_regclass('public.storage_rls_errors'), to_regclass('public.piese_import_staging_id_seq'),
                       to_regclass('public.rag_qr_log_id_seq'), to_regclass('public.storage_rls_errors_id_seq'))
    ) o;
  IF v_acum IS DISTINCT FROM c_live || ':15' THEN
    RAISE EXCEPTION 'Revenire 20261022a: postcondiție — amprenta după GRANT = %, așteptat %:15', v_acum, c_live;
  END IF;
  PERFORM set_config('gazpet.revenire_20261022a', '', true);
END
$revenire$;
