# Teste fara browser pentru gemini_pw.py (run_paw v4.6.4: paza atasamentelor inainte de chatul nou; v4.6.3: modelul
# Carbon, potrivire exacta). Rulare:
#   python -I docs\paw\run_paw_v464\teste\test_gemini_pw.py
# Nu importa Playwright, nu se ataseaza la Edge, nu trimite nimic la Gemini: logica de selectie tab / model /
# asteptare stabila / validare brief / numarare atasamente (HTML sintetic) / ordinea pazei in trimite() (pagina falsa) /
# r4: semnalele de atasament verificate INAINTEA listelor albe (reproducerile din verdictul Jakarinos r3 + variante + mutanti) /
# r6: elementul zonei insesi verificat ca orice element (reproducerile din verdictul r5 + zona reala + linkul real + mutanti) /
# r7: editorul insusi verificat ca orice element (media / fundal CSS) si O SINGURA functie de semnale pe toate nivelurile (paritate + mutanti)
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


def pagina(fisiere=(), conversatie="", editor=EDITOR_HTML, extra_zona="", zona_atr=""):
    # r6: zona_atr = atributele elementului zonei insesi (<input-area-v2 ...>), verificat si el din r6
    previz = ""
    if fisiere:
        previz = ('<uploader-file-preview-container><div class="file-preview-container">' + "".join(chip(x) for x in fisiere)
                  + '</div></uploader-file-preview-container>')
    return ('<!DOCTYPE html><html><head><title>Gemini</title></head><body><chat-app><main>'
            '<div class="conversation-container">' + conversatie + '</div>'
            '<input-area-v2' + zona_atr + '><div class="input-area-container">' + previz + extra_zona + editor + '</div></input-area-v2>'
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
        # r7: media in editor = acelasi semnal "media:" ca oriunde, cu prefixul contextului (nu mai exista un motiv "media_in_editor")
        for ed, m in ((EDITOR_HTML.replace("<p>ciorna</p>", '<p>ciorna<img src="x"></p>'), "semnal_in_editor:media:img[src]"),
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
        # r11: + singura linie `element:` din refuzul cu brief lung de pe 23.11 (STARE_23_11, copiata din jurnal): butonul "Ecran complet"
        self.assertEqual([l for l in STARE_23_11 if l.startswith("element:")], [STARE_23_11[1]])
        self.assertEqual(set(gp.CONTROALE_CUNOSCUTE) | set(gp.STRUCTURA_CUNOSCUTA), elemente | {STARE_23_11[1].split(":", 1)[1]})
        self.assertEqual(set(gp.TEXTE_CUNOSCUTE), texte | {gp._ascii(AVERTISMENT_TEXT)})
        self.assertEqual(set(gp.CONTROALE_CUNOSCUTE) & set(gp.STRUCTURA_CUNOSCUTA), set())
        self.assertEqual(len(gp.CONTROALE_CUNOSCUTE) + len(gp.STRUCTURA_CUNOSCUTA) + len(gp.TEXTE_CUNOSCUTE), 6 + 23 + 3)
        # controalele = doar butoane si linkuri; tot ce e invelis sta in STRUCTURA (continutul lui se verifica mai departe)
        self.assertTrue(all(x.startswith(("button[", "a[")) for x in gp.CONTROALE_CUNOSCUTE), gp.CONTROALE_CUNOSCUTE)
        self.assertFalse(any(x.startswith(("button[", "a[")) for x in gp.STRUCTURA_CUNOSCUTA), gp.STRUCTURA_CUNOSCUTA)
        self.assertTrue(any(l.startswith("text_fisier:chaturile gazpet.ro") for l in CALIBRARE_III))
        self.assertEqual([x for x in gp.TEXTE_CUNOSCUTE if "chaturile" in x], [gp._ascii(AVERTISMENT_TEXT)])
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
        self.assertEqual(gp.VALORI_PERMISE, (("gem-icon-button", "arialabel", "incarcare si instrumente", (("ariahaspopup", "menu"),)),))
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
        self.verifica([('return "element:" + sem, ctrl', "return None, ctrl")], NECUNOSCUTE["card_fara_text"])

    def test_fara_regula_de_text(self):
        # (nume cu extensie fara cuvant de atasament: ".pdf" ar fi prins si de regula cuvintelor, ramasa in mutant)
        self.verifica([('return "text_fisier:" + a[:TEXT_AFISAT]', "return None"), ('return "text:" + a[:TEXT_AFISAT]', "return None")],
                      "<div><span>raport final.docx</span></div>")

    def test_fara_regula_de_cuvinte(self):
        # mutant: clasele / id-ul / numele atributelor nu se mai cauta dupa cuvinte de atasament
        self.verifica([('    t = _cuvant(clase_id + " " + nume_atribute)', "    t = None")], NECUNOSCUTE["clasa_atasament"])


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
ZONA_ATRIBUTE_REALE = (' _ngcontent-ng-c1796725376="" trace="" _nghost-ng-c1694197906="" '
                       'class="ng-tns-c1694197906-4 ui-improvements-phase-1 with-toolbox-drawer input-box-shadow discovery-feed-the"')
# r6: href-ul REAL al linkului "Confidentialitatea ta si Gemini" (chat existent; pe chat nou linkul nu exista), citit de chat pe 21.11.2026
HREF_REAL = "https://support.google.com/gemini/answer/14620100"


def pagina_calibrare(stare, atribut_file=ATRIBUTE_DIV_REALE, zona_atr=ZONA_ATRIBUTE_REALE, editor_atr=""):
    # pagina sintetica scrisa de mana ca sa reproduca EXACT liniile de mai sus (ordinea = parcurgerea in adancime a zonei);
    # r6: zona are atributele reale, linkul are href-ul real; r7: editor_atr = atribute in plus pe elementul editorului insusi
    assert stare in ("i", "ii", "iii")
    gi = "<gem-icon><svg viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"></path></svg></gem-icon>"
    editor = ('<rich-textarea class="text-input-field_textarea"><div class="ql-editor textarea" contenteditable="true" role="textbox"'
              + editor_atr + ">" + ("<p>proba</p>" if stare == "ii" else "<p><br></p>") + "</div></rich-textarea>")
    trimite = ""
    if stare == "ii":
        trimite = ('<div data-test-id="send-button-container" aria-describedby="x1"><gem-icon-button type="onsurface">'
                   '<button aria-label="Trimite mesajul">' + gi + "</button></gem-icon-button></div>")
    if stare == "iii":
        avertisment = (AVERTISMENT_TEXT + ' <a data-test-id="footer-privacy-notice-link" href="' + HREF_REAL + '">'
                       '<span data-test-id="content">Confiden\u021bialitatea ta \u0219i Gemini</span>'
                       '<span class="cdk-visually-hidden">Se deschide \u00eentr-o fereastr\u0103 nou\u0103</span></a>')
    else:
        avertisment = '<p data-test-id="empty-disclaimer"></p>'
    return ('<!DOCTYPE html><html><body><chat-app><main><div class="conversation-container"></div>'
            '<input-area-v2' + zona_atr + '><div class="input-area-container">'
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
        self.assertIn(gp._ascii(AVERTISMENT_TEXT), gp.TEXTE_CUNOSCUTE)
        self.assertEqual(gp._ascii(AVERTISMENT_TEXT), "chaturile gazpet.ro nu sunt folosite pentru a ne imbunatati modelele. gemini este un ai "
                         "si poate sa faca greseli, inclusiv in legatura cu persoane.")
        fara = tuple(x for x in gp.TEXTE_CUNOSCUTE if x != gp._ascii(AVERTISMENT_TEXT))
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
            with mock.patch.object(gp, "TEXTE_CUNOSCUTE", gp.TEXTE_CUNOSCUTE + (gp._ascii(AVERTISMENT_TEXT + plus),)):
                self.assertEqual(self.an(html)["necunoscute"], 1, msg=plus)
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=plus)
        # textul tot ar fi "fisier" fara regula domeniului: mutantul refuza chiar si cu textul in lista (refuz fals permanent)
        mut = mutant([("        if a[i:j] in DOMENII_FIRMA:", "        if False:")])
        self.assertTrue(self.an(pagina_calibrare("iii"), mut)["necunoscute_detalii"][0].startswith("text_fisier:chaturile gazpet.ro"))

    def test_stare_afiseaza_textul_intreg(self):
        fara = tuple(x for x in gp.TEXTE_CUNOSCUTE if x != gp._ascii(AVERTISMENT_TEXT))
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
        # r5: href-ul linkului real sta pe un host Google (ar fi "fisier" dupa regex): DOAR hostname-ul unui http(s) pe google.com e
        # exceptat; cuvintele se verifica pe tot URL-ul, numele de fisier pe tot ce nu e gazda (cazurile r5 complete: TestNumeFisierPesteTot)
        a = '<a data-test-id="footer-privacy-notice-link" href="%s"></a>'
        self.assertEqual(self.an(zona_cu(a % "https://support.google.com/gemini/answer/13594961?hl=ro"))["necunoscute"], 0)
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
        mut = mutant([(LINIA_PAS4, "        if True:")])
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
                self.assertEqual(i["necunoscute_detalii"], [m], msg=k)
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=k)
        for extra in CURATE_R5:
            i = self.an(zona_cu(extra))
            self.assertEqual(i["necunoscute"], 0, msg=(extra, i["necunoscute_detalii"]))
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(extra), dupa_goto=zona_cu(extra))), (None, ACTIUNI_TRIMITERE), msg=extra)

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
        ed = EDITOR_HTML.replace('class="input-area"', 'class="x"')
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
        # aceleasi zone FARA semnal trec (zona prin clasa e un div neutru; zonele imbricate sunt structura)
        for html in ('<html><body><div class="input-area">' + ed + "</div></body></html>",
                     '<html><body><input-area-v2><input-container><div class="input-area-container">' + ed + "</div></input-container></input-area-v2></body></html>"):
            i = self.an(html)
            self.assertEqual((i["zone"], i["necunoscute"]), (1, 0), msg=i["necunoscute_detalii"])

    def test_chip_sau_semn_pe_zona_se_numara(self):
        # un semn de atasament (clasa *file-preview*, data-test-id) sau chiar un chip pe ELEMENTUL zonei se numara (r5 numara doar descendentii)
        for atr in (' class="file-preview-x"', ' data-test-id="uploaded-file-1"', ' data-test-id="file-preview"'):
            i = self.an(pagina(zona_atr=atr))
            self.assertEqual((i["atasamente"], i["semne"]), (0, 1), msg=atr)
            self.assertEqual(ruleaza_trimite(gp, FakePg(pagina(zona_atr=atr))), ("ciorna_cu_atasamente", []), msg=atr)
        chip_zona = '<html><body><uploader-file-preview class="input-area">' + EDITOR_HTML.replace('class="input-area"', 'class="x"') + "</uploader-file-preview></body></html>"
        i = self.an(chip_zona)
        self.assertEqual((i["zone"], i["atasamente"]), (1, 1))
        with self.assertRaises(gp.GemEroare) as c:
            gp.verifica_fara_atasamente(i, 0, "t")
        self.assertEqual((c.exception.cod, c.exception.detaliu), ("ciorna_cu_atasamente", "t: 1 atasament(e) in ciorna - nu trimit"))
        self.assertEqual(ruleaza_trimite(gp, FakePg(chip_zona)), ("ciorna_cu_atasamente", []))

    def test_zona_nu_devine_control(self):
        # o zona gasita prin clasa care poarta data-test-id-ul butonului de model NU face textele din ea "eticheta" (ar ascunde un text necunoscut)
        ed = EDITOR_HTML.replace('class="input-area"', 'class="x"')
        html = '<html><body><div class="input-area" data-test-id="bard-mode-menu-button"><span>Deep Research</span>' + ed + "</div></body></html>"
        i = self.an(html)
        self.assertEqual(i["necunoscute_detalii"], ["text:deep research"])
        self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []))
        # (acelasi text intr-un buton de model descendent e eticheta lui - comportament r2, neschimbat)
        self.assertEqual(self.an(zona_cu('<button data-test-id="bard-mode-menu-button"><span>Deep Research</span></button>'))["necunoscute"], 0)

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
              '<html><body><uploader-file-preview class="input-area">' + EDITOR_HTML.replace('class="input-area"', 'class="x"') + "</uploader-file-preview></body></html>"),
             "ciorna_cu_atasamente"),
            # (C) zona lasata sa devina control: textul necunoscut din ea trece drept eticheta
            ([("        if n is zona:", "        if False:")],
             ('<html><body><div class="input-area" data-test-id="bard-mode-menu-button"><span>Deep Research</span>'
              + EDITOR_HTML.replace('class="input-area"', 'class="x"') + "</div></body></html>",), "ciorna_necunoscuta"),
        )
        for inlocuiri, htmluri, cod in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), (cod, []), msg=html[:120])
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
    ' aria-label="Introdu un prompt aici" data-placeholder="Intreaba Gemini" spellcheck="true"',
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
_ED_X = EDITOR_HTML.replace('class="input-area"', 'class="x"')      # editorul fara zona interioara (zona = invelisul dat de test)
# nivel -> pagina intreaga cu atributele `atr` pe elementul acelui nivel (editor = elementul editorului; in_editor = un span din editor)
NIVELURI = {
    "zona_input_area_v2": lambda atr: pagina(zona_atr=atr),
    "zona_prin_clasa": lambda atr: '<html><body><div class="input-area"%s>%s</div></body></html>' % (atr, _ED_X),
    "input_container": lambda atr: '<html><body><input-area-v2><input-container%s>%s</input-container></input-area-v2></body></html>' % (atr, EDITOR_HTML),
    "input_area_container": lambda atr: '<html><body><input-area-v2><div class="input-area-container"%s>%s</div></input-area-v2></body></html>' % (atr, _ED_X),
    "rich_textarea": lambda atr: pagina(editor=EDITOR_HTML.replace('<rich-textarea class="text-input-field"', '<rich-textarea class="text-input-field"' + atr)),
    "fieldset": lambda atr: zona_cu('<fieldset role="none"%s></fieldset>' % atr),
    "textarea_wrapper": lambda atr: zona_cu('<div data-test-id="textarea-wrapper"%s></div>' % atr),
    "div_editor_real": lambda atr: zona_cu('<div class="text-input-field simplified-input-area"%s%s></div>' % (ATRIBUTE_DIV_REALE, atr)),
    "editor": lambda atr: zona_cu(editor=editor_cu(atr)),
    "in_editor": lambda atr: zona_cu(editor=EDITOR_HTML.replace("<p>ciorna</p>", "<p>ciorna<span%s></span></p>" % atr)),
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
        for ed, m in EDITOR_MEDIA:
            self.refuz_fara_actiuni(pagina(editor=ed), m, msg=ed)

    def test_editorul_curat_trece(self):
        # calea legitima (L20): editorul cu stiluri obisnuite / atribute de accesibilitate trece, pe fixture-urile simple si pe cele trei
        # stari calibrate; `trimite` ajunge la Enter
        for atr in EDITOR_CURAT:
            for html in (pagina(editor=editor_cu(atr)), zona_cu(editor=editor_cu(atr)),
                         pagina_calibrare("i", editor_atr=atr), pagina_calibrare("ii", editor_atr=atr), pagina_calibrare("iii", editor_atr=atr)):
                i = self.an(html)
                self.assertEqual((i["editoare"], i["zone"], i["atasamente"], i["semne"], i["necunoscute"]), (1, 1, 0, 0, 0), msg=(atr, i["necunoscute_detalii"]))
                self.assertEqual(ruleaza_trimite(gp, FakePg(html, dupa_goto=html)), (None, ACTIUNI_TRIMITERE), msg=atr)
        # textul brief-ului din editor (cu nume de fisiere) nu e verificat aici (comparat separat), ca inainte
        self.assertEqual(self.an(zona_cu(editor=editor_cu(EDITOR_CURAT[0]).replace("<p>ciorna</p>", "<p>vezi raport.pdf</p>")))["necunoscute"], 0)

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
            # acelasi nivel FARA semnal trece (calea legitima a fiecarui nivel)
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
        i_nec = linii.index("def _necunoscute(zona, editoare):")
        i_urm = next(k for k in range(i_nec + 1, len(linii)) if linii[k].startswith("def "))
        corp = [l for l in linii[i_nec:i_urm] if "editoare" in l and not l.lstrip().startswith("#")]
        self.assertEqual(corp, ["def _necunoscute(zona, editoare):", "        if any(n is e for e in editoare):"])

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
        with mock.patch.object(mut3, "CONTROALE_CUNOSCUTE", mut3.CONTROALE_CUNOSCUTE + ("img[src]",)):
            cod_m, act_m = ruleaza_trimite(mut3, FakePg(zona_cu('<img src="x">')))
            self.assertIsNone(cod_m)
            self.assertIn("press Enter", act_m)
        with mock.patch.object(gp, "CONTROALE_CUNOSCUTE", gp.CONTROALE_CUNOSCUTE + ("img[src]",)):
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu('<img src="x">'))), ("ciorna_necunoscuta", []))
        self.assertEqual(ruleaza_trimite(mut3, FakePg(pagina(editor=EDITOR_MEDIA[0][0])))[0], "ciorna_necunoscuta")


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
        ('<gem-icon-button type="onsurface"><button aria-label="\u00cenc\u0103rcare',
         "<gem-icon-button" + plus_atr + '><button aria-label="\u00cenc\u0103rcare'),
        ('<gem-icon-button type="onsurface" aria-describedby="x2">', "<gem-icon-button" + mic_atr + ">"),
        ('<div class="ql-editor textarea" contenteditable="true" role="textbox"', "<div" + editor_atr),
        ('<div class="input-area-container">', '<div class="input-area-container">' + extra_zona),
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
        ('<gem-icon-button type="onsurface"><button aria-label="\u00cenc\u0103rcare',
         '<gem-icon-button type="onsurface" class="' + CLASE_PLUS_22_11 + '"' + plus_extra + '><button aria-label="\u00cenc\u0103rcare'),
        ('<div class="ql-editor textarea" contenteditable="true" role="textbox"',
         '<div class="' + CLASE_EDITOR_22_11 + '" aria-label="' + ETICHETA_EDITOR_22_11 + '" contenteditable="true" role="textbox"' + editor_extra),
        ('<div class="input-area-container">', '<div class="input-area-container">' + extra_zona),
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
        plus = '<gem-icon-button type="onsurface" class="%s"></gem-icon-button>' % CLASE_PLUS_22_11
        editor = '<div class="%s" aria-label="%s" contenteditable="true" role="textbox"></div>' % (CLASE_EDITOR_22_11, ETICHETA_EDITOR_22_11)
        self.assertIsNone(gp._semnal(self.nod(plus)))
        self.assertIsNone(gp._semnal(self.nod(editor)))
        self.assertEqual(gp._semnatura(self.nod(plus)), "gem-icon-button[type=onsurface]")               # = semnatura din linia (2)
        self.assertEqual(gp._semnatura(self.nod(editor)), STARE_22_11[2].split(":", 2)[2].split("{")[0])  # = semnatura din linia (3)
        # EXEMPLU de mecanism (numele atributelor / clasa de mai jos sunt INVENTATE, nu sursa reala): o a sasea clasa "gem-butt..." si un
        # atribut cu "incarca" in valoare pe butonul "+", o clasa cu "chip" pe editor; cu latimea r7 (80) `stare` ar fi aratat EXACT liniile
        # (2) si (3) din captura - fara sursa; cu r8 (400) {...} e intreg si linia `sursa` arata locul cuvantului
        plus_ex = pagina_22_11(plus_extra=' tooltip="\u00cenc\u0103rcare \u0219i instrumente"').replace(
            'class="' + CLASE_PLUS_22_11 + '"', 'class="' + CLASE_PLUS_22_11 + ' gem-button-onsurface"')
        editor_ex = pagina_22_11().replace('class="' + CLASE_EDITOR_22_11 + '"', 'class="' + CLASE_EDITOR_22_11 + ' with-chips"')
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
            html = pagina_22_11().replace('class="' + CLASE_EDITOR_22_11 + '"', 'class="' + CLASE_EDITOR_22_11 + " " + cl + '"')
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
        # listele albe raman cele de la 21.11 (5 + 23 + 3; r11: + butonul "Ecran complet" = 6 + 23 + 3): niciuna din cele trei exceptii
        # r9 nu e o intrare in liste
        self.assertEqual(len(gp.CONTROALE_CUNOSCUTE) + len(gp.STRUCTURA_CUNOSCUTA) + len(gp.TEXTE_CUNOSCUTE), 6 + 23 + 3)
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
        # calea legitima (L20): butonul real; fara `theme` (necerut); eticheta fara diacritice (comparatia e dupa _ascii, ca la eticheta
        # calibrata a butonului interior); cu butonul interior real in el
        for extra in (plus_real(), cu(' theme="lm"', ""), cu(ARIALABEL_REAL, "Incarcare si instrumente"),
                      plus_real(inauntru='<button aria-label="%s"></button>' % ARIALABEL_REAL)):
            i = self.an(zona_cu(extra))
            self.assertEqual(i["necunoscute"], 0, msg=(extra, i["necunoscute_detalii"]))
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
            (zona_cu(editor=EDITOR_HTML.replace('<rich-textarea class="text-input-field">', '<rich-textarea class="text-input-field inline-chips-enabled">')),
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
        self.assertEqual(sum(l.count("_e_editor(") for l in cod), 3)                 # def + analizeaza_ciorna + _clase_verificate

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
            ([('        if izolat and any(c.tag != "#text" or _ascii(c.date) for c in n.copii):', "        if False:")],
             (fdi_real(inauntru="<div></div>"), fdi_real(inauntru="<span></span>"))),
            # (M4) `ariahaspopup="menu"` necerut: butonul fara el / cu "true" pleaca
            ([("        if any(n.attrs.get(a) != v for a, v in cerute):", "        if False:")],
             (cu(' ariahaspopup="menu"', ""), cu('ariahaspopup="menu"', 'ariahaspopup="true"'))),
            # (M5) valoarea comparata ca subsir: eticheta + un nume de fisier pleaca
            ([("        if _ascii(n.attrs.get(k)) != valoare:", "        if valoare not in _ascii(n.attrs.get(k)):")],
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
             (zona_cu('<gem-icon-button type="onsurface" data-file-name="oferta.docx"></gem-icon-button>'),
              zona_cu(plus_real(PLUS_REAL_ATR + ' tooltip="\u00cenc\u0103rcare"')))),
            # (M12) "wildcard" pe editor: editorul scutit de semnale (un atribut cu fisier / o clasa chip pe el pleaca)
            ([("    if n.tag in MEDIA:", "    if _e_editor(n):\n        return None\n    if n.tag in MEDIA:")],
             (zona_cu(editor=editor_real(extra=' data-file-name="oferta.docx"')), zona_cu(editor=editor_real(CLASE_EDITOR_REALE + " chip")))),
        )
        for inlocuiri, htmluri in cazuri:
            mut = mutant(inlocuiri)
            for html in htmluri:
                self.assertEqual(ruleaza_trimite(gp, FakePg(html)), ("ciorna_necunoscuta", []), msg=html[-200:])
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
        self.assertEqual(sum(l.count("VALOARE_SPATII") for l in cod), 2)
        self.assertEqual(sum(l.startswith("VALOARE_SPATII = ") for l in cod), 1)
        self.assertEqual(sum(l.count("VALOARE_SPATII.fullmatch(") for l in corp), 1)
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
# multimile de clase acceptate pe div-ul zonei de drop (scrise de mana: normal 21.11, text lung 23.11, intermediarele cerute de chat)
CLASE_DIV_DROP_ASTEPTATE = (
    ("text-input-field", "simplified-input-area"),
    ("text-input-field", "height-expanded-past-single-line", "pre-fullscreen", "with-toolbox-drawer"),
    ("text-input-field", "height-expanded-past-single-line", "with-toolbox-drawer"),
    ("text-input-field", "pre-fullscreen", "with-toolbox-drawer"),
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
GI = '<gem-icon><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"></path></svg></gem-icon>'      # = iconita din pagina_calibrare


def ecran(atr=ECRAN_ATR, inauntru=GI):
    return "<button" + atr + ">" + inauntru + "</button>"


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
JSLOG_TRIMITE = ("173899;track:generic_click,impression;BardVeMetadataKey:W251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxbMCwicm8iLDAs"
                 "IiJdLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWyI5NWE0YzBhYmNiYTI0MzY0Il0sbnVsbCxudWxs"
                 "LG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51")
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
        ('<button data-test-id="bard-mode-menu-button" aria-label="Alege modelul">', "<button" + MODEL_2311_ATR + ">"),
        ('<button aria-label="' + ETICHETA_MIC + '">', "<button" + MIC_2311_BTN + ">"),
        ('<gem-icon-button type="onsurface"><button aria-label="Trimite mesajul">', "<gem-icon-button" + trimite_gib + "><button" + TRIMITE_2311_BTN + ">"),
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
        for html, m, s in cazuri:
            i = self.an(zona_cu(html))
            self.assertEqual((i["necunoscute_detalii"], i["necunoscute_surse"]), ([m], [s]), msg=html)
            self.assertEqual(ruleaza_trimite(gp, FakePg(zona_cu(html))), ("ciorna_necunoscuta", []), msg=html)
            with mock.patch.object(gp, "STRUCTURA_CUNOSCUTA", gp.STRUCTURA_CUNOSCUTA + (m.split(":", 1)[1], "div", "span")):
                self.assertEqual(self.an(zona_cu(html))["necunoscute_detalii"], [m], msg=html)
        # in starea extinsa reala, dupa scriere: refuz inainte de Enter
        for div_atr in (DIV_EXTINS_ATR.replace('xapfileselectordropzone=""', 'xapfileselectordropzone="1"'),
                        DIV_EXTINS_ATR.replace("pre-fullscreen", "pre-fullscreen-file"), DIV_EXTINS_ATR.replace("pre-fullscreen", "pre-fullscreen-x")):
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
        html = ('<div data-test-id="send-button-container" aria-describedby="x1"><gem-icon-button' + TRIMITE_2311_GIB + '><button'
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
                cod_m, act_m = ruleaza_trimite(mut, FakePg(zona_cu(html)))
                self.assertIsNone(cod_m, msg=(inlocuiri[0][1], html, cod_m))
                self.assertIn("press Enter", act_m, msg=html)
            self.assertEqual(scenariu_brief_lung(mut, pagina_23_11()), (None, "", ACTIUNI_TRIMITERE), msg=inlocuiri[0][1])
        # fara r11 (= v4.6.4c instalat): starea reala e refuzata, deci regula noua e cea care o lasa sa treaca
        self.assertEqual(scenariu_brief_lung(mutant(REGULI_V464C), pagina_23_11())[0], "ciorna_necunoscuta")


if __name__ == "__main__":
    unittest.main(verbosity=2)
