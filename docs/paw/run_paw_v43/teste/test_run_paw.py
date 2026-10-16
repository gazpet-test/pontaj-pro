# Teste negative pentru lansatorul run_paw v4.3 (cine = gem si refuzurile comune), fara admin si fara browser. Rulare:
#   python -I docs\paw\run_paw_v43\teste\test_run_paw.py
# Copiaza run_paw.ps1 intr-un director temporar cu $DATA rescris spre un paw-data TEMPORAR (jurnal, lock-uri, brief, out
# izolate: paw-data-ul real nu e atins) si pune langa el un gemini_pw.py FALS (stub) - cel real nu ruleaza niciodata aici.
# Cazurile care trec de verificarea CDP folosesc doar stub-ul; daca Edge 9333 nu asculta, lansatorul refuza inainte
# (si testul verifica refuzul). Nimic nu ajunge la Gemini/ChatGPT. ASCII only.
import os, re, sys, time, shutil, subprocess, tempfile, unittest

AICI = os.path.dirname(os.path.abspath(__file__))
SURSA = os.path.join(AICI, "..", "run_paw.ps1")
DATA_REAL = r'$DATA = "C:\Users\Public\paw-data"'

STUB = r'''import sys, os, time
if len(sys.argv) < 3 or sys.argv[1] != "trimite":
    print("GEM_EROARE comanda_necunoscuta stub"); sys.exit(3)
t = open(sys.argv[2], encoding="utf-8-sig").read()
if "STUB_AGATAT" in t:
    open("stub_pornit_%d" % os.getpid(), "w").close()
    time.sleep(120)                                       # "ciorna" la jumatate: lansatorul e omorat intre timp
    print("NU TREBUIA SA AJUNG AICI"); sys.exit(0)
if "STUB_LENT" in t:
    open("stub_pornit_%d" % os.getpid(), "w").close()   # cwd = paw-data-ul temporar
    time.sleep(8)
    print("raspuns simulat lent"); sys.exit(0)
if "STUB_OK" in t:
    print("GEM_MODEL: Gemini 4 Argon (stub)"); print("raspuns simulat"); sys.exit(0)
print("GEM_EROARE fara_tab_gemini simulat"); sys.exit(3)
'''

STUB_COP = r'''import sys, os, time
if len(sys.argv) > 1 and sys.argv[1] == "stare":
    print("URL: stub | genereaza: False | editor vizibil: 1"); sys.exit(0)
if len(sys.argv) > 2 and sys.argv[1] == "trimite":
    t = open(sys.argv[2], encoding="utf-8-sig").read()
    if "STUB_AGATAT" in t:
        open("stub_pornit_%d" % os.getpid(), "w").close()
        time.sleep(120)
    print("raspuns cop simulat"); sys.exit(0)
print("EROARE: comanda stub"); sys.exit(3)
'''


def viu(pid):
    import ctypes
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x00100000 | 0x1000, False, pid)    # SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    try:
        return k.WaitForSingleObject(h, 0) == 0x102            # WAIT_TIMEOUT = inca ruleaza
    finally:
        k.CloseHandle(h)


def sha(p):
    import hashlib
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest().upper()


