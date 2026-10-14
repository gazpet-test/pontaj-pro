"""Pasul 3 (CPU): compararea celor doua citiri pe fiecare banda. Identic = acceptat local; orice diferenta = dezacord pentru arbitru.
Niveluri (spec §2): cuvant (ș/ş, ț/ţ unificate DOAR la comparare), cifra (separatorul zecimal NICIODATA normalizat),
rand de tabel (celule, cu rolurile cod / UM / cantitate cand se pot deduce). Textul citit ramane literal; nimic nu se corecteaza aici."""
import difflib, hashlib, html, json, pathlib, re
from .plan import load_plan, save

CEDILLA = str.maketrans({'ş': 'ș', 'ţ': 'ț', 'Ş': 'Ș', 'Ţ': 'Ț'})
# Numerele pastreaza semnul, exponentul si procentul; operatorii (* ^ / = x) sunt tokeni separati: -5 vs 5, 5% vs 5,
# 1e-3 vs 1e3, 10**2 vs 102 raman dezacorduri (review Copilot r1). Restul punctuatiei nu se compara.
NUM = r'[-+±−]?\d+(?:[.,]\d+)*(?:[eE][-+]?\d+)?[%‰]?'
TOKEN = re.compile(NUM + r'|[^\W\d_]+|[*^/=×]', re.U)
NUMBER = re.compile('^' + NUM + '$')
BOLD = re.compile(r'\*\*(?=\S)(.+?)(?<=\S)\*\*', re.S)
TABLE_HTML = re.compile(r'<table\b.*?</table\s*>', re.I | re.S)
ROW_HTML = re.compile(r'<tr\b.*?</tr\s*>', re.I | re.S)
CELL_HTML = re.compile(r'<t[dh]\b[^>]*>(.*?)</t[dh]\s*>', re.I | re.S)
MD_SEP = re.compile(r'^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$')
CONTEXT = 6

def norm_word(t): return t.translate(CEDILLA)

def clean_inline(s):
    s = re.sub(r'<br\s*/?>', ' ', s, flags=re.I); s = re.sub(r'<[^>]+>', ' ', s); s = BOLD.sub(r'\1', html.unescape(s))  # doar perechile **text** (bold markdown); un ** izolat ramane
    return re.sub(r'\s+', ' ', s).strip()

def html_rows(table):
    return [[clean_inline(c) for c in CELL_HTML.findall(r)] for r in ROW_HTML.findall(table)]

def md_rows(lines):
    rows = []
    for ln in lines:
        if MD_SEP.match(ln.strip()): continue
        s = ln.strip()
        if s.startswith('|'): s = s[1:]
        if s.endswith('|'): s = s[:-1]
        rows.append([clean_inline(c) for c in s.split('|')])
    return rows

def plain(s):
    s = re.sub(r'<br\s*/?>|</p\s*>|</h\d\s*>|</li\s*>|</div\s*>', '\n', s, flags=re.I)
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s))
    s = BOLD.sub(r'\1', re.sub(r'^\s*#{1,6}\s*', '', s, flags=re.M))
    return re.sub(r'[ \t]+', ' ', s).strip()

def segments(raw):
    """Citirea -> secventa ordonata de segmente ('text', str) / ('table', [[celula]]). HTML si markdown, ambele."""
    out = []; pos = 0
    for m in TABLE_HTML.finditer(raw):
        out += _md_split(raw[pos:m.start()]); out.append(('table', html_rows(m.group(0)))); pos = m.end()
    out += _md_split(raw[pos:])
    return [s for s in out if (s[0] == 'table' and s[1]) or (s[0] == 'text' and s[1].strip())]

def _md_split(chunk):
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

def tokens(segs):
    """Tokenii segmentelor text, cu pozitia lor (segment, start, end) pentru reconciliere."""
    out = []
    for si, (kind, val) in enumerate(segs):
        if kind != 'text': continue
        for m in TOKEN.finditer(val): out.append((m.group(0), si, m.start(), m.end()))
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

def same_content(ca, cb):
    """LightOn scrie celulele unite ca celule goale, MinerU ca o singura celula (colspan). Acelasi continut nevid, in aceeasi
    ordine, nu e dezacord - DAR numai daca celulele numerice stau la aceeasi distanta de capatul randului (altfel o cifra mutata
    in alta coloana ar trece neobservata)."""
    ne = lambda r: [norm_word(c) for c in r if c.strip()]
    if ne(ca) != ne(cb): return False
    pos = lambda r: [len(r) - 1 - i for i, c in enumerate(r) if NUMBER.match(c.strip())]
    return pos(ca) == pos(cb)

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
        if tl[i1][1] == tl[i2 - 1][1]: return segs[tl[i1][1]][1][tl[i1][2]:tl[i2 - 1][3]]
        parts = []
        for si in range(tl[i1][1], tl[i2 - 1][1] + 1):
            s = tl[i1][2] if si == tl[i1][1] else 0; e = tl[i2 - 1][3] if si == tl[i2 - 1][1] else len(segs[si][1])
            parts.append(segs[si][1][s:e])
        return '\n'.join(parts)
    for n, g in enumerate(groups):
        fa = literal(ta, seg_a, g['a1'], g['a2']); fb = literal(tb, seg_b, g['b1'], g['b2'])
        items.append(dict(base, id='%s_t%d' % (base['band'], n), tip='text', citire_lighton=fa, citire_mineru=fb,
                          context_inainte=' '.join(t[0] for t in ta[max(0, g['a1'] - CONTEXT):g['a1']]),
                          context_dupa=' '.join(t[0] for t in ta[g['a2']:g['a2'] + CONTEXT]),
                          pozitie={'lighton': [g['a1'], g['a2']], 'mineru': [g['b1'], g['b2']]},
                          diferenta_numerica=numeric_diff(fa, fb), anomalie_separator=separator_anomaly(fa, fb),
                          e_cantitate=base['kind'] == 'quantity_table' and numeric_diff(fa, fb)))
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

