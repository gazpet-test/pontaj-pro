-- Catalogul sub-modulului „Registru DCC” (cheia executie_dcc, copil al lui executie). NU e migrare și NU acordă niciun drept: doar face cheia
-- ACORDABILĂ din administrare (user_module_access.module are cheie străină spre app_modules). NERULAT.
-- Se rulează DOAR de coordonator, cu „da”-ul proprietarului, DUPĂ aplicarea migrării 20270108a_executie_dcc_registru:
--   psql -X -w -v ON_ERROR_STOP=1 -h <H> -p <P> -U postgres -d postgres -f scripts/executie_dcc_modul_catalog.sql
-- O tranzacție: preflight (coloanele app_modules verificate în catalog cu tipurile lor; părintele executie există; cheia nu există; migrarea e
-- aplicată), apoi UN INSERT cu RETURNING și verificarea rândului. Revenirea: scripts/executie_dcc_modul_catalog_revenire.sql.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $preflight$
DECLARE r record; v_tip text;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('key', '^(text|character varying.*)$'), ('parent_key', '^(text|character varying.*)$'), ('name', '^(text|character varying.*)$'),
      ('icon', '^(text|character varying.*)$'), ('description', '^(text|character varying.*)$'), ('is_active', '^boolean$'), ('show_on_homepage', '^boolean$')) v(c, tip) LOOP
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_tip FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = to_regclass('public.app_modules') AND a.attname = r.c AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION 'catalog executie_dcc: coloana app_modules.% lipseste sau are alt tip (%)', r.c, coalesce(v_tip, 'lipsa');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'executie' AND is_active) THEN
    RAISE EXCEPTION 'catalog executie_dcc: modulul parinte executie lipseste sau e inactiv';
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'executie_dcc') THEN
    RAISE EXCEPTION 'catalog executie_dcc: cheia exista deja (nimic de facut)';
  END IF;
  IF to_regprocedure('public.fn_dcc_drept(bigint, text)') IS NULL OR to_regclass('public.dcc_documente') IS NULL THEN
    RAISE EXCEPTION 'catalog executie_dcc: migrarea 20270108a nu e aplicata (cheia fara registru n-ar avea sens)';
  END IF;
END $preflight$;
INSERT INTO public.app_modules (key, parent_key, name, icon, description, is_active, show_on_homepage)
VALUES ('executie_dcc', 'executie', 'Registru DCC', '✉️',
        'Execuție → registrul corespondenței cu DCC-ul beneficiarului: alocarea codurilor, reviziile, „copiat” / „confirm că am trimis”. Nivelurile: viewer (citire), editor (alocare, revizii, copiat, confirmat), admin (inițializarea seriilor, anularea, importul istoric). Restricția pe proiect din Execuție se aplică și aici.',
        true, false)
RETURNING key, parent_key, name, is_active, show_on_homepage;
DO $verificare$
BEGIN
  IF (SELECT count(*) FROM public.app_modules WHERE key = 'executie_dcc' AND parent_key = 'executie' AND is_active AND NOT show_on_homepage) <> 1 THEN
    RAISE EXCEPTION 'catalog executie_dcc: randul inserat nu are forma asteptata';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'executie_dcc') THEN
    RAISE EXCEPTION 'catalog executie_dcc: exista deja drepturi pe executie_dcc (scriptul nu acorda nimic; drepturile = decizie separata)';
  END IF;
END $verificare$;
COMMIT;
