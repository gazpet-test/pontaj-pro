-- GENERAT de scripts/izometrie/e3b_gen/gen_e3b.py. NU se editează manual.
-- 20261105a: E3b piesa A, infrastructură (§2, §3.1/3.5/3.6).
-- Design r5: toate Q-E3b-1..18 = A. Operațiile și gărzile vin în B/C/D.
-- Numai runner; nicio modificare de date. Nu este încă implementarea operațională E3b.
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
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_garda_bucati') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_garda_bucati' LIMIT 1) IS DISTINCT FROM 'b2e1f127c6dd2657ce9f96651642a80e' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_garda_bucati diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_garda_fapte') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_garda_fapte' LIMIT 1) IS DISTINCT FROM '6b1a0093ce9f1fcd812da7c2b3baa1d4' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_garda_fapte diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_doc_garda') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_doc_garda' LIMIT 1) IS DISTINCT FROM '0815d20cd4462b2ce5f3d17123043c3c' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_doc_garda diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_porti_lipsa') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_porti_lipsa' LIMIT 1) IS DISTINCT FROM 'dde0509cb317c6ad51ff33f74ce4a13b' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_porti_lipsa diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_doc_salveaza') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_doc_salveaza' LIMIT 1) IS DISTINCT FROM '7877254e7dc9ec8ebbc16b3ee06e11cf' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_doc_salveaza diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_import_storno') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_import_storno' LIMIT 1) IS DISTINCT FROM 'fe5d3493d096d9851249cd20de8f99b1' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_import_storno diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_doc_anuleaza') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_doc_anuleaza' LIMIT 1) IS DISTINCT FROM '3caaabceb9a09c33ede75dd7bc7b700a' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_doc_anuleaza diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_garda_receptie') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_garda_receptie' LIMIT 1) IS DISTINCT FROM 'e91e2de1cbbfb376253850c63d07bea1' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_garda_receptie diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_import_sold_initial') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_import_sold_initial' LIMIT 1) IS DISTINCT FROM 'e3f65df3705f40e8b5a907b66496acd9' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_import_sold_initial diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_porti_definitii') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_porti_definitii' LIMIT 1) IS DISTINCT FROM 'ad3b94b0eb39955db07e6ec1bd5b5e8f' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_porti_definitii diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_porti_e3_definitii') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_porti_e3_definitii' LIMIT 1) IS DISTINCT FROM 'c318f76c775bbc1e9f91fba7f2817599' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_porti_e3_definitii diferă de migrarea LIVE';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_porti_e3_lipsa') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_porti_e3_lipsa' LIMIT 1) IS DISTINCT FROM 'f8510ff654386d504539ca4bbf2427c7' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_porti_e3_lipsa diferă de migrarea LIVE';
  END IF;
  IF (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
       WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '')
     IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['proiect_id', 'comanda_furnizor_id', 'tip_material_id', 'serie', 'sarja', 'dimensiune', 'grad_otel', 'standard', 'lungime_m', 'lungime_originala_m', 'greutate_kg', 'unghi_curba', 'cantitate', 'um', 'provenienta', 'izolatie', 'furnizor', 'producator', 'sursa_receptie', 'fara_packing_list', 'nr_document', 'data_receptie', 'mtc_path', 'stare', 'locatie_tip', 'locatie_site_id', 'executie_teava_id', 'atribute', 'observatii', 'receptionat_de', 'receptionat_la', 'created_by', 'tip_cod', 'parinte_id', 'cod_bucata', 'capat_stanga', 'capat_dreapta', 'dezambiguare', 'lungime_aviz_mm', 'lungime_masurata_mm', 'lungime_mm', 'lungime_calculata', 'perete_mm', 'diametru_mm', 'lot', 'aviz_intrare_id', 'nr_crt_aviz', 'bend_no', 'capat_marcaj', 'depozit_id', 'tronson_id']::text[] || ARRAY['id','uid','radacina_id','server_ver','created_at','updated_at']) x)
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> '')
        IS DISTINCT FROM ARRAY['lungime_cm','serie_canon']
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['tip', 'proiect_id', 'document_tip', 'document_id', 'import_id', 'storno_de_eveniment_id', 'motiv', 'declarat_de', 'aplicat_de', 'aplicat_rol', 'ora_tableta', 'dispozitiv_id']::text[] || ARRAY['id','server_ver','ora_server']) x)
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['eveniment_id', 'proiect_id', 'bucata_id', 'rol', 'stare_inainte', 'stare_dupa', 'din_loc', 'in_loc', 'lungime_mm', 'inainte', 'dupa']::text[] || ARRAY['id','server_ver']) x) THEN
    RAISE EXCEPTION 'Precondiție 0e: coloanele registrului (magazie_bucati / evenimente / mișcări) diferă de lista revizuită (C)';
  END IF;

  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.magazie_bucati_evenimente'::regclass
         AND conname = 'magazie_bucati_evenimente_tip_check')) IS DISTINCT FROM 'CHECK ((tip = ANY (ARRAY[''sold_initial''::text, ''intrare_aviz''::text, ''gasit''::text, ''iesire_tranzit''::text, ''livrare''::text, ''retur_fizic''::text, ''confirmare_primire_depozit''::text, ''mutare_tronson''::text, ''taiere''::text, ''montaj''::text, ''demontaj''::text, ''deseu''::text, ''pierdut''::text, ''inventar_ajustare''::text, ''corectie''::text, ''corectie_radacina''::text, ''storno''::text, ''intrare_lista_ambalare''::text, ''receptie_pv''::text])))' THEN
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
  v_impl := (SELECT coalesce(array_agg(x.d ORDER BY x.d COLLATE "C"), '{}'::text[])
       FROM (SELECT DISTINCT format('%s|%s|%s', o.type, o.identity, f.identity) d
               FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid
                    CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
                    CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
              WHERE d.refclassid = 'pg_proc'::regclass AND q.pronamespace = 'public'::regnamespace AND q.proname LIKE 'fn\_izo\_%'
                AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass)) x);
  v_impl_rev := ARRAY['policy|izo_atr_sel on public.izo_atribuiri|public.fn_izo_citire(bigint)', 'policy|izo_cfg_sel on public.izo_proiect_config|public.fn_izo_citire(bigint)', 'policy|izo_doc_api_sel on public.izo_documente_intrare|public.fn_izo_citire(bigint)', 'policy|izo_doc_scan_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_r_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_doc_scan_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_ev_receptie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_sel on public.magazie_bucati_evenimente|public.fn_izo_citire(bigint)', 'policy|izo_ev_writer_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_imp_sel on public.izo_importuri|public.fn_izo_citire(bigint)', 'policy|izo_mis_receptie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_sel on public.magazie_bucati_miscari|public.fn_izo_citire(bigint)', 'policy|izo_mis_writer_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_del on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_sel on public.magazie_bucati|public.fn_izo_citire(bigint)', 'policy|magbuc_izo_client_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'trigger|trg_bon_linii_izo_bucata on public.executie_bonuri_consum_linii|public.fn_izo_refuz_bon_bucata()', 'trigger|trg_depozite_izo_mutare on public.logistica_depozite|public.fn_izo_refuz_mutare_depozit()', 'trigger|trg_executie_tevi_izo_delete on public.executie_tevi|public.fn_izo_refuz_delete_tevi()', 'trigger|trg_executie_tevi_izo_mutare on public.executie_tevi|public.fn_izo_refuz_mutare_tevi()', 'trigger|trg_executie_tevi_izo_truncate on public.executie_tevi|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_izo_atr_garda on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_atr_truncate on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_cfg_garda on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cfg_truncate on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_doc_garda on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_garda on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_truncate on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_garda on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_truncate on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_truncate on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_ev_garda on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_ev_truncate on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_garda on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_truncate on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_garda on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_truncate on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_magbuc_izo_garda on public.magazie_bucati|public.fn_izo_garda_bucati()', 'trigger|trg_magbuc_izo_truncate on public.magazie_bucati|public.fn_izo_garda_truncate_bucati()', 'trigger|trg_pachete_izo_delete on public.executie_pachete_lansare|public.fn_izo_refuz_delete_pachet()', 'trigger|trg_pachete_izo_mutare on public.executie_pachete_lansare|public.fn_izo_refuz_mutare_pachet()', 'trigger|trg_pachete_izo_truncate on public.executie_pachete_lansare|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_proiecte_izo_site on public.executie_proiecte|public.fn_izo_refuz_site_proiect()', 'trigger|trg_tronsoane_izo_mutare on public.executie_tronsoane|public.fn_izo_refuz_mutare_tronson()']::text[];
  IF v_impl IS DISTINCT FROM v_impl_rev THEN
    RAISE EXCEPTION 'E3b invocări implicite (baseline înainte): actual % / așteptat %', v_impl, v_impl_rev;
  END IF;
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
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magazie_bucati_evenimente_tip_check CHECK (tip IN ('sold_initial', 'intrare_aviz', 'gasit', 'iesire_tranzit', 'livrare', 'retur_fizic', 'confirmare_primire_depozit', 'mutare_tronson', 'taiere', 'montaj', 'demontaj', 'deseu', 'pierdut', 'inventar_ajustare', 'corectie', 'corectie_radacina', 'storno', 'intrare_lista_ambalare', 'receptie_pv', 'carantina_intrare', 'carantina_iesire', 'storno_partial'));
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magbuc_ev_e3b_motiv
    CHECK (tip NOT IN ('carantina_intrare','carantina_iesire','storno_partial') OR motiv IS NOT NULL);
  CREATE UNIQUE INDEX ux_magbuc_ev_corectie ON public.magazie_bucati_evenimente(document_id) WHERE document_tip = 'izo_corectie';

  CREATE FUNCTION public.fn_izo_coloane_corectabile(p_tip_cod text) RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT CASE p_tip_cod WHEN 'teava' THEN ARRAY['serie', 'sarja', 'lot', 'perete_mm', 'diametru_mm', 'greutate_kg', 'dimensiune', 'grad_otel', 'standard', 'izolatie', 'lungime_aviz_mm', 'lungime_masurata_mm']::text[] WHEN 'curba' THEN ARRAY['serie', 'sarja', 'lot', 'perete_mm', 'diametru_mm', 'greutate_kg', 'dimensiune', 'grad_otel', 'standard', 'izolatie', 'unghi_curba']::text[] ELSE '{}'::text[] END
  $f$;
  CREATE FUNCTION public.fn_izo_coloane_identitate() RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT ARRAY['serie', 'sarja', 'lot', 'lungime_aviz_mm', 'lungime_masurata_mm', 'unghi_curba']::text[]
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
  CREATE POLICY izo_corectii_api_sel ON public.izo_corectii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_izo_citire(proiect_id));
  CREATE POLICY izo_corectii_bucati_api_sel ON public.izo_corectii_bucati FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.izo_corectii c WHERE c.id = corectie_id AND public.fn_izo_citire(c.proiect_id)));
  CREATE POLICY izo_documente_istoric_api_sel ON public.izo_documente_istoric FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.izo_documente_intrare d WHERE d.id = document_id AND public.fn_izo_citire(d.proiect_id)));
  CREATE POLICY izo_corectii_coreditor_select ON public.izo_corectii FOR SELECT TO izo_cor_editor USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_corectii_bucati_coreditor_select ON public.izo_corectii_bucati FOR SELECT TO izo_cor_editor USING (corectie_id IS NOT NULL);
  CREATE POLICY magbuc_izo_coreditor_sel ON public.magazie_bucati FOR SELECT TO izo_cor_editor USING (provenienta = 'beneficiar');
  CREATE POLICY izo_ev_coreditor_sel ON public.magazie_bucati_evenimente FOR SELECT TO izo_cor_editor USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_mis_coreditor_sel ON public.magazie_bucati_miscari FOR SELECT TO izo_cor_editor USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_doc_coreditor_sel ON public.izo_documente_intrare FOR SELECT TO izo_cor_editor USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_corectii_corectie_select ON public.izo_corectii FOR SELECT TO izo_corectie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_corectii_bucati_corectie_select ON public.izo_corectii_bucati FOR SELECT TO izo_corectie_writer USING (corectie_id IS NOT NULL);
  CREATE POLICY magbuc_izo_corectie_sel ON public.magazie_bucati FOR SELECT TO izo_corectie_writer USING (provenienta = 'beneficiar');
  CREATE POLICY izo_ev_corectie_sel ON public.magazie_bucati_evenimente FOR SELECT TO izo_corectie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_mis_corectie_sel ON public.magazie_bucati_miscari FOR SELECT TO izo_corectie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_doc_corectie_sel ON public.izo_documente_intrare FOR SELECT TO izo_corectie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_corectii_coreditor_insert ON public.izo_corectii FOR INSERT TO izo_cor_editor WITH CHECK (proiect_id IS NOT NULL);
  CREATE POLICY izo_corectii_coreditor_update ON public.izo_corectii FOR UPDATE TO izo_cor_editor USING (proiect_id IS NOT NULL) WITH CHECK (proiect_id IS NOT NULL);
  CREATE POLICY izo_corectii_corectie_insert ON public.izo_corectii FOR INSERT TO izo_corectie_writer WITH CHECK (proiect_id IS NOT NULL);
  CREATE POLICY izo_corectii_corectie_update ON public.izo_corectii FOR UPDATE TO izo_corectie_writer USING (proiect_id IS NOT NULL) WITH CHECK (proiect_id IS NOT NULL);
  CREATE POLICY izo_corectii_bucati_corectie_insert ON public.izo_corectii_bucati FOR INSERT TO izo_corectie_writer WITH CHECK (corectie_id IS NOT NULL);
  CREATE POLICY izo_documente_istoric_doceditor_select ON public.izo_documente_istoric FOR SELECT TO izo_doc_editor USING (document_id IS NOT NULL);
  CREATE POLICY izo_documente_istoric_doceditor_insert ON public.izo_documente_istoric FOR INSERT TO izo_doc_editor WITH CHECK (document_id IS NOT NULL);
  CREATE POLICY izo_imp_corectie_sel ON public.izo_importuri FOR SELECT TO izo_corectie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY magbuc_izo_corectie_ins ON public.magazie_bucati FOR INSERT TO izo_corectie_writer WITH CHECK (provenienta = 'beneficiar' AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc','montaj'));
  CREATE POLICY magbuc_izo_corectie_upd ON public.magazie_bucati FOR UPDATE TO izo_corectie_writer USING (provenienta = 'beneficiar' AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc','montaj')) WITH CHECK (provenienta = 'beneficiar' AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc','montaj'));
  CREATE POLICY izo_ev_corectie_ins ON public.magazie_bucati_evenimente FOR INSERT TO izo_corectie_writer WITH CHECK (proiect_id IS NOT NULL AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc','montaj'));
  CREATE POLICY izo_mis_corectie_ins ON public.magazie_bucati_miscari FOR INSERT TO izo_corectie_writer WITH CHECK (proiect_id IS NOT NULL AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc','montaj'));
  CREATE POLICY izo_doc_corectie_upd ON public.izo_documente_intrare FOR UPDATE TO izo_corectie_writer USING (proiect_id IS NOT NULL) WITH CHECK (proiect_id IS NOT NULL);
  GRANT SELECT ON public.izo_corectii TO authenticated;
  GRANT SELECT ON public.izo_corectii_bucati TO authenticated;
  GRANT SELECT ON public.izo_documente_istoric TO authenticated;
  GRANT SELECT ON public.izo_corectii TO izo_cor_editor;
  GRANT SELECT ON public.izo_corectii_bucati TO izo_cor_editor;
  GRANT SELECT ON public.magazie_bucati TO izo_cor_editor;
  GRANT SELECT ON public.magazie_bucati_evenimente TO izo_cor_editor;
  GRANT SELECT ON public.magazie_bucati_miscari TO izo_cor_editor;
  GRANT SELECT ON public.izo_documente_intrare TO izo_cor_editor;
  GRANT SELECT ON public.izo_corectii TO izo_corectie_writer;
  GRANT SELECT ON public.izo_corectii_bucati TO izo_corectie_writer;
  GRANT SELECT ON public.magazie_bucati TO izo_corectie_writer;
  GRANT SELECT ON public.magazie_bucati_evenimente TO izo_corectie_writer;
  GRANT SELECT ON public.magazie_bucati_miscari TO izo_corectie_writer;
  GRANT SELECT ON public.izo_documente_intrare TO izo_corectie_writer;
  GRANT INSERT (proiect_id, tip, bucata_id, document_intrare_id, inainte, dupa, ncr_ref, motiv, stare, versiune, cale, propus_de, propus_rol, propus_la) ON public.izo_corectii TO izo_cor_editor;
  GRANT UPDATE (stare, versiune, decis_de, decis_rol, decis_la, motiv_decizie) ON public.izo_corectii TO izo_cor_editor;
  GRANT INSERT (proiect_id, tip, bucata_id, document_intrare_id, inainte, dupa, ncr_ref, motiv, stare, versiune, cale, propus_de, propus_rol, propus_la, import_id) ON public.izo_corectii TO izo_corectie_writer;
  GRANT UPDATE (stare, versiune, decis_de, decis_rol, decis_la, eveniment_id, bucata_id) ON public.izo_corectii TO izo_corectie_writer;
  GRANT INSERT ON public.izo_corectii_bucati TO izo_corectie_writer;
  GRANT SELECT ON public.izo_documente_istoric TO izo_doc_editor;
  GRANT INSERT (document_id, versiune, salvat_de, salvat_rol, salvat_la, continut, hash, diff, baza) ON public.izo_documente_istoric TO izo_doc_editor;
  GRANT SELECT ON public.izo_importuri TO izo_corectie_writer;
  GRANT INSERT (proiect_id, comanda_furnizor_id, tip_material_id, serie, sarja, dimensiune, grad_otel, standard, lungime_m, lungime_originala_m, greutate_kg, unghi_curba, cantitate, um, provenienta, izolatie, furnizor, producator, sursa_receptie, fara_packing_list, nr_document, data_receptie, mtc_path, stare, locatie_tip, locatie_site_id, executie_teava_id, atribute, observatii, receptionat_de, receptionat_la, created_by, tip_cod, parinte_id, cod_bucata, capat_stanga, capat_dreapta, dezambiguare, lungime_aviz_mm, lungime_masurata_mm, lungime_mm, lungime_calculata, perete_mm, diametru_mm, lot, aviz_intrare_id, nr_crt_aviz, bend_no, capat_marcaj, depozit_id, tronson_id, id, uid, radacina_id, server_ver) ON public.magazie_bucati TO izo_corectie_writer;
  GRANT UPDATE (depozit_id, diametru_mm, dimensiune, grad_otel, greutate_kg, izolatie, lot, lungime_aviz_mm, lungime_m, lungime_masurata_mm, lungime_mm, lungime_originala_m, perete_mm, sarja, serie, server_ver, standard, stare, unghi_curba, updated_at) ON public.magazie_bucati TO izo_corectie_writer;
  GRANT INSERT ON public.magazie_bucati_evenimente TO izo_corectie_writer;
  GRANT INSERT ON public.magazie_bucati_miscari TO izo_corectie_writer;
  GRANT UPDATE (pv_nr, pv_nr_canon, pv_data, versiune, updated_at) ON public.izo_documente_intrare TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_jwt_rol() TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_uid() TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_porti_lipsa() TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_nivel(bigint) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_citire(bigint) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_site_proiect(bigint) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_tip_cod(integer) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_tip_material(text) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_loc_valid(bigint, integer, bigint) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_proiectie(jsonb, text[]) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_coloane_c() TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_coloane_ev() TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_coloane_mis() TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_canon_serie(text) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_hash(bigint) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_coloane_corectabile(text) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_coloane_identitate() TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_garda_scriitor() TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[]) TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_blocheaza_tabele() TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_lock_partajat(bigint[]) TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_lock_proiect(bigint, boolean) TO izo_corectie_writer;
  GRANT USAGE ON SEQUENCE public.magazie_bucati_id_seq, public.izo_server_ver_seq, public.magazie_bucati_evenimente_id_seq, public.magazie_bucati_miscari_id_seq TO izo_corectie_writer;

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
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_corectii SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_corectii INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_corectii UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_corectii REFERENCES'); END IF;
    IF has_table_privilege('anon', 'public.izo_corectii', 'DELETE') THEN v := array_append(v, 'ACL anon izo_corectii DELETE'); END IF;
    IF has_table_privilege('anon', 'public.izo_corectii', 'TRUNCATE') THEN v := array_append(v, 'ACL anon izo_corectii TRUNCATE'); END IF;
    IF has_table_privilege('anon', 'public.izo_corectii', 'TRIGGER') THEN v := array_append(v, 'ACL anon izo_corectii TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_corectii_bucati SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_corectii_bucati INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_corectii_bucati UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_corectii_bucati REFERENCES'); END IF;
    IF has_table_privilege('anon', 'public.izo_corectii_bucati', 'DELETE') THEN v := array_append(v, 'ACL anon izo_corectii_bucati DELETE'); END IF;
    IF has_table_privilege('anon', 'public.izo_corectii_bucati', 'TRUNCATE') THEN v := array_append(v, 'ACL anon izo_corectii_bucati TRUNCATE'); END IF;
    IF has_table_privilege('anon', 'public.izo_corectii_bucati', 'TRIGGER') THEN v := array_append(v, 'ACL anon izo_corectii_bucati TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_documente_istoric SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_documente_istoric INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_documente_istoric UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('anon', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL anon izo_documente_istoric REFERENCES'); END IF;
    IF has_table_privilege('anon', 'public.izo_documente_istoric', 'DELETE') THEN v := array_append(v, 'ACL anon izo_documente_istoric DELETE'); END IF;
    IF has_table_privilege('anon', 'public.izo_documente_istoric', 'TRUNCATE') THEN v := array_append(v, 'ACL anon izo_documente_istoric TRUNCATE'); END IF;
    IF has_table_privilege('anon', 'public.izo_documente_istoric', 'TRIGGER') THEN v := array_append(v, 'ACL anon izo_documente_istoric TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL authenticated izo_corectii SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL authenticated izo_corectii INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL authenticated izo_corectii UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL authenticated izo_corectii REFERENCES'); END IF;
    IF has_table_privilege('authenticated', 'public.izo_corectii', 'DELETE') THEN v := array_append(v, 'ACL authenticated izo_corectii DELETE'); END IF;
    IF has_table_privilege('authenticated', 'public.izo_corectii', 'TRUNCATE') THEN v := array_append(v, 'ACL authenticated izo_corectii TRUNCATE'); END IF;
    IF has_table_privilege('authenticated', 'public.izo_corectii', 'TRIGGER') THEN v := array_append(v, 'ACL authenticated izo_corectii TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL authenticated izo_corectii_bucati SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL authenticated izo_corectii_bucati INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL authenticated izo_corectii_bucati UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL authenticated izo_corectii_bucati REFERENCES'); END IF;
    IF has_table_privilege('authenticated', 'public.izo_corectii_bucati', 'DELETE') THEN v := array_append(v, 'ACL authenticated izo_corectii_bucati DELETE'); END IF;
    IF has_table_privilege('authenticated', 'public.izo_corectii_bucati', 'TRUNCATE') THEN v := array_append(v, 'ACL authenticated izo_corectii_bucati TRUNCATE'); END IF;
    IF has_table_privilege('authenticated', 'public.izo_corectii_bucati', 'TRIGGER') THEN v := array_append(v, 'ACL authenticated izo_corectii_bucati TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL authenticated izo_documente_istoric SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL authenticated izo_documente_istoric INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL authenticated izo_documente_istoric UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL authenticated izo_documente_istoric REFERENCES'); END IF;
    IF has_table_privilege('authenticated', 'public.izo_documente_istoric', 'DELETE') THEN v := array_append(v, 'ACL authenticated izo_documente_istoric DELETE'); END IF;
    IF has_table_privilege('authenticated', 'public.izo_documente_istoric', 'TRUNCATE') THEN v := array_append(v, 'ACL authenticated izo_documente_istoric TRUNCATE'); END IF;
    IF has_table_privilege('authenticated', 'public.izo_documente_istoric', 'TRIGGER') THEN v := array_append(v, 'ACL authenticated izo_documente_istoric TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_corectii SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_corectii INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_corectii UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_corectii REFERENCES'); END IF;
    IF has_table_privilege('service_role', 'public.izo_corectii', 'DELETE') THEN v := array_append(v, 'ACL service_role izo_corectii DELETE'); END IF;
    IF has_table_privilege('service_role', 'public.izo_corectii', 'TRUNCATE') THEN v := array_append(v, 'ACL service_role izo_corectii TRUNCATE'); END IF;
    IF has_table_privilege('service_role', 'public.izo_corectii', 'TRIGGER') THEN v := array_append(v, 'ACL service_role izo_corectii TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_corectii_bucati SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_corectii_bucati INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_corectii_bucati UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_corectii_bucati REFERENCES'); END IF;
    IF has_table_privilege('service_role', 'public.izo_corectii_bucati', 'DELETE') THEN v := array_append(v, 'ACL service_role izo_corectii_bucati DELETE'); END IF;
    IF has_table_privilege('service_role', 'public.izo_corectii_bucati', 'TRUNCATE') THEN v := array_append(v, 'ACL service_role izo_corectii_bucati TRUNCATE'); END IF;
    IF has_table_privilege('service_role', 'public.izo_corectii_bucati', 'TRIGGER') THEN v := array_append(v, 'ACL service_role izo_corectii_bucati TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_documente_istoric SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_documente_istoric INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_documente_istoric UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('service_role', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL service_role izo_documente_istoric REFERENCES'); END IF;
    IF has_table_privilege('service_role', 'public.izo_documente_istoric', 'DELETE') THEN v := array_append(v, 'ACL service_role izo_documente_istoric DELETE'); END IF;
    IF has_table_privilege('service_role', 'public.izo_documente_istoric', 'TRUNCATE') THEN v := array_append(v, 'ACL service_role izo_documente_istoric TRUNCATE'); END IF;
    IF has_table_privilege('service_role', 'public.izo_documente_istoric', 'TRIGGER') THEN v := array_append(v, 'ACL service_role izo_documente_istoric TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii REFERENCES'); END IF;
    IF has_table_privilege('izo_doc_editor', 'public.izo_corectii', 'DELETE') THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii DELETE'); END IF;
    IF has_table_privilege('izo_doc_editor', 'public.izo_corectii', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii TRUNCATE'); END IF;
    IF has_table_privilege('izo_doc_editor', 'public.izo_corectii', 'TRIGGER') THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii_bucati SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii_bucati INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii_bucati UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii_bucati REFERENCES'); END IF;
    IF has_table_privilege('izo_doc_editor', 'public.izo_corectii_bucati', 'DELETE') THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii_bucati DELETE'); END IF;
    IF has_table_privilege('izo_doc_editor', 'public.izo_corectii_bucati', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii_bucati TRUNCATE'); END IF;
    IF has_table_privilege('izo_doc_editor', 'public.izo_corectii_bucati', 'TRIGGER') THEN v := array_append(v, 'ACL izo_doc_editor izo_corectii_bucati TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_doc_editor izo_documente_istoric SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (a.attname::text = ANY (ARRAY['document_id', 'versiune', 'salvat_de', 'salvat_rol', 'salvat_la', 'continut', 'hash', 'diff', 'baza']::text[]))) THEN v := array_append(v, 'ACL izo_doc_editor izo_documente_istoric INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_documente_istoric UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_doc_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_doc_editor izo_documente_istoric REFERENCES'); END IF;
    IF has_table_privilege('izo_doc_editor', 'public.izo_documente_istoric', 'DELETE') THEN v := array_append(v, 'ACL izo_doc_editor izo_documente_istoric DELETE'); END IF;
    IF has_table_privilege('izo_doc_editor', 'public.izo_documente_istoric', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_doc_editor izo_documente_istoric TRUNCATE'); END IF;
    IF has_table_privilege('izo_doc_editor', 'public.izo_documente_istoric', 'TRIGGER') THEN v := array_append(v, 'ACL izo_doc_editor izo_documente_istoric TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (a.attname::text = ANY (ARRAY['proiect_id', 'tip', 'bucata_id', 'document_intrare_id', 'inainte', 'dupa', 'ncr_ref', 'motiv', 'stare', 'versiune', 'cale', 'propus_de', 'propus_rol', 'propus_la']::text[]))) THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (a.attname::text = ANY (ARRAY['stare', 'versiune', 'decis_de', 'decis_rol', 'decis_la', 'motiv_decizie']::text[]))) THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_corectii', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_corectii', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_corectii', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii_bucati SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii_bucati INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii_bucati UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii_bucati REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_corectii_bucati', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii_bucati DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_corectii_bucati', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii_bucati TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_corectii_bucati', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor izo_corectii_bucati TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_istoric SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_istoric INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_istoric UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_istoric REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_documente_istoric', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_istoric DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_documente_istoric', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_istoric TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_documente_istoric', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_istoric TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.magazie_bucati', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.magazie_bucati', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.magazie_bucati', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_evenimente SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_evenimente INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_evenimente UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_evenimente REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.magazie_bucati_evenimente', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_evenimente DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.magazie_bucati_evenimente', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_evenimente TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.magazie_bucati_evenimente', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_evenimente TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_miscari SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_miscari INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_miscari UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_miscari REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.magazie_bucati_miscari', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_miscari DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.magazie_bucati_miscari', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_miscari TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.magazie_bucati_miscari', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor magazie_bucati_miscari TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_intrare'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_intrare SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_intrare'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_intrare INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_intrare'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_intrare UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_intrare'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_intrare REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_documente_intrare', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_intrare DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_documente_intrare', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_intrare TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_documente_intrare', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor izo_documente_intrare TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_importuri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_importuri SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_importuri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_importuri INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_importuri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_importuri UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_importuri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_importuri REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_importuri', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor izo_importuri DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_importuri', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor izo_importuri TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_importuri', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor izo_importuri TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_proiect_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_proiect_config SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_proiect_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_proiect_config INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_proiect_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_proiect_config UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_proiect_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_proiect_config REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_proiect_config', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor izo_proiect_config DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_proiect_config', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor izo_proiect_config TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_proiect_config', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor izo_proiect_config TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_atribuiri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_atribuiri SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_atribuiri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_atribuiri INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_atribuiri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_atribuiri UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_atribuiri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_cor_editor', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_cor_editor izo_atribuiri REFERENCES'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_atribuiri', 'DELETE') THEN v := array_append(v, 'ACL izo_cor_editor izo_atribuiri DELETE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_atribuiri', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_cor_editor izo_atribuiri TRUNCATE'); END IF;
    IF has_table_privilege('izo_cor_editor', 'public.izo_atribuiri', 'TRIGGER') THEN v := array_append(v, 'ACL izo_cor_editor izo_atribuiri TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (a.attname::text = ANY (ARRAY['proiect_id', 'tip', 'bucata_id', 'document_intrare_id', 'inainte', 'dupa', 'ncr_ref', 'motiv', 'stare', 'versiune', 'cale', 'propus_de', 'propus_rol', 'propus_la', 'import_id']::text[]))) THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (a.attname::text = ANY (ARRAY['stare', 'versiune', 'decis_de', 'decis_rol', 'decis_la', 'eveniment_id', 'bucata_id']::text[]))) THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_corectii', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_corectii', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_corectii', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii_bucati SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii_bucati INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii_bucati UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_corectii_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii_bucati REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_corectii_bucati', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii_bucati DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_corectii_bucati', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii_bucati TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_corectii_bucati', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer izo_corectii_bucati TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_istoric SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_istoric INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_istoric UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_istoric'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_istoric REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_documente_istoric', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_istoric DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_documente_istoric', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_istoric TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_documente_istoric', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_istoric TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (a.attname::text = ANY (ARRAY['proiect_id', 'comanda_furnizor_id', 'tip_material_id', 'serie', 'sarja', 'dimensiune', 'grad_otel', 'standard', 'lungime_m', 'lungime_originala_m', 'greutate_kg', 'unghi_curba', 'cantitate', 'um', 'provenienta', 'izolatie', 'furnizor', 'producator', 'sursa_receptie', 'fara_packing_list', 'nr_document', 'data_receptie', 'mtc_path', 'stare', 'locatie_tip', 'locatie_site_id', 'executie_teava_id', 'atribute', 'observatii', 'receptionat_de', 'receptionat_la', 'created_by', 'tip_cod', 'parinte_id', 'cod_bucata', 'capat_stanga', 'capat_dreapta', 'dezambiguare', 'lungime_aviz_mm', 'lungime_masurata_mm', 'lungime_mm', 'lungime_calculata', 'perete_mm', 'diametru_mm', 'lot', 'aviz_intrare_id', 'nr_crt_aviz', 'bend_no', 'capat_marcaj', 'depozit_id', 'tronson_id', 'id', 'uid', 'radacina_id', 'server_ver']::text[]))) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (a.attname::text = ANY (ARRAY['depozit_id', 'diametru_mm', 'dimensiune', 'grad_otel', 'greutate_kg', 'izolatie', 'lot', 'lungime_aviz_mm', 'lungime_m', 'lungime_masurata_mm', 'lungime_mm', 'lungime_originala_m', 'perete_mm', 'sarja', 'serie', 'server_ver', 'standard', 'stare', 'unghi_curba', 'updated_at']::text[]))) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.magazie_bucati', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.magazie_bucati', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.magazie_bucati', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_evenimente SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_evenimente INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_evenimente UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_evenimente REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.magazie_bucati_evenimente', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_evenimente DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.magazie_bucati_evenimente', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_evenimente TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.magazie_bucati_evenimente', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_evenimente TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_miscari SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_miscari INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_miscari UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_miscari REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.magazie_bucati_miscari', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_miscari DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.magazie_bucati_miscari', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_miscari TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.magazie_bucati_miscari', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer magazie_bucati_miscari TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_intrare'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_intrare SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_intrare'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_intrare INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_intrare'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (a.attname::text = ANY (ARRAY['pv_nr', 'pv_nr_canon', 'pv_data', 'versiune', 'updated_at']::text[]))) THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_intrare UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_documente_intrare'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_intrare REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_documente_intrare', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_intrare DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_documente_intrare', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_intrare TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_documente_intrare', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer izo_documente_intrare TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_importuri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (true)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_importuri SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_importuri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_importuri INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_importuri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_importuri UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_importuri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_importuri REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_importuri', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_importuri DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_importuri', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_importuri TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_importuri', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer izo_importuri TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_proiect_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_proiect_config SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_proiect_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_proiect_config INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_proiect_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_proiect_config UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_proiect_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_proiect_config REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_proiect_config', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_proiect_config DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_proiect_config', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_proiect_config TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_proiect_config', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer izo_proiect_config TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_atribuiri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'SELECT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_atribuiri SELECT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_atribuiri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'INSERT') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_atribuiri INSERT'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_atribuiri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'UPDATE') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_atribuiri UPDATE'); END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.izo_atribuiri'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('izo_corectie_writer', a.attrelid, a.attname, 'REFERENCES') IS DISTINCT FROM (false)) THEN v := array_append(v, 'ACL izo_corectie_writer izo_atribuiri REFERENCES'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_atribuiri', 'DELETE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_atribuiri DELETE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_atribuiri', 'TRUNCATE') THEN v := array_append(v, 'ACL izo_corectie_writer izo_atribuiri TRUNCATE'); END IF;
    IF has_table_privilege('izo_corectie_writer', 'public.izo_atribuiri', 'TRIGGER') THEN v := array_append(v, 'ACL izo_corectie_writer izo_atribuiri TRIGGER'); END IF;
    IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relkind = 'S' AND has_sequence_privilege('izo_cor_editor', c.oid, 'USAGE') IS DISTINCT FROM (c.oid = ANY (ARRAY[]::text[]::regclass[]))) THEN v := array_append(v, 'USAGE secvențe izo_cor_editor'); END IF;
    IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relkind = 'S' AND has_sequence_privilege('izo_corectie_writer', c.oid, 'USAGE') IS DISTINCT FROM (c.oid = ANY (ARRAY['public.magazie_bucati_id_seq', 'public.izo_server_ver_seq', 'public.magazie_bucati_evenimente_id_seq', 'public.magazie_bucati_miscari_id_seq']::text[]::regclass[]))) THEN v := array_append(v, 'USAGE secvențe izo_corectie_writer'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_jwt_rol()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_jwt_rol()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_jwt_rol()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_jwt_rol()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_uid()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_uid()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_uid()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_uid()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_porti_lipsa()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_porti_lipsa()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_porti_lipsa()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_porti_lipsa()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_nivel(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_nivel(bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_nivel(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_nivel(bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_citire(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_citire(bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_citire(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_citire(bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_site_proiect(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_site_proiect(bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_site_proiect(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_site_proiect(bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_tip_cod(integer)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_tip_cod(integer)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_tip_cod(integer)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_tip_cod(integer)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_tip_material(text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_tip_material(text)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_tip_material(text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_tip_material(text)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_loc_valid(bigint, integer, bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_loc_valid(bigint, integer, bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_loc_valid(bigint, integer, bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_loc_valid(bigint, integer, bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_proiectie(jsonb, text[])', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_proiectie(jsonb, text[])'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_proiectie(jsonb, text[])', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_proiectie(jsonb, text[])'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_coloane_c()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_coloane_c()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_coloane_c()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_coloane_c()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_coloane_ev()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_coloane_ev()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_coloane_ev()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_coloane_ev()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_coloane_mis()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_coloane_mis()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_coloane_mis()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_coloane_mis()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_canon_serie(text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_canon_serie(text)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_canon_serie(text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_canon_serie(text)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_doc_hash(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_doc_hash(bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_doc_hash(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_doc_hash(bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_coloane_corectabile(text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_coloane_corectabile(text)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_coloane_corectabile(text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_coloane_corectabile(text)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_coloane_identitate()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_coloane_identitate()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_coloane_identitate()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_coloane_identitate()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_garda_scriitor()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_garda_scriitor()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_garda_scriitor()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_garda_scriitor()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[])'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[])', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[])'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_blocheaza_tabele()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_blocheaza_tabele()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_blocheaza_tabele()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_blocheaza_tabele()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_lock_partajat(bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_lock_partajat(bigint[])'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_lock_partajat(bigint[])', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_lock_partajat(bigint[])'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_lock_proiect(bigint, boolean)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_lock_proiect(bigint, boolean)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_lock_proiect(bigint, boolean)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_lock_proiect(bigint, boolean)'); END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN unnest(ARRAY['anon','service_role']) api(n)
        WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn\_izo\_cor\_%' AND has_function_privilege(api.n,p.oid,'EXECUTE')) THEN
      v := array_append(v,'API poate executa helpere E3b');
    END IF;
    RETURN v;
  END $f$;
  REVOKE ALL ON FUNCTION public.fn_izo_porti_e3b_definitii(),public.fn_izo_porti_e3b_lipsa()
    FROM PUBLIC,anon,authenticated,service_role;
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
    RETURN v;
  END $f$;

  -- §17.4 pașii 4 / 5 / 6. Lista finală este FIXĂ, calculată de generator.
  v_impl := (SELECT coalesce(array_agg(x.d ORDER BY x.d COLLATE "C"), '{}'::text[])
       FROM (SELECT DISTINCT format('%s|%s|%s', o.type, o.identity, f.identity) d
               FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid
                    CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
                    CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
              WHERE d.refclassid = 'pg_proc'::regclass AND q.pronamespace = 'public'::regnamespace AND q.proname LIKE 'fn\_izo\_%'
                AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass)) x);
  v_impl_rev := ARRAY['policy|izo_atr_sel on public.izo_atribuiri|public.fn_izo_citire(bigint)', 'policy|izo_cfg_sel on public.izo_proiect_config|public.fn_izo_citire(bigint)', 'policy|izo_corectii_api_sel on public.izo_corectii|public.fn_izo_citire(bigint)', 'policy|izo_corectii_bucati_api_sel on public.izo_corectii_bucati|public.fn_izo_citire(bigint)', 'policy|izo_doc_api_sel on public.izo_documente_intrare|public.fn_izo_citire(bigint)', 'policy|izo_doc_scan_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_r_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_doc_scan_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_documente_istoric_api_sel on public.izo_documente_istoric|public.fn_izo_citire(bigint)', 'policy|izo_ev_corectie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_receptie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_sel on public.magazie_bucati_evenimente|public.fn_izo_citire(bigint)', 'policy|izo_ev_writer_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_imp_sel on public.izo_importuri|public.fn_izo_citire(bigint)', 'policy|izo_mis_corectie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_receptie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_sel on public.magazie_bucati_miscari|public.fn_izo_citire(bigint)', 'policy|izo_mis_writer_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_del on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_sel on public.magazie_bucati|public.fn_izo_citire(bigint)', 'policy|magbuc_izo_client_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'trigger|trg_bon_linii_izo_bucata on public.executie_bonuri_consum_linii|public.fn_izo_refuz_bon_bucata()', 'trigger|trg_depozite_izo_mutare on public.logistica_depozite|public.fn_izo_refuz_mutare_depozit()', 'trigger|trg_executie_tevi_izo_delete on public.executie_tevi|public.fn_izo_refuz_delete_tevi()', 'trigger|trg_executie_tevi_izo_mutare on public.executie_tevi|public.fn_izo_refuz_mutare_tevi()', 'trigger|trg_executie_tevi_izo_truncate on public.executie_tevi|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_izo_atr_garda on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_atr_truncate on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_cfg_garda on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cfg_truncate on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_doc_garda on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_garda on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_truncate on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_garda on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_truncate on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_truncate on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_ev_garda on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_ev_truncate on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_garda on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_truncate on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_garda on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_truncate on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_magbuc_izo_garda on public.magazie_bucati|public.fn_izo_garda_bucati()', 'trigger|trg_magbuc_izo_truncate on public.magazie_bucati|public.fn_izo_garda_truncate_bucati()', 'trigger|trg_pachete_izo_delete on public.executie_pachete_lansare|public.fn_izo_refuz_delete_pachet()', 'trigger|trg_pachete_izo_mutare on public.executie_pachete_lansare|public.fn_izo_refuz_mutare_pachet()', 'trigger|trg_pachete_izo_truncate on public.executie_pachete_lansare|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_proiecte_izo_site on public.executie_proiecte|public.fn_izo_refuz_site_proiect()', 'trigger|trg_tronsoane_izo_mutare on public.executie_tronsoane|public.fn_izo_refuz_mutare_tronson()']::text[];
  IF v_impl IS DISTINCT FROM v_impl_rev THEN
    RAISE EXCEPTION 'E3b invocări implicite (diferența autorizată înainte de ștampile): actual % / așteptat %', v_impl, v_impl_rev;
  END IF;
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L','porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L','porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L','porti_e3=' || public.fn_izo_porti_e3_definitii());
  v_impl := (SELECT coalesce(array_agg(x.d ORDER BY x.d COLLATE "C"), '{}'::text[])
       FROM (SELECT DISTINCT format('%s|%s|%s', o.type, o.identity, f.identity) d
               FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid
                    CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
                    CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
              WHERE d.refclassid = 'pg_proc'::regclass AND q.pronamespace = 'public'::regnamespace AND q.proname LIKE 'fn\_izo\_%'
                AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass)) x);
  v_impl_rev := ARRAY['policy|izo_atr_sel on public.izo_atribuiri|public.fn_izo_citire(bigint)', 'policy|izo_cfg_sel on public.izo_proiect_config|public.fn_izo_citire(bigint)', 'policy|izo_corectii_api_sel on public.izo_corectii|public.fn_izo_citire(bigint)', 'policy|izo_corectii_bucati_api_sel on public.izo_corectii_bucati|public.fn_izo_citire(bigint)', 'policy|izo_doc_api_sel on public.izo_documente_intrare|public.fn_izo_citire(bigint)', 'policy|izo_doc_scan_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_r_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_doc_scan_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_documente_istoric_api_sel on public.izo_documente_istoric|public.fn_izo_citire(bigint)', 'policy|izo_ev_corectie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_receptie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_sel on public.magazie_bucati_evenimente|public.fn_izo_citire(bigint)', 'policy|izo_ev_writer_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_imp_sel on public.izo_importuri|public.fn_izo_citire(bigint)', 'policy|izo_mis_corectie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_receptie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_sel on public.magazie_bucati_miscari|public.fn_izo_citire(bigint)', 'policy|izo_mis_writer_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_del on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_sel on public.magazie_bucati|public.fn_izo_citire(bigint)', 'policy|magbuc_izo_client_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'trigger|trg_bon_linii_izo_bucata on public.executie_bonuri_consum_linii|public.fn_izo_refuz_bon_bucata()', 'trigger|trg_depozite_izo_mutare on public.logistica_depozite|public.fn_izo_refuz_mutare_depozit()', 'trigger|trg_executie_tevi_izo_delete on public.executie_tevi|public.fn_izo_refuz_delete_tevi()', 'trigger|trg_executie_tevi_izo_mutare on public.executie_tevi|public.fn_izo_refuz_mutare_tevi()', 'trigger|trg_executie_tevi_izo_truncate on public.executie_tevi|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_izo_atr_garda on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_atr_truncate on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_cfg_garda on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cfg_truncate on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_doc_garda on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_garda on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_truncate on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_garda on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_truncate on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_truncate on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_ev_garda on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_ev_truncate on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_garda on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_truncate on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_garda on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_truncate on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_magbuc_izo_garda on public.magazie_bucati|public.fn_izo_garda_bucati()', 'trigger|trg_magbuc_izo_truncate on public.magazie_bucati|public.fn_izo_garda_truncate_bucati()', 'trigger|trg_pachete_izo_delete on public.executie_pachete_lansare|public.fn_izo_refuz_delete_pachet()', 'trigger|trg_pachete_izo_mutare on public.executie_pachete_lansare|public.fn_izo_refuz_mutare_pachet()', 'trigger|trg_pachete_izo_truncate on public.executie_pachete_lansare|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_proiecte_izo_site on public.executie_proiecte|public.fn_izo_refuz_site_proiect()', 'trigger|trg_tronsoane_izo_mutare on public.executie_tronsoane|public.fn_izo_refuz_mutare_tronson()']::text[];
  IF v_impl IS DISTINCT FROM v_impl_rev THEN
    RAISE EXCEPTION 'E3b invocări implicite (după ștampile): actual % / așteptat %', v_impl, v_impl_rev;
  END IF;
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'Postcondiție E3b: porți incomplete %',v_lipsa; END IF;
  IF pg_get_indexdef('public.ux_magbuc_ev_corectie'::regclass) IS DISTINCT FROM
      'CREATE UNIQUE INDEX ux_magbuc_ev_corectie ON public.magazie_bucati_evenimente USING btree (document_id) WHERE (document_tip = ''izo_corectie''::text)'
     OR pg_get_indexdef('public.ux_izo_cor_deschisa'::regclass) IS DISTINCT FROM
      'CREATE UNIQUE INDEX ux_izo_cor_deschisa ON public.izo_corectii USING btree (bucata_id) WHERE ((stare = ''propusa''::text) AND (bucata_id IS NOT NULL))' THEN
    RAISE EXCEPTION 'Postcondiție E3b: indexurile nu corespund designului';
  END IF;
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
  IF v_amprenta IS NULL OR v_amprenta = v_inainte THEN RAISE EXCEPTION 'E3b: amprenta nouă invalidă'; END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',
    'E3b amprenta=' || v_amprenta || ' inainte_20261105a=' || v_inainte
    || ' porti_anterioare=' || v_porti || ' porti_e3_anterioare=' || v_porti_e3 || ' ‖ anterior: ' || v_comentariu);
  IF current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261105a_izometrie_e3b_corectii:' || txid_current() THEN
    RAISE EXCEPTION 'E3b: garda finală de livrare';
  END IF;
END
$migrare$;
