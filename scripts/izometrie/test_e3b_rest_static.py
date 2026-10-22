"""Verificari fara BD; nu reprezinta validare semantica SQL/PLpgSQL."""
import hashlib
import re
import subprocess
import sys
import unittest
from pathlib import Path
from test_e3b_garzi_static import statements

ROOT = Path(__file__).resolve().parents[2]
SQL = ROOT / 'supabase/tests/izometrie_e3b_rest.sql'
BUILDER = ROOT / 'scripts/izometrie/e3b_build_rest.py'


class RestStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text(encoding='utf-8')

    def test_reproducible_and_protected_sources_unchanged(self):
        protected = [ROOT / 'supabase/tests/izometrie_e3b_garzi.sql']
        for folder in ('supabase/migrations', 'supabase/revenire', 'scripts/izometrie/e3b_gen'):
            protected += [p for p in (ROOT / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
        digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
        before = {p: digest(p) for p in protected}
        for _ in range(2):
            subprocess.run([sys.executable, str(BUILDER)], cwd=ROOT, check=True, capture_output=True)
            self.assertEqual(SQL.read_text(encoding='utf-8'), self.sql)
        self.assertEqual(before, {p: digest(p) for p in protected})

    def test_transactions_delimiters_and_single_import(self):
        active, imports, blocks = False, 0, 0
        for stmt in statements(self.sql):
            clean = re.sub(r'--[^\n]*', '', stmt).strip()
            if clean == 'BEGIN;':
                self.assertFalse(active)
                active, imports = True, 0
                blocks += 1
            elif clean == 'ROLLBACK;':
                self.assertTrue(active)
                self.assertLessEqual(imports, 1)
                active = False
            else:
                self.assertFalse(re.match(r'COMMIT\b', clean, re.I))
                if clean.startswith('SELECT public.fn_izo_activeaza_si_importa('):
                    imports += 1
                if not active:
                    self.assertTrue(clean.startswith('DO $safe$'), clean[:100])
        self.assertFalse(active)
        self.assertEqual(blocks, 28)
        self.assertNotIn('@@', self.sql)

    def test_gate_mutations_all_probe_required_entries(self):
        gates = self.sql.split('-- §9.13 ')[1:]
        self.assertEqual(len(gates), 8)
        for gate in gates:
            gate = gate.split('ROLLBACK;', 1)[0]
            for entry in ('fn_izo_cor_propune', 'fn_izo_cor_storno_import', 'fn_izo_doc_salveaza',
                          'fn_izo_seteaza_nivel', 'fn_izo_activeaza_si_importa',
                          'fn_izo_import_storno', 'fn_izo_import_sold_initial'):
                self.assertIn('SELECT teste.e3_refuz', gate)
                self.assertIn(entry, gate)
            self.assertIn('poarta trebuie verde', gate)
            self.assertIn('E4 mutatie nedetectata', gate)
        self.assertIn("x LIKE '%wrapper nerevizuit%'", self.sql)

    def test_supplementary_import_does_not_prelock_destination(self):
        case = self.sql.split('-- §9.9 serie eliberata:', 1)[1].split('ROLLBACK;', 1)[0]
        self.assertIn("_seq'),2,1,'teava'", case)
        self.assertIn("VALUES(2,'stoc'", case)
        self.assertIn("fn_izo_activeaza_si_importa(3,'E4-suplimentar'", case)
        self.assertNotIn("fn_izo_activeaza_si_importa(3,'E3-import'", case)

    def test_atomicity_has_real_failure_and_checks_exact_constraint(self):
        for stage in (1, 2, 3):
            case = self.sql.split('-- §9.16 atomicitate dupa etapa ' + str(stage), 1)[1].split('ROLLBACK;', 1)[0]
            self.assertIn('CREATE DOMAIN teste.e4_positive', case)
            self.assertIn('PERFORM (-1)::teste.e4_positive', case)
            self.assertIn("v_constraint<>'e4_positive_check'", case)
            self.assertIn('ARRAY[false,true]', case)
            self.assertIn('test.e4_atom_before', case)
            self.assertNotIn('GRANT UPDATE', case)
            self.assertNotIn('ALTER TABLE', case)

    def test_harness_checks_marker_after_e3(self):
        harness = (ROOT / 'scripts/test_izometrie_e3b.sh').read_text(encoding='utf-8')
        self.assertLess(harness.index('supabase/tests/izometrie_e3b_garzi.sql'),
                        harness.index('supabase/tests/izometrie_e3b_rest.sql'))
        self.assertIn("grep -qF 'TESTE E3b-E4: TOATE OK'", harness)
        self.assertEqual(self.sql.count('TESTE E3b-E4: TOATE OK'), 1)


if __name__ == '__main__':
    unittest.main()
