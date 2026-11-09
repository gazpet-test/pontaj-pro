import contextlib
import datetime as dt
import hashlib
import http.client
import io
import json
import os
import pathlib
import re
import socket
import tempfile
import time
import unittest
import urllib.error
import uuid
from unittest.mock import patch
from ocr_local import e3_pdf
from ocr_local.e3_contract import E3Error
from ocr_local.e3_gpu import GpuLock, Coordinator, mutex
from ocr_local.e3_serviciu import ERRORS, Worker, cod_eroare, curata, noapte
from ocr_local.e3_client import Edge, citeste_secret, refuz
from ocr_local.e3_pdf import clasifica, valideaza_pdf
from ocr_local.e3_read import Reader, citeste_orientat, cod_citire, cod_exceptie_cititor, _reader_process

HERE = pathlib.Path(__file__).parent
BASE = HERE.parents[3]


@contextlib.contextmanager
def temporary():
    # Nici măcar fișierele temporare ale testelor nu ies din worktree.
    root = BASE / '.e3-test-work'
    root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root) as tmp:
        yield pathlib.Path(tmp)


class Models:
    protocol = {'readers': {'lighton': {'weights_sha256': 'L'}, 'mineru': {'weights_sha256': 'M'}}}
    baseline = 100
    def __init__(self):
        self.running = {'lighton': [11], 'mineru': [22]}
        self.health, self.stopped, self.started, self.memory = True, [], [], 100
    def processes(self): return self.running
    def verify(self, name): pass
    def healthy(self, name): return self.health
    def memory_mb(self): return self.memory
    def stop(self, name, pids):
        self.stopped.append(name)
        self.running[name] = []
    def start(self, name):
        self.started.append(name)
        pid = 30 + len(self.started)
        self.running[name] = [pid]
        return pid


class GpuTests(unittest.TestCase):
    def old(self, lock, *, pid=99, since=500, owner='e3_serviciu'):
        lock.path.write_text(json.dumps({'detinator': owner, 'pid': pid, 'pornit_la': since,
                                         'gazda': socket.gethostname(), 'token': 'old'}))

    def test_stale_after_kill_and_after_reboot_live_and_lab_lock(self):
        with temporary() as root:
            lock = GpuLock(root / 'gpu.lock', alive=lambda p: False, boot=lambda: 100)
            self.old(lock)
            self.assertTrue(lock.claim())
            lock.release()
            lock = GpuLock(root / 'gpu.lock', alive=lambda p: True, boot=lambda: 1000)
            self.old(lock, since=500)
            self.assertTrue(lock.claim())
            lock.release()
            self.old(lock, since=2000)
            self.assertFalse(lock.claim())
            self.old(lock, owner='laborator')
            before = lock.path.read_bytes()
            self.assertFalse(lock.claim())
            self.assertEqual(before, lock.path.read_bytes())

    def test_os_mutex_excludes_second_service(self):
        with temporary() as root:
            with mutex(root / 'instance'):
                with self.assertRaises(E3Error):
                    with mutex(root / 'instance'):
                        pass

    def test_crash_adopts_healthy_models_matching_pids_and_sha(self):
        with temporary() as root:
            lock = GpuLock(root / 'gpu.lock', alive=lambda p: False, boot=lambda: 0)
            self.old(lock)
            models = Models()
            p = root / 'servicii.json'
            p.write_text(json.dumps({'lighton': {'pid':11,'sha':'L'}, 'mineru':{'pid':22,'sha':'M'}}))
            coordinator = Coordinator(lock, models, p)
            self.assertEqual(coordinator.reconcile(False), 'disponibil')
            self.assertFalse(models.started)
            lock.release()

    def test_wrong_sha_or_health_restarts_in_day(self):
        for health in (False, True):
            with temporary() as root:
                models = Models()
                models.health = health
                lock = GpuLock(root / 'gpu.lock')
                p = root / 'servicii.json'
                p.write_text(json.dumps({'lighton': {'pid':11,'sha':'WRONG'}, 'mineru':{'pid':22,'sha':'M'}}))
                self.assertEqual(Coordinator(lock, models, p).reconcile(False), 'pornire')
                self.assertIn('lighton', models.stopped)
                self.assertIn('lighton', models.started)
                lock.release()

    def test_restart_2205_stops_confirms_vram_and_releases(self):
        with temporary() as root:
            lock, models = GpuLock(root / 'gpu.lock', alive=lambda p: False, boot=lambda: 0), Models()
            self.old(lock)
            models.memory = 2000
            c = Coordinator(lock, models, root / 'servicii.json')
            self.assertEqual(c.reconcile(True), 'eroare')
            self.assertTrue(lock.path.exists())
            self.assertEqual(set(models.stopped), {'lighton', 'mineru'})
            models.memory = 100
            self.assertEqual(c.reconcile(True), 'noapte')
            self.assertFalse(lock.path.exists())

    def test_laboratory_at_0600_waits_five_minutes(self):
        with temporary() as root:
            lock, models, now = GpuLock(root / 'gpu.lock'), Models(), [0]
            self.old(lock, owner='laborator')
            c = Coordinator(lock, models, root / 'servicii.json', clock=lambda: now[0])
            self.assertEqual(c.reconcile(False), 'ocupat')
            lock.path.unlink()
            now[0] = 299
            self.assertEqual(c.reconcile(False), 'ocupat')
            now[0] = 300
            self.assertEqual(c.reconcile(False), 'pornire')
            lock.release()

    def test_bucharest_night_and_dst(self):
        try:
            from zoneinfo import ZoneInfo
            ZoneInfo('Europe/Bucharest')
        except Exception:
            self.skipTest('tzdata absent pe Windows')
        for instant, expected in [('2026-10-23T19:05:00+00:00', True),  # 22:05
                                  ('2026-10-23T03:00:00+00:00', False), # 06:00
                                  ('2026-12-01T04:00:00+00:00', False), # 06:00 iarna
                                  ('2026-12-01T03:59:00+00:00', True)]:
            self.assertEqual(noapte(dt.datetime.fromisoformat(instant)), expected)


