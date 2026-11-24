"""Banda albă cu ieșire goală = „bandă goală”, nu oprire (25.11.2026). Offline: cititorii sunt falși, imaginile sunt reale.
Fixtura `banda_alba_lot2.png` = copia exactă a benzii p0001_b0 din coada Lot 2 (margine albă cu două linii verticale palide,
fără conținut), cu SHA-256-ul din planul real (sursă independentă de cod). Rulare: PYTHONPATH=scripts python -m pytest scripts/ocr_local/tests"""
import hashlib
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

from ocr_local import banda_goala as BG
from ocr_local import read as RD
from ocr_local.asamblare import asambleaza_pagina, stare_noua
from ocr_local.compare import compare_band
from ocr_local.reconcile import join_bands

HERE = pathlib.Path(__file__).parent
ALBA = (HERE / 'banda_alba_lot2.png').read_bytes()
SHA_ALBA_PLAN = '4532186ac468ef4aef247bf2aeb214e85b475e97b15b8d2175e6649b31257ed5'  # image_sha256 din planurile L2_148 / L2_175 / L2_176
GOL_LIGHTON = {'ok': False, 'finish_reason': 'stop', 'signal': None, 'guard_event': None, 'error': None,
               'usage': {'prompt_tokens': 687, 'total_tokens': 688, 'completion_tokens': 1}}  # răspunsul real din coadă
GOL_MINERU = {'ok': False, 'signal': None, 'guard_event': None, 'error': None, 'blocks': 0, 'blocuri_cu_text': 0}


def png(im):
    buf = io.BytesIO(); im.save(buf, format='PNG'); return buf.getvalue()


def pe_alba(desen):
    """Banda albă reală + un desen peste ea (textul subțire de test)."""
    im = Image.open(io.BytesIO(ALBA)).convert('RGB'); desen(ImageDraw.Draw(im)); return png(im)


def text_negru(d): d.text((600, 200), '7', fill=(0, 0, 0))                     # o cifră de pagină
def text_subtire(d): d.text((300, 120), 'Cant. 12,5 mc', fill=(0, 0, 0))     # câteva caractere
def text_palid(d): d.text((300, 120), 'Cant. 12,5 mc', fill=(200, 200, 200))  # cerneală palidă, niciun pixel sub 128


class Imagine(unittest.TestCase):
    def test_fixtura_e_banda_reala(self):
        self.assertEqual(hashlib.sha256(ALBA).hexdigest(), SHA_ALBA_PLAN)

    def test_banda_alba_reala_e_alba(self):
        m = BG.masoara(ALBA)
        self.assertTrue(m['alba'], m); self.assertEqual(m['pixeli_intunecati'], 0); self.assertLess(m['deviatie'], 6)
        self.assertGreaterEqual(m['segmente_linie'], 2)  # liniile verticale palide de tabel sunt ignorate ca linii, nu ca cerneală
        self.assertLessEqual(m['praf_px'], BG.PRAF_TOTAL)

    def test_cifra_izolata_nu_e_alba(self):
        m = BG.masoara(pe_alba(text_negru)); self.assertFalse(m['alba']); self.assertEqual(m['motiv'], 'pixeli_sub_128')

    def test_text_subtire_cateva_caractere_nu_e_alba(self):
        m = BG.masoara(pe_alba(text_subtire)); self.assertFalse(m['alba']); self.assertEqual(m['motiv'], 'pixeli_sub_128')

    def test_text_palid_fara_pixeli_intunecati_nu_e_alba(self):
        # (a) nu-l vede (niciun pixel < 128) și deviația rămâne mică: îl prind componentele ne-liniare (c)
        data = pe_alba(text_palid); im = Image.open(io.BytesIO(data)).convert('L')
        self.assertEqual(sum(im.histogram()[:128]), 0)
        m = BG.masoara(data); self.assertFalse(m['alba']); self.assertEqual(m['motiv'], 'cerneala_ne_liniara', m)

    def test_gri_uniform_nu_e_alba(self):
        m = BG.masoara(png(Image.new('L', (400, 100), 200))); self.assertFalse(m['alba'])

    def test_linie_palida_singura_e_alba_dar_praful_mult_nu(self):
        im = Image.new('L', (400, 200), 255); d = ImageDraw.Draw(im); d.line((100, 10, 100, 150), fill=200, width=2)
        self.assertTrue(BG.masoara(png(im))['alba'])
        for i in range(30): im.putpixel((200 + 3 * i, 100), 200)  # 30 de puncte izolate > 20 px de praf
        m = BG.masoara(png(im)); self.assertFalse(m['alba']); self.assertEqual(m['motiv'], 'praf_peste_prag')

    def test_hasura_deasa_de_linii_palide_nu_e_alba(self):
        # numai linii subțiri (c le-ar ignora), fără pixeli < 128: o hașură / grilă deasă nu e „margine albă” -> o oprește deviația (b)
        im = Image.new('L', (400, 200), 255); d = ImageDraw.Draw(im)
        for y in range(2, 200, 6): d.line((0, y, 399, y), fill=140, width=2)
        m = BG.masoara(png(im)); self.assertFalse(m['alba']); self.assertEqual(m['motiv'], 'deviatie')

    def test_imagine_nedecodabila_nu_e_alba(self):
        m = BG.masoara(b'nu e png'); self.assertFalse(m['alba']); self.assertTrue(m['motiv'].startswith('imagine_nedecodabila'))


