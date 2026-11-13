"""Mascarea numelor și a datelor personale ÎNAINTE de furnizorul modelului — „❓ Întreabă echipa”, decizia owner-ului 13.11.2026 (A).

Ce face: în textul care pleacă la furnizor (Anthropic) înlocuiește numele de persoane și de firme, CNP-urile, CUI-urile,
telefoanele, e-mailurile, IBAN-urile și numerele de înmatriculare cu ETICHETE STABILE pe durata unei spețe: [PERSOANA_1],
[FIRMA_1], [CNP_1], [CUI_1], [TELEFON_1], [EMAIL_1], [IBAN_1], [NR_AUTO_1], [ASCUNS_1] (cuvintele ascunse manual între [[ și ]]).
Aceeași persoană / firmă = același număr; altă formă scrisă a ei (ordinea inversă, genitivul „Mariei”, cu / fără „SC”) primește
un indice: [PERSOANA_1_F2]. Tabelul etichetă → text original stă DOAR în memoria workerului (obiectul Mascare al spețe): nu se
trimite, nu se scrie în jurnal (jurnalul primește doar contoare()). La final, DOAR textul afișat utilizatorului se demaschează.

Sursa numelor: lista din platformă (angajați, terți — Dictionar, primită de worker prin edge, rămâne pe serverul nostru) + tipare
(titluri „dl.”, „ing.”, „colegul” …; forme juridice SRL / SA / PFA / II …; CNP cu cifra de control; IBAN cu mod 97; telefoane RO;
CUI cu „RO” / „CUI” / „cod fiscal” în față; numere de înmatriculare RO).

Același algoritm în src/intrebariMascare.js (previzualizarea din ecran) — paritate pe teste_mascare.json (L19).
Garda (pct. 2 din brief): TextMascat e SINGURUL tip de conținut pe care apel() din intrebari_worker.py îl lasă să plece spre
furnizor; se obține doar din Mascare.mascheaza() (sigiliu privat; testul AST verifică că _SIGILIU nu e folosit în afara modulului)
și e legat de INSTANȚA care l-a produs (Mascare.a_produs: același obiect, ținut în registrul acelei mascări) — un
str.__new__(TextMascat, …) făcut de mână nu trece. Limita: garda e împotriva GREȘELILOR de program, nu a unui cod rău-intenționat
din același proces (acela poate oricum ocoli orice verificare din Python).

Demascarea e STRICTĂ (r2, review P1-4): se pun la loc DOAR etichetele emise, scrise exact; demascheaza_sigur() refuză publicarea
dacă textul modelului are orice secvență de forma unei etichete (ASEMANATOR) care nu e exact o etichetă emisă — „[PERSOANA_999]”,
„[persoana_1]”, „[PERSOANA_1_F9]”, „PERSOANA_1” — sau o etichetă emisă pentru o „aproape etichetă” venită din textul modelului.
Nimic nu se repară tăcut.

Excepția pentru entitățile publice (decizia owner-ului 13.11.2026): lista ÎNCHISĂ din nemascate.json (un singur loc, citit și de
src/intrebariMascare.js), pe numele ÎNTREG al entității — vezi NEMASCATE.

Ce NU prinde (limite asumate, spuse și în ecran și în docs/intrebari/MASCARE_SI_VERDICT.md):
- nume necunoscute platformei scrise fără titlu în față și fără formă juridică; porecle, inițiale („I. P.”), nume scrise cu
  literă mică; un prenume din dicționar care e și cuvânt obișnuit („Ion”, „Mare”) scris SINGUR, fără titlu și fără alt nume lângă;
- firme scrise fără formă juridică și care nu sunt în lista platformei; entitățile publice din nemascate.json rămân intenționat;
- localități (rămân vizibile — decizia owner-ului), adrese, numere de contract / CF / cadastru, CUI scris fără „RO” / „CUI” și
  necunoscut platformei;
- conținutul atașamentelor (de aceea atașamentele NU se mai trimit la furnizor — decizia owner-ului).
"""
import json
import pathlib
import re
import unicodedata

