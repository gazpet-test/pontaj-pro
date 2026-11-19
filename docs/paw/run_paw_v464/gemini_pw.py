# gemini_pw.py - canal Gemini ("gem") pentru run_paw v4.6 (27.10.2026, aprobat de Razvan); v4.6.3: modelul Carbon;
# v4.6.4: paza atasamentelor inainte de chatul nou.
# Playwright atasat la Edge-ul existent de pe serverul AI (CDP 9333, doar loopback, profil separat in care Razvan
# s-a logat o data pe gemini.google.com). Model: cgpt_pw.py. NU inchide Edge, NU da reload; navigare la /app sau URL de chat validat de lansator,
# NU ataseaza fisiere, NU scrie fisiere: brief-ul (citit ca DATE) intra in editor, raspunsul iese pe stdout.
# uz:  python gemini_pw.py stare                       (doar citire: tab, model, daca scrie)
#      python gemini_pw.py trimite <brief.md> [secunde_max=600]
# iesire: stdout UTF-8; la eroare ultima linie "GEM_EROARE <cod> <detaliu>" si exit 3.
# coduri: fara_tab_gemini, mai_multe_taburi_gemini, model_gresit, gemini_ocupat, editor_lipsa, text_neintrat,
#         ciorna_cu_atasamente, ciorna_necitibila, ciorna_necunoscuta, brief_invalid, timeout_raspuns, cdp_indisponibil,
#         eroare_playwright, comanda_necunoscuta, url_invalid
# r2 (16.10.2026, dupa Jakarinos r1): ciorna = brief-ul exact (normalizare explicita), refuz cu atasamente in ciorna,
#   limita de marime pe textul citit inainte de strip.
# v4.6.3 (13.11.2026, aprobat de Razvan): modelul cerut = Carbon (Argon a disparut din lista Gemini). Eticheta afisata trebuie sa fie
#   EXACT "Carbon", optional precedata de "Gemini" si / sau de numarul versiunii ("4 Carbon", "Gemini 4 Carbon"); orice sufix
#   ("Carbon Thinking") sau alt model = model_gresit, fara Enter. In lansator eticheta canalului ramane "argon" / "argon:<lucrare>"
#   (nume istoric; run_paw.ps1 nu se schimba in v4.6.3, deci certificarea cdx ramane valabila).
# v4.6.4 (19.11.2026, dupa testul de canal picat): in v4.6.3 trimite() deschidea chatul nou (pg.goto) INAINTE de prima
#   verificare a atasamentelor; chatul nou goleste ciorna, deci verificarea vedea 0 si brief-ul pleca. Acum ciorna tab-ului
#   curent se verifica INAINTE de orice actiune (navigare / click / tastatura), apoi din nou pe chatul nou si chiar inainte
#   de Enter. Numararea: un fisier = un element CHIP (cel mai exterior) in zona de compunere a editorului, citita din
#   page.content() si analizata in Python (testabila pe HTML sintetic); orice alt semn de atasament fara chip = refuz.
# v4.6.4 r2 (Jakarinos NO-GO pe 51b659c4): "0 chip-uri + 0 semne" NU mai inseamna ciorna goala. Ciorna goala se verifica
#   POZITIV: fiecare element si fiecare text din zona de compunere (in afara editorului) trebuie sa fie recunoscut - element
#   neutru fara eticheta / rol / actiune, structura stiuta a zonei, sau intrare din listele albe (CONTROALE_CUNOSCUTE,
#   STRUCTURA_CUNOSCUTA, TEXTE_CUNOSCUTE). Orice altceva (ex. <attachment-card>, img, buton "Remove ...", text "a.txt")
#   = GEM_EROARE ciorna_necunoscuta, exit 3. Listele albe se completeaza DOAR din calibrarea pe pagina reala (RUNBOOK,
#   pasul 0), nu din presupuneri: un refuz fals (operatorul goleste ciorna de mana / se completeaza lista) e preferat
#   unei trimiteri false.
# Lansatorul (run_paw.ps1) tine lock-ul global gem, verifica CDP pe loopback si scrie markerul PAW_GATA / PAW_EROARE.
# ASCII only.
import sys, time, os, re, unicodedata
from urllib.parse import urlparse
from html.parser import HTMLParser

CDP = "http://127.0.0.1:9333"
GAZDA = "gemini.google.com"
EDITOR = 'rich-textarea [contenteditable="true"], div.ql-editor[contenteditable="true"]'
RASPUNS = "message-content"
MODEL = '[data-test-id="bard-mode-menu-button"]'
STOP = 'button[aria-label*="Stop" i]:visible, button[aria-label*="Opre" i]:visible'
ZONA = 'input-area-v2, input-container, .input-area-container, .input-area'       # zona de compunere
ATAS = ('uploader-file-preview, uploader-file-preview-container, file-preview, [data-test-id*="file-preview"], '
        '[data-test-id*="uploaded-file"], [class*="file-preview"]')                # SEMNE de atasament (largi, se suprapun)
