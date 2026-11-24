"""Coada de citire OCR (decizia Răzvan 24.11.2026, varianta A): sesiunile cer, un singur proces citește pe rând.
Offline: WSL / vLLM / memoria plăcii, ceasul și somnul sunt false; read.run_reader, compare.compare, GpuLock,
Coordinator.descarca și protocolul gpu.cerere sunt cele reale. Temporarele stau sub .tmp/ din worktree."""
import contextlib
import functools
import hashlib
import io
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from ocr_local import coada as Q
from ocr_local import read as RD
from ocr_local.e3_contract import E3Error
from ocr_local.e3_gpu import Coordinator, GpuLock, Pauza, mutex
from ocr_local.gpu_cedare import CerereGpu, cerere_activa

HERE = pathlib.Path(__file__).parent
BASE = HERE.parents[3]


@contextlib.contextmanager
def temporar():
    root = BASE / '.tmp' / 'coada-test'
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root) as tmp:
        yield pathlib.Path(tmp)


def fa_plan(root, nume, n=3):
    """Plan minim valid pentru load_plan / run_reader / compare (o pagină, n benzi de text)."""
    out = pathlib.Path(root) / 'planuri' / nume
    bands = []
    for i in range(n):
        bid = 'p0001_b%d' % i
        img = out / 'page0001' / (bid + '.png')
        img.parent.mkdir(parents=True, exist_ok=True)
        img.write_bytes(('%s banda %d' % (nume, i)).encode())
        bands.append({'id': bid, 'page': 1, 'index': i, 'kind': 'continuous_text', 'image': 'page0001/%s.png' % bid,
                      'image_sha256': hashlib.sha256(img.read_bytes()).hexdigest()})
    plan = {'status': 'plan_complete', 'input_sha256': 'nimic', 'pages': [{'page': 1, 'route': 'ocr'}], 'bands': bands}
    (out / 'plan.json').write_text(json.dumps(plan), encoding='utf-8')
    return out


class Ceas:
    def __init__(self): self.t = 1000.0
    def __call__(self): return self.t


class Modele:
    """WSL fals: procese vLLM, memoria plăcii (MB), sănătatea. `ramasa_mb` = memorie ținută după oprire (neconfirmată)."""
    baseline = 1400

    def __init__(self):
        self.running = {'lighton': [], 'mineru': []}
        self.health, self.fail_start, self.strain_mb, self.ramasa_mb = True, False, 0, 0
        self.started, self.stopped, self.verificate, self.mem, self.jurnal = [], [], [], 0, []

    def processes(self):
        return {k: list(v) for k, v in self.running.items()}

    def verify(self, name): self.verificate.append(name)

    def healthy(self, name): return self.health and bool(self.running[name])

    def memory_mb(self):
        self.mem += 1
        incarcate = sum(1 for v in self.running.values() if v)
        return self.baseline + self.strain_mb + self.ramasa_mb + 4000 * incarcate

    def stop(self, name, pids):
        self.stopped.append(name)
        self.jurnal.append(('stop', name))
        self.running[name] = []

    def start(self, name):
        if self.fail_start:
            raise E3Error('vllm_control')
        assert not any(self.running.values()), 'un singur model odata'
        self.started.append(name)
        self.jurnal.append(('start', name))
        self.running[name] = [100 + len(self.started)]
        return self.running[name][0]


class Sistem:
    """Coada + procesul unic pe un folder temporar. `cititori[name](plan, banda) -> (text, rezultat)` se pot înlocui."""
    def __init__(self, root, *, alive=None, modele=None, run_reader=None, dir_coada='coada'):
        self.root = root
        self.dir = root / dir_coada
        self.lacat = root / 'paw' / 'gpu.lock'
        self.lacat.parent.mkdir(parents=True, exist_ok=True)
        self.globale = Q.cai_globale(self.lacat)
        self.ceas, self.modele = Ceas(), modele or Modele()
        kw = {'alive': alive} if alive else {}
        self.lock = GpuLock(self.lacat, detinator=Q.DETINATOR, **kw)
        self.coord = Coordinator(self.lock, self.modele, self.globale['modele'])
        self.hooks, self.citiri, self.somn = [], [], []
        self.coada = Q.Coada(self.dir, radacini=(root,))
        self.cititori = {'lighton': self.text_implicit, 'mineru': self.text_implicit}
        rr = run_reader or functools.partial(RD.run_reader, check_server=False)
        self.w = Q.Lucrator(self.dir, self.coord, self.modele, gpu_lock_path=self.lacat, radacini=(root,), run_reader=rr,
                            text=lambda d, doc: {'sarit': 'test'}, clock=self.ceas, sleep=self.dormi,
                            pauza=Pauza(plafon=3600, baza=60, rnd=lambda: 0.0))
        self.proto = dict(RD.protocol(), gpu_lock=str(self.lacat))

    def text_implicit(self, plan, banda, name):
        return 'Text %s banda %s cu 12 m' % (plan, banda), {'ok': True, 'finish_reason': 'stop'}

    def dormi(self, s):
        self.ceas.t += s
        self.somn.append(s)
        for h in list(self.hooks):
            h()

    def _fn(self, name):
        def citeste(data, out, cfg, deadline):
            plan, banda = out.parts[-4], out.parts[-2]
            self.citiri.append((name, plan, banda))
            assert self.modele.running[name], 'citire fara model pornit'
            assert json.loads(self.lacat.read_text())['detinator'] == Q.DETINATOR, 'citire fara lacatul cozii'
            return self.cititori[name](plan, banda, name)
        return citeste

    @contextlib.contextmanager
    def mediu(self):
        with contextlib.ExitStack() as st:
            st.enter_context(patch.dict(RD.FUNCS, {'lighton': self._fn('lighton'), 'mineru': self._fn('mineru')}))
            st.enter_context(patch('ocr_local.read.protocol', return_value=self.proto))
            st.enter_context(patch('ocr_local.read.verify_weights', side_effect=lambda cfg: cfg['weights_sha256']))
            yield

    def lucreaza(self):
        with self.mediu():
            return self.w.lucreaza(o_data=True)

    def jurnal(self):
        p = self.dir / 'jurnal.jsonl'
        return [json.loads(l) for l in p.read_text(encoding='utf-8').splitlines()] if p.exists() else []

    def ev(self, nume):
        return [e for e in self.jurnal() if e['ev'] == nume]


