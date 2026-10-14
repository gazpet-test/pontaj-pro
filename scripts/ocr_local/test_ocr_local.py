"""Teste CPU, fara endpoint real: python -m unittest ocr_local.test_ocr_local -v (PYTHONPATH=scripts)."""
import hashlib, json, os, pathlib, tempfile, unittest
from unittest.mock import patch
from PIL import Image, ImageDraw
from .geometry import classify, orientation, text_bands
from .guard import Guard
from . import read as RD
from .plan import plan, load_plan
from .compare import compare_band, compare, segments
from .reconcile import reconcile, valid_decision, join_bands

CODEX_OUT = pathlib.Path(os.environ.get('CODEX_WORK', 'C:/Users/Gazpet-Ai/Documents/Codex/2026-10-10/git')) / 'outputs'

def lines_image():
    im = Image.new('RGB', (500, 900), 'white'); d = ImageDraw.Draw(im)
    for y in range(25, 870, 24): d.rectangle((60, y, 430, y + 5), fill='black')
    return im

TABLE_A = ('<table><tr><th>Nr. crt.</th><th>Simbol</th><th>Denumire</th><th>U.M.</th><th>Cantitate</th></tr>'
           '<tr><td>1.</td><td>TSD04A1</td><td>Umplutură compactată</td><td>100mc</td><td>0,056</td></tr>'
           '<tr><td>2.</td><td>W2H04A1</td><td>Strat de nisip în şanț</td><td>mc</td><td>0,80</td></tr></table>')
TABLE_B = TABLE_A.replace('0,056', '0.056').replace('şanț', 'șanț')
BAND = {'id': 'p0001_b0', 'page': 1, 'kind': 'quantity_table', 'image': 'page0001/p0001_b0.png', 'image_sha256': '0' * 64}
OK = {'ok': True}

class Geometrie(unittest.TestCase):
    def test_orientare_nerezolvata_fara_confirmare(self):
        _, o = orientation(lines_image()); self.assertEqual(o['status'], 'unresolved'); self.assertIsNone(o['clockwise'])
    def test_orientare_confirmata(self):
        for a in (0, 90, 180, 270):
            out, o = orientation(lines_image(), a); self.assertEqual(o['clockwise'], a)
    def test_pagina_alba_neclasificata(self): self.assertEqual(classify(Image.new('RGB', (200, 200), 'white'))['candidate'], 'unknown')
    def test_benzi_pas6(self):
        bs, meta = text_bands(lines_image()); self.assertEqual(meta['mode'], 'pas6_white_gaps'); self.assertIn(len(bs), (3, 4))
        for a, b in zip(bs, bs[1:]): self.assertGreater(a['box'][3], b['box'][1])
    def test_garda(self):
        g = Guard(); self.assertIsNone(g('text obisnuit')); self.assertEqual(g('<td></td>' * 600), 'celule_goale_fara_continut')
        g.reset(); self.assertIsNotNone(g(('0123456789' * 20) * 4))
    @unittest.skipUnless((CODEX_OUT / 'pas6_text_20261013/pages.json').exists(), 'fixture Codex pas6 lipsa')
    def test_geometria_salvata_pas6(self):
        for p in json.loads((CODEX_OUT / 'pas6_text_20261013/pages.json').read_text(encoding='utf-8')):
            with Image.open(p['image']) as im: bs, m = text_bands(im)
            if p['bands']: self.assertEqual([b['box'] for b in bs], [b['crop_box'] for b in p['bands']])
            else: self.assertEqual(m['mode'], 'whole_page_fallback')

