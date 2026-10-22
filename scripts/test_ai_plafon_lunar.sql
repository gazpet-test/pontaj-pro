-- Test local Postgres 16, după 20261105a, ca postgres; nu se rulează pe producție.
-- Nu necesită date de proiect/angajat. Totul se anulează la final.
BEGIN;
DO $test$
DECLARE
  k text := 'test_ai_plafon:' || txid_current();
  uid uuid := '00000000-0000-0000-0000-000000000001';
  r1 bigint; r2 bigint; r3 bigint;
  v public.ai_plafon_lunar%ROWTYPE;
BEGIN
  IF has_function_privilege('anon', 'public.fn_ai_plafon_rezerva(text,numeric,numeric,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.fn_ai_plafon_rezerva(text,numeric,numeric,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.fn_ai_plafon_deconteaza(bigint,numeric)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.fn_ai_plafon_deconteaza(bigint,numeric)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.fn_ai_plafon_rezerva(text,numeric,numeric,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL funcții greșit';
  END IF;
  r1 := public.fn_ai_plafon_rezerva(k, 0.05, 0.10, uid);
  r2 := public.fn_ai_plafon_rezerva(k, 0.05, 999, uid); -- plafonul existent nu se suprascrie
  BEGIN
    PERFORM public.fn_ai_plafon_rezerva(k, 0.000001, 999, uid);
    RAISE EXCEPTION 'A acceptat depășirea plafonului' USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'plafon_depasit' THEN RAISE; END IF;
  END;
  PERFORM public.fn_ai_plafon_deconteaza(r1, 0.02);
  PERFORM public.fn_ai_plafon_deconteaza(r1, 0.09); -- idempotent, nu recalculează
  PERFORM public.fn_ai_plafon_deconteaza(r2, NULL); -- cost necunoscut => consum integral
  SELECT * INTO STRICT v FROM public.ai_plafon_lunar WHERE cheie = k;
  IF v.plafon_usd <> 0.10 OR v.rezervat_usd <> 0 OR v.consumat_usd <> 0.07 THEN
    RAISE EXCEPTION 'Sold greșit după decontare/idempotent: %', row_to_json(v);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_plafon_rezervari WHERE id = r2 AND stare = 'pastrat' AND cost_real IS NULL) THEN
    RAISE EXCEPTION 'Lipsește starea pastrat';
  END IF;
  r3 := public.fn_ai_plafon_rezerva(k, 0.03, 999, uid); -- exact la limită
  PERFORM public.fn_ai_plafon_deconteaza(r3, 0);
  BEGIN
    PERFORM public.fn_ai_plafon_rezerva(k, 'NaN'::numeric, 10, uid);
    RAISE EXCEPTION 'NaN acceptat' USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.fn_ai_plafon_deconteaza(9223372036854775807, 0);
    RAISE EXCEPTION 'Rezervare inexistentă acceptată' USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END $test$;
ROLLBACK;
-- Concurența trebuie verificată separat cu două conexiuni: A rezervă 0.05 într-o tranzacție
-- necomisă pentru un plafon 0.05; B rezervă aceeași cheie și așteaptă; după COMMIT A, B
-- trebuie să primească P0001/plafon_depasit. FOR UPDATE + ON CONFLICT serializează această cale.
