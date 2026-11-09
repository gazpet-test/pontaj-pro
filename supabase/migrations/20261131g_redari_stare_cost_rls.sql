-- 20261131g_redari_stare_cost_rls.sql — Dashboard / Registru Redări lente ca utilizator logat (PR #1022, cauza găsită după DRY 1).
-- NUMAI fișier; se aplică DOAR prin scripts/livrare_migrare.sh (psql --single-transaction + marcajul gazpet.livrare_migrare),
-- după DRY cu ROLLBACK și „da”-ul lui Răzvan. Fără BEGIN / COMMIT: tranzacția o face runner-ul.
-- DRY (o tranzacție, ROLLBACK la final): scripts/redari_1022b_dry_inainte.sql → această migrare → scripts/redari_1022b_dry.sql.
-- Independentă de 20261131f: nu atinge red_v_centralizator_uat; se poate aplica înainte sau după ea.
-- Cauza (DRY 1, 09.11.2026): ca postgres ~1,2 s, ca utilizator logat ~34 s pe LOT1. Diferența vine din două funcții chemate PE RÂND
--   în red_v_stare_parcela (20261131d) și red_v_tronson (20261130n): fn_red_parcela_acoperita_a (SECURITY INVOKER: politicile tabelelor
--   ei se evaluează din nou la fiecare apel, cu fn_red_nivel() de fiecare dată) și fn_red_adresa_cunoscuta (cu utilizator logat
--   cheamă fn_red_nivel() la fiecare apel). Ca postgres, fără utilizator, niciuna nu ajunge la fn_red_nivel().
-- Ce face (NU schimbă drepturi, politici sau funcții existente; aceleași coloane, același owner / ACL / security_invoker):
--   (1) în red_v_stare_parcela și red_v_tronson, corpul fn_red_parcela_acoperita_a(p.id) din 20261130n e copiat în vedere. Aceleași
--       tabele, același apelant (vederile sunt security_invoker, funcția e INVOKER), același snapshot (funcția e STABLE) ⇒ același
--       rezultat; politicile se evaluează o dată pe interogare. Copia e verificată față de funcție în DRY (L19), iar poarta de mai jos
--       cere corpul exact al funcției (md5): o schimbare a regulii de acoperire se face de acum în funcție ȘI în cele două vederi.
--   (2) ramura FARA_ADRESA_AFISARE: fără utilizator (auth.uid() NULL — căile server) rămâne fn_red_adresa_cunoscuta, exact ca înainte;
--       cu utilizator, fn_red_detinatori_cu_adresa() (nouă, DEFINER, fără parametri) aplică aceeași poartă ca fn_red_adresa_cunoscuta
--       (auth.uid() + fn_red_nivel()) o singură dată pe apel și întoarce deținătorii cu adresă cunoscută; fără drept Redări — nimic.
-- Porți (L15): ÎNAINTE exact definițiile 31d ale celor două vederi, owner / opțiuni / ACL, fără ACL pe coloane, amprenta funcțiilor pe
--   care se sprijină echivalența (fn_red_parcela_acoperita_a, fn_red_adresa_cunoscuta, fn_red_nivel, auth.uid); DUPĂ exact definițiile
--   noi, aceleași coloane / owner / ACL, funcția nouă cu amprenta și ACL-ul așteptate, red_v_centralizator_uat neschimbată.
-- Lock-uri (L01, L06): înaintea verificărilor, în ordinea din 31d (tabelele, vederile, apoi profiles / user_module_access), SHARE ROW
--   EXCLUSIVE pe Redări (oprește scrierile și DDL-ul concurent, nu și citirile), SHARE pe sursele autorizării, lock_timeout 5 s;
--   CREATE OR REPLACE VIEW ia apoi ACCESS EXCLUSIVE doar pe cele două vederi.
-- Baza (L15): allow-list-ul complet din 31d (RLS, politici, ACL, roluri client, sursele autorizării), ÎNAINTE și DUPĂ.
-- ORDINEA REVENIRILOR: dacă se revine 20261131d, întâi revenirea ACESTEI migrări (31g) și a lui 31f, apoi 31d.
-- Revenire: supabase/revenire/20261131g_redari_stare_cost_rls_ROLLBACK.sql.
DO $start$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true)
    IS DISTINCT FROM '20261131g_redari_stare_cost_rls:' || txid_current() THEN RAISE EXCEPTION '20261131g: garda start invalida'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE c LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261131g: armare persistenta refuzata'; END IF;
  IF to_regclass('public.red_v_stare_parcela') IS NULL OR to_regclass('public.red_v_tronson') IS NULL
     OR to_regclass('public.red_v_centralizator_uat') IS NULL THEN RAISE EXCEPTION '20261131g: lipsesc vederile'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_red_detinatori_cu_adresa') THEN
    RAISE EXCEPTION '20261131g: fn_red_detinatori_cu_adresa exista deja (a doua aplicare?)'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  LOCK TABLE public.red_procese_verbale, public.red_parcele, public.red_detinatori, public.red_uat, public.red_detinatori_contact,
    public.red_raspunsuri, public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_v_stare_parcela, public.red_v_centralizator_uat, public.red_v_tronson IN SHARE ROW EXCLUSIVE MODE;
  -- ultimele: sursele autorizării, ca în 31d (SHARE: nimeni nu schimbă drepturile cât rulează verificarea)
  LOCK TABLE public.profiles, public.user_module_access IN SHARE MODE;
END $start$;
DROP VIEW IF EXISTS pg_temp.g31_stare_31d, pg_temp.g31_tronson_31d, pg_temp.g31_stare_31g, pg_temp.g31_tronson_31g;
DROP TABLE IF EXISTS pg_temp.g31_meta;

