# Teste pentru lansatorul run_paw v4.5, fara admin si fara browser. Rulare din folderul v45:
#   python -m unittest teste.test_run_paw
# Copiaza run_paw.ps1 intr-un director temporar cu $DATA rescris spre un paw-data TEMPORAR (jurnal, lock-uri, brief, out
# izolate: paw-data-ul real nu e atins) si pune langa el un gemini_pw.py FALS (stub) - cel real nu ruleaza niciodata aici.
# Cazurile care trec de verificarea CDP folosesc doar stub-ul; daca Edge 9333 nu asculta, lansatorul refuza inainte
# (si testul verifica refuzul). Nimic nu ajunge la Gemini/ChatGPT. ASCII only.
import os, re, sys, time, shutil, subprocess, tempfile, unittest

AICI = os.path.dirname(os.path.abspath(__file__))
SURSA = os.path.join(AICI, "..", "run_paw.ps1")
DATA_REAL = r'$DATA = "C:\Users\Public\paw-data"'

DRIVER_EXE_REAL = 'Join-Path (Split-Path $TOOLS.gem.exe) "Lib\\site-packages\\playwright\\driver\\node.exe"'
DRIVER_CLI_REAL = '$PW_DRIVER_CLI = Join-Path (Split-Path $PW_DRIVER_EXE) "package\\cli.js"'
DRIVER_ASTEPTARE_REAL = "$DRIVER_ASTEPTARE = 30"
DRIVER_ASTEPTARE_TEST = 8
JOB_GOL_REAL = "$JOB_GOL_ASTEPTARE = 15"
JOB_GOL_TEST = 3
FLAGS_JOB_REAL = "e.B.LimitFlags = 0x2000;"
ACTIVE_REAL = "  if (job == IntPtr.Zero) return -1;\n"
ACTIVE_INJ = ("  if (job == IntPtr.Zero) return -1;\n"
              "  if (System.Threading.Interlocked.Increment(ref injCitiri) == 1) return -2;   // INJECTIE TEST: prima citire esueaza\n")
ACTIVE_INJ_CAMP = "static IntPtr job = IntPtr.Zero;\n"
FLAGS_JOB_BARIERA ="e.B.LimitFlags = 0x2000 | 0x800;"   # + JOB_OBJECT_LIMIT_BREAKAWAY_OK, DOAR in run_paw_bariera.ps1

# driver Playwright FALS: python.exe (acelasi exe ca stub-urile) cu "<FAKE_CLI> run-driver" in linia de comanda; harness-ul
# rescrie $PW_DRIVER_EXE / $PW_DRIVER_CLI spre el, deci lansatorul il recunoaste exact ca pe un driver real
STUB_COMUN = r'''import sys, os, time, subprocess
FAKE_CLI = r"@FAKE_CLI@"
def cdp_atins():                                           # orice contact CDP al unui canal real ar incepe aici
    open("cdp_atins_%d" % os.getpid(), "w").close()
def porneste_driver():
    d = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)", FAKE_CLI, "run-driver"], close_fds=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    open("driver_%d" % d.pid, "w").close()
def driver_bariera():
    # driver fals care traieste GARANTAT pana apare fisierul "elibereaza_driver" (scris de test). Iese din job-ul lui A
    # (CREATE_BREAKAWAY_FROM_JOB, permis doar in copia de test run_paw_bariera.ps1) = cazul cel mai rau al uciderii neordonate:
    # driverul supravietuieste lansatorului si python-ului.
    elib = os.path.abspath("elibereaza_driver")
    d = subprocess.Popen([sys.executable, "-c", "import os, sys, time\nwhile not os.path.exists(sys.argv[1]): time.sleep(0.05)",
                          elib, FAKE_CLI, "run-driver"], close_fds=True, creationflags=0x01000000,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    open("driver_%d" % d.pid, "w").close()
def nepot_ramas():
    # copil care ramane in job dupa ce stub-ul iese (fara driver, fara lock mostenit) -> lansatorul nu are voie sa raporteze succes
    n = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], close_fds=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    open("nepot_%d" % n.pid, "w").close()
'''

STUB = STUB_COMUN + r'''
if len(sys.argv) < 3 or sys.argv[1] != "trimite":
    print("GEM_EROARE comanda_necunoscuta stub"); sys.exit(3)
cdp_atins()
t = open(sys.argv[2], encoding="utf-8-sig").read()
if "STUB_BARIERA" in t:
    driver_bariera()
    open("stub_pornit_%d" % os.getpid(), "w").close()
    time.sleep(120)
    print("NU TREBUIA SA AJUNG AICI"); sys.exit(0)
if "STUB_NEPOT" in t:
    nepot_ramas()
    print("raspuns cu nepot ramas"); sys.exit(0)
if "STUB_DRIVER" in t:
    porneste_driver()
    open("stub_pornit_%d" % os.getpid(), "w").close()
    time.sleep(120)
    print("NU TREBUIA SA AJUNG AICI"); sys.exit(0)
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

STUB_COP = STUB_COMUN + r'''
if len(sys.argv) > 1 and sys.argv[1] == "stare":
    cdp_atins()
    print("URL: stub | genereaza: False | editor vizibil: 1"); sys.exit(0)
