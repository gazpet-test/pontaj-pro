"""Trierea dezacordurilor (laborator OCR 16.10.2026, decizia Razvan A dupa proba arb-v2 pe r1; v2 dupa Jakarinos r1 NO-GO).

Pe CONTINUTUL citit; marcajele scrise de pipeline (⟦rowspan⟧, cadrul ⟦img ⟧ si src-ul imaginii, ⟦tabel_neparsat⟧, ⟦…_invalid⟧, cadrul
⟦barat: ⟧, ^{ }/_{ }) sunt separate prin provenienta (compare.segmente_provenienta), nu prin forma textului. Continutul TAIAT ramane
continut, comparat distinct (bara isi pastreaza tinta).
- MARCAJE:   continutul (cu taieturile lui) e identic la ambii cititori; difera doar marcajele pipeline-ului.
- HIGH_RISK: continutul difera SI exista cel putin o cifra in continutul unuia dintre cititori (fragment / rand intreg): orice diferenta
             langa numere (UM „bar”/„bai”, semn „=”/„−”, cod „NTPEE-2018”/„NTPER-2018”, separator, coloana) e risc pe cantitati
             (Jakarinos r1 P1). Provenienta nestabilita / pozitie nerezolvata = HIGH_RISK (fail-closed).
- HIGH_RISK si fara cifre, cand diferenta atinge un termen de material / tehnologie (TERMENI_MATERIAL, decizia Razvan 16.10.2026).
- DEFER:     continutul difera, dar NU exista nicio cifra in continut la niciun cititor si nu se schimba material / tehnologie.
- OM:        structura_tabele / banda_intreaga (merg la om ca pana acum, fara AI).
Nu schimba itemii, amprentele sau contractul cu BD; e o decizie a clientului la arbitraj."""
import collections, re, unicodedata
from .compare import TOKEN, segmente_provenienta, segments, cell_key, norm_word

CLASE = ('HIGH_RISK', 'MARCAJE', 'DEFER', 'OM')
class _Cifra:  # orice caracter numeric Unicode (², ³, fullwidth, arabe ...), nu doar ASCII (Copilot / Jakarinos, PR #739)
    @staticmethod
    def search(s): return any(ch.isnumeric() for ch in s)
CIFRA = _Cifra()


def _continut(text, mask):
    """Doar continutul citit; portiunile taiate sunt incadrate in « » (distincte la comparare)."""
    out, t = [], False
    for ch, m in zip(text, mask):
        if m == 1: continue
        if (m == 2) != t: out.append(' « ' if m == 2 else ' » '); t = m == 2
        out.append(ch)
    if t: out.append(' » ')
    return ''.join(out)


def _tokeni(s):
    return [norm_word(t) for t in TOKEN.findall(s)]


def _structura_diferita(raw_a, raw_b):
    sa, sb = segments(raw_a), segments(raw_b)
    return (sum(1 for s in sa if s[0] == 'table') > 0) != (sum(1 for s in sb if s[0] == 'table') > 0)


def _fragment(prov, sursa):
    if sursa is None: return ''
    segs, masti = prov; s0, s1 = sursa['seg']; c = []
    for si in range(s0, s1 + 1):
        kind, val = segs[si]
        if kind != 'text': c.append(' ⟦tabel⟧ '); continue  # granita de tabel din fluxul de text = structura, ramane comparata
        a = sursa['start'] if si == s0 else 0; b = sursa['end'] if si == s1 else len(val)
        c.append(_continut(val[a:b], masti[si][a:b]))
    return '\n'.join(c)


VECINI = 2  # tokeni de continut de fiecare parte a fragmentului, pentru „langa cifre” (Jakarinos r1: „6 bar”/„6 bai”, „= 0,0013”)


def _vecinatate(prov, sursa):
    """Continutul fragmentului + VECINI tokeni de continut de fiecare parte (in acelasi segment), pentru decizia „langa cifre”."""
    if sursa is None: return ''
    segs, masti = prov; s0, s1 = sursa['seg']; out = []
    for si in (s0, s1) if s0 != s1 else (s0,):
        kind, val = segs[si]
        if kind != 'text': continue
        idx = [i for i, m in enumerate(masti[si]) if m != 1]; cont = ''.join(val[i] for i in idx)
        a = sursa['start'] if si == s0 else 0; b = sursa['end'] if si == s1 else len(val)
        ca = sum(1 for i in idx if i < a); cb = sum(1 for i in idx if i < b)
        toks = [(m.start(), m.end()) for m in TOKEN.finditer(cont)]
        inainte = [t for t in toks if t[1] <= ca][-VECINI:]; dupa = [t for t in toks if t[0] >= cb][:VECINI]
        lo = inainte[0][0] if inainte else ca; hi = dupa[-1][1] if dupa else cb
        out.append(cont[lo:hi])
    return ' '.join(out) + ' ' + _fragment(prov, sursa)


