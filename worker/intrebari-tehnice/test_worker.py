"""Teste pentru funcțiile pure din intrebari_worker.py (fără rețea). Rulare: python -I -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"
"""
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import intrebari_worker as W  # noqa: E402

Q = {'id': 1, 'incercare': 'x', 'titlu': 'Responsabil sudură', 'intrebare': 'E nevoie de RTS ISCIR? Sună la 0722 123 456.',
     'context': 'Proiect Mânăstirea, Ion Popescu', 'atasamente': []}


class Mesaje(unittest.TestCase):
    def test_web_primeste_doar_textul_tehnic(self):
        m = W.mesaj_web(Q)
        self.assertIn('Responsabil sudură', m)
        self.assertNotIn('Mânăstirea', m)    # contextul de proiect nu ajunge la căutarea web
        self.assertNotIn('Popescu', m)
        self.assertNotIn('0722', m)

    def test_raspunsul_are_speta_sursele_si_notele(self):
        s = [{'id': 'C1', 'tip': 'corpus', 'cale': 'docs/cercetare/a.md', 'titlu': 'A', 'extras': 'x'}]
        m = W.mesaj_raspuns(Q, s, 'note')
        self.assertIn('<context>Proiect Mânăstirea', m)
        self.assertIn('id="C1"', m)
        self.assertIn('<note_cercetare_web>', m)
        self.assertNotIn('<note_cercetare_web>', W.mesaj_raspuns(Q, s, ''))


class Tokeni(unittest.TestCase):
    def test_aduna(self):
        t = {}
        W.aduna_tokeni(t, {'usage': {'input_tokens': 10, 'output_tokens': 5, 'server_tool_use': {'web_search_requests': 2}}})
        W.aduna_tokeni(t, {'usage': {'input_tokens': 3, 'output_tokens': 1}})
        self.assertEqual(t, {'input_tokens': 13, 'output_tokens': 6, 'web_search_requests': 2, 'apeluri': 2})

    def test_text(self):
        self.assertEqual(W.text_raspuns({'content': [{'type': 'server_tool_use'}, {'type': 'text', 'text': ' a'}, {'type': 'text', 'text': 'b '}]}), 'ab')


if __name__ == '__main__':
    unittest.main()
