-- ROLLBACK 20261212a_redari_fan_awb.sql — NEAPLICAT (ca și migrarea). Rulează DOAR înainte de primul AWB real.
-- L14: lock înainte de verificarea „fără date”; refuză dacă există ORICE rând FAN (un AWB generat e evidență de cost și dovadă de expediere),
-- un lot marcat (test / real) sau setări schimbate față de cele implicite. Dacă există date: NU se rulează; se oprește doar generarea
-- (funcția edge ștearsă / TRANSPORT_REAL_ACTIV = false), tabelele rămân.
-- Testat local pe PGlite (scripts/pglite/test_redari_fan_awb_local.mjs: aplicare → revenire → re-aplicare; refuz cu date / lot marcat /
-- setări schimbate). De testat și pe clonă înainte de apply.

BEGIN;

DO $pre$ BEGIN
  IF to_regclass('public.red_fan_awb') IS NULL OR to_regclass('public.red_fan_loturi') IS NULL OR to_regclass('public.red_fan_setari') IS NULL THEN
    RAISE EXCEPTION 'rollback 20261212a: tabelele FAN nu există (nimic de revenit)'; END IF;
END $pre$;

LOCK TABLE public.red_fan_awb, public.red_fan_loturi, public.red_fan_setari IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $date$ BEGIN
  IF EXISTS (SELECT 1 FROM public.red_fan_awb) THEN
    RAISE EXCEPTION 'rollback 20261212a: red_fan_awb are rânduri — refuz (oprește doar generarea, păstrează evidența)'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_loturi) THEN
    RAISE EXCEPTION 'rollback 20261212a: există loturi marcate pentru FAN — refuz'; END IF;
  IF (SELECT count(*) FROM public.red_fan_setari) <> 1 OR EXISTS (SELECT 1 FROM public.red_fan_setari WHERE limita_lot <> 20 OR actualizat_de IS NOT NULL OR actualizat_la IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback 20261212a: setările FAN au fost schimbate — refuz'; END IF;
END $date$;

DROP FUNCTION public.fn_red_fan_anulat(uuid, text, text);
DROP FUNCTION public.fn_red_fan_confirmari(uuid, jsonb);
DROP FUNCTION public.fn_red_fan_urmarire(uuid, jsonb);
DROP FUNCTION public.fn_red_fan_ridicat(uuid, date);
DROP FUNCTION public.fn_red_fan_reconciliaza(uuid, text, numeric, numeric, text);
DROP FUNCTION public.fn_red_fan_rezultate(uuid, jsonb);
DROP FUNCTION public.fn_red_fan_claim_lot(uuid, uuid[], text[]);
DROP FUNCTION public.fn_red_fan_aproba(uuid, uuid[], text[]);
DROP FUNCTION public.fn_red_fan_propune(uuid, text, numeric);
DROP FUNCTION public.fn_red_fan_lot_marcheaza(uuid, boolean);
DROP FUNCTION public.fn_red_fan_setari_seteaza(integer);
DROP FUNCTION public.fn_red_fan_suma(numeric);
DROP FUNCTION public.fn_red_fan_e_owner();
DROP TABLE public.red_fan_awb;
DROP TABLE public.red_fan_loturi;
DROP TABLE public.red_fan_setari;

DO $post$ BEGIN
  IF to_regclass('public.red_fan_awb') IS NOT NULL OR to_regclass('public.red_fan_loturi') IS NOT NULL OR to_regclass('public.red_fan_setari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_red\_fan\_%') THEN
    RAISE EXCEPTION 'rollback 20261212a: obiecte rămase';
  END IF;
END $post$;

COMMIT;
