-- Arhivă (read-only, live 01.10.2026, pg_get_functiondef) — excepția din lista revizuită a precondiției/postcondiției 0e (SEC F2).
-- md5(prosrc) = 47a7542895c0ce71cb0e44d2c26d0609 (corpul dintre $function$…$function$; verificat în scripts/test_sec_f1_f2.sh).
-- NU se aplică: e doar referința revizuită. Orice schimbare de corp ⇒ md5 diferit ⇒ 0e refuză ⇒ re-review + fișier nou.
CREATE OR REPLACE FUNCTION public.fn_completare_aplica(p_id bigint, p_accepta boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.executie_completari_propuse; v_ok boolean; v_sql text;
BEGIN
  SELECT (p.is_owner OR p.can_manage_contracts) INTO v_ok FROM public.profiles p WHERE p.id = auth.uid();
  IF NOT COALESCE(v_ok, false) THEN RAISE EXCEPTION 'fără drepturi'; END IF;
  SELECT * INTO r FROM public.executie_completari_propuse WHERE id = p_id AND status = 'propus' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'propunerea nu există sau a fost deja decisă'; END IF;
  IF p_accepta THEN
    IF r.camp NOT IN ('rte_employee_id','rts_employee_id','mp_employee_id','coordonator_transgaz','garantie_buna_exec_pct','penalitati_zi_pct',
                      'valoare_lei','valoare_eur','data_start','data_termen','durata_contract_luni','nr_contract','data_contract','beneficiar_final','lungime_proiect_m') THEN
      RAISE EXCEPTION 'câmp nepermis: %', r.camp;
    END IF;
    v_sql := format('UPDATE public.executie_proiecte SET %I = $1::%s, updated_at = now() WHERE id = $2', r.camp,
      CASE WHEN r.camp LIKE '%employee_id' OR r.camp = 'durata_contract_luni' THEN 'int'
           WHEN r.camp LIKE 'data_%' THEN 'date'
           WHEN r.camp IN ('garantie_buna_exec_pct','penalitati_zi_pct','valoare_lei','valoare_eur','lungime_proiect_m') THEN 'numeric'
           ELSE 'text' END);
    EXECUTE v_sql USING r.valoare, r.proiect_id;
  END IF;
  UPDATE public.executie_completari_propuse SET status = CASE WHEN p_accepta THEN 'confirmat' ELSE 'respins' END, decis_de = auth.uid(), decis_la = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'camp', r.camp, 'aplicat', p_accepta);
END $function$
