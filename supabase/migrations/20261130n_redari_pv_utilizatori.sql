-- PR1 juridic#040 / claude_context #1920, 05.11.2026.
-- Runner: ONE transaction, SET LOCAL gazpet.livrare_migrare = '20261130n_redari_pv_utilizatori:' || txid_current().
-- Fara DML business. Baseline din fisiere versionate; orice abatere live necesita review.
-- Nu se aplica inainte de DRY PostgreSQL 15+ si compararea baseline-ului la review.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true)
    IS DISTINCT FROM '20261130n_redari_pv_utilizatori:'||txid_current() THEN RAISE EXCEPTION 'PR1: garda start invalida'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE c LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION 'PR1: armare persistenta refuzata'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  -- Apply / rollback: PV table -> parcela -> detinator -> view. Same order as PV C DDL protections.
  LOCK TABLE public.red_procese_verbale, public.red_parcele, public.red_detinatori, public.red_v_tronson IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.red_procese_verbale'::regclass
    AND attname IN ('calitate_semnatar','calitate_document') AND NOT attisdropped)
    OR to_regprocedure('public.fn_red_parcela_acoperita_a(uuid)') IS NOT NULL
    OR to_regprocedure('public.fn_red_pv_calitate_semnatar()') IS NOT NULL THEN RAISE EXCEPTION 'PR1: obiecte deja existente'; END IF;
  -- Do not invent the historical role of a legacy signed PV from today's holder role.
  -- No automatic live backfill: require a separately reviewed historical reconstruction first.
  IF EXISTS (SELECT 1 FROM public.red_procese_verbale WHERE tip='A' AND stare='semnat') THEN
    RAISE EXCEPTION 'PR1: PV A semnate legacy; necesita backfill istoric revizuit, fara deducere din calitatea actuala'; END IF;
  PERFORM set_config('search_path','public, pg_temp',true);
