-- GENERAT de gen_e3b.py. Revenire piesa A, înainte de revenirea E3.
-- BEGIN; SELECT set_config('gazpet.revenire_20261106a','IZO_E3B_SCOATE:' || txid_current(),true);
-- <fișierul>; COMMIT; metadata runner-ului se gestionează separat.
DO $revenire$
DECLARE v_amprenta text; v_scrisa text; v_inainte text; v_comentariu text; v_lipsa text[];
  v_impl text[]; v_impl_rev text[]; v_porti text; v_porti_e3 text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261106a',true)
      IS DISTINCT FROM 'IZO_E3B_SCOATE:' || txid_current() THEN RAISE EXCEPTION 'Revenire E3b: nearmată sau rol incorect'; END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'Revenire E3b: READ COMMITTED'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  IF to_regclass('public.izo_corectii') IS NULL THEN RAISE EXCEPTION 'Revenire E3b: E3b nu este aplicată'; END IF;
  LOCK TABLE public.izo_corectii,public.izo_corectii_bucati,public.izo_documente_istoric,
    public.izo_documente_intrare,public.magazie_bucati,public.magazie_bucati_evenimente,public.magazie_bucati_miscari IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.izo_corectii) OR EXISTS (SELECT 1 FROM public.izo_corectii_bucati)
     OR EXISTS (SELECT 1 FROM public.izo_documente_istoric)
     OR EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip='izo_corectie' OR tip IN ('carantina_intrare','carantina_iesire','storno_partial'))
     OR EXISTS (SELECT 1 FROM public.magazie_bucati WHERE atribute->>'sursa'='e3b') THEN
    RAISE EXCEPTION 'Revenire E3b: există fapte E3b; refuz';
  END IF;
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'Revenire E3b: porți incomplete %',v_lipsa; END IF;
@@AMPRENTA@@
  v_comentariu := obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class');
  v_scrisa := substring(v_comentariu FROM '^E3b amprenta=([0-9a-f]{32})');
  v_inainte := substring(v_comentariu FROM 'inainte_20261106a=([0-9a-f]{32})');
  v_porti := substring(v_comentariu FROM 'porti_anterioare=(porti=[0-9a-f]{32})');
  v_porti_e3 := substring(v_comentariu FROM 'porti_e3_anterioare=(porti_e3=[0-9a-f]{32})');
  IF v_amprenta IS DISTINCT FROM v_scrisa OR v_inainte IS NULL OR v_porti IS NULL OR v_porti_e3 IS NULL
     OR position(' ‖ anterior: ' IN v_comentariu)=0 THEN RAISE EXCEPTION 'Revenire E3b: amprenta/COMMENT inconsistent'; END IF;
@@DROP_POLITICI@@
@@REVOKE_COLOANE@@
  REVOKE ALL ON public.izo_documente_istoric FROM izo_doc_editor;
  REVOKE ALL ON public.magazie_bucati,public.magazie_bucati_evenimente,public.magazie_bucati_miscari,
    public.izo_documente_intrare,public.izo_importuri FROM izo_cor_editor,izo_corectie_writer;
  REVOKE ALL ON SEQUENCE public.magazie_bucati_id_seq,public.izo_server_ver_seq,
    public.magazie_bucati_evenimente_id_seq,public.magazie_bucati_miscari_id_seq FROM izo_corectie_writer;
@@REVOKE_FUNCTII@@
@@GARZI_VECHI@@
  DROP TRIGGER trg_izo_cor_garda ON public.izo_corectii;
  DROP TRIGGER trg_izo_cor_truncate ON public.izo_corectii;
  DROP TRIGGER trg_izo_cor_garda ON public.izo_corectii_bucati;
  DROP TRIGGER trg_izo_cor_truncate ON public.izo_corectii_bucati;
  DROP TRIGGER trg_izo_doc_ist_garda ON public.izo_documente_istoric;
  DROP TRIGGER trg_izo_doc_ist_truncate ON public.izo_documente_istoric;
@@DROP_OPERATII@@
@@DROP_GARDA@@
@@PORTI_VECHE@@
  DROP FUNCTION public.fn_izo_porti_e3b_lipsa(),public.fn_izo_porti_e3b_definitii();
  DROP FUNCTION public.fn_izo_coloane_corectabile(text),public.fn_izo_coloane_identitate();
  DROP TABLE public.izo_corectii_bucati;
  DROP TABLE public.izo_documente_istoric;
  DROP TABLE public.izo_corectii;
  DROP INDEX public.ux_magbuc_ev_corectie;
  ALTER TABLE public.magazie_bucati_evenimente DROP CONSTRAINT magbuc_ev_e3b_motiv;
  ALTER TABLE public.magazie_bucati_evenimente DROP CONSTRAINT magazie_bucati_evenimente_tip_check;
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magazie_bucati_evenimente_tip_check CHECK (tip IN (@@TIPURI_E3@@));
  REVOKE ALL ON SCHEMA public FROM izo_cor_editor,izo_corectie_writer;
  DROP ROLE izo_cor_editor;
  DROP ROLE izo_corectie_writer;
@@IMPL_PRE@@
  -- Restaurăm valorile salvate, apoi verificăm egalitatea; nu binecuvântăm catalogul găsit.
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L',v_porti);
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L',v_porti_e3);
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'Revenire E3b: porți E3 incomplete %',v_lipsa; END IF;
@@AMPRENTA@@
  IF v_amprenta IS DISTINCT FROM v_inainte THEN RAISE EXCEPTION 'Revenire E3b: amprenta diferă de baseline % / %',v_amprenta,v_inainte; END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',substring(v_comentariu FROM position(' ‖ anterior: ' IN v_comentariu)+13));
  RAISE NOTICE 'Revenire E3b: baseline E3 restaurat exact %',v_amprenta;
END
$revenire$;
