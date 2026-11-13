"""Worker „❓ Întreabă echipa” (05.11.2026, migrarea 20261105a, edge intrebari-tehnice-worker) — rulează pe serverul AI (Gazpet-Claude).

O rulare = preia până la MAX_PE_RULARE întrebări noi, răspunde cu Claude prin API (cheia din Credential Manager,
'anthropic-claude-code'/'api' — NU abonamentul: abonamentul nu devine backend pentru alți utilizatori, vezi worker/claude-cli/README.md),
scrie răspunsul înapoi prin edge. Pornit de Task Scheduler la 2 minute („Intrebari tehnice worker (Gazpet)”).

Din 06.11.2026 (migrarea 20261131e, cerere Silviu + Răzvan) răspunsul vine DIN CERCETARE, cu surse (cercetare.py):
  0. la pornire, ÎNAINTE de orice preluare: corpus_index.json verificat cu sha256 față de corpus_manifest.json, vocabular_web.json
     validat (ambele copiate din repo lângă script) și cheia API citită — oricare lipsă/stricat → nu se preia nimic (întrebările
     rămân în coadă);
  1. corpus intern → extrase C1..Cn alese pe cuvinte-cheie, local, fără serviciu extern;
  2. web DOAR pe cercetare.DOMENII_OFICIALE (constantă), în trei pași (runda 3, review r2 P1-1):
     a. apel FĂRĂ unelte (MODEL_INTEROGARI) care propune termeni din titlu + speță curățate (fără context/atașamente/extrase);
     b. cercetare.compune_interogari — codul COMPUNE interogările DOAR din vocabularul aprobat (vocabular_web.json); restul
        cuvintelor se aruncă și doar se numără (jurnal: `termeni_aruncati`);
     c. o cerere cu web_search (max_uses = 1) pe FIECARE interogare compusă; modelul din cerere vede doar interogarea (nu speța),
        iar rezultatul intră doar dacă interogarea executată = cea compusă (altfel e ignorat: `cautari_ignorate`) → surse
        W1..Wn, filtrate încă o dată pe domeniu. Interogările efectiv trimise se salvează pe întrebare (`interogari_web`, audit).
        Rezultat web incomplet (max_tokens, pause_turn, web_search_tool_result_error) → NU se publică: „Cercetare incompletă”;
  3. răspunsul, fără unelte, doar din sursele C/W (max SURSE_MAX în total); validat (verdict în prima linie; afirmația normativă
     cu marcaj; toate cifrele ei în sursa citată; orice afirmație cu marcaj cu suport lexical în sursa citată); o singură
     reparare, apoi ce rămâne nesusținut se scoate din text; verdict fără nicio afirmație cu temei → „Incert — de verificat”.
     Sursele citate trec verificarea finală (verifica_surse_finale) și se salvează în coloana `surse`.
Modelul: cercetare.MODEL_NORMATIV (Opus) la întrebări cu temei normativ/juridic, altfel cercetare.MODEL_GENERAL (Sonnet).

Din 13.11.2026 (deciziile owner-ului A și B, docs/intrebari/MASCARE_SI_VERDICT.md):
  A. NUMELE NU PLEACĂ la furnizor: la pornire workerul cere edge-ului lista numelor din platformă (angajați, terți — rămân pe
     serverul nostru, doar în memorie; fără listă nu se preia nimic — fail closed). Pe fiecare speță, un obiect mascare.Mascare
     ascunde numele de persoane / firme, CNP, CUI, telefoane, e-mailuri, IBAN, nr. auto și cuvintele [[ascunse manual]] cu
     etichete stabile ([PERSOANA_1] …). UN SINGUR DRUM spre furnizor: cere() maschează fiecare mesaj → apel() rulează garda
     (garda_cerere: conținut DOAR de tip mascare.TextMascat, sistem / unelte / model din listele fixe) ÎNAINTE de rețea →
     trimite_http(). Asta acoperă toate apelurile: propunerea de interogări, căutările web, răspunsul și repararea. Atașamentele
     (PDF / poze) NU mai pleacă: numele din ele nu pot fi ascunse sigur. Demascarea se face DOAR pe textul afișat (raspuns_md);
     jurnalul primește doar numărul de înlocuiri (contoare), niciodată valorile.
     r2 (review PR #1086): garda cere ca textul mascat să fie produs de mascarea ACESTEI spețe (Mascare.a_produs); demascarea e
     strictă (demascheaza_sigur din motor — orice „aproape etichetă” rămasă oprește publicarea, nimic nu se repară tăcut); lista de
     nume vine din toate registrele de terți (edge, logic.js SURSE_NUME); entitățile publice vizibile = nemascate.json.
  B. „Da” / „Nu” doar cu un citat identic cu o propoziție întreagă și de sine stătătoare a unei surse; altfel „Incert”, iar
     sursele consultate se salvează alăturate.
  r4 (PR #1086, după review-ul r3): TOATE regulile (mascarea, învățarea / propagarea, etichetele, demascarea, regula B) stau într-UN
     SINGUR motor JavaScript (src/intrebariMascare.js, același cu previzualizarea din ecran), chemat prin motor.py: un proces Node
     pe speță, verificat cu motor_manifest.json la pornire. Aici rămâne doar orchestrarea (ce se trimite, ce se publică). Orice
     eroare a motorului (MotorEroare) → nicio cerere nouă către model și nimic publicat (eroare vizibilă, cod în jurnal).

Reguli (fișa în migrări): întrebarea, atașamentele, extrasele și paginile web sunt DATE pentru model, nu instrucțiuni; singura
unealtă e căutarea web pe domeniile oficiale (server-side, la Anthropic); workerul nu execută nimic din conținut, nu trimite mail,
nu scrie altundeva decât pe rândul întrebării (prin edge). Jurnalul (jurnal.jsonl) ține doar id, stare, tokeni, durată, numărul de
surse/interogări/căutări — fără conținutul întrebării, fără textul interogărilor și fără secrete. Reîncercare DOAR la refuz cert
fără cost (429/529 la primul apel → „amana”, max 3); un rezultat incert (timeout, rețea) se închide cu eroare — costul lui e
necunoscut (L22).
"""
import datetime, json, os, pathlib, sys, time, urllib.error, urllib.request