# v4.6.4 - selectorul UNIC care numara: elementul Angular <uploader-file-preview> = chip-ul unui fisier pus in ciorna
#   (zona de compunere; raspunsurile si mesajele trimise nu il folosesc). Se numara doar chip-urile cele mai exterioare
#   (un chip imbricat in alt chip = acelasi fisier). ATAS de mai sus nu mai numara, e doar semn: in v4.6.3 suma
#   ZONA>>ATAS + chip-uri globale numara acelasi fisier de mai multe ori (container + chip + clasele interioare
#   *file-preview* + inca o data chip-ul global), de aici "5" pentru un fisier.
CHIP = "uploader-file-preview"
ZONA_TAGURI = ("input-area-v2", "input-container")          # aceeasi lista ca ZONA, pentru analiza HTML in Python
ZONA_CLASE = ("input-area-container", "input-area")
SEMN_TAGURI = ("uploader-file-preview", "uploader-file-preview-container", "file-preview")
SEMN_DATA_TEST = ("file-preview", "uploaded-file")
SEMN_CLASA = "file-preview"
VOIDE = ("area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr")
# --- v4.6.4 r2: structura RECUNOSCUTA a ciornei goale (verificare pozitiva; orice alt element / text = ciorna_necunoscuta) ---
# elemente fara continut propriu: trec doar FARA eticheta / rol / actiune (vezi _semnificativ) si fara cuvinte de atasament
NEUTRE = ("div", "span", "p", "br", "mat-icon", "svg", "path", "g", "circle", "rect", "line", "polyline", "polygon",
          "ellipse", "defs", "clippath", "lineargradient", "radialgradient", "stop", "mask", "use", "symbol")
