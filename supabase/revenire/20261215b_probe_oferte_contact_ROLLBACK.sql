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
  -- r2 (L15): amprenta EXACTĂ a ce scoatem = ce a creat 20261215b: trei coloane text nullable, fără valoare implicită, fără drepturi
  -- proprii, cele trei CHECK-uri cu definiția exactă și nimic altceva legat de coloane. Altă formă = refuz (de analizat).
  IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.probe_oferte'::regclass AND NOT a.attisdropped
       AND a.attname IN ('client_contact_nume', 'client_contact_telefon', 'client_contact_email')
       AND format_type(a.atttypid, a.atttypmod) = 'text' AND NOT a.attnotnull AND NOT a.atthasdef AND a.attacl IS NULL
       AND a.attgenerated = '' AND a.attidentity = '') <> 3
     OR (SELECT string_agg(c.conname || '=' || c.contype::text || '=' || pg_get_constraintdef(c.oid), '; ' ORDER BY c.conname COLLATE "C")
           FROM pg_constraint c WHERE c.conrelid = 'public.probe_oferte'::regclass
            AND (c.conname LIKE 'probe_oferte_contact\_%'
                 OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.probe_oferte'::regclass AND a.attnum = ANY (c.conkey)
                             AND a.attname IN ('client_contact_nume', 'client_contact_telefon', 'client_contact_email'))))
        IS DISTINCT FROM 'probe_oferte_contact_email_ck=c=CHECK (((client_contact_email IS NULL) OR (length(client_contact_email) <= 160))); '
                      || 'probe_oferte_contact_nume_ck=c=CHECK (((client_contact_nume IS NULL) OR (length(client_contact_nume) <= 120))); '
                      || 'probe_oferte_contact_telefon_ck=c=CHECK (((client_contact_telefon IS NULL) OR (length(client_contact_telefon) <= 40)))'
     OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
                 WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.probe_oferte'::regclass
                   AND a.attname IN ('client_contact_nume', 'client_contact_telefon', 'client_contact_email')
                   AND NOT (d.classid = 'pg_constraint'::regclass
                            AND d.objid IN (SELECT c.oid FROM pg_constraint c WHERE c.conrelid = 'public.probe_oferte'::regclass
                                             AND c.conname IN ('probe_oferte_contact_nume_ck', 'probe_oferte_contact_telefon_ck', 'probe_oferte_contact_email_ck')))) THEN
    RAISE EXCEPTION '20261215b revenire: coloanele de contact / CHECK-urile lor difera de ce a creat 20261215b (drepturi proprii, alta definitie sau obiecte legate)';
  END IF;
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