class IesireGoala(unittest.TestCase):
    def test_conditiile_raspunsului(self):
        self.assertTrue(BG.iesire_goala('lighton', ' \n', GOL_LIGHTON))
        self.assertFalse(BG.iesire_goala('lighton', 'x', GOL_LIGHTON))
        self.assertFalse(BG.iesire_goala('lighton', '', dict(GOL_LIGHTON, finish_reason='length')))
        self.assertFalse(BG.iesire_goala('lighton', '', dict(GOL_LIGHTON, finish_reason=None)))
        self.assertFalse(BG.iesire_goala('lighton', '', dict(GOL_LIGHTON, signal='deadline')))
        self.assertFalse(BG.iesire_goala('lighton', '', dict(GOL_LIGHTON, guard_event={'reason': 'x'})))
        self.assertFalse(BG.iesire_goala('lighton', '', dict(GOL_LIGHTON, error='ReadTimeout')))
        self.assertTrue(BG.iesire_goala('mineru', '', GOL_MINERU))
        self.assertFalse(BG.iesire_goala('mineru', '', dict(GOL_MINERU, blocuri_cu_text=1)))
        self.assertFalse(BG.iesire_goala('mineru', '', dict(GOL_MINERU, blocuri_cu_text=None)))
        self.assertFalse(BG.iesire_goala('altul', '', GOL_LIGHTON))

    def test_aplica(self):
        r = BG.aplica('lighton', '', dict(GOL_LIGHTON), ALBA); self.assertEqual((r['ok'], r['banda_goala']), (True, True))
        r = BG.aplica('lighton', '', dict(GOL_LIGHTON), pe_alba(text_subtire))
        self.assertFalse(r['ok']); self.assertNotIn('banda_goala', r); self.assertFalse(r['banda_alba']['alba'])
        r = BG.aplica('lighton', 'text', {'ok': True}, ALBA); self.assertEqual(r, {'ok': True})  # citirile bune: neatinse


def fa_plan(root, imagini):
    """Plan real (load_plan) cu benzile date: imagini = [bytes]."""
    out = pathlib.Path(root) / 'plan'; bands = []
    for i, data in enumerate(imagini):
        bid = 'p0001_b%d' % i; img = out / 'page0001' / (bid + '.png'); img.parent.mkdir(parents=True, exist_ok=True); img.write_bytes(data)
        bands.append({'id': bid, 'page': 1, 'index': i, 'kind': 'continuous_text', 'image': 'page0001/%s.png' % bid,
                      'image_sha256': hashlib.sha256(data).hexdigest()})
    (out / 'plan.json').write_text(json.dumps({'status': 'plan_complete', 'input_sha256': 'x', 'pages': [{'page': 1, 'route': 'ocr'}],
                                               'bands': bands}), encoding='utf-8')
    return out


