-- GENERAT de scripts/izometrie/e3b_gen/gen_e3b.py. NU se editează manual.
-- 20261105a: E3b piesa A, infrastructură (§2, §3.1/3.5/3.6).
-- Design r5: toate Q-E3b-1..18 = A. Operațiile și gărzile vin în B/C/D.
-- Numai runner; nicio modificare de date. Nu este încă implementarea operațională E3b.
DO $migrare$
DECLARE v_amprenta text; v_scrisa text; v_inainte text; v_comentariu text;
  v_lipsa text[]; v_impl text[]; v_impl_rev text[]; v_x text; r record;
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
  FOR r IN SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('authenticator','authenticated') LOOP
    RAISE NOTICE 'E3b timeout-uri de rol (nu efective): % %', r.rolname, r.rolconfig;
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
@@GRANTURI@@

  -- PIESA B/C/D: GRANT-uri (numai după CREATE; semnăturile din §1 / §3.5).
  -- B: garda_corectie, cor_eveniment_asteptat, cor_miscare_asteptata,
  -- cor_bucata_dupa/noua -> writer; cor_marcheaza INVOKER -> numai owner.
  -- B/D: cor_garda și doc_ist_garda -> trigger-e ALWAYS (inclusiv TRUNCATE),
  -- fără EXECUTE pentru PUBLIC/anon/authenticated/service_role.
  -- B: cor_autorizare_lock -> editor/writer; cor_cerut_de_valid -> writer;
  -- cor_bucata_lock(bigint,bigint), cor_doc_lock(bigint,bigint) -> editor;
  -- cor_api_verifica -> editor/writer; cor_adm_verifica -> writer;
  -- cor_inainte, cor_tinta_iesire, cor_valideaza -> editor/writer.
  -- C: propune/retrage/respinge/verifica/aproba/camp/pv -> authenticated;
  -- cor_storno_import -> postgres (niciodată authenticated).
  -- D: doc_instantaneu/doc_diff -> izo_doc_editor; lant_blocant ->
  -- izo_corectie_writer/izo_registru_writer/izo_receptie_writer (Q1=A);
  -- cor_deschise(bigint[]) -> izo_registru_writer/izo_receptie_writer (Q1=A).
  -- Fără GRANT nou pe fn_izo_doc_api_verifica.
@@GARDA@@
@@OPERATII@@
@@STORNO@@
@@ISTORIC@@

  -- Inventarul catalogului. Corpuri/config/ACL fn_izo_* sunt și în porti=.
  CREATE FUNCTION public.fn_izo_porti_e3b_definitii() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT md5(concat_ws(' | ',
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
        OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','authenticator']) a(x) WHERE pg_has_role(a.x,r.n,'MEMBER')) THEN
        v := array_append(v,'rol E3b ' || r.n);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['izo_corectii','izo_corectii_bucati','izo_documente_istoric']) t(n)
        LEFT JOIN pg_class c ON c.oid=to_regclass('public.' || t.n) WHERE c.relrowsecurity IS NOT TRUE) THEN
      v := array_append(v,'RLS E3b lipsă');
    END IF;
    -- B/C/D adaugă aici numărul exact al trigger-elor ALWAYS, odată cu CREATE.
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
