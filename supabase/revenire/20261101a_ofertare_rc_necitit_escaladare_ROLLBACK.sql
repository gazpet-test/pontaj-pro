-- REVENIRE 20261101a — scoate escaladarea „RC necitit”: funcțiile ofertare_alerta_rc_necitit() și ofertare_alerta_rc_mail_elibereaza().
-- Notificările deja trimise și amprentele (fel 'rc_necitit' / 'rc_necitit_mail') rămân neatinse (sunt istoric).
-- ÎNTÂI se oprește cron-ul ofertare_rc_necitit_0530 (altfel edge fn-ul ar apela o funcție inexistentă la următoarea rulare — erorile
-- de business se întorc, nu se aruncă, deci nu strică nimic, dar zgomotul din jurnal e inutil). DOAR la cererea lui Răzvan.
-- Armare per tranzacție:
--   SELECT set_config('gazpet.revenire_20261101a', 'SCOATE_RC_NECITIT:' || txid_current(), true);
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261101a', true) IS DISTINCT FROM 'SCOATE_RC_NECITIT:' || txid_current() THEN
    RAISE EXCEPTION '20261101a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261101a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.ofertare_alerta_rc_necitit()') IS NULL
     OR to_regprocedure('public.ofertare_alerta_rc_mail_elibereaza(bigint,text)') IS NULL THEN
    RAISE EXCEPTION '20261101a: preconditie, migrarea nu e aplicata';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ofertare_rc_necitit_0530' AND active) THEN
    RAISE EXCEPTION '20261101a: cron-ul ofertare_rc_necitit_0530 e activ - opreste-l intai (cron.unschedule)';
  END IF;
END $pre$;

DROP FUNCTION public.ofertare_alerta_rc_mail_elibereaza(bigint, text);
DROP FUNCTION public.ofertare_alerta_rc_necitit();

DO $post$
BEGIN
  IF to_regprocedure('public.ofertare_alerta_rc_necitit()') IS NOT NULL
     OR to_regprocedure('public.ofertare_alerta_rc_mail_elibereaza(bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION '20261101a: postconditie, functiile inca exista';
  END IF;
  PERFORM set_config('gazpet.revenire_20261101a', '', true);
END $post$;
