"""Teste CPU, fara endpoint real: python -m unittest ocr_local.test_ocr_local -v (PYTHONPATH=scripts)."""
import hashlib, json, os, pathlib, re, shutil, tempfile, time, unittest
from unittest.mock import patch
from PIL import Image, ImageDraw
from .geometry import classify, orientation, text_bands
from .guard import Guard, view, IMG_PIPELINE
import importlib.util
from .guard_legacy import repetition_reason, repeated_table_row
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
POLICY = {'modele_admise': ['claude-sonnet-5'], 'prompt_versiuni_admise': ['t1']}
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

GARDA_FIX = pathlib.Path(__file__).parent / 'fixtures_garda'
GARDA_SHA = {'d772_p0255_b0_lighton.txt': 'fa5ac788a7e422e1090fb6ac7b97b610697e1d886ac0050aebc648376bc66e15',
             'bucla_text_ovis_p85.txt': 'd80209522e0e79a941469f8f254e44444b5d497d308559acd467d54846251d3e',
             'bucla_tabel_ovis_td31.txt': '86119174e96e6bf7cf7bc7694d7a1cb4d62c02749088081f9373907daf188523',
             'd772_p0342_b0_mineru_base64.txt': '117c37923582229f772532eedd79f47f23d152ed9ce462c9647e608031ae0973',
             'bucla_d1247_p0963_b0_mineru.txt': 'db904c56bce405321fd91a4da5d58564ace02dbcb95451c4cba32ab61c857512'}
def garda_fix(nume):
    b = (GARDA_FIX / nume).read_bytes(); assert hashlib.sha256(b).hexdigest() == GARDA_SHA[nume], nume
    return b.decode('utf-8')
def jpeg_b64(w=220, h=220, seed=7):
    """JPEG real (zgomot -> ~40 KB base64, fara blocuri de 200 repetate, ~65 caractere distincte), ca decupajele MinerU."""
    import base64, io, random
    im = Image.frombytes('RGB', (w, h), random.Random(seed).randbytes(w * h * 3)); b = io.BytesIO(); im.save(b, format='JPEG', quality=95)
    return base64.b64encode(b.getvalue()).decode('ascii')
def garda_flux(text, pas=16):
    """Garda ca la citire: textul creste pe bucati; intoarce (motiv, detaliu, caractere la oprire)."""
    g = Guard()
    for n in range(pas, len(text) + pas, pas):
        r = g(text[:n])
        if r: return r, (g.event or {}).get('detail'), min(n, len(text))
    return None, None, len(text)

