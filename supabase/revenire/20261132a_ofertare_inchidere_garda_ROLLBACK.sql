-- Revenire 20261132a_ofertare_inchidere_garda (audit Ofertare 08.11.2026, PR #1027 / #1029 r2). NEAPLICATĂ; doar prin runner-ul echipei.
-- Scoate DOAR ce a creat migrarea: trigger-ul a02_ofertare_licitatii_inchidere_garda și funcția fn_ofertare_inchidere_garda().
-- Nu atinge date: migrarea n-a scris rânduri. După revenire, regula „cine închide” rămâne doar în UI (cum era înainte de migrare).
-- Ordinea la livrare: întâi UI-ul pe versiunea anterioară (dacă e cazul), apoi revenirea.
-- r2 (review Jakarinos 11.11, P2): înainte de DROP se verifică AMPRENTA EXACTĂ a obiectelor, nu doar existența — o altă versiune sub
-- același nume (corp schimbat, SECURITY INVOKER, alt search_path / proprietar, trigger redefinit: alt moment, alte coloane, WHEN,
-- argumente, dezactivat) = refuz, ca revenirea să nu șteargă munca unei migrări ulterioare. Valorile sunt cele ale migrării din repo:
-- md5 pe corpul funcției fără CR (testul vitest îl recalculează din migrare), tgtype 19 = BEFORE UPDATE FOR EACH ROW, UPDATE OF status.
DO $pre$
DECLARE
  c_corp_md5 CONSTANT text := '6caa19f256fba618e9b8c29cfe868104';
  f record; t record;
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
  -- funcția: exact versiunea migrării 20261132a (corp + atribute)
  SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, l.lanname, p.prorettype, p.pronargs, p.provolatile,
         p.proisstrict, p.proleakproof, md5(replace(p.prosrc, chr(13), '')) AS corp,
         (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname) AS supraincarcari
    INTO f FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_ofertare_inchidere_garda()'::regprocedure;
  IF f.corp IS DISTINCT FROM c_corp_md5 THEN
    RAISE EXCEPTION '20261132a ROLLBACK: fn_ofertare_inchidere_garda are alt corp decat versiunea 20261132a (alta versiune sub acelasi nume) - refuz';
  END IF;
  IF NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR f.owner <> 'postgres' OR f.lanname <> 'plpgsql'
     OR f.prorettype <> 'trigger'::regtype OR f.pronargs <> 0 OR f.provolatile <> 'v' OR f.proisstrict OR f.proleakproof OR f.supraincarcari <> 1 THEN
    RAISE EXCEPTION '20261132a ROLLBACK: atributele fn_ofertare_inchidere_garda difera de versiunea 20261132a - refuz';
  END IF;
  -- trigger-ul: exact cel creat de migrare
  SELECT tgenabled, tgfoid, tgtype, tgqual IS NULL AS fara_when, tgnargs, tgdeferrable, tginitdeferred, tgconstraint, tgoldtable, tgnewtable,
         (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(tgattr::int2[]) AS k(attnum)
            JOIN pg_attribute a ON a.attrelid = tgrelid AND a.attnum = k.attnum) AS coloane
    INTO t FROM pg_trigger WHERE tgrelid = 'public.ofertare_licitatii'::regclass AND tgname = 'a02_ofertare_licitatii_inchidere_garda';
  IF NOT FOUND THEN
    RAISE EXCEPTION '20261132a ROLLBACK: trigger-ul a02_ofertare_licitatii_inchidere_garda lipseste - refuz';
  END IF;
  IF t.tgenabled IS DISTINCT FROM 'O' OR t.tgfoid IS DISTINCT FROM 'public.fn_ofertare_inchidere_garda()'::regprocedure
     OR t.tgtype IS DISTINCT FROM 19::int2 OR NOT t.fara_when OR t.tgnargs <> 0 OR t.tgdeferrable OR t.tginitdeferred OR t.tgconstraint <> 0
     OR t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL OR t.coloane IS DISTINCT FROM ARRAY['status'] THEN
    RAISE EXCEPTION '20261132a ROLLBACK: trigger-ul a02_ofertare_licitatii_inchidere_garda difera de versiunea 20261132a - refuz';
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

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261132a_ofertare_inchidere_garda_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261132a ROLLBACK: garda de livrare (final) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_final$;
