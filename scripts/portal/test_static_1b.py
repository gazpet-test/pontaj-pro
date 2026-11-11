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


# r8 (Jakarinos r8 P2): numitor INDEPENDENT de literalul verificat. Triggerele de pe calea portalului din inventarul
# read-only pe prod din 10.11.2026 (sectiunea 8, alta rulare decat ancorele din 11.11): cheie -> functia triggerului.
TRIGGERE_REVIZUITE = {
    'auth.users:on_auth_user_created': 'public.handle_new_user()',
    'public.notifications:trg_notificari_ruteaza_ofertare': 'public.fn_notificari_ruteaza_ofertare()',
    'public.profiles:prevent_role_escalation_trigger': 'public.prevent_role_escalation()',
    'public.profiles:trg_enforce_owner_only_salary_flags': 'public.enforce_owner_only_salary_flags()',
    'public.profiles:trg_profiles_campuri_owner_only': 'public.fn_profiles_campuri_owner_only()',
    'public.profiles:trg_profiles_protectie_legatura': 'public.fn_profiles_protectie_legatura()',
    'public.profiles:trg_protect_can_access_pontaj_brut': 'public.protect_can_access_pontaj_brut()',
}
# Contractul functiilor: (owner, SECURITY DEFINER, proconfig). Functiile Supabase (auth, extensions) sunt INVOKER fara
# config; functiile public de pe cale sunt DEFINER cu search_path fix (inventarul 10.11, sectiunile 5 / 8).
CONTRACT_SUPABASE = {'auth.uid()': ('supabase_auth_admin', False, None),
                     'auth.jwt()': ('supabase_auth_admin', False, None),
                     'extensions.unaccent(text)': ('supabase_admin', False, None)}
CONTRACT_PUBLIC = ('postgres', True, ['search_path=public, pg_temp'])
ACL_ITEM = re.compile(r'^[a-z_]*=[a-zA-Z*]+/[a-z_]+$')


def numite_din_interogare(text):
    """Cele 10 functii numite in lista IN (...) a interogarii de ancore (text normalizat LF)."""
    lista = text.split('-- ANCORE_1B_START', 1)[1].split(' IN (', 1)[1].split(')\n', 1)[0] + ')'
    numite = set(re.findall(r"'([a-z_]+\.[a-z_]+\([a-z, ]*\))'", lista))
    if len(numite) != 10:
        raise AssertionError(f'interogarea de ancore numeste {len(numite)} functii, nu 10')
    return numite


