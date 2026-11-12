-- Version 20261215120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261215a_achizitii_note_interne — TKT-2026-0361: notițe interne pe comanda către furnizor (discuții la telefon cu furnizorul,
--   data trimiterii cererii etc.), care NU apar pe cererea de ofertă, pe comandă, pe PV-uri sau în mailuri.
-- Cererea de ofertă (PDF) se generează din același rând comenzi_furnizor, deci o singură coloană acoperă ambele.
-- Ce face: ADD COLUMN note_interne text, nullable, fără valoare implicită (nu rescrie tabelul), cu o limită de 4000 de caractere
--   (CHECK cu nume explicit, diferit de cel automat de coloană; pe un tabel cu coloana nouă NULL verificarea e instantanee).
-- Ce NU face: nicio dată, nicio politică, niciun drept nou: coloana moștenește drepturile de tabel existente (aceleași conturi care
--   scriu azi comanda o pot scrie). Generatoarele de documente din Achizitii.jsx citesc câmpuri numite explicit, deci coloana nu
--   ajunge în PDF-uri (testul src/achizitiiNoteInterne.test.js).
-- Compatibilitate: aplicația merge și înainte de migrare (câmpul apare dezactivat), și după.
-- Revenire: supabase/revenire/20261215a_achizitii_note_interne_ROLLBACK.sql (refuză dacă există notițe scrise).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261215a_achizitii_note_interne:' || txid_current() THEN
    RAISE EXCEPTION '20261215a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261215a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.comenzi_furnizor') IS NULL THEN
    RAISE EXCEPTION '20261215a: tabelul public.comenzi_furnizor lipseste';
  END IF;
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.comenzi_furnizor'::regclass AND attname = 'note_interne' AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.comenzi_furnizor'::regclass AND conname = 'comenzi_furnizor_note_interne_lung_ck') THEN
    RAISE EXCEPTION '20261215a: note_interne exista deja (reaplicare)';
  END IF;
  -- tabelul e cel cunoscut (coloanele pe care le folosește aplicația lângă notiță: CAS pe updated_at, observațiile publice)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comenzi_furnizor' AND column_name = 'updated_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comenzi_furnizor' AND column_name = 'observatii' AND data_type = 'text') THEN
    RAISE EXCEPTION '20261215a: comenzi_furnizor nu are coloanele asteptate (updated_at, observatii text)';
  END IF;
  -- starea de azi a drepturilor: authenticated citește și modifică tabelul (altfel coloana nouă n-ar fi utilizabilă din aplicație)
  IF NOT has_table_privilege('authenticated', 'public.comenzi_furnizor', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.comenzi_furnizor', 'UPDATE') THEN
    RAISE EXCEPTION '20261215a: authenticated nu are SELECT / UPDATE pe comenzi_furnizor (drepturi diferite de cele asteptate)';
  END IF;
END $pre$;

ALTER TABLE public.comenzi_furnizor
  ADD COLUMN note_interne text,
  ADD CONSTRAINT comenzi_furnizor_note_interne_lung_ck CHECK (note_interne IS NULL OR length(note_interne) <= 4000);
COMMENT ON COLUMN public.comenzi_furnizor.note_interne IS
  'Notițe interne (doar pentru colegi): NU intră în PDF-ul comenzii, al cererii de ofertă, în PV-uri sau în mailuri. TKT-2026-0361, 20261215a.';

DO $post$
DECLARE v record;
BEGIN
  SELECT a.attnotnull, a.atthasdef, format_type(a.atttypid, a.atttypmod) AS tip INTO v
    FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor'::regclass AND a.attname = 'note_interne' AND NOT a.attisdropped;
  IF NOT FOUND OR v.tip IS DISTINCT FROM 'text' OR v.attnotnull OR v.atthasdef THEN
    RAISE EXCEPTION '20261215a: note_interne nu e text nullable fara valoare implicita';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.comenzi_furnizor'::regclass AND conname = 'comenzi_furnizor_note_interne_lung_ck'
                  AND contype = 'c' AND convalidated) THEN
    RAISE EXCEPTION '20261215a: CHECK-ul de lungime lipseste';
  END IF;
  -- drepturile pe coloană, verificate pe rând (has_column_privilege cu 'A,B' = oricare)
  IF NOT has_column_privilege('authenticated', 'public.comenzi_furnizor', 'note_interne', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.comenzi_furnizor', 'note_interne', 'UPDATE') THEN
    RAISE EXCEPTION '20261215a: authenticated nu poate citi / modifica note_interne';
  END IF;
  IF EXISTS (SELECT 1 FROM public.comenzi_furnizor WHERE note_interne IS NOT NULL) THEN
    RAISE EXCEPTION '20261215a: note_interne are valori dupa migrare (nu trebuia scris nimic)';
  END IF;
END $post$;
