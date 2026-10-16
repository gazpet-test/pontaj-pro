# Teste negative pentru lansatorul run_paw v4.3 (cine = gem si refuzurile comune), fara admin si fara browser. Rulare:
#   python -I docs\paw\run_paw_v43\teste\test_run_paw.py
# Copiaza run_paw.ps1 intr-un director temporar cu $DATA rescris spre un paw-data TEMPORAR (jurnal, lock-uri, brief, out
# izolate: paw-data-ul real nu e atins) si pune langa el un gemini_pw.py FALS (stub) - cel real nu ruleaza niciodata aici.
# Cazurile care trec de verificarea CDP folosesc doar stub-ul; daca Edge 9333 nu asculta, lansatorul refuza inainte
# (si testul verifica refuzul). Nimic nu ajunge la Gemini/ChatGPT. ASCII only.
import os, re, sys, shutil, subprocess, tempfile, unittest

AICI = os.path.dirname(os.path.abspath(__file__))
SURSA = os.path.join(AICI, "..", "run_paw.ps1")
DATA_REAL = r'$DATA = "C:\Users\Public\paw-data"'

STUB = r'''import sys
if len(sys.argv) < 3 or sys.argv[1] != "trimite":
    print("GEM_EROARE comanda_necunoscuta stub"); sys.exit(3)
t = open(sys.argv[2], encoding="utf-8-sig").read()
if "STUB_OK" in t:
    print("GEM_MODEL: Gemini 4 Argon (stub)"); print("raspuns simulat"); sys.exit(0)
print("GEM_EROARE fara_tab_gemini simulat"); sys.exit(3)
'''


