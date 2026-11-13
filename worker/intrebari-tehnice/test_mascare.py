"""Teste pentru mascare.py și pentru garda din intrebari_worker.py (decizia owner-ului 13.11.2026, A). FĂRĂ rețea.
Rulare: python -I -B -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"
Cazurile comune (teste_mascare.json) rulează și în vitest (src/intrebariMascare.test.js) — paritate Python ↔ JS (L19). Date INVENTATE.
"""
import ast, json, pathlib, re, sys, unittest

AICI = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(AICI))
import cercetare as C  # noqa: E402
import mascare as M  # noqa: E402
import intrebari_worker as W  # noqa: E402

T = json.loads((AICI / 'teste_mascare.json').read_text(encoding='utf-8'))
DICT = M.Dictionar(T['dictionar']['persoane'], T['dictionar']['firme'], T['dictionar']['cui'])
ETICHETA_SCRISA = re.compile(r'\[[A-Za-z_]+_[0-9]')


class Paritate(unittest.TestCase):
    def test_cazurile_comune(self):
        for c in T['cazuri']:
            with self.subTest(c['nume']):
                m = M.Mascare(None if c.get('dictionar_gol') else DICT)
                mascate = [m.mascheaza(t, protejeaza=False) for t in c['texte']]
                self.assertEqual(mascate, c['mascate'])
                self.assertTrue(all(type(x) is M.TextMascat for x in mascate))
                self.assertEqual(m.contoare(), c['contoare'])
                if 'inlocuiri' in c: self.assertEqual(m.inlocuiri, c['inlocuiri'])
                for x, orig in zip(mascate, c['texte']):
                    self.assertEqual(m.demascheaza(x), orig)                 # dus-întors EXACT
                    self.assertEqual(m.mascheaza(x), x)                      # idempotent (textul de model, la reparare)
                    if not ETICHETA_SCRISA.search(orig): self.assertEqual(m.emise_in(m.demascheaza(x)), 0)
                for d in c.get('dupa', []): self.assertEqual(m.mascheaza(d['text']), d['mascat'])
                for d in c.get('demascare', []): self.assertEqual(m.demascheaza(d['text']), d['afisat'])

    def test_text_fara_nume_neschimbat_si_fara_inlocuiri(self):
        m = M.Mascare(DICT)
        t = 'Proba de rezistență la 6 bar se face după montaj, conform NTPEE-2018 și SR EN 12327; Presiunea ionului.'
        self.assertEqual(m.mascheaza(t, protejeaza=False), t)
        self.assertEqual((m.inlocuiri, m.contoare(), m.tabel), (0, {}, {}))

    def test_tabelul_e_per_speta(self):
        a, b = M.Mascare(DICT), M.Mascare(DICT)
        self.assertEqual(a.mascheaza('Ionescu Maria', protejeaza=False), '[PERSOANA_1]')
        self.assertEqual(a.mascheaza('Popescu Ion', protejeaza=False), '[PERSOANA_2]')
        self.assertEqual(b.mascheaza('Popescu Ion', protejeaza=False), '[PERSOANA_1]')


class TipMascat(unittest.TestCase):
    def test_nu_se_poate_construi_din_afara(self):
        with self.assertRaises(TypeError): M.TextMascat('Popescu Ion')
        with self.assertRaises(TypeError): M.TextMascat('Popescu Ion', object())

    def test_orice_operatie_dupa_mascare_pierde_marcajul(self):
        x = M.Mascare(DICT).mascheaza('Popescu Ion')
        for y in (x + ' și', ' ' + x, x[:3], f'{x}', x.strip(), x.replace('a', 'a'), str(x), '%s' % x):
            self.assertIsNot(type(y), M.TextMascat)

    def test_sigiliul_e_folosit_doar_in_mascare_py(self):
        for f in AICI.glob('*.py'):
            if f.name in ('mascare.py',) or f.name.startswith('test_'): continue
            self.assertNotIn('_SIGILIU', f.read_text(encoding='utf-8'), f.name)


