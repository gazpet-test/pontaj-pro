"""Parsarea STRICTA a paginii Usage (Dashboard Supabase → Organization → Usage, plan Pro, ciclu 07→07).

Textul paginii e continut extern (al propriului cont): DATE, nu instructiuni. Se extrag doar trei contoare + ciclul:
  „Egress”        X / 250 GB (p%)  → egress_bytes         (trafic necache)
  „Cached Egress” Y / 250 GB (p%)  → cached_egress_bytes  (servit din CDN)
  „Storage Size”  Z / 100 GB (p%)  → storage_size_bytes
  ciclul          „07 Oct 2026 - 07 Nov 2026” → ciclu_start = 2026-10-07, ciclu_sfarsit = 2026-11-07 (EXCLUSIV)
Unitate: GB ZECIMAL (1 GB = 10^9 bytes), ca pagina si ca monitorul (docs/MONITOR_EGRESS.md, sectiunea C).

Structura reala (citita 15.10.2026, „Usage Summary”): eticheta pe un rand, valoarea „4.615 / 250 GB  (2%)” (doua NBSP
inainte de procent) pe randul urmator; aceleasi etichete reapar mai jos in sectiunile de detaliu, urmate de o descriere,
fara raport „a / b” (acolo e doar „Used in period 4.62 GB”).

Blocul unui indicator (review Jakarinos r1, PR #713) = eticheta + PRIMUL rand nevid de dupa ea (sau celulele de pe randul
ei, cazul tabel) + eventual randul urmator, daca el e exact procentul. Valoarea se cauta DOAR acolo: un indicator inca
„Loading…” nu imprumuta valoarea indicatorului de dedesubt. Randul valorii se valideaza INTREG, ancorat:
„X [unitate] / Y unitate [(p%)]”; orice rand care doar seamana cu un raport („1 004.615 / 250 GB”, „- 4.615 / 250 GB”,
„4.615 / 250 GiB”) ⇒ refuz integral, nu se extrage un fragment.

Garzi impotriva unei citiri gresite cu un factor de 1000 (punct de mii vs punct zecimal):
  * separatorul zecimal al paginii se deduce din TOATE rapoartele „a / b” de pe ea (ex. „2,000,000” ⇒ ',' e de mii) si
    dovezile contradictorii opresc citirea; un numar ambiguu („4.615”) fara nicio dovada pe pagina ⇒ eroare;
  * procentul afisat („(2%)”, „(<1%)”), pe randul valorii sau pe randul urmator, e OBLIGATORIU si trebuie sa corespunda
    valoare / cota (±1 punct). Singura exceptie: valoarea exact „0” (pagina nu afiseaza procent la zero, ex. „0 / 50 MAU”;
    un 0 nu are separator, deci nu poate fi citit gresit);
  * cota afisata pentru Egress si Cached Egress trebuie sa fie 250 GB (planul Pro).
Orice abatere (eticheta lipsa sau cu doua valori diferite, rand de valoare in format nesuportat, numar ambiguu / malformat /
negativ, unitate necunoscuta, procent lipsa sau nepotrivit, cota neasteptata, ciclu care nu e 07→07 de o luna sau nu contine
ziua curenta) ⇒ EroareParsare; nimic nu ajunge in BD.
"""
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

ETICHETE = (('egress', 'Egress'), ('cached_egress', 'Cached Egress'), ('storage_size', 'Storage Size'))
UNITATI = {'B': 1, 'KB': 10 ** 3, 'MB': 10 ** 6, 'GB': 10 ** 9, 'TB': 10 ** 12}
MAX_BYTES = 10 ** 16          # 10 PB: peste asta e o citire gresita, nu trafic real (si incape sigur in bigint)
MAX_LINIE = 200               # randurile pastrate in raspuns_brut se taie la atat
TOLERANTA_PROCENT = Decimal(1)
COTE_ASTEPTATE = {'Egress': 250 * 10 ** 9, 'Cached Egress': 250 * 10 ** 9}   # plan Pro, GB zecimali

