-- GENERAT de scripts/izometrie/e3b_gen/gen_e3b.py. NU se editează manual.
  -- 20261105a: E3b piesele A+B+C1, infrastructură, gărzi și propuneri.
  -- Design r5: toate Q-E3b-1..18 = A. Operațiile directe, storno și istoricul vin în C2/D.
-- Numai runner; nicio modificare de date. Implementare parțială E3b: fluxul propunerilor C1.
DO $migrare$
DECLARE v_amprenta text; v_scrisa text; v_inainte text; v_comentariu text;
  v_lipsa text[]; v_impl text[]; v_impl_rev text[]; v_x text; rr record;
  v_porti text; v_porti_e3 text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261105a_izometrie_e3b_corectii:' || txid_current() THEN
    RAISE EXCEPTION 'E3b: numai postgres, prin scripts/livrare_migrare.sh';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION 'E3b: READ COMMITTED obligatoriu';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- §17.4 pasul 1: primul lock, înainte de citirea baseline-ului.
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  IF to_regprocedure('public.fn_izo_porti_e3_lipsa()') IS NULL THEN
    RAISE EXCEPTION 'E3b: E3 nu este aplicată';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('izo_cor_editor','izo_corectie_writer'))
     OR to_regclass('public.izo_corectii') IS NOT NULL OR to_regclass('public.izo_corectii_bucati') IS NOT NULL
     OR to_regclass('public.izo_documente_istoric') IS NOT NULL OR to_regclass('public.ux_magbuc_ev_corectie') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND (proname LIKE 'fn\_izo\_cor\_%' OR proname LIKE 'fn\_izo\_porti\_e3b\_%'
                      OR proname IN ('fn_izo_coloane_corectabile','fn_izo_coloane_identitate','fn_izo_garda_corectie','fn_izo_lant_blocant')))
     OR EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip = 'izo_corectie') THEN
    RAISE EXCEPTION 'E3b: obiecte sau fapte E3b există deja';
  END IF;
  -- Stabilizează nivelul și datele verificate, inclusiv ciornele (și scrierile fără advisory).
  LOCK TABLE public.izo_proiect_config, public.izo_importuri, public.izo_documente_intrare,
    public.magazie_bucati, public.magazie_bucati_evenimente, public.magazie_bucati_miscari IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.izo_proiect_config WHERE nivel_izo NOT IN ('off','stoc','montaj') OR nivel_izo IS NULL) THEN
    RAISE EXCEPTION 'E3b: nivel de proiect necunoscut';
  END IF;
  IF EXISTS (SELECT 1 FROM public.izo_documente_intrare WHERE stare = 'draft') THEN
    RAISE EXCEPTION 'E3b: există documente draft; istoricul cere zero ciorne vechi';
  END IF;
@@PRE_MD5@@
@@COLOANE@@
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.magazie_bucati_evenimente'::regclass
         AND conname = 'magazie_bucati_evenimente_tip_check')) IS DISTINCT FROM @@TIP_CHECK_E3@@ THEN
    RAISE EXCEPTION 'E3b: CHECK tip eveniment diferă de forma E3';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.magazie_bucati'::regclass
         AND conname = 'magazie_bucati_sursa_receptie_check')) IS DISTINCT FROM
    'CHECK ((sursa_receptie = ANY (ARRAY[''packing_list''::text, ''aviz''::text, ''mtc''::text, ''manual''::text])))' THEN
    RAISE EXCEPTION 'E3b: CHECK sursa_receptie diferă de forma LIVE';
  END IF;
  -- Recitire catalog, nu confundăm setările rolurilor cu timeout-urile efective PostgREST (§3.5).
  FOR rr IN SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('authenticator','authenticated') LOOP
    RAISE NOTICE 'E3b timeout-uri de rol (nu efective): % %', rr.rolname, rr.rolconfig;
  END LOOP;
  -- §17.4 pasul 2: verde ÎNAINTE de DDL + mulțime fixă, nu TOFU.
  v_lipsa := public.fn_izo_porti_lipsa() || public.fn_izo_porti_e3_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'E3b baseline: porți incomplete %', v_lipsa; END IF;
@@IMPL_PRE@@
@@AMPRENTA@@
  v_comentariu := obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class');
  v_scrisa := substring(v_comentariu FROM 'amprenta=([0-9a-f]{32})');
  IF v_amprenta IS NULL OR v_amprenta IS DISTINCT FROM v_scrisa THEN
    RAISE EXCEPTION 'E3b: amprenta de revenire diferă de COMMENT';
  END IF;
  v_inainte := v_amprenta;
  v_porti := obj_description('public.fn_izo_porti_definitii()'::regprocedure, 'pg_proc');
  v_porti_e3 := obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure, 'pg_proc');

  -- §17.4 pasul 3: DDL autorizat.
  CREATE ROLE izo_cor_editor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  CREATE ROLE izo_corectie_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  GRANT izo_cor_editor TO postgres WITH INHERIT FALSE, SET TRUE;
  GRANT izo_corectie_writer TO postgres WITH INHERIT FALSE, SET TRUE;
  GRANT USAGE ON SCHEMA public TO izo_cor_editor, izo_corectie_writer;

  CREATE TABLE public.izo_corectii (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
    tip text NOT NULL CHECK (tip IN ('camp','carantina_intrare','carantina_iesire','pierdut','gasit_recuperare','gasit_nou','pv','storno_import')),
    bucata_id bigint REFERENCES public.magazie_bucati(id) ON DELETE RESTRICT,
    document_intrare_id bigint REFERENCES public.izo_documente_intrare(id) ON DELETE RESTRICT,
    import_id text,
    inainte jsonb NOT NULL,
    dupa jsonb,
    ncr_ref text CHECK (ncr_ref IS NULL OR char_length(btrim(ncr_ref)) BETWEEN 1 AND 80),
    motiv text NOT NULL CHECK (char_length(btrim(motiv)) BETWEEN 3 AND 1000),
    stare text NOT NULL DEFAULT 'propusa' CHECK (stare IN ('propusa','aplicata','respinsa','retrasa')),
    versiune bigint NOT NULL DEFAULT 1 CHECK (versiune >= 1),
    cale text NOT NULL CHECK (cale IN ('propunere','direct')),
    propus_de uuid NOT NULL, propus_rol text NOT NULL DEFAULT session_user,
    propus_la timestamptz NOT NULL DEFAULT now(),
    decis_de uuid, decis_rol text, decis_la timestamptz,
    motiv_decizie text CHECK (motiv_decizie IS NULL OR char_length(btrim(motiv_decizie)) BETWEEN 3 AND 1000),
    eveniment_id bigint UNIQUE REFERENCES public.magazie_bucati_evenimente(id) ON DELETE RESTRICT,
    CONSTRAINT izo_cor_tinta CHECK (
      (tip IN ('camp','carantina_intrare','carantina_iesire','pierdut','gasit_recuperare') AND bucata_id IS NOT NULL
        AND document_intrare_id IS NULL AND import_id IS NULL)
      OR (tip = 'gasit_nou' AND import_id IS NULL AND ((stare = 'aplicata' AND bucata_id IS NOT NULL) OR (stare <> 'aplicata' AND bucata_id IS NULL)))
      OR (tip = 'pv' AND bucata_id IS NULL AND document_intrare_id IS NOT NULL AND import_id IS NULL)
      OR (tip = 'storno_import' AND bucata_id IS NULL AND document_intrare_id IS NULL AND import_id IS NOT NULL)),
    CONSTRAINT izo_cor_ncr CHECK ((tip IN ('carantina_intrare','carantina_iesire')) = (ncr_ref IS NOT NULL)),
    CONSTRAINT izo_cor_cale CHECK ((cale = 'direct' AND tip IN ('camp','pv','storno_import'))
      OR (cale = 'propunere' AND tip NOT IN ('pv','storno_import'))),
    CONSTRAINT izo_cor_aplicata CHECK ((stare = 'aplicata') = (eveniment_id IS NOT NULL)
      AND (stare = 'aplicata') = (decis_la IS NOT NULL AND eveniment_id IS NOT NULL)),
    CONSTRAINT izo_cor_decizie CHECK (
      (stare = 'propusa' AND num_nonnulls(decis_de,decis_rol,decis_la,motiv_decizie,eveniment_id) = 0)
      OR (stare = 'aplicata' AND decis_rol IS NOT NULL AND decis_la IS NOT NULL AND eveniment_id IS NOT NULL
          AND (decis_de IS NOT NULL OR tip = 'storno_import'))
      OR (stare IN ('respinsa','retrasa') AND decis_de IS NOT NULL AND decis_rol IS NOT NULL AND decis_la IS NOT NULL
          AND motiv_decizie IS NOT NULL AND eveniment_id IS NULL))
  );
  CREATE UNIQUE INDEX ux_izo_cor_deschisa ON public.izo_corectii(bucata_id)
    WHERE stare = 'propusa' AND bucata_id IS NOT NULL;
  CREATE TABLE public.izo_corectii_bucati (
    corectie_id bigint NOT NULL REFERENCES public.izo_corectii(id) ON DELETE RESTRICT,
    bucata_id bigint NOT NULL REFERENCES public.magazie_bucati(id) ON DELETE RESTRICT,
    PRIMARY KEY (corectie_id, bucata_id)
  );
  CREATE INDEX ix_izo_cor_bucati_bucata ON public.izo_corectii_bucati(bucata_id);
  CREATE TABLE public.izo_documente_istoric (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id bigint NOT NULL REFERENCES public.izo_documente_intrare(id) ON DELETE RESTRICT,
    versiune bigint NOT NULL CHECK (versiune >= 1),
    salvat_de uuid NOT NULL, salvat_rol text NOT NULL DEFAULT session_user,
    salvat_la timestamptz NOT NULL DEFAULT now(),
    continut jsonb NOT NULL,
    hash text NOT NULL CHECK (hash ~ '^e3-doc-v1:[0-9a-f]{64}$'),
    diff jsonb NOT NULL, baza boolean NOT NULL,
    UNIQUE (document_id, versiune)
  );
  ALTER TABLE public.magazie_bucati_evenimente DROP CONSTRAINT magazie_bucati_evenimente_tip_check;
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magazie_bucati_evenimente_tip_check CHECK (tip IN (@@TIPURI_E3B@@));
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magbuc_ev_e3b_motiv
    CHECK (tip NOT IN ('carantina_intrare','carantina_iesire','storno_partial') OR motiv IS NOT NULL);
  CREATE UNIQUE INDEX ux_magbuc_ev_corectie ON public.magazie_bucati_evenimente(document_id) WHERE document_tip = 'izo_corectie';

  CREATE FUNCTION public.fn_izo_coloane_corectabile(p_tip_cod text) RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT CASE p_tip_cod WHEN 'teava' THEN @@L_TEAVA@@ WHEN 'curba' THEN @@L_CURBA@@ ELSE '{}'::text[] END
  $f$;
  CREATE FUNCTION public.fn_izo_coloane_identitate() RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT @@L_IDENT@@
  $f$;
  REVOKE ALL ON FUNCTION public.fn_izo_coloane_corectabile(text), public.fn_izo_coloane_identitate()
    FROM PUBLIC, anon, authenticated, service_role;

  ALTER TABLE public.izo_corectii ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.izo_corectii_bucati ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.izo_documente_istoric ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.izo_corectii, public.izo_corectii_bucati, public.izo_documente_istoric
    FROM PUBLIC, anon, authenticated, service_role, izo_cor_editor, izo_corectie_writer, izo_doc_editor;
  REVOKE ALL ON SEQUENCE public.izo_corectii_id_seq, public.izo_documente_istoric_id_seq
    FROM PUBLIC, anon, authenticated, service_role, izo_cor_editor, izo_corectie_writer, izo_doc_editor;
