"""Teste pentru import_mpp.py: python -I -X utf8 scripts/grafic/test_import_mpp.py -v   (din rădăcina repo-ului)
Partea pură rulează oriunde; partea MPXJ (Java + pachetele din requirements.txt) citește graficul SINTETIC din
test-fixtures/grafic/grafic_sintetic.xml și compară cu valorile scrise aici DE MÂNĂ (sursa lor: specificația din fixture_sintetic.py),
nu cu ieșirea codului testat (L25). Fără Java, partea MPXJ e SĂRITĂ VIZIBIL."""
import importlib.util, json, os, re, sys, tempfile, unittest

RADACINA = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
spec = importlib.util.spec_from_file_location('import_mpp', os.path.join(RADACINA, 'scripts', 'grafic', 'import_mpp.py'))
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
XML = os.path.join(RADACINA, 'test-fixtures', 'grafic', 'grafic_sintetic.xml')


def _cazuri():
    sp = importlib.util.spec_from_file_location('cazuri_sql', os.path.join(RADACINA, 'scripts', 'grafic', 'cazuri_sql.py'))
    mod = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(mod)
    return mod
FIXTURE = os.path.join(RADACINA, 'test-fixtures', 'grafic', 'grafic_sintetic.json')


def act(**k):
    a = {'ordine': 0, 'uid': 1, 'wbs': '1', 'nivel': 1, 'nume': 'x', 'start_plan': '2026-01-05', 'finish_plan': '2026-01-09',
         'start_real': None, 'finish_real': None, 'start_baseline': None, 'finish_baseline': None, 'durata_zile': 5.0,
         'pct_realizat': 0.0, 'pct_plan': None, 'pct_raportat': None, 'milestone': False, 'rezumat': False, 'activ': True,
         'predecesori': '', 'resurse': '', 'parinte_uid': None}
    a.update(k)
    return a


