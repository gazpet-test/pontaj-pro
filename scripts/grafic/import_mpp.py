"""Import grafic de execuție (MS Project .mpp / Primavera .xer / MSPDI .xml) -> JSON normalizat „gazpet.grafic.v1”.

Pasul 1 din legarea MS Project <-> ERP (Execuție -> 📅 Grafic): citire cu MPXJ, fără MS Project și fără licență.
Scriptul NU scrie în baza de date: produce JSON-ul (și, opțional, fișierul SQL de import pentru chat, rulat după „da”-ul lui Răzvan,
care cheamă public.fn_executie_grafic_importa din migrarea 20261204a).

Utilizare (din rădăcina repo-ului; sursa se citește, nu se modifică):
  python -I -X utf8 scripts/grafic/import_mpp.py <fisier.mpp|.xer|.xml> --proiect-id 3 --eticheta "LOT 2 R5 sep 2026" \
         --iesire <grafic.json> [--sql <import.sql>] [--java-home <dir JDK>] [--proiect-sursa <n>]
  python -I -X utf8 scripts/grafic/import_mpp.py <fisier> --test-parsare --eticheta "<text>" --iesire <grafic.json>
Cerințe: Java 17+ (JAVA_HOME, --java-home sau `java` în PATH) + pachetele din scripts/grafic/requirements.txt
(pip install --require-hashes -r scripts/grafic/requirements.txt, într-un venv).
Coduri de ieșire: 0 = JSON scris (complet sau cu avertismente, vezi „complet”), 2 = argumente, 3 = fișier necitibil / date invalide.
Regula de completitudine (L12): nimic nu dispare tacit. Rândurile goale din MS Project (fără date) se numără; orice altă abatere
(proiecte multiple, sarcini externe, niveluri sărite) intră în „avertismente” și face complet = false; o valoare invalidă oprește importul.
"""
import argparse, collections, datetime, hashlib, json, os, re, secrets, shutil, sys

FORMAT = 'gazpet.grafic.v1'
MAX_ACTIVITATI = 5000
MAX_INCERTE = 300   # aceeași limită în fn_executie_grafic_importa
RE_ETICHETA = re.compile(r'^(?=.*\S).{1,200}$', re.S)
TIPURI_LEGATURA = ('FS', 'SS', 'FF', 'SF')


class EroareImport(Exception):
    """Fișier necitibil sau valoare invalidă: importul se oprește explicit (L13), fără JSON parțial."""


# ── partea pură (fără Java): normalizarea valorilor citite ─────────────────────────────────────────────────────────────────
def rotunjeste(x, zecimale=2):
    """Număr finit -> rotunjit la `zecimale` (numeric(…,2) din BD ar rotunji oricum; aici se rotunjește explicit și se raportează)."""
    if x is None:
        return None
    v = float(x)
    if v != v or v in (float('inf'), float('-inf')):
        raise EroareImport(f'valoare numerică invalidă: {x!r}')
    r = round(v, zecimale)
    return 0.0 if r == 0 else r


def procent(x, camp):
    """Procent 0..100 (lipsă = 0, ca în MS Project); în afara intervalului = eroare, nu tăiere tacită."""
    v = rotunjeste(0 if x is None else x)
    if v < 0 or v > 100:
        raise EroareImport(f'{camp} în afara 0..100: {x!r}')
    return v


RE_PROCENT_TEXT = re.compile(r'^(\d{1,3})(?:[.,](\d{1,2}))?[ \t]*%$')
RE_TITLU_PLAN = re.compile(r'^%[ \t]*plan(ificat)?$', re.I)
RE_TITLU_RAPORTAT = re.compile(r'^%[ \t]*(complete|complet|realizat|executat)$', re.I)
RE_CAMP_PERSONALIZAT = re.compile(r'^(TEXT([1-9]|[12][0-9]|30)|NUMBER([1-9]|1[0-9]|20))$')


def procent_raport(v):
    """Valoarea unei coloane de raport („% PLAN” / „% Complete”, scrisă de om sau lipită din Excel) -> (număr | None, citit?).
    Text: doar forma „73.39%” / „73,39 %” / „100%” (0..100, cel mult 2 zecimale, fără separator de mii); număr: 0..100.
    Orice altceva („#DIV/0!”, „n/a”, „120%”) = necitit (None, False): se numără și se listează, nu se ghicește (L11)."""
    if v is None:
        return None, True
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        x = float(v)
        return (rotunjeste(x), True) if 0 <= x <= 100 else (None, False)
    s = str(v).strip()
    if s == '':
        return None, True
    m = RE_PROCENT_TEXT.match(s)
    if not m:
        return None, False
    x = float(m.group(1) + ('.' + m.group(2) if m.group(2) else ''))
    return (x, True) if x <= 100 else (None, False)


def fmt_zile(v):
    """1.0 -> '1', 2.5 -> '2,5' (zecimale românești)."""
    s = ('%.2f' % v).rstrip('0').rstrip('.')
    return s.replace('.', ',')


