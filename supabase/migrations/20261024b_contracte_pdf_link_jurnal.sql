-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261024b — contracte-pdf-link: jurnal + limită de cereri (varianta A, decizia Răzvan 12.10.2026)
-- Obiecte NOI: tabelul public.contracte_pdf_link_jurnal (RLS pornit, fără politici, fără drepturi pentru anon/authenticated) și
-- funcția public.fn_contracte_pdf_link_rezerva(bigint) (SECURITY DEFINER, EXECUTE doar service_role) — folosite DOAR de edge-ul
-- contracte-pdf-link. Funcția numără cererile din jurnal (limită 20/minut și 300/24h), scrie rândul cererii și întoarce
-- jsonb { rezultat: permis|limita|inexistent|fara_pdf, pdf_path (doar la permis) }. Nu atinge date existente.
-- Jurnalul NU conține URL-uri semnate, secrete sau antete — doar contract_id, rezultat, moment.
-- Secretul CONTRACTE_PDF_LINK_SECRET NU e creat aici: îl creează Răzvan în Vault (64 hex), îl pune pe serverul AI.
-- Revenire: supabase/revenire/20261024b_contracte_pdf_link_jurnal_ROLLBACK.sql (șterge tabelul și funcția — jurnalul se pierde).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261024b_contracte_pdf_link_jurnal:' || txid_current() THEN
    RAISE EXCEPTION '20261024b: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261024b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.contracte_pdf_link_jurnal') IS NOT NULL
     OR to_regprocedure('public.fn_contracte_pdf_link_rezerva(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION '20261024b: obiectele exista deja';
  END IF;
  IF to_regclass('public.contracte_terti') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contracte_terti' AND column_name = 'pdf_path')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contracte_terti' AND column_name = 'id' AND data_type = 'bigint') THEN
    RAISE EXCEPTION '20261024b: contracte_terti.id (bigint) / pdf_path lipsesc';
  END IF;
END $pre$;

CREATE TABLE public.contracte_pdf_link_jurnal (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  la          timestamptz NOT NULL DEFAULT now(),
  contract_id bigint NOT NULL,
  rezultat    text NOT NULL CHECK (rezultat IN ('permis', 'limita', 'inexistent', 'fara_pdf'))
);
COMMENT ON TABLE public.contracte_pdf_link_jurnal IS 'Jurnal + limita pentru edge contracte-pdf-link (12.10.2026). Doar service_role. Fara URL-uri/secrete.';
CREATE INDEX contracte_pdf_link_jurnal_la_idx ON public.contracte_pdf_link_jurnal (la DESC);
ALTER TABLE public.contracte_pdf_link_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contracte_pdf_link_jurnal FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.contracte_pdf_link_jurnal TO service_role;

CREATE FUNCTION public.fn_contracte_pdf_link_rezerva(p_contract_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_path   text;
  v_minut  integer;
  v_zi     integer;
  v_rez    text;
BEGIN
  -- serializează numărătoarea cu inserarea (altfel două cereri simultane pot depăși limita)
  PERFORM pg_advisory_xact_lock(hashtext('contracte_pdf_link'));
  SELECT count(*) INTO v_minut FROM public.contracte_pdf_link_jurnal WHERE la > now() - interval '1 minute' AND rezultat IN ('permis', 'limita');
  SELECT count(*) INTO v_zi    FROM public.contracte_pdf_link_jurnal WHERE la > now() - interval '24 hours' AND rezultat IN ('permis', 'limita');
  IF v_minut >= 20 OR v_zi >= 300 THEN
    INSERT INTO public.contracte_pdf_link_jurnal (contract_id, rezultat) VALUES (COALESCE(p_contract_id, 0), 'limita');
    RETURN jsonb_build_object('rezultat', 'limita');
  END IF;
  SELECT pdf_path INTO v_path FROM public.contracte_terti WHERE id = p_contract_id;
  IF NOT FOUND THEN
    v_rez := 'inexistent';
  ELSIF v_path IS NULL OR btrim(v_path) = '' THEN
    v_rez := 'fara_pdf';
  ELSE
    v_rez := 'permis';
  END IF;
  INSERT INTO public.contracte_pdf_link_jurnal (contract_id, rezultat) VALUES (COALESCE(p_contract_id, 0), v_rez);
  IF v_rez = 'permis' THEN
    RETURN jsonb_build_object('rezultat', v_rez, 'pdf_path', v_path);
  END IF;
  RETURN jsonb_build_object('rezultat', v_rez);
END
$f$;
REVOKE ALL ON FUNCTION public.fn_contracte_pdf_link_rezerva(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contracte_pdf_link_rezerva(bigint) TO service_role;

DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contracte_pdf_link_jurnal'::regclass)
     OR has_table_privilege('anon', 'public.contracte_pdf_link_jurnal', 'SELECT')
     OR has_table_privilege('authenticated', 'public.contracte_pdf_link_jurnal', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.contracte_pdf_link_jurnal', 'INSERT')
     OR has_function_privilege('anon', 'public.fn_contracte_pdf_link_rezerva(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_contracte_pdf_link_rezerva(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_contracte_pdf_link_rezerva(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261024b: postconditie drepturi';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261024b_contracte_pdf_link_jurnal:' || txid_current() THEN
    RAISE EXCEPTION '20261024b: garda final invalida';
  END IF;
END $post$;
