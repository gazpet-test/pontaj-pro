"""Pasul 3 (CPU): compararea celor doua citiri pe fiecare banda. Identic = acceptat local; orice diferenta = dezacord pentru arbitru.
Niveluri (spec §2): cuvant (ș/ş, ț/ţ unificate DOAR la comparare), cifra (separatorul zecimal NICIODATA normalizat),
rand de tabel (celule, cu rolurile cod / UM / cantitate cand se pot deduce). Textul citit ramane literal; nimic nu se corecteaza aici."""
import difflib, hashlib, html, json, pathlib, re, threading

CEDILLA = str.maketrans({'ş': 'ș', 'ţ': 'ț', 'Ş': 'Ș', 'Ţ': 'Ț'})
# Numerele pastreaza semnul, exponentul si procentul; semnele, comparatorii si operatorii sunt tokeni separati: -5 vs 5, 5% vs 5,
# 1e-3 vs 1e3, 10**2 vs 102 raman dezacorduri (review Copilot r1). Restul punctuatiei nu se compara.
# cifrele ASCII explicit ([0-9], nu \d Unicode): aceeasi definitie ca granita de token din BD (fn_ofertare_ocr_granita, D3a)
NUM = r'[-+±−]?[.,]?[0-9]+(?:[.,][0-9]+)*(?:[eE][-+]?[0-9]+)?[%‰]?'
# Politica inversa (review Copilot r3): ORICE caracter nespatiu care nu e numar sau litera e token separat (%, ‰, _, (, ), €, ...).
# Singura normalizare la comparare ramane sedila/virgula pe ș/ț. Mai mult zgomot la arbitru, dar nicio diferenta nu se pierde.
# Literele = clasa EXPLICITA de mai jos (nu \w Unicode): aceeasi in BD (fn_ofertare_ocr_granita, D3a r9), independenta de locale.
# Latin + diacritice (ș ț ă î â), greaca, chirilica, exponenti / indici (m² m³ ⁰-₟), fractii (½ ¼ ¾ ⅐-↉) si µ ª º; orice alt caracter
# nespatiu e token de sine statator. Testul de paritate cere ca migrarea sa contina exact aceasta clasa (review Jakarinos r8).
LETTERS = ('A-Za-z\u00aa\u00b2\u00b3\u00b5\u00b9\u00ba\u00bc-\u00be\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f'
           '\u0370-\u03ff\u0400-\u04ff\u1e00-\u1eff\u2070-\u209f\u2150-\u2189')
TOKEN = re.compile(NUM + '|[' + LETTERS + ']+|\\S')  # semnele si comparatorii sunt tokeni si cand stau separat (± 0,5, - 5, ≤ 50)
NUMBER = re.compile('^' + NUM + '$')
BOLD = re.compile(r'(?<![\w*])\*\*(?=\S)(.+?)(?<=\S)\*\*(?![\w*])', re.S)  # nu lipit de cifre/litere: 10**2 + 3**2 ramane
# PROVENIENTA (laborator 16.10.2026, decizia Razvan A): fiecare marcaj pus de PIPELINE trece prin _m(). In modul normal _m e identitatea
# (textul, segmentele si BD raman neschimbate); in modul provenienta (segmente_provenienta) marcajul e delimitat cu doua caractere din zona
# privata Unicode, puse DOAR aici - deci se stie ce a scris pipeline-ul fara sa se ghiceasca din forma textului (lectia #1765). Orice
# caracter privat venit din citire e neutralizat inainte; paritatea cu parsarea normala se verifica (altfel: fara masti, fail-closed).
PA, PB = '', ''   # marcaj scris de pipeline
PC, PD = '', ''   # continut CITIT care e taiat (barat): ramane continut, dar se compara ca taiat (Jakarinos r1 P1)
_PROV = threading.local()
def _m(s): return PA + s + PB if getattr(_PROV, 'on', False) else s
def _t(s): return PC + s + PD if getattr(_PROV, 'on', False) else s
SUPSUB = re.compile(r'<(sup|sub)\b[^>]*>(.*?)</\1\s*>', re.I | re.S)  # exponent/indice = semantica: devin ^x / _x, nu dispar
def supsub(s): return SUPSUB.sub(lambda m: _m('^{' if m.group(1).lower() == 'sup' else '_{') + m.group(2) + _m('}'), s)  # x^{2+3} != x^{2}+3
# doar etichete HTML dintr-o lista inchisa, cu atribute bine formate: 'x<y si z>3' sau 'x < 5 si y > 3' raman text (review Jakarinos r3)
TAG = re.compile(r'</?(?:p|br|hr|h[1-6]|div|span|b|strong|em|i|u|small|big|font|center|li|ul|ol|dl|dt|dd|thead|tbody|tfoot|tr|td|th|table|caption|colgroup|col|section|article|header|footer|blockquote|pre|code|a)'
                 r'(?:\s+[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*(?:"[^"]*"|\'[^\']*\'))*\s*/?>', re.I)
