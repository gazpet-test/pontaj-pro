-- REVENIRE 20261023b — readuce cele 6 politici de diurne la expresiile dinainte (insert/update: owner OR salarii; delete: owner).
-- Armare per tranzacție: SELECT set_config('gazpet.revenire_20261023b', 'DIURNE_SCRIERE_REVENIRE:' || txid_current(), true);
DO $revenire$
DECLARE
  c_sal  CONSTANT text := '(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true)))))';
  c_own  CONSTANT text := '(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_owner = true))))';
  c_nou  CONSTANT text := '(EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.is_owner = true) OR (profiles.can_access_salarii = true) OR (profiles.can_access_diurne = true)))))';
  r record; v_q text; v_w text;
BEGIN
  IF current_setting('gazpet.revenire_20261023b', true)
       IS DISTINCT FROM 'DIURNE_SCRIERE_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261023b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261023b=%') THEN
    RAISE EXCEPTION '20261023b: armare persistenta interzisa';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261023b: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF (SELECT count(*) FROM pg_policy WHERE polrelid IN ('public.diurna_payments'::regclass, 'public.diurna_payment_details'::regclass)) <> 8 THEN
    RAISE EXCEPTION '20261023b: numar politici neasteptat';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('diurna_payments', 'diurna_payments_insert_salarii', 'a'),
      ('diurna_payments', 'diurna_payments_update_salarii', 'w'),
      ('diurna_payments', 'diurna_payments_delete_owner', 'd'),
      ('diurna_payment_details', 'diurna_payment_details_insert_salarii', 'a'),
      ('diurna_payment_details', 'diurna_payment_details_update_salarii', 'w'),
      ('diurna_payment_details', 'diurna_payment_details_delete_owner', 'd')) AS x(tab, pol, cmd) LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO v_q, v_w
      FROM pg_policy p WHERE p.polrelid = ('public.' || r.tab)::regclass AND p.polname = r.pol AND p.polcmd = r.cmd::"char"
        AND p.polpermissive AND p.polroles = ARRAY[0]::oid[];
    IF NOT FOUND
       OR (r.cmd = 'a' AND (v_q IS NOT NULL OR v_w IS DISTINCT FROM c_nou))
       OR (r.cmd = 'w' AND (v_q IS DISTINCT FROM c_nou OR v_w IS DISTINCT FROM c_nou))
       OR (r.cmd = 'd' AND (v_q IS DISTINCT FROM c_nou OR v_w IS NOT NULL)) THEN
      RAISE EXCEPTION '20261023b: preconditie politica %.%', r.tab, r.pol;
    END IF;
    IF r.cmd = 'a' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK %s', r.pol, r.tab, c_sal);
    ELSIF r.cmd = 'w' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING %s WITH CHECK %s', r.pol, r.tab, c_sal, c_sal);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING %s', r.pol, r.tab, c_own);
    END IF;
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO v_q, v_w
      FROM pg_policy p WHERE p.polrelid = ('public.' || r.tab)::regclass AND p.polname = r.pol;
    IF (r.cmd = 'a' AND (v_q IS NOT NULL OR v_w IS DISTINCT FROM c_sal))
       OR (r.cmd = 'w' AND (v_q IS DISTINCT FROM c_sal OR v_w IS DISTINCT FROM c_sal))
       OR (r.cmd = 'd' AND (v_q IS DISTINCT FROM c_own OR v_w IS NOT NULL)) THEN
      RAISE EXCEPTION '20261023b: postconditie politica %.%', r.tab, r.pol;
    END IF;
  END LOOP;
  IF current_setting('gazpet.revenire_20261023b', true)
       IS DISTINCT FROM 'DIURNE_SCRIERE_REVENIRE:' || txid_current() THEN
    RAISE EXCEPTION '20261023b: garda final invalida';
  END IF;
END $revenire$;
