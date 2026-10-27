-- AVIZ-1; --single-transaction, explicitly armed by preview/apply operator.
DO $revenire$
DECLARE v_amprenta text; v_meta jsonb; v_bucket text;
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.revenire_20261120a',true)
 IS DISTINCT FROM 'IZO_AVIZ_SCOATE:'||txid_current() THEN RAISE EXCEPTION 'AVIZ revenire nearmata'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
 LOCK TABLE public.izo_avize_serii,public.izo_avize_iesire IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.izo_avize_iesire) OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='izo-avize')
 THEN RAISE EXCEPTION 'AVIZ date existente: revenire refuzata'; END IF;
 IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'AVIZ porti'; END IF;
 v_meta:=obj_description('public.izo_avize_serii'::regclass,'pg_class')::jsonb;
 IF v_meta->>'amprenta' IS NULL THEN RAISE EXCEPTION 'AVIZ metadata lipsa'; END IF;
 IF v_meta->'serii_initiale' IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.depozit_id) FROM public.izo_avize_serii s)
 THEN RAISE EXCEPTION 'AVIZ date existente: configuratie serii schimbata'; END IF;
DROP POLICY izo_aviz_pdf_sel ON storage.objects;
DROP POLICY izo_aviz_pdf_ins ON storage.objects;
DROP POLICY izo_aviz_pdf_r_sel ON storage.objects;
DROP POLICY izo_aviz_pdf_r_ins ON storage.objects;
DROP POLICY izo_aviz_pdf_r_upd ON storage.objects;
DROP POLICY izo_aviz_pdf_r_del ON storage.objects;
DROP POLICY izo_aviz_pdf_r_anon ON storage.objects;
-- Supabase blochează DELETE pe storage.* (trigger protect_delete) ca să nu rămână fișiere orfane. Bucket-ul e
-- dovedit gol mai sus (sub lock), deci deblocarea e locală tranzacției și se închide imediat după ștergere.
PERFORM set_config('storage.allow_delete_query','true',true);
DELETE FROM storage.buckets WHERE id='izo-avize' RETURNING id INTO v_bucket;
PERFORM set_config('storage.allow_delete_query','false',true);
IF v_bucket IS DISTINCT FROM 'izo-avize' THEN RAISE EXCEPTION 'AVIZ bucket lipsa'; END IF;
SET LOCAL ROLE izo_montaj_writer;
DROP FUNCTION public.fn_izo_aviz_iesire_intern(uuid,int,bigint,bigint[],text,date);
RESET ROLE;
DROP FUNCTION public.fn_izo_iesire_cu_aviz(uuid,int,bigint,bigint[],date,int,text,boolean,int,text,jsonb);
DROP FUNCTION public.fn_izo_aviz_pdf_ataseaza(bigint);
DROP FUNCTION public.fn_izo_aviz_anuleaza(bigint,text);
DROP TABLE public.izo_avize_iesire;
DROP TABLE public.izo_avize_serii;
CREATE OR REPLACE FUNCTION public.fn_izo_porti_e4b_definitii() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT md5(concat_ws('|',
   (SELECT string_agg(format('%s:%s:%s:%s:%s:%s',p.oid::regprocedure,p.proowner,p.prosecdef,p.proconfig,p.proacl,md5(p.prosrc)),',' ORDER BY p.oid::regprocedure::text)
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'fn\_izo\_%'),
   (SELECT string_agg(format('%s:%s:%s:%s:%s',c.relname,c.relowner,c.relrowsecurity,c.relacl,c.reloptions),',' ORDER BY c.relname)
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND (c.relname=ANY(ARRAY['executie_proiecte', 'executie_tronsoane', 'izo_aprobari', 'izo_bucati_declarate', 'izo_declaratii', 'izo_declaratii_gps','izo_gps_stergeri', 'izo_declaratii_versiuni', 'izo_dispozitive', 'izo_fronturi', 'izo_operatii', 'izo_preverificari', 'izo_rata_apeluri', 'izo_rezervari', 'izo_suduri', 'izo_suduri_capete', 'izo_sync_incercari', 'izo_tronson_config', 'logistica_depozite', 'magazie_bucati', 'magazie_bucati_evenimente', 'magazie_bucati_miscari']::text[]) OR c.relname IN ('v_izo_carantina_sync','v_izo_rezervari_active','v_izo_alerte'))),
   (SELECT string_agg(format('%s:%s:%s:%s:%s:%s',c.relname,a.attname,a.atttypid,a.attnotnull,a.attacl,pg_get_expr(d.adbin,d.adrelid)),',' ORDER BY c.relname,a.attnum)
    FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY['executie_proiecte', 'executie_tronsoane', 'izo_aprobari', 'izo_bucati_declarate', 'izo_declaratii', 'izo_declaratii_gps','izo_gps_stergeri', 'izo_declaratii_versiuni', 'izo_dispozitive', 'izo_fronturi', 'izo_operatii', 'izo_preverificari', 'izo_rata_apeluri', 'izo_rezervari', 'izo_suduri', 'izo_suduri_capete', 'izo_sync_incercari', 'izo_tronson_config', 'logistica_depozite', 'magazie_bucati', 'magazie_bucati_evenimente', 'magazie_bucati_miscari']::text[]) AND a.attnum>0 AND NOT a.attisdropped),
   (SELECT string_agg(format('%s:%s',c.relname,pg_get_constraintdef(k.oid)),',' ORDER BY c.relname,k.conname)
    FROM pg_class c JOIN pg_constraint k ON k.conrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY['izo_fronturi', 'izo_dispozitive', 'izo_preverificari', 'izo_declaratii', 'izo_bucati_declarate', 'izo_rezervari', 'izo_operatii', 'izo_declaratii_versiuni', 'izo_declaratii_gps','izo_gps_stergeri', 'izo_sync_incercari', 'izo_rata_apeluri', 'izo_aprobari', 'izo_suduri', 'izo_suduri_capete']::text[])),
   (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s',c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)),',' ORDER BY c.relname,p.polname)
    FROM pg_class c JOIN pg_policy p ON p.polrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY['executie_proiecte', 'executie_tronsoane', 'izo_aprobari', 'izo_bucati_declarate', 'izo_declaratii', 'izo_declaratii_gps','izo_gps_stergeri', 'izo_declaratii_versiuni', 'izo_dispozitive', 'izo_fronturi', 'izo_operatii', 'izo_preverificari', 'izo_rata_apeluri', 'izo_rezervari', 'izo_suduri', 'izo_suduri_capete', 'izo_sync_incercari', 'izo_tronson_config', 'logistica_depozite', 'magazie_bucati', 'magazie_bucati_evenimente', 'magazie_bucati_miscari']::text[])),
   (SELECT string_agg(format('%s:%s:%s',c.relname,pg_get_triggerdef(g.oid),g.tgenabled),',' ORDER BY c.relname,g.tgname)
    FROM pg_class c JOIN pg_trigger g ON g.tgrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY['izo_fronturi', 'izo_dispozitive', 'izo_preverificari', 'izo_declaratii', 'izo_bucati_declarate', 'izo_rezervari', 'izo_operatii', 'izo_declaratii_versiuni', 'izo_declaratii_gps','izo_gps_stergeri', 'izo_sync_incercari', 'izo_rata_apeluri', 'izo_aprobari', 'izo_suduri', 'izo_suduri_capete']::text[]) AND NOT g.tgisinternal),
   (SELECT string_agg(pg_get_indexdef(i.indexrelid),',' ORDER BY i.indexrelid::regclass::text)
    FROM pg_class c JOIN pg_index i ON i.indrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND (c.relname=ANY(ARRAY['izo_fronturi', 'izo_dispozitive', 'izo_preverificari', 'izo_declaratii', 'izo_bucati_declarate', 'izo_rezervari', 'izo_operatii', 'izo_declaratii_versiuni', 'izo_declaratii_gps','izo_gps_stergeri', 'izo_sync_incercari', 'izo_rata_apeluri', 'izo_aprobari', 'izo_suduri', 'izo_suduri_capete']::text[]) OR i.indexrelid=to_regclass('public.ux_magbuc_ev_decl'))),
   (SELECT string_agg(format('%s:%s:%s',c.relname,c.relowner,c.relacl),',' ORDER BY c.relname) FROM pg_class c
    WHERE c.relnamespace='public'::regnamespace AND c.relkind='S' AND (c.relname IN ('izo_gps_stergeri_id_seq','izo_server_ver_seq','magazie_bucati_id_seq','magazie_bucati_evenimente_id_seq','magazie_bucati_miscari_id_seq') OR c.relname LIKE 'izo\_fronturi\_%' OR c.relname LIKE 'izo\_preverificari\_%' OR c.relname LIKE 'izo\_declaratii\_%' OR c.relname LIKE 'izo\_rezervari\_%' OR c.relname LIKE 'izo\_operatii\_%' OR c.relname LIKE 'izo\_sync\_incercari\_%' OR c.relname LIKE 'izo\_aprobari\_%' OR c.relname LIKE 'izo\_suduri\_%')),
   (SELECT concat_ws(':',rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconfig) FROM pg_roles WHERE rolname='izo_teren_editor'),
   (SELECT string_agg(format('%s:%s:%s:%s:%s',roleid,member,admin_option,inherit_option,set_option),',' ORDER BY roleid,member) FROM pg_auth_members WHERE roleid='izo_teren_editor'::regrole OR member='izo_teren_editor'::regrole)))
 $f$;

EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L',v_meta->>'porti');
EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L',v_meta->>'e3');
EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L',v_meta->>'e3b');
EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L',v_meta->>'e4');
EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L',v_meta->>'e4b');
EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',v_meta->>'evenimente');
IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'AVIZ restore porti'; END IF;
  -- <amprenta>
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

IF v_amprenta IS DISTINCT FROM v_meta->>'amprenta' THEN RAISE EXCEPTION 'AVIZ restore amprenta diferita'; END IF;
END $revenire$;
