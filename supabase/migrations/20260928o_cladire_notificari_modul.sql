-- [Clădire] Alertele modulului nu ajungeau niciodată: iot_alerta() scria notifications.modul='cladire',
-- dar notifications_modul_check nu conținea valoarea → INSERT respins (silent, prins de EXCEPTION handlers
-- din iot_cron_tick). Fix: (1) 'Clădire' (capitalizat, ca restul modulelor) intră în CHECK; (2) iot_alerta()
-- scrie 'Clădire' în loc de 'cladire'. Verificat: 0 rânduri existente cu modul='cladire' (nimic de migrat).
BEGIN;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_modul_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_modul_check
  CHECK (modul = ANY (ARRAY['general'::text, 'Logistică'::text, 'Pontaj'::text, 'Execuție'::text,
    'Financiar'::text, 'Comercial'::text, 'Administrativ'::text, 'HR'::text, 'Tichete'::text,
    'Rapoarte'::text, 'Ședințe'::text, 'Ofertare'::text, 'Clădire'::text]));

CREATE OR REPLACE FUNCTION public.iot_alerta(p_type text, p_title text, p_message text, p_link text DEFAULT '/cladire'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n integer := 0; r record;
BEGIN
  IF EXISTS (SELECT 1 FROM notifications WHERE type = p_type AND title = p_title AND created_at > now() - interval '12 hours') THEN RETURN 0; END IF;
  FOR r IN SELECT id FROM profiles WHERE is_owner LOOP
    INSERT INTO notifications (profile_id, type, modul, title, message, link_to) VALUES (r.id, p_type, 'Clădire', p_title, p_message, p_link);
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

REVOKE EXECUTE ON FUNCTION public.iot_alerta(text, text, text, text) FROM PUBLIC, anon, authenticated;

COMMIT;