TABLE_HTML = re.compile(r'<table\b.*?</table\s*>', re.I | re.S)
ROW_HTML = re.compile(r'<tr\b.*?</tr\s*>', re.I | re.S)
CELL_HTML = re.compile(r'<t[dh]\b([^>]*)>(.*?)</t[dh]\s*>', re.I | re.S)
SPAN = re.compile(r'\b(colspan|rowspan)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))', re.I)
STRIKE = re.compile(r'<(s|del|strike)\b[^>]*>(.*?)</\1\s*>', re.I | re.S)
CSS_STRIKE = re.compile(r'<(span|font|div|p|td)\b[^>]*line-through[^>]*>(.*?)</\1\s*>', re.I | re.S)
MD_STRIKE = re.compile(r'~~(?=\S)(.+?)(?<=\S)~~', re.S)
def strike_marker(s):
    # o valoare barata nu e text activ: devine marcaj comparat ⟦barat: ...⟧ (HTML <s>/<del>/<strike> si markdown ~~...~~)
    b = lambda x: ' ' + _m('⟦barat: ') + _t(x) + _m('⟧') + ' '
    s = CSS_STRIKE.sub(lambda m: b(m.group(2)), s)
    return MD_STRIKE.sub(lambda m: b(m.group(1)), STRIKE.sub(lambda m: b(m.group(2)), s))
IMG = re.compile(r'<img\b((?:"[^"]*"|\'[^\']*\'|[^\'">])*)>', re.I)
SRC_ATTR = re.compile(r'(\bsrc\s*=\s*["\'])([^"\']*)(["\'])', re.I)
IMG_ATTR = re.compile(r'\b(alt|title)\s*=\s*(?:"([^"]*)"|\'([^\']*)\')', re.I)
def img_marker(s):
    # imaginea nu dispare: alt/title (substitutul textual) devin un marcaj comparat (review Copilot r5)
    # toate atributele, textual (alt, title, src, ...): nicio diferenta din eticheta nu dispare (review Jakarinos r6, Copilot r6 P2)
    # provenienta: doar cadrul ⟦img ⟧ si VALOAREA lui src (referinta / payload-ul imaginii) sunt ale pipeline-ului; alt, title si restul
    # atributelor sunt text CITIT si raman continut (Jakarinos r1 P1: alt „10,5 mc” vs „105 mc” nu poate fi „doar marcaj”)
    def one(m):
        a = re.sub(r'\s+', ' ', re.sub(r'\s+/$', '', m.group(1)).strip())
        a = SRC_ATTR.sub(lambda x: x.group(1) + _m(x.group(2)) + x.group(3), a)
        return ' ' + _m('⟦img ') + a + _m('⟧') + ' '
    return IMG.sub(one, s)
CAPTION = re.compile(r'<caption\b[^>]*>(.*?)</caption\s*>', re.I | re.S)
MD_SEP = re.compile(r'^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$')
CONTEXT = 6

TABLE_MARK = '⟦tabel⟧'

def norm_word(t): return t.translate(CEDILLA)

def clean_inline(s):
    s = re.sub(r'<br\s*/?>', ' ', s, flags=re.I); s = TAG.sub(' ', img_marker(strike_marker(supsub(s)))); s = BOLD.sub(r'\1', html.unescape(s))  # doar perechile **text** (bold markdown); un ** izolat ramane
    return re.sub(r'\s+', ' ', s).strip()

def html_rows(table):
    """Geometria celulelor se pastreaza (review Jakarinos r4): colspan=N -> celula + N-1 celule goale (aceeasi grila ca LightOn,
    care scrie celulele unite ca goale); rowspan=N -> marcaj vizibil in celula, comparat ca text (nu se poate dovedi echivalenta)."""
    rows = []
    for r in ROW_HTML.findall(table):
        row = []
        for attrs, body in CELL_HTML.findall(r):
            text = clean_inline(body); spans = {}
            if re.search(r'line-through', attrs, re.I) and text: text = _m('⟦barat: ') + _t(text) + _m('⟧')  # bararea pusa pe celula insasi
            for k, a, b, c in SPAN.findall(attrs):
                v = (a or b or c).strip()
                # doar intreg valid 1..50 se interpreteaza; orice altceva ('2x', '51', '0') ramane marcaj vizibil, nu se ghiceste
                if re.fullmatch(r'\d+', v) and 1 <= int(v) <= 50: spans[k.lower()] = int(v)
                else: text = (text + ' ' + _m('⟦%s_invalid=%s⟧' % (k.lower(), v))).strip()
            if spans.get('rowspan', 1) > 1: text = (text + ' ' + _m('⟦rowspan=%d⟧' % spans['rowspan'])).strip()
            row.append(text); row += [''] * (spans.get('colspan', 1) - 1)
        rows.append(row)
    return rows

