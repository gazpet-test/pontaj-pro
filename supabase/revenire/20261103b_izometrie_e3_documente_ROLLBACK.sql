-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261103b_izometrie_e3_documente_ROLLBACK — NU e migrare. Scoate E3 și reface EXACT starea de dinainte (gărzile E2a,
-- poarta E2a, CHECK-ul tipurilor, ACL-urile, ștampilele, COMMENT-ul de revenire — verificat prin amprentă).
-- Refuză dacă există ORICE fapt E3 (document, eveniment doc_intrare / intrare_lista_ambalare / receptie_pv, bucată cu
-- aviz_intrare_id, obiect în bucket-ul izo-documente): registrul e doar-adaug, deci după primul fapt drumul e ÎNAINTE, cu
-- migrare corectivă revizuită. Rulează ÎNAINTEA oricărei reveniri E2a / 20261102c.
-- Concurență (r5f, #825 NO-GO): ia lock-ul „schemă” EXCLUSIV (cheia runner-ului; operațiile E3 îl iau partajat) și tabelele
-- registrului / documentelor în ACCESS EXCLUSIVE ÎNAINTEA verificării „fără fapte E3”; doar în READ COMMITTED (refuză altfel).
-- Procedura (un singur string, READ COMMITTED — implicit):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261103b', 'IZO_E3_SCOATE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
--   apoi: DELETE FROM supabase_migrations.schema_migrations WHERE name = '20261103b_izometrie_e3_documente';
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $revenire$
DECLARE v_amprenta text; v_scrisa text; v_inainte text; v_comentariu text; v_lipsa text[];
BEGIN
  IF current_setting('gazpet.revenire_20261103b', true) IS DISTINCT FROM 'IZO_E3_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261103b: nearmată (gazpet.revenire_20261103b legat de txid_current) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261103b: rulează ca postgres'; END IF;
  -- r5f (#825 NO-GO): verificarea de mai jos e exactă doar dacă vede tot ce s-a comis până la lock-uri — READ COMMITTED (snapshot
  -- nou la fiecare instrucțiune); în REPEATABLE READ / SERIALIZABLE snapshot-ul e cel de la armare, dinaintea lock-urilor
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION 'Revenire 20261103b: izolarea tranzacției e % — rulează în READ COMMITTED (altfel verificarea nu vede ce s-a comis înaintea lock-ului); refuz',
      current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- r5f (#825 NO-GO): lock-ul „schemă” EXCLUSIV, aceeași cheie bigint ca runner-ul (operațiile E3 o iau PARTAJAT, primul lock),
  -- ÎNAINTEA verificării: o operație E3 în curs e așteptată (sau lock_timeout), una nouă așteaptă revenirea și pică apoi pe
  -- obiectele scoase — niciun draft nu se mai comite între verificare și DROP
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  IF to_regclass('public.izo_documente_intrare') IS NULL THEN RAISE EXCEPTION 'Revenire 20261103b: E3 nu e aplicată'; END IF;
  -- r5f (#825 NO-GO): și tabelele verificate / modificate mai jos, ACCESS EXCLUSIVE (ca revenirea E2a): o scriere directă, fără
  -- lock-ul „schemă”, e așteptată și apoi văzută de verificare; DROP-urile de mai jos nu mai urcă lock-uri pe ele
  LOCK TABLE public.izo_documente_intrare, public.izo_documente_intrare_randuri, public.izo_documente_scanuri, public.magazie_bucati,
             public.magazie_bucati_evenimente, public.magazie_bucati_miscari IN ACCESS EXCLUSIVE MODE;
  -- fapte E3 → refuz (instrucțiune nouă ⇒ snapshot de după lock-uri)
  IF EXISTS (SELECT 1 FROM public.izo_documente_intrare) OR EXISTS (SELECT 1 FROM public.izo_documente_intrare_randuri)
     OR EXISTS (SELECT 1 FROM public.izo_documente_scanuri)
     OR EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip = 'doc_intrare' OR tip IN ('intrare_lista_ambalare', 'receptie_pv'))
     OR EXISTS (SELECT 1 FROM public.magazie_bucati WHERE aviz_intrare_id IS NOT NULL OR nr_crt_aviz IS NOT NULL)
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'izo-documente') THEN
    RAISE EXCEPTION 'Revenire 20261103b: există date reale E3 (documente / evenimente / bucăți / scanuri) — refuz; corecția se face înainte, cu migrare revizuită';
  END IF;
  -- amprenta consistentă cu ce a scris migrarea
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
  v_inainte := substring(v_comentariu FROM 'inainte_20261103b=([0-9a-f]{32})');
  IF v_amprenta IS NULL OR v_amprenta IS DISTINCT FROM v_scrisa OR v_inainte IS NULL OR position(' ‖ anterior: ' IN v_comentariu) = 0 THEN
    RAISE EXCEPTION 'Revenire 20261103b: amprenta diferă de COMMENT (acum %, scrisă %) — ceva s-a schimbat după migrare; refuz', v_amprenta, v_scrisa;
  END IF;

  -- Storage
  DROP POLICY izo_doc_scan_ins ON storage.objects;
  DROP POLICY izo_doc_scan_sel ON storage.objects;
  DROP POLICY izo_doc_scan_del ON storage.objects;
  -- r5f (#825 NO-GO, P1-3): stratul RESTRICTIV al bucket-ului
  DROP POLICY izo_doc_scan_r_toti ON storage.objects;
  DROP POLICY izo_doc_scan_r_sel ON storage.objects;
  DROP POLICY izo_doc_scan_r_ins ON storage.objects;
  DROP POLICY izo_doc_scan_r_del ON storage.objects;
  DROP POLICY izo_doc_scan_r_upd ON storage.objects;
  -- r5f (#825 NO-GO, a doua ușă): politicile rândului bucket-ului, ÎNAINTEA DELETE-ului de mai jos (izo_doc_bucket_r_del l-ar
  -- opri pentru un rol fără BYPASSRLS: 0 rânduri, nu eroare)
  DROP POLICY izo_doc_bucket_r_ins ON storage.buckets;
  DROP POLICY izo_doc_bucket_r_upd ON storage.buckets;
  DROP POLICY izo_doc_bucket_r_del ON storage.buckets;
  -- r5f (#825 NO-GO): storage.objects nu intră în LOCK TABLE (tabel al Storage pe Supabase, fără drepturi noi); DROP POLICY ține ACCESS
  -- EXCLUSIVE pe el ⇒ reverificare exactă: un obiect comis după verificarea de sus (scriere fără lock-urile E3) → refuz
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'izo-documente') THEN
    RAISE EXCEPTION 'Revenire 20261103b: există date reale E3 (obiecte în izo-documente, apărute în timpul revenirii) — refuz';
  END IF;
  -- Supabase blochează DELETE direct din storage.* (storage.protect_delete); ocolirea oficială, locală tranzacției, DOAR aici:
  -- bucket-ul e verificat gol mai sus (nicio obiect în izo-documente), deci nu rămân fișiere orfane (găsit pe branch-ul PG17)
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.buckets WHERE id = 'izo-documente';
  -- r5f: 0 rânduri șterse (RLS fără BYPASSRLS, un trigger care sare rândul) = bucket rămas → refuz, nu revenire pe jumătate
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revenire 20261103b: bucket-ul izo-documente nu s-a șters (0 rânduri: RLS / trigger pe storage.buckets?) — refuz';
  END IF;
  PERFORM set_config('storage.allow_delete_query', 'false', true);
  -- registrul: politicile, drepturile rolurilor E3 (REVOKE pe tabel retrage și drepturile pe coloane)
  DROP POLICY magbuc_izo_doceditor_sel ON public.magazie_bucati;
  DROP POLICY magbuc_izo_receptie_sel ON public.magazie_bucati;
  DROP POLICY magbuc_izo_receptie_ins ON public.magazie_bucati;
  DROP POLICY magbuc_izo_receptie_upd ON public.magazie_bucati;
  DROP POLICY izo_ev_receptie_sel ON public.magazie_bucati_evenimente;
  DROP POLICY izo_ev_receptie_ins ON public.magazie_bucati_evenimente;
  DROP POLICY izo_mis_receptie_sel ON public.magazie_bucati_miscari;
  DROP POLICY izo_mis_receptie_ins ON public.magazie_bucati_miscari;
  REVOKE ALL ON TABLE public.magazie_bucati, public.magazie_bucati_evenimente, public.magazie_bucati_miscari FROM izo_doc_editor, izo_receptie_writer;
  REVOKE ALL ON SEQUENCE public.magazie_bucati_id_seq, public.izo_server_ver_seq, public.magazie_bucati_evenimente_id_seq,
    public.magazie_bucati_miscari_id_seq FROM izo_receptie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_nivel(bigint), public.fn_izo_uid(), public.fn_izo_porti_lipsa(), public.fn_izo_loc_valid(bigint, integer, bigint),
    public.fn_izo_citire(bigint), public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[]), public.fn_izo_blocheaza_tabele(),
    public.fn_izo_lock_partajat(bigint[]), public.fn_izo_lock_proiect(bigint, boolean), public.fn_izo_porti_definitii(),
    public.fn_izo_garda_scriitor(), public.fn_izo_tip_cod(integer), public.fn_izo_site_proiect(bigint), public.fn_izo_tip_material(text)
    FROM izo_doc_editor, izo_receptie_writer;
  -- gărzile E2a și poarta E2a: definițiile 20261102a, exact
  CREATE OR REPLACE FUNCTION public.fn_izo_garda_bucati() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE
    v_old boolean := false;
    v_new boolean := false;
    v_p bigint;
  BEGIN
    -- (1) rândurile registrului sunt protejate PERMANENT: refuz imediat, fără lock (altfel un UPDATE al clientului, care
    --     ține deja rândul, ar aștepta lock-ul advisory al unui storno care așteaptă rândul → blocaj circular)
    IF ((TG_OP <> 'INSERT' AND OLD.tip_cod IS NOT NULL) OR (TG_OP <> 'DELETE' AND NEW.tip_cod IS NOT NULL))
       AND public.fn_izo_garda_scriitor() IS NOT TRUE THEN
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
      IF public.fn_izo_garda_scriitor() IS NOT TRUE THEN
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
    IF public.fn_izo_garda_scriitor() IS NOT TRUE THEN
      RAISE EXCEPTION 'izo: % se scrie doar prin funcțiile registrului', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $f$;

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
      -- r15 (Jakarinos + Copilot r14): funcțiile „mutator” — pot schimba calea de căutare a tranzacției: corpul conține
      -- set_config (ORICE argumente, inclusiv variabile) sau textul search_path; până la punct fix, orice funcție care
      -- numește un mutator (calificat, sau necalificat cu regulile de mai jos) devine și ea mutator. Un mutator are calea
      -- NECUNOSCUTĂ, chiar dacă are search_path în proconfig (r14 trata doar set_config('search_path', …) literal)
      SELECT coalesce(array_agg(p.oid), '{}') INTO c_mut FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
         AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '(set_config|search_path)';
      WHILE cardinality(c_mut) <> v_marime AND v_iter < 100 LOOP
        v_marime := cardinality(c_mut); v_iter := v_iter + 1;
        c_mut := c_mut || ARRAY(
          SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL (SELECT p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') AS corp,
                                      (SELECT string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ',')
                                         FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) AS cale) x
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
             AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%') AND p.oid <> ALL (c_mut)
             AND EXISTS (SELECT 1 FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace
                          CROSS JOIN LATERAL (SELECT regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') AS nume) t
                          WHERE q.oid = ANY (c_mut)
                            AND (x.corp ~* (c_st || n2.nspname || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume || c_dr)
                                 OR ((n2.nspname <> ALL (c_scheme_platforma) OR x.cale IS NULL OR n2.nspname = ANY (x.cale))
                                     AND x.corp ~* (c_st || t.nume || c_dr)))));
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'propagarea mutatorilor de cale nu converge (citire nerevizuită)'); END IF;
      v_marime := -1; v_iter := 0;
      WHILE cardinality(c_rel) + cardinality(c_fn) <> v_marime AND v_iter < 100 LOOP
        v_marime := cardinality(c_rel) + cardinality(c_fn); v_iter := v_iter + 1;
        -- view-urile: dependențe din pg_rewrite spre pg_class (relații) / pg_proc (funcții) — cataloagele explicite (Jak r12 P3)
        c_rel := c_rel || ARRAY(SELECT DISTINCT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                                 WHERE d.classid = 'pg_rewrite'::regclass
                                   AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (c_rel))
                                        OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (c_fn)))
                                   AND rw.ev_class <> ALL (c_rel));
        -- funcțiile: corpul numește ceva din închidere — calificat (schema.nume, și citat) sau necalificat (pentru schemele
        -- platformei: doar dacă schema e în search_path-ul FUNCȚIEI) — Jak + Copilot r12; sau depind de el în catalog (BEGIN ATOMIC)
        c_fn := c_fn || ARRAY(
          SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL (SELECT p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') AS corp) x0
           -- calea de căutare a funcției: cea fixată în proconfig; NECUNOSCUTĂ (NULL) dacă nu e fixată — funcția moștenește calea
           -- apelantului (r14) — sau dacă e mutator, direct sau prin ce cheamă (r15)
           CROSS JOIN LATERAL (SELECT x0.corp,
                                      CASE WHEN p.oid = ANY (c_mut) THEN NULL   -- mutator (r15): calea poate fi schimbată în tranzacție
                                           ELSE (SELECT string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ',')
                                                   FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) END AS cale) x
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
             AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%') AND p.oid <> ALL (c_fn) AND p.prolang NOT IN (12, 13)
             AND (EXISTS (SELECT 1 FROM (SELECT n2.nspname::text nsp, regexp_replace(c.relname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                                           FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE c.oid = ANY (c_rel)
                                         UNION
                                         SELECT n2.nspname::text, regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
                                           FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (c_fn)) t
                           WHERE x.corp ~* (c_st || t.nsp || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume || c_dr)
                              OR ((t.nsp <> ALL (c_scheme_platforma) OR x.cale IS NULL OR t.nsp = ANY (x.cale)) AND x.corp ~* (c_st || t.nume || c_dr)))
                  OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                                AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (c_rel))
                                     OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (c_fn))))));
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;
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
    RETURN v;
  END $f$;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_garda_bucati()'::regprocedure)) IS DISTINCT FROM 'ab63fc079fcc07a03025c782c2ec891f'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_garda_fapte()'::regprocedure)) IS DISTINCT FROM '5d8bc18846f9b20460a95bae25ef4cd9'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_porti_lipsa()'::regprocedure)) IS DISTINCT FROM 'cda86cbec93c63bf9ad3dff6c96954e1' THEN
    RAISE EXCEPTION 'Revenire 20261103b: corpurile refăcute nu au md5-ul E2a';
  END IF;
  -- tabelele / indexurile / FK-ul / CHECK-ul
  DROP TABLE public.izo_documente_scanuri;
  DROP TABLE public.izo_documente_intrare_randuri;
  ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_izo_aviz_fkey;
  DROP INDEX public.ux_magbuc_izo_aviz_rand;
  DROP TABLE public.izo_documente_intrare;
  DROP INDEX public.ux_magbuc_ev_doc_intrare;
  DROP INDEX public.ux_magbuc_ev_doc_pv;
  ALTER TABLE public.magazie_bucati_evenimente DROP CONSTRAINT magazie_bucati_evenimente_tip_check;
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magazie_bucati_evenimente_tip_check CHECK (tip IN ('sold_initial', 'intrare_aviz', 'gasit', 'iesire_tranzit', 'livrare', 'retur_fizic', 'confirmare_primire_depozit', 'mutare_tronson', 'taiere', 'montaj', 'demontaj', 'deseu', 'pierdut', 'inventar_ajustare', 'corectie', 'corectie_radacina', 'storno'));
  -- funcțiile E3 (cele ale rolurilor le scoate owner-ul)
  SET LOCAL ROLE izo_receptie_writer;
  DROP FUNCTION public.fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text), public.fn_izo_doc_confirma(bigint, bigint, text),
    public.fn_izo_doc_pv(bigint, bigint, text, date), public.fn_izo_doc_anuleaza(bigint, text);
  RESET ROLE;
  SET LOCAL ROLE izo_doc_editor;
  DROP FUNCTION public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb), public.fn_izo_doc_verifica(bigint),
    public.fn_izo_doc_anuleaza_draft(bigint, bigint, text);
  RESET ROLE;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261103b: rolul nu a revenit la postgres'; END IF;
  DROP FUNCTION public.fn_izo_coloane_c(), public.fn_izo_coloane_ev(), public.fn_izo_coloane_mis(), public.fn_izo_proiectie(jsonb, text[]),
    public.fn_izo_jwt_rol(), public.fn_izo_canon_serie(text), public.fn_izo_doc_autorizare_lock(bigint, integer), public.fn_izo_scan_exista(text),
    public.fn_izo_scan_poate_incarca(text), public.fn_izo_scan_poate_citi(text), public.fn_izo_scan_poate_sterge(text), public.fn_izo_doc_hash(bigint),
    public.fn_izo_doc_blocante(bigint), public.fn_izo_doc_avertismente(bigint), public.fn_izo_doc_bucata_asteptata(bigint, integer),
    public.fn_izo_eveniment_asteptat(text, bigint, bigint, text), public.fn_izo_miscare_asteptata(bigint, bigint, text, text, text, jsonb, integer),
    public.fn_izo_garda_receptie(text, text, jsonb, jsonb), public.fn_izo_doc_garda(), public.fn_izo_porti_e3_definitii(),
    public.fn_izo_porti_e3_lipsa(), public.fn_izo_doc_api_verifica();
  -- rolurile
  REVOKE ALL ON SCHEMA public FROM izo_doc_editor, izo_receptie_writer;
  DROP ROLE izo_doc_editor;
  DROP ROLE izo_receptie_writer;
  -- ștampila porților E2a și COMMENT-ul de revenire, la valorile de dinainte
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'Revenire 20261103b: porțile E2a nu sunt complete după revenire: %', v_lipsa; END IF;
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
  IF v_amprenta IS DISTINCT FROM v_inainte THEN
    RAISE EXCEPTION 'Revenire 20261103b: amprenta după revenire (%) ≠ cea de dinainte de E3 (%) — baseline nerefăcut', v_amprenta, v_inainte;
  END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L', substring(v_comentariu FROM position(' ‖ anterior: ' IN v_comentariu) + 13));
  RAISE NOTICE 'Revenire 20261103b: E3 scoasă; amprenta = cea de dinainte (%)', v_amprenta;
END
$revenire$;