class AdaugareTests(unittest.TestCase):
    def test_adauga_scrie_o_cerere_si_numeroteaza_in_ordine(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,))
            a, b = fa_plan(root, 'A'), fa_plan(root, 'B')
            c1 = q.adauga([str(a)], 'chat')
            c2 = q.adauga([str(b)], 'juridic')
            self.assertEqual((c1['id'], c2['id']), ('c000001', 'c000002'))
            self.assertEqual(q.ids(), ['c000001', 'c000002'])
            d = q.citeste('c000001')
            self.assertEqual((d['stare'], d['cine'], d['planuri'][0]['benzi']), ('asteapta', 'chat', 3))
            self.assertEqual(d['planuri'][0]['plan_sha256'], hashlib.sha256((a / 'plan.json').read_bytes()).hexdigest())
            self.assertFalse(list((root / 'coada' / 'cereri').glob('*.tmp*')))  # scriere atomică, fără resturi
            st = q.stare(cine='juridic')
            self.assertEqual([c['id'] for c in st['cereri']], ['c000002'])

    def test_duplicate_refuzate_cat_timp_cererea_e_activa(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,))
            a, b = fa_plan(root, 'A'), fa_plan(root, 'B')
            q.adauga([str(a)], 'chat')
            with self.assertRaisesRegex(ValueError, 'deja in cererea c000001'):
                q.adauga([str(b), str(a)], 'cowork')
            with self.assertRaisesRegex(ValueError, 'deja in cererea'):
                q.adauga([str(a).upper()], 'cowork')  # aceeași cale, altă scriere (Windows nu ține cont de majuscule)
            with self.assertRaisesRegex(ValueError, 'de doua ori'):
                q.adauga([str(b), str(b / '.')], 'cowork')
            self.assertEqual(q.ids(), ['c000001'])  # refuzul nu scrie nimic
            q.anuleaza('c000001')
            self.assertEqual(q.adauga([str(a)], 'chat')['id'], 'c000002')  # anulată = nu mai blochează
            c = q.citeste('c000002'); c['stare'] = 'gata'; q.scrie(c)
            self.assertEqual(q.adauga([str(a)], 'chat')['id'], 'c000003')  # gata = se poate cere din nou

    def test_validarea_cailor(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root / 'permis',))
            ok = fa_plan(root / 'permis', 'A')
            afara = fa_plan(root / 'altundeva', 'B')
            gol = root / 'permis' / 'gol'; gol.mkdir(parents=True)
            dir_json = root / 'permis' / 'dirjson'; (dir_json / 'plan.json').mkdir(parents=True)
            incomplet = fa_plan(root / 'permis', 'C')
            pj = json.loads((incomplet / 'plan.json').read_text()); pj['status'] = 'planning'
            (incomplet / 'plan.json').write_text(json.dumps(pj))
            cazuri = {
                '\\\\gazpet-tnas\\x\\plan': 'UNC', '//gazpet-tnas/x/plan': 'UNC', '\\\\?\\' + str(ok): 'UNC',
                str(ok) + ':ascuns': 'ADS', 'planuri\\A': 'relativa', str(afara): 'afara',
                str(root / 'permis' / '..' / 'altundeva' / 'planuri' / 'B'): 'afara', str(gol): 'plan.json lipsa',
                str(dir_json): 'nu e fisier', str(incomplet): 'nu e complet', str(ok) + '"': 'interzise',
                str(root / 'permis'): 'afara',
            }
            for cale, motiv in cazuri.items():
                with self.subTest(cale=cale):
                    with self.assertRaisesRegex(ValueError, motiv if motiv != 'afara' else 'in afara'):
                        q.adauga([cale], 'chat')
            with self.assertRaisesRegex(ValueError, '--cine'):
                q.adauga([str(ok)], 'chat sesiune')
            self.assertEqual(q.ids(), [])
            self.assertEqual(q.adauga([str(ok)], 'chat')['id'], 'c000001')

    @unittest.skipUnless(os.name == 'nt', 'junction doar pe Windows')
    def test_reparse_point_refuzat_pe_orice_componenta(self):
        import _winapi
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,))
            real = fa_plan(root / 'real', 'A')
            _winapi.CreateJunction(str(root / 'real'), str(root / 'legat'))
            try:
                with self.assertRaisesRegex(ValueError, 'reparse'):
                    q.adauga([str(root / 'legat' / 'planuri' / 'A')], 'chat')
                self.assertEqual(q.adauga([str(real)], 'chat')['id'], 'c000001')
            finally:
                os.rmdir(root / 'legat')  # doar legătura; ținta rămâne

    def test_anuleaza_doar_in_asteptare(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,))
            q.adauga([str(fa_plan(root, 'A'))], 'chat')
            q.adauga([str(fa_plan(root, 'B'))], 'chat')
            lot = q.preia_lot()
            self.assertEqual([c['id'] for c in lot], ['c000001', 'c000002'])
            with self.assertRaisesRegex(ValueError, 'doar cererile in asteptare'):
                q.anuleaza('c000001')
            q.adauga([str(fa_plan(root, 'C'))], 'chat')
            self.assertEqual(q.anuleaza('c000003')['stare'], 'anulata')
            with self.assertRaisesRegex(ValueError, 'doar cererile in asteptare'):
                q.anuleaza('c000003')
            with self.assertRaisesRegex(ValueError, 'id invalid'):
                q.anuleaza('..\\x')
            self.assertEqual([c['id'] for c in q.preia_lot()], ['c000001', 'c000002'])  # anulata nu intră în lot

    def test_tranzitiile_sub_lacatul_scurt(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,), lacat_s=0.3, sleep=lambda s: None)
            q.root.mkdir(parents=True)
            with mutex(q.root / 'coada.lock'):
                with self.assertRaises(E3Error):
                    q.adauga([str(fa_plan(root, 'A'))], 'chat')
            self.assertEqual(q.adauga([str(fa_plan(root, 'B'))], 'chat')['id'], 'c000001')