if len(sys.argv) > 2 and sys.argv[1] == "trimite":
    cdp_atins()
    t = open(sys.argv[2], encoding="utf-8-sig").read()
    if "STUB_BARIERA" in t:
        driver_bariera()
        open("stub_pornit_%d" % os.getpid(), "w").close()
        time.sleep(120)
    if "STUB_NEPOT" in t:
        nepot_ramas()
        print("raspuns cop cu nepot ramas"); sys.exit(0)
    if "STUB_DRIVER" in t:
        porneste_driver()
        open("stub_pornit_%d" % os.getpid(), "w").close()
        time.sleep(120)
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
        cls.tmp = os.path.realpath(tempfile.mkdtemp(prefix="paw_v45_test_", dir=os.path.dirname(SURSA)))   # cale lunga (fara 8.3), ca la FinalPath
        cls.bin = os.path.join(cls.tmp, "bin")
        cls.env_before={k:os.environ.get(k) for k in ("TEMP","TMP","LOCALAPPDATA")}
        os.environ.update(TEMP=cls.tmp,TMP=cls.tmp,LOCALAPPDATA=cls.tmp)
        cls.data = os.path.join(cls.tmp, "paw-data")
        cls.afara = os.path.join(cls.tmp, "afara")
        for d in (cls.bin, os.path.join(cls.data, "brief"), os.path.join(cls.data, "out"), cls.afara):
            os.makedirs(d)
        with open(SURSA, encoding="ascii") as f:
            src = f.read()
        assert src.count(DATA_REAL) == 1, "linia $DATA nu a fost gasita exact o data"
        src = src.replace(DATA_REAL, '$DATA = "' + cls.data + '"')
        fixture = os.path.join(AICI, 'process_fixture.ps1')
        src = src.replace('$ErrorActionPreference = "Stop"',
                          '$ErrorActionPreference = "Stop"\n. \'' + fixture + "'")
        # v46: numai starea CDP simulata; nu consultam Edge/netstat real.
        src = src.replace('(& netstat.exe -ano | Select-String ":9333 " | Select-String "LISTENING")',
                          '@("TCP 127.0.0.1:9333 0.0.0.0:0 LISTENING 123")')
        shutil.copyfile(os.path.join(os.path.dirname(SURSA), "cdx.ps1"), os.path.join(cls.bin, "cdx.ps1"))
        shutil.copyfile(os.path.join(os.path.dirname(SURSA), "cdx_security.ps1"), os.path.join(cls.bin, "cdx_security.ps1"))
        jak_source = os.path.join(os.path.dirname(SURSA), 'jak.ps1')
        shutil.copyfile(jak_source, os.path.join(cls.bin, 'jak.ps1'))
        os.makedirs(os.path.join(cls.bin, 'state', 'jak-home'))
        with open(jak_source, 'rb') as f:
            config = re.search(rb"return @'\r?\n(.*?)\r?\n'@", f.read(), re.S).group(1)
        with open(os.path.join(cls.bin, 'state', 'jak-home', 'config.toml'), 'wb') as f:
            f.write(config)
        with open(os.path.join(cls.bin, "cdx.ps1"), "a", encoding="ascii") as f:
            f.write("\nfunction AssertCdxAdminAcl([string]$path) {}\n")
        with open(os.path.join(cls.bin, "install.lock"), "w") as f: f.write("fixture")
        src = src.replace('$PAW_ROOT = "C:\\ProgramData\\Gazpet\\Paw"', '$PAW_ROOT = "' + cls.bin + '"')

        cls.fake_cli = os.path.join(cls.tmp, "fake_playwright", "driver", "package", "cli.js")
        for a, b in ((DRIVER_EXE_REAL, '"' + os.path.realpath(sys.executable) + '"'),
                     (DRIVER_CLI_REAL, '$PW_DRIVER_CLI = "' + cls.fake_cli + '"'),
                     (DRIVER_ASTEPTARE_REAL, "$DRIVER_ASTEPTARE = %d" % DRIVER_ASTEPTARE_TEST),
                     (JOB_GOL_REAL, "$JOB_GOL_ASTEPTARE = %d" % JOB_GOL_TEST)):
            assert src.count(a) == 1, "linia de rescris lipseste: " + a
            src = src.replace(a, b)
        # copie separata pentru scenariul cu bariera: singura diferenta = job-ul permite iesirea EXPLICITA (breakaway) a unui proces
        # care o cere la creare (doar driverul fals cu bariera o cere) - injectie de defect pentru "driverul supravietuieste job-ului"
        assert src.count(FLAGS_JOB_REAL) == 1
        cls.ps1_bariera = os.path.join(cls.bin, "run_paw_bariera.ps1")
        with open(cls.ps1_bariera, "w", encoding="ascii", newline="") as f:
            f.write(src.replace(FLAGS_JOB_REAL, FLAGS_JOB_BARIERA))
        # copie cu injectie de defect (r6, Jakarinos r5 P2-a): PRIMA citire ActiveProcesses intoarce -2 (interogare esuata),
        # urmatoarele sunt reale (deci 1) - lansatorul trebuie sa dea job_interogare_esuata, nu PAW_GATA
        assert src.count(ACTIVE_REAL) == 1 and src.count(ACTIVE_INJ_CAMP) == 1
        cls.ps1_inj = os.path.join(cls.bin, "run_paw_inj.ps1")
        with open(cls.ps1_inj, "w", encoding="ascii", newline="") as f:
            f.write(src.replace(ACTIVE_INJ_CAMP, ACTIVE_INJ_CAMP + "static int injCitiri = 0;\n").replace(ACTIVE_REAL, ACTIVE_INJ))
        cod = [l for l in src.splitlines() if not l.lstrip().startswith("#")]
        assert not any("paw-data\"" in l and cls.data not in l for l in cod), "a ramas o cale spre paw-data-ul real"
        cls.ps1 = os.path.join(cls.bin, "run_paw.ps1")
        with open(cls.ps1, "w", encoding="ascii", newline="") as f:
            f.write(src)
        cls.r3_child = cls.scrie(cls.bin, "r3_child.py", r'''import os, sys, subprocess
n = subprocess.Popen([sys.executable, '-c',
    "import sys,time; print('nepot_stdout', flush=True); time.sleep(120)"],
    stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr, close_fds=False)
open('r3_pid.txt', 'w').write(str(n.pid))
''')
        r3 = src.replace('$REPO = "C:\\Users\\Gazpet-Ai\\gazpet-erp"', '$REPO = "' + cls.data + '"')
        r3 = r3.replace('$jakRuntime = GetJakRuntime',
                        '$jakRuntime = @{exe=\'' + sys.executable + "';cli='fixture'}")
        for channel in ('jak', 'ollie'):
            r3 = re.sub(r'(' + channel + r'\s*= @\{ exe = ")[^"]+',
                        lambda m: m[1] + sys.executable, r3, count=1)
        r3 = r3.replace('$rez = InvokeJak $T.exe $argv $prompt',
                        '$rez = Ruleaza $T.exe @("' + cls.r3_child + '") $prompt')
        r3 = r3.replace('$rez = Ruleaza $T.exe @("run", $m) $text',
                        '$rez = Ruleaza $T.exe @("' + cls.r3_child + '") $text')
        cls.ps1_r3 = cls.scrie(cls.bin, 'run_paw_r3.ps1', r3)
        # Confirmare negativa DUPA oprirea reala: verificam raportarea, fara scurgeri.
        cls.ps1_r3_fail = cls.scrie(cls.bin, 'run_paw_r3_fail.ps1',
            r3.replace('$oprit = [PawV43.Job]::StopChildren(2000)',
                       '$oprit = [PawV43.Job]::StopChildren(2000); $oprit = $false'))
        cls.stub = os.path.join(cls.bin, "gemini_pw.py")
        with open(cls.stub, "w", encoding="ascii") as f:
            f.write(STUB.replace("@FAKE_CLI@", cls.fake_cli))
        cls.brief_ok = cls.scrie(os.path.join(cls.data, "brief"), "ok.md", "Intrebare de arhitectura (test).")
        cls.brief_stub_ok = cls.scrie(os.path.join(cls.data, "brief"), "stub_ok.md", "STUB_OK")
        cls.brief_lent = cls.scrie(os.path.join(cls.data, "brief"), "stub_lent.md", "STUB_LENT")
        cls.brief_agatat = cls.scrie(os.path.join(cls.data, "brief"), "stub_agatat.md", "STUB_AGATAT")
        cls.brief_txt = cls.scrie(os.path.join(cls.data, "brief"), "b.txt", "x")
        with open(os.path.join(cls.bin, "cgpt_pw.py"), "w", encoding="ascii") as f:
            f.write(STUB_COP.replace("@FAKE_CLI@", cls.fake_cli))
        cls.brief_driver = cls.scrie(os.path.join(cls.data, "brief"), "stub_driver.md", "STUB_DRIVER")
        cls.brief_bariera = cls.scrie(os.path.join(cls.data, "brief"), "stub_bariera.md", "STUB_BARIERA")
        cls.brief_nepot = cls.scrie(os.path.join(cls.data, "brief"), "stub_nepot.md", "STUB_NEPOT")
        # marcajul de canal validat, legat de hash-ul gemini_pw.py din bin-ul temporar (stub-ul)
        cls.marcaj = os.path.join(cls.data, "gem_canal_validat")
        cls.marcaj_ok = "CANAL_VALIDAT %s 2026-10-16T12:00:00 test\n" % sha(cls.stub)
        with open(cls.marcaj, "w", encoding="ascii") as f:
            f.write(cls.marcaj_ok)
        cls.brief_afara = cls.scrie(cls.afara, "b.md", "x")
        exit_child = cls.scrie(cls.bin, 'exit_child.py', "import sys; print('fake Codex'); sys.exit(int(sys.argv[1]))\n")
        cls.jak_exit_scripts = {}
        for code in (0, 7):
            variant = src.replace('$REPO = "C:\\Users\\Gazpet-Ai\\gazpet-erp"', '$REPO = "' + cls.data + '"')
            variant = variant.replace('$jakRuntime = GetJakRuntime',
                                      '$jakRuntime = @{exe=\'' + sys.executable + "';cli='fixture'}")
            variant = variant.replace('$rez = InvokeJak $T.exe $argv $prompt',
                                      '$rez = Ruleaza $T.exe @(\'' + exit_child + "','" + str(code) + "') $prompt")
            cls.jak_exit_scripts[code] = cls.scrie(cls.bin, 'jak_exit_%d.ps1' % code, variant)
        cls.n = 0

    @classmethod
    def tearDownClass(cls):
        for k,v in cls.env_before.items():
            if v is None: os.environ.pop(k,None)
            else: os.environ[k]=v
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

    def run_paw(self, cine, brief, out, model=None, ps1=None):
        argv = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1 or self.ps1,
                "-Cine", cine, "-Brief", brief, "-Out", out]
        if model:
            argv += ["-Model", model]
        r = subprocess.run(argv, capture_output=True, timeout=180)
        so = r.stdout.decode("utf-8", "replace")
        linii = [l for l in so.splitlines() if l.startswith("PAW_")]
        return r.returncode, (linii[-1] if linii else ""), so + r.stderr.decode("utf-8", "replace")

    def eroare(self, cine, brief, out, model=None, contine=""):
        rc, linie, so = self.run_paw(cine, brief, out, model)
        self.assertEqual(rc, 2, so)
        self.assertTrue(linie.startswith("PAW_EROARE "), so)
        self.assertIn(contine, linie)
        return linie

    # --- refuzuri la validare (nu ajung la browser) ---
    def test_jak_exit_nenul_fara_imagini(self):
        out = self.out()
        rc, line, text = self.run_paw('jak', self.brief_ok, out, ps1=self.jak_exit_scripts[7])
        self.assertEqual(rc, 2, text)
        self.assertIn('jak_exit_7', line)
        with open(out, encoding='utf-8-sig') as f: log = f.read()
        self.assertIn('PAW_EROARE', log)
        self.assertNotIn('PAW_GATA', log + text)

    def test_jak_exit_zero_fara_imagini(self):
        rc, line, text = self.run_paw('jak', self.brief_ok, self.out(), ps1=self.jak_exit_scripts[0])
        self.assertEqual(rc, 0, text)
        self.assertTrue(line.startswith('PAW_GATA '), text)

    def test_cine_necunoscut(self):
        self.eroare("gemini", self.brief_ok, self.out(), contine="cine necunoscut 'gemini' (permis: jak, cop, ollie, gem, cdx)")

    def test_cop_id_majuscule_refuzat(self):
        self.eroare("cop", self.brief_ok, self.out(), model="6AE06A05", contine="model/tinta nepermis(a)")

    def test_cine_majuscule_refuzat(self):
        self.eroare("COP", self.brief_ok, self.out(), model="6ae06a05", contine="cine necunoscut")

    def test_gem_model_majuscule_refuzat(self):
        self.eroare("gem", self.brief_ok, self.out(), model="ARGON", contine="model/tinta nepermis(a)")

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

    # --- r4 (Jakarinos r3, varianta A): niciun contact CDP cat traieste un driver Playwright ramas de la o rulare anterioara ---
    def curata_marcaje(self):
        for x in os.listdir(self.data):
            if x.startswith(("stub_pornit_", "cdp_atins_", "driver_")):
                os.remove(os.path.join(self.data, x))

    def cdp_atins(self):
        return [x for x in os.listdir(self.data) if x.startswith("cdp_atins_")]

    def driver_orfan(self, secunde=120):
        # driver ramas: parintele (o rulare "moarta") a iesit deja -> lant rupt, exact ca dupa moartea lansatorului + python
        cod = ("import subprocess, sys; d = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(%d)', r'%s', 'run-driver'], "
               "close_fds=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); print(d.pid)") % (secunde, self.fake_cli)
        r = subprocess.run([sys.executable, "-c", cod], capture_output=True, timeout=30)
        pid = int(r.stdout.decode().strip())
        self.assertTrue(viu(pid))
        return pid

    def omoara(self, pid):
        if viu(pid):
            # taskkill foloseste CIM blocat aici; terminam exact fixture-ul propriu.
            import ctypes
            k = ctypes.windll.kernel32
            h = k.OpenProcess(1 | 0x100000, False, pid)
            if not h: raise ctypes.WinError()
            try:
                if not k.TerminateProcess(h, 1): raise ctypes.WinError()
                self.assertEqual(k.WaitForSingleObject(h, 10000), 0)
            finally: k.CloseHandle(h)
        t0 = time.time()
        while viu(pid) and time.time() - t0 < 10:
            time.sleep(0.05)

    def porneste(self, cine, brief, model=None):
        argv = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", self.ps1, "-Cine", cine, "-Brief", brief, "-Out", self.out()]
        if model:
            argv += ["-Model", model]
        return subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def termina(self, p):
        so, se = p.communicate(timeout=180)
        linii = [l for l in so.decode("utf-8", "replace").splitlines() if l.startswith("PAW_")]
        return p.returncode, (linii[-1] if linii else ""), so.decode("utf-8", "replace") + se.decode("utf-8", "replace")

    def asteapta_lock_tinut(self, lock, p, limita=60):
        # rularea noua a luat lock-ul (deci e DUPA LuaLock, in asteptarea driverului) - sonda scurta, doar pana il vedem tinut
        t0 = time.time()
        while time.time() - t0 < limita and p.poll() is None:
            try:
                open(lock, "r+b").close()
            except PermissionError:
                return True
            except FileNotFoundError:
                pass                                          # inca necreat (prima rulare pe acest lock)
            time.sleep(0.1)
        return False

    def semnale_driver(self):
        j = os.path.join(self.data, "paw_runs.log")
        if not os.path.exists(j):
            return []
        with open(j, encoding="utf-8-sig", errors="replace") as f:
            return re.findall(r"\| astept_driver pid=([0-9,]+)", f.read())

    def asteapta_semnal_driver(self, drv, p, limita=60):
        # r6: asteapta semnalul explicit al rularii noi ("astept_driver pid=..." cu pid-ul driverului viu). Se opreste cu esec daca,
        # inainte de semnal, rularea atinge CDP-ul sau se termina (exact ce face mutatia fara asteptare).
        inainte = len(self.semnale_driver_initiale) if hasattr(self, "semnale_driver_initiale") else 0
        t0 = time.time()
        while time.time() - t0 < limita:
            if any(str(drv) in s.split(",") for s in self.semnale_driver()[inainte:]):
                return
            if self.cdp_atins():
                self.fail("B a atins CDP-ul fara sa fi semnalat astept_driver pid=%d (driverul vechi inca traia)" % drv)
            if p.poll() is not None:
                so = p.stdout.read().decode("utf-8", "replace")
                if "nu asculta" in so or "loopback" in so:
                    self.skipTest("CDP 9333 indisponibil/neloopback")
                self.fail("B s-a terminat fara semnalul astept_driver pid=%d: %s" % (drv, so))
            time.sleep(0.05)
        self.fail("niciun semnal astept_driver pid=%d in %ds" % (drv, limita))

    def setUp(self):
        self.semnale_driver_initiale = self.semnale_driver()

    def driver_ramas_asteptat_apoi_ruleaza(self, cine, model, lock_nume):
        self.curata_marcaje()
        d = self.driver_orfan()
        p = None
        try:
            p = self.porneste(cine, self.brief_stub_ok, model)
            self.asteapta_semnal_driver(d, p)                 # r6: semnal explicit "astept_driver pid=<d>"
            self.assertTrue(viu(d))
            self.assertEqual(self.cdp_atins(), [], "contact CDP cat driverul vechi traia")
            self.assertIsNone(p.poll(), "rularea s-a terminat cat driverul vechi traia")
            self.omoara(d)
            t_mort = time.time()
            rc, linie, txt = self.termina(p)
            self.assertEqual(rc, 0, txt)
            self.assertTrue(linie.startswith("PAW_GATA "), txt)
            atinse = self.cdp_atins()
            self.assertTrue(atinse, "rularea nu a ajuns deloc la CDP dupa moartea driverului")
            self.assertGreaterEqual(os.path.getmtime(os.path.join(self.data, atinse[0])), t_mort - 0.5)
        finally:
            self.omoara(d)
            if p is not None and p.poll() is None:            # nu lasam o rulare in fundal peste testele urmatoare
                p.kill(); p.wait(timeout=30)

    def test_gem_driver_ramas_asteptat_apoi_ruleaza(self):
        self.driver_ramas_asteptat_apoi_ruleaza("gem", None, "lock_gem")

    def test_cop_driver_ramas_asteptat_apoi_ruleaza(self):
        self.driver_ramas_asteptat_apoi_ruleaza("cop", "6abc000f", "lock_cop_6abc000f")

    def driver_ramas_timeout(self, cine, model):
        self.curata_marcaje()
        d = self.driver_orfan()
        try:
            rc, linie, so = self.run_paw(cine, self.brief_stub_ok, self.out(), model=model)
            if "nu asculta" in linie or "loopback" in linie:
                self.skipTest("CDP 9333 indisponibil/neloopback")
            self.assertEqual(rc, 2, so)
            self.assertRegex(linie, r"^PAW_EROARE \S+ driver_ramas pid=%d " % d)
            self.assertEqual(self.cdp_atins(), [], "contact CDP desi driverul vechi traia")
            self.assertTrue(viu(d), "lansatorul a atins (omorat) un proces strain")
        finally:
            self.omoara(d)

    def test_gem_driver_ramas_timeout_driver_ramas(self):
        self.driver_ramas_timeout("gem", None)

    def test_cop_driver_ramas_timeout_driver_ramas(self):
        self.driver_ramas_timeout("cop", "6abc000f")

    def test_driver_al_unei_rulari_vii_nu_blocheaza(self):
        # driver cu lant intreg (parinte viu, bunic viu) = alta rulare vie (ex. cop pe alta conversatie): ignorat, neatins
        self.curata_marcaje()
        cod = ("import subprocess, sys, time; d = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', r'%s', 'run-driver'], "
               "close_fds=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); "
               "open(r'%s', 'w').write(str(d.pid)); time.sleep(60)") % (self.fake_cli, os.path.join(self.tmp, "viu_pid"))
        parinte = subprocess.Popen([sys.executable, "-c", cod])
        try:
            t0 = time.time()
            while not os.path.exists(os.path.join(self.tmp, "viu_pid")) and time.time() - t0 < 20:
                time.sleep(0.05)
            time.sleep(0.2)
            with open(os.path.join(self.tmp, "viu_pid")) as f:
                d = int(f.read())
            t0 = time.time()
            rc, linie, so = self.run_paw("gem", self.brief_stub_ok, self.out())
            if "nu asculta" in linie or "loopback" in linie:
                self.skipTest("CDP 9333 indisponibil/neloopback")
            self.assertEqual(rc, 0, so)
            self.assertLess(time.time() - t0, DRIVER_ASTEPTARE_TEST, "rularea a asteptat dupa driverul unei rulari vii")
            self.assertTrue(viu(d))
        finally:
            parinte.kill(); parinte.wait()
            try:
                self.omoara(d)
            except NameError:
                pass
            if os.path.exists(os.path.join(self.tmp, "viu_pid")):
                os.remove(os.path.join(self.tmp, "viu_pid"))

    def observator_lansator_omorat(self, cine, model):
        # r5 (Jakarinos r4 P2-2): scenariu SINCRONIZAT explicit, fara esantionare. A ruleaza python -> driver fals; driverul iese din
        # job-ul lui A (doar in copia run_paw_bariera.ps1) si traieste GARANTAT pana scrie testul "elibereaza_driver".
        # Pasi: A omorat -> python-ul lui A mort (lock-ul mostenit eliberat) -> B porneste cat driverul lui A traieste -> B ia lock-ul
        # -> se verifica faptul ca B NU a atins CDP-ul (marcajele cdp_atins_* sunt persistente: absenta lor dovedeste tot intervalul,
        # nu doar momentele citite) -> abia apoi driverul e eliberat -> B atinge CDP-ul si termina cu PAW_GATA.
        self.curata_marcaje()
        elib = os.path.join(self.data, "elibereaza_driver")
        if os.path.exists(elib):
            os.remove(elib)
        argv = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", self.ps1_bariera,
                "-Cine", cine, "-Brief", self.brief_bariera, "-Out", self.out()]
        if model:
            argv += ["-Model", model]
        a = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        drv = py = None
        b = None
        try:
            t0 = time.time()
            while time.time() - t0 < 60 and a.poll() is None and (drv is None or py is None):
                for x in os.listdir(self.data):
                    if x.startswith("driver_"):
                        drv = int(x.split("_")[-1])
                    if x.startswith("stub_pornit_"):
                        py = int(x.split("_")[-1])
                time.sleep(0.05)
            if drv is None or py is None:
                rc, linie, txt = self.termina(a)
                if "nu asculta" in linie or "loopback" in linie:
                    self.skipTest("CDP 9333 indisponibil/neloopback")
                self.fail("A nu a pornit driverul: " + txt)
            for x in self.cdp_atins():
                os.remove(os.path.join(self.data, x))           # contactul lui A nu conteaza; urmarim doar B
            a.kill(); a.wait(timeout=30); a.stdout.close(); a.stderr.close()
            t0 = time.time()
            while viu(py) and time.time() - t0 < 20:          # bariera 1: python-ul lui A mort (job) -> lock-ul lui A eliberat
                time.sleep(0.02)
            self.assertFalse(viu(py), "python-ul lui A nu a murit odata cu lansatorul")
            self.assertTrue(viu(drv), "bariera: driverul lui A trebuie sa fie inca viu cand porneste B")
            b = self.porneste(cine, self.brief_stub_ok, model)
            # bariera 2 (r6, Jakarinos r5 P2-b): semnal EXPLICIT de la B - jurnalul "astept_driver pid=<drv>" - ca B a ajuns la
            # verificarea driverului si l-a vazut viu; fara semnal (ex. B atinge CDP-ul sau iese) testul pica aici
            self.asteapta_semnal_driver(drv, b)
            self.assertTrue(viu(drv), "driverul lui A trebuia sa traiasca pe tot intervalul (traieste pana la eliberare)")
            self.assertEqual(self.cdp_atins(), [], "B a atins CDP-ul cat driverul lui A traia")
            self.assertIsNone(b.poll(), "B s-a terminat cat driverul lui A traia")
            t_elib = time.time()
            open(elib, "w").close()                            # abia acum driverul lui A poate iesi
            t0 = time.time()
            while viu(drv) and time.time() - t0 < 20:
                time.sleep(0.02)
            self.assertFalse(viu(drv))
            rc, linie, txt = self.termina(b)
            b = None
            self.assertEqual(rc, 0, txt)
            self.assertTrue(linie.startswith("PAW_GATA "), txt)
            atinse = self.cdp_atins()
            self.assertTrue(atinse, "B nu a ajuns la CDP dupa eliberarea driverului")
            self.assertGreaterEqual(os.path.getmtime(os.path.join(self.data, atinse[0])), t_elib - 0.5)
        finally:
            open(elib, "w").close()
            for p in (a, b):
                if p is not None and p.poll() is None:
                    p.kill(); p.wait(timeout=30)
            for pid in (drv, py):
                if pid:
                    self.omoara(pid)

    def test_gem_observator_lansator_omorat_driver(self):
        self.observator_lansator_omorat("gem", None)

    def test_cop_observator_lansator_omorat_driver(self):
        self.observator_lansator_omorat("cop", "6abc000f")

    # --- r5 (Jakarinos r4 P2-1): copii ramasi in job -> PAW_EROARE copii_ramasi, fara PAW_GATA, lock tinut pana la iesire ---
    def copii_ramasi(self, cine, model, lock_nume):
        self.curata_marcaje()
        for x in os.listdir(self.data):
            if x.startswith("nepot_"):
                os.remove(os.path.join(self.data, x))
        o = self.out()
        argv = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", self.ps1, "-Cine", cine,
                "-Brief", self.brief_nepot, "-Out", o]
        if model:
            argv += ["-Model", model]
        p = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        nepot = None
        try:
            t0 = time.time()
            while time.time() - t0 < 60 and p.poll() is None and nepot is None:
                m = [x for x in os.listdir(self.data) if x.startswith("nepot_")]
                if m:
                    nepot = int(m[0].split("_")[-1])
                time.sleep(0.05)
            m = [x for x in os.listdir(self.data) if x.startswith("nepot_")]
            if nepot is None and m:
                nepot = int(m[0].split("_")[-1])
            if nepot is None:
                rc, linie, txt = self.termina(p)
                if "nu asculta" in linie or "loopback" in linie:
                    self.skipTest("CDP 9333 indisponibil/neloopback")
                self.fail("nepotul nu a pornit: " + txt)
            time.sleep(1)                                      # stub-ul a iesit; lansatorul asteapta job-ul gol
            self.assertIsNone(p.poll(), "lansatorul a iesit desi in job a ramas un copil activ: " + (p.stdout.read().decode("utf-8", "replace") if p.poll() is not None else ""))
            self.assertTrue(viu(nepot))
            with self.assertRaises(PermissionError):
                open(os.path.join(self.data, lock_nume), "r+b").close()   # lock inca tinut cat copilul ramas traieste
            rc, linie, txt = self.termina(p)
            self.assertEqual(rc, 2, txt)
            self.assertRegex(linie, r"^PAW_EROARE \S+ copii_ramasi activi=2 dupa %ds" % JOB_GOL_TEST)
            with open(o, encoding="utf-8-sig") as f:
                cont = f.read()
            self.assertNotIn("PAW_GATA", cont)
            self.assertTrue(cont.strip().splitlines()[-1].startswith("PAW_EROARE "))
            t0 = time.time()
            while viu(nepot) and time.time() - t0 < 10:
                time.sleep(0.05)
            self.assertFalse(viu(nepot), "copilul ramas nu a fost oprit de job la iesirea lansatorului")
            self.assertTrue(self.eliberat(os.path.join(self.data, lock_nume)))
        finally:
            if p.poll() is None:
                p.kill(); p.wait(timeout=30)
            if nepot:
                self.omoara(nepot)

    # --- r6 (Jakarinos r5 P2-a): -2 la PRIMA citire a job-ului -> job_interogare_esuata, fara succes ---
    def interogare_esuata(self, cine, model):
        o = self.out()
        rc, linie, so = self.run_paw(cine, self.brief_stub_ok, o, model=model, ps1=self.ps1_inj)
        if "nu asculta" in linie or "loopback" in linie:
            self.skipTest("CDP 9333 indisponibil/neloopback")
        self.assertEqual(rc, 2, so)
        self.assertRegex(linie, r"^PAW_EROARE \S+ job_interogare_esuata ")
        with open(o, encoding="utf-8-sig") as f:
            cont = f.read()
        self.assertNotIn("PAW_GATA", cont)
        self.assertIn("raspuns", cont)                         # rularea propriu-zisa a avut loc; doar confirmarea job-ului a esuat

    def test_gem_interogare_job_esuata_la_prima_citire(self):
        self.interogare_esuata("gem", None)

    def test_cop_interogare_job_esuata_la_prima_citire(self):
        self.interogare_esuata("cop", "6abc000f")

    def test_gem_copii_ramasi_fara_succes(self):
        self.copii_ramasi("gem", None, "lock_gem")

    def test_cop_copii_ramasi_fara_succes(self):
        self.copii_ramasi("cop", "6abc000f", "lock_cop_6abc000f")

    def r3_parinte_iesit(self, canal, mare=False, confirmare=True):
        pidfile = os.path.join(self.data, 'r3_pid.txt')
        if os.path.exists(pidfile): os.unlink(pidfile)
        # jak limiteaza promptul la 200k; 180k depaseste capacitatea pipe-ului.
        n = 180000 if canal == 'jak' else 8 * 1024 * 1024
        brief = self.scrie(os.path.join(self.data, 'brief'), 'r3.md',
                           'x' * n if mare else 'intrebare')
        o = self.out()
        t0 = time.monotonic()
        try:
            rc, linie, so = self.run_paw(canal, brief, o,
                ps1=self.ps1_r3 if confirmare else self.ps1_r3_fail)
            self.assertLess(time.monotonic() - t0, 15)
            self.assertEqual(rc, 2, so)
            with open(pidfile) as f: pid = int(f.read())
            self.assertFalse(viu(pid), 'descendent ramas activ')
            with open(o, encoding='utf-8-sig') as f: txt = f.read()
            self.assertEqual(txt.strip().splitlines()[-1], linie)
            self.assertIn('parent_exited_pipes_open', linie)
            if confirmare:
                self.assertIn('arbore oprit', linie)
                self.assertNotIn('tree_kill_failed', txt)
                self.assertIn('nepot_stdout', txt)
                self.assertNotIn('stdin_thread_pending', txt)
            else:
                self.assertIn('tree_kill_failed', linie)
                self.assertNotIn('arbore oprit', txt + so)
        finally:
            if os.path.exists(pidfile):
                with open(pidfile) as f: pid = int(f.read())
                if viu(pid):
                    import ctypes
                    k = ctypes.windll.kernel32
                    h = k.OpenProcess(1, False, pid)
                    if h:
                        try: k.TerminateProcess(h, 1)
                        finally: k.CloseHandle(h)

    def test_r3_jak_parinte_iesit_pipe_mostenite(self):
        self.r3_parinte_iesit('jak')

    def test_r3_jak_stdin_mare_necitit(self):
        self.r3_parinte_iesit('jak', mare=True)

    def test_r3_ollie_parinte_iesit_pipe_mostenite(self):
        self.r3_parinte_iesit('ollie')

    def test_r3_ollie_stdin_mare_necitit(self):
        self.r3_parinte_iesit('ollie', mare=True)

    def test_r3_confirmare_esuata_fara_arbore_oprit(self):
        self.r3_parinte_iesit('jak', confirmare=False)

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