CATEGORII = ('PERSOANA', 'FIRMA', 'CNP', 'CUI', 'TELEFON', 'EMAIL', 'IBAN', 'NR_AUTO', 'ASCUNS')
# eticheta emisă de noi, EXACT (majuscule): doar așa se pune la loc (r2: fără toleranță la litere mici / forme inventate)
ETICHETA = re.compile(r'\[(PERSOANA|FIRMA|CNP|CUI|TELEFON|EMAIL|IBAN|NR_AUTO|ASCUNS)_([1-9][0-9]{0,3})(?:_F([1-9][0-9]{0,2}))?\]')
# orice „aproape etichetă”: categoria (orice litere, cu / fără diacritice) + separator + cifre, cu sau fără paranteze —
# „[persoana_1]”, „[PERSOANA 1]”, „[PERSOANA_1_F9]”, „PERSOANA_1”, „[FIRMA-2]”. În textul omului se ascunde (ASCUNS, dus-întors
# exact); în textul modelului, dacă nu e EXACT o etichetă emisă, oprește publicarea (demascheaza_sigur). Aceeași în JS.
_CAT_ASEM = r'(?:PERSOAN[AĂ]|FIRM[AĂ]|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[ _.\-]?AUTO|ASCUNS)'
ASEMANATOR = re.compile(r'(?:\[[ \t]*' + _CAT_ASEM + r'[ \t_\-#]*[0-9]+|(?<![A-Za-z0-9\[])' + _CAT_ASEM + r'[ \t]*[_\-#][ \t]*[0-9]+)'
                        r'(?:[ \t]*[_\-][ \t]*[A-Za-z]?[0-9]+)*(?:[ \t]*\])?', re.I)

_L = r'(?:[^\W\d_]|[\u0300-\u036f])'      # literă (și semn diacritic combinat)
_W = r'[\w\u0300-\u036f]'                 # caracter de cuvânt (literă, cifră, _)
_SP = r'[ \t\u00a0]'
CUVANT = re.compile(rf'(?<!{_W}){_L}+(?:-{_L}+)*(?!{_W})')
NUMAR = re.compile(r'(?<![0-9])[0-9]+(?![0-9])')
SPATIU = re.compile(rf'{_SP}+')
GAP_NUME = re.compile(rf'{_SP}+|{_SP}*[&+\-]{_SP}*')                 # între cuvintele unui nume de firmă
GAP_FORMA = re.compile(rf'[”"»“]?{_SP}*,?{_SP}*')                    # între nume și forma juridică
PREFIX_FIRMA = re.compile(rf'(?:(?<!{_W[:-1]}.])(?:S\.C\.?|SC){_SP}*)?[„"«“]?\Z')   # „SC ” / „S.C. ” / ghilimeaua de deschidere
MANUAL = re.compile(r'\[\[[^\[\]\n]{1,200}\]\]')
EMAIL = re.compile(r'(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+')
IBAN = re.compile(r'(?<![A-Za-z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])')
CNP = re.compile(r'(?<![0-9])[1-9][0-9]{12}(?![0-9])')
CUI_RO = re.compile(r'(?<![A-Za-z0-9])RO[ \t]?[0-9]{4,10}(?![0-9])')
CUI_CUVANT = re.compile(r'(?<![A-Za-z0-9])(?:CUI|C\.U\.I\.?|Cui|CIF|C\.I\.F\.?|[Cc]if|[Cc][Oo][Dd](?:[Uu][Ll])?[ \t]+(?:[Ff][Ii][Ss][Cc][Aa][Ll]'
                        r'|[Uu][Nn][Ii][Cc][ \t]+[Dd][Ee][ \t]+[IiÎî][Nn][Rr][Ee][Gg][Ii][Ss][Tt][Rr][Aa][Rr][Ee]))'
                        r'[ \t]*(?:[Nn][Rr]\.?)?[ \t]*[:.\-]?[ \t]*(?P<v>(?:RO[ \t]?)?[0-9]{2,10})(?![0-9])')
CUI_LISTA = re.compile(r'(?<![0-9])[0-9]{6,10}(?![0-9])')
TELEFON = re.compile(r'(?<![0-9A-Za-z+])(?:\+40|0040|0)[ \t.\-/]?[237](?:[ \t.\-/]?[0-9]){8}(?![0-9])')
JUDETE = ('AB AG AR BC BH BN BR BT BV BZ CJ CL CS CT CV DB DJ GJ GL GR HD HR IF IL IS MH MM MS NT OT PH SB SJ SM SV TL TM TR VL VN VS')
NR_AUTO = re.compile(r'(?<![A-Za-z0-9])(?:B[ \t\-]?[0-9]{2,3}|(?:' + '|'.join(JUDETE.split()) + r')[ \t\-]?[0-9]{2})[ \t\-]?([A-Z]{3})(?![A-Za-z0-9])')
NR_AUTO_EXCLUSE = frozenset('BAR SDR PEH PVC MPA KPA ISO DIN OTL PEX PPR HDP'.split())   # „PH 10 BAR” e o presiune, nu o mașină
FORMA = re.compile(r'(?<![\w\u0300-\u036f.])(S\.R\.L\.?|S\.A\.?|P\.F\.A\.?|I\.I\.?|I\.F\.?|S\.N\.C\.?|S\.C\.S\.?|SRL|Srl|srl|SA|PFA|II|IF|SNC|SCS)'
                   r'(?![\w\u0300-\u036f])')
