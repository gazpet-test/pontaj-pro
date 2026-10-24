"""Offline regression/ownership contracts; these tests do not execute PostgreSQL."""
import hashlib
import re
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SP = Path(__file__).resolve().parent
G = runpy.run_path(str(SP / 'gen_e4c_gps.py'), run_name='e4c_test')
R = G['R']
M = (R / G['OUTPUTS'][0][1]).read_text(encoding='utf8')
V = (R / G['OUTPUTS'][1][1]).read_text(encoding='utf8')

class E4cTests(unittest.TestCase):
    def test_reproducible_and_baseline_read_only(self):
        files = list((R / 'supabase/migrations').glob('20261109*.sql')) + list((R / 'supabase/revenire').glob('20261109*.sql'))
        files += [SP / 'gen_e4a.py', SP / 'gen_e4b.py', SP / 'e4b_security.py']
        before = {p: hashlib.sha256(p.read_bytes()).digest() for p in files}
        subprocess.run([sys.executable, str(SP / 'gen_e4c_gps.py')], check=True, capture_output=True)
        self.assertEqual(before, {p: hashlib.sha256(p.read_bytes()).digest() for p in files})
        for template, dest in G['OUTPUTS']:
            self.assertEqual((R / dest).read_bytes(), G['render'](template).encode('utf8'))

    def test_exact_restore_and_live_hashes(self):
        raw = (R / 'supabase/migrations/20261109b_izometrie_e4b_teren.sql').read_text(encoding='utf8')
        for name in ['fn_izo_teren_imuabil', 'fn_izo_porti_e4b_definitii', 'fn_izo_porti_e4_lipsa']:
            # Independent extractor: account for E4b's varying header indentation.
            live = re.search(r'CREATE (?:OR REPLACE )?FUNCTION public\.' + name + r'\(.*?AS \$f\$(.*?)\$f\$;', raw, re.S)[1]
            restored = G['src'](G['block'](V, name))
            self.assertEqual(live, restored, name)
            digest = hashlib.md5(live.encode()).hexdigest()
            self.assertIn(digest, M)
            self.assertIn(digest, V)

    def test_guard_preserves_refusal_and_scopes_record_access(self):
        body = G['src'](G['new_guard'])
        self.assertTrue(body.endswith(G['src'](G['old_guard']).split('BEGIN ', 1)[1]))
        self.assertIn("TG_OP='DELETE' THEN\n IF current_user='izo_montaj_writer'", body)
        self.assertIn('txid_current(),OLD.declaratie_id,OLD.versiune', body)
        self.assertIn("THEN d.updated_at ELSE d.decis_la END < now()-interval '60 days'", body)

    def test_owners_for_all_mutations_of_writer_functions(self):
        for sql in [M, V]:
            active = 'postgres'
            owners = {'fn_izo_teren_imuabil': 'izo_montaj_writer', 'fn_izo_gps_curata': 'postgres'}
            if sql is V:
                owners['fn_izo_gps_curata'] = 'izo_montaj_writer'
            pattern = r'SET LOCAL ROLE (\w+);|RESET ROLE;|CREATE OR REPLACE FUNCTION public\.(\w+)|ALTER FUNCTION public\.(\w+)\([^;]*?\) OWNER TO (\w+);|(?:DROP FUNCTION|(?:GRANT|REVOKE) [^;\n]* ON FUNCTION) public\.(\w+)'
            for item in re.finditer(pattern, sql):
                if item[1]:
                    active = item[1]
                elif item[0] == 'RESET ROLE;':
                    active = 'postgres'
                else:
                    name = item[2] or item[3] or item[5]
                    self.assertEqual(active, owners.get(name, 'postgres'), item[0])
                    if item[3]:
                        owners[name] = item[4]

    def test_fingerprint_covers_journal_and_sequence_and_inventory(self):
        gate = G['new_gate']
        self.assertEqual(gate.count("'izo_gps_stergeri'"), G['old_gate'].count("'izo_declaratii_gps'"))
        self.assertIn("'izo_gps_stergeri_id_seq'", gate)
        self.assertIn("'public.izo_gps_stergeri_id_seq'::regclass", G['new_seq_gate'])
        self.assertEqual(len(set(G['post']) - set(G['pre'])), 4)
        self.assertEqual(len(G['post']), len(set(G['post'])))
        self.assertLess(M.index('E4c baseline porti'), M.index('CREATE TABLE'))
        self.assertEqual(M.count('E4c inventar implicit:'), 3)
        self.assertEqual(V.count('E4c inventar implicit:'), 3)

    def test_privacy_batch_context_and_atomicity_contract(self):
        self.assertIn('GRANT SELECT(declaratie_id,versiune),DELETE', M)
        self.assertNotRegex(M, r'GRANT SELECT\s+ON public.izo_declaratii_gps')
        table = M.split('CREATE TABLE public.izo_gps_stergeri (', 1)[1].split(');', 1)[0]
        self.assertNotRegex(table, r'\b(lat|lon|precizie_m|payload)\b')
        body = G['src'](G['block'](M, 'fn_izo_gps_curata'))
        self.assertNotRegex(body, r'\b(lat|lon|precizie_m)\b')
        self.assertIn('LIMIT p_limita FOR SHARE OF d SKIP LOCKED', body)
        self.assertIn("pg_advisory_xact_lock(hashtext('izo.gps_curatare'))", body)
        self.assertLess(body.index('DELETE FROM'), body.index('INSERT INTO'))
        self.assertIn('IF v_deleted=1 THEN', body)
        self.assertEqual(body.count("set_config('izo.gps_curata_ctx',coalesce(v_old_ctx,''),true)"), 2)
        self.assertIn('SECURITY DEFINER SET search_path = public, pg_temp', M)
        self.assertIn('REVOKE ALL ON FUNCTION public.fn_izo_gps_curata(integer) FROM PUBLIC,anon,authenticated,service_role;', M)

    def test_cron_and_harness_delivery_rollback(self):
        self.assertIn("cron.schedule('izo_gps_curatare_zilnic','23 3 * * *','SELECT public.fn_izo_gps_curata();')", M)
        self.assertIn("cron.unschedule('izo_gps_curatare_zilnic')", V)
        self.assertLess(V.index('IF EXISTS(SELECT 1 FROM public.izo_gps_stergeri)'), V.index('DROP TABLE'))
        h = (R / 'scripts/test_izometrie_e4c_gps.sh').read_text(encoding='utf8')
        for term in ['test_izometrie_e4b.sh', 'export IZO_E4B_PROD_LIKE=1', 'livreaza 20261111120000', 'livreaza 20261111120001', 'gps_baseline', 'control_0e.sql', 'E4C_GPS_TEST_END']:
            self.assertIn(term, h)
        tests = (R / 'supabase/tests/izometrie_e4c_gps.test.sql').read_text(encoding='utf8')
        self.assertTrue(tests.rstrip().endswith("SELECT 'E4C_GPS_TEST_END';"))
        self.assertNotRegex(tests, r'(?im)^\s*(GRANT|REVOKE|ALTER TABLE)\b')

    def test_delivery_validator_forward_and_armed_rollback(self):
        validator = runpy.run_path(str(R / 'scripts/livrare_validator.py'), run_name='e4c_validator')
        self.assertEqual(validator['valideaza'](str(R / G['OUTPUTS'][0][1])), 1)
        harness = (R / 'scripts/test_izometrie_e4c_gps.sh').read_text(encoding='utf8')
        arm = harness.split("<<'SQL'\n", 1)[1].split('\nSQL\n', 1)[0]
        # Temporary artifacts are confined to the worktree, including on Windows.
        with tempfile.TemporaryDirectory(prefix='e4c_validation_', dir=SP) as folder:
            artifact = Path(folder) / '20261111a_izometrie_gps_test_revenire.sql'
            artifact.write_text(arm + '\n' + V, encoding='utf8', newline='\n')
            self.assertEqual(validator['valideaza'](str(artifact)), 2)

if __name__ == '__main__':
    unittest.main()