def cititor_fals(goale, gol, calls):
    """Răspunde gol (ca LightOn / MinerU real pe banda albă) pe imaginile din `goale`, text pe celelalte."""
    def f(data, o, cfg, dl):
        calls.append(o.parent.name); (o / 'request_started.json').write_text('{}')
        if data in goale: return '', dict(gol)
        return 'text pe %s' % o.parent.name, {'ok': True, 'finish_reason': 'stop', 'signal': None, 'guard_event': None, 'error': None}
    return f


def rezultat(out, bid, reader):
    return json.loads((out / 'page0001' / bid / reader / 'result.json').read_text(encoding='utf-8'))


class Citire(unittest.TestCase):
    def _ruleaza(self, imagini, goale, reader='lighton', gol=GOL_LIGHTON):
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        out = fa_plan(d.name, imagini); calls = []
        with patch.dict(RD.FUNCS, {reader: cititor_fals(goale, gol, calls)}):
            st = RD.run_reader(out, reader, run_id='t', check_weights=False, check_server=False, lock=False)
        return out, st, calls

    def test_banda_alba_goala_nu_opreste_documentul(self):
        text = pe_alba(text_subtire)
        for reader, gol in (('lighton', GOL_LIGHTON), ('mineru', GOL_MINERU)):
            out, st, calls = self._ruleaza([ALBA, text], {ALBA}, reader, gol)
            self.assertEqual(st['status'], 'complete', st); self.assertEqual(calls, ['p0001_b0', 'p0001_b1'])
            r = rezultat(out, 'p0001_b0', reader)
            self.assertEqual((r['ok'], r['banda_goala'], r['banda_alba']['alba']), (True, True, True))
            self.assertEqual((out / 'page0001' / 'p0001_b0' / reader / 'raw.txt').read_bytes(), b'')

    def scenariu_ne_alba(self):
        """Ieșire goală pe o bandă cu text subțire: eșec ca azi (oprire, fără reîncercare)."""
        out, st, calls = self._ruleaza([pe_alba(text_subtire), ALBA], {pe_alba(text_subtire)})
        self.assertEqual((st['status'], st.get('band'), calls), ('stopped_no_retry', 'p0001_b0', ['p0001_b0']))
        r = rezultat(out, 'p0001_b0', 'lighton'); self.assertIs(r['ok'], False); self.assertNotIn('banda_goala', r)
        self.assertEqual(r['banda_alba']['motiv'], 'pixeli_sub_128')

    def test_iesire_goala_pe_banda_ne_alba_ramane_esec(self):
        self.scenariu_ne_alba()

    def test_mutant_fara_verificarea_imaginii_e_prins(self):
        # mutantul cerut de brief: orice ieșire goală acceptată fără dovada din imagine -> scenariul de mai sus trebuie să pice
        with patch.object(BG, 'masoara', lambda data: {'alba': True, 'motiv': 'mutant'}):
            with self.assertRaises(AssertionError): self.scenariu_ne_alba()

    def test_iesire_goala_cu_finish_length_ramane_esec(self):
        out, st, _ = self._ruleaza([ALBA], {ALBA}, gol=dict(GOL_LIGHTON, finish_reason='length'))
        self.assertEqual(st['status'], 'stopped_no_retry'); self.assertIs(rezultat(out, 'p0001_b0', 'lighton')['ok'], False)

    def test_reluarea_refoloseste_banda_goala_doar_cu_dovada_curenta(self):
        out, st, _ = self._ruleaza([ALBA], {ALBA})
        with patch.dict(RD.FUNCS, {'lighton': lambda *a: self.fail('nu trebuia apelat')}):
            st = RD.run_reader(out, 'lighton', run_id='t2', check_weights=False, check_server=False, lock=False)
            self.assertEqual((st['status'], st['skipped_existing']), ('complete', 1))
            with patch.object(BG, 'masoara', lambda data: {'alba': False, 'motiv': 'regula_noua'}):
                st = RD.run_reader(out, 'lighton', run_id='t3', check_weights=False, check_server=False, lock=False)
            self.assertEqual(st['status'], 'interrupted_needs_review')


