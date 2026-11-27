"""Alunecarea eticheta - valoare in tabelele de tip „breviar de calcul” (cerere Razvan 27.11.2026, PT V1 Lot 1 pag. 120).

Tabelele de date de proiectare au eticheta cu simbolul la coada („Presiunea, p”) si valoarea care incepe cu acelasi simbol („p = 0 MPa”).
Un cititor poate pune un rand-titlu ca rand de date si atunci TOATE valorile alunecă cu un rand fata de etichete („Presiunea, p | = |
355 MPa”): textul final spune o cifra gresita, iar comparatia nu vede nimic daca celalalt cititor da etichetele si valorile ca liste
separate. Detectorul se uita la tabelul UNUI cititor, singur:
- perechi pe rand = randurile cu simbol si in eticheta (prima coloana), si la inceputul primei celule de valoare nevide;
- semnal doar daca exista >= PRAG_PERECHI perechi si majoritatea lor NU se potrivesc (o greseala izolata ramane treaba comparatiei);
- deplasarea k (valoarea etichetei de pe randul i sta pe randul i + k, k in DEPLASARI) e sigura doar daca e UNICA, cu >= PRAG_PERECHI
  perechi deplasate potrivite si cel mult o contradictie -> semnal ALUNECARE + propunere de realiniere;
- altfel (nicio deplasare sau mai multe) -> semnal NECLAR, fara propunere.
Textul cititorului nu se schimba niciodata aici: propunerea e separata si marcata ca propunere. O singura definitie, folosita de
compare.compare_band (semnalul din dezacorduri.jsonl) si de asamblare.text_banda (marcajul din text_conv.txt). Fara retea, fara BD."""
import re
import unicodedata

PRAG_PERECHI = 3
DEPLASARI = (-1, 1, -2, 2)
SEMNAL_ALUNECARE = 'aliniere_eticheta_valoare'
SEMNAL_NECLAR = 'nealiniat_deplasare_neclara'
SEMNALE = (SEMNAL_ALUNECARE, SEMNAL_NECLAR)

# comenzile LaTeX ale literelor grecesti (cititorii scriu \gamma, \( \sigma_{a} \) ...); restul comenzilor (\quad, \times) devin spatiu
GREC = {'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'epsilon': 'ε', 'varepsilon': 'ε', 'zeta': 'ζ', 'eta': 'η',
        'theta': 'θ', 'vartheta': 'θ', 'iota': 'ι', 'kappa': 'κ', 'lambda': 'λ', 'mu': 'μ', 'nu': 'ν', 'xi': 'ξ', 'pi': 'π',
        'rho': 'ρ', 'sigma': 'σ', 'varsigma': 'σ', 'tau': 'τ', 'upsilon': 'υ', 'phi': 'φ', 'varphi': 'φ', 'chi': 'χ', 'psi': 'ψ',
        'omega': 'ω', 'Gamma': 'Γ', 'Delta': 'Δ', 'Theta': 'Θ', 'Lambda': 'Λ', 'Xi': 'Ξ', 'Pi': 'Π', 'Sigma': 'Σ', 'Phi': 'Φ',
        'Psi': 'Ψ', 'Omega': 'Ω'}
# simbolul: o litera (orice alfabet), apoi cel mult 5 litere / cifre, optional indice _x (cel mult 8); „Δ S” lipit de litera urmatoare
SIMBOL = r'(?:Δ ?)?[^\W\d_][^\W_]{0,5}(?:_[^\W_]{1,8})?'
ETICHETA = re.compile(r',\s*(' + SIMBOL + r')\s*[:.]?\s*$')
VALOARE = re.compile(r'^\s*(' + SIMBOL + r')\s*:?=')


def curata(celula):
    """Celula -> forma de comparat a simbolurilor: LaTeX \\( \\) $ scos, \\text{x} -> x, \\gamma -> γ, <sub>x</sub> / _{x} -> _x."""
    s = unicodedata.normalize('NFKC', celula or '')
    s = re.sub(r'<sub\b[^>]*>(.*?)</sub\s*>', r'_\1', s, flags=re.I | re.S)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'\\[()\[\]]|\$', ' ', s)
    s = re.sub(r'\\(?:text|mathrm|mathit|mathbf|operatorname|boldsymbol)\s*\{([^{}]*)\}', r'\1', s)
    s = re.sub(r'\\([A-Za-z]+)', lambda m: GREC.get(m.group(1), ' '), s)
    s = s.replace('{', '').replace('}', '')
    s = re.sub(r'\s*_\s*', '_', s)
    return re.sub(r'\s+', ' ', s).strip()


def cheie(sim):
    """Cheia de comparare a unui simbol: fara spatii si fara „_”, litere mici (t_w = t_{w} = tw, B_d = b_d, SMYS = smys)."""
    return sim.replace('_', '').replace(' ', '').casefold()


def simbol_eticheta(celula):
    m = ETICHETA.search(curata(celula))
    return cheie(m.group(1)) if m else None


def simbol_valoare(celula):
    m = VALOARE.match(curata(celula))
    return cheie(m.group(1)) if m else None


def _valori(rand):
    return list(rand[1:])


def _simbol_valori(rand):
    """Simbolul de la inceputul PRIMEI celule de valoare nevide (coloanele de dupa eticheta); „= 355 MPa” = fara simbol."""
    for c in _valori(rand):
        if c.strip(): return simbol_valoare(c)
    return None


