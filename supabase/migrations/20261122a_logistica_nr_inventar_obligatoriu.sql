-- 20261122a — Logistică: nr. inventar (registrul imobilizărilor) obligatoriu la activ NOU (decizie Răzvan 28.10.2026: 1A toate tipurile, 2A formular + trigger).
-- Activele existente fără număr rămân editabile; numărul, odată pus, nu se mai poate goli (doar corecta). Runner: run_mig.sh (--single-transaction).
DO $migrare$
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.livrare_migrare',true)
 IS DISTINCT FROM '20261122a_logistica_nr_inventar_obligatoriu:'||txid_current() THEN RAISE EXCEPTION 'INV numai runner postgres'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 IF to_regprocedure('public.fn_active_nr_inventar_obligatoriu()') IS NOT NULL OR to_regprocedure('public.fn_nr_inventar_norm(text)') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.logistica_active'::regclass AND tgname='trg_active_nr_inventar')
 THEN RAISE EXCEPTION 'INV deja exista'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.logistica_active'::regclass AND attname='nr_inventar' AND NOT attisdropped)
 THEN RAISE EXCEPTION 'INV coloana nr_inventar lipseste'; END IF;
END $migrare$;

-- Aceeași definiție a „necompletat” ca String.prototype.trim() din UI (review Jakarinos #904 r1–r3): clasă EXPLICITĂ, fără \s
-- ([[:space:]] depinde de collation — pe ICU ia și U+0085/U+001C–1F, pe care trim() le păstrează): TAB..CR, spațiu + Unicode
-- (NBSP U+00A0, U+1680, U+2000–U+200A, U+2028/2029, U+202F, U+205F, U+3000, BOM U+FEFF). Întoarce NULL dacă rămâne gol.
CREATE FUNCTION public.fn_nr_inventar_norm(p text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = public, pg_temp AS $fn$
  SELECT nullif(regexp_replace(p, '^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$', '', 'g'), '')
$fn$;
REVOKE EXECUTE ON FUNCTION public.fn_nr_inventar_norm(text) FROM PUBLIC;

CREATE FUNCTION public.fn_active_nr_inventar_obligatoriu() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.nr_inventar := public.fn_nr_inventar_norm(NEW.nr_inventar);
  IF TG_OP = 'INSERT' AND NEW.nr_inventar IS NULL THEN
    RAISE EXCEPTION 'Nr. inventar (registrul imobilizărilor) este obligatoriu la activ nou' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND public.fn_nr_inventar_norm(OLD.nr_inventar) IS NOT NULL AND NEW.nr_inventar IS NULL THEN
    RAISE EXCEPTION 'Nr. inventar nu se poate șterge, doar corecta' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_active_nr_inventar_obligatoriu() FROM PUBLIC;
COMMENT ON FUNCTION public.fn_active_nr_inventar_obligatoriu() IS '20261122a: activ nou doar cu nr. inventar; numărul existent nu se golește (Răzvan 28.10.2026)';

CREATE TRIGGER trg_active_nr_inventar BEFORE INSERT OR UPDATE OF nr_inventar ON public.logistica_active
FOR EACH ROW EXECUTE FUNCTION public.fn_active_nr_inventar_obligatoriu();

DO $post$
BEGIN
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.logistica_active'::regclass AND tgname='trg_active_nr_inventar' AND tgenabled='O') <> 1
 THEN RAISE EXCEPTION 'INV postconditie trigger'; END IF;
 -- datele existente nu se ating
 IF EXISTS (SELECT 1 FROM public.logistica_active WHERE nr_inventar IS NOT NULL AND nr_inventar IS DISTINCT FROM public.fn_nr_inventar_norm(nr_inventar))
 THEN RAISE EXCEPTION 'INV date cu spatii la capete (de curatat separat, cu da)'; END IF;
END $post$;
