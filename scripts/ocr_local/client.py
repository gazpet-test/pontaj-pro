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
import base64, concurrent.futures, functools, hashlib, http.client, json, os, pathlib, re, shutil, time, urllib.error, urllib.request, uuid

BASE = 'https://dxczwkbciseqniprspcu.supabase.co'
SEMNAT = BASE + '/storage/v1/object/sign/ofertare/'
SECRET_FILE = 'C:/Users/Gazpet-Ai/.secrete/ocr_local_secret.txt'
MAX_PDF = 1 << 30
# EGRESS din Supabase Storage (cerere Razvan 14.10, dupa Huedin: o eroare redescarca in bucla, ~600x plafonul): fiecare PDF se
# descarca O SINGURA DATA (cache pe server dupa SHA-256), cel mult MAX_INCERCARI_PDF incercari pe document (cu pauza), iar totalul
# octetilor cititi pe rulare <= EGRESS_MAX_OCTETI (depasire = rularea oprita). Jurnalul: <dir_rulare>/egress.json.
EGRESS_MAX_OCTETI = int(os.environ.get('OCR_EGRESS_MAX_MB', '2048')) * 1_000_000
MAX_INCERCARI_PDF, PAUZA_INCERCARI_SEC = 2, 60
PRAG_GARDA, PRAG_NH, MIN_NH = 0.20, 0.15, 20