END $pre$;
CREATE TEMP TABLE pr1_functii (sig text, corp text, definer boolean, vol text, acl text[]) ON COMMIT DROP;
INSERT INTO pr1_functii VALUES
    ('public.fn_red_adresa_cunoscuta(uuid)','55cb31fc3f291cb27bea16a2b9291146',true,'s',ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']),
    ('public.fn_red_pv_creeaza(text,uuid,uuid,integer)','28db364379220bbf55c595e511ea12e2',true,'v',ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) /* 20261129f_redari_pvb_coproprietari.sql */,
    ('public.fn_red_pv_b_semnare()','816a566e8f99e5e2cf172290eee9eaa9',false,'v',ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) /* 20261129f_redari_pvb_coproprietari.sql */,
    ('public.fn_red_pv_stare_tranzitie()','2d69244951387ad650e2b1ed91a19308',false,'v',ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) /* 20261129c_redari_pv_stari.sql */,
    ('public.fn_red_numar_document(text,text,integer)','002a8dbb14f9a69db48d0b4c0428fef0',true,'v',ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) /* 20261130l_redari_convocare_rezerva.sql */,
    ('public.fn_red_nivel()','21db8e5d4b69b7f19e571a7087c361ae',true,'s',ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) /* 20261126a_redari_teren.sql */,
    ('public.fn_red_legaturi()','d1912ec6514cba162babea3bcebdfb24',true,'v',ARRAY['postgres=X/postgres']) /* 20261129g_redari_tronson_optional.sql */,
    ('public.fn_red_jurnal()','41ab451b7fcb499a2284c9c82367069e',true,'v',ARRAY['postgres=X/postgres']) /* 20261130j_redari_mail_f1_schema.sql */,
    ('public.fn_red_pv_c_garda()','975e5501b2c9e4ceca85a84b3fd64f3d',false,'v',ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) /* 20261129d_redari_pv_c.sql */,
    ('public.fn_red_pv_c_creeaza(uuid,integer)','a4ddfd572dc9c22e4889fd6309d9a3ba',true,'v',ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) /* 20261129g_redari_tronson_optional.sql */,
    ('public.fn_red_pv_c_neacoperite(uuid,integer)','ad42b1c7c1e4be49a2ea99a5eca9e3dd',true,'v',ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) /* 20261129d_redari_pv_c.sql */;
DO $baseline$
DECLARE r record;
BEGIN
  -- Exact bodies exclude injected EXECUTE / inherited search_path, including two/three-hop callees:
  -- creeaza -> numar_document -> nivel -> auth.uid; guards -> nivel through RLS.
  FOR r IN SELECT * FROM pr1_functii LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid=to_regprocedure(r.sig) AND md5(p.prosrc)=r.corp AND p.prosecdef=r.definer
        AND p.provolatile::text=r.vol AND pg_get_userbyid(p.proowner)='postgres'
        AND l.lanname=CASE WHEN r.sig IN ('public.fn_red_nivel()','public.fn_red_adresa_cunoscuta(uuid)') THEN 'sql' ELSE 'plpgsql' END
        AND p.proconfig=CASE WHEN r.sig IN ('public.fn_red_pv_c_creeaza(uuid,integer)','public.fn_red_pv_c_neacoperite(uuid,integer)')
          THEN ARRAY['search_path=public, pg_temp','lock_timeout=5s'] ELSE ARRAY['search_path=public, pg_temp'] END
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)=r.acl)
    THEN RAISE EXCEPTION 'PR1: functie in afara baseline revizuit: %',r.sig; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='auth.uid()'::regprocedure
      AND md5(prosrc)='cdef18c69c4f4cbbced2eaf81e628b49' AND NOT prosecdef AND provolatile='s'
      AND proconfig IS NULL AND pg_get_userbyid(proowner)='supabase_auth_admin'
      AND proacl::text='{=X/supabase_auth_admin,supabase_auth_admin=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}') THEN
    RAISE EXCEPTION 'PR1: auth.uid baseline diferit'; END IF;
  FOR r IN SELECT * FROM (VALUES
    ('auth.role()','f31486fed08a7402e89d4aa71b0ad273',ARRAY['=X/supabase_auth_admin','dashboard_user=X/supabase_auth_admin','supabase_auth_admin=X/supabase_auth_admin']),
    ('auth.jwt()','2db09c3fc855ba90e71d3ae28cfadae3',ARRAY['=X/supabase_auth_admin','dashboard_user=X/supabase_auth_admin','postgres=X/supabase_auth_admin','supabase_auth_admin=X/supabase_auth_admin'])
  ) b(sig,corp,acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(r.sig)
      AND md5(p.prosrc)=r.corp AND l.lanname='sql' AND p.provolatile='s' AND NOT p.prosecdef
      AND p.proconfig IS NULL AND pg_get_userbyid(p.proowner)='supabase_auth_admin'
      AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)=r.acl) THEN
      RAISE EXCEPTION 'PR1: callee auth baseline diferit %',r.sig; END IF;
  END LOOP;
END $baseline$;
CREATE TEMP VIEW pr1_vedere_baseline WITH (security_invoker = on) AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       CASE WHEN EXISTS (SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id = p.id AND d.sters_la IS NULL)
             AND NOT EXISTS (
               SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id = p.id AND d.sters_la IS NULL
                 AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale pa
                   WHERE pa.parcela_id = p.id AND pa.detinator_id = d.id
                     AND pa.tip = 'A' AND pa.stare = 'semnat' AND pa.sters_la IS NULL)) THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;
