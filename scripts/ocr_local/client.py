"""Clientul pipeline -> ERP (pilot OCR local, 14.10.2026; spec docs/paw/PLAN_OCR_LOCAL_OFERTARE.md §6): singura legatura a serverului AI
cu ERP-ul. Vorbeste DOAR cu cele 3 edge-uri D3b (ofertare-pdf-link, ofertare-ocr-scrie, ofertare-ocr-arbitreaza), cu secretul
OCR_LOCAL_SECRET in antetul x-ocr-local-secret. Fara service_role, fara acces direct la BD; BD (migrarile 20261029b / c) refuza orice
abatere de stare, plan, imagine sau provenienta - clientul doar transporta ce a produs pipeline-ul local.

Pasi (fiecare = o comanda `python -B -m ocr_local erp <pas> <dir_rulare>`, reluabila; un pas incheiat se marcheaza in pasi.json):
  preia -> descarca -> foaie [om: orientare/<doc>.json] -> plan -> citeste lighton / mineru [om: serverele vLLM]
  -> incarca-citiri -> compara -> arbitreaza (PLATIT, sub plafonul rularii din BD) -> reconciliaza.
Directorul rularii <work>/r<id>/: rulare.json, pasi.json, pdf/<doc>.pdf (+ .json), orientare/, d<doc>/ (directorul de plan al
documentului: plan.json, benzile, citirile, dezacorduri.jsonl, decizii.jsonl, reconciliere/).

Reguli: fara redirect, fara proxy, URL-ul semnat acceptat doar pe bucketul ofertare al proiectului; nicio reincercare automata a unui
apel platit; orice refuz al BD opreste pasul (mesajul BD, fara secret). Oprire automata (spec §8): garda pe > 20% din pagini,
needs_human > 15% din arbitrajele Claude (dupa minim 20)."""
import base64, concurrent.futures, hashlib, json, os, pathlib, re, time, urllib.error, urllib.request

BASE = 'https://dxczwkbciseqniprspcu.supabase.co'
SEMNAT = BASE + '/storage/v1/object/sign/ofertare/'
SECRET_FILE = 'C:/Users/Gazpet-Ai/.secrete/ocr_local_secret.txt'
MAX_PDF = 1 << 30
PRAG_GARDA, PRAG_NH, MIN_NH = 0.20, 0.15, 20

def sha(b): return hashlib.sha256(b).hexdigest()
def save(path, value): path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
def load(path): return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))

class EdgeError(RuntimeError):
    def __init__(self, fn, status, corp):
        self.status, self.corp = status, corp if isinstance(corp, dict) else {}
        super().__init__('%s -> HTTP %s: %s' % (fn, status, str(self.corp.get('error', ''))[:300]))

class _FaraRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None  # 3xx devine HTTPError: nu urmam nicio redirectare

def opener(): return urllib.request.build_opener(urllib.request.ProxyHandler({}), _FaraRedirect())

def citeste_secret(path=None):
    s = os.environ.get('OCR_LOCAL_SECRET')
    if not s:
        p = pathlib.Path(path or SECRET_FILE)
        s = p.read_text(encoding='utf-8').strip() if p.exists() else ''
    if not re.fullmatch(r'[0-9a-f]{64}', s or ''): raise ValueError('OCR_LOCAL_SECRET lipseste sau nu are formatul asteptat (64 hex)')
    return s

class Edge:
    """POST JSON catre un edge; intoarce (status, corp). Nu ridica la 4xx/5xx - decide apelantul."""
    def __init__(self, secret, base=BASE, op=None):
        self.secret, self.base, self.op = secret, base, op or opener()
    def post(self, fn, corp, timeout=60):
        req = urllib.request.Request(self.base + '/functions/v1/' + fn, data=json.dumps(corp, ensure_ascii=False).encode('utf-8'), method='POST',
                                     headers={'Content-Type': 'application/json', 'x-ocr-local-secret': self.secret})
        try:
            with self.op.open(req, timeout=timeout) as r: status, body = r.status, r.read()
        except urllib.error.HTTPError as e: status, body = e.code, e.read()
        try: return status, json.loads(body.decode('utf-8'))
        except ValueError: return status, {'error': 'raspuns ne-JSON'}
    def get(self, url, dest, max_octeti=MAX_PDF, timeout=300):
        """Descarca un URL semnat in dest (prin .part); intoarce (sha256, octeti)."""
        h = hashlib.sha256(); n = 0; tmp = dest.with_suffix(dest.suffix + '.part')
        with self.op.open(urllib.request.Request(url, method='GET'), timeout=timeout) as r, tmp.open('wb') as f:
            while True:
                b = r.read(1 << 20)
                if not b: break
                n += len(b)
                if n > max_octeti: raise ValueError('PDF peste %d octeti' % max_octeti)
                h.update(b); f.write(b)
        os.replace(tmp, dest)
        return h.hexdigest(), n

