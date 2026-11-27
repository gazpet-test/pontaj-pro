-- Version 20270115120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270115a_ofertare_clarificari_puncte_citire.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte”
--   al runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA). Manifestul .l15.tsv îl generează coordonatorul pe
--   clonă (scripts/livrare_l15_manifest.sh --iesire, docs/LIVRARE_L15_V2.md §5); lista OBIECTELOR revizuită (generată pe PGlite cu pașii reali
--   ai runnerului): supabase/tests/20270115a_ofertare_clarificari_puncte_citire.l15.obiecte.tsv. Dry-run pe clonă după aplicare (ROLLBACK):
--   supabase/tests/20270115a_ofertare_clarificari_puncte_citire_dryrun.sql.
-- 20270115a_ofertare_clarificari_puncte_citire — Ofertare: punctele unei clarificări (public.ofertare_clarificari_puncte) se citesc și se scriu
--   DOAR de ownerul și de responsabilii licitației clarificării (decizia owner-ului, 27.11.2026, după review-ul PR #1204). Azi: clar_puncte_sel
--   (SELECT) = USING (auth.uid() IS NOT NULL) — ORICE cont logat citește punctele; clar_puncte_rw (ALL, deci și SELECT, politicile permisive se
--   combină cu OR) = fn_are_acces_ofertare() — oricine cu modulul Ofertare le scrie și le citește.
-- Ce face (trei funcții noi + un trigger pe părinte + două politici schimbate, nimic altceva):
--   1. fn_ofertare_clar_are_puncte(p_clarificare_id) — sql VOLATILE SECURITY DEFINER: clarificarea are puncte (DEFINER ca să vadă punctele indiferent
--      de RLS-ul apelantului; întoarce doar un boolean; VOLATILE ca să citească cu un instantaneu PROASPĂT, după ce triggerul a așteptat lock-ul
--      rândului — vezi 3). Folosită de garda părintelui la ștergere.
--   2. fn_ofertare_clar_puncte_poarta(p_clarificare_id) — sql STABLE SECURITY DEFINER, cale sigură: utilizatorul CURENT (auth.uid(), L08: niciodată
--      un parametru) are acces la modulul Ofertare (fn_are_acces_ofertare(), ca azi) ȘI trece poarta pe cheltuială a licitației clarificării
--      (fn_ofertare_poate_cheltui(c.licitatie_id, auth.uid()), 20261124a: owner; responsabil 1 / 2 numit de owner / admin Ofertare — aceeași poartă ca
--      la orice procesare plătită din Ofertare). DEFINER fiindcă fn_ofertare_poate_cheltui are EXECUTE doar pentru service_role și fiindcă licitația
--      clarificării se citește indiferent de RLS-ul apelantului (întoarce DOAR un boolean; clarificare inexistentă = false). EXECUTE: authenticated +
--      service_role (politicile o cheamă ca authenticated; UI-ul o întreabă prin RPC înaintea exportului adresei); nimic pentru PUBLIC / anon.
--   3. fn_ofertare_clar_parinte_puncte_garda() — plpgsql SECURITY INVOKER (ca să deosebească apelantul prin current_user; review Jakarinos r1 P1 #1 / #2):
--      pe PĂRINTE (ofertare_clarificari), BEFORE UPDATE OF licitatie_id OR DELETE, FOR EACH ROW. Doar pentru apelurile clientului (current_user
--      authenticated / anon): (a) mutarea unei clarificări pe altă licitație e refuzată ÎNTOTDEAUNA (cu sau fără puncte — review r2 P1: „fără puncte”
--      ar fi o cursă cu inserarea concurentă a primului punct, UPDATE-ul lui licitatie_id ia doar NO KEY UPDATE și nu așteaptă KEY SHARE-ul FK-ului;
--      mutarea nu e flux din aplicație; serverul o poate face); (b) ștergerea unei clarificări CU puncte (cascada ar șterge punctele) e permisă doar
--      cui trece poarta punctelor; fără puncte, ca azi. Serializarea ștergerii: PostgreSQL blochează rândul (GetTupleForTrigger) ÎNAINTE de a chema
--      triggerul BEFORE ROW, iar inserarea unui punct ține KEY SHARE pe părinte prin FK → DELETE-ul așteaptă inserarea necomisă, apoi are_puncte
--      (VOLATILE, instantaneu nou) vede punctul comis și refuză; invers, inserarea punctului așteaptă DELETE-ul necomis și pică pe FK (23503) — nu
--      rămâne niciun punct orfan și niciunul șters pe la spate. Proba cu două sesiuni: supabase/tests/20270115a_…_concurenta.sh (clonă dispensabilă).
--      service_role / postgres / RPC-urile DEFINER trec (nu sunt persoane; porțile lor sunt în edge / RPC).
--   4. CREATE TRIGGER trg_ofertare_clar_parinte_puncte pe public.ofertare_clarificari.
--   5. ALTER POLICY clar_puncte_sel USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id));
--   6. ALTER POLICY clar_puncte_rw USING (…aceeași…) WITH CHECK (…aceeași…) — rw e ALL și include SELECT: fără pasul 6 restrângerea de la 5 n-ar
--      avea efect (OR între politici). Un singur predicat pentru citire și scriere (L19).
--   Ce poate face, după migrare, un cont cu acces Ofertare care NU e owner / responsabil al licitației: NU citește punctele, NU scrie puncte
--   (INSERT = 42501, UPDATE / DELETE ating 0 rânduri), NU șterge o clarificare care are puncte (42501); clarificările fără puncte le editează / șterge
--   ca azi. NIMENI din aplicație (nici owner-ul, nici responsabilul) nu mai mută o clarificare pe altă licitație (42501; nu există flux UI pentru asta;
--   serverul poate). Owner-ul vede și scrie tot restul (poarta e adevărată pentru orice licitație).
-- Ce NU face: nu creează / nu șterge tabele, politici sau drepturi pe tabele, nu atinge triggerele existente, funcțiile existente (fn_are_acces_ofertare,
--   fn_ofertare_poate_cheltui, fn_clar_punct_semneaza), politicile părintelui (20270113a), nicio dată; nu dă acces la Ofertare nimănui. Temeiurile de
--   pe puncte (ofertare_clarificari_temeiuri, politici neatinse) rămân citibile cu modulul; UI-ul le citește prin join cu punctele, deci exportul
--   adresei verifică poarta PE SERVER (RPC fn_ofertare_clar_puncte_poarta) pentru fiecare întrebare exportată și refuză explicit altfel.
-- Starea de pornire (L14, sub lock): politicile tabelului de puncte sunt EXACT cele 2 de azi (nume, comandă, PERMISSIVE, rolul authenticated, USING /
--   WITH CHECK deparsate — forma din 20260928l / brief-ul coordonatorului, 27.11.2026; altă formă = refuz, coordonatorul dă textul exact din pg_policies),
--   RLS activ și neforțat pe puncte, FK-ul clarificare_id → ofertare_clarificari(id) există, ofertare_clarificari.licitatie_id există, cele 3 funcții noi
--   și triggerul nou NU există (reaplicare = refuz, fără supraîncărcări), fn_are_acces_ofertare și fn_ofertare_poate_cheltui au corpul / DEFINER /
--   calea / proprietarul / drepturile din 20260912 respectiv 20261124a; altceva = refuz, nimic schimbat.
-- Lock-uri (L06), în ordinea: (1) ACCESS EXCLUSIVE NOWAIT pe public.ofertare_clarificari_puncte (ALTER POLICY), bugetul 1 s de la prima încercare
--   (blocul $lock$); (2) apoi SHARE ROW EXCLUSIVE NOWAIT pe public.ofertare_clarificari (CREATE TRIGGER; ocupat = 55P03 imediat, nimic schimbat),
--   ÎNAINTEA verificărilor de stare (L14). CREATE FUNCTION nu blochează tabele. Nimic altceva blocat.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), bugetul de lock 1 s, lock_timeout 100 ms
--   (lock-urile implicite), garda finală a runnerului (PLAFON_TIMP + LOCK_TINUT). Sub lock nu se numără rânduri (nimic de scanat).
-- Ordinea livrării (review r2 P1 #3): UI-ul ÎNTÂI (merge + Vercel; exportul adresei cheamă RPC-ul nou și, cât migrarea nu e aplicată, refuză
--   fail-closed — „poarta punctelor nu s-a putut verifica pe server”; punctele rămân vizibile tuturor până la migrare, deci nimic nu lipsește din
--   nicio adresă exportată de UI-ul vechi), APOI migrarea, cât mai aproape de deploy. Rest declarat: filele deschise cu UI-ul vechi peste momentul
--   migrării ar exporta fără temeiurile de pe puncte până la reîncărcare (Ctrl+Shift+R după deploy, regula casei); serverul nu poate deosebi acel UI.
--   Independentă de 20270112a (NEAPLICATĂ) și compatibilă cu 20270113a (APLICATĂ 27.11.2026 — proba PGlite rulează cu 20270113a aplicată și fără ea).
-- Revenire: supabase/revenire/20270115a_ofertare_clarificari_puncte_citire_ROLLBACK.sql (readuce cele 2 politici EXACT, apoi șterge triggerul și cele
--   3 funcții; refuză dacă starea nu e cea pusă aici sau dacă altceva depinde de funcții). Revenirea REDESCHIDE citirea punctelor pentru orice cont
--   logat: doar la cererea explicită a owner-ului.
-- Probe: scripts/pglite/test_ofertare_clarificari_puncte_citire_local.mjs (scheletul 20270112a + supabase/tests/20270115a_…_schelet.sql, pașii
--   L15 v2 reali; cazuri de acces pe owner / responsabil 1 / responsabil 2 / autonumit / editor Ofertare / responsabil fără modul / sub-modul /
--   fără modul / anon, scrieri, mutarea / ștergerea părintelui, refuzuri, revenire, mutanți).
DO $pre$
DECLARE v_plafon text; v_alt text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115a_ofertare_clarificari_puncte_citire:' || txid_current() THEN
    RAISE EXCEPTION '20270115a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270115a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270115a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270115a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270115a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20270111a / 20270112a / 20270113a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270115a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ofertare_clarificari_puncte') IS NULL OR (SELECT relkind FROM pg_class WHERE oid = 'public.ofertare_clarificari_puncte'::regclass) <> 'r' THEN
    RAISE EXCEPTION '20270115a: lipseste tabelul public.ofertare_clarificari_puncte';
  END IF;
  IF to_regclass('public.ofertare_clarificari') IS NULL OR (SELECT relkind FROM pg_class WHERE oid = 'public.ofertare_clarificari'::regclass) <> 'r'
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.ofertare_clarificari'::regclass AND a.attname = 'licitatie_id' AND NOT a.attisdropped AND a.atttypid = 'bigint'::regtype) THEN
    RAISE EXCEPTION '20270115a: lipseste public.ofertare_clarificari.licitatie_id (bigint) — poarta si garda parintelui o citesc';
  END IF;
  -- FK-ul clarificare_id → ofertare_clarificari(id): legatura pe care se da poarta
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = 'public.ofertare_clarificari_puncte'::regclass AND k.contype = 'f' AND k.confrelid = 'public.ofertare_clarificari'::regclass
                    AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attname = 'clarificare_id' AND NOT a.attisdropped)]
                    AND k.confkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = k.confrelid AND a.attname = 'id' AND NOT a.attisdropped)]) THEN
    RAISE EXCEPTION '20270115a: lipseste FK-ul ofertare_clarificari_puncte.clarificare_id -> ofertare_clarificari(id)';
  END IF;
  -- reaplicare / coliziune de nume: functiile noi si triggerul nou nu exista inca (nicio supraincarcare)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
               AND p.proname IN ('fn_ofertare_clar_puncte_poarta', 'fn_ofertare_clar_are_puncte', 'fn_ofertare_clar_parinte_puncte_garda')) THEN
    RAISE EXCEPTION '20270115a: una din functiile fn_ofertare_clar_puncte_poarta / fn_ofertare_clar_are_puncte / fn_ofertare_clar_parinte_puncte_garda exista deja (reaplicare sau coliziune de nume)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte') THEN
    RAISE EXCEPTION '20270115a: triggerul trg_ofertare_clar_parinte_puncte exista deja';
  END IF;
  -- dependenta 1: fn_are_acces_ofertare() din 20260912, neschimbata (corp fara CR, limbaj sql, DEFINER, STABLE, cale sigura, proprietar postgres,
  --   drepturi EXACTE: authenticated + service_role + proprietar, nimic pentru anon / PUBLIC) — aceleasi conditii ca in 20270113a
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()')
                   AND md5(replace(p.prosrc, chr(13), '')) = '429d28e2a61fb24c8009d67050c16c85' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_are_acces_ofertare') <> 1 THEN
    RAISE EXCEPTION '20270115a: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';
  END IF;
  -- dependenta 2: fn_ofertare_poate_cheltui(bigint, uuid) din 20261124a, neschimbata (corp fara CR, sql, DEFINER, STABLE, cale sigura, proprietar
  --   postgres, drepturi EXACTE: doar service_role + proprietar — de aceea politica trece prin functia noua DEFINER, nu o cheama direct)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '07fba9e2e4249481fa9184fc48abc58d' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_poate_cheltui') <> 1 THEN
    RAISE EXCEPTION '20270115a: fn_ofertare_poate_cheltui(bigint, uuid) nu e cea din 20261124a (corp md5 07fba9e2e4249481fa9184fc48abc58d, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';
  END IF;
  -- informativ (nu refuz, in afara perimetrului): vederi peste tabelul de puncte FARA security_invoker ar citi ca proprietarul lor, ocolind politicile
  SELECT string_agg(DISTINCT v.oid::regclass::text, ', ' ORDER BY v.oid::regclass::text) INTO v_alt
    FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
   WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.ofertare_clarificari_puncte'::regclass
     AND v.oid <> 'public.ofertare_clarificari_puncte'::regclass
     AND NOT ('security_invoker=on' = ANY (coalesce(v.reloptions, ARRAY[]::text[])));
  IF v_alt IS NOT NULL THEN
    RAISE NOTICE '20270115a: ATENTIE, vederi peste ofertare_clarificari_puncte fara security_invoker (citesc ca proprietarul, in afara acestei migrari): %', v_alt;
  END IF;
