"""Pasul 2 (GPU, local): un cititor (lighton SAU mineru) peste toate benzile planului. Modelele se ruleaza pe rand, nu simultan.
Reguli pastrate din pipeline-ul Codex: endpoint doar IP loopback literal, fara proxy, fara redirect, fara reincercare, termen 180 s,
garda v3, raw-ul nu se repara. Noi: verificarea SHA-256 a greutatilor la pornire, gpu.lock luat de rulare si eliberat la final,
reluare idempotenta (banda cu result.json se sare; banda inceputa si neterminata NU se reincearca automat)."""
import base64, contextlib, hashlib, http.client, ipaddress, json, os, pathlib, socket, threading, time, urllib.parse
from .guard import Guard
from .plan import load_plan, save

PACKAGE = pathlib.Path(__file__).parent
READERS = ('lighton', 'mineru')

def protocol(): return json.loads((PACKAGE / 'protocol.json').read_text(encoding='utf-8'))

def endpoint_parts(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme != 'http' or p.username or p.password or p.query or p.fragment or p.path not in ('', '/'):
        raise ValueError('Doar http://IP-loopback:port, fara cale sau credentiale')
    try: address = ipaddress.ip_address(p.hostname or '')
    except ValueError: raise ValueError('Trebuie IP loopback literal, fara DNS')
    if not address.is_loopback: raise ValueError('Endpoint in afara loopback interzis')
    return str(address), p.port or 80

def file_sha256(path, chunk=1 << 24):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(chunk), b''): h.update(block)
    return h.hexdigest()

def verify_weights(cfg):
    got = file_sha256(cfg['weights'])
    if got.lower() != cfg['weights_sha256'].lower():
        raise RuntimeError('Greutatile %s au SHA-256 %s, protocolul cere %s - refuz' % (cfg['weights'], got, cfg['weights_sha256']))
    return got

@contextlib.contextmanager
def gpu_lock(path, run_id):
    """Lock-ul e al rularii: creat exclusiv la inceput, sters la final doar daca e tot al ei. Lock-ul altcuiva = refuz.
    Daca rularea seteaza holder['keep'] (cerere expirata: backend-ul poate lucra inca), lock-ul RAMANE - il ridica omul."""
    path = pathlib.Path(path); holder = {'keep': False}; token = os.urandom(16).hex()  # identitatea achizitiei, nu run_id-ul din CLI
    try:
        with path.open('x', encoding='utf-8') as f: json.dump({'owner': 'ocr_local_ofertare', 'run_id': run_id, 'token': token, 'pid': os.getpid(), 'since': time.time()}, f)
    except FileExistsError:
        raise RuntimeError('GPU ocupat: %s exista (%s)' % (path, path.read_text(encoding='utf-8', errors='replace')[:200]))
    try: yield holder
    finally:
        try:
            mine = json.loads(path.read_text(encoding='utf-8')).get('token') == token
            if holder['keep'] and mine:
                path.write_text(json.dumps({'owner': 'ocr_local_ofertare', 'run_id': run_id, 'token': token, 'pid': os.getpid(), 'since': time.time(),
                                            'pastrat': 'cerere expirata, backend neconfirmat idle - verifica serverul vLLM, apoi sterge manual'}), encoding='utf-8')
            elif mine and not holder['keep']: path.unlink()
        except (OSError, ValueError): pass

def verify_server(cfg):
    """Atestare minima: pe portul cititorului raspunde vLLM cu numele servit asteptat SI cu radacina = folderul greutatilor verificate
    (served_root). Nu dovedeste ca nimeni n-a inlocuit fisierele dupa pornire - de aceea si SHA-ul fisierului la pornirea rularii."""
    host, port = endpoint_parts(cfg['endpoint']); conn = http.client.HTTPConnection(host, port, timeout=10)
    try:
        conn.request('GET', '/v1/models'); r = conn.getresponse()
        if r.status != 200: raise RuntimeError('Serverul %s raspunde HTTP %d' % (cfg['endpoint'], r.status))
        data = json.loads(r.read()).get('data') or []
    finally: conn.close()
    if [(m.get('id'), m.get('root')) for m in data] != [(cfg['served_model_name'], cfg['served_root'])]:
        raise RuntimeError('Pe %s ruleaza altceva decat %s din %s: %s' % (cfg['endpoint'], cfg['served_model_name'], cfg['served_root'], [(m.get('id'), m.get('root')) for m in data]))
    return True

