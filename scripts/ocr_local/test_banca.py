"""Teste pentru banca fara om (Jakarinos #721 r2): localizarea fata de tinta inghetata, legatura cu esantionul, normalizarea fara
numere schimbate, schema etichetelor, auditul trecerii B. Fara retea, fara modele."""
import json, pathlib, tempfile, unittest
from ocr_local import banca as B


def eticheta(sus, jos, text='abc', **k):
    return dict({'zona': 'z01', 'tinta': 'unica', 'incredere': 'sigur', 'vecin_sus': sus, 'vecin_jos': jos, 'transcriere': text,
                 'continut': ['text']}, **k)


ZONA = {'zona': 'd1_p1_b0_t0', 'tip_zona': 'text', 'localizare': 'unica', 'ancora_sus': 'energie electrică ,', 'ancora_jos': 'catodică și fibră'}


class Localizare(unittest.TestCase):
    def test_ancorele_tintei(self):
        self.assertTrue(B.localizare_ok(eticheta('energie electrică,', 'catodică şi fibră'), ZONA))  # spatii, ş=ș
        self.assertFalse(B.localizare_ok(eticheta('alt loc de pe pagina', 'catodică și fibră'), ZONA))
        self.assertFalse(B.localizare_ok(eticheta('energie electrică,', 'catodică și fibră', vecin_jos=None), ZONA))

    def test_margine_cere_placeholder(self):
        z = dict(ZONA, ancora_sus=None)
        self.assertTrue(B.localizare_ok(eticheta('(inceputul paginii / tabelului)', 'catodică și fibră'), z))
        self.assertFalse(B.localizare_ok(eticheta('energie electrică,', 'catodică și fibră'), z))

    def test_doua_etichete_identice_pe_zona_gresita_nu_dau_acord(self):
        with tempfile.TemporaryDirectory() as t:
            b = self._banca(pathlib.Path(t), eticheta('alt loc de pe pagina', 'catodică și fibră'), eticheta('alt loc de pe pagina', 'catodică și fibră'))
            B.cmd_compara(type('A', (), {'banca': str(b), 'x': 'A', 'y': 'B'}))
            self.assertEqual(json.loads((b / 'compara_A_B.json').read_text(encoding='utf-8')), {ZONA['zona']: 'localizare_gresita_A'})

    def test_tinta_ambigua_nu_se_masoara(self):
        with tempfile.TemporaryDirectory() as t:
            e = eticheta('energie electrică,', 'catodică și fibră')
            b = self._banca(pathlib.Path(t), e, e, zona=dict(ZONA, localizare='ambigua'))
            B.cmd_compara(type('A', (), {'banca': str(b), 'x': 'A', 'y': 'B'}))
            self.assertEqual(json.loads((b / 'compara_A_B.json').read_text(encoding='utf-8')), {ZONA['zona']: 'tinta_ambigua'})

    @staticmethod
    def _banca(root, ea, eb, zona=ZONA):
        (root / 'priv').mkdir(); (root / 'esantion.json').write_text(json.dumps({'zone': [dict(zona, strat='text+fara')]}), encoding='utf-8')
        for tr, e in (('A', ea), ('B', eb)):
            (root / 'priv' / ('harta_%s.json' % tr)).write_text(json.dumps({'lot01/z01': zona['zona']}), encoding='utf-8')
            B._scrie_legatura(root, tr)
            (root / 'out' / tr).mkdir(parents=True)
            (root / 'out' / tr / 'lot01.json').write_text(json.dumps({'meta': {'secunde': 1}, 'etichete': [e]}), encoding='utf-8')
        return root


class Legatura(unittest.TestCase):
    def test_esantion_rescris_refuzat(self):
        with tempfile.TemporaryDirectory() as t:
            e = eticheta('energie electrică,', 'catodică și fibră')
            b = Localizare._banca(pathlib.Path(t), e, e)
            (b / 'esantion.json').write_text(json.dumps({'zone': [dict(ZONA, strat='text+fara', ancora_sus='alta')]}), encoding='utf-8')
            with self.assertRaises(SystemExit): B._etichete(b, 'A')
            with self.assertRaises(SystemExit): B.cmd_raport(type('A', (), {'banca': str(b), 'trecere': 'A'}))

    def test_rezultat_pentru_alt_esantion_invalid(self):
        with tempfile.TemporaryDirectory() as t:
            e = eticheta('energie electrică,', 'catodică și fibră')
            b = Localizare._banca(pathlib.Path(t), e, e)
            f = b / 'out' / 'A' / 'lot01.json'; d = json.loads(f.read_text(encoding='utf-8')); d['meta']['esantion_sha256'] = '0' * 64
            f.write_text(json.dumps(d), encoding='utf-8')
            out, meta = B._etichete(b, 'A')
            self.assertEqual(out, {}); self.assertEqual(meta['lot01']['invalid'], 'alt esantion')

    def test_fara_legatura_refuzat(self):
        with tempfile.TemporaryDirectory() as t:
            e = eticheta('energie electrică,', 'catodică și fibră')
            b = Localizare._banca(pathlib.Path(t), e, e); (b / 'priv' / 'legatura_A.json').unlink()
            with self.assertRaises(SystemExit): B._etichete(b, 'A')


class Normalizare(unittest.TestCase):
    def test_constante_separate(self):
        self.assertEqual((B.ANCORA_MIN, B.ANCORA_NORM_MIN), (3, 8))

    def test_numere_la_granita(self):
        self.assertFalse(B._ancora_ok('1|Materiale', '11|Materiale', -1))
        self.assertFalse(B._ancora_ok('Total|1000', 'Total|10000', 1))
        self.assertTrue(B._ancora_ok('C.MEDIAȘabc', 'D.P.C.MEDIAȘabc', -1))

    def test_schema_incompleta_neeligibila(self):
        self.assertIsNone(B.cheie({'tinta': 'unica', 'incredere': 'sigur'}, 'text'))
        self.assertIsNotNone(B.cheie(eticheta('a', 'b', text='', continut=['gol']), 'text'))
        self.assertIsNone(B.cheie(eticheta('a', 'b', text=''), 'text'))  # gol fara „gol” declarat


class AuditB(unittest.TestCase):
    def test_primul_brief_end(self):
        c, lin = B._raspuns_codex('BRIEF_START\nx\nBRIEF_END\nexec\nls\nBRIEF_END\ncodex\n[1]\ntokens used')
        self.assertIn('exec', lin); self.assertEqual(c, '[1]')

    def test_fara_brief_end_invalid(self):
        c, lin = B._raspuns_codex('codex\n[1]\ntokens used')
        self.assertIsNone(c); self.assertTrue(lin and lin[0].startswith('exec'))


if __name__ == '__main__':
    unittest.main()
