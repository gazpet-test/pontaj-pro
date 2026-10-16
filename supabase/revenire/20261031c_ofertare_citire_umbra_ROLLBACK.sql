-- Revenire 20261031c — sterge tabelul de umbra al cititorului 3. Refuza daca exista randuri promovate (au efect in productie prin CAS:
-- revenirea lor se face intai pe protocolul de text, nu aici). Rulare ca postgres, prin psql, cu da-ul lui Razvan.
DO $rb$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261031c rollback: necesita postgres'; END IF;
  IF to_regclass('public.ofertare_citire_umbra') IS NULL THEN RAISE EXCEPTION '20261031c rollback: tabelul nu exista'; END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_citire_umbra WHERE stare = 'promovat') THEN
    RAISE EXCEPTION '20261031c rollback: exista randuri promovate - revenirea lor intai pe protocolul de text (CAS)';
  END IF;
END $rb$;
DROP TABLE public.ofertare_citire_umbra;
