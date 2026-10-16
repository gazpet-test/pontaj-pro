-- REVENIRE 20261031d — pune la loc fn_ofertare_cb_buget_seteaza din 20261031a (doar owner), scoate fn_ofertare_cb_este_admin și
-- coloana `rol` din ofertare_ai_buget_jurnal. Plafoanele deja setate (de owner sau de admin) rămân neatinse.
-- REFUZĂ dacă jurnalul are deja acțiuni de admin (coloana `rol` ar pierde cine a acționat — revenire manuală, cu review) sau dacă
-- obiectele s-au schimbat după aplicare (amprenta din comentariu). DOAR la cererea lui Răzvan.
-- Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261031d', 'BUGET_ADMIN_REVENIRE:' || txid_current(), true);
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261031d', true) IS DISTINCT FROM 'BUGET_ADMIN_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261031d: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261031d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_cb_este_admin()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.ofertare_ai_buget_jurnal'::regclass AND attname = 'rol' AND NOT attisdropped) THEN
    RAISE EXCEPTION '20261031d: preconditie, migrarea nu e aplicata';
  END IF;
  IF coalesce(obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class'), '') NOT LIKE '%amprenta=' || public.fn_ofertare_cb_amprenta() THEN
    RAISE EXCEPTION '20261031d: preconditie, obiectele s-au schimbat dupa aplicare (amprenta difera) - revenire manuala, cu review';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ai_buget_jurnal WHERE rol = 'admin') THEN
    RAISE EXCEPTION '20261031d: jurnalul are actiuni de admin - revenirea ar pierde rolul lor; revenire manuala, cu review';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ofertare_cb_buget_seteaza(p_licitatie_id bigint, p_scop text, p_plafon_usd numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE b record; v_consum numeric;
BEGIN
  IF NOT public.fn_ofertare_cb_este_owner() THEN RAISE EXCEPTION 'Doar owner-ul setează plafonul' USING ERRCODE = '42501'; END IF;
  IF p_scop NOT IN ('cant_extragere', 'audit_raspunsuri') OR p_plafon_usd IS NULL OR p_plafon_usd <= 0 OR p_plafon_usd > 100
     OR p_plafon_usd <> round(p_plafon_usd, 2) THEN RAISE EXCEPTION 'Scop sau plafon invalid' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id) THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = '22023'; END IF;
  -- același lock ca rezervarea: rândul bugetului (creat dacă lipsește), ÎNAINTEA citirii consumului (review r1)
  INSERT INTO public.ofertare_ai_buget (licitatie_id, scop, plafon_usd, setat_de) VALUES (p_licitatie_id, p_scop, p_plafon_usd, auth.uid())
  ON CONFLICT (licitatie_id, scop) DO NOTHING;
  SELECT * INTO b FROM public.ofertare_ai_buget WHERE licitatie_id = p_licitatie_id AND scop = p_scop FOR UPDATE;
  v_consum := public.fn_ofertare_cb_consum(p_licitatie_id, p_scop);
  IF p_plafon_usd < v_consum THEN RAISE EXCEPTION 'Plafonul (%) e sub consumul existent (%)', p_plafon_usd, v_consum USING ERRCODE = '22023'; END IF;
  UPDATE public.ofertare_ai_buget SET plafon_usd = p_plafon_usd, setat_de = auth.uid(), setat_la = now() WHERE licitatie_id = p_licitatie_id AND scop = p_scop;
  INSERT INTO public.ofertare_ai_buget_jurnal (licitatie_id, scop, actiune, plafon_vechi, plafon_nou, consum, de)
  VALUES (p_licitatie_id, p_scop, 'plafon', b.plafon_usd, p_plafon_usd, v_consum, auth.uid());
  RETURN jsonb_build_object('ok', true, 'plafon_usd', p_plafon_usd, 'consum', v_consum);
END $f$;

DROP FUNCTION public.fn_ofertare_cb_este_admin();
ALTER TABLE public.ofertare_ai_buget_jurnal DROP CONSTRAINT ofertare_ai_buget_jurnal_rol_check;
ALTER TABLE public.ofertare_ai_buget_jurnal DROP COLUMN rol;

DO $post$
DECLARE v_fp text;
BEGIN
  IF pg_get_functiondef('public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)'::regprocedure) LIKE '%este_admin%'
     OR has_function_privilege('anon', 'public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261031d: postconditie revenire buget_seteaza';
  END IF;
  v_fp := public.fn_ofertare_cb_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L', 'TKT-0329 B (20261031a + 20261031b). Imuabil. amprenta=' || v_fp);
  IF current_setting('gazpet.revenire_20261031d', true) IS DISTINCT FROM 'BUGET_ADMIN_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261031d: garda final invalida';
  END IF;
END $post$;
