# Teste fara browser pentru gemini_pw.py (run_paw v4.6.4: paza atasamentelor inainte de chatul nou; v4.6.3: modelul
# Carbon, potrivire exacta). Rulare:
#   python -I docs\paw\run_paw_v464\teste\test_gemini_pw.py
# Nu importa Playwright, nu se ataseaza la Edge, nu trimite nimic la Gemini: logica de selectie tab / model /
# asteptare stabila / validare brief / numarare atasamente (HTML sintetic) / ordinea pazei in trimite() (pagina falsa) /
# r4: semnalele de atasament verificate INAINTEA listelor albe (reproducerile din verdictul Jakarinos r3 + variante + mutanti)
# e testata cu obiecte false. ASCII only.
import os, sys, io, re, types, tempfile, shutil, unittest, importlib.util, contextlib
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
        real = '<button aria-label="\u00cenc\u0103rcare \u0219i instrumente"><gem-icon><svg><path d="M0"></path></svg></gem-icon></button>'
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
        for x in gp.CONTROALE_CUNOSCUTE + gp.STRUCTURA_CUNOSCUTA + gp.TEXTE_CUNOSCUTE:
            self.assertIsNone(gp._nume_fisier(gp._ascii(x)), x)          # nume.extensie (domeniul firmei nu e fisier, r3)
            self.assertEqual(x, gp._ascii(x), x)                          # forma afisata de `stare` (ASCII, litere mici)
            self.assertNotIn("{", x)                                      # r4: niciun element cu cuvant de atasament (token_) in liste
        for x in gp.CONTROALE_CUNOSCUTE + gp.STRUCTURA_CUNOSCUTA:
            for v in re.findall(r"\[[^=\]]+=([^\]]*)\]", x):
                self.assertIsNone(gp._cuvant(v, gp.TOKENI_ETICHETA_INTERZISA), x)
            self.assertIsNone(gp._cuvant(x.split("[", 1)[0], gp.TOKENI_ELIMINA + ("preview", "previz", "thumb", "miniatur")), x)
        for x in gp.TEXTE_CUNOSCUTE:
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
        self.assertEqual(set(gp.CONTROALE_CUNOSCUTE) | set(gp.STRUCTURA_CUNOSCUTA), elemente)
        self.assertEqual(set(gp.TEXTE_CUNOSCUTE), texte | {gp._ascii(AVERTISMENT_TEXT)})
        self.assertEqual(set(gp.CONTROALE_CUNOSCUTE) & set(gp.STRUCTURA_CUNOSCUTA), set())
        self.assertEqual(len(gp.CONTROALE_CUNOSCUTE) + len(gp.STRUCTURA_CUNOSCUTA) + len(gp.TEXTE_CUNOSCUTE), 5 + 23 + 3)
        # controalele = doar butoane si linkuri; tot ce e invelis sta in STRUCTURA (continutul lui se verifica mai departe)
        self.assertTrue(all(x.startswith(("button[", "a[")) for x in gp.CONTROALE_CUNOSCUTE), gp.CONTROALE_CUNOSCUTE)
        self.assertFalse(any(x.startswith(("button[", "a[")) for x in gp.STRUCTURA_CUNOSCUTA), gp.STRUCTURA_CUNOSCUTA)
        self.assertTrue(any(l.startswith("text_fisier:chaturile gazpet.ro") for l in CALIBRARE_III))
        self.assertEqual([x for x in gp.TEXTE_CUNOSCUTE if "chaturile" in x], [gp._ascii(AVERTISMENT_TEXT)])
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
        self.verifica([('return "element:" + sem, ctrl', "return None, ctrl")], NECUNOSCUTE["card_fara_text"])

    def test_fara_regula_de_text(self):
        # (nume cu extensie fara cuvant de atasament: ".pdf" ar fi prins si de regula cuvintelor, ramasa in mutant)
        self.verifica([('return "text_fisier:" + a[:TEXT_AFISAT]', "return None"), ('return "text:" + a[:TEXT_AFISAT]', "return None")],
                      "<div><span>raport final.docx</span></div>")

    def test_fara_regula_de_cuvinte(self):
        # mutant: clasele / id-ul / numele atributelor nu se mai cauta dupa cuvinte de atasament
        self.verifica([('    nume = _ascii(" ".join([n.attrs.get("class") or "", n.attrs.get("id") or ""] + list(n.attrs.keys())))',
                        '    nume = ""')], NECUNOSCUTE["clasa_atasament"])


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
# atributul care da "file" pe invelisul editorului nu apare in semnatura r3 (nu e clasa / id / data-*); in fixture e IPOTETIC;
# r4 afiseaza numele atributelor in {...}, deci rularea `stare` pe pagina reala il va arata
ATRIBUT_FILE_IPOTETIC = ' filedroptarget=""'
TOKEN_FILE_R3 = "token_file:div{text-input-field simplified-input-area}"                 # linia din calibrare (afisarea r3)
TOKEN_FILE_R4 = "token_file:div{text-input-field simplified-input-area filedroptarget}"  # aceeasi, cu atributul ipotetic afisat


