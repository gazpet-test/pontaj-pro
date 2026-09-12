-- 12.09.2026 — inchiderea ferestrei de rotire x-radar-secret.
-- Verificat inainte: cele 10 comenzi pg_cron trimit toate valoarea NOUA (0 pe cea veche),
-- 0 functii din baza trimit headerul, 0 intrari in app_secrets, iar sursa DEPLOYATA a celor
-- 14 functii edge care il folosesc verifica prin acest RPC (auditul din 12.09).
-- Pas reversibil: valoarea veche ramane in Vault inca o zi, dar NU mai e acceptata.
-- Daca ceva pica pe 401 se revine adaugand la loc 'RADAR_SECRET_VECHI' in lista, fara pierdere de date.
CREATE OR REPLACE FUNCTION public.fn_verifica_radar_secret(p_secret text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'RADAR_SECRET'
      AND length(coalesce(p_secret,'')) = length(s.decrypted_secret)
      AND p_secret = s.decrypted_secret
  );
$function$;