def scrie(edge, op, args):
    status, j = edge.post('ofertare-ocr-scrie', {'op': op, 'args': args})
    if status != 200: raise EdgeError('ofertare-ocr-scrie/' + op, status, j)
    return j.get('rezultat')

def heartbeat(edge, ok, mesaj):
    try: scrie(edge, 'heartbeat', {'ok': ok, 'mesaj': mesaj[:300]})
    except Exception: pass  # semnalul de viata e auxiliar, nu opreste pasul

# ── directorul rularii ──────────────────────────────────────────────────────────────────────────────────────
def rulare(rdir):
    r = load(pathlib.Path(rdir) / 'rulare.json')
    if not isinstance(r.get('rulare_id'), int) or not r.get('documente'): raise ValueError('rulare.json invalid')
    return r
def documente(r): return [(int(x['document_id']), sorted(int(p) for p in x['pagini'])) for x in r['documente']]
def pasi(rdir):
    p = pathlib.Path(rdir) / 'pasi.json'
    return load(p) if p.exists() else {}
def marcheaza(rdir, pas, valoare=True):
    p = pasi(rdir); p[pas] = {'la': time.time(), 'valoare': valoare}; save(pathlib.Path(rdir) / 'pasi.json', p)
def paralel(fn, lista, n):
    """Ruleaza fn pe lista cu n fire; prima eroare se ridica dupa ce firele pornite se termina (scrierile sunt idempotente in BD)."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, n)) as ex: return list(ex.map(fn, lista))

def preia(work, edge):
    from .read import protocol
    rez = scrie(edge, 'preia', {'protocol': protocol()['version']}); r = (rez or {}).get('rulare')
    if r is None: return {'rulare': None, 'nota': 'nicio rulare ceruta'}
    rdir = pathlib.Path(work) / ('r%d' % r['id']); rdir.mkdir(parents=True, exist_ok=True)
    with (rdir / 'rulare.json').open('x', encoding='utf-8') as f:
        json.dump({'rulare_id': r['id'], 'licitatie_id': r['licitatie_id'], 'documente': r['documente'], 'plafon_usd': r['plafon_usd'],
                   'protocol': protocol()['version'], 'preluata_la': time.time()}, f, ensure_ascii=False, indent=2)
    heartbeat(edge, True, 'preluata rularea %d' % r['id'])
    return {'rulare': r['id'], 'licitatie_id': r['licitatie_id'], 'dir': str(rdir), 'pagini': sum(len(x['pagini']) for x in r['documente'])}

def descarca(rdir, edge):
    rdir = pathlib.Path(rdir); r = rulare(rdir); (rdir / 'pdf').mkdir(exist_ok=True); out = []
    for doc, _ in documente(r):
        dest = rdir / 'pdf' / ('%d.pdf' % doc); meta = rdir / 'pdf' / ('%d.json' % doc)
        if dest.exists() and meta.exists() and sha(dest.read_bytes()) == load(meta)['sha256']: out.append({'document_id': doc, 'deja': True}); continue
        status, j = edge.post('ofertare-pdf-link', {'rulare_id': r['rulare_id'], 'document_id': doc})
        if status != 200: raise EdgeError('ofertare-pdf-link', status, j)
        url = j.get('url') or ''
        if not url.startswith(SEMNAT) or j.get('document_id') != doc: raise ValueError('URL semnat neasteptat pentru documentul %d' % doc)  # URL-ul nu se afiseaza
        h, n = edge.get(url, dest)
        save(meta, {'document_id': doc, 'sha256': h, 'octeti': n, 'descarcat_la': time.time()}); out.append({'document_id': doc, 'octeti': n})
    heartbeat(edge, True, 'rularea %d: PDF-uri descarcate' % r['rulare_id'])
    return {'documente': out}

def foaie(rdir, per_foaie=96):
    """Foile de contact pentru orientare (fara AI, fara retea) + sablonul orientare/<doc>.DE_COMPLETAT.json (valori null): omul
    completeaza 0/90/180/270 si il salveaza ca orientare/<doc>.json. Nimic nu se presupune."""
    from .plan import contact_sheet
    rdir = pathlib.Path(rdir); r = rulare(rdir); o = rdir / 'orientare'; o.mkdir(exist_ok=True); out = []
    for doc, pagini in documente(r):
        for i in range(0, len(pagini), per_foaie):
            bucata = pagini[i:i + per_foaie]; png = o / ('%d_p%04d-%04d.png' % (doc, bucata[0], bucata[-1]))
            contact_sheet(rdir / 'pdf' / ('%d.pdf' % doc), png, bucata); out.append(str(png))
        save(o / ('%d.DE_COMPLETAT.json' % doc), {str(p): None for p in pagini})
    return {'foi': out}

def plan_rulare(rdir, edge, kind=None):
    """Planul CPU per document (paginile inghetate, orientarea confirmata de om) + manifestul trimis O SINGURA DATA (fn_ofertare_ocr_plan)."""
    from .plan import plan, load_plan
    rdir = pathlib.Path(rdir); r = rulare(rdir); manifest = []
    for doc, pagini in documente(r):
        pdf = rdir / 'pdf' / ('%d.pdf' % doc); meta = load(rdir / 'pdf' / ('%d.json' % doc)); d = rdir / ('d%d' % doc)
        if sha(pdf.read_bytes()) != meta['sha256']: raise ValueError('PDF-ul %d s-a schimbat dupa descarcare' % doc)
        if (d / 'plan.json').exists() and load(d / 'plan.json').get('status') == 'plan_complete': doc_plan = load_plan(d)
        else:
            if (d / 'plan_claim.json').exists(): raise RuntimeError('Plan incomplet in %s: verifica si sterge manual directorul, apoi reia' % d)
            ori = load(rdir / 'orientare' / ('%d.json' % doc))
            if any(str(k) not in {str(p) for p in pagini} for k in ori) or any(v not in (0, 90, 180, 270) for v in ori.values()):
                raise ValueError('orientare/%d.json: doar paginile inghetate, valori 0/90/180/270 (null = necompletat)' % doc)
            doc_plan = plan(pdf, d, pages=pagini, orientations=ori, kind=kind)
        if doc_plan['input_sha256'] != meta['sha256']: raise ValueError('Planul documentului %d e pe alt PDF' % doc)
        if sorted(p['page'] for p in doc_plan['pages']) != pagini: raise ValueError('Planul documentului %d nu acopera exact paginile inghetate' % doc)
        for p in doc_plan['pages']:
            if p['route'] == 'ocr':
                benzi = [{'banda': b['index'], 'image_sha256': b['image_sha256']} for b in doc_plan['bands'] if b['page'] == p['page']]
                manifest.append({'document_id': doc, 'pagina': p['page'], 'exclus': None, 'benzi': benzi})
            else: manifest.append({'document_id': doc, 'pagina': p['page'], 'exclus': p['route']})
    h = sha(json.dumps(manifest, sort_keys=True).encode())
    gata = pasi(rdir).get('plan')
    if gata:
        if gata['valoare'] != h: raise RuntimeError('Manifestul refacut difera de cel trimis deja (BD il accepta o singura data)')
        return {'deja': True, 'pagini': len(manifest)}
    scrie(edge, 'plan', {'rulare_id': r['rulare_id'], 'plan': manifest}); marcheaza(rdir, 'plan', h)
    excl = {}
    for m in manifest:
        if m['exclus']: excl[m['exclus']] = excl.get(m['exclus'], 0) + 1
    heartbeat(edge, True, 'rularea %d: plan trimis' % r['rulare_id'])
    return {'pagini': len(manifest), 'benzi': sum(len(m.get('benzi') or []) for m in manifest), 'excluse': excl}

def citeste_rulare(rdir, reader):
    """Wrapper peste read.run_reader pe toate documentele rularii (serverul vLLM al cititorului pornit de om). Fara apel catre ERP."""
    from .read import run_reader
    rdir = pathlib.Path(rdir); r = rulare(rdir); out = []
    for doc, _ in documente(r):
        st = run_reader(rdir / ('d%d' % doc), reader, run_id='r%d_%s' % (r['rulare_id'], reader)); out.append({'document_id': doc, 'status': st['status']})
        if st['status'] != 'complete': break
    return {'documente': out}

def model_rev(reader, res):
    from .read import protocol
    return ('%s|%s' % (protocol()['readers'][reader]['model'], res.get('weights_sha256')))[:200]

def incarca_citiri(rdir, edge, n=4):
    """Fiecare banda x cititor (citit / incomplet, cu segmentele compare.segmente) + randurile exclus ale planului; apoi preluata -> citita."""
    from .plan import load_plan
    from .compare import check_result, segmente
    from .read import protocol
    rdir = pathlib.Path(rdir); r = rulare(rdir); proto = protocol(); de_scris = []; lipsa = []; garda = {}; pagini_ocr = set()
    if pasi(rdir).get('citita'): return {'deja': True}
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc); doc_plan = load_plan(d)
        for p in doc_plan['pages']:
            if p['route'] != 'ocr':
                for reader in ('lighton', 'mineru'):
                    de_scris.append({'rulare_id': r['rulare_id'], 'document_id': doc, 'pagina': p['page'], 'banda': 0, 'cititor': reader, 'text': '',
                                     'stare': 'exclus', 'model_rev': 'plan|' + proto['version'], 'raw_sha256': sha(b''), 'image_sha256': None,
                                     'garda': {'motiv_excludere': p['route']}, 'segmente': None})
            else: pagini_ocr.add((doc, p['page']))
        for b in doc_plan['bands']:
            for reader in ('lighton', 'mineru'):
                o = d / ('page%04d' % b['page']) / b['id'] / reader
                if not (o / 'result.json').exists(): lipsa.append('%d/%s/%s' % (doc, b['id'], reader)); continue
                res = load(o / 'result.json'); raw = (o / 'raw.txt').read_bytes().decode('utf-8')
                if not check_result(res, reader, b, proto) or sha(raw.encode()) != res.get('raw_sha256'):
                    raise ValueError('Citirea %d/%s/%s nu e a protocolului / greutatilor / imaginii curente' % (doc, b['id'], reader))
                ok = res.get('ok') is True
                if not ok or res.get('signal') or res.get('guard_event'): garda[(doc, b['page'])] = True
                de_scris.append({'rulare_id': r['rulare_id'], 'document_id': doc, 'pagina': b['page'], 'banda': b['index'], 'cititor': reader, 'text': raw,
                                 'stare': 'citit' if ok else 'incomplet', 'model_rev': model_rev(reader, res), 'raw_sha256': res['raw_sha256'],
                                 'image_sha256': b['image_sha256'], 'segmente': segmente(raw) if ok else None,
                                 'garda': {k: res.get(k) for k in ('ok', 'signal', 'guard_event', 'finish_reason', 'error') if k in res}})
    rez = paralel(lambda a: scrie(edge, 'pagina', a), de_scris, n)
    deja = sum(1 for x in rez if (x or {}).get('deja'))
    out = {'scrise': len(rez) - deja, 'deja': deja, 'lipsa': len(lipsa), 'lipsa_exemple': lipsa[:20], 'pagini_ocr': len(pagini_ocr), 'pagini_cu_garda': len(garda)}
    if lipsa: heartbeat(edge, True, 'rularea %d: %d citiri lipsa' % (r['rulare_id'], len(lipsa))); return dict(out, stare='preluata (citiri lipsa)')
    if pagini_ocr and len(garda) / len(pagini_ocr) > PRAG_GARDA:
        motiv = 'garda / citire incompleta pe %d din %d pagini (> %d%%, spec §8)' % (len(garda), len(pagini_ocr), PRAG_GARDA * 100)
        scrie(edge, 'stare', {'rulare_id': r['rulare_id'], 'stare': 'oprita', 'motiv': motiv}); marcheaza(rdir, 'oprita', motiv)
        return dict(out, stare='oprita', motiv=motiv)
    scrie(edge, 'stare', {'rulare_id': r['rulare_id'], 'stare': 'citita', 'motiv': None}); marcheaza(rdir, 'citita')
    heartbeat(edge, True, 'rularea %d: citita' % r['rulare_id'])
    return dict(out, stare='citita')

def manifest_sha(linii):
    """Amprenta din fn_ofertare_ocr_comparatie_gata: sha256 peste „document_id|pagina|item_id|item_sha256\\n”, sortate (COLLATE "C")."""
    return sha(''.join(sorted(linii)).encode('utf-8'))

def compara_rulare(rdir, edge, n=4):
    """compare.compare per document (CPU), apoi fiecare dezacord in BD (proveniența verificata acolo) si marcajul „comparatie incheiata”."""
    from .compare import compare
    rdir = pathlib.Path(rdir); r = rulare(rdir); linii = []; total = 0
    if pasi(rdir).get('comparatie'): return {'deja': True}
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc); _, items = compare(d)
        rez = paralel(lambda it: scrie(edge, 'dezacord', {'rulare_id': r['rulare_id'], 'dezacord': dict(it, document_id=doc, pagina=it['page'], item_id=it['id'])}), items, n)
        save(d / 'dezacorduri_bd.json', {it['id']: x['id'] for it, x in zip(items, rez)})
        linii += ['%d|%d|%s|%s\n' % (doc, it['page'], it['id'], it['item_sha256']) for it in items]; total += len(items)
    h = manifest_sha(linii)
    scrie(edge, 'comparatie_gata', {'rulare_id': r['rulare_id'], 'nr': total, 'sha256': h}); marcheaza(rdir, 'comparatie', {'nr': total, 'sha256': h})
    heartbeat(edge, True, 'rularea %d: %d dezacorduri incarcate' % (r['rulare_id'], total))
    return {'dezacorduri': total, 'sha256': h}

def _jsonl(path):
    return [json.loads(l) for l in path.read_text(encoding='utf-8').splitlines() if l.strip()] if path.exists() else []
def _adauga(path, obj):
    with path.open('a', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(obj, ensure_ascii=False) + '\n'); f.flush(); os.fsync(f.fileno())

def arbitreaza(rdir, edge, prag=PRAG_NH, minim=MIN_NH):
    """Un dezacord pe rand: structura_tabele -> needs_human fara AI (op needs_human); restul -> ofertare-ocr-arbitreaza (PLATIT; rezervarea,
    plafonul si legarea de BD sunt in edge). Decizia se scrie local imediat (decizii.jsonl). Nicio reincercare: orice refuz / eroare
    opreste pasul. Oprire automata a rularii daca needs_human > prag din arbitrajele Claude (dupa `minim`)."""
    rdir = pathlib.Path(rdir); r = rulare(rdir); st = {'claude': 0, 'needs_human_claude': 0, 'om': 0, 'pierdute': 0, 'cost_usd': 0.0}
    if pasi(rdir).get('arbitrata'): return {'deja': True}
    if not pasi(rdir).get('comparatie'): raise RuntimeError('Compararea nu e incheiata (pasul compara)')
    for doc, _ in documente(r):
        for x in _jsonl(rdir / ('d%d' % doc) / 'decizii.jsonl'):
            st['claude'] += 1; st['needs_human_claude'] += x['decizie'] == 'needs_human'
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc); ids = load(d / 'dezacorduri_bd.json')
        facute = {x['id'] for f in ('decizii.jsonl', 'decizii_om.jsonl', 'pierdute.jsonl') for x in _jsonl(d / f)}
        for it in _jsonl(d / 'dezacorduri.jsonl'):
            if it['id'] in facute: continue
            if it['id'] not in ids: raise RuntimeError('Dezacordul %s nu are id in BD (reia compara)' % it['id'])
            if it['tip'] == 'structura_tabele':
                scrie(edge, 'needs_human', {'rulare_id': r['rulare_id'], 'dezacord_id': ids[it['id']], 'item_sha256': it['item_sha256'],
                                            'motiv': 'structura_tabele: un cititor vede tabel, celalalt text (fara arbitraj automat)'})
                _adauga(d / 'decizii_om.jsonl', {'id': it['id'], 'decizie': 'needs_human'}); st['om'] += 1; continue
            img = (d / it['image']).read_bytes()
            if sha(img) != it['image_sha256']: raise ValueError('Imaginea benzii %s s-a schimbat' % it['band'])
            status, j = edge.post('ofertare-ocr-arbitreaza', {'rulare_id': r['rulare_id'], 'dezacord_id': ids[it['id']], 'item': it,
                                                             'imagine_b64': base64.b64encode(img).decode('ascii')}, timeout=240)
            if status == 409 and j.get('refuz') == 'arbitrat':
                # decis deja in BD, dar decizia nu e locala (intrerupere dupa apel): la reconciliere = needs_human (fail-closed)
                _adauga(d / 'pierdute.jsonl', {'id': it['id'], 'motiv': 'arbitrat in BD, decizie locala lipsa'}); st['pierdute'] += 1; continue
            if status != 200: raise EdgeError('ofertare-ocr-arbitreaza (%s)' % it['id'], status, j)
            dec = j['decizie']
            if dec.get('id') != it['id'] or dec.get('item_sha256') != it['item_sha256']: raise RuntimeError('Decizie pentru alt dezacord: %s' % it['id'])
            _adauga(d / 'decizii.jsonl', dec); st['claude'] += 1; st['needs_human_claude'] += dec['decizie'] == 'needs_human'
            st['cost_usd'] += float(dec.get('cost_usd') or 0)
            if st['claude'] % 25 == 0: heartbeat(edge, True, 'rularea %d: %d arbitraje' % (r['rulare_id'], st['claude']))
            if st['claude'] >= minim and st['needs_human_claude'] / st['claude'] > prag:
                motiv = 'needs_human pe %d din %d arbitraje Claude (> %d%%, spec §8)' % (st['needs_human_claude'], st['claude'], prag * 100)
                scrie(edge, 'stare', {'rulare_id': r['rulare_id'], 'stare': 'oprita', 'motiv': motiv}); marcheaza(rdir, 'oprita', motiv)
                return dict(st, stare='oprita', motiv=motiv)
    scrie(edge, 'stare', {'rulare_id': r['rulare_id'], 'stare': 'arbitrata', 'motiv': None}); marcheaza(rdir, 'arbitrata', st)
    heartbeat(edge, True, 'rularea %d: arbitrata' % r['rulare_id'])
    return dict(st, stare='arbitrata')

def reconciliaza_rulare(rdir, edge, n=4):
    """reconcile.reconcile per document (CPU) + textul reconciliat al fiecarei pagini in BD (reconciliat / needs_human), apoi finalizata."""
    from .reconcile import reconcile
    from .read import protocol
    rdir = pathlib.Path(rdir); r = rulare(rdir); proto = protocol(); de_scris = []; nh = 0
    if pasi(rdir).get('finalizata'): return {'deja': True}
    if not pasi(rdir).get('arbitrata'): raise RuntimeError('Rularea nu e arbitrata (pasul arbitreaza)')
    rev = ('reconcile|%s|%s' % (proto['version'], ','.join(proto['arbitru']['prompt_versiuni_admise'])))[:200]
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc); dec = d / 'decizii.jsonl'
        if not dec.exists(): dec.write_text('', encoding='utf-8')
        out = load(d / 'reconciliere' / 'reconciliat.json') if (d / 'reconciliere').exists() else reconcile(d, dec)
        for p in out['pages']:
            text = p['text'] or ''; nh += bool(p['needs_human'])
            de_scris.append({'rulare_id': r['rulare_id'], 'document_id': doc, 'pagina': p['page'], 'banda': None, 'cititor': 'reconciliat', 'text': text,
                             'stare': 'needs_human' if p['needs_human'] else 'reconciliat', 'model_rev': rev, 'raw_sha256': sha(text.encode('utf-8')),
                             'image_sha256': None, 'segmente': None,
                             'garda': {'semnale': p.get('semnale') or [], 'arbitrat_de_claude_cantitati': p['arbitrat_de_claude_cantitati'], 'benzi': len(p['bands'])}})
    rez = paralel(lambda a: scrie(edge, 'pagina', a), de_scris, n)
    scrie(edge, 'stare', {'rulare_id': r['rulare_id'], 'stare': 'finalizata', 'motiv': None}); marcheaza(rdir, 'finalizata')
    heartbeat(edge, True, 'rularea %d: finalizata' % r['rulare_id'])
    return {'pagini': len(rez), 'needs_human': nh, 'stare': 'finalizata'}

def oprire(rdir, edge, motiv):
    r = rulare(rdir); scrie(edge, 'stare', {'rulare_id': r['rulare_id'], 'stare': 'oprita', 'motiv': motiv}); marcheaza(rdir, 'oprita', motiv)
    return {'stare': 'oprita'}

def abandon(edge, rezervare_id):
    """Rezervare ramasa deschisa dupa o eroare API (502): doar dupa 15 minute (BD), suma ramane socotita in plafon."""
    return {'abandonata': scrie(edge, 'rezervare_abandon', {'rezervare_id': int(rezervare_id)}) is True}
