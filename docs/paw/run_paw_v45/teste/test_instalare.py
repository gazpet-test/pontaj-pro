# Teste pentru comanda de instalare v4.3 din docs/paw/LANSATOR_UNIC_PAW.md (Jakarinos r1 P1-c), fara admin. Rulare:
#   python -I docs\paw\run_paw_v43\teste\test_instalare.py
# Extrage blocurile PowerShell din doc (exact textul pe care il lipeste Razvan), le verifica sintactic, apoi ruleaza pasul 2
# pe un "bin" TEMPORAR care contine v4.2 (din git: origin/ocrlab/banca-etichetare) - C:\ProgramData nu e atins.
# Scenarii: instalare reusita; hash GRESIT dupa copiere -> restaurare automata + verificare; copiere intrerupta -> restaurare;
# bin care nu e v4.2 -> oprire fara modificari; gemini_pw.py deja prezent -> oprire. ASCII only.
import os, re, sys, time, shutil, subprocess, tempfile, unittest, hashlib

AICI = os.path.dirname(os.path.abspath(__file__))
SURSA = os.path.realpath(os.path.join(AICI, ".."))
REPO = os.path.realpath(os.path.join(AICI, "..", "..", "..", ".."))
DOC = os.path.join(REPO, "docs", "paw", "LANSATOR_UNIC_PAW.md")
REF_V42 = "origin/ocrlab/banca-etichetare:docs/ocrlab/run_paw_v4/"
V42 = {"run_paw.ps1": "18BF75BD0938102B772537FC215D55993DF1604F372569ED25A54A4BBFC818F0",
       "run_paw.cmd": "028110D18B61EFEBDDB1702CFD85161FC4ABE347FA54B82ABE79A3DE3610AE85"}
BIN_REAL = "$bin = 'C:\\ProgramData\\Gazpet\\Paw\\bin'"
F_REAL = "$f = 'C:\\Users\\Public\\livrare\\run_paw_v43\\docs\\paw\\run_paw_v43'"
DATA_REAL = "$data = 'C:\\Users\\Public\\paw-data'"
COPIERE ="  foreach ($n in $nou.Keys) { Copy-Item -LiteralPath (Join-Path $f $n) -Destination (Join-Path $bin $n) -Force }"


def sha(p):
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest().upper()


def blocuri():
    with open(DOC, encoding="utf-8") as f:
        txt = f.read().replace("\r\n", "\n")
    sec = txt[txt.index("## v4.3"):]
    b = re.findall(r"```powershell\n(.*?)```", sec, re.S)
    assert len(b) == 2, "astept 2 blocuri powershell in sectiunea v4.3 (pasul 1, pasul 2)"
    return b


