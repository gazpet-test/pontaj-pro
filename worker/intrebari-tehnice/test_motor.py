"""Teste pentru motor.py (adaptorul către motorul unic) și pentru garda din intrebari_worker.py — prin PROCESUL Node REAL (r4,
PR #1086). Transportul spre furnizor (trimite_http) e simulat; motorul NU. FĂRĂ rețea.
Rulare (din rădăcina repo-ului; cere Node 24 în PATH sau INTREBARI_NODE):
    python -I -B -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"
Cazurile comune (teste_motor.json) rulează și în vitest (src/intrebariMascare.test.js) și în browser (motor_browser.html). Date
INVENTATE.
"""
import ast, json, os, pathlib, shutil, stat, sys, tempfile, threading, unittest

AICI = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(AICI))
import cercetare as C  # noqa: E402
import motor as MO  # noqa: E402
import intrebari_worker as W  # noqa: E402

INVIZIBILE = {'NBSP': 0xa0, 'ZW': 0x200b, 'SHY': 0xad, 'BOM': 0xfeff, 'CGJ': 0x34f, 'VS16': 0xfe0f, 'VS1': 0xfe00, 'VS17': 0xe0100,
              'ZWJ': 0x200d, 'VIRGULA_JOS': 0x326, 'SEDILA': 0x327, 'U2010': 0x2010, 'U2011': 0x2011, 'LINIUTA_EN': 0x2013}


def invizibile(x):
    """{NUME} din teste_motor.json → caracterul (aceeași listă ca INVIZIBILE din motor_cazuri.mjs)."""
    if isinstance(x, str):
        for k, v in INVIZIBILE.items(): x = x.replace('{' + k + '}', chr(v))
        return x
    if isinstance(x, list): return [invizibile(v) for v in x]
    if isinstance(x, dict): return {k: invizibile(v) for k, v in x.items()}
    return x


T = invizibile(json.loads((AICI / 'teste_motor.json').read_text(encoding='utf-8')))
NUME = T['dictionar']
NODE = os.environ.get('INTREBARI_NODE') or shutil.which('node')
MANIFEST = json.loads((AICI / 'motor_manifest.json').read_text(encoding='utf-8'))
DEFECT = AICI / 'test_motor_defect.mjs'
SALUT = {'v': 1, 'tip': 'salut', 'protocol': MANIFEST['protocol'], 'motor': MANIFEST['motor'], 'node': '24.0.0', 'unicode': MANIFEST['unicode'],
         'amprente': MANIFEST['fisiere']}
ASTEPTAT = {'protocol': MANIFEST['protocol'], 'motor': MANIFEST['motor'], 'node_major': MANIFEST['node_major'], 'unicode': MANIFEST['unicode'],
            'amprente': dict(MANIFEST['fisiere'])}
MOTOR = None


def setUpModule():
    global MOTOR
    MOTOR = MO.Motor()


def tearDownModule():
    if MOTOR: MOTOR.inchide()


def sesiune_defecta(mod, la, nume=NUME, jurnal=None, **limite):
    """O sesiune pe procesul de test_motor_defect.mjs (motorul real, stricat la cererea `la`)."""
    argv = [NODE, str(DEFECT), mod, str(la), json.dumps(SALUT), (AICI / 'motor_protocol.mjs').as_uri()] + ([str(jurnal)] if jurnal else [])
    # cwd explicit: ultimul argument de aici e un URL sau jurnalul, nu intrarea motorului (fără el procesul nu pornea deloc)
    return MO.Sesiune(argv, ASTEPTAT, nume, **{'termen_cerere': 5, 'termen_init': 20, 'cwd': AICI, **limite})


class MotorDefect:
    """Înlocuiește motor.Motor în proceseaza(): fiecare speță primește o sesiune defectă la cererea `la`."""

    def __init__(self, mod, la, jurnal=None):
        self.mod, self.la, self.jurnal, self.sesiuni = mod, la, jurnal, []

    def sesiune(self, nume):
        s = sesiune_defecta(self.mod, self.la, nume, self.jurnal, termen_cerere=2, max_iesire=1024 * 1024)
        self.sesiuni.append(s)
        return s