class GardaLinii(unittest.TestCase):
    """Regula veche „linie lunga repetata” (alarma falsa d772 p0255_b0, r1): celulele <td> lungi conteaza doar de 4 ori LA RAND;
    celelalte linii lungi raman pe regula veche (de 4 ori oriunde)."""
    def test_tabel_real_d772_p0255_trece(self):
        # tabel corect: aceeasi celula <td>1C–T200–S1<br>...</td> de 4 ori, nu la rand -> fara oprire
        self.assertEqual(garda_flux(garda_fix('d772_p0255_b0_lighton.txt'))[0], None)
    def test_bucla_reala_text_ramane_oprita(self):
        # bucla reala Ovis (antet de pagina + <think> repetat): originalul e oprit exact ca inainte (acelasi motiv, acelasi punct)
        t = garda_fix('bucla_text_ovis_p85.txt'); r, d, n = garda_flux(t)
        self.assertEqual((r, d, n), ('bucla_previous_guard', 'Repeated long line (4 times)', len(t)))  # identic cu regula veche
    def test_bucla_reala_tabel_ramane_oprita(self):
        self.assertIsNotNone(garda_flux(garda_fix('bucla_tabel_ovis_td31.txt'))[0])
    def test_bucle_cu_spatiere_variabila_oprite(self):
        # cazurile Jakarinos r1: indentare crescatoare -> blocul de 200 nu se repeta identic; regula liniilor le prinde
        cel = '<td>1C–T200–S1<br>2TP–T200–S1–LE3<br>3A–T200–S1–LE2</td>'
        self.assertIsNotNone(garda_flux('\n'.join(' ' * i + cel for i in range(20)))[0])
        a = 'Conducta de transport gaze naturale Dorohoi – Darabani, tronson 1, km 12'
        b = 'Traversare drum judetean DJ298 cu tub de protectie si grup anozi de zinc'
        self.assertIsNotNone(garda_flux('\n'.join(' ' * i + (a if i % 2 else b) for i in range(40)))[0])
        # Jakarinos r2: acelasi rand intreg (celula lunga + celula scurta), indentare crescatoare
        rows = ['<table>'] + [' ' * i + x for i in range(20) for x in ('<tr>', cel, '<td>17 – T200</td>', '</tr>')] + ['</table>']
        self.assertEqual(garda_flux('\n'.join(rows)), ('bucla_previous_guard', 'Repeated table row (4 times in a row)', garda_flux('\n'.join(rows))[2]))
        # Jakarinos r3: (a) </tr> pe aceeasi linie cu ultima celula; (b) celule goale la capetele randului (vederea filtrata
        # le comaseaza peste granitele de rand) -> regula randului lucreaza pe textul brut, cu delimitatori oriunde pe linie
        a_ = ['<table>'] + [' ' * i + x for i in range(12) for x in ('<tr>', cel, '<td>17 – T200</td></tr>')] + ['</table>']
        b_ = ['<table>'] + [' ' * i + x for i in range(12) for x in ('<tr>', '<td></td>', cel, '<td>17 – T200</td>', '<td></td>', '</tr>')] + ['</table>']
        for t in (a_, b_):
            for pas in (1, 7, 16, 64, 256):
                self.assertEqual(garda_flux('\n'.join(t), pas)[:2], ('bucla_previous_guard', 'Repeated table row (4 times in a row)'))
        # randuri goale identice (fara continut) nu sunt bucla pe aceasta regula
        self.assertIsNone(repeated_table_row('\n'.join(['<tr>', '<td></td>', '<td>-</td>', '</tr>'] * 6)))
        self.assertIsNone(repeated_table_row(garda_fix('d772_p0255_b0_lighton.txt')))
        # Copilot r4: acelasi subtotal in 4 tabele separate (sau separat de text) nu e „la rand”
        sub = '<tr><td>Total articol</td><td>sp.mat 0,00</td><td>sp.man 0,00</td></tr>'
        self.assertIsNone(repeated_table_row('\n'.join('<table>\n%s\n</table>\nArticolul %d' % (sub, i) for i in range(4))))
        self.assertIsNone(repeated_table_row('<table>' + ''.join('<tbody>%s</tbody>\ntext intre\n' % sub for _ in range(4)) + '</table>'))
        self.assertIsNotNone(repeated_table_row('<table><thead>' + sub + '</thead><tbody>' + sub * 3 + '</tbody></table>'))  # acelasi tabel
    def test_decupaj_mineru_inregistrat_nu_e_bucla(self):
        # r1 d772 p0342 (si p0382/p0384, d1247 p3): MinerU pune decupajul JPEG ca <img src="data:image/jpeg;base64,..."/> -> 34 KB cu
        # ~65 caractere distincte; v4 suna pe unique_chars. v5: scutit DOAR payload-ul inregistrat la codificare (provenienta).
        t = garda_fix('d772_p0342_b0_mineru_base64.txt')
        self.assertEqual(Guard()(t), 'bucla_unique_chars_lt100_after3000tokens')  # fara inregistrare: ca inainte
        p = IMG_PIPELINE.search(t)[1]  # payload-ul pe care pipeline-ul l-a codificat pentru aceasta banda
        g = Guard([p]); self.assertIsNone(g(t)); self.assertEqual(view(t, [p])[1]['pipeline_images_stripped'], 1)
    def test_scutirea_cere_inregistrarea(self):
        b = jpeg_b64(); img = '<img src="data:image/jpeg;base64,%s"/>' % b
        self.assertEqual(Guard()(img), 'bucla_unique_chars_lt100_after3000tokens')  # LightOn / neinregistrat: nimic scutit
        self.assertIsNone(Guard([b])(img))
        # Jakarinos r1 P1 / r2 P1: sir generat cu antet de imagine (QUJD..., JPEG valid + ABC*4000 dupa EOI / in COM) -> neinregistrat
        import base64, io
        mic = io.BytesIO(); Image.new('RGB', (16, 16)).save(mic, format='JPEG'); mic = mic.getvalue()
        com = mic[:2] + b'\xff\xfe' + (2 + 12000).to_bytes(2, 'big') + b'ABC' * 4000 + mic[2:]
        for x in ('QUJD' * 3000, base64.b64encode(mic + b'ABC' * 4000).decode(), base64.b64encode(com).decode()):
            t = '<img src="data:image/jpeg;base64,%s"/>' % x
            self.assertEqual(Guard([b])(t), 'bucla_repeated200_ge4', x[:20])
        # bucla de tokeni de imagine: biblioteca pune acelasi data-URI la fiecare aparitie; e scutit de cate ori a fost codificat
        self.assertIsNotNone(Guard([b])(img * 2))  # copia in plus ramane vazuta
        self.assertIsNone(Guard([b, b])(img + '\n' + img))
        # acelasi payload inregistrat, dar in alta forma decat cea a bibliotecii (data-src, alt escapat, text simplu, png) -> vazut
        for t in ('<img data-src="data:image/jpeg;base64,%s"/>' % b, '<img alt="src=&quot;data:image/jpeg;base64,%s&quot;"/>' % b,
                  'Exemplu src="data:image/jpeg;base64,%s"' % b, '<img src="data:image/png;base64,%s"/>' % b, b):
            self.assertEqual(Guard([b])(t), 'bucla_unique_chars_lt100_after3000tokens', t[:40])
    def test_bucla_dupa_imagine_ramane_oprita(self):
        # decupaj inregistrat scutit, urmat de bucla reala in aceeasi citire: bucla e prinsa
        b = jpeg_b64(); t = '<img src="data:image/jpeg;base64,%s"/>\n<td>' % b + ' - ' * 2000 + '</td>'
        self.assertEqual(Guard([b])(t), 'bucla_repeated200_ge4')
        # bucla reala r1 d1247 p0963 (MinerU, „- - -” intr-o celula) ramane oprita
        self.assertEqual(Guard()(garda_fix('bucla_d1247_p0963_b0_mineru.txt')), 'bucla_repeated200_ge4')
    @unittest.skipUnless(importlib.util.find_spec('mineru_vl_utils'), 'mineru_vl_utils lipsa')
    def test_inregistrarea_pe_biblioteca_reala(self):
        # biblioteca instalata: mask_and_encode_table_image (numele cautat in mineru_client) -> token_map -> replace_table_image_tokens;
        # infasurarea noteaza exact data-URI-ul pus in text, doar in firul cu inregistrarea pornita
        import mineru_vl_utils.mineru_client as MC
        from mineru_vl_utils.structs import ContentBlock
        from mineru_vl_utils.post_process.table_image_processor import replace_table_image_tokens
        self.assertTrue(hasattr(MC, 'mask_and_encode_table_image'))
        f = RD._inregistreaza_decupaje(getattr(MC.mask_and_encode_table_image, '__wrapped__', MC.mask_and_encode_table_image))
        pag = Image.frombytes('RGB', (400, 400), __import__('random').Random(3).randbytes(400 * 400 * 3))
        tab = ContentBlock('table', [0.05, 0.05, 0.95, 0.95], angle=0); ima = ContentBlock('image', [0.2, 0.2, 0.6, 0.6], angle=0)
        RD._DECUPAJE.uris = []
        try: _, tm = f(pag, tab, [(1, ima)], pag.crop((20, 20, 380, 380))); uris = list(RD._DECUPAJE.uris)
        finally: RD._DECUPAJE.uris = None
        self.assertEqual(uris, list(tm.values())); self.assertEqual(len(uris), 1)
        (tok,) = tm; text = replace_table_image_tokens('<table><tr><td>%s</td><td>DN 400</td></tr></table>' % tok, tm)
        self.assertIsNone(Guard(RD.decupaje_garda(uris))(text))
        self.assertEqual(Guard()(text), 'bucla_unique_chars_lt100_after3000tokens')
        f(pag, tab, [(1, ima)], pag.crop((20, 20, 380, 380)))  # fara inregistrare pornita: nu scrie nicaieri
        self.assertIsNone(getattr(RD._DECUPAJE, 'uris', None))
    @unittest.skipUnless(importlib.util.find_spec('mineru_vl_utils'), 'mineru_vl_utils lipsa')
    def test_read_mineru_inregistreaza_per_citire(self):
        # Jakarinos r3 P2: legarea completa prin read_mineru (patch instalat de read_mineru, colectare in work(), garda), cu un client
        # simulat care face ce face two_step_extract (prepare_for_extract -> numele global mask_and_encode_table_image din mineru_client,
        # apoi replace_table_image_tokens); doua citiri concurente pe pagini diferite -> fiecare isi scuteste doar decupajul ei
        import io, random, threading
        import mineru_vl_utils.mineru_client as MC
        from mineru_vl_utils.structs import ContentBlock
        from mineru_vl_utils.post_process.table_image_processor import replace_table_image_tokens
        porniti = threading.Barrier(2)
        class Client:
            def two_step_extract(self, img):
                tab = ContentBlock('table', [0.05, 0.05, 0.95, 0.95], angle=0); ima = ContentBlock('image', [0.2, 0.2, 0.6, 0.6], angle=0)
                w, h = img.size; _, tm = MC.mask_and_encode_table_image(img, tab, [(1, ima)], img.crop((int(.05 * w), int(.05 * h), int(.95 * w), int(.95 * h))))
                porniti.wait(5)  # ambele citiri au codificat inainte sa le citeasca vreuna
                (tok,) = tm
                return [{'type': 'table', 'bbox': tab.bbox, 'content': replace_table_image_tokens('<table><tr><td>%s</td><td>DN 400</td></tr></table>' % tok, tm)}]
        vechi = RD._MINERU.get('client'); RD._MINERU['client'] = Client(); rez = {}
        try:
            def citeste(i, d):
                b = io.BytesIO(); Image.frombytes('RGB', (400, 400), random.Random(i).randbytes(400 * 400 * 3)).save(b, format='PNG')
                rez[i] = RD.read_mineru(b.getvalue(), pathlib.Path(d), {'endpoint': 'http://127.0.0.1:1', 'served_model_name': 'x'}, 30)
            with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
                fire = [threading.Thread(target=citeste, args=(i, d)) for i, d in ((1, d1), (2, d2))]
                for t in fire: t.start()
                for t in fire: t.join(30)
        finally:
            if vechi is None: RD._MINERU.pop('client', None)
            else: RD._MINERU['client'] = vechi
        self.assertTrue(hasattr(MC.mask_and_encode_table_image, '__wrapped__'))
        p = {}
        for i in (1, 2):
            raw, r = rez[i]; self.assertEqual((r['signal'], r['decupaje_pipeline'], r['ok']), (None, 1, True), r)
            p[i] = IMG_PIPELINE.search(raw)[1]; self.assertEqual(Guard()(raw), 'bucla_unique_chars_lt100_after3000tokens')
        self.assertNotEqual(p[1], p[2])
        self.assertIsNotNone(Guard([p[2]])(rez[1][0]))  # decupajul altei citiri nu scuteste
    def test_regula_linii(self):
        lin = 'Conducta de transport gaze naturale Dorohoi – Darabani, tronson 1'
        self.assertEqual(repetition_reason('\n'.join([lin, 'alt rand', lin, 'alt rand', lin, 'alt rand', lin])), 'Repeated long line (4 times)')
        self.assertIsNone(repetition_reason('\n'.join([lin] * 3)))
        rand = '<tr><td>1C–T200–S1</td><td>Traversare DE</td><td>12 + 465</td></tr>'
        self.assertIsNotNone(repetition_reason('\n'.join([rand] * 4)))  # rand intreg pe o linie -> regula veche
        cel = '      <td>1C–T200–S1<br>2TP–T200–S1–LE3<br>3A–T200–S1–LE2</td>'
        self.assertEqual(repetition_reason('\n\n'.join([cel] * 4)), 'Repeated table cell line (4 times in a row)')  # la rand, golurile nu rup
        self.assertIsNone(repetition_reason('\n'.join([cel] * 3)))
        self.assertIsNone(repetition_reason('\n'.join([cel, '<td>17 – T200</td>'] * 6)))  # celula repetata, dar nu la rand


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
            doc = plan(p / 'i.png', p / 'out', clockwise=0, kind='grid_form')
            # rutarea v2: pixelii (sau kind) nu mai exclud; pagina se citeste ca banda intreaga quantity_table, cu semnal
            pg = doc['pages'][0]; self.assertEqual(pg['route'], 'ocr'); self.assertEqual(pg['routing_category'], 'quantity_table')
            self.assertEqual([s['candidate'] for s in pg['signals'] if s['type'] == 'clasificare_incerta'], ['grid_form'])
            self.assertEqual(len(doc['bands']), 1); self.assertEqual(doc['bands'][0]['kind'], 'quantity_table')
            self.assertEqual(doc['versions']['routing'], 'v2-fara-excludere-pixeli')
    def test_plansa_si_neclasificat_citite(self):
        for kind in ('drawing', 'unknown'):
            with tempfile.TemporaryDirectory() as d:
                p = pathlib.Path(d); lines_image().save(p / 'i.png')
                doc = plan(p / 'i.png', p / 'out', clockwise=0, kind=kind)
                self.assertEqual(doc['pages'][0]['route'], 'ocr'); self.assertEqual(doc['bands'][0]['kind'], 'quantity_table')
                self.assertIn({'type': 'clasificare_incerta', 'candidate': kind},
                              [{k: s[k] for k in ('type', 'candidate')} for s in doc['pages'][0]['signals'] if s['type'] == 'clasificare_incerta'])
    def test_orientare_nerezolvata_ramane_exclusa_si_cu_kind_incert(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d); lines_image().save(p / 'i.png')
            doc = plan(p / 'i.png', p / 'out', kind='drawing')
            self.assertEqual(doc['pages'][0]['route'], 'orientare_nerezolvata'); self.assertFalse(doc['bands'])
    def test_pdf_text_nativ_sarit_si_selectie_pagini(self):
        import fitz
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d); pdf = fitz.open()
            pg = pdf.new_page(); pg.insert_textbox(fitz.Rect(40, 40, 560, 800), 'Text nativ al caietului de sarcini. ' * 30)
            pdf.new_page(); pdf.new_page(); pdf.save(p / 'a.pdf'); pdf.close()
            doc = plan(p / 'a.pdf', p / 'out', pages=[1, 3], clockwise=0)
            self.assertEqual([x['page'] for x in doc['pages']], [1, 3])
            # textul nativ e doar semnal: pagina NU ocoleste dubla citire
            self.assertIn('text_nativ_prezent', [s['type'] for s in doc['pages'][0]['signals']]); self.assertNotEqual(doc['pages'][0]['route'], 'text_nativ')
            self.assertEqual(doc['pages'][1]['route'], 'exclus_pagina_alba')
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
            with RD.gpu_lock(lock, 'r1'):
                lock.write_text('{"run_id": "r1", "token": "altul"}')  # inlocuit de altcineva cu acelasi run_id
            self.assertTrue(lock.exists()); lock.unlink()
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
                st = RD.run_reader(out, 'lighton', run_id='t', check_weights=False, check_server=False, lock=False)
                self.assertEqual(st['status'], 'complete'); n = len(calls)
                st = RD.run_reader(out, 'lighton', run_id='t2', check_weights=False, check_server=False, lock=False)
                self.assertEqual(st['skipped_existing'], n); self.assertEqual(len(calls), n)
    def test_banda_inceputa_neterminata_nu_se_reincearca(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); b = load_plan(out)['bands'][0]
            o = out / 'page0001' / b['id'] / 'mineru'; o.mkdir(parents=True); (o / 'request_started.json').write_text('{}')
            with patch.dict(RD.FUNCS, {'mineru': lambda *a: self.fail('nu trebuia apelat')}):
                st = RD.run_reader(out, 'mineru', run_id='t', check_weights=False, check_server=False, lock=False)
            self.assertEqual(st['status'], 'interrupted_needs_review')
    def test_rezultat_existent_incompatibil_nu_se_refoloseste(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); b = load_plan(out)['bands'][0]
            o = out / 'page0001' / b['id'] / 'lighton'; o.mkdir(parents=True); (o / 'raw.txt').write_text('x')
            (o / 'result.json').write_text(json.dumps({'ok': True, 'reader': 'lighton', 'protocol': 'alt-protocol', 'weights_sha256': None,
                                                       'image_sha256': b['image_sha256'], 'raw_sha256': hashlib.sha256(b'x').hexdigest()}))
            with patch.dict(RD.FUNCS, {'lighton': lambda *a: self.fail('nu trebuia apelat')}):
                st = RD.run_reader(out, 'lighton', run_id='t', check_weights=False, check_server=False, lock=False)
            self.assertEqual(st['status'], 'interrupted_needs_review')
    def test_termen_depasit_pastreaza_gpu_lock(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); lock = pathlib.Path(d) / 'gpu.lock'
            def fake(data, o, cfg, dl): (o / 'request_started.json').write_text('{}'); return '', {'ok': False, 'signal': 'deadline'}
            with patch.dict(RD.FUNCS, {'mineru': fake}), patch('ocr_local.read.protocol', return_value=dict(RD.protocol(), gpu_lock=str(lock))):
                st = RD.run_reader(out, 'mineru', run_id='t', check_weights=False, check_server=False)
            self.assertTrue(st['gpu_lock_pastrat']); self.assertTrue(lock.exists()); self.assertIn('pastrat', lock.read_text())
    def test_server_cu_alt_model_refuzat(self):
        cfg = RD.protocol()['readers']['lighton']
        with patch('ocr_local.read.http.client.HTTPConnection') as C:
            C.return_value.getresponse.return_value.status = 200
            C.return_value.getresponse.return_value.read.return_value = json.dumps({'data': [{'id': 'LightOnOCR2', 'root': '/alt/folder'}]}).encode()
            with self.assertRaises(RuntimeError): RD.verify_server(cfg)
            C.return_value.getresponse.return_value.read.return_value = json.dumps({'data': [{'id': 'LightOnOCR2', 'root': cfg['served_root']}]}).encode()
            self.assertTrue(RD.verify_server(cfg))
    def test_plan_cu_cale_falsificata_refuzat(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); doc = json.loads((out / 'plan.json').read_text(encoding='utf-8'))
            doc['bands'][0]['image'] = '../evil.png'; (out / 'plan.json').write_text(json.dumps(doc))
            with self.assertRaises(ValueError): load_plan(out)
    def test_eroare_de_transport_pastreaza_gpu_lock(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); lock = pathlib.Path(d) / 'gpu.lock'
            def fake(data, o, cfg, dl): (o / 'request_started.json').write_text('{}'); return '', {'ok': False, 'signal': None, 'error': 'ReadTimeout'}
            with patch.dict(RD.FUNCS, {'mineru': fake}), patch('ocr_local.read.protocol', return_value=dict(RD.protocol(), gpu_lock=str(lock))):
                st = RD.run_reader(out, 'mineru', run_id='t', check_weights=False, check_server=False)
            self.assertTrue(st['gpu_lock_pastrat']); self.assertTrue(lock.exists())
    def test_raw_multilinie_reluat_fara_blocare(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d)
            def fake(data, o, cfg, dl): (o / 'request_started.json').write_text('{}'); return 'unu\ndoi', {'ok': True}
            with patch.dict(RD.FUNCS, {'lighton': fake}):
                RD.run_reader(out, 'lighton', run_id='t', check_weights=False, check_server=False, lock=False)
                st = RD.run_reader(out, 'lighton', run_id='t2', check_weights=False, check_server=False, lock=False)
            self.assertEqual(st['status'], 'complete')
    def test_lock_pastrat_daca_scrierea_rezultatului_pica(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); lock = pathlib.Path(d) / 'gpu.lock'; real_save = RD.save
            def fake(data, o, cfg, dl): (o / 'request_started.json').write_text('{}'); return '', {'ok': False, 'signal': 'deadline'}
            with patch.dict(RD.FUNCS, {'mineru': fake}), patch('ocr_local.read.protocol', return_value=dict(RD.protocol(), gpu_lock=str(lock))), \
                 patch('ocr_local.read.save', side_effect=lambda p, v: (_ for _ in ()).throw(OSError('disc plin')) if p.name == 'result.json' else real_save(p, v)):
                with self.assertRaises(OSError): RD.run_reader(out, 'mineru', run_id='t', check_weights=False, check_server=False)
            self.assertTrue(lock.exists())
    def _proto_local(self, port, lock):
        p = RD.protocol(); rd = dict(p['readers']); rd['lighton'] = dict(rd['lighton'], endpoint='http://127.0.0.1:%d' % port)
        return dict(p, readers=rd, gpu_lock=str(lock))
    def test_bucla_reala_opreste_doar_banda_si_documentul_continua(self):
        # Razvan 14.10: garda opreste DOAR banda. Server vLLM fals pe loopback: prima cerere = bucla reala Ovis td31 (streaming),
        # restul = text normal; /metrics = 0 cereri in lucru. Garda reala opreste banda 1, celelalte se citesc, gpu.lock eliberat.
        import http.server, threading
        loop = garda_fix('bucla_tabel_ovis_td31.txt'); posts = []
        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_GET(self):
                b = b'vllm:num_requests_running{model_name="x"} 0.0\nvllm:num_requests_waiting{model_name="x"} 0.0\n'
                self.send_response(200); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length'])); posts.append(1)
                text = loop if len(posts) == 1 else 'text obisnuit pe banda %d' % len(posts)
                self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                try:
                    for i in range(0, len(text), 40):
                        self.wfile.write(b'data: ' + json.dumps({'choices': [{'delta': {'content': text[i:i + 40]}}]}).encode() + b'\n\n')
                    self.wfile.write(b'data: ' + json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]}).encode() + b'\n\ndata: [DONE]\n\n')
                except OSError: pass  # clientul a inchis fluxul (garda)
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close); self.addCleanup(srv.shutdown)
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); lock = pathlib.Path(d) / 'gpu.lock'; bands = load_plan(out)['bands']; self.assertGreaterEqual(len(bands), 3)
            with patch('ocr_local.read.protocol', return_value=self._proto_local(srv.server_address[1], lock)):
                st = RD.run_reader(out, 'lighton', run_id='t', check_weights=False, check_server=False)
                self.assertEqual(st['status'], 'complete'); self.assertEqual(len(posts), len(bands)); self.assertFalse(lock.exists())
                self.assertEqual([g['band'] for g in st['benzi_garda']], [bands[0]['id']]); self.assertTrue(st['benzi_garda'][0]['signal'].startswith('bucla'))
                r0 = json.loads((out / 'page0001' / bands[0]['id'] / 'lighton' / 'result.json').read_text(encoding='utf-8'))
                self.assertEqual((r0['ok'], r0['backend_idle_confirmed']), (False, True)); self.assertTrue(r0['guard_event'])
                for b in bands[1:]:
                    self.assertTrue(json.loads((out / 'page0001' / b['id'] / 'lighton' / 'result.json').read_text(encoding='utf-8'))['ok'])
                st = RD.run_reader(out, 'lighton', run_id='t2', check_weights=False, check_server=False)  # reluare: nimic nou, banda ramane marcata
                self.assertEqual((st['status'], st['skipped_existing'], len(posts)), ('complete', len(bands), len(bands)))
                self.assertEqual([g['band'] for g in st['benzi_garda']], [bands[0]['id']])
    def test_garda_fara_vllm_confirmat_liber_opreste_tot(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); lock = pathlib.Path(d) / 'gpu.lock'; calls = []
            def fake(data, o, cfg, dl):
                calls.append(1); (o / 'request_started.json').write_text('{}'); return 'x', {'ok': False, 'signal': 'bucla_repeated200_ge4', 'error': None}
            with patch.dict(RD.FUNCS, {'lighton': fake}), patch('ocr_local.read.backend_idle', return_value=False), \
                 patch('ocr_local.read.protocol', return_value=dict(RD.protocol(), gpu_lock=str(lock))):
                st = RD.run_reader(out, 'lighton', run_id='t', check_weights=False, check_server=False)
            self.assertEqual((st['status'], len(calls)), ('stopped_no_retry', 1)); self.assertTrue(lock.exists())
    def _metrics_srv(self, body, drip=False, mod=None):
        import http.server, threading
        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_GET(self):
                try:
                    if mod == 'antet':  # antetele picura (review r5 Jakarinos P2)
                        for ch in b'HTTP/1.1 200 OK\r\nX-Lent: ' + b'a' * 400: self.wfile.write(bytes([ch])); self.wfile.flush(); time.sleep(0.01)
                        return
                    if mod == 'chunk':  # extensia unui chunk picura
                        self.wfile.write(b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n10;ext=')
                        for _ in range(400): self.wfile.write(b'x'); self.wfile.flush(); time.sleep(0.01)
                        return
                    if mod == 'stall':  # picura pana aproape de termen, apoi tace (review r5 Copilot P2)
                        self.send_response(200); self.end_headers()
                        for _ in range(40): self.wfile.write(b'#'); self.wfile.flush(); time.sleep(0.01)
                        time.sleep(4); return
                    if mod == 'stall18':
                        self.send_response(200); self.end_headers(); t = time.monotonic()
                        while time.monotonic() - t < 1.8: self.wfile.write(b'#'); self.wfile.flush(); time.sleep(0.01)
                        time.sleep(4); return
                except OSError: return
                self.send_response(200)
                if drip:  # raspuns fara sfarsit: cate un octet, periodic (review r4 Jakarinos P2)
                    self.end_headers()
                    try:
                        for _ in range(2000): self.wfile.write(b'#'); self.wfile.flush(); time.sleep(0.01)
                    except OSError: pass
                    return
                self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close); self.addCleanup(srv.shutdown)
        return dict(RD.protocol()['readers']['lighton'], endpoint='http://127.0.0.1:%d' % srv.server_address[1])
    def test_backend_idle_citeste_metrics(self):
        ocupat = self._metrics_srv(b'# HELP x\nvllm:num_requests_running{m="a"} 1.0\nvllm:num_requests_waiting{m="a"} 0.0\n')
        self.assertFalse(RD.backend_idle(ocupat, timeout=0.3, poll=0.05))
        liber = self._metrics_srv(b'vllm:num_requests_running{m="a"} 0.0\nvllm:num_requests_waiting{m="a"} 0.0\n')
        self.assertTrue(RD.backend_idle(liber, timeout=2))
        self.assertFalse(RD.backend_idle(self._metrics_srv(b'alt_metric 0\n'), timeout=0.3, poll=0.05))  # fara metricile vLLM = neconfirmat
    def test_backend_idle_termen_absolut_si_pe_citire(self):
        for cfg in (self._metrics_srv(b'', drip=True), self._metrics_srv(b'', mod='antet'), self._metrics_srv(b'', mod='chunk'),
                    self._metrics_srv(b'', mod='stall')):
            t0 = time.monotonic(); self.assertFalse(RD.backend_idle(cfg, timeout=0.5, poll=0.05))
            self.assertLess(time.monotonic() - t0, 0.5 + 0.2)  # toleranta mica fata de buget (review r6)
        # cazul Jakarinos r6: trafic pana aproape de termen (1,8 s din 2 s), apoi 4 s de tacere
        t0 = time.monotonic(); self.assertFalse(RD.backend_idle(self._metrics_srv(b'', mod='stall18'), timeout=2.0, poll=0.05))
        self.assertLess(time.monotonic() - t0, 2.0 + 0.2)
    def test_rezultat_incomplet_opreste(self):
        with tempfile.TemporaryDirectory() as d:
            out = self._plan(d); calls = []
            def fake(data, o, cfg, dl):
                calls.append(1); (o / 'request_started.json').write_text('{}'); return '', {'ok': False, 'signal': 'deadline'}
            with patch.dict(RD.FUNCS, {'lighton': fake}):
                st = RD.run_reader(out, 'lighton', run_id='t', check_weights=False, check_server=False, lock=False)
            self.assertEqual(st['status'], 'stopped_no_retry'); self.assertEqual(len(calls), 1)