-- r11 (DRY 2 pe prod: refuz „coloane tabela: red_convocari”): baza = 31d + 31c + 31a, adică migrările Redări aplicate pe prod
-- după 31d și înainte de 31g (ordinea pe prod: 30n, 31d, 31c, 31a, 20261105a, 20261201a; ultimele două nu ating obiectele din listă).
-- Completate din fișierele 31c / 31a de pe main, nu din catalog: coloana 23 + 3 triggere + funcțiile lor (marcate „r11”).
-- Baza RLS / autorizare (L15, review Jakarinos r8 P1): allow-list-ul fix din 20261131d, copiat (prefix g31b_), FĂRĂ verificarea
-- red_v_tronson față de 31d (31g o schimbă; definițiile vederilor au porțile lor). Acoperă: funcțiile lanțului, auth.uid / role / jwt,
-- sursele autorizării (profiles, user_module_access: RLS, ACL, coloane, politici, triggere și funcțiile lor), rolurile client fără
-- SUPERUSER / BYPASSRLS, cele 7 tabele Redări (RLS activ, nu FORCE, owner, ACL pe tabel și pe coloane, coloane exacte, triggere,
-- toate politicile). Verificată ÎNAINTE și DUPĂ. Plus constrângerea pe care se sprijină NOT IN (cheia primară detinator_id).
DROP TABLE IF EXISTS pg_temp.g31b_auth_tabele, pg_temp.g31b_auth_coloane, pg_temp.g31b_auth_politici, pg_temp.g31b_auth_triggere, pg_temp.g31b_auth_functii;
DROP TABLE IF EXISTS pg_temp.g31b_functii, pg_temp.g31b_coloane, pg_temp.g31b_tables, pg_temp.g31b_triggers;
CREATE TEMP TABLE pg_temp.g31b_functii(sig text,corp text,ret text,retset boolean,lang text,definer boolean,vol text,config text[],acl text[]) ON COMMIT DROP;
INSERT INTO pg_temp.g31b_functii VALUES
-- r11: funcțiile triggerelor adăugate de 20261131c / 20261131a pe tabelele din listă (corp = md5 din migrarea de pe main).
('public.fn_red_convocari_utilizatori_garda()','25d8bacd42dff87315904e5833175114','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
('public.fn_red_detinatori_calitate_utilizatori_garda()','0cb7660327cd7b280512c5ae39dc343f','trigger',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
('public.fn_red_mail_f2_fara_convocare_email()','d9e275326b94576ead3861200a715ffb','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
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
-- R4: aceleasi ACL ca fixul #998; trigger-ele interne nu au EXECUTE pentru authenticated.
-- 20261130n_redari_pv_utilizatori.sql
('public.fn_red_pv_b_semnare()','728fc279beee0b34f9adcfb425b2dd9f','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129d_redari_pv_c.sql
('public.fn_red_pv_c_garda()','975e5501b2c9e4ceca85a84b3fd64f3d','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261129d_redari_pv_c.sql
('public.fn_red_pv_c_neacoperite(uuid,integer)','ad42b1c7c1e4be49a2ea99a5eca9e3dd','bigint',false,'plpgsql',true,'v',ARRAY['search_path=public, pg_temp','lock_timeout=5s']::text[],ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20261130n_redari_pv_utilizatori.sql
('public.fn_red_pv_calitate_semnatar()','1976124ce240eb0f04dec22cf8acd862','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres']::text[]),
-- 20261129c_redari_pv_stari.sql
('public.fn_red_pv_stare_tranzitie()','2d69244951387ad650e2b1ed91a19308','trigger',false,'plpgsql',false,'v',ARRAY['search_path=public, pg_temp']::text[],ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
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
CREATE TEMP TABLE pg_temp.g31b_coloane(t text,n int,c text,typ text,acl text[]) ON COMMIT DROP;
INSERT INTO pg_temp.g31b_coloane VALUES
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
-- #1002 adauga ulterior o coloana red_convocari; aici inventarul exact ramane cel de dupa #998.
('red_convocari',22,'retur_detaliu','text',ARRAY[]::text[]),
-- r11: 20261131c (aplicată după 31d) a adăugat coloana 23; fără ACL de coloană.
('red_convocari',23,'calitate_document','text',ARRAY[]::text[]);
CREATE TEMP TABLE pg_temp.g31b_tables(t text,acl text[]) ON COMMIT DROP;
INSERT INTO pg_temp.g31b_tables VALUES
('red_parcele',ARRAY['postgres=DELETE','postgres=INSERT','postgres=MAINTAIN','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_uat',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=MAINTAIN','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_detinatori',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=MAINTAIN','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_detinatori_contact',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=MAINTAIN','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_procese_verbale',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=MAINTAIN','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_raspunsuri',ARRAY['authenticated=SELECT','postgres=DELETE','postgres=INSERT','postgres=MAINTAIN','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]),
('red_convocari',ARRAY['authenticated=INSERT','authenticated=SELECT','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=MAINTAIN','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=INSERT','service_role=SELECT','service_role=UPDATE']::text[]);
CREATE TEMP TABLE pg_temp.g31b_triggers(t text,n text,f text,typ int,e_def boolean,e_init boolean,cols text[]) ON COMMIT DROP;
INSERT INTO pg_temp.g31b_triggers VALUES
-- r11: 20261131c (BEFORE INSERT OR UPDATE = 23; BEFORE UPDATE = 19) și 20261131a (BEFORE INSERT OR UPDATE = 23), fără WHEN / OF / argumente.
('red_convocari','trg_red_convocari_h_utilizatori','public.fn_red_convocari_utilizatori_garda()',23,false,false,ARRAY[]::text[]),
('red_convocari','trg_red_mail_f2_canal','public.fn_red_mail_f2_fara_convocare_email()',23,false,false,ARRAY[]::text[]),
('red_detinatori','trg_red_detinatori_calitate_utilizatori','public.fn_red_detinatori_calitate_utilizatori_garda()',19,false,false,ARRAY[]::text[]),
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
-- R2 baseline extern de autorizare: 20261003d (RLS/owner, toate politicile de scriere),
-- sec_f2_setari_schelet (SELECT din live 05.10), SEC F1 (ACL fara TRUNCATE la anon/authenticated).
-- Manifest fix; o abatere necesita review, nu acceptare automata a catalogului curent.
CREATE TEMP TABLE pg_temp.g31b_auth_tabele(t text PRIMARY KEY,acl text[]) ON COMMIT DROP;
INSERT INTO pg_temp.g31b_auth_tabele VALUES
('profiles',ARRAY['anon=DELETE','anon=INSERT','anon=REFERENCES','anon=SELECT','anon=TRIGGER','anon=UPDATE','authenticated=DELETE','authenticated=INSERT','authenticated=REFERENCES','authenticated=SELECT','authenticated=TRIGGER','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=MAINTAIN','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=DELETE','service_role=INSERT','service_role=MAINTAIN','service_role=REFERENCES','service_role=SELECT','service_role=TRIGGER','service_role=TRUNCATE','service_role=UPDATE']::text[]),
('user_module_access',ARRAY['anon=DELETE','anon=INSERT','anon=REFERENCES','anon=SELECT','anon=TRIGGER','anon=UPDATE','authenticated=DELETE','authenticated=INSERT','authenticated=REFERENCES','authenticated=SELECT','authenticated=TRIGGER','authenticated=UPDATE','postgres=DELETE','postgres=INSERT','postgres=MAINTAIN','postgres=REFERENCES','postgres=SELECT','postgres=TRIGGER','postgres=TRUNCATE','postgres=UPDATE','service_role=DELETE','service_role=INSERT','service_role=MAINTAIN','service_role=REFERENCES','service_role=SELECT','service_role=TRIGGER','service_role=TRUNCATE','service_role=UPDATE']::text[]);
CREATE TEMP TABLE pg_temp.g31b_auth_coloane(t text,c text,typ text) ON COMMIT DROP;
INSERT INTO pg_temp.g31b_auth_coloane VALUES
 ('profiles','id','uuid'),('profiles','is_owner','boolean'),
 ('user_module_access','profile_id','uuid'),('user_module_access','module','text'),('user_module_access','access_level','text');
CREATE TEMP TABLE pg_temp.g31b_auth_politici(t text,n text,cmd text,q text,w text) ON COMMIT DROP;
INSERT INTO pg_temp.g31b_auth_politici VALUES
 ('profiles','profiles_select_all_authenticated','r','b326b5062b2f0e69046810717534cb09','<NULL>'),
 ('profiles','profiles_delete_owner','d','c820f31f788833db3c8d7830979c8803','<NULL>'),
 ('profiles','profiles_insert_owner','a','<NULL>','c820f31f788833db3c8d7830979c8803'),
 ('profiles','profiles_update_own','w','bc9c729a84690340789a4e4f01175335','bc9c729a84690340789a4e4f01175335'),
 ('profiles','profiles_update_owner','w','c820f31f788833db3c8d7830979c8803','c820f31f788833db3c8d7830979c8803'),
 ('user_module_access','user_module_access_select_authenticated','r','b326b5062b2f0e69046810717534cb09','<NULL>'),
 ('user_module_access','user_module_access_delete_owner','d','8d156f05d1916a18e703d322295e7715','<NULL>'),
 ('user_module_access','user_module_access_insert_owner','a','<NULL>','8d156f05d1916a18e703d322295e7715'),
 ('user_module_access','user_module_access_update_owner','w','8d156f05d1916a18e703d322295e7715','8d156f05d1916a18e703d322295e7715');
-- R3: inventar fix al surselor de autorizare. Cele 5 triggere profiles, 0 user_module_access.
-- Model: 20261003d:96 + SEC F2; protectia legaturii si callees din 20260929c.
-- Corpurile S-A / prevent_role sunt confirmate si de captura versionata E3 baseline_pre_e3.json.
CREATE TEMP TABLE pg_temp.g31b_auth_triggere(t text,n text,f text) ON COMMIT DROP;
INSERT INTO pg_temp.g31b_auth_triggere VALUES
 ('profiles','prevent_role_escalation_trigger','public.prevent_role_escalation()'),
 ('profiles','trg_enforce_owner_only_salary_flags','public.enforce_owner_only_salary_flags()'),
 ('profiles','trg_profiles_campuri_owner_only','public.fn_profiles_campuri_owner_only()'),
 ('profiles','trg_profiles_protectie_legatura','public.fn_profiles_protectie_legatura()'),
 ('profiles','trg_protect_can_access_pontaj_brut','public.protect_can_access_pontaj_brut()');
CREATE TEMP TABLE pg_temp.g31b_auth_functii(sig text,corp text,ret text,acl text[]) ON COMMIT DROP;
INSERT INTO pg_temp.g31b_auth_functii VALUES
-- 20260930j_sec_f2_profiles_uid_null.sql
('public.prevent_role_escalation()','cf75b37d522e2a6b0b9c9eabd72c27b4','trigger',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20260930j_sec_f2_profiles_uid_null.sql
('public.enforce_owner_only_salary_flags()','daaa561298c10c259944600e6c39467e','trigger',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20260930j_sec_f2_profiles_uid_null.sql
('public.protect_can_access_pontaj_brut()','2eec050b53f37ec995da79e93a2a4686','trigger',ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]),
-- 20260930a_profiles_campuri_owner_only_extins.sql
('public.fn_profiles_campuri_owner_only()','1114af39c13e295dd2ab666dab495567','trigger',ARRAY['postgres=X/postgres']::text[]),
-- 20260929c_conturi_legare_automata.sql
('public.fn_profiles_protectie_legatura()','0908c8b0c23fd1cb16b16a5764a2d1ba','trigger',ARRAY['postgres=X/postgres']::text[]),
-- 20260929c_conturi_legare_automata.sql
('public.fn_identitate_privilegiata()','13b245513eed1f7f3848ce4edbcec383','text',ARRAY['postgres=X/postgres']::text[]),
-- 20260929c_conturi_legare_automata.sql
('public.fn_identitate_eticheta()','876a28f98d4f4aee76a0580dab4ecc51','text',ARRAY['postgres=X/postgres']::text[]),
-- 20260929c_conturi_legare_automata.sql
('public.fn_identitate_claims()','38ae236ba115299721c020bdcfbeeb16','record',ARRAY['postgres=X/postgres']::text[]);
-- L15: allow-list fixe din migrarile versionate; NU invatam amprente din catalogul curent.
CREATE OR REPLACE FUNCTION pg_temp.g31b_verifica_baza() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $baza$
DECLARE r record; v text[]; n int;
BEGIN
  FOR r IN SELECT * FROM pg_temp.g31b_functii LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid=to_regprocedure(r.sig) AND md5(p.prosrc)=r.corp AND l.lanname=r.lang AND p.prorettype=to_regtype(r.ret) AND p.proretset=r.retset
        AND p.prosecdef=r.definer AND p.provolatile::text=r.vol AND p.proconfig=r.config
        AND pg_get_userbyid(p.proowner)='postgres'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)=r.acl) THEN
      RAISE EXCEPTION '20261131g (baza): functie in afara baseline revizuit: %',r.sig;
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
      RAISE EXCEPTION '20261131g (baza): callee auth in afara baseline: %',r.sig; END IF;
  END LOOP;
  -- R2 / L15: fn_red_nivel -> profiles / user_module_access. Proiectia citita are 5 coloane.
  -- Restul campurilor de profil apartin altor module; orice ACL de coloana, inclusiv pe ele, este refuzat.
  FOR r IN SELECT * FROM pg_temp.g31b_auth_tabele LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.'||r.t) AND c.relkind='r'
      AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
      AND (SELECT array_agg(pg_get_userbyid(a.grantee)||'='||a.privilege_type ORDER BY (pg_get_userbyid(a.grantee)||'='||a.privilege_type) COLLATE "C")
        FROM aclexplode(c.relacl) a WHERE a.grantor='postgres'::regrole AND NOT a.is_grantable)=r.acl
      AND NOT EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantor<>'postgres'::regrole OR a.is_grantable)
      AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid)) THEN
      RAISE EXCEPTION '20261131g (baza): sursa autorizare RLS/owner/ACL: %',r.t; END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp.g31b_auth_coloane LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.t)
      AND a.attname=r.c AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid=to_regtype(r.typ)
      AND a.atttypmod=-1 AND a.attcollation=(SELECT typcollation FROM pg_type WHERE oid=a.atttypid) AND a.attacl IS NULL) THEN
      RAISE EXCEPTION '20261131g (baza): coloana sursa autorizare: %.%',r.t,r.c; END IF;
  END LOOP;
  -- Politicile SELECT sunt incluse: true nu este echivalat cu NULL, care ar fi o alta politica.
  IF (SELECT count(*) FROM pg_policy p JOIN pg_temp.g31b_auth_tabele b ON p.polrelid=to_regclass('public.'||b.t))
    <> (SELECT count(*) FROM pg_temp.g31b_auth_politici) THEN RAISE EXCEPTION '20261131g (baza): inventar politici autorizare'; END IF;
  FOR r IN SELECT * FROM pg_temp.g31b_auth_politici LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=to_regclass('public.'||r.t) AND p.polname=r.n
      AND p.polcmd::text=r.cmd AND p.polpermissive AND p.polroles=ARRAY['authenticated'::regrole::oid]
      AND coalesce(md5(pg_get_expr(p.polqual,p.polrelid)),'<NULL>')=r.q
      AND coalesce(md5(pg_get_expr(p.polwithcheck,p.polrelid)),'<NULL>')=r.w) THEN
      RAISE EXCEPTION '20261131g (baza): politica autorizare: %.%',r.t,r.n; END IF;
  END LOOP;
  -- R3: nu ajunge RLS profiles_update_own; is_owner este protejat de triggere.
  -- Exact toate triggerele non-interne pe ambele surse: lipsa/extra = refuz (inclusiv UMA, asteptat 0).
  IF EXISTS (SELECT 1 FROM pg_temp.g31b_auth_tabele b WHERE
      (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||b.t) AND NOT t.tgisinternal)
        <> (SELECT count(*) FROM pg_temp.g31b_auth_triggere a WHERE a.t=b.t)) THEN
    RAISE EXCEPTION '20261131g (baza): inventar triggere autorizare'; END IF;
  FOR r IN SELECT * FROM pg_temp.g31b_auth_triggere LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||r.t)
      AND t.tgname=r.n AND t.tgfoid=to_regprocedure(r.f) AND t.tgenabled='O' AND t.tgtype=19
      AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0
      AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgconstraint=0 AND t.tgconstrrelid=0 AND t.tgconstrindid=0 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL) THEN
      RAISE EXCEPTION '20261131g (baza): trigger autorizare: %.%',r.t,r.n; END IF;
  END LOOP;
  -- Lant inchis: triggere -> fn_identitate_privilegiata/eticheta -> fn_identitate_claims.
  -- Celelalte triggere apeleaza auth.uid(), deja amprentata mai sus. Nu urmam un callee necunoscut din live.
  -- Corpuri exacte din surse revizuite exclud EXECUTE dinamic; niciun search_path mostenit.
  FOR r IN SELECT * FROM pg_temp.g31b_auth_functii LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid=to_regprocedure(r.sig) AND md5(p.prosrc)=r.corp AND l.lanname='plpgsql'
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=public, pg_temp'] AND p.prorettype=to_regtype(r.ret)
      AND NOT p.proretset AND p.pronargs=0 AND p.provariadic=0
      AND p.proargtypes=''::oidvector AND p.proargdefaults IS NULL
      AND p.proargnames IS NOT DISTINCT FROM CASE WHEN r.sig='public.fn_identitate_claims()' THEN ARRAY['rol','sub']::text[] END
      AND p.proargmodes IS NOT DISTINCT FROM CASE WHEN r.sig='public.fn_identitate_claims()' THEN ARRAY['o','o']::"char"[] END
      AND p.proallargtypes IS NOT DISTINCT FROM CASE WHEN r.sig='public.fn_identitate_claims()' THEN ARRAY['text'::regtype::oid,'text'::regtype::oid] END
      AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)=r.acl) THEN
      RAISE EXCEPTION '20261131g (baza): functie autorizare in afara baseline: %',r.sig; END IF;
  END LOOP;
  -- RLS ar fi inert daca rolurile client ar deveni SUPERUSER / BYPASSRLS.
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated') AND NOT rolsuper AND NOT rolbypassrls)<>2 THEN
    RAISE EXCEPTION '20261131g (baza): roluri client ocolesc RLS'; END IF;
  FOR r IN SELECT * FROM pg_temp.g31b_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.'||r.t)
        AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='postgres'
        AND (SELECT array_agg(pg_get_userbyid(a.grantee)||'='||a.privilege_type ORDER BY (pg_get_userbyid(a.grantee)||'='||a.privilege_type) COLLATE "C")
             FROM aclexplode(c.relacl) a WHERE a.grantor='postgres'::regrole AND NOT a.is_grantable)=r.acl
        AND NOT EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantor<>'postgres'::regrole OR a.is_grantable)) THEN
      RAISE EXCEPTION '20261131g (baza): RLS/owner/ACL tabela: %',r.t; END IF;
    SELECT count(*) INTO n FROM pg_attribute WHERE attrelid=to_regclass('public.'||r.t) AND attnum>0 AND NOT attisdropped;
    IF n<>(SELECT count(*) FROM pg_temp.g31b_coloane WHERE t=r.t) THEN RAISE EXCEPTION '20261131g (baza): coloane tabela: %',r.t; END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp.g31b_coloane LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.t)
      AND a.attnum=r.n AND a.attname=r.c AND NOT a.attisdropped AND a.atttypid=to_regtype(r.typ) AND a.atttypmod=-1 AND a.attcollation=(SELECT typcollation FROM pg_type WHERE oid=a.atttypid)
      AND coalesce((SELECT array_agg(pg_get_userbyid(x.grantee)||'='||x.privilege_type ORDER BY (pg_get_userbyid(x.grantee)||'='||x.privilege_type) COLLATE "C")
                    FROM aclexplode(a.attacl) x WHERE x.grantor='postgres'::regrole AND NOT x.is_grantable),ARRAY[]::text[])=r.acl
      AND NOT EXISTS (SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantor<>'postgres'::regrole OR x.is_grantable)) THEN
      RAISE EXCEPTION '20261131g (baza): coloana/ACL: %.%',r.t,r.c; END IF;
  END LOOP;
  -- Inventar complet, inclusiv UPDATE OF, WHEN si starea de activare.
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_temp.g31b_tables b ON t.tgrelid=to_regclass('public.'||b.t) WHERE NOT t.tgisinternal)
      <> (SELECT count(*) FROM pg_temp.g31b_triggers) THEN RAISE EXCEPTION '20261131g (baza): inventar triggere'; END IF;
  FOR r IN SELECT * FROM pg_temp.g31b_triggers LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.'||r.t) AND t.tgname=r.n
      AND t.tgfoid=to_regprocedure(r.f) AND t.tgenabled='O' AND t.tgtype=r.typ AND (CASE WHEN r.n='trg_red_raspunsuri_mail_sursa' THEN
        pg_get_triggerdef(t.oid) = 'CREATE CONSTRAINT TRIGGER trg_red_raspunsuri_mail_sursa AFTER INSERT ON public.red_raspunsuri DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.canal = ''email''::text)) EXECUTE FUNCTION fn_red_mail_raspuns_sursa_ceruta()'
        ELSE t.tgqual IS NULL END)
      AND t.tgnargs=0 AND NOT t.tgisinternal AND t.tgdeferrable=r.e_def AND t.tginitdeferred=r.e_init
      AND ARRAY(SELECT a.attname::text FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY x(num,ord)
                JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=x.num ORDER BY x.ord)=r.cols) THEN
      RAISE EXCEPTION '20261131g (baza): trigger: %.%',r.t,r.n; END IF;
  END LOOP;
  -- Toate politicile, inclusiv cele de scriere; NULL qual este comparat explicit, nu acceptat ca restrictie.
  IF (SELECT count(*) FROM pg_policies p JOIN pg_temp.g31b_tables b ON b.t=p.tablename WHERE p.schemaname='public')<>21 THEN
    RAISE EXCEPTION '20261131g (baza): inventar politici'; END IF;
  FOR r IN SELECT p.* FROM pg_policies p JOIN pg_temp.g31b_tables b ON b.t=p.tablename WHERE p.schemaname='public' LOOP
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
        OR r.with_check IS DISTINCT FROM r.qual)) THEN RAISE EXCEPTION '20261131g (baza): politica: %',r.policyname; END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_sequence s ON s.seqrelid=c.oid
    WHERE c.oid='public.red_raspunsuri_seq_seq'::regclass AND pg_get_userbyid(c.relowner)='postgres'
      AND s.seqtypid='bigint'::regtype AND s.seqincrement=1 AND NOT s.seqcycle AND s.seqstart=1 AND s.seqmin=1 AND s.seqmax=9223372036854775807 AND s.seqcache=1
      AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(c.relacl::text[]) x)
          =ARRAY['authenticated=U/postgres','postgres=rwU/postgres','service_role=U/postgres']) THEN
    RAISE EXCEPTION '20261131g (baza): secventa/ACL raspunsuri'; END IF;
