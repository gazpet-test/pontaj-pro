-- Version 20261215130000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261215b_probe_oferte_contact — TKT-2026-0374: pe oferta de probe de presiune, persoana de contact la beneficiar (nume, telefon,
--   e-mail). Azi oferta are doar denumirea firmei (probe_oferte.client).
-- Ce face: 3 coloane text nullable, fără valoare implicită (nu rescriu tabelul), cu plafon de lungime (CHECK cu nume explicite,
--   diferite de cele automate de coloană). Validarea formatului (telefon / mail) e doar avertisment în ecran, nu în BD.
-- Ce NU face: nicio dată, nicio politică, niciun drept nou: coloanele moștenesc drepturile și politicile de rând de azi
--   (probe_oferte_rls_*, 20261004b: doar cine are acces la Ofertare). Date personale ale unui terț: apar doar în oferta respectivă.
-- Compatibilitate: aplicația merge și înainte de migrare (câmpurile apar dezactivate, salvarea ofertei trimite câmpurile de azi).
-- Revenire: supabase/revenire/20261215b_probe_oferte_contact_ROLLBACK.sql (refuză dacă vreo ofertă are date de contact).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261215b_probe_oferte_contact:' || txid_current() THEN
    RAISE EXCEPTION '20261215b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261215b: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.probe_oferte') IS NULL THEN
    RAISE EXCEPTION '20261215b: tabelul public.probe_oferte lipseste';
  END IF;
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.probe_oferte'::regclass AND NOT attisdropped
              AND attname IN ('client_contact_nume', 'client_contact_telefon', 'client_contact_email'))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.probe_oferte'::regclass AND conname LIKE 'probe_oferte_contact\_%') THEN
    RAISE EXCEPTION '20261215b: coloanele de contact exista deja (reaplicare)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'probe_oferte' AND column_name = 'client' AND data_type = 'text') THEN
    RAISE EXCEPTION '20261215b: probe_oferte nu are coloana client text (tabel diferit de cel asteptat)';
  END IF;
  -- starea de azi (20261004b): RLS pornit, authenticated citește / adaugă / modifică (prin politici), anon fără drepturi
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.probe_oferte'::regclass)
     OR NOT has_table_privilege('authenticated', 'public.probe_oferte', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.probe_oferte', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.probe_oferte', 'UPDATE')
     OR has_table_privilege('anon', 'public.probe_oferte', 'SELECT') THEN
    RAISE EXCEPTION '20261215b: RLS / drepturile pe probe_oferte difera de cele asteptate (20261004b)';
  END IF;
END $pre$;

ALTER TABLE public.probe_oferte
  ADD COLUMN client_contact_nume text,
  ADD COLUMN client_contact_telefon text,
  ADD COLUMN client_contact_email text,
  ADD CONSTRAINT probe_oferte_contact_nume_ck CHECK (client_contact_nume IS NULL OR length(client_contact_nume) <= 120),
  ADD CONSTRAINT probe_oferte_contact_telefon_ck CHECK (client_contact_telefon IS NULL OR length(client_contact_telefon) <= 40),
  ADD CONSTRAINT probe_oferte_contact_email_ck CHECK (client_contact_email IS NULL OR length(client_contact_email) <= 160);
COMMENT ON COLUMN public.probe_oferte.client_contact_nume IS 'Persoana de contact la beneficiar (opțional; apare în exportul ofertei dacă e completată). TKT-2026-0374, 20261215b.';
COMMENT ON COLUMN public.probe_oferte.client_contact_telefon IS 'Telefonul persoanei de contact la beneficiar (opțional, text liber). TKT-2026-0374, 20261215b.';
COMMENT ON COLUMN public.probe_oferte.client_contact_email IS 'E-mailul persoanei de contact la beneficiar (opțional, text liber). TKT-2026-0374, 20261215b.';

DO $post$
DECLARE v_col text; v record;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['client_contact_nume', 'client_contact_telefon', 'client_contact_email'] LOOP
    SELECT a.attnotnull, a.atthasdef, format_type(a.atttypid, a.atttypmod) AS tip INTO v
      FROM pg_attribute a WHERE a.attrelid = 'public.probe_oferte'::regclass AND a.attname = v_col AND NOT a.attisdropped;
    IF NOT FOUND OR v.tip IS DISTINCT FROM 'text' OR v.attnotnull OR v.atthasdef THEN
      RAISE EXCEPTION '20261215b: % nu e text nullable fara valoare implicita', v_col;
    END IF;
    -- drepturile pe coloană, pe rând (has_column_privilege cu 'A,B' = oricare)
    IF NOT has_column_privilege('authenticated', 'public.probe_oferte', v_col, 'SELECT')
       OR NOT has_column_privilege('authenticated', 'public.probe_oferte', v_col, 'INSERT')
       OR NOT has_column_privilege('authenticated', 'public.probe_oferte', v_col, 'UPDATE')
       OR has_column_privilege('anon', 'public.probe_oferte', v_col, 'SELECT') THEN
      RAISE EXCEPTION '20261215b: drepturile pe % difera (authenticated SELECT/INSERT/UPDATE, anon fara)', v_col;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.probe_oferte'::regclass AND contype = 'c' AND convalidated
       AND conname IN ('probe_oferte_contact_nume_ck', 'probe_oferte_contact_telefon_ck', 'probe_oferte_contact_email_ck')) <> 3 THEN
    RAISE EXCEPTION '20261215b: CHECK-urile de lungime lipsesc';
  END IF;
END $post$;
