"""Banda goală, runda 2 (25.11.2026, după Jakarinos #1196 NO-GO): ieșirea goală NU mai oprește documentul, dar nicio bandă nu se
mai acceptă automat ca „albă”: gol la oricare cititor = rând `banda_goala_de_verificat` la om, chiar și pe o bandă albă reală.
Offline: cititorii sunt falși, imaginile sunt reale. Fixtura `banda_alba_lot2.png` = copia exactă a benzii p0001_b0 din coada Lot 2
(margine albă cu două linii verticale palide), cu SHA-256-ul din planul real. Rulare: PYTHONPATH=scripts python -m pytest scripts/ocr_local/tests"""
import functools
import hashlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont

import ocr_local.compare as CMP
from ocr_local import banda_goala as BG
from ocr_local import read as RD
from ocr_local.asamblare import MARCAJ_GOL, asambleaza_pagina, stare_noua
from ocr_local.compare import compare_band
from ocr_local.reconcile import join_bands

HERE = pathlib.Path(__file__).parent
ALBA = (HERE / 'banda_alba_lot2.png').read_bytes()
SHA_ALBA_PLAN = '4532186ac468ef4aef247bf2aeb214e85b475e97b15b8d2175e6649b31257ed5'  # image_sha256 din planurile L2_148 / L2_175 / L2_176
GOL_LIGHTON = {'ok': False, 'finish_reason': 'stop', 'signal': None, 'guard_event': None, 'error': None,
               'usage': {'prompt_tokens': 687, 'total_tokens': 688, 'completion_tokens': 1}}  # răspunsul real din coadă
GOL_MINERU = {'ok': False, 'signal': None, 'guard_event': None, 'error': None, 'blocks': 0, 'blocuri_cu_text': 0}
GOL = {'lighton': GOL_LIGHTON, 'mineru': GOL_MINERU}
TEXT_OK = {'ok': True, 'finish_reason': 'stop', 'signal': None, 'guard_event': None, 'error': None}


def png(im):
    buf = io.BytesIO(); im.save(buf, format='PNG'); return buf.getvalue()


def font(size):
    try: return ImageFont.truetype('arial.ttf', size), True
    except OSError: return ImageFont.load_default(size=size), False


ARIAL = font(10)[1]


def pe_alba(desen):
    """Banda albă reală + un desen peste ea."""
    im = Image.open(io.BytesIO(ALBA)).convert('RGB'); desen(ImageDraw.Draw(im)); return png(im)


# contraexemplele din verdictul Jakarinos (r1): euristica pe pixeli le socotea albe -> două ieșiri goale deveneau acord
GRI_245 = pe_alba(lambda d: d.text((300, 120), 'Cant. 12,5 mc - TOTAL 1250', font=font(24)[0], fill=(245, 245, 245)))
III_200 = pe_alba(lambda d: d.text((300, 120), 'III', font=font(20)[0], fill=(200, 200, 200)))
TEXT_NEGRU = pe_alba(lambda d: d.text((300, 120), 'Cant. 12,5 mc', fill=(0, 0, 0)))
CAZURI = {'gri_245': GRI_245, 'III_200': III_200, 'alba_reala': ALBA, 'text_negru': TEXT_NEGRU}


def gol_marcat(reader, image):
    """Rezultatul real al unei ieșiri goale după read.run_reader(gol_de_verificat=True)."""
    res = dict(GOL[reader]); assert BG.marcheaza(reader, '', res, image); return res


