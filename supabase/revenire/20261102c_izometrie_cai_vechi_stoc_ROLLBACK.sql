-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261102c_izometrie_cai_vechi_stoc_ROLLBACK — NU e migrare. Reface cele 3 gărzi ale căilor vechi la definiția E2a
-- (20261102a: refuz din client pe orice proiect cu nivel ≠ off), apoi amprentele: porțile (COMMENT pe
-- fn_izo_porti_definitii) și revenirea E2a (COMMENT pe magazie_bucati_evenimente, la valoarea de dinainte de 20261102c).
-- Refuză dacă gărzile nu au definiția 20261102c sau dacă amprenta de revenire diferă de COMMENT (ceva s-a schimbat după).
-- Efect pe LOT 2: ștergerea / mutarea rândurilor de pachet din ecranul vechi redevine refuzată.
-- Pe producție (LOT 2 populat, registrul plin) ACEASTA e calea de revenire pentru 20261102c: revenirea E2a (20261102a)
-- refuză oricum cu date reale, deci nu e o alternativă — întoarcerea la comportamentul E2a se face DOAR prin acest fișier.
-- Procedura (un singur string):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261102c', 'IZO_CAI_STOC_SCOATE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $revenire$
DECLARE v_amprenta text; v_scrisa text; v_inainte text; v_lipsa text[];
BEGIN
  IF current_setting('gazpet.revenire_20261102c', true) IS DISTINCT FROM 'IZO_CAI_STOC_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261102c: nearmată (gazpet.revenire_20261102c legat de txid_current) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261102c: rulează ca postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- cele 3 funcții: owner postgres, DEFINER, search_path fix, EXECUTE doar postgres, volatile
  IF (SELECT count(*) FROM pg_proc p JOIN (VALUES ('fn_izo_refuz_delete_tevi', '6bbf5cbcf144e2e2503f339b2e49f5ca'), ('fn_izo_refuz_mutare_tevi', '52909bb8dfe2cf50083a52a2fd8ede78'), ('fn_izo_refuz_delete_pachet', '9b920ec26be971a54a2cd25dc4736698')) x(nume, md5) ON p.proname = x.nume
       WHERE p.pronamespace = 'public'::regnamespace AND pg_get_function_identity_arguments(p.oid) = '' AND md5(p.prosrc) = x.md5
         AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef AND p.provolatile = 'v'
         AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND p.proacl::text = '{postgres=X/postgres}') <> 3
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('fn_izo_refuz_delete_tevi', 'fn_izo_refuz_mutare_tevi', 'fn_izo_refuz_delete_pachet')) <> 3 THEN
    RAISE EXCEPTION 'Revenire 20261102c: gărzile nu au definiția 20261102c (neaplicată sau modificată) — refuz';
  END IF;
  IF (SELECT count(*) FROM pg_trigger g WHERE NOT g.tgisinternal AND g.tgenabled = 'A'
       AND ((g.tgrelid = 'public.executie_tevi'::regclass AND g.tgname = 'trg_executie_tevi_izo_delete' AND g.tgfoid = 'public.fn_izo_refuz_delete_tevi()'::regprocedure)
         OR (g.tgrelid = 'public.executie_tevi'::regclass AND g.tgname = 'trg_executie_tevi_izo_mutare' AND g.tgfoid = 'public.fn_izo_refuz_mutare_tevi()'::regprocedure)
         OR (g.tgrelid = 'public.executie_pachete_lansare'::regclass AND g.tgname = 'trg_pachete_izo_delete' AND g.tgfoid = 'public.fn_izo_refuz_delete_pachet()'::regprocedure))) <> 3 THEN
    RAISE EXCEPTION 'Revenire 20261102c: trigger-ele căilor vechi s-au schimbat — refuz';
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
  v_scrisa := substring(obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') FROM 'amprenta=([0-9a-f]{32})');
  v_inainte := substring(obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') FROM 'inainte_20261102c=([0-9a-f]{32})');
  IF v_amprenta IS NULL OR v_amprenta IS DISTINCT FROM v_scrisa OR v_inainte IS NULL THEN
    RAISE EXCEPTION 'Revenire 20261102c: amprenta diferă de COMMENT (acum %, scrisă %, înainte %) — ceva s-a schimbat după migrare; refuz', v_amprenta, v_scrisa, v_inainte;
  END IF;

  CREATE OR REPLACE FUNCTION public.fn_izo_refuz_delete_tevi() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v bigint[] := public.fn_izo_proiecte_pachet_blocat(OLD.pachet_id);
  BEGIN
    PERFORM public.fn_izo_lock_partajat(VARIADIC v);
    IF public.fn_izo_vreun_protejat(v) AND public.fn_izo_garda_scriitor() IS NOT TRUE THEN
      RAISE EXCEPTION 'izo: rândurile de pachet ale unui proiect cu registru (nivel ≠ off) nu se șterg din client' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END $f$;
  CREATE OR REPLACE FUNCTION public.fn_izo_refuz_mutare_tevi() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v bigint[];
  BEGIN
    IF NEW.pachet_id IS DISTINCT FROM OLD.pachet_id THEN
      -- părinții în ordinea id-urilor (doi mutători opuși nu se blochează circular)
      v := public.fn_izo_proiecte_pachet_blocat(least(OLD.pachet_id, NEW.pachet_id))
           || public.fn_izo_proiecte_pachet_blocat(greatest(OLD.pachet_id, NEW.pachet_id));
      PERFORM public.fn_izo_lock_partajat(VARIADIC v);
      IF public.fn_izo_vreun_protejat(v) AND public.fn_izo_garda_scriitor() IS NOT TRUE THEN
        RAISE EXCEPTION 'izo: țevile nu se mută între pachete dinspre/spre un proiect cu registru (nivel ≠ off)' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END $f$;
  CREATE OR REPLACE FUNCTION public.fn_izo_refuz_delete_pachet() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v bigint[] := array_remove(ARRAY[OLD.proiect_id, public.fn_izo_proiect_tronson_blocat(OLD.tronson_id)], NULL);
  BEGIN
    PERFORM public.fn_izo_lock_partajat(VARIADIC v);
    IF public.fn_izo_vreun_protejat(v) AND public.fn_izo_garda_scriitor() IS NOT TRUE THEN
      RAISE EXCEPTION 'izo: pachetele unui proiect cu registru (nivel ≠ off) nu se șterg din client' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END $f$;

  -- cele 3 funcții: owner postgres, DEFINER, search_path fix, EXECUTE doar postgres, volatile
  IF (SELECT count(*) FROM pg_proc p JOIN (VALUES ('fn_izo_refuz_delete_tevi', 'b9903281aa585f48f0768b514713a0c3'), ('fn_izo_refuz_mutare_tevi', '898a6ace8fb4faa955e577632645ae50'), ('fn_izo_refuz_delete_pachet', 'e9729f3e1f3609262db5600cbfe76388')) x(nume, md5) ON p.proname = x.nume
       WHERE p.pronamespace = 'public'::regnamespace AND pg_get_function_identity_arguments(p.oid) = '' AND md5(p.prosrc) = x.md5
         AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef AND p.provolatile = 'v'
         AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND p.proacl::text = '{postgres=X/postgres}') <> 3
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('fn_izo_refuz_delete_tevi', 'fn_izo_refuz_mutare_tevi', 'fn_izo_refuz_delete_pachet')) <> 3 THEN
    RAISE EXCEPTION 'Revenire 20261102c: corpurile refăcute nu au md5-ul E2a';
  END IF;
  IF (SELECT count(*) FROM pg_trigger g WHERE NOT g.tgisinternal AND g.tgenabled = 'A'
       AND ((g.tgrelid = 'public.executie_tevi'::regclass AND g.tgname = 'trg_executie_tevi_izo_delete' AND g.tgfoid = 'public.fn_izo_refuz_delete_tevi()'::regprocedure)
         OR (g.tgrelid = 'public.executie_tevi'::regclass AND g.tgname = 'trg_executie_tevi_izo_mutare' AND g.tgfoid = 'public.fn_izo_refuz_mutare_tevi()'::regprocedure)
         OR (g.tgrelid = 'public.executie_pachete_lansare'::regclass AND g.tgname = 'trg_pachete_izo_delete' AND g.tgfoid = 'public.fn_izo_refuz_delete_pachet()'::regprocedure))) <> 3 THEN
    RAISE EXCEPTION 'Revenire 20261102c: trigger-ele căilor vechi s-au schimbat după revenire';
  END IF;
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN
    RAISE EXCEPTION 'Revenire 20261102c: porțile nu sunt complete după revenire: %', v_lipsa;
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
  IF v_amprenta IS DISTINCT FROM v_inainte THEN
    RAISE EXCEPTION 'Revenire 20261102c: amprenta după revenire (%) ≠ cea de dinainte de 20261102c (%)', v_amprenta, v_inainte;
  END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',
    'Registrul de țeavă Transgaz (izometrie) — evenimente, doar adaug. Scris doar de funcțiile izo_registru_writer. 20261102a. amprenta=' || v_amprenta);
  RAISE NOTICE 'Revenire 20261102c: gărzile căilor vechi au definiția E2a; amprentele refăcute (%)', v_amprenta;
END
$revenire$;
