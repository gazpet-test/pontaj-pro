-- Revenire 20261122a — scoate trigger-ul + funcția; nicio dată nu se atinge. Armare: gazpet.revenire_20261122a = 'INV_SCOATE:<txid>'.
DO $revenire$
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.revenire_20261122a',true)
 IS DISTINCT FROM 'INV_SCOATE:'||txid_current() THEN RAISE EXCEPTION 'INV revenire nearmata'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.logistica_active'::regclass AND tgname='trg_active_nr_inventar')
 THEN RAISE EXCEPTION 'INV trigger lipseste'; END IF;
END $revenire$;
DROP TRIGGER trg_active_nr_inventar ON public.logistica_active;
DROP FUNCTION public.fn_active_nr_inventar_obligatoriu();
DROP FUNCTION public.fn_nr_inventar_norm(text);
DO $post$
BEGIN
 IF to_regprocedure('public.fn_active_nr_inventar_obligatoriu()') IS NOT NULL OR to_regprocedure('public.fn_nr_inventar_norm(text)') IS NOT NULL THEN RAISE EXCEPTION 'INV postconditie revenire'; END IF;
END $post$;
