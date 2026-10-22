# Verificări fără PostgreSQL / rețea. Rulează: python scripts/izometrie/e3b_gen/test_gen_e3b.py
import hashlib
import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import unittest

sys.dont_write_bytecode = True
SP = Path(__file__).resolve().parent
R = SP.parents[2]
spec = importlib.util.spec_from_file_location('e3b', SP / 'gen_e3b.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class GeneratorTest(unittest.TestCase):
    def test_generare_idempotenta_si_live_neatins(self):
        live = [g.E2, g.E3, R / 'supabase/migrations/20261102c_izometrie_cai_vechi_stoc.sql']
        outputs = [R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql',
                   R / 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql']
        digest = lambda ps: [hashlib.sha256(p.read_bytes()).hexdigest() for p in ps]
        before = digest(live)
        subprocess.run([sys.executable, str(SP / 'gen_e3b.py')], check=True)
        first = digest(outputs)
        subprocess.run([sys.executable, str(SP / 'gen_e3b.py')], check=True)
        self.assertEqual(first, digest(outputs))
        self.assertEqual(before, digest(live))
        for p in outputs:
            self.assertNotIn(b'\r', p.read_bytes())
            text = p.read_text(encoding='utf-8')
            self.assertNotIn('@@', text)
            for tag in set(re.findall(r'\$[a-zA-Z_]*\$', text)):
                self.assertEqual(text.count(tag) % 2, 0, tag)

    def test_bloc_exact_prosrc_si_revenire(self):
        old = g.BLOCURI_VECHI['fn_izo_porti_lipsa']
        self.assertIn(old, g.e3)
        self.assertEqual(g.md5(g.prosrc(old)), g.MD5_VECHI['fn_izo_porti_lipsa'])
        mig = (R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
        new = g.pl_noua
        self.assertIn(g.ddl_exact(new), mig)
        self.assertEqual(g.prosrc(new).replace('    v := v || public.fn_izo_porti_e3b_lipsa();\n', ''), g.prosrc(old))
        restore = old.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)
        self.assertIn(g.ddl_exact(restore), rev)
        self.assertEqual(g.prosrc(g.ddl_exact(restore)), g.prosrc(old))
        for n in g.BLOCURI_VECHI:
            if n in g.INLOCUIRI_B:
                old_body = g.prosrc(g.BLOCURI_VECHI[n])
                self.assertEqual(g.prosrc(g.bloc_functie(rev, n)), old_body)
                added = g.prosrc(g.bloc_functie(mig, n))
                if n == 'fn_izo_doc_garda':
                    added = re.sub(r"    IF current_user = 'izo_corectie_writer' THEN\n.*?    END IF;\n", '', added, count=1, flags=re.S)
                else:
                    added = re.sub(r"    IF v_aut IS NOT TRUE AND current_user = 'izo_corectie_writer' THEN\n.*?    END IF;\n", '', added, count=1, flags=re.S)
                self.assertEqual(added, old_body)
                self.assertIn(g.MD5_VECHI[n], mig)
                self.assertIn(g.MD5_VECHI[n], rev)
            elif n not in ('fn_izo_porti_lipsa', 'fn_izo_doc_salveaza'):
                self.assertIsNone(re.search(r'CREATE (?:OR REPLACE )?FUNCTION public\.' + n + r'\(', mig), n)

    def test_contract_lista_si_invocari(self):
        self.assertEqual(len(g.INS), len(set(g.INS)))
        self.assertEqual(set(g.INS), set(g.C) | {'id', 'uid', 'radacina_id', 'server_ver'})
        self.assertEqual(set(g.UPD), set(g.L_TEAVA + g.L_CURBA + g.D + ['stare', 'depozit_id', 'server_ver', 'updated_at']))
        self.assertFalse(set(g.L_TEAVA + g.L_CURBA) & set(g.D))
        self.assertEqual(len(g.IMPL_POST), len(set(g.IMPL_POST)))
        self.assertEqual(set(g.IMPL_POST) - set(g.IMPL_PRE), set(g.IMPL_E3B))
        self.assertEqual(len(g.IMPL_E3B), 13)  # șapte politici A + patru trigger-e B
        self.assertNotIn('public.fn_izo_doc_api_verifica()', g.FUNCTII)
        for fn in ['fn_izo_jwt_rol()', 'fn_izo_uid()', 'fn_izo_porti_lipsa()']:
            self.assertEqual(set(g.FUNCTII['public.' + fn]), set(g.ROLURI))

    def test_b_contract_static(self):
        mig = (R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
        # Testul 13: inclusiv comentariile din corpurile E3b; numele se construiesc numai aici.
        forbidden = ['fn_izo_' + x for x in ('seteaza_nivel', 'import_sold_initial', 'import_storno', 'activeaza_si_importa')]
        # excepție: copiile EXACTE ale porții LIVE (fn_izo_porti_lipsa, E2a / E3) — conțin numele în detectorul de wrapper-e;
        # nu sunt corpuri E3b (md5-ul lor e verificat de generator), deci se scot înainte de verificare
        import re as _re
        def fara_poarta(t):
            return _re.sub(r'CREATE OR REPLACE FUNCTION public\.fn_izo_porti_lipsa\(\).*?\n  END \$f\$;', '', t, flags=_re.S)
        for text in (mig, rev):
            for name in forbidden:
                self.assertNotIn(name, fara_poarta(text))
        for signature in g.FN_B:
            name = signature.split('(')[0]
            self.assertIn('CREATE FUNCTION public.' + name + '(', mig)
            self.assertIn('DROP FUNCTION public.' + signature + ';', rev)
        for name in ('fn_izo_cor_autorizare_lock', 'fn_izo_cor_cerut_de_valid'):
            body = g.prosrc(g.bloc_functie(mig, name))
            self.assertIn('ORDER BY atb.id FOR SHARE', body)
        body = g.prosrc(g.bloc_functie(mig, 'fn_izo_cor_deschise'))
        self.assertNotIn('FOR SHARE', body)
        self.assertNotIn('FOR UPDATE', body)
        body = g.prosrc(g.bloc_functie(mig, 'fn_izo_cor_garda'))
        self.assertIn('NEW.dupa := public.fn_izo_cor_valideaza(NEW)', body)
        self.assertIn('NEW.inainte := public.fn_izo_cor_inainte(NEW)', body)
        self.assertIn('NEW.decis_de IS NOT DISTINCT FROM OLD.propus_de', body)
        self.assertNotIn('fn_izo_cor_autorizare_lock', body)
        self.assertIn('INSERT INTO public.izo_documente_istoric', g.replacements['ISTORIC'])

    def test_c1_frontiera_acl_revenire_si_insert_c(self):
        mig = (R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
        self.assertEqual(len(g.FN_C1), 5)
        for signature, owner in (g.FN_C1 | g.FN_C2).items():
            name = signature.split('(')[0]
            block = g.bloc_functie(mig, name)
            self.assertIn('SECURITY DEFINER SET search_path = public, pg_temp', block)
            body = g.prosrc(block)
            self.assertRegex(body, r'BEGIN\s+v_uid := public.fn_izo_cor_api_verifica\(\);')
            self.assertNotRegex(body, r'\bEXECUTE\s')
            self.assertIn('ALTER FUNCTION public.%s OWNER TO %s;' % (signature, owner), mig)
            self.assertIn('SET LOCAL ROLE %s;\n  DROP FUNCTION public.%s;\n  RESET ROLE;' % (owner, signature), rev)
            self.assertEqual(g.FUNCTII['public.' + signature], ['authenticated'])
            self.assertFalse(any(name in item for item in g.IMPL_E3B))
        body = g.prosrc(g.bloc_functie(mig, 'fn_izo_cor_aproba'))
        cols = re.search(r'INSERT INTO public.magazie_bucati\(/\*C\*/ (.*?)\)', body).group(1).split(', ')
        self.assertEqual(cols, g.INS)
        self.assertIn('fn_izo_lock_partajat(VARIADIC ARRAY[v_cor.proiect_id])', body)
        self.assertLess(body.index('FOR SHARE'), body.index('FOR UPDATE'))
        self.assertLess(body.index('fn_izo_blocheaza_tabele'), body.index('fn_izo_cor_marcheaza'))
        self.assertNotIn('set_config', g.prosrc(g.bloc_functie(mig, 'fn_izo_cor_verifica')))

    def test_c2_acl_stampile_rollback_si_frontiera_fara_guc(self):
        mig = (R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
        self.assertEqual(g.FN_C2, {
            'fn_izo_cor_camp(bigint, bigint, jsonb, text)': 'izo_corectie_writer',
            'fn_izo_cor_pv(bigint, bigint, text, date, text)': 'izo_corectie_writer',
        })
        self.assertEqual(g.FN_OPERATII, g.FN_C1 | g.FN_C2 | g.FN_D1)
        stamp = g.prosrc(g.bloc_functie(mig, 'fn_izo_porti_e3b_definitii'))
        for signature, owner in g.FN_C2.items():
            name = signature.split('(')[0]
            self.assertIn(name, stamp)
            self.assertIn('DROP FUNCTION public.' + signature + ';', rev)
            self.assertIn("'public.%s'::regprocedure AND proowner='%s'::regrole" % (signature, owner), mig)
            body = g.prosrc(g.bloc_functie(mig, name))
            # Inclusiv comentariile: aceeasi frontiera permanenta ca 0e.
            self.assertNotRegex(body.lower(), r'set_config|request\s*\.\s*jwt|session[_\s]+authorization|\b(?:set|reset)\s+(?:local\s+)?role\b|\bexecute\b|\bu&')
            self.assertIn("'responsabil',NULL", body)
            self.assertNotIn("'gestionar'", body)
            self.assertEqual(body.count('fn_izo_cor_marcheaza('), 1)
            self.assertLess(body.index('fn_izo_blocheaza_tabele'), body.index('fn_izo_lock_partajat'))
            self.assertLess(body.index('fn_izo_lock_partajat'), body.index('INSERT INTO public.izo_corectii'))
            self.assertLess(body.index('RETURNING * INTO v_cor'), body.index('fn_izo_cor_marcheaza'))
            self.assertLess(body.index('fn_izo_cor_marcheaza'), body.index('INSERT INTO public.magazie_bucati_evenimente'))
        camp = g.prosrc(g.bloc_functie(mig, 'fn_izo_cor_camp'))
        self.assertLess(camp.index('fn_izo_lock_partajat'), camp.index('FOR UPDATE'))
        self.assertLess(camp.index('FOR UPDATE'), camp.index('INSERT INTO public.izo_corectii'))
        self.assertIn('p_server_ver IS DISTINCT FROM v_b.server_ver', camp)
        self.assertIn('trimite prin propunere', camp)
        self.assertIn('fn_izo_cor_miscare_asteptata(v_cor,v_b)', camp)
        self.assertNotIn('UPDATE public.izo_documente_intrare', camp)
        pv = g.prosrc(g.bloc_functie(mig, 'fn_izo_cor_pv'))
        self.assertLess(pv.index('FOR UPDATE'), pv.index('fn_izo_cor_autorizare_lock'))
        self.assertIn('p_versiune IS DISTINCT FROM v_doc.versiune', pv)
        self.assertNotIn('INSERT INTO public.magazie_bucati_miscari', pv)
        self.assertNotIn('UPDATE public.magazie_bucati', pv)
        self.assertNotIn('fn_izo_doc_anuleaza', pv)
        self.assertNotIn("'storno_pv'", pv)

    def test_transfer_owner_nesuperuser(self):
        mig = (R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
        revoke = 'REVOKE ALL ON FUNCTION public.fn_izo_cor_marcheaza(bigint) FROM PUBLIC, anon, authenticated, service_role;'
        grant = 'GRANT CREATE ON SCHEMA public TO izo_corectie_writer;'
        owner = 'ALTER FUNCTION public.fn_izo_cor_marcheaza(bigint) OWNER TO izo_corectie_writer;'
        self.assertLess(mig.index(revoke), mig.index(owner))
        self.assertLess(mig.index(grant), mig.index(owner))
        self.assertGreater(mig.index('REVOKE CREATE ON SCHEMA public FROM izo_corectie_writer;', mig.index(owner)), mig.index(owner))
        self.assertIn('SET LOCAL ROLE izo_corectie_writer;\n  DROP FUNCTION public.fn_izo_cor_marcheaza(bigint);\n  RESET ROLE;', rev)
        self.assertNotIn('GRANT EXECUTE ON FUNCTION public.fn_izo_cor_marcheaza(bigint)', mig)


class D1Test(unittest.TestCase):
    def test_salveaza_delta_exact_rollback_si_hash_live(self):
        mig = (R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql').read_text(encoding='utf8')
        rev = (R / 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf8')
        old = g.prosrc(g.salveaza_veche)
        new = g.prosrc(g.bloc_functie(mig, 'fn_izo_doc_salveaza'))
        self.assertEqual(new.replace(g.istoric_insert, '', 1).replace("'istoric_versiune', d.versiune, ", '', 1), old)
        self.assertEqual(g.prosrc(g.bloc_functie(rev, 'fn_izo_doc_salveaza')), old)
        self.assertIn(g.MD5_VECHI['fn_izo_doc_salveaza'], mig)
        self.assertIn(g.MD5_VECHI['fn_izo_doc_salveaza'], rev)
        self.assertNotRegex(mig, r'CREATE (?:OR REPLACE )?FUNCTION public\.fn_izo_doc_hash\(')
        canonical = g.prosrc(g.bloc_functie(mig, 'fn_izo_doc_instantaneu')).split('    SELECT ', 1)[1].split('\n    FROM public.izo_documente_intrare d', 1)[0]
        self.assertIn(canonical + "::text, 'UTF8'", g.hash_src)
        self.assertIn("'fn_izo_doc_salveaza'", g.prosrc(g.bloc_functie(mig, 'fn_izo_porti_e3b_definitii')))

    def test_d1_fixture_hash_matches_exact_live_expression_and_exposed_frontier(self):
        sql = (R / 'supabase/tests/izometrie_e3b.test.sql').read_text(encoding='utf8')
        ref = g.hash_src.replace('    FROM public.izo_documente_intrare d WHERE d.id = p_doc', "    INTO v_hash_e3 FROM public.izo_documente_intrare d WHERE d.id = current_setting('test.d1_doc')::bigint")
        self.assertIn(ref, sql)
        mig = (R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql').read_text(encoding='utf8')
        body = g.prosrc(g.bloc_functie(mig, 'fn_izo_doc_salveaza'))
        self.assertNotRegex(body.lower(), r'set_config|request\s*\.\s*jwt|session[_\s]+authorization|\b(?:set|reset)\s+(?:local\s+)?role\b|\bexecute\b|\bu&')
        for text in (mig, (R / 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf8')):
            self.assertIn('SET LOCAL ROLE izo_doc_editor;\n  CREATE OR REPLACE FUNCTION public.fn_izo_doc_salveaza', text)
            self.assertIn('RESET ROLE;\n  REVOKE CREATE ON SCHEMA public FROM izo_doc_editor;', text)

    def test_admin_acl_lock_order_guard_and_rollback(self):
        mig = (R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql').read_text(encoding='utf8')
        rev = (R / 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf8')
        sig = next(iter(g.FN_D1))
        self.assertEqual(g.FUNCTII['public.'+sig], ['postgres'])
        self.assertIn('GRANT EXECUTE ON FUNCTION public.'+sig+' TO postgres;', mig)
        self.assertNotIn('GRANT EXECUTE ON FUNCTION public.'+sig+' TO authenticated;', mig)
        body = g.prosrc(g.bloc_functie(mig, sig.split('(')[0]))
        chain = ['fn_izo_cor_adm_verifica', 'fn_izo_cor_cerut_de_valid', 'fn_izo_lock_proiect', 'SELECT imp.*', 'FOR UPDATE', 'fn_izo_lant_blocant', 'INSERT INTO public.izo_corectii(', 'INSERT INTO public.izo_corectii_bucati', 'fn_izo_cor_marcheaza', 'INSERT INTO public.magazie_bucati_evenimente', 'INSERT INTO public.magazie_bucati_miscari', 'UPDATE public.magazie_bucati SET', 'UPDATE public.izo_corectii SET']
        self.assertEqual([body.index(x) for x in chain], sorted(body.index(x) for x in chain))
        for trigger in ['trg_izo_doc_ist_garda', 'trg_izo_doc_ist_truncate']:
            self.assertIn('ENABLE ALWAYS TRIGGER '+trigger, mig)
            self.assertIn('DROP TRIGGER '+trigger, rev)
        self.assertIn('DROP FUNCTION public.'+sig, rev)
        guard = g.prosrc(g.bloc_functie(mig, 'fn_izo_doc_ist_garda'))
        for check in ['NEW.continut IS DISTINCT FROM', 'NEW.hash IS DISTINCT FROM', 'NEW.diff IS DISTINCT FROM', 'NEW.baza IS DISTINCT FROM']:
            self.assertIn(check, guard)


if __name__ == '__main__':
    unittest.main()