class Imagine(unittest.TestCase):
    """Euristica pe pixeli rămâne DOAR informație (probabil_alba)."""
    def test_fixtura_e_banda_reala(self):
        self.assertEqual(hashlib.sha256(ALBA).hexdigest(), SHA_ALBA_PLAN)

    def test_banda_alba_reala_pare_alba(self):
        m = BG.masoara(ALBA); self.assertTrue(m['alba'], m); self.assertEqual(m['pixeli_intunecati'], 0)

    @unittest.skipUnless(ARIAL, 'contraexemplele din verdict sunt cu Arial')
    def test_contraexemplele_par_albe_de_aceea_euristica_nu_decide(self):
        # reproducerea din verdict: textul gri 245 și „III” gri 200 trec de euristică -> ea nu poate fi decizie
        self.assertTrue(BG.masoara(GRI_245)['alba']); self.assertTrue(BG.masoara(III_200)['alba'])

    def test_text_negru_nu_pare_alb(self):
        self.assertFalse(BG.masoara(TEXT_NEGRU)['alba'])

    def test_imagine_nedecodabila(self):
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

    def test_marcheaza_orice_imagine_ok_ramane_false(self):
        for nume, img in CAZURI.items():
            r = gol_marcat('lighton', img)
            self.assertEqual((r['ok'], r['gol_de_verificat']), (False, True), nume)
            self.assertEqual(r['banda_alba']['alba'], BG.masoara(img)['alba'], nume)  # doar informație
            self.assertTrue(BG.e_gol('', r)); self.assertFalse(BG.e_gol('x', r)); self.assertFalse(BG.e_gol('', dict(r, ok=True)))
        r = dict(TEXT_OK); self.assertFalse(BG.marcheaza('lighton', 'text', r, ALBA)); self.assertEqual(r, TEXT_OK)


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


def cititor(reader, goale, calls=None, texte=None, gol=None):
    """Răspunde gol (ca LightOn / MinerU real) pe imaginile din `goale`, text pe celelalte."""
    def f(data, o, cfg, dl):
        if calls is not None: calls.append(o.parent.name)
        (o / 'request_started.json').write_text('{}')
        if data in goale: return '', dict(gol or GOL[reader])
        return (texte or {}).get(data, 'text pe %s' % o.parent.name), dict(TEXT_OK)
    return f


def rezultat(out, bid, reader):
    return json.loads((out / 'page0001' / bid / reader / 'result.json').read_text(encoding='utf-8'))