def md_rows(lines):
    rows = []
    for ln in lines:
        if MD_SEP.match(ln.strip()): continue
        s = ln.strip()
        if s.startswith('|'): s = s[1:]
        if s.endswith('|') and not s.endswith('\\|'): s = s[:-1]
        # separatorul = '|' neescapat; '\|' e bara din interiorul celulei (review Jakarinos r3)
        rows.append([clean_inline(c.replace('\\|', '|')) for c in re.split(r'(?<!\\)\|', s)])
    return rows

def plain(s):
    s = strike_marker(s)  # inainte de a transforma </p>, </div> in randuri noi (review Jakarinos r7)
    s = re.sub(r'<br\s*/?>|</p\s*>|</h\d\s*>|</li\s*>|</div\s*>', '\n', s, flags=re.I)
    s = html.unescape(TAG.sub(' ', img_marker(strike_marker(supsub(s)))))
    s = BOLD.sub(r'\1', re.sub(r'^[ \t]*#{1,6}(?:[ \t]+|$)', '', s, flags=re.M))  # doar titlu markdown real ('# Titlu'); '#12', '##ABC' raman
    return re.sub(r'[ \t]+', ' ', s).strip()

def segments(raw):
    """Citirea -> secventa ordonata de segmente ('text', str) / ('table', [[celula]]). HTML si markdown, ambele."""
    out = []; pos = 0
    for m in TABLE_HTML.finditer(raw):
        out += _md_split(raw[pos:m.start()])
        for cap in CAPTION.findall(m.group(0)): out.append(('text', clean_inline(cap)))  # titlul tabelului (tronsonul) se compara
        body = CAPTION.sub(' ', m.group(0)); rows = html_rows(body)
        opens_td = len(re.findall(r'<t[dh]\b', body, re.I)); opens_tr = len(re.findall(r'<tr\b', body, re.I))
        stray = plain(ROW_HTML.sub(' ', re.sub(r'</?(?:table|thead|tbody|tfoot|colgroup|col)\b[^>]*>', ' ', body, flags=re.I)))
        stray_cells = any(plain(CELL_HTML.sub(' ', r)).strip() for r in ROW_HTML.findall(body))
        if (opens_td != sum(len(CELL_HTML.findall(r)) for r in ROW_HTML.findall(body)) or opens_tr != len(ROW_HTML.findall(body))
                or stray.strip() or stray_cells):  # text in afara randurilor / celulelor = neparsat, nu ignorat
            out.append(('text', _m('⟦tabel_neparsat⟧') + ' ' + plain(re.sub(r'</?t[dhr]\b[^>]*>', ' | ', body, flags=re.I))))
        else: out.append(('table', rows))
        pos = m.end()
    out += _md_split(raw[pos:])
    return [s for s in out if (s[0] == 'table' and s[1]) or (s[0] == 'text' and s[1].strip())]

TABLE_PIECE = re.compile(r'</?(?:table|tr|td|th|thead|tbody)\b', re.I)

def _md_split(chunk):
    # bucati de tabel HTML neconsumate de TABLE_HTML (ex. <table> fara </table>, </table> orfan): nu se sterg ca etichete -
    # tot fragmentul intra ca text marcat ⟦tabel_neparsat⟧, cu celulele separate vizibil (review Copilot r6)
    if TABLE_PIECE.search(chunk):
        return [('text', _m('⟦tabel_neparsat⟧') + ' ' + plain(re.sub(r'</?t[dhr]\b[^>]*>', ' | ', chunk, flags=re.I)))]
    out = []; buf = []; tab = []
    for ln in chunk.split('\n'):
        if ln.strip().startswith('|') and ln.strip().count('|') >= 2:
            if buf: out.append(('text', plain('\n'.join(buf)))); buf = []
            tab.append(ln)
        else:
            if tab: out.append(('table', md_rows(tab))); tab = []
            buf.append(ln)
    if tab: out.append(('table', md_rows(tab)))
    if buf: out.append(('text', plain('\n'.join(buf))))
    return out