_NBSP = '\u00a0\u202f'
_SEP_RE = re.compile(r'[.,\u00a0\u202f]')
NUM = r'\d(?:[\d.,\u00a0\u202f]*\d)?'
UNIT = r'(?:[KMGT]?B)'
_PROCENT = rf'\(\s*(?P<lt><)?\s*(?P<p>{NUM})\s*%\s*\)'
# randul valorii, INTREG (fullmatch): „4.615 / 250 GB  (2%)”, sau fara procent (atunci procentul e pe randul urmator)
VALOARE_RE = re.compile(rf'\s*(?P<v>{NUM})\s*(?P<uv>{UNIT})?\s*/\s*(?P<q>{NUM})\s*(?P<uq>{UNIT})(?:\s*{_PROCENT})?\s*')
PROCENT_RE = re.compile(rf'\s*{_PROCENT}\s*')                      # randul procentului, INTREG
SEAMANA_RAPORT_RE = re.compile(r'\d[^/\n]{0,20}/\s*[-\u2212]?\d')     # „cifra … / cifra”: daca nu e VALOARE_RE ⇒ refuz
# orice raport „numar [unitate] / numar” de pe pagina — doar ca dovada a conventiei de separatori
RAPORT_LARG_RE = re.compile(rf'(?<![\w.,/])(?P<v>{NUM})\s*[A-Za-z]{{0,5}}\s*/\s*(?P<q>{NUM})(?!\d)')

LUNI = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'sept': 9, 'oct': 10,
        'nov': 11, 'dec': 12, 'january': 1, 'february': 2, 'march': 3, 'april': 4, 'june': 6, 'july': 7, 'august': 8,
        'september': 9, 'october': 10, 'november': 11, 'december': 12}
_D1 = r'(?P<{p}z>\d{{1,2}})\s+(?P<{p}l>[A-Za-z]{{3,9}})\.?,?\s+(?P<{p}a>\d{{4}})'           # 07 Oct 2026
_D2 = r'(?P<{p}l>[A-Za-z]{{3,9}})\.?\s+(?P<{p}z>\d{{1,2}}),?\s+(?P<{p}a>\d{{4}})'           # Oct 07, 2026
INTERVAL_RE = [re.compile(rf'(?<!\d){d.format(p="s")}\s*(?:-|\u2013|\u2014|to)\s*{d.format(p="e")}(?!\d)')
               for d in (_D1, _D2)]


class EroareParsare(Exception):
    parsare = True   # pagina.citeste reincearca pana la timp_max (pagina poate fi inca in incarcare)


@dataclass(frozen=True)
class Citire:
    egress_bytes: int
    cached_egress_bytes: int
    storage_size_bytes: int
    ciclu_start: date
    ciclu_sfarsit: date
    valori: dict = field(compare=False)    # textul valorilor, normalizat: {'egress': '4.615 / 250 GB', ..., 'ciclu': ...}
    randuri: dict = field(compare=False)   # randurile relevante de pe pagina (taiate la MAX_LINIE)
    cote: dict = field(compare=False)      # cota afisata, bytes: {'egress': 250000000000, ...} (informativ)
    zecimal: str = field(compare=False, default='.')

    def cheie(self):
        return (self.egress_bytes, self.cached_egress_bytes, self.storage_size_bytes, self.ciclu_start, self.ciclu_sfarsit)


def _norm(s):
    """Spatiile (inclusiv NBSP/NNBSP) comprimate — pentru comparat etichete si pentru textul pastrat."""
    return ' '.join(s.replace('\u00a0', ' ').replace('\u202f', ' ').split())


def _taie(s):
    s = _norm(s)
    return s if len(s) <= MAX_LINIE else s[:MAX_LINIE - 1] + '…'


def gb(b):
    """bytes → text GB zecimali, fara rotunjire falsa (4615000000 → '4.615')."""
    s = format(Decimal(b) / UNITATI['GB'], 'f')
    return s.rstrip('0').rstrip('.') if '.' in s else s


