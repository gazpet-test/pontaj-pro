"""Regresii B3 r2; fixture-uri reale, transport fals, fără rețea/GPU/BD."""
import copy
import datetime as dt
import io
import json
import multiprocessing
import os
import socket
import subprocess
import time
import unittest
from unittest.mock import patch

from ocr_local import e3_pdf
from ocr_local.e3_aliniere import compara, aplica_arbitraj
from ocr_local.e3_client import Edge, citeste_secret
from ocr_local.e3_contract import E3Error, validaStructuraE3
from ocr_local.e3_gpu import GpuLock, process_start
from ocr_local.e3_grila import grile
from ocr_local.e3_mapare import mapare, tabele_text, celula_text
from ocr_local.e3_read import citeste_orientat
from ocr_local.e3_serviciu import curata
from test_e3_mapare import real, HERE
import test_e3_worker as worker_fixtures
from test_e3_worker import temporary, FakeEdge, FakeImage, request


def pdf_stall(data, render, conn):
    time.sleep(30)


def pdf_memory_probe(data, render, conn):
    try:
        job = e3_pdf.limite_memorie()
        allocation = bytearray(e3_pdf.MAX_MEMORY * 2)
        conn.send(('unbounded', None))
    except MemoryError:
        conn.send(('bounded', None))
    finally:
        conn.close()


class ParserReviewTests(unittest.TestCase):
    def test_real_lines_preserve_decimal_point_comma_and_rowspan(self):
        aviz = (HERE/'ocr_local_lighton_aviz_comtech_26091505.txt').read_text(encoding='utf-8')
        original = next(line for line in aviz.splitlines() if line.startswith('| 3 |'))
        for line, expected in [(original, '12.50'), (original.replace('12.50', '12,50'), '12,50')]:
            grid = grile(tabele_text(line))[0]
            self.assertEqual(grid[0][5]['text'], expected)
            self.assertEqual(grid[0][6]['text'], '1,404')
        bends = (HERE/'ocr_local_lighton_lista_gurgenler_truck164.txt').read_text(encoding='utf-8')
        line = next(line for line in bends.splitlines() if '⟦rowspan=' in line)
        parsed = tabele_text(line)
        self.assertIn('rowspan="2"', parsed)
        self.assertNotIn('⟦rowspan=', parsed)
        self.assertEqual(celula_text('12,5 ⟦rowspan=2⟧ ⟦colspan=3⟧'),
                         '<td rowspan="2" colspan="3">12,5</td>')
        self.assertEqual(celula_text('12.5'), '<td>12.5</td>')
        for marker in ('⟦rowspan=0⟧', '⟦rowspan=2⟧⟦rowspan=3⟧'):
            with self.assertRaises(E3Error):
                celula_text(marker)

    def test_missing_middle_last_swapped_duplicate_and_renumbered_rows(self):
        for mutation in ('middle', 'last', 'swapped', 'duplicate', 'renumbered'):
            with self.subTest(mutation=mutation):
                obj = real()
                if mutation == 'middle': obj['randuri'].pop(1)
                if mutation == 'last': obj['randuri'].pop()
                if mutation == 'swapped': obj['randuri'][:2] = reversed(obj['randuri'][:2])
                if mutation == 'duplicate': obj['randuri'][1]['nr_crt'] = '1'
                if mutation == 'renumbered':
                    obj['randuri'].pop(1)
                    for i, row in enumerate(obj['randuri'], 1): row['nr_crt'] = str(i)
                with self.assertRaisesRegex(E3Error, 'structura_incerta'):
                    validaStructuraE3(obj, 'aviz_teava')

    def test_printed_totals_length_kg_header_and_row_count(self):
        for location, field, value in [('totaluri_tiparite', 'total_metri', '180'),
                                       ('totaluri_tiparite', 'total_kg', '20,528'),
                                       ('antet', 'total_m', '1'), ('antet', 'total_kg', '2')]:
            obj = real()
            obj[location][field] = value
            with self.assertRaises(E3Error): validaStructuraE3(obj, 'aviz_teava')
        raw = (HERE/'ocr_local_lighton_aviz_comtech_26091505.txt').read_text(encoding='utf-8')
        for count in ('15', '14'):
            source = 'TOTAL POZITII: %s\n' % count + raw
            if count == '15': self.assertEqual(len(mapare(source, 'aviz_teava')['randuri']), 15)
            else:
                with self.assertRaises(E3Error): mapare(source, 'aviz_teava')

    def test_post_arbitration_totals_mismatch_is_structural(self):
        left, right = real(), real()
        right['randuri'][0]['lungime_doc'] = '12.50'
        right['totaluri_tiparite']['total_metri'] = '183.33'
        obj, cells = compara(left, right, 'aviz_teava')
        values = [{'rand': c['rand'], 'camp': c['camp'], 'valoare': c['lighton'], 'sigur': True} for c in cells]
        values[0]['valoare'] = '100'
        with self.assertRaises(E3Error):
            aplica_arbitraj(obj, cells, {'arbitraj': 'ok', 'celule': values}, 'aviz_teava')