END $baza$;
REVOKE ALL ON FUNCTION pg_temp.g31b_verifica_baza() FROM PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.g31b_verifica_notin() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $notin$
BEGIN
  -- NOT IN pe lista din fn_red_detinatori_cu_adresa() e echivalent cu funcția veche doar dacă lista nu poate conține NULL
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.conrelid = 'public.red_detinatori_contact'::regclass AND k.contype = 'p' AND cardinality(k.conkey) = 1
        AND a.attname = 'detinator_id' AND a.attnotnull AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype) THEN
    RAISE EXCEPTION '20261131g (baza): red_detinatori_contact.detinator_id nu e cheie primara uuid NOT NULL — refuz'; END IF;
END $notin$;
REVOKE ALL ON FUNCTION pg_temp.g31b_verifica_notin() FROM PUBLIC;

-- definițiile de plecare, exact ca în 20261131d (red_v_stare_parcela) și 20261130n (red_v_tronson, verificată și de 31d)
CREATE TEMP VIEW g31_stare_31d AS
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
CREATE TEMP VIEW g31_tronson_31d AS
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
-- instantaneul metadatelor (owner, ACL, opțiuni, coloane; definiția centralizatorului) — comparat la final
CREATE TEMP TABLE g31_meta ON COMMIT DROP AS
SELECT c.oid, c.relowner, c.relacl, c.reloptions,
       (SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod, a.attcollation, a.attacl) ORDER BY a.attnum)
          FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS coloane,
       CASE WHEN c.oid = 'public.red_v_centralizator_uat'::regclass THEN pg_get_viewdef(c.oid, true) END AS definitie
  FROM pg_class c WHERE c.oid IN ('public.red_v_stare_parcela'::regclass, 'public.red_v_tronson'::regclass, 'public.red_v_centralizator_uat'::regclass);

