-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261102a_izometrie_e2a_registru_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Scoate tot ce a pus 20261102a: rolul izo_registru_writer, tabelele izo (config, atribuiri, importuri, registrul),
--   secvența izo_server_ver_seq, funcțiile fn_izo_*, triggerele și politicile izo, coloanele/CHECK-urile/indexurile
--   noi de pe magazie_bucati (CHECK-urile stare/locatie_tip revin la forma live din 20.10.2026), triggerele de pe
--   executie_tevi / executie_pachete_lansare / executie_tronsoane / logistica_depozite / executie_proiecte /
--   executie_bonuri_consum_linii; TRUNCATE pe magazie_bucati revine la service_role.
-- REFUZĂ dacă există orice dată a modulului: rânduri în izo_proiect_config / izo_atribuiri / izo_importuri /
--   magazie_bucati_evenimente / magazie_bucati_miscari sau bucăți cu tip_cod setat. Un registru cu date reale nu se
--   scoate pe tăcute: întâi storno + export + decizia lui Răzvan, într-o operație separată.
-- AMPRENTĂ: recalculează amprenta obiectelor izo cu EXACT expresia din migrare (blocul <amprenta>, verificat textual de
--   harness) și cere ca ea să fie ȘI cea din COMMENT-ul lui magazie_bucati_evenimente, ȘI una dintre cele fixate mai jos.
-- UN SINGUR bloc DO: armarea, LOCK-urile, verificările, DROP-urile și postcondițiile sunt o singură instrucțiune.
-- UI-ul care folosește obiectele izo se retrage ÎNAINTE (revert PR).
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261102a', 'IZO_E2A_SCOATE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $revenire$
DECLARE
  v_amprenta text;
  v_scrisa text;
  -- amprente FIXATE: valoarea așteptată nu stă doar pe obiectul pe care îl protejează. ÎNAINTE de apply pe producție se
  -- confirmă printr-un dry-run (migrarea în tranzacție anulată, amprenta citită din COMMENT); dacă diferă (PG17 vs PG16,
  -- ACL-uri live), se adaugă aici și perechea se re-revizuiește ÎNAINTE de apply.
  c_amprente text[] := ARRAY[
    '53f214aef5639e6936358e966b6b7928',  -- branch Supabase PG17.11, postgres non-superuser (retestul r15 din 21.10.2026, head 92ef00a1)
    '0afb9bcabcdf25f43692ce95c8687699',  -- harness local PG16 (scripts/test_izometrie_e2a.sh)
    -- după 20261102c (gărzile căilor vechi înlocuite; revenirea E2a le scoate oricum):
    'e94fd79561c1630c2ac667054ef789f5',  -- producție PG17, calculată read-only pe 21.10.2026 (md5-urile noi substituite)
    'ad229ad498e3d350f2a143d3a8b51710'  -- 20261102c, harness PG16
    -- dacă se revine E2a direct peste 20261102c (posibil doar fără date), se șterge și rândul 20261102c din
    -- supabase_migrations.schema_migrations, altfel o relivrare îl vede „aplicat” fără funcții
  ];
