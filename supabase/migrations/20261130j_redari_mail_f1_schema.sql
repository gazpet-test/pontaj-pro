-- Version 20261130129000. Runner supplies one transaction.
-- 20261130j_redari_mail_f1_schema — Redări e-mail (redari@gazpet.ro), felia F1, pasul (1): SCHEMA INERTĂ (tabele + CHECK + RLS + GRANT + jurnal
-- + Storage). Plan: docs/redari/PLAN_EMAIL_REDARI.md r19e, §1.12 (inventarul unic), §1.8 (Storage, golire), §2.1 (roluri, red_jurnal_sel), §3 F1.
-- Implicitele decise de Răzvan 04.11.2026 pentru acest pas: (t) A = client OAuth separat pentru golire (gmail.modify), citirea pe gmail.readonly
-- → scop în red_mail_oauth_state: citire / citire_test / golire / golire_test; (u) A = copia din SENT neatinsă în F1 (nimic despre SENT aici);
-- (v) A = două verificări trash_tardiv (decizie + G, decizie + 24 h), risc rezidual acceptat (comportament de retenție, pasul 6, nu schemă).
-- ÎMPĂRȚIREA în două migrări (cerută ca opțiune în brief): 20261130j = obiectele INERTE (nicio cale de scriere pentru vreun rol al aplicației,
-- deci nu schimbă niciun comportament existent, cu excepția jurnalului și a Storage-ului, care trebuie să fie gata ÎNAINTE ca tabelele noi să
-- primească rânduri); 20261130k = comportamentul (triggerele de proveniență pe red_raspunsuri — schimbă ce poate scrie editorul azi —, mașinile
-- de stări / imutabilitatea pe red_mail_*, gardul owner pe red_proiecte.retentie_mail_pana, funcțiile de bază). Se aplică j, apoi k; revenirea
-- în ordine inversă. Motiv: review-ul și DRY-ul fiecărei părți rămân citibile, iar k se poate reface fără să atingă tabelele.
-- Ce face j:
--   • 9 tabele noi red_mail_* (§1.12): setari (1 rând), flux (rândurile inbox redari@ și redari-test@, inactive), primite, obiecte, dedup,
--     evenimente, raspuns_sursa, adrese_propuse, oauth_state; toate enumurile ca CHECK literal, UNIQUE-urile și FK-urile din inventar;
--   • red_proiecte.retentie_mail_pana (date, NULL) — gardul „doar owner” e în k;
--   • RLS pornit pe toate; politici DOAR de SELECT, doar admin / editor Redări (owner = admin prin fn_red_nivel); red_mail_oauth_state: niciuna;
--     GRANT: doar SELECT pentru authenticated / service_role (fără INSERT / UPDATE / DELETE / TRUNCATE pentru NICIUN rol al aplicației, inclusiv
--     service_role: toate scrierile vor trece prin RPC-uri SECURITY DEFINER, pașii 2–6); anon: nimic;
--   • fn_red_jurnal: pe tabelele red_mail_* jurnalul primește DOAR numele câmpurilor (ca la contact / meta) și id-ul doar dacă e uuid;
--     triggerul de jurnal pe red_mail_* în afară de evenimente (e deja jurnal) și oauth_state (secret de sesiune);
--   • red_jurnal_sel: rândurile red_mail_* intră în lista „doar admin / editor” (alături de red_detinatori_contact, red_raspunsuri_meta);
--   • Storage, bucketul redari: red_storage_sel / red_storage_ins / red_storage_coresp_sel exclud prefixul mail/ (conjunct de nivel superior
--     left(name, 5) <> 'mail/'); postcondiția verifică că nicio politică PERMISIVĂ pentru anon / authenticated / PUBLIC nu acoperă mail/.
--     INSERT / DELETE pe mail/ rămân doar service_role (ocolește RLS) — edge-urile pașilor 3 și 6.
-- Ce NU face (pașii următori din §3 F1): OAuth / Vault (2), ingestia / lease / cursor (3), RPC-urile de triere / înregistrare (4), proxy-ul (5),
-- retenția + Gmail (6), cronurile (NU se creează), vederile red_mail_v_* (cu UI-ul, pasul 4), ORDER BY-ul din red_v_stare_parcela (separat,
-- cu testul de paritate JS ↔ SQL pe datele reale). fn_red_storage_verifica_redari (20261130e) verifică predicatele VECHI ale Storage-ului și
-- aruncă după această migrare (intenționat: e verificatorul lui 20261130e); verificatorul nou e fn_red_mail_verifica_baza('dupa_j').
-- Căsuța de test: 'redari-test@gazpet.ro' (implicit (l), §1.1; casuta_cod 'redari-test' în căile mail/, §1.2) — literal în CHECK-uri.
-- Revenire: supabase/revenire/20261130j_redari_mail_f1_schema_ROLLBACK.sql (refuză dacă tabelele au rânduri în afara celor 3 rânduri inițiale
-- neatinse, dacă există obiecte sub mail/, valori retentie_mail_pana sau rânduri de jurnal red_mail_*; NU șterge date reale).
-- DRY: supabase/tests/20261130j_redari_mail_f1_dryrun.sql (prod: doar citiri + revenire) și _dryrun_local.sql + _schelet.sql (PG17 local).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130j_redari_mail_f1_schema:' || txid_current() THEN
    RAISE EXCEPTION '20261130j: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- Jak #987 P1-3 / r2 P1 (L01 / L06): TOATE blocările migrării, explicite, la început (înaintea verificărilor „fără date”), ținute până la commit,
  -- fiecare direct în modul cerut mai jos (fără upgrade de lock), în ORDINEA UNICĂ red_mail F1 (aceeași în j, k și în reveniri):
  --   (1) tabelele Redări existente, copiii înaintea părinților: red_raspunsuri → red_detinatori → red_parcele → red_corespondenta → red_proiecte
  --   (2) storage.objects   (3) red_jurnal   (4) red_mail_* (alfabetic)
  -- Ordinea aplicației: un scriitor Redări ia întâi tabela lui (ROW EXCLUSIVE), apoi verificările FK iau ROW SHARE pe părinți (red_detinatori,
  -- red_parcele, red_proiecte), triggerele BEFORE citesc eventual storage.objects (corespondența), iar triggerul AFTER de jurnal scrie la final
  -- în red_jurnal. Migrarea ia aceleași obiecte în aceeași ordine: așteaptă scriitorii deja porniți să termine (aceștia nu au nevoie de nimic
  -- din ce ține migrarea în acel moment), iar cei noi o așteaptă pe ea. red_proiecte (ACCESS EXCLUSIVE, incompatibil cu ROW SHARE-ul verificărilor
  -- FK ale copiilor) e ultimul dintre tabele, după copiii pe care îi blochează migrarea.
  -- Modurile: ținte ale FK-urilor noi SHARE ROW EXCLUSIVE (= modul luat de ADD FOREIGN KEY; compatibil cu ROW SHARE); red_proiecte ACCESS
  -- EXCLUSIVE (ADD COLUMN); storage.objects / red_jurnal ACCESS EXCLUSIVE (ALTER POLICY). Test: concurenta_local.sh S5 (scriitor telefonic).
  -- Limită: o tranzacție a aplicației care ar lua aceste obiecte în altă ordine (de ex. scrie în red_jurnal și abia apoi într-o tabelă Redări)
  -- poate intra în deadlock cu migrarea; PostgreSQL anulează atunci UNA dintre tranzacții (nu e garantat care) — nicio stare parțială.
  LOCK TABLE public.red_raspunsuri IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_detinatori IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_parcele IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_corespondenta IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.red_jurnal IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname ~ '^red_mail_')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname ~ '^fn_red_mail_') THEN
    RAISE EXCEPTION '20261130j: exista deja obiecte red_mail_* / fn_red_mail_*';
  END IF;
  IF to_regclass('public.red_raspunsuri') IS NULL OR to_regclass('public.red_jurnal') IS NULL OR to_regclass('public.red_proiecte') IS NULL
     OR to_regclass('public.red_detinatori') IS NULL OR to_regclass('public.red_parcele') IS NULL OR to_regclass('public.red_corespondenta') IS NULL
     OR to_regclass('public.red_corespondenta_fisiere') IS NULL OR to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR to_regprocedure('public.fn_red_nivel()') IS NULL OR to_regprocedure('public.fn_red_jurnal()') IS NULL
     OR to_regprocedure('public.fn_red_storage_expr_bucket(text)') IS NULL OR to_regprocedure('public.fn_red_storage_verifica_redari(boolean)') IS NULL
     OR to_regprocedure('storage.foldername(text)') IS NULL THEN
    RAISE EXCEPTION '20261130j: lipseste schema Redari / Storage (tabele, fn_red_nivel, fn_red_jurnal, verificatorii storage)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name = 'retentie_mail_pana') THEN
    RAISE EXCEPTION '20261130j: red_proiecte.retentie_mail_pana exista deja';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'redari' AND left(name, 5) = 'mail/') THEN
    RAISE EXCEPTION '20261130j: exista deja obiecte sub redari/mail/ (asteptat 0)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_jurnal WHERE left(tabela, 9) = 'red_mail_') THEN
    RAISE EXCEPTION '20261130j: red_jurnal are deja randuri red_mail_*';
  END IF;
END $pre$;

