-- ============================================================================
-- REVENIRE TEHNICĂ pentru 20261006a_sec_f1b_maintain_revoke — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- REDESCHIDE gaura MAINTAIN (VACUUM/ANALYZE/CLUSTER/REINDEX/LOCK TABLE pentru anon/authenticated). Fără GO de execuție:
-- se rulează DOAR la cererea explicită a lui Răzvan, după decizie + review Copilot. Armarea nu e autorizare.
--
-- Procedura (fișierul nu conține BEGIN/COMMIT; un singur string):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261006a', 'REDESCHIDE_MAINTAIN:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
--
-- Readuce EXACT lista live din 01.10 (474 relații, amprenta dd222470…, recitită după #540/#541): 433 cu MAINTAIN pentru anon+authenticated,
-- 41 doar pentru authenticated; relațiile din listă care între timp au dispărut se sar (NOTICE). Setarea implicită a
-- lui postgres pe public primește înapoi MAINTAIN pentru anon/authenticated. Relațiile create după 01.10 NU primesc MAINTAIN.
-- ============================================================================
DO $arm$
BEGIN
  IF current_setting('gazpet.rollback_tehnic_20261006a', true) IS DISTINCT FROM 'REDESCHIDE_MAINTAIN:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261006a: nearmată (gazpet.rollback_tehnic_20261006a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261006a=%') THEN
    RAISE EXCEPTION 'Revenire 20261006a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
END $arm$;