class LucratorTests(unittest.TestCase):
    def test_ordinea_un_model_odata_lacat_doar_cat_e_pornit(self):
        with temporar() as root:
            s = Sistem(root)
            a, b, c = fa_plan(root, 'A'), fa_plan(root, 'B'), fa_plan(root, 'C')
            s.coada.adauga([str(a), str(b)], 'chat')
            s.coada.adauga([str(c)], 'juridic')
            s.cititori['mineru'] = lambda plan, banda, n: (
                ('Text %s banda %s cu 13 m' if (plan, banda) == ('A', 'p0001_b1') else 'Text %s banda %s cu 12 m') % (plan, banda),
                {'ok': True, 'finish_reason': 'stop'})
            self.assertEqual(s.lucreaza(), 0)
            ordine = [(r, p) for r, p, _ in s.citiri]
            asteptat = [('lighton', x) for x in 'AAABBBCCC'] + [('mineru', x) for x in 'AAABBBCCC']
            self.assertEqual(ordine, asteptat)
            self.assertEqual(s.modele.jurnal, [('start', 'lighton'), ('stop', 'lighton'), ('start', 'mineru'), ('stop', 'mineru')])
            self.assertFalse(s.lacat.exists())
            self.assertEqual(json.loads(s.globale['modele'].read_text()), {})
            self.assertFalse((s.dir / 'modele.json').exists())  # nimic al plăcii în rădăcina cozii
            c1, c2 = s.coada.citeste('c000001'), s.coada.citeste('c000002')
            self.assertEqual((c1['stare'], c2['stare']), ('gata', 'gata'))
            self.assertGreaterEqual(c1['dezacorduri'], 1)
            self.assertEqual(c2['dezacorduri'], 0)
            self.assertTrue((a / 'comparatie.json').exists() and (a / 'dezacorduri.jsonl').exists())
            evs = [e['ev'] for e in s.jurnal() if e['ev'] != 'adaugat']
            self.assertEqual(evs[:2], ['pornire', 'curatat_la_pornire'])
            self.assertEqual([e for e in evs if e in ('incarcat', 'descarcat', 'gata')],
                             ['incarcat', 'descarcat', 'incarcat', 'descarcat', 'gata', 'gata'])
            self.assertEqual(json.loads((s.dir / 'stare.json').read_text())['faza'], 'oprit')

    def test_cererile_noi_intra_in_lotul_urmator(self):
        with temporar() as root:
            s = Sistem(root)
            s.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            b = fa_plan(root, 'B', n=1)
            adaugat = []

            def lighton(plan, banda, n):
                if not adaugat:
                    adaugat.append(s.coada.adauga([str(b)], 'cowork')['id'])
                return s.text_implicit(plan, banda, n)
            s.cititori['lighton'] = lighton
            s.lucreaza()
            self.assertEqual([(r, p) for r, p, _ in s.citiri],
                             [('lighton', 'A'), ('mineru', 'A'), ('lighton', 'B'), ('mineru', 'B')])
            self.assertEqual([e['cereri'] for e in s.ev('lot')], [['c000001'], ['c000002']])

    def test_cedare_la_gpu_cerere_si_reluare_fara_benzi_repetate(self):
        with temporar() as root:
            s = Sistem(root)
            s.coada.adauga([str(fa_plan(root, 'A'))], 'chat')
            e3_lock, e3_cerere = GpuLock(s.lacat), CerereGpu(s.lacat, token='e3')
            vazut = {}

            def lighton(plan, banda, n):
                if banda == 'p0001_b0' and 'cerut' not in vazut:
                    vazut['cerut'] = True
                    e3_cerere.cere()  # E3 are o lucrare: lacătul e al cozii -> E3 doar cere
                return s.text_implicit(plan, banda, n)
            s.cititori['lighton'] = lighton

            def e3():
                if vazut.get('cerut') and 'luat' not in vazut and not s.lacat.exists():
                    # Lacătul a dispărut DOAR după oprirea modelului și memoria confirmată
                    vazut['modele_la_predare'] = s.modele.processes()
                    vazut['memorie_citita'] = s.modele.mem
                    self.assertTrue(e3_lock.claim())
                    e3_cerere.retrage()
                    vazut['luat'] = s.ceas.t
                elif 'luat' in vazut and 'eliberat' not in vazut and s.ceas.t - vazut['luat'] >= 10:
                    e3_lock.release()
                    vazut['eliberat'] = True
            s.hooks.append(e3)
            s.lucreaza()
            self.assertEqual(vazut['modele_la_predare'], {'lighton': [], 'mineru': []})
            self.assertGreater(vazut['memorie_citita'], 0)
            lighton_citite = [b for r, p, b in s.citiri if r == 'lighton']
            self.assertEqual(lighton_citite, ['p0001_b0', 'p0001_b1', 'p0001_b2'])  # reluarea sare banda gata
            self.assertEqual(s.modele.started, ['lighton', 'lighton', 'mineru'])
            self.assertEqual(s.coada.citeste('c000001')['stare'], 'gata')
            self.assertEqual([e['faza'] for e in s.ev('cedat_e3')], ['citire'])
            self.assertTrue(vazut.get('eliberat'))
            self.assertFalse(cerere_activa(s.lacat))

    def test_cedare_in_timpul_pornirii_modelului(self):
        with temporar() as root:
            s = Sistem(root)
            s.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            s.modele.health = False  # modelul se încălzește
            e3_lock, e3_cerere = GpuLock(s.lacat), CerereGpu(s.lacat, token='e3')
            st = {}

            def h():  # somnul fals bate la fiecare secundă: pașii E3 depind de stare, nu de numărul de apeluri
                if 'cerut' not in st:
                    st['cerut'] = e3_cerere.cere() or True
                elif 'luat' not in st and not s.lacat.exists():
                    st['modele_la_predare'] = s.modele.processes()
                    st['luat'] = e3_lock.claim() and s.ceas.t
                    e3_cerere.retrage()
                elif st.get('luat') and 'eliberat' not in st and s.ceas.t - st['luat'] >= 5:
                    e3_lock.release(); s.modele.health = True; st['eliberat'] = True
            s.hooks.append(h)
            s.lucreaza()
            self.assertEqual(st['modele_la_predare'], {'lighton': [], 'mineru': []})
            self.assertTrue(st['eliberat'])
            self.assertEqual(s.ev('cedat_e3')[0]['faza'], 'pornire')
            self.assertEqual(s.modele.started, ['lighton', 'lighton', 'mineru'])
            self.assertEqual(s.coada.citeste('c000001')['stare'], 'gata')

    def test_lacatul_ramane_pana_la_memoria_confirmata(self):
        with temporar() as root:
            s = Sistem(root)
            s.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            orig_stop, vazut = s.modele.stop, []

            def stop(name, pids):
                orig_stop(name, pids)
                if name == 'lighton' and not vazut:
                    s.modele.ramasa_mb = 6000  # procesul a dispărut, memoria plăcii nu (încă)

            s.modele.stop = stop

            def h():
                if s.modele.ramasa_mb:
                    t0 = vazut[0][0] if vazut else s.ceas.t
                    # cât memoria e ținută: lacătul e tot al cozii și MinerU nu pornește
                    vazut.append((t0, json.loads(s.lacat.read_text())['detinator'], tuple(s.modele.started)))
                    if s.ceas.t - t0 >= 170:
                        s.modele.ramasa_mb = 0
            s.hooks.append(h)
            s.lucreaza()
            self.assertGreater(len(vazut), 100)
            self.assertEqual({(d, st) for _, d, st in vazut}, {('ocr_coada', ('lighton',))})
            self.assertEqual([(e['cod'], e['treapta']) for e in s.ev('pauza')],
                             [('descarcare_neconfirmata', 60), ('descarcare_neconfirmata', 120)])
            self.assertEqual(s.modele.started, ['lighton', 'mineru'])
            self.assertFalse(s.lacat.exists())
            self.assertEqual(s.coada.citeste('c000001')['stare'], 'gata')

    def test_curatare_la_pornire_dupa_cadere(self):
        with temporar() as root:
            vechi = GpuLock(root / 'paw' / 'gpu.lock', detinator=Q.DETINATOR)
            (root / 'paw').mkdir(parents=True)
            self.assertTrue(vechi.claim())  # instanța căzută a cozii
            s = Sistem(root, alive=lambda pid: False)
            s.modele.running['lighton'] = [77]
            s.globale['modele'].write_text(json.dumps({'cititor': 'lighton', 'vram_inainte': 1400}))
            s.lucreaza()
            self.assertEqual(s.modele.jurnal, [('stop', 'lighton')])
            self.assertGreater(s.modele.mem, 0)
            self.assertFalse(s.lacat.exists())
            self.assertEqual(json.loads(s.globale['modele'].read_text()), {})
            self.assertEqual(len(s.ev('curatat_la_pornire')), 1)

    def test_cadere_in_pornire_lasa_obligatia_memoriei_pe_disc(self):
        class Cadere(BaseException):
            pass
        with temporar() as root:
            s = Sistem(root)
            s.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            orig = s.modele.start

            def start(name):
                orig(name)
                raise Cadere()  # procesul cozii moare între pornirea vLLM și orice altă scriere
            s.modele.start = start
            with self.assertRaises(Cadere):
                s.lucreaza()
            self.assertEqual(json.loads(s.globale['modele'].read_text())['cititor'], 'lighton')
            # repornire: procesul vLLM a murit odată cu WSL-ul, dar memoria plăcii e încă ținută
            s.modele.running['lighton'], s.modele.ramasa_mb, s.modele.start = [], 6000, orig
            s2 = Sistem(root, alive=lambda pid: False, modele=s.modele)
            vazut = []

            def h():
                vazut.append(s2.lacat.exists())
                if len(vazut) == 30:
                    s.modele.ramasa_mb = 0
            s2.hooks.append(h)
            s2.lucreaza()
            self.assertTrue(all(vazut))  # lacătul nu se eliberează pe memoria neconfirmată
            self.assertEqual(s2.ev('pauza')[0]['cod'], 'descarcare_neconfirmata')
            self.assertEqual(s2.coada.citeste('c000001')['stare'], 'gata')

    def test_pornire_cu_lacatul_e3_nu_atinge_nimic_si_asteapta(self):
        with temporar() as root:
            s = Sistem(root)
            e3 = GpuLock(s.lacat)
            self.assertTrue(e3.claim())
            s.modele.running['lighton'] = [55]  # modelele E3
            inainte = s.lacat.read_bytes()
            s.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')

            def h():
                if len(s.somn) == 1:
                    self.assertEqual(s.lacat.read_bytes(), inainte)
                    self.assertEqual(s.modele.stopped, [])
                elif len(s.somn) == 3:
                    s.modele.running['lighton'] = []
                    e3.release()
            s.hooks.append(h)
            s.lucreaza()
            self.assertEqual(len(s.ev('pornire_lacat_altcuiva')), 1)
            self.assertEqual(s.modele.started, ['lighton', 'mineru'])
            self.assertEqual(s.coada.citeste('c000001')['stare'], 'gata')

    def test_memorie_tinuta_fara_lacat_nu_porneste_model(self):
        with temporar() as root:
            s = Sistem(root)
            s.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            s.modele.strain_mb = 6000

            def h():
                self.assertEqual(s.modele.started, [])
                self.assertFalse(s.lacat.exists())  # lacătul nu e ținut cât așteptăm memoria altuia
                if len(s.somn) == 2:
                    s.modele.strain_mb = 0
            s.hooks.append(h)
            s.lucreaza()
            self.assertEqual(len(s.ev('memorie_tinuta')), 1)
            self.assertEqual(s.coada.citeste('c000001')['stare'], 'gata')

    def test_instanta_unica_pe_masina_oricare_radacina(self):
        """Jakarinos #1190 r1 P1: instanța e a plăcii (lângă gpu.lock), nu a rădăcinii. O instanță VIE pe rădăcina A
        (mutexul real, ținut de procesul A) -> B, cu altă rădăcină, refuză fără să atingă placa sau lacătul."""
        with temporar() as root:
            a = Sistem(root, dir_coada='coada_a')
            a.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            b = Sistem(root, dir_coada='coada_b')
            b.coada.adauga([str(fa_plan(root, 'B', n=1))], 'cowork')
            rezultat = {}

            def prea_mult():  # B a trecut de instanță și așteaptă lacătul lui A: oprit, altfel testul s-ar bloca
                if len(b.somn) > 20:
                    raise Q.Oprit()
            b.hooks.append(prea_mult)

            def in_timpul_lui_a(plan, banda, n):  # A citește (are mutexul, lacătul, modelul): pornim B
                try:
                    b.lucreaza()
                    rezultat['cod'] = 'B a rulat langa A'
                except E3Error as e:
                    rezultat['cod'] = e.cod
                return a.text_implicit(plan, banda, n)
            a.cititori['lighton'] = in_timpul_lui_a
            a.lucreaza()
            self.assertEqual(rezultat['cod'], 'ocupat')
            self.assertEqual(b.modele.mem, 0)  # B n-a citit memoria, n-a oprit nimic
            self.assertEqual(b.modele.jurnal, [])
            self.assertEqual(b.ev('pornire'), [])
            self.assertEqual(b.coada.citeste('c000001')['stare'], 'asteapta')
            self.assertEqual(a.coada.citeste('c000001')['stare'], 'gata')
            # după A, B pornește normal (mutexul a fost eliberat) și vede aceeași placă
            b.lucreaza()
            self.assertEqual(b.coada.citeste('c000001')['stare'], 'gata')
            self.assertEqual(json.loads(b.globale['info'].read_text())['root'], str(b.dir))

    def test_obligatia_memoriei_e_a_placii_nu_a_radacinii(self):
        """A (rădăcina coada_a) moare după pornirea vLLM; B pornește pe ALTĂ rădăcină: vede obligația lui A și nu
        eliberează lacătul până la memoria confirmată."""
        class Cadere(BaseException):
            pass
        with temporar() as root:
            a = Sistem(root, dir_coada='coada_a')
            a.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            orig = a.modele.start

            def start(name):
                orig(name)
                raise Cadere()
            a.modele.start = start
            with self.assertRaises(Cadere):
                a.lucreaza()
            a.modele.running['lighton'], a.modele.ramasa_mb, a.modele.start = [], 6000, orig
            b = Sistem(root, alive=lambda pid: False, modele=a.modele, dir_coada='coada_b')
            vazut = []

            def h():
                vazut.append(b.lacat.exists())
                if len(vazut) == 30:
                    a.modele.ramasa_mb = 0
            b.hooks.append(h)
            mem0 = a.modele.mem
            b.lucreaza()
            self.assertTrue(vazut and all(vazut))
            self.assertGreater(a.modele.mem, mem0)
            self.assertEqual(b.ev('pauza')[0]['cod'], 'descarcare_neconfirmata')
            self.assertFalse(b.lacat.exists())
            self.assertEqual(json.loads(b.globale['modele'].read_text()), {})

    def test_lacat_preluat_fara_fisierul_obligatiei_verifica_memoria(self):
        """Proba lui Jakarinos: lacătul vechi al cozii, procesele vLLM dispărute, memoria încă ținută și fișierul
        obligației LIPSĂ -> memoria se citește oricum, lacătul rămâne până la confirmare."""
        with temporar() as root:
            (root / 'paw').mkdir(parents=True)
            self.assertTrue(GpuLock(root / 'paw' / 'gpu.lock', detinator=Q.DETINATOR).claim())  # instanța căzută
            s = Sistem(root, alive=lambda pid: False)
            self.assertFalse(s.globale['modele'].exists())
            s.modele.ramasa_mb = 6000
            vazut = []

            def h():
                vazut.append(s.lacat.exists())
                if len(vazut) == 20:
                    s.modele.ramasa_mb = 0
            s.hooks.append(h)
            s.lucreaza()
            self.assertGreater(s.modele.mem, 0)
            self.assertTrue(vazut and all(vazut))
            self.assertEqual(len(s.ev('lacat_preluat_la_pornire')), 1)
            self.assertEqual(s.ev('pauza')[0]['cod'], 'descarcare_neconfirmata')
            self.assertFalse(s.lacat.exists())

    def test_lacat_ilizibil_la_pornire_verifica_memoria(self):
        """gpu.lock stricat (rămas de la o cădere) = deținător necunoscut: necunoscut ≠ liber, memoria se verifică."""
        with temporar() as root:
            s = Sistem(root)
            s.lacat.write_text('{"detinator": "ocr_co')
            s.modele.ramasa_mb = 6000
            vazut = []

            def h():
                vazut.append(s.lacat.exists())
                if len(vazut) == 20:
                    s.modele.ramasa_mb = 0
            s.hooks.append(h)
            s.lucreaza()
            self.assertTrue(vazut and all(vazut))
            self.assertEqual(len(s.ev('lacat_preluat_la_pornire')), 1)
            self.assertFalse(s.lacat.exists())

    def test_lacat_liber_fara_obligatie_nu_tine_placa(self):
        """Contraproba: lacăt liber + nicio obligație = curățenia nu ține lacătul pe memoria altcuiva (E3 / laborator)."""
        with temporar() as root:
            s = Sistem(root)
            s.modele.strain_mb = 6000
            s.lucreaza()
            self.assertEqual(s.ev('pauza'), [])
            self.assertEqual(s.ev('lacat_preluat_la_pornire'), [])
            self.assertFalse(s.lacat.exists())

    def test_coordonator_cu_stare_in_radacina_refuzat(self):
        with temporar() as root:
            s = Sistem(root)
            for coord in (Coordinator(s.lock, s.modele, s.dir / 'modele.json'),
                          Coordinator(GpuLock(root / 'alt.lock', detinator=Q.DETINATOR), s.modele, s.globale['modele']),
                          Coordinator(GpuLock(s.lacat), s.modele, s.globale['modele'])):
                with self.subTest(stare=str(coord.path), lacat=str(coord.lock.path), det=coord.lock.detinator):
                    with self.assertRaisesRegex(ValueError, 'coordinatorul cozii'):
                        Q.Lucrator(s.dir, coord, s.modele, gpu_lock_path=s.lacat, radacini=(root,))

    def test_plan_stricat_eroare_restul_continua(self):
        with temporar() as root:
            s = Sistem(root)
            a, b, c = fa_plan(root, 'A'), fa_plan(root, 'B'), fa_plan(root, 'C')
            s.coada.adauga([str(a)], 'chat')
            s.coada.adauga([str(b)], 'chat')
            s.coada.adauga([str(c)], 'chat')
            (a / 'page0001' / 'p0001_b1.png').write_bytes(b'alta imagine')  # imaginea s-a schimbat
            pj = json.loads((b / 'plan.json').read_text()); pj['nota'] = 'replanificat'
            (b / 'plan.json').write_text(json.dumps(pj))  # plan.json schimbat după adăugare
            s.lucreaza()
            c1, c2, c3 = (s.coada.citeste(i) for i in ('c000001', 'c000002', 'c000003'))
            self.assertEqual((c1['stare'], c2['stare'], c3['stare']), ('eroare', 'eroare', 'gata'))
            self.assertIn('s-a schimbat', c1['motiv'])
            self.assertIn('plan.json s-a schimbat', c2['motiv'])
            self.assertEqual({p for _, p, _ in s.citiri}, {'C'})
            self.assertEqual(s.modele.started, ['lighton', 'mineru'])

    def test_citire_oprita_eroare_pe_cerere_model_repornit(self):
        with temporar() as root:
            s = Sistem(root)
            s.coada.adauga([str(fa_plan(root, 'A'))], 'chat')
            s.coada.adauga([str(fa_plan(root, 'B'))], 'chat')
            s.cititori['lighton'] = lambda plan, banda, n: (
                ('', {'ok': False, 'error': 'TimeoutError', 'signal': 'deadline'}) if (plan, banda) == ('A', 'p0001_b1')
                else s.text_implicit(plan, banda, n))
            s.lucreaza()
            c1, c2 = s.coada.citeste('c000001'), s.coada.citeste('c000002')
            self.assertEqual((c1['stare'], c2['stare']), ('eroare', 'gata'))
            self.assertIn('stopped_no_retry', c1['motiv'])
            # backend-ul neconfirmat liber -> modelul oprit (cu dovadă) și repornit pentru planul următor
            self.assertEqual(s.modele.jurnal[:4], [('start', 'lighton'), ('stop', 'lighton'), ('start', 'lighton'), ('stop', 'lighton')])
            self.assertNotIn(('mineru', 'A'), [(r, p) for r, p, _ in s.citiri])

    def test_banda_intrerupta_la_cadere_ramane_la_om(self):
        with temporar() as root:
            s = Sistem(root)
            a = fa_plan(root, 'A')
            d = a / 'page0001' / 'p0001_b0' / 'lighton'; d.mkdir(parents=True)
            (d / 'request_started.json').write_text('{}')
            s.coada.adauga([str(a)], 'chat')
            s.coada.adauga([str(fa_plan(root, 'B', n=1))], 'chat')
            s.lucreaza()
            self.assertIn('interrupted_needs_review', s.coada.citeste('c000001')['motiv'])
            self.assertEqual(s.coada.citeste('c000002')['stare'], 'gata')

    def test_exceptie_repetata_pauze_cu_plafon_apoi_eroare(self):
        with temporar() as root:
            reale = functools.partial(RD.run_reader, check_server=False)

            def rr(d, reader, **kw):
                if pathlib.Path(d).name == 'A':
                    raise RuntimeError('neprevazut')
                return reale(d, reader, **kw)
            s = Sistem(root, run_reader=rr)
            s.coada.adauga([str(fa_plan(root, 'A'))], 'chat')
            s.coada.adauga([str(fa_plan(root, 'B', n=1))], 'chat')
            s.lucreaza()
            c1 = s.coada.citeste('c000001')
            self.assertEqual(c1['stare'], 'eroare')
            self.assertIn('de 3 ori', c1['motiv'])
            self.assertEqual([(e['cod'], e['treapta']) for e in s.ev('pauza')], [('infra', 60), ('infra', 120)])
            self.assertEqual(s.coada.citeste('c000002')['stare'], 'gata')
            self.assertEqual(s.modele.started.count('lighton'), 4)  # 3 încercări pe A + una curată pentru B

    def test_model_care_nu_porneste_pauza_apoi_reluare(self):
        with temporar() as root:
            s = Sistem(root)
            s.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            s.modele.health = False

            def h():
                if s.ev('pauza'):
                    s.modele.health = True
            s.hooks.append(h)
            s.lucreaza()
            self.assertEqual([(e['cod'], e['treapta']) for e in s.ev('pauza')], [('pornire_esuata', 60)])
            self.assertEqual(s.ev('descarcat')[0]['motiv'], 'pornire_esuata')
            self.assertEqual(len(s.ev('reluat')), 1)
            self.assertEqual(s.coada.citeste('c000001')['stare'], 'gata')

    def test_oprire_dupa_banda_curenta_si_reluare_la_repornire(self):
        with temporar() as root:
            s = Sistem(root)
            a = fa_plan(root, 'A')
            s.coada.adauga([str(a)], 'chat')

            def mineru(plan, banda, n):
                if banda == 'p0001_b0':
                    (s.dir / 'opreste').touch()
                return s.text_implicit(plan, banda, n)
            s.cititori['mineru'] = mineru
            self.assertEqual(s.lucreaza(), 0)
            self.assertEqual(s.coada.citeste('c000001')['stare'], 'citeste_mineru')
            self.assertFalse(s.lacat.exists())
            self.assertEqual(s.modele.processes(), {'lighton': [], 'mineru': []})
            self.assertEqual(s.ev('oprit')[0]['lacat_pastrat'], False)
            self.assertEqual(json.loads((a / 'read_mineru.json').read_text())['status'], 'oprit')
            # repornire (proces nou, alt token): LightOn nu se mai citește, MinerU reia de la banda 1
            s2 = Sistem(root)
            s2.lucreaza()
            self.assertEqual(s2.citiri, [('mineru', 'A', 'p0001_b1'), ('mineru', 'A', 'p0001_b2')])
            self.assertEqual(s2.modele.started, ['mineru'])
            self.assertEqual(s2.coada.citeste('c000001')['stare'], 'gata')


