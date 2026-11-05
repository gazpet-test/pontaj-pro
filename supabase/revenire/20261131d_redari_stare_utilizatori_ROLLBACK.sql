-- PR2 juridic#040. NUMAI fisiere; nu aplica fara review si DRY pe clona izolata.
-- Runner obligatoriu: psql --single-transaction, armare SET LOCAL in ACEEASI tranzactie:
-- SELECT set_config('gazpet.livrare_migrare','20261131d_redari_stare_utilizatori_ROLLBACK:'||txid_current(),true);
-- Nu face DML business. CREATE OR REPLACE pastreaza OID, dependentele si ACL; nicio coloana noua.
DO $start$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true)
    IS DISTINCT FROM '20261131d_redari_stare_utilizatori_ROLLBACK:'||txid_current() THEN RAISE EXCEPTION 'PR2: garda start invalida'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) c WHERE c LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION 'PR2: armare persistenta refuzata'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('search_path','public, pg_temp',true);
  -- Aceeasi ordine apply/revenire. Blocam inainte de verificare, nu cerem stergerea datelor.
  -- Revenirea schimba numai proiectia, fara eliminare de istoric/config/date sau obiecte PR1.
  LOCK TABLE public.red_procese_verbale,public.red_parcele,public.red_detinatori,
    public.red_uat,public.red_detinatori_contact,public.red_raspunsuri,public.red_convocari,
    public.red_v_stare_parcela,public.red_v_centralizator_uat IN ACCESS EXCLUSIVE MODE;