def _rand(prov, poz):
    if poz is None: return None
    segs, masti = prov; si, ri = poz
    kind, val = segs[si]
    if kind != 'table': raise ValueError('pozitia nu e un tabel')
    return [_continut(c, m) for c, m in zip(val[ri], masti[si][ri])]


# Termeni de material / tehnologie (decizia Razvan 16.10.2026, observatia Gemini pe pipeline): o diferenta FARA cifre care atinge
# unul din ei schimba incadrarea cantitatii (PEHD/PVC, OL/OTEL, foraj orizontal/sant deschis, manual/mecanizat, SDR citit ca litere)
# -> HIGH_RISK, nu DEFER. Comparare pe tokeni fara diacritice, majuscule. „PE” simplu e EXCLUS (prepozitia „pe”; PE80/PE100 au cifre
# si sunt deja HIGH_RISK). Masurat (dupa Jakarinos r2): r1 37/5.973 DEFER (0,6%), Racari 43/3.024 (1,4%).
# Doua feluri de termeni (Jakarinos #750 r1 P1 flexiuni): EXACTE = sigle scurte (doar tokenul intreg); RADACINI = cuvinte de >= 5 litere,
# potrivite pe inceput, ca sa prinda flexiunile (betonului, sudurii, manuale, mecanizate, polietilena / polietilenei ...). „SANT” e exact
# (radacina ar prinde „santier”). Fail-safe: o potrivire in plus duce doar la arbitraj, nu la pierdere.
TERMENI_EXACTI = frozenset(('PEHD', 'HDPE', 'PVC', 'PP', 'PPR', 'OL', 'OLT', 'INOX', 'SDR', 'PN', 'DN', 'SANT', 'SANTURI', 'SANTUL',
                            'SANTULUI', 'SANTURILE', 'SANTURILOR', 'OTEL', 'OTELUL', 'OTELULUI'))
RADACINI = ('FONTA', 'FONTE', 'CUPRU', 'ALUMINIU', 'POLIETILEN', 'POLIPROPILEN', 'BETON', 'ASFALT', 'BALAST', 'NISIP', 'PIATR', 'ZINCAT',
            'BITUM', 'IZOLAT', 'IZOLATI', 'PREIZOLAT', 'ARMAT', 'FORAJ', 'ORIZONTAL', 'DIRIJAT', 'DESCHIS', 'SUBTRAVERS', 'MANUAL', 'MECANIC',
            'MECANIZAT', 'SUDUR', 'SUDAR', 'ELECTROFUZ', 'SUBTERAN', 'AERIAN', 'MONTAJ', 'MONTAR', 'DEMONTAJ', 'DEMONTAR', 'DEMOL', 'REFACER',
            'SPRIJIN', 'EPUISM')
TERMENI_MATERIAL = TERMENI_EXACTI | frozenset(RADACINI)  # pentru documentare / teste
# calificative care schimba sensul unui termen ramas identic („cu / fara sudura”, „nu se izoleaza”) (Jakarinos #750 r1 P1)
CALIFICATIVE = frozenset(('CU', 'FARA', 'NU', 'NE', 'INCLUSIV', 'EXCLUSIV'))


def _tokeni_baza(s):
    s = ''.join(c for c in unicodedata.normalize('NFD', s or '') if not unicodedata.category(c).startswith('M'))
    return collections.Counter(t.upper() for t in re.findall(r'\w+', s))


def _e_termen(t):
    return t in TERMENI_EXACTI or any(t.startswith(r) for r in RADACINI)


def termeni_material(a, b):
    """Termenii de material / tehnologie din DIFERENTA dintre doua texte (tokeni prezenti la unul si nu la celalalt)."""
    ta, tb = _tokeni_baza(a), _tokeni_baza(b)
    return sorted(t for t in set((ta - tb) + (tb - ta)) if _e_termen(t))