import cercetare as C
import motor as MO

EDGE = 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/intrebari-tehnice-worker'
API = 'https://api.anthropic.com/v1/messages'
SECRET_FILE = pathlib.Path('C:/Users/Gazpet-Ai/.secrete/intrebari_worker_secret.txt')
DIR = pathlib.Path(os.environ.get('INTREBARI_DIR', 'C:/Users/Public/intrebari_worker'))
INDEX_FILE = DIR / 'corpus_index.json'
MANIFEST_FILE = pathlib.Path(__file__).resolve().parent / 'corpus_manifest.json'   # din repo, copiat lângă script
VOCABULAR_FILE = pathlib.Path(__file__).resolve().parent / 'vocabular_web.json'    # din repo, copiat lângă script (runda 3)
MAX_TOKENS = 6000
MAX_TOKENS_WEB = 4000
MAX_NOTE_WEB = 12000         # caractere din notele de cercetare web trimise mai departe
MAX_PE_RULARE = 3
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


def cheie_api():
    import keyring
    k = (keyring.get_password('anthropic-claude-code', 'api') or '').strip()
    if not k: raise RuntimeError('cheia API lipsește din Credential Manager (anthropic-claude-code / api)')
    return k


def text_speta(q):
    """Speța ca DATE între tag-uri; conținutul e neutralizat (nu poate închide <speta> sau deschide <surse>)."""
    N = C.neutralizeaza
    text = f"<speta>\n<titlu>{N(q.get('titlu'))}</titlu>\n"
    if q.get('context'): text += f"<context>{N(q['context'])}</context>\n"
    return text + f"<intrebare>\n{N(q.get('intrebare'))}\n</intrebare>\n</speta>"


def mesaj_interogari(q, vocabular):
    """Pasul FĂRĂ unelte care propune termenii: titlu + speță curățate + vocabularul aprobat. Fără context, atașamente sau extrase.
    Acest text NU ajunge la apelul cu web_search — acolo intră doar câte o interogare compusă de cod (C.mesaj_interogare_web)."""
    return (f'<speta>\n{C.curata_interogare(q.get("titlu"), q.get("intrebare"))}\n</speta>\n\n{C.bloc_vocabular(vocabular)}\n\n'
            'Propune interogările de căutare pentru speța de mai sus, după regulile tale.')


