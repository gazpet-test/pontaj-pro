-- REVENIRE armata, operatorul gestioneaza o singura tranzactie.
-- harness-armare: gazpet.revenire_20261129a REDARI_PV_SCHEMA_SCOASA
-- Forta: gazpet.revenire_20261129a_forta = DA, numai cu decizia Razvan.
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261129a',true) IS DISTINCT FROM 'REDARI_PV_SCHEMA_SCOASA:' || txid_current() THEN RAISE EXCEPTION '20261129a revenire: neinarmata'; END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261129a revenire: necesita postgres'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261129a%') THEN RAISE EXCEPTION '20261129a revenire: armare persistenta'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  -- Ordine identica migrarii. Fara fereastra intre verificare si eliminare.
  LOCK TABLE public.red_uat, public.red_parcele, public.red_detinatori, public.red_convocari, public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='red_procese_verbale' AND column_name IN ('lucrari','stare_teren','plan_situatie','foto_nr','constatare_mod','reverificare_la','alte_observatii','motiv_pv_b','semnat_la_sesiune','identitate_verificata'))
    OR (table_name='red_parcele' AND column_name IN ('verificare_data','verificare_de_gazpet','verificare_de_tgz','jurnal_santier_ref'))
    OR (table_name='red_detinatori' AND column_name='act_doveditor_cunoscut') OR (table_name='red_convocari' AND column_name IN ('adresa_tgz_nr','reluare')) OR (table_name='red_uat' AND column_name='responsabil_id'))) <> 18 THEN RAISE EXCEPTION '20261129a revenire: migrare incompleta'; END IF;
  IF (EXISTS (SELECT 1 FROM public.red_procese_verbale WHERE lucrari IS NOT NULL OR stare_teren IS NOT NULL OR plan_situatie IS NOT NULL OR foto_nr IS NOT NULL OR constatare_mod IS NOT NULL OR reverificare_la IS NOT NULL OR alte_observatii IS NOT NULL OR motiv_pv_b IS NOT NULL OR semnat_la_sesiune IS NOT NULL OR identitate_verificata IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.red_parcele WHERE verificare_data IS NOT NULL OR verificare_de_gazpet IS NOT NULL OR verificare_de_tgz IS NOT NULL OR jurnal_santier_ref IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.red_detinatori WHERE act_doveditor_cunoscut IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.red_convocari WHERE adresa_tgz_nr IS NOT NULL OR reluare)
    OR EXISTS (SELECT 1 FROM public.red_uat WHERE responsabil_id IS NOT NULL))
    AND current_setting('gazpet.revenire_20261129a_forta',true) IS DISTINCT FROM 'DA' THEN RAISE EXCEPTION '20261129a revenire: exista date; refuz fara forta=DA'; END IF;
  IF (SELECT md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY tablename,policyname)) FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_procese_verbale','red_parcele','red_convocari','red_detinatori','red_uat')) IS DISTINCT FROM '2d8f0021e73320ed176e889abc764c92' THEN RAISE EXCEPTION '20261129a revenire: politici schimbate'; END IF;
  -- Si valorile completate apoi sterse conteaza: nu confundam NULL curent cu lipsa utilizarii.
  IF EXISTS (SELECT 1 FROM public.red_jurnal j
    CROSS JOIN LATERAL (VALUES (j.date_vechi),(j.date_noi)) s(doc)
    CROSS JOIN LATERAL jsonb_each(coalesce(s.doc,'{}'::jsonb)) e(k,v)
    WHERE e.v <> 'null'::jsonb AND
      ((j.tabela='red_procese_verbale' AND e.k IN ('lucrari','stare_teren','plan_situatie','foto_nr','constatare_mod','reverificare_la','alte_observatii','motiv_pv_b','semnat_la_sesiune','identitate_verificata'))
      OR (j.tabela='red_parcele' AND e.k IN ('verificare_data','verificare_de_gazpet','verificare_de_tgz','jurnal_santier_ref'))
      OR (j.tabela='red_detinatori' AND e.k='act_doveditor_cunoscut')
      OR (j.tabela='red_convocari' AND (e.k='adresa_tgz_nr' OR (e.k='reluare' AND e.v='true'::jsonb)))
      OR (j.tabela='red_uat' AND e.k='responsabil_id')))
    AND current_setting('gazpet.revenire_20261129a_forta',true) IS DISTINCT FROM 'DA' THEN RAISE EXCEPTION '20261129a revenire: istoric nou; refuz fara forta=DA'; END IF;
END $pre$;