class FakeImage:
    def __init__(self, angle=0): self.angle = angle
    def rotate(self, angle, expand=False): return FakeImage((-angle) % 360)


class FakeEdge:
    def __init__(self, data=b'%PDF fake'):
        self.calls, self.data, self.reject = [], data, False
    def call(self, op, **body):
        self.calls.append((op, body))
        if op == 'link':
            if self.reject: raise E3Error('edge_refuz')
            return {'url':'https://example.invalid/signed'}
        if op == 'arbitreaza': return {'arbitraj':'deja_consumat'}
        if op == 'rezultat' and self.reject: raise E3Error('edge_refuz')
        return {}
    def download(self, url): return self.data


def request(now):
    return {'id':str(uuid.uuid4()), 'token':str(uuid.uuid4()), 'sha':hashlib.sha256(b'%PDF fake').hexdigest(),
            'sablon':'aviz_teava', 'termen_local':(now + dt.timedelta(seconds=90)).isoformat()}


class WorkerTests(unittest.TestCase):
    def reader(self, name, image, out, timeout):
        return (HERE / ('ocr_local_%s_aviz_comtech_26091505.txt' % name)).read_text(encoding='utf-8')

    def worker(self, edge, root, now, **kw):
        return Worker(edge, None, root=root, reader=self.reader, clock=lambda: now,
                      pdf_validator=lambda data: 'mono', render=lambda data: FakeImage(),
                      perspective=lambda im: (im, 'nesigura'), **kw)

    def test_rotation_lighton_then_same_mineru(self):
        with temporary() as root:
            calls = []
            def reader(name, image, out, timeout):
                calls.append((name, image.angle))
                return self.reader(name, image, out, timeout) if image.angle == 90 else 'no table'
            import time
            l, m = citeste_orientat(FakeImage(), 'aviz_teava', root, reader, time.monotonic() + 90)
            self.assertEqual(l['rotatie_grade'], 90)
            self.assertEqual(m['rotatie_grade'], 90)
            self.assertEqual(set(calls[:2]), {('lighton',0), ('mineru',0)})
            self.assertEqual(set(calls[2:]), {('lighton',90), ('mineru',90)})

    def test_real_adapter_calls_existing_reader_without_gpu_lock(self):
        class Conn:
            def send(self, value): self.value = value
            def close(self): pass
        with temporary() as root:
            dest = root/'page0001/p0001_b0/lighton'
            dest.mkdir(parents=True)
            (dest/'result.json').write_text('{"ok":true}')
            (dest/'raw.txt').write_text('<table>fixture</table>')
            from ocr_local import read
            conn = Conn()
            with patch.object(read, 'protocol', return_value={'deadline_seconds':180}), patch.object(read, 'run_reader', return_value={'status':'complete'}) as run:
                _reader_process(root, 'lighton', 20, conn)
            self.assertFalse(run.call_args.kwargs['lock'])
            self.assertEqual(conn.value, ('<table>fixture</table>', None))

    @patch('ocr_local.e3_serviciu.noapte', return_value=False)
    def test_success_contract_raw_payload_cleanup_no_content_journal(self, _):
        with temporary() as root:
            now = dt.datetime(2026,10,23,8,tzinfo=dt.timezone.utc)
            edge = FakeEdge()
            w = self.worker(edge, root, now)
            req = request(now)
            w.process(req)
            result = [v for op,v in edge.calls if op == 'rezultat'][0]
            self.assertEqual(result['token'], req['token'])
            self.assertIsNone(result['eroare'])
            self.assertEqual(result['obiect']['randuri'][0]['greutate_kg'], '1,343')
            self.assertEqual(result['obiect']['randuri'][2]['lungime_doc'], '12.50')
            self.assertFalse((root/'work'/req['id']).exists())
            log = (root/'jurnal.jsonl').read_text()
            self.assertNotIn(req['token'], log)
            self.assertNotIn('254CA', log)
            self.assertNotIn('https:', log)

    @patch('ocr_local.e3_serviciu.noapte', return_value=False)
    def test_pdf_error_branch_never_reaches_readers(self, _):
        # E9: verdictul copilului PDF → cod; un verdict necunoscut rămâne intern.
        for kind, code in [('multi','multipagina'), ('invalid','pdf_invalid'), ('neverificabil','pdf_corupt'),
                           ('termen','timeout'), ('mediu','intern'), ('necunoscut','intern')]:
            with temporary() as root:
                now = dt.datetime(2026,10,23,8,tzinfo=dt.timezone.utc)
                edge = FakeEdge()
                w = self.worker(edge, root, now)
                w.validate_pdf = lambda data: kind
                w.reader = lambda *a: self.fail('reader apelat după PDF refuzat')
                w.process(request(now))
                result = edge.calls[-1][1]
                self.assertIsNone(result['obiect'])
                self.assertEqual(result['eroare'], code)

    @patch('ocr_local.e3_serviciu.noapte', return_value=False)
    def test_guard_failure_and_hash_mismatch(self, _):
        for guard in (True, False):
            with temporary() as root:
                now = dt.datetime(2026,10,23,8,tzinfo=dt.timezone.utc)
                edge = FakeEdge()
                w = self.worker(edge, root, now)
                req = request(now)
                def stopped(*a): raise E3Error('garda')
                if guard: w.reader = stopped
                else: req['sha'] = '0'*64
                w.process(req)
                self.assertEqual(edge.calls[-1][1]['eroare'], 'garda' if guard else 'pdf_invalid')

    @patch('ocr_local.e3_serviciu.noapte', return_value=False)
    def test_arbitration_cutoff_49_50_51_and_no_retry(self, _):
        for elapsed in (49, 50, 51):
            with temporary() as root:
                now = dt.datetime(2026,10,23,8,tzinfo=dt.timezone.utc)
                edge = FakeEdge()
                w = self.worker(edge, root, now)
                req = request(now - dt.timedelta(seconds=elapsed))
                def different(name, *a):
                    raw = self.reader(name, *a)
                    return raw.replace('11.96', '12.50').replace('182.79', '183.33') if name == 'mineru' else raw
                w.reader = different
                w.process(req)
                self.assertEqual(sum(op=='arbitreaza' for op,_ in edge.calls), int(elapsed == 49))
                self.assertIsNone(edge.calls[-1][1]['obiect']['randuri'][0]['lungime_doc'])

    @patch('ocr_local.e3_serviciu.noapte', return_value=False)
    def test_restart_cleanup_and_old_token_refused_by_edge(self, _):
        with temporary() as root:
            now = dt.datetime(2026,10,23,8,tzinfo=dt.timezone.utc)
            req = request(now)
            orphan = root/'work'/req['id']
            orphan.mkdir(parents=True)
            (orphan/'raw.txt').write_text('private OCR')
            curata(root/'work', toate=True)
            self.assertFalse(orphan.exists())
            edge = FakeEdge()
            edge.reject = True
            w = self.worker(edge, root, now)
            # E9: livrarea refuzată nu se reîncearcă și nu mai urcă la buclă: rămâne în jurnal, cu id-ul cererii.
            w.process(req)
            self.assertFalse(orphan.exists())
            self.assertFalse(any(op=='arbitreaza' for op,_ in edge.calls))
            self.assertEqual(sum(op=='rezultat' for op,_ in edge.calls), 1)
            linii = [json.loads(l) for l in (root/'jurnal.jsonl').read_text().splitlines()]
            self.assertIn({'id':req['id'], 'stare':'nelivrat', 'cod':'refuzat'},
                          [{k: l[k] for k in ('id','stare','cod')} for l in linii])

    def test_hourly_cleanup_keeps_active_recent_and_unknown_directories(self):
        with temporary() as root:
            stale, active, recent = [root/str(uuid.uuid4()) for _ in range(3)]
            foreign = root/'not-a-request'
            for p in (stale, active, recent, foreign):
                p.mkdir()
                (p/'data.txt').write_text('fixture')
            for p in (stale, active):
                os.utime(p, (100,100))
            curata(root, now=4000, active=active.name)
            self.assertFalse(stale.exists())
            self.assertTrue(active.exists())
            self.assertTrue(recent.exists())
            self.assertTrue(foreign.exists())


