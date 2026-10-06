-- ════════════════════════════════════════════════════════════════════════════
-- 20261018a_hr_decizii_registru_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Retrage registrul HR (PR1 generator decizii): tabelele, view-ul, funcțiile, bucket-ul hr-decizii cu politicile lui,
-- coloana executie_completari_propuse.hr_decizie_id; readuce fn_completare_aplica la forma revizuită 47a75428
-- (docs/sec_f2_whitelist) și politica completari_ins la condiția de dinainte.
-- Refuză dacă registrul are ORICE date (decizii, evenimente, contor, propuneri legate, fișiere în bucket): un registru
-- oficial nu se șterge prin revenire. Atunci se decide separat, cu Răzvan (export + migrare vizibilă).
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261018a', 'STERGE_REGISTRU_HR:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261018a', true) IS DISTINCT FROM 'STERGE_REGISTRU_HR:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261018a: nearmată (gazpet.revenire_20261018a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261018a=%') THEN
    RAISE EXCEPTION 'Revenire 20261018a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261018a: rulează ca postgres'; END IF;
  IF to_regclass('public.hr_decizii') IS NULL THEN RAISE EXCEPTION 'Revenire 20261018a: registrul nu există'; END IF;
  LOCK TABLE public.hr_decizii, public.hr_decizii_evenimente, public.hr_decizii_contor, public.executie_completari_propuse IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.hr_decizii) OR EXISTS (SELECT 1 FROM public.hr_decizii_evenimente) OR EXISTS (SELECT 1 FROM public.hr_decizii_contor)
     OR EXISTS (SELECT 1 FROM public.executie_completari_propuse WHERE hr_decizie_id IS NOT NULL OR sursa IN ('decizie_numire','decizie_revocare'))
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'hr-decizii') THEN
    RAISE EXCEPTION 'Revenire 20261018a: registrul HR are date (decizii/evenimente/contor/propuneri/fișiere) — refuz';
  END IF;
END
$arm$;

DROP POLICY hr_decizii_storage_select ON storage.objects;
DROP POLICY hr_decizii_storage_insert ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'hr-decizii';
ALTER POLICY completari_ins ON public.executie_completari_propuse
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.is_owner OR p.can_manage_contracts)));

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
END $function$;

DROP VIEW public.v_hr_decizii_curente;
-- întâi funcțiile care folosesc tipurile de rând ale registrului (altfel DROP TABLE refuză)
DO $fn_tip$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND (pg_get_function_arguments(p.oid) ~ 'hr_decizii' OR pg_get_function_result(p.oid) ~ 'hr_decizii')
              AND (p.proname LIKE '\_hr\_%' OR p.proname LIKE 'fn\_hr\_decizi%') LOOP
    EXECUTE format('DROP FUNCTION %s', f.sig);
  END LOOP;
END
$fn_tip$;
ALTER TABLE public.executie_completari_propuse DROP COLUMN hr_decizie_id;
DROP TABLE public.hr_decizii_evenimente, public.hr_decizii_contor, public.hr_decizii_semnatari, public.hr_decizii, public.hr_decizii_tipuri;

DO $fn$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND (p.proname LIKE '\_hr\_%' OR p.proname LIKE 'fn\_hr\_decizi%' OR p.proname LIKE '\_completare\_%')
            ORDER BY p.proname LOOP
    EXECUTE format('DROP FUNCTION %s', f.sig);
  END LOOP;
END
$fn$;

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_completare_aplica(bigint,boolean)'))
       IS DISTINCT FROM '47a7542895c0ce71cb0e44d2c26d0609' THEN
    RAISE EXCEPTION 'Revenire 20261018a: fn_completare_aplica nu a revenit la forma 47a75428';
  END IF;
  IF to_regclass('public.hr_decizii') IS NOT NULL OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hr-decizii') THEN
    RAISE EXCEPTION 'Revenire 20261018a: au rămas obiecte';
  END IF;
  RAISE NOTICE 'Revenire 20261018a: registrul HR retras, fn_completare_aplica și completari_ins la forma de dinainte';
END
$post$;