# Varianta A (decizie Razvan 15.10.2026): comparatorul ramane LITERAL. Singura schimbare la tokeni: payload-ul base64 al unei imagini
# inline (MinerU), strict in atributul src al marcajului ⟦img ...⟧ (atributele dinainte complete si intre ghilimele), devine UN token =
# amprenta lui SHA-256. Fara pierdere: doua payload-uri diferite dau tokeni diferiti, deci nicio diferenta nu dispare; dispar doar
# miile de tokeni base64 din alinierea difflib. Textul citit si pozitiile (sursa, reconcilierea) raman neatinse.
# Granitele payload-ului sunt granite si in tokenizarea literala (fn_ofertare_ocr_granita, BD): dupa el vine '"' (token singur), iar
# inceputul NU poate fi cifra (",9" / "64,9" ar fi un numar peste granita) - payload-urile care incep cu cifra raman tokenizate literal.
B64_IMG = re.compile(r'⟦img (?:[A-Za-z][\w-]*="[^"]*" )*src="data:image/[A-Za-z0-9.+-]+;base64,([A-Za-z+/][A-Za-z0-9+/]*={0,2})"')

def tokens(segs):
    """Tokenii segmentelor text, cu pozitia lor (segment, start, end) pentru reconciliere."""
    out = []
    for si, (kind, val) in enumerate(segs):
        # un tabel e un marcaj in fluxul de text: textul mutat de o parte pe alta a unui tabel devine dezacord (review Jakarinos r3)
        if kind != 'text': out.append((TABLE_MARK, si, None, None)); continue
        pos = 0
        for b in B64_IMG.finditer(val):
            s, e = b.span(1)
            out += [(m.group(0), si, pos + m.start(), pos + m.end()) for m in TOKEN.finditer(val[pos:s])]
            out.append(('⟦b64 %s⟧' % hashlib.sha256(b.group(1).encode()).hexdigest(), si, s, e)); pos = e
        out += [(m.group(0), si, pos + m.start(), pos + m.end()) for m in TOKEN.finditer(val[pos:])]
    return out

def table_rows(segs):
    # randurile complet goale nu poarta informatie (LightOn mai adauga unul) - nu intra in aliniere
    return [(si, ri, row) for si, (kind, val) in enumerate(segs) if kind == 'table' for ri, row in enumerate(val) if any(c.strip() for c in row)]

def flat_text(segs):
    """Pentru structuri diferite: tabelele aplatizate ca text (randuri cu celule separate prin spatiu)."""
    return [('text', '\n'.join(val if kind == 'text' else '\n'.join(' '.join(r) for r in val) for kind, val in segs))]

def separator_anomaly(a, b):
    na = [t for t in TOKEN.findall(a) if NUMBER.match(t)]; nb = [t for t in TOKEN.findall(b) if NUMBER.match(t)]
    return any(x != y and x.replace(',', '.') == y.replace(',', '.') for x in na for y in nb)

def numeric_diff(a, b):
    na = [t for t in TOKEN.findall(a) if NUMBER.match(t)]; nb = [t for t in TOKEN.findall(b) if NUMBER.match(t)]
    return na != nb

def cell_key(c): return norm_word(re.sub(r'\s+', ' ', c.strip()))  # literal (doar spatiile si sedila unificate): AB-12C != AB12-C
def row_key(r): return '␟'.join(cell_key(c) for c in r)

REGULA_A = True  # comutator (teste, masuratori)

def regula_a(ca, cb):
    """Regula A (Razvan 15.10.2026, varianta A, gratuita, determinista): randul e acord automat DOAR daca e identic literal (cell_key,
    celula cu celula, de la inceputul randului) dupa ce se scot celulele goale de la COADA randului la ambii cititori. LightOn scrie
    celulele de dupa ultima valoare ca goale, MinerU nu (sau invers). Orice alta diferenta (spatii in celula, separator, celula
    goala in interior, coloana mutata) ramane dezacord."""
    def coada(r):
        k = [cell_key(c) for c in r]
        while k and not k[-1]: k.pop()
        return k
    return len(ca) != len(cb) and coada(ca) == coada(cb)

def same_content(ca, cb):
    """LightOn scrie celulele unite ca celule goale, MinerU ca o singura celula (colspan). Acelasi continut nevid, in aceeasi
    ordine, nu e dezacord - DAR numai daca celulele numerice stau la aceeasi distanta de capatul randului (altfel o cifra mutata
    in alta coloana ar trece neobservata)."""
    ne = lambda r: [norm_word(c) for c in r if c.strip()]
    if ne(ca) != ne(cb): return False
    # Fara scutire (review Copilot r3): parserul nu pastreaza colspan, deci un numar diferit de celule sau alte pozitii nu se pot
    # dovedi echivalente - merg la arbitru (pretul: randurile cu celule unite scrise diferit de cei doi cititori).
    return False

