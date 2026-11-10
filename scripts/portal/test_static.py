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
                result = run(GENERATOR, MIGRATION, path, "--amprente", fp, "--erp", OWNER)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            sql = a.read_text(encoding="utf-8")
            self.assertEqual(sql.count("'public.portal_fixture_public_"), 21)
            self.assertNotIn("public.update_stoc_rezervor()", sql)
            self.assertIn('"net.portal_fixture_net_12()"', sql)
            self.assertNotIn("'{}'::jsonb;\n$nethash$", sql)
            self.assertIn("'" + hashlib.sha256(OWNER.encode()).hexdigest() + "'", sql)
            result = run(VALIDATOR, a)
            self.assertEqual(result.returncode, 0, result.stderr)
            # Fara --erp, lista ramane goala (testul negativ din harness).
            c = Path(folder) / "c.sql"
            result = run(GENERATOR, MIGRATION, c, "--amprente", fp)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotRegex(c.read_text(encoding="utf-8").split("AS lista;", 1)[0].rsplit("SELECT ARRAY[", 1)[1], "[0-9a-f]{64}")
        self.assertEqual(MIGRATION.read_bytes(), before)
        # lista alba de productie: exact cele 21 de semnaturi revizuite (inventar prod 27.10)
        self.assertIn(b"'public.update_stoc_rezervor()'", before)
        self.assertIn(b"'public.fn_trg_categorie_cantitate()'", before)

    def test_fixture_refuses_missing_or_duplicate_marker(self):
        with tempfile.TemporaryDirectory(prefix="portal_bad_fixture_", dir=scratch()) as folder:
            fp = amprente(folder)
            source, target = Path(folder) / "source.sql", Path(folder) / "target.sql"
            for sql in ("SELECT 1;", MIGRATION.read_text(encoding="utf-8") * 2):
                source.write_text(sql, encoding="utf-8")
                result = run(GENERATOR, source, target, "--amprente", fp)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("HOLD", result.stderr)
                self.assertFalse(target.exists())

    def test_fixture_refuses_bad_fingerprints_or_uuid(self):
        with tempfile.TemporaryDirectory(prefix="portal_bad_fp_", dir=scratch()) as folder:
            target = Path(folder) / "target.sql"
            for fp, extra in ((amprente(folder, public=20), []), (amprente(folder, net=11), []),
                              (amprente(folder), ["--erp", "nu-e-uuid"])):
                result = run(GENERATOR, MIGRATION, target, "--amprente", fp, *extra)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("HOLD", result.stderr)
                self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
