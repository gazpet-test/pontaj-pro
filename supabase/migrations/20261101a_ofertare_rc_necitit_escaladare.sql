-- (a) Escaladare zilnică „răspuns de la autoritate necitit” (Răzvan 19.10.2026: „da d-a-b”, varianta A).
-- De ce: RC3 Racari (lic. 15, 204 pagini, listele de cantități revizuite) a fost adus de veghea SEAP pe 14.10 și a stat 5 zile
-- neprocesat; clopoțelul „SEAP: RASPUNS…” s-a pierdut între 102 notificări SEAP în 30 de zile (1 citită).
--
-- Regula (aceeași cu bannerul de pe fișă, src/ofertareRcNecitit.js):
--   necitit = document tip 'raspuns_clarificare' cu status_procesare NU în {procesat, ignorat, partial} — deci neprocesat, in_lucru,
--   eroare, NULL sau orice stare nouă (fail-closed, review Gemini #790 r1); 'ignorat' = decizie umană; 'partial' = doar banner portocaliu
--   licitații: status ∈ {go, in_lucru} (cele la care lucrăm efectiv — „identificata” ar aduce zgomot), termen de depunere în viitor
--   ziua 0 (ziua în care a sosit): doar bannerul; ziua 1: responsabilul; ziua 2+: responsabilul + owner(ii);
--   fără responsabil: owner(ii) din ziua 1
--   o notificare pe zi și destinatar (amprenta pe zi), tip 'critical', titlul cu zilele până la depunere; se oprește singură la procesare
-- Mailul către owner (≤ 5 zile până la depunere) îl trimite edge fn ofertare-rc-necitit, din lista întoarsă de funcție.
--
-- Cron (după apply + deploy, cu „da” de la Răzvan):
--   SELECT cron.schedule('ofertare_rc_necitit_0530', '30 5 * * *', $$SELECT net.http_post(
--     url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/ofertare-rc-necitit',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'x-radar-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='RADAR_SECRET')),
--     body := '{}'::jsonb)$$);

CREATE OR REPLACE FUNCTION public.ofertare_alerta_rc_necitit()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  l record; v_pid uuid; v_amprenta text; v_veche text;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_zile_necitit int; v_zile_dep int; v_trimise int := 0; v_lic jsonb := '[]'::jsonb;
BEGIN
  FOR l IN
    SELECT li.id, li.nr_anunt, li.obiect, li.termen_depunere, li.responsabil_id,
           count(*) AS nr,
           min((d.created_at AT TIME ZONE 'Europe/Bucharest')::date) AS de_la,
           string_agg(left(coalesce(d.nume_original, '#' || d.id), 60), '; ' ORDER BY d.created_at) AS lista
    FROM ofertare_licitatii li
    JOIN ofertare_documente_atribuire d ON d.licitatie_id = li.id
    WHERE d.tip = 'raspuns_clarificare'
      AND coalesce(d.status_procesare, 'neprocesat') NOT IN ('procesat', 'ignorat', 'partial')
      AND li.status IN ('go', 'in_lucru')
      AND li.termen_depunere > now()
    GROUP BY li.id, li.nr_anunt, li.obiect, li.termen_depunere, li.responsabil_id
  LOOP
    v_zile_necitit := v_azi - l.de_la;
    v_zile_dep := (l.termen_depunere AT TIME ZONE 'Europe/Bucharest')::date - v_azi;
    CONTINUE WHEN v_zile_necitit < 1;   -- ziua sosirii: doar bannerul de pe fișă

    -- o dată pe zi pe licitație (rerularea cron-ului în aceeași zi nu dublează)
    v_amprenta := md5(l.id::text || '|rc_necitit|' || v_azi::text);
    SELECT amprenta INTO v_veche FROM ofertare_alerte_amprenta WHERE licitatie_id = l.id AND fel = 'rc_necitit';
    IF v_veche IS DISTINCT FROM v_amprenta THEN
      FOR v_pid IN
        SELECT p FROM unnest(ARRAY[l.responsabil_id]) p WHERE p IS NOT NULL
        UNION
        SELECT id FROM profiles WHERE is_owner = true AND (v_zile_necitit >= 2 OR l.responsabil_id IS NULL)
      LOOP
        INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
        VALUES (v_pid, 'critical', 'Ofertare',
          format('⚠ RC necitit — %s — %s', coalesce(l.nr_anunt, 'licitația ' || l.id),
                 CASE WHEN v_zile_dep = 0 THEN 'depunerea e AZI' WHEN v_zile_dep = 1 THEN '1 zi până la depunere'
                      ELSE v_zile_dep || ' zile până la depunere' END),
          format('Răspuns de la autoritate necitit de %s %s (din %s): %s. Deschide fișa licitației → Documentație → Procesează. Alerta se repetă zilnic până la procesare.',
                 v_zile_necitit, CASE WHEN v_zile_necitit = 1 THEN 'zi' ELSE 'zile' END, to_char(l.de_la, 'DD.MM'), l.lista),
          '/ofertare');
        v_trimise := v_trimise + 1;
      END LOOP;
      INSERT INTO ofertare_alerte_amprenta (licitatie_id, fel, amprenta, trimisa_la)
      VALUES (l.id, 'rc_necitit', v_amprenta, now())
      ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now();
    END IF;

    v_lic := v_lic || jsonb_build_object('licitatie_id', l.id, 'nr_anunt', l.nr_anunt, 'obiect', left(coalesce(l.obiect, ''), 160),
      'zile_necitit', v_zile_necitit, 'zile_depunere', v_zile_dep, 'de_la', l.de_la, 'nr', l.nr, 'lista', l.lista);
  END LOOP;
  RETURN jsonb_build_object('azi', v_azi, 'notificari', v_trimise, 'licitatii', v_lic);
END
$function$;

-- nu e UI-callable: doar cron / edge fn (service_role)
REVOKE ALL ON FUNCTION public.ofertare_alerta_rc_necitit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_alerta_rc_necitit() TO service_role;