-- Amprenta L15 a obiectelor de care depinde migrarea, comparată cu baseline-ul citit read-only pe live (04.11.2026). Arunca la orice abatere.
--   'inainte'  = starea dinainte de j (preflight j și revenirea j, după revenire);
--   'dupa_j'   = starea după j (postcondiția j, preflight k, DRY);
-- SECURITY INVOKER (citește doar cataloage), search_path fix (deparse fără „public.”), fără EXECUTE pentru aplicație.
CREATE FUNCTION public.fn_red_mail_verifica_baza(p_faza text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  r record; v_n integer; v_expuse text[];
  v_jurnal_vechi constant text := '27479409c823996f436459089945c789';
  -- corpul fn_red_jurnal după j: md5 calculat pe textul din această migrare (postcondiția îl verifică)
  v_jurnal_nou constant text := '41ab451b7fcb499a2284c9c82367069e';
  v_jsel_vechi constant text := '((( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL) AND ((tabela <> ALL (ARRAY[''red_detinatori_contact''::text, ''red_raspunsuri_meta''::text])) OR (( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))))';
  v_jsel_nou constant text := '((( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL) AND (((tabela <> ALL (ARRAY[''red_detinatori_contact''::text, ''red_raspunsuri_meta''::text])) AND ("left"(tabela, 9) <> ''red_mail_''::text)) OR (( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))))';
  v_ss_nou constant text := '((bucket_id = ''redari''::text) AND (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text])) AND ("left"(name, 5) <> ''mail/''::text))';
  v_sv_nou constant text := '((bucket_id = ''redari''::text) AND ((storage.foldername(name))[2] = ''corespondenta''::text) AND (fn_red_nivel() = ''viewer''::text) AND (EXISTS ( SELECT 1 FROM red_corespondenta_fisiere f WHERE (f.path = objects.name))) AND ("left"(name, 5) <> ''mail/''::text))';
BEGIN
  IF p_faza NOT IN ('inainte', 'dupa_j') THEN RAISE EXCEPTION 'redari mail baza: faza necunoscuta %', p_faza; END IF;
  -- funcțiile de care depinde: corp, limbaj, DEFINER, volatilitate, search_path, owner, ACL (ca mulțime)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_red_nivel()',                     '21db8e5d4b69b7f19e571a7087c361ae', 'sql',     true,  's', ARRAY['authenticated=X/postgres', 'postgres=X/postgres', 'service_role=X/postgres']),
      ('public.fn_red_jurnal()',                    CASE WHEN p_faza = 'inainte' THEN v_jurnal_vechi ELSE v_jurnal_nou END, 'plpgsql', true, 'v', ARRAY['postgres=X/postgres']),
      ('public.fn_red_storage_expr_bucket(text)',   '9c54aa8fe03d15337ad2646ef0f75bc0', 'plpgsql', true,  'i', ARRAY['postgres=X/postgres']),
      ('public.fn_red_storage_verifica_redari(boolean)', 'b325d52f469a4c23cbb5f9afccfde6a3', 'plpgsql', false, 's', ARRAY['postgres=X/postgres']),
      -- Jak #987 P2-4: și funcțiile pe care se sprijină regulile din k (triggerele existente pe red_raspunsuri / red_jurnal / red_proiecte)
      ('public.fn_red_jurnal_imuabil()',            '8507fc337ca5046311232ee49e67ae9c', 'plpgsql', true,  'v', ARRAY['postgres=X/postgres']),
      ('public.fn_red_legaturi()',                  'd1912ec6514cba162babea3bcebdfb24', 'plpgsql', true,  'v', ARRAY['postgres=X/postgres']),
      ('public.fn_red_raspunsuri_valideaza()',      '3528222d7d8379dbbe8f3d2e64c60b94', 'plpgsql', true,  'v', ARRAY['postgres=X/postgres']),
      ('public.fn_red_versiune_creste()',           'e7ab9318de671f0a94c678ee382250db', 'plpgsql', false, 'v', ARRAY['postgres=X/postgres', 'service_role=X/postgres'])
    ) AS b(fn, md5_corp, limbaj, definer, vol, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND md5(replace(p.prosrc, chr(13), '')) = r.md5_corp AND l.lanname = r.limbaj AND p.prosecdef = r.definer
                      AND p.provolatile = r.vol AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres')
       OR (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = to_regprocedure(r.fn)) IS DISTINCT FROM r.acl::text[] THEN
      RAISE EXCEPTION 'redari mail baza (%): % nu mai e cea din baseline (corp / limbaj / DEFINER / volatilitate / search_path / owner / ACL)', p_faza, r.fn;
    END IF;
  END LOOP;
  -- auth.uid(): singura sursă de identitate a lui fn_red_nivel (baseline live 04.11.2026, ca în 20261130i)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language g ON g.oid = p.prolang
                  WHERE p.oid = 'auth.uid()'::regprocedure AND g.lanname = 'sql' AND NOT p.prosecdef AND p.provolatile = 's' AND p.pronargs = 0
                    AND p.prorettype = 'uuid'::regtype AND NOT p.proretset AND p.proconfig IS NULL
                    AND pg_get_userbyid(p.proowner) = 'supabase_auth_admin' AND md5(replace(p.prosrc, chr(13), '')) = 'cdef18c69c4f4cbbced2eaf81e628b49')
     OR (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = 'auth.uid()'::regprocedure)
       IS DISTINCT FROM ARRAY['=X/supabase_auth_admin', 'dashboard_user=X/supabase_auth_admin', 'supabase_auth_admin=X/supabase_auth_admin']::text[] THEN
    RAISE EXCEPTION 'redari mail baza (%): auth.uid() nu mai are amprenta revizuita', p_faza;
  END IF;
  -- Jak #987 P2-4: auth.role() (contextul de aplicație al gardului owner din k) și auth.jwt() (user_email în jurnal) — baseline live 04.11.2026
  FOR r IN SELECT * FROM (VALUES
      ('auth.role()', 'text',  'f31486fed08a7402e89d4aa71b0ad273', ARRAY['=X/supabase_auth_admin', 'dashboard_user=X/supabase_auth_admin', 'supabase_auth_admin=X/supabase_auth_admin']),
      ('auth.jwt()',  'jsonb', '2db09c3fc855ba90e71d3ae28cfadae3', ARRAY['=X/supabase_auth_admin', 'dashboard_user=X/supabase_auth_admin', 'postgres=X/supabase_auth_admin', 'supabase_auth_admin=X/supabase_auth_admin'])
    ) AS b(fn, ret, md5_corp, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language g ON g.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND g.lanname = 'sql' AND NOT p.prosecdef AND p.provolatile = 's' AND p.pronargs = 0
                      AND p.prorettype = r.ret::regtype AND NOT p.proretset AND p.proconfig IS NULL
                      AND pg_get_userbyid(p.proowner) = 'supabase_auth_admin' AND md5(replace(p.prosrc, chr(13), '')) = r.md5_corp)
       OR (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = to_regprocedure(r.fn)) IS DISTINCT FROM r.acl::text[] THEN
      RAISE EXCEPTION 'redari mail baza (%): % nu mai are amprenta revizuita', p_faza, r.fn;
    END IF;
  END LOOP;
  -- Jak #987 P2-4: protecțiile append-only ale red_jurnal — exact cele 2 triggere (funcție, tip, activ, fără argumente / WHEN)
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_jurnal'::regclass AND NOT tgisinternal) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_jurnal'::regclass AND tgname = 'trg_red_jurnal_imuabil' AND tgfoid = 'public.fn_red_jurnal_imuabil()'::regprocedure
                     AND tgtype = 27 AND tgenabled = 'O' AND tgnargs = 0 AND tgqual IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_jurnal'::regclass AND tgname = 'trg_red_jurnal_fara_truncate' AND tgfoid = 'public.fn_red_jurnal_imuabil()'::regprocedure
                     AND tgtype = 34 AND tgenabled = 'O' AND tgnargs = 0 AND tgqual IS NULL) THEN
    RAISE EXCEPTION 'redari mail baza (%): protectiile append-only ale red_jurnal nu sunt cele din baseline', p_faza;
  END IF;
  -- Jak #987 P2-4: red_raspunsuri — cele 3 triggere din baseline (k adaugă 2, verificate de k), politicile, privilegiile pe tabel și pe coloană
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND t.tgname = 'trg_red_jurnal' AND t.tgfoid = 'public.fn_red_jurnal()'::regprocedure AND t.tgtype = 29 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND t.tgname = 'trg_red_legaturi' AND t.tgfoid = 'public.fn_red_legaturi()'::regprocedure AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND t.tgname = 'trg_red_raspunsuri_valideaza' AND t.tgfoid = 'public.fn_red_raspunsuri_valideaza()'::regprocedure AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL)
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND NOT t.tgisinternal AND t.tgenabled <> 'O')
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND NOT t.tgisinternal
           AND t.tgname NOT IN ('trg_red_jurnal', 'trg_red_legaturi', 'trg_red_raspunsuri_valideaza', 'trg_red_raspunsuri_mail_sursa', 'trg_red_raspunsuri_zz_mail')) <> 0 THEN
    RAISE EXCEPTION 'redari mail baza (%): triggerele red_raspunsuri nu sunt cele din baseline', p_faza;
  END IF;
  -- Jak #987 r2 P2: red_proiecte — cele 2 triggere din baseline, exact (funcție, tip, activ, fără argumente / WHEN); singurul alt trigger
  -- permis e cel adăugat de k (verificat exact de k). Un trg_red_versiune redirecționat spre altă funcție = refuz.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_jurnal' AND t.tgfoid = 'public.fn_red_jurnal()'::regprocedure AND t.tgtype = 29 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_versiune' AND t.tgfoid = 'public.fn_red_versiune_creste()'::regprocedure AND t.tgtype = 19 AND t.tgenabled = 'O' AND t.tgnargs = 0 AND t.tgqual IS NULL)
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND NOT t.tgisinternal
                 AND t.tgname NOT IN ('trg_red_jurnal', 'trg_red_versiune', 'trg_red_proiecte_retentie_mail')) THEN
    RAISE EXCEPTION 'redari mail baza (%): triggerele red_proiecte nu sunt cele din baseline', p_faza;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_raspunsuri') <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_raspunsuri' AND policyname = 'red_raspunsuri_sel' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
                     AND roles = ARRAY['authenticated']::name[] AND with_check IS NULL AND qual = '(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_raspunsuri' AND policyname = 'red_raspunsuri_ins' AND cmd = 'INSERT' AND permissive = 'PERMISSIVE'
                     AND roles = ARRAY['authenticated']::name[] AND qual IS NULL AND with_check = '(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_raspunsuri' AND policyname = 'red_raspunsuri_upd' AND cmd = 'UPDATE' AND permissive = 'PERMISSIVE'
                     AND roles = ARRAY['authenticated']::name[] AND qual = '(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))'
                     AND with_check = '(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))') THEN
    RAISE EXCEPTION 'redari mail baza (%): politicile red_raspunsuri nu sunt cele din baseline', p_faza;
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.red_raspunsuri', ARRAY['authenticated=r/postgres', 'postgres=arwdDxtm/postgres', 'service_role=arw/postgres']),
      ('public.red_jurnal',     ARRAY['authenticated=r/postgres', 'postgres=arwdDxtm/postgres', 'service_role=r/postgres']),
      ('public.red_proiecte',   ARRAY['authenticated=arw/postgres', 'postgres=arwdDxtm/postgres', 'service_role=arw/postgres'])
    ) AS b(t, acl) LOOP
    IF (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_class c, unnest(c.relacl::text[]) a WHERE c.oid = r.t::regclass) IS DISTINCT FROM r.acl::text[] THEN
      RAISE EXCEPTION 'redari mail baza (%): privilegiile pe % nu sunt cele din baseline', p_faza, r.t;
    END IF;
  END LOOP;
  IF (SELECT string_agg(attname || '=' || (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(attacl::text[]) a)::text, ';' ORDER BY attname)
        FROM pg_attribute WHERE attrelid = 'public.red_raspunsuri'::regclass AND attacl IS NOT NULL)
     IS DISTINCT FROM 'canal={authenticated=aw/postgres};created_by={authenticated=a/postgres};data={authenticated=aw/postgres};declaratie_confirmata={authenticated=aw/postgres};'
       || 'detinator_id={authenticated=a/postgres};id={authenticated=a/postgres};obiectii_text={authenticated=aw/postgres};optiune={authenticated=aw/postgres};'
       || 'semnatura_electronica_ref={authenticated=aw/postgres};zi_sesiune_aleasa={authenticated=aw/postgres}'
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid IN ('public.red_jurnal'::regclass, 'public.red_proiecte'::regclass) AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'redari mail baza (%): privilegiile pe coloana (red_raspunsuri / red_jurnal / red_proiecte) nu sunt cele din baseline', p_faza;
  END IF;
  -- tabelele atinse: owner postgres, RLS pornit, fără FORCE RLS
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.red_raspunsuri'::regclass, 'public.red_jurnal'::regclass, 'public.red_proiecte'::regclass,
                                                 'public.red_detinatori'::regclass, 'public.red_parcele'::regclass, 'public.red_corespondenta'::regclass)
              AND (NOT relrowsecurity OR relforcerowsecurity OR pg_get_userbyid(relowner) <> 'postgres')) THEN
    RAISE EXCEPTION 'redari mail baza (%): owner / RLS neasteptat pe tabelele Redari atinse', p_faza;
  END IF;
  -- red_jurnal_sel: textul exact (inainte = 20261130g; dupa_j = cu red_mail_*), PERMISSIVE, SELECT, authenticated, singura politică pe red_jurnal
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_jurnal') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_jurnal' AND policyname = 'red_jurnal_sel' AND cmd = 'SELECT'
                     AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND with_check IS NULL
                     AND btrim(regexp_replace(qual, '[[:space:]]+', ' ', 'g')) = CASE WHEN p_faza = 'inainte' THEN v_jsel_vechi ELSE v_jsel_nou END) THEN
    RAISE EXCEPTION 'redari mail baza (%): red_jurnal_sel nu e cea asteptata', p_faza;
  END IF;
  -- Storage: inainte = exact starea din 20261130e (verificatorul ei); dupa_j = cele 3 politici red_storage_* cu excluderea mail/
  IF p_faza = 'inainte' THEN
    PERFORM public.fn_red_storage_verifica_redari(true);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'redari' AND public IS FALSE) THEN RAISE EXCEPTION 'redari mail baza: bucket-ul redari lipseste sau e public'; END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname ~ '^red_storage_') <> 3
       OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname ~ '^red_' AND cmd NOT IN ('SELECT', 'INSERT'))
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_sel' AND cmd = 'SELECT'
                       AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND with_check IS NULL
                       AND btrim(regexp_replace(qual, '[[:space:]]+', ' ', 'g')) = v_ss_nou)
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_ins' AND cmd = 'INSERT'
                       AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND qual IS NULL
                       AND btrim(regexp_replace(with_check, '[[:space:]]+', ' ', 'g')) = v_ss_nou)
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_coresp_sel' AND cmd = 'SELECT'
                       AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND with_check IS NULL
                       AND btrim(regexp_replace(qual, '[[:space:]]+', ' ', 'g')) = v_sv_nou) THEN
      RAISE EXCEPTION 'redari mail baza (dupa_j): politicile red_storage_* nu sunt cele cu excluderea mail/';
    END IF;
    -- (ca 20261126a / 20261130e) nicio altă politică PERMISIVĂ, pentru nicio comandă, nu poate acoperi bucketul redari (deci nici redari/mail/)
    SELECT array_agg(p.policyname::text ORDER BY p.policyname) INTO v_expuse
      FROM pg_policies p
     WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.permissive = 'PERMISSIVE' AND p.policyname !~ '^red_storage_'
       AND ((p.cmd IN ('SELECT', 'DELETE', 'UPDATE', 'ALL') AND p.qual IS NULL) OR (p.cmd = 'INSERT' AND p.with_check IS NULL)
            OR EXISTS (SELECT 1 FROM unnest(ARRAY[p.qual, p.with_check]) e
                        WHERE e IS NOT NULL AND coalesce(public.fn_red_storage_expr_bucket(e), 'redari') = 'redari'));
    IF v_expuse IS NOT NULL THEN
      RAISE EXCEPTION 'redari mail baza (dupa_j): politici storage.objects care ar putea acoperi bucket-ul redari: %', v_expuse;
    END IF;
  END IF;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_mail_verifica_baza(text) FROM PUBLIC, anon, authenticated, service_role;