def read_lighton(image_bytes, out_dir, cfg, deadline):
    """O cerere, streaming, garda v3 in timpul generarii (ca la Codex/benchmark). Promptul: doar imaginea."""
    host, port = endpoint_parts(cfg['endpoint'])
    content = [{'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(image_bytes).decode()}}]
    if cfg.get('prompt'): content.append({'type': 'text', 'text': cfg['prompt']})
    payload = {'model': cfg['served_model_name'], 'messages': [{'role': 'user', 'content': content}], **cfg['request_settings'],
               'stream': True, 'stream_options': {'include_usage': True}}
    encoded = json.dumps(payload).encode(); started = time.monotonic(); expired = threading.Event(); guard = Guard()
    conn = http.client.HTTPConnection(host, port, timeout=deadline)
    with (out_dir / 'request_started.json').open('x', encoding='utf-8') as f:
        json.dump({'time': time.time(), 'input_sha256': hashlib.sha256(image_bytes).hexdigest(), 'request_sha256': hashlib.sha256(encoded).hexdigest()}, f)
    sock_ref = [None]
    def cancel():
        expired.set()
        try:
            s = sock_ref[0] or conn.sock
            if s: s.shutdown(socket.SHUT_RDWR)
        except OSError: pass
    timer = threading.Timer(deadline, cancel); timer.daemon = True; timer.start()
    raw = ''; finish = None; error = None; signal = None; usage = None
    try:
        conn.request('POST', '/v1/chat/completions', encoded, {'Content-Type': 'application/json'}); response = conn.getresponse()
        sock_ref[0] = getattr(getattr(getattr(response, 'fp', None), 'raw', None), '_sock', None)
        if response.status != 200: raise RuntimeError('HTTP_%d;redirect_neurmat' % response.status)
        while True:
            line = response.readline()
            if expired.is_set(): signal = 'deadline'; break
            if not line: break
            if not line.startswith(b'data: '): continue
            data = line[6:].strip()
            if data == b'[DONE]': break
            packet = json.loads(data)
            if packet.get('usage'): usage = packet['usage']
            for c in packet.get('choices', []):
                raw += (c.get('delta') or {}).get('content') or ''; finish = c.get('finish_reason') or finish
            signal = guard(raw)
            if signal: break
    except Exception as exc:
        error = type(exc).__name__; signal = 'deadline' if expired.is_set() else signal
    finally:
        timer.cancel()
        try:
            s = sock_ref[0] or conn.sock
            if s: s.shutdown(socket.SHUT_RDWR)
        except OSError: pass
        conn.close()
    ok = finish == 'stop' and not signal and not error and bool(raw.strip())
    return raw, {'ok': ok, 'finish_reason': finish, 'signal': signal, 'guard_event': guard.event, 'error': error,
                 'seconds': round(time.monotonic() - started, 2), 'usage': usage}

_MINERU = {}
_DECUPAJE = threading.local()  # payload-urile data-URI codificate de pipeline in firul citirii curente (provenienta pentru garda)
def _inregistreaza_decupaje(f):
    """mask_and_encode_table_image (mineru_vl_utils) codifica decupajele din tabele -> token_map {token: data-URI}; biblioteca
    pune apoi data-URI-ul in locul tokenului. Le notam aici, in firul care citeste (prepare_for_extract e sincron in two_step_extract)."""
    def w(*a, **k):
        img, token_map = f(*a, **k)
        lst = getattr(_DECUPAJE, 'uris', None)
        if lst is not None: lst.extend(token_map.values())
        return img, token_map
    w.__wrapped__ = f
    return w
def decupaje_garda(uris):
    """Payload-urile JPEG inregistrate, cu multiplicitate (garda scoate fiecare de cel mult atatea ori)."""
    p = 'data:image/jpeg;base64,'
    return [u[len(p):] for u in uris if isinstance(u, str) and u.startswith(p)]
def read_mineru(image_bytes, out_dir, cfg, deadline):
    """Clientul oficial MinerU (two_step_extract + json2md), ca in benchmark (21d). Clientul nu e streaming:
    garda v3 se aplica dupa, ca semnal; termenul se impune cu un fir."""
    endpoint_parts(cfg['endpoint'])
    # transportul MinerU e httpx in biblioteca: fara proxy din mediu pentru loopback (imaginea nu pleaca de pe masina)
    for k in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'MINERU_VL_DEBUG_ENABLE'): os.environ.pop(k, None)  # si fara jurnalul de cereri al bibliotecii
    os.environ['NO_PROXY'] = os.environ['no_proxy'] = '127.0.0.1,::1,localhost'
    from PIL import Image
    import io
    if 'client' not in _MINERU:
        from mineru_vl_utils import MinerUClient
        # Daca alta versiune a bibliotecii nu mai are numele, nu se inregistreaza nimic -> garda fara scutiri (= v4, sigur)
        import mineru_vl_utils.mineru_client as MC
        if hasattr(MC, 'mask_and_encode_table_image') and not hasattr(MC.mask_and_encode_table_image, '__wrapped__'):
            MC.mask_and_encode_table_image = _inregistreaza_decupaje(MC.mask_and_encode_table_image)
        _MINERU['client'] = MinerUClient(backend='http-client', server_url=cfg['endpoint'], model_name=cfg['served_model_name'], image_analysis=True,
                                         http_timeout=int(deadline), max_retries=0, use_tqdm=False)
    from mineru_vl_utils.post_process import json2md
    with (out_dir / 'request_started.json').open('x', encoding='utf-8') as f:
        json.dump({'time': time.time(), 'input_sha256': hashlib.sha256(image_bytes).hexdigest()}, f)
    img = Image.open(io.BytesIO(image_bytes)).convert('RGB'); box = {}
    def work():
        _DECUPAJE.uris = []
        try: box['c'] = _MINERU['client'].two_step_extract(img); box['uris'] = list(_DECUPAJE.uris)
        except BaseException as e: box['e'] = e
        finally: _DECUPAJE.uris = None
    started = time.monotonic(); th = threading.Thread(target=work, daemon=True); th.start(); th.join(float(deadline))
    seconds = round(time.monotonic() - started, 2)
    if th.is_alive(): return '', {'ok': False, 'signal': 'deadline', 'error': None, 'seconds': seconds}
    if 'e' in box: return '', {'ok': False, 'signal': None, 'error': type(box['e']).__name__ + ':' + str(box['e'])[:200], 'seconds': seconds}
    (out_dir / 'layout.json').write_text(json.dumps(box['c'], ensure_ascii=False, indent=1, default=str), encoding='utf-8')
    md = json2md(box['c']); raw = md if isinstance(md, str) else str(md)
    dec = decupaje_garda(box.get('uris', ()))
    g = Guard(dec); signal = g(raw)  # scutite doar decupajele codificate de pipeline in aceasta citire
    return raw, {'ok': not signal and bool(raw.strip()), 'signal': signal, 'guard_event': g.event, 'error': None, 'seconds': seconds,
                 'blocks': len(box['c']), 'decupaje_pipeline': len(dec)}

FUNCS = {'lighton': read_lighton, 'mineru': read_mineru}

def garda_oprita(res):
    """Banda oprita de o garda (bucla, celule goale): rezultat complet ca transport, dar continut respins. Nu termen, nu eroare."""
    return res.get('ok') is False and bool(res.get('signal')) and res.get('signal') != 'deadline' and not res.get('error')

def _garda(band, res):
    ev = res.get('guard_event') or {}
    return {'band': band['id'], 'page': band['page'], 'signal': res.get('signal'), 'detail': ev.get('detail'), 'guard_event': ev}

def backend_idle(cfg, timeout=30.0, poll=0.5):
    """vLLM confirmat liber: /metrics arata 0 cereri in lucru si 0 in asteptare (dupa ce clientul a inchis fluxul oprit de garda)."""
    host, port = endpoint_parts(cfg['endpoint']); end = time.monotonic() + timeout
    def citeste(box):
        # cererea intr-un fir; la termen un timer inchide socketul (curatenie). Termenul il garanteaza join-ul de mai jos:
        # pe Windows shutdown-ul nu deblocheaza prompt un recv (review r6 Jakarinos P2)
        try:
            conn = http.client.HTTPConnection(host, port, timeout=max(0.1, min(5.0, end - time.monotonic())))
            conn.connect(); sock = conn.sock
            def taie():
                try: sock.shutdown(socket.SHUT_RDWR)
                except OSError: pass
            timer = threading.Timer(max(0.0, end - time.monotonic()), taie); timer.daemon = True; timer.start()
            try:
                conn.request('GET', '/metrics'); r = conn.getresponse(); chunks = []; size = 0
                while r.status == 200:
                    if time.monotonic() > end: raise TimeoutError('metrics peste termen')
                    c = r.read1(65536) if hasattr(r, 'read1') else r.read(65536)
                    if not c: break
                    size += len(c); chunks.append(c)
                    if size > 4 << 20: raise ValueError('metrics prea mari')
                box['body'] = b''.join(chunks).decode('utf-8', 'replace')
            finally: timer.cancel(); conn.close()
        except BaseException as e: box['e'] = e
    while True:
        try:
            box = {}; th = threading.Thread(target=citeste, args=(box,), daemon=True); th.start()
            th.join(max(0.0, end - time.monotonic()))
            if th.is_alive() or time.monotonic() > end: return False  # termen ABSOLUT: neconfirmat
            if 'e' in box: raise box['e'] if isinstance(box['e'], (OSError, ValueError, http.client.HTTPException)) else OSError(str(box['e']))
            body = box['body']; vals = {}
            for line in body.splitlines():
                for k in ('vllm:num_requests_running', 'vllm:num_requests_waiting'):
                    if line.startswith(k + '{') or line.startswith(k + ' '): vals[k] = vals.get(k, 0.0) + float(line.rsplit(' ', 1)[1])
            if len(vals) == 2 and not any(vals.values()): return True
        except (OSError, ValueError, http.client.HTTPException): pass
        if time.monotonic() >= end: return False
        time.sleep(max(0.0, min(poll, end - time.monotonic())))  # nici pauza nu trece de termen

def run_reader(plan_dir, reader, *, run_id, check_weights=True, check_server=True, lock=True):
    """Citeste toate benzile planului cu un singur cititor. Termen / eroare de transport / rezultat neconfirmat = oprire (fara reincercare).
    O banda oprita de GARDA (decizie Razvan 14.10) opreste doar banda: dupa confirmarea ca vLLM e liber (/metrics), banda ramane
    incompleta (la incarcare: stare „incomplet” cu motivul si guard_event; la arbitraj: om, fara Claude) si citirea continua.
    Returneaza starea; scrie <banda>/<cititor>/raw.txt + result.json si <plan>/read_<cititor>.json."""
    if reader not in READERS: raise ValueError('Cititor necunoscut')
    plan_dir = pathlib.Path(plan_dir); doc = load_plan(plan_dir); proto = protocol(); cfg = proto['readers'][reader]
    endpoint_parts(cfg['endpoint'])
    state = {'reader': reader, 'run_id': run_id, 'protocol': proto['version'], 'model': cfg['model'], 'started': time.time(),
             'bands': len(doc['bands']), 'done': 0, 'skipped_existing': 0, 'benzi_garda': [], 'status': 'starting'}
    state['weights_sha256'] = verify_weights(cfg) if check_weights else None
    if check_server: verify_server(cfg)
    ctx = gpu_lock(proto['gpu_lock'], run_id) if lock else contextlib.nullcontext({'keep': False})
    with ctx as holder:
        state['status'] = 'running'; save(plan_dir / ('read_%s.json' % reader), state)
        for band in doc['bands']:
            out = plan_dir / ('page%04d' % band['page']) / band['id'] / reader
            out.mkdir(parents=True, exist_ok=True)
            if (out / 'result.json').exists():
                # reluare: rezultatul vechi se refoloseste DOAR daca e complet si al aceluiasi cititor / protocol / greutati / imagine
                old = json.loads((out / 'result.json').read_text(encoding='utf-8'))
                raw_old = (out / 'raw.txt').read_bytes() if (out / 'raw.txt').exists() else None
                acelasi = (old.get('reader') == reader and old.get('protocol') == proto['version']
                           and old.get('weights_sha256') == state['weights_sha256'] and old.get('image_sha256') == band['image_sha256']
                           and raw_old is not None and hashlib.sha256(raw_old).hexdigest() == old.get('raw_sha256'))
                if acelasi and old.get('ok') is True:
                    state['skipped_existing'] += 1; continue
                if acelasi and garda_oprita(old) and old.get('backend_idle_confirmed') is True:  # banda oprita de garda, inchisa curat
                    state['skipped_existing'] += 1; state['benzi_garda'].append(_garda(band, old)); continue
                state.update(status='interrupted_needs_review', band=band['id'], motiv='rezultat existent incompatibil'); break
            if (out / 'request_started.json').exists():
                state.update(status='interrupted_needs_review', band=band['id']); break
            data = (plan_dir / band['image']).read_bytes()
            holder['keep'] = True  # GPU-ul e 'ocupat' din momentul cererii pana cand rezultatul complet e scris pe disc
            raw, result = FUNCS[reader](data, out, cfg, proto['deadline_seconds'])
            (out / 'raw.txt').write_bytes(raw.encode('utf-8'))  # octeti exacti: hash-ul nu depinde de CRLF pe Windows
            result.update(band=band['id'], reader=reader, image_sha256=band['image_sha256'], raw_sha256=hashlib.sha256(raw.encode()).hexdigest(),
                          protocol=proto['version'], weights_sha256=state['weights_sha256'], run_id=run_id, backend_idle_confirmed=False)
            save(out / 'result.json', result); state['done'] += 1
            if result['ok']: holder['keep'] = False
            if not result['ok'] and garda_oprita(result) and backend_idle(cfg):
                # doar banda: fluxul e inchis de client si vLLM e confirmat liber -> se marcheaza si se trece la banda urmatoare
                result['backend_idle_confirmed'] = True; save(out / 'result.json', result)
                holder['keep'] = False; state['benzi_garda'].append(_garda(band, result)); continue
            if not result['ok']:
                holder['keep'] = True  # termen, eroare de transport, garda fara vLLM confirmat liber: backend-ul nu e confirmat idle
                state.update(status='stopped_no_retry', band=band['id'], result=result, gpu_lock_pastrat=holder['keep']); break
        else:
            state['status'] = 'complete'
        state['finished'] = time.time(); save(plan_dir / ('read_%s.json' % reader), state)
    return state
