"""Clientul ERP al pilotului OCR local (scripts/ocr_local/client.py) cap-coada pe functiile SQL REALE (20261029b + c), in harness-ul
scripts/test_ofertare_ocr_local.sh. Doar biblioteca standard (ruleaza in WSL fara PIL).
Edge-urile sunt inlocuite de SqlEdge, care face exact ce fac ele (lista inchisa de operatii -> RPC ca service_role, cheile exacte;
ofertare-pdf-link: pdf_rezerva + pdf_final; ofertare-ocr-arbitreaza: amprenta recalculata, dezacord_arbitraj, item = BD,
arbitraj_rezerva, scrie_arbitraj) - fara apel platit (decizia e fixa: ales_mineru).
Directorul rularii e construit ca dupa pasii plan + citeste (fara randare): plan.json, imaginile benzilor, citirile ambilor cititori.
Mediu: OCR_PSQL (calea psql), PGHOST / PGPORT / PGUSER / PGDATABASE. Iesire: un JSON cu rezultatul fiecarui pas."""
import base64, hashlib, json, os, pathlib, secrets, subprocess, sys, tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts'))
from ocr_local import client as C  # noqa: E402
from ocr_local.compare import item_hash  # noqa: E402
from ocr_local.read import protocol  # noqa: E402

DOC = 1247
# aceleasi citiri ca in harness (T1..T4M): 325 = un tabel cu separator diferit, 326/b0 = HTML LightOn vs MinerU, 326/b1 = text vs tabel
T1, T2 = 'Conductă DN 250 — 0,056', 'Conductă DN 250 — 0.056'
T3 = ('<p>Cantitate 10.5 m și 5 buc, x<5 si z>3, 10**2 mc, 1e3 kg, m<sup>2</sup>, **Teava** **PEHD**, Dimensiune 10&times;2</p>\n<table>\n  <tr>\n'
      '    <td>Țeavă<br>PEHD</td><td></td><td>m</td><td>5</td>\n  </tr>\n  <tr><td><sup>2</sup> <sup>3</sup></td><td>buc</td><td>10</td></tr>\n'
      '  <tr><td colspan="2">Robinet</td><td>buc</td><td>7</td></tr>\n</table>')
T3M = (T3.replace('10.5 m', '10,5 m').replace('10&times;2', '10×3').replace('<td>5</td>', '<td>6</td>').replace('<td>10</td>', '<td>11</td>')
       .replace('<td>7</td>', '<td>8</td>'))
T4, T4M = 'Banda doi: 7 mc', '| Banda doi: 8 | mc |'
PDF = b'%PDF-1.4 fixture client e2e'

# lista INCHISA a edge-ului ofertare-ocr-scrie (_shared/ocrLocal.ts OPERATII): cheie -> (parametru, tip)
J = 'jsonb'
OPS = {
    'preia': ('fn_ofertare_ocr_preia', [('protocol', 'p_protocol', 'text')]),
    'plan': ('fn_ofertare_ocr_plan', [('rulare_id', 'p_rulare_id', 'bigint'), ('plan', 'p_plan', J)]),
    'pagina': ('fn_ofertare_ocr_scrie_pagina', [('rulare_id', 'p_rulare_id', 'bigint'), ('document_id', 'p_document_id', 'bigint'), ('pagina', 'p_pagina', 'integer'),
                                                ('banda', 'p_banda', 'smallint'), ('cititor', 'p_cititor', 'text'), ('text', 'p_text', 'text'), ('stare', 'p_stare', 'text'),
                                                ('model_rev', 'p_model_rev', 'text'), ('raw_sha256', 'p_raw_sha256', 'text'), ('image_sha256', 'p_image_sha256', 'text'),
                                                ('garda', 'p_garda', J), ('segmente', 'p_segmente', J)]),
    'dezacord': ('fn_ofertare_ocr_scrie_dezacord', [('rulare_id', 'p_rulare_id', 'bigint'), ('dezacord', 'p_dezacord', J)]),
    'comparatie_gata': ('fn_ofertare_ocr_comparatie_gata', [('rulare_id', 'p_rulare_id', 'bigint'), ('nr', 'p_nr', 'integer'), ('sha256', 'p_sha256', 'text')]),
    'stare': ('fn_ofertare_ocr_stare', [('rulare_id', 'p_rulare_id', 'bigint'), ('stare', 'p_stare', 'text'), ('motiv', 'p_motiv', 'text')]),
    'rezervare_abandon': ('fn_ofertare_ocr_rezervare_abandon', [('rezervare_id', 'p_rezervare_id', 'bigint')]),
    'needs_human': ('fn_ofertare_ocr_arbitraj_om', [('rulare_id', 'p_rulare_id', 'bigint'), ('dezacord_id', 'p_dezacord_id', 'bigint'),
                                                    ('item_sha256', 'p_item_sha256', 'text'), ('motiv', 'p_motiv', 'text')]),
    'heartbeat': ('fn_ofertare_ocr_heartbeat', [('ok', 'p_ok', 'boolean'), ('mesaj', 'p_mesaj', 'text')]),
    'stare_rulare': ('fn_ofertare_ocr_rulare_stare', [('rulare_id', 'p_rulare_id', 'bigint')]),
    'rulari_active': ('fn_ofertare_ocr_rulari_active', []),
}

