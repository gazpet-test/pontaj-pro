# Teste fara browser pentru gemini_pw.py (run_paw v4.3). Rulare:
#   python -I docs\paw\run_paw_v43\teste\test_gemini_pw.py
# Nu importa Playwright, nu se ataseaza la Edge, nu trimite nimic la Gemini: logica de selectie tab / model /
# asteptare stabila / validare brief e testata cu obiecte false. ASCII only.
import os, sys, tempfile, shutil, unittest, importlib.util

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
    def test_argon_ok(self):
        self.assertEqual(gp.verifica_model("  Gemini 4 Argon \n"), "Gemini 4 Argon")

    def test_alt_model(self):
        for t in ("Gemini 4 Flash", "", None, "argon"):
            with self.assertRaises(gp.GemEroare, msg=repr(t)) as c:
                gp.verifica_model(t)
            self.assertEqual(c.exception.cod, "model_gresit")


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
        # canalul nu navigheaza, nu reincarca, nu inchide browserul, nu ataseaza fisiere, nu scrie fisiere
        with open(os.path.join(AICI, "..", "gemini_pw.py"), encoding="ascii") as f:
            src = f.read()
        for interzis in (".goto(", ".reload(", ".close()", "set_input_files", "new_page", "write_text", "open(full, \"w"):
            self.assertNotIn(interzis, src, interzis)
        self.assertIn('CDP = "http://127.0.0.1:9333"', src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
