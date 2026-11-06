"""Teste pentru funcțiile pure din cercetare.py și intrebari_worker.py. Rulare: python -I -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"
"""
import json, pathlib, sys, unittest

AICI = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(AICI))
import cercetare as c  # noqa: E402


class Validare(unittest.TestCase):
    def test_cazuri_comune_cu_vitest(self):
        for caz in json.loads((AICI / 'teste_validare.json').read_text(encoding='utf-8')):
            with self.subTest(caz['nume']):
                a = c.analizeaza(caz['text'], caz['ids'])
                self.assertEqual(a['verdict'], caz['verdict'])
                self.assertEqual(len(a['fara_sursa']), caz['fara_sursa'], a['fara_sursa'])
                self.assertEqual(a['citate'], caz['citate'])
                self.assertEqual(a['necunoscute'], caz['necunoscute'])

    def test_curata_scoate_afirmatiile_fara_sursa(self):
        text, scoase = c.curata_raspuns('Nu.\n- art. 228 din NTPEE cere EN 12732.\n- Corect: 6 bar [C1, W9].', ['C1'])
        self.assertEqual(scoase, 1)
        self.assertNotIn('228', text)
        self.assertIn('[C1]', text)
        self.assertNotIn('W9', text)
        a = c.analizeaza(text, ['C1'])
        self.assertEqual(a['fara_sursa'], [])
        self.assertEqual(a['verdict'], 'Nu.')

    def test_curata_adauga_verdict_cand_lipseste(self):
        text, _ = c.curata_raspuns('Pe scurt: se poate [C1].', ['C1'])
        self.assertTrue(text.startswith('Depinde de'))
        self.assertIsNotNone(c.analizeaza(text, ['C1'])['verdict'])

    def test_mesaj_reparare_listeaza_problemele(self):
        a = c.analizeaza('Pe scurt\n- art. 5 din HG 273/1994 [W4]', ['C1'])
        m = c.mesaj_reparare(a, ['C1'])
        self.assertIn('Prima linie', m)
        self.assertIn('art. 5', m)
        self.assertIn('W4', m)


class Domenii(unittest.TestCase):
    def test_lista_fixa(self):
        self.assertEqual(c.DOMENII_OFICIALE, (
            'legislatie.just.ro', 'monitoruloficial.ro', 'iscir.ro', 'anre.ro', 'isc.gov.ro', 'igsu.ro',
            'transgaz.ro', 'anap.gov.ro', 'e-licitatie.ro', 'eur-lex.europa.eu', 'magazin.asro.ro'))
        u = c.unealta_web()
        self.assertEqual(u['allowed_domains'], list(c.DOMENII_OFICIALE))
        self.assertEqual(u['type'], 'web_search_20250305')
        self.assertLessEqual(u['max_uses'], 5)

    def test_url_oficial(self):
        self.assertTrue(c.url_oficial('https://legislatie.just.ro/Public/DetaliiDocument/123'))
        self.assertTrue(c.url_oficial('https://www.iscir.ro/prescriptii'))
        self.assertTrue(c.url_oficial('http://eur-lex.europa.eu/x'))
        for rau in ('https://iscir.ro.evil.com/', 'https://eviliscir.ro/', 'ftp://anre.ro/', 'javascript:alert(1)', '',
                    'https://user:pw@anre.ro/', 'https://gov.ro/', 'https://just.ro/', None):
            self.assertFalse(c.url_oficial(rau), rau)

    def test_surse_web_doar_oficiale_si_fara_dubluri(self):
        blocuri = [
            {'type': 'server_tool_use', 'name': 'web_search', 'input': {'query': 'responsabil sudura ISCIR'}},
            {'type': 'web_search_tool_result', 'content': [
                {'type': 'web_search_result', 'url': 'https://www.iscir.ro/pt-c9', 'title': 'PT C9'},
                {'type': 'web_search_result', 'url': 'https://blog.exemplu.ro/x', 'title': 'blog'}]},
            {'type': 'text', 'text': 'găsit', 'citations': [
                {'type': 'web_search_result_location', 'url': 'https://www.iscir.ro/pt-c9', 'title': 'PT C9', 'cited_text': 'art. 4 ...'},
                {'type': 'web_search_result_location', 'url': 'https://altul.com/', 'title': 'x', 'cited_text': 'y'}]},
        ]
        s = c.surse_web(blocuri)
        self.assertEqual([x['url'] for x in s], ['https://www.iscir.ro/pt-c9'])
        self.assertEqual(s[0]['id'], 'W1')
        self.assertEqual(s[0]['extras'], 'art. 4 ...')
        self.assertEqual(c.interogari_web(blocuri), ['responsabil sudura ISCIR'])