def sha(b): return hashlib.sha256(b).hexdigest()
def save(path, value):
    """Scriere atomica + fsync (fisierele de control: o intrerupere a PROCESULUI lasa versiunea veche sau pe cea noua, niciodata un fisier
    taiat). Durabilitatea rename-ului la o cadere de curent: fsync pe director unde sistemul il permite (POSIX); pe Windows (serverul AI)
    garantia e pentru caderea procesului (review r2 Copilot P2)."""
    path = pathlib.Path(path); tmp = path.with_name(path.name + '.tmp')
    with tmp.open('w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(value, ensure_ascii=False, indent=2)); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)
    if os.name == 'posix':
        fd = os.open(str(path.parent), os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
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
    def get(self, url, dest, max_octeti=MAX_PDF, timeout=300, la_antete=None):
        """Descarca un URL semnat in dest (prin .part, rename doar la final). Intoarce {'sha256', 'octeti', 'etag'} (etag doar pentru audit).
        `la_antete(cl, etag)` e chemat cu antetele INAINTEA
        citirii corpului (persistenta transferului in curs). Corpul: Content-Length > max_octeti = EgressDepasit inainte de citire; citirea e
        limitata la max_octeti + 1; lungime primita != Content-Length = TransferIncomplet; un PDF fara %PDF- / %%EOF = TransferIncomplet."""
        h = hashlib.sha256(); n = [0]; faza = ['antete']; tmp = dest.with_suffix(dest.suffix + '.part')
        try: return self._get(url, dest, tmp, h, n, max_octeti, timeout, la_antete, faza)
        except EgressDepasit as e: e.citit = n[0]; raise
        except TransferIncomplet as e: e.citit = getattr(e, 'citit', n[0]); raise
        except Exception as e:
            # inaintea corpului: niciun octet de corp. IN TIMPUL corpului (timeout, conexiune): un read() poate fi primit octeti fara sa-i
            # intoarca -> consum NECUNOSCUT, citit=None: rezervarea ramane socotita (review r3 Jakarinos P1)
            x = TransferIncomplet('%s: %s' % (type(e).__name__, str(e)[:200])); x.citit = None if faza[0] == 'corp' else 0; raise x from e

    def _get(self, url, dest, tmp, h, n, max_octeti, timeout, la_antete, faza):
        r = self.op.open(urllib.request.Request(url, method='GET'), timeout=timeout)
        with r:
            hd = getattr(r, 'headers', None) or {}
            cl = hd.get('Content-Length'); cl = int(cl) if cl and str(cl).isdigit() else None; et = hd.get('ETag')
            if cl is not None and cl > max_octeti: raise EgressDepasit('PDF de %d octeti peste limita ramasa %d' % (cl, max_octeti))
            if la_antete: la_antete(cl, et)
            faza[0] = 'corp'
            with tmp.open('wb') as f:
                while True:
                    try: b = r.read(min(1 << 20, max_octeti + 1 - n[0]))
                    except http.client.IncompleteRead as e:
                        # partial NU dovedeste consumul real (chunked: conexiune inchisa in interiorul unui chunk -> partial=b'' desi au
                        # sosit octeti): consum NECUNOSCUT, rezervarea ramane socotita (review r4 Jakarinos P1)
                        x = TransferIncomplet('transfer intrerupt (IncompleteRead) dupa >= %d octeti' % (n[0] + len(e.partial or b''))); x.citit = None; raise x from e
                    if not b: break
                    n[0] += len(b)
                    if n[0] > max_octeti: raise EgressDepasit('PDF peste limita ramasa de %d octeti' % max_octeti)
                    h.update(b); f.write(b)
            if cl is not None and n[0] != cl: raise TransferIncomplet('primiti %d octeti din %d declarati' % (n[0], cl))
            if not pdf_complet(tmp): raise TransferIncomplet('fisierul nu e un PDF complet (%PDF- / %%EOF)')
        os.replace(tmp, dest)
        return {'sha256': h.hexdigest(), 'octeti': n[0], 'etag': et}

class EgressDepasit(RuntimeError):
    pass

class TransferIncomplet(RuntimeError):
    pass

def pdf_complet(path):
    """Semnatura PDF la inceput si %%EOF in ultimii 2 KB: un transfer trunchiat nu intra in cache."""
    p = pathlib.Path(path); n = p.stat().st_size
    if n < 16: return False
    with p.open('rb') as f:
        cap = f.read(5); f.seek(max(0, n - 2048)); coada = f.read()
    return cap == b'%PDF-' and b'%%EOF' in coada

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
    c = pathlib.Path(rdir) / 'oprire_ceruta.json'  # `erp oprire` ruleaza FARA lacat (si cat ruleaza arbitrajul): marcajul lui e separat
    if c.exists(): raise RuntimeError('Oprire ceruta de om (%s): niciun pas nou' % load(c).get('motiv'))

def cu_lacat(fn):
    """Lacat EXCLUSIV pe directorul rularii (lacat.json, creat atomic O_EXCL): doua comenzi `erp` simultane pe aceeasi rulare nu se pot
    suprapune (review r3 Jakarinos P1). Un lacat ramas de la un proces mort se sterge manual, dupa verificare."""
    @functools.wraps(fn)
    def w(rdir, *a, **k):
        p = pathlib.Path(rdir) / 'lacat.json'; p.parent.mkdir(parents=True, exist_ok=True)  # preia: lacatul e pe directorul de lucru
        try: fd = os.open(str(p), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise RuntimeError('Rularea e in lucru in alt proces (%s: %s). Daca niciun proces nu mai ruleaza, sterge manual lacatul'
                               % (p, p.read_text(encoding='utf-8', errors='replace')[:200]))
        with os.fdopen(fd, 'w', encoding='utf-8') as f: json.dump({'pid': os.getpid(), 'pas': fn.__name__, 'la': time.time()}, f)
        try: return fn(rdir, *a, **k)
        finally:
            try: p.unlink()
            except FileNotFoundError: pass
    return w

def paralel(fn, lista, n):
    """Ruleaza fn pe lista cu n fire; prima eroare se ridica dupa ce firele pornite se termina (scrierile sunt idempotente in BD)."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, n)) as ex: return list(ex.map(fn, lista))

@cu_lacat
def preia(work, edge):
    from .read import protocol
    work = pathlib.Path(work); work.mkdir(parents=True, exist_ok=True); marcaj = work / 'preia_in_curs.json'
    if marcaj.exists():
        # o preluare anterioara s-a intrerupt: rularea poate fi „preluata” in BD fara director local. Se recupereaza din BD (op rulari_active,
        # doar citire): DOAR o rulare NOUA fata de instantaneul luat inaintea preluarii intrerupte (o rulare orfana mai veche nu e adoptata,
        # review r2 Copilot P1-1), preluata, fara plan, fara rulare.json aici. Una = recuperata; niciuna = preia nu luase nimic; mai multe = om.
        inainte = set(load(marcaj).get('active_inainte') or [])
        cand = [x for x in scrie(edge, 'rulari_active', {}) or []
                if x['id'] not in inainte and x['stare'] == 'preluata' and not x['are_plan'] and not (work / ('r%d' % x['id']) / 'rulare.json').exists()]
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
    save(marcaj, {'la': time.time(), 'active_inainte': [x['id'] for x in scrie(edge, 'rulari_active', {}) or []]})
    rez = scrie(edge, 'preia', {'protocol': protocol()['version']}); r = (rez or {}).get('rulare')
    if r is None: marcaj.unlink(); return {'rulare': None, 'nota': 'nicio rulare ceruta'}
    rdir = work / ('r%d' % r['id']); rdir.mkdir(parents=True, exist_ok=True)
    if (rdir / 'rulare.json').exists(): raise FileExistsError('%s exista deja' % (rdir / 'rulare.json'))
    save(rdir / 'rulare.json', {'rulare_id': r['id'], 'licitatie_id': r['licitatie_id'], 'documente': r['documente'], 'plafon_usd': r['plafon_usd'],
                                'protocol': protocol()['version'], 'preluata_la': time.time()})
    marcaj.unlink()
    heartbeat(edge, True, 'preluata rularea %d' % r['id'])
    return {'rulare': r['id'], 'licitatie_id': r['licitatie_id'], 'dir': str(rdir), 'pagini': sum(len(x['pagini']) for x in r['documente'])}

def jurnal_egress(rdir):
    p = pathlib.Path(rdir) / 'egress.json'
    return load(p) if p.exists() else {'octeti_total': 0, 'plafon_octeti': EGRESS_MAX_OCTETI, 'documente': {}}

def _dir_registru(rdir):
    c = pathlib.Path(rdir).resolve().parent / '_pdf_registru'; c.mkdir(exist_ok=True); return c

def _registru(c):
    p = pathlib.Path(c) / 'registru.json'
    return load(p) if p.exists() else {}

def _salveaza_registru(c, reg):
    save(pathlib.Path(c) / 'registru.json', reg)

@cu_lacat
def descarca(rdir, edge, acum=time.time):
    """PDF-urile rularii, cu protectie la EGRESS din Storage (cerere Razvan 14.10, dupa Huedin). Fiecare document se descarca O SINGURA
    DATA PE RULARE: copia rularii (pdf/<doc>.pdf, SHA-256 in meta) e singura sursa pentru orice reluare - nicio redescarcare, nicio
    revalidare (versiunea documentului e INGHETATA la prima descarcare completa a rularii; o rulare noua, ceruta de om din ERP, descarca
    din nou). Sub lacatul rularii SI al registrului comun al documentelor (<work>/_pdf_registru, lacat O_EXCL):
      - registrul comun tuturor rularilor numara INCERCARILE ESUATE pe document: cel mult MAX_INCERCARI_PDF, la >= pauza una de alta;
        incercarea se noteaza INAINTEA apelului, iar una ramasa fara rezultat (cadere) conteaza ca esuata la urmatoarea pornire;
      - bugetul rularii se REZERVA durabil inaintea cererii (cel ramas, cel mult MAX_PDF), coboara la Content-Length la antete si se
        reconciliaza la octetii reali la succes sau la un esec in proces; o cadere a procesului lasa rezervarea socotita. Depasire = oprita;
      - un transfer trunchiat nu devine copia rularii (Edge.get); un fisier complet ramas fara meta se adopta DOAR daca e transferul in
        curs al ACESTEI rulari (jurnalul ei), cu aceeasi lungime ca Content-Length."""
    rdir = pathlib.Path(rdir); r = rulare(rdir); (rdir / 'pdf').mkdir(exist_ok=True); out = []
    activa(rdir)
    rc = _dir_registru(rdir)
    with lacat_cache(rc):
        reg = _registru(rc); eg = jurnal_egress(rdir)
        for doc, _ in documente(r):
            dest = rdir / 'pdf' / ('%d.pdf' % doc); meta = rdir / 'pdf' / ('%d.json' % doc); k = str(doc)
            rd = reg.setdefault(k, {'esecuri': 0, 'in_zbor': {}}); jd = eg['documente'].setdefault(k, {'incercari': 0, 'rezervat': 0, 'octeti': 0})
            ic = jd.get('in_curs')  # transferul in curs AL ACESTEI rulari
            ale_rularii = [z for z in rd['in_zbor'] if z.startswith('%d:' % r['rulare_id'])]
            if meta.exists():
                # copia INGHETATA a rularii (succes persistat): nu se mai descarca NICIODATA alta versiune in aceasta rulare; lipsa sau
                # corupta = blocaj, verificare manuala (review r3 Jakarinos P1)
                m = load(meta)
                if not (dest.exists() and sha(dest.read_bytes()) == m['sha256']):
                    raise RuntimeError('Documentul %d: copia inghetata a rularii lipseste sau e corupta (SHA diferit de meta) - nicio descarcare noua, verificare manuala' % doc)
                # inchidere IDEMPOTENTA a unui succes intrerupt intre meta si jurnal / registru (review r3 Copilot P1 / Jakarinos P2)
                if ic: eg['octeti_total'] += m['octeti'] - ic['rez']; jd['rezervat'] -= ic['rez']; jd['octeti'] += m['octeti']; jd.pop('in_curs', None)
                for z in ale_rularii: rd['in_zbor'].pop(z, None)
                if ic or ale_rularii: save(rdir / 'egress.json', eg); _salveaza_registru(rc, reg)
                out.append({'document_id': doc, 'deja': True}); continue
            if dest.exists() and ic and pdf_complet(dest) and (ic.get('cl') is None or ic['cl'] == dest.stat().st_size):
                # fisierul complet al PROPRIULUI transfer (Edge.get il publica doar dupa corpul intreg + PDF complet), si fara Content-Length
                n = dest.stat().st_size; h = sha(dest.read_bytes())
                eg['octeti_total'] += n - ic['rez']; jd['rezervat'] -= ic['rez']; jd['octeti'] += n; jd.pop('in_curs', None)  # doar rezervarea ACESTUI transfer
                for z in ale_rularii: rd['in_zbor'].pop(z, None)
                save(meta, {'document_id': doc, 'sha256': h, 'octeti': n, 'etag': ic.get('etag'), 'sursa': 'adoptat', 'la': acum()})
                save(rdir / 'egress.json', eg); _salveaza_registru(rc, reg); out.append({'document_id': doc, 'adoptat': True}); continue
            if dest.exists(): dest.unlink()  # rest necunoscut: nu se foloseste
            # incercarile ramase „in zbor” (proces mort): esuate - DOAR daca rularea lor n-a persistat succesul (meta valid)
            for z, t0 in list(rd['in_zbor'].items()):
                mz = rdir.resolve().parent / ('r%s' % z.split(':', 1)[0]) / 'pdf' / ('%d.json' % doc)
                # momentul real al esecului e necunoscut (procesul a murit oricand dupa t0): conservator, momentul CONSTATARII (review r4 Jakarinos P2)
                if not mz.exists(): rd['esecuri'] += 1; rd['ultim_esec'] = max(rd.get('ultim_esec', 0), t0, acum())
                rd['in_zbor'].pop(z)
            if jd.get('in_curs'): jd.pop('in_curs')  # rezervarea lui ramane socotita (conservator)
            if rd['esecuri'] >= MAX_INCERCARI_PDF:
                _salveaza_registru(rc, reg); save(rdir / 'egress.json', eg)
                raise RuntimeError('Documentul %d: %d incercari de descarcare esuate (toate rularile), nicio alta descarcare din Storage - verificare manuala'
                                   % (doc, rd['esecuri']))
            if rd['esecuri'] and acum() - rd.get('ultim_esec', 0) < PAUZA_INCERCARI_SEC:  # pauza de la ULTIMUL ESEC (review r3 Copilot P2)
                _salveaza_registru(rc, reg); save(rdir / 'egress.json', eg)
                raise RuntimeError('Documentul %d: urmatoarea incercare abia dupa %d s de la esecul precedent' % (doc, PAUZA_INCERCARI_SEC))
            ramas = eg['plafon_octeti'] - eg['octeti_total']
            if ramas <= 0: return _opreste_egress(rdir, edge, r, eg, 'plafonul de egress al rularii (%d octeti) e consumat' % eg['plafon_octeti'])
            status, j = edge.post('ofertare-pdf-link', {'rulare_id': r['rulare_id'], 'document_id': doc})
            if status != 200: raise EdgeError('ofertare-pdf-link', status, j)
            url = j.get('url') or ''
            if not url.startswith(SEMNAT) or j.get('document_id') != doc: raise ValueError('URL semnat neasteptat pentru documentul %d' % doc)  # URL-ul nu se afiseaza
            # REZERVAREA durabila, INAINTEA cererii: bugetul, incercarea in zbor (registrul comun), transferul in curs (jurnalul rularii)
            rez = [min(ramas, MAX_PDF)]; a = uuid.uuid4().hex; zbor = '%d:%s' % (r['rulare_id'], a)
            eg['octeti_total'] += rez[0]; jd['rezervat'] += rez[0]; jd['incercari'] += 1; jd['in_curs'] = {'a': a, 'cl': None, 'etag': None, 'rez': rez[0]}
            rd['in_zbor'][zbor] = acum(); rd['ultima'] = acum()
            save(rdir / 'egress.json', eg); _salveaza_registru(rc, reg)
            def antete(cl, et):
                if cl is not None and cl < rez[0]:  # rezervarea coboara la marimea anuntata (tot ce poate curge), durabil
                    eg['octeti_total'] -= rez[0] - cl; jd['rezervat'] -= rez[0] - cl; rez[0] = cl
                jd['in_curs'] = {'a': a, 'cl': cl, 'etag': et, 'rez': rez[0]}
                save(rdir / 'egress.json', eg)
            try:
                res = edge.get(url, dest, max_octeti=rez[0], la_antete=antete)
            except (EgressDepasit, TransferIncomplet) as e:
                # esec IN PROCES: octetii cititi sunt stiuti exact -> rezervarea se reconciliaza la ei; esecul se numara in registru
                cit = getattr(e, 'citit', None)  # None = consum necunoscut: rezervarea ramane socotita
                if isinstance(cit, int): eg['octeti_total'] += cit - rez[0]; jd['rezervat'] -= rez[0]; jd['octeti'] += cit
                jd.pop('in_curs', None); rd['in_zbor'].pop(zbor, None); rd['esecuri'] += 1; rd['ultim_esec'] = acum()
                save(rdir / 'egress.json', eg); _salveaza_registru(rc, reg)
                if isinstance(e, EgressDepasit): return _opreste_egress(rdir, edge, r, eg, 'documentul %d: %s' % (doc, e))
                heartbeat(edge, False, 'rularea %d: descarcarea documentului %d a esuat (%s), egress %.1f MB' % (r['rulare_id'], doc, str(e)[:120], eg['octeti_total'] / 1e6))
                raise
            # (o cadere a PROCESULUI aici lasa rezervarea si incercarea in zbor pe disc: socotite, conservator)
            eg['octeti_total'] += res['octeti'] - rez[0]; jd['rezervat'] -= rez[0]; jd['octeti'] += res['octeti']; jd.pop('in_curs', None)
            rd['in_zbor'].pop(zbor, None)
            save(meta, {'document_id': doc, 'sha256': res['sha256'], 'octeti': res['octeti'], 'etag': res.get('etag'), 'sursa': 'storage', 'la': acum()})
            save(rdir / 'egress.json', eg); _salveaza_registru(rc, reg); out.append({'document_id': doc, 'octeti': res['octeti']})
    heartbeat(edge, True, 'rularea %d: PDF-uri gata, egress %.1f MB' % (r['rulare_id'], eg['octeti_total'] / 1e6))
    return {'documente': out, 'egress_octeti': eg['octeti_total'], 'plafon_egress_octeti': eg['plafon_octeti']}

class lacat_cache:
    """Lacat O_EXCL pe registrul comun al documentelor: doua rulari din acelasi director de lucru nu-l scriu simultan."""
    def __init__(self, c): self.p = pathlib.Path(c) / 'lacat.json'
    def __enter__(self):
        try: fd = os.open(str(self.p), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError: raise RuntimeError('Registrul PDF e folosit de alt proces (%s). Daca niciun proces nu mai ruleaza, sterge manual lacatul' % self.p)
        with os.fdopen(fd, 'w', encoding='utf-8') as f: json.dump({'pid': os.getpid(), 'la': time.time()}, f)
        return self
    def __exit__(self, *a):
        try: self.p.unlink()
        except FileNotFoundError: pass
        return False

def _opreste_egress(rdir, edge, r, eg, motiv):
    motiv = ('egress Storage: ' + motiv)[:300]
    save(rdir / 'egress.json', eg); tranzitie(rdir, edge, r, 'oprita', motiv)
    heartbeat(edge, False, 'rularea %d oprita: %s' % (r['rulare_id'], motiv))
    return {'stare': 'oprita', 'motiv': motiv, 'egress_octeti': eg['octeti_total']}

@cu_lacat
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

@cu_lacat
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

@cu_lacat
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

@cu_lacat
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
    oprit_anterior = {'lighton': False, 'mineru': False}  # `erp citeste` se opreste la primul document neterminat al cititorului
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc); doc_plan = load_plan(d)
        for reader in ('lighton', 'mineru'):
            st = load(d / ('read_%s.json' % reader)).get('status') if (d / ('read_%s.json' % reader)).exists() else None
            if st in ('stopped_no_retry', 'interrupted_needs_review'): oprit_anterior[reader] = True
            elif st is None and oprit_anterior[reader]: pass  # neinceput din cauza opririi pe un document anterior: benzile = lipsa (review r2 Jakarinos P2)
            elif st != 'complete':  # o citire inca neterminata nu e „lipsa”: nimic nu se scrie si nimic nu se opreste
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

@cu_lacat
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
    """Jurnal JSONL append-only. O ultima linie FARA terminator (scriere intrerupta) se repara conservator: se muta in
    <fisier>.coada-<timp> si se taie din jurnal (o decizie / un `gata` pierdut lasa `start`-ul necunoscut -> needs_human, fail-closed).
    O linie invalida in INTERIORUL jurnalului = corupere -> refuz (review r3 Jakarinos P2)."""
    if not path.exists(): return []
    data = path.read_bytes()
    if data and not data.endswith(b'\n'):
        cut = data.rfind(b'\n') + 1
        (path.parent / ('%s.coada-%d' % (path.name, int(time.time() * 1000)))).write_bytes(data[cut:])
        with path.open('r+b') as f: f.truncate(cut); f.flush(); os.fsync(f.fileno())
        data = data[:cut]
    out = []
    for i, l in enumerate(data.decode('utf-8').splitlines(), 1):
        if not l.strip(): continue
        try: out.append(json.loads(l))
        except ValueError: raise RuntimeError('Jurnal corupt: %s linia %d (nu e ultima linie neterminata) - verificare manuala' % (path, i))
    return out
def _adauga(path, obj):
    with path.open('a', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(obj, ensure_ascii=False) + '\n'); f.flush(); os.fsync(f.fileno())

@cu_lacat
def arbitreaza(rdir, edge, prag=PRAG_NH, minim=MIN_NH):
    """Un dezacord pe rand: structura_tabele si banda_intreaga (banda oprita de garda) -> needs_human fara AI (op needs_human);
    restul -> ofertare-ocr-arbitreaza (PLATIT; rezervarea,
    plafonul si legarea de BD sunt in edge). Decizia se scrie local imediat (decizii.jsonl). Nicio reincercare: orice refuz / eroare
    opreste pasul. Oprire automata a rularii daca needs_human > prag din arbitrajele Claude (dupa `minim`)."""
    rdir = pathlib.Path(rdir); r = rulare(rdir)
    if pasi(rdir).get('arbitrata'): return {'deja': True}
    activa(rdir)
    if not pasi(rdir).get('comparatie'): raise RuntimeError('Compararea nu e incheiata (pasul compara)')
    if pasi(rdir).get('arbitrata_intentie'):
        tranzitie(rdir, edge, r, 'arbitrata'); return {'stare': 'arbitrata', 'reluat': True}
    # JURNALUL APELURILOR PLATITE (review r2 Jakarinos P1-1 / Copilot P1-2), per document, append-only + fsync:
    #   apeluri.jsonl: {id, k, faza: start} SCRIS INAINTEA POST-ului; {id, k, faza: gata, rezultat: decizie | refuz | pierdut} dupa.
    #   Un start fara gata = rezultat NECUNOSCUT (cadere, transport, 409 decontat, 500, 502): posibil platit -> niciodata alt apel Claude
    #   pe acel item (la reluare: needs_human fara AI) si socotit PERMANENT needs_human la prag, chiar dupa conversia la om.
    def stare_locala():
        st = {'claude': 0, 'needs_human_claude': 0, 'om': 0, 'necunoscute': 0, 'pierdute_claude': 0, 'cost_usd': 0.0, 'per_doc': {}}
        for doc, _ in documente(r):
            d = rdir / ('d%d' % doc); ap = _jsonl(d / 'apeluri.jsonl'); dec = _jsonl(d / 'decizii.jsonl')
            claude = {x['id'] for x in dec}; gata = {x['a'] for x in ap if x['faza'] == 'gata'}
            necunoscute = {x['id'] for x in ap if x['faza'] == 'start' and x['a'] not in gata} - claude
            pierdute_cl = {x['id'] for x in _jsonl(d / 'pierdute.jsonl') if x.get('sursa') == 'claude'} - claude - necunoscute
            om_ids = {x['id'] for x in _jsonl(d / 'decizii_om.jsonl')}; pierdute = {x['id'] for x in _jsonl(d / 'pierdute.jsonl')}
            st['claude'] += len(dec); st['needs_human_claude'] += sum(x['decizie'] == 'needs_human' for x in dec)
            st['necunoscute'] += len(necunoscute); st['pierdute_claude'] += len(pierdute_cl); st['om'] += len(om_ids)
            st['cost_usd'] += sum(float(x.get('cost_usd') or 0) for x in dec)
            st['per_doc'][doc] = {'rezolvate': claude | om_ids | pierdute, 'necunoscute': necunoscute}
        return st
    def opreste_daca_peste_prag(st):
        # arbitraje Claude cu rezultat necunoscut / pierdut = needs_human (conservator); verificat dupa reluare, inaintea fiecarui apel
        n = st['claude'] + st['necunoscute'] + st['pierdute_claude']; nh = st['needs_human_claude'] + st['necunoscute'] + st['pierdute_claude']
        if not (n >= minim and nh / n > prag): return None
        motiv = 'needs_human pe %d din %d arbitraje Claude (> %d%%, spec §8)' % (nh, n, prag * 100)
        tranzitie(rdir, edge, r, 'oprita', motiv); return dict({k: v for k, v in st.items() if k != 'per_doc'}, stare='oprita', motiv=motiv)
    def om(d, ids, it, motiv):
        """needs_human fara AI; „deja arbitrat” in BD (intrerupere dupa scriere) = decis -> pierdute (needs_human local)."""
        try: scrie(edge, 'needs_human', {'rulare_id': r['rulare_id'], 'dezacord_id': ids[it['id']], 'item_sha256': it['item_sha256'], 'motiv': motiv})
        except EdgeError as e:
            if e.status == 409 and 'deja arbitrat' in str(e.corp.get('error', '')):
                _adauga(d / 'pierdute.jsonl', {'id': it['id'], 'sursa': 'om', 'motiv': 'needs_human deja in BD, marcaj local lipsa'}); return
            raise
        _adauga(d / 'decizii_om.jsonl', {'id': it['id'], 'decizie': 'needs_human', 'motiv': motiv})
    st = stare_locala(); oprit = opreste_daca_peste_prag(st)
    if oprit: return oprit
    for doc, _ in documente(r):
        d = rdir / ('d%d' % doc); ids = load(d / 'dezacorduri_bd.json'); items = {it['id']: it for it in _jsonl(d / 'dezacorduri.jsonl')}
        for bid in sorted(st['per_doc'][doc]['necunoscute'] - st['per_doc'][doc]['rezolvate']):
            om(d, ids, items[bid], 'apel de arbitraj cu rezultat necunoscut (posibil cheltuit), fara decizie inregistrata')
        st = stare_locala()
        for it in items.values():
            if it['id'] in st['per_doc'][doc]['rezolvate'] or it['id'] in st['per_doc'][doc]['necunoscute']: continue
            if it['id'] not in ids: raise RuntimeError('Dezacordul %s nu are id in BD (reia compara)' % it['id'])
            if it['tip'] == 'banda_intreaga':  # banda oprita de garda (citire incompleta): verificare manuala, fara Claude (Razvan 14.10)
                om(d, ids, it, ('banda_intreaga: ' + (it.get('motiv_pipeline') or 'citire incompleta') + ' - garda, verificare manuala (fara arbitraj automat)')[:200]); st = stare_locala(); continue
            if it['tip'] == 'structura_tabele':
                om(d, ids, it, 'structura_tabele: un cititor vede tabel, celalalt text (fara arbitraj automat)'); st = stare_locala(); continue
            img = (d / it['image']).read_bytes()
            if sha(img) != it['image_sha256']: raise ValueError('Imaginea benzii %s s-a schimbat' % it['band'])
            oprit = opreste_daca_peste_prag(st)
            if oprit: return oprit
            activa(rdir)  # `erp oprire` (fara lacat) cerut intre timp -> niciun apel platit nou
            a = uuid.uuid4().hex  # identificator UNIC al incercarii (review r3 Jakarinos P1: doua procese nu pot inchide aceeasi incercare)
            _adauga(d / 'apeluri.jsonl', {'id': it['id'], 'a': a, 'faza': 'start', 'la': time.time()})  # INAINTEA apelului platit
            status, j = edge.post('ofertare-ocr-arbitreaza', {'rulare_id': r['rulare_id'], 'dezacord_id': ids[it['id']], 'item': it,
                                                             'imagine_b64': base64.b64encode(img).decode('ascii')}, timeout=240)
            if status == 409 and j.get('refuz') == 'arbitrat':
                # decis deja in BD, decizia nu e locala: la reconciliere = needs_human (fail-closed); la prag = needs_human
                _adauga(d / 'pierdute.jsonl', {'id': it['id'], 'sursa': 'claude', 'motiv': 'arbitrat in BD, decizie locala lipsa'})
                _adauga(d / 'apeluri.jsonl', {'id': it['id'], 'a': a, 'faza': 'gata', 'rezultat': 'pierdut'}); st = stare_locala(); continue
            if status != 200:
                # refuz = respins INAINTEA apelului platit (poarta, plafon, stare, amprenta, in zbor): apelul se inchide; fara refuz (409
                # decontat fara decizie, 500, 502, altceva) = posibil platit: ramane necunoscut (start fara gata)
                if 'refuz' in j: _adauga(d / 'apeluri.jsonl', {'id': it['id'], 'a': a, 'faza': 'gata', 'rezultat': 'refuz', 'refuz': j['refuz']})
                raise EdgeError('ofertare-ocr-arbitreaza (%s)' % it['id'], status, j)
            dec = j['decizie']
            if dec.get('id') != it['id'] or dec.get('item_sha256') != it['item_sha256']: raise RuntimeError('Decizie pentru alt dezacord: %s' % it['id'])
            _adauga(d / 'decizii.jsonl', dec); _adauga(d / 'apeluri.jsonl', {'id': it['id'], 'a': a, 'faza': 'gata', 'rezultat': 'decizie'})
            st = stare_locala()
            if st['claude'] % 25 == 0: heartbeat(edge, True, 'rularea %d: %d arbitraje' % (r['rulare_id'], st['claude']))
    st = stare_locala(); oprit = opreste_daca_peste_prag(st)  # si inaintea finalizarii arbitrajului
    if oprit: return oprit
    marcheaza(rdir, 'arbitrata_intentie'); tranzitie(rdir, edge, r, 'arbitrata')
    heartbeat(edge, True, 'rularea %d: arbitrata' % r['rulare_id'])
    return dict({k: v for k, v in st.items() if k != 'per_doc'}, stare='arbitrata')

@cu_lacat
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
    """FARA lacat (review r4 Jakarinos P2): merge si cat ruleaza `arbitreaza`. Intai marcajul local oprire_ceruta.json (verificat de
    activa() inaintea fiecarui apel platit), apoi tranzitia in BD (dupa care orice rezervare noua e refuzata: 'stare'). Nu atinge
    pasi.json (il scrie procesul care tine lacatul); starea confirmata din BD."""
    rdir = pathlib.Path(rdir); r = rulare(rdir)
    save(rdir / 'oprire_ceruta.json', {'motiv': motiv, 'la': time.time()})
    try: scrie(edge, 'stare', {'rulare_id': r['rulare_id'], 'stare': 'oprita', 'motiv': motiv})
    except EdgeError as e:
        if e.status != 409 or stare_server(edge, r['rulare_id'])['stare'] != 'oprita': raise
    return {'stare': 'oprita'}

def stare(rdir, edge):
    """Starea rularii citita din BD (doar citire) + pasii locali - pentru om, inainte de o reluare sau de `abandon`."""
    r = rulare(rdir); return {'bd': stare_server(edge, r['rulare_id']), 'local': sorted(pasi(rdir)), 'egress': jurnal_egress(rdir)}

def abandon(edge, rezervare_id):
    """Rezervare ramasa deschisa dupa o eroare API (502): doar dupa 15 minute (BD), suma ramane socotita in plafon."""
    return {'abandonata': scrie(edge, 'rezervare_abandon', {'rezervare_id': int(rezervare_id)}) is True}