FORMA_DUPA = re.compile(GAP_FORMA.pattern + FORMA.pattern)
SUFIXE_CRATIMA = frozenset(('ului', 'ul', 'lui', 'ei', 'le', 'a', 'i'))     # „Popescu-ului”: sufixul rămâne în afara etichetei
FORME_JURIDICE = frozenset(('sc', 'srl', 'sa', 'pfa', 'ii', 'if', 'snc', 'scs'))
TITLURI = sorted('''d-l d-lui d-na d-nei dl dlui dna dnei domnul domnului doamna doamnei domni[sș]oara domni[sș]oarei ing inginerul
inginerului inginera inginerei arh arhitectul arhitecta dr colegul colegului colega colegei [sș]eful [sș]efului [sș]efa [sș]efei
directorul directorului directoarea directoarei dirigintele dirigintelui diriginta maistrul maistrului sudorul sudorului
[sș]oferul [sș]oferului numitul numitului numita numitei'''.split(), key=lambda x: (-len(x), x))
TITLU = re.compile(rf'(?<!{_W})(?:' + '|'.join(TITLURI) + rf')\.?{_SP}+', re.I)


def norm(s):
    """minuscule, fără diacritice — ca normalizeaza() din cercetare.py și normalizeaza() din src/intrebariSurse.js."""
    s = unicodedata.normalize('NFD', str(s or '').lower())
    return ''.join(c for c in s if not unicodedata.combining(c))


_TITLURI_NORM = frozenset(norm(x.replace('[sș]', 's')) for x in TITLURI)
# Cuvinte care nu pot fi (parte din) nume: legături, roluri, documente, structura lucrărilor („Etapa II” nu e o firmă „II”).
OPRIRE = frozenset('''si sau de la din cu pe in pentru catre prin despre fara dupa intre sub peste al ale a ai un o unei unui cel cea cei
cele acest aceasta acesta aceste acestui acestei el ea ei ele noi voi dar iar ca ce care cand unde daca nu da firma firmei firme
societatea societatii societate contractul contractului contract beneficiarul beneficiarului beneficiar antreprenorul
antreprenorului furnizorul furnizorului subcontractantul subcontractantului subcontractorul clientul clientului proiectantul
proiectantului executantul executantului ofertantul ofertantului consultantul oferta licitatia proiectul proiect lucrarea lucrare
santierul etapa faza clasa zona lot lotul capitolul anexa anexei tip tipul categoria nivelul nivel treapta grupa varianta partea
titlul sectiunea cartea volumul tronsonul tronson sectorul obiectul etajul articolul gradul plansa corp corpul bloc blocul strada str
nr judetul jud comuna orasul municipiul satul romania ro cui cif comunei orasului municipiului primaria primariei consiliul
consiliului judetean statul ministerul agentia directia administratia regia ocolul parohia asociatia mostenitorii mostenitor
neidentificat'''.split()) | FORME_JURIDICE | _TITLURI_NORM
# Nume din platformă care sunt și cuvinte obișnuite: singure (fără alt nume lângă) nu se ascund („Mare parte din …”).
COMUNE = frozenset('''mare mic mica micu preda verde rosu negru alb albu bun buna lung lungu gros grosu scurt nou noua vechi ion ioni
mai iunie iulie august tot toma'''.split())
# Firme dintr-un singur cuvânt prea general ca să fie căutat singur.
GENERICE_FIRMA = frozenset('''construct constructii instal grup group impex trans service servicii com prod serv consult general
proiect design tehnic tehnica gaz gaze energy energie'''.split())
# Entitățile care rămân VIZIBILE (decizia owner-ului 13.11.2026, după review-ul PR #1086): operatorii de rețea, companiile /
# instituțiile publice și Gazpet — cerințele lor sunt chiar subiectul întrebărilor. Lista e ÎNCHISĂ și stă într-un SINGUR loc,
# nemascate.json (citit și de src/intrebariMascare.js), fiecare intrare cu categoria ei; fără furnizori, subcontractori, clienți
# privați sau persoane. Orice adăugare = decizia owner-ului, prin coordonator. Potrivirea e pe numele ÎNTREG (cheie_entitate),
# niciodată pe un cuvânt din el. Fișier lipsă / stricat / intrare invalidă → importul pică (workerul nu pornește — fail closed).
NEMASCATE_FILE = pathlib.Path(__file__).resolve().parent / 'nemascate.json'
CATEGORII_NEMASCATE = ('operator_retea', 'companie_publica', 'institutie_publica', 'societatea_noastra')