class Lansator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="paw_v43_test_")
        cls.bin = os.path.join(cls.tmp, "bin")
        cls.data = os.path.join(cls.tmp, "paw-data")
        cls.afara = os.path.join(cls.tmp, "afara")
        for d in (cls.bin, os.path.join(cls.data, "brief"), os.path.join(cls.data, "out"), cls.afara):
            os.makedirs(d)
        with open(SURSA, encoding="ascii", newline="") as f:
            src = f.read()
        assert src.count(DATA_REAL) == 1, "linia $DATA nu a fost gasita exact o data"
        src = src.replace(DATA_REAL, '$DATA = "' + cls.data + '"')
        cod = [l for l in src.splitlines() if not l.lstrip().startswith("#")]
        assert not any("paw-data\"" in l and cls.data not in l for l in cod), "a ramas o cale spre paw-data-ul real"
        cls.ps1 = os.path.join(cls.bin, "run_paw.ps1")
        with open(cls.ps1, "w", encoding="ascii", newline="") as f:
            f.write(src)
        cls.stub = os.path.join(cls.bin, "gemini_pw.py")
        with open(cls.stub, "w", encoding="ascii") as f:
            f.write(STUB)
        cls.brief_ok = cls.scrie(os.path.join(cls.data, "brief"), "ok.md", "Intrebare de arhitectura (test).")
        cls.brief_stub_ok = cls.scrie(os.path.join(cls.data, "brief"), "stub_ok.md", "STUB_OK")
        cls.brief_txt = cls.scrie(os.path.join(cls.data, "brief"), "b.txt", "x")
        cls.brief_afara = cls.scrie(cls.afara, "b.md", "x")
        cls.n = 0

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @staticmethod
    def scrie(d, nume, text):
        p = os.path.join(d, nume)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        return p

    def out(self):
        Lansator.n += 1
        return os.path.join(self.data, "out", "caz%02d.log" % Lansator.n)

    def run_paw(self, cine, brief, out, model=None):
        argv = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", self.ps1,
                "-Cine", cine, "-Brief", brief, "-Out", out]
        if model:
            argv += ["-Model", model]
        r = subprocess.run(argv, capture_output=True, timeout=180)
        so = r.stdout.decode("utf-8", "replace")
        linii = [l for l in so.splitlines() if l.startswith("PAW_")]
        return r.returncode, (linii[-1] if linii else ""), so

    def eroare(self, cine, brief, out, model=None, contine=""):
        rc, linie, so = self.run_paw(cine, brief, out, model)
        self.assertEqual(rc, 2, so)
        self.assertTrue(linie.startswith("PAW_EROARE "), so)
        self.assertIn(contine, linie)
        return linie

    # --- refuzuri la validare (nu ajung la browser) ---
    def test_cine_necunoscut(self):
        self.eroare("gemini", self.brief_ok, self.out(), contine="cine necunoscut 'gemini' (permis: jak, cop, ollie, gem)")

    def test_gem_model_nepermis(self):
        self.eroare("gem", self.brief_ok, self.out(), model="flash", contine="model/tinta nepermis(a) 'flash' pentru gem")

    def test_gem_brief_in_afara_radacinii(self):
        self.eroare("gem", self.brief_afara, self.out(), contine="in afara radacinilor permise")

    def test_gem_brief_traversal(self):
        p = os.path.join(self.data, "brief", "..", "..", "afara", "b.md")
        self.eroare("gem", p, self.out(), contine="in afara radacinilor permise")

    def test_gem_brief_unc(self):
        self.eroare("gem", r"\\127.0.0.1\c$\Users\Public\paw-data\brief\x.md", self.out(), contine="UNC refuzat")

    def test_gem_brief_ads(self):
        self.eroare("gem", self.brief_ok + ":ascuns", self.out(), contine="ADS refuzat")

    def test_gem_brief_nu_md(self):
        self.eroare("gem", self.brief_txt, self.out(), contine="brief-ul trebuie sa fie .md")

    def test_gem_iesire_in_afara_out(self):
        o = os.path.join(self.afara, "o.log")
        self.eroare("gem", self.brief_ok, o, contine="in afara radacinilor permise")
        self.assertFalse(os.path.exists(o))

    def test_gem_fara_gemini_pw(self):
        ascuns = self.stub + ".ascuns"
        os.rename(self.stub, ascuns)
        try:
            self.eroare("gem", self.brief_ok, self.out(), contine="lipseste gemini_pw.py")
        finally:
            os.rename(ascuns, self.stub)

    # --- lock ---
    def test_gem_lock_ocupat_ramane_al_celuilalt(self):
        lock = os.path.join(self.data, "lock_gem")
        with open(lock, "w") as f:
            f.write("ALTA_RULARE")
        try:
            o = self.out()
            self.eroare("gem", self.brief_ok, o, contine="ocupat de alta rulare")
            with open(lock) as f:
                self.assertEqual(f.read(), "ALTA_RULARE")
            with open(o, encoding="utf-8-sig") as f:
                self.assertTrue(f.read().strip().splitlines()[-1].startswith("PAW_EROARE "))
        finally:
            os.remove(lock)

    def test_cop_lock_ocupat_ramane_al_celuilalt(self):
        # regresie v4.2: refuzul "ocupat" stergea lock-ul celeilalte rulari. cgpt_pw.py NU exista in bin-ul temporar.
        lock = os.path.join(self.data, "lock_cop_6abc000f")
        with open(lock, "w") as f:
            f.write("ALTA_RULARE")
        try:
            rc, linie, so = self.run_paw("cop", self.brief_ok, self.out(), model="6abc000f")
            self.assertEqual(rc, 2, so)
            if "nu asculta" in linie or "loopback" in linie:
                self.skipTest("CDP 9333 indisponibil/neloopback - lansatorul refuza inainte de lock")
            self.assertIn("ocupata de alta rulare", linie)
            self.assertTrue(os.path.exists(lock), "lock-ul celeilalte rulari a fost sters")
        finally:
            if os.path.exists(lock):
                os.remove(lock)

    # --- dupa lock: doar stub-ul ruleaza ---
    def test_gem_cod_eroare_devine_motiv_si_lock_eliberat(self):
        rc, linie, so = self.run_paw("gem", self.brief_ok, self.out())
        self.assertEqual(rc, 2, so)
        if "nu asculta" in linie or "loopback" in linie:
            self.assertIn("rulare: ", linie)
        else:
            self.assertRegex(linie, r"^PAW_EROARE \S+ fara_tab_gemini$")
        self.assertFalse(os.path.exists(os.path.join(self.data, "lock_gem")), "lock_gem ramas dupa rulare")

    def test_gem_succes_stub(self):
        o = self.out()
        rc, linie, so = self.run_paw("gem", self.brief_stub_ok, o, model="argon")
        if "nu asculta" in linie or "loopback" in linie:
            self.skipTest("CDP 9333 indisponibil/neloopback - calea de succes nu se poate exercita")
        self.assertEqual(rc, 0, so)
        self.assertTrue(linie.startswith("PAW_GATA "), so)
        with open(o, encoding="utf-8-sig") as f:
            txt = f.read()
        self.assertIn("raspuns simulat", txt)
        self.assertRegex(txt.strip().splitlines()[-1], r"^PAW_GATA \S+ gem argon \d+s exit=0$")
        self.assertFalse(os.path.exists(os.path.join(self.data, "lock_gem")))

    def test_zz_jurnal_izolat(self):
        j = os.path.join(self.data, "paw_runs.log")
        self.assertTrue(os.path.exists(j))
        with open(j, encoding="utf-8-sig") as f:
            linii = [l for l in f.read().splitlines() if l.strip()]
        self.assertGreaterEqual(len(linii), 10)
        self.assertTrue(any("| gem |" in l for l in linii))


if __name__ == "__main__":
    unittest.main(verbosity=2)
