-- GENERATED. Refuses any E4b facts; restores exact E4a body and all stamps.
DO $revenire$
DECLARE v_amprenta text; v_scrisa text; v_impl text[]; v_lipsa text[]; v_meta jsonb; v_t text; v_count bigint;
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.revenire_20261109b',true)
  IS DISTINCT FROM 'IZO_E4B_SCOATE:'||txid_current() THEN RAISE EXCEPTION 'E4b revenire nearmata'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 LOCK TABLE public.magazie_bucati_evenimente IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip IN ('izo_declaratie','izo_iesire','izo_primire')) THEN
  RAISE EXCEPTION 'E4b date existente: fapte registru; rollback refuzat'; END IF;
 FOREACH v_t IN ARRAY ARRAY['izo_fronturi', 'izo_dispozitive', 'izo_preverificari', 'izo_declaratii', 'izo_bucati_declarate', 'izo_rezervari', 'izo_operatii', 'izo_declaratii_versiuni', 'izo_declaratii_gps', 'izo_sync_incercari', 'izo_rata_apeluri', 'izo_aprobari']::text[] LOOP
  EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',v_t);
  EXECUTE format('SELECT count(*) FROM public.%I',v_t) INTO v_count;
  IF v_count<>0 THEN RAISE EXCEPTION 'E4b date existente: %; rollback refuzat',v_t; END IF;
 END LOOP;
 v_lipsa:=public.fn_izo_porti_lipsa(); IF cardinality(v_lipsa)>0 THEN RAISE EXCEPTION 'E4b porti %',v_lipsa; END IF;
 v_impl := (SELECT coalesce(array_agg(x.d ORDER BY x.d COLLATE "C"), '{}'::text[])
       FROM (SELECT DISTINCT format('%s|%s|%s', o.type, o.identity, f.identity) d
               FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid
                    CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
                    CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
              WHERE d.refclassid = 'pg_proc'::regclass AND q.pronamespace = 'public'::regnamespace AND q.proname LIKE 'fn\_izo\_%'
                AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass)) x); IF v_impl IS DISTINCT FROM ARRAY['policy|izo_aprobari_api_sel on public.izo_aprobari|public.fn_izo_citire(bigint)', 'policy|izo_atr_sel on public.izo_atribuiri|public.fn_izo_citire(bigint)', 'policy|izo_cfg_sel on public.izo_proiect_config|public.fn_izo_citire(bigint)', 'policy|izo_corectii_api_sel on public.izo_corectii|public.fn_izo_citire(bigint)', 'policy|izo_corectii_bucati_api_sel on public.izo_corectii_bucati|public.fn_izo_citire(bigint)', 'policy|izo_declaratii_api_sel on public.izo_declaratii|public.fn_izo_citire(bigint)', 'policy|izo_doc_api_sel on public.izo_documente_intrare|public.fn_izo_citire(bigint)', 'policy|izo_doc_scan_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_r_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_doc_scan_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_documente_istoric_api_sel on public.izo_documente_istoric|public.fn_izo_citire(bigint)', 'policy|izo_ev_corectie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_receptie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_sel on public.magazie_bucati_evenimente|public.fn_izo_citire(bigint)', 'policy|izo_ev_writer_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_flux_pdf_imuabil_del on storage.objects|public.fn_izo_flux_pdf_blocat(pg_catalog.text,pg_catalog.text)', 'policy|izo_flux_pdf_imuabil_upd on storage.objects|public.fn_izo_flux_pdf_blocat(pg_catalog.text,pg_catalog.text)', 'policy|izo_fronturi_api_sel on public.izo_fronturi|public.fn_izo_citire(bigint)', 'policy|izo_imp_sel on public.izo_importuri|public.fn_izo_citire(bigint)', 'policy|izo_mis_corectie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_receptie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_sel on public.magazie_bucati_miscari|public.fn_izo_citire(bigint)', 'policy|izo_mis_writer_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_operatii_api_sel on public.izo_operatii|public.fn_izo_citire(bigint)', 'policy|izo_preverificari_api_sel on public.izo_preverificari|public.fn_izo_citire(bigint)', 'policy|izo_rezervari_api_sel on public.izo_rezervari|public.fn_izo_citire(bigint)', 'policy|izo_sync_incercari_api_sel on public.izo_sync_incercari|public.fn_izo_citire(bigint)', 'policy|izo_tronson_config_api_sel on public.izo_tronson_config|public.fn_izo_citire(bigint)', 'policy|magbuc_izo_client_del on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_sel on public.magazie_bucati|public.fn_izo_citire(bigint)', 'policy|magbuc_izo_client_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'trigger|a0_izo_decl_ceas on public.izo_declaratii|public.fn_izo_decl_ceas()', 'trigger|a0_izo_flux_config on public.izo_tronson_config|public.fn_izo_flux_config_garda()', 'trigger|a0_izo_flux_documente on public.executie_pachete_documente|public.fn_izo_flux_garda()', 'trigger|a0_izo_flux_pachete on public.executie_pachete_lansare|public.fn_izo_flux_garda()', 'trigger|a0_izo_flux_pachete_dupa on public.executie_pachete_lansare|public.fn_izo_flux_pachet_dupa()', 'trigger|a0_izo_flux_tevi on public.executie_tevi|public.fn_izo_flux_garda()', 'trigger|a0_izo_flux_tronsoane on public.executie_tronsoane|public.fn_izo_flux_garda()', 'trigger|a0_izo_teren_delete on public.izo_aprobari|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_bucati_declarate|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_declaratii_gps|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_declaratii_versiuni|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_declaratii|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_dispozitive|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_fronturi|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_operatii|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_preverificari|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_rezervari|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_delete on public.izo_sync_incercari|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_aprobari|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_bucati_declarate|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_declaratii_gps|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_declaratii_versiuni|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_declaratii|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_dispozitive|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_fronturi|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_operatii|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_preverificari|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_rezervari|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_truncate on public.izo_sync_incercari|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_update on public.izo_aprobari|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_update on public.izo_declaratii_gps|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_update on public.izo_declaratii_versiuni|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_update on public.izo_operatii|public.fn_izo_teren_imuabil()', 'trigger|a0_izo_teren_update on public.izo_sync_incercari|public.fn_izo_teren_imuabil()', 'trigger|trg_bon_linii_izo_bucata on public.executie_bonuri_consum_linii|public.fn_izo_refuz_bon_bucata()', 'trigger|trg_depozite_izo_mutare on public.logistica_depozite|public.fn_izo_refuz_mutare_depozit()', 'trigger|trg_executie_tevi_izo_delete on public.executie_tevi|public.fn_izo_refuz_delete_tevi()', 'trigger|trg_executie_tevi_izo_mutare on public.executie_tevi|public.fn_izo_refuz_mutare_tevi()', 'trigger|trg_executie_tevi_izo_truncate on public.executie_tevi|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_izo_atr_garda on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_atr_truncate on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_cfg_garda on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cfg_truncate on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cor_garda on public.izo_corectii_bucati|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_garda on public.izo_corectii|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_truncate on public.izo_corectii_bucati|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_truncate on public.izo_corectii|public.fn_izo_cor_garda()', 'trigger|trg_izo_doc_garda on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_ist_garda on public.izo_documente_istoric|public.fn_izo_doc_ist_garda()', 'trigger|trg_izo_doc_ist_truncate on public.izo_documente_istoric|public.fn_izo_doc_ist_garda()', 'trigger|trg_izo_doc_rand_garda on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_truncate on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_garda on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_truncate on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_truncate on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_ev_garda on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_ev_truncate on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_garda on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_truncate on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_garda on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_truncate on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_magbuc_izo_garda on public.magazie_bucati|public.fn_izo_garda_bucati()', 'trigger|trg_magbuc_izo_truncate on public.magazie_bucati|public.fn_izo_garda_truncate_bucati()', 'trigger|trg_pachete_izo_delete on public.executie_pachete_lansare|public.fn_izo_refuz_delete_pachet()', 'trigger|trg_pachete_izo_mutare on public.executie_pachete_lansare|public.fn_izo_refuz_mutare_pachet()', 'trigger|trg_pachete_izo_truncate on public.executie_pachete_lansare|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_proiecte_izo_site on public.executie_proiecte|public.fn_izo_refuz_site_proiect()', 'trigger|trg_tronsoane_izo_mutare on public.executie_tronsoane|public.fn_izo_refuz_mutare_tronson()']::text[] THEN RAISE EXCEPTION 'E4b inventar implicit: %',v_impl; END IF;
 v_meta:=obj_description('public.izo_rata_apeluri'::regclass,'pg_class')::jsonb;
 IF v_meta->>'amprenta' IS NULL THEN RAISE EXCEPTION 'E4b metadata lipsa'; END IF;
   CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v text[] := '{}'; r record;
  BEGIN
    -- triggerele: există și sunt ENABLE ALWAYS ('A' — trag și sub session_replication_role = replica)
    FOR r IN SELECT x.tabel, x.trg, g.tgenabled
               FROM (VALUES ('magazie_bucati','trg_magbuc_izo_garda'), ('magazie_bucati','trg_magbuc_izo_truncate'),
                            ('magazie_bucati_evenimente','trg_izo_ev_garda'), ('magazie_bucati_evenimente','trg_izo_ev_truncate'),
                            ('magazie_bucati_miscari','trg_izo_mis_garda'), ('magazie_bucati_miscari','trg_izo_mis_truncate'),
                            ('izo_importuri','trg_izo_imp_garda'), ('izo_importuri','trg_izo_imp_truncate'),
                            ('izo_proiect_config','trg_izo_cfg_garda'), ('izo_proiect_config','trg_izo_cfg_truncate'),
                            ('izo_atribuiri','trg_izo_atr_garda'), ('izo_atribuiri','trg_izo_atr_truncate'),
                            ('executie_tevi','trg_executie_tevi_izo_delete'), ('executie_tevi','trg_executie_tevi_izo_mutare'),
                            ('executie_pachete_lansare','trg_pachete_izo_delete'), ('executie_pachete_lansare','trg_pachete_izo_mutare'),
                            ('executie_tronsoane','trg_tronsoane_izo_mutare'), ('logistica_depozite','trg_depozite_izo_mutare'),
                            ('executie_proiecte','trg_proiecte_izo_site'),
                            ('executie_tevi','trg_executie_tevi_izo_truncate'), ('executie_pachete_lansare','trg_pachete_izo_truncate'),
                            ('executie_bonuri_consum_linii','trg_bon_linii_izo_bucata')) x(tabel, trg)
               LEFT JOIN pg_trigger g ON g.tgname = x.trg AND g.tgrelid = to_regclass('public.' || x.tabel) AND NOT g.tgisinternal
    LOOP
      IF r.tgenabled IS DISTINCT FROM 'A' THEN v := array_append(v, format('trigger %s.%s (%s)', r.tabel, r.trg, coalesce(r.tgenabled::text, 'lipsă'))); END IF;
    END LOOP;
    -- RLS activ pe tabelele registrului și pe magazie_bucati
    FOR r IN SELECT t.n, c.relrowsecurity FROM unnest(ARRAY['magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri',
                      'magazie_bucati_evenimente','magazie_bucati_miscari']) t(n) LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.n)
    LOOP
      IF r.relrowsecurity IS NOT TRUE THEN v := array_append(v, format('RLS inactiv pe %s', r.n)); END IF;
    END LOOP;
    -- politicile RESTRICTIVE ale clientului pe magazie_bucati
    IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'public.magazie_bucati'::regclass AND NOT p.polpermissive
          AND p.polname IN ('magbuc_izo_client_sel','magbuc_izo_client_ins','magbuc_izo_client_upd','magbuc_izo_client_del')) <> 4 THEN
      v := array_append(v, 'politicile RESTRICTIVE magbuc_izo_client_*');
    END IF;
    -- rolul scriitor: fără BYPASSRLS/LOGIN/SUPERUSER/INHERIT; singurul membru = postgres; niciun rol API nu-l poate prelua
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'izo_registru_writer' AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit) THEN
      v := array_append(v, 'rolul izo_registru_writer (lipsă sau BYPASSRLS/LOGIN/SUPERUSER/INHERIT)');
    -- membri: doar postgres (PG16+: CREATE ROLE de către un non-superuser adaugă automat un rând ADMIN fără SET/INHERIT,
    -- grantor = superuser-ul de bootstrap — pe Supabase supabase_admin; găsit de testul pe branch PG17); SET da, INHERIT nu
    ELSIF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole AND m.member <> 'postgres'::regrole)
       OR NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole AND m.member = 'postgres'::regrole AND m.set_option)
       OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole AND m.inherit_option)
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','authenticator']) a(n)
                   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = a.n) AND pg_has_role(a.n, 'izo_registru_writer', 'MEMBER')) THEN
      v := array_append(v, 'membrii rolului izo_registru_writer');
    END IF;
    -- ACL: clientul nu scrie tabelele registrului și nu execută funcțiile writer-ului
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari']) t(n),
                             unnest(ARRAY['anon','authenticated','service_role']) a(n), unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p(n)
                WHERE to_regclass('public.' || t.n) IS NULL OR has_table_privilege(a.n, 'public.' || t.n, p.n)) THEN
      v := array_append(v, 'ACL de scriere pe tabelele registrului');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) a(n)
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_izo_seteaza_nivel','fn_izo_import_sold_initial','fn_izo_import_storno','fn_izo_activeaza_si_importa')
                  AND has_function_privilege(a.n, p.oid, 'EXECUTE')) THEN
      v := array_append(v, 'EXECUTE din API pe funcțiile registrului');
    END IF;
    -- allowlist pe ACL (invariantul principal, Copilot r6 c): intrările writer-ului se execută DOAR de owner și postgres
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname IN ('fn_izo_seteaza_nivel','fn_izo_import_sold_initial','fn_izo_import_storno','fn_izo_activeaza_si_importa')
                  AND a.privilege_type = 'EXECUTE' AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) NOT IN ('izo_registru_writer','postgres'))) THEN
      v := array_append(v, 'EXECUTE pe funcțiile registrului pentru alt rol decât writer / postgres (allowlist)');
    END IF;
    -- wrapper-e (plasă de siguranță peste allowlist): o funcție cu alt owner decât writer-ul sau un view / o regulă care cheamă funcțiile registrului ar
    -- deveni o cale nouă spre ele (Codex r5 6) — acceptate doar după review, cu actualizarea acestei porți
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.proowner <> 'izo_registru_writer'::regrole
                AND p.oid <> 'public.fn_izo_porti_lipsa()'::regprocedure   -- poarta însăși le numește în verificarea ACL
                -- corpul complet: prosrc (plpgsql / sql clasic) + corpul BEGIN ATOMIC (prosrc gol, corpul în prosqlbody) — review r7
                AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), ''))
                    ~* 'fn_izo_(seteaza_nivel|import_sold_initial|import_storno|activeaza_si_importa)')   -- fără majuscule (N3)
       OR EXISTS (SELECT 1 FROM pg_rewrite rw WHERE pg_get_ruledef(rw.oid) ~* 'fn_izo_(seteaza_nivel|import_sold_initial|import_storno|activeaza_si_importa)') THEN
      v := array_append(v, 'o funcție / un view din afara writer-ului cheamă funcțiile registrului (wrapper nerevizuit)');
    END IF;
    -- CITIRILE (acțiunea 6, Codex r4 / Jakarinos r6–r10): filtrarea citirii (RLS restrictiv + fn_izo_citire) se poate ocoli
    -- fără niciun trigger de scriere printr-un view cu drepturile ownerului sau printr-o funcție DEFINER care întoarce rânduri.
    -- Inventarul de pe live (docs/izometrie/E2A_INVENTAR_CITIRI.md, 21.10.2026): 0 view-uri, 0 funcții care ating
    -- magazie_bucati, 5 DEFINER cu SQL dinamic pe tabele fixe (profiles / executie_proiecte), neexpuse. Porțile de mai jos
    -- refuză activarea dacă apare ceva nou, nerevizuit (r11: porți pe tipuri; r12: închiderea tranzitivă de mai jos):
    -- r12 (Jakarinos + Copilot r11): ÎNCHIDEREA TRANZITIVĂ a tot ce poate citi registrul, până la punct fix:
    --   sămânța = tabelele registrului + funcțiile cu SQL dinamic (pot citi orice tabel) din afara listei revizuite;
    --   se adaugă repetat: view-urile / view-urile materializate care depind (pg_depend → pg_rewrite) de ceva din închidere
    --   (inclusiv cele security_invoker — un DEFINER care le citește le ocolește RLS-ul), și funcțiile (orice schemă
    --   non-sistem, în afara public.fn_izo_*) al căror corp NUMEȘTE ceva din închidere (în public: numele simplu; în alte
    --   scheme: schema.nume) sau depind de el în catalog (corpuri BEGIN ATOMIC).
    -- Refuz dacă în închidere apare: un view fără security_invoker, un view materializat sau o funcție SECURITY DEFINER.
    -- Funcțiile DEFINER cu SQL dinamic din afara listei revizuite sunt refuzate oricum (citesc orice, fără să numească).
    DECLARE
      c_rel oid[]; c_fn oid[] := '{}'; v_marime int := -1; v_iter int := 0; c_mut oid[] := '{}';
      -- funcțiile DEFINER cu SQL dinamic revizuite pe live (docs/izometrie/E2A_INVENTAR_CITIRI.md, 21.10.2026): tabele fixe
      -- (executie_proiecte / profiles), identificatori pe listă albă. Amprenta excepției = md5(prosrc | proconfig | owner |
      -- proacl | prosecdef) (Jakarinos r12): orice schimbare de corp, search_path, owner sau drepturi cere review
      c_dinamice_revizuite text[] := ARRAY[
        '_completare_goleste_camp(bigint,text,integer)=888fde4d4e7fbea6889835dd96c2225d',
        '_completare_scrie_camp(bigint,text,text)=77d7b091a049ccc86b47d078957db39f',
        'fn_cont_inchide(uuid,text,text,integer)=c4a6ca93a52ca8a97aa90f168debf30e',
        'fn_cont_restaureaza_flaguri(uuid,jsonb)=ecd803a2dda6b734ea92ebaf10564397',
        'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',
        'fn_tichete_notif_on_insert()=1ffa41a8750b6d48d721d9e2a00b3f54'];
      -- limitele unui identificator, inclusiv citat („"teste".f()”), fără \m / \M (ghilimelele nu sunt caractere de cuvânt)
      c_st constant text := '(^|[^[:alnum:]_$"])"?';
      c_dr constant text := '"?($|[^[:alnum:]_$])';
      -- schemele platformei Supabase: obiectele lor din închidere (funcții INVOKER cu SQL dinamic: realtime.cast, storage.search…)
      -- se potrivesc necalificat DOAR când schema e în search_path-ul funcției; ale noastre (orice altă schemă) se potrivesc
      -- necalificat ÎNTOTDEAUNA — conservator, fals-pozitivele sunt acceptate (Copilot r12 P1)
      c_scheme_platforma constant text[] := ARRAY['auth','storage','realtime','extensions','graphql','graphql_public','vault','net',
                                                  'supabase_functions','supabase_migrations','pgbouncer','pgsodium','pgsodium_masks','cron'];
      -- r5d (20261103b): aceeași semantică, evaluare SEMI-NAIVĂ — fiecare element nou al închiderii se caută o singură dată,
      -- cu alternanța numelor din frontieră (r5f: pe bucăți mărginite, nu o singură expresie); corpurile se citesc o dată
      k_oid oid[]; k_corp text[]; k_cale text[]; f_rel oid[]; f_fn oid[]; f_mut oid[]; n_rel oid[]; n_fn oid[]; n_mut oid[];
      -- r5f (#825 NO-GO): tiparele frontierei, pe bucăți: a_x = alternanța (≤ ~4000 de caractere), a_s = schema de platformă
      -- căreia i se aplică (NULL = oricărei funcții)
      a_s text[]; a_x text[];
      k_i int; k_n int; k_s text; k_s2 text; k_adanc oid[] := '{}';
      -- r5g (#825) NO-GO P2: o schemă a platformei urmată (după ghilimele / spații / un punct opțional) de deschiderea unui
      -- comentariu — singura formă în care un comentariu rupe apelul ei calificat
      k_com text := c_st || '(' || array_to_string(c_scheme_platforma, '|') || ')"?[[:space:]]*(\.[[:space:]]*)?(/\*|--)';
      -- r5g (#825) NO-GO P1-D: invocările implicite revizuite, de pe prod — singurele obiecte din catalog care cheamă implicit o
      -- funcție din închiderea de pe prod sau (r5h) un mutator de cale; citite read-only 22.10.2026 (baseline_pre_e3.json, cheia
      -- „implicite”). r5h (#825 r5g NO-GO, Jak P1): amprenta = md5(tip | identitate | funcția | owner | SECURITY DEFINER |
      -- proconfig | limbaj | md5(corp)) — CU corpul: un corp schimbat (același owner / config) nu mai păstrează excepția. Un
      -- upgrade Supabase care schimbă corpul uneia dintre funcțiile de platformă înroșește poarta (fail-closed): captură nouă
      -- + review + migrare (design §17)
      c_implicite_revizuite constant text[] := ARRAY[
        'event trigger issue_graphql_placeholder=2aa685a004bc87f7a10ef72d134a88bb',
        'event trigger issue_pg_graphql_access=7ed4741489f49636791f930411cfb345',
        'event trigger issue_pg_net_access=d62f8ab601b809080c679266fbdb8a06',
        'trigger a01_ofertare_cantitati_lot_canonic on public.ofertare_cantitati=62d07782ee60e73b327be8c82d4dd34b',
        'trigger a01_ofertare_cerinte_lot_canonic on public.ofertare_cerinte=b2b9b1f753fae9e4f8a7a10ee6c6b351',
        'trigger on_auth_user_created on auth.users=5f3f59717d56d1148ac3f4b7d3a2b199',
        'trigger prevent_role_escalation_trigger on public.profiles=06b7e4fcaab58c9a3faecb7ff4856b45',
        'trigger tr_check_filters on realtime.subscription=ed76f4ff4e3c6abd998eded3d159d3c3',
        'trigger trg_employees_persoana_lock on public.employees=9dcecd0c70efdf1bf5e24e9c1157bc11',
        'trigger trg_employees_zz_ciclu_cont on public.employees=8b5dbbd69476106544cff2b5393c116a',
        'trigger trg_enforce_owner_only_salary_flags on public.profiles=46f1b6af2f30d56993ca988b267e76d8',
        'trigger trg_hr_autorizatii_rsvti_doar_rpc on public.hr_autorizatii=9a7f49627ab4e62e14aa43252a2ab56e',
        'trigger trg_hr_employees_private_persoana_lock on public.hr_employees_private=32261dc19c5d0da91f0487ab2f33bb08',
        'trigger trg_profiles_campuri_owner_only on public.profiles=e80a3aed6ff3f2055785bdc974702cd5',
        'trigger trg_protect_can_access_pontaj_brut on public.profiles=3a58112eec4c06bef2d66159ad6f82a5'];
    BEGIN
      SELECT array_agg(c.oid) INTO c_rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari');
      -- funcțiile cu SQL dinamic (orice EXECUTE), în afara registrului și a listei revizuite: în închidere de la început
      SELECT coalesce(array_agg(p.oid), '{}') INTO c_fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
         AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '\mexecute\M'
         AND format('%s=%s', p.oid::regprocedure::text, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner)
                                                           || '|' || coalesce(p.proacl::text, '') || '|' || p.prosecdef::text))
             <> ALL (c_dinamice_revizuite);
      -- r5f (#825): + tabelele documentelor E3 — RLS cu citire prin fn_izo_citire, ca registrul (design §13.2): un DEFINER /
      -- un view fără security_invoker / un lanț din afara fn_izo_* care ajunge la ele e refuzat la fel. Funcțiile E3 legitime
      -- (fn_izo_doc_* / fn_izo_scan_*, owner izo_doc_editor / izo_receptie_writer / postgres) sunt fn_izo_*: în afara
      -- închiderii, ca la E2a, și acoperite de ștampila E2a (fn_izo_porti_definitii: owner, corp, config, ACL)
      c_rel := c_rel || ARRAY(SELECT c.oid FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('izo_documente_intrare','izo_documente_intrare_randuri','izo_documente_scanuri'));
      -- r5g (#825) NO-GO P1-C: + TOATE funcțiile public.fn_izo_* ca ȚINTE (nu candidați): cititorii INVOKER ai documentelor
      -- (owner postgres) și DEFINER-ele interne citesc ce RLS-ul ascunde; un DEFINER / view / lanț din afara fn_izo_* care le
      -- cheamă (după nume, BEGIN ATOMIC, view, operator / cast / agregat) intră în închidere, ca un cititor direct. După
      -- propagare ele ies din c_fn (mai jos): sunt API-ul revizuit, sub ștampila E2a. Invocările lor implicite din catalog
      -- (trigger / politică / DEFAULT / CHECK …) sunt fixate de ștampila E3 (fn_izo_porti_e3_definitii)
      c_fn := c_fn || ARRAY(SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_%');
      -- corpurile candidate (orice schemă non-sistem, în afara public.fn_izo_*), o singură dată; calea fixată în proconfig
      -- (NULL = necunoscută: funcția moștenește calea apelantului)
      SELECT coalesce(array_agg(p.oid ORDER BY p.oid), '{}'),
             coalesce(array_agg(p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') ORDER BY p.oid), '{}'),
             coalesce(array_agg((SELECT array_to_string(string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ','), ',')
                                   FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) ORDER BY p.oid), '{}')
        INTO k_oid, k_corp, k_cale
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%');
      -- r5f (#825 NO-GO): un comentariu între schemă și nume („storage/**/.f()”, „storage -- x⏎.f()”) ascunde forma calificată —
      -- contează la schemele platformei, unde necalificatul cere calea. Corpului i se adaugă o copie fără comentarii (blocurile
      -- imbricate din interior spre exterior, până la punct fix; apoi „--” până la capăt de rând). Copia doar ADAUGĂ potriviri
      -- (originalul rămâne): un „/*” sau „--” dintr-un șir taie din copie, nu din original. Cel mult 20 de niveluri (fiecare nivel
      -- = o trecere peste tot corpul — fără plafon, mii de comentarii imbricate ar ține poarta minute întregi): mai adânc → corpul
      -- nu se poate citi sigur, intră în sămânță ca SQL-ul dinamic (k_adanc, mai jos)
      -- r5g (#825, Copilot P1): copia nu înțelege literalii — un „--” / „/*” dintr-un șir taie din copie chiar apelul ascuns
      -- de comentariu („x := '--'; PERFORM storage /* c */ . f();”), iar originalul nu-l are calificat. Fail-closed, fără
      -- tokenizer: calea devine NECUNOSCUTĂ (NULL, în ambele bucle) și numele schemei se potrivesc în corp necalificat.
      -- r5g (#825) NO-GO P2: nu la orice „/*” / „--” (pe prod: 192 de corpuri, 162 DEFINER — un comentariu + „CAST(” /
      -- „send” / „search” ar fi înroșit poarta), ci doar când o schemă a platformei e urmată de deschiderea unui comentariu
      -- (k_com), pe ORIGINAL: comentariul care rupe apelul apare textual acolo, deci un literal nu-l poate ascunde; pe prod: 0
      -- corpuri. La celelalte scheme necalificatul se potrivește oricum, deci forma calificată ruptă nu ascunde nimic
      FOR k_i IN 1 .. cardinality(k_corp) LOOP
        IF k_corp[k_i] ~* k_com THEN k_cale[k_i] := NULL; END IF;
        k_s := k_corp[k_i]; k_n := 0;
        LOOP
          k_s2 := regexp_replace(k_s, '/\*([^*/]|\*+[^*/]|/+[^*/])*\*+/', ' ', 'g');
          EXIT WHEN k_s2 = k_s;
          k_s := k_s2; k_n := k_n + 1;
          IF k_n >= 20 THEN k_adanc := k_adanc || k_oid[k_i]; EXIT; END IF;
        END LOOP;
        k_s := regexp_replace(k_s, '--[^\n]*', ' ', 'g');
        IF k_s <> k_corp[k_i] THEN k_corp[k_i] := k_corp[k_i] || ' ' || k_s; END IF;
      END LOOP;
      -- r5f (#825 NO-GO): în sămânță și funcțiile care pot citi un tabel FĂRĂ să-i scrie numele și fără EXECUTE — identificatori
      -- U&"…" (escape-uri Unicode), SQL dat ca text (query/table/schema/database_to_xml, ts_stat / ts_rewrite, crosstab /
      -- connectby, dblink), fișierele / paginile tabelelor (pg_read_[binary_]file, lo_import, get_raw_page); ca SQL-ul
      -- dinamic: un DEFINER care le conține (sau le cheamă) e refuzat. Mai strict decât E2a, care le lasă verzi. Tot aici:
      -- corpurile cu comentarii imbricate peste plafon (k_adanc)
      c_fn := c_fn || ARRAY(SELECT k.oid FROM unnest(k_oid, k_corp) k(oid, corp) WHERE k.oid <> ALL (c_fn)
                              AND (k.oid = ANY (k_adanc)
                                   OR k.corp ~* ('u&"|\m(query|table|schema|database)_to_xml|\mts_(stat|rewrite)\M|\m(crosstab|connectby|dblink)'
                                                 || '|\mpg_read_(binary_)?file\M|\mlo_import\M|\mget_raw_page\M')));
      -- mutatorii de cale (r15): sămânța = corp cu set_config / search_path; propagați până la punct fix
      SELECT coalesce(array_agg(k.oid), '{}') INTO c_mut FROM unnest(k_oid, k_corp) k(oid, corp) WHERE k.corp ~* '(set_config|search_path)';
      f_mut := c_mut; v_iter := 0;
      WHILE cardinality(f_mut) > 0 AND v_iter < 100 LOOP
        v_iter := v_iter + 1;
        -- r5f (#825 NO-GO): tiparele pe BUCĂȚI de ~4000 de caractere, nu o singură alternanță: cu ~1000 de nume lungi în
        -- frontieră, motorul de regex refuză („invalid memory alloc request size” / „regular expression is too complex”) —
        -- poarta ar da eroare unde E2a răspunde (testul „frontieră largă”), iar compilarea crește pătratic. Fiecare nume dă două
        -- alternative: calificat (s = NULL, oricui) și necalificat (s = NULL în afara platformei; s = schema platformei: doar
        -- dacă e în calea fixată a funcției sau calea e nefixată).
        -- r5f (#825 NO-GO, P1): și SCHEMA se escapează (nsx), ca numele: o schemă construită („x)(?=x)y(x”) ar închide grupul
        -- comun și ar face bucata (deci toate numele ei) imposibil de potrivit — verde fals; nsp (brut) rămâne doar pentru s
        WITH t AS (SELECT n2.nspname::text nsp, regexp_replace(n2.nspname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nsx,
                          regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                     FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_mut)),
             y AS (SELECT NULL::text s, t.nsx || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume f FROM t
                   UNION ALL SELECT CASE WHEN t.nsp = ANY (c_scheme_platforma) THEN t.nsp END, t.nume FROM t)
        SELECT coalesce(array_agg(z.s), '{}'), coalesce(array_agg(c_st || '(' || z.alt || ')' || c_dr), '{}') INTO a_s, a_x
          FROM (SELECT y2.s, string_agg(y2.f, '|') alt
                  FROM (SELECT y.s, y.f, (sum(length(y.f) + 1) OVER (PARTITION BY y.s ORDER BY y.f ROWS UNBOUNDED PRECEDING) - 1) / 4000 b FROM y) y2
                 GROUP BY y2.s, y2.b) z;
        -- bucata în exterior (LATERAL … OFFSET 0: nu se aplatizează), corpurile în interior — fiecare tipar se compilează o dată;
        -- CASE fixează ordinea: întâi filtrele ieftine, regex-ul ultimul (planificatorul l-ar evalua primul)
        n_mut := ARRAY(SELECT DISTINCT m.oid FROM unnest(a_s, a_x) p(s, x)
                         CROSS JOIN LATERAL (SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale)
                                              WHERE CASE WHEN k.oid = ANY (c_mut) THEN false
                                                         WHEN p.s IS NULL OR k.cale IS NULL OR p.s = ANY (string_to_array(k.cale, ',')) THEN k.corp ~* p.x
                                                         ELSE false END OFFSET 0) m);
        c_mut := c_mut || n_mut; f_mut := n_mut;
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'propagarea mutatorilor de cale nu converge (citire nerevizuită)'); END IF;
      -- închiderea: frontiera = elementele adăugate în iterația precedentă (view-urile noi intră în frontiera aceleiași iterații,
      -- ca în E2a, unde sunt adăugate înaintea funcțiilor)
      f_rel := c_rel; f_fn := c_fn; v_iter := 0;
      WHILE (cardinality(f_rel) > 0 OR cardinality(f_fn) > 0) AND v_iter < 100 LOOP
        v_iter := v_iter + 1;
        n_rel := ARRAY(SELECT DISTINCT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                        WHERE d.classid = 'pg_rewrite'::regclass
                          AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                               OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn)))
                          AND rw.ev_class <> ALL (c_rel));
        c_rel := c_rel || n_rel; f_rel := f_rel || n_rel;
        -- r5f (#825 NO-GO): aceleași bucăți de tipare ca la mutatori, cu schema escapată (P1; vezi mai sus)
        WITH t AS (SELECT n2.nspname::text nsp, regexp_replace(n2.nspname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nsx,
                          regexp_replace(c.relname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                     FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE c.oid = ANY (f_rel)
                   UNION
                   SELECT n2.nspname::text, regexp_replace(n2.nspname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'),
                          regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
                     FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_fn)),
             y AS (SELECT NULL::text s, t.nsx || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume f FROM t
                   UNION ALL SELECT CASE WHEN t.nsp = ANY (c_scheme_platforma) THEN t.nsp END, t.nume FROM t)
        SELECT coalesce(array_agg(z.s), '{}'), coalesce(array_agg(c_st || '(' || z.alt || ')' || c_dr), '{}') INTO a_s, a_x
          FROM (SELECT y2.s, string_agg(y2.f, '|') alt
                  FROM (SELECT y.s, y.f, (sum(length(y.f) + 1) OVER (PARTITION BY y.s ORDER BY y.f ROWS UNBOUNDED PRECEDING) - 1) / 4000 b FROM y) y2
                 GROUP BY y2.s, y2.b) z;
        -- schemele platformei: necalificat doar dacă schema e în calea funcției; calea e necunoscută dacă nu e fixată SAU dacă
        -- funcția e mutator (r15)
        n_fn := ARRAY(SELECT DISTINCT m.oid FROM unnest(a_s, a_x) p(s, x)
                        CROSS JOIN LATERAL (SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale)
                                             WHERE CASE WHEN k.oid = ANY (c_fn) THEN false
                                                        WHEN p.s IS NULL OR k.oid = ANY (c_mut) OR k.cale IS NULL OR p.s = ANY (string_to_array(k.cale, ','))
                                                          THEN k.corp ~* p.x
                                                        ELSE false END OFFSET 0) m);
        -- sau depind de ceva din frontieră în catalog (BEGIN ATOMIC)
        n_fn := n_fn || ARRAY(SELECT k.oid FROM unnest(k_oid) k(oid) WHERE k.oid <> ALL (c_fn) AND k.oid <> ALL (n_fn)
                                AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = k.oid
                                               AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                                                    OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn)))));
        c_fn := c_fn || n_fn;
        f_rel := n_rel; f_fn := n_fn;
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;
      -- r5f (#825 NO-GO, P1): un element al închiderii (sau mutator) al cărui nume nu se poate căuta sigur în corpuri → refuz:
      -- schemă cu caractere speciale de regex (E2a dă eroare pe ea, deci rămâne închisă — poarta nouă refuză la fel, nu dă
      -- verde) sau ghilimele în schemă / nume (în corp apar dublate, „"x""y"” — nicio expresie nu le găsește; în E2a: verde fals)
      IF EXISTS (SELECT 1 FROM (SELECT c.relname::text nume, c.relnamespace ns FROM pg_class c WHERE c.oid = ANY (c_rel)
                                UNION ALL SELECT q.proname::text, q.pronamespace FROM pg_proc q WHERE q.oid = ANY (c_fn || c_mut)) o
                  JOIN pg_namespace n2 ON n2.oid = o.ns
                 WHERE n2.nspname ~ '[.^$*+?()\[\]{}|\\"]' OR o.nume ~ '"') THEN
        v := array_append(v, 'un nume din închiderea citirilor nu se poate căuta sigur în corpuri (schemă cu caractere speciale de regex / nume cu ghilimele) (citire nerevizuită)');
      END IF;
      -- r5g (#825, Jak P1): invocarea IMPLICITĂ cheamă o funcție fără să-i scrie numele — operatorul (oprcode / oprrest /
      -- oprjoin: „OPERATOR(s.#!#) x”, infix / prefix), cast-ul (castfunc: „x::tip”), agregatul (aggtransfn / aggfinalfn /
      -- aggcombinefn / aggserialfn / aggdeserialfn / aggmtransfn / aggminvtransfn / aggmfinalfn; agregatul e prolang
      -- internal, deci nu e candidat și numele lui nu se caută); corpurile ne-ATOMIC n-au nici dependențe în catalog. Nu se
      -- propagă (forma infix nu se poate căuta sigur în corpuri): funcția-suport în închidere sau mutator de cale → refuz
      -- explicit, oricine ar folosi operatorul / cast-ul / agregatul (fals-pozitive acceptate). Pe prod: 0 (suportul din afara
      -- pg_catalog e doar C, în extensions — niciodată candidat). Celelalte obiecte din catalog: regula P1-D, mai jos
      FOR k_s IN SELECT x.d FROM (
          SELECT format('operator %s → %s', o.oid::regoperator, f.f::regprocedure) d
            FROM pg_operator o CROSS JOIN LATERAL unnest(ARRAY[o.oprcode::oid, o.oprrest::oid, o.oprjoin::oid]) f(f)
           WHERE f.f = ANY (c_fn || c_mut)
          UNION
          SELECT format('cast (%s AS %s) → %s', c.castsource::regtype, c.casttarget::regtype, c.castfunc::regprocedure)
            FROM pg_cast c WHERE c.castfunc = ANY (c_fn || c_mut)
          UNION
          SELECT format('agregat %s → %s', a.aggfnoid::regprocedure, f.f::regprocedure)
            FROM pg_aggregate a CROSS JOIN LATERAL unnest(ARRAY[a.aggtransfn::oid, a.aggfinalfn::oid, a.aggcombinefn::oid, a.aggserialfn::oid,
                                                                a.aggdeserialfn::oid, a.aggmtransfn::oid, a.aggminvtransfn::oid, a.aggmfinalfn::oid]) f(f)
           WHERE f.f = ANY (c_fn || c_mut)) x
        ORDER BY x.d COLLATE "C"
      LOOP
        v := array_append(v, 'invocare implicită neanalizată: ' || k_s || ' (funcție-suport din închiderea citirilor sau mutator de cale) (citire nerevizuită)');
      END LOOP;
      -- r5g (#825) NO-GO P1-C: țintele fn_izo_* ies din c_fn după propagare (API-ul revizuit, sub ștampila E2a; un DEFINER
      -- fn_izo_* nu e „DEFINER din afara registrului”). Fără sămânța E3 c_fn nu conține fn_izo_* (nici candidați, nici
      -- SQL dinamic), deci aici nu schimbă nimic
      c_fn := ARRAY(SELECT x.f FROM unnest(c_fn) x(f) JOIN pg_proc q ON q.oid = x.f
                     WHERE NOT (q.pronamespace = 'public'::regnamespace AND q.proname LIKE 'fn\_izo\_%'));
      -- r5g (#825) NO-GO P1-D: invocarea implicită prin EXPRESII DIN CATALOG — CHECK pe domeniu / tabel, DEFAULT, coloană
      -- generată, expresie de index, trigger (și event trigger), politică, statistici, I/O de tip, clasă de operatori …: un
      -- DEFINER care scrie / convertește / sortează le pornește fără să numească funcția. Orice rând pg_depend spre o funcție
      -- din închidere al cărui obiect nu e propagat mai sus (view / regulă: pg_rewrite; funcție: pg_proc — candidații prin
      -- propagare, agregatele prin regula de deasupra; operator / cast: regula de deasupra) → refuz explicit, cu obiectul numit,
      -- în afara listei revizuite (c_implicite_revizuite).
      -- r5h (#825 r5g NO-GO, Jak P1): și spre MUTATORII de cale (c_mut), ca spre închidere: un trigger INVOKER care face
      -- set_config('search_path', 'storage, public', true) pe un tabel auxiliar, pornit de un DEFINER cu cale fixă care inserează
      -- acolo și apoi cheamă necalificat un cititor de platformă, schimbă calea efectivă FĂRĂ ca DEFINER-ul să numească mutatorul
      -- (deci el nu devine mutator, iar apelul necalificat se judecă pe calea declarată). Refuz explicit, cu obiectul numit; pe
      -- prod: 12 obiecte peste mutatori (11 trigger-e + issue_graphql_placeholder; tr_check_filters / issue_pg_net_access și în
      -- închidere), toate pe lista revizuită, cu corpul în amprentă
      FOR k_s IN SELECT x.d FROM (
          SELECT DISTINCT format('%s → %s%s', pg_describe_object(d.classid, d.objid, d.objsubid), d.refobjid::regprocedure,
                                 CASE WHEN d.refobjid = ANY (c_fn) THEN ' (obiect din catalog care cheamă o funcție din închiderea citirilor)'
                                      ELSE ' (obiect din catalog care cheamă un mutator de cale)' END) d
            FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid JOIN pg_language l ON l.oid = q.prolang
                 CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
                 CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
           WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (c_fn || c_mut)
             AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass, 'pg_operator'::regclass, 'pg_cast'::regclass)
             AND format('%s %s=%s', o.type, o.identity, md5(concat_ws('|', o.type, o.identity, f.identity, pg_get_userbyid(q.proowner), q.prosecdef::text, coalesce(q.proconfig::text, ''), l.lanname, md5(q.prosrc || '|' || coalesce(q.prosqlbody::text, ''))))) <> ALL (c_implicite_revizuite)) x
        ORDER BY x.d COLLATE "C"
      LOOP
        v := array_append(v, 'invocare implicită neanalizată: ' || k_s || ' (citire nerevizuită)');
      END LOOP;
      IF EXISTS (SELECT 1 FROM pg_class vw WHERE vw.oid = ANY (c_rel)   -- alias ≠ variabila v
                  AND (vw.relkind = 'm' OR (vw.relkind = 'v' AND NOT coalesce(vw.reloptions && ARRAY['security_invoker=true','security_invoker=on','security_invoker=1'], false)))) THEN
        v := array_append(v, 'un view / view materializat citește registrul fără security_invoker (citire nerevizuită)');
      END IF;
      IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = ANY (c_fn) AND p.prosecdef) THEN
        v := array_append(v, 'o funcție DEFINER din afara registrului poate citi registrul — direct, prin view sau tranzitiv (citire nerevizuită)');
      END IF;
    END;
    -- writer-ul are exact ce-i trebuie (un GRANT retras ar lăsa activarea admisă și importul nefuncțional)
    -- câte un privilegiu pe rând: has_table_privilege(…, 'A,B') e adevărat dacă există ORICARE (Codex r4 8)
    IF EXISTS (SELECT 1 FROM (VALUES ('magazie_bucati','SELECT'), ('magazie_bucati','INSERT'), ('magazie_bucati','UPDATE'),
                                     ('magazie_bucati_evenimente','SELECT'), ('magazie_bucati_evenimente','INSERT'),
                                     ('magazie_bucati_miscari','SELECT'), ('magazie_bucati_miscari','INSERT'),
                                     ('izo_importuri','SELECT'), ('izo_importuri','INSERT'), ('izo_importuri','UPDATE'),
                                     ('izo_proiect_config','SELECT'), ('izo_proiect_config','INSERT'), ('izo_proiect_config','UPDATE'),
                                     ('izo_atribuiri','SELECT')) d(t, pr)
                WHERE NOT has_table_privilege('izo_registru_writer', 'public.' || d.t, d.pr))
       OR NOT (true
            AND has_sequence_privilege('izo_registru_writer', 'public.izo_server_ver_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.magazie_bucati_id_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.magazie_bucati_evenimente_id_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.magazie_bucati_miscari_id_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.izo_importuri_id_seq', 'USAGE')) THEN
      v := array_append(v, 'drepturile writer-ului (tabele / secvențe) incomplete');
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) a(n) WHERE has_table_privilege(a.n, 'public.magazie_bucati', 'TRUNCATE')) THEN
      v := array_append(v, 'TRUNCATE pe magazie_bucati pentru un rol API');
    END IF;
    -- definițiile (nu doar numele): amprenta curentă = cea fixată la migrare (review #806 r2)
    IF public.fn_izo_porti_definitii() IS DISTINCT FROM
       substring(obj_description('public.fn_izo_porti_definitii()'::regprocedure, 'pg_proc') FROM '^porti=([0-9a-f]{32})$') THEN
      v := array_append(v, 'definițiile porților diferă de amprenta de la migrare (trigger / politică / funcție / ACL modificat)');
    END IF;
    -- E3 (20261103b): poarta documentelor de intrare, chemată de aici, ca orice activare / import E2a s-o includă (r5d §13.1)
    v := v || public.fn_izo_porti_e3_lipsa();
    v := v || public.fn_izo_porti_e3b_lipsa();
    v := v || public.fn_izo_porti_e4_lipsa();
    RETURN v;
  END $f$;
   CREATE OR REPLACE FUNCTION public.fn_izo_garda_montaj(p_tabel text,p_op text,p_inainte jsonb,p_dupa jsonb)
    RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_ctx text:=current_setting('izo.montaj_ctx',true); v_pachet bigint; v_op text; v_dupa_comparabil jsonb;
  BEGIN
    -- E4a writes only the link. No events/movements/imports/config authorization yet.
    IF current_user='izo_montaj_writer' AND p_tabel='magazie_bucati' AND p_op='UPDATE'
      AND p_inainte IS NOT NULL AND p_dupa IS NOT NULL
      -- PG16 computes STORED generated columns AFTER BEFORE triggers: NEW has NULL.
      -- Require that exact trigger shape; restore only these two derived values for
      -- comparison with the stored snapshot. Their sources (serie/lungime_mm) stay immutable.
      AND p_dupa->'serie_canon' = 'null'::jsonb AND p_dupa->'lungime_cm' = 'null'::jsonb THEN
      v_dupa_comparabil:=p_dupa || jsonb_build_object(
        'serie_canon',p_inainte->'serie_canon','lungime_cm',p_inainte->'lungime_cm');
      v_op:=CASE WHEN p_dupa->>'executie_teava_id' IS NULL THEN 'dezleaga' ELSE 'leaga' END;
      SELECT pachet_id INTO v_pachet FROM public.executie_tevi
        WHERE id=coalesce((p_dupa->>'executie_teava_id')::bigint,(p_inainte->>'executie_teava_id')::bigint);
      IF v_ctx = concat_ws('|',txid_current()::text,v_op,v_pachet::text,
          p_inainte->>'proiect_id',p_inainte->>'tronson_id',p_dupa->>'server_ver',p_inainte->>'id')
        AND v_pachet IS NOT NULL AND p_inainte->>'tip_cod' IN ('teava','curba')
        AND p_inainte->>'stare'='montata'
        AND ((v_op='leaga' AND p_inainte->>'executie_teava_id' IS NULL)
          OR (v_op='dezleaga' AND p_inainte->>'executie_teava_id' IS NOT NULL))
        AND nullif(current_setting('izo.montaj_bucata_inainte',true),'')::jsonb=p_inainte
        AND nullif(current_setting('izo.montaj_bucata_dupa',true),'')::jsonb=v_dupa_comparabil
        AND (p_inainte-ARRAY['executie_teava_id','server_ver','updated_at'])=
            (v_dupa_comparabil-ARRAY['executie_teava_id','server_ver','updated_at']) THEN RETURN true; END IF;
    END IF;
    RAISE EXCEPTION 'E4a context montaj invalid pe %',p_tabel USING ERRCODE='42501';
  END $f$;
   CREATE OR REPLACE FUNCTION public.fn_izo_flux_admin(p_tronson bigint,p_activ boolean,p_motiv text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_pr bigint; v_c public.izo_tronson_config; v_lipsa text[];
  BEGIN
    IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'E4a READ COMMITTED' USING ERRCODE='25001'; END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
    IF session_user<>'postgres' THEN RAISE EXCEPTION 'E4a numai sesiune postgres' USING ERRCODE='42501'; END IF;
    IF coalesce(current_setting('izo.montaj_ctx',true),'')<>'' OR coalesce(current_setting('izo.receptie_ctx',true),'')<>''
      OR coalesce(current_setting('izo.registru_tx',true),'')<>'' THEN RAISE EXCEPTION 'E4a context ocupat'; END IF;
    IF p_activ IS NULL OR length(btrim(coalesce(p_motiv,'')))<3 THEN RAISE EXCEPTION 'E4a parametri flux'; END IF;
    IF p_activ THEN
      v_lipsa:=public.fn_izo_porti_lipsa();
      IF cardinality(v_lipsa)<>0 THEN RAISE EXCEPTION 'E4a porti: %',v_lipsa; END IF;
    END IF;
    LOCK TABLE public.izo_tronson_config,public.executie_tronsoane,public.executie_pachete_lansare,
      public.executie_tevi,public.magazie_bucati,public.magazie_bucati_evenimente IN ACCESS SHARE MODE;
    SELECT proiect_id INTO v_pr FROM public.executie_tronsoane WHERE id=p_tronson;
    IF v_pr IS NULL THEN RAISE EXCEPTION 'E4a tronson lipsa'; END IF;
    PERFORM public.fn_izo_lock_proiect(v_pr,true);
    SELECT * INTO v_c FROM public.izo_tronson_config WHERE tronson_id=p_tronson FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'config_lipsa'; END IF;
    IF v_c.proiect_id<>v_pr THEN RAISE EXCEPTION 'E4a proiect diferit'; END IF;
    IF p_activ THEN
      IF coalesce(public.fn_izo_nivel(v_pr),'off')='off' THEN RAISE EXCEPTION 'E4a nivel off'; END IF;
      -- E4a-1 cannot verify a legare without E4b suduri: fail closed on that row type.
      IF EXISTS(SELECT 1 FROM public.executie_tevi t JOIN public.executie_pachete_lansare p ON p.id=t.pachet_id
        WHERE p.tronson_id=p_tronson AND (coalesce(to_jsonb(t)->>'tip_rand','teava') NOT IN ('teava','curba')
          OR (SELECT count(*) FROM public.magazie_bucati b WHERE b.executie_teava_id=t.id AND b.stare='montata'
            AND b.tronson_id=p_tronson AND b.proiect_id=v_pr
            AND b.tip_cod=coalesce(to_jsonb(t)->>'tip_rand','teava'))<>1))
        THEN RAISE EXCEPTION 'E4a randuri nelegate'; END IF;
      IF EXISTS(SELECT 1 FROM public.executie_pachete_lansare p WHERE p.tronson_id=p_tronson
        AND (to_jsonb(p)->>'aprobat_la' IS NOT NULL OR to_jsonb(p)->>'pdf_aprobare_path' IS NOT NULL
          OR to_jsonb(p)->>'status' IN ('aprobat','lansat','finalizat'))) THEN RAISE EXCEPTION 'E4a antet aprobat'; END IF;
    ELSE
      IF EXISTS(SELECT 1 FROM public.magazie_bucati WHERE tronson_id=p_tronson AND stare IN ('montata','taiata'))
        OR EXISTS(SELECT 1 FROM public.magazie_bucati_miscari m JOIN public.magazie_bucati_evenimente e ON e.id=m.eveniment_id
          WHERE e.proiect_id=v_pr AND e.tip IN ('montaj','taiere') AND
            (m.inainte->>'tronson_id'=p_tronson::text OR m.dupa->>'tronson_id'=p_tronson::text
             OR m.din_loc->>'tronson_id'=p_tronson::text OR m.in_loc->>'tronson_id'=p_tronson::text))
        THEN RAISE EXCEPTION 'E4a fapte montaj; oprire refuzata'; END IF;
      -- Later E4b must replace this entry with checks on declarations/reservations/fronts.
      IF to_regclass('public.izo_declaratii') IS NOT NULL OR to_regclass('public.izo_rezervari') IS NOT NULL
        OR to_regclass('public.izo_fronturi') IS NOT NULL THEN RAISE EXCEPTION 'E4a oprirea necesita garda E4b'; END IF;
    END IF;
    PERFORM set_config('izo.montaj_ctx',txid_current()::text || '|flux|' || p_tronson,true);
    UPDATE public.izo_tronson_config SET flux_montaj=p_activ,flux_de_la=clock_timestamp(),flux_motiv=btrim(p_motiv),
      flux_schimbat_de=session_user,server_ver=nextval('public.izo_server_ver_seq') WHERE tronson_id=p_tronson;
    PERFORM set_config('izo.montaj_ctx','',true);
    RETURN p_activ;
  END $f$;
   CREATE OR REPLACE FUNCTION public.fn_izo_porti_e4_lipsa() RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_lipsa text[]:='{}';
  BEGIN
    IF public.fn_izo_porti_e4_definitii() IS DISTINCT FROM substring(obj_description('public.fn_izo_porti_e4_definitii()'::regprocedure,'pg_proc') FROM '^porti_e4=([0-9a-f]{32})$') THEN
      v_lipsa:=array_append(v_lipsa,'E4 definitii diferite'); END IF;
    IF has_schema_privilege('izo_montaj_writer','public','CREATE') OR EXISTS
      (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='S'
       AND has_sequence_privilege('izo_montaj_writer',c.oid,'USAGE') IS DISTINCT FROM (c.oid='public.izo_server_ver_seq'::regclass))
      THEN v_lipsa:=array_append(v_lipsa,'E4 ACL schema/secvente'); END IF;
    IF EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgname LIKE 'a0_izo_flux_%' AND g.tgenabled<>'A') THEN v_lipsa:=array_append(v_lipsa,'E4 trigger dezactivat'); END IF;
    IF EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_trigger e ON e.tgrelid=g.tgrelid
      WHERE e.tgname IN ('a0_izo_flux_tevi','a0_izo_flux_pachete','a0_izo_flux_documente')
        AND NOT g.tgisinternal AND (g.tgtype::integer & 2)=2 AND g.tgname<e.tgname) THEN v_lipsa:=array_append(v_lipsa,'E4 ordinea BEFORE'); END IF;
    RETURN v_lipsa;
  END $f$;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_e4_lipsa()'::regprocedure) IS DISTINCT FROM '3b22279764515549c47a55e48f5055c3' THEN RAISE EXCEPTION 'E4b E4 gate restore differs'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_flux_admin(bigint,boolean,text)'::regprocedure) IS DISTINCT FROM 'fcd8d97b064ecc27d57bc04fa1a11bf7' THEN RAISE EXCEPTION 'E4b flux restore differs'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_garda_montaj(text,text,jsonb,jsonb)'::regprocedure) IS DISTINCT FROM '717b014983fd9ebf2f1bd03a2decb0db' THEN RAISE EXCEPTION 'E4b guard restore differs'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_lipsa()'::regprocedure) IS DISTINCT FROM '5a4b766ca87edd9879f6fce787e94099' THEN RAISE EXCEPTION 'E4b restore body differs'; END IF;
 DROP VIEW public.v_izo_carantina_sync,public.v_izo_rezervari_active;
 DROP FUNCTION public.fn_izo_porti_e4b_lipsa(),public.fn_izo_porti_e4b_definitii();
 -- Triggers depend on the immutable guard; remove them with the empty tables first.
 DROP FUNCTION public.fn_izo_serie_lamureste(uuid,bigint,integer,timestamptz,bigint,text);