@contextlib.contextmanager
def afara():
    """Folder în AFARA rădăcinilor permise ale testelor (frate cu .tmp/coada-test): ținta legăturilor rău-intenționate."""
    d = BASE / '.tmp' / 'coada-afara'
    d.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=d) as tmp:
        yield pathlib.Path(tmp)


def junction(tinta, legatura):
    import _winapi
    _winapi.CreateJunction(str(tinta), str(legatura))


class DestinatiiTests(unittest.TestCase):
    """Jakarinos #1190 r1 P1: reparse / legături fizice pe DESTINAȚIILE scrierilor (nu doar pe intrări)."""

    @unittest.skipUnless(os.name == 'nt', 'junction doar pe Windows')
    def test_junction_la_folderul_rezultatelor_refuzat_nimic_scris_afara(self):
        with temporar() as root, afara() as ext:
            s = Sistem(root)
            a, b = fa_plan(root, 'A'), fa_plan(root, 'B', n=1)
            tinta = ext / 'tinta'; tinta.mkdir()
            dest = a / 'page0001' / 'p0001_b0'; dest.mkdir(parents=True)
            junction(tinta, dest / 'lighton')
            try:
                with self.assertRaisesRegex(ValueError, 'reparse point refuzat'):
                    s.coada.adauga([str(a)], 'chat')  # refuz la adăugare
                self.assertEqual(s.coada.ids(), [])
                os.rmdir(dest / 'lighton')
                s.coada.adauga([str(a)], 'chat')
                s.coada.adauga([str(b)], 'chat')
                junction(tinta, dest / 'lighton')  # legătura apare DUPĂ adăugare: refuz și înaintea citirii
                s.lucreaza()
                c1 = s.coada.citeste('c000001')
                self.assertEqual(c1['stare'], 'eroare')
                self.assertIn('reparse point refuzat', c1['motiv'])
                self.assertEqual(list(tinta.iterdir()), [])  # nimic scris prin legătură
                self.assertNotIn('A', {p for _, p, _ in s.citiri})
                self.assertEqual(s.coada.citeste('c000002')['stare'], 'gata')
            finally:
                if (dest / 'lighton').exists():
                    os.rmdir(dest / 'lighton')

    @unittest.skipUnless(os.name == 'nt', 'junction doar pe Windows')
    def test_junction_pe_folderul_benzii_sau_al_celuilalt_cititor(self):
        # (o legătură pe folderul paginii o prinde deja load_plan: imaginile s-ar rezolva în afara planului)
        with temporar() as root, afara() as ext:
            q = Q.Coada(root / 'coada', radacini=(root,))
            for i, rel in enumerate(('page0001/p0001_b1', 'page0001/p0001_b2/mineru')):
                with self.subTest(rel=rel):
                    a = fa_plan(root, 'P%d' % i)
                    t = ext / ('t%d' % i); t.mkdir()
                    (a / rel).parent.mkdir(parents=True, exist_ok=True)
                    junction(t, a / rel)
                    try:
                        with self.assertRaisesRegex(ValueError, 'reparse point refuzat'):
                            q.adauga([str(a)], 'chat')
                    finally:
                        os.rmdir(a / rel)
            self.assertEqual(q.ids(), [])

    def test_legatura_fizica_la_un_rezultat_refuzata(self):
        with temporar() as root, afara() as ext:
            s = Sistem(root)
            a = fa_plan(root, 'A')
            s.coada.adauga([str(a)], 'chat')
            s.coada.adauga([str(fa_plan(root, 'B', n=1))], 'chat')
            secret = ext / 'secret.txt'; secret.write_bytes(b'neatins')
            d = a / 'page0001' / 'p0001_b0' / 'lighton'; d.mkdir(parents=True)
            os.link(secret, d / 'raw.txt')  # raw.txt se scrie PE LOC (write_bytes): ar ajunge în fișierul de afară
            s.lucreaza()
            c1 = s.coada.citeste('c000001')
            self.assertEqual(c1['stare'], 'eroare')
            self.assertIn('legatura fizica refuzata', c1['motiv'])
            self.assertEqual(secret.read_bytes(), b'neatins')
            self.assertEqual(s.coada.citeste('c000002')['stare'], 'gata')
            with self.assertRaisesRegex(ValueError, 'legatura fizica'):
                Q.Coada(root / 'alta', radacini=(root,)).adauga([str(a)], 'chat')

    def test_temporarele_lui_save_legate_fizic(self):
        """client.save scrie `<nume>.tmp` PE LOC, apoi os.replace: un .tmp legat fizic ar scrie afară chiar dacă ținta
        finală e curată. Plan, rădăcina cozii și fișierele de lângă gpu.lock."""
        with temporar() as root, afara() as ext:
            secret = ext / 'secret.txt'; secret.write_bytes(b'neatins')
            q = Q.Coada(root / 'coada', radacini=(root,))
            for i, rel in enumerate(('read_lighton.json.tmp', 'page0001/p0001_b1/mineru/result.json.tmp')):
                with self.subTest(rel=rel):
                    a = fa_plan(root, 'T%d' % i)
                    (a / rel).parent.mkdir(parents=True, exist_ok=True)
                    os.link(secret, a / rel)
                    with self.assertRaisesRegex(ValueError, 'legatura fizica'):
                        q.adauga([str(a)], 'chat')
            s = Sistem(root, dir_coada='c2')
            (s.dir / 'cereri').mkdir(parents=True)
            for rel in ('stare.json.tmp', 'cereri/c000001.json.tmp'):
                with self.subTest(rel=rel):
                    os.link(secret, s.dir / rel)
                    with self.assertRaisesRegex(ValueError, 'legatura fizica'):
                        s.lucreaza()
                    os.unlink(s.dir / rel)
            for p in (pathlib.Path(str(s.globale['modele']) + '.tmp'), pathlib.Path(str(s.lacat) + '.pending'),
                      pathlib.Path(str(s.lacat) + '.pending.tmp'), pathlib.Path(str(s.lacat) + '.coord')):
                with self.subTest(p=p.name):
                    os.link(secret, p)
                    with self.assertRaisesRegex(ValueError, 'legatura fizica'):
                        s.lucreaza()
                    os.unlink(p)
            self.assertEqual(s.modele.mem, 0)
            self.assertEqual(secret.read_bytes(), b'neatins')
            self.assertEqual(s.lucreaza(), 0)

    def test_o_cerere_legata_fizic_nu_opreste_coada(self):
        """Verificarea rădăcinii sare fișierele cererilor (le izolează Coada.citeste): o cerere nesigură = eroare pe ea,
        restul merge, iar originalul mutat în invalide/ nu blochează pornirile următoare."""
        with temporar() as root, afara() as ext:
            s = Sistem(root)
            m = s.coada.adauga([str(fa_plan(root, 'M', n=1))], 'chat')
            secret = ext / 'cerere.json'; secret.write_bytes((s.coada.cereri / 'c000001.json').read_bytes())
            os.unlink(s.coada.cereri / 'c000001.json')
            os.link(secret, s.coada.cereri / 'c000001.json')
            inainte = secret.read_bytes()
            s.coada.adauga([str(fa_plan(root, 'B', n=1))], 'chat')
            self.assertEqual(s.lucreaza(), 0)
            self.assertEqual((m['id'], s.coada.citeste('c000001')['stare']), ('c000001', 'eroare'))
            self.assertEqual(s.coada.citeste('c000002')['stare'], 'gata')
            self.assertEqual(secret.read_bytes(), inainte)
            self.assertEqual(len(list((s.coada.cereri / 'invalide').iterdir())), 1)
            s.coada.adauga([str(fa_plan(root, 'C', n=1))], 'chat')
            self.assertEqual(Sistem(root).lucreaza(), 0)
            self.assertEqual(s.coada.citeste('c000003')['stare'], 'gata')

    def test_intrare_disparuta_in_timpul_verificarii(self):
        """Un `.tmp` al unui save din altă comandă (ex. `adauga` în paralel) dispare între listare și lstat: nu e o
        destinație de scris, verificarea merge mai departe (și tot prinde o legătură fizică de alături)."""
        with temporar() as root, afara() as ext:
            d = root / 'coada'; (d / 'cereri').mkdir(parents=True)
            (d / 'cereri' / 'c000001.json.tmp').write_text('{}')
            reala = os.lstat

            def lstat(p, *a, **k):
                if str(p).endswith('c000001.json.tmp'):
                    raise FileNotFoundError(p)
                return reala(p, *a, **k)
            with patch.object(Q.os, 'lstat', side_effect=lstat):
                self.assertEqual(Q.verifica_radacina(d), d)
                secret = ext / 's.txt'; secret.write_text('x')
                # legătura stă în ACELAȘI folder cu intrarea dispărută: dispariția nu trebuie să oprească scanarea folderului
                for nume in ('c000000.json.tmp', 'c000002.json.tmp', 'zzz.tmp'):
                    with self.subTest(nume=nume):
                        os.link(secret, d / 'cereri' / nume)
                        with self.assertRaisesRegex(ValueError, 'legatura fizica'):
                            Q.verifica_radacina(d)
                        os.unlink(d / 'cereri' / nume)

    def test_tipul_destinatiilor(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,))
            cazuri = {'comparatie.json': ('dir', 'folder in locul'), 'text_conv.txt': ('dir', 'folder in locul'),
                      'page0001/p0001_b0/lighton/result.json': ('dir', 'folder in locul'),
                      'page0001/p0001_b0': ('fisier', 'fisier in locul'), 'page0001/p0001_b2/mineru': ('fisier', 'fisier in locul')}
            for i, (rel, (fel, motiv)) in enumerate(cazuri.items()):
                with self.subTest(rel=rel):
                    a = fa_plan(root, 'T%d' % i)
                    p = a / rel
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.mkdir() if fel == 'dir' else p.write_text('x')
                    with self.assertRaisesRegex(ValueError, motiv):
                        q.adauga([str(a)], 'chat')
            # contraproba: rezultate obișnuite de la o citire anterioară (reluare) trec
            a = fa_plan(root, 'OK')
            d = a / 'page0001' / 'p0001_b0' / 'lighton'; d.mkdir(parents=True)
            (d / 'raw.txt').write_text('x'); (d / 'result.json').write_text('{}'); (a / 'read_lighton.json').write_text('{}')
            self.assertEqual(q.adauga([str(a)], 'chat')['id'], 'c000001')

    def test_radacina_cozii_si_fisierele_globale(self):
        with temporar() as root, afara() as ext:
            secret = ext / 'secret.txt'; secret.write_bytes(b'neatins')
            # jurnal.jsonl se scrie cu open('a'): o legătură fizică l-ar scrie afară
            s = Sistem(root)
            s.dir.mkdir(parents=True)
            os.link(secret, s.dir / 'jurnal.jsonl')
            with self.assertRaisesRegex(ValueError, 'legatura fizica'):
                s.lucreaza()
            with self.assertRaisesRegex(ValueError, 'legatura fizica'):
                Q.verifica_radacina(s.dir)
            os.unlink(s.dir / 'jurnal.jsonl')
            # obligația memoriei, lângă gpu.lock
            os.link(secret, s.globale['modele'])
            with self.assertRaisesRegex(ValueError, 'legatura fizica'):
                s.lucreaza()
            self.assertEqual(s.modele.mem, 0)
            os.unlink(s.globale['modele'])
            self.assertEqual(secret.read_bytes(), b'neatins')
            self.assertEqual(s.lucreaza(), 0)

    @unittest.skipUnless(os.name == 'nt', 'junction doar pe Windows')
    def test_radacina_cu_cereri_legat_refuzata_in_linia_de_comanda(self):
        with temporar() as root, afara() as ext, patch.object(Q, 'RADACINI', (root,)):
            r = root / 'coada'; r.mkdir()
            junction(ext, r / 'cereri')
            try:
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    cod = Q.main(['adauga', str(fa_plan(root, 'A')), '--cine', 'chat', '--root', str(r)])
                self.assertEqual(cod, 2)
                self.assertIn('reparse', json.loads(out.getvalue())['eroare'])
                self.assertEqual(list(ext.iterdir()), [])
            finally:
                os.rmdir(r / 'cereri')


