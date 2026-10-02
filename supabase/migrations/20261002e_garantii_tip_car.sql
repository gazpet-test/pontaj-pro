-- ════════════════════════════════════════════════════════════════════════════
-- 20261002e_garantii_tip_car — DRAFT, NEAPLICAT (decizia 11 din RAPORT_0210 → A; claude_context #1519).
-- Tip NOU de garanție „car” (asigurarea lucrărilor de construcții-montaj — Contractor’s All Risks) în public.garantii,
--   pentru generatorul „Cere ofertă poliță” din Financiar → Registru garanții (GarantiiCerereOferta.jsx).
-- Ce face (2 lucruri, nimic altceva):
--   1. garantii_tip_check: CHECK (tip IN buna_executie, participare, mentenanta, avans) → + 'car'. Aceleași 4 valori vechi,
--      aceeași ordine, una nouă la coadă. Nicio coloană nouă/schimbată (md5-ul coloanelor rămâne 0cd06900… — 20261006b neatins).
--   2. public.fn_garantii_tipuri() → text[]: lista valorilor permise, citită din constrângerea reală (pg_get_constraintdef),
--      ca UI-ul să arate CAR doar dacă BD-ul îl permite. STABLE, SECURITY DEFINER (pg_constraint e citibil oricum; SECDEF doar
--      pentru search_path fix), fără argumente, fără set_config / EXECUTE dinamic (gate 0e). EXECUTE: authenticated, service_role.
-- Neatins: v_garantii_situatie, garantii_adresa_eliberare (nu ramifică pe tip), RLS-ul din 20261005b, ACL-urile pe coloane din
--   20261006b, v_gbe_per_contract / v_contracte_cu_linii (citesc contracte_terti, nu garantii.tip).
-- Precondiții (fail-closed): postgres; constrângerea garantii_tip_check există, e validată și are EXACT definiția live
--   (md5 d58b24ca0f78c4c4aa2a739412524371, citită read-only 02.10.2026); niciun rând cu tip = 'car'; fn_garantii_tipuri nu există.
-- Postcondiții: constrângerea nouă validată, cu cele 5 valori; funcția întoarce exact cele 5 valori; ACL-urile funcției.
-- Revenire (NU e migrare): supabase/revenire/20261002e_garantii_tip_car_ROLLBACK.sql (refuză dacă există rânduri 'car').
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT. Gate 0e = 0.
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002e_garantii_tip_car:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002e: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
DECLARE v_n integer; v_s text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user; END IF;
  -- 0b. constrângerea live, exact
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conrelid = 'public.garantii'::regclass AND conname = 'garantii_tip_check' AND contype = 'c';
  IF v_n <> 1 THEN RAISE EXCEPTION 'Precondiție 0b: garantii_tip_check lipsește sau e dublată (%)', v_n; END IF;
  SELECT md5(pg_get_constraintdef(oid)) INTO v_s FROM pg_constraint WHERE conrelid = 'public.garantii'::regclass AND conname = 'garantii_tip_check';
  IF v_s IS DISTINCT FROM 'd58b24ca0f78c4c4aa2a739412524371'
     OR NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.garantii'::regclass AND conname = 'garantii_tip_check') THEN
    RAISE EXCEPTION 'Precondiție 0b: garantii_tip_check ≠ definiția live din 02.10 (md5 % ≠ d58b24ca…) sau nevalidată — se reanalizează', v_s;
  END IF;
  -- 0c. nu există deja rânduri cu tipul nou (ar însemna că constrângerea a fost ocolită)
  SELECT count(*) INTO v_n FROM public.garantii WHERE tip = 'car';
  IF v_n <> 0 THEN RAISE EXCEPTION 'Precondiție 0c: % rânduri au deja tip = car', v_n; END IF;
  -- 0d. funcția nouă nu există (reaplicare = refuz)
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_garantii_tipuri') THEN
    RAISE EXCEPTION 'Precondiție 0d: fn_garantii_tipuri există deja — reaplicare sau coliziune de nume';
  END IF;
END $pre$;

-- 1. constrângerea: aceleași valori + 'car'
ALTER TABLE public.garantii DROP CONSTRAINT garantii_tip_check;
ALTER TABLE public.garantii ADD CONSTRAINT garantii_tip_check
  CHECK (tip = ANY (ARRAY['buna_executie'::text, 'participare'::text, 'mentenanta'::text, 'avans'::text, 'car'::text]));

-- 2. tipurile permise, citite din constrângerea reală (UI-ul arată CAR doar dacă e aici)
CREATE FUNCTION public.fn_garantii_tipuri()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(array_agg(m[1] ORDER BY o), ARRAY[]::text[])
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') WITH ORDINALITY AS r(m, o)
   WHERE c.conrelid = 'public.garantii'::regclass AND c.conname = 'garantii_tip_check';
$fn$;
REVOKE ALL ON FUNCTION public.fn_garantii_tipuri() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_garantii_tipuri() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_garantii_tipuri() IS 'Valorile permise pentru garantii.tip, din garantii_tip_check (20261002e); UI-ul condiționează tipul CAR de prezența lui aici';

DO $post$
DECLARE v_t text[]; v_n integer;
BEGIN
  IF NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.garantii'::regclass AND conname = 'garantii_tip_check') THEN
    RAISE EXCEPTION 'Postcondiție 1: garantii_tip_check nevalidată';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conrelid = 'public.garantii'::regclass AND conname = 'garantii_tip_check';
  IF v_n <> 1 THEN RAISE EXCEPTION 'Postcondiție 1: garantii_tip_check de % ori', v_n; END IF;
  v_t := public.fn_garantii_tipuri();
  IF v_t IS DISTINCT FROM ARRAY['buna_executie', 'participare', 'mentenanta', 'avans', 'car']::text[] THEN
    RAISE EXCEPTION 'Postcondiție 2: fn_garantii_tipuri() = % (așteptat cele 4 valori vechi + car)', v_t;
  END IF;
  IF has_function_privilege('anon', 'public.fn_garantii_tipuri()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_garantii_tipuri()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_garantii_tipuri()', 'EXECUTE')
     OR NOT (SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.fn_garantii_tipuri()'::regprocedure) THEN
    RAISE EXCEPTION 'Postcondiție 3: fn_garantii_tipuri — ACL (fără anon, cu authenticated/service_role) sau atribute (SECDEF, STABLE, search_path)';
  END IF;
  -- coloanele garantii neatinse (20261006b se bazează pe amprenta lor)
  IF (SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attnum > 0 AND NOT attisdropped)
     IS DISTINCT FROM '0cd06900cf48a7501cc00a57f9a24264' THEN
    RAISE EXCEPTION 'Postcondiție 4: coloanele garantii s-au schimbat (nu era în plan)';
  END IF;
  RAISE NOTICE '20261002e după: garantii_tip_check md5 %', (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid = 'public.garantii'::regclass AND conname = 'garantii_tip_check');
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002e_garantii_tip_car:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002e: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