class Interogare(unittest.TestCase):
    def test_fara_date_de_contact(self):
        t = c.curata_interogare('Sudura', 'Scrie la ion.popescu@gazpet.ro sau 0722 123 456, CNP 1800101123456, vezi https://x.ro/a')
        for rau in ('ion.popescu', '0722', '1800101123456', 'https://'):
            self.assertNotIn(rau, t)
        self.assertIn('Sudura', t)

    def test_lungime(self):
        self.assertLessEqual(len(c.curata_interogare('t', 'a' * 5000)), 2000)


class Corpus(unittest.TestCase):
    INDEX = {'bucati': [
        {'cale': 'docs/cercetare/registre_evidenta.md', 'titlu': 'ISCIR — excludere', 'text': 'ISCIR exclus pe rețele de distribuție gaze (Legea 64/2008 anexa 1 pct. 3).'},
        {'cale': 'docs/cercetare/baza_normativa.md', 'titlu': 'NTPEE', 'text': 'Sudura polietilenei: sudori autorizați ANRE, EN 12732.'},
        {'cale': 'docs/cercetare/baza_normativa.md', 'titlu': 'Legea 98/2016', 'text': 'Clarificări în achiziții publice.'},
        {'cale': '../secret.md', 'titlu': 'x', 'text': 'sudura ISCIR'},
        {'cale': 'src/App.jsx', 'titlu': 'x', 'text': 'sudura ISCIR'},
    ]}

    def test_selectie_relevanta(self):
        p = c.pregateste_index(self.INDEX)
        self.assertEqual(len(p['bucati']), 3)   # căile din afara docs/ se ignoră
        e = c.selecteaza_extrase(p, 'Responsabilul tehnic cu sudura ISCIR pe rețele de gaze')
        self.assertGreaterEqual(len(e), 2)
        self.assertEqual(e[0]['id'], 'C1')
        self.assertTrue(all(x['cale'].startswith('docs/') for x in e))
        self.assertNotIn('Legea 98/2016', [x['titlu'] for x in e])

    def test_limite(self):
        idx = {'bucati': [{'cale': f'docs/cercetare/f{i % 2}.md', 'titlu': f't{i}', 'text': 'sudura ' * 400} for i in range(20)]}
        e = c.selecteaza_extrase(c.pregateste_index(idx), 'sudura', maxim=8, buget=14000, pe_fisier=3)
        self.assertLessEqual(len(e), 6)   # max 3 pe fișier × 2 fișiere
        self.assertTrue(all(len(x['extras']) <= c.EXTRAS_MAX for x in e))
        self.assertLessEqual(sum(len(x['extras']) for x in e), 14000)

    def test_tokeni_diacritice(self):
        self.assertEqual(c.tokeni('Sudură, ȘANTIER și ţeavă PE100 Dn 110'), ['sudura', 'santie', 'teava', 'pe100', '110'])

    def test_bloc_si_citate(self):
        s = [{'id': 'C1', 'tip': 'corpus', 'cale': 'docs/a.md', 'titlu': 'A', 'extras': 'x'},
             {'id': 'W1', 'tip': 'web', 'url': 'https://anre.ro/a', 'titlu': 'B', 'extras': 'y', 'alt': 1}]
        b = c.bloc_surse(s)
        self.assertIn('id="C1"', b); self.assertIn('loc="https://anre.ro/a"', b)
        self.assertEqual(c.surse_citate(s, ['W1']), [{'id': 'W1', 'tip': 'web', 'url': 'https://anre.ro/a', 'titlu': 'B', 'extras': 'y'}])


class Model(unittest.TestCase):
    def test_alegere(self):
        self.assertEqual(c.alege_model('Responsabil tehnic sudură ISCIR', 'E obligatoriu?'), c.MODEL_NORMATIV)
        self.assertEqual(c.alege_model('Ce prevede art. 5 din HG 273?'), c.MODEL_NORMATIV)
        self.assertEqual(c.alege_model('Cum calculez volumul de săpătură pentru o tranșee de 80 cm?'), c.MODEL_GENERAL)
        self.assertEqual(c.MODEL_NORMATIV, 'claude-opus-5-5')
        self.assertEqual(c.MODEL_GENERAL, 'claude-sonnet-5-5')


if __name__ == '__main__':
    unittest.main()
