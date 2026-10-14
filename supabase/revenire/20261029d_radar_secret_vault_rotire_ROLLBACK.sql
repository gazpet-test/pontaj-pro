-- REVENIRE 20261029d — pune la loc în RADAR_SECRET valoarea dinainte de rotire (din RADAR_SECRET_VECHI) și șterge
-- RADAR_SECRET_VECHI. Cele 10 joburi cron RĂMÂN pe Vault (nu se mai scrie niciun literal în cron.job) → după revenire
-- trimit iar valoarea veche, iar edge-urile o acceptă (verifică tot în Vault). Valoarea veche e compromisă: revenirea e
-- doar pentru urgență (un apelant necunoscut cu 401), urmată de o rotire nouă.
-- DOAR la cererea explicită a lui Răzvan. Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261029d', 'RADAR_ROTIRE_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE v_id uuid; v_vechi text;
BEGIN
  IF current_setting('gazpet.revenire_20261029d', true)
       IS DISTINCT FROM 'RADAR_ROTIRE_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261029d: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261029d=%') THEN
    RAISE EXCEPTION '20261029d: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261029d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'RADAR_SECRET') <> 1
     OR (SELECT count(*) FROM vault.secrets WHERE name = 'RADAR_SECRET_VECHI') <> 1 THEN
    RAISE EXCEPTION '20261029d: preconditie Vault (RADAR_SECRET + RADAR_SECRET_VECHI)';
  END IF;
  SELECT decrypted_secret INTO v_vechi FROM vault.decrypted_secrets WHERE name = 'RADAR_SECRET_VECHI';
  IF v_vechi !~ '^gzp-[0-9a-f]{48}$' THEN RAISE EXCEPTION '20261029d: format RADAR_SECRET_VECHI'; END IF;
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'RADAR_SECRET';
  PERFORM vault.update_secret(v_id, v_vechi);
  DELETE FROM vault.secrets WHERE name = 'RADAR_SECRET_VECHI';
  IF NOT public.fn_verifica_radar_secret(v_vechi) OR NOT public.fn_radar_secret_ok(v_vechi)
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'RADAR_SECRET_VECHI')
     OR (SELECT count(*) FROM cron.job WHERE command ILIKE '%x-radar-secret%'
           AND command LIKE '%(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''RADAR_SECRET'')%') <> 10 THEN
    RAISE EXCEPTION '20261029d: postconditie revenire';
  END IF;
  IF current_setting('gazpet.revenire_20261029d', true)
       IS DISTINCT FROM 'RADAR_ROTIRE_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261029d: garda final invalida';
  END IF;
  PERFORM set_config('gazpet.revenire_20261029d', '', true);
END $revenire$;
