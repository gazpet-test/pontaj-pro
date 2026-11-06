-- Runner: o singură tranzacție. Revenire armată; refuză orice utilizare F2, inclusiv istoric.
DO $pre$
BEGIN
 IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true)
   IS DISTINCT FROM '20261131a_redari_mail_f2_loturi_ROLLBACK:'||txid_current() THEN RAISE EXCEPTION 'F2 rollback: garda start'; END IF;
 PERFORM set_config('lock_timeout','500ms',true);
 LOCK TABLE public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.red_mail_setari IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE public.red_mail_evenimente IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE public.red_mail_loturi,public.red_mail_mesaje,public.red_mail_fisiere_inventar_antet,public.red_mail_fisiere_inventar,public.red_mail_optout,public.red_mail_jurnal_f2 IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.red_mail_loturi) OR EXISTS(SELECT 1 FROM public.red_mail_mesaje)
 OR EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar_antet) OR EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar)
 OR EXISTS(SELECT 1 FROM public.red_mail_optout) OR EXISTS(SELECT 1 FROM public.red_mail_jurnal_f2)
 OR EXISTS(SELECT 1 FROM public.red_mail_evenimente WHERE tip='f2')
 OR EXISTS(SELECT 1 FROM public.red_numere WHERE cheie='M')
 OR EXISTS(SELECT 1 FROM public.red_mail_setari WHERE NOT trimitere_oprita OR extern_permis OR plafon_zi<>200 OR plafon_luna<>1000 OR pauza_pana IS NOT NULL OR ultim_apel_la IS NOT NULL) THEN
  RAISE EXCEPTION 'F2 rollback: exista date/istoric/configuratie; revenirea refuzata';
 END IF;
END $pre$;
ALTER TABLE public.red_mail_evenimente DROP CONSTRAINT red_mail_evenimente_tip_ck;
ALTER TABLE public.red_mail_evenimente ADD CONSTRAINT red_mail_evenimente_tip_ck CHECK (tip IN ('activare', 'ingestie_ok', 'ingestie_neprocesabil', 'deja_golit', 'disparut', 'spam_numarat',
    'dry_rulat', 'recuperare_inceputa', 'recuperare_terminata', 'lease_pierdut', 'eroare_citire', 'descarcare', 'golire', 'blocaj_cerut', 'blocaj_activ',
    'blocaj_ridicat', 'orfane_sterse', 'alerta_de_triat', 'alerta_escaladare', 'oauth_conectat', 'oauth_respins', 'oauth_revocat', 'tombstone_sters',
    'neprocesabil_eliberat', 'eliberare_anulata', 'gmail_trash_inceput', 'gmail_in_cos', 'gmail_trash_ambiguu', 'gmail_de_decis', 'gmail_absent_verificat',
    'gmail_stergere_esuata', 'metoda_nepermisa', 'trash_tardiv', 'alerta_gmail_stergere', 'alerta_dedup_expira', 'tombstone_sters_termen', 'hmac_cheie_retrasa'));
DROP TRIGGER trg_red_mail_f2_canal ON public.red_convocari;
DROP TRIGGER trg_red_mail_f2_lot ON public.red_mail_loturi;
DROP TRIGGER trg_red_mail_f2_mesaj ON public.red_mail_mesaje;
ALTER TABLE public.red_mail_mesaje DROP CONSTRAINT red_mail_f2_snapshot_ck;
DO $drop$
DECLARE f regprocedure; ramas integer; progres boolean;
BEGIN
 LOOP
 progres:=false; ramas:=0;
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND
  (left(p.proname,15)='fn_red_mail_f2_' OR p.proname IN ('fn_red_mail_destinatari','fn_red_mail_lot_creeaza','fn_red_mail_lot_aproba','fn_red_mail_rezerva','fn_red_mail_apel_incepe','fn_red_mail_rezultat','fn_red_mail_lot_inchide','fn_red_mail_lot_goleste','fn_red_mail_lot_sterge_final')) LOOP
  ramas:=ramas+1;
  BEGIN EXECUTE format('DROP FUNCTION %s',f); progres:=true; EXCEPTION WHEN dependent_objects_still_exist THEN NULL; END;
 END LOOP;
 EXIT WHEN ramas=0;
 IF NOT progres THEN RAISE EXCEPTION 'F2 rollback: dependente externe; refuz fara CASCADE'; END IF;
 END LOOP;
END $drop$;
DROP TABLE public.red_mail_fisiere_inventar;
DROP TABLE public.red_mail_fisiere_inventar_antet;
DROP TABLE public.red_mail_mesaje;
DROP TABLE public.red_mail_loturi;
DROP TABLE public.red_mail_optout;
DROP TABLE public.red_mail_jurnal_f2;
ALTER TABLE public.red_mail_setari DROP COLUMN trimitere_oprita,DROP COLUMN extern_permis,DROP COLUMN plafon_zi,DROP COLUMN plafon_luna,DROP COLUMN pauza_pana,DROP COLUMN ultim_apel_la;
DO $post$
BEGIN
 IF to_regclass('public.red_mail_loturi') IS NOT NULL OR to_regprocedure('public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text)') IS NOT NULL THEN RAISE EXCEPTION 'F2 rollback: obiecte ramase'; END IF;
END $post$;
