"""Verificari locale fara BD. NU valideaza semantica SQL/PLpgSQL."""
import hashlib
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / 'scripts/izometrie/e3b_build_garzi.py'
SQL = ROOT / 'supabase/tests/izometrie_e3b_garzi.sql'


def statements(text):
    """Separa doar SQL exterior; verifica delimitatorii, fara a interpreta SQL."""
    out, start, i, depth = [], 0, 0, 0
    while i < len(text):
        if text.startswith('--', i):
            end = text.find('\n', i)
            i = len(text) if end < 0 else end + 1
            continue
        if text.startswith('/*', i):
            end = text.find('*/', i + 2)
            if end < 0:
                raise AssertionError('comentariu neterminat')
            i = end + 2
            continue
        if text[i] in "'\"":
            delimiter = text[i]
            i += 1
            while i < len(text):
                if text[i] == delimiter:
                    i += 1
                    if i < len(text) and text[i] == delimiter:
                        i += 1
                        continue
                    break
                i += 1
            else:
                raise AssertionError('literal neterminat')
            continue
        tag = re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$', text[i:])
        if tag:
            delimiter = tag[0]
            end = text.find(delimiter, i + len(delimiter))
            if end < 0:
                raise AssertionError(f'dollar quote neterminat: {delimiter}')
            # Continutul este PLpgSQL; putem verifica numai delimitatorii lui.
            statements(text[i + len(delimiter):end])
            i = end + len(delimiter)
            continue
        if text[i] == '(':
            depth += 1
        elif text[i] == ')':
            depth -= 1
            if depth < 0:
                raise AssertionError('paranteza inchisa fara deschidere')
        elif text[i] == ';' and depth == 0:
            out.append(text[start:i + 1])
            start = i + 1
        i += 1
    if depth:
        raise AssertionError('paranteze neechilibrate')
    if text[start:].strip():
        out.append(text[start:])
    return out


class GarziStatic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text(encoding='utf-8')

    def test_generation_repetable_without_migration_changes(self):
        protected = list((ROOT / 'supabase/migrations').glob('*izometrie*.sql'))
        protected += list((ROOT / 'scripts/izometrie/e3b_gen').glob('*.*'))
        digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
        before = {p: digest(p) for p in protected}
        for _ in range(2):
            subprocess.run([sys.executable, str(BUILDER)], cwd=ROOT, check=True, capture_output=True)
            self.assertEqual(SQL.read_text(encoding='utf-8'), self.sql)
        self.assertEqual(before, {p: digest(p) for p in protected})

    def test_all_fixtures_rollback(self):
        active = False
        blocks = 0
        for stmt in statements(self.sql):
            clean = re.sub(r'--[^\n]*', '', stmt).strip()
            if clean == 'BEGIN;':
                self.assertFalse(active)
                active = True
                blocks += 1
            elif clean == 'ROLLBACK;':
                self.assertTrue(active)
                active = False
            else:
                self.assertFalse(re.match(r'COMMIT\b', clean, re.I))
                if not active:
                    self.assertTrue(clean.startswith('DO $'), clean[:100])
        self.assertFalse(active)
        self.assertEqual(blocks, 14)

    def test_import_payloads_match_real_fixture(self):
        payloads = re.findall(r"fn_izo_activeaza_si_importa\(3,'[^']+','(.*?)'::jsonb", self.sql)
        self.assertEqual(len(payloads), 14)  # un import pe bloc (E2a: un singur import pe tranzacție); bucata străină e scrisă direct
        for payload in payloads:
            value = json.loads(payload)
            self.assertRegex(value['surse'][0]['sha256'], r'^[a-f0-9]{64}$')
            rows = [b['sursa']['rand'] for b in value['bucati']]
            self.assertEqual(len(rows), len(set(rows)))
            for b in value['bucati']:
                self.assertEqual(b['depozit_id'], 11)
                self.assertTrue(b.get('lungime_mm') or b.get('unghi_curba'))

    def test_harness_requires_new_marker_after_main_suite(self):
        harness = (ROOT / 'scripts/test_izometrie_e3b.sh').read_text(encoding='utf-8')
        self.assertLess(harness.index('supabase/tests/izometrie_e3b.test.sql'),
                        harness.index('supabase/tests/izometrie_e3b_garzi.sql'))
        self.assertIn("grep -qF 'TESTE E3b-E3: TOATE OK'", harness)
        self.assertEqual(self.sql.count('TESTE E3b-E3: TOATE OK'), 1)
        self.assertNotIn('@@', self.sql)

    def test_projection_update_uses_existing_piece_and_real_update(self):
        block = self.sql.split('-- §9.4 proiectie UPDATE C (51 coloane)', 1)[1].split('-- §9.4 proiectie INSERT C', 1)[0]
        self.assertIn("v_n:=current_setting('test.e3_b')::bigint", block)
        self.assertIn("format('SELECT teste.e3_upd(%s,%L)',v_n,v_bad)", block)
        self.assertIn('FOREACH v_k IN ARRAY public.fn_izo_coloane_c()', block)
        self.assertNotIn('v_n:=public.fn_izo_cor_marcheaza(v_c.id)', block)
        self.assertIn('UPDATE public.magazie_bucati SET (%s)=(SELECT %s) WHERE id=$2', block)


if __name__ == '__main__':
    unittest.main()
