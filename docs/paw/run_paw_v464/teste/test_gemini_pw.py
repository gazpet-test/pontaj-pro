# Teste fara browser pentru gemini_pw.py (run_paw v4.6.4: paza atasamentelor inainte de chatul nou; v4.6.3: modelul
# Carbon, potrivire exacta). Rulare:
#   python -I docs\paw\run_paw_v464\teste\test_gemini_pw.py
# Nu importa Playwright, nu se ataseaza la Edge, nu trimite nimic la Gemini: logica de selectie tab / model /
# asteptare stabila / validare brief / numarare atasamente (HTML sintetic) / ordinea pazei in trimite() (pagina falsa)
# e testata cu obiecte false. ASCII only.
import os, sys, io, types, tempfile, shutil, unittest, importlib.util, contextlib
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
        # editorul web schimba spatiile albe (CRLF, linii goale, NBSP, latime zero) - continutul e acelasi
        ed = "Intrebare:\n\narhitectura\u00a0run_paw?\n\n- punct 1\n- punct\u200b 2 \u0219i \u021b\n"
        gp.verifica_ciorna(ed, self.BRIEF, 0)

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
        self.assertEqual(gp.normalizeaza(" a\r\n\r\n b\u00a0\tc\ufeff \u2060"), "a b c")
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
        i_ver, i_enter = src.index("verifica_ciorna(ed.inner_text()"), src.index('pg.keyboard.press("Enter")')
        self.assertLess(i_ver, i_enter)
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

EDITOR_HTML = ('<div class="input-area"><rich-textarea class="text-input-field"><div class="ql-editor textarea" '
               'contenteditable="true" role="textbox"><p>ciorna</p></div></rich-textarea></div>')


def chip(nume):
    # un fisier pus in ciorna: chip-ul cu iconita, numele si butonul de scoatere (clasele interioare contin "file-preview")
    return ('<uploader-file-preview class="ng-star-inserted"><div class="file-preview-chip" data-test-id="file-preview">'
            '<img class="file-icon" src="data:,"><span class="file-name">%s</span>'
            '<button aria-label="Remove file"><mat-icon>close</mat-icon></button></div></uploader-file-preview>' % nume)