class Plan(unittest.TestCase):
    def test_text_confirmat_da_benzi_si_refuza_a_doua_rulare(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d); lines_image().save(p / 'i.png')
            doc = plan(p / 'i.png', p / 'out', clockwise=0, kind='continuous_text')
            self.assertEqual(doc['status'], 'plan_complete'); self.assertGreaterEqual(len(doc['bands']), 3)
            self.assertEqual(len(load_plan(p / 'out')['bands']), len(doc['bands']))
            with self.assertRaises(FileExistsError): plan(p / 'i.png', p / 'out', clockwise=0)
    def test_orientare_nerezolvata_blocheaza(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d); lines_image().save(p / 'i.png')
            doc = plan(p / 'i.png', p / 'out', kind='continuous_text')
            self.assertEqual(doc['pages'][0]['route'], 'orientare_nerezolvata'); self.assertFalse(doc['bands'])
    def test_orientare_per_pagina_are_prioritate(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d); lines_image().save(p / 'i.png')
            doc = plan(p / 'i.png', p / 'out', kind='quantity_table', orientations={'1': 0})
            self.assertEqual(doc['pages'][0]['route'], 'ocr'); self.assertEqual(len(doc['bands']), 1)
    def test_formular_exclus(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d); lines_image().save(p / 'i.png')
            doc = plan(p / 'i.png', p / 'out', clockwise=0, kind='grid_form'); self.assertEqual(doc['pages'][0]['route'], 'exclus_grid_form')
    def test_pdf_text_nativ_sarit_si_selectie_pagini(self):
        import fitz
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d); pdf = fitz.open()
            pg = pdf.new_page(); pg.insert_textbox(fitz.Rect(40, 40, 560, 800), 'Text nativ al caietului de sarcini. ' * 30)
            pdf.new_page(); pdf.new_page(); pdf.save(p / 'a.pdf'); pdf.close()
            doc = plan(p / 'a.pdf', p / 'out', pages=[1, 3], clockwise=0)
            self.assertEqual([x['page'] for x in doc['pages']], [1, 3])
            self.assertEqual(doc['pages'][0]['route'], 'text_nativ'); self.assertEqual(doc['pages'][1]['route'], 'exclus_neclasificat')
            with self.assertRaises(ValueError): plan(p / 'a.pdf', p / 'out2', pages=[9])

class Citire(unittest.TestCase):
    def test_endpoint_doar_loopback(self):
        self.assertEqual(RD.endpoint_parts('http://127.0.0.1:8017'), ('127.0.0.1', 8017))
        for s in ('https://127.0.0.1', 'http://localhost:8017', 'http://192.168.1.94:8017', 'http://127.0.0.1@evil', 'http://127.0.0.1/x', 'http://127.0.0.1?x=1'):
            with self.assertRaises(ValueError): RD.endpoint_parts(s)
    def test_redirect_neurmat_fara_reincercare(self):
        cfg = RD.protocol()['readers']['lighton']
        with tempfile.TemporaryDirectory() as d, patch('ocr_local.read.http.client.HTTPConnection') as C:
            C.return_value.getresponse.return_value.status = 302
            raw, r = RD.read_lighton(b'img', pathlib.Path(d), cfg, 180)
            self.assertFalse(r['ok']); self.assertEqual(C.return_value.request.call_count, 1)
            with self.assertRaises(FileExistsError): RD.read_lighton(b'img', pathlib.Path(d), cfg, 180)
    def test_greutati_alt_sha_refuz(self):
        with tempfile.TemporaryDirectory() as d:
            w = pathlib.Path(d) / 'model.safetensors'; w.write_bytes(b'abc')
            self.assertEqual(RD.verify_weights({'weights': str(w), 'weights_sha256': hashlib.sha256(b'abc').hexdigest()}), hashlib.sha256(b'abc').hexdigest())
            with self.assertRaises(RuntimeError): RD.verify_weights({'weights': str(w), 'weights_sha256': '0' * 64})
    def test_gpu_lock(self):
        with tempfile.TemporaryDirectory() as d:
            lock = pathlib.Path(d) / 'gpu.lock'
            with RD.gpu_lock(lock, 'r1'):
                self.assertTrue(lock.exists())
                with self.assertRaises(RuntimeError):
                    with RD.gpu_lock(lock, 'r2'): pass
            self.assertFalse(lock.exists())
            lock.write_text('{"run_id": "altcineva"}')
            with self.assertRaises(RuntimeError):
                with RD.gpu_lock(lock, 'r3'): pass
            self.assertTrue(lock.exists())
    def _plan(self, d):
        p = pathlib.Path(d); lines_image().save(p / 'i.png'); plan(p / 'i.png', p / 'out', clockwise=0, kind='continuous_text'); return p / 'out'
    def test_reluare_idempotenta_si_oprire(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); calls = []
            def fake(data, o, cfg, dl):
                calls.append(o); (o / 'request_started.json').write_text('{}'); return 'text', {'ok': True}
            with patch.dict(RD.FUNCS, {'lighton': fake}):
                st = RD.run_reader(out, 'lighton', run_id='t', check_weights=False, lock=False)
                self.assertEqual(st['status'], 'complete'); n = len(calls)
                st = RD.run_reader(out, 'lighton', run_id='t2', check_weights=False, lock=False)
                self.assertEqual(st['skipped_existing'], n); self.assertEqual(len(calls), n)
    def test_banda_inceputa_neterminata_nu_se_reincearca(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); b = load_plan(out)['bands'][0]
            o = out / 'page0001' / b['id'] / 'mineru'; o.mkdir(parents=True); (o / 'request_started.json').write_text('{}')
            with patch.dict(RD.FUNCS, {'mineru': lambda *a: self.fail('nu trebuia apelat')}):
                st = RD.run_reader(out, 'mineru', run_id='t', check_weights=False, lock=False)
            self.assertEqual(st['status'], 'interrupted_needs_review')
    def test_rezultat_incomplet_opreste(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); calls = []
            def fake(data, o, cfg, dl):
                calls.append(1); (o / 'request_started.json').write_text('{}'); return '', {'ok': False, 'signal': 'deadline'}
            with patch.dict(RD.FUNCS, {'lighton': fake}):
                st = RD.run_reader(out, 'lighton', run_id='t', check_weights=False, lock=False)
            self.assertEqual(st['status'], 'stopped_no_retry'); self.assertEqual(len(calls), 1)