END $pre$;

-- ─── 0. Lock-urile, ÎNAINTEA verificărilor de stare (L14): (1) punctele, NOWAIT, bugetul 1 s de la PRIMA încercare (șablonul 20270111a);
--     (2) părintele, SHARE ROW EXCLUSIVE NOWAIT (CREATE TRIGGER); ocupat = 55P03, nimic schimbat. Momentul în gazpet.lock_puternic_la (LOCK_TINUT). ─
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270115a: BUGET_LOCK: ofertare_clarificari_puncte ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.ofertare_clarificari_puncte IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270115a: BUGET_LOCK: lock-ul pe ofertare_clarificari_puncte obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  -- parintele, ULTIMUL si NOWAIT (ocupat = 55P03 imediat; tranzactia cade, nimic scris)
  BEGIN
    LOCK TABLE public.ofertare_clarificari IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION '20270115a: BUGET_LOCK: ofertare_clarificari (parintele) ocupat la % ms de la BEGIN; nimic schimbat', round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END;
  RAISE NOTICE '20270115a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Starea EXACTĂ de azi (sub lock): cele 2 politici (forma din 20260928l / brief 27.11.2026), RLS activ neforțat; fotografia a tot ce NU
--     se schimbă (drepturile ambelor tabele, triggerele punctelor și ale părintelui, cele 3 funcții existente, politicile părintelui, RLS) ─────
DO $stare$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      -- >>> POLITICI PUNCTE 27.11.2026
      ('clar_puncte_sel', 'r|permisiva|{authenticated}|(auth.uid() IS NOT NULL)|-'),
      ('clar_puncte_rw', '*|permisiva|{authenticated}|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)|( SELECT fn_are_acces_ofertare() AS fn_are_acces_ofertare)')
      -- <<< POLITICI PUNCTE 27.11.2026
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a: politicile ofertare_clarificari_puncte difera de cele de azi (27.11.2026): %', v_rau; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '20270115a: RLS pe ofertare_clarificari_puncte nu e activ (sau e fortat)';
  END IF;
  CREATE TEMP TABLE cp_foto ON COMMIT DROP AS
    SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass) a), '(nimic)') AS val
    UNION ALL
    SELECT 'acl_parinte', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari'::regclass) a), '(nimic)')
    UNION ALL
    SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                   FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
    UNION ALL
    -- triggerele parintelui de azi (fara cel nou): dupa migrare, lista fara trg_ofertare_clar_parinte_puncte trebuie sa fie identica
    SELECT 'triggere_parinte', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                           FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal AND tg.tgname <> 'trg_ofertare_clar_parinte_puncte'), '(niciunul)')
    UNION ALL
    SELECT 'politici_parinte', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                           FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass), '(niciuna)')
    UNION ALL
    SELECT 'functie_acces', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                               FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
    UNION ALL
    SELECT 'functie_cheltuiala', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                    FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)'))
    UNION ALL
    SELECT 'functie_trigger', coalesce((SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                          FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_clar_punct_semneaza()')), '(lipsa)')
    UNION ALL
    SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
    UNION ALL
    SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass)
      || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass);
  RAISE NOTICE '20270115a: stare verificata (2 politici pe puncte, RLS activ, parintele fotografiat)';