CREATE TEMP VIEW pr1_stare_baseline WITH (security_invoker = on) AS
SELECT p.id AS parcela_id, d.id AS detinator_id, p.proiect_id, p.uat_id, u.uat3, u.nume AS uat_nume, p.id_parcela, p.tronson,
       d.nume, d.calitate, d.cota, d.decedat, c.adresa_cunoscuta,
       CASE o.stare_ordine
         WHEN 1 THEN 'PV_A_SEMNAT' WHEN 2 THEN 'PV_B_CONSTATARE' WHEN 3 THEN 'PV_TRIMIS_SPRE_SEMNARE' WHEN 4 THEN 'OBIECTII_DE_TRATAT'
         WHEN 5 THEN 'A_RASPUNS_FARA_OBIECTII' WHEN 6 THEN 'A_RASPUNS_PARTICIPA' WHEN 7 THEN 'CONVOCARE_RETURNATA' WHEN 8 THEN 'CONVOCAT_FARA_RASPUNS'
         WHEN 9 THEN 'EXPEDIAT_ASTEPTAM_AR' WHEN 10 THEN 'NEIDENTIFICAT_AFISARE' WHEN 11 THEN 'FARA_ADRESA_AFISARE' ELSE 'DE_CONVOCAT' END AS stare,
       o.stare_ordine,
       k.ultima_convocare_data, r.optiune AS ultimul_raspuns_optiune, r.data AS ultimul_raspuns_data,
       a.nr_pv AS pv_nr, a.stare AS pv_stare
  FROM public.red_parcele p
  JOIN public.red_detinatori d ON d.parcela_id = p.id AND d.sters_la IS NULL
  JOIN public.red_uat u ON u.id = p.uat_id
  LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
  LEFT JOIN LATERAL (
    SELECT pv.nr_pv, pv.stare FROM public.red_procese_verbale pv
     WHERE pv.detinator_id = d.id AND pv.tip = 'A' AND pv.sters_la IS NULL AND pv.stare <> 'anulat'
     ORDER BY CASE pv.stare WHEN 'semnat' THEN 1 WHEN 'trimis_spre_semnare' THEN 2 ELSE 3 END, pv.created_at DESC
     LIMIT 1) a ON true
  LEFT JOIN LATERAL (
    SELECT r1.optiune, r1.data FROM public.red_raspunsuri r1 WHERE r1.detinator_id = d.id
     ORDER BY r1.data DESC, r1.seq DESC LIMIT 1) r ON true
  CROSS JOIN LATERAL (
    SELECT max(cv.data_expediere) AS ultima_convocare_data,
           -- retur „neacoperit”: nicio convocare activă confirmată la/după data returului (sau a expedierii; fără nicio dată, orice
           -- confirmare contează) — aceeași regulă ca src/redari/stare.js
           coalesce(bool_or(cv.retur IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.red_convocari c2
              WHERE c2.detinator_id = d.id AND c2.stare = 'activ' AND c2.sters_la IS NULL AND c2.data_confirmare_primire IS NOT NULL
                AND (coalesce(cv.retur_data, cv.data_expediere) IS NULL OR c2.data_confirmare_primire >= coalesce(cv.retur_data, cv.data_expediere)))), false) AS returnata,
           coalesce(bool_or(cv.data_confirmare_primire IS NOT NULL), false) AS confirmata,
           coalesce(bool_or(cv.data_expediere IS NOT NULL AND cv.data_confirmare_primire IS NULL AND cv.retur IS NULL), false) AS expediata
      FROM public.red_convocari cv WHERE cv.detinator_id = d.id AND cv.stare = 'activ' AND cv.sters_la IS NULL) k
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN a.stare = 'semnat' THEN 1
      WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.sters_la IS NULL AND pb.stare <> 'anulat') THEN 2
      WHEN a.stare = 'trimis_spre_semnare' THEN 3
      WHEN r.optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN 4
      WHEN r.optiune = 'nu_particip_fara_obiectii' THEN 5
      WHEN r.optiune = 'particip' THEN 6
      WHEN k.returnata THEN 7
      WHEN k.confirmata THEN 8
      WHEN k.expediata THEN 9
      WHEN d.calitate = 'neidentificat' THEN 10
      WHEN coalesce(public.fn_red_adresa_cunoscuta(d.id), false) = false THEN 11
      ELSE 12 END AS stare_ordine) o
 WHERE p.sters_la IS NULL;