SELECT public.fn_red_mail_verifica_baza('inainte');   -- preflight: exact starea din baseline

-- ============================================================================ tabelele (§1.12)
-- Setările globale: un singur rând (id = 1). Comutatoarele pornesc OPRITE; doar owner-ul le schimbă (RPC-urile pasului 2 / 6).
CREATE TABLE public.red_mail_setari (
  id smallint PRIMARY KEY CONSTRAINT red_mail_setari_id_ck CHECK (id = 1),
  citire_activa boolean NOT NULL DEFAULT false,
  ultima_eroare_cod text CONSTRAINT red_mail_setari_eroare_ck CHECK (ultima_eroare_cod IS NULL OR ultima_eroare_cod ~ '^[a-z0-9_]{1,64}$'),
  retentie_activa boolean NOT NULL DEFAULT false,
  golire_gmail_activa boolean NOT NULL DEFAULT false,
  retentie_lease_token uuid,
  retentie_lease_pana timestamptz,
  versiune integer NOT NULL DEFAULT 1 CONSTRAINT red_mail_setari_versiune_ck CHECK (versiune >= 1),
  actualizat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_mail_setari_lease_ck CHECK ((retentie_lease_token IS NULL) = (retentie_lease_pana IS NULL))
);
COMMENT ON TABLE public.red_mail_setari IS 'Redări e-mail: setările globale (un rând, id = 1). Kill-switch-uri: citire_activa, retentie_activa, golire_gmail_activa — toate implicit false, doar owner. Lease-ul global de retenție. Coloanele F2 (trimitere_oprita, plafoane, extern_permis) le adaugă migrarea F2.';
INSERT INTO public.red_mail_setari (id) VALUES (1);

-- Starea pe flux, cheie (casuta, flux) (§1.1). Rândurile inbox ale ambelor căsuțe pornesc neinițializate și INACTIVE.
CREATE TABLE public.red_mail_flux (
  casuta text NOT NULL CONSTRAINT red_mail_flux_casuta_ck CHECK (casuta IN ('redari@gazpet.ro', 'redari-test@gazpet.ro')),
  flux text NOT NULL CONSTRAINT red_mail_flux_flux_ck CHECK (flux IN ('inbox', 'sent', 'import')),
  history_id numeric(20,0) CONSTRAINT red_mail_flux_history_ck CHECK (history_id IS NULL OR history_id >= 0),
  mod_cursor text NOT NULL DEFAULT 'neinitializat' CONSTRAINT red_mail_flux_mod_cursor_ck CHECK (mod_cursor IN ('neinitializat', 'normal', 'recuperare')),
  data_start timestamptz,
  data_import_de_la timestamptz,
  recuperare_tip text CONSTRAINT red_mail_flux_recuperare_tip_ck CHECK (recuperare_tip IS NULL OR recuperare_tip IN ('activare', 'cursor_expirat')),
  recuperare_history_id numeric(20,0) CONSTRAINT red_mail_flux_rec_history_ck CHECK (recuperare_history_id IS NULL OR recuperare_history_id >= 0),
  recuperare_page_token text CONSTRAINT red_mail_flux_page_token_ck CHECK (recuperare_page_token IS NULL OR (length(recuperare_page_token) BETWEEN 1 AND 2048 AND recuperare_page_token ~ '^[!-~]+$')),
  mod_test boolean NOT NULL,
  activ boolean NOT NULL DEFAULT false,
  lease_token uuid,
  lease_pana timestamptz,
  ultima_eroare_cod text CONSTRAINT red_mail_flux_eroare_ck CHECK (ultima_eroare_cod IS NULL OR ultima_eroare_cod ~ '^[a-z0-9_]{1,64}$'),
  versiune integer NOT NULL DEFAULT 1 CONSTRAINT red_mail_flux_versiune_ck CHECK (versiune >= 1),
  CONSTRAINT red_mail_flux_pk PRIMARY KEY (casuta, flux),
  CONSTRAINT red_mail_flux_mod_test_ck CHECK (mod_test = (casuta <> 'redari@gazpet.ro')),
  CONSTRAINT red_mail_flux_import_ck CHECK ((flux = 'import') = (data_import_de_la IS NOT NULL) AND (data_import_de_la IS NULL OR data_start IS NULL OR data_import_de_la < data_start)),
  CONSTRAINT red_mail_flux_lease_ck CHECK ((lease_token IS NULL) = (lease_pana IS NULL)),
  CONSTRAINT red_mail_flux_cursor_ck CHECK (
    (mod_cursor = 'neinitializat' AND history_id IS NULL AND recuperare_tip IS NULL AND recuperare_history_id IS NULL AND recuperare_page_token IS NULL)
    OR (mod_cursor = 'normal' AND history_id IS NOT NULL AND data_start IS NOT NULL AND recuperare_tip IS NULL AND recuperare_history_id IS NULL AND recuperare_page_token IS NULL)
    OR (mod_cursor = 'recuperare' AND history_id IS NOT NULL AND data_start IS NOT NULL AND recuperare_tip IS NOT NULL AND recuperare_history_id IS NOT NULL))
);
COMMENT ON TABLE public.red_mail_flux IS 'Redări e-mail: starea fiecărui flux (inbox / sent din F2 / import la cerere) pe căsuță. Două comutatoare necesare: red_mail_setari.citire_activa ȘI activ pe rând. data_start imuabil odată scris (trigger, 20261130k). history_id = numeric(20,0), comparat numeric.';
INSERT INTO public.red_mail_flux (casuta, flux, mod_test) VALUES ('redari@gazpet.ro', 'inbox', false), ('redari-test@gazpet.ro', 'inbox', true);

