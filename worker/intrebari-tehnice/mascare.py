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

r3 (review PR #1086 r2) — fiecare clasă închisă printr-o REGULĂ, nu prin încă o listă de cazuri:
- persoane: potrivirea pe TULPINĂ (_componenta: componenta din dicționar + o terminație flexionară din mulțimea închisă TERMINATII);
- firme: potrivirea pe șirul de cuvinte NORMALIZAT al numelui din dicționar, în orice scriere (majuscule, punctuația dintre cuvinte),
  cu forma juridică lipită; intrările fără valoare de identificare se aruncă la încărcare (Dictionar.aruncate, în jurnalul de pornire);
- un nume recunoscut o dată se ascunde peste tot în aceeași speță (_propaga, cu pre-trecerea invata() peste titlu / speță / context);
- localitățile rămân vizibile (decizia owner-ului): după un marcaj („comuna”, „satul”, „jud.” …) și, fără titlu și fără alt nume
  lângă, când cuvântul e o localitate cunoscută platformei (Dictionar.localitati — denumirile UAT din red_uat, prin edge);
- demascarea: pe lângă detectorul strict, un detector LARG (_larg) pe textul fără spații albe / caractere invizibile, cu majuscule:
  orice prefix de etichetă urmat de cifre care nu e exact o etichetă emisă oprește publicarea („[PERSOANA_\\n999]”, NBSP în ea).

Ce NU prinde (limite asumate, spuse și în ecran și în docs/intrebari/MASCARE_SI_VERDICT.md):
- nume necunoscute platformei scrise fără titlu în față și fără formă juridică; porecle, inițiale („I. P.”), nume scrise cu
  literă mică; un prenume din dicționar care e și cuvânt obișnuit („Ion”, „Mare”) scris SINGUR, fără titlu, fără alt nume lângă
  și fără ca numele întreg să fi apărut în aceeași speță; forme flexionate neregulate („Popeștii”) și componentele de 3 litere cu
  alte terminații decât genitivul feminin („Danului”);
- firme scrise fără formă juridică și care nu sunt în lista platformei; entitățile publice din nemascate.json rămân intenționat;
- localități (rămân vizibile — decizia owner-ului; un nume de familie care e și localitate cunoscută, scris singur, rămâne
  vizibil chiar dacă persoana a fost numită în speță), adrese, numere de contract / CF / cadastru, CUI scris fără „RO” / „CUI” și
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
# r3: cuvintele unui nume de firmă se compară fără cratimă („Gamma-Feronerie” = „Gamma Feronerie”); între ele, orice punctuație /
# spațiu alb, 1–6 caractere („Gamma, Feronerie”, „GAMMA\nFERONERIE”) — dar nicio literă sau cifră
CUVANT_SIMPLU = re.compile(rf'(?<!{_L}){_L}+(?!{_L})')
GAP_FIRMA = re.compile(rf'(?:(?!{_W}).){{1,6}}', re.S)
GAP_PUBLIC = re.compile(rf'(?:(?!{_W})[^\n]){{1,3}}')                 # între cuvintele unei entități publice („S.N.T.G.N. ”, „E.ON”)
GAP_MARCAJ = re.compile(rf'\.?{_SP}+')                                 # „comuna Berceni”, „jud. Prahova”
# r3 (review P1-5): detectorul LARG de etichete, pe textul fără spații albe / invizibile, cu majuscule și fără diacritice (_larg)
_LINIUTE_LARG = ''.join(map(chr, range(0x2010, 0x2016))) + chr(0x2212)  # ‐ ‑ ‒ – — ― −
LARG = re.compile(r'(?:PERSOANA|FIRMA|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[_.-]?AUTO|ASCUNS)[_#.:()\[\]' + _LINIUTE_LARG + r'-]*[0-9]+')
_INVIZIBILE = ('Zs', 'Zl', 'Zp', 'Cc', 'Cf')                          # spații, rânduri noi, NBSP, caractere de lățime zero, BOM


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
# r3 (L20): cuvintele fără valoare de identificare din coloanele scrise liber („diverse”, „persoana fizica”, „furnizor”, „client”):
# o intrare din dicționar făcută DOAR din ele (și din OPRIRE) se aruncă la încărcare și se numără (Dictionar.aruncate).
FARA_VALOARE = frozenset('''diverse divers diversi diversa persoana persoane fizica fizice juridica juridice furnizor furnizori client
clienti necunoscut necunoscuta necunoscuti nespecificat nespecificata altul alta alte altii altele fara nume test teste exista lipsa
niciunul niciuna nimeni toti oricare generic'''.split())
# r3: terminațiile flexionare ale unei componente de nume (normalizate) — mulțime ÎNCHISĂ, cel mult 4 litere (vezi _componenta):
# articol -ul / -le; genitiv-dativ -ului / -lui / -ei / -ii / -i; vocativ -ule / -e; plural -i / -ii / -lor / -ilor.
TERMINATII = ('ului', 'ilor', 'ule', 'lui', 'lor', 'ul', 'le', 'ei', 'ii', 'e', 'i')
COMPONENTA_MIN_TULPINA = 4
# r3 (review P2-5, decizia owner-ului: localitățile rămân vizibile): cuvântul de după unul dintre aceste marcaje e o localitate;
# abrevierile cer punctul („jud. Prahova”).
MARCAJE_LOCALITATE = frozenset('''comuna comunei comunele com satul satului satele sat orasul orasului oras municipiul municipiului
mun localitatea localitatii loc judetul judetului jud uat'''.split())
MARCAJE_ABREVIERI = frozenset(('com', 'mun', 'loc', 'jud'))
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
    return t[:i] if i > 0 and t[i + 1:].lower() in SUFIXE_CRATIMA else t


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
    toks = [(m.start(), norm(m.group(0))) for m in sorted(list(CUVANT_SIMPLU.finditer(str(nume or ''))) + list(NUMAR.finditer(str(nume or ''))),
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


# r3: „cuvânt comun” pentru o firmă dintr-un SINGUR cuvânt = cuvintele generice de mai sus + termenii tehnici din vocabular_web.json
# (aceeași listă din care se compun interogările web; citită și de src/intrebariMascare.js). O asemenea intrare se aruncă: căutată
# în orice scriere, ar ascunde cuvinte obișnuite din text („Profil”, „Gaz”).
VOCABULAR_FILE = pathlib.Path(__file__).resolve().parent / 'vocabular_web.json'
VOCABULAR_COMUN = frozenset(norm(c) for t in json.loads(VOCABULAR_FILE.read_text(encoding='utf-8'))['termeni'] for c in str(t).split())
COMUN_FIRMA = COMUNE | GENERICE_FIRMA | OPRIRE | FARA_VALOARE | VOCABULAR_COMUN
PRIMELE_PUBLICE = frozenset(x for f in NEMASCATE for x in (f.split(' ')[0], f[0]))


def _componenta(n, multime):
    """Componenta de nume din `multime` (normalizată) a cuvântului normalizat `n` — regula TULPINII (r3, review P1-1):
    - `n` însuși („popescu”);
    - genitivul feminin: tulpina fără „a” + -ei / -ăi („anei” → ana, „mariei” → maria, „olgai” → olga) și -i după „ea” („andreei” →
      andreea) — singura formă recunoscută și la componentele de 3 litere;
    - tulpina (≥ COMPONENTA_MIN_TULPINA litere, din `multime`) + O terminație din TERMINATII („popescului”, „popescule”, „stanului”).
    Componentele de 3 litere („ion”, „dan”) nu primesc terminații: ar lovi cuvinte comune („Ani”, „Dane”). None dacă nu e un nume."""
    if n in multime: return n
    if len(n) >= 4 and (n.endswith('ei') or n.endswith('ai')) and n[:-2] + 'a' in multime: return n[:-2] + 'a'
    if len(n) >= 5 and n.endswith('ei') and n[:-1] + 'a' in multime: return n[:-1] + 'a'
    for t in TERMINATII:
        b = n[:-len(t)]
        if n.endswith(t) and len(b) >= COMPONENTA_MIN_TULPINA and b in multime: return b
    return None


def _componenta_cuvant(n, multime):
    """_componenta pe cuvântul întreg; r3: la un cuvânt cu cratimă („ionescu-popescu”, „maria-ioana”), dacă întregul nu e un nume,
    prima parte care este — o parte cunoscută ascunde tot cuvântul compus."""
    c = _componenta(n, multime)
    if c is None and '-' in n:
        c = next((x for x in (_componenta(p, multime) for p in n.split('-') if p) if x is not None), None)
    return c


def _firma_fara_valoare(tok):
    """r3 (L20): intrarea de firmă nu identifică pe nimeni — fără cuvinte, doar cuvinte FARA_VALOARE / OPRIRE („persoana fizica”,
    „diverse”, „furnizor necunoscut”), sau UN singur cuvânt comun (COMUN_FIRMA, < 4 litere, doar cifre)."""
    if not tok or all(t in FARA_VALOARE or t in OPRIRE for t in tok): return True
    return len(tok) == 1 and (len(tok[0]) < 4 or tok[0].isdigit() or tok[0] in COMUN_FIRMA)


class Dictionar:
    """Numele cunoscute platformei (angajați, persoane de contact, terți), DOAR pentru căutare locală — nu pleacă nicăieri.
    persoane: cuvintele numelor (≥ 3 litere, normalizate; „Ana-Maria” și întreg, și pe bucăți); firme: secvențele de cuvinte ale
    numelor, fără forma juridică, indexate după primul cuvânt; cui: cifrele CUI-urilor cunoscute (6–10 cifre)."""

    def __init__(self, persoane=(), firme=(), cui=(), localitati=()):
        # r3 (L20): ce s-a aruncat la încărcare, doar numere — merge în jurnalul de pornire (statistici)
        self.aruncate = {'persoane': 0, 'firme': 0, 'firme_publice': 0}
        # r3: localitățile cunoscute platformei (cuvintele lor, normalizate) — rămân vizibile când apar singure (vezi _persoane_lista)
        self.localitati = set()
        for v in localitati:
            for t in CUVANT.findall(str(v or '')):
                for p in [t] + (t.split('-') if '-' in t else []):
                    n = norm(p)
                    if len(n) >= 3 and n not in OPRIRE and n not in MARCAJE_LOCALITATE: self.localitati.add(n)
        self.persoane = set()
        for nume in persoane:
            comp = set()
            for t in CUVANT.findall(str(nume or '')):
                for p in [t] + (t.split('-') if '-' in t else []):
                    n = norm(p)
                    if len(n) >= 3 and n not in OPRIRE and n not in FARA_VALOARE: comp.add(n)
            if comp: self.persoane |= comp
            else: self.aruncate['persoane'] += 1
        index = {}
        for nume in firme:
            tok = _tokeni_firma_lista(nume)
            if tok and cheie_entitate(nume) in NEMASCATE:
                self.aruncate['firme_publice'] += 1; continue
            if _firma_fara_valoare(tok) or (len(tok) == 1 and tok[0] in self.localitati):
                self.aruncate['firme'] += 1; continue
            index.setdefault(tok[0], set()).add(tuple(tok))
        self.firme = {k: sorted(v, key=lambda x: (-len(x), x)) for k, v in index.items()}
        self.cui = set()
        for c in cui:
            d = re.sub(r'[^0-9]', '', str(c or ''))
            if 6 <= len(d) <= 10: self.cui.add(d)

    def persoana(self, baza):
        """Componenta din dicționar a unui cuvânt-nume, după regula tulpinii (_componenta: „Popescului” → „popescu”, „Mariei” →
        „maria”, „Anei” → „ana”), sau None dacă nu e cunoscut."""
        return _componenta_cuvant(norm(baza), self.persoane)

    def statistici(self):
        """Doar numere, pentru jurnalul de pornire (r3): câte componente / firme / CUI / localități și câte intrări s-au aruncat."""
        return {'persoane': len(self.persoane), 'firme': sum(len(v) for v in self.firme.values()), 'cui': len(self.cui),
                'localitati': len(self.localitati), 'aruncate': dict(self.aruncate)}

    @staticmethod
    def din_raspuns(r, maxim=200000):   # = NUME_MAX_LISTA din supabase/functions/intrebari-tehnice-worker/logic.js
        """Dictionarul din răspunsul edge-ului („nume”). Formă greșită / gol → ValueError (workerul nu preia nimic — fail closed).
        r3: „localitati” e opțională (lipsă = listă goală: mai multe cuvinte ascunse, direcția prudentă), dar dacă vine, e validată."""
        if not isinstance(r, dict): raise ValueError('raspuns')
        liste = {}
        for k in ('persoane', 'firme', 'cui', 'localitati'):
            v = r.get(k, []) if k == 'localitati' else r.get(k)
            if not isinstance(v, list) or len(v) > maxim or not all(isinstance(x, str) for x in v): raise ValueError(k)
            liste[k] = v
        if not liste['persoane']: raise ValueError('persoane goale')   # platforma are mereu angajați: gol = citire eșuată
        return Dictionar(liste['persoane'], liste['firme'], liste['cui'], liste['localitati'])


class Mascare:
    """Mascarea unei spețe. Etichetele sunt stabile pe toată durata obiectului (titlu, speță, context, surse, reparare)."""

    def __init__(self, dictionar=None):
        self.d = dictionar or Dictionar()
        self.tabel = {}                                 # eticheta → textul original (DOAR în memorie)
        self._ent = {c: [] for c in CATEGORII}          # entitățile pe categorii: {n, cheie, forme: {text: eticheta}}
        self.inlocuiri = 0                              # câte înlocuiri s-au făcut, în total (pentru jurnal)
        self._produse = {}                              # id(TextMascat) → obiectul: proveniența (a_produs), DOAR în memorie
        self._asem_om, self._asem_masina = set(), set() # etichetele ASCUNS puse pe „aproape etichete” din textul omului / al mașinii
        self._vazute = {}                               # r3: componentă recunoscută în speță → (categorie, cheie), DOAR în memorie

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

        def ocupat(s, e):
            return any(s < b and a < e for a, b in luate)

        def adauga(s, e, cat, cheie, asem=False):
            if s >= e or ocupat(s, e): return False
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
        for a, b in _larg(t):                    # 9b. r3: formă LARGĂ de etichetă (rânduri noi / NBSP / invizibile în ea, „persoana 1”)
            if a > 0 and t[a - 1] == '[': a -= 1
            if b < len(t) and t[b] == ']': b += 1
            adauga(a, b, 'ASCUNS', t[a:b], True)

        cuv = [(m.start(), m.end(), m.group(0)) for m in CUVANT.finditer(t)]
        atomi = sorted(cuv + [(m.start(), m.end(), m.group(0)) for m in NUMAR.finditer(t)])
        simpli = sorted([(m.start(), m.end(), m.group(0)) for m in CUVANT_SIMPLU.finditer(t)]
                        + [(m.start(), m.end(), m.group(0)) for m in NUMAR.finditer(t)])
        self._localitati_marcate(t, cuv, adauga)                                              # 9c. r3: „comuna Berceni” rămâne
        self._firme_forma(t, atomi, adauga)                                                   # 10.
        self._firme_lista(t, simpli, adauga)                                                  # 11. r3: în orice scriere
        self._publice(t, simpli, adauga)                                                      # 11b. r3: entitățile publice rămân
        self._persoane_titlu(t, cuv, adauga, ocupat)                                          # 12.
        self._persoane_lista(t, cuv, adauga, ocupat)                                          # 13.
        self._invata_din(sorted(out, key=lambda x: x[0]))
        self._propaga(t, cuv, adauga)                                                         # 14. r3: același nume, în toată speța
        return sorted(out, key=lambda x: x[0])

    def _localitati_marcate(self, t, cuv, adauga):
        """r3 (decizia owner-ului: localitățile rămân vizibile): cuvântul de după un marcaj de localitate („comuna”, „satul”, „jud.”,
        „UAT” … — MARCAJE_LOCALITATE; abrevierile cu punct) e rezervat ca localitate, plus cel mult două cuvinte cu majusculă lipite
        de el care NU sunt nume din dicționar („comuna Valea Călugărească”; „comuna Berceni Ion Popescu” → doar „Berceni”)."""
        for i in range(len(cuv) - 1):
            n = norm(cuv[i][2])
            if n not in MARCAJE_LOCALITATE: continue
            gap = t[cuv[i][1]:cuv[i + 1][0]]
            if not GAP_MARCAJ.fullmatch(gap) or (n in MARCAJE_ABREVIERI and not gap.startswith('.')): continue
            j = i + 1
            adauga(cuv[j][0], cuv[j][1], None, None)
            while j + 1 < len(cuv) and j - i < 3 and SPATIU.fullmatch(t, cuv[j][1], cuv[j + 1][0]):
                urm = cuv[j + 1][2]
                if not _majuscula(urm) or norm(urm) in OPRIRE or self.d.persoana(_desparte(urm)) is not None: break
                j += 1
                adauga(cuv[j][0], cuv[j][1], None, None)

    def _publice(self, t, simpli, adauga):
        """r3: aparițiile entităților publice din nemascate.json (numele ÎNTREG, cu forma juridică lipită) se rezervă după firmele
        din dicționar, ca nimic de după (persoane, propagarea) să nu rupă „Delgaz Grid” sau „Apa Nova” în bucăți."""
        for i in range(len(simpli)):
            if norm(simpli[i][2]) not in PRIMELE_PUBLICE: continue
            gasit = None
            for j in range(i, min(len(simpli), i + 8)):
                if j > i and not GAP_PUBLIC.fullmatch(t, simpli[j - 1][1], simpli[j][0]): break
                if cheie_entitate(t[simpli[i][0]:simpli[j][1]]) in NEMASCATE: gasit = j
            if gasit is not None:
                e = simpli[gasit][1]
                f = FORMA_DUPA.match(t, e)
                adauga(simpli[i][0], f.end() if f else e, None, None)

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
        """Firmele din lista platformei — r3 (review P1-1): potrivirea pe ȘIRUL de cuvinte normalizat al numelui (fără deosebire de
        majuscule, fără diacritice, cu orice punctuație / spațiu alb între cuvinte — GAP_FIRMA; `atomi` sunt cuvinte fără cratimă),
        cu / fără „SC” în față și cu forma juridică lipită după: „Engie servicii SRL”, „Gamma, Feronerie”, „GAMMA-FERONERIE”."""
        for i, (s, e, tok) in enumerate(atomi):
            for tup in self.d.firme.get(norm(tok), ()):
                k, ok = i, True
                for idx in range(1, len(tup)):
                    if k + 1 >= len(atomi) or not GAP_FIRMA.fullmatch(t, atomi[k][1], atomi[k + 1][0]): ok = False; break
                    if norm(atomi[k + 1][2]) != tup[idx]: ok = False; break
                    k += 1
                if not ok: continue
                start, end = s, atomi[k][1]
                if i > 0 and norm(atomi[i - 1][2]) == 'sc' and SPATIU.fullmatch(t, atomi[i - 1][1], s): start = atomi[i - 1][0]
                else:
                    p = PREFIX_FIRMA.search(t[max(0, start - 12):start])
                    if p: start -= len(p.group(0))
                f = FORMA_DUPA.match(t, end)
                if f: end = f.end()
                adauga(start, end, 'FIRMA', ' '.join(tup))
                break

    def _persoane_titlu(self, t, cuv, adauga, ocupat):
        """După „dl.”, „ing.”, „colegul” …: 1–3 cuvinte cu majusculă (necunoscute platformei — tipar). r3: șirul se oprește
        înaintea unui cuvânt deja rezervat (firmă, localitate, entitate publică), ca restul să nu fie respins întreg."""
        dupa_start = {c[0]: i for i, c in enumerate(cuv)}
        for m in TITLU.finditer(t):
            i, luat = dupa_start.get(m.end()), []
            while i is not None and i < len(cuv) and len(luat) < 3:
                s, e, tok = cuv[i]
                baza = _desparte(tok)
                if ocupat(s, s + len(baza)): break
                n, k = norm(baza), self.d.persoana(baza)
                # r2 (review P1-1): după un titlu, un cuvânt din COMUNE se ascunde și el („dl. Ion”, „ing. Mare”) — titlul e
                # contextul care lipsește când cuvântul e singur; entitățile publice dintr-un cuvânt nu sunt persoane
                if not (_majuscula(baza) and n not in OPRIRE and n not in NEMASCATE_UN_CUVANT
                        and (_titlu_caz(baza) or k is not None or (_toate_mari(baza) and len(baza) >= 6))): break
                luat.append((s, s + len(baza), k or n))
                if baza != tok or i + 1 >= len(cuv) or not SPATIU.fullmatch(t, e, cuv[i + 1][0]): break
                i += 1
            if luat: adauga(luat[0][0], luat[-1][1], 'PERSOANA', frozenset(x[2] for x in luat))

    def _persoane_lista(self, t, cuv, adauga, ocupat):
        """Cuvintele cunoscute platformei, cu majusculă: un șir de până la 4 (cu cel mult un cuvânt necunoscut ÎNTRE două
        cunoscute — al doilea prenume); un cuvânt singur din COMUNE nu se ascunde. r3: un cuvânt deja rezervat („comuna Berceni”)
        nu intră în șir — „comuna Berceni Ana Popescu” ascunde „Ana Popescu”, nu respinge tot șirul."""
        info = []
        for s, e, tok in cuv:
            baza = _desparte(tok)
            liber = not ocupat(s, s + len(baza))
            info.append({'s': s, 'e': e, 'eb': s + len(baza), 'baza': baza, 'sufix': baza != tok or not liber,
                         'k': self.d.persoana(baza) if _majuscula(baza) and liber else None})
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
            # un cuvânt SINGUR (fără titlu — titlul a fost tratat la 12 — și fără alt nume din dicționar lipit de el) rămâne dacă e
            # cuvânt comun (COMUNE) sau, r3, o localitate cunoscută platformei: conflictul nume de familie = localitate se rezolvă
            # „cu titlu sau cu prenume lângă = persoană, altfel = localitate” (decizia owner-ului)
            singur_vizibil = j == i and (chei[0] in COMUNE or chei[0] in self.d.localitati
                                         or norm(info[i]['baza']) in self.d.localitati)
            if not singur_vizibil:
                adauga(info[i]['s'], info[j]['eb'], 'PERSOANA', frozenset(chei))
            i = j + 1

    def _invata_din(self, gasite):
        """r3 (review P2-4): componentele numelor recunoscute (persoane și firme) devin „văzute” pentru restul spețe. Nu se învață:
        sub 3 litere, OPRIRE, cuvinte generice de firmă (GENERICE_FIRMA, forme juridice, cifre) și cuvintele-entitate publice
        („transgaz” din „Transgaz Construct SRL”). O componentă din două nume diferite primește cheia doar a ei (eticheta nu mai
        alege între ele; cuvântul se ascunde oricum)."""
        for s, e, cat, cheie, asem in gasite:
            if cat == 'PERSOANA': comp = sorted(cheie)
            elif cat == 'FIRMA': comp = [x for x in cheie.split(' ') if not x.isdigit() and x not in GENERICE_FIRMA and x not in FORME_JURIDICE]
            else: continue
            for c in comp:
                if len(c) < 3 or c in OPRIRE or c in NEMASCATE_UN_CUVANT: continue
                v = (cat, cheie)
                if c not in self._vazute: self._vazute[c] = v
                elif self._vazute[c] != v:
                    cat0 = self._vazute[c][0]
                    self._vazute[c] = (cat0, frozenset((c,)) if cat0 == 'PERSOANA' else c)

    def _propaga(self, t, cuv, adauga):
        """r3 (review P2-4): „Ion Mare răspunde. Ion cere avizul.” — orice cuvânt cu majusculă care, după regula tulpinii, e o
        componentă deja văzută în speță se ascunde, cu cheia numelui întreg (aceeași etichetă), chiar dacă singur ar fi cuvânt comun.
        Excepție: o localitate cunoscută platformei (decizia owner-ului). Cuvintele scrise cu literă mică NU se propagă."""
        if not self._vazute: return
        for s, e, tok in cuv:
            baza = _desparte(tok)
            if not _majuscula(baza): continue
            n = norm(baza)
            if n in self.d.localitati: continue
            c = _componenta_cuvant(n, self._vazute)
            if c is not None and c not in self.d.localitati:
                cat, cheie = self._vazute[c]
                adauga(s, s + len(baza), cat, cheie)

    # ── API ──
    def invata(self, *texte):
        """r3: pre-trecerea peste textele omului (titlu, speță, context) ÎNAINTE de mascarea lor: numele recunoscute într-unul se
        ascund și în celelalte, inclusiv în cele mascate înaintea lui. Nu emite etichete (numerotarea rămâne cea a mascării)."""
        for t in texte: self._detecteaza(_fara_format(str(t or ''))[0], False)

    def mascheaza(self, text, protejeaza=True):
        """Textul cu numele / datele înlocuite de etichete, ca TextMascat. `protejeaza=False` la textele scrise de om (titlu,
        speță, context): acolo o etichetă scrisă de mână se ascunde și ea (dus-întorsul rămâne exact)."""
        t = str(text or '')
        curat, idx = _fara_format(t)
        out, poz = [], 0
        for s, e, cat, cheie, asem in self._detecteaza(curat, protejeaza):
            if idx is not None: s, e = idx[s], idx[e - 1] + 1
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
        mascare ([ASCUNS_n]) și se pune la loc exact — rămâne al lui.
        r3 (review P1-5): apoi detectorul LARG (_larg) — orice prefix de etichetă urmat de cifre, căutat pe textul fără spații albe /
        invizibile, trebuie să fie începutul UNEI etichete emise, scrise exact, în acel loc; altfel 'eticheta_rupta' („[PERSOANA_\\n999]”,
        NBSP sau caracter de lățime zero în etichetă, „persoana 2” scris de model)."""
        t = str(text or '')
        for m in ASEMANATOR.finditer(t):
            e = m.group(0)
            if not self._emisa(e): return None, 'eticheta_neemisa'
            if e in self._asem_masina and e not in self._asem_om: return None, 'eticheta_din_model'
        exacte = {m.start() + 1: m.end() for m in ETICHETA.finditer(t) if self._emisa(m.group(0))}
        for a, b in _larg(t):
            if exacte.get(a, -1) < b: return None, 'eticheta_rupta'
        return self.demascheaza(t), None

    def emise_in(self, text):
        """Câte etichete EMISE de această mascare apar în text."""
        return sum(1 for m in ETICHETA.finditer(str(text or '')) if self._emisa(m.group(0)))


def _litera(ch):
    return unicodedata.category(ch)[0] in 'LM'


def _fara_format(t):
    """r3: (textul fără caracterele de FORMAT — categoria Cf: lățime zero, cratimă moale din PDF-uri copiate, BOM, marcaje de
    direcție —, pozițiile caracterelor rămase în textul original + lungimea lui) sau (t, None) dacă nu are. Detecția rulează pe
    textul curat („Pope\\u200bscu” = „Popescu”, un CNP cu un caracter invizibil în el), iar intervalele se mapează înapoi pe
    original: ce se înlocuiește e bucata ORIGINALĂ, deci dus-întorsul rămâne exact."""
    if not any(unicodedata.category(c) == 'Cf' for c in t): return t, None
    idx = [i for i, c in enumerate(t) if unicodedata.category(c) != 'Cf']
    return ''.join(t[i] for i in idx), idx


def _larg(t):
    """r3 (review P1-5): [(start, end)] în textul ORIGINAL ale aparițiilor LARGI ale unei etichete: textul se copiază fără spațiile
    albe și caracterele invizibile (_INVIZIBILE: spațiu, rând nou, NBSP, lățime zero, BOM), cu majuscule, fără diacritice (NFKD), iar
    pe copie se caută LARG (prefix de etichetă + separatori + cifre). Un prefix lipit de o literă din fața lui, în textul original,
    e coada unui cuvânt („confirma 2”, „oricui 3”), nu o etichetă."""
    comp, poz = [], []
    for i, ch in enumerate(t):
        if unicodedata.category(ch) in _INVIZIBILE: continue
        for c in unicodedata.normalize('NFKD', ch):
            if unicodedata.category(c)[0] == 'M': continue
            for u in c.upper():
                comp.append(u); poz.append(i)
    out = []
    for m in LARG.finditer(''.join(comp)):
        a = poz[m.start()]
        if a > 0 and _litera(t[a - 1]): continue
        out.append((a, poz[m.end() - 1] + 1))
    return out


def _ultimul_inainte(capete, poz):
    """Indicele ultimului atom care se termină la sau înainte de `poz` (capete sortate crescător), sau -1."""
    lo, hi = 0, len(capete)
    while lo < hi:
        mid = (lo + hi) // 2
        if capete[mid] <= poz: lo = mid + 1
        else: hi = mid
    return lo - 1