class PdfTests(unittest.TestCase):
    def pdf(self, pages=1, encrypt=False, objects=False, text=False):
        try:
            import fitz
        except ImportError:
            self.skipTest('PyMuPDF absent')
        doc = fitz.open()
        for _ in range(pages):
            page = doc.new_page()
            if text: page.insert_text((30,30), '/Type /Page')
        kw = {'deflate':True}
        if objects: kw['use_objstms'] = 1
        if encrypt:
            kw.update(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='owner', user_pw='user')
        data = doc.tobytes(**kw)
        doc.close()
        return data

    def test_mono_multi_encrypted_corrupt_compressed_misleading_stream(self):
        for data, expected in [(self.pdf(),'mono'),(self.pdf(2),'multi'),(self.pdf(encrypt=True),'invalid'),
                               (self.pdf()[:150],'invalid'),(self.pdf(objects=True),'mono'),(self.pdf(text=True),'mono'),
                               (b'garbage','invalid')]:
            self.assertEqual(clasifica(data), expected)

    def test_process_validation_timeout_and_normal(self):
        self.assertEqual(valideaza_pdf(self.pdf(), timeout=3), 'mono')
        self.assertEqual(valideaza_pdf(self.pdf(), timeout=0), 'termen')  # E9: termenul → timeout, nu pdf_corupt

    def test_real_e3_image_to_pdf_when_delivered(self):
        fixture = HERE/'imageToPdf_e3.pdf'
        if not fixture.exists():
            self.skipTest('PDF-ul imageToPdf real nu este în livrare; JPG/OCR nu îl substituie')
        self.assertEqual(valideaza_pdf(fixture.read_bytes()), 'mono')