class CapCoada(unittest.TestCase):
    def test_citire_comparare_reconciliere_asamblare(self):
        """Calea reală: run_reader (ambii cititori) -> compare -> reconcile -> asamblare, cu banda albă reală între două benzi cu text."""
        from ocr_local.asamblare import asambleaza_document
        from ocr_local.compare import compare
        from ocr_local.reconcile import reconcile
        sus = pe_alba(text_subtire); jos = pe_alba(lambda d: d.text((300, 120), 'Total 7', fill=(0, 0, 0)))
        with tempfile.TemporaryDirectory() as root:
            out = fa_plan(root, [sus, ALBA, jos])
            texte = {sus: 'Cant. 12,5 mc', jos: 'Total 7'}
            def cititor(gol):
                def f(data, o, cfg, dl):
                    (o / 'request_started.json').write_text('{}')
                    if data == ALBA: return '', dict(gol)
                    return texte[data], {'ok': True, 'finish_reason': 'stop', 'signal': None, 'guard_event': None, 'error': None}
                return f
            with patch.dict(RD.FUNCS, {'lighton': cititor(GOL_LIGHTON), 'mineru': cititor(GOL_MINERU)}), \
                 patch.object(RD, 'verify_weights', lambda cfg: cfg['weights_sha256']):
                for reader in ('lighton', 'mineru'):
                    st = RD.run_reader(out, reader, run_id='t', check_server=False, lock=False); self.assertEqual(st['status'], 'complete')
            rez, items = compare(out)
            self.assertEqual((items, rez['per_band'][1]['structura']), ([], 'banda_goala'))
            (out / 'dec.jsonl').write_text('', encoding='utf-8')
            r = reconcile(out, out / 'dec.jsonl')['pages'][0]
            self.assertFalse(r['needs_human']); self.assertEqual(r['text'], 'Cant. 12,5 mc\nTotal 7')
            self.assertIn({'type': 'banda_goala_sarita', 'banda': 1}, r['semnale'])
            text, st = asambleaza_document(root, 'plan', pagini_native={1: ''})
            self.assertEqual(text, '⟦PAGINA 1⟧\nCant. 12,5 mc\nTotal 7'); self.assertEqual((st['benzi_goale'], st['cusaturi_nesigure']), (1, 0))

    def test_text_vid_fara_dovada_ramane_la_om(self):
        """Banda NE-albă la care ambii cititori scriu doar marcaje (text final vid): fără dovada imaginii nu se sare -> pagina la om."""
        from ocr_local.compare import compare
        from ocr_local.reconcile import reconcile
        sus, mij, jos = (pe_alba(lambda d, t=t: d.text((300, 120), t, fill=(0, 0, 0))) for t in ('Sus', 'Mijloc 5', 'Jos'))
        texte = {sus: 'Sus', mij: '<p></p>', jos: 'Jos'}
        def f(data, o, cfg, dl):
            (o / 'request_started.json').write_text('{}')
            return texte[data], {'ok': True, 'finish_reason': 'stop', 'signal': None, 'guard_event': None, 'error': None}
        with tempfile.TemporaryDirectory() as root:
            out = fa_plan(root, [sus, mij, jos])
            with patch.dict(RD.FUNCS, {'lighton': f, 'mineru': f}), patch.object(RD, 'verify_weights', lambda cfg: cfg['weights_sha256']):
                for reader in ('lighton', 'mineru'): RD.run_reader(out, reader, run_id='t', check_server=False, lock=False)
            self.assertEqual(compare(out)[1], [])
            (out / 'dec.jsonl').write_text('', encoding='utf-8')
            r = reconcile(out, out / 'dec.jsonl')['pages'][0]
            self.assertEqual((r['needs_human'], r['text']), (True, None))

    def test_goala_la_unul_decizia_omului(self):
        """Goală la LightOn, text la MinerU -> banda_intreaga; fără decizie pagina e la om; decizia „citirea goală” lipește vecinii,
        decizia „textul” intră în cusătura obișnuită."""
        from ocr_local.compare import compare
        from ocr_local.reconcile import reconcile
        sus = pe_alba(text_subtire); jos = pe_alba(lambda d: d.text((300, 120), 'Total 7', fill=(0, 0, 0)))
        texte = {sus: 'Cant. 12,5 mc', jos: 'Total 7'}
        def cititor(gol, pe_alba_text=None):
            def f(data, o, cfg, dl):
                (o / 'request_started.json').write_text('{}')
                if data == ALBA and pe_alba_text is None: return '', dict(gol)
                return texte.get(data, pe_alba_text), {'ok': True, 'finish_reason': 'stop', 'signal': None, 'guard_event': None, 'error': None}
            return f
        pol = {'modele_admise': ['claude-sonnet-5'], 'prompt_versiuni_admise': ['t1']}
        for decizie, asteptat in ((None, None), ('ales_lighton', 'Cant. 12,5 mc\nTotal 7')):
            with tempfile.TemporaryDirectory() as root:
                out = fa_plan(root, [sus, ALBA, jos])
                with patch.dict(RD.FUNCS, {'lighton': cititor(GOL_LIGHTON), 'mineru': cititor(GOL_MINERU, 'Fantoma 99')}), \
                     patch.object(RD, 'verify_weights', lambda cfg: cfg['weights_sha256']):
                    for reader in ('lighton', 'mineru'): RD.run_reader(out, reader, run_id='t', check_server=False, lock=False)
                _, items = compare(out)
                self.assertEqual([(i['id'], i['tip'], i['citire_lighton'], i['citire_mineru']) for i in items],
                                 [('p0001_b1_banda', 'banda_intreaga', '', 'Fantoma 99')])
                dec = [] if decizie is None else [{'id': items[0]['id'], 'item_sha256': items[0]['item_sha256'], 'decizie': decizie, 'text': '',
                                                   'motiv': 'verificat pe imagine', 'e_cantitate': False, 'anomalie_separator': False,
                                                   'arbitru_model': 'claude-sonnet-5', 'prompt_versiune': 't1'}]
                (out / 'dec.jsonl').write_text('\n'.join(json.dumps(x) for x in dec), encoding='utf-8')
                with patch('ocr_local.reconcile.arbiter_policy', return_value=pol):
                    r = reconcile(out, out / 'dec.jsonl')['pages'][0]
                self.assertEqual((r['needs_human'], r['text']), (asteptat is None, asteptat))