def pagina(fisiere=(), conversatie="", editor=EDITOR_HTML, extra_zona=""):
    previz = ""
    if fisiere:
        previz = ('<uploader-file-preview-container><div class="file-preview-container">' + "".join(chip(x) for x in fisiere)
                  + '</div></uploader-file-preview-container>')
    return ('<!DOCTYPE html><html><head><title>Gemini</title></head><body><chat-app><main>'
            '<div class="conversation-container">' + conversatie + '</div>'
            '<input-area-v2><div class="input-area-container">' + previz + extra_zona + editor + '</div></input-area-v2>'
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
        ed = '<div class="input-area"><div class="ql-editor" contenteditable="true"></div></div>'
        i = self.an(pagina(["a.txt"], editor=ed))
        self.assertEqual((i["editoare"], i["atasamente"]), (1, 1))

    def test_paritate_css_python(self):
        # L19: selectorii CSS (locator) si regulile din Python (analiza HTML) descriu aceleasi elemente
        self.assertEqual(gp.ZONA, ", ".join(list(gp.ZONA_TAGURI) + ["." + c for c in gp.ZONA_CLASE]))
        self.assertEqual(gp.ATAS, ", ".join(list(gp.SEMN_TAGURI) + ['[data-test-id*="%s"]' % s for s in gp.SEMN_DATA_TEST]
                                            + ['[class*="%s"]' % gp.SEMN_CLASA]))
        self.assertEqual(gp.EDITOR, 'rich-textarea [contenteditable="true"], div.ql-editor[contenteditable="true"]')
        self.assertIn(gp.CHIP, gp.SEMN_TAGURI)
        # clasa de zona = token intreg (ca ".input-area" in CSS), nu subsir
        i = self.an('<html><body><div class="my-input-area-x">' + EDITOR_HTML.replace('class="input-area"', 'class="x"')
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
        if self.sel == gp.STOP:
            return 0
        if self.sel in (gp.EDITOR, gp.MODEL):
            return 1
        if self.sel == gp.RASPUNS:
            return len(self.pg.mesaje)
        return self.pg.semn                    # selectorii de atasamente (semnul locator)

    def wait_for(self, state=None, timeout=None):
        pass

    def inner_text(self):
        return "Carbon" if self.sel == gp.MODEL else self.pg.ciorna

    def all_inner_texts(self):
        return list(self.pg.mesaje)

    def click(self):
        self.pg.act.append("click")


class FakeKb:
    def __init__(self, pg):
        self.pg = pg

    def press(self, k):
        self.pg.act.append("press " + k)
        if k == "Delete":
            self.pg.ciorna = ""
        if k == "Enter":
            self.pg.mesaje.append("PAW_GEM_TEST_OK")

    def insert_text(self, t):
        self.pg.act.append("insert")
        self.pg.ciorna += t
        if self.pg.dupa_scriere is not None:
            self.pg.html = self.pg.dupa_scriere


class FakePg:
    def __init__(self, html, semn=0, dupa_goto=None, dupa_scriere=None):
        self.url = "https://gemini.google.com/app/abc123"
        self.html, self.semn = html, semn
        self.dupa_goto = pagina() if dupa_goto is None else dupa_goto     # chatul nou goleste ciorna (ca pe 19.11)
        self.dupa_scriere = dupa_scriere
        self.act, self.mesaje, self.ciorna = [], [], ""
        self.keyboard = FakeKb(self)

    def content(self):
        return self.html

    def locator(self, sel):
        return FakeLoc(self, sel)

    def goto(self, url, **kw):
        self.act.append("goto")
        self.html, self.semn, self.url = self.dupa_goto, 0, "https://gemini.google.com/app"

    def wait_for_timeout(self, ms):
        pass


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
# ciorna goala cu elemente legitime: butonul modelului (selectorul MODEL), o iconita svg, o ligatura mat-icon, script/style
GOALA_CU_CONTROALE = ('<div class="leading-actions"><mat-icon role="img" aria-hidden="true">add_2</mat-icon></div>'
                      '<div class="trailing-actions"><button data-test-id="bard-mode-menu-button" aria-label="Open mode picker">'
                      '<span class="mode-title">Carbon</span><mat-icon role="img" aria-hidden="true" fonticon="keyboard_arrow_down">'
                      'keyboard_arrow_down</mat-icon></button>'
                      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z"></path></svg></div>'
                      '<script>var file = "a.txt";</script><style>.file-preview{}</style><span class="cdk-visually-hidden"></span>')
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
}


def zona_cu(extra="", editor=EDITOR_HTML):
    return pagina(extra_zona=GOALA_CU_CONTROALE + extra, editor=editor)


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


class TestStructuraCiorna(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def refuz(self, html, mod=gp):
        i = self.an(html, mod)
        with self.assertRaises(mod.GemEroare) as c:
            mod.verifica_fara_atasamente(i, 0, "t")
        return i, c.exception

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
                         ["element:attachment-card", "text_fisier:a.txt", "element:button[aria-label=remove attachment]", "text:x"])

    def test_fiecare_structura_necunoscuta_refuzata(self):
        for k, extra in sorted(NECUNOSCUTE.items()):
            i, e = self.refuz(zona_cu(extra))
            self.assertEqual(e.cod, "ciorna_necunoscuta", msg=k)
            self.assertGreaterEqual(i["necunoscute"], 1, msg=k)

    def test_motivele_sunt_cele_asteptate(self):
        # motivul primului element nerecunoscut, scris de mana pentru fiecare caz
        asteptat = {
            "img": "media:img[src]",
            "buton_remove": "element:button[aria-label=remove file]",
            "buton_sterge_ro": "element:button[aria-label=sterge fisierul]",
            "text_cu_extensie": "text_fisier:raport final.pdf",
            "text_cu_extensie_ro": "text_fisier:fisier_t.docx",
            "text_necunoscut": "text:incarcat",
            "card_fara_text": "element:attachment-card",
            "clasa_atasament": "token_attach:div{attachment-thumb}",
            "atribut_fisier": "token_file:div{data-file-id}",
            "fundal_miniatura": "fundal:div",
            "rol_listitem": "element:div[role=listitem]",
            "div_clickabil": "element:div[jsaction]",
            "div_etichetat": "element:div[aria-label=a]",
            "canvas": "media:canvas",
            "video": "media:video[src]",
            "ligatura_fisier": "text:attach_file",
            "input_ascuns": "element:input[type=file]",
        }
        for k, m in asteptat.items():
            self.assertEqual(self.an(zona_cu(NECUNOSCUTE[k]))["necunoscute_detalii"][0], m, msg=k)

    def test_in_editor_doar_text(self):
        # in editor intra brief-ul (text, comparat separat): o imagine sau un card in editor = refuz
        for ed, m in ((EDITOR_HTML.replace("<p>ciorna</p>", '<p>ciorna<img src="x"></p>'), "media_in_editor:img[src]"),
                      (EDITOR_HTML.replace("<p>ciorna</p>", "<p>ciorna</p><attachment-card></attachment-card>"),
                       "element_in_editor:attachment-card")):
            i, e = self.refuz(zona_cu(editor=ed))
            self.assertEqual((e.cod, i["necunoscute_detalii"]), ("ciorna_necunoscuta", [m]))
        # textul brief-ului (cu nume de fisiere, linii, formatare Quill) NU e verificat aici
        ed = EDITOR_HTML.replace("<p>ciorna</p>", "<p>vezi raport.pdf</p><p><br></p><p><strong>x</strong> a.txt</p>")
        self.assertEqual(self.an(zona_cu(editor=ed))["necunoscute"], 0)

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
        # caracterele de latime zero nu devin text "?" (refuz fals); celelalte caractere necunoscute raman vizibile ("?")
        zw = "".join(map(chr, (0x200B, 0x2060, 0xFEFF)))
        self.assertEqual(gp._ascii(zw + " " + zw), "")
        self.assertEqual(self.an(zona_cu("<span>" + zw + "</span>"))["necunoscute"], 0)
        self.assertEqual(self.an(zona_cu("<span>" + chr(0x2716) + "</span>"))["necunoscute_detalii"], ["text:?"])

    def test_regex_nume_de_fisier(self):
        for t in ("a.txt", "raport final.pdf", "x.tar.gz", "vezi (poza_1.jpeg)", "google.com"):
            self.assertIsNotNone(gp.RE_FISIER.search(t), t)
        for t in ("4.5 carbon", "gemini 2.5", "add_2", "ask gemini...", "carbon", "", "1.000", "v4.6.4"):
            self.assertIsNone(gp.RE_FISIER.search(t), t)

    def test_liste_albe_recunosc_doar_exact(self):
        # o intrare de calibrare (forma afisata de `stare`) recunoaste exact acel control; textul / iconita din el = eticheta
        trimite_btn = ('<button aria-label="Send message" type="button" jsaction="click:x">'
                       '<mat-icon>send</mat-icon><span>Trimite</span></button>')
        sem = "button[aria-label=send message][type=button][jsaction]"
        self.assertEqual(self.an(zona_cu(trimite_btn))["necunoscute_detalii"], ["element:" + sem, "text:trimite"])
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", (sem,)):
            self.assertEqual(self.an(zona_cu(trimite_btn))["necunoscute"], 0)
            # alt buton, alta eticheta / alt atribut = tot necunoscut
            self.assertEqual(self.an(zona_cu(trimite_btn.replace("Send message", "Send")))["necunoscute"], 2)
            self.assertEqual(self.an(zona_cu(trimite_btn.replace(' type="button"', "")))["necunoscute"], 2)
            # un nume de fisier in controlul recunoscut = refuz; un element necunoscut in el = refuz
            self.assertEqual(self.an(zona_cu(trimite_btn.replace("Trimite", "a.txt")))["necunoscute_detalii"], ["text_fisier:a.txt"])
            self.assertEqual(self.an(zona_cu(trimite_btn.replace("<span>", "<attachment-card></attachment-card><span>")))
                             ["necunoscute_detalii"], ["element:attachment-card"])
        # structura cunoscuta: elementul trece, dar continutul lui se verifica in continuare
        with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", ("toolbox-drawer",)):
            self.assertEqual(self.an(zona_cu("<toolbox-drawer><div></div></toolbox-drawer>"))["necunoscute"], 0)
            self.assertEqual(self.an(zona_cu("<toolbox-drawer><span>a</span></toolbox-drawer>"))["necunoscute_detalii"], ["text:a"])
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", ("gemini poate gresi",)):
            self.assertEqual(self.an(zona_cu("<div>Gemini poate gre\u0219i</div>"))["necunoscute"], 0)

    def test_butonul_de_incarcare_se_poate_recunoaste(self):
        # ciorna goala reala are (probabil) un buton de incarcare: eticheta cu "upload file" si iconita "attach_file" sunt
        # permise unui control recunoscut exact; invelisul neutru cu clasa "upload-..." se recunoaste dupa clasa lui
        inc = ('<div class="upload-wrapper ng-tns-c1-2"><button aria-label="Open upload file menu">'
               '<mat-icon>attach_file</mat-icon></button></div>')
        self.assertEqual(self.an(zona_cu(inc))["necunoscute_detalii"],
                         ["token_upload:div{upload-wrapper}", "element:button[aria-label=open upload file menu]", "text:attach_file"])
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", ("button[aria-label=open upload file menu]",)), \
                mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", ("div{upload-wrapper}",)):
            self.assertEqual(self.an(zona_cu(inc))["necunoscute"], 0)
            # aceeasi clasa pe alt element / alta clasa = tot necunoscut
            self.assertEqual(self.an(zona_cu('<div class="upload-preview"></div>'))["necunoscute_detalii"],
                             ["token_upload:div{upload-preview}"])
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
        # listele albe livrate nu contin nimic ce seamana a fisier / scoatere (calibrarea le poate completa, nu cu astfel de intrari)
        for x in gp.CONTROALE_CUNOSCUTE + gp.STRUCTURA_CUNOSCUTA + gp.TEXTE_CUNOSCUTE:
            self.assertFalse(any(t in gp._ascii(x) for t in gp.TOKENI_ETICHETA_INTERZISA), x)
            self.assertIsNone(gp.RE_FISIER.search(gp._ascii(x)), x)
        for x in gp.TEXTE_CUNOSCUTE:
            self.assertFalse(any(t in x for t in gp.TOKENI_ATAS), x)
        # L19: semnul locator (vede si shadow DOM) = aceleasi media + aceleasi etichete de scoatere ca analiza HTML
        self.assertEqual(gp.SEMN_EXTRA, 'img, picture, video, audio, canvas, object, embed, iframe, image, source, track, '
                         '[aria-label*="remove" i], [aria-label*="elimin" i], [aria-label*="terge" i], [aria-label*="delete" i]')
        self.assertTrue(all(t in gp.TOKENI_ATAS or t == "terge" for t in gp.TOKENI_ELIMINA))

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
        self.verifica([('return "element:" + sem, in_control', "return None, in_control")], NECUNOSCUTE["card_fara_text"])

    def test_fara_regula_de_text(self):
        self.verifica([('return "text_fisier:" + a[:40]', "return None"), ('return "text:" + a[:40]', "return None")],
                      NECUNOSCUTE["text_cu_extensie"])

    def test_fara_regula_de_cuvinte(self):
        self.verifica([("        t = _token(n)", "        t = None")], NECUNOSCUTE["clasa_atasament"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