-- Mesajele primite (§1.12 + §1.8 + §1.10). Conținutul extern e DATE: niciun câmp de aici nu declanșează vreo acțiune.
CREATE TABLE public.red_mail_primite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  casuta text NOT NULL CONSTRAINT red_mail_primite_casuta_ck CHECK (casuta IN ('redari@gazpet.ro', 'redari-test@gazpet.ro')),
  test boolean NOT NULL,
  gmail_id text CONSTRAINT red_mail_primite_gmail_id_ck CHECK (gmail_id IS NULL OR gmail_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  gmail_id_hmac text CONSTRAINT red_mail_primite_hmac_ck CHECK (gmail_id_hmac IS NULL OR gmail_id_hmac ~ '^[0-9a-f]{64}$'),
  hmac_versiune smallint NOT NULL CONSTRAINT red_mail_primite_hmac_versiune_ck CHECK (hmac_versiune BETWEEN 1 AND 999),
  primit_la timestamptz NOT NULL,
  data_declarata timestamptz,
  thread_id text CONSTRAINT red_mail_primite_thread_ck CHECK (thread_id IS NULL OR thread_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  rfc_message_id text CONSTRAINT red_mail_primite_msgid_ck CHECK (rfc_message_id IS NULL OR length(rfc_message_id) BETWEEN 1 AND 998),
  coliziune_message_id boolean NOT NULL DEFAULT false,
  raw_sha256 text CONSTRAINT red_mail_primite_raw_sha_ck CHECK (raw_sha256 IS NULL OR raw_sha256 ~ '^[0-9a-f]{64}$'),
  in_reply_to text CONSTRAINT red_mail_primite_in_reply_ck CHECK (in_reply_to IS NULL OR length(in_reply_to) <= 998),
  references_ids text CONSTRAINT red_mail_primite_references_ck CHECK (references_ids IS NULL OR length(references_ids) <= 8000),
  de_la_adresa text CONSTRAINT red_mail_primite_de_la_ck CHECK (de_la_adresa IS NULL OR length(de_la_adresa) <= 320),
  de_la_nume text CONSTRAINT red_mail_primite_de_la_nume_ck CHECK (de_la_nume IS NULL OR length(de_la_nume) <= 500),
  reply_to text CONSTRAINT red_mail_primite_reply_to_ck CHECK (reply_to IS NULL OR length(reply_to) <= 998),
  catre text CONSTRAINT red_mail_primite_catre_ck CHECK (catre IS NULL OR length(catre) <= 4000),
  subiect text CONSTRAINT red_mail_primite_subiect_ck CHECK (subiect IS NULL OR length(subiect) <= 500),
  corp_text text CONSTRAINT red_mail_primite_corp_ck CHECK (corp_text IS NULL OR length(corp_text) <= 20000),
  corp_trunchiat boolean NOT NULL DEFAULT false,
  subiect_trunchiat boolean NOT NULL DEFAULT false,
  charset_necunoscut boolean NOT NULL DEFAULT false,
  doar_html boolean NOT NULL DEFAULT false,
  fara_corp boolean NOT NULL DEFAULT false,
  eml_absent text CONSTRAINT red_mail_primite_eml_absent_ck CHECK (eml_absent IS NULL OR eml_absent IN ('prea_mare')),
  auth_spf text CONSTRAINT red_mail_primite_auth_spf_ck CHECK (auth_spf IS NULL OR auth_spf IN ('pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror')),
  auth_dkim text CONSTRAINT red_mail_primite_auth_dkim_ck CHECK (auth_dkim IS NULL OR auth_dkim IN ('pass', 'fail', 'neutral', 'none', 'policy', 'temperror', 'permerror')),
  auth_dmarc text CONSTRAINT red_mail_primite_auth_dmarc_ck CHECK (auth_dmarc IS NULL OR auth_dmarc IN ('pass', 'fail', 'bestguesspass', 'none', 'temperror', 'permerror')),
  auth_sursa text NOT NULL DEFAULT 'necunoscut' CONSTRAINT red_mail_primite_auth_sursa_ck CHECK (auth_sursa IN ('mx_google', 'necunoscut')),
  stare_ingestie text NOT NULL DEFAULT 'in_curs' CONSTRAINT red_mail_primite_stare_ingestie_ck CHECK (stare_ingestie IN ('in_curs', 'ok', 'neprocesabil')),
  motiv_cod text CONSTRAINT red_mail_primite_motiv_cod_ck CHECK (motiv_cod IS NULL OR motiv_cod IN ('prea_mare', 'structura_invalida', 'decodare_imposibila', 'raspuns_peste_plafon', 'conflict_obiect', 'ingestie_blocata')),
  ingestie_inceputa_la timestamptz NOT NULL DEFAULT now(),
  ingestie_finalizata_la timestamptz,
  indicii jsonb CONSTRAINT red_mail_primite_indicii_ck CHECK (indicii IS NULL OR (jsonb_typeof(indicii) = 'object' AND length(indicii::text) <= 8000)),
  conflict_indicii boolean NOT NULL DEFAULT false,
  expeditor_diferit boolean NOT NULL DEFAULT false,
  reply_to_diferit boolean NOT NULL DEFAULT false,
  corespondenta_id uuid CONSTRAINT red_mail_primite_coresp_fk REFERENCES public.red_corespondenta(id),
  detinator_id uuid CONSTRAINT red_mail_primite_detinator_fk REFERENCES public.red_detinatori(id),
  parcela_id uuid CONSTRAINT red_mail_primite_parcela_fk REFERENCES public.red_parcele(id),
  asociat_de uuid,
  asociat_la timestamptz,
  a_fost_asociat boolean NOT NULL DEFAULT false,
  stare text NOT NULL DEFAULT 'nou' CONSTRAINT red_mail_primite_stare_ck CHECK (stare IN ('nou', 'asociat', 'rezolvat', 'ignorat')),
  rezolvat_de uuid,
  rezolvat_la timestamptz,
  ignorat_la timestamptz,
  ignorat_de uuid,
  ignorat_motiv text CONSTRAINT red_mail_primite_ignorat_motiv_ck CHECK (ignorat_motiv IS NULL OR (length(ignorat_motiv) <= 500 AND ignorat_motiv ~ '[^[:space:]]')),
  verificare text NOT NULL DEFAULT 'neverificat' CONSTRAINT red_mail_primite_verificare_ck CHECK (verificare IN ('neverificat', 'verificat_telefon', 'verificat_semnatura', 'verificat_prezenta', 'verificat_alt')),
  verificat_de uuid,
  verificat_la timestamptz,
  verificare_nota text CONSTRAINT red_mail_primite_verificare_nota_ck CHECK (verificare_nota IS NULL OR length(verificare_nota) <= 1000),
  nota text CONSTRAINT red_mail_primite_nota_ck CHECK (nota IS NULL OR length(nota) <= 2000),
  cere_dezabonare boolean NOT NULL DEFAULT false,
  inregistrat_in_registru boolean NOT NULL DEFAULT false,
  retentie_stare text NOT NULL DEFAULT 'activ' CONSTRAINT red_mail_primite_retentie_stare_ck CHECK (retentie_stare IN ('activ', 'in_golire', 'golit')),
  golire_claim_token uuid,
  golire_claim_pana timestamptz,
  golit_la timestamptz,
  limita_absoluta_la timestamptz,
  blocaj_stare text NOT NULL DEFAULT 'fara' CONSTRAINT red_mail_primite_blocaj_ck CHECK (blocaj_stare IN ('fara', 'cerut', 'activ')),
  retentie_blocata_motiv text CONSTRAINT red_mail_primite_blocaj_motiv_ck CHECK (retentie_blocata_motiv IS NULL OR (length(retentie_blocata_motiv) <= 500 AND retentie_blocata_motiv ~ '[^[:space:]]')),
  blocaj_cerut_de uuid,
  blocaj_cerut_la timestamptz,
  eliberat_golire_la timestamptz,
  eliberat_golire_de uuid,
  eliberat_golire_motiv text CONSTRAINT red_mail_primite_eliberat_motiv_len_ck CHECK (eliberat_golire_motiv IS NULL OR (length(eliberat_golire_motiv) <= 500 AND eliberat_golire_motiv ~ '[^[:space:]]')),
  gmail_stergere_stare text NOT NULL DEFAULT 'necerut' CONSTRAINT red_mail_primite_gmail_stare_ck CHECK (gmail_stergere_stare IN ('necerut', 'de_mutat_in_cos', 'trash_in_apel', 'in_cos', 'verificat_absent', 'de_decis', 'esuat', 'pastrat_de_om', 'expirat')),
  gmail_trash_incercare_id uuid CONSTRAINT red_mail_primite_incercare_uq UNIQUE,
  gmail_trash_inceput_la timestamptz,
  gmail_trash_valabil_pana timestamptz,
  gmail_in_cos_la timestamptz,
  gmail_absent_verificat_la timestamptz,
  gmail_stergere_eroare_cod text CONSTRAINT red_mail_primite_gmail_eroare_ck CHECK (gmail_stergere_eroare_cod IS NULL OR gmail_stergere_eroare_cod ~ '^[a-z0-9_]{1,64}$'),
  rezerva_la timestamptz,
  dedup_incheiat_la timestamptz,
  versiune integer NOT NULL DEFAULT 1 CONSTRAINT red_mail_primite_versiune_ck CHECK (versiune >= 1),
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_mail_primite_casuta_hmac_uq UNIQUE (casuta, gmail_id_hmac),
  CONSTRAINT red_mail_primite_test_ck CHECK (test = (casuta <> 'redari@gazpet.ro')),
  CONSTRAINT red_mail_primite_auth_ck CHECK (auth_sursa = 'mx_google' OR (auth_spf IS NULL AND auth_dkim IS NULL AND auth_dmarc IS NULL)),
  CONSTRAINT red_mail_primite_motiv_ck CHECK ((stare_ingestie = 'neprocesabil') = (motiv_cod IS NOT NULL)),
  CONSTRAINT red_mail_primite_finalizat_ck CHECK ((stare_ingestie = 'in_curs') = (ingestie_finalizata_la IS NULL)),
  -- tranzițiile stare × stare_ingestie (§1.10): orice stare în afara lui 'nou' cere ingestia 'ok'; asociat / rezolvat ⇔ deținător confirmat
  CONSTRAINT red_mail_primite_triere_ck CHECK (stare = 'nou' OR stare_ingestie = 'ok'),
  CONSTRAINT red_mail_primite_asociere_ck CHECK ((stare IN ('asociat', 'rezolvat')) = (detinator_id IS NOT NULL)
    AND (detinator_id IS NULL) = (parcela_id IS NULL) AND (detinator_id IS NULL) = (asociat_la IS NULL) AND (asociat_la IS NULL) = (asociat_de IS NULL)
    AND (detinator_id IS NULL OR a_fost_asociat)),
  -- un mesaj al căsuței de test nu se asociază niciodată cu un deținător (Cop r6 P2-02)
  CONSTRAINT red_mail_primite_test_asociere_ck CHECK (NOT (test AND detinator_id IS NOT NULL)),
  CONSTRAINT red_mail_primite_rezolvat_ck CHECK ((stare = 'rezolvat') = (rezolvat_la IS NOT NULL) AND (rezolvat_la IS NULL) = (rezolvat_de IS NULL)),
  CONSTRAINT red_mail_primite_ignorat_ck CHECK ((stare = 'ignorat') = (ignorat_la IS NOT NULL) AND (ignorat_la IS NULL) = (ignorat_de IS NULL)
    AND (ignorat_la IS NOT NULL OR ignorat_motiv IS NULL) AND (ignorat_la IS NULL OR ignorat_motiv IS NOT NULL OR retentie_stare = 'golit')),
  CONSTRAINT red_mail_primite_verificat_ck CHECK ((verificare = 'neverificat') = (verificat_la IS NULL) AND (verificat_la IS NULL) = (verificat_de IS NULL)),
  CONSTRAINT red_mail_primite_claim_ck CHECK ((golire_claim_token IS NULL) = (golire_claim_pana IS NULL) AND (retentie_stare = 'in_golire') = (golire_claim_token IS NOT NULL)),
  CONSTRAINT red_mail_primite_golit_ck CHECK ((retentie_stare = 'golit') = (golit_la IS NOT NULL)
    AND (golit_la IS NULL) = (limita_absoluta_la IS NULL)
    AND (golit_la IS NULL OR limita_absoluta_la = ((golit_la AT TIME ZONE 'UTC') + interval '3 years') AT TIME ZONE 'UTC')),
  -- inventarul coloanelor golite (§1.8): după golire, conținutul e NULL (rămân stările, datele, autorii, legătura confirmată)
  CONSTRAINT red_mail_primite_continut_golit_ck CHECK (retentie_stare <> 'golit' OR (corp_text IS NULL AND subiect IS NULL AND de_la_adresa IS NULL
    AND de_la_nume IS NULL AND reply_to IS NULL AND catre IS NULL AND rfc_message_id IS NULL AND in_reply_to IS NULL AND references_ids IS NULL
    AND raw_sha256 IS NULL AND data_declarata IS NULL AND thread_id IS NULL AND verificare_nota IS NULL AND ignorat_motiv IS NULL
    AND eliberat_golire_motiv IS NULL AND nota IS NULL AND indicii IS NULL)),
  CONSTRAINT red_mail_primite_blocaj_stare_ck CHECK ((blocaj_stare = 'fara') = (retentie_blocata_motiv IS NULL)
    AND (blocaj_stare = 'fara') = (blocaj_cerut_la IS NULL) AND (blocaj_cerut_la IS NULL) = (blocaj_cerut_de IS NULL)),
  -- eliberarea pentru golire a unui mesaj neprocesabil (§1.12, textul exact din plan, r17) + doar pe neprocesabil
  CONSTRAINT red_mail_primite_eliberat_ck CHECK ((eliberat_golire_la IS NULL) = (eliberat_golire_de IS NULL) AND (eliberat_golire_la IS NOT NULL OR eliberat_golire_motiv IS NULL)
    AND (eliberat_golire_la IS NULL OR eliberat_golire_motiv IS NOT NULL OR retentie_stare = 'golit')),
  CONSTRAINT red_mail_primite_eliberat_neproc_ck CHECK (eliberat_golire_la IS NULL OR stare_ingestie = 'neprocesabil'),
  -- ciclul originalului din Gmail (§1.2 r19b–r19e, §1.12)
  CONSTRAINT red_mail_primite_gmail_golit_ck CHECK (gmail_stergere_stare = 'necerut' OR retentie_stare = 'golit'),
  CONSTRAINT red_mail_primite_gmail_apel_ck CHECK (gmail_stergere_stare <> 'trash_in_apel' OR (gmail_trash_incercare_id IS NOT NULL AND gmail_trash_inceput_la IS NOT NULL AND gmail_trash_valabil_pana IS NOT NULL)),
  CONSTRAINT red_mail_primite_gmail_cos_ck CHECK (gmail_stergere_stare <> 'in_cos' OR gmail_in_cos_la IS NOT NULL),
  CONSTRAINT red_mail_primite_gmail_absent_ck CHECK ((gmail_stergere_stare = 'verificat_absent') = (gmail_absent_verificat_la IS NOT NULL)),
  CONSTRAINT red_mail_primite_gmail_id_final_ck CHECK (gmail_stergere_stare NOT IN ('verificat_absent', 'expirat') OR gmail_id IS NULL),
  CONSTRAINT red_mail_primite_gmail_expirat_ck CHECK (gmail_stergere_stare <> 'expirat' OR (gmail_id_hmac IS NULL AND dedup_incheiat_la IS NOT NULL)),
  CONSTRAINT red_mail_primite_dedup_ck CHECK ((gmail_id_hmac IS NOT NULL OR dedup_incheiat_la IS NOT NULL) AND (dedup_incheiat_la IS NULL OR gmail_id IS NULL)),
  CONSTRAINT red_mail_primite_dedup_golit_ck CHECK (dedup_incheiat_la IS NULL OR retentie_stare = 'golit')
);
CREATE UNIQUE INDEX red_mail_primite_casuta_gmail_id_uq ON public.red_mail_primite (casuta, gmail_id) WHERE gmail_id IS NOT NULL;
CREATE INDEX idx_red_mail_primite_msgid ON public.red_mail_primite (rfc_message_id) WHERE rfc_message_id IS NOT NULL;
CREATE INDEX idx_red_mail_primite_triere ON public.red_mail_primite (casuta, stare, primit_la DESC);
CREATE INDEX idx_red_mail_primite_detinator ON public.red_mail_primite (detinator_id) WHERE detinator_id IS NOT NULL;
CREATE INDEX idx_red_mail_primite_coresp ON public.red_mail_primite (corespondenta_id) WHERE corespondenta_id IS NOT NULL;
CREATE INDEX idx_red_mail_primite_parcela ON public.red_mail_primite (parcela_id) WHERE parcela_id IS NOT NULL;
COMMENT ON TABLE public.red_mail_primite IS 'Redări e-mail: mesajele primite (F1). Identitatea de ingestie = (casuta, gmail_id_hmac), HMAC peste (casuta, gmail_id). primit_la = internalDate (timpul de încredere); data_declarata = antetul Date (informativ). '
  'stare (triere, doar omul) × stare_ingestie (ingestie) independente; ignorat = „Nepotrivit” în UI. Golirea pune conținutul pe NULL (CHECK). Ciclul originalului din Gmail: gmail_stergere_stare (§1.2). '
  'Conținutul e text EXTERN: nu e instrucțiune pentru nimeni. Scrierile: doar prin RPC-uri SECURITY DEFINER (niciun rol nu are INSERT / UPDATE / DELETE).';
COMMENT ON COLUMN public.red_mail_primite.limita_absoluta_la IS 'golit_la + 3 ani (UTC), scrisă la golire, imuabilă: termenul absolut al marcajului de dedup; ținta de 90 de zile = golit_la + 90 de zile, derivată (§1.2 pasul 0).';

-- Manifestul obiectelor (.eml + atașamentele din lista albă) (§1.2). Căile: mail/<casuta_cod>/carantina/<hmac>.eml, mail/<casuta_cod>/atasamente/<hmac>/<n>.
CREATE TABLE public.red_mail_obiecte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primit_id uuid NOT NULL CONSTRAINT red_mail_obiecte_primit_fk REFERENCES public.red_mail_primite(id),
  tip text NOT NULL CONSTRAINT red_mail_obiecte_tip_ck CHECK (tip IN ('eml', 'atasament')),
  nr smallint NOT NULL CONSTRAINT red_mail_obiecte_nr_ck CHECK (nr BETWEEN 0 AND 20),
  cale text CONSTRAINT red_mail_obiecte_cale_uq UNIQUE,
  nume text CONSTRAINT red_mail_obiecte_nume_ck CHECK (nume IS NULL OR length(nume) BETWEEN 1 AND 255),
  mime_declarat text CONSTRAINT red_mail_obiecte_mime_decl_ck CHECK (mime_declarat IS NULL OR length(mime_declarat) <= 255),
  mime_detectat text CONSTRAINT red_mail_obiecte_mime_det_ck CHECK (mime_detectat IS NULL OR mime_detectat IN ('application/pdf', 'image/jpeg', 'image/png', 'message/rfc822')),
  marime_declarata bigint CONSTRAINT red_mail_obiecte_marime_decl_ck CHECK (marime_declarata IS NULL OR marime_declarata >= 0),
  marime bigint CONSTRAINT red_mail_obiecte_marime_ck CHECK (marime IS NULL OR marime BETWEEN 0 AND 14680064),
  sha256 text CONSTRAINT red_mail_obiecte_sha_ck CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  stare text NOT NULL DEFAULT 'asteptat' CONSTRAINT red_mail_obiecte_stare_ck CHECK (stare IN ('asteptat', 'stocat', 'respins_tip', 'respins_marime', 'respins_structura', 'respins_buget', 'conflict_obiect', 'in_stergere', 'sters')),
  stergere_autorizata_la timestamptz,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_mail_obiecte_primit_tip_nr_uq UNIQUE (primit_id, tip, nr),
  CONSTRAINT red_mail_obiecte_nr_tip_ck CHECK ((tip = 'eml') = (nr = 0)),
  CONSTRAINT red_mail_obiecte_cale_forma_ck CHECK (cale IS NULL OR (tip = 'eml' AND cale ~ '^mail/(redari|redari-test)/carantina/[0-9a-f]{64}[.]eml$')
    OR (tip = 'atasament' AND cale ~ '^mail/(redari|redari-test)/atasamente/[0-9a-f]{64}/[0-9]{1,2}$')),
  CONSTRAINT red_mail_obiecte_cale_stare_ck CHECK (stare NOT IN ('asteptat', 'stocat', 'conflict_obiect', 'in_stergere') OR cale IS NOT NULL),
  CONSTRAINT red_mail_obiecte_stocat_ck CHECK (stare NOT IN ('stocat', 'in_stergere') OR (sha256 IS NOT NULL AND marime IS NOT NULL)),
  CONSTRAINT red_mail_obiecte_stergere_ck CHECK (stare <> 'in_stergere' OR stergere_autorizata_la IS NOT NULL)
);
COMMENT ON TABLE public.red_mail_obiecte IS 'Redări e-mail: manifestul obiectelor unui mesaj (.eml în carantină + atașamentele PDF / JPEG / PNG). Cale deterministă pe (casuta, gmail_id_hmac); respinsele au doar metadate. Descărcarea doar prin proxy (redari-mail-fisier), niciodată URL semnat.';