# ─── 1. Cazurile comune, prin procesul real ────────────────────────────────────────────────────────────────────────────
class CazuriComune(unittest.TestCase):
    def dictionarul(self, c):
        return dict(NUME, localitati=[]) if c.get('dictionar') == 'fara_localitati' else NUME

    def test_contractul_si_regresiile(self):
        for c in T['contract'] + T['cazuri']:
            if c.get('doar_ecran'): continue               # fără dicționar: workerul nu pornește (vezi Pornire)
            with self.subTest(c['nume']), MOTOR.sesiune(self.dictionarul(c)) as s:
                if c.get('invata'): s.invata(*c['texte'])
                mascate = [s.mascheaza(t, protejeaza=False) for t in c['texte']]
                self.assertEqual([str(x) for x in mascate], c['mascate'])
                self.assertTrue(all(type(x) is MO.TextMascat and s.a_produs(x) for x in mascate))
                k = s.contoare()
                if 'contoare' in c: self.assertEqual(k['contoare'], c['contoare'])
                if 'inlocuiri' in c: self.assertEqual(k['inlocuiri'], c['inlocuiri'])
                for x, orig in zip(mascate, c['texte']):
                    self.assertEqual(s.demascheaza_sigur(x), (orig, None))               # dus-întors EXACT
                    self.assertEqual(str(s.mascheaza(x)), str(x))                        # idempotent (reparare)
                for d in c.get('dupa', []): self.assertEqual(str(s.mascheaza(d['text'])), d['mascat'])
                for d in c.get('demascare_sigura', []):
                    self.assertEqual(s.demascheaza_sigur(d['text']), (d.get('afisat'), d['motiv']), repr(d['text']))

    def test_intrarile_aruncate(self):
        a = T['aruncate']
        with MOTOR.sesiune({'persoane': a['persoane'], 'firme': a['firme'], 'cui': [], 'localitati': a['localitati']}) as s:
            self.assertEqual(s.statistici, a['statistici'])
            self.assertEqual(str(s.mascheaza(a['text'], protejeaza=False)), a['mascat'])

    def test_regula_b(self):
        R = T['regula_b']
        with MOTOR.sesiune(NUME) as s:
            for c in R['cazuri']:
                with self.subTest(c['nume']):
                    text, motiv, tip = s.regula_b(c['text'], R['surse'])
                    prima = c.get('prima_linie') or (R['incert_regula_b'] if c['motiv'] == 'fara_citat' else c['text'].split('\n')[0])
                    self.assertEqual((motiv, tip), (c['motiv'], c['tip']))
                    self.assertEqual(text.split('\n')[0], prima)
                    self.assertEqual(text.split('\n')[1:], c['text'].split('\n')[1:])
                    self.assertEqual(s.cere_citat(c['text'], R['surse']), c['cere_citat'])

    def test_dus_intors_cu_diacritice_emoji_invizibile(self):
        t = invizibile('Ana Vlădescu 👷🏽{ZWJ}♀{VS16} 🇷🇴 ț{VS17} — Vlă{CGJ}descu{ZW}, Ş{SEDILA}erban{BOM} ✅ "citat" \\ ') + chr(0x2028) + ' final'
        with MOTOR.sesiune(NUME) as s:
            x = s.mascheaza(t, protejeaza=False)
            self.assertNotIn('Vlădescu', x)
            self.assertNotIn('descu', x)
            self.assertEqual(s.demascheaza_sigur(x), (t, None))

    def test_doua_spete_concurente_nu_impart_nimic(self):
        bariera, rez = threading.Barrier(2), {}

        def speta(cheie, text):
            with MOTOR.sesiune(NUME) as s:
                bariera.wait(timeout=30)
                x = s.mascheaza(text, protejeaza=False)
                bariera.wait(timeout=30)
                rez[cheie] = (str(x), s.demascheaza_sigur('[PERSOANA_1]'), s.demascheaza_sigur('[PERSOANA_2]'))
        fire = [threading.Thread(target=speta, args=('a', 'Zamfirescu Maria')), threading.Thread(target=speta, args=('b', 'Ana Vlădescu'))]
        for f in fire: f.start()
        for f in fire: f.join(60)
        self.assertEqual(rez['a'], ('[PERSOANA_1]', ('Zamfirescu Maria', None), (None, 'eticheta_neemisa')))
        self.assertEqual(rez['b'], ('[PERSOANA_1]', ('Ana Vlădescu', None), (None, 'eticheta_neemisa')))