def pagina_calibrare(stare, atribut_file=ATRIBUT_FILE_IPOTETIC):
    # pagina sintetica scrisa de mana ca sa reproduca EXACT liniile de mai sus (ordinea = parcurgerea in adancime a zonei)
    assert stare in ("i", "ii", "iii")
    gi = "<gem-icon><svg viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"></path></svg></gem-icon>"
    editor = ('<rich-textarea class="text-input-field_textarea"><div class="ql-editor textarea" contenteditable="true" role="textbox">'
              + ("<p>proba</p>" if stare == "ii" else "<p><br></p>") + "</div></rich-textarea>")
    trimite = ""
    if stare == "ii":
        trimite = ('<div data-test-id="send-button-container" aria-describedby="x1"><gem-icon-button type="onsurface">'
                   '<button aria-label="Trimite mesajul">' + gi + "</button></gem-icon-button></div>")
    if stare == "iii":
        avertisment = (AVERTISMENT_TEXT + ' <a data-test-id="footer-privacy-notice-link" href="https://support.google.com/x">'
                       '<span data-test-id="content">Confiden\u021bialitatea ta \u0219i Gemini</span>'
                       '<span class="cdk-visually-hidden">Se deschide \u00eentr-o fereastr\u0103 nou\u0103</span></a>')
    else:
        avertisment = '<p data-test-id="empty-disclaimer"></p>'
    return ('<!DOCTYPE html><html><body><chat-app><main><div class="conversation-container"></div>'
            '<input-area-v2><div class="input-area-container">'
            '<span role="status" class="cdk-visually-hidden"></span>'
            '<back-to-bottom-fab><button aria-label="Deruleaz\u0103 \u00een jos" type="button" tabindex="0">' + gi + "</button></back-to-bottom-fab>"
            + ("<prompt-flow-bar></prompt-flow-bar>" if stare == "iii" else "")
            + '<file-drop-indicator></file-drop-indicator><auto-suggest></auto-suggest>'
            '<fieldset role="none"><div class="text-input-field ng-tns-c12-3 simplified-input-area ng-star-inserted"' + atribut_file + ">"
            '<simplified-input-menu><gem-icon-button type="onsurface"><button aria-label="\u00cenc\u0103rcare \u0219i instrumente">' + gi
            + "</button></gem-icon-button></simplified-input-menu><toolbox-drawer></toolbox-drawer>"
            '<div data-test-id="textarea-inner"><div data-test-id="textarea-wrapper">' + editor + "</div></div>"
            "<at-mentions-menu-v2></at-mentions-menu-v2>"
            '<bard-mode-switcher><div role="group"><button data-test-id="bard-mode-menu-button" aria-label="Alege modelul">'
            '<div data-test-id="logo-pill-label-container"><span class="ng-star-inserted">Carbon</span></div>' + gi
            + "</button><gem-popover></gem-popover></div></bard-mode-switcher>"
            '<speech-dictation-mic-button><gem-icon-button type="onsurface" aria-describedby="x2">'
            '<button aria-label="Dicteaz\u0103 (^\u21e7D)">' + gi + "</button></gem-icon-button></speech-dictation-mic-button>"
            + trimite + "</div></fieldset>"
            "<hallucination-disclaimer>" + avertisment + "</hallucination-disclaimer>"
            "</div></input-area-v2></main></chat-app></body></html>")