END $start$;
-- Prefix rezervat verificarii temporare; permite apply/revenire/re-apply in aceeasi tranzactie.
DROP TABLE IF EXISTS pg_temp.pr2_functii,pg_temp.pr2_coloane,pg_temp.pr2_tables,pg_temp.pr2_triggers;
CREATE TEMP TABLE pg_temp.pr2_functii(sig text,corp text,ret text,retset boolean,lang text,definer boolean,vol text,config text[],acl text[]) ON COMMIT DROP;
INSERT INTO pg_temp.pr2_functii VALUES
-- 20261126a_redari_teren.sql
('public.fn_red_adresa_cunoscuta(uuid)','55cb31fc3f291cb27bea16a2b9291146','boolean',false,'sql',true,'s',ARRAY['search_path=public, pg_temp']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129i_redari_plicuri.sql
('public.fn_red_cheie_calc(text,text,text,text,text,text,boolean)','826d79dd53dc47c14410ed8ce0a6ce12','text',false,'sql',true,'s',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129i_redari_plicuri.sql
('public.fn_red_cheie_persoana(uuid)','2d2a98bf9d8747668718c5a7eb6404e7','text',false,'sql',true,'s',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261130m_redari_autorizare_tgz.sql
('public.fn_red_convocari_informare_garda()','0ad4dab815eb77d27e9f924b2f3b1316','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129i_redari_plicuri.sql
('public.fn_red_convocari_posta_garda()','27f9e3fd61880e97cb43fc7599536ed3','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261130l_redari_convocare_rezerva.sql
('public.fn_red_convocari_rezerva_garda()','7ea11de788ce3ee28f2f9066668c6448','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261126a_redari_teren.sql
('public.fn_red_detinatori_before()','dbdd7dc25c6da9322e1275e582642e66','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261126a_redari_teren.sql
('public.fn_red_detinatori_token_dupa()','4060badde2b36e79cd3632e0999563a1','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261130m_redari_autorizare_tgz.sql
('public.fn_red_informare_publicata(text)','78eb6b0d404b1cd519c5d6953f0f7146','boolean',false,'sql',true,'s',ARRAY['search_path=public, pg_temp']::text[],ARRAY['anon=X/postgres','authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261130j_redari_mail_f1_schema.sql
('public.fn_red_jurnal()','41ab451b7fcb499a2284c9c82367069e','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261129g_redari_tronson_optional.sql
('public.fn_red_legaturi()','d1912ec6514cba162babea3bcebdfb24','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261130k_redari_mail_f1_reguli.sql
('public.fn_red_mail_raspuns_protejat()','7f5e3f3d442315cc3423d24da265982c','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261130k_redari_mail_f1_reguli.sql
('public.fn_red_mail_raspuns_sursa_ceruta()','d8790cb76a0fb0fe5090b9550343ab24','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261130k_redari_mail_f1_reguli.sql
('public.fn_red_mail_referinta_obiectii(text,uuid)','cc0c1aa04696226fa023bccc7a4fdbd4','text',false,'sql',false,'i',ARRAY['search_path=public, pg_temp']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres']::text[]),
-- 20261126a_redari_teren.sql
('public.fn_red_nivel()','21db8e5d4b69b7f19e571a7087c361ae','text',false,'sql',true,'s',ARRAY['search_path=public, pg_temp']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261130n_redari_pv_utilizatori.sql
('public.fn_red_parcela_acoperita_a(uuid)','b932aaf307761d3c504608a30c117bca','boolean',false,'sql',false,'s',ARRAY['search_path=public, pg_temp']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261130h_redari_parcele_nr_crt_grup.sql
('public.fn_red_parcele_nr_crt_grup_imutabil()','f7935716441f6f1d4c53d5fcbdd3a75d','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129i_redari_plicuri.sql
('public.fn_red_plic_garda_persoana(uuid)','4c1f0bb4757c68630989e5e464b7682f','void',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129i_redari_plicuri.sql
('public.fn_red_plic_identitate_garda()','edce63d7568ccb5c51574007b42e17ad','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129j_redari_plicuri_0e.sql
('public.fn_red_plic_incearca_lock(uuid)','af77d2e7c85bdea490f76b12eb18dff1','void',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129i_redari_plicuri.sql
('public.fn_red_plic_incearca_lock_detinator(uuid)','c7b8cff21c1999435246f84e085b7aea','uuid',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129i_redari_plicuri.sql
('public.fn_red_plic_uat_detinator(uuid)','f837713cf4f3373ae7f9a46dd60210f9','uuid',false,'sql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261130n_redari_pv_utilizatori.sql
('public.fn_red_pv_b_semnare()','728fc279beee0b34f9adcfb425b2dd9f','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129d_redari_pv_c.sql
('public.fn_red_pv_c_garda()','975e5501b2c9e4ceca85a84b3fd64f3d','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129d_redari_pv_c.sql
('public.fn_red_pv_c_neacoperite(uuid,integer)','ad42b1c7c1e4be49a2ea99a5eca9e3dd','bigint',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp','lock_timeout=5s']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261130n_redari_pv_utilizatori.sql
('public.fn_red_pv_calitate_semnatar()','c47235d62aedbf6b3efccba60702b95b','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261129c_redari_pv_stari.sql
('public.fn_red_pv_stare_tranzitie()','2d69244951387ad650e2b1ed91a19308','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261126a_redari_teren.sql
('public.fn_red_raspunsuri_valideaza()','3528222d7d8379dbbe8f3d2e64c60b94','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261126a_redari_teren.sql
('public.fn_red_token_expira_calc(uuid)','52a0d4e012d7c0444a5534dae82fd20e','timestamptz',false,'sql',true,'s',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261126a_redari_teren.sql
('public.fn_red_uat_sesiuni_dupa()','8dc80399daecd4a1ea93368711428ea5','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261126a_redari_teren.sql
('public.fn_red_updated_at()','c28bbd99ced3dfcd7ff6c2a1298a90e1','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261127a_redari_uat_setari.sql
('public.fn_red_versiune_creste()','e7ab9318de671f0a94c678ee382250db','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]);
CREATE TEMP TABLE pg_temp.pr2_coloane(t text,n int,c text,typ text,acl text[]) ON COMMIT DROP;
INSERT INTO pg_temp.pr2_coloane VALUES
('red_parcele',1,'id','uuid',ARRAY['authenticated=INSERT','authenticated=SELECT']::text[]),
('red_parcele',2,'proiect_id','uuid',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',3,'uat_id','uuid',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',4,'id_parcela','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',5,'tronson','integer',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',6,'km_de_la','numeric',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',7,'km_pana_la','numeric',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',8,'sat','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',9,'tarla','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',10,'nr_cadastral','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',11,'poz_hg','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',12,'suprafata_temporara_mp','numeric',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',13,'categoria_folosinta','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',14,'articol_deviz','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',15,'cantitate','numeric',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',16,'valoare_lei','numeric',ARRAY[]::text[]),
('red_parcele',17,'observatii','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',18,'cheie_sursa','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',19,'sters_la','timestamptz',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',20,'sters_de','uuid',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',21,'sters_motiv','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',22,'created_at','timestamptz',ARRAY['authenticated=INSERT','authenticated=SELECT']::text[]),
('red_parcele',23,'verificare_data','date',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',24,'verificare_de_gazpet','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',25,'verificare_de_tgz','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',26,'jurnal_santier_ref','text',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE']::text[]),
('red_parcele',27,'nr_crt_grup','text',ARRAY['authenticated=INSERT','authenticated=SELECT']::text[]),
('red_uat',1,'id','uuid',ARRAY[]::text[]),
('red_uat',2,'proiect_id','uuid',ARRAY[]::text[]),
('red_uat',3,'nume','text',ARRAY[]::text[]),
('red_uat',4,'uat3','text',ARRAY[]::text[]),
('red_uat',5,'judet','text',ARRAY[]::text[]),
('red_uat',6,'primarie_adresa','text',ARRAY[]::text[]),
('red_uat',7,'primarie_email','text',ARRAY[]::text[]),
('red_uat',8,'primarie_telefon','text',ARRAY[]::text[]),
('red_uat',9,'reprezentant_uat_nume','text',ARRAY[]::text[]),
('red_uat',10,'reprezentant_uat_functie','text',ARRAY[]::text[]),
('red_uat',11,'sesiune_zi1','date',ARRAY[]::text[]),
('red_uat',12,'sesiune_zi2','date',ARRAY[]::text[]),
('red_uat',13,'sesiune_zi3','date',ARRAY[]::text[]),
('red_uat',14,'program_zi1','text',ARRAY[]::text[]),
('red_uat',15,'program_zi2','text',ARRAY[]::text[]),
('red_uat',16,'program_zi3','text',ARRAY[]::text[]),
('red_uat',17,'sate_zi1','text',ARRAY[]::text[]),
('red_uat',18,'sate_zi2','text',ARRAY[]::text[]),
('red_uat',19,'sate_zi3','text',ARRAY[]::text[]),
('red_uat',20,'afisare_pv_nr','text',ARRAY[]::text[]),
('red_uat',21,'afisare_data_start','date',ARRAY[]::text[]),
('red_uat',22,'afisare_data_end','date',ARRAY[]::text[]),
('red_uat',23,'created_at','timestamptz',ARRAY[]::text[]),
('red_uat',24,'reprezentant_uat_telefon','text',ARRAY[]::text[]),
('red_uat',25,'termen_confirmare','date',ARRAY[]::text[]),
('red_uat',26,'afisare_ora','text',ARRAY[]::text[]),
('red_uat',27,'afisare_reprezentant_gazpet','text',ARRAY[]::text[]),
('red_uat',28,'adresa_nr','text',ARRAY[]::text[]),
('red_uat',29,'adresa_data','date',ARRAY[]::text[]),
('red_uat',30,'versiune','integer',ARRAY[]::text[]),
('red_uat',31,'responsabil_id','uuid',ARRAY[]::text[]),
('red_detinatori',1,'id','uuid',ARRAY[]::text[]),
('red_detinatori',2,'parcela_id','uuid',ARRAY[]::text[]),
('red_detinatori',3,'nume','text',ARRAY[]::text[]),
('red_detinatori',4,'nume_normalizat','text',ARRAY[]::text[]),
('red_detinatori',5,'calitate','text',ARRAY[]::text[]),
('red_detinatori',6,'cota','text',ARRAY[]::text[]),
('red_detinatori',7,'decedat','boolean',ARRAY[]::text[]),
('red_detinatori',8,'sursa_date','text',ARRAY[]::text[]),
('red_detinatori',9,'versiune_lista_tgz','text',ARRAY[]::text[]),
('red_detinatori',10,'sters_la','timestamptz',ARRAY[]::text[]),
('red_detinatori',11,'sters_de','uuid',ARRAY[]::text[]),
('red_detinatori',12,'sters_motiv','text',ARRAY[]::text[]),
('red_detinatori',13,'created_at','timestamptz',ARRAY[]::text[]),
('red_detinatori',14,'updated_at','timestamptz',ARRAY[]::text[]),
('red_detinatori',15,'act_doveditor_cunoscut','boolean',ARRAY[]::text[]),
('red_detinatori_contact',1,'detinator_id','uuid',ARRAY[]::text[]),
('red_detinatori_contact',2,'adresa_strada','text',ARRAY[]::text[]),
('red_detinatori_contact',3,'adresa_sat','text',ARRAY[]::text[]),
('red_detinatori_contact',4,'adresa_comuna','text',ARRAY[]::text[]),
('red_detinatori_contact',5,'adresa_judet','text',ARRAY[]::text[]),
('red_detinatori_contact',6,'cod_postal','text',ARRAY[]::text[]),
('red_detinatori_contact',7,'adresa_cunoscuta','boolean',ARRAY[]::text[]),
('red_detinatori_contact',8,'telefon','text',ARRAY[]::text[]),
('red_detinatori_contact',9,'email','text',ARRAY[]::text[]),
('red_detinatori_contact',10,'updated_at','timestamptz',ARRAY[]::text[]),
('red_procese_verbale',1,'id','uuid',ARRAY[]::text[]),
('red_procese_verbale',2,'parcela_id','uuid',ARRAY[]::text[]),
('red_procese_verbale',3,'detinator_id','uuid',ARRAY[]::text[]),
('red_procese_verbale',4,'uat_id','uuid',ARRAY[]::text[]),
('red_procese_verbale',5,'tronson','integer',ARRAY[]::text[]),
('red_procese_verbale',6,'tip','text',ARRAY[]::text[]),
('red_procese_verbale',7,'nr_pv','text',ARRAY[]::text[]),
('red_procese_verbale',8,'data_pv','date',ARRAY[]::text[]),
('red_procese_verbale',9,'locul','text',ARRAY[]::text[]),
('red_procese_verbale',10,'stare_teren_text','text',ARRAY[]::text[]),
('red_procese_verbale',11,'obiectii_redare','boolean',ARRAY[]::text[]),
('red_procese_verbale',12,'obiectii_text','text',ARRAY[]::text[]),
('red_procese_verbale',13,'termen_remediere','date',ARRAY[]::text[]),
('red_procese_verbale',14,'remediat_la','date',ARRAY[]::text[]),
('red_procese_verbale',15,'stare','text',ARRAY[]::text[]),
('red_procese_verbale',16,'motiv_anulare','text',ARRAY[]::text[]),
('red_procese_verbale',17,'trimis_spre_semnare_data','date',ARRAY[]::text[]),
('red_procese_verbale',18,'semnat_primit_data','date',ARRAY[]::text[]),
('red_procese_verbale',19,'semnat_fizic','boolean',ARRAY[]::text[]),
('red_procese_verbale',20,'fisier_generat_path','text',ARRAY[]::text[]),
('red_procese_verbale',21,'fisier_semnat_path','text',ARRAY[]::text[]),
('red_procese_verbale',22,'semnatari','jsonb',ARRAY[]::text[]),
('red_procese_verbale',23,'sters_la','timestamptz',ARRAY[]::text[]),
('red_procese_verbale',24,'sters_de','uuid',ARRAY[]::text[]),
('red_procese_verbale',25,'sters_motiv','text',ARRAY[]::text[]),
('red_procese_verbale',26,'created_by','uuid',ARRAY[]::text[]),
('red_procese_verbale',27,'created_at','timestamptz',ARRAY[]::text[]),
('red_procese_verbale',28,'lucrari','jsonb',ARRAY[]::text[]),
('red_procese_verbale',29,'stare_teren','jsonb',ARRAY[]::text[]),
('red_procese_verbale',30,'plan_situatie','boolean',ARRAY[]::text[]),
('red_procese_verbale',31,'foto_nr','integer',ARRAY[]::text[]),
('red_procese_verbale',32,'constatare_mod','text',ARRAY[]::text[]),
('red_procese_verbale',33,'reverificare_la','date',ARRAY[]::text[]),
('red_procese_verbale',34,'alte_observatii','text',ARRAY[]::text[]),
('red_procese_verbale',35,'motiv_pv_b','text',ARRAY[]::text[]),
('red_procese_verbale',36,'semnat_la_sesiune','boolean',ARRAY[]::text[]),
('red_procese_verbale',37,'identitate_verificata','boolean',ARRAY[]::text[]),
('red_procese_verbale',38,'calitate_semnatar','text',ARRAY[]::text[]),
('red_procese_verbale',39,'calitate_document','text',ARRAY[]::text[]),
('red_raspunsuri',1,'id','uuid',ARRAY['authenticated=INSERT']::text[]),
('red_raspunsuri',2,'seq','bigint',ARRAY[]::text[]),
('red_raspunsuri',3,'detinator_id','uuid',ARRAY['authenticated=INSERT']::text[]),
('red_raspunsuri',4,'canal','text',ARRAY['authenticated=INSERT','authenticated=UPDATE']::text[]),
('red_raspunsuri',5,'data','timestamptz',ARRAY['authenticated=INSERT','authenticated=UPDATE']::text[]),
('red_raspunsuri',6,'optiune','text',ARRAY['authenticated=INSERT','authenticated=UPDATE']::text[]),
('red_raspunsuri',7,'zi_sesiune_aleasa','date',ARRAY['authenticated=INSERT','authenticated=UPDATE']::text[]),
('red_raspunsuri',8,'obiectii_text','text',ARRAY['authenticated=INSERT','authenticated=UPDATE']::text[]),
('red_raspunsuri',9,'declaratie_confirmata','boolean',ARRAY['authenticated=INSERT','authenticated=UPDATE']::text[]),
('red_raspunsuri',10,'semnatura_electronica_ref','text',ARRAY['authenticated=INSERT','authenticated=UPDATE']::text[]),
('red_raspunsuri',11,'created_by','uuid',ARRAY['authenticated=INSERT']::text[]),
('red_raspunsuri',12,'created_at','timestamptz',ARRAY[]::text[]),
('red_convocari',1,'id','uuid',ARRAY[]::text[]),
('red_convocari',2,'detinator_id','uuid',ARRAY[]::text[]),
('red_convocari',3,'canal','text',ARRAY[]::text[]),
('red_convocari',4,'nr_document','text',ARRAY[]::text[]),
('red_convocari',5,'data_expediere','date',ARRAY[]::text[]),
('red_convocari',6,'nr_tracking','text',ARRAY[]::text[]),
('red_convocari',7,'data_confirmare_primire','date',ARRAY[]::text[]),
('red_convocari',8,'retur','text',ARRAY[]::text[]),
('red_convocari',9,'retur_data','date',ARRAY[]::text[]),
('red_convocari',10,'continut_hash','text',ARRAY[]::text[]),
('red_convocari',11,'fisier_convocator_path','text',ARRAY[]::text[]),
('red_convocari',12,'stare','text',ARRAY[]::text[]),
('red_convocari',13,'motiv_anulare','text',ARRAY[]::text[]),
('red_convocari',14,'sters_la','timestamptz',ARRAY[]::text[]),
('red_convocari',15,'sters_de','uuid',ARRAY[]::text[]),
('red_convocari',16,'sters_motiv','text',ARRAY[]::text[]),
('red_convocari',17,'created_by','uuid',ARRAY[]::text[]),
('red_convocari',18,'created_at','timestamptz',ARRAY[]::text[]),
('red_convocari',19,'adresa_tgz_nr','text',ARRAY[]::text[]),
('red_convocari',20,'reluare','boolean',ARRAY[]::text[]),
('red_convocari',21,'plic_id','uuid',ARRAY[]::text[]),
('red_convocari',22,'retur_detaliu','text',ARRAY[]::text[]);
CREATE TEMP TABLE pg_temp.pr2_tables(t text,acl text[]) ON COMMIT DROP;
INSERT INTO pg_temp.pr2_tables VALUES
('red_parcele',ARRAY['postgres=DELETE','postgres=INSERT','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_uat',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_detinatori',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_detinatori_contact',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_procese_verbale',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_raspunsuri',ARRAY['authenticated=SELECT','postgres=DELETE','postgres=INSERT','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_convocari',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]);
CREATE TEMP TABLE pg_temp.pr2_triggers(t text,n text,f text,typ int,e_def boolean,e_init boolean,cols text[]) ON COMMIT DROP;
INSERT INTO pg_temp.pr2_triggers VALUES
('red_convocari','trg_red_convocari_garda_rezerva','public.fn_red_convocari_rezerva_garda()',7,false,false,ARRAY[]::text[]),
('red_convocari','trg_red_convocari_informare','public.fn_red_convocari_informare_garda()',23,false,false,ARRAY[]::text[]),
('red_convocari','trg_red_convocari_posta_garda','public.fn_red_convocari_posta_garda()',23,false,false,ARRAY[]::text[]),
('red_convocari','trg_red_jurnal','public.fn_red_jurnal()',29,false,false,ARRAY[]::text[]),
('red_convocari','trg_red_legaturi','public.fn_red_legaturi()',23,false,false,ARRAY[]::text[]),
('red_detinatori','trg_red_detinatori_before','public.fn_red_detinatori_before()',23,false,false,ARRAY[]::text[]),
('red_detinatori','trg_red_detinatori_token','public.fn_red_detinatori_token_dupa()',5,false,false,ARRAY[]::text[]),
('red_detinatori','trg_red_jurnal','public.fn_red_jurnal()',29,false,false,ARRAY[]::text[]),
('red_detinatori','trg_red_legaturi','public.fn_red_legaturi()',23,false,false,ARRAY[]::text[]),
('red_detinatori','trg_red_plic_identitate','public.fn_red_plic_identitate_garda()',19,false,false,ARRAY[]::text[]),
('red_detinatori_contact','trg_red_contact_updated_at','public.fn_red_updated_at()',19,false,false,ARRAY[]::text[]),
('red_detinatori_contact','trg_red_jurnal','public.fn_red_jurnal()',29,false,false,ARRAY[]::text[]),
('red_detinatori_contact','trg_red_legaturi','public.fn_red_legaturi()',23,false,false,ARRAY[]::text[]),
('red_detinatori_contact','trg_red_plic_identitate','public.fn_red_plic_identitate_garda()',23,false,false,ARRAY[]::text[]),
('red_parcele','trg_red_jurnal','public.fn_red_jurnal()',29,false,false,ARRAY[]::text[]),
('red_parcele','trg_red_legaturi','public.fn_red_legaturi()',23,false,false,ARRAY[]::text[]),
('red_parcele','trg_red_parcele_nr_crt_grup','public.fn_red_parcele_nr_crt_grup_imutabil()',19,false,false,ARRAY[]::text[]),
('red_parcele','trg_red_plic_identitate','public.fn_red_plic_identitate_garda()',19,false,false,ARRAY[]::text[]),
('red_procese_verbale','red_pv_aa_calitate','public.fn_red_pv_calitate_semnatar()',23,false,false,ARRAY[]::text[]),
('red_procese_verbale','red_pv_b_semnare','public.fn_red_pv_b_semnare()',23,false,false,ARRAY['stare']::text[]),
('red_procese_verbale','red_pv_c_garda','public.fn_red_pv_c_garda()',23,false,false,ARRAY[]::text[]),
('red_procese_verbale','red_pv_stare_tranzitie','public.fn_red_pv_stare_tranzitie()',19,false,false,ARRAY[]::text[]),
('red_procese_verbale','trg_red_jurnal','public.fn_red_jurnal()',29,false,false,ARRAY[]::text[]),
('red_procese_verbale','trg_red_legaturi','public.fn_red_legaturi()',23,false,false,ARRAY[]::text[]),
('red_raspunsuri','trg_red_jurnal','public.fn_red_jurnal()',29,false,false,ARRAY[]::text[]),
('red_raspunsuri','trg_red_legaturi','public.fn_red_legaturi()',23,false,false,ARRAY[]::text[]),
('red_raspunsuri','trg_red_raspunsuri_mail_sursa','public.fn_red_mail_raspuns_sursa_ceruta()',5,true,true,ARRAY[]::text[]),
('red_raspunsuri','trg_red_raspunsuri_valideaza','public.fn_red_raspunsuri_valideaza()',23,false,false,ARRAY[]::text[]),
('red_raspunsuri','trg_red_raspunsuri_zz_mail','public.fn_red_mail_raspuns_protejat()',19,false,false,ARRAY[]::text[]),
('red_uat','trg_red_jurnal','public.fn_red_jurnal()',29,false,false,ARRAY[]::text[]),
('red_uat','trg_red_legaturi','public.fn_red_legaturi()',23,false,false,ARRAY[]::text[]),
('red_uat','trg_red_uat_sesiuni','public.fn_red_uat_sesiuni_dupa()',17,false,false,ARRAY['sesiune_zi1','sesiune_zi2','sesiune_zi3']::text[]),
('red_uat','trg_red_versiune','public.fn_red_versiune_creste()',19,false,false,ARRAY[]::text[]);
-- L15: allow-list fixe din migrarile versionate; NU invatam amprente din catalogul curent.
CREATE OR REPLACE FUNCTION pg_temp.pr2_verifica_baza() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $baza$
DECLARE r record; v text[]; n int;
BEGIN
  FOR r IN SELECT * FROM pg_temp.pr2_functii LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid=to_regprocedure(r.sig) AND md5(p.prosrc)=r.corp AND l.lanname=r.lang AND p.prorettype=to_regtype(r.ret) AND p.proretset=r.retset
        AND p.prosecdef=r.definer AND p.provolatile::text=r.vol AND p.proconfig=r.config
        AND pg_get_userbyid(p.proowner)='postgres'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)=r.acl) THEN
      RAISE EXCEPTION 'PR2: functie in afara baseline revizuit: %',r.sig;
    END IF;
  END LOOP;
  -- Lant citire: vedere -> adresa_cunoscuta -> nivel -> auth.uid (3 niveluri).
  -- Corpurile SQL/PLpgSQL exacte exclud injectarea EXECUTE sau schimbarea callees/search_path.
  FOR r IN SELECT * FROM (VALUES
    ('auth.uid()','cdef18c69c4f4cbbced2eaf81e628b49',ARRAY['=X/supabase_auth_admin','dashboard_user=X/supabase_auth_admin','supabase_auth_admin=X/supabase_auth_admin']),
    ('auth.role()','f31486fed08a7402e89d4aa71b0ad273',ARRAY['=X/supabase_auth_admin','dashboard_user=X/supabase_auth_admin','supabase_auth_admin=X/supabase_auth_admin']),
    ('auth.jwt()','2db09c3fc855ba90e71d3ae28cfadae3',ARRAY['=X/supabase_auth_admin','dashboard_user=X/supabase_auth_admin','postgres=X/supabase_auth_admin','supabase_auth_admin=X/supabase_auth_admin'])
  ) b(sig,corp,acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid=to_regprocedure(r.sig) AND md5(p.prosrc)=r.corp AND l.lanname='sql'
        AND NOT p.prosecdef AND p.provolatile='s' AND p.proconfig IS NULL AND NOT p.proretset
        AND p.prorettype=CASE r.sig WHEN 'auth.uid()' THEN 'uuid'::regtype WHEN 'auth.role()' THEN 'text'::regtype ELSE 'jsonb'::regtype END
        AND pg_get_userbyid(p.proowner)='supabase_auth_admin'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)=r.acl) THEN
      RAISE EXCEPTION 'PR2: callee auth in afara baseline: %',r.sig; END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp.pr2_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.'||r.t)
        AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
        AND (SELECT array_agg(pg_get_userbyid(a.grantee)||'='||a.privilege_type ORDER BY (pg_get_userbyid(a.grantee)||'='||a.privilege_type) COLLATE "C")
             FROM aclexplode(c.relacl) a WHERE a.grantor='postgres'::regrole AND NOT a.is_grantable)=r.acl
        AND NOT EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantor<>'postgres'::regrole OR a.is_grantable)) THEN
      RAISE EXCEPTION 'PR2: RLS/owner/ACL tabela: %',r.t; END IF;
    SELECT count(*) INTO n FROM pg_attribute WHERE attrelid=to_regclass('public.'||r.t) AND attnum>0 AND NOT attisdropped;
    IF n<>(SELECT count(*) FROM pg_temp.pr2_coloane WHERE t=r.t) THEN RAISE EXCEPTION 'PR2: coloane tabela: %',r.t; END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp.pr2_coloane LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.t)
      AND a.attnum=r.n AND a.attname=r.c AND NOT a.attisdropped AND a.atttypid=to_regtype(r.typ) AND a.atttypmod=-1 AND a.attcollation=(SELECT typcollation FROM pg_type WHERE oid=a.atttypid)
      AND coalesce((SELECT array_agg(pg_get_userbyid(x.grantee)||'='||x.privilege_type ORDER BY (pg_get_userbyid(x.grantee)||'='||x.privilege_type) COLLATE "C")
                    FROM aclexplode(a.attacl) x WHERE x.grantor='postgres'::regrole AND NOT x.is_grantable),ARRAY[]::text[])=r.acl
      AND NOT EXISTS (SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantor<>'postgres'::regrole OR x.is_grantable)) THEN
      RAISE EXCEPTION 'PR2: coloana/ACL: %.%',r.t,r.c; END IF;
  END LOOP;
  -- Inventar complet, inclusiv UPDATE OF, WHEN si starea de activare.
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_temp.pr2_tables b ON t.tgrelid=to_regclass('public.'||b.t) WHERE NOT t.tgisinternal)
      <> (SELECT count(*) FROM pg_temp.pr2_triggers) THEN RAISE EXCEPTION 'PR2: inventar triggere'; END IF;
  FOR r IN SELECT * FROM pg_temp.pr2_triggers LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||r.t) AND t.tgname=r.n
      AND t.tgfoid=to_regprocedure(r.f) AND t.tgenabled='O' AND t.tgtype=r.typ AND (CASE WHEN r.n='trg_red_raspunsuri_mail_sursa' THEN
        pg_get_triggerdef(t.oid) = 'CREATE CONSTRAINT TRIGGER trg_red_raspunsuri_mail_sursa AFTER INSERT ON public.red_raspunsuri DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.canal = ''email''::text)) EXECUTE FUNCTION fn_red_mail_raspuns_sursa_ceruta()'
        ELSE t.tgqual IS NULL END)
      AND t.tgnargs=0 AND NOT t.tgisinternal AND t.tgdeferrable=r.e_def AND t.tginitdeferred=r.e_init
      AND ARRAY(SELECT a.attname::text FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY x(num,ord)
                JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=x.num ORDER BY x.ord)=r.cols) THEN
      RAISE EXCEPTION 'PR2: trigger: %.%',r.t,r.n; END IF;
  END LOOP;
  -- Toate politicile, inclusiv cele de scriere; NULL qual este comparat explicit, nu acceptat ca restrictie.
  IF (SELECT count(*) FROM pg_policies p JOIN pg_temp.pr2_tables b ON b.t=p.tablename WHERE p.schemaname='public')<>21 THEN
    RAISE EXCEPTION 'PR2: inventar politici'; END IF;
  FOR r IN SELECT p.* FROM pg_policies p JOIN pg_temp.pr2_tables b ON b.t=p.tablename WHERE p.schemaname='public' LOOP
    IF r.roles IS DISTINCT FROM ARRAY['authenticated']::name[] OR r.permissive IS DISTINCT FROM 'PERMISSIVE'
      OR r.cmd NOT IN ('SELECT','INSERT','UPDATE')
      OR r.policyname IS DISTINCT FROM (CASE r.tablename WHEN 'red_procese_verbale' THEN 'red_pv' WHEN 'red_detinatori_contact' THEN 'red_contact' ELSE r.tablename END
          || CASE r.cmd WHEN 'SELECT' THEN '_sel' WHEN 'INSERT' THEN '_ins' WHEN 'UPDATE' THEN '_upd' END)
      OR (r.cmd='SELECT' AND (r.with_check IS NOT NULL OR r.qual IS DISTINCT FROM
        CASE WHEN r.tablename='red_detinatori_contact'
        THEN '(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))'
        ELSE '(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)' END))
      OR (r.cmd='INSERT' AND (r.qual IS NOT NULL OR r.with_check IS DISTINCT FROM
        CASE WHEN r.tablename='red_uat' THEN '(( SELECT fn_red_nivel() AS fn_red_nivel) = ''admin''::text)'
        ELSE '(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))' END))
      OR (r.cmd='UPDATE' AND (r.qual IS DISTINCT FROM
        CASE WHEN r.tablename='red_uat' THEN '(( SELECT fn_red_nivel() AS fn_red_nivel) = ''admin''::text)'
        ELSE '(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))' END
        OR r.with_check IS DISTINCT FROM r.qual)) THEN RAISE EXCEPTION 'PR2: politica: %',r.policyname; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_sequence s ON s.seqrelid=c.oid
    WHERE c.oid='public.red_raspunsuri_seq_seq'::regclass AND pg_get_userbyid(c.relowner)='postgres'
      AND s.seqtypid='bigint'::regtype AND s.seqincrement=1 AND NOT s.seqcycle AND s.seqstart=1 AND s.seqmin=1 AND s.seqmax=9223372036854775807 AND s.seqcache=1
      AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(c.relacl::text[]) x)
          =ARRAY['authenticated=U/postgres','postgres=rwU/postgres','service_role=U/postgres']) THEN
    RAISE EXCEPTION 'PR2: secventa/ACL raspunsuri'; END IF;
END $baza$;
REVOKE ALL ON FUNCTION pg_temp.pr2_verifica_baza() FROM PUBLIC;
SELECT pg_temp.pr2_verifica_baza();
CREATE TEMP VIEW pr2_stare_asteptata WITH (security_invoker = on) AS
SELECT p.id AS parcela_id, d.id AS detinator_id, p.proiect_id, p.uat_id, u.uat3, u.nume AS uat_nume, p.id_parcela, p.tronson,
       d.nume, d.calitate, d.cota, d.decedat, c.adresa_cunoscuta,
       CASE WHEN a.stare IS DISTINCT FROM 'semnat' AND ac.acoperita_a THEN 'PV_A_ACOPERIT_PARCELA' ELSE CASE o.stare_ordine
         WHEN 1 THEN 'PV_A_SEMNAT' WHEN 2 THEN 'PV_B_CONSTATARE' WHEN 3 THEN 'PV_TRIMIS_SPRE_SEMNARE' WHEN 4 THEN 'OBIECTII_DE_TRATAT'
         WHEN 5 THEN 'A_RASPUNS_FARA_OBIECTII' WHEN 6 THEN 'A_RASPUNS_PARTICIPA' WHEN 7 THEN 'CONVOCARE_RETURNATA' WHEN 8 THEN 'CONVOCAT_FARA_RASPUNS'
         WHEN 9 THEN 'EXPEDIAT_ASTEPTAM_AR' WHEN 10 THEN 'NEIDENTIFICAT_AFISARE' WHEN 11 THEN 'FARA_ADRESA_AFISARE' ELSE 'DE_CONVOCAT' END END AS stare,
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
  CROSS JOIN LATERAL (SELECT public.fn_red_parcela_acoperita_a(p.id) AS acoperita_a) ac
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN a.stare = 'semnat' OR ac.acoperita_a THEN 1
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
CREATE TEMP VIEW pr2_cent_asteptata WITH (security_invoker = on) AS
WITH parcele AS (
  SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.parcela_id,
    CASE WHEN bool_or(v.stare='PV_A_ACOPERIT_PARCELA') THEN 'PV_A_ACOPERIT_PARCELA'
         WHEN bool_and(v.stare='PV_A_SEMNAT') THEN 'PV_A_SEMNAT'
         WHEN bool_or(v.stare='PV_B_CONSTATARE') THEN 'PV_B_CONSTATARE'
         ELSE (array_agg(v.stare ORDER BY v.stare_ordine DESC, v.stare COLLATE "C"))[1] END AS stare
  FROM public.red_v_stare_parcela v
  GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.parcela_id
)
SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare,
       count(*)::int AS numar,
       (sum(count(*)) OVER (PARTITION BY v.uat_id))::int AS total_uat,
       round(100.0 * coalesce(sum(count(*)) FILTER (WHERE v.stare IN ('PV_A_SEMNAT', 'PV_A_ACOPERIT_PARCELA', 'PV_B_CONSTATARE')) OVER (PARTITION BY v.uat_id), 0)
             / sum(count(*)) OVER (PARTITION BY v.uat_id), 1) AS procent_inchise
  FROM parcele v
 GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare;
DO $vederi$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('red_v_stare_parcela','pr2_stare_asteptata'),('red_v_centralizator_uat','pr2_cent_asteptata')) b(v,t) LOOP
    IF pg_get_viewdef(to_regclass('public.'||r.v),true) IS DISTINCT FROM pg_get_viewdef(to_regclass('pg_temp.'||r.t),true)
      OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.'||r.v)
        AND c.reloptions=ARRAY['security_invoker=on'] AND pg_get_userbyid(c.relowner)='postgres'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(c.relacl::text[]) x)
          =ARRAY['authenticated=r/postgres','postgres=arwdDxt/postgres','service_role=r/postgres'])
      OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.v) AND a.attnum>0 AND a.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'PR2: definitie/owner/ACL/security_invoker vedere: %',r.v; END IF;
  END LOOP;
END $vederi$;
CREATE TEMP TABLE pg_temp.pr2_meta ON COMMIT DROP AS
SELECT c.oid, c.relowner,c.relacl,
  (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attcollation,a.attacl) ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS coloane
FROM pg_class c WHERE c.oid IN ('public.red_v_stare_parcela'::regclass,'public.red_v_centralizator_uat'::regclass);

CREATE OR REPLACE VIEW public.red_v_stare_parcela WITH (security_invoker = on) AS
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
CREATE OR REPLACE VIEW public.red_v_centralizator_uat WITH (security_invoker = on) AS
SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare,
       count(*)::int AS numar,
       (sum(count(*)) OVER (PARTITION BY v.uat_id))::int AS total_uat,
       round(100.0 * coalesce(sum(count(*)) FILTER (WHERE v.stare IN ('PV_A_SEMNAT', 'PV_B_CONSTATARE')) OVER (PARTITION BY v.uat_id), 0)
             / sum(count(*)) OVER (PARTITION BY v.uat_id), 1) AS procent_inchise
  FROM public.red_v_stare_parcela v
 GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare;
DROP VIEW pg_temp.pr2_stare_asteptata,pg_temp.pr2_cent_asteptata;
CREATE TEMP VIEW pr2_stare_asteptata WITH (security_invoker = on) AS
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
CREATE TEMP VIEW pr2_cent_asteptata WITH (security_invoker = on) AS
SELECT v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare,
       count(*)::int AS numar,
       (sum(count(*)) OVER (PARTITION BY v.uat_id))::int AS total_uat,
       round(100.0 * coalesce(sum(count(*)) FILTER (WHERE v.stare IN ('PV_A_SEMNAT', 'PV_B_CONSTATARE')) OVER (PARTITION BY v.uat_id), 0)
             / sum(count(*)) OVER (PARTITION BY v.uat_id), 1) AS procent_inchise
  FROM public.red_v_stare_parcela v
 GROUP BY v.proiect_id, v.uat_id, v.uat3, v.uat_nume, v.stare;
DO $vederi$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('red_v_stare_parcela','pr2_stare_asteptata'),('red_v_centralizator_uat','pr2_cent_asteptata')) b(v,t) LOOP
    IF pg_get_viewdef(to_regclass('public.'||r.v),true) IS DISTINCT FROM pg_get_viewdef(to_regclass('pg_temp.'||r.t),true)
      OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.'||r.v)
        AND c.reloptions=ARRAY['security_invoker=on'] AND pg_get_userbyid(c.relowner)='postgres'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(c.relacl::text[]) x)
          =ARRAY['authenticated=r/postgres','postgres=arwdDxt/postgres','service_role=r/postgres'])
      OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.v) AND a.attnum>0 AND a.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'PR2: definitie/owner/ACL/security_invoker vedere: %',r.v; END IF;
  END LOOP;
END $vederi$;
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.pr2_meta m JOIN pg_class c ON c.oid=m.oid
    WHERE c.relowner IS DISTINCT FROM m.relowner OR c.relacl IS DISTINCT FROM m.relacl
      OR c.reloptions IS DISTINCT FROM ARRAY['security_invoker=on']
      OR (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attcollation,a.attacl) ORDER BY a.attnum)
          FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM m.coloane) THEN
    RAISE EXCEPTION 'PR2 post: contract coloane/ordine/ACL/owner schimbat'; END IF;
END $post$;
DROP VIEW pg_temp.pr2_stare_asteptata,pg_temp.pr2_cent_asteptata;
DROP TABLE pg_temp.pr2_meta;
DROP FUNCTION pg_temp.pr2_verifica_baza();
DROP TABLE pg_temp.pr2_functii,pg_temp.pr2_coloane,pg_temp.pr2_tables,pg_temp.pr2_triggers;
COMMENT ON VIEW public.red_v_stare_parcela IS 'Redări: o linie per (parcelă, deținător) activ cu STAREA calculată după ierarhia din contract §3 (1 = PV_A_SEMNAT … 12 = DE_CONVOCAT). adresa_cunoscuta vine din contact (NULL pentru viewer); FARA_ADRESA_AFISARE = contact cu adresa_cunoscuta false SAU fără rând de contact.';
COMMENT ON VIEW public.red_v_centralizator_uat IS 'Redări: numărul de (parcelă, deținător) pe (UAT, stare), totalul UAT-ului și % închise (PV_A_SEMNAT + PV_B_CONSTATARE), repetat pe fiecare rând al UAT-ului.';