class ClientTests(unittest.TestCase):
    def test_secret_file_only_and_no_old_fallback(self):
        with temporary() as root:
            p = root/'secret.txt'
            p.write_text('a'*64)
            with patch.dict('os.environ', {'OCR_LOCAL_SECRET':'b'*64, 'IZO_OCR_LOCAL_SECRET':'c'*64}):
                self.assertEqual(citeste_secret(p), 'a'*64)
                p.unlink()
                with self.assertRaises(FileNotFoundError): citeste_secret(p)

    def test_secret_only_in_post_header_download_pinned_to_bucket(self):
        class Transport:
            def __init__(self): self.requests = []
            def open(self, request, **kwargs):
                self.requests.append(request)
                class Response(io.BytesIO):
                    status = 200
                    def __enter__(self): return self
                    def __exit__(self, *args): self.close()
                return Response(b'{}' if request.get_method()=='POST' else b'%PDF fake')
        transport = Transport()
        edge = Edge('a'*64, base='https://example.invalid', transport=transport)
        edge.call('preia', worker_id='test')
        req = transport.requests[-1]
        self.assertIn('a'*64, req.headers.values())
        self.assertNotIn('a'*64, req.full_url)
        self.assertNotIn(b'a'*64, req.data)
        edge.download('https://example.invalid/storage/v1/object/sign/ocr-local-cereri/id.pdf?token=signed')
        self.assertFalse(transport.requests[-1].headers)
        for url in ['https://bad.invalid/evil','https://example.invalid/storage/v1/object/sign/ofertare/id.pdf',
                    'https://example.invalid/storage/v1/object/sign/ocr-local-cereri/%2e%2e/evil']:
            with self.assertRaises(E3Error): edge.download(url)


# --- E9: coduri reale de eroare + backoff la preia -------------------------------------------------------------------

# Lista așteptată, scrisă independent de cod (L25); aceeași ca în supabase/functions/izo-e3-ocr-local/handler_test.ts.
CODURI_E9 = {'structura_incerta', 'tabel_negasit', 'garda', 'prea_multe_dezacorduri', 'limita_randuri', 'pdf_invalid',
             'multipagina', 'intern', 'retea', 'model_indisponibil', 'timeout', 'pdf_corupt', 'oprit'}
ACUM = dt.datetime(2026, 10, 23, 8, tzinfo=dt.timezone.utc)


def citire_fixture(name, image, out, timeout):
    return (HERE / ('ocr_local_%s_aviz_comtech_26091505.txt' % name)).read_text(encoding='utf-8')


def ridica(exc):
    def f(*a, **k):
        raise exc
    return f


class Coord:
    def __init__(self): self.invalidari = 0
    def invalidate(self): self.invalidari += 1


class EdgeScenariu(FakeEdge):
    """FakeEdge cu link / download înlocuibile (excepții de transport, refuzuri cu status)."""
    def __init__(self, link=None, download=None):
        super().__init__()
        self._link, self._download = link, download
    def call(self, op, **body):
        if op == 'link' and self._link:
            self.calls.append((op, body))
            self._link()
        return super().call(op, **body)
    def download(self, url):
        if self._download:
            self._download()
        return super().download(url)