class CereriInvalideTests(unittest.TestCase):
    """Jakarinos #1190 r1 P2: o cerere cu structură invalidă se izolează ca eroare, restul cozii continuă."""

    def scrie_brut(self, q, id, text):
        q.cereri.mkdir(parents=True, exist_ok=True)
        (q.cereri / (id + '.json')).write_bytes(text.encode('utf-8') if isinstance(text, str) else text)

    def valida(self, q, root, nume):
        c = q.adauga([str(fa_plan(root, nume, n=1))], 'chat')
        return json.loads((q.cereri / (c['id'] + '.json')).read_text())

    def test_json_imbricat_excesiv_izolat_coada_continua(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,))
            self.scrie_brut(q, 'c000001', '[' * 10000 + ']' * 10000)
            ok = q.adauga([str(fa_plan(root, 'OK', n=1))], 'cowork')
            self.assertEqual(ok['id'], 'c000002')
            lot = q.preia_lot()
            self.assertEqual([c['id'] for c in lot], ['c000002'])
            c = q.citeste('c000001')
            self.assertEqual(c['stare'], 'eroare')
            self.assertIn('imbricare excesiva', c['motiv'])

    def test_director_cu_nume_de_cerere_vizibil_si_izolat(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,))
            q.cereri.mkdir(parents=True, exist_ok=True)
            (q.cereri / 'c000001.json').mkdir()
            self.assertEqual(q.ids(), ['c000001'])
            self.assertIn('c000001', {c['id'] for c in q.stare()['cereri']})
            ok = q.adauga([str(fa_plan(root, 'OK', n=1))], 'cowork')  # nu reutilizează c000001
            self.assertEqual(ok['id'], 'c000002')
            lot = q.preia_lot()
            self.assertEqual([c['id'] for c in lot], ['c000002'])
            c = q.citeste('c000001')
            self.assertEqual(c['stare'], 'eroare')
            self.assertTrue((root / 'coada' / c['original']).is_dir())  # originalul mutat, neatins

    def test_preia_lot_izoleaza_invalidele(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,))
            model = self.valida(q, root, 'M')  # c000001 valid
            os.unlink(q.cereri / 'c000001.json')
            gresite = {
                'c000001': 'null', 'c000002': '[1, 2]', 'c000003': '42', 'c000004': '{"id": "c0000',
                'c000005': json.dumps(dict(model, id='c000009')),  # id-ul altei cereri: scrie() ar suprascrie c000009
                'c000006': json.dumps(dict(model, id='c000006', stare='citeste_altceva')),
                'c000007': json.dumps(dict(model, id='c000007', planuri=[None])),
                'c000008': json.dumps(dict(model, id='c000008', planuri='A')),
                'c000010': json.dumps(dict(model, id='c000010', planuri=[dict(model['planuri'][0], incercari='2')])),
                'c000011': json.dumps(dict(model, id='c000011', planuri=[dict(model['planuri'][0], plan_sha256=None)])),
                'c000012': json.dumps(dict(model, id='c000012', cine=None)),
                'c000013': json.dumps(dict(model, id='c000013', planuri=[])),
                'c000014': b'\xff\xfe nu e utf-8',
            }
            for id, text in gresite.items():
                self.scrie_brut(q, id, text)
            ok = q.adauga([str(fa_plan(root, 'OK', n=1))], 'cowork')  # adauga merge cu invalidele de față
            self.assertEqual(ok['id'], 'c000015')
            st = q.stare()  # stare nu cade
            self.assertEqual({c['id'] for c in st['cereri'] if c['stare'] == 'ilizibil'}, set(gresite))
            originale = {id: (q.cereri / (id + '.json')).read_bytes() for id in gresite}
            lot = q.preia_lot()
            self.assertEqual([c['id'] for c in lot], ['c000015'])
            for id in gresite:
                with self.subTest(id=id):
                    c = q.citeste(id)
                    self.assertEqual(c['stare'], 'eroare')
                    self.assertIn('cerere invalida', c['motiv'])
                    self.assertEqual((root / 'coada' / c['original']).read_bytes(), originale[id])  # originalul păstrat
                    self.assertEqual(c['original_sha256'], hashlib.sha256(originale[id]).hexdigest())
            self.assertFalse((q.cereri / 'c000009.json').exists())
            evs = [json.loads(l) for l in (root / 'coada' / 'jurnal.jsonl').read_text(encoding='utf-8').splitlines()]
            self.assertEqual(sorted(e['cerere'] for e in evs if e['ev'] == 'cerere_invalida'), sorted(gresite))
            self.assertEqual(q.preia_lot(), [dict(q.citeste('c000015'))])  # a doua oară: nimic de izolat
            self.assertEqual(len([l for l in (root / 'coada' / 'jurnal.jsonl').read_text(encoding='utf-8').splitlines()
                                  if '"cerere_invalida"' in l]), len(gresite))

    def test_lucratorul_trece_peste_cererea_null(self):
        with temporar() as root:
            s = Sistem(root)
            self.scrie_brut(s.coada, 'c000001', 'null')
            s.coada.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            self.assertEqual(s.lucreaza(), 0)
            self.assertEqual(s.coada.citeste('c000001')['stare'], 'eroare')
            self.assertEqual(s.coada.citeste('c000002')['stare'], 'gata')
            self.assertEqual(s.ev('cadere'), [])
            self.assertEqual([e['cerere'] for e in s.ev('cerere_invalida')], ['c000001'])

    def test_citire_esuata_acum_nu_e_dovada_de_cerere_stricata(self):
        with temporar() as root:
            q = Q.Coada(root / 'coada', radacini=(root,))
            q.adauga([str(fa_plan(root, 'A', n=1))], 'chat')
            reala = Q.Coada.citeste
            with patch.object(Q.Coada, 'citeste', side_effect=PermissionError('ocupat de antivirus')):
                self.assertEqual(q.preia_lot(), [])
            self.assertEqual(reala(q, 'c000001')['stare'], 'asteapta')  # nu s-a izolat
            self.assertFalse((q.cereri / 'invalide').exists())
            self.assertEqual([c['id'] for c in q.preia_lot()], ['c000001'])

    def test_fisierul_cererii_legatura_fizica_izolat_tinta_neatinsa(self):
        with temporar() as root, afara() as ext:
            q = Q.Coada(root / 'coada', radacini=(root,))
            m = self.valida(q, root, 'M')
            os.unlink(q.cereri / 'c000001.json')
            secret = ext / 'cerere.json'; secret.write_text(json.dumps(m))
            os.link(secret, q.cereri / 'c000001.json')
            inainte = secret.read_bytes()
            self.assertEqual(q.preia_lot(), [])
            c = q.citeste('c000001')
            self.assertEqual(c['stare'], 'eroare')
            self.assertIn('legatura fizica', c['motiv'])
            self.assertEqual(secret.read_bytes(), inainte)


