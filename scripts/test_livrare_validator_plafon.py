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


def iesire(cale, *extra):
    r = subprocess.run([sys.executable, str(VALIDATOR), str(cale), *extra], capture_output=True, text=True, encoding="utf-8")
    return r.returncode, (r.stdout + r.stderr).strip()


# Runda 16 (decizia proprietarului, 17.11.2026): --plafon-tranzactie-ms <N> = regulile plafonului + ACORDUL plafonului (fiecare
# plafon cerut de fisier = N). Cazuri minime, valori scrise de mana (L25), plus fisierele reale din repo.
def garda_plafon(d):
    return (f"DO $p$ BEGIN\n  IF ({CITIRE.replace('FROM', 'SELECT setting || ' + chr(39) + '/' + chr(39) + ' || source FROM', 1)}) "
            f"IS DISTINCT FROM '{d}/session'\n     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '{d}:' || "
            f"txid_current() THEN\n    RAISE EXCEPTION 'PLAFON lipsa'; END IF;\nEND $p$;\n")


def acord_plafon():
    esecuri = []

    def caz(et, corp, args, exp, re_mesaj=None):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "a.sql"
            f.write_bytes((GARDA + corp).encode("utf-8"))
            rc, out = iesire(f, "reg_test", *args)
        bun = rc == exp and (re_mesaj is None or re_mesaj in out)
        print(f"{'ok' if bun else 'ESEC'} acord: {et}: cod {rc} (asteptat {exp}){'' if bun else ' — ' + out[:200]}")
        if not bun:
            esecuri.append("acord: " + et)

    caz("cere 5000, runnerul 5000", garda_plafon(5000), ("--plafon-tranzactie-ms", "5000"), 0)
    caz("cere 2000 (plafonul vechi), runnerul 5000", garda_plafon(2000), ("--plafon-tranzactie-ms", "5000"), 1,
        "PLAFON_DIFERIT: fișierul cere 2000 ms")
    caz("cere 5000, runnerul 2000 (runner vechi)", garda_plafon(5000), ("--plafon-tranzactie-ms", "2000"), 1, "runnerul dă 2000 ms")
    caz("garda 5000, marcajul 2000 (amestec)", garda_plafon(5000).replace("'5000:'", "'2000:'"), ("--plafon-tranzactie-ms", "5000"), 1,
        "2000 ms (marcajul")
    caz("antetul de livrare cere 2000, garda 5000", "-- Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000\n" + garda_plafon(5000),
        ("--plafon-tranzactie-ms", "5000"), 1, "2000 ms (antetul")
    caz("marcajul citit fara forma verificabila", "DO $m$ BEGIN PERFORM current_setting('gazpet.plafon_tranzactie', true); END $m$;\n",
        ("--plafon-tranzactie-ms", "5000"), 1, "forma verificabilă")
    caz("fara nicio cerere de plafon (nimic de acordat)", "SELECT 1;\n", ("--plafon-tranzactie-ms", "5000"), 0)
    caz("regulile plafonului raman (SET LOCAL pe ceas)", "SET LOCAL transaction_timeout = 0;\n", ("--plafon-tranzactie-ms", "5000"), 1, "apare de")
    caz("forma veche fara valoare (doar teste statice) nu face acordul", garda_plafon(2000), ("--plafon-tranzactie",), 0)
    for v in ("abc", "050", "99", "600001", "5000ms"):
        caz(f"valoare invalida {v!r}", "SELECT 1;\n", ("--plafon-tranzactie-ms", v), 2)
    # fisierele reale: fiecare migrare / revenire cu plafon declarat trece cu plafonul EI si e refuzata cu oricare altul (fara refuz fals)
    import re as _re
    for cale in sorted(list((ROOT / "supabase/migrations").glob("*.sql")) + list((ROOT / "supabase/revenire").glob("*.sql"))):
        text = cale.read_text(encoding="utf-8")
        vals = set(_re.findall(r"'([0-9]+)/session'", text))
        if len(vals) != 1:
            continue
        d = vals.pop()
        rel = cale.relative_to(ROOT).as_posix()
        rc_vechi, _ = iesire(cale, "reg_test", "--plafon-tranzactie")
        if rc_vechi != 0:
            print(f"info acord {rel}: picat deja cu regulile plafonului (cod {rc_vechi}), nu se compara")
            continue
        rc_ok, out_ok = iesire(cale, "reg_test", "--plafon-tranzactie-ms", d)
        alt = "5000" if d != "5000" else "2000"
        rc_alt, out_alt = iesire(cale, "reg_test", "--plafon-tranzactie-ms", alt)
        bun = rc_ok == 0 and rc_alt == 1 and "PLAFON_DIFERIT" in out_alt
        print(f"{'ok' if bun else 'ESEC'} acord {rel}: cu {d} cod {rc_ok}, cu {alt} cod {rc_alt}{'' if bun else ' — ' + (out_ok + ' | ' + out_alt)[:200]}")
        if not bun:
            esecuri.append("acord: " + rel)
    return esecuri


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
    esecuri += acord_plafon()
    if esecuri:
        print(f"ESEC test_livrare_validator_plafon: {len(esecuri)} caz(uri): {', '.join(esecuri)}")
        return 1
    print(f"PASS test_livrare_validator_plafon: {len(CAZURI)} artefacte + argumente")
    return 0


if __name__ == "__main__":
    sys.exit(main())
