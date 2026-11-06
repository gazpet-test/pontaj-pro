-- ROLLBACK 20261131e_redari_fan_awb.sql — NEAPLICAT (ca și migrarea). Rulează DOAR înainte de primul AWB real.
-- L14: lock înainte de verificarea „fără date”; refuză dacă există ORICE rând (un AWB generat e evidență de cost și dovadă de expediere).
-- Dacă există AWB-uri: NU se rulează; se oprește doar generarea (funcția edge ștearsă / TRANSPORT_REAL_ACTIV = false), tabelul rămâne.
-- Testat: NU (fără acces la BD). De testat pe clonă: apply → rollback → re-apply.

BEGIN;

DO $pre$ BEGIN
  IF to_regclass('public.red_fan_awb') IS NULL THEN RAISE EXCEPTION 'rollback 20261131e: red_fan_awb nu există (nimic de revenit)'; END IF;
END $pre$;

LOCK TABLE public.red_fan_awb IN ACCESS EXCLUSIVE MODE;

DO $date$ BEGIN
  IF EXISTS (SELECT 1 FROM public.red_fan_awb) THEN
    RAISE EXCEPTION 'rollback 20261131e: red_fan_awb are rânduri — refuz (oprește doar generarea, păstrează evidența)';
  END IF;
END $date$;

DROP FUNCTION public.fn_red_fan_ridicat(uuid, date);
DROP FUNCTION public.fn_red_fan_reconciliaza(uuid, text, numeric, numeric, text);
DROP FUNCTION public.fn_red_fan_rezultat(uuid, uuid, text, text, numeric, numeric, text);
DROP FUNCTION public.fn_red_fan_claim(uuid, text);
DROP FUNCTION public.fn_red_fan_aproba(uuid, uuid[], text[]);
DROP FUNCTION public.fn_red_fan_propune(uuid, text, numeric);
DROP FUNCTION public.fn_red_fan_e_owner();
DROP TABLE public.red_fan_awb;

DO $post$ BEGIN
  IF to_regclass('public.red_fan_awb') IS NOT NULL OR to_regprocedure('public.fn_red_fan_aproba(uuid, uuid[], text[])') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 20261131e: obiecte rămase';
  END IF;
END $post$;

COMMIT;