def cheie_entitate(nume):
    """Forma canonică a numelui unei firme: cuvintele normalizate, fără forma juridică și fără „societatea comercială”, cu
    inițialele lipite („S.N.T.G.N.” → „sntgn”, „E.ON” rămâne „e on”: o singură literă nu e un șir de inițiale)."""
    toks = _tokeni_firma_lista(nume)
    out, i = [], 0
    while i < len(toks):
        j = i
        while j < len(toks) and len(toks[j]) == 1 and toks[j].isalpha(): j += 1
        if j - i >= 2: out.append(''.join(toks[i:j])); i = j
        else: out.append(toks[i]); i += 1
    return ' '.join(out)


def incarca_nemascate(date):
    """Mulțimea formelor canonice din nemascate.json, validată: fiecare intrare are nume, o categorie din CATEGORII_NEMASCATE și
    forme nevide, deja canonice (cheie_entitate(forma) == forma). Altfel ValueError."""
    if not isinstance(date, dict) or not isinstance(date.get('entitati'), list) or not date['entitati']: raise ValueError('entitati')
    if set(date.get('categorii') or {}) != set(CATEGORII_NEMASCATE): raise ValueError('categorii')
    out = set()
    for e in date['entitati']:
        if not isinstance(e, dict) or set(e) != {'nume', 'categorie', 'forme'}: raise ValueError('intrare')
        if not isinstance(e['nume'], str) or not e['nume'].strip() or e['categorie'] not in CATEGORII_NEMASCATE: raise ValueError('intrare')
        if not isinstance(e['forme'], list) or not e['forme']: raise ValueError('forme')
        for f in e['forme']:
            if not isinstance(f, str) or not f or cheie_entitate(f) != f: raise ValueError(f'forma {f!r}')
            out.add(f)
    return frozenset(out)


class TextMascat(str):
    """Text trecut prin Mascare.mascheaza(). Singurul tip de conținut acceptat de apel() spre furnizor. Orice operație pe el
    (concatenare, felii, format) întoarce un str simplu — deci un text construit DUPĂ mascare nu mai trece garda. Tipul singur nu
    dovedește proveniența (str.__new__(TextMascat, …) ocolește constructorul): garda cere și Mascare.a_produs(x) — același obiect,
    din registrul instanței care a mascat."""
    __slots__ = ()

    def __new__(cls, valoare, sigiliu=None):
        if sigiliu is not _SIGILIU:
            raise TypeError('TextMascat se obține doar din Mascare.mascheaza()')
        return super().__new__(cls, valoare)


_SIGILIU = object()


def _majuscula(t):
    return bool(t) and t[0].isupper()


def _toate_mari(t):
    return t.upper() == t and t.lower() != t


def _titlu_caz(t):
    return _majuscula(t) and any(c.islower() for c in t[1:])


def _desparte(t):
    """Cuvântul fără sufixul legat cu cratimă („Popescu-ului” → „Popescu”); „Ana-Maria” rămâne întreg."""
    i = t.rfind('-')
    return t[:i] if i > 0 and t[i + 1:] in SUFIXE_CRATIMA else t


def _cnp_valid(c):
    s = sum(int(a) * int(b) for a, b in zip(c[:12], '279146358279')) % 11
    return (1 if s == 10 else s) == int(c[12])


def _iban_valid(v):
    if not 15 <= len(v) <= 34: return False
    rest = 0
    for ch in v[4:] + v[:4]:
        val = int(ch) if '0' <= ch <= '9' else ord(ch) - 55
        rest = (rest * (100 if val >= 10 else 10) + val) % 97
    return rest == 1


def _iban_lungime(s):
    """Lungimea (în caractere din text, cu spații) celui mai lung prefix al lui `s` care e un IBAN valid; 0 dacă niciunul. Așa,
    un cuvânt de 3 litere mari lipit după IBAN nu-l face invalid pe tot."""
    compact = [i for i, ch in enumerate(s) if ch != ' ']
    for n in range(len(compact), 14, -1):
        if _iban_valid(''.join(s[i] for i in compact[:n])): return compact[n - 1] + 1
    return 0


def _tokeni_firma_lista(nume):
    """Cuvintele normalizate ale unui nume de firmă din listă, fără „SC” / „SRL” / „S.R.L.” / „societatea comercială”."""
    toks = [(m.start(), norm(m.group(0))) for m in sorted(list(CUVANT.finditer(str(nume or ''))) + list(NUMAR.finditer(str(nume or ''))),
                                                         key=lambda m: m.start())]
    out, i = [], 0
    while i < len(toks):
        t = toks[i][1]
        j = i
        while j < len(toks) and len(toks[j][1]) == 1 and toks[j][1].isalpha(): j += 1   # S.R.L. → s r l
        if j - i >= 2 and ''.join(x[1] for x in toks[i:j]) in FORME_JURIDICE: i = j; continue
        if t in FORME_JURIDICE: i += 1; continue
        if t == 'societatea' and i + 1 < len(toks) and toks[i + 1][1] == 'comerciala': i += 2; continue
        out.append(t); i += 1
    return out