END $stare$;

-- ─── 2. Schimbarea: doua functii DEFINER (are puncte / poarta), garda INVOKER pe parinte + triggerul ei, cele 2 politici pe poarta ───────────
CREATE FUNCTION public.fn_ofertare_clar_are_puncte(p_clarificare_id bigint)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.ofertare_clarificari_puncte p WHERE p.clarificare_id = p_clarificare_id);
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_clar_are_puncte(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_are_puncte(bigint) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_ofertare_clar_are_puncte(bigint) IS
  '20270115a: clarificarea are puncte (indiferent de RLS-ul apelantului; doar un boolean). Folosita de garda parintelui fn_ofertare_clar_parinte_puncte_garda.';

CREATE FUNCTION public.fn_ofertare_clar_puncte_poarta(p_clarificare_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND public.fn_are_acces_ofertare()
     AND coalesce((SELECT public.fn_ofertare_poate_cheltui(c.licitatie_id, auth.uid()) FROM public.ofertare_clarificari c WHERE c.id = p_clarificare_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_ofertare_clar_puncte_poarta(bigint) IS
  '20270115a: poarta punctelor unei clarificari (RLS pe ofertare_clarificari_puncte, citire si scriere; garda parintelui; RPC-ul UI inaintea exportului adresei) — utilizatorul curent are acces la modulul Ofertare SI e owner / responsabil 1-2 al licitatiei clarificarii (fn_ofertare_poate_cheltui, 20261124a). Clarificare inexistenta = false.';

-- INVOKER: current_user deosebeste apelul clientului (authenticated / anon) de service_role / postgres / RPC-urile DEFINER (acolo current_user e
-- proprietarul); existenta punctelor si poarta vin din cele doua functii DEFINER (boolean, indiferent de RLS). Fara parametri de identitate.
CREATE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.licitatie_id IS DISTINCT FROM OLD.licitatie_id THEN
      RAISE EXCEPTION 'O clarificare nu se muta pe alta licitatie din aplicatie (punctele ei si-ar schimba poarta).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.fn_ofertare_clar_are_puncte(OLD.id) THEN RETURN OLD; END IF;
  IF NOT coalesce(public.fn_ofertare_clar_puncte_poarta(OLD.id), false) THEN
    RAISE EXCEPTION 'Clarificarea are puncte: o sterge doar ownerul sau un responsabil al licitatiei (stergerea ar sterge si punctele).' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_ofertare_clar_parinte_puncte_garda() IS
  '20270115a: garda parintelui (BEFORE UPDATE OF licitatie_id OR DELETE pe ofertare_clarificari): pentru apelurile clientului, o clarificare cu puncte nu se muta pe alta licitatie si se sterge doar de cine trece poarta punctelor (cascada ar sterge punctele). service_role / postgres / RPC-urile DEFINER trec.';
CREATE TRIGGER trg_ofertare_clar_parinte_puncte BEFORE UPDATE OF licitatie_id OR DELETE ON public.ofertare_clarificari
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_clar_parinte_puncte_garda();

ALTER POLICY clar_puncte_sel ON public.ofertare_clarificari_puncte USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id));
ALTER POLICY clar_puncte_rw ON public.ofertare_clarificari_puncte USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id)) WITH CHECK (public.fn_ofertare_clar_puncte_poarta(clarificare_id));

