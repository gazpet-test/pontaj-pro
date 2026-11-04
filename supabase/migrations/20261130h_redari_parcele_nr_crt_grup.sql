-- Version 20261130127000. Runner supplies one transaction.
-- 20261130h_redari_parcele_nr_crt_grup — Redări: grupul Nr.Crt. cu subnumăr al parcelei, ca dovadă în BD la reimportul TGZ (PR #981 r4).
-- Context: decizia lui Răzvan 04.11.2026 — „166.1” e PARCELĂ SEPARATĂ de 166. BD nu păstra Nr.Crt., deci la reimport nu se putea dovedi dacă o
-- parcelă existentă cu aceeași cheie_sursa e „166” sau „166.1” (review r2/r3: asociere tacită 166 <-> 166.1; marcajul în observatii era text liber).
-- Ce face: coloana red_parcele.nr_crt_grup (text, NULL):
--   • NULL = grup fără subnumăr (orice „x”, „x/y”) — TOATE parcelele existente (importate cu regula veche, care respingea „x.y/z” și citea „x.y” ca x/y;
--     verificat read-only 04.11.2026: niciun import n-a creat vreodată un grup „x.y”);
--   • 'x.y' (ex. '166.1') = grupul cu subnumăr din TGZ, pus DOAR la INSERT de import (CHECK de formă: fără zero în față, fără „0”, max 9+9 cifre).
--   • IMUTABILĂ: trigger BEFORE UPDATE refuză orice schimbare (inclusiv NULL -> valoare și valoare -> NULL) în afara mentenanței
--     (sesiune SQL directă ca postgres, fără claims JWT — același tipar ca 20261129h / 20261130e).
--   • Privilegii pe coloană (red_parcele are privilegii PE COLOANĂ pentru authenticated, ex. valoare_lei fără niciun drept): authenticated primește
--     doar SELECT + INSERT pe nr_crt_grup (FĂRĂ UPDATE); anon nimic; service_role are deja drepturi la nivel de tabel (triggerul îl oprește la UPDATE).
--   • Politicile și jurnalul NU se ating (fn_red_jurnal înregistrează coloana nouă ca pe oricare alta).
-- Ordinea față de 20261130g (PR #982, NEAPLICATĂ): independente. 30g schimbă doar politicile (ALTER POLICY) și indexuri FK, nu triggere / coloane;
-- 30h nu atinge politicile. Preflight-ul 30h numără triggerele relativ (n + 1), DRY-ul 30g proiectează coloanele cu SELECT dinamic în ambele faze.
-- Codul (src/redari/importTgz.js) cere coloana: se livrează DUPĂ aplicarea acestei migrări.
-- Revenire: supabase/revenire/20261130h_redari_parcele_nr_crt_grup_ROLLBACK.sql (valorile nenule merg în redari_retras_<data>, apoi DROP COLUMN).
-- DRY: supabase/tests/20261130h_redari_parcele_nr_crt_grup_dryrun.sql.
DO $pre$
DECLARE v_trg integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130h_redari_parcele_nr_crt_grup:' || txid_current() THEN
    RAISE EXCEPTION '20261130h: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_parcele') IS NULL OR to_regprocedure('public.fn_red_nivel()') IS NULL OR to_regprocedure('public.fn_red_jurnal()') IS NULL THEN
    RAISE EXCEPTION '20261130h: lipseste schema Redari (red_parcele / fn_red_nivel / fn_red_jurnal)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name = 'nr_crt_grup') THEN
    RAISE EXCEPTION '20261130h: coloana nr_crt_grup exista deja';
  END IF;
  IF to_regprocedure('public.fn_red_parcele_nr_crt_grup_imutabil()') IS NOT NULL THEN RAISE EXCEPTION '20261130h: functia exista deja'; END IF;
  -- authenticated trebuie sa aiba drepturi DOAR pe coloane (altfel un drept la nivel de tabel ar acoperi automat coloana noua)
  IF has_table_privilege('authenticated', 'public.red_parcele', 'SELECT') OR has_table_privilege('authenticated', 'public.red_parcele', 'INSERT')
     OR has_table_privilege('authenticated', 'public.red_parcele', 'UPDATE') OR has_table_privilege('anon', 'public.red_parcele', 'SELECT')
     OR has_column_privilege('authenticated', 'public.red_parcele', 'valoare_lei', 'SELECT') THEN
    RAISE EXCEPTION '20261130h: privilegiile pe red_parcele nu mai sunt pe coloane (cum le-a lasat 20261126a)';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.red_parcele', 'observatii', 'UPDATE') THEN
    RAISE EXCEPTION '20261130h: authenticated nu mai are UPDATE pe observatii (stare neasteptata)';
  END IF;
  SELECT count(*) INTO v_trg FROM pg_trigger WHERE tgrelid = 'public.red_parcele'::regclass AND NOT tgisinternal;
  PERFORM set_config('gazpet.m30h_triggere', v_trg::text, true);
END $pre$;

ALTER TABLE public.red_parcele ADD COLUMN nr_crt_grup text NULL
  CONSTRAINT red_parcele_nr_crt_grup_forma CHECK (nr_crt_grup IS NULL OR (length(nr_crt_grup) <= 19 AND nr_crt_grup ~ '^[1-9][0-9]{0,8}[.][1-9][0-9]{0,8}$'));
COMMENT ON COLUMN public.red_parcele.nr_crt_grup IS 'Grupul Nr.Crt. cu subnumăr din TGZ (ex. 166.1 = parcelă separată de 166, decizia Răzvan 04.11.2026). NULL = grup fără subnumăr (toate parcelele importate înainte de 20261130h). '
  'Pus doar la INSERT de import; imutabil (trg_red_parcele_nr_crt_grup). La reimport, o parcelă existentă se refolosește doar dacă grupul din fișier e EXACT acesta (NULL = fără subnumăr).';

-- BEFORE UPDATE: nr_crt_grup nu se schimba, pentru nimeni in afara mentenantei. SECURITY DEFINER + search_path fix (ca restul functiilor red_*).
CREATE FUNCTION public.fn_red_parcele_nr_crt_grup_imutabil() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.nr_crt_grup IS NOT DISTINCT FROM OLD.nr_crt_grup THEN RETURN NEW; END IF;
  -- mentenanta = sesiune SQL directa ca postgres (session_user nu se schimba in SECURITY DEFINER; PostgREST are session_user „authenticator”) si FARA claims JWT
  IF session_user = 'postgres' AND coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = '' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'redari: grupul Nr.Crt. al parcelei (%) e imutabil; se stabileste doar la import', OLD.id_parcela USING ERRCODE = '23514';
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_parcele_nr_crt_grup_imutabil() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_red_parcele_nr_crt_grup BEFORE UPDATE ON public.red_parcele FOR EACH ROW EXECUTE FUNCTION public.fn_red_parcele_nr_crt_grup_imutabil();

REVOKE ALL (nr_crt_grup) ON public.red_parcele FROM PUBLIC, anon, authenticated;
GRANT SELECT (nr_crt_grup), INSERT (nr_crt_grup) ON public.red_parcele TO authenticated;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name = 'nr_crt_grup'
                  AND data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION '20261130h: coloana lipseste sau are alta forma';
  END IF;
  IF (SELECT count(*) FROM public.red_parcele WHERE nr_crt_grup IS NOT NULL) <> 0 THEN RAISE EXCEPTION '20261130h: parcelele existente trebuie sa ramana NULL'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_parcele'::regclass AND conname = 'red_parcele_nr_crt_grup_forma' AND contype = 'c' AND convalidated) THEN
    RAISE EXCEPTION '20261130h: CHECK-ul de forma lipseste';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_parcele'::regclass AND NOT tgisinternal) <> current_setting('gazpet.m30h_triggere')::integer + 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_parcele'::regclass AND t.tgname = 'trg_red_parcele_nr_crt_grup' AND t.tgenabled = 'O'
                     AND t.tgfoid = 'public.fn_red_parcele_nr_crt_grup_imutabil()'::regprocedure) THEN
    RAISE EXCEPTION '20261130h: triggere';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_parcele_nr_crt_grup_imutabil()'::regprocedure AND prosecdef AND 'search_path=public, pg_temp' = ANY(proconfig))
     OR has_function_privilege('authenticated', 'public.fn_red_parcele_nr_crt_grup_imutabil()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_red_parcele_nr_crt_grup_imutabil()', 'EXECUTE') THEN
    RAISE EXCEPTION '20261130h: functia are setari gresite';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.red_parcele', 'nr_crt_grup', 'SELECT') OR NOT has_column_privilege('authenticated', 'public.red_parcele', 'nr_crt_grup', 'INSERT')
     OR has_column_privilege('authenticated', 'public.red_parcele', 'nr_crt_grup', 'UPDATE') OR has_column_privilege('anon', 'public.red_parcele', 'nr_crt_grup', 'SELECT')
     OR has_column_privilege('anon', 'public.red_parcele', 'nr_crt_grup', 'INSERT') OR has_column_privilege('anon', 'public.red_parcele', 'nr_crt_grup', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.red_parcele', 'UPDATE') OR has_column_privilege('authenticated', 'public.red_parcele', 'valoare_lei', 'SELECT') THEN
    RAISE EXCEPTION '20261130h: privilegii gresite pe nr_crt_grup';
  END IF;
END $post$;