def compare_tables(seg_a, seg_b, base):
    ra = table_rows(seg_a); rb = table_rows(seg_b); items = []
    rows_a = [r[2] for r in ra]
    first_b = {}; last_a = {}
    for si, ri, _ in rb: first_b.setdefault(si, ri)
    for si, ri, _ in ra: last_a[si] = ri
    anchor = None  # ultimul rand LightOn vazut in ordinea alinierii: ancora pentru un rand gasit doar de MinerU
    for n, (i, j, same) in enumerate(match_rows(ra, rb)):
        prev_anchor = anchor
        if i is not None: anchor = [ra[i][0], ra[i][1]]
        if same: continue
        a = ra[i] if i is not None else None; b = rb[j] if j is not None else None
        ca = a[2] if a else None; cb = b[2] if b else None
        header = find_header(rows_a, i) if i is not None else None
        if a and b:
            if same_content(ca, cb): continue
            tip = 'rand_tabel'
            cell = lambda r, k: norm_word(r[k]) if k < len(r) else None
            diff = [k for k in range(max(len(ca), len(cb))) if cell(ca, k) != cell(cb, k)]
            rl = roles(header, ca)
            has_num = any(NUMBER.match(x.strip()) for x in ca + cb)
            e_cant = (len(ca) != len(cb) and has_num) or rl.get('cantitate') in diff
            triplet = len(ca) != len(cb) or any(rl.get(x) in diff for x in ('cod', 'um', 'cantitate'))
        else:
            tip = 'rand_lipsa_lighton' if a is None else 'rand_lipsa_mineru'; diff = None
            rl = roles(header, ca or cb); e_cant = 'cantitate' in rl; triplet = True
        fa = ' | '.join(ca) if ca is not None else ''; fb = ' | '.join(cb) if cb is not None else ''
        prev = ra[i - 1][2] if i else None
        items.append(dict(base, id='%s_r%d' % (base['band'], n), tip=tip, citire_lighton=fa, citire_mineru=fb,
                          celule_diferite=diff, roluri=rl, celule_lighton=ca, celule_mineru=cb,
                          ancora_lighton=prev_anchor if a is None else None,
                          # ancora sigura doar in interiorul aceluiasi tabel: nici primul rand al tabelului MinerU, nici dupa ultimul rand al unui tabel LightOn
                          ancora_sigura=bool(a is None and prev_anchor is not None and b[1] != first_b.get(b[0]) and prev_anchor[1] != last_a.get(prev_anchor[0])), triplet_diferit=bool(triplet), rand_anterior=' | '.join(prev) if prev else None,
                          pozitie={'lighton': [a[0], a[1]] if a else None, 'mineru': [b[0], b[1]] if b else None},
                          diferenta_numerica=numeric_diff(fa, fb), anomalie_separator=separator_anomaly(fa, fb), e_cantitate=bool(e_cant)))
    return items, len(ra)

def compare_band(band, raw_a, res_a, raw_b, res_b):
    base = {'band': band['id'], 'page': band['page'], 'kind': band['kind'], 'image': band['image'], 'image_sha256': band['image_sha256'],
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
    ti, nt = compare_text(sa, sb, base); ri, nr = compare_tables(sa, sb, base)
    if structura == 'diferita':
        for it in ti: it['semnal'] = 'structura_diferita'; it['e_cantitate'] = it['diferenta_numerica']
    return {'band': band['id'], 'structura': structura, 'tokens': nt, 'rows': nr, 'disagreements': len(ti) + len(ri)}, ti + ri

ITEM_FIELDS = ('plan_input_sha256', 'band', 'image_sha256', 'raw_sha256', 'tip', 'pozitie', 'citire_lighton', 'citire_mineru', 'celule_lighton', 'celule_mineru')

def item_hash(it):
    """Amprenta dezacordului: decizia arbitrului trebuie sa o poarte identic (o decizie veche nu se poate lipi pe alt dezacord)."""
    return hashlib.sha256(json.dumps({k: it.get(k) for k in ITEM_FIELDS}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

def compare(plan_dir):
    plan_dir = pathlib.Path(plan_dir); doc = load_plan(plan_dir); summary = []; items = []
    for band in doc['bands']:
        d = plan_dir / ('page%04d' % band['page']) / band['id']; got = {}
        for reader in ('lighton', 'mineru'):
            rp = d / reader / 'result.json'
            if not rp.exists(): raise ValueError('Lipseste citirea %s pe banda %s - rularea nu e completa' % (reader, band['id']))
            res = json.loads(rp.read_text(encoding='utf-8')); raw = (d / reader / 'raw.txt').read_text(encoding='utf-8')
            if res.get('image_sha256') != band['image_sha256'] or hashlib.sha256(raw.encode()).hexdigest() != res.get('raw_sha256'):
                raise ValueError('Legatura imagine/citire rupta pe %s/%s' % (band['id'], reader))
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
