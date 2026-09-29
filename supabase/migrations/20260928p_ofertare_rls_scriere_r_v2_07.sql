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
  -- SECURITY DEFINER: current_user este proprietarul funcției, nu apelantul.
  v_admin boolean := (session_user = 'postgres');
  v_ofertare boolean := (SELECT public.fn_are_acces_ofertare());
  v_service boolean := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true)
  ) = 'service_role';
BEGIN
  IF v_admin OR v_ofertare THEN
    RETURN NEW;
  END IF;
  IF v_service THEN
    IF (to_jsonb(OLD) - 'termen_depunere' - 'documentatie_adusa_la' - 'updated_at')
         IS DISTINCT FROM (to_jsonb(NEW) - 'termen_depunere' - 'documentatie_adusa_la' - 'updated_at') THEN
      RAISE EXCEPTION 'Contextul automat (service_role) poate modifica doar termen_depunere/documentatie_adusa_la'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_module_access u
    WHERE u.profile_id = auth.uid() AND u.module = 'financiar'
  ) THEN
    RAISE EXCEPTION 'Contextul curent nu poate modifica o licitație'
      USING ERRCODE = 'P0001';
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
-- FOR ALL devine SELECT cu condiția/rolurile vechi + trei politici de scriere gated.
DROP POLICY IF EXISTS cant_all ON public.ofertare_cantitati;
DROP POLICY IF EXISTS cant_all_sel ON public.ofertare_cantitati;
CREATE POLICY cant_all_sel ON public.ofertare_cantitati FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS cant_all_ins ON public.ofertare_cantitati;
CREATE POLICY cant_all_ins ON public.ofertare_cantitati FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS cant_all_upd ON public.ofertare_cantitati;
CREATE POLICY cant_all_upd ON public.ofertare_cantitati FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS cant_all_del ON public.ofertare_cantitati;
CREATE POLICY cant_all_del ON public.ofertare_cantitati FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS clar_all ON public.ofertare_clarificari;
DROP POLICY IF EXISTS clar_all_sel ON public.ofertare_clarificari;
CREATE POLICY clar_all_sel ON public.ofertare_clarificari FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS clar_all_ins ON public.ofertare_clarificari;
CREATE POLICY clar_all_ins ON public.ofertare_clarificari FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS clar_all_upd ON public.ofertare_clarificari;
CREATE POLICY clar_all_upd ON public.ofertare_clarificari FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS clar_all_del ON public.ofertare_clarificari;
CREATE POLICY clar_all_del ON public.ofertare_clarificari FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_clarificari_coada_all ON public.ofertare_clarificari_coada;
DROP POLICY IF EXISTS ofertare_clarificari_coada_all_sel ON public.ofertare_clarificari_coada;
CREATE POLICY ofertare_clarificari_coada_all_sel ON public.ofertare_clarificari_coada FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_clarificari_coada_all_ins ON public.ofertare_clarificari_coada;
CREATE POLICY ofertare_clarificari_coada_all_ins ON public.ofertare_clarificari_coada FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_clarificari_coada_all_upd ON public.ofertare_clarificari_coada;
CREATE POLICY ofertare_clarificari_coada_all_upd ON public.ofertare_clarificari_coada FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_clarificari_coada_all_del ON public.ofertare_clarificari_coada;
CREATE POLICY ofertare_clarificari_coada_all_del ON public.ofertare_clarificari_coada FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_acoperire_coada_all ON public.ofertare_acoperire_coada;
DROP POLICY IF EXISTS ofertare_acoperire_coada_all_sel ON public.ofertare_acoperire_coada;
CREATE POLICY ofertare_acoperire_coada_all_sel ON public.ofertare_acoperire_coada FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_acoperire_coada_all_ins ON public.ofertare_acoperire_coada;
CREATE POLICY ofertare_acoperire_coada_all_ins ON public.ofertare_acoperire_coada FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_acoperire_coada_all_upd ON public.ofertare_acoperire_coada;
CREATE POLICY ofertare_acoperire_coada_all_upd ON public.ofertare_acoperire_coada FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_acoperire_coada_all_del ON public.ofertare_acoperire_coada;
CREATE POLICY ofertare_acoperire_coada_all_del ON public.ofertare_acoperire_coada FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS istoric_scrie ON public.ofertare_acoperire_istoric;
DROP POLICY IF EXISTS istoric_scrie_sel ON public.ofertare_acoperire_istoric;
CREATE POLICY istoric_scrie_sel ON public.ofertare_acoperire_istoric FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS istoric_scrie_ins ON public.ofertare_acoperire_istoric;
CREATE POLICY istoric_scrie_ins ON public.ofertare_acoperire_istoric FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS istoric_scrie_upd ON public.ofertare_acoperire_istoric;
CREATE POLICY istoric_scrie_upd ON public.ofertare_acoperire_istoric FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS istoric_scrie_del ON public.ofertare_acoperire_istoric;
CREATE POLICY istoric_scrie_del ON public.ofertare_acoperire_istoric FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS revizii_scrie ON public.ofertare_acoperire_revizii;
DROP POLICY IF EXISTS revizii_scrie_sel ON public.ofertare_acoperire_revizii;
CREATE POLICY revizii_scrie_sel ON public.ofertare_acoperire_revizii FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS revizii_scrie_ins ON public.ofertare_acoperire_revizii;
CREATE POLICY revizii_scrie_ins ON public.ofertare_acoperire_revizii FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS revizii_scrie_upd ON public.ofertare_acoperire_revizii;
CREATE POLICY revizii_scrie_upd ON public.ofertare_acoperire_revizii FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS revizii_scrie_del ON public.ofertare_acoperire_revizii;
CREATE POLICY revizii_scrie_del ON public.ofertare_acoperire_revizii FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_extragere_coada_all ON public.ofertare_extragere_coada;
DROP POLICY IF EXISTS ofertare_extragere_coada_all_sel ON public.ofertare_extragere_coada;
CREATE POLICY ofertare_extragere_coada_all_sel ON public.ofertare_extragere_coada FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_extragere_coada_all_ins ON public.ofertare_extragere_coada;
CREATE POLICY ofertare_extragere_coada_all_ins ON public.ofertare_extragere_coada FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_extragere_coada_all_upd ON public.ofertare_extragere_coada;
CREATE POLICY ofertare_extragere_coada_all_upd ON public.ofertare_extragere_coada FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_extragere_coada_all_del ON public.ofertare_extragere_coada;
CREATE POLICY ofertare_extragere_coada_all_del ON public.ofertare_extragere_coada FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_ingest_coada_all ON public.ofertare_ingest_coada;
DROP POLICY IF EXISTS ofertare_ingest_coada_all_sel ON public.ofertare_ingest_coada;
CREATE POLICY ofertare_ingest_coada_all_sel ON public.ofertare_ingest_coada FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_ingest_coada_all_ins ON public.ofertare_ingest_coada;
CREATE POLICY ofertare_ingest_coada_all_ins ON public.ofertare_ingest_coada FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_ingest_coada_all_upd ON public.ofertare_ingest_coada;
CREATE POLICY ofertare_ingest_coada_all_upd ON public.ofertare_ingest_coada FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_ingest_coada_all_del ON public.ofertare_ingest_coada;
CREATE POLICY ofertare_ingest_coada_all_del ON public.ofertare_ingest_coada FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_inventar_ai_upd ON public.ofertare_inventar_ai;
CREATE POLICY ofertare_inventar_ai_upd ON public.ofertare_inventar_ai FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS triere_mod ON public.ofertare_triere;
DROP POLICY IF EXISTS triere_mod_sel ON public.ofertare_triere;
CREATE POLICY triere_mod_sel ON public.ofertare_triere FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS triere_mod_ins ON public.ofertare_triere;
CREATE POLICY triere_mod_ins ON public.ofertare_triere FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS triere_mod_upd ON public.ofertare_triere;
CREATE POLICY triere_mod_upd ON public.ofertare_triere FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS triere_mod_del ON public.ofertare_triere;
CREATE POLICY triere_mod_del ON public.ofertare_triere FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_verificari_auth ON public.ofertare_verificari;
DROP POLICY IF EXISTS ofertare_verificari_auth_sel ON public.ofertare_verificari;
CREATE POLICY ofertare_verificari_auth_sel ON public.ofertare_verificari FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_verificari_auth_ins ON public.ofertare_verificari;
CREATE POLICY ofertare_verificari_auth_ins ON public.ofertare_verificari FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_verificari_auth_upd ON public.ofertare_verificari;
CREATE POLICY ofertare_verificari_auth_upd ON public.ofertare_verificari FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_verificari_auth_del ON public.ofertare_verificari;
CREATE POLICY ofertare_verificari_auth_del ON public.ofertare_verificari FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS garantii_all ON public.ofertare_garantii;
DROP POLICY IF EXISTS garantii_all_sel ON public.ofertare_garantii;
CREATE POLICY garantii_all_sel ON public.ofertare_garantii FOR SELECT TO public
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS garantii_all_ins ON public.ofertare_garantii;
CREATE POLICY garantii_all_ins ON public.ofertare_garantii FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS garantii_all_upd ON public.ofertare_garantii;
CREATE POLICY garantii_all_upd ON public.ofertare_garantii FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS garantii_all_del ON public.ofertare_garantii;
CREATE POLICY garantii_all_del ON public.ofertare_garantii FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

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
DROP POLICY IF EXISTS ofertare_participari_auth_sel ON public.ofertare_participari;
CREATE POLICY ofertare_participari_auth_sel ON public.ofertare_participari FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS ofertare_participari_auth_ins ON public.ofertare_participari;
CREATE POLICY ofertare_participari_auth_ins ON public.ofertare_participari FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_participari_auth_upd ON public.ofertare_participari;
CREATE POLICY ofertare_participari_auth_upd ON public.ofertare_participari FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS ofertare_participari_auth_del ON public.ofertare_participari;
CREATE POLICY ofertare_participari_auth_del ON public.ofertare_participari FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS pt_anexe_asteptate_rw ON public.ofertare_pt_anexe_asteptate;
DROP POLICY IF EXISTS pt_anexe_asteptate_rw_sel ON public.ofertare_pt_anexe_asteptate;
CREATE POLICY pt_anexe_asteptate_rw_sel ON public.ofertare_pt_anexe_asteptate FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS pt_anexe_asteptate_rw_ins ON public.ofertare_pt_anexe_asteptate;
CREATE POLICY pt_anexe_asteptate_rw_ins ON public.ofertare_pt_anexe_asteptate FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS pt_anexe_asteptate_rw_upd ON public.ofertare_pt_anexe_asteptate;
CREATE POLICY pt_anexe_asteptate_rw_upd ON public.ofertare_pt_anexe_asteptate FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS pt_anexe_asteptate_rw_del ON public.ofertare_pt_anexe_asteptate;
CREATE POLICY pt_anexe_asteptate_rw_del ON public.ofertare_pt_anexe_asteptate FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS pt_declaratii_rw ON public.ofertare_pt_declaratii;
DROP POLICY IF EXISTS pt_declaratii_rw_sel ON public.ofertare_pt_declaratii;
CREATE POLICY pt_declaratii_rw_sel ON public.ofertare_pt_declaratii FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS pt_declaratii_rw_ins ON public.ofertare_pt_declaratii;
CREATE POLICY pt_declaratii_rw_ins ON public.ofertare_pt_declaratii FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS pt_declaratii_rw_upd ON public.ofertare_pt_declaratii;
CREATE POLICY pt_declaratii_rw_upd ON public.ofertare_pt_declaratii FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS pt_declaratii_rw_del ON public.ofertare_pt_declaratii;
CREATE POLICY pt_declaratii_rw_del ON public.ofertare_pt_declaratii FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS echipa_rw ON public.ofertare_pt_echipa;
DROP POLICY IF EXISTS echipa_rw_sel ON public.ofertare_pt_echipa;
CREATE POLICY echipa_rw_sel ON public.ofertare_pt_echipa FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS echipa_rw_ins ON public.ofertare_pt_echipa;
CREATE POLICY echipa_rw_ins ON public.ofertare_pt_echipa FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS echipa_rw_upd ON public.ofertare_pt_echipa;
CREATE POLICY echipa_rw_upd ON public.ofertare_pt_echipa FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS echipa_rw_del ON public.ofertare_pt_echipa;
CREATE POLICY echipa_rw_del ON public.ofertare_pt_echipa FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS roluri_rw ON public.ofertare_pt_echipa_roluri;
DROP POLICY IF EXISTS roluri_rw_sel ON public.ofertare_pt_echipa_roluri;
CREATE POLICY roluri_rw_sel ON public.ofertare_pt_echipa_roluri FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS roluri_rw_ins ON public.ofertare_pt_echipa_roluri;
CREATE POLICY roluri_rw_ins ON public.ofertare_pt_echipa_roluri FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS roluri_rw_upd ON public.ofertare_pt_echipa_roluri;
CREATE POLICY roluri_rw_upd ON public.ofertare_pt_echipa_roluri FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS roluri_rw_del ON public.ofertare_pt_echipa_roluri;
CREATE POLICY roluri_rw_del ON public.ofertare_pt_echipa_roluri FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS pt_garantie_auth ON public.ofertare_pt_garantie;
DROP POLICY IF EXISTS pt_garantie_auth_sel ON public.ofertare_pt_garantie;
CREATE POLICY pt_garantie_auth_sel ON public.ofertare_pt_garantie FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS pt_garantie_auth_ins ON public.ofertare_pt_garantie;
CREATE POLICY pt_garantie_auth_ins ON public.ofertare_pt_garantie FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS pt_garantie_auth_upd ON public.ofertare_pt_garantie;
CREATE POLICY pt_garantie_auth_upd ON public.ofertare_pt_garantie FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS pt_garantie_auth_del ON public.ofertare_pt_garantie;
CREATE POLICY pt_garantie_auth_del ON public.ofertare_pt_garantie FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS pt_participanti_auth ON public.ofertare_pt_participanti;
DROP POLICY IF EXISTS pt_participanti_auth_sel ON public.ofertare_pt_participanti;
CREATE POLICY pt_participanti_auth_sel ON public.ofertare_pt_participanti FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS pt_participanti_auth_ins ON public.ofertare_pt_participanti;
CREATE POLICY pt_participanti_auth_ins ON public.ofertare_pt_participanti FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS pt_participanti_auth_upd ON public.ofertare_pt_participanti;
CREATE POLICY pt_participanti_auth_upd ON public.ofertare_pt_participanti FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS pt_participanti_auth_del ON public.ofertare_pt_participanti;
CREATE POLICY pt_participanti_auth_del ON public.ofertare_pt_participanti FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS solicitari_ac_rw ON public.ofertare_solicitari_ac;
DROP POLICY IF EXISTS solicitari_ac_rw_sel ON public.ofertare_solicitari_ac;
CREATE POLICY solicitari_ac_rw_sel ON public.ofertare_solicitari_ac FOR SELECT TO public
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS solicitari_ac_rw_ins ON public.ofertare_solicitari_ac;
CREATE POLICY solicitari_ac_rw_ins ON public.ofertare_solicitari_ac FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS solicitari_ac_rw_upd ON public.ofertare_solicitari_ac;
CREATE POLICY solicitari_ac_rw_upd ON public.ofertare_solicitari_ac FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS solicitari_ac_rw_del ON public.ofertare_solicitari_ac;
CREATE POLICY solicitari_ac_rw_del ON public.ofertare_solicitari_ac FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS solicitari_ac_anexe_rw ON public.ofertare_solicitari_ac_anexe;
DROP POLICY IF EXISTS solicitari_ac_anexe_rw_sel ON public.ofertare_solicitari_ac_anexe;
CREATE POLICY solicitari_ac_anexe_rw_sel ON public.ofertare_solicitari_ac_anexe FOR SELECT TO public
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS solicitari_ac_anexe_rw_ins ON public.ofertare_solicitari_ac_anexe;
CREATE POLICY solicitari_ac_anexe_rw_ins ON public.ofertare_solicitari_ac_anexe FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS solicitari_ac_anexe_rw_upd ON public.ofertare_solicitari_ac_anexe;
CREATE POLICY solicitari_ac_anexe_rw_upd ON public.ofertare_solicitari_ac_anexe FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS solicitari_ac_anexe_rw_del ON public.ofertare_solicitari_ac_anexe;
CREATE POLICY solicitari_ac_anexe_rw_del ON public.ofertare_solicitari_ac_anexe FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS solicitari_ac_puncte_rw ON public.ofertare_solicitari_ac_puncte;
DROP POLICY IF EXISTS solicitari_ac_puncte_rw_sel ON public.ofertare_solicitari_ac_puncte;
CREATE POLICY solicitari_ac_puncte_rw_sel ON public.ofertare_solicitari_ac_puncte FOR SELECT TO public
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS solicitari_ac_puncte_rw_ins ON public.ofertare_solicitari_ac_puncte;
CREATE POLICY solicitari_ac_puncte_rw_ins ON public.ofertare_solicitari_ac_puncte FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS solicitari_ac_puncte_rw_upd ON public.ofertare_solicitari_ac_puncte;
CREATE POLICY solicitari_ac_puncte_rw_upd ON public.ofertare_solicitari_ac_puncte FOR UPDATE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()))
  WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
DROP POLICY IF EXISTS solicitari_ac_puncte_rw_del ON public.ofertare_solicitari_ac_puncte;
CREATE POLICY solicitari_ac_puncte_rw_del ON public.ofertare_solicitari_ac_puncte FOR DELETE TO authenticated
  USING ((SELECT public.fn_are_acces_ofertare()));

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