DO $poarta_inainte$
DECLARE r record;
BEGIN
  PERFORM pg_temp.g31b_verifica_baza();
  PERFORM pg_temp.g31b_verifica_notin();
  IF pg_get_viewdef('public.red_v_stare_parcela'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31_stare_31d'::regclass, true)
     OR pg_get_viewdef('public.red_v_tronson'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31_tronson_31d'::regclass, true) THEN
    RAISE EXCEPTION '20261131g (inainte): red_v_stare_parcela / red_v_tronson nu au definitiile din 31d — refuz'; END IF;
  -- cele trei vederi: owner, security_invoker, ACL exact, fără ACL pe coloane (ca în porțile 31c / 31d / 31f)
  IF (SELECT count(*) FROM pg_class c WHERE c.oid IN ('public.red_v_stare_parcela'::regclass, 'public.red_v_tronson'::regclass, 'public.red_v_centralizator_uat'::regclass)
        AND c.relkind = 'v' AND pg_get_userbyid(c.relowner) = 'postgres' AND c.reloptions = ARRAY['security_invoker=on']::text[]
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(c.relacl::text[]) x)
          = ARRAY['authenticated=r/postgres','postgres=arwdDxtm/postgres','service_role=r/postgres']::text[]
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND a.attacl IS NOT NULL)) <> 3 THEN
    RAISE EXCEPTION '20261131g (inainte): owner / optiuni / ACL vederi neasteptate — refuz'; END IF;
  -- L15: funcțiile pe care se sprijină echivalența, cu amprentele din 20261131d (corp, limbaj, tip, definer, volatilitate, search_path, owner, ACL)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_red_parcela_acoperita_a(uuid)', 'b932aaf307761d3c504608a30c117bca', 'boolean', false),
      ('public.fn_red_adresa_cunoscuta(uuid)', '55cb31fc3f291cb27bea16a2b9291146', 'boolean', true),
      ('public.fn_red_nivel()', '21db8e5d4b69b7f19e571a7087c361ae', 'text', true)) b(sig, corp, ret, definer) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = to_regprocedure(r.sig) AND md5(p.prosrc) = r.corp AND l.lanname = 'sql' AND p.prorettype = to_regtype(r.ret)
          AND NOT p.proretset AND p.prosecdef = r.definer AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
          AND pg_get_userbyid(p.proowner) = 'postgres'
          AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)
            = ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]) THEN
      RAISE EXCEPTION '20261131g (inainte): functie in afara baseline revizuit: %', r.sig; END IF;
  END LOOP;
  -- auth.uid(): apelat de vedere și de funcția nouă (amprenta din 20261131d)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('auth.uid()') AND md5(p.prosrc) = 'cdef18c69c4f4cbbced2eaf81e628b49' AND l.lanname = 'sql'
        AND NOT p.prosecdef AND p.provolatile = 's' AND p.proconfig IS NULL AND NOT p.proretset AND p.prorettype = 'uuid'::regtype
        AND pg_get_userbyid(p.proowner) = 'supabase_auth_admin'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)
          = ARRAY['=X/supabase_auth_admin','dashboard_user=X/supabase_auth_admin','supabase_auth_admin=X/supabase_auth_admin']::text[]) THEN
    RAISE EXCEPTION '20261131g (inainte): auth.uid in afara baseline revizuit'; END IF;
