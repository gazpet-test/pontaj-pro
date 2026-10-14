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

class RaspunsFals:
    """Raspuns HTTP simulat pentru Edge.get REAL: Content-Length (True = adevarat, int = declarat), ETag, 304, cadere dupa N octeti
    (ConnectionResetError sau IncompleteRead), date livrate in bucati de cel mult 1000 de octeti."""
    def __init__(self, data, cl, cade, etag=None, status=200, incomplete=False):
        self.data, self.i, self.cade, self.status, self.incomplete = data, 0, cade, status, incomplete
        self.headers = {}
        if cl is not None: self.headers['Content-Length'] = str(len(data) if cl is True else cl)
        if etag: self.headers['ETag'] = etag
    def read(self, n):
        if self.cade is not None and self.i >= self.cade:
            if self.incomplete: raise C.http.client.IncompleteRead(b'xx', 10)
            raise ConnectionResetError('transfer intrerupt')
        b = self.data[self.i:self.i + min(n, 1000)]; self.i += len(b); return b
    def __enter__(self): return self
    def __exit__(self, *a): return False

class OpenerFals:
    def __init__(self, fe): self.fe = fe
    def open(self, req, timeout=0):
        fe = self.fe; return RaspunsFals(fe.pdf, fe.cl, fe.cade_dupa_octeti, fe.etag, incomplete=fe.incomplete)