def roles(header, row):
    """Rolurile coloanelor (cod / um / cantitate): din antet cand exista, altfel cantitatea = ultima celula numerica,
    UM = celula dinaintea ei, cod = a doua celula (Nr. crt. | Simbol | Denumire | UM | Cantitate). Euristica, nu certitudine."""
    r = {}
    if header:
        for i, h in enumerate(header):
            h2 = norm_word(h).lower()
            if 'cantit' in h2: r['cantitate'] = i
            elif re.search(r'\bu\.?\s*m\.?$|unitate', h2): r['um'] = i
            elif re.search(r'simbol|\bcod', h2): r['cod'] = i
    if 'cantitate' not in r:
        nums = [i for i, c in enumerate(row) if NUMBER.match(c.strip())]
        if nums: r['cantitate'] = nums[-1]
    if 'um' not in r and r.get('cantitate'): r['um'] = r['cantitate'] - 1
    if 'cod' not in r and len(row) >= 4: r['cod'] = 1
    return r

def find_header(rows, upto):
    for r in reversed(rows[:upto + 1]):
        if any(re.search(r'cantit|u\.?\s*m\.?$', norm_word(c), re.I) for c in r): return r
    return None

def compare_text(seg_a, seg_b, base):
    ta = tokens(seg_a); tb = tokens(seg_b)
    ka = [norm_word(t[0]) for t in ta]; kb = [norm_word(t[0]) for t in tb]
    groups = []
    for op, a1, a2, b1, b2 in difflib.SequenceMatcher(a=ka, b=kb, autojunk=False).get_opcodes():
        if op == 'equal': continue
        # dezacorduri apropiate (cel mult 2 tokeni egali intre ele) = un singur decupaj pentru arbitru
        if groups and a1 - groups[-1]['a2'] <= 2 and b1 - groups[-1]['b2'] <= 2: groups[-1].update(a2=a2, b2=b2)
        else: groups.append({'a1': a1, 'a2': a2, 'b1': b1, 'b2': b2})
    items = []
    def literal(tl, segs, i1, i2):
        # fragmentul exact din citire (cu tot ce e intre tokeni: cratime, semne, spatii), nu tokenii lipiti
        if i1 >= i2: return ''
        if tl[i1][1] == tl[i2 - 1][1] and segs[tl[i1][1]][0] == 'text': return segs[tl[i1][1]][1][tl[i1][2]:tl[i2 - 1][3]]
        parts = []
        for si in range(tl[i1][1], tl[i2 - 1][1] + 1):
            if segs[si][0] != 'text': parts.append(TABLE_MARK); continue
            s = tl[i1][2] if si == tl[i1][1] else 0; e = tl[i2 - 1][3] if si == tl[i2 - 1][1] else len(segs[si][1])
            parts.append(segs[si][1][s:e])
        return '\n'.join(parts)
    def source(tl, i1, i2):
        # unde e fragmentul in segmentele citirii (D3a r7): BD reface fragmentul EXACT din segmentele incarcate si verifica granitele
        # de token, in loc sa reimplementeze normalizarea (review Jakarinos r6 / Copilot r6)
        if i1 >= i2: return None
        return {'seg': [tl[i1][1], tl[i2 - 1][1]], 'start': tl[i1][2], 'end': tl[i2 - 1][3]}
    is_num = lambda k: 0 <= k < len(ka) and bool(NUMBER.match(ka[k]))
    for n, g in enumerate(groups):
        fa = literal(ta, seg_a, g['a1'], g['a2']); fb = literal(tb, seg_b, g['b1'], g['b2'])
        items.append(dict(base, id='%s_t%d' % (base['band'], n), tip='text', citire_lighton=fa, citire_mineru=fb,
                          sursa={'lighton': source(ta, g['a1'], g['a2']), 'mineru': source(tb, g['b1'], g['b2'])},
                          context_inainte=' '.join(t[0] for t in ta[max(0, g['a1'] - CONTEXT):g['a1']]),
                          context_dupa=' '.join(t[0] for t in ta[g['a2']:g['a2'] + CONTEXT]),
                          pozitie={'lighton': [g['a1'], g['a2']], 'mineru': [g['b1'], g['b2']]},
                          diferenta_numerica=numeric_diff(fa, fb), anomalie_separator=separator_anomaly(fa, fb),
                          contine_tabel=TABLE_MARK in fa or TABLE_MARK in fb,
                          # pe pagini de cantitati orice dezacord e posibila cantitate; in text: cifra in fragment sau numar vecin
                          e_cantitate=bool(base['kind'] == 'quantity_table' or numeric_diff(fa, fb) or any(ch.isdigit() for ch in fa + fb)
                                           or is_num(g['a1'] - 1) or is_num(g['a2']))))
    return items, len(ka)

