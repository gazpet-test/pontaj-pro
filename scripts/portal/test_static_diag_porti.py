#!/usr/bin/env python3
"""Portal E1 r19: teste statice (fara PostgreSQL, fara bash) pentru diagnosticul portilor 18a.

  python3 scripts/portal/test_static_diag_porti.py

Acopera: taietura (scripts/portal/diag_porti_taie.py) pe artefactul real 18a (CRLF si LF) + refuzurile ei; verificatorul
mesajului de diagnostic (scripts/portal/test_diag_porti_mesaj.py) pe un mesaj construit in forma bibliotecii runnerului
(scripts/livrare_mesaj.sh: lm_verif / lm_mesaj / lm_fin, transcrise aici ca GENERATOR de cazuri, nu ca expected) si pe
mutanti (COMMIT, inregistrare, taietura prea mare / lipsa / cu inlocuire, bloc cu scriere); verificatorul livrarii
(scripts/test_livrare_mesaj_unic.py) trebuie sa REFUZE mesajul de diagnostic. Capat-la-capat (dry_prod_e1.sh
--diagnostic-porti --doar-genereaza): scripts/portal/test_diag_porti.sh (bash); pe cluster PG17: scripts/test_portal_e1.sh.
"""
import hashlib
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M18 = ROOT / "supabase/migrations/20261118a_portal_teren_identitate.sql"
BLOC = ROOT / "scripts/portal/diag_porti.sql"
TAIE = ROOT / "scripts/portal/diag_porti_taie.py"
VERIF = ROOT / "scripts/portal/test_diag_porti_mesaj.py"
VERIF_LIV = ROOT / "scripts/test_livrare_mesaj_unic.py"
NUME = "20261118a_portal_teren_identitate"
ET = "DIAGNOSTIC_PORTI_18a"
PLAFON = 2000
TAG = "lm_0123456789abcdef"
# r21: postconditia 18a = apelul portii intr-o variabila + refuzul cu lista portilor in mesaj (doua linii).
APEL_LINIE = b"  v_porti := public.fn_portal_porti_lipsa();"
POSTCOND_LINIE = (b"  IF v_porti IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_POSTCONDITION_FAILED: % porti: %', "
                  b"coalesce(cardinality(v_porti)::text, 'NECUNOSCUT'), coalesce(array_to_string(v_porti, '; '), 'NECUNOSCUT'); END IF;")


def ruleaza(*a):
    return subprocess.run([sys.executable, *map(str, a)], capture_output=True, text=True)


# --- generatorul de cazuri: textul REAL al runnerului, luat din heredoc-urile scripturilor (scripts/livrare_migrare.sh:
# 0_prolog, 1_pre; scripts/livrare_mesaj.sh: lm_fin), cu substitutia simpla de variabile a bash-ului ($VAR, \$ -> $).
def _heredoc(cale, dupa, cap):
    t = (ROOT / cale).read_text(encoding="utf-8").replace("\r\n", "\n")
    k = t.index(dupa)
    a = t.index("\n", k) + 1
    b = t.index("\n" + cap + "\n", a)
    return t[a:b + 1]


def _bash_var(text, vars_):
    def f(m):
        if m.group(0) == "\\$":
            return "$"
        if m.group(1) not in vars_:
            raise KeyError(f"variabila bash necunoscuta in heredoc: {m.group(1)}")
        return vars_[m.group(1)]
    return re.sub(r"\\\$|\$\{?([A-Z_][A-Z0-9_]*)\}?", f, text)


CIT = "(SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout')"
_RUN = (ROOT / "scripts/livrare_migrare.sh").read_text(encoding="utf-8").replace("\r\n", "\n")
_PC = re.search(r'PLAFON_CHECK="(  IF \$PLAFON_CITIRE.*?)"\n', _RUN, re.S).group(1)
VARS = {"NUME": NUME, "PLAFON_MS": str(PLAFON), "PLAFON_CITIRE": CIT, "LM_PLAFON_CITIRE": CIT, "TINTA_DB": "forma_test",
        "TINTA_SIS": "42", "PROI_CHECK": "", "VERSIUNE": "20261118120000", "CHEIE": "hashtext('gazpet.livrare_migrare')"}