-- Tombstone-ul de dedup după ștergerea finală a auditului, doar cât deduplicarea e deschisă (§1.2 r19c / r19e).
CREATE TABLE public.red_mail_dedup (
  casuta text NOT NULL CONSTRAINT red_mail_dedup_casuta_ck CHECK (casuta IN ('redari@gazpet.ro', 'redari-test@gazpet.ro')),
  gmail_id_hmac text NOT NULL CONSTRAINT red_mail_dedup_hmac_ck CHECK (gmail_id_hmac ~ '^[0-9a-f]{64}$'),
  hmac_versiune smallint NOT NULL CONSTRAINT red_mail_dedup_hmac_versiune_ck CHECK (hmac_versiune BETWEEN 1 AND 999),
  golit_la timestamptz NOT NULL,
  gmail_id text CONSTRAINT red_mail_dedup_gmail_id_ck CHECK (gmail_id IS NULL OR gmail_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  gmail_stergere_stare text NOT NULL CONSTRAINT red_mail_dedup_gmail_stare_ck CHECK (gmail_stergere_stare IN ('de_mutat_in_cos', 'trash_in_apel', 'in_cos', 'verificat_absent', 'de_decis', 'esuat', 'pastrat_de_om', 'expirat')),
  gmail_trash_incercare_id uuid CONSTRAINT red_mail_dedup_incercare_uq UNIQUE,
  gmail_trash_inceput_la timestamptz,
  gmail_trash_valabil_pana timestamptz,
  claim_token uuid,
  claim_pana timestamptz,
  blocaj_stare text NOT NULL DEFAULT 'fara' CONSTRAINT red_mail_dedup_blocaj_ck CHECK (blocaj_stare IN ('fara', 'cerut', 'activ')),
  gmail_in_cos_la timestamptz,
  gmail_absent_verificat_la timestamptz,
  gmail_stergere_eroare_cod text CONSTRAINT red_mail_dedup_gmail_eroare_ck CHECK (gmail_stergere_eroare_cod IS NULL OR gmail_stergere_eroare_cod ~ '^[a-z0-9_]{1,64}$'),
  rezerva_la timestamptz,
  limita_absoluta_la timestamptz NOT NULL,
  CONSTRAINT red_mail_dedup_pk PRIMARY KEY (casuta, gmail_id_hmac),
  CONSTRAINT red_mail_dedup_limita_ck CHECK (limita_absoluta_la = ((golit_la AT TIME ZONE 'UTC') + interval '3 years') AT TIME ZONE 'UTC'),
  CONSTRAINT red_mail_dedup_claim_ck CHECK ((claim_token IS NULL) = (claim_pana IS NULL)),
  CONSTRAINT red_mail_dedup_gmail_apel_ck CHECK (gmail_stergere_stare <> 'trash_in_apel' OR (gmail_trash_incercare_id IS NOT NULL AND gmail_trash_inceput_la IS NOT NULL AND gmail_trash_valabil_pana IS NOT NULL)),
  CONSTRAINT red_mail_dedup_gmail_cos_ck CHECK (gmail_stergere_stare <> 'in_cos' OR gmail_in_cos_la IS NOT NULL),
  CONSTRAINT red_mail_dedup_gmail_absent_ck CHECK ((gmail_stergere_stare = 'verificat_absent') = (gmail_absent_verificat_la IS NOT NULL)),
  CONSTRAINT red_mail_dedup_gmail_id_final_ck CHECK (gmail_stergere_stare NOT IN ('verificat_absent', 'expirat') OR gmail_id IS NULL)
);
COMMENT ON TABLE public.red_mail_dedup IS 'Redări e-mail: tombstone de deduplicare (casuta, HMAC, versiune, date, starea originalului din Gmail), creat la ștergerea finală a auditului DOAR cât dedup-ul e deschis. '
  'Se șterge după verificat_absent sau la limita_absoluta_la (golit_la + 3 ani); ținta: 90 de zile de la golire (derivată). HMAC = dată personală pseudonimizată (opinia juridică 04.11.2026).';

-- Evenimentele (jurnalul tehnic, fără conținut). Lista tip = F1, literal (§1.12); F2 o extinde. FK cu CASCADE: se șterg cu auditul mesajului.
CREATE TABLE public.red_mail_evenimente (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tip text NOT NULL CONSTRAINT red_mail_evenimente_tip_ck CHECK (tip IN ('activare', 'ingestie_ok', 'ingestie_neprocesabil', 'deja_golit', 'disparut', 'spam_numarat',
    'dry_rulat', 'recuperare_inceputa', 'recuperare_terminata', 'lease_pierdut', 'eroare_citire', 'descarcare', 'golire', 'blocaj_cerut', 'blocaj_activ',
    'blocaj_ridicat', 'orfane_sterse', 'alerta_de_triat', 'alerta_escaladare', 'oauth_conectat', 'oauth_respins', 'oauth_revocat', 'tombstone_sters',
    'neprocesabil_eliberat', 'eliberare_anulata', 'gmail_trash_inceput', 'gmail_in_cos', 'gmail_trash_ambiguu', 'gmail_de_decis', 'gmail_absent_verificat',
    'gmail_stergere_esuata', 'metoda_nepermisa', 'trash_tardiv', 'alerta_gmail_stergere', 'alerta_dedup_expira', 'tombstone_sters_termen', 'hmac_cheie_retrasa')),
  primit_id uuid CONSTRAINT red_mail_evenimente_primit_fk REFERENCES public.red_mail_primite(id) ON DELETE CASCADE,
  obiect_id uuid,
  casuta text CONSTRAINT red_mail_evenimente_casuta_ck CHECK (casuta IS NULL OR casuta IN ('redari@gazpet.ro', 'redari-test@gazpet.ro')),
  gmail_id_hmac text CONSTRAINT red_mail_evenimente_hmac_ck CHECK (gmail_id_hmac IS NULL OR gmail_id_hmac ~ '^[0-9a-f]{64}$'),
  cod text CONSTRAINT red_mail_evenimente_cod_ck CHECK (cod IS NULL OR cod ~ '^[a-z0-9_]{1,64}$'),
  numar bigint CONSTRAINT red_mail_evenimente_numar_ck CHECK (numar IS NULL OR numar >= 0),
  -- doar numărători: chei [a-z0-9_], valori numerice (fără text liber, deci fără adrese / subiecte / nume de fișier)
  numaratori jsonb CONSTRAINT red_mail_evenimente_numaratori_ck CHECK (numaratori IS NULL OR (jsonb_typeof(numaratori) = 'object' AND length(numaratori::text) <= 2000
    AND NOT jsonb_path_exists(numaratori, '$.* ? (@.type() != "number")') AND NOT jsonb_path_exists(numaratori, '$.keyvalue() ? (!(@.key like_regex "^[a-z0-9_]{1,40}$"))'))),
  autor uuid,
  creat_la timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_red_mail_evenimente_primit ON public.red_mail_evenimente (primit_id, creat_la) WHERE primit_id IS NOT NULL;
CREATE INDEX idx_red_mail_evenimente_tip ON public.red_mail_evenimente (tip, creat_la DESC);
COMMENT ON TABLE public.red_mail_evenimente IS 'Redări e-mail: evenimente tehnice (ingestie / recuperare / retenție / Gmail / descărcări). Metadate pseudonimizate: gmail_id_hmac (niciodată gmail_id brut), id-uri ERP, numărători, cod, autor. Fără adrese, subiecte, nume de fișier sau text. '
  'Append-only (trigger, 20261130k); se șterg cu auditul mesajului (CASCADE) sau, fără mesaj, după 1 an.';

-- Proveniența minimă a unui răspuns din Registru venit pe e-mail (§1.10, §1.12). Scris doar de RPC-urile pasului 4.
CREATE TABLE public.red_mail_raspuns_sursa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raspuns_id uuid NOT NULL CONSTRAINT red_mail_raspuns_sursa_raspuns_uq UNIQUE CONSTRAINT red_mail_raspuns_sursa_raspuns_fk REFERENCES public.red_raspunsuri(id) ON DELETE CASCADE,
  tip_sursa text NOT NULL CONSTRAINT red_mail_raspuns_sursa_tip_ck CHECK (tip_sursa IN ('gmail_redari', 'manual_verificat', 'gmail_redari_sters')),
  primit_id uuid CONSTRAINT red_mail_raspuns_sursa_primit_fk REFERENCES public.red_mail_primite(id),
  detinator_id uuid NOT NULL CONSTRAINT red_mail_raspuns_sursa_detinator_fk REFERENCES public.red_detinatori(id),
  operatie_id uuid NOT NULL CONSTRAINT red_mail_raspuns_sursa_operatie_uq UNIQUE,
  cerere_sha256 text NOT NULL CONSTRAINT red_mail_raspuns_sursa_cerere_ck CHECK (cerere_sha256 ~ '^[0-9a-f]{64}$'),
  metoda_verificare text NOT NULL CONSTRAINT red_mail_raspuns_sursa_metoda_ck CHECK (metoda_verificare IN ('verificat_telefon', 'verificat_semnatura', 'verificat_prezenta', 'verificat_alt')),
  verificat_de uuid NOT NULL,
  verificat_la timestamptz NOT NULL DEFAULT now(),
  data_raspuns date,
  motiv_data text CONSTRAINT red_mail_raspuns_sursa_motiv_ck CHECK (motiv_data IS NULL OR (length(motiv_data) <= 500 AND motiv_data ~ '[^[:space:]]')),
  mesaj_sursa_id uuid CONSTRAINT red_mail_raspuns_sursa_mesaj_fk REFERENCES public.red_mail_primite(id),
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_mail_raspuns_sursa_primit_det_uq UNIQUE (primit_id, detinator_id),
  CONSTRAINT red_mail_raspuns_sursa_mesaj_det_uq UNIQUE (mesaj_sursa_id, detinator_id),
  CONSTRAINT red_mail_raspuns_sursa_mesaj_manual_ck CHECK (mesaj_sursa_id IS NULL OR tip_sursa = 'manual_verificat'),
  CONSTRAINT red_mail_raspuns_sursa_gmail_ck CHECK (tip_sursa <> 'gmail_redari' OR primit_id IS NOT NULL),
  CONSTRAINT red_mail_raspuns_sursa_sters_ck CHECK (tip_sursa <> 'gmail_redari_sters' OR primit_id IS NULL),
  -- Jak r14 P3-01: „doar manual” în ambele sensuri (textul exact din §1.12)
  CONSTRAINT red_mail_raspuns_sursa_manual_ck CHECK ((tip_sursa = 'manual_verificat' AND data_raspuns IS NOT NULL AND motiv_data IS NOT NULL AND primit_id IS NULL)
    OR (tip_sursa <> 'manual_verificat' AND data_raspuns IS NULL AND motiv_data IS NULL))
);
CREATE INDEX idx_red_mail_raspuns_sursa_detinator ON public.red_mail_raspuns_sursa (detinator_id);
COMMENT ON TABLE public.red_mail_raspuns_sursa IS 'Redări e-mail: proveniența unui red_raspunsuri cu canal = email (gmail_redari / manual_verificat / gmail_redari_sters). Cel mult un răspuns per (mesaj, deținător); idempotență pe operatie_id + cerere_sha256. '
  'Nu se șterge cât există răspunsul (CASCADE doar la ștergerea răspunsului). Scris doar de RPC-urile de înregistrare; triggerele de pe red_raspunsuri (20261130k) cer rândul la commit.';

-- Adresele propuse (din formularul public — F1b — sau din From-ul unui mail), până le confirmă un om (§1.11, implicit (a)).
CREATE TABLE public.red_mail_adrese_propuse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detinator_id uuid NOT NULL CONSTRAINT red_mail_adrese_propuse_detinator_fk REFERENCES public.red_detinatori(id),
  email text CONSTRAINT red_mail_adrese_propuse_email_ck CHECK (email IS NULL OR (length(email) <= 254
    AND email ~ '^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$')),
  sursa text NOT NULL CONSTRAINT red_mail_adrese_propuse_sursa_ck CHECK (sursa IN ('formular_public', 'mail_primit')),
  primit_id uuid CONSTRAINT red_mail_adrese_propuse_primit_fk REFERENCES public.red_mail_primite(id),
  propus_la timestamptz NOT NULL DEFAULT now(),
  stare text NOT NULL DEFAULT 'propusa' CONSTRAINT red_mail_adrese_propuse_stare_ck CHECK (stare IN ('propusa', 'confirmata', 'respinsa')),
  confirmat_de uuid,
  confirmat_la timestamptz,
  respins_de uuid,
  respins_la timestamptz,
  metoda_verificare text CONSTRAINT red_mail_adrese_propuse_metoda_ck CHECK (metoda_verificare IS NULL OR metoda_verificare IN ('verificat_telefon', 'verificat_semnatura', 'verificat_prezenta', 'verificat_alt')),
  nota text CONSTRAINT red_mail_adrese_propuse_nota_ck CHECK (nota IS NULL OR length(nota) <= 1000),
  confirmare_operatie_id uuid CONSTRAINT red_mail_adrese_propuse_operatie_uq UNIQUE,
  confirmare_cerere_sha256 text CONSTRAINT red_mail_adrese_propuse_cerere_ck CHECK (confirmare_cerere_sha256 IS NULL OR confirmare_cerere_sha256 ~ '^[0-9a-f]{64}$'),
  golit_la timestamptz,
  versiune integer NOT NULL DEFAULT 1 CONSTRAINT red_mail_adrese_propuse_versiune_ck CHECK (versiune >= 1),
  CONSTRAINT red_mail_adrese_propuse_formular_ck CHECK (sursa <> 'formular_public' OR primit_id IS NULL),
  CONSTRAINT red_mail_adrese_propuse_confirmata_ck CHECK ((stare = 'confirmata') = (confirmat_la IS NOT NULL) AND (confirmat_la IS NULL) = (confirmat_de IS NULL)
    AND (stare <> 'confirmata' OR (metoda_verificare IS NOT NULL AND confirmare_operatie_id IS NOT NULL AND confirmare_cerere_sha256 IS NOT NULL AND email IS NOT NULL))
    AND (stare = 'confirmata' OR (confirmare_operatie_id IS NULL AND confirmare_cerere_sha256 IS NULL))),
  -- Jak r6 P2-03: respins_la NOT NULL ⇔ stare = 'respinsa' (de la respins_la curg cele 30 de zile ale golirii)
  CONSTRAINT red_mail_adrese_propuse_respinsa_ck CHECK ((stare = 'respinsa') = (respins_la IS NOT NULL) AND (respins_la IS NULL) = (respins_de IS NULL)),
  CONSTRAINT red_mail_adrese_propuse_golit_ck CHECK ((golit_la IS NULL AND email IS NOT NULL) OR (golit_la IS NOT NULL AND email IS NULL AND nota IS NULL AND stare <> 'confirmata'))
);
CREATE INDEX idx_red_mail_adrese_propuse_detinator ON public.red_mail_adrese_propuse (detinator_id, stare);
CREATE INDEX idx_red_mail_adrese_propuse_primit ON public.red_mail_adrese_propuse (primit_id) WHERE primit_id IS NOT NULL;
COMMENT ON TABLE public.red_mail_adrese_propuse IS 'Redări e-mail: adrese PROPUSE (formular public / From-ul unui mail), nevalidate. Nu intră în red_detinatori_contact și nu primesc nimic până la confirmarea unui om (fn_red_mail_adresa_confirma, pasul 4). '
  'Golire automată: propusă neconfirmată la 180 de zile de la propus_la, respinsă la 30 de zile de la respins_la (email + nota → NULL, rândul rămâne).';

