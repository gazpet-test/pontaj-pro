-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261024b — contracte-pdf-link: jurnal + limită de cereri (varianta A, decizia Răzvan 12.10.2026) — r2 după Copilot NO-GO
-- Obiecte NOI: tabelul public.contracte_pdf_link_jurnal (RLS pornit, fără politici, fără drepturi pentru anon/authenticated),
-- funcțiile public.fn_contracte_pdf_link_rezerva(bigint) și public.fn_contracte_pdf_link_final(bigint, text)
-- (SECURITY DEFINER, EXECUTE doar service_role) — folosite DOAR de edge-ul contracte-pdf-link. Nu atinge date existente.
-- Limita: 20/minut și 300/24h, numără TOATE cererile autorizate care au intrat în procesare (orice rezultat în afară de 'limita'),
-- deci nici ID-uri inexistente sau fără PDF nu pot fi încercate nelimitat (Copilot P1-1).
-- Cererile respinse de limită NU se numără și NU cresc jurnalul fiecare: se scrie cel mult un rând 'limita' la 10 minute
-- (Copilot P1-2: fără lockout care se auto-prelungește și fără creștere nelimitată a jurnalului sub abuz).
-- 'rezervat' devine 'emis' / 'cale_invalida' / 'eroare_semnare' după ce edge-ul a încercat efectiv să semneze (Copilot P1-3).
-- Secvența identity e închisă explicit pentru anon/authenticated (Copilot P1-4).
-- r3: jurnalul e append-only și pentru service_role (fără UPDATE/DELETE/TRUNCATE direct), finalul doar prin RPC (Copilot P2-3).
-- Jurnalul NU conține URL-uri semnate, secrete sau antete — doar contract_id, rezultat, moment.
-- Secretul CONTRACTE_PDF_LINK_SECRET NU e creat aici: îl creează Răzvan în Vault (64 hex), îl pune pe serverul AI.
-- Revenire: supabase/revenire/20261024b_contracte_pdf_link_jurnal_ROLLBACK.sql (șterge tabelul și funcțiile — jurnalul se pierde).
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
     OR to_regprocedure('public.fn_contracte_pdf_link_rezerva(bigint)') IS NOT NULL
     OR to_regprocedure('public.fn_contracte_pdf_link_final(bigint,text)') IS NOT NULL THEN
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
  rezultat    text NOT NULL CHECK (rezultat IN ('rezervat', 'emis', 'cale_invalida', 'eroare_semnare', 'inexistent', 'fara_pdf', 'limita'))
);
COMMENT ON TABLE public.contracte_pdf_link_jurnal IS 'Jurnal + limita pentru edge contracte-pdf-link (12.10.2026). Doar service_role. Fara URL-uri/secrete.';
CREATE INDEX contracte_pdf_link_jurnal_la_idx ON public.contracte_pdf_link_jurnal (la DESC);
ALTER TABLE public.contracte_pdf_link_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contracte_pdf_link_jurnal FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.contracte_pdf_link_jurnal TO service_role;
DO $seq$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', pg_get_serial_sequence('public.contracte_pdf_link_jurnal', 'id'));
END $seq$;

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
  v_id     bigint;
