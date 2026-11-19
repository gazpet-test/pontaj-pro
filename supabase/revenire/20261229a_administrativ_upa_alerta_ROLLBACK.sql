-- Revenire 20261229a_administrativ_upa_alerta. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce upa_achizitii la politica veche upa_achizitii_all IDENTICĂ în catalog (ALL, permisivă, USING auth.uid() IS NOT NULL, cu rolurile și
--   clauza WITH CHECK de dinainte, păstrate de migrare în comentariul politicii upa_achizitii_citire: roluri_vechi=public|authenticated
--   check_vechi=gol|uid) și scoate tot ce a creat migrarea: upa_plafon_lunar, upa_luna_inchisa, upa_alerta_jurnal (cu politicile, triggerul și
--   secvența lor), cele 19 funcții fn_upa_*, triggerul trg_upa_achizitii_intentie și coloanele upa_achizitii.cheie_intentie / hash_intentie
--   (cu UNIQUE-ul și CHECK-ul lor).
-- REFUZĂ (nimic schimbat) dacă: amprenta COMPLETĂ a obiectelor migrării (definiții, proprietari, ACL pe tabele și pe coloane, RLS, coloane,
--   constrângeri, indecși, triggere, secvență, politici, sursa funcțiilor, ORICE obiect dependent de coloanele noi — blocul AMPRENTA, identic cu
--   cel din postcondițiile migrării) diferă de constanta revizuită, sau dacă au apărut DATE noi: o lună închisă, un rând în jurnalul alertei sau
--   un plafon schimbat din ecran (orice rând în afara celui de la aplicare). Lock-urile se iau ÎNAINTE de verificări (L14).
-- Dependențele (runda 3, corectat după review): DROP fără CASCADE pică (tranzacția se anulează întreagă) doar pentru dependențele NORMALE pe
--   tabelele și funcțiile migrării (o vedere, o politică sau un trigger nou care le folosește; de ex. politicile 20261229c pe fn_upa_poate_scrie).
--   DROP COLUMN scoate însă TĂCUT dependențele AUTOMATE ale coloanei (un index / o constrângere / o statistică adăugate ulterior pe ea, cu orice
--   nume) și drepturile pe coloană: de aceea amprenta conține ACL-ul fiecărei coloane și toate rândurile pg_depend care trimit la coloanele noi —
--   orice astfel de obiect în plus = refuz înainte de orice DROP. Ordinea revenirilor: 20261229c -> 20261229b -> 20261229a.
-- EXCEPȚIE DECLARATĂ: valorile din upa_achizitii.cheie_intentie / hash_intentie se pierd odată cu coloanele (doar cheile și amprentele
--   reîncercărilor din formular; achizițiile rămân neatinse, inclusiv created_by pus de fn_upa_achizitie_adauga). Ecranul se retrage înainte,
--   deci nu mai e nicio reîncercare în curs care să aibă nevoie de ele.
-- Notificările deja puse în aplicație rămân (sunt mesaje către oameni, nu se șterg).
-- Ordinea: edge-ul upa-plafon-alerta se retrage ÎNAINTE (versiunea anterioară, v9, citește doar logistica_setari / upa_achizitii); ecranul la fel.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261229a_administrativ_upa_alerta_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261229120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri (NOWAIT, ordinea FIXĂ): upa_achizitii -> upa_plafon_lunar -> upa_luna_inchisa -> upa_alerta_jurnal, toate ACCESS EXCLUSIVE.
-- Probe: scripts/pglite/test_upa_alerta_local.mjs.
DO $pre$
DECLARE v_plafon text; v_amp text; v_vechi text[];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229a_administrativ_upa_alerta_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261229a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261229a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261229a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261229a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261229a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.upa_plafon_lunar') IS NULL OR to_regclass('public.upa_luna_inchisa') IS NULL OR to_regclass('public.upa_alerta_jurnal') IS NULL
     OR to_regprocedure('public.fn_upa_poate_scrie()') IS NULL OR to_regprocedure('public.fn_upa_achizitie_adauga(uuid, jsonb)') IS NULL
     OR to_regclass('public.upa_achizitii_cheie_intentie_uidx') IS NULL THEN
    RAISE EXCEPTION '20261229a revenire: starea nu e cea din 20261229a (tabelele / functiile / cheia migrarii lipsesc)';
  END IF;
  -- lock-urile ÎNAINTEA verificărilor (L14), NOWAIT, ordinea fixă
  LOCK TABLE public.upa_achizitii IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_plafon_lunar IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_luna_inchisa IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.upa_alerta_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
  -- amprenta COMPLETĂ a obiectelor migrării = constanta revizuită (aceeași verificată de postcondițiile migrării la aplicare)
  -- AMPRENTA_20261229a_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul; PG17 / PG18: NOT NULL-urile din pg_constraint scoase)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'rel ' || c.relname || ' ' || c.relkind::text || ' own=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(c.relacl) e) a), '-') AS l
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal', 'upa_alerta_jurnal_id_seq')
    UNION ALL
    SELECT 'rls upa_achizitii ' || c.relrowsecurity || ' ' || c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'public.upa_achizitii'::regclass
    UNION ALL
    SELECT 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' id=' || a.attidentity::text
           || ' gen=' || a.attgenerated::text || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || ' acl=' || coalesce((SELECT string_agg(e.d, ',' ORDER BY e.d COLLATE "C") FROM (
                SELECT CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ':' || x.privilege_type
                       || CASE WHEN x.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(a.attacl) x) e), '-')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal') OR (c.relname = 'upa_achizitii' AND a.attname IN ('cheie_intentie', 'hash_intentie')))
    UNION ALL
    SELECT 'con ' || c.relname || ' ' || k.conname || ' ' || k.contype::text || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype <> 'n' AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal')
            OR (c.relname = 'upa_achizitii' AND k.conname IN ('upa_achizitii_cheie_intentie_uidx', 'upa_achizitii_hash_intentie_cu_cheie')))
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' own=' || pg_get_userbyid(ic.relowner)
      FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE t.relnamespace = 'public'::regnamespace
       AND (t.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal') OR (t.relname = 'upa_achizitii' AND ic.relname = 'upa_achizitii_cheie_intentie_uidx'))
    UNION ALL
    SELECT 'trg ' || c.relname || ' ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal') OR (c.relname = 'upa_achizitii' AND t.tgname = 'trg_upa_achizitii_intentie'))
    UNION ALL
    -- runda 3 (L14 / L15): ORICE obiect care depinde de coloanele noi din upa_achizitii (index / constrângere / statistică / vedere / politică /
    --   trigger, oricum s-ar numi) — DROP COLUMN ar scoate tăcut dependențele automate, deci orice dependență în plus schimbă amprenta
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> upa_achizitii.' || a.attname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
     WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.upa_achizitii'::regclass AND a.attname IN ('cheie_intentie', 'hash_intentie')
    UNION ALL
    SELECT 'pol ' || c.relname || ' ' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(rl.nume, ',' ORDER BY rl.nume COLLATE "C") FROM (
                SELECT CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END AS nume FROM unnest(p.polroles) ro) rl), '-')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal', 'upa_achizitii')
    UNION ALL
    SELECT 'seq ' || c.relname || ' ' || format_type(s.seqtypid, NULL) || ' ' || s.seqstart || ' ' || s.seqincrement || ' ' || s.seqmin || ' ' || s.seqmax
           || ' ' || s.seqcache || ' ' || s.seqcycle
      FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'upa_alerta_jurnal_id_seq'
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_poate_scrie', 'fn_upa_plafon_la', 'fn_upa_luni', 'fn_upa_destinatari',
             'fn_upa_lei', 'fn_upa_luna_text', 'fn_upa_zile_text', 'fn_upa_erori_config', 'fn_upa_plafon_seteaza', 'fn_upa_alerta_inscrie',
             'fn_upa_alerta_rezerva_la', 'fn_upa_alerta_rezerva', 'fn_upa_alerta_proba', 'fn_upa_alerta_marcheaza', 'fn_upa_luna_inchisa_nemodificabil',
             'fn_upa_campuri_intentie', 'fn_upa_hash_intentie', 'fn_upa_achizitii_intentie', 'fn_upa_achizitie_adauga')
  ) x;
  -- AMPRENTA_20261229a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '5cfb266b3a0b8376266318fffc7bf042' THEN
    RAISE NOTICE 'AMPRENTA_20261229a_TEXT %', v_amp;
    RAISE EXCEPTION '20261229a revenire: AMPRENTA obiectelor migrarii % (asteptat 5cfb266b3a0b8376266318fffc7bf042): starea nu e cea din 20261229a; nimic schimbat',
      md5(coalesce(v_amp, ''));
  END IF;
  -- forma veche a politicii, păstrată de migrare în comentariu (rolurile + clauza WITH CHECK)
  SELECT regexp_match(obj_description(p.oid, 'pg_policy'), ' roluri_vechi=(public|authenticated) check_vechi=(gol|uid)$') INTO v_vechi
    FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass AND p.polname = 'upa_achizitii_citire';
  IF v_vechi IS NULL THEN RAISE EXCEPTION '20261229a revenire: forma veche a politicii (roluri_vechi / check_vechi) lipseste din comentariu'; END IF;
  -- fără date noi
  IF EXISTS (SELECT 1 FROM public.upa_luna_inchisa) THEN
    RAISE EXCEPTION '20261229a revenire: exista luni inchise (istoric nou); nimic schimbat';
  END IF;
  IF EXISTS (SELECT 1 FROM public.upa_alerta_jurnal) THEN
    RAISE EXCEPTION '20261229a revenire: jurnalul alertei are randuri (istoric nou); nimic schimbat';
  END IF;
  IF (SELECT count(*) FROM public.upa_plafon_lunar) > 1 OR EXISTS (SELECT 1 FROM public.upa_plafon_lunar p WHERE p.sursa <> 'migrare' OR p.setat_de IS NOT NULL) THEN
    RAISE EXCEPTION '20261229a revenire: plafonul a fost schimbat din ecran (configurare noua); nimic schimbat';
  END IF;
