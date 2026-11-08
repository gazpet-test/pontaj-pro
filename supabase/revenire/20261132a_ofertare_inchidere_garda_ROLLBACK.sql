-- Revenire 20261132a_ofertare_inchidere_garda (audit Ofertare 08.11.2026, PR #1027). NEAPLICATĂ; doar prin runner-ul echipei.
-- Scoate DOAR ce a creat migrarea: trigger-ul a02_ofertare_licitatii_inchidere_garda și funcția fn_ofertare_inchidere_garda().
-- Nu atinge date: migrarea n-a scris rânduri. După revenire, regula „cine închide” rămâne doar în UI (cum era înainte de migrare).
-- Ordinea la livrare: întâi UI-ul pe versiunea anterioară (dacă e cazul), apoi revenirea.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261132a_ofertare_inchidere_garda_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261132a ROLLBACK: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261132a ROLLBACK: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.ofertare_licitatii IN SHARE ROW EXCLUSIVE MODE;
  IF to_regprocedure('public.fn_ofertare_inchidere_garda()') IS NULL THEN
    RAISE EXCEPTION '20261132a ROLLBACK: functia lipseste (migrarea nu e aplicata?)';
  END IF;
  -- refuz dacă altceva a ajuns să depindă de funcție (alt trigger decât al nostru)
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgfoid = 'public.fn_ofertare_inchidere_garda()'::regprocedure
             AND (tgrelid <> 'public.ofertare_licitatii'::regclass OR tgname <> 'a02_ofertare_licitatii_inchidere_garda')) THEN
    RAISE EXCEPTION '20261132a ROLLBACK: functia e folosita si de alt trigger';
  END IF;
END $pre$;

DROP TRIGGER a02_ofertare_licitatii_inchidere_garda ON public.ofertare_licitatii;
DROP FUNCTION public.fn_ofertare_inchidere_garda();

DO $post$
BEGIN
  IF to_regprocedure('public.fn_ofertare_inchidere_garda()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND tgname = 'a02_ofertare_licitatii_inchidere_garda') THEN
    RAISE EXCEPTION '20261132a ROLLBACK: postconditie (obiectele inca exista)';
  END IF;
END $post$;
