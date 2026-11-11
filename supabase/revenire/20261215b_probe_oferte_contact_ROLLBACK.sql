-- Revenire 20261215b_probe_oferte_contact. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate coloanele client_contact_nume / _telefon / _email de pe probe_oferte și CHECK-urile lor. REFUZĂ dacă vreo ofertă are date
-- de contact completate (nu se pierd de aici: întâi export + golire aprobată separat). Aplicația merge și fără ele (câmpuri dezactivate).
-- Gestionarul tranzacției e operatorul. Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261215b', 'SCOATE_CONTACT_PROBE:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261215b SCOATE_CONTACT_PROBE
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261215b', true) IS DISTINCT FROM 'SCOATE_CONTACT_PROBE:' || txid_current() THEN
    RAISE EXCEPTION '20261215b revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261215b=%') THEN
    RAISE EXCEPTION '20261215b revenire: armare persistenta refuzata';
  END IF;
  IF to_regclass('public.probe_oferte') IS NULL
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.probe_oferte'::regclass AND NOT attisdropped AND format_type(atttypid, atttypmod) = 'text'
          AND attname IN ('client_contact_nume', 'client_contact_telefon', 'client_contact_email')) <> 3
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.probe_oferte'::regclass
          AND conname IN ('probe_oferte_contact_nume_ck', 'probe_oferte_contact_telefon_ck', 'probe_oferte_contact_email_ck')) <> 3 THEN
    RAISE EXCEPTION '20261215b revenire: starea nu e cea din 20261215b (coloanele / CHECK-urile lipsesc)';
  END IF;
  -- L14: lock înaintea verificării „fără date”; ocupat = refuz imediat (55P03), nimic scris
  LOCK TABLE public.probe_oferte IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM public.probe_oferte
              WHERE client_contact_nume IS NOT NULL OR client_contact_telefon IS NOT NULL OR client_contact_email IS NOT NULL) THEN
    RAISE EXCEPTION '20261215b revenire: exista oferte cu date de contact completate (export + golire aprobata, apoi revenirea)';
  END IF;
  ALTER TABLE public.probe_oferte
    DROP CONSTRAINT probe_oferte_contact_nume_ck, DROP CONSTRAINT probe_oferte_contact_telefon_ck, DROP CONSTRAINT probe_oferte_contact_email_ck,
    DROP COLUMN client_contact_nume, DROP COLUMN client_contact_telefon, DROP COLUMN client_contact_email;   -- fără CASCADE
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.probe_oferte'::regclass AND NOT attisdropped
              AND attname IN ('client_contact_nume', 'client_contact_telefon', 'client_contact_email'))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.probe_oferte'::regclass AND conname LIKE 'probe_oferte_contact\_%') THEN
    RAISE EXCEPTION '20261215b revenire: starea finala difera (coloanele / CHECK-urile inca exista)';
  END IF;
  PERFORM set_config('gazpet.revenire_20261215b', '', true);   -- dezarmare
END $revenire$;
