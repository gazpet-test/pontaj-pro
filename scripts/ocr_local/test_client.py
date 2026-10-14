"""Teste CPU pentru client.py (fara retea): python -B -m unittest ocr_local.test_client -v (PYTHONPATH=scripts).
Edge-urile sunt simulate de FakeEdge, care reface verificarile BD relevante pentru client (acoperirea planului, benzile si imaginile
planului, proveniența dezacordului = item-ul exact cu amprenta lui, amprenta manifestului de comparatie, starile rularii)."""
import hashlib, io, json, os, pathlib, re, tempfile, unittest
from unittest.mock import patch
from PIL import Image, ImageDraw
from . import client as C
from . import read as RD
from .compare import item_hash

DOC = 1247

def lines_png():
    im = Image.new('RGB', (500, 900), 'white'); d = ImageDraw.Draw(im)
    for y in range(25, 870, 24): d.rectangle((60, y, 430, y + 5), fill='black')
    b = io.BytesIO(); im.save(b, format='PNG'); return b.getvalue()

def pdf_bytes():
    import fitz
    pdf = fitz.open(); pg = pdf.new_page(); pg.insert_image(pg.rect, stream=lines_png()); pdf.new_page()  # p1 cu „text”, p2 alba (exclusa)
    b = pdf.tobytes(); pdf.close(); return b

