-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261031d — Ofertare TKT-0329 B: plafonul de cheltuieli AI se poate seta și de un ADMIN Ofertare, nu doar de owner
-- (decizia lui Răzvan, 16.10.2026, varianta A, confirmată direct în sesiunea Ofertare: pipeline-ul nu se blochează când owner-ul lipsește).
--   * owner (profiles.is_owner): neschimbat, plafon ≤ 100 USD pe (licitație, scop);
--   * admin Ofertare (user_module_access module = 'ofertare', access_level = 'admin' — aceeași definiție ca garda pachetului
--     sursă din 20260923 „p0c_source_pack_gate_ofertare_admin”): plafon ≤ 5,00 USD, inclusiv la mărirea unui plafon existent;
--     un plafon > 5 existent (pus de owner) NU poate fi modificat de admin, nici în sus, nici în jos;
--   * jurnalul ofertare_ai_buget_jurnal primește coloana `rol` ('owner' / 'admin') — cine (de = auth.uid()), când (la) și cât
--     (plafon_vechi / plafon_nou) existau deja; rândurile vechi primesc 'owner' (până acum doar owner-ul putea scrie).
-- Deblocarea bugetului rămâne DOAR la owner. Nu se acordă drepturi și nu se schimbă roluri; ACL-ul lui fn_ofertare_cb_buget_seteaza
-- rămâne cel din 20261031a (CREATE OR REPLACE îl păstrează). fn_ofertare_cb_este_admin() nu e apelabilă din API (doar din funcțiile
-- SECURITY DEFINER ale owner-ului postgres).
-- Depinde de 20261031a + 20261031b aplicate și NEMODIFICATE (amprenta din comentariu). Reîmprospătează amprenta.
-- Revenire: supabase/revenire/20261031d_ofertare_buget_admin_ROLLBACK.sql (armată; refuză dacă jurnalul are deja acțiuni de admin).
-- LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261031d_ofertare_buget_admin:' || txid_current() THEN
    RAISE EXCEPTION '20261031d: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261031d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)') IS NULL OR to_regprocedure('public.fn_ofertare_cb_amprenta()') IS NULL
     OR to_regclass('public.ofertare_ai_buget_jurnal') IS NULL
     OR to_regprocedure('public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])') IS NULL
     OR pg_get_functiondef('public.fn_ofertare_cb_text_scrie(bigint,text,text,text,text,integer[])'::regprocedure) NOT LIKE '%text_depasit%' THEN
    RAISE EXCEPTION '20261031d: preconditie, 20261031a + 20261031b nu sunt aplicate';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.ofertare_ai_buget_jurnal'::regclass AND attname = 'rol' AND NOT attisdropped)
     OR to_regprocedure('public.fn_ofertare_cb_este_admin()') IS NOT NULL THEN
    RAISE EXCEPTION '20261031d: deja aplicata';
  END IF;
  IF coalesce(obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class'), '') NOT LIKE '%amprenta=' || public.fn_ofertare_cb_amprenta() THEN
    RAISE EXCEPTION '20261031d: preconditie, obiectele 20261031a/b s-au schimbat dupa aplicare (amprenta difera)';
  END IF;
END $pre$;

-- rolul cu care s-a acționat; rândurile existente = owner (singurul care putea scrie până acum). ADD COLUMN cu DEFAULT constant nu
-- rescrie tabelul (nici nu trece prin UPDATE), deci triggerul de imuabilitate (BEFORE UPDATE OR DELETE) nu e atins.
ALTER TABLE public.ofertare_ai_buget_jurnal ADD COLUMN rol text NOT NULL DEFAULT 'owner';
ALTER TABLE public.ofertare_ai_buget_jurnal ADD CONSTRAINT ofertare_ai_buget_jurnal_rol_check CHECK (rol IN ('owner', 'admin'));

CREATE FUNCTION public.fn_ofertare_cb_este_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_module_access uma
                                                  WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare' AND uma.access_level = 'admin') $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_cb_este_admin() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ofertare_cb_buget_seteaza(p_licitatie_id bigint, p_scop text, p_plafon_usd numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE b record; v_consum numeric; v_rol text;
BEGIN
  -- 20261031d: owner SAU admin Ofertare; owner-ul are întâietate (un owner care e și admin rămâne la limita de owner)
  v_rol := CASE WHEN public.fn_ofertare_cb_este_owner() THEN 'owner' WHEN public.fn_ofertare_cb_este_admin() THEN 'admin' END;
  IF v_rol IS NULL THEN RAISE EXCEPTION 'Doar owner-ul sau un admin Ofertare setează plafonul' USING ERRCODE = '42501'; END IF;
  IF p_scop NOT IN ('cant_extragere', 'audit_raspunsuri') OR p_plafon_usd IS NULL OR p_plafon_usd <= 0 OR p_plafon_usd > 100
     OR p_plafon_usd <> round(p_plafon_usd, 2) THEN RAISE EXCEPTION 'Scop sau plafon invalid' USING ERRCODE = '22023'; END IF;
  -- limita adminului: cel mult 5,00 USD pe (licitație, scop)
  IF v_rol = 'admin' AND p_plafon_usd > 5 THEN RAISE EXCEPTION 'Un admin Ofertare setează plafonul cel mult la 5,00 USD' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id) THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = '22023'; END IF;
  -- același lock ca rezervarea: rândul bugetului (creat dacă lipsește), ÎNAINTEA citirii consumului (review r1)
  INSERT INTO public.ofertare_ai_buget (licitatie_id, scop, plafon_usd, setat_de) VALUES (p_licitatie_id, p_scop, p_plafon_usd, auth.uid())
  ON CONFLICT (licitatie_id, scop) DO NOTHING;
  SELECT * INTO b FROM public.ofertare_ai_buget WHERE licitatie_id = p_licitatie_id AND scop = p_scop FOR UPDATE;
  -- sub lock: un plafon existent > 5 nu se atinge de admin, nici în sus, nici în jos (rândul tocmai creat de el are ≤ 5)
  IF v_rol = 'admin' AND b.plafon_usd > 5 THEN
    RAISE EXCEPTION 'Plafonul existent (%) e peste limita adminului (5,00 USD): îl modifică doar owner-ul', b.plafon_usd USING ERRCODE = '42501';
  END IF;
  v_consum := public.fn_ofertare_cb_consum(p_licitatie_id, p_scop);
  IF p_plafon_usd < v_consum THEN RAISE EXCEPTION 'Plafonul (%) e sub consumul existent (%)', p_plafon_usd, v_consum USING ERRCODE = '22023'; END IF;
  UPDATE public.ofertare_ai_buget SET plafon_usd = p_plafon_usd, setat_de = auth.uid(), setat_la = now() WHERE licitatie_id = p_licitatie_id AND scop = p_scop;
  INSERT INTO public.ofertare_ai_buget_jurnal (licitatie_id, scop, actiune, plafon_vechi, plafon_nou, consum, de, rol)
  VALUES (p_licitatie_id, p_scop, 'plafon', b.plafon_usd, p_plafon_usd, v_consum, auth.uid(), v_rol);
  RETURN jsonb_build_object('ok', true, 'plafon_usd', p_plafon_usd, 'consum', v_consum, 'rol', v_rol);
END $f$;

DO $post$
DECLARE v_fp text;
BEGIN
  IF has_function_privilege('anon', 'public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261031d: postconditie drepturi buget_seteaza';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ofertare_cb_este_admin()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ofertare_cb_este_admin()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_ofertare_cb_este_admin()', 'EXECUTE') THEN
    RAISE EXCEPTION '20261031d: postconditie drepturi este_admin';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ai_buget_jurnal WHERE rol IS DISTINCT FROM 'owner') THEN
    RAISE EXCEPTION '20261031d: postconditie, jurnalul vechi trebuia sa fie tot owner';
  END IF;
  v_fp := public.fn_ofertare_cb_amprenta();
  EXECUTE format('COMMENT ON TABLE public.ofertare_analiza_versiuni IS %L', 'TKT-0329 B (20261031a + 20261031b + 20261031d). Imuabil. amprenta=' || v_fp);
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261031d_ofertare_buget_admin:' || txid_current() THEN
    RAISE EXCEPTION '20261031d: garda final invalida';
  END IF;
END $post$;
