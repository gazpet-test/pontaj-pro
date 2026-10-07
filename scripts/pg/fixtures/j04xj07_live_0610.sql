-- Transplant LIVE (citit read-only din producție pe 06.10.2026): funcțiile pe care J04/J07 le ating sau de care depind,
-- cu textul și ACL-ul EXACTE din producție. Restul transplantului (J02b + garda J05) e generat din migrările din repo de
-- scripts/pg/fixtures/j04xj07_schema.mjs (aceleași instrucțiuni ca pe live, fără gărzile de livrare/pre/post).
-- Amprentele de verificat sunt în LIVE_0610 (j04xj07_schema.mjs); harness-ul refuză dacă fixture-ul diferă de ele.

CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$function$;
REVOKE ALL ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_are_acces_ofertare() TO authenticated, service_role;

-- ofertare_derogare_depunere: textul live 06.10 (md5 50656c3c…)
CREATE OR REPLACE FUNCTION public.ofertare_derogare_depunere(p_licitatie_id bigint, p_motiv text, p_acorda boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vechi public.ofertare_licitatii%ROWTYPE;
  v_nou public.ofertare_licitatii%ROWTYPE;
  v_motiv text := nullif(btrim(p_motiv), '');
BEGIN
  IF NOT public.fn_gate_depunere_derogare_owner() THEN
    RAISE EXCEPTION 'Derogarea de la poarta de depunere o poate da doar ownerul (Razvan).' USING ERRCODE = '42501';
  END IF;
  IF p_acorda IS NULL THEN
    RAISE EXCEPTION 'p_acorda trebuie să fie true sau false.' USING ERRCODE = '22023';
  END IF;
  IF p_acorda AND (v_motiv IS NULL OR char_length(v_motiv) < 10) THEN
    RAISE EXCEPTION 'Motivul derogării trebuie să aibă minimum 10 caractere.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_vechi FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Licitația % nu există.', p_licitatie_id USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.ofertare_licitatii
    SET derogare_depunere = p_acorda, derogare_motiv = v_motiv
    WHERE id = p_licitatie_id RETURNING * INTO v_nou;
  IF NOT p_acorda OR COALESCE(v_vechi.derogare_depunere, false) THEN
    INSERT INTO public.ofertare_derogari_audit
      (licitatie_id, actiune, actor, session_user_name, motiv, status_vechi, status_nou)
    VALUES (p_licitatie_id, CASE WHEN p_acorda THEN 'derogare_acordata' ELSE 'derogare_retrasa' END,
      auth.uid(), session_user, v_motiv, v_vechi.status, v_nou.status);
  END IF;
END $function$;
-- ACL ca în producție (06.10)
REVOKE ALL ON FUNCTION public.ofertare_derogare_depunere(bigint,text,boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_derogare_depunere(bigint,text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_gate_depunere() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gate_depunere() TO service_role;
REVOKE ALL ON FUNCTION public.fn_gate_depunere_derogare_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gate_depunere_derogare_owner() TO service_role;
REVOKE ALL ON FUNCTION public.fn_ofertare_obiect_in_pachet_inghetat(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_obiect_in_pachet_inghetat(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ofertare_pt_pachet_matrice() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_pt_pachet_matrice() TO service_role;
REVOKE ALL ON FUNCTION public.fn_pt_pachet_depus_verifica() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pt_pachet_depus_verifica() TO service_role;
