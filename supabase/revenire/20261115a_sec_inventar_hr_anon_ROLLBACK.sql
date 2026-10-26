-- Revenire 20261115a: politicile și granturile EXACT ca înainte (citite pe prod 26.10.2026).
-- Atenție: redeschide expunerile. Se rulează doar cu „da”, într-o singură tranzacție, armată cu
-- SELECT set_config('gazpet.revenire_20261115a', 'SEC_20261115A_SCOATE:' || txid_current(), true);

DO $pre$
BEGIN
  IF current_user <> 'postgres' OR current_setting('gazpet.revenire_20261115a', true)
     IS DISTINCT FROM 'SEC_20261115A_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION '20261115a revenire: nearmată';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'READ COMMITTED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  -- revenim doar de la starea pusă de 20261115a (politicile noi verifică user_module_access)
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.magazie_inventar_angajat'::regclass
      AND coalesce(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) ~ 'user_module_access') <> 4 THEN
    RAISE EXCEPTION '20261115a revenire: politicile nu sunt cele puse de 20261115a';
  END IF;
END
$pre$;

DROP POLICY mia_select ON public.magazie_inventar_angajat;
DROP POLICY mia_insert ON public.magazie_inventar_angajat;
DROP POLICY mia_update ON public.magazie_inventar_angajat;
DROP POLICY mia_delete ON public.magazie_inventar_angajat;

CREATE POLICY mia_select ON public.magazie_inventar_angajat FOR SELECT TO authenticated USING (true);
CREATE POLICY mia_insert ON public.magazie_inventar_angajat FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY mia_update ON public.magazie_inventar_angajat FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY mia_delete ON public.magazie_inventar_angajat FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON public.hr_aprobatori, public.hr_cereri_concediu, public.hr_concediu_rute, public.magazie_inventar_angajat
  TO anon;

DO $post$
BEGIN
  IF (SELECT md5(string_agg(polname::text || '|' || polcmd::text || '|' || polpermissive::text || '|'
          || polroles::regrole[]::text || '|' || coalesce(pg_get_expr(polqual, polrelid), '') || '|'
          || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ';' ORDER BY polname))
      FROM pg_policy WHERE polrelid = 'public.magazie_inventar_angajat'::regclass)
     IS DISTINCT FROM '668a7e226edbe58202b35858ef0f2b96' THEN
    RAISE EXCEPTION '20261115a revenire: politicile restaurate nu au amprenta de dinainte';
  END IF;
END
$post$;