END $poarta_inainte$;

-- (2) aceeași poartă ca fn_red_adresa_cunoscuta (20261126a), o singură dată pe apel, nu pe rând; fără parametri (identitatea = auth.uid())
CREATE FUNCTION public.fn_red_detinatori_cu_adresa() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT c.detinator_id FROM public.red_detinatori_contact c
   WHERE c.adresa_cunoscuta IS TRUE
     AND (SELECT auth.uid() IS NOT NULL AND public.fn_red_nivel() IS NOT NULL);
$fn$;
REVOKE ALL ON FUNCTION public.fn_red_detinatori_cu_adresa() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_detinatori_cu_adresa() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_red_detinatori_cu_adresa() IS 'Redari: id-urile detinatorilor cu adresa cunoscuta, doar pentru utilizatorul logat cu drept Redari (auth.uid + fn_red_nivel, aceeasi poarta ca fn_red_adresa_cunoscuta), evaluata o data pe apel; altfel nimic. Folosita de red_v_stare_parcela (ramura FARA_ADRESA_AFISARE). Vederile red_v_stare_parcela / red_v_tronson contin si o copie a corpului fn_red_parcela_acoperita_a (20261131g): regula se schimba in toate trei.';

-- (1) + (2): aceleași 20 de coloane, în aceeași ordine
CREATE OR REPLACE VIEW public.red_v_stare_parcela WITH (security_invoker = on) AS
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
  -- = fn_red_parcela_acoperita_a(p.id): corpul din 20261130n, cu p_parcela = p.id (alias-uri a1 / d1 / d2 / a2)
  CROSS JOIN LATERAL (SELECT (
    EXISTS (SELECT 1 FROM public.red_procese_verbale a1
             WHERE a1.parcela_id = p.id AND a1.tip = 'A' AND a1.stare = 'semnat' AND a1.sters_la IS NULL
               AND a1.calitate_semnatar IN ('utilizator', 'arendas'))
    OR (EXISTS (SELECT 1 FROM public.red_detinatori d1 WHERE d1.parcela_id = p.id AND d1.sters_la IS NULL
                  AND d1.calitate NOT IN ('utilizator', 'arendas'))
        AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d2 WHERE d2.parcela_id = p.id AND d2.sters_la IS NULL
                  AND d2.calitate NOT IN ('utilizator', 'arendas')
                  AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a2 WHERE a2.parcela_id = p.id
                        AND a2.detinator_id = d2.id AND a2.tip = 'A' AND a2.stare = 'semnat' AND a2.sters_la IS NULL)))
  ) AS acoperita_a) ac
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
      -- = coalesce(fn_red_adresa_cunoscuta(d.id), false) = false: fără utilizator funcția veche (nu cheamă fn_red_nivel);
      --   cu utilizator, aceeași poartă evaluată o dată (lista e goală fără drept Redări, ca NULL-ul funcției vechi)
      WHEN CASE WHEN (SELECT auth.uid()) IS NULL THEN coalesce(public.fn_red_adresa_cunoscuta(d.id), false) = false
                ELSE d.id NOT IN (SELECT x.detinator_id FROM public.fn_red_detinatori_cu_adresa() x(detinator_id)) END THEN 11
      ELSE 12 END AS stare_ordine) o
 WHERE p.sters_la IS NULL;