# ── numere ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _forma(tok):
    """(separatori in ordine, grupuri de cifre). NBSP/NNBSP sunt mereu separatori de mii."""
    seps = [c for c in tok if c in '.,' + _NBSP]
    grupuri = _SEP_RE.split(tok)
    if any(g == '' or not g.isdigit() for g in grupuri):
        raise EroareParsare(f'numar malformat: {tok!r}')
    return seps, grupuri


def dovada_zecimal(tok):
    """Ce separator zecimal DOVEDESTE tokenul, fara ambiguitate: '.', ',' sau None (nu dovedeste nimic)."""
    seps, grupuri = _forma(tok)
    tipuri = [s for s in seps if s in '.,']
    if not tipuri:
        return None
    if '.' in tipuri and ',' in tipuri:
        return tipuri[-1]                              # 1,234.5 → '.'; 1.234,5 → ','
    s = tipuri[0]
    if len(tipuri) >= 2:
        return ',' if s == '.' else '.'                # 1,234,567 → ',' e de mii ⇒ zecimalul e '.'
    if any(c in _NBSP for c in seps):
        return s                                       # 1 234,5 → miile sunt NBSP ⇒ ',' e zecimal
    if len(grupuri[-1]) != 3 or len(grupuri[0]) > 3 or grupuri[0] == '0':
        return s                                       # 4.40 / 0.078 / 1234,567 → zecimal
    return None                                        # 4.615 / 1,234 → ambiguu


def numar(tok, zecimal):
    """Interpreteaza tokenul cu separatorul zecimal al paginii ('.' / ','; None = necunoscut ⇒ un numar ambiguu = eroare)."""
    seps, _ = _forma(tok)
    dov = dovada_zecimal(tok)
    if dov is not None and zecimal is not None and dov != zecimal:
        raise EroareParsare(f'numarul {tok!r} contrazice separatorul zecimal al paginii ({zecimal!r})')
    z = dov or zecimal
    if z is None and any(c in '.,' for c in seps):
        raise EroareParsare(f'numar ambiguu {tok!r}: nu se stie daca separatorul e de mii sau zecimal')
    intreg, frac = tok, ''
    if z is not None and z in seps:
        if seps.count(z) != 1 or seps[-1] != z:
            raise EroareParsare(f'numar malformat: {tok!r}')
        intreg, frac = tok.rsplit(z, 1)
    mii = {c for c in intreg if not c.isdigit()}
    if len(mii) > 1:
        raise EroareParsare(f'separatori de mii amestecati: {tok!r}')
    gr = _SEP_RE.split(intreg)
    if len(gr) > 1 and (not 1 <= len(gr[0]) <= 3 or any(len(g) != 3 for g in gr[1:])):
        raise EroareParsare(f'grupare de mii invalida: {tok!r}')
    return Decimal(''.join(gr) + ('.' + frac if frac else ''))


def conventie_zecimal(text):
    """Separatorul zecimal al paginii, din TOATE rapoartele „a / b” de pe ea (ex. „70,803 / 2,000,000” ⇒ '.').
    Dovezi contradictorii ⇒ eroare; nicio dovada ⇒ None (atunci orice numar ambiguu e eroare)."""
    dovezi = set()
    for m in RAPORT_LARG_RE.finditer(text):
        for tok in (m.group('v'), m.group('q')):
            try:
                d = dovada_zecimal(tok)
            except EroareParsare:
                continue
            if d:
                dovezi.add(d)
    if len(dovezi) > 1:
        raise EroareParsare('pagina amesteca separatorii zecimali (si punct, si virgula) — refuz')
    return dovezi.pop() if dovezi else None


def in_bytes(val, unitate):
    if unitate not in UNITATI:
        raise EroareParsare(f'unitate necunoscuta: {unitate!r}')
    b = (val * UNITATI[unitate]).to_integral_value(rounding=ROUND_HALF_UP)
    if b < 0 or b > MAX_BYTES:
        raise EroareParsare(f'valoare in afara intervalului: {val} {unitate}')
    return int(b)