-- ─── 3. Postcondiții (exacte): cele 2 politici pe poarta noua, cele 3 functii (corp, forma, drepturi), triggerul (forma exacta), fotografia identica ─
DO $post$
DECLARE v_rau text; v_attnum smallint;
BEGIN
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      -- >>> POLITICI PUNCTE 20270115a
      ('clar_puncte_sel', 'r|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|-'),
      ('clar_puncte_rw', '*|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|fn_ofertare_clar_puncte_poarta(clarificare_id)')
      -- <<< POLITICI PUNCTE 20270115a
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a: postconditie: politicile ofertare_clarificari_puncte: %', v_rau; END IF;
  -- cele 3 functii noi: corp EXACT (md5 fara CR), limbaj, DEFINER / INVOKER, volatilitate, cale sigura, proprietar postgres, drepturi EXACTE, unice
  -- >>> FUNCTII 20270115a
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_are_puncte(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '2245a58f811059df647d9d7032595637' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_are_puncte') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: fn_ofertare_clar_are_puncte(bigint) nu are forma asteptata (corp md5 2245a58f811059df647d9d7032595637, sql VOLATILE DEFINER, cale, proprietar, drepturi exacte, unica)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'abd6b68b5b34a67f777045541aeff04a' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_puncte_poarta') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: fn_ofertare_clar_puncte_poarta(bigint) nu are forma asteptata (corp md5 abd6b68b5b34a67f777045541aeff04a, sql STABLE DEFINER, cale, proprietar, drepturi exacte, unica)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'af05fe431f584442cea2351f4257427f' AND l.lanname = 'plpgsql' AND p.prokind = 'f'
                   AND NOT p.prosecdef AND p.provolatile = 'v' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'trigger'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'postgres:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_parinte_puncte_garda') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: fn_ofertare_clar_parinte_puncte_garda() nu are forma asteptata (corp md5 af05fe431f584442cea2351f4257427f, plpgsql VOLATILE INVOKER, cale, proprietar, doar proprietarul executa, unica)';
  END IF;
  -- <<< FUNCTII 20270115a
  -- triggerul: BEFORE (2) + ROW (1) + DELETE (8) + UPDATE (16) = 27, pe coloana licitatie_id, functia garda, fara conditie WHEN, fara argumente, activ (O)
  SELECT a.attnum INTO v_attnum FROM pg_attribute a WHERE a.attrelid = 'public.ofertare_clarificari'::regclass AND a.attname = 'licitatie_id' AND NOT a.attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte'
                   AND t.tgfoid = to_regprocedure('public.fn_ofertare_clar_parinte_puncte_garda()') AND t.tgtype = 27 AND t.tgattr = v_attnum::text::int2vector
                   AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgenabled = 'O' AND NOT t.tgisinternal)
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.ofertare_clarificari'::regclass AND t.tgname = 'trg_ofertare_clar_parinte_puncte') <> 1 THEN
    RAISE EXCEPTION '20270115a: postconditie: triggerul trg_ofertare_clar_parinte_puncte nu are forma asteptata (BEFORE UPDATE OF licitatie_id OR DELETE, FOR EACH ROW, garda, fara WHEN / argumente, activ)';
  END IF;
  -- fotografia: nimic altceva schimbat (drepturile ambelor tabele, triggerele punctelor, triggerele parintelui fara cel nou, politicile parintelui,
  -- cele 3 functii existente, RLS, numarul politicilor)
  SELECT string_agg(f.ce || ' (era ' || f.val || ', acum ' || coalesce(n.val, 'LIPSA') || ')', '; ' ORDER BY f.ce) INTO v_rau
    FROM cp_foto f
    LEFT JOIN (
      SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                       || '/' || pg_get_userbyid(e.grantor) AS d
                  FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass) a), '(nimic)') AS val
      UNION ALL
      SELECT 'acl_parinte', coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                       || '/' || pg_get_userbyid(e.grantor) AS d
                  FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari'::regclass) a), '(nimic)')
      UNION ALL
      SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                     FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
      UNION ALL
      SELECT 'triggere_parinte', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                             FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tg.tgisinternal AND tg.tgname <> 'trg_ofertare_clar_parinte_puncte'), '(niciunul)')
      UNION ALL
      SELECT 'politici_parinte', coalesce((SELECT string_agg(p.polname::text || '=' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ', ' ORDER BY p.polname::text)
                                             FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass), '(niciuna)')
      UNION ALL
      SELECT 'functie_acces', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()'))
      UNION ALL
      SELECT 'functie_cheltuiala', (SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                      FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ofertare_poate_cheltui(bigint, uuid)'))
      UNION ALL
      SELECT 'functie_trigger', coalesce((SELECT md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '-') || '|' || p.prosecdef::text || '|' || array_to_string(p.proconfig, ';')
                                            FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_clar_punct_semneaza()')), '(lipsa)')
      UNION ALL
      SELECT 'rls', (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass)
        || '|' || (SELECT c.relrowsecurity::text || '|' || c.relforcerowsecurity::text FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari'::regclass)
      UNION ALL
      SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass)
        || '|' || (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari'::regclass)
    ) n ON n.ce = f.ce
   WHERE n.val IS DISTINCT FROM f.val;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270115a: postconditie: s-a schimbat altceva decat cele 2 politici + functiile + triggerul noi: %', v_rau; END IF;
  IF (SELECT count(*) FROM cp_foto) <> 10 THEN RAISE EXCEPTION '20270115a: postconditie: fotografia incompleta'; END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270115a_ofertare_clarificari_puncte_citire:' || txid_current() THEN
    RAISE EXCEPTION '20270115a: garda final invalida';
  END IF;
  RAISE NOTICE '20270115a: sfarsit la % ms de la BEGIN, lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
