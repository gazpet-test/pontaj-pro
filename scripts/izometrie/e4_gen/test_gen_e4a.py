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

    def test_no_api_write_entry_is_granted(self):
        tpl=(SP / 'e4a_tpl.sql').read_text(encoding='utf-8')
        self.assertNotRegex(tpl,r'GRANT EXECUTE[^;]*TO (?:anon|authenticated|service_role)')
        self.assertNotIn('user_module_access',tpl)
        self.assertNotIn('CREATE OR REPLACE FUNCTION',tpl)
        self.assertIn("server_ver bigint NOT NULL DEFAULT nextval('public.izo_server_ver_seq')",tpl)

if __name__ == '__main__':
    unittest.main()
