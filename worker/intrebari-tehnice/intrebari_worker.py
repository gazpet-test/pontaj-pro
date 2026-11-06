"""Worker „❓ Întreabă echipa” (05.11.2026, migrarea 20261105a, edge intrebari-tehnice-worker) — rulează pe serverul AI (Gazpet-Claude).

O rulare = preia până la MAX_PE_RULARE întrebări noi, răspunde cu Claude prin API (cheia din Credential Manager,
'anthropic-claude-code'/'api' — NU abonamentul: abonamentul nu devine backend pentru alți utilizatori, vezi worker/claude-cli/README.md),
scrie răspunsul înapoi prin edge. Pornit de Task Scheduler la 2 minute („Intrebari tehnice worker (Gazpet)”).

Din 06.11.2026 (migrarea 20261131e, cerere Silviu + Răzvan) răspunsul vine DIN CERCETARE, cu surse (cercetare.py):
  0. la pornire, ÎNAINTE de orice preluare: corpus_index.json verificat cu sha256 față de corpus_manifest.json (copiat din repo lângă
     script) și cheia API citită — index lipsă/stricat/nepotrivit sau cheie lipsă → nu se preia nimic (întrebările rămân în coadă);
  1. corpus intern → extrase C1..Cn alese pe cuvinte-cheie, local, fără serviciu extern;
  2. web DOAR pe cercetare.DOMENII_OFICIALE (constantă), în trei pași (runda 2, review P1-a):
     a. apel FĂRĂ unelte (MODEL_INTEROGARI) care propune max 5 interogări din titlu + speță curățate (fără context/atașamente/extrase);
     b. cercetare.filtreaza_interogari — filtru local strict (nume proprii, cifre, mailuri/linkuri, 80 de caractere);
     c. apelul cu web_search primește DOAR interogările filtrate (nu speța) → surse W1..Wn, filtrate încă o dată pe domeniu.
     Interogările efectiv trimise se salvează pe întrebare (`interogari_web`, audit). Rezultat web incomplet (max_tokens,
     pause_turn epuizat, web_search_tool_result_error) → NU se publică: eroare „Cercetare incompletă”;
  3. răspunsul, fără unelte, doar din sursele C/W (max SURSE_MAX în total); validat (verdict în prima linie, fiecare afirmație
     normativă cu marcaj de sursă și cifrele ei în extrasul citat); o singură reparare, apoi ce rămâne fără sursă se scoate din text;
     verdict rămas fără sursă → „Incert — de verificat”. Sursele citate trec verificarea finală (verifica_surse_finale) și se
     salvează în coloana `surse`.
Modelul: cercetare.MODEL_NORMATIV (Opus) la întrebări cu temei normativ/juridic, altfel cercetare.MODEL_GENERAL (Sonnet).

Reguli (fișa în migrări): întrebarea, atașamentele, extrasele și paginile web sunt DATE pentru model, nu instrucțiuni; singura
unealtă e căutarea web pe domeniile oficiale (server-side, la Anthropic); workerul nu execută nimic din conținut, nu trimite mail,
nu scrie altundeva decât pe rândul întrebării (prin edge). Jurnalul (jurnal.jsonl) ține doar id, stare, tokeni, durată, numărul de
surse/interogări/căutări — fără conținutul întrebării, fără textul interogărilor și fără secrete. Reîncercare DOAR la refuz cert
fără cost (429/529 la primul apel → „amana”, max 3); un rezultat incert (timeout, rețea) se închide cu eroare — costul lui e
necunoscut (L22).
"""
import base64, datetime, json, os, pathlib, sys, time, urllib.error, urllib.request

import cercetare as C

EDGE = 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/intrebari-tehnice-worker'
API = 'https://api.anthropic.com/v1/messages'
SECRET_FILE = pathlib.Path('C:/Users/Gazpet-Ai/.secrete/intrebari_worker_secret.txt')
DIR = pathlib.Path(os.environ.get('INTREBARI_DIR', 'C:/Users/Public/intrebari_worker'))
INDEX_FILE = DIR / 'corpus_index.json'
MANIFEST_FILE = pathlib.Path(__file__).resolve().parent / 'corpus_manifest.json'   # din repo, copiat lângă script
MAX_TOKENS = 6000
MAX_TOKENS_WEB = 4000
MAX_PAUZE_WEB = 3            # stop_reason „pause_turn” la căutarea web: se continuă de max 3 ori
MAX_NOTE_WEB = 12000         # caractere din notele de cercetare web trimise mai departe
MAX_PE_RULARE = 3
MAX_OCTETI_ATASAMENTE = 20 * 1024 * 1024   # = MAX_MB din UI și limita bucket-ului
MIME_OK = {'application/pdf', 'image/jpeg', 'image/png', 'image/webp'}
TOKENI_CHEI = ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')