class FakeEdge:
    def __init__(self, pdf, arbitru=None):
        self.pdf, self.calls, self.stare, self.plan, self.pagini, self.dez = pdf, [], 'ceruta', None, {}, {}
        self.arbitru = arbitru or (lambda it: (200, {'decizie': {'id': it['id'], 'item_sha256': it['item_sha256'], 'decizie': 'ales_mineru', 'text': it['citire_mineru'],
                                                                 'motiv': 't', 'e_cantitate': False, 'anomalie_separator': False, 'arbitru_model': 'claude-sonnet-5',
                                                                 'prompt_versiune': 'arb-v1', 'cost_usd': 0.01}, 'arbitraj_id': 1}))
        self.documente = [{'document_id': DOC, 'pagini': [1, 2]}]; self.om = set(); self.cade_dupa = None; self.comp = None
    def ops(self, op): return [a for f, c in self.calls if f == 'ofertare-ocr-scrie' and c['op'] == op for a in [c['args']]]
    def get(self, url, dest, max_octeti=0, timeout=0):
        dest.write_bytes(self.pdf); return hashlib.sha256(self.pdf).hexdigest(), len(self.pdf)
    def post(self, fn, corp, timeout=60):
        status, j = self._post(fn, corp, timeout)
        if self.cade_dupa and status == 200 and fn == 'ofertare-ocr-scrie' and self.cade_dupa in (corp['op'], corp['args'].get('stare')):
            self.cade_dupa = None; raise ConnectionResetError('cadere simulata dupa commit')  # BD a aplicat, raspunsul se pierde
        return status, j
    def _post(self, fn, corp, timeout=60):
        self.calls.append((fn, corp))
        if fn == 'ofertare-pdf-link': return 200, {'url': C.SEMNAT + 'licitatii/x.pdf?token=t', 'expira_in_sec': 300, 'document_id': corp['document_id']}
        if fn == 'ofertare-ocr-arbitreaza':
            it = corp['item']
            assert item_hash(it) == it['item_sha256'] and self.dez[it['id']][0] == corp['dezacord_id']
            assert hashlib.sha256(__import__('base64').b64decode(corp['imagine_b64'])).hexdigest() == it['image_sha256']
            if self.stare != 'citita': return 402, {'error': 'Rularea nu e în citita', 'refuz': 'stare'}
            return self.arbitru(it)
        op, a = corp['op'], corp['args']
        if op == 'heartbeat': return 200, {'ok': True, 'rezultat': True}
        if op == 'preia':
            if self.stare != 'ceruta': return 200, {'ok': True, 'rezultat': {'rulare': None}}
            self.stare = 'preluata'; return 200, {'ok': True, 'rezultat': {'rulare': {'id': 7, 'licitatie_id': 102, 'documente': self.documente, 'plafon_usd': 15}}}
        if op == 'plan':
            if self.plan is not None: return 409, {'error': 'Planul se pune o singură dată, în preluata'}
            assert sorted((e['document_id'], e['pagina']) for e in a['plan']) == sorted((x['document_id'], p) for x in self.documente for p in x['pagini'])
            self.plan = {(e['document_id'], e['pagina']): e for e in a['plan']}; return 200, {'ok': True, 'rezultat': {'ok': True}}
        if op == 'pagina':
            e = self.plan[(a['document_id'], a['pagina'])]
            assert hashlib.sha256(a['text'].encode()).hexdigest() == a['raw_sha256']
            if a['cititor'] == 'reconciliat': assert self.stare == 'arbitrata' and a['banda'] is None
            elif e['exclus']: assert self.stare == 'preluata' and a['banda'] == 0 and a['garda']['motiv_excludere'] == e['exclus'] and a['stare'] == 'exclus'
            else:
                assert self.stare == 'preluata' and {'banda': a['banda'], 'image_sha256': a['image_sha256']} in e['benzi']
                assert (a['stare'] == 'citit') == (a['segmente'] is not None)
            k = (a['document_id'], a['pagina'], a['banda'], a['cititor']); deja = k in self.pagini
            if deja and self.pagini[k] != a: return 409, {'error': 'append-only'}
            self.pagini[k] = a; return 200, {'ok': True, 'rezultat': {'ok': True, 'deja': deja, 'id': len(self.pagini)}}
        if op == 'dezacord':
            d = a['dezacord']; assert self.stare == 'citita' and re.match(r'^p[0-9]{4}_b[0-9]{1,2}_[a-z0-9_]{1,30}$', d['item_id'])
            assert d['document_id'] == DOC and d['pagina'] == d['page'] and d['item_id'] == d['id']
            self.dez.setdefault(d['item_id'], (len(self.dez) + 1, d)); return 200, {'ok': True, 'rezultat': {'ok': True, 'id': self.dez[d['item_id']][0]}}
        if op == 'comparatie_gata':
            linii = sorted('%d|%d|%s|%s\n' % (d['document_id'], d['pagina'], d['item_id'], d['item_sha256']) for _, d in self.dez.values())
            assert a['nr'] == len(self.dez) and a['sha256'] == hashlib.sha256(''.join(linii).encode()).hexdigest()
            if self.comp is not None or self.stare != 'citita': return 409, {'error': 'Marcajul se pune o singură dată, în citita'}
            self.comp = {'nr': a['nr'], 'sha256': a['sha256']}; return 200, {'ok': True, 'rezultat': {'ok': True}}
        if op == 'needs_human':
            if a['dezacord_id'] in self.om: return 409, {'error': 'Dezacord deja arbitrat'}
            self.om.add(a['dezacord_id']); return 200, {'ok': True, 'rezultat': {'ok': True}}
        if op == 'stare':
            ok = {('preluata', 'citita'), ('citita', 'arbitrata'), ('arbitrata', 'finalizata')}
            if (self.stare, a['stare']) not in ok and not (a['stare'] in ('oprita', 'esuata') and self.stare in ('preluata', 'citita', 'arbitrata')):
                return 409, {'error': 'Tranziție nepermisă %s → %s' % (self.stare, a['stare'])}
            self.stare = a['stare']; return 200, {'ok': True, 'rezultat': {'ok': True}}
        if op == 'stare_rulare':
            if a['rulare_id'] != 7: return 200, {'ok': True, 'rezultat': {'exista': False}}
            return 200, {'ok': True, 'rezultat': {'exista': True, 'id': 7, 'stare': self.stare, 'comparatie_nr': (self.comp or {}).get('nr'),
                                                  'comparatie_sha256': (self.comp or {}).get('sha256'),
                                                  'plan_sha256': C.plan_sha(list(self.plan.values())) if self.plan else None}}
        if op == 'rulari_active':
            act = [] if self.stare not in ('preluata', 'citita', 'arbitrata') else [{'id': 7, 'licitatie_id': 102, 'stare': self.stare, 'documente': self.documente,
                                                                                       'plafon_usd': 15, 'protocol': RD.protocol()['version'], 'are_plan': self.plan is not None}]
            return 200, {'ok': True, 'rezultat': act}
        return 400, {'error': 'Operație necunoscută'}

def scrie_citiri(rdir, text_a, text_b, ok_b=True, doc=DOC, mineru=True):
    from .plan import load_plan
    d = rdir / ('d%d' % doc); proto = RD.protocol(); cititori = [('lighton', text_a, True)] + ([('mineru', text_b, ok_b)] if mineru else [])
    for reader, _, ok in cititori:
        (d / ('read_%s.json' % reader)).write_text(json.dumps({'status': 'complete' if ok else 'stopped_no_retry'}))
    for b in load_plan(d)['bands']:
        for reader, raw, ok in cititori:
            o = d / ('page%04d' % b['page']) / b['id'] / reader; o.mkdir(parents=True, exist_ok=True)
            (o / 'raw.txt').write_bytes(raw.encode('utf-8'))
            (o / 'result.json').write_text(json.dumps({'ok': ok, 'reader': reader, 'protocol': proto['version'], 'weights_sha256': proto['readers'][reader]['weights_sha256'],
                                                       'image_sha256': b['image_sha256'], 'raw_sha256': hashlib.sha256(raw.encode()).hexdigest(),
                                                       'signal': None if ok else 'deadline'}))