def match_rows(ra, rb):
    """Aliniere ordonata a randurilor: egale pe cheie, apoi perechi in ordine cu similaritate >= 0.5; restul = randuri lipsa."""
    ka = [row_key(r[2]) for r in ra]; kb = [row_key(r[2]) for r in rb]; pairs = []
    for op, a1, a2, b1, b2 in difflib.SequenceMatcher(a=ka, b=kb, autojunk=False).get_opcodes():
        if op == 'equal':
            pairs += [(a1 + k, b1 + k, True) for k in range(a2 - a1)]; continue
        j = b1
        for i in range(a1, a2):
            best = None
            for jj in range(j, b2):
                if difflib.SequenceMatcher(a=ka[i], b=kb[jj], autojunk=False).ratio() >= 0.5: best = jj; break
            if best is None: pairs.append((i, None, False)); continue
            pairs += [(None, x, False) for x in range(j, best)]; pairs.append((i, best, False)); j = best + 1
        pairs += [(None, x, False) for x in range(j, b2)]
    return pairs

def compare_tables(seg_a, seg_b, base, acord_a=None):
    ra = table_rows(seg_a); rb = table_rows(seg_b); items = []
    acord_a = [] if acord_a is None else acord_a  # randurile LightOn [segment, rand] acceptate prin regula A (raportate in sumar)
    rows_a = [r[2] for r in ra]
    pairs = match_rows(ra, rb)
    a2b = {i: j for i, j, _ in pairs if i is not None and j is not None}; b2a = {j: i for i, j in a2b.items()}
    # granitele tabelelor: perechile potrivite trebuie sa lege fiecare tabel LightOn de UN SINGUR tabel MinerU si invers;
    # altfel structura difera (un rand mutat intre tabele) -> dezacord de structura, iar niciun rand nou nu se insereaza automat
    ta2b = {}; tb2a = {}
    for x, y in a2b.items(): ta2b.setdefault(ra[x][0], set()).add(rb[y][0]); tb2a.setdefault(rb[y][0], set()).add(ra[x][0])
    tables_ok = all(len(v) == 1 for v in ta2b.values()) and all(len(v) == 1 for v in tb2a.values())
    if not tables_ok:
        desc = lambda rows, tab: ' / '.join('%d randuri' % sum(1 for r in rows if r[0] == s) for s in sorted({r[0] for r in rows}))
        items.append(dict(base, id='%s_structura' % base['band'], tip='structura_tabele', citire_lighton=desc(ra, 'a'), citire_mineru=desc(rb, 'b'),
                          pozitie={'lighton': None, 'mineru': None}, diferenta_numerica=False, anomalie_separator=False, e_cantitate=True,
                          motiv_pipeline='randurile potrivite leaga tabele diferite intre cititori'))
    def safe_anchor(j):
        # randul X exista doar la MinerU (rb[j]): vecinii lui din ACELASI tabel MinerU trebuie potriviti cu doua randuri consecutive
        # din ACELASI tabel LightOn; atunci X se insereaza intre ele. Altfel (inceput/sfarsit de tabel, vecini nepotriviti) = om.
        if not tables_ok or j == 0 or j + 1 >= len(rb): return None
        pj, nj = j - 1, j + 1
        while nj < len(rb) and nj not in b2a: nj += 1
        if pj not in b2a or nj >= len(rb) or nj not in b2a: return None
        if not (rb[pj][0] == rb[j][0] == rb[nj][0]): return None
        ia, ib = b2a[pj], b2a[nj]
        if ib != ia + 1 or ra[ia][0] != ra[ib][0]: return None
        return [ra[ia][0], ra[ia][1]]
    for n, (i, j, same) in enumerate(pairs):
        if same: continue
        a = ra[i] if i is not None else None; b = rb[j] if j is not None else None
        ca = a[2] if a else None; cb = b[2] if b else None
        header = find_header(rows_a, i) if i is not None else None
        anchor = None
        if a and b:
            if same_content(ca, cb): continue
            if REGULA_A and regula_a(ca, cb): acord_a.append([a[0], a[1]]); continue
            tip = 'rand_tabel'
            cell = lambda r, k: norm_word(r[k]) if k < len(r) else None
            diff = [k for k in range(max(len(ca), len(cb))) if cell(ca, k) != cell(cb, k)]
            rl = roles(header, ca)
            has_digit = any(ch.isdigit() for x in ca + cb for ch in x)
            e_cant = base['kind'] == 'quantity_table' or (len(ca) != len(cb) and has_digit) or rl.get('cantitate') in diff \
                or any(ch.isdigit() for k in diff for x in (ca[k] if k < len(ca) else '', cb[k] if k < len(cb) else '') for ch in x)
            triplet = len(ca) != len(cb) or any(rl.get(x) in diff for x in ('cod', 'um', 'cantitate'))
        else:
            tip = 'rand_lipsa_lighton' if a is None else 'rand_lipsa_mineru'; diff = None
            rl = roles(header, ca or cb); e_cant = base['kind'] == 'quantity_table' or 'cantitate' in rl or any(ch.isdigit() for x in (ca or cb) for ch in x); triplet = True
            if a is None: anchor = safe_anchor(j)
        fa = ' | '.join(ca) if ca is not None else ''; fb = ' | '.join(cb) if cb is not None else ''
        prev = ra[i - 1][2] if i else None
        items.append(dict(base, id='%s_r%d' % (base['band'], n), tip=tip, citire_lighton=fa, citire_mineru=fb,
                          celule_diferite=diff, roluri=rl, celule_lighton=ca, celule_mineru=cb,
                          ancora_lighton=anchor, ancora_sigura=anchor is not None,
                          triplet_diferit=bool(triplet), rand_anterior=' | '.join(prev) if prev else None,
                          pozitie={'lighton': [a[0], a[1]] if a else None, 'mineru': [b[0], b[1]] if b else None},
                          diferenta_numerica=numeric_diff(fa, fb), anomalie_separator=separator_anomaly(fa, fb), e_cantitate=bool(e_cant)))
    return items, len(ra)