def text_predecesori(legaturi):
    """[{wbs, tip, lag_zile | lag_procent}] -> '1.1.1 FS+65z; 1.2 SS' (lag 0 nu se scrie). Ordinea din fișier se păstrează."""
    bucati = []
    for l in legaturi:
        if l['tip'] not in TIPURI_LEGATURA:
            raise EroareImport(f'tip de legătură necunoscut: {l["tip"]!r}')
        t = f'{l["wbs"]} {l["tip"]}'
        if l.get('lag_procent') is not None:
            v = l['lag_procent']
            if v:
                t += ('+' if v > 0 else '') + fmt_zile(v) + '%'
        elif l.get('lag_zile'):
            v = l['lag_zile']
            t += ('+' if v > 0 else '') + fmt_zile(v) + 'z'
        bucati.append(t)
    return '; '.join(bucati)


def text_resurse(nume):
    """Numele resurselor, fără goluri și fără dubluri, în ordinea din fișier."""
    vazute, rez = set(), []
    for n in nume:
        n = (n or '').strip()
        if n and n not in vazute:
            vazute.add(n)
            rez.append(n)
    return ', '.join(rez)


def abatere_arbore(acts):
    """Regula arborelui, IDENTICĂ cu pasul (3) din fn_executie_grafic_importa: în ordinea fișierului, părintele declarat
    (parinte_uid) e rândul precedent cu nivelul imediat superior (stivă); rădăcinile (fără părinte) au nivelul primei activități.
    Întoarce textul primei abateri sau None."""
    stiva, radacina = [], None
    for a in acts:
        while stiva and stiva[-1][0] >= a['nivel']:
            stiva.pop()
        p = a.get('parinte_uid')
        if p is None:
            radacina = a['nivel'] if radacina is None else radacina
            if stiva or a['nivel'] != radacina:
                return f'rădăcină pe alt nivel decât prima activitate la {a["wbs"]}'
        elif not stiva or stiva[-1][1] != p or stiva[-1][0] != a['nivel'] - 1:
            return f'nivelul / părintele nu corespund ordinii la {a["wbs"]}'
        stiva.append((a['nivel'], a['uid']))
    return None


def verifica_activitati(acts):
    """Invarianții pe care se bazează UI-ul și BD-ul: uid unic, ordine 0..n-1 (altfel oprire); WBS unic, arborele coerent,
    start / finish plan prezente (altfel avertisment: fără SQL de import, ca în RPC)."""
    av = []
    uids = collections.Counter(a['uid'] for a in acts)
    dubluri = sorted(u for u, k in uids.items() if k > 1)
    if dubluri:
        raise EroareImport(f'UniqueID duplicat în fișier: {dubluri[:10]}')
    wbs = collections.Counter(a['wbs'] for a in acts)
    wd = sorted(w for w, k in wbs.items() if k > 1)
    if wd:
        av.append(f'WBS (outline) duplicat: {wd[:10]}')
    if [a['ordine'] for a in acts] != list(range(len(acts))):
        raise EroareImport('ordinea activităților nu e 0..n-1')
    arb = abatere_arbore(acts)
    if arb:
        av.append(arb)
    for a in acts:
        for c in ('start_plan', 'finish_plan'):
            if a[c] is None:
                av.append(f'{c} lipsă la {a["wbs"]}')
        if a['start_plan'] and a['finish_plan'] and a['finish_plan'] < a['start_plan']:
            raise EroareImport(f'finish înaintea start-ului la {a["wbs"]}')
    return av


def reconciliaza_inventar(uids_inventar, uids_parcurse, goale_inventar, goale_parcurse):
    """Numitorul independent (L12): activitățile parcurse în arbore = inventarul plat al cititorului (getTasks), ca mulțime de
    UniqueID, iar rândurile goale se numără separat în ambele. Orice diferență = oprire (o activitate pierdută la parcurgere)."""
    if goale_inventar != goale_parcurse:
        raise EroareImport(f'rânduri goale: {goale_inventar} în inventar, {goale_parcurse} la parcurgere')
    ci, cp = collections.Counter(uids_inventar), collections.Counter(uids_parcurse)
    if ci != cp:
        lipsa = sorted((ci - cp).elements())[:10]
        plus = sorted((cp - ci).elements())[:10]
        raise EroareImport(f'parcurgerea nu corespunde inventarului cititorului (lipsă {lipsa}, în plus {plus})')
    return len(uids_inventar)