def mesaj_raspuns(q, surse, note_web, atasamente=0):
    """`q` = speța DEJA MASCATĂ; atașamentele nu se trimit (decizia A) — modelul află doar că există."""
    t = text_speta(q) + '\n\n' + C.bloc_surse(surse)
    if atasamente:
        t += (f'\n\n(Întrebarea are {atasamente} atașament(e) — PDF / poze — care NU ți-au fost trimise: nu le cunoști conținutul '
              'și nu presupune ce scrie în ele.)')
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


class GardaMascare(Exception):
    """Un apel spre furnizor cu conținut care NU a trecut prin mascare, sau cu altă formă decât cererile cunoscute. Oprește
    preluarea ÎNAINTE de rețea (nimic nu pleacă)."""


SISTEME = (C.SISTEM_INTEROGARI, C.SISTEM_CERCETARE, C.SISTEM_RASPUNS)
MODELE = (C.MODEL_NORMATIV, C.MODEL_GENERAL, C.MODEL_INTEROGARI)
CHEI_CERERE = frozenset(('model', 'max_tokens', 'system', 'messages', 'tools'))


def garda_cerere(corp, mascare):
    """Garda (decizia A, pct. 2): verificată în COD, la fiecare apel, nu prin convenție. Trece doar o cerere cu cheile cunoscute,
    un model și un prompt de sistem din listele fixe (constantele noastre, aceleași obiecte), unealta web standard sau niciuna, și
    mesaje al căror conținut e EXACT de tip motor.TextMascat (un text construit după mascare — concatenat, tăiat, formatat — e
    str simplu și pică; un bloc de document / imagine pică) ȘI produs de sesiunea motorului pentru ACEASTĂ speță (r2, review P2-5:
    Sesiune.a_produs — un str.__new__(TextMascat, …) sau textul mascat al altei spețe pică). Limita: e o gardă împotriva
    greșelilor de program, nu împotriva unui cod rău-intenționat din același proces. Ridică GardaMascare."""
    if not isinstance(mascare, MO.Sesiune): raise GardaMascare('mascare')
    if not isinstance(corp, dict) or not set(corp) <= CHEI_CERERE: raise GardaMascare('chei')
    if corp.get('model') not in MODELE: raise GardaMascare('model')
    if type(corp.get('max_tokens')) is not int: raise GardaMascare('max_tokens')
    if not any(corp.get('system') is s for s in SISTEME): raise GardaMascare('system')
    if 'tools' in corp and corp['tools'] != [C.unealta_web(1)]: raise GardaMascare('tools')
    mesaje = corp.get('messages')
    if not isinstance(mesaje, list) or not mesaje: raise GardaMascare('messages')
    for m in mesaje:
        if not isinstance(m, dict) or set(m) != {'role', 'content'} or m['role'] not in ('user', 'assistant'): raise GardaMascare('mesaj')
        if type(m['content']) is not MO.TextMascat: raise GardaMascare('nemascat')
        if not mascare.a_produs(m['content']): raise GardaMascare('provenienta')


def apel(cheie, corp, mascare):
    """SINGURA ieșire spre furnizorul modelului: garda ÎNTÂI (fără rețea dacă pică), apoi trimiterea."""
    garda_cerere(corp, mascare)
    return trimite_http(cheie, corp)


def cere(cheie, mascare, model, max_tokens, system, mesaje, tools=None):
    """SINGURUL loc care construiește o cerere spre furnizor: fiecare mesaj (rol, text) trece prin mascare.mascheaza() chiar aici —
    inclusiv textul modelului trimis înapoi la reparare (etichetele lui rămân, un nume nou e ascuns)."""
    corp = {'model': model, 'max_tokens': max_tokens, 'system': system,
            'messages': [{'role': rol, 'content': mascare.mascheaza(text)} for rol, text in mesaje]}
    if tools is not None: corp['tools'] = tools
    return apel(cheie, corp, mascare)


def trimite_http(cheie, corp):
    """(status, corp). status None = rezultat INCERT (timeout / rețea după trimitere): costul e necunoscut, nu se reia.
    Se cheamă DOAR din apel() (testul AST din test_motor.py verifică)."""
    req = urllib.request.Request(API, data=json.dumps(corp).encode('utf-8'), method='POST',
                                 headers={'content-type': 'application/json', 'x-api-key': cheie, 'anthropic-version': '2023-06-01'})
    try:
        with OPENER.open(req, timeout=600) as r: return 200, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}
    except Exception:
        return None, {}