def acum(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def jurnal(**k):
    DIR.mkdir(parents=True, exist_ok=True)
    with (DIR / 'jurnal.jsonl').open('a', encoding='utf-8') as f:
        f.write(json.dumps({'la': acum(), **k}, ensure_ascii=False) + '\n')


class _FaraRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _FaraRedirect())


def edge(secret, corp):
    req = urllib.request.Request(EDGE, data=json.dumps(corp, ensure_ascii=False).encode('utf-8'), method='POST',
                                 headers={'Content-Type': 'application/json', 'x-intrebari-secret': secret})
    try:
        with OPENER.open(req, timeout=60) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}


def descarca(url, ramas):
    with OPENER.open(urllib.request.Request(url), timeout=120) as r:
        date = r.read(ramas + 1)
    if len(date) > ramas: raise ValueError('prea mare')
    return date


def cheie_api():
    import keyring
    k = (keyring.get_password('anthropic-claude-code', 'api') or '').strip()
    if not k: raise RuntimeError('cheia API lipsește din Credential Manager (anthropic-claude-code / api)')
    return k


class AtasamentIndisponibil(Exception):
    pass


def construieste_atasamente(q):
    """Toate atașamentele sau nimic: un document lipsă ar face analiza să pară completă (review P1-3)."""
    blocuri, ramas = [], MAX_OCTETI_ATASAMENTE
    for a in q.get('atasamente') or []:
        nume, mime, url = a.get('nume') or 'atasament', a.get('mime') or '', a.get('url')
        if mime not in MIME_OK or not url: raise AtasamentIndisponibil(nume)
        try:
            date = descarca(url, ramas)
        except Exception:
            raise AtasamentIndisponibil(nume)
        ramas -= len(date)
        sursa = {'type': 'base64', 'media_type': mime, 'data': base64.b64encode(date).decode('ascii')}
        blocuri.append({'type': 'document' if mime == 'application/pdf' else 'image', 'source': sursa})
        blocuri.append({'type': 'text', 'text': f'(Atașamentul de mai sus: „{C.neutralizeaza(nume)}”)'})
    return blocuri


def text_speta(q):
    """Speța ca DATE între tag-uri; conținutul e neutralizat (nu poate închide <speta> sau deschide <surse>)."""
    N = C.neutralizeaza
    text = f"<speta>\n<titlu>{N(q.get('titlu'))}</titlu>\n"
    if q.get('context'): text += f"<context>{N(q['context'])}</context>\n"
    return text + f"<intrebare>\n{N(q.get('intrebare'))}\n</intrebare>\n</speta>"


def mesaj_interogari(q):
    """Pasul FĂRĂ unelte care propune interogările: titlu + speță curățate. Fără context, atașamente sau extrase interne.
    Acest text NU ajunge la apelul cu web_search — acolo intră doar interogările filtrate (C.mesaj_interogari_web)."""
    return (f'<speta>\n{C.curata_interogare(q.get("titlu"), q.get("intrebare"))}\n</speta>\n\n'
            'Propune interogările de căutare pentru speța de mai sus, după regulile tale.')


def mesaj_raspuns(q, surse, note_web):
    t = text_speta(q) + '\n\n' + C.bloc_surse(surse)
    if note_web:
        t += ('\n\n<note_cercetare_web>\n(Rezumatul documentaristului după căutarea pe site-urile oficiale. NU e sursă în sine: '
              'folosește din el doar ce se regăsește într-o sursă W sau C de mai sus și citează acea sursă.)\n'
              f'{C.neutralizeaza(note_web[:MAX_NOTE_WEB])}\n</note_cercetare_web>')
    return t + '\n\nRăspunde la speța de mai sus DOAR din <surse>, după regulile tale.'


def aduna_tokeni(total, r):
    """Adună consumul unui apel (tokeni + căutări web) în `total`."""
    u = (r or {}).get('usage') or {}
    for k in TOKENI_CHEI:
        if isinstance(u.get(k), int): total[k] = total.get(k, 0) + u[k]
    n = (u.get('server_tool_use') or {}).get('web_search_requests')
    if isinstance(n, int): total['web_search_requests'] = total.get('web_search_requests', 0) + n
    total['apeluri'] = total.get('apeluri', 0) + 1
    return total


