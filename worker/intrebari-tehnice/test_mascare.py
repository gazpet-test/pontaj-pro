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
                for d in c.get('demascare_sigura', []):
                    self.assertEqual(m.demascheaza_sigur(d['text']), (d.get('afisat'), d['motiv']), d['text'])

    def test_aproape_etichete_comune_cu_vitest(self):
        for s in T['asemanatoare']['da']: self.assertIsNotNone(M.ASEMANATOR.fullmatch(s), s)
        for s in T['asemanatoare']['nu']: self.assertIsNone(M.ASEMANATOR.fullmatch(s), s)

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


class DemascareStricta(unittest.TestCase):
    """r2 (review P1-4): nimic de forma unei etichete nu se repară tăcut; publicarea se oprește."""

    def setUp(self):
        self.m = M.Mascare(DICT)
        self.m.mascheaza('A sunat Popescu Ion de la Alfa Construct SRL.', protejeaza=False)

    def test_cazurile_recenzentului(self):
        for text in ('Incert - verificati [PERSOANA_999].', '[PERSOANA_1] și [PERSOANA_999]', 'Vezi [PERSOANA_1_F9].',
                     'Vezi [persoana_1].', 'Vezi [FIRMA_1 ].', 'Vezi PERSOANA_1.', 'Vezi [Persoană-1].', 'Vezi [NR AUTO 3].'):
            with self.subTest(text):
                self.assertEqual(self.m.demascheaza_sigur(text), (None, 'eticheta_neemisa'))
                self.assertEqual(self.m.demascheaza(text).count('Popescu'), text.count('[PERSOANA_1]'))   # nimic reparat tăcut

    def test_text_fara_etichete_si_etichete_exacte_trec(self):
        self.assertEqual(self.m.demascheaza_sigur('Da — fără nume.'), ('Da — fără nume.', None))
        self.assertEqual(self.m.demascheaza_sigur('Da — [PERSOANA_1], [FIRMA_1].'), ('Da — Popescu Ion, Alfa Construct SRL.', None))

    def test_text_obisnuit_cu_paranteze_nu_e_eticheta(self):
        for text in ('Vezi [C1] și [W2].', 'CUI 12345678 nu e etichetă', 'Persoana fizică [1]', 'firma 2', 'Cnp-ul lipsește'):
            self.assertIsNone(self.m.demascheaza_sigur(text)[1], text)


class TipMascat(unittest.TestCase):
    def test_nu_se_poate_construi_din_afara(self):
        with self.assertRaises(TypeError): M.TextMascat('Popescu Ion')
        with self.assertRaises(TypeError): M.TextMascat('Popescu Ion', object())

    def test_provenienta_legata_de_instanta(self):
        """r2 (review P2-5): str.__new__ ocolește constructorul, dar a_produs() îl refuză; la fel textul altei mascări."""
        a, b = M.Mascare(DICT), M.Mascare(DICT)
        x = a.mascheaza('Popescu Ion')
        falsificat = str.__new__(M.TextMascat, 'Popescu Ion')
        self.assertIs(type(falsificat), M.TextMascat)                       # tipul singur NU dovedește nimic
        self.assertTrue(a.a_produs(x))
        self.assertFalse(a.a_produs(falsificat))
        self.assertFalse(b.a_produs(x))                                     # textul altei spețe
        self.assertFalse(a.a_produs(str.__new__(M.TextMascat, str(x))))     # aceeași valoare, alt obiect
        self.assertFalse(a.a_produs(str(x)))

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


MASC = M.Mascare(DICT)       # mascarea „spețe” din testele de gardă


def corp_bun(continut=None, **k):
    c = {'model': C.MODEL_GENERAL, 'max_tokens': 10, 'system': C.SISTEM_RASPUNS,
         'messages': [{'role': 'user', 'content': continut if continut is not None else MASC.mascheaza('Popescu Ion')}]}
    c.update(k)
    return c