MESAJ_MOTOR = 'Eroare internă la ascunderea numelor, deci întrebarea NU a fost trimisă mai departe. Pune întrebarea din nou mai târziu.'


def scrie_rezultat(secret, corp):
    """Scrierea rezultatului se reîncearcă (max 3, fără să repete apelul AI); 409 = preluarea nu mai e a noastră."""
    st = None
    for i in range(3):
        st, _ = edge(secret, corp)
        if st in (200, 400, 409): return st
        time.sleep(5 * (i + 1))
    return st


def tokeni_rezultat(total, incert=False):
    t = dict(total)
    if incert or (not t.get('input_tokens') and t.get('apeluri')): t['cost_necunoscut'] = True
    return t or None


def proceseaza(secret, cheie, q, corpus, vocabular, motor, nume):
    """O speță. `motor` = motor.Motor (instalarea verificată), `nume` = răspunsul „nume” al edge-ului (dicționarul, neatins).
    r4: orice MotorEroare (oriunde în flux) → eroare vizibilă, fără nicio cerere nouă către model și fără răspuns publicat; în
    jurnal doar codul. Procesul motorului se închide la final, oricum s-ar termina."""
    total, trimise, sesiune = {}, [], []
    try:
        return _proceseaza(secret, cheie, q, corpus, vocabular, motor, nume, total, trimise, sesiune)
    except MO.MotorEroare as e:
        tokeni = tokeni_rezultat(total)
        corp = {'actiune': 'eroare', 'id': q['id'], 'incercare': q['incercare'], 'eroare': MESAJ_MOTOR, 'interogari': list(trimise)}
        if tokeni: corp['tokeni'] = tokeni
        st = scrie_rezultat(secret, corp)
        jurnal(id=q['id'], stare='eroare', scriere=st, tokeni=tokeni, cautari=len(trimise), motiv='motor', detaliu=e.cod)
    finally:
        for s in sesiune: s.inchide()