def text_raspuns(r):
    return ''.join(b.get('text', '') for b in (r or {}).get('content') or [] if b.get('type') == 'text').strip()


def apel(cheie, corp):
    """(status, corp). status None = rezultat INCERT (timeout / rețea după trimitere): costul e necunoscut, nu se reia."""
    req = urllib.request.Request(API, data=json.dumps(corp).encode('utf-8'), method='POST',
                                 headers={'content-type': 'application/json', 'x-api-key': cheie, 'anthropic-version': '2023-06-01'})
    try:
        with OPENER.open(req, timeout=600) as r: return 200, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}
    except Exception:
        return None, {}


def proceseaza(secret, cheie, q, corpus):
    t0, qid, inc = time.time(), q['id'], q['incercare']
    total = {}            # consumul tuturor apelurilor acestei preluări (web + răspuns + reparare)
    def tok(incert=False):
        t = dict(total)
        if incert or (not t.get('input_tokens') and t.get('apeluri')): t['cost_necunoscut'] = True
        return t or None
    def scrie(corp):   # scrierea rezultatului se reîncearcă (max 3, fără să repete apelul AI); 409 = preluarea nu mai e a noastră
        st = None
        for i in range(3):
            st, _ = edge(secret, corp)
            if st in (200, 400, 409): return st
            time.sleep(5 * (i + 1))
        return st
    trimise = []          # interogările EFECTIV trimise la web_search — ajung în BD și la erori (audit)
    def eroare(mesaj, tokeni=None, **k):   # tokenii (sau „necunoscut”) ajung în BD și la erori — evidența costului (review r2 P1-2)
        corp = {'actiune': 'eroare', 'id': qid, 'incercare': inc, 'eroare': mesaj, 'interogari': list(trimise)}
        if tokeni: corp['tokeni'] = tokeni
        st = scrie(corp)
        jurnal(id=qid, stare='eroare', scriere=st, tokeni=tokeni, cautari=len(trimise), **k)
    def incomplet(detaliu):   # P2 r2: un rezultat web incomplet nu se publică — eroare distinctă, vizibilă autorului
        return eroare('Cercetare incompletă: căutarea pe site-urile oficiale nu s-a terminat. Pune întrebarea din nou mai târziu.',
                      tokeni=tok(), motiv='cercetare_incompleta', detaliu=detaliu, faza='web')
    def esec(status, r, faza):
        if status is None:   # L22: rezultat incert — nu se reia automat, rămâne evidența în jurnal
            return eroare('Serviciul AI nu a răspuns la timp. Pune întrebarea din nou.', tokeni=tok(incert=True), motiv='incert', faza=faza)
        tip = ((r or {}).get('error') or {}).get('type', '')
        if status in (429, 529) or tip in ('overloaded_error', 'rate_limit_error'):
            if not total:   # refuz CERT la primul apel, fără niciun cost → înapoi în coadă
                st, _ = edge(secret, {'actiune': 'amana', 'id': qid, 'incercare': inc})
                return jurnal(id=qid, stare='amanat', http=status, scriere=st, faza=faza)
            # pașii de dinainte au costat deja: nu se reia automat (s-ar plăti din nou), se închide cu eroare vizibilă
            return eroare('Serviciul AI a fost ocupat în timpul cercetării. Pune întrebarea din nou mai târziu.', tokeni=tok(), http=status, motiv=tip, faza=faza)
        brut = json.dumps(r).lower()
        mesaj = 'Limita lunară a contului API a fost atinsă' if 'credit' in brut or 'billing' in brut else f'Răspunsul AI a eșuat (HTTP {status})'
        # 4xx de validare/credit = respins înainte de generare; 5xx = incert (review r3 P2-4)
        return eroare(mesaj, tokeni=tok(incert=status >= 500), http=status, motiv=tip or 'http', faza=faza)

    try:
        atasamente = construieste_atasamente(q)
    except AtasamentIndisponibil as e:
        return eroare(f'Atașamentul „{str(e)[:100]}” nu a putut fi citit. Pune întrebarea din nou.', motiv='atasament')
    model = C.alege_model(q.get('titlu'), q.get('intrebare'), q.get('context'))

    # 1. corpusul intern (local; contextul de proiect poate ajuta la alegerea extraselor și nu iese din server)
    extrase = C.selecteaza_extrase(corpus, ' '.join(str(q.get(k) or '') for k in ('titlu', 'intrebare', 'context')))

    # 2a. interogările: apel FĂRĂ unelte, doar pe titlu + speță curățate
    status, r = apel(cheie, {'model': C.MODEL_INTEROGARI, 'max_tokens': C.MAX_TOKENS_INTEROGARI, 'system': C.SISTEM_INTEROGARI,
                             'messages': [{'role': 'user', 'content': mesaj_interogari(q)}]})
    if status != 200: return esec(status, r, 'interogari')
    aduna_tokeni(total, r)
    if r.get('stop_reason') == 'refusal':
        return eroare('Cercetarea a fost refuzată de serviciul AI. Reformulează întrebarea.', tokeni=tok(), motiv='refusal', faza='interogari')
    if r.get('stop_reason') not in ('end_turn', 'stop_sequence'): return incomplet(f'interogari_{r.get("stop_reason")}')
    # 2b. filtrul local strict: ce nu trece se aruncă (nume proprii, cifre din speță, mailuri/linkuri, > 80 de caractere)
    interogari = C.filtreaza_interogari(C.interogari_din_raspuns(text_raspuns(r)))

    # 2c. web DOAR pe domeniile oficiale, DOAR cu interogările filtrate (speța nu intră în acest apel)
    blocuri_web = []
    if interogari:
        mesaje, oprire = [{'role': 'user', 'content': C.mesaj_interogari_web(interogari)}], None
        for _ in range(MAX_PAUZE_WEB + 1):
            ramase = C.WEB_MAX_CAUTARI - len(trimise)   # plafonul de căutări e pe ÎNTREBARE, nu pe cerere (continuările îl consumă)
            if ramase <= 0: return incomplet('cautari_epuizate')
            status, r = apel(cheie, {'model': model, 'max_tokens': MAX_TOKENS_WEB, 'system': C.SISTEM_CERCETARE,
                                     'messages': mesaje, 'tools': [C.unealta_web(ramase)]})
            if status != 200: return esec(status, r, 'web')
            aduna_tokeni(total, r)
            blocuri_web += r.get('content') or []
            trimise[:] = C.interogari_web(blocuri_web)
            oprire = r.get('stop_reason')
            if oprire == 'refusal':
                return eroare('Cercetarea a fost refuzată de serviciul AI. Reformulează întrebarea.', tokeni=tok(), motiv='refusal', faza='web')
            if oprire != 'pause_turn': break
            mesaje = mesaje + [{'role': 'assistant', 'content': r.get('content') or []}]
        if oprire == 'pause_turn': return incomplet('pause_turn_epuizat')
        if oprire not in ('end_turn', 'stop_sequence'): return incomplet(f'web_{oprire}')
        motiv = C.web_incomplet(blocuri_web)
        if motiv: return incomplet(motiv)
    web = C.surse_web(blocuri_web, start=1, maxim=max(0, C.SURSE_MAX - len(extrase)))
    note_web = text_raspuns({'content': blocuri_web})
    surse = extrase + web
    if len(surse) > C.SURSE_MAX:   # plafonul total C + W înainte de generare (P2 r2)
        return eroare('Eroare internă la cercetare (prea multe surse). Pune întrebarea din nou.', tokeni=tok(), motiv='surse_plafon')
    ids = [s['id'] for s in surse]

    # 3. răspunsul, fără unelte, doar din surse
    status, r = apel(cheie, {'model': model, 'max_tokens': MAX_TOKENS, 'system': C.SISTEM_RASPUNS,
                             'messages': [{'role': 'user', 'content': atasamente + [{'type': 'text', 'text': mesaj_raspuns(q, surse, note_web)}]}]})
    if status != 200: return esec(status, r, 'raspuns')
    aduna_tokeni(total, r)
    text, oprire = text_raspuns(r), r.get('stop_reason')
    if oprire not in ('end_turn', 'stop_sequence'):   # L21: refuz / tăiat la limită = nu e un răspuns valid
        return eroare('Răspunsul AI a fost refuzat sau a ieșit incomplet. Reformulează sau împarte întrebarea.', motiv=str(oprire), tokeni=tok())
    if not text or len(text) > 60000:
        return eroare('Răspunsul AI a fost gol sau prea lung.', motiv='lungime', tokeni=tok())

    # 4. validare → o singură reparare (fără atașamente: e doar despre marcaje) → ce rămâne fără sursă se scoate
    analiza, reparat = C.analizeaza(text, surse), False
    if not analiza['verdict'] or analiza['fara_sursa'] or analiza['necunoscute']:
        st2, r2 = apel(cheie, {'model': model, 'max_tokens': MAX_TOKENS, 'system': C.SISTEM_RASPUNS, 'messages': [
            {'role': 'user', 'content': mesaj_raspuns(q, surse, note_web)},
            {'role': 'assistant', 'content': text},
            {'role': 'user', 'content': C.mesaj_reparare(analiza, ids)}]})
        if st2 == 200:
            aduna_tokeni(total, r2)
            t2 = text_raspuns(r2)
            if r2.get('stop_reason') in ('end_turn', 'stop_sequence') and t2 and len(t2) <= 60000: text, reparat = t2, True
        elif st2 is None or st2 >= 500:
            total['cost_necunoscut'] = True   # repararea a eșuat incert; răspunsul inițial merge mai departe, curățat
    final, scoase = C.curata_raspuns(text, surse)
    citate = C.analizeaza(final, surse)['citate']
    try:   # verificarea finală pe setul care se persistă (P2 r2): nu se publică un set de surse invalid
        surse_finale = C.verifica_surse_finale(C.surse_citate(surse, citate), ids)
    except ValueError:
        return eroare('Sursele răspunsului nu au trecut verificarea finală. Pune întrebarea din nou.', tokeni=tok(), motiv='surse_invalide')
    tokeni = tok()
    st = scrie({'actiune': 'raspunde', 'id': qid, 'incercare': inc, 'raspuns_md': final, 'model': r.get('model') or model,
                'tokeni': tokeni, 'surse': surse_finale, 'interogari': list(trimise)})
    jurnal(id=qid, stare='raspuns' if st == 200 else f'scriere_{st}', model=r.get('model'), tokeni=tokeni, sec=round(time.time() - t0, 1),
           extrase=len(extrase), surse_web=len(web), interogari=len(interogari), cautari=len(trimise), citate=len(surse_finale),
           reparat=reparat, scoase=scoase, incert=C.e_incert(final))


