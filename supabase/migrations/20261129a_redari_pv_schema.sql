-- 20261129a: schema PV A/B/C. Runner-ul asigura o singura tranzactie.
-- Fara DML, politici noi sau schimbari RLS. Jurnalul existent ramane intact.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129a_redari_pv_schema:' || txid_current() THEN RAISE EXCEPTION '20261129a: garda start invalida'; END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261129a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  -- Aceeasi ordine la apply/revenire, inaintea verificarilor pe date.
  LOCK TABLE public.red_uat, public.red_parcele, public.red_detinatori, public.red_convocari, public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='red_procese_verbale' AND column_name IN ('lucrari','stare_teren','plan_situatie','foto_nr','constatare_mod','reverificare_la','alte_observatii','motiv_pv_b','semnat_la_sesiune','identitate_verificata'))
    OR (table_name='red_parcele' AND column_name IN ('verificare_data','verificare_de_gazpet','verificare_de_tgz','jurnal_santier_ref'))
    OR (table_name='red_detinatori' AND column_name='act_doveditor_cunoscut')
    OR (table_name='red_convocari' AND column_name IN ('adresa_tgz_nr','reluare'))
    OR (table_name='red_uat' AND column_name='responsabil_id'))) THEN RAISE EXCEPTION '20261129a: coloanele exista deja'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_procese_verbale) OR EXISTS (SELECT 1 FROM public.red_parcele) OR EXISTS (SELECT 1 FROM public.red_convocari) THEN
    RAISE EXCEPTION '20261129a: baseline fara PV/parcele/convocari depasit; necesita review';
  END IF;
  IF (SELECT md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY tablename,policyname)) FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_procese_verbale','red_parcele','red_convocari','red_detinatori','red_uat')) IS DISTINCT FROM '2d8f0021e73320ed176e889abc764c92'
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_procese_verbale','red_parcele','red_convocari','red_detinatori','red_uat')) <> 15 THEN RAISE EXCEPTION '20261129a: politici diferite de baseline'; END IF;
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.red_v_parcele'::regclass AND attnum>0 AND NOT attisdropped)
    IS DISTINCT FROM ARRAY['id','proiect_id','uat_id','id_parcela','tronson','km_de_la','km_pana_la','sat','tarla','nr_cadastral','poz_hg','suprafata_temporara_mp','categoria_folosinta','articol_deviz','cantitate','observatii','cheie_sursa','sters_la','sters_de','sters_motiv','created_at']::text[] THEN RAISE EXCEPTION '20261129a: vedere diferita de baseline'; END IF;
  IF NOT coalesce((SELECT 'security_invoker=on'=ANY(reloptions) FROM pg_class WHERE oid='public.red_v_parcele'::regclass),false)
    OR has_column_privilege('authenticated','public.red_parcele','valoare_lei','SELECT,INSERT,UPDATE') THEN RAISE EXCEPTION '20261129a: vedere/valoare_lei nesigure'; END IF;
  PERFORM set_config('gazpet.r29_view_meta',(SELECT coalesce(reloptions::text,'') || '|' || relowner::text || '|' || coalesce(relacl::text,'') FROM pg_class WHERE oid='public.red_v_parcele'::regclass),true);
END $pre$;

ALTER TABLE public.red_procese_verbale
  ADD COLUMN lucrari jsonb CONSTRAINT red_pv_lucrari_ck CHECK (lucrari IS NULL OR jsonb_typeof(lucrari)='object'),
  ADD COLUMN stare_teren jsonb CONSTRAINT red_pv_stare_teren_ck CHECK (stare_teren IS NULL OR jsonb_typeof(stare_teren)='object'),
  ADD COLUMN plan_situatie boolean,
  ADD COLUMN foto_nr integer CONSTRAINT red_pv_foto_ck CHECK (foto_nr IS NULL OR foto_nr>=0),
  ADD COLUMN constatare_mod text CONSTRAINT red_pv_constatare_ck CHECK (constatare_mod IS NULL OR constatare_mod IN ('sediu','teren')),
  ADD COLUMN reverificare_la date,
  ADD COLUMN alte_observatii text,
  ADD COLUMN motiv_pv_b text CONSTRAINT red_pv_motiv_ck CHECK (motiv_pv_b IS NULL OR motiv_pv_b IN ('declaratie','neprezentat','neidentificat','refuz')),
  ADD COLUMN semnat_la_sesiune boolean,
  ADD COLUMN identitate_verificata boolean,
  ADD CONSTRAINT red_pv_motiv_tip_ck CHECK (motiv_pv_b IS NULL OR tip='B');
ALTER TABLE public.red_parcele ADD COLUMN verificare_data date, ADD COLUMN verificare_de_gazpet text,
  ADD COLUMN verificare_de_tgz text, ADD COLUMN jurnal_santier_ref text;
GRANT SELECT (verificare_data,verificare_de_gazpet,verificare_de_tgz,jurnal_santier_ref),
  INSERT (verificare_data,verificare_de_gazpet,verificare_de_tgz,jurnal_santier_ref),
  UPDATE (verificare_data,verificare_de_gazpet,verificare_de_tgz,jurnal_santier_ref) ON public.red_parcele TO authenticated;
