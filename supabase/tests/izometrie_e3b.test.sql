-- Piesa A: contractul catalogului și mutațiile care trebuie să înroșească poarta.
-- Exclusiv scheletul local; fiecare mutație este anulată prin SAVEPOINT.
DO $test$
DECLARE r record; t text; p text;
BEGIN
  IF current_database() !~ '^[a-z0-9_]+_test$' THEN RAISE EXCEPTION 'doar *_test'; END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'poarta E3b nu este verde'; END IF;
  FOR r IN SELECT n FROM unnest(ARRAY['izo_cor_editor','izo_corectie_writer']) n LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r.n AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=r.n::regrole AND (member<>'postgres'::regrole OR inherit_option))
      OR NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=r.n::regrole AND member='postgres'::regrole AND set_option)
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.n::regrole) THEN
      RAISE EXCEPTION 'atribute/membership %',r.n;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['izo_corectii','izo_corectii_bucati','izo_documente_istoric'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'RLS %',t; END IF;
    IF NOT has_table_privilege('authenticated','public.'||t,'SELECT') THEN RAISE EXCEPTION 'citire API %',t; END IF;
    FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
      IF EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) rol(n)
        WHERE a.attrelid=('public.'||t)::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(rol.n,a.attrelid,a.attname,p)) THEN
        RAISE EXCEPTION 'API scrie % %',t,p;
      END IF;
    END LOOP;
  END LOOP;
  -- Matricea critică verificată independent de generatorul GRANT-urilor.
  FOR r IN SELECT a.attname::text AS n FROM pg_attribute a
      WHERE a.attrelid='public.magazie_bucati'::regclass AND a.attnum>0 AND NOT a.attisdropped LOOP
    IF has_column_privilege('izo_cor_editor','public.magazie_bucati',r.n,'UPDATE')
      OR has_column_privilege('izo_cor_editor','public.magazie_bucati',r.n,'INSERT') THEN RAISE EXCEPTION 'editor scrie registrul %',r.n; END IF;
    IF has_column_privilege('izo_corectie_writer','public.magazie_bucati',r.n,'UPDATE') IS DISTINCT FROM
      (r.n=ANY(ARRAY['serie','sarja','lot','lungime_aviz_mm','lungime_masurata_mm','unghi_curba','perete_mm',
       'diametru_mm','greutate_kg','dimensiune','grad_otel','standard','izolatie','lungime_mm','lungime_m',
       'lungime_originala_m','stare','depozit_id','server_ver','updated_at'])) THEN RAISE EXCEPTION 'UPDATE writer %',r.n; END IF;
    IF has_column_privilege('izo_corectie_writer','public.magazie_bucati',r.n,'INSERT') IS DISTINCT FROM
       (r.n=ANY(public.fn_izo_coloane_c()||ARRAY['id','uid','radacina_id','server_ver'])) THEN RAISE EXCEPTION 'INSERT writer %',r.n; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('izo_cor_editor','izo_corectii','inainte','INSERT',true),
    ('izo_cor_editor','izo_corectii','inainte','UPDATE',false),
    ('izo_cor_editor','izo_corectii','dupa','UPDATE',false),
    ('izo_cor_editor','izo_corectii','motiv_decizie','UPDATE',true),
    ('izo_cor_editor','izo_corectii','eveniment_id','UPDATE',false),
    ('izo_corectie_writer','izo_corectii','eveniment_id','UPDATE',true),
    ('izo_corectie_writer','izo_corectii','motiv_decizie','UPDATE',false),
    ('izo_corectie_writer','izo_corectii','dupa','UPDATE',false),
    ('izo_doc_editor','izo_documente_istoric','continut','INSERT',true),
    ('izo_doc_editor','izo_documente_istoric','id','INSERT',false),
    ('izo_doc_editor','izo_documente_istoric','continut','UPDATE',false),
    ('izo_corectie_writer','izo_documente_intrare','pv_nr','UPDATE',true),
    ('izo_corectie_writer','izo_documente_intrare','stare','UPDATE',false),
    ('izo_cor_editor','izo_documente_intrare','pv_nr','UPDATE',false)) x(rol,tabel,col,priv,asteptat) LOOP
    IF has_column_privilege(r.rol,'public.'||r.tabel,r.col,r.priv) IS DISTINCT FROM r.asteptat THEN
      RAISE EXCEPTION 'matrice % % % %',r.rol,r.tabel,r.col,r.priv;
    END IF;
  END LOOP;
  FOR r IN SELECT n FROM unnest(ARRAY['izo_cor_editor','izo_corectie_writer']) n LOOP
    FOREACH t IN ARRAY ARRAY['fn_izo_jwt_rol()','fn_izo_uid()','fn_izo_porti_lipsa()'] LOOP
      IF NOT has_function_privilege(r.n,'public.'||t,'EXECUTE') THEN RAISE EXCEPTION 'identitate tranzitivă % %',r.n,t; END IF;
    END LOOP;
    IF has_function_privilege(r.n,'public.fn_izo_doc_api_verifica()','EXECUTE') THEN RAISE EXCEPTION 'GRANT interzis pe helper E3 %',r.n; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('fn_izo_porti_e3b_definitii','fn_izo_porti_e3b_lipsa',
        'fn_izo_coloane_corectabile','fn_izo_coloane_identitate') AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC EXECUTE';
  END IF;
  IF public.fn_izo_coloane_corectabile('teava') @> ARRAY['unghi_curba']
     OR NOT public.fn_izo_coloane_corectabile('curba') @> ARRAY['unghi_curba']
     OR public.fn_izo_coloane_corectabile('curba') @> ARRAY['lungime_aviz_mm']
     OR public.fn_izo_coloane_corectabile('teava') && ARRAY['lungime_mm','stare','depozit_id','atribute'] THEN
    RAISE EXCEPTION 'lista L nu respectă tipul / include derivate';
  END IF;
  RAISE NOTICE 'OK E3b catalog';
END $test$;

BEGIN;
SAVEPOINT baza;
GRANT UPDATE (atribute) ON public.magazie_bucati TO izo_corectie_writer;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă UPDATE(atribute)'; END IF; END $t$;
ROLLBACK TO baza;
ALTER ROLE izo_cor_editor BYPASSRLS;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă BYPASSRLS'; END IF; END $t$;
ROLLBACK TO baza;
ALTER TABLE public.izo_corectii DISABLE ROW LEVEL SECURITY;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă DISABLE RLS'; END IF; END $t$;
ROLLBACK TO baza;
DROP INDEX public.ux_magbuc_ev_corectie;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă index lipsă'; END IF; END $t$;
ROLLBACK TO baza;
REVOKE EXECUTE ON FUNCTION public.fn_izo_jwt_rol() FROM izo_cor_editor;
DO $t$ BEGIN IF public.fn_izo_porti_e3b_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă identitate tranzitivă lipsă'; END IF; END $t$;
ROLLBACK TO baza;
GRANT EXECUTE ON FUNCTION public.fn_izo_coloane_identitate() TO PUBLIC;
DO $t$ BEGIN IF public.fn_izo_porti_lipsa()='{}'::text[] THEN RAISE EXCEPTION 'poarta acceptă PUBLIC EXECUTE'; END IF; END $t$;
ROLLBACK;
DO $t$ BEGIN
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'mutațiile au lăsat efecte'; END IF;
  RAISE NOTICE 'TESTE E3b-A: TOATE OK';
END $t$;