class Instalare(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = os.path.realpath(tempfile.mkdtemp(prefix="paw_v43_inst_"))
        cls.pas1, cls.pas2 = blocuri()
        cls.v42 = {}
        for n in V42:
            r = subprocess.run(["git", "-C", REPO, "show", REF_V42 + n], capture_output=True)
            if r.returncode != 0:
                raise unittest.SkipTest("v4.2 indisponibil in git (" + REF_V42 + ")")
            cls.v42[n] = r.stdout
            assert hashlib.sha256(r.stdout).hexdigest().upper() == V42[n], "v4.2 din git nu are hash-ul instalat: " + n

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def fara_rulari_reale(self):
        # pasul 2 refuza (corect) cat ruleaza Paw pe server; testele care asteapta succes se sar in acest caz
        cmd = ("@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run_paw\\.(ps1|cmd)|cgpt_pw\\.py|gemini_pw\\.py' }).Count")
        r = subprocess.run(["powershell.exe", "-NoProfile", "-Command", cmd], capture_output=True, timeout=60)
        if r.stdout.decode().strip() not in ("0", ""):
            self.skipTest("rulari Paw reale active pe server - pasul 2 ar refuza")

    def bin_v42(self, nume):
        b = os.path.join(self.tmp, nume)
        os.makedirs(b)
        os.makedirs(os.path.join(b, "_data"))           # paw-data temporar pentru verificarea lock-urilor v4.2
        for n, cont in self.v42.items():
            with open(os.path.join(b, n), "wb") as f:
                f.write(cont)
        return b

    def ruleaza_pas2(self, b, injectie_inainte_de_copiere="", injectie_dupa_copiere="", injectie_dupa_backup=""):
        s = self.pas2
        if injectie_dupa_backup:
            a = '"BACKUP OK: $vechi"\n'
            self.assertEqual(s.count(a), 1)
            s = s.replace(a, a + injectie_dupa_backup + "\n")
        self.assertEqual(s.count(BIN_REAL), 1)
        self.assertEqual(s.count(F_REAL), 1)
        self.assertEqual(s.count(COPIERE), 1)
        self.assertEqual(s.count(DATA_REAL), 1)
        s = s.replace(BIN_REAL, "$bin = '" + b + "'").replace(F_REAL, "$f = '" + SURSA + "'")
        s = s.replace(DATA_REAL, "$data = '" + os.path.join(b, "_data") + "'")
        self.assertNotIn("C:\\Users\\Public\\paw-data", s)
        s = s.replace(COPIERE, injectie_inainte_de_copiere + COPIERE + injectie_dupa_copiere)
        self.assertNotIn("ProgramData", s)
        p = os.path.join(self.tmp, os.path.basename(b) + "_pas2.ps1")
        with open(p, "w", encoding="utf-8-sig") as f:
            f.write(s)
        r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", p], capture_output=True, timeout=120)
        return r.returncode, r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")

    def backupuri(self, b):
        return [d for d in os.listdir(b) if d.startswith("vechi_v4_2_")]

    def e_v42(self, b):
        for n, h in V42.items():
            self.assertEqual(sha(os.path.join(b, n)), h, n)
        self.assertFalse(os.path.exists(os.path.join(b, "gemini_pw.py")))

    # --- sintaxa ---
    def test_sintaxa_ambele_blocuri(self):
        for i, s in enumerate((self.pas1, self.pas2), 1):
            p = os.path.join(self.tmp, "sintaxa%d.ps1" % i)
            with open(p, "w", encoding="utf-8-sig") as f:
                f.write(s)
            cmd = ("$e=$null; $t=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('%s', [ref]$t, [ref]$e); "
                   "if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }" % p)
            r = subprocess.run(["powershell.exe", "-NoProfile", "-Command", cmd], capture_output=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stdout.decode("utf-8", "replace"))
            self.assertIn("$ErrorActionPreference = 'Stop'", s)

    def test_hashurile_din_doc_sunt_ale_fisierelor(self):
        for n in ("run_paw.ps1", "run_paw.cmd", "gemini_pw.py"):
            h = sha(os.path.join(SURSA, n))
            for s in (self.pas1, self.pas2):
                self.assertIn("'%s' = '%s'" % (n, h), s, n)

    # --- pasul 2 ---
    def test_instalare_reusita(self):
        self.fara_rulari_reale()
        b = self.bin_v42("ok")
        rc, out = self.ruleaza_pas2(b)
        self.assertEqual(rc, 0, out)
        self.assertIn("BACKUP OK", out)
        self.assertIn("INSTALAT v4.3 OK", out)
        for n in ("run_paw.ps1", "run_paw.cmd", "gemini_pw.py"):
            self.assertEqual(sha(os.path.join(b, n)), sha(os.path.join(SURSA, n)), n)
        bk = self.backupuri(b)
        self.assertEqual(len(bk), 1)
        for n, h in V42.items():
            self.assertEqual(sha(os.path.join(b, bk[0], n)), h)

    def test_hash_gresit_dupa_copiere_restaureaza(self):
        self.fara_rulari_reale()
        b = self.bin_v42("stricat")
        rc, out = self.ruleaza_pas2(b, injectie_dupa_copiere="\n  Add-Content -LiteralPath (Join-Path $bin 'run_paw.cmd') -Value 'stricat'")
        self.assertNotEqual(rc, 0, out)
        self.assertIn("hash GRESIT la run_paw.cmd", out)
        self.assertIn("instalare anulata; v4.2 restaurat si verificat pe hash", out)
        self.e_v42(b)

    def test_copiere_intrerupta_restaureaza(self):
        self.fara_rulari_reale()
        b = self.bin_v42("intrerupt")
        inj = ("  Copy-Item -LiteralPath (Join-Path $f 'run_paw.ps1') -Destination (Join-Path $bin 'run_paw.ps1') -Force\n"
               "  Copy-Item -LiteralPath (Join-Path $f 'gemini_pw.py') -Destination (Join-Path $bin 'gemini_pw.py') -Force\n"
               "  throw 'copiere intrerupta (simulat)'\n")
        rc, out = self.ruleaza_pas2(b, injectie_inainte_de_copiere=inj)
        self.assertNotEqual(rc, 0, out)
        self.assertIn("instalare anulata; v4.2 restaurat si verificat pe hash (motiv: copiere intrerupta", out)
        self.e_v42(b)

    def test_bin_care_nu_e_v42_nu_se_atinge(self):
        b = self.bin_v42("altceva")
        with open(os.path.join(b, "run_paw.ps1"), "ab") as f:
            f.write(b"# modificat\n")
        h0 = sha(os.path.join(b, "run_paw.ps1"))
        rc, out = self.ruleaza_pas2(b)
        self.assertNotEqual(rc, 0, out)
        self.assertIn("in bin nu e v4.2", out)
        self.assertEqual(sha(os.path.join(b, "run_paw.ps1")), h0)
        self.assertEqual(self.backupuri(b), [])
        self.assertFalse(os.path.exists(os.path.join(b, "gemini_pw.py")))

    # --- r3 (Jakarinos r2 P2a): instalarea refuza cat exista rulari v4.2 in curs ---
    def neatins(self, b):
        self.e_v42(b)
        self.assertEqual(self.backupuri(b), [])

    def test_proces_lansator_activ_refuza(self):
        b = self.bin_v42("procactiv")
        fals = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(90)", r"C:\ProgramData\Gazpet\Paw\bin\run_paw.ps1"])
        try:
            time.sleep(0.5)
            rc, out = self.ruleaza_pas2(b)
        finally:
            fals.kill(); fals.wait()
        self.assertNotEqual(rc, 0, out)
        self.assertIn("rulari Paw active (procese: python.exe#%d" % fals.pid, out)
        self.neatins(b)

    def test_proces_canal_activ_refuza(self):
        b = self.bin_v42("canalactiv")
        fals = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(90)", r"C:\ProgramData\Gazpet\Paw\bin\cgpt_pw.py", "trimite"])
        try:
            time.sleep(0.5)
            rc, out = self.ruleaza_pas2(b)
        finally:
            fals.kill(); fals.wait()
        self.assertNotEqual(rc, 0, out)
        self.assertIn("rulari Paw active", out)
        self.neatins(b)

    def test_lock_cop_v42_recent_refuza(self):
        self.fara_rulari_reale()
        b = self.bin_v42("lockrecent")
        with open(os.path.join(b, "_data", "lock_cop_6abc000f"), "w") as f:
            f.write("20261016-120000-abcdef")
        rc, out = self.ruleaza_pas2(b)
        self.assertNotEqual(rc, 0, out)
        self.assertIn("lock-uri v4.2 recente: lock_cop_6abc000f", out)
        self.neatins(b)

    def test_lock_cop_v42_vechi_nu_blocheaza(self):
        self.fara_rulari_reale()
        b = self.bin_v42("lockvechi")
        p = os.path.join(b, "_data", "lock_cop_6abc000f")
        with open(p, "w") as f:
            f.write("rulare moarta")
        t = time.time() - 2 * 3600
        os.utime(p, (t, t))
        rc, out = self.ruleaza_pas2(b)
        self.assertEqual(rc, 0, out)
        self.assertIn("INSTALAT v4.3 OK", out)

    def test_a_doua_verificare_inainte_de_copiere(self):
        # o rulare care apare intre backup si copiere opreste instalarea inainte de orice copiere
        self.fara_rulari_reale()
        b = self.bin_v42("adoua")
        rc, out = self.ruleaza_pas2(b, injectie_dupa_backup="Set-Content -LiteralPath (Join-Path $data 'lock_cop_6ac5006f') -Value 'nou'")
        self.assertNotEqual(rc, 0, out)
        self.assertIn("lock-uri v4.2 recente: lock_cop_6ac5006f", out)
        self.e_v42(b)
        self.assertNotIn("INSTALAT", out)

    def test_gemini_pw_deja_prezent_opreste(self):
        b = self.bin_v42("dejagem")
        with open(os.path.join(b, "gemini_pw.py"), "w") as f:
            f.write("# alt fisier\n")
        rc, out = self.ruleaza_pas2(b)
        self.assertNotEqual(rc, 0, out)
        self.assertIn("gemini_pw.py exista deja", out)
        self.assertEqual(self.backupuri(b), [])
        for n, h in V42.items():
            self.assertEqual(sha(os.path.join(b, n)), h)


if __name__ == "__main__":
    unittest.main(verbosity=2)