ALTER TABLE public.red_detinatori ADD COLUMN act_doveditor_cunoscut boolean;
ALTER TABLE public.red_convocari ADD COLUMN adresa_tgz_nr text, ADD COLUMN reluare boolean NOT NULL DEFAULT false;
-- 20261126a: stare are exact activ/anulat. Anularea si soft-delete elibereaza cheia.
CREATE UNIQUE INDEX red_convocari_reluare_uq ON public.red_convocari(detinator_id)
  WHERE reluare AND stare <> 'anulat' AND sters_la IS NULL;
ALTER TABLE public.red_uat ADD COLUMN responsabil_id uuid CONSTRAINT red_uat_responsabil_fk REFERENCES public.profiles(id);
-- CREATE OR REPLACE pastreaza optiunile, owner-ul si ACL existente.
-- WITH (security_invoker = on) OBLIGATORIU: CREATE OR REPLACE VIEW fără WITH resetează opțiunile -> vederea ar ocoli RLS (prins de postcondiție în DRY)
CREATE OR REPLACE VIEW public.red_v_parcele WITH (security_invoker = on) AS
SELECT p.id,p.proiect_id,p.uat_id,p.id_parcela,p.tronson,p.km_de_la,p.km_pana_la,p.sat,p.tarla,p.nr_cadastral,p.poz_hg,
  p.suprafata_temporara_mp,p.categoria_folosinta,p.articol_deviz,p.cantitate,p.observatii,p.cheie_sursa,p.sters_la,p.sters_de,p.sters_motiv,p.created_at,
  p.verificare_data,p.verificare_de_gazpet,p.verificare_de_tgz,p.jurnal_santier_ref FROM public.red_parcele p;

DO $post$
DECLARE x record; priv text;
BEGIN
  FOR x IN SELECT * FROM (VALUES
    ('red_procese_verbale','lucrari','jsonb'),('red_procese_verbale','stare_teren','jsonb'),('red_procese_verbale','plan_situatie','boolean'),
    ('red_procese_verbale','foto_nr','integer'),('red_procese_verbale','constatare_mod','text'),('red_procese_verbale','reverificare_la','date'),
    ('red_procese_verbale','alte_observatii','text'),('red_procese_verbale','motiv_pv_b','text'),('red_procese_verbale','semnat_la_sesiune','boolean'),('red_procese_verbale','identitate_verificata','boolean'),
    ('red_parcele','verificare_data','date'),('red_parcele','verificare_de_gazpet','text'),('red_parcele','verificare_de_tgz','text'),('red_parcele','jurnal_santier_ref','text'),
    ('red_detinatori','act_doveditor_cunoscut','boolean'),('red_convocari','adresa_tgz_nr','text'),('red_convocari','reluare','boolean'),('red_uat','responsabil_id','uuid')) v(t,c,typ) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=('public.'||x.t)::regclass AND a.attname=x.c AND NOT a.attisdropped
      AND a.atttypid=x.typ::regtype AND a.attnotnull=(x.c='reluare') AND a.atthasdef=(x.c='reluare')) THEN RAISE EXCEPTION '20261129a post: coloana incompatibila %.%',x.t,x.c; END IF;
  END LOOP;
  FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
    FOR x IN SELECT unnest(ARRAY['verificare_data','verificare_de_gazpet','verificare_de_tgz','jurnal_santier_ref']) AS c LOOP
      IF NOT has_column_privilege('authenticated','public.red_parcele',x.c,priv) THEN RAISE EXCEPTION '20261129a post: GRANT lipsa % %',x.c,priv; END IF;
    END LOOP;
  END LOOP;
  IF (SELECT coalesce(reloptions::text,'') || '|' || relowner::text || '|' || coalesce(relacl::text,'') FROM pg_class WHERE oid='public.red_v_parcele'::regclass) IS DISTINCT FROM current_setting('gazpet.r29_view_meta',true)
    OR has_column_privilege('authenticated','public.red_parcele','valoare_lei','SELECT,INSERT,UPDATE')
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.red_v_parcele'::regclass AND attname='valoare_lei' AND NOT attisdropped)
    OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.red_v_parcele'::regclass AND attnum>0 AND NOT attisdropped) <> 25 THEN RAISE EXCEPTION '20261129a post: vedere/valoare_lei'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.red_procese_verbale'::regclass AND convalidated AND conname IN ('red_pv_lucrari_ck','red_pv_stare_teren_ck','red_pv_foto_ck','red_pv_constatare_ck','red_pv_motiv_ck','red_pv_motiv_tip_ck')) <> 6
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.red_uat'::regclass AND conname='red_uat_responsabil_fk' AND convalidated AND confrelid='public.profiles'::regclass)
    OR NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid='public.red_convocari_reluare_uq'::regclass AND indisunique AND indisvalid) THEN RAISE EXCEPTION '20261129a post: CHECK/FK/UNIQUE lipsa'; END IF;
  IF (SELECT pg_get_expr(adbin,adrelid) FROM pg_attrdef WHERE adrelid='public.red_convocari'::regclass AND adnum=(SELECT attnum FROM pg_attribute WHERE attrelid='public.red_convocari'::regclass AND attname='reluare')) IS DISTINCT FROM 'false' THEN RAISE EXCEPTION '20261129a post: default reluare'; END IF;
  IF (SELECT md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY tablename,policyname)) FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_procese_verbale','red_parcele','red_convocari','red_detinatori','red_uat')) IS DISTINCT FROM '2d8f0021e73320ed176e889abc764c92' THEN RAISE EXCEPTION '20261129a post: politici schimbate'; END IF;
END $post$;