class Comparare(unittest.TestCase):
    def test_separator_pe_cantitate_e_dezacord_marcat(self):
        s, its = compare_band(BAND, TABLE_A, OK, TABLE_B, OK)
        self.assertEqual(len(its), 1); it = its[0]
        self.assertEqual(it['tip'], 'rand_tabel'); self.assertTrue(it['e_cantitate']); self.assertTrue(it['anomalie_separator']); self.assertTrue(it['triplet_diferit'])
        self.assertEqual(it['citire_lighton'].split(' | ')[-1], '0,056'); self.assertEqual(it['citire_mineru'].split(' | ')[-1], '0.056')
    def test_sedila_virgula_nu_e_dezacord(self):
        s, its = compare_band(BAND, 'Conductă Ştefăneşti DN 250', OK, 'Conductă Ștefănești DN 250', OK); self.assertEqual(its, [])
    def test_cifra_diferita_in_text(self):
        s, its = compare_band(BAND, 'lungime 1.250 m pe traseu', OK, 'lungime 1.280 m pe traseu', OK)
        self.assertEqual(len(its), 1); self.assertTrue(its[0]['diferenta_numerica']); self.assertEqual(its[0]['citire_lighton'], '1.250')
    def test_rand_lipsa_are_ancora(self):
        b = TABLE_A.replace('</table>', '<tr><td>3.</td><td>TSD01C1</td><td>Împrăștiat pământ</td><td>mc</td><td>0,80</td></tr></table>')
        s, its = compare_band(BAND, TABLE_A, OK, b, OK)
        miss = [i for i in its if i['tip'] == 'rand_lipsa_lighton']; self.assertEqual(len(miss), 1); self.assertIsNotNone(miss[0]['ancora_lighton'])
    def test_structura_diferita_aplatizeaza(self):
        s, its = compare_band(BAND, TABLE_A, OK, '1. TSD04A1 Umplutură compactată 100mc 0,056', OK); self.assertEqual(s['structura'], 'diferita')
    def test_citire_incompleta_trimite_banda_intreaga(self):
        s, its = compare_band(BAND, TABLE_A, OK, '', {'ok': False}); self.assertEqual(its[0]['tip'], 'banda_intreaga'); self.assertTrue(its[0]['e_cantitate'])
    def test_markdown_si_html_echivalente(self):
        md = '| Nr. crt. | Simbol | Denumire | U.M. | Cantitate |\n|---|---|---|---|---|\n| 1. | TSD04A1 | Umplutură compactată | 100mc | 0,056 |\n| 2. | W2H04A1 | Strat de nisip în şanț | mc | 0,80 |'
        s, its = compare_band(BAND, TABLE_A, OK, md, OK); self.assertEqual(its, [])
        self.assertEqual([k for k, _ in segments(md)], ['table'])

BENCH = pathlib.Path('C:/Users/Public/paw-data/out/ocr_bench_20261014/runs')

