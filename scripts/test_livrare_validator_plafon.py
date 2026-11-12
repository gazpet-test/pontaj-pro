"""Runda 11 a runnerului (PR #1054 r2, Jakarinos r13 P2): validatorul cu --plafon-tranzactie, fara PostgreSQL.

Ruleaza:  python3 scripts/test_livrare_validator_plafon.py
Fiecare caz e un artefact minim (cu garda de livrare). Asteptat:
  * cu --plafon-tranzactie: orice atingere a ceasului tranzactiei = REFUZ (cod 1), inclusiv mutantul din verdict
    (SET LOCAL transaction_timeout = 0; SELECT pg_sleep(3)), in DO, in functii create de artefact, prin concatenare,
    RESET / RESET ALL, ALTER ROLE ... SET, citirea necalificata (umbrire prin pg_temp.pg_settings), UPDATE pg_settings;
    citirea exacta „FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'” = acceptata;
  * runda 12: LIMITA scrisa ca test — SQL-ul dinamic din bucati si apelul unei functii existente sunt ACCEPTATE (nu se
    vad static); validatorul e garda de protocol, nu dovada; le prinde garda finala a runnerului;
  * FARA optiune: aceleasi artefacte au exact rezultatul de dinainte (regresie: runda 10 neschimbata);
  * apelul fara tag / cu argumente in plus = cod de utilizare 2.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "scripts" / "livrare_validator.py"
GARDA = ("DO $g$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN RAISE EXCEPTION 'x'; END IF;\n"
         "END $g$;\n")
CITIRE = "FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'"

# (eticheta, corpul artefactului dupa garda, cod cu plafon, cod fara plafon)
CAZURI = [
    ("mutantul Jakarinos r13", "SET LOCAL transaction_timeout = 0;\nSELECT pg_sleep(3);\n", 1, 0),
    ("SET de sesiune", "SET transaction_timeout = '10s';\n", 1, 0),
    ("set_config in DO", "DO $d$ BEGIN PERFORM set_config('transaction_timeout', '0', true); END $d$;\n", 1, 0),
    ("set_config la nivel superior", "SELECT set_config('transaction_timeout', '0', true);\n", 1, 0),
    ("concatenare", "DO $d$ BEGIN PERFORM set_config('transaction' || '_timeout', '0', true); END $d$;\n", 1, 0),
    ("majuscule citate", "SET LOCAL \"TRANSACTION_TIMEOUT\" = 0;\n", 1, 0),
    ("functie cu SET", "CREATE FUNCTION public.f() RETURNS integer LANGUAGE sql SET transaction_timeout = 0 AS $f$ SELECT 1 $f$;\n", 1, 0),
    ("ALTER FUNCTION ... SET", "ALTER FUNCTION public.f() SET transaction_timeout = 0;\n", 1, 0),
    ("ALTER ROLE ... SET", "ALTER ROLE postgres SET transaction_timeout = 0;\n", 1, 0),
    ("RESET in DO", "DO $d$ BEGIN EXECUTE 'RESET transaction_timeout'; END $d$;\n", 1, 0),
    ("RESET ALL in DO", "DO $d$ BEGIN EXECUTE 'RESET   ALL'; END $d$;\n", 1, 0),
    ("RESET la nivel superior", "RESET transaction_timeout;\n", 1, 1),
    ("citire necalificata (umbrire)",
     "DO $d$ DECLARE v text; BEGIN SELECT setting INTO v FROM pg_settings WHERE name = 'transaction_timeout'; END $d$;\n", 1, 0),
    ("UPDATE pg_settings",
     "UPDATE pg_catalog.pg_settings SET setting = '0' WHERE name = 'transaction_timeout';\n", 1, 0),
    ("mentiune in comentariu", "-- aici nu schimbam transaction_timeout\nSELECT 1;\n", 1, 0),
    ("citirea permisa", "DO $d$ DECLARE v text; BEGIN SELECT setting || '/' || source INTO v " + CITIRE + "; END $d$;\n", 0, 0),
    ("citirea permisa de doua ori", ("DO $d$ DECLARE v text; BEGIN SELECT setting INTO v " + CITIRE + "; SELECT source INTO v "
                                     + CITIRE + "; END $d$;\n"), 0, 0),
    ("fara nicio mentiune", "CREATE TABLE public.t_ok (id integer);\n", 0, 0),
    # Runda 12 (Jakarinos r14): LIMITA validatorului, scrisa ca test — formele de mai jos NU se vad static si sunt
    # ACCEPTATE; le prinde garda finala a runnerului (acelasi mesaj cu COMMIT-ul; test_livrare_plafon.sh rearmare/functie).
    ("limita: SQL dinamic din bucati (chr(95))",
     "DO $d$ BEGIN EXECUTE format('SET LOCAL %s = 0', 'transaction' || chr(95) || 'timeout'); END $d$;\n", 0, 0),
    ("limita: apelul unei functii existente", "SELECT public.f_dormi_plafon();\n", 0, 0),
    # Runda 14 (portal r18): cu plafon, tranzactia e UN mesaj (\gexec) => meta-comenzile si variabilele psql din artefact
    # NU mai sunt interpretate de psql (ar ajunge la server ca text). Validatorul le refuza la nivel superior (cu si fara
    # plafon), deci un artefact acceptat nu are niciuna; in corpuri $…$ / E'…' psql nu le interpreta nici in forma veche.
    ("meta: \\set", "\\set x 1\nSELECT 1;\n", 1, 1),
    ("meta: \\i", "SELECT 1;\n\\i alt.sql\n", 1, 1),
    ("meta: \\if / \\endif", "\\if true\nSELECT 1;\n\\endif\n", 1, 1),
    ("meta: \\gexec", "SELECT 'SELECT 1' \\gexec\n", 1, 1),
    ("meta: \\; (lipire de mesaje)", "SELECT 1 \\;\nSELECT 2;\n", 1, 1),
    ("meta: \\! (comanda de sistem)", "\\! sleep 1\nSELECT 1;\n", 1, 1),
    ("variabila psql :x", "SELECT :x;\n", 1, 1),
    ("variabila psql :'x'", "SELECT :'x';\n", 1, 1),
    ("backslash in corp $…$ (plpgsql, la executie)", "DO $d$ BEGIN PERFORM E'a\\\\nb'; END $d$;\n", 0, 0),
    ("backslash in E'…' la nivel superior", "SELECT E'a\\\\nb';\n", 0, 0),
]


def ruleaza(cale, *extra):
    return subprocess.run([sys.executable, str(VALIDATOR), str(cale), *extra], capture_output=True, text=True,
                          encoding="utf-8").returncode


def main():
    esecuri = []
    with tempfile.TemporaryDirectory() as d:
        for k, (et, corp, exp_p, exp_f) in enumerate(CAZURI):
            f = Path(d) / f"c{k}.sql"
            f.write_bytes((GARDA + corp).encode("utf-8"))
            p, fara = ruleaza(f, "reg_test", "--plafon-tranzactie"), ruleaza(f, "reg_test")
            stare = "ok" if (p, fara) == (exp_p, exp_f) else "ESEC"
            print(f"{stare} {et}: cu plafon {p} (asteptat {exp_p}), fara {fara} (asteptat {exp_f})")
            if stare != "ok":
                esecuri.append(et)
        f = Path(d) / "u.sql"
        f.write_bytes((GARDA + "SELECT 1;\n").encode("utf-8"))
        for args, exp in ((("--plafon-tranzactie",), 0), (("reg_test", "x", "y"), 2), (("--alt",), 2), ((), 0)):
            rc = ruleaza(f, *args)
            stare = "ok" if rc == exp else "ESEC"
            print(f"{stare} argumente {list(args)}: cod {rc} (asteptat {exp})")
            if stare != "ok":
                esecuri.append(f"argumente {list(args)}")
    # Fisierele portalului (livrate cu plafon) trebuie acceptate cu --plafon-tranzactie.
    for rel in ("supabase/migrations/20261118a_portal_teren_identitate.sql",
                "supabase/migrations/20261119a_portal_teren_provisioning.sql",
                "supabase/revenire/20261118a_portal_teren_identitate_ROLLBACK.sql",
                "supabase/revenire/20261119a_portal_teren_provisioning_ROLLBACK.sql"):
        cale = ROOT / rel
        if not cale.exists():
            print(f"n/a {rel} (nu exista pe acest branch)")
            continue
        rc = ruleaza(cale, "reg_test", "--plafon-tranzactie")
        stare = "ok" if rc == 0 else "ESEC"
        print(f"{stare} {rel}: cod {rc} cu --plafon-tranzactie (asteptat 0)")
        if stare != "ok":
            esecuri.append(rel)
    # Runda 14: 20261213a (livrat cu plafon 3000) si revenirea lui — INFORMATIV (constatare raportata, nu poarta aici).
    for rel in ("supabase/migrations/20261213a_executie_acces_proiect_perf.sql",
                "supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql"):
        cale = ROOT / rel
        if cale.exists():
            print(f"info {rel}: cod {ruleaza(cale, 'reg_test', '--plafon-tranzactie')} cu --plafon-tranzactie")
    if esecuri:
        print(f"ESEC test_livrare_validator_plafon: {len(esecuri)} caz(uri): {', '.join(esecuri)}")
        return 1
    print(f"PASS test_livrare_validator_plafon: {len(CAZURI)} artefacte + argumente")
    return 0


if __name__ == "__main__":
    sys.exit(main())