class PdfReviewTests(unittest.TestCase):
    def test_render_child_timeout_is_terminated(self):
        before = {p.pid for p in multiprocessing.active_children()}
        with patch.object(e3_pdf, '_pdf_child', pdf_stall):
            started = time.monotonic()
            self.assertEqual(e3_pdf._izolat(b'fixture', True, .2), ('neverificabil', None))
            self.assertLess(time.monotonic() - started, 3)
        self.assertEqual({p.pid for p in multiprocessing.active_children()}, before)

    def test_child_memory_limit_enforced(self):
        with patch.object(e3_pdf, '_pdf_child', pdf_memory_probe):
            self.assertEqual(e3_pdf._izolat(b'fixture', True, 3), ('bounded', None))

    def test_real_render_isolated_pixels_and_timeout(self):
        try:
            import fitz
        except ImportError:
            self.skipTest('PyMuPDF absent')
        with fitz.open() as doc:
            doc.new_page(width=72, height=72)
            data = doc.tobytes()
        # Părintele nu trebuie să mai deschidă PDF-ul; patch-ul nu intră în copilul spawn.
        with patch.object(fitz, 'open', side_effect=AssertionError('PDF opened in parent')):
            kind, result = e3_pdf._izolat(data, True, 3)
        self.assertEqual(kind, 'mono')
        self.assertEqual(result[:2], (150, 150))
        self.assertEqual(len(result[2]), 150 * 150 * 3)
        self.assertEqual(e3_pdf._izolat(data, True, 0), ('neverificabil', None))
        with fitz.open() as doc:
            doc.new_page(width=10000, height=10000)
            oversized = doc.tobytes()
        self.assertEqual(e3_pdf._izolat(oversized, True, 3), ('invalid', None))


class LockReviewTests(unittest.TestCase):
    def test_laboratory_claim_during_publish_is_not_overwritten(self):
        from ocr_local.e3_gpu import save
        with temporary() as root:
            path = root/'gpu.lock'
            lab = {'detinator': 'laborator'}
            def race(target, value):
                save(target, value)
                path.write_text(json.dumps(lab))
            with patch('ocr_local.e3_gpu.save', side_effect=race):
                self.assertFalse(GpuLock(path).claim())
            self.assertEqual(json.loads(path.read_text()), lab)

    def test_atomic_write_interruption_recovers_and_live_owner_survives(self):
        with temporary() as root:
            path = root/'gpu.lock'
            first = GpuLock(path)
            with patch('ocr_local.client.os.replace', side_effect=OSError('crash before rename')):
                with self.assertRaises(OSError): first.claim()
            self.assertFalse(path.exists())
            self.assertTrue(path.with_name('gpu.lock.pending.tmp').exists())
            self.assertTrue(first.claim())
            before = path.read_bytes()
            self.assertFalse(GpuLock(path).claim())
            self.assertEqual(path.read_bytes(), before)
            first.release()

    def test_corrupt_stale_reused_pid_and_same_live_process(self):
        with temporary() as root:
            path = root/'gpu.lock'
            for raw in ('{ "detinator": "e3_', '', '[]'):
                path.write_text(raw)
                lock = GpuLock(path)
                self.assertTrue(lock.claim())
                lock.release()
            lock = GpuLock(path, alive=lambda pid: True, boot=lambda: 0, start=lambda pid: 200)
            old = {'detinator': 'e3_serviciu', 'gazda': socket.gethostname(), 'pid': 123,
                   'pornit_la': 500, 'proces_pornit_la': 100, 'token': 'old'}
            path.write_text(json.dumps(old))
            self.assertTrue(lock.claim())  # PID viu, dar aparține altui proces.
            lock.release()
            old['proces_pornit_la'] = 200
            path.write_text(json.dumps(old))
            self.assertFalse(lock.claim())
            self.assertIsNotNone(process_start(os.getpid()))