DROP FUNCTION public.fn_izo_serie_intern(uuid,bigint,integer,timestamptz,bigint,text);
DROP FUNCTION public.fn_izo_front_elibereaza(bigint,text);
DROP FUNCTION public.fn_izo_revizie_cere(uuid,bigint,integer,timestamptz,text);
DROP FUNCTION public.fn_izo_respinge(uuid,bigint,integer,timestamptz,text,jsonb);
DROP FUNCTION public.fn_izo_iesire_tronson(uuid,integer,bigint,bigint[],text,date);
DROP FUNCTION public.fn_izo_front_intern(bigint,text);
DROP FUNCTION public.fn_izo_decizie_intern(uuid,bigint,integer,timestamptz,text,jsonb,boolean);
DROP FUNCTION public.fn_izo_dependenti(bigint);
DROP FUNCTION public.fn_izo_iesire_intern(uuid,integer,bigint,bigint[],text,date);
DROP FUNCTION public.fn_izo_aproba(uuid,bigint,jsonb,text,jsonb);
DROP FUNCTION public.fn_izo_aprobare_lot(bigint);
DROP FUNCTION public.fn_izo_aproba_intern(uuid,bigint,jsonb,text,jsonb);
DROP FUNCTION public.fn_izo_birou_jurnal(uuid,text,text,bigint,bigint,jsonb,text,jsonb);
DROP FUNCTION public.fn_izo_aprobare_intern(bigint);
DROP FUNCTION public.fn_izo_birou_preview(bigint);
DROP FUNCTION public.fn_izo_birou_fapt(bigint,text,text,bigint,integer,uuid,text,timestamptz,text);
DROP FUNCTION public.fn_izo_birou_intrare(bigint,integer);
DROP FUNCTION public.fn_izo_birou_autorizat(bigint,integer,boolean);
DROP FUNCTION public.fn_izo_autor_valabil(uuid,bigint,boolean);
DROP FUNCTION public.fn_izo_teren_pregateste(bigint,bigint,uuid);
DROP FUNCTION public.fn_izo_gps_citeste(bigint);
DROP FUNCTION public.fn_izo_sync_push(uuid,jsonb);
DROP FUNCTION public.fn_izo_teren_push(uuid,jsonb);
DROP FUNCTION public.fn_izo_teren_op(uuid,jsonb,jsonb,bigint,text,public.izo_fronturi);
DROP FUNCTION public.fn_izo_teren_payload(jsonb);
DROP FUNCTION public.fn_izo_teren_instantaneu(bigint,bigint);
DROP FUNCTION public.fn_izo_teren_intern(bigint,bigint,uuid,boolean);
DROP FUNCTION public.fn_izo_teren_snapshot(bigint,bigint);
DROP FUNCTION public.fn_izo_pv_lipsa(bigint[]);
DROP FUNCTION public.fn_izo_teren_entra(bigint,text);
DROP FUNCTION public.fn_izo_teren_autorizat(bigint,boolean);
 DROP INDEX public.ux_magbuc_ev_decl;
 REVOKE EXECUTE ON FUNCTION public.fn_izo_uid() FROM izo_montaj_writer;
 REVOKE UPDATE(stare,locatie_tip,depozit_id,tronson_id,atribute) ON public.magazie_bucati FROM izo_montaj_writer;
 REVOKE ALL ON public.magazie_bucati_evenimente,public.magazie_bucati_miscari FROM izo_montaj_writer;
 REVOKE ALL ON SEQUENCE public.magazie_bucati_evenimente_id_seq,public.magazie_bucati_miscari_id_seq FROM izo_montaj_writer;
 DROP POLICY izo_montaj_evenimente_sel ON public.magazie_bucati_evenimente;
 DROP POLICY izo_montaj_evenimente_ins ON public.magazie_bucati_evenimente;
 DROP POLICY izo_montaj_miscari_sel ON public.magazie_bucati_miscari;
 DROP POLICY izo_montaj_miscari_ins ON public.magazie_bucati_miscari;
 DROP TABLE public.izo_aprobari;
