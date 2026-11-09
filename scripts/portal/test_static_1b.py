#!/usr/bin/env python3
"""Verificari statice E1-1b; nu inlocuiesc PostgreSQL sau GoTrue real."""
from pathlib import Path
import importlib.util
import os
import subprocess
import sys
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations/20261119a_portal_teren_provisioning.sql'
REV = ROOT / 'supabase/revenire/20261119a_portal_teren_provisioning_ROLLBACK.sql'
FACTS = ROOT / 'docs/portal_angajat/fapte_prod/handle_new_user_27_10.sql'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('delivery_validator', ROOT / 'scripts/livrare_validator.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def live_source():
    facts = FACTS.read_text(encoding='utf-8')
    definition = facts.strip()
    return definition.split('AS $function$', 1)[1].rsplit('$function$', 1)[0]


class StaticProvisioning(unittest.TestCase):
    def test_delivery_artifacts(self):
        for path in (MIG, REV):
            with self.subTest(path=path.name):
                result = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts/livrare_validator.py'), str(path)],
                                        cwd=ROOT, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                                        capture_output=True, text=True, encoding='utf-8')
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_manifest_is_anchored_to_supplied_live_source(self):
        sql = MIG.read_text(encoding='utf-8')
        expected = sql.split('$live_source$', 2)[1]
        self.assertEqual(expected, live_source())
        self.assertIn("p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'", sql)
        self.assertIn("'sha256',encode(sha256(convert_to(v_manifest::text,'UTF8'))", sql)
        fixture = (ROOT / 'supabase/tests/portal_e1_1b_fixture.sql').read_text(encoding='utf-8')
        self.assertEqual(fixture.split('AS $function$', 1)[1].split('$function$', 1)[0], live_source())

    def test_ordinary_account_body_is_preserved_exactly_except_initial_role(self):
        sql = MIG.read_text(encoding='utf-8')
        body = sql.split('AS $function$', 1)[1].split('$function$', 1)[0]
        declaration = '  v_portal_emp integer; v_portal_id uuid; v_portal public.portal_provisioning%ROWTYPE;\n'
        self.assertEqual(body.count(declaration), 1)
        restored = body.replace(declaration, '', 1)
        start = restored.index("\n  IF NEW.raw_app_meta_data->>'tip_cont' = 'teren' THEN")
        end = restored.index('\n  END IF;\n', start) + len('\n  END IF;\n')
        branch = restored[start:end]
        # Ramura teren se incheie inainte de prima scriere legacy/notificare.
        self.assertIn('RETURN NEW;', branch)
        self.assertNotIn('fn_cont_notifica_owneri', branch)
        self.assertNotIn('manager_santier', branch)
        restored = restored[:start] + restored[end:]
        restored = restored.replace("    'in_asteptare'", "    'manager_santier'", 1)
        self.assertEqual(restored, live_source())

    def test_client_executable_functions_have_no_identity_writer_or_dynamic_sql(self):
        sql = MIG.read_text(encoding='utf-8')
        for name in ('fn_portal_cont_pregateste', 'fn_cont_aproba_erp'):
            definition = sql.split('CREATE FUNCTION public.' + name, 1)[1].split('$fn$;', 1)[0]
            tokens = validator.instructiuni(definition.split('AS $fn$', 1)[1], strict=False)
            words = [word for _, row in tokens for word in row]
            for forbidden in ('EXECUTE', 'SET_CONFIG'):
                self.assertNotIn(forbidden, words)
            self.assertNotIn('request.jwt', definition.lower())
            self.assertIn('auth.uid()', definition)

    def test_rollback_locks_before_snapshot_and_restores_manifest(self):
        sql = REV.read_text(encoding='utf-8')
        self.assertLess(sql.index('LOCK TABLE auth.users'), sql.index('public.fn_portal_1b_snapshot()'))
        self.assertIn("EXECUTE m->>'definition'", sql)
        self.assertIn("v_actual IS DISTINCT FROM m-'sha256'", sql)
        self.assertNotIn(' CASCADE', sql)

    def test_snapshot_is_allow_list_not_whole_schema(self):
        # r3: o migrare a altui modul sau o editare HR nu inroseste poarta 1b si nu blocheaza revenirea.
        sql = MIG.read_text(encoding='utf-8')
        body = sql.split('CREATE FUNCTION public.fn_portal_1b_snapshot()', 1)[1].split('$fn$;', 1)[0]
        for whole in ("FROM public.employees t", "FROM public.profiles t", "FROM public.user_module_access t",
                      "WHERE n.nspname='public' AND a.attnum", "WHERE n.nspname='public'\n   UNION ALL",
                      "(n.nspname='public' OR p.oid IN"):
            self.assertNotIn(whole, body)
        # callee-urile tranzitive ale lui handle_new_user (din migrarea 20260929c) si triggerul Auth sunt amprentate
        for signature in ("'public.handle_new_user()'", "'public.fn_cont_candidati_angajat(text)'",
                          "'public.fn_nume_cuvinte(text)'", "'public.fn_nume_familie(text)'", "'extensions.unaccent(text)'",
                          "'public.fn_cont_notifica_owneri(text, text, text, text)'", "'auth.uid()'", "'auth.jwt()'"):
            self.assertIn(signature, body)
        self.assertIn("(n.nspname='auth' AND c.relname='users')", body)
        self.assertIn("t.tgname='portal_revoca_la_plecare'", body)
        self.assertIn("c.conrelid='public.profiles'::regclass", body)
        # fiecare functie din migrare care ruleaza ca DEFINER sau e trigger al portalului e in lista alba
        for name in re.findall(r'CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\(', sql):
            self.assertIn("'public." + name + '(', body, name)
        # Jakarinos r3 P1: callee-urile tranzitive ale triggerelor de pe profiles (paritate cu migrarile din repo)
        for name in ('fn_profiles_protectie_legatura', 'fn_identitate_privilegiata', 'fn_identitate_claims',
                     'fn_identitate_eticheta', 'fn_profiles_campuri_owner_only', 'prevent_role_escalation',
                     'enforce_owner_only_salary_flags', 'protect_can_access_pontaj_brut'):
            self.assertIn("'public." + name + "()'", body, name)

    def test_profiles_trigger_closure_matches_repo_migrations(self):
        # Paritate (L19): fiecare trigger creat pe profiles in migrarile din repo are functia si callee-urile ei
        # (functii public definite in repo) in lista alba 1b. Nu inlocuieste confirmarea pe prod (inventar, sectiunea 8).
        body = MIG.read_text(encoding='utf-8').split('CREATE FUNCTION public.fn_portal_1b_snapshot()', 1)[1].split('$fn$;', 1)[0]
        files = sorted(f for f in (ROOT / 'supabase/migrations').glob('*.sql') if 'ROLLBACK' not in f.name.upper())
        defs, trig = {}, {}
        fn_re = re.compile(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(.*?\bAS\s+(\$[a-z0-9_]*\$)(.*?)\2', re.I | re.S)
        tg_re = re.compile(r'CREATE\s+TRIGGER\s+([a-z0-9_]+)\s+.*?\s+ON\s+public\.profiles\s+.*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?([a-z0-9_]+)\s*\(', re.I | re.S)
        for f in files:
            text = re.sub(r'--[^\n]*', '', f.read_text(encoding='utf-8', errors='replace'))
            for m in fn_re.finditer(text):
                defs[m.group(1).lower()] = m.group(3).lower()
            for m in tg_re.finditer(text):
                trig[m.group(1).lower()] = m.group(2).lower()
        todo, seen = [fn for fn in trig.values() if not fn.startswith('portal_test')], set()
        while todo:
            fn = todo.pop()
            if fn in seen or fn not in defs:
                continue
            seen.add(fn)
            todo += [c for c in re.findall(r'\b(?:public\.)?([a-z_][a-z0-9_]*)\s*\(', defs[fn]) if c in defs and c != fn]
        self.assertTrue(seen)
        for fn in sorted(seen):
            self.assertIn("'public." + fn + "(", body, fn)

    def test_hook_and_provisioning_share_employee_predicate(self):
        sql = MIG.read_text(encoding='utf-8')
        body = sql.split('CREATE OR REPLACE FUNCTION public.fn_teren_eligibil', 1)[1].split('$fn$;', 1)[0]
        self.assertIn('public.fn_portal_angajat_eligibil(e.id) IS TRUE', body)
        self.assertNotIn('termination_date', body)
        self.assertIn("ARRAY['handle_live','eligibil_live']", REV.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