# ─── 2. Fail-closed: fiecare cale de eroare a procesului ──────────────────────────────────────────────────────────────
class CaiDeEroare(unittest.TestCase):
    def eroare(self, cod, functie):
        with self.assertRaises(MO.MotorEroare) as e: functie()
        self.assertEqual(e.exception.cod, cod)

    def test_la_salut(self):
        for mod, cod in (('cade', 'proces_oprit'), ('trunchiat', 'json_trunchiat'), ('json', 'json'), ('utf8', 'utf8'),
                         ('salut_protocol', 'salut'), ('salut_chei', 'salut'), ('salut_node', 'versiune_node'),
                         ('salut_unicode', 'versiune_unicode'), ('salut_amprenta', 'amprenta_proces')):
            with self.subTest(mod): self.eroare(cod, lambda: sesiune_defecta(mod, 0))
        self.eroare('timp', lambda: sesiune_defecta('doarme', 0, termen_init=1))

    def test_la_o_operatie(self):
        for mod, cod in (('cade', 'proces_oprit'), ('trunchiat', 'json_trunchiat'), ('schema', 'schema'), ('json', 'json'), ('utf8', 'utf8'),
                         ('id', 'schema'), ('eroare', 'motor_motor')):
            with self.subTest(mod):
                s = sesiune_defecta(mod, 2)
                self.eroare(cod, lambda: s.mascheaza('Ana Vlădescu', protejeaza=False))
                self.eroare('sesiune_oprita', lambda: s.mascheaza('x'))           # după prima eroare, sesiunea e oprită
                self.assertIsNotNone(s._p.poll())                                     # procesul nu mai trăiește
        s = sesiune_defecta('doarme', 2, termen_cerere=1)
        self.eroare('timp', lambda: s.mascheaza('Ana Vlădescu'))
        s = sesiune_defecta('mare', 2, max_iesire=1024 * 1024)
        self.eroare('iesire_mare', lambda: s.mascheaza('Ana Vlădescu'))

    def test_la_init(self):
        self.eroare('proces_oprit', lambda: sesiune_defecta('cade', 1))
        self.eroare('motor_motor', lambda: sesiune_defecta('eroare', 1))
        self.eroare('motor_motor', lambda: MOTOR.sesiune({'persoane': [], 'firme': [], 'cui': []}))   # dicționar gol = refuz în motor

    def test_termenul_total_al_sesiunii(self):
        import time
        s = sesiune_defecta('numara', -1, nume=None, termen_sesiune=2.0)
        time.sleep(2.2)
        self.eroare('timp_sesiune', lambda: s.mascheaza('x'))
        self.assertIsNotNone(s._p.poll())

    def test_instalarea(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            self.eroare('node_lipsa', lambda: MO.Motor(node=str(d / 'nu_exista' / 'node.exe')))
            m = dict(MANIFEST, node_major=23); (d / 'm23.json').write_text(json.dumps(m), encoding='utf-8')
            self.eroare('versiune_node', lambda: MO.Motor(manifest_file=d / 'm23.json'))
            m = dict(MANIFEST, unicode='1.0'); (d / 'mu.json').write_text(json.dumps(m), encoding='utf-8')
            self.eroare('versiune_unicode', lambda: MO.Motor(manifest_file=d / 'mu.json'))
            (d / 'stricat.json').write_text('{"versiune": 1', encoding='utf-8')
            self.eroare('manifest', lambda: MO.Motor(manifest_file=d / 'stricat.json'))
            m = dict(MANIFEST, fisiere=dict(MANIFEST['fisiere'], **{'../x.js': '0' * 64}))
            (d / 'cale.json').write_text(json.dumps(m), encoding='utf-8')
            self.eroare('manifest', lambda: MO.Motor(manifest_file=d / 'cale.json'))
            rad = d / 'copie'
            for rel in MANIFEST['fisiere']:
                (rad / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(MO.RADACINA / rel, rad / rel)
            MO.Motor(radacina=rad).inchide()                                            # copia exactă trece (și cu CRLF)
            with (rad / 'src/intrebariMascare.js').open('a', encoding='utf-8') as f: f.write('\n// modificat\n')
            self.eroare('amprenta', lambda: MO.Motor(radacina=rad))
            (rad / 'src/intrebariMascare.js').unlink()
            self.eroare('fisier_lipsa', lambda: MO.Motor(radacina=rad))

    def test_instantaneul_nu_se_schimba_cat_ruleaza(self):
        m = MO.Motor()
        try:
            f = m.dir / 'src/intrebariMascare.js'
            f.chmod(stat.S_IWRITE)
            with f.open('a', encoding='utf-8') as g: g.write('\n// schimbat în timpul rulării\n')
            self.eroare('instantaneu', lambda: m.sesiune(NUME))
        finally:
            m.inchide()
        self.assertIsNone(m.dir)

    def test_argumentele_si_mediul_procesului(self):
        a = MOTOR.argv()
        self.assertEqual(a[0], MOTOR.node)
        self.assertIn('--permission', a)
        self.assertIn(f'--allow-fs-read={MOTOR.dir}', a)
        self.assertNotIn('--allow-fs-write', ' '.join(a))
        self.assertNotIn('--allow-child-process', ' '.join(a))
        self.assertNotIn('NODE_OPTIONS', MO._mediu_minim())
        self.assertTrue(set(MO._mediu_minim()) <= {'SYSTEMROOT', 'WINDIR'})
        sursa = (AICI / 'motor.py').read_text(encoding='utf-8')
        self.assertIn('shell=False', sursa)
        self.assertIn('stderr=subprocess.DEVNULL', sursa)


# ─── 3. Workerul: la orice eroare a motorului, ZERO cereri noi către model și ZERO răspunsuri publicate ──────────────────
CORPUS = C.pregateste_index({'bucati': [
    {'cale': 'docs/cercetare/registre_evidenta.md', 'titlu': 'ISCIR', 'text': 'Responsabilul tehnic cu sudura (RTS) e atestat ISCIR, art. 12.'}]})
VOC = C.pregateste_vocabular(json.loads((AICI / 'vocabular_web.json').read_text(encoding='utf-8')))
Q = {'id': 7, 'incercare': 'z', 'titlu': 'Aviz Lumivo Servicii', 'intrebare': 'Ana Vlădescu întreabă dacă RTS ISCIR e obligatoriu; tel 0722 123 456.',
     'context': 'Zamfirescu Maria, șantier', 'atasamente': []}
SENSIBILE = ('Lumivo', 'Vlădescu', 'Zamfirescu', '0722 123 456')


class FluxCuMotorDefect(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vechi = (W.trimite_http, W.edge, W.DIR, W.time.sleep)
        W.DIR = pathlib.Path(self.tmp.name)
        W.time.sleep = lambda s: None
        self.apeluri, self.scrieri = [], []

        def trimite(cheie, corp):
            self.apeluri.append(corp)
            if corp.get('tools'):
                return 200, {'content': [{'type': 'text', 'text': 'nimic'}], 'stop_reason': 'end_turn', 'usage': {'input_tokens': 1}}
            if corp['system'] is C.SISTEM_INTEROGARI:
                return 200, {'content': [{'type': 'text', 'text': '{"interogari": ["responsabil tehnic sudura iscir"]}'}],
                             'stop_reason': 'end_turn', 'usage': {'input_tokens': 1}}
            return 200, {'content': [{'type': 'text', 'text': 'Incert — de verificat: lipsește avizul.\nNu am găsit sursa oficială pentru avizul cerut de [PERSOANA_1].'}],
                         'stop_reason': 'end_turn', 'usage': {'input_tokens': 1}, 'model': 'm'}

        def edge(secret, corp):
            self.scrieri.append(corp)
            return 200, {'ok': True}
        W.trimite_http, W.edge = trimite, edge

    def tearDown(self):
        W.trimite_http, W.edge, W.DIR, W.time.sleep = self.vechi
        self.tmp.cleanup()

    def operatiile(self):
        """Lista operațiilor cerute motorului de un flux reușit (procesul real, numărate de test_motor_defect.mjs)."""
        jurnal = pathlib.Path(self.tmp.name) / 'operatii.txt'
        W.proceseaza('s', 'k', Q, CORPUS, VOC, MotorDefect('numara', -1, jurnal), NUME)
        self.assertEqual([s['actiune'] for s in self.scrieri], ['raspunde'])
        self.assertIn('Ana Vlădescu', self.scrieri[0]['raspuns_md'])
        for corp in self.apeluri:
            for x in SENSIBILE: self.assertNotIn(x, json.dumps(corp, ensure_ascii=False))
        ops = jurnal.read_text(encoding='utf-8').split()
        self.apeluri.clear(); self.scrieri.clear()
        return ops

    def test_zero_cereri_noi_si_zero_publicari_la_orice_eroare(self):
        ops = self.operatiile()
        self.assertEqual(ops[:5], ['init', 'invata', 'mascheaza', 'mascheaza', 'mascheaza'])
        ultima = max(i for i, o in enumerate(ops) if o == 'emise_in') + 1        # ultima operație înaintea publicării
        cazuri = [('cade', n) for n in range(0, ultima + 1)]
        cazuri += [(m, n) for m in ('trunchiat', 'schema', 'json', 'id', 'eroare', 'utf8', 'mare')
                   for n in (0, 1, 3, ops.index('cere_citat') + 1, ops.index('regula_b') + 1, ops.index('demascheaza_sigur') + 1)]
        for mod, la in cazuri:
            with self.subTest(mod=mod, la=la):
                self.apeluri.clear(); self.scrieri.clear()
                motor = MotorDefect(mod, la)
                W.proceseaza('s', 'k', Q, CORPUS, VOC, motor, NUME)
                self.assertEqual([s['actiune'] for s in self.scrieri], ['eroare'])           # nimic publicat
                self.assertEqual(self.scrieri[0]['eroare'], W.MESAJ_MOTOR)
                # câte cereri au plecat = câte mascări „de cerere” au reușit ÎNAINTEA defectului (la ≤ 5: zero)
                if la <= 5: self.assertEqual(self.apeluri, [])
                for corp in self.apeluri:
                    for x in SENSIBILE: self.assertNotIn(x, json.dumps(corp, ensure_ascii=False))
                j = json.loads((W.DIR / 'jurnal.jsonl').read_text(encoding='utf-8').splitlines()[-1])
                self.assertEqual(j['motiv'], 'motor')
                self.assertTrue(all(s._stricata for s in motor.sesiuni))                   # procesul nu mai rulează
                for x in SENSIBILE: self.assertNotIn(x, json.dumps(j, ensure_ascii=False))

    def test_nicio_cerere_dupa_defect(self):
        """Defect la a k-a operație: cererile spre model sunt doar cele ale căror mesaje s-au mascat ÎNAINTE de defect."""
        ops = self.operatiile()
        for la in range(6, len(ops)):
            with self.subTest(la=la, op=ops[la - 1]):
                self.apeluri.clear(); self.scrieri.clear()
                W.proceseaza('s', 'k', Q, CORPUS, VOC, MotorDefect('cade', la), NUME)
                # fiecare cerere spre model are nevoie de cel puțin o mascare reușită după cele 3 ale spețe (ops[5:])
                self.assertLessEqual(len(self.apeluri), ops[5:la - 1].count('mascheaza'))
                self.assertNotIn('raspunde', [s['actiune'] for s in self.scrieri] if la <= ops.index('emise_in') + 1 else [])


# ─── 4. Garda: un singur drum spre furnizor, doar text produs de sesiunea spețe ───────────────────────────────────────────
class DrumUnic(unittest.TestCase):
    """Garda verificată în COD: singurul drum spre furnizor e cere() → apel() → garda_cerere() → trimite_http()."""

    @classmethod
    def setUpClass(cls):
        cls.arbore = ast.parse((AICI / 'intrebari_worker.py').read_text(encoding='utf-8'))
        cls.functii = {n.name: n for n in ast.walk(cls.arbore) if isinstance(n, ast.FunctionDef)}

    def apelatori(self, nume):
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
        apeluri = [n.func.id for s in self.functii['apel'].body for n in ast.walk(s) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
        self.assertEqual(apeluri, ['garda_cerere', 'trimite_http'])

    def test_cere_mascheaza_fiecare_mesaj(self):
        sursa = ast.get_source_segment((AICI / 'intrebari_worker.py').read_text(encoding='utf-8'), self.functii['cere'])
        self.assertIn("'content': mascare.mascheaza(text)", sursa)

    def test_reteaua_doar_in_edge_si_trimite_http(self):
        self.assertEqual(self.apelatori('OPENER') - {'<modul>'}, {'edge', 'trimite_http'})
        self.assertNotIn('urlopen', (AICI / 'intrebari_worker.py').read_text(encoding='utf-8'))

    def test_sigiliul_doar_in_motor_py(self):
        for f in AICI.glob('*.py'):
            if f.name == 'motor.py' or f.name.startswith('test_'): continue
            self.assertNotIn('_SIGILIU', f.read_text(encoding='utf-8'), f.name)

    def test_python_nu_mai_are_reguli(self):
        self.assertFalse((AICI / 'mascare.py').exists())
        sursa = (AICI / 'motor.py').read_text(encoding='utf-8')
        for x in ('unicodedata', 'TERMINATII', 'ETICHETA', 'normalize(', 'casefold', '.lower()', 'NEMASCATE', 'nemascate.json'):
            self.assertNotIn(x, sursa, x)


class Garda(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = MOTOR.sesiune(NUME)
        cls.alta = MOTOR.sesiune(NUME)

    @classmethod
    def tearDownClass(cls):
        cls.s.inchide(); cls.alta.inchide()

    def setUp(self):
        self.vechi, self.trimise = W.trimite_http, []
        W.trimite_http = lambda cheie, corp: (self.trimise.append(corp), (200, {}))[1]

    def tearDown(self):
        W.trimite_http = self.vechi

    def corp(self, continut=None, **k):
        c = {'model': C.MODEL_GENERAL, 'max_tokens': 10, 'system': C.SISTEM_RASPUNS,
             'messages': [{'role': 'user', 'content': continut if continut is not None else self.s.mascheaza('Ana Vlădescu')}]}
        c.update(k)
        return c

    def refuz(self, corp, mascare=None):
        with self.assertRaises(W.GardaMascare): W.apel('k', corp, self.s if mascare is None else mascare)
        self.assertEqual(self.trimise, [])

    def test_cererea_mascata_trece(self):
        self.assertEqual(W.apel('k', self.corp(), self.s), (200, {}))
        self.assertEqual(self.trimise[0]['messages'][0]['content'], '[PERSOANA_1]')

    def test_textele_nemascate_sau_straine_sunt_refuzate(self):
        self.refuz(self.corp('Ana Vlădescu'))
        self.refuz(self.corp(self.s.mascheaza('Ana Vlădescu') + ' întreabă'))
        self.refuz(self.corp(str.__new__(MO.TextMascat, 'Ana Vlădescu')))
        self.refuz(self.corp(self.alta.mascheaza('Ana Vlădescu')))                       # textul altei spețe
        self.refuz(self.corp(), mascare=object())
        self.refuz(self.corp([{'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': 'x'}}]))
        self.refuz(self.corp(system='Ești un asistent.'))
        self.refuz(self.corp(model='alt-model'))
        self.refuz(self.corp(metadata={'user_id': 'x'}))

    def test_tipul_nu_se_construieste_din_afara(self):
        with self.assertRaises(TypeError): MO.TextMascat('Ana Vlădescu')
        x = self.s.mascheaza('Ana Vlădescu')
        for y in (x + ' și', x[:3], f'{x}', x.strip(), str(x)): self.assertIsNot(type(y), MO.TextMascat)
        self.assertFalse(self.s.a_produs(str.__new__(MO.TextMascat, str(x))))
        self.assertFalse(self.alta.a_produs(x))


if __name__ == '__main__':
    unittest.main()
