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
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Runda 17: „--validator <alt fișier>” (sau VALIDATOR_FISIER=<alt fișier>) rulează ACELEAȘI cazuri pe altă versiune (ex. cea din
# head-ul revizuit, extrasă cu git show) — dovada că mutanții noi pică pe codul vechi: acolo testul dă ESEC pe cazurile „r17”.
if len(sys.argv) == 3 and sys.argv[1] == "--validator":
    VALIDATOR = Path(sys.argv[2]).resolve()
elif os.environ.get("VALIDATOR_FISIER"):
    VALIDATOR = Path(os.environ["VALIDATOR_FISIER"]).resolve()
else:
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
    # Runda 18 (re-review PR #1115, P1-2 cu plafon): aceeași citire în altă formă decât cea acceptată = PLAFON_FORMA și cu plafonul dat
    caz("r18 artefactul recenzentului cu plafonul 5000", ARTEFACT_P12, ("--plafon-tranzactie-ms", "5000"), 1, "PLAFON_FORMA")
    caz("r18 current_setting('transaction_timeout') cu plafonul 5000",
        "DO $p$ BEGIN IF current_setting('transaction_timeout') IS DISTINCT FROM '5s' THEN RAISE EXCEPTION 'p'; END IF; END $p$;\n",
        ("--plafon-tranzactie-ms", "5000"), 1, "PLAFON_FORMA")
    caz("r18 SHOW transaction_timeout cu plafonul 5000", "SHOW transaction_timeout;\n", ("--plafon-tranzactie-ms", "5000"), 1, "PLAFON_FORMA")
    caz("r18 EXECUTE 'SHOW transaction_timeout' cu plafonul 5000",
        "DO $p$ DECLARE v text; BEGIN EXECUTE 'SHOW transaction_timeout' INTO v; END $p$;\n", ("--plafon-tranzactie-ms", "5000"), 1, "PLAFON_FORMA")
    # P1-1 (umbrirea unui parametru): variabila declarată doar într-un bloc interior, comparația în afara lui vede PARAMETRUL funcției
    caz("r18 parametrul cu acelasi nume, citirea intr-un bloc interior",
        "CREATE FUNCTION public.f_p(v_plafon text) RETURNS void LANGUAGE plpgsql AS $f$\nBEGIN\n"
        "  DECLARE v_plafon text; BEGIN SELECT setting || '/' || source INTO v_plafon " + CITIRE + "; END;\n"
        "  IF v_plafon IS DISTINCT FROM '5000/session' THEN RAISE EXCEPTION 'p %', v_plafon; END IF;\nEND $f$;\n",
        ("--plafon-tranzactie-ms", "5000"), 1, "PLAFON_FORMA")
    caz("r18 CONTROL: aceeasi functie cu declaratia in blocul exterior",
        "CREATE FUNCTION public.f_p() RETURNS void LANGUAGE plpgsql AS $f$\nDECLARE v_plafon text;\nBEGIN\n"
        "  SELECT setting || '/' || source INTO v_plafon " + CITIRE + ";\n"
        "  IF v_plafon IS DISTINCT FROM '5000/session' THEN RAISE EXCEPTION 'p %', v_plafon; END IF;\nEND $f$;\n",
        ("--plafon-tranzactie-ms", "5000"), 0)
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


# Runda 17 (verdictul Jakarinos pe PR #1115, P1-1 / P1-2). Mutanții se aplică pe migrările REALE (octeții din repo), fiecare
# înlocuire EXACT o dată (altfel testul e nefuncțional = ESEC). Așteptările scrise de mână, din verdict (L25).
USCARE = "supabase/migrations/20261225a_executie_uscare.sql"
METEO = "supabase/migrations/20261221a_meteo_xweather_zilnic.sql"
CMP_S = "IS DISTINCT FROM '5000/session'"
CMP_M = "IS DISTINCT FROM '5000:' || txid_current()"
IF_S = "  IF v_plafon " + CMP_S   # runda 18: ancora mutanților P1-1 (exact o dată în fiecare migrare)
FAB = "5000::text || chr(47) || 'session'"   # valoarea fabricată din verdict, fără literalul '/session'
MUTANTI_FORMA = [
    # (eticheta, [(din, in)], cod cu --plafon-tranzactie-ms 5000, fragment din mesaj)
    ("exemplul din verdict: ('2000' || '/session')", [(CMP_S, "IS DISTINCT FROM ('2000' || '/session')")], 1, "PLAFON_FORMA"),
    ("concatenare fara paranteze: '2000' || '/session'", [(CMP_S, "IS DISTINCT FROM '2000' || '/session'")], 1, "PLAFON_FORMA"),
    ("cast pe literalul corect: '5000/session'::text", [(CMP_S, CMP_S + "::text")], 1, "PLAFON_FORMA"),
    ("cast pe concatenare: ('2000' || '/session')::text", [(CMP_S, "IS DISTINCT FROM ('2000' || '/session')::text")], 1, "PLAFON_FORMA"),
    ("CAST(... AS varchar(4)) (trunchiaza)", [(CMP_S, "IS DISTINCT FROM CAST('5000/session' AS varchar(4))")], 1, "PLAFON_FORMA"),
    ("comentariu bloc cu forma buna + concatenare",
     [(CMP_S, "IS DISTINCT FROM /* '5000/session' */ ('2000' || '/session')")], 1, "PLAFON_FORMA"),
    ("comentariu de linie cu forma buna + concatenare",
     [(CMP_S, "IS DISTINCT FROM -- '5000/session'\n       ('2000' || '/session')")], 1, "PLAFON_FORMA"),
    ("literal continuat pe linia urmatoare: '2000/' 'session'", [(CMP_S, "IS DISTINCT FROM '2000/'\n       'session'")], 1, "PLAFON_FORMA"),
    ("literal continuat cu valoarea buna: '5000/' 'session'", [(CMP_S, "IS DISTINCT FROM '5000/'\n       'session'")], 1, "PLAFON_FORMA"),
    ("prefix E'...'", [(CMP_S, "IS DISTINCT FROM E'5000/session'")], 1, "PLAFON_FORMA"),
    ("dollar-quote $s$5000/session$s$", [(CMP_S, "IS DISTINCT FROM $s$5000/session$s$")], 1, "PLAFON_FORMA"),
    ("operatorul <> in loc de IS DISTINCT FROM (NULL = fara refuz)", [("v_plafon " + CMP_S, "v_plafon <> '5000/session'")], 1, "PLAFON_FORMA"),
    ("neutralizat: IF false AND v_plafon ...", [("IF v_plafon " + CMP_S, "IF false AND v_plafon " + CMP_S)], 1, "PLAFON_FORMA"),
    ("neutralizat: ... '5000/session' AND false OR", [(CMP_S + "\n", CMP_S + " AND false\n")], 1, "PLAFON_FORMA"),
    ("neutralizat: IF NOT (v_plafon ...)", [("IF v_plafon " + CMP_S + "\n", "IF NOT (v_plafon " + CMP_S + ")\n")], 1, "PLAFON_FORMA"),
    ("RAISE NOTICE in loc de RAISE EXCEPTION", [("txid_current() THEN\n    RAISE EXCEPTION '20261225a: PLAFON_TRANZACTIE",
                                                  "txid_current() THEN\n    RAISE NOTICE '20261225a: PLAFON_TRANZACTIE")], 1, "PLAFON_FORMA"),
    ("variabila suprascrisa dupa citire", [("WHERE name = 'transaction_timeout';\n",
                                             "WHERE name = 'transaction_timeout';\n  v_plafon := '5000/session';\n")], 1, "PLAFON_FORMA"),
    ("variabila citita a doua oara (SELECT ... INTO)", [("WHERE name = 'transaction_timeout';\n",
                                                          "WHERE name = 'transaction_timeout';\n  SELECT '5000/session' INTO v_plafon;\n")], 1, "PLAFON_FORMA"),
    ("marcajul: '2000' || ':' || txid_current() + forma buna in comentariu",
     [(CMP_M, "IS DISTINCT FROM /* '5000:' || txid_current() */ '2000' || ':' || txid_current()")], 1, "PLAFON_FORMA"),
    ("marcajul: concatenat in plus (|| '')", [(CMP_M, CMP_M + " || ''")], 1, "PLAFON_FORMA"),
    ("marcajul: fara true (current_setting simplu)", [("OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT",
                                                        "OR current_setting('gazpet.plafon_tranzactie') IS DISTINCT")], 1, "PLAFON_FORMA"),
    # (refuzat și de regula brută din runda 16: nicio formă verificabilă a marcajului în fișier)
    ("marcajul: literal continuat '5000' ':'", [(CMP_M, "IS DISTINCT FROM '5000'\n     ':' || txid_current()")], 1, "PLAFON_"),
    ("marcajul scris de migrare (set_config)", [("WHERE name = 'transaction_timeout';\n",
                                                 "WHERE name = 'transaction_timeout';\n  PERFORM set_config('gazpet.plafon_tranzactie', '5000:' || txid_current(), true);\n")],
     1, "PLAFON_FORMA"),
    ("citirea pg_settings in alta forma (fara '/' || source)", [("SELECT setting || '/' || source INTO v_plafon", "SELECT setting INTO v_plafon")],
     1, "PLAFON_FORMA"),
    # controale pozitive: forma acceptata cu spatii / comentarii intre tokeni, si pg_catalog. la marcaj
    ("CONTROL: comentariu intre tokeni, forma buna", [(CMP_S, "IS DISTINCT /* nota */ FROM\n       '5000/session'")], 0, "OK "),
    ("CONTROL: pg_catalog.current_setting / pg_catalog.txid_current", [
        ("OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current()",
         "OR pg_catalog.current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || pg_catalog.txid_current()")], 0, "OK "),
] + [
    # Runda 18 (re-review PR #1115, P1-1): aceeași variabilă scrisă fără tokenul ei simplu. Fiecare inserată IMEDIAT înaintea
    # comparației (ancora IF_S), pe ambele migrări reale; valoarea fabricată fără literalul '/session' (altfel o prindea regula literalului).
    (f"r18 {et}", [(IF_S, ins + "\n" + IF_S)] + extra, 1, "PLAFON_FORMA") for et, ins, extra in [
        ("mutantul recenzentului: \"v_plafon\" := (identificator citat)", '  "v_plafon" := ' + FAB + ";", []),
        ("\"V_PLAFON\" := (citat, alte majuscule; conservator)", '  "V_PLAFON" := ' + FAB + ";", []),
        ("V_Plafon := (neciat, alte majuscule = aceeasi variabila)", "  V_Plafon := " + FAB + ";", []),
        ("SELECT ... INTO \"v_plafon\"", "  SELECT " + FAB + ' INTO "v_plafon";', []),
        ("EXECUTE ... INTO \"v_plafon\"", "  EXECUTE 'SELECT ' || quote_literal(" + FAB + ') INTO "v_plafon";', []),
        ("FOR \"v_plafon\" IN SELECT ... LOOP", '  FOR "v_plafon" IN SELECT ' + FAB + " LOOP NULL; END LOOP;", []),
        ("GET DIAGNOSTICS \"v_plafon\" = PG_CONTEXT", '  GET DIAGNOSTICS "v_plafon" = PG_CONTEXT;', []),
        ("eticheta blocului: <<b>> ... b.v_plafon :=", "  b.v_plafon := " + FAB + ";", [("DO $pre$\n", "DO $pre$\n<<b>>\n")]),
        ("ALIAS FOR intr-un bloc interior", "  DECLARE v_a ALIAS FOR v_plafon; BEGIN v_a := " + FAB + "; END;", []),
        ("umbrire: bloc interior care redeclara numele", "  DECLARE v_plafon text; BEGIN NULL; END;", []),
        ("U&\"\\0076_plafon\" := (escape Unicode in corp)", '  U&"\\0076_plafon" := ' + FAB + ";", []),
        ("eticheta <<raise>> inaintea atribuirii (in_raise vechi)", "  <<raise>> BEGIN v_plafon := " + FAB + "; END;", []),
        ("argument de apel (INOUT posibil)", "  PERFORM public.f_seteaza(v_plafon);", []),
    ]
] + [
    # controale pozitive r18: aceeasi variabila scrisa citat, cu aceleasi litere, in comparatie si in RAISE = acceptata
    ("CONTROL r18: comparatia cu \"v_plafon\" (citat, aceleasi litere)", [(IF_S, IF_S.replace("v_plafon", '"v_plafon"'))], 0, "OK "),
    ("CONTROL r18: coalesce(\"v_plafon\", 'lipsa') in RAISE", [("coalesce(v_plafon, 'lipsa')", "coalesce(\"v_plafon\", 'lipsa')")], 0, "OK "),
]


# Runda 18 (P1-2): artefactul din re-review, octet cu octet (cere 5000 fără „/session” și fără marcaj).
ARTEFACT_P12 = """DO $pre$ BEGIN
 IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN
  RAISE EXCEPTION 'livrare lipsa';
 END IF;
 IF (SELECT setting FROM pg_catalog.pg_settings
     WHERE name = 'transaction_timeout') IS DISTINCT FROM '5000' THEN
  RAISE EXCEPTION 'plafon 5000 necesar';
 END IF;
END $pre$;
"""


def forma_structurala():
    esecuri = []

    def rez(et, bun, detaliu):
        print(f"{'ok' if bun else 'ESEC'} r17: {et}{'' if bun else ' — ' + detaliu[:240]}")
        if not bun:
            esecuri.append("r17: " + et)

    for rel in (USCARE, METEO):
        brut = (ROOT / rel).read_bytes().decode("utf-8")
        sep = "\r\n" if "\r\n" in brut else "\n"
        for et, inloc, exp, frag in MUTANTI_FORMA:
            t = brut
            aplicat = True
            for din, in_ in inloc:
                din, in_ = din.replace("\n", sep), in_.replace("\n", sep)
                if rel == METEO:
                    din, in_ = din.replace("20261225a:", "20261221a:"), in_.replace("20261225a:", "20261221a:")
                if t.count(din) != 1:
                    aplicat = False
                    break
                t = t.replace(din, in_)
            if not aplicat:
                rez(f"{rel.split('/')[-1]}: {et}", False, "mutantul nu se aplica exact o data (proba nefunctionala)")
                continue
            with tempfile.TemporaryDirectory() as d:
                f = Path(d) / Path(rel).name
                f.write_bytes(t.encode("utf-8"))
                rc, out = iesire(f, "reg_test", "--plafon-tranzactie-ms", "5000")
            rez(f"{rel.split('/')[-1]}: {et}: cod {rc} (asteptat {exp})", rc == exp and frag in out, out)
        # P1-2: fara plafon, migrarea care cere plafon = refuz LOCAL (PLAFON_LIPSA), forma runnerului --fara-plafon
        rc, out = iesire(ROOT / rel, "reg_test", "--fara-plafon")
        rez(f"{rel.split('/')[-1]}: runner fara plafon (--fara-plafon) = PLAFON_LIPSA, cod {rc}", rc == 1 and "PLAFON_LIPSA" in out, out)
        t = brut.replace(CMP_S, "IS DISTINCT FROM ('2000' || '/session')").replace(CMP_M, "IS DISTINCT FROM ('2000' || ':') || txid_current()")
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / Path(rel).name
            f.write_bytes(t.encode("utf-8"))
            rc, out = iesire(f, "reg_test", "--fara-plafon")
        rez(f"{rel.split('/')[-1]}: fara plafon, cererea in forma neverificabila = tot PLAFON_LIPSA, cod {rc}", rc == 1 and "PLAFON_LIPSA" in out, out)
    # P1-2: fara plafon, fisierele fara cerere de plafon trec ca inainte (compatibilitate) — cazuri minime
    for et, corp, exp, frag in [
        ("fara nicio cerere", "CREATE TABLE public.t (id integer);\n", 0, "OK "),
        ("garda care cere LIPSA plafonului ('0/default', ca test_livrare_plafon.sh fara)",
         "DO $p$ BEGIN IF (SELECT setting || '/' || source " + CITIRE + ") IS DISTINCT FROM '0/default' THEN RAISE EXCEPTION 'p'; END IF; END $p$;\n",
         0, "OK "),
        ("mutantul r13 fara cerere (SET LOCAL transaction_timeout = 0; regulile vechi fara plafon)",
         "SET LOCAL transaction_timeout = 0;\nSELECT pg_sleep(3);\n", 0, "OK "),
        ("cere 5000 = PLAFON_LIPSA", "DO $p$ BEGIN IF (SELECT setting || '/' || source " + CITIRE + ") IS DISTINCT FROM '5000/session' THEN "
         "RAISE EXCEPTION 'p'; END IF; END $p$;\n", 1, "PLAFON_LIPSA"),
        ("doar marcajul = PLAFON_LIPSA", "DO $p$ BEGIN IF current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || "
         "txid_current() THEN RAISE EXCEPTION 'p'; END IF; END $p$;\n", 1, "PLAFON_LIPSA"),
        ("cererea doar intr-un comentariu (fail-closed) = PLAFON_LIPSA", "-- cere '5000/session'\nSELECT 1;\n", 1, "PLAFON_LIPSA"),
        # Runda 18 (re-review PR #1115, P1-2): citirile explicite ale parametrului = cerere (refuz local), scrierile = regulile vechi
        ("r18 artefactul recenzentului (pg_settings fara '/' || source, '5000')", ARTEFACT_P12, 1, "PLAFON_LIPSA"),
        ("r18 pg_settings comparat cu alta valoare ('5000/client')",
         "DO $p$ BEGIN IF (SELECT setting || '/' || source " + CITIRE + ") IS DISTINCT FROM '5000/client' THEN RAISE EXCEPTION 'p'; END IF; END $p$;\n",
         1, "PLAFON_LIPSA"),
        ("r18 current_setting('transaction_timeout')",
         "DO $p$ BEGIN IF current_setting('transaction_timeout') IS DISTINCT FROM '5s' THEN RAISE EXCEPTION 'p'; END IF; END $p$;\n", 1, "PLAFON_LIPSA"),
        ("r18 SHOW transaction_timeout la nivel superior", "SHOW transaction_timeout;\n", 1, "PLAFON_LIPSA"),
        ("r18 EXECUTE 'SHOW transaction_timeout' INTO v",
         "DO $p$ DECLARE v text; BEGIN EXECUTE 'SHOW transaction_timeout' INTO v; IF v IS DISTINCT FROM '5s' THEN RAISE EXCEPTION 'p'; END IF; END $p$;\n",
         1, "PLAFON_LIPSA"),
        ("r18 EXECUTE format('SHOW %s', 'transaction_timeout')",
         "DO $p$ DECLARE v text; BEGIN EXECUTE format('SHOW %s', 'transaction_timeout') INTO v; END $p$;\n", 1, "PLAFON_LIPSA"),
        ("r18 pg_settings cu numele din bucati ('transaction' || '_timeout')",
         "DO $p$ BEGIN IF (SELECT setting FROM pg_catalog.pg_settings WHERE name = 'transaction' || '_timeout') <> '5000' THEN RAISE EXCEPTION 'p'; END IF; END $p$;\n",
         1, "PLAFON_LIPSA"),
        ("r18 pg_catalog.\"pg_settings\" (identificator citat)",
         "DO $p$ BEGIN IF (SELECT setting FROM pg_catalog.\"pg_settings\" WHERE name = 'transaction_timeout') <> '5000' THEN RAISE EXCEPTION 'p'; END IF; END $p$;\n",
         1, "PLAFON_LIPSA"),
        ("r18 controlul de absenta citit in variabila si comparat cu '0/default' (forma acceptata)",
         "DO $p$ DECLARE v text; BEGIN SELECT setting || '/' || source INTO v " + CITIRE + "; IF v IS DISTINCT FROM '0/default' THEN "
         "RAISE EXCEPTION 'p %', v; END IF; END $p$;\n", 0, "OK "),
        ("r18 controlul de absenta cu citirea si in RAISE (forma test_livrare_plafon.sh fara)",
         "DO $p$ BEGIN IF (SELECT setting || '/' || source " + CITIRE + ") IS DISTINCT FROM '0/default' THEN RAISE EXCEPTION 'p %', "
         "(SELECT setting || '/' || source " + CITIRE + "); END IF; END $p$;\n", 0, "OK "),
        ("r18 scriere: set_config('transaction_timeout', '0', true) in DO (regulile vechi)",
         "DO $d$ BEGIN PERFORM set_config('transaction_timeout', '0', true); END $d$;\n", 0, "OK "),
        ("r18 scriere: EXECUTE 'RESET transaction_timeout' (regulile vechi)", "DO $d$ BEGIN EXECUTE 'RESET transaction_timeout'; END $d$;\n", 0, "OK "),
        ("r18 scriere: ALTER FUNCTION ... SET transaction_timeout = 0 (regulile vechi)", "ALTER FUNCTION public.f() SET transaction_timeout = 0;\n", 0, "OK "),
        ("r18 mentiune doar in comentariu (nu e o citire)", "-- aici nu citim transaction_timeout\nSELECT 1;\n", 0, "OK "),
    ]:
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "a.sql"
            f.write_bytes((GARDA + corp).encode("utf-8"))
            rc, out = iesire(f, "reg_test", "--fara-plafon")
        rez(f"--fara-plafon: {et}: cod {rc} (asteptat {exp})", rc == exp and frag in out, out)
    # P1-2: TOATE migrarile / revenirile din repo: cu --fara-plafon = refuz daca cer plafon, altfel ACELASI rezultat ca fara optiune
    n_cer, n_compat = 0, 0
    for cale in sorted(list((ROOT / "supabase/migrations").glob("*.sql")) + list((ROOT / "supabase/revenire").glob("*.sql"))):
        text = cale.read_bytes().decode("utf-8", "replace")
        cere = "/session" in text.lower() or "plafon_tranzactie" in text.lower()
        rc_f, out_f = iesire(cale, "reg_test", "--fara-plafon")
        rel = cale.relative_to(ROOT).as_posix()
        if cere:
            n_cer += 1
            if not (rc_f == 1 and "PLAFON_LIPSA" in out_f):
                rez(f"{rel}: cere plafon, --fara-plafon cod {rc_f}", False, out_f)
        else:
            rc_0, _ = iesire(cale, "reg_test")
            n_compat += 1
            if rc_f != rc_0:
                rez(f"{rel}: fara cerere de plafon, --fara-plafon cod {rc_f} != fara optiune {rc_0} (compatibilitate)", False, out_f)
    rez(f"repo: {n_cer} fisiere cer plafon (toate PLAFON_LIPSA fara plafon), {n_compat} fara cerere (acelasi cod ca fara optiune)",
        n_cer >= 20 and n_compat >= 100, "prea putine fisiere (proba nefunctionala)")
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
    esecuri += forma_structurala()
    if esecuri:
        print(f"ESEC test_livrare_validator_plafon: {len(esecuri)} caz(uri): {', '.join(esecuri)}")
        return 1
    print(f"PASS test_livrare_validator_plafon: {len(CAZURI)} artefacte + argumente")
    return 0


if __name__ == "__main__":
    sys.exit(main())