class Citire(unittest.TestCase):
    def _ruleaza(self, imagini, goale, reader='lighton', gol=None, **kw):
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        out = fa_plan(d.name, imagini); calls = []
        with patch.dict(RD.FUNCS, {reader: cititor(reader, goale, calls, gol=gol)}):
            st = RD.run_reader(out, reader, run_id='t', check_weights=False, check_server=False, lock=False, **kw)
        return out, st, calls

    def test_iesirea_goala_pe_orice_imagine_nu_opreste_documentul(self):
        for nume, img in CAZURI.items():
            for reader in ('lighton', 'mineru'):
                out, st, calls = self._ruleaza([img, TEXT_NEGRU if img != TEXT_NEGRU else ALBA], {img}, reader, gol_de_verificat=True)
                self.assertEqual((st['status'], calls), ('complete', ['p0001_b0', 'p0001_b1']), (nume, reader, st))
                r = rezultat(out, 'p0001_b0', reader)
                self.assertEqual((r['ok'], r['gol_de_verificat']), (False, True), (nume, reader))
                self.assertEqual(st['benzi_goale'], [{'band': 'p0001_b0', 'page': 1, 'image': 'page0001/p0001_b0.png',
                                                      'probabil_alba': BG.masoara(img)['alba']}])
                self.assertEqual((out / 'page0001' / 'p0001_b0' / reader / 'raw.txt').read_bytes(), b'')

    def test_fara_parametru_comportamentul_de_azi(self):
        # implicit (E3, clientul Ofertare): ieșirea goală rămâne eșec, fără marcaj, chiar și pe banda albă reală
        out, st, calls = self._ruleaza([ALBA, TEXT_NEGRU], {ALBA})
        self.assertEqual((st['status'], st.get('band'), calls), ('stopped_no_retry', 'p0001_b0', ['p0001_b0']))
        self.assertNotIn('benzi_goale', st); r = rezultat(out, 'p0001_b0', 'lighton')
        self.assertIs(r['ok'], False); self.assertNotIn('gol_de_verificat', r); self.assertNotIn('banda_alba', r)

    def test_iesire_goala_necurata_ramane_esec(self):
        out, st, _ = self._ruleaza([ALBA], {ALBA}, gol=dict(GOL_LIGHTON, finish_reason='length'), gol_de_verificat=True)
        self.assertEqual(st['status'], 'stopped_no_retry'); self.assertNotIn('gol_de_verificat', rezultat(out, 'p0001_b0', 'lighton'))

    def test_reluarea_documentului_oprit_de_codul_vechi(self):
        # documentele Lot 2 oprite înainte: rezultatul gol vechi (fără marcaj) se marchează la reluare, fără recitire; banda
        # următoare se citește; fără parametru rămâne blocat ca pe main
        out, st, calls = self._ruleaza([ALBA, TEXT_NEGRU], {ALBA})
        self.assertEqual((st['status'], calls), ('stopped_no_retry', ['p0001_b0']))
        calls2 = []
        with patch.dict(RD.FUNCS, {'lighton': cititor('lighton', {ALBA}, calls2)}):
            st = RD.run_reader(out, 'lighton', run_id='t2', check_weights=False, check_server=False, lock=False)
            self.assertEqual((st['status'], calls2), ('interrupted_needs_review', []))
            self.assertNotIn('gol_de_verificat', rezultat(out, 'p0001_b0', 'lighton'))
            st = RD.run_reader(out, 'lighton', run_id='t3', check_weights=False, check_server=False, lock=False, gol_de_verificat=True)
        self.assertEqual((st['status'], st['skipped_existing'], calls2), ('complete', 1, ['p0001_b1']))
        r = rezultat(out, 'p0001_b0', 'lighton')
        self.assertEqual((r['ok'], r['gol_de_verificat'], r['gol_marcat_la_reluare']), (False, True, 't3'))
        # un rezultat vechi NECURAT (ex. finish_reason length) nu se marchează: rămâne blocat
        out, st, _ = self._ruleaza([ALBA], {ALBA}, gol=dict(GOL_LIGHTON, finish_reason='length'))
        st = RD.run_reader(out, 'lighton', run_id='t4', check_weights=False, check_server=False, lock=False, gol_de_verificat=True)
        self.assertEqual(st['status'], 'interrupted_needs_review')

    def test_reluarea(self):
        out, st, _ = self._ruleaza([GRI_245], {GRI_245}, gol_de_verificat=True)
        with patch.dict(RD.FUNCS, {'lighton': lambda *a: self.fail('nu trebuia apelat')}):
            st = RD.run_reader(out, 'lighton', run_id='t2', check_weights=False, check_server=False, lock=False, gol_de_verificat=True)
            self.assertEqual((st['status'], st['skipped_existing'], len(st['benzi_goale'])), ('complete', 1, 1))
            st = RD.run_reader(out, 'lighton', run_id='t3', check_weights=False, check_server=False, lock=False)  # calea veche
            self.assertEqual(st['status'], 'interrupted_needs_review')
            (out / 'page0001' / 'p0001_b0' / 'lighton' / 'raw.txt').write_bytes(b'x')  # raw schimbat = rezultat incompatibil
            st = RD.run_reader(out, 'lighton', run_id='t4', check_weights=False, check_server=False, lock=False, gol_de_verificat=True)
            self.assertEqual(st['status'], 'interrupted_needs_review')


BAND = {'id': 'p0001_b0', 'page': 1, 'kind': 'continuous_text', 'image': 'page0001/p0001_b0.png', 'image_sha256': '0' * 64}


