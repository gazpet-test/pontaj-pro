import contextlib
import datetime as dt
import hashlib
import io
import json
import os
import pathlib
import socket
import tempfile
import unittest
import uuid
from unittest.mock import patch
from ocr_local.e3_contract import E3Error
from ocr_local.e3_gpu import GpuLock, Coordinator, mutex
from ocr_local.e3_serviciu import Worker, curata, noapte
from ocr_local.e3_client import Edge, citeste_secret
from ocr_local.e3_pdf import clasifica, valideaza_pdf
from ocr_local.e3_read import citeste_orientat, _reader_process

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
        for kind, code in [('multi','multipagina'), ('invalid','pdf_invalid'), ('neverificabil','intern')]:
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
            with self.assertRaises(E3Error): w.process(req)
            self.assertFalse(orphan.exists())
            self.assertFalse(any(op=='arbitreaza' for op,_ in edge.calls))

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
        self.assertEqual(valideaza_pdf(self.pdf(), timeout=0), 'neverificabil')

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


if __name__ == '__main__':
    unittest.main()