DO $view$
BEGIN
  IF pg_get_viewdef('public.red_v_stare_parcela'::regclass,true) IS DISTINCT FROM pg_get_viewdef('pg_temp.pr1_stare_baseline'::regclass,true) THEN
    RAISE EXCEPTION 'PR1: vedere tranzitiva baseline diferit'; END IF;
  IF pg_get_viewdef('public.red_v_tronson'::regclass,true) IS DISTINCT FROM pg_get_viewdef('pg_temp.pr1_vedere_baseline'::regclass,true)
    OR NOT coalesce((SELECT reloptions=ARRAY['security_invoker=on'] AND pg_get_userbyid(relowner)='postgres'
      FROM pg_class WHERE oid='public.red_v_tronson'::regclass),false) THEN RAISE EXCEPTION 'PR1: vedere baseline diferit'; END IF;
END $view$;
-- Capture preservation metadata only AFTER validating the allow-listed baseline.
CREATE TEMP TABLE pr1_meta ON COMMIT DROP AS
SELECT 'view' AS k, jsonb_build_array(c.relowner,c.relacl,
  (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attcollation,a.attacl) ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) AS v
FROM pg_class c WHERE c.oid='public.red_v_tronson'::regclass
UNION ALL
SELECT 'functions',jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.proconfig,p.prosecdef) ORDER BY p.oid)
FROM pg_proc p WHERE p.oid IN ('public.fn_red_pv_creeaza(text,uuid,uuid,integer)'::regprocedure,'public.fn_red_pv_b_semnare()'::regprocedure);
DO $tables$
DECLARE t text; r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['red_procese_verbale','red_parcele','red_detinatori'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=('public.'||t)::regclass AND relrowsecurity AND NOT relforcerowsecurity) THEN
      RAISE EXCEPTION 'PR1: RLS baseline diferit %',t; END IF;
  END LOOP;
  -- All policies on these three tables are exactly sel/ins/upd, authenticated, permissive (30g).
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_procese_verbale','red_parcele','red_detinatori')) <> 9 THEN
    RAISE EXCEPTION 'PR1: politici suplimentare/lipsa'; END IF;
  FOR r IN SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_procese_verbale','red_parcele','red_detinatori') LOOP
    IF r.roles IS DISTINCT FROM ARRAY['authenticated']::name[] OR r.permissive IS DISTINCT FROM 'PERMISSIVE'
      OR r.cmd NOT IN ('SELECT','INSERT','UPDATE')
      OR (r.cmd='SELECT' AND (r.with_check IS NOT NULL OR r.qual IS DISTINCT FROM '(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)'))
      OR (r.cmd='INSERT' AND (r.qual IS NOT NULL OR r.with_check IS DISTINCT FROM '(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))'))
      OR (r.cmd='UPDATE' AND (r.qual IS DISTINCT FROM '(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))'
        OR r.with_check IS DISTINCT FROM r.qual)) THEN RAISE EXCEPTION 'PR1: politica baseline diferita %',r.policyname; END IF;
  END LOOP;
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.red_v_tronson'::regclass AND attnum>0 AND NOT attisdropped)
    IS DISTINCT FROM ARRAY['proiect_id','tronson','uat_id','uat3','parcela_id','id_parcela','suprafata_temporara_mp','articol_deviz','cantitate','tip_pv','obiectii_deschise'] THEN
    RAISE EXCEPTION 'PR1: coloane vedere incompatibile'; END IF;
  -- Full PV trigger inventory, incl. WHEN, function binding, UPDATE OF columns and enabled status.
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.red_procese_verbale'::regclass AND NOT t.tgisinternal
    AND NOT (t.tgenabled='O' AND t.tgqual IS NULL AND (
      (t.tgname='red_pv_b_semnare' AND t.tgfoid='public.fn_red_pv_b_semnare()'::regprocedure AND t.tgtype=19
        AND t.tgattr::text=(SELECT attnum::text FROM pg_attribute WHERE attrelid=t.tgrelid AND attname='stare'))
      OR (t.tgname='red_pv_stare_tranzitie' AND t.tgfoid='public.fn_red_pv_stare_tranzitie()'::regprocedure AND t.tgtype=19 AND t.tgattr::text='')
      OR (t.tgname='trg_red_legaturi' AND t.tgfoid='public.fn_red_legaturi()'::regprocedure AND t.tgtype=23 AND t.tgattr::text='')
      OR (t.tgname='red_pv_c_garda' AND t.tgfoid='public.fn_red_pv_c_garda()'::regprocedure AND t.tgtype=23 AND t.tgattr::text='')
      OR (t.tgname='trg_red_jurnal' AND t.tgfoid='public.fn_red_jurnal()'::regprocedure AND t.tgtype=29 AND t.tgattr::text='')
    ))) OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.red_procese_verbale'::regclass AND NOT tgisinternal) <> 5 THEN
    RAISE EXCEPTION 'PR1: triggere PV baseline diferit'; END IF;