-- PostgreSQL nu poate scurta o vedere prin CREATE OR REPLACE. Fara CASCADE:
-- dependentele ulterioare refuza revenirea. Pastram owner/ACL/optiuni/comentariu.
DO $view$
DECLARE m record; a record; opt text; descr text;
BEGIN
  SELECT relowner,relacl,reloptions INTO m FROM pg_class WHERE oid='public.red_v_parcele'::regclass;
  descr := obj_description('public.red_v_parcele'::regclass,'pg_class');
  SELECT string_agg(format('%I=%L',split_part(v,'=',1),split_part(v,'=',2)),',') INTO opt FROM unnest(m.reloptions) v;
  DROP VIEW public.red_v_parcele;
  EXECUTE 'CREATE VIEW public.red_v_parcele' || CASE WHEN opt IS NULL THEN '' ELSE ' WITH ('||opt||')' END || ' AS SELECT p.id,p.proiect_id,p.uat_id,p.id_parcela,p.tronson,p.km_de_la,p.km_pana_la,p.sat,p.tarla,p.nr_cadastral,p.poz_hg,p.suprafata_temporara_mp,p.categoria_folosinta,p.articol_deviz,p.cantitate,p.observatii,p.cheie_sursa,p.sters_la,p.sters_de,p.sters_motiv,p.created_at FROM public.red_parcele p';
  -- Stergem inclusiv grant-urile implicite din default privileges ale creatorului.
  FOR a IN SELECT DISTINCT grantee FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) WHERE c.oid='public.red_v_parcele'::regclass LOOP
    EXECUTE format('REVOKE ALL ON public.red_v_parcele FROM %s',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
  END LOOP;
  FOR a IN SELECT * FROM aclexplode(coalesce(m.relacl,acldefault('r',m.relowner))) LOOP
    EXECUTE format('GRANT %s ON public.red_v_parcele TO %s%s',a.privilege_type,
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
      CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  EXECUTE format('COMMENT ON VIEW public.red_v_parcele IS %L',descr);
  EXECUTE format('ALTER VIEW public.red_v_parcele OWNER TO %I',pg_get_userbyid(m.relowner));
END $view$;
DROP INDEX public.red_convocari_reluare_uq;
ALTER TABLE public.red_procese_verbale DROP COLUMN lucrari, DROP COLUMN stare_teren, DROP COLUMN plan_situatie, DROP COLUMN foto_nr, DROP COLUMN constatare_mod, DROP COLUMN reverificare_la, DROP COLUMN alte_observatii, DROP COLUMN motiv_pv_b, DROP COLUMN semnat_la_sesiune, DROP COLUMN identitate_verificata;
ALTER TABLE public.red_parcele DROP COLUMN verificare_data, DROP COLUMN verificare_de_gazpet, DROP COLUMN verificare_de_tgz, DROP COLUMN jurnal_santier_ref;
ALTER TABLE public.red_detinatori DROP COLUMN act_doveditor_cunoscut;
ALTER TABLE public.red_convocari DROP COLUMN adresa_tgz_nr, DROP COLUMN reluare;
ALTER TABLE public.red_uat DROP COLUMN responsabil_id;
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='red_procese_verbale' AND column_name IN ('lucrari','stare_teren','plan_situatie','foto_nr','constatare_mod','reverificare_la','alte_observatii','motiv_pv_b','semnat_la_sesiune','identitate_verificata'))
    OR (table_name='red_parcele' AND column_name IN ('verificare_data','verificare_de_gazpet','verificare_de_tgz','jurnal_santier_ref'))
    OR (table_name='red_detinatori' AND column_name='act_doveditor_cunoscut') OR (table_name='red_convocari' AND column_name IN ('adresa_tgz_nr','reluare')) OR (table_name='red_uat' AND column_name='responsabil_id')))
    OR to_regclass('public.red_convocari_reluare_uq') IS NOT NULL THEN RAISE EXCEPTION '20261129a revenire: obiecte ramase'; END IF;
  IF has_column_privilege('authenticated','public.red_parcele','valoare_lei','SELECT,INSERT,UPDATE')
    OR NOT coalesce((SELECT 'security_invoker=on'=ANY(reloptions) FROM pg_class WHERE oid='public.red_v_parcele'::regclass),false) THEN RAISE EXCEPTION '20261129a revenire: vedere/valoare_lei'; END IF;
  IF (SELECT md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY tablename,policyname)) FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_procese_verbale','red_parcele','red_convocari','red_detinatori','red_uat')) IS DISTINCT FROM '2d8f0021e73320ed176e889abc764c92' THEN RAISE EXCEPTION '20261129a revenire: politici schimbate'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN DELETE FROM supabase_migrations.schema_migrations WHERE version='20261129120000'; END IF;
END $post$;