class ComparareVariantaA(unittest.TestCase):
    """Varianta A (Razvan 15.10.2026): comparator literal + regula A (celulele goale de la coada) + payload base64 = un token SHA-256."""
    T = lambda self, *rows: '<table>' + ''.join('<tr>' + ''.join('<td>%s</td>' % c for c in r) + '</tr>' for r in rows) + '</table>'
    def test_regula_a_doar_celule_goale_la_coada(self):
        a = self.T(['1.4', 'Cheltuieli pentru relocarea utilitatilor', '', '', '']); b = self.T(['1.4', 'Cheltuieli pentru relocarea utilitatilor', ''])
        s, its = compare_band(BAND, a, OK, b, OK); self.assertEqual(its, []); self.assertEqual(s['acord_regula_a'], [[0, 0]])
        s, its = compare_band(BAND, self.T(['10.', 'CA02C1', 'Turnare', 'mc', '1,30', '']), OK, self.T(['10.', 'CA02C1', 'Turnare', 'mc', '1,30']), OK)
        self.assertEqual(its, [])
    def test_regula_a_nu_acopera_altceva(self):
        for x, y in ((['A', '', '5'], ['A', '5']),                       # celula goala in interior: coloana mutata
                     (['A', '5', ''], ['A', '', '5']),                   # valoarea mutata o coloana
                     (['C30/37', '1,0 m', ''], ['C30/37', '1,0m']),      # spatiu in celula
                     (['A', '0,056', ''], ['A', '0.056']),               # separator zecimal
                     (['A', '5', ''], ['A', '7']),                       # cifra diferita
                     (['', 'A', '5'], ['A', '5'])):                      # celula goala la INCEPUT
            s, its = compare_band(BAND, self.T(x), OK, self.T(y), OK)
            self.assertEqual(len(its), 1, (x, y)); self.assertEqual(s['acord_regula_a'], [], (x, y))
        with patch('ocr_local.compare.REGULA_A', False):
            s, its = compare_band(BAND, self.T(['A', '5', '']), OK, self.T(['A', '5']), OK); self.assertEqual(len(its), 1)
    def test_base64_imagine_un_singur_token_fara_pierdere(self):
        from .compare import tokens, TOKEN, B64_IMG
        p = '/9j/4AAQSkZJRgABAQAAAQABAAD' + 'aBcD0123+/' * 300 + 'Q=='
        img = lambda q: 'Schita <img src="data:image/jpeg;base64,%s"/> detaliu 5 m' % q
        s, its = compare_band(dict(BAND, kind='continuous_text'), img(p), OK, img(p), OK); self.assertEqual(its, [])
        segs = segments(img(p)); tk = tokens(segs)
        self.assertEqual(sum(1 for t in tk if t[0].startswith('⟦b64 ')), 1)
        self.assertLess(len(tk), 30)  # fara amprenta: ~1.500 de tokeni base64
        # o diferenta oricat de mica in payload ramane dezacord
        q = p[:500] + ('X' if p[500] != 'X' else 'Y') + p[501:]
        s, its = compare_band(dict(BAND, kind='continuous_text'), img(p), OK, img(q), OK); self.assertEqual(len(its), 1)
        # granitele amprentei sunt granite si in tokenizarea literala (cea refacuta in BD de fn_ofertare_ocr_granita)
        val = segs[0][1]; lit = [(m.start(), m.end()) for m in TOKEN.finditer(val)]
        granita = lambda i: not any(a < i < b for a, b in lit)
        for t in tk:
            if t[2] is not None: self.assertTrue(granita(t[2]) and granita(t[3]), t[0][:20])
        # in afara formei stricte payload-ul ramane tokenizat literal: in alt, data-src, text simplu, payload care incepe cu cifra
        for x in ('Schita <img alt="src=&quot;data:image/jpeg;base64,%s&quot;"/>' % p, 'Schita <img data-src="data:image/jpeg;base64,%s"/>' % p,
                  'Schita src="data:image/jpeg;base64,%s"' % p, img('9' + p)):
            self.assertFalse(any(t[0].startswith('⟦b64 ') for t in tokens(segments(x))), x[:50])
        self.assertIsNotNone(B64_IMG.search(segments(img(p))[0][1]))

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
    def test_rand_lipsa_la_capat_de_tabel_fara_ancora(self):
        b = TABLE_A.replace('</table>', '<tr><td>3.</td><td>TSD01C1</td><td>Împrăștiat pământ</td><td>mc</td><td>0,80</td></tr></table>')
        s, its = compare_band(BAND, TABLE_A, OK, b, OK)
        miss = [i for i in its if i['tip'] == 'rand_lipsa_lighton']; self.assertEqual(len(miss), 1)
        self.assertIsNone(miss[0]['ancora_lighton']); self.assertFalse(miss[0]['ancora_sigura'])  # la capatul tabelului = om, nu inserare automata
    def test_semn_exponent_procent_operator_raman_dezacorduri(self):
        for a, b in (('cantitate -5 mc', 'cantitate 5 mc'), ('abatere ±0,5', 'abatere 0,5'), ('1e-3 kg', '1e3 kg'), ('pantă 5%', 'pantă 5'), ('10**2 mc', '102 mc')):
            s, its = compare_band(BAND, a, OK, b, OK); self.assertEqual(len(its), 1, (a, b)); self.assertTrue(its[0]['diferenta_numerica'], (a, b))
    def test_cod_cu_cratima_mutata_e_dezacord(self):
        a = TABLE_A.replace('TSD04A1', 'AB-12C'); b = TABLE_A.replace('TSD04A1', 'AB12-C')
        s, its = compare_band(BAND, a, OK, b, OK); self.assertEqual(len(its), 1); self.assertTrue(its[0]['triplet_diferit'])
    def test_cantitate_semnata_mutata_de_coloana(self):
        a = '<table><tr><td>1.</td><td>COD</td><td>-5</td><td></td></tr></table>'; b = '<table><tr><td>1.</td><td>COD</td><td></td><td>-5</td></tr></table>'
        s, its = compare_band(BAND, a, OK, b, OK); self.assertEqual(len(its), 1)
    def test_fragment_literal_cu_cratima(self):
        s, its = compare_band(BAND, 'debit 10-20 m3', OK, 'debit 30-40 m3', OK)
        self.assertEqual((its[0]['citire_lighton'], its[0]['citire_mineru']), ('10-20', '30-40'))
    def test_semne_separate_prin_spatiu_raman_dezacorduri(self):
        for a, b in (('abatere ± 0,5', 'abatere 0,5'), ('cantitate - 5', 'cantitate 5'), ('diametru ≤ 50', 'diametru 50'), ('valoare > 100', 'valoare 100')):
            s, its = compare_band(BAND, a, OK, b, OK); self.assertEqual(len(its), 1, (a, b))
    def test_colspan_cu_cifre_merge_la_arbitru(self):
        a = '<table><tr><td>1.</td><td>COD</td><td>Țeavă</td><td>mc</td><td>1 000,00</td><td></td></tr></table>'
        b = '<table><tr><td></td><td>1.</td><td>COD</td><td>Țeavă</td><td>mc</td><td>1 000,00</td></tr></table>'
        s, its = compare_band(BAND, a, OK, b, OK); self.assertEqual(len(its), 1)
        s, its = compare_band(BAND, '<table><tr><td></td><td>Titlu</td><td></td></tr></table>', OK, '<table><tr><td>Titlu</td></tr></table>', OK); self.assertEqual(len(its), 1)  # r3: fara scutire colspan
    def test_acorduri_false_r2_jakarinos(self):
        for a, b in (('10**2 + 3**2 mc', '102 + 32 mc'), ('cantitate .5 mc', 'cantitate 5 mc'), ('x < 5 si y > 3', 'x 3')):
            s, its = compare_band(BAND, a, OK, b, OK); self.assertGreaterEqual(len(its), 1, (a, b))
    def test_rand_mutat_intre_tabele_e_dezacord_de_structura(self):
        row = lambda k: '<tr><td>%s</td><td>C%s</td><td>d</td><td>m</td><td>1,00</td></tr>' % (k, k)
        tab = lambda ks: '<table>' + ''.join(row(k) for k in ks) + '</table>'
        s, its = compare_band(BAND, tab('AHC') + '<p>x</p>' + tab('DE'), OK, tab('A') + '<p>x</p>' + tab('HXCDE'), OK)
        self.assertIn('structura_tabele', [i['tip'] for i in its]); self.assertFalse(any(i.get('ancora_sigura') for i in its))
    def test_segmente_text_cu_tabel_intre_ele_nu_crapa(self):
        mid = '<table><tr><td>1.</td><td>A</td></tr></table>'
        s, its = compare_band(BAND, 'Titlu' + mid + 'Final', OK, 'Titlul' + mid + 'Finalul', OK); self.assertGreaterEqual(len(its), 1)
    def test_sursa_reface_exact_fragmentul(self):
        # D3a r7: BD reface fragmentul din segmente + sursa (compare.literal) si cere granite de token; aici, aceeasi regula in Python
        from .compare import segmente, TOKEN
        mid = '<table><tr><td>1.</td><td>A</td></tr></table>'
        for a, b in (('Cantitate 10.5 m și 5 buc', 'Cantitate 10,5 m și 6 buc'), ('Titlu' + mid + 'Final', 'Titlul' + mid + 'Finalul'),
                     ('1e3 kg, ±0,5 mm', '1e-3 kg, ±0.5 mm'), ('Banda doi: 7 mc', '| Banda doi: 8 | mc |'),
                     ('Titlu' + mid + 'Final', 'Titlu' + mid + mid.replace('1.', '2') + 'Final'), (mid + 'Titlu Final', 'Titlu ' + mid + ' Final'),
                     ('Valoare 1e3.5 m', 'Valoare 1e3.6 m')):  # r8: capete pe tabel (pozitie None), granita dupa exponent
            s, its = compare_band(BAND, a, OK, b, OK); self.assertTrue(its, (a, b))
            for it in (i for i in its if i['tip'] == 'text'):
                for r, raw in (('lighton', a), ('mineru', b)):
                    sg = segmente(raw); src = it['sursa'][r]; frag = it['citire_' + r]
                    if s['structura'] == 'diferita':
                        sg = [['text', '\n'.join(v if k == 'text' else '\n'.join(' '.join(x) for x in v) for k, v in sg)]]
                    if not frag: self.assertIsNone(src); continue
                    i1, i2 = src['seg']; st, en = src['start'], src['end']
                    self.assertEqual(sg[i1][0] == 'table', st is None); self.assertEqual(sg[i2][0] == 'table', en is None)
                    if i1 == i2 and sg[i1][0] == 'text': parts = [sg[i1][1][st:en]]
                    else: parts = [(sg[k][1][st if k == i1 else 0:en if k == i2 else None]) if sg[k][0] == 'text' else '⟦tabel⟧' for k in range(i1, i2 + 1)]
                    self.assertEqual('\n'.join(parts), frag, (raw, it['id']))
                    for k, pos in ((i1, st), (i2, en)):
                        if pos is None: continue
                        mid_tok = {j for m in TOKEN.finditer(sg[k][1]) for j in range(m.start() + 1, m.end())}
                        self.assertNotIn(pos, mid_tok, (raw, it['id'], pos))
    def test_tokenizarea_identica_cu_bd(self):
        # D3a r9: migrarea contine EXACT regex-ul TOKEN (NUM | [LETTERS]+ | nespatiu), cu literele explicite; m² e un singur token
        import codecs, re as _re
        from .compare import TOKEN, NUM, LETTERS
        sql = (pathlib.Path(__file__).resolve().parents[2] / 'supabase/migrations/20261029b_ofertare_ocr_local.sql').read_text(encoding='utf-8')
        tok = _re.search(r"c_tok constant text := '([^']*)'", sql).group(1)
        self.assertEqual(tok, NUM.replace(r'\d', '[0-9]') + '|[' + LETTERS + ']+|[^[:space:]]')
        self.assertEqual([m.group(0) for m in TOKEN.finditer('5 m² și ½ x')], ['5', 'm²', 'și', '½', 'x'])
    def test_prompt_arbitru_admis(self):
        # D3b: versiunea si modelul din edge-ul ofertare-ocr-arbitreaza = singurele admise la reconciliere
        import re as _re
        rad = pathlib.Path(__file__).resolve().parents[2]
        ts = (rad / 'supabase/functions/ofertare-ocr-arbitreaza/prompt.ts').read_text(encoding='utf-8')
        pol = json.loads((pathlib.Path(__file__).with_name('protocol.json')).read_text(encoding='utf-8'))['arbitru']
        # versiunea curenta = ultima admisa; cea veche ramane admisa doar ca istoric (arb-v1 -> arb-v2, laborator 15.10.2026)
        self.assertEqual(pol['prompt_versiuni_admise'], ['arb-v1', _re.search(r"PROMPT_VERSIUNE = '([^']+)'", ts).group(1)])
        # cascada (15.10.2026): modelele admise = exact cele doua din edge (filtrul Haiku + arbitrul Sonnet), in aceasta ordine
        self.assertEqual(pol['modele_admise'], [_re.search(r"MODEL_ARBITRU = '([^']+)'", ts).group(1), _re.search(r"MODEL_FILTRU = '([^']+)'", ts).group(1)])
    def test_cifre_edge_identice(self):
        # cascada (15.10): edge-ul recalculeaza diferenta de cifre din BD (diferentaNumerica in TS); fisierul de paritate e corect in Python
        from .compare import numeric_diff
        f = pathlib.Path(__file__).resolve().parents[2] / 'supabase/functions/_shared/ocrLocal_cifre.json'
        cazuri = json.loads(f.read_text(encoding='utf-8')); self.assertGreater(len(cazuri), 100)
        for a, b, asteptat in cazuri: self.assertEqual(numeric_diff(a, b), asteptat, (a, b))
    def test_amprente_edge_identice(self):
        # D3b: fisierul de paritate folosit de testul Deno (ofertare-ocr-arbitreaza recalculeaza amprenta in TS) e corect in Python
        from .compare import item_hash
        f = pathlib.Path(__file__).resolve().parents[2] / 'supabase/functions/_shared/ocrLocal_amprente.json'
        for it in json.loads(f.read_text(encoding='utf-8')): self.assertEqual(item_hash(it), it['item_sha256'], it['id'])
    def test_politica_inversa_simboluri_si_exponenti(self):
        for x, y in (('pantă 5 %', 'pantă 5'), ('abatere 5 ‰', 'abatere 5'), ('cod A_B', 'cod AB'), ('valoare (5)', 'valoare 5'),
                     ('preț 100 €', 'preț 100'), ('suprafață m<sup>2</sup>', 'suprafață m2'), ('apă H<sub>2</sub>O', 'apă H2O')):
            s, its = compare_band(BAND, x, OK, y, OK); self.assertGreaterEqual(len(its), 1, (x, y))
    def test_celule_unite_fara_cifre_merg_la_arbitru(self):
        s, its = compare_band(BAND, '<table><tr><td></td><td>CODX</td><td>mc</td><td>conform proiect</td></tr></table>', OK,
                              '<table><tr><td>CODX</td><td>mc</td><td>conform proiect</td></tr></table>', OK)
        self.assertEqual(len(its), 1)
    def test_jakarinos_r3_operatori_si_etichete(self):
        for x, y in (('x != 5', 'x = 5'), ('panta 5 %', 'panta 5'), ('x<y si z>3', 'x 3')):
            s, its = compare_band(BAND, x, OK, y, OK); self.assertGreaterEqual(len(its), 1, (x, y))
    def test_semn_pe_pagina_de_cantitati_e_marcat_cantitate(self):
        s, its = compare_band(BAND, 'Cantitate - 5 m', OK, 'Cantitate 5 m', OK); self.assertTrue(its[0]['e_cantitate'])
        band_text = dict(BAND, kind='continuous_text')
        s, its = compare_band(band_text, 'Cantitate - 5 m', OK, 'Cantitate 5 m', OK); self.assertTrue(its[0]['e_cantitate'])
    def test_celula_cu_cifra_mutata_fara_antet_e_cantitate(self):
        s, its = compare_band(dict(BAND, kind='continuous_text'), '<table><tr><td>A</td><td>5 m</td><td></td></tr></table>', OK,
                              '<table><tr><td>A</td><td></td><td>5 m</td></tr></table>', OK)
        self.assertEqual(len(its), 1); self.assertTrue(its[0]['e_cantitate'])
    def test_text_mutat_peste_tabel_e_dezacord(self):
        tab = '<table><tr><td>1.</td><td>A</td></tr></table>'
        s, its = compare_band(BAND, 'Titlu A' + tab + 'Titlu B', OK, 'Titlu A Titlu B' + tab, OK)
        self.assertGreaterEqual(len(its), 1); self.assertTrue(any(i.get('contine_tabel') for i in its))
    def test_bara_escapata_in_markdown(self):
        md = '| A | otel \\| PE | m | 5 |'
        self.assertEqual(segments(md)[0][1], [['A', 'otel | PE', 'm', '5']])
    def test_copilot_r4_structura_si_diez(self):
        s, its = compare_band(BAND, '<table><tr><td>COD</td><td>mc</td><td>5</td></tr></table>', OK, 'COD mc 5', OK)
        self.assertEqual(its[0]['tip'], 'structura_tabele'); self.assertTrue(its[0]['e_cantitate'])
        for x, y in (('#12 conducta', '12 conducta'), ('##ABC', 'ABC')):
            s, its = compare_band(BAND, x, OK, y, OK); self.assertGreaterEqual(len(its), 1, (x, y))
        s, its = compare_band(BAND, '# Titlu', OK, 'Titlu', OK); self.assertEqual(its, [])
    def test_um_diferita_pe_pagina_de_cantitati_e_cantitate(self):
        s, its = compare_band(BAND, TABLE_A, OK, TABLE_A.replace('100mc', 'kg'), OK); self.assertTrue(its[0]['e_cantitate'])
    def test_jakarinos_r4_geometrie_caption_tag_exponent(self):
        s, its = compare_band(BAND, '<table><tr><td colspan="2">Teava</td><td>5</td></tr></table>', OK,
                              '<table><tr><td>Teava</td><td colspan="2">5</td></tr></table>', OK); self.assertEqual(len(its), 1)
        s, its = compare_band(BAND, '<table><tr><td colspan="2">Teava</td></tr></table>', OK, '<table><tr><td>Teava</td><td></td></tr></table>', OK)
        self.assertEqual(its, [])  # colspan = celule goale la celalalt cititor: aceeasi grila
        tab = lambda c: '<table><caption>%s</caption><tr><td>1.</td><td>A</td><td>5</td></tr></table>' % c
        s, its = compare_band(BAND, tab('Tronson A'), OK, tab('Tronson B'), OK); self.assertGreaterEqual(len(its), 1)
        s, its = compare_band(BAND, 'x<b si z>3', OK, 'x 3', OK); self.assertGreaterEqual(len(its), 1)
        s, its = compare_band(BAND, 'x<sup>2+3</sup>', OK, 'x<sup>2</sup>+3', OK); self.assertGreaterEqual(len(its), 1)
    def test_copilot_r5_colspan_invalid_si_img(self):
        cell = lambda v: '<table><tr><td colspan="%s">Teava</td><td>5</td></tr></table>' % v
        for x, y in (('2x', '2'), ('51', '200'), ('0', '1')):
            s, its = compare_band(BAND, cell(x), OK, cell(y), OK); self.assertGreaterEqual(len(its), 1, (x, y))
        s, its = compare_band(BAND, 'Conductă <img alt="DN100"/>', OK, 'Conductă <img alt="DN150"/>', OK); self.assertGreaterEqual(len(its), 1)
    def test_jakarinos_r5_neinchise_barat_rowspan(self):
        s, its = compare_band(BAND, '<table><tr><td>COD<td>5</table>', OK, '<table><tr><td>COD<td>7</table>', OK); self.assertGreaterEqual(len(its), 1)
        for x, y in (('Cantitate <s>5</s> 7 m', 'Cantitate 5 7 m'), ('Cantitate ~~5~~ 7 m', 'Cantitate 5 7 m')):
            s, its = compare_band(BAND, x, OK, y, OK); self.assertGreaterEqual(len(its), 1, (x, y))
        cell = lambda k, v: '<table><tr><td %s="%s">Teava</td><td>5</td></tr></table>' % (k, v)
        for k, x, y in (('rowspan', '0', '1'), ('colspan', '50', '51')):
            s, its = compare_band(BAND, cell(k, x), OK, cell(k, y), OK); self.assertGreaterEqual(len(its), 1, (k, x, y))
    def test_copilot_r6_tabel_fara_inchidere(self):
        a, b = '<table><tr><td>COD</td><td>mc</td><td>5</td></tr>', 'COD mc 5'
        for x, y in ((a, b), (b, a), ('COD mc 5</table>', b)):
            s, its = compare_band(BAND, x, OK, y, OK); self.assertGreaterEqual(len(its), 1, (x, y))
    def test_jakarinos_r6_p2(self):
        x = '<table><tr><td>COD</td><td>5</td><td></td></tr></table>'; y = '<table><tr><td>COD</td><td></td><td>5</td></tr></table>'
        s, its = compare_band(BAND, x.replace('</table>', ''), OK, y.replace('</table>', ''), OK); self.assertGreaterEqual(len(its), 1)
        t1 = lambda v: '<table><tr><td>A</td></tr>Presiune %s bar<tr><td>B</td></tr></table>' % v
        s, its = compare_band(BAND, t1('5'), OK, t1('7'), OK); self.assertGreaterEqual(len(its), 1)
        for a, b in (('<img alt="DN100 > 0">', '<img alt="DN150 > 0">'), ('<img alt=DN100>', '<img alt=DN150>'), ('<img src="A.png">', '<img src="B.png">'),
                     ('Cantitate <span style="text-decoration:line-through">5</span> 7', 'Cantitate 5 7')):
            s, its = compare_band(BAND, 'x ' + a, OK, 'x ' + b, OK); self.assertGreaterEqual(len(its), 1, (a, b))
    def test_jakarinos_r7_barare_css_si_slash(self):
        for tag in ('p', 'div'):
            x = 'Cantitate <%s style="text-decoration:line-through">5</%s> 7' % (tag, tag)
            s, its = compare_band(BAND, x, OK, 'Cantitate 5 7', OK); self.assertGreaterEqual(len(its), 1, tag)
        s, its = compare_band(BAND, '<table><tr><td>A</td><td style="text-decoration:line-through">5</td></tr></table>', OK,
                              '<table><tr><td>A</td><td>5</td></tr></table>', OK); self.assertGreaterEqual(len(its), 1)
        s, its = compare_band(BAND, 'x <img alt=DN100/>', OK, 'x <img alt=DN100>', OK); self.assertGreaterEqual(len(its), 1)
    def test_bold_markdown_doar_pe_perechi(self):
        s, its = compare_band(BAND, '**Transport Utilaje** 1,00', OK, 'Transport Utilaje 1,00', OK); self.assertEqual(its, [])
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
        q = [i for i in its if i['anomalie_separator']]
        self.assertEqual(len(q), 1); self.assertTrue(q[0]['e_cantitate']); self.assertEqual(q[0]['tip'], 'rand_tabel')
        self.assertEqual((q[0]['citire_lighton'].split(' | ')[-1], q[0]['citire_mineru'].split(' | ')[-1]), ('0,056', '0.056'))