def _proceseaza(secret, cheie, q, corpus, vocabular, motor, nume, total, trimise, sesiune):
    t0, qid, inc = time.time(), q['id'], q['incercare']
    # total = consumul tuturor apelurilor acestei preluări (web + răspuns + reparare); trimise = interogările EFECTIV trimise la
    # web_search — ajung în BD și la erori (audit)
    n_atasamente = len(q.get('atasamente') or [])
    def de_jurnal():   # despre mascare, în jurnal intră DOAR numere
        c = sesiune[0].contoare_sigure() if sesiune else {}
        return {'mascate': c.get('contoare'), 'inlocuiri': c.get('inlocuiri'), 'atasamente_netrimise': n_atasamente}
    def tok(incert=False):
        return tokeni_rezultat(total, incert)
    def scrie(corp):
        return scrie_rezultat(secret, corp)
    def eroare(mesaj, tokeni=None, **k):   # tokenii (sau „necunoscut”) ajung în BD și la erori — evidența costului (review r2 P1-2)
        corp = {'actiune': 'eroare', 'id': qid, 'incercare': inc, 'eroare': mesaj, 'interogari': list(trimise)}
        if tokeni: corp['tokeni'] = tokeni
        st = scrie(corp)
        jurnal(id=qid, stare='eroare', scriere=st, tokeni=tokeni, cautari=len(trimise), **de_jurnal(), **k)
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

    # Decizia A: tabelul etichetă → nume trăiește DOAR în procesul motorului pentru această speță. Titlul, speța, contextul se
    # maschează primele, în această ordine (aceeași ca previzualizarea din ecran) → etichete stabile pe toată speța.
    masc = motor.sesiune(nume)
    sesiune.append(masc)
    # r3 (review P2-4): un nume recunoscut în oricare dintre ele se ascunde în toate (și în titlul mascat înaintea contextului)
    masc.invata(q.get('titlu'), q.get('intrebare'), q.get('context'))
    qm = {'titlu': str(masc.mascheaza(q.get('titlu'), protejeaza=False)),
          'intrebare': str(masc.mascheaza(q.get('intrebare'), protejeaza=False)),
          'context': str(masc.mascheaza(q.get('context'), protejeaza=False)) if q.get('context') else None}

    # modelul și extrasele se aleg LOCAL, pe textul original (nu pleacă nicăieri)
    model = C.alege_model(q.get('titlu'), q.get('intrebare'), q.get('context'))

    # 1. corpusul intern (local; contextul de proiect poate ajuta la alegerea extraselor și nu iese din server)
    extrase = C.selecteaza_extrase(corpus, ' '.join(str(q.get(k) or '') for k in ('titlu', 'intrebare', 'context')))

    # 2a. termenii: apel FĂRĂ unelte, doar pe titlu + speță MASCATE și curățate (+ vocabularul, ca modelul să aleagă din el)
    status, r = cere(cheie, masc, C.MODEL_INTEROGARI, C.MAX_TOKENS_INTEROGARI, C.SISTEM_INTEROGARI,
                     [('user', mesaj_interogari(qm, vocabular))])
    if status != 200: return esec(status, r, 'interogari')
    aduna_tokeni(total, r)
    if r.get('stop_reason') == 'refusal':
        return eroare('Cercetarea a fost refuzată de serviciul AI. Reformulează întrebarea.', tokeni=tok(), motiv='refusal', faza='interogari')
    if r.get('stop_reason') not in ('end_turn', 'stop_sequence'): return incomplet(f'interogari_{r.get("stop_reason")}')
    # 2b. interogările le COMPUNE codul, doar din vocabularul aprobat; restul cuvintelor se aruncă (se numără, fără text)
    interogari, aruncati = C.compune_interogari(C.interogari_din_raspuns(text_raspuns(r)), vocabular)

    # 2c. web DOAR pe domeniile oficiale: o cerere pe interogare compusă, max_uses = 1. Modelul din cerere vede DOAR interogarea
    # (nu speța, nu contextul, nu extrasele); rezultatul se folosește doar dacă a căutat exact interogarea compusă.
    blocuri_web, ignorate, cu_nume = [], 0, 0
    for interogare in interogari[:C.WEB_MAX_CAUTARI]:
        if str(masc.mascheaza(interogare)) != interogare:   # un termen din vocabular arată ca un nume / o dată: nu se caută deloc
            cu_nume += 1; continue
        status, r = cere(cheie, masc, model, MAX_TOKENS_WEB, C.SISTEM_CERCETARE, [('user', C.mesaj_interogare_web(interogare))],
                         tools=[C.unealta_web(1)])
        if status != 200: return esec(status, r, 'web')
        aduna_tokeni(total, r)
        blocuri = r.get('content') or []
        executate = C.interogari_web(blocuri)
        trimise[:] = (trimise + executate)[:C.INTEROGARI_AUDIT_MAX]   # tot ce a plecat efectiv rămâne în audit
        oprire = r.get('stop_reason')
        if oprire == 'refusal':
            return eroare('Cercetarea a fost refuzată de serviciul AI. Reformulează întrebarea.', tokeni=tok(), motiv='refusal', faza='web')
        if oprire not in ('end_turn', 'stop_sequence'): return incomplet(f'web_{oprire}')
        if not C.interogare_respectata(executate, interogare):
            ignorate += 1; continue
        motiv = C.web_incomplet(blocuri)
        if motiv: return incomplet(motiv)
        blocuri_web += blocuri
    web = C.surse_web(blocuri_web, start=1, maxim=max(0, C.SURSE_MAX - len(extrase)))
    note_web = text_raspuns({'content': blocuri_web})
    surse = extrase + web
    if len(surse) > C.SURSE_MAX:   # plafonul total C + W înainte de generare (P2 r2)
        return eroare('Eroare internă la cercetare (prea multe surse). Pune întrebarea din nou.', tokeni=tok(), motiv='surse_plafon')
    ids = [s['id'] for s in surse]
    # sursele, așa cum le vede modelul (mascate cu ACEEAȘI mascare): pe ele se face și validarea, ca citatele să se potrivească
    surse_m = [dict(s, titlu=str(masc.mascheaza(s.get('titlu'))), extras=str(masc.mascheaza(s.get('extras')))) for s in surse]
    intrare = mesaj_raspuns(qm, surse_m, note_web, n_atasamente)

    # 3. răspunsul, fără unelte, doar din surse (atașamentele NU pleacă — decizia A)
    status, r = cere(cheie, masc, model, MAX_TOKENS, C.SISTEM_RASPUNS, [('user', intrare)])
    if status != 200: return esec(status, r, 'raspuns')
    aduna_tokeni(total, r)
    text, oprire = text_raspuns(r), r.get('stop_reason')
    if oprire not in ('end_turn', 'stop_sequence'):   # L21: refuz / tăiat la limită = nu e un răspuns valid
        return eroare('Răspunsul AI a fost refuzat sau a ieșit incomplet. Reformulează sau împarte întrebarea.', motiv=str(oprire), tokeni=tok())
    if not text or len(text) > 60000:
        return eroare('Răspunsul AI a fost gol sau prea lung.', motiv='lungime', tokeni=tok())

    # 4. validare (în spațiul MASCAT: textul modelului față de sursele mascate) → o singură reparare → ce rămâne fără sursă se
    # scoate → regula B (motorul): „Da” / „Nu” doar cu un citat identic cu o propoziție întreagă și autonomă, altfel „Incert”
    analiza, reparat = C.analizeaza(text, surse_m), False
    fara_citat = masc.cere_citat(text, surse_m)
    if (not analiza['verdict'] or analiza['fara_sursa'] or analiza['necunoscute'] or fara_citat
            or (not analiza['temei'] and not C.e_incert(text))):
        st2, r2 = cere(cheie, masc, model, MAX_TOKENS, C.SISTEM_RASPUNS,
                       [('user', intrare), ('assistant', text), ('user', C.mesaj_reparare(analiza, ids, fara_citat))])
        if st2 == 200:
            aduna_tokeni(total, r2)
            t2 = text_raspuns(r2)
            if r2.get('stop_reason') in ('end_turn', 'stop_sequence') and t2 and len(t2) <= 60000: text, reparat = t2, True
        elif st2 is None or st2 >= 500:
            total['cost_necunoscut'] = True   # repararea a eșuat incert; răspunsul inițial merge mai departe, curățat
    final, scoase = C.curata_raspuns(text, surse_m)
    final, regula_b, tip_final = masc.regula_b(final, surse_m)
    incert = tip_final == 'incert' if tip_final is not None else C.e_incert(final)
    # la „Incert” TOATE sursele consultate se salvează alăturate (regula B); la „Da” / „Nu” doar cele citate
    ids_salvate = ids if incert else C.analizeaza(final, surse_m)['citate']
    try:   # verificarea finală pe setul care se persistă (P2 r2): nu se publică un set de surse invalid
        surse_finale = C.verifica_surse_finale(C.surse_citate(surse, ids_salvate), ids)
    except ValueError:
        return eroare('Sursele răspunsului nu au trecut verificarea finală. Pune întrebarea din nou.', tokeni=tok(), motiv='surse_invalide')
    # demascarea: DOAR pe textul afișat utilizatorului, STRICTĂ (r2, review P1-4): dacă în textul modelului rămâne orice secvență
    # de forma unei etichete care nu e exact una emisă pentru această speță („[PERSOANA_999]”, „[persoana_1]”, „[PERSOANA_1_F9]”)
    # sau o etichetă pusă pe o „aproape etichetă” a modelului, răspunsul NU se publică (nimic nu se repară tăcut). În jurnal intră
    # doar motivul, niciodată textul modelului.
    afisat, motiv_demascare = masc.demascheaza_sigur(final)
    if motiv_demascare:
        return eroare('Răspunsul conține etichete de nume care nu pot fi puse la loc sigur, deci nu a fost publicat. '
                      'Pune întrebarea din nou.', tokeni=tok(), motiv='demascare', detaliu=motiv_demascare)
    if masc.emise_in(final) and afisat == final:   # garda „demascare lipsă” (eroare de program): nu se publică etichete
        return eroare('Eroare internă la pregătirea răspunsului. Pune întrebarea din nou.', tokeni=tok(), motiv='demascare',
                      detaliu='demascare_lipsa')
    if len(afisat) > 60000:
        return eroare('Eroare internă la pregătirea răspunsului. Pune întrebarea din nou.', tokeni=tok(), motiv='lungime_afisat')
    tokeni = tok()
    st = scrie({'actiune': 'raspunde', 'id': qid, 'incercare': inc, 'raspuns_md': afisat, 'model': r.get('model') or model,
                'tokeni': tokeni, 'surse': surse_finale, 'interogari': list(trimise)})
    jurnal(id=qid, stare='raspuns' if st == 200 else f'scriere_{st}', model=r.get('model'), tokeni=tokeni, sec=round(time.time() - t0, 1),
           extrase=len(extrase), surse_web=len(web), interogari=len(interogari), termeni_aruncati=aruncati, cautari=len(trimise),
           cautari_ignorate=ignorate, cautari_cu_nume=cu_nume, vocabular=vocabular['versiune'], citate=len(surse_finale),
           reparat=reparat, scoase=scoase, incert=incert, regula_b=regula_b, **de_jurnal())


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