NEMASCATE = incarca_nemascate(json.loads(NEMASCATE_FILE.read_text(encoding='utf-8')))
# cuvintele-entitate dintr-un singur cuvânt („transgaz”, „anre”): după un titlu („directorul Transgaz”) nu sunt nume de persoană
NEMASCATE_UN_CUVANT = frozenset(f for f in NEMASCATE if ' ' not in f)


def _baze_flexionare(n):
    """Formele de bază posibile ale unui genitiv / dativ de prenume feminin (normalizat): „anei” → ana, „mariei” → maria,
    „andreei” → andreea, „olgai” (Olgăi) → olga. Doar candidați: se folosesc numai dacă baza e în dicționar."""
    out = []
    if len(n) >= 4 and n.endswith('ei'): out += [n[:-2] + 'a', n[:-1] + 'a']
    if len(n) >= 4 and n.endswith('ai'): out.append(n[:-1])
    return [c for c in out if len(c) >= 3]


class Dictionar:
    """Numele cunoscute platformei (angajați, persoane de contact, terți), DOAR pentru căutare locală — nu pleacă nicăieri.
    persoane: cuvintele numelor (≥ 3 litere, normalizate; „Ana-Maria” și întreg, și pe bucăți); firme: secvențele de cuvinte ale
    numelor, fără forma juridică, indexate după primul cuvânt; cui: cifrele CUI-urilor cunoscute (6–10 cifre)."""

    def __init__(self, persoane=(), firme=(), cui=()):
        self.persoane = set()
        for nume in persoane:
            for t in CUVANT.findall(str(nume or '')):
                for p in [t] + (t.split('-') if '-' in t else []):
                    n = norm(p)
                    if len(n) >= 3 and n not in OPRIRE: self.persoane.add(n)
        index = {}
        for nume in firme:
            tok = _tokeni_firma_lista(nume)
            if not tok or cheie_entitate(nume) in NEMASCATE: continue
            if len(tok) == 1 and (len(tok[0]) < 4 or tok[0] in COMUNE or tok[0] in GENERICE_FIRMA or tok[0] in OPRIRE or tok[0].isdigit()):
                continue
            index.setdefault(tok[0], set()).add(tuple(tok))
        self.firme = {k: sorted(v, key=lambda x: (-len(x), x)) for k, v in index.items()}
        self.cui = set()
        for c in cui:
            d = re.sub(r'[^0-9]', '', str(c or ''))
            if 6 <= len(d) <= 10: self.cui.add(d)

    def persoana(self, baza):
        """Cheia canonică a unui cuvânt-nume („Mariei” → „maria”, „Anei” → „ana” — r2: și genitivele scurte), sau None dacă nu e
        cunoscut."""
        n = norm(baza)
        if n in self.persoane: return n
        return next((c for c in _baze_flexionare(n) if c in self.persoane), None)

    @staticmethod
    def din_raspuns(r, maxim=200000):   # = NUME_MAX_LISTA din supabase/functions/intrebari-tehnice-worker/logic.js
        """Dictionarul din răspunsul edge-ului („nume”). Formă greșită / gol → ValueError (workerul nu preia nimic — fail closed)."""
        if not isinstance(r, dict): raise ValueError('raspuns')
        liste = {}
        for k in ('persoane', 'firme', 'cui'):
            v = r.get(k)
            if not isinstance(v, list) or len(v) > maxim or not all(isinstance(x, str) for x in v): raise ValueError(k)
            liste[k] = v
        if not liste['persoane']: raise ValueError('persoane goale')   # platforma are mereu angajați: gol = citire eșuată
        return Dictionar(liste['persoane'], liste['firme'], liste['cui'])