BAND = {'id': 'p0001_b0', 'page': 1, 'kind': 'continuous_text', 'image': 'page0001/p0001_b0.png', 'image_sha256': '0' * 64}
GOALA = {'ok': True, 'banda_goala': True}
TEXT = {'ok': True}


class Comparare(unittest.TestCase):
    def test_doua_benzi_goale_acord(self):
        s, its = compare_band(BAND, '', GOALA, '', GOALA)
        self.assertEqual((its, s['structura'], s['disagreements']), ([], 'banda_goala', 0))

    def test_goala_la_unul_text_la_celalalt_dezacord(self):
        for a, ra, b, rb, goala in (('', GOALA, 'Cant. 12,5', TEXT, 'lighton'), ('Cant. 12,5', TEXT, '', GOALA, 'mineru'),
                                    ('', GOALA, '<p></p>', TEXT, 'lighton')):  # și text fără segmente (doar marcaje)
            s, its = compare_band(BAND, a, ra, b, rb)
            self.assertEqual(len(its), 1); self.assertEqual(its[0]['tip'], 'banda_intreaga'); self.assertEqual(s['banda_goala'], [goala])
            self.assertEqual((its[0]['citire_lighton'], its[0]['citire_mineru']), (a, b))  # citirile brute, cum le cere BD-ul
            self.assertTrue(its[0]['motiv_pipeline'].startswith('banda goala la ' + goala))
        self.assertTrue(compare_band(BAND, '', GOALA, 'Cant. 12,5', TEXT)[1][0]['e_cantitate'])

    def test_marcaj_goala_cu_text_e_neconsistent(self):
        s, its = compare_band(BAND, 'x', GOALA, 'x', GOALA)
        self.assertEqual(its[0]['tip'], 'banda_intreaga'); self.assertIn('neconsistent', its[0]['motiv_pipeline'])

    def test_fara_marcaj_textele_goale_raman_regula_veche(self):
        # citire esuata la unul -> citire_incompleta ca inainte (banda goala nu acopera esecul celuilalt cititor)
        s, its = compare_band(BAND, '', GOALA, '', {'ok': False})
        self.assertEqual((s['structura'], its[0]['tip']), ('citire_incompleta', 'banda_intreaga'))


