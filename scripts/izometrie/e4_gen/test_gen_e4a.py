"""Offline invariants; no PostgreSQL invocation."""
import hashlib
import runpy
import unittest
from pathlib import Path

SP = Path(__file__).resolve().parent
G = runpy.run_path(str(SP / 'gen_e4a.py'), run_name='e4_test')
R = G['R']

class GeneratorTests(unittest.TestCase):
    def test_outputs_are_template_renderings(self):
        for tpl, output in [('e4a_tpl.sql','supabase/migrations/20261109a_izometrie_e4a_flux.sql'),
                            ('e4a_rev_tpl.sql','supabase/revenire/20261109a_izometrie_e4a_flux_ROLLBACK.sql')]:
            expected = (SP / tpl).read_text(encoding='utf-8')
            for key, value in G['values'].items():
                expected = expected.replace('@@' + key + '@@', value)
            self.assertNotIn('@@', expected)
            self.assertEqual(expected, (R / output).read_text(encoding='utf-8'))

    def test_restore_is_exact_live_body(self):
        old = G['old']
        rev = (R / 'supabase/revenire/20261109a_izometrie_e4a_flux_ROLLBACK.sql').read_text(encoding='utf-8')
        self.assertEqual(G['src'](G['block'](rev,'fn_izo_porti_lipsa')), G['src'](old))
        self.assertIn(hashlib.md5(G['src'](old).encode()).hexdigest(), rev)

    def test_authorized_delta_is_fixed_and_unique(self):
        self.assertEqual(len(G['implicit']),8)
        self.assertEqual(len(set(G['implicit'])),8)
        tpl=(SP / 'e4a_tpl.sql').read_text(encoding='utf-8')
        self.assertEqual(tpl.count('@@IMPL_POST@@'),2)
        self.assertLess(tpl.index('@@IMPL_PRE@@'),tpl.index('CREATE ROLE'))
        self.assertLess(tpl.index('@@IMPL_POST@@'),tpl.index("EXECUTE format('COMMENT ON FUNCTION"))

    def test_api_wrappers_and_internal_context_are_separate(self):
        tpl=(SP / 'e4a_tpl.sql').read_text(encoding='utf-8')
        self.assertNotRegex(tpl,r'GRANT EXECUTE[^;]*TO (?:anon|authenticated|service_role)')
        self.assertNotIn('CREATE OR REPLACE FUNCTION',tpl)
        self.assertIn("server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq')",tpl)
        pkg=(SP / 'e4a_pachet_tpl.sql').read_text(encoding='utf-8')
        for name in ('fn_izo_pachet_leaga','fn_izo_pachet_dezleaga','fn_izo_pachet_completeaza'):
            body=G['src'](G['block'](pkg,name))
            self.assertNotRegex(body.lower(), r'set_config|request[.]jwt|\bexecute\b')
        self.assertIn("module='executie.izometrie'",pkg)
        self.assertNotRegex(pkg,r'(?:INSERT INTO|UPDATE|DELETE FROM) public.user_module_access')

    def test_registry_guard_restore_and_lock_order(self):
        rev=(R / 'supabase/revenire/20261109a_izometrie_e4a_flux_ROLLBACK.sql').read_text(encoding='utf-8')
        self.assertEqual(G['block'](rev,'fn_izo_garda_bucati'),G['old_bucati'])
        pkg=(SP / 'e4a_pachet_tpl.sql').read_text(encoding='utf-8')
        lock=G['src'](G['block'](pkg,'fn_izo_flux_pachet_lock'))
        self.assertLess(lock.index('fn_izo_blocheaza_locuri'),lock.index('FOR NO KEY UPDATE'))
        self.assertLess(lock.index('FOR NO KEY UPDATE'),lock.index('fn_izo_blocheaza_tabele'))
        self.assertLess(lock.index('fn_izo_blocheaza_tabele'),lock.index('fn_izo_lock_partajat'))
        link=G['src'](G['block'](pkg,'fn_izo_flux_pachet_legatura'))
        self.assertLess(link.index('fn_izo_flux_pachet_lock'),link.index('FOR UPDATE'))
        self.assertIn('bucata_deja_legata',link)

    def test_both_registry_guards_are_live_plus_only_the_montaj_term(self):
        migration=(R / 'supabase/migrations/20261109a_izometrie_e4a_flux.sql').read_text(encoding='utf-8')
        rollback=(R / 'supabase/revenire/20261109a_izometrie_e4a_flux_ROLLBACK.sql').read_text(encoding='utf-8')
        for name in ('fn_izo_garda_bucati','fn_izo_garda_fapte'):
            baseline=G['block'](G['live'],name)
            changed=G['block'](migration,name)
            self.assertEqual(changed.count(G['montaj_term']),1)
            self.assertEqual(changed.replace(G['montaj_term'],''),baseline)
            self.assertEqual(G['block'](rollback,name),baseline)
            digest=hashlib.md5(G['src'](baseline).encode()).hexdigest()
            self.assertIn(digest,migration)  # md5 precondition before DDL
            self.assertIn(digest,rollback)   # exact restore postcondition

    def test_marker_is_private_and_guard_is_fail_closed(self):
        pkg=(SP / 'e4a_pachet_tpl.sql').read_text(encoding='utf-8')
        helpers=(SP / 'e4a_montaj_tpl.sql').read_text(encoding='utf-8')
        self.assertNotIn('set_config',pkg)
        marker=G['src'](G['block'](helpers,'fn_izo_montaj_marcheaza'))
        self.assertIn("current_user <> 'izo_montaj_writer'",marker)
        self.assertEqual(marker.count('set_config'),4)
        self.assertIn('OWNER TO izo_montaj_writer',helpers)
        self.assertNotRegex(helpers,r'GRANT EXECUTE[^;]*TO (?:authenticated|anon|service_role|PUBLIC)')
        guard=G['src'](G['block'](helpers,'fn_izo_garda_montaj'))
        self.assertNotIn('RETURN false',guard)
        self.assertIn("p_tabel='magazie_bucati' AND p_op='UPDATE'",guard)
        self.assertIn("USING ERRCODE='42501'",guard)
        self.assertNotIn('LIKE',guard)
        for part in ('txid_current()',"p_inainte->>'proiect_id'","p_inainte->>'tronson_id'",
                     "p_dupa->>'server_ver'","p_inainte->>'id'"):
            self.assertIn(part,guard)
        link=G['src'](G['block'](pkg,'fn_izo_flux_pachet_legatura'))
        self.assertLess(link.index('fn_izo_montaj_marcheaza(v_ctx'),link.index('UPDATE public.magazie_bucati'))
        self.assertIn('executie_teava_id=v_dupa.executie_teava_id',link)
        self.assertIn('fn_izo_montaj_marcheaza(NULL,NULL,NULL,NULL)',link)
        complete=G['src'](G['block'](pkg,'fn_izo_flux_pachet_completeaza'))
        self.assertNotIn('UPDATE ',complete)
        self.assertNotIn('fn_izo_montaj_marcheaza',complete)
        self.assertIn("RAISE EXCEPTION 'completare_necesita_E4b_suduri_capete_jurnal'",complete)

    def test_before_generated_projection_keeps_exact_stored_comparisons(self):
        helpers=(SP / 'e4a_montaj_tpl.sql').read_text(encoding='utf-8')
        guard=G['src'](G['block'](helpers,'fn_izo_garda_montaj'))
        # Only these STORED columns lack their values in BEFORE NEW. No source or
        # stamp is removed from either exact snapshot comparison.
        self.assertIn("p_dupa->'serie_canon' = 'null'::jsonb",guard)
        self.assertIn("p_dupa->'lungime_cm' = 'null'::jsonb",guard)
        self.assertIn("v_dupa_comparabil:=p_dupa || jsonb_build_object(\n"
                      "        'serie_canon',p_inainte->'serie_canon','lungime_cm',p_inainte->'lungime_cm')",guard)
        self.assertIn("::jsonb=p_inainte",guard)
        self.assertIn("::jsonb=v_dupa_comparabil",guard)
        self.assertIn("(p_inainte-ARRAY['executie_teava_id','server_ver','updated_at'])=\n"
                      "            (v_dupa_comparabil-ARRAY['executie_teava_id','server_ver','updated_at'])",guard)
        self.assertNotIn("p_dupa-ARRAY",guard)
        pkg=(SP / 'e4a_pachet_tpl.sql').read_text(encoding='utf-8')
        link=G['src'](G['block'](pkg,'fn_izo_flux_pachet_legatura'))
        self.assertIn('fn_izo_montaj_marcheaza(v_ctx,to_jsonb(v_b),to_jsonb(v_dupa),to_jsonb(v_t))',link)
        self.assertNotIn('v_dupa.serie_canon:=',link)
        self.assertNotIn('v_dupa.lungime_cm:=',link)
        fixture=(R / 'supabase/tests/izometrie_e4a_pachet.test.sql').read_text(encoding='utf-8')
        for label in ('generated regression fixture invalid','BEFORE generated projection refused',
                      'writer forged coordinate accepted','writer wrong stamp accepted',
                      'writer stale before accepted','writer forged generated image accepted',
                      'writer immutable source accepted','second server link failed',
                      'second unlink changed registry data'):
            self.assertIn(label,fixture)
        self.assertIn('FOR v_i IN 1..7 LOOP',fixture)
        self.assertIn('SELECT jsonb_object_keys(to_jsonb(v_b)-ARRAY[',fixture)

    def test_sql_regression_covers_client_forgery_and_private_writer(self):
        fixture=(R / 'supabase/tests/izometrie_e4a_pachet.test.sql').read_text(encoding='utf-8')
        self.assertNotRegex(fixture,r'(?im)^\s*(GRANT|REVOKE)\b')
        for label in ('client link accepted','client forged context accepted','writer without context accepted',
                      'writer wrong transaction accepted','writer changed projection accepted',
                      'private marker exposed','unlink changed registry data','link changed registry data'):
            self.assertIn(label,fixture)

    def test_client_refusal_checks_affected_rows_and_real_fixture(self):
        fixture=(R / 'supabase/tests/izometrie_e4a_pachet.test.sql').read_text(encoding='utf-8')
        # UPDATE can succeed with zero affected rows under restrictive RLS.
        # Each client mutation must fail the regression if even one row is touched.
        for label in ('client link accepted','client forged context accepted',
                      'client unlink accepted','client relink accepted'):
            end=fixture.index("RAISE EXCEPTION '"+label+"'")
            start=fixture.rfind('UPDATE public.magazie_bucati',0,end)
            statement=fixture[start:end]
            self.assertIn('GET DIAGNOSTICS v_randuri = ROW_COUNT;',statement)
            self.assertIn('IF v_randuri <> 0 THEN',statement)
        self.assertIn('INTO STRICT v_inainte',fixture)
        self.assertIn("current_user <> 'authenticated' OR session_user <> 'authenticator'",fixture)
        self.assertIn('client refusal fixture invalid',fixture)
        self.assertIn('client unlink or relink changed piece',fixture)
        self.assertIn("SET serie_unica='LEGACY-PICKER',lungime_m=12",fixture)
        self.assertIn('INTO STRICT v_dupa',fixture)  # UPDATE 0 must fail the positive control.

    def test_e4a_2c_preserves_restamping_and_registry_authorization(self):
        migration=(R / 'supabase/migrations/20261109a_izometrie_e4a_flux.sql').read_text(encoding='utf-8')
        # No link-only picker exemption in the reviewed registry guard.
        self.assertNotIn('executie_teava_id',G['new_bucati'])
        self.assertIn("v_aut IS NOT TRUE AND current_user = 'izo_montaj_writer'",G['new_bucati'])
        for name in ('fn_izo_porti_definitii','fn_izo_porti_e3_definitii',
                     'fn_izo_porti_e3b_definitii','fn_izo_porti_e4_definitii'):
            stamp="EXECUTE format('COMMENT ON FUNCTION public."+name
            self.assertIn(stamp,migration)
            self.assertGreater(migration.index(stamp),migration.index(G['new_bucati']))

if __name__ == '__main__':
    unittest.main()