@@POLITICI@@

  -- PIESA C/D: GRANT-uri rămase, numai după CREATE (§1 / §3.5).
  -- B: ACL-urile helper-elor sunt generate din lista fixă FN_B, după CREATE.
  -- C: propune/retrage/respinge/verifica/aproba/camp/pv -> authenticated;
  -- cor_storno_import -> postgres (niciodată authenticated).
  -- D: doc_instantaneu/doc_diff -> izo_doc_editor; lant_blocant ->
  -- izo_corectie_writer/izo_registru_writer/izo_receptie_writer (Q1=A);
  -- cor_deschise(bigint[]) există din B, cu EXECUTE pentru cei doi writeri (Q1=A).
  -- Fără GRANT nou pe fn_izo_doc_api_verifica.
  -- Piesa B, §3.2–3.4. Helper-ele nu deschid o cale API de scriere.
  CREATE FUNCTION public.fn_izo_cor_chei(p_tip text, p_tip_cod text, p_cale text) RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT CASE p_tip
      WHEN 'camp' THEN ARRAY(SELECT k FROM unnest(public.fn_izo_coloane_corectabile(p_tip_cod)) k
        WHERE (k = ANY(public.fn_izo_coloane_identitate())) = (p_cale = 'propunere'))
      WHEN 'gasit_nou' THEN public.fn_izo_coloane_corectabile(p_tip_cod) || ARRAY['tip_cod','depozit_id','document_intrare_id']
      WHEN 'carantina_intrare' THEN ARRAY['ncr_ref']
      WHEN 'carantina_iesire' THEN ARRAY['ncr_ref','stare']
      WHEN 'pierdut' THEN ARRAY['cauza']
      WHEN 'gasit_recuperare' THEN ARRAY['depozit_id']
      WHEN 'pv' THEN ARRAY['pv_nr','pv_data'] ELSE '{}'::text[] END
  $f$;

  CREATE FUNCTION public.fn_izo_cor_autorizare_lock(p_proiect bigint, p_rol text, p_depozit integer) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid := auth.uid(); v_owner boolean;
  BEGIN
    IF v_uid IS NULL OR p_proiect IS NULL OR p_rol IS NULL OR p_rol NOT IN ('responsabil','gestionar') THEN RETURN false; END IF;
    SELECT pr.is_owner INTO v_owner FROM public.profiles pr WHERE pr.id=v_uid FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_owner IS TRUE THEN RETURN true; END IF;
    PERFORM 1 FROM public.user_module_access ua WHERE ua.profile_id=v_uid AND ua.module='magazie'
      AND ua.access_level IN ('editor','admin') FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
    PERFORM 1 FROM public.izo_atribuiri atb WHERE atb.proiect_id=p_proiect AND atb.profile_id=v_uid AND atb.activ
      AND current_date BETWEEN atb.valabil_de AND coalesce(atb.valabil_pana,current_date)
      AND ((p_rol='responsabil' AND atb.rol IN ('manager_aprobator','inlocuitor_aprobator') AND atb.depozit_id IS NULL)
        OR (p_rol='gestionar' AND atb.rol='gestionar' AND atb.depozit_id=p_depozit)) ORDER BY atb.id FOR SHARE;
    RETURN FOUND;
  END $f$;
  CREATE FUNCTION public.fn_izo_cor_cerut_de_valid(p_proiect bigint, p_profil uuid) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_owner boolean;
  BEGIN
    IF p_profil IS NULL OR p_proiect IS NULL THEN RETURN false; END IF;
    SELECT pr.is_owner INTO v_owner FROM public.profiles pr WHERE pr.id=p_profil FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_owner IS TRUE THEN RETURN true; END IF;
    PERFORM 1 FROM public.izo_atribuiri atb WHERE atb.proiect_id=p_proiect AND atb.profile_id=p_profil
      AND atb.rol IN ('manager_aprobator','inlocuitor_aprobator') AND atb.depozit_id IS NULL AND atb.activ
      AND current_date BETWEEN atb.valabil_de AND coalesce(atb.valabil_pana,current_date) ORDER BY atb.id FOR SHARE;
    RETURN FOUND;
  END $f$;
  CREATE FUNCTION public.fn_izo_cor_bucata_lock(p_bucata bigint, p_proiect bigint) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_b public.magazie_bucati;
  BEGIN
    SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=p_bucata AND b.proiect_id=p_proiect
      AND b.provenienta='beneficiar' AND b.tip_cod IS NOT NULL FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN to_jsonb(v_b);
  END $f$;
  CREATE FUNCTION public.fn_izo_cor_doc_lock(p_doc bigint, p_proiect bigint) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  BEGIN
    PERFORM 1 FROM public.izo_documente_intrare doc WHERE doc.id=p_doc AND doc.proiect_id=p_proiect
      AND doc.stare='confirmat' FOR SHARE;
    RETURN FOUND;
  END $f$;
  CREATE FUNCTION public.fn_izo_cor_deschise(p_bucati bigint[])
    RETURNS TABLE (bucata_id bigint, corectie_id bigint, tip text)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT cor.bucata_id, cor.id, cor.tip FROM public.izo_corectii cor
      WHERE cor.bucata_id=ANY(p_bucati) AND cor.stare='propusa' ORDER BY cor.bucata_id,cor.id
  $f$;
  CREATE FUNCTION public.fn_izo_cor_adm_verifica() RETURNS void
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_lipsa text[];
  BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'E3b cere READ COMMITTED' USING ERRCODE='25001'; END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
    IF session_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'E3b administrativ' USING ERRCODE='42501'; END IF;
    IF coalesce(current_setting('izo.receptie_ctx',true),'') <> '' OR coalesce(current_setting('izo.corectie_ctx',true),'') <> ''
      OR current_setting('izo.registru_tx',true)=txid_current()::text THEN
      RAISE EXCEPTION 'E3b: operație deja începută' USING ERRCODE='42501'; END IF;
    v_lipsa := public.fn_izo_porti_lipsa();
    IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'E3b: porți incomplete %',v_lipsa USING ERRCODE='42501'; END IF;
  END $f$;
  CREATE FUNCTION public.fn_izo_cor_api_verifica() RETURNS uuid
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_lipsa text[];
  BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'E3b cere READ COMMITTED' USING ERRCODE='25001'; END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
    IF session_user IS DISTINCT FROM 'authenticator' OR public.fn_izo_jwt_rol() IS DISTINCT FROM 'authenticated' THEN
      RAISE EXCEPTION 'E3b: doar API authenticated' USING ERRCODE='42501'; END IF;
    v_uid := public.fn_izo_uid();
    IF v_uid IS NULL THEN RAISE EXCEPTION 'E3b: identitate absentă' USING ERRCODE='42501'; END IF;
    IF coalesce(current_setting('izo.receptie_ctx',true),'') <> '' OR coalesce(current_setting('izo.corectie_ctx',true),'') <> ''
      OR current_setting('izo.registru_tx',true)=txid_current()::text THEN
      RAISE EXCEPTION 'E3b: operație deja începută' USING ERRCODE='42501'; END IF;
    v_lipsa := public.fn_izo_porti_lipsa();
    IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'E3b: porți incomplete %',v_lipsa USING ERRCODE='42501'; END IF;
    RETURN v_uid;
  END $f$;

  -- Nu setează timeout-uri: păstrează limitele efective ale apelului; 55P03/57014 se propagă.
  -- §4: schemă → document → corecție → profil/modul/atribuiri → locuri → tabele → advisory → import → bucăți → FK → registru.
  CREATE FUNCTION public.fn_izo_cor_marcheaza(p_corectie bigint) RETURNS bigint
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_cor public.izo_corectii; v_nou bigint;
  BEGIN
    IF current_user <> 'izo_corectie_writer' OR coalesce(current_setting('izo.receptie_ctx',true),'') <> ''
      OR coalesce(current_setting('izo.corectie_ctx',true),'') <> '' OR current_setting('izo.registru_tx',true)=txid_current()::text THEN
      RAISE EXCEPTION 'E3b: marcaj refuzat' USING ERRCODE='42501'; END IF;
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie;
    IF NOT FOUND OR v_cor.stare <> 'propusa' THEN RAISE EXCEPTION 'E3b: corecție absentă/închisă' USING ERRCODE='42501'; END IF;
    IF v_cor.tip='gasit_nou' THEN v_nou := nextval('public.magazie_bucati_id_seq'); END IF;
    PERFORM set_config('izo.corectie_ctx',txid_current()::text || '|' || v_cor.tip || '|' || v_cor.id || '|'
      || v_cor.proiect_id || '|' || v_cor.versiune || '|' || coalesce(v_nou::text,''),true);
    RETURN v_nou;
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_loc(p_b public.magazie_bucati) RETURNS jsonb
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT CASE p_b.locatie_tip WHEN 'depozit' THEN jsonb_build_object('tip','depozit','depozit_id',p_b.depozit_id)
      WHEN 'tronson' THEN jsonb_build_object('tip','tronson','tronson_id',p_b.tronson_id) END
  $f$;
  CREATE FUNCTION public.fn_izo_cor_tinta_iesire(p_b public.magazie_bucati) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_m public.magazie_bucati_miscari;
  BEGIN
    SELECT mis.* INTO v_m FROM public.magazie_bucati_miscari mis WHERE mis.bucata_id=p_b.id AND mis.stare_dupa='carantina'
      AND (mis.rol='nascut' OR mis.stare_inainte NOT IN ('carantina','pierduta')) ORDER BY mis.id DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'E3b: episod carantină absent' USING ERRCODE='22023'; END IF;
    IF v_m.rol='stare' AND v_m.stare_inainte IN ('sosit','receptionat') THEN RETURN v_m.stare_inainte; END IF;
    IF v_m.rol='nascut' THEN
      IF p_b.aviz_intrare_id IS NULL THEN RETURN NULL; END IF; -- ținta explicită din detalii
      IF EXISTS (SELECT 1 FROM public.izo_documente_intrare doc WHERE doc.id=p_b.aviz_intrare_id AND doc.eveniment_pv_id IS NOT NULL) THEN
        RETURN 'receptionat'; END IF;
    END IF;
    RAISE EXCEPTION 'E3b: pune întâi PV-ul / episod invalid' USING ERRCODE='22023';
  END $f$;

  -- Normalizează rezultatul tipizat, nu JSON-ul arbitrar al apelantului.
  CREATE FUNCTION public.fn_izo_cor_valori(p_b public.magazie_bucati) RETURNS void
    LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF p_b.tip_cod IS NULL OR p_b.tip_cod NOT IN ('teava','curba') OR p_b.serie IS NULL OR char_length(btrim(p_b.serie)) NOT BETWEEN 1 AND 60
      OR p_b.sarja IS NULL OR char_length(btrim(p_b.sarja)) NOT BETWEEN 1 AND 60 OR p_b.perete_mm IS NULL OR p_b.perete_mm NOT BETWEEN 3 AND 40
      OR (p_b.diametru_mm IS NOT NULL AND p_b.diametru_mm NOT BETWEEN 10 AND 2000)
      OR (p_b.greutate_kg IS NOT NULL AND (p_b.greutate_kg < 0 OR p_b.greutate_kg::text IN ('NaN','Infinity','-Infinity')))
      OR (p_b.izolatie IS NOT NULL AND p_b.izolatie NOT IN ('neizolata','PEHD','GRP'))
      OR (p_b.tip_cod='teava' AND (p_b.lungime_mm IS NULL OR p_b.lungime_mm NOT BETWEEN 1 AND 30000
        OR (p_b.lungime_aviz_mm IS NOT NULL AND p_b.lungime_aviz_mm NOT BETWEEN 1 AND 30000)
        OR (p_b.lungime_masurata_mm IS NOT NULL AND p_b.lungime_masurata_mm NOT BETWEEN 1 AND 30000)))
      OR (p_b.tip_cod='curba' AND (p_b.unghi_curba IS NULL OR NOT (p_b.unghi_curba > 0 AND p_b.unghi_curba <= 90))) THEN
      RAISE EXCEPTION 'E3b: valori în afara limitelor §2.5' USING ERRCODE='22023'; END IF;
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_valideaza(p_cor public.izo_corectii) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_b public.magazie_bucati; v_rez public.magazie_bucati; v_doc public.izo_documente_intrare;
    v_d jsonb := p_cor.dupa; v_tip text; v_keys text[]; v_key text; v_target text; v_m public.magazie_bucati_miscari;
  BEGIN
    IF p_cor.tip='storno_import' THEN
      IF v_d IS NOT NULL THEN RAISE EXCEPTION 'E3b: storno fără dupa' USING ERRCODE='22023'; END IF;
      RETURN NULL;
    END IF;
    IF jsonb_typeof(v_d) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'E3b: detalii obiect' USING ERRCODE='22023'; END IF;
    IF p_cor.bucata_id IS NOT NULL THEN
      SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=p_cor.bucata_id AND b.proiect_id=p_cor.proiect_id;
      IF NOT FOUND OR v_b.provenienta <> 'beneficiar' OR v_b.tip_cod IS NULL OR v_b.parinte_id IS NOT NULL
        OR v_b.radacina_id IS DISTINCT FROM v_b.id OR EXISTS (SELECT 1 FROM public.magazie_bucati ch WHERE ch.parinte_id=v_b.id)
        OR v_b.stare IN ('anulata','montata','taiata','rezervata','consumata') THEN
        RAISE EXCEPTION 'E3b: bucată neeligibilă' USING ERRCODE='22023'; END IF;
      IF p_cor.tip <> 'camp' AND v_b.aviz_intrare_id IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM public.izo_documente_intrare doc WHERE doc.id=v_b.aviz_intrare_id AND doc.eveniment_pv_id IS NOT NULL) THEN
        RAISE EXCEPTION 'E3b: pune întâi PV-ul' USING ERRCODE='22023'; END IF;
    END IF;
    v_tip := CASE WHEN p_cor.tip='gasit_nou' THEN v_d->>'tip_cod' ELSE v_b.tip_cod END;
    v_keys := public.fn_izo_cor_chei(p_cor.tip,v_tip,p_cor.cale);
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_d) k WHERE NOT k=ANY(v_keys)) THEN
      RAISE EXCEPTION 'E3b: cheie în afara listei albe / trimite separat identitatea' USING ERRCODE='22023'; END IF;
    IF p_cor.tip IN ('camp','gasit_nou') THEN
      IF p_cor.tip='camp' AND (v_d='{}'::jsonb OR v_b.stare NOT IN ('sosit','receptionat','carantina','pe_tronson')) THEN
        RAISE EXCEPTION 'E3b: camp gol / stare invalidă' USING ERRCODE='22023'; END IF;
      v_rez := jsonb_populate_record(CASE WHEN p_cor.tip='camp' THEN v_b ELSE NULL::public.magazie_bucati END,v_d);
      IF v_rez.tip_cod='teava' THEN
        v_rez.lungime_mm := coalesce(v_rez.lungime_masurata_mm,v_rez.lungime_aviz_mm);
        v_rez.lungime_m := v_rez.lungime_mm/1000.0; v_rez.lungime_originala_m := v_rez.lungime_m;
      END IF;
      PERFORM public.fn_izo_cor_valori(v_rez);
      IF p_cor.tip='gasit_nou' THEN
        IF NOT (v_d ?& ARRAY['tip_cod','depozit_id','serie','sarja','perete_mm']) OR v_rez.depozit_id IS NULL
          OR public.fn_izo_loc_valid(p_cor.proiect_id,v_rez.depozit_id,NULL) IS NOT TRUE
          OR p_cor.document_intrare_id IS DISTINCT FROM (v_d->>'document_intrare_id')::bigint THEN
          RAISE EXCEPTION 'E3b: găsit incomplet / depozit invalid' USING ERRCODE='22023'; END IF;
        IF p_cor.document_intrare_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare doc
          WHERE doc.id=p_cor.document_intrare_id AND doc.proiect_id=p_cor.proiect_id AND doc.stare='confirmat') THEN
          RAISE EXCEPTION 'E3b: document inexistent sau inaccesibil' USING ERRCODE='22023'; END IF;
      END IF;
      FOR v_key IN SELECT jsonb_object_keys(v_d) LOOP
        IF p_cor.tip='camp' AND to_jsonb(v_rez)->v_key IS NOT DISTINCT FROM to_jsonb(v_b)->v_key THEN
          RAISE EXCEPTION 'E3b: nimic de corectat (%)',v_key USING ERRCODE='22023'; END IF;
        IF v_key <> 'document_intrare_id' THEN v_d := jsonb_set(v_d,ARRAY[v_key],to_jsonb(v_rez)->v_key); END IF;
      END LOOP;
      IF v_tip='teava' AND v_d ?| ARRAY['lungime_aviz_mm','lungime_masurata_mm'] THEN
        FOR v_key IN SELECT unnest(ARRAY['lungime_mm','lungime_m','lungime_originala_m']) LOOP
          IF p_cor.tip='gasit_nou' OR to_jsonb(v_rez)->v_key IS DISTINCT FROM to_jsonb(v_b)->v_key THEN
            v_d := v_d || jsonb_build_object(v_key,to_jsonb(v_rez)->v_key); END IF;
        END LOOP;
      END IF;
      RETURN v_d;
    ELSIF p_cor.tip='pv' THEN
      SELECT doc.* INTO v_doc FROM public.izo_documente_intrare doc WHERE doc.id=p_cor.document_intrare_id AND doc.proiect_id=p_cor.proiect_id;
      IF NOT FOUND OR v_doc.stare <> 'confirmat' OR v_doc.eveniment_pv_id IS NULL OR NOT (v_d ?& ARRAY['pv_nr','pv_data'])
        OR v_d->>'pv_nr' IS NULL OR char_length(btrim(v_d->>'pv_nr')) NOT BETWEEN 1 AND 80
        OR position('|' IN v_d->>'pv_nr')>0 OR v_d->>'pv_data' IS NULL THEN
        RAISE EXCEPTION 'E3b: PV invalid' USING ERRCODE='22023'; END IF;
      v_target := upper(regexp_replace(btrim(v_d->>'pv_nr'),'[[:space:]]+',' ','g'));
      v_d := jsonb_build_object('pv_nr',btrim(v_d->>'pv_nr'),'pv_nr_canon',v_target,'pv_data',(v_d->>'pv_data')::date);
      IF (v_target,(v_d->>'pv_data')::date) IS NOT DISTINCT FROM (v_doc.pv_nr_canon,v_doc.pv_data) THEN
        RAISE EXCEPTION 'E3b: nimic de corectat' USING ERRCODE='22023'; END IF;
      RETURN v_d;
    ELSIF p_cor.tip IN ('carantina_intrare','carantina_iesire') THEN
      IF v_d->>'ncr_ref' IS NULL OR char_length(btrim(v_d->>'ncr_ref')) NOT BETWEEN 1 AND 80
        OR p_cor.ncr_ref IS DISTINCT FROM btrim(v_d->>'ncr_ref') OR v_b.locatie_tip <> 'depozit' THEN
        RAISE EXCEPTION 'E3b: NCR / loc invalid' USING ERRCODE='22023'; END IF;
      IF p_cor.tip='carantina_intrare' THEN
        IF v_b.stare NOT IN ('sosit','receptionat') THEN RAISE EXCEPTION 'E3b: stare carantină invalidă' USING ERRCODE='22023'; END IF;
        RETURN jsonb_build_object('stare','carantina');
      END IF;
      IF v_b.stare <> 'carantina' THEN RAISE EXCEPTION 'E3b: nu e în carantină' USING ERRCODE='22023'; END IF;
      v_target := public.fn_izo_cor_tinta_iesire(v_b);
      IF (v_target IS NOT NULL AND v_d ? 'stare') OR (v_target IS NULL AND coalesce(v_d->>'stare','') NOT IN ('sosit','receptionat')) THEN
        RAISE EXCEPTION 'E3b: țintă carantină invalidă' USING ERRCODE='22023'; END IF;
      RETURN jsonb_build_object('stare',coalesce(v_target,v_d->>'stare'));
    ELSIF p_cor.tip='pierdut' THEN
      IF coalesce(v_d->>'cauza','') NOT IN ('lipsa_la_receptie','disparuta') OR v_b.stare NOT IN ('sosit','receptionat','carantina','pe_tronson') THEN
        RAISE EXCEPTION 'E3b: pierdut invalid' USING ERRCODE='22023'; END IF;
      RETURN jsonb_build_object('stare','pierduta');
    ELSIF p_cor.tip='gasit_recuperare' THEN
      SELECT mis.* INTO v_m FROM public.magazie_bucati_miscari mis WHERE mis.bucata_id=v_b.id AND mis.stare_dupa='pierduta' ORDER BY mis.id DESC LIMIT 1;
      IF NOT FOUND OR v_b.stare <> 'pierduta' OR v_m.stare_inainte NOT IN ('sosit','receptionat','carantina','pe_tronson') THEN
        RAISE EXCEPTION 'E3b: recuperare invalidă' USING ERRCODE='22023'; END IF;
      IF v_b.locatie_tip='tronson' THEN
        IF v_d ? 'depozit_id' THEN RAISE EXCEPTION 'E3b: tronsonul rămâne identic' USING ERRCODE='22023'; END IF;
        RETURN jsonb_build_object('stare',v_m.stare_inainte);
      END IF;
      IF (v_d ? 'depozit_id' AND v_d->>'depozit_id' IS NULL) OR
        public.fn_izo_loc_valid(p_cor.proiect_id,coalesce((v_d->>'depozit_id')::integer,v_b.depozit_id),NULL) IS NOT TRUE THEN
        RAISE EXCEPTION 'E3b: depozit invalid' USING ERRCODE='22023'; END IF;
      RETURN jsonb_build_object('stare',v_m.stare_inainte,'depozit_id',coalesce((v_d->>'depozit_id')::integer,v_b.depozit_id));
    END IF;
    RAISE EXCEPTION 'E3b: tip invalid' USING ERRCODE='22023';
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'E3b: valoare invalidă' USING ERRCODE='22023';
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_inainte(p_cor public.izo_corectii) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_b public.magazie_bucati; v_keys text[];
  BEGIN
    IF p_cor.tip='gasit_nou' THEN RETURN '{}'::jsonb; END IF;
    IF p_cor.tip='pv' THEN RETURN (SELECT jsonb_build_object('pv_nr',doc.pv_nr,'pv_nr_canon',doc.pv_nr_canon,
      'pv_data',doc.pv_data,'versiune',doc.versiune) FROM public.izo_documente_intrare doc WHERE doc.id=p_cor.document_intrare_id); END IF;
    IF p_cor.tip='storno_import' THEN RETURN (SELECT to_jsonb(imp) FROM public.izo_importuri imp
      WHERE imp.proiect_id=p_cor.proiect_id AND imp.import_id=p_cor.import_id AND imp.stare='aplicat'); END IF;
    SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=p_cor.bucata_id;
    IF p_cor.tip='camp' THEN
      SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_cor.dupa) k;
      RETURN public.fn_izo_proiectie(to_jsonb(v_b),v_keys) || jsonb_build_object('server_ver',v_b.server_ver);
    END IF;
    RETURN jsonb_build_object('stare',v_b.stare,'loc',public.fn_izo_cor_loc(v_b)) ||
      CASE WHEN p_cor.tip='pierdut' THEN jsonb_build_object('cauza',p_cor.dupa->>'cauza') ELSE '{}'::jsonb END;
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_eveniment_asteptat(p_cor public.izo_corectii) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT to_jsonb(jsonb_populate_record(NULL::public.magazie_bucati_evenimente,jsonb_build_object(
      'tip',CASE p_cor.tip WHEN 'camp' THEN 'corectie' WHEN 'pv' THEN 'corectie' WHEN 'gasit_recuperare' THEN 'gasit'
        WHEN 'gasit_nou' THEN 'gasit' WHEN 'storno_import' THEN 'storno_partial' ELSE p_cor.tip END,
      'proiect_id',p_cor.proiect_id,'document_tip','izo_corectie','document_id',p_cor.id::text,'import_id',p_cor.import_id,
      'storno_de_eveniment_id',NULL,'motiv',p_cor.motiv,'declarat_de',p_cor.propus_de,'aplicat_de',public.fn_izo_uid(),
      'aplicat_rol',session_user,'ora_tableta',NULL,'dispozitiv_id',NULL)))
  $f$;
  CREATE FUNCTION public.fn_izo_cor_bucata_dupa(p_cor public.izo_corectii, p_b public.magazie_bucati) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT to_jsonb(jsonb_populate_record(p_b,CASE WHEN p_cor.tip='storno_import' THEN jsonb_build_object('stare','anulata') ELSE p_cor.dupa END))
  $f$;
  CREATE FUNCTION public.fn_izo_cor_bucata_noua(p_cor public.izo_corectii) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT to_jsonb(jsonb_populate_record(NULL::public.magazie_bucati,(p_cor.dupa - 'document_intrare_id') || jsonb_build_object(
      'proiect_id',p_cor.proiect_id,'tip_material_id',public.fn_izo_tip_material(p_cor.dupa->>'tip_cod'),
      'cantitate',1,'um',CASE p_cor.dupa->>'tip_cod' WHEN 'teava' THEN 'm' ELSE 'buc' END,'provenienta','beneficiar',
      'sursa_receptie','manual','fara_packing_list',false,'stare','carantina','locatie_tip','depozit',
      'locatie_site_id',public.fn_izo_site_proiect(p_cor.proiect_id),'created_by',public.fn_izo_uid(),
      'atribute',jsonb_strip_nulls(jsonb_build_object('sursa','e3b','corectie_id',p_cor.id,'document_ref',p_cor.document_intrare_id)),
      'cod_bucata','AB','capat_stanga','A','capat_dreapta','B','lungime_calculata',false)))
  $f$;
  CREATE FUNCTION public.fn_izo_cor_miscare_asteptata(p_cor public.izo_corectii, p_b public.magazie_bucati) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_ev bigint; v_after public.magazie_bucati;
  BEGIN
    SELECT ev.id INTO v_ev FROM public.magazie_bucati_evenimente ev WHERE ev.document_tip='izo_corectie' AND ev.document_id=p_cor.id::text;
    v_after := jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_dupa(p_cor,p_b));
    RETURN to_jsonb(jsonb_populate_record(NULL::public.magazie_bucati_miscari,jsonb_build_object(
      'eveniment_id',v_ev,'proiect_id',p_cor.proiect_id,'bucata_id',p_b.id,
      'rol',CASE p_cor.tip WHEN 'camp' THEN 'corectat' WHEN 'gasit_nou' THEN 'nascut' WHEN 'storno_import' THEN 'anulat' ELSE 'stare' END,
      'stare_inainte',CASE WHEN p_cor.tip NOT IN ('camp','gasit_nou') THEN p_b.stare END,
      'stare_dupa',CASE WHEN p_cor.tip <> 'camp' THEN v_after.stare END,
      'din_loc',CASE WHEN p_cor.tip='gasit_recuperare' THEN public.fn_izo_cor_loc(p_b) END,
      'in_loc',CASE WHEN p_cor.tip IN ('gasit_recuperare','gasit_nou') THEN public.fn_izo_cor_loc(v_after) END,
      'lungime_mm',CASE WHEN p_cor.tip='gasit_nou' THEN p_b.lungime_mm WHEN p_cor.tip='camp' AND p_cor.dupa ? 'lungime_mm' THEN v_after.lungime_mm END,
      'inainte',CASE WHEN p_cor.tip='camp' THEN p_cor.inainte END,'dupa',CASE WHEN p_cor.tip='camp' THEN p_cor.dupa END)));
  END $f$;

  CREATE FUNCTION public.fn_izo_garda_corectie(p_tabel text, p_op text, p_old jsonb, p_new jsonb) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_ctx text[]; v_cor public.izo_corectii; v_ev bigint; v_b public.magazie_bucati; v_id bigint; v_exp jsonb;
    v_permise text[]; v_nou bigint; v_target text;
  BEGIN
    IF current_user <> 'izo_corectie_writer' OR coalesce(current_setting('izo.receptie_ctx',true),'') <> '' THEN
      RAISE EXCEPTION 'E3b: rôle / contexte incompatibile' USING ERRCODE='42501'; END IF;
    v_ctx := regexp_match(coalesce(current_setting('izo.corectie_ctx',true),''),
      '^([0-9]+)\|(camp|carantina_intrare|carantina_iesire|pierdut|gasit_recuperare|gasit_nou|pv|storno_import)\|([0-9]+)\|([0-9]+)\|([0-9]+)\|([0-9]*)$');
    IF v_ctx IS NULL OR v_ctx[1] <> txid_current()::text OR (v_ctx[2]='gasit_nou') <> (v_ctx[6]<>'') THEN
      RAISE EXCEPTION 'E3b: context absent / fals' USING ERRCODE='42501'; END IF;
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=v_ctx[3]::bigint;
    IF NOT FOUND OR v_cor.tip <> v_ctx[2] OR v_cor.proiect_id <> v_ctx[4]::bigint OR v_cor.versiune <> v_ctx[5]::bigint
      OR v_cor.stare <> 'propusa' THEN RAISE EXCEPTION 'E3b: corecția contextului diferă' USING ERRCODE='42501'; END IF;
    v_nou := nullif(v_ctx[6],'')::bigint;
    SELECT ev.id INTO v_ev FROM public.magazie_bucati_evenimente ev WHERE ev.document_tip='izo_corectie' AND ev.document_id=v_cor.id::text
      AND ev.proiect_id=v_cor.proiect_id;
    IF p_tabel='magazie_bucati_evenimente' AND p_op='INSERT' THEN
      v_exp := public.fn_izo_cor_eveniment_asteptat(v_cor);
      IF v_ev IS NOT NULL OR public.fn_izo_proiectie(p_new,public.fn_izo_coloane_ev()) IS DISTINCT FROM
        public.fn_izo_proiectie(v_exp,public.fn_izo_coloane_ev()) THEN
        RAISE EXCEPTION 'E3b: eveniment diferit' USING ERRCODE='42501'; END IF;
      RETURN true;
    END IF;
    IF v_ev IS NULL THEN RAISE EXCEPTION 'E3b: eveniment lipsă' USING ERRCODE='42501'; END IF;
    IF p_tabel='magazie_bucati' AND p_op='INSERT' AND v_cor.tip='gasit_nou' THEN
      IF (p_new->>'id')::bigint IS DISTINCT FROM v_nou OR (p_new->>'radacina_id')::bigint IS DISTINCT FROM v_nou
        OR p_new->>'uid' IS NULL OR p_new->>'server_ver' IS NULL
        OR EXISTS (SELECT 1 FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_ev)
        OR EXISTS (SELECT 1 FROM public.magazie_bucati b WHERE b.atribute->>'sursa'='e3b' AND b.atribute->>'corectie_id'=v_cor.id::text)
        OR public.fn_izo_proiectie(p_new,public.fn_izo_coloane_c()) IS DISTINCT FROM
          public.fn_izo_proiectie(public.fn_izo_cor_bucata_noua(v_cor),public.fn_izo_coloane_c()) THEN
        RAISE EXCEPTION 'E3b: bucată nouă diferită' USING ERRCODE='42501'; END IF;
      RETURN true;
    END IF;
    IF (p_tabel='magazie_bucati' AND p_op='UPDATE') OR (p_tabel='magazie_bucati_miscari' AND p_op='INSERT') THEN
      v_id := CASE p_tabel WHEN 'magazie_bucati' THEN (p_old->>'id')::bigint ELSE (p_new->>'bucata_id')::bigint END;
      SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=v_id;
      IF NOT FOUND OR v_b.proiect_id <> v_cor.proiect_id OR v_cor.tip='pv'
        OR (v_cor.tip='gasit_nou' AND (v_id IS DISTINCT FROM v_nou OR p_tabel='magazie_bucati'
          OR v_b.atribute->>'sursa' IS DISTINCT FROM 'e3b' OR v_b.atribute->>'corectie_id' IS DISTINCT FROM v_cor.id::text))
        OR (v_cor.tip='storno_import' AND NOT EXISTS (SELECT 1 FROM public.izo_corectii_bucati cb WHERE cb.corectie_id=v_cor.id AND cb.bucata_id=v_id))
        OR (v_cor.tip NOT IN ('gasit_nou','storno_import') AND v_id IS DISTINCT FROM v_cor.bucata_id) THEN
        RAISE EXCEPTION 'E3b: țintă străină' USING ERRCODE='42501'; END IF;
      IF v_cor.tip='camp' AND public.fn_izo_cor_inainte(v_cor) IS DISTINCT FROM v_cor.inainte THEN
        RAISE EXCEPTION 'E3b: bucata diferă de instantaneul camp' USING ERRCODE='42501'; END IF;
      IF v_cor.tip IN ('carantina_intrare','carantina_iesire','pierdut','gasit_recuperare')
        AND jsonb_build_object('stare',v_b.stare,'loc',public.fn_izo_cor_loc(v_b)) IS DISTINCT FROM (v_cor.inainte-'cauza') THEN
        RAISE EXCEPTION 'E3b: starea / locul diferă de instantaneu' USING ERRCODE='42501'; END IF;
      IF v_cor.tip='carantina_iesire' THEN
        v_target := public.fn_izo_cor_tinta_iesire(v_b);
        IF (v_target IS NOT NULL AND v_target IS DISTINCT FROM v_cor.dupa->>'stare')
          OR coalesce(v_cor.dupa->>'stare','') NOT IN ('sosit','receptionat') THEN
          RAISE EXCEPTION 'E3b: ținta ieșirii diferă' USING ERRCODE='42501'; END IF;
      END IF;
      IF p_tabel='magazie_bucati_miscari' THEN
        IF EXISTS (SELECT 1 FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_ev AND mis.bucata_id=v_id)
          OR public.fn_izo_proiectie(p_new,public.fn_izo_coloane_mis()) IS DISTINCT FROM
            public.fn_izo_proiectie(public.fn_izo_cor_miscare_asteptata(v_cor,v_b),public.fn_izo_coloane_mis()) THEN
          RAISE EXCEPTION 'E3b: mișcare diferită / repetată' USING ERRCODE='42501'; END IF;
      ELSE
        IF NOT EXISTS (SELECT 1 FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_ev AND mis.bucata_id=v_id)
          OR p_new->>'server_ver' IS NULL OR p_new->>'server_ver' IS NOT DISTINCT FROM p_old->>'server_ver'
          OR public.fn_izo_proiectie(p_new || jsonb_build_object('serie_canon',public.fn_izo_canon_serie(p_new->>'serie')),public.fn_izo_coloane_c())
            IS DISTINCT FROM public.fn_izo_proiectie(public.fn_izo_cor_bucata_dupa(v_cor,jsonb_populate_record(NULL::public.magazie_bucati,p_old)),public.fn_izo_coloane_c()) THEN
          RAISE EXCEPTION 'E3b: UPDATE bucată diferit / fără mișcare' USING ERRCODE='42501'; END IF;
      END IF;
      RETURN true;
    END IF;
    IF p_tabel='izo_documente_intrare' AND p_op='UPDATE' AND v_cor.tip='pv' THEN
      v_permise := ARRAY['pv_nr','pv_nr_canon','pv_data','versiune','updated_at','furnizor_canon','nr_document_canon'];
      IF (p_old->>'id')::bigint IS DISTINCT FROM v_cor.document_intrare_id OR p_old->>'stare' IS DISTINCT FROM 'confirmat'
        OR p_old->>'eveniment_pv_id' IS NULL OR public.fn_izo_proiectie(p_old,ARRAY['pv_nr','pv_nr_canon','pv_data','versiune']) IS DISTINCT FROM v_cor.inainte
        OR public.fn_izo_proiectie(p_new,ARRAY['pv_nr','pv_nr_canon','pv_data']) IS DISTINCT FROM v_cor.dupa
        OR (p_new->>'versiune')::bigint IS DISTINCT FROM (p_old->>'versiune')::bigint+1
        OR (p_new-v_permise) IS DISTINCT FROM (p_old-v_permise) THEN
        RAISE EXCEPTION 'E3b: UPDATE PV diferit' USING ERRCODE='42501'; END IF;
      RETURN true;
    END IF;
    IF p_tabel='izo_corectii' AND p_op='UPDATE' THEN
      IF (p_old->>'id')::bigint IS DISTINCT FROM v_cor.id OR p_new->>'stare' IS DISTINCT FROM 'aplicata'
        OR (p_new->>'versiune')::bigint IS DISTINCT FROM v_cor.versiune+1 OR (p_new->>'eveniment_id')::bigint IS DISTINCT FROM v_ev
        OR p_new->>'decis_de' IS DISTINCT FROM public.fn_izo_uid()::text OR p_new->>'decis_rol' IS DISTINCT FROM session_user::text
        OR p_new->>'decis_la' IS NULL THEN RAISE EXCEPTION 'E3b: aplicare diferită' USING ERRCODE='42501'; END IF;
      IF v_cor.tip='gasit_nou' AND ((p_new->>'bucata_id')::bigint IS DISTINCT FROM v_nou OR NOT EXISTS
        (SELECT 1 FROM public.magazie_bucati_miscari mis WHERE mis.eveniment_id=v_ev AND mis.bucata_id=v_nou AND mis.rol='nascut')) THEN
        RAISE EXCEPTION 'E3b: naștere lipsă' USING ERRCODE='42501'; END IF;
      RETURN true;
    END IF;
    RAISE EXCEPTION 'E3b: %.% refuzat',p_tabel,p_op USING ERRCODE='42501';
  EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
    RAISE EXCEPTION 'E3b: context / identificator invalid' USING ERRCODE='42501';
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_garda() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_cor public.izo_corectii; v_raw jsonb; v_cale text; v_uid uuid := public.fn_izo_uid();
    v_permise text[] := ARRAY['stare','versiune','decis_de','decis_rol','decis_la','motiv_decizie','eveniment_id'];
  BEGIN
    IF TG_OP IN ('DELETE','TRUNCATE') OR current_user NOT IN ('izo_cor_editor','izo_corectie_writer') THEN
      RAISE EXCEPTION 'E3b: scriere corecții refuzată' USING ERRCODE='42501'; END IF;
    IF TG_TABLE_NAME='izo_corectii_bucati' THEN
      IF TG_OP <> 'INSERT' OR current_user <> 'izo_corectie_writer' THEN
        RAISE EXCEPTION 'E3b: lista storno imutabilă' USING ERRCODE='42501'; END IF;
      SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=NEW.corectie_id;
      IF NOT FOUND OR v_cor.tip <> 'storno_import' OR v_cor.stare <> 'propusa'
        OR coalesce(current_setting('izo.corectie_ctx',true),'') <> ''
        OR NOT EXISTS (SELECT 1 FROM public.izo_importuri imp JOIN public.magazie_bucati_miscari mis ON mis.eveniment_id=imp.eveniment_id
          JOIN public.magazie_bucati b ON b.id=mis.bucata_id WHERE imp.proiect_id=v_cor.proiect_id AND imp.import_id=v_cor.import_id
          AND imp.stare='aplicat' AND mis.rol='nascut' AND b.id=NEW.bucata_id AND b.proiect_id=v_cor.proiect_id AND b.stare <> 'anulata')
        OR EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.bucata_id=NEW.bucata_id AND cor.stare='propusa') THEN
        RAISE EXCEPTION 'E3b: bucată storno neeligibilă' USING ERRCODE='42501'; END IF;
      RETURN NEW;
    END IF;
    IF TG_OP='INSERT' THEN
      v_cale := CASE current_user WHEN 'izo_cor_editor' THEN 'propunere' ELSE 'direct' END;
      IF NEW.stare IS DISTINCT FROM 'propusa' OR NEW.versiune IS DISTINCT FROM 1
        OR num_nonnulls(NEW.decis_de,NEW.decis_rol,NEW.decis_la,NEW.motiv_decizie,NEW.eveniment_id) <> 0
        OR (v_cale='direct' AND NEW.tip NOT IN ('camp','pv','storno_import'))
        OR (v_cale='propunere' AND NEW.tip IN ('pv','storno_import')) THEN
        RAISE EXCEPTION 'E3b: inserare în afara contractului' USING ERRCODE='42501'; END IF;
      IF NEW.inainte IS NOT NULL OR (NEW.cale IS NOT NULL AND NEW.cale <> v_cale) THEN
        RAISE EXCEPTION 'E3b: inainte/cale calculate de trigger' USING ERRCODE='22023'; END IF;
      NEW.cale := v_cale;
      IF (NEW.tip='storno_import' AND (session_user <> 'postgres' OR v_uid IS NOT NULL OR NEW.propus_de IS NULL))
        OR (NEW.tip <> 'storno_import' AND (v_uid IS NULL OR NEW.propus_de IS DISTINCT FROM v_uid))
        OR NEW.propus_rol IS DISTINCT FROM session_user::text OR NEW.propus_la IS NULL
        OR coalesce(current_setting('izo.corectie_ctx',true),'') <> '' OR coalesce(current_setting('izo.receptie_ctx',true),'') <> ''
        OR current_setting('izo.registru_tx',true)=txid_current()::text THEN
        RAISE EXCEPTION 'E3b: identitate / context inserare' USING ERRCODE='42501'; END IF;
      IF coalesce(public.fn_izo_nivel(NEW.proiect_id),'off') NOT IN ('stoc','montaj') THEN
        RAISE EXCEPTION 'E3b: proiect inactiv' USING ERRCODE='42501'; END IF;
      v_raw := NEW.dupa;
      NEW.dupa := public.fn_izo_cor_valideaza(NEW);
      NEW.inainte := public.fn_izo_cor_inainte(NEW);
      IF NEW.tip='pierdut' THEN NEW.inainte := NEW.inainte || jsonb_build_object('cauza',v_raw->>'cauza'); END IF;
      IF NEW.inainte IS NULL THEN RAISE EXCEPTION 'E3b: țintă absentă' USING ERRCODE='22023'; END IF;
      RETURN NEW;
    END IF;
    IF TG_OP <> 'UPDATE' OR OLD.stare <> 'propusa' OR NEW.versiune IS DISTINCT FROM OLD.versiune+1
      OR NEW.decis_rol IS DISTINCT FROM session_user::text OR NEW.decis_la IS NULL THEN
      RAISE EXCEPTION 'E3b: tranziție refuzată' USING ERRCODE='42501'; END IF;
    IF OLD.tip='gasit_nou' AND current_user='izo_corectie_writer' THEN v_permise := v_permise || ARRAY['bucata_id']; END IF;
    IF (to_jsonb(NEW)-v_permise) IS DISTINCT FROM (to_jsonb(OLD)-v_permise)
      OR (OLD.cale='propunere' AND (NEW.decis_de IS NULL OR NEW.decis_de IS DISTINCT FROM v_uid
        OR (NEW.stare IN ('aplicata','respinsa') AND NEW.decis_de IS NOT DISTINCT FROM OLD.propus_de)))
      OR (OLD.cale='direct' AND (NEW.stare <> 'aplicata' OR NEW.decis_de IS DISTINCT FROM v_uid
        OR (OLD.tip <> 'storno_import' AND NEW.decis_de IS DISTINCT FROM OLD.propus_de)
        OR (OLD.tip='storno_import' AND (NEW.decis_de IS NOT NULL OR session_user <> 'postgres')))) THEN
      RAISE EXCEPTION 'E3b: coloane imutabile / patru ochi' USING ERRCODE='42501'; END IF;
    IF current_user='izo_cor_editor' THEN
      IF OLD.cale <> 'propunere' OR NEW.stare NOT IN ('respinsa','retrasa') OR NEW.eveniment_id IS NOT NULL
        OR NEW.motiv_decizie IS NULL OR char_length(btrim(NEW.motiv_decizie)) NOT BETWEEN 3 AND 1000 THEN
        RAISE EXCEPTION 'E3b: decizie editor refuzată' USING ERRCODE='42501'; END IF;
    ELSE
      IF NEW.motiv_decizie IS DISTINCT FROM OLD.motiv_decizie THEN RAISE EXCEPTION 'E3b: motiv imutabil' USING ERRCODE='42501'; END IF;
      PERFORM public.fn_izo_garda_corectie(TG_TABLE_NAME,TG_OP,to_jsonb(OLD),to_jsonb(NEW));
    END IF;
    RETURN NEW;
  END $f$;