END $tables$;
ALTER TABLE public.red_procese_verbale ADD COLUMN calitate_semnatar text
  CONSTRAINT red_pv_calitate_semnatar_ck CHECK (
    (tip='A' AND (stare <> 'semnat' OR calitate_semnatar IS NOT NULL) AND (calitate_semnatar IS NULL OR calitate_semnatar IN ('proprietar','coproprietar','mostenitor','neidentificat','utilizator','arendas')))
    OR (tip<>'A' AND calitate_semnatar IS NULL));
ALTER TABLE public.red_procese_verbale ADD COLUMN calitate_document text
  CONSTRAINT red_pv_calitate_document_ck CHECK (
    (tip='A' AND (calitate_document IS NULL OR calitate_document IN ('proprietar','coproprietar','mostenitor','neidentificat','utilizator','arendas'))
      AND (stare <> 'semnat' OR (calitate_document IS NOT NULL AND calitate_document=calitate_semnatar)))
    OR (tip<>'A' AND calitate_document IS NULL));
COMMENT ON COLUMN public.red_procese_verbale.calitate_document IS 'Server: rol verificat sub lock la legarea fiecarei versiuni DOCX, apoi concordanta obligatorie la semnare.';
COMMENT ON COLUMN public.red_procese_verbale.calitate_semnatar IS 'Server: calitatea curenta la fiecare scriere PV A nesemnat, inclusiv regenerare/semnare; apoi imutabila. Legacy nesemnat se completeaza la semnare.';
CREATE FUNCTION public.fn_red_parcela_acoperita_a(p_parcela uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.red_procese_verbale a
    WHERE a.parcela_id=p_parcela AND a.tip='A' AND a.stare='semnat' AND a.sters_la IS NULL
      AND a.calitate_semnatar IN ('utilizator','arendas')
  ) OR (
    EXISTS (SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id=p_parcela AND d.sters_la IS NULL
      AND d.calitate NOT IN ('utilizator','arendas'))
    AND NOT EXISTS (
      SELECT 1 FROM public.red_detinatori d WHERE d.parcela_id=p_parcela AND d.sters_la IS NULL
        AND d.calitate NOT IN ('utilizator','arendas')
        AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a WHERE a.parcela_id=p_parcela
          AND a.detinator_id=d.id AND a.tip='A' AND a.stare='semnat' AND a.sters_la IS NULL)
    )
  );