# ── validarea documentului înainte de SQL: ACELEAȘI reguli ca fn_executie_grafic_importa (L19; cazurile comune în
#    test-fixtures/grafic/cazuri_validare.json, rulate și de harness-ul SQL) ─────────────────────────────────────────────
RE_SHA = re.compile(r'^[0-9a-f]{64}$')
RE_DATA = re.compile(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')


def _numar(v, cale, mn, mx, zec, null_ok):
    if v is None:
        if null_ok:
            return None
        raise EroareImport(f'{cale} lipsă')
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise EroareImport(f'{cale} trebuie să fie număr')
    import decimal
    d = decimal.Decimal(repr(v)) if isinstance(v, float) else decimal.Decimal(v)
    if not d.is_finite() or d < decimal.Decimal(str(mn)) or d > decimal.Decimal(str(mx)) or d != round(d, zec):
        raise EroareImport(f'{cale} în afara intervalului [{mn}, {mx}] sau cu peste {zec} zecimale')
    return d


def _text(v, cale, mx, null_ok):
    if v is None:
        if null_ok:
            return None
        raise EroareImport(f'{cale} lipsă')
    if not isinstance(v, str) or len(v) > mx:
        raise EroareImport(f'{cale} trebuie să fie text de cel mult {mx} caractere')
    return v


def _data(v, cale):
    if v is None:
        return None
    if not isinstance(v, str) or not RE_DATA.match(v):
        raise EroareImport(f'{cale} trebuie să fie dată AAAA-LL-ZZ validă')
    try:
        d = datetime.date.fromisoformat(v)
    except ValueError:
        raise EroareImport(f'{cale} trebuie să fie dată AAAA-LL-ZZ validă') from None
    if d.isoformat() != v:
        raise EroareImport(f'{cale} trebuie să fie dată AAAA-LL-ZZ validă')
    return d


def _bool(v, cale):
    if not isinstance(v, bool):
        raise EroareImport(f'{cale} trebuie să fie true / false')
    return v


def valideaza_document(doc):
    """Ridică EroareImport la orice document pe care RPC-ul l-ar refuza (inclusiv CHECK-urile tabelelor)."""
    if not isinstance(doc, dict) or doc.get('format') != FORMAT:
        raise EroareImport('format necunoscut')
    r, acts = doc.get('revizie'), doc.get('activitati')
    if not (isinstance(r, dict) and isinstance(acts, list) and isinstance(doc.get('avertismente'), list)
            and isinstance(doc.get('incerte'), list) and isinstance(doc.get('statistici'), dict) and isinstance(doc.get('complet'), bool)):
        raise EroareImport('structura JSON incompletă')
    if doc['avertismente']:
        raise EroareImport('importul are avertismente de structură')
    if doc['incerte'] and r.get('incerte_acceptate') is not True:
        raise EroareImport('valori incerte neacceptate')
    if doc['complet'] != (len(doc['incerte']) == 0):
        raise EroareImport('„complet” nu corespunde listelor')
    # metadatele stocate: aceleași margini ca în RPC (totalul rămâne sub CHECK-ul tabelului, vezi comentariul din migrare)
    if len(doc['incerte']) > MAX_INCERTE:
        raise EroareImport(f'peste {MAX_INCERTE} de valori incerte (fișierul trebuie reparat la sursă)')
    for x in doc['incerte']:
        if not isinstance(x, dict):
            raise EroareImport('o valoare incertă nu e obiect')
        if sorted(x.keys()) != ['camp', 'valoare', 'wbs']:
            raise EroareImport('o valoare incertă trebuie să aibă exact wbs, camp, valoare')
        if len(_text(x['wbs'], 'incerte.wbs', 60, False)) < 1 or len(_text(x['camp'], 'incerte.camp', 20, False)) < 1:
            raise EroareImport('wbs / camp gol într-o valoare incertă')
        _text(x['valoare'], 'incerte.valoare', 40, False)
    cl = doc.get('campuri_lipsa')
    if not isinstance(cl, list) or len(cl) > 20:
        raise EroareImport('campuri_lipsa trebuie să fie o listă de cel mult 20')
    for x in cl:
        if len(_text(x, 'campuri_lipsa', 60, False)) < 1:
            raise EroareImport('un câmp lipsă gol')
    _numar(r.get('proiect_id'), 'proiect_id', 1, 9223372036854775807, 0, False)
    et = _text(r.get('eticheta'), 'eticheta', 200, False)
    if not et or et != et.strip(' ') or not et.strip() or '\n' in et:   # CHECK-ul tabelului (btrim = doar spații, fără rând nou)
        raise EroareImport('eticheta: 1..200 caractere, pe un rând, fără spații la capete')
    sursa = _text(r.get('sursa_fisier'), 'sursa_fisier', 1000, False)
    if not sursa:
        raise EroareImport('sursa_fisier goală')
    if not RE_SHA.match(_text(r.get('sursa_sha256'), 'sursa_sha256', 64, False)):
        raise EroareImport('sursa_sha256 invalid')
    for c, mx in (('tip_fisier', 20), ('camp_pct_plan', 120), ('camp_pct_raportat', 120)):
        if _text(r.get(c), c, mx, True) == '':
            raise EroareImport(f'{c} gol')
    _data(r.get('data_stare'), 'data_stare')
    _text(r.get('aplicatie'), 'aplicatie', 60, True)
    _text(r.get('mpxj_versiune'), 'mpxj_versiune', 20, True)
    _numar(r.get('minute_pe_zi'), 'minute_pe_zi', 0, 1440, 0, True)
    _data(r.get('proiect_start'), 'proiect_start')
    _data(r.get('proiect_finish'), 'proiect_finish')
    _numar(r.get('randuri_goale'), 'randuri_goale', 0, 100000, 0, True)
    _numar(r.get('sursa_octeti'), 'sursa_octeti', 0, 2147483647, 0, True)
    _text(r.get('extras_la'), 'extras_la', 40, True)
    n = len(acts)
    st = doc['statistici']
    if not 1 <= n <= 5000 or _numar(st.get('activitati'), 'statistici.activitati', 1, 5000, 0, False) != n \
            or _numar(st.get('inventar_cititor'), 'statistici.inventar_cititor', 1, 5000, 0, False) != n:
        raise EroareImport(f'numărul activităților ({n}) nu corespunde celui declarat / inventarului cititorului')
    norm = []
    for a in acts:
        if not isinstance(a, dict):
            raise EroareImport('o activitate nu e obiect')
        norm.append({
            'ordine': _numar(a.get('ordine'), 'ordine', 0, 4999, 0, False),
            'uid': _numar(a.get('uid'), 'uid', -2147483648, 2147483647, 0, False),
            'parinte_uid': _numar(a.get('parinte_uid'), 'parinte_uid', -2147483648, 2147483647, 0, True),
            'wbs': _text(a.get('wbs'), 'wbs', 60, False), 'nivel': _numar(a.get('nivel'), 'nivel', 0, 30, 0, False),
            'nume': _text(a.get('nume'), 'nume', 1000, False),
            'start_plan': _data(a.get('start_plan'), 'start_plan'), 'finish_plan': _data(a.get('finish_plan'), 'finish_plan'),
            **{c: _data(a.get(c), c) for c in ('start_real', 'finish_real', 'start_baseline', 'finish_baseline')},
            'durata_zile': _numar(a.get('durata_zile'), 'durata_zile', 0, 9999999.99, 2, True),
            'pct_realizat': _numar(a.get('pct_realizat'), 'pct_realizat', 0, 100, 2, False),
            'pct_plan': _numar(a.get('pct_plan'), 'pct_plan', 0, 100, 2, True),
            'pct_raportat': _numar(a.get('pct_raportat'), 'pct_raportat', 0, 100, 2, True),
            **{c: _bool(a.get(c), c) for c in ('milestone', 'rezumat', 'activ')},
            'predecesori': _text(a.get('predecesori'), 'predecesori', 20000, False),
            'resurse': _text(a.get('resurse'), 'resurse', 4000, False),
        })
        if norm[-1]['wbs'] == '':
            raise EroareImport('wbs gol')
    if len({x['uid'] for x in norm}) != n:
        raise EroareImport('UniqueID duplicat')
    if len({x['wbs'] for x in norm}) != n:
        raise EroareImport('WBS duplicat')
    for i, x in enumerate(norm):
        if x['ordine'] != i:
            raise EroareImport(f'ordinea activităților nu e 0..n-1 (poziția {i})')
        if x['start_plan'] is None or x['finish_plan'] is None:
            raise EroareImport(f'start / finish plan lipsă la {x["wbs"]}')
        if x['finish_plan'] < x['start_plan']:
            raise EroareImport(f'finish înaintea start-ului la {x["wbs"]}')
    arb = abatere_arbore(norm)
    if arb:
        raise EroareImport(arb)


def statistici(acts):
    niv = collections.Counter(a['nivel'] for a in acts)
    def cu(c):
        return sum(1 for a in acts if a.get(c) not in (None, '', []))
    s = {
        'activitati': len(acts),
        'niveluri': {str(k): niv[k] for k in sorted(niv)},
        'nivel_max': max(niv) if niv else None,
        'rezumat': sum(1 for a in acts if a['rezumat']),
        'milestone': sum(1 for a in acts if a['milestone']),
        'inactive': sum(1 for a in acts if not a['activ']),
        'cu_start_real': cu('start_real'), 'cu_finish_real': cu('finish_real'),
        'cu_start_baseline': cu('start_baseline'), 'cu_finish_baseline': cu('finish_baseline'),
        'cu_predecesori': cu('predecesori'), 'cu_resurse': cu('resurse'),
        'cu_pct_peste_0': sum(1 for a in acts if a['pct_realizat'] > 0),
        'cu_pct_100': sum(1 for a in acts if a['pct_realizat'] >= 100),
    }
    campuri = {'start_real': 'cu_start_real', 'finish_real': 'cu_finish_real', 'start_baseline': 'cu_start_baseline',
               'finish_baseline': 'cu_finish_baseline', 'predecesori': 'cu_predecesori', 'resurse': 'cu_resurse'}
    lipsa = [c for c, k in campuri.items() if s[k] == 0]
    if s['cu_pct_peste_0'] == 0:
        lipsa.append('pct_realizat (toate 0)')
    return s, lipsa


def construieste(revizie, acts, avertismente_citire, incerte, inventar):
    """JSON-ul final. `avertismente` = abateri de structură; `incerte` = valori din sursă care nu s-au putut citi (ex. „#DIV/0!”
    într-o coloană de raport), fiecare cu WBS-ul ei. complet = fără niciuna (L12). `inventar` = numărul de activități din
    inventarul independent al cititorului (reconciliaza_inventar), verificat și de RPC."""
    if not acts:
        raise EroareImport('fișierul nu are nicio activitate')
    if len(acts) > MAX_ACTIVITATI:
        raise EroareImport(f'peste {MAX_ACTIVITATI} activități ({len(acts)})')
    av = list(avertismente_citire) + verifica_activitati(acts)
    inc = list(incerte or [])
    if len(inc) > MAX_INCERTE:
        av.append(f'{len(inc)} valori necitibile (peste {MAX_INCERTE}): fișierul trebuie reparat la sursă')
    st, lipsa = statistici(acts)
    st['inventar_cititor'] = inventar
    return {'format': FORMAT, 'revizie': revizie, 'statistici': st, 'campuri_lipsa': lipsa,
            'avertismente': av, 'incerte': inc, 'complet': not av and not inc, 'activitati': acts}


def sql_import(doc, accepta_incerte=False):
    """Fișierul SQL pentru chat: o tranzacție, un singur apel al RPC-ului de import, JSON-ul într-un literal $tag$ cu tag aleator.
    Abaterile de structură opresc generarea; valorile incerte doar cu --accepta-incerte (decizie umană, rămân listate în revizie)."""
    if doc['avertismente']:
        raise EroareImport('graficul are avertismente de structură: nu se generează SQL de import')
    if doc['incerte'] and not accepta_incerte:
        raise EroareImport(f'{len(doc["incerte"])} valori incerte: SQL-ul se generează doar cu --accepta-incerte, după ce le vede un om')
    doc = {**doc, 'revizie': {**doc['revizie'], 'incerte_acceptate': bool(doc['incerte'])}}
    if doc['revizie'].get('proiect_id') is None:
        raise EroareImport('fără proiect_id (test de parsare): nu se generează SQL de import')
    valideaza_document(doc)   # aceleași reguli ca RPC-ul: un SQL generat nu e refuzat de BD pentru structură
    corp = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
    while True:
        tag = 'g' + secrets.token_hex(8)
        if f'${tag}$' not in corp:
            break
    r = doc['revizie']
    antet = (f'-- Import grafic „{r["eticheta"]}” pe proiectul {r["proiect_id"]}: {doc["statistici"]["activitati"]} activități, '
             f'sursa sha256 {r["sursa_sha256"]}.\n'
             '-- Generat de scripts/grafic/import_mpp.py. Se rulează DOAR după „da”-ul lui Răzvan, după aplicarea migrării 20261204a.\n'
             '-- Reaplicarea aceluiași fișier sursă pe același proiect nu dublează nimic (RPC-ul întoarce revizia existentă).\n')
    for linie in antet.splitlines():
        if '\r' in linie or not linie.startswith('-- '):
            raise EroareImport('antet SQL invalid')
    return (antet + 'BEGIN ISOLATION LEVEL READ COMMITTED;\n'
            f'SELECT public.fn_executie_grafic_importa(${tag}${corp}${tag}$::jsonb, true);\n'
            'COMMIT;\n')


# ── partea Java (MPXJ) ─────────────────────────────────────────────────────────────────────────────────────────────────────
def porneste_jvm(java_home):
    import jpype
    import mpxj  # noqa: F401 — pune jar-urile MPXJ pe classpath
    if jpype.isJVMStarted():
        return jpype
    cale = None
    home = java_home or os.environ.get('JAVA_HOME')
    if not home and shutil.which('java'):
        home = os.path.dirname(os.path.dirname(os.path.realpath(shutil.which('java'))))
    if home:
        for c in (('bin', 'server', 'jvm.dll'), ('lib', 'server', 'libjvm.so'), ('lib', 'server', 'libjvm.dylib')):
            p = os.path.join(home, *c)
            if os.path.isfile(p):
                cale = p
                break
        if cale is None:
            raise EroareImport(f'nu găsesc JVM-ul în {home}')
    jpype.startJVM(cale or jpype.getDefaultJVMPath(), '-Dlog4j2.loggerContextFactory=org.apache.logging.log4j.simple.SimpleLoggerContextFactory',
                   convertStrings=True)
    return jpype


def _data_java(x):
    return None if x is None else str(x.toLocalDate())


def _zile(durata, props, TimeUnit):
    """Durata MPXJ -> zile lucrătoare (minutele pe zi din fișier); procentele nu sunt durate."""
    if durata is None:
        return None
    if str(durata.getUnits()) in ('%', 'PERCENT', 'ELAPSED_PERCENT'):
        raise EroareImport('durată în procente')
    return rotunjeste(float(durata.convertUnits(TimeUnit.DAYS, props).getDuration()))


def detecteaza_coloane(p):
    """Coloanele de raport din tabelele de activități salvate în fișier: un câmp personalizat (TextN / NumberN) cu titlul
    „% PLAN” sau „% Complete” / „% realizat”. Întoarce {'plan': {câmp: titlu}, 'raportat': {câmp: titlu}}."""
    gasite = {'plan': {}, 'raportat': {}}
    for tb in p.getTables():
        if tb.getResourceFlag():
            continue
        for c in tb.getColumns():
            ft, titlu = c.getFieldType(), c.getTitle()
            if ft is None or titlu is None:
                continue
            nume, titlu = str(ft.name()), str(titlu).strip()
            if not RE_CAMP_PERSONALIZAT.match(nume):
                continue
            if RE_TITLU_PLAN.match(titlu):
                gasite['plan'][nume] = titlu
            elif RE_TITLU_RAPORTAT.match(titlu):
                gasite['raportat'][nume] = titlu
    return gasite


def alege_camp(tip, cerut, gasite, av):
    """cerut: None = automat (exact un câmp găsit), 'nimic' = fără, 'TEXTn'/'NUMBERn' = dat de om. -> (câmp, descriere) sau (None, None)."""
    if cerut == 'nimic':
        return None, None
    if cerut is not None:
        return cerut, f'{cerut} ({gasite[tip].get(cerut, "ales manual")})'
    if len(gasite[tip]) == 1:
        (c, t), = gasite[tip].items()
        return c, f'{c} ({t})'
    if len(gasite[tip]) > 1:
        av.append(f'coloana % {tip} e ambiguă ({sorted(gasite[tip])}): alege una cu --camp-pct-{tip}')
    return None, None


def citeste(date, proiect_sursa, java_home, camp_plan=None, camp_raportat=None):
    """date = octeții fișierului (aceiași pe care s-a calculat sha256: ce se parsează e exact ce se înregistrează)."""
    jpype = porneste_jvm(java_home)
    from org.mpxj.reader import UniversalProjectReader
    from org.mpxj import TimeUnit, TaskField
    from java.io import ByteArrayInputStream
    try:
        proiecte = list(UniversalProjectReader().readAll(ByteArrayInputStream(jpype.JArray(jpype.JByte)(date))))
    except Exception as e:  # MPXJ aruncă excepții Java; mesajul lor nu conține secrete
        raise EroareImport(f'MPXJ nu poate citi fișierul: {type(e).__name__}: {e}') from None
    proiecte = [p for p in proiecte if p is not None]
    if not proiecte:
        raise EroareImport('MPXJ nu a recunoscut formatul fișierului')
    av = []
    if len(proiecte) > 1:
        if proiect_sursa is None:
            nume = [str(p.getProjectProperties().getName() or p.getProjectProperties().getProjectTitle()) for p in proiecte]
            raise EroareImport(f'fișierul are {len(proiecte)} proiecte ({nume}); alege unul cu --proiect-sursa <0..{len(proiecte) - 1}>')
        if not 0 <= proiect_sursa < len(proiecte):
            raise EroareImport('--proiect-sursa în afara listei')
        p = proiecte[proiect_sursa]
    else:
        if proiect_sursa not in (None, 0):
            raise EroareImport('--proiect-sursa dat, dar fișierul are un singur proiect')
        p = proiecte[0]
    props = p.getProjectProperties()
    gasite = detecteaza_coloane(p)
    c_plan, d_plan = alege_camp('plan', camp_plan, gasite, av)
    c_rap, d_rap = alege_camp('raportat', camp_raportat, gasite, av)
    if c_plan is not None and c_plan == c_rap:
        raise EroareImport('% plan și % raportat nu pot fi același câmp')
    f_plan = None if c_plan is None else TaskField.valueOf(c_plan)
    f_rap = None if c_rap is None else TaskField.valueOf(c_rap)
    incerte = []

    def raport(t, f, camp, wbs):
        if f is None:
            return None
        v = t.getCachedValue(f)
        if v is not None and camp.startswith('NUMBER'):
            v = float(v)
        elif v is not None:
            v = str(v)
        x, citit = procent_raport(v)
        if not citit:
            incerte.append({'wbs': wbs, 'camp': camp, 'valoare': str(v)[:40]})
        return x

    acts, goale, externe = [], 0, 0

    def parcurge(sarcini, parinte_uid):
        nonlocal goale, externe
        for t in sarcini:
            if t.getNull():
                goale += 1
                if t.getChildTasks().size():
                    raise EroareImport('rând gol cu sub-activități')
                continue
            if t.getExternalTask():
                externe += 1
            uid = t.getUniqueID()
            if uid is None:
                raise EroareImport(f'activitate fără UniqueID (rândul {t.getID()})')
            nivel = t.getOutlineLevel()
            wbs = t.getOutlineNumber()
            if nivel is None or wbs is None:
                raise EroareImport(f'activitate fără nivel / număr de structură (UniqueID {uid})')
            leg = []
            for r in t.getPredecessors():
                pt = r.getPredecessorTask()
                if pt is None or pt.getUniqueID() is None:
                    raise EroareImport(f'predecesor necunoscut la {wbs}')
                lag = r.getLag()
                l = {'uid': int(pt.getUniqueID()), 'wbs': str(pt.getOutlineNumber()), 'tip': str(r.getType())}
                if lag is not None and str(lag.getUnits()) in ('%', 'PERCENT', 'ELAPSED_PERCENT'):
                    l['lag_procent'] = rotunjeste(float(lag.getDuration()))
                else:
                    l['lag_zile'] = _zile(lag, props, TimeUnit) or 0.0
                leg.append(l)
            res = []
            for a in t.getResourceAssignments():
                rr = a.getResource()
                if rr is not None:
                    res.append(rr.getName())
            acts.append({
                'ordine': len(acts), 'uid': int(uid), 'id_sursa': None if t.getID() is None else int(t.getID()),
                'wbs': str(wbs), 'wbs_cod': None if t.getWBS() is None else str(t.getWBS()), 'nivel': int(nivel),
                'nume': str(t.getName() or '').strip(),
                'start_plan': _data_java(t.getStart()), 'finish_plan': _data_java(t.getFinish()),
                'start_real': _data_java(t.getActualStart()), 'finish_real': _data_java(t.getActualFinish()),
                'start_baseline': _data_java(t.getBaselineStart()), 'finish_baseline': _data_java(t.getBaselineFinish()),
                'durata_zile': _zile(t.getDuration(), props, TimeUnit),
                'pct_realizat': procent(t.getPercentageComplete(), f'% realizat la {wbs}'),
                'pct_fizic': procent(t.getPhysicalPercentComplete(), f'% fizic la {wbs}'),
                'pct_plan': raport(t, f_plan, c_plan, str(wbs)), 'pct_raportat': raport(t, f_rap, c_rap, str(wbs)),
                'milestone': bool(t.getMilestone()), 'rezumat': bool(t.getSummary()),
                'activ': t.getActive() is None or bool(t.getActive()),
                'predecesori': text_predecesori(leg), 'legaturi': leg,
                'resurse': text_resurse(res), 'parinte_uid': parinte_uid,
            })
            parcurge(t.getChildTasks(), int(uid))

    parcurge(p.getChildTasks(), None)
    inventar_uid, goale_inventar = [], 0
    for t in p.getTasks():
        if t.getNull():
            goale_inventar += 1
        elif t.getUniqueID() is None:
            raise EroareImport(f'activitate fără UniqueID în inventar (rândul {t.getID()})')
        else:
            inventar_uid.append(int(t.getUniqueID()))
    inventar = reconciliaza_inventar(inventar_uid, [a['uid'] for a in acts], goale_inventar, goale)
    if externe:
        av.append(f'{externe} activități externe (sub-proiecte legate): datele lor pot fi incomplete')
    if len(proiecte) > 1:
        av.append(f'fișierul are {len(proiecte)} proiecte; s-a citit doar nr. {proiect_sursa}')
    import importlib.metadata as md
    meta = {
        'tip_fisier': str(props.getFileType() or '')[:20] or None,
        'aplicatie': None if props.getFileApplication() is None else str(props.getFileApplication())[:60],
        'mpxj_versiune': md.version('mpxj'),
        'data_stare': _data_java(props.getStatusDate()),
        'proiect_start': _data_java(props.getStartDate()), 'proiect_finish': _data_java(props.getFinishDate()),
        'minute_pe_zi': None if props.getMinutesPerDay() is None else int(props.getMinutesPerDay()),
        'randuri_goale': goale,
        'camp_pct_plan': d_plan, 'camp_pct_raportat': d_rap,
    }
    return meta, acts, av, incerte, inventar


MAX_OCTETI = 200 * 1024 * 1024


def citeste_octeti(cale):
    """Fișierul sursă o singură dată, în memorie (cel mult 200 MB); sursa nu se modifică și nu rămâne deschisă."""
    if os.path.getsize(cale) > MAX_OCTETI:
        raise EroareImport(f'fișier peste {MAX_OCTETI // (1024 * 1024)} MB')
    with open(cale, 'rb') as f:
        date = f.read(MAX_OCTETI + 1)
    if len(date) > MAX_OCTETI:
        raise EroareImport('fișierul a crescut în timpul citirii')
    return date


def aceeasi_cale(x, y):
    """Același fișier pe disc? Dacă ambele există: os.path.samefile (prinde majusculele pe Windows, legăturile tari / simbolice și
    numele scurte 8.3); altfel calea canonică normalizată. O verificare care eșuează = „același” (fail-closed)."""
    try:
        if os.path.exists(x) and os.path.exists(y):
            return os.path.samefile(x, y)
        return os.path.normcase(os.path.realpath(x)) == os.path.normcase(os.path.realpath(y))
    except OSError:
        return True


def main(argv=None):
    ap = argparse.ArgumentParser(description='Grafic MS Project / Primavera -> JSON gazpet.grafic.v1 (fără scriere în BD).')
    ap.add_argument('fisier')
    ap.add_argument('--proiect-id', type=int)
    ap.add_argument('--test-parsare', action='store_true', help='fără proiect ERP (ex. grafic de ofertă); nu permite --sql')
    ap.add_argument('--eticheta', required=True)
    ap.add_argument('--iesire', required=True)
    ap.add_argument('--sql')
    ap.add_argument('--java-home')
    ap.add_argument('--proiect-sursa', type=int)
    ap.add_argument('--camp-pct-plan', help='câmpul coloanei „%% PLAN” (TEXTn / NUMBERn / nimic); implicit: detectat după titlul din fișier')
    ap.add_argument('--camp-pct-raportat', help='câmpul coloanei „%% Complete” de raport (TEXTn / NUMBERn / nimic); implicit: detectat')
    ap.add_argument('--accepta-incerte', action='store_true', help='generează SQL-ul și cu valori incerte (după ce le-a văzut un om)')
    ap.add_argument('--sursa-afisata', help='calea de trecut în revizie (implicit: calea dată)')
    a = ap.parse_args(argv)
    if a.test_parsare == (a.proiect_id is not None):
        ap.error('dă exact una dintre --proiect-id și --test-parsare')
    if a.proiect_id is not None and a.proiect_id <= 0:
        ap.error('--proiect-id trebuie să fie > 0')
    if a.test_parsare and a.sql:
        ap.error('--sql nu se folosește cu --test-parsare')
    for c in (a.camp_pct_plan, a.camp_pct_raportat):
        if c is not None and c != 'nimic' and not RE_CAMP_PERSONALIZAT.match(c):
            ap.error(f'câmp invalid: {c} (TEXT1..TEXT30, NUMBER1..NUMBER20 sau nimic)')
    if not RE_ETICHETA.match(a.eticheta) or a.eticheta != a.eticheta.strip() or '\n' in a.eticheta:
        ap.error('--eticheta: 1..200 caractere, pe un rând, fără spații la capete')
    if not os.path.isfile(a.fisier):
        ap.error(f'fișierul nu există: {a.fisier}')
    if not a.iesire.lower().endswith('.json') or (a.sql is not None and not a.sql.lower().endswith('.sql')):
        ap.error('--iesire trebuie să se termine în .json, iar --sql în .sql')
    tinte = [c for c in (a.iesire, a.sql) if c is not None]
    for i, c in enumerate(tinte):
        if aceeasi_cale(c, a.fisier) or any(aceeasi_cale(c, d) for d in tinte[i + 1:]):
            ap.error('o ieșire ar fi chiar fișierul sursă sau cealaltă ieșire')
    sursa = a.sursa_afisata or a.fisier
    if not 1 <= len(sursa) <= 1000:
        ap.error('calea sursei: 1..1000 caractere')
    try:
        date = citeste_octeti(a.fisier)
        meta, acts, av, incerte, inventar = citeste(date, a.proiect_sursa, a.java_home, a.camp_pct_plan, a.camp_pct_raportat)
        revizie = {'proiect_id': a.proiect_id, 'eticheta': a.eticheta, 'sursa_fisier': sursa, 'sursa_sha256': hashlib.sha256(date).hexdigest(),
                   'sursa_octeti': len(date),
                   'extras_la': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), **meta}
        doc = construieste(revizie, acts, av, incerte, inventar)
        sql = sql_import(doc, a.accepta_incerte) if a.sql else None
    except EroareImport as e:
        print(f'EROARE: {e}', file=sys.stderr)
        return 3
    with open(a.iesire, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write('\n')
    if sql is not None:
        with open(a.sql, 'w', encoding='utf-8', newline='\n') as f:
            f.write(sql)
    s = doc['statistici']
    print(f'OK {os.path.basename(a.fisier)}: {s["activitati"]} activități, niveluri {s["niveluri"]}, complet={doc["complet"]}, '
          f'lipsă: {", ".join(doc["campuri_lipsa"]) or "-"}, % plan: {doc["revizie"]["camp_pct_plan"] or "-"}, '
          f'% raportat: {doc["revizie"]["camp_pct_raportat"] or "-"}'
          + (f', avertismente: {len(doc["avertismente"])}' if doc['avertismente'] else '')
          + (f', incerte: {len(doc["incerte"])}' if doc['incerte'] else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