def verifica_doua_goluri(cb):
    """Contraexemplele + banda albă reală, gol la ambii cititori: un rând banda_goala_de_verificat, niciodată acord."""
    for nume, img in CAZURI.items():
        s, its = cb(BAND, '', gol_marcat('lighton', img), '', gol_marcat('mineru', img))
        assert len(its) == 1 and its[0]['tip'] == 'banda_goala_de_verificat', (nume, s, its)
        assert s['disagreements'] == 1 and its[0]['gol_la'] == ['lighton', 'mineru'] and its[0]['celalalt'] is None, nume
        assert (its[0]['band'], its[0]['page'], its[0]['image']) == ('p0001_b0', 1, 'page0001/p0001_b0.png'), nume
        assert its[0]['probabil_alba'] is BG.masoara(img)['alba'], nume  # informație, fără efect asupra deciziei


class Comparare(unittest.TestCase):
    def test_doua_goluri_dezacord_de_verificat(self):
        verifica_doua_goluri(compare_band)
        its = compare_band(BAND, '', gol_marcat('lighton', ALBA), '', gol_marcat('mineru', ALBA))[1]
        self.assertIs(its[0]['probabil_alba'], True)  # banda albă reală: tot la om, doar cu informația „probabil albă”
        self.assertTrue(its[0]['e_cantitate'])

    def test_mutant_acord_la_doua_goluri_e_prins(self):
        src = pathlib.Path(CMP.__file__).read_text(encoding='utf-8').replace('\r\n', '\n')
        tinta = '    if ga or gb:\n'
        self.assertEqual(src.count(tinta), 1)
        src = src.replace(tinta, "    if ga and gb: return {'band': band['id'], 'structura': 'aceeasi', 'disagreements': 0}, []\n" + tinta)
        m = importlib.util.module_from_spec(importlib.util.spec_from_loader('ocr_local._compare_mutant', loader=None))
        m.__package__ = 'ocr_local'; exec(compile(src, 'compare_mutant.py', 'exec'), m.__dict__)
        with self.assertRaises(AssertionError): verifica_doua_goluri(m.compare_band)

    def test_gol_la_unul_text_sau_incomplet_la_celalalt(self):
        for img in CAZURI.values():
            s, its = compare_band(BAND, '', gol_marcat('lighton', img), 'Cant. 12,5', TEXT_OK)
            self.assertEqual([(i['tip'], i['gol_la']) for i in its], [('banda_goala_de_verificat', ['lighton'])])
            self.assertEqual(its[0]['celalalt'], {'cititor': 'mineru', 'stare': 'text', 'text': 'Cant. 12,5', 'signal': None, 'error': None})
            self.assertEqual((its[0]['citire_lighton'], its[0]['citire_mineru']), ('', 'Cant. 12,5'))
        its = compare_band(BAND, 'abc', dict(TEXT_OK, ok=False, signal='bucla'), '', gol_marcat('mineru', ALBA))[1]
        self.assertEqual((its[0]['gol_la'], its[0]['celalalt']['stare'], its[0]['celalalt']['cititor']), (['mineru'], 'incomplet', 'lighton'))

    def test_marcaj_neconsistent_ramane_la_om(self):
        r = gol_marcat('lighton', ALBA)
        for raw, res in (('x', r), ('', dict(r, ok=True))):  # text nevid sau ok = True cu marcajul gol
            for a, b in (((raw, res), (raw, res)), ((raw, res), ('', {'ok': True})), (('', {'ok': True}), (raw, res))):  # la unul / la ambii
                s, its = compare_band(BAND, a[0], a[1], b[0], b[1])
                self.assertEqual((s['structura'], its[0]['tip']), ('citire_incompleta', 'banda_intreaga'), (a, b))

    def test_fara_marcaj_regula_veche(self):
        self.assertEqual(compare_band(BAND, '', {'ok': True}, '', {'ok': True})[1], [])  # ca pe main (citiri ok, vide)
        self.assertEqual(compare_band(BAND, '', {'ok': False}, '', {'ok': False})[1][0]['tip'], 'banda_intreaga')