class Client(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); self.work = pathlib.Path(self.tmp.name)
        self.edge = FakeEdge(pdf_bytes())
    def pana_la_plan(self):
        r = C.preia(self.work, self.edge); rdir = pathlib.Path(r['dir'])
        C.descarca(rdir, self.edge); C.foaie(rdir)
        (rdir / 'orientare' / ('%d.json' % DOC)).write_text('{"1": 0, "2": 0}', encoding='utf-8')
        C.plan_rulare(rdir, self.edge); return rdir

    def test_secret_format_si_mesaj_fara_valoare(self):
        with patch.dict(os.environ, {'OCR_LOCAL_SECRET': 'a' * 64}): self.assertEqual(C.citeste_secret('/nu/exista'), 'a' * 64)
        with patch.dict(os.environ, {'OCR_LOCAL_SECRET': 'secret-scurt'}):
            with self.assertRaises(ValueError) as e: C.citeste_secret('/nu/exista')
            self.assertNotIn('secret-scurt', str(e.exception))
        f = self.work / 's.txt'; f.write_text('b' * 64 + '\n')
        with patch.dict(os.environ, {}, clear=True): self.assertEqual(C.citeste_secret(f), 'b' * 64)
    def test_fara_redirect_fara_proxy(self):
        self.assertIsNone(C._FaraRedirect().redirect_request(None, None, 302, 'x', {}, 'https://evil'))
        handlers = {type(h).__name__ for h in C.opener().handlers}
        self.assertIn('_FaraRedirect', handlers); self.assertNotIn('HTTPRedirectHandler', handlers)
    def test_url_semnat_strain_refuzat(self):
        r = C.preia(self.work, self.edge); rdir = pathlib.Path(r['dir'])
        self.edge.post = lambda fn, corp, timeout=60: (200, {'url': 'https://evil.example/x.pdf', 'document_id': DOC})
        self.edge.get = lambda *a, **k: self.fail('nu trebuia descarcat')
        with self.assertRaises(ValueError): C.descarca(rdir, self.edge)
    def test_preia_fara_rulare(self):
        C.preia(self.work, self.edge); self.assertEqual(C.preia(self.work, self.edge), {'rulare': None, 'nota': 'nicio rulare ceruta'})
    def test_orientare_necompletata_refuzata(self):
        r = C.preia(self.work, self.edge); rdir = pathlib.Path(r['dir']); C.descarca(rdir, self.edge); C.foaie(rdir)
        self.assertEqual(json.loads((rdir / 'orientare' / ('%d.DE_COMPLETAT.json' % DOC)).read_text()), {'1': None, '2': None})
        (rdir / 'orientare' / ('%d.json' % DOC)).write_text('{"1": null, "2": 0}', encoding='utf-8')
        with self.assertRaises(ValueError): C.plan_rulare(rdir, self.edge)
        self.assertFalse(self.edge.ops('plan'))
    def test_plan_manifest_si_reluare(self):
        rdir = self.pana_la_plan(); m = self.edge.ops('plan')[0]['plan']
        p1, p2 = sorted(m, key=lambda e: e['pagina'])
        self.assertEqual(p2['exclus'], 'exclus_neclasificat'); self.assertNotIn('benzi', p2)
        self.assertIsNone(p1['exclus']); self.assertTrue(p1['benzi'])
        self.assertEqual(C.plan_rulare(rdir, self.edge), {'deja': True, 'pagini': 2}); self.assertEqual(len(self.edge.ops('plan')), 1)
    def test_flux_complet(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m')
        r = C.incarca_citiri(rdir, self.edge); self.assertEqual(r['stare'], 'citita'); nb = len(self.edge.plan[(DOC, 1)]['benzi'])
        self.assertEqual(r['scrise'], 2 * nb + 2)  # ambele cititoare pe fiecare banda + randul exclus al paginii 2 la ambele
        self.assertEqual(C.incarca_citiri(rdir, self.edge), {'deja': True})
        c = C.compara_rulare(rdir, self.edge); self.assertEqual(c['dezacorduri'], nb)
        a = C.arbitreaza(rdir, self.edge); self.assertEqual((a['stare'], a['claude']), ('arbitrata', nb))
        f = C.reconciliaza_rulare(rdir, self.edge); self.assertEqual(f['stare'], 'finalizata'); self.assertEqual(self.edge.stare, 'finalizata')
        rec = [x for k, x in self.edge.pagini.items() if k[3] == 'reconciliat']; self.assertEqual(len(rec), 1)
        # benzile de text au toate acelasi continut scurt: cusatura nu se poate dovedi (< 8 tokeni) -> pagina = needs_human, text gol
        self.assertEqual((rec[0]['pagina'], rec[0]['stare'], rec[0]['text'], f['needs_human']), (1, 'needs_human', '', 1))
    def test_flux_tabel_reconciliat(self):
        from .test_ocr_local import TABLE_A, TABLE_B
        self.edge.documente = [{'document_id': DOC, 'pagini': [1]}]
        r = C.preia(self.work, self.edge); rdir = pathlib.Path(r['dir']); C.descarca(rdir, self.edge)
        (rdir / 'orientare').mkdir(); (rdir / 'orientare' / ('%d.json' % DOC)).write_text('{"1": 0}', encoding='utf-8')
        self.edge.post_orig = self.edge.post
        def post(fn, corp, timeout=60):  # FakeEdge verifica doar paginile 1-2 la plan; aici documentul are doar pagina 1
            if fn == 'ofertare-ocr-scrie' and corp['op'] == 'plan':
                self.edge.calls.append((fn, corp)); self.edge.plan = {(e['document_id'], e['pagina']): e for e in corp['args']['plan']}; return 200, {'ok': True, 'rezultat': {}}
            return self.edge.post_orig(fn, corp, timeout)
        self.edge.post = post
        C.plan_rulare(rdir, self.edge, kind='quantity_table'); scrie_citiri(rdir, TABLE_A, TABLE_B)
        C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge); C.arbitreaza(rdir, self.edge); f = C.reconciliaza_rulare(rdir, self.edge)
        rec = self.edge.pagini[(DOC, 1, None, 'reconciliat')]
        self.assertEqual((rec['stare'], f['needs_human']), ('reconciliat', 0)); self.assertIn('| 0.056 |', rec['text']); self.assertEqual(rec['garda']['arbitrat_de_claude_cantitati'], 1)
    def test_citire_lipsa_nu_trece_in_citita(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'a b', 'a b')
        from .plan import load_plan
        b = load_plan(rdir / ('d%d' % DOC))['bands'][0]; o = rdir / ('d%d' % DOC) / 'page0001' / b['id'] / 'mineru'
        (o / 'result.json').unlink()
        # cititorul inca neterminat (fara stare finala): nimic nu se scrie si nimic nu se opreste
        (rdir / ('d%d' % DOC) / 'read_mineru.json').write_text('{"status": "running"}')
        with self.assertRaises(RuntimeError): C.incarca_citiri(rdir, self.edge)
        self.assertEqual((self.edge.stare, len(self.edge.ops('pagina'))), ('preluata', 0))
    def test_citire_lipsa_intra_in_pragul_de_oprire(self):
        # review r1 (Copilot P1-2 / Jakarinos P2-5): o banda lipsa la un cititor oprit = pagina incompleta, socotita la pragul de 20%
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'a b', 'a b')
        from .plan import load_plan
        b = load_plan(rdir / ('d%d' % DOC))['bands'][-1]; (rdir / ('d%d' % DOC) / 'page0001' / b['id'] / 'mineru' / 'result.json').unlink()
        (rdir / ('d%d' % DOC) / 'read_mineru.json').write_text('{"status": "stopped_no_retry"}')
        r = C.incarca_citiri(rdir, self.edge); self.assertEqual((r['stare'], r['lipsa'], self.edge.stare), ('oprita', 1, 'oprita'))
        with self.assertRaises(RuntimeError): C.compara_rulare(rdir, self.edge)  # rularea oprita: niciun pas nou
    def test_cadere_dupa_tranzitie_se_reia(self):
        # review r1: BD trece in citita, clientul cade inainte de marcaj; reluarea confirma starea din refuzul BD (nu retrimite citirile)
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); self.edge.cade_dupa = 'citita'
        with self.assertRaises(ConnectionResetError): C.incarca_citiri(rdir, self.edge)
        n = len(self.edge.ops('pagina')); r = C.incarca_citiri(rdir, self.edge)
        self.assertEqual((r['stare'], len(self.edge.ops('pagina')), self.edge.stare), ('citita', n, 'citita'))
        C.compara_rulare(rdir, self.edge); self.edge.cade_dupa = 'arbitrata'
        with self.assertRaises(ConnectionResetError): C.arbitreaza(rdir, self.edge)
        k = len([1 for f, _ in self.edge.calls if f == 'ofertare-ocr-arbitreaza'])
        self.assertEqual(C.arbitreaza(rdir, self.edge)['stare'], 'arbitrata'); self.assertEqual(len([1 for f, _ in self.edge.calls if f == 'ofertare-ocr-arbitreaza']), k)
        self.edge.cade_dupa = 'finalizata'
        with self.assertRaises(ConnectionResetError): C.reconciliaza_rulare(rdir, self.edge)
        self.assertEqual(C.reconciliaza_rulare(rdir, self.edge)['stare'], 'finalizata')
    def test_tranzitie_refuzata_din_alta_stare_nu_e_succes(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'a b', 'a b'); post = self.edge.post
        def anulata(fn, corp, timeout=60):  # rularea anulata din ERP intre timp: refuzul numeste starea anulata, nu citita
            if fn == 'ofertare-ocr-scrie' and corp['op'] == 'stare': return 409, {'error': 'Tranziție nepermisă anulata → citita'}
            return post(fn, corp, timeout)
        self.edge.post = anulata
        with self.assertRaises(C.EdgeError): C.incarca_citiri(rdir, self.edge)
        self.assertFalse(C.pasi(rdir).get('citita'))
    def test_preia_intrerupt_se_recupereaza_din_bd(self):
        # review r1 (Jakarinos P2-3): BD a trecut rularea in preluata, raspunsul s-a pierdut -> urmatorul preia o recupereaza (rulari_active)
        self.edge.cade_dupa = 'preia'
        with self.assertRaises(ConnectionResetError): C.preia(self.work, self.edge)
        self.assertTrue((self.work / 'preia_in_curs.json').exists())
        r = C.preia(self.work, self.edge); self.assertEqual((r['rulare'], r.get('recuperata')), (7, True))
        self.assertEqual(len(self.edge.ops('preia')), 1); self.assertFalse((self.work / 'preia_in_curs.json').exists())
        rdir = pathlib.Path(r['dir']); C.descarca(rdir, self.edge)  # rularea recuperata e folosibila
    def test_preia_intrerupt_fara_rulare_in_bd_reia_normal(self):
        (self.work / 'preia_in_curs.json').write_text('{}'); self.edge.stare = 'ceruta'
        r = C.preia(self.work, self.edge); self.assertEqual((r['rulare'], r.get('recuperata')), (7, None))
    def test_plan_si_comparatie_confirmate_din_bd_dupa_cadere(self):
        r = C.preia(self.work, self.edge); rdir = pathlib.Path(r['dir']); C.descarca(rdir, self.edge); C.foaie(rdir)
        (rdir / 'orientare' / ('%d.json' % DOC)).write_text('{"1": 0, "2": 0}', encoding='utf-8')
        self.edge.cade_dupa = 'plan'
        with self.assertRaises(ConnectionResetError): C.plan_rulare(rdir, self.edge)
        self.assertEqual(C.plan_rulare(rdir, self.edge)['pagini'], 2); self.assertEqual(len(self.edge.ops('plan')), 2)  # al doilea = 409, confirmat
        scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge)
        self.edge.cade_dupa = 'comparatie_gata'
        with self.assertRaises(ConnectionResetError): C.compara_rulare(rdir, self.edge)
        n = len(self.edge.ops('dezacord')); c = C.compara_rulare(rdir, self.edge)
        self.assertEqual(len(self.edge.ops('dezacord')), n); self.assertEqual(c['dezacorduri'], self.edge.comp['nr'])
        self.assertEqual(C.arbitreaza(rdir, self.edge)['stare'], 'arbitrata')
    def test_plan_diferit_in_bd_nu_e_confirmat(self):
        rdir = self.pana_la_plan(); C.marcheaza(rdir, 'plan', None)  # nu conteaza marcajul: BD are planul, iar clientul ar trimite altul
        self.edge.plan[(DOC, 2)] = dict(self.edge.plan[(DOC, 2)], exclus='alt motiv'); p = C.pasi(rdir); del p['plan']; C.save(rdir / 'pasi.json', p)
        with self.assertRaises(C.EdgeError): C.plan_rulare(rdir, self.edge)
    def test_amprenta_planului_canonica(self):
        m = [{'document_id': 1247, 'pagina': 326, 'exclus': None, 'benzi': [{'banda': 10, 'image_sha256': 'b'}, {'banda': 2, 'image_sha256': 'a'}]},
             {'document_id': 1247, 'pagina': 327, 'exclus': 'plansa'}]
        l1 = '1247|326|-|2:a,10:b\n'; l2 = '1247|327|%s|\n' % hashlib.sha256('plansa'.encode()).hexdigest()
        self.assertEqual(C.plan_sha(m), hashlib.sha256((l1 + l2).encode()).hexdigest()); self.assertEqual(C.plan_sha(m[::-1]), C.plan_sha(m))
    def test_prag_verificat_inainte_de_orice_apel_platit(self):
        # review r1 (Copilot P1-3 / Jakarinos P1-1): deciziile deja scrise (reluare) depasesc pragul -> oprire FARA un nou apel platit
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        d = rdir / ('d%d' % DOC); it = json.loads((d / 'dezacorduri.jsonl').read_text(encoding='utf-8').splitlines()[0])
        (d / 'decizii.jsonl').write_text(json.dumps({'id': it['id'], 'item_sha256': it['item_sha256'], 'decizie': 'needs_human'}) + '\n', encoding='utf-8')
        a = C.arbitreaza(rdir, self.edge, minim=1)
        self.assertEqual((a['stare'], self.edge.stare), ('oprita', 'oprita'))
        self.assertFalse([1 for f, _ in self.edge.calls if f == 'ofertare-ocr-arbitreaza'])
    def test_apel_posibil_platit_blocat_fara_alt_apel_claude(self):
        # review r1 (Copilot P1-4): 409 decontat fara decizie / 502 / transport = blocat; reluarea il trimite la om, fara alt apel platit
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        self.edge.arbitru = lambda it: (409, {'error': 'Decontat, dar decizia nu s-a înregistrat', 'decontat': True})
        with self.assertRaises(C.EdgeError) as e: C.arbitreaza(rdir, self.edge)
        self.assertIn('decontat=True', str(e.exception))
        primul = self.edge.calls[-1][1]['item']['id']; self.edge.arbitru = FakeEdge(b'').arbitru
        a = C.arbitreaza(rdir, self.edge); self.assertEqual(a['stare'], 'arbitrata')
        ids = [c['item']['id'] for f, c in self.edge.calls if f == 'ofertare-ocr-arbitreaza']
        self.assertEqual(ids.count(primul), 1); self.assertEqual(len(self.edge.ops('needs_human')), 1)
    def test_refuz_inainte_de_plata_nu_blocheaza(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        self.edge.arbitru = lambda it: (402, {'error': 'Plafon atins', 'refuz': 'plafon'})
        with self.assertRaises(C.EdgeError): C.arbitreaza(rdir, self.edge)
        primul = self.edge.calls[-1][1]['item']['id']; self.edge.arbitru = FakeEdge(b'').arbitru
        self.assertEqual(C.arbitreaza(rdir, self.edge)['stare'], 'arbitrata')  # refuzul dinaintea platii NU blocheaza: item-ul se arbitreaza
        self.assertEqual([c['item']['id'] for f, c in self.edge.calls if f == 'ofertare-ocr-arbitreaza'].count(primul), 2)
        self.assertFalse(self.edge.ops('needs_human'))
    def test_cadere_dupa_plata_inainte_de_marcaj_fara_a_doua_plata(self):
        # review r2 Jakarinos P1-1: procesul cade dupa apelul platit, inainte de orice scriere locala -> jurnalul are „start” fara „gata”
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        def plata_apoi_cadere(it): raise ConnectionResetError('procesul moare dupa plata')
        self.edge.arbitru = plata_apoi_cadere
        with self.assertRaises(ConnectionResetError): C.arbitreaza(rdir, self.edge)
        primul = self.edge.calls[-1][1]['item']['id']; self.edge.arbitru = FakeEdge(b'').arbitru
        self.assertEqual(C.arbitreaza(rdir, self.edge)['stare'], 'arbitrata')
        self.assertEqual([c['item']['id'] for f, c in self.edge.calls if f == 'ofertare-ocr-arbitreaza'].count(primul), 1)
        self.assertEqual(len(self.edge.ops('needs_human')), 1)
    def test_necunoscutele_raman_in_prag_dupa_conversie_si_reluare(self):
        # review r2 Copilot P1-2 / Jakarinos P1-2: un apel cu rezultat necunoscut, convertit la om, ramane needs_human la prag dupa reluare
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        self.edge.arbitru = lambda it: (502, {'error': 'API indisponibil', 'rezervare_id': 9})
        with self.assertRaises(C.EdgeError): C.arbitreaza(rdir, self.edge, minim=3)
        self.edge.arbitru = FakeEdge(b'').arbitru
        a = C.arbitreaza(rdir, self.edge, minim=3)  # 1 necunoscut (convertit la om) + 2 decizii bune = 1/3 > 15% -> oprita
        self.assertEqual((a['stare'], a['necunoscute'], self.edge.stare), ('oprita', 1, 'oprita'))
    def _pana_la_arbitraj(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        d = rdir / ('d%d' % DOC); return rdir, d, json.loads((d / 'dezacorduri.jsonl').read_text(encoding='utf-8').splitlines()[0])['id']
    def _apeluri_claude(self, item_id): return [c['item']['id'] for f, c in self.edge.calls if f == 'ofertare-ocr-arbitreaza'].count(item_id)
    def test_lacat_exclusiv_pe_rulare(self):
        # review r3 Jakarinos P1: o a doua comanda pe aceeasi rulare, cat prima ruleaza, e refuzata fara niciun apel
        rdir, d, _ = self._pana_la_arbitraj(); (rdir / 'lacat.json').write_text('{"pid": 1}')
        with self.assertRaises(RuntimeError): C.arbitreaza(rdir, self.edge)
        self.assertFalse([1 for f, _ in self.edge.calls if f == 'ofertare-ocr-arbitreaza'])
        (rdir / 'lacat.json').unlink(); self.assertEqual(C.arbitreaza(rdir, self.edge)['stare'], 'arbitrata'); self.assertFalse((rdir / 'lacat.json').exists())
    def test_doua_incercari_suprapuse_un_singur_gata_nu_le_inchide_pe_amandoua(self):
        # review r3 Jakarinos P1: doua `start` pe acelasi item (procese suprapuse), un singur `gata` (refuz in_zbor) -> ramane necunoscut
        rdir, d, i = self._pana_la_arbitraj()
        for x in ({'id': i, 'a': 'a1', 'faza': 'start'}, {'id': i, 'a': 'a2', 'faza': 'start'}, {'id': i, 'a': 'a2', 'faza': 'gata', 'rezultat': 'refuz'}):
            C._adauga(d / 'apeluri.jsonl', x)
        a = C.arbitreaza(rdir, self.edge)
        self.assertEqual((a['necunoscute'], self._apeluri_claude(i), len(self.edge.ops('needs_human'))), (1, 0, 1))
    def test_coada_trunchiata_reparata_conservator(self):
        # review r3 Jakarinos P2: `start` complet + ultima linie trunchiata (decizia / gata pierduta) -> needs_human, fara a doua plata
        rdir, d, i = self._pana_la_arbitraj()
        C._adauga(d / 'apeluri.jsonl', {'id': i, 'a': 'a1', 'faza': 'start'})
        with (d / 'apeluri.jsonl').open('a', encoding='utf-8') as f: f.write('{"id": "%s", "a": "a1", "fa' % i)
        a = C.arbitreaza(rdir, self.edge)
        self.assertEqual((a['stare'], self._apeluri_claude(i), len(self.edge.ops('needs_human'))), ('arbitrata', 0, 1))
        self.assertTrue(list(d.glob('apeluri.jsonl.coada-*')))
    def test_jurnal_corupt_in_interior_refuzat(self):
        rdir, d, i = self._pana_la_arbitraj()
        (d / 'apeluri.jsonl').write_text('{"id": "x", "a": "a1", "fa\n{"id": "x", "a": "a1", "faza": "start"}\n', encoding='utf-8')
        with self.assertRaises(RuntimeError): C.arbitreaza(rdir, self.edge)
        self.assertFalse([1 for f, _ in self.edge.calls if f == 'ofertare-ocr-arbitreaza'])
    def test_preia_intrerupt_nu_adopta_rulare_orfana_mai_veche(self):
        # review r2 Copilot P1-1: o rulare preluata fara plan EXISTA deja (orfana); preluarea noua cade INAINTE de commit -> nu o adopta
        self.edge.stare = 'preluata'; C.save(self.work / 'preia_in_curs.json', {'la': 0, 'active_inainte': [7]})
        self.assertEqual(C.preia(self.work, self.edge)['rulare'], None); self.assertFalse((self.work / 'r7').exists())
    def test_document_neinceput_dupa_oprirea_cititorului_intra_in_prag(self):
        # review r2 Jakarinos P2: `erp citeste` se opreste la primul document neterminat -> documentul urmator n-are stare; nu e refuz
        self.edge.documente = [{'document_id': DOC, 'pagini': [1, 2]}, {'document_id': 1248, 'pagini': [1]}]
        r = C.preia(self.work, self.edge); rdir = pathlib.Path(r['dir']); C.descarca(rdir, self.edge); C.foaie(rdir)
        for doc in (DOC, 1248): (rdir / 'orientare' / ('%d.json' % doc)).write_text('{"1": 0}', encoding='utf-8')
        C.plan_rulare(rdir, self.edge)
        scrie_citiri(rdir, 'a b', 'a b', ok_b=False); scrie_citiri(rdir, 'a b', '', doc=1248, mineru=False)
        out = C.incarca_citiri(rdir, self.edge); self.assertEqual((out['stare'], self.edge.stare), ('oprita', 'oprita'))
    def test_rezervare_id_in_mesaj(self):
        self.assertIn('rezervare_id=5', str(C.EdgeError('x', 502, {'error': 'API indisponibil', 'rezervare_id': 5})))
    def test_needs_human_deja_in_bd_devine_pierdut(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, '<table><tr><td>1</td><td>A</td></tr></table>', '1 A')
        C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        self.edge.om = set(json.loads((rdir / ('d%d' % DOC) / 'dezacorduri_bd.json').read_text()).values())  # BD le are deja
        a = C.arbitreaza(rdir, self.edge); self.assertTrue(any(x.get('sursa') == 'om' for x in C._jsonl(rdir / ('d%d' % DOC) / 'pierdute.jsonl'))); self.assertEqual(a['stare'], 'arbitrata')
    def test_garda_peste_prag_opreste(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'a b', 'a b', ok_b=False)
        r = C.incarca_citiri(rdir, self.edge); self.assertEqual(r['stare'], 'oprita'); self.assertEqual(self.edge.stare, 'oprita')
        self.assertTrue(all(p['stare'] == 'incomplet' for k, p in self.edge.pagini.items() if k[3] == 'mineru' and p['stare'] != 'exclus'))
    def test_arbitraj_refuz_opreste_fara_reincercare(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        self.edge.arbitru = lambda it: (502, {'error': 'API indisponibil', 'rezervare_id': 5})
        with self.assertRaises(C.EdgeError) as e: C.arbitreaza(rdir, self.edge)
        self.assertEqual(e.exception.status, 502); self.assertEqual(len([1 for f, _ in self.edge.calls if f == 'ofertare-ocr-arbitreaza']), 1)
        self.assertEqual(self.edge.stare, 'citita')
    def test_needs_human_peste_prag_opreste_rularea(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        self.edge.arbitru = lambda it: (200, {'decizie': {'id': it['id'], 'item_sha256': it['item_sha256'], 'decizie': 'needs_human', 'text': '', 'motiv': 'ilizibil',
                                                          'e_cantitate': False, 'anomalie_separator': False, 'arbitru_model': 'claude-sonnet-5', 'prompt_versiune': 'arb-v1', 'cost_usd': 0.01}})
        a = C.arbitreaza(rdir, self.edge, minim=1); self.assertEqual(a['stare'], 'oprita'); self.assertEqual(self.edge.stare, 'oprita')
    def test_arbitrat_in_bd_fara_decizie_locala_devine_pierdut(self):
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 20 m'); C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge)
        self.edge.arbitru = lambda it: (409, {'error': 'Dezacord deja arbitrat', 'refuz': 'arbitrat'})
        a = C.arbitreaza(rdir, self.edge); self.assertEqual((a['claude'], a['pierdute_claude'] > 0), (0, True))
        f = C.reconciliaza_rulare(rdir, self.edge); self.assertEqual(f['needs_human'], 1)  # fail-closed: fara decizie locala = needs_human
    def test_structura_tabele_merge_la_om_fara_ai(self):
        rdir = self.pana_la_plan()
        scrie_citiri(rdir, '<table><tr><td>1</td><td>A</td></tr></table>', '1 A')
        C.incarca_citiri(rdir, self.edge); C.compara_rulare(rdir, self.edge); a = C.arbitreaza(rdir, self.edge)
        self.assertGreaterEqual(a['om'], 1); self.assertTrue(all(x['dezacord_id'] for x in self.edge.ops('needs_human')))
        arb = [c['item']['tip'] for f, c in self.edge.calls if f == 'ofertare-ocr-arbitreaza']; self.assertNotIn('structura_tabele', arb)
    def test_manifest_sha_ca_in_bd(self):
        self.assertEqual(C.manifest_sha([]), hashlib.sha256(b'').hexdigest())
        self.assertEqual(C.manifest_sha(['10|2|b\n', '1247|1|a\n']), hashlib.sha256(b'10|2|b\n1247|1|a\n').hexdigest())

if __name__ == '__main__':
    unittest.main()