$fn$;
REVOKE ALL ON FUNCTION public.fn_red_parcela_acoperita_a(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_parcela_acoperita_a(uuid) TO authenticated, service_role;
CREATE FUNCTION public.fn_red_pv_calitate_semnatar() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
DECLARE v_calitate text; v_generare boolean := false;
BEGIN
  -- Nicio cale INSERT (inclusiv PostgREST) nu poate sari cerintele tranzitiei de semnare.
  IF TG_OP='INSERT' AND NEW.stare IS DISTINCT FROM 'generat' THEN
    RAISE EXCEPTION 'PV: INSERT permis numai in starea generat' USING ERRCODE='23514';
  END IF;
  IF NEW.stare='semnat' AND (TG_OP='INSERT' OR OLD.stare IS DISTINCT FROM 'semnat')
     AND NEW.sters_la IS NOT NULL THEN
    RAISE EXCEPTION 'PV: un PV sters nu poate fi semnat' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    NEW.calitate_document := NULL;
  ELSE
    v_generare := NEW.tip='A' AND NEW.fisier_generat_path IS DISTINCT FROM OLD.fisier_generat_path;
    IF NEW.calitate_document IS DISTINCT FROM OLD.calitate_document AND NOT v_generare THEN
      RAISE EXCEPTION 'PV: calitatea documentului se scrie numai la generare' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND OLD.stare IN ('semnat','anulat') THEN
    IF NEW.calitate_semnatar IS DISTINCT FROM OLD.calitate_semnatar THEN
      RAISE EXCEPTION 'Calitatea semnatarului este inghetata' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.calitate_semnatar IS DISTINCT FROM OLD.calitate_semnatar THEN
    RAISE EXCEPTION 'Calitatea semnatarului se completeaza numai de server' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND v_generare AND (NEW.stare='anulat' OR NEW.sters_la IS NOT NULL) THEN
    RAISE EXCEPTION 'PV: un PV anulat sau sters nu poate fi regenerat' USING ERRCODE='23514';
  END IF;
  -- Draftul urmeaza calitatea curenta la fiecare scriere, inclusiv legarea DOCX regenerat.
  -- Anularea nu depinde de disponibilitatea detinatorului; snapshot-ul existent ramane.
  IF NEW.tip='A' AND NEW.stare <> 'anulat' AND NEW.sters_la IS NULL THEN
    -- Aceeasi ordine ca 20261129f: PV (UPDATE) -> parcela -> detinator.
    -- La creare RPC, parcela si detinatorul sunt deja blocate de apelant.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'PV: operatia necesita READ COMMITTED' USING ERRCODE='25001';
    END IF;
    PERFORM 1 FROM public.red_parcele WHERE id=NEW.parcela_id AND sters_la IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PV: parcela indisponibila pentru blocare' USING ERRCODE='42501'; END IF;
    SELECT d.calitate INTO v_calitate FROM public.red_detinatori d
      WHERE d.id=NEW.detinator_id AND d.parcela_id=NEW.parcela_id AND d.sters_la IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PV: detinator indisponibil' USING ERRCODE='42501'; END IF;
    IF NEW.stare='semnat' AND OLD.stare IS DISTINCT FROM 'semnat' THEN
      -- Semnarea nu poate servi drept regenerare; scanul trebuie sa apartina versiunii deja generate.
      IF NEW.fisier_generat_path IS DISTINCT FROM OLD.fisier_generat_path
         OR OLD.fisier_generat_path IS NULL OR OLD.fisier_generat_path !~ '[^[:space:]]'
         OR OLD.calitate_document IS DISTINCT FROM v_calitate THEN
        RAISE EXCEPTION 'PV: calitatea s-a schimbat dupa generare - regenereaza documentul si semneaza noua versiune' USING ERRCODE='23514';
      END IF;
      NEW.calitate_semnatar := OLD.calitate_document;
    ELSE
      IF v_generare THEN
        -- Clientul transmite rolul folosit efectiv in DOCX ca preconditie, nu ca provenienta libera.
        -- Serverul il compara cu sursa blocata si scrie propria valoare, atomic cu noua cale.
        IF NEW.fisier_generat_path IS NULL OR NEW.fisier_generat_path !~ '[^[:space:]]'
           OR NEW.calitate_document IS DISTINCT FROM v_calitate THEN
          RAISE EXCEPTION 'PV: calitatea s-a schimbat in timpul generarii - regenereaza documentul' USING ERRCODE='23514';
        END IF;
        NEW.calitate_document := v_calitate;
      END IF;
      NEW.calitate_semnatar := v_calitate;
    END IF;
  ELSIF TG_OP='INSERT' THEN
    NEW.calitate_semnatar := NULL;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_red_pv_calitate_semnatar() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER red_pv_aa_calitate BEFORE INSERT OR UPDATE ON public.red_procese_verbale
FOR EACH ROW EXECUTE FUNCTION public.fn_red_pv_calitate_semnatar();
CREATE OR REPLACE FUNCTION public.fn_red_pv_creeaza(p_tip text, p_parcela_id uuid, p_detinator_id uuid, p_tronson int)
RETURNS public.red_procese_verbale
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE p public.red_parcele; d public.red_detinatori; r public.red_procese_verbale; cod text;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(),'') NOT IN ('admin','editor') THEN
    RAISE EXCEPTION 'redari: creare PV doar admin/editor' USING ERRCODE='42501';
  END IF;
  IF p_tip = 'C' THEN RAISE EXCEPTION 'PV C: foloseste fn_red_pv_c_creeaza'; END IF;
  IF p_tip IS NULL OR p_tip NOT IN ('A','B') THEN RAISE EXCEPTION 'redari: tip PV invalid'; END IF;
  -- Lock order: parcela -> detinator (A) -> counter in fn_red_numar_document.
  SELECT * INTO p FROM public.red_parcele WHERE id=p_parcela_id FOR UPDATE;
  IF NOT FOUND OR p.sters_la IS NOT NULL THEN RAISE EXCEPTION 'redari: parcela inexistenta sau stearsa' USING ERRCODE='P0002'; END IF;
  IF p_tip='A' THEN
    SELECT * INTO d FROM public.red_detinatori WHERE id=p_detinator_id FOR UPDATE;
    IF NOT FOUND OR d.sters_la IS NOT NULL OR d.parcela_id IS DISTINCT FROM p.id THEN
      RAISE EXCEPTION 'redari: detinator inactiv sau de pe alta parcela' USING ERRCODE='23503';
    END IF;
  ELSIF p_detinator_id IS NOT NULL THEN
    RAISE EXCEPTION 'redari: PV B nu are detinator' USING ERRCODE='23503';
  END IF;
  IF p_tip='B' AND public.fn_red_parcela_acoperita_a(p.id) IS TRUE THEN
    RAISE EXCEPTION 'redari: parcela acoperita prin PV A semnat; PV B nu este necesar' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_procese_verbale v WHERE v.tip=p_tip AND v.stare<>'anulat' AND v.sters_la IS NULL
    AND ((p_tip='A' AND v.detinator_id=p_detinator_id) OR (p_tip='B' AND v.parcela_id=p.id))) THEN
    RAISE EXCEPTION 'redari: exista deja un PV % activ; reincarca si deschide PV-ul existent',p_tip;
  END IF;
  SELECT u.uat3 INTO cod FROM public.red_uat u WHERE u.id=p.uat_id AND u.proiect_id=p.proiect_id;
  IF cod IS NULL THEN RAISE EXCEPTION 'redari: UAT incompatibil cu parcela' USING ERRCODE='23503'; END IF;
  INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,tronson,nr_pv,data_pv,stare)
  VALUES(p_tip,p.id,CASE WHEN p_tip='A' THEN d.id END,p.uat_id,p.tronson,
    public.fn_red_numar_document('PV'||p_tip,cod,NULL),(now() AT TIME ZONE 'Europe/Bucharest')::date,'generat')
  RETURNING * INTO r;
  RETURN r;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_red_pv_b_semnare() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