class FakeEdge:
    def __init__(self, pdf, arbitru=None):
        self.pdf, self.calls, self.stare, self.plan, self.pagini, self.dez = pdf, [], 'ceruta', None, {}, {}
        self.arbitru = arbitru or (lambda it: (200, {'decizie': {'id': it['id'], 'item_sha256': it['item_sha256'], 'decizie': 'ales_mineru', 'text': it['citire_mineru'],
                                                                 'motiv': 't', 'e_cantitate': False, 'anomalie_separator': False, 'arbitru_model': 'claude-sonnet-5',
                                                                 'prompt_versiune': 'arb-v1', 'cost_usd': 0.01}, 'arbitraj_id': 1}))
        self.documente = [{'document_id': DOC, 'pagini': [1, 2]}]; self.om = set(); self.cade_dupa = None; self.comp = None; self.descarcari = 0; self.revalidari = 0; self.cl = True; self.cade_dupa_octeti = None; self.etag = '"v1"'; self.incomplete = False
    def ops(self, op): return [a for f, c in self.calls if f == 'ofertare-ocr-scrie' and c['op'] == op for a in [c['args']]]
    def get(self, url, dest, max_octeti=C.MAX_PDF, timeout=0, la_antete=None):
        # descarcarea REALA (Edge.get: Content-Length, limita pe flux, PDF complet, antetele inaintea corpului) peste HTTP simulat
        r = C.Edge('0' * 64, op=OpenerFals(self)).get(url, dest, max_octeti=max_octeti, la_antete=la_antete)
        self.descarcari += 1; return r

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
    def test_oprire_merge_cat_arbitrajul_tine_lacatul(self):
        # review r4 Jakarinos P2: `erp oprire` fara lacat; arbitrajul aflat in curs nu mai face niciun apel platit dupa cerere
        rdir, d, _ = self._pana_la_arbitraj(); baza = self.edge.arbitru; n = []
        def primul_apoi_oprire(it):
            n.append(it['id'])
            if len(n) == 1: self.assertEqual(C.oprire(rdir, self.edge, 'oprire manuala')['stare'], 'oprita')  # lacatul e tinut de arbitreaza
            return baza(it)
        self.edge.arbitru = primul_apoi_oprire
        self.assertTrue((rdir / 'lacat.json').exists() is False)
        with self.assertRaises(RuntimeError): C.arbitreaza(rdir, self.edge)
        self.assertEqual((len(n), self.edge.stare), (1, 'oprita')); self.assertFalse((rdir / 'lacat.json').exists())
    def test_preia_serializat_pe_directorul_de_lucru(self):
        (self.work / 'lacat.json').write_text('{"pid": 1}')
        with self.assertRaises(RuntimeError): C.preia(self.work, self.edge)
        self.assertFalse(self.edge.ops('preia'))
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
    # ── egress din Storage (cerere Răzvan 14.10, după Huedin) ──
    def _rulare(self):
        r = C.preia(self.work, self.edge); return pathlib.Path(r['dir'])
    def _pdf_link(self): return len([1 for f, _ in self.edge.calls if f == 'ofertare-pdf-link'])
    def _alta_rulare(self, rdir, rid):
        r = self.work / ('r%d' % rid); r.mkdir(); x = C.load(rdir / 'rulare.json'); x['rulare_id'] = rid; C.save(r / 'rulare.json', x); return r
    def _reg(self): return C._registru(self.work / '_pdf_registru')
    def test_egress_o_singura_descarcare_pe_rulare_reluarea_fara_retea(self):
        rdir = self._rulare(); d = C.descarca(rdir, self.edge)
        self.assertEqual((self.edge.descarcari, self._pdf_link(), d['egress_octeti']), (1, 1, len(self.edge.pdf)))
        for _ in range(3): self.assertTrue(C.descarca(rdir, self.edge)['documente'][0]['deja'])  # reluari: copia rularii, nicio cerere
        self.assertEqual((self.edge.descarcari, self._pdf_link(), C.jurnal_egress(rdir)['octeti_total']), (1, 1, len(self.edge.pdf)))
        self.assertEqual(C.load(rdir / 'pdf' / ('%d.json' % DOC))['etag'], self.edge.etag)  # ETag-ul serverului pastrat pentru audit
    def test_egress_alta_rulare_descarca_propria_copie_o_data(self):
        # versiunea e inghetata PE RULARE; o rulare noua (ceruta de om din ERP) descarca din nou, o singura data
        rdir = self._rulare(); C.descarca(rdir, self.edge); r8 = self._alta_rulare(rdir, 8)
        C.descarca(r8, self.edge); C.descarca(r8, self.edge)
        self.assertEqual((self.edge.descarcari, C.jurnal_egress(r8)['octeti_total']), (2, len(self.edge.pdf)))
    def test_egress_esecurile_sunt_pe_document_in_toate_rularile(self):
        # review r1 Jakarinos P1-2: doua incercari esuate -> nici o alta rulare nu mai descarca documentul
        rdir = self._rulare(); self.edge.cade_dupa_octeti = 3000; t = [1000.0]
        with self.assertRaises(C.TransferIncomplet): C.descarca(rdir, self.edge, acum=lambda: t[0])
        # conexiunea cade IN TIMPUL corpului: consum necunoscut -> rezervarea (Content-Length) ramane socotita (review r3 Jakarinos P1)
        eg = C.jurnal_egress(rdir); self.assertEqual((eg['documente'][str(DOC)]['incercari'], eg['octeti_total']), (1, len(self.edge.pdf)))
        t[0] += 10
        with self.assertRaises(RuntimeError): C.descarca(rdir, self.edge, acum=lambda: t[0])  # pauza de 60 s
        r8 = self._alta_rulare(rdir, 8)
        with self.assertRaises(RuntimeError): C.descarca(r8, self.edge, acum=lambda: t[0])  # pauza e pe DOCUMENT, si in alta rulare
        t[0] += 60
        with self.assertRaises(C.TransferIncomplet): C.descarca(r8, self.edge, acum=lambda: t[0])
        t[0] += 600; r9 = self._alta_rulare(rdir, 9)
        with self.assertRaises(RuntimeError) as e: C.descarca(r9, self.edge, acum=lambda: t[0])
        self.assertIn('toate rularile', str(e.exception)); self.assertEqual(C.jurnal_egress(r9)['octeti_total'], 0)
        self.assertEqual(self._reg()[str(DOC)]['esecuri'], 2)
    def test_egress_transfer_trunchiat_nu_devine_copia_rularii(self):
        # review r1 Jakarinos P1-4: Content-Length mai mare decat ce soseste -> respins
        rdir = self._rulare(); self.edge.cl = len(self.edge.pdf) + 500
        with self.assertRaises(C.TransferIncomplet): C.descarca(rdir, self.edge)
        self.assertFalse((rdir / 'pdf' / ('%d.pdf' % DOC)).exists()); self.assertEqual(self._reg()[str(DOC)]['esecuri'], 1)
    def test_egress_pdf_fara_eof_respins(self):
        rdir = self._rulare(); self.edge.pdf = self.edge.pdf.replace(b'%%EOF', b'%%XXX')
        with self.assertRaises(C.TransferIncomplet): C.descarca(rdir, self.edge)
        self.assertFalse((rdir / 'pdf' / ('%d.pdf' % DOC)).exists())
    def test_egress_incompleteread_parser_real_rezervarea_ramane(self):
        # review r4 Jakarinos P1: cu parserul HTTP REAL (chunked, conexiune inchisa in interiorul unui chunk) IncompleteRead.partial poate
        # fi gol desi au sosit octeti -> consum necunoscut, rezervarea ramane socotita
        import io, http.client
        corp = b'%PDF-1.4 ' + b'x' * 491
        CRLF = bytes([13, 10])
        brut = b'HTTP/1.1 200 OK' + CRLF + b'Transfer-Encoding: chunked' + CRLF + b'ETag: "v1"' + CRLF + CRLF + b'3e8' + CRLF + corp  # declarat 1000, sosesc 500, apoi EOF
        class Sock:
            def makefile(self, *a, **k): return io.BytesIO(brut)
        class OpenerHttpReal:
            def open(self, req, timeout=0):
                r = http.client.HTTPResponse(Sock()); r.begin(); return r
        rdir = self._rulare()
        self.edge.get = lambda url, dest, max_octeti=0, timeout=0, la_antete=None: C.Edge('0' * 64, op=OpenerHttpReal()).get(url, dest, max_octeti=max_octeti, la_antete=la_antete)
        with patch.object(C, 'EGRESS_MAX_OCTETI', 2_000_000):
            with self.assertRaises(C.TransferIncomplet): C.descarca(rdir, self.edge)
        self.assertEqual(C.jurnal_egress(rdir)['octeti_total'], 2_000_000)  # nicio eliberare: retry-ul nu poate depasi plafonul
    def test_egress_cadere_proces_rezervarea_socotita_si_incercarea_esuata(self):
        # review r1 Copilot P1-3 / Jakarinos P1-3: procesul moare in timpul GET-ului (fara finally): rezervarea ramane pe disc, iar
        # la pornirea urmatoare incercarea „in zbor” se socoteste esuata
        rdir = self._rulare(); t = [1000.0]
        def moare(url, dest, max_octeti=0, timeout=0, la_antete=None):
            la_antete(len(self.edge.pdf), self.edge.etag); raise SystemExit('kill -9')  # nu e prins de client: ca o cadere
        self.edge.get = moare
        with self.assertRaises(SystemExit): C.descarca(rdir, self.edge, acum=lambda: t[0])
        self.assertEqual(C.jurnal_egress(rdir)['octeti_total'], len(self.edge.pdf))  # rezervarea (Content-Length) socotita
        with self.assertRaises(RuntimeError): C.descarca(rdir, self.edge, acum=lambda: t[0] + 300)  # constatat la t+300
        self.assertEqual((self._reg()[str(DOC)]['esecuri'], self._reg()[str(DOC)]['ultim_esec']), (1, t[0] + 300))  # review r4 Jakarinos P2
        with self.assertRaises(RuntimeError): C.descarca(rdir, self.edge, acum=lambda: t[0] + 301)  # pauza de la CONSTATARE, nu de la t0
    def test_egress_fisier_complet_fara_meta_adoptat_doar_din_transferul_rularii(self):
        rdir = self._rulare(); orig = FakeEdge.get
        def descarca_si_moare(url, dest, max_octeti=0, timeout=0, la_antete=None):
            orig(self.edge, url, dest, max_octeti=max_octeti, la_antete=la_antete); raise SystemExit('kill -9 dupa rename, inaintea meta')
        self.edge.get = descarca_si_moare
        with self.assertRaises(SystemExit): C.descarca(rdir, self.edge)
        self.edge.get = lambda *a, **k: self.fail('nu trebuia redescarcat')
        self.assertTrue(C.descarca(rdir, self.edge)['documente'][0]['adoptat'])
        self.assertEqual((C.jurnal_egress(rdir)['octeti_total'], self._reg()[str(DOC)]['esecuri']), (len(self.edge.pdf), 0))
        # un fisier fara meta in ALTA rulare (fara transferul ei in curs) nu se adopta: se sterge
        r8 = self._alta_rulare(rdir, 8); (r8 / 'pdf').mkdir(); (r8 / 'pdf' / ('%d.pdf' % DOC)).write_bytes((rdir / 'pdf' / ('%d.pdf' % DOC)).read_bytes())
        self.edge.get = lambda url, dest, max_octeti=0, timeout=0, la_antete=None: orig(self.edge, url, dest, max_octeti=max_octeti, la_antete=la_antete)
        self.assertNotIn('adoptat', C.descarca(r8, self.edge)['documente'][0])
    def test_egress_timeout_in_corp_rezervarea_ramane(self):
        # review r3 Jakarinos P1: un read() care ridica fara sa intoarca octetii -> NU se elibereaza rezervarea (altfel retry-ul depaseste plafonul)
        rdir = self._rulare(); self.edge.cl = None; self.edge.cade_dupa_octeti = 500
        with patch.object(C, 'EGRESS_MAX_OCTETI', 2_000_000):
            with self.assertRaises(C.TransferIncomplet): C.descarca(rdir, self.edge)
        self.assertEqual(C.jurnal_egress(rdir)['octeti_total'], 2_000_000)  # tot ce putea curge ramane socotit
    def test_egress_copia_inghetata_corupta_blocheaza_nu_redescarca(self):
        # review r3 Jakarinos P1: aceeasi rulare nu trece V1 -> V2
        rdir = self._rulare(); C.descarca(rdir, self.edge); (rdir / 'pdf' / ('%d.pdf' % DOC)).write_bytes(b'%PDF-alta versiune %%EOF')
        with self.assertRaises(RuntimeError) as e: C.descarca(rdir, self.edge)
        self.assertIn('inghetata', str(e.exception)); self.assertEqual((self.edge.descarcari, self._pdf_link()), (1, 1))
        (rdir / 'pdf' / ('%d.pdf' % DOC)).unlink()
        with self.assertRaises(RuntimeError): C.descarca(rdir, self.edge)  # lipsa, cu meta = tot blocaj
        self.assertEqual(self.edge.descarcari, 1)
    def test_egress_adoptare_si_fara_content_length(self):
        # review r3 Copilot P1 / Jakarinos P1: transfer complet fara Content-Length, cadere dupa rename -> adoptat, nu redescarcat
        rdir = self._rulare(); self.edge.cl = None; orig = FakeEdge.get
        def descarca_si_moare(url, dest, max_octeti=0, timeout=0, la_antete=None):
            orig(self.edge, url, dest, max_octeti=max_octeti, la_antete=la_antete); raise SystemExit('kill -9 dupa rename')
        self.edge.get = descarca_si_moare
        with self.assertRaises(SystemExit): C.descarca(rdir, self.edge)
        self.edge.get = lambda *a, **k: self.fail('nu trebuia redescarcat')
        self.assertTrue(C.descarca(rdir, self.edge)['documente'][0]['adoptat'])
        self.assertEqual(C.jurnal_egress(rdir)['octeti_total'], len(self.edge.pdf))
    def test_egress_succes_intrerupt_dupa_meta_nu_devine_esec(self):
        # review r3 Copilot P1 / Jakarinos P2: cadere dupa meta, inaintea jurnalului / registrului -> reluarea inchide; alta rulare nu numara esec
        rdir = self._rulare(); orig_save = C.save; tinta = rdir / 'pdf' / ('%d.json' % DOC)
        def save_moare(path, value):
            orig_save(path, value)
            if pathlib.Path(path) == tinta: raise SystemExit('kill -9 dupa meta')
        with patch.object(C, 'save', save_moare):
            with self.assertRaises(SystemExit): C.descarca(rdir, self.edge)
        self.assertTrue(self._reg()[str(DOC)]['in_zbor'])  # registrul a ramas „in zbor”
        r8 = self._alta_rulare(rdir, 8); C.descarca(r8, self.edge)  # alta rulare: succesul rularii 7 nu e numarat esec
        self.assertEqual(self._reg()[str(DOC)]['esecuri'], 0)
        self.assertTrue(C.descarca(rdir, self.edge)['documente'][0]['deja'])  # reluarea rularii 7: inchidere idempotenta
        eg = C.jurnal_egress(rdir); self.assertEqual((eg['octeti_total'], eg['documente'][str(DOC)]['rezervat']), (len(self.edge.pdf), 0))
        self.assertNotIn('in_curs', eg['documente'][str(DOC)])
    def test_egress_pauza_de_la_ultimul_esec(self):
        # review r3 Copilot P2: esec la t0, succes la t60, rulare noua la t70 -> nu e blocata (ultimul esec e la t0)
        rdir = self._rulare(); self.edge.cade_dupa_octeti = 100; t = [1000.0]
        with self.assertRaises(C.TransferIncomplet): C.descarca(rdir, self.edge, acum=lambda: t[0])
        self.edge.cade_dupa_octeti = None; t[0] += 60; C.descarca(rdir, self.edge, acum=lambda: t[0])
        t[0] += 10; C.descarca(self._alta_rulare(rdir, 8), self.edge, acum=lambda: t[0])
        self.assertEqual((self.edge.descarcari, self._reg()[str(DOC)]['esecuri']), (2, 1))
    def test_egress_plafon_content_length_opreste_rularea_fara_octeti(self):
        rdir = self._rulare()
        with patch.object(C, 'EGRESS_MAX_OCTETI', 1000):
            r = C.descarca(rdir, self.edge)
        self.assertEqual((r['stare'], self.edge.stare, r['egress_octeti']), ('oprita', 'oprita', 0)); self.assertIn('egress', r['motiv'])
        with self.assertRaises(RuntimeError): C.descarca(rdir, self.edge)  # rularea oprita: niciun pas nou
    def test_egress_plafon_pe_flux_fara_content_length(self):
        rdir = self._rulare(); self.edge.cl = None
        with patch.object(C, 'EGRESS_MAX_OCTETI', 2500):
            r = C.descarca(rdir, self.edge)
        self.assertEqual((r['stare'], self.edge.stare), ('oprita', 'oprita')); self.assertLessEqual(r['egress_octeti'], 2501)
        self.assertFalse((rdir / 'pdf' / ('%d.pdf' % DOC)).exists())
    def test_egress_doua_rulari_simultane_nu_scriu_registrul(self):
        # review r1 Copilot P1-2: lacat pe registrul comun
        rdir = self._rulare(); (self.work / '_pdf_registru').mkdir(exist_ok=True); (self.work / '_pdf_registru' / 'lacat.json').write_text('{"pid": 1}')
        with self.assertRaises(RuntimeError): C.descarca(rdir, self.edge)
        self.assertEqual(self._pdf_link(), 0)
    def test_egress_descarca_tine_lacatul_rularii(self):
        # review r1 Jakarinos P1-1: @cu_lacat era pe jurnal_egress, nu pe descarca
        rdir = self._rulare(); (rdir / 'lacat.json').write_text('{"pid": 1}')
        with self.assertRaises(RuntimeError): C.descarca(rdir, self.edge)
        self.assertEqual(self._pdf_link(), 0)
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
    def test_banda_oprita_de_garda_merge_la_om_fara_claude(self):
        # Razvan 14.10: o banda oprita de garda nu opreste documentul; apare „incomplet” cu motivul + guard_event si merge la om, fara AI
        rdir = self.pana_la_plan(); scrie_citiri(rdir, 'lungime 10 m', 'lungime 10 m')
        from .plan import load_plan
        d = rdir / ('d%d' % DOC); b = load_plan(d)['bands'][0]; o = d / ('page%04d' % b['page']) / b['id'] / 'mineru'
        res = json.loads((o / 'result.json').read_text()); ev = {'reason': 'bucla_previous_guard', 'detail': 'Repeated table row (4 times in a row)'}
        res.update(ok=False, signal='bucla_previous_guard', guard_event=ev, error=None, backend_idle_confirmed=True); (o / 'result.json').write_text(json.dumps(res))
        with patch.object(C, 'PRAG_GARDA', 1.0):  # o singura pagina in proba: pragul de pagini nu e subiectul testului
            r = C.incarca_citiri(rdir, self.edge)
        self.assertEqual(r['stare'], 'citita')
        p = [x for k, x in self.edge.pagini.items() if k[3] == 'mineru' and x['stare'] == 'incomplet']
        self.assertEqual(len(p), 1); self.assertEqual((p[0]['garda']['signal'], p[0]['garda']['guard_event']), ('bucla_previous_guard', ev))
        C.compara_rulare(rdir, self.edge); a = C.arbitreaza(rdir, self.edge)
        arb = [c['item']['tip'] for f, c in self.edge.calls if f == 'ofertare-ocr-arbitreaza']; self.assertNotIn('banda_intreaga', arb)
        self.assertTrue(any(x['motiv'].startswith('banda_intreaga') for x in self.edge.ops('needs_human'))); self.assertGreaterEqual(a['om'], 1)
        f = C.reconciliaza_rulare(rdir, self.edge); self.assertGreaterEqual(f['needs_human'], 1)
    def test_manifest_sha_ca_in_bd(self):
        self.assertEqual(C.manifest_sha([]), hashlib.sha256(b'').hexdigest())
        self.assertEqual(C.manifest_sha(['10|2|b\n', '1247|1|a\n']), hashlib.sha256(b'10|2|b\n1247|1|a\n').hexdigest())

if __name__ == '__main__':
    unittest.main()