class CaleaLaboratorului(unittest.TestCase):
    """run_reader (ambii cititori, gol_de_verificat) -> compare -> reconcile -> asamblare, cu banda goală între două benzi cu text."""
    POL = {'modele_admise': ['claude-sonnet-5'], 'prompt_versiuni_admise': ['t1']}

    def _citeste(self, root, mij, gol_la=('lighton', 'mineru'), text_mineru='Fantoma 99'):
        from ocr_local.compare import compare
        sus = pe_alba(lambda d: d.text((300, 120), 'Sus', fill=(0, 0, 0))); jos = pe_alba(lambda d: d.text((300, 120), 'Total 7', fill=(0, 0, 0)))
        out = fa_plan(root, [sus, mij, jos]); texte = {sus: 'Cant. 12,5 mc', jos: 'Total 7', mij: text_mineru}
        with patch.dict(RD.FUNCS, {r: cititor(r, {mij} if r in gol_la else set(), texte=texte) for r in ('lighton', 'mineru')}), \
             patch.object(RD, 'verify_weights', lambda cfg: cfg['weights_sha256']):
            for reader in ('lighton', 'mineru'):
                st = RD.run_reader(out, reader, run_id='t', check_server=False, lock=False, gol_de_verificat=True)
                self.assertEqual(st['status'], 'complete')
        return out, compare(out)

    def _reconciliaza(self, out, dec):
        from ocr_local.reconcile import reconcile
        (out / 'dec.jsonl').write_text('\n'.join(json.dumps(x) for x in dec), encoding='utf-8')
        with patch('ocr_local.reconcile.arbiter_policy', return_value=self.POL):
            return reconcile(out, out / 'dec.jsonl')['pages'][0]

    def test_doua_goluri_merg_la_om_pe_toate_cazurile(self):
        from ocr_local.asamblare import asambleaza_document
        for nume, img in CAZURI.items():
            if img == TEXT_NEGRU: continue
            with tempfile.TemporaryDirectory() as root:
                out, (rez, items) = self._citeste(root, img)
                self.assertEqual([(i['id'], i['tip']) for i in items], [('p0001_b1_gol', 'banda_goala_de_verificat')], nume)
                self.assertEqual((rez['disagreements'], rez['per_tip']), (1, {'banda_goala_de_verificat': 1}))
                self.assertEqual([json.loads(l)['tip'] for l in (out / 'dezacorduri.jsonl').read_text(encoding='utf-8').splitlines()],
                                 ['banda_goala_de_verificat'])
                r = self._reconciliaza(out, [])  # fără decizie: pagina la om
                self.assertEqual((r['needs_human'], r['text']), (True, None), nume)
                text, st = asambleaza_document(root, 'plan', pagini_native={1: ''})
                self.assertIn(MARCAJ_GOL % 'p0001_b1', text); self.assertEqual(st['lista_goale_de_verificat'], ['p0001_b1'])

    def test_decizia_arbitrului_nu_rezolva_banda_goala(self):
        with tempfile.TemporaryDirectory() as root:
            out, (_, items) = self._citeste(root, ALBA)
            dec = [{'id': items[0]['id'], 'item_sha256': items[0]['item_sha256'], 'decizie': 'ales_lighton', 'text': '',
                    'motiv': 'verificat pe imagine: banda e goala', 'e_cantitate': False, 'anomalie_separator': False,
                    'arbitru_model': 'claude-sonnet-5', 'prompt_versiune': 't1'}]
            r = self._reconciliaza(out, dec)
            self.assertEqual(r['needs_human'], True)  # arbitrul automat nu poate inchide o banda goala: ramane la om

    def test_gol_la_unul_text_la_celalalt(self):
        with tempfile.TemporaryDirectory() as root:
            out, (_, items) = self._citeste(root, GRI_245, gol_la=('lighton',))
            self.assertEqual([(i['tip'], i['celalalt']['text']) for i in items], [('banda_goala_de_verificat', 'Fantoma 99')])
            self.assertEqual(self._reconciliaza(out, [])['needs_human'], True)