class Reconciliere(unittest.TestCase):
    def _run(self, a, b, decizii, kind='quantity_table'):
        d = tempfile.mkdtemp(); out = pathlib.Path(d) / 'out'
        Image.new('RGB', (300, 300), 'white').save(pathlib.Path(d) / 'i.png')
        doc = plan(pathlib.Path(d) / 'i.png', out, clockwise=0, kind=kind); band = doc['bands'][0]
        for reader, raw in (('lighton', a), ('mineru', b)):
            o = out / 'page0001' / band['id'] / reader; o.mkdir(parents=True)
            (o / 'raw.txt').write_bytes(raw.encode('utf-8')); proto = RD.protocol()
            (o / 'result.json').write_text(json.dumps({'ok': True, 'reader': reader, 'protocol': proto['version'], 'weights_sha256': proto['readers'][reader]['weights_sha256'],
                                                       'image_sha256': band['image_sha256'], 'raw_sha256': hashlib.sha256(raw.encode()).hexdigest()}))
        _, items = compare(out)
        (out / 'dec.jsonl').write_text('\n'.join(json.dumps(dict({'id': items[i]['id'], 'item_sha256': items[i]['item_sha256']}, **x)) for i, x in enumerate(decizii)), encoding='utf-8')
        return reconcile(out, out / 'dec.jsonl'), items, out
    def setUp(self):
        p = patch('ocr_local.reconcile.arbiter_policy', return_value=POLICY); p.start(); self.addCleanup(p.stop)
    def test_semnal_clasificare_incerta_ajunge_in_reconciliere(self):
        r, _, _ = self._run('lungime 10 m', 'lungime 10 m', [], kind='drawing')
        pg = r['pages'][0]; self.assertFalse(pg['needs_human'])
        self.assertIn({'type': 'clasificare_incerta', 'candidate': 'drawing'}, pg['semnale'])
        r2, _, _ = self._run('lungime 10 m', 'lungime 10 m', [])
        self.assertNotIn('clasificare_incerta', [s['type'] for s in r2['pages'][0]['semnale']])
    def dec(self, decizie, text=''): return {'decizie': decizie, 'text': text, 'motiv': 'test', 'e_cantitate': True, 'anomalie_separator': True,
                                             'arbitru_model': 'claude-sonnet-5', 'prompt_versiune': 't1'}
    def test_ales_mineru_pe_cantitate(self):
        r, items, out = self._run(TABLE_A, TABLE_B, [self.dec('ales_mineru')])
        pg = r['pages'][0]; self.assertFalse(pg['needs_human']); self.assertIn('| 0.056 |', pg['text']); self.assertEqual(pg['arbitrat_de_claude_cantitati'], 1)
        t = json.loads((out / 'reconciliere' / 'tripleti.jsonl').read_text(encoding='utf-8').splitlines()[0])
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
    def test_ales_mineru_pastreaza_valoarea_exacta(self):
        r, _, _ = self._run('Cantitate -10 m', 'Cantitate 20 m', [self.dec('ales_mineru')]); self.assertEqual(r['pages'][0]['text'], 'Cantitate 20 m')
        r, _, _ = self._run('debit 10-20 m3', 'debit 30-40 m3', [self.dec('ales_mineru')]); self.assertEqual(r['pages'][0]['text'], 'debit 30-40 m3')
    def test_citire_schimbata_dupa_comparare_refuzata(self):
        d = tempfile.mkdtemp(); out = pathlib.Path(d) / 'out'
        r, items, out = self._run('lungime 10 m', 'lungime 20 m', [self.dec('ales_lighton')])
        o = out / 'page0001' / items[0]['band'] / 'lighton'; (o / 'raw.txt').write_text('lungime 999 m', encoding='utf-8')
        shutil.rmtree(out / 'reconciliere')
        with self.assertRaises(ValueError): reconcile(out, out / 'dec.jsonl')
    def test_dezacorduri_golite_refuzate(self):
        r, items, out = self._run('lungime 10 m', 'lungime 20 m', [self.dec('ales_lighton')])
        (out / 'dezacorduri.jsonl').write_text(''); shutil.rmtree(out / 'reconciliere')
        with self.assertRaises(ValueError): reconcile(out, out / 'dec.jsonl')
    def test_celula_cu_bara_nu_se_sparge(self):
        a = '<table><tr><td>1.</td><td>X1</td><td>otel | PE</td><td>m</td><td>2,00</td></tr></table>'
        r, _, _ = self._run(a, a.replace('2,00', '3,00'), [self.dec('ales_mineru')])
        self.assertIn('| otel \\| PE | m | 3,00 |', r['pages'][0]['text'])
    def test_rand_la_inceputul_altui_tabel_needs_human(self):
        t1 = '<table><tr><td>1.</td><td>A1</td><td>unu</td><td>m</td><td>1,00</td></tr></table>'
        t2a = '<p>Titlu</p><table><tr><td>1.</td><td>B1</td><td>doi</td><td>m</td><td>2,00</td></tr></table>'
        t2b = '<p>Titlu</p><table><tr><td>0.</td><td>B0</td><td>zero</td><td>m</td><td>9,00</td></tr><tr><td>1.</td><td>B1</td><td>doi</td><td>m</td><td>2,00</td></tr></table>'
        r, items, _ = self._run(t1 + t2a, t1 + t2b, [self.dec('ales_mineru')])
        self.assertEqual(items[0]['tip'], 'rand_lipsa_lighton'); self.assertTrue(r['pages'][0]['needs_human'])
    def test_marcaj_cantitate_al_arbitrului_se_pastreaza(self):
        r, items, out = self._run('lungime 10 m', 'lungime 20 m', [self.dec('ales_lighton')])
        t = json.loads((out / 'reconciliere' / 'tripleti.jsonl').read_text(encoding='utf-8').splitlines()[0]); self.assertTrue(t['e_cantitate'])
        self.assertEqual(r['pages'][0]['arbitrat_de_claude_cantitati'], 1)
    def test_linie_null_nu_crapa(self):
        r, items, out = self._run('lungime 10 m', 'lungime 20 m', [])
        (out / 'dec.jsonl').write_text('null\n{"id": ["x"]}\n'); shutil.rmtree(out / 'reconciliere')
        r = reconcile(out, out / 'dec.jsonl'); self.assertTrue(r['pages'][0]['needs_human']); self.assertEqual(r['summary']['decisions_invalid'], 2)
    def test_ancora_modificata_in_jsonl_refuzata(self):
        t1 = '<table><tr><td>1.</td><td>A1</td><td>unu</td><td>m</td><td>1,00</td></tr><tr><td>2.</td><td>A2</td><td>doi</td><td>m</td><td>2,00</td></tr></table>'
        t2 = t1.replace('<tr><td>2.', '<tr><td>1b.</td><td>A1b</td><td>nou</td><td>m</td><td>5,00</td></tr><tr><td>2.')
        r, items, out = self._run(t1, t2, [])
        its = [json.loads(l) for l in (out / 'dezacorduri.jsonl').read_text(encoding='utf-8').splitlines()]
        its[0]['ancora_sigura'] = not its[0]['ancora_sigura']
        (out / 'dezacorduri.jsonl').write_text('\n'.join(json.dumps(i, ensure_ascii=False) for i in its), encoding='utf-8')
        shutil.rmtree(out / 'reconciliere')
        with self.assertRaises(ValueError): reconcile(out, out / 'dec.jsonl')
    def test_id_duplicat_refuzat(self):
        r, items, out = self._run('x 1 a b c d e f 2 y', 'x 9 a b c d e f 8 y', [])
        its = [json.loads(l) for l in (out / 'dezacorduri.jsonl').read_text(encoding='utf-8').splitlines()]
        self.assertGreaterEqual(len(its), 2); its[1]['id'] = its[0]['id']
        (out / 'dezacorduri.jsonl').write_text('\n'.join(json.dumps(i, ensure_ascii=False) for i in its), encoding='utf-8')
        shutil.rmtree(out / 'reconciliere')
        with self.assertRaises(ValueError): reconcile(out, out / 'dec.jsonl')
    def test_comparare_refuza_rezultat_din_alt_protocol(self):
        r, items, out = self._run('lungime 10 m', 'lungime 20 m', [])
        rp = out / 'page0001' / items[0]['band'] / 'mineru' / 'result.json'; res = json.loads(rp.read_text()); res['protocol'] = 'lighton-mineru-v1'; rp.write_text(json.dumps(res))
        with self.assertRaises(ValueError): compare(out)
    def test_semn_separat_inlocuit_integral(self):
        r, _, _ = self._run('Cantitate - 10 m', 'Cantitate 20 m', [self.dec('ales_mineru')]); self.assertEqual(r['pages'][0]['text'], 'Cantitate 20 m')
    def test_rand_nou_in_acelasi_tabel_se_insereaza(self):
        t1 = '<table><tr><td>1.</td><td>A1</td><td>unu</td><td>m</td><td>1,00</td></tr><tr><td>2.</td><td>A2</td><td>doi</td><td>m</td><td>2,00</td></tr></table>'
        t2 = t1.replace('<tr><td>2.', '<tr><td>1b.</td><td>A1b</td><td>nou</td><td>m</td><td>5,00</td></tr><tr><td>2.')
        r, items, _ = self._run(t1, t2, [self.dec('ales_mineru')])
        self.assertTrue(items[0]['ancora_sigura']); self.assertFalse(r['pages'][0]['needs_human'])
        self.assertIn('| 1. | A1 | unu | m | 1,00 |\n| 1b. | A1b | nou | m | 5,00 |\n| 2. |', r['pages'][0]['text'])
    def test_text_mutat_peste_tabel_needs_human(self):
        tab = '<table><tr><td>1.</td><td>A</td></tr></table>'
        r, items, out = self._run('Titlu A' + tab + 'Titlu B', 'Titlu A Titlu B' + tab, [self.dec('ales_mineru')])
        self.assertTrue(r['pages'][0]['needs_human'])
    def test_insert_dupa_ultimul_tabel_needs_human_fara_exceptie(self):
        tab = '<table><tr><td>1.</td><td>A</td></tr></table>'
        r, items, out = self._run(tab, tab + 'final', [self.dec('ales_mineru')]); self.assertTrue(r['pages'][0]['needs_human'])
    def test_structura_diferita_ales_lighton_pastreaza_tabelul(self):
        r, items, out = self._run('<table><tr><td>COD</td><td>mc</td><td>5</td></tr></table>', 'COD mc 5', [self.dec('ales_lighton')])
        self.assertFalse(r['pages'][0]['needs_human']); self.assertEqual(r['pages'][0]['text'], '| COD | mc | 5 |')
    def test_structura_mixta_cu_valoare_diferita(self):
        r, items, out = self._run('<table><tr><td>COD</td><td>mc</td><td>5</td></tr></table>', 'COD mc 7', [self.dec('ales_lighton'), self.dec('ales_mineru')])
        self.assertTrue(r['pages'][0]['needs_human'])
    def test_structura_ales_lighton_domina_restul(self):
        r, items, out = self._run('<table><tr><td>COD</td><td>mc</td><td>5</td></tr></table>', 'COD m 5', [self.dec('ales_lighton'), self.dec('ales_mineru')])
        self.assertEqual(len(items), 2); self.assertTrue(r['pages'][0]['needs_human'])
        shutil.rmtree(out / 'reconciliere')
        (out / 'dec.jsonl').write_text('\n'.join(json.dumps(dict({'id': it['id'], 'item_sha256': it['item_sha256']}, **self.dec('ales_lighton'))) for it in items), encoding='utf-8')
        r = reconcile(out, out / 'dec.jsonl'); self.assertFalse(r['pages'][0]['needs_human']); self.assertEqual(r['pages'][0]['text'], '| COD | mc | 5 |')
    def test_granite_de_tabel_structura_domina(self):
        row = lambda k, v='1,00': '<tr><td>%s.</td><td>C%s</td><td>d</td><td>m</td><td>%s</td></tr>' % (k, k, v)
        a = '<table>' + row(1) + row(2) + '</table><p>x</p><table>' + row(3) + '</table>'
        b = '<table>' + row(1) + '</table><p>x</p><table>' + row(2, '9,00') + row(3) + '</table>'
        r, items, out = self._run(a, b, [])
        self.assertIn('structura_tabele', [i['tip'] for i in items])
        shutil.rmtree(out / 'reconciliere')
        decs = [dict(self.dec('ales_lighton' if i['tip'] == 'structura_tabele' else 'ales_mineru'), id=i['id'], item_sha256=i['item_sha256']) for i in items]
        (out / 'dec.jsonl').write_text('\n'.join(json.dumps(d) for d in decs), encoding='utf-8')
        r = reconcile(out, out / 'dec.jsonl'); self.assertTrue(r['pages'][0]['needs_human'])
    def test_validare_schema(self):
        v = lambda d: valid_decision(d, None, POLICY)
        self.assertTrue(v(self.dec('needs_human'))); self.assertFalse(v(self.dec('needs_human', 'x')))
        self.assertFalse(v(self.dec('text_propus', ' '))); self.assertFalse(v(dict(self.dec('ales_lighton'), extra=1)))
        self.assertFalse(v(dict(self.dec('ales_lighton'), e_cantitate='da')))
        self.assertFalse(v(dict(self.dec('ales_lighton'), arbitru_model='alt-model'))); self.assertFalse(v(dict(self.dec('ales_lighton'), prompt_versiune=None)))
        self.assertFalse(valid_decision(dict(self.dec('ales_lighton'), item_sha256='a'), {'item_sha256': 'b'}, POLICY))
    def test_decizie_pe_alt_dezacord_respinsa(self):
        r, items, out = self._run(TABLE_A, TABLE_B, [dict(self.dec('ales_mineru'), item_sha256='0' * 64)])
        self.assertTrue(r['pages'][0]['needs_human']); self.assertEqual(r['invalid_decisions'][0]['motiv'], 'schema')
    def test_prompt_neadmis_in_protocol_needs_human(self):
        patch.stopall()
        r, items, out = self._run(TABLE_A, TABLE_B, [self.dec('ales_mineru')]); self.assertTrue(r['pages'][0]['needs_human'])
    def test_reconciliere_a_doua_oara_refuzata_fara_scriere(self):
        r, items, out = self._run(TABLE_A, TABLE_B, [self.dec('ales_mineru')]); before = (out / 'reconciliere' / 'reconciliat.json').read_bytes()
        with self.assertRaises(FileExistsError): reconcile(out, out / 'dec.jsonl')
        self.assertEqual((out / 'reconciliere' / 'reconciliat.json').read_bytes(), before)
    def test_cusatura_benzi(self):
        a = 'rand unu al benzii\nrand doi cu opt tokeni aici gata\nrand trei final aici'
        b = 'rand doi cu opt tokeni aici gata\nrand trei final aici\nrand patru nou'
        sig = []; self.assertEqual(join_bands([a, b], sig), a + '\nrand patru nou'); self.assertEqual(sig[0]['type'], 'cusatura_suprapunere_taiata')
        sig = []; self.assertIsNone(join_bands(['unu doi trei', 'trei patru'], sig)); self.assertEqual(sig[0]['type'], 'cusatura_nesigura')