@@GARZI_NOI@@
@@ACL_GARDA@@
@@GRANTURI@@
  CREATE TRIGGER trg_izo_cor_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_corectii
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_cor_garda();
  CREATE TRIGGER trg_izo_cor_truncate BEFORE TRUNCATE ON public.izo_corectii
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_cor_garda();
  CREATE TRIGGER trg_izo_cor_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_corectii_bucati
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_cor_garda();
  CREATE TRIGGER trg_izo_cor_truncate BEFORE TRUNCATE ON public.izo_corectii_bucati
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_cor_garda();
  ALTER TABLE public.izo_corectii ENABLE ALWAYS TRIGGER trg_izo_cor_garda;
  ALTER TABLE public.izo_corectii ENABLE ALWAYS TRIGGER trg_izo_cor_truncate;
  ALTER TABLE public.izo_corectii_bucati ENABLE ALWAYS TRIGGER trg_izo_cor_garda;
  ALTER TABLE public.izo_corectii_bucati ENABLE ALWAYS TRIGGER trg_izo_cor_truncate;
@@OPERATII@@
@@STORNO@@
@@ISTORIC@@

  -- Inventarul catalogului. Corpuri/config/ACL fn_izo_* sunt și în porti=.
  CREATE FUNCTION public.fn_izo_porti_e3b_definitii() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT md5(concat_ws(' | ',
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s',pr.oid::regprocedure,pg_get_userbyid(pr.proowner),pr.prosecdef,
        pr.provolatile,pr.proconfig,pr.proacl,md5(pr.prosrc)),',' ORDER BY pr.oid::regprocedure::text)
        FROM pg_proc pr WHERE pr.pronamespace='public'::regnamespace AND pr.proname=ANY(@@NUME_FN_B@@)),
      (SELECT string_agg(format('%s:%s:%s:%s:%s', c.relname, pg_get_userbyid(c.relowner), c.relacl::text,
        c.relrowsecurity, c.relforcerowsecurity), ',' ORDER BY c.relname)
        FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN
          ('izo_corectii','izo_corectii_bucati','izo_documente_istoric','magazie_bucati','magazie_bucati_evenimente',
           'magazie_bucati_miscari','izo_documente_intrare','izo_importuri','izo_corectii_id_seq','izo_documente_istoric_id_seq',
           'magazie_bucati_id_seq','izo_server_ver_seq','magazie_bucati_evenimente_id_seq','magazie_bucati_miscari_id_seq')),
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s', c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
          coalesce(a.attacl::text,''),coalesce(pg_get_expr(d.adbin,d.adrelid),'')), ',' ORDER BY c.relname,a.attnum)
        FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped AND c.relname IN
          ('izo_corectii','izo_corectii_bucati','izo_documente_istoric','magazie_bucati','magazie_bucati_evenimente',
           'magazie_bucati_miscari','izo_documente_intrare','izo_importuri')),
      (SELECT string_agg(pg_get_indexdef(i.oid), ',' ORDER BY i.relname) FROM pg_class i
        WHERE i.relnamespace='public'::regnamespace AND i.relname IN ('ux_magbuc_ev_corectie','ux_izo_cor_deschisa',
          'izo_documente_istoric_document_id_versiune_key','ux_magbuc_izo_radacina','ux_magbuc_izo_frunza','ux_magbuc_izo_curba')),
      (SELECT string_agg(format('%s:%s:%s', c.conrelid::regclass,c.conname,pg_get_constraintdef(c.oid)), ',' ORDER BY c.conrelid::regclass::text,c.conname)
        FROM pg_constraint c WHERE c.conrelid IN ('public.izo_corectii'::regclass,'public.izo_corectii_bucati'::regclass,
          'public.izo_documente_istoric'::regclass) OR (c.conrelid='public.magazie_bucati_evenimente'::regclass AND c.conname='magbuc_ev_e3b_motiv')),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', p.polrelid::regclass,p.polname,p.polcmd,p.polpermissive,
          (SELECT string_agg(pg_get_userbyid(x), ',' ORDER BY pg_get_userbyid(x)) FROM unnest(p.polroles) x),
          pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)), ',' ORDER BY p.polrelid::regclass::text,p.polname)
        FROM pg_policy p WHERE p.polrelid IN ('public.izo_corectii'::regclass,'public.izo_corectii_bucati'::regclass,
          'public.izo_documente_istoric'::regclass) OR p.polname LIKE '%\_corectie\_%' OR p.polname LIKE '%\_coreditor\_%'),
      (SELECT string_agg(format('%s:%s:%s',g.tgrelid::regclass,pg_get_triggerdef(g.oid,false),g.tgenabled), ',' ORDER BY g.tgrelid::regclass::text,g.tgname)
        FROM pg_trigger g WHERE NOT g.tgisinternal AND g.tgrelid IN ('public.izo_corectii'::regclass,'public.izo_corectii_bucati'::regclass,'public.izo_documente_istoric'::regclass)),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s:%s:%s',r.rolname,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreatedb,
          r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolconfig), ',' ORDER BY r.rolname)
        FROM pg_roles r WHERE r.rolname IN ('izo_cor_editor','izo_corectie_writer')),
      (SELECT string_agg(format('%s:%s:%s:%s:%s',pg_get_userbyid(m.roleid),pg_get_userbyid(m.member),m.admin_option,m.inherit_option,m.set_option),
          ',' ORDER BY pg_get_userbyid(m.roleid),pg_get_userbyid(m.member),m.admin_option,m.inherit_option,m.set_option)
        FROM pg_auth_members m WHERE m.roleid IN ('izo_cor_editor'::regrole,'izo_corectie_writer'::regrole)
          OR m.member IN ('izo_cor_editor'::regrole,'izo_corectie_writer'::regrole))))
  $f$;
  CREATE FUNCTION public.fn_izo_porti_e3b_lipsa() RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v text[] := '{}'; r record;
  BEGIN
    IF public.fn_izo_porti_e3b_definitii() IS DISTINCT FROM
      substring(obj_description('public.fn_izo_porti_e3b_definitii()'::regprocedure,'pg_proc') FROM '^porti_e3b=([0-9a-f]{32})$') THEN
      v := array_append(v,'definițiile E3b diferă de ștampilă');
    END IF;
    FOR r IN SELECT n FROM unnest(ARRAY['izo_cor_editor','izo_corectie_writer']) n LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r.n AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
          AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=r.n::regrole AND (member<>'postgres'::regrole OR inherit_option))
        OR NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=r.n::regrole AND member='postgres'::regrole AND set_option)
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.n::regrole)
        OR has_schema_privilege(r.n,'public','CREATE')
        OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','authenticator']) a(x) WHERE pg_has_role(a.x,r.n,'MEMBER')) THEN
        v := array_append(v,'rol E3b ' || r.n);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['izo_corectii','izo_corectii_bucati','izo_documente_istoric']) t(n)
        LEFT JOIN pg_class c ON c.oid=to_regclass('public.' || t.n) WHERE c.relrowsecurity IS NOT TRUE) THEN
      v := array_append(v,'RLS E3b lipsă');
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.izo_corectii'::regclass,
        'public.izo_corectii_bucati'::regclass,'public.izo_documente_istoric'::regclass)) <> 4 THEN
      v := array_append(v,'număr trigger-e E3b diferit de patru (A+B)');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.izo_corectii'::regclass,
        'public.izo_corectii_bucati'::regclass,'public.izo_documente_istoric'::regclass) AND tgenabled <> 'A') THEN
      v := array_append(v,'trigger E3b fără ENABLE ALWAYS');
    END IF;