class E9CoduriTests(unittest.TestCase):
    """Câte un caz pe cod: ce ajunge la edge în `rezultat` (exact o livrare) și dacă modelele se repornesc."""

    def lucreaza(self, *, edge=None, req=None, noaptea=False, oprire=False, ceas=None, reader=citire_fixture,
                 validator=None, render=None, perspective=None):
        edge, coord = edge or FakeEdge(), Coord()
        with temporary() as root, patch('ocr_local.e3_serviciu.noapte', return_value=noaptea):
            w = Worker(edge, coord, root=root, reader=reader, clock=ceas or (lambda: ACUM),
                       pdf_validator=validator or (lambda data: 'mono'), render=render or (lambda data: FakeImage()),
                       perspective=perspective or (lambda im: (im, 'nesigura')))
            if oprire:
                w.stop_event.set()
            w.process(req or request(ACUM))
            jurnal = [json.loads(l) for l in (root/'jurnal.jsonl').read_text().splitlines()]
            self.assertFalse(any((root/'work').iterdir()))
        livrari = [b for op, b in edge.calls if op == 'rezultat']
        self.assertEqual(len(livrari), 1)
        self.assertIsNone(livrari[0]['obiect'])
        self.assertIn(livrari[0]['eroare'], CODURI_E9)
        self.assertEqual((jurnal[-1]['stare'], jurnal[-1]['cod']), ('esuata', livrari[0]['eroare']))
        return livrari[0]['eroare'], coord.invalidari, [op for op, _ in edge.calls]

    def test_retea_transport_si_edge_indisponibil_fara_repornirea_modelelor(self):
        for edge in (EdgeScenariu(link=ridica(E3Error('edge_transport'))), EdgeScenariu(link=ridica(refuz(503))),
                     EdgeScenariu(download=ridica(E3Error('retea')))):
            cod, invalidari, ops = self.lucreaza(edge=edge, reader=lambda *a: self.fail('cititor apelat'))
            self.assertEqual((cod, invalidari), ('retea', 0))
            self.assertNotIn('arbitreaza', ops)

    def test_refuz_4xx_la_link_ramane_intern(self):
        cod, invalidari, _ = self.lucreaza(edge=EdgeScenariu(link=ridica(refuz(409))), reader=lambda *a: self.fail('cititor'))
        self.assertEqual((cod, invalidari), ('intern', 1))  # ca până acum: necunoscutul repornește modelele

    def test_model_indisponibil_reporneste_modelele(self):
        cod, invalidari, _ = self.lucreaza(reader=ridica(E3Error('model_indisponibil')))
        self.assertEqual((cod, invalidari), ('model_indisponibil', 1))

    def test_timeout_inainte_in_timpul_si_dupa_citire(self):
        expirata = request(ACUM - dt.timedelta(seconds=200))
        cod, invalidari, ops = self.lucreaza(req=expirata, reader=lambda *a: self.fail('cititor'))
        self.assertEqual((cod, invalidari, ops), ('timeout', 0, ['rezultat']))
        cod, invalidari, _ = self.lucreaza(reader=ridica(E3Error('timeout')))
        self.assertEqual((cod, invalidari), ('timeout', 1))  # termenul cititorului: modelul poate fi încă ocupat
        trecut = [False]
        def lenta(*a):
            trecut[0] = True
            return citire_fixture(*a)
        cod, invalidari, ops = self.lucreaza(reader=lenta, ceas=lambda: ACUM + dt.timedelta(seconds=100 if trecut[0] else 0))
        self.assertEqual((cod, invalidari), ('timeout', 0))  # citirea s-a încheiat; doar termenul local a trecut
        self.assertNotIn('arbitreaza', ops)

    def test_pdf_corupt_la_randare_fara_cititor_si_fara_repornire(self):
        cod, invalidari, _ = self.lucreaza(render=ridica(E3Error('pdf_corupt')), reader=lambda *a: self.fail('cititor'))
        self.assertEqual((cod, invalidari), ('pdf_corupt', 0))

    def test_oprit_noaptea_si_la_oprirea_ceruta(self):
        for kw in ({'noaptea': True}, {'oprire': True}):
            cod, invalidari, ops = self.lucreaza(reader=lambda *a: self.fail('cititor'), **kw)
            self.assertEqual((cod, invalidari, ops), ('oprit', 0, ['rezultat']))

    def test_intern_ramane_pentru_defecte(self):
        cod, invalidari, _ = self.lucreaza(perspective=ridica(ValueError('defect')))
        self.assertEqual((cod, invalidari), ('intern', 1))

    def test_cod_eroare(self):
        for exc, cod in [(E3Error('retea'), 'retea'), (E3Error('edge_transport'), 'retea'), (refuz(503), 'retea'),
                         (refuz(500), 'retea'), (refuz(409), 'intern'), (refuz(401), 'intern'), (refuz(None), 'intern'),
                         (E3Error('edge_refuz'), 'intern'), (E3Error('link_invalid'), 'intern'), (ValueError('x'), 'intern'),
                         (E3Error('timeout'), 'timeout'), (E3Error('oprit'), 'oprit'), (E3Error('pdf_corupt'), 'pdf_corupt'),
                         (E3Error('model_indisponibil'), 'model_indisponibil'), (E3Error('vllm_control'), 'intern')]:
            self.assertEqual(cod_eroare(exc), cod, exc)

    def test_paritate_cu_edge_si_cu_lista_scrisa_independent(self):
        ts = (BASE/'supabase/functions/izo-e3-ocr-local/contract.ts').read_text(encoding='utf-8')
        m = re.search(r"^export const ERORI_LOCALE = \[([^\]]*)\]", ts, re.M)
        self.assertIsNotNone(m)
        edge = re.findall(r"'([a-z_]+)'", m.group(1))
        self.assertEqual(len(edge), len(set(edge)))
        self.assertEqual(set(edge), CODURI_E9)
        self.assertEqual(ERRORS, CODURI_E9)
        for cod in CODURI_E9:
            self.assertRegex(cod, r'^[a-z_]{1,40}$')  # CHECK-ul coloanei eroare (20261108a)