def probleme_ancore(ancore, numite):
    """Lista abaterilor unei valori de ancore fata de contract; goala = acceptat (folosita si pe mutanti)."""
    p = []
    if not isinstance(ancore, dict) or set(ancore) != {'functii', 'triggere'}:
        return ['chei']
    tr, fn = ancore['triggere'], ancore['functii']
    if not isinstance(tr, dict) or not isinstance(fn, dict):
        return ['tipuri']
    if set(tr) != set(TRIGGERE_REVIZUITE):
        p.append('set triggere')
    for k, a in tr.items():
        if not (isinstance(a, list) and len(a) == 3 and a[0] == 'O' and isinstance(a[1], str)
                and re.fullmatch(r'[0-9a-f]{32}', a[1]) and a[2] == TRIGGERE_REVIZUITE.get(k)):
            p.append('trigger ' + k)
    asteptat = set(numite) | (set(TRIGGERE_REVIZUITE.values()) - {'public.handle_new_user()'})
    if set(fn) != asteptat:
        p.append('set functii')
    for s, a in fn.items():
        if not (isinstance(a, list) and len(a) == 5):
            p.append('forma ' + s)
            continue
        contract = CONTRACT_SUPABASE.get(s, CONTRACT_PUBLIC if s.startswith('public.') else None)
        if contract is None or (a[1], a[2], a[3]) != contract:
            p.append('contract ' + s)
        if not (isinstance(a[0], str) and re.fullmatch(r'[0-9a-f]{32}', a[0])):
            p.append('md5 ' + s)
        if not (isinstance(a[4], list) and a[4] and all(isinstance(x, str) and ACL_ITEM.match(x) for x in a[4])):
            p.append('acl ' + s)
        elif s.startswith('public.') and any(x.startswith('=') for x in a[4]):
            p.append('acl PUBLIC ' + s)
    return p


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
        # r9 (P2-01): singura adaugare pe calea conturilor obisnuite = clasificarea 'neaprobat', inaintea profilului.
        clasificare = ("  -- r9 (P2-01): contul nou primeste clasificarea 'neaprobat' odata cu profilul (inventarul Auth ramane complet;\n"
                       "  -- hook-ul il refuza pana la fn_cont_aproba_erp). Ordinea ca pe ramura teren: conturi_tip -> profiles.\n"
                       "  INSERT INTO public.conturi_tip(auth_user_id,tip,sursa) VALUES (NEW.id,'neaprobat','cont_nou_e1_1b')\n"
                       "  ON CONFLICT (auth_user_id) DO NOTHING;\n")
        self.assertEqual(restored.count(clasificare), 1)
        self.assertLess(restored.index(clasificare), restored.index('  INSERT INTO public.profiles (id, email, name, role)'))
        restored = restored.replace(clasificare, '', 1)
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
            # r8 (L12/L15, Jakarinos r8 P2): completitudine fata de numitori independenti de literal - cele 10 functii
            # numite in interogare + functiile celor 7 triggere revizuite (fara handle_new_user, ancorat separat) -
            # si contractul fiecarei functii (owner, DEFINER, config, ACL).
            self.assertEqual(probleme_ancore(ancore, numite_din_interogare(comun)), [])

    def test_anchor_contract_rejects_mutants(self):
        # r8 (Jakarinos r8 P2): omisiunile si abaterile de atribute sunt prinse, nu doar forma.
        sql = MIG.read_text(encoding='utf-8').replace('\r\n', '\n')
        m = re.findall(r"CREATE TEMP TABLE portal_1b_ancore_revizuit ON COMMIT DROP AS\nSELECT '(.*?)'::jsonb AS v; -- PORTAL_1B_ANCORE\n", sql, re.S)
        if m[0] == '{}':
            self.skipTest('ancorele de productie inca necompletate')
        baza = json.loads(m[0].replace("''", "'"))
        comun = (ROOT / 'scripts/portal/ancore_1b.sql').read_text(encoding='utf-8').replace('\r\n', '\n')
        numite = numite_din_interogare(comun)
        self.assertEqual(probleme_ancore(baza, numite), [])

        def mutant(f):
            a = json.loads(json.dumps(baza))
            f(a)
            return probleme_ancore(a, numite)
        notif_t, notif_f = 'public.notifications:trg_notificari_ruteaza_ofertare', 'public.fn_notificari_ruteaza_ofertare()'
        cazuri = {
            'trigger + functia lui sterse': lambda a: (a['triggere'].pop(notif_t), a['functii'].pop(notif_f)),
            'trigger sters': lambda a: a['triggere'].pop(notif_t),
            'functie numita stearsa': lambda a: a['functii'].pop('auth.uid()'),
            'functie in plus': lambda a: a['functii'].__setitem__('public.f()', a['functii'][notif_f]),
            'trigger dezactivat': lambda a: a['triggere'][notif_t].__setitem__(0, 'D'),
            'trigger pe alta functie': lambda a: a['triggere'][notif_t].__setitem__(2, 'public.prevent_role_escalation()'),
            'owner null peste tot': lambda a: [v.__setitem__(1, None) for v in a['functii'].values()],
            'owner schimbat': lambda a: a['functii']['auth.jwt()'].__setitem__(1, 'postgres'),
            'DEFINER pierdut': lambda a: a['functii'][notif_f].__setitem__(2, False),
            'config pierdut pe public': lambda a: a['functii'][notif_f].__setitem__(3, None),
            'config pe functie Supabase': lambda a: a['functii']['extensions.unaccent(text)'].__setitem__(3, ['search_path=public']),
            'ACL gol': lambda a: a['functii'][notif_f].__setitem__(4, []),
            'ACL PUBLIC pe public': lambda a: a['functii'][notif_f][4].append('=X/postgres'),
            'md5 invalid': lambda a: a['functii'][notif_f].__setitem__(0, 'x'),
        }
        for nume, f in cazuri.items():
            with self.subTest(caz=nume):
                self.assertNotEqual(mutant(f), [], nume)
        # r9: verificarea ancorelor (doar catalog) ruleaza INAINTEA lock-urilor pe tabelele utilizatorilor si inaintea
        # oricarui obiect nou; se repeta, sub lock-uri, inaintea fixarii amprentei.
        self.assertLess(sql.index('DO $ancore_pre$'), sql.index('DO $locks$'))
        self.assertLess(sql.index('DO $ancore_pre$'), sql.index('CREATE TABLE public.portal_e1_1b_manifest'))
        self.assertLess(sql.index('DO $locks$'), sql.index('DO $critic$'))
        post = sql.split('DO $critic$', 1)[1]
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

    def test_lock_budget_contract_r9(self):
        # r9 (al doilea recenzent r8, P1-01): punct unic de lock, NOWAIT + buget 3 s, nivelurile declarate in PR.
        spec_b = importlib.util.spec_from_file_location('buget_lock', ROOT / 'scripts/portal/buget_lock.py')
        buget = importlib.util.module_from_spec(spec_b)
        spec_b.loader.exec_module(buget)
        mig_moduri = {'auth.users': 'SHARE ROW EXCLUSIVE', 'public.employees': 'SHARE ROW EXCLUSIVE',
                      'public.profiles': 'ACCESS EXCLUSIVE', 'public.user_module_access': 'SHARE'}
        rev_moduri = {'auth.users': 'ACCESS EXCLUSIVE', 'public.employees': 'ACCESS EXCLUSIVE',
                      'public.profiles': 'ACCESS EXCLUSIVE', 'public.user_module_access': 'SHARE'}
        mig = MIG.read_text(encoding='utf-8').replace('\r\n', '\n')
        rev = REV.read_text(encoding='utf-8').replace('\r\n', '\n')
        m18 = (ROOT / 'supabase/migrations/20261118a_portal_teren_identitate.sql').read_text(encoding='utf-8')
        # r10: inainte de $locks$ nu se atinge niciun tabel existent: ale utilizatorilor + cele create de 18a
        # (si, la revenire, cele create de 19a); nici prin functiile portalului care le citesc.
        ex_mig = buget.TABELE_18A
        ex_rev = buget.TABELE_18A + buget.TABELE_19A
        fn_mig = buget.functii_care_citesc([m18, mig], buget.TABELE_UTILIZATORI + ex_mig)
        fn_rev = buget.functii_care_citesc([m18, mig], buget.TABELE_UTILIZATORI + ex_rev)
        for f in ('fn_portal_angajat_eligibil', 'fn_portal_1b_snapshot', 'fn_portal_porti_lipsa_1b', 'fn_teren_eligibil',
                  'fn_portal_porti_lipsa', 'handle_new_user'):
            self.assertIn(f, fn_mig, f)
        self.assertEqual(buget.probleme(mig, mig_moduri, ex_mig, fn_mig), [])
        self.assertEqual(buget.probleme(rev, rev_moduri, ex_rev, fn_rev), [])
        # r10 (Jakarinos r9 P2): functiile care citesc tabelele utilizatorilor sunt plpgsql (nu se analizeaza la creare).
        for name in ('fn_portal_angajat_eligibil(p_employee_id integer)', 'fn_portal_1b_snapshot()'):
            head = mig.split('CREATE FUNCTION public.' + name, 1)[1].split(' AS $fn$', 1)[0]
            self.assertIn('LANGUAGE plpgsql', head, name)
        # Pe coada lui 19a (in $critic$, dupa $locks$): CHECK-ul (un singur ALTER), FK-urile, triggerul pe employees,
        # coloanele conturi_teren, reconcilierea; handle_new_user se inlocuieste INAINTE (corp plpgsql, vizibil la COMMIT).
        i = mig.index('DO $locks$')
        crit = mig.split('DO $critic$', 1)[1]
        for after in ('ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_chk,\n   ADD CONSTRAINT profiles_role_chk CHECK',
                      'ADD CONSTRAINT portal_provisioning_employee_id_fkey', 'CREATE TRIGGER portal_revoca_la_plecare',
                      'ADD COLUMN provisioning_id uuid UNIQUE REFERENCES', 'CREATE TRIGGER portal_conturi_teren_audit',
                      "IF EXISTS (SELECT FROM public.profiles WHERE role IS NULL", "'reconciliere_e1_1b'",
                      'PORTAL_1B_TERRAIN_UNCLASSIFIED'):
            self.assertIn(after, crit, after)
        self.assertLess(mig.index('CREATE OR REPLACE FUNCTION public.handle_new_user()'), i)
        self.assertNotIn('ALTER TABLE public.profiles ADD CONSTRAINT', mig)
        create_prov = mig.split('CREATE TABLE public.portal_provisioning (', 1)[1].split(');', 1)[0]
        self.assertNotIn('REFERENCES', create_prov)
        # Reconcilierea (P2-01): sub lock, inaintea portii si a amprentei; contul teren neclasificat = refuz inainte de INSERT.
        self.assertLess(crit.index('PORTAL_1B_TERRAIN_UNCLASSIFIED'), crit.index("'reconciliere_e1_1b'"))
        self.assertLess(crit.index("'reconciliere_e1_1b'"), crit.index('public.fn_portal_porti_lipsa_1b()'))
        # Revenirea: lock-urile inaintea verificarii „fara date noi” (L14), restaurarea dupa verificare.
        rcrit = rev.split('DO $critic$', 1)[1]
        self.assertLess(rev.index('DO $locks$'), rev.index('DO $critic$'))
        self.assertLess(rcrit.index('PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG'), rcrit.index("EXECUTE m->>'definition'"))
        # Mutanti: contractul trebuie sa-i respinga.
        L = 'DO $locks$'
        mutanti = {
            'fara NOWAIT': mig.replace('public.profiles IN ACCESS EXCLUSIVE MODE NOWAIT;', 'public.profiles IN ACCESS EXCLUSIVE MODE;', 1),
            'LOCK pe profiles in afara': mig.replace('DO $priv$', 'LOCK TABLE public.profiles IN SHARE MODE;\nDO $priv$', 1),
            'fara lock_timeout': mig.replace("SET LOCAL lock_timeout = '3s';", '', 1),
            'mod mai slab declarat': mig.replace('public.user_module_access IN SHARE MODE NOWAIT', 'public.user_module_access IN ROW SHARE MODE NOWAIT', 1),
            'fara 55P03': mig.replace("USING ERRCODE = '55P03';\n      END IF;\n      PERFORM pg_sleep(0.05);", "\n      END IF;\n      PERFORM pg_sleep(0.05);", 1),
            'priv dupa prima schimbare': mig.replace('DO $priv$', 'CREATE TABLE public.x(id int);\nDO $priv$', 1),
            # r10
            'Jakarinos: SELECT pe profiles inainte de $locks$': mig.replace(L, 'SELECT count(*) FROM public.profiles;\n' + L, 1),
            'SELECT necalificat pe employees': mig.replace(L, 'SELECT count(*) FROM employees;\n' + L, 1),
            'functie sql pe auth.users': mig.replace(L, 'CREATE FUNCTION public.x() RETURNS bigint LANGUAGE sql AS $q$ SELECT count(*) FROM auth.users $q$;\n' + L, 1),
            'DO care citeste user_module_access': mig.replace(L, 'DO $q$ BEGIN PERFORM 1 FROM public.user_module_access; END $q$;\n' + L, 1),
            'DO care apeleaza poarta': mig.replace(L, 'DO $q$ BEGIN PERFORM public.fn_portal_porti_lipsa(); END $q$;\n' + L, 1),
            'SELECT pe conturi_tip (18a) inainte': mig.replace(L, 'SELECT count(*) FROM public.conturi_tip;\n' + L, 1),
            'EXECUTE dinamic inainte': mig.replace(L, "DO $q$ BEGIN EXECUTE 'SELECT 1'; END $q$;\n" + L, 1),
            'snapshot inapoi pe sql': mig.replace('CREATE FUNCTION public.fn_portal_1b_snapshot() RETURNS jsonb\nLANGUAGE plpgsql',
                                                  'CREATE FUNCTION public.fn_portal_1b_snapshot() RETURNS jsonb\nLANGUAGE sql', 1),
            'FK pe tabelul nou inainte': mig.replace(' employee_id integer NOT NULL,\n email_calculat',
                                                     ' employee_id integer NOT NULL REFERENCES public.employees(id),\n email_calculat', 1),
            'trigger pe employees inainte': mig.replace(L, 'CREATE TRIGGER t AFTER UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.fn_portal_revoca_la_plecare();\n' + L, 1),
            'lock consultativ blocant': mig.replace('IF NOT pg_try_advisory_xact_lock(', 'PERFORM pg_advisory_xact_lock(', 1),
            'timeout-urile dupa $pre$': mig.replace("SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '15s';\n", '', 1)
                .replace('SET LOCAL search_path = public, pg_temp;\n',
                         "SET LOCAL search_path = public, pg_temp;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '15s';\n", 1),
            'fara PG17': mig.replace("THEN RAISE EXCEPTION 'PORTAL_PG17_REQUIRED'", "THEN RAISE NOTICE 'PORTAL_PG17_REQUIRED'", 1),
            # r12: plafonul = ceasul de la BEGIN din conexiune; fisierul il verifica, nu-l schimba.
            'plafon repornit in $locks$ (r11)': mig.replace("  RAISE NOTICE 'PORTAL_LOCKS 19a",
                "  PERFORM set_config('transaction_timeout', '0', true);\n  PERFORM set_config('transaction_timeout', '2s', true);\n  RAISE NOTICE 'PORTAL_LOCKS 19a", 1),
            'plafon schimbat inainte de $locks$': mig.replace(L, "DO $q$ BEGIN PERFORM set_config('transaction_timeout', '10s', true); END $q$;\n" + L, 1),
            'fara verificarea plafonului': mig.replace("IF v_plafon IS DISTINCT FROM '2000/client' THEN", 'IF false THEN', 1),
            'plafon cu alta valoare': mig.replace("'2000/client'", "'20000/client'", 1),
            'reincercare 3 s de la $locks$': mig.replace("IF clock_timestamp() >= now() + interval '1 second' THEN",
                "IF clock_timestamp() >= now() + interval '3 seconds' THEN", 1),
            'a doua instructiune dupa $locks$': mig.replace('END $locks$;\n', 'END $locks$;\nSELECT 1;\n', 1),
            'instructiune dupa $critic$': mig.rstrip('\n') + '\nANALYZE public.profiles;\n',
        }
        for nume, text in mutanti.items():
            with self.subTest(mutant=nume):
                self.assertNotEqual(text, mig, nume)
                self.assertNotEqual(buget.probleme(text, mig_moduri, ex_mig, fn_mig), [], nume)
        # Martori negativi: ce NU ia lock la creare ramane permis (corp plpgsql, literal, catalog).
        permise = {
            'functie plpgsql pe profiles': mig.replace(L, 'CREATE FUNCTION public.x() RETURNS bigint LANGUAGE plpgsql AS $q$ BEGIN RETURN (SELECT count(*) FROM public.profiles); END $q$;\n' + L, 1),
            'literal cu numele tabelului': mig.replace(L, "DO $q$ BEGIN PERFORM has_table_privilege('public.profiles','SELECT'); END $q$;\n" + L, 1),
            'comentariu cu numele tabelului': mig.replace(L, '-- SELECT count(*) FROM public.profiles;\n' + L, 1),
        }
        for nume, text in permise.items():
            with self.subTest(permis=nume):
                self.assertNotEqual(text, mig, nume)
                self.assertEqual(buget.probleme(text, mig_moduri, ex_mig, fn_mig), [], nume)
        # Revenirea: aceleasi reguli (punctul 7).
        for nume, text in {
            'rev: SELECT pe portal_provisioning inainte': rev.replace(L, 'SELECT count(*) FROM public.portal_provisioning;\n' + L, 1),
            'rev: plafon repornit in $locks$ (r11)': rev.replace("  RAISE NOTICE 'PORTAL_LOCKS 19a revenire",
                "  PERFORM set_config('transaction_timeout', '2s', true);\n  RAISE NOTICE 'PORTAL_LOCKS 19a revenire", 1),
            'rev: fara verificarea plafonului': rev.replace("IF v_plafon IS DISTINCT FROM '2000/client' THEN", 'IF false THEN', 1),
            'rev: a doua instructiune dupa $locks$': rev.replace('END $locks$;\n', 'END $locks$;\nDROP TABLE public.portal_e1_1b_manifest;\n', 1),
        }.items():
            with self.subTest(mutant=nume):
                self.assertNotEqual(text, rev, nume)
                self.assertNotEqual(buget.probleme(text, rev_moduri, ex_rev, fn_rev), [], nume)

    def test_hook_and_provisioning_share_employee_predicate(self):
        sql = MIG.read_text(encoding='utf-8')
        body = sql.split('CREATE OR REPLACE FUNCTION public.fn_teren_eligibil', 1)[1].split('$fn$;', 1)[0]
        self.assertIn('public.fn_portal_angajat_eligibil(e.id) IS TRUE', body)
        self.assertNotIn('termination_date', body)
        self.assertIn("ARRAY['handle_live','eligibil_live']", REV.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