class E3Neschimbat(unittest.TestCase):
    """E3 (avizele) apelează run_reader fără parametru: ieșirea goală rămâne eșec, exact ca pe main."""
    def _e3(self, reader, run_reader=None):
        from ocr_local.e3_read import _reader_process
        class Conn:
            def send(self, value): self.value = value
            def close(self): pass
        with tempfile.TemporaryDirectory() as root:
            out = fa_plan(root, [ALBA]); conn = Conn()
            with patch.dict(RD.FUNCS, {reader: cititor(reader, {ALBA})}), patch.object(RD, 'protocol', RD.protocol), \
                 patch.object(RD, 'run_reader', run_reader or RD.run_reader):
                _reader_process(out, reader, 20, conn)
            return conn.value, rezultat(out, 'p0001_b0', reader)

    def verifica(self, run_reader=None):
        for reader in ('lighton', 'mineru'):
            val, r = self._e3(reader, run_reader)
            assert val == (None, 'intern'), (reader, val)
            assert r['ok'] is False and 'gol_de_verificat' not in r and 'banda_alba' not in r, (reader, r)

    def test_gol_in_e3_e_esec(self):
        self.verifica()

    def test_mutant_e3_cu_parametrul_pornit_e_prins(self):
        with self.assertRaises(AssertionError): self.verifica(functools.partial(RD.run_reader, gol_de_verificat=True))


class Cusatura(unittest.TestCase):
    def test_banda_goala_decisa_se_sare(self):
        sem = []; t = join_bands(['primul rand', '', 'al doilea'], sem, goale=frozenset({1}))
        self.assertEqual(t, 'primul rand\nal doilea')
        self.assertEqual(sem, [{'type': 'banda_goala_sarita', 'banda': 1}, {'type': 'cusatura_dupa_banda_goala', 'banda': 2}])

    def test_text_gol_fara_marcaj_ramane_cusatura_nesigura(self):
        self.assertIsNone(join_bands(['primul rand', '', 'al doilea'], []))


class Asamblare(unittest.TestCase):
    def _banda(self, root, bid, citiri):
        d = pathlib.Path(root) / bid
        for reader, (raw, res) in citiri.items():
            (d / reader).mkdir(parents=True, exist_ok=True); (d / reader / 'raw.txt').write_bytes(raw.encode())
            (d / reader / 'result.json').write_text(json.dumps(dict(res, raw_sha256=hashlib.sha256(raw.encode()).hexdigest())))
        return bid, d

    def test_goala_la_ambii_marcaj_text_la_celalalt_intra(self):
        with tempfile.TemporaryDirectory() as root:
            b0 = self._banda(root, 'p1_b0', {'lighton': ('Sus pe pagina', TEXT_OK)})
            b1 = self._banda(root, 'p1_b1', {'lighton': ('', gol_marcat('lighton', ALBA)), 'mineru': ('', gol_marcat('mineru', ALBA))})
            b2 = self._banda(root, 'p1_b2', {'lighton': ('', gol_marcat('lighton', GRI_245)), 'mineru': ('Cant. 12,5', TEXT_OK)})
            st = stare_noua(); t = asambleaza_pagina([b0, b1, b2], st)
            self.assertEqual((st['benzi_goale_de_verificat'], st['lista_goale_de_verificat'], st['lista_din_mineru']),
                             (2, ['p1_b1', 'p1_b2'], ['p1_b2']))
            self.assertEqual(t, 'Sus pe pagina\n' + MARCAJ_GOL % 'p1_b1' + '\nCant. 12,5')
            self.assertEqual((st['benzi_necitite'], st['cusaturi_nesigure']), (0, 1))  # marcajul nu se coase tăcut


if __name__ == '__main__':
    unittest.main()
