-- Revenire 20270105a_executie_rest_decontat. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: cele 4 vederi, cele 17 funcții fn_rest_decontat_*, trigger-ele trg_rest_decontat_*, tabelele executie_sl_detaliu_linii /
--   executie_sl_detaliu / executie_note_modificare, coloanele noi de pe proiect_articole (cheie, nota_id, act_aditional_id, mod_import, activ, fisier_amprenta,
--   confirmat_de, confirmat_la, tip_rand, cu constrângerile și indexurile lor) și de pe executie_proiecte (configurare_completa_la, configurare_exceptie_motiv).
-- Dacă 20270105b e aplicată (fn_executie_proiect_configurare_completa există), REFUZĂ: întâi revenirea 20270105b.
-- REFUZĂ (nimic schimbat) dacă există date scrise de calea nouă (L14): note, situații detaliate, rânduri confirmate / legate / retrase în proiect_articole,
--   proiecte cu configurarea declarată; ștergerea lor e o decizie separată (preview → „da” → apply, cu export înainte). Rândurile moștenite din
--   proiect_articole NU se ating (pierd doar coloana cheie, recalculabilă).
-- REFUZĂ dacă amprenta COMPLETĂ a obiectelor migrării (blocul AMPRENTA, identic cu cel din postcondițiile migrării) diferă de constanta revizuită, sau dacă
--   alte obiecte depind de cele scoase. Lock-urile se iau ÎNAINTEA verificărilor „fără date” (L14), NOWAIT.
-- Porțile Izometrie: executie_proiecte e în perimetrul E4b → ritualul PRE / ștampile / POST, ca în migrare.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270105a_executie_rest_decontat_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270105120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock (NOWAIT, ordinea L06): executie_proiecte, proiect_articole, executie_note_modificare, executie_sl_detaliu, executie_sl_detaliu_linii — ACCESS EXCLUSIVE.
-- Probe: scripts/pglite/test_executie_rest_decontat_local.mjs.
DO $pre$
DECLARE v_plafon text; v_amp text; v_n bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270105a_executie_rest_decontat_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270105a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270105a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270105a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270105a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270105a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: tabelele, vederile, cele 17 funcții, trigger-ele, coloanele
  IF to_regclass('public.executie_note_modificare') IS NULL OR to_regclass('public.executie_sl_detaliu') IS NULL OR to_regclass('public.executie_sl_detaliu_linii') IS NULL
     OR to_regclass('public.v_executie_rest_decontat_baza') IS NULL OR to_regclass('public.v_executie_rest_decontat') IS NULL
     OR to_regclass('public.v_executie_rest_decontat_obiect') IS NULL OR to_regclass('public.v_executie_rest_decontat_lipsuri') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_cheie(text, text, text, text)') IS NULL OR to_regprocedure('public.fn_rest_decontat_um(text)') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_sursa_autorizata(text, bigint, bigint, timestamptz)') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_drept(bigint, text)') IS NULL OR to_regprocedure('public.fn_rest_decontat_server()') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_aa_al_proiectului(bigint, bigint)') IS NULL OR to_regprocedure('public.fn_rest_decontat_are_oferta(bigint)') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_nota_garda()') IS NULL OR to_regprocedure('public.fn_rest_decontat_articole_garda()') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_sl_garda()') IS NULL OR to_regprocedure('public.fn_rest_decontat_baza_proiect(bigint)') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_baza_calcul()') IS NULL OR to_regprocedure('public.fn_rest_decontat_calcul()') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_obiect_calcul()') IS NULL OR to_regprocedure('public.fn_rest_decontat_lipsuri_calcul()') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_confirma_baza(bigint, text, bigint, bigint, text, text, text, jsonb)') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_confirma_situatie(bigint, text, bigint, text, text, jsonb, boolean, numeric)') IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_rest\_decontat\_%') <> 17
     OR (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('trg_rest_decontat_nota_garda', 'trg_rest_decontat_articole_garda', 'trg_rest_decontat_sl_garda', 'trg_rest_decontat_sl_linii_garda')) <> 4
     OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.proiect_articole'::regclass AND NOT a.attisdropped
          AND a.attname IN ('cheie', 'nota_id', 'act_aditional_id', 'mod_import', 'activ', 'fisier_amprenta', 'confirmat_de', 'confirmat_la', 'tip_rand')) <> 9
     OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.executie_proiecte'::regclass AND NOT a.attisdropped
          AND a.attname IN ('configurare_completa_la', 'configurare_exceptie_motiv')) <> 2 THEN
    RAISE EXCEPTION '20270105a revenire: starea nu e cea din 20270105a (obiectele migrarii lipsesc sau difera)';
  END IF;
  -- 20270105b intai (poarta foloseste coloanele si dreptul de aici)
  IF to_regprocedure('public.fn_executie_proiect_configurare_completa(bigint, text)') IS NOT NULL
     OR to_regclass('public.executie_proiect_configurare_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = 'trg_rest_decontat_configurare_garda') THEN
    RAISE EXCEPTION '20270105a revenire: 20270105b e aplicata — intai revenirea 20270105b';
  END IF;
  -- porțile Izometrie: există și sunt verzi înaintea primei schimbări
  IF to_regprocedure('public.fn_izo_porti_lipsa()') IS NULL OR to_regprocedure('public.fn_izo_porti_definitii()') IS NULL
     OR to_regprocedure('public.fn_izo_porti_e3_definitii()') IS NULL OR to_regprocedure('public.fn_izo_porti_e3b_definitii()') IS NULL
     OR to_regprocedure('public.fn_izo_porti_e4_definitii()') IS NULL OR to_regprocedure('public.fn_izo_porti_e4b_definitii()') IS NULL THEN
    RAISE EXCEPTION '20270105a revenire: portile Izometrie (20261230a) lipsesc';
  END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270105a revenire: portile Izometrie nu sunt verzi inainte: %', public.fn_izo_porti_lipsa();
  END IF;
  -- nimic altceva nu depinde de obiectele scoase: vederi peste ele (în afara celor 4), politici / funcții din afara migrării care le numesc
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid JOIN pg_class v ON v.oid = w.ev_class
              WHERE d.classid = 'pg_rewrite'::regclass AND v.relname NOT LIKE 'v\_executie\_rest\_decontat%'
                AND (d.refobjid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass,
                                    'public.v_executie_rest_decontat_baza'::regclass, 'public.v_executie_rest_decontat'::regclass,
                                    'public.v_executie_rest_decontat_obiect'::regclass, 'public.v_executie_rest_decontat_lipsuri'::regclass)
                     OR (d.refobjid = 'public.proiect_articole'::regclass AND d.refobjsubid IN (
                           SELECT attnum FROM pg_attribute WHERE attrelid = 'public.proiect_articole'::regclass
                              AND attname IN ('cheie', 'nota_id', 'act_aditional_id', 'mod_import', 'activ', 'fisier_amprenta', 'confirmat_de', 'confirmat_la', 'tip_rand')))
                     OR (d.refobjid = 'public.executie_proiecte'::regclass AND d.refobjsubid IN (
                           SELECT attnum FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname IN ('configurare_completa_la', 'configurare_exceptie_motiv')))))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename IN ('executie_note_modificare', 'executie_sl_detaliu', 'executie_sl_detaliu_linii'))
                 AND coalesce(qual, '') || coalesce(with_check, '') ~ 'fn_rest_decontat_')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                   AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_rest\_decontat\_%')
                   AND p.prosrc ~ '\m(fn_rest_decontat_[a-z_]+|v_executie_rest_decontat[a-z_]*|executie_note_modificare|executie_sl_detaliu(_linii)?)\M') THEN
    RAISE EXCEPTION '20270105a revenire: alte obiecte (vederi / politici / functii) depind de obiectele migrarii';
  END IF;
  -- lock-urile ÎNAINTEA verificărilor „fără date” (L14), NOWAIT, în ordinea din antet
  LOCK TABLE public.executie_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.proiect_articole IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.executie_note_modificare IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.executie_sl_detaliu IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.executie_sl_detaliu_linii IN ACCESS EXCLUSIVE MODE NOWAIT;
  SELECT count(*) INTO v_n FROM public.executie_note_modificare;
  IF v_n > 0 THEN RAISE EXCEPTION '20270105a revenire: % note NR / NCS scrise (executie_note_modificare) — decizie separata inainte; nimic schimbat', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.executie_sl_detaliu;
  IF v_n > 0 THEN RAISE EXCEPTION '20270105a revenire: % situatii detaliate confirmate (executie_sl_detaliu) — decizie separata inainte; nimic schimbat', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.proiect_articole a
   WHERE a.confirmat_la IS NOT NULL OR a.confirmat_de IS NOT NULL OR a.fisier_amprenta IS NOT NULL OR a.nota_id IS NOT NULL OR a.act_aditional_id IS NOT NULL
      OR a.mod_import IS NOT NULL OR a.activ IS NOT TRUE OR a.tip_rand <> 'articol';
  IF v_n > 0 THEN RAISE EXCEPTION '20270105a revenire: % randuri confirmate / legate / retrase in proiect_articole (date scrise de calea noua) — decizie separata inainte; nimic schimbat', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.executie_proiecte e WHERE e.configurare_completa_la IS NOT NULL OR e.configurare_exceptie_motiv IS NOT NULL;
  IF v_n > 0 THEN RAISE EXCEPTION '20270105a revenire: % proiecte configurate (configurare_completa_la) — decizie separata inainte; nimic schimbat', v_n; END IF;
  -- AMPRENTA_20270105a_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text || ' acl=' || coalesce(a.attacl::text, '-') AS l
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE NOT a.attisdropped AND a.attnum > 0
       AND ((c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass))
            OR (c.oid = 'public.proiect_articole'::regclass AND a.attname IN ('cheie', 'nota_id', 'act_aditional_id', 'mod_import', 'activ', 'fisier_amprenta', 'confirmat_de', 'confirmat_la', 'tip_rand'))
            OR (c.oid = 'public.executie_proiecte'::regclass AND a.attname IN ('configurare_completa_la', 'configurare_exceptie_motiv')))
    UNION ALL
    SELECT 'tab ' || c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity || ' acl=' || coalesce(c.relacl::text, '-') || ' own=' || pg_get_userbyid(c.relowner)
      FROM pg_class c WHERE c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass)
    UNION ALL
    SELECT 'con ' || c.relname || '.' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' defer=' || k.condeferrable || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype <> 'n' AND (c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass)
            OR k.conname IN ('proiect_articole_rd_mod_import_ck', 'proiect_articole_rd_tip_rand_ck', 'proiect_articole_rd_amprenta_ck', 'proiect_articole_rd_confirmat_ck',
                             'proiect_articole_rd_legaturi_ck', 'proiect_articole_nota_id_fkey', 'proiect_articole_act_aditional_id_fkey', 'executie_proiecte_configurare_motiv_ck'))
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' nnd=' || i.indnullsnotdistinct || ' valid=' || i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass)
        OR i.indexrelid::regclass::text IN ('proiect_articole_rd_cheie_ix', 'proiect_articole_rd_aa_ix', 'proiect_articole_rd_nota_ix')
    UNION ALL
    SELECT 'trg ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg\_rest\_decontat\_%'
    UNION ALL
    SELECT 'pol ' || c.relname || '.' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r), 'PUBLIC')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.oid IN ('public.executie_note_modificare'::regclass, 'public.executie_sl_detaliu'::regclass, 'public.executie_sl_detaliu_linii'::regclass)
    UNION ALL
    SELECT 'view ' || c.relname || ' opt=' || coalesce(array_to_string(c.reloptions, ';'), '-') || ' acl=' || coalesce(c.relacl::text, '-') || ' def=' || md5(pg_get_viewdef(c.oid))
      FROM pg_class c WHERE c.relkind = 'v' AND c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'v\_executie\_rest\_decontat%'
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_rest\_decontat\_%'
  ) x;
  -- AMPRENTA_20270105a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '5c4b43db182c4ee8f65a825f4e9c3b64' THEN
    RAISE NOTICE 'AMPRENTA_20270105a_TEXT %', v_amp;
    RAISE EXCEPTION '20270105a revenire: AMPRENTA obiectelor migrarii % (asteptat 5c4b43db182c4ee8f65a825f4e9c3b64): starea nu e cea din 20270105a; nimic schimbat',
      md5(coalesce(v_amp, ''));
  END IF;