# codurile HTTP ale refuzurilor din arbitreaza.ts (REFUZ)
REFUZ = {'stare': 402, 'plafon': 402, 'suma': 413, 'dezacord': 422, 'imagine': 422, 'tip': 422, 'arbitrat': 409, 'in_zbor': 409}

def sql(fn, params, args):
    """SELECT to_jsonb(fn(p => valoare, ...)) cu argumentele dintr-un literal jsonb dollar-quoted (eticheta aleatoare)."""
    tag = '$a%s$' % secrets.token_hex(6); lit = tag + json.dumps(args, ensure_ascii=False) + tag
    parts = []
    for k, p, t in params:
        parts.append('%s => %s' % (p, ("nullif(a->'%s', 'null'::jsonb)" % k) if t == J else "(a->>'%s')::%s" % (k, t)))
    return "SELECT 'R:' || to_jsonb(public.%s(%s))::text FROM (SELECT %s::jsonb AS a) x" % (fn, ', '.join(parts), lit)

def ruleaza(q):
    """Ca service_role (prin authenticator, ca PostgREST). (True, json) sau (False, mesajul erorii)."""
    inp = 'SET SESSION AUTHORIZATION authenticator;\nBEGIN;\nSET LOCAL ROLE service_role;\n' + q + ';\nCOMMIT;\n'
    p = subprocess.run([os.environ['OCR_PSQL'], '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], input=inp.encode('utf-8'), capture_output=True)
    if p.returncode != 0:
        err = p.stderr.decode('utf-8', 'replace'); return False, err.split('ERROR:', 1)[-1].strip().splitlines()[0] if 'ERROR:' in err else err.strip()
    for line in p.stdout.decode('utf-8').splitlines():
        if line.startswith('R:'): return True, json.loads(line[2:])
    return False, 'fara rezultat'

class SqlEdge:
    def __init__(self): self.apeluri = {}; self.cade_dupa = None; self.caderi = []
    def post(self, fn, corp, timeout=60):
        status, j = self._post(fn, corp, timeout)
        # cadere simulata DUPA commit-ul din BD (raspunsul se pierde): clientul trebuie sa se reia confirmand starea din BD
        if self.cade_dupa and status == 200 and fn == 'ofertare-ocr-scrie' and self.cade_dupa in (corp['op'], corp['args'].get('stare')):
            self.caderi.append(self.cade_dupa); self.cade_dupa = None; raise ConnectionResetError('cadere simulata dupa commit')
        return status, j
    def _post(self, fn, corp, timeout=60):
        self.apeluri[fn] = self.apeluri.get(fn, 0) + 1
        if fn == 'ofertare-ocr-scrie':
            if set(corp) != {'op', 'args'} or corp['op'] not in OPS: return 400, {'error': 'Operație necunoscută'}
            f, params = OPS[corp['op']]
            if set(corp['args']) != {k for k, _, _ in params}: return 400, {'error': 'args: exact ' + ', '.join(k for k, _, _ in params)}
            ok, r = ruleaza(sql(f, params, corp['args']))
            return (200, {'ok': True, 'rezultat': r}) if ok else (409, {'error': r})
        if fn == 'ofertare-pdf-link':
            ok, r = ruleaza("SELECT 'R:' || public.fn_ofertare_ocr_pdf_rezerva(%d, %d)::text" % (corp['rulare_id'], corp['document_id']))
            if not ok or r.get('rezultat') != 'permis': return 403, {'error': 'respins'}
            ok, f = ruleaza("SELECT 'R:' || to_jsonb(public.fn_ofertare_ocr_pdf_final(%d, 'emis'))::text" % r['jurnal_id'])
            if not (ok and f is True): return 500, {'error': 'jurnal'}
            return 200, {'url': C.SEMNAT + r['fisier_path'] + '?token=fixture', 'expira_in_sec': 300, 'document_id': corp['document_id']}
        if fn == 'ofertare-ocr-arbitreaza':  # ce face arbitreaza.ts, fara apelul platit
            it = corp['item']; h = item_hash(it)
            if it.get('item_sha256') != h: return 422, {'error': 'Amprenta item-ului nu corespunde conținutului lui'}
            img = hashlib.sha256(base64.b64decode(corp['imagine_b64'])).hexdigest(); R, D = corp['rulare_id'], corp['dezacord_id']
            ok, dz = ruleaza("SELECT 'R:' || public.fn_ofertare_ocr_dezacord_arbitraj(%d, %d, '%s', '%s')::text" % (R, D, h, img))
            if not ok: return 500, {'error': str(dz)}
            if 'refuz' in dz: return REFUZ.get(dz['refuz'], 500), {'error': 'refuz', 'refuz': dz['refuz']}
            if (it['citire_lighton'], it['citire_mineru'], it['tip'], it['id'], it['image_sha256']) != (dz['citire_lighton'], dz['citire_mineru'], dz['tip'], dz['item_id'], img):
                return 422, {'error': 'Item-ul nu descrie dezacordul din BD'}
            ok, rz = ruleaza("SELECT 'R:' || public.fn_ofertare_ocr_arbitraj_rezerva(%d, %d, '%s', '%s', 0.01)::text" % (R, D, h, img))
            if not ok: return 500, {'error': str(rz)}
            if 'refuz' in rz: return REFUZ.get(rz['refuz'], 500), {'error': 'refuz', 'refuz': rz['refuz']}
            dec = {'decizie': 'ales_mineru', 'text': dz['citire_mineru'], 'motiv': 'fixture', 'e_cantitate': dz['e_cantitate'], 'anomalie_separator': dz['anomalie_separator']}
            a = dict(dec, dezacord_id=D, item_sha256=h, arbitru_model='claude-sonnet-5', prompt_versiune='arb-v1', cost_usd='0.0100', tokens_in=1000, tokens_out=50)
            tag = '$a%s$' % secrets.token_hex(6)
            ok, s = ruleaza("SELECT 'R:' || public.fn_ofertare_ocr_scrie_arbitraj(%d, %s%s%s::jsonb)::text" % (rz['rezervare_id'], tag, json.dumps(a, ensure_ascii=False), tag))
            if not ok or s.get('arbitraj_inregistrat') is not True: return 409, {'error': str(s)}
            return 200, {'arbitraj_id': s['id'], 'decizie': dict(dec, id=dz['item_id'], item_sha256=h, arbitru_model='claude-sonnet-5', prompt_versiune='arb-v1', cost_usd=0.01)}
        return 404, {'error': 'edge necunoscut'}
    def get(self, url, dest, max_octeti=0, timeout=0, la_antete=None):
        # contractul Edge.get: antetele (Content-Length, ETag) inaintea corpului, apoi {'sha256', 'octeti', 'etag'}
        if la_antete: la_antete(len(PDF), '"e2e"')
        dest.write_bytes(PDF); return {'sha256': hashlib.sha256(PDF).hexdigest(), 'octeti': len(PDF), 'etag': '"e2e"'}

def construieste(rdir):
    """Directorul de plan al documentului, ca dupa `plan` + `citeste` x2 (fara randare / GPU)."""
    d = rdir / ('d%d' % DOC); proto = protocol(); bands = []
    pagini = [{'page': 325, 'route': 'ocr'}, {'page': 326, 'route': 'ocr'}, {'page': 327, 'route': 'exclus_drawing'}]
    citiri = {(325, 0): ('quantity_table', T1, T2), (326, 0): ('quantity_table', T3, T3M), (326, 1): ('continuous_text', T4, T4M)}
    for (page, index), (kind, a, b) in citiri.items():
        bid = 'p%04d_b%d' % (page, index); img = ('imagine %s' % bid).encode()
        (d / ('page%04d' % page)).mkdir(parents=True, exist_ok=True); (d / ('page%04d' % page) / (bid + '.png')).write_bytes(img)
        band = {'id': bid, 'page': page, 'index': index, 'kind': kind, 'image': 'page%04d/%s.png' % (page, bid), 'image_sha256': hashlib.sha256(img).hexdigest()}
        bands.append(band)
        for reader, raw in (('lighton', a), ('mineru', b)):
            o = d / ('page%04d' % page) / bid / reader; o.mkdir(parents=True)
            (o / 'raw.txt').write_bytes(raw.encode('utf-8'))
            C.save(o / 'result.json', {'ok': True, 'reader': reader, 'protocol': proto['version'], 'weights_sha256': proto['readers'][reader]['weights_sha256'],
                                       'image_sha256': band['image_sha256'], 'raw_sha256': hashlib.sha256(raw.encode('utf-8')).hexdigest(), 'signal': None})
    for reader in ('lighton', 'mineru'): C.save(d / ('read_%s.json' % reader), {'status': 'complete'})
    C.save(d / 'plan.json', {'schema_version': '2.0.0', 'status': 'plan_complete', 'input_sha256': hashlib.sha256(PDF).hexdigest(), 'pages': pagini, 'bands': bands})

def cade(edge, pas, fn, *a):
    """Ruleaza pasul cu o cadere simulata dupa commit-ul `pas`, apoi il reia (fara cadere). Intoarce rezultatul reluarii."""
    edge.cade_dupa = pas
    try: fn(*a)
    except ConnectionResetError: pass
    else: raise AssertionError('caderea simulata dupa %s nu s-a produs' % pas)
    return fn(*a)

def main():
    edge = SqlEdge(); work = pathlib.Path(tempfile.mkdtemp(prefix='ocr_client_e2e_')); out = {}
    out['preia'] = cade(edge, 'preia', C.preia, work, edge); rdir = pathlib.Path(out['preia']['dir'])
    out['descarca'] = C.descarca(rdir, edge); construieste(rdir)
    out['descarca_reluat'] = C.descarca(rdir, edge)  # copia rularii valida: nicio cerere pdf-link noua
    out['plan'] = cade(edge, 'plan', C.plan_rulare, rdir, edge); out['plan_reluat'] = C.plan_rulare(rdir, edge)
    out['incarca'] = cade(edge, 'citita', C.incarca_citiri, rdir, edge)
    out['compara'] = cade(edge, 'comparatie_gata', C.compara_rulare, rdir, edge); out['compara_reluat'] = C.compara_rulare(rdir, edge)
    out['arbitreaza'] = C.arbitreaza(rdir, edge)
    out['reconciliaza'] = cade(edge, 'finalizata', C.reconciliaza_rulare, rdir, edge)
    out['caderi'] = edge.caderi
    # reluarea unei tranzitii dupa o cadere (commit in BD, marcaj local pierdut): refuzul REAL al BD numeste starea curenta
    r = C.rulare(rdir); C.tranzitie(rdir, edge, r, 'finalizata'); C.tranzitie(rdir, edge, r, 'citita')
    try: C.tranzitie(rdir, edge, r, 'oprita', 'test'); out['oprita_dupa_finalizata'] = 'acceptat (GRESIT)'
    except C.EdgeError as e: out['oprita_dupa_finalizata'] = 'refuzat %d' % e.status
    out['apeluri'] = edge.apeluri
    print(json.dumps(out, ensure_ascii=False, default=str))

if __name__ == '__main__':
    main()