BEGIN
  -- 1. armare legată de tranzacția curentă; fără armare persistentă; doar postgres
  IF current_setting('gazpet.revenire_20261102a', true) IS DISTINCT FROM 'IZO_E2A_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261102a: nearmată (gazpet.revenire_20261102a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261102a=%') THEN
    RAISE EXCEPTION 'Revenire 20261102a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Revenire 20261102a: rulează ca postgres';
  END IF;
  IF to_regclass('public.magazie_bucati_evenimente') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'izo_registru_writer') THEN
    RAISE EXCEPTION 'Revenire 20261102a: obiectele izo nu există — nimic de scos';
  END IF;

  -- 2. lock-uri (nimeni nu mai scrie între verificare și DROP)
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE public.magazie_bucati, public.izo_proiect_config, public.izo_atribuiri, public.izo_importuri,
             public.magazie_bucati_evenimente, public.magazie_bucati_miscari, public.executie_tevi, public.executie_pachete_lansare,
             public.executie_bonuri_consum_linii, public.executie_tronsoane, public.logistica_depozite, public.executie_proiecte IN ACCESS EXCLUSIVE MODE;

  -- 3. fără date ale modulului
  IF EXISTS (SELECT 1 FROM public.izo_proiect_config) OR EXISTS (SELECT 1 FROM public.izo_atribuiri)
     OR EXISTS (SELECT 1 FROM public.izo_importuri) OR EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente)
     OR EXISTS (SELECT 1 FROM public.magazie_bucati_miscari) OR EXISTS (SELECT 1 FROM public.magazie_bucati WHERE tip_cod IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.magazie_bucati WHERE stare NOT IN ('sosit','receptionat','rezervata','montata','consumata','retur')
                   OR locatie_tip NOT IN ('sediu','proiect'))
     -- toate coloanele noi (CHECK-ul doar_registru le ține NULL în afara registrului; verificat explicit, review #806 P1-4)
     OR EXISTS (SELECT 1 FROM public.magazie_bucati WHERE uid IS NOT NULL OR parinte_id IS NOT NULL OR radacina_id IS NOT NULL
                   OR cod_bucata IS NOT NULL OR capat_stanga IS NOT NULL OR capat_dreapta IS NOT NULL OR dezambiguare IS NOT NULL
                   OR lungime_aviz_mm IS NOT NULL OR lungime_masurata_mm IS NOT NULL OR lungime_mm IS NOT NULL OR lungime_calculata
                   OR perete_mm IS NOT NULL OR diametru_mm IS NOT NULL OR lot IS NOT NULL OR aviz_intrare_id IS NOT NULL
                   OR nr_crt_aviz IS NOT NULL OR bend_no IS NOT NULL OR capat_marcaj IS NOT NULL OR depozit_id IS NOT NULL
                   OR tronson_id IS NOT NULL OR server_ver IS NOT NULL) THEN
    RAISE EXCEPTION 'Revenire 20261102a: modulul are date reale (config/atribuiri/importuri/registru/bucăți în stări noi) — storno + export + decizie întâi; refuz';
  END IF;
  -- view-uri dependente de tabelele izo
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class
              WHERE d.refobjid IN ('public.izo_proiect_config'::regclass, 'public.izo_atribuiri'::regclass, 'public.izo_importuri'::regclass,
                                   'public.magazie_bucati_evenimente'::regclass, 'public.magazie_bucati_miscari'::regclass)
                AND v.oid NOT IN (d.refobjid)) THEN
    RAISE EXCEPTION 'Revenire 20261102a: există view-uri care depind de tabelele izo — se scot întâi; refuz';
  END IF;

  -- 4. amprenta exactă a obiectelor lăsate de 20261102a
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
  IF v_amprenta IS DISTINCT FROM v_scrisa OR NOT (v_amprenta = ANY (c_amprente)) THEN
    RAISE EXCEPTION 'Revenire 20261102a: amprenta obiectelor izo diferă (acum %, în COMMENT %) — ceva s-a schimbat după migrare; refuz', v_amprenta, v_scrisa;
  END IF;

  -- 5. scoaterea (ordinea inversă a migrării)
  DROP TRIGGER trg_bon_linii_izo_bucata ON public.executie_bonuri_consum_linii;
  DROP TRIGGER trg_depozite_izo_mutare ON public.logistica_depozite;
  DROP TRIGGER trg_proiecte_izo_site ON public.executie_proiecte;
  DROP TRIGGER trg_tronsoane_izo_mutare ON public.executie_tronsoane;
  DROP TRIGGER trg_executie_tevi_izo_delete ON public.executie_tevi;
  DROP TRIGGER trg_executie_tevi_izo_mutare ON public.executie_tevi;
  DROP TRIGGER trg_pachete_izo_delete ON public.executie_pachete_lansare;
  DROP TRIGGER trg_pachete_izo_truncate ON public.executie_pachete_lansare;
  DROP TRIGGER trg_executie_tevi_izo_truncate ON public.executie_tevi;
  DROP TRIGGER trg_pachete_izo_mutare ON public.executie_pachete_lansare;
  DROP TRIGGER trg_magbuc_izo_garda ON public.magazie_bucati;
  DROP TRIGGER trg_magbuc_izo_truncate ON public.magazie_bucati;
  DROP POLICY magbuc_izo_client_ins ON public.magazie_bucati;
  DROP POLICY magbuc_izo_client_upd ON public.magazie_bucati;
  DROP POLICY magbuc_izo_client_del ON public.magazie_bucati;
  DROP POLICY magbuc_izo_client_sel ON public.magazie_bucati;
  DROP POLICY magbuc_izo_writer_sel ON public.magazie_bucati;
  DROP POLICY magbuc_izo_writer_ins ON public.magazie_bucati;
  DROP POLICY magbuc_izo_writer_upd ON public.magazie_bucati;
  DROP TABLE public.magazie_bucati_miscari;
  DROP TABLE public.izo_importuri;
  DROP TABLE public.magazie_bucati_evenimente;
  DROP TABLE public.izo_atribuiri;
  DROP TABLE public.izo_proiect_config;
  DROP SEQUENCE public.izo_server_ver_seq;
  -- funcțiile writer-ului le scoate owner-ul lor (pe Supabase postgres nu e superuser): SET ROLE pe writer
  SET LOCAL ROLE izo_registru_writer;
  DROP FUNCTION public.fn_izo_activeaza_si_importa(bigint, text, jsonb, text), public.fn_izo_seteaza_nivel(bigint, text, text),
    public.fn_izo_import_sold_initial(bigint, text, jsonb), public.fn_izo_import_storno(bigint, text, text);
  RESET ROLE;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261102a: rolul nu a revenit la postgres'; END IF;
  DROP FUNCTION public.fn_izo_pachete_neconcordante(bigint), public.fn_izo_refuz_bon_bucata(), public.fn_izo_refuz_delete_tevi(), public.fn_izo_refuz_delete_pachet(),
    public.fn_izo_refuz_mutare_tevi(), public.fn_izo_refuz_mutare_pachet(), public.fn_izo_refuz_mutare_tronson(), public.fn_izo_refuz_mutare_depozit(),
    public.fn_izo_garda_atribuiri(), public.fn_izo_porti_lipsa(), public.fn_izo_lock_proiect(bigint, boolean), public.fn_izo_depozit_in_registru(integer),
    public.fn_izo_refuz_site_proiect(), public.fn_izo_lock_partajat(bigint[]), public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[]),
    public.fn_izo_porti_definitii(), public.fn_izo_proiecte_site(integer), public.fn_izo_bucata_proiect(bigint),
    public.fn_izo_proiect_tronson_blocat(bigint), public.fn_izo_vreun_protejat(bigint[]), public.fn_izo_refuz_truncate_cai_vechi(), public.fn_izo_blocheaza_tabele(),
    public.fn_izo_garda_fapte(), public.fn_izo_garda_truncate_bucati(), public.fn_izo_garda_bucati(), public.fn_izo_garda_scriitor(),
    public.fn_izo_proiecte_pachet_blocat(bigint), public.fn_izo_uid(), public.fn_izo_site_proiect(bigint), public.fn_izo_loc_valid(bigint, integer, bigint),
    public.fn_izo_tip_material(text), public.fn_izo_tip_cod(integer), public.fn_izo_bucata_protejata(bigint),
    public.fn_izo_proiecte_protejate(), public.fn_izo_citire(bigint), public.fn_izo_acces(bigint, text, text, text),
    public.fn_izo_nivel(bigint);
  DROP INDEX public.ux_magbuc_izo_radacina, public.ux_magbuc_izo_frunza, public.ux_magbuc_izo_curba, public.ux_magbuc_izo_cod,
    public.ux_magbuc_izo_uid, public.ix_magbuc_izo_depozit, public.ix_magbuc_izo_tronson, public.ix_magbuc_izo_radacina;
  ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_izo_doar_registru_check, DROP CONSTRAINT magazie_bucati_izo_loc_check, DROP CONSTRAINT magazie_bucati_izo_valori_check,
    DROP CONSTRAINT magazie_bucati_izo_radacina_check, DROP CONSTRAINT magazie_bucati_izo_registru_check,
    DROP CONSTRAINT magazie_bucati_izo_tip_cod_check, DROP CONSTRAINT magazie_bucati_stare_check,
    DROP CONSTRAINT magazie_bucati_locatie_tip_check;
  ALTER TABLE public.magazie_bucati
    ADD CONSTRAINT magazie_bucati_stare_check CHECK (stare = ANY (ARRAY['sosit'::text, 'receptionat'::text, 'rezervata'::text, 'montata'::text, 'consumata'::text, 'retur'::text])),
    ADD CONSTRAINT magazie_bucati_locatie_tip_check CHECK (locatie_tip = ANY (ARRAY['sediu'::text, 'proiect'::text]));
  ALTER TABLE public.magazie_bucati
    DROP COLUMN serie_canon, DROP COLUMN lungime_cm, DROP COLUMN tip_cod, DROP COLUMN uid, DROP COLUMN parinte_id,
    DROP COLUMN radacina_id, DROP COLUMN cod_bucata, DROP COLUMN capat_stanga, DROP COLUMN capat_dreapta, DROP COLUMN dezambiguare,
    DROP COLUMN lungime_aviz_mm, DROP COLUMN lungime_masurata_mm, DROP COLUMN lungime_mm, DROP COLUMN lungime_calculata,
    DROP COLUMN perete_mm, DROP COLUMN diametru_mm, DROP COLUMN lot, DROP COLUMN aviz_intrare_id, DROP COLUMN nr_crt_aviz,
    DROP COLUMN bend_no, DROP COLUMN capat_marcaj, DROP COLUMN depozit_id, DROP COLUMN tronson_id, DROP COLUMN server_ver;
  REVOKE ALL ON TABLE public.magazie_bucati FROM izo_registru_writer;
  GRANT TRUNCATE ON TABLE public.magazie_bucati TO service_role;   -- starea de dinainte (precondiția 0h a migrării)
  REVOKE ALL ON SEQUENCE public.magazie_bucati_id_seq FROM izo_registru_writer;
  REVOKE ALL ON SCHEMA public FROM izo_registru_writer;
  REVOKE izo_registru_writer FROM postgres;
  DROP ROLE izo_registru_writer;

  -- 6. postcondiții
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'izo_registru_writer')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\_izo\_%')
     OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND (relname LIKE 'izo\_%' OR relname LIKE 'magazie\_bucati\_evenimente%'
                OR relname LIKE 'magazie\_bucati\_miscari%' OR relname LIKE '%\_izo\_%'))
     -- tipare ANCORATE, exact familiile create de migrare (dry-run-ul pe prod 21.10: '%izo%' liber prindea politicile
     -- existente „…_furnIZOri_…” — 9 politici de furnizori care nu țin de modul)
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND (tgname LIKE 'trg\_izo\_%' OR tgname LIKE '%\_izo\_%'))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE policyname LIKE 'izo\_%' OR policyname LIKE 'magbuc\_izo\_%')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'magazie_bucati' AND column_name IN ('tip_cod','serie_canon','depozit_id')) THEN
    RAISE EXCEPTION 'Revenire 20261102a: au rămas obiecte izo';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.magazie_bucati'::regclass AND conname = 'magazie_bucati_stare_check')
       IS DISTINCT FROM 'CHECK ((stare = ANY (ARRAY[''sosit''::text, ''receptionat''::text, ''rezervata''::text, ''montata''::text, ''consumata''::text, ''retur''::text])))'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.magazie_bucati'::regclass AND conname = 'magazie_bucati_locatie_tip_check')
       IS DISTINCT FROM 'CHECK ((locatie_tip = ANY (ARRAY[''sediu''::text, ''proiect''::text])))' THEN
    RAISE EXCEPTION 'Revenire 20261102a: CHECK-urile stare/locatie_tip nu au revenit la forma live';
  END IF;
  PERFORM set_config('gazpet.revenire_20261102a', '', true);
END
$revenire$;