BEGIN
  -- serializează numărătoarea cu inserarea (altfel două cereri simultane pot depăși limita)
  PERFORM pg_advisory_xact_lock(hashtext('contracte_pdf_link'));
  -- limita numără TOATE cererile autorizate intrate în procesare, indiferent de rezultat, în afară de 'limita' propriu-zisă
  SELECT count(*) INTO v_minut FROM public.contracte_pdf_link_jurnal WHERE la > now() - interval '1 minute' AND rezultat <> 'limita';
  SELECT count(*) INTO v_zi    FROM public.contracte_pdf_link_jurnal WHERE la > now() - interval '24 hours' AND rezultat <> 'limita';
  IF v_minut >= 20 OR v_zi >= 300 THEN
    -- un singur rând 'limita' la 10 minute, ca jurnalul să rămână mărginit sub abuz
    IF NOT EXISTS (SELECT 1 FROM public.contracte_pdf_link_jurnal WHERE rezultat = 'limita' AND la > now() - interval '10 minutes') THEN
      INSERT INTO public.contracte_pdf_link_jurnal (contract_id, rezultat) VALUES (COALESCE(p_contract_id, 0), 'limita');
    END IF;
    RETURN jsonb_build_object('rezultat', 'limita');
  END IF;
  SELECT pdf_path INTO v_path FROM public.contracte_terti WHERE id = p_contract_id;
  IF NOT FOUND THEN
    v_rez := 'inexistent';
  ELSIF v_path IS NULL OR btrim(v_path) = '' THEN
    v_rez := 'fara_pdf';
  ELSE
    v_rez := 'rezervat';
  END IF;
  INSERT INTO public.contracte_pdf_link_jurnal (contract_id, rezultat) VALUES (COALESCE(p_contract_id, 0), v_rez) RETURNING id INTO v_id;
  IF v_rez = 'rezervat' THEN
    RETURN jsonb_build_object('rezultat', 'permis', 'pdf_path', v_path, 'jurnal_id', v_id);
  END IF;
  RETURN jsonb_build_object('rezultat', v_rez);
END
$f$;
REVOKE ALL ON FUNCTION public.fn_contracte_pdf_link_rezerva(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contracte_pdf_link_rezerva(bigint) TO service_role;

-- după ce edge-ul a încercat să semneze: 'rezervat' → 'emis' / 'cale_invalida' / 'eroare_semnare' (doar rânduri proaspete, doar din 'rezervat')
CREATE FUNCTION public.fn_contracte_pdf_link_final(p_jurnal_id bigint, p_rezultat text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE v_n integer;
BEGIN
  IF p_rezultat IS NULL OR p_rezultat NOT IN ('emis', 'cale_invalida', 'eroare_semnare') THEN RETURN false; END IF;
  UPDATE public.contracte_pdf_link_jurnal SET rezultat = p_rezultat
   WHERE id = p_jurnal_id AND rezultat = 'rezervat' AND la > now() - interval '2 minutes';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$f$;
REVOKE ALL ON FUNCTION public.fn_contracte_pdf_link_final(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_contracte_pdf_link_final(bigint, text) TO service_role;
-- Copilot P2-3 (r3): jurnal append-only și pentru service_role (drepturile implicite Supabase îi dau ALL pe tabelele noi);
-- rezultatul final se schimbă DOAR prin fn_contracte_pdf_link_final (SECURITY DEFINER, rulează ca owner).
REVOKE UPDATE, DELETE, TRUNCATE ON public.contracte_pdf_link_jurnal FROM service_role;

DO $post$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contracte_pdf_link_jurnal'::regclass)
     OR has_table_privilege('anon', 'public.contracte_pdf_link_jurnal', 'SELECT')
     OR has_table_privilege('authenticated', 'public.contracte_pdf_link_jurnal', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.contracte_pdf_link_jurnal', 'INSERT')
     OR has_table_privilege('service_role', 'public.contracte_pdf_link_jurnal', 'UPDATE')
     OR has_table_privilege('service_role', 'public.contracte_pdf_link_jurnal', 'DELETE')
     OR has_any_column_privilege('service_role', 'public.contracte_pdf_link_jurnal', 'UPDATE')
     OR has_function_privilege('anon', 'public.fn_contracte_pdf_link_rezerva(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_contracte_pdf_link_rezerva(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_contracte_pdf_link_rezerva(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_contracte_pdf_link_final(bigint,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_contracte_pdf_link_final(bigint,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_contracte_pdf_link_final(bigint,text)', 'EXECUTE')
     OR has_sequence_privilege('anon', pg_get_serial_sequence('public.contracte_pdf_link_jurnal', 'id'), 'USAGE')
     OR has_sequence_privilege('authenticated', pg_get_serial_sequence('public.contracte_pdf_link_jurnal', 'id'), 'USAGE') THEN
    RAISE EXCEPTION '20261024b: postconditie drepturi';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261024b_contracte_pdf_link_jurnal:' || txid_current() THEN
    RAISE EXCEPTION '20261024b: garda final invalida';
  END IF;
END $post$;