class Lansator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = os.path.realpath(tempfile.mkdtemp(prefix="paw_v43_test_"))   # cale lunga (fara 8.3), ca la FinalPath
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
        cls.brief_lent = cls.scrie(os.path.join(cls.data, "brief"), "stub_lent.md", "STUB_LENT")
        cls.brief_agatat = cls.scrie(os.path.join(cls.data, "brief"), "stub_agatat.md", "STUB_AGATAT")
        cls.brief_txt = cls.scrie(os.path.join(cls.data, "brief"), "b.txt", "x")
        with open(os.path.join(cls.bin, "cgpt_pw.py"), "w", encoding="ascii") as f:
            f.write(STUB_COP)
        # marcajul de canal validat, legat de hash-ul gemini_pw.py din bin-ul temporar (stub-ul)
        cls.marcaj = os.path.join(cls.data, "gem_canal_validat")
        cls.marcaj_ok = "CANAL_VALIDAT %s 2026-10-16T12:00:00 test\n" % sha(cls.stub)
        with open(cls.marcaj, "w", encoding="ascii") as f:
            f.write(cls.marcaj_ok)
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

    # --- lock (r2: handle FileShare.None tinut pe toata rularea; fisierul nu se sterge niciodata) ---
    def eliberat(self, lock):
        # lock-ul e liber daca il putem deschide pentru scriere (un handle FileShare.None al lansatorului ar bloca deschiderea)
        with open(lock, "r+b"):
            pass
        return True

    def test_gem_lock_tinut_de_alt_proces(self):
        lock = os.path.join(self.data, "lock_gem")
        with open(lock, "w") as tinut:          # "alta rulare" vie: handle deschis pe toata durata apelului
            tinut.write("ALTA_RULARE")
            tinut.flush()
            o = self.out()
            self.eroare("gem", self.brief_ok, o, contine="ocupat de alta rulare (lock_gem e tinut deschis)")
            with open(o, encoding="utf-8-sig") as f:
                self.assertTrue(f.read().strip().splitlines()[-1].startswith("PAW_EROARE "))
        with open(lock) as f:
            self.assertEqual(f.read(), "ALTA_RULARE", "lansatorul refuzat a atins lock-ul celeilalte rulari")

    def test_cop_lock_tinut_de_alt_proces(self):
        # regresie v4.2: refuzul "ocupat" stergea lock-ul celeilalte rulari. cgpt_pw.py NU exista in bin-ul temporar.
        lock = os.path.join(self.data, "lock_cop_6abc000f")
        with open(lock, "w") as tinut:
            tinut.write("ALTA_RULARE")
            tinut.flush()
            rc, linie, so = self.run_paw("cop", self.brief_ok, self.out(), model="6abc000f")
        self.assertEqual(rc, 2, so)
        if "nu asculta" in linie or "loopback" in linie:
            self.skipTest("CDP 9333 indisponibil/neloopback - lansatorul refuza inainte de lock")
        self.assertIn("ocupat de alta rulare (lock_cop_6abc000f e tinut deschis)", linie)
        with open(lock) as f:
            self.assertEqual(f.read(), "ALTA_RULARE")

    def test_gem_lock_vechi_abandonat_se_reia_fara_stergere(self):
        # un lock ramas de la o rulare moarta (fisier vechi, fara handle) nu blocheaza si nu se sterge
        lock = os.path.join(self.data, "lock_gem")
        with open(lock, "w") as f:
            f.write("RULARE_MOARTA")
        os.utime(lock, (1, 1))
        rc, linie, so = self.run_paw("gem", self.brief_stub_ok, self.out())
        if "nu asculta" in linie or "loopback" in linie:
            self.skipTest("CDP 9333 indisponibil/neloopback")
        self.assertEqual(rc, 0, so)
        self.assertTrue(os.path.exists(lock))
        with open(lock) as f:
            self.assertRegex(f.read(), r"^\d{8}-\d{6}-[0-9a-f]{6} pid=\d+$")
        self.assertTrue(self.eliberat(lock))

    def test_gem_cursa_doua_rulari_pe_lock_vechi(self):
        # scenariul Jakarinos r1: doua procese pornite simultan vad acelasi lock vechi -> exact unul ruleaza, celalalt e refuzat,
        # iar cat timp castigatorul ruleaza lock-ul lui nu poate fi sters/deschis de nimeni (nici de "observatia veche")
        lock = os.path.join(self.data, "lock_gem")
        with open(lock, "w") as f:
            f.write("RULARE_MOARTA")
        os.utime(lock, (1, 1))
        for x in os.listdir(self.data):
            if x.startswith("stub_pornit"):
                os.remove(os.path.join(self.data, x))
        outs = [self.out(), self.out()]
        procs = [subprocess.Popen(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", self.ps1,
                                   "-Cine", "gem", "-Brief", self.brief_lent, "-Out", o],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE) for o in outs]
        sters, deschis = None, None
        t0 = time.time()
        while time.time() - t0 < 60 and not any(x.startswith("stub_pornit") for x in os.listdir(self.data)):
            if all(p.poll() is not None for p in procs):
                break
            time.sleep(0.2)
        if any(x.startswith("stub_pornit") for x in os.listdir(self.data)):
            try:
                os.remove(lock); sters = True
            except PermissionError:
                sters = False
            try:
                open(lock, "r+b").close(); deschis = True
            except PermissionError:
                deschis = False
        rez = []
        for p in procs:
            so, _ = p.communicate(timeout=120)
            linii = [l for l in so.decode("utf-8", "replace").splitlines() if l.startswith("PAW_")]
            rez.append((p.returncode, linii[-1] if linii else ""))
        if any("nu asculta" in l or "loopback" in l for _, l in rez):
            self.skipTest("CDP 9333 indisponibil/neloopback")
        gata = [r for r in rez if r[0] == 0 and r[1].startswith("PAW_GATA ")]
        ocupat = [r for r in rez if r[0] == 2 and "ocupat de alta rulare" in r[1]]
        self.assertEqual((len(gata), len(ocupat)), (1, 1), rez)
        self.assertIs(sters, False, "lock-ul castigatorului a putut fi sters in timpul rularii")
        self.assertIs(deschis, False, "lock-ul castigatorului a putut fi deschis in timpul rularii")
        self.assertTrue(os.path.exists(lock))
        self.assertTrue(self.eliberat(lock))

    # --- r3 (Jakarinos r2 P2b): gem refuza fara marcajul de canal validat pentru ACEST gemini_pw.py ---
    def cu_marcaj(self, continut, contine):
        try:
            if continut is None:
                os.remove(self.marcaj)
            else:
                with open(self.marcaj, "w", encoding="ascii") as f:
                    f.write(continut)
            o = self.out()
            self.eroare("gem", self.brief_stub_ok, o, contine=contine)
            with open(o, encoding="utf-8-sig") as f:
                self.assertNotIn("raspuns simulat", f.read())
        finally:
            with open(self.marcaj, "w", encoding="ascii") as f:
                f.write(self.marcaj_ok)

    def test_gem_fara_marcaj_canal(self):
        self.cu_marcaj(None, "validare: canal gem nevalidat: lipseste")

    def test_gem_marcaj_alta_versiune(self):
        self.cu_marcaj("CANAL_VALIDAT " + "0" * 64 + " 2026-10-16 test\n", "validat pentru alta versiune de gemini_pw.py")

    def test_gem_marcaj_gol_sau_fara_hash(self):
        self.cu_marcaj("", "validat pentru alta versiune")
        self.cu_marcaj("CANAL_VALIDAT\n", "validat pentru alta versiune")
        self.cu_marcaj("canal validat, am verificat eu\n", "validat pentru alta versiune")

    def test_gem_marcaj_cu_prefix_de_hash_refuzat(self):
        self.cu_marcaj("CANAL_VALIDAT " + sha(self.stub)[:40] + "\n", "validat pentru alta versiune")

    # --- r3 (Jakarinos r2 P1): lansatorul omorat in timpul rularii -> copilul moare, lock-ul se elibereaza abia dupa ---
    def omoara_lansatorul(self, cine, model, lock_nume):
        lock = os.path.join(self.data, lock_nume)
        for x in os.listdir(self.data):
            if x.startswith("stub_pornit"):
                os.remove(os.path.join(self.data, x))
        argv = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", self.ps1,
                "-Cine", cine, "-Brief", self.brief_agatat, "-Out", self.out()]
        if model:
            argv += ["-Model", model]
        p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        copil = None
        t0 = time.time()
        while time.time() - t0 < 60 and p.poll() is None:
            m = [x for x in os.listdir(self.data) if x.startswith("stub_pornit_")]
            if m:
                copil = int(m[0].split("_")[-1])
                break
            time.sleep(0.1)
        if copil is None:
            so, se = p.communicate(timeout=60)
            txt = so.decode("utf-8", "replace")
            if "nu asculta" in txt or "loopback" in txt:
                self.skipTest("CDP 9333 indisponibil/neloopback")
            self.fail("copilul nu a pornit: " + txt + se.decode("utf-8", "replace"))
        self.assertTrue(viu(copil))
        with self.assertRaises(PermissionError):
            open(lock, "r+b").close()                       # lock tinut in timpul rularii
        p.kill()                                            # TerminateProcess DOAR pe powershell (nu pe arbore)
        p.wait(timeout=30)
        p.stdout.close(); p.stderr.close()
        eliberat_cu_copil_viu = False
        t0 = time.time()
        liber = False
        while time.time() - t0 < 30:
            try:
                open(lock, "r+b").close()
                liber = True
                eliberat_cu_copil_viu = viu(copil)           # in momentul eliberarii copilul trebuie sa fie deja mort
                break
            except PermissionError:
                time.sleep(0.05)
        try:
            self.assertTrue(liber, "lock-ul nu s-a eliberat dupa moartea lansatorului")
            self.assertFalse(eliberat_cu_copil_viu, "lock-ul s-a eliberat cat copilul inca rula")
            self.assertFalse(viu(copil), "copilul a supravietuit lansatorului")
        finally:
            if viu(copil):
                subprocess.run(["taskkill", "/F", "/PID", str(copil)], capture_output=True)

    def test_gem_lansator_omorat_copilul_moare_inainte_de_lock(self):
        self.omoara_lansatorul("gem", None, "lock_gem")

    def test_cop_lansator_omorat_copilul_moare_inainte_de_lock(self):
        self.omoara_lansatorul("cop", "6abc000f", "lock_cop_6abc000f")

    # --- dupa lock: doar stub-ul ruleaza ---
    def test_gem_cod_eroare_devine_motiv_si_lock_eliberat(self):
        rc, linie, so = self.run_paw("gem", self.brief_ok, self.out())
        self.assertEqual(rc, 2, so)
        if "nu asculta" in linie or "loopback" in linie:
            self.assertIn("rulare: ", linie)
        else:
            self.assertRegex(linie, r"^PAW_EROARE \S+ fara_tab_gemini$")
        self.assertTrue(self.eliberat(os.path.join(self.data, "lock_gem")))

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
        self.assertTrue(self.eliberat(os.path.join(self.data, "lock_gem")))

    def test_zz_jurnal_izolat(self):
        j = os.path.join(self.data, "paw_runs.log")
        self.assertTrue(os.path.exists(j))
        with open(j, encoding="utf-8-sig") as f:
            linii = [l for l in f.read().splitlines() if l.strip()]
        self.assertGreaterEqual(len(linii), 10)
        self.assertTrue(any("| gem |" in l for l in linii))


if __name__ == "__main__":
    unittest.main(verbosity=2)