class Oprire:
    """stop_event fals = ceasul injectat: wait(t) înregistrează pauza; după `pasi` așteptări bucla se oprește."""
    def __init__(self, pasi): self.pasi, self.asteptari, self.oprit = pasi, [], False
    def is_set(self): return self.oprit
    def set(self): self.oprit = True
    def wait(self, t):
        self.asteptari.append(t)
        self.oprit = self.oprit or len(self.asteptari) >= self.pasi
        return self.oprit


class EdgePreia:
    """preia după scenariu: x = transport căzut, r = refuz 401, 5 = 503, c = cerere stricată, - = coadă goală."""
    def __init__(self, scenariu): self.scenariu, self.calls = list(scenariu), []
    def call(self, op, **body):
        self.calls.append(op)
        pas = self.scenariu.pop(0) if self.scenariu else '-'
        if pas == 'x': raise E3Error('edge_transport')
        if pas == 'r': raise refuz(401)
        if pas == '5': raise refuz(503)
        return {'cerere': {'id': 'nu-e-uuid', 'token': 't'} if pas == 'c' else None}


class E9PauzaTests(unittest.TestCase):
    TREPTE = [1, 2, 4, 8, 16, 32, 64, 128, 256, 300]

    def bucla(self, scenariu, pasi, rnd=lambda: 0.0, stare='disponibil', noaptea=False):
        with temporary() as root, patch('ocr_local.e3_serviciu.noapte', return_value=noaptea):
            edge = EdgePreia(scenariu)
            w = Worker(edge, None, root=root, reader=citire_fixture, clock=lambda: ACUM, rnd=rnd)
            w.state, w.stop_event = stare, Oprire(pasi)
            w.bucla_preia()
            p = root/'jurnal.jsonl'
            jurnal = [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []
        return edge.calls, w.stop_event.asteptari, [(l['stare'], l['cod'], l['secunde']) for l in jurnal]

    def test_trepte_plafon_resetare_si_jurnal_fara_spam(self):
        calls, asteptari, jurnal = self.bucla('x' * 13 + '--' + 'xxx', 18)
        self.assertEqual(asteptari, self.TREPTE + [300, 300, 300] + [1, 1] + [1, 2, 4])
        self.assertEqual(jurnal, [('pauza', 'retea', t) for t in self.TREPTE] + [('reluat', None, None)]
                         + [('pauza', 'retea', t) for t in (1, 2, 4)])
        self.assertEqual(calls, ['preia'] * 18)

    def test_jitter_mic_si_plafon_strict(self):
        _, asteptari, _ = self.bucla('x' * 12, 12, rnd=lambda: 0.999)
        for treapta, a in zip(self.TREPTE + [300, 300], asteptari):
            self.assertGreaterEqual(a, treapta)
            self.assertLessEqual(a, min(300, treapta * 1.1))
        self.assertEqual(max(asteptari), 300)

    def test_cauza_schimbata_pe_aceeasi_treapta_se_jurnalizeaza_o_data(self):
        _, _, jurnal = self.bucla('x' * 10 + 'rr' + '55', 14)
        self.assertEqual(len(jurnal), 12)
        self.assertEqual(jurnal[-3:], [('pauza', 'retea', 300), ('pauza', 'intern', 300), ('pauza', 'retea', 300)])

    def test_fara_preia_cand_nu_e_disponibil_sau_noaptea(self):
        for kw in ({'stare': 'pornire'}, {'stare': 'eroare'}, {'noaptea': True}):
            calls, asteptari, jurnal = self.bucla('x' * 5, 5, **kw)
            self.assertEqual((calls, asteptari, jurnal), ([], [1] * 5, []))

    def test_cerere_stricata_jurnalizata_cu_cod_fara_pauza(self):
        calls, asteptari, jurnal = self.bucla('c-', 2)
        self.assertEqual((calls, asteptari, jurnal), (['preia', 'preia'], [1, 1], [('eroare', 'intern', None)]))


class E9ClientTests(unittest.TestCase):
    URL = 'https://example.invalid/storage/v1/object/sign/ocr-local-cereri/id.pdf?token=signed'

    class Transport:
        def __init__(self, fapta): self.fapta = fapta
        def open(self, request, **kw): return self.fapta()

    @staticmethod
    def raspuns(status, corp=b'{}', citire=None):
        class R(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): self.close()
            def read(self, *a): return citire() if citire else super().read(*a)
        r = R(corp)
        r.status = status
        return r

    @staticmethod
    def http(code):
        return urllib.error.HTTPError('https://example.invalid/x', code, 'x', {}, None)

    def edge(self, fapta):
        return Edge('a' * 64, base='https://example.invalid', transport=self.Transport(fapta))

    def test_call_pastreaza_statusul_refuzului_si_separa_transportul(self):
        for fapta, cod, status, rezultat in [
                (ridica(self.http(503)), 'edge_refuz', 503, 'retea'),
                (ridica(self.http(409)), 'edge_refuz', 409, 'intern'),
                (ridica(self.http(401)), 'edge_refuz', 401, 'intern'),
                (lambda: self.raspuns(204), 'edge_refuz', 204, 'intern'),
                (ridica(urllib.error.URLError(ConnectionRefusedError())), 'edge_transport', None, 'retea'),
                (ridica(TimeoutError()), 'edge_transport', None, 'retea'),
                (lambda: self.raspuns(200, b'<html>'), 'edge_transport', None, 'retea')]:
            with self.assertRaises(E3Error) as c:
                self.edge(fapta).call('preia', worker_id='test')
            e = c.exception
            self.assertEqual((e.cod, getattr(e, 'status', None), cod_eroare(e)), (cod, status, rezultat))
            self.assertNotIn('a' * 64, repr(e) + str(e.__context__ if not e.__suppress_context__ else ''))

    def test_download_separa_reteaua_de_pdf_invalid(self):
        mare = b'%PDF' + b'0' * 8388608
        for fapta, cod in [
                (ridica(self.http(503)), 'retea'), (ridica(self.http(502)), 'retea'),
                (ridica(self.http(403)), 'pdf_invalid'), (ridica(self.http(404)), 'pdf_invalid'), (ridica(self.http(302)), 'pdf_invalid'),
                (ridica(urllib.error.URLError(ConnectionResetError())), 'retea'), (ridica(TimeoutError()), 'retea'),
                (lambda: self.raspuns(200, citire=ridica(http.client.IncompleteRead(b'%PDF'))), 'retea'),
                (lambda: self.raspuns(200, citire=ridica(ConnectionResetError())), 'retea'),
                (lambda: self.raspuns(206, b'%PDF'), 'pdf_invalid'), (lambda: self.raspuns(200, mare), 'pdf_invalid'),
                (ridica(ValueError('url')), 'intern')]:
            with self.assertRaises(E3Error) as c:
                self.edge(fapta).download(self.URL)
            self.assertEqual(c.exception.cod, cod)
        self.assertEqual(self.edge(lambda: self.raspuns(200, b'%PDF ok')).download(self.URL), b'%PDF ok')


class Capat:
    def __init__(self, poll=False, recv=None): self._poll, self._recv = poll, recv
    def poll(self, t): return self._poll() if callable(self._poll) else self._poll
    def recv(self): return self._recv()
    def close(self): pass


class Proces:
    def __init__(self, start=None): self._start, self.pid, self.terminat = start, None, False
    def start(self):
        if self._start: self._start()
    def is_alive(self): return False
    def terminate(self): self.terminat = True
    def join(self, timeout=None): pass


class Context:
    def __init__(self, parinte, proces): self.parinte, self.proces = parinte, proces
    def Pipe(self, duplex=False): return self.parinte, Capat()
    def Process(self, **kw): return self.proces


class E9CititorTests(unittest.TestCase):
    def test_cod_citire(self):
        for result, cod in [({'ok': False, 'signal': 'deadline', 'error': None}, 'timeout'),
                            ({'ok': False, 'signal': 'deadline', 'error': 'OSError'}, 'timeout'),
                            ({'ok': False, 'signal': None, 'error': 'ConnectionRefusedError'}, 'model_indisponibil'),
                            ({'ok': False, 'signal': None, 'error': 'RuntimeError'}, 'model_indisponibil'),
                            ({'ok': False, 'signal': None, 'error': 'ConnectError:All connection attempts failed'}, 'model_indisponibil'),
                            ({'ok': False, 'signal': None, 'error': None, 'finish_reason': 'length'}, 'intern'),
                            ({'ok': False}, 'intern')]:
            self.assertEqual(cod_citire(result), cod, result)

    def test_exceptie_cititor(self):
        httpx_eroare = type('ConnectError', (Exception,), {'__module__': 'httpx'})
        for exc, cod in [(ConnectionRefusedError(), 'model_indisponibil'), (TimeoutError(), 'model_indisponibil'),
                         (http.client.RemoteDisconnected('x'), 'model_indisponibil'), (httpx_eroare('x'), 'model_indisponibil'),
                         (FileNotFoundError(), 'intern'), (KeyError('x'), 'intern'), (ValueError('x'), 'intern')]:
            self.assertEqual(cod_exceptie_cititor(exc), cod, exc)

    def test_procesul_cititorului_trimite_cauza(self):
        class Conn:
            def send(self, value): self.value = value
            def close(self): pass
        from ocr_local import read
        cazuri = [({'ok': False, 'signal': 'deadline', 'error': None}, {}, 'timeout'),
                  ({'ok': False, 'signal': None, 'error': 'ConnectionRefusedError'}, {}, 'model_indisponibil'),
                  ({'ok': False, 'signal': 'bucla', 'error': None}, {}, 'garda'),
                  (None, {}, 'intern'),
                  (None, {'side_effect': ConnectionRefusedError()}, 'model_indisponibil'),
                  (None, {'side_effect': KeyError('x')}, 'intern')]
        for result, kw, cod in cazuri:
            with temporary() as root:
                if result is not None:
                    dest = root/'page0001/p0001_b0/lighton'
                    dest.mkdir(parents=True)
                    (dest/'result.json').write_text(json.dumps(result))
                conn = Conn()
                run = kw or {'return_value': {'status': 'stopped_no_retry'}}
                with patch.object(read, 'protocol', return_value={'deadline_seconds': 180}), patch.object(read, 'run_reader', **run):
                    _reader_process(root, 'lighton', 20, conn)
                self.assertEqual(conn.value, (None, cod), (result, kw))

    def test_termenul_trecut_inainte_de_citire_e_timeout(self):
        with temporary() as root:
            with self.assertRaises(E3Error) as c:
                citeste_orientat(FakeImage(), 'aviz_teava', root, lambda *a: self.fail('cititor apelat'), 100, clock=lambda: 100)
            self.assertEqual(c.exception.cod, 'timeout')

    def test_cititor_tacut_la_termen_e_timeout_iar_eroarea_copilului_trece_neschimbata(self):
        class Imagine:
            def save(self, buf, format): buf.write(b'png')
        for parinte, cod in [(Capat(poll=False), 'timeout'),
                             (Capat(poll=True, recv=lambda: (None, 'model_indisponibil')), 'model_indisponibil')]:
            with temporary() as root, patch('ocr_local.e3_read.multiprocessing.get_context', return_value=Context(parinte, Proces())):
                with self.assertRaises(E3Error) as c:
                    Reader()('lighton', Imagine(), root/'citire', 20)
                self.assertEqual(c.exception.cod, cod)


class E9PdfTests(unittest.TestCase):
    def test_copil_care_nu_porneste_e_mediu_iar_copil_mort_e_neverificabil(self):
        with patch('ocr_local.e3_pdf.multiprocessing.get_context', return_value=Context(Capat(), Proces(start=ridica(OSError('spawn'))))):
            self.assertEqual(e3_pdf._izolat(b'%PDF', True, 3), ('mediu', None))
        with patch('ocr_local.e3_pdf.multiprocessing.get_context', return_value=Context(Capat(poll=True, recv=ridica(EOFError())), Proces())):
            self.assertEqual(e3_pdf._izolat(b'%PDF', True, 3), ('neverificabil', None))

    def test_copil_oprit_de_termen_in_timpul_transferului_e_termen(self):
        def poll_dupa_termen():
            time.sleep(0.2)  # timerul de 0,01 s a oprit deja copilul
            return True
        proces = Proces()
        with patch('ocr_local.e3_pdf.multiprocessing.get_context', return_value=Context(Capat(poll=poll_dupa_termen, recv=ridica(EOFError())), proces)):
            self.assertEqual(e3_pdf._izolat(b'%PDF', True, 0.01), ('termen', None))
        self.assertTrue(proces.terminat)

    def test_copil_fara_limita_de_memorie_raspunde_mediu(self):
        class Conn:
            def send(self, value): self.value = value
            def close(self): pass
        conn = Conn()
        with patch.object(e3_pdf, 'limite_memorie', side_effect=OSError('pdf_resource_limit')):
            e3_pdf._pdf_child(b'%PDF', True, conn)
        self.assertEqual(conn.value, ('mediu', None))

    def test_randarea_codifica_verdictul(self):
        for kind, cod in [('neverificabil', 'pdf_corupt'), ('termen', 'timeout'), ('mediu', 'intern'), ('invalid', 'pdf_invalid'),
                          ('multi', 'multipagina'), ('altceva', 'intern'), ('mono', 'intern')]:
            with patch.object(e3_pdf, '_izolat', return_value=(kind, None)):
                with self.assertRaises(E3Error) as c:
                    e3_pdf.randeaza(b'%PDF')
                self.assertEqual(c.exception.cod, cod, kind)


if __name__ == '__main__':
    unittest.main()