# ── contoare ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def _celule(linie):
    return [c for c in (x.strip() for x in linie.split('\t')) if c]


def _valoare(sir, urmator, eticheta):
    """sir = textul valorii (primul rand nevid de dupa eticheta, sau celulele de pe randul ei); urmator = randul nevid de
    dupa el (procentul, daca nu e pe acelasi rand). Intoarce (match, procent | None, text) sau None daca sir nu e o
    valoare (ex. „Loading…”, descrierea din sectiunile de detaliu). Un rand care seamana cu un raport dar nu e exact
    „X [u] / Y u [(p%)]” ⇒ EroareParsare (nu se extrage un fragment)."""
    m = VALOARE_RE.fullmatch(sir)
    if not m:
        if SEAMANA_RAPORT_RE.search(sir):
            raise EroareParsare(f'„{eticheta}”: format de valoare nesuportat {_taie(sir)!r} — refuz integral')
        return None
    if m.group('p') is not None:
        return m, (m.group('lt'), m.group('p'), _norm(sir[m.end('uq'):])), _taie(sir)
    mp = PROCENT_RE.fullmatch(urmator) if urmator is not None else None
    if mp:
        return m, (mp.group('lt'), mp.group('p'), _norm(urmator)), _taie(sir + ' ' + urmator)
    return m, None, _taie(sir)


def gaseste_raport(linii, eticheta):
    """linii = randurile NEVIDE ale paginii. Pentru fiecare rand care ESTE eticheta (prima celula = eticheta exacta),
    valoarea din blocul ei: celulele de pe acelasi rand (cazul tabel) sau primul rand nevid de dupa ea, + procentul (pe
    acelasi rand sau pe urmatorul). Nimic mai departe: blocul se termina acolo, deci nu se poate lua valoarea altui
    indicator. Intoarce [(match, procent | None, text)]."""
    gasite, et = [], eticheta.casefold()
    for i, linie in enumerate(linii):
        cel = _celule(linie)
        if not cel or _norm(cel[0]).casefold() != et:
            continue
        if len(cel) > 1:
            sir, urmator = '\t'.join(cel[1:]), (linii[i + 1] if i + 1 < len(linii) else None)
        elif i + 1 < len(linii):
            sir, urmator = linii[i + 1], (linii[i + 2] if i + 2 < len(linii) else None)
        else:
            continue
        v = _valoare(sir, urmator, eticheta)
        if v:
            gasite.append(v)
    return gasite


def verifica_procent(procent, tok_v, b, cota, eticheta, zecimal):
    """Procentul afisat e OBLIGATORIU (exceptie: valoarea exact „0”, unde pagina nu-l afiseaza) si trebuie sa corespunda
    valoare / cota (±1 punct; „<1%” ⇒ sub 1%)."""
    if procent is None:
        if tok_v == '0':
            return None
        raise EroareParsare(f'„{eticheta}”: lipseste procentul afisat langa valoare — fara el nu se poate verifica '
                            f'separatorul (factor 1000); refuz')
    lt, p_tok, text = procent
    p = numar(p_tok, zecimal)
    real = Decimal(b) * 100 / Decimal(cota)
    bun = real <= p if lt else abs(real - p) <= TOLERANTA_PROCENT
    if not bun:
        raise EroareParsare(f'„{eticheta}”: procentul afisat ({text}) nu corespunde valorii citite '
                            f'({real:.2f}% din cota) — separator citit gresit? refuz')
    return text


