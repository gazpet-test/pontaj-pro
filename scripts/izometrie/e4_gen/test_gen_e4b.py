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
  for name,key in [('fn_izo_garda_montaj','old_guard'),('fn_izo_flux_admin','old_flux'),('fn_izo_porti_e4_lipsa','old_e4_gate'),('fn_izo_depozit_in_registru','old_depot')]:
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
 def test_cut_simulation_is_read_only_and_precedes_facts(self):
  sim=G['src'](G['block'](M,'fn_izo_lot_efecte'))
  self.assertNotRegex(sim,r'(?i)\b(?:INSERT|UPDATE|DELETE|nextval|set_config)\b')
  apply=G['src'](G['block'](M,'fn_izo_aproba_intern'))
  self.assertLess(apply.index('v_plan:=public.fn_izo_lot_efecte'),apply.index('v_ev:=public.fn_izo_taiere_fapt'))
  self.assertIn("jsonb_array_elements_text(v_plan->'ordine')",apply)
  self.assertIn('reconciliere_simulare',apply)
  self.assertIn('reconciliere_transfer',apply)
 def test_cut_writer_has_fixed_insert_projection_and_restore(self):
  cut=G['src'](G['block'](M,'fn_izo_taiere_fapt'))
  self.assertIn('INSERT INTO public.magazie_bucati('+','.join(G['cut_cols'])+')',cut)
  self.assertIn('ALTER FUNCTION public.fn_izo_taiere_fapt(bigint) OWNER TO izo_montaj_writer',M)
  self.assertIn('DROP POLICY magbuc_izo_montaj_ins',V)
  self.assertIn("'public.magazie_bucati_id_seq'::regclass",G['new_e4_gate'])
  self.assertIn("'public.izo_rezervari_id_seq'::regclass",G['new_e4_gate'])
  self.assertIn('destinatie_depozit_id',G['new_depot'])
 def test_transfer_chain_is_exclusive_and_preserves_consumer(self):
  self.assertIn('CREATE UNIQUE INDEX ux_izo_rez_transfer',M)
  cut=G['src'](G['block'](M,'fn_izo_taiere_fapt'))
  self.assertLess(cut.index("motiv_eliberare='transferata'"),cut.index('INSERT INTO public.izo_rezervari'))
  self.assertIn('v_r.declaratie_id,v_r.declaratie_versiune,v_r.autor_profile_id,v_child.id,false,v_r.expira_dupa,v_r.id',cut)
 def test_revision_and_cut_scenarios_remain_connected(self):
  tests=(R/'supabase/tests/izometrie_e4b_aprobare.test.sql').read_text(encoding='utf-8')
  for check in ['simulation wrote events','separate transfer lost','transfer chain','revision closure',
                'unchanged child not restored','changed child restored or reserved','bad cut sum accepted',
                'equal cut children accepted','changed cut preview accepted']:
   self.assertIn(check,tests)
  self.assertTrue(tests.rstrip().endswith("SELECT 'E4B_APROBARE_TEST_END';"))
 def test_weld_tables_and_private_writers(self):
  for t in ['izo_suduri','izo_suduri_capete']:
   self.assertIn(t,G['tables'])
   self.assertIn('REVOKE ALL ON SEQUENCE public.'+t+'_id_seq FROM PUBLIC,anon,authenticated,service_role',M)
  for name in ['fn_izo_sudura_decl','fn_izo_sudura_aproba','fn_izo_capete_muta','fn_izo_corectie_mm','fn_izo_corectie_fapt']:
   self.assertIn('REVOKE ALL ON FUNCTION public.'+name,M)
  self.assertIn('CREATE UNIQUE INDEX ux_izo_capat_parte',M)
  self.assertIn('CREATE UNIQUE INDEX ux_izo_capat_bucata',M)
  self.assertIn('CREATE UNIQUE INDEX ux_izo_capat_decl',M)
 def test_movement_role_matches_real_schema(self):
  correction=G['src'](G['block'](M,'fn_izo_corectie_fapt'))
  self.assertIn("'rol','corectat'",correction)
  self.assertNotIn("'rol','corectie'",correction)
  self.assertIn('GET DIAGNOSTICS v_n=ROW_COUNT',correction)
  self.assertIn("'corectie',p_ref",correction)
 def test_decisions_and_correction_precede_cut(self):
  body=G['src'](G['block'](M,'fn_izo_aproba_intern'))
  self.assertLess(body.index('decizii_invalide'),body.index('v_corr:=public.fn_izo_corectie_fapt'))
  self.assertLess(body.index('v_corr:=public.fn_izo_corectie_fapt'),body.index('v_ev:=public.fn_izo_taiere_fapt'))
  self.assertIn('jsonb_object_keys(p_decizii)',body)
  self.assertIn('s.zi=v_s.zi',body)
 def test_cap_simulation_and_full_reservation_chain(self):
  body=G['src'](G['block'](M,'fn_izo_lot_efecte'))
  self.assertIn("'capete',v_caps",body)
  self.assertIn("RAISE EXCEPTION 'ramura_gresita'",body)
  self.assertIn("RAISE EXCEPTION 'ramura_neacoperita'",body)
  self.assertIn("c.destinatie='ramane_montat'",body)
  cut=G['src'](G['block'](M,'fn_izo_taiere_fapt'))
  self.assertIn("v_c.destinatie='ramane_montat' AND v_r.declaratie_id=v_d.id",cut)
  self.assertIn('fn_izo_capete_muta(v_b.id,v_child.id,v_ev.id)',cut)
 def test_new_sql_scenarios_are_in_real_harness(self):
  tests=(R/'supabase/tests/izometrie_e4b_aprobare.test.sql').read_text(encoding='utf8')
  for name in ['2c single cap accepted','2c mixed-session weld approval','2c wrong mounted branch accepted',
               '2c free-end branch accepted wrong child','2c tree correction accepted','2c missing MP decision accepted',
               '2c extra MP decision accepted','2c correction before cut','2c R4 transfer']:
   self.assertIn(name,tests)
  self.assertNotRegex(tests,r'(?im)^\s*(GRANT|REVOKE)\b')
 def test_mounted_child_cleanup_distinguishes_owner_from_consumer(self):
  body=G['src'](G['block'](M,'fn_izo_teren_op'))
  cleanup=body[body.index('-- A changed/disappeared child'):body.index('-- Keep the severe reason')]
  self.assertIn("c.stare='anulata' OR EXISTS",cleanup)
  self.assertIn('d.id=r.declaratie_id AND d.id<>c.declaratie_id',cleanup)
  self.assertIn("(d.payload->>'baza_mm')::integer) IS DISTINCT FROM c.lungime_mm",cleanup)
  sim=G['src'](G['block'](M,'fn_izo_lot_efecte'))
  self.assertIn('r.declaratie_id=v_d.id AND r.declaratie_versiune=v_d.versiune AND r.activa AND r.expira_dupa IS NULL',sim)
  tests=(R/'supabase/tests/izometrie_e4b_aprobare.test.sql').read_text(encoding='utf8')
  for name in ['2d sync lost own mounted child reservation','2d submit lost own mounted child reservation',
               '2d invalid child reservation accepted','2d approval did not consume own child reservations',
               'changed child restored or reserved']:
   self.assertIn(name,tests)

if __name__=='__main__': unittest.main()
