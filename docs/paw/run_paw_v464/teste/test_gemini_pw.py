# Teste fara browser pentru gemini_pw.py (run_paw v4.6.4: paza atasamentelor inainte de chatul nou; v4.6.3: modelul
# Carbon, potrivire exacta). Rulare:
#   python -I docs\paw\run_paw_v464\teste\test_gemini_pw.py
# Nu importa Playwright, nu se ataseaza la Edge, nu trimite nimic la Gemini: logica de selectie tab / model /
# asteptare stabila / validare brief / numarare atasamente (HTML sintetic) / ordinea pazei in trimite() (pagina falsa) /
# r4: semnalele de atasament verificate INAINTEA listelor albe (reproducerile din verdictul Jakarinos r3 + variante + mutanti) /
# r6: elementul zonei insesi verificat ca orice element (reproducerile din verdictul r5 + zona reala + linkul real + mutanti) /
# r7: editorul insusi verificat ca orice element (media / fundal CSS) si O SINGURA functie de semnale pe toate nivelurile (paritate + mutanti) /
# r14: LISTA ALBA de atribute pe orice element acceptat + textele exacte ale descrierilor (reproducerile r3 + captura completa 23.11 + mutanti) /
# r15: clasele = token-uri exacte pe tag, jslog = valorile vazute cu doar numerele variabile, textele comparate pe Unicode exact
# e testata cu obiecte false. ASCII only.
import os, sys, io, re, types, tempfile, shutil, unittest, importlib.util, contextlib, base64, json
from unittest import mock

AICI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("gemini_pw", os.path.join(AICI, "..", "gemini_pw.py"))
gp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gp)


class Pg:
    def __init__(self, url):
        self.url = url


class Ceas:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def asteapta(self, ms):
        self.t += ms / 1000.0


class TestTab(unittest.TestCase):
    def test_fara_tab(self):
        with self.assertRaises(gp.GemEroare) as c:
            gp.alege_tab([Pg("https://chatgpt.com/c/6abc000f"), Pg("about:blank")])
        self.assertEqual(c.exception.cod, "fara_tab_gemini")

    def test_un_tab(self):
        p = Pg("https://gemini.google.com/app/abc")
        self.assertIs(gp.alege_tab([Pg("https://chatgpt.com/"), p]), p)

    def test_doua_taburi_refuz(self):
        with self.assertRaises(gp.GemEroare) as c:
            gp.alege_tab([Pg("https://gemini.google.com/app/a"), Pg("https://gemini.google.com/app/b")])
        self.assertEqual(c.exception.cod, "mai_multe_taburi_gemini")

    def test_gazde_false(self):
        for u in ("https://gemini.google.com.evil.ro/app", "http://gemini.google.com/app",
                  "https://evil.ro/?u=https://gemini.google.com/", "https://notgemini.google.com/app"):
            with self.assertRaises(gp.GemEroare, msg=u) as c:
                gp.alege_tab([Pg(u)])
            self.assertEqual(c.exception.cod, "fara_tab_gemini")


class TestModel(unittest.TestCase):
    # v4.6.3: valorile asteptate sunt scrise de mana din ce afiseaza Gemini la 13.11.2026 (butonul arata "Carbon"; lista de modele:
    # "4 Hydrogen", "4 Hydrogen Thinking", "4 Carbon"), nu derivate din constanta testata.
    def test_carbon_ok(self):
        self.assertEqual(gp.verifica_model("Carbon"), "Carbon")
        self.assertEqual(gp.verifica_model("  Carbon \n"), "Carbon")
        self.assertEqual(gp.verifica_model("4 Carbon"), "4 Carbon")
        self.assertEqual(gp.verifica_model("Gemini 4 Carbon"), "Gemini 4 Carbon")
        self.assertEqual(gp.verifica_model("Gemini\n4\u00a0Carbon"), "Gemini 4 Carbon")     # linie noua / NBSP = spatiu
        self.assertEqual(gp.verifica_model("4.5 Carbon"), "4.5 Carbon")

    def test_alt_model(self):
        for t in ("Gemini 4 Argon", "Argon", "4 Hydrogen", "4 Hydrogen Thinking", "Hydrogen", "Gemini 4 Flash", "", None, "   ",
                  "carbon", "CARBON", "Carbonate", "4Carbon", "Carbon Thinking", "4 Carbon Thinking", "Carbon Flash",
                  "Carbon 4", "Hydrogen Carbon", "Carbon Carbon", "Gemini 4 Hydrogen (Carbon)", "Carbon\nThinking"):
            with self.assertRaises(gp.GemEroare, msg=repr(t)) as c:
                gp.verifica_model(t)
            self.assertEqual(c.exception.cod, "model_gresit", msg=repr(t))

    def test_mesajul_spune_ce_s_a_afisat_si_ce_se_cere(self):
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_model("4 Hydrogen Thinking")
        self.assertEqual(c.exception.detaliu, "afisat: '4 Hydrogen Thinking', cerut: Carbon")

    def test_sursa_cere_carbon_cu_potrivire_exacta(self):
        # mutant: vechiul model repus sau potrivirea "contine" readusa => pica si testele de mai sus, si acesta
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            sursa = f.read().decode("ascii")
        self.assertIn('MODEL_CERUT = "Carbon"', sursa)
        self.assertNotIn('MODEL_CERUT = "Argon"', sursa)
        self.assertNotIn("MODEL_CERUT not in t", sursa)
        self.assertIn("MODEL_FORMA.fullmatch(t)", sursa)


class TestAsteptare(unittest.TestCase):
    def ruleaza(self, secventa, genereaza=lambda: False, inainte=1, maxs=120):
        ceas = Ceas()
        it = iter(secventa)
        stare = {"ultim": secventa[-1]}

        def citeste():
            try:
                stare["ultim"] = next(it)
            except StopIteration:
                pass
            return stare["ultim"]
        return gp.asteapta_raspuns(citeste, genereaza, ceas.asteapta, inainte, maxs, ceas=ceas), ceas.t

    def test_stabil_dupa_5_citiri(self):
        vechi = ["raspuns vechi"]
        seq = [vechi, vechi, vechi + ["Par"], vechi + ["Partial"]] + [vechi + ["Partial complet"]] * 5
        (text, complet), t = self.ruleaza(seq)
        self.assertTrue(complet)
        self.assertEqual(text, "Partial complet")
        self.assertEqual(t, 9 * 2.0)

    def test_fara_mesaj_nou_timeout(self):
        vechi = ["raspuns vechi"]
        (text, complet), t = self.ruleaza([vechi], maxs=30)
        self.assertFalse(complet)
        self.assertEqual(text, "")

    def test_cat_timp_genereaza_nu_se_opreste(self):
        vechi = ["v"]
        seq = [vechi + ["gata"]] * 20
        (text, complet), t = self.ruleaza(seq, genereaza=lambda: True, maxs=20)
        self.assertFalse(complet)
        self.assertEqual(text, "gata")

    def test_text_gol_nu_e_stabil(self):
        vechi = ["v"]
        (text, complet), t = self.ruleaza([vechi + [""]] * 10, maxs=20)
        self.assertFalse(complet)


class TestBrief(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.root = os.path.join(self.d, "brief")
        os.makedirs(self.root)
        self.afara = os.path.join(self.d, "afara")
        os.makedirs(self.afara)

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def scrie(self, dir_, nume, text):
        p = os.path.join(dir_, nume)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        return p

    def cod(self, cale):
        with self.assertRaises(gp.GemEroare) as c:
            gp.citeste_brief(cale, roots=[self.root])
        return c.exception.cod, c.exception.detaliu

    def test_ok_cu_diacritice(self):
        p = self.scrie(self.root, "b.md", "\ufeffIntrebare: arhitectura? \u0219i \u021b")
        self.assertTrue(gp.citeste_brief(p, roots=[self.root]).startswith("Intrebare"))

    def test_in_afara_radacinii(self):
        self.assertEqual(self.cod(self.scrie(self.afara, "b.md", "x"))[0], "brief_invalid")

    def test_traversal(self):
        self.scrie(self.afara, "b.md", "x")
        self.assertIn("in afara", self.cod(os.path.join(self.root, "..", "afara", "b.md"))[1])

    def test_prefix_frate(self):
        frate = self.root + "_frate"
        os.makedirs(frate)
        self.assertIn("in afara", self.cod(self.scrie(frate, "b.md", "x"))[1])

    def test_nu_md(self):
        self.assertIn(".md", self.cod(self.scrie(self.root, "b.txt", "x"))[1])

    def test_gol(self):
        self.assertIn("gol", self.cod(self.scrie(self.root, "b.md", "  \n "))[1])

    def test_prea_mare(self):
        self.assertIn("peste", self.cod(self.scrie(self.root, "b.md", "a" * (gp.MAX_CAR + 5)))[1])

    def test_limita_inainte_de_strip(self):
        # r2 (Jakarinos P2): spatiile de la capete nu fac un brief prea mare sa treaca
        self.assertIn("peste", self.cod(self.scrie(self.root, "b.md", "a" * gp.MAX_CAR + "\n\n"))[1])
        self.assertIn("peste", self.cod(self.scrie(self.root, "c.md", " " * 10 + "a" * (gp.MAX_CAR - 5)))[1])

    def test_exact_la_limita_trece(self):
        self.assertEqual(len(gp.citeste_brief(self.scrie(self.root, "b.md", "a" * gp.MAX_CAR), roots=[self.root])), gp.MAX_CAR)

    def test_fisier_urias_refuzat_dupa_marime(self):
        p = os.path.join(self.root, "u.md")
        with open(p, "wb") as f:
            f.write(b"a" * (gp.MAX_CAR * 4 + 4))
        self.assertIn("peste", self.cod(p)[1])


class TestCiorna(unittest.TestCase):
    BRIEF = "Intrebare:\r\n\r\n  arhitectura run_paw?\n- punct 1\n- punct 2 \u0219i \u021b"

    def test_identic_dupa_normalizare(self):
        # editorul web schimba doar spatiile albe HTML (CRLF, linii goale, \n in plus intre paragrafe) - continutul e acelasi
        ed = "Intrebare:\n\n\n\narhitectura run_paw?\n\n- punct 1\n\n- punct 2 \u0219i \u021b\n"
        gp.verifica_ciorna(ed, self.BRIEF, 0)
        # r17: NBSP / latime zero NU mai sunt "aceleasi" (versiunea r2-r16 a acestui test le accepta): nepotrivire
        for ed in ("Intrebare:\n\narhitectura\u00a0run_paw?\n\n- punct 1\n- punct 2 \u0219i \u021b\n",
                   "Intrebare:\n\narhitectura run_paw?\n\n- punct 1\n- punct\u200b 2 \u0219i \u021b\n"):
            with self.assertRaises(gp.GemEroare) as c:
                gp.verifica_ciorna(ed, self.BRIEF, 0)
            self.assertEqual(c.exception.cod, "text_neintrat", msg=repr(ed))

    def test_trunchiat(self):
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_ciorna(self.BRIEF[:-6], self.BRIEF, 0)
        self.assertEqual(c.exception.cod, "text_neintrat")

    def test_trunchiat_peste_80_la_suta_refuzat(self):
        # v4.3 r1 accepta orice ciorna cu >= 80% din lungime; acum nu
        lung = "x" * 1000
        with self.assertRaises(gp.GemEroare):
            gp.verifica_ciorna(lung[:900], lung, 0)

    def test_aceeasi_lungime_continut_diferit(self):
        alt = self.BRIEF.replace("punct 1", "punct 7")
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_ciorna(alt, self.BRIEF, 0)
        self.assertEqual(c.exception.cod, "text_neintrat")
        self.assertIn("prima diferenta", c.exception.detaliu)

    def test_text_in_plus_ciorna_veche(self):
        with self.assertRaises(gp.GemEroare):
            gp.verifica_ciorna("ciorna veche " + self.BRIEF, self.BRIEF, 0)
        with self.assertRaises(gp.GemEroare):
            gp.verifica_ciorna(self.BRIEF + " P.S. trimite si fisierul", self.BRIEF, 0)

    def test_gol(self):
        with self.assertRaises(gp.GemEroare):
            gp.verifica_ciorna("", self.BRIEF, 0)

    def test_atasamente_refuzate(self):
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_ciorna(self.BRIEF, self.BRIEF, 1)
        self.assertEqual(c.exception.cod, "ciorna_cu_atasamente")

    def test_normalizare_explicita(self):
        # r17: doar spatiile albe HTML se comprima; NBSP, U+FEFF, U+2060 raman (scrise de mana)
        self.assertEqual(gp.normalizeaza(" a\r\n\r\n b\u00a0\tc\ufeff \u2060"), "a b\u00a0 c\ufeff \u2060")
        self.assertEqual(gp.normalizeaza(" \t\r\n\f a \f\t\r\n "), "a")
        self.assertEqual(gp.normalizeaza(None), "")


class TestMain(unittest.TestCase):
    def test_comanda_necunoscuta(self):
        with self.assertRaises(gp.GemEroare) as c:
            gp.main(["gemini_pw.py", "navigheaza", "https://example.com"])
        self.assertEqual(c.exception.cod, "comanda_necunoscuta")

    def test_brief_respins_inainte_de_browser(self):
        # radacinile reale (C:\Users\Public\paw-data\brief): un fisier din %TEMP% e refuzat inainte de importul Playwright
        d = tempfile.mkdtemp()
        try:
            p = os.path.join(d, "b.md")
            with open(p, "w", encoding="utf-8") as f:
                f.write("x")
            with self.assertRaises(gp.GemEroare) as c:
                gp.main(["gemini_pw.py", "trimite", p, "60"])
            self.assertEqual(c.exception.cod, "brief_invalid")
            self.assertNotIn("playwright.sync_api", sys.modules)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_fara_cale(self):
        with self.assertRaises(gp.GemEroare) as c:
            gp.main(["gemini_pw.py", "trimite"])
        self.assertEqual(c.exception.cod, "brief_invalid")


class TestSursa(unittest.TestCase):
    def test_fara_capabilitati_in_plus(self):
        # canalul navigheaza doar la chat nou, nu reincarca, nu inchide browserul, nu ataseaza fisiere, nu scrie fisiere
        with open(os.path.join(AICI, "..", "gemini_pw.py"), encoding="ascii") as f:
            src = f.read()
        for interzis in (".reload(", ".close()", "set_input_files", "new_page", "write_text", "open(full, \"w"):
            self.assertNotIn(interzis, src, interzis)
        self.assertEqual(src.count('pg.goto('), 1)
        self.assertIn('pg.goto(target,', src)
        self.assertIn('CDP = "http://127.0.0.1:9333"', src)
        # r2: Enter vine DOAR dupa verifica_ciorna (continut + atasamente), iar comparatia pe lungime a disparut
        # r18: ultima paza (cu verifica_ciorna) = _ultima_paza, apelata o data in trimite, chiar inaintea lui Enter
        i_ver, i_enter = src.index("    _ultima_paza(pg, text)\n"), src.index('pg.keyboard.press("Enter")')
        self.assertLess(i_ver, i_enter)
        self.assertEqual(src.count('verifica_ciorna(info["text_editor"], text, info["atasamente"])'), 1)
        self.assertNotIn("* 0.8", src)

    def test_paza_e_prima_operatie_din_trimite(self):
        # v4.6.4: intre "def trimite(" si paza nu exista niciun apel pe pagina; paza vine inaintea navigarii
        with open(os.path.join(AICI, "..", "gemini_pw.py"), encoding="ascii") as f:
            src = f.read()
        i_def = src.index("def trimite(")
        i_paza = src.index('_paza_ciorna(pg, "inainte_de_chat_nou")')
        self.assertEqual(src.count('_paza_ciorna(pg, "inainte_de_chat_nou")'), 1)
        self.assertNotIn("pg.", src[i_def:i_paza])
        self.assertLess(i_paza, src.index("pg.goto(target,"))
        self.assertLess(src.index('_paza_ciorna(pg, "pe_chatul_nou")'), src.index("ed.click()"))
        self.assertEqual(src.count('CHIP = "uploader-file-preview"'), 1)


# --- v4.6.4: HTML sintetic al paginii Gemini (scris de mana; forma reala se confirma la testul de canal, pasul 5b) ---

EDITOR_HTML = ('<div class="input-area"><rich-textarea class="text-input-field_textarea"><div class="ql-editor textarea" '
               'contenteditable="true" role="textbox"><p>ciorna</p></div></rich-textarea></div>')


def chip(nume):
    # un fisier pus in ciorna: chip-ul cu iconita, numele si butonul de scoatere (clasele interioare contin "file-preview")
    return ('<uploader-file-preview class="ng-star-inserted"><div class="file-preview-chip" data-test-id="file-preview">'
            '<img class="file-icon" src="data:,"><span class="file-name">%s</span>'
            '<button aria-label="Remove file"><mat-icon>close</mat-icon></button></div></uploader-file-preview>' % nume)


def pagina(fisiere=(), conversatie="", editor=EDITOR_HTML, extra_zona="", zona_atr=""):
    # r6: zona_atr = atributele elementului zonei insesi (<input-area-v2 ...>), verificat si el din r6
    previz = ""
    if fisiere:
        previz = ('<uploader-file-preview-container><div class="file-preview-container">' + "".join(chip(x) for x in fisiere)
                  + '</div></uploader-file-preview-container>')
    return ('<!DOCTYPE html><html><head><title>Gemini</title></head><body><chat-app><main>'
            '<div class="conversation-container">' + conversatie + '</div>'
            '<input-area-v2' + zona_atr + '><div class="text-input-field-main-area">' + previz + extra_zona + editor + '</div></input-area-v2>'
            '</main></chat-app></body></html>')


CONV_IMAGINI = ('<user-query><div class="query-text">intrebare cu poza</div></user-query>'
                '<model-response><message-content><p>raspuns</p><img src="https://lh3.googleusercontent.com/a.png" class="image">'
                '<generated-image><single-image><img class="image loaded"></single-image></generated-image>'
                '<div class="attachment-container"><img class="file-icon" src="x.png"></div></message-content></model-response>')
# mesaj trimis anterior cu un fisier (alta conversatie, deschisa manual): chip in conversatie, in afara zonei de compunere
CONV_CU_CHIP = '<user-query>' + chip("vechi.pdf") + '<p>uite fisierul</p></user-query>'


class TestNumarareAtasamente(unittest.TestCase):
    # valorile asteptate sunt numarate de mana pe HTML-ul de mai sus (cate fisiere a pus "operatorul"), nu din cod
    def an(self, html):
        return gp.analizeaza_ciorna(html)

    def test_zero(self):
        i = self.an(pagina())
        self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"]), (1, 1, 0, 0))
        self.assertEqual(gp.verifica_fara_atasamente(i, 0, "t"), 0)

    def test_un_fisier_e_unu(self):
        i = self.an(pagina(["a.txt"]))
        self.assertEqual(i["atasamente"], 1)
        # semnele largi se suprapun (container + chip + div-urile *file-preview*): de aceea nu mai numara fisiere
        self.assertGreater(i["semne"], 1)
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_fara_atasamente(i, 0, "t")
        self.assertEqual(c.exception.cod, "ciorna_cu_atasamente")
        self.assertIn("1 atasament(e)", c.exception.detaliu)

    def test_doua_fisiere(self):
        self.assertEqual(self.an(pagina(["a.txt", "b.png"]))["atasamente"], 2)

    def test_raspunsuri_cu_imagini_tot_zero(self):
        i = self.an(pagina(conversatie=CONV_IMAGINI * 3))
        self.assertEqual((i["atasamente"], i["semne"]), (0, 0))
        gp.verifica_fara_atasamente(i, 0, "t")

    def test_raspunsuri_cu_imagini_si_un_fisier(self):
        self.assertEqual(self.an(pagina(["a.txt"], conversatie=CONV_IMAGINI))["atasamente"], 1)

    def test_chip_in_conversatie_nu_e_in_ciorna(self):
        i = self.an(pagina(conversatie=CONV_CU_CHIP))
        self.assertEqual((i["atasamente"], i["semne"]), (0, 0))
        # dar semnul global (locator, ca in v4.6.3) il vede: paza refuza (fail-closed), nu trimite
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_fara_atasamente(i, 1, "t")
        self.assertEqual(c.exception.cod, "ciorna_cu_atasamente")

    def test_chip_imbricat_e_un_fisier(self):
        imbricat = '<uploader-file-preview><div><uploader-file-preview><span>a.txt</span></uploader-file-preview></div></uploader-file-preview>'
        self.assertEqual(self.an(pagina(extra_zona=imbricat))["atasamente"], 1)

    def test_chip_langa_editor_in_zona_exterioara(self):
        # editorul sta in .input-area (zona interioara); chip-ul e in input-area-v2, langa ea: se numara
        html = ('<html><body><input-area-v2>' + chip("a.txt") + '<input-container>' + EDITOR_HTML
                + '</input-container></input-area-v2></body></html>')
        i = self.an(html)
        self.assertEqual((i["zone"], i["atasamente"]), (1, 1))

    def test_semn_fara_chip_refuzat(self):
        # Gemini isi schimba eticheta chip-ului: ramane doar o clasa *file-preview* -> 0 fisiere numarate, dar refuz
        i = self.an(pagina(extra_zona='<div class="file-preview-v3"><span>a.txt</span></div>'))
        self.assertEqual((i["atasamente"], i["semne"]), (0, 1))
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_fara_atasamente(i, 0, "t")
        self.assertEqual(c.exception.cod, "ciorna_cu_atasamente")
        self.assertIn("fara chip", c.exception.detaliu)
        for semn in ('<div data-test-id="uploaded-file-1"></div>', '<file-preview></file-preview>'):
            self.assertEqual(self.an(pagina(extra_zona=semn))["semne"], 1, semn)

    def test_semn_locator_cu_html_curat_refuzat(self):
        # ex. chip in shadow DOM (nu apare in page.content()): locatorul il vede -> refuz
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_fara_atasamente(self.an(pagina()), 2, "t")
        self.assertEqual(c.exception.cod, "ciorna_cu_atasamente")

    def test_fara_editor_sau_fara_zona_necitibila(self):
        for html in ('<html><body><p>se incarca</p></body></html>',
                     '<html><body>' + EDITOR_HTML.replace('class="input-area"', 'class="alt"') + chip("a.txt") + '</body></html>',
                     pagina(editor=EDITOR_HTML.replace('contenteditable="true"', 'contenteditable="false"')),
                     ""):
            i = self.an(html)
            with self.assertRaises(gp.GemEroare, msg=html[:60]) as c:
                gp.verifica_fara_atasamente(i, 0, "t")
            self.assertEqual(c.exception.cod, "ciorna_necitibila", msg=html[:60])

    def test_html_neinchis_si_voide(self):
        # <img> / <br> fara inchidere si un <p> neinchis nu "inghit" chip-ul care urmeaza
        html = pagina(extra_zona='<p>text<img src="x"><br>' + chip("a.txt") + chip("b.txt"))
        self.assertEqual(self.an(html)["atasamente"], 2)

    def test_editor_ql_fara_rich_textarea(self):
        # r17: editorul principal = rich-textarea > div[role=textbox][contenteditable=true]; un div.ql-editor fara rich-textarea / fara rol
        # NU e editor -> niciun editor, nicio zona -> ciorna_necitibila (refuz, fara actiuni), chiar si cu fisierul langa
        for ed in ('<div class="input-area"><div class="ql-editor" contenteditable="true"></div></div>',
                   '<div class="input-area"><div class="ql-editor" contenteditable="true" role="textbox"></div></div>',
                   '<div class="input-area"><rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea></div>',
                   '<div class="input-area"><rich-textarea><div><div class="ql-editor" contenteditable="true" role="textbox"></div></div></rich-textarea></div>'):
            i = self.an(pagina(["a.txt"], editor=ed))
            self.assertEqual((i["editoare"], i["zone"]), (0, 0), msg=ed)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina(["a.txt"], editor=ed))), ("ciorna_necitibila", []), msg=ed)

    def test_paritate_css_python(self):
        # L19: selectorii CSS (locator) si regulile din Python (analiza HTML) descriu aceleasi elemente
        self.assertEqual(gp.ZONA, ", ".join(list(gp.ZONA_TAGURI) + ["." + c for c in gp.ZONA_CLASE]))
        self.assertEqual(gp.ATAS, ", ".join(list(gp.SEMN_TAGURI) + ['[data-test-id*="%s"]' % s for s in gp.SEMN_DATA_TEST]
                                            + ['[class*="%s"]' % gp.SEMN_CLASA]))
        # r17: editorul PRINCIPAL, aceeasi regula in CSS si in _e_editor (fiu direct al lui rich-textarea, rol si contenteditable exacte)
        self.assertEqual(gp.EDITOR, 'rich-textarea > div[role="textbox"][contenteditable="true"]')
        self.assertIn(gp.CHIP, gp.SEMN_TAGURI)
        # clasa de zona = token intreg (ca ".input-area" in CSS), nu subsir
        i = self.an('<html><body><div class="my-input-area-x">' + EDITOR_HTML.replace('class="input-area"', 'class="textarea-wrapper"')
                    + '</div></body></html>')
        self.assertEqual(i["zone"], 0)

    def test_detalii_ascii_si_scurte(self):
        i = self.an(pagina(["a" + chr(0x21B) + ".txt"], extra_zona='<div class="file-preview-' + chr(0x219) + "x" * 200 + '"></div>'))
        for d in i["detalii"]:
            d.encode("ascii")
            self.assertLess(len(d), 80)


# --- pagina falsa pentru trimite(): actiunile (navigare, click, tastatura) se inregistreaza in ordine ---

class FakeLoc:
    def __init__(self, pg, sel):
        self.pg, self.sel = pg, sel

    @property
    def first(self):
        return self

    def locator(self, sub):
        return FakeLoc(self.pg, self.sel + " >> " + sub)

    def count(self):
        self.pg.jurnal.append("count " + self.sel)
        if self.sel == gp.STOP:
            return 0
        if self.sel == gp.EDITOR:
            return self.pg.n_editor                # r17: cate editoare principale vede locatorul (implicit 1)
        if self.sel == gp.MODEL:
            return 1
        if self.sel == gp.RASPUNS:
            return len(self.pg.mesaje)
        return self.pg.semn                    # selectorii de atasamente (semnul locator)

    def wait_for(self, state=None, timeout=None):
        pass

    def inner_text(self):
        self.pg.jurnal.append("inner_text " + self.sel)
        if self.sel == gp.MODEL:
            return "Carbon"
        # r17: textul VIZIBIL al editorului (randarea lui); r18: codul nu il mai citeste (testat), ramane pentru mutantii cu calea r17
        return self.pg.randare(self.pg.ciorna) if self.pg.randare else self.pg.ciorna

    def all_inner_texts(self):
        return list(self.pg.mesaje)

    def click(self):
        self.pg.act.append("click")
        self.pg.jurnal.append("click")


class FakeKb:
    def __init__(self, pg):
        self.pg = pg

    def press(self, k):
        self.pg.act.append("press " + k)
        self.pg.jurnal.append("press " + k)
        if k == "Delete":
            self.pg.ciorna = ""
        if k == "Enter":
            self.pg.mesaje.append("PAW_GEM_TEST_OK")

    def insert_text(self, t):
        self.pg.act.append("insert")
        self.pg.jurnal.append("insert")
        self.pg.ciorna += t
        self.pg.scris = True
        if self.pg.dupa_scriere is not None:
            self.pg.html = self.pg.dupa_scriere


def _esc_text(s):
    # r18: textul unui nod asa cum il serializeaza page.content() (Chrome: &amp; &lt; &gt; si NBSP ca &nbsp;)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\u00a0", "&nbsp;")


def quill_html(t):
    # r18: cum pune Quill un text in editor - un <p> pe linie, linia goala = <p><br></p> (forma Quill; continutul editorului nu e in
    # capturi, vezi raportul r18) - cu escape-urile din page.content()
    return "".join("<p>%s</p>" % (_esc_text(l) if l else "<br>") for l in (t or "").split("\n"))


def cu_text_scris(html, interior_nou):
    # r18: in pagina falsa, dupa scriere, continutul "de baza" al editorului principal (primul div cu role="textbox" si
    # contenteditable="true") = textul scris (interior_nou); ce e IN PLUS in editor dupa baza (elementele straine puse de testele negative)
    # ramane. Baza = continutul fixture-ului (TEXT_LUNG / TEXT_MEDIU / <p>ciorna</p> / <p>proba</p> / <p><br></p>).
    m = next((x for x in re.finditer(r"<div\b[^>]*>", html) if 'role="textbox"' in x.group(0) and 'contenteditable="true"' in x.group(0)), None)
    if m is None:
        return html
    i, adanc = m.end(), 1
    for t in re.finditer(r"<div\b[^>]*>|</div>", html[i:]):
        adanc += -1 if t.group(0) == "</div>" else 1
        if adanc == 0:
            j = i + t.start()
            break
    else:
        return html
    interior = html[i:j]
    for b in (TEXT_LUNG, TEXT_MEDIU, "<p>ciorna</p>", "<p>proba</p>", "<p><br></p>"):
        if interior.startswith(b):
            interior = interior[len(b):]
            break
    return html[:i] + interior_nou + interior + html[j:]


UMBRE_ZERO = {"shadow_pagina": 0, "shadow_zona": 0, "custom_pagina": 0, "custom_zona": 0}     # r19: pagina reala (citire CDP 23.11)


# --- r20: instantaneul CDP simulat. DOM.getDocument(depth -1, pierce) intoarce arborele in forma CDP (verificata in Edge 157, sonda_cdp.py):
# document nodeType 9 -> children; element nodeType 1 (nodeName MAJUSCULE, localName, attributes = lista plata); text nodeType 3 (nodeValue);
# <template> cu copiii in templateContent (fragment 11). Ca in Chromium: fara DOM.enable({includeWhitespace: "all"}) textele din doar
# spatii albe HTML LIPSESC; un text > 10000 de caractere vine taiat (primele 10000 + U+2026). Umbrele se adauga cu cdp_doc(pg, doc).
LIMITA_CDP_TEST = 10000                       # scrisa de mana (Edge 157: len 25000 -> 10001)


def _cdp_din_nod(n, cu_spatii):
    if n.tag == "#text":
        v = n.date if len(n.date) <= LIMITA_CDP_TEST else n.date[:LIMITA_CDP_TEST] + "\u2026"
        return {"nodeType": 3, "nodeName": "#text", "nodeValue": v}
    copii = [_cdp_din_nod(c, cu_spatii) for c in n.copii if cu_spatii or c.tag != "#text" or c.date.strip(" \t\n\r\f")]
    if n.tag == "#document":
        return {"nodeType": 9, "nodeName": "#document", "children": copii}
    d = {"nodeType": 1, "nodeName": n.tag.upper(), "localName": n.tag, "attributes": [x for kv in n.attrs.items() for x in kv]}
    if n.tag == "template":
        d["children"], d["templateContent"] = [], {"nodeType": 11, "nodeName": "#document-fragment", "children": copii}
    else:
        d["children"] = copii
    return d


def html_in_cdp(html, cu_spatii=True):
    # HTML (parserul testelor, _Arbore) -> raspunsul DOM.getDocument: {"root": document}
    a = gp._Arbore()
    a.feed(html)
    return {"root": _cdp_din_nod(a.radacina, cu_spatii)}


def noduri_cdp(n):
    # toate elementele unui raspuns CDP (DOM-ul obisnuit + continutul shadow root-urilor), in ordine
    st = [n]
    while st:
        x = st.pop()
        yield x
        st.extend(reversed(x.get("children", []) + [y for s in x.get("shadowRoots", []) for y in [s]]))


def adauga_umbra(doc, gazda, tip, interior="", al_catelea=0):
    # pune un shadow root de tipul `tip` (open / closed / user-agent / ...) pe al `al_catelea` element CDP pentru care gazda(el) e adevarat;
    # continutul = interior (HTML). Intoarce doc (modificat)
    gasite = [x for x in noduri_cdp(doc["root"]) if x.get("nodeType") == 1 and gazda(x)]
    g = gasite[al_catelea]
    copii = html_in_cdp("<x>" + interior + "</x>")["root"]["children"][0]["children"] if interior else []
    g.setdefault("shadowRoots", []).append({"nodeType": 11, "nodeName": "#document-fragment", "shadowRootType": tip, "children": copii})
    return doc


def atr_cdp(x):
    a = x.get("attributes", [])
    return dict(zip(a[::2], a[1::2]))


class FakeCDP:
    # sesiunea CDP a paginii false: DOM.enable / DOM.getDocument / detach; getDocument = citirea instantaneului (_citire)
    def __init__(self, pg):
        self.pg, self.spatii = pg, False

    def send(self, metoda, param=None):
        pg = self.pg
        pg.jurnal.append("cdp " + metoda)
        pg.cdp_trimise.append((metoda, param))
        if metoda == "DOM.enable":
            self.spatii = (param or {}).get("includeWhitespace") == "all"
            return {}
        if metoda == "DOM.getDocument":
            if param != {"depth": -1, "pierce": True}:
                return html_in_cdp("<html><body></body></html>")      # fara pierce / adancime: nimic din pagina (forma reala nu se simuleaza)
            doc = html_in_cdp(pg._citire(), self.spatii)
            if pg.cdp_doc is not None:
                doc = pg.cdp_doc(pg, doc)
            pg.ultimul_doc = doc
            return pg.rezultat_cdp(pg, doc) if pg.rezultat_cdp else doc
        raise RuntimeError("metoda CDP neasteptata " + metoda)

    def detach(self):
        self.pg.jurnal.append("cdp detach")


class FakeCtx:
    def __init__(self, pg):
        self.pg = pg

    def new_cdp_session(self, pagina):
        self.pg.jurnal.append("cdp sesiune")
        if pagina is not self.pg or self.pg.cdp_indisponibil:
            raise RuntimeError("Target closed")
        return FakeCDP(self.pg)


class FakePg:
    def __init__(self, html, semn=0, dupa_goto=None, dupa_scriere=None, n_editor=1, randare=None, html_editor=None, la_citire=None,
                 umbre=None, rezultat_evaluate=None, cdp_doc=None, rezultat_cdp=None, cdp_indisponibil=False):
        # r19: evaluate(JS_UMBRE) = numaratorile shadow din pagina: dict (fix) sau umbre(pg) -> dict (schimbat intre citiri); implicit
        # UMBRE_ZERO. rezultat_evaluate(pg, r) -> ce intoarce de fapt evaluate (forme gresite).
        # r20: instantaneul = DOM.getDocument prin context.new_cdp_session(pg) (FakeCDP): aceeasi citire (_citire: la_citire / citite /
        # n_dupa) in forma CDP; cdp_doc(pg, doc) -> doc = umbrele / schimbarile puse in raspuns; rezultat_cdp(pg, doc) -> ce intoarce de
        # fapt (forme gresite); cdp_indisponibil = new_cdp_session esueaza. Jurnalul: "evaluate", "cdp sesiune", "cdp DOM.enable",
        # "cdp DOM.getDocument" (instantaneul), "cdp detach"; "content" doar mutantii vechi
        self.umbre, self.rezultat_evaluate, self.js_evaluate = umbre, rezultat_evaluate, []
        self.cdp_doc, self.rezultat_cdp, self.cdp_indisponibil, self.cdp_trimise = cdp_doc, rezultat_cdp, cdp_indisponibil, []
        self.context = FakeCtx(self)
        # r17: n_editor = numarul de editoare principale vazute de locator; randare = cum arata inner_text() textul scris (None = identic)
        # r18: dupa scriere, content() pune in editor textul scris ca HTML Quill: html_editor(ciorna) daca e dat, altfel
        # quill_html(randare(ciorna) / ciorna); la_citire(pg, html) -> html = ce intoarce citirea curenta content() (editorul schimbat
        # intre citiri; pg.scris / pg.n_dupa = cate citiri content() au fost DUPA scriere, inaintea celei curente); jurnal = TOATE
        # apelurile pe pagina (citiri + actiuni), in ordine
        self.url = "https://gemini.google.com/app/abc123"
        self.n_editor, self.randare, self.html_editor, self.la_citire = n_editor, randare, html_editor, la_citire
        self.html, self.semn = html, semn
        self.dupa_goto = pagina() if dupa_goto is None else dupa_goto     # chatul nou goleste ciorna (ca pe 19.11)
        self.dupa_scriere = dupa_scriere
        self.act, self.mesaje, self.ciorna, self.jurnal, self.scris, self.n_dupa = [], [], "", [], False, 0
        self.citite = []                    # r18: HTML-ul intors de fiecare citire content(), in ordine
        self.keyboard = FakeKb(self)

    def content(self):
        self.jurnal.append("content")
        return self._citire()

    def evaluate(self, js):
        self.jurnal.append("evaluate")
        self.js_evaluate.append(js)
        u = self.umbre(self) if callable(self.umbre) else self.umbre     # n_dupa = citirile instantaneului de pana acum
        r = dict(UMBRE_ZERO if u is None else u)
        self.ultimele_umbre = dict(r)
        return self.rezultat_evaluate(self, r) if self.rezultat_evaluate else r

    def _citire(self):
        h = self.html
        if self.scris:
            if self.html_editor is not None:
                h = cu_text_scris(h, self.html_editor(self.ciorna))
            else:
                h = cu_text_scris(h, quill_html(self.randare(self.ciorna) if self.randare else self.ciorna))
        if self.la_citire is not None:
            h = self.la_citire(self, h)
        if self.scris:
            self.n_dupa += 1
        self.citite.append(h)
        return h

    def locator(self, sel):
        return FakeLoc(self, sel)

    def goto(self, url, **kw):
        self.act.append("goto")
        self.jurnal.append("goto")
        self.html, self.semn, self.url = self.dupa_goto, 0, "https://gemini.google.com/app"

    def wait_for_timeout(self, ms):
        self.jurnal.append("wait")


BRIEF_TEST = "Raspunde exact: PAW_GEM_TEST_OK"


def ruleaza_trimite(mod, pg):
    # -> (cod GemEroare sau None, actiunile paginii)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            mod.trimite(pg, BRIEF_TEST, 30)
        return None, pg.act
    except mod.GemEroare as e:
        return e.cod, pg.act


def scenariu_atasament_in_tab_curent(mod):
    # 19.11.2026: operatorul pune UN fisier in ciorna tab-ului curent, apoi "trimite"
    return ruleaza_trimite(mod, FakePg(pagina(["a.txt"])))


class TestTrimiteOrdine(unittest.TestCase):
    def test_atasament_in_tab_curent_refuz_fara_nicio_actiune(self):
        cod, act = scenariu_atasament_in_tab_curent(gp)
        self.assertEqual(cod, "ciorna_cu_atasamente")
        self.assertEqual(act, [])                # nici chat nou, nici click, nici tastatura

    def test_semn_locator_in_tab_curent_refuz_fara_actiune(self):
        cod, act = ruleaza_trimite(gp, FakePg(pagina(), semn=1))
        self.assertEqual((cod, act), ("ciorna_cu_atasamente", []))

    def test_tab_fara_zona_refuz_fara_actiune(self):
        cod, act = ruleaza_trimite(gp, FakePg("<html><body>se incarca</body></html>"))
        self.assertEqual((cod, act), ("ciorna_necitibila", []))

    def test_atasament_pe_chatul_nou_refuz_inainte_de_click(self):
        cod, act = ruleaza_trimite(gp, FakePg(pagina(), dupa_goto=pagina(["a.txt"])))
        self.assertEqual((cod, act), ("ciorna_cu_atasamente", ["goto"]))

    def test_atasament_aparut_dupa_scriere_fara_enter(self):
        cod, act = ruleaza_trimite(gp, FakePg(pagina(), dupa_scriere=pagina(["a.txt"])))
        self.assertEqual(cod, "ciorna_cu_atasamente")
        self.assertNotIn("press Enter", act)
        self.assertIn("insert", act)

    def test_ciorna_goala_trimite(self):
        pg = FakePg(pagina(conversatie=CONV_IMAGINI))
        cod, act = ruleaza_trimite(gp, pg)
        self.assertIsNone(cod)
        self.assertEqual(act, ["goto", "click", "press Control+A", "press Delete", "insert", "press Enter"])

    def test_mutant_paza_dupa_chatul_nou_e_prins(self):
        # mutant: paza mutata dupa pg.goto (ca in v4.6.3) -> scenariul de pe 19.11 trimite brief-ul => testul de mai sus pica
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        paza = '    _paza_ciorna(pg, "inainte_de_chat_nou")'
        goto = '    pg.goto(target, wait_until="domcontentloaded", timeout=60000)'
        linii = src.split("\n")
        ip = [k for k, l in enumerate(linii) if l.rstrip("\r") == paza]
        ig = [k for k, l in enumerate(linii) if l.rstrip("\r") == goto]
        self.assertEqual((len(ip), len(ig)), (1, 1))
        mutat = linii.pop(ip[0])
        ig = [k for k, l in enumerate(linii) if l.rstrip("\r") == goto][0]
        linii.insert(ig + 1, mutat)
        mut = types.ModuleType("gemini_pw_mutant")
        exec(compile("\n".join(linii), "gemini_pw_mutant", "exec"), mut.__dict__)
        cod, act = scenariu_atasament_in_tab_curent(mut)
        self.assertNotEqual((cod, act), ("ciorna_cu_atasamente", []))
        self.assertIn("press Enter", act)        # mutantul trimite brief-ul, exact ce s-a intamplat pe 19.11


# --- v4.6.4 r2 (Jakarinos NO-GO pe 51b659c4): verificarea POZITIVA a ciornei goale ---
# Structura reala nu e cunoscuta (fara Edge); fixture-urile sunt scrise de mana. Cazul din verdict, copiat exact:
CARD_VERDICT = ('<attachment-card>\n  <span>a.txt</span>\n  <button aria-label="Remove attachment">x</button>\n'
                '</attachment-card>')
# ciorna goala cu elemente legitime: butonul modelului (selectorul MODEL), o iconita svg, doua iconite mat-icon
# r16: iconitele mat-icon FARA text (ca in captura netaiata 23.11: numele sta in fonticon, textul e gol); r2-r15 aveau aici ligaturi
# inventate ("add_2", "keyboard_arrow_down" ca text), acceptate de RE_LIGATURA - nevazute pe pagina reala, deci refuzate acum
# r18: r2-r17 aveau aici si <script> / <style> (presupuse "nevizibile", sarite) - nevazute in nicio captura reala a zonei (c23n gol / mediu
# / lung, t23: 0 elemente script / style / template / noscript), deci scoase; acum sunt refuzate (NECUNOSCUTE, TestNevizibileR18)
GOALA_CU_CONTROALE = ('<div class="leading-actions-wrapper"><mat-icon role="img" aria-hidden="true" fonticon="plus"></mat-icon></div>'
                      '<div class="trailing-actions-wrapper"><button data-test-id="bard-mode-menu-button" aria-label="Deschide selectorul de moduri, momentan Carbon">'
                      '<span class="picker-primary-text">Carbon</span><mat-icon role="img" aria-hidden="true" fonticon="keyboard_arrow_down">'
                      '</mat-icon></button>'
                      '<svg><path></path></svg></div>'
                      '<span></span>')
# fiecare = ceva ce NU face parte din ciorna goala recunoscuta (asteptat: ciorna_necunoscuta), scris de mana
NECUNOSCUTE = {
    "card_verdict": CARD_VERDICT,
    "img": '<div><img src="data:,"></div>',
    "buton_remove": '<div><button aria-label="Remove file">x</button></div>',
    "buton_remove_fara_text": '<button aria-label="Remove attachment"><mat-icon>close</mat-icon></button>',
    "buton_sterge_ro": '<button aria-label="\u0218terge fi\u0219ierul"><mat-icon>close</mat-icon></button>',
    "text_cu_extensie": '<div><span>raport final.PDF</span></div>',
    "text_cu_extensie_ro": '<div>fi\u0219ier_\u021b.docx</div>',
    "text_necunoscut": '<span>Incarcat</span>',
    "card_fara_text": '<attachment-card><mat-icon>close</mat-icon></attachment-card>',
    "clasa_atasament": '<div class="attachment-thumb"></div>',
    "atribut_fisier": '<div data-file-id="7"></div>',
    "fundal_miniatura": '<div style="background-image: url(blob:x)"></div>',
    "rol_listitem": '<div role="listitem"></div>',
    "div_clickabil": '<div jsaction="click:abc"><mat-icon>close</mat-icon></div>',
    "div_etichetat": '<div aria-label="a"></div>',
    "canvas": '<canvas></canvas>',
    "video": '<video src="x"></video>',
    "ligatura_fisier": '<div><mat-icon>attach_file</mat-icon></div>',
    "input_ascuns": '<input type="file" hidden>',
    # r18: fostele "nevizibile" (sarite pana la r17), si goale
    "script": '<script>var file = "a.txt";</script>',
    "style": "<style>.file-preview{}</style>",
    "script_gol": "<script></script>",
    "style_gol": "<style></style>",
    "template_gol": "<template></template>",
    "noscript_gol": "<noscript></noscript>",
}


def zona_cu(extra="", editor=EDITOR_HTML, zona_atr=""):
    return pagina(extra_zona=GOALA_CU_CONTROALE + extra, editor=editor, zona_atr=zona_atr)


# linia din _semnal care alege ce VALORI de atribut se verifica (pasul 4); r9: + exceptia exacta _valoare_permisa. Mutantii o rescriu.
LINIA_PAS4 = "        if k in ATRIBUTE_AFISATE_SEPARAT or k in SEMN_ATR_VALOARE or not v or _valoare_permisa(n, k):"
# linia din _marcaj_permis care cere elementul IZOLAT (r9); r10: + atributele din campul `goale`, doar cu valoare goala / spatii albe HTML
LINIA_IZOLAT = ('        if izolat and any(a != k and a != "class" and not (_generat(a) and v == "") and not (a in goale and VALOARE_SPATII.fullmatch(v))'
                ' for a, v in n.attrs.items()):')
# linia din _marcaj_permis care cere tagul si clasele exacte; r11: clasele = UNA din multimile din lista (CLASE_DIV_DROP pentru div)
LINIA_CLASE = "        if n.tag != tag or not any(set(c for c in _clase(n) if not _generat(c)) == set(x) for x in clase):"


def mutant(inlocuiri, nume="gemini_pw_mutant"):
    # copia sursei cu inlocuiri exacte (fiecare text vechi apare o singura data), executata ca modul separat
    with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
        src = f.read().decode("ascii")
    for vechi, nou in inlocuiri:
        if src.count(vechi) != 1:
            raise AssertionError("mutant: %r apare de %d ori" % (vechi, src.count(vechi)))
        src = src.replace(vechi, nou)
    mod = types.ModuleType(nume)
    exec(compile(src, nume, "exec"), mod.__dict__)
    return mod


def valori_in_plus(*triplete, mod=None):
    # r13 / r14: (tag, atribut, valoare) adaugate in ATRIBUTE_PERMISE (r15: valoare BRUTA EXACTA, fara _ascii) DOAR pe durata unui test
    # care verifica ALTA regula pe un control sintetic (lista alba patch-uita cu o semnatura inventata); fara ele lista alba a atributelor
    # l-ar refuza independent
    mod = mod or gp
    return mock.patch.object(mod, "ATRIBUTE_PERMISE",
                             mod.ATRIBUTE_PERMISE + tuple(((t,), k, re.compile(re.escape(v))) for t, k, v in triplete))


def clase_in_plus(tag, *tokeni, mod=None):
    # r15: token-uri de clasa (EXACTE) adaugate pe tagul `tag` DOAR pe durata unui test care verifica ALTA regula pe un fixture sintetic
    # (ex. zona recunoscuta prin clasa `input-area-container`, nevazuta in capturi); fara ele lista alba a claselor l-ar refuza independent
    mod = mod or gp
    return mock.patch.object(mod, "ATRIBUTE_PERMISE", mod.ATRIBUTE_PERMISE + (((tag,), "class", mod._FormaClase(tokeni)),))


def fara_r13(mod):
    # r13 / r14 izolat: pentru mutantii rundelor vechi (alta regula slabita). Scenariile lor poarta adesea si un atribut necunoscut / cu
    # alta valoare, pe care lista alba a atributelor (r14, ca inainte regula r13) il refuza independent (doua straturi); mutantul se judeca
    # pe regula LUI, deci lista alba e oprita doar in modulul mutant (orice atribut trece)
    return mock.patch.object(mod, "_atribut_strain", lambda n: None)


@contextlib.contextmanager
def fara_r18(mod):
    # r18 izolat: pentru mutantii rundelor vechi. Straturile r18 (textul editorului din HTML + forma Quill, ultima paza dintr-un singur
    # instantaneu) prind si ele scenariile vechi (al doilea strat); mutantul se judeca pe regula LUI, deci DOAR in modulul mutant: forma
    # editorului nu mai da motiv, iar ultima paza e cea din r17 (textul vizibil ed.inner_text(), apoi o citire separata a paginii)
    def paza_r17(pg, text):
        ed = mod._editor_unic(pg)
        mod.verifica_ciorna(ed.inner_text(), text, mod._paza_ciorna(pg, "inainte_de_enter"))
    with mock.patch.object(mod, "_text_editor", lambda ed: ("", None)), mock.patch.object(mod, "_ultima_paza", paza_r17):
        yield


class TestStructuraCiorna(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def refuz(self, html, mod=gp):
        i = self.an(html, mod)
        with self.assertRaises(mod.GemEroare) as c:
            mod.verifica_fara_atasamente(i, 0, "t")
        return i, c.exception

    def nod_html(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def test_ciorna_goala_reala_trece(self):
        # fixture-urile ciornei goale din testele existente + controalele legitime: 0 necunoscute, paza trece
        for html in (pagina(), pagina(conversatie=CONV_IMAGINI * 2), pagina(conversatie=CONV_IMAGINI, extra_zona=GOALA_CU_CONTROALE),
                     '<html><body><input-area-v2><input-container>' + EDITOR_HTML + '</input-container></input-area-v2></body></html>'):
            i = self.an(html)
            self.assertEqual((i["atasamente"], i["semne"], i["necunoscute"]), (0, 0, 0), msg=i["necunoscute_detalii"])
            self.assertEqual(gp.verifica_fara_atasamente(i, 0, "t"), 0)

    def test_cazul_din_verdict_refuzat(self):
        i, e = self.refuz(zona_cu(CARD_VERDICT))
        self.assertEqual((i["atasamente"], i["semne"]), (0, 0))          # exact ce a gasit Jakarinos: 0 / 0
        self.assertEqual(e.cod, "ciorna_necunoscuta")
        self.assertIn("nerecunoscute in zona ciornei - nu trimit", e.detaliu)
        self.assertEqual(i["necunoscute_detalii"],
                         ["element:attachment-card", "text_fisier:a.txt", "eticheta:button[aria-label=remove attachment]", "text:x"])

    def test_fiecare_structura_necunoscuta_refuzata(self):
        for k, extra in sorted(NECUNOSCUTE.items()):
            i, e = self.refuz(zona_cu(extra))
            self.assertEqual(e.cod, "ciorna_necunoscuta", msg=k)
            self.assertGreaterEqual(i["necunoscute"], 1, msg=k)

    def test_motivele_sunt_cele_asteptate(self):
        # motivul primului element nerecunoscut, scris de mana pentru fiecare caz
        # r4: eticheta de scoatere / cu "file" e semnal (eticheta:), verificat inaintea listelor, nu "element necunoscut"
        asteptat = {
            "img": "media:img[src]",
            "buton_remove": "eticheta:button[aria-label=remove file]",
            "buton_sterge_ro": "eticheta:button[aria-label=sterge fisierul]",
            "text_cu_extensie": "text_fisier:raport final.pdf",
            "text_cu_extensie_ro": "text_fisier:fisier_t.docx",
            "text_necunoscut": "text_atasament:incarcat",      # r4: "incarca" e cuvant de atasament in text (nu text calibrabil)
            "card_fara_text": "element:attachment-card",
            "clasa_atasament": "token_attach:div{attachment-thumb}",
            "atribut_fisier": "token_file:div{data-file-id}",
            "fundal_miniatura": "fundal:div",
            "rol_listitem": "element:div[role=listitem]",
            "div_clickabil": "element:div[jsaction]",
            "div_etichetat": "element:div[aria-label=a]",
            "canvas": "media:canvas",
            "video": "media:video[src]",
            "ligatura_fisier": "text_atasament:attach_file",
            "input_ascuns": "eticheta:input[type=file]",
        }
        for k, m in asteptat.items():
            self.assertEqual(self.an(zona_cu(NECUNOSCUTE[k]))["necunoscute_detalii"][0], m, msg=k)

    def test_in_editor_doar_text(self):
        # in editor intra brief-ul (text, comparat separat): o imagine sau un card in editor = refuz
        # r7: media in editor = acelasi semnal "media:" ca oriunde, cu prefixul contextului (nu mai exista un motiv "media_in_editor")
        # r18: + motivul formei Quill (_text_editor), al doilea strat, scris de mana
        for ed, m in ((EDITOR_HTML.replace("<p>ciorna</p>", '<p>ciorna<img src="x"></p>'), ["semnal_in_editor:media:img[src]", "editor_structura:img in p"]),
                      (EDITOR_HTML.replace("<p>ciorna</p>", "<p>ciorna</p><attachment-card></attachment-card>"),
                       ["element_in_editor:attachment-card", "editor_structura:attachment-card direct in editor"])):
            i, e = self.refuz(zona_cu(editor=ed))
            self.assertEqual((e.cod, i["necunoscute_detalii"]), ("ciorna_necunoscuta", m))
        # textul brief-ului (cu nume de fisiere, linii) NU e verificat aici (comparat separat)
        ed = EDITOR_HTML.replace("<p>ciorna</p>", "<p>vezi raport.pdf</p><p><br></p><p>x a.txt</p>")
        self.assertEqual(self.an(zona_cu(editor=ed))["necunoscute"], 0)
        # r18: formatarea (r2-r17 tolera strong / em / span...) nu mai e permisa in editor: doar p / br (refuz fals, sigur)
        ed = EDITOR_HTML.replace("<p>ciorna</p>", "<p>vezi raport.pdf</p><p><br></p><p><strong>x</strong> a.txt</p>")
        self.assertEqual(self.an(zona_cu(editor=ed))["necunoscute_detalii"], ["element_in_editor:strong", "editor_structura:strong in p"])

    def test_langa_editor_in_rich_textarea(self):
        ed = EDITOR_HTML.replace("</rich-textarea>", "<span>b.docx</span></rich-textarea>")
        i, e = self.refuz(pagina(editor=ed))
        self.assertEqual(i["necunoscute_detalii"], ["text_fisier:b.docx"])

    def test_ordinea_codurilor(self):
        # chip -> ciorna_cu_atasamente (ca inainte); fara zona -> ciorna_necitibila; necunoscutul vine ultimul
        self.assertEqual(self.refuz(pagina(["a.txt"], extra_zona=CARD_VERDICT))[1].cod, "ciorna_cu_atasamente")
        self.assertEqual(self.refuz('<html><body>' + CARD_VERDICT + '</body></html>')[1].cod, "ciorna_necitibila")

    def test_semnatura_si_ascii(self):
        # scrise de mana: ordinea atributelor = SEMN_ATR_VALOARE apoi SEMN_ATR_CHEIE; diacritice scoase, litere mici
        a = gp._Arbore()
        a.feed('<button tabindex="0" type="button" aria-label="  \u0218terge   Fi\u0219ierul " jsaction="x"></button>')
        self.assertEqual(gp._semnatura(a.radacina.copii[0]), "button[aria-label=sterge fisierul][type=button][tabindex][jsaction]")
        self.assertEqual(gp._ascii("A\u00a0\u0103\u00ee\u021b\n b"), "a ait b")
        # caracterele de latime zero nu devin text "?" in forma ASCII; celelalte caractere necunoscute raman vizibile ("?")
        zw = "".join(map(chr, (0x200B, 0x2060, 0xFEFF)))
        self.assertEqual(gp._ascii(zw + " " + zw), "")
        # r16 (Jakarinos NO-GO r15 P3): forma ASCII goala NU mai inseamna text gol - golul se decide pe textul BRUT (doar spatii albe HTML),
        # deci un nod doar cu caractere de latime zero e text nevid = refuz, afisat in escape-uri (r3-r15: 0 necunoscute)
        self.assertEqual(self.an(zona_cu("<span>" + zw + "</span>"))["necunoscute_detalii"], ["text:\\u200b\\u2060\\ufeff"])
        self.assertEqual(self.an(zona_cu("<span>" + chr(0x2716) + "</span>"))["necunoscute_detalii"], ["text:?"])

    def test_regex_nume_de_fisier(self):
        for t in ("a.txt", "raport final.pdf", "x.tar.gz", "vezi (poza_1.jpeg)", "google.com"):
            self.assertIsNotNone(gp.RE_FISIER.search(t), t)
        for t in ("4.5 carbon", "gemini 2.5", "add_2", "ask gemini...", "carbon", "", "1.000", "v4.6.4"):
            self.assertIsNone(gp.RE_FISIER.search(t), t)

    def test_liste_albe_recunosc_doar_exact(self):
        # o intrare de calibrare (forma afisata de `stare`) recunoaste exact acel control; r16: textele / ligatura din el trec DOAR ca
        # perechi (semnatura controlului, text EXACT) din TEXTE_CUNOSCUTE (r2-r15: orice text fara semnal = eticheta lui)
        trimite_btn = ('<button aria-label="Send message" type="button" jsaction="click:x">'
                       '<mat-icon>send</mat-icon><span>Trimite</span></button>')
        sem = "button[aria-label=send message][type=button][jsaction]"
        self.assertEqual(self.an(zona_cu(trimite_btn))["necunoscute_detalii"], ["element:" + sem, "text:send", "text:trimite"])
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", (sem,)), valori_in_plus(("button", "aria-label", "Send message"),
                                                                                   ("button", "jsaction", "click:x")):
            self.assertEqual(self.an(zona_cu(trimite_btn))["necunoscute_detalii"], ["text_in_control:send", "text_in_control:trimite"])
            with mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + ((sem, "send"), (sem, "Trimite"))):
                self.assertEqual(self.an(zona_cu(trimite_btn))["necunoscute"], 0)
                # aceleasi texte in alt loc (in afara controlului / in butonul modelului) = refuz: perechea, nu textul
                self.assertEqual(self.an(zona_cu("<span>Trimite</span>"))["necunoscute_detalii"], ["text:trimite"])
                model = ('<button data-test-id="bard-mode-menu-button" aria-label="Deschide selectorul de moduri, momentan Carbon">'
                         '<span>Trimite</span></button>')
                self.assertEqual(self.an(zona_cu(model))["necunoscute_detalii"], ["text_in_control:trimite"])
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", (sem,)), valori_in_plus(("button", "aria-label", "Send message"),
                                                                                   ("button", "jsaction", "click:x")), \
                mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + ((sem, "send"), (sem, "Trimite"))):
            # r15: valoarea din lista alba e comparata pe Unicode EXACT: aceeasi semnatura ASCII, alt text brut = refuz
            for alt in ("send message", "Send  message", " Send message", "Send message\u200b", "SEND MESSAGE"):
                self.assertEqual(self.an(zona_cu(trimite_btn.replace("Send message", alt)))["necunoscute_detalii"],
                                 ["atribut_valoare:" + gp._semnatura(self.nod_html(trimite_btn.replace("Send message", alt))) + "{aria-label}"], msg=alt)
            # alt buton, alta eticheta / alt atribut = tot necunoscut (r16: + textele lui, in afara oricarui control: 1 + 2)
            self.assertEqual(self.an(zona_cu(trimite_btn.replace("Send message", "Send")))["necunoscute"], 3)
            self.assertEqual(self.an(zona_cu(trimite_btn.replace(' type="button"', "")))["necunoscute"], 3)
            # un nume de fisier in controlul recunoscut = refuz; un element necunoscut in el = refuz
            self.assertEqual(self.an(zona_cu(trimite_btn.replace("Trimite", "a.txt")))["necunoscute_detalii"], ["text_fisier:a.txt"])
            self.assertEqual(self.an(zona_cu(trimite_btn.replace("<span>", "<attachment-card></attachment-card><span>")))
                             ["necunoscute_detalii"], ["element:attachment-card"])
        # structura cunoscuta: elementul trece, dar continutul lui se verifica in continuare
        with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", ("toolbox-drawer",)):
            self.assertEqual(self.an(zona_cu("<toolbox-drawer><div></div></toolbox-drawer>"))["necunoscute"], 0)
            self.assertEqual(self.an(zona_cu("<toolbox-drawer><span>a</span></toolbox-drawer>"))["necunoscute_detalii"], ["text:a"])
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + ((gp.LOC_ZONA, "Gemini poate gre\u0219i"),)):   # r16: (loc, text)
            self.assertEqual(self.an(zona_cu("<div>Gemini poate gre\u0219i</div>"))["necunoscute"], 0)
            self.assertEqual(self.an(zona_cu("<div>\n  Gemini poate gre\u0219i \t</div>"))["necunoscute"], 0)   # r15: spatii HTML la capete
            # r15: textul comparat pe Unicode EXACT (r14: dupa _ascii): alta forma = text necunoscut
            for alt in ("Gemini poate gresi", "gemini poate gre\u0219i", "Gemini  poate gre\u0219i", "Gemini poate gre\u015fi",
                        "\u00a0Gemini poate gre\u0219i", "Gemini poate gre\u0219i\u200b"):
                self.assertEqual(self.an(zona_cu("<div>" + alt + "</div>"))["necunoscute_detalii"], ["text:" + gp._ascii(alt)], msg=alt)

    def test_butonul_de_incarcare_se_poate_recunoaste(self):
        # butonul real de incarcare (calibrare: "Incarcare si instrumente", doar iconita, fara text) se recunoaste exact: cuvintele
        # de incarcare sunt singurele permise in eticheta. r4: un invelis cu clasa "upload-..." (cuvant de atasament), o eticheta
        # cu "file" sau o ligatura "attach_file" in control sunt semnale si NU se mai pot acoperi de nicio lista alba
        inc = ('<div class="upload-wrapper ng-tns-c1-2"><button aria-label="Open upload file menu">'
               '<mat-icon>attach_file</mat-icon></button></div>')
        asteptat = ["token_upload:div{upload-wrapper}", "eticheta:button[aria-label=open upload file menu]", "text_atasament:attach_file"]
        self.assertEqual(self.an(zona_cu(inc))["necunoscute_detalii"], asteptat)
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", ("button[aria-label=open upload file menu]",)), \
                mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", ("div{upload-wrapper}", "div{upload-preview}")):
            self.assertEqual(self.an(zona_cu(inc))["necunoscute_detalii"], asteptat)
            self.assertEqual(self.an(zona_cu('<div class="upload-preview"></div>'))["necunoscute_detalii"],
                             ["token_upload:div{upload-preview}"])
        real = '<button aria-label="\u00cenc\u0103rcare \u0219i instrumente"><gem-icon><svg><path></path></svg></gem-icon></button>'
        self.assertEqual(self.an(zona_cu(real))["necunoscute"], 0)
        self.assertEqual(self.an(zona_cu(real.replace("instrumente", "fi\u0219iere")))["necunoscute_detalii"],
                         ["eticheta:button[aria-label=incarcare si fisiere]"])
        # o intrare "div" goala nu dezactiveaza verificarea cuvintelor pe toate div-urile
        with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", ("div", "div{}")):
            self.assertEqual(self.an(zona_cu(NECUNOSCUTE["clasa_atasament"]))["necunoscute"], 1)

    def test_lista_alba_nu_poate_acoperi_atasamente(self):
        # chiar daca cineva trece din greseala in lista alba un buton "Remove" sau o imagine, refuzul ramane
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", ("button[aria-label=remove attachment]", "img[src]")), \
                mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", ("div[aria-label=fisier.pdf]",)):
            for extra, m in (('<button aria-label="Remove attachment"></button>', "eticheta:button[aria-label=remove attachment]"),
                             ('<img src="x">', "media:img[src]"),
                             ('<div aria-label="fisier.pdf"></div>', "eticheta:div[aria-label=fisier.pdf]")):
                self.assertEqual(self.an(zona_cu(extra))["necunoscute_detalii"], [m], msg=extra)

    def test_listele_livrate_si_locatorul(self):
        # listele albe livrate nu contin nimic ce seamana a fisier / scoatere (calibrarea le poate completa, nu cu astfel de intrari):
        # valorile din semnaturi (aria-label etc.) trec regula etichetei, tagurile n-au cuvinte de scoatere / previzualizare
        texte_livrate = tuple(t for _, t in gp.TEXTE_CUNOSCUTE)          # r16: perechi (loc, text)
        for x in gp.CONTROALE_CUNOSCUTE + gp.STRUCTURA_CUNOSCUTA + texte_livrate:
            self.assertIsNone(gp._nume_fisier(gp._ascii(x)), x)          # nume.extensie (domeniul firmei nu e fisier, r3)
            self.assertNotIn("{", x)                                      # r4: niciun element cu cuvant de atasament (token_) in liste
        for x in gp.CONTROALE_CUNOSCUTE + gp.STRUCTURA_CUNOSCUTA:
            self.assertEqual(x, gp._ascii(x), x)                          # semnaturile = forma afisata de `stare` (ASCII, litere mici)
        for x in texte_livrate:                                           # r15: textele = sirurile Unicode EXACTE (nu forma ASCII)
            self.assertEqual(x, x.strip(" \t\n\r\f"), x)
            self.assertEqual(x, " ".join(x.split()), x)
        for x in gp.CONTROALE_CUNOSCUTE + gp.STRUCTURA_CUNOSCUTA:
            for v in re.findall(r"\[[^=\]]+=([^\]]*)\]", x):
                self.assertIsNone(gp._cuvant(v, gp.TOKENI_ETICHETA_INTERZISA), x)
            self.assertIsNone(gp._cuvant(x.split("[", 1)[0], gp.TOKENI_ELIMINA + ("preview", "previz", "thumb", "miniatur")), x)
        for x in texte_livrate:
            self.assertIsNone(gp._cuvant(x), x)
        # r3: listele = EXACT reuniunea semnaturilor din calibrarea de pe 21.11.2026 (cele trei iesiri `stare`, copiate mai jos),
        # fara linia text_fisier (regula RUNBOOK: nu se trece niciodata) si - r4 - fara linia token_ (un element cu cuvant de
        # atasament nu poate fi acceptat de nicio lista; sursa cuvantului se citeste din pagina, RUNBOOK pasul 0); in plus textul
        # intreg al avertismentului Workspace (P2), copiat din fisierul citit de chat; fiecare semnatura intr-o singura lista
        toate = set(CALIBRARE_I + CALIBRARE_II + CALIBRARE_III)
        elemente = set(l.split(":", 1)[1] for l in toate if l.startswith("element:"))
        texte = set(l.split(":", 1)[1] for l in toate if l.startswith("text:"))
        neacceptate = [l for l in toate if l.startswith("token_")]
        self.assertEqual(neacceptate, ["token_file:div{text-input-field simplified-input-area}"])
        # r11: + singura linie `element:` din refuzul cu brief lung de pe 23.11 (STARE_23_11, copiata din jurnal): butonul "Ecran complet"
        self.assertEqual([l for l in STARE_23_11 if l.startswith("element:")], [STARE_23_11[1]])
        self.assertEqual(set(gp.CONTROALE_CUNOSCUTE) | set(gp.STRUCTURA_CUNOSCUTA), elemente | {STARE_23_11[1].split(":", 1)[1]})
        # r15: textele (Unicode exact) dau prin _ascii exact liniile `text:` din calibrare + avertismentul; avertismentul e EXACT sirul citit
        # r16: + "Carbon" (butonul modelului, captura netaiata 23.11 - in calibrarea 21.11 textele butonului de model nu se afisau)
        self.assertEqual(set(gp._ascii(x) for x in texte_livrate), texte | {gp._ascii(AVERTISMENT_TEXT), "carbon"})
        self.assertIn(AVERTISMENT_TEXT, texte_livrate)
        # r16: perechile EXACTE (loc, text), scrise de mana: fiecare text doar pe locul pe care a fost vazut
        self.assertEqual(set(gp.TEXTE_CUNOSCUTE), {("buton_model", "Carbon"), ("hallucination-disclaimer", AVERTISMENT_TEXT),
                                                   ("a[data-test-id=footer-privacy-notice-link][href]", TEXT_LINK_REAL),
                                                   ("a[data-test-id=footer-privacy-notice-link][href]", TEXT_ASCUNS_REAL)})
        self.assertEqual(set(gp.CONTROALE_CUNOSCUTE) & set(gp.STRUCTURA_CUNOSCUTA), set())
        self.assertEqual(len(gp.CONTROALE_CUNOSCUTE) + len(gp.STRUCTURA_CUNOSCUTA) + len(gp.TEXTE_CUNOSCUTE), 6 + 23 + 4)
        # controalele = doar butoane si linkuri; tot ce e invelis sta in STRUCTURA (continutul lui se verifica mai departe)
        self.assertTrue(all(x.startswith(("button[", "a[")) for x in gp.CONTROALE_CUNOSCUTE), gp.CONTROALE_CUNOSCUTE)
        self.assertFalse(any(x.startswith(("button[", "a[")) for x in gp.STRUCTURA_CUNOSCUTA), gp.STRUCTURA_CUNOSCUTA)
        self.assertTrue(any(l.startswith("text_fisier:chaturile gazpet.ro") for l in CALIBRARE_III))
        self.assertEqual([x for x in texte_livrate if "Chaturile" in x], [AVERTISMENT_TEXT])
        # L19: semnul locator (vede si shadow DOM) = aceleasi media + aceleasi etichete de scoatere ca analiza HTML
        self.assertEqual(gp.SEMN_EXTRA, 'img, picture, video, audio, canvas, object, embed, iframe, image, source, track, '
                         '[aria-label*="remove" i], [aria-label*="elimin" i], [aria-label*="terge" i], [aria-label*="delete" i]')
        self.assertTrue(all(t in gp.TOKENI_ATAS or t == "terge" for t in gp.TOKENI_ELIMINA))
        # r5: singurul marcaj acceptat = cel citit din pagina reala (scris de mana din token_file_atribute.txt), nimic altceva; numele lui
        # contine chiar cuvantul "file", de aceea nu poate sta in nicio lista alba si are regula lui, legata de element si de valoarea goala
        # r8: + marcajul vazut la 5a pe 22.11.2026 (stare_22_11_dupa_instalare.txt, linia 1); r9: cu valoarea EXACTA citita de chat din pagina
        # (atribute_complete_22_11.txt) si element izolat; cele trei exceptii r9 sunt EXACT atributele reale (scrise de mana din acel fisier)
        # r10: + campul `goale` - pe indicator doar `style` (gol / spatii albe HTML; 5g, atribute_5g_22_11.txt), pe div-ul r5 nimic
        # r11: al doilea camp = lista multimilor de clase acceptate; pe div: CLASE_DIV_DROP (scrisa de mana mai jos: CLASE_DIV_DROP_ASTEPTATE)
        self.assertEqual([(t, c, n, f.pattern, iz, g) for t, c, n, f, iz, g in gp.MARCAJE_PERMISE],
                         [("div", CLASE_DIV_DROP_ASTEPTATE, "xapfileselectordropzone", "", False, ()),
                          ("file-drop-indicator", ((),), "data-filedrop-id", re.escape("chat-window-input-container"), True, ("style",))])
        self.assertIs(gp.MARCAJE_PERMISE[0][1], gp.CLASE_DIV_DROP)
        self.assertEqual(gp.VALOARE_SPATII.pattern, "[ \\t\\n\\r\\f]*")
        self.assertEqual(gp.VALORI_PERMISE, (("gem-icon-button", "arialabel", ARIALABEL_REAL, (("ariahaspopup", "menu"),)),))   # r15: Unicode exact
        self.assertEqual(gp.CLASE_EDITOR_PERMISE, ("input-url-linkification-enabled", "inline-chips-enabled"))
        self.assertEqual(gp._cuvant("xapfileselectordropzone"), "file")
        self.assertEqual(gp._cuvant("data-filedrop-id"), "file")
        self.assertEqual(gp._cuvant("incarcare si instrumente"), "incarca")
        self.assertEqual(gp._cuvant("inline-chips-enabled"), "chip")
        self.assertIsNone(gp._cuvant("input-url-linkification-enabled"))        # n-are cuvant: scutirea lui e declarativa (brief), fara efect azi
        self.assertIsNone(gp._cuvant("chat-window-input-container"))
        self.assertEqual(gp.HREF_GAZDE_FARA_FISIER, ("google.com",))

    def test_stare_afiseaza_semnaturile(self):
        pg = FakePg(zona_cu(CARD_VERDICT))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(pg)
        linii = out.getvalue().splitlines()
        self.assertIn("necunoscute in zona: 4", linii)
        self.assertIn("  necunoscut element:attachment-card", linii)
        self.assertTrue(any(l.startswith("paza ciorna: REFUZ ciorna_necunoscuta stare: 4 element(e)") for l in linii), linii)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(zona_cu()))
        self.assertIn("necunoscute in zona: 0", out.getvalue().splitlines())
        self.assertIn("paza ciorna: OK (trimite ar continua)", out.getvalue().splitlines())


class TestTrimiteStructura(unittest.TestCase):
    def test_necunoscut_in_tab_curent_refuz_fara_nicio_actiune(self):
        for k, extra in sorted(NECUNOSCUTE.items()):
            cod, act = ruleaza_trimite(gp, FakePg(zona_cu(extra)))
            self.assertEqual((cod, act), ("ciorna_necunoscuta", []), msg=k)

    def test_necunoscut_pe_chatul_nou_refuz_inainte_de_click(self):
        cod, act = ruleaza_trimite(gp, FakePg(zona_cu(), dupa_goto=zona_cu(CARD_VERDICT)))
        self.assertEqual((cod, act), ("ciorna_necunoscuta", ["goto"]))

    def test_necunoscut_aparut_dupa_scriere_fara_enter(self):
        cod, act = ruleaza_trimite(gp, FakePg(zona_cu(), dupa_scriere=zona_cu(CARD_VERDICT)))
        self.assertEqual(cod, "ciorna_necunoscuta")
        self.assertIn("insert", act)
        self.assertNotIn("press Enter", act)

    def test_ciorna_goala_cu_controale_trimite(self):
        cod, act = ruleaza_trimite(gp, FakePg(zona_cu(), dupa_goto=zona_cu()))
        self.assertIsNone(cod)
        self.assertEqual(act, ["goto", "click", "press Control+A", "press Delete", "insert", "press Enter"])


class TestMutantiStructura(unittest.TestCase):
    # fiecare mutant scoate o parte a verificarii pozitive; scenariul lui trece la Enter pe mutant si e refuzat pe cod
    def verifica(self, inlocuiri, extra):
        cod, act = ruleaza_trimite(gp, FakePg(zona_cu(extra)))
        self.assertEqual((cod, act), ("ciorna_necunoscuta", []))
        mut = mutant(inlocuiri)
        cod_m, act_m = ruleaza_trimite(mut, FakePg(zona_cu(extra)))
        self.assertIsNone(cod_m)
        self.assertIn("press Enter", act_m)

    def test_fara_verificarea_pozitiva_cazul_din_verdict_pleaca(self):
        # mutantul = comportamentul de pe 51b659c4 (0 chip-uri + 0 semne = goala); cazul din verdict trimite brief-ul
        self.verifica([('    if info["necunoscute"]:', "    if False:")], CARD_VERDICT)

    def test_fara_regula_de_element(self):
        # r16: cardul gol (fara ligatura "close", refuzata acum independent ca text - al doilea strat - si pe mutant)
        self.verifica([('return "element:" + sem, ctrl', "return None, ctrl")], "<attachment-card></attachment-card>")

    def test_fara_regula_de_text(self):
        # (nume cu extensie fara cuvant de atasament: ".pdf" ar fi prins si de regula cuvintelor, ramasa in mutant)
        self.verifica([('return "text_fisier:" + v', "return None"),
                       ('    return ("text_in_control:" if ctrl is not None else "text:") + v', "    return None")],
                      "<div><span>raport final.docx</span></div>")

    def test_fara_regula_de_cuvinte(self):
        # mutant: clasele / id-ul / numele atributelor nu se mai cauta dupa cuvinte de atasament. r15: clasa `attachment-thumb` nu e in
        # lista alba a claselor (al doilea strat, independent), deci mutantul se judeca pe regula LUI, cu lista alba oprita doar in el
        extra = NECUNOSCUTE["clasa_atasament"]
        self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []))
        mut = mutant([('    t = _cuvant(clase_id + " " + nume_atribute)', "    t = None")])
        self.assertEqual(gp.analizeaza_ciorna(zona_cu(extra))["necunoscute_detalii"], ["token_attach:div{attachment-thumb}"])
        self.assertEqual(mut.analizeaza_ciorna(zona_cu(extra))["necunoscute_detalii"], ["atribut_valoare:div{class}"])   # stratul 2
        with fara_r13(mut):
            cod_m, act_m = ruleaza_trimite(mut, FakePg(zona_cu(extra)))
        self.assertIsNone(cod_m)
        self.assertIn("press Enter", act_m)


# --- v4.6.4 r3: calibrarea de pe 21.11.2026 (RUNBOOK pasul 0) - liniile `necunoscut ...` copiate EXACT din cele trei iesiri `stare`
# ale copiei neinstalate a lui ae3e8947 (listele albe goale): sursa independenta a listelor livrate si a fixture-urilor de mai jos ---
CALIBRARE_I = (                                   # (i) chat nou (/app), ciorna goala: 27
    "element:span[role=status]",
    "element:back-to-bottom-fab",
    "element:button[aria-label=deruleaza in jos][type=button][tabindex]",
    "element:gem-icon",
    "element:file-drop-indicator",
    "element:auto-suggest",
    "element:fieldset[role=none]",
    "token_file:div{text-input-field simplified-input-area}",
    "element:simplified-input-menu",
    "element:gem-icon-button[type=onsurface]",
    "element:button[aria-label=incarcare si instrumente]",
    "element:gem-icon",
    "element:toolbox-drawer",
    "element:div[data-test-id=textarea-inner]",
    "element:div[data-test-id=textarea-wrapper]",
    "element:at-mentions-menu-v2",
    "element:bard-mode-switcher",
    "element:div[role=group]",
    "element:div[data-test-id=logo-pill-label-container]",
    "element:gem-icon",
    "element:gem-popover",
    "element:speech-dictation-mic-button",
    "element:gem-icon-button[type=onsurface][aria-describedby]",
    "element:button[aria-label=dicteaza (^?d)]",
    "element:gem-icon",
    "element:hallucination-disclaimer",
    "element:p[data-test-id=empty-disclaimer]",
)
TRIMITE_II = (                                    # in plus in (ii), acelasi chat cu cuvantul "proba" in ciorna, fara Enter: 31
    "element:div[data-test-id=send-button-container][aria-describedby]",
    "element:gem-icon-button[type=onsurface]",
    "element:button[aria-label=trimite mesajul]",
    "element:gem-icon",
)
CALIBRARE_II = CALIBRARE_I[:25] + TRIMITE_II + CALIBRARE_I[25:]
AVERTISMENT_III = (                               # in (iii), chat existent gol, in locul paragrafului gol: textul de confidentialitate
    "text_fisier:chaturile gazpet.ro nu sunt folosite pen",      # taiat la 40 de caractere de versiunea r2 a lui `stare`
    "element:a[data-test-id=footer-privacy-notice-link][href]",
    "element:span[data-test-id=content]",
    "text:confidentialitatea ta si gemini",
    "text:se deschide intr-o fereastra noua",
)
CALIBRARE_III = CALIBRARE_I[:4] + ("element:prompt-flow-bar",) + CALIBRARE_I[4:26] + AVERTISMENT_III
assert (len(CALIBRARE_I), len(CALIBRARE_II), len(CALIBRARE_III)) == (27, 31, 32)

# r4: textul INTREG al avertismentului Workspace, copiat din ce a citit chatul pe 21.11.2026 din pagina reala (element
# hallucination-disclaimer, chat existent): paragraful dinaintea linkului "Confidentialitatea ta si Gemini" (sursa independenta)
AVERTISMENT_TEXT = ("Chaturile Gazpet.ro nu sunt folosite pentru a ne \u00eembun\u0103t\u0103\u021bi modelele. Gemini este un AI \u0219i poate "
                    "s\u0103 fac\u0103 gre\u0219eli, inclusiv \u00een leg\u0103tur\u0103 cu persoane.")
# r15: textele linkului, Unicode EXACT (paw_v464_calibrare\avertisment_workspace.txt, scrise de mana)
TEXT_LINK_REAL = "Confiden\u021bialitatea ta \u0219i Gemini"
TEXT_ASCUNS_REAL = "Se deschide \u00eentr-o fereastr\u0103 nou\u0103"
# r5: atributele REALE ale div-ului editorului, copiate din ce a citit chatul din pagina reala pe 21.11.2026 (doar citire, chat nou gol;
# paw_v464_calibrare\token_file_atribute.txt): `_ngcontent-ng-c1694197906=""`, `xapfileselectordropzone=""`, `class="text-input-field
# simplified-input-area"`, `jslog="303810;track:impression"`. Cuvantul "file" vine din NUMELE `xapfileselectordropzone` (valoare goala).
ATRIBUTE_DIV_REALE = ' _ngcontent-ng-c1694197906="" xapfileselectordropzone="" jslog="303810;track:impression"'
ATRIBUT_FILE_IPOTETIC = ' filedroptarget=""'                                             # presupunerea din r4 (gresita): ramane refuzata
TOKEN_FILE_R3 = "token_file:div{text-input-field simplified-input-area}"                 # linia din calibrare (afisarea r3)
# aceeasi linie cu numele atributelor afisate (r4+), pe div-ul real: numele din afara semnaturii, sortate, fara cele generate (_ng...)
TOKEN_FILE_R4 = "token_file:div{text-input-field simplified-input-area jslog xapfileselectordropzone}"
TOKEN_FILE_IPOTETIC = "token_file:div{text-input-field simplified-input-area filedroptarget}"
# r6: atributele REALE ale elementului zonei <input-area-v2>, copiate din ce a citit chatul din pagina reala pe 21.11.2026 (doar citire,
# paw_v464_calibrare\link_si_zona.txt, aceleasi pe chat nou si pe chat existent): `_ngcontent-ng-c1796725376=""`, `trace=""`,
# `_nghost-ng-c1694197906=""`, `class="ng-tns-c1694197906-4 ui-improvements-phase-1 with-toolbox-drawer input-box-shadow discovery-feed-the"`
# - valoarea clasei a fost citita TAIATA la 100 de caractere (ultimul cuvant, "discovery-feed-the", e un prefix al clasei reale); restul
# clasei nu e cunoscut si se confirma la 5a (`stare` ar arata `token_...:input-area-v2{...}` daca ar contine un cuvant de atasament).
# r15: lista alba a claselor cere token-uri INTREGI, deci fixture-ul foloseste token-ul intreg "discovery-feed-theme" (citit intreg pe t23,
# stare_text_lung_23_11.json, ZONA_2311_ATR); prefixul taiat "discovery-feed-the" ar fi (corect) un token necunoscut.
ZONA_ATRIBUTE_REALE = (' _ngcontent-ng-c1796725376="" trace="" _nghost-ng-c1694197906="" '
                       'class="ng-tns-c1694197906-4 ui-improvements-phase-1 with-toolbox-drawer input-box-shadow discovery-feed-theme"')
# r6: href-ul REAL al linkului "Confidentialitatea ta si Gemini" (chat existent; pe chat nou linkul nu exista), citit de chat pe 21.11.2026
HREF_REAL = "https://support.google.com/gemini/answer/14620100"


def pagina_calibrare(stare, atribut_file=ATRIBUTE_DIV_REALE, zona_atr=ZONA_ATRIBUTE_REALE, editor_atr=""):
    # pagina sintetica scrisa de mana ca sa reproduca EXACT liniile de mai sus (ordinea = parcurgerea in adancime a zonei);
    # r6: zona are atributele reale, linkul are href-ul real; r7: editor_atr = atribute in plus pe elementul editorului insusi
    assert stare in ("i", "ii", "iii")
    gi = "<gem-icon><svg><path></path></svg></gem-icon>"
    editor = ('<rich-textarea class="text-input-field_textarea"><div class="ql-editor textarea" contenteditable="true" role="textbox"'
              + editor_atr + ">" + ("<p>proba</p>" if stare == "ii" else "<p><br></p>") + "</div></rich-textarea>")
    trimite = ""
    if stare == "ii":
        trimite = ('<div data-test-id="send-button-container" aria-describedby="cdk-describedby-message-ng-1-7"><gem-icon-button type="onSurface">'
                   '<button aria-label="Trimite mesajul">' + gi + "</button></gem-icon-button></div>")
    if stare == "iii":
        avertisment = (AVERTISMENT_TEXT + ' <a data-test-id="footer-privacy-notice-link" href="' + HREF_REAL + '">'
                       '<span data-test-id="content">' + TEXT_LINK_REAL + '</span>'
                       '<span>' + TEXT_ASCUNS_REAL + '</span></a>')
    else:
        avertisment = '<p data-test-id="empty-disclaimer"></p>'
    return ('<!DOCTYPE html><html><body><chat-app><main><div class="conversation-container"></div>'
            '<input-area-v2' + zona_atr + '><div class="text-input-field-main-area">'
            '<span role="status"></span>'
            '<back-to-bottom-fab><button aria-label="Deruleaz\u0103 \u00een jos" type="button" tabindex="0">' + gi + "</button></back-to-bottom-fab>"
            + ("<prompt-flow-bar></prompt-flow-bar>" if stare == "iii" else "")
            + '<file-drop-indicator></file-drop-indicator><auto-suggest></auto-suggest>'
            '<fieldset role="none"><div class="text-input-field ng-tns-c12-3 simplified-input-area ng-star-inserted"' + atribut_file + ">"
            '<simplified-input-menu><gem-icon-button type="onSurface"><button aria-label="\u00cenc\u0103rcare \u0219i instrumente">' + gi
            + "</button></gem-icon-button></simplified-input-menu><toolbox-drawer></toolbox-drawer>"
            '<div data-test-id="textarea-inner"><div data-test-id="textarea-wrapper">' + editor + "</div></div>"
            "<at-mentions-menu-v2></at-mentions-menu-v2>"
            '<bard-mode-switcher><div role="group"><button data-test-id="bard-mode-menu-button" aria-label="Deschide selectorul de moduri, momentan Carbon">'
            '<div data-test-id="logo-pill-label-container"><span class="ng-star-inserted">Carbon</span></div>' + gi
            + "</button><gem-popover></gem-popover></div></bard-mode-switcher>"
            '<speech-dictation-mic-button><gem-icon-button type="onSurface" aria-describedby="cdk-describedby-message-ng-1-2">'
            '<button aria-label="Dicteaz\u0103 (^\u21e7D)">' + gi + "</button></gem-icon-button></speech-dictation-mic-button>"
            + trimite + "</div></fieldset>"
            "<hallucination-disclaimer>" + avertisment + "</hallucination-disclaimer>"
            "</div></input-area-v2></main></chat-app></body></html>")


# r16: TEXTE_CUNOSCUTE pastreaza in "listele goale" DOAR textul butonului modelului: la calibrarea din 21.11 textele din butonul modelului
# (verificat separat, verifica_model) nu se afisau - orice text de acolo era eticheta lui; restul listelor = goale, ca la ae3e8947
LISTE_GOALE = dict(CONTROALE_CUNOSCUTE=(), STRUCTURA_CUNOSCUTA=(), TEXTE_CUNOSCUTE=(("buton_model", "Carbon"),))   # = LOC_MODEL, scris de mana
FARA_MARCAJ = dict(MARCAJE_PERMISE=())                        # r5: fara regula marcajului = comportamentul r4 pe div-ul real
ACTIUNI_TRIMITERE = ["goto", "click", "press Control+A", "press Delete", "insert", "press Enter"]


class TestCalibrare(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def test_fixture_urile_reproduc_iesirile_stare(self):
        # cu listele albe goale (= ae3e8947) si fara regula marcajului (r5), paginile sintetice cu atributele REALE ale div-ului dau
        # EXACT liniile copiate din cele trei fisiere, in aceeasi ordine; textul avertismentului e taiat la 40 ca in r2, ca sa se
        # compare cu linia copiata. Singura linie care difera ca afisare: token_file - r4+ arata si numele atributelor (jslog,
        # xapfileselectordropzone), r3 nu le arata; forma r3 e prefixul celei r4
        self.assertTrue(TOKEN_FILE_R4.startswith(TOKEN_FILE_R3[:-1]))
        for stare, asteptat in (("i", CALIBRARE_I), ("ii", CALIBRARE_II), ("iii", CALIBRARE_III)):
            with mock.patch.multiple(gp, **LISTE_GOALE), mock.patch.multiple(gp, **FARA_MARCAJ), \
                    mock.patch.object(gp, "TEXT_AFISAT", 40), mock.patch.object(gp, "DOMENII_FIRMA", ()):
                i = self.an(pagina_calibrare(stare))
            self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"]), (1, 1, 0, 0), msg=stare)
            self.assertEqual(i["necunoscute_detalii"], [TOKEN_FILE_R4 if l == TOKEN_FILE_R3 else l for l in asteptat], msg=stare)
            self.assertEqual(i["necunoscute"], len(asteptat), msg=stare)

    def test_listele_livrate_recunosc_cele_trei_stari_reale(self):
        # calea legitima (L20), r5: cu atributele REALE ale div-ului (si marcajul xapfileselectordropzone=""), toate cele trei stari
        # (si chatul existent, cu textul Workspace intreg in TEXTE_CUNOSCUTE - P2) dau 0 necunoscute si `trimite` ajunge la Enter
        for atribute in (ATRIBUTE_DIV_REALE, ' xapfileselectordropzone=""', " xapfileselectordropzone", ""):
            for stare in ("i", "ii", "iii"):
                i = self.an(pagina_calibrare(stare, atribut_file=atribute))
                self.assertEqual((i["necunoscute"], i["atasamente"], i["semne"]), (0, 0, 0), msg=(stare, atribute, i["necunoscute_detalii"]))
                self.assertEqual(gp.verifica_fara_atasamente(i, 0, "t"), 0)
                cod, act = ruleaza_trimite(gp, FakePg(pagina_calibrare(stare, atribut_file=atribute), dupa_goto=pagina_calibrare("i", atribut_file=atribute)))
                self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE), msg=(stare, atribute))

    def test_fara_regula_marcajului_div_ul_real_e_refuzat_si_afisat_cu_atribute(self):
        # = comportamentul r4 (86f6ff72) pe pagina reala: fiecare stare are EXACT un motiv - linia token_file cu numele atributelor in
        # {...} (jslog, xapfileselectordropzone; _ngcontent e generat si nu se afiseaza); refuz fara actiuni. Asa a ajuns chatul la
        # sursa cuvantului. Nici intrarea r3, nici forma completa in STRUCTURA nu-l accepta (P1 r4: lista nu acopera semnalul)
        with mock.patch.multiple(gp, **FARA_MARCAJ):
            for stare in ("i", "ii", "iii"):
                i = self.an(pagina_calibrare(stare))
                self.assertEqual(i["necunoscute_detalii"], [TOKEN_FILE_R4], msg=stare)
                self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_calibrare(stare))), ("ciorna_necunoscuta", []), msg=stare)
            with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (TOKEN_FILE_R3.split(":", 1)[1], TOKEN_FILE_R4.split(":", 1)[1])):
                self.assertEqual(self.an(pagina_calibrare("i"))["necunoscute_detalii"], [TOKEN_FILE_R4])
                self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_calibrare("i"))), ("ciorna_necunoscuta", []))
        # presupunerea r4 (atribut ipotetic `filedroptarget=""`) NU e marcajul real: ramane refuzata, cu numele ei afisat
        for stare in ("i", "ii", "iii"):
            self.assertEqual(self.an(pagina_calibrare(stare, atribut_file=ATRIBUT_FILE_IPOTETIC))["necunoscute_detalii"], [TOKEN_FILE_IPOTETIC], msg=stare)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_calibrare(stare, atribut_file=ATRIBUT_FILE_IPOTETIC))), ("ciorna_necunoscuta", []), msg=stare)

    def test_starea_iii_textul_workspace(self):
        # P2: textul intreg (copiat din pagina reala) e in TEXTE_CUNOSCUTE exact; fara el starea (iii) ar fi refuzata DOAR pe text:
        i = self.an(pagina_calibrare("iii"))
        self.assertEqual(i["necunoscute"], 0, msg=i["necunoscute_detalii"])
        self.assertIn(("hallucination-disclaimer", AVERTISMENT_TEXT), gp.TEXTE_CUNOSCUTE)       # r15: Unicode EXACT; r16: pe locul lui
        self.assertNotIn(("hallucination-disclaimer", gp._ascii(AVERTISMENT_TEXT)), gp.TEXTE_CUNOSCUTE)
        self.assertEqual(gp._ascii(AVERTISMENT_TEXT), "chaturile gazpet.ro nu sunt folosite pentru a ne imbunatati modelele. gemini este un ai "
                         "si poate sa faca greseli, inclusiv in legatura cu persoane.")
        # r15: aceeasi forma ASCII, alt text brut (fara diacritice / litere mici / spatiu dublu / NBSP in interior) = text necunoscut
        for alt in (gp._ascii(AVERTISMENT_TEXT), AVERTISMENT_TEXT.replace("AI ", "AI  "), AVERTISMENT_TEXT.replace(" ", "\u00a0", 1),
                    AVERTISMENT_TEXT.replace("\u0219", "\u015f")):
            i = self.an(pagina_calibrare("iii").replace(AVERTISMENT_TEXT, alt))
            self.assertEqual(i["necunoscute_detalii"], ["text:" + gp._ascii(alt)], msg=alt)
        # r16: acelasi text EXACT in afara invelisului lui (in zona, direct) = refuz: perechea (loc, text), nu doar textul
        i = self.an(pagina_calibrare("iii").replace("<hallucination-disclaimer>", "<hallucination-disclaimer></hallucination-disclaimer><div>")
                    .replace("</hallucination-disclaimer></div></input-area-v2>", "</div></div></input-area-v2>"))
        self.assertEqual(i["necunoscute_detalii"], ["text:" + gp._ascii(AVERTISMENT_TEXT)])
        fara = tuple(x for x in gp.TEXTE_CUNOSCUTE if x[1] != AVERTISMENT_TEXT)
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", fara):
            i = self.an(pagina_calibrare("iii"))
            self.assertEqual(i["necunoscute_detalii"], ["text:" + gp._ascii(AVERTISMENT_TEXT)])
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_calibrare("iii"))), ("ciorna_necunoscuta", []))
        # un text care contine IN PLUS un nume de fisier (sau un cuvant de atasament) ramane refuzat, chiar daca ar fi in lista
        for plus, m in ((" Vezi oferta.pdf", "text_fisier:"), (" Fisier atasat.", "text_atasament:"), (" (preview)", "text_atasament:")):
            html = pagina_calibrare("iii").replace(AVERTISMENT_TEXT, AVERTISMENT_TEXT + plus)
            i = self.an(html)
            self.assertEqual(i["necunoscute"], 1, msg=plus)
            self.assertTrue(i["necunoscute_detalii"][0].startswith(m + "chaturile gazpet.ro"), msg=i["necunoscute_detalii"])
            with mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + (("hallucination-disclaimer", AVERTISMENT_TEXT + plus),)):
                self.assertEqual(self.an(html)["necunoscute"], 1, msg=plus)
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=plus)
        # textul tot ar fi "fisier" fara regula domeniului: mutantul refuza chiar si cu textul in lista (refuz fals permanent)
        mut = mutant([("        if a[i:j] in DOMENII_FIRMA:", "        if False:")])
        self.assertTrue(self.an(pagina_calibrare("iii"), mut)["necunoscute_detalii"][0].startswith("text_fisier:chaturile gazpet.ro"))

    def test_stare_afiseaza_textul_intreg(self):
        fara = tuple(x for x in gp.TEXTE_CUNOSCUTE if x[1] != AVERTISMENT_TEXT)
        self.assertEqual(len(fara), len(gp.TEXTE_CUNOSCUTE) - 1)
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", fara):
            pg = FakePg(pagina_calibrare("iii"))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                gp.stare(pg)
        linii = out.getvalue().splitlines()
        self.assertIn("necunoscute in zona: 1", linii)
        self.assertIn("  necunoscut text:" + gp._ascii(AVERTISMENT_TEXT), linii)
        self.assertTrue(any(l.startswith("paza ciorna: REFUZ ciorna_necunoscuta") for l in linii), linii)
        # r5: cu listele livrate si regula marcajului, `stare` pe starea (i) reala (atributele reale) = 0 necunoscute, paza OK;
        # fara regula marcajului (= r4) arata exact linia token_file cu numele atributelor
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(pagina_calibrare("i")))
        self.assertIn("necunoscute in zona: 0", out.getvalue().splitlines())
        self.assertIn("paza ciorna: OK (trimite ar continua)", out.getvalue().splitlines())
        out = io.StringIO()
        with mock.patch.multiple(gp, **FARA_MARCAJ), contextlib.redirect_stdout(out):
            gp.stare(FakePg(pagina_calibrare("i")))
        self.assertIn("  necunoscut " + TOKEN_FILE_R4, out.getvalue().splitlines())

    def test_token_file_vine_din_atribut_nu_din_clasa(self):
        # clasa "text-input-field simplified-input-area" nu contine "file" (nici "simplified", nici "field"); fara atribut div-ul e
        # neutru si nu apare deloc; cu un atribut cu "file" in nume apare linia token_file, cu numele atributului (r4), si NU se poate
        # accepta prin nicio lista; alta clasa / id / data-* / alt tag = tot refuz; continutul lui se verifica in continuare
        self.assertNotIn("file", "text-input-field simplified-input-area")
        div = '<div class="text-input-field ng-tns-c12-3 simplified-input-area"%s></div>'
        with mock.patch.multiple(gp, **LISTE_GOALE):
            self.assertEqual(self.an(zona_cu(div % ""))["necunoscute"], 0)
            self.assertEqual(self.an(zona_cu(div % ATRIBUT_FILE_IPOTETIC))["necunoscute_detalii"], [TOKEN_FILE_IPOTETIC])
        self.assertEqual(self.an(zona_cu(div % ""))["necunoscute"], 0)
        self.assertEqual(self.an(zona_cu(div % ATRIBUT_FILE_IPOTETIC))["necunoscute_detalii"], [TOKEN_FILE_IPOTETIC])
        for alt, m in ((div.replace("simplified-input-area", "simplified-input-area-v2") % ATRIBUT_FILE_IPOTETIC,
                        "token_file:div{text-input-field simplified-input-area-v2 filedroptarget}"),
                       (div.replace('class="', 'id="z" class="') % ATRIBUT_FILE_IPOTETIC,
                        "token_file:div{text-input-field simplified-input-area #z filedroptarget}"),
                       (div % (ATRIBUT_FILE_IPOTETIC + ' data-file-id="1"'),
                        "token_file:div{text-input-field simplified-input-area data-file-id filedroptarget}"),
                       (div.replace("div", "span") % ATRIBUT_FILE_IPOTETIC,
                        "token_file:span{text-input-field simplified-input-area filedroptarget}"),
                       ('<div class="text-input-field simplified-input-area" data-file-id="1"></div>',
                        "token_file:div{text-input-field simplified-input-area data-file-id}"),
                       ('<div class="text-input-field simplified-input-area" data-x="oferta.docx"></div>',
                        "atribut_fisier:div{text-input-field simplified-input-area data-x}")):
            self.assertEqual(self.an(zona_cu(alt))["necunoscute_detalii"], [m], msg=alt)
        for inauntru, m in (("<span>a.txt</span>", "text_fisier:a.txt"), ('<img src="x">', "media:img[src]"),
                            ("<attachment-card></attachment-card>", "element:attachment-card"), (chip("a.txt"), None)):
            for atribute in ("", ATRIBUTE_DIV_REALE):                    # r5: si cu marcajul real, continutul div-ului se verifica
                i = self.an(zona_cu(div.replace("></div>", ">" + inauntru + "</div>") % atribute))
                if m is None:
                    self.assertEqual(i["atasamente"], 1, msg=inauntru)      # chip-ul din invelis se numara ca fisier
                else:
                    self.assertEqual(i["necunoscute_detalii"], [m], msg=inauntru)

    def test_controalele_calibrate_nu_acopera_atasamente(self):
        # un control din lista cu continut de fisier / un invelis din lista cu un buton Remove = tot refuz
        inc = '<button aria-label="\u00cenc\u0103rcare \u0219i instrumente"><span>oferta.pdf</span></button>'
        self.assertEqual(self.an(zona_cu(inc))["necunoscute_detalii"], ["text_fisier:oferta.pdf"])
        self.assertEqual(self.an(zona_cu('<toolbox-drawer><button aria-label="Remove file">x</button></toolbox-drawer>'))
                         ["necunoscute_detalii"], ["eticheta:button[aria-label=remove file]", "text:x"])
        self.assertEqual(self.an(zona_cu('<toolbox-drawer><span>Deep Research</span></toolbox-drawer>'))["necunoscute_detalii"],
                         ["text:deep research"])                       # un instrument ales = text necunoscut = refuz
        # r4: textul cu cuvant de atasament in invelisul din lista = semnal (nu "text necunoscut" calibrabil): refuz si daca ar fi in TEXTE
        status = '<span role="status">Fi\u0219ier \u00eenc\u0103rcat</span>'
        self.assertEqual(self.an(zona_cu(status))["necunoscute_detalii"], ["text_atasament:fisier incarcat"])
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + (("span[role=status]", "Fi\u0219ier \u00eenc\u0103rcat"),)):   # r16: (loc, text)
            self.assertEqual(self.an(zona_cu(status))["necunoscute_detalii"], ["text_atasament:fisier incarcat"])
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(status))), ("ciorna_necunoscuta", []))


# --- v4.6.4 r4 (Jakarinos NO-GO pe d50dda4e, P1): semnalele de atasament se verifica INAINTEA listelor albe ---
# cele doua reproduceri din verdict, copiate exact
REPRO_GEM_ICON = '<gem-icon class="attachment-card"\n          data-file-name="oferta.pdf"></gem-icon>'
REPRO_DIV = '<div class="text-input-field simplified-input-area"\n     removeattachment="oferta.pdf"></div>'
# variante: fiecare = un element din listele albe (sau neutru / structura / butonul modelului / editorul) care poarta un semnal
# pe care semnatura r3 nu il arata; asteptat (scris de mana): motivul primului necunoscut
SEMNALE = {
    # (TOKENI_ATAS se cauta in ordine: "file" inaintea lui "attach"; "pdf" e cuvant de atasament, de aceea nume.extensie "curat" = .docx)
    "repro_gem_icon": (REPRO_GEM_ICON, "token_file:gem-icon{attachment-card data-file-name}"),
    "repro_div": (REPRO_DIV, "token_attach:div{text-input-field simplified-input-area removeattachment}"),
    "gem_icon_data_file_name": ('<gem-icon data-file-name="oferta.pdf"></gem-icon>', "token_file:gem-icon{data-file-name}"),
    "gem_icon_valoare_pdf": ('<gem-icon data-x="oferta.pdf"></gem-icon>', "token_pdf:gem-icon{data-x}"),
    "gem_icon_valoare_fisier": ('<gem-icon data-x="oferta.docx"></gem-icon>', "atribut_fisier:gem-icon{data-x}"),
    "gem_icon_valoare_cuvant": ('<gem-icon data-x="attachment"></gem-icon>', "token_attach:gem-icon{data-x}"),
    "gem_icon_clasa_card": ('<gem-icon class="ng-star-inserted icon-card"></gem-icon>', "token_card:gem-icon{icon-card}"),
    "gem_icon_id": ('<gem-icon id="preview-7"></gem-icon>', "token_preview:gem-icon{#preview-7}"),
    "structura_atribut_necunoscut_pdf": ('<toolbox-drawer foo="raport.pdf"></toolbox-drawer>', "token_pdf:toolbox-drawer{foo}"),
    "structura_atribut_necunoscut_fisier": ('<toolbox-drawer foo="raport.docx"></toolbox-drawer>', "atribut_fisier:toolbox-drawer{foo}"),
    "structura_atribut_necunoscut_cuvant": ('<prompt-flow-bar removeattachment=""></prompt-flow-bar>',
                                            "token_attach:prompt-flow-bar{removeattachment}"),
    "structura_aria_description": ('<fieldset role="none" aria-description="oferta.docx"></fieldset>',
                                   "atribut_fisier:fieldset[role=none][aria-description]{}"),
    "control_clasa": ('<button aria-label="Trimite mesajul" class="send-button file-attached"></button>',
                      "token_file:button[aria-label=trimite mesajul]{send-button file-attached}"),
    "control_data_fisier": ('<button aria-label="Trimite mesajul" data-file-name="oferta.pdf"></button>',
                            "token_file:button[aria-label=trimite mesajul]{data-file-name}"),
    "control_title_fisier": ('<button aria-label="Trimite mesajul" title="oferta.pdf"></button>',
                             "eticheta:button[aria-label=trimite mesajul][title=oferta.pdf]"),
    "control_neutru_inauntru": ('<button aria-label="Trimite mesajul"><span class="attachment-thumb"></span></button>',
                                "token_attach:span{attachment-thumb}"),
    "control_ligatura_inauntru": ('<button aria-label="Trimite mesajul"><mat-icon>attach_file</mat-icon></button>',
                                  "text_atasament:attach_file"),
    "control_text_inauntru": ('<button aria-label="Trimite mesajul"><span>Fi\u0219ier ata\u0219at</span></button>',
                              "text_atasament:fisier atasat"),
    "control_text_fisier_inauntru": ('<button aria-label="Trimite mesajul"><span>oferta.pdf</span></button>', "text_fisier:oferta.pdf"),
    "link_href_fisier": ('<a data-test-id="footer-privacy-notice-link" href="blob:https://gemini.google.com/oferta.pdf"></a>',
                         "token_pdf:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "status_text": ('<span role="status">Fi\u0219ier \u00eenc\u0103rcat</span>', "text_atasament:fisier incarcat"),
    "status_data": ('<span role="status" data-file-count="1"></span>', "token_file:span[role=status]{data-file-count}"),
    "model_data_fisier": ('<button data-test-id="bard-mode-menu-button" aria-label="Deschide selectorul de moduri, momentan Carbon" data-file-name="a.pdf"></button>',
                          "token_file:button[aria-label=deschide selectorul de moduri, momentan carbon][data-test-id=bard-mode-menu-button]{data-file-name}"),
    "rich_textarea_clasa": ('<rich-textarea class="attachment-host"></rich-textarea>', "token_attach:rich-textarea{attachment-host}"),
    "fundal_pe_structura": ('<gem-icon style="background-image: url(blob:x)"></gem-icon>', "fundal:gem-icon"),
}


class TestSemnaleInainteDeListe(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def test_reproducerile_din_verdict_refuzate_fara_actiuni(self):
        for k in ("repro_gem_icon", "repro_div"):
            extra, m = SEMNALE[k]
            i = self.an(zona_cu(extra))
            self.assertEqual((i["atasamente"], i["semne"]), (0, 0), msg=k)             # ce a gasit Jakarinos: 0 / 0 ...
            self.assertEqual(i["necunoscute_detalii"], [m], msg=k)                         # ... dar acum un necunoscut
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []), msg=k)
        # si cu intrarea r3 a div-ului (plus forma ei completa) in STRUCTURA: tot refuz (P1: lista nu acopera semnalul)
        with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (TOKEN_FILE_R3.split(":", 1)[1],
                                                                                   "div{text-input-field simplified-input-area removeattachment}")):
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(REPRO_DIV))), ("ciorna_necunoscuta", []))

    def test_fiecare_semnal_refuzat_oricare_ar_fi_lista(self):
        # listele albe contin deja gem-icon, toolbox-drawer, prompt-flow-bar, fieldset[role=none], butonul de trimitere, linkul,
        # span[role=status]; in plus se adauga EXACT semnaturile variantelor (tag + atribute din semnatura): tot refuz
        semnaturi = tuple(gp._semnatura(self.nod(extra)) for extra, _ in SEMNALE.values())
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", gp.CONTROALE_CUNOSCUTE + semnaturi), \
                mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + (("span[role=status]", "Fi\u0219ier \u00eenc\u0103rcat"),
                                                                               ("button[aria-label=trimite mesajul]", "Fi\u0219ier ata\u0219at"),
                                                                               ("button[aria-label=trimite mesajul]", "attach_file"))):
            for k, (extra, m) in sorted(SEMNALE.items()):
                i = self.an(zona_cu(extra))
                self.assertEqual(i["necunoscute_detalii"][:1], [m], msg=k)
                self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []), msg=k)
        # aceleasi elemente FARA semnal trec (calea legitima): semnatura exacta e in lista, continutul e curat
        curate = ('<gem-icon class="ng-star-inserted"><svg><path d="M0"></path></svg></gem-icon>',
                  '<toolbox-drawer foo="bar"></toolbox-drawer>',
                  '<fieldset role="none" aria-live="polite"></fieldset>',
                  # r16: butonul fara textele inventate "Trimite" / ligatura "send" (nevazute in captura netaiata -> text_in_control:)
                  '<button aria-label="Trimite mesajul" class="send-button"><span></span><mat-icon></mat-icon></button>',
                  '<a data-test-id="footer-privacy-notice-link" href="https://support.google.com/gemini?p=privacy_notice">'
                  '<span data-test-id="content">Confiden\u021bialitatea ta \u0219i Gemini</span></a>',
                  '<span role="status" aria-live="polite"></span>')
        # r14: calea legitima a REGULII SEMNALELOR (lista alba a atributelor oprita); cu lista alba pornita, atributele nevazute in capturi
        # (path d, foo, aria-live, href Google alternativ; r15: si clasa `send-button` pe <button> - vazuta doar pe gem-icon-button) sunt
        # refuzate: fiecare exact o data
        for extra in curate:
            with fara_r13(gp):
                self.assertEqual(self.an(zona_cu(extra))["necunoscute"], 0, msg=(extra, self.an(zona_cu(extra))["necunoscute_detalii"]))
        for extra, m in zip(curate, ("atribut_necunoscut:path{d}", "atribut_necunoscut:toolbox-drawer{foo}",
                                     "atribut_necunoscut:fieldset[role=none]{aria-live}", "atribut_valoare:button[aria-label=trimite mesajul]{class}",
                                     "atribut_valoare:a[data-test-id=footer-privacy-notice-link][href]{href}",
                                     "atribut_necunoscut:span[role=status]{aria-live}")):
            self.assertEqual(self.an(zona_cu(extra))["necunoscute_detalii"], [m] if m else [], msg=extra)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def test_semnalul_in_editor(self):
        # editorul insusi si elementele din el (span-uri Quill) nu pot purta clase / atribute de atasament
        ed = EDITOR_HTML.replace('contenteditable="true"', 'contenteditable="true" data-file-name="oferta.pdf"')
        self.assertEqual(self.an(zona_cu(editor=ed))["necunoscute_detalii"],
                         ["semnal_in_editor:token_file:div[role=textbox][contenteditable]{ql-editor textarea data-file-name}"])
        ed = EDITOR_HTML.replace("<p>ciorna</p>", '<p>ciorna<span class="ql-attachment-chip"></span></p>')
        self.assertEqual(self.an(zona_cu(editor=ed))["necunoscute_detalii"], ["semnal_in_editor:token_attach:span{ql-attachment-chip}",
                                                                             "editor_structura:span in p"])      # r18: + forma Quill
        self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(editor=ed))), ("ciorna_necunoscuta", []))

    def test_url_urile_nu_sunt_nume_de_fisier_dar_cuvintele_raman(self):
        # r5: href-ul linkului real sta pe un host Google (ar fi "fisier" dupa regex): DOAR hostname-ul unui http(s) pe google.com e
        # exceptat; cuvintele se verifica pe tot URL-ul, numele de fisier pe tot ce nu e gazda (cazurile r5 complete: TestNumeFisierPesteTot)
        a = '<a data-test-id="footer-privacy-notice-link" href="%s"></a>'
        with fara_r13(gp):                  # r14: regula r5 (semnale) singura; lista alba accepta doar href-ul real (HREF_REAL)
            self.assertEqual(self.an(zona_cu(a % "https://support.google.com/gemini/answer/13594961?hl=ro"))["necunoscute"], 0)
        self.assertEqual(self.an(zona_cu(a % "https://support.google.com/gemini/answer/13594961?hl=ro"))["necunoscute_detalii"],
                         ["atribut_valoare:a[data-test-id=footer-privacy-notice-link][href]{href}"])
        self.assertEqual(self.an(zona_cu(a % HREF_REAL))["necunoscute"], 0)
        self.assertEqual(self.an(zona_cu(a % "https://x.ro/download/oferta.pdf"))["necunoscute_detalii"],
                         ["token_pdf:a[data-test-id=footer-privacy-notice-link][href]{}"])
        self.assertEqual(self.an(zona_cu(a % "https://x.ro/uploads/1"))["necunoscute_detalii"],
                         ["token_upload:a[data-test-id=footer-privacy-notice-link][href]{}"])
        self.assertEqual(self.an(zona_cu(a % "https://x.ro/download/oferta.docx"))["necunoscute_detalii"],
                         ["atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"])
        self.assertEqual(gp.HREF_GAZDE_FARA_FISIER, ("google.com",))

    def test_eticheta_permite_doar_cuvintele_de_incarcare(self):
        # scris de mana: butonul calibrat "Incarcare si instrumente" trece; orice alt cuvant de atasament in eticheta = refuz
        self.assertEqual(gp.TOKENI_ETICHETA_PERMISE, ("upload", "incarca"))
        self.assertEqual(set(gp.TOKENI_ETICHETA_INTERZISA), (set(gp.TOKENI_ATAS) - {"upload", "incarca"}) | {"terge"})
        for lbl, ok in (("\u00cenc\u0103rcare \u0219i instrumente", True), ("Upload", True), ("Incarcare fisier", False),
                        ("Attach", False), ("Elimin\u0103 imaginea", False), ("Card", False), ("Document nou", False),
                        ("oferta.pdf", False), ("\u0218terge", False)):
            btn = '<button aria-label="%s"></button>' % lbl
            with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", (gp._semnatura(self.nod(btn)),)), valori_in_plus(("button", "aria-label", lbl)):
                i = self.an(zona_cu(btn))
                self.assertEqual(i["necunoscute"], 0 if ok else 1, msg=lbl)
                if not ok:
                    self.assertTrue(i["necunoscute_detalii"][0].startswith("eticheta:"), msg=lbl)

    def test_semnalul_se_verifica_pe_toate_atributele_din_semnatura(self):
        # r3 sarea role / type la eticheta: <input type="file"> in lista ar fi trecut; r4 le verifica si pe ele
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", ("input[type=file]", "div[role=document]")):
            self.assertEqual(self.an(zona_cu('<input type="file" hidden>'))["necunoscute_detalii"], ["eticheta:input[type=file]"])
            self.assertEqual(self.an(zona_cu('<div role="document"></div>'))["necunoscute_detalii"], ["eticheta:div[role=document]"])

    def test_mutant_ordinea_inversata_lasa_brief_ul_sa_plece(self):
        # mutant: blocul de semnale mutat DUPA potrivirea cu listele (si dupa elementele neutre) -> cele doua reproduceri din
        # verdict trec la Enter (exact ce a gasit Jakarinos pe d50dda4e); pe cod: refuz fara nicio actiune (testat mai sus)
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        bloc = ["    s = _semnal(n)", "    if s:", '        return ("semnal_in_editor:" + s[0] if in_editor else s[0]), ctrl, s[1]']
        tinta = '    return "element:" + sem, ctrl, ""'
        linii = [l.rstrip("\r") for l in src.split("\n")]
        ib = [k for k in range(len(linii) - 2) if linii[k:k + 3] == bloc]
        it = [k for k, l in enumerate(linii) if l == tinta]
        self.assertEqual((len(ib), len(it)), (1, 1))
        self.assertLess(ib[0], it[0])
        del linii[ib[0]:ib[0] + 3]
        it = [k for k, l in enumerate(linii) if l == tinta][0]
        linii[it:it] = bloc
        mut = types.ModuleType("gemini_pw_mutant_ordine")
        exec(compile("\n".join(linii), "gemini_pw_mutant_ordine", "exec"), mut.__dict__)
        with fara_r13(mut):
            cod, act = ruleaza_trimite(mut, FakePg(zona_cu(REPRO_GEM_ICON)))
        self.assertEqual(cod, None)
        self.assertIn("press Enter", act)
        with mock.patch.object(mut, "STRUCTURA_CUNOSCUTA", mut.STRUCTURA_CUNOSCUTA + (TOKEN_FILE_R3.split(":", 1)[1],)), fara_r13(mut):
            cod, act = ruleaza_trimite(mut, FakePg(zona_cu(REPRO_DIV)))
            self.assertIn("press Enter", act)
        # mutantul inca refuza un element necunoscut cu semnal (nu e in lista): deci doar ORDINEA e diferita
        self.assertEqual(ruleaza_trimite(mut, FakePg(zona_cu('<x-card data-file-name="a.pdf"></x-card>')))[0], "ciorna_necunoscuta")

    def test_mutant_fara_semnal_pe_text_in_control(self):
        # mutant: textul dintr-un control nu mai e verificat dupa cuvinte -> "Fisier atasat" in butonul de trimitere pleaca
        extra = SEMNALE["control_text_inauntru"][0]
        mut = mutant([('        return "text_atasament:" + v', "        pass")])
        # r16: textul nu e in TEXTE_CUNOSCUTE pe locul lui (lista alba a textelor, al doilea strat) -> mutantul se judeca pe regula LUI,
        # cu perechea adaugata doar in el
        with mock.patch.object(mut, "TEXTE_CUNOSCUTE", mut.TEXTE_CUNOSCUTE + (("button[aria-label=trimite mesajul]", "Fi\u0219ier ata\u0219at"),)):
            self.assertIsNone(ruleaza_trimite(mut, FakePg(zona_cu(extra)))[0])
        self.assertEqual(ruleaza_trimite(mut, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []))   # fara pereche: refuzat de lista
        self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []))

    def test_mutant_fara_valorile_atributelor(self):
        # mutant: valorile atributelor din afara semnaturii nu se mai verifica -> gem-icon data-x="oferta.pdf" din lista pleaca
        extra = SEMNALE["gem_icon_valoare_fisier"][0]
        mut = mutant([(LINIA_PAS4, "        if True:")])
        with fara_r13(mut):
            self.assertIsNone(ruleaza_trimite(mut, FakePg(zona_cu(extra)))[0])
        self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []))


class TestDomeniulFirmei(unittest.TestCase):
    def test_nume_fisier_pozitiv_negativ(self):
        # negative din brief: oferta.pdf, gazpet.ro.pdf, gazpet.rox, a.gazpet.ro.docx raman fisiere; doar gazpet.ro singur nu
        for t, nume in (("oferta.pdf", "oferta.pdf"), ("gazpet.ro.pdf", "gazpet.ro"), ("gazpet.rox", "gazpet.rox"),
                        ("a.gazpet.ro.docx", "gazpet.ro"), ("www.gazpet.ro", "gazpet.ro"), ("vezi gazpet.ro si oferta.pdf", "oferta.pdf"),
                        ("gazpet.ro, a.txt", "a.txt"), ("gazpet.ro.", "gazpet.ro"), ("gazpet-ro.pdf", "gazpet-ro.pdf"),
                        ("google.com", "google.com"), ("gazpet.com", "gazpet.com")):
            self.assertEqual(gp._nume_fisier(t), nume, t)
        for t in ("gazpet.ro", "chaturile gazpet.ro nu sunt folosite pentru a imbunatati modelele noastre", "(gazpet.ro)",
                  "gazpet.ro/", "carbon", "4.5 carbon", "add_2", "", "gazpet.ro gazpet.ro"):
            self.assertIsNone(gp._nume_fisier(t), t)
        self.assertEqual(gp.DOMENII_FIRMA, ("gazpet.ro",))
        self.assertEqual(sorted(set(gp.CARACTERE_NUME)), sorted(set("abcdefghijklmnopqrstuvwxyz0123456789_.-")))

    def test_text_cu_domeniu_e_text_nu_fisier(self):
        an = gp.analizeaza_ciorna
        self.assertEqual(an(zona_cu("<div>Vezi gazpet.ro</div>"))["necunoscute_detalii"], ["text:vezi gazpet.ro"])
        for t in ("oferta.pdf", "gazpet.ro.pdf", "gazpet.rox", "a.gazpet.ro.docx", "www.gazpet.ro"):
            self.assertEqual(an(zona_cu("<div>Vezi %s</div>" % t))["necunoscute_detalii"], ["text_fisier:vezi " + t], t)
        # acelasi lucru pe eticheta unui control din lista alba (L19: o singura definitie)
        sem = "button[aria-label=send message][type=button][jsaction]"
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", (sem,)), valori_in_plus(("button", "aria-label", "Send message"),
                                                                                   ("button", "jsaction", "click:x")):
            btn = '<button aria-label="%s" type="button" jsaction="click:x"></button>'
            self.assertEqual(an(zona_cu(btn % "Send message"))["necunoscute"], 0)
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", ("button[aria-label=gazpet.ro]", "button[aria-label=gazpet.ro.pdf]")), \
                valori_in_plus(("button", "aria-label", "gazpet.ro")):
            self.assertEqual(an(zona_cu('<button aria-label="gazpet.ro"></button>'))["necunoscute"], 0)
            self.assertEqual(an(zona_cu('<button aria-label="gazpet.ro.pdf"></button>'))["necunoscute_detalii"],
                             ["eticheta:button[aria-label=gazpet.ro.pdf]"])
        # un text din lista alba care contine domeniul trece (exact), unul cu fisier nu trece niciodata
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + ((gp.LOC_ZONA, "Vezi gazpet.ro"), (gp.LOC_ZONA, "Vezi gazpet.ro.pdf"))):   # r16
            self.assertEqual(an(zona_cu("<div>Vezi gazpet.ro</div>"))["necunoscute"], 0)
            self.assertEqual(an(zona_cu("<div>Vezi gazpet.ro.pdf</div>"))["necunoscute_detalii"], ["text_fisier:vezi gazpet.ro.pdf"])

    def test_mutant_domeniu_ca_subsir_trimite_fisierul(self):
        # mutant: domeniul cautat ca SUBSIR al cuvantului (nu egalitate) -> "gazpet.ro.docx" ar trece drept domeniu si brief-ul
        # ar pleca cu fisierul in ciorna; pe cod ramane refuz fara nicio actiune (".docx", nu ".pdf": "pdf" e si cuvant de
        # atasament, pe care regula r4 a textelor l-ar prinde oricum si ar ascunde mutantul)
        extra = "<div>gazpet.ro.docx</div>"
        cod, act = ruleaza_trimite(gp, FakePg(zona_cu(extra)))
        self.assertEqual((cod, act), ("ciorna_necunoscuta", []))
        mut = mutant([("        if a[i:j] in DOMENII_FIRMA:", "        if any(d in a[i:j] for d in DOMENII_FIRMA):")])
        pereche = ((gp.LOC_ZONA, "gazpet.ro.docx"),)          # r16: (loc, text)
        with mock.patch.object(mut, "TEXTE_CUNOSCUTE", mut.TEXTE_CUNOSCUTE + pereche):
            cod_m, act_m = ruleaza_trimite(mut, FakePg(zona_cu(extra)))
            self.assertIsNone(cod_m)
            self.assertIn("press Enter", act_m)
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + pereche):
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra)))[0], "ciorna_necunoscuta")
        # mutant: cuvantul nu se extinde peste punct (doar potrivirea regex) -> acelasi efect
        mut2 = mutant([("        while j < len(a) and a[j] in CARACTERE_NUME:", "        while False:")])
        with mock.patch.object(mut2, "TEXTE_CUNOSCUTE", mut2.TEXTE_CUNOSCUTE + pereche):
            self.assertIsNone(ruleaza_trimite(mut2, FakePg(zona_cu(extra)))[0])


# --- v4.6.4 r5 (Jakarinos NO-GO pe 86f6ff72, P1): nume.extensie in TOATE valorile (clase, id, URL-uri, style) ---
# cele patru reproduceri din verdict, copiate exact (pe 86f6ff72: atasamente 0, semne 0, necunoscute 0 -> press Enter)
REPRO_R5 = {
    "clasa": ('<gem-icon class="oferta.docx"></gem-icon>', "atribut_fisier:gem-icon{oferta.docx}"),
    "id": ('<gem-icon id="oferta.docx"></gem-icon>', "atribut_fisier:gem-icon{#oferta.docx}"),
    "href_blob": ('<a data-test-id="footer-privacy-notice-link"\n   href="blob:https://gemini.google.com/oferta.docx"></a>',
                  "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "style": ('<gem-icon style="--x: oferta.pdf"></gem-icon>', "token_pdf:gem-icon{style}"),   # "pdf" e si cuvant de atasament
}
LINK = '<a data-test-id="footer-privacy-notice-link" href="%s"></a>'
# variante (asteptat scris de mana): fiecare = un nume.extensie intr-o valoare pe care r4 nu o verifica, pe elemente din liste / neutre
NUME_PESTE_TOT = {
    "clasa_intre_altele": ('<gem-icon class="ng-star-inserted icon oferta.docx"></gem-icon>', "atribut_fisier:gem-icon{icon oferta.docx}"),
    "clasa_div_neutru": ('<div class="a.txt"></div>', "atribut_fisier:div{a.txt}"),
    "id_pe_control": ('<button aria-label="Trimite mesajul" id="oferta.docx"></button>', "atribut_fisier:button[aria-label=trimite mesajul]{#oferta.docx}"),
    "href_host_fisier": (LINK % "https://oferta.docx/", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_google_cale": (LINK % "https://support.google.com/x/oferta.docx", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_google_interogare": (LINK % "https://support.google.com/gemini?f=oferta.docx", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_google_fragment": (LINK % "https://support.google.com/gemini#oferta.docx", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_google_utilizator": (LINK % "https://oferta.docx@support.google.com/", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_host_fals_sufix": (LINK % "https://google.com.evil.ro/", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_host_fals_prefix": (LINK % "https://support.google.com.evil.ro/", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_host_fals_lipit": (LINK % "https://evilgoogle.com/", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_blob_uuid": (LINK % "blob:https://gemini.google.com/4f3a0b2c-1d2e-4f5a-8b9c-0d1e2f3a4b5c",
                       "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_fara_schema": (LINK % "//gemini.google.com/x", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "href_alt_host": (LINK % "https://x.ro/", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"),
    "src_host": ('<gem-icon src="https://lh3.googleusercontent.com/a"></gem-icon>', "atribut_fisier:gem-icon[src]{}"),   # src: fara exceptie
    "src_fisier": ('<gem-icon src="x.svg"></gem-icon>', "atribut_fisier:gem-icon[src]{}"),
    "srcset": ('<gem-icon srcset="a.webp 1x, b.webp 2x"></gem-icon>', "atribut_fisier:gem-icon[srcset]{}"),
    "style_docx": ('<gem-icon style="--x: oferta.docx"></gem-icon>', "atribut_fisier:gem-icon{style}"),
    "style_pe_control": ('<button aria-label="Trimite mesajul" style="color: red; --f: raport.docx"></button>',
                         "atribut_fisier:button[aria-label=trimite mesajul]{style}"),
    "style_cuvant": ('<gem-icon style="--chip-color: red"></gem-icon>', "token_chip:gem-icon{style}"),
    "style_pe_structura": ('<toolbox-drawer style="--x: a.txt"></toolbox-drawer>', "atribut_fisier:toolbox-drawer{style}"),
    "style_in_editor": (None, "semnal_in_editor:atribut_fisier:span{style}"),
}
# calea legitima (L20): URL-uri si stiluri FARA nume de fisier pe elementele calibrate trec (0 necunoscute)
CURATE_R5 = (
    LINK % HREF_REAL,                                           # r6: href-ul real (citit din pagina), nu mai e presupunere
    LINK % "https://support.google.com/gemini?p=privacy_notice",
    LINK % "https://support.google.com/gemini/answer/13594961?hl=ro",
    LINK % "https://policies.google.com/privacy?hl=ro",
    LINK % "https://gemini.google.com/",
    LINK % "https://support.google.com/gemini/answer/13594961?hl=ro&co=GENIE.Platform%3DDesktop#zippy=",
    '<gem-icon style="width: 24px; --mat-icon-color: red"></gem-icon>',
    '<gem-icon class="ng-star-inserted mat-icon-no-color"></gem-icon>',
    '<toolbox-drawer style="display: none"></toolbox-drawer>',
)


class TestNumeFisierPesteTot(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def test_cele_patru_reproduceri_din_verdict_refuzate_fara_actiuni(self):
        for k, (extra, m) in sorted(REPRO_R5.items()):
            i = self.an(zona_cu(extra))
            self.assertEqual((i["atasamente"], i["semne"]), (0, 0), msg=k)             # ce a gasit Jakarinos: 0 / 0 ...
            self.assertEqual(i["necunoscute_detalii"], [m], msg=k)                         # ... dar acum un necunoscut
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []), msg=k)
        # style cu url( ramane "fundal:" (verificat inaintea semnalului), ca inainte
        self.assertEqual(self.an(zona_cu('<gem-icon style="background: url(blob:x)"></gem-icon>'))["necunoscute_detalii"], ["fundal:gem-icon"])

    def test_fiecare_varianta_refuzata_oricare_ar_fi_lista(self):
        semnaturi = tuple(gp._semnatura(self.nod(extra)) for extra, _ in NUME_PESTE_TOT.values() if extra is not None)
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", gp.CONTROALE_CUNOSCUTE + semnaturi):
            for k, (extra, m) in sorted(NUME_PESTE_TOT.items()):
                if extra is None:
                    html = zona_cu(editor=EDITOR_HTML.replace("<p>ciorna</p>", '<p>ciorna<span style="--x: a.txt"></span></p>'))
                else:
                    html = zona_cu(extra)
                i = self.an(html)
                self.assertEqual((i["atasamente"], i["semne"]), (0, 0), msg=k)
                # r18: span-ul din editor da si motivul formei Quill (al doilea strat)
                self.assertEqual(i["necunoscute_detalii"], [m] + (["editor_structura:span in p"] if extra is None else []), msg=k)
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=k)
        # r14: calea legitima a regulii r5 (semnale), cu lista alba a atributelor oprita; cu ea pornita trece DOAR href-ul real, restul = refuz
        for extra in CURATE_R5:
            with fara_r13(gp):
                i = self.an(zona_cu(extra))
                self.assertEqual(i["necunoscute"], 0, msg=(extra, i["necunoscute_detalii"]))
                self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra), dupa_goto=zona_cu(extra))), (None, ACTIUNI_TRIMITERE), msg=extra)
            d = self.an(zona_cu(extra))["necunoscute_detalii"]
            # doar href-ul real trece; restul (alt href, style; r15: si clasa `mat-icon-no-color` pe gem-icon - vazuta doar pe mat-icon,
            # r14 accepta orice clasa pe orice tag) = un refuz
            self.assertEqual(CURATE_R5[7], '<gem-icon class="ng-star-inserted mat-icon-no-color"></gem-icon>')
            self.assertEqual(len(d), 0 if extra == LINK % HREF_REAL else 1, msg=(extra, d))
            if extra == CURATE_R5[7]:
                self.assertEqual(d, ["atribut_valoare:gem-icon{class}"])
            self.assertTrue(all(x.startswith(("atribut_valoare:", "atribut_necunoscut:")) for x in d), msg=d)

    def test_exceptia_href_e_doar_gazda_google_a_unui_http(self):
        # scris de mana: ce ramane de verificat dupa scoaterea gazdei; orice alt caz = textul intreg al valorii
        f = gp._fara_gazda_permisa
        self.assertEqual(f("href", "https://support.google.com/gemini?p=privacy_notice"), "https /gemini p=privacy_notice")
        self.assertEqual(f("href", "https://support.google.com/x/oferta.docx"), "https /x/oferta.docx")
        self.assertEqual(f("href", "https://Support.GOOGLE.com/"), "https /")
        for k, v in (("href", "https://oferta.docx/"), ("href", "https://google.com.evil.ro/"), ("href", "https://evilgoogle.com/"),
                     ("href", "blob:https://gemini.google.com/oferta.docx"), ("href", "//gemini.google.com/x"), ("href", "ftp://google.com/"),
                     ("href", "javascript:void(0)"), ("href", "/x"), ("src", "https://google.com/a.png"), ("srcset", "https://google.com/a.png 1x"),
                     ("style", "--x: google.com"), ("data-x", "https://google.com/")):
            self.assertEqual(f(k, v), gp._ascii(v), msg=(k, v))
        self.assertTrue(gp._gazda_permisa("google.com") and gp._gazda_permisa("support.google.com") and gp._gazda_permisa("a.b.google.com"))
        for g in ("google.com.evil.ro", "evilgoogle.com", "google.co", "gazpet.ro", "", "google.com."):
            self.assertFalse(gp._gazda_permisa(g), g)

    def test_mutanti_r5_lasa_brief_ul_sa_plece(self):
        # fiecare mutant readuce o lacuna din 86f6ff72 (sau o slabeste); scenariul lui pleaca la Enter pe mutant si e refuzat pe cod
        cazuri = (
            # clasele / id-ul nu se mai cauta dupa nume.extensie (r4): reproducerile "clasa" si "id"
            ([("    if f is not None:", "    if False:")], (REPRO_R5["clasa"][0], REPRO_R5["id"][0])),
            # valorile URL exceptate in intregime de la nume.extensie (r4): href blob si src
            ([("        if _nume_fisier(_fara_gazda_permisa(k, v)) is not None:",
               '        if k not in ("href", "src", "srcset") and _nume_fisier(a) is not None:')],
             (REPRO_R5["href_blob"][0], NUME_PESTE_TOT["href_blob_uuid"][0], NUME_PESTE_TOT["href_alt_host"][0],
              LINK % "https://x.ro/download/oferta.docx")),       # (gem-icon[src] e refuzat si pe mutant ca element necunoscut: nu discrimineaza)
            # style sarit (r4: doar url( ): reproducerea "style" si varianta .docx
            ([(LINIA_PAS4, LINIA_PAS4.replace("ATRIBUTE_AFISATE_SEPARAT or", 'ATRIBUTE_AFISATE_SEPARAT + ("style",) or'))],
             (REPRO_R5["style"][0], NUME_PESTE_TOT["style_docx"][0])),
            # exceptia gazdei largita la tot URL-ul: un nume de fisier in calea unui host Google pleaca
            ([('    return _ascii(" ".join([u.scheme, u.username or "", u.password or "", u.path, u.params, u.query, u.fragment]))',
               '    return ""')], (NUME_PESTE_TOT["href_google_cale"][0], NUME_PESTE_TOT["href_google_interogare"][0])),
            # gazda cautata ca SUBSIR (nu egalitate / sufix cu punct): google.com.evil.ro ar fi "Google"
            ([('    return any(gazda == d or gazda.endswith("." + d) for d in HREF_GAZDE_FARA_FISIER)',
               "    return any(d in gazda for d in HREF_GAZDE_FARA_FISIER)")],
             (NUME_PESTE_TOT["href_host_fals_sufix"][0], NUME_PESTE_TOT["href_host_fals_lipit"][0])),
            # fara conditia de schema http(s): un URL relativ la protocol pe un host Google ar fi exceptat
            ([('    if u.scheme not in ("http", "https") or not gazda or not _gazda_permisa(gazda):',
               "    if not gazda or not _gazda_permisa(gazda):")], (NUME_PESTE_TOT["href_fara_schema"][0],)),
        )
        for inlocuiri, extre in cazuri:
            mut = mutant(inlocuiri)
            for extra in extre:
                self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []), msg=extra)
                with fara_r13(mut):                 # r14: lista alba (al doilea strat) oprita doar in mutant
                    cod_m, act_m = ruleaza_trimite(mut, FakePg(zona_cu(extra)))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], extra, cod_m))
                self.assertIn("press Enter", act_m, msg=extra)


# --- v4.6.4 r5: sursa reala a liniei token_file = atributul `xapfileselectordropzone=""` (marcaj gol de zona drop), acceptat EXACT ---
DIV_REAL = '<div _ngcontent-ng-c1694197906="" xapfileselectordropzone="" class="text-input-field simplified-input-area" jslog="303810;track:impression">%s</div>'
DIV_FARA_NG = '<div class="text-input-field simplified-input-area"%s></div>'
TOKEN_MARCAJ = "token_file:div{text-input-field simplified-input-area jslog xapfileselectordropzone}"


class TestMarcajDropZone(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def test_div_ul_real_trece_si_continutul_lui_se_verifica(self):
        # exact atributele citite din pagina (ordinea din token_file_atribute.txt), gol sau cu structura calibrata inauntru
        for inauntru in ("", "<simplified-input-menu></simplified-input-menu><toolbox-drawer></toolbox-drawer>"):
            i = self.an(zona_cu(DIV_REAL % inauntru))
            self.assertEqual((i["necunoscute"], i["atasamente"], i["semne"]), (0, 0, 0), msg=i["necunoscute_detalii"])
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(DIV_REAL % inauntru), dupa_goto=zona_cu(DIV_REAL % inauntru))), (None, ACTIUNI_TRIMITERE))
        # marcajul nu "acopera" nimic din interior: fisier / card / text / chip in div = refuz sau numarat, ca inainte
        for inauntru, m in (("<span>a.txt</span>", "text_fisier:a.txt"), ("<attachment-card></attachment-card>", "element:attachment-card"),
                            ('<div data-file-id="1"></div>', "token_file:div{data-file-id}"), ("<span>Deep Research</span>", "text:deep research")):
            self.assertEqual(self.an(zona_cu(DIV_REAL % inauntru))["necunoscute_detalii"], [m], msg=inauntru)
        self.assertEqual(self.an(zona_cu(DIV_REAL % chip("a.txt")))["atasamente"], 1)

    def test_orice_abatere_de_la_marcaj_e_refuzata(self):
        # scris de mana: valoare nevida, alt element, alte clase, alt nume (prefix / sufix / subsir), alt atribut cu "file" alaturi
        cazuri = (
            (DIV_FARA_NG % ' xapfileselectordropzone="1"', TOKEN_MARCAJ.replace(" jslog", "")),
            (DIV_FARA_NG % ' xapfileselectordropzone="oferta.docx"', TOKEN_MARCAJ.replace(" jslog", "")),
            (DIV_FARA_NG % ' xapfileselectordropzone="true"', TOKEN_MARCAJ.replace(" jslog", "")),
            (DIV_REAL.replace('xapfileselectordropzone=""', 'xapfileselectordropzone=" "') % "", TOKEN_MARCAJ),
            ('<gem-icon xapfileselectordropzone=""></gem-icon>', "token_file:gem-icon{xapfileselectordropzone}"),
            ('<span class="text-input-field simplified-input-area" xapfileselectordropzone=""></span>',
             "token_file:span{text-input-field simplified-input-area xapfileselectordropzone}"),
            ('<fieldset role="none" xapfileselectordropzone=""></fieldset>', "token_file:fieldset[role=none]{xapfileselectordropzone}"),
            ('<rich-textarea xapfileselectordropzone=""></rich-textarea>', "token_file:rich-textarea{xapfileselectordropzone}"),
            ('<toolbox-drawer xapfileselectordropzone=""></toolbox-drawer>', "token_file:toolbox-drawer{xapfileselectordropzone}"),
            ('<button aria-label="Trimite mesajul" xapfileselectordropzone=""></button>',
             "token_file:button[aria-label=trimite mesajul]{xapfileselectordropzone}"),
            ('<div xapfileselectordropzone=""></div>', "token_file:div{xapfileselectordropzone}"),
            ('<div class="text-input-field" xapfileselectordropzone=""></div>', "token_file:div{text-input-field xapfileselectordropzone}"),
            ('<div class="simplified-input-area" xapfileselectordropzone=""></div>', "token_file:div{simplified-input-area xapfileselectordropzone}"),
            ('<div class="text-input-field simplified-input-area extra" xapfileselectordropzone=""></div>',
             "token_file:div{text-input-field simplified-input-area extra xapfileselectordropzone}"),
            ('<div class="text-input-field simplified-input-area-v2" xapfileselectordropzone=""></div>',
             "token_file:div{text-input-field simplified-input-area-v2 xapfileselectordropzone}"),
            (DIV_FARA_NG % ' xapfileselectordropzones=""', "token_file:div{text-input-field simplified-input-area xapfileselectordropzones}"),
            (DIV_FARA_NG % ' xapfileselectordropzone2=""', "token_file:div{text-input-field simplified-input-area xapfileselectordropzone2}"),
            (DIV_FARA_NG % ' xxapfileselectordropzone=""', "token_file:div{text-input-field simplified-input-area xxapfileselectordropzone}"),
            (DIV_FARA_NG % ' xapfileselectordropzone-x=""', "token_file:div{text-input-field simplified-input-area xapfileselectordropzone-x}"),
            (DIV_FARA_NG % ' data-xapfileselectordropzone=""', "token_file:div{text-input-field simplified-input-area data-xapfileselectordropzone}"),
            (DIV_FARA_NG % ' xapfileselectordropzone="" data-file-id="1"',
             "token_file:div{text-input-field simplified-input-area data-file-id xapfileselectordropzone}"),
            (DIV_FARA_NG % ' xapfileselectordropzone="" filedroptarget=""',
             "token_file:div{text-input-field simplified-input-area filedroptarget xapfileselectordropzone}"),
            (DIV_FARA_NG % ' xapfileselectordropzone="" removeattachment=""',
             "token_attach:div{text-input-field simplified-input-area removeattachment xapfileselectordropzone}"),
            (DIV_FARA_NG % ' xapfileselectordropzone="" data-x="oferta.docx"',
             "atribut_fisier:div{text-input-field simplified-input-area data-x xapfileselectordropzone}"),
        )
        for extra, m in cazuri:
            i = self.an(zona_cu(extra))
            self.assertEqual(i["necunoscute_detalii"], [m], msg=extra)
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []), msg=extra)
        # in editor: nici editorul, nici un element din el nu poate purta marcajul
        ed = EDITOR_HTML.replace('contenteditable="true"', 'contenteditable="true" xapfileselectordropzone=""')
        self.assertEqual(self.an(zona_cu(editor=ed))["necunoscute_detalii"],
                         ["semnal_in_editor:token_file:div[role=textbox][contenteditable]{ql-editor textarea xapfileselectordropzone}"])
        # nicio lista alba nu-l poate accepta (P1 r4): semnatura exacta a abaterii in STRUCTURA / CONTROALE = tot refuz
        with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + ("gem-icon", "div", TOKEN_MARCAJ.split(":", 1)[1])), \
                mock.patch.object(gp, "CONTROALE_CUNOSCUTE", gp.CONTROALE_CUNOSCUTE + ("button[aria-label=trimite mesajul]",)):
            for extra, m in cazuri:
                self.assertEqual(self.an(zona_cu(extra))["necunoscute_detalii"], [m], msg=extra)

    def test_stare_arata_abaterea(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(zona_cu(DIV_FARA_NG % ' xapfileselectordropzone="1"')))
        linii = out.getvalue().splitlines()
        self.assertIn("necunoscute in zona: 1", linii)
        self.assertIn("  necunoscut " + TOKEN_MARCAJ.replace(" jslog", ""), linii)

    def test_mutanti_marcaj_lasa_brief_ul_sa_plece(self):
        cazuri = (
            # fara conditia de valoare goala (r8: forma valorii): o valoare nevida pe marcaj pleaca
            ([('        if not forma.fullmatch(n.attrs.get(k) or ""):', "        if False:")], (DIV_FARA_NG % ' xapfileselectordropzone="1"',)),
            # fara conditia de element: acelasi atribut pe gem-icon / span / fieldset pleaca
            ([(LINIA_CLASE, "        if False:")],
             ('<gem-icon xapfileselectordropzone=""></gem-icon>', '<fieldset role="none" xapfileselectordropzone=""></fieldset>',
              '<div class="text-input-field" xapfileselectordropzone=""></div>')),
            # numele comparat ca prefix, nu exact: un atribut cu sufix pleaca
            ([("        if k != nume:", "        if not k.startswith(nume):")], (DIV_FARA_NG % ' xapfileselectordropzone2=""',)),
            # acceptare GLOBALA a lui "file" (ce interzice brief-ul): orice data-file-* pleaca
            ([('TOKENI_ATAS = ("file", "fisier",', 'TOKENI_ATAS = ("fisier",')], ('<gem-icon data-file-name="oferta"></gem-icon>',)),
        )
        for inlocuiri, extre in cazuri:
            mut = mutant(inlocuiri)
            for extra in extre:
                self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []), msg=extra)
                with fara_r13(mut):                 # r14: lista alba (al doilea strat) oprita doar in mutant
                    cod_m, act_m = ruleaza_trimite(mut, FakePg(zona_cu(extra)))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], extra, cod_m))
                self.assertIn("press Enter", act_m, msg=extra)
        # mutantul cu TOKENI_ATAS fara "file" inca refuza div-ul real? NU e nevoie: pe cod div-ul real trece prin regula marcajului,
        # nu prin lipsa cuvantului - verificat: fara regula (FARA_MARCAJ), div-ul real e refuzat pe cod
        with mock.patch.multiple(gp, **FARA_MARCAJ):
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(DIV_REAL % ""))), ("ciorna_necunoscuta", []))


# --- v4.6.4 r6 (Jakarinos NO-GO pe 807119f9, P1): ELEMENTUL ZONEI INSESI se verifica (semnale, chip, semn), nu doar descendentii ---
# cele sase reproduceri din verdict, copiate exact (pe 807119f9: atasamente 0, semne 0, necunoscute 0 -> press Enter); motivul scris de mana
REPRO_R6 = {
    "data_file_name": (' data-file-name="oferta.docx"', "token_file:input-area-v2{data-file-name}"),
    "clasa": (' class="oferta.docx"', "atribut_fisier:input-area-v2{oferta.docx}"),
    "id": (' id="oferta.docx"', "atribut_fisier:input-area-v2{#oferta.docx}"),
    "style": (' style="--x: oferta.pdf"', "token_pdf:input-area-v2{style}"),                    # "pdf" e si cuvant de atasament
    "marcaj_gol": (' xapfileselectordropzone=""', "token_file:input-area-v2{xapfileselectordropzone}"),   # marcajul e permis DOAR pe div
    "marcaj_nevid": (' xapfileselectordropzone="1"', "token_file:input-area-v2{xapfileselectordropzone}"),
}
# variante pe zona (asteptat scris de mana): alte surse de semnal pe elementul zonei, zona exterioara gasita prin clasa, zone imbricate
ZONA_VARIANTE = {
    "style_docx": (' style="--x: oferta.docx"', "atribut_fisier:input-area-v2{style}"),
    "fundal": (' style="background-image: url(blob:x)"', "fundal:input-area-v2"),
    "data_cuvant": (' data-x="attachment"', "token_attach:input-area-v2{data-x}"),
    "data_fisier": (' data-x="oferta.docx"', "atribut_fisier:input-area-v2{data-x}"),
    "removeattachment": (' removeattachment=""', "token_attach:input-area-v2{removeattachment}"),
    "eticheta_fisier": (' title="oferta.docx"', "eticheta:input-area-v2[title=oferta.docx]"),
    "eticheta_cuvant": (' aria-label="Remove file"', "eticheta:input-area-v2[aria-label=remove file]"),
    "href_blob": (' href="blob:https://gemini.google.com/oferta.docx"', "atribut_fisier:input-area-v2[href]{}"),
    "clasa_intre_altele": (' class="ng-tns-c1-4 ui-improvements-phase-1 oferta.docx"', "atribut_fisier:input-area-v2{ui-improvements-phase-1 oferta.docx}"),
    "clasa_cuvant": (' class="ng-tns-c1-4 with-file-chip"', "token_file:input-area-v2{with-file-chip}"),
    "marcaj_cu_clasele_div_ului": (' class="text-input-field simplified-input-area" xapfileselectordropzone=""',
                                   "token_file:input-area-v2{text-input-field simplified-input-area xapfileselectordropzone}"),
}


class TestZonaInsasi(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def test_cele_sase_reproduceri_din_verdict_refuzate_fara_actiuni(self):
        # fixture-ul din verdict: <input-area-v2 ...> cu editorul valid inauntru (pagina()), apoi si zona cu controale (zona_cu) si
        # pagina calibrata intreaga (cele trei stari) cu acelasi atribut pus pe zona
        for k, (atr, m) in sorted(REPRO_R6.items()):
            for html in (pagina(zona_atr=atr), zona_cu(zona_atr=atr), pagina_calibrare("i", zona_atr=atr),
                         pagina_calibrare("ii", zona_atr=atr), pagina_calibrare("iii", zona_atr=atr)):
                i = self.an(html)
                self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"]), (1, 1, 0, 0), msg=k)   # ce a masurat Jakarinos: 0 / 0
                self.assertEqual(i["necunoscute_detalii"], [m], msg=k)                                             # ... dar acum 1 necunoscut
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=k)
            # acelasi atribut pe zona cu atributele reale alaturi: tot refuz, acelasi fel de motiv (in {...} apar si clasele / "trace")
            i = self.an(pagina_calibrare("i", zona_atr=ZONA_ATRIBUTE_REALE + atr))
            self.assertEqual(i["necunoscute"], 1, msg=(k, i["necunoscute_detalii"]))
            self.assertEqual(i["necunoscute_detalii"][0].split("{")[0], m.split("{")[0], msg=k)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_calibrare("i", zona_atr=ZONA_ATRIBUTE_REALE + atr))), ("ciorna_necunoscuta", []), msg=k)
        # pe chatul nou (dupa goto) si dupa scriere: aceeasi paza, fara Enter
        atr = REPRO_R6["data_file_name"][0]
        self.assertEqual(ruleaza_trimite(gp, FakePg(pagina(), dupa_goto=pagina(zona_atr=atr))), ("ciorna_necunoscuta", ["goto"]))
        cod, act = ruleaza_trimite(gp, FakePg(pagina(), dupa_scriere=pagina(zona_atr=atr)))
        self.assertEqual(cod, "ciorna_necunoscuta")
        self.assertNotIn("press Enter", act)

    def test_fiecare_varianta_pe_zona_refuzata_oricare_ar_fi_lista(self):
        # zona cu semnal e refuzata si daca semnatura ei exacta ar fi in liste (semnalele se verifica inaintea listelor, r4)
        semnaturi = tuple(gp._semnatura(self.nod("<input-area-v2%s></input-area-v2>" % atr)) for atr, _ in ZONA_VARIANTE.values())
        with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + semnaturi), \
                mock.patch.object(gp, "CONTROALE_CUNOSCUTE", gp.CONTROALE_CUNOSCUTE + semnaturi):
            for k, (atr, m) in sorted(ZONA_VARIANTE.items()):
                i = self.an(zona_cu(zona_atr=atr))
                self.assertEqual((i["atasamente"], i["semne"]), (0, 0), msg=k)
                self.assertEqual(i["necunoscute_detalii"], [m], msg=k)
                self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(zona_atr=atr))), ("ciorna_necunoscuta", []), msg=k)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def test_zona_reala_trece(self):
        # calea legitima (L20): zona cu atributele REALE (copiate din pagina) = fara semnal -> 0 necunoscute si `trimite` ajunge la Enter,
        # pe fixture-urile simple si pe cele trei stari calibrate; `stare` arata paza OK
        for html in (pagina(zona_atr=ZONA_ATRIBUTE_REALE), zona_cu(zona_atr=ZONA_ATRIBUTE_REALE),
                     pagina_calibrare("i"), pagina_calibrare("ii"), pagina_calibrare("iii")):
            i = self.an(html)
            self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 0), msg=i["necunoscute_detalii"])
            self.assertEqual(gp.verifica_fara_atasamente(i, 0, "t"), 0)
            self.assertEqual(ruleaza_trimite(gp, FakePg(html, dupa_goto=pagina_calibrare("i"))), (None, ACTIUNI_TRIMITERE))
        self.assertIsNone(gp._semnal(self.nod("<input-area-v2%s></input-area-v2>" % ZONA_ATRIBUTE_REALE)))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(pagina_calibrare("iii")))
        self.assertIn("necunoscute in zona: 0", out.getvalue().splitlines())
        self.assertIn("paza ciorna: OK (trimite ar continua)", out.getvalue().splitlines())
        # atributele reale nu contin niciun cuvant de atasament si niciun nume.extensie (scris de mana: lista cuvintelor, nu codul)
        self.assertIsNone(gp._cuvant("_ngcontent-ng-c1796725376 trace _nghost-ng-c1694197906 class ng-tns-c1694197906-4 ui-improvements-phase-1 "
                                     "with-toolbox-drawer input-box-shadow discovery-feed-the"))
        self.assertNotIn(".", "ng-tns-c1694197906-4 ui-improvements-phase-1 with-toolbox-drawer input-box-shadow discovery-feed-the")

    def test_linkul_real_de_confidentialitate_trece(self):
        # r6: href-ul real (citit din pagina) e pe gazda Google, calea nu contine nume.extensie: linkul trece; un fisier in cale = refuz
        self.assertEqual(gp._fara_gazda_permisa("href", HREF_REAL), "https /gemini/answer/14620100")
        self.assertIsNone(gp._nume_fisier(gp._fara_gazda_permisa("href", HREF_REAL)))
        self.assertIsNotNone(gp._nume_fisier(gp._ascii(HREF_REAL)))                 # fara exceptia gazdei ar fi "fisier" (support.google.com)
        i = self.an(zona_cu(LINK % HREF_REAL))
        self.assertEqual(i["necunoscute"], 0, msg=i["necunoscute_detalii"])
        self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(LINK % HREF_REAL), dupa_goto=zona_cu(LINK % HREF_REAL))), (None, ACTIUNI_TRIMITERE))
        self.assertIn(HREF_REAL, pagina_calibrare("iii"))
        self.assertEqual(self.an(pagina_calibrare("iii"))["necunoscute"], 0)
        for rau in (HREF_REAL + "/oferta.docx", HREF_REAL + "?f=oferta.docx", HREF_REAL.replace("support.google.com", "support.google.com.evil.ro")):
            self.assertEqual(self.an(zona_cu(LINK % rau))["necunoscute_detalii"], ["atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}"], msg=rau)

    def test_zona_exterioara_prin_clasa_si_zone_imbricate(self):
        # zona cea mai exterioara poate fi gasita prin clasa (ZONA_CLASE), nu doar prin tag: si ea se verifica; zonele interioare erau deja
        # descendenti (regresie pastrata); un invelis parinte cu rol / eticheta necunoscuta pe zona = element necunoscut (refuz)
        ed = EDITOR_HTML.replace('class="input-area"', 'class="textarea-wrapper"')
        for html, m in (('<html><body><div class="input-area oferta.docx">' + ed + "</div></body></html>", "atribut_fisier:div{input-area oferta.docx}"),
                        ('<html><body><div class="input-area-container" data-file-name="a.docx">' + ed + "</div></body></html>",
                         "token_file:div{input-area-container data-file-name}"),
                        ('<html><body><input-area-v2 data-file-name="a.docx"><input-container>' + ed + "</input-container></input-area-v2></body></html>",
                         "token_file:input-area-v2{data-file-name}"),
                        ('<html><body><input-area-v2><input-container class="oferta.docx">' + ed + "</input-container></input-area-v2></body></html>",
                         "atribut_fisier:input-container{oferta.docx}"),
                        ('<html><body><input-area-v2><div class="input-area-container" id="oferta.docx">' + ed + "</div></input-area-v2></body></html>",
                         "atribut_fisier:div{input-area-container #oferta.docx}"),
                        ('<html><body><div class="input-area" role="region">' + ed + "</div></body></html>", "element:div[role=region]"),
                        ('<html><body><section class="input-area">' + ed + "</section></body></html>", "element:section")):
            i = self.an(html)
            self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"]), (1, 1, 0, 0), msg=html)
            self.assertEqual(i["necunoscute_detalii"], [m], msg=html)
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=html)
        # aceleasi zone FARA semnal trec (zona prin clasa e un div neutru; zonele imbricate sunt structura). r15: clasa `input-area-container`
        # (din selectorul ZONA) nu apare in nicio captura, deci lista alba a claselor o refuza; regula zonei se verifica cu ea adaugata
        imbricate = ('<html><body><input-area-v2><input-container><div class="input-area-container">' + ed
                     + "</div></input-container></input-area-v2></body></html>")
        self.assertEqual(self.an(imbricate)["necunoscute_detalii"], ["atribut_valoare:div{class}"])
        with clase_in_plus("div", "input-area-container"):
            for html in ('<html><body><div class="input-area">' + ed + "</div></body></html>", imbricate):
                i = self.an(html)
                self.assertEqual((i["zone"], i["necunoscute"]), (1, 0), msg=i["necunoscute_detalii"])

    def test_chip_sau_semn_pe_zona_se_numara(self):
        # un semn de atasament (clasa *file-preview*, data-test-id) sau chiar un chip pe ELEMENTUL zonei se numara (r5 numara doar descendentii)
        for atr in (' class="file-preview-x"', ' data-test-id="uploaded-file-1"', ' data-test-id="file-preview"'):
            i = self.an(pagina(zona_atr=atr))
            self.assertEqual((i["atasamente"], i["semne"]), (0, 1), msg=atr)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina(zona_atr=atr))), ("ciorna_cu_atasamente", []), msg=atr)
        chip_zona = '<html><body><uploader-file-preview class="input-area">' + EDITOR_HTML.replace('class="input-area"', 'class="textarea-wrapper"') + "</uploader-file-preview></body></html>"
        i = self.an(chip_zona)
        self.assertEqual((i["zone"], i["atasamente"]), (1, 1))
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_fara_atasamente(i, 0, "t")
        self.assertEqual((c.exception.cod, c.exception.detaliu), ("ciorna_cu_atasamente", "t: 1 atasament(e) in ciorna - nu trimit"))
        self.assertEqual(ruleaza_trimite(gp, FakePg(chip_zona)), ("ciorna_cu_atasamente", []))

    def test_zona_nu_devine_control(self):
        # o zona gasita prin clasa care poarta data-test-id-ul butonului de model NU face textele din ea "eticheta" (ar ascunde un text necunoscut)
        # r16: textul de proba e "Carbon" = singurul text permis in butonul modelului (LOC_MODEL); in zona (LOC_ZONA) e text necunoscut
        ed = EDITOR_HTML.replace('class="input-area"', 'class="textarea-wrapper"')
        html = '<html><body><div class="input-area" data-test-id="bard-mode-menu-button"><span>Carbon</span>' + ed + "</div></body></html>"
        i = self.an(html)
        # r14: + data-test-id-ul modelului pe un div = valoare in afara listei albe (al doilea motiv, pe zona insasi)
        self.assertEqual(i["necunoscute_detalii"], ["atribut_valoare:div[data-test-id=bard-mode-menu-button]{data-test-id}", "text:carbon"])
        self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []))
        with fara_r13(gp):
            self.assertEqual(self.an(html)["necunoscute_detalii"], ["text:carbon"])
        # acelasi text intr-un buton de model descendent trece (LOC_MODEL); r16: orice alt text acolo = refuz (r2-r15: eticheta lui)
        self.assertEqual(self.an(zona_cu('<button data-test-id="bard-mode-menu-button"><span>Carbon</span></button>'))["necunoscute"], 0)
        self.assertEqual(self.an(zona_cu('<button data-test-id="bard-mode-menu-button"><span>Deep Research</span></button>'))["necunoscute_detalii"],
                         ["text_in_control:deep research"])

    def test_stare_arata_zona(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(pagina_calibrare("i", zona_atr=REPRO_R6["data_file_name"][0])))
        linii = out.getvalue().splitlines()
        self.assertIn("necunoscute in zona: 1", linii)
        self.assertIn("  necunoscut token_file:input-area-v2{data-file-name}", linii)
        self.assertTrue(any(l.startswith("paza ciorna: REFUZ ciorna_necunoscuta") for l in linii), linii)

    def test_mutanti_r6_lasa_brief_ul_sa_plece(self):
        # fiecare mutant readuce comportamentul din 807119f9 (sau slabeste repararea); scenariul lui pleaca la Enter pe mutant, refuz pe cod
        zona_veche = "    st = [(c, None, False) for c in reversed(zona.copii)]"     # linia din r5 (_necunoscute pornea de la copii), forma r7
        cazuri = (
            # (A) zona insasi nu mai e verificata in _necunoscute: toate cele sase reproduceri din verdict pleaca
            ([("    st = [(zona, None, False)]              # r6 (Jakarinos r5 P1): zona insasi, cu aceleasi reguli ca orice element; apoi continutul ei",
               zona_veche)],
             tuple(pagina(zona_atr=atr) for atr, _ in REPRO_R6.values()) + tuple(zona_cu(zona_atr=atr) for atr, _ in ZONA_VARIANTE.values())
             + (pagina_calibrare("iii", zona_atr=REPRO_R6["clasa"][0]),), "ciorna_necunoscuta"),
            # (B) chip-urile / semnele numarate doar pe descendenti: un semn sau un chip pe elementul zonei pleaca
            ([("        for n in _cu_descendenti(z):        # r6: si zona insasi (un chip / semn pe elementul zonei se numara)",
               "        for n in _descendenti(z):")],
             (pagina(zona_atr=' class="file-preview-x"'), pagina(zona_atr=' data-test-id="uploaded-file-1"'),
              '<html><body><uploader-file-preview class="input-area">' + EDITOR_HTML.replace('class="input-area"', 'class="textarea-wrapper"') + "</uploader-file-preview></body></html>"),
             "ciorna_cu_atasamente"),
            # (C) zona lasata sa devina control: textul din ea trece drept textul butonului modelului (r16: "Carbon", LOC_MODEL)
            ([("        if n is zona:", "        if False:")],
             ('<html><body><div class="input-area" data-test-id="bard-mode-menu-button"><span>Carbon</span>'
              + EDITOR_HTML.replace('class="input-area"', 'class="textarea-wrapper"') + "</div></body></html>",), "ciorna_necunoscuta"),
        )
        for inlocuiri, htmluri, cod in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), (cod, []), msg=html[:120])
                with fara_r13(mut):                 # r14: lista alba (al doilea strat) oprita doar in mutant
                    cod_m, act_m = ruleaza_trimite(mut, FakePg(html))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], html[:120], cod_m))
                self.assertIn("press Enter", act_m, msg=html[:120])
        # mutantul (A) inca refuza acelasi semnal pe un DESCENDENT (nu e zona): deci doar nivelul zonei e diferit
        mut = mutant([(cazuri[0][0][0][0], zona_veche)])
        self.assertEqual(ruleaza_trimite(mut, FakePg(zona_cu('<gem-icon data-file-name="oferta.docx"></gem-icon>')))[0], "ciorna_necunoscuta")


# --- v4.6.4 r7 (Jakarinos NO-GO pe 0a8ab9a3, P1): EDITORUL INSUSI verificat ca orice element (media / fundal CSS) si O SINGURA functie
# de semnale (_semnal), apelata dintr-un singur loc (_motiv_element), pentru TOATE nivelurile: zona, invelisurile de incredere, editorul,
# descendentii editorului, descendentii zonei ---
# reproducerea din verdict, copiata exact (pe 0a8ab9a3: atasamente 0, semne 0, necunoscute 0 -> press Enter), in locul editorului valid din teste
EDITOR_VERDICT = ('<div class="ql-editor textarea"\n     contenteditable="true" role="textbox"\n     style="background: url(/resource/1234)">\n'
                  '  <p>ciorna</p>\n</div>')
EDITOR_VERDICT_BLOB = EDITOR_VERDICT.replace("url(/resource/1234)", "url(blob:null/12345678-1234-1234-1234-123456789abc)")
EDITOR_DIV = '<div class="ql-editor textarea" contenteditable="true" role="textbox"><p>ciorna</p></div>'     # editorul din EDITOR_HTML
assert EDITOR_DIV in EDITOR_HTML
SEMNATURA_EDITOR = "div[role=textbox][contenteditable]"                                                     # scrisa de mana (ordinea r2)
FUNDAL_EDITOR = "semnal_in_editor:fundal:" + SEMNATURA_EDITOR


def editor_cu(atr):
    # editorul valid din teste cu atribute in plus pe ELEMENTUL editorului insusi
    return EDITOR_HTML.replace('contenteditable="true"', 'contenteditable="true"' + atr)


# variante pe editorul insusi (asteptat scris de mana): fundalul CSS in orice forma, fundal + alt semnal (fundalul e primul), semnalele r4 / r5
EDITOR_VARIANTE = {
    "fundal_blob": (' style="background-image: url(blob:x)"', FUNDAL_EDITOR),
    "fundal_data": (' style="--bg: url(data:image/png;base64,AAAA)"', FUNDAL_EDITOR),
    "fundal_majuscule_spatii": (' style="background : URL( /r/1 )"', FUNDAL_EDITOR),
    "fundal_a_doua_regula": (' style="color: red; background: url(x)"', FUNDAL_EDITOR),
    "fundal_si_fisier": (' style="background: url(x)" data-file-name="oferta.docx"', FUNDAL_EDITOR),
    "data_file_name": (' data-file-name="oferta.docx"', "semnal_in_editor:token_file:div[role=textbox][contenteditable]{ql-editor textarea data-file-name}"),
    "style_fisier": (' style="--x: oferta.docx"', "semnal_in_editor:atribut_fisier:div[role=textbox][contenteditable]{ql-editor textarea style}"),
    "title_fisier": (' title="oferta.docx"', "semnal_in_editor:eticheta:div[role=textbox][title=oferta.docx][contenteditable]"),
}
# editorul e chiar un element media (contenteditable pe canvas / img / iframe sub rich-textarea): semnalul "media:" pe editor
EDITOR_MEDIA = (
    ('<div class="input-area"><rich-textarea><canvas contenteditable="true"></canvas></rich-textarea></div>', "semnal_in_editor:media:canvas[contenteditable]"),
    ('<div class="input-area"><rich-textarea><img contenteditable="true"></rich-textarea></div>', "semnal_in_editor:media:img[contenteditable]"),
    ('<div class="input-area"><rich-textarea><iframe contenteditable="true"></iframe></rich-textarea></div>', "semnal_in_editor:media:iframe[contenteditable]"),
)
# calea legitima (L20): editorul cu stiluri / atribute FARA url( si fara nume de fisier / cuvant de atasament trece
EDITOR_CURAT = (
    ' style="min-height: 24px; color: rgb(0, 0, 0)"',
    ' style="background: none; --x: 1"',
    ' aria-label="Introdu o solicitare pentru Gemini" data-placeholder="Intreaba Gemini" spellcheck="true"',   # r13: eticheta reala (22.11)
    ' aria-multiline="true" aria-haspopup="menu"',
)
# acelasi atribut cu semnal pus pe FIECARE nivel analizat (tipul motivului asteptat, scris de mana; "pdf" e cuvant, deci .docx)
PARITATE_SEMNALE = {
    "fundal": (' style="background: url(/resource/1234)"', "fundal"),
    "fundal_blob": (' style="background-image: url(blob:x)"', "fundal"),
    "eticheta_fisier": (' title="oferta.docx"', "eticheta"),
    "eticheta_cuvant": (' title="Remove file"', "eticheta"),
    "nume_atribut": (' data-file-name="oferta.docx"', "token_file"),
    "nume_atribut_necunoscut": (' removeattachment=""', "token_attach"),
    "id_fisier": (' id="oferta.docx"', "atribut_fisier"),
    "valoare_cuvant": (' data-x="attachment"', "token_attach"),
    "valoare_fisier": (' data-x="oferta.docx"', "atribut_fisier"),
    "style_fisier": (' style="--x: oferta.docx"', "atribut_fisier"),
    "href_blob": (' href="blob:https://gemini.google.com/oferta.docx"', "atribut_fisier"),
}
_ED_X = EDITOR_HTML.replace('class="input-area"', 'class="textarea-wrapper"')      # editorul fara zona interioara (zona = invelisul dat de test)
# nivel -> pagina intreaga cu atributele `atr` pe elementul acelui nivel (editor = elementul editorului; in_editor = un span din editor)
NIVELURI = {
    "zona_input_area_v2": lambda atr: pagina(zona_atr=atr),
    "zona_prin_clasa": lambda atr: '<html><body><div class="input-area"%s>%s</div></body></html>' % (atr, _ED_X),
    "input_container": lambda atr: '<html><body><input-area-v2><input-container%s>%s</input-container></input-area-v2></body></html>' % (atr, EDITOR_HTML),
    "input_area_container": lambda atr: '<html><body><input-area-v2><div class="input-area-container"%s>%s</div></input-area-v2></body></html>' % (atr, _ED_X),
    "rich_textarea": lambda atr: pagina(editor=EDITOR_HTML.replace('<rich-textarea class="text-input-field_textarea"', '<rich-textarea class="text-input-field_textarea"' + atr)),
    "fieldset": lambda atr: zona_cu('<fieldset role="none"%s></fieldset>' % atr),
    "textarea_wrapper": lambda atr: zona_cu('<div data-test-id="textarea-wrapper"%s></div>' % atr),
    "div_editor_real": lambda atr: zona_cu('<div class="text-input-field simplified-input-area"%s%s></div>' % (ATRIBUTE_DIV_REALE, atr)),
    "editor": lambda atr: zona_cu(editor=editor_cu(atr)),
    # r18: elementul din editor = un <p> (singurul element cu text permis acolo; un span da si motivul formei Quill, al doilea strat)
    "in_editor": lambda atr: zona_cu(editor=EDITOR_HTML.replace("<p>ciorna</p>", "<p%s>ciorna</p>" % atr)),
    "structura_din_lista": lambda atr: zona_cu("<gem-icon%s></gem-icon>" % atr),
    "div_neutru": lambda atr: zona_cu("<div%s></div>" % atr),
    "control_din_lista": lambda atr: zona_cu('<button aria-label="Trimite mesajul"%s></button>' % atr),
    "butonul_modelului": lambda atr: zona_cu('<button data-test-id="bard-mode-menu-button"%s></button>' % atr),
}
NIVELURI_EDITOR = ("editor", "in_editor")                            # motivele lor poarta prefixul contextului


class TestEditorInsusi(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def refuz_fara_actiuni(self, html, m, mod=gp, msg=None):
        i = self.an(html, mod)
        self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"]), (1, 1, 0, 0), msg=msg)   # ce a masurat Jakarinos: 0 / 0
        self.assertEqual(i["necunoscute_detalii"], [m], msg=msg)                                             # ... dar acum 1 necunoscut
        self.assertEqual(ruleaza_trimite(mod, FakePg(html)), ("ciorna_necunoscuta", []), msg=msg)

    def test_reproducerea_din_verdict_refuzata_fara_actiuni(self):
        # fixture-ul din verdict (editorul valid din teste cu style="background: url(/resource/1234)", apoi url(blob:...)), in pagina
        # simpla, in zona cu controale si in pagina calibrata (cele trei stari); pe 0a8ab9a3 toate dadeau 0 / 0 / 0 si press Enter
        atr_verdict = ' style="background: url(/resource/1234)"'
        for ed in (EDITOR_VERDICT, EDITOR_VERDICT_BLOB):
            for html in (pagina(editor=EDITOR_HTML.replace(EDITOR_DIV, ed)), zona_cu(editor=EDITOR_HTML.replace(EDITOR_DIV, ed))):
                self.refuz_fara_actiuni(html, FUNDAL_EDITOR, msg=ed)
        for stare in ("i", "ii", "iii"):
            self.refuz_fara_actiuni(pagina_calibrare(stare, editor_atr=atr_verdict), FUNDAL_EDITOR, msg=stare)
        # cele trei momente: tab-ul curent (nicio actiune), chatul nou (doar goto), dupa scriere (fara Enter)
        rau = pagina(editor=EDITOR_HTML.replace(EDITOR_DIV, EDITOR_VERDICT))
        self.assertEqual(ruleaza_trimite(gp, FakePg(rau)), ("ciorna_necunoscuta", []))
        self.assertEqual(ruleaza_trimite(gp, FakePg(pagina(), dupa_goto=rau)), ("ciorna_necunoscuta", ["goto"]))
        cod, act = ruleaza_trimite(gp, FakePg(pagina(), dupa_scriere=rau))
        self.assertEqual(cod, "ciorna_necunoscuta")
        self.assertIn("insert", act)
        self.assertNotIn("press Enter", act)
        # acelasi stil pe <p> din editor (refuzat si in r6, ca "media_in_editor:p"): acum acelasi semnal "fundal:", cu prefixul contextului
        ed = EDITOR_HTML.replace("<p>ciorna</p>", '<p style="background: url(/resource/1234)">ciorna</p>')
        self.refuz_fara_actiuni(zona_cu(editor=ed), "semnal_in_editor:fundal:p")

    def test_fiecare_varianta_pe_editor_refuzata(self):
        for k, (atr, m) in sorted(EDITOR_VARIANTE.items()):
            self.refuz_fara_actiuni(zona_cu(editor=editor_cu(atr)), m, msg=k)
            self.refuz_fara_actiuni(pagina_calibrare("iii", editor_atr=atr), m, msg=k)
        # listele albe nu au nicio putere in editor: semnatura editorului cu semnal in STRUCTURA / CONTROALE = tot refuz
        with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (SEMNATURA_EDITOR, "div[role=textbox][title=oferta.docx][contenteditable]")), \
                mock.patch.object(gp, "CONTROALE_CUNOSCUTE", gp.CONTROALE_CUNOSCUTE + (SEMNATURA_EDITOR,)):
            for k, (atr, m) in sorted(EDITOR_VARIANTE.items()):
                self.refuz_fara_actiuni(zona_cu(editor=editor_cu(atr)), m, msg=k)

    def test_editorul_media_refuzat(self):
        # r17: un element media nu e editor PRINCIPAL (doar rich-textarea > div[role=textbox][contenteditable=true]): singur in rich-textarea
        # = niciun editor -> ciorna_necitibila, fara actiuni; langa editorul real = semnalul "media:" (in afara contextului editorului)
        for ed, m in EDITOR_MEDIA:
            i = self.an(pagina(editor=ed))
            self.assertEqual((i["editoare"], i["zone"]), (0, 0), msg=ed)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina(editor=ed))), ("ciorna_necitibila", []), msg=ed)
            media = ed.split("<rich-textarea>")[1].split("</rich-textarea>")[0]
            langa = pagina(editor=EDITOR_HTML.replace("</rich-textarea>", media + "</rich-textarea>"))
            self.refuz_fara_actiuni(langa, m[len("semnal_in_editor:"):], msg=ed)

    def test_editorul_curat_trece(self):
        # calea legitima (L20): editorul cu stiluri obisnuite / atribute de accesibilitate trece, pe fixture-urile simple si pe cele trei
        # stari calibrate; `trimite` ajunge la Enter
        # r14: regula r7 (semnalele) se judeca cu lista alba oprita; cu lista alba pornita, atributele nevazute in capturi (style cu alte
        # proprietati, spellcheck, aria-haspopup pe div) sunt refuzate pe editor (`semnal_in_editor:atribut_...`)
        for atr in EDITOR_CURAT:
            for html in (pagina(editor=editor_cu(atr)), zona_cu(editor=editor_cu(atr)),
                         pagina_calibrare("i", editor_atr=atr), pagina_calibrare("ii", editor_atr=atr), pagina_calibrare("iii", editor_atr=atr)):
                with fara_r13(gp):
                    i = self.an(html)
                    self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 0), msg=(atr, i["necunoscute_detalii"]))
                    self.assertEqual(ruleaza_trimite(gp, FakePg(html, dupa_goto=html)), (None, ACTIUNI_TRIMITERE), msg=atr)
                d = self.an(html)["necunoscute_detalii"]
                self.assertEqual(len(d), 1, msg=(atr, d))
                self.assertTrue(d[0].startswith(("semnal_in_editor:atribut_necunoscut:div[", "semnal_in_editor:atribut_valoare:div[")), msg=(atr, d))
        for atr in (' aria-label="Introdu o solicitare pentru Gemini" data-placeholder="\u00centreab\u0103 Gemini"', ' aria-multiline="true" style=""'):
            for html in (zona_cu(editor=editor_cu(atr)), pagina_calibrare("ii", editor_atr=atr)):
                self.assertEqual(self.an(html)["necunoscute"], 0, msg=atr)          # atributele reale ale editorului (22.11 / 23.11): trec
        # textul brief-ului din editor (cu nume de fisiere) nu e verificat aici (comparat separat), ca inainte
        self.assertEqual(self.an(zona_cu(editor=editor_cu(' style=""').replace("<p>ciorna</p>", "<p>vezi raport.pdf</p>")))["necunoscute"], 0)

    def test_paritate_acelasi_semnal_pe_orice_nivel(self):
        # L19: acelasi atribut cu semnal, pus pe ORICE nivel analizat (zona, invelisurile de incredere, editorul, un element din editor,
        # structura / controlul din lista, div neutru, butonul modelului), da ACELASI tip de motiv (scris de mana) si refuz fara actiuni;
        # in editor motivul poarta prefixul contextului, in afara lui nu
        for nivel, fab in sorted(NIVELURI.items()):
            for k, (atr, tip) in sorted(PARITATE_SEMNALE.items()):
                html = fab(atr)
                i = self.an(html)
                self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 1), msg=(nivel, k, i["necunoscute_detalii"]))
                m = i["necunoscute_detalii"][0]
                self.assertEqual(m.startswith("semnal_in_editor:"), nivel in NIVELURI_EDITOR, msg=(nivel, k, m))
                if nivel in NIVELURI_EDITOR:
                    m = m[len("semnal_in_editor:"):]
                self.assertEqual(m.split(":", 1)[0], tip, msg=(nivel, k, m))
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=(nivel, k))
            # acelasi nivel FARA semnal trece (calea legitima a fiecarui nivel). r15: zona prin clasa `input-area-container` (selectorul
            # ZONA) nu apare in capturi: lista alba a claselor o refuza; calea legitima a regulii semnalelor se verifica cu clasa adaugata
            if nivel == "input_area_container":
                self.assertEqual(self.an(fab(""))["necunoscute_detalii"], ["atribut_valoare:div{class}"])
            with clase_in_plus("div", "input-area-container"):
                i = self.an(fab(""))
            self.assertEqual((i["editoare"], i["zone"], i["necunoscute"]), (1, 1, 0), msg=(nivel, i["necunoscute_detalii"]))
        # media pe niveluri (nu se pune prin atribut): zona insasi, un invelis, un element din zona, editorul (EDITOR_MEDIA mai sus)
        for html, m in (('<html><body><canvas class="input-area">%s</canvas></body></html>' % _ED_X, "media:canvas"),
                        ('<html><body><input-area-v2><picture>%s</picture></input-area-v2></body></html>' % EDITOR_HTML, "media:picture"),
                        (zona_cu('<img src="x">'), "media:img[src]")):
            self.refuz_fara_actiuni(html, m, msg=m)

    def test_o_singura_functie_de_semnale(self):
        # structural: _semnal e definit o data si apelat dintr-un singur loc (_motiv_element), care e apelat dintr-un singur loc
        # (traseul unic din _necunoscute); nu mai exista _motiv_editor / media_in_editor; media si "url(" se verifica DOAR in _semnal,
        # iar in _motiv_element semnalul vine inaintea oricarui return
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        linii = [l.rstrip("\r") for l in src.split("\n")]
        cod = [l for l in linii if not l.lstrip().startswith("#")]                   # (antetul povesteste istoria, inclusiv _motiv_editor)
        self.assertFalse(any("_motiv_editor" in l for l in cod))
        self.assertFalse(any("media_in_editor" in l for l in cod))
        self.assertEqual(linii.count("def _semnal(n):"), 1)
        self.assertEqual(sum(l.count("_semnal(") for l in cod), 2)                    # definitia + singurul apel
        self.assertEqual(linii.count("    s = _semnal(n)"), 1)
        self.assertEqual(linii.count("def _motiv_element(n, ctrl, in_editor=False):"), 1)
        self.assertEqual(sum(l.count("_motiv_element(") for l in cod), 2)             # definitia + singurul apel
        self.assertEqual(linii.count("        m, ctrl_copii, sursa = _motiv_element(n, ctrl, in_editor)"), 1)
        # r8: sursa afisata de `stare` vine din acelasi _semnal (al doilea element al rezultatului) si nu intra in nicio decizie:
        # paza (verifica_fara_atasamente) nu citeste necunoscute_surse, iar _sursa_cuvant e apelata doar din _semnal
        i_vf = linii.index("def verifica_fara_atasamente(info, semn_locator, moment):")
        i_urm = next(k for k in range(i_vf + 1, len(linii)) if linii[k].startswith("def "))
        self.assertFalse(any("surse" in l for l in linii[i_vf:i_urm]))
        self.assertEqual(sum(l.count("_sursa_cuvant(") for l in cod), 3)             # definitia + cele doua apeluri (ambele in _semnal, mai jos)
        self.assertEqual(sum(l.count('"url(" in') for l in cod), 1)
        self.assertEqual(sum(l.count("n.tag in MEDIA") for l in cod), 1)
        i_sem = linii.index("def _semnal(n):")
        i_urm = next(k for k in range(i_sem + 1, len(linii)) if linii[k].startswith("def "))
        corp_semnal = "\n".join(linii[i_sem:i_urm])
        self.assertIn('    if "url(" in _ascii(n.attrs.get("style")):', corp_semnal)
        self.assertIn("    if n.tag in MEDIA:", corp_semnal)
        self.assertEqual(corp_semnal.count("_sursa_cuvant("), 2)                     # r8: sursa se calculeaza doar in _semnal
        i_me = linii.index("def _motiv_element(n, ctrl, in_editor=False):")
        i_s = linii.index("    s = _semnal(n)")
        self.assertLess(i_me, i_s)
        self.assertFalse(any("return" in l for l in linii[i_me:i_s]), linii[i_me:i_s])
        # editorul nu are nicio ramura proprie inaintea traseului unic (singura linie cu `editoare` din _necunoscute seteaza contextul)
        i_nec = linii.index("def _necunoscute(zona, editoare, ids=None):")
        i_urm = next(k for k in range(i_nec + 1, len(linii)) if linii[k].startswith("def "))
        corp = [l for l in linii[i_nec:i_urm] if "editoare" in l and not l.lstrip().startswith("#")]
        self.assertEqual(corp, ["def _necunoscute(zona, editoare, ids=None):", "        if any(n is e for e in editoare):"])

    def test_stare_arata_editorul(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(pagina_calibrare("i", editor_atr=' style="background: url(/resource/1234)"')))
        linii = out.getvalue().splitlines()
        self.assertIn("necunoscute in zona: 1", linii)
        self.assertIn("  necunoscut " + FUNDAL_EDITOR, linii)
        self.assertTrue(any(l.startswith("paza ciorna: REFUZ ciorna_necunoscuta") for l in linii), linii)

    def test_mutanti_r7_lasa_brief_ul_sa_plece(self):
        # fiecare mutant readuce lacuna din 0a8ab9a3 (sau o generalizeaza); scenariul lui pleaca la Enter pe mutant, refuz pe cod.
        # ("background:", nu "background-image:": "image" e cuvant de atasament si ar refuza si pe mutant)
        verdict = pagina(editor=EDITOR_HTML.replace(EDITOR_DIV, EDITOR_VERDICT))
        verdict_blob = zona_cu(editor=EDITOR_HTML.replace(EDITOR_DIV, EDITOR_VERDICT_BLOB))
        cazuri = (
            # (M1) fundalul CSS nu mai e semnal in _semnal: editorul din verdict pleaca - si o structura din lista / zona cu fundal
            # (aceeasi functie serveste toate nivelurile)
            ([('    if "url(" in _ascii(n.attrs.get("style")):', "    if False:")],
             (verdict, verdict_blob, pagina_calibrare("i", editor_atr=' style="background: url(/resource/1234)"'),
              zona_cu('<gem-icon style="background: url(blob:x)"></gem-icon>'), pagina(zona_atr=' style="background: url(blob:x)"'))),
            # (M2) = clasa de defect r6: editorul insusi e tratat ca "de incredere" (sarit din traseul unic): fundalul si atributul de pe el pleaca
            ([("        m, ctrl_copii, sursa = _motiv_element(n, ctrl, in_editor)",
               '        m, ctrl_copii, sursa = (None, ctrl, "") if any(n is e for e in editoare) else _motiv_element(n, ctrl, in_editor)')],
             (verdict, verdict_blob, zona_cu(editor=editor_cu(' data-file-name="oferta.docx"')), zona_cu(editor=editor_cu(' title="oferta.docx"')))),
        )
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=html[-160:])
                with fara_r13(mut), fara_r18(mut):  # r14 / r18: lista alba si forma editorului (straturi noi) oprite doar in mutant
                    cod_m, act_m = ruleaza_trimite(mut, FakePg(html))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], html[-160:], cod_m))
                self.assertIn("press Enter", act_m, msg=html[-160:])
        # mutantul (M2) inca refuza acelasi semnal pe un DESCENDENT al editorului: deci doar nivelul editorului e diferit (ca in r6)
        mut2 = mutant(cazuri[1][0])
        for ed in (EDITOR_HTML.replace("<p>ciorna</p>", '<p style="background: url(/resource/1234)">ciorna</p>'),
                   EDITOR_HTML.replace("<p>ciorna</p>", '<p>ciorna<span class="ql-attachment-chip"></span></p>')):
            self.assertEqual(ruleaza_trimite(mut2, FakePg(zona_cu(editor=ed)))[0], "ciorna_necunoscuta")
        # (M3) media scos din _semnal: pe cod intrarea "img[src]" din lista nu acopera imaginea, pe mutant o acopera (brief-ul pleaca);
        # editorul-media ramane refuzat si pe mutant (element_in_editor: verificare dubla acolo, nu discrimineaza)
        mut3 = mutant([("    if n.tag in MEDIA:", "    if False:")])
        with mock.patch.object(mut3, "CONTROALE_CUNOSCUTE", mut3.CONTROALE_CUNOSCUTE + ("img[src]",)), fara_r13(mut3):     # r14: src nu e in lista alba
            cod_m, act_m = ruleaza_trimite(mut3, FakePg(zona_cu('<img src="x">')))
            self.assertIsNone(cod_m)
            self.assertIn("press Enter", act_m)
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", gp.CONTROALE_CUNOSCUTE + ("img[src]",)):
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu('<img src="x">'))), ("ciorna_necunoscuta", []))
        # r17: editorul-media nu mai e editor principal -> niciun editor -> ciorna_necitibila si pe mutant (nu discrimineaza)
        self.assertEqual(ruleaza_trimite(mut3, FakePg(pagina(editor=EDITOR_MEDIA[0][0])))[0], "ciorna_necitibila")


# --- v4.6.4b / r8 (22.11.2026): 5a PICAT pe v4.6.4 instalat (A03E2B5C): pagina Gemini s-a schimbat dupa calibrarea din 21.11 ---
# cele trei linii `necunoscut`, copiate EXACT din paw_v464_calibrare\stare_22_11_dupa_instalare.txt (chat NOU gol, Carbon, dupa Esc + F5,
# de doua ori acelasi rezultat) - sursa independenta a fixture-urilor si a regulii de mai jos
STARE_22_11 = (
    "token_file:file-drop-indicator{data-filedrop-id}",
    "token_incarca:gem-icon-button[type=onsurface]{menu-button gem-menu-button open gem-button gem-button-badge-size-small gem-butt}",
    "semnal_in_editor:token_chip:div[role=textbox][aria-label=introdu o solicitare pentru gemini][contenteditable]"
    "{ql-editor ql-blank textarea new-input-ui rich-query-formatting-enabled input-url}",
)
# ce se VEDE in captura, si doar atat (scris de mana din liniile de mai sus): clasele butonului "+" (a sasea e taiata: "gem-butt..."),
# clasele si eticheta editorului gol; valoarea lui data-filedrop-id NU apare in captura
CLASE_PLUS_22_11 = "menu-button gem-menu-button open gem-button gem-button-badge-size-small"
CLASE_EDITOR_22_11 = "ql-editor ql-blank textarea new-input-ui rich-query-formatting-enabled input-url"
ETICHETA_EDITOR_22_11 = "Introdu o solicitare pentru Gemini"
# r15: in pagina reconstituita din captura (pagina_22_11) intra doar token-urile de clasa INTREGI ale editorului: ultimul, "input-url", e
# prefixul taiat al lui "input-url-linkification-enabled" (CLASE_EDITOR_REALE) si ar fi - corect - un token necunoscut pentru lista r15
CLASE_EDITOR_22_11_INTREGI = CLASE_EDITOR_22_11.rsplit(" ", 1)[0]
assert CLASE_EDITOR_22_11_INTREGI.split() == CLASE_EDITOR_22_11.split()[:-1] and CLASE_EDITOR_22_11.endswith(" input-url")
FDI_22_11 = '<file-drop-indicator _ngcontent-ng-c1694197906="" data-filedrop-id="%s"%s></file-drop-indicator>'
DOAR_MARCAJ_R5 = dict(MARCAJE_PERMISE=getattr(gp, "MARCAJE_PERMISE", ())[:1])   # = marcajele din v4.6.4 instalat (fara data-filedrop-id)
TOKEN_FDI = "token_file:file-drop-indicator{data-filedrop-id}"
# r8 accepta orice identificator (scris de mana: numar, gol, uuid, nume cu liniuta / underscore, 64 de caractere); r9 le REFUZA pe toate -
# singura valoare acceptata e cea reala, FILEDROP_REAL (mai jos)
IDENTIFICATORI_R8 = ("1", "0", "", "4f3a0b2c-1d2e-4f5a-8b9c-0d1e2f3a4b5c", "drop_zone-7", "A", "x" * 64)

# --- r9 (v4.6.4b r2, 22.11.2026): atributele COMPLETE ale celor 3 elemente semnalate (+ microfonul, citit odata cu ele), copiate EXACT din
# paw_v464_calibrare\atribute_complete_22_11.txt (citite de chat prin CDP din pagina reala, doar citire, chat nou gol, dupa Esc + F5) -
# sursa independenta a exceptiilor r9 si a fixture-ului pagina_22_11_completa ---
FILEDROP_REAL = "chat-window-input-container"
FDI_REAL_ATR = (' _ngcontent-ng-c2231844863="" _nghost-ng-c3042269636="" class="ng-tns-c3042269636-6 ng-tns-c2231844863-2 ng-star-inserted"'
                ' data-filedrop-id="' + FILEDROP_REAL + '"')
FDI_REAL = "<file-drop-indicator" + FDI_REAL_ATR + "></file-drop-indicator>"
ARIALABEL_REAL = "\u00cenc\u0103rcare \u0219i instrumente"                        # = eticheta butonului interior calibrata la 21.11
CLASE_PLUS_REALE = ("menu-button gem-menu-button open gem-button gem-button-badge-size-small gem-button-size-small "
                    "gem-button-type-on-surface lm-enabled")
PLUS_REAL_ATR = (' _ngcontent-ng-c3880200785="" theme="lm" type="onSurface" ariahaspopup="menu" arialabel="' + ARIALABEL_REAL + '"'
                 ' class="' + CLASE_PLUS_REALE + '" _nghost-ng-c1895945073=""')
MIC_REAL_ATR = (' _ngcontent-ng-c1747215105="" type="onSurface" class="mat-mdc-tooltip-trigger speech_dictation_mic_button gem-button'
                ' gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled" _nghost-ng-c1895945073=""'
                ' aria-describedby="cdk-describedby-message-ng-1-2" cdk-describedby-host="ng-1"')
CLASE_EDITOR_REALE = ("ql-editor ql-blank textarea new-input-ui rich-query-formatting-enabled input-url-linkification-enabled "
                      "inline-chips-enabled")
EDITOR_REAL_ATR_FARA_CLASA = (' data-gramm="false" contenteditable="true" dir="ltr" role="textbox" aria-multiline="true"'
                              ' aria-label="' + ETICHETA_EDITOR_22_11 + '" data-placeholder="\u00centreab\u0103 Gemini" style=""')
EDITOR_REAL_ATR = ' class="' + CLASE_EDITOR_REALE + '"' + EDITOR_REAL_ATR_FARA_CLASA
assert CLASE_PLUS_REALE.startswith(CLASE_PLUS_22_11 + " gem-butt") and CLASE_EDITOR_REALE.startswith(CLASE_EDITOR_22_11)
# liniile (2) si (3) din captura, INTREGI (scrise de mana din atributele complete): clasele toate + numele atributelor din afara semnaturii,
# sortate, fara cele generate; sursele asteptate ale celor trei linii
LINIA_2_INTREAGA = "token_incarca:gem-icon-button[type=onsurface]{" + CLASE_PLUS_REALE + " ariahaspopup arialabel theme}"
LINIA_3_INTREAGA = ("semnal_in_editor:token_chip:div[role=textbox][aria-label=introdu o solicitare pentru gemini][contenteditable]{"
                    + CLASE_EDITOR_REALE + " aria-multiline data-gramm data-placeholder dir style}")
SURSE_22_11 = ("nume_atribut:data-filedrop-id=" + FILEDROP_REAL, "valoare_atribut:arialabel=incarcare si instrumente", "clasa:inline-chips-enabled")
REGULI_V464 = dict(DOAR_MARCAJ_R5, VALORI_PERMISE=(), CLASE_EDITOR_PERMISE=())                            # = v4.6.4 instalat (A03E2B5C)
REGULI_R8 = dict(VALORI_PERMISE=(), CLASE_EDITOR_PERMISE=())                                              # = r8 (916494a8): doar marcajul


def pagina_22_11_completa(stare="i", fdi=FDI_REAL, plus_atr=PLUS_REAL_ATR, mic_atr=MIC_REAL_ATR, editor_atr=EDITOR_REAL_ATR, extra_zona=""):
    # pagina calibrata la 21.11 (datele reale ale zonei / div-ului / linkului) + cele patru elemente cu atributele COMPLETE citite la 22.11:
    # indicatorul de drop, butonul "+", microfonul, editorul gol. Fiecare inlocuire se face o singura data.
    html = pagina_calibrare(stare)
    inlocuiri = (
        ("<file-drop-indicator></file-drop-indicator>", fdi),
        ('<gem-icon-button type="onSurface"><button aria-label="\u00cenc\u0103rcare',
         "<gem-icon-button" + plus_atr + '><button aria-label="\u00cenc\u0103rcare'),
        ('<gem-icon-button type="onSurface" aria-describedby="cdk-describedby-message-ng-1-2">', "<gem-icon-button" + mic_atr + ">"),
        ('<div class="ql-editor textarea" contenteditable="true" role="textbox"', "<div" + editor_atr),
        ('<div class="text-input-field-main-area">', '<div class="text-input-field-main-area">' + extra_zona),
    )
    for vechi, nou in inlocuiri:
        assert html.count(vechi) == 1, vechi
        html = html.replace(vechi, nou)
    return html


def editor_real(clase=CLASE_EDITOR_REALE, extra=""):
    # editorul din testele de zona (EDITOR_HTML) cu atributele reale ale editorului din 22.11; clase / atribute in plus la cerere
    return EDITOR_HTML.replace('<div class="ql-editor textarea" contenteditable="true" role="textbox">',
                               '<div class="' + clase + '"' + EDITOR_REAL_ATR_FARA_CLASA + extra + ">")


def plus_real(atr=PLUS_REAL_ATR, inauntru=""):
    return "<gem-icon-button" + atr + ">" + inauntru + "</gem-icon-button>"


def pagina_22_11(valoare=FILEDROP_REAL, fdi_extra="", plus_extra="", editor_extra="", stare="i", extra_zona=""):
    # pagina calibrata la 21.11 (cu datele reale ale zonei / div-ului / linkului) + ce a aratat 5a pe 22.11: indicatorul de drop cu
    # data-filedrop-id, butonul "+" cu clasele vazute, editorul gol cu clasele si eticheta vazute. Fiecare inlocuire se face o singura data.
    html = pagina_calibrare(stare)
    inlocuiri = (
        ("<file-drop-indicator></file-drop-indicator>", FDI_22_11 % (valoare, fdi_extra)),
        ('<gem-icon-button type="onSurface"><button aria-label="\u00cenc\u0103rcare',
         '<gem-icon-button type="onSurface" class="' + CLASE_PLUS_22_11 + '"' + plus_extra + '><button aria-label="\u00cenc\u0103rcare'),
        ('<div class="ql-editor textarea" contenteditable="true" role="textbox"',
         '<div class="' + CLASE_EDITOR_22_11_INTREGI + '" aria-label="' + ETICHETA_EDITOR_22_11 + '" contenteditable="true" role="textbox"' + editor_extra),
        ('<div class="text-input-field-main-area">', '<div class="text-input-field-main-area">' + extra_zona),
    )
    for vechi, nou in inlocuiri:
        assert html.count(vechi) == 1, vechi
        html = html.replace(vechi, nou)
    return html


class TestPagina2211(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def stare_linii(self, html, mod=gp):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            mod.stare(FakePg(html))
        return out.getvalue().splitlines()

    def test_liniile_din_5a_sunt_semnale_nu_semnaturi_calibrabile(self):
        # toate cele trei linii sunt semnale (token_...), cu {...}: nicio lista alba nu le poate acoperi (P1 r4) si niciuna nu e o
        # semnatura `element:` / `text:` de trecut in liste -> listele raman cele de la 21.11 (test_listele_livrate_si_locatorul: 5 + 23 + 3)
        for l in STARE_22_11:
            self.assertTrue(l.startswith(("token_", "semnal_in_editor:token_")), l)
            self.assertIn("{", l)
        # liniile (2) si (3): partea afisata a lui {...} are EXACT 80 de caractere (limita r4-r7) si NU contine cuvantul din motiv
        for l, cuvant in ((STARE_22_11[1], "incarca"), (STARE_22_11[2], "chip")):
            acolade = l[l.index("{") + 1:-1]
            self.assertEqual(len(acolade), 80, acolade)
            self.assertNotIn(cuvant, acolade)
            self.assertIsNone(gp._cuvant(acolade), acolade)
        # linia (1): {...} intreg (16 caractere) = un singur atribut neafisat separat, fara clase, fara id -> sursa e NUMELE lui
        self.assertEqual(STARE_22_11[0][STARE_22_11[0].index("{") + 1:-1], "data-filedrop-id")
        self.assertEqual(gp._cuvant("data-filedrop-id"), "file")
        # "open" si "input-url" (interpretarea din brief) NU sunt cuvinte de atasament si nu sunt verificate ca URL ("url(" doar in style)
        for t in ("open", "input-url", "url", CLASE_PLUS_22_11, CLASE_EDITOR_22_11, gp._ascii(ETICHETA_EDITOR_22_11)):
            self.assertIsNone(gp._cuvant(t), t)
            self.assertIsNone(gp._nume_fisier(gp._ascii(t)), t)
        self.assertNotIn("open", gp.TOKENI_ATAS)
        self.assertNotIn("url", gp.TOKENI_ATAS)

    def test_linia_1_se_reproduce_pe_v464_si_trece_pe_v464b(self):
        # cu regulile din v4.6.4 instalat (fara marcajul data-filedrop-id), pagina din 22.11 da EXACT linia (1) din captura - si nimic
        # altceva: butonul "+" si editorul cu clasele vazute trec (deci liniile (2) si (3) vin din afara partii afisate); refuz fara actiuni
        for valoare in (FILEDROP_REAL,) + IDENTIFICATORI_R8:
            with mock.patch.multiple(gp, **DOAR_MARCAJ_R5):
                i = self.an(pagina_22_11(valoare))
                self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"]), (1, 1, 0, 0), msg=valoare)
                self.assertEqual(i["necunoscute_detalii"], [STARE_22_11[0]], msg=valoare)
                self.assertEqual(i["necunoscute_surse"], ["nume_atribut:data-filedrop-id=" + valoare.lower()], msg=valoare)
                self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11(valoare))), ("ciorna_necunoscuta", []), msg=valoare)
                linii = self.stare_linii(pagina_22_11(valoare))
                self.assertIn("  necunoscut " + STARE_22_11[0], linii)
                self.assertIn("    sursa nume_atribut:data-filedrop-id=" + valoare.lower(), linii)
        # v4.6.4b r9: regula marcajului (valoarea reala EXACTA) -> 0 necunoscute in toate cele trei stari, paza OK, `trimite` ajunge la Enter
        for stare in ("i", "ii", "iii"):
            i = self.an(pagina_22_11(stare=stare))
            self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 0),
                             msg=(stare, i["necunoscute_detalii"]))
            self.assertEqual(gp.verifica_fara_atasamente(i, 0, "t"), 0)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11(stare=stare), dupa_goto=pagina_22_11())), (None, ACTIUNI_TRIMITERE), msg=stare)
        # r9: identificatorii acceptati de r8 sunt REFUZATI (numele revine in cautare, cu valoarea in sursa) - singura valoare e cea reala
        for valoare in IDENTIFICATORI_R8:
            i = self.an(pagina_22_11(valoare))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]),
                             ([STARE_22_11[0]], ["nume_atribut:data-filedrop-id=" + valoare.lower()]), msg=valoare)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11(valoare))), ("ciorna_necunoscuta", []), msg=valoare)
        linii = self.stare_linii(pagina_22_11())
        self.assertIn("necunoscute in zona: 0", linii)
        self.assertIn("paza ciorna: OK (trimite ar continua)", linii)
        self.assertFalse(any(l.startswith("    sursa") for l in linii))
        # listele albe singure n-ar fi ajutat: file-drop-indicator E deja in STRUCTURA, iar semnatura cu {...} in liste nu acopera semnalul
        self.assertIn("file-drop-indicator", gp.STRUCTURA_CUNOSCUTA)
        with mock.patch.multiple(gp, **DOAR_MARCAJ_R5), mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (STARE_22_11[0].split(":", 1)[1],)):
            self.assertEqual(self.an(pagina_22_11())["necunoscute_detalii"], [STARE_22_11[0]])
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11())), ("ciorna_necunoscuta", []))

    def test_pagina_22_11_cu_fisier_tot_ciorna_cu_atasamente(self):
        # aceeasi pagina + un chip real (ca la 5b / stare_ii-iii cu fisier): numararea si refuzul raman neschimbate, inainte de orice actiune
        for n, fisiere in ((1, ("a.txt",)), (2, ("a.txt", "b.png"))):
            html = pagina_22_11(extra_zona="".join(chip(f) for f in fisiere))
            i = self.an(html)
            self.assertEqual(i["atasamente"], n)
            with self.assertRaises(gp.GemEroare) as c:
                gp.verifica_fara_atasamente(i, 0, "t")
            self.assertEqual((c.exception.cod, c.exception.detaliu), ("ciorna_cu_atasamente", "t: %d atasament(e) in ciorna - nu trimit" % n))
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_cu_atasamente", []))
            self.assertIn("atasamente in ciorna: %d" % n, " ".join(self.stare_linii(html)))
        # chip-ul chiar in indicatorul de drop se numara (r9: indicatorul cu un copil nu mai e nici marcaj -> si token_file); un semn fara chip = refuz
        i = self.an(pagina_22_11().replace("></file-drop-indicator>", ">" + chip("a.txt") + "</file-drop-indicator>"))
        self.assertEqual((i["atasamente"], i["necunoscute_detalii"]), (1, [TOKEN_FDI]))
        self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11(), dupa_goto=pagina_22_11(extra_zona=chip("a.txt")))), ("ciorna_cu_atasamente", ["goto"]))

    def test_indicatorul_de_drop_nu_poate_masca_un_atasament(self):
        # scris de mana: tot ce se abate de la marcajul EXACT (nume, element fara clase, valoarea reala, r9: niciun alt atribut / copil) sau
        # poarta altceva = refuz fara nicio actiune, cu motivele si sursele asteptate. Orice abatere readuce numele `data-filedrop-id` in
        # cautare: cuvantul "file" e primul din TOKENI_ATAS, deci motivul e token_file cu sursa numele (si valoarea lui), oricare ar fi
        # celalalt semn de pe element; copiii se verifica in continuare, element cu element (al doilea motiv).
        fdi_real = lambda extra_atr="", inauntru="": "<file-drop-indicator" + FDI_REAL_ATR + extra_atr + ">" + inauntru + "</file-drop-indicator>"
        sursa_fdi = "nume_atribut:data-filedrop-id=" + FILEDROP_REAL
        valori = ("oferta.docx", "a b", "1.2", "x" * 65, "a:b", "a/b", "\u0219",            # r8: forma gresita
                  "file-1", "attachment", "upload_7",                                       # r8: identificator cu cuvant (r9: numele intai)
                  FILEDROP_REAL + "-2", FILEDROP_REAL[:-1], "Chat-Window-Input-Container",   # r9: aproape valoarea reala
                  " " + FILEDROP_REAL, FILEDROP_REAL + " ")                                 # r9: valoarea BRUTA conteaza (spatiu la capete)
        cazuri = [(FDI_22_11 % (v, ""), [TOKEN_FDI], ["nume_atribut:data-filedrop-id=" + gp._ascii(v)]) for v in valori] + [
            # alt element cu acelasi atribut si valoarea reala: numele e cuvant de atasament
            ('<div data-filedrop-id="%s"></div>' % FILEDROP_REAL, ["token_file:div{data-filedrop-id}"], [sursa_fdi]),
            ('<gem-icon data-filedrop-id="%s"></gem-icon>' % FILEDROP_REAL, ["token_file:gem-icon{data-filedrop-id}"], [sursa_fdi]),
            ('<toolbox-drawer data-filedrop-id=""></toolbox-drawer>', ["token_file:toolbox-drawer{data-filedrop-id}"], ["nume_atribut:data-filedrop-id="]),
            ('<button aria-label="Trimite mesajul" data-filedrop-id="%s"></button>' % FILEDROP_REAL,
             ["token_file:button[aria-label=trimite mesajul]{data-filedrop-id}"], [sursa_fdi]),
            # indicatorul REAL + o singura abatere (r9, izolat): o clasa negenerata, un id, orice alt atribut (si gol, si Angular NEGOL)
            (FDI_REAL.replace('ng-star-inserted"', 'ng-star-inserted x"'), ["token_file:file-drop-indicator{x data-filedrop-id}"], [sursa_fdi]),
            (fdi_real(' id="preview-7"'), ["token_file:file-drop-indicator{#preview-7 data-filedrop-id}"], [sursa_fdi]),
            (fdi_real(' id="oferta.docx"'), ["token_file:file-drop-indicator{#oferta.docx data-filedrop-id}"], [sursa_fdi]),
            (fdi_real(' data-x="1"'), ["token_file:file-drop-indicator{data-filedrop-id data-x}"], [sursa_fdi]),
            (fdi_real(' jslog="1"'), ["token_file:file-drop-indicator{data-filedrop-id jslog}"], [sursa_fdi]),
            (fdi_real(' trace=""'), ["token_file:file-drop-indicator{data-filedrop-id trace}"], [sursa_fdi]),
            (fdi_real(' _ngcontent-ng-c1="x"'), [TOKEN_FDI], [sursa_fdi]),
            (fdi_real(' data-file-name="oferta.docx"'), ["token_file:file-drop-indicator{data-file-name data-filedrop-id}"], [sursa_fdi]),
            (fdi_real(' removeattachment=""'), ["token_file:file-drop-indicator{data-filedrop-id removeattachment}"], [sursa_fdi]),
            (fdi_real(' data-x="oferta.docx"'), ["token_file:file-drop-indicator{data-filedrop-id data-x}"], [sursa_fdi]),
            (fdi_real(' title="oferta.docx"'), ["eticheta:file-drop-indicator[title=oferta.docx]"], ["eticheta:title=oferta.docx"]),
            (fdi_real(' aria-label="Remove file"'), ["eticheta:file-drop-indicator[aria-label=remove file]"], ["eticheta:aria-label=remove file"]),
            (fdi_real(' style="background: url(x)"'), ["fundal:file-drop-indicator"], ["style:background: url(x)"]),
            # alt nume de atribut (prefix / sufix / alt cuvant), cu valoarea reala
            ('<file-drop-indicator data-filedrop-name="%s"></file-drop-indicator>' % FILEDROP_REAL,
             ["token_file:file-drop-indicator{data-filedrop-name}"], ["nume_atribut:data-filedrop-name=" + FILEDROP_REAL]),
            ('<file-drop-indicator data-filedrop-id-x="%s"></file-drop-indicator>' % FILEDROP_REAL,
             ["token_file:file-drop-indicator{data-filedrop-id-x}"], ["nume_atribut:data-filedrop-id-x=" + FILEDROP_REAL]),
            ('<file-drop-indicator filedrop-id="%s"></file-drop-indicator>' % FILEDROP_REAL,
             ["token_file:file-drop-indicator{filedrop-id}"], ["nume_atribut:filedrop-id=" + FILEDROP_REAL]),
            # marcajul r5 pe indicator / marcajul r8 pe div-ul r5: fiecare e permis DOAR pe elementul lui
            ('<file-drop-indicator xapfileselectordropzone=""></file-drop-indicator>', ["token_file:file-drop-indicator{xapfileselectordropzone}"],
             ["nume_atribut:xapfileselectordropzone="]),
            (DIV_FARA_NG % (' data-filedrop-id="%s"' % FILEDROP_REAL), ["token_file:div{text-input-field simplified-input-area data-filedrop-id}"], [sursa_fdi]),
            # r9: indicatorul REAL cu un copil (element neutru, text, nume de fisier, imagine, card, text cu cuvant, text necunoscut) nu mai e
            # marcaj (token_file), iar copilul se verifica si el
            (fdi_real(inauntru="<div></div>"), [TOKEN_FDI], [sursa_fdi]),
            (fdi_real(inauntru="x"), [TOKEN_FDI, "text:x"], [sursa_fdi, ""]),
            (fdi_real(inauntru="<span>oferta.docx</span>"), [TOKEN_FDI, "text_fisier:oferta.docx"], [sursa_fdi, ""]),
            (fdi_real(inauntru='<img src="x">'), [TOKEN_FDI, "media:img[src]"], [sursa_fdi, "tag:img"]),
            (fdi_real(inauntru="<attachment-card></attachment-card>"), [TOKEN_FDI, "element:attachment-card"], [sursa_fdi, ""]),
            (fdi_real(inauntru="<span>Trage fisierele aici</span>"), [TOKEN_FDI, "text_atasament:trage fisierele aici"], [sursa_fdi, ""]),
            (fdi_real(inauntru="<span>Arunca aici</span>"), [TOKEN_FDI, "text:arunca aici"], [sursa_fdi, ""]),
        ]
        for extra, motive, surse in cazuri:
            i = self.an(zona_cu(extra))
            self.assertEqual((i["atasamente"], i["semne"]), (0, 0), msg=extra)
            self.assertEqual(i["necunoscute_detalii"], motive, msg=extra)
            self.assertEqual(i["necunoscute_surse"], surse, msg=extra)
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []), msg=extra)
            # semnatura exacta a abaterii in liste: tot refuz (semnalele se verifica inaintea listelor)
            with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (motive[0].split(":", 1)[1],)):
                self.assertEqual(self.an(zona_cu(extra))["necunoscute_detalii"], motive, msg=extra)
        # pe zona si pe editor, cu valoarea reala
        self.assertEqual(self.an(pagina(zona_atr=' data-filedrop-id="%s"' % FILEDROP_REAL))["necunoscute_detalii"], ["token_file:input-area-v2{data-filedrop-id}"])
        self.assertEqual(self.an(zona_cu(editor=editor_cu(' data-filedrop-id="%s"' % FILEDROP_REAL)))["necunoscute_detalii"],
                         ["semnal_in_editor:token_file:div[role=textbox][contenteditable]{ql-editor textarea data-filedrop-id}"])
        # calea legitima (L20): indicatorul EXACT (atributele reale complete; doar atributul; cu / fara clasele si atributele generate goale;
        # cu spatii albe inauntru, care nu sunt text) -> trece, ca element din STRUCTURA
        for extra in (FDI_REAL, '<file-drop-indicator data-filedrop-id="%s"></file-drop-indicator>' % FILEDROP_REAL,
                      FDI_22_11 % (FILEDROP_REAL, ""), FDI_22_11 % (FILEDROP_REAL, ' class="ng-star-inserted"'), fdi_real(inauntru="\n  ")):
            i = self.an(zona_cu(extra))
            self.assertEqual(i["necunoscute"], 0, msg=(extra, i["necunoscute_detalii"]))
        # fara regula (= v4.6.4): acelasi indicator e refuzat cu linia din captura; cu clasele mari (mutantul "doar tagul") NU: vezi mutantii
        with mock.patch.multiple(gp, **DOAR_MARCAJ_R5):
            self.assertEqual(self.an(zona_cu(FDI_REAL))["necunoscute_detalii"], [TOKEN_FDI])

    def test_captura_e_consecventa_cu_o_sursa_dincolo_de_80_de_caractere(self):
        # elementele construite DOAR din ce se vede in captura (clasele butonului "+", clasele + eticheta editorului) nu au niciun semnal:
        # deci "incarca" / "chip" vin din partea taiata a lui {...} (clase sau atribute necunoscute). r8 NU a exceptat nimic pentru ele;
        # r9 (TestAtributeComplete2211): sursa reala, citita din pagina, e `arialabel` / `inline-chips-enabled` - exemplele INVENTATE de mai jos
        # (tooltip, with-chips) raman refuzate si pe r9, fiindca exceptiile sunt exacte (alt atribut / alt token = semnal)
        plus = '<gem-icon-button type="onSurface" class="%s"></gem-icon-button>' % CLASE_PLUS_22_11
        editor = '<div class="%s" aria-label="%s" contenteditable="true" role="textbox"></div>' % (CLASE_EDITOR_22_11, ETICHETA_EDITOR_22_11)
        self.assertIsNone(gp._semnal(self.nod(plus)))
        # r17: editorul e editor PRINCIPAL doar ca fiu direct al lui rich-textarea (ca in pagina); singur, contenteditable = `editabil:`
        self.assertIsNone(gp._semnal(self.nod("<rich-textarea>" + editor + "</rich-textarea>").copii[0]))
        self.assertTrue(gp._semnal(self.nod(editor))[0].startswith("editabil:"))
        self.assertEqual(gp._semnatura(self.nod(plus)), "gem-icon-button[type=onsurface]")               # = semnatura din linia (2)
        self.assertEqual(gp._semnatura(self.nod(editor)), STARE_22_11[2].split(":", 2)[2].split("{")[0])  # = semnatura din linia (3)
        # EXEMPLU de mecanism (numele atributelor / clasa de mai jos sunt INVENTATE, nu sursa reala): o a sasea clasa "gem-butt..." si un
        # atribut cu "incarca" in valoare pe butonul "+", o clasa cu "chip" pe editor; cu latimea r7 (80) `stare` ar fi aratat EXACT liniile
        # (2) si (3) din captura - fara sursa; cu r8 (400) {...} e intreg si linia `sursa` arata locul cuvantului
        plus_ex = pagina_22_11(plus_extra=' tooltip="\u00cenc\u0103rcare \u0219i instrumente"').replace(
            'class="' + CLASE_PLUS_22_11 + '"', 'class="' + CLASE_PLUS_22_11 + ' gem-button-onsurface"')
        # r15: pagina_22_11 are doar token-urile intregi; exemplul pune la loc partea VAZUTA (cu "input-url") - semnalul e oricum primul
        editor_ex = pagina_22_11().replace('class="' + CLASE_EDITOR_22_11_INTREGI + '"', 'class="' + CLASE_EDITOR_22_11 + ' with-chips"')
        self.assertIn(' with-chips"', editor_ex)
        with mock.patch.object(gp, "SEMNATURA_TOKEN_AFISATA", 80):
            self.assertEqual(self.an(plus_ex)["necunoscute_detalii"], [STARE_22_11[1]])
            self.assertEqual(self.an(editor_ex)["necunoscute_detalii"], [STARE_22_11[2]])
        i = self.an(plus_ex)
        self.assertEqual(i["necunoscute_detalii"], ["token_incarca:gem-icon-button[type=onsurface]{" + CLASE_PLUS_22_11 + " gem-button-onsurface tooltip}"])
        self.assertEqual(i["necunoscute_surse"], ["valoare_atribut:tooltip=incarcare si instrumente"])
        i = self.an(editor_ex)
        self.assertEqual(i["necunoscute_detalii"], [STARE_22_11[2][:-1] + " with-chips}"])
        self.assertEqual(i["necunoscute_surse"], ["clasa:with-chips"])
        for html in (plus_ex, editor_ex):
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []))
            linii = self.stare_linii(html)
            k = next(j for j, l in enumerate(linii) if l.startswith("  necunoscut "))
            self.assertTrue(linii[k + 1].startswith("    sursa "), linii[k:k + 2])
        # o exceptie "larga" pe cuvantul url / pe clasa open n-ar fi avut niciun efect (nu sunt cuvinte), iar un nume de fisier sau un cuvant
        # intr-o clasa a editorului ramane refuzat, oricare ar fi clasele vazute alaturi
        for cl, m in (("oferta.docx", "semnal_in_editor:atribut_fisier:"), ("input-url file-chip", "semnal_in_editor:token_file:"),
                      ("input-url-attachment", "semnal_in_editor:token_attach:")):
            html = pagina_22_11().replace('class="' + CLASE_EDITOR_22_11_INTREGI + '"', 'class="' + CLASE_EDITOR_22_11 + " " + cl + '"')
            self.assertIn(" " + cl + '"', html)
            i = self.an(html)
            self.assertEqual(i["necunoscute"], 1, msg=(cl, i["necunoscute_detalii"]))
            self.assertTrue(i["necunoscute_detalii"][0].startswith(m), msg=(cl, i["necunoscute_detalii"]))
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=cl)

    def test_sursa_afisata_pentru_fiecare_fel_de_semnal(self):
        # scris de mana: pentru fiecare fel de semnal, motivul (neschimbat fata de r7) si sursa; motivele fara semnal n-au sursa
        cazuri = (
            ('<img src="x">', "media:img[src]", "tag:img"),
            ('<gem-icon style="background: url(blob:x)"></gem-icon>', "fundal:gem-icon", "style:background: url(blob:x)"),
            ('<button aria-label="Remove file"></button>', "eticheta:button[aria-label=remove file]", "eticheta:aria-label=remove file"),
            ('<button aria-label="Trimite mesajul" title="oferta.pdf"></button>', "eticheta:button[aria-label=trimite mesajul][title=oferta.pdf]",
             "eticheta:title=oferta.pdf"),
            ('<gem-icon class="ng-star-inserted icon-card"></gem-icon>', "token_card:gem-icon{icon-card}", "clasa:icon-card"),
            ('<gem-icon id="preview-7"></gem-icon>', "token_preview:gem-icon{#preview-7}", "id:preview-7"),
            ('<gem-icon data-file-name="oferta.pdf"></gem-icon>', "token_file:gem-icon{data-file-name}", "nume_atribut:data-file-name=oferta.pdf"),
            ('<prompt-flow-bar removeattachment=""></prompt-flow-bar>', "token_attach:prompt-flow-bar{removeattachment}", "nume_atribut:removeattachment="),
            ('<gem-icon data-x="attachment"></gem-icon>', "token_attach:gem-icon{data-x}", "valoare_atribut:data-x=attachment"),
            ('<gem-icon class="oferta.docx"></gem-icon>', "atribut_fisier:gem-icon{oferta.docx}", "clasa:oferta.docx"),
            ('<gem-icon id="oferta.docx"></gem-icon>', "atribut_fisier:gem-icon{#oferta.docx}", "id:oferta.docx"),
            ('<gem-icon data-x="oferta.docx"></gem-icon>', "atribut_fisier:gem-icon{data-x}", "valoare_atribut:data-x=oferta.docx"),
            (LINK % "blob:https://gemini.google.com/oferta.docx", "atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}",
             "valoare_atribut:href=blob:https://gemini.google.com/oferta.docx"),
            ('<gem-icon style="--x: oferta.docx"></gem-icon>', "atribut_fisier:gem-icon{style}", "valoare_atribut:style=--x: oferta.docx"),
            # marcajul r5 permis alaturi de un atribut vinovat: sursa e atributul vinovat, nu marcajul
            (DIV_FARA_NG % ' xapfileselectordropzone="" data-file-id="1"', "token_file:div{text-input-field simplified-input-area data-file-id xapfileselectordropzone}",
             "nume_atribut:data-file-id=1"),
            (DIV_FARA_NG % ' xapfileselectordropzone="1"', "token_file:div{text-input-field simplified-input-area xapfileselectordropzone}",
             "nume_atribut:xapfileselectordropzone=1"),
            # fara semnal: fara sursa
            ("<attachment-card></attachment-card>", "element:attachment-card", ""),
            ("<span>a.txt</span>", "text_fisier:a.txt", ""),
            ("<span>Deep Research</span>", "text:deep research", ""),
        )
        for extra, m, s in cazuri:
            i = self.an(zona_cu(extra))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=extra)
            linii = self.stare_linii(zona_cu(extra))
            k = linii.index("  necunoscut " + m)
            if s:
                self.assertEqual(linii[k + 1], "    sursa " + s, msg=extra)
            else:
                self.assertFalse(linii[k + 1].startswith("    sursa"), msg=extra)
        # in editor: acelasi semnal, aceeasi sursa, cu prefixul contextului pe motiv
        i = self.an(zona_cu(editor=editor_cu(' data-file-name="oferta.docx"')))
        self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]),
                         (["semnal_in_editor:token_file:div[role=textbox][contenteditable]{ql-editor textarea data-file-name}"], ["nume_atribut:data-file-name=oferta.docx"]))
        # listele paralele au aceeasi lungime, si la mai multe necunoscute; sursa e ASCII si taiata
        i = self.an(zona_cu(CARD_VERDICT + '<gem-icon data-x="' + "attachment" + "y" * 300 + '"></gem-icon>'))
        self.assertEqual(len(i["necunoscute_detalii"]), len(i["necunoscute_surse"]))
        self.assertEqual(i["necunoscute_surse"][-1], "valoare_atribut:data-x=" + ("attachment" + "y" * 300)[:gp.SURSA_AFISATA])
        for s in i["necunoscute_surse"]:
            s.encode("ascii")
        # mesajul GEM_EROARE ramane cel de pana acum (primele trei motive), fara sursa
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_fara_atasamente(i, 0, "t")
        self.assertNotIn("sursa", c.exception.detaliu)

    def test_semnatura_token_intreaga(self):
        # r8: {...} nu se mai taie la 80 (sursa liniilor (2) / (3) era exact acolo); se taie abia la 400, iar linia la 600
        clase = " ".join("clasa-%02d-lunga" % k for k in range(12))                   # 12 x 14 + 11 = 179 caractere
        self.assertGreater(len(clase), 80)
        extra = '<gem-icon class="%s" data-file-name="x"></gem-icon>' % clase
        i = self.an(zona_cu(extra))
        self.assertEqual(i["necunoscute_detalii"], ["token_file:gem-icon{" + clase + " data-file-name}"])
        with mock.patch.object(gp, "SEMNATURA_TOKEN_AFISATA", 80):
            self.assertEqual(self.an(zona_cu(extra))["necunoscute_detalii"], ["token_file:gem-icon{" + (clase + " data-file-name")[:80] + "}"])
        prea = " ".join("c%03d" % k for k in range(120))                               # 599 caractere
        i = self.an(zona_cu('<gem-icon class="%s" data-file-name="x"></gem-icon>' % prea))
        self.assertEqual(len(i["necunoscute_detalii"][0]), len("token_file:gem-icon{}") + gp.SEMNATURA_TOKEN_AFISATA)
        self.assertEqual((gp.SEMNATURA_TOKEN_AFISATA, gp.DETALIU_AFISAT, gp.SURSA_AFISATA), (400, 600, 160))

    def test_mutanti_r8_lasa_brief_ul_sa_plece(self):
        # fiecare mutant slabeste regula marcajului data-filedrop-id (sau o largeste la "wildcard"); scenariul lui pleaca la Enter pe mutant,
        # refuz fara actiuni pe cod. r9: unde abaterea e alta decat valoarea, scenariul poarta valoarea REALA (altfel valoarea gresita ar refuza
        # si pe mutant); mutantul r8 "valoarea marcajului scutita de pasul 4" a devenit ECHIVALENT (valorile marcajelor sunt pinned - goala /
        # exact cea reala - deci n-au ce cuvant sa poarte) si a fost scos
        fdi = lambda v, extra="": zona_cu(FDI_22_11 % (v, extra))
        cazuri = (
            # (M1) fara forma valorii: o valoare care nu e cea reala (spatiu / punct / lunga / identificatorii r8) pleaca - si marcajul r5 cu
            # valoare nevida
            ([('        if not forma.fullmatch(n.attrs.get(k) or ""):', "        if False:")],
             (fdi("a b"), fdi("1.2"), fdi("x" * 65), fdi("1"), fdi("drop_zone-7"), zona_cu(DIV_FARA_NG % ' xapfileselectordropzone="1"'))),
            # (M2) fara conditia de element: acelasi atribut (valoarea reala) pe gem-icon / pe un div fara copii / pe indicator cu clasa pleaca
            ([(LINIA_CLASE, "        if False:")],
             (zona_cu('<gem-icon data-filedrop-id="%s"></gem-icon>' % FILEDROP_REAL), zona_cu('<div data-filedrop-id="%s"></div>' % FILEDROP_REAL),
              fdi(FILEDROP_REAL, ' class="x"'))),
            # (M3) numele comparat ca prefix: un atribut cu sufix (valoarea reala) pleaca
            ([("        if k != nume:", "        if not k.startswith(nume):")],
             (zona_cu('<file-drop-indicator data-filedrop-id-x="%s"></file-drop-indicator>' % FILEDROP_REAL),
              zona_cu('<file-drop-indicator data-filedrop-identity="%s"></file-drop-indicator>' % FILEDROP_REAL))),
            # (M4) "wildcard": tot indicatorul scutit de semnale (nu doar numele unui atribut, pe o valoare anume): un nume de fisier
            # intr-un atribut, o clasa de atasament sau un fundal pe indicator pleaca (el E in STRUCTURA)
            ([("    if n.tag in MEDIA:", '    if n.tag == "file-drop-indicator":\n        return None\n    if n.tag in MEDIA:')],
             (zona_cu('<file-drop-indicator data-file-name="oferta.docx"></file-drop-indicator>'), fdi(FILEDROP_REAL, ' data-x="oferta.docx"'),
              zona_cu('<file-drop-indicator class="attachment-card"></file-drop-indicator>'), fdi(FILEDROP_REAL, ' style="background: url(x)"'),
              fdi("oferta.docx"))),
            # (M5) acceptare globala a lui "file" in NUMELE atributelor (ce interzice brief-ul): data-file-name pe gem-icon pleaca
            ([('TOKENI_ATAS = ("file", "fisier",', 'TOKENI_ATAS = ("fisier",')], (zona_cu('<gem-icon data-file-name="oferta"></gem-icon>'),)),
        )
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=html[-200:])
                with fara_r13(mut):                 # r13: data-filedrop-id="a b" e si text liber (al doilea strat); mutantul se judeca pe regula lui
                    cod_m, act_m = ruleaza_trimite(mut, FakePg(html))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], html[-200:], cod_m))
                self.assertIn("press Enter", act_m, msg=html[-200:])
        # mutantii (M1)-(M3) lasa indicatorul REAL sa treaca, ca pe cod: deci difera doar pe abateri
        for inlocuiri, _ in cazuri[:3]:
            self.assertEqual(ruleaza_trimite(mutant(inlocuiri), FakePg(pagina_22_11(), dupa_goto=pagina_22_11())), (None, ACTIUNI_TRIMITERE))
        # fara regula de tot (= v4.6.4 instalat): pagina din 22.11 e refuzata pe cod cu linia din captura (test_linia_1...), deci regula
        # e cea care o lasa sa treaca, nu lipsa cuvantului "file"
        with mock.patch.multiple(gp, **DOAR_MARCAJ_R5):
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11())), ("ciorna_necunoscuta", []))


class TestAtributeComplete2211(unittest.TestCase):
    """r9 (v4.6.4b r2, PR #1168 runda 2): pagina din 22.11 reconstituita din atributele COMPLETE citite de chat din pagina reala
    (atribute_complete_22_11.txt). Asteptarile sunt scrise de mana din acel fisier si din captura `stare` (STARE_22_11), nu din cod."""

    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def editor_nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return next(n for n in gp._descendenti(a.radacina) if gp._e_editor(n))

    def stare_linii(self, html, mod=gp):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            mod.stare(FakePg(html))
        return out.getvalue().splitlines()

    def test_atributele_complete_reproduc_exact_cele_3_linii_din_captura(self):
        # cu regulile din v4.6.4 instalat (A03E2B5C) si latimea de afisare de atunci (80), pagina reconstituita da EXACT cele 3 linii din
        # captura, in aceeasi ordine: atributele complete si captura (doua citiri independente ale paginii) sunt consecvente, iar sursele
        # confirma constatarea r8 (dincolo de caracterul 80): (2) VALOAREA atributului `arialabel` (fara cratima: nu e `aria-label`, deci nu
        # e eticheta din semnatura), (3) clasa `inline-chips-enabled`
        with mock.patch.multiple(gp, **REGULI_V464), mock.patch.object(gp, "SEMNATURA_TOKEN_AFISATA", 80):
            i = self.an(pagina_22_11_completa())
            self.assertEqual(i["necunoscute_detalii"], list(STARE_22_11))
            self.assertEqual(i["necunoscute_surse"], list(SURSE_22_11))
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11_completa())), ("ciorna_necunoscuta", []))
        with mock.patch.multiple(gp, **REGULI_V464):
            i = self.an(pagina_22_11_completa())
            self.assertEqual(i["necunoscute_detalii"], [STARE_22_11[0], LINIA_2_INTREAGA, LINIA_3_INTREAGA])
            self.assertEqual(i["necunoscute_surse"], list(SURSE_22_11))
        for l, intreg, sursa in ((STARE_22_11[1], LINIA_2_INTREAGA, "arialabel"), (STARE_22_11[2], LINIA_3_INTREAGA, "inline-chips-enabled")):
            self.assertTrue(intreg.startswith(l[:-1]), (l, intreg))
            self.assertGreater(len(intreg[intreg.index("{") + 1:-1]), 80)
            self.assertIn(sursa, intreg[l.index("{") + 1 + 80:])          # sursa sta DUPA cele 80 de caractere afisate pana la r7
            self.assertNotIn(sursa, l)
        # pe r8 (916494a8: doar marcajul, cu orice identificator) ar fi ramas liniile (2) si (3) intregi, cu sursa - ce prevedea raportul r8
        with mock.patch.multiple(gp, **REGULI_R8):
            i = self.an(pagina_22_11_completa())
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([LINIA_2_INTREAGA, LINIA_3_INTREAGA], list(SURSE_22_11[1:])))
            linii = self.stare_linii(pagina_22_11_completa())
            self.assertIn("    sursa " + SURSE_22_11[1], linii)
            self.assertIn("    sursa " + SURSE_22_11[2], linii)
        # fiecare din cele trei elemente, singur: semnalul lui pe v4.6.4, niciunul pe r9 (aceeasi functie _semnal)
        for nod, m, s in ((self.nod(FDI_REAL), STARE_22_11[0], SURSE_22_11[0]), (self.nod(plus_real()), LINIA_2_INTREAGA, SURSE_22_11[1]),
                          (self.editor_nod(editor_real()), LINIA_3_INTREAGA.split(":", 1)[1], SURSE_22_11[2])):
            with mock.patch.multiple(gp, **REGULI_V464):
                self.assertEqual(gp._semnal(nod), (m, s))
            self.assertIsNone(gp._semnal(nod), m)
        # microfonul real (citit odata cu ele) nu avea si nu are semnal; semnatura lui e cea din STRUCTURA
        mic = self.nod("<gem-icon-button" + MIC_REAL_ATR + "></gem-icon-button>")
        with mock.patch.multiple(gp, **REGULI_V464):
            self.assertIsNone(gp._semnal(mic))
        self.assertEqual(gp._semnatura(mic), "gem-icon-button[type=onsurface][aria-describedby]")
        self.assertIn(gp._semnatura(mic), gp.STRUCTURA_CUNOSCUTA)

    def test_pagina_reala_trece_in_cele_trei_stari_si_trimite(self):
        for stare in ("i", "ii", "iii"):
            i = self.an(pagina_22_11_completa(stare))
            self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 0),
                             msg=(stare, i["necunoscute_detalii"]))
            self.assertEqual(gp.verifica_fara_atasamente(i, 0, "t"), 0)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11_completa(stare), dupa_goto=pagina_22_11_completa())),
                             (None, ACTIUNI_TRIMITERE), msg=stare)
        linii = self.stare_linii(pagina_22_11_completa())
        self.assertIn("necunoscute in zona: 0", linii)
        self.assertIn("paza ciorna: OK (trimite ar continua)", linii)
        self.assertIn("atasamente in ciorna: 0", " ".join(linii))
        self.assertFalse(any(l.startswith(("  necunoscut", "    sursa")) for l in linii), linii)
        # listele albe raman cele de la 21.11 (5 + 23 + 3; r11: + butonul "Ecran complet" = 6 + 23 + 3; r16: + textul "Carbon" al butonului
        # modelului = 6 + 23 + 4): niciuna din cele trei exceptii r9 nu e o intrare in liste
        self.assertEqual(len(gp.CONTROALE_CUNOSCUTE) + len(gp.STRUCTURA_CUNOSCUTA) + len(gp.TEXTE_CUNOSCUTE), 6 + 23 + 4)
        for x in gp.CONTROALE_CUNOSCUTE + gp.STRUCTURA_CUNOSCUTA + gp.TEXTE_CUNOSCUTE:
            self.assertNotIn("arialabel", x)
            self.assertNotIn("chips", x)
            self.assertNotIn("filedrop", x)

    def test_pagina_reala_cu_fisier_tot_ciorna_cu_atasamente(self):
        # aceeasi pagina + chip-uri reale (ca la 5b-5d): numararea si refuzul raman neschimbate, inainte de orice actiune
        for n, fisiere in ((1, ("a.txt",)), (2, ("a.txt", "b.png"))):
            for stare in ("i", "ii", "iii"):
                html = pagina_22_11_completa(stare, extra_zona="".join(chip(f) for f in fisiere))
                i = self.an(html)
                self.assertEqual(i["atasamente"], n, msg=(stare, n))
                with self.assertRaises(gp.GemEroare) as c:
                    gp.verifica_fara_atasamente(i, 0, "t")
                self.assertEqual((c.exception.cod, c.exception.detaliu), ("ciorna_cu_atasamente", "t: %d atasament(e) in ciorna - nu trimit" % n))
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_cu_atasamente", []), msg=(stare, n))
                self.assertIn("atasamente in ciorna: %d" % n, " ".join(self.stare_linii(html)))
        # chip-ul in indicatorul real (care astfel nu mai e nici marcaj), in invelisul butonului "+" real, aparut pe chatul nou: numarat, refuz
        i = self.an(pagina_22_11_completa(fdi=FDI_REAL.replace("></file-drop-indicator>", ">" + chip("a.txt") + "</file-drop-indicator>")))
        self.assertEqual((i["atasamente"], i["necunoscute_detalii"]), (1, [TOKEN_FDI]))
        i = self.an(pagina_22_11_completa().replace("</simplified-input-menu>", chip("a.txt") + "</simplified-input-menu>"))
        self.assertEqual((i["atasamente"], i["necunoscute"]), (1, 0))
        self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11_completa(), dupa_goto=pagina_22_11_completa(extra_zona=chip("a.txt")))),
                         ("ciorna_cu_atasamente", ["goto"]))

    def test_butonul_plus_real_exceptat_doar_exact(self):
        # scris de mana: exceptia e (gem-icon-button, arialabel, "incarcare si instrumente" dupa _ascii, ariahaspopup="menu" brut) si nimic
        # altceva; orice abatere = valoarea intra in cautare (token_incarca / token_fisier), cu sursa valoarea atributului
        v = "valoare_atribut:arialabel="
        cu = lambda vechi, nou: plus_real(PLUS_REAL_ATR.replace(vechi, nou))
        cazuri = (
            (cu(' ariahaspopup="menu"', ""), "token_incarca:gem-icon-button[type=onsurface]{" + CLASE_PLUS_REALE + " arialabel theme}", v + "incarcare si instrumente"),
            (cu('ariahaspopup="menu"', 'ariahaspopup="true"'), LINIA_2_INTREAGA, v + "incarcare si instrumente"),
            (cu('ariahaspopup="menu"', 'ariahaspopup="Menu"'), LINIA_2_INTREAGA, v + "incarcare si instrumente"),
            (cu(ARIALABEL_REAL, ARIALABEL_REAL + " oferta.docx"), LINIA_2_INTREAGA, v + "incarcare si instrumente oferta.docx"),
            (cu(ARIALABEL_REAL, "\u00cenc\u0103rcare"), LINIA_2_INTREAGA, v + "incarcare"),
            (cu(ARIALABEL_REAL, "\u00cenc\u0103rcare fi\u0219iere"), LINIA_2_INTREAGA.replace("token_incarca", "token_fisier"), v + "incarcare fisiere"),
            # aceleasi atribute pe alt element
            ('<div ariahaspopup="menu" arialabel="%s"></div>' % ARIALABEL_REAL, "token_incarca:div{ariahaspopup arialabel}", v + "incarcare si instrumente"),
            ('<button type="button" ariahaspopup="menu" arialabel="%s"></button>' % ARIALABEL_REAL,
             "token_incarca:button[type=button]{ariahaspopup arialabel}", v + "incarcare si instrumente"),
            # butonul real + alt semn: acelasi cuvant in alt atribut, un nume de fisier in alt atribut, o clasa de atasament, un copil cu fisier
            (plus_real(PLUS_REAL_ATR + ' tooltip="\u00cenc\u0103rcare"'), LINIA_2_INTREAGA[:-1] + " tooltip}", "valoare_atribut:tooltip=incarcare"),
            (plus_real(PLUS_REAL_ATR + ' data-file-name="oferta.docx"'),
             "token_file:gem-icon-button[type=onsurface]{" + CLASE_PLUS_REALE + " ariahaspopup arialabel data-file-name theme}", "nume_atribut:data-file-name=oferta.docx"),
            (cu("lm-enabled", "lm-enabled attachment-card"),
             "token_attach:gem-icon-button[type=onsurface]{" + CLASE_PLUS_REALE + " attachment-card ariahaspopup arialabel theme}", "clasa:attachment-card"),
            (plus_real(inauntru="<span>oferta.docx</span>"), "text_fisier:oferta.docx", ""),
        )
        for extra, m, s in cazuri:
            i = self.an(zona_cu(extra))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=extra)
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []), msg=extra)
            with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (m.split(":", 1)[1],)):
                self.assertEqual(self.an(zona_cu(extra))["necunoscute_detalii"], [m], msg=extra)
        # calea legitima (L20): butonul real; fara `theme` (necerut); cu butonul interior real in el
        for extra in (plus_real(), cu(' theme="lm"', ""), plus_real(inauntru='<button aria-label="%s"></button>' % ARIALABEL_REAL)):
            i = self.an(zona_cu(extra))
            self.assertEqual(i["necunoscute"], 0, msg=(extra, i["necunoscute_detalii"]))
        # r15: valoarea exceptata e comparata pe Unicode EXACT (r14: dupa _ascii, deci si fara diacritice): orice alta forma bruta nu mai
        # e exceptata -> "incarca" din valoare = semnal (linia (2) intreaga), refuz
        for alt in ("Incarcare si instrumente", "\u00cenc\u0103rcare \u015fi instrumente", "\u00cenc\u0103rcare  \u0219i instrumente",
                    ARIALABEL_REAL + " ", "\u00eenc\u0103rcare \u0219i instrumente"):
            i = self.an(zona_cu(cu(ARIALABEL_REAL, alt)))
            self.assertEqual(i["necunoscute_detalii"], [LINIA_2_INTREAGA], msg=alt)
        # fara exceptie (= r8): butonul real e refuzat cu linia (2) intreaga
        with mock.patch.multiple(gp, **REGULI_R8):
            self.assertEqual(self.an(zona_cu(plus_real()))["necunoscute_detalii"], [LINIA_2_INTREAGA])

    def test_clasele_editorului_real_exceptate_doar_token_intreg_pe_editor(self):
        # scris de mana: pe editor doar token-urile EXACTE `input-url-linkification-enabled` / `inline-chips-enabled` nu sunt semnal; orice
        # alt token cu "chip" (si subsir / prefix / litere mari), acelasi token pe alt element, sau cuvantul intr-o valoare = semnal
        sem3 = ("semnal_in_editor:token_chip:div[role=textbox][aria-label=introdu o solicitare pentru gemini][contenteditable]{%s"
                " aria-multiline data-gramm data-placeholder dir style}")
        cazuri = (
            (editor_real(CLASE_EDITOR_REALE + " chip"), sem3 % (CLASE_EDITOR_REALE + " chip"), "clasa:chip"),
            (editor_real(CLASE_EDITOR_REALE + " file-chip"), (sem3 % (CLASE_EDITOR_REALE + " file-chip")).replace("token_chip", "token_file"), "clasa:file-chip"),
            (editor_real(CLASE_EDITOR_REALE + " inline-chips"), sem3 % (CLASE_EDITOR_REALE + " inline-chips"), "clasa:inline-chips"),
            (editor_real(CLASE_EDITOR_REALE + " inline-chips-enabled-x"), sem3 % (CLASE_EDITOR_REALE + " inline-chips-enabled-x"), "clasa:inline-chips-enabled-x"),
            (editor_real(CLASE_EDITOR_REALE + " x-inline-chips-enabled"), sem3 % (CLASE_EDITOR_REALE + " x-inline-chips-enabled"), "clasa:x-inline-chips-enabled"),
            # token-ul brut difera doar prin litere mari: NU e cel scutit (afisarea e ASCII cu litere mici, ca peste tot)
            (editor_real(CLASE_EDITOR_REALE.replace("inline-chips-enabled", "Inline-Chips-Enabled")), LINIA_3_INTREAGA, "clasa:inline-chips-enabled"),
            (editor_real(extra=' data-x="chip"'), (sem3 % CLASE_EDITOR_REALE).replace(" data-placeholder dir", " data-placeholder data-x dir"), "valoare_atribut:data-x=chip"),
        )
        for ed, m, s in cazuri:
            i = self.an(zona_cu(editor=ed))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=ed)
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(editor=ed))), ("ciorna_necunoscuta", []), msg=ed)
        # acelasi token pe alt element decat editorul (div / gem-icon din zona, rich-textarea, zona insasi, un p din editor): semnal
        alte = (
            (zona_cu('<div class="inline-chips-enabled"></div>'), "token_chip:div{inline-chips-enabled}"),
            (zona_cu('<gem-icon class="inline-chips-enabled"></gem-icon>'), "token_chip:gem-icon{inline-chips-enabled}"),
            (zona_cu(editor=EDITOR_HTML.replace('<rich-textarea class="text-input-field_textarea">', '<rich-textarea class="text-input-field inline-chips-enabled">')),
             "token_chip:rich-textarea{text-input-field inline-chips-enabled}"),
            (pagina(zona_atr=' class="inline-chips-enabled"'), "token_chip:input-area-v2{inline-chips-enabled}"),
            (zona_cu(editor=EDITOR_HTML.replace("<p>ciorna</p>", '<p class="inline-chips-enabled">ciorna</p>')), "semnal_in_editor:token_chip:p{inline-chips-enabled}"),
        )
        for html, m in alte:
            i = self.an(html)
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], ["clasa:inline-chips-enabled"]), msg=m)
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=m)
            with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (m.split(":")[-2] + "{inline-chips-enabled}",)):
                self.assertEqual(self.an(html)["necunoscute_detalii"], [m], msg=m)
        # un div cu clasele reale care NU e editor (fara contenteditable / cu "false"): semnal (direct pe _semnal: fara editor, zona nu se citeste)
        for atr, sem in (("", "div[role=textbox]"), (' contenteditable="false"', "div[role=textbox][contenteditable]")):
            nod = self.nod('<div class="%s" role="textbox"%s></div>' % (CLASE_EDITOR_REALE, atr))
            self.assertFalse(gp._e_editor(nod))
            self.assertEqual(gp._semnal(nod), ("token_chip:%s{%s}" % (sem, CLASE_EDITOR_REALE), "clasa:inline-chips-enabled"))
        # calea legitima (L20): editorul real; fara ql-editor (editor prin rich-textarea); fara ql-blank (cu text); clasele reale pe editorul
        # paginii complete in cele trei stari (test_pagina_reala_trece...)
        for ed in (editor_real(), editor_real(CLASE_EDITOR_REALE.replace("ql-editor ", "")), editor_real(CLASE_EDITOR_REALE.replace(" ql-blank", ""))):
            i = self.an(zona_cu(editor=ed))
            self.assertEqual(i["necunoscute"], 0, msg=(ed, i["necunoscute_detalii"]))
            self.assertTrue(gp._e_editor(self.editor_nod(ed)))
        # fara exceptie (= r8): editorul real e refuzat cu linia (3) intreaga
        with mock.patch.multiple(gp, **REGULI_R8):
            self.assertEqual(self.an(zona_cu(editor=editor_real()))["necunoscute_detalii"], [LINIA_3_INTREAGA])

    def test_exceptiile_r9_stau_doar_in_functia_de_semnale(self):
        # structural (completeaza test_o_singura_functie_de_semnale): cele trei ajutatoare sunt definite o data si apelate doar din _semnal
        # (si _sursa_cuvant, apelata doar din _semnal, pentru afisare); listele lor sunt citite doar de ele; paza nu le citeste
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        linii = [l.rstrip("\r") for l in src.split("\n")]
        cod = [l for l in linii if not l.lstrip().startswith("#")]

        def corp(nume_def):
            i0 = linii.index(nume_def)
            i1 = next(k for k in range(i0 + 1, len(linii)) if linii[k].startswith("def "))
            return [l for l in linii[i0:i1] if not l.lstrip().startswith("#")]

        self.assertEqual(sum(l.count("_valoare_permisa(") for l in cod), 2)         # def + apelul din _semnal (pasul 4)
        self.assertEqual(sum(l.count("_marcaj_permis(") for l in cod), 3)           # def + _semnal (pasul 2) + _sursa_cuvant
        self.assertEqual(sum(l.count("_clase_verificate(") for l in cod), 3)        # def + _semnal (pasul 2 / 3) + _sursa_cuvant
        c_semnal, c_sursa = corp("def _semnal(n):"), corp("def _sursa_cuvant(n, t):")
        self.assertEqual(sum(l.count("_valoare_permisa(") for l in c_semnal), 1)
        self.assertEqual(sum(l.count("_marcaj_permis(") for l in c_semnal + c_sursa), 2)
        self.assertEqual(sum(l.count("_clase_verificate(") for l in c_semnal + c_sursa), 2)
        self.assertIn(LINIA_PAS4, c_semnal)
        self.assertIn('    clase_id = _ascii(" ".join(_clase_verificate(n) + [n.attrs.get("id") or ""]))', c_semnal)
        for const, unde in (("VALORI_PERMISE", "def _valoare_permisa(n, k):"), ("CLASE_EDITOR_PERMISE", "def _clase_verificate(n):"),
                            ("MARCAJE_PERMISE", "def _marcaj_permis(n, k):")):
            citiri = re.compile(r"(?<![A-Za-z_])in " + const + r"(?![A-Za-z_])")       # `... in CONST` = o citire (nu "din CONST" din docstring-uri)
            self.assertEqual(sum(l.startswith(const + " = ") for l in cod), 1, const)  # definitia constantei
            self.assertEqual(sum(len(citiri.findall(l)) for l in cod), 1, const)       # singura citire
            self.assertEqual(sum(len(citiri.findall(l)) for l in corp(unde)), 1, const)
        c_paza = corp("def verifica_fara_atasamente(info, semn_locator, moment):")
        self.assertFalse(any(x in l for l in c_paza for x in ("PERMISE", "surse", "_semnal")), c_paza)
        # _clase_verificate e singurul loc care decide pe clase cu exceptie: restul codului citeste clasele brute (_clase) doar pentru afisare,
        # zona / editor / marcaj / semn - niciodata pentru cautarea cuvintelor
        self.assertNotIn("CLASE_EDITOR_PERMISE", "\n".join(corp("def _semnatura_token(n):")))
        # def + analizeaza_ciorna + _clase_verificate; r17: + _e_clipboard (editorul unic printre fratii lui) + _semnal (pasul 5, editabil:)
        # r18: + _motiv_element (editorul insusi: atributele lui pe lista alba; restul din editor doar p / br fara atribute)
        # r20: + _arbore_cdp (stramosii editorului = "in zona" pentru shadow root-urile user-agent, ca in JS_UMBRE)
        self.assertEqual(sum(l.count("_e_editor(") for l in cod), 7)

    def test_mutanti_r9_lasa_brief_ul_sa_plece(self):
        # fiecare mutant largeste una din cele trei exceptii (sau o face "wildcard" / globala); scenariul lui pleaca la Enter pe mutant, refuz
        # fara actiuni pe cod; toti lasa pagina REALA sa treaca (deci difera doar pe abateri)
        fdi_real = lambda extra_atr="", inauntru="": zona_cu("<file-drop-indicator" + FDI_REAL_ATR + extra_atr + ">" + inauntru + "</file-drop-indicator>")
        cu = lambda vechi, nou: zona_cu(plus_real(PLUS_REAL_ATR.replace(vechi, nou)))
        cazuri = (
            # (M1) valoarea exacta -> orice identificator (= r8): "1" / "drop_zone-7" pleaca
            ([('VALOARE_FILEDROP = re.compile(re.escape("chat-window-input-container"))', 'VALOARE_FILEDROP = re.compile(r"[A-Za-z0-9_-]{0,64}")')],
             (zona_cu(FDI_22_11 % ("1", "")), zona_cu(FDI_22_11 % ("drop_zone-7", "")))),
            # (M2) fara "niciun alt atribut": un atribut in plus (fara cuvant), gol sau Angular negol, pleaca
            ([(LINIA_IZOLAT, "        if False:")],
             (fdi_real(' data-x="1"'), fdi_real(' jslog="1"'), fdi_real(' _ngcontent-ng-c1="x"'), fdi_real(' trace=""'))),
            # (M3) fara "niciun copil": un copil neutru pleaca
            ([('        if izolat and any(c.tag != "#text" or not VALOARE_SPATII.fullmatch(c.date) for c in n.copii):   # r15: text brut, doar spatii HTML',
               "        if False:")],
             (fdi_real(inauntru="<div></div>"), fdi_real(inauntru="<span></span>"))),
            # (M4) `ariahaspopup="menu"` necerut: butonul fara el / cu "true" pleaca
            ([("        if any(n.attrs.get(a) != v for a, v in cerute):", "        if False:")],
             (cu(' ariahaspopup="menu"', ""), cu('ariahaspopup="menu"', 'ariahaspopup="true"'))),
            # (M5) valoarea comparata ca subsir: eticheta + un nume de fisier pleaca
            ([("        if n.attrs.get(k) != valoare:", "        if valoare not in (n.attrs.get(k) or ''):")],
             (cu(ARIALABEL_REAL, ARIALABEL_REAL + " oferta.docx"),)),
            # (M6) tagul necerut: aceleasi atribute pe un div pleaca
            ([("        if k != nume or n.tag != tag:", "        if k != nume:")],
             (zona_cu('<div ariahaspopup="menu" arialabel="%s"></div>' % ARIALABEL_REAL),)),
            # (M7) token de clasa ca prefix: `inline-chips-enabled-x` pe editor pleaca
            ([("    return [c for c in _clase(n) if c not in CLASE_EDITOR_PERMISE]",
               "    return [c for c in _clase(n) if not any(c.startswith(p) for p in CLASE_EDITOR_PERMISE)]")],
             (zona_cu(editor=editor_real(CLASE_EDITOR_REALE + " inline-chips-enabled-x")),)),
            # (M8) scutirea pe orice element, nu doar pe editor: token-ul pe div / gem-icon / zona pleaca
            ([("    if not _e_editor(n):", "    if False:")],
             (zona_cu('<div class="inline-chips-enabled"></div>'), zona_cu('<gem-icon class="inline-chips-enabled"></gem-icon>'),
              pagina(zona_atr=' class="inline-chips-enabled"'))),
            # (M9) / (M10) acceptare GLOBALA a cuvantului ("chip" / "incarca" scos din TOKENI_ATAS): o clasa x-chip / o valoare "incarcare" pleaca
            ([('"media", "chip",', '"media",')], (zona_cu('<gem-icon class="x-chip"></gem-icon>'),)),
            ([('"upload", "incarca",', '"upload",')], (zona_cu('<gem-icon data-x="incarcare"></gem-icon>'),)),
            # (M11) "wildcard" pe butonul "+": tot gem-icon-button scutit de semnale (un nume de fisier / alt cuvant pe el pleaca)
            ([("    if n.tag in MEDIA:", '    if n.tag == "gem-icon-button":\n        return None\n    if n.tag in MEDIA:')],
             (zona_cu('<gem-icon-button type="onSurface" data-file-name="oferta.docx"></gem-icon-button>'),
              zona_cu(plus_real(PLUS_REAL_ATR + ' tooltip="\u00cenc\u0103rcare"')))),
            # (M12) "wildcard" pe editor: editorul scutit de semnale (un atribut cu fisier / o clasa chip pe el pleaca)
            ([("    if n.tag in MEDIA:", "    if _e_editor(n):\n        return None\n    if n.tag in MEDIA:")],
             (zona_cu(editor=editor_real(extra=' data-file-name="oferta.docx"')), zona_cu(editor=editor_real(CLASE_EDITOR_REALE + " chip")))),
        )
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=html[-200:])
                with fara_r13(mut):                 # r13: arialabel / tooltip strain e si atribut cu text (al doilea strat)
                    cod_m, act_m = ruleaza_trimite(mut, FakePg(html))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], html[-200:], cod_m))
                self.assertIn("press Enter", act_m, msg=html[-200:])
            for stare in ("i", "iii"):
                self.assertEqual(ruleaza_trimite(mut, FakePg(pagina_22_11_completa(stare), dupa_goto=pagina_22_11_completa())),
                                 (None, ACTIUNI_TRIMITERE), msg=inlocuiri[0][1])
        # fara nicio exceptie r9 (= v4.6.4 instalat): pagina reala e refuzata cu cele trei linii, deci exceptiile sunt cele care o lasa sa treaca
        with mock.patch.multiple(gp, **REGULI_V464):
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11_completa())), ("ciorna_necunoscuta", []))


# --- r10 (v4.6.4c, 22.11.2026): 5g PICAT pe v4.6.4b instalat (5B0CCD48). Indicatorul de drop de pe chatul NOU deschis de script, cu atributele
# copiate EXACT din paw_v464_calibrare\atribute_5g_22_11.txt (citite de chat prin CDP, doar citire): fata de r9 are in plus `style=""` (GOL);
# clasa Angular ng-tns-...-9 (nu -6) e generata si nu conteaza ---
FDI_5G_ATR = (' _ngcontent-ng-c2231844863="" _nghost-ng-c3042269636="" class="ng-tns-c3042269636-9 ng-tns-c2231844863-2 ng-star-inserted"'
              ' data-filedrop-id="' + FILEDROP_REAL + '" style=""')
FDI_5G = "<file-drop-indicator" + FDI_5G_ATR + "></file-drop-indicator>"
# motivul si sursa asteptate cand `style` nu e acceptat (scrise de mana, regula din r9: orice abatere -> numele data-filedrop-id in cautare;
# `style` apare in {...} fiindca nu e generat si nu e in semnatura). 5g n-a dat captura `stare`: asteptarea e dedusa din regulile r9, declarat.
TOKEN_FDI_STYLE = "token_file:file-drop-indicator{data-filedrop-id style}"
SURSA_FDI = "nume_atribut:data-filedrop-id=" + FILEDROP_REAL
# r10 exact asa cum e in cod (6 campuri); mutantul care scoate `style` din `goale` = regulile din v4.6.4b instalat
MARCAJ_FDI_R10 = '"data-filedrop-id", VALOARE_FILEDROP, True, ("style",)),'
MARCAJ_FDI_FARA_GOALE = '"data-filedrop-id", VALOARE_FILEDROP, True, ()),'
NBSP, VT, ZWSP, SPATIU_IDEOGRAFIC = chr(0xA0), chr(0x0B), chr(0x200B), chr(0x3000)
# `style` cu continut care NU contine textul "url(" (deci trece de pasul 0, fundal) si nici cuvinte de atasament / nume de fisier (deci trece
# de pasul 4): DOAR regula `izolat` il opreste (verificat in test pe un element oarecare). "u\72l(" = url( scris cu escape CSS (\72 = r),
# -moz-element() / var() = fundal fara url( (fara "image" / "previz", care sunt cuvinte de atasament si ar fi oprite de pasul 4)
STYLE_DOAR_IZOLAT = ("display:none", "background:u\\72l(/resource/1234)", "background:-moz-element(#x)",
                     "background:var(--fundal-x)", "x", ";")
# `style` alcatuit doar din spatii care NU sunt spatii albe HTML (NBSP, si ca entitate; tab vertical; latime zero; spatiu ideografic)
STYLE_SPATII_NEHTML = (NBSP, "&#160;", VT, ZWSP, SPATIU_IDEOGRAFIC, " " + NBSP + " ")


def fdi_style(valoare, atr=FDI_REAL_ATR, inauntru=""):
    # indicatorul real (r9) + style="<valoare>" (valoarea scrisa ca in HTML: entitatile se decodeaza la citire)
    return "<file-drop-indicator" + atr + ' style="' + valoare + '">' + inauntru + "</file-drop-indicator>"


class TestStyleGol5g(unittest.TestCase):
    """r10 (v4.6.4c): `style` pe indicatorul de drop e acceptat DOAR gol sau din spatii albe HTML; orice continut = semnal ca in r9."""

    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def stare_linii(self, html, mod=gp):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            mod.stare(FakePg(html))
        return out.getvalue().splitlines()

    def test_5g_elementul_real_trece_pe_chatul_nou(self):
        self.assertEqual(self.nod(FDI_5G).attrs["style"], "")
        self.assertIsNone(gp._semnal(self.nod(FDI_5G)))
        # pe regulile din v4.6.4b (fara `goale`): elementul real e refuzat - reproducerea lui 5g
        v464b = mutant([(MARCAJ_FDI_R10, MARCAJ_FDI_FARA_GOALE)])
        self.assertEqual(v464b._semnal(self.nod(FDI_5G)), (TOKEN_FDI_STYLE, SURSA_FDI))
        self.assertIsNone(v464b._semnal(self.nod(FDI_REAL)))                  # fara style: trecea si pe v4.6.4b
        for stare in ("i", "ii", "iii"):
            html = pagina_22_11_completa(stare, fdi=FDI_5G)
            i = self.an(html)
            self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 0),
                             msg=(stare, i["necunoscute_detalii"]))
            self.assertEqual(ruleaza_trimite(gp, FakePg(html, dupa_goto=html)), (None, ACTIUNI_TRIMITERE), msg=stare)
            # scenariul 5g: tab-ul curent fara style (r9), chatul NOU deschis de script cu style="" -> trece pe r10, refuz dupa goto pe v4.6.4b
            pg = lambda: FakePg(pagina_22_11_completa(stare), dupa_goto=pagina_22_11_completa(fdi=FDI_5G))
            self.assertEqual(ruleaza_trimite(gp, pg()), (None, ACTIUNI_TRIMITERE), msg=stare)
            self.assertEqual(ruleaza_trimite(v464b, pg()), ("ciorna_necunoscuta", ["goto"]), msg=stare)
            self.assertEqual(self.an(pagina_22_11_completa(stare, fdi=FDI_5G), mod=v464b)["necunoscute_detalii"], [TOKEN_FDI_STYLE])
        linii = self.stare_linii(pagina_22_11_completa(fdi=FDI_5G))
        self.assertIn("necunoscute in zona: 0", linii)
        self.assertIn("paza ciorna: OK (trimite ar continua)", linii)
        self.assertFalse(any(l.startswith(("  necunoscut", "    sursa")) for l in linii), linii)
        linii = self.stare_linii(pagina_22_11_completa(fdi=FDI_5G), mod=v464b)
        self.assertIn("  necunoscut " + TOKEN_FDI_STYLE, linii)
        self.assertIn("    sursa " + SURSA_FDI, linii)
        # cu un chip real pe chatul nou (5b-5d pe pagina 5g): tot ciorna_cu_atasamente
        for n, fisiere in ((1, ("a.txt",)), (2, ("a.txt", "b.png"))):
            html = pagina_22_11_completa(fdi=FDI_5G, extra_zona="".join(chip(f) for f in fisiere))
            self.assertEqual(self.an(html)["atasamente"], n)
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_cu_atasamente", []))
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11_completa(), dupa_goto=html)), ("ciorna_cu_atasamente", ["goto"]))
        i = self.an(pagina_22_11_completa(fdi=fdi_style("", FDI_5G_ATR.replace(' style=""', ""), chip("a.txt"))))
        self.assertEqual((i["atasamente"], i["necunoscute_detalii"]), (1, [TOKEN_FDI_STYLE]))

    def test_style_gol_sau_spatii_albe_html_trece(self):
        # calea legitima (L20): gol, fara valoare, spatii albe HTML (spatiu, \t, \n, \r, \f; si ca entitate), cu / fara clasele generate
        valori = ("", " ", "   ", "\t", "\n", "\r\n", "\f", " \t\n\r\f ", "&#32;", "&#9;")
        for v in valori:
            for atr in (FDI_REAL_ATR, ' data-filedrop-id="%s"' % FILEDROP_REAL):
                html = fdi_style(v, atr)
                self.assertIsNone(gp._semnal(self.nod(html)), msg=repr(v))
                i = self.an(zona_cu(html))
                self.assertEqual(i["necunoscute"], 0, msg=(repr(v), i["necunoscute_detalii"]))
        self.assertEqual(self.an(zona_cu("<file-drop-indicator" + FDI_REAL_ATR + " style></file-drop-indicator>"))["necunoscute"], 0)
        self.assertEqual(self.an(zona_cu(FDI_REAL))["necunoscute"], 0)                # r9 fara style: neschimbat

    def test_style_cu_continut_refuz_ca_in_r9(self):
        # scris de mana: orice style cu continut -> elementul nu e izolat -> token_file pe numele data-filedrop-id (primul cuvant din
        # TOKENI_ATAS, inaintea lui "upload" din valoare); url( literal -> fundal (pasul 0, inaintea izolarii)
        cazuri = [(v, TOKEN_FDI_STYLE, SURSA_FDI) for v in
                  ("--uploader-height: 112px;", "--uploader-height: 112px", "oferta.docx", "--x: oferta.docx",
                   "background:var(--x) /* oferta.docx */") + STYLE_DOAR_IZOLAT + STYLE_SPATII_NEHTML] + [
            ("background: url(/resource/1234)", "fundal:file-drop-indicator", "style:background: url(/resource/1234)"),
            ("background-image: URL(blob:https://gemini.google.com/x)", "fundal:file-drop-indicator",
             "style:background-image: url(blob:https://gemini.google.com/x)"),
        ]
        # valorile STYLE_DOAR_IZOLAT / STYLE_SPATII_NEHTML nu sunt semnal pe un element oarecare (nici fundal, nici cuvant, nici fisier):
        # pe indicator le opreste DOAR regula izolarii (de aceea prind mutantii M13 / M15)
        for v in STYLE_DOAR_IZOLAT + STYLE_SPATII_NEHTML:
            self.assertIsNone(gp._semnal(self.nod('<gem-icon style="%s"></gem-icon>' % v)), msg=repr(v))
        for v, m, s in cazuri:
            html = fdi_style(v)
            i = self.an(zona_cu(html))
            self.assertEqual((i["atasamente"], i["semne"]), (0, 0), msg=repr(v))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=repr(v))
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(html))), ("ciorna_necunoscuta", []), msg=repr(v))
            # pe chatul nou (ca la 5g): refuz dupa goto, inainte de click / tastatura
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_22_11_completa(), dupa_goto=pagina_22_11_completa(fdi=html))),
                             ("ciorna_necunoscuta", ["goto"]), msg=repr(v))
            with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (m.split(":", 1)[1],)):
                self.assertEqual(self.an(zona_cu(html))["necunoscute_detalii"], [m], msg=repr(v))
        # style gol NU acopera alte abateri: alt atribut (si gol), alt nume asemanator, clasa negenerata, copil -> refuz ca in r9
        alte = (
            (FDI_5G.replace(' style=""', ' style="" data-x="1"'), "token_file:file-drop-indicator{data-filedrop-id data-x style}"),
            (FDI_5G.replace(' style=""', ' style="" trace=""'), "token_file:file-drop-indicator{data-filedrop-id style trace}"),
            (FDI_5G.replace(' style=""', ' data-style=""'), "token_file:file-drop-indicator{data-filedrop-id data-style}"),
            (FDI_5G.replace(' style=""', ' style-x=""'), "token_file:file-drop-indicator{data-filedrop-id style-x}"),
            (FDI_5G.replace(' style=""', ' xstyle=""'), "token_file:file-drop-indicator{data-filedrop-id xstyle}"),
            (FDI_5G.replace('ng-star-inserted"', 'ng-star-inserted x"'), "token_file:file-drop-indicator{x data-filedrop-id style}"),
            (FDI_5G.replace(FILEDROP_REAL, FILEDROP_REAL + "-2"), TOKEN_FDI_STYLE),
        )
        for html, m in alte:
            i = self.an(zona_cu(html))
            self.assertEqual(i["necunoscute_detalii"], [m], msg=html)
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(html))), ("ciorna_necunoscuta", []), msg=html)
        i = self.an(zona_cu(FDI_5G.replace("></file-drop-indicator>", "><span>oferta.docx</span></file-drop-indicator>")))
        self.assertEqual(i["necunoscute_detalii"], [TOKEN_FDI_STYLE, "text_fisier:oferta.docx"])
        # style gol pe alt element cu data-filedrop-id (nu e indicatorul): tot semnal
        i = self.an(zona_cu('<div data-filedrop-id="%s" style=""></div>' % FILEDROP_REAL))
        self.assertEqual(i["necunoscute_detalii"], ["token_file:div{data-filedrop-id style}"])

    def test_5e_style_uploader_pe_zona_si_editor_ramane_refuz(self):
        # decizia din 22.11 (5e): dupa scoaterea manuala a fisierelor, zona si editorul pastreaza style="--uploader-height: 112px;" pana la F5
        # -> refuz (fals, dar sigur); r10 NU excepteaza nimic acolo (RUNBOOK: F5 inainte de trimitere)
        st = ' style="--uploader-height: 112px;"'
        sursa = "valoare_atribut:style=--uploader-height: 112px;"
        ed = pagina_22_11_completa(editor_atr=EDITOR_REAL_ATR.replace(' style=""', st))
        zona = pagina(zona_atr=st)
        cazuri = ((ed, LINIA_3_INTREAGA.replace("token_chip", "token_upload")), (zona, "token_upload:input-area-v2{style}"),
                  (pagina_22_11_completa(fdi=FDI_5G, editor_atr=EDITOR_REAL_ATR.replace(' style=""', st)), LINIA_3_INTREAGA.replace("token_chip", "token_upload")))
        for html, m in cazuri:
            i = self.an(html)
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [sursa]), msg=m)
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=m)
        # dupa F5 (style gol pe editor, ca in pagina reala): trece
        self.assertEqual(self.an(pagina_22_11_completa(fdi=FDI_5G))["necunoscute"], 0)

    def test_constanta_spatiilor_sta_doar_in_regula_marcajului(self):
        # structural (L19): VALOARE_SPATII definita o data si citita o singura data, in _marcaj_permis (linia izolarii); campul `goale`
        # e citit doar acolo
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        linii = [l.rstrip("\r") for l in src.split("\n")]
        cod = [l for l in linii if not l.lstrip().startswith("#")]
        i0 = linii.index("def _marcaj_permis(n, k):")
        i1 = next(k for k in range(i0 + 1, len(linii)) if linii[k].startswith("def "))
        corp = [l for l in linii[i0:i1] if not l.lstrip().startswith("#")]
        # r14: + intrarea `style` a indicatorului in ATRIBUTE_PERMISE; r15: + copiii elementului izolat (text brut doar din spatii HTML)
        self.assertEqual(sum(l.count("VALOARE_SPATII") for l in cod), 4)
        self.assertEqual(sum(l.startswith("VALOARE_SPATII = ") for l in cod), 1)
        self.assertEqual(sum(l.count("VALOARE_SPATII.fullmatch(") for l in corp), 2)
        self.assertEqual(sum(l.count("VALOARE_SPATII.fullmatch(") for l in cod), 2)               # ambele citiri doar in _marcaj_permis
        self.assertIn(LINIA_IZOLAT, corp)
        # campul `goale` (cuvantul apare si in comentarii / docstring-uri romanesti): despachetat o data, citit o data, ambele in _marcaj_permis
        despachetare = "    for tag, clase, nume, forma, izolat, goale in MARCAJE_PERMISE:"
        self.assertEqual(sum(l == despachetare for l in cod), 1)
        self.assertIn(despachetare, corp)
        self.assertEqual(sum(l.count(" in goale") for l in cod), 1)
        self.assertEqual(sum(l.count(" in goale") for l in corp), 1)
        self.assertIn(MARCAJ_FDI_R10, src)

    def test_mutanti_r10_lasa_brief_ul_sa_plece(self):
        # fiecare mutant largeste exceptia `style`; scenariul lui pleaca la Enter pe mutant, refuz fara actiuni pe cod; toti lasa pagina 5g
        # sa treaca (deci difera doar pe abateri)
        z = lambda v: zona_cu(fdi_style(v))
        url_escape = z("background:u\\72l(/resource/1234)")
        cazuri = (
            # (M13) style acceptat cu ORICE valoare: url( cu escape CSS, -moz-element(), var(), display:none ... pleaca
            ([("not (a in goale and VALOARE_SPATII.fullmatch(v))", "not (a in goale)")], tuple(z(v) for v in STYLE_DOAR_IZOLAT)),
            # (M14) fullmatch -> match (prefix, neancorat; L13): orice valoare are prefixul gol -> pleaca
            ([("VALOARE_SPATII.fullmatch(v)", "VALOARE_SPATII.match(v)")], (url_escape, z("display:none"))),
            # (M15) spatiile Unicode (\s) in loc de spatiile albe HTML: NBSP / tab vertical / spatiul ideografic pleaca
            ([('VALOARE_SPATII = re.compile(r"[ \\t\\n\\r\\f]*")', 'VALOARE_SPATII = re.compile(r"\\s*")')],
             (z(NBSP), z("&#160;"), z(VT), z(SPATIU_IDEOGRAFIC))),
            # (M16) orice atribut gol acceptat, nu doar `style`: trace="" / data-x="" pe indicator pleaca
            ([("not (a in goale and VALOARE_SPATII.fullmatch(v))", "not (VALOARE_SPATII.fullmatch(v))")],
             (zona_cu(FDI_5G.replace(' style=""', ' style="" trace=""')), zona_cu(FDI_5G.replace(' style=""', ' data-x=""')))),
            # (M17) numele comparat ca subsir: data-style="" / xstyle="" pleaca
            ([("not (a in goale and VALOARE_SPATII", "not (any(g in a for g in goale) and VALOARE_SPATII")],
             (zona_cu(FDI_5G.replace(' style=""', ' data-style=""')), zona_cu(FDI_5G.replace(' style=""', ' xstyle=""')))),
        )
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=html[-200:])
                with fara_r13(mut):                 # r14: lista alba (al doilea strat) oprita doar in mutant
                    cod_m, act_m = ruleaza_trimite(mut, FakePg(html))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], html[-200:], cod_m))
                self.assertIn("press Enter", act_m, msg=html[-200:])
            for stare in ("i", "iii"):
                self.assertEqual(ruleaza_trimite(mut, FakePg(pagina_22_11_completa(stare), dupa_goto=pagina_22_11_completa(fdi=FDI_5G))),
                                 (None, ACTIUNI_TRIMITERE), msg=inlocuiri[0][1])
        # url( LITERAL ramane refuzat si pe M13 (pasul 0, fundal, inaintea izolarii): doua bariere; de aceea testul pe url( foloseste si
        # forma cu escape CSS, pe care o opreste DOAR regula izolarii
        m13 = mutant(cazuri[0][0])
        self.assertEqual(ruleaza_trimite(m13, FakePg(z("background: url(/resource/1234)"))), ("ciorna_necunoscuta", []))
        self.assertEqual(self.an(z("background: url(/resource/1234)"), mod=m13)["necunoscute_detalii"], ["fundal:file-drop-indicator"])
        # fara exceptia r10 (= v4.6.4b instalat): pagina 5g e refuzata, deci `goale` e cea care o lasa sa treaca
        v464b = mutant([(MARCAJ_FDI_R10, MARCAJ_FDI_FARA_GOALE)])
        self.assertEqual(ruleaza_trimite(v464b, FakePg(pagina_22_11_completa(fdi=FDI_5G))), ("ciorna_necunoscuta", []))


# --- r11 (v4.6.4d, 23.11.2026): refuz FALS la un brief LUNG pe v4.6.4c instalat (09E78891). Cele doua linii `necunoscut` sunt copiate EXACT din
# paw-data\out\juridic_43eb636364a95c9d.log (GEM_EROARE ciorna_necunoscuta inainte_de_enter); atributele de mai jos sunt copiate de mana din
# paw-data\out\paw_v464_calibrare\stare_text_lung_23_11.json (citite de chat prin CDP cu ~10 KB de text in ciorna, NETRIMIS, apoi golit) ---
STARE_23_11 = (
    "token_file:div{text-input-field height-expanded-past-single-line pre-fullscreen with-toolbox-drawer jslog xapfileselectordropzone}",
    "element:button[aria-label=extinde intrarea la ecran complet][aria-describedby]",
)
EROARE_23_11 = "inainte_de_enter: 2 element(e) nerecunoscute in zona ciornei - nu trimit (" + "; ".join(STARE_23_11) + ")"
SURSA_DIV_23_11 = "nume_atribut:xapfileselectordropzone="
# multimile de clase acceptate pe div-ul zonei de drop (scrise de mana: normal 21.11, text lung 23.11, cele doua intermediare deduse pe
# aceeasi baza). r12 (varianta B): doar aceste 4.
CLASE_DIV_DROP_ASTEPTATE = (
    ("text-input-field", "simplified-input-area"),
    ("text-input-field", "height-expanded-past-single-line", "pre-fullscreen", "with-toolbox-drawer"),
    ("text-input-field", "height-expanded-past-single-line", "with-toolbox-drawer"),
    ("text-input-field", "pre-fullscreen", "with-toolbox-drawer"),
)
# r12: cele 3 multimi "normala + token de inaltime" din r11, scoase (captura 23.11 le contrazice) -> acum REFUZ ca orice alta multime
CLASE_DIV_SCOASE_R12 = (
    ("text-input-field", "simplified-input-area", "height-expanded-past-single-line"),
    ("text-input-field", "simplified-input-area", "pre-fullscreen"),
    ("text-input-field", "simplified-input-area", "height-expanded-past-single-line", "pre-fullscreen"),
)
CLASE_DIV_EXTINS = "text-input-field height-expanded-past-single-line pre-fullscreen with-toolbox-drawer"
DIV_EXTINS_ATR = (' _ngcontent-ng-c282099457="" xapfileselectordropzone="" class="' + CLASE_DIV_EXTINS + '" jslog="303810;track:impression"')
ZONA_2311_ATR = (' _ngcontent-ng-c3991212058="" trace="" _nghost-ng-c282099457="" class="ui-improvements-phase-1 with-toolbox-drawer'
                 ' input-box-shadow discovery-feed-theme single-line-input lm-input-redesign ng-tns-c282099457-4"')
CLASE_MAT_BTN = ("mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above"
                 " mat-badge-after mat-badge-small mat-badge-hidden")
RIPPLE = ' mat-ripple-loader-uninitialized="" mat-ripple-loader-class-name="mat-mdc-button-ripple" mat-ripple-loader-centered=""'
CLASE_GEM_BTN = "gem-button gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled"
PLUS_2311_GIB = (' _ngcontent-ng-c2269542982="" theme="lm" type="onSurface" ariahaspopup="menu" arialabel="' + ARIALABEL_REAL + '"'
                 ' class="menu-button gem-menu-button open ' + CLASE_GEM_BTN + '" _nghost-ng-c738377845=""')
PLUS_2311_BTN = (' _ngcontent-ng-c738377845="" matbadgeposition="after" maticonbutton="" class="' + CLASE_MAT_BTN + '"' + RIPPLE
                 + ' aria-expanded="false" aria-haspopup="menu" aria-label="' + ARIALABEL_REAL + '" jslog="300142;track:generic_click,impression"'
                 ' aria-disabled="false"')
CLASE_ECRAN = ("mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger fullscreen-button ng-tns-c282099457-4"
               " mat-primary")
ECRAN_ATR = (' _ngcontent-ng-c282099457="" mat-icon-button="" color="primary" aria-label="Extinde intrarea la ecran complet"'
             ' gemtooltip="Ecran complet" class="' + CLASE_ECRAN + '"' + RIPPLE
             + ' aria-describedby="cdk-describedby-message-ng-1-16" cdk-describedby-host="ng-1"')
GI = '<gem-icon><svg><path></path></svg></gem-icon>'      # = iconita din pagina_calibrare


def ecran(atr=ECRAN_ATR, inauntru=GI):
    return "<button" + atr + ">" + inauntru + "</button>"


# r16: completeaza_jslog (r15: cheia taiata COMPLETATA prin deductie - lista inchisa la ultima virgula) a fost scoasa. Fixture-urile folosesc
# valorile INTREGI din captura netaiata (c23n); valorile taiate raman doar ca reproduceri ale refuzului (JSLOG_TAIATE_C23, JSLOG_TRIMITE_TAIAT).


JSLOG_MODEL = ("206752;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGws"
               "bnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWyI5NWE0YzBhYmNiYTI0MzY0Il1d;mutable:true")
MODEL_2311_ATR = (' _ngcontent-ng-c1653784781="" cdkoverlayorigin="" gemmenutrigger="" mat-button="" periodictabletrigger=""'
                  ' gemtooltipposition="below" data-test-id="bard-mode-menu-button" class="mdc-button mat-mdc-button-base mat-mdc-tooltip-trigger'
                  ' input-area-switch mat-mdc-button mat-unthemed lm-enabled" mat-ripple-loader-uninitialized=""'
                  ' mat-ripple-loader-class-name="mat-mdc-button-ripple" type="button" aria-label="Deschide selectorul de moduri, momentan Carbon"'
                  ' jslog="' + JSLOG_MODEL + '" tabindex="0" aria-disabled="false" aria-haspopup="true" aria-expanded="false"'
                  ' aria-controls="ng-menu-a26090-1" aria-describedby="cdk-describedby-message-ng-1-11" cdk-describedby-host="ng-1"')
ETICHETA_MIC = "Dicteaz" + chr(0x103) + " (^" + chr(0x21E7) + "D)"
MIC_2311_GIB = (' _ngcontent-ng-c3904984110="" type="onSurface" class="mat-mdc-tooltip-trigger speech_dictation_mic_button ' + CLASE_GEM_BTN + '"'
                ' _nghost-ng-c738377845="" aria-describedby="cdk-describedby-message-ng-1-2" cdk-describedby-host="ng-1"')
MIC_2311_BTN = (' _ngcontent-ng-c738377845="" matbadgeposition="after" maticonbutton="" class="' + CLASE_MAT_BTN + '"' + RIPPLE
                + ' aria-label="' + ETICHETA_MIC + '" aria-pressed="false" jslog="175863;track:generic_click,impression" aria-disabled="false"')
JSLOG_TRIMITE_TAIAT = ("173899;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxbMCwicm8iLDAs"
                       "IiJdLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWyI5NWE0YzBhYmNiYTI0MzY0Il0sbnVsbCxudWxs"
                       "LG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51")       # t23, exact cum a fost citit (taiat la 300 de caractere)
# r16: valoarea INTREAGA a butonului de trimitere din captura netaiata (c23n, mediu = lung; acelasi chat ca t23): JSLOG_TRIMITE_TAIAT e
# prefixul ei (verificat in test). Cheia decodata are 35 de elemente, ultimul [0] - nevazut cat era taiata.
JSLOG_TRIMITE = ("173899;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxbMCwicm8i"
                 "LDAsIiJdLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWyI5NWE0YzBhYmNiYTI0MzY0"
                 "Il0sbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLFswXV0=;mutable:true")
TRIMITE_2311_GIB = (' _ngcontent-ng-c282099457="" theme="lm" type="onSurface" class="send-button ng-tns-c282099457-4 has-input submit '
                    + CLASE_GEM_BTN + ' ng-star-inserted" _nghost-ng-c738377845="" aria-disabled="false" style=""')
TRIMITE_2311_BTN = (' _ngcontent-ng-c738377845="" matbadgeposition="after" maticonbutton="" class="' + CLASE_MAT_BTN + ' ng-star-inserted"' + RIPPLE
                    + ' aria-label="Trimite mesajul" jslog="' + JSLOG_TRIMITE + '" aria-disabled="false"')
EDITOR_2311_ATR = (' class="ql-editor textarea new-input-ui rich-query-formatting-enabled input-url-linkification-enabled inline-chips-enabled"'
                   + EDITOR_REAL_ATR_FARA_CLASA)                  # fara ql-blank (are text); restul atributelor = cele din 22.11 (identice)
TEXT_LUNG = "".join("<p>Linia %03d a unui brief lung de proba, doar text, nimic atasat.</p>" % k for k in range(160))
assert len(TEXT_LUNG) > 10000


def pagina_23_11(div_atr=DIV_EXTINS_ATR, ecran_html=None, extra_zona="", trimite_gib=TRIMITE_2311_GIB):
    # starea cu text lung din 23.11: pagina reala din 22.11 (stare ii: cu text, cu butonul de trimitere; indicatorul de drop de pe chatul nou,
    # FDI_5G - nu a fost recitit la 23.11) + atributele complete citite la 23.11: zona, div-ul extins, "+", "Ecran complet", modelul,
    # microfonul, trimite (has-input submit), editorul cu ~10 KB de text. Pozitia butonului "Ecran complet" in DOM nu e in captura (dupa
    # sertarul instrumentelor, in div-ul extins - fara efect asupra deciziei). Fiecare inlocuire se face o singura data.
    html = pagina_22_11_completa("ii", fdi=FDI_5G, plus_atr=PLUS_2311_GIB, mic_atr=MIC_2311_GIB, editor_atr=EDITOR_2311_ATR, extra_zona=extra_zona)
    inlocuiri = (
        (ZONA_ATRIBUTE_REALE, ZONA_2311_ATR),
        ('<div class="text-input-field ng-tns-c12-3 simplified-input-area ng-star-inserted"' + ATRIBUTE_DIV_REALE + ">", "<div" + div_atr + ">"),
        ("<toolbox-drawer></toolbox-drawer>", "<toolbox-drawer></toolbox-drawer>" + (ecran() if ecran_html is None else ecran_html)),
        ('<button aria-label="' + ARIALABEL_REAL + '">', "<button" + PLUS_2311_BTN + ">"),
        ('<button data-test-id="bard-mode-menu-button" aria-label="Deschide selectorul de moduri, momentan Carbon">', "<button" + MODEL_2311_ATR + ">"),
        ('<button aria-label="' + ETICHETA_MIC + '">', "<button" + MIC_2311_BTN + ">"),
        ('<gem-icon-button type="onSurface"><button aria-label="Trimite mesajul">', "<gem-icon-button" + trimite_gib + "><button" + TRIMITE_2311_BTN + ">"),
        ("<p>proba</p>", TEXT_LUNG),
    )
    for vechi, nou in inlocuiri:
        assert html.count(vechi) == 1, vechi
        html = html.replace(vechi, nou)
    return html


def chat_nou_gol_23_11():
    # chatul nou gol pe care a trecut paza pe 23.11 (inainte_de_chat_nou / pe_chatul_nou au trecut): pagina reala din 22.11 cu FDI_5G
    return pagina_22_11_completa(fdi=FDI_5G)


def scenariu_brief_lung(mod, dupa_scriere):
    # 23.11: tab-ul curent si chatul nou sunt goale; dupa scrierea brief-ului lung caseta se extinde -> paza de inainte de Enter
    # -> (cod, detaliu, actiuni)
    pg = FakePg(chat_nou_gol_23_11(), dupa_goto=chat_nou_gol_23_11(), dupa_scriere=dupa_scriere)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            mod.trimite(pg, BRIEF_TEST, 30)
        return None, "", pg.act
    except mod.GemEroare as e:
        return e.cod, e.detaliu, pg.act


# v4.6.4c (instalat, 09E78891) = regulile de dinainte de r11: div-ul doar cu clasele normale, fara butonul "Ecran complet" in liste
REGULI_V464C = [('("div", CLASE_DIV_DROP, "xapfileselectordropzone"', '("div", (("text-input-field", "simplified-input-area"),), "xapfileselectordropzone"'),
                ('    "button[aria-label=extinde intrarea la ecran complet][aria-describedby]",', "")]
ACTIUNI_FARA_ENTER = ACTIUNI_TRIMITERE[:-1]


def div_extins(clase=CLASE_DIV_EXTINS, xap="", extra="", inauntru=""):
    return ('<div _ngcontent-ng-c282099457="" xapfileselectordropzone="%s" class="%s" jslog="303810;track:impression"%s>%s</div>'
            % (xap, clase, extra, inauntru))


class TestTextLung2311(unittest.TestCase):
    """r11 (v4.6.4d): caseta extinsa de un brief LUNG. Asteptarile sunt scrise de mana din jurnalul refuzului si din atributele complete."""

    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def stare_linii(self, html, mod=gp):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            mod.stare(FakePg(html))
        return out.getvalue().splitlines()

    def test_jurnalul_din_23_11_se_reproduce_pe_v464c(self):
        # pe regulile v4.6.4c: EXACT linia GEM_EROARE din jurnal, la inainte_de_enter (dupa scriere, fara Enter)
        v464c = mutant(REGULI_V464C)
        self.assertEqual(scenariu_brief_lung(v464c, pagina_23_11()), ("ciorna_necunoscuta", EROARE_23_11, ACTIUNI_FARA_ENTER))
        i = self.an(pagina_23_11(), mod=v464c)
        self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), (list(STARE_23_11), [SURSA_DIV_23_11, ""]))
        linii = self.stare_linii(pagina_23_11(), mod=v464c)
        for l in ("  necunoscut " + STARE_23_11[0], "    sursa " + SURSA_DIV_23_11, "  necunoscut " + STARE_23_11[1]):
            self.assertIn(l, linii)
        # chatul nou gol trecea si pe v4.6.4c (paza inainte_de_chat_nou / pe_chatul_nou a trecut pe 23.11)
        self.assertEqual(self.an(chat_nou_gol_23_11(), mod=v464c)["necunoscute"], 0)
        # div-ul extins singur: semnal pe v4.6.4c, niciunul pe r11
        nod = self.nod(div_extins())
        self.assertEqual(v464c._semnal(nod), (STARE_23_11[0], SURSA_DIV_23_11))
        self.assertIsNone(gp._semnal(nod))

    def test_starea_reala_cu_text_lung_trece(self):
        i = self.an(pagina_23_11())
        self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 0), msg=i["necunoscute_detalii"])
        self.assertEqual(gp.verifica_fara_atasamente(i, 0, "t"), 0)
        linii = self.stare_linii(pagina_23_11())
        self.assertIn("necunoscute in zona: 0", linii)
        self.assertIn("paza ciorna: OK (trimite ar continua)", linii)
        self.assertIn("atasamente in ciorna: 0", " ".join(linii))
        self.assertFalse(any(l.startswith(("  necunoscut", "    sursa")) for l in linii), linii)
        self.assertEqual(scenariu_brief_lung(gp, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE))
        # ciorna lunga lasata in tab-ul curent (nimic atasat): paza inainte_de_chat_nou trece, chatul nou o inlocuieste
        self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_23_11(), dupa_goto=chat_nou_gol_23_11(), dupa_scriere=pagina_23_11())),
                         (None, ACTIUNI_TRIMITERE))
        # fiecare element real citit la 23.11, singur: fara semnal; semnaturile lor sunt in liste (sau e butonul modelului)
        for html, sem, unde in ((ecran(), STARE_23_11[1].split(":", 1)[1], gp.CONTROALE_CUNOSCUTE),
                                ("<button" + PLUS_2311_BTN + "></button>", "button[aria-label=incarcare si instrumente]", gp.CONTROALE_CUNOSCUTE),
                                ("<button" + MIC_2311_BTN + "></button>", "button[aria-label=dicteaza (^?d)]", gp.CONTROALE_CUNOSCUTE),
                                ("<button" + TRIMITE_2311_BTN + "></button>", "button[aria-label=trimite mesajul]", gp.CONTROALE_CUNOSCUTE),
                                ("<gem-icon-button" + TRIMITE_2311_GIB + "></gem-icon-button>", "gem-icon-button[type=onsurface]", gp.STRUCTURA_CUNOSCUTA),
                                ("<gem-icon-button" + MIC_2311_GIB + "></gem-icon-button>", "gem-icon-button[type=onsurface][aria-describedby]",
                                 gp.STRUCTURA_CUNOSCUTA)):
            n = self.nod(html)
            self.assertIsNone(gp._semnal(n), html[:80])
            self.assertEqual(gp._semnatura(n), sem)
            self.assertIn(sem, unde)
        self.assertIsNone(gp._semnal(self.nod("<button" + MODEL_2311_ATR + "></button>")))
        self.assertIsNone(gp._semnal(self.nod("<gem-icon-button" + PLUS_2311_GIB + "></gem-icon-button>")))
        self.assertIsNone(gp._semnal(self.nod("<input-area-v2" + ZONA_2311_ATR + "></input-area-v2>")))

    def test_text_lung_cu_chip_real_ciorna_cu_atasamente(self):
        for n, fisiere in ((1, ("a.txt",)), (2, ("a.txt", "b.png"))):
            html = pagina_23_11(extra_zona="".join(chip(f) for f in fisiere))
            i = self.an(html)
            self.assertEqual((i["atasamente"], i["necunoscute"]), (n, 0), msg=i["necunoscute_detalii"])
            with self.assertRaises(gp.GemEroare) as c:
                gp.verifica_fara_atasamente(i, 0, "t")
            self.assertEqual((c.exception.cod, c.exception.detaliu), ("ciorna_cu_atasamente", "t: %d atasament(e) in ciorna - nu trimit" % n))
            self.assertIn("atasamente in ciorna: %d" % n, " ".join(self.stare_linii(html)))
            # fisierul aparut odata cu textul lung: refuz chiar inainte de Enter
            self.assertEqual(scenariu_brief_lung(gp, html),
                             ("ciorna_cu_atasamente", "inainte_de_enter: %d atasament(e) in ciorna - nu trimit" % n, ACTIUNI_FARA_ENTER))
            # fisierul lasat in tab-ul curent, cu textul lung: refuz fara nicio actiune
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_cu_atasamente", []))
        # chip-ul chiar in div-ul extins si in butonul "Ecran complet": numarat
        div = "<div" + DIV_EXTINS_ATR + ">"
        self.assertEqual(pagina_23_11().count(div), 1)
        self.assertEqual(self.an(pagina_23_11().replace(div, div + chip("a.txt")))["atasamente"], 1)
        self.assertEqual(self.an(pagina_23_11(ecran_html=ecran(inauntru=chip("a.txt"))))["atasamente"], 1)

    def test_multimile_de_clase_acceptate_pe_div(self):
        self.assertEqual(gp.CLASE_DIV_DROP, CLASE_DIV_DROP_ASTEPTATE)
        for clase in CLASE_DIV_DROP_ASTEPTATE:
            for forma in (" ".join(clase), " ".join(reversed(clase)), "ng-tns-c282099457-4 " + " ".join(clase) + " ng-star-inserted"):
                html = div_extins(forma)
                self.assertIsNone(gp._semnal(self.nod(html)), forma)
                i = self.an(zona_cu(html))
                self.assertEqual(i["necunoscute"], 0, msg=(forma, i["necunoscute_detalii"]))
                self.assertEqual(scenariu_brief_lung(gp, pagina_23_11(div_atr=DIV_EXTINS_ATR.replace(CLASE_DIV_EXTINS, forma))),
                                 (None, "", ACTIUNI_TRIMITERE), msg=forma)
        # marcajul nu acopera continutul div-ului extins: fisier / card / atribut cu fisier inauntru = refuz
        for inauntru, m in (("<span>a.txt</span>", "text_fisier:a.txt"), ("<attachment-card></attachment-card>", "element:attachment-card"),
                            ('<div data-file-id="1"></div>', "token_file:div{data-file-id}")):
            self.assertEqual(self.an(zona_cu(div_extins(inauntru=inauntru)))["necunoscute_detalii"], [m], msg=inauntru)

    def test_orice_abatere_pe_div_ul_extins_e_refuzata(self):
        # scris de mana: valoare nevida a marcajului, token de clasa nou / schimbat / lipsa / litere mari, ambele baze, alt tag, alt atribut
        t = lambda clase, atr="jslog xapfileselectordropzone": "token_file:div{%s %s}" % (clase, atr)
        ext = CLASE_DIV_EXTINS
        cazuri = (
            (div_extins(xap="1"), t(ext), SURSA_DIV_23_11 + "1"),
            (div_extins(xap=" "), t(ext), SURSA_DIV_23_11),
            (div_extins(xap="true"), t(ext), SURSA_DIV_23_11 + "true"),
            (div_extins(xap="oferta.docx"), t(ext), SURSA_DIV_23_11 + "oferta.docx"),
            # clasa pre-fullscreen-file (in loc de / pe langa pre-fullscreen): cuvantul "file" e in clasa -> sursa clasa
            (div_extins(ext.replace("pre-fullscreen", "pre-fullscreen-file")), t(ext.replace("pre-fullscreen", "pre-fullscreen-file")),
             "clasa:pre-fullscreen-file"),
            (div_extins(ext + " pre-fullscreen-file"), t(ext + " pre-fullscreen-file"), "clasa:pre-fullscreen-file"),
            # alt token (fara cuvant de atasament): marcajul nu se mai potriveste -> numele xapfileselectordropzone intra in cautare
            (div_extins(ext.replace("pre-fullscreen", "pre-fullscreen-x")), t(ext.replace("pre-fullscreen", "pre-fullscreen-x")), SURSA_DIV_23_11),
            (div_extins(ext.replace("pre-fullscreen", "fullscreen")), t(ext.replace("pre-fullscreen", "fullscreen")), SURSA_DIV_23_11),
            (div_extins(ext.replace("height-expanded-past-single-line", "height-expanded")), t(ext.replace("height-expanded-past-single-line", "height-expanded")), SURSA_DIV_23_11),
            (div_extins(ext.replace("height-expanded-past-single-line", "height-expanded-past-single-line-2")),
             t(ext.replace("height-expanded-past-single-line", "height-expanded-past-single-line-2")), SURSA_DIV_23_11),
            (div_extins(ext + " x"), t(ext + " x"), SURSA_DIV_23_11),
            (div_extins(ext + " fullscreen"), t(ext + " fullscreen"), SURSA_DIV_23_11),
            (div_extins(ext.replace("pre-fullscreen", "Pre-Fullscreen")), t(ext), SURSA_DIV_23_11),          # afisarea e ASCII cu litere mici
            (div_extins(ext.replace("text-input-field ", "")), t(ext.replace("text-input-field ", "")), SURSA_DIV_23_11),
            (div_extins("text-input-field with-toolbox-drawer"), t("text-input-field with-toolbox-drawer"), SURSA_DIV_23_11),
            (div_extins("text-input-field simplified-input-area with-toolbox-drawer"), t("text-input-field simplified-input-area with-toolbox-drawer"), SURSA_DIV_23_11),
            (div_extins("text-input-field simplified-input-area " + ext[len("text-input-field "):]),
             t("text-input-field simplified-input-area " + ext[len("text-input-field "):]), SURSA_DIV_23_11),
            # alt atribut cu "file" / cu nume de fisier alaturi de marcaj
            (div_extins(extra=' data-file-id="1"'), t(ext, "data-file-id jslog xapfileselectordropzone"), "nume_atribut:data-file-id=1"),
            (div_extins(extra=' data-x="oferta.docx"'), "atribut_fisier:div{%s data-x jslog xapfileselectordropzone}" % ext, "valoare_atribut:data-x=oferta.docx"),
            # aceleasi clase si marcaj pe alt element decat div
            ('<span xapfileselectordropzone="" class="%s"></span>' % ext, "token_file:span{%s xapfileselectordropzone}" % ext, SURSA_DIV_23_11),
            ('<rich-textarea xapfileselectordropzone="" class="%s"></rich-textarea>' % ext, "token_file:rich-textarea{%s xapfileselectordropzone}" % ext,
             SURSA_DIV_23_11),
        )
        # r12 (varianta B): cele 3 multimi scoase din r11, in orice ordine / cu token-urile generate = refuz ca orice alta multime
        for clase in CLASE_DIV_SCOASE_R12:
            cazuri += ((div_extins(" ".join(clase)), t(" ".join(clase)), SURSA_DIV_23_11),
                       (div_extins("ng-tns-c282099457-4 " + " ".join(reversed(clase)) + " ng-star-inserted"),
                        t(" ".join(reversed(clase))), SURSA_DIV_23_11))
        for html, m, s in cazuri:
            i = self.an(zona_cu(html))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=html)
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(html))), ("ciorna_necunoscuta", []), msg=html)
            with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (m.split(":", 1)[1], "div", "span")):
                self.assertEqual(self.an(zona_cu(html))["necunoscute_detalii"], [m], msg=html)
        # in starea extinsa reala, dupa scriere: refuz inainte de Enter (r12: si cu fiecare multime scoasa)
        for div_atr in (DIV_EXTINS_ATR.replace('xapfileselectordropzone=""', 'xapfileselectordropzone="1"'),
                        DIV_EXTINS_ATR.replace("pre-fullscreen", "pre-fullscreen-file"), DIV_EXTINS_ATR.replace("pre-fullscreen", "pre-fullscreen-x")) + tuple(
                            DIV_EXTINS_ATR.replace(CLASE_DIV_EXTINS, " ".join(c)) for c in CLASE_DIV_SCOASE_R12):
            cod, det, act = scenariu_brief_lung(gp, pagina_23_11(div_atr=div_atr))
            self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=div_atr)
            self.assertTrue(det.startswith("inainte_de_enter: 1 element(e) nerecunoscute"), det)

    def test_butonul_ecran_complet(self):
        sem = STARE_23_11[1].split(":", 1)[1]
        self.assertEqual(gp._semnatura(self.nod(ecran())), sem)
        self.assertEqual(self.an(zona_cu(ecran()))["necunoscute"], 0)
        # scris de mana: semnatura in afara listei = element necunoscut; eticheta / text / atribut cu fisier = refuz oricare ar fi lista
        alte_clase = "mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger fullscreen-button mat-primary"
        alte_atr = ("cdk-describedby-host color %s gemtooltip mat-icon-button mat-ripple-loader-centered mat-ripple-loader-class-name"
                    " mat-ripple-loader-uninitialized")
        cazuri = (
            (ecran(ECRAN_ATR.replace(' aria-describedby="cdk-describedby-message-ng-1-16"', "")),
             "element:button[aria-label=extinde intrarea la ecran complet]", ""),
            (ecran(ECRAN_ATR.replace("la ecran complet", "")), "element:button[aria-label=extinde intrarea][aria-describedby]", ""),
            (ecran(ECRAN_ATR.replace("la ecran complet", "la ecran complet oferta.docx")),
             "eticheta:button[aria-label=extinde intrarea la ecran complet oferta.docx][aria-describedby]",
             "eticheta:aria-label=extinde intrarea la ecran complet oferta.docx"),
            (ecran(inauntru="<span>oferta.docx</span>"), "text_fisier:oferta.docx", ""),
            (ecran(inauntru="<span>a.txt</span>"), "text_fisier:a.txt", ""),
            (ecran(ECRAN_ATR + ' data-file-name="a.pdf"'),
             "token_file:%s{%s %s}" % (sem, alte_clase, alte_atr % "data-file-name"), "nume_atribut:data-file-name=a.pdf"),
            (ecran(ECRAN_ATR.replace("fullscreen-button", "fullscreen-button attachment-thumb")),
             "token_attach:%s{%s %s}" % (sem, alte_clase.replace("fullscreen-button", "fullscreen-button attachment-thumb"),
                                         (alte_atr % "x").replace(" x ", " ")), "clasa:attachment-thumb"),
            (ecran(inauntru='<img src="data:,">'), "media:img[src]", "tag:img"),
        )
        for html, m, s in cazuri:
            i = self.an(zona_cu(html))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=html)
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(html))), ("ciorna_necunoscuta", []), msg=html)
            cod, det, act = scenariu_brief_lung(gp, pagina_23_11(ecran_html=html))
            self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=html)

    def test_butonul_trimite_has_input_submit(self):
        # starea `has-input submit` (cu style gol) era deja acceptata: invelisul = structura, butonul = controlul calibrat
        html = ('<div data-test-id="send-button-container" aria-describedby="cdk-describedby-message-ng-1-7"><gem-icon-button' + TRIMITE_2311_GIB + '><button'
                + TRIMITE_2311_BTN + ">" + GI + "</button></gem-icon-button></div>")
        self.assertEqual(self.an(zona_cu(html))["necunoscute"], 0)
        # cu style cu continut (ca la 5e) sau cu o clasa de atasament: refuz
        for gib, m, s in ((TRIMITE_2311_GIB.replace('style=""', 'style="--uploader-height: 112px;"'),
                           "token_upload:gem-icon-button[type=onsurface]{send-button has-input submit %s aria-disabled style theme}" % CLASE_GEM_BTN,
                           "valoare_atribut:style=--uploader-height: 112px;"),
                          (TRIMITE_2311_GIB.replace("has-input submit", "has-input submit file-chip"),
                           "token_file:gem-icon-button[type=onsurface]{send-button has-input submit file-chip %s aria-disabled style theme}" % CLASE_GEM_BTN,
                           "clasa:file-chip")):
            i = self.an(pagina_23_11(trimite_gib=gib))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=gib)
            self.assertEqual(scenariu_brief_lung(gp, pagina_23_11(trimite_gib=gib))[0::2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))

    def test_regula_claselor_sta_doar_in_marcaj(self):
        # structural (L19): CLASE_DIV_DROP definita o data si citita doar in MARCAJE_PERMISE; comparatia pe multimi sta doar in _marcaj_permis
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        linii = [l.rstrip("\r") for l in src.split("\n")]
        cod = [l for l in linii if not l.lstrip().startswith("#")]
        i0 = linii.index("def _marcaj_permis(n, k):")
        i1 = next(k for k in range(i0 + 1, len(linii)) if linii[k].startswith("def "))
        corp = [l for l in linii[i0:i1] if not l.lstrip().startswith("#")]
        self.assertEqual(sum(l.startswith("CLASE_DIV_DROP = (") for l in cod), 1)
        self.assertEqual(sum(len(re.findall(r"(?<![A-Za-z_])CLASE_DIV_DROP(?![A-Za-z_])", l)) for l in cod), 2)    # definitia + MARCAJE_PERMISE
        self.assertTrue(any(l.startswith('    ("div", CLASE_DIV_DROP, "xapfileselectordropzone", VALOARE_GOALA, False, ()),') for l in cod))
        self.assertEqual(sum(l == LINIA_CLASE for l in cod), 1)
        self.assertIn(LINIA_CLASE, corp)
        self.assertEqual(sum(l.count("STARE") for l in corp), 0)

    def test_mutanti_r11_lasa_brief_ul_sa_plece(self):
        # fiecare mutant largeste regula noua; scenariul lui pleaca la Enter pe mutant, refuz pe cod; toti lasa starea reala 23.11 sa treaca
        ext = CLASE_DIV_EXTINS
        cazuri = (
            # (M18) clasele ca SUPRAMULTIME a uneia din lista: un token in plus pleaca (x, pre-fullscreen-x, ambele baze)
            ([(" == set(x) for x in clase)", " >= set(x) for x in clase)")],
             (div_extins(ext + " x"), div_extins(ext + " pre-fullscreen-x"),
              div_extins("text-input-field simplified-input-area " + ext[len("text-input-field "):]))),
            # (M19) clasele ca SUBMULTIME: un token lipsa pleaca (fara text-input-field / doar baza with-toolbox-drawer)
            ([(" == set(x) for x in clase)", " <= set(x) for x in clase)")],
             (div_extins(ext.replace("text-input-field ", "")), div_extins("text-input-field with-toolbox-drawer"))),
            # (M20) token-urile comparate fara litere mari
            ([("set(c for c in _clase(n) if not _generat(c)) == set(x)", "set(c.lower() for c in _clase(n) if not _generat(c)) == set(x)")],
             (div_extins(ext.replace("pre-fullscreen", "Pre-Fullscreen")),)),
            # (M21) forma valorii ignorata: marcajul cu valoare pe div-ul extins pleaca
            ([('        if not forma.fullmatch(n.attrs.get(k) or ""):', "        if False:")], (div_extins(xap="1"), div_extins(xap="x"))),
            # (M22) semnatura controlului ca prefix: butonul fara aria-describedby pleaca
            ([("    if sem in CONTROALE_CUNOSCUTE:", "    if any(c.startswith(sem) for c in CONTROALE_CUNOSCUTE):")],
             (ecran(ECRAN_ATR.replace(' aria-describedby="cdk-describedby-message-ng-1-16"', "")),)),
        )
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(html))), ("ciorna_necunoscuta", []), msg=html)
                with fara_r13(mut):                 # r14: lista alba (al doilea strat) oprita doar in mutant
                    cod_m, act_m = ruleaza_trimite(mut, FakePg(zona_cu(html)))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], html, cod_m))
                self.assertIn("press Enter", act_m, msg=html)
            self.assertEqual(scenariu_brief_lung(mut, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE), msg=inlocuiri[0][1])
        # fara r11 (= v4.6.4c instalat): starea reala e refuzata, deci regula noua e cea care o lasa sa treaca
        self.assertEqual(scenariu_brief_lung(mutant(REGULI_V464C), pagina_23_11())[0], "ciorna_necunoscuta")


# --- r12 (v4.6.4d runda 2, 23.11.2026, Jakarinos NO-GO pe r11 / c8b6534a): butonul "Ecran complet" = control cu text INCHIS.
# Reproducerea din verdict (paw-data\out\jak_pr1173_verdict.md), copiata exact: pe r11 da necunoscute=0 si trimite ajunge la press Enter.
REPRO_JAK_R11 = ('<button aria-label="Extinde intrarea la ecran complet" aria-describedby="x">\n'
                 '  <span>continut strain arbitrar</span>\n'
                 '</button>')
# r13: aceeasi reproducere cu identificatorul descrierii in forma REALA (CDK, 23.11): pe r13 `aria-describedby="x"` e el insusi refuzat
# (atribut_text), deci testele r12 de mai jos folosesc forma reala ca sa izoleze regula textului inchis; forma exacta e testata separat
REPRO_R11 = REPRO_JAK_R11.replace('aria-describedby="x"', 'aria-describedby="cdk-describedby-message-ng-1-16"')
assert REPRO_R11 != REPRO_JAK_R11
SEM_ECRAN = "button[aria-label=extinde intrarea la ecran complet][aria-describedby]"
# r16: linia unica din _motiv_text care compara textul cu lista (loc, text); mutantii rundelor vechi o rescriu
LINIA_TEXTE = "    if (_loc_text(nod, ctrl, zona), b) in TEXTE_CUNOSCUTE:"
LINIA_LIGATURA = '    if p is not None and p.tag == "mat-icon" and b in LIGATURI_VAZUTE:'
# r11 (c8b6534a) = fara text inchis in controale: in ORICE control orice text fara semnal trece (eticheta controlului)
REGULI_R11_TEXT = [(LINIA_TEXTE, "    if ctrl is not None or (_loc_text(nod, ctrl, zona), b) in TEXTE_CUNOSCUTE:")]
# r12-r15 (7b9aa4da) = doar butonul "Ecran complet" cu text inchis ("Ecran complet"); celelalte controale (si butonul modelului) = orice
# text fara semnal; ligaturile mat-icon dupa regex (RE_LIGATURA) in afara controalelor; golul decis dupa _ascii (pe forma ASCII)
REGULI_R15_TEXT = [
    (LINIA_TEXTE, "    if (ctrl is not None and (_semnatura(ctrl) != %r or b == \"Ecran complet\")) or (_loc_text(nod, ctrl, zona), b) in TEXTE_CUNOSCUTE:" % SEM_ECRAN),
    (LINIA_LIGATURA, '    if p is not None and p.tag == "mat-icon" and ctrl is None and re.fullmatch(r"[a-z0-9_]{1,40}", b):'),
    ('    if b == "":', '    if b == "" or not _ascii(nod.date):'),
]
LINIA_INTERMEDIAR_2 = '    ("text-input-field", "pre-fullscreen", "with-toolbox-drawer"),'
REGULI_R11_CLASE = [(LINIA_INTERMEDIAR_2, LINIA_INTERMEDIAR_2 + " " + " ".join(repr(c) + "," for c in CLASE_DIV_SCOASE_R12))]
# celelalte controale din CONTROALE_CUNOSCUTE (cate un element cu semnatura exacta): neschimbate de r12
CELELALTE_CONTROALE = (
    ('<button aria-label="Deruleaz\u0103 \u00een jos" type="button" tabindex="0">', "</button>"),     # r16: eticheta din lista alba (r15)
    ('<button aria-label="' + ARIALABEL_REAL + '">', "</button>"),
    ('<button aria-label="' + ETICHETA_MIC + '">', "</button>"),
    ('<button aria-label="Trimite mesajul">', "</button>"),
    ('<a data-test-id="footer-privacy-notice-link" href="https://support.google.com/gemini/answer/14620100">', "</a>"),
)


class TestEcranCompletTextInchis(unittest.TestCase):
    """r12: in butonul "Ecran complet" (si in toti descendentii lui) e permis doar textul gol sau EXACT tooltip-ul vazut ("Ecran complet").
    Asteptarile sunt scrise de mana din verdict si din captura 23.11 (doar atributele butonului; iconita fara nume -> nicio ligatura)."""

    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def refuz_inainte_de_enter(self, html_buton, mod=gp):
        # zona simpla: refuz fara nicio actiune; starea reala 23.11 (brief lung, butonul in caseta extinsa): refuz dupa scriere, fara Enter
        self.assertEqual(ruleaza_trimite(mod, FakePg(zona_cu(html_buton))), ("ciorna_necunoscuta", []), msg=html_buton)
        cod, det, act = scenariu_brief_lung(mod, pagina_23_11(ecran_html=html_buton))
        self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=html_buton)
        self.assertTrue(det.startswith("inainte_de_enter: 1 element(e) nerecunoscute"), det)

    def test_reproducerea_din_verdict_refuzata_inainte_de_enter(self):
        self.assertEqual(gp._semnatura(self.nod(REPRO_R11)), SEM_ECRAN)
        i = self.an(zona_cu(REPRO_R11))
        self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), (["text_in_control:continut strain arbitrar"], [""]))
        self.refuz_inainte_de_enter(REPRO_R11)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(zona_cu(REPRO_R11)))
        self.assertIn("  necunoscut text_in_control:continut strain arbitrar", out.getvalue().splitlines())
        # pe regulile r11 (fara controlul cu text inchis) reproducerea ajunge la Enter, exact ca in verdict
        r11 = mutant(REGULI_R11_TEXT)
        self.assertEqual(self.an(zona_cu(REPRO_R11), mod=r11)["necunoscute"], 0)
        cod, act = ruleaza_trimite(r11, FakePg(zona_cu(REPRO_R11)))
        self.assertIsNone(cod)
        self.assertIn("press Enter", act)
        self.assertEqual(scenariu_brief_lung(r11, pagina_23_11(ecran_html=REPRO_R11)), (None, "", ACTIUNI_TRIMITERE))
        # r13: forma EXACTA din verdictul r11 (aria-describedby="x"): acum DOUA motive - identificatorul de descriere strain (atribut cu
        # text) si textul strain din buton; refuz fara actiuni / inainte de Enter. Pe r11 cu r13 oprit (= r11 real) ajunge la Enter.
        i = self.an(zona_cu(REPRO_JAK_R11))
        self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]),
                         (["atribut_valoare:" + SEM_ECRAN + "{aria-describedby}", "text_in_control:continut strain arbitrar"],
                          ["atribut_valoare:aria-describedby=x", ""]))          # r14: lista alba (valoare in afara formei CDK)
        self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(REPRO_JAK_R11))), ("ciorna_necunoscuta", []))
        cod, det, act = scenariu_brief_lung(gp, pagina_23_11(ecran_html=REPRO_JAK_R11))
        self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
        self.assertTrue(det.startswith("inainte_de_enter: 2 element(e) nerecunoscute"), det)
        with fara_r13(r11):
            self.assertEqual(scenariu_brief_lung(r11, pagina_23_11(ecran_html=REPRO_JAK_R11)), (None, "", ACTIUNI_TRIMITERE))

    def test_orice_text_strain_in_buton_e_refuzat(self):
        # scris de mana: text arbitrar fara extensie / fara cuvant de atasament, oricat de adanc, si prin controale imbricate
        cazuri = (
            ("continut strain", "text_in_control:continut strain"),
            ("<span>continut strain arbitrar</span>", "text_in_control:continut strain arbitrar"),
            ("<span><span><div><span>abc</span></div></span></span>", "text_in_control:abc"),
            (GI + "<span>Extinde intrarea la ecran complet</span>", "text_in_control:extinde intrarea la ecran complet"),
            ("<span>Ecran complet x</span>", "text_in_control:ecran complet x"),
            ("<span>x Ecran complet</span>", "text_in_control:x ecran complet"),
            ("<span>Ecran</span>", "text_in_control:ecran"),
            ("<span>Ecran-complet</span>", "text_in_control:ecran-complet"),
            ("<mat-icon>fullscreen</mat-icon>", "text_in_control:fullscreen"),                 # ligatura: numele iconitei nu e in captura
            ("<mat-icon>open_in_full</mat-icon>", "text_in_control:open_in_full"),
            ('<mat-icon role="img">fullscreen</mat-icon>', "text_in_control:fullscreen"),
            # un control / butonul modelului imbricat nu elibereaza textele
            ('<button aria-label="Trimite mesajul">continut strain</button>', "text_in_control:continut strain"),
            ('<button data-test-id="bard-mode-menu-button">continut strain</button>', "text_in_control:continut strain"),
            ('<span></span><span>continut strain</span>', "text_in_control:continut strain"),
            # r16: nici textul tooltip-ului nu mai e permis in buton (nevazut ca nod text in captura netaiata), nici "Carbon" (alt loc)
            ("<span>Ecran complet</span>", "text_in_control:ecran complet"),
            ('<button data-test-id="bard-mode-menu-button"><span>Carbon</span></button>', "text_in_control:carbon"),
        )
        for inauntru, m in cazuri:
            html = ecran(inauntru=inauntru)
            i = self.an(zona_cu(html))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [""]), msg=inauntru)
            self.refuz_inainte_de_enter(html)
        # si pe forma exacta din verdict (doar aria-label + aria-describedby)
        self.refuz_inainte_de_enter(REPRO_R11.replace("continut strain arbitrar", "abc"))

    def test_text_cu_cuvinte_de_atasament_refuzat(self):
        cazuri = (
            ("<span>fisier atasat</span>", "text_atasament:fisier atasat"),
            ("<span>Trage aici documentul</span>", "text_atasament:trage aici documentul"),
            ("<span>Ecran complet upload</span>", "text_atasament:ecran complet upload"),
            ("<span>Ecran complet a.txt</span>", "text_fisier:ecran complet a.txt"),
            ("<span>oferta.docx</span>", "text_fisier:oferta.docx"),
        )
        for inauntru, m in cazuri:
            html = ecran(inauntru=inauntru)
            self.assertEqual(self.an(zona_cu(html))["necunoscute_detalii"], [m], msg=inauntru)
            self.refuz_inainte_de_enter(html)
            self.refuz_inainte_de_enter(REPRO_R11.replace("<span>continut strain arbitrar</span>", inauntru))

    def test_buton_gol_sau_iconita_trece_textul_tooltip_ului_nu(self):
        # r16: doar golul (pe textul BRUT: spatii albe HTML) si iconitele fara text trec; r12-r15 permiteau si textul "Ecran complet"
        for inauntru in ("", "\n  ", " \t\r\n\f ", GI, "<span></span>", "<span> \n </span>", '<span class="mat-focus-indicator"></span>' + GI,
                         "<mat-icon></mat-icon>", "<div><span>\n \t</span></div>"):
            html = ecran(inauntru=inauntru)
            self.assertEqual(self.an(zona_cu(html))["necunoscute"], 0, msg=inauntru)
            self.assertEqual(scenariu_brief_lung(gp, pagina_23_11(ecran_html=html)), (None, "", ACTIUNI_TRIMITERE), msg=inauntru)
        # textul tooltip-ului in buton (exact sau in orice forma) = text necunoscut pe acest loc, refuz inainte de Enter; pe regulile r15
        # (mutant) forma exacta trecea
        r15 = mutant(REGULI_R15_TEXT)
        for inauntru in ("<span>Ecran complet</span>", GI + "<span>Ecran complet</span>", "<div><span>\n  Ecran complet \t</span></div>"):
            html = ecran(inauntru=inauntru)
            self.assertEqual(self.an(zona_cu(html))["necunoscute_detalii"], ["text_in_control:ecran complet"], msg=inauntru)
            self.refuz_inainte_de_enter(html)
            self.assertEqual(self.an(zona_cu(html), mod=r15)["necunoscute"], 0, msg=inauntru)
        # r15 (Jakarinos r4 P2): Unicode EXACT; r16: oricare forma = refuz (lista e goala pe acest loc)
        for t in ("  ECRAN   complet ", "ecran complet", "Ecran  complet", "Ecr\u00e2n complet", "Ecran complet\u00a0", "\u200bEcran complet",
                  "Ecran\u00a0complet", "Ecran complet."):
            html = ecran(inauntru="<span>" + t + "</span>")
            self.assertEqual(self.an(zona_cu(html))["necunoscute_detalii"], ["text_in_control:" + gp._ascii(t)], msg=t)
            self.refuz_inainte_de_enter(html)
        self.assertEqual(self.an(zona_cu(REPRO_R11.replace("<span>continut strain arbitrar</span>", "")))["necunoscute"], 0)
        # starea reala 23.11 (fixture-ul implicit: butonul cu iconita svg) trece si ajunge la Enter
        self.assertEqual(scenariu_brief_lung(gp, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE))

    def test_celelalte_controale_au_si_ele_text_inchis(self):
        # r16 (Jakarinos NO-GO r15 P1): r12-r15 lasau celelalte controale neschimbate (orice text fara semnal = eticheta) - exact calea
        # gasita de Jakarinos. Acum fiecare control: text strain = `text_in_control:`; cu semnal = refuz ca inainte; iconita fara text trece.
        # Pe regulile r11 / r15 (mutanti) textul strain trecea.
        r11, r15 = mutant(REGULI_R11_TEXT), mutant(REGULI_R15_TEXT)
        for start, final in CELELALTE_CONTROALE:
            n = self.nod(start + final)
            self.assertIn(gp._semnatura(n), gp.CONTROALE_CUNOSCUTE)
            for inauntru, m in (("continut strain", "text_in_control:continut strain"), ("<span>abc</span>", "text_in_control:abc"),
                                ("<span>fisier atasat</span>", "text_atasament:fisier atasat"), ("<span>a.txt</span>", "text_fisier:a.txt"),
                                (GI, None), ("<span>\n \t</span>", None)):
                html = zona_cu(start + inauntru + final)
                self.assertEqual(self.an(html)["necunoscute_detalii"], [m] if m else [], msg=(start, inauntru))
                if m and m.startswith("text_in_control:"):
                    for mod in (r11, r15):
                        self.assertEqual(self.an(html, mod=mod)["necunoscute"], 0, msg=(start, inauntru))

    def test_regula_sta_intr_un_singur_loc(self):
        # structural (L19), r16: CONTROALE_TEXT_INCHIS / _texte_control_inchis / RE_LIGATURA au disparut; TEXTE_CUNOSCUTE e citita intr-un
        # singur loc (_motiv_text, linia LINIA_TEXTE), _loc_text apelata o data, LIGATURI_VAZUTE = () citita o data
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        linii = [l.rstrip("\r") for l in src.split("\n")]
        cod = [l for l in linii if not l.lstrip().startswith("#")]
        numar = lambda nume: sum(len(re.findall(r"(?<![A-Za-z_])%s(?![A-Za-z_])" % nume, l)) for l in cod)
        for nume in ("CONTROALE_TEXT_INCHIS", "_texte_control_inchis", "RE_LIGATURA", "permise"):
            self.assertEqual(numar(nume), 0, nume)
        self.assertEqual(numar("TEXTE_CUNOSCUTE"), 2)              # definitia + _motiv_text
        self.assertEqual(numar("LIGATURI_VAZUTE"), 2)              # definitia + _motiv_text
        self.assertEqual(numar("_loc_text"), 2)                    # definitia + _motiv_text
        self.assertEqual(sum(l.count("_motiv_text(") for l in cod), 2)   # definitia + _necunoscute (docstring-ul lui _semnal il numeste fara paranteza)
        self.assertEqual(linii.count(LINIA_TEXTE), 1)
        self.assertEqual(linii.count(LINIA_LIGATURA), 1)
        self.assertEqual(gp.LIGATURI_VAZUTE, ())
        self.assertEqual(sum(l.count('"text_in_control:"') for l in cod), 1)
        self.assertIn("            ctrl_copii = ctrl               # r12 / r16: sub ORICE control contextul ramane al lui (nimic imbricat nu-l inlocuieste)", linii)

    def test_mutanti_r12_lasa_brief_ul_sa_plece(self):
        # fiecare mutant slabeste regula noua; scenariul lui pleaca la Enter pe mutant, refuz pe cod; toti lasa starea reala 23.11 sa treaca
        cazuri = (
            # (M23) fara text inchis in controale (= r11): orice text trece
            (REGULI_R11_TEXT, (REPRO_R11, ecran(inauntru="<mat-icon>fullscreen</mat-icon>"))),
            # (M24) = r15: doar "Ecran complet" inchis, cu tooltip-ul permis
            (REGULI_R15_TEXT, (ecran(inauntru="<span>Ecran complet</span>"),
                               '<button aria-label="Trimite mesajul"><span>continut strain arbitrar</span></button>')),
            # (M25) textul comparat ca subsir, nu exact (pe locul lui)
            ([(LINIA_TEXTE, "    if any(l == _loc_text(nod, ctrl, zona) and t in b for l, t in TEXTE_CUNOSCUTE):")],
             ('<button data-test-id="bard-mode-menu-button"><span>Carbon x</span></button>',
              '<button data-test-id="bard-mode-menu-button"><span>continut strain Carbon</span></button>')),
            # (M26) contextul primului control inlocuit de un control / butonul modelului imbricat
            ([("            ctrl_copii = ctrl               # r12 / r16", "            pass               # r12 / r16")],
             (ecran(inauntru='<button data-test-id="bard-mode-menu-button"><span>Carbon</span></button>'),)),
            # (M27) ligaturile iconitelor dupa regex (r15 RE_LIGATURA), in orice loc
            ([(LINIA_LIGATURA, '    if p is not None and p.tag == "mat-icon" and re.fullmatch(r"[a-z0-9_]{1,40}", b):')],
             (ecran(inauntru="<mat-icon>fullscreen</mat-icon>"), "<div><mat-icon>continut_strain_arbitrar</mat-icon></div>")),
            # (M28) cele 3 multimi scoase din CLASE_DIV_DROP readuse (= r11)
            (REGULI_R11_CLASE, tuple(div_extins(" ".join(c)) for c in CLASE_DIV_SCOASE_R12)),
        )
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(html))), ("ciorna_necunoscuta", []), msg=html)
                cod_m, act_m = ruleaza_trimite(mut, FakePg(zona_cu(html)))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], html, cod_m))
                self.assertIn("press Enter", act_m, msg=html)
            self.assertEqual(scenariu_brief_lung(mut, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE), msg=inlocuiri[0][1])
        # pe M23 butonul cu text strain in starea reala ajunge la Enter; pe cod refuz inainte de Enter
        self.assertEqual(scenariu_brief_lung(mutant(REGULI_R11_TEXT), pagina_23_11(ecran_html=REPRO_R11))[0], None)
        self.assertEqual(scenariu_brief_lung(gp, pagina_23_11(ecran_html=REPRO_R11))[0], "ciorna_necunoscuta")


# --- r14 (v4.6.4d runda 4, 23.11.2026, Jakarinos NO-GO r3 pe 9c790264): LISTA ALBA de atribute pe orice element acceptat + lista
# inchisa a textelor de descriere. Reproducerile din verdict (paw-data\out\jak_pr1173_r3_verdict.md), copiate exact: pe r13 dau 0 necunoscute
# si `press Enter` (dovedit separat, rulind testele pe 9c790264 - raportul r14); in suita, cu lista alba oprita (fara_r13) trec si ele.
STRAIN = "continut strain arbitrar"
# r13: reproducerile r2 (raman refuzate; acum motivul e `atribut_valoare:` / `atribut_necunoscut:`)
REPRO_R2_TOOLTIP = ecran(ECRAN_ATR.replace('gemtooltip="Ecran complet"', 'gemtooltip="%s"' % STRAIN))
REPRO_R2_SPAN = ecran(inauntru='<span gemtooltip="%s"></span>' % STRAIN)
REPRO_R2_MODEL = ecran(inauntru='<button data-test-id="bard-mode-menu-button" aria-label="%s"></button>' % STRAIN)
assert REPRO_R2_TOOLTIP != ecran()
# r14: cele 4 reproduceri r3 - (1) descrierea in afara casetei cu referinta reala, (2)-(4) descendenti ai butonului "Ecran complet"
REPRO_R3_DESCRIERE = '<div id="cdk-describedby-message-ng-1-16">continut strain arbitrar</div>'
REPRO_R3_SPANURI = ('<span matbadge="continut strain arbitrar"></span>', '<span ariavaluetext="continut strain arbitrar"></span>',
                    '<span data-text="secret"></span>')
REPRO_R3_MOTIVE = ("atribut_necunoscut:span{matbadge}", "atribut_necunoscut:span{ariavaluetext}", "atribut_necunoscut:span{data-text}")
REPRO_R3_SURSE = ("atribut_necunoscut:matbadge=" + STRAIN, "atribut_necunoscut:ariavaluetext=" + STRAIN, "atribut_necunoscut:data-text=secret")
DESCRIERE_STRAINA = "descriere_text:%s{%s}" % ("button[aria-label=extinde intrarea la ecran complet][aria-describedby]", STRAIN)
# linii din _motiv_element (cele 6 acceptari, r13) - tintele mutantilor; fiecare apare o singura data
ACC_EDITOR = "            return _acceptat(n, ctrl, True)"
ACC_IN_EDITOR = "        r = _acceptat(n, ctrl, True)"                  # r18: p / br din editor (si apoi: niciun atribut)
ACC_CLIPBOARD = "        return _acceptat(n, ctrl)                       # r17: div.ql-clipboard gol, exact ca in capturi (fara copii: nimic de citit in el)"
ACC_STRUCT_TAG ="        return _acceptat(n, ctrl)                       # zona si invelisul editorului (aceleasi nume ca selectorii)"
ACC_MODEL = "        return _acceptat(n, n)                          # butonul modelului: verificat separat (verifica_model); textul lui = eticheta"
ACC_NEUTRU = "        return _acceptat(n, ctrl)                       # element neutru fara eticheta / rol / actiune (si fara semnal, mai sus)"
ACC_CONTROL = "        return _acceptat(n, n)                          # control vazut la calibrare; textele din el = eticheta lui (verificate mai sus)"
ACC_STRUCTURA = "        return _acceptat(n, ctrl)                       # invelis vazut la calibrare; continutul lui se verifica mai departe"


def cu_tinta(html, tinta):
    # tinta descrierii (elementul cu id-ul referit) in afara zonei, la sfarsitul body-ului (ca containerul CDK al paginii reale)
    assert html.count("</body>") == 1
    return html.replace("</body>", tinta + "</body>")


# r14: starile REALE din captura completa 23.11 (gol / mediu / lung): toate elementele din input-area-v2 cu TOATE atributele + textul
# propriu, ca literal ASCII. Captura e o lista PLATA (ordinea DOM): adancimea fiecarui element e RECONSTITUITA de mana (generatorul
# verifica secventa de taguri si ca adancimea creste cu cel mult 1). Descendentii editorului NU sunt in captura (textul ciornei):
# editorul primeste aici <p><br></p> / text de proba. Elementul input-area-v2 insusi are atributele din stare_text_lung_23_11.json.
# r16 (Jakarinos r5: "testele pozitive completeaza prin deductie jslog-urile trunchiate"): literalul e generat acum din captura NETAIATA
# (paw_v464_calibrare\stare_completa_23_11_netaiat.json, chat, doar citire, ciorna golita dupa: jslog complet, text propriu pana la
# 2000 de caractere; generator claude-tasks\paw_v464_r16\genereaza_fixture_netaiat.py, aceleasi adancimi). Fata de captura taiata:
# aceleasi taguri / nume / valori, cu exceptia cheilor jslog (acum intregi), a identificatorilor descrierilor (ng-1-20 / ng-1-19 in loc
# de ng-1-18 / ng-1-17: alta incarcare) si a clasei ng-animating de pe send-button-container (mediu). Nimic completat, nimic dedus.
CAPTURA_2311 = {
    'gol': (
        (0, 'div', (('_ngcontent-ng-c282099457', ''), ('uireadyparent', ''), ('data-node-type', 'input-area'), ('class', 'input-area is-zero-state children-ready')), ''),
        (1, 'auto-suggest', (('_ngcontent-ng-c282099457', ''), ('trace', ''), ('_nghost-ng-c140695019', ''), ('class', 'ng-tns-c140695019-5 ng-tns-c282099457-4 ng-star-inserted')), ''),
        (1, 'fieldset', (('_ngcontent-ng-c282099457', ''), ('role', 'none'), ('class', 'input-area-fieldset')), ''),
        (2, 'div', (('_ngcontent-ng-c282099457', ''), ('xapfileselectordropzone', ''), ('class', 'text-input-field simplified-input-area'), ('jslog', '303810;track:impression')), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'leading-actions-wrapper has-model-picker')), ''),
        (4, 'simplified-input-menu', (('_ngcontent-ng-c282099457', ''), ('trace', ''), ('class', 'simplified-input-menu'), ('_nghost-ng-c2269542982', '')), ''),
        (5, 'div', (('_ngcontent-ng-c2269542982', ''), ('class', 'simplified-input-menu-container')), ''),
        (6, 'span', (('_ngcontent-ng-c2269542982', ''), ('cdk-overlay-origin', '')), ''),
        (6, 'gem-icon-button', (('_ngcontent-ng-c2269542982', ''), ('theme', 'lm'), ('type', 'onSurface'), ('ariahaspopup', 'menu'), ('arialabel', '\xcenc\u0103rcare \u0219i instrumente'), ('class', 'menu-button gem-menu-button open gem-button gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled'), ('_nghost-ng-c738377845', '')), ''),
        (7, 'button', (('_ngcontent-ng-c738377845', ''), ('matbadgeposition', 'after'), ('maticonbutton', ''), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above mat-badge-after mat-badge-small mat-badge-hidden'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-expanded', 'false'), ('aria-haspopup', 'menu'), ('aria-label', '\xcenc\u0103rcare \u0219i instrumente'), ('jslog', '300142;track:generic_click,impression'), ('aria-disabled', 'false')), ''),
        (8, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (8, 'gem-icon', (('_ngcontent-ng-c738377845', ''), ('_nghost-ng-c4019194464', '')), ''),
        (9, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'plus'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'plus')), ''),
        (8, 'span', (('class', 'mat-focus-indicator'),), ''),
        (8, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (4, 'toolbox-drawer', (('_ngcontent-ng-c2269542982', ''), ('trace', ''), ('_nghost-ng-c1542544127', ''), ('class', 'ng-tns-c1542544127-8 ng-star-inserted'), ('style', '')), ''),
        (5, 'div', (('_ngcontent-ng-c1542544127', ''), ('class', 'ng-tns-c1542544127-8 toolbox-drawer-container ng-trigger ng-trigger-toolboxDrawerEnter'), ('jslog', '251251;track:impression')), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'single-line-format'), ('style', '--chat-container-height: 718;')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'text-input-field-main-area')), ''),
        (5, 'div', (('_ngcontent-ng-c282099457', ''), ('data-test-id', 'textarea-inner'), ('class', 'text-input-field_textarea-inner')), ''),
        (6, 'div', (('_ngcontent-ng-c282099457', ''), ('data-test-id', 'textarea-wrapper'), ('class', 'textarea-wrapper')), ''),
        (7, 'rich-textarea', (('_ngcontent-ng-c282099457', ''), ('atmentions', ''), ('class', 'text-input-field_textarea ql-container ql-bubble ng-tns-c282099457-4 enterprise simplified-input ng-untouched ng-valid ng-star-inserted ng-dirty'), ('_nghost-ng-c1119053029', ''), ('enterkeyhint', 'send'), ('jslog', '356556;track:generic_click,impression'), ('aria-haspopup', 'menu'), ('dir', 'ltr'), ('style', '--textarea-max-rows: 7; --chat-container-height: 718px;')), ''),
        (8, 'div', (('class', 'ql-editor textarea new-input-ui rich-query-formatting-enabled input-url-linkification-enabled inline-chips-enabled ql-blank'), ('data-gramm', 'false'), ('contenteditable', 'true'), ('dir', 'ltr'), ('role', 'textbox'), ('aria-multiline', 'true'), ('aria-label', 'Introdu o solicitare pentru Gemini'), ('data-placeholder', '\xcentreab\u0103 Gemini'), ('style', '')), ''),
        (8, 'div', (('class', 'ql-clipboard'), ('contenteditable', 'true'), ('tabindex', '-1')), ''),
        (5, 'at-mentions-menu-v2', (('_nghost-ng-c4001200243', ''), ('class', 'ng-tns-c282099457-4 ng-star-inserted'), ('style', '')), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'trailing-actions-wrapper with-model-picker')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'model-picker-container ng-tns-c282099457-4 ng-star-inserted'), ('style', '')), ''),
        (5, 'bard-mode-switcher', (('_ngcontent-ng-c282099457', ''), ('trace', ''), ('tooltipanchorposition', 'above-end'), ('_nghost-ng-c1653784781', ''), ('class', 'ng-tns-c282099457-4 ng-star-inserted')), ''),
        (6, 'div', (('_ngcontent-ng-c1653784781', ''), ('role', 'group'), ('class', 'pill-ui-logo-container gem-menu-redesign under-input ng-star-inserted')), ''),
        (7, 'button', (('_ngcontent-ng-c1653784781', ''), ('cdkoverlayorigin', ''), ('gemmenutrigger', ''), ('mat-button', ''), ('periodictabletrigger', ''), ('gemtooltipposition', 'below'), ('data-test-id', 'bard-mode-menu-button'), ('class', 'mdc-button mat-mdc-button-base mat-mdc-tooltip-trigger input-area-switch mat-mdc-button mat-unthemed lm-enabled'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('type', 'button'), ('aria-label', 'Deschide selectorul de moduri, momentan Carbon'), ('jslog', '206752;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWyI5NWE0YzBhYmNiYTI0MzY0Il1d;mutable:true'), ('tabindex', '0'), ('aria-disabled', 'false'), ('aria-haspopup', 'true'), ('aria-expanded', 'false'), ('aria-controls', 'ng-menu-a26090-1'), ('aria-describedby', 'cdk-describedby-message-ng-1-11'), ('cdk-describedby-host', 'ng-1')), ''),
        (8, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-button__ripple'),), ''),
        (8, 'span', (('class', 'mdc-button__label'),), ''),
        (9, 'div', (('_ngcontent-ng-c1653784781', ''), ('data-test-id', 'logo-pill-label-container'), ('class', 'logo-pill-label-container input-area-switch-label ng-star-inserted')), ''),
        (10, 'span', (('_ngcontent-ng-c1653784781', ''), ('class', 'gds-body-m picker-primary-text ng-star-inserted')), 'Carbon'),
        (9, 'gem-icon', (('_ngcontent-ng-c1653784781', ''), ('fonticonname', 'keyboard_arrow_down'), ('size', 'large'), ('class', 'dropdown-icon ng-star-inserted'), ('_nghost-ng-c4019194464', '')), ''),
        (10, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color ng-star-inserted'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'keyboard_arrow_down'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'keyboard_arrow_down')), ''),
        (8, 'span', (('class', 'mat-focus-indicator'),), ''),
        (8, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (7, 'gem-popover', (('_ngcontent-ng-c1653784781', ''), ('glassmenutheme', ''), ('_nghost-ng-c2811002687', '')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'input-buttons-wrapper-bottom persistent-mic')), ''),
        (5, 'div', (('_ngcontent-ng-c282099457', ''), ('tooltipanchorposition', 'above-end'), ('class', 'mic-button-container persistent-mic ng-trigger ng-trigger-slide')), ''),
        (6, 'speech-dictation-mic-button', (('_ngcontent-ng-c282099457', ''), ('class', 'speech-dictation-mic-button'), ('_nghost-ng-c3904984110', '')), ''),
        (7, 'div', (('_ngcontent-ng-c3904984110', ''), ('data-node-type', 'speech_dictation_mic_button'), ('class', 'gem-mic-button-wrapper lm-enabled')), ''),
        (8, 'gem-icon-button', (('_ngcontent-ng-c3904984110', ''), ('type', 'onSurface'), ('class', 'mat-mdc-tooltip-trigger speech_dictation_mic_button gem-button gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled'), ('_nghost-ng-c738377845', ''), ('aria-describedby', 'cdk-describedby-message-ng-1-2'), ('cdk-describedby-host', 'ng-1')), ''),
        (9, 'button', (('_ngcontent-ng-c738377845', ''), ('matbadgeposition', 'after'), ('maticonbutton', ''), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above mat-badge-after mat-badge-small mat-badge-hidden'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-label', 'Dicteaz\u0103 (^\u21e7D)'), ('aria-pressed', 'false'), ('jslog', '175863;track:generic_click,impression'), ('aria-disabled', 'false')), ''),
        (10, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (10, 'gem-icon', (('_ngcontent-ng-c738377845', ''), ('_nghost-ng-c4019194464', '')), ''),
        (11, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'mic'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'mic')), ''),
        (10, 'span', (('class', 'mat-focus-indicator'),), ''),
        (10, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (8, 'div', (('_ngcontent-ng-c3904984110', ''), ('class', 'circle-overlay')), ''),
    ),
    'mediu': (
        (0, 'div', (('_ngcontent-ng-c282099457', ''), ('uireadyparent', ''), ('data-node-type', 'input-area'), ('class', 'input-area is-zero-state children-ready with-toolbox-drawer')), ''),
        (1, 'auto-suggest', (('_ngcontent-ng-c282099457', ''), ('trace', ''), ('_nghost-ng-c140695019', ''), ('class', 'ng-tns-c140695019-5 ng-tns-c282099457-4 ng-star-inserted')), ''),
        (1, 'fieldset', (('_ngcontent-ng-c282099457', ''), ('role', 'none'), ('class', 'input-area-fieldset')), ''),
        (2, 'div', (('_ngcontent-ng-c282099457', ''), ('xapfileselectordropzone', ''), ('class', 'text-input-field height-expanded-past-single-line pre-fullscreen with-toolbox-drawer'), ('jslog', '303810;track:impression')), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'leading-actions-wrapper has-model-picker')), ''),
        (4, 'simplified-input-menu', (('_ngcontent-ng-c282099457', ''), ('trace', ''), ('class', 'simplified-input-menu'), ('_nghost-ng-c2269542982', '')), ''),
        (5, 'div', (('_ngcontent-ng-c2269542982', ''), ('class', 'simplified-input-menu-container')), ''),
        (6, 'span', (('_ngcontent-ng-c2269542982', ''), ('cdk-overlay-origin', '')), ''),
        (6, 'gem-icon-button', (('_ngcontent-ng-c2269542982', ''), ('theme', 'lm'), ('type', 'onSurface'), ('ariahaspopup', 'menu'), ('arialabel', '\xcenc\u0103rcare \u0219i instrumente'), ('class', 'menu-button gem-menu-button open gem-button gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled'), ('_nghost-ng-c738377845', '')), ''),
        (7, 'button', (('_ngcontent-ng-c738377845', ''), ('matbadgeposition', 'after'), ('maticonbutton', ''), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above mat-badge-after mat-badge-small mat-badge-hidden'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-expanded', 'false'), ('aria-haspopup', 'menu'), ('aria-label', '\xcenc\u0103rcare \u0219i instrumente'), ('jslog', '300142;track:generic_click,impression'), ('aria-disabled', 'false')), ''),
        (8, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (8, 'gem-icon', (('_ngcontent-ng-c738377845', ''), ('_nghost-ng-c4019194464', '')), ''),
        (9, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'plus'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'plus')), ''),
        (8, 'span', (('class', 'mat-focus-indicator'),), ''),
        (8, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (4, 'toolbox-drawer', (('_ngcontent-ng-c2269542982', ''), ('trace', ''), ('_nghost-ng-c1542544127', ''), ('class', 'ng-tns-c1542544127-8 ng-star-inserted'), ('style', '')), ''),
        (5, 'div', (('_ngcontent-ng-c1542544127', ''), ('class', 'ng-tns-c1542544127-8 toolbox-drawer-container ng-trigger ng-trigger-toolboxDrawerEnter'), ('jslog', '251251;track:impression')), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'pre-fullscreen text-input-field_textarea-wrapper'), ('style', '--chat-container-height: 718;')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'text-input-field-main-area')), ''),
        (5, 'div', (('_ngcontent-ng-c282099457', ''), ('data-test-id', 'textarea-inner'), ('class', 'text-input-field_textarea-inner')), ''),
        (6, 'div', (('_ngcontent-ng-c282099457', ''), ('data-test-id', 'textarea-wrapper'), ('class', 'textarea-wrapper')), ''),
        (7, 'rich-textarea', (('_ngcontent-ng-c282099457', ''), ('atmentions', ''), ('class', 'text-input-field_textarea ql-container ql-bubble ng-tns-c282099457-4 enterprise simplified-input ng-untouched ng-valid ng-star-inserted ng-dirty'), ('_nghost-ng-c1119053029', ''), ('enterkeyhint', 'send'), ('jslog', '356556;track:generic_click,impression'), ('aria-haspopup', 'menu'), ('dir', 'ltr'), ('style', '--textarea-max-rows: 7; --chat-container-height: 718px;')), ''),
        (8, 'div', (('class', 'ql-editor textarea new-input-ui rich-query-formatting-enabled input-url-linkification-enabled inline-chips-enabled'), ('data-gramm', 'false'), ('contenteditable', 'true'), ('dir', 'ltr'), ('role', 'textbox'), ('aria-multiline', 'true'), ('aria-label', 'Introdu o solicitare pentru Gemini'), ('data-placeholder', '\xcentreab\u0103 Gemini'), ('style', '')), ''),
        (8, 'div', (('class', 'ql-clipboard'), ('contenteditable', 'true'), ('tabindex', '-1')), ''),
        (5, 'at-mentions-menu-v2', (('_nghost-ng-c4001200243', ''), ('class', 'ng-tns-c282099457-4 ng-star-inserted'), ('style', '')), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'input-buttons-wrapper-top ng-tns-c282099457-4 ng-star-inserted')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'fullscreen-button-container ng-tns-c282099457-4 visible ng-star-inserted')), ''),
        (5, 'button', (('_ngcontent-ng-c282099457', ''), ('mat-icon-button', ''), ('color', 'primary'), ('aria-label', 'Extinde intrarea la ecran complet'), ('gemtooltip', 'Ecran complet'), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger fullscreen-button ng-tns-c282099457-4 mat-primary'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-describedby', 'cdk-describedby-message-ng-1-20'), ('cdk-describedby-host', 'ng-1')), ''),
        (6, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (6, 'mat-icon', (('_ngcontent-ng-c282099457', ''), ('role', 'img'), ('class', 'mat-icon notranslate gds-icon-l google-symbols mat-ligature-font mat-icon-no-color'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'expand_content'), ('fonticon', 'expand_content')), ''),
        (6, 'span', (('class', 'mat-focus-indicator'),), ''),
        (6, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'trailing-actions-wrapper with-model-picker')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'model-picker-container ng-tns-c282099457-4 ng-star-inserted'), ('style', '')), ''),
        (5, 'bard-mode-switcher', (('_ngcontent-ng-c282099457', ''), ('trace', ''), ('tooltipanchorposition', 'above-end'), ('_nghost-ng-c1653784781', ''), ('class', 'ng-tns-c282099457-4 ng-star-inserted')), ''),
        (6, 'div', (('_ngcontent-ng-c1653784781', ''), ('role', 'group'), ('class', 'pill-ui-logo-container gem-menu-redesign under-input ng-star-inserted')), ''),
        (7, 'button', (('_ngcontent-ng-c1653784781', ''), ('cdkoverlayorigin', ''), ('gemmenutrigger', ''), ('mat-button', ''), ('periodictabletrigger', ''), ('gemtooltipposition', 'below'), ('data-test-id', 'bard-mode-menu-button'), ('class', 'mdc-button mat-mdc-button-base mat-mdc-tooltip-trigger input-area-switch mat-mdc-button mat-unthemed lm-enabled'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('type', 'button'), ('aria-label', 'Deschide selectorul de moduri, momentan Carbon'), ('jslog', '206752;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWyI5NWE0YzBhYmNiYTI0MzY0Il1d;mutable:true'), ('tabindex', '0'), ('aria-disabled', 'false'), ('aria-haspopup', 'true'), ('aria-expanded', 'false'), ('aria-controls', 'ng-menu-a26090-1'), ('aria-describedby', 'cdk-describedby-message-ng-1-11'), ('cdk-describedby-host', 'ng-1')), ''),
        (8, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-button__ripple'),), ''),
        (8, 'span', (('class', 'mdc-button__label'),), ''),
        (9, 'div', (('_ngcontent-ng-c1653784781', ''), ('data-test-id', 'logo-pill-label-container'), ('class', 'logo-pill-label-container input-area-switch-label ng-star-inserted')), ''),
        (10, 'span', (('_ngcontent-ng-c1653784781', ''), ('class', 'gds-body-m picker-primary-text ng-star-inserted')), 'Carbon'),
        (9, 'gem-icon', (('_ngcontent-ng-c1653784781', ''), ('fonticonname', 'keyboard_arrow_down'), ('size', 'large'), ('class', 'dropdown-icon ng-star-inserted'), ('_nghost-ng-c4019194464', '')), ''),
        (10, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color ng-star-inserted'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'keyboard_arrow_down'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'keyboard_arrow_down')), ''),
        (8, 'span', (('class', 'mat-focus-indicator'),), ''),
        (8, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (7, 'gem-popover', (('_ngcontent-ng-c1653784781', ''), ('glassmenutheme', ''), ('_nghost-ng-c2811002687', '')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'input-buttons-wrapper-bottom persistent-mic')), ''),
        (5, 'div', (('_ngcontent-ng-c282099457', ''), ('tooltipanchorposition', 'above-end'), ('class', 'mic-button-container persistent-mic ng-trigger ng-trigger-slide')), ''),
        (6, 'speech-dictation-mic-button', (('_ngcontent-ng-c282099457', ''), ('class', 'speech-dictation-mic-button'), ('_nghost-ng-c3904984110', '')), ''),
        (7, 'div', (('_ngcontent-ng-c3904984110', ''), ('data-node-type', 'speech_dictation_mic_button'), ('class', 'gem-mic-button-wrapper lm-enabled')), ''),
        (8, 'gem-icon-button', (('_ngcontent-ng-c3904984110', ''), ('type', 'onSurface'), ('class', 'mat-mdc-tooltip-trigger speech_dictation_mic_button gem-button gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled'), ('_nghost-ng-c738377845', ''), ('aria-describedby', 'cdk-describedby-message-ng-1-2'), ('cdk-describedby-host', 'ng-1')), ''),
        (9, 'button', (('_ngcontent-ng-c738377845', ''), ('matbadgeposition', 'after'), ('maticonbutton', ''), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above mat-badge-after mat-badge-small mat-badge-hidden'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-label', 'Dicteaz\u0103 (^\u21e7D)'), ('aria-pressed', 'false'), ('jslog', '175863;track:generic_click,impression'), ('aria-disabled', 'false')), ''),
        (10, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (10, 'gem-icon', (('_ngcontent-ng-c738377845', ''), ('_nghost-ng-c4019194464', '')), ''),
        (11, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'mic'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'mic')), ''),
        (10, 'span', (('class', 'mat-focus-indicator'),), ''),
        (10, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (8, 'div', (('_ngcontent-ng-c3904984110', ''), ('class', 'circle-overlay')), ''),
        (5, 'div', (('_ngcontent-ng-c282099457', ''), ('data-test-id', 'send-button-container'), ('class', 'mat-mdc-tooltip-trigger send-button-container visible persistent-mic ng-tns-c282099457-4 inner lm-enabled ng-trigger ng-trigger-sendButtonVisibility ng-star-inserted ng-animating'), ('aria-describedby', 'cdk-describedby-message-ng-1-19'), ('cdk-describedby-host', 'ng-1'), ('style', '')), ''),
        (6, 'gem-icon-button', (('_ngcontent-ng-c282099457', ''), ('theme', 'lm'), ('type', 'onSurface'), ('class', 'send-button ng-tns-c282099457-4 has-input submit gem-button gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled ng-star-inserted'), ('_nghost-ng-c738377845', ''), ('aria-disabled', 'false'), ('style', '')), ''),
        (7, 'button', (('_ngcontent-ng-c738377845', ''), ('matbadgeposition', 'after'), ('maticonbutton', ''), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above mat-badge-after mat-badge-small mat-badge-hidden ng-star-inserted'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-label', 'Trimite mesajul'), ('jslog', '173899;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxbMCwicm8iLDAsIiJdLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWyI5NWE0YzBhYmNiYTI0MzY0Il0sbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLFswXV0=;mutable:true'), ('aria-disabled', 'false')), ''),
        (8, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (8, 'gem-icon', (('_ngcontent-ng-c738377845', ''), ('_nghost-ng-c4019194464', '')), ''),
        (9, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color ng-star-inserted'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'arrow_upward'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'arrow_upward')), ''),
        (8, 'span', (('class', 'mat-focus-indicator'),), ''),
        (8, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
    ),
    'lung': (
        (0, 'div', (('_ngcontent-ng-c282099457', ''), ('uireadyparent', ''), ('data-node-type', 'input-area'), ('class', 'input-area is-zero-state children-ready with-toolbox-drawer')), ''),
        (1, 'auto-suggest', (('_ngcontent-ng-c282099457', ''), ('trace', ''), ('_nghost-ng-c140695019', ''), ('class', 'ng-tns-c140695019-5 ng-tns-c282099457-4 ng-star-inserted')), ''),
        (1, 'fieldset', (('_ngcontent-ng-c282099457', ''), ('role', 'none'), ('class', 'input-area-fieldset')), ''),
        (2, 'div', (('_ngcontent-ng-c282099457', ''), ('xapfileselectordropzone', ''), ('class', 'text-input-field height-expanded-past-single-line pre-fullscreen with-toolbox-drawer'), ('jslog', '303810;track:impression')), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'leading-actions-wrapper has-model-picker')), ''),
        (4, 'simplified-input-menu', (('_ngcontent-ng-c282099457', ''), ('trace', ''), ('class', 'simplified-input-menu'), ('_nghost-ng-c2269542982', '')), ''),
        (5, 'div', (('_ngcontent-ng-c2269542982', ''), ('class', 'simplified-input-menu-container')), ''),
        (6, 'span', (('_ngcontent-ng-c2269542982', ''), ('cdk-overlay-origin', '')), ''),
        (6, 'gem-icon-button', (('_ngcontent-ng-c2269542982', ''), ('theme', 'lm'), ('type', 'onSurface'), ('ariahaspopup', 'menu'), ('arialabel', '\xcenc\u0103rcare \u0219i instrumente'), ('class', 'menu-button gem-menu-button open gem-button gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled'), ('_nghost-ng-c738377845', '')), ''),
        (7, 'button', (('_ngcontent-ng-c738377845', ''), ('matbadgeposition', 'after'), ('maticonbutton', ''), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above mat-badge-after mat-badge-small mat-badge-hidden'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-expanded', 'false'), ('aria-haspopup', 'menu'), ('aria-label', '\xcenc\u0103rcare \u0219i instrumente'), ('jslog', '300142;track:generic_click,impression'), ('aria-disabled', 'false')), ''),
        (8, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (8, 'gem-icon', (('_ngcontent-ng-c738377845', ''), ('_nghost-ng-c4019194464', '')), ''),
        (9, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'plus'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'plus')), ''),
        (8, 'span', (('class', 'mat-focus-indicator'),), ''),
        (8, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (4, 'toolbox-drawer', (('_ngcontent-ng-c2269542982', ''), ('trace', ''), ('_nghost-ng-c1542544127', ''), ('class', 'ng-tns-c1542544127-8 ng-star-inserted'), ('style', '')), ''),
        (5, 'div', (('_ngcontent-ng-c1542544127', ''), ('class', 'ng-tns-c1542544127-8 toolbox-drawer-container ng-trigger ng-trigger-toolboxDrawerEnter'), ('jslog', '251251;track:impression')), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'pre-fullscreen text-input-field_textarea-wrapper'), ('style', '--chat-container-height: 718;')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'text-input-field-main-area')), ''),
        (5, 'div', (('_ngcontent-ng-c282099457', ''), ('data-test-id', 'textarea-inner'), ('class', 'text-input-field_textarea-inner')), ''),
        (6, 'div', (('_ngcontent-ng-c282099457', ''), ('data-test-id', 'textarea-wrapper'), ('class', 'textarea-wrapper')), ''),
        (7, 'rich-textarea', (('_ngcontent-ng-c282099457', ''), ('atmentions', ''), ('class', 'text-input-field_textarea ql-container ql-bubble ng-tns-c282099457-4 enterprise simplified-input ng-untouched ng-valid ng-star-inserted ng-dirty'), ('_nghost-ng-c1119053029', ''), ('enterkeyhint', 'send'), ('jslog', '356556;track:generic_click,impression'), ('aria-haspopup', 'menu'), ('dir', 'ltr'), ('style', '--textarea-max-rows: 7; --chat-container-height: 718px;')), ''),
        (8, 'div', (('class', 'ql-editor textarea new-input-ui rich-query-formatting-enabled input-url-linkification-enabled inline-chips-enabled'), ('data-gramm', 'false'), ('contenteditable', 'true'), ('dir', 'ltr'), ('role', 'textbox'), ('aria-multiline', 'true'), ('aria-label', 'Introdu o solicitare pentru Gemini'), ('data-placeholder', '\xcentreab\u0103 Gemini'), ('style', '')), ''),
        (8, 'div', (('class', 'ql-clipboard'), ('contenteditable', 'true'), ('tabindex', '-1')), ''),
        (5, 'at-mentions-menu-v2', (('_nghost-ng-c4001200243', ''), ('class', 'ng-tns-c282099457-4 ng-star-inserted'), ('style', '')), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'input-buttons-wrapper-top ng-tns-c282099457-4 ng-star-inserted')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'fullscreen-button-container ng-tns-c282099457-4 visible ng-star-inserted')), ''),
        (5, 'button', (('_ngcontent-ng-c282099457', ''), ('mat-icon-button', ''), ('color', 'primary'), ('aria-label', 'Extinde intrarea la ecran complet'), ('gemtooltip', 'Ecran complet'), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger fullscreen-button ng-tns-c282099457-4 mat-primary'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-describedby', 'cdk-describedby-message-ng-1-20'), ('cdk-describedby-host', 'ng-1')), ''),
        (6, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (6, 'mat-icon', (('_ngcontent-ng-c282099457', ''), ('role', 'img'), ('class', 'mat-icon notranslate gds-icon-l google-symbols mat-ligature-font mat-icon-no-color'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'expand_content'), ('fonticon', 'expand_content')), ''),
        (6, 'span', (('class', 'mat-focus-indicator'),), ''),
        (6, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (3, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'trailing-actions-wrapper with-model-picker')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'model-picker-container ng-tns-c282099457-4 ng-star-inserted'), ('style', '')), ''),
        (5, 'bard-mode-switcher', (('_ngcontent-ng-c282099457', ''), ('trace', ''), ('tooltipanchorposition', 'above-end'), ('_nghost-ng-c1653784781', ''), ('class', 'ng-tns-c282099457-4 ng-star-inserted')), ''),
        (6, 'div', (('_ngcontent-ng-c1653784781', ''), ('role', 'group'), ('class', 'pill-ui-logo-container gem-menu-redesign under-input ng-star-inserted')), ''),
        (7, 'button', (('_ngcontent-ng-c1653784781', ''), ('cdkoverlayorigin', ''), ('gemmenutrigger', ''), ('mat-button', ''), ('periodictabletrigger', ''), ('gemtooltipposition', 'below'), ('data-test-id', 'bard-mode-menu-button'), ('class', 'mdc-button mat-mdc-button-base mat-mdc-tooltip-trigger input-area-switch mat-mdc-button mat-unthemed lm-enabled'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('type', 'button'), ('aria-label', 'Deschide selectorul de moduri, momentan Carbon'), ('jslog', '206752;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWyI5NWE0YzBhYmNiYTI0MzY0Il1d;mutable:true'), ('tabindex', '0'), ('aria-disabled', 'false'), ('aria-haspopup', 'true'), ('aria-expanded', 'false'), ('aria-controls', 'ng-menu-a26090-1'), ('aria-describedby', 'cdk-describedby-message-ng-1-11'), ('cdk-describedby-host', 'ng-1')), ''),
        (8, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-button__ripple'),), ''),
        (8, 'span', (('class', 'mdc-button__label'),), ''),
        (9, 'div', (('_ngcontent-ng-c1653784781', ''), ('data-test-id', 'logo-pill-label-container'), ('class', 'logo-pill-label-container input-area-switch-label ng-star-inserted')), ''),
        (10, 'span', (('_ngcontent-ng-c1653784781', ''), ('class', 'gds-body-m picker-primary-text ng-star-inserted')), 'Carbon'),
        (9, 'gem-icon', (('_ngcontent-ng-c1653784781', ''), ('fonticonname', 'keyboard_arrow_down'), ('size', 'large'), ('class', 'dropdown-icon ng-star-inserted'), ('_nghost-ng-c4019194464', '')), ''),
        (10, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color ng-star-inserted'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'keyboard_arrow_down'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'keyboard_arrow_down')), ''),
        (8, 'span', (('class', 'mat-focus-indicator'),), ''),
        (8, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (7, 'gem-popover', (('_ngcontent-ng-c1653784781', ''), ('glassmenutheme', ''), ('_nghost-ng-c2811002687', '')), ''),
        (4, 'div', (('_ngcontent-ng-c282099457', ''), ('class', 'input-buttons-wrapper-bottom persistent-mic')), ''),
        (5, 'div', (('_ngcontent-ng-c282099457', ''), ('tooltipanchorposition', 'above-end'), ('class', 'mic-button-container persistent-mic ng-trigger ng-trigger-slide')), ''),
        (6, 'speech-dictation-mic-button', (('_ngcontent-ng-c282099457', ''), ('class', 'speech-dictation-mic-button'), ('_nghost-ng-c3904984110', '')), ''),
        (7, 'div', (('_ngcontent-ng-c3904984110', ''), ('data-node-type', 'speech_dictation_mic_button'), ('class', 'gem-mic-button-wrapper lm-enabled')), ''),
        (8, 'gem-icon-button', (('_ngcontent-ng-c3904984110', ''), ('type', 'onSurface'), ('class', 'mat-mdc-tooltip-trigger speech_dictation_mic_button gem-button gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled'), ('_nghost-ng-c738377845', ''), ('aria-describedby', 'cdk-describedby-message-ng-1-2'), ('cdk-describedby-host', 'ng-1')), ''),
        (9, 'button', (('_ngcontent-ng-c738377845', ''), ('matbadgeposition', 'after'), ('maticonbutton', ''), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above mat-badge-after mat-badge-small mat-badge-hidden'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-label', 'Dicteaz\u0103 (^\u21e7D)'), ('aria-pressed', 'false'), ('jslog', '175863;track:generic_click,impression'), ('aria-disabled', 'false')), ''),
        (10, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (10, 'gem-icon', (('_ngcontent-ng-c738377845', ''), ('_nghost-ng-c4019194464', '')), ''),
        (11, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'mic'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'mic')), ''),
        (10, 'span', (('class', 'mat-focus-indicator'),), ''),
        (10, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
        (8, 'div', (('_ngcontent-ng-c3904984110', ''), ('class', 'circle-overlay')), ''),
        (5, 'div', (('_ngcontent-ng-c282099457', ''), ('data-test-id', 'send-button-container'), ('class', 'mat-mdc-tooltip-trigger send-button-container visible persistent-mic ng-tns-c282099457-4 inner lm-enabled ng-trigger ng-trigger-sendButtonVisibility ng-star-inserted ng-animating'), ('aria-describedby', 'cdk-describedby-message-ng-1-19'), ('cdk-describedby-host', 'ng-1'), ('style', '')), ''),
        (6, 'gem-icon-button', (('_ngcontent-ng-c282099457', ''), ('theme', 'lm'), ('type', 'onSurface'), ('class', 'send-button ng-tns-c282099457-4 has-input submit gem-button gem-button-badge-size-small gem-button-size-small gem-button-type-on-surface lm-enabled ng-star-inserted'), ('_nghost-ng-c738377845', ''), ('aria-disabled', 'false'), ('style', '')), ''),
        (7, 'button', (('_ngcontent-ng-c738377845', ''), ('matbadgeposition', 'after'), ('maticonbutton', ''), ('class', 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-badge mat-unthemed mat-badge-overlap mat-badge-above mat-badge-after mat-badge-small mat-badge-hidden ng-star-inserted'), ('mat-ripple-loader-uninitialized', ''), ('mat-ripple-loader-class-name', 'mat-mdc-button-ripple'), ('mat-ripple-loader-centered', ''), ('aria-label', 'Trimite mesajul'), ('jslog', '173899;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxbMCwicm8iLDAsIiJdLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWyI5NWE0YzBhYmNiYTI0MzY0Il0sbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLFswXV0=;mutable:true'), ('aria-disabled', 'false')), ''),
        (8, 'span', (('class', 'mat-mdc-button-persistent-ripple mdc-icon-button__ripple'),), ''),
        (8, 'gem-icon', (('_ngcontent-ng-c738377845', ''), ('_nghost-ng-c4019194464', '')), ''),
        (9, 'mat-icon', (('_ngcontent-ng-c4019194464', ''), ('role', 'img'), ('class', 'mat-icon notranslate lm-icon-l lumi-symbols mat-ligature-font mat-icon-no-color ng-star-inserted'), ('aria-hidden', 'true'), ('data-mat-icon-type', 'font'), ('data-mat-icon-name', 'arrow_upward'), ('data-mat-icon-namespace', 'lumi-symbols'), ('fonticon', 'arrow_upward')), ''),
        (8, 'span', (('class', 'mat-focus-indicator'),), ''),
        (8, 'span', (('class', 'mat-mdc-button-touch-target'),), ''),
    ),
}
DESCRIERI = {'gol': {'cdk-describedby-message-ng-1-11': 'Schimb\u0103 modelul (^\u21e7M)', 'cdk-describedby-message-ng-1-2': 'Dicteaz\u0103 (^\u21e7D)'}, 'mediu': {'cdk-describedby-message-ng-1-20': 'Ecran complet', 'cdk-describedby-message-ng-1-11': 'Schimb\u0103 modelul (^\u21e7M)', 'cdk-describedby-message-ng-1-2': 'Dicteaz\u0103 (^\u21e7D)', 'cdk-describedby-message-ng-1-19': 'Trimite'}, 'lung': {'cdk-describedby-message-ng-1-20': 'Ecran complet', 'cdk-describedby-message-ng-1-11': 'Schimb\u0103 modelul (^\u21e7M)', 'cdk-describedby-message-ng-1-2': 'Dicteaz\u0103 (^\u21e7D)', 'cdk-describedby-message-ng-1-19': 'Trimite'}}
# r15 / r16: valorile jslog cu cheie EXACT cum au fost citite in captura TAIATA (c23, 200 de caractere) - refuzate (JSON neterminat);
# fiecare e prefixul valorii intregi din captura netaiata (testul o verifica)
JSLOG_TAIATE_C23 = (
    ('button', '206752;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51'),
    ('button', '173899;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxbMCwicm8iLDAsIiJdLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVs'),
)
TEXT_MEDIU = "".join("<p>Rindul %02d al unui brief mediu de proba.</p>" % k for k in range(12))


def _esc(v):
    return v.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def html_captura(stare, editor=None, descrieri=None, inlocuiri=(), extra_zona="", interior=()):
    # pagina cu starea `stare` din captura: elementele imbricate dupa adancime, editorul cu continutul dat, containerul descrierilor
    # (DESCRIERI din captura, fiecare `<div id=... role="tooltip">text</div>`, in afara zonei). inlocuiri = (index, atribute noi) pe un element;
    # interior = (index, html) pus imediat dupa eticheta de deschidere a elementului (un copil in plus)
    if editor is None:
        editor = {"gol": "<p><br></p>", "mediu": TEXT_MEDIU, "lung": TEXT_LUNG}[stare]
    if descrieri is None:
        descrieri = DESCRIERI[stare]
    noi, inauntru = dict(inlocuiri), dict(interior)
    parti, stiva = [], []
    for i, (ad, tag, atr, text) in enumerate(CAPTURA_2311[stare]):
        while len(stiva) > ad:
            parti.append("</%s>" % stiva.pop())
        atr = noi.get(i, atr)
        parti.append("<%s%s>" % (tag, "".join(' %s="%s"' % (k, _esc(v)) for k, v in atr)))
        if text:
            parti.append(_esc(text))
        if dict(atr).get("contenteditable") == "true" and dict(atr).get("role") == "textbox":
            parti.append(editor)
        parti.append(inauntru.get(i, ""))
        stiva.append(tag)
    while stiva:
        parti.append("</%s>" % stiva.pop())
    tinte = "".join('<div id="%s" role="tooltip">%s</div>' % (k, _esc(v)) for k, v in descrieri.items())
    return ('<!DOCTYPE html><html><body><chat-app><main><div class="conversation-container"></div><input-area-v2' + ZONA_2311_ATR + ">"
            + "".join(parti) + extra_zona + '</input-area-v2></main></chat-app>'
            '<div class="cdk-visually-hidden cdk-describedby-message-container" style="visibility: hidden;">' + tinte + "</div></body></html>")


def index_captura(stare, tag, **atr):
    # indexul UNUI element din captura dupa tag + atribute exacte (testele modifica elementul real, nu o copie sintetica)
    g = [i for i, (_, t, a, _) in enumerate(CAPTURA_2311[stare]) if t == tag and all(dict(a).get(k) == v for k, v in atr.items())]
    assert len(g) == 1, (stare, tag, atr, g)
    return g[0]


def cu_atribut(stare, tag, k, v, **atr):
    # (index, atributele elementului real + k=v) pentru html_captura(inlocuiri=...)
    i = index_captura(stare, tag, **atr)
    return (i, tuple(CAPTURA_2311[stare][i][2]) + ((k, v),))


# triplete (tag, atribut, valoare bruta) REALE: toate cele din CAPTURA_2311 + cele vazute in celelalte capturi (scrise de mana)
REALE_ALTE_CAPTURI = (
    ("input-area-v2", "trace", ""),                                          # z21 + t23
    ("input-area-v2", "class", re.search(r'class="([^"]*)"', ZONA_2311_ATR).group(1)),   # r15: t23 (clasa zonei, intreaga)
    ("button", "aria-label", "Deruleaz" + chr(0x103) + " " + chr(0xEE) + "n jos"),   # s21 (semnatura: "deruleaza in jos")
    ("span", "role", "status"),                                              # s21
    ("a", "data-test-id", "footer-privacy-notice-link"),                     # s21 iii
    ("a", "href", "https://support.google.com/gemini/answer/14620100"),      # z21
    ("p", "data-test-id", "empty-disclaimer"),                               # s21 i ii
    ("span", "data-test-id", "content"),                                     # s21 iii
    ("file-drop-indicator", "data-filedrop-id", "chat-window-input-container"),   # g22 + a21
    ("file-drop-indicator", "style", ""),                                    # g22
)
REALE = tuple(sorted(set((t, k, v) for st in CAPTURA_2311.values() for _, t, a, _ in st for k, v in a
                         if not re.fullmatch(r"_ng(content|host)-ng-c[0-9]+", k)) | set(REALE_ALTE_CAPTURI)))
# nume INVENTATE (nu apar in nicio captura) - fiecare, pe fiecare loc acceptat, = `atribut_necunoscut:` (nu schimba semnatura)
NUME_INVENTATE = ("matbadge", "ariavaluetext", "data-text", "data-x", "x-y", "foo", "gemtooltipx", "value", "label", "tooltip",
                  "ng-reflect-message", "arialabelledby", "_ngcontentx", "_ngcontent-ng-cx", "cdkdescribedbyhost", "data-test-idx")


class TestListaAlbaAtribute(unittest.TestCase):
    """r14: pe ORICE element acceptat fiecare atribut e in ATRIBUTE_PERMISE (nume EXACT pe tagul vazut, valoare EXACTA / forma vazuta),
    altfel `atribut_necunoscut:` / `atribut_valoare:` (refuz); tinta lui aria-describedby: doar textele din DESCRIERI_CUNOSCUTE, doar id
    (+ role=tooltip), fara elemente. Asteptarile sunt scrise de mana."""

    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def stare_linii(self, html, mod=gp):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            mod.stare(FakePg(html))
        return out.getvalue().splitlines()

    def refuz(self, html_zona, m, s, mod=gp, ecran_html=None):
        # zona simpla: exact motivul m (sursa s), refuz fara nicio actiune; in starea reala 23.11 (dupa scriere): refuz inainte de Enter
        i = self.an(zona_cu(html_zona), mod)
        self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=html_zona)
        self.assertEqual(ruleaza_trimite(mod, FakePg(zona_cu(html_zona))), ("ciorna_necunoscuta", []), msg=html_zona)
        if ecran_html is not None:
            cod, det, act = scenariu_brief_lung(mod, pagina_23_11(ecran_html=ecran_html))
            self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=ecran_html)
            self.assertTrue(det.startswith("inainte_de_enter: 1 element(e) nerecunoscute"), det)

    def test_cele_patru_reproduceri_r3(self):
        # (2)-(4): descendentii butonului "Ecran complet" cu nume necunoscute -> refuz (zona simpla, starea reala 23.11, captura 23.11 lunga)
        for span, m, s in zip(REPRO_R3_SPANURI, REPRO_R3_MOTIVE, REPRO_R3_SURSE):
            html = ecran(inauntru=span)
            self.refuz(html, m, s, ecran_html=html)
            linii = self.stare_linii(zona_cu(html))
            self.assertIn("  necunoscut " + m, linii)
            self.assertIn("    sursa " + s, linii)
            for stare in ("mediu", "lung"):                     # in captura reala: copil in plus in butonul "Ecran complet"
                cap = html_captura(stare, interior=((index_captura(stare, "button", gemtooltip="Ecran complet"), span),))
                self.assertEqual(self.an(cap)["necunoscute_detalii"], [m], msg=stare)
                self.assertEqual(ruleaza_trimite(gp, FakePg(cap)), ("ciorna_necunoscuta", []))
            # cu lista alba oprita (= nicio regula de atribute, ca r12): exact ce a gasit Jakarinos - 0 necunoscute si `press Enter`
            with fara_r13(gp):
                self.assertEqual(self.an(zona_cu(html))["necunoscute"], 0, msg=html)
                self.assertEqual(scenariu_brief_lung(gp, pagina_23_11(ecran_html=html)), (None, "", ACTIUNI_TRIMITERE), msg=html)
        # (1): descrierea cu referinta reala si text strain, in afara casetei -> refuz inainte de Enter
        html = cu_tinta(pagina_23_11(), REPRO_R3_DESCRIERE)
        i = self.an(html)
        self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]),
                         ([DESCRIERE_STRAINA], ["descriere:cdk-describedby-message-ng-1-16=" + STRAIN]))
        self.assertEqual(scenariu_brief_lung(gp, html)[0::2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
        self.assertIn("  necunoscut " + DESCRIERE_STRAINA, self.stare_linii(html))
        # aceeasi in captura reala 23.11 (lunga): tinta reala a butonului "Ecran complet" (r16, captura netaiata: ng-1-20) cu text strain
        cap = html_captura("lung", descrieri=dict(DESCRIERI["lung"], **{"cdk-describedby-message-ng-1-20": STRAIN}))
        self.assertEqual(self.an(cap)["necunoscute_detalii"], [DESCRIERE_STRAINA])
        # reproducerile r2 raman refuzate (acum de lista alba: valoare in afara listei / nume pe alt tag)
        sm = "button[aria-label=%s][data-test-id=bard-mode-menu-button]" % STRAIN
        for html, m, s in ((REPRO_R2_TOOLTIP, "atribut_valoare:%s{gemtooltip}" % SEM_ECRAN, "atribut_valoare:gemtooltip=" + STRAIN),
                           (REPRO_R2_SPAN, "atribut_necunoscut:span{gemtooltip}", "atribut_necunoscut:gemtooltip=" + STRAIN),
                           (REPRO_R2_MODEL, "atribut_valoare:%s{aria-label}" % sm, "atribut_valoare:aria-label=" + STRAIN)):
            self.refuz(html, m, s, ecran_html=html)

    def test_nume_inventat_pe_fiecare_loc_acceptat(self):
        # scris de mana: fiecare nume inventat, pe fiecare loc acceptat (control, descendenti, structura, butonul modelului, zona, editor)
        locuri = (
            (lambda k, v: ecran(ECRAN_ATR + ' %s="%s"' % (k, v)), True, SEM_ECRAN),                                       # controlul
            (lambda k, v: ecran(inauntru='<span %s="%s"></span>' % (k, v)), True, "span"),                                 # descendent neutru
            (lambda k, v: ecran(inauntru='<div><span><span %s="%s"></span></span></div>' % (k, v)), True, "span"),         # descendent adanc
            (lambda k, v: ecran(inauntru='<svg %s="%s"><path></path></svg>' % (k, v)), True, "svg"),                      # svg in control
            (lambda k, v: ecran(inauntru='<mat-icon role="img" aria-hidden="true" %s="%s"></mat-icon>' % (k, v)), True, "mat-icon[role=img]"),
            (lambda k, v: ecran(inauntru='<gem-icon %s="%s"></gem-icon>' % (k, v)), True, "gem-icon"),                     # structura in control
            (lambda k, v: '<button aria-label="Trimite mesajul" %s="%s"></button>' % (k, v), False, "button[aria-label=trimite mesajul]"),
            (lambda k, v: '<button data-test-id="bard-mode-menu-button" aria-label="Deschide selectorul de moduri, momentan Carbon" %s="%s">'
                          '</button>' % (k, v), False,
             "button[aria-label=deschide selectorul de moduri, momentan carbon][data-test-id=bard-mode-menu-button]"),       # butonul modelului
            (lambda k, v: '<toolbox-drawer %s="%s"></toolbox-drawer>' % (k, v), False, "toolbox-drawer"),                  # structura
            (lambda k, v: '<gem-icon-button type="onSurface" %s="%s"></gem-icon-button>' % (k, v), False, "gem-icon-button[type=onsurface]"),
            (lambda k, v: '<div %s="%s"></div>' % (k, v), False, "div"),                                                   # neutru in zona
        )
        for k in NUME_INVENTATE:
            for v in (STRAIN, "x", ""):
                for fab, in_ecran, sem in locuri:
                    html = fab(k, v)
                    m = "atribut_necunoscut:%s{%s}" % (sem, k)
                    self.refuz(html, m, "atribut_necunoscut:%s=%s" % (k, gp._ascii(v)), ecran_html=html if in_ecran else None)
                # zona insasi, rich-textarea, editorul si un paragraf din editor (in editor: prefixul contextului)
                ed = EDITOR_HTML.replace('contenteditable="true"', 'contenteditable="true" %s="%s"' % (k, v))
                ed_p = EDITOR_HTML.replace("<p>ciorna</p>", '<p %s="%s">ciorna</p>' % (k, v))
                rt = EDITOR_HTML.replace('<rich-textarea class="text-input-field_textarea">', '<rich-textarea class="text-input-field_textarea" %s="%s">' % (k, v))
                for html, m in ((pagina(zona_atr=' %s="%s"' % (k, v)), "atribut_necunoscut:input-area-v2{%s}" % k),
                                (zona_cu(editor=rt), "atribut_necunoscut:rich-textarea{%s}" % k),
                                (zona_cu(editor=ed), "semnal_in_editor:atribut_necunoscut:div[role=textbox][contenteditable]{%s}" % k),
                                (zona_cu(editor=ed_p), "semnal_in_editor:atribut_necunoscut:p{%s}" % k)):
                    self.assertEqual(self.an(html)["necunoscute_detalii"], [m], msg=(k, v))
                    self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=(k, v))
        # acelasi nume inventat in starile REALE din captura 23.11, pe un control, pe un descendent si pe o structura: refuz
        for stare in ("gol", "mediu", "lung"):
            for loc in (cu_atribut(stare, "button", "matbadge", STRAIN, **{"data-test-id": "bard-mode-menu-button"}),
                        cu_atribut(stare, "mat-icon", "data-text", "secret", fonticon="plus"),
                        cu_atribut(stare, "toolbox-drawer", "ariavaluetext", STRAIN),
                        cu_atribut(stare, "div", "foo", "", **{"data-test-id": "textarea-wrapper"})):
                d = self.an(html_captura(stare, inlocuiri=(loc,)))["necunoscute_detalii"]
                self.assertEqual(len(d), 1, msg=(stare, loc[1][-1], d))
                self.assertTrue(d[0].startswith("atribut_necunoscut:") and d[0].endswith("{%s}" % loc[1][-1][0]), msg=d)

    def test_nume_cunoscut_cu_alta_valoare_sau_pe_alt_tag(self):
        # scris de mana: numele e in lista, dar valoarea nu e cea vazuta (atribut_valoare) sau tagul nu e cel vazut (atribut_necunoscut)
        cazuri = (
            ('<toolbox-drawer style="display: none"></toolbox-drawer>', "atribut_valoare:toolbox-drawer{style}"),
            ('<toolbox-drawer trace="x"></toolbox-drawer>', "atribut_valoare:toolbox-drawer{trace}"),
            ('<toolbox-drawer trace=" "></toolbox-drawer>', "atribut_valoare:toolbox-drawer{trace}"),
            ('<span trace=""></span>', "atribut_necunoscut:span{trace}"),
            ('<gem-icon size="small"></gem-icon>', "atribut_valoare:gem-icon{size}"),
            ('<mat-icon role="img" aria-hidden="maybe"></mat-icon>', "atribut_valoare:mat-icon[role=img]{aria-hidden}"),
            ('<mat-icon role="img" fonticon="star"></mat-icon>', "atribut_valoare:mat-icon[role=img]{fonticon}"),
            ('<mat-icon role="img" data-mat-icon-namespace="x"></mat-icon>', "atribut_valoare:mat-icon[role=img]{data-mat-icon-namespace}"),
            ('<div _ngcontent-ng-c12="x"></div>', "atribut_valoare:div{_ngcontent-ng-c12}"),
            ('<div jslog="%s"></div>' % STRAIN, "atribut_valoare:div{jslog}"),
            ('<div jslog="1;track:impression;x"></div>', "atribut_valoare:div{jslog}"),
            ('<div style="--chat-container-height: 718; color: red"></div>', "atribut_valoare:div{style}"),
            ('<div style="--chat-container-height: 718px;"></div>', "atribut_valoare:div{style}"),
            ('<div class="textarea-wrapper inner" data-node-type="x"></div>', "atribut_valoare:div{data-node-type}"),   # r15: clase reale
            ('<div class="a:b"></div>', "atribut_valoare:div{class}"),
            ('<span cdk-overlay-origin="1"></span>', "atribut_valoare:span{cdk-overlay-origin}"),
            ('<gem-popover glassmenutheme="dark"></gem-popover>', "atribut_valoare:gem-popover{glassmenutheme}"),
            (ecran(ECRAN_ATR.replace('color="primary"', 'color="warn"')), "atribut_valoare:%s{color}" % SEM_ECRAN),
            (ecran(ECRAN_ATR.replace('gemtooltip="Ecran complet"', 'gemtooltip="Ecran complet x"')), "atribut_valoare:%s{gemtooltip}" % SEM_ECRAN),
            (ecran(ECRAN_ATR.replace('cdk-describedby-host="ng-1"', 'cdk-describedby-host="ng-2"')), "atribut_valoare:%s{cdk-describedby-host}" % SEM_ECRAN),
            (ecran(ECRAN_ATR + ' aria-controls="x"'), "atribut_valoare:%s{aria-controls}" % SEM_ECRAN),
            (ecran(ECRAN_ATR + ' aria-pressed="mixed"'), "atribut_valoare:%s{aria-pressed}" % SEM_ECRAN),
            (ecran(inauntru='<span gemtooltip="Ecran complet"></span>'), "atribut_necunoscut:span{gemtooltip}"),
            (ecran(inauntru='<span aria-hidden="true"></span>'), "atribut_necunoscut:span{aria-hidden}"),
            ('<gem-icon-button type="onSurface" arialabel="Meniu"></gem-icon-button>',
             "atribut_valoare:gem-icon-button[type=onsurface]{arialabel}"),
            ('<gem-icon-button type="onsurface"></gem-icon-button>', "atribut_valoare:gem-icon-button[type=onsurface]{type}"),
        )
        for html, m in cazuri:
            d = self.an(zona_cu(html))["necunoscute_detalii"]
            self.assertEqual(d, [m], msg=html)
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(html))), ("ciorna_necunoscuta", []), msg=html)
        # identificatorul de descriere: doar forma CDK reala, un singur identificator
        for v in ("cdk-describedby-message-ng-1-2", "cdk-describedby-message-ng-1-9999"):
            self.assertIsNone(gp._atribut_strain(self.nod('<div aria-describedby="%s"></div>' % v)), msg=v)
        for v in ("x", "x1", "cdk-describedby-message-ng-2-1", "cdk-describedby-message-ng-1-16 cdk-describedby-message-ng-1-2",
                  "cdk-describedby-message-ng-1-16x", "cdk-describedby-message-ng-1-", "cdk-describedby-message-ng-1-12345", STRAIN, ""):
            self.assertEqual(gp._atribut_strain(self.nod('<div aria-describedby="%s"></div>' % v)), ("atribut_valoare", "aria-describedby", gp._ascii(v)), msg=v)
        # numele modelului: doar Carbon (lista inchisa); alt model / alta forma = refuz
        for eticheta in ("Deschide selectorul de moduri, momentan Pro", "Deschide selectorul de moduri, momentan Gemini 3 Carbon",
                         "Deschide selectorul de moduri, momentan Carbon x", "Deschide selectorul de moduri", ""):
            self.assertEqual(gp._atribut_strain(self.nod('<button aria-label="%s"></button>' % eticheta))[0:2], ("atribut_valoare", "aria-label"), msg=eticheta)

    def test_valorile_reale_trec_lista_e_inchisa(self):
        # fiecare triplet REAL (din capturi) e acceptat pe tagul lui; lista din cod nu are nicio intrare fara triplet real (pe FIECARE tag al
        # intrarii, cu o valoare reala potrivita de forma) - deci nimic inventat; numarul intrarilor e fixat
        for tag, k, v in REALE:
            self.assertIsNone(gp._atribut_strain(gp._Nod(tag, {k: v}, None)), msg=(tag, k, v))
            # r15: si clasele, si etichetele (r14 le sarea / le compara dupa _ascii): orice alta forma bruta = valoare necunoscuta
            for alt in (v + " x", "x " + v, v + ".pdf", v.upper() if v.upper() != v else v + "Z", v.lower() if v.lower() != v else v + "z"):
                if (tag, k, alt) in REALE:
                    continue
                self.assertEqual(gp._atribut_strain(gp._Nod(tag, {k: alt}, None)), ("atribut_valoare", k, gp._ascii(alt)), msg=(tag, k, alt))
        for taguri, nume, forma in gp.ATRIBUTE_PERMISE:
            for t in taguri:
                if t == "*":
                    self.assertEqual(nume, "class")                                  # singura intrare pe orice tag: doar generatele
                    self.assertEqual(forma.exacte, frozenset())
                    continue
                self.assertTrue(any(tr == t and kr == nume and forma.fullmatch(vr) for tr, kr, vr in REALE),
                                msg=(t, nume, getattr(forma, "pattern", forma)))
        # numarate de mana pe lista din cod: 65 de intrari scrise + 12 de clase (11 taguri + "*") + 3 jslog (div, button, rich-textarea) =
        # 80 de intrari; 79 + 12 + 3 = 94 de perechi (tag, nume)
        self.assertEqual(len(gp.ATRIBUTE_PERMISE), 80)
        self.assertEqual(sum(len(t) for t, _, _ in gp.ATRIBUTE_PERMISE), 94)
        # descrierile: exact cele 4 texte din captura (Unicode exact, r15)
        self.assertEqual(sorted(gp.DESCRIERI_CUNOSCUTE), sorted(set(v for d in DESCRIERI.values() for v in d.values())))
        # generatele Angular: doar numele EXACT de forma lor si doar goale
        for k, v, ok in (("_ngcontent-ng-c282099457", "", True), ("_nghost-ng-c1", "", True), ("_ngcontent-ng-c1", " ", False),
                         ("_ngcontent-ng-c1", "x", False), ("_ngcontent-ng-cx", "", False), ("_ngcontent", "", False), ("ng-version", "", False)):
            self.assertEqual(gp._atribut_strain(gp._Nod("div", {k: v}, None)) is None, ok, msg=(k, v))

    def test_starile_reale_trec(self):
        # regresie pe TOATE starile reale: captura 23.11 (gol / mediu / lung) si fixture-urile 21.11 i / ii / iii, 22.11 i / ii / iii (si cu
        # indicatorul 5g), 23.11 text lung + chat nou: 0 necunoscute, `stare` OK, `trimite` pina la Enter
        cap = {s: html_captura(s) for s in ("gol", "mediu", "lung")}
        for s, html in cap.items():
            i = self.an(html)
            # r17: 1 editor PRINCIPAL (pana la r16: 2 = editorul + div.ql-clipboard, acum clipboard-ul gol e acceptat separat, nu e editor)
            self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 0), msg=(s, i["necunoscute_detalii"]))
            linii = self.stare_linii(html)
            self.assertIn("paza ciorna: OK (trimite ar continua)", linii)
            self.assertIn("necunoscute in zona: 0", linii)
        # chatul nou gol (captura gol) -> scrierea brief-ului extinde caseta (mediu / lung) -> Enter
        for s in ("mediu", "lung"):
            pg = FakePg(cap["gol"], dupa_goto=cap["gol"], dupa_scriere=cap[s])
            self.assertEqual(ruleaza_trimite(gp, pg), (None, ACTIUNI_TRIMITERE), msg=s)
        # fiecare element real, singur: niciun atribut strain
        for st in CAPTURA_2311.values():
            for _, tag, atr, _ in st:
                self.assertIsNone(gp._atribut_strain(gp._Nod(tag, dict(atr), None)), msg=(tag, atr))
        for html in [pagina_calibrare(s) for s in ("i", "ii", "iii")] + [pagina_22_11_completa(s) for s in ("i", "ii", "iii")] + \
                [pagina_22_11_completa(s, fdi=FDI_5G) for s in ("i", "ii", "iii")] + [pagina_23_11(), chat_nou_gol_23_11()]:
            i = self.an(html)
            self.assertEqual((i["atasamente"], i["semne"], i["necunoscute"]), (0, 0, 0), msg=i["necunoscute_detalii"])
            self.assertEqual(ruleaza_trimite(gp, FakePg(html, dupa_goto=html)), (None, ACTIUNI_TRIMITERE))
        self.assertEqual(scenariu_brief_lung(gp, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE))
        for html in (ecran(), "<button" + PLUS_2311_BTN + "></button>", "<button" + MIC_2311_BTN + "></button>",
                     "<button" + TRIMITE_2311_BTN + "></button>", "<button" + MODEL_2311_ATR + "></button>",
                     "<gem-icon-button" + PLUS_2311_GIB + "></gem-icon-button>", "<gem-icon-button" + MIC_2311_GIB + "></gem-icon-button>",
                     "<gem-icon-button" + TRIMITE_2311_GIB + "></gem-icon-button>", "<div" + EDITOR_2311_ATR + "></div>",
                     "<input-area-v2" + ZONA_2311_ATR + "></input-area-v2>", div_extins(), FDI_5G):
            self.assertIsNone(gp._atribut_strain(self.nod(html)), msg=html[:100])
        # cu un fisier in captura reala: tot ciorna_cu_atasamente (lista alba nu ascunde chip-ul)
        i = self.an(html_captura("lung", extra_zona=chip("a.txt")))
        self.assertEqual(i["atasamente"], 1)

    def test_descrierea(self):
        # tinta lui aria-describedby (oriunde in pagina): doar textele vazute, doar id (+ role=tooltip), fara elemente in ea
        sem = SEM_ECRAN
        ref = "cdk-describedby-message-ng-1-16"
        cazuri = (
            ('<div id="%s">oferta.pdf</div>' % ref, "descriere_fisier:%s{oferta.pdf}" % sem, "descriere:%s=oferta.pdf" % ref),
            ('<div id="%s">Fi%sier ata%sat</div>' % (ref, chr(0x219), chr(0x219)), "descriere_atasament:%s{fisier atasat}" % sem,
             "descriere:%s=fisier atasat" % ref),
            ('<div id="%s">%s</div>' % (ref, STRAIN), DESCRIERE_STRAINA, "descriere:%s=%s" % (ref, STRAIN)),
            ('<div id="%s">Ecran complet x</div>' % ref, "descriere_text:%s{ecran complet x}" % sem, "descriere:%s=ecran complet x" % ref),
            ('<div id="%s">Trimite mesajul</div>' % ref, "descriere_text:%s{trimite mesajul}" % sem, "descriere:%s=trimite mesajul" % ref),
            ('<div id="%s" aria-label="%s">Ecran complet</div>' % (ref, STRAIN), "descriere_structura:%s{aria-label}" % sem,
             "descriere_atribut:aria-label=" + STRAIN),
            ('<div id="%s" role="tooltip" title="x">Ecran complet</div>' % ref, "descriere_structura:%s{title}" % sem, "descriere_atribut:title=x"),
            ('<div id="%s" role="status">Ecran complet</div>' % ref, "descriere_structura:%s{role}" % sem, "descriere_atribut:role=status"),
            ('<div id="%s" class="x">Ecran complet</div>' % ref, "descriere_structura:%s{class}" % sem, "descriere_atribut:class=x"),
            ('<div id="%s">Ecran <span>complet</span></div>' % ref, "descriere_structura:%s{span}" % sem, "descriere_element:span"),
            ('<div id="%s">Ecran complet<img src="x"></div>' % ref, "descriere_structura:%s{img}" % sem, "descriere_element:img[src]"),
            # id dublat: si a doua tinta se verifica
            ('<div id="%s">Ecran complet</div><div id="%s">%s</div>' % (ref, ref, STRAIN), DESCRIERE_STRAINA, "descriere:%s=%s" % (ref, STRAIN)),
        )
        for tinta, m, s in cazuri:
            html = cu_tinta(pagina_23_11(), tinta)
            i = self.an(html)
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=tinta)
            self.assertEqual(scenariu_brief_lung(gp, html)[0::2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=tinta)
        # tinta IN zona: aceeasi regula (nu mai e sarita)
        z = zona_cu('<div data-test-id="send-button-container" aria-describedby="cdk-describedby-message-ng-1-5"></div>'
                    '<div id="cdk-describedby-message-ng-1-5">Trimite</div>'.replace("Trimite", STRAIN))
        self.assertIn("descriere_text:div[data-test-id=send-button-container][aria-describedby]{%s}" % STRAIN, self.an(z)["necunoscute_detalii"])
        # calea legitima: fiecare text real, cu sau fara role=tooltip, gol sau tinta lipsa = trece
        for text in ("Ecran complet", "Trimite", "Schimb" + chr(0x103) + " modelul (^" + chr(0x21E7) + "M)", ETICHETA_MIC, ""):
            for t in ('<div id="%s">%s</div>', '<div id="%s" role="tooltip">%s</div>'):
                html = cu_tinta(pagina_23_11(), t % (ref, text))
                self.assertEqual(self.an(html)["necunoscute"], 0, msg=(t, text))
                self.assertEqual(scenariu_brief_lung(gp, html), (None, "", ACTIUNI_TRIMITERE), msg=text)
        self.assertEqual(self.an(pagina_23_11())["necunoscute"], 0)
        # in captura reala: fiecare descriere cu un text strain / cu un atribut in plus = refuz
        for stare in ("gol", "mediu", "lung"):
            for k in DESCRIERI[stare]:
                d = self.an(html_captura(stare, descrieri=dict(DESCRIERI[stare], **{k: STRAIN})))["necunoscute_detalii"]
                self.assertEqual(len(d), 1, msg=(stare, k, d))
                self.assertTrue(d[0].startswith("descriere_text:") and d[0].endswith("{%s}" % STRAIN), msg=d)

    def test_regula_sta_intr_un_singur_loc(self):
        # structural (L19): toate cele 6 acceptari din _motiv_element trec prin _acceptat; ATRIBUTE_PERMISE citita doar in _intrari_atribut;
        # _atribut_strain apelata doar din _acceptat; motivele scrise o data; nicio urma din lista neagra r13
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        linii = [l.rstrip("\r") for l in src.split("\n")]
        cod = [l for l in linii if not l.lstrip().startswith("#")]
        i0 = linii.index("def _motiv_element(n, ctrl, in_editor=False):")
        i1 = next(k for k in range(i0 + 1, len(linii)) if linii[k].startswith("def "))
        corp = [l for l in linii[i0:i1] if not l.lstrip().startswith("#")]
        self.assertFalse(any(re.search(r"return None\s*,", l) for l in corp), corp)
        # r17: + clipboard-ul Quill gol (ACC_CLIPBOARD); r18: editorul insusi (ACC_EDITOR) separat de p / br din el (ACC_IN_EDITOR)
        self.assertEqual(sum(l.count("_acceptat(") for l in corp), 8)
        for l in (ACC_EDITOR, ACC_IN_EDITOR, ACC_CLIPBOARD, ACC_STRUCT_TAG, ACC_MODEL, ACC_NEUTRU, ACC_CONTROL, ACC_STRUCTURA):
            self.assertEqual(linii.count(l), 1, l)
        numar = lambda nume: sum(len(re.findall(r"(?<![A-Za-z_])%s(?![A-Za-z_])" % nume, l)) for l in cod)
        self.assertEqual(numar("ATRIBUTE_PERMISE"), 2)                # definitia + citirea din _intrari_atribut
        self.assertEqual(numar("_intrari_atribut"), 2)                # definitia + apelul din _atribut_strain
        self.assertEqual(numar("_atribut_strain"), 2)                 # definitia + apelul din _acceptat
        self.assertEqual(numar("DESCRIERI_CUNOSCUTE"), 2)             # definitia + _motiv_descriere
        self.assertEqual(numar("ATRIBUTE_TINTA_DESCRIERE"), 2)
        self.assertEqual(numar("ATR_GENERAT"), 2)
        self.assertEqual(sum(l.count("_acceptat(") for l in cod), 9)              # definitia + cele 8 apeluri (r17: + clipboard; r18: + p / br)
        self.assertEqual(sum(l.count("_motiv_descriere(") for l in cod), 2)       # definitia + apelul din _necunoscute
        for vechi in ("VALORI_TEXT_CUNOSCUTE", "ATRIBUTE_TEXT", "FRAGMENTE_NUME_TEXT", "FORMA_IDENTIFICATOR", "_atribut_cu_text",
                      "_atribut_text_strain", '"atribut_text:'):
            self.assertEqual(sum(l.count(vechi) for l in cod), 0, vechi)

    def test_mutanti_r14_lasa_brief_ul_sa_plece(self):
        # fiecare mutant slabeste regula noua; scenariul lui pleaca la Enter pe mutant, refuz pe cod; toti lasa starile reale sa treaca
        nb = lambda s: s.replace("return _acceptat(n, ctrl, True)", 'return None, ctrl, ""').replace("return _acceptat(n, ctrl)", 'return None, ctrl, ""') \
            .replace("return _acceptat(n, n)", 'return None, n, ""')
        ed_strain = EDITOR_HTML.replace('contenteditable="true"', 'contenteditable="true" matbadge="%s"' % STRAIN)
        descr = cu_tinta(pagina_23_11(), REPRO_R3_DESCRIERE)
        cazuri = (
            # (M43) fara lista alba: cele 3 reproduceri r3 cu nume + cele 3 r2 pleaca
            ([("    a = _atribut_strain(n)", "    a = None")],
             tuple(zona_cu(ecran(inauntru=s)) for s in REPRO_R3_SPANURI) + (zona_cu(REPRO_R2_TOOLTIP), zona_cu(REPRO_R2_SPAN), zona_cu(REPRO_R2_MODEL))),
            # (M30)-(M35) cate o cale de acceptare ocolita (pastrati din r13, scenarii r14)
            ([(ACC_CONTROL, nb(ACC_CONTROL))], (zona_cu(ecran(ECRAN_ATR + ' matbadge="%s"' % STRAIN)),)),
            ([(ACC_NEUTRU, nb(ACC_NEUTRU))], (zona_cu(ecran(inauntru=REPRO_R3_SPANURI[0])),)),
            ([(ACC_MODEL, nb(ACC_MODEL))], (zona_cu(ecran(inauntru='<button data-test-id="bard-mode-menu-button" foo="x"></button>')),)),
            ([(ACC_STRUCTURA, nb(ACC_STRUCTURA))], (zona_cu('<toolbox-drawer matbadge="%s"></toolbox-drawer>' % STRAIN),)),
            ([(ACC_STRUCT_TAG, nb(ACC_STRUCT_TAG))], (pagina(zona_atr=' matbadge="%s"' % STRAIN),)),
            ([(ACC_EDITOR, nb(ACC_EDITOR))], (zona_cu(editor=ed_strain),)),
            # (M44) doar numele verificat, valoarea ignorata: tooltip-ul strain (r2) pleaca
            ([("        if not any(forma.fullmatch(v) for forma in intrari):", "        if False:")],
             (zona_cu(REPRO_R2_TOOLTIP), zona_cu('<toolbox-drawer style="display: none"></toolbox-drawer>'))),
            # (M45) tagul ignorat: tooltip-ul (valoarea reala) al butonului pe un span pleaca
            ([('if nume == k and (tag in taguri or "*" in taguri)]', "if nume == k]")],
             (zona_cu(ecran(inauntru='<span gemtooltip="Ecran complet"></span>')), zona_cu('<span trace=""></span>'))),
            # (M46) valoarea comparata ca subsir / prefix
            ([("        if not any(forma.fullmatch(v) for forma in intrari):",
               "        if not any((forma.match(v) if hasattr(forma, 'match') else forma.fullmatch(v)) for forma in intrari):")],
             (zona_cu(ecran(ECRAN_ATR.replace('gemtooltip="Ecran complet"', 'gemtooltip="Ecran complet %s"' % STRAIN))),)),
            # (M47) generatele Angular acceptate cu orice valoare; (M48) generatele ca prefix `_ng`
            ([("            if v == \"\":", "            if True:")], (zona_cu('<div _ngcontent-ng-c1="%s"></div>' % STRAIN),)),
            ([("        if ATR_GENERAT.fullmatch(k):", '        if k.startswith("_ng"):')], (zona_cu('<div _ngx=""></div>'),)),
            # (M49) fara lista textelor de descriere: reproducerea r3 (1) pleaca
            ([('            if b != "" and b not in DESCRIERI_CUNOSCUTE:', "            if False:")], (descr,)),
            # (M50) tinta descrierii cu orice atribut; (M51) cu elemente in ea
            ([('                if k != "id" and not any(k == nume and forma.fullmatch(v) for nume, forma in ATRIBUTE_TINTA_DESCRIERE):',
               "                if False:")],
             (cu_tinta(pagina_23_11(), '<div id="cdk-describedby-message-ng-1-16" aria-label="%s">Ecran complet</div>' % STRAIN),)),
            ([("            if e is not None:", "            if False:")],
             (cu_tinta(pagina_23_11(), '<div id="cdk-describedby-message-ng-1-16">Ecran complet<span aria-label="%s"></span></div>' % STRAIN),)),
            # (o tinta IN zona are `id`, pe care lista alba il refuza oricum: verificarea ei e un al doilea strat, fara mutant propriu)
        )
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=(inlocuiri[0][1], html[-300:]))
                cod_m, act_m = ruleaza_trimite(mut, FakePg(html))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], html[-300:], cod_m))
                self.assertIn("press Enter", act_m)
            self.assertEqual(scenariu_brief_lung(mut, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE), msg=inlocuiri[0][1])
            for s in ("gol", "mediu", "lung"):
                h = html_captura(s)
                self.assertEqual(ruleaza_trimite(mut, FakePg(h, dupa_goto=h)), (None, ACTIUNI_TRIMITERE), msg=(inlocuiri[0][1], s))
            for s in ("i", "ii", "iii"):
                h = pagina_22_11_completa(s, fdi=FDI_5G)
                self.assertEqual(ruleaza_trimite(mut, FakePg(h, dupa_goto=h)), (None, ACTIUNI_TRIMITERE), msg=(inlocuiri[0][1], s))
        # pe M43 reproducerile pleaca si in starea reala cu brief lung; pe cod refuz inainte de Enter; pe M49 la fel descrierea
        m43, m49 = mutant(cazuri[0][0]), mutant(cazuri[12][0])
        for html in REPRO_R3_SPANURI:
            self.assertEqual(scenariu_brief_lung(m43, pagina_23_11(ecran_html=ecran(inauntru=html))), (None, "", ACTIUNI_TRIMITERE))
            self.assertEqual(scenariu_brief_lung(gp, pagina_23_11(ecran_html=ecran(inauntru=html)))[0], "ciorna_necunoscuta")
        self.assertEqual(scenariu_brief_lung(m49, descr), (None, "", ACTIUNI_TRIMITERE))
        self.assertEqual(scenariu_brief_lung(gp, descr)[0], "ciorna_necunoscuta")


class TestCaptureCaseta(unittest.TestCase):
    """r12: unealta de captura din RUNBOOK 5g2 (diag/captura_caseta.py) e DOAR citire: nicio actiune pe pagina, nicio scriere."""

    def test_captura_doar_citire(self):
        with open(os.path.join(AICI, "..", "diag", "captura_caseta.py"), "rb") as f:
            src = f.read().decode("ascii")
        cod = "\n".join(l for l in src.replace("\r", "").split("\n") if not l.lstrip().startswith("#"))
        for interzis in (".click(", ".fill(", ".press(", ".type(", ".goto(", ".reload(", ".keyboard", ".mouse", ".tap(", "dispatch",
                         ".check(", "set_input_files", ".close(", "open(", "write", "remove", "unlink", "subprocess", "os.system",
                         "innerHTML =", ".focus(", "insertText", "execCommand"):
            self.assertNotIn(interzis, cod, interzis)
        self.assertEqual(cod.count("connect_over_cdp("), 1)
        self.assertIn("http://127.0.0.1:9333", cod)
        self.assertEqual(cod.count(".evaluate("), 1)
        # r13: captura citeste si atributele tuturor elementelor casetei (fara continutul editorului) si textele descrierilor
        self.assertIn("elemente:", cod)
        self.assertIn("!(ed && ed !== el && ed.contains(el))", cod)
        self.assertIn("descrieri:", cod)
        # r14: + tintele descrierilor (atribute + numarul de elemente), zona exacta a analizei (aceiasi selectori ca ZONA) si DOAR atributele
        # elementelor din editor (fara text: nici textContent, nici innerText, nici innerHTML pe ele)
        self.assertIn("tinte:", cod)
        self.assertIn("copii: t.children.length", cod)
        self.assertIn("zona_analiza:", cod)
        self.assertIn("p.matches('%s')" % gp.ZONA, cod)
        i = cod.index("editor_atribute:")
        linie = cod[i:cod.index("\n", i)]
        self.assertIn("attrs: atr(el)", linie)
        for interzis in ("textContent", "innerText", "innerHTML"):
            self.assertNotIn(interzis, linie)
        self.assertEqual(cod.count("innerText"), 1)                    # doar lungimea ciornei (ciorna_lungime), ca in r12
        # r15: jslog citit netaiat (cheia BardVeMetadataKey se verifica decodata), restul atributelor taiate la 300, ca in r12-r14
        self.assertIn("x.value.slice(0, x.name === 'jslog' ? 20000 : 300)", cod)
        self.assertEqual(cod.count("const atr = "), 1)
        # r16: + textul propriu BRUT (noduri text directe, fara trim, 2000) pe `elemente` si `zona_analiza`; editorul insusi = gol, iar
        # descendentii editorului raman exclusi (filtrul de mai sus) / fara text (editor_atribute)
        self.assertIn("const tp = el => el === ed ? '' : Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.data).join('').slice(0, 2000);", cod)
        self.assertEqual(cod.count("text_propriu: tp(el)"), 2)
        self.assertNotIn("text_propriu", linie)
        self.assertNotIn("trim", cod.replace("(ed.innerText || '').trim().length", ""))

    def test_runbook_5g2a_cere_succes_explicit(self):
        # r13 (Jakarinos r2): dupa `stare` se verifica $LASTEXITCODE SI linia EXACTA de succes, aceeasi pe care o scrie `stare` cand paza trece
        with open(os.path.join(AICI, "..", "RUNBOOK_RAZVAN.md"), "rb") as f:
            rb = f.read().decode("utf-8").replace("\r", "")
        i0 = rb.index("# 5g2-a: captura, doar citire")
        i1 = rb.index("# 5g2-b: trimiterea")
        bloc = rb[i0:i1].split("\n")
        def idx(l):
            self.assertEqual(sum(x.strip() == l for x in bloc), 1, l)
            return next(k for k, x in enumerate(bloc) if x.strip() == l)
        a = idx('$cap = @(& $Python "$Source\\diag\\captura_caseta.py" $k)')
        self.assertEqual(bloc[a + 1].strip(), "$codCap = $LASTEXITCODE")
        s = idx('$st = @(& $Python "$Bin\\gemini_pw.py" stare)')
        self.assertEqual(bloc[s + 1].strip(), "$codSt = $LASTEXITCODE")
        txt = "\n".join(bloc)
        self.assertIn("if ($codSt -ne 0) { throw", txt)
        self.assertIn("if ($codCap -ne 0 -or $cap.Count -eq 0 -or $cap[-1] -cne \"CAPTURA_GATA $k\")", txt)
        self.assertIn("@($st | Where-Object { $_ -clike 'paza ciorna:*' }).Count -ne 1", txt)
        self.assertIn("@($st | Where-Object { $_ -ceq 'paza ciorna: OK (trimite ar continua)' }).Count -ne 1", txt)
        # verificarile vin DUPA golirea ciornei (operatorul nu ramane cu textul in caseta) si INAINTEA iesirii din bucla
        self.assertLess(txt.index("goleste ciorna de mana"), txt.index("if ($codSt -ne 0)"))
        # linia ceruta e chiar cea scrisa de `stare` cand paza trece (si lipseste cand refuza)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(pagina_23_11()))
        self.assertEqual([l for l in out.getvalue().splitlines() if l.startswith("paza ciorna:")], ["paza ciorna: OK (trimite ar continua)"])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(zona_cu(REPRO_R2_TOOLTIP)))
        linii = [l for l in out.getvalue().splitlines() if l.startswith("paza ciorna:")]
        self.assertEqual(len(linii), 1)
        self.assertTrue(linii[0].startswith("paza ciorna: REFUZ ciorna_necunoscuta"), linii)


# --- r15 (v4.6.4d runda 5, 23.11.2026, Jakarinos NO-GO r4 pe dd872d09, paw-data\out\jak_pr1173_r4_verdict.md): (1) `class` = token-uri
# EXACTE pe tag + generatele Angular vazute; `jslog` = valorile vazute cu doar numerele variabile; (2) comparatiile de text pe Unicode EXACT.
# Reproducerile din verdict, copiate exact: pe r14 dau 0 necunoscute si `press Enter` (aici: mutantul cu formele r14 / comparatia _ascii r14;
# separat, testele noi rulate pe dd872d09 - raportul r15).
REPRO_R4_CLASA = '<span class="continut-strain-arbitrar"></span>'
REPRO_R4_JSLOG = "123;track:continut_strain_arbitrar"
REF_REALA = "cdk-describedby-message-ng-1-16"                                # referinta reala din verdict
REPRO_R4_DESCRIERI = ("Ecr\u00e2n complet", "Dicteaz\u0103 (^\u732bD)")    # `Ecran complet` / `Dicteaza (^?D)` cu un caracter schimbat
# formele largi din r14 (dd872d09), copiate exact, pentru mutantul "r14": orice token de clasa, orice `track:` / orice cheie base64
FORMA_CLASE_R14 = r"[ \t\n\r\f]*(?:[A-Za-z0-9_-]{1,100}(?:[ \t\n\r\f]+[A-Za-z0-9_-]{1,100}){0,80})?[ \t\n\r\f]*"
FORMA_JSLOG_R14 = (r"[0-9]{1,9};track:[a-z_]{1,40}(?:,[a-z_]{1,40}){0,5}(?:;BardVeMetadataKey:[A-Za-z0-9+/]{1,8000}={0,2})?"
                   r"(?:;mutable:true)?")
LINIA_CLASE_JSLOG = ") + _intrari_clase_jslog()   # r15: class / jslog (mai sus)"
REGULI_R14_CLASE_JSLOG = [(LINIA_CLASE_JSLOG, ') + ((("*",), "class", re.compile(%r)), (("div", "button", "rich-textarea"), "jslog", re.compile(%r)))'
                           % (FORMA_CLASE_R14, FORMA_JSLOG_R14))]
# comparatiile r14 dupa _ascii: descrierile, textele permise ale controlului inchis, etichetele din lista alba (aria-label / arialabel /
# gemtooltip / data-placeholder, ca `text=True` din r14)
LINIA_DESCRIERE = '            if b != "" and b not in DESCRIERI_CUNOSCUTE:'
REGULI_R14_DESCRIERE = [(LINIA_DESCRIERE, "            if a and a not in [_ascii(t) for t in DESCRIERI_CUNOSCUTE]:")]
# r16: textele controalelor si TEXTE_CUNOSCUTE au acum O singura comparatie (LINIA_TEXTE) -> mutantul r14 "dupa _ascii" e unul singur
REGULI_R14_TEXT_INCHIS = [(LINIA_TEXTE, "    if (_loc_text(nod, ctrl, zona), a) in [(l, _ascii(t)) for l, t in TEXTE_CUNOSCUTE]:")]
REGULI_R14_ETICHETE = [("        if not any(forma.fullmatch(v) for forma in intrari):",
                        "        if not any(forma.fullmatch(v) or (k in ('aria-label', 'arialabel', 'gemtooltip', 'data-placeholder') and "
                        "any(_ascii(v) == _ascii(p) for p in ETICHETE_BUTOANE + ('Ecran complet', 'Introdu o solicitare pentru Gemini', "
                        "'\\u00centreab\\u0103 Gemini'))) for forma in intrari):")]
REGULI_R14_TEXTE = REGULI_R14_TEXT_INCHIS
# r16: textul linkului de confidentialitate pus IN link (locul lui), pentru scenarii cu textul linkului
def link_cu_text(t):
    return '<a data-test-id="footer-privacy-notice-link" href="%s"><span data-test-id="content">%s</span></a>' % (HREF_REAL, t)


def cheie_meta(text_json):
    # base64 canonic al unui text JSON (cheia BardVeMetadataKey)
    return base64.b64encode(text_json.encode("ascii")).decode("ascii")


def jslog_cu_cheie(text_json, mutable=False, numar="173899"):
    return numar + ";track:generic_click,impression;BardVeMetadataKey:" + cheie_meta(text_json) + (";mutable:true" if mutable else "")


def lista_meta(n, **poz):
    # lista JSON canonica de n elemente null, cu elementele date pe pozitii (poz: p<i>=text JSON)
    el = ["null"] * n
    for k, v in poz.items():
        el[int(k[1:])] = v
    return "[" + ",".join(el) + "]"


def cu_valoare(stare, tag, k, v, **atr):
    # (index, atributele elementului real cu k inlocuit / adaugat = v) pentru html_captura(inlocuiri=...)
    i = index_captura(stare, tag, **atr)
    a = CAPTURA_2311[stare][i][2]
    if k in dict(a):
        return (i, tuple((x, v if x == k else y) for x, y in a))
    return (i, tuple(a) + ((k, v),))


def clase_reale():
    # token-urile de clasa REALE pe tag, din tripletele reale (captura 23.11 + zona t23), fara generatele Angular - sursa independenta
    out = {}
    for t, k, v in REALE:
        if k == "class":
            for c in v.split():
                out.setdefault(t, set()).add(c)
    return out


class TestR15ClaseJslogUnicode(unittest.TestCase):
    """r15: clasele = token-uri EXACTE pe tag (+ generatele Angular vazute), jslog = valorile vazute cu doar numerele variabile (cheia
    BardVeMetadataKey decodata, structura vazuta), textele comparate pe Unicode EXACT. Asteptarile sunt scrise de mana."""

    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def nod(self, html):
        a = gp._Arbore()
        a.feed(html)
        return a.radacina.copii[0]

    def refuz(self, html_zona, m, s=None, mod=gp, ecran_html=None):
        # zona simpla: exact motivul m (si sursa s), refuz fara nicio actiune; cu ecran_html: si in starea reala 23.11, refuz inainte de Enter
        i = self.an(zona_cu(html_zona), mod)
        self.assertEqual(i["necunoscute_detalii"], [m], msg=html_zona)
        if s is not None:
            self.assertEqual(i["necunoscute_surse"], [s], msg=html_zona)
        self.assertEqual(ruleaza_trimite(mod, FakePg(zona_cu(html_zona))), ("ciorna_necunoscuta", []), msg=html_zona)
        if ecran_html is not None:
            cod, det, act = scenariu_brief_lung(mod, pagina_23_11(ecran_html=ecran_html))
            self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=ecran_html)
            self.assertTrue(det.startswith("inainte_de_enter: 1 element(e) nerecunoscute"), det)

    def pleaca(self, mod, html_dupa_scriere):
        # pe mutant: chat nou gol -> scriere -> Enter
        self.assertEqual(scenariu_brief_lung(mod, html_dupa_scriere), (None, "", ACTIUNI_TRIMITERE))

    # ---------- (1) clasele ----------

    def test_reproducerea_clasa_din_verdict(self):
        html = ecran(inauntru=REPRO_R4_CLASA)
        self.refuz(html, "atribut_valoare:span{class}", "atribut_valoare:class=continut-strain-arbitrar", ecran_html=html)
        for stare in ("mediu", "lung"):                                   # copil in plus in butonul "Ecran complet" din captura reala
            cap = html_captura(stare, interior=((index_captura(stare, "button", gemtooltip="Ecran complet"), REPRO_R4_CLASA),))
            self.assertEqual(self.an(cap)["necunoscute_detalii"], ["atribut_valoare:span{class}"], msg=stare)
            self.assertEqual(scenariu_brief_lung(gp, cap)[0::2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
        r14 = mutant(REGULI_R14_CLASE_JSLOG)                              # = r14: zero necunoscute si Enter (ce a gasit Jakarinos)
        self.assertEqual(self.an(zona_cu(html), r14)["necunoscute"], 0)
        self.pleaca(r14, pagina_23_11(ecran_html=html))

    def test_clasa_straina_pe_fiecare_loc(self):
        # scris de mana: acelasi token strain pe control, structura, zona, rich-textarea, editor, paragraful din editor, descendenti
        t = "continut-strain-arbitrar"
        sem_rt = "rich-textarea"
        locuri = (
            (ecran(ECRAN_ATR.replace(CLASE_ECRAN, CLASE_ECRAN + " " + t)), "atribut_valoare:%s{class}" % SEM_ECRAN),       # controlul
            (ecran(inauntru='<div><span><span class="%s"></span></span></div>' % t), "atribut_valoare:span{class}"),     # descendent adanc
            (ecran(inauntru='<mat-icon role="img" class="mat-icon %s"></mat-icon>' % t), "atribut_valoare:mat-icon[role=img]{class}"),
            (ecran(inauntru='<gem-icon class="%s"></gem-icon>' % t), "atribut_valoare:gem-icon{class}"),                 # structura in control
            ('<toolbox-drawer class="ng-star-inserted %s"></toolbox-drawer>' % t, "atribut_valoare:toolbox-drawer{class}"),   # structura
            ('<div data-test-id="textarea-wrapper" class="textarea-wrapper %s"></div>' % t, "atribut_valoare:div[data-test-id=textarea-wrapper]{class}"),
            ('<div class="%s"></div>' % t, "atribut_valoare:div{class}"),                                                # div neutru
            ('<button data-test-id="bard-mode-menu-button" aria-label="Deschide selectorul de moduri, momentan Carbon" class="%s"></button>' % t,
             "atribut_valoare:button[aria-label=deschide selectorul de moduri, momentan carbon][data-test-id=bard-mode-menu-button]{class}"),
        )
        for html, m in locuri:
            self.refuz(html, m, "atribut_valoare:class=" + gp._ascii(re.search(r'class="([^"]*%s[^"]*)"' % t, html).group(1)))
        for html, m in ((pagina(zona_atr=' class="%s"' % t), "atribut_valoare:input-area-v2{class}"),
                        (pagina(editor=EDITOR_HTML.replace('<rich-textarea class="text-input-field_textarea"',
                                                           '<rich-textarea class="text-input-field_textarea %s"' % t)), "atribut_valoare:%s{class}" % sem_rt),
                        (pagina(editor=EDITOR_HTML.replace('class="ql-editor textarea"', 'class="ql-editor textarea %s"' % t)),
                         "semnal_in_editor:atribut_valoare:div[role=textbox][contenteditable]{class}"),
                        (pagina(editor=EDITOR_HTML.replace("<p>ciorna</p>", '<p class="%s">ciorna</p>' % t)), "semnal_in_editor:atribut_valoare:p{class}"),
                        (pagina(editor=EDITOR_HTML.replace("<p>ciorna</p>", '<p class="ql-align-center">ciorna</p>')),
                         "semnal_in_editor:atribut_valoare:p{class}")):          # o clasa Quill reala, dar nevazuta in capturi = refuz (fals, sigur)
            self.assertEqual(self.an(html)["necunoscute_detalii"], [m], msg=html[-200:])
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []))
        # in starile REALE din captura: token strain pe control, structura, editor, div neutru, butonul modelului -> refuz
        for stare in ("gol", "mediu", "lung"):
            for loc in (cu_valoare(stare, "button", "class", dict(CAPTURA_2311[stare][index_captura(stare, "button", **{"data-test-id": "bard-mode-menu-button"})][2])["class"] + " " + t,
                                   **{"data-test-id": "bard-mode-menu-button"}),
                        cu_valoare(stare, "toolbox-drawer", "class", "ng-star-inserted " + t),
                        cu_valoare(stare, "div", "class", "textarea-wrapper " + t, **{"data-test-id": "textarea-wrapper"}),
                        cu_valoare(stare, "div", "class", "ql-editor " + t, role="textbox")):
                cap = html_captura(stare, inlocuiri=(loc,))
                d = self.an(cap)["necunoscute_detalii"]
                self.assertEqual(len(d), 1, msg=(stare, d))
                self.assertTrue(d[0].endswith("{class}") and "atribut_valoare:" in d[0], msg=d)
                if stare != "gol":
                    self.assertEqual(scenariu_brief_lung(gp, cap)[0::2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))

    def test_tiparele_generate(self):
        # fiecare tipar generat Angular, pozitiv si negativ (pe un span neutru, intr-un control si pe zona)
        ok = ("ng-tns-c1-0", "ng-tns-c282099457-4", "ng-tns-c123456789012-1234", "ng-star-inserted", "ng-animating",
              "mat-focus-indicator ng-star-inserted", "ng-tns-c1542544127-8 ng-animating ng-star-inserted")
        nu = ("ng-tns-c-4", "ng-tns-c1-", "ng-tns-cx-1", "ng-tns-c1-2-3", "ng-tns-c1234567890123-1", "ng-tns-c1-12345", "NG-TNS-C1-2",
              "ng-tns-c\u0661-2", "ng-tns-C1-2", "ng-star-inserted2", "ng-star", "Ng-star-inserted", "ng-animatingx", "ng-animated",
              "ng-pristine", "ng-touched", "ng-invalid", "ng-strain", "ng-", "ng-trigger", "ng-dirty", "ng-tns", "_ng-star-inserted")
        for c in ok:
            self.assertEqual(self.an(zona_cu('<span class="%s"></span>' % c))["necunoscute"], 0, msg=c)
            self.assertEqual(self.an(zona_cu(ecran(inauntru='<span class="%s"></span>' % c)))["necunoscute"], 0, msg=c)
        for c in nu:
            self.refuz('<span class="%s"></span>' % c, "atribut_valoare:span{class}", "atribut_valoare:class=" + gp._ascii(c))
            self.refuz(ecran(inauntru='<span class="%s"></span>' % c), "atribut_valoare:span{class}")
            self.assertEqual(self.an(pagina(zona_atr=' class="%s"' % c))["necunoscute_detalii"], ["atribut_valoare:input-area-v2{class}"], msg=c)
        # forma: exact cele trei alternative (scrise de mana), toate vazute in capturi (ng-animating: c23 lung, o data)
        self.assertEqual(gp.CLASE_GENERATE.pattern, r"ng-tns-c[0-9]{1,12}-[0-9]{1,4}|ng-star-inserted|ng-animating")
        vazute = set(c for t, k, v in REALE if k == "class" for c in v.split() if c.startswith("ng-"))
        self.assertIn("ng-animating", vazute)
        self.assertIn("ng-star-inserted", vazute)
        self.assertTrue(any(re.fullmatch(r"ng-tns-c[0-9]+-[0-9]+", c) for c in vazute))
        # restul token-urilor ng-* vazute sunt EXACTE pe tagul lor (nu tipare)
        for c in vazute:
            if not gp.CLASE_GENERATE.fullmatch(c):
                self.assertTrue(any(c in v for v in gp.CLASE_PERMISE.values()), c)
        self.assertEqual(set(c for v in gp.CLASE_PERMISE.values() for c in v if c.startswith("ng-")),
                         {"ng-trigger", "ng-trigger-sendButtonVisibility", "ng-trigger-slide", "ng-trigger-toolboxDrawerEnter",
                          "ng-dirty", "ng-untouched", "ng-valid"})

    def test_clasele_pe_tag_sunt_exact_cele_vazute(self):
        # lista din cod = EXACT token-urile reale pe tag (sursa independenta: tripletele REALE), fara generate; nimic inventat, nimic lipsa
        reale = {t: set(c for c in v if not gp.CLASE_GENERATE.fullmatch(c)) for t, v in clase_reale().items()}
        reale = {t: v for t, v in reale.items() if v}
        self.assertEqual({t: set(v) for t, v in gp.CLASE_PERMISE.items()}, reale)
        for t, v in gp.CLASE_PERMISE.items():
            self.assertEqual(len(v), len(set(v)), t)                      # fara dubluri
        # un token real al ALTUI tag (nevazut pe acesta) = refuz pe acesta (proprietate pe toate perechile)
        toate = set(c for v in gp.CLASE_PERMISE.values() for c in v)
        for t in sorted(gp.CLASE_PERMISE) + ["a", "p", "svg", "gem-popover", "toolbox-drawer", "back-to-bottom-fab"]:
            for c in sorted(toate - set(gp.CLASE_PERMISE.get(t, ()))):
                self.assertEqual(gp._atribut_strain(gp._Nod(t, {"class": c}, None)), ("atribut_valoare", "class", gp._ascii(c)), msg=(t, c))
            for c in gp.CLASE_PERMISE.get(t, ()):
                self.assertIsNone(gp._atribut_strain(gp._Nod(t, {"class": c}, None)), msg=(t, c))
        # exemple scrise de mana: send-button (doar pe gem-icon-button), mat-icon-no-color (doar pe mat-icon), ql-editor (doar pe div)
        for t, c in (("button", "send-button"), ("gem-icon", "mat-icon-no-color"), ("span", "ql-editor"), ("span", "ng-trigger"),
                     ("div", "ng-dirty"), ("input-area-v2", "input-area")):
            self.assertEqual(gp._atribut_strain(gp._Nod(t, {"class": c}, None))[0], "atribut_valoare", msg=(t, c))

    def test_separatorii_claselor(self):
        # impartire DOAR pe spatiile albe HTML; NBSP / latime zero / alt spatiu Unicode = parte din token (token necunoscut)
        for v in ("", " ", "\t\n", "mat-focus-indicator", " mat-focus-indicator\tmdc-button__label\n", "mat-focus-indicator\r\f ng-star-inserted"):
            self.assertIsNone(gp._atribut_strain(gp._Nod("span", {"class": v}, None)), msg=repr(v))
        for v in ("mat-focus-indicator\u00a0mdc-button__label", "mat-focus-indicator\u200b", "\u3000mat-focus-indicator",
                  "mat-focus-indicator\u2028mdc-button__label", "mat-focus-indicator\u000bmdc-button__label", "mat-focus-indicator,mdc-button__label",
                  "MAT-FOCUS-INDICATOR", "mat-focus-indicator2"):
            self.assertEqual(gp._atribut_strain(gp._Nod("span", {"class": v}, None))[0:2], ("atribut_valoare", "class"), msg=repr(v))

    # ---------- (1) jslog ----------

    def test_reproducerea_jslog_din_verdict(self):
        html = ecran(ECRAN_ATR + ' jslog="%s"' % REPRO_R4_JSLOG)
        self.refuz(html, "atribut_valoare:%s{jslog}" % SEM_ECRAN, "atribut_valoare:jslog=" + REPRO_R4_JSLOG, ecran_html=html)
        r14 = mutant(REGULI_R14_CLASE_JSLOG)
        self.assertEqual(self.an(zona_cu(html), r14)["necunoscute"], 0)
        self.pleaca(r14, pagina_23_11(ecran_html=html))
        # acelasi jslog pe butonul de trimitere din captura reala (lung) -> refuz inainte de Enter
        cap = html_captura("lung", inlocuiri=(cu_valoare("lung", "button", "jslog", REPRO_R4_JSLOG, **{"aria-label": "Trimite mesajul"}),))
        self.assertEqual(self.an(cap)["necunoscute_detalii"], ["atribut_valoare:button[aria-label=trimite mesajul]{jslog}"])
        self.assertEqual(scenariu_brief_lung(gp, cap)[0::2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
        self.pleaca(r14, cap)

    def test_jslog_doar_numarul_variaza(self):
        # pozitive: valorile vazute cu alt numar (doar cifre ASCII, 1-9)
        for tag, v in (("div", "1;track:impression"), ("div", "999999999;track:impression"), ("button", "7;track:generic_click,impression"),
                       ("rich-textarea", "42;track:generic_click,impression"), ("button", jslog_cu_cheie(lista_meta(3), numar="5")),
                       ("button", jslog_cu_cheie(lista_meta(23, p22='["95a4c0abcba24364"]'), mutable=True))):
            self.assertIsNone(gp._atribut_strain(gp._Nod(tag, {"jslog": v}, None)), msg=(tag, v))
        # negative (scrise de mana): componenta textuala noua / schimbata, alta ordine, litere mari, separatori, cifre non-ASCII, combinatii
        # nevazute pe acel tag
        nu = {
            "button": ("123;track:continut_strain_arbitrar", "175863;track:generic_click", "175863;track:impression,generic_click",
                       "175863;track:generic_click,impression,x", "175863;track:Generic_click,impression", "175863;track:generic_click,impression;mutable:true",
                       "175863;track:generic_click,impression;x", "175863 ;track:generic_click,impression", "175863;track: generic_click,impression",
                       "1758630000;track:generic_click,impression", ";track:generic_click,impression", "x175863;track:generic_click,impression",
                       "\u0661\u0662;track:generic_click,impression", "175863;track:generic_click,impression\n", "175863;track:generic_click,impression;",
                       "175863;Track:generic_click,impression", "175863;track:generic_click;impression",
                       "175863;track:generic_click,impression;BardVeMetadataKey:",
                       jslog_cu_cheie(lista_meta(3)) + ";mutable:false", jslog_cu_cheie(lista_meta(3)) + ";mutable:true;x",
                       "175863;track:generic_click,impression;mutable:true;BardVeMetadataKey:" + cheie_meta(lista_meta(3)),
                       "175863;track:generic_click,impression;bardvemetadatakey:" + cheie_meta(lista_meta(3)),
                       "175863;track:generic_click,impression;BardVeMetadataKey:" + cheie_meta(lista_meta(3)) + ";BardVeMetadataKey:" + cheie_meta(lista_meta(3))),
            "div": ("303810;track:generic_click,impression", "303810;track:impression;mutable:true", "303810;track:impression,impression",
                    "303810;track:impression;BardVeMetadataKey:" + cheie_meta(lista_meta(3)), "303810;track:impressions", ""),
            "rich-textarea": ("356556;track:impression", jslog_cu_cheie(lista_meta(3), numar="356556")),
        }
        for tag, valori in nu.items():
            for v in valori:
                self.assertEqual(gp._atribut_strain(gp._Nod(tag, {"jslog": v}, None)), ("atribut_valoare", "jslog", gp._ascii(v)), msg=(tag, v))
        # jslog pe un tag pe care nu a fost vazut = nume necunoscut
        for tag in ("span", "gem-icon-button", "a", "input-area-v2"):
            self.assertEqual(gp._atribut_strain(gp._Nod(tag, {"jslog": "1;track:impression"}, None))[0], "atribut_necunoscut", msg=tag)
        # sabloanele din cod = exact cele scrise de mana (valorile vazute cu {N} / {B})
        self.assertEqual(gp.JSLOG_VAZUTE, (
            (("div",), "{N};track:impression"),
            (("button", "rich-textarea"), "{N};track:generic_click,impression"),
            (("button",), "{N};track:generic_click,impression;BardVeMetadataKey:{B}"),
            (("button",), "{N};track:generic_click,impression;BardVeMetadataKey:{B};mutable:true")))

    def test_cheia_meta_structura_vazuta(self):
        m = gp._meta_permisa
        # pozitive: cele reale (D intreaga; A / B / C completate) si structura vazuta
        d = JSLOG_MODEL.split("BardVeMetadataKey:")[1].split(";")[0]
        self.assertEqual(base64.b64decode(d).decode("ascii"), lista_meta(23, p22='["95a4c0abcba24364"]'))   # 206752 t23, intreaga
        for t in (lista_meta(0), lista_meta(1), lista_meta(35), lista_meta(9, p8='[0,"ro",0,""]'), lista_meta(23, p8='[0,"ro",0,""]', p22='["95a4c0abcba24364"]'),
                  lista_meta(30, p8='[123456789,"ro",7,""]'), lista_meta(23, p22='["0123456789abcdef"]'),
                  # r16: cheia INTREAGA a butonului de trimitere (c23n): 35 de elemente, [34] = [0]; variantele [34] = [<cifre>]
                  lista_meta(35, p8='[0,"ro",0,""]', p22='["95a4c0abcba24364"]', p34="[0]"), lista_meta(35, p34="[7]"),
                  lista_meta(35, p34="[999999999]")):
            self.assertTrue(m(cheie_meta(t)), t)
        for v in set(dict(a).get("jslog", "") for st in CAPTURA_2311.values() for _, _, a, _ in st) | {JSLOG_MODEL, JSLOG_TRIMITE}:
            if "BardVeMetadataKey:" in v:
                self.assertTrue(m(v.split("BardVeMetadataKey:")[1].split(";")[0]), v)
        # negative scrise de mana: text, cheie, numar / bool / zecimal, alta pozitie, alta limba, hex gresit, JSON necanonic, prea lung
        nu = (lista_meta(36), lista_meta(64), lista_meta(65),           # r16: plafonul = cea mai lunga lista vazuta (35)
              lista_meta(35, p34='["0"]'), lista_meta(35, p34="[0,0]"), lista_meta(35, p34="[]"), lista_meta(35, p34="0"),
              lista_meta(35, p34="[-1]"), lista_meta(35, p34="[1000000000]"), lista_meta(35, p34="[0.0]"), lista_meta(35, p34="[true]"),
              lista_meta(35, p34='["continut strain arbitrar"]'), lista_meta(35, p33="[0]"), lista_meta(36, p35="[0]"),
              '[null,"x"]', "[1]", "[true]", "[0.0]", '{"a":1}', '"x"', "null", "[null, null]", "[ null]", "[null,null]\n",
              lista_meta(9, p8='[0,"en",0,""]'), lista_meta(9, p8='[0,"ro",0,"x"]'), lista_meta(9, p8='[0,"ro",0]'), lista_meta(9, p8='[0.0,"ro",0,""]'),
              lista_meta(9, p8='[-1,"ro",0,""]'), lista_meta(9, p8='[true,"ro",0,""]'), lista_meta(9, p8='["0","ro",0,""]'),
              lista_meta(9, p8='[1000000000,"ro",0,""]'), lista_meta(9, p8='[0,"ro",0,"",0]'), lista_meta(8, p7='[0,"ro",0,""]'),
              lista_meta(9, p8='["95a4c0abcba24364"]'), lista_meta(23, p22='["95A4C0ABCBA24364"]'), lista_meta(23, p22='["95a4c0abcba2436"]'),
              lista_meta(23, p22='["95a4c0abcba243640"]'), lista_meta(23, p22='["95a4c0abcba2436g"]'), lista_meta(23, p22='["95a4c0abcba24364","x"]'),
              lista_meta(23, p22='[]'), lista_meta(23, p22='"95a4c0abcba24364"'), lista_meta(22, p21='["95a4c0abcba24364"]'),
              lista_meta(23, p22='["continut strain arbitrar"]'), lista_meta(23, p0='["95a4c0abcba24364"]'),
              '[null,"\\u0072o"]', lista_meta(9, p8='[0,"\\u0072o",0,""]'), "[NaN]", "[null,]", "[null")
        for t in nu:
            self.assertFalse(m(cheie_meta(t)), t)
        # base64: forma canonica (umplutura "=" lipsa sau exacta), doar alfabetul standard
        b = cheie_meta("[null,null]")
        self.assertEqual(b, "W251bGwsbnVsbF0=")
        self.assertTrue(m(b))
        self.assertTrue(m(b.rstrip("=")))
        for x in ("W251bGwsbnVsbF1=", "W251bGwsbnVsbF0==", "W251bGwsbnVsbF0=x", "W251bGwsbn-sbF0=", "W251bGwsbn_sbF0=", "W251 bGwsbnVsbF0=",
                  "W251bGwsbnVsbF", "", "====", base64.b64encode("[null,\"\u0103\"]".encode("utf-8")).decode("ascii")):
            self.assertFalse(m(x), x)

    def test_jslog_taiat_refuzat_cel_intreg_trece(self):
        # r16: valorile EXACT cum au fost citite in capturile taiate (c23: 200, t23: 300 de caractere) sunt refuzate (JSON neterminat); valorile
        # INTREGI din captura netaiata (c23n) trec, iar fiecare valoare taiata e prefixul celei intregi (aceeasi citire, nimic completat)
        intregi = sorted(set((t, dict(a)["jslog"]) for st in CAPTURA_2311.values() for _, t, a, _ in st
                             if "BardVeMetadataKey:" in dict(a).get("jslog", "")))
        self.assertEqual(intregi, sorted({("button", JSLOG_MODEL), ("button", JSLOG_TRIMITE)}))     # 206752 (modelul) + 173899 (trimite)
        self.assertEqual([len(v) for _, v in sorted(intregi, key=lambda x: x[1])], [337, 245])
        taiate = tuple(JSLOG_TAIATE_C23) + (("button", JSLOG_TRIMITE_TAIAT),)
        self.assertEqual(len(taiate), 3)                                  # 206752 / 173899 (c23) + 173899 (t23)
        for tag, v in taiate:
            self.assertEqual(len(v), 200 if v != JSLOG_TRIMITE_TAIAT else 300, v)
            self.assertEqual(gp._atribut_strain(gp._Nod(tag, {"jslog": v}, None))[0:2], ("atribut_valoare", "jslog"), msg=v)
            self.assertEqual(sum(1 for t, w in intregi if t == tag and w.startswith(v) and w != v), 1, msg=v)
        for tag, v in intregi:
            self.assertIsNone(gp._atribut_strain(gp._Nod(tag, {"jslog": v}, None)), msg=v)
        # cheile decodate, scrise de mana (structura vazuta intreaga)
        d = lambda v: base64.b64decode(v.split("BardVeMetadataKey:")[1].split(";")[0]).decode("ascii")
        self.assertEqual(d(JSLOG_MODEL), lista_meta(23, p22='["95a4c0abcba24364"]'))
        self.assertEqual(d(JSLOG_TRIMITE), lista_meta(35, p8='[0,"ro",0,""]', p22='["95a4c0abcba24364"]', p34="[0]"))
        # pe regulile r15 (plafon 64, fara pozitia 34) cheia intreaga a butonului de trimitere era refuzata: refuz fals pe pagina reala
        r15 = mutant([("        if i == META_NUMAR and", "        if False and")])
        self.assertEqual(r15._atribut_strain(r15._Nod("button", {"jslog": JSLOG_TRIMITE}, None))[0:2], ("atribut_valoare", "jslog"))
        for s in ("mediu", "lung"):
            self.assertEqual(self.an(html_captura(s), r15)["necunoscute"], 1, msg=s)

    # ---------- (2) Unicode exact ----------

    def test_descrierile_unicode_exact(self):
        # cele 2 reproduceri din verdict (referinta reala ng-1-16) + spatii in plus / minus + alte normalizari pe care _ascii le stergea
        self.assertEqual(gp._ascii(REPRO_R4_DESCRIERI[1]), gp._ascii(ETICHETA_MIC))       # r14: acelasi "?" pentru U+732B si U+21E7
        self.assertEqual(gp._ascii(REPRO_R4_DESCRIERI[0]), "ecran complet")
        variante = REPRO_R4_DESCRIERI + ("Ecran  complet", " Ecran complet", "Ecran complet ", "Ecrancomplet", "ecran complet", "ECRAN COMPLET",
                                         "Ecran\u00a0complet", "Ecran complet\u200b", "Trimite\u00a0", "\tTrimite", "Trimite\n",
                                         "Dicteaz\u0103(^\u21e7D)", "Dicteaz\u0103  (^\u21e7D)", "Dicteaza (^\u21e7D)", "Dicteaz\u0103 (^\u21e7d)",
                                         "Dicteaz\u0103 (^?D)", "Dicteaz\u0103 (^\u21e7D) ", "Schimb\u0103 modelul (^\u21e7 M)",
                                         "Schimba\u0306 modelul (^\u21e7M)")       # a + breve combinat (NFD): alt sir, refuz (fals, sigur)
        r14 = mutant(REGULI_R14_DESCRIERE)
        for t in variante:
            html = cu_tinta(pagina_23_11(), '<div id="%s">%s</div>' % (REF_REALA, t))
            i = self.an(html)
            self.assertEqual(i["necunoscute_detalii"], ["descriere_text:%s{%s}" % (SEM_ECRAN, gp._ascii(t))], msg=repr(t))
            self.assertEqual(scenariu_brief_lung(gp, html)[0::2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=repr(t))
        for t in REPRO_R4_DESCRIERI + ("Ecran  complet", " Ecran complet", "ECRAN COMPLET", "Trimite\u00a0"):
            html = cu_tinta(pagina_23_11(), '<div id="%s">%s</div>' % (REF_REALA, t))
            self.assertEqual(self.an(html, r14)["necunoscute"], 0, msg=repr(t))       # = r14: zero necunoscute si Enter
            self.pleaca(r14, html)
        # in captura reala: fiecare descriere inlocuita cu o varianta = refuz
        for stare in ("gol", "mediu", "lung"):
            for k, v in DESCRIERI[stare].items():
                for alt in (v + " ", v.replace(" ", "  ", 1) if " " in v else " " + v, gp._ascii(v), v.upper()):
                    d = self.an(html_captura(stare, descrieri=dict(DESCRIERI[stare], **{k: alt})))["necunoscute_detalii"]
                    self.assertEqual(len(d), 1, msg=(stare, k, alt, d))
                    self.assertTrue(d[0].startswith("descriere_text:"), msg=d)
        # pozitive: textele exacte (si gol), cu / fara role=tooltip
        for t in gp.DESCRIERI_CUNOSCUTE + ("",):
            for f in ('<div id="%s">%s</div>', '<div id="%s" role="tooltip">%s</div>'):
                self.assertEqual(self.an(cu_tinta(pagina_23_11(), f % (REF_REALA, t)))["necunoscute"], 0, msg=t)

    def test_atributele_unicode_exact(self):
        # valorile cu text din lista alba, Unicode exact: aceeasi forma ASCII nu mai ajunge (r14 compara dupa _ascii)
        r14 = mutant(REGULI_R14_ETICHETE)
        cazuri = (
            ("lung", "button", "aria-label", "Dicteaz\u0103 (^\u732bD)", {"aria-label": ETICHETA_MIC}),
            ("lung", "button", "aria-label", "Dicteaza (^\u21e7D)", {"aria-label": ETICHETA_MIC}),
            ("lung", "button", "aria-label", "Trimite  mesajul", {"aria-label": "Trimite mesajul"}),
            ("lung", "button", "aria-label", "trimite mesajul", {"aria-label": "Trimite mesajul"}),
            ("lung", "button", "aria-label", " Extinde intrarea la ecran complet", {"aria-label": "Extinde intrarea la ecran complet"}),
            ("lung", "button", "gemtooltip", "Ecr\u00e2n complet", {"gemtooltip": "Ecran complet"}),
            ("lung", "button", "gemtooltip", "Ecran complet ", {"gemtooltip": "Ecran complet"}),
            ("lung", "button", "aria-label", "Deschide selectorul de moduri, momentan carbon", {"data-test-id": "bard-mode-menu-button"}),
            ("lung", "div", "data-placeholder", "Intreab\u0103 Gemini", {"role": "textbox"}),
            ("lung", "div", "data-placeholder", "\u00centreab\u0103\u00a0Gemini", {"role": "textbox"}),
            ("lung", "div", "aria-label", "Introdu o solicitare pentru gemini", {"role": "textbox"}),
        )
        for stare, tag, k, v, atr in cazuri:
            cap = html_captura(stare, inlocuiri=(cu_valoare(stare, tag, k, v, **atr),))
            d = self.an(cap)["necunoscute_detalii"]
            self.assertEqual(len(d), 1, msg=(k, v, d))
            self.assertTrue(re.fullmatch(r"(semnal_in_editor:)?atribut_valoare:.*\{%s\}" % re.escape(k), d[0]), msg=d)
            self.assertEqual(scenariu_brief_lung(gp, cap)[0::2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=(k, v))
            self.assertEqual(self.an(cap, r14)["necunoscute"], 0, msg=(k, v))         # = r14 (dupa _ascii): trecea
            self.pleaca(r14, cap)
        # arialabel pe gem-icon-button: forma ASCII nu mai e exceptata (VALORI_PERMISE exact) -> semnal (cuvantul "incarca"), refuz
        cap = html_captura("lung", inlocuiri=(cu_valoare("lung", "gem-icon-button", "arialabel", "Incarcare si instrumente", ariahaspopup="menu"),))
        self.assertTrue(self.an(cap)["necunoscute_detalii"][0].startswith("token_incarca:gem-icon-button"), self.an(cap)["necunoscute_detalii"])
        # listele din cod = sirurile reale (din tripletele capturilor), nu forma ASCII
        for v in gp.ETICHETE_BUTOANE:
            self.assertTrue(("button", "aria-label", v) in REALE, v)
        self.assertIn(("div", "data-placeholder", "\u00centreab\u0103 Gemini"), REALE)
        self.assertIn(("gem-icon-button", "arialabel", gp.ETICHETA_INCARCARE), REALE)
        self.assertEqual(gp.DEDUS_DERULEAZA, "Deruleaz\u0103 \u00een jos")      # singura eticheta dedusa (s21: doar semnatura ASCII)

    def test_textele_din_zona_unicode_exact(self):
        # r15: TEXTE_CUNOSCUTE si textul controlului inchis: Unicode exact (spatiile albe HTML de la capetele nodului scoase)
        # r16: textele linkului doar IN link (locul lor); in zona, direct = text necunoscut
        for t in (TEXT_LINK_REAL, TEXT_ASCUNS_REAL):
            self.assertEqual(self.an(zona_cu(link_cu_text(t)))["necunoscute"], 0, msg=t)
            self.assertEqual(self.an(zona_cu(link_cu_text("\n   %s  " % t)))["necunoscute"], 0, msg=t)
            self.assertEqual(self.an(zona_cu("<div>%s</div>" % t))["necunoscute_detalii"], ["text:" + gp._ascii(t)], msg=t)
            for alt in (gp._ascii(t), t.replace(" ", "  ", 1), t.replace(" ", "\u00a0", 1), t + "\u00a0", t.upper()):
                self.assertEqual(self.an(zona_cu(link_cu_text(alt)))["necunoscute_detalii"], ["text_in_control:" + gp._ascii(alt)], msg=repr(alt))
        r14 = mutant(REGULI_R14_TEXTE)
        self.assertEqual(self.an(zona_cu(link_cu_text(gp._ascii(TEXT_LINK_REAL))), r14)["necunoscute"], 0)

    # ---------- mutantii r15 ----------

    def test_mutanti_r15_lasa_brief_ul_sa_plece(self):
        # fiecare mutant slabeste o regula r15; scenariul lui (brief lung, starea reala 23.11 cu elementul strain) pleaca la Enter pe mutant,
        # refuz inainte de Enter pe cod; toti lasa starile reale sa treaca
        ecr = lambda inauntru="", atr=ECRAN_ATR: pagina_23_11(ecran_html=ecran(atr, inauntru or GI))
        btn_meta = lambda t, mutable=False: ecr(atr=ECRAN_ATR + ' jslog="%s"' % jslog_cu_cheie(t, mutable))
        descr = lambda t: cu_tinta(pagina_23_11(), '<div id="%s">%s</div>' % (REF_REALA, t))
        cazuri = (
            # (M60) formele largi r14 pentru class / jslog: cele 2 reproduceri din verdict
            (REGULI_R14_CLASE_JSLOG, (ecr(REPRO_R4_CLASA), ecr(atr=ECRAN_ATR + ' jslog="%s"' % REPRO_R4_JSLOG))),
            # (M61) tiparul generat larg (orice ng-*)
            ([('CLASE_GENERATE = re.compile(r"ng-tns-c[0-9]{1,12}-[0-9]{1,4}|ng-star-inserted|ng-animating")', 'CLASE_GENERATE = re.compile(r"ng-[A-Za-z0-9-]+")')],
             (ecr('<span class="ng-continut-strain"></span>'),)),
            # (M62) tiparul generat ca prefix (match in loc de fullmatch)
            ([("t in self.exacte or CLASE_GENERATE.fullmatch(t)", "t in self.exacte or CLASE_GENERATE.match(t)")],
             (ecr('<span class="ng-star-inserted-continut-strain"></span>'),)),
            # (M63) tagul ignorat: reuniunea token-urilor pe orice tag
            ([('    out = [((tag,), "class", _FormaClase(t)) for tag, t in sorted(CLASE_PERMISE.items())]',
               '    out = [((tag,), "class", _FormaClase(sum(CLASE_PERMISE.values(), ()))) for tag in list(CLASE_PERMISE) + ["span", "gem-icon"]]')],
             (ecr('<span class="send-button"></span>'), ecr('<gem-icon class="mat-icon-no-color"></gem-icon>'))),
            # (M64) impartirea pe orice spatiu Unicode (str.split)
            ([("for t in SPATII_HTML.split(v) if t != \"\")", "for t in v.split())")],
             (ecr('<span class="mat-focus-indicator\u00a0mdc-button__label"></span>'),)),
            # (M65) numarul din jslog = orice text
            ([('"[0-9]{1,9}" if p == "{N}"', '"[^;]{1,60}" if p == "{N}"')], (ecr(atr=ECRAN_ATR + ' jslog="continut_strain;track:generic_click,impression"'),)),
            # (M66) cheia BardVeMetadataKey neverificata
            ([('    s = b.rstrip("=")', "    return True")], (btn_meta('[null,"continut strain arbitrar"]'),)),
            # (M67) JSON necanonic acceptat
            ([('json.dumps(o, separators=(",", ":")) != t', "False")], (btn_meta("[null, null]"),)),
            # (M68) pozitia limbii ignorata; (M69) identificatorul conversatiei = orice text
            ([("        if (i == META_LIMBA[0] and", "        if (True and")], (btn_meta('[[0,"ro",0,""]]'),)),
            ([('META_CONVERSATIE = (22, re.compile(r"[0-9a-f]{16}"))', 'META_CONVERSATIE = (22, re.compile(r".*"))')],
             (btn_meta(lista_meta(23, p22='["continut strain arbitrar"]')),)),
            # (M70) descrierile dupa _ascii (= r14): cele 2 reproduceri din verdict
            (REGULI_R14_DESCRIERE, tuple(descr(t) for t in REPRO_R4_DESCRIERI)),
            # (M71) etichetele din lista alba dupa _ascii (= r14)
            (REGULI_R14_ETICHETE, (ecr(atr=ECRAN_ATR.replace('gemtooltip="Ecran complet"', 'gemtooltip="Ecr\u00e2n complet"')),
                                   pagina_23_11().replace('aria-label="' + ETICHETA_MIC + '"', 'aria-label="Dicteaz\u0103 (^\u732bD)"'))),
            # (M72 + M73) textele dupa _ascii (= r14), r16: o singura comparatie - textul butonului modelului si al linkului, in forma ASCII
            (REGULI_R14_TEXTE, (pagina_23_11().replace(">Carbon</span>", ">  CARBON </span>"), pagina_23_11().replace(">Carbon</span>", ">C\u00e2rbon</span>"),
                                pagina_23_11(extra_zona=link_cu_text(gp._ascii(TEXT_LINK_REAL))))),
        )
        self.assertEqual(pagina_23_11().count('aria-label="' + ETICHETA_MIC + '"'), 1)
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                cod, det, act = scenariu_brief_lung(gp, html)
                self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=(inlocuiri[0][1][:80], det))
                self.assertEqual(scenariu_brief_lung(mut, html), (None, "", ACTIUNI_TRIMITERE), msg=(inlocuiri[0][1][:80], html[-300:]))
            # starile reale trec pe fiecare mutant (mutantul slabeste, nu strica)
            self.assertEqual(scenariu_brief_lung(mut, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE), msg=inlocuiri[0][1][:80])
            for s in ("gol", "mediu", "lung"):
                h = html_captura(s)
                self.assertEqual(ruleaza_trimite(mut, FakePg(h, dupa_goto=h)), (None, ACTIUNI_TRIMITERE), msg=(inlocuiri[0][1][:80], s))
            for s in ("i", "ii", "iii"):
                h = pagina_22_11_completa(s, fdi=FDI_5G)
                self.assertEqual(ruleaza_trimite(mut, FakePg(h, dupa_goto=h)), (None, ACTIUNI_TRIMITERE), msg=(inlocuiri[0][1][:80], s))

    def test_regulile_r15_stau_intr_un_singur_loc(self):
        # structural (L19): _ascii nu mai apare in nicio comparatie cu listele (doar la afisare / cautarea cuvintelor); clasele si jslog
        # au O singura definitie (CLASE_PERMISE / CLASE_GENERATE / JSLOG_VAZUTE), citite doar din formele lor
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        linii = [l.rstrip("\r") for l in src.split("\n")]
        cod = [l for l in linii if not l.lstrip().startswith("#")]
        numar = lambda nume: sum(len(re.findall(r"(?<![A-Za-z_])%s(?![A-Za-z_])" % nume, l)) for l in cod)
        self.assertEqual(numar("CLASE_PERMISE"), 2)              # definitia + _intrari_clase_jslog
        self.assertEqual(numar("CLASE_GENERATE"), 2)             # definitia + _FormaClase
        self.assertEqual(numar("JSLOG_VAZUTE"), 3)               # definitia + _intrari_clase_jslog (doua citiri)
        self.assertEqual(numar("_meta_permisa"), 2)              # definitia + _FormaJslog
        self.assertEqual(numar("_intrari_clase_jslog"), 2)       # definitia + ATRIBUTE_PERMISE
        self.assertEqual(numar("SPATII_HTML"), 2)
        self.assertEqual(numar("FORMA_CLASE"), 0)                # formele largi r14 scoase
        self.assertEqual(numar("FORMA_JSLOG"), 0)
        self.assertEqual(numar("_TXT"), 0)
        # comparatiile cu listele nu trec prin _ascii
        for l in cod:
            for lista in ("DESCRIERI_CUNOSCUTE", "TEXTE_CUNOSCUTE", "ETICHETE_BUTOANE", "permise", "valoare"):
                if re.search(r"\b(not )?in %s\b|!= %s\b|== %s\b" % (lista, lista, lista), l):
                    self.assertNotIn("_ascii(", l, l)
        self.assertIn("        if not any(forma.fullmatch(v) for forma in intrari):", linii)
        self.assertIn('            b = _text_brut(x)', linii)
        self.assertIn("    b = nod.date.strip(\" \\t\\n\\r\\f\")", linii)
        # fisierul ramane ASCII; caracterele reale stau in escape-uri
        self.assertTrue(all(ord(c) < 128 for c in src))
        self.assertIn("Dicteaz\\u0103 (^\\u21e7D)", src)


# --- r16 (v4.6.4d runda 6, 23.11.2026, Jakarinos NO-GO r5 pe 7b9aa4da, paw-data\out\jak_pr1173_r5_verdict.md): si NODURILE TEXT pe lista
# alba. Reproducerile din verdict, copiate exact: pe 7b9aa4da dau 0 necunoscute si `press Enter` (aici: mutantul REGULI_R15_TEXT; separat,
# testele noi rulate pe 7b9aa4da - raportul r16).
REPRO_R5_SPAN = "<span>continut strain arbitrar</span>"                       # (1) in "Incarcare si instrumente" / "Trimite mesajul"
REPRO_R5_LIGATURA = "<mat-icon>continut_strain_arbitrar</mat-icon>"           # (2) in zona capturii lungi
REPRO_R5_INVIZIBILE = ("<span>\u0301</span>", "<span>\u200b</span>")          # (3) golul decis dupa _ascii
# variante scrise de mana: (text, forma afisata in motiv) - caractere invizibile / combinate / spatii Unicode care NU sunt spatii albe HTML
INVIZIBILE = (("\u0301", "\\u0301"), ("\u200b", "\\u200b"), ("\u00a0", "\\xa0"), ("\u2060", "\\u2060"), ("\ufeff", "\\ufeff"),
              ("\u3000", "\\u3000"), ("\u2028", "?"), ("\x0b", "\\x0b"), ("\u200c\u200d", "\\u200c\\u200d"), (" \u200b\n", "\\u200b"),
              ("\t\u0301\r\n", "\\u0301"), ("&nbsp;", "\\xa0"), ("&#8203;", "\\u200b"), ("&#x301;", "\\u0301"))
SPATII_HTML = ("", " ", "\t", "\n", "\r\n", "\f", " \t\r\n\f ")              # gol pe textul brut (doar spatii albe HTML)
ICOANE_REALE = ("plus", "keyboard_arrow_down", "mic", "expand_content", "arrow_upward")   # c23n: numele din fonticon (text GOL in pagina)


class TestTexteListaAlbaR16(unittest.TestCase):
    """r16: orice nod text din zona, in afara editorului, = gol pe textul BRUT (spatii albe HTML) sau perechea (loc, text) EXACTA din
    TEXTE_CUNOSCUTE; ligaturile mat-icon = LIGATURI_VAZUTE (goala). Asteptarile sunt scrise de mana din verdict si din captura netaiata."""

    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def stare_linii(self, html, mod=gp):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            mod.stare(FakePg(html))
        return out.getvalue().splitlines()

    def scrie(self, mod, html_dupa_scriere):
        # chatul nou gol din captura netaiata (gol) -> scrierea brief-ului -> paza de inainte de Enter pe html_dupa_scriere
        g = html_captura("gol")
        return ruleaza_trimite(mod, FakePg(g, dupa_goto=g, dupa_scriere=html_dupa_scriere))

    def refuzat(self, html, m, mod=gp):
        # in starea reala dupa scriere: exact motivul m, refuz inainte de Enter (fara `press Enter`)
        self.assertEqual(self.an(html, mod)["necunoscute_detalii"], [m], msg=html[-400:])
        self.assertEqual(self.scrie(mod, html), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=m)

    def pleaca(self, mod, html):
        self.assertEqual(self.an(html, mod)["necunoscute"], 0, msg=self.an(html, mod)["necunoscute_detalii"])
        self.assertEqual(self.scrie(mod, html), (None, ACTIUNI_TRIMITERE))

    # ---------- (1) text arbitrar in controalele cunoscute ----------

    def test_reproducerea_1_span_in_incarcare_si_trimite(self):
        r15 = mutant(REGULI_R15_TEXT)
        m = "text_in_control:continut strain arbitrar"
        for stare in ("gol", "mediu", "lung"):
            butoane = [index_captura(stare, "button", **{"aria-label": ARIALABEL_REAL})]
            if stare != "gol":
                butoane.append(index_captura(stare, "button", **{"aria-label": "Trimite mesajul"}))
            for b in butoane:
                html = html_captura(stare, interior=((b, REPRO_R5_SPAN),))
                self.refuzat(html, m)
                self.pleaca(r15, html)                                       # = ce a gasit Jakarinos pe 7b9aa4da
        # zona simpla: refuz fara nicio actiune; `stare` arata linia
        for btn in ('<button aria-label="' + ARIALABEL_REAL + '">' + REPRO_R5_SPAN + "</button>",
                    '<button aria-label="Trimite mesajul">' + REPRO_R5_SPAN + "</button>"):
            self.assertEqual(self.an(zona_cu(btn))["necunoscute_detalii"], [m])
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(btn))), ("ciorna_necunoscuta", []))
            self.assertIn("  necunoscut " + m, self.stare_linii(zona_cu(btn)))
        # starea reala 23.11 cu brief lung (pagina_23_11): butonul "+" si butonul de trimitere
        for vechi in ('<button' + PLUS_2311_BTN + '>', '<button' + TRIMITE_2311_BTN + '>'):
            html = pagina_23_11()
            self.assertEqual(html.count(vechi), 1)
            html = html.replace(vechi, vechi + REPRO_R5_SPAN)
            self.assertEqual(scenariu_brief_lung(gp, html)[0::2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
            self.assertEqual(scenariu_brief_lung(r15, html), (None, "", ACTIUNI_TRIMITERE))

    def test_text_strain_in_fiecare_control_si_descendent(self):
        # variante scrise de mana, in captura reala lunga: fiecare control (+ butonul modelului), direct si adanc, text oarecare / text
        # cunoscut din ALT loc / eticheta controlului ca text / descrierea lui ca text -> refuz inainte de Enter
        locuri = (
            ("button", {"aria-label": ARIALABEL_REAL}),
            ("button", {"aria-label": "Trimite mesajul"}),
            ("button", {"aria-label": ETICHETA_MIC}),
            ("button", {"aria-label": "Extinde intrarea la ecran complet"}),
            ("button", {"data-test-id": "bard-mode-menu-button"}),
            ("span", {"class": "gds-body-m picker-primary-text ng-star-inserted"}),          # span-ul cu "Carbon" (in butonul modelului)
            ("mat-icon", {"fonticon": "arrow_upward"}),                                         # iconita butonului de trimitere
        )
        texte = ("x", "abc", "continut strain", "Trimite", "Trimite mesajul", ARIALABEL_REAL, "Ecran complet", ETICHETA_MIC,
                 "Confiden\u021bialitatea ta \u0219i Gemini", "Gemini", "Carbon Pro")
        for tag, atr in locuri:
            i = index_captura("lung", tag, **atr)
            propriu = CAPTURA_2311["lung"][i][3]                      # textul propriu real al elementului ("Carbon" pe span, altfel gol)
            for t in texte:
                for inauntru, vazut in (("<span>%s</span>" % t, t), ("<div><span><span>%s</span></span></div>" % t, t), (t, propriu + t)):
                    html = html_captura("lung", interior=((i, inauntru),))
                    # (text direct langa textul propriu = UN nod text lipit; "Incarcare si instrumente" contine cuvantul de incarcare ->
                    # semnal text_atasament, inaintea listei)
                    a = gp._ascii(vazut)
                    self.refuzat(html, ("text_atasament:" if gp._cuvant(a) else "text_in_control:") + a)
        # "Carbon" e permis DOAR in butonul modelului: in orice alt control / in zona = refuz
        for tag, atr in locuri[:4]:
            self.refuzat(html_captura("lung", interior=((index_captura("lung", tag, **atr), "<span>Carbon</span>"),)), "text_in_control:carbon")
        self.refuzat(html_captura("lung", extra_zona="<div>Carbon</div>"), "text:carbon")
        # in butonul modelului: "Carbon" in plus (alt span) trece; orice alta forma = refuz
        i = index_captura("lung", "button", **{"data-test-id": "bard-mode-menu-button"})
        self.assertEqual(self.an(html_captura("lung", interior=((i, "<span>Carbon</span>"),)))["necunoscute"], 0)
        for t in ("carbon", "CARBON", "Carbon ", "Carbon\u00a0", "\u200bCarbon", "Carbon\u0301", "C\u00e2rbon", "Carbon x", "4 Carbon", "Gemini Carbon"):
            html = html_captura("lung", interior=((i, "<span>%s</span>" % t),))
            if t == "Carbon ":
                self.assertEqual(self.an(html)["necunoscute"], 0)            # spatiu alb HTML la capat = acelasi text
                continue
            self.refuzat(html, "text_in_control:" + (gp._ascii(t) or gp._vizibil(t)))

    def test_textele_cunoscute_doar_pe_locul_lor(self):
        # avertismentul doar sub hallucination-disclaimer, textele linkului doar in link, "Carbon" doar in butonul modelului
        loc_link = "a[data-test-id=footer-privacy-notice-link][href]"
        self.assertEqual(gp.LOC_LINK, loc_link)
        cazuri = (
            ("<hallucination-disclaimer><div>%s</div></hallucination-disclaimer>" % AVERTISMENT_TEXT, None),
            ("<hallucination-disclaimer><p><span>%s</span></p></hallucination-disclaimer>" % AVERTISMENT_TEXT, None),
            ("<div>%s</div>" % AVERTISMENT_TEXT, "text:" + gp._ascii(AVERTISMENT_TEXT)),
            ("<toolbox-drawer>%s</toolbox-drawer>" % AVERTISMENT_TEXT, "text:" + gp._ascii(AVERTISMENT_TEXT)),
            (link_cu_text(AVERTISMENT_TEXT), "text_in_control:" + gp._ascii(AVERTISMENT_TEXT)),
            ('<button aria-label="Trimite mesajul">%s</button>' % TEXT_LINK_REAL, "text_in_control:" + gp._ascii(TEXT_LINK_REAL)),
            ("<hallucination-disclaimer>%s</hallucination-disclaimer>" % TEXT_LINK_REAL, "text:" + gp._ascii(TEXT_LINK_REAL)),
            ("<hallucination-disclaimer>%s</hallucination-disclaimer>" % link_cu_text(TEXT_ASCUNS_REAL), None),
            ("<hallucination-disclaimer>Carbon</hallucination-disclaimer>", "text:carbon"),
            (link_cu_text("Carbon"), "text_in_control:carbon"),
            # un invelis din STRUCTURA mai apropiat decat hallucination-disclaimer schimba locul
            ("<hallucination-disclaimer><toolbox-drawer>%s</toolbox-drawer></hallucination-disclaimer>" % AVERTISMENT_TEXT,
             "text:" + gp._ascii(AVERTISMENT_TEXT)),
        )
        for html, m in cazuri:
            i = self.an(zona_cu(html))
            self.assertEqual(i["necunoscute_detalii"], [m] if m else [], msg=html[:120])
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(html)))[0], "ciorna_necunoscuta" if m else None, msg=html[:120])
        # locul se cauta doar pana la zona: un hallucination-disclaimer IN AFARA zonei nu face textul din zona "avertisment"
        html = ("<html><body><hallucination-disclaimer><input-area-v2><div>%s</div>" % AVERTISMENT_TEXT
                + EDITOR_HTML + "</input-area-v2></hallucination-disclaimer></body></html>")
        self.assertEqual(self.an(html)["necunoscute_detalii"], ["text:" + gp._ascii(AVERTISMENT_TEXT)])
        # _loc_text, direct (scris de mana)
        a = gp._Arbore()
        a.feed('<input-area-v2><hallucination-disclaimer><p>t</p></hallucination-disclaimer><span>u</span>'
               '<button data-test-id="bard-mode-menu-button"><span>v</span></button>' + link_cu_text("w") + "</input-area-v2>")
        z = a.radacina.copii[0]
        txt = {d.date: d for d in gp._descendenti(z) if d.tag == "#text"}
        model = next(d for d in gp._descendenti(z) if d.attrs.get("data-test-id") == "bard-mode-menu-button")
        link = next(d for d in gp._descendenti(z) if d.tag == "a")
        self.assertEqual(gp._loc_text(txt["t"], None, z), "hallucination-disclaimer")
        self.assertEqual(gp._loc_text(txt["u"], None, z), "zona")
        self.assertEqual(gp._loc_text(txt["v"], model, z), "buton_model")
        self.assertEqual(gp._loc_text(txt["w"], link, z), loc_link)
        self.assertEqual(gp._loc_text(txt["u"], None, txt["u"].parinte), "zona")

    # ---------- (2) ligaturile mat-icon ----------

    def test_reproducerea_2_ligatura_inventata(self):
        r15 = mutant(REGULI_R15_TEXT)
        html = html_captura("lung", extra_zona=REPRO_R5_LIGATURA)
        self.refuzat(html, "text:continut_strain_arbitrar")
        self.pleaca(r15, html)                                               # = ce a gasit Jakarinos pe 7b9aa4da
        self.assertIn("  necunoscut text:continut_strain_arbitrar", self.stare_linii(zona_cu(REPRO_R5_LIGATURA)))
        # variante: numele reale ale iconitelor (care in pagina stau in fonticon, nu ca text), ligaturi "plauzibile", in zona, in iconitele
        # reale ale controalelor (text_in_control) si in iconita butonului modelului; lista ligaturilor vazute e GOALA
        self.assertEqual(gp.LIGATURI_VAZUTE, ())
        for lig in ICOANE_REALE + ("send", "add_2", "close", "attach", "fullscreen", "x", "a1"):
            m = "text:" + lig if gp._cuvant(lig) is None else "text_atasament:" + lig
            self.refuzat(html_captura("lung", extra_zona="<mat-icon>%s</mat-icon>" % lig), m)
            for fonticon in ICOANE_REALE:
                i = index_captura("lung", "mat-icon", fonticon=fonticon)
                mi = "text_in_control:" + lig if gp._cuvant(lig) is None else "text_atasament:" + lig
                self.refuzat(html_captura("lung", interior=((i, lig),)), mi)
            if gp._cuvant(lig) is None:
                self.pleaca(r15, html_captura("lung", extra_zona="<mat-icon>%s</mat-icon>" % lig))      # r15: RE_LIGATURA o accepta
        # pozitiv: iconitele reale (text gol, si cu spatii albe HTML) trec
        for fonticon in ICOANE_REALE:
            i = index_captura("lung", "mat-icon", fonticon=fonticon)
            for sp in SPATII_HTML:
                self.assertEqual(self.an(html_captura("lung", interior=((i, sp),)))["necunoscute"], 0, msg=(fonticon, repr(sp)))

    # ---------- (3) golul pe textul brut ----------

    def test_reproducerea_3_caractere_invizibile(self):
        r15 = mutant(REGULI_R15_TEXT)
        for span, vizibil in zip(REPRO_R5_INVIZIBILE, ("\\u0301", "\\u200b")):
            self.assertEqual(gp._ascii(span[6:-7]), "")                    # forma ASCII goala (de aici refuzul lipsa pe r15)
            html = html_captura("lung", extra_zona=span)
            self.refuzat(html, "text:" + vizibil)
            self.pleaca(r15, html)                                           # = ce a gasit Jakarinos pe 7b9aa4da
            self.assertEqual(self.an(zona_cu(span))["necunoscute_detalii"], ["text:" + vizibil])
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(span))), ("ciorna_necunoscuta", []))
            self.assertIn("  necunoscut text:" + vizibil, self.stare_linii(zona_cu(span)))

    def test_invizibile_pe_fiecare_loc(self):
        # fiecare varianta: in zona (text:), in controale si in butonul modelului (text_in_control:), in iconita, in link, sub avertisment
        i_inc = index_captura("lung", "button", **{"aria-label": ARIALABEL_REAL})
        i_mod = index_captura("lung", "span", **{"class": "gds-body-m picker-primary-text ng-star-inserted"})
        i_ico = index_captura("lung", "mat-icon", fonticon="plus")
        for t, vizibil in INVIZIBILE:
            self.refuzat(html_captura("lung", extra_zona="<span>%s</span>" % t), "text:" + vizibil)
            self.refuzat(html_captura("lung", extra_zona="<hallucination-disclaimer>%s</hallucination-disclaimer>" % t), "text:" + vizibil)
            for i in (i_inc, i_mod, i_ico):
                self.refuzat(html_captura("lung", interior=((i, "<span>%s</span>" % t),)), "text_in_control:" + vizibil)
            self.assertEqual(self.an(zona_cu(link_cu_text(t)))["necunoscute_detalii"], ["text_in_control:" + vizibil], msg=repr(t))
            # lipit de un text cunoscut: alt text (Unicode exact), refuz
            for cunoscut, loc_html in (("Carbon", None), (TEXT_LINK_REAL, link_cu_text)):
                if loc_html is None:
                    html = html_captura("lung", interior=((i_mod, "<span>Carbon%s</span>" % t),))
                    self.assertEqual(len(self.an(html)["necunoscute_detalii"]), 1, msg=repr(t))
                    self.assertTrue(self.an(html)["necunoscute_detalii"][0].startswith("text_in_control:"))
                else:
                    self.assertEqual(self.an(zona_cu(loc_html(cunoscut + t)))["necunoscute"], 1, msg=repr(t))
        # pozitiv: doar spatii albe HTML = gol, pe orice loc
        for sp in SPATII_HTML:
            for html in (html_captura("lung", extra_zona="<span>%s</span>" % sp), html_captura("lung", interior=((i_inc, sp),)),
                         html_captura("lung", interior=((i_mod, "<span>%s</span>" % sp),)), zona_cu(link_cu_text(sp))):
                self.assertEqual(self.an(html)["necunoscute"], 0, msg=repr(sp))
        # _motiv_text direct: golul se decide pe textul BRUT
        for t, vizibil in INVIZIBILE:
            if "&" in t:
                continue
            self.assertEqual(gp._motiv_text(_nod_text(t), None), "text:" + vizibil, msg=repr(t))
        for sp in SPATII_HTML:
            self.assertIsNone(gp._motiv_text(_nod_text(sp), None), msg=repr(sp))

    # ---------- starile reale (captura netaiata) ----------

    def test_starile_reale_netaiate_trec_si_textele_lor_sunt_exact_lista(self):
        # cele 3 stari din captura netaiata: 0 necunoscute, `stare` OK, chat nou gol -> scriere (mediu / lung) -> Enter; singurul nod text
        # nevid in afara editorului = "Carbon" in butonul modelului (sursa independenta a listei, calculata din fixture)
        for s in ("gol", "mediu", "lung"):
            html = html_captura(s)
            i = self.an(html)
            self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 0), msg=(s, i["necunoscute_detalii"]))
            self.assertIn("paza ciorna: OK (trimite ar continua)", self.stare_linii(html))
            texte = [t for _, _, _, t in CAPTURA_2311[s] if t != ""]
            self.assertEqual(texte, ["Carbon"], msg=s)
        for s in ("mediu", "lung"):
            self.assertEqual(self.scrie(gp, html_captura(s)), (None, ACTIUNI_TRIMITERE), msg=s)
        # perechile (loc, text) din pagina reala, calculate cu _loc_text pe arborele analizat = EXACT perechea din lista
        a = gp._Arbore()
        a.feed(html_captura("lung"))
        gp.HTMLParser.close(a)
        zona = next(n for n in gp._descendenti(a.radacina) if n.tag == "input-area-v2")
        editoare = [n for n in gp._descendenti(a.radacina) if gp._e_editor(n)]
        perechi = set()
        for n in gp._descendenti(zona):
            if n.tag != "#text" or n.date.strip(" \t\n\r\f") == "" or any(gp._sub(n, e) for e in editoare):
                continue
            ctrl = next((p for p in _stramosi(n, zona) if p.attrs.get("data-test-id") == gp.MODEL_DATA_TEST
                         or gp._semnatura(p) in gp.CONTROALE_CUNOSCUTE), None)
            perechi.add((gp._loc_text(n, ctrl, zona), n.date.strip(" \t\n\r\f")))
        self.assertEqual(perechi, {("buton_model", "Carbon")})
        self.assertIn(("buton_model", "Carbon"), gp.TEXTE_CUNOSCUTE)
        # si fixture-urile 21.11 / 22.11 / 23.11 (inclusiv chatul existent, cu avertismentul si linkul) trec pina la Enter
        for html in [pagina_calibrare(s) for s in ("i", "ii", "iii")] + [pagina_22_11_completa(s, fdi=FDI_5G) for s in ("i", "ii", "iii")]:
            self.assertEqual(ruleaza_trimite(gp, FakePg(html, dupa_goto=html)), (None, ACTIUNI_TRIMITERE))
        self.assertEqual(scenariu_brief_lung(gp, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE))

    # ---------- mutantii r16 ----------

    def test_mutanti_r16_lasa_brief_ul_sa_plece(self):
        i_inc = index_captura("lung", "button", **{"aria-label": ARIALABEL_REAL})
        i_trm = index_captura("lung", "button", **{"aria-label": "Trimite mesajul"})
        i_mod = index_captura("lung", "span", **{"class": "gds-body-m picker-primary-text ng-star-inserted"})
        cap = lambda **k: html_captura("lung", **k)
        cazuri = (
            # (M80) regulile r15 (7b9aa4da): cele 3 reproduceri din verdict
            (REGULI_R15_TEXT, (cap(interior=((i_inc, REPRO_R5_SPAN),)), cap(interior=((i_trm, REPRO_R5_SPAN),)),
                               cap(extra_zona=REPRO_R5_LIGATURA)) + tuple(cap(extra_zona=s) for s in REPRO_R5_INVIZIBILE)),
            # (M81) golul decis dupa forma ASCII (= r15): caracterele invizibile trec
            ([('    if b == "":', '    if b == "" or not _ascii(nod.date):')],
             tuple(cap(extra_zona="<span>%s</span>" % t) for t, v in INVIZIBILE if v != "?")),     # (U+2028 are forma ASCII "?")
            # (M82) capetele curatate de ORICE spatiu Unicode (str.strip), nu doar de spatiile albe HTML
            ([('    b = nod.date.strip(" \\t\\n\\r\\f")', "    b = nod.date.strip()")],
             (cap(extra_zona="<span>\u00a0</span>"), cap(extra_zona="<span>\u3000</span>"), cap(interior=((i_mod, "<span>Carbon\u00a0</span>"),)))),
            # (M83) locul ignorat: orice text din lista, oriunde
            ([(LINIA_TEXTE, "    if b in [t for _, t in TEXTE_CUNOSCUTE]:")],
             (cap(interior=((i_inc, "<span>Carbon</span>"),)), cap(extra_zona="<div>%s</div>" % AVERTISMENT_TEXT),
              cap(interior=((i_trm, TEXT_LINK_REAL),)))),
            # (M84) locul in afara controalelor = orice stramos (nu doar pana la zona) / zona insasi
            ([("    while p is not None and p is not zona:", "    while p is not None:")],
             ("<html><body><hallucination-disclaimer><input-area-v2><div>%s</div>" % AVERTISMENT_TEXT + EDITOR_HTML
              + "</input-area-v2></hallucination-disclaimer></body></html>",)),
        )
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                if "<hallucination-disclaimer><input-area-v2>" in html:
                    self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []))
                    self.assertEqual(ruleaza_trimite(mut, FakePg(html, dupa_goto=html))[0], None, msg=inlocuiri[0][1][:80])
                    continue
                self.assertEqual(self.scrie(gp, html), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=(inlocuiri[0][1][:80], html[-200:]))
                self.assertEqual(self.scrie(mut, html), (None, ACTIUNI_TRIMITERE), msg=(inlocuiri[0][1][:80], html[-200:]))
            # starile reale trec pe fiecare mutant (mutantul slabeste, nu strica)
            for s in ("mediu", "lung"):
                self.assertEqual(self.scrie(mut, html_captura(s)), (None, ACTIUNI_TRIMITERE), msg=(inlocuiri[0][1][:80], s))
            self.assertEqual(scenariu_brief_lung(mut, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE))
            h = pagina_calibrare("iii")
            self.assertEqual(ruleaza_trimite(mut, FakePg(h, dupa_goto=h)), (None, ACTIUNI_TRIMITERE), msg=inlocuiri[0][1][:80])


# --- r17 (Jakarinos NO-GO r6 pe ed293d49): exceptia de text DOAR pe editorul principal unic, comparat cu brief-ul fara a sterge invizibilele ---
# reproducerile din verdict, copiate exact: continutul lui div.ql-clipboard (capturile gol / mediu / lung, doar continutul schimbat)
REPRO_R6_CLIPBOARD = ("continut strain arbitrar", "contract.pdf", "\u0301", "\u200b")
SEM_CLIPBOARD = "editabil:div[tabindex][contenteditable]{ql-clipboard}"      # scris de mana: _semnatura (tabindex, contenteditable) + clasa
SRC_EDITABIL = "contenteditable:div=true"
# motivul textului din clipboard (al doilea, dupa elementul insusi), scris de mana pe regulile r16
MOTIV_TEXT_CLIPBOARD = {"continut strain arbitrar": "text:continut strain arbitrar", "contract.pdf": "text_fisier:contract.pdf",
                        "\u0301": "text:\\u0301", "\u200b": "text:\\u200b"}
EDITABIL_LANGA = '<div contenteditable="true">continut strain arbitrar</div>'     # "un element editabil suplimentar, langa editorul principal"
AL_DOILEA_EDITOR = '<div role="textbox" contenteditable="true"><p>continut strain arbitrar</p></div>'
# r16 pe cod: _e_editor = orice contenteditable="true" sub rich-textarea (sau div.ql-editor), paza cere doar "cel putin un editor"
LINIE_E_EDITOR = ('    return (n.tag == "div" and n.attrs.get("role") == "textbox" and n.attrs.get("contenteditable") == "true"\r\n'
                  '            and p is not None and p.tag == "rich-textarea")')
REGULI_R16_EDITOR = [
    (LINIE_E_EDITOR, '    if n.attrs.get("contenteditable") != "true":\r\n        return False\r\n'
                     '    if n.tag == "div" and "ql-editor" in _clase(n):\r\n        return True\r\n'
                     '    while p is not None:\r\n        if p.tag == "rich-textarea":\r\n            return True\r\n'
                     '        p = p.parinte\r\n    return False'),
    ('    if info["editoare"] != 1 or not info["zone"]:', '    if not info["editoare"] or not info["zone"]:'),
]
# r16 pe cod: normalizarea veche (NBSP -> spatiu, caracterele de latime zero sterse, orice spatiu Unicode comprimat)
REGULI_R16_NORMALIZARE = [('    return SPATII_COMPARATIE.sub(" ", t or "").strip(" ")',
                           '    t = (t or "").replace("\\u00a0", " ")\r\n    for z in ("\\u200b", "\\u200c", "\\u200d", "\\u2060", "\\ufeff"):\r\n'
                           '        t = t.replace(z, "")\r\n    return " ".join(t.split())')]
# r18: regulile r17 din editor (orice eticheta de text tolerata, atributele doar pe lista alba), pentru mutantii judecati pe regula lor
REGULI_R17_IN_EDITOR = [
    ('EDITOR_TAGURI = ("p", "br")', 'EDITOR_TAGURI = ("p", "br", "span", "div", "strong", "b", "em", "i", "u", "s", "code", "pre", "ol", "ul", '
                                    '"li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "sub", "sup")'),
    ("        if r[0] is None and n.attrs:", "        if False:"),
]
# randarea inner_text() a unui brief cu mai multe linii in Quill: <p> pe linie -> \n in plus intre paragrafe, linia goala = <p><br></p>
BRIEF_LINII = "Intrebare:\n\nlinia 1 cu  doua spatii\tsi tab\n- punct 1\n- punct 2 \u0219i \u021b"
RANDARI_QUILL = (lambda s: s.replace("\n", "\n\n"), lambda s: s.replace("\n", "\n\n\n") + "\n", lambda s: "\n" + s.replace("\n", "\r\n\n"))
# caractere care NU sunt spatii albe HTML: prezente in editor si absente din brief = nepotrivire (scrise de mana, cu punctul de cod afisat)
INVIZIBILE_EDITOR = (("\u200b", "U+200B"), ("\u2060", "U+2060"), ("\ufeff", "U+FEFF"), ("\u200c", "U+200C"), ("\u200d", "U+200D"),
                     ("\u0301", "U+0301"), ("\u00a0", "U+00A0"), ("\u3000", "U+3000"), ("\x0b", "U+000B"), ("\u2028", "U+2028"))


def trimite_brief(mod, pg, brief):
    # -> (cod GemEroare sau None, detaliu, actiunile paginii)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            mod.trimite(pg, brief, 30)
        return None, "", pg.act
    except mod.GemEroare as e:
        return e.cod, e.detaliu, pg.act


class TestEditorPrincipalR17(unittest.TestCase):
    """r17: (1) contextul editorului (textul lui comparat cu brief-ul) = DOAR editorul principal unic (rich-textarea > div[role=textbox]
    [contenteditable=true]); div.ql-clipboard permis doar gol, cu atributele exacte; orice alt contenteditable = `editabil:`. (2) compararea
    cu brief-ul comprima doar spatiile albe HTML. Asteptarile sunt scrise de mana din verdict si din captura netaiata."""

    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def scrie(self, mod, html_dupa_scriere, **kw):
        # r18: mutantii din aceasta clasa (regulile r16 / r17) se judeca pe regula lor: straturile r18 oprite DOAR in mutant (fara_r18)
        g = html_captura("gol")
        with (fara_r18(mod) if mod is not gp else contextlib.nullcontext()):
            return ruleaza_trimite(mod, FakePg(g, dupa_goto=g, dupa_scriere=html_dupa_scriere, **kw))

    def i_clip(self, s):
        return index_captura(s, "div", **{"class": "ql-clipboard"})

    # ---------- (1) reproducerile din verdict ----------

    def test_reproducerea_clipboard_cu_continut_refuzata(self):
        r16 = mutant(REGULI_R16_EDITOR)
        for s in ("gol", "mediu", "lung"):
            for t in REPRO_R6_CLIPBOARD:
                html = html_captura(s, interior=((self.i_clip(s), t),))
                i = self.an(html)
                self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"]), (1, 1, 0, 0), msg=(s, repr(t)))
                self.assertEqual(i["necunoscute_detalii"], [SEM_CLIPBOARD, MOTIV_TEXT_CLIPBOARD[t]], msg=(s, repr(t)))
                self.assertEqual(i["necunoscute_surse"], [SRC_EDITABIL, ""], msg=(s, repr(t)))
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=(s, repr(t)))
                if s != "gol":
                    self.assertEqual(self.scrie(gp, html), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=(s, repr(t)))
                # pe regulile r16 (= ed293d49): 2 editoare, 0 necunoscute, Enter (ce a masurat Jakarinos)
                i16 = self.an(html, r16)
                self.assertEqual((i16["editoare"], i16["necunoscute"]), (2, 0), msg=(s, repr(t)))
                if s != "gol":
                    self.assertEqual(self.scrie(r16, html), (None, ACTIUNI_TRIMITERE), msg=(s, repr(t)))

    def test_al_doilea_element_editabil_langa_editor_refuzat(self):
        r16 = mutant(REGULI_R16_EDITOR)
        for s in ("mediu", "lung"):
            i_rt = index_captura(s, "rich-textarea")
            html = html_captura(s, interior=((i_rt, EDITABIL_LANGA),))
            self.assertEqual(self.an(html)["necunoscute_detalii"], ["editabil:div[contenteditable]{}", "text:continut strain arbitrar"], msg=s)
            self.assertEqual(self.scrie(gp, html), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=s)
            self.assertEqual(self.scrie(r16, html), (None, ACTIUNI_TRIMITERE), msg=s)
            # al doilea editor PRINCIPAL (acelasi rol si contenteditable, fiu al lui rich-textarea): nu stiu in care scriu -> refuz
            html = html_captura(s, interior=((i_rt, AL_DOILEA_EDITOR),))
            i = self.an(html)
            self.assertEqual((i["editoare"], i["zone"]), (2, 1), msg=s)
            with self.assertRaises(gp.GemEroare) as c:
                gp.verifica_fara_atasamente(i, 0, "t")
            self.assertEqual(c.exception.cod, "ciorna_necitibila")
            self.assertIn("editoare 2", c.exception.detaliu)
            self.assertEqual(self.scrie(gp, html), ("ciorna_necitibila", ACTIUNI_FARA_ENTER), msg=s)
            self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necitibila", []), msg=s)
            self.assertEqual(self.scrie(r16, html), (None, ACTIUNI_TRIMITERE), msg=s)
        # doi editori principali in rich-textarea diferite (alt loc din pagina, in afara zonei): tot refuz (numararea e pe toata pagina)
        html = pagina(conversatie="<rich-textarea>" + AL_DOILEA_EDITOR + "</rich-textarea>")
        self.assertEqual(self.an(html)["editoare"], 2)
        self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necitibila", []))

    def test_contenteditable_pe_alt_nod_refuzat(self):
        # orice element cu atributul contenteditable (orice valoare) in afara editorului principal si a clipboard-ului exact = editabil:
        cazuri = (
            # (html pus in zona capturii lungi, motivele asteptate)
            ('<span contenteditable="true"></span>', ["editabil:span[contenteditable]{}"]),
            ('<div contenteditable=""></div>', ["editabil:div[contenteditable]{}"]),
            ('<div contenteditable="plaintext-only"></div>', ["editabil:div[contenteditable]{}"]),
            ('<div contenteditable="TRUE"></div>', ["editabil:div[contenteditable]{}"]),
            ('<div contenteditable="false"></div>', ["editabil:div[contenteditable]{}"]),
            ('<div class="ql-clipboard" contenteditable="true" tabindex="-1"></div>', [SEM_CLIPBOARD]),     # clipboard in afara rich-textarea
        )
        for extra, m in cazuri:
            html = html_captura("lung", extra_zona=extra)
            self.assertEqual(self.an(html)["necunoscute_detalii"][:1], m, msg=extra)
            self.assertEqual(self.scrie(gp, html)[0], "ciorna_necunoscuta", msg=extra)
        # in editor: un div contenteditable gol (permis de lista alba a atributelor pe div) = semnal in editor
        ed = TEXT_LUNG + '<div contenteditable="true"></div>'
        html = html_captura("lung", editor=ed)
        self.assertEqual(self.an(html)["necunoscute_detalii"], ["semnal_in_editor:editabil:div[contenteditable]{}",
                                                                "editor_structura:div direct in editor"])     # r18: + forma Quill
        self.assertEqual(self.scrie(gp, html), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
        # pe rich-textarea si pe zona insasi
        i_rt = index_captura("lung", "rich-textarea")
        atr_rt = CAPTURA_2311["lung"][i_rt][2] + (("contenteditable", "true"),)
        d = self.an(html_captura("lung", inlocuiri=((i_rt, atr_rt),)))["necunoscute_detalii"]
        self.assertEqual(len(d), 1, msg=d)
        self.assertTrue(d[0].startswith("editabil:rich-textarea[contenteditable]{"), msg=d)
        d = self.an(pagina(zona_atr=' contenteditable="true"'))["necunoscute_detalii"]
        self.assertEqual(d, ["editabil:input-area-v2[contenteditable]{}"])

    def test_clipboard_doar_gol_si_exact(self):
        s = "lung"
        i = self.i_clip(s)
        real = CAPTURA_2311[s][i][2]
        self.assertEqual(dict(real), gp.CLIPBOARD_ATRIBUTE)                            # constanta = atributele din captura
        for st in ("gol", "mediu", "lung"):                                           # identic in toate cele trei stari, fara text / copii
            self.assertEqual(CAPTURA_2311[st][self.i_clip(st)][2], real)
            self.assertEqual(CAPTURA_2311[st][self.i_clip(st)][3], "")
            self.assertLessEqual(CAPTURA_2311[st][self.i_clip(st) + 1][0], CAPTURA_2311[st][self.i_clip(st)][0])   # urmatorul nu e copil
        # orice copil (spatii albe HTML, element gol, <br>) = clipboard-ul nu mai e cel gol din capturi -> refuz
        for t in (" ", "\n  ", "<p></p>", "<br>", "<span></span>"):
            d = self.an(html_captura(s, interior=((i, t),)))["necunoscute_detalii"]
            self.assertEqual(d[:1], [SEM_CLIPBOARD], msg=repr(t))
        # alte atribute / valori / un atribut in plus sau lipsa
        for atr in (real + (("data-x", "1"),), tuple(x for x in real if x[0] != "tabindex"), tuple(x for x in real if x[0] != "class"),
                    tuple((k, "0" if k == "tabindex" else v) for k, v in real), tuple((k, "ql-clipboard x" if k == "class" else v) for k, v in real),
                    tuple((k, "plaintext-only" if k == "contenteditable" else v) for k, v in real)):
            d = self.an(html_captura(s, inlocuiri=((i, atr),)))["necunoscute_detalii"]
            self.assertTrue(d and d[0].startswith("editabil:div["), msg=(atr, d))
        # doua clipboard-uri goale exacte in acelasi rich-textarea: niciunul nu e acceptat
        clip = '<div class="ql-clipboard" contenteditable="true" tabindex="-1"></div>'
        d = self.an(html_captura(s, interior=((index_captura(s, "rich-textarea"), clip),)))["necunoscute_detalii"]
        self.assertEqual(d, [SEM_CLIPBOARD, SEM_CLIPBOARD])
        # pozitiv: clipboard-ul real (gol) trece in toate cele trei stari; nodul lui e recunoscut de _e_clipboard, nu de _e_editor
        for st in ("gol", "mediu", "lung"):
            a = gp._Arbore()
            a.feed(html_captura(st))
            gp.HTMLParser.close(a)
            noduri = [n for n in gp._descendenti(a.radacina) if "contenteditable" in n.attrs]
            self.assertEqual([(gp._e_editor(n), gp._e_clipboard(n)) for n in noduri], [(True, False), (False, True)], msg=st)
            self.assertEqual(self.an(html_captura(st))["necunoscute"], 0, msg=st)

    def test_locatorul_cere_un_singur_editor(self):
        # HTML-ul are un editor, dar locatorul (vede si shadow DOM) vede 2 / 0: refuz inainte de click
        g = html_captura("gol")
        self.assertEqual(ruleaza_trimite(gp, FakePg(g, dupa_goto=g, n_editor=2)), ("editor_multiplu", ["goto"]))
        self.assertEqual(ruleaza_trimite(gp, FakePg(g, dupa_goto=g, n_editor=0)), ("editor_lipsa", ["goto"]))
        # al doilea editor aparut DUPA scriere (doar la locator): reverificarea chiar inainte de citire, fara Enter
        pg = FakePg(g, dupa_goto=g, dupa_scriere=html_captura("mediu"))
        kb = pg.keyboard
        vechi = kb.insert_text

        def insert_si_editor(t):
            vechi(t)
            pg.n_editor = 2
        kb.insert_text = insert_si_editor
        self.assertEqual(ruleaza_trimite(gp, pg), ("editor_multiplu", ACTIUNI_FARA_ENTER))
        # mutantul fara verificarea lui k != 1 (locatorul): pleaca
        mut = mutant([("    if k != 1:", "    if False:")])
        self.assertEqual(ruleaza_trimite(mut, FakePg(g, dupa_goto=g, n_editor=2)), (None, ACTIUNI_TRIMITERE))

    # ---------- (2) compararea cu brief-ul ----------

    def test_comparatia_randarea_quill_trece(self):
        # calea legitima (L20): inner_text() al lui Quill pune \n in plus intre paragrafe; doar spatiile albe HTML sunt comprimate
        for f in RANDARI_QUILL:
            g = html_captura("gol")
            pg = FakePg(g, dupa_goto=g, dupa_scriere=html_captura("mediu"), randare=f)
            self.assertEqual(trimite_brief(gp, pg, BRIEF_LINII), (None, "", ACTIUNI_TRIMITERE), msg=repr(f(BRIEF_LINII)))
            gp.verifica_ciorna(f(BRIEF_LINII), BRIEF_LINII, 0)
        # un invizibil care e si in brief si in editor = acelasi text (comparatie exacta)
        for t, _ in INVIZIBILE_EDITOR:
            b = "a" + t + "b"
            gp.verifica_ciorna(b, b, 0)

    def test_invizibil_in_editor_absent_din_brief_refuzat(self):
        r16 = mutant(REGULI_R16_NORMALIZARE)
        g = html_captura("gol")
        for t, cod in INVIZIBILE_EDITOR:
            for f in (lambda s, t=t: s + t, lambda s, t=t: t + s, lambda s, t=t: s.replace("exact", "exa" + t + "ct"),
                      lambda s, t=t: s.replace(" ", t, 1)):
                pg = FakePg(g, dupa_goto=g, dupa_scriere=html_captura("mediu"), randare=f)
                cod_e, det, act = trimite_brief(gp, pg, BRIEF_TEST)
                self.assertEqual((cod_e, act), ("text_neintrat", ACTIUNI_FARA_ENTER), msg=repr(f(BRIEF_TEST)))
                self.assertIn("editor " + cod, det, msg=repr(f(BRIEF_TEST)))
        # reproducerea din verdict: U+200B in editor (randarea lui), absent din brief -> pe normalizarea r16 pleaca
        for t in ("\u200b", "\u2060", "\ufeff", "\u200c", "\u200d", "\u00a0"):
            f = (lambda s, t=t: s.replace(" ", t, 1)) if t == "\u00a0" else (lambda s, t=t: s + t)
            pg = FakePg(g, dupa_goto=g, dupa_scriere=html_captura("mediu"), randare=f)
            self.assertEqual(trimite_brief(gp, pg, BRIEF_TEST)[0], "text_neintrat", msg=repr(t))
            pg = FakePg(g, dupa_goto=g, dupa_scriere=html_captura("mediu"), randare=f)
            self.assertEqual(trimite_brief(r16, pg, BRIEF_TEST), (None, "", ACTIUNI_TRIMITERE), msg=repr(t))

    def test_comparatia_structural(self):
        # normalizeaza nu mai sterge si nu mai inlocuieste nimic: o singura transformare (spatiile albe HTML), fara replace / split()
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        linii = [l.rstrip("\r") for l in src.split("\n")]
        i0 = linii.index("def normalizeaza(t):")
        i1 = next(k for k in range(i0 + 1, len(linii)) if linii[k].startswith("def "))
        corp = [l for l in linii[i0 + 1:i1] if l.strip() and not l.lstrip().startswith("#")]
        self.assertEqual(corp, ['    return SPATII_COMPARATIE.sub(" ", t or "").strip(" ")'])
        self.assertEqual(gp.SPATII_COMPARATIE.pattern, "[ \t\n\r\f]+")
        for c in map(chr, range(0x10000)):
            self.assertEqual(gp.SPATII_COMPARATIE.fullmatch(c) is not None, c in " \t\n\r\f", msg=hex(ord(c)))
        # editorul unic la locator printr-un singur loc (_editor_unic): o data in trimite (inainte de click) si o data in _ultima_paza
        # r18: textul nu se mai citeste prin locator (inner_text), ci din instantaneul HTML al ultimei paze
        i_t = linii.index("def trimite(pg, text, maxs, target=\"https://gemini.google.com/app\"):")
        i_u = next(k for k in range(i_t + 1, len(linii)) if linii[k].startswith("def "))
        corp_t = [l for l in linii[i_t:i_u] if not l.lstrip().startswith("#")]
        self.assertEqual(sum(l.count("_editor_unic(pg)") for l in corp_t), 1)
        self.assertEqual(sum(l.count("pg.locator(EDITOR)") for l in corp_t), 1)          # doar asteptarea dupa navigare (wait_for)
        self.assertLess(corp_t.index("    pg.wait_for_timeout(800)"), corp_t.index("    _ultima_paza(pg, text)"))
        self.assertEqual(corp_t[corp_t.index("    _ultima_paza(pg, text)") + 1], '    pg.keyboard.press("Enter")')
        self.assertFalse([l for l in corp_t if "inner_text" in l])

    # ---------- mutantii r17 ----------

    def test_mutanti_r17_lasa_brief_ul_sa_plece(self):
        s = "mediu"
        i_clip, i_rt = self.i_clip(s), index_captura(s, "rich-textarea")
        cap = lambda **k: html_captura(s, **k)
        cazuri = (
            # (M90) fara pasul 5 din _semnal: un div contenteditable gol in editor (permis de lista alba a atributelor) pleaca
            # r18: in editor div-ul e refuzat acum si de lista p / br fara atribute -> in mutant si regulile r17 din editor (REGULI_R17_IN_EDITOR)
            ([('    if "contenteditable" in n.attrs and not _e_editor(n) and not _e_clipboard(n):', "    if False:")] + REGULI_R17_IN_EDITOR,
             (cap(editor=TEXT_MEDIU + '<div contenteditable="true"></div>'),), False),
            # (M91) clipboard-ul cu copii acceptat (doar atributele exacte): spatiu / <p></p> in el pleaca
            ([("    if n.tag != \"div\" or n.attrs != CLIPBOARD_ATRIBUTE or n.copii or p is None", "    if n.tag != \"div\" or n.attrs != CLIPBOARD_ATRIBUTE or p is None")],
             (cap(interior=((i_clip, " "),)), cap(interior=((i_clip, "<p></p>"),))), False),
            # (M92) clipboard-ul dupa clasa, nu dupa atributele exacte: un atribut in plus pleaca (lista alba a atributelor oprita in mutant)
            # (ambele locuri din _e_clipboard: elementul insusi si numararea fratilor)
            ([("    if n.tag != \"div\" or n.attrs != CLIPBOARD_ATRIBUTE or", "    if n.tag != \"div\" or n.attrs.get(\"class\") != \"ql-clipboard\" or"),
              ("c.tag == \"div\" and c.attrs == CLIPBOARD_ATRIBUTE) == 1)", "c.tag == \"div\" and c.attrs.get(\"class\") == \"ql-clipboard\") == 1)")],
             (cap(inlocuiri=((i_clip, CAPTURA_2311[s][i_clip][2] + (("data-x", "1"),)),)),), True),
            # (M93) mai multe clipboard-uri acceptate: al doilea pleaca
            ([("            and sum(1 for c in p.copii if c.tag == \"div\" and c.attrs == CLIPBOARD_ATRIBUTE) == 1)", "            and True)")],
             (cap(interior=((i_rt, '<div class="ql-clipboard" contenteditable="true" tabindex="-1"></div>'),)),), False),
            # (M94) paza cere doar "cel putin un editor": al doilea editor principal, in alt rich-textarea (in afara zonei), pleaca
            # (locatorul fals vede 1; in ACELASI rich-textarea clipboard-ul real n-ar mai fi acceptat - doua straturi, nu discrimineaza)
            ([('    if info["editoare"] != 1 or not info["zone"]:', '    if not info["editoare"] or not info["zone"]:')],
             (cap().replace('<div class="conversation-container"></div>',
                            '<div class="conversation-container"><rich-textarea>' + AL_DOILEA_EDITOR + '</rich-textarea></div>'),), False),
        )
        for inlocuiri, htmluri, fara_lista in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertIn(self.scrie(gp, html), (("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), ("ciorna_necitibila", ACTIUNI_FARA_ENTER)),
                              msg=(inlocuiri[0][1][:80], html[-200:]))
                if fara_lista:
                    with fara_r13(mut):
                        self.assertEqual(self.scrie(mut, html), (None, ACTIUNI_TRIMITERE), msg=inlocuiri[0][1][:80])
                else:
                    self.assertEqual(self.scrie(mut, html), (None, ACTIUNI_TRIMITERE), msg=inlocuiri[0][1][:80])
            # starile reale trec pe fiecare mutant (mutantul slabeste, nu strica)
            for st in ("mediu", "lung"):
                self.assertEqual(self.scrie(mut, html_captura(st)), (None, ACTIUNI_TRIMITERE), msg=(inlocuiri[0][1][:80], st))
        # cele doua mutatii de baza (regulile r16): reproducerile din verdict pleaca (testele de mai sus); starile reale trec pe ele
        for inl in (REGULI_R16_EDITOR, REGULI_R16_NORMALIZARE):
            mut = mutant(inl)
            for st in ("mediu", "lung"):
                self.assertEqual(self.scrie(mut, html_captura(st)), (None, ACTIUNI_TRIMITERE))

    def test_starile_reale_trec_r17(self):
        # regresie: captura netaiata (gol -> mediu / lung), 21.11 i-iii, 22.11 i-iii (si cu 5g), 23.11 text lung + chat nou: Enter
        for st in ("mediu", "lung"):
            self.assertEqual(self.scrie(gp, html_captura(st)), (None, ACTIUNI_TRIMITERE), msg=st)
        for html in [pagina_calibrare(x) for x in ("i", "ii", "iii")] + [pagina_22_11_completa(x) for x in ("i", "ii", "iii")] + \
                [pagina_22_11_completa(x, fdi=FDI_5G) for x in ("i", "ii", "iii")] + [pagina_23_11(), chat_nou_gol_23_11()]:
            i = self.an(html)
            self.assertEqual((i["editoare"], i["zone"], i["necunoscute"]), (1, 1, 0), msg=i["necunoscute_detalii"])
            self.assertEqual(ruleaza_trimite(gp, FakePg(html, dupa_goto=html)), (None, ACTIUNI_TRIMITERE))
        self.assertEqual(scenariu_brief_lung(gp, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE))
        # `stare` pe captura: editorul (locator) = 1, paza OK
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(html_captura("lung")))
        self.assertIn("paza ciorna: OK (trimite ar continua)", out.getvalue().splitlines())


# --- r18 (Jakarinos NO-GO r7 pe 50743b8f): nicio eticheta sarita in zona; textul editorului din HTML-ul brut; ultima paza = un instantaneu ---
NEVIZIBILE_R17 = ("script", "style", "template", "noscript")          # etichetele sarite pana la r17 (scrise de mana)
BAZA_EDITOR = {"gol": "<p><br></p>", "mediu": TEXT_MEDIU, "lung": TEXT_LUNG}
# reproducerile din verdict, copiate exact: (1) eticheta "nevizibila" editabila, cu text strain, in editor; (2) un style in zona care
# ascunde un span strain din editor
REPRO_R7_NEVIZIBIL = '<%s contenteditable="true">continut strain arbitrar</%s>'
REPRO_R7_STYLE = "<style>rich-textarea span { display: none }</style>"
REPRO_R7_SPAN = "<span>continut strain arbitrar</span>"
# regulile r17 (= 50743b8f) pentru etichetele sarite, ca mutant: impreuna cu REGULI_R17_IN_EDITOR si fara_r18 = codul r17 pe aceste cai
REGULI_R17_NEVIZIBILE = [("        if n.tag == CHIP or _e_semn(n):",
                          '        if n.tag in ("script", "style", "template", "noscript") or n.tag == CHIP or _e_semn(n):')]
LINIA_VERIFICA_R18 = '    verifica_ciorna(info["text_editor"], text, info["atasamente"])'
# (M100) textul din inner_text() (textul VIZIBIL, ca in r17), restul din instantaneu
REGULI_M100_INNER_TEXT = [(LINIA_VERIFICA_R18, '    verifica_ciorna(_editor_unic(pg).inner_text(), text, info["atasamente"])')]
# (M101) doua citiri: textul dintr-o citire content() ANTERIOARA, atasamentele / necunoscutele din a doua
REGULI_M101_DOUA_CITIRI = [("    _editor_unic(pg)\r\n    semn = _semn_locator(pg)\r\n",
                            '    text_citit = _instantaneu(pg)[0]["text_editor"]\r\n    _editor_unic(pg)\r\n    semn = _semn_locator(pg)\r\n'),
                           (LINIA_VERIFICA_R18, '    verifica_ciorna(text_citit, text, info["atasamente"])')]
# (M102) o asteptare intre instantaneu si Enter
REGULI_M102_ASTEPTARE = [('    _ultima_paza(pg, text)\r\n    pg.keyboard.press("Enter")',
                          '    _ultima_paza(pg, text)\r\n    pg.wait_for_timeout(800)\r\n    pg.keyboard.press("Enter")')]
BRIEF_SPECIAL = 'a & b <c> "d" \u0219i \u021b\tx  y\u00a0z'               # escape-uri HTML, diacritice, tab, spatii duble, NBSP


def _text_editor_lejer(ed):
    # mutant (M103): textContent al editorului FARA regulile formei Quill (orice eticheta, orice imbricare)
    return "\n".join(gp._text_brut(c) if c.tag != "#text" else c.date for c in ed.copii), None


def _invariant_instantaneu(pg):
    # r18: dupa scriere exact O citire content(); daca s-a apasat Enter, apelul imediat dinainte e acea citire, iar ea arata editorul
    # cu EXACT brief-ul, fara necunoscute / atasamente (ce s-a trimis = ce s-a verificat) -> (ok, motiv)
    j = pg.jurnal
    # r19: + umbrele din evaluate. r20: instantaneul = UN DOM.getDocument (CDP); orice content() / al doilea getDocument dupa scriere rupe
    # invariantul; intre el si Enter doar desprinderea sesiunii ("cdp detach"); Enter doar daca raspunsul CDP nu are shadow root-uri
    dupa = j[len(j) - 1 - j[::-1].index("insert") + 1:] if "insert" in j else []
    # (un refuz al citirilor dinainte - locatori / evaluate - opreste paza inaintea instantaneului: 0 citiri, fara Enter)
    n = dupa.count("content") + dupa.count("cdp DOM.getDocument")
    if n > 1 or dupa.count("content") or ("press Enter" in dupa and n != 1):
        return False, "citiri dupa scriere: %d (getDocument %d)" % (n, dupa.count("cdp DOM.getDocument"))
    if "press Enter" in dupa:
        k = dupa.index("press Enter")
        intre = dupa[dupa.index("cdp DOM.getDocument") + 1:k]
        if intre != ["cdp detach"]:
            return False, "intre instantaneu si Enter: " + ", ".join(intre)
        if any(pg.ultimele_umbre[k] for k in ("shadow_pagina", "shadow_zona", "custom_zona")):
            return False, "Enter dupa un evaluate cu shadow DOM"
        if any(s.get("shadowRootType") != "user-agent" for x in noduri_cdp(pg.ultimul_doc["root"]) for s in x.get("shadowRoots", [])):
            return False, "Enter dupa un instantaneu CDP cu shadow root (in afara celor user-agent)"
        i = gp.analizeaza_ciorna(pg.citite[-1])
        if gp.normalizeaza(i["text_editor"]) != gp.normalizeaza(BRIEF_TEST) or i["necunoscute"] or i["atasamente"]:
            return False, "Enter dupa un instantaneu care nu e brief-ul curat"
    return True, ""


class TestUltimaPazaR18(unittest.TestCase):
    """r18: (1) script / style / template / noscript nu mai sunt sarite (zona si editor); in editor doar p / br fara atribute, in forma
    Quill; textul editorului se citeste din HTML-ul brut (independent de CSS). (2) ultima paza = un singur page.content(), Enter imediat
    dupa. Asteptarile sunt scrise de mana; reproducerile sunt copiate din verdict."""

    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def r17(self):
        # codul r17 pe caile atinse de r18 (etichete sarite, editorul tolerant), folosit cu fara_r18 (textul vizibil + citire separata)
        return mutant(REGULI_R17_NEVIZIBILE + REGULI_R17_IN_EDITOR)

    def scrie(self, mod, dupa_scriere, brief=BRIEF_TEST, r18_oprit=False, **kw):
        g = html_captura("gol")
        pg = FakePg(g, dupa_goto=g, dupa_scriere=dupa_scriere, **kw)
        with (fara_r18(mod) if r18_oprit else contextlib.nullcontext()):
            cod, det, act = trimite_brief(mod, pg, brief)
        return cod, act, pg

    # ---------- (1) reproducerile din verdict ----------

    def test_reproducerea_nevizibil_editabil_in_editor(self):
        r17 = self.r17()
        for s in ("gol", "mediu", "lung"):
            for tag in NEVIZIBILE_R17:
                extra = REPRO_R7_NEVIZIBIL % (tag, tag)
                html = html_captura(s, editor=BAZA_EDITOR[s] + extra)
                i = self.an(html)
                self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"]), (1, 1, 0, 0), msg=(s, tag))
                self.assertEqual(i["necunoscute_detalii"], ["semnal_in_editor:editabil:%s[contenteditable]{}" % tag,
                                                            "editor_structura:%s direct in editor" % tag], msg=(s, tag))
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=(s, tag))
                self.assertEqual(self.scrie(gp, html)[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=(s, tag))
                # pe codul r17 (mutant + fara_r18): 0 necunoscute si Enter (= ce a masurat Jakarinos)
                with fara_r18(r17):
                    self.assertEqual(self.an(html, r17)["necunoscute"], 0, msg=(s, tag))
                self.assertEqual(self.scrie(r17, html, r18_oprit=True)[:2], (None, ACTIUNI_TRIMITERE), msg=(s, tag))

    def test_reproducerea_nevizibil_in_zona(self):
        # aceleasi patru etichete in zona (in afara editorului), editabile cu text strain si goale: refuz; pe r17: Enter
        r17 = self.r17()
        for s in ("gol", "mediu", "lung"):
            for tag in NEVIZIBILE_R17:
                for extra, m in ((REPRO_R7_NEVIZIBIL % (tag, tag), ["editabil:%s[contenteditable]{}" % tag, "text:continut strain arbitrar"]),
                                 ("<%s></%s>" % (tag, tag), ["element:" + tag]),
                                 ("<%s>continut strain arbitrar</%s>" % (tag, tag), ["element:" + tag, "text:continut strain arbitrar"])):
                    html = html_captura(s, extra_zona=extra)
                    self.assertEqual(self.an(html)["necunoscute_detalii"], m, msg=(s, extra))
                    self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=(s, extra))
                    if s != "gol":
                        self.assertEqual(self.scrie(gp, html)[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=(s, extra))
                        self.assertEqual(self.scrie(r17, html, r18_oprit=True)[:2], (None, ACTIUNI_TRIMITERE), msg=(s, extra))

    def test_reproducerea_style_ascunde_span_in_editor(self):
        # style in zona care ascunde un span strain din editor: textul vizibil (inner_text, pagina falsa) = brief-ul; pe r17: Enter
        r17 = self.r17()
        for s in ("gol", "mediu", "lung"):
            # (ordinea: traseul zonei - editorul, apoi style-ul de la capatul zonei - si la final forma editorului; in ciorna goala
            # <p><br></p> primul copil strain al paragrafului e <br> langa span)
            in_p = "editor_structura:br in p" if s == "gol" else "editor_structura:span in p"
            for ed, m_forma in ((BAZA_EDITOR[s] + REPRO_R7_SPAN, "editor_structura:span direct in editor"),
                                (BAZA_EDITOR[s].replace("</p>", REPRO_R7_SPAN + "</p>", 1), in_p)):
                html = html_captura(s, editor=ed, extra_zona=REPRO_R7_STYLE)
                d = self.an(html)["necunoscute_detalii"]
                self.assertEqual(d, ["element_in_editor:span", "element:style", "text:rich-textarea span { display: none }", m_forma], msg=(s, ed[-80:]))
                self.assertEqual(self.scrie(gp, html)[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=s)
                self.assertEqual(self.scrie(r17, html, r18_oprit=True)[:2], (None, ACTIUNI_TRIMITERE), msg=s)
        # chiar fara style si cu span-ul permis (mutant cu editorul r17): textul citit din HTML contine textul ascuns -> text_neintrat
        mut = mutant(REGULI_R17_IN_EDITOR)
        with mock.patch.object(mut, "_text_editor", _text_editor_lejer):
            cod, act, _ = self.scrie(mut, html_captura("mediu", editor=TEXT_MEDIU), html_editor=lambda c: quill_html(c) + REPRO_R7_SPAN)
        self.assertEqual((cod, act), ("text_neintrat", ACTIUNI_FARA_ENTER))

    def test_reproducerea_editor_schimbat_la_ultima_paza(self):
        # FakePg: la ultima paza (content() dupa scriere) editorul = brief + " continut strain arbitrar"; textul vizibil (inner_text) = brief
        for s in ("gol", "mediu", "lung"):
            cod, act, pg = self.scrie(gp, html_captura(s), html_editor=lambda c: quill_html(c + " continut strain arbitrar"))
            self.assertEqual((cod, act), ("text_neintrat", ACTIUNI_FARA_ENTER), msg=s)
            self.assertFalse([x for x in pg.jurnal if x.startswith("inner_text " + gp.EDITOR)], msg=s)       # textul NU vine din inner_text
            # pe r17 (textul vizibil, apoi o citire separata a paginii): Enter cu textul strain inca in ciorna (= ce a gasit Jakarinos)
            cod, act, pg = self.scrie(gp, html_captura(s), r18_oprit=True, html_editor=lambda c: quill_html(c + " continut strain arbitrar"))
            self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE), msg=s)
            self.assertIn("continut strain arbitrar", pg.citite[-1])

    # ---------- (2) instantaneul unic ----------

    def test_un_singur_instantaneu_pe_orice_tipar_de_schimbare(self):
        # editorul se schimba intre citiri dupa orice tipar (citirea k dupa scriere: curat / cu text strain / cu un chip): invariantul tine
        # pe cod (o citire, Enter doar daca ea e curata, nimic intre ea si Enter); pe mutantii M100 / M101 / M102 se rupe pe un tipar
        def tipar(t):
            def f(pg, h):
                if not pg.scris or pg.n_dupa >= len(t) or t[pg.n_dupa] == "curat":
                    return h
                if t[pg.n_dupa] == "strain":
                    return cu_text_scris(h, quill_html(pg.ciorna + " continut strain arbitrar"))
                return h.replace("</input-area-v2>", chip("a.txt") + "</input-area-v2>")
            return f
        import itertools
        rezultate = {}
        for t in itertools.product(("curat", "strain", "chip"), repeat=3):
            for s in ("mediu", "lung"):
                cod, act, pg = self.scrie(gp, html_captura(s), la_citire=tipar(t))
                ok, motiv = _invariant_instantaneu(pg)
                self.assertTrue(ok, msg=(t, s, motiv, cod))
                asteptat = {"curat": None, "strain": "text_neintrat", "chip": "ciorna_cu_atasamente"}[t[0]]
                self.assertEqual(cod, asteptat, msg=(t, s))           # decizia = starea din SINGURA citire dupa scriere
                rezultate[(t, s)] = cod
        self.assertEqual(sum(1 for v in rezultate.values() if v is None), 2 * 9)     # 9 tipare cu prima citire curata x 2 stari
        for inl, nume in ((REGULI_M100_INNER_TEXT, "M100"), (REGULI_M101_DOUA_CITIRI, "M101"), (REGULI_M102_ASTEPTARE, "M102")):
            mut = mutant(inl)
            rupte = []
            for t in itertools.product(("curat", "strain", "chip"), repeat=3):
                cod, act, pg = self.scrie(mut, html_captura("mediu"), la_citire=tipar(t))
                if not _invariant_instantaneu(pg)[0]:
                    rupte.append((t, cod))
            self.assertTrue(rupte, msg=nume)
            # starile reale trec pe fiecare mutant (mutantul slabeste, nu strica)
            for s in ("mediu", "lung"):
                self.assertEqual(self.scrie(mut, html_captura(s))[:2], (None, ACTIUNI_TRIMITERE), msg=(nume, s))
        # M100: textul vizibil = brief, instantaneul cu text strain -> Enter (invariantul rupt pe ("strain", ...))
        cod, act, pg = self.scrie(mutant(REGULI_M100_INNER_TEXT), html_captura("mediu"), la_citire=tipar(("strain",)))
        self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE))
        # M101: textul din prima citire (curata), restul din a doua (cu text strain in editor, exclus ca "editor") -> Enter
        cod, act, pg = self.scrie(mutant(REGULI_M101_DOUA_CITIRI), html_captura("mediu"), la_citire=tipar(("curat", "strain")))
        self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE))
        self.assertIn("continut strain arbitrar", pg.citite[-1])

    def test_ultima_paza_structural(self):
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        linii = [l.rstrip("\r") for l in src.split("\n")]
        cod = [l for l in linii if not l.lstrip().startswith("#")]

        def corp(antet):
            i0 = linii.index(antet)
            i1 = next(k for k in range(i0 + 1, len(linii)) if linii[k].startswith("def "))
            return [l for l in linii[i0 + 1:i1] if l.strip() and not l.lstrip().startswith("#")]
        c = corp("def _ultima_paza(pg, text):")
        # r19: umbrele refuzate inaintea atasamentelor; r20: evaluate (doar refuz) inainte, instantaneul = _instantaneu (CDP), ultimul
        self.assertEqual(c, ["    _editor_unic(pg)", "    semn = _semn_locator(pg)", '    verifica_fara_umbre(_umbre_js(pg), "inainte_de_enter")',
                             "    info, umbre = _instantaneu(pg)", '    verifica_umbre_cdp(umbre, "inainte_de_enter")',
                             '    verifica_fara_atasamente(info, semn, "inainte_de_enter")', LINIA_VERIFICA_R18])
        self.assertEqual(sum(l.count("_ultima_paza(") for l in cod), 2)               # definitia + singurul apel (in trimite)
        self.assertFalse(any("_atasamente(pg)" in l for l in cod))                    # vechea paza separata a disparut
        self.assertFalse(any("NEVIZIBILE" in l for l in cod))
        self.assertEqual(sum(l.count("_text_editor(") for l in cod), 2)               # definitia + analizeaza_arbore
        # _necunoscute sare DOAR chip-urile / semnele (numarate si refuzate separat); nicio alta eticheta
        c = corp("def _necunoscute(zona, editoare, ids=None):")
        self.assertEqual([l.split("#")[0].rstrip() for l in c if l.split("#")[0].strip() == "continue"], ["            continue"] * 2)
        self.assertIn("        if n.tag == CHIP or _e_semn(n):", c)
        self.assertEqual(gp.EDITOR_TAGURI, ("p", "br"))

    # ---------- forma Quill a editorului ----------

    def test_randarile_quill_legitime_trec(self):
        # L20: un brief cu mai multe linii / linii goale / CRLF / caractere speciale, randat ca de Quill (HTML), ajunge la Enter
        randari = (quill_html, lambda c: quill_html(c) + "<p><br></p>", lambda c: "\n" + quill_html(c).replace("</p><p>", "</p>\n  <p>") + "\n",
                   lambda c: quill_html(c.replace("\r\n", "\n")), lambda c: quill_html(c.replace("\n", "\n\n")))
        for brief in (BRIEF_TEST, BRIEF_LINII, "Intrebare:\r\n\r\n  arhitectura?\r\n- punct\r\n", BRIEF_SPECIAL, BRIEF_LINII + "\n\n" + BRIEF_SPECIAL):
            for f in randari:
                for s in ("mediu", "lung"):
                    cod, act, pg = self.scrie(gp, html_captura(s), brief=brief, html_editor=f)
                    self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE), msg=(repr(brief[:30]), repr(f(brief)[:80]), s))
        # _text_editor direct (scris de mana): liniile lipite cu \n, linia goala = ""
        a = gp._Arbore()
        a.feed('<div><p>a &amp; b</p><p><br></p><p>c\u00a0d</p>\n<p>e</p></div>')
        self.assertEqual(gp._text_editor(a.radacina.copii[0]), ("a & b\n\nc\u00a0d\ne", None))

    def test_forme_ne_quill_refuzate(self):
        # orice alta forma a editorului = refuz inainte de Enter (motivele scrise de mana)
        cazuri = (
            (lambda c: quill_html(c) + "continut strain arbitrar", ["editor_structura:text direct in editor"]),
            (lambda c: "<p>%s<br></p>" % c, ["editor_structura:br in p"]),
            (lambda c: "<p><br>%s</p>" % c, ["editor_structura:br in p"]),
            (lambda c: quill_html(c) + "<p></p>", ["editor_structura:p gol"]),
            (lambda c: "<p>%s<p>x</p></p>" % c, ["editor_structura:p in p"]),
            (lambda c: "", ["editor_structura:editor fara paragraf"]),
            (lambda c: "<p><span>%s</span></p>" % c, ["element_in_editor:span", "editor_structura:span in p"]),
            (lambda c: "<div><p>%s</p></div>" % c, ["element_in_editor:div", "editor_structura:div direct in editor"]),
            (lambda c: '<p data-test-id="empty-disclaimer">%s</p>' % c,
             ["semnal_in_editor:atribut_in_editor:p[data-test-id=empty-disclaimer]{data-test-id}"]),
            (lambda c: '<p dir="ltr">%s</p>' % c, ["semnal_in_editor:atribut_necunoscut:p{dir}"]),
            (lambda c: quill_html(c) + "<p><br></p><style>p{}</style>", ["element_in_editor:style", "editor_structura:style direct in editor"]),
        )
        for f, m in cazuri:
            h = cu_text_scris(html_captura("mediu"), f(BRIEF_TEST))
            self.assertEqual(self.an(h)["necunoscute_detalii"], m, msg=f(BRIEF_TEST))
            cod, act, pg = self.scrie(gp, html_captura("mediu"), html_editor=f)
            self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=f(BRIEF_TEST))

    def test_mutanti_r18_lasa_brief_ul_sa_plece(self):
        cap = lambda s="mediu", **k: html_captura(s, **k)
        # (M103) etichetele sarite repuse: in zona, editabile / cu text, pleaca (in editor raman refuzate de forma Quill: doua straturi)
        mut = mutant(REGULI_R17_NEVIZIBILE)
        for tag in NEVIZIBILE_R17:
            for extra in (REPRO_R7_NEVIZIBIL % (tag, tag), "<%s>continut strain arbitrar</%s>" % (tag, tag)):
                self.assertEqual(self.scrie(gp, cap(extra_zona=extra))[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=extra)
                self.assertEqual(self.scrie(mut, cap(extra_zona=extra))[:2], (None, ACTIUNI_TRIMITERE), msg=extra)
            self.assertEqual(self.scrie(mut, cap(editor=TEXT_MEDIU + REPRO_R7_NEVIZIBIL % (tag, tag)))[0], "ciorna_necunoscuta")
        # (M104) editorul r17 (orice eticheta de text, atribute pe lista alba) + textContent fara forma Quill: <b></b> / <code> goale pleaca
        # (fiecare strat singur e dublat de celalalt: lista p / br prinde elementul, forma Quill prinde orice eticheta -> echivalenti separat)
        mut = mutant(REGULI_R17_IN_EDITOR)
        for f in (lambda c: quill_html(c) + "<b></b>", lambda c: "<p>%s<code></code></p>" % c, lambda c: "<p><strong>%s</strong></p>" % c):
            self.assertEqual(self.scrie(gp, cap(), html_editor=f)[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=f(BRIEF_TEST))
            with mock.patch.object(mut, "_text_editor", _text_editor_lejer):
                self.assertEqual(self.scrie(mut, cap(), html_editor=f)[:2], (None, ACTIUNI_TRIMITERE), msg=f(BRIEF_TEST))
        # (M105) atributele permise pe p in editor (regula "fara niciun atribut" scoasa): p[data-test-id=empty-disclaimer] pleaca
        mut = mutant([("        if r[0] is None and n.attrs:", "        if False:")])
        f = lambda c: '<p data-test-id="empty-disclaimer">%s</p>' % c
        self.assertEqual(self.scrie(gp, cap(), html_editor=f)[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
        self.assertEqual(self.scrie(mut, cap(), html_editor=f)[:2], (None, ACTIUNI_TRIMITERE))
        # starile reale trec pe fiecare mutant r18
        for inl in (REGULI_R17_NEVIZIBILE, REGULI_R17_IN_EDITOR, [("        if r[0] is None and n.attrs:", "        if False:")],
                    REGULI_M100_INNER_TEXT, REGULI_M101_DOUA_CITIRI, REGULI_M102_ASTEPTARE):
            m = mutant(inl)
            for s in ("mediu", "lung"):
                self.assertEqual(self.scrie(m, cap(s))[:2], (None, ACTIUNI_TRIMITERE), msg=(inl[0][1][:60], s))

    def test_starile_reale_trec_r18(self):
        # regresie (L20): captura netaiata (gol -> mediu / lung), 21.11 i-iii, 22.11 i-iii (si 5g), 23.11: Enter, cu textul citit din HTML
        for s in ("mediu", "lung"):
            cod, act, pg = self.scrie(gp, html_captura(s))
            self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE), msg=s)
            self.assertEqual(_invariant_instantaneu(pg), (True, ""))
            i = self.an(pg.citite[-1])
            self.assertEqual((i["editoare"], i["necunoscute"], i["text_editor"]), (1, 0, BRIEF_TEST), msg=s)
        for html in [pagina_calibrare(x) for x in ("i", "ii", "iii")] + [pagina_22_11_completa(x) for x in ("i", "ii", "iii")] + \
                [pagina_22_11_completa(x, fdi=FDI_5G) for x in ("i", "ii", "iii")] + [pagina_23_11(), chat_nou_gol_23_11()] + \
                [html_captura(s) for s in ("gol", "mediu", "lung")]:
            i = self.an(html)
            self.assertEqual((i["editoare"], i["zone"], i["necunoscute"]), (1, 1, 0), msg=i["necunoscute_detalii"])
            pg = FakePg(html, dupa_goto=html)
            self.assertEqual(ruleaza_trimite(gp, pg), (None, ACTIUNI_TRIMITERE))
            self.assertEqual(_invariant_instantaneu(pg), (True, ""))
        # ciorna goala reala (<p><br></p>) = text gol, nicio abatere de forma
        self.assertEqual(self.an(html_captura("gol"))["text_editor"], "")


# --- r19 (Jakarinos NO-GO r8 pe 426e2436): shadow DOM nevazut de page.content() -> un singur evaluate cu HTML + numaratorile shadow ---
# reproducerea din verdict (in simulare, ca la Jakarinos): HTML-ul serializat = captura reala NESCHIMBATA (gazda = un div permis, gol in
# HTML), iar shadow root-ul ei (cu <div contenteditable="true"><p>continut strain arbitrar</p></div>) se vede DOAR in numaratori
UMBRA_ZONA = dict(UMBRE_ZERO, shadow_pagina=1, shadow_zona=1)          # gazda in zona: shadow root-ul e si in pagina
UMBRA_PAGINA = dict(UMBRE_ZERO, shadow_pagina=1)                       # shadow root in pagina, in afara zonei (pagina reala: 0)
CUSTOM_ZONA = dict(UMBRE_ZERO, custom_pagina=1, custom_zona=1)         # element custom inregistrat in zona (poate avea shadow inchis)
CUSTOM_PAGINA = dict(UMBRE_ZERO, custom_pagina=1)                      # doar afisat in `stare`, nu decide
LINIA_UMBRE = '    if umbre["shadow_pagina"] or umbre["shadow_zona"] or umbre["custom_zona"]:'
REGULI_M106_FARA_UMBRE = [(LINIA_UMBRE, "    if False:")]
REGULI_M107_DOAR_ZONA = [(LINIA_UMBRE, '    if umbre["shadow_zona"] or umbre["custom_zona"]:')]
REGULI_M108_FARA_CUSTOM = [(LINIA_UMBRE, '    if umbre["shadow_pagina"] or umbre["shadow_zona"]:')]
# r20: M109 / M110 (instantaneul) sunt acum mutantii instantaneului CDP (mai jos, MUTANTI_R20); aici raman mutantii stratului evaluate
MUTANTI_R19 = (("M106", REGULI_M106_FARA_UMBRE), ("M107", REGULI_M107_DOAR_ZONA), ("M108", REGULI_M108_FARA_CUSTOM))
# (M109) instantaneul fara umbre (= ce vedea r19 in HTML: subarborii shadow, si cei INCHISI, nu exista)
REGULI_M109_FARA_UMBRE_CDP = [('        for s in _lista_cdp(c, "shadowRoots"):\r\n', "        for s in []:\r\n")]
# (M110) doua instantanee in ultima paza: umbrele dintr-unul, arborele din altul
REGULI_M110_DOUA_INSTANTANEE = [("    info, umbre = _instantaneu(pg)\r\n    verifica_umbre_cdp(umbre, \"inainte_de_enter\")\r\n",
                                 "    umbre = _instantaneu(pg)[1]\r\n    verifica_umbre_cdp(umbre, \"inainte_de_enter\")\r\n"
                                 "    info = _instantaneu(pg)[0]\r\n")]


def umbre_dupa_scriere(u):
    # shadow DOM aparut DOAR la ultima paza (dupa scriere); paza dinainte de chatul nou si cea de pe chatul nou il vad curat
    return lambda pg: u if pg.scris else UMBRE_ZERO


class TestUmbreR19(unittest.TestCase):
    """r19: (1) orice shadow root deschis (in zona, pe stramosii editorului SAU oriunde in pagina) si orice element custom inregistrat in
    zona = refuz, din ACELASI pg.evaluate care intoarce HTML-ul analizat (nicio citire page.content() in cod). (2) Forma rezultatului
    verificata strict. (3) Starile reale (0) trec. Asteptarile sunt scrise de mana; reproducerea e cea din verdict."""

    def scrie(self, mod, umbre, s="mediu", **kw):
        g = html_captura(s)
        pg = FakePg(g, dupa_goto=g, umbre=umbre, **kw)
        cod, det, act = trimite_brief(mod, pg, BRIEF_TEST)
        return cod, act, pg, det

    def test_reproducerea_verdict_r8(self):
        for s in ("gol", "mediu", "lung"):
            h = html_captura(s)
            i = gp.analizeaza_ciorna(h)
            # HTML-ul singur: exact ce a masurat Jakarinos (editoare=1, atasamente=0, semne=0, necunoscute=0)
            self.assertEqual((i["editoare"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 0, 0, 0), msg=s)
            # shadow root prezent de la inceput: refuz la prima paza, nicio actiune
            self.assertEqual(ruleaza_trimite(gp, FakePg(h, umbre=UMBRA_ZONA)), ("ciorna_necunoscuta", []), msg=s)
            # aparut doar la ultima paza: refuz inainte de Enter
            cod, act, pg, det = self.scrie(gp, umbre_dupa_scriere(UMBRA_ZONA), s)
            self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=s)
            self.assertEqual(det, "inainte_de_enter: shadow DOM nevazut de analiza (shadow root: pagina 1, zona 1; custom inregistrate"
                                  " in zona 0) - nu trimit")
            self.assertEqual(_invariant_instantaneu(pg), (True, ""))
            # pe instantaneul r18 (fara numaratorile evaluate si fara umbrele CDP: M106 + M109): Enter (= ocolirea din verdict)
            cod, act, pg, det = self.scrie(mutant(REGULI_M106_FARA_UMBRE + REGULI_M109_FARA_UMBRE_CDP), umbre_dupa_scriere(UMBRA_ZONA), s,
                                           cdp_doc=umbra_dupa_scriere("open"))
            self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE), msg=s)
            # r20: aceeasi umbra deschisa vazuta si de CDP: refuz si fara stratul evaluate (M106)
            cod, act, pg, det = self.scrie(mutant(REGULI_M106_FARA_UMBRE), umbre_dupa_scriere(UMBRA_ZONA), s, cdp_doc=umbra_dupa_scriere("open"))
            self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=s)

    def test_shadow_in_pagina_in_afara_zonei_refuz(self):
        # pagina reala are 0 shadow root-uri -> si unul in afara zonei = refuz sigur
        for s in ("gol", "mediu", "lung"):
            self.assertEqual(ruleaza_trimite(gp, FakePg(html_captura(s), umbre=UMBRA_PAGINA)), ("ciorna_necunoscuta", []), msg=s)
            self.assertEqual(self.scrie(gp, umbre_dupa_scriere(UMBRA_PAGINA), s)[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=s)
        # pe chatul nou (dupa navigare): refuz inainte de click
        cod, act, pg, det = self.scrie(gp, lambda pg: UMBRA_PAGINA if "goto" in pg.act else UMBRE_ZERO)
        self.assertEqual((cod, act), ("ciorna_necunoscuta", ["goto"]))
        self.assertTrue(det.startswith("pe_chatul_nou: shadow DOM"), det)

    def test_custom_inregistrat_in_zona_refuz_in_pagina_afisat(self):
        for s in ("mediu", "lung"):
            self.assertEqual(self.scrie(gp, umbre_dupa_scriere(CUSTOM_ZONA), s)[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=s)
            self.assertEqual(self.scrie(gp, CUSTOM_PAGINA, s)[:2], (None, ACTIUNI_TRIMITERE), msg=s)

    def test_starile_reale_trec_r19(self):
        # starile reale (0 shadow, 0 custom): Enter; evaluate primeste EXACT JS_UMBRE (r20: fara HTML)
        for s in ("mediu", "lung"):
            cod, act, pg, det = self.scrie(gp, None, s)
            self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE), msg=s)
            self.assertEqual(_invariant_instantaneu(pg), (True, ""))
            self.assertEqual(pg.js_evaluate, [gp.JS_UMBRE] * 3)                   # inainte de chat nou, pe chatul nou, ultima paza
            self.assertNotIn("content", pg.jurnal)
        for html in [pagina_calibrare(x) for x in ("i", "ii", "iii")] + [pagina_22_11_completa(x) for x in ("i", "ii", "iii")] + \
                [pagina_23_11(), chat_nou_gol_23_11()]:
            self.assertEqual(ruleaza_trimite(gp, FakePg(html, dupa_goto=html, umbre=UMBRE_ZERO)), (None, ACTIUNI_TRIMITERE))
        # `stare`: numaratorile pe linia lor; 0 -> paza OK, shadow -> REFUZ
        for u, linie, paza in ((UMBRE_ZERO, "shadow root: pagina 0 / zona 0 | custom inregistrate: pagina 0 / zona 0", "paza ciorna: OK"),
                               (UMBRA_ZONA, "shadow root: pagina 1 / zona 1 | custom inregistrate: pagina 0 / zona 0", "paza ciorna: REFUZ"),
                               (CUSTOM_PAGINA, "shadow root: pagina 0 / zona 0 | custom inregistrate: pagina 1 / zona 0", "paza ciorna: OK")):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                gp.stare(FakePg(html_captura("lung"), umbre=u))
            l = out.getvalue().splitlines()
            self.assertIn(linie, l)
            self.assertTrue(any(x.startswith(paza) for x in l), msg=l[-1])

    def test_forma_rezultatului_evaluate(self):
        # orice abatere a rezultatului = ciorna_necitibila, nimic trimis (la prima paza: nicio actiune; la ultima: fara Enter)
        # r20: fara HTML in rezultat (un "html" in plus = cheie in plus = refuz)
        forme = (lambda r: None, lambda r: [r], lambda r: 0, lambda r: {k: v for k, v in r.items() if k != "shadow_zona"},
                 lambda r: dict(r, extra=0), lambda r: dict(r, shadow_pagina=0.0), lambda r: dict(r, shadow_zona=False),
                 lambda r: dict(r, custom_zona=-1), lambda r: dict(r, shadow_pagina="0"), lambda r: dict(r, html="<html></html>"),
                 lambda r: dict(r, custom_pagina=None))
        for f in forme:
            pg = FakePg(html_captura("mediu"), rezultat_evaluate=lambda pg, r, f=f: f(r))
            self.assertEqual(ruleaza_trimite(gp, pg), ("ciorna_necitibila", []))
            g = html_captura("mediu")
            pg = FakePg(g, dupa_goto=g, rezultat_evaluate=lambda pg, r, f=f: f(r) if pg.scris else r)
            self.assertEqual(trimite_brief(gp, pg, BRIEF_TEST)[::2], ("ciorna_necitibila", ACTIUNI_FARA_ENTER))

    def test_un_singur_evaluate_pe_tipare_de_umbre(self):
        # umbrele se schimba intre citiri (citirea k dupa scriere: curat / shadow in zona / shadow in pagina / custom in zona): decizia =
        # starea din citirea dinaintea instantaneului (ultima paza: evaluate, apoi CDP); invariantul (un instantaneu) tine pe cod
        import itertools
        stari = {"curat": UMBRE_ZERO, "zona": UMBRA_ZONA, "pagina": UMBRA_PAGINA, "custom": CUSTOM_ZONA}

        def tipar(t):
            return lambda pg: UMBRE_ZERO if not pg.scris or pg.n_dupa >= len(t) else stari[t[pg.n_dupa]]
        for t in itertools.product(stari, repeat=2):
            cod, act, pg, det = self.scrie(gp, tipar(t))
            self.assertEqual(_invariant_instantaneu(pg), (True, ""), msg=t)
            self.assertEqual(cod, None if t[0] == "curat" else "ciorna_necunoscuta", msg=t)

    def test_mutanti_r19_lasa_brief_ul_sa_plece(self):
        # fiecare mutant rupe scenariul lui (Enter), codul refuza; starile reale trec pe fiecare mutant
        cazuri = {"M106": UMBRA_ZONA, "M107": UMBRA_PAGINA, "M108": CUSTOM_ZONA}      # doar numaratorile evaluate (CDP fara umbre)
        for nume, inl in MUTANTI_R19:
            mut = mutant(inl)
            if nume in cazuri:
                u = umbre_dupa_scriere(cazuri[nume])
                self.assertEqual(self.scrie(gp, u)[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=nume)
                self.assertEqual(self.scrie(mut, u)[:2], (None, ACTIUNI_TRIMITERE), msg=nume)
            for s in ("mediu", "lung"):
                self.assertEqual(self.scrie(mut, UMBRE_ZERO, s)[:2], (None, ACTIUNI_TRIMITERE), msg=(nume, s))

    def test_structural_r19(self):
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        cod = [l for l in (x.rstrip("\r") for x in src.split("\n")) if not l.lstrip().startswith("#")]
        self.assertFalse([l for l in cod if ".content(" in l])                       # nicio citire page.content() in cod
        self.assertEqual(sum(l.count(".evaluate(") for l in cod), 1)                   # singurul evaluate: in _umbre_js (r20)
        self.assertIn("    r = pg.evaluate(JS_UMBRE)", cod)
        self.assertEqual(sum(l.count("_instantaneu(") for l in cod), 3)               # definitia + _citeste_ciorna + _ultima_paza
        self.assertEqual(sum(l.count("verifica_fara_umbre(") for l in cod), 4)        # definitia + _paza_ciorna + _ultima_paza + stare
        self.assertEqual(gp.CHEI_UMBRE, ("shadow_pagina", "shadow_zona", "custom_pagina", "custom_zona"))
        js = gp.JS_UMBRE
        for parte in ("const Z = " + json.dumps(gp.ZONA), "E = " + json.dumps(gp.EDITOR),
                      "if (el.shadowRoot) { sp++; if (z) sz++; parcurge(el.shadowRoot, z); }", "parcurge(document, false);",
                      "ce.getName(el.constructor)", "ce.get(el.localName)", "ce.get(el.getAttribute('is'))",
                      "stramosi.has(el) || zone.some((z) => z.contains(el))",
                      "return { shadow_pagina: sp, shadow_zona: sz, custom_pagina: cp, custom_zona: cz };"):
            self.assertIn(parte, js)
        self.assertNotIn("outerHTML", js)                                             # r20: HTML-ul nu mai vine din pagina
        self.assertFalse(hasattr(gp, "JS_INSTANTANEU"))
        js.encode("ascii")


# --- r20 (Jakarinos NO-GO r9 pe 5a1e2613): shadow root INCHIS pe un div standard -> instantaneul = un DOM.getDocument(pierce) CDP ---
# reproducerea din verdict, copiata: un div standard din zona cu attachShadow({mode: 'closed'}) si continut strain; JavaScript-ul paginii
# NU il vede (evaluate: 0 / 0 / 0 / 0), HTML-ul nu il are; CDP il intoarce in shadowRoots cu shadowRootType "closed" (Edge 157, sonda_cdp.py)
REPRO_R9_INTERIOR = '<div contenteditable="true"><p>continut strain arbitrar</p></div>'


def _primul(doc, tag, sub=None):
    # primul element CDP cu localName `tag` (sub elementul `sub`, daca e dat)
    return next(x for x in noduri_cdp(sub or doc["root"]) if x is not sub and x.get("localName") == tag)


def div_din_zona(doc):
    return _primul(doc, "div", _primul(doc, "input-area-v2"))


def cu_umbra(gazda, tip, interior=REPRO_R9_INTERIOR, cand=lambda pg: True):
    # cdp_doc: shadow root `tip` pe gazda(doc) (un element CDP), cand cand(pg) e adevarat
    def f(pg, doc):
        if cand(pg):
            g = gazda(doc)
            copii = html_in_cdp("<x>" + interior + "</x>")["root"]["children"][0]["children"] if interior else []
            g.setdefault("shadowRoots", []).append({"nodeType": 11, "nodeName": "#document-fragment", "shadowRootType": tip,
                                                    "children": copii})
        return doc
    return f


def umbra_dupa_scriere(tip, gazda=div_din_zona):
    # umbra aparuta DOAR la ultima paza (dupa scriere)
    return cu_umbra(gazda, tip, cand=lambda pg: pg.scris)


def cu_iframe(interior_cdp, cand=lambda pg: True):
    # un iframe in body (in afara zonei), cu documentul lui (contentDocument) = interior_cdp(): ca iframe-urile din acelasi proces
    def f(pg, doc):
        if cand(pg):
            ifr = {"nodeType": 1, "nodeName": "IFRAME", "localName": "iframe", "attributes": [], "children": [],
                   "contentDocument": {"nodeType": 9, "nodeName": "#document", "children": [interior_cdp()]}}
            _primul(doc, "body")["children"].append(ifr)
        return doc
    return f


def img_in_afara(doc):
    # ca pe pagina reala (23.11): un <img> in afara zonei (poza de profil din istoric) - adaugat in body, intors ca gazda. (body insusi
    # e un stramos al editorului, deci "in zona" pentru regula stramosilor, ca in JS_UMBRE)
    b = _primul(doc, "body")
    x = next((y for y in b["children"] if y.get("localName") == "img"), None)
    if x is None:
        x = {"nodeType": 1, "nodeName": "IMG", "localName": "img", "attributes": [], "children": []}
        b["children"].append(x)
    return x


def _doc_cu_div_inchis():
    d = html_in_cdp("<html><body><div></div></body></html>")["root"]["children"][0]
    _primul({"root": d}, "div").setdefault("shadowRoots", []).append(
        {"nodeType": 11, "nodeName": "#document-fragment", "shadowRootType": "closed", "children": []})
    return d


def _index_clipboard(stare):
    return next(i for i, (ad, tag, atr, text) in enumerate(CAPTURA_2311[stare]) if ("class", "ql-clipboard") in atr)


LINIA_CDP_TIP = '            umbre[TIPURI_UMBRE.get(tip, "alt_tip")] += 1\r\n'
# (M111) DOM.enable fara includeWhitespace (Chromium sare textele din doar spatii)
REGULI_M111_FARA_SPATII = [('        cdp.send("DOM.enable", {"includeWhitespace": "all"})\r\n', '        cdp.send("DOM.enable", {})\r\n')]
# (M112) user-agent in zona acceptat
REGULI_M112_UA_ZONA = [('    if umbre["deschise"] or umbre["inchise"] or umbre["alt_tip"] or umbre["ua_zona"]:',
                        '    if umbre["deschise"] or umbre["inchise"] or umbre["alt_tip"]:')]
# (M113) doar shadow root-urile deschise refuzate (cele inchise = ca in r19)
REGULI_M113_FARA_INCHISE = [(LINIA_CDP_TIP, '            umbre[TIPURI_UMBRE.get(tip, "alt_tip")] += 1 if tip != "closed" else 0\r\n')]
# (M114) documentele iframe nu se parcurg
REGULI_M114_FARA_IFRAME = [('            st.extend((y, None, a) for y in reversed(_lista_cdp(d, "children")))\r\n', "            pass\r\n")]
# (M115) tipurile necunoscute acceptate (doar open / closed refuzate)
REGULI_M115_ALT_TIP = [(LINIA_CDP_TIP, '            umbre[TIPURI_UMBRE.get(tip, "documente_iframe")] += 1\r\n')]
# (M116) verificarea liniilor brief-ului scoasa (o linie > 10000 ajunge in editor, taiata in instantaneu)
REGULI_M116_FARA_LINII = [('    if any(len(l.rstrip("\\r")) > LIMITA_TEXT_CDP for l in text.split("\\n")):', "    if False:")]
# (M117) continutul shadow root-urilor (open / closed) nu se parcurge: cele imbricate nu se numara
REGULI_M117_FARA_IMBRICATE = [('            st.extend((y, None, a) for y in reversed(_lista_cdp(s, "children")))\r\n', "            pass\r\n")]
MUTANTI_R20 = (("M109", REGULI_M109_FARA_UMBRE_CDP), ("M110", REGULI_M110_DOUA_INSTANTANEE), ("M111", REGULI_M111_FARA_SPATII),
               ("M112", REGULI_M112_UA_ZONA), ("M113", REGULI_M113_FARA_INCHISE), ("M114", REGULI_M114_FARA_IFRAME),
               ("M115", REGULI_M115_ALT_TIP), ("M116", REGULI_M116_FARA_LINII), ("M117", REGULI_M117_FARA_IMBRICATE))


class TestUmbreCdpR20(unittest.TestCase):
    """r20: instantaneul = UN apel CDP DOM.getDocument(depth -1, pierce) (dupa DOM.enable cu includeWhitespace "all"): arborele analizat,
    textul editorului, atasamentele, necunoscutele si shadow root-urile (si cele INCHISE) din acelasi raspuns. Orice shadow root open /
    closed / alt tip oriunde (si imbricat, si in iframe) = refuz; user-agent doar in afara zonei. CDP indisponibil / forma gresita = refuz.
    Asteptarile sunt scrise de mana; reproducerea e cea din verdict."""

    def scrie(self, mod, s="mediu", brief=BRIEF_TEST, **kw):
        g = html_captura(s)
        pg = FakePg(g, dupa_goto=g, **kw)
        cod, det, act = trimite_brief(mod, pg, brief)
        return cod, act, pg, det

    def an_cdp(self, html, cdp_doc=None):
        doc = html_in_cdp(html)
        if cdp_doc:
            doc = cdp_doc(None, doc)
        rad, umbre, trunchiate = gp._arbore_cdp(doc)
        return gp.analizeaza_arbore(rad, trunchiate), umbre

    def test_reproducerea_verdict_r9(self):
        for s in ("gol", "mediu", "lung"):
            h = html_captura(s)
            # JavaScript-ul paginii nu vede umbra inchisa (evaluate 0), HTML-ul nu o are: exact ce a masurat Jakarinos
            i = gp.analizeaza_ciorna(h)
            self.assertEqual((i["editoare"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 0, 0, 0), msg=s)
            info, u = self.an_cdp(h, cu_umbra(div_din_zona, "closed"))
            self.assertEqual((info["editoare"], info["atasamente"], info["semne"], info["necunoscute"]), (1, 0, 0, 0), msg=s)
            self.assertEqual(u, {"deschise": 0, "inchise": 1, "alt_tip": 0, "ua_pagina": 0, "ua_zona": 0, "documente_iframe": 0})
            # prezenta de la inceput: refuz la prima paza, nicio actiune
            self.assertEqual(ruleaza_trimite(gp, FakePg(h, cdp_doc=cu_umbra(div_din_zona, "closed"))), ("ciorna_necunoscuta", []), msg=s)
            # aparuta doar la ultima paza: refuz inainte de Enter, din acelasi instantaneu
            cod, act, pg, det = self.scrie(gp, s, cdp_doc=umbra_dupa_scriere("closed"))
            self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=s)
            self.assertEqual(det, "inainte_de_enter: shadow DOM in pagina (CDP: deschise 0, inchise 1, alt tip 0; user-agent in zona 0)"
                                  " - nu trimit")
            self.assertEqual(_invariant_instantaneu(pg), (True, ""))
            self.assertEqual(pg.ultimele_umbre, UMBRE_ZERO)                      # evaluate (r19) a vazut 0: doar CDP o prinde
            # pe instantaneul fara umbre (M109 = ce vedea r19): Enter (= ocolirea din verdict)
            cod, act, pg, det = self.scrie(mutant(REGULI_M109_FARA_UMBRE_CDP), s, cdp_doc=umbra_dupa_scriere("closed"))
            self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE), msg=s)

    def test_umbra_inchisa_in_afara_zonei_si_alte_tipuri_refuz(self):
        body = lambda d: _primul(d, "body")
        rich = lambda d: _primul(d, "rich-textarea")
        for gazda, tip, mesaj in ((body, "closed", "deschise 0, inchise 1, alt tip 0"), (body, "open", "deschise 1, inchise 0, alt tip 0"),
                                  (div_din_zona, "open", "deschise 1, inchise 0, alt tip 0"), (rich, "closed", "deschise 0, inchise 1, alt tip 0"),
                                  (body, "nou-tip", "deschise 0, inchise 0, alt tip 1"), (body, None, "deschise 0, inchise 0, alt tip 1")):
            for s in ("mediu", "lung"):
                self.assertEqual(ruleaza_trimite(gp, FakePg(html_captura(s), cdp_doc=cu_umbra(gazda, tip, ""))), ("ciorna_necunoscuta", []))
                cod, act, pg, det = self.scrie(gp, s, cdp_doc=umbra_dupa_scriere(tip, gazda))
                self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=(tip, s))
                self.assertIn("(CDP: " + mesaj + "; user-agent in zona 0)", det)
        # pe chatul nou (dupa navigare): refuz inainte de click
        cod, act, pg, det = self.scrie(gp, cdp_doc=cu_umbra(body, "closed", "", cand=lambda pg: "goto" in pg.act))
        self.assertEqual((cod, act), ("ciorna_necunoscuta", ["goto"]))
        self.assertTrue(det.startswith("pe_chatul_nou: shadow DOM in pagina (CDP"), det)

    def test_umbre_imbricate_si_in_iframe(self):
        # inchisa in interiorul unei umbre deschise / inchise; inchisa in documentul unui iframe (in afara zonei): toate numarate, refuz
        imbr = '<div id="i"></div>'
        for ext in ("open", "closed"):
            def f(pg, doc, ext=ext):
                cu_umbra(div_din_zona, ext, imbr)(pg, doc)
                interior = div_din_zona(doc)["shadowRoots"][0]["children"][0]
                interior["shadowRoots"] = [{"nodeType": 11, "nodeName": "#document-fragment", "shadowRootType": "closed", "children": []}]
                return doc
            info, u = self.an_cdp(html_captura("mediu"), f)
            self.assertEqual((u["deschise"], u["inchise"]), (1, 1) if ext == "open" else (0, 2), msg=ext)
        info, u = self.an_cdp(html_captura("mediu"), cu_iframe(_doc_cu_div_inchis))
        self.assertEqual((u["inchise"], u["documente_iframe"], info["necunoscute"]), (1, 1, 0))
        cod, act, pg, det = self.scrie(gp, cdp_doc=cu_iframe(_doc_cu_div_inchis, cand=lambda pg: pg.scris))
        self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
        # iframe gol (fara umbre) in afara zonei: trece (pagina reala: 3 documente iframe)
        gol = lambda: html_in_cdp("<html><body><p>x</p></body></html>")["root"]["children"][0]
        cod, act, pg, det = self.scrie(gp, cdp_doc=cu_iframe(gol))
        self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE))
        # M114 (iframe-urile neparcurse): Enter cu umbra inchisa din iframe; M117 (umbre imbricate neparcurse): doar cea exterioara numarata
        cod, act, pg, det = self.scrie(mutant(REGULI_M114_FARA_IFRAME), cdp_doc=cu_iframe(_doc_cu_div_inchis, cand=lambda pg: pg.scris))
        self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE))

    def test_user_agent_in_afara_zonei_ok_in_zona_refuz(self):
        # pagina reala: un shadow root user-agent, pe un <img> din istoric (in afara zonei) -> trece; continutul lui nu se parcurge
        for s in ("mediu", "lung"):
            cod, act, pg, det = self.scrie(gp, s, cdp_doc=cu_umbra(img_in_afara, "user-agent", REPRO_R9_INTERIOR))
            self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE), msg=s)
            self.assertEqual(_invariant_instantaneu(pg), (True, ""))
        info, u = self.an_cdp(html_captura("mediu"), cu_umbra(img_in_afara, "user-agent"))
        self.assertEqual((u["ua_pagina"], u["ua_zona"], info["necunoscute"], info["editoare"]), (1, 0, 0, 1))
        # in zona (pe un div din zona / pe rich-textarea = stramos al editorului / pe zona insasi / pe body = stramos al editorului): refuz
        for gazda in (div_din_zona, lambda d: _primul(d, "rich-textarea"), lambda d: _primul(d, "input-area-v2"), lambda d: _primul(d, "body")):
            info, u = self.an_cdp(html_captura("mediu"), cu_umbra(gazda, "user-agent"))
            self.assertEqual((u["ua_pagina"], u["ua_zona"]), (1, 1))
            cod, act, pg, det = self.scrie(gp, cdp_doc=umbra_dupa_scriere("user-agent", gazda))
            self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
            self.assertIn("user-agent in zona 1", det)
            self.assertEqual(self.scrie(mutant(REGULI_M112_UA_ZONA), cdp_doc=umbra_dupa_scriere("user-agent", gazda))[:2],
                             (None, ACTIUNI_TRIMITERE))

    def test_spatiile_se_vad_doar_cu_include_whitespace(self):
        # div.ql-clipboard cu un spatiu (permis DOAR gol, r17): cu DOM.enable({includeWhitespace: "all"}) refuz; M111 (Chromium sare
        # textul din doar spatii) -> clipboard-ul pare gol -> Enter
        for s in ("mediu", "lung"):
            h = html_captura(s, interior=((_index_clipboard(s), " "),))
            self.assertEqual(gp.analizeaza_ciorna(h)["necunoscute_detalii"], [SEM_CLIPBOARD], msg=s)
            self.assertEqual(ruleaza_trimite(gp, FakePg(h)), ("ciorna_necunoscuta", []), msg=s)
            pg = FakePg(h, dupa_goto=h)
            self.assertEqual(trimite_brief(gp, pg, BRIEF_TEST)[::2], ("ciorna_necunoscuta", []))
            self.assertEqual(trimite_brief(mutant(REGULI_M111_FARA_SPATII), FakePg(h, dupa_goto=h), BRIEF_TEST)[::2], (None, ACTIUNI_TRIMITERE))
        # parametrii trimisi: exact DOM.enable {includeWhitespace: all}, apoi DOM.getDocument {depth -1, pierce true}, apoi detach
        cod, act, pg, det = self.scrie(gp)
        self.assertEqual(pg.cdp_trimise, [("DOM.enable", {"includeWhitespace": "all"}), ("DOM.getDocument", {"depth": -1, "pierce": True})] * 3)
        self.assertEqual([x for x in pg.jurnal if x.startswith("cdp")],
                         ["cdp sesiune", "cdp DOM.enable", "cdp DOM.getDocument", "cdp detach"] * 3)

    def test_text_trunchiat_de_cdp(self):
        # un text > 10000 de caractere vine taiat: in zona = necunoscut explicit (si textul strain); in afara zonei (head / istoric) = ok
        lung = "x" * 12000
        h = html_captura("mediu", extra_zona="<span>" + lung + "</span>")
        info, u = self.an_cdp(h)
        self.assertIn("text_trunchiat_cdp:10001 caractere citite", info["necunoscute_detalii"])
        self.assertEqual(ruleaza_trimite(gp, FakePg(h)), ("ciorna_necunoscuta", []))
        h = html_captura("mediu").replace("<body>", "<body><style>" + lung + "</style><p>" + lung + "</p>", 1)
        self.assertIn(lung, h)
        self.assertEqual(self.an_cdp(h)[0]["necunoscute"], 0)
        self.assertEqual(ruleaza_trimite(gp, FakePg(h, dupa_goto=h)), (None, ACTIUNI_TRIMITERE))
        # in editor: o linie de 10001 caractere = brief_invalid inainte de orice actiune; 10000 = trimisa (CDP nu o taie)
        for n, asteptat in ((10001, ("brief_invalid", [])), (10000, (None, ACTIUNI_TRIMITERE))):
            brief = "Intrebare:\n" + "y" * n + "\nsfarsit"
            cod, act, pg, det = self.scrie(gp, brief=brief)
            self.assertEqual((cod, act), asteptat, msg=n)
        # M116 (fara verificarea liniilor): linia de 10001 e scrisa, instantaneul o arata taiata -> refuz abia la ultima paza
        cod, act, pg, det = self.scrie(mutant(REGULI_M116_FARA_LINII), brief="Intrebare:\n" + "y" * 10001)
        self.assertEqual((cod, act), ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER))
        self.assertIn("text_trunchiat_cdp:10001 caractere citite", det)

    def test_cdp_indisponibil_sau_forma_gresita_refuz(self):
        # new_cdp_session esueaza: refuz (nicio cale de rezerva)
        self.assertEqual(ruleaza_trimite(gp, FakePg(html_captura("mediu"), cdp_indisponibil=True)), ("ciorna_necitibila", []))
        g = html_captura("mediu")

        class Indisponibil(FakeCtx):
            def new_cdp_session(self, pagina):
                if self.pg.scris:
                    raise RuntimeError("Target closed")
                return FakeCtx.new_cdp_session(self, pagina)
        pg = FakePg(g, dupa_goto=g)
        pg.context = Indisponibil(pg)
        self.assertEqual(trimite_brief(gp, pg, BRIEF_TEST)[::2], ("ciorna_necitibila", ACTIUNI_FARA_ENTER))

        def ed(doc):
            return next(x for x in noduri_cdp(doc["root"]) if atr_cdp(x).get("role") == "textbox")
        forme = (lambda d: None, lambda d: [], lambda d: {"root": None}, lambda d: {"root": dict(d["root"], nodeType=1)},
                 lambda d: {"root": dict(d["root"], children={})}, lambda d: {"root": dict(d["root"], children=[1])},
                 lambda d: (ed(d).__setitem__("attributes", ed(d)["attributes"] + ["x"]), d)[1],
                 lambda d: (ed(d).__setitem__("attributes", ed(d)["attributes"] + ["x", None]), d)[1],
                 lambda d: (ed(d).__setitem__("attributes", ed(d)["attributes"] + ["ROLE", "textbox"]), d)[1],
                 lambda d: (ed(d).__setitem__("localName", ""), d)[1], lambda d: (ed(d).pop("localName"), d)[1],
                 lambda d: (ed(d)["children"].append({"nodeType": 3}), d)[1],
                 lambda d: (ed(d)["children"].append({"nodeType": 2, "nodeName": "x"}), d)[1],
                 lambda d: (ed(d).__setitem__("shadowRoots", {}), d)[1],
                 lambda d: (ed(d).__setitem__("contentDocument", {"nodeType": 1}), d)[1],
                 lambda d: (ed(d).__setitem__("templateContent", []), d)[1])
        for k, f in enumerate(forme):
            pg = FakePg(html_captura("mediu"), rezultat_cdp=lambda pg, d, f=f: f(d))
            self.assertEqual(ruleaza_trimite(gp, pg), ("ciorna_necitibila", []), msg=k)
            pg = FakePg(g, dupa_goto=g, rezultat_cdp=lambda pg, d, f=f: f(d) if pg.scris else d)
            self.assertEqual(trimite_brief(gp, pg, BRIEF_TEST)[::2], ("ciorna_necitibila", ACTIUNI_FARA_ENTER), msg=k)

        # o eroare CDP la DOM.enable / DOM.getDocument: refuz
        class Rau(FakeCDP):
            def send(self, metoda, param=None):
                if metoda == self.pg.metoda_rea:
                    raise RuntimeError("Protocol error")
                return FakeCDP.send(self, metoda, param)

        class CtxRau(FakeCtx):
            def new_cdp_session(self, pagina):
                FakeCtx.new_cdp_session(self, pagina)
                return Rau(self.pg)
        for m in ("DOM.enable", "DOM.getDocument"):
            pg = FakePg(html_captura("mediu"))
            pg.metoda_rea, pg.context = m, CtxRau(pg)
            self.assertEqual(ruleaza_trimite(gp, pg), ("ciorna_necitibila", []), msg=m)

    def test_arborele_cdp_egal_cu_cel_html_pe_toate_capturile(self):
        # aceeasi analiza din arborele CDP ca din HTML (aceleasi _Nod), pe toate paginile reale si pe reproducerile negative din suita
        pagini = [pagina_calibrare(x) for x in ("i", "ii", "iii")] + [pagina_22_11_completa(x) for x in ("i", "ii", "iii")] + \
            [pagina_22_11_completa(x, fdi=FDI_5G) for x in ("i", "ii", "iii")] + [pagina_23_11(), chat_nou_gol_23_11()] + \
            [html_captura(s) for s in ("gol", "mediu", "lung")] + \
            [html_captura("mediu", extra_zona=REPRO_R7_NEVIZIBIL % (t, t)) for t in NEVIZIBILE_R17] + \
            [pagina(["a.txt"]), pagina(conversatie=CONV_IMAGINI), html_captura("mediu", editor=TEXT_MEDIU + REPRO_R7_SPAN),
             html_captura("mediu", interior=((_index_clipboard("mediu"), " "),))]
        for h in pagini:
            a = gp.analizeaza_ciorna(h)
            b, u = self.an_cdp(h)
            self.assertEqual(a, b, msg=h[:80])
            self.assertEqual(u, dict((k, 0) for k in gp.CHEI_UMBRE_CDP))
        # template: continutul (templateContent in CDP) e copil al lui <template>, ca in HTMLParser
        h = html_captura("mediu", extra_zona="<template><span>continut strain arbitrar</span></template>")
        self.assertEqual(self.an_cdp(h)[0], gp.analizeaza_ciorna(h))
        self.assertIn("text:continut strain arbitrar", self.an_cdp(h)[0]["necunoscute_detalii"])
        # nume de tag / atribut cu majuscule (svg in CDP: clipPath, viewBox) -> litere mici, ca HTMLParser
        doc = html_in_cdp("<html><body></body></html>")
        _primul(doc, "body")["children"].append({"nodeType": 1, "nodeName": "clipPath", "localName": "clipPath",
                                                  "attributes": ["viewBox", "0 0 1 1"], "children": []})
        rad = gp._arbore_cdp(doc)[0]
        x = [n for n in gp._descendenti(rad) if n.tag != "#text"][-1]
        self.assertEqual((x.tag, x.attrs), ("clippath", {"viewbox": "0 0 1 1"}))
        # comentarii / doctype ignorate, CDATA = text
        doc = html_in_cdp("<html><body><p>a</p></body></html>")
        p = _primul(doc, "p")
        p["children"] += [{"nodeType": 8, "nodeName": "#comment", "nodeValue": "c"}, {"nodeType": 4, "nodeName": "#cdata-section", "nodeValue": "d"}]
        doc["root"]["children"].insert(0, {"nodeType": 10, "nodeName": "html"})
        rad = gp._arbore_cdp(doc)[0]
        self.assertEqual([(c.tag, c.date) for c in [n for n in gp._descendenti(rad) if n.tag == "p"][0].copii], [("#text", "a"), ("#text", "d")])

    def test_un_singur_instantaneu_pe_tipare_cdp(self):
        # umbrele CDP se schimba intre citiri (citirea k dupa scriere): decizia = SINGURA citire dupa scriere; M110 (doua) se rupe
        import itertools
        stari = ("curat", "inchisa_zona", "inchisa_pagina", "ua_zona")

        def tipar(t):
            def f(pg, doc):
                if not pg.scris or pg.n_dupa > len(t):
                    return doc
                st = t[pg.n_dupa - 1]
                if st == "inchisa_zona":
                    return cu_umbra(div_din_zona, "closed")(pg, doc)
                if st == "inchisa_pagina":
                    return cu_umbra(lambda d: _primul(d, "body"), "closed", "")(pg, doc)
                if st == "ua_zona":
                    return cu_umbra(div_din_zona, "user-agent", "")(pg, doc)
                return doc
            return f
        for t in itertools.product(stari, repeat=2):
            cod, act, pg, det = self.scrie(gp, cdp_doc=tipar(t))
            self.assertEqual(_invariant_instantaneu(pg), (True, ""), msg=t)
            self.assertEqual(cod, None if t[0] == "curat" else "ciorna_necunoscuta", msg=t)
        # M110: umbrele din primul instantaneu (curat), arborele din al doilea (cu umbra inchisa, nevazuta in arbore) -> Enter
        cod, act, pg, det = self.scrie(mutant(REGULI_M110_DOUA_INSTANTANEE), cdp_doc=tipar(("curat", "inchisa_zona")))
        self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE))
        self.assertFalse(_invariant_instantaneu(pg)[0])

    def test_mutanti_r20_lasa_brief_ul_sa_plece(self):
        # fiecare mutant rupe scenariul lui (Enter), codul refuza; starile reale trec pe fiecare mutant
        tip_nou = umbra_dupa_scriere("nou-tip")
        cazuri = {"M109": dict(cdp_doc=umbra_dupa_scriere("closed")), "M112": dict(cdp_doc=umbra_dupa_scriere("user-agent")),
                  "M113": dict(cdp_doc=umbra_dupa_scriere("closed")),
                  "M114": dict(cdp_doc=cu_iframe(_doc_cu_div_inchis, cand=lambda pg: pg.scris)), "M115": dict(cdp_doc=tip_nou)}
        for nume, inl in MUTANTI_R20:
            mut = mutant(inl)
            if nume in cazuri:
                self.assertEqual(self.scrie(gp, **cazuri[nume])[:2], ("ciorna_necunoscuta", ACTIUNI_FARA_ENTER), msg=nume)
                self.assertEqual(self.scrie(mut, **cazuri[nume])[:2], (None, ACTIUNI_TRIMITERE), msg=nume)
            for s in ("mediu", "lung"):
                self.assertEqual(self.scrie(mut, s)[:2], (None, ACTIUNI_TRIMITERE), msg=(nume, s))
        # M117 (umbre imbricate neparcurse): umbra exterioara refuzata oricum -> doar numararea difera (strat de numarare, nu de decizie)
        def f(pg, doc):
            cu_umbra(div_din_zona, "open", '<div id="i"></div>')(pg, doc)
            div_din_zona(doc)["shadowRoots"][0]["children"][0]["shadowRoots"] = [
                {"nodeType": 11, "nodeName": "#document-fragment", "shadowRootType": "closed", "children": []}]
            return doc
        doc = f(None, html_in_cdp(html_captura("mediu")))
        self.assertEqual(gp._arbore_cdp(doc)[1]["inchise"], 1)
        self.assertEqual(mutant(REGULI_M117_FARA_IMBRICATE)._arbore_cdp(f(None, html_in_cdp(html_captura("mediu"))))[1]["inchise"], 0)

    def test_starile_reale_trec_r20(self):
        for s in ("mediu", "lung"):
            cod, act, pg, det = self.scrie(gp, s)
            self.assertEqual((cod, act), (None, ACTIUNI_TRIMITERE), msg=s)
            self.assertEqual(_invariant_instantaneu(pg), (True, ""))
            self.assertNotIn("content", pg.jurnal)
            self.assertEqual(pg.jurnal.count("cdp DOM.getDocument"), 3)              # inainte de chat nou, pe chatul nou, ultima paza
        for html in [pagina_calibrare(x) for x in ("i", "ii", "iii")] + [pagina_22_11_completa(x) for x in ("i", "ii", "iii")] + \
                [pagina_22_11_completa(x, fdi=FDI_5G) for x in ("i", "ii", "iii")] + [pagina_23_11(), chat_nou_gol_23_11()]:
            self.assertEqual(ruleaza_trimite(gp, FakePg(html, dupa_goto=html)), (None, ACTIUNI_TRIMITERE))
        self.assertEqual(scenariu_brief_lung(gp, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE))
        # `stare`: linia CDP; pagina reala (UA pe img in afara zonei) -> OK; umbra inchisa -> REFUZ
        img = img_in_afara
        for cdp_doc, linie, paza in (
                (None, "shadow root CDP: deschise 0 / inchise 0 / alt tip 0 | user-agent: pagina 0 / zona 0 | documente iframe: 0", "paza ciorna: OK"),
                (cu_umbra(img, "user-agent", ""), "shadow root CDP: deschise 0 / inchise 0 / alt tip 0 | user-agent: pagina 1 / zona 0 | documente iframe: 0",
                 "paza ciorna: OK"),
                (cu_umbra(div_din_zona, "closed"), "shadow root CDP: deschise 0 / inchise 1 / alt tip 0 | user-agent: pagina 0 / zona 0 | documente iframe: 0",
                 "paza ciorna: REFUZ")):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                gp.stare(FakePg(html_captura("lung"), cdp_doc=cdp_doc))
            l = out.getvalue().splitlines()
            self.assertIn(linie, l)
            self.assertIn("shadow root: pagina 0 / zona 0 | custom inregistrate: pagina 0 / zona 0", l)
            self.assertTrue(any(x.startswith(paza) for x in l), msg=l[-1])

    def test_structural_r20(self):
        with open(os.path.join(AICI, "..", "gemini_pw.py"), "rb") as f:
            src = f.read().decode("ascii")
        cod = [l for l in (x.rstrip("\r") for x in src.split("\n")) if not l.lstrip().startswith("#")]
        self.assertEqual(sum(l.count("new_cdp_session(") for l in cod), 1)
        self.assertIn("        cdp = pg.context.new_cdp_session(pg)", cod)
        self.assertEqual(sum(l.count('"DOM.getDocument"') for l in cod), 1)
        self.assertIn('        doc = cdp.send("DOM.getDocument", {"depth": -1, "pierce": True})', cod)
        self.assertIn('        cdp.send("DOM.enable", {"includeWhitespace": "all"})', cod)
        self.assertEqual(sum(l.count("_arbore_cdp(") for l in cod), 2)                # definitia + _instantaneu
        self.assertEqual(sum(l.count("analizeaza_arbore(") for l in cod), 3)          # definitia + analizeaza_ciorna + _instantaneu
        self.assertEqual(sum(l.count("verifica_umbre_cdp(") for l in cod), 4)         # definitia + _paza_ciorna + _ultima_paza + stare
        self.assertEqual(gp.LIMITA_TEXT_CDP, 10000)
        self.assertEqual(gp.CHEI_UMBRE_CDP, ("deschise", "inchise", "alt_tip", "ua_pagina", "ua_zona", "documente_iframe"))


def _nod_text(t):
    # un nod text izolat (copilul unui <span> fara parinte), ca _motiv_text sa fie apelat direct cu textul BRUT t
    return gp._Nod("#text", {}, gp._Nod("span", {}, None), t)


def _stramosi(n, zona):
    p = n.parinte
    out = []
    while p is not None and p is not zona:
        out.append(p)
        p = p.parinte
    return list(reversed(out))                    # de la cel mai exterior (primul control = cel care ramane, r12 / r16)


if __name__ == "__main__":
    unittest.main(verbosity=2)