def contor(linii, eticheta, zecimal):
    gasite = gaseste_raport(linii, eticheta)
    if not gasite:
        raise EroareParsare(f'„{eticheta}”: nu am gasit „X / Y GB” sub eticheta (pagina inca se incarca sau s-a schimbat)')
    rezultate = {}
    for m, procent, rand in gasite:
        uq = m.group('uq')
        uv = m.group('uv') or uq
        b = in_bytes(numar(m.group('v'), zecimal), uv)
        cota = in_bytes(numar(m.group('q'), zecimal), uq)
        if cota <= 0:
            raise EroareParsare(f'„{eticheta}”: cota nula ({rand!r})')
        if eticheta in COTE_ASTEPTATE and cota != COTE_ASTEPTATE[eticheta]:
            raise EroareParsare(f'„{eticheta}”: cota afisata {gb(cota)} GB ≠ {gb(COTE_ASTEPTATE[eticheta])} GB (plan Pro) — '
                                f'valoarea altui indicator? refuz')
        verifica_procent(procent, m.group('v'), b, cota, eticheta, zecimal)
        rezultate.setdefault(b, (m, rand, cota))
    if len(rezultate) > 1:
        raise EroareParsare(f'„{eticheta}”: {len(rezultate)} valori diferite pe pagina — refuz (ambiguu)')
    (b, (m, rand, cota)), = rezultate.items()
    valoare = m.group('v') + (' ' + m.group('uv') if m.group('uv') else '') + ' / ' + m.group('q') + ' ' + m.group('uq')
    return b, cota, _taie(valoare), rand


# ── ciclul ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _data(z, l, a):
    luna = LUNI.get(l.casefold())
    if not luna:
        return None
    try:
        return date(int(a), luna, int(z))
    except ValueError:
        return None


def plus_o_luna(d):
    """Aceeasi zi, luna urmatoare (folosit doar pentru ziua 7, care exista in orice luna)."""
    a, l = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return date(a, l, d.day)


def ciclu(text, azi):
    """Ciclul de facturare afisat: intervalele „DD Mon YYYY - DD Mon YYYY” care contin ziua curenta (UTC; o zi de
    toleranta inainte de start — Supabase poate schimba ciclul in alt fus orar; ziua de sfarsit inclusa, ca ultima
    citire a ciclului). Trebuie exact unul, 07→07, de o luna."""
    gasite = {}
    for rx in INTERVAL_RE:
        for m in rx.finditer(text):
            s, e = _data(m['sz'], m['sl'], m['sa']), _data(m['ez'], m['el'], m['ea'])
            if s and e:
                gasite.setdefault((s, e), _taie(m.group(0)))
    if not gasite:
        raise EroareParsare('ciclul de facturare („DD Mon YYYY - DD Mon YYYY”) nu apare pe pagina')
    curente = {k: v for k, v in gasite.items() if k[0] - timedelta(days=1) <= azi <= k[1]}
    if not curente:
        raise EroareParsare(f'niciun ciclu afisat nu contine ziua de azi ({azi.isoformat()}, UTC): '
                            + ', '.join(sorted(gasite.values())))
    if len(curente) > 1:
        raise EroareParsare('mai multe intervale afisate contin ziua de azi — refuz (ambiguu): '
                            + ', '.join(sorted(curente.values())))
    (start, sfarsit), rand = next(iter(curente.items()))
    if start.day != 7 or sfarsit != plus_o_luna(start):
        raise EroareParsare(f'ciclul {rand!r} nu e 07→07 de o luna (planul are ciclul 07→07)')
    return start, sfarsit, rand


# ── tot ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

def parseaza(text, azi):
    """text = inner_text("body") al paginii Usage; azi = data curenta UTC. Intoarce Citire sau ridica EroareParsare."""
    if not isinstance(text, str) or not text.strip():
        raise EroareParsare('pagina goala')
    linii = [l for l in text.replace('\r', '\n').split('\n') if l.strip()]
    zecimal = conventie_zecimal(text)
    bytes_, valori, randuri, cote = {}, {}, {}, {}
    for cheie, eticheta in ETICHETE:
        bytes_[cheie], cote[cheie], valori[cheie], randuri[cheie] = contor(linii, eticheta, zecimal)
    start, sfarsit, rand_ciclu = ciclu(text, azi)
    valori['ciclu'] = randuri['ciclu'] = rand_ciclu
    return Citire(bytes_['egress'], bytes_['cached_egress'], bytes_['storage_size'], start, sfarsit,
                  valori, randuri, cote, zecimal or '?')