@@CHECK_ACL@@
    IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN unnest(ARRAY['anon','service_role']) api(n)
        WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn\_izo\_cor\_%' AND has_function_privilege(api.n,p.oid,'EXECUTE')) THEN
      v := array_append(v,'API poate executa helpere E3b');
    END IF;
    RETURN v;
  END $f$;
  REVOKE ALL ON FUNCTION public.fn_izo_porti_e3b_definitii(),public.fn_izo_porti_e3b_lipsa()
    FROM PUBLIC,anon,authenticated,service_role;
@@PORTI_NOUA@@

  -- §17.4 pașii 4 / 5 / 6. Lista finală este FIXĂ, calculată de generator.
@@IMPL_POST@@
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L','porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L','porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L','porti_e3=' || public.fn_izo_porti_e3_definitii());
@@IMPL_DUPA@@
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'Postcondiție E3b: porți incomplete %',v_lipsa; END IF;
  IF pg_get_indexdef('public.ux_magbuc_ev_corectie'::regclass) IS DISTINCT FROM
      'CREATE UNIQUE INDEX ux_magbuc_ev_corectie ON public.magazie_bucati_evenimente USING btree (document_id) WHERE (document_tip = ''izo_corectie''::text)'
     OR pg_get_indexdef('public.ux_izo_cor_deschisa'::regclass) IS DISTINCT FROM
      'CREATE UNIQUE INDEX ux_izo_cor_deschisa ON public.izo_corectii USING btree (bucata_id) WHERE ((stare = ''propusa''::text) AND (bucata_id IS NOT NULL))' THEN
    RAISE EXCEPTION 'Postcondiție E3b: indexurile nu corespund designului';
  END IF;
@@AMPRENTA@@
  IF v_amprenta IS NULL OR v_amprenta = v_inainte THEN RAISE EXCEPTION 'E3b: amprenta nouă invalidă'; END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',
    'E3b amprenta=' || v_amprenta || ' inainte_20261105a=' || v_inainte
    || ' porti_anterioare=' || v_porti || ' porti_e3_anterioare=' || v_porti_e3 || ' ‖ anterior: ' || v_comentariu);
  IF current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261105a_izometrie_e3b_corectii:' || txid_current() THEN
    RAISE EXCEPTION 'E3b: garda finală de livrare';
  END IF;
END
$migrare$;