def compare_band(band, raw_a, res_a, raw_b, res_b):
    base = {'band': band['id'], 'page': band['page'], 'kind': band['kind'], 'image': band['image'], 'image_sha256': band['image_sha256'],
            'cititori': {r: {'protocol': x.get('protocol'), 'weights_sha256': x.get('weights_sha256')} for r, x in (('lighton', res_a), ('mineru', res_b))},
            'raw_sha256': {'lighton': hashlib.sha256(raw_a.encode()).hexdigest(), 'mineru': hashlib.sha256(raw_b.encode()).hexdigest()}}
    if not (res_a.get('ok') and res_b.get('ok')):
        motiv = [r for r, x in (('lighton', res_a), ('mineru', res_b)) if not x.get('ok')]
        return {'band': band['id'], 'structura': 'citire_incompleta', 'incomplete': motiv}, [dict(base, id=band['id'] + '_banda', tip='banda_intreaga',
                citire_lighton=raw_a, citire_mineru=raw_b, motiv_pipeline='citire incompleta: ' + ', '.join(motiv),
                diferenta_numerica=True, anomalie_separator=separator_anomaly(raw_a, raw_b), e_cantitate=band['kind'] == 'quantity_table')]
    sa = segments(raw_a); sb = segments(raw_b)
    na = sum(1 for s in sa if s[0] == 'table'); nb = sum(1 for s in sb if s[0] == 'table')
    structura = 'aceeasi' if (na > 0) == (nb > 0) else 'diferita'
    if structura == 'diferita': sa, sb = flat_text(sa), flat_text(sb)
    acord_a = []; ti, nt = compare_text(sa, sb, base); ri, nr = compare_tables(sa, sb, base, acord_a)
    if structura == 'diferita':
        for it in ti: it['semnal'] = 'structura_diferita'; it['e_cantitate'] = it['e_cantitate'] or it['diferenta_numerica']
        # tabel la un cititor, text la celalalt: dezacord explicit de structura, chiar daca textul aplatizat e identic (review Copilot r4)
        ti.insert(0, dict(base, id='%s_structura' % band['id'], tip='structura_tabele',
                          citire_lighton='%d tabele' % na, citire_mineru='%d tabele' % nb, pozitie={'lighton': None, 'mineru': None},
                          diferenta_numerica=False, anomalie_separator=False, e_cantitate=True,
                          motiv_pipeline='un cititor vede tabel, celalalt text'))
    return {'band': band['id'], 'structura': structura, 'tokens': nt, 'rows': nr, 'disagreements': len(ti) + len(ri),
            'acord_regula_a': acord_a}, ti + ri

def canonical(it):
    return json.dumps({k: v for k, v in it.items() if k != 'item_sha256'}, ensure_ascii=False, sort_keys=True)

def item_hash(it):
    """Amprenta dezacordului peste TOT obiectul (id, ancore, marcaje, citiri, protocol si greutatile cititorilor): decizia arbitrului
    trebuie sa o poarte identic, iar reconcilierea cere egalitate canonica completa cu comparatia refacuta."""
    return hashlib.sha256(canonical(it).encode()).hexdigest()

