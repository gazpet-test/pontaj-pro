-- Rollback nedistructiv: păstrează dispozitivul și istoricul colectat.
BEGIN;
-- TODO-CLAUDE: restaurează corpul ORIGINAL iot_cron_tick, salvat înaintea aplicării,
-- eliminând exclusiv apelul iot_verifica_terra adăugat de această migrare.
CREATE OR REPLACE FUNCTION public.iot_verifica_terra()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN 0;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.iot_verifica_terra() FROM PUBLIC, anon, authenticated;
-- Oprește separat cron-ul de pe Terra / edge function conform README; fără DELETE de date.
COMMIT;