END $pre$;

-- politica veche, identic în catalog: una din cele 2 x 2 forme acceptate de migrare (rolurile public / authenticated; fără WITH CHECK sau
--   WITH CHECK (auth.uid() IS NOT NULL)); verificată imediat după creare pe roluri, comandă, permisivitate, USING și CHECK
DO $rev$
DECLARE v_vechi text[]; v_pol text;
BEGIN
  SELECT regexp_match(obj_description(p.oid, 'pg_policy'), ' roluri_vechi=(public|authenticated) check_vechi=(gol|uid)$') INTO v_vechi
    FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass AND p.polname = 'upa_achizitii_citire';
  IF v_vechi IS NULL THEN RAISE EXCEPTION '20261229a revenire: forma veche a politicii lipseste'; END IF;
  DROP POLICY upa_achizitii_citire ON public.upa_achizitii;
  DROP POLICY upa_achizitii_adaugare ON public.upa_achizitii;
  DROP POLICY upa_achizitii_modificare ON public.upa_achizitii;
  DROP POLICY upa_achizitii_stergere ON public.upa_achizitii;
  IF v_vechi[1] = 'public' AND v_vechi[2] = 'gol' THEN
    CREATE POLICY upa_achizitii_all ON public.upa_achizitii FOR ALL TO public USING (auth.uid() IS NOT NULL);
  ELSIF v_vechi[1] = 'public' THEN
    CREATE POLICY upa_achizitii_all ON public.upa_achizitii FOR ALL TO public USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
  ELSIF v_vechi[2] = 'gol' THEN
    CREATE POLICY upa_achizitii_all ON public.upa_achizitii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL);
  ELSE
    CREATE POLICY upa_achizitii_all ON public.upa_achizitii FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
  SELECT string_agg(p.polname || ' | ' || p.polcmd::text || ' | ' || CASE WHEN p.polpermissive THEN 'P' ELSE 'R' END || ' | '
                    || coalesce((SELECT string_agg(CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END, ',') FROM unnest(p.polroles) ro), '-') || ' | '
                    || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' | ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                    chr(10) ORDER BY p.polname)
    INTO v_pol FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass;
  -- (parantezele: condiția unui IF plpgsql se termină la primul THEN, inclusiv cel dintr-un CASE neîncadrat)
  IF v_pol IS DISTINCT FROM ('upa_achizitii_all | * | P | ' || (CASE v_vechi[1] WHEN 'public' THEN 'PUBLIC' ELSE 'authenticated' END)
                            || ' | (auth.uid() IS NOT NULL) | ' || (CASE v_vechi[2] WHEN 'gol' THEN '-' ELSE '(auth.uid() IS NOT NULL)' END)) THEN
    RAISE EXCEPTION '20261229a revenire: postconditie: politica veche upa_achizitii_all nu e identica (%)', v_pol;
  END IF;
END $rev$;

DROP TRIGGER trg_upa_achizitii_intentie ON public.upa_achizitii;
ALTER TABLE public.upa_achizitii DROP CONSTRAINT upa_achizitii_hash_intentie_cu_cheie;
ALTER TABLE public.upa_achizitii DROP CONSTRAINT upa_achizitii_cheie_intentie_uidx;
ALTER TABLE public.upa_achizitii DROP COLUMN hash_intentie;
ALTER TABLE public.upa_achizitii DROP COLUMN cheie_intentie;
DROP TABLE public.upa_alerta_jurnal;
DROP TABLE public.upa_luna_inchisa;
DROP TABLE public.upa_plafon_lunar;
DROP FUNCTION public.fn_upa_alerta_marcheaza(bigint, text, text, text);
DROP FUNCTION public.fn_upa_alerta_proba();
DROP FUNCTION public.fn_upa_alerta_rezerva();
DROP FUNCTION public.fn_upa_alerta_rezerva_la(date);
DROP FUNCTION public.fn_upa_alerta_inscrie(text, date, date, numeric, numeric, numeric, integer, text[], integer, text);
DROP FUNCTION public.fn_upa_achizitie_adauga(uuid, jsonb);
DROP FUNCTION public.fn_upa_achizitii_intentie();
DROP FUNCTION public.fn_upa_hash_intentie(jsonb);
DROP FUNCTION public.fn_upa_campuri_intentie();
DROP FUNCTION public.fn_upa_plafon_seteaza(numeric, numeric);
DROP FUNCTION public.fn_upa_erori_config(integer, numeric);
DROP FUNCTION public.fn_upa_zile_text(integer);
DROP FUNCTION public.fn_upa_luna_text(date);
DROP FUNCTION public.fn_upa_lei(numeric);
DROP FUNCTION public.fn_upa_destinatari(text);
DROP FUNCTION public.fn_upa_luni(date, integer);
DROP FUNCTION public.fn_upa_plafon_la(date);
DROP FUNCTION public.fn_upa_poate_scrie();
DROP FUNCTION public.fn_upa_luna_inchisa_nemodificabil();

DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass AND p.polname = 'upa_achizitii_all') THEN
    RAISE EXCEPTION '20261229a revenire: postconditie: politica veche upa_achizitii_all (singura)';
  END IF;
  IF to_regclass('public.upa_plafon_lunar') IS NOT NULL OR to_regclass('public.upa_luna_inchisa') IS NOT NULL OR to_regclass('public.upa_alerta_jurnal') IS NOT NULL
     OR to_regclass('public.upa_achizitii_cheie_intentie_uidx') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.upa_achizitii'::regclass AND a.attname IN ('cheie_intentie', 'hash_intentie') AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.upa_achizitii'::regclass AND t.tgname = 'trg_upa_achizitii_intentie')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['fn_upa_poate_scrie', 'fn_upa_plafon_la',
                  'fn_upa_luni', 'fn_upa_destinatari', 'fn_upa_lei', 'fn_upa_luna_text', 'fn_upa_zile_text', 'fn_upa_erori_config', 'fn_upa_plafon_seteaza',
                  'fn_upa_alerta_inscrie', 'fn_upa_alerta_rezerva_la', 'fn_upa_alerta_rezerva', 'fn_upa_alerta_proba', 'fn_upa_alerta_marcheaza',
                  'fn_upa_luna_inchisa_nemodificabil', 'fn_upa_campuri_intentie', 'fn_upa_hash_intentie', 'fn_upa_achizitii_intentie',
                  'fn_upa_achizitie_adauga'])) THEN
    RAISE EXCEPTION '20261229a revenire: postconditie: obiectele migrarii au ramas';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229a_administrativ_upa_alerta_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261229a revenire: garda final invalida';
  END IF;
END $post$;