class WorkerReviewTests(unittest.TestCase):
    @patch('ocr_local.e3_serviciu.noapte', return_value=False)
    def test_rmtree_failure_releases_worker_and_cleanup_retries(self, _):
        with temporary() as root:
            now = dt.datetime(2026, 10, 23, 8, tzinfo=dt.timezone.utc)
            edge = FakeEdge()
            worker = worker_fixtures.WorkerTests().worker(edge, root, now)
            worker.gpu_state = 'disponibil'
            req = request(now)
            def blocked(path):
                self.assertIsNone(worker.active)
                self.assertEqual(worker.state, 'disponibil')
                raise OSError('file locked')
            with patch('ocr_local.e3_serviciu.shutil.rmtree', side_effect=blocked):
                worker.process(req)
            self.assertIn(req['id'], worker.resturi)
            self.assertTrue((root/'work'/req['id']).exists())
            # Un nou job poate fi procesat; bucla orară reia și directoarele recente.
            worker.process(request(now))
            curata(root/'work', active=worker.active, resturi=worker.resturi)
            self.assertFalse((root/'work'/req['id']).exists())
            self.assertFalse(worker.resturi)
            self.assertIn('cleanup_amanat', (root/'jurnal.jsonl').read_text())

    def test_either_reader_missing_and_partial_rotation_continue_to_180(self):
        for missing in ('lighton', 'mineru'):
            with temporary() as root:
                calls = []
                def reader(name, image, out, timeout):
                    calls.append((name, image.angle))
                    success = image.angle == 180 or (image.angle == 0 and name != missing) or (image.angle == 90 and name == 'lighton')
                    return worker_fixtures.WorkerTests().reader(name, image, out, timeout) if success else 'no table'
                left, right = citeste_orientat(FakeImage(), 'aviz_teava', root, reader, time.monotonic() + 30)
                self.assertEqual((left['rotatie_grade'], right['rotatie_grade']), (180, 180))
                self.assertEqual(set(calls), {(name, angle) for name in ('lighton', 'mineru') for angle in (0, 90, 180)})


class ArbitrationSecretReviewTests(unittest.TestCase):
    @patch('ocr_local.e3_serviciu.noapte', return_value=False)
    def test_worker_sends_only_computed_disagreements(self, _):
        with temporary() as root:
            now = dt.datetime(2026, 10, 23, 8, tzinfo=dt.timezone.utc)
            edge = FakeEdge()
            worker = worker_fixtures.WorkerTests().worker(edge, root, now)
            reader = worker.reader
            def different(name, *args):
                raw = reader(name, *args)
                return raw.replace('SA04751', 'OTHER') if name == 'mineru' else raw
            worker.reader = different
            worker.process(request(now))
            sent = [body['celule'] for op, body in edge.calls if op == 'arbitreaza']
            self.assertEqual(len(sent), 1)
            expected = real(reader='mineru')
            expected['randuri'][0]['sarja'] = 'OTHER'
            self.assertEqual(sent[0], compara(real(), expected, 'aviz_teava')[1])

    def test_only_disagreements_sent_and_response_cannot_change_agreed_cells(self):
        left, right = real(), real()
        right['randuri'][0]['sarja'] = 'different'
        obj, cells = compara(left, right, 'aviz_teava')
        self.assertEqual([(c['rand'], c['camp']) for c in cells], [(1, 'sarja')])
        answer = {'rand': 1, 'camp': 'sarja', 'valoare': 'H', 'sigur': True}
        extra = {'rand': 1, 'camp': 'serie', 'valoare': 'injected', 'sigur': True}
        for values in ([answer, extra], [extra], [answer, answer], []):
            result = aplica_arbitraj(copy.deepcopy(obj), cells, {'arbitraj': 'ok', 'celule': values}, 'aviz_teava')
            self.assertIsNone(result['randuri'][0]['sarja'])
            self.assertEqual(result['randuri'][0]['serie'], left['randuri'][0]['serie'])
        result = aplica_arbitraj(obj, cells, {'arbitraj': 'ok', 'celule': [answer]}, 'aviz_teava')
        self.assertEqual(result['randuri'][0]['sarja'], 'H')

    def test_secret_never_in_argv_url_logs_or_public_errors(self):
        secret = 'd' * 64
        class Transport:
            def __init__(self): self.requests = []
            def open(self, req, **kwargs):
                self.requests.append(req)
                raise RuntimeError(secret + req.full_url)
        transport = Transport()
        edge = Edge(secret, base='https://example.invalid', transport=transport)
        with patch.object(subprocess, 'run', side_effect=AssertionError('argv')), patch('sys.stdout', new_callable=io.StringIO) as stdout, patch('sys.stderr', new_callable=io.StringIO) as stderr:
            for action in (lambda: edge.call('preia'), lambda: edge.download('https://example.invalid/storage/v1/object/sign/ocr-local-cereri/a.pdf?token=signed')):
                with self.assertRaises(E3Error) as cm: action()
                self.assertNotIn(secret, str(cm.exception))
                self.assertTrue(cm.exception.__suppress_context__)
            self.assertEqual(stdout.getvalue() + stderr.getvalue(), '')
        for req in transport.requests:
            self.assertNotIn(secret, req.full_url)
            self.assertNotIn(secret.encode(), req.data or b'')
        self.assertIn(secret, transport.requests[0].headers.values())
        self.assertFalse(transport.requests[1].headers)
        with temporary() as root:
            path = root/'secret.txt'
            path.write_text('invalid')
            with patch.dict(os.environ, {'IZO_OCR_LOCAL_SECRET': secret}):
                with self.assertRaises(E3Error): citeste_secret(path)


if __name__ == '__main__':
    unittest.main()