if __name__ == '__main__': unittest.main()


class Triere(unittest.TestCase):
    # laborator 16.10.2026 (decizia Razvan A): provenienta marcajelor + trierea pe numere din CONTINUT
    BAND = {'id': 'p0001_b0', 'page': 1, 'kind': 'quantity_table', 'image': 'x.png', 'image_sha256': '0' * 64}
    RES = {'ok': True}
    def _cls(self, a, b):
        from .triere import triaza_banda
        _, its = compare_band(self.BAND, a, self.RES, b, self.RES)
        tr = triaza_banda(a, b, its); return [tr[i['id']][0] for i in its], its
    def tab(self, *rows):
        return '<table>' + ''.join('<tr>' + ''.join(c for c in r) + '</tr>' for r in rows) + '</table>'
    def test_doar_rowspan_e_marcaj(self):
        a = self.tab(['<td>Antet</td>', '<td>UM</td>'], ['<td rowspan="8">Fluid</td>', '<td>m</td>'])
        b = self.tab(['<td>Antet</td>', '<td>UM</td>'], ['<td rowspan="9">Fluid</td>', '<td>m</td>'])
        c, _ = self._cls(a, b); self.assertEqual(c, ['MARCAJE'])
    def test_rowspan_scris_de_ocr_ca_text_e_continut(self):
        # „⟦rowspan=3⟧” venit din CITIRE nu e marcaj de pipeline: cifra 3 e continut
        a = self.tab(['<td>Antet</td>', '<td>UM</td>'], ['<td>Fluid ⟦rowspan=3⟧</td>', '<td>m</td>'])
        b = self.tab(['<td>Antet</td>', '<td>UM</td>'], ['<td>Fluid</td>', '<td>m</td>'])
        c, _ = self._cls(a, b); self.assertEqual(c, ['HIGH_RISK'])
    def test_numere_diferite_si_mutate(self):
        a = self.tab(['<td>1</td>', '<td>Teava</td>', '<td>m</td>', '<td>10</td>'])
        b = self.tab(['<td>1</td>', '<td>Teava</td>', '<td>m</td>', '<td>12</td>'])
        self.assertEqual(self._cls(a, b)[0], ['HIGH_RISK'])
        a2 = self.tab(['<td>1</td>', '<td>Teava</td>', '<td>10</td>', '<td></td>'])
        b2 = self.tab(['<td>1</td>', '<td>Teava</td>', '<td></td>', '<td>10</td>'])
        self.assertEqual(self._cls(a2, b2)[0], ['HIGH_RISK'])
    def test_text_fara_numere_defer_si_cu_numere_high(self):
        self.assertEqual(self._cls('Lungimea conductei este mare.', 'Lungimea conductel este mare.')[0], ['DEFER'])
        self.assertEqual(self._cls('Lungimea este 10 m.', 'Lungimea este 16 m.')[0], ['HIGH_RISK'])
    def test_bara_la_un_singur_cititor(self):
        self.assertEqual(self._cls('Cantitate <s>10</s> m', 'Cantitate 10 m')[0], ['HIGH_RISK'])
    def test_imagine_diferita_e_marcaj(self):
        a = 'Plan <img src="data:image/jpeg;base64,QUJDREVG"/> gata'; b = 'Plan <img src="data:image/jpeg;base64,WFlaV1ZV"/> gata'
        self.assertEqual(self._cls(a, b)[0], ['MARCAJE'])
    def test_caracter_privat_in_citire_fail_closed(self):
        self.assertEqual(self._cls('Text  normal fara cifre', 'Text normal fara cifre')[0], ['HIGH_RISK'])
    def test_paritate_segmente_neschimbate(self):
        from .compare import segmente_provenienta
        for raw in (self.tab(['<td rowspan="2">a <s>b</s></td>', '<td>x<sup>2</sup></td>']), 'Text ~~taiat~~ si <img alt="z"/> | a | b |\n| 1 | 2 |'):
            norm, masti = segmente_provenienta(raw); self.assertEqual(norm, segments(raw))
