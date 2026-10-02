-- ════════════════════════════════════════════════════════════════════════════
-- 20261002e_garantii_tip_car_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/). Readuce EXACT starea
-- live din 02.10: garantii_tip_check cu cele 4 valori (md5 d58b24ca…), fără fn_garantii_tipuri. NU e gaură de securitate,
-- dar scoate tipul „car”: REFUZĂ dacă există rânduri cu tip = 'car' (nu se șterg date de aici — decizie separată, pct. 3).
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan, după decizie + review. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261002e', 'SCOATE_TIP_CAR:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
DECLARE v_n integer;
BEGIN
  IF current_setting('gazpet.rollback_tehnic_20261002e', true) IS DISTINCT FROM 'SCOATE_TIP_CAR:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261002e: nearmată (gazpet.rollback_tehnic_20261002e legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261002e=%') THEN
    RAISE EXCEPTION 'Revenire 20261002e: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF to_regprocedure('public.fn_garantii_tipuri()') IS NULL
     OR NOT ('car' = ANY (public.fn_garantii_tipuri())) THEN
    RAISE EXCEPTION 'Revenire 20261002e: precondiție — starea nu e cea a patch-ului (fn_garantii_tipuri lipsește sau car nu e în constrângere)';
  END IF;
  SELECT count(*) INTO v_n FROM public.garantii WHERE tip = 'car';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Revenire 20261002e: % rânduri au tip = car — nu se poate restrânge constrângerea fără a decide întâi ce se face cu ele', v_n;
  END IF;
END $arm$;

DROP FUNCTION public.fn_garantii_tipuri();
ALTER TABLE public.garantii DROP CONSTRAINT garantii_tip_check;
ALTER TABLE public.garantii ADD CONSTRAINT garantii_tip_check
  CHECK (tip = ANY (ARRAY['buna_executie'::text, 'participare'::text, 'mentenanta'::text, 'avans'::text]));

DO $post$
BEGIN
  IF (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid = 'public.garantii'::regclass AND conname = 'garantii_tip_check') IS DISTINCT FROM 'd58b24ca0f78c4c4aa2a739412524371'
     OR NOT (SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.garantii'::regclass AND conname = 'garantii_tip_check')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_garantii_tipuri') THEN
    RAISE EXCEPTION 'Revenire 20261002e: postcondiție — starea nu e cea live din 02.10 (constrângere d58b24ca…, fără fn_garantii_tipuri)';
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261002e', '', true);
END $post$;