VARS["PLAFON_CHECK"] = _bash_var(_PC, VARS)


def prolog():
    return _bash_var(_heredoc("scripts/livrare_migrare.sh", 'cat > "$DIR/0_prolog.sql" <<SQL', "SQL"), VARS).encode()


def pre1():
    return _bash_var(_heredoc("scripts/livrare_migrare.sh", 'cat > "$DIR/1_pre.sql" <<SQL', "SQL"), VARS).encode()


def verif(total, rpoz, rlung, rsha, felii):
    q = "pg_catalog.convert_to(pg_catalog.current_query(), 'UTF8')"
    s = "DO $mesaj_unic$ BEGIN\n"
    s += f"  IF pg_catalog.octet_length(pg_catalog.current_query()) IS DISTINCT FROM {total:010d}\n"
    s += f"     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.substring({q}, {rpoz:010d}, {rlung:010d})), 'hex') IS DISTINCT FROM '{rsha}'\n"
    for p, l, h in felii:
        s += f"     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.substring({q}, {p:010d}, {l:010d})), 'hex') IS DISTINCT FROM '{h}'\n"
    s += "  THEN\n"
    s += (f"    RAISE EXCEPTION 'Livrare {ET}: MESAJ_UNIC: tranzactia nu a ajuns la server intr-un singur mesaj sau nu e textul "
          f"aprobat (% octeti in mesajul curent, asteptat {total:010d}) - refuz inaintea lock-urilor, nimic comis', "
          f"pg_catalog.octet_length(pg_catalog.current_query()); END IF;\n")
    s += "END $mesaj_unic$;\n"
    return s.encode()


def fin(final="ROLLBACK"):
    v = dict(VARS, NUME=ET, FINAL=final)
    return _bash_var(_heredoc("scripts/livrare_mesaj.sh", "  cat <<SQL", "SQL"), v).encode()


ANTET = ("DO $diag_antet$ BEGIN RAISE NOTICE 'DIAG_PORTI: mesaj de DIAGNOSTIC, NU livrarea: 18a fara postconditie, apoi lista "
         "portilor lipsa; ROLLBACK la final, fara inregistrare in istoric, nimic comis'; END $diag_antet$;\n").encode()


def mesaj(copie_taiata, bloc, coada=b"", final="ROLLBACK", alias="diagnostic_porti_nu_e_livrare"):
    """Ca dry_prod_e1.sh --diagnostic-porti: rest = antet + 1_pre + copia taiata + LF;LF + bloc [+ coada] + garda."""
    rest = ANTET + pre1()
    poz = len(rest)
    rest += copie_taiata + b"\n;\n" + bloc + coada + fin(final)
    felii0 = [(0, len(copie_taiata), hashlib.sha256(copie_taiata).hexdigest())]
    p = len(b"BEGIN;\n" + prolog() + verif(0, 0, 0, hashlib.sha256(rest).hexdigest(), felii0))
    felii = [(p + poz + 1, len(copie_taiata), hashlib.sha256(copie_taiata).hexdigest())]
    M = b"BEGIN;\n" + prolog() + verif(p + len(rest), p + 1, len(rest), hashlib.sha256(rest).hexdigest(), felii) + rest
    assert len(M) == p + len(rest)
    return f"SELECT ${TAG}$".encode() + M + f"${TAG}$ AS {alias} \\gexec\n".encode()