class Pur(unittest.TestCase):
    def test_procent_raport(self):
        bune = {'73.39%': 73.39, '73,39 %': 73.39, '100%': 100.0, '0%': 0.0, '0.00%': 0.0, '5.5%': 5.5}
        for s, v in bune.items():
            self.assertEqual(M.procent_raport(s), (v, True), s)
        for s in ('#DIV/0!', 'n/a', '120%', '1.000%', '73.391%', '-5%', '50', '50 % plan', '1,5,5%', '%'):
            self.assertEqual(M.procent_raport(s), (None, False), s)
        self.assertEqual(M.procent_raport(None), (None, True))
        self.assertEqual(M.procent_raport('  '), (None, True))
        self.assertEqual(M.procent_raport(42.125), (42.12, True))
        self.assertEqual(M.procent_raport(100.5), (None, False))

    def test_procent_nativ(self):
        self.assertEqual(M.procent(None, 'x'), 0.0)
        self.assertEqual(M.procent(57.49185667752443, 'x'), 57.49)
        for v in (-0.5, 100.01, float('nan')):
            with self.assertRaises(M.EroareImport):
                M.procent(v, 'x')

    def test_text_predecesori(self):
        leg = [{'wbs': '1.1.1', 'tip': 'FS', 'lag_zile': 65.0}, {'wbs': '1.2', 'tip': 'SS', 'lag_zile': 0.0},
               {'wbs': '2', 'tip': 'FS', 'lag_zile': -2.5}, {'wbs': '3', 'tip': 'FF', 'lag_procent': 50.0}]
        self.assertEqual(M.text_predecesori(leg), '1.1.1 FS+65z; 1.2 SS; 2 FS-2,5z; 3 FF+50%')
        self.assertEqual(M.text_predecesori([]), '')
        with self.assertRaises(M.EroareImport):
            M.text_predecesori([{'wbs': '1', 'tip': 'XX', 'lag_zile': 0}])

    def test_text_resurse(self):
        self.assertEqual(M.text_resurse(['Echipa A', None, ' Echipa B ', 'Echipa A', '']), 'Echipa A, Echipa B')

    def test_verifica_activitati(self):
        ok = [act(), act(ordine=1, uid=2, wbs='1.1', nivel=2, parinte_uid=1)]
        self.assertEqual(M.verifica_activitati(ok), [])
        with self.assertRaises(M.EroareImport):   # UniqueID duplicat
            M.verifica_activitati([act(), act(ordine=1, wbs='1.1', nivel=2)])
        with self.assertRaises(M.EroareImport):   # ordinea nu e 0..n-1
            M.verifica_activitati([act(ordine=1)])
        with self.assertRaises(M.EroareImport):   # finish înaintea start-ului
            M.verifica_activitati([act(finish_plan='2026-01-01')])
        av = M.verifica_activitati([act(), act(ordine=1, uid=2, wbs='1.1.1', nivel=3, parinte_uid=1)])
        self.assertTrue(any('nivelul / părintele' in x for x in av), av)
        av = M.verifica_activitati([act(start_plan=None)])
        self.assertTrue(any('start_plan lipsă' in x for x in av), av)
        av = M.verifica_activitati([act(), act(ordine=1, uid=2, wbs='1', nivel=2, parinte_uid=1)])
        self.assertTrue(any('WBS (outline) duplicat' in x for x in av), av)

    def test_abatere_arbore(self):
        # arbore corect: 1 > 1.1 > 1.1.1, 1.2; apoi a doua rădăcină 2
        bun = [act(uid=1, nivel=1), act(ordine=1, uid=2, nivel=2, parinte_uid=1), act(ordine=2, uid=3, nivel=3, parinte_uid=2),
               act(ordine=3, uid=4, nivel=2, parinte_uid=1), act(ordine=4, uid=5, nivel=1)]
        self.assertIsNone(M.abatere_arbore(bun))
        rau = {
            'părinte greșit': [act(uid=1, nivel=1), act(ordine=1, uid=2, nivel=2, parinte_uid=1), act(ordine=2, uid=3, nivel=2, parinte_uid=2)],
            'nivel sărit': [act(uid=1, nivel=1), act(ordine=1, uid=2, nivel=3, parinte_uid=1)],
            'rădăcină sub alta': [act(uid=1, nivel=1), act(ordine=1, uid=2, nivel=2)],
            'rădăcină pe alt nivel': [act(uid=1, nivel=1), act(ordine=1, uid=2, nivel=0)],
            'părinte inexistent': [act(uid=1, nivel=1), act(ordine=1, uid=2, nivel=2, parinte_uid=9)],
        }
        for nume, acts in rau.items():
            self.assertIsNotNone(M.abatere_arbore(acts), nume)

    def test_reconciliaza_inventar(self):
        self.assertEqual(M.reconciliaza_inventar([3, 1, 2], [1, 2, 3], 2, 2), 3)
        for args in (([1, 2, 3], [1, 2], 0, 0),          # o activitate pierdută la parcurgere
                     ([1, 2], [1, 2, 2], 0, 0),          # una parcursă de două ori
                     ([1, 2], [1, 3], 0, 0),             # alt UID
                     ([1, 2], [1, 2], 1, 0)):            # rândurile goale nu se potrivesc
            with self.assertRaises(M.EroareImport, msg=str(args)):
                M.reconciliaza_inventar(*args)

    def test_construieste_si_sql(self):
        rev = {'proiect_id': 3, 'eticheta': 'T R1', 'sursa_fisier': 't.mpp', 'sursa_sha256': 'a' * 64, 'tip_fisier': 'MPP',
               'data_stare': None, 'camp_pct_plan': None, 'camp_pct_raportat': None}
        doc = M.construieste(rev, [act()], [], [], 1)
        self.assertTrue(doc['complet'])
        self.assertEqual(doc['statistici']['inventar_cititor'], 1)
        sql = M.sql_import(doc)
        m = re.search(r"SELECT public\.fn_executie_grafic_importa\(\$(g[0-9a-f]{16})\$(.*)\$\1\$::jsonb, true\);", sql, re.S)
        self.assertIsNotNone(m)
        self.assertEqual(json.loads(m.group(2))['activitati'][0]['wbs'], '1')
        self.assertTrue(sql.startswith('-- ') and 'BEGIN ISOLATION LEVEL READ COMMITTED;' in sql and sql.endswith('COMMIT;\n'))
        self.assertNotIn('\r', sql)
        # un nume care conține „$tag$” nu închide literalul
        doc2 = M.construieste(rev, [act(nume='a $g0$ b $$ c')], [], [], 1)
        m2 = re.search(r"\$(g[0-9a-f]{16})\$(.*)\$\1\$::jsonb", M.sql_import(doc2), re.S)
        self.assertEqual(json.loads(m2.group(2))['activitati'][0]['nume'], 'a $g0$ b $$ c')
        # fără proiect / cu avertismente / cu incerte / cu inventar diferit / cu document invalid nu se generează
        with self.assertRaises(M.EroareImport):
            M.sql_import(M.construieste({**rev, 'proiect_id': None}, [act()], [], [], 1))
        with self.assertRaises(M.EroareImport):
            M.sql_import(M.construieste(rev, [act()], ['ceva'], [], 1))
        with self.assertRaises(M.EroareImport):
            M.sql_import(M.construieste(rev, [act()], [], [], 2))
        with self.assertRaises(M.EroareImport):
            M.sql_import(M.construieste(rev, [act(pct_realizat=10.555)], [], [], 1))
        inc = M.construieste(rev, [act()], [], [{'wbs': '1', 'camp': 'TEXT2', 'valoare': '#DIV/0!'}], 1)
        self.assertFalse(inc['complet'])
        with self.assertRaises(M.EroareImport):
            M.sql_import(inc)
        m3 = re.search(r"\$(g[0-9a-f]{16})\$(.*)\$\1\$::jsonb", M.sql_import(inc, accepta_incerte=True), re.S)
        self.assertIs(json.loads(m3.group(2))['revizie']['incerte_acceptate'], True)
        with self.assertRaises(M.EroareImport):
            M.construieste(rev, [], [], [], 0)

    def test_cazuri_comune_python_sql(self):
        """Aceleași documente ca harness-ul SQL (TV): refuz <=> valideaza_document ridică; ok <=> trece; fragmentul SQL e la zi."""
        C = _cazuri()
        cazuri = C.documente()
        self.assertGreaterEqual(len(cazuri), 30)
        for nr, nume, asteptat, stare, doc in cazuri:
            if asteptat == 'refuz':
                with self.assertRaises(M.EroareImport, msg=f'caz {nr}: {nume}'):
                    M.valideaza_document(doc)
            else:
                M.valideaza_document(doc)
        with open(C.TINTA, encoding='utf-8', newline='') as f:
            self.assertEqual(f.read().replace('\r\n', '\n'), C.genereaza(), 'rulează scripts/grafic/cazuri_sql.py')

    def test_alege_camp(self):
        av = []
        g = {'plan': {'TEXT5': '% PLAN'}, 'raportat': {'TEXT2': '% Complete', 'TEXT3': '% realizat'}}
        self.assertEqual(M.alege_camp('plan', None, g, av), ('TEXT5', 'TEXT5 (% PLAN)'))
        self.assertEqual(M.alege_camp('raportat', None, g, av), (None, None))
        self.assertTrue(av and 'ambiguă' in av[0])
        self.assertEqual(M.alege_camp('raportat', 'TEXT3', g, []), ('TEXT3', 'TEXT3 (% realizat)'))
        self.assertEqual(M.alege_camp('plan', 'nimic', g, []), (None, None))
        self.assertEqual(M.alege_camp('plan', None, {'plan': {}, 'raportat': {}}, []), (None, None))
        for t in ('% PLAN', '%plan', '% planificat'):
            self.assertTrue(M.RE_TITLU_PLAN.match(t), t)
        for t in ('% Complete', '% realizat', '%executat'):
            self.assertTrue(M.RE_TITLU_RAPORTAT.match(t), t)
        for t in ('% PLAN 2', 'Plan', '% Complete (MS)'):
            self.assertFalse(M.RE_TITLU_PLAN.match(t) or M.RE_TITLU_RAPORTAT.match(t), t)
        for c in ('TEXT1', 'TEXT30', 'NUMBER20'):
            self.assertTrue(M.RE_CAMP_PERSONALIZAT.match(c), c)
        for c in ('TEXT0', 'TEXT31', 'NUMBER21', 'PERCENT_COMPLETE', 'text2'):
            self.assertFalse(M.RE_CAMP_PERSONALIZAT.match(c), c)

    def test_argumente(self):
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, 'x.mpp')
            open(f, 'wb').close()
            for argv in ([f, '--eticheta', 'R1', '--iesire', os.path.join(d, 'o.json')],                     # nici proiect, nici test
                         [f, '--proiect-id', '3', '--test-parsare', '--eticheta', 'R1', '--iesire', 'o.json'],
                         [f, '--proiect-id', '0', '--eticheta', 'R1', '--iesire', 'o.json'],
                         [f, '--test-parsare', '--eticheta', 'R1', '--iesire', 'o.json', '--sql', 's.sql'],
                         [f, '--proiect-id', '3', '--eticheta', ' R1', '--iesire', 'o.json'],
                         [f, '--proiect-id', '3', '--eticheta', 'R1', '--iesire', f],
                         [f, '--proiect-id', '3', '--eticheta', 'R1', '--iesire', os.path.join(d, 'o.txt')],
                         [f, '--proiect-id', '3', '--eticheta', 'R1', '--iesire', os.path.join(d, 'o.json'), '--sql', os.path.join(d, 'o.json')],
                         [f, '--proiect-id', '3', '--eticheta', 'R1', '--iesire', 'o.json', '--camp-pct-plan', 'PERCENT_COMPLETE']):
                with self.assertRaises(SystemExit) as e:
                    M.main(argv)
                self.assertEqual(e.exception.code, 2, argv)

    def test_iesirea_nu_suprascrie_sursa(self):
        """P1 r1: aceeași cale scrisă altfel (majuscule pe Windows), legătură tare, aceeași ieșire de două ori -> refuz înainte de citire."""
        with tempfile.TemporaryDirectory() as d:
            sursa = os.path.join(d, 'grafic.json')          # o sursă .json (MPXJ citește și JSON) ca să treacă de garda de extensie
            with open(sursa, 'wb') as h:
                h.write(b'{"sursa": "neatinsa"}')
            alias = [sursa.upper() if os.path.normcase('A') == 'a' else sursa]
            leg = os.path.join(d, 'legatura.json')
            try:
                os.link(sursa, leg)
                alias.append(leg)
            except OSError:
                pass
            for a in alias:
                with self.assertRaises(SystemExit) as e:
                    M.main([sursa, '--proiect-id', '3', '--eticheta', 'R1', '--iesire', a])
                self.assertEqual(e.exception.code, 2, a)
            with open(sursa, 'rb') as h:
                self.assertEqual(h.read(), b'{"sursa": "neatinsa"}')
            self.assertTrue(M.aceeasi_cale(sursa, os.path.join(d, '.', 'grafic.json')))
            self.assertFalse(M.aceeasi_cale(sursa, os.path.join(d, 'alt.json')))
            self.assertTrue(M.aceeasi_cale(os.path.join(d, 'nou.json'), os.path.join(d, 'sub', '..', 'nou.json')))


