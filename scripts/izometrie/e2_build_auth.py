"""Append the self-contained E2 authorization section (no database connection)."""
from pathlib import Path

fixture = Path('supabase/tests/izometrie_e3b_cursa.sql').read_text(encoding='utf-8')
fixture = fixture[:fixture.index('DO $end$')].replace('E2-import', 'E2-auth-import')
fixture = fixture.replace("'fixture cursa E1'", "'fixture auth E2'")
fixture += r'''
-- All objects exist: authorization failures must not be missing-object accidents.
SELECT set_config('test.e2_b', (SELECT id::text FROM public.magazie_bucati WHERE serie='E3B-C1-FIXTURE'),true);
SELECT set_config('test.e2_v', (SELECT server_ver::text FROM public.magazie_bucati WHERE serie='E3B-C1-FIXTURE'),true);
SELECT set_config('test.e2_c', (SELECT id::text FROM public.izo_corectii WHERE motiv='fixture auth E2'),true);
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
DO $doc$ DECLARE v_r jsonb; v_d bigint; v_check jsonb; BEGIN
  v_r:=public.fn_izo_doc_salveaza(NULL,NULL,
    '{"proiect_id":3,"depozit_id":11,"sablon":"aviz_teava","furnizor":"E2 auth","nr_document":"E2-AUTH","data_document":"2026-10-22","total_m":12}',
    '[{"nr_crt":1,"serie":"E2-AUTH-DOC","sarja":"E2-S","perete_mm":8,"lungime_doc_mm":12000}]',NULL);
  v_d:=(v_r->>'document_id')::bigint;
  PERFORM set_config('test.e2_d',v_d::text,true);
  v_check:=public.fn_izo_doc_verifica(v_d);
  PERFORM public.fn_izo_doc_confirma(v_d,(v_check->>'versiune')::bigint,v_check->>'hash');
  PERFORM set_config('izo.receptie_ctx','',true);
  PERFORM public.fn_izo_doc_pv(v_d,2,'E2-AUTH-PV','2026-10-22');
  PERFORM set_config('izo.receptie_ctx','',true);
END $doc$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT set_config('test.e2_dv',(SELECT versiune::text FROM public.izo_documente_intrare WHERE id=current_setting('test.e2_d')::bigint),true);

-- INVOKER: the caller's real SQL role/session/JWT is preserved; a successful
-- mutation is rolled back by the exception subtransaction before failing the test.
CREATE FUNCTION teste.e2_refuz(p_sql text, p_mesaj text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
BEGIN
  PERFORM set_config('izo.corectie_ctx','',true);
  PERFORM set_config('izo.receptie_ctx','',true);
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'E2 autorizare: apel acceptat: %',p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    IF p_mesaj IS NOT NULL AND SQLERRM NOT LIKE p_mesaj THEN
      RAISE EXCEPTION 'E2 autorizare: refuz mascat [%]: %',SQLERRM,p_sql;
    END IF;
  END;
END $f$;
REVOKE ALL ON FUNCTION teste.e2_refuz(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teste.e2_refuz(text,text) TO anon,service_role,authenticated;
CREATE FUNCTION teste.e2_toate(p_mesaj text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE v_b bigint:=current_setting('test.e2_b')::bigint;
  v_c bigint:=current_setting('test.e2_c')::bigint;
  v_v bigint:=current_setting('test.e2_v')::bigint;
  v_d bigint:=current_setting('test.e2_d')::bigint;
  v_dv bigint:=current_setting('test.e2_dv')::bigint;
  v_sql text;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    format('SELECT public.fn_izo_cor_propune(''carantina_intrare'',3,%s,''{"ncr_ref":"AUTH"}'',''auth E2'')',v_b),
    format('SELECT public.fn_izo_cor_retrage(%s,1,''auth E2'')',v_c),
    format('SELECT public.fn_izo_cor_respinge(%s,1,''auth E2'')',v_c),
    format('SELECT public.fn_izo_cor_verifica(%s,NULL,NULL,NULL,NULL)',v_c),
    format('SELECT public.fn_izo_cor_aproba(%s,1)',v_c),
    format('SELECT public.fn_izo_cor_camp(%s,%s,''{"perete_mm":9}'',''auth E2'')',v_b,v_v),
    format('SELECT public.fn_izo_cor_pv(%s,%s,''PV-AUTH-2'',''2026-10-22'',''auth E2'')',v_d,v_dv)
  ] LOOP
    PERFORM teste.e2_refuz(v_sql,p_mesaj);
  END LOOP;
END $f$;
REVOKE ALL ON FUNCTION teste.e2_toate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teste.e2_toate(text) TO anon,service_role,authenticated;

-- Each of the seven API entries reaches fn_izo_cor_api_verifica from a plain
-- postgres session, without a JWT. Require its exact message, not any 42501.
SELECT set_config('request.jwt.claims','{}',true);
SELECT teste.e2_toate('E3b: doar API authenticated');

-- service_role and anon: real role switch; owner UID cannot bypass EXECUTE ACL.
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000121","role":"service_role"}',true);
SELECT teste.e2_toate();
SELECT teste.e2_refuz(format('SELECT public.fn_izo_cor_storno_import(3,''E2-auth-import'',ARRAY[%s]::bigint[],''auth E2'',''00000000-0000-0000-0000-000000000121'')',current_setting('test.e2_b')));
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT teste.e2_toate();
RESET ROLE;
RESET SESSION AUTHORIZATION;

-- Viewer without project assignment, and editor without an assignment.
INSERT INTO public.user_module_access(profile_id,module,access_level)
 VALUES('00000000-0000-0000-0000-0000000000f0','magazie','viewer');
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f0","role":"authenticated"}',true);
SELECT teste.e2_toate();
SELECT teste.e2_refuz(format('SELECT public.fn_izo_cor_storno_import(3,''E2-auth-import'',ARRAY[%s]::bigint[],''auth E2'',''00000000-0000-0000-0000-000000000121'')',current_setting('test.e2_b')));
RESET ROLE;
RESET SESSION AUTHORIZATION;
UPDATE public.user_module_access SET access_level='editor'
 WHERE profile_id='00000000-0000-0000-0000-0000000000f0' AND module='magazie';
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT teste.e2_toate();
-- Responsible 117, with a valid module+assignment, is still not the proposer.
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000117","role":"authenticated"}',true);
SELECT teste.e2_refuz(format('SELECT public.fn_izo_cor_retrage(%s,1,''alt autor E2'')',current_setting('test.e2_c')),
  'E3b: corecția nu există sau nu ai acces');
RESET ROLE;
RESET SESSION AUTHORIZATION;

-- Isolate each invalid assignment. No other assignment can authorize UID f0.
-- Each case has its own savepoint; no modifications escape this transaction.
'''
for case, project, depot, start, end, active in [
    ('expirata', 3, 11, 'current_date-10', 'current_date-1', 'true'),
    ('viitoare', 3, 11, 'current_date+1', 'NULL', 'true'),
    ('revocata', 3, 11, 'current_date', 'NULL', 'false'),
    ('alt_proiect', 2, 4, 'current_date', 'NULL', 'true'),
    ('alt_depozit', 3, 12, 'current_date', 'NULL', 'true'),
]:
    responsible = '' if case == 'alt_depozit' else f'''
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,valabil_de,valabil_pana,activ,acordat_de,motiv)
 VALUES({project},'00000000-0000-0000-0000-0000000000f0','manager_aprobator',NULL,{start},{end},{active},'test','auth responsabil {case}');
'''
    all_calls = '' if case == 'alt_depozit' else 'SELECT teste.e2_toate();'
    fixture += f'''
SAVEPOINT e2_{case};
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,valabil_de,valabil_pana,activ,acordat_de,motiv)
 VALUES({project},'00000000-0000-0000-0000-0000000000f0','gestionar',{depot},{start},{end},{active},'test','auth {case}');
{responsible}
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{{"sub":"00000000-0000-0000-0000-0000000000f0","role":"authenticated"}}',true);
{all_calls}
SELECT teste.e2_refuz(format('SELECT public.fn_izo_cor_propune(''carantina_intrare'',3,%s,''{{"ncr_ref":"AUTH"}}'',''auth {case}'')',current_setting('test.e2_b')),
 'E3b: bucata nu există sau nu ai acces');
SELECT teste.e2_refuz(format('SELECT public.fn_izo_cor_aproba(%s,1)',current_setting('test.e2_c')));
SELECT teste.e2_refuz(format('SELECT public.fn_izo_cor_camp(%s,%s,''{{"perete_mm":9}}'',''auth {case}'')',current_setting('test.e2_b'),current_setting('test.e2_v')));
RESET ROLE;
RESET SESSION AUTHORIZATION;
ROLLBACK TO e2_{case};
'''
fixture += '''
-- Strict brief 9.1: viewer WITH a current project assignment must also be
-- refused on every RPC. This distinguishes module authorization from no access.
-- Current source fn_izo_cor_verifica only checks fn_izo_citire; this assertion
-- deliberately exposes that discrepancy instead of accepting another error.
SAVEPOINT e2_viewer_atribuit;
UPDATE public.user_module_access SET access_level='viewer'
 WHERE profile_id='00000000-0000-0000-0000-0000000000f0' AND module='magazie';
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv)
 VALUES(3,'00000000-0000-0000-0000-0000000000f0','manager_aprobator',NULL,'test','viewer atribuit E2');
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000f0","role":"authenticated"}',true);
SELECT teste.e2_toate();
RESET ROLE;
RESET SESSION AUTHORIZATION;
ROLLBACK TO e2_viewer_atribuit;

DO $auth_end$ BEGIN
  IF (SELECT stare FROM public.izo_corectii WHERE id=current_setting('test.e2_c')::bigint)<>'propusa'
    OR (SELECT server_ver FROM public.magazie_bucati WHERE id=current_setting('test.e2_b')::bigint)
       IS DISTINCT FROM current_setting('test.e2_v')::bigint THEN
    RAISE EXCEPTION 'E2 auth: efecte dupa refuz';
  END IF;
  RAISE NOTICE 'TESTE E3b-E2-AUTH: TOATE OK';
END $auth_end$;
ROLLBACK;
'''
target = Path('supabase/tests/izometrie_e3b.test.sql')
base = target.read_text(encoding='utf-8').split('-- E2: autorizare')[0].rstrip()
target.write_text(base + '\n\n-- E2: autorizare pe sesiuni si roluri reale, BEGIN/ROLLBACK.\n' + fixture,
                  encoding='utf-8', newline='\n')