class ProtocolTests(unittest.TestCase):
    def test_lacatul_altui_detinator_nu_se_preia_nici_vechi(self):
        with temporar() as root:
            p = root / 'gpu.lock'
            e3 = GpuLock(p)
            self.assertTrue(e3.claim())
            self.assertEqual(json.loads(p.read_text())['detinator'], 'e3_serviciu')  # implicitul E3 neschimbat
            self.assertFalse(GpuLock(p, detinator=Q.DETINATOR, alive=lambda pid: False).claim())
            e3.release()
            q = GpuLock(p, detinator=Q.DETINATOR)
            self.assertTrue(q.claim())
            self.assertFalse(GpuLock(p, alive=lambda pid: False).claim())  # E3 nu preia lacătul cozii
            e3.release()  # alt deținător: nu se șterge
            self.assertTrue(p.exists())
            self.assertTrue(GpuLock(p, detinator=Q.DETINATOR, alive=lambda pid: False).claim())  # coada: propriul lacăt vechi
            self.assertNotEqual(json.loads(p.read_text())['token'], q.token)

    def test_run_reader_cedare_explicita_si_implicita(self):
        with temporar() as root:
            a = fa_plan(root, 'A')
            lacat = root / 'gpu.lock'
            proto = dict(RD.protocol(), gpu_lock=str(lacat))
            calls = []

            def fn(data, out, cfg, dl):
                calls.append(out.parts[-2])
                return 'text', {'ok': True}
            with patch.dict(RD.FUNCS, {'lighton': fn}), patch('ocr_local.read.protocol', return_value=proto):
                st = RD.run_reader(a, 'lighton', run_id='x', check_weights=False, check_server=False, lock=False,
                                   cedare=lambda: 'oprit' if calls else None)
                self.assertEqual((st['status'], st['band'], calls), ('oprit', 'p0001_b1', ['p0001_b0']))
                CerereGpu(lacat, token='e3').cere()
                # fără lacăt și fără funcție de cedare: comportamentul vechi (citirile E3 nu cedează lor înseși)
                st = RD.run_reader(a, 'lighton', run_id='x', check_weights=False, check_server=False, lock=False)
                self.assertEqual(st['status'], 'complete')
                b = fa_plan(root, 'B')
                st = RD.run_reader(b, 'lighton', run_id='y', check_weights=False, check_server=False)
                self.assertEqual(st['status'], 'cedat_e3')  # cu lacăt: implicit cererea E3
                self.assertFalse(lacat.exists())