def detecteaza(rows):
    """rows = randurile unui tabel ([[celula]]). None = nimic de semnalat; altfel dict cu semnal, k, randuri (indicii randurilor cu
    pereche contrazisa), perechi / potrivite si propunerea (doar la ALUNECARE)."""
    idx = [i for i, r in enumerate(rows) if any((c or '').strip() for c in r)]  # randurile complet goale nu conteaza
    R = [rows[i] for i in idx]; n = len(R)
    L = [simbol_eticheta(r[0]) if r else None for r in R]
    V = [_simbol_valori(r) for r in R]
    pe_rand = [j for j in range(n) if L[j] and V[j]]
    potrivite = [j for j in pe_rand if L[j] == V[j]]
    nepotrivite = [j for j in pe_rand if L[j] != V[j]]
    if len(pe_rand) < PRAG_PERECHI or len(nepotrivite) <= len(potrivite): return None
    candidati = []
    for k in DEPLASARI:
        dep = [j for j in range(n) if L[j] and 0 <= j + k < n and V[j + k]]
        bune = [j for j in dep if L[j] == V[j + k]]
        if len(bune) >= PRAG_PERECHI and len(dep) - len(bune) <= 1:
            candidati.append((k, dep, bune))
    out = {'perechi': len(pe_rand), 'potrivite': len(potrivite), 'randuri': [idx[j] for j in nepotrivite],
           'perechi_pe_rand': [[idx[j], L[j], V[j]] for j in pe_rand], 'deplasari_posibile': sorted(c[0] for c in candidati)}
    if len(candidati) != 1:
        return dict(out, semnal=SEMNAL_NECLAR, k=None, propunere=None, contradictii=[])
    k, dep, bune = candidati[0]
    contra = [j for j in dep if j not in bune]
    return dict(out, semnal=SEMNAL_ALUNECARE, k=k, perechi_deplasate=len(dep), potrivite_deplasate=len(bune),
                contradictii=[idx[j] for j in contra], propunere=_propunere(R, k, set(contra)))


def _propunere(R, k, contra):
    """Realinierea cu deplasarea constanta k: eticheta randului j primeste valorile randului j + k. Valorile ramase fara eticheta
    apar pe un rand propriu; randul cu contradictie (simboluri diferite si dupa deplasare) e marcat „(?)”."""
    n = len(R); out = []
    gol = lambda vs: not any((c or '').strip() for c in vs)
    orfane = [j for j in range(n) if not (0 <= j - k < n)]  # randuri ale caror valori nu ajung la nicio eticheta
    if k > 0: out += [['(fără etichetă)'] + _valori(R[j]) for j in orfane if not gol(_valori(R[j]))]
    for j in range(n):
        et = R[j][0] if R[j] else ''
        vs = _valori(R[j + k]) if 0 <= j + k < n else []
        if not et.strip() and gol(vs): continue  # rand fara eticheta si fara valoare dupa realiniere: nimic de propus
        out.append([('(?) ' if j in contra else '') + et] + vs)
    if k < 0: out += [['(fără etichetă)'] + _valori(R[j]) for j in orfane if not gol(_valori(R[j]))]
    w = max(len(r) for r in out)
    return [r + [''] * (w - len(r)) for r in out]


def text_tabel(rows):
    return '\n'.join(' | '.join(r) for r in rows)


def marcaj(det, pagina=None, banda=None, cititor=None):
    """Textul vizibil pus INAINTEA tabelului in text_conv.txt (inainte, ca sa nu schimbe randurile de la coada benzii, pe care se
    face cusatura cu banda urmatoare). Propunerea e pe linii care NU incep cu „|”, deci nu poate fi luata drept rand citit."""
    unde = ', '.join(x for x in (('citirea %s' % cititor) if cititor else '', ('banda %s' % banda) if banda else '') if x)
    pag = (' pag. %s' % pagina) if pagina is not None else ''
    if det['semnal'] == SEMNAL_ALUNECARE:
        n = abs(det['k'])
        linii = ['⟦ATENȚIE: în tabelul de mai jos%s etichetele și valorile pot fi decalate cu %d %s — verifică pe imagine%s⟧'
                 % ((' (' + unde + ')') if unde else '', n, 'rând' if n == 1 else 'rânduri', pag),
                 '⟦PROPUNERE de realiniere după simboluri (NU e citirea; se confirmă pe imagine):⟧']
        linii += ['⟦propunere⟧ ' + ' | '.join(r) for r in det['propunere']]
        return '\n'.join(linii)
    return ('⟦ATENȚIE: în tabelul de mai jos%s etichetele și valorile nu se potrivesc după simboluri (deplasare neclară) — '
            'verifică pe imagine%s⟧' % ((' (' + unde + ')') if unde else '', pag))


def adnoteaza(segs, pagina=None, banda=None, cititor=None, gasite=None):
    """Segmentele unei benzi cu marcajul inserat inaintea fiecarui tabel semnalat; segmentele citite raman neschimbate.
    gasite (lista, optional) primeste (indice_segment, det) pentru statistici."""
    out = []
    for si, (kind, val) in enumerate(segs):
        if kind == 'table':
            det = detecteaza(val)
            if det:
                out.append(('text', marcaj(det, pagina, banda, cititor)))
                if gasite is not None: gasite.append((si, det))
        out.append((kind, val))
    return out