-- (1) aceleași 11 coloane, în aceeași ordine
CREATE OR REPLACE VIEW public.red_v_tronson WITH (security_invoker = on) AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       -- = fn_red_parcela_acoperita_a(p.id) IS TRUE: corpul din 20261130n, cu p_parcela = p.id
       CASE WHEN (EXISTS (SELECT 1 FROM public.red_procese_verbale a1
                           WHERE a1.parcela_id = p.id AND a1.tip = 'A' AND a1.stare = 'semnat' AND a1.sters_la IS NULL
                             AND a1.calitate_semnatar IN ('utilizator', 'arendas'))
                  OR (EXISTS (SELECT 1 FROM public.red_detinatori d1 WHERE d1.parcela_id = p.id AND d1.sters_la IS NULL
                                AND d1.calitate NOT IN ('utilizator', 'arendas'))
                      AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d2 WHERE d2.parcela_id = p.id AND d2.sters_la IS NULL
                                AND d2.calitate NOT IN ('utilizator', 'arendas')
                                AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a2 WHERE a2.parcela_id = p.id
                                      AND a2.detinator_id = d2.id AND a2.tip = 'A' AND a2.stare = 'semnat' AND a2.sters_la IS NULL)))) IS TRUE THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;

-- definițiile așteptate DUPĂ (aceleași texte ca mai sus, trecute prin același deparser)
CREATE TEMP VIEW g31_stare_31g AS
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
           coalesce(bool_or(cv.retur IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.red_convocari c2
              WHERE c2.detinator_id = d.id AND c2.stare = 'activ' AND c2.sters_la IS NULL AND c2.data_confirmare_primire IS NOT NULL
                AND (coalesce(cv.retur_data, cv.data_expediere) IS NULL OR c2.data_confirmare_primire >= coalesce(cv.retur_data, cv.data_expediere)))), false) AS returnata,
           coalesce(bool_or(cv.data_confirmare_primire IS NOT NULL), false) AS confirmata,
           coalesce(bool_or(cv.data_expediere IS NOT NULL AND cv.data_confirmare_primire IS NULL AND cv.retur IS NULL), false) AS expediata
      FROM public.red_convocari cv WHERE cv.detinator_id = d.id AND cv.stare = 'activ' AND cv.sters_la IS NULL) k
  CROSS JOIN LATERAL (SELECT (
    EXISTS (SELECT 1 FROM public.red_procese_verbale a1
             WHERE a1.parcela_id = p.id AND a1.tip = 'A' AND a1.stare = 'semnat' AND a1.sters_la IS NULL
               AND a1.calitate_semnatar IN ('utilizator', 'arendas'))
    OR (EXISTS (SELECT 1 FROM public.red_detinatori d1 WHERE d1.parcela_id = p.id AND d1.sters_la IS NULL
                  AND d1.calitate NOT IN ('utilizator', 'arendas'))
        AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d2 WHERE d2.parcela_id = p.id AND d2.sters_la IS NULL
                  AND d2.calitate NOT IN ('utilizator', 'arendas')
                  AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a2 WHERE a2.parcela_id = p.id
                        AND a2.detinator_id = d2.id AND a2.tip = 'A' AND a2.stare = 'semnat' AND a2.sters_la IS NULL)))
  ) AS acoperita_a) ac
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
      WHEN CASE WHEN (SELECT auth.uid()) IS NULL THEN coalesce(public.fn_red_adresa_cunoscuta(d.id), false) = false
                ELSE d.id NOT IN (SELECT x.detinator_id FROM public.fn_red_detinatori_cu_adresa() x(detinator_id)) END THEN 11
      ELSE 12 END AS stare_ordine) o
 WHERE p.sters_la IS NULL;