def java_disponibil():
    try:
        M.porneste_jvm(os.environ.get('JAVA_HOME'))
        return True
    except Exception as e:  # lipsă Java / jpype / mpxj
        print(f'[test_import_mpp] SĂRIT partea MPXJ: {type(e).__name__}: {e}', file=sys.stderr)
        return False


@unittest.skipUnless(java_disponibil(), 'SĂRIT: lipsește Java sau pachetele mpxj / JPype1 (scripts/grafic/requirements.txt)')
class Mpxj(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.TemporaryDirectory()
        cls.json = os.path.join(cls.d.name, 'g.json')
        rc = M.main([XML, '--test-parsare', '--eticheta', 'Grafic sintetic R1', '--iesire', cls.json,
                     '--camp-pct-raportat', 'TEXT2', '--camp-pct-plan', 'TEXT5', '--sursa-afisata', 'grafic_sintetic.xml'])
        assert rc == 0
        with open(cls.json, encoding='utf-8') as f:
            cls.doc = json.load(f)
        cls.w = {a['wbs']: a for a in cls.doc['activitati']}

    @classmethod
    def tearDownClass(cls):
        cls.d.cleanup()

    def test_structura(self):
        self.assertEqual([a['wbs'] for a in self.doc['activitati']],
                         ['1', '1.1', '1.1.1', '1.1.2', '1.2', '1.2.1', '1.2.2', '1.2.3', '1.3', '1.3.1', '1.3.2'])
        self.assertEqual([a['nivel'] for a in self.doc['activitati']], [1, 2, 3, 3, 2, 3, 3, 3, 2, 3, 3])
        self.assertEqual([a['ordine'] for a in self.doc['activitati']], list(range(11)))
        self.assertEqual(self.w['1.2.2']['parinte_uid'], self.w['1.2']['uid'])
        self.assertEqual({k for k, a in self.w.items() if a['rezumat']}, {'1', '1.1', '1.2', '1.3'})
        self.assertEqual({k for k, a in self.w.items() if a['milestone']}, {'1.1.1', '1.1.2'})
        self.assertEqual({k for k, a in self.w.items() if not a['activ']}, {'1.3.2'})
        self.assertEqual(self.doc['format'], 'gazpet.grafic.v1')

    def test_valori(self):
        a = self.w['1.2.2']
        self.assertEqual((a['nume'], a['start_plan'], a['finish_plan'], a['durata_zile'], a['pct_realizat']),
                         ('Montaj conductă', '2026-03-16', '2026-05-08', 40.0, 60.0))
        self.assertEqual((a['start_real'], a['finish_real'], a['start_baseline'], a['finish_baseline']),
                         ('2026-03-16', None, '2026-03-09', '2026-04-30'))
        self.assertEqual((a['pct_raportat'], a['pct_plan'], a['resurse'], a['predecesori']), (55.25, 80.0, 'Echipa A, Echipa B', '1.2.1 SS+5z'))
        self.assertEqual(self.w['1.2.3']['predecesori'], '1.2.2 FS-2z')
        self.assertEqual(self.w['1.3.1']['predecesori'], '1.2.1 FF')
        self.assertEqual(self.w['1.2.1']['predecesori'], '1.1.1 FS')
        self.assertEqual((self.w['1']['pct_raportat'], self.w['1']['pct_plan']), (41.5, 48.0))
        self.assertEqual((self.w['1.1.1']['start_real'], self.w['1.1.1']['finish_real'], self.w['1.1.1']['durata_zile']),
                         ('2026-03-02', '2026-03-02', 0.0))

    def test_incerte_si_revizie(self):
        self.assertEqual(self.doc['incerte'], [{'wbs': '1.3.1', 'camp': 'TEXT2', 'valoare': '#DIV/0!'}])
        self.assertIsNone(self.w['1.3.1']['pct_raportat'])
        self.assertFalse(self.doc['complet'])
        self.assertEqual(self.doc['avertismente'], [])
        r = self.doc['revizie']
        self.assertEqual((r['tip_fisier'], r['data_stare'], r['minute_pe_zi'], r['proiect_id']), ('MSPDI', '2026-04-30', 480, None))
        self.assertRegex(r['sursa_sha256'], r'^[0-9a-f]{64}$')
        s = self.doc['statistici']
        self.assertEqual((s['activitati'], s['milestone'], s['rezumat'], s['inactive'], s['cu_predecesori']), (11, 2, 4, 1, 4))
        self.assertEqual(s['inventar_cititor'], 11)   # inventarul plat (getTasks), reconciliat cu parcurgerea

    def test_fixture_ui_e_la_zi(self):
        """test-fixtures/grafic/grafic_sintetic.json (folosit de testele UI) = ieșirea de acum, în afară de câmpurile de rulare."""
        with open(FIXTURE, encoding='utf-8') as f:
            fx = json.load(f)
        def fara_rulare(d):
            return {**d, 'revizie': {k: v for k, v in d['revizie'].items() if k not in ('extras_la', 'sursa_sha256', 'sursa_octeti')}}
        self.assertEqual(fara_rulare(fx), fara_rulare(self.doc))

    def test_fisier_necitibil(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            f = os.path.join(d, 'stricat.mpp')
            with open(f, 'wb') as h:
                h.write(b'nu e un grafic' * 100)
            self.assertEqual(M.main([f, '--proiect-id', '3', '--eticheta', 'R1', '--iesire', os.path.join(d, 'o.json')]), 3)
            self.assertFalse(os.path.exists(os.path.join(d, 'o.json')))


if __name__ == '__main__':
    unittest.main()