class LiniaDeComandaTests(unittest.TestCase):
    def cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            cod = Q.main(list(argv))
        return cod, json.loads(out.getvalue())

    def test_radacina_in_afara_paw_data_refuzata(self):
        with temporar() as root:
            for cmd in (['adauga', str(fa_plan(root, 'A')), '--cine', 'chat'], ['opreste'], ['stare'],
                        ['lucreaza', '--config', str(root / 'nu.json')]):
                with self.subTest(cmd=cmd[0]):
                    cod, res = self.cli(*cmd, '--root', str(root / 'coada'))
                    self.assertEqual(cod, 2)
                    self.assertIn('paw-data', res['eroare'])
            self.assertFalse((root / 'coada').exists())

    def test_adauga_stare_anuleaza(self):
        with temporar() as root, patch.object(Q, 'RADACINI', (root,)):
            a, r = fa_plan(root, 'A'), str(root / 'coada')
            cod, res = self.cli('adauga', str(a), '--cine', 'chat', '--root', r)
            self.assertEqual((cod, res['id'], res['stare']), (0, 'c000001', 'asteapta'))
            cod, res = self.cli('adauga', str(a), '--cine', 'chat', '--root', r)
            self.assertEqual(cod, 2)
            self.assertIn('deja in cererea c000001', res['eroare'])
            cod, res = self.cli('stare', '--cine', 'chat', '--root', r)
            self.assertEqual([(c['id'], c['stare']) for c in res['cereri']], [('c000001', 'asteapta')])
            cod, res = self.cli('anuleaza', 'c000001', '--root', r)
            self.assertEqual((cod, res['stare']), (0, 'anulata'))
            cod, res = self.cli('opreste', '--root', r)
            self.assertTrue((root / 'coada' / 'opreste').exists())