CREATE TEMP VIEW g31_tronson_31g AS
SELECT p.proiect_id, p.tronson, p.uat_id, u.uat3, p.id AS parcela_id, p.id_parcela, p.suprafata_temporara_mp, p.articol_deviz, p.cantitate,
       CASE WHEN (EXISTS (SELECT 1 FROM public.red_procese_verbale a1
                           WHERE a1.parcela_id = p.id AND a1.tip = 'A' AND a1.stare = 'semnat' AND a1.sters_la IS NULL
                             AND a1.calitate_semnatar IN ('utilizator', 'arendas'))
                  OR (EXISTS (SELECT 1 FROM public.red_detinatori d1 WHERE d1.parcela_id = p.id AND d1.sters_la IS NULL
                                AND d1.calitate NOT IN ('utilizator', 'arendas'))
                      AND NOT EXISTS (SELECT 1 FROM public.red_detinatori d2 WHERE d2.parcela_id = p.id AND d2.sters_la IS NULL
                                AND d2.calitate NOT IN ('utilizator', 'arendas')
                                AND NOT EXISTS (SELECT 1 FROM public.red_procese_verbale a2 WHERE a2.parcela_id = p.id
                                      AND a2.detinator_id = d2.id AND a2.tip = 'A' AND a2.stare = 'semnat' AND a2.sters_la IS NULL)))) IS TRUE THEN 'A'
            WHEN EXISTS (SELECT 1 FROM public.red_procese_verbale pb WHERE pb.parcela_id = p.id AND pb.tip = 'B' AND pb.stare <> 'anulat' AND pb.sters_la IS NULL) THEN 'B'
       END AS tip_pv,
       (EXISTS (SELECT 1 FROM public.red_v_stare_parcela s WHERE s.parcela_id = p.id AND s.stare = 'OBIECTII_DE_TRATAT')
        OR EXISTS (SELECT 1 FROM public.red_procese_verbale px WHERE px.parcela_id = p.id AND px.sters_la IS NULL AND px.stare <> 'anulat'
                      AND px.obiectii_redare AND px.remediat_la IS NULL)) AS obiectii_deschise
  FROM public.red_parcele p
  JOIN public.red_uat u ON u.id = p.uat_id
 WHERE p.sters_la IS NULL;