-- Starea cererilor OAuth (§2.3): state aleator de 32 de octeți, păstrat doar ca sha256, legat de owner + scop, 10 minute, consumat atomic.
CREATE TABLE public.red_mail_oauth_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_sha256 text NOT NULL CONSTRAINT red_mail_oauth_state_sha_uq UNIQUE CONSTRAINT red_mail_oauth_state_sha_ck CHECK (state_sha256 ~ '^[0-9a-f]{64}$'),
  scop text NOT NULL CONSTRAINT red_mail_oauth_state_scop_ck CHECK (scop IN ('citire', 'citire_test', 'golire', 'golire_test')),
  owner_id uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  expira_la timestamptz NOT NULL,
  consumat_la timestamptz,
  CONSTRAINT red_mail_oauth_state_expira_ck CHECK (expira_la > creat_la AND expira_la <= creat_la + interval '10 minutes'),
  CONSTRAINT red_mail_oauth_state_consumat_ck CHECK (consumat_la IS NULL OR consumat_la >= creat_la)
);
COMMENT ON TABLE public.red_mail_oauth_state IS 'Redări e-mail: state-ul OAuth (doar sha256), legat de owner și de UN scop din maparea unică §2.3 (F1: citire, citire_test, golire, golire_test — implicit (t); trimitere vine cu F2). Fără politici RLS: nimeni din aplicație nu-l citește.';

-- Termenul de retenție al corespondenței pe proiect (fixat de owner; gardul în 20261130k)
ALTER TABLE public.red_proiecte ADD COLUMN retentie_mail_pana date;
COMMENT ON COLUMN public.red_proiecte.retentie_mail_pana IS 'Redări e-mail: termenul de retenție al corespondenței proiectului (golirea asociatelor / trimiselor și ștergerea auditului, doar cu „da”). Doar owner-ul îl schimbă (trigger, 20261130k).';

-- ============================================================================ RLS + GRANT
-- Politicile: DOAR SELECT, doar admin / editor (owner = admin în fn_red_nivel). red_mail_oauth_state: RLS fără nicio politică.
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['red_mail_setari', 'red_mail_flux', 'red_mail_primite', 'red_mail_obiecte', 'red_mail_dedup', 'red_mail_evenimente',
                           'red_mail_raspuns_sursa', 'red_mail_adrese_propuse', 'red_mail_oauth_state'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    IF t <> 'red_mail_oauth_state' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (( SELECT public.fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))', t || '_sel', t);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    END IF;
  END LOOP;
END $rls$;
REVOKE ALL ON SEQUENCE public.red_mail_evenimente_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================ jurnalul
-- fn_red_jurnal: singura schimbare față de baseline (md5 27479409…) = ramura red_mail_* (doar numele câmpurilor, ca la contact / meta) și v_id
-- (pe red_mail_* doar dacă „id” are formă de uuid: red_mail_setari.id = 1, red_mail_flux / red_mail_dedup n-au id). CREATE OR REPLACE păstrează
-- owner-ul, ACL-ul ({postgres=X/postgres}), SECURITY DEFINER și search_path (verificate de postcondiție).
CREATE OR REPLACE FUNCTION public.fn_red_jurnal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vechi jsonb; v_noi jsonb; v_id uuid; v_hash_noi jsonb; v_hash_vechi jsonb; v_id_txt text;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_vechi := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_noi := to_jsonb(NEW); END IF;
  -- actualizările care schimbă doar updated_at nu se jurnalizează
  IF TG_OP = 'UPDATE' AND (v_vechi - 'updated_at') = (v_noi - 'updated_at') THEN
    RETURN NULL;
  END IF;
  -- mascare: valoarea (admin) nu intră în jurnal — doar faptul că e setată
  IF TG_TABLE_NAME = 'red_parcele' THEN
    IF v_vechi IS NOT NULL THEN v_vechi := (v_vechi - 'valoare_lei') || jsonb_build_object('valoare_lei_setata', (v_vechi ->> 'valoare_lei') IS NOT NULL); END IF;
    IF v_noi IS NOT NULL THEN v_noi := (v_noi - 'valoare_lei') || jsonb_build_object('valoare_lei_setata', (v_noi ->> 'valoare_lei') IS NOT NULL); END IF;
  -- PII: pe contact / meta / red_mail_* (20261130j) jurnalul primește DOAR numele câmpurilor schimbate („modificat”), niciodată valorile și nici hash-uri
  ELSIF TG_TABLE_NAME IN ('red_detinatori_contact', 'red_raspunsuri_meta') OR left(TG_TABLE_NAME, 9) = 'red_mail_' THEN
    SELECT jsonb_object_agg(e.k, 'modificat') INTO v_hash_noi
      FROM jsonb_each_text(coalesce(v_noi, '{}'::jsonb) - 'updated_at' - 'detinator_id' - 'raspuns_id') e(k, v)
     WHERE e.v IS NOT NULL AND (v_vechi IS NULL OR (v_vechi ->> e.k) IS DISTINCT FROM e.v);
    SELECT jsonb_object_agg(e.k, 'modificat') INTO v_hash_vechi
      FROM jsonb_each_text(coalesce(v_vechi, '{}'::jsonb) - 'updated_at' - 'detinator_id' - 'raspuns_id') e(k, v)
     WHERE e.v IS NOT NULL AND (v_noi IS NULL OR (v_noi ->> e.k) IS DISTINCT FROM e.v);
    v_noi := CASE WHEN v_noi IS NULL THEN NULL ELSE coalesce(v_hash_noi, '{}'::jsonb) END;
    v_vechi := CASE WHEN v_vechi IS NULL THEN NULL ELSE coalesce(v_hash_vechi, '{}'::jsonb) END;
  END IF;
  IF left(TG_TABLE_NAME, 9) = 'red_mail_' THEN
    -- 20261130j: pe red_mail_* doar „id”, și doar dacă e uuid (altfel NULL) — fără cast care ar putea arunca
    v_id_txt := coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id');
    v_id := CASE WHEN v_id_txt ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_id_txt::uuid END;
  ELSE
    v_id := coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id', to_jsonb(NEW) ->> 'detinator_id', to_jsonb(OLD) ->> 'detinator_id',
                     to_jsonb(NEW) ->> 'raspuns_id', to_jsonb(OLD) ->> 'raspuns_id')::uuid;
  END IF;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id, user_email)
  VALUES (TG_TABLE_NAME, v_id, lower(TG_OP), v_vechi, v_noi, auth.uid(), auth.jwt() ->> 'email');
  RETURN NULL;
END $function$;

-- Jurnalul pe tabelele red_mail_* care se schimbă prin pașii oamenilor / ai worker-elor (fără evenimente: sunt deja jurnal; fără oauth_state).
-- Rândurile inițiale (setari id = 1, cele 2 rânduri flux) sunt inserate ÎNAINTEA triggerelor: nu lasă urme în red_jurnal.
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_mail_setari FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_mail_flux FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_mail_primite FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_mail_obiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_mail_dedup FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_mail_raspuns_sursa FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_mail_adrese_propuse FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();

-- red_jurnal_sel (§2.1): rândurile red_mail_* le văd doar admin / editor (alături de contact / meta). Restul politicii: neschimbat.
ALTER POLICY red_jurnal_sel ON public.red_jurnal USING (
  (( SELECT public.fn_red_nivel() AS fn_red_nivel) IS NOT NULL)
  AND (((tabela <> ALL (ARRAY['red_detinatori_contact'::text, 'red_raspunsuri_meta'::text])) AND (left(tabela, 9) <> 'red_mail_'::text))
       OR (( SELECT public.fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY['admin'::text, 'editor'::text]))));

-- ============================================================================ Storage: prefixul mail/ (§1.8)
-- Conjunctul de nivel superior left(name, 5) <> 'mail/' pe toate cele trei politici red_storage_* (bucketul rămâne primul operand: verificatorul
-- fn_red_storage_expr_bucket le leagă în continuare de 'redari'). Nicio politică nouă: INSERT / DELETE pe mail/ doar service_role (ocolește RLS).
ALTER POLICY red_storage_sel ON storage.objects USING (
  (bucket_id = 'redari'::text) AND (public.fn_red_nivel() = ANY (ARRAY['admin'::text, 'editor'::text])) AND (left(name, 5) <> 'mail/'::text));