class TextConvTests(unittest.TestCase):
    def test_text_doar_din_sursa_verificata(self):
        import fitz
        with temporar() as root:
            a = fa_plan(root, 'A', n=1)
            pdf_dir = root / 'planuri' / 'pdf'; pdf_dir.mkdir()
            doc = fitz.open(); pg = doc.new_page(); pg.insert_text((72, 72), 'Text nativ al paginii unu ' * 8); doc.save(pdf_dir / 'A.pdf'); doc.close()
            plan = json.loads((a / 'plan.json').read_text())
            self.assertEqual(Q.text_plan(a, plan), {'sarit': 'sursa PDF negasita sau schimbata fata de plan'})
            plan['input_sha256'] = hashlib.sha256((pdf_dir / 'A.pdf').read_bytes()).hexdigest()
            r = Q.text_plan(a, plan)
            self.assertEqual(r['pagini_native'], 1)
            self.assertIn('Text nativ', (a / 'text_conv.txt').read_text(encoding='utf-8'))
            # sursa din plan.json în afara rădăcinilor de citire nu se deschide, chiar cu sha corect
            os.replace(pdf_dir / 'A.pdf', root / 'A.pdf')
            plan['source'] = str(root / 'A.pdf')
            self.assertIn('sarit', Q.text_plan(a, plan))


if __name__ == '__main__':
    unittest.main()
