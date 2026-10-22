-- GENERAT de scripts/izometrie/e3b_gen/gen_e3b.py. NU se editează manual.
  -- 20261106a: E3b piesele A+B+C1+C2+D1+D2.
  -- Design r5: Q1=A, Q17=A, Q14=A; storno complet, istoric si prolog E2a.
-- Numai runner; nicio modificare de date la aplicare.
DO $migrare$
DECLARE v_amprenta text; v_scrisa text; v_inainte text; v_comentariu text;
  v_lipsa text[]; v_impl text[]; v_impl_rev text[]; v_x text; rr record;
  v_porti text; v_porti_e3 text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261106a_izometrie_e3b_corectii:' || txid_current() THEN
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
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_import_storno') <> 1
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_import_storno' LIMIT 1) IS DISTINCT FROM 'fe5d3493d096d9851249cd20de8f99b1' THEN
    RAISE EXCEPTION 'Precondiție E3b: corpul fn_izo_import_storno diferă de migrarea LIVE';
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
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_doc_anuleaza(bigint, text)'::regprocedure
    AND proowner='izo_receptie_writer'::regrole
    AND proacl::text='{izo_receptie_writer=X/izo_receptie_writer,postgres=X/izo_receptie_writer}') THEN
    RAISE EXCEPTION 'Preconditie E3b: owner / ACL anulare LIVE diferit'; END IF;
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
  -- r5 sectiunea 3.5, linia 362: disponibilitate, nu siguranta.
  -- Catalogul se reciteste; valorile efective se probeaza prin PostgREST (9.2).
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
  -- C2: corectii directe; ordinea lock-urilor din §4, normalizare in garda B.
  CREATE FUNCTION public.fn_izo_cor_camp(p_bucata_id bigint, p_server_ver bigint, p_dupa jsonb, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_col record; v_cn text; v_b public.magazie_bucati; v_after public.magazie_bucati; v_cor public.izo_corectii;
    v_proiect bigint; v_ev bigint; v_event public.magazie_bucati_evenimente; v_move public.magazie_bucati_miscari;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    SELECT b.proiect_id INTO v_proiect FROM public.magazie_bucati b WHERE b.id=p_bucata_id AND b.provenienta='beneficiar';
    IF NOT public.fn_izo_cor_autorizare_lock(v_proiect,'responsabil',NULL) THEN
      RAISE EXCEPTION 'E3b: bucata nu exista sau nu ai acces' USING ERRCODE='42501'; END IF;
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_partajat(VARIADIC ARRAY[v_proiect]);
    SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=p_bucata_id AND b.proiect_id=v_proiect AND b.provenienta='beneficiar' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'E3b: bucata nu exista sau nu ai acces' USING ERRCODE='42501'; END IF;
    IF p_server_ver IS DISTINCT FROM v_b.server_ver THEN
      RAISE EXCEPTION 'E3b: bucata s-a schimbat, reincarca' USING ERRCODE='40001'; END IF;
    IF jsonb_typeof(p_dupa) IS DISTINCT FROM 'object' OR p_dupa='{}'::jsonb
      OR p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: cerere invalida' USING ERRCODE='22023'; END IF;
    IF p_dupa ?| public.fn_izo_coloane_identitate() THEN
      RAISE EXCEPTION 'E3b: trimite prin propunere' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.bucata_id=v_b.id AND cor.stare='propusa') THEN
      RAISE EXCEPTION 'E3b: exista o propunere deschisa pe bucata - decide / retrage intai' USING ERRCODE='23505'; END IF;
    BEGIN
    INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,inainte,dupa,motiv,stare,versiune,cale,propus_de,propus_rol,propus_la)
      VALUES(v_proiect,'camp',v_b.id,NULL,p_dupa,btrim(p_motiv),'propusa',1,'direct',v_uid,session_user,now()) RETURNING * INTO v_cor;
    v_after:=jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_dupa(v_cor,v_b));
    SELECT b.id, b.proiect_id, b.stare INTO v_col FROM public.magazie_bucati b WHERE b.id<>v_b.id AND b.provenienta='beneficiar' AND b.tip_cod=v_after.tip_cod AND b.stare<>'anulata'
          AND b.serie_canon=public.fn_izo_canon_serie(v_after.serie)
          AND ((b.tip_cod='teava' AND b.dezambiguare IS NOT DISTINCT FROM v_after.dezambiguare
            AND (b.parinte_id IS NULL OR (b.stare<>'taiata' AND b.sarja IS NOT DISTINCT FROM v_after.sarja
              AND b.lungime_cm IS NOT DISTINCT FROM round(v_after.lungime_mm/10.0)::integer)))
          OR (b.tip_cod='curba' AND b.sarja IS NOT DISTINCT FROM v_after.sarja AND b.unghi_curba IS NOT DISTINCT FROM v_after.unghi_curba
            AND b.cod_bucata IS NOT DISTINCT FROM v_after.cod_bucata)) LIMIT 1;
    IF FOUND THEN
      -- Q-E3b-18 = A (§5.1): detalii doar dacă apelantul citește proiectul coliziunii; altfel generic, fără id / proiect / stare
      IF public.fn_izo_citire(v_col.proiect_id) THEN
        RAISE EXCEPTION 'E3b: conflict de unicitate în registru: bucata % (proiectul %, stare %)', v_col.id, v_col.proiect_id, v_col.stare USING ERRCODE='23505';
      END IF;
      RAISE EXCEPTION 'E3b: seria / combinația există deja în registru, pe un proiect la care nu ai acces' USING ERRCODE='23505';
    END IF;
    PERFORM public.fn_izo_cor_marcheaza(v_cor.id);
    v_event:=jsonb_populate_record(NULL::public.magazie_bucati_evenimente,public.fn_izo_cor_eveniment_asteptat(v_cor));
    INSERT INTO public.magazie_bucati_evenimente(tip, proiect_id, document_tip, document_id, import_id, storno_de_eveniment_id, motiv, declarat_de, aplicat_de, aplicat_rol, ora_tableta, dispozitiv_id, server_ver) SELECT v_event.tip, v_event.proiect_id, v_event.document_tip, v_event.document_id, v_event.import_id, v_event.storno_de_eveniment_id, v_event.motiv, v_event.declarat_de, v_event.aplicat_de, v_event.aplicat_rol, v_event.ora_tableta, v_event.dispozitiv_id, nextval('public.izo_server_ver_seq') RETURNING id INTO v_ev;
    v_move:=jsonb_populate_record(NULL::public.magazie_bucati_miscari,public.fn_izo_cor_miscare_asteptata(v_cor,v_b));
    INSERT INTO public.magazie_bucati_miscari(eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, din_loc, in_loc, lungime_mm, inainte, dupa, server_ver) SELECT v_move.eveniment_id, v_move.proiect_id, v_move.bucata_id, v_move.rol, v_move.stare_inainte, v_move.stare_dupa, v_move.din_loc, v_move.in_loc, v_move.lungime_mm, v_move.inainte, v_move.dupa, nextval('public.izo_server_ver_seq');
    UPDATE public.magazie_bucati SET depozit_id=v_after.depozit_id, diametru_mm=v_after.diametru_mm, dimensiune=v_after.dimensiune, grad_otel=v_after.grad_otel, greutate_kg=v_after.greutate_kg, izolatie=v_after.izolatie, lot=v_after.lot, lungime_aviz_mm=v_after.lungime_aviz_mm, lungime_m=v_after.lungime_m, lungime_masurata_mm=v_after.lungime_masurata_mm, lungime_mm=v_after.lungime_mm, lungime_originala_m=v_after.lungime_originala_m, perete_mm=v_after.perete_mm, sarja=v_after.sarja, serie=v_after.serie, standard=v_after.standard, stare=v_after.stare, unghi_curba=v_after.unghi_curba,server_ver=nextval('public.izo_server_ver_seq'),updated_at=now()
      WHERE id=v_b.id RETURNING * INTO v_b;
    UPDATE public.izo_corectii SET stare='aplicata',versiune=versiune+1,decis_de=v_uid,decis_rol=session_user,decis_la=now(),eveniment_id=v_ev
      WHERE id=v_cor.id;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'eveniment_id',v_ev,'inainte',v_cor.inainte,'dupa',v_cor.dupa,'server_ver',v_b.server_ver);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
    IF v_cn IS NULL OR v_cn = '' THEN RAISE; END IF;  -- mesajul nostru (cu sau fără detalii), nu un index
    RAISE EXCEPTION 'E3b: seria / combinația există deja în registru, pe un proiect la care nu ai acces' USING ERRCODE='23505';
    END;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'E3b: valoare invalida' USING ERRCODE='22023';
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_pv(p_doc_id bigint, p_versiune bigint, p_pv_nr text, p_pv_data date, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_doc public.izo_documente_intrare; v_cor public.izo_corectii;
    v_ev bigint; v_event public.magazie_bucati_evenimente;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    SELECT doc.* INTO v_doc FROM public.izo_documente_intrare doc WHERE doc.id=p_doc_id FOR UPDATE;
    IF NOT FOUND OR NOT public.fn_izo_cor_autorizare_lock(v_doc.proiect_id,'responsabil',NULL) THEN
      RAISE EXCEPTION 'E3b: documentul nu exista sau nu ai acces' USING ERRCODE='42501'; END IF;
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_partajat(VARIADIC ARRAY[v_doc.proiect_id]);
    IF p_versiune IS DISTINCT FROM v_doc.versiune THEN
      RAISE EXCEPTION 'E3b: documentul s-a schimbat, reincarca' USING ERRCODE='40001'; END IF;
    IF v_doc.stare<>'confirmat' OR v_doc.eveniment_pv_id IS NULL THEN
      RAISE EXCEPTION 'E3b: document neconfirmat sau fara PV' USING ERRCODE='22023'; END IF;
    IF p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: motiv invalid' USING ERRCODE='22023'; END IF;
    INSERT INTO public.izo_corectii(proiect_id,tip,document_intrare_id,inainte,dupa,motiv,stare,versiune,cale,propus_de,propus_rol,propus_la)
      VALUES(v_doc.proiect_id,'pv',v_doc.id,NULL,jsonb_build_object('pv_nr',p_pv_nr,'pv_data',p_pv_data),
        btrim(p_motiv),'propusa',1,'direct',v_uid,session_user,now()) RETURNING * INTO v_cor;
    PERFORM public.fn_izo_cor_marcheaza(v_cor.id);
    v_event:=jsonb_populate_record(NULL::public.magazie_bucati_evenimente,public.fn_izo_cor_eveniment_asteptat(v_cor));
    INSERT INTO public.magazie_bucati_evenimente(tip, proiect_id, document_tip, document_id, import_id, storno_de_eveniment_id, motiv, declarat_de, aplicat_de, aplicat_rol, ora_tableta, dispozitiv_id, server_ver) SELECT v_event.tip, v_event.proiect_id, v_event.document_tip, v_event.document_id, v_event.import_id, v_event.storno_de_eveniment_id, v_event.motiv, v_event.declarat_de, v_event.aplicat_de, v_event.aplicat_rol, v_event.ora_tableta, v_event.dispozitiv_id, nextval('public.izo_server_ver_seq') RETURNING id INTO v_ev;
    UPDATE public.izo_documente_intrare SET pv_nr=v_cor.dupa->>'pv_nr',pv_nr_canon=v_cor.dupa->>'pv_nr_canon',
      pv_data=(v_cor.dupa->>'pv_data')::date,versiune=versiune+1,updated_at=now() WHERE id=v_doc.id RETURNING * INTO v_doc;
    UPDATE public.izo_corectii SET stare='aplicata',versiune=versiune+1,decis_de=v_uid,decis_rol=session_user,decis_la=now(),eveniment_id=v_ev
      WHERE id=v_cor.id;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'eveniment_id',v_ev,'document_id',v_doc.id,'versiune',v_doc.versiune);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'E3b: seria / combinația există deja în registru, pe un proiect la care nu ai acces' USING ERRCODE='23505';
  END $f$;

  -- C1: frontiera de propuneri (§1, §4, §5.6).
  CREATE FUNCTION public.fn_izo_cor_propune(p_tip text, p_proiect bigint, p_bucata_id bigint, p_detalii jsonb, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_b public.magazie_bucati; v_cor public.izo_corectii; v_dep integer; v_doc bigint; v_keys text[];
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    IF p_tip IS NULL OR p_tip NOT IN ('camp','carantina_intrare','carantina_iesire','pierdut','gasit_recuperare','gasit_nou')
      OR p_proiect IS NULL OR (p_tip='gasit_nou') <> (p_bucata_id IS NULL)
      OR jsonb_typeof(p_detalii) IS DISTINCT FROM 'object' OR p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: cerere invalidă' USING ERRCODE='22023'; END IF;
    IF p_tip='gasit_nou' THEN
      v_dep := (p_detalii->>'depozit_id')::integer; v_doc := (p_detalii->>'document_intrare_id')::bigint;
    ELSE
      SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=p_bucata_id AND b.proiect_id=p_proiect AND b.provenienta='beneficiar';
      v_dep := CASE WHEN v_b.locatie_tip='tronson' THEN (v_b.atribute->>'depozit_origine_id')::integer ELSE v_b.depozit_id END;
    END IF;
    v_keys := public.fn_izo_cor_chei(p_tip,CASE WHEN p_tip='gasit_nou' THEN p_detalii->>'tip_cod' ELSE v_b.tip_cod END,'propunere');
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_detalii) k WHERE NOT k=ANY(v_keys)) THEN
      RAISE EXCEPTION 'E3b: cheie în afara listei albe; trimite separat identitatea' USING ERRCODE='22023'; END IF;
    IF v_doc IS NOT NULL AND public.fn_izo_cor_doc_lock(v_doc,p_proiect) IS NOT TRUE THEN
      RAISE EXCEPTION 'E3b: document inexistent sau inaccesibil' USING ERRCODE='42501'; END IF;
    IF NOT public.fn_izo_cor_autorizare_lock(p_proiect,'responsabil',NULL)
      AND NOT public.fn_izo_cor_autorizare_lock(p_proiect,'gestionar',v_dep) THEN
      RAISE EXCEPTION 'E3b: bucata nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    IF p_tip <> 'gasit_nou' THEN
      v_b := jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_lock(p_bucata_id,p_proiect));
      IF v_b.id IS NULL THEN RAISE EXCEPTION 'E3b: bucata nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
      IF (CASE WHEN v_b.locatie_tip='tronson' THEN (v_b.atribute->>'depozit_origine_id')::integer ELSE v_b.depozit_id END) IS DISTINCT FROM v_dep THEN RAISE EXCEPTION 'E3b: bucata s-a mutat, reîncearcă' USING ERRCODE='40001'; END IF;
    END IF;
    INSERT INTO public.izo_corectii(proiect_id,tip,bucata_id,document_intrare_id,inainte,dupa,ncr_ref,motiv,stare,versiune,cale,propus_de,propus_rol,propus_la)
      VALUES(p_proiect,p_tip,p_bucata_id,v_doc,NULL,p_detalii,
        CASE WHEN p_tip IN ('carantina_intrare','carantina_iesire') THEN btrim(p_detalii->>'ncr_ref') END,
        btrim(p_motiv),'propusa',1,NULL,v_uid,session_user,now()) RETURNING * INTO v_cor;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'versiune',v_cor.versiune,'stare',v_cor.stare,'inainte',v_cor.inainte,'dupa',v_cor.dupa);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'E3b: există deja o corecție deschisă pe bucată' USING ERRCODE='23505';
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'E3b: identificator invalid' USING ERRCODE='22023';
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_retrage(p_corectie_id bigint, p_versiune bigint, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_cor public.izo_corectii;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id FOR UPDATE;
    -- gestionar cu depozit NULL nu poate avea atribuire: helper-ul admite aici numai owner-ul.
    IF NOT FOUND OR NOT public.fn_izo_citire(v_cor.proiect_id) OR
      (v_uid IS DISTINCT FROM v_cor.propus_de AND NOT public.fn_izo_cor_autorizare_lock(v_cor.proiect_id,'gestionar',NULL)) THEN
      RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    IF v_cor.cale <> 'propunere' OR v_cor.stare <> 'propusa' OR p_versiune IS DISTINCT FROM v_cor.versiune THEN
      RAISE EXCEPTION 'E3b: corecția s-a schimbat, reîncarcă' USING ERRCODE='40001'; END IF;
    IF p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: motiv invalid' USING ERRCODE='22023'; END IF;
    UPDATE public.izo_corectii SET stare='retrasa',versiune=versiune+1,decis_de=v_uid,decis_rol=session_user,decis_la=now(),motiv_decizie=btrim(p_motiv)
      WHERE id=v_cor.id RETURNING * INTO v_cor;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'versiune',v_cor.versiune,'stare',v_cor.stare);
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_respinge(p_corectie_id bigint, p_versiune bigint, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_cor public.izo_corectii;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id FOR UPDATE;
    IF NOT FOUND OR NOT public.fn_izo_cor_autorizare_lock(v_cor.proiect_id,'responsabil',NULL) OR v_uid=v_cor.propus_de THEN
      RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces; patru ochi obligatoriu' USING ERRCODE='42501'; END IF;
    IF v_cor.cale <> 'propunere' OR v_cor.stare <> 'propusa' OR p_versiune IS DISTINCT FROM v_cor.versiune THEN
      RAISE EXCEPTION 'E3b: corecția s-a schimbat, reîncarcă' USING ERRCODE='40001'; END IF;
    IF p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: motiv invalid' USING ERRCODE='22023'; END IF;
    UPDATE public.izo_corectii SET stare='respinsa',versiune=versiune+1,decis_de=v_uid,decis_rol=session_user,decis_la=now(),motiv_decizie=btrim(p_motiv)
      WHERE id=v_cor.id RETURNING * INTO v_cor;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'versiune',v_cor.versiune,'stare',v_cor.stare);
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_verifica(p_corectie_id bigint, p_tip text, p_proiect bigint, p_bucata_id bigint, p_detalii jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_cor public.izo_corectii; v_b public.magazie_bucati; v_after public.magazie_bucati;
    v_raw jsonb; v_dupa jsonb; v_inainte jsonb; v_bloc jsonb := '[]'; v_avert jsonb := '[]'; v_col jsonb; v_saved boolean;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    v_saved := p_corectie_id IS NOT NULL;
    IF (v_saved AND num_nonnulls(p_tip,p_proiect,p_bucata_id,p_detalii)<>0)
      OR (NOT v_saved AND (p_tip IS NULL OR p_proiect IS NULL OR p_detalii IS NULL
        OR p_tip NOT IN ('camp','carantina_intrare','carantina_iesire','pierdut','gasit_recuperare','gasit_nou')
        OR (p_tip='gasit_nou') <> (p_bucata_id IS NULL))) THEN
      RAISE EXCEPTION 'E3b: alege exact un mod de verificare' USING ERRCODE='22023'; END IF;
    IF v_saved THEN
      SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    ELSE
      v_cor.tip:=p_tip; v_cor.proiect_id:=p_proiect; v_cor.bucata_id:=p_bucata_id; v_cor.dupa:=p_detalii; v_cor.cale:='propunere';
      IF p_tip='camp' AND NOT p_detalii ?| public.fn_izo_coloane_identitate() THEN v_cor.cale:='direct'; END IF;
      v_cor.document_intrare_id:=CASE WHEN p_tip='gasit_nou' THEN (p_detalii->>'document_intrare_id')::bigint END;
      v_cor.ncr_ref:=CASE WHEN p_tip IN ('carantina_intrare','carantina_iesire') THEN btrim(p_detalii->>'ncr_ref') END;
    END IF;
    IF NOT public.fn_izo_citire(v_cor.proiect_id) THEN
      RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    IF v_cor.bucata_id IS NOT NULL THEN
      SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=v_cor.bucata_id AND b.proiect_id=v_cor.proiect_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'E3b: bucata nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    END IF;
    -- Reconstituim cererea din forma normalizată stocată de gardă.
    v_raw:=v_cor.dupa;
    IF v_saved THEN
      IF v_cor.tip='camp' THEN v_raw:=v_raw-ARRAY['lungime_mm','lungime_m','lungime_originala_m'];
      ELSIF v_cor.tip='gasit_nou' THEN v_raw:=v_raw-ARRAY['lungime_mm','lungime_m','lungime_originala_m'];
      ELSIF v_cor.tip IN ('carantina_intrare','carantina_iesire') THEN
        v_raw:=jsonb_build_object('ncr_ref',v_cor.ncr_ref);
        IF v_cor.tip='carantina_iesire' AND NOT EXISTS (SELECT 1 FROM public.magazie_bucati_miscari mis WHERE mis.bucata_id=v_b.id AND mis.stare_dupa='carantina' AND mis.rol='stare' AND mis.stare_inainte IN ('sosit','receptionat')) AND v_b.aviz_intrare_id IS NULL THEN v_raw:=v_raw||v_cor.dupa; END IF;
      ELSIF v_cor.tip='pierdut' THEN v_raw:=jsonb_build_object('cauza',v_cor.inainte->>'cauza');
      ELSIF v_cor.tip='gasit_recuperare' THEN v_raw:=v_raw-'stare'; END IF;
      IF v_cor.stare <> 'propusa' THEN v_bloc:=v_bloc||jsonb_build_array('Corecția este închisă'); END IF;
    END IF;
    BEGIN
      IF coalesce(public.fn_izo_nivel(v_cor.proiect_id),'off') NOT IN ('stoc','montaj') THEN
        RAISE EXCEPTION 'Proiect inactiv' USING ERRCODE='22023'; END IF;
      v_inainte:=public.fn_izo_cor_inainte(v_cor);
      IF v_cor.tip='pierdut' AND v_saved THEN v_inainte:=v_inainte||jsonb_build_object('cauza',v_cor.inainte->>'cauza'); END IF;
      IF v_saved AND v_inainte IS DISTINCT FROM v_cor.inainte THEN v_bloc:=v_bloc||jsonb_build_array('Bucata s-a schimbat de la propunere'); END IF;
      v_cor.dupa:=v_raw; v_dupa:=public.fn_izo_cor_valideaza(v_cor);
      IF v_cor.tip='gasit_nou' THEN v_after:=jsonb_populate_record(NULL::public.magazie_bucati,v_dupa||jsonb_build_object('cod_bucata','AB'));
      ELSE v_after:=jsonb_populate_record(v_b,v_dupa); END IF;
      IF v_cor.tip IN ('camp','gasit_nou') THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object('bucata_id',b.id,'proiect_id',b.proiect_id,'stare',b.stare)),'[]') INTO v_col
          FROM public.magazie_bucati b WHERE public.fn_izo_citire(b.proiect_id) AND b.id IS DISTINCT FROM v_b.id
          AND b.provenienta='beneficiar' AND b.tip_cod=v_after.tip_cod AND b.stare<>'anulata'
          AND b.serie_canon=public.fn_izo_canon_serie(v_after.serie)
          AND ((b.tip_cod='teava' AND b.dezambiguare IS NOT DISTINCT FROM v_after.dezambiguare
            AND (b.parinte_id IS NULL OR (b.stare<>'taiata' AND b.sarja IS NOT DISTINCT FROM v_after.sarja
              AND b.lungime_cm IS NOT DISTINCT FROM round(v_after.lungime_mm/10.0)::integer)))
          OR (b.tip_cod='curba' AND b.sarja IS NOT DISTINCT FROM v_after.sarja AND b.unghi_curba IS NOT DISTINCT FROM v_after.unghi_curba
            AND b.cod_bucata IS NOT DISTINCT FROM v_after.cod_bucata));
        v_bloc:=v_bloc||v_col;
        v_avert:=v_avert||jsonb_build_array('Verificarea nu certifică disponibilitatea globală a seriei');
        IF EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.tip='gasit_nou' AND cor.stare='propusa'
          AND cor.id IS DISTINCT FROM v_cor.id AND public.fn_izo_citire(cor.proiect_id)
          AND public.fn_izo_canon_serie(cor.dupa->>'serie')=public.fn_izo_canon_serie(v_after.serie)) THEN
          v_avert:=v_avert||jsonb_build_array('Există propuneri vizibile pentru aceeași serie'); END IF;
      END IF;
      IF v_cor.tip='camp' AND v_b.aviz_intrare_id IS NOT NULL THEN
        v_avert:=v_avert||jsonb_build_array('Corecția nu rescrie rândul documentului de intrare'); END IF;
    EXCEPTION WHEN SQLSTATE '22023' THEN v_bloc:=v_bloc||jsonb_build_array(SQLERRM);
    END;
    RETURN jsonb_build_object('ok',v_bloc='[]'::jsonb,'blocante',v_bloc,'avertismente',v_avert,'inainte',v_inainte,
      'dupa_efectiv',v_dupa,'versiune',v_cor.versiune);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'E3b: valoare invalidă' USING ERRCODE='22023';
  END $f$;

  CREATE FUNCTION public.fn_izo_cor_aproba(p_corectie_id bigint, p_versiune bigint) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_col record; v_cn text; v_cor public.izo_corectii; v_b public.magazie_bucati; v_after public.magazie_bucati;
    v_doc bigint; v_doc_ok boolean; v_new bigint; v_ev bigint; v_raw jsonb; v_norm jsonb; v_event public.magazie_bucati_evenimente;
    v_move public.magazie_bucati_miscari;
  BEGIN
    v_uid := public.fn_izo_cor_api_verifica();
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id;
    IF NOT FOUND OR NOT public.fn_izo_citire(v_cor.proiect_id) THEN
      RAISE EXCEPTION 'E3b: corecția nu există sau nu ai acces' USING ERRCODE='42501'; END IF;
    SELECT b.aviz_intrare_id INTO v_doc FROM public.magazie_bucati b WHERE b.id=v_cor.bucata_id AND b.proiect_id=v_cor.proiect_id;
    v_doc:=coalesce(v_doc,v_cor.document_intrare_id);
    IF v_doc IS NOT NULL THEN
      SELECT (doc.stare='confirmat') INTO v_doc_ok FROM public.izo_documente_intrare doc
        WHERE doc.id=v_doc AND doc.proiect_id=v_cor.proiect_id FOR SHARE;
    END IF;
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id FOR UPDATE;
    IF NOT public.fn_izo_cor_autorizare_lock(v_cor.proiect_id,'responsabil',NULL) OR v_uid=v_cor.propus_de OR v_cor.cale<>'propunere' THEN
      RAISE EXCEPTION 'E3b: acces refuzat; patru ochi obligatoriu' USING ERRCODE='42501'; END IF;
    IF v_cor.stare='aplicata' AND v_cor.versiune=p_versiune+1 AND v_cor.decis_de=v_uid THEN
      RETURN jsonb_build_object('corectie_id',v_cor.id,'eveniment_id',v_cor.eveniment_id,'bucata_id',v_cor.bucata_id,
        'stare_dupa',CASE WHEN v_cor.tip='gasit_nou' THEN 'carantina' WHEN v_cor.tip='camp' THEN (SELECT b.stare FROM public.magazie_bucati b WHERE b.id=v_cor.bucata_id) ELSE v_cor.dupa->>'stare' END,'versiune',v_cor.versiune,'idempotent',true); END IF;
    IF v_cor.stare<>'propusa' OR p_versiune IS DISTINCT FROM v_cor.versiune THEN
      RAISE EXCEPTION 'E3b: corecția s-a schimbat, reîncarcă' USING ERRCODE='40001'; END IF;
    IF v_cor.tip IN ('gasit_nou','gasit_recuperare') THEN
      PERFORM public.fn_izo_blocheaza_locuri(v_cor.proiect_id,ARRAY[(v_cor.dupa->>'depozit_id')::integer],ARRAY[]::bigint[]); END IF;
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_partajat(VARIADIC ARRAY[v_cor.proiect_id]);
    IF v_cor.bucata_id IS NOT NULL THEN
      SELECT b.* INTO v_b FROM public.magazie_bucati b WHERE b.id=v_cor.bucata_id AND b.proiect_id=v_cor.proiect_id FOR UPDATE;
      IF NOT FOUND OR (CASE WHEN v_cor.tip='camp' THEN public.fn_izo_cor_inainte(v_cor) ELSE public.fn_izo_cor_inainte(v_cor)-'cauza' END) IS DISTINCT FROM (CASE WHEN v_cor.tip='camp' THEN v_cor.inainte ELSE v_cor.inainte-'cauza' END) THEN
        RAISE EXCEPTION 'E3b: bucata s-a schimbat de la propunere, propune din nou' USING ERRCODE='40001'; END IF;
    END IF;
    IF (v_doc IS NOT NULL AND v_doc_ok IS NOT TRUE) OR coalesce(public.fn_izo_nivel(v_cor.proiect_id),'off') NOT IN ('stoc','montaj') THEN
      RAISE EXCEPTION 'E3b: proiectul sau documentul s-a schimbat' USING ERRCODE='40001'; END IF;
    BEGIN
    v_raw:=v_cor.dupa;
    IF v_cor.tip IN ('camp','gasit_nou') THEN v_raw:=v_raw-ARRAY['lungime_mm','lungime_m','lungime_originala_m'];
    ELSIF v_cor.tip IN ('carantina_intrare','carantina_iesire') THEN
      v_raw:=jsonb_build_object('ncr_ref',v_cor.ncr_ref);
      IF v_cor.tip='carantina_iesire' AND public.fn_izo_cor_tinta_iesire(v_b) IS NULL THEN v_raw:=v_raw||v_cor.dupa; END IF;
    ELSIF v_cor.tip='pierdut' THEN v_raw:=jsonb_build_object('cauza',v_cor.inainte->>'cauza');
    ELSIF v_cor.tip='gasit_recuperare' THEN v_raw:=v_raw-'stare'; END IF;
    v_cor.dupa:=v_raw; v_norm:=public.fn_izo_cor_valideaza(v_cor);
    EXCEPTION WHEN SQLSTATE '22023' THEN
      RAISE EXCEPTION 'E3b: datele propunerii nu mai sunt aplicabile, propune din nou' USING ERRCODE='40001';
    END;
    SELECT cor.* INTO v_cor FROM public.izo_corectii cor WHERE cor.id=p_corectie_id;
    IF v_norm IS DISTINCT FROM v_cor.dupa THEN RAISE EXCEPTION 'E3b: ținta s-a schimbat, propune din nou' USING ERRCODE='40001'; END IF;
    IF v_cor.tip IN ('camp','gasit_nou') THEN
      IF v_cor.tip='gasit_nou' THEN v_after:=jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_noua(v_cor));
      ELSE v_after:=jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_dupa(v_cor,v_b)); END IF;
      SELECT b.id, b.proiect_id, b.stare INTO v_col FROM public.magazie_bucati b WHERE b.id IS DISTINCT FROM v_b.id AND b.provenienta='beneficiar' AND b.tip_cod=v_after.tip_cod AND b.stare<>'anulata'
          AND b.serie_canon=public.fn_izo_canon_serie(v_after.serie)
          AND ((b.tip_cod='teava' AND b.dezambiguare IS NOT DISTINCT FROM v_after.dezambiguare
            AND (b.parinte_id IS NULL OR (b.stare<>'taiata' AND b.sarja IS NOT DISTINCT FROM v_after.sarja
              AND b.lungime_cm IS NOT DISTINCT FROM round(v_after.lungime_mm/10.0)::integer)))
          OR (b.tip_cod='curba' AND b.sarja IS NOT DISTINCT FROM v_after.sarja AND b.unghi_curba IS NOT DISTINCT FROM v_after.unghi_curba
            AND b.cod_bucata IS NOT DISTINCT FROM v_after.cod_bucata)) LIMIT 1;
      IF FOUND THEN
        -- Q-E3b-18 = A (§5.1): detalii doar dacă apelantul citește proiectul coliziunii; altfel generic, fără id / proiect / stare
        IF public.fn_izo_citire(v_col.proiect_id) THEN
          RAISE EXCEPTION 'E3b: conflict de unicitate în registru: bucata % (proiectul %, stare %)', v_col.id, v_col.proiect_id, v_col.stare USING ERRCODE='23505';
        END IF;
        RAISE EXCEPTION 'E3b: seria / combinația există deja în registru, pe un proiect la care nu ai acces' USING ERRCODE='23505';
      END IF;
    END IF;
    v_new:=public.fn_izo_cor_marcheaza(v_cor.id);
    v_event:=jsonb_populate_record(NULL::public.magazie_bucati_evenimente,public.fn_izo_cor_eveniment_asteptat(v_cor));
    INSERT INTO public.magazie_bucati_evenimente(tip, proiect_id, document_tip, document_id, import_id, storno_de_eveniment_id, motiv, declarat_de, aplicat_de, aplicat_rol, ora_tableta, dispozitiv_id, server_ver) SELECT v_event.tip, v_event.proiect_id, v_event.document_tip, v_event.document_id, v_event.import_id, v_event.storno_de_eveniment_id, v_event.motiv, v_event.declarat_de, v_event.aplicat_de, v_event.aplicat_rol, v_event.ora_tableta, v_event.dispozitiv_id, nextval('public.izo_server_ver_seq') RETURNING id INTO v_ev;
    IF v_cor.tip='gasit_nou' THEN
      v_after:=jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_noua(v_cor));
      v_after.id:=v_new; v_after.uid:=gen_random_uuid(); v_after.radacina_id:=v_new; v_after.server_ver:=nextval('public.izo_server_ver_seq');
      INSERT INTO public.magazie_bucati(/*C*/ proiect_id, comanda_furnizor_id, tip_material_id, serie, sarja, dimensiune, grad_otel, standard, lungime_m, lungime_originala_m, greutate_kg, unghi_curba, cantitate, um, provenienta, izolatie, furnizor, producator, sursa_receptie, fara_packing_list, nr_document, data_receptie, mtc_path, stare, locatie_tip, locatie_site_id, executie_teava_id, atribute, observatii, receptionat_de, receptionat_la, created_by, tip_cod, parinte_id, cod_bucata, capat_stanga, capat_dreapta, dezambiguare, lungime_aviz_mm, lungime_masurata_mm, lungime_mm, lungime_calculata, perete_mm, diametru_mm, lot, aviz_intrare_id, nr_crt_aviz, bend_no, capat_marcaj, depozit_id, tronson_id, id, uid, radacina_id, server_ver) SELECT v_after.proiect_id, v_after.comanda_furnizor_id, v_after.tip_material_id, v_after.serie, v_after.sarja, v_after.dimensiune, v_after.grad_otel, v_after.standard, v_after.lungime_m, v_after.lungime_originala_m, v_after.greutate_kg, v_after.unghi_curba, v_after.cantitate, v_after.um, v_after.provenienta, v_after.izolatie, v_after.furnizor, v_after.producator, v_after.sursa_receptie, v_after.fara_packing_list, v_after.nr_document, v_after.data_receptie, v_after.mtc_path, v_after.stare, v_after.locatie_tip, v_after.locatie_site_id, v_after.executie_teava_id, v_after.atribute, v_after.observatii, v_after.receptionat_de, v_after.receptionat_la, v_after.created_by, v_after.tip_cod, v_after.parinte_id, v_after.cod_bucata, v_after.capat_stanga, v_after.capat_dreapta, v_after.dezambiguare, v_after.lungime_aviz_mm, v_after.lungime_masurata_mm, v_after.lungime_mm, v_after.lungime_calculata, v_after.perete_mm, v_after.diametru_mm, v_after.lot, v_after.aviz_intrare_id, v_after.nr_crt_aviz, v_after.bend_no, v_after.capat_marcaj, v_after.depozit_id, v_after.tronson_id, v_after.id, v_after.uid, v_after.radacina_id, v_after.server_ver RETURNING * INTO v_b;
    END IF;
    v_move:=jsonb_populate_record(NULL::public.magazie_bucati_miscari,public.fn_izo_cor_miscare_asteptata(v_cor,v_b));
    INSERT INTO public.magazie_bucati_miscari(eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, din_loc, in_loc, lungime_mm, inainte, dupa, server_ver) SELECT v_move.eveniment_id, v_move.proiect_id, v_move.bucata_id, v_move.rol, v_move.stare_inainte, v_move.stare_dupa, v_move.din_loc, v_move.in_loc, v_move.lungime_mm, v_move.inainte, v_move.dupa, nextval('public.izo_server_ver_seq');
    IF v_cor.tip<>'gasit_nou' THEN
      v_after:=jsonb_populate_record(NULL::public.magazie_bucati,public.fn_izo_cor_bucata_dupa(v_cor,v_b));
      UPDATE public.magazie_bucati SET depozit_id=v_after.depozit_id, diametru_mm=v_after.diametru_mm, dimensiune=v_after.dimensiune, grad_otel=v_after.grad_otel, greutate_kg=v_after.greutate_kg, izolatie=v_after.izolatie, lot=v_after.lot, lungime_aviz_mm=v_after.lungime_aviz_mm, lungime_m=v_after.lungime_m, lungime_masurata_mm=v_after.lungime_masurata_mm, lungime_mm=v_after.lungime_mm, lungime_originala_m=v_after.lungime_originala_m, perete_mm=v_after.perete_mm, sarja=v_after.sarja, serie=v_after.serie, standard=v_after.standard, stare=v_after.stare, unghi_curba=v_after.unghi_curba,server_ver=nextval('public.izo_server_ver_seq'),updated_at=now() WHERE id=v_b.id;
    END IF;
    UPDATE public.izo_corectii SET stare='aplicata',versiune=versiune+1,decis_de=v_uid,decis_rol=session_user,decis_la=now(),
      eveniment_id=v_ev,bucata_id=v_b.id WHERE id=v_cor.id RETURNING * INTO v_cor;
    -- contextul rămâne până la sfârșitul tranzacției (legat de txid, ca la E3); fără scriere de GUC în intrarea expusă (gate 0e)
    RETURN jsonb_build_object('corectie_id',v_cor.id,'eveniment_id',v_ev,'bucata_id',v_b.id,'stare_dupa',v_after.stare,
      'versiune',v_cor.versiune,'idempotent',false);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME;
    IF v_cn IS NULL OR v_cn = '' THEN RAISE; END IF;  -- mesajul nostru (cu sau fără detalii), nu un index
    RAISE EXCEPTION 'E3b: seria / combinația există deja în registru, pe un proiect la care nu ai acces' USING ERRCODE='23505';
  END $f$;

  -- D1: operatia administrativa; lista se stabilizeaza inaintea oricarui FK.
  CREATE FUNCTION public.fn_izo_cor_storno_import(p_proiect bigint, p_import_id text, p_bucati bigint[], p_motiv text, p_cerut_de uuid) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_imp public.izo_importuri; v_cor public.izo_corectii; v_b public.magazie_bucati;
    v_event public.magazie_bucati_evenimente; v_move public.magazie_bucati_miscari;
    v_ev bigint; v_n bigint; v_refuz bigint[];
  BEGIN
    PERFORM public.fn_izo_cor_adm_verifica();
    IF session_user <> 'postgres' OR public.fn_izo_uid() IS NOT NULL THEN
      RAISE EXCEPTION 'E3b administrativ' USING ERRCODE='42501'; END IF;
    IF NOT public.fn_izo_cor_cerut_de_valid(p_proiect,p_cerut_de) THEN
      RAISE EXCEPTION 'E3b: cerut_de neeligibil' USING ERRCODE='42501'; END IF;
    IF p_bucati IS NULL OR cardinality(p_bucati) NOT BETWEEN 1 AND 10000
      OR EXISTS (SELECT 1 FROM unnest(p_bucati) x WHERE x IS NULL)
      OR (SELECT count(DISTINCT x) FROM unnest(p_bucati) x) <> cardinality(p_bucati)
      OR p_motiv IS NULL OR char_length(btrim(p_motiv)) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'E3b: lista / motiv invalid' USING ERRCODE='22023'; END IF;
    PERFORM public.fn_izo_lock_proiect(p_proiect,true);
    SELECT imp.* INTO v_imp FROM public.izo_importuri imp WHERE imp.proiect_id=p_proiect AND imp.import_id=p_import_id;
    IF NOT FOUND OR v_imp.stare <> 'aplicat' THEN
      RAISE EXCEPTION 'E3b: import inexistent sau neaplicat' USING ERRCODE='22023'; END IF;
    PERFORM b.id FROM public.magazie_bucati b WHERE b.id=ANY(p_bucati) ORDER BY b.id FOR UPDATE;
    SELECT array_agg(x ORDER BY x) INTO v_refuz FROM unnest(p_bucati) x
      WHERE NOT EXISTS (SELECT 1 FROM public.magazie_bucati b JOIN public.magazie_bucati_miscari mis ON mis.bucata_id=b.id
        WHERE b.id=x AND b.proiect_id=p_proiect AND b.provenienta='beneficiar' AND b.stare <> 'anulata'
          AND mis.eveniment_id=v_imp.eveniment_id AND mis.rol='nascut')
      OR EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.bucata_id=x AND cor.stare='propusa')
      OR EXISTS (SELECT 1 FROM public.fn_izo_lant_blocant(ARRAY[x],ARRAY[v_imp.eveniment_id]));
    IF v_refuz IS NOT NULL THEN
      RAISE EXCEPTION 'E3b: bucati neeligibile (origine, stare, propunere deschisa sau lant): %',v_refuz USING ERRCODE='22023'; END IF;
    INSERT INTO public.izo_corectii(proiect_id,tip,import_id,inainte,dupa,motiv,stare,versiune,cale,propus_de,propus_rol,propus_la)
      VALUES(p_proiect,'storno_import',p_import_id,NULL,NULL,btrim(p_motiv),'propusa',1,'direct',p_cerut_de,session_user,now()) RETURNING * INTO v_cor;
    INSERT INTO public.izo_corectii_bucati(corectie_id,bucata_id) SELECT v_cor.id,x FROM unnest(p_bucati) x ORDER BY x;
    PERFORM public.fn_izo_cor_marcheaza(v_cor.id);
    v_event:=jsonb_populate_record(NULL::public.magazie_bucati_evenimente,public.fn_izo_cor_eveniment_asteptat(v_cor));
    INSERT INTO public.magazie_bucati_evenimente(tip, proiect_id, document_tip, document_id, import_id, storno_de_eveniment_id, motiv, declarat_de, aplicat_de, aplicat_rol, ora_tableta, dispozitiv_id, server_ver) SELECT v_event.tip, v_event.proiect_id, v_event.document_tip, v_event.document_id, v_event.import_id, v_event.storno_de_eveniment_id, v_event.motiv, v_event.declarat_de, v_event.aplicat_de, v_event.aplicat_rol, v_event.ora_tableta, v_event.dispozitiv_id, nextval('public.izo_server_ver_seq') RETURNING id INTO v_ev;
    FOR v_b IN SELECT b.* FROM public.magazie_bucati b WHERE b.id=ANY(p_bucati) ORDER BY b.id LOOP
      v_move:=jsonb_populate_record(NULL::public.magazie_bucati_miscari,public.fn_izo_cor_miscare_asteptata(v_cor,v_b));
      INSERT INTO public.magazie_bucati_miscari(eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, din_loc, in_loc, lungime_mm, inainte, dupa, server_ver) SELECT v_move.eveniment_id, v_move.proiect_id, v_move.bucata_id, v_move.rol, v_move.stare_inainte, v_move.stare_dupa, v_move.din_loc, v_move.in_loc, v_move.lungime_mm, v_move.inainte, v_move.dupa, nextval('public.izo_server_ver_seq');
    END LOOP;
    WITH anulate AS (UPDATE public.magazie_bucati SET stare='anulata',server_ver=nextval('public.izo_server_ver_seq'),updated_at=now()
      WHERE id=ANY(p_bucati) AND stare <> 'anulata' RETURNING id)
    SELECT count(*) INTO v_n FROM anulate;
    IF v_n <> cardinality(p_bucati) THEN RAISE EXCEPTION 'E3b: lista storno schimbata' USING ERRCODE='40001'; END IF;
    UPDATE public.izo_corectii SET stare='aplicata',versiune=versiune+1,decis_de=NULL,decis_rol=session_user,decis_la=now(),eveniment_id=v_ev WHERE id=v_cor.id;
    RETURN jsonb_build_object('corectie_id',v_cor.id,'eveniment_id',v_ev,'bucati_anulate',v_n);
  END $f$;

  CREATE FUNCTION public.fn_izo_lant_blocant(p_bucati bigint[], p_ev_proprii bigint[])
    RETURNS TABLE(bucata_id bigint, miscare_id bigint, eveniment_id bigint, tip text)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT mis.bucata_id,mis.id,ev.id,ev.tip FROM public.magazie_bucati_miscari mis
      JOIN public.magazie_bucati_evenimente ev ON ev.id=mis.eveniment_id
      WHERE mis.bucata_id=ANY(p_bucati) AND NOT (mis.eveniment_id=ANY(p_ev_proprii))
        AND NOT EXISTS (SELECT 1 FROM public.izo_corectii cor WHERE cor.stare='aplicata'
          AND cor.tip IN ('camp','carantina_intrare','carantina_iesire','pierdut','gasit_recuperare')
          AND cor.eveniment_id=ev.id AND ev.document_tip='izo_corectie' AND ev.document_id=cor.id::text)
  $f$;

  CREATE FUNCTION public.fn_izo_doc_diff(p_anterior jsonb, p_curent jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_result jsonb:='{}'; v_sec text; v_old jsonb; v_new jsonb; v_changes jsonb;
    v_add jsonb; v_del jsonb; v_mod jsonb; v_id text; v_idkey text;
  BEGIN
    IF p_anterior IS NULL THEN RETURN p_curent; END IF;
    FOREACH v_sec IN ARRAY ARRAY['antet','aviz','lista','totaluri'] LOOP
      SELECT coalesce(jsonb_object_agg(k,jsonb_build_array(p_anterior->v_sec->k,p_curent->v_sec->k)),'{}') INTO v_changes
        FROM (SELECT jsonb_object_keys(p_anterior->v_sec) k UNION SELECT jsonb_object_keys(p_curent->v_sec)) keys
        WHERE p_anterior->v_sec->k IS DISTINCT FROM p_curent->v_sec->k;
      v_result:=v_result||jsonb_build_object(v_sec,v_changes);
    END LOOP;
    FOREACH v_sec IN ARRAY ARRAY['randuri','scanuri'] LOOP
      v_idkey:=CASE v_sec WHEN 'randuri' THEN 'nr_crt' ELSE 'cale' END;
      v_add:='[]'; v_del:='[]'; v_mod:='{}';
      FOR v_id IN SELECT x->>v_idkey FROM jsonb_array_elements(p_anterior->v_sec) x
        UNION SELECT x->>v_idkey FROM jsonb_array_elements(p_curent->v_sec) x ORDER BY 1 LOOP
        SELECT x INTO v_old FROM jsonb_array_elements(p_anterior->v_sec) x WHERE x->>v_idkey=v_id;
        SELECT x INTO v_new FROM jsonb_array_elements(p_curent->v_sec) x WHERE x->>v_idkey=v_id;
        IF v_old IS NULL THEN v_add:=v_add||jsonb_build_array(v_new);
        ELSIF v_new IS NULL THEN v_del:=v_del||jsonb_build_array(v_old);
        ELSIF v_old IS DISTINCT FROM v_new THEN
          SELECT jsonb_object_agg(k,jsonb_build_array(v_old->k,v_new->k)) INTO v_changes
            FROM (SELECT jsonb_object_keys(v_old) k UNION SELECT jsonb_object_keys(v_new)) keys WHERE v_old->k IS DISTINCT FROM v_new->k;
          v_mod:=v_mod||jsonb_build_object(v_id,v_changes);
        END IF;
      END LOOP;
      v_result:=v_result||jsonb_build_object(v_sec,jsonb_build_object('adaugate',v_add,
        CASE v_sec WHEN 'randuri' THEN 'sterse' ELSE 'scoase' END,v_del,'modificate',v_mod));
    END LOOP;
    RETURN v_result;
  END $f$;

  CREATE FUNCTION public.fn_izo_doc_ist_garda() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_doc public.izo_documente_intrare; v_old jsonb; v_content jsonb; v_hash text;
  BEGIN
    IF TG_OP <> 'INSERT' OR current_user <> 'izo_doc_editor' THEN
      RAISE EXCEPTION 'E3b: istoric imutabil' USING ERRCODE='42501'; END IF;
    SELECT doc.* INTO v_doc FROM public.izo_documente_intrare doc WHERE doc.id=NEW.document_id FOR UPDATE;
    IF NOT FOUND OR v_doc.stare <> 'draft' OR NEW.versiune IS DISTINCT FROM v_doc.versiune
      OR NEW.salvat_de IS DISTINCT FROM public.fn_izo_uid() OR NEW.salvat_rol IS DISTINCT FROM session_user::text
      OR NEW.salvat_la IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'E3b: identitate / versiune istoric invalida' USING ERRCODE='42501'; END IF;
    SELECT ist.continut INTO v_old FROM public.izo_documente_istoric ist WHERE ist.document_id=NEW.document_id ORDER BY ist.versiune DESC LIMIT 1;
    v_content:=public.fn_izo_doc_instantaneu(NEW.document_id);
    v_hash:='e3-doc-v1:'||encode(sha256(convert_to(v_content::text,'UTF8')),'hex');
    IF NEW.continut IS DISTINCT FROM v_content OR NEW.hash IS DISTINCT FROM v_hash
      OR NEW.hash IS DISTINCT FROM public.fn_izo_doc_hash(NEW.document_id)
      OR NEW.diff IS DISTINCT FROM public.fn_izo_doc_diff(v_old,v_content) OR NEW.baza IS DISTINCT FROM (v_old IS NULL) THEN
      RAISE EXCEPTION 'E3b: continut istoric diferit' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END $f$;
  CREATE TRIGGER trg_izo_doc_ist_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_documente_istoric
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_doc_ist_garda();
  CREATE TRIGGER trg_izo_doc_ist_truncate BEFORE TRUNCATE ON public.izo_documente_istoric
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_doc_ist_garda();
  ALTER TABLE public.izo_documente_istoric ENABLE ALWAYS TRIGGER trg_izo_doc_ist_garda;
  ALTER TABLE public.izo_documente_istoric ENABLE ALWAYS TRIGGER trg_izo_doc_ist_truncate;

  GRANT CREATE ON SCHEMA public TO izo_cor_editor;
  ALTER FUNCTION public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text) OWNER TO izo_cor_editor;
  REVOKE CREATE ON SCHEMA public FROM izo_cor_editor;
  SET LOCAL ROLE izo_cor_editor;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text) TO authenticated;
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_cor_editor;
  ALTER FUNCTION public.fn_izo_cor_retrage(bigint, bigint, text) OWNER TO izo_cor_editor;
  REVOKE CREATE ON SCHEMA public FROM izo_cor_editor;
  SET LOCAL ROLE izo_cor_editor;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_retrage(bigint, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_retrage(bigint, bigint, text) TO authenticated;
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_cor_editor;
  ALTER FUNCTION public.fn_izo_cor_respinge(bigint, bigint, text) OWNER TO izo_cor_editor;
  REVOKE CREATE ON SCHEMA public FROM izo_cor_editor;
  SET LOCAL ROLE izo_cor_editor;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_respinge(bigint, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_respinge(bigint, bigint, text) TO authenticated;
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_cor_editor;
  ALTER FUNCTION public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb) OWNER TO izo_cor_editor;
  REVOKE CREATE ON SCHEMA public FROM izo_cor_editor;
  SET LOCAL ROLE izo_cor_editor;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb) TO authenticated;
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_corectie_writer;
  ALTER FUNCTION public.fn_izo_cor_aproba(bigint, bigint) OWNER TO izo_corectie_writer;
  REVOKE CREATE ON SCHEMA public FROM izo_corectie_writer;
  SET LOCAL ROLE izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_aproba(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_aproba(bigint, bigint) TO authenticated;
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_corectie_writer;
  ALTER FUNCTION public.fn_izo_cor_camp(bigint, bigint, jsonb, text) OWNER TO izo_corectie_writer;
  REVOKE CREATE ON SCHEMA public FROM izo_corectie_writer;
  SET LOCAL ROLE izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_camp(bigint, bigint, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_camp(bigint, bigint, jsonb, text) TO authenticated;
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_corectie_writer;
  ALTER FUNCTION public.fn_izo_cor_pv(bigint, bigint, text, date, text) OWNER TO izo_corectie_writer;
  REVOKE CREATE ON SCHEMA public FROM izo_corectie_writer;
  SET LOCAL ROLE izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_pv(bigint, bigint, text, date, text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_pv(bigint, bigint, text, date, text) TO authenticated;
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_corectie_writer;
  ALTER FUNCTION public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid) OWNER TO izo_corectie_writer;
  REVOKE CREATE ON SCHEMA public FROM izo_corectie_writer;
  SET LOCAL ROLE izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid) TO postgres;
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_registru_writer;
  SET LOCAL ROLE izo_registru_writer;
  CREATE OR REPLACE FUNCTION public.fn_izo_import_sold_initial(p_proiect bigint, p_import_id text, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE
    v_sha text; v_imp_id bigint; v_exist record; v_ev bigint; v_b jsonb; v_id bigint; v_tip text; v_tipmat integer;
    v_stare text; v_loctip text; v_dep integer; v_tr bigint; v_lmm integer; v_n int := 0; v_nt int := 0; v_nc int := 0;
    v_metri numeric := 0; v_site integer; v_serie text; v_canon text; v_sarja text; v_cm integer; v_unghi numeric;
    v_pe_dep jsonb := '{}'::jsonb; v_pe_tr int := 0; v_rez jsonb; v_izol text; v_fisiere text[]; v_orig integer;
    v_depozite integer[]; v_tronsoane bigint[];
  BEGIN
    IF session_user IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'izo: funcțiile registrului se cheamă doar dintr-o sesiune postgres directă (session_user = %)', session_user USING ERRCODE = '42501';
    END IF;
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'E3b cere READ COMMITTED' USING ERRCODE='25001'; END IF;
    IF NOT pg_try_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare')) THEN
      RAISE EXCEPTION 'E3b: schema ocupata' USING ERRCODE='55P03'; END IF;
    IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
      RAISE EXCEPTION 'E3b: porti incomplete' USING ERRCODE='42501'; END IF;
    PERFORM set_config('izo.registru_tx', txid_current()::text, true);
    IF p_proiect IS NULL THEN RAISE EXCEPTION 'izo: proiectul e obligatoriu'; END IF;
    -- dacă tranzacția ține deja lock-ul exclusiv pe proiect (ex. fn_izo_seteaza_nivel chemat înainte), FOR SHARE-ul de mai
    -- jos ar veni DUPĂ advisory → blocaj circular posibil cu o mutare de depozit (Copilot r3). Activare + import în
    -- aceeași tranzacție doar prin fn_izo_activeaza_si_importa, care ia întâi rândurile.
    IF EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
                AND l.classid = 73010 AND l.objid = p_proiect::integer AND l.objsubid = 2)
       AND coalesce(current_setting('izo.combinat', true), '') IS DISTINCT FROM txid_current()::text THEN
      RAISE EXCEPTION 'izo: tranzacția ține deja lock-ul pe proiectul %; activarea + importul se fac doar prin fn_izo_activeaza_si_importa', p_proiect;
    END IF;
    IF p_import_id IS NULL OR p_import_id !~ '^[A-Za-z0-9_.:-]{3,80}$' THEN RAISE EXCEPTION 'izo: import_id invalid'; END IF;
    -- forma payload-ului, fail-closed (review #806 P2-6): cheie lipsă, null sau tip greșit → eroare, 0 efecte
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'surse') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_payload->'bucati') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'izo: payload invalid (cere obiect cu surse[] și bucati[])';
    END IF;
    IF jsonb_array_length(p_payload->'bucati') = 0 OR jsonb_array_length(p_payload->'surse') NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'izo: payload invalid (bucati[] nevid, surse[] între 1 și 20)';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'surse') s
                WHERE jsonb_typeof(s) IS DISTINCT FROM 'object' OR jsonb_typeof(s->'fisier') IS DISTINCT FROM 'string'
                   OR btrim(s->>'fisier') = '' OR coalesce(s->>'sha256', '') !~ '^[0-9a-f]{64}$') THEN
      RAISE EXCEPTION 'izo: fiecare sursă cere fisier + sha256 (R13)';
    END IF;
    SELECT array_agg(s->>'fisier') INTO v_fisiere FROM jsonb_array_elements(p_payload->'surse') s;
    IF cardinality(v_fisiere) <> (SELECT count(DISTINCT f) FROM unnest(v_fisiere) f) THEN
      RAISE EXCEPTION 'izo: surse[] are fișiere duplicate';
    END IF;
    v_sha := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');

    -- ordinea lock-urilor (review #806 r2): (1) rândurile de loc (proiect, depozite, tronsoane) FOR SHARE — o mutare de site /
    -- proiect în curs e așteptată și apoi văzută, una ulterioară așteaptă importul; (2) lock-ul EXCLUSIV pe proiect, înaintea
    -- oricărei citiri a nivelului / registrului (P1-3). Peste tot ordinea e rând → advisory, deci fără blocaj circular.
    SELECT array_agg(DISTINCT x.d) FILTER (WHERE x.d IS NOT NULL), array_agg(DISTINCT x.t) FILTER (WHERE x.t IS NOT NULL)
      INTO v_depozite, v_tronsoane
      FROM (SELECT (b->>'depozit_id')::integer AS d, (b->>'tronson_id')::bigint AS t FROM jsonb_array_elements(p_payload->'bucati') b
            UNION ALL SELECT (b->>'depozit_origine_id')::integer, NULL FROM jsonb_array_elements(p_payload->'bucati') b) x;
    PERFORM public.fn_izo_blocheaza_locuri(p_proiect, v_depozite, v_tronsoane);
    PERFORM public.fn_izo_lock_proiect(p_proiect, true);
    IF public.fn_izo_nivel(p_proiect) IS DISTINCT FROM 'stoc' THEN
      RAISE EXCEPTION 'izo: importul cere proiectul % la nivelul stoc (activat înainte, în aceeași tranzacție)', p_proiect;
    END IF;

    -- idempotența în BD [R3]: același (proiect, import_id) + același hash → rezultatul anterior; alt hash → conflict
    INSERT INTO public.izo_importuri (proiect_id, import_id, payload_sha256, surse)
    VALUES (p_proiect, p_import_id, v_sha, p_payload->'surse')
    ON CONFLICT (proiect_id, import_id) DO NOTHING
    RETURNING id INTO v_imp_id;
    IF v_imp_id IS NULL THEN
      SELECT * INTO v_exist FROM public.izo_importuri WHERE proiect_id = p_proiect AND import_id = p_import_id FOR SHARE;
      IF v_exist.payload_sha256 = v_sha THEN
        RETURN coalesce(v_exist.rezultat, '{}'::jsonb) || jsonb_build_object('duplicat', true, 'stare', v_exist.stare);
      END IF;
      RAISE EXCEPTION 'izo: conflict — import_id % există deja cu alt conținut (sha256 %, primit %)', p_import_id, v_exist.payload_sha256, v_sha
        USING ERRCODE = '23505';
    END IF;

    v_site := public.fn_izo_site_proiect(p_proiect);
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, import_id, motiv, aplicat_de, server_ver)
    VALUES ('sold_initial', p_proiect, 'import', p_import_id, p_import_id, coalesce(p_payload->>'motiv', 'Sold inițial din Exceluri'),
            public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_ev;

    FOR v_b IN SELECT * FROM jsonb_array_elements(p_payload->'bucati') LOOP
      v_n := v_n + 1;
      IF jsonb_typeof(v_b) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'izo: rândul %: nu e obiect', v_n; END IF;
      v_tip := v_b->>'tip';
      IF v_tip IS NULL OR v_tip NOT IN ('teava','curba') THEN RAISE EXCEPTION 'izo: rândul %: tip % (cere teava/curba)', v_n, v_tip; END IF;
      IF jsonb_typeof(v_b->'sursa') IS DISTINCT FROM 'object' OR coalesce(v_b->'sursa'->>'fisier','') = '' OR coalesce(v_b->'sursa'->>'foaie','') = ''
         OR coalesce(v_b->'sursa'->>'rand','') !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'izo: rândul %: lipsește sursa (fisier, foaie, rand) — R13', v_n;
      END IF;
      -- fiecare rând trimite la un fișier declarat în surse[] (cu sha256) — review #806 P2-6
      IF NOT (v_b->'sursa'->>'fisier') = ANY (v_fisiere) THEN
        RAISE EXCEPTION 'izo: rândul %: fișierul sursă % nu e în surse[]', v_n, v_b->'sursa'->>'fisier';
      END IF;
      v_serie := btrim(v_b->>'serie');
      v_sarja := nullif(btrim(coalesce(v_b->>'sarja', '')), '');
      IF v_serie IS NULL OR v_serie = '' OR v_sarja IS NULL THEN RAISE EXCEPTION 'izo: rândul % (%): serie și șarjă obligatorii', v_n, v_b->'sursa'; END IF;
      IF (v_b->>'perete_mm') IS NULL THEN RAISE EXCEPTION 'izo: rândul % (%): perete lipsă (D2#3)', v_n, v_serie; END IF;
      v_stare := v_b->>'stare';
      -- carantina (review #807 r3): bucata e fizic în depozit, dar NU e disponibilă (montaj / ieșire) până la o decizie
      IF v_stare IS NULL OR v_stare NOT IN ('sosit','receptionat','pe_tronson','carantina') THEN
        RAISE EXCEPTION 'izo: rândul % (%): stare % la sold inițial', v_n, v_serie, v_stare;
      END IF;
      v_dep := (v_b->>'depozit_id')::integer;
      v_tr := (v_b->>'tronson_id')::bigint;
      v_orig := (v_b->>'depozit_origine_id')::integer;
      -- locul exclusiv (review #806 D): pe tronson doar tronson_id (+ depozitul de origine, opțional, în atribute);
      -- în depozit doar depozit_id
      IF v_stare = 'pe_tronson' THEN
        IF v_tr IS NULL OR v_dep IS NOT NULL THEN
          RAISE EXCEPTION 'izo: rândul % (%): pe_tronson cere tronson_id și fără depozit_id (originea = depozit_origine_id)', v_n, v_serie;
        END IF;
        v_loctip := 'tronson';
      ELSE
        IF v_dep IS NULL OR v_tr IS NOT NULL OR v_orig IS NOT NULL THEN
          RAISE EXCEPTION 'izo: rândul % (%): în depozit cere depozit_id, fără tronson_id / depozit_origine_id', v_n, v_serie;
        END IF;
        v_loctip := 'depozit';
      END IF;
      IF NOT public.fn_izo_loc_valid(p_proiect, coalesce(v_dep, v_orig), v_tr) THEN
        RAISE EXCEPTION 'izo: rândul % (%): depozitul % / tronsonul % nu țin de proiectul %', v_n, v_serie, coalesce(v_dep, v_orig), v_tr, p_proiect;
      END IF;
      v_tipmat := public.fn_izo_tip_material(v_tip);
      v_canon := upper(regexp_replace(v_serie, '[[:space:]._/-]', '', 'g'));
      -- izolația NU se ghicește (review #807 r2): lipsă = necunoscută (NULL); dată = una dintre valorile permise
      v_izol := v_b->>'izolatie';
      IF v_izol IS NOT NULL AND v_izol NOT IN ('neizolata','PEHD','GRP') THEN
        RAISE EXCEPTION 'izo: rândul % (%): izolație % (cere neizolata / PEHD / GRP sau lipsă = necunoscută)', v_n, v_serie, v_izol;
      END IF;
      IF v_tip = 'teava' THEN
        v_lmm := (v_b->>'lungime_mm')::integer;
        IF v_lmm IS NULL THEN RAISE EXCEPTION 'izo: rândul % (%): lungime lipsă', v_n, v_serie; END IF;
        v_cm := round(v_lmm / 10.0)::integer;
        -- R1 (c): a doua rădăcină cu aceeași serie canonică = conflict (fără dezambiguare la import)
        IF EXISTS (SELECT 1 FROM public.magazie_bucati WHERE provenienta = 'beneficiar' AND tip_cod = 'teava' AND parinte_id IS NULL
                    AND stare <> 'anulata' AND serie_canon = v_canon AND dezambiguare IS NULL) THEN
          RAISE EXCEPTION 'izo: rândul % : seria % (canonic %) există deja ca țeavă (R1 c) — de decis în preview', v_n, v_serie, v_canon USING ERRCODE = '23505';
        END IF;
        v_nt := v_nt + 1; v_metri := v_metri + v_lmm / 1000.0;
      ELSE
        v_lmm := NULL;
        v_unghi := (v_b->>'unghi_curba')::numeric;
        IF v_unghi IS NULL OR v_unghi <= 0 OR v_unghi > 90 THEN RAISE EXCEPTION 'izo: rândul % (%): unghi de curbă invalid', v_n, v_serie; END IF;
        IF EXISTS (SELECT 1 FROM public.magazie_bucati WHERE provenienta = 'beneficiar' AND tip_cod = 'curba' AND stare <> 'anulata'
                    AND serie_canon = v_canon AND sarja = v_sarja AND unghi_curba = v_unghi AND cod_bucata = 'AB') THEN
          RAISE EXCEPTION 'izo: rândul %: curba % / % / %° există deja — coliziune de decis explicit', v_n, v_serie, v_sarja, v_unghi USING ERRCODE = '23505';
        END IF;
        v_nc := v_nc + 1;
      END IF;

      v_id := nextval('public.magazie_bucati_id_seq');
      INSERT INTO public.magazie_bucati (
        id, proiect_id, tip_material_id, tip_cod, uid, parinte_id, radacina_id, cod_bucata, capat_stanga, capat_dreapta,
        serie, sarja, dimensiune, grad_otel, standard, izolatie, producator, furnizor,
        lungime_m, lungime_originala_m, lungime_aviz_mm, lungime_mm, perete_mm, diametru_mm, unghi_curba, greutate_kg,
        cantitate, um, provenienta, sursa_receptie, nr_document, data_receptie, stare, locatie_tip, locatie_site_id,
        depozit_id, tronson_id, lot, atribute, server_ver, observatii)
      VALUES (
        v_id, p_proiect, v_tipmat, v_tip, gen_random_uuid(), NULL, v_id, 'AB', 'A', 'B',
        v_serie, v_sarja, v_b->>'dimensiune', v_b->>'grad_otel', v_b->>'standard', v_izol, v_b->>'producator', v_b->>'furnizor',
        CASE WHEN v_lmm IS NULL THEN NULL ELSE v_lmm / 1000.0 END, CASE WHEN v_lmm IS NULL THEN NULL ELSE v_lmm / 1000.0 END,
        v_lmm, v_lmm, (v_b->>'perete_mm')::numeric, (v_b->>'diametru_mm')::integer, CASE WHEN v_tip = 'curba' THEN v_unghi END,
        (v_b->>'greutate_kg')::numeric,
        1, CASE WHEN v_tip = 'teava' THEN 'm' ELSE 'buc' END, 'beneficiar', 'aviz', v_b->>'nr_aviz', (v_b->>'data_aviz')::date,
        v_stare, v_loctip, v_site, v_dep, v_tr, v_b->>'lot',
        jsonb_strip_nulls(jsonb_build_object('sursa', v_b->'sursa', 'import_id', p_import_id, 'depozit_origine_id', v_orig, 'aviz_iesire', v_b->'aviz_iesire',
                                             'pv_receptie', v_b->'pv_receptie', 'nrcd', v_b->'nrcd', 'gestiune', v_b->'gestiune',
                                             'dt_os', v_b->'dt_os', 'descriere', v_b->'descriere', 'izolatie_text', v_b->'izolatie_text')),
        nextval('public.izo_server_ver_seq'), v_b->>'observatii');
      INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_dupa, in_loc, lungime_mm, server_ver)
      VALUES (v_ev, p_proiect, v_id, 'nascut', v_stare,
              jsonb_strip_nulls(jsonb_build_object('tip', v_loctip, 'depozit_id', v_dep, 'tronson_id', v_tr, 'depozit_origine_id', v_orig)), v_lmm,
              nextval('public.izo_server_ver_seq'));
      IF v_loctip = 'depozit' THEN
        v_pe_dep := jsonb_set(v_pe_dep, ARRAY[v_dep::text], to_jsonb(coalesce((v_pe_dep->>v_dep::text)::int, 0) + 1));
      ELSE
        v_pe_tr := v_pe_tr + 1;
      END IF;
    END LOOP;

    v_rez := jsonb_build_object('import_id', p_import_id, 'eveniment_id', v_ev, 'bucati', v_n, 'tevi', v_nt, 'curbe', v_nc,
                                'metri_tevi', round(v_metri, 2), 'pe_depozit', v_pe_dep, 'pe_tronson', v_pe_tr, 'payload_sha256', v_sha);
    UPDATE public.izo_importuri SET eveniment_id = v_ev, rezultat = v_rez WHERE id = v_imp_id;
    RETURN v_rez || jsonb_build_object('duplicat', false);
  END $f$;
  RESET ROLE;
  REVOKE CREATE ON SCHEMA public FROM izo_registru_writer;
  IF (SELECT md5(replace(prosrc, '    IF current_setting(''transaction_isolation'') <> ''read committed'' THEN
      RAISE EXCEPTION ''E3b cere READ COMMITTED'' USING ERRCODE=''25001''; END IF;
    IF NOT pg_try_advisory_xact_lock_shared(hashtext(''gazpet.livrare_migrare'')) THEN
      RAISE EXCEPTION ''E3b: schema ocupata'' USING ERRCODE=''55P03''; END IF;
    IF public.fn_izo_porti_lipsa() IS DISTINCT FROM ''{}''::text[] THEN
      RAISE EXCEPTION ''E3b: porti incomplete'' USING ERRCODE=''42501''; END IF;
', '')) FROM pg_proc WHERE oid='public.fn_izo_import_sold_initial(bigint, text, jsonb)'::regprocedure) IS DISTINCT FROM 'e3f65df3705f40e8b5a907b66496acd9' THEN RAISE EXCEPTION 'Postconditie E3b: corp in afara prologului modificat'; END IF;
  GRANT CREATE ON SCHEMA public TO izo_registru_writer;
  SET LOCAL ROLE izo_registru_writer;
  CREATE OR REPLACE FUNCTION public.fn_izo_import_storno(p_proiect bigint, p_import_id text, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_imp record; v_ev bigint; v_n int; v_alt int; v_m bigint[]; v_deschise bigint[];
  BEGIN
    IF session_user IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'izo: funcțiile registrului se cheamă doar dintr-o sesiune postgres directă (session_user = %)', session_user USING ERRCODE = '42501';
    END IF;
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'E3b cere READ COMMITTED' USING ERRCODE='25001'; END IF;
    IF NOT pg_try_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare')) THEN
      RAISE EXCEPTION 'E3b: schema ocupata' USING ERRCODE='55P03'; END IF;
    IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
      RAISE EXCEPTION 'E3b: porti incomplete' USING ERRCODE='42501'; END IF;
    PERFORM set_config('izo.registru_tx', txid_current()::text, true);
    IF p_motiv IS NULL OR char_length(btrim(p_motiv)) < 3 THEN RAISE EXCEPTION 'izo: motivul e obligatoriu'; END IF;
    IF p_proiect IS NULL THEN RAISE EXCEPTION 'izo: proiectul e obligatoriu'; END IF;
    PERFORM public.fn_izo_lock_proiect(p_proiect, true);
    SELECT * INTO v_imp FROM public.izo_importuri WHERE proiect_id = p_proiect AND import_id = p_import_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo: importul % nu există pe proiectul %', p_import_id, p_proiect; END IF;
    IF v_imp.stare <> 'aplicat' THEN RAISE EXCEPTION 'izo: importul % e deja %', p_import_id, v_imp.stare; END IF;
    PERFORM 1 FROM public.magazie_bucati b JOIN public.magazie_bucati_miscari m ON m.bucata_id = b.id
      WHERE m.eveniment_id = v_imp.eveniment_id FOR UPDATE OF b;
    SELECT coalesce(array_agg(b.id ORDER BY b.id), '{}') INTO v_m
      FROM public.magazie_bucati b WHERE b.stare <> 'anulata' AND EXISTS (
        SELECT 1 FROM public.magazie_bucati_miscari m WHERE m.bucata_id=b.id AND m.eveniment_id=v_imp.eveniment_id AND m.rol='nascut');
    SELECT array_agg(x.bucata_id ORDER BY x.bucata_id) INTO v_deschise FROM public.fn_izo_cor_deschise(v_m) x;
    IF cardinality(v_deschise)>0 THEN
      RAISE EXCEPTION 'E3b: decide / retrage intai propunerile: %',v_deschise USING ERRCODE='23514'; END IF;
    SELECT count(*) INTO v_alt FROM public.fn_izo_lant_blocant(v_m,ARRAY[v_imp.eveniment_id]);
    IF v_alt>0 THEN RAISE EXCEPTION 'izo: storno refuzat: % miscari ulterioare',v_alt USING ERRCODE='23514'; END IF;
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, import_id, storno_de_eveniment_id, motiv, aplicat_de, server_ver)
    VALUES ('storno', p_proiect, 'import', p_import_id, p_import_id, v_imp.eveniment_id, btrim(p_motiv), public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_ev;
    INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
    SELECT v_ev, p_proiect, b.id, 'anulat', b.stare, 'anulata', nextval('public.izo_server_ver_seq')
      FROM public.magazie_bucati b WHERE b.id=ANY(v_m);
    UPDATE public.magazie_bucati b SET stare = 'anulata', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now()
      WHERE b.id=ANY(v_m) AND b.stare <> 'anulata';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> cardinality(v_m) THEN RAISE EXCEPTION 'E3b: reconciliere import esuata'; END IF;
    UPDATE public.izo_importuri SET stare = 'stornat', stornat_eveniment_id = v_ev WHERE id = v_imp.id;
    RETURN jsonb_build_object('import_id', p_import_id, 'storno_eveniment_id', v_ev, 'bucati_anulate', v_n);
  END $f$;
  RESET ROLE;
  REVOKE CREATE ON SCHEMA public FROM izo_registru_writer;
  SET LOCAL ROLE izo_receptie_writer;
  DROP FUNCTION public.fn_izo_doc_anuleaza(bigint, text);
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_receptie_writer;
  SET LOCAL ROLE izo_receptie_writer;
  CREATE FUNCTION public.fn_izo_doc_anuleaza(p_doc_id bigint, p_motiv text, p_cerut_de uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_motiv text := btrim(p_motiv); v_lipsa text[]; v_toate bigint[]; v_pv bigint[];
    v_m bigint[]; v_deschise bigint[]; v_st_pv bigint; v_st_i bigint; v_n integer;
  BEGIN
    IF session_user IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'izo E3: anularea administrativă se cheamă doar dintr-o sesiune postgres directă (session_user = %)', session_user
        USING ERRCODE = '42501';
    END IF;
    -- r5f (#825 NO-GO): READ COMMITTED impus, ca în E2a (fn_izo_lock_partajat / garda pe bucăți), înaintea oricărui lock — și pe
    -- ramura ciornei, care nu trece prin fn_izo_lock_proiect; poarta de după lock-ul „schemă” cere snapshot nou
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'izo E3: intrările E3 cer READ COMMITTED (acum %)', current_setting('transaction_isolation') USING ERRCODE = '25001';
    END IF;
    IF NOT pg_try_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare')) THEN
      RAISE EXCEPTION 'E3b: schema ocupata' USING ERRCODE='55P03'; END IF;
    IF coalesce(current_setting('izo.receptie_ctx', true), '') <> '' THEN
      RAISE EXCEPTION 'izo E3: o altă operație E3 rulează deja în această tranzacție' USING ERRCODE = '42501';
    END IF;
    v_lipsa := public.fn_izo_porti_lipsa();
    IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'izo E3: porțile registrului nu sunt complete: %', v_lipsa USING ERRCODE = '42501'; END IF;
    IF v_motiv IS NULL OR char_length(v_motiv) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'izo E3: motivul anulării e obligatoriu (3–1000 de caractere)' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
    IF NOT public.fn_izo_cor_cerut_de_valid(d.proiect_id,p_cerut_de) THEN
      RAISE EXCEPTION 'E3b: cerut_de neeligibil' USING ERRCODE='42501'; END IF;
    PERFORM set_config('izo.anulare_cerut_de',txid_current()::text || '|' || d.id::text || '|' || p_cerut_de::text,true);
    IF d.stare = 'anulat' THEN RAISE EXCEPTION 'izo E3: documentul e deja anulat' USING ERRCODE = '23505'; END IF;
    IF d.stare = 'draft' THEN
      PERFORM public.fn_izo_receptie_marcheaza('anulare_draft', d.id, d.proiect_id, d.depozit_id, d.versiune, v_motiv);
      UPDATE public.izo_documente_intrare SET stare = 'anulat', anulat_de = public.fn_izo_uid(), anulat_de_rol = session_user, anulat_la = now(),
             anulat_motiv = v_motiv, versiune = versiune + 1, updated_at = now()
       WHERE id = d.id RETURNING * INTO d;
      RETURN jsonb_build_object('document_id', d.id, 'stare', d.stare, 'storno', false, 'versiune', d.versiune);
    END IF;
    PERFORM public.fn_izo_blocheaza_locuri(d.proiect_id, ARRAY[d.depozit_id], '{}'::bigint[]);
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_proiect(d.proiect_id, true);
    SELECT coalesce(array_agg(x.bucata_id ORDER BY x.bucata_id), '{}') INTO v_toate
      FROM public.izo_documente_intrare_randuri x WHERE x.document_id = d.id AND x.bucata_id IS NOT NULL;
    PERFORM 1 FROM public.magazie_bucati b WHERE b.id = ANY (v_toate) ORDER BY b.id FOR UPDATE;
    IF coalesce(public.fn_izo_nivel(d.proiect_id), 'off') NOT IN ('stoc', 'montaj') THEN
      RAISE EXCEPTION 'izo E3: proiectul e off — anularea unui document confirmat cere întâi reactivarea' USING ERRCODE = '42501';
    END IF;
    SELECT array_agg(x.bucata_id ORDER BY x.bucata_id) INTO v_deschise FROM public.fn_izo_cor_deschise(v_toate) x;
    IF cardinality(v_deschise)>0 THEN
      RAISE EXCEPTION 'E3b: decide / retrage intai propunerile: %',v_deschise USING ERRCODE='23514'; END IF;
    SELECT count(*) INTO v_n FROM public.fn_izo_lant_blocant(v_toate,array_remove(ARRAY[d.eveniment_intrare_id,d.eveniment_pv_id],NULL));
    IF v_n>0 THEN RAISE EXCEPTION 'izo E3: anulare refuzata: % miscari ulterioare',v_n USING ERRCODE='23514'; END IF;
    PERFORM public.fn_izo_receptie_marcheaza('anulare', d.id, d.proiect_id, d.depozit_id, d.versiune, v_motiv);
    IF d.eveniment_pv_id IS NOT NULL THEN
      INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, storno_de_eveniment_id, motiv, declarat_de, aplicat_de, server_ver)
      VALUES ('storno', d.proiect_id, 'doc_intrare', d.id::text, d.eveniment_pv_id, v_motiv, p_cerut_de, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
      RETURNING id INTO v_st_pv;
      SELECT coalesce(array_agg(m.bucata_id ORDER BY m.bucata_id), '{}') INTO v_pv FROM public.magazie_bucati_miscari m JOIN public.magazie_bucati b ON b.id=m.bucata_id WHERE m.eveniment_id = d.eveniment_pv_id AND b.stare='receptionat';
      INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
      SELECT v_st_pv, d.proiect_id, x, 'stare', 'receptionat', 'sosit', nextval('public.izo_server_ver_seq') FROM unnest(v_pv) x;
      UPDATE public.magazie_bucati SET stare = 'sosit', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now()
       WHERE id = ANY (v_pv) AND stare = 'receptionat';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> cardinality(v_pv) THEN RAISE EXCEPTION 'izo E3: reconcilierea storno-ului PV a eșuat'; END IF;
    END IF;
    SELECT coalesce(array_agg(b.id ORDER BY b.id),'{}') INTO v_m FROM public.magazie_bucati b WHERE b.id=ANY(v_toate) AND b.stare<>'anulata';
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, storno_de_eveniment_id, motiv, declarat_de, aplicat_de, server_ver)
    VALUES ('storno', d.proiect_id, 'doc_intrare', d.id::text, d.eveniment_intrare_id, v_motiv, p_cerut_de, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_st_i;
    INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
    SELECT v_st_i, d.proiect_id, b.id, 'anulat', b.stare, 'anulata', nextval('public.izo_server_ver_seq')
      FROM public.magazie_bucati b WHERE b.id = ANY (v_m) ORDER BY b.id;
    UPDATE public.magazie_bucati SET stare = 'anulata', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now() WHERE id = ANY (v_m) AND stare<>'anulata';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> cardinality(v_m) THEN RAISE EXCEPTION 'izo E3: reconcilierea storno-ului intrării a eșuat'; END IF;
    UPDATE public.izo_documente_intrare SET stare = 'anulat', anulat_de = public.fn_izo_uid(), anulat_de_rol = session_user, anulat_la = now(),
           anulat_motiv = v_motiv, eveniment_storno_intrare_id = v_st_i, eveniment_storno_pv_id = v_st_pv, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'stare', d.stare, 'storno', true, 'storno_intrare_id', v_st_i, 'storno_pv_id', v_st_pv,
                              'bucati_anulate', cardinality(v_m), 'versiune', d.versiune);
  END $f$;
  RESET ROLE;
  REVOKE CREATE ON SCHEMA public FROM izo_receptie_writer;
  GRANT CREATE ON SCHEMA public TO izo_receptie_writer;
  SET LOCAL ROLE izo_receptie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_anuleaza(bigint, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_anuleaza(bigint, text, uuid) TO postgres;
  RESET ROLE;
  REVOKE CREATE ON SCHEMA public FROM izo_receptie_writer;
  CREATE OR REPLACE FUNCTION public.fn_izo_garda_receptie(p_tabel text, p_op text, p_old jsonb, p_new jsonb) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE
    m text[]; v_op text; v_doc bigint; v_proiect bigint; v_depozit integer; v_ver bigint; v_arg text;
    d public.izo_documente_intrare; v_tip_intrare text; v_ev_intrare bigint; v_ev_pv bigint; v_st_intrare bigint; v_st_pv bigint;
    v_b public.magazie_bucati; v_r public.izo_documente_intrare_randuri; v_exp jsonb; v_storno_de bigint; v_permise text[];
    c_gen_buc constant text[] := ARRAY['serie_canon', 'lungime_cm'];
    c_gen_doc constant text[] := ARRAY['furnizor_canon', 'nr_document_canon'];
  BEGIN
    IF current_user <> 'izo_receptie_writer' THEN
      RAISE EXCEPTION 'izo E3: garda recepției e doar pentru izo_receptie_writer' USING ERRCODE = '42501';
    END IF;
    m := regexp_match(coalesce(current_setting('izo.receptie_ctx', true), ''),
                      '^([0-9]+)\|(confirma|pv|anulare|anulare_draft)\|([0-9]+)\|([0-9]+)\|([0-9]+)\|([0-9]+)\|(.*)$');
    IF m IS NULL OR m[1] <> txid_current()::text THEN
      RAISE EXCEPTION 'izo E3: %.% fără contextul operației (marcaj lipsă sau din altă tranzacție)', p_tabel, p_op USING ERRCODE = '42501';
    END IF;
    v_op := m[2]; v_doc := m[3]::bigint; v_proiect := m[4]::bigint; v_depozit := m[5]::integer; v_ver := m[6]::bigint; v_arg := m[7];
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = v_doc;
    IF NOT FOUND OR d.proiect_id <> v_proiect OR d.depozit_id <> v_depozit THEN
      RAISE EXCEPTION 'izo E3: documentul contextului nu bate (document / proiect / depozit)' USING ERRCODE = '42501';
    END IF;
    v_tip_intrare := CASE d.sablon WHEN 'aviz_teava' THEN 'intrare_aviz' ELSE 'intrare_lista_ambalare' END;
    -- evenimentele documentului, identificate prin indexurile unice parțiale (nu prin FK-urile antetului, scrise la final)
    SELECT e.id INTO v_ev_intrare FROM public.magazie_bucati_evenimente e
     WHERE e.document_tip = 'doc_intrare' AND e.document_id = v_doc::text AND e.tip = v_tip_intrare AND e.proiect_id = v_proiect;
    SELECT e.id INTO v_ev_pv FROM public.magazie_bucati_evenimente e
     WHERE e.document_tip = 'doc_intrare' AND e.document_id = v_doc::text AND e.tip = 'receptie_pv' AND e.proiect_id = v_proiect;
    IF v_ev_intrare IS NOT NULL THEN
      SELECT e.id INTO v_st_intrare FROM public.magazie_bucati_evenimente e WHERE e.storno_de_eveniment_id = v_ev_intrare;
    END IF;
    IF v_ev_pv IS NOT NULL THEN
      SELECT e.id INTO v_st_pv FROM public.magazie_bucati_evenimente e WHERE e.storno_de_eveniment_id = v_ev_pv;
    END IF;
    -- pe registru și pe rânduri: antetul încă nemodificat (se scrie ultimul), în starea cerută de operație
    IF p_tabel <> 'izo_documente_intrare' THEN
      IF d.versiune <> v_ver
         OR (v_op = 'confirma' AND d.stare <> 'draft')
         OR (v_op = 'pv' AND (d.stare <> 'confirmat' OR d.eveniment_pv_id IS NOT NULL))
         OR (v_op = 'anulare' AND d.stare <> 'confirmat')
         OR v_op = 'anulare_draft' THEN
        RAISE EXCEPTION 'izo E3: %.% nu e permisă în starea documentului (% / v%, context % / v%)', p_tabel, p_op, d.stare, d.versiune, v_op, v_ver
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF p_tabel = 'magazie_bucati_evenimente' AND p_op = 'INSERT' THEN
      IF v_op = 'confirma' THEN
        IF v_ev_intrare IS NOT NULL OR v_arg IS DISTINCT FROM public.fn_izo_doc_hash(v_doc) THEN
          RAISE EXCEPTION 'izo E3: evenimentul de intrare există deja sau hash-ul nu bate' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'pv' THEN
        IF v_ev_intrare IS NULL OR v_ev_pv IS NOT NULL THEN
          RAISE EXCEPTION 'izo E3: PV fără intrare sau PV deja pus' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'anulare' THEN
        -- ordinea inversării: PV-ul întâi (dacă există și nu e stornat), apoi intrarea
        v_storno_de := CASE WHEN v_ev_pv IS NOT NULL AND v_st_pv IS NULL THEN v_ev_pv
                            WHEN v_ev_intrare IS NOT NULL AND v_st_intrare IS NULL THEN v_ev_intrare END;
        IF v_storno_de IS NULL THEN RAISE EXCEPTION 'izo E3: nimic de stornat pe document' USING ERRCODE = '42501'; END IF;
      END IF;
      v_exp := public.fn_izo_eveniment_asteptat(v_op, v_doc, v_storno_de, v_arg);
      IF v_op='anulare' THEN
        IF split_part(coalesce(current_setting('izo.anulare_cerut_de',true),''),'|',1) IS DISTINCT FROM txid_current()::text
          OR split_part(current_setting('izo.anulare_cerut_de',true),'|',2) IS DISTINCT FROM v_doc::text
          OR nullif(split_part(current_setting('izo.anulare_cerut_de',true),'|',3),'') IS NULL THEN
          RAISE EXCEPTION 'E3b: context cerut_de invalid' USING ERRCODE='42501'; END IF;
        v_exp := jsonb_set(v_exp,'{declarat_de}',to_jsonb(split_part(current_setting('izo.anulare_cerut_de',true),'|',3)::uuid));
      END IF;
      IF public.fn_izo_proiectie(p_new, public.fn_izo_coloane_ev()) IS DISTINCT FROM public.fn_izo_proiectie(v_exp, public.fn_izo_coloane_ev()) THEN
        RAISE EXCEPTION 'izo E3: evenimentul diferă de cel așteptat pentru % pe documentul %', v_op, v_doc USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'magazie_bucati' AND p_op = 'INSERT' THEN
      IF v_op <> 'confirma' THEN RAISE EXCEPTION 'izo E3: bucăți noi doar la confirmare' USING ERRCODE = '42501'; END IF;
      SELECT * INTO v_r FROM public.izo_documente_intrare_randuri WHERE document_id = v_doc AND nr_crt = (p_new ->> 'nr_crt_aviz')::integer;
      IF NOT FOUND OR v_r.decizie NOT IN ('primit', 'primit_neconform') OR v_r.bucata_id IS NOT NULL THEN
        RAISE EXCEPTION 'izo E3: rândul % al documentului % nu primește bucată', p_new ->> 'nr_crt_aviz', v_doc USING ERRCODE = '42501';
      END IF;
      IF (p_new ->> 'radacina_id') IS DISTINCT FROM (p_new ->> 'id') OR (p_new ->> 'uid') IS NULL OR (p_new ->> 'server_ver') IS NULL THEN
        RAISE EXCEPTION 'izo E3: bucata nu e rădăcină completă (radacina_id = id, uid, server_ver)' USING ERRCODE = '42501';
      END IF;
      v_exp := public.fn_izo_doc_bucata_asteptata(v_doc, v_r.nr_crt);
      IF public.fn_izo_proiectie(p_new, public.fn_izo_coloane_c()) IS DISTINCT FROM public.fn_izo_proiectie(v_exp, public.fn_izo_coloane_c()) THEN
        RAISE EXCEPTION 'izo E3: bucata rândului % diferă de documentul confirmat', v_r.nr_crt USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'magazie_bucati' AND p_op = 'UPDATE' THEN
      IF v_op NOT IN ('pv', 'anulare') THEN RAISE EXCEPTION 'izo E3: UPDATE pe bucăți doar la PV / anulare' USING ERRCODE = '42501'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare_randuri x WHERE x.document_id = v_doc AND x.bucata_id = (p_old ->> 'id')::bigint
                      AND (v_op <> 'pv' OR x.decizie = 'primit'))
         OR (p_new ->> 'proiect_id') IS DISTINCT FROM v_proiect::text
         OR (p_new - c_gen_buc - 'stare' - 'server_ver' - 'updated_at') IS DISTINCT FROM (p_old - c_gen_buc - 'stare' - 'server_ver' - 'updated_at')
         OR (p_new ->> 'server_ver') IS NULL THEN
        RAISE EXCEPTION 'izo E3: UPDATE pe o bucată străină documentului sau pe alte coloane decât starea' USING ERRCODE = '42501';
      END IF;
      IF NOT ((v_op = 'pv' AND p_old ->> 'stare' = 'sosit' AND p_new ->> 'stare' = 'receptionat')
           OR (v_op = 'anulare' AND v_st_pv IS NOT NULL AND v_st_intrare IS NULL AND p_old ->> 'stare' = 'receptionat' AND p_new ->> 'stare' = 'sosit')
           OR (v_op = 'anulare' AND v_st_intrare IS NOT NULL AND p_old ->> 'stare' IN ('sosit', 'receptionat', 'carantina', 'pierduta') AND p_new ->> 'stare' = 'anulata')) THEN
        RAISE EXCEPTION 'izo E3: tranziția % → % nu e permisă la %', p_old ->> 'stare', p_new ->> 'stare', v_op USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'magazie_bucati_miscari' AND p_op = 'INSERT' THEN
      SELECT * INTO v_b FROM public.magazie_bucati WHERE id = (p_new ->> 'bucata_id')::bigint;
      IF NOT FOUND OR v_b.aviz_intrare_id IS DISTINCT FROM v_doc
         OR NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare_randuri x WHERE x.document_id = v_doc AND x.nr_crt = v_b.nr_crt_aviz
                         AND (x.bucata_id IS NULL OR x.bucata_id = v_b.id)) THEN
        RAISE EXCEPTION 'izo E3: mișcarea e pe o bucată străină documentului %', v_doc USING ERRCODE = '42501';
      END IF;
      IF v_op = 'confirma' THEN
        v_exp := public.fn_izo_miscare_asteptata(v_ev_intrare, v_b.id, 'nascut', NULL, v_b.stare,
                   jsonb_build_object('tip', 'depozit', 'depozit_id', v_depozit), v_b.lungime_mm);
      ELSIF v_op = 'pv' THEN
        IF v_b.stare <> 'receptionat' OR NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare_randuri x
             WHERE x.document_id = v_doc AND x.bucata_id = v_b.id AND x.decizie = 'primit') THEN
          RAISE EXCEPTION 'izo E3: mișcarea PV e pe o bucată din afara mulțimii PV' USING ERRCODE = '42501';
        END IF;
        v_exp := public.fn_izo_miscare_asteptata(v_ev_pv, v_b.id, 'stare', 'sosit', 'receptionat', NULL, NULL);
      ELSIF v_op = 'anulare' AND v_st_pv IS NOT NULL AND v_st_intrare IS NULL AND (p_new ->> 'eveniment_id')::bigint = v_st_pv THEN
        IF v_b.stare <> 'receptionat' OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_miscari m WHERE m.bucata_id=v_b.id AND m.eveniment_id=v_ev_pv) OR EXISTS (SELECT 1 FROM public.magazie_bucati_miscari m WHERE m.bucata_id=v_b.id AND m.eveniment_id=v_st_pv) THEN
          RAISE EXCEPTION 'E3b: miscare storno invalida / repetata' USING ERRCODE='42501'; END IF;
        v_exp := public.fn_izo_miscare_asteptata(v_st_pv, v_b.id, 'stare', 'receptionat', 'sosit', NULL, NULL);
      ELSIF v_op = 'anulare' AND v_st_intrare IS NOT NULL AND (p_new ->> 'eveniment_id')::bigint = v_st_intrare THEN
        IF v_b.stare NOT IN ('sosit','receptionat','carantina','pierduta') OR EXISTS (SELECT 1 FROM public.magazie_bucati_miscari m WHERE m.bucata_id=v_b.id AND m.eveniment_id=v_st_intrare) THEN
          RAISE EXCEPTION 'E3b: miscare storno invalida / repetata' USING ERRCODE='42501'; END IF;
        v_exp := public.fn_izo_miscare_asteptata(v_st_intrare, v_b.id, 'anulat', v_b.stare, 'anulata', NULL, NULL);
      ELSE
        RAISE EXCEPTION 'izo E3: mișcare pe un eveniment care nu e al operației % pe documentul %', v_op, v_doc USING ERRCODE = '42501';
      END IF;
      IF v_exp IS NULL OR public.fn_izo_proiectie(p_new, public.fn_izo_coloane_mis()) IS DISTINCT FROM public.fn_izo_proiectie(v_exp, public.fn_izo_coloane_mis()) THEN
        RAISE EXCEPTION 'izo E3: mișcarea diferă de cea așteptată (%, bucata %)', v_op, v_b.id USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'izo_documente_intrare_randuri' AND p_op = 'UPDATE' THEN
      IF v_op <> 'confirma' OR (p_old ->> 'document_id')::bigint <> v_doc OR (p_old ->> 'bucata_id') IS NOT NULL OR (p_new ->> 'bucata_id') IS NULL
         OR (p_new - 'bucata_id') IS DISTINCT FROM (p_old - 'bucata_id')
         OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati b WHERE b.id = (p_new ->> 'bucata_id')::bigint
                         AND b.aviz_intrare_id = v_doc AND b.nr_crt_aviz = (p_old ->> 'nr_crt')::integer) THEN
        RAISE EXCEPTION 'izo E3: rândul % primește doar bucata lui, la confirmare', p_old ->> 'nr_crt' USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'izo_documente_intrare' AND p_op = 'UPDATE' THEN
      IF (p_old ->> 'id')::bigint <> v_doc OR (p_old ->> 'versiune')::bigint <> v_ver OR (p_new ->> 'versiune')::bigint <> v_ver + 1 THEN
        RAISE EXCEPTION 'izo E3: antetul se scrie doar cu versiunea contextului + 1' USING ERRCODE = '42501';
      END IF;
      IF v_op = 'confirma' THEN
        v_permise := ARRAY['stare', 'versiune', 'updated_at', 'hash_confirmat', 'avertismente', 'confirmat_de', 'confirmat_la', 'eveniment_intrare_id'];
        IF p_old ->> 'stare' <> 'draft' OR p_new ->> 'stare' <> 'confirmat' OR p_new ->> 'hash_confirmat' IS DISTINCT FROM v_arg
           OR v_ev_intrare IS NULL OR (p_new ->> 'eveniment_intrare_id')::bigint IS DISTINCT FROM v_ev_intrare
           OR (p_new ->> 'confirmat_de') IS DISTINCT FROM public.fn_izo_uid()::text OR (p_new ->> 'confirmat_la') IS NULL THEN
          RAISE EXCEPTION 'izo E3: confirmarea antetului nu bate cu contextul / evenimentul de intrare' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'pv' THEN
        v_permise := ARRAY['versiune', 'updated_at', 'pv_nr', 'pv_nr_canon', 'pv_data', 'pv_pus_de', 'pv_pus_la', 'eveniment_pv_id'];
        IF p_old ->> 'stare' <> 'confirmat' OR p_new ->> 'stare' <> 'confirmat' OR (p_old ->> 'eveniment_pv_id') IS NOT NULL
           OR p_new ->> 'pv_nr_canon' IS DISTINCT FROM split_part(v_arg, '|', 1) OR p_new ->> 'pv_data' IS DISTINCT FROM split_part(v_arg, '|', 2)
           OR v_ev_pv IS NULL OR (p_new ->> 'eveniment_pv_id')::bigint IS DISTINCT FROM v_ev_pv
           OR (p_new ->> 'pv_pus_de') IS DISTINCT FROM public.fn_izo_uid()::text OR (p_new ->> 'pv_pus_la') IS NULL THEN
          RAISE EXCEPTION 'izo E3: PV-ul antetului nu bate cu contextul / evenimentul PV' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'anulare' THEN
        v_permise := ARRAY['stare', 'versiune', 'updated_at', 'anulat_de', 'anulat_de_rol', 'anulat_la', 'anulat_motiv', 'eveniment_storno_intrare_id', 'eveniment_storno_pv_id'];
        IF p_old ->> 'stare' <> 'confirmat' OR p_new ->> 'stare' <> 'anulat' OR p_new ->> 'anulat_motiv' IS DISTINCT FROM v_arg
           OR (p_new ->> 'anulat_de') IS DISTINCT FROM public.fn_izo_uid()::text
           OR p_new ->> 'anulat_de_rol' IS DISTINCT FROM session_user::text OR (p_new ->> 'anulat_la') IS NULL
           OR v_st_intrare IS NULL OR (p_new ->> 'eveniment_storno_intrare_id')::bigint IS DISTINCT FROM v_st_intrare
           OR (v_ev_pv IS NOT NULL AND v_st_pv IS NULL)
           OR (p_new ->> 'eveniment_storno_pv_id')::bigint IS DISTINCT FROM v_st_pv THEN
          RAISE EXCEPTION 'izo E3: anularea antetului nu bate cu storno-urile scrise' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'anulare_draft' THEN
        v_permise := ARRAY['stare', 'versiune', 'updated_at', 'anulat_de', 'anulat_de_rol', 'anulat_la', 'anulat_motiv'];
        IF p_old ->> 'stare' <> 'draft' OR p_new ->> 'stare' <> 'anulat' OR p_new ->> 'anulat_motiv' IS DISTINCT FROM v_arg
           OR (p_new ->> 'anulat_de') IS DISTINCT FROM public.fn_izo_uid()::text
           OR p_new ->> 'anulat_de_rol' IS DISTINCT FROM session_user::text OR (p_new ->> 'anulat_la') IS NULL THEN
          RAISE EXCEPTION 'izo E3: anularea draftului nu bate cu contextul' USING ERRCODE = '42501';
        END IF;
      END IF;
      IF (p_new - c_gen_doc - v_permise) IS DISTINCT FROM (p_old - c_gen_doc - v_permise) THEN
        RAISE EXCEPTION 'izo E3: antetul se modifică doar pe coloanele operației %', v_op USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    RAISE EXCEPTION 'izo E3: %.% nu e permisă în contextul %', p_tabel, p_op, v_op USING ERRCODE = '42501';
  END $f$;
  CREATE FUNCTION public.fn_izo_doc_instantaneu(p_doc bigint) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT jsonb_build_object(
      'v', 'e3-doc-v1',
      'antet', jsonb_build_object('proiect_id', d.proiect_id, 'depozit_id', d.depozit_id, 'sablon', d.sablon,
        'furnizor', d.furnizor, 'furnizor_canon', d.furnizor_canon, 'furnizor_cif', d.furnizor_cif, 'nr_document', d.nr_document,
        'nr_document_canon', d.nr_document_canon, 'data_document', d.data_document, 'inlocuieste_document_id', d.inlocuieste_document_id,
        'motiv_inlocuire', d.motiv_inlocuire, 'observatii', d.observatii),
      'aviz', jsonb_build_object('cumparator', d.cumparator, 'transport_nr', d.transport_nr, 'nume_proiect', d.nume_proiect, 'lot', d.lot,
        'loc_livrare', d.loc_livrare, 'data_incarcare', d.data_incarcare, 'data_descarcare', d.data_descarcare, 'nr_camion', d.nr_camion),
      'lista', jsonb_build_object('factura', d.factura, 'importator', d.importator, 'destinatar', d.destinatar,
        'referinta_client', d.referinta_client, 'referinta_furnizor', d.referinta_furnizor, 'placa_camion_container', d.placa_camion_container),
      'totaluri', jsonb_build_object('total_m', round(d.total_m, 3)::text, 'total_kg', round(d.total_kg, 1)::text, 'total_bucati', d.total_bucati,
        'total_pachete', d.total_pachete, 'total_net_kg', round(d.total_net_kg, 1)::text, 'total_brut_kg', round(d.total_brut_kg, 1)::text),
      'randuri', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'nr_crt', r.nr_crt, 'serie', r.serie, 'sarja', r.sarja, 'lot', r.lot, 'specificatie', r.specificatie, 'dimensiune', r.dimensiune,
          'grad_otel', r.grad_otel, 'standard', r.standard, 'izolatie', r.izolatie, 'diametru_mm', r.diametru_mm,
          'perete_mm', round(r.perete_mm, 1)::text, 'greutate_kg', round(r.greutate_kg, 1)::text,
          'lungime_doc_mm', r.lungime_doc_mm, 'lungime_masurata_mm', r.lungime_masurata_mm, 'cod', r.cod, 'item', r.item,
          'unghi_doc', round(r.unghi_doc, 1)::text, 'unghi_masurat', round(r.unghi_masurat, 1)::text, 'cantitate', r.cantitate,
          'pachet_nr', r.pachet_nr, 'dimensiuni_cm', r.dimensiuni_cm, 'net_kg', round(r.net_kg, 1)::text, 'brut_kg', round(r.brut_kg, 1)::text,
          'decizie', r.decizie, 'motiv', r.motiv, 'observatie', r.observatie) ORDER BY r.nr_crt), '[]'::jsonb)
        FROM public.izo_documente_intrare_randuri r WHERE r.document_id = d.id),
      'scanuri', (SELECT coalesce(jsonb_agg(jsonb_build_object('cale', s.cale, 'sha256_original', s.sha256_original,
          'sha256_pdf', s.sha256_pdf, 'marime', s.marime, 'mime', s.mime) ORDER BY s.cale), '[]'::jsonb)
        FROM public.izo_documente_scanuri s WHERE s.document_id = d.id)
    )
    FROM public.izo_documente_intrare d WHERE d.id = p_doc
  $f$;
  GRANT CREATE ON SCHEMA public TO izo_doc_editor;
  SET LOCAL ROLE izo_doc_editor;
  CREATE OR REPLACE FUNCTION public.fn_izo_doc_salveaza(p_doc_id bigint, p_versiune bigint, p_antet jsonb, p_randuri jsonb, p_scanuri jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; d public.izo_documente_intrare; v_k text; v_x jsonb; v_tp bigint; v_td integer;
    c_antet constant text[] := ARRAY['furnizor', 'furnizor_cif', 'nr_document', 'data_document', 'cumparator', 'transport_nr', 'nume_proiect', 'lot', 'loc_livrare', 'data_incarcare', 'data_descarcare', 'nr_camion', 'factura', 'importator', 'destinatar', 'referinta_client', 'referinta_furnizor', 'placa_camion_container', 'total_m', 'total_kg', 'total_bucati', 'total_pachete', 'total_net_kg', 'total_brut_kg', 'observatii'];
    c_creare constant text[] := ARRAY['proiect_id', 'depozit_id', 'sablon', 'inlocuieste_document_id', 'motiv_inlocuire'];
    c_rand constant text[] := ARRAY['nr_crt', 'serie', 'sarja', 'lot', 'specificatie', 'dimensiune', 'grad_otel', 'standard', 'izolatie', 'diametru_mm', 'perete_mm', 'greutate_kg', 'lungime_doc_mm', 'lungime_masurata_mm', 'cod', 'item', 'unghi_doc', 'unghi_masurat', 'cantitate', 'pachet_nr', 'dimensiuni_cm', 'net_kg', 'brut_kg', 'decizie', 'motiv', 'observatie'];
    c_scan constant text[] := ARRAY['cale', 'sha256_original', 'sha256_pdf', 'marime', 'mime'];
  BEGIN
    v_uid := public.fn_izo_doc_api_verifica();
    IF jsonb_typeof(p_antet) IS DISTINCT FROM 'object' OR jsonb_typeof(p_randuri) IS DISTINCT FROM 'array'
       OR (p_scanuri IS NOT NULL AND jsonb_typeof(p_scanuri) IS DISTINCT FROM 'array') THEN
      RAISE EXCEPTION 'izo E3: p_antet trebuie să fie obiect, p_randuri listă, p_scanuri listă sau null' USING ERRCODE = '22023';
    END IF;
    SELECT k INTO v_k FROM jsonb_object_keys(p_antet) k WHERE k <> ALL (c_antet || c_creare) LIMIT 1;
    IF v_k IS NOT NULL THEN RAISE EXCEPTION 'izo E3: cheie necunoscută în antet: %', v_k USING ERRCODE = '22023'; END IF;
    FOR v_x IN SELECT x FROM jsonb_array_elements(p_randuri) x LOOP
      IF jsonb_typeof(v_x) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'izo E3: un rând nu e obiect' USING ERRCODE = '22023'; END IF;
      SELECT k INTO v_k FROM jsonb_object_keys(v_x) k WHERE k <> ALL (c_rand) LIMIT 1;
      IF v_k IS NOT NULL THEN RAISE EXCEPTION 'izo E3: cheie necunoscută în rând: %', v_k USING ERRCODE = '22023'; END IF;
      -- r5f (#825 NO-GO): 1 rând = 1 bucată — confirmarea naște exact una pe rând; cantitatea e goală (= 1) sau 1 (și CHECK pe tabel)
      IF v_x ->> 'cantitate' IS NOT NULL AND (v_x ->> 'cantitate')::numeric IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'izo E3: rândul %: cantitatea e %; un rând = o bucată (cantitate 1 sau goală) — fiecare bucată pe rândul ei, cu seria ei',
          v_x ->> 'nr_crt', v_x ->> 'cantitate' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF p_scanuri IS NOT NULL THEN
      FOR v_x IN SELECT x FROM jsonb_array_elements(p_scanuri) x LOOP
        IF jsonb_typeof(v_x) IS DISTINCT FROM 'object'
           OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_x) k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(c_scan) k) THEN
          RAISE EXCEPTION 'izo E3: un scan din manifest are exact cheile cale, sha256_original, sha256_pdf, marime, mime' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    IF p_doc_id IS NULL THEN
      IF p_versiune IS NOT NULL THEN RAISE EXCEPTION 'izo E3: la creare p_versiune e NULL' USING ERRCODE = '22023'; END IF;
      IF NOT public.fn_izo_doc_autorizare_lock((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer) THEN
        RAISE EXCEPTION 'izo E3: nu ești gestionar pe acest proiect și depozit' USING ERRCODE = '42501';
      END IF;
      IF coalesce(public.fn_izo_nivel((p_antet ->> 'proiect_id')::bigint), 'off') NOT IN ('stoc', 'montaj') THEN
        RAISE EXCEPTION 'izo E3: proiectul nu are registrul de țeavă activ' USING ERRCODE = '42501';
      END IF;
      IF NOT public.fn_izo_loc_valid((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer, NULL) THEN
        RAISE EXCEPTION 'izo E3: depozitul nu e activ sau nu e pe site-ul proiectului' USING ERRCODE = '23514';
      END IF;
      -- r5f (#825 NO-GO): ținta înlocuirii se verifică și se autorizează ÎNAINTEA INSERT-ului — altfel FK-ul (23503) / UNIQUE-ul
      -- (23505) de pe inlocuieste_document_id ar spune dacă un document inaccesibil există sau e deja înlocuit (oracle între
      -- proiecte). „Nu există” și „există, dar nu e al tău” dau același mesaj; UNIQUE-ul rămâne arbitrul, după autorizare
      IF p_antet ->> 'inlocuieste_document_id' IS NOT NULL THEN
        SELECT t.proiect_id, t.depozit_id INTO v_tp, v_td FROM public.izo_documente_intrare t
         WHERE t.id = (p_antet ->> 'inlocuieste_document_id')::bigint AND t.stare = 'anulat' FOR SHARE;
        IF NOT FOUND OR NOT public.fn_izo_doc_autorizare_lock(v_tp, v_td) THEN
          RAISE EXCEPTION 'izo E3: documentul înlocuit nu există, nu e anulat sau nu ai acces la el' USING ERRCODE = '23514';
        END IF;
      END IF;
      INSERT INTO public.izo_documente_intrare (proiect_id, depozit_id, sablon, inlocuieste_document_id, motiv_inlocuire, creat_de, furnizor, furnizor_cif, nr_document, data_document, cumparator, transport_nr, nume_proiect, lot, loc_livrare, data_incarcare, data_descarcare, nr_camion, factura, importator, destinatar, referinta_client, referinta_furnizor, placa_camion_container, total_m, total_kg, total_bucati, total_pachete, total_net_kg, total_brut_kg, observatii)
      VALUES ((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer, p_antet ->> 'sablon',
              (p_antet ->> 'inlocuieste_document_id')::bigint, p_antet ->> 'motiv_inlocuire', v_uid, p_antet ->> 'furnizor', p_antet ->> 'furnizor_cif', p_antet ->> 'nr_document', (p_antet ->> 'data_document')::date, p_antet ->> 'cumparator', p_antet ->> 'transport_nr', p_antet ->> 'nume_proiect', p_antet ->> 'lot', p_antet ->> 'loc_livrare', (p_antet ->> 'data_incarcare')::date, (p_antet ->> 'data_descarcare')::date, p_antet ->> 'nr_camion', p_antet ->> 'factura', p_antet ->> 'importator', p_antet ->> 'destinatar', p_antet ->> 'referinta_client', p_antet ->> 'referinta_furnizor', p_antet ->> 'placa_camion_container', (p_antet ->> 'total_m')::numeric, (p_antet ->> 'total_kg')::numeric, (p_antet ->> 'total_bucati')::integer, (p_antet ->> 'total_pachete')::integer, (p_antet ->> 'total_net_kg')::numeric, (p_antet ->> 'total_brut_kg')::numeric, p_antet ->> 'observatii')
      RETURNING * INTO d;
    ELSE
      SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
      IF NOT public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id) THEN
        RAISE EXCEPTION 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' USING ERRCODE = '42501';
      END IF;
      IF d.stare <> 'draft' THEN RAISE EXCEPTION 'izo E3: documentul e %; se editează doar ciornele', d.stare USING ERRCODE = '42501'; END IF;
      IF p_versiune IS DISTINCT FROM d.versiune THEN
        RAISE EXCEPTION 'izo E3: documentul s-a schimbat între timp (versiunea %, trimisă %) — reîncarcă', d.versiune, p_versiune USING ERRCODE = '40001';
      END IF;
      IF (p_antet ? 'proiect_id' AND (p_antet ->> 'proiect_id')::bigint IS DISTINCT FROM d.proiect_id)
         OR (p_antet ? 'depozit_id' AND (p_antet ->> 'depozit_id')::integer IS DISTINCT FROM d.depozit_id)
         OR (p_antet ? 'sablon' AND p_antet ->> 'sablon' IS DISTINCT FROM d.sablon)
         OR (p_antet ? 'inlocuieste_document_id' AND (p_antet ->> 'inlocuieste_document_id')::bigint IS DISTINCT FROM d.inlocuieste_document_id)
         OR (p_antet ? 'motiv_inlocuire' AND p_antet ->> 'motiv_inlocuire' IS DISTINCT FROM d.motiv_inlocuire) THEN
        RAISE EXCEPTION 'izo E3: proiectul / depozitul / șablonul / înlocuirea nu se schimbă după creare (document nou)' USING ERRCODE = '22023';
      END IF;
      UPDATE public.izo_documente_intrare SET
        furnizor = p_antet ->> 'furnizor',
        furnizor_cif = p_antet ->> 'furnizor_cif',
        nr_document = p_antet ->> 'nr_document',
        data_document = (p_antet ->> 'data_document')::date,
        cumparator = p_antet ->> 'cumparator',
        transport_nr = p_antet ->> 'transport_nr',
        nume_proiect = p_antet ->> 'nume_proiect',
        lot = p_antet ->> 'lot',
        loc_livrare = p_antet ->> 'loc_livrare',
        data_incarcare = (p_antet ->> 'data_incarcare')::date,
        data_descarcare = (p_antet ->> 'data_descarcare')::date,
        nr_camion = p_antet ->> 'nr_camion',
        factura = p_antet ->> 'factura',
        importator = p_antet ->> 'importator',
        destinatar = p_antet ->> 'destinatar',
        referinta_client = p_antet ->> 'referinta_client',
        referinta_furnizor = p_antet ->> 'referinta_furnizor',
        placa_camion_container = p_antet ->> 'placa_camion_container',
        total_m = (p_antet ->> 'total_m')::numeric,
        total_kg = (p_antet ->> 'total_kg')::numeric,
        total_bucati = (p_antet ->> 'total_bucati')::integer,
        total_pachete = (p_antet ->> 'total_pachete')::integer,
        total_net_kg = (p_antet ->> 'total_net_kg')::numeric,
        total_brut_kg = (p_antet ->> 'total_brut_kg')::numeric,
        observatii = p_antet ->> 'observatii',
        versiune = versiune + 1, updated_at = now()
       WHERE id = d.id RETURNING * INTO d;
    END IF;
    -- înlocuirea (r5d §13.4 + r5e): ținta există, e anulată (finală), nu e documentul curent, iar utilizatorul e autorizat și pe
    -- proiectul / depozitul ȚINTEI (gestionar acolo sau owner); revalidată sub lock la fiecare salvare. Mesaj generic: nu
    -- dezvăluie dacă ținta există pe un proiect inaccesibil
    IF d.inlocuieste_document_id IS NOT NULL THEN
      SELECT t.proiect_id, t.depozit_id INTO v_tp, v_td FROM public.izo_documente_intrare t
       WHERE t.id = d.inlocuieste_document_id AND t.stare = 'anulat' AND t.id <> d.id FOR SHARE;
      IF NOT FOUND OR NOT public.fn_izo_doc_autorizare_lock(v_tp, v_td) THEN
        RAISE EXCEPTION 'izo E3: documentul înlocuit nu există, nu e anulat sau nu ai acces la el' USING ERRCODE = '23514';
      END IF;
    END IF;
    DELETE FROM public.izo_documente_intrare_randuri WHERE document_id = d.id;
    INSERT INTO public.izo_documente_intrare_randuri (document_id, nr_crt, serie, sarja, lot, specificatie, dimensiune, grad_otel, standard, izolatie, diametru_mm, perete_mm, greutate_kg, lungime_doc_mm, lungime_masurata_mm, cod, item, unghi_doc, unghi_masurat, cantitate, pachet_nr, dimensiuni_cm, net_kg, brut_kg, decizie, motiv, observatie)
    SELECT d.id, (x ->> 'nr_crt')::integer, x ->> 'serie', x ->> 'sarja', x ->> 'lot', x ->> 'specificatie', x ->> 'dimensiune', x ->> 'grad_otel', x ->> 'standard', x ->> 'izolatie', (x ->> 'diametru_mm')::integer, (x ->> 'perete_mm')::numeric, (x ->> 'greutate_kg')::numeric, (x ->> 'lungime_doc_mm')::integer, (x ->> 'lungime_masurata_mm')::integer, x ->> 'cod', x ->> 'item', (x ->> 'unghi_doc')::numeric, (x ->> 'unghi_masurat')::numeric, (x ->> 'cantitate')::integer, x ->> 'pachet_nr', x ->> 'dimensiuni_cm', (x ->> 'net_kg')::numeric, (x ->> 'brut_kg')::numeric, coalesce(x ->> 'decizie', 'primit'), x ->> 'motiv', x ->> 'observatie' FROM jsonb_array_elements(p_randuri) x;
    IF p_scanuri IS NOT NULL THEN
      DELETE FROM public.izo_documente_scanuri WHERE document_id = d.id;
      INSERT INTO public.izo_documente_scanuri (document_id, cale, sha256_original, sha256_pdf, marime, mime)
      SELECT d.id, x ->> 'cale', x ->> 'sha256_original', x ->> 'sha256_pdf', (x ->> 'marime')::bigint, x ->> 'mime' FROM jsonb_array_elements(p_scanuri) x;
      IF EXISTS (SELECT 1 FROM public.izo_documente_scanuri s WHERE s.document_id = d.id AND NOT public.fn_izo_scan_exista(s.cale)) THEN
        RAISE EXCEPTION 'izo E3: un scan din manifest nu există în Storage (încarcă-l întâi)' USING ERRCODE = '23514';
      END IF;
    END IF;
    INSERT INTO public.izo_documente_istoric(document_id,versiune,salvat_de,salvat_rol,continut,hash,diff,baza)
    SELECT d.id,d.versiune,v_uid,session_user,public.fn_izo_doc_instantaneu(d.id),public.fn_izo_doc_hash(d.id),
      public.fn_izo_doc_diff((SELECT ist.continut FROM public.izo_documente_istoric ist WHERE ist.document_id=d.id ORDER BY ist.versiune DESC LIMIT 1),public.fn_izo_doc_instantaneu(d.id)),
      NOT EXISTS(SELECT 1 FROM public.izo_documente_istoric ist WHERE ist.document_id=d.id);
    RETURN jsonb_build_object('istoric_versiune', d.versiune, 'document_id', d.id, 'versiune', d.versiune, 'hash', public.fn_izo_doc_hash(d.id));
  END $f$;
  RESET ROLE;
  REVOKE CREATE ON SCHEMA public FROM izo_doc_editor;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_doc_hash(bigint)'::regprocedure) IS DISTINCT FROM '9a63b53de19b7205e62508fea86c1517' OR position('jsonb_build_object(
      ''v'', ''e3-doc-v1'',
      ''antet'', jsonb_build_object(''proiect_id'', d.proiect_id, ''depozit_id'', d.depozit_id, ''sablon'', d.sablon,
        ''furnizor'', d.furnizor, ''furnizor_canon'', d.furnizor_canon, ''furnizor_cif'', d.furnizor_cif, ''nr_document'', d.nr_document,
        ''nr_document_canon'', d.nr_document_canon, ''data_document'', d.data_document, ''inlocuieste_document_id'', d.inlocuieste_document_id,
        ''motiv_inlocuire'', d.motiv_inlocuire, ''observatii'', d.observatii),
      ''aviz'', jsonb_build_object(''cumparator'', d.cumparator, ''transport_nr'', d.transport_nr, ''nume_proiect'', d.nume_proiect, ''lot'', d.lot,
        ''loc_livrare'', d.loc_livrare, ''data_incarcare'', d.data_incarcare, ''data_descarcare'', d.data_descarcare, ''nr_camion'', d.nr_camion),
      ''lista'', jsonb_build_object(''factura'', d.factura, ''importator'', d.importator, ''destinatar'', d.destinatar,
        ''referinta_client'', d.referinta_client, ''referinta_furnizor'', d.referinta_furnizor, ''placa_camion_container'', d.placa_camion_container),
      ''totaluri'', jsonb_build_object(''total_m'', round(d.total_m, 3)::text, ''total_kg'', round(d.total_kg, 1)::text, ''total_bucati'', d.total_bucati,
        ''total_pachete'', d.total_pachete, ''total_net_kg'', round(d.total_net_kg, 1)::text, ''total_brut_kg'', round(d.total_brut_kg, 1)::text),
      ''randuri'', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          ''nr_crt'', r.nr_crt, ''serie'', r.serie, ''sarja'', r.sarja, ''lot'', r.lot, ''specificatie'', r.specificatie, ''dimensiune'', r.dimensiune,
          ''grad_otel'', r.grad_otel, ''standard'', r.standard, ''izolatie'', r.izolatie, ''diametru_mm'', r.diametru_mm,
          ''perete_mm'', round(r.perete_mm, 1)::text, ''greutate_kg'', round(r.greutate_kg, 1)::text,
          ''lungime_doc_mm'', r.lungime_doc_mm, ''lungime_masurata_mm'', r.lungime_masurata_mm, ''cod'', r.cod, ''item'', r.item,
          ''unghi_doc'', round(r.unghi_doc, 1)::text, ''unghi_masurat'', round(r.unghi_masurat, 1)::text, ''cantitate'', r.cantitate,
          ''pachet_nr'', r.pachet_nr, ''dimensiuni_cm'', r.dimensiuni_cm, ''net_kg'', round(r.net_kg, 1)::text, ''brut_kg'', round(r.brut_kg, 1)::text,
          ''decizie'', r.decizie, ''motiv'', r.motiv, ''observatie'', r.observatie) ORDER BY r.nr_crt), ''[]''::jsonb)
        FROM public.izo_documente_intrare_randuri r WHERE r.document_id = d.id),
      ''scanuri'', (SELECT coalesce(jsonb_agg(jsonb_build_object(''cale'', s.cale, ''sha256_original'', s.sha256_original,
          ''sha256_pdf'', s.sha256_pdf, ''marime'', s.marime, ''mime'', s.mime) ORDER BY s.cale), ''[]''::jsonb)
        FROM public.izo_documente_scanuri s WHERE s.document_id = d.id)
    )' IN (SELECT prosrc FROM pg_proc WHERE oid='public.fn_izo_doc_instantaneu(bigint)'::regprocedure))=0 THEN RAISE EXCEPTION 'E3b: hash LIVE / instantaneu canonic diferit'; END IF;
  CREATE OR REPLACE FUNCTION public.fn_izo_garda_bucati() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE
    v_old boolean := false;
    v_new boolean := false;
    v_p bigint;
    v_aut boolean;
  BEGIN
    -- E3 (20261103b): predicatul de autorizare, calculat o singură dată — scriitorul E2a cu marcaj SAU scriitorul E3 în
    -- contextul operației (true sau excepție); fără RETURN timpuriu: verificările E2a de mai jos se aplică tuturor
    v_aut := public.fn_izo_garda_scriitor();
    IF v_aut IS NOT TRUE AND current_user = 'izo_receptie_writer' THEN
      v_aut := public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
                                            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
    END IF;
    IF v_aut IS NOT TRUE AND current_user = 'izo_corectie_writer' THEN
      v_aut := public.fn_izo_garda_corectie(TG_TABLE_NAME, TG_OP,
        CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
    END IF;
    -- (1) rândurile registrului sunt protejate PERMANENT: refuz imediat, fără lock (altfel un UPDATE al clientului, care
    --     ține deja rândul, ar aștepta lock-ul advisory al unui storno care așteaptă rândul → blocaj circular)
    IF ((TG_OP <> 'INSERT' AND OLD.tip_cod IS NOT NULL) OR (TG_OP <> 'DELETE' AND NEW.tip_cod IS NOT NULL))
       AND v_aut IS NOT TRUE THEN
      RAISE EXCEPTION 'izo: bucățile beneficiar ale unui proiect cu registru (nivel ≠ off) se scriu doar prin funcțiile registrului'
        USING ERRCODE = '42501';
    END IF;
    -- (2) beneficiar în afara registrului: lock PARTAJAT pe proiectele OLD/NEW (crescător; cere READ COMMITTED — sub
    --     REPEATABLE READ o activare comisă între timp n-ar fi văzută), apoi nivelul, citit cu snapshot nou
    IF (TG_OP <> 'INSERT' AND OLD.provenienta = 'beneficiar') OR (TG_OP <> 'DELETE' AND NEW.provenienta = 'beneficiar') THEN
      IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'izo: scrierile care ating registrul cer READ COMMITTED (acum %)', current_setting('transaction_isolation')
          USING ERRCODE = '25001';
      END IF;
      FOR v_p IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP <> 'INSERT' AND OLD.provenienta = 'beneficiar' THEN OLD.proiect_id END,
                                                       CASE WHEN TG_OP <> 'DELETE' AND NEW.provenienta = 'beneficiar' THEN NEW.proiect_id END]) x
                  WHERE x IS NOT NULL ORDER BY 1 LOOP
        PERFORM pg_advisory_xact_lock_shared(73010, v_p::integer);
      END LOOP;
    END IF;
    IF TG_OP <> 'INSERT' AND (OLD.tip_cod IS NOT NULL OR OLD.provenienta = 'beneficiar') THEN
      v_old := OLD.tip_cod IS NOT NULL OR public.fn_izo_nivel(OLD.proiect_id) <> 'off';
    END IF;
    IF TG_OP <> 'DELETE' AND (NEW.tip_cod IS NOT NULL OR NEW.provenienta = 'beneficiar') THEN
      v_new := NEW.tip_cod IS NOT NULL OR public.fn_izo_nivel(NEW.proiect_id) <> 'off';
    END IF;
    IF v_old OR v_new THEN
      IF v_aut IS NOT TRUE THEN
        RAISE EXCEPTION 'izo: bucățile beneficiar ale unui proiect cu registru (nivel ≠ off) se scriu doar prin funcțiile registrului'
          USING ERRCODE = '42501';
      END IF;
      IF TG_OP <> 'DELETE' AND NEW.stare IN ('rezervata','consumata') THEN
        RAISE EXCEPTION 'izo: starea % e interzisă pe bucățile registrului (rezervările stau în izo_rezervari; consumul = montata/taiata)', NEW.stare
          USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'izo: bucățile registrului nu se șterg (anulare = storno)' USING ERRCODE = '42501';
      END IF;
      -- un rând de registru nu stă niciodată pe un proiect off (nici scris de writer) — review #806 A
      IF TG_OP <> 'DELETE' AND NEW.tip_cod IS NOT NULL AND public.fn_izo_nivel(NEW.proiect_id) = 'off' THEN
        RAISE EXCEPTION 'izo: rândurile registrului cer proiect cu nivel ≠ off (proiectul %)', NEW.proiect_id USING ERRCODE = '42501';
      END IF;
    END IF;
    -- tip_cod e copie controlată de server: trebuie să bată cu tip_material_id
    IF TG_OP <> 'DELETE' AND NEW.tip_cod IS NOT NULL AND NEW.tip_cod IS DISTINCT FROM public.fn_izo_tip_cod(NEW.tip_material_id) THEN
      RAISE EXCEPTION 'izo: tip_cod % nu bate cu tip_material_id %', NEW.tip_cod, NEW.tip_material_id USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $f$;
  CREATE OR REPLACE FUNCTION public.fn_izo_garda_fapte() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_aut boolean;
  BEGIN
    IF TG_OP = 'TRUNCATE' THEN
      RAISE EXCEPTION 'izo: TRUNCATE pe % e refuzat (registru doar-adaug)', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'izo: DELETE pe % e refuzat (registru doar-adaug; anulare = storno)', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('magazie_bucati_evenimente','magazie_bucati_miscari') THEN
      RAISE EXCEPTION 'izo: UPDATE pe % e refuzat (registru doar-adaug)', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    -- E3 (20261103b): predicatul de autorizare, calculat o singură dată — scriitorul E2a cu marcaj SAU scriitorul E3 în
    -- contextul operației (true sau excepție); fără RETURN timpuriu: verificările E2a de mai jos se aplică tuturor
    v_aut := public.fn_izo_garda_scriitor();
    IF v_aut IS NOT TRUE AND current_user = 'izo_receptie_writer' THEN
      v_aut := public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
                                            to_jsonb(NEW));
    END IF;
    IF v_aut IS NOT TRUE AND current_user = 'izo_corectie_writer' THEN
      v_aut := public.fn_izo_garda_corectie(TG_TABLE_NAME, TG_OP,
        CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
    END IF;
    IF v_aut IS NOT TRUE THEN
      RAISE EXCEPTION 'izo: % se scrie doar prin funcțiile registrului', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $f$;
  CREATE OR REPLACE FUNCTION public.fn_izo_doc_garda() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_doc public.izo_documente_intrare; v_doc_id bigint;
    c_neschimbate constant text[] := ARRAY['id', 'proiect_id', 'depozit_id', 'sablon', 'inlocuieste_document_id', 'motiv_inlocuire', 'creat_de', 'creat_la'];
    c_confirmare constant text[] := ARRAY['stare', 'hash_confirmat', 'avertismente', 'confirmat_de', 'confirmat_la', 'eveniment_intrare_id',
      'pv_nr', 'pv_nr_canon', 'pv_data', 'pv_pus_de', 'pv_pus_la', 'eveniment_pv_id', 'anulat_de', 'anulat_de_rol', 'anulat_la', 'anulat_motiv',
      'eveniment_storno_intrare_id', 'eveniment_storno_pv_id'];
    c_anulare constant text[] := ARRAY['stare', 'versiune', 'updated_at', 'anulat_de', 'anulat_de_rol', 'anulat_la', 'anulat_motiv'];
    c_gen_doc constant text[] := ARRAY['furnizor_canon', 'nr_document_canon'];
  BEGIN
    IF TG_OP = 'TRUNCATE' THEN
      RAISE EXCEPTION 'izo E3: TRUNCATE pe % e refuzat' , TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    v_doc_id := CASE WHEN TG_TABLE_NAME = 'izo_documente_intrare' THEN coalesce(NEW.id, OLD.id)
                     ELSE coalesce((to_jsonb(NEW) ->> 'document_id')::bigint, (to_jsonb(OLD) ->> 'document_id')::bigint) END;
    -- scriitorul registrului: doar ce acceptă garda E3, în contextul operației
    IF current_user = 'izo_receptie_writer' THEN
      PERFORM public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    -- editorul draftului: doar pe documente draft, versiunea +1, coloanele confirmării / PV / anulării neatinse
    IF current_user = 'izo_doc_editor' THEN
      IF TG_TABLE_NAME = 'izo_documente_intrare' THEN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'izo E3: antetul unui document nu se șterge (un draft abandonat se anulează)' USING ERRCODE = '42501';
        ELSIF TG_OP = 'INSERT' THEN
          IF NEW.stare <> 'draft' OR NEW.versiune <> 1 OR NEW.creat_de IS DISTINCT FROM public.fn_izo_uid()
             OR (public.fn_izo_proiectie(to_jsonb(NEW), array_remove(c_confirmare, 'stare')) <> public.fn_izo_proiectie('{}'::jsonb, array_remove(c_confirmare, 'stare'))) THEN
            RAISE EXCEPTION 'izo E3: un document nou e draft, versiunea 1, fără confirmare / PV / anulare' USING ERRCODE = '42501';
          END IF;
        ELSIF OLD.stare = 'draft' AND NEW.stare = 'anulat' THEN
          -- r5d §13.3: gestionarul își anulează ciorna — DOAR antetul, DOAR coloanele anulării, autorul = utilizatorul curent
          IF NEW.versiune <> OLD.versiune + 1 OR NEW.anulat_de IS DISTINCT FROM public.fn_izo_uid() OR NEW.anulat_de IS NULL
             OR NEW.anulat_de_rol IS DISTINCT FROM session_user::text OR NEW.anulat_la IS NULL OR NEW.anulat_motiv IS NULL
             OR (to_jsonb(NEW) - c_anulare - c_gen_doc) IS DISTINCT FROM (to_jsonb(OLD) - c_anulare - c_gen_doc) THEN
            RAISE EXCEPTION 'izo E3: anularea ciornei schimbă doar starea, versiunea (+1) și coloanele anulării, cu autorul curent' USING ERRCODE = '42501';
          END IF;
        ELSE
          IF OLD.stare <> 'draft' OR NEW.stare <> 'draft' OR NEW.versiune <> OLD.versiune + 1
             OR public.fn_izo_proiectie(to_jsonb(NEW), c_neschimbate || c_confirmare) IS DISTINCT FROM public.fn_izo_proiectie(to_jsonb(OLD), c_neschimbate || c_confirmare) THEN
            RAISE EXCEPTION 'izo E3: draftul se editează doar cu versiunea +1, fără a schimba proiectul / depozitul / șablonul / înlocuirea / confirmarea'
              USING ERRCODE = '42501';
          END IF;
        END IF;
      ELSE
        SELECT * INTO v_doc FROM public.izo_documente_intrare WHERE id = v_doc_id;
        IF NOT FOUND OR v_doc.stare <> 'draft' OR TG_OP = 'UPDATE'
           OR (TG_TABLE_NAME = 'izo_documente_intrare_randuri' AND TG_OP = 'INSERT' AND (to_jsonb(NEW) ->> 'bucata_id') IS NOT NULL) THEN
          RAISE EXCEPTION 'izo E3: rândurile / scanurile se schimbă doar pe un draft (înlocuire, fără UPDATE)' USING ERRCODE = '42501';
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    IF current_user = 'izo_corectie_writer' THEN
      PERFORM public.fn_izo_garda_corectie(TG_TABLE_NAME, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'izo E3: documentele de intrare se scriu doar prin funcțiile E3 (rolul curent %)', current_user USING ERRCODE = '42501';
  END $f$;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_chei(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_chei(text, text, text) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_autorizare_lock(bigint, text, integer) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_autorizare_lock(bigint, text, integer) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_cerut_de_valid(bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_cerut_de_valid(bigint, uuid) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_bucata_lock(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_bucata_lock(bigint, bigint) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_doc_lock(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_doc_lock(bigint, bigint) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_deschise(bigint[]) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_deschise(bigint[]) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_api_verifica() FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_api_verifica() OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_adm_verifica() FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_adm_verifica() OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_marcheaza(bigint) FROM PUBLIC, anon, authenticated, service_role;
  GRANT CREATE ON SCHEMA public TO izo_corectie_writer;
  ALTER FUNCTION public.fn_izo_cor_marcheaza(bigint) OWNER TO izo_corectie_writer;
  REVOKE CREATE ON SCHEMA public FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_loc(public.magazie_bucati) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_loc(public.magazie_bucati) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_tinta_iesire(public.magazie_bucati) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_tinta_iesire(public.magazie_bucati) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_valori(public.magazie_bucati) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_valori(public.magazie_bucati) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_valideaza(public.izo_corectii) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_valideaza(public.izo_corectii) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_inainte(public.izo_corectii) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_inainte(public.izo_corectii) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_eveniment_asteptat(public.izo_corectii) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_eveniment_asteptat(public.izo_corectii) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_bucata_noua(public.izo_corectii) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_bucata_noua(public.izo_corectii) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_garda_corectie(text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_garda_corectie(text, text, jsonb, jsonb) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_garda() FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_cor_garda() OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_lant_blocant(bigint[], bigint[]) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_lant_blocant(bigint[], bigint[]) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_instantaneu(bigint) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_doc_instantaneu(bigint) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_diff(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_doc_diff(jsonb, jsonb) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_ist_garda() FROM PUBLIC, anon, authenticated, service_role;
  ALTER FUNCTION public.fn_izo_doc_ist_garda() OWNER TO postgres;
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
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_chei(text, text, text) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_autorizare_lock(bigint, text, integer) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_cerut_de_valid(bigint, uuid) TO izo_corectie_writer, izo_receptie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_bucata_lock(bigint, bigint) TO izo_cor_editor;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_doc_lock(bigint, bigint) TO izo_cor_editor;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_deschise(bigint[]) TO izo_registru_writer, izo_receptie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_api_verifica() TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_adm_verifica() TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_loc(public.magazie_bucati) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_tinta_iesire(public.magazie_bucati) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_valori(public.magazie_bucati) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_valideaza(public.izo_corectii) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_inainte(public.izo_corectii) TO izo_cor_editor, izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_eveniment_asteptat(public.izo_corectii) TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati) TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_bucata_noua(public.izo_corectii) TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati) TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_garda_corectie(text, text, jsonb, jsonb) TO izo_corectie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_lant_blocant(bigint[], bigint[]) TO izo_corectie_writer, izo_registru_writer, izo_receptie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_instantaneu(bigint) TO izo_doc_editor;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_diff(jsonb, jsonb) TO izo_doc_editor;
  GRANT USAGE ON SEQUENCE public.magazie_bucati_id_seq, public.izo_server_ver_seq, public.magazie_bucati_evenimente_id_seq, public.magazie_bucati_miscari_id_seq TO izo_corectie_writer;
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

  -- Inventarul catalogului. Corpuri/config/ACL fn_izo_* sunt și în porti=.
  CREATE FUNCTION public.fn_izo_porti_e3b_definitii() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT md5(concat_ws(' | ',
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s',pr.oid::regprocedure,pg_get_userbyid(pr.proowner),pr.prosecdef,
        pr.provolatile,pr.proconfig,pr.proacl,md5(pr.prosrc)),',' ORDER BY pr.oid::regprocedure::text)
        FROM pg_proc pr WHERE pr.pronamespace='public'::regnamespace AND pr.proname=ANY(ARRAY['fn_izo_cor_chei', 'fn_izo_cor_autorizare_lock', 'fn_izo_cor_cerut_de_valid', 'fn_izo_cor_bucata_lock', 'fn_izo_cor_doc_lock', 'fn_izo_cor_deschise', 'fn_izo_cor_api_verifica', 'fn_izo_cor_adm_verifica', 'fn_izo_cor_marcheaza', 'fn_izo_cor_loc', 'fn_izo_cor_tinta_iesire', 'fn_izo_cor_valori', 'fn_izo_cor_valideaza', 'fn_izo_cor_inainte', 'fn_izo_cor_eveniment_asteptat', 'fn_izo_cor_bucata_dupa', 'fn_izo_cor_bucata_noua', 'fn_izo_cor_miscare_asteptata', 'fn_izo_garda_corectie', 'fn_izo_cor_garda', 'fn_izo_lant_blocant', 'fn_izo_doc_instantaneu', 'fn_izo_doc_diff', 'fn_izo_doc_ist_garda', 'fn_izo_cor_propune', 'fn_izo_cor_retrage', 'fn_izo_cor_respinge', 'fn_izo_cor_verifica', 'fn_izo_cor_aproba', 'fn_izo_cor_camp', 'fn_izo_cor_pv', 'fn_izo_cor_storno_import', 'fn_izo_doc_salveaza', 'fn_izo_doc_anuleaza', 'fn_izo_garda_receptie']::text[])),
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
        'public.izo_corectii_bucati'::regclass,'public.izo_documente_istoric'::regclass)) <> 6 THEN
      v := array_append(v,'număr trigger-e E3b diferit de sase (A+B+D1)');
    END IF;
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
    IF has_function_privilege('anon', 'public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_retrage(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_retrage(bigint, bigint, text)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_retrage(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_retrage(bigint, bigint, text)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_retrage(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_retrage(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_retrage(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_retrage(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_retrage(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_retrage(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_retrage(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_retrage(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_retrage(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_retrage(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_retrage(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_retrage(bigint, bigint, text)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_respinge(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_respinge(bigint, bigint, text)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_respinge(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_respinge(bigint, bigint, text)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_respinge(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_respinge(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_respinge(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_respinge(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_respinge(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_respinge(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_respinge(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_respinge(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_respinge(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_respinge(bigint, bigint, text)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_respinge(bigint, bigint, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_respinge(bigint, bigint, text)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_aproba(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_aproba(bigint, bigint)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_aproba(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_aproba(bigint, bigint)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_aproba(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_aproba(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_aproba(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_aproba(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_aproba(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_aproba(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_aproba(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_aproba(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_aproba(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_aproba(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_aproba(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_aproba(bigint, bigint)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_camp(bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_camp(bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_camp(bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_camp(bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_camp(bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_camp(bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_camp(bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_camp(bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_camp(bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_camp(bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_camp(bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_camp(bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_camp(bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_camp(bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_camp(bigint, bigint, jsonb, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_camp(bigint, bigint, jsonb, text)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_pv(bigint, bigint, text, date, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_pv(bigint, bigint, text, date, text)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_pv(bigint, bigint, text, date, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_pv(bigint, bigint, text, date, text)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_pv(bigint, bigint, text, date, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_pv(bigint, bigint, text, date, text)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_pv(bigint, bigint, text, date, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_pv(bigint, bigint, text, date, text)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_pv(bigint, bigint, text, date, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_pv(bigint, bigint, text, date, text)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_pv(bigint, bigint, text, date, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_pv(bigint, bigint, text, date, text)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_pv(bigint, bigint, text, date, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_pv(bigint, bigint, text, date, text)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_pv(bigint, bigint, text, date, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_pv(bigint, bigint, text, date, text)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_chei(text, text, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_chei(text, text, text)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_chei(text, text, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_chei(text, text, text)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_chei(text, text, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_chei(text, text, text)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_chei(text, text, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_chei(text, text, text)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_chei(text, text, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_chei(text, text, text)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_chei(text, text, text)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_chei(text, text, text)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_chei(text, text, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_chei(text, text, text)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_chei(text, text, text)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_chei(text, text, text)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_autorizare_lock(bigint, text, integer)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_autorizare_lock(bigint, text, integer)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_autorizare_lock(bigint, text, integer)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_autorizare_lock(bigint, text, integer)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_autorizare_lock(bigint, text, integer)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_autorizare_lock(bigint, text, integer)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_autorizare_lock(bigint, text, integer)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_autorizare_lock(bigint, text, integer)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_autorizare_lock(bigint, text, integer)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_autorizare_lock(bigint, text, integer)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_autorizare_lock(bigint, text, integer)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_autorizare_lock(bigint, text, integer)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_autorizare_lock(bigint, text, integer)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_autorizare_lock(bigint, text, integer)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_autorizare_lock(bigint, text, integer)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_autorizare_lock(bigint, text, integer)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_cerut_de_valid(bigint, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_cerut_de_valid(bigint, uuid)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_cerut_de_valid(bigint, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_cerut_de_valid(bigint, uuid)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_cerut_de_valid(bigint, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_cerut_de_valid(bigint, uuid)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_cerut_de_valid(bigint, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_cerut_de_valid(bigint, uuid)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_cerut_de_valid(bigint, uuid)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_cerut_de_valid(bigint, uuid)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_cerut_de_valid(bigint, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_cerut_de_valid(bigint, uuid)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_cerut_de_valid(bigint, uuid)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_cerut_de_valid(bigint, uuid)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_cerut_de_valid(bigint, uuid)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_cerut_de_valid(bigint, uuid)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_bucata_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_bucata_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_bucata_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_bucata_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_bucata_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_bucata_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_bucata_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_bucata_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_bucata_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_bucata_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_bucata_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_bucata_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_bucata_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_bucata_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_bucata_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_bucata_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_doc_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_doc_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_doc_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_doc_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_doc_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_doc_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_doc_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_doc_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_doc_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_doc_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_doc_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_doc_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_doc_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_doc_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_doc_lock(bigint, bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_doc_lock(bigint, bigint)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_deschise(bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_deschise(bigint[])'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_deschise(bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_deschise(bigint[])'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_deschise(bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_deschise(bigint[])'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_deschise(bigint[])', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_deschise(bigint[])'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_deschise(bigint[])', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_deschise(bigint[])'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_deschise(bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_deschise(bigint[])'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_deschise(bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_deschise(bigint[])'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_deschise(bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_deschise(bigint[])'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_api_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_api_verifica()'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_api_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_api_verifica()'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_api_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_api_verifica()'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_api_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_api_verifica()'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_api_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_api_verifica()'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_api_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_api_verifica()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_api_verifica()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_api_verifica()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_api_verifica()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_api_verifica()'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_adm_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_adm_verifica()'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_adm_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_adm_verifica()'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_adm_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_adm_verifica()'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_adm_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_adm_verifica()'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_adm_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_adm_verifica()'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_adm_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_adm_verifica()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_adm_verifica()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_adm_verifica()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_adm_verifica()', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_adm_verifica()'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_marcheaza(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_marcheaza(bigint)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_marcheaza(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_marcheaza(bigint)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_marcheaza(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_marcheaza(bigint)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_marcheaza(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_marcheaza(bigint)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_marcheaza(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_marcheaza(bigint)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_marcheaza(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_marcheaza(bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_marcheaza(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_marcheaza(bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_marcheaza(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_marcheaza(bigint)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_loc(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_loc(public.magazie_bucati)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_loc(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_loc(public.magazie_bucati)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_loc(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_loc(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_loc(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_loc(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_loc(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_loc(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_loc(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_loc(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_loc(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_loc(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_loc(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_loc(public.magazie_bucati)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_tinta_iesire(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_tinta_iesire(public.magazie_bucati)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_tinta_iesire(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_tinta_iesire(public.magazie_bucati)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_tinta_iesire(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_tinta_iesire(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_tinta_iesire(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_tinta_iesire(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_tinta_iesire(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_tinta_iesire(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_tinta_iesire(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_tinta_iesire(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_tinta_iesire(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_tinta_iesire(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_tinta_iesire(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_tinta_iesire(public.magazie_bucati)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_valori(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_valori(public.magazie_bucati)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_valori(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_valori(public.magazie_bucati)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_valori(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_valori(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_valori(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_valori(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_valori(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_valori(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_valori(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_valori(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_valori(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_valori(public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_valori(public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_valori(public.magazie_bucati)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_valideaza(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_valideaza(public.izo_corectii)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_valideaza(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_valideaza(public.izo_corectii)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_valideaza(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_valideaza(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_valideaza(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_valideaza(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_valideaza(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_valideaza(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_valideaza(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_valideaza(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_valideaza(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_valideaza(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_valideaza(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_valideaza(public.izo_corectii)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_inainte(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_inainte(public.izo_corectii)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_inainte(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_inainte(public.izo_corectii)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_inainte(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_inainte(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_inainte(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_inainte(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_inainte(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_inainte(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_inainte(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_inainte(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_inainte(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_inainte(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_inainte(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_inainte(public.izo_corectii)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_bucata_noua(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_bucata_noua(public.izo_corectii)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_bucata_noua(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_bucata_noua(public.izo_corectii)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_bucata_noua(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_bucata_noua(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_bucata_noua(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_bucata_noua(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_bucata_noua(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_bucata_noua(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_bucata_noua(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_bucata_noua(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_bucata_noua(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_bucata_noua(public.izo_corectii)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_bucata_noua(public.izo_corectii)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_bucata_noua(public.izo_corectii)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_garda_corectie(text, text, jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_garda_corectie(text, text, jsonb, jsonb)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_garda_corectie(text, text, jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_garda_corectie(text, text, jsonb, jsonb)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_garda_corectie(text, text, jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_garda_corectie(text, text, jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_garda_corectie(text, text, jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_garda_corectie(text, text, jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_garda_corectie(text, text, jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_garda_corectie(text, text, jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_garda_corectie(text, text, jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_garda_corectie(text, text, jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_garda_corectie(text, text, jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_garda_corectie(text, text, jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_garda_corectie(text, text, jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_garda_corectie(text, text, jsonb, jsonb)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_cor_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_cor_garda()'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_cor_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_cor_garda()'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_cor_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_cor_garda()'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_cor_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_cor_garda()'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_cor_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_cor_garda()'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_cor_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_cor_garda()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_cor_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_cor_garda()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_cor_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_cor_garda()'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_lant_blocant(bigint[], bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_lant_blocant(bigint[], bigint[])'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_lant_blocant(bigint[], bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_lant_blocant(bigint[], bigint[])'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_lant_blocant(bigint[], bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_lant_blocant(bigint[], bigint[])'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_lant_blocant(bigint[], bigint[])', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_lant_blocant(bigint[], bigint[])'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_lant_blocant(bigint[], bigint[])', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_lant_blocant(bigint[], bigint[])'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_lant_blocant(bigint[], bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_lant_blocant(bigint[], bigint[])'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_lant_blocant(bigint[], bigint[])', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_lant_blocant(bigint[], bigint[])'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_lant_blocant(bigint[], bigint[])', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_lant_blocant(bigint[], bigint[])'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_doc_instantaneu(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_doc_instantaneu(bigint)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_doc_instantaneu(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_doc_instantaneu(bigint)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_doc_instantaneu(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_doc_instantaneu(bigint)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_doc_instantaneu(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_doc_instantaneu(bigint)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_doc_instantaneu(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_doc_instantaneu(bigint)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_doc_instantaneu(bigint)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_doc_instantaneu(bigint)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_doc_instantaneu(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_doc_instantaneu(bigint)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_doc_instantaneu(bigint)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_doc_instantaneu(bigint)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_doc_diff(jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_doc_diff(jsonb, jsonb)'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_doc_diff(jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_doc_diff(jsonb, jsonb)'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_doc_diff(jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_doc_diff(jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_doc_diff(jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_doc_diff(jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_doc_diff(jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_doc_diff(jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_doc_diff(jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_doc_diff(jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_doc_diff(jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_doc_diff(jsonb, jsonb)'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_doc_diff(jsonb, jsonb)', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_doc_diff(jsonb, jsonb)'); END IF;
    IF has_function_privilege('anon', 'public.fn_izo_doc_ist_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE anon public.fn_izo_doc_ist_garda()'); END IF;
    IF has_function_privilege('authenticated', 'public.fn_izo_doc_ist_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE authenticated public.fn_izo_doc_ist_garda()'); END IF;
    IF has_function_privilege('service_role', 'public.fn_izo_doc_ist_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE service_role public.fn_izo_doc_ist_garda()'); END IF;
    IF has_function_privilege('izo_registru_writer', 'public.fn_izo_doc_ist_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_registru_writer public.fn_izo_doc_ist_garda()'); END IF;
    IF has_function_privilege('izo_receptie_writer', 'public.fn_izo_doc_ist_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_receptie_writer public.fn_izo_doc_ist_garda()'); END IF;
    IF has_function_privilege('izo_doc_editor', 'public.fn_izo_doc_ist_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_doc_editor public.fn_izo_doc_ist_garda()'); END IF;
    IF has_function_privilege('izo_cor_editor', 'public.fn_izo_doc_ist_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_cor_editor public.fn_izo_doc_ist_garda()'); END IF;
    IF has_function_privilege('izo_corectie_writer', 'public.fn_izo_doc_ist_garda()', 'EXECUTE') IS DISTINCT FROM false THEN v := array_append(v, 'EXECUTE izo_corectie_writer public.fn_izo_doc_ist_garda()'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_chei') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_chei(text, text, text)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_chei'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_autorizare_lock') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_autorizare_lock(bigint, text, integer)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=true AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_autorizare_lock'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_cerut_de_valid') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_cerut_de_valid(bigint, uuid)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=true AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_cerut_de_valid'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_bucata_lock') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_bucata_lock(bigint, bigint)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=true AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_bucata_lock'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_doc_lock') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_doc_lock(bigint, bigint)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=true AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_doc_lock'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_deschise') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_deschise(bigint[])'::regprocedure AND proowner='postgres'::regrole AND prosecdef=true AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_deschise'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_api_verifica') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_api_verifica()'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_api_verifica'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_adm_verifica') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_adm_verifica()'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_adm_verifica'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_marcheaza') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_marcheaza(bigint)'::regprocedure AND proowner='izo_corectie_writer'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_marcheaza'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_loc') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_loc(public.magazie_bucati)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_loc'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_tinta_iesire') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_tinta_iesire(public.magazie_bucati)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_tinta_iesire'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_valori') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_valori(public.magazie_bucati)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_valori'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_valideaza') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_valideaza(public.izo_corectii)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_valideaza'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_inainte') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_inainte(public.izo_corectii)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_inainte'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_eveniment_asteptat') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_eveniment_asteptat(public.izo_corectii)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_eveniment_asteptat'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_bucata_dupa') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_bucata_dupa'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_bucata_noua') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_bucata_noua(public.izo_corectii)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_bucata_noua'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_miscare_asteptata') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_miscare_asteptata'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_garda_corectie') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_garda_corectie(text, text, jsonb, jsonb)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_garda_corectie'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_cor_garda') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_garda()'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_garda'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_lant_blocant') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_lant_blocant(bigint[], bigint[])'::regprocedure AND proowner='postgres'::regrole AND prosecdef=true AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_lant_blocant'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_doc_instantaneu') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_doc_instantaneu(bigint)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_doc_instantaneu'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_doc_diff') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_doc_diff(jsonb, jsonb)'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_doc_diff'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_doc_ist_garda') <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_doc_ist_garda()'::regprocedure AND proowner='postgres'::regrole AND prosecdef=false AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_doc_ist_garda'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'::regprocedure AND proowner='izo_cor_editor'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_propune(text, bigint, bigint, jsonb, text)'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_retrage(bigint, bigint, text)'::regprocedure AND proowner='izo_cor_editor'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_retrage(bigint, bigint, text)'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_respinge(bigint, bigint, text)'::regprocedure AND proowner='izo_cor_editor'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_respinge(bigint, bigint, text)'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'::regprocedure AND proowner='izo_cor_editor'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_aproba(bigint, bigint)'::regprocedure AND proowner='izo_corectie_writer'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_aproba(bigint, bigint)'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_camp(bigint, bigint, jsonb, text)'::regprocedure AND proowner='izo_corectie_writer'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_camp(bigint, bigint, jsonb, text)'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_pv(bigint, bigint, text, date, text)'::regprocedure AND proowner='izo_corectie_writer'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_pv(bigint, bigint, text, date, text)'); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'::regprocedure AND proowner='izo_corectie_writer'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,'définition fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)'); END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fn_izo_doc_anuleaza') <> 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.fn_izo_doc_anuleaza(bigint, text, uuid)'::regprocedure
        AND proowner='izo_receptie_writer'::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']
        AND proacl::text='{izo_receptie_writer=X/izo_receptie_writer,postgres=X/izo_receptie_writer}') THEN
      v := array_append(v,'definition / ACL anulare administrativa D2'); END IF;
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
  v_impl_rev := ARRAY['policy|izo_atr_sel on public.izo_atribuiri|public.fn_izo_citire(bigint)', 'policy|izo_cfg_sel on public.izo_proiect_config|public.fn_izo_citire(bigint)', 'policy|izo_corectii_api_sel on public.izo_corectii|public.fn_izo_citire(bigint)', 'policy|izo_corectii_bucati_api_sel on public.izo_corectii_bucati|public.fn_izo_citire(bigint)', 'policy|izo_doc_api_sel on public.izo_documente_intrare|public.fn_izo_citire(bigint)', 'policy|izo_doc_scan_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_r_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_doc_scan_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_documente_istoric_api_sel on public.izo_documente_istoric|public.fn_izo_citire(bigint)', 'policy|izo_ev_corectie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_receptie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_sel on public.magazie_bucati_evenimente|public.fn_izo_citire(bigint)', 'policy|izo_ev_writer_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_imp_sel on public.izo_importuri|public.fn_izo_citire(bigint)', 'policy|izo_mis_corectie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_receptie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_sel on public.magazie_bucati_miscari|public.fn_izo_citire(bigint)', 'policy|izo_mis_writer_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_del on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_sel on public.magazie_bucati|public.fn_izo_citire(bigint)', 'policy|magbuc_izo_client_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'trigger|trg_bon_linii_izo_bucata on public.executie_bonuri_consum_linii|public.fn_izo_refuz_bon_bucata()', 'trigger|trg_depozite_izo_mutare on public.logistica_depozite|public.fn_izo_refuz_mutare_depozit()', 'trigger|trg_executie_tevi_izo_delete on public.executie_tevi|public.fn_izo_refuz_delete_tevi()', 'trigger|trg_executie_tevi_izo_mutare on public.executie_tevi|public.fn_izo_refuz_mutare_tevi()', 'trigger|trg_executie_tevi_izo_truncate on public.executie_tevi|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_izo_atr_garda on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_atr_truncate on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_cfg_garda on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cfg_truncate on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cor_garda on public.izo_corectii_bucati|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_garda on public.izo_corectii|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_truncate on public.izo_corectii_bucati|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_truncate on public.izo_corectii|public.fn_izo_cor_garda()', 'trigger|trg_izo_doc_garda on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_ist_garda on public.izo_documente_istoric|public.fn_izo_doc_ist_garda()', 'trigger|trg_izo_doc_ist_truncate on public.izo_documente_istoric|public.fn_izo_doc_ist_garda()', 'trigger|trg_izo_doc_rand_garda on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_truncate on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_garda on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_truncate on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_truncate on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_ev_garda on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_ev_truncate on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_garda on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_truncate on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_garda on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_truncate on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_magbuc_izo_garda on public.magazie_bucati|public.fn_izo_garda_bucati()', 'trigger|trg_magbuc_izo_truncate on public.magazie_bucati|public.fn_izo_garda_truncate_bucati()', 'trigger|trg_pachete_izo_delete on public.executie_pachete_lansare|public.fn_izo_refuz_delete_pachet()', 'trigger|trg_pachete_izo_mutare on public.executie_pachete_lansare|public.fn_izo_refuz_mutare_pachet()', 'trigger|trg_pachete_izo_truncate on public.executie_pachete_lansare|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_proiecte_izo_site on public.executie_proiecte|public.fn_izo_refuz_site_proiect()', 'trigger|trg_tronsoane_izo_mutare on public.executie_tronsoane|public.fn_izo_refuz_mutare_tronson()']::text[];
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
  v_impl_rev := ARRAY['policy|izo_atr_sel on public.izo_atribuiri|public.fn_izo_citire(bigint)', 'policy|izo_cfg_sel on public.izo_proiect_config|public.fn_izo_citire(bigint)', 'policy|izo_corectii_api_sel on public.izo_corectii|public.fn_izo_citire(bigint)', 'policy|izo_corectii_bucati_api_sel on public.izo_corectii_bucati|public.fn_izo_citire(bigint)', 'policy|izo_doc_api_sel on public.izo_documente_intrare|public.fn_izo_citire(bigint)', 'policy|izo_doc_scan_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_del on storage.objects|public.fn_izo_scan_poate_sterge(pg_catalog.text)', 'policy|izo_doc_scan_r_ins on storage.objects|public.fn_izo_scan_poate_incarca(pg_catalog.text)', 'policy|izo_doc_scan_r_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_doc_scan_sel on storage.objects|public.fn_izo_scan_poate_citi(pg_catalog.text)', 'policy|izo_documente_istoric_api_sel on public.izo_documente_istoric|public.fn_izo_citire(bigint)', 'policy|izo_ev_corectie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_receptie_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_ev_sel on public.magazie_bucati_evenimente|public.fn_izo_citire(bigint)', 'policy|izo_ev_writer_ins on public.magazie_bucati_evenimente|public.fn_izo_nivel(bigint)', 'policy|izo_imp_sel on public.izo_importuri|public.fn_izo_citire(bigint)', 'policy|izo_mis_corectie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_receptie_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|izo_mis_sel on public.magazie_bucati_miscari|public.fn_izo_citire(bigint)', 'policy|izo_mis_writer_ins on public.magazie_bucati_miscari|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_del on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_client_sel on public.magazie_bucati|public.fn_izo_citire(bigint)', 'policy|magbuc_izo_client_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_corectie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_receptie_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_ins on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'policy|magbuc_izo_writer_upd on public.magazie_bucati|public.fn_izo_nivel(bigint)', 'trigger|trg_bon_linii_izo_bucata on public.executie_bonuri_consum_linii|public.fn_izo_refuz_bon_bucata()', 'trigger|trg_depozite_izo_mutare on public.logistica_depozite|public.fn_izo_refuz_mutare_depozit()', 'trigger|trg_executie_tevi_izo_delete on public.executie_tevi|public.fn_izo_refuz_delete_tevi()', 'trigger|trg_executie_tevi_izo_mutare on public.executie_tevi|public.fn_izo_refuz_mutare_tevi()', 'trigger|trg_executie_tevi_izo_truncate on public.executie_tevi|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_izo_atr_garda on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_atr_truncate on public.izo_atribuiri|public.fn_izo_garda_atribuiri()', 'trigger|trg_izo_cfg_garda on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cfg_truncate on public.izo_proiect_config|public.fn_izo_garda_fapte()', 'trigger|trg_izo_cor_garda on public.izo_corectii_bucati|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_garda on public.izo_corectii|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_truncate on public.izo_corectii_bucati|public.fn_izo_cor_garda()', 'trigger|trg_izo_cor_truncate on public.izo_corectii|public.fn_izo_cor_garda()', 'trigger|trg_izo_doc_garda on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_ist_garda on public.izo_documente_istoric|public.fn_izo_doc_ist_garda()', 'trigger|trg_izo_doc_ist_truncate on public.izo_documente_istoric|public.fn_izo_doc_ist_garda()', 'trigger|trg_izo_doc_rand_garda on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_rand_truncate on public.izo_documente_intrare_randuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_garda on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_scan_truncate on public.izo_documente_scanuri|public.fn_izo_doc_garda()', 'trigger|trg_izo_doc_truncate on public.izo_documente_intrare|public.fn_izo_doc_garda()', 'trigger|trg_izo_ev_garda on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_ev_truncate on public.magazie_bucati_evenimente|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_garda on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_imp_truncate on public.izo_importuri|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_garda on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_izo_mis_truncate on public.magazie_bucati_miscari|public.fn_izo_garda_fapte()', 'trigger|trg_magbuc_izo_garda on public.magazie_bucati|public.fn_izo_garda_bucati()', 'trigger|trg_magbuc_izo_truncate on public.magazie_bucati|public.fn_izo_garda_truncate_bucati()', 'trigger|trg_pachete_izo_delete on public.executie_pachete_lansare|public.fn_izo_refuz_delete_pachet()', 'trigger|trg_pachete_izo_mutare on public.executie_pachete_lansare|public.fn_izo_refuz_mutare_pachet()', 'trigger|trg_pachete_izo_truncate on public.executie_pachete_lansare|public.fn_izo_refuz_truncate_cai_vechi()', 'trigger|trg_proiecte_izo_site on public.executie_proiecte|public.fn_izo_refuz_site_proiect()', 'trigger|trg_tronsoane_izo_mutare on public.executie_tronsoane|public.fn_izo_refuz_mutare_tronson()']::text[];
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
    'E3b amprenta=' || v_amprenta || ' inainte_20261106a=' || v_inainte
    || ' porti_anterioare=' || v_porti || ' porti_e3_anterioare=' || v_porti_e3 || ' ‖ anterior: ' || v_comentariu);
  IF current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261106a_izometrie_e3b_corectii:' || txid_current() THEN
    RAISE EXCEPTION 'E3b: garda finală de livrare';
  END IF;
END
$migrare$;
