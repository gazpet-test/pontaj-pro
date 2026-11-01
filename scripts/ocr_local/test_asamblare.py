"""Teste pentru asamblarea textului (2a): banda ok=false nu intra niciodata in text, HTML -> randuri inainte de lipire, nr+cod despartite,
tabele cu o coloana -> text, MinerU doar ca rezerva valida, pagini native. Fara retea, fara modele, fara PDF."""
import hashlib, json, pathlib, tempfile, unittest
from ocr_local import asamblare as A


def citire(d, cititor, raw, ok=True, sha=True):
    p = d / cititor; p.mkdir(parents=True, exist_ok=True)
    (p / 'raw.txt').write_bytes(raw.encode('utf-8'))
    res = {'ok': ok}
    if sha: res['raw_sha256'] = hashlib.sha256(raw.encode()).hexdigest()
    (p / 'result.json').write_text(json.dumps(res), encoding='utf-8')


class Rulare:
    def __init__(self, benzi):
        self.tmp = tempfile.TemporaryDirectory(); self.rd = pathlib.Path(self.tmp.name)
        (self.rd / 'd1').mkdir(); (self.rd / 'd1' / 'plan.json').write_text(json.dumps({'bands': benzi}), encoding='utf-8')

    def banda(self, page, bid):
        return self.rd / 'd1' / ('page%04d' % page) / bid


TABEL = '<table><tr><td>001 RPCXA04</td><td>M.C.</td><td>70.200</td></tr><tr><td>002 TSA%10B</td><td>mc</td><td>3.5</td></tr></table>'