class Benchmark(unittest.TestCase):
    @unittest.skipUnless((BENCH / '21d_mineru25_pro_vllm/results/a_098_control300/raw.txt').exists(), 'benchmark 14.10 lipsa')
    def test_a098_singurul_dezacord_pe_cantitate_e_separatorul(self):
        rd = lambda run: (BENCH / run / 'results/a_098_control300/raw.txt').read_text(encoding='utf-8')
        s, its = compare_band(BAND, rd('17_lightonocr2_vllm'), OK, rd('21d_mineru25_pro_vllm'), OK)
        q = [i for i in its if i['e_cantitate']]
        self.assertEqual(len(q), 1); self.assertTrue(q[0]['anomalie_separator'])
        self.assertEqual((q[0]['citire_lighton'].split(' | ')[-1], q[0]['citire_mineru'].split(' | ')[-1]), ('0,056', '0.056'))

class Reconciliere(unittest.TestCase):
    def _run(self, a, b, decizii):
        d = tempfile.mkdtemp(); out = pathlib.Path(d) / 'out'
        Image.new('RGB', (300, 300), 'white').save(pathlib.Path(d) / 'i.png')
        doc = plan(pathlib.Path(d) / 'i.png', out, clockwise=0, kind='quantity_table'); band = doc['bands'][0]
        for reader, raw in (('lighton', a), ('mineru', b)):
            o = out / 'page0001' / band['id'] / reader; o.mkdir(parents=True)
            (o / 'raw.txt').write_text(raw, encoding='utf-8')
            (o / 'result.json').write_text(json.dumps({'ok': True, 'image_sha256': band['image_sha256'], 'raw_sha256': hashlib.sha256(raw.encode()).hexdigest()}))
        _, items = compare(out)
        (out / 'dec.jsonl').write_text('\n'.join(json.dumps(dict(x, id=items[i]['id']) if 'id' not in x else x) for i, x in enumerate(decizii)), encoding='utf-8')
        return reconcile(out, out / 'dec.jsonl'), items, out
    def dec(self, decizie, text=''): return {'decizie': decizie, 'text': text, 'motiv': 'test', 'e_cantitate': True, 'anomalie_separator': True}
    def test_ales_mineru_pe_cantitate(self):
        r, items, out = self._run(TABLE_A, TABLE_B, [self.dec('ales_mineru')])
        pg = r['pages'][0]; self.assertFalse(pg['needs_human']); self.assertIn('| 0.056 |', pg['text']); self.assertEqual(pg['arbitrat_de_claude_cantitati'], 1)
        t = json.loads((out / 'tripleti.jsonl').read_text(encoding='utf-8').splitlines()[0])
        self.assertEqual((t['citire_lighton'].split(' | ')[-1], t['citire_mineru'].split(' | ')[-1], t['decizie']), ('0,056', '0.056', 'ales_mineru'))
    def test_fara_decizie_needs_human(self):
        r, items, out = self._run(TABLE_A, TABLE_B, [])
        self.assertTrue(r['pages'][0]['needs_human']); self.assertIsNone(r['pages'][0]['text'])
    def test_schema_invalida_fail_closed(self):
        bad = dict(self.dec('ales_mineru'), motiv='x' * 201)
        r, items, out = self._run(TABLE_A, TABLE_B, [bad]); self.assertTrue(r['pages'][0]['needs_human']); self.assertEqual(r['summary']['decisions_invalid'], 1)
    def test_text_propus_in_text(self):
        r, items, out = self._run('lungime 1.250 m pe traseu', 'lungime 1.280 m pe traseu', [self.dec('text_propus', '1.258')])
        self.assertEqual(r['pages'][0]['text'], 'lungime 1.258 m pe traseu')
    def test_validare_schema(self):
        self.assertTrue(valid_decision(self.dec('needs_human'))); self.assertFalse(valid_decision(self.dec('needs_human', 'x')))
        self.assertFalse(valid_decision(self.dec('text_propus', ' '))); self.assertFalse(valid_decision(dict(self.dec('ales_lighton'), extra=1)))
        self.assertFalse(valid_decision(dict(self.dec('ales_lighton'), e_cantitate='da')))
    def test_cusatura_benzi(self):
        sig = []; out = join_bands(['unu doi trei patru cinci', 'trei patru cinci sase sapte'], sig)
        self.assertEqual(out, 'unu doi trei patru cinci\nsase sapte'); self.assertEqual(sig[0]['type'], 'cusatura_suprapunere_taiata')
        sig = []; join_bands(['unu doi', 'trei patru'], sig); self.assertEqual(sig[0]['type'], 'cusatura_fara_suprapunere')

if __name__ == '__main__': unittest.main()