ALTER POLICY red_storage_ins ON storage.objects WITH CHECK (
  (bucket_id = 'redari'::text) AND (public.fn_red_nivel() = ANY (ARRAY['admin'::text, 'editor'::text])) AND (left(name, 5) <> 'mail/'::text));
ALTER POLICY red_storage_coresp_sel ON storage.objects USING (
  (bucket_id = 'redari'::text) AND ((storage.foldername(name))[2] = 'corespondenta'::text) AND (public.fn_red_nivel() = 'viewer'::text)
  AND (EXISTS (SELECT 1 FROM public.red_corespondenta_fisiere f WHERE f.path = objects.name)) AND (left(name, 5) <> 'mail/'::text));

-- ============================================================================ postcondiții (inventarul §1.12, punct cu punct)
SELECT public.fn_red_mail_verifica_baza('dupa_j');
DO $post$
DECLARE r record; v_n integer; v_txt text;
BEGIN
  -- (1) coloanele, exact și în ordine, pe fiecare tabel nou (numele; tipurile cheie verificate separat mai jos)
  FOR r IN SELECT * FROM (VALUES
      ('red_mail_setari', 'id,citire_activa,ultima_eroare_cod,retentie_activa,golire_gmail_activa,retentie_lease_token,retentie_lease_pana,versiune,actualizat_la'),
      ('red_mail_flux', 'casuta,flux,history_id,mod_cursor,data_start,data_import_de_la,recuperare_tip,recuperare_history_id,recuperare_page_token,mod_test,activ,lease_token,lease_pana,ultima_eroare_cod,versiune'),
      ('red_mail_primite', 'id,casuta,test,gmail_id,gmail_id_hmac,hmac_versiune,primit_la,data_declarata,thread_id,rfc_message_id,coliziune_message_id,raw_sha256,in_reply_to,'
        || 'references_ids,de_la_adresa,de_la_nume,reply_to,catre,subiect,corp_text,corp_trunchiat,subiect_trunchiat,charset_necunoscut,doar_html,fara_corp,eml_absent,'
        || 'auth_spf,auth_dkim,auth_dmarc,auth_sursa,stare_ingestie,motiv_cod,ingestie_inceputa_la,ingestie_finalizata_la,indicii,conflict_indicii,expeditor_diferit,'
        || 'reply_to_diferit,corespondenta_id,detinator_id,parcela_id,asociat_de,asociat_la,a_fost_asociat,stare,rezolvat_de,rezolvat_la,ignorat_la,ignorat_de,ignorat_motiv,'
        || 'verificare,verificat_de,verificat_la,verificare_nota,nota,cere_dezabonare,inregistrat_in_registru,retentie_stare,golire_claim_token,golire_claim_pana,golit_la,'
        || 'limita_absoluta_la,blocaj_stare,retentie_blocata_motiv,blocaj_cerut_de,blocaj_cerut_la,eliberat_golire_la,eliberat_golire_de,eliberat_golire_motiv,'
        || 'gmail_stergere_stare,gmail_trash_incercare_id,gmail_trash_inceput_la,gmail_trash_valabil_pana,gmail_in_cos_la,gmail_absent_verificat_la,'
        || 'gmail_stergere_eroare_cod,rezerva_la,dedup_incheiat_la,versiune,creat_la'),
      ('red_mail_obiecte', 'id,primit_id,tip,nr,cale,nume,mime_declarat,mime_detectat,marime_declarata,marime,sha256,stare,stergere_autorizata_la,creat_la'),
      ('red_mail_dedup', 'casuta,gmail_id_hmac,hmac_versiune,golit_la,gmail_id,gmail_stergere_stare,gmail_trash_incercare_id,gmail_trash_inceput_la,gmail_trash_valabil_pana,'
        || 'claim_token,claim_pana,blocaj_stare,gmail_in_cos_la,gmail_absent_verificat_la,gmail_stergere_eroare_cod,rezerva_la,limita_absoluta_la'),
      ('red_mail_evenimente', 'id,tip,primit_id,obiect_id,casuta,gmail_id_hmac,cod,numar,numaratori,autor,creat_la'),
      ('red_mail_raspuns_sursa', 'id,raspuns_id,tip_sursa,primit_id,detinator_id,operatie_id,cerere_sha256,metoda_verificare,verificat_de,verificat_la,data_raspuns,motiv_data,mesaj_sursa_id,creat_la'),
      ('red_mail_adrese_propuse', 'id,detinator_id,email,sursa,primit_id,propus_la,stare,confirmat_de,confirmat_la,respins_de,respins_la,metoda_verificare,nota,'
        || 'confirmare_operatie_id,confirmare_cerere_sha256,golit_la,versiune'),
      ('red_mail_oauth_state', 'id,state_sha256,scop,owner_id,creat_la,expira_la,consumat_la')
    ) AS b(t, cols) LOOP
    SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_txt FROM pg_attribute WHERE attrelid = ('public.' || r.t)::regclass AND attnum > 0 AND NOT attisdropped;
    IF v_txt IS DISTINCT FROM r.cols THEN RAISE EXCEPTION '20261130j post: coloanele lui % nu sunt cele din inventar: %', r.t, v_txt; END IF;
  END LOOP;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.red_mail_flux'::regclass AND attname = 'history_id') IS DISTINCT FROM 'numeric(20,0)'
     OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.red_mail_flux'::regclass AND attname = 'recuperare_history_id') IS DISTINCT FROM 'numeric(20,0)'
     OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.red_mail_flux'::regclass AND attname = 'data_start') IS DISTINCT FROM 'timestamp with time zone'
     OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.red_mail_raspuns_sursa'::regclass AND attname = 'data_raspuns') IS DISTINCT FROM 'date'
     OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.red_proiecte'::regclass AND attname = 'retentie_mail_pana') IS DISTINCT FROM 'date' THEN
    RAISE EXCEPTION '20261130j post: tipurile history_id / data_start / data_raspuns / retentie_mail_pana nu sunt cele din inventar';
  END IF;
  -- NOT NULL + DEFAULT pe coloanele de stare (fără NULL, deci fără ramuri necunoscute în CHECK-uri; Cop r17 P3-01)
  FOR r IN SELECT * FROM (VALUES
      ('red_mail_primite', 'retentie_stare', '''activ''::text'), ('red_mail_primite', 'gmail_stergere_stare', '''necerut''::text'),
      ('red_mail_primite', 'stare', '''nou''::text'), ('red_mail_primite', 'stare_ingestie', '''in_curs''::text'), ('red_mail_primite', 'blocaj_stare', '''fara''::text'),
      ('red_mail_primite', 'verificare', '''neverificat''::text'), ('red_mail_primite', 'auth_sursa', '''necunoscut''::text'), ('red_mail_primite', 'a_fost_asociat', 'false'),
      ('red_mail_flux', 'activ', 'false'), ('red_mail_flux', 'mod_cursor', '''neinitializat''::text'), ('red_mail_setari', 'citire_activa', 'false'),
      ('red_mail_setari', 'retentie_activa', 'false'), ('red_mail_setari', 'golire_gmail_activa', 'false'), ('red_mail_dedup', 'blocaj_stare', '''fara''::text'),
      ('red_mail_adrese_propuse', 'stare', '''propusa''::text'), ('red_mail_obiecte', 'stare', '''asteptat''::text')
    ) AS b(t, c, d) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
                    WHERE a.attrelid = ('public.' || r.t)::regclass AND a.attname = r.c AND a.attnotnull AND pg_get_expr(ad.adbin, ad.adrelid) = r.d) THEN
      RAISE EXCEPTION '20261130j post: %.% nu e NOT NULL DEFAULT %', r.t, r.c, r.d;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.red_mail_primite'::regclass AND attname IN ('casuta') AND attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.red_mail_primite'::regclass AND attname IN ('test') AND attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.red_mail_raspuns_sursa'::regclass AND attname = 'tip_sursa' AND attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.red_mail_dedup'::regclass AND attname = 'limita_absoluta_la' AND attnotnull) THEN
    RAISE EXCEPTION '20261130j post: casuta / test / tip_sursa / limita_absoluta_la trebuie NOT NULL';
  END IF;
  -- (2) enumurile: textul EXACT al fiecărui CHECK de enum (valorile complete din §1.12)
  FOR r IN SELECT * FROM (VALUES
      ('red_mail_flux', 'red_mail_flux_flux_ck', 'CHECK ((flux = ANY (ARRAY[''inbox''::text, ''sent''::text, ''import''::text])))'),
      ('red_mail_flux', 'red_mail_flux_mod_cursor_ck', 'CHECK ((mod_cursor = ANY (ARRAY[''neinitializat''::text, ''normal''::text, ''recuperare''::text])))'),
      ('red_mail_flux', 'red_mail_flux_recuperare_tip_ck', 'CHECK (((recuperare_tip IS NULL) OR (recuperare_tip = ANY (ARRAY[''activare''::text, ''cursor_expirat''::text]))))'),
      ('red_mail_flux', 'red_mail_flux_casuta_ck', 'CHECK ((casuta = ANY (ARRAY[''redari@gazpet.ro''::text, ''redari-test@gazpet.ro''::text])))'),
      ('red_mail_primite', 'red_mail_primite_stare_ingestie_ck', 'CHECK ((stare_ingestie = ANY (ARRAY[''in_curs''::text, ''ok''::text, ''neprocesabil''::text])))'),
      ('red_mail_primite', 'red_mail_primite_stare_ck', 'CHECK ((stare = ANY (ARRAY[''nou''::text, ''asociat''::text, ''rezolvat''::text, ''ignorat''::text])))'),
      ('red_mail_primite', 'red_mail_primite_gmail_stare_ck', 'CHECK ((gmail_stergere_stare = ANY (ARRAY[''necerut''::text, ''de_mutat_in_cos''::text, ''trash_in_apel''::text, ''in_cos''::text, ''verificat_absent''::text, ''de_decis''::text, ''esuat''::text, ''pastrat_de_om''::text, ''expirat''::text])))'),
      ('red_mail_primite', 'red_mail_primite_verificare_ck', 'CHECK ((verificare = ANY (ARRAY[''neverificat''::text, ''verificat_telefon''::text, ''verificat_semnatura''::text, ''verificat_prezenta''::text, ''verificat_alt''::text])))'),
      ('red_mail_primite', 'red_mail_primite_retentie_stare_ck', 'CHECK ((retentie_stare = ANY (ARRAY[''activ''::text, ''in_golire''::text, ''golit''::text])))'),
      ('red_mail_primite', 'red_mail_primite_blocaj_ck', 'CHECK ((blocaj_stare = ANY (ARRAY[''fara''::text, ''cerut''::text, ''activ''::text])))'),
      ('red_mail_primite', 'red_mail_primite_auth_sursa_ck', 'CHECK ((auth_sursa = ANY (ARRAY[''mx_google''::text, ''necunoscut''::text])))'),
      ('red_mail_primite', 'red_mail_primite_eml_absent_ck', 'CHECK (((eml_absent IS NULL) OR (eml_absent = ''prea_mare''::text)))'),
      ('red_mail_primite', 'red_mail_primite_motiv_cod_ck', 'CHECK (((motiv_cod IS NULL) OR (motiv_cod = ANY (ARRAY[''prea_mare''::text, ''structura_invalida''::text, ''decodare_imposibila''::text, ''raspuns_peste_plafon''::text, ''conflict_obiect''::text, ''ingestie_blocata''::text]))))'),
      ('red_mail_primite', 'red_mail_primite_casuta_ck', 'CHECK ((casuta = ANY (ARRAY[''redari@gazpet.ro''::text, ''redari-test@gazpet.ro''::text])))'),
      ('red_mail_primite', 'red_mail_primite_test_ck', 'CHECK ((test = (casuta <> ''redari@gazpet.ro''::text)))'),
      ('red_mail_primite', 'red_mail_primite_eliberat_ck', 'CHECK ((((eliberat_golire_la IS NULL) = (eliberat_golire_de IS NULL)) AND ((eliberat_golire_la IS NOT NULL) OR (eliberat_golire_motiv IS NULL)) AND ((eliberat_golire_la IS NULL) OR (eliberat_golire_motiv IS NOT NULL) OR (retentie_stare = ''golit''::text))))'),
      ('red_mail_obiecte', 'red_mail_obiecte_tip_ck', 'CHECK ((tip = ANY (ARRAY[''eml''::text, ''atasament''::text])))'),
      ('red_mail_obiecte', 'red_mail_obiecte_stare_ck', 'CHECK ((stare = ANY (ARRAY[''asteptat''::text, ''stocat''::text, ''respins_tip''::text, ''respins_marime''::text, ''respins_structura''::text, ''respins_buget''::text, ''conflict_obiect''::text, ''in_stergere''::text, ''sters''::text])))'),
      ('red_mail_dedup', 'red_mail_dedup_gmail_stare_ck', 'CHECK ((gmail_stergere_stare = ANY (ARRAY[''de_mutat_in_cos''::text, ''trash_in_apel''::text, ''in_cos''::text, ''verificat_absent''::text, ''de_decis''::text, ''esuat''::text, ''pastrat_de_om''::text, ''expirat''::text])))'),
      ('red_mail_dedup', 'red_mail_dedup_blocaj_ck', 'CHECK ((blocaj_stare = ANY (ARRAY[''fara''::text, ''cerut''::text, ''activ''::text])))'),
      ('red_mail_evenimente', 'red_mail_evenimente_tip_ck', 'CHECK ((tip = ANY (ARRAY[''activare''::text, ''ingestie_ok''::text, ''ingestie_neprocesabil''::text, ''deja_golit''::text, ''disparut''::text, ''spam_numarat''::text, ''dry_rulat''::text, ''recuperare_inceputa''::text, ''recuperare_terminata''::text, ''lease_pierdut''::text, ''eroare_citire''::text, ''descarcare''::text, ''golire''::text, ''blocaj_cerut''::text, ''blocaj_activ''::text, ''blocaj_ridicat''::text, ''orfane_sterse''::text, ''alerta_de_triat''::text, ''alerta_escaladare''::text, ''oauth_conectat''::text, ''oauth_respins''::text, ''oauth_revocat''::text, ''tombstone_sters''::text, ''neprocesabil_eliberat''::text, ''eliberare_anulata''::text, ''gmail_trash_inceput''::text, ''gmail_in_cos''::text, ''gmail_trash_ambiguu''::text, ''gmail_de_decis''::text, ''gmail_absent_verificat''::text, ''gmail_stergere_esuata''::text, ''metoda_nepermisa''::text, ''trash_tardiv''::text, ''alerta_gmail_stergere''::text, ''alerta_dedup_expira''::text, ''tombstone_sters_termen''::text, ''hmac_cheie_retrasa''::text])))'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_tip_ck', 'CHECK ((tip_sursa = ANY (ARRAY[''gmail_redari''::text, ''manual_verificat''::text, ''gmail_redari_sters''::text])))'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_metoda_ck', 'CHECK ((metoda_verificare = ANY (ARRAY[''verificat_telefon''::text, ''verificat_semnatura''::text, ''verificat_prezenta''::text, ''verificat_alt''::text])))'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_manual_ck', 'CHECK ((((tip_sursa = ''manual_verificat''::text) AND (data_raspuns IS NOT NULL) AND (motiv_data IS NOT NULL) AND (primit_id IS NULL)) OR ((tip_sursa <> ''manual_verificat''::text) AND (data_raspuns IS NULL) AND (motiv_data IS NULL))))'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_mesaj_manual_ck', 'CHECK (((mesaj_sursa_id IS NULL) OR (tip_sursa = ''manual_verificat''::text)))'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_gmail_ck', 'CHECK (((tip_sursa <> ''gmail_redari''::text) OR (primit_id IS NOT NULL)))'),
      ('red_mail_adrese_propuse', 'red_mail_adrese_propuse_sursa_ck', 'CHECK ((sursa = ANY (ARRAY[''formular_public''::text, ''mail_primit''::text])))'),
      ('red_mail_adrese_propuse', 'red_mail_adrese_propuse_stare_ck', 'CHECK ((stare = ANY (ARRAY[''propusa''::text, ''confirmata''::text, ''respinsa''::text])))'),
      ('red_mail_adrese_propuse', 'red_mail_adrese_propuse_respinsa_ck', 'CHECK ((((stare = ''respinsa''::text) = (respins_la IS NOT NULL)) AND ((respins_la IS NULL) = (respins_de IS NULL))))'),
      ('red_mail_oauth_state', 'red_mail_oauth_state_scop_ck', 'CHECK ((scop = ANY (ARRAY[''citire''::text, ''citire_test''::text, ''golire''::text, ''golire_test''::text])))')
    ) AS b(t, cn, def) LOOP
    IF (SELECT replace(pg_get_constraintdef(oid), 'public.', '') FROM pg_constraint WHERE conrelid = ('public.' || r.t)::regclass AND conname = r.cn AND contype = 'c') IS DISTINCT FROM r.def THEN
      RAISE EXCEPTION '20261130j post: CHECK-ul %.% nu are textul din inventar', r.t, r.cn;
    END IF;
  END LOOP;
  -- (3) cheile: UNIQUE / PK / FK exact (coloanele, în ordine)
  FOR r IN SELECT * FROM (VALUES
      ('red_mail_flux', 'red_mail_flux_pk', 'PRIMARY KEY (casuta, flux)'),
      ('red_mail_primite', 'red_mail_primite_casuta_hmac_uq', 'UNIQUE (casuta, gmail_id_hmac)'),
      ('red_mail_primite', 'red_mail_primite_incercare_uq', 'UNIQUE (gmail_trash_incercare_id)'),
      ('red_mail_obiecte', 'red_mail_obiecte_primit_tip_nr_uq', 'UNIQUE (primit_id, tip, nr)'),
      ('red_mail_obiecte', 'red_mail_obiecte_cale_uq', 'UNIQUE (cale)'),
      ('red_mail_obiecte', 'red_mail_obiecte_primit_fk', 'FOREIGN KEY (primit_id) REFERENCES red_mail_primite(id)'),
      ('red_mail_dedup', 'red_mail_dedup_pk', 'PRIMARY KEY (casuta, gmail_id_hmac)'),
      ('red_mail_dedup', 'red_mail_dedup_incercare_uq', 'UNIQUE (gmail_trash_incercare_id)'),
      ('red_mail_evenimente', 'red_mail_evenimente_primit_fk', 'FOREIGN KEY (primit_id) REFERENCES red_mail_primite(id) ON DELETE CASCADE'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_raspuns_uq', 'UNIQUE (raspuns_id)'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_raspuns_fk', 'FOREIGN KEY (raspuns_id) REFERENCES red_raspunsuri(id) ON DELETE CASCADE'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_primit_det_uq', 'UNIQUE (primit_id, detinator_id)'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_mesaj_det_uq', 'UNIQUE (mesaj_sursa_id, detinator_id)'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_operatie_uq', 'UNIQUE (operatie_id)'),
      ('red_mail_raspuns_sursa', 'red_mail_raspuns_sursa_mesaj_fk', 'FOREIGN KEY (mesaj_sursa_id) REFERENCES red_mail_primite(id)'),
      ('red_mail_adrese_propuse', 'red_mail_adrese_propuse_operatie_uq', 'UNIQUE (confirmare_operatie_id)'),
      ('red_mail_adrese_propuse', 'red_mail_adrese_propuse_detinator_fk', 'FOREIGN KEY (detinator_id) REFERENCES red_detinatori(id)'),
      ('red_mail_oauth_state', 'red_mail_oauth_state_sha_uq', 'UNIQUE (state_sha256)')
    ) AS b(t, cn, def) LOOP
    IF (SELECT replace(pg_get_constraintdef(oid), 'public.', '') FROM pg_constraint WHERE conrelid = ('public.' || r.t)::regclass AND conname = r.cn) IS DISTINCT FROM r.def THEN
      RAISE EXCEPTION '20261130j post: cheia %.% nu e cea din inventar', r.t, r.cn;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'red_mail_primite_casuta_gmail_id_uq'
                  AND indexdef = 'CREATE UNIQUE INDEX red_mail_primite_casuta_gmail_id_uq ON public.red_mail_primite USING btree (casuta, gmail_id) WHERE (gmail_id IS NOT NULL)')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_red_mail_primite_msgid' AND indexdef NOT LIKE 'CREATE UNIQUE%') THEN
    RAISE EXCEPTION '20261130j post: indexul UNIQUE parțial (casuta, gmail_id) / indexul neunic pe rfc_message_id lipsesc';
  END IF;
  -- (4) RLS pornit pe toate, fără FORCE; politici: exact una de SELECT pe tabel (oauth_state: zero), niciuna de scriere; privilegii: doar SELECT
  SELECT count(*) INTO v_n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname ~ '^red_mail_';
  IF v_n <> 9 THEN RAISE EXCEPTION '20261130j post: % tabele red_mail_* (asteptat 9)', v_n; END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname ~ '^red_mail_' AND (NOT relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename ~ '^red_mail_' AND (cmd <> 'SELECT' OR permissive <> 'PERMISSIVE'
                 OR roles <> ARRAY['authenticated']::name[] OR with_check IS NOT NULL
                 OR replace(qual, 'public.', '') <> '(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))'))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename ~ '^red_mail_') <> 8
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'red_mail_oauth_state') THEN
    RAISE EXCEPTION '20261130j post: RLS / politicile red_mail_* nu sunt cele asteptate (doar SELECT admin / editor; oauth_state fara politici)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) g(rol), unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
              WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname ~ '^red_mail_' AND has_table_privilege(g.rol, c.oid, p.priv))
     OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname ~ '^red_mail_'
                 AND (has_table_privilege('anon', c.oid, 'SELECT') OR (c.relname <> 'red_mail_oauth_state') <> has_table_privilege('authenticated', c.oid, 'SELECT')))
     OR has_table_privilege('authenticated', 'public.red_mail_oauth_state', 'SELECT') OR has_table_privilege('service_role', 'public.red_mail_oauth_state', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                 WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_mail_' AND a.grantee = 0)
     OR has_sequence_privilege('authenticated', 'public.red_mail_evenimente_id_seq', 'USAGE') OR has_sequence_privilege('service_role', 'public.red_mail_evenimente_id_seq', 'USAGE')
     OR EXISTS (SELECT 1 FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name ~ '^red_mail_'
                 AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC') AND privilege_type <> 'SELECT') THEN
    RAISE EXCEPTION '20261130j post: privilegii de scriere / PUBLIC / anon pe red_mail_* (asteptat: doar SELECT pentru authenticated / service_role)';
  END IF;
  -- (5) rândurile inițiale: exact 1 setare (toate comutatoarele oprite) + 2 fluxuri inbox inactive, neinițializate; nimic altceva
  IF (SELECT count(*) FROM public.red_mail_setari WHERE id = 1 AND NOT citire_activa AND NOT retentie_activa AND NOT golire_gmail_activa AND retentie_lease_token IS NULL) <> 1
     OR (SELECT count(*) FROM public.red_mail_setari) <> 1
     OR (SELECT count(*) FROM public.red_mail_flux) <> 2
     OR (SELECT count(*) FROM public.red_mail_flux WHERE flux = 'inbox' AND NOT activ AND mod_cursor = 'neinitializat' AND history_id IS NULL AND data_start IS NULL
           AND ((casuta = 'redari@gazpet.ro' AND NOT mod_test) OR (casuta = 'redari-test@gazpet.ro' AND mod_test))) <> 2
     OR EXISTS (SELECT 1 FROM public.red_mail_primite) OR EXISTS (SELECT 1 FROM public.red_mail_evenimente) OR EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa)
     OR EXISTS (SELECT 1 FROM public.red_mail_adrese_propuse) OR EXISTS (SELECT 1 FROM public.red_mail_oauth_state) OR EXISTS (SELECT 1 FROM public.red_mail_dedup)
     OR EXISTS (SELECT 1 FROM public.red_mail_obiecte) OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE left(tabela, 9) = 'red_mail_') THEN
    RAISE EXCEPTION '20261130j post: randurile initiale nu sunt cele asteptate';
  END IF;
  -- (6) triggerele de jurnal: exact pe cele 7 tabele, AFTER INSERT OR UPDATE OR DELETE, ROW, fn_red_jurnal, active
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_mail_' AND NOT t.tgisinternal) <> 7
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgname = 'trg_red_jurnal'
           AND t.tgfoid = 'public.fn_red_jurnal()'::regprocedure AND t.tgtype = 29 AND t.tgenabled = 'O'
           AND c.relname IN ('red_mail_setari', 'red_mail_flux', 'red_mail_primite', 'red_mail_obiecte', 'red_mail_dedup', 'red_mail_raspuns_sursa', 'red_mail_adrese_propuse')) <> 7 THEN
    RAISE EXCEPTION '20261130j post: triggerele de jurnal pe red_mail_* nu sunt cele asteptate';
  END IF;
  -- (7) red_proiecte: coloana nouă e NULL peste tot și nimic altceva atins (triggerele rămân cele 2 din baseline)
  IF EXISTS (SELECT 1 FROM public.red_proiecte WHERE retentie_mail_pana IS NOT NULL)
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_proiecte'::regclass AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '20261130j post: red_proiecte neasteptat dupa ADD COLUMN';
  END IF;
END $post$;
