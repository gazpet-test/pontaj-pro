"""E3 la cerere (decizia Răzvan 19.11.2026): lacătul GPU luat doar pentru lucrări, prioritate prin gpu.cerere
(celălalt proces cedează după pagina curentă), descărcare după inactivitate, pauze cu plafon (nu mii de reîncercări
pe zi), rezultatele citirii neschimbate. Fără GPU și fără WSL: modelele, ceasul și oprirea sunt false."""
import datetime as dt
import hashlib
import json
import os
import pathlib
import socket
import threading
import time
import unittest
from unittest.mock import patch
from ocr_local import read as RD
from ocr_local.e3_contract import E3Error
from ocr_local.e3_gpu import Coordinator, GpuLaCerere, GpuLock, Pauza
from ocr_local.e3_serviciu import REZERVA_CITIRE_S, Worker, config_gpu
from ocr_local.gpu_cedare import VALABILA_S, CerereGpu, cale_cerere, cerere_activa
from test_e3_worker import ACUM, FakeEdge, FakeImage, citire_fixture, request, temporary

ZI = 86400


class Ceas:
    def __init__(self, t=10000.0): self.t = t
    def __call__(self): return self.t


class Modele:
    """WSL fals: procese vLLM, memorie (MB) și sănătate controlate de test; numără apelurile WSL."""
    protocol = {'readers': {'lighton': {'weights_sha256': 'L'}, 'mineru': {'weights_sha256': 'M'}}}
    baseline = 1400

    def __init__(self, ceas=None):
        self.ceas = ceas
        self.running = {'lighton': [], 'mineru': []}
        self.health, self.fail_start, self.blocat, self.strain_mb = True, False, False, 0
        self.started, self.stopped, self.incercari, self.wsl, self.mem = [], [], [], 0, 0

    def processes(self):
        self.wsl += 1
        return {k: list(v) for k, v in self.running.items()}

    def verify(self, name): pass
    def healthy(self, name): return self.health

    def memory_mb(self):
        self.wsl += 1
        self.mem += 1
        incarcate = sum(1 for v in self.running.values() if v)
        return self.baseline + self.strain_mb + 4000 * incarcate + (6000 if self.blocat else 0)

    def stop(self, name, pids):
        self.stopped.append(name)
        self.running[name] = []

    def start(self, name):
        self.incercari.append(self.ceas() if self.ceas else None)
        if self.fail_start:
            raise E3Error('vllm_control')
        self.started.append(name)
        pid = 30 + len(self.started)
        self.running[name] = [pid]
        return pid


def sistem(root, ceas, *, ceas_cerere=None, modele=None, **kw):
    lock = GpuLock(root / 'gpu.lock')
    modele = modele or Modele(ceas)
    coord = Coordinator(lock, modele, root / 'servicii.json', clock=ceas)
    jurnal = []
    cerere = CerereGpu(root / 'gpu.lock', token=lock.token, clock=ceas_cerere or time.time)
    g = GpuLaCerere(coord, cerere, clock=ceas, jurnal=lambda *a: jurnal.append(a),
                    pauza=Pauza(plafon=3600, baza=60, rnd=lambda: 0.0), **kw)
    return g, lock, modele, jurnal


def pasi(g, ceas, n, pas_s=1.0, night=False):
    for _ in range(n):
        g.pas(night)
        ceas.t += pas_s


def stari(jurnal, stare):
    return [a for a in jurnal if a[1] == stare]


def plan_benzi(d, n=3):
    """Plan minim valid pentru read.run_reader (cititorul e fals, imaginea nu se decodează)."""
    out = pathlib.Path(d) / 'plan'
    bands = []
    for i in range(n):
        bid = 'p0001_b%d' % i
        img = out / 'page0001' / (bid + '.png')
        img.parent.mkdir(parents=True, exist_ok=True)
        img.write_bytes(b'banda %d' % i)
        bands.append({'id': bid, 'page': 1, 'image': 'page0001/%s.png' % bid,
                      'image_sha256': hashlib.sha256(img.read_bytes()).hexdigest()})
    (out / 'plan.json').write_text(json.dumps({'status': 'plan_complete', 'bands': bands}), encoding='utf-8')
    return out, bands