class DiagPorti(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="diag_porti_"))
        cls.copie = M18.read_bytes()
        cls.sha = hashlib.sha256(cls.copie).hexdigest()
        cls.bloc = BLOC.read_bytes()
        r = ruleaza(TAIE, M18, cls.tmp / "taiat.sql")
        assert r.returncode == 0, r.stderr
        cls.taiat = (cls.tmp / "taiat.sql").read_bytes()

    def scrie(self, nume, b):
        f = self.tmp / nume
        f.write_bytes(b)
        return f

    def verifica(self, nume, m5, copie=None, bloc=None):
        cf = self.scrie(nume + "_copie.sql", copie) if copie is not None else M18
        sha = hashlib.sha256(cf.read_bytes()).hexdigest()
        bf = self.scrie(nume + "_bloc.sql", bloc) if bloc is not None else BLOC
        return ruleaza(VERIF, self.scrie(nume + "_5.sql", m5), cf, sha, PLAFON, bf)

    def refuzat(self, nume, m5, motiv, **kw):
        r = self.verifica(nume, m5, **kw)
        self.assertNotEqual(r.returncode, 0, f"{nume}: verificatorul a acceptat un mutant")
        self.assertIn(motiv, r.stderr, f"{nume}: alt motiv: {r.stderr}")

    # --- taietura -----------------------------------------------------------------------------------------------
    def test_taietura_pe_18a(self):
        self.assertNotIn(b"PORTAL_POSTCONDITION_FAILED", self.taiat)
        self.assertNotIn(b"v_porti := public.fn_portal_porti_lipsa();", self.taiat)
        self.assertTrue(self.taiat.rstrip(b"\r\n").endswith(b"END $critic$;"))
        k = self.taiat.index(b"END $critic$;")
        self.assertEqual(self.copie[:k], self.taiat[:k], "tot ce precede pasul 5 se pastreaza")
        sters = self.copie[k:len(self.copie) - (len(self.taiat) - k)]
        self.assertTrue(sters.startswith(b"  -- 5. postconditia (poarta completa)"))
        self.assertEqual(sters.count(b"PORTAL_POSTCONDITION_FAILED"), 1)
        # pasii 1-4 raman (FK-urile, inventarul, lista ERP, clasificarea + conturi_teren)
        for x in (b"conturi_tip_auth_user_id_fkey", b"PORTAL_TERRAIN_INVENTORY_CHANGED", b"PORTAL_ERP_APPROVAL_OWNER_MISSING",
                  b"RAISE NOTICE 'PORTAL_ERP: %, PORTAL_NEAPROBATE: %'", b"INSERT INTO public.conturi_teren"):
            self.assertIn(x, self.taiat)

    def test_taietura_lf_si_crlf(self):
        lf = self.copie.replace(b"\r\n", b"\n")
        crlf = lf.replace(b"\n", b"\r\n")
        for nume, b in (("lf", lf), ("crlf", crlf)):
            r = ruleaza(TAIE, self.scrie(f"t_{nume}.sql", b), self.tmp / f"t_{nume}_out.sql")
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_taietura_refuza(self):
        marc = b"  -- 5. postconditia (poarta completa) si amprenta pentru revenire"
        k = self.copie.index(marc)
        cazuri = {
            "marcaj_dublu": self.copie[:k] + marc + b"\n" + self.copie[k:],
            "fara_marcaj": self.copie.replace(marc, b"  -- 5. altceva"),
            "fara_end": self.copie.replace(b"END $critic$;", b"END $critic2$;"),
            "postcond_mutata": self.copie.replace(POSTCOND_LINIE, b"  NULL;").replace(
                b"DO $critic$", b"DO $critic$ /* " + POSTCOND_LINIE.strip() + b" */", 1),
            # r21: apelul portii mutat dupa refuz (variabila ar fi goala la verificare)
            "apel_dupa_refuz": self.copie.replace(b"\r\n", b"\n").replace(APEL_LINIE + b"\n", b"", 1).replace(
                POSTCOND_LINIE, POSTCOND_LINIE + b"\n" + APEL_LINIE, 1),
            "coada_dupa_end": self.copie.rstrip(b"\r\n") + b"\nSELECT 1;\n",
        }
        for nume, b in cazuri.items():
            out = self.tmp / f"r_{nume}_out.sql"
            r = ruleaza(TAIE, self.scrie(f"r_{nume}.sql", b), out)
            self.assertNotEqual(r.returncode, 0, f"{nume}: taietura a acceptat")
            self.assertFalse(out.exists(), f"{nume}: a scris iesirea la refuz")

    # --- mesajul ------------------------------------------------------------------------------------------------
    def test_mesaj_acceptat(self):
        r = self.verifica("ok", mesaj(self.taiat, self.bloc))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("DIAG_MESAJ_OK", r.stdout)

    def test_verificatorul_livrarii_refuza_diagnosticul(self):
        for alias in ("diagnostic_porti_nu_e_livrare", "livrare_mesaj_unic"):
            m5 = self.scrie(f"liv_{alias}.sql", mesaj(self.taiat, self.bloc, alias=alias))
            r = ruleaza(VERIF_LIV, m5, M18, self.sha, PLAFON, "ROLLBACK")
            self.assertNotEqual(r.returncode, 0, f"verificatorul livrarii a acceptat diagnosticul (alias {alias})")

    def test_alias_de_livrare_refuzat(self):
        self.refuzat("alias", mesaj(self.taiat, self.bloc, alias="livrare_mesaj_unic"), "diagnostic_porti_nu_e_livrare")

    def test_commit_final_refuzat(self):
        self.refuzat("commit_final", mesaj(self.taiat, self.bloc, final="COMMIT"), "asteptat BEGIN / ROLLBACK")

    def test_commit_in_bloc_refuzat(self):
        bloc = self.bloc.replace(b"  v_lista := public.fn_portal_porti_lipsa();", b"  v_lista := public.fn_portal_porti_lipsa(); COMMIT;")
        self.refuzat("commit_bloc", mesaj(self.taiat, bloc), "COMMIT in cod", bloc=bloc)

    def test_inregistrare_refuzata(self):
        coada = b"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261118120000', 'x');\n"
        self.refuzat("inreg", mesaj(self.taiat, self.bloc, coada=coada), "supabase_migrations")

    def test_taietura_prea_mare_refuzata(self):
        k4 = self.copie.index(b"  -- 4. clasificarea")
        s = self.copie.index(b"END $critic$;")
        self.refuzat("prea_mare", mesaj(self.copie[:k4] + self.copie[s:], self.bloc), "comentariu urmat de postconditie")

    def test_fara_taietura_refuzata(self):
        self.refuzat("fara", mesaj(self.copie, self.bloc), "nu s-a taiat nimic")

    def test_inlocuire_refuzata(self):
        inl = self.copie.replace(POSTCOND_LINIE.strip(), b"NULL;")
        self.refuzat("inlocuire", mesaj(inl, self.bloc), "o singura bucata stearsa")

    def test_alta_copie_refuzata(self):
        alt = self.taiat.replace(b"PORTAL_TERRAIN_INVENTORY_CHANGED", b"PORTAL_TERRAIN_INVENTORY_CHANGEX", 1)
        self.refuzat("alta", mesaj(alt, self.bloc), "o singura bucata stearsa")

    def test_bloc_cu_scriere_refuzat(self):
        bloc = self.bloc.replace(b"  v_lista := public.fn_portal_porti_lipsa();",
                                 b"  v_lista := public.fn_portal_porti_lipsa(); DELETE FROM public.conturi_tip;")
        self.refuzat("bloc_scriere", mesaj(self.taiat, bloc), "cuvinte de scriere", bloc=bloc)

    def test_bloc_dinamic_refuzat(self):
        bloc = self.bloc.replace(b"  v_lista := public.fn_portal_porti_lipsa();",
                                 b"  v_lista := public.fn_portal_porti_lipsa(); EXECUTE 'SELECT 1';")
        self.refuzat("bloc_dinamic", mesaj(self.taiat, bloc), "cuvinte de scriere", bloc=bloc)

    def test_bloc_nerevizuit_refuzat(self):
        # mesajul are alt bloc decat fisierul revizuit dat verificatorului
        bloc = self.bloc.replace(b"DIAG_PORTI_CONTEXT pg_net", b"DIAG_PORTI_CONTEXT pg_nex")
        self.refuzat("bloc_alt", mesaj(self.taiat, bloc), "EXACT blocul de diagnostic revizuit")

    def test_octet_schimbat_dupa_calcul_refuzat(self):
        m5 = bytearray(mesaj(self.taiat, self.bloc))
        k = m5.index(b"PORTAL_ERP_APPROVAL_LIST_MISSING")
        m5[k] = ord("Q")
        self.refuzat("octet", bytes(m5), "felia")

    def test_bloc_static(self):
        t = self.bloc.decode("utf-8")
        self.assertNotIn("\\", t)
        self.assertEqual(t.count("$diag_porti$"), 2)
        self.assertEqual(t.count("fn_portal_porti_lipsa()"), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