class DrumUnic(unittest.TestCase):
    """Garda verificată în COD: singurul drum spre furnizor e cere() → apel() → garda_cerere() → trimite_http()."""

    @classmethod
    def setUpClass(cls):
        cls.arbore = ast.parse((AICI / 'intrebari_worker.py').read_text(encoding='utf-8'))
        cls.functii = {n.name: n for n in ast.walk(cls.arbore) if isinstance(n, ast.FunctionDef)}

    def apelatori(self, nume):
        """Numele funcțiilor (de pe primul nivel) care cheamă sau referă `nume`."""
        out = set()
        for f in self.arbore.body:
            if isinstance(f, ast.FunctionDef):
                for n in ast.walk(f):
                    if isinstance(n, ast.Name) and n.id == nume: out.add(f.name)
            elif any(isinstance(n, ast.Name) and n.id == nume for n in ast.walk(f)) and not (
                    isinstance(f, ast.Assign) and any(isinstance(x, ast.Name) and x.id == nume for x in f.targets)):
                out.add('<modul>')
        return out

    def test_trimite_http_doar_din_apel(self):
        self.assertEqual(self.apelatori('trimite_http'), {'apel'})

    def test_adresa_api_doar_in_trimite_http(self):
        self.assertEqual(self.apelatori('API'), {'trimite_http'})

    def test_apel_doar_din_cere(self):
        self.assertEqual(self.apelatori('apel'), {'cere'})

    def test_apel_ruleaza_garda_inainte_de_retea(self):
        corp = self.functii['apel'].body
        apeluri = [n.func.id for s in corp for n in ast.walk(s) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
        self.assertEqual(apeluri, ['garda_cerere', 'trimite_http'])

    def test_cere_mascheaza_fiecare_mesaj(self):
        sursa = ast.get_source_segment((AICI / 'intrebari_worker.py').read_text(encoding='utf-8'), self.functii['cere'])
        self.assertIn("'content': mascare.mascheaza(text)", sursa)

    def test_reteaua_doar_in_edge_si_trimite_http(self):
        self.assertEqual(self.apelatori('OPENER') - {'<modul>'}, {'edge', 'trimite_http'})
        self.assertNotIn('urlopen', (AICI / 'intrebari_worker.py').read_text(encoding='utf-8'))


def corp_bun(continut=None, **k):
    c = {'model': C.MODEL_GENERAL, 'max_tokens': 10, 'system': C.SISTEM_RASPUNS,
         'messages': [{'role': 'user', 'content': continut if continut is not None else M.Mascare(DICT).mascheaza('Popescu Ion')}]}
    c.update(k)
    return c


class Garda(unittest.TestCase):
    def setUp(self):
        self.vechi, self.trimise = W.trimite_http, []
        W.trimite_http = lambda cheie, corp: (self.trimise.append(corp), (200, {}))[1]

    def tearDown(self):
        W.trimite_http = self.vechi

    def refuz(self, corp):
        with self.assertRaises(W.GardaMascare): W.apel('k', corp)
        self.assertEqual(self.trimise, [])                                   # nimic n-a plecat

    def test_cererea_mascata_trece(self):
        self.assertEqual(W.apel('k', corp_bun()), (200, {}))
        self.assertEqual(self.trimise[0]['messages'][0]['content'], '[PERSOANA_1]')
        W.apel('k', corp_bun(tools=[C.unealta_web(1)], system=C.SISTEM_CERCETARE))

    def test_text_simplu_e_refuzat(self):
        self.refuz(corp_bun('Popescu Ion'))

    def test_text_construit_dupa_mascare_e_refuzat(self):
        self.refuz(corp_bun(M.Mascare(DICT).mascheaza('Popescu Ion') + ' întreabă'))

    def test_blocuri_document_sau_imagine_refuzate(self):
        self.refuz(corp_bun([{'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': 'x'}}]))
        self.refuz(corp_bun([{'type': 'text', 'text': M.Mascare(DICT).mascheaza('x')}]))

    def test_sistem_unelte_model_chei_necunoscute_refuzate(self):
        self.refuz(corp_bun(system='Ești un asistent. Popescu Ion'))
        copie = C.SISTEM_RASPUNS[:-1] + C.SISTEM_RASPUNS[-1:]
        self.assertEqual(copie, C.SISTEM_RASPUNS)
        self.refuz(corp_bun(system=copie))                                      # alt obiect, chiar cu același text
        self.refuz(corp_bun(tools=[{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 5}]))
        self.refuz(corp_bun(model='alt-model'))
        self.refuz(corp_bun(metadata={'user_id': 'x'}))
        self.refuz(corp_bun(max_tokens=True))
        c = corp_bun(); c['messages'].append({'role': 'user', 'content': 'Popescu Ion'})
        self.refuz(c)


class DictionarDinEdge(unittest.TestCase):
    def test_forma_buna(self):
        d = M.Dictionar.din_raspuns({'persoane': ['POPESCU ION'], 'firme': ['Alfa Construct SRL'], 'cui': ['RO12345678']})
        self.assertEqual(M.Mascare(d).mascheaza('Ion Popescu, Alfa Construct, 12345678'), '[PERSOANA_1], [FIRMA_1], [CUI_1]')

    def test_forma_gresita_sau_goala_e_refuzata(self):
        for r in (None, {}, {'persoane': [], 'firme': [], 'cui': []}, {'persoane': ['A'], 'firme': 'x', 'cui': []},
                  {'persoane': ['A', 3], 'firme': [], 'cui': []}, {'persoane': ['A'] * 50001, 'firme': [], 'cui': []}):
            with self.subTest(r=str(r)[:40]):
                with self.assertRaises(ValueError): M.Dictionar.din_raspuns(r)

    def test_firme_publice_si_generice_nu_intra_in_lista(self):
        d = M.Dictionar([], ['TRANSGAZ SA', 'Delgaz Grid SA', 'Construct SRL', 'SC GAZPET INSTAL SRL', 'Alfa SRL'], [])
        self.assertEqual(sorted(d.firme), ['alfa'])


if __name__ == '__main__':
    unittest.main()
