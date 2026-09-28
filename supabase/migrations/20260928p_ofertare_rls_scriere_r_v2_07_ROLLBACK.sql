-- JAK-V2-07 ROLLBACK: restaurează politicile weak și rolurile din Anexa 1.
-- Fișierul se execută integral într-o singură tranzacție a runnerului.
-- Nu modifică date sau granturi pe tabele. Restaurează intenționat accesul vechi.

DROP TRIGGER IF EXISTS a00_ofertare_licitatii_scriere ON public.ofertare_licitatii;
DROP FUNCTION IF EXISTS public.fn_ofertare_licitatii_scriere();

DROP POLICY IF EXISTS ofertare_licitatii_all ON public.ofertare_licitatii;
DROP POLICY IF EXISTS ofertare_licitatii_select ON public.ofertare_licitatii;
DROP POLICY IF EXISTS ofertare_licitatii_insert ON public.ofertare_licitatii;
DROP POLICY IF EXISTS ofertare_licitatii_update ON public.ofertare_licitatii;
DROP POLICY IF EXISTS ofertare_licitatii_delete ON public.ofertare_licitatii;
CREATE POLICY ofertare_licitatii_all ON public.ofertare_licitatii
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS cant_all_sel ON public.ofertare_cantitati;
DROP POLICY IF EXISTS cant_all_ins ON public.ofertare_cantitati;
DROP POLICY IF EXISTS cant_all_upd ON public.ofertare_cantitati;
DROP POLICY IF EXISTS cant_all_del ON public.ofertare_cantitati;
DROP POLICY IF EXISTS cant_all ON public.ofertare_cantitati;
CREATE POLICY cant_all ON public.ofertare_cantitati FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS clar_all_sel ON public.ofertare_clarificari;
DROP POLICY IF EXISTS clar_all_ins ON public.ofertare_clarificari;
DROP POLICY IF EXISTS clar_all_upd ON public.ofertare_clarificari;
DROP POLICY IF EXISTS clar_all_del ON public.ofertare_clarificari;
DROP POLICY IF EXISTS clar_all ON public.ofertare_clarificari;
CREATE POLICY clar_all ON public.ofertare_clarificari FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ofertare_clarificari_coada_all_sel ON public.ofertare_clarificari_coada;
DROP POLICY IF EXISTS ofertare_clarificari_coada_all_ins ON public.ofertare_clarificari_coada;
DROP POLICY IF EXISTS ofertare_clarificari_coada_all_upd ON public.ofertare_clarificari_coada;
DROP POLICY IF EXISTS ofertare_clarificari_coada_all_del ON public.ofertare_clarificari_coada;
DROP POLICY IF EXISTS ofertare_clarificari_coada_all ON public.ofertare_clarificari_coada;
CREATE POLICY ofertare_clarificari_coada_all ON public.ofertare_clarificari_coada FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ofertare_acoperire_coada_all_sel ON public.ofertare_acoperire_coada;
DROP POLICY IF EXISTS ofertare_acoperire_coada_all_ins ON public.ofertare_acoperire_coada;
DROP POLICY IF EXISTS ofertare_acoperire_coada_all_upd ON public.ofertare_acoperire_coada;
DROP POLICY IF EXISTS ofertare_acoperire_coada_all_del ON public.ofertare_acoperire_coada;
DROP POLICY IF EXISTS ofertare_acoperire_coada_all ON public.ofertare_acoperire_coada;
CREATE POLICY ofertare_acoperire_coada_all ON public.ofertare_acoperire_coada FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS istoric_scrie_sel ON public.ofertare_acoperire_istoric;
DROP POLICY IF EXISTS istoric_scrie_ins ON public.ofertare_acoperire_istoric;
DROP POLICY IF EXISTS istoric_scrie_upd ON public.ofertare_acoperire_istoric;
DROP POLICY IF EXISTS istoric_scrie_del ON public.ofertare_acoperire_istoric;
DROP POLICY IF EXISTS istoric_scrie ON public.ofertare_acoperire_istoric;
CREATE POLICY istoric_scrie ON public.ofertare_acoperire_istoric FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS revizii_scrie_sel ON public.ofertare_acoperire_revizii;
DROP POLICY IF EXISTS revizii_scrie_ins ON public.ofertare_acoperire_revizii;
DROP POLICY IF EXISTS revizii_scrie_upd ON public.ofertare_acoperire_revizii;
DROP POLICY IF EXISTS revizii_scrie_del ON public.ofertare_acoperire_revizii;
DROP POLICY IF EXISTS revizii_scrie ON public.ofertare_acoperire_revizii;
CREATE POLICY revizii_scrie ON public.ofertare_acoperire_revizii FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ofertare_extragere_coada_all_sel ON public.ofertare_extragere_coada;
DROP POLICY IF EXISTS ofertare_extragere_coada_all_ins ON public.ofertare_extragere_coada;
DROP POLICY IF EXISTS ofertare_extragere_coada_all_upd ON public.ofertare_extragere_coada;
DROP POLICY IF EXISTS ofertare_extragere_coada_all_del ON public.ofertare_extragere_coada;
DROP POLICY IF EXISTS ofertare_extragere_coada_all ON public.ofertare_extragere_coada;
CREATE POLICY ofertare_extragere_coada_all ON public.ofertare_extragere_coada FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ofertare_ingest_coada_all_sel ON public.ofertare_ingest_coada;
DROP POLICY IF EXISTS ofertare_ingest_coada_all_ins ON public.ofertare_ingest_coada;
DROP POLICY IF EXISTS ofertare_ingest_coada_all_upd ON public.ofertare_ingest_coada;
DROP POLICY IF EXISTS ofertare_ingest_coada_all_del ON public.ofertare_ingest_coada;
DROP POLICY IF EXISTS ofertare_ingest_coada_all ON public.ofertare_ingest_coada;
CREATE POLICY ofertare_ingest_coada_all ON public.ofertare_ingest_coada FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ofertare_inventar_ai_upd ON public.ofertare_inventar_ai;
CREATE POLICY ofertare_inventar_ai_upd ON public.ofertare_inventar_ai FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS triere_mod_sel ON public.ofertare_triere;
DROP POLICY IF EXISTS triere_mod_ins ON public.ofertare_triere;
DROP POLICY IF EXISTS triere_mod_upd ON public.ofertare_triere;
DROP POLICY IF EXISTS triere_mod_del ON public.ofertare_triere;
DROP POLICY IF EXISTS triere_mod ON public.ofertare_triere;
CREATE POLICY triere_mod ON public.ofertare_triere FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ofertare_verificari_auth_sel ON public.ofertare_verificari;
DROP POLICY IF EXISTS ofertare_verificari_auth_ins ON public.ofertare_verificari;
DROP POLICY IF EXISTS ofertare_verificari_auth_upd ON public.ofertare_verificari;
DROP POLICY IF EXISTS ofertare_verificari_auth_del ON public.ofertare_verificari;
DROP POLICY IF EXISTS ofertare_verificari_auth ON public.ofertare_verificari;
CREATE POLICY ofertare_verificari_auth ON public.ofertare_verificari FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS garantii_all_sel ON public.ofertare_garantii;
DROP POLICY IF EXISTS garantii_all_ins ON public.ofertare_garantii;
DROP POLICY IF EXISTS garantii_all_upd ON public.ofertare_garantii;
DROP POLICY IF EXISTS garantii_all_del ON public.ofertare_garantii;
DROP POLICY IF EXISTS garantii_all ON public.ofertare_garantii;
CREATE POLICY garantii_all ON public.ofertare_garantii FOR ALL TO public
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS mailuri_ins ON public.ofertare_mailuri;
CREATE POLICY mailuri_ins ON public.ofertare_mailuri FOR INSERT TO public
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS nas_inv_ins ON public.ofertare_nas_inventar;
CREATE POLICY nas_inv_ins ON public.ofertare_nas_inventar FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS nas_inv_upd ON public.ofertare_nas_inventar;
CREATE POLICY nas_inv_upd ON public.ofertare_nas_inventar FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS nas_inv_del ON public.ofertare_nas_inventar;
CREATE POLICY nas_inv_del ON public.ofertare_nas_inventar FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ofertare_participari_auth_sel ON public.ofertare_participari;
DROP POLICY IF EXISTS ofertare_participari_auth_ins ON public.ofertare_participari;
DROP POLICY IF EXISTS ofertare_participari_auth_upd ON public.ofertare_participari;
DROP POLICY IF EXISTS ofertare_participari_auth_del ON public.ofertare_participari;
DROP POLICY IF EXISTS ofertare_participari_auth ON public.ofertare_participari;
CREATE POLICY ofertare_participari_auth ON public.ofertare_participari FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pt_anexe_asteptate_rw_sel ON public.ofertare_pt_anexe_asteptate;
DROP POLICY IF EXISTS pt_anexe_asteptate_rw_ins ON public.ofertare_pt_anexe_asteptate;
DROP POLICY IF EXISTS pt_anexe_asteptate_rw_upd ON public.ofertare_pt_anexe_asteptate;
DROP POLICY IF EXISTS pt_anexe_asteptate_rw_del ON public.ofertare_pt_anexe_asteptate;
DROP POLICY IF EXISTS pt_anexe_asteptate_rw ON public.ofertare_pt_anexe_asteptate;
CREATE POLICY pt_anexe_asteptate_rw ON public.ofertare_pt_anexe_asteptate FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pt_declaratii_rw_sel ON public.ofertare_pt_declaratii;
DROP POLICY IF EXISTS pt_declaratii_rw_ins ON public.ofertare_pt_declaratii;
DROP POLICY IF EXISTS pt_declaratii_rw_upd ON public.ofertare_pt_declaratii;
DROP POLICY IF EXISTS pt_declaratii_rw_del ON public.ofertare_pt_declaratii;
DROP POLICY IF EXISTS pt_declaratii_rw ON public.ofertare_pt_declaratii;
CREATE POLICY pt_declaratii_rw ON public.ofertare_pt_declaratii FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS echipa_rw_sel ON public.ofertare_pt_echipa;
DROP POLICY IF EXISTS echipa_rw_ins ON public.ofertare_pt_echipa;
DROP POLICY IF EXISTS echipa_rw_upd ON public.ofertare_pt_echipa;
DROP POLICY IF EXISTS echipa_rw_del ON public.ofertare_pt_echipa;
DROP POLICY IF EXISTS echipa_rw ON public.ofertare_pt_echipa;
CREATE POLICY echipa_rw ON public.ofertare_pt_echipa FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS roluri_rw_sel ON public.ofertare_pt_echipa_roluri;
DROP POLICY IF EXISTS roluri_rw_ins ON public.ofertare_pt_echipa_roluri;
DROP POLICY IF EXISTS roluri_rw_upd ON public.ofertare_pt_echipa_roluri;
DROP POLICY IF EXISTS roluri_rw_del ON public.ofertare_pt_echipa_roluri;
DROP POLICY IF EXISTS roluri_rw ON public.ofertare_pt_echipa_roluri;
CREATE POLICY roluri_rw ON public.ofertare_pt_echipa_roluri FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pt_garantie_auth_sel ON public.ofertare_pt_garantie;
DROP POLICY IF EXISTS pt_garantie_auth_ins ON public.ofertare_pt_garantie;
DROP POLICY IF EXISTS pt_garantie_auth_upd ON public.ofertare_pt_garantie;
DROP POLICY IF EXISTS pt_garantie_auth_del ON public.ofertare_pt_garantie;
DROP POLICY IF EXISTS pt_garantie_auth ON public.ofertare_pt_garantie;
CREATE POLICY pt_garantie_auth ON public.ofertare_pt_garantie FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pt_participanti_auth_sel ON public.ofertare_pt_participanti;
DROP POLICY IF EXISTS pt_participanti_auth_ins ON public.ofertare_pt_participanti;
DROP POLICY IF EXISTS pt_participanti_auth_upd ON public.ofertare_pt_participanti;
DROP POLICY IF EXISTS pt_participanti_auth_del ON public.ofertare_pt_participanti;
DROP POLICY IF EXISTS pt_participanti_auth ON public.ofertare_pt_participanti;
CREATE POLICY pt_participanti_auth ON public.ofertare_pt_participanti FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS solicitari_ac_rw_sel ON public.ofertare_solicitari_ac;
DROP POLICY IF EXISTS solicitari_ac_rw_ins ON public.ofertare_solicitari_ac;
DROP POLICY IF EXISTS solicitari_ac_rw_upd ON public.ofertare_solicitari_ac;
DROP POLICY IF EXISTS solicitari_ac_rw_del ON public.ofertare_solicitari_ac;
DROP POLICY IF EXISTS solicitari_ac_rw ON public.ofertare_solicitari_ac;
CREATE POLICY solicitari_ac_rw ON public.ofertare_solicitari_ac FOR ALL TO public
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS solicitari_ac_anexe_rw_sel ON public.ofertare_solicitari_ac_anexe;
DROP POLICY IF EXISTS solicitari_ac_anexe_rw_ins ON public.ofertare_solicitari_ac_anexe;
DROP POLICY IF EXISTS solicitari_ac_anexe_rw_upd ON public.ofertare_solicitari_ac_anexe;
DROP POLICY IF EXISTS solicitari_ac_anexe_rw_del ON public.ofertare_solicitari_ac_anexe;
DROP POLICY IF EXISTS solicitari_ac_anexe_rw ON public.ofertare_solicitari_ac_anexe;
CREATE POLICY solicitari_ac_anexe_rw ON public.ofertare_solicitari_ac_anexe FOR ALL TO public
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS solicitari_ac_puncte_rw_sel ON public.ofertare_solicitari_ac_puncte;
DROP POLICY IF EXISTS solicitari_ac_puncte_rw_ins ON public.ofertare_solicitari_ac_puncte;
DROP POLICY IF EXISTS solicitari_ac_puncte_rw_upd ON public.ofertare_solicitari_ac_puncte;
DROP POLICY IF EXISTS solicitari_ac_puncte_rw_del ON public.ofertare_solicitari_ac_puncte;
DROP POLICY IF EXISTS solicitari_ac_puncte_rw ON public.ofertare_solicitari_ac_puncte;
CREATE POLICY solicitari_ac_puncte_rw ON public.ofertare_solicitari_ac_puncte FOR ALL TO public
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS grafic_act_ins ON public.grafic_activitati;
CREATE POLICY grafic_act_ins ON public.grafic_activitati FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS grafic_act_upd ON public.grafic_activitati;
CREATE POLICY grafic_act_upd ON public.grafic_activitati FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS grafic_act_del ON public.grafic_activitati;
CREATE POLICY grafic_act_del ON public.grafic_activitati FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS grafic_param_ins ON public.grafic_parametri;
CREATE POLICY grafic_param_ins ON public.grafic_parametri FOR INSERT TO public
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS grafic_param_upd ON public.grafic_parametri;
CREATE POLICY grafic_param_upd ON public.grafic_parametri FOR UPDATE TO public
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS grafic_param_del ON public.grafic_parametri;
CREATE POLICY grafic_param_del ON public.grafic_parametri FOR DELETE TO public
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS grafic_ver_ins ON public.grafic_versiuni;
CREATE POLICY grafic_ver_ins ON public.grafic_versiuni FOR INSERT TO public
  WITH CHECK (auth.uid() IS NOT NULL);
