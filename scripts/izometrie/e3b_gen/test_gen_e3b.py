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
        outputs = [R / 'supabase/migrations/20261105a_izometrie_e3b_corectii.sql',
                   R / 'supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql']
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
        mig = (R / 'supabase/migrations/20261105a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
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
            elif n != 'fn_izo_porti_lipsa':
                self.assertIsNone(re.search(r'CREATE (?:OR REPLACE )?FUNCTION public\.' + n + r'\(', mig), n)

    def test_contract_lista_si_invocari(self):
        self.assertEqual(len(g.INS), len(set(g.INS)))
        self.assertEqual(set(g.INS), set(g.C) | {'id', 'uid', 'radacina_id', 'server_ver'})
        self.assertEqual(set(g.UPD), set(g.L_TEAVA + g.L_CURBA + g.D + ['stare', 'depozit_id', 'server_ver', 'updated_at']))
        self.assertFalse(set(g.L_TEAVA + g.L_CURBA) & set(g.D))
        self.assertEqual(len(g.IMPL_POST), len(set(g.IMPL_POST)))
        self.assertEqual(set(g.IMPL_POST) - set(g.IMPL_PRE), set(g.IMPL_E3B))
        self.assertEqual(len(g.IMPL_E3B), 11)  # șapte politici A + patru trigger-e B
        self.assertNotIn('public.fn_izo_doc_api_verifica()', g.FUNCTII)
        for fn in ['fn_izo_jwt_rol()', 'fn_izo_uid()', 'fn_izo_porti_lipsa()']:
            self.assertEqual(set(g.FUNCTII['public.' + fn]), set(g.ROLURI))

    def test_b_contract_static(self):
        mig = (R / 'supabase/migrations/20261105a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
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
        for name in ('STORNO', 'ISTORIC'):
            self.assertEqual(g.replacements[name], '')

    def test_c1_frontiera_acl_revenire_si_insert_c(self):
        mig = (R / 'supabase/migrations/20261105a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
        self.assertEqual(len(g.FN_C1), 5)
        for signature, owner in g.FN_C1.items():
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

    def test_transfer_owner_nesuperuser(self):
        mig = (R / 'supabase/migrations/20261105a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
        rev = (R / 'supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql').read_text(encoding='utf-8')
        revoke = 'REVOKE ALL ON FUNCTION public.fn_izo_cor_marcheaza(bigint) FROM PUBLIC, anon, authenticated, service_role;'
        grant = 'GRANT CREATE ON SCHEMA public TO izo_corectie_writer;'
        owner = 'ALTER FUNCTION public.fn_izo_cor_marcheaza(bigint) OWNER TO izo_corectie_writer;'
        self.assertLess(mig.index(revoke), mig.index(owner))
        self.assertLess(mig.index(grant), mig.index(owner))
        self.assertGreater(mig.index('REVOKE CREATE ON SCHEMA public FROM izo_corectie_writer;'), mig.index(owner))
        self.assertIn('SET LOCAL ROLE izo_corectie_writer;\n  DROP FUNCTION public.fn_izo_cor_marcheaza(bigint);\n  RESET ROLE;', rev)
        self.assertNotIn('GRANT EXECUTE ON FUNCTION public.fn_izo_cor_marcheaza(bigint)', mig)


if __name__ == '__main__':
    unittest.main()