def incarca_vocabular(vocabular_file=None):
    """Vocabularul aprobat pentru interogările web (vocabular_web.json din repo, lângă script), validat; None dacă lipsește sau are
    forma greșită (fail closed: workerul nu preia nimic, ca la corpus)."""
    try:
        return C.pregateste_vocabular(json.loads((vocabular_file or VOCABULAR_FILE).read_text(encoding='utf-8')))
    except Exception:
        return None


def incarca_motor():
    """r4: instalarea VERIFICATĂ a motorului unic (motor.Motor: manifest sha256, instantaneu, Node 24, salutul procesului). Codul
    erorii (MotorEroare) sau motorul — fără motor workerul NU preia nimic (fail closed)."""
    try:
        return MO.Motor()
    except MO.MotorEroare as e:
        return e.cod
    except Exception:
        return 'motor_exceptie'


def incarca_nume(secret, motor):
    """Numele din platformă pentru mascare (edge, acțiunea „nume”): DOAR în memorie, nu se scriu pe disc și nu pleacă la furnizor.
    (răspunsul, statisticile) dacă motorul îl acceptă (o sesiune de probă: forma, listele, persoanele nevide — regulile stau în
    motor); None dacă edge-ul nu răspunde, e o versiune fără „nume” sau motorul îl refuză — atunci workerul NU preia nimic (fail
    closed: fără listă, numele cunoscute platformei ar pleca nemascate)."""
    try:
        st, r = edge(secret, {'actiune': 'nume'})
        if st != 200 or not isinstance(r, dict): return None
        with motor.sesiune(r) as s:
            return r, s.statistici
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
    motor = None
    try:
        # P2 r2: corpusul (verificat cu manifestul) și cheia API se încarcă ÎNAINTE de „preia” — un index lipsă/stricat/nepotrivit
        # sau o cheie lipsă nu consumă întrebări: ele rămân în coadă până se repară serverul.
        corpus = incarca_corpus()
        if corpus is None:
            jurnal(stare='corpus_invalid'); return 1
        vocabular = incarca_vocabular()
        if vocabular is None:
            jurnal(stare='vocabular_invalid'); return 1
        motor = incarca_motor()   # r4: motorul unic verificat (manifest + Node 24) ÎNAINTE de orice preluare
        if not isinstance(motor, MO.Motor):
            jurnal(stare='motor_invalid', cod=motor); return 1
        secret = SECRET_FILE.read_text(encoding='utf-8').strip()
        if len(secret) != 64: raise RuntimeError('secret')
        cheie = cheie_api()
        nume = incarca_nume(secret, motor)   # decizia A: fără lista de nume nu se preia nimic (întrebările rămân în coadă)
        if nume is None:
            jurnal(stare='nume_indisponibile'); return 1
        nume, statistici = nume
        jurnal(stare='nume_incarcate', **statistici)   # r3 (L20): doar numere — câte nume și câte intrări aruncate
        for _ in range(MAX_PE_RULARE):
            st, r = edge(secret, {'actiune': 'preia'})
            if st != 200: jurnal(stare='preia_esuat', http=st); return 1
            q = r.get('intrebare')
            if not q: return 0
            try:
                proceseaza(secret, cheie, q, corpus, vocabular, motor, nume)
            except Exception as e:   # neprevăzut: se închide cu eroare vizibilă; BD închide oricum după 30 min
                jurnal(id=q.get('id'), stare='exceptie', eroare=type(e).__name__)
                try: edge(secret, {'actiune': 'eroare', 'id': q['id'], 'incercare': q['incercare'], 'eroare': 'Eroare internă la procesare. Pune întrebarea din nou.'})
                except Exception: pass
        return 0
    except Exception as e:
        jurnal(stare='exceptie_rulare', eroare=type(e).__name__)   # doar tipul: fără text care ar putea conține date
        return 1
    finally:
        if isinstance(motor, MO.Motor): motor.inchide()   # r4: instantaneul motorului se șterge
        try: msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError: pass
        f.close()


if __name__ == '__main__':
    sys.exit(main())
