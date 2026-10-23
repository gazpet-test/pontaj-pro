"""Offline generation/security contract tests. Does not claim SQL execution."""
import hashlib
import runpy
import unittest
from pathlib import Path

SP = Path(__file__).resolve().parent
G = runpy.run_path(str(SP/'gen_e4b.py'),run_name='e4b_test')
R = G['R']
M = (R/'supabase/migrations/20261109b_izometrie_e4b_teren.sql').read_text(encoding='utf-8')
V = (R/'supabase/revenire/20261109b_izometrie_e4b_teren_ROLLBACK.sql').read_text(encoding='utf-8')

class E4bTests(unittest.TestCase):
 def test_generated_outputs(self):
  self.assertEqual(M,G['render']('e4b_tpl.sql'))
  self.assertEqual(V,G['render']('e4b_rev_tpl.sql'))
 def test_exact_restore_and_precondition(self):
  self.assertEqual(G['block'](V,'fn_izo_porti_lipsa'),G['old'])
  digest=hashlib.md5(G['src'](G['old']).encode()).hexdigest()
  self.assertIn(digest,M); self.assertIn(digest,V)
  self.assertLess(M.index(digest),M.index('CREATE ROLE'))
 def test_fixed_inventory_and_restamps(self):
  self.assertEqual(len(G['implicit']),len(set(G['implicit'])))
  for name in ['fn_izo_porti_definitii','fn_izo_porti_e3_definitii','fn_izo_porti_e3b_definitii','fn_izo_porti_e4_definitii','fn_izo_porti_e4b_definitii']:
   self.assertIn('COMMENT ON FUNCTION public.'+name,M)
  self.assertEqual((SP/'e4b_tpl.sql').read_text(encoding='utf-8').count('@@IMPL_POST@@'),2)
 def test_exposed_bodies_pass_0e_shape(self):
  for name in ['fn_izo_sync_push','fn_izo_teren_pregateste','fn_izo_teren_instantaneu','fn_izo_gps_citeste']:
   self.assertNotRegex(G['src'](G['block'](M,name)).lower(),r'set_config|request[.]jwt|\bexecute\b')
 def test_all_tables_rls_and_no_public_write(self):
  for table in G['tables']:
   self.assertIn('ALTER TABLE public.'+table+' ENABLE ROW LEVEL SECURITY',M)
   self.assertIn('REVOKE ALL ON public.'+table+' FROM PUBLIC,anon,authenticated,service_role',M)
  self.assertNotRegex(M,r'GRANT (?:INSERT|UPDATE|DELETE|TRUNCATE)[^;]*TO authenticated')
 def test_gps_and_hash_private(self):
  self.assertNotRegex(M,r'GRANT SELECT[^;]*ON public.izo_declaratii_gps')
  grant=M[M.index('GRANT SELECT(id,autor_profile_id'):M.index('GRANT SELECT(id,autor_profile_id')+400]
  self.assertNotIn('hash_cerere',grant)
  self.assertIn("jsonb_path_exists(v_p,'$.**.gps')",M)
 def test_no_access_mutations_and_sync_never_writes_registry(self):
  self.assertNotRegex(M,r'(?i)(?:INSERT INTO|UPDATE|DELETE FROM) public.(?:user_module_access|app_modules)')
  for name in ['fn_izo_teren_op','fn_izo_teren_push']:
   body=G['src'](G['block'](M,name))
   self.assertNotRegex(body,r'(?i)(?:INSERT INTO|UPDATE|DELETE FROM) public.magazie_bucati\b')
 def test_birou_wrappers_pass_control_0e_shape(self):
  for name in G['wrappers']:
   body=G['src'](G['block'](M,name)).lower()
   self.assertNotRegex(body,r'set_config|request[.]jwt|\bexecute\b')
   self.assertIn('OWNER TO izo_montaj_writer',M[M.index('ALTER FUNCTION public.'+name):][:300])
 def test_guard_and_flux_exact_restore(self):
  for name,key in [('fn_izo_garda_montaj','old_guard'),('fn_izo_flux_admin','old_flux'),('fn_izo_porti_e4_lipsa','old_e4_gate')]:
   self.assertEqual(G['src'](G['block'](V,name)),G['src'](G[key]))
   digest=hashlib.md5(G['src'](G[key]).encode()).hexdigest()
   self.assertIn(digest,M); self.assertIn(digest,V)
 def test_approval_harness_is_connected(self):
  harness=(R/'scripts/test_izometrie_e4b.sh').read_text(encoding='utf-8')
  tests=(R/'supabase/tests/izometrie_e4b_aprobare.test.sql').read_text(encoding='utf-8')
  self.assertIn('izometrie_e4b_aprobare.test.sql',harness)
  self.assertIn('E4B_APROBARE_TEST_END',harness)
  self.assertIn('E4B_APROBARE_TEST_END',tests)
  self.assertNotRegex(tests,r'(?im)^\s*(GRANT|REVOKE)\b')
 def test_operation_journal_is_after_effects(self):
  push=G['src'](G['block'](M,'fn_izo_teren_push'))
  self.assertLess(push.index('fn_izo_teren_op('),push.index('INSERT INTO public.izo_operatii'))
  self.assertIn('WHEN serialization_failure OR deadlock_detected OR lock_not_available OR query_canceled',push)
  self.assertIn("v_old.canal='teren' AND v_old.hash_cerere=v_hash",push)
 def test_fixture_has_no_grants_and_checks_affected_rows(self):
  tests=(R/'supabase/tests/izometrie_e4b.test.sql').read_text(encoding='utf-8')
  self.assertNotRegex(tests,r'(?im)^\s*(GRANT|REVOKE)\b')
  self.assertIn('GET DIAGNOSTICS v_count=ROW_COUNT',tests)
  self.assertIn('push wrote official registry',tests)

if __name__=='__main__': unittest.main()