STRUCTURA_TAGURI = ZONA_TAGURI + ("rich-textarea",)       # zona si invelisul editorului (aceleasi nume ca selectorii)
NEVIZIBILE = ("script", "style", "template", "noscript")   # nu se afiseaza; subarborele lor nu se citeste
MEDIA = ("img", "picture", "video", "audio", "canvas", "object", "embed", "iframe", "image", "source", "track")
# in editor (contenteditable) intra doar textul brief-ului: Quill produce p / br; restul etichetelor de text sunt tolerate
EDITOR_TAGURI = ("p", "br", "span", "div", "strong", "b", "em", "i", "u", "s", "code", "pre", "ol", "ul", "li",
                 "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "sub", "sup")
# atribute care fac un element "semnificativ" (eticheta, rol, actiune): elementul trebuie sa fie in listele albe
SEMN_ATR_VALOARE = ("role", "aria-label", "data-test-id", "data-testid", "type", "name", "title", "alt", "placeholder",
                    "mattooltip", "data-tooltip")              # in semnatura cu valoare
SEMN_ATR_CHEIE = ("tabindex", "jsaction", "onclick", "href", "src", "srcset", "draggable", "contenteditable",
                  "aria-labelledby", "aria-describedby", "aria-description", "aria-roledescription")  # doar cheia
ROLURI_NEUTRE = ("presentation", "none")
ICON_TAGURI = ("mat-icon", "svg")                             # role="img" pe o iconita (Angular Material) = neutru
# cuvinte de atasament (ASCII, litere mici, dupa scoaterea diacriticelor): in clasa / id / atributele data-* ale unui element
# neutru sau in ligatura unei iconite (in afara unui control recunoscut) = nerecunoscut
TOKENI_ATAS = ("file", "fisier", "attach", "atasa", "upload", "incarca", "remove", "elimin", "sterge", "delete",
               "preview", "previz", "thumb", "miniatur", "document", "image", "imagin", "photo", "poza", "media", "chip",
               "card", "pdf")
TOKENI_ELIMINA = ("remove", "elimin", "terge", "delete")     # eticheta unui buton de scoatere ("terge" = sterge cu / fara diacritice)
# eticheta pe care NICIO intrare din listele albe nu o poate acoperi (scoatere / previzualizare a unui fisier, nume.extensie);
# "upload" / "file" raman permise pentru un control recunoscut exact (butonul de incarcare din ciorna goala)
TOKENI_ETICHETA_INTERZISA = TOKENI_ELIMINA + ("preview", "previz", "thumb", "miniatur")
RE_FISIER = re.compile(r"(?<![a-z0-9])[a-z0-9][a-z0-9_-]*\.[a-z][a-z0-9]{0,4}(?![a-z0-9])")   # nume.extensie in text
RE_LIGATURA = re.compile(r"[a-z0-9_]{1,40}")                 # textul unei iconite mat-icon (ex. "send", "add_2")
MODEL_DATA_TEST = "bard-mode-menu-button"                     # butonul modelului (= MODEL), verificat separat
# LISTE ALBE - goale pana la calibrarea pe pagina reala (RUNBOOK pasul 0). Se adauga EXACT semnatura afisata de `stare`
# (linia "necunoscute"), doar pentru elemente vazute de om pe ecran cu ciorna goala / doar text, niciodata pentru ceva ce
# seamana a fisier. CONTROALE = butoane (textul si iconitele din ele sunt eticheta lor); STRUCTURA = invelisuri (continutul
# lor se verifica in continuare element cu element); TEXTE = texte afisate in zona, in afara controalelor.
CONTROALE_CUNOSCUTE = ()
STRUCTURA_CUNOSCUTA = ()
TEXTE_CUNOSCUTE = ()
# acelasi lucru vazut de locator (strapunge shadow DOM-ul deschis, pe care page.content() nu il serializeaza): semn = refuz
SEMN_EXTRA = ", ".join(list(MEDIA) + ['[aria-label*="%s" i]' % t for t in TOKENI_ELIMINA])
MODEL_CERUT = "Carbon"
# forma acceptata a etichetei afisate (dupa normalizarea spatiilor): [Gemini ][<versiune> ]Carbon - nimic dupa numele modelului
MODEL_FORMA = re.compile(r"(?:Gemini )?(?:[0-9]+(?:\.[0-9]+)? )?" + re.escape(MODEL_CERUT))
BRIEF_ROOTS = [r"C:\Users\Public\paw-data\brief", r"C:\Users\Public\erp_review"]
MAX_CAR = 200000          # brief-uri mai mari nu se trimit (editorul web devine nesigur)
PAS_MS = 2000             # o citire la 2 s
CITIRI_IDENTICE = 5       # raspunsul e gata dupa 5 citiri identice consecutive (si fara buton de oprire)


class GemEroare(Exception):
    def __init__(self, cod, detaliu=""):
        super().__init__(cod)
        self.cod = cod
        self.detaliu = detaliu


def spune(*a):
    sys.stdout.write(" ".join(str(x) for x in a) + "\n")
    sys.stdout.flush()


def citeste_brief(cale, roots=BRIEF_ROOTS):
    # aparare in adancime: lansatorul a validat deja calea (UNC/ADS/reparse/radacini); aici doar radacina + .md + marime
    try:
        full = os.path.realpath(cale)
    except Exception:
        raise GemEroare("brief_invalid", "cale nerezolvabila")
    ok = any(os.path.normcase(full).startswith(os.path.normcase(os.path.realpath(r)).rstrip("\\") + "\\") for r in roots)
    if not ok:
        raise GemEroare("brief_invalid", "in afara radacinilor: " + full)
    if not full.lower().endswith(".md"):
        raise GemEroare("brief_invalid", "nu e .md")
    # r2 (Jakarinos P2): limita se aplica pe textul CITIT, inainte de strip (spatiile nu "scurteaza" un brief prea mare)
    try:
        if os.path.getsize(full) > MAX_CAR * 4 + 3:          # UTF-8: cel mult 4 octeti/caracter + BOM
            raise GemEroare("brief_invalid", "peste %d caractere" % MAX_CAR)
        with open(full, "r", encoding="utf-8-sig") as f:
            brut = f.read(MAX_CAR + 1)
    except GemEroare:
        raise
    except Exception as e:
        raise GemEroare("brief_invalid", "necitibil: " + type(e).__name__)
    if len(brut) > MAX_CAR:
        raise GemEroare("brief_invalid", "peste %d caractere" % MAX_CAR)
    text = brut.strip()
    if not text:
        raise GemEroare("brief_invalid", "gol")
    return text


def normalizeaza(t):
    # r2 (Jakarinos P1-b): normalizare EXPLICITA pentru compararea ciornei cu brief-ul: CRLF/CR -> LF, NBSP -> spatiu,
    # caractere de latime zero eliminate, orice sir de spatii albe (inclusiv linii goale) -> un singur spatiu, capete taiate
    t = (t or "").replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    for z in ("\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"):
        t = t.replace(z, "")
    return " ".join(t.split())


def verifica_ciorna(text_editor, brief, n_atasamente):
    # inainte de Enter: ciorna nu are atasamente si contine EXACT brief-ul (dupa normalizare) - nimic in plus, nimic lipsa
    if n_atasamente:
        raise GemEroare("ciorna_cu_atasamente", "%d atasament(e) in ciorna - nu trimit" % n_atasamente)
    a, b = normalizeaza(text_editor), normalizeaza(brief)
    if a != b:
        i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
        raise GemEroare("text_neintrat", "ciorna difera de brief (%d/%d car. normalizate, prima diferenta la %d)" % (len(a), len(b), i))


# --- v4.6.4: ciorna citita din HTML-ul paginii (page.content()), analizata aici, fara browser ---

class _Nod(object):
    __slots__ = ("tag", "attrs", "parinte", "copii", "date")

    def __init__(self, tag, attrs, parinte, date=""):
        self.tag = tag
        self.attrs = attrs
        self.parinte = parinte
        self.copii = []
        self.date = date                    # r2: textul unui nod "#text"


class _Arbore(HTMLParser):
    # arbore minim din HTML; etichetele neinchise se inchid la eticheta de sfarsit a unui stramos
    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.radacina = _Nod("#document", {}, None)
        self.stiva = [self.radacina]

    def _nod(self, tag, attrs):
        n = _Nod(tag, dict((k, "" if v is None else v) for k, v in attrs), self.stiva[-1])
        self.stiva[-1].copii.append(n)
        return n

    def handle_starttag(self, tag, attrs):
        n = self._nod(tag, attrs)
        if tag not in VOIDE:
            self.stiva.append(n)

    def handle_startendtag(self, tag, attrs):
        self._nod(tag, attrs)

    def handle_endtag(self, tag):
        for i in range(len(self.stiva) - 1, 0, -1):
            if self.stiva[i].tag == tag:
                del self.stiva[i:]
                return

    def handle_data(self, data):
        # r2: textul afisat (ex. numele unui fisier) intra in arbore ca nod "#text" sub elementul curent
        if data:
            self.stiva[-1].copii.append(_Nod("#text", {}, self.stiva[-1], data))


def _descendenti(n):
    st = list(reversed(n.copii))
    while st:
        x = st.pop()
        yield x
        st.extend(reversed(x.copii))


def _clase(n):
    return (n.attrs.get("class") or "").split()


def _e_zona(n):
    # = ZONA: input-area-v2, input-container, .input-area-container, .input-area
    return n.tag in ZONA_TAGURI or any(c in ZONA_CLASE for c in _clase(n))


def _e_editor(n):
    # = EDITOR: rich-textarea [contenteditable="true"], div.ql-editor[contenteditable="true"] (valoare exacta, ca in CSS)
    if n.attrs.get("contenteditable") != "true":
        return False
    if n.tag == "div" and "ql-editor" in _clase(n):
        return True
    p = n.parinte
    while p is not None:
        if p.tag == "rich-textarea":
            return True
        p = p.parinte
    return False


def _e_semn(n):
    # = ATAS (semne largi, se pot suprapune; nu numara fisiere)
    if n.tag in SEMN_TAGURI:
        return True
    dt = n.attrs.get("data-test-id")
    if dt is not None and any(s in dt for s in SEMN_DATA_TEST):
        return True
    return SEMN_CLASA in (n.attrs.get("class") or "")


def _sub(n, stramos):
    p = n.parinte
    while p is not None:
        if p is stramos:
            return True
        p = p.parinte
    return False


# --- r2: verificarea POZITIVA a structurii ciornei (tot ce nu e recunoscut = ciorna_necunoscuta) ---

_LATIME_ZERO = "".join(map(chr, (0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF)))     # aceleasi ca in normalizeaza()


def _ascii(s):
    # comparare / afisare: fara diacritice (NFKD) si caractere de latime zero, ASCII, litere mici, spatii albe comprimate
    t = unicodedata.normalize("NFKD", s or "")
    t = "".join(c for c in t if not unicodedata.combining(c) and c not in _LATIME_ZERO)
    return " ".join(t.encode("ascii", "replace").decode("ascii").lower().split())


def _semnatura(n):
    # forma exacta folosita de listele albe si afisata de `stare`: tag[atr=valoare]...[cheie]...
    s = _ascii(n.tag)[:40]
    for k in SEMN_ATR_VALOARE:
        if k in n.attrs:
            s += "[%s=%s]" % (k, _ascii(n.attrs[k])[:60])
    for k in SEMN_ATR_CHEIE:
        if k in n.attrs:
            s += "[%s]" % k
    return s


def _semnificativ(n):
    # element cu eticheta, rol, actiune sau sursa: nu e "neutru", trebuie recunoscut explicit
    rol = _ascii(n.attrs.get("role"))
    if rol and rol not in ROLURI_NEUTRE and not (rol == "img" and n.tag in ICON_TAGURI):
        return True
    if any(k in n.attrs for k in SEMN_ATR_VALOARE if k != "role") or any(k in n.attrs for k in SEMN_ATR_CHEIE):
        return True
    return any(k.startswith("aria-") and k != "aria-hidden" for k in n.attrs)


def _token(n):
    # cuvant de atasament in clasa / id / numele atributelor / valorile data-* ale unui element neutru (sau None)
    parti = [n.attrs.get("class"), n.attrs.get("id")] + list(n.attrs.keys())
    parti += [v for k, v in n.attrs.items() if k.startswith("data-")]
    t = _ascii(" ".join(p for p in parti if p))
    return next((x for x in TOKENI_ATAS if x in t), None)


def _semnatura_token(n):
    # semnatura unui element neutru cu cuvant de atasament: + clasele (fara cele generate ng-*), id-ul, atributele data-*
    clase = [c for c in _clase(n) if not c.startswith(("ng-", "_ng"))]
    parti = clase + (["#" + n.attrs["id"]] if n.attrs.get("id") else []) + sorted(k for k in n.attrs if k.startswith("data-"))
    return _semnatura(n) + "{" + _ascii(" ".join(parti))[:80] + "}"


def _are_eticheta_interzisa(n):
    # eticheta (aria-label, title, alt...) de scoatere / previzualizare sau cu nume de fisier: nicio lista alba nu o acopera
    t = _ascii(" ".join(n.attrs.get(k) or "" for k in SEMN_ATR_VALOARE if k not in ("role", "type")))
    return any(x in t for x in TOKENI_ETICHETA_INTERZISA) or RE_FISIER.search(t) is not None


def _motiv_text(nod, in_control):
    a = _ascii(nod.date)
    if not a:
        return None
    if RE_FISIER.search(a):
        return "text_fisier:" + a[:40]                  # nume.extensie: refuz chiar si intr-un control cunoscut
    if in_control:
        return None                                     # eticheta unui control recunoscut
    p = nod.parinte
    if p is not None and p.tag == "mat-icon" and RE_LIGATURA.fullmatch(a) and not any(x in a for x in TOKENI_ATAS):
        return None                                     # ligatura unei iconite ("send", "mic", "add_2")
    if a in TEXTE_CUNOSCUTE:
        return None
    return "text:" + a[:40]


def _motiv_editor(ed):
    # in editor intra doar textul brief-ului (comparat separat cu verifica_ciorna): orice alt element = nerecunoscut
    out = []
    st = list(reversed(ed.copii))
    while st:
        n = st.pop()
        if n.tag == "#text" or n.tag in NEVIZIBILE:
            continue
        if n.tag in MEDIA or "url(" in _ascii(n.attrs.get("style")):
            out.append("media_in_editor:" + _semnatura(n))
        elif n.tag not in EDITOR_TAGURI:
            out.append("element_in_editor:" + _semnatura(n))
        st.extend(reversed(n.copii))
    return out


def _motiv_element(n, in_control):
    # -> (motiv sau None, in_control pentru copii)
    sem = _semnatura(n)
    if n.tag in MEDIA:
        return "media:" + sem, in_control
    if "url(" in _ascii(n.attrs.get("style")):
        return "fundal:" + sem, in_control              # miniatura pusa ca imagine de fundal
    if n.tag in STRUCTURA_TAGURI:
        return None, in_control                         # zona si invelisul editorului (aceleasi nume ca selectorii)
    if n.attrs.get("data-test-id") == MODEL_DATA_TEST and not _are_eticheta_interzisa(n):
        return None, True                               # butonul modelului: verificat separat (verifica_model)
    if n.tag in NEUTRE and not _semnificativ(n):
        # element neutru: trece, afara de cazul cu cuvant de atasament in clasa / id / data-* (in afara unui control)
        if in_control:
            return None, in_control
        t = _token(n)
        if not t:
            return None, in_control
        sem_t = _semnatura_token(n)
        if sem_t in STRUCTURA_CUNOSCUTA:
            return None, in_control                     # invelis vazut de om (ex. clasa "upload-..." a butonului de incarcare)
        return "token_%s:%s" % (t, sem_t), in_control
    cunoscut_ctrl, cunoscut_str = sem in CONTROALE_CUNOSCUTE, sem in STRUCTURA_CUNOSCUTA
    if cunoscut_ctrl or cunoscut_str:
        if _are_eticheta_interzisa(n):
            return "eticheta:" + sem, in_control        # o intrare din lista alba nu poate acoperi un buton "Remove"
        return None, (in_control or cunoscut_ctrl)
    return "element:" + sem, in_control


def _necunoscute(zona, editoare):
    """Elementele / textele din zona care NU fac parte din structura recunoscuta a ciornei goale (lista de motive).
    Chip-urile si semnele (numarate separat) si ce nu se afiseaza (script / style / template) se sar."""
    out = []
    st = [(c, False) for c in reversed(zona.copii)]
    while st:
        n, ctrl = st.pop()
        if n.tag == "#text":
            m = _motiv_text(n, ctrl)
            if m:
                out.append(m)
            continue
        if n.tag in NEVIZIBILE or n.tag == CHIP or _e_semn(n):
            continue
        if any(n is e for e in editoare):
            out.extend(_motiv_editor(n))
            continue
        m, ctrl_copii = _motiv_element(n, ctrl)
        if m:
            out.append(m)
        st.extend((c, ctrl_copii) for c in reversed(n.copii))
    return out


def analizeaza_ciorna(html):
    """HTML-ul paginii -> dict: editoare, zone (zonele de compunere ale editoarelor, cele mai exterioare),
    atasamente (chip-uri CHIP cele mai exterioare din zone = fisiere), semne (elemente ATAS din zone), detalii."""
    a = _Arbore()
    a.feed(html or "")
    HTMLParser.close(a)                     # inchide parserul HTML (nu browserul: canalul nu inchide nimic in Edge)
    editoare = [n for n in _descendenti(a.radacina) if _e_editor(n)]
    zone = []
    for e in editoare:
        z, p = None, e.parinte
        while p is not None:
            if _e_zona(p):
                z = p                       # urc pana la zona cea mai exterioara (chip-urile pot sta langa editor, nu in el)
            p = p.parinte
        if z is not None and not any(z is x for x in zone):
            zone.append(z)
    zone = [z for z in zone if not any(_sub(z, x) for x in zone if x is not z)]
    atas, semne, detalii = 0, 0, {}
    for z in zone:
        for n in _descendenti(z):
            if n.tag == CHIP:
                p, exterior = n.parinte, True
                while p is not None and p is not z:
                    if p.tag == CHIP:
                        exterior = False
                        break
                    p = p.parinte
                if exterior:
                    atas += 1
            if _e_semn(n):
                semne += 1
                c = _clase(n)
                k = (n.tag + ("." + c[0] if c else ""))[:60].encode("ascii", "replace").decode("ascii")
                detalii[k] = detalii.get(k, 0) + 1
    necunoscute = []                        # r2: verificarea pozitiva (tot ce nu e structura recunoscuta a ciornei goale)
    for z in zone:
        necunoscute.extend(_necunoscute(z, editoare))
    return {"editoare": len(editoare), "zone": len(zone), "atasamente": atas, "semne": semne,
            "detalii": ["%s x%d" % (k, v) for k, v in sorted(detalii.items())][:12],
            "necunoscute": len(necunoscute), "necunoscute_detalii": [m[:120] for m in necunoscute[:60]]}


def verifica_fara_atasamente(info, semn_locator, moment):
    # paza ciorna: fail-closed. Zona negasita = nu stiu ce e in ciorna; chip = fisier; orice semn fara chip = refuz
    if not info["editoare"] or not info["zone"]:
        raise GemEroare("ciorna_necitibila", "%s: zona de compunere negasita (editoare %d, zone %d) - nu trimit"
                        % (moment, info["editoare"], info["zone"]))
    if info["atasamente"]:
        raise GemEroare("ciorna_cu_atasamente", "%s: %d atasament(e) in ciorna - nu trimit" % (moment, info["atasamente"]))
    if info["semne"] or semn_locator:
        raise GemEroare("ciorna_cu_atasamente", "%s: semn de atasament fara chip recunoscut (zona %d, locator %d) - nu trimit"
                        % (moment, info["semne"], semn_locator))
    # r2: 0 chip-uri + 0 semne NU dovedeste ciorna goala; trebuie ca TOT ce e in zona sa fie structura recunoscuta
    if info["necunoscute"]:
        raise GemEroare("ciorna_necunoscuta", "%s: %d element(e) nerecunoscute in zona ciornei - nu trimit (%s)"
                        % (moment, info["necunoscute"], "; ".join(info["necunoscute_detalii"][:3])))
    return 0


def e_tab_gemini(url):
    try:
        u = urlparse(url)
    except Exception:
        return False
    return u.scheme == "https" and (u.hostname or "").lower() == GAZDA


def alege_tab(pagini):
    pg = [x for x in pagini if e_tab_gemini(x.url)]
    if not pg:
        raise GemEroare("fara_tab_gemini", "nu exista tab https://" + GAZDA + " in Edge 9333")
    if len(pg) > 1:
        # fara tinta de conversatie: refuz in loc sa ghicesc in ce conversatie scriu
        raise GemEroare("mai_multe_taburi_gemini", "%d taburi Gemini deschise; lasati unul singur" % len(pg))
    return pg[0]


def verifica_model(text_model):
    t = " ".join((text_model or "").split())      # spatii / linii noi / NBSP -> un singur spatiu
    if not MODEL_FORMA.fullmatch(t):
        raise GemEroare("model_gresit", "afisat: '" + t.encode("ascii", "replace").decode("ascii")[:80] + "', cerut: " + MODEL_CERUT)
    return t


def asteapta_raspuns(citeste, genereaza, asteapta, inainte_n, maxs, ceas=time.monotonic):
    """citeste() -> lista textelor message-content; genereaza() -> bool; asteapta(ms).
    Intoarce (text, complet). Un raspuns nou = mai multe message-content decat inainte de trimitere."""
    t0 = ceas()
    ultim = None
    identice = 0
    while ceas() - t0 < maxs:
        asteapta(PAS_MS)
        m = citeste()
        if len(m) <= inainte_n:
            continue
        cur = (m[-1] or "").strip()
        if cur and cur == ultim:
            identice += 1
        else:
            identice = 1 if cur else 0
        ultim = cur
        if identice >= CITIRI_IDENTICE and not genereaza():
            return cur, True
    return (ultim or ""), False


# --- partea cu browserul (in teste doar cu o pagina falsa, fara Playwright) ---

def _pagini(b):
    return [x for c in b.contexts for x in c.pages]


def _model_afisat(pg):
    loc = pg.locator(MODEL)
    if loc.count() == 0:
        raise GemEroare("model_gresit", "selectorul modelului lipseste (pagina schimbata sau nelogat)")
    return loc.first.inner_text()


def _genereaza(pg):
    return pg.locator(STOP).count() > 0


def _mesaje(pg):
    return pg.locator(RASPUNS).all_inner_texts()


def _semn_locator(pg):
    # v4.6.3 (numara gresit, pastrat doar ca SEMN fail-closed: vede si ce page.content() n-ar serializa, ex. shadow DOM)
    # r2: + media / butoane de scoatere din zona (SEMN_EXTRA), vazute si in shadow DOM
    return pg.locator(ZONA).locator(ATAS).count() + pg.locator(CHIP).count() + pg.locator(ZONA).locator(SEMN_EXTRA).count()


def _citeste_ciorna(pg):
    return analizeaza_ciorna(pg.content()), _semn_locator(pg)


def _paza_ciorna(pg, moment):
    # doar citire (content + count); ridica GemEroare daca ciorna are atasamente sau nu poate fi citita
    info, semn = _citeste_ciorna(pg)
    return verifica_fara_atasamente(info, semn, moment)


def _atasamente(pg):
    # chiar inainte de Enter: aceeasi paza (ridica la orice semn), apoi 0 pentru verifica_ciorna
    return _paza_ciorna(pg, "inainte_de_enter")


def stare(pg):
    spune("URL:", pg.url)
    spune("model:", _model_afisat(pg).strip().encode("ascii", "replace").decode("ascii"))
    info, semn = _citeste_ciorna(pg)
    spune("genereaza:", _genereaza(pg), "| editor:", pg.locator(EDITOR).count(), "| raspunsuri:", pg.locator(RASPUNS).count(),
          "| atasamente in ciorna:", info["atasamente"] if info["zone"] else "?")
    spune("zone compunere:", info["zone"], "| semne atasament: zona", info["semne"], "/ locator", semn,
          "| detalii:", ", ".join(info["detalii"]) or "-")
    # r2: calibrarea listelor albe (RUNBOOK pasul 0) copiaza EXACT aceste semnaturi, cate una pe linie
    spune("necunoscute in zona:", info["necunoscute"])
    for m in info["necunoscute_detalii"]:
        spune("  necunoscut", m)
    try:
        verifica_fara_atasamente(info, semn, "stare")
        spune("paza ciorna: OK (trimite ar continua)")
    except GemEroare as e:
        spune("paza ciorna: REFUZ", e.cod, e.detaliu)


def trimite(pg, text, maxs, target="https://gemini.google.com/app"):
    if target != "https://gemini.google.com/app" and not re.fullmatch(r"https://gemini\.google\.com/app/[0-9a-fA-F]+", target):
        raise GemEroare("url_invalid", "tinta refuzata")
    # v4.6.4: PRIMA operatie pe pagina = paza ciornei din tab-ul curent (doar citire). Chatul nou goleste ciorna, deci
    # o verificare facuta dupa navigare nu mai vede atasamentele puse de operator (cauza testului de canal picat 19.11.2026).
    _paza_ciorna(pg, "inainte_de_chat_nou")
    # Chat nou in acelasi tab, sub lock-ul global al lansatorului. Niciun URL din brief.
    if _genereaza(pg):
        raise GemEroare("gemini_ocupat", "Gemini inca scrie - nu navighez peste el")
    pg.goto(target, wait_until="domcontentloaded", timeout=60000)
    try:
        pg.locator(EDITOR).first.wait_for(state="visible", timeout=60000)
    except Exception:
        raise GemEroare("editor_lipsa", "chatul nou nu are camp de prompt gata")
    if target != "https://gemini.google.com/app" and pg.url != target:
        raise GemEroare("url_invalid", "conversatie indisponibila")
    # r7 (test de canal 01.11): pe chat nou butonul de model apare dupa editor; il astept explicit, apoi verific modelul cerut
    try:
        pg.locator(MODEL).first.wait_for(state="visible", timeout=20000)
    except Exception:
        raise GemEroare("model_gresit", "selectorul modelului nu a aparut in 20s (pagina schimbata sau nelogat)")
    model = verifica_model(_model_afisat(pg))
    if _genereaza(pg):
        raise GemEroare("gemini_ocupat", "Gemini inca scrie - nu trimit peste el")
    inainte_n = len(_mesaje(pg))
    ed = pg.locator(EDITOR)
    if ed.count() == 0:
        raise GemEroare("editor_lipsa", "editorul nu e vizibil")
    ed = ed.first
    _paza_ciorna(pg, "pe_chatul_nou")       # defensiv: chatul nou / conversatia tinta, inainte de click si tastatura
    ed.click()
    pg.keyboard.press("Control+A")      # ciorna ramasa in editor se inlocuieste, nu se lipeste in fata brief-ului
    pg.keyboard.press("Delete")
    pg.keyboard.insert_text(text)
    pg.wait_for_timeout(800)
    # r2 (Jakarinos P1-b): continut identic (normalizat), nu doar lungime; atasamentele se verifica din nou chiar inainte de Enter
    verifica_ciorna(ed.inner_text(), text, _atasamente(pg))
    pg.keyboard.press("Enter")
    spune("GEM_MODEL:", model.encode("ascii", "replace").decode("ascii"))
    spune("TRIMIS (%d car.); astept raspunsul..." % len(text))
    t0 = time.monotonic()
    rasp, complet = asteapta_raspuns(lambda: _mesaje(pg), lambda: _genereaza(pg), pg.wait_for_timeout, inainte_n, maxs)
    spune("=== RASPUNS (%d car., %ds) ===" % (len(rasp), int(time.monotonic() - t0)))
    spune(rasp)
    if not complet:
        raise GemEroare("timeout_raspuns", "raspuns incomplet dupa %ds (partial mai sus)" % maxs)


def url_final(real, target):
    # r5 (Jakarinos r4 P1): dupa ORICE trimitere, URL-ul real al tab-ului e obligatoriu si e singura sursa a GEM_CHAT_URL;
    # un marker fals in textul raspunsului e urmat mereu de linia reala sau de eroare (exit nenul)
    if not re.fullmatch(r"https://gemini\.google\.com/app/[0-9a-fA-F]+", real or ""):
        raise GemEroare("url_invalid", "url real lipsa dupa trimitere")
    if target != "https://gemini.google.com/app" and real != target:
        raise GemEroare("url_invalid", "conversatia s-a schimbat")
    return real


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "stare"
    if cmd not in ("stare", "trimite"):
        raise GemEroare("comanda_necunoscuta", cmd[:40])
    text = None
    maxs = 600
    if cmd == "trimite":
        if len(argv) < 3:
            raise GemEroare("brief_invalid", "lipseste calea brief-ului")
        text = citeste_brief(argv[2])
        if len(argv) > 3:
            try:
                maxs = max(30, min(int(argv[3]), 3600))
            except ValueError:
                raise GemEroare("brief_invalid", "secunde_max invalid")
    target = argv[4] if cmd == "trimite" and len(argv) > 4 else "https://gemini.google.com/app"
    if target != "https://gemini.google.com/app" and not re.fullmatch(r"https://gemini\.google\.com/app/[0-9a-fA-F]+", target):
        raise GemEroare("url_invalid")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        try:
            b = p.chromium.connect_over_cdp(CDP)
        except Exception as e:
            raise GemEroare("cdp_indisponibil", type(e).__name__)
        pg = alege_tab(_pagini(b))
        if cmd == "stare":
            stare(pg)
        else:
            trimite(pg, text, maxs, target)
            spune("GEM_CHAT_URL", url_final(pg.url, target))


if __name__ == "__main__":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        main(sys.argv)
    except GemEroare as e:
        spune("GEM_EROARE", e.cod, e.detaliu)
        sys.exit(3)
    except Exception as e:
        spune("GEM_EROARE", "eroare_playwright", (type(e).__name__ + ": " + str(e)).splitlines()[0][:300] if str(e) else type(e).__name__)
        sys.exit(3)
