-- Revenire 20261215a_achizitii_note_interne. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate coloana comenzi_furnizor.note_interne și CHECK-ul ei. REFUZĂ dacă vreo comandă are o notiță scrisă (notițele nu se pierd
-- de aici: întâi export + golire aprobată separat). Aplicația merge și fără coloană (câmpul revine la „disponibil după actualizare”).
-- Gestionarul tranzacției e operatorul. Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261215a', 'SCOATE_NOTE_INTERNE:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261215a SCOATE_NOTE_INTERNE
DO $revenire$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261215a', true) IS DISTINCT FROM 'SCOATE_NOTE_INTERNE:' || txid_current() THEN
    RAISE EXCEPTION '20261215a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261215a=%') THEN
    RAISE EXCEPTION '20261215a revenire: armare persistenta refuzata';
  END IF;
  IF to_regclass('public.comenzi_furnizor') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.comenzi_furnizor'::regclass AND attname = 'note_interne' AND NOT attisdropped
                     AND format_type(atttypid, atttypmod) = 'text')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.comenzi_furnizor'::regclass AND conname = 'comenzi_furnizor_note_interne_lung_ck') THEN
    RAISE EXCEPTION '20261215a revenire: starea nu e cea din 20261215a (coloana / CHECK-ul lipsesc)';
  END IF;
  -- L14: lock înaintea verificării „fără date”; ocupat = refuz imediat (55P03), nimic scris
  LOCK TABLE public.comenzi_furnizor IN ACCESS EXCLUSIVE MODE NOWAIT;
  -- r2 (L15): amprenta EXACTĂ a ce scoatem = ce a creat 20261215a: coloana text nullable, fără valoare implicită, fără drepturi proprii,
  -- CHECK-ul cu definiția exactă și nimic altceva legat de coloană (politică, vedere, index, alt CHECK). Altă formă = refuz (de analizat).
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor'::regclass AND a.attname = 'note_interne' AND NOT a.attisdropped
                  AND format_type(a.atttypid, a.atttypmod) = 'text' AND NOT a.attnotnull AND NOT a.atthasdef AND a.attacl IS NULL
                  AND a.attgenerated = '' AND a.attidentity = '')
     OR (SELECT string_agg(c.conname || '=' || c.contype::text || '=' || pg_get_constraintdef(c.oid), '; ' ORDER BY c.conname COLLATE "C")
           FROM pg_constraint c WHERE c.conrelid = 'public.comenzi_furnizor'::regclass
            AND (c.conname = 'comenzi_furnizor_note_interne_lung_ck'
                 OR (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor'::regclass AND a.attname = 'note_interne') = ANY (c.conkey)))
        IS DISTINCT FROM 'comenzi_furnizor_note_interne_lung_ck=c=CHECK (((note_interne IS NULL) OR (length(note_interne) <= 4000)))'
     OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.comenzi_furnizor'::regclass
                 AND d.refobjsubid = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor'::regclass AND a.attname = 'note_interne')
                 AND NOT (d.classid = 'pg_constraint'::regclass
                          AND d.objid = (SELECT c.oid FROM pg_constraint c WHERE c.conrelid = 'public.comenzi_furnizor'::regclass
                                          AND c.conname = 'comenzi_furnizor_note_interne_lung_ck'))) THEN
    RAISE EXCEPTION '20261215a revenire: note_interne / CHECK-ul ei difera de ce a creat 20261215a (drepturi proprii, alta definitie sau obiecte legate)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.comenzi_furnizor WHERE note_interne IS NOT NULL) THEN
    RAISE EXCEPTION '20261215a revenire: exista comenzi cu notite interne scrise (export + golire aprobata, apoi revenirea)';
  END IF;
  ALTER TABLE public.comenzi_furnizor DROP CONSTRAINT comenzi_furnizor_note_interne_lung_ck;
  ALTER TABLE public.comenzi_furnizor DROP COLUMN note_interne;   -- fără CASCADE: o vedere care ar depinde de coloană = refuz
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.comenzi_furnizor'::regclass AND attname = 'note_interne' AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.comenzi_furnizor'::regclass AND conname = 'comenzi_furnizor_note_interne_lung_ck') THEN
    RAISE EXCEPTION '20261215a revenire: starea finala difera (coloana / CHECK-ul inca exista)';
  END IF;
  PERFORM set_config('gazpet.revenire_20261215a', '', true);   -- dezarmare
END $revenire$;
