-- JAK-V2-07: poarta de scriere Ofertare; DELETE licitație exclusiv owner.
-- Fișierul se execută integral într-o singură tranzacție a runnerului (fără COMMIT intern).
-- Nu modifică date, granturi pe tabele sau politicile SELECT existente din secțiunea B.

-- A. Licitații: citire cross-modul; Financiar poate lega doar contractul.
DROP POLICY IF EXISTS ofertare_licitatii_all ON public.ofertare_licitatii;
DROP POLICY IF EXISTS ofertare_licitatii_select ON public.ofertare_licitatii;
DROP POLICY IF EXISTS ofertare_licitatii_insert ON public.ofertare_licitatii;
DROP POLICY IF EXISTS ofertare_licitatii_update ON public.ofertare_licitatii;
DROP POLICY IF EXISTS ofertare_licitatii_delete ON public.ofertare_licitatii;
CREATE POLICY ofertare_licitatii_select ON public.ofertare_licitatii
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_licitatii_insert ON public.ofertare_licitatii
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_licitatii_update ON public.ofertare_licitatii
  FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()) OR EXISTS (
    SELECT 1 FROM public.user_module_access u
    WHERE u.profile_id = auth.uid() AND u.module = 'financiar'
  ))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()) OR EXISTS (
    SELECT 1 FROM public.user_module_access u
    WHERE u.profile_id = auth.uid() AND u.module = 'financiar'
  ));
CREATE POLICY ofertare_licitatii_delete ON public.ofertare_licitatii
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner
  ));

CREATE OR REPLACE FUNCTION public.fn_ofertare_licitatii_scriere()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ofertare boolean := (SELECT public.fn_are_acces_ofertare());
  v_admin boolean := (session_user = 'postgres');
BEGIN
  IF v_ofertare OR v_admin THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(OLD) - 'contract_id' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(NEW) - 'contract_id' - 'updated_at') THEN
    RAISE EXCEPTION 'Modulul financiar poate modifica doar contract_id pe o licitație'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_licitatii_scriere() FROM PUBLIC;

-- Prefix stabil: garda rulează înaintea triggerelor trg_* de business.
DROP TRIGGER IF EXISTS a00_ofertare_licitatii_scriere ON public.ofertare_licitatii;
CREATE TRIGGER a00_ofertare_licitatii_scriere
  BEFORE UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_licitatii_scriere();

-- B. Lista închisă din Anexa 1; politicile SELECT separate rămân neschimbate.
-- FOR ALL participă și la SELECT; unde nu există SELECT separat, se aplică noua poartă.
DROP POLICY IF EXISTS cant_all ON public.ofertare_cantitati;
CREATE POLICY cant_all ON public.ofertare_cantitati FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS clar_all ON public.ofertare_clarificari;
CREATE POLICY clar_all ON public.ofertare_clarificari FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_clarificari_coada_all ON public.ofertare_clarificari_coada;
CREATE POLICY ofertare_clarificari_coada_all ON public.ofertare_clarificari_coada FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_acoperire_coada_all ON public.ofertare_acoperire_coada;
CREATE POLICY ofertare_acoperire_coada_all ON public.ofertare_acoperire_coada FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS istoric_scrie ON public.ofertare_acoperire_istoric;
CREATE POLICY istoric_scrie ON public.ofertare_acoperire_istoric FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS revizii_scrie ON public.ofertare_acoperire_revizii;
CREATE POLICY revizii_scrie ON public.ofertare_acoperire_revizii FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_extragere_coada_all ON public.ofertare_extragere_coada;
CREATE POLICY ofertare_extragere_coada_all ON public.ofertare_extragere_coada FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_ingest_coada_all ON public.ofertare_ingest_coada;
CREATE POLICY ofertare_ingest_coada_all ON public.ofertare_ingest_coada FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_inventar_ai_upd ON public.ofertare_inventar_ai;
CREATE POLICY ofertare_inventar_ai_upd ON public.ofertare_inventar_ai FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS triere_mod ON public.ofertare_triere;
CREATE POLICY triere_mod ON public.ofertare_triere FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_verificari_auth ON public.ofertare_verificari;
CREATE POLICY ofertare_verificari_auth ON public.ofertare_verificari FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS garantii_all ON public.ofertare_garantii;
CREATE POLICY garantii_all ON public.ofertare_garantii FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS mailuri_ins ON public.ofertare_mailuri;
CREATE POLICY mailuri_ins ON public.ofertare_mailuri FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS nas_inv_ins ON public.ofertare_nas_inventar;
CREATE POLICY nas_inv_ins ON public.ofertare_nas_inventar FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS nas_inv_upd ON public.ofertare_nas_inventar;
CREATE POLICY nas_inv_upd ON public.ofertare_nas_inventar FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS nas_inv_del ON public.ofertare_nas_inventar;
CREATE POLICY nas_inv_del ON public.ofertare_nas_inventar FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_participari_auth ON public.ofertare_participari;
CREATE POLICY ofertare_participari_auth ON public.ofertare_participari FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS pt_anexe_asteptate_rw ON public.ofertare_pt_anexe_asteptate;
CREATE POLICY pt_anexe_asteptate_rw ON public.ofertare_pt_anexe_asteptate FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS pt_declaratii_rw ON public.ofertare_pt_declaratii;
CREATE POLICY pt_declaratii_rw ON public.ofertare_pt_declaratii FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS echipa_rw ON public.ofertare_pt_echipa;
CREATE POLICY echipa_rw ON public.ofertare_pt_echipa FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS roluri_rw ON public.ofertare_pt_echipa_roluri;
CREATE POLICY roluri_rw ON public.ofertare_pt_echipa_roluri FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS pt_garantie_auth ON public.ofertare_pt_garantie;
CREATE POLICY pt_garantie_auth ON public.ofertare_pt_garantie FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS pt_participanti_auth ON public.ofertare_pt_participanti;
CREATE POLICY pt_participanti_auth ON public.ofertare_pt_participanti FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS solicitari_ac_rw ON public.ofertare_solicitari_ac;
CREATE POLICY solicitari_ac_rw ON public.ofertare_solicitari_ac FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS solicitari_ac_anexe_rw ON public.ofertare_solicitari_ac_anexe;
CREATE POLICY solicitari_ac_anexe_rw ON public.ofertare_solicitari_ac_anexe FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS solicitari_ac_puncte_rw ON public.ofertare_solicitari_ac_puncte;
CREATE POLICY solicitari_ac_puncte_rw ON public.ofertare_solicitari_ac_puncte FOR ALL TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS grafic_act_ins ON public.grafic_activitati;
CREATE POLICY grafic_act_ins ON public.grafic_activitati FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS grafic_act_upd ON public.grafic_activitati;
CREATE POLICY grafic_act_upd ON public.grafic_activitati FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS grafic_act_del ON public.grafic_activitati;
CREATE POLICY grafic_act_del ON public.grafic_activitati FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS grafic_param_ins ON public.grafic_parametri;
CREATE POLICY grafic_param_ins ON public.grafic_parametri FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS grafic_param_upd ON public.grafic_parametri;
CREATE POLICY grafic_param_upd ON public.grafic_parametri FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS grafic_param_del ON public.grafic_parametri;
CREATE POLICY grafic_param_del ON public.grafic_parametri FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS grafic_ver_ins ON public.grafic_versiuni;
CREATE POLICY grafic_ver_ins ON public.grafic_versiuni FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