END $pre$;

-- scoaterea (fără CASCADE): întâi ce depinde, apoi ce e dependență
DROP VIEW public.v_executie_rest_decontat_obiect;
DROP VIEW public.v_executie_rest_decontat;
DROP VIEW public.v_executie_rest_decontat_baza;
DROP VIEW public.v_executie_rest_decontat_lipsuri;
DROP FUNCTION public.fn_rest_decontat_obiect_calcul();
DROP FUNCTION public.fn_rest_decontat_calcul();
DROP FUNCTION public.fn_rest_decontat_lipsuri_calcul();
DROP FUNCTION public.fn_rest_decontat_baza_calcul();
DROP FUNCTION public.fn_rest_decontat_confirma_situatie(bigint, text, bigint, text, text, jsonb, boolean, numeric);
DROP FUNCTION public.fn_rest_decontat_confirma_baza(bigint, text, bigint, bigint, text, text, text, jsonb);
DROP FUNCTION public.fn_rest_decontat_baza_proiect(bigint);
DROP TABLE public.executie_sl_detaliu_linii;   -- cu trigger-ul și politica lui
DROP TABLE public.executie_sl_detaliu;
DROP FUNCTION public.fn_rest_decontat_sl_garda();
DROP TRIGGER trg_rest_decontat_articole_garda ON public.proiect_articole;
DROP FUNCTION public.fn_rest_decontat_articole_garda();
ALTER TABLE public.proiect_articole
  DROP CONSTRAINT proiect_articole_rd_mod_import_ck, DROP CONSTRAINT proiect_articole_rd_tip_rand_ck, DROP CONSTRAINT proiect_articole_rd_amprenta_ck,
  DROP CONSTRAINT proiect_articole_rd_confirmat_ck, DROP CONSTRAINT proiect_articole_rd_legaturi_ck,
  DROP COLUMN cheie, DROP COLUMN nota_id, DROP COLUMN act_aditional_id, DROP COLUMN mod_import, DROP COLUMN activ, DROP COLUMN fisier_amprenta,
  DROP COLUMN confirmat_de, DROP COLUMN confirmat_la, DROP COLUMN tip_rand;   -- indexurile parțiale și FK-urile cad cu coloanele