class Asamblare(unittest.TestCase):
    def test_banda_oprita_de_garda_nu_intra_in_text(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}])
        citire(r.banda(1, 'p1_b0'), 'lighton', 'BUCLA ' * 50, ok=False)
        citire(r.banda(1, 'p1_b0'), 'mineru', 'BUCLA ' * 50, ok=False)
        text, st = A.asambleaza_document(r.rd, 'd1', pagini_native={1: ''})
        self.assertNotIn('BUCLA', text)
        self.assertIn('BANDĂ NECITITĂ p1_b0', text)
        self.assertEqual((st['benzi_necitite'], st['lista_necitite']), (1, ['p1_b0']))

    def test_mineru_doar_daca_lighton_invalid(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}])
        citire(r.banda(1, 'p1_b0'), 'lighton', 'gresit in bucla', ok=False)
        citire(r.banda(1, 'p1_b0'), 'mineru', 'text bun de la mineru')
        text, st = A.asambleaza_document(r.rd, 'd1', pagini_native={1: ''})
        self.assertIn('text bun de la mineru', text); self.assertNotIn('gresit', text)
        self.assertEqual(st['lista_din_mineru'], ['p1_b0'])

    def test_raw_rescris_dupa_rezultat_nu_se_foloseste(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}])
        d = r.banda(1, 'p1_b0'); citire(d, 'lighton', 'original')
        (d / 'lighton' / 'raw.txt').write_text('modificat dupa', encoding='utf-8')
        text, st = A.asambleaza_document(r.rd, 'd1', pagini_native={1: ''})
        self.assertNotIn('modificat', text); self.assertEqual(st['benzi_necitite'], 1)

    def test_html_devine_randuri_si_nr_cod_despartit(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}])
        citire(r.banda(1, 'p1_b0'), 'lighton', TABEL)
        text, st = A.asambleaza_document(r.rd, 'd1', pagini_native={1: ''})
        self.assertIn('| 001 | RPCXA04 | M.C. | 70.200 |', text)
        self.assertIn('| 002 | TSA%10B | mc | 3.5 |', text)  # codul cu „%” e recunoscut
        self.assertNotIn('<td', text); self.assertEqual(st['html_ramas'], 0)

    def test_fara_raw_sha256_citirea_nu_se_foloseste(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}])
        citire(r.banda(1, 'p1_b0'), 'lighton', 'neverificat', sha=False)
        citire(r.banda(1, 'p1_b0'), 'mineru', 'verificat de mineru')
        text, st = A.asambleaza_document(r.rd, 'd1', pagini_native={1: ''})
        self.assertNotIn('neverificat', text); self.assertIn('verificat de mineru', text)

    def test_nr_cod_doar_pe_randuri_de_articol(self):
        self.assertEqual(A.desparte_nr_cod('| 2024 ABC1 | Raport anual |'), '| 2024 ABC1 | Raport anual |')
        self.assertEqual(A.desparte_nr_cod('| 001 RPCXA04 | M.C. | 70.200 |'), '| 001 | RPCXA04 | M.C. | 70.200 |')

    def test_barele_nu_intra_in_pragul_cusaturii(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}, {'id': 'p1_b1', 'page': 1, 'index': 1}])
        rand = '<tr><td>Beton</td><td>mc</td><td>10</td><td>20</td></tr>'
        citire(r.banda(1, 'p1_b0'), 'lighton', '<table>' + rand + '</table>')
        citire(r.banda(1, 'p1_b1'), 'lighton', '<table>' + rand + '<tr><td>Otel</td><td>kg</td><td>5</td><td>6</td></tr></table>')
        text, st = A.asambleaza_document(r.rd, 'd1', pagini_native={1: ''})
        self.assertEqual(text.count('Beton'), 2); self.assertEqual(st['cusaturi_nesigure'], 1)  # 4 tokeni de conținut < 8: nu se taie

    def test_tabel_o_coloana_devine_linii_de_text(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}])
        citire(r.banda(1, 'p1_b0'), 'lighton', '<table><tr><td>Teava PE100 SDR11</td></tr><tr><td>2405</td></tr></table>')
        text, _ = A.asambleaza_document(r.rd, 'd1', pagini_native={1: ''})
        self.assertIn('Teava PE100 SDR11\n2405', text); self.assertNotIn('| 2405 |', text)

    def test_pagina_nativa_ia_textul_nativ(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}])
        citire(r.banda(1, 'p1_b0'), 'lighton', 'ocr nu se foloseste')
        nativ = 'Text nativ al paginii, suficient de lung ca sa treaca pragul de cincizeci.'
        text, st = A.asambleaza_document(r.rd, 'd1', pagini_native={1: nativ})
        self.assertIn(nativ, text); self.assertNotIn('ocr nu', text); self.assertEqual((st['native'], st['ocr']), (1, 0))

    def test_suprapunerea_benzilor_se_taie_pe_randuri_convertite(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}, {'id': 'p1_b1', 'page': 1, 'index': 1}])
        rand = '<tr><td>003</td><td>Sapatura manuala in pamant tare</td><td>mc</td><td>12.5</td></tr>'
        citire(r.banda(1, 'p1_b0'), 'lighton', '<table>' + rand + '</table>')
        citire(r.banda(1, 'p1_b1'), 'lighton', '<table>' + rand + '<tr><td>004</td><td>Umplutura</td><td>mc</td><td>9</td></tr></table>')
        text, st = A.asambleaza_document(r.rd, 'd1', pagini_native={1: ''})
        self.assertEqual(text.count('Sapatura manuala'), 1); self.assertIn('| 004 | Umplutura | mc | 9 |', text)
        self.assertEqual(st['cusaturi_nesigure'], 0)

    def test_text_conv_scrie_fisier_si_manifest(self):
        r = Rulare([{'id': 'p1_b0', 'page': 1, 'index': 0}])
        citire(r.banda(1, 'p1_b0'), 'lighton', 'abc')
        orig = A.asambleaza_document
        A.asambleaza_document = lambda rd, k: orig(rd, k, pagini_native={1: ''})
        try: man = A.text_conv(r.rd, ['d1'])
        finally: A.asambleaza_document = orig
        f = r.rd / 'text_conv' / 'd1.txt'
        self.assertEqual(man['d1']['sha256'], hashlib.sha256(f.read_text(encoding='utf-8').encode()).hexdigest())
        self.assertTrue((r.rd / 'text_conv' / 'manifest.json').exists())


if __name__ == '__main__':
    unittest.main()