class LacatLaCerereTests(unittest.TestCase):
    def test_coada_goala_fara_lacat_fara_modele_fara_wsl(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas)
            pasi(g, ceas, 1)  # pornirea serviciului: curățenia (o singură dată)
            modele.wsl = 0
            pasi(g, ceas, 3600)  # o oră cu coada goală
            self.assertFalse(lock.path.exists())
            self.assertEqual((modele.started, modele.wsl, g.faza), ([], 0, 'rece'))
            self.assertEqual(g.stare(False), 'disponibil')  # admiterea rămâne deschisă: lucrarea trezește modelele
            self.assertEqual(g.stare(True), 'noapte')
            self.assertFalse(g.modele_gata())
            self.assertFalse(cale_cerere(lock.path).exists())

    def test_lucrare_incarca_lucreaza_descarca_dupa_inactivitate(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas, inactiv_s=600)
            pasi(g, ceas, 1)
            b = g.cere()
            g.pas(False)
            self.assertTrue(lock.path.exists())
            self.assertEqual(json.loads(lock.path.read_text())['detinator'], 'e3_serviciu')
            self.assertEqual((g.faza, modele.started), ('incalzire', ['lighton', 'mineru']))
            self.assertFalse(g.asteapta(b, 0))
            ceas.t += 2
            g.pas(False)
            self.assertEqual(g.faza, 'cald')
            self.assertTrue(g.asteapta(b, 0))
            self.assertTrue(g.modele_gata())
            self.assertEqual([a[3] for a in stari(jurnal, 'incarcat')], [2.0])  # durata încărcării, pentru măsurare
            g.gata(b)
            ceas.t += 599
            g.pas(False)
            self.assertEqual(g.faza, 'cald')
            self.assertTrue(lock.path.exists())
            ceas.t += 1
            g.pas(False)
            self.assertEqual(g.faza, 'rece')
            self.assertFalse(lock.path.exists())
            self.assertEqual(sorted(modele.stopped), ['lighton', 'mineru'])
            self.assertEqual(json.loads((root / 'servicii.json').read_text()), {})
            self.assertEqual([a[2] for a in stari(jurnal, 'descarcat')], ['pornire_serviciu', 'inactiv'])

    def test_lucrari_succesive_pastreaza_modelele_calde(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, _ = sistem(root, ceas, inactiv_s=600)
            pasi(g, ceas, 1)
            b = g.cere()
            pasi(g, ceas, 3, pas_s=2)
            self.assertTrue(g.asteapta(b, 0))
            for _ in range(5):  # o lucrare la 5 minute: fără reîncărcări
                g.gata(b)
                ceas.t += 300
                g.pas(False)
                b = g.cere()
                self.assertTrue(g.asteapta(b, 0))
            self.assertEqual(modele.started, ['lighton', 'mineru'])
            g.gata(b)
            ceas.t += 600
            g.pas(False)
            self.assertFalse(lock.path.exists())

    def test_prioritate_laboratorul_cedeaza_dupa_pagina_curenta(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, _ = sistem(root, ceas)
            pasi(g, ceas, 1)
            out, bands = plan_benzi(root)
            calls, bilet = [], []

            def cititor(data, o, cfg, dl):
                calls.append(o)
                if len(calls) == 1:
                    # O lucrare E3 sosește în timpul primei benzi: lacătul e al laboratorului -> E3 doar cere.
                    before = lock.path.read_bytes()
                    bilet.append(g.cere())
                    g.pas(False)
                    self.assertTrue(cerere_activa(lock.path))
                    self.assertEqual(before, lock.path.read_bytes())  # lacătul altuia nu se atinge
                    self.assertEqual(modele.started, [])
                return 'text banda %d' % len(calls), {'ok': True}

            proto = dict(RD.protocol(), gpu_lock=str(lock.path))
            with patch.dict(RD.FUNCS, {'lighton': cititor}), patch('ocr_local.read.protocol', return_value=proto):
                st = RD.run_reader(out, 'lighton', run_id='lab', check_weights=False, check_server=False)
                self.assertEqual((st['status'], st['band'], len(calls)), ('cedat_e3', bands[1]['id'], 1))
                self.assertFalse(lock.path.exists())  # laboratorul a eliberat lacătul după banda curentă
                r0 = json.loads((out / 'page0001' / bands[0]['id'] / 'lighton' / 'result.json').read_text())
                self.assertTrue(r0['ok'])
                g.pas(False)  # E3 ia lacătul, își retrage cererea și încarcă
                self.assertEqual(json.loads(lock.path.read_text())['detinator'], 'e3_serviciu')
                self.assertFalse(cerere_activa(lock.path))
                self.assertEqual(g.faza, 'incalzire')
                ceas.t += 2
                g.pas(False)
                self.assertTrue(g.asteapta(bilet[0], 0))
                with self.assertRaises(RuntimeError):  # cât lucrează E3, laboratorul nu pornește
                    RD.run_reader(out, 'lighton', run_id='lab2', check_weights=False, check_server=False)
                g.gata(bilet[0])
                ceas.t += 600
                g.pas(False)
                self.assertFalse(lock.path.exists())
                st = RD.run_reader(out, 'lighton', run_id='lab3', check_weights=False, check_server=False)
            # Reluarea sare banda deja citită și termină restul: nimic pierdut, nimic citit de două ori.
            self.assertEqual((st['status'], st['skipped_existing'], len(calls)), ('complete', 1, 3))
            self.assertFalse(lock.path.exists())

    def test_laboratorul_nu_cedeaza_e3_renunta_si_anunta_ocupat(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, _ = sistem(root, ceas)
            pasi(g, ceas, 1)
            with RD.gpu_lock(lock.path, 'lab'):
                before = lock.path.read_bytes()
                b = g.cere()
                pasi(g, ceas, 45)
                self.assertTrue(cerere_activa(lock.path))
                self.assertEqual((g.faza, modele.started, before), ('rece', [], lock.path.read_bytes()))
                self.assertFalse(g.asteapta(b, 0))
                self.assertEqual(g.stare(False), 'ocupat')  # 5 minute fără admiteri: UI merge direct pe Sonnet
                g.gata(b)
                g.pas(False)
                self.assertFalse(cale_cerere(lock.path).exists())  # cererea retrasă când nu mai așteaptă nimeni
                ceas.t += 298
                self.assertEqual(g.stare(False), 'ocupat')
                ceas.t += 2
                self.assertEqual(g.stare(False), 'disponibil')
                self.assertEqual(before, lock.path.read_bytes())

    def test_memoria_tinuta_fara_lacat_nu_porneste_vllm(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, _ = sistem(root, ceas)
            pasi(g, ceas, 1)
            modele.strain_mb = 6000  # ex. un model Ollama încărcat fără lacăt
            g.cere()
            g.pas(False)
            self.assertEqual((modele.started, g.faza), ([], 'rece'))
            self.assertFalse(lock.path.exists())
            self.assertTrue(cerere_activa(lock.path))
            wsl = modele.wsl
            pasi(g, ceas, 4)
            self.assertEqual(modele.wsl, wsl)  # reverificare la 5 s, nu la fiecare secundă
            modele.strain_mb = 0
            pasi(g, ceas, 2)
            self.assertEqual((g.faza, modele.started), ('incalzire', ['lighton', 'mineru']))
            self.assertFalse(cerere_activa(lock.path))

    def test_noaptea_descarca_si_nu_atinge_lacatul(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas)
            pasi(g, ceas, 1)
            b = g.cere()
            pasi(g, ceas, 3, pas_s=2)
            self.assertEqual(g.faza, 'cald')
            g.pas(True)
            self.assertEqual((g.faza, g.stare(True)), ('noapte', 'noapte'))
            self.assertFalse(lock.path.exists())
            wsl = modele.wsl
            with RD.gpu_lock(lock.path, 'lab-noapte'):  # tura de noapte a laboratorului
                before = lock.path.read_bytes()
                pasi(g, ceas, 3600, night=True)
                self.assertEqual((modele.wsl, before), (wsl, lock.path.read_bytes()))  # E3 nu mai ia lacătul o clipă / minut
            g.gata(b)
            g.pas(False)
            self.assertEqual(g.faza, 'rece')
            self.assertEqual(stari(jurnal, 'descarcat')[-1][2], 'noapte')

    def test_invalidarea_descarca_iar_lucrarea_urmatoare_reincarca(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas)
            pasi(g, ceas, 1)
            b = g.cere()
            pasi(g, ceas, 3, pas_s=2)
            g.invalidate()
            g.gata(b)
            g.pas(False)
            self.assertEqual((g.faza, lock.path.exists()), ('rece', False))
            self.assertEqual(stari(jurnal, 'descarcat')[-1][2], 'invalidat')
            g.cere()
            pasi(g, ceas, 3, pas_s=2)
            self.assertEqual((g.faza, len(modele.started)), ('cald', 4))

    def test_descarcarea_neconfirmata_pastreaza_lacatul_si_reincearca_cu_pauza(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas, inactiv_s=600)
            pasi(g, ceas, 1)
            b = g.cere()
            pasi(g, ceas, 3, pas_s=2)
            g.gata(b)
            modele.blocat = True  # VRAM-ul nu se eliberează după oprire
            ceas.t += 600
            g.pas(False)
            self.assertEqual((g.faza, g.stare(False)), ('eroare', 'eroare'))
            self.assertTrue(lock.path.exists())
            pasi(g, ceas, 59)
            self.assertTrue(lock.path.exists())
            # A doua încercare (procesele au dispărut deja) verifică din nou memoria: tot blocată -> lacătul rămâne.
            pasi(g, ceas, 2)
            self.assertEqual((g.faza, lock.path.exists()), ('eroare', True))
            modele.blocat = False
            pasi(g, ceas, 120)
            self.assertEqual((g.faza, g.stare(False)), ('rece', 'disponibil'))
            self.assertFalse(lock.path.exists())
            self.assertEqual([a[3] for a in stari(jurnal, 'gpu_pauza')], [60, 120])

    def test_pornirea_serviciului_curata_modelele_ramase_si_lacatul_vechi(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas)
            lock.path.write_text(json.dumps({'detinator': 'e3_serviciu', 'pid': 2 ** 22 + 12345, 'pornit_la': 1.0,
                                             'gazda': socket.gethostname(), 'token': 'vechi'}))
            modele.running = {'lighton': [11], 'mineru': [22]}
            g.pas(False)
            self.assertFalse(lock.path.exists())
            self.assertEqual((sorted(modele.stopped), g.faza), (['lighton', 'mineru'], 'rece'))
            self.assertEqual(stari(jurnal, 'descarcat')[0][2], 'pornire_serviciu')
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, _ = sistem(root, ceas)
            with RD.gpu_lock(lock.path, 'lab'):
                before = lock.path.read_bytes()
                modele.running = {'lighton': [11], 'mineru': []}
                g.pas(False)
                self.assertEqual((before, modele.stopped), (lock.path.read_bytes(), []))  # lacătul laboratorului: nimic atins


def lacat_vechi(path):
    """Lacătul E3 al unei instanțe căzute (PID inexistent): claim-ul îl socotește vechi și îl preia."""
    path.write_text(json.dumps({'detinator': 'e3_serviciu', 'pid': 2 ** 22 + 12345, 'pornit_la': 1.0,
                                'gazda': socket.gethostname(), 'token': 'vechi'}))


def in_fir(f, *a):
    """Rulează f pe alt fir; excepția nu se pierde (se verifică după join)."""
    erori = []

    def run():
        try:
            f(*a)
        except BaseException as exc:  # noqa: B902 - testul o raportează
            erori.append(exc)
    fir = threading.Thread(target=run, daemon=True)
    fir.start()
    return fir, erori


class OprireCuBariera:
    """Modele.stop oprit la barieră până la `continua`: firul de întreținere a decis descărcarea și oprește modelele.
    Înainte de r2, exact în fereastra asta faza rămânea `cald` și o lucrare nouă era admisă la citire."""
    def __init__(self, modele):
        self.modele, self.vechi = modele, modele.stop
        self.in_oprire, self.continua = threading.Event(), threading.Event()
        modele.stop = self

    def __call__(self, name, pids):
        self.in_oprire.set()
        if not self.continua.wait(10):
            raise RuntimeError('bariera nedeblocata')
        self.vechi(name, pids)

    def scoate(self):
        self.modele.stop = self.vechi


class AtomicitateDescarcareTests(unittest.TestCase):
    """Jakarinos #1147 r1 P1-1: admiterea unei lucrări și decizia / tranziția de descărcare sunt atomice; o lucrare
    nu începe citirea pe modele care se opresc, iar modelele nu se opresc sub o citire admisă."""

    def cald(self, root, ceas):
        g, lock, modele, jurnal = sistem(root, ceas, inactiv_s=600)
        pasi(g, ceas, 1)
        b = g.cere()
        pasi(g, ceas, 3, pas_s=2)
        self.assertTrue(g.asteapta(b, 0))  # lucrarea A e admisă (citește)
        return g, lock, modele, jurnal, b

    def opreste_cu_lucrare_noua(self, g, modele):
        """Pasul de întreținere oprit la barieră în mijlocul opririi; lucrarea B sosește exact atunci."""
        bariera = OprireCuBariera(modele)
        fir, erori = in_fir(g.pas, False)
        self.assertTrue(bariera.in_oprire.wait(10), 'oprirea n-a început')
        b2 = g.cere()
        admis_in_oprire = g.asteapta(b2, 0)
        faza_in_oprire, gata_in_oprire = g.faza, g.modele_gata()
        bariera.continua.set()
        fir.join(10)
        bariera.scoate()
        self.assertFalse(fir.is_alive())
        self.assertEqual(erori, [])
        self.assertFalse(admis_in_oprire)  # înainte de r2: True, cu modelele în curs de oprire
        self.assertEqual((faza_in_oprire, gata_in_oprire), ('descarcare', False))
        return b2

    def reincarca_si_admite(self, g, ceas, modele, b2):
        """B așteaptă (pe alt fir) și e admisă DOAR după reîncărcare, cu ambele modele pornite."""
        vazut = []
        fir, erori = in_fir(lambda: vazut.append((g.asteapta(b2, 60), {k: bool(v) for k, v in modele.running.items()})))
        pasi(g, ceas, 3, pas_s=2)
        fir.join(10)
        self.assertEqual(erori, [])
        self.assertEqual(vazut, [(True, {'lighton': True, 'mineru': True})])
        self.assertEqual(len(modele.started), 4)

    def test_inactivitate_lucrarea_sosita_in_timpul_opririi_asteapta_reincarcarea(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal, b = self.cald(root, ceas)
            g.gata(b)
            ceas.t += 600
            b2 = self.opreste_cu_lucrare_noua(g, modele)
            self.assertEqual((g.faza, g.cerut, g.citesc, lock.path.exists()), ('rece', 1, 0, False))
            self.assertEqual(stari(jurnal, 'descarcat')[-1][2], 'inactiv')
            self.reincarca_si_admite(g, ceas, modele, b2)
            g.gata(b2)

    def test_inactivitate_lucrarea_admisa_inaintea_deciziei_tine_modelele(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal, b = self.cald(root, ceas)
            g.gata(b)
            ceas.t += 600
            b2 = g.cere()
            self.assertTrue(g.asteapta(b2, 0))  # admisă la limita inactivității: câștigă admiterea
            g.pas(False)
            self.assertEqual((g.faza, modele.stopped, lock.path.exists()), ('cald', [], True))
            g.gata(b2)
            ceas.t += 599
            g.pas(False)
            self.assertEqual(g.faza, 'cald')  # inactivitatea se numără de la finalul ultimei lucrări
            ceas.t += 1
            g.pas(False)
            self.assertEqual((g.faza, lock.path.exists()), ('rece', False))

    def test_invalidare_fara_admiteri_noi_si_oprire_doar_dupa_citirea_in_curs(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal, b = self.cald(root, ceas)
            g.invalidate()  # A: gardă în citire; modelele nu mai sunt de încredere
            self.assertEqual((g.faza, g.modele_gata()), ('descarcare', False))
            b2 = g.cere()
            self.assertFalse(g.asteapta(b2, 0))  # înainte de r2: True până la pasul următor de întreținere
            g.pas(False)
            self.assertEqual((modele.stopped, lock.path.exists()), ([], True))  # A n-a anunțat încă gata
            g.gata(b)
            b2 = self.opreste_cu_lucrare_noua(g, modele)  # a doua lucrare sosită în timpul opririi
            self.assertEqual((g.faza, lock.path.exists()), ('rece', False))
            self.assertEqual(stari(jurnal, 'descarcat')[-1][2], 'invalidat')
            self.reincarca_si_admite(g, ceas, modele, b2)

    def test_invalidarea_in_incalzire_nu_descarca_modelele_noi(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas)
            pasi(g, ceas, 1)
            b = g.cere()
            g.pas(False)
            self.assertEqual(g.faza, 'incalzire')
            g.invalidate()  # o lucrare picată înainte de citire, cu modelele abia pornite
            ceas.t += 2
            g.pas(False)
            self.assertTrue(g.asteapta(b, 0))
            g.pas(False)
            self.assertEqual((g.faza, modele.stopped), ('cald', []))

    def test_noaptea_nu_mai_admite_si_asteapta_citirea_admisa(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal, b = self.cald(root, ceas)
            g.pas(True)  # 22:00 cu o citire în curs
            self.assertEqual((g.faza, modele.stopped, lock.path.exists()), ('descarcare', [], True))
            b2 = g.cere()
            self.assertFalse(g.asteapta(b2, 0))
            g.gata(b)
            g.pas(True)
            self.assertEqual((g.faza, sorted(modele.stopped), lock.path.exists()), ('noapte', ['lighton', 'mineru'], False))
            self.assertEqual(stari(jurnal, 'descarcat')[-1][2], 'noapte')
            g.gata(b2)

    def test_biletul_admis_si_inchis_o_singura_data(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal, b = self.cald(root, ceas)
            self.assertTrue(g.asteapta(b, 0))  # a doua confirmare pe același bilet nu dublează socoteala
            self.assertEqual((g.cerut, g.citesc), (1, 1))
            g.gata(b)
            g.gata(b)
            self.assertEqual((g.cerut, g.citesc), (0, 0))
            self.assertFalse(g.asteapta(b, 0))  # biletul închis nu mai e admis

    def test_workerul_inchide_biletul_iar_invalidarea_descarca_dupa_lucrare(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas)
            pasi(g, ceas, 1)
            b = g.cere()
            pasi(g, ceas, 3, pas_s=2)
            g.gata(b)

            def rupt(*a):
                self.assertEqual(g.citesc, 1)  # lucrarea workerului e admisă cât citește
                raise E3Error('garda')
            r = WorkerLaCerereTests.lucreaza(self, g, reader=rupt)
            self.assertEqual(r['eroare'], 'garda')
            self.assertEqual((g.faza, g.cerut, g.citesc), ('descarcare', 0, 0))
            g.pas(False)
            self.assertEqual((g.faza, lock.path.exists()), ('rece', False))
            self.assertEqual(stari(jurnal, 'descarcat')[-1][2], 'invalidat')


class RecuperareVramTests(unittest.TestCase):
    """Jakarinos #1147 r1 P1-2: lacătul se eliberează DOAR după confirmarea eliberării VRAM, inclusiv la recuperarea
    după pornire și după o cădere a serviciului între oprire și confirmare. Memoria simulată rămâne ocupată."""

    def test_pornire_modele_ramase_vram_ocupat_lacatul_ramane_la_reincercare(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas)
            lacat_vechi(lock.path)
            modele.running = {'lighton': [11], 'mineru': [22]}
            modele.blocat = True  # după oprire memoria rămâne la 7.400 MB (prag 2.424)
            g.pas(False)
            self.assertEqual((g.faza, json.loads(lock.path.read_text())['token']), ('eroare', lock.token))
            mem = modele.mem
            pasi(g, ceas, 61)  # reîncercarea: procesele au dispărut deja
            self.assertGreater(modele.mem, mem)  # memoria se citește din nou
            self.assertTrue(lock.path.exists())  # înainte de r2: eliberat fără nicio citire a memoriei
            self.assertEqual(g.faza, 'eroare')
            self.assertEqual(stari(jurnal, 'descarcat'), [])
            modele.blocat = False
            pasi(g, ceas, 120)
            self.assertEqual((g.faza, lock.path.exists()), ('rece', False))
            self.assertEqual(json.loads((root / 'servicii.json').read_text()), {})
            self.assertEqual(stari(jurnal, 'descarcat')[-1][2], 'dupa_eroare')

    def test_cadere_intre_oprire_si_confirmare_obligatia_supravietuieste_repornirii(self):
        with temporary() as root:
            ceas = Ceas()
            modele = Modele(ceas)
            g, lock, _, _ = sistem(root, ceas, modele=modele)
            lacat_vechi(lock.path)
            modele.running = {'lighton': [11], 'mineru': [22]}
            modele.blocat = True
            g.pas(False)
            self.assertTrue(lock.path.exists())
            lacat_vechi(lock.path)  # serviciul cade aici: lacătul lui rămâne, procesul nu mai există
            g2, lock2, _, jurnal2 = sistem(root, ceas, modele=modele)  # repornirea, cu procesele deja oprite
            mem = modele.mem
            g2.pas(False)
            self.assertGreater(modele.mem, mem)
            self.assertEqual((g2.faza, json.loads(lock2.path.read_text())['token']), ('eroare', lock2.token))
            modele.blocat = False
            pasi(g2, ceas, 61)
            self.assertEqual((g2.faza, lock2.path.exists()), ('rece', False))

    def test_cadere_cu_modele_pornite_servicii_json_nevid_cere_confirmarea(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, _ = sistem(root, ceas)
            lacat_vechi(lock.path)
            (root / 'servicii.json').write_text(json.dumps({'lighton': {'pid': 31}, 'mineru': {'pid': 32}}))
            modele.blocat = True  # procesele au murit odată cu serviciul, memoria nu s-a eliberat încă
            g.pas(False)
            self.assertEqual((g.faza, lock.path.exists()), ('eroare', True))

    def test_servicii_json_stricat_cere_confirmarea_iar_starea_curata_nu(self):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, _ = sistem(root, ceas)
            lacat_vechi(lock.path)
            (root / 'servicii.json').write_text('{rupt')
            modele.strain_mb = 6000
            g.pas(False)
            self.assertEqual((g.faza, lock.path.exists()), ('eroare', True))  # necunoscut ≠ liber
        for continut in (None, '{}'):
            with temporary() as root:
                # Calea legitimă: fără urme E3 (lipsă / {}), memoria altcuiva nu ține lacătul (laboratorul nu e blocat).
                ceas = Ceas()
                g, lock, modele, jurnal = sistem(root, ceas)
                lacat_vechi(lock.path)
                if continut is not None:
                    (root / 'servicii.json').write_text(continut)
                modele.strain_mb = 6000
                g.pas(False)
                self.assertEqual((g.faza, lock.path.exists(), modele.mem), ('rece', False, 0))
                self.assertEqual(stari(jurnal, 'descarcat')[-1][2], 'pornire_serviciu')


class CerereFisierTests(unittest.TestCase):
    def test_proaspata_veche_din_viitor_corupta_si_lipsa(self):
        with temporary() as root:
            p = root / 'gpu.lock'
            self.assertFalse(cerere_activa(p))
            CerereGpu(p, token='a', clock=lambda: 1000.0).cere()
            self.assertTrue(cerere_activa(p, acum=1000.0))
            self.assertTrue(cerere_activa(p, acum=1000.0 + VALABILA_S - 1))
            self.assertFalse(cerere_activa(p, acum=1000.0 + VALABILA_S))  # E3 căzut: cererea nu blochează pentru totdeauna
            now = time.time()
            cale_cerere(p).write_text(json.dumps({'detinator': 'e3_serviciu', 'la': now + 3600}))
            self.assertFalse(cerere_activa(p, acum=now))  # ceas din viitor = inactivă
            cale_cerere(p).write_text('{nu e json')
            self.assertTrue(cerere_activa(p, acum=time.time()))  # stricată dar proaspătă: se cedează
            os.utime(cale_cerere(p), (now - 2 * VALABILA_S, now - 2 * VALABILA_S))
            self.assertFalse(cerere_activa(p, acum=time.time()))  # stricată și veche: ignorată

    def test_retrage_doar_cererea_proprie_si_reimprospatarea(self):
        with temporary() as root:
            p, t = root / 'gpu.lock', [1000.0]
            a, b = CerereGpu(p, token='a', clock=lambda: t[0]), CerereGpu(p, token='b', clock=lambda: t[0])
            a.cere()
            b.retrage()
            self.assertTrue(cale_cerere(p).exists())
            t[0] = 1005.0
            a.cere()
            self.assertEqual(json.loads(cale_cerere(p).read_text())['la'], 1000.0)
            t[0] = 1010.0
            a.cere()
            self.assertEqual(json.loads(cale_cerere(p).read_text())['la'], 1010.0)
            a.retrage()
            self.assertFalse(cale_cerere(p).exists())

    def test_cititorul_e3_fara_lacat_ignora_cererea_iar_cererea_veche_nu_opreste_laboratorul(self):
        with temporary() as root:
            lock = root / 'gpu.lock'
            proto = dict(RD.protocol(), gpu_lock=str(lock))
            fake = lambda data, o, cfg, dl: ('text', {'ok': True})
            out, _ = plan_benzi(root / 'a')
            CerereGpu(lock, token='a').cere()
            with patch.dict(RD.FUNCS, {'lighton': fake}), patch('ocr_local.read.protocol', return_value=proto):
                st = RD.run_reader(out, 'lighton', run_id='e3', check_weights=False, check_server=False, lock=False)
                self.assertEqual(st['status'], 'complete')
                CerereGpu(lock, token='a', clock=lambda: time.time() - 2 * VALABILA_S).cere()
                out, _ = plan_benzi(root / 'b')
                st = RD.run_reader(out, 'lighton', run_id='lab', check_weights=False, check_server=False)
                self.assertEqual(st['status'], 'complete')


class OprireCeas:
    """stop_event fals legat de ceasul simulat: wait(t) avansează timpul; bucla se oprește după `durata`
    sau, mai devreme, când `prea_multe()` e adevărat (un mutant fără pauză pică repede, fără 86.400 de încercări)."""
    def __init__(self, ceas, durata, prea_multe=lambda: False):
        self.ceas, self.end, self.oprit, self.prea_multe = ceas, ceas.t + durata, False, prea_multe
    def is_set(self): return self.oprit or self.ceas.t >= self.end or self.prea_multe()
    def set(self): self.oprit = True
    def wait(self, t):
        self.ceas.t += t
        return self.is_set()


def goluri(ts):
    return [b - a for a, b in zip(ts, ts[1:])]


class PlafonReincercariTests(unittest.TestCase):
    """Rafalele din 29.10 / 04.11 (934 / 1.372 de „intern” pe zi): orice reîncercare are pauză crescătoare și plafon."""

    def worker_la_cerere(self, root, ceas, g):
        return Worker(FakeEdge(), None, root=root, reader=citire_fixture, clock=lambda: ACUM, la_cerere=g,
                      monotonic=ceas, rnd=lambda: 0.0)

    @patch('ocr_local.e3_serviciu.noapte', return_value=False)
    def test_incarcarea_care_pica_mereu_cel_mult_32_pe_zi_si_cel_tarziu_la_o_ora(self, _):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas)
            modele.fail_start = True
            g.cere()  # o lucrare așteaptă toată ziua (cazul cel mai rău)
            w = self.worker_la_cerere(root, ceas, g)
            w.stop_event = OprireCeas(ceas, ZI, lambda: len(modele.incercari) > 32)
            w.intretinere_la_cerere()
            n = len(modele.incercari)
            self.assertGreaterEqual(n, 20)  # nu se oprește definitiv: revine singur după cădere
            self.assertLessEqual(n, 32)
            self.assertLessEqual(max(goluri(modele.incercari)), 3600 + 2)
            self.assertGreaterEqual(min(goluri(modele.incercari)), 60)
            linii = stari(jurnal, 'gpu_pauza')
            self.assertLessEqual(len(linii), 10)  # jurnal doar la schimbarea treptei
            self.assertEqual({a[2] for a in linii}, {'vllm_control'})  # cauza reală, nu „intern”
            self.assertFalse(lock.path.exists())  # în pauză lacătul e liber pentru ceilalți

    @patch('ocr_local.e3_serviciu.noapte', return_value=False)
    def test_modele_care_nu_devin_gata_sunt_descarcate_la_plafonul_pornirii(self, _):
        with temporary() as root:
            ceas = Ceas()
            g, lock, modele, jurnal = sistem(root, ceas, pornire_max_s=300)
            modele.health = False
            g.cere()
            w = self.worker_la_cerere(root, ceas, g)
            w.stop_event = OprireCeas(ceas, ZI, lambda: len(modele.incercari) > 32 * 4)
            w.intretinere_la_cerere()
            esecuri = stari(jurnal, 'gpu_pauza')
            self.assertLessEqual(len(esecuri), 10)
            self.assertEqual({a[2] for a in esecuri}, {'pornire_esuata'})
            self.assertLessEqual(len(modele.incercari), 32 * 4)  # ≤ 2 porniri / model / încercare
            self.assertGreaterEqual(len(stari(jurnal, 'descarcat')), 20)

    def test_intretinerea_zi_cazuta_cel_mult_32_pe_zi_si_nu_la_fiecare_secunda(self):
        class Rupt:
            def __init__(s): s.apeluri = []
            def reconcile(s, night):
                s.apeluri.append(ceas.t)
                raise E3Error('vllm_control')
        with temporary() as root, patch('ocr_local.e3_serviciu.noapte', return_value=False):
            ceas, coord = Ceas(), Rupt()
            w = Worker(FakeEdge(), coord, root=root, reader=citire_fixture, clock=lambda: ACUM, monotonic=ceas, rnd=lambda: 0.0)
            w.stop_event = OprireCeas(ceas, ZI, lambda: len(coord.apeluri) > 32)
            w.maintenance()
            jurnal = [json.loads(l) for l in (root / 'jurnal.jsonl').read_text().splitlines()]
        n = len(coord.apeluri)
        self.assertGreaterEqual(n, 20)
        self.assertLessEqual(n, 32)
        self.assertGreaterEqual(min(goluri(coord.apeluri)), 60)  # înainte: la pornire, la fiecare secundă
        self.assertLessEqual(max(goluri(coord.apeluri)), 3600 + 2)
        self.assertLessEqual(len(jurnal), 10)
        self.assertEqual({(l['stare'], l['cod']) for l in jurnal}, {('eroare', 'vllm_control')})
        self.assertEqual(w.state, 'eroare')

    def test_intretinerea_zi_isi_revine_si_noteaza_reluarea_o_data(self):
        class Revine:
            def __init__(s): s.apeluri = []
            def reconcile(s, night):
                s.apeluri.append(ceas.t)
                if len(s.apeluri) <= 3:
                    raise E3Error('vllm_control')
                return 'disponibil'
        with temporary() as root, patch('ocr_local.e3_serviciu.noapte', return_value=False):
            ceas, coord = Ceas(), Revine()
            w = Worker(FakeEdge(), coord, root=root, reader=citire_fixture, clock=lambda: ACUM, monotonic=ceas, rnd=lambda: 0.0)
            w.stop_event = OprireCeas(ceas, 3600)
            w.maintenance()
            jurnal = [(l['stare'], l['cod'], l['secunde']) for l in map(json.loads, (root / 'jurnal.jsonl').read_text().splitlines())]
        self.assertEqual(jurnal, [('eroare', 'vllm_control', 60), ('eroare', 'vllm_control', 120),
                                  ('eroare', 'vllm_control', 240), ('intretinere_reluata', None, None)])
        self.assertEqual(goluri(coord.apeluri)[:3], [60.0, 120.0, 240.0])
        self.assertEqual(set(goluri(coord.apeluri)[3:]), {60.0})  # după revenire: reconcilierea obișnuită, la 60 s
        self.assertEqual(w.state, 'disponibil')


class GpuFals:
    def __init__(self, cald=True, la_asteptare=None):
        self.cald, self.la_asteptare = cald, la_asteptare
        self.cereri = self.terminate = self.invalidari = 0
        self.limite, self.bilete = [], []
    def cere(self):
        self.cereri += 1
        self.bilete.append(object())
        return self.bilete[-1]
    def gata(self, bilet):
        assert bilet is self.bilete[-1]
        self.terminate += 1
    def invalidate(self): self.invalidari += 1
    def asteapta(self, bilet, timeout, stop_event=None):
        assert bilet is self.bilete[-1]
        self.limite.append(timeout)
        if self.la_asteptare:
            self.la_asteptare()
        return self.cald
    def stare(self, night): return 'noapte' if night else 'disponibil'
    def modele_gata(self): return self.cald


class WorkerLaCerereTests(unittest.TestCase):
    def lucreaza(self, gpu, reader=citire_fixture, coordinator=None):
        edge = FakeEdge()
        with temporary() as root, patch('ocr_local.e3_serviciu.noapte', return_value=False):
            w = Worker(edge, coordinator, root=root, reader=reader, clock=lambda: ACUM, la_cerere=gpu,
                       pdf_validator=lambda data: 'mono', render=lambda data: FakeImage(), perspective=lambda im: (im, 'nesigura'))
            if getattr(gpu, 'la_asteptare', None) == 'opreste':
                gpu.la_asteptare = w.stop_event.set
            w.process(request(ACUM))
        livrari = [b for op, b in edge.calls if op == 'rezultat']
        self.assertEqual(len(livrari), 1)
        return livrari[0]

    def test_modele_neincarcate_la_timp_fallback_fara_invalidare_si_fara_cititor(self):
        gpu = GpuFals(cald=False)
        r = self.lucreaza(gpu, reader=lambda *a: self.fail('cititor apelat'))
        self.assertEqual((r['eroare'], r['obiect']), ('model_indisponibil', None))
        self.assertEqual((gpu.cereri, gpu.terminate, gpu.invalidari), (1, 1, 0))
        self.assertEqual(len(gpu.limite), 1)
        self.assertAlmostEqual(gpu.limite[0], 90 - REZERVA_CITIRE_S, delta=0.01)

    def test_rezultatul_citirii_identic_cu_modul_zi(self):
        zi = self.lucreaza(None)
        gpu = GpuFals(cald=True)
        la_cerere = self.lucreaza(gpu)
        self.assertIsNone(zi['eroare'])
        self.assertEqual(json.dumps(zi['obiect'], sort_keys=True), json.dumps(la_cerere['obiect'], sort_keys=True))
        self.assertEqual(zi['sursa']['dezacorduri'], la_cerere['sursa']['dezacorduri'])
        self.assertEqual((gpu.cereri, gpu.terminate, gpu.invalidari), (1, 1, 0))

    def test_garda_si_defectul_descarca_modelele_la_cerere(self):
        for exc in (E3Error('garda'), ValueError('defect')):
            gpu = GpuFals(cald=True)
            def rupt(*a, exc=exc):
                raise exc
            r = self.lucreaza(gpu, reader=rupt)
            self.assertIn(r['eroare'], ('garda', 'intern'))
            self.assertEqual((gpu.invalidari, gpu.terminate), (1, 1))

    def test_oprirea_in_timpul_asteptarii_e_oprit(self):
        gpu = GpuFals(cald=False, la_asteptare='opreste')
        r = self.lucreaza(gpu, reader=lambda *a: self.fail('cititor apelat'))
        self.assertEqual((r['eroare'], gpu.invalidari), ('oprit', 0))

    def test_heartbeat_spune_daca_modelele_sunt_incarcate(self):
        for cald in (True, False):
            edge = FakeEdge()
            with temporary() as root:
                w = Worker(edge, None, root=root, reader=citire_fixture, clock=lambda: ACUM, la_cerere=GpuFals(cald=cald))
                w.state = 'disponibil'
                w.heartbeat()
            hb = [b for op, b in edge.calls if op == 'heartbeat'][0]
            self.assertEqual({m['gata'] for m in hb['modele'].values()}, {cald})
            self.assertEqual((hb['stare'], hb['versiune']), ('disponibil', 'e9-b3-r5-la-cerere'))


class ConfigGpuTests(unittest.TestCase):
    def test_config_gpu(self):
        self.assertEqual(config_gpu({}), ('la_cerere', 600.0))
        self.assertEqual(config_gpu({'gpu_mod': 'zi', 'inactiv_minute': 3}), ('zi', 180.0))
        for rau in ({'gpu_mod': 'mereu'}, {'inactiv_minute': 0}, {'inactiv_minute': 121}, {'inactiv_minute': True},
                    {'inactiv_minute': '10'}, {'inactiv_minute': float('nan')}):
            with self.assertRaises(E3Error):
                config_gpu(rau)


if __name__ == '__main__':
    unittest.main()
