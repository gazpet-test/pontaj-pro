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
  v_comentariu := obj_description('public.magazie_bucati_evenimente'::regclass,'pg_class');
  v_scrisa := substring(v_comentariu FROM '^E3b amprenta=([0-9a-f]{32})');
  v_inainte := substring(v_comentariu FROM 'inainte_20261106a=([0-9a-f]{32})');
  v_porti := substring(v_comentariu FROM 'porti_anterioare=(porti=[0-9a-f]{32})');
  v_porti_e3 := substring(v_comentariu FROM 'porti_e3_anterioare=(porti_e3=[0-9a-f]{32})');
  IF v_amprenta IS DISTINCT FROM v_scrisa OR v_inainte IS NULL OR v_porti IS NULL OR v_porti_e3 IS NULL
     OR position(' ‖ anterior: ' IN v_comentariu)=0 THEN RAISE EXCEPTION 'Revenire E3b: amprenta/COMMENT inconsistent'; END IF;
  DROP POLICY izo_corectii_api_sel ON public.izo_corectii;
  DROP POLICY izo_corectii_bucati_api_sel ON public.izo_corectii_bucati;
  DROP POLICY izo_documente_istoric_api_sel ON public.izo_documente_istoric;
  DROP POLICY izo_corectii_coreditor_select ON public.izo_corectii;
  DROP POLICY izo_corectii_bucati_coreditor_select ON public.izo_corectii_bucati;
  DROP POLICY magbuc_izo_coreditor_sel ON public.magazie_bucati;
  DROP POLICY izo_ev_coreditor_sel ON public.magazie_bucati_evenimente;
  DROP POLICY izo_mis_coreditor_sel ON public.magazie_bucati_miscari;
  DROP POLICY izo_doc_coreditor_sel ON public.izo_documente_intrare;
  DROP POLICY izo_corectii_corectie_select ON public.izo_corectii;
  DROP POLICY izo_corectii_bucati_corectie_select ON public.izo_corectii_bucati;
  DROP POLICY magbuc_izo_corectie_sel ON public.magazie_bucati;
  DROP POLICY izo_ev_corectie_sel ON public.magazie_bucati_evenimente;
  DROP POLICY izo_mis_corectie_sel ON public.magazie_bucati_miscari;
  DROP POLICY izo_doc_corectie_sel ON public.izo_documente_intrare;
  DROP POLICY izo_corectii_coreditor_insert ON public.izo_corectii;
  DROP POLICY izo_corectii_coreditor_update ON public.izo_corectii;
  DROP POLICY izo_corectii_corectie_insert ON public.izo_corectii;
  DROP POLICY izo_corectii_corectie_update ON public.izo_corectii;
  DROP POLICY izo_corectii_bucati_corectie_insert ON public.izo_corectii_bucati;
  DROP POLICY izo_documente_istoric_doceditor_select ON public.izo_documente_istoric;
  DROP POLICY izo_documente_istoric_doceditor_insert ON public.izo_documente_istoric;
  DROP POLICY izo_imp_corectie_sel ON public.izo_importuri;
  DROP POLICY magbuc_izo_corectie_ins ON public.magazie_bucati;
  DROP POLICY magbuc_izo_corectie_upd ON public.magazie_bucati;
  DROP POLICY izo_ev_corectie_ins ON public.magazie_bucati_evenimente;
  DROP POLICY izo_mis_corectie_ins ON public.magazie_bucati_miscari;
  DROP POLICY izo_doc_corectie_upd ON public.izo_documente_intrare;
  REVOKE INSERT (proiect_id, tip, bucata_id, document_intrare_id, inainte, dupa, ncr_ref, motiv, stare, versiune, cale, propus_de, propus_rol, propus_la) ON public.izo_corectii FROM izo_cor_editor;
  REVOKE UPDATE (stare, versiune, decis_de, decis_rol, decis_la, motiv_decizie) ON public.izo_corectii FROM izo_cor_editor;
  REVOKE INSERT (proiect_id, tip, bucata_id, document_intrare_id, inainte, dupa, ncr_ref, motiv, stare, versiune, cale, propus_de, propus_rol, propus_la, import_id) ON public.izo_corectii FROM izo_corectie_writer;
  REVOKE UPDATE (stare, versiune, decis_de, decis_rol, decis_la, eveniment_id, bucata_id) ON public.izo_corectii FROM izo_corectie_writer;
  REVOKE INSERT (document_id, versiune, salvat_de, salvat_rol, salvat_la, continut, hash, diff, baza) ON public.izo_documente_istoric FROM izo_doc_editor;
  REVOKE INSERT (proiect_id, comanda_furnizor_id, tip_material_id, serie, sarja, dimensiune, grad_otel, standard, lungime_m, lungime_originala_m, greutate_kg, unghi_curba, cantitate, um, provenienta, izolatie, furnizor, producator, sursa_receptie, fara_packing_list, nr_document, data_receptie, mtc_path, stare, locatie_tip, locatie_site_id, executie_teava_id, atribute, observatii, receptionat_de, receptionat_la, created_by, tip_cod, parinte_id, cod_bucata, capat_stanga, capat_dreapta, dezambiguare, lungime_aviz_mm, lungime_masurata_mm, lungime_mm, lungime_calculata, perete_mm, diametru_mm, lot, aviz_intrare_id, nr_crt_aviz, bend_no, capat_marcaj, depozit_id, tronson_id, id, uid, radacina_id, server_ver) ON public.magazie_bucati FROM izo_corectie_writer;
  REVOKE UPDATE (depozit_id, diametru_mm, dimensiune, grad_otel, greutate_kg, izolatie, lot, lungime_aviz_mm, lungime_m, lungime_masurata_mm, lungime_mm, lungime_originala_m, perete_mm, sarja, serie, server_ver, standard, stare, unghi_curba, updated_at) ON public.magazie_bucati FROM izo_corectie_writer;
  REVOKE UPDATE (pv_nr, pv_nr_canon, pv_data, versiune, updated_at) ON public.izo_documente_intrare FROM izo_corectie_writer;
  REVOKE ALL ON public.izo_documente_istoric FROM izo_doc_editor;
  REVOKE ALL ON public.magazie_bucati,public.magazie_bucati_evenimente,public.magazie_bucati_miscari,
    public.izo_documente_intrare,public.izo_importuri FROM izo_cor_editor,izo_corectie_writer;
  REVOKE ALL ON SEQUENCE public.magazie_bucati_id_seq,public.izo_server_ver_seq,
    public.magazie_bucati_evenimente_id_seq,public.magazie_bucati_miscari_id_seq FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_jwt_rol() FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_uid() FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_porti_lipsa() FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_nivel(bigint) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_citire(bigint) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_site_proiect(bigint) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_tip_cod(integer) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_tip_material(text) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_loc_valid(bigint, integer, bigint) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_proiectie(jsonb, text[]) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_coloane_c() FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_coloane_ev() FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_coloane_mis() FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_canon_serie(text) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_hash(bigint) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_coloane_corectabile(text) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_coloane_identitate() FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_garda_scriitor() FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[]) FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_blocheaza_tabele() FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_lock_partajat(bigint[]) FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_lock_proiect(bigint, boolean) FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_chei(text, text, text) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_autorizare_lock(bigint, text, integer) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_cerut_de_valid(bigint, uuid) FROM izo_corectie_writer, izo_receptie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_bucata_lock(bigint, bigint) FROM izo_cor_editor;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_doc_lock(bigint, bigint) FROM izo_cor_editor;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_deschise(bigint[]) FROM izo_registru_writer, izo_receptie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_api_verifica() FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_adm_verifica() FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_loc(public.magazie_bucati) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_tinta_iesire(public.magazie_bucati) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_valori(public.magazie_bucati) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_valideaza(public.izo_corectii) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_inainte(public.izo_corectii) FROM izo_cor_editor, izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_eveniment_asteptat(public.izo_corectii) FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati) FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_bucata_noua(public.izo_corectii) FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati) FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_garda_corectie(text, text, jsonb, jsonb) FROM izo_corectie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_lant_blocant(bigint[], bigint[]) FROM izo_corectie_writer, izo_registru_writer, izo_receptie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_instantaneu(bigint) FROM izo_doc_editor;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_diff(jsonb, jsonb) FROM izo_doc_editor;
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
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_garda_bucati()'::regprocedure) IS DISTINCT FROM 'b2e1f127c6dd2657ce9f96651642a80e' THEN
    RAISE EXCEPTION 'E3b: restaurarea exactă fn_izo_garda_bucati a eșuat'; END IF;
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
    IF v_aut IS NOT TRUE THEN
      RAISE EXCEPTION 'izo: % se scrie doar prin funcțiile registrului', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $f$;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_garda_fapte()'::regprocedure) IS DISTINCT FROM '6b1a0093ce9f1fcd812da7c2b3baa1d4' THEN
    RAISE EXCEPTION 'E3b: restaurarea exactă fn_izo_garda_fapte a eșuat'; END IF;
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
    RAISE EXCEPTION 'izo E3: documentele de intrare se scriu doar prin funcțiile E3 (rolul curent %)', current_user USING ERRCODE = '42501';
  END $f$;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_doc_garda()'::regprocedure) IS DISTINCT FROM '0815d20cd4462b2ce5f3d17123043c3c' THEN
    RAISE EXCEPTION 'E3b: restaurarea exactă fn_izo_doc_garda a eșuat'; END IF;
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
    RETURN jsonb_build_object('document_id', d.id, 'versiune', d.versiune, 'hash', public.fn_izo_doc_hash(d.id));
  END $f$;
  RESET ROLE;
  REVOKE CREATE ON SCHEMA public FROM izo_doc_editor;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname='fn_izo_doc_salveaza' AND pronamespace='public'::regnamespace) IS DISTINCT FROM '7877254e7dc9ec8ebbc16b3ee06e11cf' THEN RAISE EXCEPTION 'E3b: restaurare salvare diferita'; END IF;
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
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_import_sold_initial(bigint, text, jsonb)'::regprocedure) IS DISTINCT FROM 'e3f65df3705f40e8b5a907b66496acd9' THEN RAISE EXCEPTION 'E3b: restaurare D2 diferita'; END IF;
  GRANT CREATE ON SCHEMA public TO izo_registru_writer;
  SET LOCAL ROLE izo_registru_writer;
  CREATE OR REPLACE FUNCTION public.fn_izo_import_storno(p_proiect bigint, p_import_id text, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_imp record; v_ev bigint; v_n int; v_alt int;
  BEGIN
    IF session_user IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'izo: funcțiile registrului se cheamă doar dintr-o sesiune postgres directă (session_user = %)', session_user USING ERRCODE = '42501';
    END IF;
    PERFORM set_config('izo.registru_tx', txid_current()::text, true);
    IF p_motiv IS NULL OR char_length(btrim(p_motiv)) < 3 THEN RAISE EXCEPTION 'izo: motivul e obligatoriu'; END IF;
    IF p_proiect IS NULL THEN RAISE EXCEPTION 'izo: proiectul e obligatoriu'; END IF;
    PERFORM public.fn_izo_lock_proiect(p_proiect, true);
    SELECT * INTO v_imp FROM public.izo_importuri WHERE proiect_id = p_proiect AND import_id = p_import_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo: importul % nu există pe proiectul %', p_import_id, p_proiect; END IF;
    IF v_imp.stare <> 'aplicat' THEN RAISE EXCEPTION 'izo: importul % e deja %', p_import_id, v_imp.stare; END IF;
    PERFORM 1 FROM public.magazie_bucati b JOIN public.magazie_bucati_miscari m ON m.bucata_id = b.id
      WHERE m.eveniment_id = v_imp.eveniment_id FOR UPDATE OF b;
    SELECT count(*) INTO v_alt FROM public.magazie_bucati_miscari m2
     WHERE m2.bucata_id IN (SELECT m.bucata_id FROM public.magazie_bucati_miscari m WHERE m.eveniment_id = v_imp.eveniment_id)
       AND m2.eveniment_id <> v_imp.eveniment_id;
    IF v_alt > 0 THEN
      RAISE EXCEPTION 'izo: storno refuzat — % mișcări ulterioare pe bucățile importului % (stornează întâi lanțul, explicit)', v_alt, p_import_id;
    END IF;
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, import_id, storno_de_eveniment_id, motiv, aplicat_de, server_ver)
    VALUES ('storno', p_proiect, 'import', p_import_id, p_import_id, v_imp.eveniment_id, btrim(p_motiv), public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_ev;
    INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
    SELECT v_ev, p_proiect, b.id, 'anulat', b.stare, 'anulata', nextval('public.izo_server_ver_seq')
      FROM public.magazie_bucati b JOIN public.magazie_bucati_miscari m ON m.bucata_id = b.id AND m.eveniment_id = v_imp.eveniment_id;
    UPDATE public.magazie_bucati b SET stare = 'anulata', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now()
      FROM public.magazie_bucati_miscari m WHERE m.bucata_id = b.id AND m.eveniment_id = v_imp.eveniment_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE public.izo_importuri SET stare = 'stornat', stornat_eveniment_id = v_ev WHERE id = v_imp.id;
    RETURN jsonb_build_object('import_id', p_import_id, 'storno_eveniment_id', v_ev, 'bucati_anulate', v_n);
  END $f$;
  RESET ROLE;
  REVOKE CREATE ON SCHEMA public FROM izo_registru_writer;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_import_storno(bigint, text, text)'::regprocedure) IS DISTINCT FROM 'fe5d3493d096d9851249cd20de8f99b1' THEN RAISE EXCEPTION 'E3b: restaurare D2 diferita'; END IF;
  SET LOCAL ROLE izo_receptie_writer;
  DROP FUNCTION public.fn_izo_doc_anuleaza(bigint, text, uuid);
  RESET ROLE;
  GRANT CREATE ON SCHEMA public TO izo_receptie_writer;
  SET LOCAL ROLE izo_receptie_writer;
  CREATE OR REPLACE FUNCTION public.fn_izo_doc_anuleaza(p_doc_id bigint, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_motiv text := btrim(p_motiv); v_lipsa text[]; v_toate bigint[]; v_pv bigint[];
    v_st_pv bigint; v_st_i bigint; v_n integer;
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
    PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
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
    -- fail-closed: nicio mișcare în afară de nașterea din intrare și PV-ul documentului
    SELECT count(*) INTO v_n FROM public.magazie_bucati_miscari m
     WHERE m.bucata_id = ANY (v_toate) AND m.eveniment_id <> d.eveniment_intrare_id AND m.eveniment_id IS DISTINCT FROM d.eveniment_pv_id;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'izo E3: anulare refuzată — % mișcări ulterioare pe bucățile documentului (stornează întâi lanțul, explicit)', v_n
        USING ERRCODE = '23514';
    END IF;
    PERFORM public.fn_izo_receptie_marcheaza('anulare', d.id, d.proiect_id, d.depozit_id, d.versiune, v_motiv);
    IF d.eveniment_pv_id IS NOT NULL THEN
      INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, storno_de_eveniment_id, motiv, aplicat_de, server_ver)
      VALUES ('storno', d.proiect_id, 'doc_intrare', d.id::text, d.eveniment_pv_id, v_motiv, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
      RETURNING id INTO v_st_pv;
      SELECT coalesce(array_agg(m.bucata_id ORDER BY m.bucata_id), '{}') INTO v_pv FROM public.magazie_bucati_miscari m WHERE m.eveniment_id = d.eveniment_pv_id;
      INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
      SELECT v_st_pv, d.proiect_id, x, 'stare', 'receptionat', 'sosit', nextval('public.izo_server_ver_seq') FROM unnest(v_pv) x;
      UPDATE public.magazie_bucati SET stare = 'sosit', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now()
       WHERE id = ANY (v_pv) AND stare = 'receptionat';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> cardinality(v_pv) THEN RAISE EXCEPTION 'izo E3: reconcilierea storno-ului PV a eșuat'; END IF;
    END IF;
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, storno_de_eveniment_id, motiv, aplicat_de, server_ver)
    VALUES ('storno', d.proiect_id, 'doc_intrare', d.id::text, d.eveniment_intrare_id, v_motiv, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_st_i;
    INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
    SELECT v_st_i, d.proiect_id, b.id, 'anulat', b.stare, 'anulata', nextval('public.izo_server_ver_seq')
      FROM public.magazie_bucati b WHERE b.id = ANY (v_toate) ORDER BY b.id;
    UPDATE public.magazie_bucati SET stare = 'anulata', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now() WHERE id = ANY (v_toate);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> cardinality(v_toate) THEN RAISE EXCEPTION 'izo E3: reconcilierea storno-ului intrării a eșuat'; END IF;
    UPDATE public.izo_documente_intrare SET stare = 'anulat', anulat_de = public.fn_izo_uid(), anulat_de_rol = session_user, anulat_la = now(),
           anulat_motiv = v_motiv, eveniment_storno_intrare_id = v_st_i, eveniment_storno_pv_id = v_st_pv, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'stare', d.stare, 'storno', true, 'storno_intrare_id', v_st_i, 'storno_pv_id', v_st_pv,
                              'bucati_anulate', cardinality(v_toate), 'versiune', d.versiune);
  END $f$;
  RESET ROLE;
  REVOKE CREATE ON SCHEMA public FROM izo_receptie_writer;
  GRANT CREATE ON SCHEMA public TO izo_receptie_writer;
  SET LOCAL ROLE izo_receptie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_anuleaza(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_anuleaza(bigint, text) TO postgres;
  RESET ROLE;
  REVOKE CREATE ON SCHEMA public FROM izo_receptie_writer;
  IF (SELECT proacl::text FROM pg_proc WHERE oid='public.fn_izo_doc_anuleaza(bigint, text)'::regprocedure) IS DISTINCT FROM '{izo_receptie_writer=X/izo_receptie_writer,postgres=X/izo_receptie_writer}' THEN RAISE EXCEPTION 'E3b: ACL anulare restaurat diferit'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_doc_anuleaza(bigint, text)'::regprocedure) IS DISTINCT FROM '3caaabceb9a09c33ede75dd7bc7b700a' THEN RAISE EXCEPTION 'E3b: restaurare D2 diferita'; END IF;
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
           OR (v_op = 'anulare' AND v_st_intrare IS NOT NULL AND p_old ->> 'stare' IN ('sosit', 'carantina') AND p_new ->> 'stare' = 'anulata')) THEN
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
        v_exp := public.fn_izo_miscare_asteptata(v_st_pv, v_b.id, 'stare', 'receptionat', 'sosit', NULL, NULL);
      ELSIF v_op = 'anulare' AND v_st_intrare IS NOT NULL AND (p_new ->> 'eveniment_id')::bigint = v_st_intrare THEN
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
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_garda_receptie(text, text, jsonb, jsonb)'::regprocedure) IS DISTINCT FROM 'e91e2de1cbbfb376253850c63d07bea1' THEN RAISE EXCEPTION 'E3b: restaurare D2 diferita'; END IF;
  DROP TRIGGER trg_izo_cor_garda ON public.izo_corectii;
  DROP TRIGGER trg_izo_cor_truncate ON public.izo_corectii;
  DROP TRIGGER trg_izo_cor_garda ON public.izo_corectii_bucati;
  DROP TRIGGER trg_izo_cor_truncate ON public.izo_corectii_bucati;
  DROP TRIGGER trg_izo_doc_ist_garda ON public.izo_documente_istoric;
  DROP TRIGGER trg_izo_doc_ist_truncate ON public.izo_documente_istoric;
  SET LOCAL ROLE izo_corectie_writer;
  DROP FUNCTION public.fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid);
  RESET ROLE;
  SET LOCAL ROLE izo_corectie_writer;
  DROP FUNCTION public.fn_izo_cor_pv(bigint, bigint, text, date, text);
  RESET ROLE;
  SET LOCAL ROLE izo_corectie_writer;
  DROP FUNCTION public.fn_izo_cor_camp(bigint, bigint, jsonb, text);
  RESET ROLE;
  SET LOCAL ROLE izo_corectie_writer;
  DROP FUNCTION public.fn_izo_cor_aproba(bigint, bigint);
  RESET ROLE;
  SET LOCAL ROLE izo_cor_editor;
  DROP FUNCTION public.fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb);
  RESET ROLE;
  SET LOCAL ROLE izo_cor_editor;
  DROP FUNCTION public.fn_izo_cor_respinge(bigint, bigint, text);
  RESET ROLE;
  SET LOCAL ROLE izo_cor_editor;
  DROP FUNCTION public.fn_izo_cor_retrage(bigint, bigint, text);
  RESET ROLE;
  SET LOCAL ROLE izo_cor_editor;
  DROP FUNCTION public.fn_izo_cor_propune(text, bigint, bigint, jsonb, text);
  RESET ROLE;
  DROP FUNCTION public.fn_izo_doc_ist_garda();
  DROP FUNCTION public.fn_izo_doc_diff(jsonb, jsonb);
  DROP FUNCTION public.fn_izo_doc_instantaneu(bigint);
  DROP FUNCTION public.fn_izo_lant_blocant(bigint[], bigint[]);
  DROP FUNCTION public.fn_izo_cor_garda();
  DROP FUNCTION public.fn_izo_garda_corectie(text, text, jsonb, jsonb);
  DROP FUNCTION public.fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati);
  DROP FUNCTION public.fn_izo_cor_bucata_noua(public.izo_corectii);
  DROP FUNCTION public.fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati);
  DROP FUNCTION public.fn_izo_cor_eveniment_asteptat(public.izo_corectii);
  DROP FUNCTION public.fn_izo_cor_inainte(public.izo_corectii);
  DROP FUNCTION public.fn_izo_cor_valideaza(public.izo_corectii);
  DROP FUNCTION public.fn_izo_cor_valori(public.magazie_bucati);
  DROP FUNCTION public.fn_izo_cor_tinta_iesire(public.magazie_bucati);
  DROP FUNCTION public.fn_izo_cor_loc(public.magazie_bucati);
  SET LOCAL ROLE izo_corectie_writer;
  DROP FUNCTION public.fn_izo_cor_marcheaza(bigint);
  RESET ROLE;
  DROP FUNCTION public.fn_izo_cor_adm_verifica();
  DROP FUNCTION public.fn_izo_cor_api_verifica();
  DROP FUNCTION public.fn_izo_cor_deschise(bigint[]);
  DROP FUNCTION public.fn_izo_cor_doc_lock(bigint, bigint);
  DROP FUNCTION public.fn_izo_cor_bucata_lock(bigint, bigint);
  DROP FUNCTION public.fn_izo_cor_cerut_de_valid(bigint, uuid);
  DROP FUNCTION public.fn_izo_cor_autorizare_lock(bigint, text, integer);
  DROP FUNCTION public.fn_izo_cor_chei(text, text, text);
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
    RETURN v;
  END $f$;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_lipsa()'::regprocedure) IS DISTINCT FROM 'dde0509cb317c6ad51ff33f74ce4a13b' THEN RAISE EXCEPTION 'E3b: restaurarea porții diferă'; END IF;
  DROP FUNCTION public.fn_izo_porti_e3b_lipsa(),public.fn_izo_porti_e3b_definitii();
  DROP FUNCTION public.fn_izo_coloane_corectabile(text),public.fn_izo_coloane_identitate();
  DROP TABLE public.izo_corectii_bucati;
  DROP TABLE public.izo_documente_istoric;
  DROP TABLE public.izo_corectii;
  DROP INDEX public.ux_magbuc_ev_corectie;
  ALTER TABLE public.magazie_bucati_evenimente DROP CONSTRAINT magbuc_ev_e3b_motiv;
  ALTER TABLE public.magazie_bucati_evenimente DROP CONSTRAINT magazie_bucati_evenimente_tip_check;
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magazie_bucati_evenimente_tip_check CHECK (tip IN ('sold_initial', 'intrare_aviz', 'gasit', 'iesire_tranzit', 'livrare', 'retur_fizic', 'confirmare_primire_depozit', 'mutare_tronson', 'taiere', 'montaj', 'demontaj', 'deseu', 'pierdut', 'inventar_ajustare', 'corectie', 'corectie_radacina', 'storno', 'intrare_lista_ambalare', 'receptie_pv'));
  REVOKE ALL ON SCHEMA public FROM izo_cor_editor,izo_corectie_writer;
  DROP ROLE izo_cor_editor;
  DROP ROLE izo_corectie_writer;
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
  -- Restaurăm valorile salvate, apoi verificăm egalitatea; nu binecuvântăm catalogul găsit.
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L',v_porti);
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L',v_porti_e3);
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'Revenire E3b: porți E3 incomplete %',v_lipsa; END IF;
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
  IF v_amprenta IS DISTINCT FROM v_inainte THEN RAISE EXCEPTION 'Revenire E3b: amprenta diferă de baseline % / %',v_amprenta,v_inainte; END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',substring(v_comentariu FROM position(' ‖ anterior: ' IN v_comentariu)+13));
  RAISE NOTICE 'Revenire E3b: baseline E3 restaurat exact %',v_amprenta;
END
$revenire$;
