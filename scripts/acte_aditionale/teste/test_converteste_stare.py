# Test converteste_stare.py pe fisiere sintetice (director temporar). Rulare: python scripts/acte_aditionale/teste/test_converteste_stare.py
import contextlib, glob, io, os, shutil, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import converteste_stare as cs  # noqa: E402

VECHI = ('\ufeffZ:\\Oferte\\1.TRANSGAZ\\114. Proiect unu\\Act aditional 1.pdf\t317729|2025-04-09T05:49:07\r\n'
         'Z:\\Oferte\\1.TRANSGAZ\\114. Proiect unu\\Act aditional 2 .pdf\t704630|2025-06-17T16:02:32\r\n'
         '\\\\gazpet-tnas\\Licitatii_Executate\\Oferte\\2.ALTII\\AA 3.pdf\t1000|2026-09-23T16:17:04\r\n'
         'Oferte\\deja\\relativ.pdf\t5|2026-01-01T00:00:00\r\n')


class T(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix='stare_test_')
        self.f = os.path.join(self.d, 'stare.tsv')

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def scrie(self, text):
        with open(self.f, 'w', encoding='utf-8', newline='') as f:
            f.write(text)

    def citeste(self):
        with open(self.f, 'rb') as f:
            return f.read()

    def ruleaza(self, *arg):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            cod = cs.main(list(arg) + ['--fisier', self.f])
        return cod, buf.getvalue()

    def test_preview_nu_scrie(self):
        self.scrie(VECHI)
        inainte = self.citeste()
        cod, out = self.ruleaza('--preview')
        self.assertEqual(cod, 0)
        self.assertIn('randuri: 4 | de convertit: 3 | deja relative: 1', out)
        self.assertIn('-> Oferte\\1.TRANSGAZ\\114. Proiect unu\\Act aditional 1.pdf', out)
        self.assertIn('--aplica --asteptat 3', out)
        self.assertEqual(self.citeste(), inainte)

    def test_aplica_cere_asteptat(self):
        self.scrie(VECHI)
        inainte = self.citeste()
        self.assertEqual(self.ruleaza('--aplica')[0], 5)
        self.assertEqual(self.ruleaza('--aplica', '--asteptat', '2')[0], 7)
        self.assertEqual(self.citeste(), inainte)

    def test_aplica_si_idempotent(self):
        self.scrie(VECHI)
        cod, out = self.ruleaza('--aplica', '--asteptat', '3')
        self.assertEqual(cod, 0, out)
        brut = self.citeste()
        self.assertTrue(brut.startswith(b'\xef\xbb\xbf'))  # BOM, ca PowerShell 5.1
        linii = brut.decode('utf-8-sig').split('\r\n')
        self.assertEqual(linii[-1], '')
        linii = linii[:-1]
        self.assertEqual(len(linii), 4)
        for l in linii:
            k, v = l.split('\t')
            self.assertFalse(k[1:2] == ':' or k.startswith('\\\\'), k)
        self.assertIn('Oferte\\2.ALTII\\AA 3.pdf\t1000|2026-09-23T16:17:04', linii)
        copii = glob.glob(self.f + '.inainte_*')
        self.assertEqual(len(copii), 1)
        with open(copii[0], encoding='utf-8', newline='') as f:
            self.assertEqual(f.read(), VECHI)
        # a doua oara: nimic de convertit, fisierul ramane neatins
        cod, out = self.ruleaza('--preview')
        self.assertIn('de convertit: 0 | deja relative: 4', out)
        cod, out = self.ruleaza('--aplica', '--asteptat', '0')
        self.assertEqual(cod, 0)
        self.assertEqual(self.citeste(), brut)

    def test_probleme_blocheaza_aplicarea(self):
        self.scrie(VECHI + 'Y:\\alt\\drive.pdf\t1|x\r\nrand fara tab\r\n')
        inainte = self.citeste()
        cod, out = self.ruleaza('--preview')
        self.assertIn('probleme: 2', out)
        self.assertEqual(self.ruleaza('--aplica', '--asteptat', '3')[0], 6)
        self.assertEqual(self.citeste(), inainte)

    def test_duplicate(self):
        # aceeasi cale ca Z:\ si ca UNC: valori egale -> comasate; valori diferite -> problema
        dup = ('Z:\\Oferte\\a.pdf\t1|t\r\n\\\\gazpet-tnas\\Licitatii_Executate\\Oferte\\A.pdf\t1|t\r\n')
        self.scrie(dup)
        cod, out = self.ruleaza('--aplica', '--asteptat', '2')
        self.assertEqual(cod, 0, out)
        self.assertEqual(self.citeste().decode('utf-8-sig'), 'Oferte\\a.pdf\t1|t\r\n')
        self.scrie('Z:\\Oferte\\a.pdf\t1|t\r\nOferte\\a.pdf\t2|t\r\n')
        self.assertEqual(self.ruleaza('--aplica', '--asteptat', '1')[0], 6)

    def test_lipsa_fisier(self):
        os.rmdir(self.d)
        self.assertEqual(self.ruleaza('--preview')[0], 3)


if __name__ == '__main__':
    unittest.main(verbosity=2)