LISTE_GOALE = dict(CONTROALE_CUNOSCUTE=(), STRUCTURA_CUNOSCUTA=(), TEXTE_CUNOSCUTE=())


class TestCalibrare(unittest.TestCase):
    def an(self, html, mod=gp):
        return mod.analizeaza_ciorna(html)

    def test_fixture_urile_reproduc_iesirile_stare(self):
        # cu listele albe goale (= ae3e8947), paginile sintetice dau EXACT liniile copiate din cele trei fisiere, in aceeasi ordine;
        # textul avertismentului e taiat la 40 ca in r2, ca sa se compare cu linia copiata. Singura linie care difera ca afisare:
        # token_file - r4 arata si numele atributului (ipotetic in fixture), r3 nu il arata; forma r3 e prefixul celei r4
        self.assertTrue(TOKEN_FILE_R4.startswith(TOKEN_FILE_R3[:-1]))
        for stare, asteptat in (("i", CALIBRARE_I), ("ii", CALIBRARE_II), ("iii", CALIBRARE_III)):
            with mock.patch.multiple(gp, **LISTE_GOALE), mock.patch.object(gp, "TEXT_AFISAT", 40), \
                    mock.patch.object(gp, "DOMENII_FIRMA", ()):
                i = self.an(pagina_calibrare(stare))
            self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"]), (1, 1, 0, 0), msg=stare)
            self.assertEqual(i["necunoscute_detalii"], [TOKEN_FILE_R4 if l == TOKEN_FILE_R3 else l for l in asteptat], msg=stare)
            self.assertEqual(i["necunoscute"], len(asteptat), msg=stare)

    def test_listele_livrate_recunosc_cele_trei_stari_fara_atributul_file(self):
        # calea legitima (L20): fara atributul necunoscut al div-ului, toate cele trei stari (si chatul existent, cu textul Workspace
        # intreg in TEXTE_CUNOSCUTE - P2) dau 0 necunoscute si `trimite` ajunge la Enter
        for stare in ("i", "ii", "iii"):
            i = self.an(pagina_calibrare(stare, atribut_file=""))
            self.assertEqual((i["necunoscute"], i["atasamente"], i["semne"]), (0, 0, 0), msg=i["necunoscute_detalii"])
            self.assertEqual(gp.verifica_fara_atasamente(i, 0, "t"), 0)
            cod, act = ruleaza_trimite(gp, FakePg(pagina_calibrare(stare, atribut_file=""), dupa_goto=pagina_calibrare("i", atribut_file="")))
            self.assertEqual((cod, act), (None, ["goto", "click", "press Control+A", "press Delete", "insert", "press Enter"]), msg=stare)

    def test_div_ul_cu_atributul_file_ramane_refuzat_si_afisat_cu_atribut(self):
        # r4: cu atributul (ipotetic) care contine "file", fiecare stare are EXACT un motiv - linia token_file, acum cu numele
        # atributului in {...} (asa va arata `stare` pe pagina reala, ca chatul sa citeasca sursa cuvantului); refuz fara actiuni
        for stare in ("i", "ii", "iii"):
            i = self.an(pagina_calibrare(stare))
            self.assertEqual(i["necunoscute_detalii"], [TOKEN_FILE_R4], msg=stare)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_calibrare(stare))), ("ciorna_necunoscuta", []), msg=stare)
        # P1: nici intrarea r3, nici forma completa r4 in STRUCTURA nu pot accepta un element cu cuvant de atasament
        with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (TOKEN_FILE_R3.split(":", 1)[1], TOKEN_FILE_R4.split(":", 1)[1])):
            self.assertEqual(self.an(pagina_calibrare("i"))["necunoscute_detalii"], [TOKEN_FILE_R4])
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_calibrare("i"))), ("ciorna_necunoscuta", []))

    def test_starea_iii_textul_workspace(self):
        # P2: textul intreg (copiat din pagina reala) e in TEXTE_CUNOSCUTE exact; fara el starea (iii) ar fi refuzata DOAR pe text:
        i = self.an(pagina_calibrare("iii", atribut_file=""))
        self.assertEqual(i["necunoscute"], 0, msg=i["necunoscute_detalii"])
        self.assertIn(gp._ascii(AVERTISMENT_TEXT), gp.TEXTE_CUNOSCUTE)
        self.assertEqual(gp._ascii(AVERTISMENT_TEXT), "chaturile gazpet.ro nu sunt folosite pentru a ne imbunatati modelele. gemini este un ai "
                         "si poate sa faca greseli, inclusiv in legatura cu persoane.")
        fara = tuple(x for x in gp.TEXTE_CUNOSCUTE if x != gp._ascii(AVERTISMENT_TEXT))
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", fara):
            i = self.an(pagina_calibrare("iii", atribut_file=""))
            self.assertEqual(i["necunoscute_detalii"], ["text:" + gp._ascii(AVERTISMENT_TEXT)])
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina_calibrare("iii", atribut_file=""))), ("ciorna_necunoscuta", []))
        # un text care contine IN PLUS un nume de fisier (sau un cuvant de atasament) ramane refuzat, chiar daca ar fi in lista
        for plus, m in ((" Vezi oferta.pdf", "text_fisier:"), (" Fisier atasat.", "text_atasament:"), (" (preview)", "text_atasament:")):
            html = pagina_calibrare("iii", atribut_file="").replace(AVERTISMENT_TEXT, AVERTISMENT_TEXT + plus)
            i = self.an(html)
            self.assertEqual(i["necunoscute"], 1, msg=plus)
            self.assertTrue(i["necunoscute_detalii"][0].startswith(m + "chaturile gazpet.ro"), msg=i["necunoscute_detalii"])
            with mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + (gp._ascii(AVERTISMENT_TEXT + plus),)):
                self.assertEqual(self.an(html)["necunoscute"], 1, msg=plus)
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=plus)
        # textul tot ar fi "fisier" fara regula domeniului: mutantul refuza chiar si cu textul in lista (refuz fals permanent)
        mut = mutant([("        if a[i:j] in DOMENII_FIRMA:", "        if False:")])
        self.assertTrue(self.an(pagina_calibrare("iii", atribut_file=""), mut)["necunoscute_detalii"][0].startswith("text_fisier:chaturile gazpet.ro"))

    def test_stare_afiseaza_textul_intreg(self):
        fara = tuple(x for x in gp.TEXTE_CUNOSCUTE if x != gp._ascii(AVERTISMENT_TEXT))
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", fara):
            pg = FakePg(pagina_calibrare("iii", atribut_file=""))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                gp.stare(pg)
        linii = out.getvalue().splitlines()
        self.assertIn("necunoscute in zona: 1", linii)
        self.assertIn("  necunoscut text:" + gp._ascii(AVERTISMENT_TEXT), linii)
        self.assertTrue(any(l.startswith("paza ciorna: REFUZ ciorna_necunoscuta") for l in linii), linii)
        # cu listele livrate, `stare` pe starea (i) reala (cu atributul) arata exact linia token_file cu atributul
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            gp.stare(FakePg(pagina_calibrare("i")))
        self.assertIn("  necunoscut " + TOKEN_FILE_R4, out.getvalue().splitlines())

    def test_token_file_vine_din_atribut_nu_din_clasa(self):
        # clasa "text-input-field simplified-input-area" nu contine "file" (nici "simplified", nici "field"); fara atributul
        # ipotetic div-ul e neutru si nu apare deloc; cu el apare linia token_file, cu numele atributului (r4), si NU se poate
        # accepta prin nicio lista; alta clasa / id / data-* / alt tag = tot refuz; continutul lui se verifica in continuare
        self.assertNotIn("file", "text-input-field simplified-input-area")
        div = '<div class="text-input-field ng-tns-c12-3 simplified-input-area"%s></div>'
        with mock.patch.multiple(gp, **LISTE_GOALE):
            self.assertEqual(self.an(zona_cu(div % ""))["necunoscute"], 0)
            self.assertEqual(self.an(zona_cu(div % ATRIBUT_FILE_IPOTETIC))["necunoscute_detalii"], [TOKEN_FILE_R4])
        self.assertEqual(self.an(zona_cu(div % ""))["necunoscute"], 0)
        self.assertEqual(self.an(zona_cu(div % ATRIBUT_FILE_IPOTETIC))["necunoscute_detalii"], [TOKEN_FILE_R4])
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
            i = self.an(zona_cu(div.replace("></div>", ">" + inauntru + "</div>") % ""))
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
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + ("fisier incarcat",)):
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
    "model_data_fisier": ('<button data-test-id="bard-mode-menu-button" aria-label="Alege modelul" data-file-name="a.pdf"></button>',
                          "token_file:button[aria-label=alege modelul][data-test-id=bard-mode-menu-button]{data-file-name}"),
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
                mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + ("fisier incarcat", "fisier atasat", "attach_file")):
            for k, (extra, m) in sorted(SEMNALE.items()):
                i = self.an(zona_cu(extra))
                self.assertEqual(i["necunoscute_detalii"][:1], [m], msg=k)
                self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []), msg=k)
        # aceleasi elemente FARA semnal trec (calea legitima): semnatura exacta e in lista, continutul e curat
        curate = ('<gem-icon class="ng-star-inserted"><svg><path d="M0"></path></svg></gem-icon>',
                  '<toolbox-drawer foo="bar"></toolbox-drawer>',
                  '<fieldset role="none" aria-live="polite"></fieldset>',
                  '<button aria-label="Trimite mesajul" class="send-button"><span>Trimite</span><mat-icon>send</mat-icon></button>',
                  '<a data-test-id="footer-privacy-notice-link" href="https://support.google.com/gemini?p=privacy_notice">'
                  '<span data-test-id="content">Confiden\u021bialitatea ta \u0219i Gemini</span></a>',
                  '<span role="status" aria-live="polite"></span>')
        for extra in curate:
            self.assertEqual(self.an(zona_cu(extra))["necunoscute"], 0, msg=(extra, self.an(zona_cu(extra))["necunoscute_detalii"]))

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
        self.assertEqual(self.an(zona_cu(editor=ed))["necunoscute_detalii"], ["semnal_in_editor:token_attach:span{ql-attachment-chip}"])
        self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(editor=ed))), ("ciorna_necunoscuta", []))

    def test_url_urile_nu_sunt_nume_de_fisier_dar_cuvintele_raman(self):
        # href-ul linkului real contine "support.google.com" (ar fi "fisier" dupa regex): valorile URL se verifica doar pe cuvinte
        a = '<a data-test-id="footer-privacy-notice-link" href="%s"></a>'
        self.assertEqual(self.an(zona_cu(a % "https://support.google.com/gemini/answer/13594961?hl=ro"))["necunoscute"], 0)
        self.assertEqual(self.an(zona_cu(a % "https://x.ro/download/oferta.pdf"))["necunoscute_detalii"],
                         ["token_pdf:a[data-test-id=footer-privacy-notice-link][href]{}"])
        self.assertEqual(self.an(zona_cu(a % "https://x.ro/uploads/1"))["necunoscute_detalii"],
                         ["token_upload:a[data-test-id=footer-privacy-notice-link][href]{}"])
        self.assertEqual(gp.URL_ATRIBUTE, ("href", "src", "srcset"))

    def test_eticheta_permite_doar_cuvintele_de_incarcare(self):
        # scris de mana: butonul calibrat "Incarcare si instrumente" trece; orice alt cuvant de atasament in eticheta = refuz
        self.assertEqual(gp.TOKENI_ETICHETA_PERMISE, ("upload", "incarca"))
        self.assertEqual(set(gp.TOKENI_ETICHETA_INTERZISA), (set(gp.TOKENI_ATAS) - {"upload", "incarca"}) | {"terge"})
        for lbl, ok in (("\u00cenc\u0103rcare \u0219i instrumente", True), ("Upload", True), ("Incarcare fisier", False),
                        ("Attach", False), ("Elimin\u0103 imaginea", False), ("Card", False), ("Document nou", False),
                        ("oferta.pdf", False), ("\u0218terge", False)):
            btn = '<button aria-label="%s"></button>' % lbl
            with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", (gp._semnatura(self.nod(btn)),)):
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
        bloc = ["    s = _semnal(n)", "    if s:", "        return s, ctrl"]
        tinta = '    return "element:" + sem, ctrl'
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
        cod, act = ruleaza_trimite(mut, FakePg(zona_cu(REPRO_GEM_ICON)))
        self.assertEqual(cod, None)
        self.assertIn("press Enter", act)
        with mock.patch.object(mut, "STRUCTURA_CUNOSCUTA", mut.STRUCTURA_CUNOSCUTA + (TOKEN_FILE_R3.split(":", 1)[1],)):
            cod, act = ruleaza_trimite(mut, FakePg(zona_cu(REPRO_DIV)))
            self.assertIn("press Enter", act)
        # mutantul inca refuza un element necunoscut cu semnal (nu e in lista): deci doar ORDINEA e diferita
        self.assertEqual(ruleaza_trimite(mut, FakePg(zona_cu('<x-card data-file-name="a.pdf"></x-card>')))[0], "ciorna_necunoscuta")

    def test_mutant_fara_semnal_pe_text_in_control(self):
        # mutant: textul dintr-un control nu mai e verificat dupa cuvinte -> "Fisier atasat" in butonul de trimitere pleaca
        extra = SEMNALE["control_text_inauntru"][0]
        mut = mutant([('        return "text_atasament:" + a[:TEXT_AFISAT]', "        pass")])
        self.assertIsNone(ruleaza_trimite(mut, FakePg(zona_cu(extra)))[0])
        self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra))), ("ciorna_necunoscuta", []))

    def test_mutant_fara_valorile_atributelor(self):
        # mutant: valorile atributelor din afara semnaturii nu se mai verifica -> gem-icon data-x="oferta.pdf" din lista pleaca
        extra = SEMNALE["gem_icon_valoare_fisier"][0]
        mut = mutant([("        if k in ATRIBUTE_SEPARATE or k in SEMN_ATR_VALOARE or not v:", "        if True:")])
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
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", (sem,)):
            btn = '<button aria-label="%s" type="button" jsaction="click:x"></button>'
            self.assertEqual(an(zona_cu(btn % "Send message"))["necunoscute"], 0)
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", ("button[aria-label=gazpet.ro]", "button[aria-label=gazpet.ro.pdf]")):
            self.assertEqual(an(zona_cu('<button aria-label="gazpet.ro"></button>'))["necunoscute"], 0)
            self.assertEqual(an(zona_cu('<button aria-label="gazpet.ro.pdf"></button>'))["necunoscute_detalii"],
                             ["eticheta:button[aria-label=gazpet.ro.pdf]"])
        # un text din lista alba care contine domeniul trece (exact), unul cu fisier nu trece niciodata
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", ("vezi gazpet.ro", "vezi gazpet.ro.pdf")):
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
        with mock.patch.object(mut, "TEXTE_CUNOSCUTE", ("gazpet.ro.docx",)):
            cod_m, act_m = ruleaza_trimite(mut, FakePg(zona_cu(extra)))
            self.assertIsNone(cod_m)
            self.assertIn("press Enter", act_m)
        with mock.patch.object(gp, "TEXTE_CUNOSCUTE", ("gazpet.ro.docx",)):
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra)))[0], "ciorna_necunoscuta")
        # mutant: cuvantul nu se extinde peste punct (doar potrivirea regex) -> acelasi efect
        mut2 = mutant([("        while j < len(a) and a[j] in CARACTERE_NUME:", "        while False:")])
        with mock.patch.object(mut2, "TEXTE_CUNOSCUTE", ("gazpet.ro.docx",)):
            self.assertIsNone(ruleaza_trimite(mut2, FakePg(zona_cu(extra)))[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