def incarca_corpus(index_file=None, manifest_file=None):
    """Indexul corpusului, verificat (sha256 = manifestul din repo) și pregătit; None dacă lipsește, e stricat sau nu se potrivește
    cu manifestul (workerul nu preia nimic fără el — fail closed, întrebările rămân în coadă)."""
    try:
        manifest = json.loads((manifest_file or MANIFEST_FILE).read_text(encoding='utf-8'))
        index = C.index_verificat((index_file or INDEX_FILE).read_bytes(), manifest)
        if index is None: return None
        p = C.pregateste_index(index)
        return p if p['bucati'] else None
    except Exception:
        return None


def main():
    import msvcrt
    DIR.mkdir(parents=True, exist_ok=True)
    f = open(DIR / 'worker.lock', 'a+b')   # lock de sistem: se eliberează singur la ieșirea procesului (review P2-6)
    try:
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        f.close(); return 0   # altă rulare e în curs
    try:
        # P2 r2: corpusul (verificat cu manifestul) și cheia API se încarcă ÎNAINTE de „preia” — un index lipsă/stricat/nepotrivit
        # sau o cheie lipsă nu consumă întrebări: ele rămân în coadă până se repară serverul.
        corpus = incarca_corpus()
        if corpus is None:
            jurnal(stare='corpus_invalid'); return 1
        secret = SECRET_FILE.read_text(encoding='utf-8').strip()
        if len(secret) != 64: raise RuntimeError('secret')
        cheie = cheie_api()
        for _ in range(MAX_PE_RULARE):
            st, r = edge(secret, {'actiune': 'preia'})
            if st != 200: jurnal(stare='preia_esuat', http=st); return 1
            q = r.get('intrebare')
            if not q: return 0
            try:
                proceseaza(secret, cheie, q, corpus)
            except Exception as e:   # neprevăzut: se închide cu eroare vizibilă; BD închide oricum după 30 min
                jurnal(id=q.get('id'), stare='exceptie', eroare=type(e).__name__)
                try: edge(secret, {'actiune': 'eroare', 'id': q['id'], 'incercare': q['incercare'], 'eroare': 'Eroare internă la procesare. Pune întrebarea din nou.'})
                except Exception: pass
        return 0
    except Exception as e:
        jurnal(stare='exceptie_rulare', eroare=type(e).__name__)   # doar tipul: fără text care ar putea conține date
        return 1
    finally:
        try: msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError: pass
        f.close()


if __name__ == '__main__':
    sys.exit(main())