DO $poarta_dupa$
BEGIN
  PERFORM pg_temp.g31b_verifica_baza();
  PERFORM pg_temp.g31b_verifica_notin();
  IF pg_get_viewdef('public.red_v_stare_parcela'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31_stare_31g'::regclass, true)
     OR pg_get_viewdef('public.red_v_tronson'::regclass, true) IS DISTINCT FROM pg_get_viewdef('pg_temp.g31_tronson_31g'::regclass, true) THEN
    RAISE EXCEPTION '20261131g (dupa): definitiile noi nu sunt cele asteptate — refuz'; END IF;
  -- aceleași coloane / owner / ACL / opțiuni pe cele trei vederi; centralizatorul neschimbat
  IF EXISTS (SELECT 1 FROM pg_temp.g31_meta m JOIN pg_class c ON c.oid = m.oid
      WHERE c.relowner IS DISTINCT FROM m.relowner OR c.relacl IS DISTINCT FROM m.relacl OR c.reloptions IS DISTINCT FROM m.reloptions
        OR (SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod, a.attcollation, a.attacl) ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) IS DISTINCT FROM m.coloane
        OR (m.definitie IS NOT NULL AND pg_get_viewdef(c.oid, true) IS DISTINCT FROM m.definitie))
     OR (SELECT count(*) FROM pg_temp.g31_meta) <> 3 THEN
    RAISE EXCEPTION '20261131g (dupa): coloane / owner / ACL / optiuni / centralizator schimbate — refuz'; END IF;
  -- funcția nouă: corp exact, SETOF uuid, DEFINER, STABLE, search_path fix, owner postgres, EXECUTE doar authenticated + service_role
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure('public.fn_red_detinatori_cu_adresa()') AND md5(p.prosrc) = '0a4973184a6955c00038bcee7818ac4f'
        AND l.lanname = 'sql' AND p.prorettype = 'uuid'::regtype AND p.proretset AND p.prosecdef AND p.provolatile = 's'
        AND NOT p.proleakproof AND NOT p.proisstrict AND p.pronargs = 0
        AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(p.proowner) = 'postgres'
        AND (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)
          = ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[])
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_red_detinatori_cu_adresa') <> 1 THEN
    RAISE EXCEPTION '20261131g (dupa): fn_red_detinatori_cu_adresa nu are amprenta / ACL-ul asteptate — refuz'; END IF;
END $poarta_dupa$;
-- obiectele temporare de comparație nu rămân în sesiune după tranzacție
DROP VIEW pg_temp.g31_tronson_31g, pg_temp.g31_stare_31g, pg_temp.g31_tronson_31d, pg_temp.g31_stare_31d;
DROP TABLE pg_temp.g31_meta;
DROP FUNCTION pg_temp.g31b_verifica_baza(), pg_temp.g31b_verifica_notin();
DROP TABLE pg_temp.g31b_auth_tabele, pg_temp.g31b_auth_coloane, pg_temp.g31b_auth_politici, pg_temp.g31b_auth_triggere, pg_temp.g31b_auth_functii,
  pg_temp.g31b_functii, pg_temp.g31b_coloane, pg_temp.g31b_tables, pg_temp.g31b_triggers;