class Garda(unittest.TestCase):
    def setUp(self):
        self.vechi, self.trimise = W.trimite_http, []
        W.trimite_http = lambda cheie, corp: (self.trimise.append(corp), (200, {}))[1]

    def tearDown(self):
        W.trimite_http = self.vechi

    def refuz(self, corp, mascare=MASC):
        with self.assertRaises(W.GardaMascare): W.apel('k', corp, mascare)
        self.assertEqual(self.trimise, [])                                   # nimic n-a plecat

    def test_cererea_mascata_trece(self):
        self.assertEqual(W.apel('k', corp_bun(), MASC), (200, {}))
        self.assertEqual(self.trimise[0]['messages'][0]['content'], '[PERSOANA_1]')
        W.apel('k', corp_bun(tools=[C.unealta_web(1)], system=C.SISTEM_CERCETARE), MASC)

    def test_text_simplu_e_refuzat(self):
        self.refuz(corp_bun('Popescu Ion'))

    def test_text_construit_dupa_mascare_e_refuzat(self):
        self.refuz(corp_bun(MASC.mascheaza('Popescu Ion') + ' întreabă'))

    def test_tipul_falsificat_e_refuzat(self):
        """r2 (review P2-5): str.__new__(TextMascat, …) are tipul bun, dar nu vine din mascarea acestei spețe."""
        self.refuz(corp_bun(str.__new__(M.TextMascat, 'Popescu Ion')))

    def test_textul_altei_spete_e_refuzat(self):
        self.refuz(corp_bun(M.Mascare(DICT).mascheaza('Popescu Ion')))

    def test_fara_obiectul_de_mascare_e_refuzat(self):
        self.refuz(corp_bun(), mascare=None)

    def test_mutant_fara_provenienta_ar_lasa_falsul_sa_treaca(self):
        """Mutantul (a_produs care se uită doar la tip, ca în r1) lasă falsul să plece — deci testul de mai sus chiar îl prinde."""
        vechi = M.Mascare.a_produs
        try:
            M.Mascare.a_produs = lambda self, x: type(x) is M.TextMascat
            W.apel('k', corp_bun(str.__new__(M.TextMascat, 'Popescu Ion')), MASC)
            self.assertEqual(self.trimise[0]['messages'][0]['content'], 'Popescu Ion')
        finally:
            M.Mascare.a_produs = vechi

    def test_blocuri_document_sau_imagine_refuzate(self):
        self.refuz(corp_bun([{'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': 'x'}}]))
        self.refuz(corp_bun([{'type': 'text', 'text': MASC.mascheaza('x')}]))

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
                  {'persoane': ['A', 3], 'firme': [], 'cui': []}, {'persoane': ['A'] * 200001, 'firme': [], 'cui': []}):
            with self.subTest(r=str(r)[:40]):
                with self.assertRaises(ValueError): M.Dictionar.din_raspuns(r)

    def test_plafonul_e_acelasi_ca_in_edge(self):
        logic = (AICI.parent.parent / 'supabase/functions/intrebari-tehnice-worker/logic.js').read_text(encoding='utf-8')
        self.assertIn('export const NUME_MAX_LISTA = 200000', logic)
        M.Dictionar.din_raspuns({'persoane': ['A'] * 200000, 'firme': [], 'cui': []})

    def test_firme_publice_si_generice_nu_intra_in_lista(self):
        d = M.Dictionar([], ['TRANSGAZ SA', 'Delgaz Grid SA', 'Construct SRL', 'SC GAZPET INSTAL SRL', 'Alfa SRL', 'S.N.T.G.N. TRANSGAZ S.A.',
                             'Transgaz Construct SRL'], [])
        self.assertEqual(sorted(d.firme), ['alfa', 'transgaz'])                 # „Transgaz Construct” e privată → rămâne
        self.assertEqual(d.firme['transgaz'], [('transgaz', 'construct')])

    def test_furnizorii_si_tertii_din_toate_sursele_se_mascheaza(self):
        """r2 (review P1-1): un furnizor / subcontractor / deținător care există DOAR în tabelele noi ale edge-ului (logic.js
        SURSE_NUME) intră în dicționar prin același răspuns „nume” și se ascunde, și fără forma juridică."""
        d = M.Dictionar.din_raspuns({'persoane': ['POPESCU ION', 'ZAMFIR LUCRETIA'], 'firme': ['Gamma Feronerie SRL', 'Omega Utilaje'],
                                     'cui': ['RO 34567890']})
        m = M.Mascare(d)
        self.assertEqual(m.mascheaza('Gamma Feronerie a livrat; Omega Utilaje; doamna Zamfir; Lucretiei; 34567890', protejeaza=False),
                         '[FIRMA_1] a livrat; [FIRMA_2]; doamna [PERSOANA_1]; [PERSOANA_2]; [CUI_1]')


class ListaNemascate(unittest.TestCase):
    """Decizia owner-ului 13.11.2026: entitățile publice rămân vizibile; lista e ÎNCHISĂ, într-un singur loc (nemascate.json)."""

    def test_un_singur_loc(self):
        sursa = (AICI / 'mascare.py').read_text(encoding='utf-8')
        self.assertNotIn("'transgaz", sursa)                                          # nicio listă scrisă în cod
        date = json.loads((AICI / 'nemascate.json').read_text(encoding='utf-8'))
        self.assertEqual(M.NEMASCATE, M.incarca_nemascate(date))
        self.assertIn('../worker/intrebari-tehnice/nemascate.json',
                      (AICI.parent.parent / 'src/intrebariMascare.js').read_text(encoding='utf-8'))

    def test_fiecare_intrare_are_categoria_si_forma_canonica(self):
        date = json.loads((AICI / 'nemascate.json').read_text(encoding='utf-8'))
        self.assertEqual(set(date['categorii']), set(M.CATEGORII_NEMASCATE))
        for e in date['entitati']:
            self.assertIn(e['categorie'], M.CATEGORII_NEMASCATE)
            for f in e['forme']: self.assertEqual(M.cheie_entitate(f), f)

    def test_intrari_invalide_sunt_refuzate(self):
        bun = json.loads((AICI / 'nemascate.json').read_text(encoding='utf-8'))
        for strica in (lambda d: d['entitati'][0].update(categorie='furnizor'), lambda d: d['entitati'][0].update(forme=[]),
                       lambda d: d['entitati'][0].update(forme=['SNTGN Transgaz SA']), lambda d: d.update(entitati=[]),
                       lambda d: d['entitati'][0].update(motiv='x'), lambda d: d['categorii'].update(furnizor='x')):
            d = json.loads(json.dumps(bun)); strica(d)
            with self.assertRaises(ValueError): M.incarca_nemascate(d)

    def test_cheia_entitatii(self):
        for nume, cheie in (('S.N.T.G.N. TRANSGAZ S.A.', 'sntgn transgaz'), ('SC Gazpet Instal S.R.L.', 'gazpet instal'),
                            ('E.ON', 'e on'), ('Engie România SA', 'engie romania'), ('Transgaz Construct SRL', 'transgaz construct')):
            self.assertEqual(M.cheie_entitate(nume), cheie)


if __name__ == '__main__':
    unittest.main()
