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
def save(path, value):
    """Scriere atomica + fsync (fisierele de control: o intrerupere lasa versiunea veche sau pe cea noua, niciodata un fisier taiat)."""
    path = pathlib.Path(path); tmp = path.with_name(path.name + '.tmp')
    with tmp.open('w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(value, ensure_ascii=False, indent=2)); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)
def load(path): return json.loads(pathlib.Path(path).read_text(encoding='utf-8'))

class EdgeError(RuntimeError):
    def __init__(self, fn, status, corp):
        self.status, self.corp = status, corp if isinstance(corp, dict) else {}
        extra = ''.join(' [%s=%s]' % (k, self.corp[k]) for k in ('refuz', 'rezervare_id', 'decontat', 'stare_rulare') if k in self.corp)  # rezervare_id: pentru `erp abandon`
        super().__init__('%s -> HTTP %s: %s%s' % (fn, status, str(self.corp.get('error', ''))[:300], extra))

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
ORDINE = ('preluata', 'citita', 'arbitrata', 'finalizata')

def stare_server(edge, rulare_id):
    """Starea CONFIRMATA din BD (op stare_rulare, doar citire, migrarea 20261029e): reluarea dupa o cadere nu interpreteaza un refuz."""
    s = scrie(edge, 'stare_rulare', {'rulare_id': rulare_id})
    if not isinstance(s, dict) or s.get('exista') is not True or s.get('id') != rulare_id: raise RuntimeError('Rularea %d nu exista in BD' % rulare_id)
    return s

def tranzitie(rdir, edge, r, stare, motiv=None):
    """O tranzitie de stare, reluabila dupa o cadere intre commit-ul din BD si marcajul local: la refuz (409) se citeste starea din BD -
    daca rularea e deja in starea ceruta (sau dupa ea pe drumul normal), pasul e facut; orice alta stare (oprita, anulata, esuata,
    una anterioara) = eroarea originala."""
    try: scrie(edge, 'stare', {'rulare_id': r['rulare_id'], 'stare': stare, 'motiv': motiv})
    except EdgeError as e:
        if e.status != 409: raise
        cur = stare_server(edge, r['rulare_id'])['stare']
        if not (cur == stare or (cur in ORDINE and stare in ORDINE and ORDINE.index(cur) > ORDINE.index(stare))): raise
    marcheaza(rdir, stare, motiv or True)

def plan_sha(manifest):
    """Amprenta canonica a planului, IDENTICA cu fn_ofertare_ocr_rulare_stare (20261029e): randuri
    „document_id|pagina|<sha256(exclus) sau ->|banda:image_sha256,...\\n” (benzile in ordine numerica), sortate."""
    linii = []
    for e in manifest:
        ex = sha(e['exclus'].encode('utf-8')) if isinstance(e.get('exclus'), str) else '-'
        benzi = ','.join('%d:%s' % (b['banda'], b['image_sha256']) for b in sorted(e.get('benzi') or [], key=lambda b: b['banda']))
        linii.append('%d|%d|%s|%s\n' % (e['document_id'], e['pagina'], ex, benzi))
    return sha(''.join(sorted(linii)).encode('utf-8'))

def activa(rdir):
    o = pasi(rdir).get('oprita')
    if o: raise RuntimeError('Rularea e oprita (%s): niciun pas nou' % o['valoare'])

def paralel(fn, lista, n):
    """Ruleaza fn pe lista cu n fire; prima eroare se ridica dupa ce firele pornite se termina (scrierile sunt idempotente in BD)."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, n)) as ex: return list(ex.map(fn, lista))

def preia(work, edge):
    from .read import protocol
    work = pathlib.Path(work); work.mkdir(parents=True, exist_ok=True); marcaj = work / 'preia_in_curs.json'
    if marcaj.exists():
        # o preluare anterioara s-a intrerupt: rularea poate fi „preluata” in BD fara director local. Se recupereaza din BD (op rulari_active,
        # doar citire): rularile preluata FARA plan si fara rulare.json aici. Una = recuperata; niciuna = preia nu luase nimic; mai multe = om.
        cand = [x for x in scrie(edge, 'rulari_active', {}) or []
                if x['stare'] == 'preluata' and not x['are_plan'] and not (work / ('r%d' % x['id']) / 'rulare.json').exists()]
        if len(cand) > 1: raise RuntimeError('Preluare intrerupta, %d rulari preluate fara director local (%s): decide omul' % (len(cand), [x['id'] for x in cand]))
        if cand:
            x = cand[0]
            if x['protocol'] != protocol()['version']: raise RuntimeError('Rularea %d a fost preluata cu protocolul %s, nu %s' % (x['id'], x['protocol'], protocol()['version']))
            rdir = work / ('r%d' % x['id']); rdir.mkdir(parents=True, exist_ok=True)
            save(rdir / 'rulare.json', {'rulare_id': x['id'], 'licitatie_id': x['licitatie_id'], 'documente': x['documente'], 'plafon_usd': x['plafon_usd'],
                                        'protocol': x['protocol'], 'preluata_la': time.time(), 'recuperata': True})
            marcaj.unlink()
            return {'rulare': x['id'], 'licitatie_id': x['licitatie_id'], 'dir': str(rdir), 'recuperata': True,
                    'pagini': sum(len(d['pagini']) for d in x['documente'])}
        marcaj.unlink()
    save(marcaj, {'la': time.time()})
    rez = scrie(edge, 'preia', {'protocol': protocol()['version']}); r = (rez or {}).get('rulare')
    if r is None: marcaj.unlink(); return {'rulare': None, 'nota': 'nicio rulare ceruta'}
    rdir = work / ('r%d' % r['id']); rdir.mkdir(parents=True, exist_ok=True)
    if (rdir / 'rulare.json').exists(): raise FileExistsError('%s exista deja' % (rdir / 'rulare.json'))
    save(rdir / 'rulare.json', {'rulare_id': r['id'], 'licitatie_id': r['licitatie_id'], 'documente': r['documente'], 'plafon_usd': r['plafon_usd'],
                                'protocol': protocol()['version'], 'preluata_la': time.time()})
    marcaj.unlink()
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
    h = plan_sha(manifest)
    gata = pasi(rdir).get('plan')
    if gata:
        if gata['valoare'] != h: raise RuntimeError('Manifestul refacut difera de cel trimis deja (BD il accepta o singura data)')
        return {'deja': True, 'pagini': len(manifest)}
    activa(rdir)
    intentie = pasi(rdir).get('plan_intentie')
    if intentie and intentie['valoare'] != h: raise RuntimeError('Manifestul refacut difera de cel trimis inainte de intrerupere')
    marcheaza(rdir, 'plan_intentie', h)
    try: scrie(edge, 'plan', {'rulare_id': r['rulare_id'], 'plan': manifest})
    except EdgeError as e:
        # „o singura data”: planul din BD e confirmat ca ACESTA doar daca amprenta lui canonica (citita din BD) e egala cu a noastra
        if e.status != 409 or stare_server(edge, r['rulare_id']).get('plan_sha256') != h: raise
    marcheaza(rdir, 'plan', h)
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
    activa(rdir)
    if pasi(rdir).get('citita_intentie'):  # cadere dupa cererea de tranzitie: citirile sunt deja scrise, doar tranzitia se confirma
        tranzitie(rdir, edge, r, 'citita'); return {'stare': 'citita', 'reluat': True}
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc); doc_plan = load_plan(d)
        for reader in ('lighton', 'mineru'):  # o citire inca neterminata nu e „lipsa”: nimic nu se scrie si nimic nu se opreste
            st = load(d / ('read_%s.json' % reader)).get('status') if (d / ('read_%s.json' % reader)).exists() else None
            if st not in ('complete', 'stopped_no_retry', 'interrupted_needs_review'):
                raise RuntimeError('Cititorul %s nu a terminat pe documentul %d (stare %s): ruleaza intai `erp citeste`' % (reader, doc, st))
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
                if not (o / 'result.json').exists():  # cititorul s-a oprit inainte de banda: pagina conteaza ca incompleta la prag
                    lipsa.append('%d/%s/%s' % (doc, b['id'], reader)); garda[(doc, b['page'])] = True; continue
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
    out = {'scrise': len(rez) - deja, 'deja': deja, 'lipsa': len(lipsa), 'lipsa_exemple': lipsa[:20], 'pagini_ocr': len(pagini_ocr), 'pagini_incomplete': len(garda)}
    # pragul se evalueaza INAINTEA returului pe citiri lipsa: o lipsa (cititor oprit) e o pagina incompleta (review r1 Copilot P1-2 / Jakarinos P2-5)
    if pagini_ocr and len(garda) / len(pagini_ocr) > PRAG_GARDA:
        motiv = 'garda / citire incompleta sau lipsa pe %d din %d pagini (> %d%%, spec §8)' % (len(garda), len(pagini_ocr), PRAG_GARDA * 100)
        tranzitie(rdir, edge, r, 'oprita', motiv); return dict(out, stare='oprita', motiv=motiv)
    if lipsa: heartbeat(edge, True, 'rularea %d: %d citiri lipsa' % (r['rulare_id'], len(lipsa))); return dict(out, stare='preluata (citiri lipsa)')
    marcheaza(rdir, 'citita_intentie'); tranzitie(rdir, edge, r, 'citita')
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
    activa(rdir)
    intentie = pasi(rdir).get('comparatie_intentie')
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc)
        if intentie: items = _jsonl(d / 'dezacorduri.jsonl')  # dezacordurile sunt deja in BD; se reface doar marcajul
        else:
            _, items = compare(d)
            rez = paralel(lambda it: scrie(edge, 'dezacord', {'rulare_id': r['rulare_id'], 'dezacord': dict(it, document_id=doc, pagina=it['page'], item_id=it['id'])}), items, n)
            save(d / 'dezacorduri_bd.json', {it['id']: x['id'] for it, x in zip(items, rez)})
        linii += ['%d|%d|%s|%s\n' % (doc, it['page'], it['id'], it['item_sha256']) for it in items]; total += len(items)
    h = manifest_sha(linii); marcaj = {'nr': total, 'sha256': h}
    if intentie and intentie['valoare'] != marcaj: raise RuntimeError('Dezacordurile locale difera de cele declarate inainte de intrerupere')
    marcheaza(rdir, 'comparatie_intentie', marcaj)
    try: scrie(edge, 'comparatie_gata', {'rulare_id': r['rulare_id'], 'nr': total, 'sha256': h})
    except EdgeError as e:
        # „o singura data”: confirmat doar daca marcajul din BD are ACELASI numar si aceeasi amprenta
        s = stare_server(edge, r['rulare_id']) if e.status == 409 else {}
        if (s.get('comparatie_nr'), s.get('comparatie_sha256')) != (total, h): raise
    marcheaza(rdir, 'comparatie', marcaj)
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
    rdir = pathlib.Path(rdir); r = rulare(rdir); st = {'claude': 0, 'needs_human_claude': 0, 'om': 0, 'pierdute': 0, 'blocate': 0, 'cost_usd': 0.0}
    if pasi(rdir).get('arbitrata'): return {'deja': True}
    activa(rdir)
    if not pasi(rdir).get('comparatie'): raise RuntimeError('Compararea nu e incheiata (pasul compara)')
    if pasi(rdir).get('arbitrata_intentie'):
        tranzitie(rdir, edge, r, 'arbitrata'); return {'stare': 'arbitrata', 'reluat': True}
    def peste_prag():
        # pierdute / blocate = arbitraje Claude cu rezultat necunoscut local: socotite needs_human (conservator, review r1 Jakarinos P1-1)
        n = st['claude'] + st['pierdute'] + st['blocate']; nh = st['needs_human_claude'] + st['pierdute'] + st['blocate']
        return n >= minim and nh / n > prag, nh, n
    def opreste_daca_peste_prag():
        peste, nh, n = peste_prag()
        if not peste: return None
        motiv = 'needs_human pe %d din %d arbitraje Claude (> %d%%, spec §8)' % (nh, n, prag * 100)
        tranzitie(rdir, edge, r, 'oprita', motiv); return dict(st, stare='oprita', motiv=motiv)
    def om(d, ids, it, motiv):
        """needs_human fara AI; „deja arbitrat” in BD (intrerupere dupa scriere) = decis -> pierdute (needs_human local)."""
        try: scrie(edge, 'needs_human', {'rulare_id': r['rulare_id'], 'dezacord_id': ids[it['id']], 'item_sha256': it['item_sha256'], 'motiv': motiv})
        except EdgeError as e:
            if e.status == 409 and 'deja arbitrat' in str(e.corp.get('error', '')):
                _adauga(d / 'pierdute.jsonl', {'id': it['id'], 'motiv': 'needs_human deja in BD, marcaj local lipsa'}); return 'pierdut'
            raise
        _adauga(d / 'decizii_om.jsonl', {'id': it['id'], 'decizie': 'needs_human', 'motiv': motiv}); return 'om'
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc)
        st['claude'] += len(_jsonl(d / 'decizii.jsonl')); st['needs_human_claude'] += sum(x['decizie'] == 'needs_human' for x in _jsonl(d / 'decizii.jsonl'))
        st['pierdute'] += len(_jsonl(d / 'pierdute.jsonl')); st['om'] += len(_jsonl(d / 'decizii_om.jsonl'))
        rezolvate = {x['id'] for f in ('decizii.jsonl', 'decizii_om.jsonl', 'pierdute.jsonl') for x in _jsonl(d / f)}
        st['blocate'] += len({x['id'] for x in _jsonl(d / 'blocate.jsonl')} - rezolvate)
    # pragul se verifica INAINTEA oricarui apel platit (si dupa o reluare), nu abia dupa urmatorul (review r1 Copilot P1-3 / Jakarinos P1-1)
    oprit = opreste_daca_peste_prag()
    if oprit: return oprit
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc); ids = load(d / 'dezacorduri_bd.json'); items = {it['id']: it for it in _jsonl(d / 'dezacorduri.jsonl')}
        # dezacorduri „blocate” (apel care poate fi cheltuit fara decizie inregistrata): NICIODATA alt apel Claude, doar needs_human fara AI
        rezolvate = {x['id'] for f in ('decizii.jsonl', 'decizii_om.jsonl', 'pierdute.jsonl') for x in _jsonl(d / f)}
        for bid in sorted({x['id'] for x in _jsonl(d / 'blocate.jsonl')} - rezolvate):
            om(d, ids, items[bid], 'apel de arbitraj cu rezultat necunoscut (posibil cheltuit), fara decizie inregistrata')
        rezolvate = {x['id'] for f in ('decizii.jsonl', 'decizii_om.jsonl', 'pierdute.jsonl') for x in _jsonl(d / f)}
        for it in items.values():
            if it['id'] in rezolvate: continue
            if it['id'] not in ids: raise RuntimeError('Dezacordul %s nu are id in BD (reia compara)' % it['id'])
            if it['tip'] == 'structura_tabele':
                st['om' if om(d, ids, it, 'structura_tabele: un cititor vede tabel, celalalt text (fara arbitraj automat)') == 'om' else 'pierdute'] += 1; continue
            img = (d / it['image']).read_bytes()
            if sha(img) != it['image_sha256']: raise ValueError('Imaginea benzii %s s-a schimbat' % it['band'])
            oprit = opreste_daca_peste_prag()
            if oprit: return oprit
            try:
                status, j = edge.post('ofertare-ocr-arbitreaza', {'rulare_id': r['rulare_id'], 'dezacord_id': ids[it['id']], 'item': it,
                                                                 'imagine_b64': base64.b64encode(img).decode('ascii')}, timeout=240)
            except Exception as e:  # transport: apelul poate fi ajuns si platit -> blocat, fara reincercare (review r1 Copilot P1-4)
                _adauga(d / 'blocate.jsonl', {'id': it['id'], 'motiv': 'transport: ' + type(e).__name__}); raise
            if status == 409 and j.get('refuz') == 'arbitrat':
                # decis deja in BD, dar decizia nu e locala (intrerupere dupa apel): la reconciliere = needs_human (fail-closed)
                _adauga(d / 'pierdute.jsonl', {'id': it['id'], 'motiv': 'arbitrat in BD, decizie locala lipsa'}); st['pierdute'] += 1; continue
            if status != 200:
                # refuz = respins INAINTEA apelului platit (poarta, plafon, stare, amprenta, in zbor); fara refuz (409 decontat fara
                # decizie, 500, 502, altceva) = posibil cheltuit -> blocat: nu se mai cere niciodata un arbitraj Claude pe acest item
                if 'refuz' not in j: _adauga(d / 'blocate.jsonl', {'id': it['id'], 'status': status, 'rezervare_id': j.get('rezervare_id'), 'decontat': j.get('decontat')})
                raise EdgeError('ofertare-ocr-arbitreaza (%s)' % it['id'], status, j)
            dec = j['decizie']
            if dec.get('id') != it['id'] or dec.get('item_sha256') != it['item_sha256']: raise RuntimeError('Decizie pentru alt dezacord: %s' % it['id'])
            _adauga(d / 'decizii.jsonl', dec); st['claude'] += 1; st['needs_human_claude'] += dec['decizie'] == 'needs_human'
            st['cost_usd'] += float(dec.get('cost_usd') or 0)
            if st['claude'] % 25 == 0: heartbeat(edge, True, 'rularea %d: %d arbitraje' % (r['rulare_id'], st['claude']))
    oprit = opreste_daca_peste_prag()  # si inaintea finalizarii arbitrajului
    if oprit: return oprit
    marcheaza(rdir, 'arbitrata_intentie'); tranzitie(rdir, edge, r, 'arbitrata')
    heartbeat(edge, True, 'rularea %d: arbitrata' % r['rulare_id'])
    return dict(st, stare='arbitrata')

def reconciliaza_rulare(rdir, edge, n=4):
    """reconcile.reconcile per document (CPU) + textul reconciliat al fiecarei pagini in BD (reconciliat / needs_human), apoi finalizata."""
    from .reconcile import reconcile
    from .read import protocol
    rdir = pathlib.Path(rdir); r = rulare(rdir); proto = protocol(); de_scris = []; nh = 0
    if pasi(rdir).get('finalizata'): return {'deja': True}
    activa(rdir)
    if not pasi(rdir).get('arbitrata'): raise RuntimeError('Rularea nu e arbitrata (pasul arbitreaza)')
    if pasi(rdir).get('finalizata_intentie'):
        tranzitie(rdir, edge, r, 'finalizata'); return {'stare': 'finalizata', 'reluat': True}
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
    marcheaza(rdir, 'finalizata_intentie'); tranzitie(rdir, edge, r, 'finalizata')
    heartbeat(edge, True, 'rularea %d: finalizata' % r['rulare_id'])
    return {'pagini': len(rez), 'needs_human': nh, 'stare': 'finalizata'}

def oprire(rdir, edge, motiv):
    r = rulare(rdir); tranzitie(pathlib.Path(rdir), edge, r, 'oprita', motiv)
    return {'stare': 'oprita'}

def stare(rdir, edge):
    """Starea rularii citita din BD (doar citire) + pasii locali - pentru om, inainte de o reluare sau de `abandon`."""
    r = rulare(rdir); return {'bd': stare_server(edge, r['rulare_id']), 'local': sorted(pasi(rdir))}

def abandon(edge, rezervare_id):
    """Rezervare ramasa deschisa dupa o eroare API (502): doar dupa 15 minute (BD), suma ramane socotita in plafon."""
    return {'abandonata': scrie(edge, 'rezervare_abandon', {'rezervare_id': int(rezervare_id)}) is True}