BEGIN
  -- Ordine 20261129f pastrata: UPDATE detine deja PV -> parcela FOR UPDATE.
  -- Creare RPC: parcela -> detinator (A) -> contor -> INSERT PV; fara lock pe alte PV-uri.
  -- INSERT direct este verificat la fel ca RPC; numai READ COMMITTED da snapshot nou dupa asteptare.
  IF NEW.tip IN ('A','B') AND (TG_OP='INSERT' OR
      (NEW.stare='semnat' AND OLD.stare IS DISTINCT FROM 'semnat')) THEN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'PV: operatia necesita READ COMMITTED' USING ERRCODE='25001';
    END IF;
    PERFORM 1 FROM public.red_parcele WHERE id=NEW.parcela_id AND sters_la IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PV: parcela indisponibila pentru blocare' USING ERRCODE='42501'; END IF;
    IF NEW.tip='B' AND public.fn_red_parcela_acoperita_a(NEW.parcela_id) IS TRUE THEN
      RAISE EXCEPTION 'PV B refuzat: parcela acoperita prin PV A semnat; anuleaza PV B' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER red_pv_b_semnare ON public.red_procese_verbale;
CREATE TRIGGER red_pv_b_semnare BEFORE INSERT OR UPDATE OF stare ON public.red_procese_verbale
FOR EACH ROW EXECUTE FUNCTION public.fn_red_pv_b_semnare();
CREATE OR REPLACE VIEW public.red_v_tronson WITH (security_invoker = on) AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       CASE WHEN public.fn_red_parcela_acoperita_a(p.id) IS TRUE THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES
    ('public.fn_red_parcela_acoperita_a(uuid)','b932aaf307761d3c504608a30c117bca'),
    ('public.fn_red_pv_calitate_semnatar()','c47235d62aedbf6b3efccba60702b95b'),
    ('public.fn_red_pv_creeaza(text,uuid,uuid,integer)','290f8f0c3ba78d8499db7ef50d0d8bcd'),
    ('public.fn_red_pv_b_semnare()','728fc279beee0b34f9adcfb425b2dd9f')
  ) b(sig,corp) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(b.sig)
    WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM b.corp OR pg_get_userbyid(p.proowner)<>'postgres'
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'PR1: corp/metadate functie noua diferite'; END IF;
  IF (SELECT jsonb_build_array(c.relowner,c.relacl,
    (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attcollation,a.attacl) ORDER BY a.attnum)
     FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))
    FROM pg_class c WHERE c.oid='public.red_v_tronson'::regclass) IS DISTINCT FROM (SELECT v FROM pr1_meta WHERE k='view')
    OR NOT coalesce((SELECT 'security_invoker=on'=ANY(reloptions) FROM pg_class WHERE oid='public.red_v_tronson'::regclass),false) THEN
    RAISE EXCEPTION 'PR1 post: vedere coloane/ACL/security_invoker schimbate'; END IF;
  IF (SELECT jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.proconfig,p.prosecdef) ORDER BY p.oid)
    FROM pg_proc p WHERE p.oid IN ('public.fn_red_pv_creeaza(text,uuid,uuid,integer)'::regprocedure,'public.fn_red_pv_b_semnare()'::regprocedure))
    IS DISTINCT FROM (SELECT v FROM pr1_meta WHERE k='functions') THEN RAISE EXCEPTION 'PR1 post: RPC metadata schimbata'; END IF;
  IF NOT has_column_privilege('authenticated','public.red_procese_verbale','calitate_semnatar','SELECT')
    OR NOT has_column_privilege('authenticated','public.red_procese_verbale','calitate_document','SELECT')
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.red_procese_verbale'::regclass AND conname IN ('red_pv_calitate_semnatar_ck','red_pv_calitate_document_ck') AND convalidated) <> 2 THEN
    RAISE EXCEPTION 'PR1 post: coloana/CHECK lipsa'; END IF;
  IF has_function_privilege('anon','public.fn_red_parcela_acoperita_a(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.fn_red_parcela_acoperita_a(uuid)','EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='red_pv_aa_calitate' AND tgrelid='public.red_procese_verbale'::regclass
      AND tgfoid='public.fn_red_pv_calitate_semnatar()'::regprocedure AND tgenabled='O' AND tgtype=23)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='red_pv_b_semnare' AND tgrelid='public.red_procese_verbale'::regclass
      AND tgfoid='public.fn_red_pv_b_semnare()'::regprocedure AND tgenabled='O' AND tgtype=23)
    THEN RAISE EXCEPTION 'PR1 post: helper/trigger lipsa'; END IF;
END $post$;
DROP VIEW pg_temp.pr1_vedere_baseline;
DROP VIEW pg_temp.pr1_stare_baseline;
DROP TABLE pg_temp.pr1_functii,pg_temp.pr1_meta;