DO $rev$
DECLARE
  v_ambele text[] := ARRAY[
    '_backup_acoperire_racari_20260921', '_backup_clar63_20260927', '_dedup_racari_20260911', '_eval_candidati_inainte_20260921', '_eval_runda1_20260921', '_eval_runda2_20260921',
    'ai_dezbateri', 'ai_dezbateri_mesaje', 'ai_documente_inbox', 'ai_feedback', 'ai_usage_log', 'app_modules',
    'avize_cjp', 'avize_serii_counter', 'beneficiari', 'calendar_days', 'chat_members', 'chat_messages',
    'chatbot_conversations', 'chatbot_easter_eggs', 'chatbot_usage', 'claude_bot_runs', 'claude_bot_silentiate', 'claude_bot_sugestii',
    'claude_context', 'claude_docs', 'comanda_linii', 'comenzi', 'comenzi_aprobatori', 'comenzi_documente',
    'comenzi_furnizor', 'comenzi_furnizor_aprobari', 'comenzi_furnizor_counter', 'comenzi_furnizor_documente', 'comenzi_furnizor_linii', 'consumuri_proiect',
    'consumuri_proiect_linii', 'contab_expert_importuri', 'contab_expert_linii', 'contab_santier_map', 'contracte_acte_aditionale', 'contracte_linii',
    'contracte_polite', 'contracte_polite_acte', 'contracte_subcontract_facturi', 'contracte_subcontract_import', 'contracte_templates', 'contracte_terti',
    'ctc_documente', 'diurna_payment_details', 'diurna_payments', 'documente_firma', 'documente_proiect', 'employee_salaries',
    'employees', 'evogps_alias', 'evogps_imports_log', 'executie_acte_aditionale', 'executie_alerte_ai', 'executie_alocari_personal',
    'executie_bonuri_consum', 'executie_bonuri_consum_linii', 'executie_completari_propuse', 'executie_documente_contract', 'executie_documente_referinta', 'executie_faze_determinante',
    'executie_ordine_detectate', 'executie_ordine_sistare', 'executie_pachete_cumulat_final', 'executie_pachete_cumulat_tevi', 'executie_pachete_documente', 'executie_pachete_exports',
    'executie_pachete_lansare', 'executie_pachete_sudura_sant', 'executie_probe_presiune', 'executie_proiecte', 'executie_situatii_plata', 'executie_situatii_plata_linii',
    'executie_sl_ajustari', 'executie_tevi', 'executie_tronsoane', 'executie_tura_activitati', 'executie_tura_naveta', 'executie_tura_subcontractori',
    'executie_ture', 'facturi_emise', 'facturi_serii_counter', 'firma_profil', 'garantii', 'garantii_alerte_amprenta',
    'gbe_polite', 'gbe_restituiri', 'grafic_activitati', 'grafic_parametri', 'grafic_versiuni', 'hr_adeverinte_legator',
    'hr_aprobatori', 'hr_autorizatii', 'hr_autorizatii_propuneri', 'hr_autorizatii_rsvti_confirmari', 'hr_autorizatii_tipuri', 'hr_cereri_concediu',
    'hr_ci_extrase', 'hr_concediu_rute', 'hr_documente_personale', 'hr_documente_personale_tipuri', 'hr_employees_audit',
    'hr_employees_private', 'hr_personal_extern', 'hr_recomandari', 'hr_recrutare_candidati', 'hr_recrutare_interactiuni', 'hr_recrutare_oferte_trimise',
    'hr_recrutare_pozitii', 'hr_recrutare_retentie_expirata', 'hr_salarii_audit', 'hr_semnaturi_electronice', 'internal_chats', 'iot_citiri',
    'iot_dispozitive', 'iot_integrari', 'iot_privat_acces', 'isc_rte_domenii', 'locatii_cheltuieli', 'locatii_furnizori',
    'locatii_inchiriate', 'logistica_achizitii_vrac', 'logistica_active', 'logistica_active_km_ore_ajustari', 'logistica_active_poze', 'logistica_alerte_consum',
    'logistica_alimentari', 'logistica_alimentari_card', 'logistica_alocari', 'logistica_amc', 'logistica_amc_tipuri', 'logistica_audit_log',
    'logistica_avize_arhiva', 'logistica_bonuri_carburant', 'logistica_bonuri_comune', 'logistica_categorii', 'logistica_cesiuni_subcontractor', 'logistica_comenzi_transport',
    'logistica_comenzi_transport_itemi', 'logistica_costuri', 'logistica_curse_gps', 'logistica_declaratii', 'logistica_depozite', 'logistica_documente',
    'logistica_furnizori', 'logistica_importuri_rompetrol', 'logistica_mentenanta_istoric', 'logistica_mentenanta_plan', 'logistica_oscar_dispense', 'logistica_piese_catalog',
    'logistica_piese_istoric', 'logistica_piese_poze', 'logistica_probleme', 'logistica_probleme_jurnal', 'logistica_qr_submit_log', 'logistica_rezervoare',
    'logistica_service_fise', 'logistica_service_fise_documente', 'logistica_service_intrari', 'logistica_service_itemi_preset', 'logistica_service_parteneri', 'logistica_setari',
    'logistica_subcontractori', 'logistica_supape', 'logistica_telemetrie_zilnica', 'logistica_tipuri_documente', 'logistica_transporturi', 'logistica_transporturi_continut',
    'magazie_bucati', 'magazie_echipamente', 'magazie_inventar_angajat', 'magazie_tipuri_material', 'magazii', 'mai_gov_redirect_log',
    'marketing_aprobatori', 'marketing_postari', 'marketing_santiere', 'materiale', 'meteo_cache', 'module_noutati',
    'module_noutati_citiri', 'nas_documente', 'nas_proiecte', 'necesar_articole', 'necesar_linii', 'necesar_notif_log',
    'necesar_responsabili', 'necesar_runde', 'necesar_setari', 'notification_logs', 'notification_templates', 'notifications',
    'ofertare_acoperire', 'ofertare_acoperire_coada', 'ofertare_acoperire_istoric', 'ofertare_acoperire_revizii', 'ofertare_alerte_amprenta', 'ofertare_cantitati',
    'ofertare_cerinte', 'ofertare_cerinte_pozitii', 'ofertare_citire_test', 'ofertare_clarificari', 'ofertare_clarificari_coada', 'ofertare_clauze_contract',
    'ofertare_documente_atribuire', 'ofertare_extragere_coada', 'ofertare_formulare_registru', 'ofertare_garantii', 'ofertare_ingest_coada', 'ofertare_ingest_lansari',
    'ofertare_inventar_ai', 'ofertare_licitatii', 'ofertare_mailuri', 'ofertare_nas_inventar', 'ofertare_organigrama', 'ofertare_parteneri_documente',
    'ofertare_participari', 'ofertare_pt_anexe_asteptate', 'ofertare_pt_declaratii', 'ofertare_pt_dovezi', 'ofertare_pt_echipa', 'ofertare_pt_echipa_roluri',
    'ofertare_pt_garantie', 'ofertare_pt_pachet', 'ofertare_pt_pachet_fisiere', 'ofertare_pt_participanti', 'ofertare_radar_scan_log', 'ofertare_raport_zilnic',
    'ofertare_solicitari_ac', 'ofertare_solicitari_ac_anexe', 'ofertare_solicitari_ac_puncte', 'ofertare_triere', 'ofertare_verificari', 'olx_atribute_seturi',
    'olx_categorii', 'olx_mesaje_procesate', 'olx_orase', 'olx_tokens', 'ordine_deplasare_arhiva', 'organigrama_propuneri',
    'piese_import_staging', 'platforma_noutati', 'pontaj_brut_istoric', 'pontaj_net_istoric', 'pontaj_records', 'probe_calcule',
    'probe_configuratii', 'probe_diametre', 'probe_log_executie', 'probe_transport_tarife', 'procese_heartbeat', 'productie_documente',
    'productie_facturi', 'productie_lot_componente', 'productie_loturi', 'productie_materiale', 'productie_materiale_miscari', 'productie_produse',
    'productie_serii', 'productie_stoc_miscari', 'profile_sites', 'profiles', 'proiect_activitate_coduri', 'proiect_activitati',
    'proiect_articole', 'proiect_unitati', 'proiecte_ofertare', 'rag_ingest_queue', 'rag_normative', 'rag_qr_log',
    'rag_utilaje', 'rapoarte_zilnice', 'raport_detaliat_financiar', 'raport_lucrari', 'registru_imobilizari', 'reminder_rapoarte_log',
    'salarii_importuri', 'salarii_stat_linii', 'scanner_logs', 'sedinte', 'sedinte_invitati', 'sedinte_linii',
    'sedinte_rsvp', 'service_import_ai_log', 'service_import_ai_mappings', 'setari_ordin_deplasare', 'setari_recycle_bin', 'settings',
    'sites', 'stocuri', 'stocuri_miscari', 'storage_rls_errors', 'supliment_hrana_istoric', 'talon_extract_staging',
    'tichete', 'tichete_asignati', 'tichete_comentarii', 'tichete_default_responsabili', 'tichete_istoric', 'tichete_subcategorii',
    'transferuri_interne', 'transferuri_linii', 'upa_achizitii', 'user_module_access',
    'v_acte_aditionale_toate', 'v_active_date_lipsa', 'v_active_disponibile', 'v_active_fara_norma_cu_alimentari', 'v_active_km_ore', 'v_active_santier_recent',
    'v_activitate_hr_zilnica', 'v_activitate_logistica_zilnica', 'v_ai_cost_luna_curenta', 'v_alerte_act_aditional', 'v_alerte_contracte', 'v_alim_fara_telemetrie',
    'v_alimentari_dubluri_oscar', 'v_alimentari_fara_santier', 'v_alimentari_kpi', 'v_alimentari_ocr_revizuire', 'v_alimentari_pt_ocr', 'v_alimentari_suspecte',
    'v_alimentari_ultima', 'v_audit_alimentari_gap', 'v_audit_cesiuni_subcontractor', 'v_audit_motorina_comodat', 'v_audit_rompetrol_lunar', 'v_audit_rompetrol_vehicule',
    'v_audit_split_anual', 'v_audit_split_detail', 'v_audit_split_lunar', 'v_audit_split_trim', 'v_bonuri_comune_status', 'v_bonuri_consum_nepreluate',
    'v_card_swap_audit', 'v_chat_list', 'v_chatbot_usage_analytics', 'v_chuck_hr_alerte', 'v_chuck_hr_fara_aviz_medical', 'v_citire_test_pagini',
    'v_claude_context_smart', 'v_comodat_depasiri_lunare', 'v_contract_efecte_acte', 'v_contracte_cu_linii', 'v_contracte_executat', 'v_cost_total_per_activ_luna',
    'v_cross_check_km_alerte', 'v_declaratie_tehnica_status', 'v_documente_firma_alerte', 'v_dovezi_stare', 'v_echipament_furnizor', 'v_employee_work_hours',
    'v_executie_alerte_count', 'v_executie_alocari', 'v_executie_alocari_conflicte', 'v_executie_dashboard', 'v_executie_personal_site', 'v_executie_sanatate',
    'v_furnizori_stats', 'v_garantii_plafon_emitent', 'v_garantii_situatie', 'v_gbe_per_contract', 'v_hr_adeverinte_legator_candidati', 'v_hr_autorizatii_arhiva',
    'v_hr_autorizatii_status', 'v_hr_calificare_peste_cim', 'v_hr_date_lipsa', 'v_hr_documente_personale_status', 'v_hr_sold_co', 'v_km_pompa_vs_evogps',
    'v_kpi_logistica', 'v_locatii_sumar_lunar', 'v_logistica_alerte', 'v_logistica_alerte_globale', 'v_logistica_piese_catalog_uz', 'v_magazie_echipamente',
    'v_magazie_inventar_activ', 'v_nas_documente_recente', 'v_nas_statistici', 'v_necesar_cumulat', 'v_necesar_sumar_lunar', 'v_ofertare_completitudine',
    'v_ofertare_contradictii', 'v_ofertare_dashboard', 'v_ofertare_dotari', 'v_ofertare_identitate_tokens', 'v_ofertare_pt_conformitate', 'v_ofertare_pt_echipa',
    'v_ofertare_pt_echipa_blocaje', 'v_ofertare_pt_stare', 'v_ofertare_pt_suprapuneri', 'v_ofertare_solicitari_ac_stare', 'v_olx_categorii', 'v_ordine_lipsa',
    'v_oscar_inchidere_zi', 'v_parc_auto_raport', 'v_polite_alerte', 'v_pontaj_personal_santier', 'v_probe_config_consum', 'v_productie_stoc',
    'v_profile_sites_active', 'v_proiecte_nas_mapping', 'v_qr_reconciliere_lunara', 'v_radar_sezonier', 'v_recycle_bin_hr', 'v_rezervor_consistenta',
    'v_rompetrol_fara_whatsapp', 'v_scadente_iminente', 'v_sedinte_invitati_agenda', 'v_sedinte_restante', 'v_silentiate_active', 'v_sl_fara_factura',
    'v_stoc_furnizori', 'v_stocuri_sub_prag', 'v_sudori_pentru_oferte', 'v_supape_status', 'v_tichete_alerte', 'v_tichete_summary',
    'v_tkt139_progres', 'v_upa_consum_lunar', 'v_utilaje_pentru_oferte', 'v_utilaje_santier_recent', 'v_vehicule_comodat', 'v_vehicule_contracte',
    'v_whatsapp_analytics', 'whatsapp_imports_log', 'whatsapp_messages_processed', 'worker_heartbeat']::text[];
  v_doar_auth text[] := ARRAY[
    'ctc_carti', 'ctc_documente_carte', 'ctc_template_pozitii', 'ctc_templates', 'hr_formare_profesionala', 'logistica_imprumuturi',
    'oferta_materiale', 'ofertare_brokeri', 'ofertare_calibrari', 'ofertare_calibrari_subcontractori', 'ofertare_categorii_reguli', 'ofertare_clarificari_puncte',
    'ofertare_experienta', 'ofertare_normative', 'ofertare_norme_productivitate', 'ofertare_oferte_deschidere', 'ofertare_oferte_furnizori', 'ofertare_parteneri',
    'ofertare_preturi_materiale', 'ofertare_preturi_unitare', 'ofertare_pt_afirmatii', 'ofertare_pt_capitole', 'ofertare_pt_capitole_versiuni', 'ofertare_pt_legaturi',
    'ofertare_pt_observatii', 'ofertare_pt_poarta', 'ofertare_radar', 'ofertare_rfq', 'ofertare_rfq_destinatari', 'ofertare_rfq_materiale',
    'ofertare_rfq_oferte', 'ofertare_rfq_preturi', 'ofertare_seap_manifest', 'ofertare_source_pack', 'ofertare_source_pack_importuri', 'probe_oferte',
    'v_ctc_carti_progres', 'v_hr_formare_cursuri', 'v_ofertare_cerinte_dovezi', 'v_ofertare_pt_cerinte_neconfirmate', 'v_ofertare_seap_completitudine']::text[];
  v_n integer; r text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire: rulează ca postgres'; END IF;
  -- precondiție: starea patch-ului (0 relații cu MAINTAIN la anon/authenticated)
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
     AND (has_table_privilege('anon', c.oid, 'MAINTAIN') OR has_table_privilege('authenticated', c.oid, 'MAINTAIN'));
  IF v_n <> 0 THEN RAISE EXCEPTION 'Revenire: precondiție — % relații au deja MAINTAIN (așteptat 0 = starea 20261006a)', v_n; END IF;
  FOREACH r IN ARRAY v_ambele LOOP
    IF to_regclass(format('public.%I', r)) IS NULL THEN RAISE NOTICE 'Revenire: public.% nu mai există — sărit', r;
    ELSE EXECUTE format('GRANT MAINTAIN ON public.%I TO anon, authenticated', r); END IF;
  END LOOP;
  FOREACH r IN ARRAY v_doar_auth LOOP
    IF to_regclass(format('public.%I', r)) IS NULL THEN RAISE NOTICE 'Revenire: public.% nu mai există — sărit', r;
    ELSE EXECUTE format('GRANT MAINTAIN ON public.%I TO authenticated', r); END IF;
  END LOOP;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT MAINTAIN ON TABLES TO anon, authenticated;
  -- postcondiție: exact lista (∩ relațiile existente), nimic în plus
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
     AND (has_table_privilege('anon', c.oid, 'MAINTAIN') IS DISTINCT FROM (c.relname = ANY(v_ambele))
       OR has_table_privilege('authenticated', c.oid, 'MAINTAIN') IS DISTINCT FROM (c.relname = ANY(v_ambele || v_doar_auth)));
  IF v_n <> 0 THEN RAISE EXCEPTION 'Revenire: postcondiție — % relații nu corespund listei din 01.10', v_n; END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261006a', '', true);
END $rev$;
