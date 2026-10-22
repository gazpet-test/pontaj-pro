# Verificări fără PostgreSQL / rețea. Rulează: python scripts/izometrie/e3b_gen/test_gen_e3b.py
import hashlib
import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import unittest

sys.dont_write_bytecode = True
SP = Path(__file__).resolve().parent
R = SP.parents[2]
spec = importlib.util.spec_from_file_location('e3b', SP / 'gen_e3b.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class GeneratorTest(unittest.TestCase):
    def test_generare_idempotenta_si_live_neatins(self):
        live = [g.E2, g.E3, R / 'supabase/migrations/20261102c_izometrie_cai_vechi_stoc.sql']
        outputs = [R / 'supabase/migrations/20261105a_izometrie_e3b_corectii.sql',
                   R / 'supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql']
        digest = lambda ps: [hashlib.sha256(p.read_bytes()).hexdigest() for p in ps]
        before = digest(live)
        subprocess.run([sys.executable, str(SP / 'gen_e3b.py')], check=True)
        first = digest(outputs)
        subprocess.run([sys.executable, str(SP / 'gen_e3b.py')], check=True)
        self.assertEqual(first, digest(outputs))
        self.assertEqual(before, digest(live))
        for p in outputs:
            self.assertNotIn(b'\r', p.read_bytes())
            text = p.read_text(encoding='utf-8')
            self.assertNotIn('@@', text)
            for tag in set(re.findall(r'\$[a-zA-Z_]*\$', text)):
                self.assertEqual(text.count(tag) % 2, 0, tag)

    def test_bloc_exact_prosrc_si_revenire(self):
        old = g.BLOCURI_VECHI['fn_izo_porti_lipsa']
        self.assertIn(old, g.e3)
        self.assertEqual(g.md5(g.prosrc(old)), g.MD5_VECHI['fn_izo_porti_lipsa'])
        mig = (R / 'supabase/migrations/20261105a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
        new = g.bloc_functie(mig, 'fn_izo_porti_lipsa')
        self.assertEqual(g.prosrc(new).replace('    v := v || public.fn_izo_porti_e3b_lipsa();\n', ''), g.prosrc(old))
        self.assertEqual(g.prosrc(g.bloc_functie(rev, 'fn_izo_porti_lipsa')), g.prosrc(old))
        for n in g.BLOCURI_VECHI:
            if n != 'fn_izo_porti_lipsa':
                self.assertNotRegex(mig, r'CREATE (?:OR REPLACE )?FUNCTION public\.' + n + r'\(')

    def test_contract_lista_si_invocari(self):
        self.assertEqual(len(g.INS), len(set(g.INS)))
        self.assertEqual(set(g.INS), set(g.C) | {'id', 'uid', 'radacina_id', 'server_ver'})
        self.assertEqual(set(g.UPD), set(g.L_TEAVA + g.L_CURBA + g.D + ['stare', 'depozit_id', 'server_ver', 'updated_at']))
        self.assertFalse(set(g.L_TEAVA + g.L_CURBA) & set(g.D))
        self.assertEqual(len(g.IMPL_POST), len(set(g.IMPL_POST)))
        self.assertEqual(set(g.IMPL_POST) - set(g.IMPL_PRE), set(g.IMPL_E3B))
        self.assertEqual(len(g.IMPL_E3B), 7)  # piesa A: doar politici, zero trigger-e noi
        self.assertNotIn('public.fn_izo_doc_api_verifica()', g.FUNCTII)
        for fn in ['fn_izo_jwt_rol()', 'fn_izo_uid()', 'fn_izo_porti_lipsa()']:
            self.assertEqual(set(g.FUNCTII['public.' + fn]), set(g.ROLURI))


if __name__ == '__main__':
    unittest.main()
