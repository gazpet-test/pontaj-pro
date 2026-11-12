#!/usr/bin/env python3
"""Verificari statice locale. NU sunt dovada de executie PostgreSQL/Auth."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261118a_portal_teren_identitate.sql"
ROLLBACK = ROOT / "supabase/revenire/20261118a_portal_teren_identitate_ROLLBACK.sql"
GENERATOR = ROOT / "scripts/portal/prepare_fixture.py"
VALIDATOR = ROOT / "scripts/livrare_validator.py"
OWNER = "00000000-0000-0000-0000-000000000001"


def run(script, *args):
    return subprocess.run(
        [sys.executable, "-X", "utf8", str(script), *map(str, args)],
        capture_output=True, text=True, encoding="utf-8", cwd=ROOT,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )


def amprente(folder, public=21, net=12):
    path = Path(folder) / f"amprente_{public}_{net}.json"
    data = {
        "public": {f"public.portal_fixture_public_{i:02d}()": hashlib.md5(f"p{i}".encode()).hexdigest() for i in range(1, public + 1)},
        "net": {f"net.portal_fixture_net_{i:02d}()": hashlib.md5(f"n{i}".encode()).hexdigest() for i in range(1, net + 1)},
    }
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def scratch():
    folder = ROOT / ".tmp"
    folder.mkdir(exist_ok=True)
    return folder


class StaticDelivery(unittest.TestCase):
    def test_original_artifacts_pass_delivery_validator(self):
        for path in (MIGRATION, ROLLBACK):
            with self.subTest(path=path.name):
                result = run(VALIDATOR, path)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(result.stdout.startswith("OK "))

    def test_production_artifact_fails_closed_until_reviewed(self):
        # r3: lista ERP si amprentele net se completeaza din inventarul read-only; necompletate = refuz atomic la apply.
        sql = MIGRATION.read_text(encoding="utf-8").replace("\r\n", "\n")
        erp = re.findall(r"CREATE TEMP TABLE portal_erp_aprobat ON COMMIT DROP AS\nSELECT ARRAY\[(.*?)\]::text\[\] AS lista;", sql, re.S)
        self.assertEqual(len(erp), 1)
        listed = re.findall(r"'([0-9a-f]{64})'", erp[0])
        if not listed:
            self.assertIn("PORTAL_ERP_APPROVAL_LIST_MISSING", sql)
        else:
            # lista completata (10.11.2026): doar hash-uri sha256 distincte, nimic altceva intre paranteze
            self.assertEqual(len(listed), len(set(listed)))
            self.assertEqual(len(listed), 27)
            rest = re.sub(r"'[0-9a-f]{64}'|,|\s|--[^\n]*", "", erp[0])
            self.assertEqual(rest, "")
        net = re.findall(r"AS \$nethash\$(.*?)\$nethash\$;", sql, re.S)
        self.assertEqual(len(net), 1)
        if "'{}'::jsonb" in net[0]:
            self.assertIn("IF public.fn_portal_net_md5() = '{}'::jsonb", sql)
        # Inventarul nu mai deduce aprobarea din legatura cu fisa / dreptul pe modul / is_owner.
        insert = sql.split("INSERT INTO public.conturi_tip(auth_user_id,tip,sursa)", 1)[1].split(";", 1)[0]
        for forbidden in ("user_module_access", "employee_id", "is_owner"):
            self.assertNotIn(forbidden, insert)
        self.assertIn("pg_temp.portal_erp_aprobat", insert)
        # Fara UUID-uri sau emailuri noi in migrare: lista contine doar hash-uri.
        self.assertEqual(set(re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", erp[0])), set())

    def test_fixture_is_separate_and_reproducible(self):
        before = MIGRATION.read_bytes()
        with tempfile.TemporaryDirectory(prefix="portal_static_", dir=scratch()) as folder:
            fp = amprente(folder)
            a, b = Path(folder) / "a.sql", Path(folder) / "b.sql"
            for path in (a, b):
                result = run(GENERATOR, MIGRATION, path, "--amprente", fp, "--net-rel-necompletat", "--erp", OWNER)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            sql = a.read_text(encoding="utf-8")
            self.assertEqual(sql.count("'public.portal_fixture_public_"), 21)
            self.assertNotIn("public.update_stoc_rezervor()", sql)
            self.assertIn('"net.portal_fixture_net_12()"', sql)
            self.assertNotIn("'{}'::jsonb;\n$nethash$", sql)
            self.assertIn("'" + hashlib.sha256(OWNER.encode()).hexdigest() + "'", sql)
            # r7 (Jakarinos r6 P2): owner-ul net = supabase_admin in productie, postgres numai in copia de harness
            self.assertIn("c_net_owner CONSTANT text := 'postgres';", sql)
            self.assertIn(b"c_net_owner CONSTANT text := 'supabase_admin';", before)
            self.assertIn(b"pg_get_userbyid(p.proowner)=c_net_owner", before)
            result = run(VALIDATOR, a)
            self.assertEqual(result.returncode, 0, result.stderr)
            # Fara --erp, lista ramane goala (testul negativ din harness).
            c = Path(folder) / "c.sql"
            result = run(GENERATOR, MIGRATION, c, "--amprente", fp, "--net-rel-necompletat")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotRegex(c.read_text(encoding="utf-8").split("AS lista;", 1)[0].rsplit("SELECT ARRAY[", 1)[1], "[0-9a-f]{64}")
        self.assertEqual(MIGRATION.read_bytes(), before)
        # lista alba de productie: exact cele 21 de semnaturi revizuite (inventar prod 27.10)
        self.assertIn(b"'public.update_stoc_rezervor()'", before)
        self.assertIn(b"'public.fn_trg_categorie_cantitate()'", before)

    def test_r9_no_account_addresses_and_teren_hashes(self):
        # r9 (decizia lui Razvan 11.11): fara adresele conturilor teren in migrare / revenire; lista = 3 hash-uri sha256.
        sql = MIGRATION.read_text(encoding="utf-8")
        for path in (MIGRATION, ROLLBACK):
            self.assertEqual(re.findall(r"[A-Za-z0-9._%+-]+@teren\.gazpet\.ro", path.read_text(encoding="utf-8")), [], path.name)
        block = re.findall(r"CREATE TEMP TABLE portal_teren_aprobat ON COMMIT DROP AS\nSELECT h,employee_id FROM \(VALUES\n"
                           r" -- PORTAL_TEREN_APROBAT:[^\n]*\n(.*?)\n\) v\(h,employee_id\);", sql, re.S)
        self.assertEqual(len(block), 1)
        rows = re.findall(r"^ \('([0-9a-f]{64})',(55|70|NULL::integer)\),?$", block[0], re.M)
        self.assertEqual(len(rows), 3)
        self.assertEqual(len({h for h, _ in rows}), 3)
        self.assertEqual(sorted(e for _, e in rows), ["55", "70", "NULL::integer"])
        self.assertIn("pg_temp.portal_teren_aprobat", sql.split("INSERT INTO public.conturi_tip(auth_user_id,tip,sursa)", 1)[1].split(";", 1)[0])

    def test_r9_fixture_replaces_teren_hashes(self):
        fixture_ids = ["e1000000-0000-0000-0000-000000000055=55", "e1000000-0000-0000-0000-000000000070=70",
                       "e1000000-0000-0000-0000-0000000000ff="]
        with tempfile.TemporaryDirectory(prefix="portal_teren_", dir=scratch()) as folder:
            fp = amprente(folder)
            out = Path(folder) / "t.sql"
            result = run(GENERATOR, MIGRATION, out, "--amprente", fp, "--net-rel-necompletat", "--erp", OWNER, "--teren", *fixture_ids)
            self.assertEqual(result.returncode, 0, result.stderr)
            sql = out.read_text(encoding="utf-8")
            for value in fixture_ids:
                uid, emp = value.split("=")
                self.assertIn(" ('" + hashlib.sha256(uid.encode()).hexdigest() + "'," + (emp or "NULL::integer") + ")", sql)
            self.assertNotIn("d079d33f9dc730e243177bdfd52c6d1ee1d63a3ed5a2609538b5d9cb33b76a64", sql)
            self.assertEqual(run(VALIDATOR, out).returncode, 0)
            for bad in (fixture_ids[:2], fixture_ids + ["e1000000-0000-0000-0000-0000000000aa=1"], ["nu-e-uuid=1"] + fixture_ids[1:]):
                out.unlink(missing_ok=True)
                result = run(GENERATOR, MIGRATION, out, "--amprente", fp, "--net-rel-necompletat", "--teren", *bad)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("HOLD", result.stderr)
                self.assertFalse(out.exists())

    def test_r9_lock_budget_contract(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("buget_lock", ROOT / "scripts/portal/buget_lock.py")
        buget = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(buget)
        mig = MIGRATION.read_text(encoding="utf-8").replace("\r\n", "\n")
        moduri = {"auth.users": "SHARE ROW EXCLUSIVE", "public.employees": "SHARE ROW EXCLUSIVE", "public.profiles": "SHARE"}
        # r10: 18a creeaza tabelele portalului inainte de $locks$ (fara FK); existente = doar tabelele utilizatorilor.
        fn_mig = buget.functii_care_citesc([mig], buget.TABELE_UTILIZATORI)
        self.assertTrue({"fn_teren_eligibil", "fn_portal_porti_lipsa", "fn_auth_token_hook"} <= fn_mig, fn_mig)
        self.assertEqual(buget.probleme(mig, moduri, (), fn_mig), [])
        rev = ROLLBACK.read_text(encoding="utf-8").replace("\r\n", "\n")
        rev_moduri = {"auth.users": "ACCESS EXCLUSIVE", "public.employees": "ACCESS EXCLUSIVE"}
        fn_rev = buget.functii_care_citesc([mig], buget.TABELE_UTILIZATORI + buget.TABELE_18A)
        self.assertEqual(buget.probleme(rev, rev_moduri, buget.TABELE_18A, fn_rev), [])
        # Tabelele portalului: create INAINTE de $locks$, fara REFERENCES; FK-urile, inventarul teren si ERP in $critic$.
        i = mig.index("DO $locks$")
        for before in ("CREATE TABLE public.conturi_tip (", "CREATE TABLE public.conturi_teren (", "DO $liste_pre$"):
            self.assertLess(mig.index(before), i, before)
        for t in ("conturi_tip (", "conturi_teren (", "conturi_tip_jurnal ("):
            self.assertNotIn("REFERENCES", mig.split("CREATE TABLE public." + t, 1)[1].split(");", 1)[0], t)
        crit = mig.split("DO $critic$", 1)[1]
        for after in ("ADD CONSTRAINT conturi_tip_auth_user_id_fkey", "ADD CONSTRAINT conturi_teren_auth_user_id_fkey",
                      "ADD CONSTRAINT conturi_teren_employee_id_fkey", "PORTAL_TERRAIN_INVENTORY_CHANGED",
                      "PORTAL_ERP_APPROVAL_LIST_CHANGED", "PORTAL_ERP_APPROVAL_OWNER_MISSING",
                      "INSERT INTO public.conturi_tip(auth_user_id,tip,sursa)", "PORTAL_POSTCONDITION_FAILED"):
            self.assertIn(after, crit, after)
        # 18a nu citeste si nu blocheaza user_module_access (in afara comentariilor).
        self.assertNotIn("user_module_access", "\n".join(l for l in mig.splitlines() if not l.lstrip().startswith("--")))
        # Revenirea: atestarea si drepturile inaintea lock-urilor; lock-urile inaintea verificarii (L14), in $critic$.
        self.assertLess(rev.index("DO $auth$"), rev.index("DO $locks$"))
        rcrit = rev.split("DO $critic$", 1)[1]
        self.assertLess(rcrit.index("PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG"), rcrit.index("DROP TABLE public.conturi_tip;"))
        # r10: mutanti ai contractului (al doilea recenzent r9 P1-01, Jakarinos r9 P2).
        L = "DO $locks$"
        mutanti = {
            "SELECT pe profiles inainte de $locks$": mig.replace(L, "SELECT count(*) FROM public.profiles;\n" + L, 1),
            "FK pe conturi_tip inainte": mig.replace("  auth_user_id uuid PRIMARY KEY,\n  tip text",
                                                      "  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id),\n  tip text", 1),
            "functie sql pe employees": mig.replace(L, "CREATE FUNCTION public.x() RETURNS bigint LANGUAGE sql AS $q$ SELECT count(*) FROM public.employees $q$;\n" + L, 1),
            "DO cu poarta inainte": mig.replace(L, "DO $q$ BEGIN PERFORM public.fn_portal_porti_lipsa(); END $q$;\n" + L, 1),
            "lock consultativ blocant": mig.replace("IF NOT pg_try_advisory_xact_lock(", "PERFORM pg_advisory_xact_lock(", 1),
            "a doua instructiune dupa $locks$": mig.replace("END $locks$;\n", "END $locks$;\nSELECT 1;\n", 1),
            # r12: fisierul nu are voie sa schimbe transaction_timeout; plafonul se verifica in $pre$
            # (r14: 2000/session + marcajul plafonului, citit din pg_catalog.pg_settings calificat).
            "plafon repornit in $locks$ (r11)": mig.replace("  RAISE NOTICE 'PORTAL_LOCKS 18a",
                "  PERFORM set_config('transaction_timeout', '0', true);\n  PERFORM set_config('transaction_timeout', '2s', true);\n  RAISE NOTICE 'PORTAL_LOCKS 18a", 1),
            "SET LOCAL transaction_timeout la inceput": mig.replace("SET LOCAL statement_timeout = '15s';\n",
                "SET LOCAL statement_timeout = '15s';\nSET LOCAL transaction_timeout = '2s';\n", 1),
            "fara verificarea plafonului": mig.replace("IF v_plafon IS DISTINCT FROM '2000/session'", "IF false", 1),
            # r14: optiunea de conectare (r12-r13, sursa 'client') nu ajunge prin pooler => nu mai e acceptata.
            "plafon acceptat din conexiune (r13)": mig.replace("'2000/session'", "'2000/client'", 1),
            "fara marcajul plafonului": mig.replace(
                "    OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN", "    THEN", 1),
            # r14 (al doilea recenzent r13 P1): pg_settings necalificat poate fi umbrit de pg_temp.pg_settings.
            "pg_settings necalificat (umbrire)": mig.replace("FROM pg_catalog.pg_settings WHERE", "FROM pg_settings WHERE", 1),
            "mentiune a ceasului in comentariu": mig.replace(L, "-- aici nu schimbam transaction_timeout\n" + L, 1),
            "verificarea plafonului dupa lock-ul consultativ": mig.replace(
                "  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';\n", "", 1).replace(
                "    RAISE EXCEPTION 'PORTAL_ALREADY_EXISTS';\n",
                "    RAISE EXCEPTION 'PORTAL_ALREADY_EXISTS';\n  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';\n", 1),
            "reincercare socotita de la $locks$": mig.replace("IF clock_timestamp() >= now() + interval '1 second' THEN",
                "IF clock_timestamp() >= statement_timestamp() + interval '1 second' THEN", 1),
            "RESET in DO": mig.replace("DO $liste_pre$\nDECLARE v text[];\nBEGIN\n", "DO $liste_pre$\nDECLARE v text[];\nBEGIN\n  RESET ALL;\n", 1),
        }
        for nume, text in mutanti.items():
            with self.subTest(mutant=nume):
                self.assertNotEqual(text, mig, nume)
                self.assertNotEqual(buget.probleme(text, moduri, (), fn_mig), [], nume)
        for nume, text in {
            "rev: SELECT pe conturi_tip inainte": rev.replace(L, "SELECT count(*) FROM public.conturi_tip;\n" + L, 1),
            "rev: plafon repornit in $locks$ (r11)": rev.replace("  RAISE NOTICE 'PORTAL_LOCKS 18a revenire",
                "  PERFORM set_config('transaction_timeout', '2s', true);\n  RAISE NOTICE 'PORTAL_LOCKS 18a revenire", 1),
            "rev: fara verificarea plafonului": rev.replace("IF v_plafon IS DISTINCT FROM '2000/session'", "IF false", 1),
            "rev: pg_settings necalificat (umbrire)": rev.replace("FROM pg_catalog.pg_settings WHERE", "FROM pg_settings WHERE", 1),
        }.items():
            with self.subTest(mutant=nume):
                self.assertNotEqual(text, rev, nume)
                self.assertNotEqual(buget.probleme(text, rev_moduri, buget.TABELE_18A, fn_rev), [], nume)
        # Proba efectiva de drepturi pe rol (subtranzactie anulata intentionat).
        priv = mig.split("DO $priv$", 1)[1].split("END $priv$;", 1)[0]
        for needle in ("CREATE ROLE portal_e1_proba_drepturi", "GRANT portal_e1_proba_drepturi TO authenticator",
                       "RAISE EXCEPTION 'PORTAL_PROBA_DREPTURI_OK'", "has_table_privilege(t,'REFERENCES')"):
            self.assertIn(needle, priv)

    def test_fixture_refuses_missing_or_duplicate_marker(self):
        with tempfile.TemporaryDirectory(prefix="portal_bad_fixture_", dir=scratch()) as folder:
            fp = amprente(folder)
            source, target = Path(folder) / "source.sql", Path(folder) / "target.sql"
            for sql in ("SELECT 1;", MIGRATION.read_text(encoding="utf-8") * 2):
                source.write_text(sql, encoding="utf-8")
                result = run(GENERATOR, source, target, "--amprente", fp, "--net-rel-necompletat")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("HOLD", result.stderr)
                self.assertFalse(target.exists())

    def test_r22_fixture_net_rel(self):
        # r22: copia de harness primeste amprentele pg_net ale clusterului (--net-rel); artefactul ramane DE_COMPLETAT.
        chei = ["net._http_response", "net.http_request_queue", "net.http_request_queue_id_seq"]
        gol = '{' + ','.join(f'"{k}":"DE_COMPLETAT"' for k in chei) + '}'
        before = MIGRATION.read_bytes()
        self.assertEqual(before.replace(b"\r\n", b"\n").decode("utf-8").count(gol), 1)
        with tempfile.TemporaryDirectory(prefix="portal_net_rel_", dir=scratch()) as folder:
            fp = amprente(folder)
            ok_json, rau_json = Path(folder) / "ok.json", Path(folder) / "rau.json"
            ok_json.write_text(json.dumps(dict(zip(chei, ["a" * 32, "b" * 32, "c" * 32]))), encoding="utf-8")
            rau_json.write_text(json.dumps(dict(zip(chei[:2], ["a" * 32, "b" * 32]))), encoding="utf-8")
            out = Path(folder) / "n.sql"
            result = run(GENERATOR, MIGRATION, out, "--amprente", fp, "--net-rel", ok_json, "--erp", OWNER)
            self.assertEqual(result.returncode, 0, result.stderr)
            sql = out.read_text(encoding="utf-8")
            self.assertNotIn("DE_COMPLETAT\"", sql.split("PORTAL_NET_REL_APROBAT", 1)[1].split("$netrel$;", 1)[0])
            self.assertIn('"net.http_request_queue":"' + "b" * 32 + '"', sql)
            self.assertEqual(run(VALIDATOR, out).returncode, 0)
            for extra in (["--net-rel", rau_json], ["--net-rel", ok_json, "--net-rel-necompletat"], []):
                out.unlink(missing_ok=True)
                result = run(GENERATOR, MIGRATION, out, "--amprente", fp, *extra)
                self.assertNotEqual(result.returncode, 0, extra)
                self.assertFalse(out.exists())
        self.assertEqual(MIGRATION.read_bytes(), before)

    def test_fixture_refuses_bad_fingerprints_or_uuid(self):
        with tempfile.TemporaryDirectory(prefix="portal_bad_fp_", dir=scratch()) as folder:
            target = Path(folder) / "target.sql"
            for fp, extra in ((amprente(folder, public=20), []), (amprente(folder, net=11), []),
                              (amprente(folder), ["--erp", "nu-e-uuid"])):
                result = run(GENERATOR, MIGRATION, target, "--amprente", fp, "--net-rel-necompletat", *extra)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("HOLD", result.stderr)
                self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