DROP FUNCTION public.fn_rest_decontat_sursa_autorizata(text, bigint, bigint, timestamptz);   -- după CHECK-ul care o folosea (rd_legaturi_ck)
DROP TABLE public.executie_note_modificare;   -- cu trigger-ul și politicile lui
DROP FUNCTION public.fn_rest_decontat_nota_garda();
DROP FUNCTION public.fn_rest_decontat_are_oferta(bigint);
DROP FUNCTION public.fn_rest_decontat_aa_al_proiectului(bigint, bigint);
DROP FUNCTION public.fn_rest_decontat_server();
DROP FUNCTION public.fn_rest_decontat_drept(bigint, text);
DROP FUNCTION public.fn_rest_decontat_um(text);
DROP FUNCTION public.fn_rest_decontat_cheie(text, text, text, text);
ALTER TABLE public.executie_proiecte
  DROP CONSTRAINT executie_proiecte_configurare_motiv_ck,
  DROP COLUMN configurare_completa_la, DROP COLUMN configurare_exceptie_motiv;

DO $post$
BEGIN
  IF to_regclass('public.executie_note_modificare') IS NOT NULL OR to_regclass('public.executie_sl_detaliu') IS NOT NULL OR to_regclass('public.executie_sl_detaliu_linii') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'v\_executie\_rest\_decontat%')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_rest\_decontat\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg\_rest\_decontat\_%')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.proiect_articole'::regclass AND NOT a.attisdropped
                 AND a.attname IN ('cheie', 'nota_id', 'act_aditional_id', 'mod_import', 'activ', 'fisier_amprenta', 'confirmat_de', 'confirmat_la', 'tip_rand'))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.executie_proiecte'::regclass AND NOT a.attisdropped AND a.attname IN ('configurare_completa_la', 'configurare_exceptie_motiv'))
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conname IN ('proiect_articole_rd_mod_import_ck', 'proiect_articole_rd_tip_rand_ck', 'proiect_articole_rd_amprenta_ck',
                 'proiect_articole_rd_confirmat_ck', 'proiect_articole_rd_legaturi_ck', 'executie_proiecte_configurare_motiv_ck'))
     OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('proiect_articole_rd_cheie_ix', 'proiect_articole_rd_aa_ix', 'proiect_articole_rd_nota_ix')) THEN
    RAISE EXCEPTION '20270105a revenire post: au ramas obiecte';
  END IF;
  -- ștampilele porților Izometrie, CALCULATE după ultima schimbare (coloanele scoase de pe executie_proiecte)
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L', 'porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L', 'porti_e4=' || public.fn_izo_porti_e4_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270105a revenire post: portile Izometrie nu sunt verzi dupa: %', public.fn_izo_porti_lipsa();
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270105a_executie_rest_decontat_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270105a revenire: garda final invalida';
  END IF;
END $post$;