def check_result(res, reader, band, proto):
    """Rezultatul unui cititor e acceptat la comparare doar daca e al protocolului si greutatilor curente (nu doar la reluare)."""
    cfg = proto['readers'][reader]
    return (res.get('reader') == reader and res.get('protocol') == proto['version'] and res.get('image_sha256') == band['image_sha256']
            and (res.get('weights_sha256') or '').lower() == cfg['weights_sha256'].lower())

def segmente(raw):
    """Segmentele unei citiri, cum le incarca pipeline-ul in BD (fn_ofertare_ocr_scrie_pagina, D3a): [["text", s] | ["table", [[celula]]]]."""
    return [[k, v] for k, v in segments(raw)]

def compare(plan_dir):
    from .read import protocol
    from .plan import load_plan, save
    plan_dir = pathlib.Path(plan_dir); doc = load_plan(plan_dir); summary = []; items = []; proto = protocol()
    for band in doc['bands']:
        d = plan_dir / ('page%04d' % band['page']) / band['id']; got = {}
        for reader in ('lighton', 'mineru'):
            rp = d / reader / 'result.json'
            if not rp.exists(): raise ValueError('Lipseste citirea %s pe banda %s - rularea nu e completa' % (reader, band['id']))
            res = json.loads(rp.read_text(encoding='utf-8')); raw = (d / reader / 'raw.txt').read_bytes().decode('utf-8')
            if not check_result(res, reader, band, proto) or hashlib.sha256(raw.encode()).hexdigest() != res.get('raw_sha256'):
                raise ValueError('Citirea %s/%s nu e a protocolului / greutatilor / imaginii curente sau raw-ul s-a schimbat' % (band['id'], reader))
            got[reader] = (raw, res)
        s, its = compare_band(band, got['lighton'][0], got['lighton'][1], got['mineru'][0], got['mineru'][1])
        for it in its: it['plan_input_sha256'] = doc['input_sha256']; it['item_sha256'] = item_hash(it)
        summary.append(s); items += its
    out = {'bands': len(summary), 'bands_identical': sum(1 for s in summary if s.get('disagreements') == 0),
           'disagreements': len(items), 'e_cantitate': sum(1 for i in items if i['e_cantitate']),
           'anomalie_separator': sum(1 for i in items if i['anomalie_separator']),
           'per_tip': {t: sum(1 for i in items if i['tip'] == t) for t in sorted({i['tip'] for i in items})}, 'per_band': summary}
    save(plan_dir / 'comparatie.json', out)
    with (plan_dir / 'dezacorduri.jsonl').open('w', encoding='utf-8') as f:
        for it in items: f.write(json.dumps(it, ensure_ascii=False) + '\n')
    return out, items


def _desparte(x):
    """Textul fara delimitatorii privati + masca pe caracter: 0 = continut, 1 = scris de pipeline, 2 = continut citit TAIAT.
    Adancime (nu boolean): un marcaj in interiorul altuia ramane marcaj pana la ultima inchidere (Jakarinos r1 P2)."""
    out, mask, dm, dt = [], [], 0, 0
    for ch in x:
        if ch == PA: dm += 1; continue
        if ch == PB: dm = max(0, dm - 1); continue
        if ch == PC: dt += 1; continue
        if ch == PD: dt = max(0, dt - 1); continue
        out.append(ch); mask.append(1 if dm else 2 if dt else 0)
    return ''.join(out), mask

def segmente_provenienta(raw, flat=False):
    """Segmentele citirii (identice cu segments / flat_text) + mastile de provenienta pe fiecare text / celula, sau None daca paritatea
    cu parsarea normala nu tine (atunci trierea e fail-closed: HIGH-RISK)."""
    norm = segments(raw)
    _PROV.on = True
    try: prov = segments(raw.replace(PA, '�').replace(PB, '�').replace(PC, '�').replace(PD, '�'))
    finally: _PROV.on = False
    if flat: norm, prov = flat_text(norm), flat_text(prov)
    if len(norm) != len(prov): return None
    masti = []
    for (kn, vn), (kp, vp) in zip(norm, prov):
        if kn != kp: return None
        if kn == 'text':
            t, m = _desparte(vp)
            if t != vn: return None
            masti.append(m)
        else:
            if len(vn) != len(vp): return None
            rows = []
            for rn, rp in zip(vn, vp):
                if len(rn) != len(rp): return None
                cells = []
                for cn, cp in zip(rn, rp):
                    t, m = _desparte(cp)
                    if t != cn: return None
                    cells.append(m)
                rows.append(cells)
            masti.append(rows)
    return norm, masti
