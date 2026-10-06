-- ════════════════════════════════════════════════════════════════════════════
-- 20261016a_sec_f3_cron_ingest_vault_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- OPREȘTE cele 6 joburi de mail programat (active := false). Nu le readuce la INGEST_SECRET în clar: valoarea nu e și
-- nu va fi în repo. Se folosește doar dacă edge-urile noi (poarta cron/owner) trebuie retrase — o nouă livrare repornește
-- joburile. Cât sunt oprite: fără reminder rapoarte zilnice, fără runda de consumabile, fără reminder probleme parc,
-- fără alerta UPA.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261016a', 'OPRESTE_JOBURI_SEC_F3:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261016a', true) IS DISTINCT FROM 'OPRESTE_JOBURI_SEC_F3:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261016a: nearmată (gazpet.revenire_20261016a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261016a=%') THEN
    RAISE EXCEPTION 'Revenire 20261016a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  -- doar pe starea lăsată de 20261016a: cele 6 joburi există și citesc din Vault
  IF (SELECT count(*) FROM cron.job
        WHERE jobname IN ('reminder-rapoarte-zilnice', 'necesar-deschidere', 'necesar-reminder', 'necesar-inchidere',
                          'probleme-parc-reminder', 'upa-plafon-alerta')
          AND command ~ 'x-intern-secret.*INTERN_EDGE_SECRET' AND command !~ 'x-ingest-secret' AND command !~ 'eyJ') <> 6 THEN
    RAISE EXCEPTION 'Revenire 20261016a: joburile nu sunt în starea lăsată de 20261016a — refuz';
  END IF;
END $arm$;

DO $opreste$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job
           WHERE jobname IN ('reminder-rapoarte-zilnice', 'necesar-deschidere', 'necesar-reminder', 'necesar-inchidere',
                             'probleme-parc-reminder', 'upa-plafon-alerta') LOOP
    PERFORM cron.alter_job(job_id := r.jobid, active := false);
  END LOOP;
  IF EXISTS (SELECT 1 FROM cron.job WHERE active AND jobname IN ('reminder-rapoarte-zilnice', 'necesar-deschidere', 'necesar-reminder',
                                                                 'necesar-inchidere', 'probleme-parc-reminder', 'upa-plafon-alerta')) THEN
    RAISE EXCEPTION 'Revenire 20261016a: un job a rămas activ';
  END IF;
  RAISE NOTICE 'Revenire 20261016a: cele 6 joburi de mail programat sunt OPRITE';
END $opreste$;
