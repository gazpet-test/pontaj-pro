# gemini_pw.py - canal Gemini ("gem") pentru run_paw v4.3 (16.10.2026, aprobat de Razvan).
# Playwright atasat la Edge-ul existent de pe serverul AI (CDP 9333, doar loopback, profil separat in care Razvan
# s-a logat o data pe gemini.google.com). Model: cgpt_pw.py. NU inchide Edge, NU da reload, NU navigheaza,
# NU ataseaza fisiere, NU scrie fisiere: brief-ul (citit ca DATE) intra in editor, raspunsul iese pe stdout.
# uz:  python gemini_pw.py stare                       (doar citire: tab, model, daca scrie)
#      python gemini_pw.py trimite <brief.md> [secunde_max=600]
# iesire: stdout UTF-8; la eroare ultima linie "GEM_EROARE <cod> <detaliu>" si exit 3.
# coduri: fara_tab_gemini, mai_multe_taburi_gemini, model_gresit, gemini_ocupat, editor_lipsa, text_neintrat,
#         ciorna_cu_atasamente, brief_invalid, timeout_raspuns, cdp_indisponibil, eroare_playwright, comanda_necunoscuta
# r2 (16.10.2026, dupa Jakarinos r1): ciorna = brief-ul exact (normalizare explicita), refuz cu atasamente in ciorna,
#   limita de marime pe textul citit inainte de strip.
# Lansatorul (run_paw.ps1) tine lock-ul global gem, verifica CDP pe loopback si scrie markerul PAW_GATA / PAW_EROARE.
# ASCII only.
import sys, time, os
from urllib.parse import urlparse

CDP = "http://127.0.0.1:9333"
GAZDA = "gemini.google.com"
EDITOR = 'rich-textarea [contenteditable="true"], div.ql-editor[contenteditable="true"]'
RASPUNS = "message-content"
MODEL = '[data-test-id="bard-mode-menu-button"]'
STOP = 'button[aria-label*="Stop" i]:visible, button[aria-label*="Opre" i]:visible'
ZONA = 'input-area-v2, input-container, .input-area-container, .input-area'       # zona de compunere
ATAS = ('uploader-file-preview, uploader-file-preview-container, file-preview, [data-test-id*="file-preview"], '
        '[data-test-id*="uploaded-file"], [class*="file-preview"]')                # atasamente in ciorna (de validat cu "stare")
MODEL_CERUT = "Argon"
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
    t = (text_model or "").strip()
    if MODEL_CERUT not in t:
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


# --- partea cu browserul (nu se executa in teste) ---

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


def _atasamente(pg):
    # fisiere/imagini deja puse in ciorna (zona de compunere); uploader-file-preview exista doar in compunere
    return pg.locator(ZONA).locator(ATAS).count() + pg.locator("uploader-file-preview").count()


def stare(pg):
    spune("URL:", pg.url)
    spune("model:", _model_afisat(pg).strip().encode("ascii", "replace").decode("ascii"))
    spune("genereaza:", _genereaza(pg), "| editor:", pg.locator(EDITOR).count(), "| raspunsuri:", pg.locator(RASPUNS).count(),
          "| atasamente in ciorna:", _atasamente(pg))


def trimite(pg, text, maxs):
    model = verifica_model(_model_afisat(pg))
    if _genereaza(pg):
        raise GemEroare("gemini_ocupat", "Gemini inca scrie - nu trimit peste el")
    inainte_n = len(_mesaje(pg))
    ed = pg.locator(EDITOR)
    if ed.count() == 0:
        raise GemEroare("editor_lipsa", "editorul nu e vizibil")
    ed = ed.first
    n = _atasamente(pg)
    if n:
        raise GemEroare("ciorna_cu_atasamente", "%d atasament(e) in ciorna inainte de scriere - nu trimit" % n)
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
            trimite(pg, text, maxs)


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
