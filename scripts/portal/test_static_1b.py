#!/usr/bin/env python3
"""Verificari statice E1-1b; nu inlocuiesc PostgreSQL sau GoTrue real."""
from pathlib import Path
import importlib.util
import json
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
        # Jakarinos r4 P2: configuratia secventelor din lista alba, fara contor (last_value nu e in pg_sequence)
        self.assertIn("FROM pg_sequence s WHERE s.seqrelid IN (SELECT oid FROM rel)", body)
        self.assertNotIn("last_value", body)
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

    def test_anchor_query_parity_and_fail_closed(self):
        # r7 (Jakarinos r6 P1): aceeasi interogare de ancore in fisierul comun, in migrare si in inventar (L19).
        def bloc(path):
            text = path.read_text(encoding='utf-8').replace('\r\n', '\n')
            self.assertEqual(text.count('-- ANCORE_1B_START'), 1, path.name)
            return text[text.index('-- ANCORE_1B_START'):text.index('-- ANCORE_1B_END')]
        comun = bloc(ROOT / 'scripts/portal/ancore_1b.sql')
        self.assertEqual(bloc(MIG), comun)
        self.assertEqual(bloc(ROOT / 'scripts/portal/inventar_prod_e1.sql'), comun)
        sql = MIG.read_text(encoding='utf-8').replace('\r\n', '\n')
        m = re.findall(r"CREATE TEMP TABLE portal_1b_ancore_revizuit ON COMMIT DROP AS\nSELECT '(.*?)'::jsonb AS v; -- PORTAL_1B_ANCORE\n", sql, re.S)
        self.assertEqual(len(m), 1)
        if m[0] == '{}':
            self.assertIn("IF (SELECT v FROM pg_temp.portal_1b_ancore_revizuit) = '{}'::jsonb", sql)
        else:
            ancore = json.loads(m[0].replace("''", "'"))
            self.assertEqual(set(ancore), {'functii', 'triggere'})
        # verificarea ancorelor e prima dupa lock-uri si se repeta inaintea fixarii amprentei
        self.assertLess(sql.index('LOCK TABLE public.employees'), sql.index('DO $ancore_pre$'))
        self.assertLess(sql.index('DO $ancore_pre$'), sql.index('CREATE TABLE public.portal_e1_1b_manifest'))
        post = sql.split('DO $post$', 1)[1]
        self.assertLess(post.index('pg_temp.portal_1b_ancore()'), post.index("'post_snapshot'"))

    def test_fixture_1b_replaces_only_anchor_literal(self):
        gen = ROOT / 'scripts/portal/prepare_fixture_1b.py'
        folder = ROOT / '.tmp'
        folder.mkdir(exist_ok=True)
        good = folder / 'ancore_ok.json'
        good.write_text(json.dumps({'functii': {"public.f()": ["x", "postgres", False, None, None]},
                                    'triggere': {"public.profiles:t": ["O", "y", "public.f()"]}}), encoding='utf-8')
        bad = folder / 'ancore_bad.json'
        bad.write_text(json.dumps({'functii': {}, 'triggere': {}}), encoding='utf-8')
        out = folder / 'mig_1b_fixture.sql'
        try:
            r = subprocess.run([sys.executable, '-X', 'utf8', str(gen), str(MIG), str(out), '--ancore', str(good)],
                               capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(r.returncode, 0, r.stderr)
            a = MIG.read_text(encoding='utf-8').replace('\r\n', '\n')
            b = out.read_text(encoding='utf-8')
            self.assertNotEqual(a, b)
            self.assertEqual(re.sub(r"SELECT '.*?'::jsonb AS v; -- PORTAL_1B_ANCORE", '', a, flags=re.S),
                             re.sub(r"SELECT '.*?'::jsonb AS v; -- PORTAL_1B_ANCORE", '', b, flags=re.S))
            v = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts/livrare_validator.py'), str(out)],
                               capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(v.returncode, 0, v.stderr)
            out.unlink()
            r = subprocess.run([sys.executable, '-X', 'utf8', str(gen), str(MIG), str(out), '--ancore', str(bad)],
                               capture_output=True, text=True, encoding='utf-8')
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('HOLD', r.stderr)
            self.assertFalse(out.exists())
        finally:
            for f in (good, bad, out):
                if f.exists():
                    f.unlink()

    def test_hook_and_provisioning_share_employee_predicate(self):
        sql = MIG.read_text(encoding='utf-8')
        body = sql.split('CREATE OR REPLACE FUNCTION public.fn_teren_eligibil', 1)[1].split('$fn$;', 1)[0]
        self.assertIn('public.fn_portal_angajat_eligibil(e.id) IS TRUE', body)
        self.assertNotIn('termination_date', body)
        self.assertIn("ARRAY['handle_live','eligibil_live']", REV.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