def _material_in_context(dif, ctx):
    """Termenii din diferenta; altfel: diferenta e un calificativ sau o valoare scurta (SDR „ll” / „lI”) langa un termen din context."""
    m = termeni_material(*dif)
    if m: return m
    ta, tb = _tokeni_baza(dif[0]), _tokeni_baza(dif[1]); d = set((ta - tb) + (tb - ta))
    termeni_ctx = sorted(t for t in set(_tokeni_baza(ctx[0]) + _tokeni_baza(ctx[1])) if _e_termen(t))
    if not termeni_ctx or not d: return []
    if d & CALIFICATIVE: return ['%s (calificativ %s)' % (termeni_ctx[0], '/'.join(sorted(d & CALIFICATIVE)))]
    if 'SDR' in termeni_ctx and all(len(t) <= 3 for t in d): return ['SDR (valoare citita ca litere)']
    return []


def _decide(a, b, egale, dif=None, perechi=None):
    """a / b = contextul pentru cifre (vecinatatea / randul); dif = (x, y) = ce difera efectiv; perechi = [(celula_a, celula_b)] la
    randurile cu acelasi numar de celule: materialul se compara celula cu celula (un material mutat intre celule nu se anuleaza)."""
    if egale: return 'MARCAJE', 'continut identic, difera doar marcajele pipeline-ului'
    if CIFRA.search(a) or CIFRA.search(b): return 'HIGH_RISK', 'continut diferit langa cifre (numar, UM, semn, cod, coloana)'
    if perechi is not None:
        # celula cu celula; contextul calificativelor = TOT randul (calificativul poate sta in alta celula: [Sudura | cu]) (Jakarinos r2 P1)
        m = sorted({t for x, y in perechi for t in _material_in_context((x, y), (a, b))})
    elif dif is None and termeni_material(a, '') + termeni_material(b, ''):
        # rand cu numar diferit de celule si termen de material in el: delimitarea s-a pierdut, iar materialele mutate se pot anula
        # pe tokeni -> conservator HIGH_RISK (Jakarinos #750 r2 P1)
        m = sorted(set(termeni_material(a, '') + termeni_material(b, '')))[:3] + ['(celule diferite)']
    else: m = _material_in_context(dif or (a, b), (a, b))
    if m: return 'HIGH_RISK', 'material / tehnologie diferit fara cifre (%s)' % ', '.join(m[:3])
    return 'DEFER', 'continut diferit fara nicio cifra'


def clasa(item, pa, pb):
    """pa / pb = segmente_provenienta pentru LightOn / MinerU (aceeasi aplatizare ca la comparare) sau None."""
    if item['tip'] in ('structura_tabele', 'banda_intreaga'): return 'OM', item['tip']
    if pa is None or pb is None: return 'HIGH_RISK', 'provenienta nestabilita (paritate)'
    try:
        if item['tip'] == 'text':
            sa, sb = (item.get('sursa') or {}).get('lighton'), (item.get('sursa') or {}).get('mineru')
            ca, cb = _fragment(pa, sa), _fragment(pb, sb)
            if _tokeni(ca) == _tokeni(cb): return _decide(ca, cb, True)
            return _decide(_vecinatate(pa, sa), _vecinatate(pb, sb), False, dif=(ca, cb))
        ra = _rand(pa, item['pozitie']['lighton']); rb = _rand(pb, item['pozitie']['mineru'])
        if ra is None or rb is None:  # rand doar la un cititor
            r = ' | '.join(rb if ra is None else ra)
            if CIFRA.search(r): return 'HIGH_RISK', 'rand lipsa la un cititor, cu cifre'
            m = termeni_material(r, '')
            if m: return 'HIGH_RISK', 'rand lipsa la un cititor, material / tehnologie (%s)' % ', '.join(m[:3])
            return 'DEFER', 'rand lipsa la un cititor, fara cifre'
        perechi = list(zip(ra, rb)) if len(ra) == len(rb) else None  # rand cu celule diferite: materialul pe tot randul
        return _decide(' | '.join(ra), ' | '.join(rb), [cell_key(c) for c in ra] == [cell_key(c) for c in rb], perechi=perechi)
    except (IndexError, KeyError, TypeError, ValueError):
        return 'HIGH_RISK', 'pozitie nerezolvata'


def triaza_banda(raw_a, raw_b, items):
    """{item_id: (clasa, motiv)} pentru dezacordurile unei benzi (aceeasi aplatizare ca compare_band)."""
    flat = _structura_diferita(raw_a, raw_b)
    pa, pb = segmente_provenienta(raw_a, flat), segmente_provenienta(raw_b, flat)
    return {it['id']: clasa(it, pa, pb) for it in items}