class Cusatura(unittest.TestCase):
    def test_banda_goala_dovedita_se_sare(self):
        sem = []; t = join_bands(['primul rand', '', 'al doilea'], sem, goale=frozenset({1}))
        self.assertEqual(t, 'primul rand\nal doilea')
        self.assertEqual(sem, [{'type': 'banda_goala_sarita', 'banda': 1}, {'type': 'cusatura_dupa_banda_goala', 'banda': 2}])
        self.assertEqual(join_bands(['', 'x'], [], goale=frozenset({0})), 'x'); self.assertEqual(join_bands(['', ''], [], goale=frozenset({0, 1})), '')

    def test_vecinii_cu_text_pastreaza_regula_de_suprapunere(self):
        rand = 'Nr 1 TSD04A1 Umplutura compactata 100mc 0,056'
        sem = []; t = join_bands(['sus\n' + rand, rand + '\njos', '', 'ultima'], sem, goale=frozenset({2}))
        self.assertEqual(t, 'sus\n' + rand + '\njos\nultima')
        self.assertEqual(sem[0], {'type': 'cusatura_suprapunere_taiata', 'banda': 1, 'randuri': 1})
        self.assertIsNone(join_bands(['sus', 'fara suprapunere', '', 'ultima'], [], goale=frozenset({2})))

    def test_text_gol_fara_dovada_ramane_cusatura_nesigura(self):
        self.assertIsNone(join_bands(['primul rand', '', 'al doilea'], []))
        self.assertIsNone(join_bands(['primul rand', '  ', 'al doilea'], [], goale=frozenset({0})))  # indicele altei benzi


class Asamblare(unittest.TestCase):
    def _banda(self, root, bid, citiri):
        d = pathlib.Path(root) / bid
        for reader, (raw, res) in citiri.items():
            (d / reader).mkdir(parents=True, exist_ok=True); (d / reader / 'raw.txt').write_bytes(raw.encode())
            (d / reader / 'result.json').write_text(json.dumps(dict(res, raw_sha256=hashlib.sha256(raw.encode()).hexdigest())))
        return bid, d

    def test_goala_la_ambii_se_sare_text_la_celalalt_intra(self):
        with tempfile.TemporaryDirectory() as root:
            b0 = self._banda(root, 'p1_b0', {'lighton': ('Sus pe pagina', TEXT)})
            b1 = self._banda(root, 'p1_b1', {'lighton': ('', GOALA), 'mineru': ('', GOALA)})
            b2 = self._banda(root, 'p1_b2', {'lighton': ('', GOALA), 'mineru': ('Cant. 12,5', TEXT)})
            st = stare_noua(); t = asambleaza_pagina([b0, b1, b2], st)
            self.assertEqual((st['benzi_goale'], st['lista_goale'], st['lista_din_mineru']), (1, ['p1_b1'], ['p1_b2']))
            self.assertEqual(t, 'Sus pe pagina\nCant. 12,5'); self.assertEqual((st['benzi_necitite'], st['cusaturi_nesigure']), (0, 0))


if __name__ == '__main__':
    unittest.main()