class Mascare:
    """Mascarea unei spețe. Etichetele sunt stabile pe toată durata obiectului (titlu, speță, context, surse, reparare)."""

    def __init__(self, dictionar=None):
        self.d = dictionar or Dictionar()
        self.tabel = {}                                 # eticheta → textul original (DOAR în memorie)
        self._ent = {c: [] for c in CATEGORII}          # entitățile pe categorii: {n, cheie, forme: {text: eticheta}}
        self.inlocuiri = 0                              # câte înlocuiri s-au făcut, în total (pentru jurnal)
        self._produse = {}                              # id(TextMascat) → obiectul: proveniența (a_produs), DOAR în memorie
        self._asem_om, self._asem_masina = set(), set() # etichetele ASCUNS puse pe „aproape etichete” din textul omului / al mașinii

    def contoare(self):
        """{categorie: câte valori diferite s-au ascuns} — singurul lucru despre mascare care ajunge în jurnal."""
        return {c: len(v) for c, v in self._ent.items() if v}

    def total(self):
        return sum(len(v) for v in self._ent.values())

    # ── etichete ──
    def _entitate(self, cat, cheie):
        lista = self._ent[cat]
        for x in lista:
            if x['cheie'] == cheie: return x
        if cat == 'PERSOANA':      # „Popescu” și „Ion Popescu”: aceeași persoană dacă potrivirea e unică
            cand = [x for x in lista if x['cheie'] <= cheie or cheie <= x['cheie']]
            if len(cand) == 1:
                cand[0]['cheie'] = cand[0]['cheie'] | cheie
                return cand[0]
        x = {'n': len(lista) + 1, 'cheie': cheie, 'forme': {}}
        lista.append(x)
        return x

    def _eticheta(self, cat, cheie, text):
        x = self._entitate(cat, cheie)
        if text in x['forme']: return x['forme'][text]
        k = len(x['forme']) + 1
        e = f'[{cat}_{x["n"]}]' if k == 1 else f'[{cat}_{x["n"]}_F{k}]'
        x['forme'][text] = e
        self.tabel[e] = text
        return e

    def _emisa(self, e):
        return e in self.tabel

    # ── detectare ──
    def _detecteaza(self, t, protejeaza):
        """[(start, end, categorie, cheie, asemanator)] fără suprapuneri; detectoarele au prioritate în ordinea de mai jos (aceeași
        în JS). `asemanator` = intervalul e o „aproape etichetă” ascunsă (vezi ASEMANATOR)."""
        luate, out = [], []

        def adauga(s, e, cat, cheie, asem=False):
            if s >= e or any(s < b and a < e for a, b in luate): return False
            luate.append((s, e))
            if cat: out.append((s, e, cat, cheie, asem))
            return True

        for m in ASEMANATOR.finditer(t):                # 1. etichetele noastre EXACTE rămân (textul modelului); orice altă formă
            if protejeaza and self._emisa(m.group(0)): adauga(m.start(), m.end(), None, None)   # de etichetă se ascunde
            else: adauga(m.start(), m.end(), 'ASCUNS', m.group(0), True)
        for m in MANUAL.finditer(t): adauga(m.start(), m.end(), 'ASCUNS', m.group(0))       # 2. [[ascuns de om]]
        for m in EMAIL.finditer(t): adauga(m.start(), m.end(), 'EMAIL', m.group(0).lower())  # 3.
        for m in IBAN.finditer(t):                                                            # 4.
            n = _iban_lungime(m.group(0))
            if n: adauga(m.start(), m.start() + n, 'IBAN', m.group(0)[:n].replace(' ', ''))
        for m in CNP.finditer(t):                                                             # 5.
            if _cnp_valid(m.group(0)): adauga(m.start(), m.end(), 'CNP', m.group(0))
        for m in CUI_RO.finditer(t): adauga(m.start(), m.end(), 'CUI', re.sub(r'[^0-9]', '', m.group(0)))   # 6.
        for m in CUI_CUVANT.finditer(t): adauga(m.start('v'), m.end('v'), 'CUI', re.sub(r'[^0-9]', '', m.group('v')))
        for m in TELEFON.finditer(t):                                                         # 7.
            adauga(m.start(), m.end(), 'TELEFON', '0' + re.sub(r'[^0-9]', '', m.group(0))[-9:])
        for m in CUI_LISTA.finditer(t):                                                       # 8. CUI cunoscut, fără prefix
            if m.group(0) in self.d.cui: adauga(m.start(), m.end(), 'CUI', m.group(0))
        for m in NR_AUTO.finditer(t):                                                         # 9.
            if m.group(1) not in NR_AUTO_EXCLUSE: adauga(m.start(), m.end(), 'NR_AUTO', re.sub(r'[ \t\-]', '', m.group(0)))

        cuv = [(m.start(), m.end(), m.group(0)) for m in CUVANT.finditer(t)]
        atomi = sorted(cuv + [(m.start(), m.end(), m.group(0)) for m in NUMAR.finditer(t)])
        self._firme_forma(t, atomi, adauga)                                                   # 10.
        self._firme_lista(t, atomi, adauga)                                                   # 11.
        self._persoane_titlu(t, cuv, adauga)                                                  # 12.
        self._persoane_lista(t, cuv, adauga)                                                  # 13.
        return sorted(out, key=lambda x: x[0])

    def _firme_forma(self, t, atomi, adauga):
        """„[SC] Nume Firmă SRL” / „„Nume” S.A.” / „Popescu Ion PFA”: până la 6 cuvinte cu majusculă (sau cifre) înaintea formei."""
        capete = [a[1] for a in atomi]
        for m in FORMA.finditer(t):
            j = _ultimul_inainte(capete, m.start())
            if j < 0 or not GAP_FORMA.fullmatch(t, atomi[j][1], m.start()): continue
            nume, k, prefix = [], j, None
            while k >= 0 and len(nume) < 6:
                s, e, tok = atomi[k]
                n = norm(tok)
                if n == 'sc': prefix = s; break
                if not (tok[0].isdigit() or _majuscula(tok)) or n in OPRIRE: break
                nume.insert(0, atomi[k])
                if k == 0 or not GAP_NUME.fullmatch(t, atomi[k - 1][1], s): break
                k -= 1
            cuvinte = [a for a in nume if not a[2][0].isdigit()]
            if not cuvinte: continue
            if m.group(1).startswith('I') and (len(nume) < 2 or len(cuvinte) != len(nume)): continue   # II / IF: Nume Prenume II
            cheie = ' '.join(norm(a[2]) for a in nume)
            if cheie_entitate(' '.join(a[2] for a in nume)) in NEMASCATE: continue   # numele ÎNTREG, nu un cuvânt din el
            start = prefix if prefix is not None else nume[0][0]
            if prefix is None:
                p = PREFIX_FIRMA.search(t[max(0, start - 12):start])
                if p: start -= len(p.group(0))
            adauga(start, m.end(), 'FIRMA', cheie)

    def _firme_lista(self, t, atomi, adauga):
        """Firmele din lista platformei, scrise cu majusculă, cu / fără „SC” în față și forma juridică după."""
        for i, (s, e, tok) in enumerate(atomi):
            if not _majuscula(tok): continue
            for tup in self.d.firme.get(norm(_desparte(tok)), ()):
                k, ok = i, True
                for idx in range(1, len(tup)):
                    if k + 1 >= len(atomi) or not GAP_NUME.fullmatch(t, atomi[k][1], atomi[k + 1][0]): ok = False; break
                    urm = atomi[k + 1][2]
                    if norm(_desparte(urm)) != tup[idx] or not (urm[0].isdigit() or _majuscula(urm)): ok = False; break
                    k += 1
                if not ok: continue
                start, end = s, atomi[k][0] + len(_desparte(atomi[k][2]))
                if i > 0 and norm(atomi[i - 1][2]) == 'sc' and SPATIU.fullmatch(t, atomi[i - 1][1], s): start = atomi[i - 1][0]
                else:
                    p = PREFIX_FIRMA.search(t[max(0, start - 12):start])
                    if p: start -= len(p.group(0))
                f = FORMA_DUPA.match(t, end) if end == atomi[k][1] else None
                if f: end = f.end()
                adauga(start, end, 'FIRMA', ' '.join(tup))
                break

    def _persoane_titlu(self, t, cuv, adauga):
        """După „dl.”, „ing.”, „colegul” …: 1–3 cuvinte cu majusculă (necunoscute platformei — tipar)."""
        dupa_start = {c[0]: i for i, c in enumerate(cuv)}
        for m in TITLU.finditer(t):
            i, luat = dupa_start.get(m.end()), []
            while i is not None and i < len(cuv) and len(luat) < 3:
                s, e, tok = cuv[i]
                baza = _desparte(tok)
                n, k = norm(baza), self.d.persoana(baza)
                # r2 (review P1-1): după un titlu, un cuvânt din COMUNE se ascunde și el („dl. Ion”, „ing. Mare”) — titlul e
                # contextul care lipsește când cuvântul e singur; entitățile publice dintr-un cuvânt nu sunt persoane
                if not (_majuscula(baza) and n not in OPRIRE and n not in NEMASCATE_UN_CUVANT
                        and (_titlu_caz(baza) or k is not None or (_toate_mari(baza) and len(baza) >= 6))): break
                luat.append((s, s + len(baza), k or n))
                if baza != tok or i + 1 >= len(cuv) or not SPATIU.fullmatch(t, e, cuv[i + 1][0]): break
                i += 1
            if luat: adauga(luat[0][0], luat[-1][1], 'PERSOANA', frozenset(x[2] for x in luat))

    def _persoane_lista(self, t, cuv, adauga):
        """Cuvintele cunoscute platformei, cu majusculă: un șir de până la 4 (cu cel mult un cuvânt necunoscut ÎNTRE două
        cunoscute — al doilea prenume); un cuvânt singur din COMUNE nu se ascunde."""
        info = []
        for s, e, tok in cuv:
            baza = _desparte(tok)
            info.append({'s': s, 'e': e, 'eb': s + len(baza), 'baza': baza, 'sufix': baza != tok,
                         'k': self.d.persoana(baza) if _majuscula(baza) else None})
        lipit = lambda a, b: SPATIU.fullmatch(t, info[a]['e'], info[b]['s']) is not None
        i, n = 0, len(info)
        while i < n:
            if info[i]['k'] is None: i += 1; continue
            j, chei = i, [info[i]['k']]
            while j - i < 3 and not info[j]['sufix']:
                if j + 1 < n and lipit(j, j + 1) and info[j + 1]['k']:
                    j += 1; chei.append(info[j]['k']); continue
                if (j + 2 < n and j + 2 - i <= 3 and lipit(j, j + 1) and lipit(j + 1, j + 2) and info[j + 1]['k'] is None
                        and not info[j + 1]['sufix'] and _titlu_caz(info[j + 1]['baza']) and info[j + 2]['k']
                        and norm(info[j + 1]['baza']) not in OPRIRE and norm(info[j + 1]['baza']) not in COMUNE):
                    chei += [norm(info[j + 1]['baza']), info[j + 2]['k']]; j += 2; continue
                break
            if not (j == i and chei[0] in COMUNE):
                adauga(info[i]['s'], info[j]['eb'], 'PERSOANA', frozenset(chei))
            i = j + 1

    # ── API ──
    def mascheaza(self, text, protejeaza=True):
        """Textul cu numele / datele înlocuite de etichete, ca TextMascat. `protejeaza=False` la textele scrise de om (titlu,
        speță, context): acolo o etichetă scrisă de mână se ascunde și ea (dus-întorsul rămâne exact)."""
        t = str(text or '')
        out, poz = [], 0
        for s, e, cat, cheie, asem in self._detecteaza(t, protejeaza):
            out.append(t[poz:s])
            et = self._eticheta(cat, cheie, t[s:e])
            if asem: (self._asem_masina if protejeaza else self._asem_om).add(et)
            out.append(et)
            poz = e
            self.inlocuiri += 1
        out.append(t[poz:])
        x = TextMascat(''.join(out), _SIGILIU)
        self._produse[id(x)] = x                    # obiectul rămâne viu cât trăiește mascarea → id-ul nu se refolosește
        return x

    def a_produs(self, x):
        """True DOAR pentru un TextMascat produs de ACEASTĂ instanță (același obiect). Un TextMascat făcut cu str.__new__ sau
        produs de mascarea altei spețe → False (garda din intrebari_worker.py refuză)."""
        return type(x) is TextMascat and self._produse.get(id(x)) is x

    def demascheaza(self, text):
        """Etichetele EMISE, scrise exact, puse la loc. Orice altceva (etichetă necunoscută, litere mici, formă inventată
        „[PERSOANA_1_F9]”) rămâne cum e — nu se repară nimic. Pentru publicare se folosește demascheaza_sigur()."""
        return ETICHETA.sub(lambda m: self.tabel.get(m.group(0), m.group(0)), str(text or ''))

    def demascheaza_sigur(self, text):
        """(afișat, None) sau (None, motiv) — pasul dinaintea publicării (review r2 P1-4). Refuz dacă în textul modelului rămâne
        ORICE secvență de forma unei etichete (ASEMANATOR) care nu e EXACT o etichetă emisă ('eticheta_neemisa': „[PERSOANA_999]”,
        „[persoana_1]”, „[PERSOANA_1_F9]”, „PERSOANA_1”), sau o etichetă emisă pentru o „aproape etichetă” venită din textul
        modelului / al surselor, nu al omului ('eticheta_din_model'). Ce a scris OMUL de forma unei etichete a fost ascuns la
        mascare ([ASCUNS_n]) și se pune la loc exact — rămâne al lui."""
        t = str(text or '')
        for m in ASEMANATOR.finditer(t):
            e = m.group(0)
            if not self._emisa(e): return None, 'eticheta_neemisa'
            if e in self._asem_masina and e not in self._asem_om: return None, 'eticheta_din_model'
        return self.demascheaza(t), None

    def emise_in(self, text):
        """Câte etichete EMISE de această mascare apar în text."""
        return sum(1 for m in ETICHETA.finditer(str(text or '')) if self._emisa(m.group(0)))


def _ultimul_inainte(capete, poz):
    """Indicele ultimului atom care se termină la sau înainte de `poz` (capete sortate crescător), sau -1."""
    lo, hi = 0, len(capete)
    while lo < hi:
        mid = (lo + hi) // 2
        if capete[mid] <= poz: lo = mid + 1
        else: hi = mid
    return lo - 1
