#!/usr/bin/env python3
"""Verificari statice locale. NU sunt dovada de executie PostgreSQL/Auth."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261118a_portal_teren_identitate.sql"
ROLLBACK = ROOT / "supabase/revenire/20261118a_portal_teren_identitate_ROLLBACK.sql"
GENERATOR = ROOT / "scripts/portal/prepare_fixture.py"
VALIDATOR = ROOT / "scripts/livrare_validator.py"


def run(script, *args):
    return subprocess.run(
        [sys.executable, "-X", "utf8", str(script), *map(str, args)],
        capture_output=True, text=True, encoding="utf-8", cwd=ROOT,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )


class StaticDelivery(unittest.TestCase):
    def test_original_artifacts_pass_delivery_validator(self):
        for path in (MIGRATION, ROLLBACK):
            with self.subTest(path=path.name):
                result = run(VALIDATOR, path)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(result.stdout.startswith("OK "))

    def test_fixture_is_separate_and_reproducible(self):
        before = MIGRATION.read_bytes()
        scratch = ROOT / ".tmp"
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="portal_static_", dir=scratch) as folder:
            a, b = Path(folder) / "a.sql", Path(folder) / "b.sql"
            for path in (a, b):
                result = run(GENERATOR, MIGRATION, path)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            sql = a.read_text(encoding="utf-8")
            self.assertEqual(sql.count("'public.portal_fixture_public_"), 21)
            self.assertNotIn("PORTAL_PUBLIC_REVIEWED_SIGNATURES", sql)
            result = run(VALIDATOR, a)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(MIGRATION.read_bytes(), before)
        self.assertIn(b"ARRAY[]::text[] /* PORTAL_PUBLIC_REVIEWED_SIGNATURES */", before)

    def test_fixture_refuses_missing_or_duplicate_marker(self):
        scratch = ROOT / ".tmp"
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="portal_bad_fixture_", dir=scratch) as folder:
            source, target = Path(folder) / "source.sql", Path(folder) / "target.sql"
            for sql in ("SELECT 1;", MIGRATION.read_text(encoding="utf-8") * 2):
                source.write_text(sql, encoding="utf-8")
                result = run(GENERATOR, source, target)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("HOLD", result.stderr)
                self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
