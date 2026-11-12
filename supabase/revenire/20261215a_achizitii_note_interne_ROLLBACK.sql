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