DROP TABLE public.izo_rata_apeluri;
DROP TABLE public.izo_sync_incercari;
DROP TABLE public.izo_declaratii_gps;
DROP TABLE public.izo_declaratii_versiuni;
DROP TABLE public.izo_operatii;
DROP TABLE public.izo_rezervari;
DROP TABLE public.izo_bucati_declarate;
DROP TABLE public.izo_declaratii;
DROP TABLE public.izo_preverificari;
DROP TABLE public.izo_dispozitive;
DROP TABLE public.izo_fronturi;
 DROP FUNCTION public.fn_izo_teren_imuabil(),public.fn_izo_decl_ceas();
 REVOKE ALL ON SCHEMA public FROM izo_teren_editor;
 DROP ROLE izo_teren_editor;
 v_impl := (SELECT coalesce(array_agg(x.d ORDER BY x.d COLLATE "C"), '{}'::text[])
       FROM (SELECT DISTINCT format('%s|%s|%s', o.type, o.identity, f.identity) d
               FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid
                    CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
                    CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
              WHERE d.refclassid = 'pg_proc'::regclass AND q.pronamespace = 'public'::regnamespace AND q.proname LIKE 'fn\_izo\_%'
                AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass)) x); IF v_impl IS DISTINCT FROM ARRAY['policy|izo_atr_sel on public.izo_atribuiri|public.fn_izo_citire(bigint)', 'policy|izo_cfg_sel on public.izo_proiect_config|public.fn_izo_citire(bigint)', 'policy|izo_corectii_api_sel on public.izo_corectii|public.fn_izo_citire(bigint)', 'policy|izo_corectii_bucati_api_sel on public.izo_corectii_bucati|public.fn_izo_citire(bigint)', 'policy|izo_doc_api_sel on public.izo_documente_intrare|public.fn_izo_citire(bigint)', 'policy|izo_doc_scan_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_r_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_doc_scan_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_documente_istoric_api_sel on public.izo_documente_istoric|public.fn_izo_citire(bigint)', 'policy|izo_ev_corectie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_receptie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_sel on public.magazie_bucati_evenimente|public.fn_izo_citire(bigint)', 'policy|izo_ev_writer_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_flux_pdf_imuabil_del on storage.objects|public.fn_izo_flux_pdf_blocat(pg_catalog.text,pg_catalog.text)', 'policy|izo_flux_pdf_imuabil_upd on storage.objects|public.fn_izo_flux_pdf_blocat(pg_catalog.text,pg_catalog.text)', 'policy|izo_imp_sel on public.izo_importuri|public.fn_izo_citire(bigint)', 'policy|izo_mis_corectie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_receptie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_sel on public.magazie_bucati_miscari|public.fn_izo_citire(bigint)', 'policy|izo_mis_writer_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_tronson_config_api_sel on public.izo_tronson_config|public.fn_izo_citire(bigint)', 'policy|magbuc_izo_client_del on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_sel on public.magazie_bucati|public.fn_izo_citire(bigint)', 'policy|magbuc_izo_client_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'trigger|a0_izo_flux_config on public.izo_tronson_config|public.fn_izo_flux_config_garda()', 'trigger|a0_izo_flux_documente on public.executie_pachete_documente|public.fn_izo_flux_garda()', 'trigger|a0_izo_flux_pachete on public.executie_pachete_lansare|public.fn_izo_flux_garda()', 'trigger|a0_izo_flux_pachete_dupa on public.executie_pachete_lansare|public.fn_izo_flux_pachet_dupa()', 'trigger|a0_izo_flux_tevi on public.executie_tevi|public.fn_izo_flux_garda()', 'trigger|a0_izo_flux_tronsoane on public.executie_tronsoane|public.fn_izo_flux_garda()', 'trigger|trg_bon_linii_izo_bucata on public.executie_bonuri_consum_linii|public.fn_izo_refuz_bon_bucata()', 'trigger|trg_depozite_izo_mutare on public.logistica_depozite|public.fn_izo_refuz_mutare_depozit()', 'trigger|trg_executie_tevi_izo_delete on public.executie_tevi|public.fn_izo_refuz_delete_tevi()', 'trigger|trg_executie_tevi_izo_mutare on public.executie_tevi|public.fn_izo_refuz_mutare_tevi()', 'trigger|trg_executie_tevi_izo_truncate on public.executie_tevi|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_izo_atr_garda on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_atr_truncate on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_cfg_garda on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cfg_truncate on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cor_garda on public.izo_corectii_bucati|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_garda on public.izo_corectii|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_truncate on public.izo_corectii_bucati|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_truncate on public.izo_corectii|public.fn_izo_cor_garda()', 'trigger|trg_izo_doc_garda on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_ist_garda on public.izo_documente_istoric|public.fn_izo_doc_ist_garda()', 'trigger|trg_izo_doc_ist_truncate on public.izo_documente_istoric|public.fn_izo_doc_ist_garda()', 'trigger|trg_izo_doc_rand_garda on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_truncate on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_garda on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_truncate on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_truncate on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_ev_garda on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_ev_truncate on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_garda on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_truncate on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_garda on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_truncate on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_magbuc_izo_garda on public.magazie_bucati|public.fn_izo_garda_bucati()', 'trigger|trg_magbuc_izo_truncate on public.magazie_bucati|public.fn_izo_garda_truncate_bucati()', 'trigger|trg_pachete_izo_delete on public.executie_pachete_lansare|public.fn_izo_refuz_delete_pachet()', 'trigger|trg_pachete_izo_mutare on public.executie_pachete_lansare|public.fn_izo_refuz_mutare_pachet()', 'trigger|trg_pachete_izo_truncate on public.executie_pachete_lansare|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_proiecte_izo_site on public.executie_proiecte|public.fn_izo_refuz_site_proiect()', 'trigger|trg_tronsoane_izo_mutare on public.executie_tronsoane|public.fn_izo_refuz_mutare_tronson()']::text[] THEN RAISE EXCEPTION 'E4b inventar implicit: %',v_impl; END IF;
 EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L',v_meta->>'porti');
 EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L',v_meta->>'e3');
 EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L',v_meta->>'e3b');
 EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L',v_meta->>'e4');
 EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',v_meta->>'evenimente');
 v_lipsa:=public.fn_izo_porti_lipsa(); IF cardinality(v_lipsa)>0 THEN RAISE EXCEPTION 'E4b restore gates %',v_lipsa; END IF;
   -- <amprenta> (expresie IDENTICĂ în migrare și în revenire — verificată textual de scripts/test_izometrie_e2a.sh)
  SELECT md5(concat_ws(' | ',
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                                coalesce(pg_get_expr(d.adbin, d.adrelid), ''), coalesce(a.attacl::text, '')), ',' ORDER BY c.relname, a.attnum)
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
          AND (c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari')
               OR (c.relname = 'magazie_bucati' AND a.attname IN ('tip_cod','uid','parinte_id','radacina_id','cod_bucata','capat_stanga',
                   'capat_dreapta','serie_canon','dezambiguare','lungime_aviz_mm','lungime_masurata_mm','lungime_mm','lungime_calculata',
                   'lungime_cm','perete_mm','diametru_mm','lot','aviz_intrare_id','nr_crt_aviz','bend_no','capat_marcaj','depozit_id',
                   'tronson_id','server_ver')))),
      (SELECT string_agg(format('%s:%s', c.conname, pg_get_constraintdef(c.oid)), ',' ORDER BY c.conname)
         FROM pg_constraint c WHERE c.conrelid IN ('public.izo_proiect_config'::regclass, 'public.izo_atribuiri'::regclass,
              'public.izo_importuri'::regclass, 'public.magazie_bucati_evenimente'::regclass, 'public.magazie_bucati_miscari'::regclass)
            OR (c.conrelid = 'public.magazie_bucati'::regclass AND (c.conname LIKE 'magazie\_bucati\_izo\_%' OR c.conname IN
                ('magazie_bucati_stare_check','magazie_bucati_locatie_tip_check','magazie_bucati_parinte_id_fkey',
                 'magazie_bucati_radacina_id_fkey','magazie_bucati_depozit_id_fkey','magazie_bucati_tronson_id_fkey')))),
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s:%s', (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname, p.polcmd, p.polpermissive,
                                (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
                                coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                         ',' ORDER BY (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname)
         FROM pg_policy p WHERE p.polname LIKE 'izo\_%' OR p.polname LIKE 'magbuc\_izo\_%'),
      (SELECT string_agg(format('%s:%s', pg_get_triggerdef(g.oid, false), g.tgenabled), ',' ORDER BY g.tgname)
         FROM pg_trigger g WHERE NOT g.tgisinternal AND (g.tgname LIKE 'trg\_izo\_%' OR g.tgname LIKE '%\_izo\_%')),
      (SELECT string_agg(pg_get_indexdef(i.oid), ',' ORDER BY i.relname)
         FROM pg_class i WHERE i.relkind = 'i' AND i.relnamespace = 'public'::regnamespace
          AND (i.relname LIKE 'ux\_magbuc\_izo\_%' OR i.relname LIKE 'ix\_magbuc\_izo\_%' OR i.relname LIKE 'ux\_izo\_%'
               OR i.relname LIKE 'ix\_magbuc\_ev\_%' OR i.relname LIKE 'ix\_magbuc\_mis\_%')),
      (SELECT string_agg(format('%s(%s):%s:%s:%s:%s:%s:%s', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner), p.prosecdef, md5(p.prosrc),
                                coalesce(p.proacl::text, ''), coalesce(p.proconfig::text, ''), p.provolatile), ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_%'),
      (SELECT string_agg(format('%s:%s:%s:%s', c.relname, coalesce(c.relacl::text, ''), c.relrowsecurity, c.relforcerowsecurity), ',' ORDER BY c.relname)
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari',
                            'izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq','magazie_bucati_evenimente_id_seq',
                            'magazie_bucati_miscari_id_seq','magazie_bucati','magazie_bucati_id_seq')),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', c.relname, format_type(s.seqtypid, NULL), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcycle), ',' ORDER BY c.relname)
         FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq',
              'magazie_bucati_evenimente_id_seq','magazie_bucati_miscari_id_seq')),
      (SELECT format('%s:%s:%s:%s:%s', r.rolinherit, r.rolcanlogin, r.rolbypassrls,
                     (SELECT string_agg(format('%s:%s:%s:%s', pg_get_userbyid(m.member), m.admin_option, m.inherit_option, m.set_option), ','
                                       ORDER BY pg_get_userbyid(m.member)::text, m.admin_option, m.inherit_option, m.set_option)
                        FROM pg_auth_members m WHERE m.roleid = r.oid), r.rolsuper)
         FROM pg_roles r WHERE r.rolname = 'izo_registru_writer')))
    INTO v_amprenta;
  -- </amprenta>
 IF v_amprenta IS DISTINCT FROM v_meta->>'amprenta' THEN RAISE EXCEPTION 'E4b restore fingerprint differs'; END IF;
END $revenire$;