class RuleazaPipe(unittest.TestCase):
    # Doar functiile extrase prin AST; niciun cod de lansator real nu este executat.
    def ruleaza(self, copil, text, limita=5, codare_bom=False, brut=False):
        with tempfile.TemporaryDirectory(prefix="pipe_v45_", dir=os.path.dirname(SURSA)) as d:
            child = os.path.join(d, "child.py")
            payload = os.path.join(d, "stdin.txt")
            ps = os.path.join(d, "probe.ps1")
            rezultat = os.path.join(d, "rezultat.json")
            pidfile = os.path.join(d, "pid.txt")
            with open(child, "w", encoding="ascii") as f: f.write(copil)
            with open(payload, "w", encoding="utf-8", newline="") as f: f.write(text)
            script = r'''
param($sursa, $python, $child, $payload, $cwd, $rezultat, $limita, $bom, $brut)
$ErrorActionPreference = 'Stop'
$tokens = $null; $erori = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sursa, [ref]$tokens, [ref]$erori)
if ($erori.Count) { throw 'Eroare parsare' }
$src = [IO.File]::ReadAllText($sursa)
$jobStart = $src.IndexOf('Add-Type -Namespace PawV43')
$jobEnd = $src.IndexOf('function SecPrivat()', $jobStart)
Invoke-Expression $src.Substring($jobStart, $jobEnd - $jobStart)
foreach ($nume in @('Arg', 'Ruleaza', 'LeagaCopiiiDeLansator', 'InchidePipe')) {
  $fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $nume }, $true)
  Invoke-Expression $fn.Extent.Text
}
if ($bom -eq '1') { [Console]::InputEncoding = New-Object Text.UTF8Encoding($true) }
$codare = [Console]::InputEncoding
if ($brut -eq '1') {
  # Sonda .NET Framework: Start + AutoFlush, fara Write/Flush pe writer.
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $python; $psi.Arguments = Arg $child
  $psi.WorkingDirectory = $cwd; $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true
  $p = [Diagnostics.Process]::Start($psi)
  try {
    $citire = $p.StandardOutput.ReadToEndAsync()
    $p.StandardInput.BaseStream.Dispose()
    if (-not $p.WaitForExit(5000)) { $p.Kill(); throw 'Sonda Start blocata' }
    $r = @{ timeout=$false; exit=$p.ExitCode; out=$citire.Result; err='' }
  } finally { $p.Dispose() }
} else {
  $r = Ruleaza $python @($child) ([IO.File]::ReadAllText($payload)) $cwd ([int]$limita) @{}
}
if ([Console]::InputEncoding.CodePage -ne $codare.CodePage -or
    [BitConverter]::ToString([Console]::InputEncoding.GetPreamble()) -cne [BitConverter]::ToString($codare.GetPreamble())) { throw 'Codare nerestaurata' }
$r | ConvertTo-Json -Compress | Set-Content -LiteralPath $rezultat -Encoding UTF8
'''
            with open(ps, "w", encoding="ascii") as f: f.write(script)
            env = dict(os.environ, TEMP=d, TMP=d, PYTHONDONTWRITEBYTECODE="1")
            p = subprocess.Popen(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps,
                                  os.path.abspath(SURSA), sys.executable, child, payload, d, rezultat,
                                  str(limita), "1" if codare_bom else "0", "1" if brut else "0"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            t0 = time.monotonic()
            try:
                so, se = p.communicate(timeout=20)
                self.assertEqual(p.returncode, 0, (so + se).decode("utf-8", "replace"))
                import json
                with open(rezultat, encoding="utf-8-sig") as f: r = json.load(f)
                if os.path.exists(pidfile):
                    with open(pidfile) as f: pids = [int(x) for x in f.read().split()]
                    for pid in pids: self.assertFalse(viu(pid), "proces supravietuit: %d" % pid)
                return r, time.monotonic() - t0
            finally:
                if p.poll() is None:
                    subprocess.run(["taskkill.exe", "/T", "/F", "/PID", str(p.pid)], capture_output=True)
                    p.communicate(timeout=10)
                if os.path.exists(pidfile):
                    with open(pidfile) as f:
                        for pid in map(int, f.read().split()):
                            if viu(pid):
                                # Curatare directa a PID-urilor create de test, chiar fara WMI/taskkill.
                                import ctypes
                                k = ctypes.windll.kernel32
                                h = k.OpenProcess(1 | 0x00100000, False, pid)
                                if h:
                                    try:
                                        k.TerminateProcess(h, 1)
                                        k.WaitForSingleObject(h, 5000)
                                    finally: k.CloseHandle(h)

    def test_stdin_utf8_fara_bom_si_codare_restaurata(self):
        text = "\u0103\u00e2\u00ee\u0219\u021b \u0102\u00c2\u00ce\u0218\u021a\n"
        for bom in (False, True):
            with self.subTest(codare_console_cu_bom=bom):
                r, _ = self.ruleaza("import sys; print(sys.stdin.buffer.read().hex())", text, codare_bom=bom)
                self.assertFalse(r["timeout"])
                self.assertEqual(r["exit"], 0)
                raw = bytes.fromhex(r["out"].strip())
                self.assertEqual(raw, text.encode("utf-8"))
                self.assertEqual(raw.decode("utf-8"), text)
                self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))

    def test_framework_emite_preambul_la_start_fara_write(self):
        r, _ = self.ruleaza("import sys; print(sys.stdin.buffer.read().hex())", "", codare_bom=True, brut=True)
        self.assertEqual(r["out"].strip(), "efbbbf")

    def test_fara_citire_stdin_timeout_chiar_daca_taskkill_refuzat(self):
        r, durata = self.ruleaza("import time; time.sleep(120)", "x" * (8 * 1024 * 1024), limita=2)
        self.assertTrue(r["timeout"])
        self.assertEqual(r["exit"], -1)
        self.assertLess(durata, 12)

    def test_stdin_gol_fara_bom(self):
        r, _ = self.ruleaza("import sys; print(sys.stdin.buffer.read().hex())", "", codare_bom=True)
        self.assertFalse(r["timeout"])
        self.assertEqual(r["out"].strip(), "")

    def test_pipe_plin_fara_citire_stdin_timeout_omoara_arbore(self):
        copil = ("import os, sys, subprocess, time\n"
                 "n = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])\n"
                 "open('pid.txt', 'w').write(str(os.getpid()) + ' ' + str(n.pid))\n"
                 "sys.stdout.buffer.write(b'o' * (2 * 1024 * 1024)); sys.stdout.flush()\n"
                 "sys.stderr.buffer.write(b'e' * (2 * 1024 * 1024)); sys.stderr.flush()\n"
                 "time.sleep(120)\n")
        r, durata = self.ruleaza(copil, "x" * (8 * 1024 * 1024), limita=2)
        self.assertTrue(r["timeout"])
        self.assertEqual(r["exit"], -1)
        self.assertEqual(len(r["out"]), 2 * 1024 * 1024)
        self.assertEqual(len(r["err"]), 2 * 1024 * 1024)
        self.assertLess(durata, 12)

    def test_pipe_plin_apoi_citeste_stdin_succes(self):
        copil = ("import sys\n"
                 "sys.stdout.buffer.write(b'o' * (2 * 1024 * 1024)); sys.stdout.flush()\n"
                 "sys.stderr.buffer.write(b'e' * (2 * 1024 * 1024)); sys.stderr.flush()\n"
                 "print(len(sys.stdin.buffer.read()))\n")
        r, _ = self.ruleaza(copil, "x" * (8 * 1024 * 1024))
        self.assertFalse(r["timeout"])
        self.assertEqual(r["exit"], 0)
        self.assertTrue(r["out"].rstrip().endswith(str(8 * 1024 * 1024)))
        self.assertEqual(len(r["err"]), 2 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main(verbosity=2)
