-- Version 20270114120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270114a_ofertare_clarificari_puncte_citire.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte”
--   al runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA). Manifestul .l15.tsv îl generează coordonatorul pe
--   clonă (scripts/livrare_l15_manifest.sh --iesire, docs/LIVRARE_L15_V2.md §5); lista OBIECTELOR revizuită (generată pe PGlite cu pașii reali
--   ai runnerului): supabase/tests/20270114a_ofertare_clarificari_puncte_citire.l15.obiecte.tsv. Dry-run pe clonă după aplicare (ROLLBACK):
--   supabase/tests/20270114a_ofertare_clarificari_puncte_citire_dryrun.sql.
-- 20270114a_ofertare_clarificari_puncte_citire — Ofertare: punctele unei clarificări (public.ofertare_clarificari_puncte) se citesc și se scriu
--   DOAR de ownerul și de responsabilii licitației clarificării (decizia owner-ului, 27.11.2026, după review-ul PR #1204). Azi: clar_puncte_sel
--   (SELECT) = USING (auth.uid() IS NOT NULL) — ORICE cont logat citește punctele; clar_puncte_rw (ALL, deci și SELECT, politicile permisive se
--   combină cu OR) = fn_are_acces_ofertare() — oricine cu modulul Ofertare le scrie și le citește.
-- Ce face (o funcție nouă + două politici schimbate, nimic altceva):
--   1. CREATE FUNCTION public.fn_ofertare_clar_puncte_poarta(p_clarificare_id bigint) RETURNS boolean — sql STABLE SECURITY DEFINER, cale sigură:
--      utilizatorul CURENT (auth.uid(), L08: niciodată un parametru) are acces la modulul Ofertare (fn_are_acces_ofertare(), ca azi) ȘI trece
--      poarta pe cheltuială a licitației clarificării (fn_ofertare_poate_cheltui(c.licitatie_id, auth.uid()), 20261124a: owner; responsabil 1 / 2
--      numit de owner / admin Ofertare — aceeași poartă ca la orice procesare plătită din Ofertare). DEFINER fiindcă fn_ofertare_poate_cheltui
--      are EXECUTE doar pentru service_role și fiindcă licitația clarificării se citește indiferent de RLS-ul apelantului (întoarce DOAR un
--      boolean; clarificare inexistentă = false). EXECUTE: authenticated + service_role (politicile o cheamă ca authenticated; UI-ul o poate
--      întreba prin RPC); nimic pentru PUBLIC / anon.
--   2. ALTER POLICY clar_puncte_sel USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id));
--   3. ALTER POLICY clar_puncte_rw USING (…aceeași…) WITH CHECK (…aceeași…) — rw e ALL și include SELECT: fără pasul 3 restrângerea de la 2 n-ar
--      avea efect (OR între politici). Un singur predicat pentru citire și scriere (L19).
--   Ce poate face, după migrare, un cont cu acces Ofertare care NU e owner / responsabil al licitației: NU citește punctele, NU scrie puncte
--   (INSERT = 42501, UPDATE / DELETE ating 0 rânduri) — scrierea fără citire n-are sens în UI (OfertareClarificariPuncte.jsx încarcă lista,
--   apoi adaugă / editează), deci restrângerea e aceeași pe toate căile; decizie conservatoare (nimic nu devine mai larg ca azi: scrierea
--   cere ÎN CONTINUARE modulul Ofertare, plus poarta). Owner-ul vede și scrie tot (poarta e adevărată pentru orice licitație).
-- Ce NU face: nu creează / nu șterge tabele, politici sau drepturi pe tabel, nu atinge triggerul trg_clar_punct_semneaza, funcțiile existente
--   (fn_are_acces_ofertare, fn_ofertare_poate_cheltui, fn_clar_punct_semneaza), tabelul ofertare_clarificari sau politicile lui (20270113a),
--   nicio dată; nu dă acces la Ofertare nimănui. Temeiurile de pe puncte (ofertare_clarificari_temeiuri, politicile lor neatinse) rămân citibile
--   cu modulul; UI-ul le citește prin join cu punctele, deci pentru un cont fără poartă join-ul nu întoarce rânduri — exportul adresei refuză
--   explicit pentru acel cont (OfertareClarificari.jsx), nu tace.
-- Starea de pornire (L14, sub lock): politicile tabelului sunt EXACT cele 2 de azi (nume, comandă, PERMISSIVE, rolul authenticated, USING /
--   WITH CHECK deparsate — forma din brief-ul coordonatorului, 27.11.2026; altă formă = refuz, coordonatorul dă textul exact din pg_policies),
--   RLS activ și neforțat, FK-ul clarificare_id → ofertare_clarificari(id) există, ofertare_clarificari.licitatie_id există, funcția nouă NU există
--   (reaplicare = refuz, fără supraîncărcări), fn_are_acces_ofertare și fn_ofertare_poate_cheltui au corpul / DEFINER / calea / proprietarul /
--   drepturile din 20260912 respectiv 20261124a; altceva = refuz, nimic schimbat.
-- Lock-uri (L06): un singur tabel, ACCESS EXCLUSIVE NOWAIT pe public.ofertare_clarificari_puncte (ALTER POLICY cere acest lock), luat ÎNAINTEA
--   verificărilor de stare (L14), bugetul 1 s de la prima încercare (blocul $lock$); ocupat = 55P03, nimic schimbat. CREATE FUNCTION nu
--   blochează tabele. Nimic altceva blocat (ofertare_clarificari e doar citită de funcție, nu aici).
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), bugetul de lock 1 s, lock_timeout 100 ms
--   (lock-urile implicite), garda finală a runnerului (PLAFON_TIMP + LOCK_TINUT).
-- Ordinea livrării: migrarea ÎNTÂI (UI-ul vechi nu se rupe: primește doar rândurile permise), apoi merge-ul UI (nota pentru conturile fără
--   poartă). Independentă de 20270112a (NEAPLICATĂ) și compatibilă cu 20270113a (APLICATĂ 27.11.2026 — proba PGlite rulează cu 20270113a
--   aplicată și fără ea).
-- Revenire: supabase/revenire/20270114a_ofertare_clarificari_puncte_citire_ROLLBACK.sql (readuce cele 2 politici EXACT, apoi șterge funcția;
--   refuză dacă starea nu e cea pusă aici). Revenirea REDESCHIDE citirea punctelor pentru orice cont logat: doar la cererea explicită a owner-ului.
-- Probe: scripts/pglite/test_ofertare_clarificari_puncte_citire_local.mjs (scheletul 20270112a + supabase/tests/20270114a_…_schelet.sql, pașii
--   L15 v2 reali; cazuri de acces pe owner / responsabil 1 / responsabil 2 / autonumit / editor Ofertare / responsabil fără modul / sub-modul /
--   fără modul / anon, scrieri, refuzuri, revenire, mutanți).
DO $pre$
DECLARE v_plafon text; v_alt text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270114a_ofertare_clarificari_puncte_citire:' || txid_current() THEN
    RAISE EXCEPTION '20270114a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270114a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270114a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270114a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270114a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20270111a / 20270112a / 20270113a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270114a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ofertare_clarificari_puncte') IS NULL OR (SELECT relkind FROM pg_class WHERE oid = 'public.ofertare_clarificari_puncte'::regclass) <> 'r' THEN
    RAISE EXCEPTION '20270114a: lipseste tabelul public.ofertare_clarificari_puncte';
  END IF;
  IF to_regclass('public.ofertare_clarificari') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.ofertare_clarificari'::regclass AND a.attname = 'licitatie_id' AND NOT a.attisdropped AND a.atttypid = 'bigint'::regtype) THEN
    RAISE EXCEPTION '20270114a: lipseste public.ofertare_clarificari.licitatie_id (bigint) — functia noua o citeste';
  END IF;
  -- FK-ul clarificare_id → ofertare_clarificari(id): legatura pe care se da poarta
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = 'public.ofertare_clarificari_puncte'::regclass AND k.contype = 'f' AND k.confrelid = 'public.ofertare_clarificari'::regclass
                    AND k.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attname = 'clarificare_id' AND NOT a.attisdropped)]
                    AND k.confkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = k.confrelid AND a.attname = 'id' AND NOT a.attisdropped)]) THEN
    RAISE EXCEPTION '20270114a: lipseste FK-ul ofertare_clarificari_puncte.clarificare_id -> ofertare_clarificari(id)';
  END IF;
  -- reaplicare / coliziune de nume: functia noua nu exista inca (nicio supraincarcare)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_puncte_poarta') THEN
    RAISE EXCEPTION '20270114a: functia public.fn_ofertare_clar_puncte_poarta exista deja (reaplicare sau coliziune de nume)';
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
    RAISE EXCEPTION '20270114a: fn_are_acces_ofertare() nu e cea din 20260912 (corp md5 429d28e2a61fb24c8009d67050c16c85, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';
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
    RAISE EXCEPTION '20270114a: fn_ofertare_poate_cheltui(bigint, uuid) nu e cea din 20261124a (corp md5 07fba9e2e4249481fa9184fc48abc58d, sql STABLE DEFINER, cale, proprietar, drepturi exacte sau supraincarcari); coordonatorul da textul exact (pg_get_functiondef)';
  END IF;
  -- informativ (nu refuz, in afara perimetrului): vederi peste tabelul de puncte FARA security_invoker ar citi ca proprietarul lor, ocolind politicile
  SELECT string_agg(DISTINCT v.oid::regclass::text, ', ' ORDER BY v.oid::regclass::text) INTO v_alt
    FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
   WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.ofertare_clarificari_puncte'::regclass
     AND v.oid <> 'public.ofertare_clarificari_puncte'::regclass
     AND NOT ('security_invoker=on' = ANY (coalesce(v.reloptions, ARRAY[]::text[])));
  IF v_alt IS NOT NULL THEN
    RAISE NOTICE '20270114a: ATENTIE, vederi peste ofertare_clarificari_puncte fara security_invoker (citesc ca proprietarul, in afara acestei migrari): %', v_alt;
  END IF;
END $pre$;

-- ─── 0. Lock-ul, ÎNAINTEA verificărilor de stare (L14): punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare (șablonul 20270111a);
--     momentul în gazpet.lock_puternic_la pentru LOCK_TINUT. Ocupat peste buget = 55P03, nimic schimbat. ────────────────────────────
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270114a: BUGET_LOCK: ofertare_clarificari_puncte ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
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
    RAISE EXCEPTION '20270114a: BUGET_LOCK: lock-ul pe ofertare_clarificari_puncte obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270114a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Starea EXACTĂ de azi (sub lock): cele 2 politici (forma din 20260928l / brief 27.11.2026), RLS activ neforțat; fotografia a tot ce NU
--     se schimbă (drepturile tabelului, triggerele, cele 3 funcții existente, RLS, numărul politicilor) pentru postcondiție ────────────────
DO $stare$
DECLARE v_rau text; v_n bigint;
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
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270114a: politicile ofertare_clarificari_puncte difera de cele de azi (27.11.2026): %', v_rau; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '20270114a: RLS pe ofertare_clarificari_puncte nu e activ (sau e fortat)';
  END IF;
  CREATE TEMP TABLE cp_foto ON COMMIT DROP AS
    SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
              SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                     || '/' || pg_get_userbyid(e.grantor) AS d
                FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass) a), '(nimic)') AS val
    UNION ALL
    SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                   FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
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
    UNION ALL
    SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass);
  SELECT count(*) INTO v_n FROM public.ofertare_clarificari_puncte;
  RAISE NOTICE '20270114a: stare verificata (2 politici, RLS activ); puncte existente (neatinse): %', v_n;
END $stare$;

-- ─── 2. Schimbarea: poarta punctelor (o functie DEFINER, un predicat) + cele 2 politici pe ea ──────────────────────────────────────────
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
  '20270114a: poarta punctelor unei clarificari (RLS pe ofertare_clarificari_puncte, citire si scriere) — utilizatorul curent are acces la modulul Ofertare SI e owner / responsabil 1-2 al licitatiei clarificarii (fn_ofertare_poate_cheltui, 20261124a). Clarificare inexistenta = false.';
ALTER POLICY clar_puncte_sel ON public.ofertare_clarificari_puncte USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id));
ALTER POLICY clar_puncte_rw ON public.ofertare_clarificari_puncte USING (public.fn_ofertare_clar_puncte_poarta(clarificare_id)) WITH CHECK (public.fn_ofertare_clar_puncte_poarta(clarificare_id));

-- ─── 3. Postcondiții (exacte): cele 2 politici pe poarta noua, functia noua (corp, forma, drepturi), tot ce era în fotografie identic ───
DO $post$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(coalesce(a.nume, '+' || c.nume) || coalesce(': ' || c.detaliu, ''), '; ' ORDER BY coalesce(a.nume, c.nume)) INTO v_rau
    FROM (VALUES
      -- >>> POLITICI PUNCTE 20270114a
      ('clar_puncte_sel', 'r|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|-'),
      ('clar_puncte_rw', '*|permisiva|{authenticated}|fn_ofertare_clar_puncte_poarta(clarificare_id)|fn_ofertare_clar_puncte_poarta(clarificare_id)')
      -- <<< POLITICI PUNCTE 20270114a
    ) a(nume, detaliu)
    FULL JOIN (SELECT p.polname::text AS nume,
                      p.polcmd::text || '|' || CASE WHEN p.polpermissive THEN 'permisiva' ELSE 'restrictiva' END || '|'
                        || coalesce((SELECT '{' || string_agg(CASE WHEN ro = 0 THEN 'PUBLIC' ELSE ro::regrole::text END, ',' ORDER BY ro::regrole::text) || '}' FROM unnest(p.polroles) ro), '{}')
                        || '|' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') AS detaliu
                 FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass) c ON c.nume = a.nume
   WHERE a.nume IS NULL OR c.nume IS NULL OR a.detaliu IS DISTINCT FROM c.detaliu;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270114a: postconditie: politicile ofertare_clarificari_puncte: %', v_rau; END IF;
  -- functia noua: corp EXACT (md5 fara CR), sql STABLE DEFINER, cale sigura, proprietar postgres, drepturi EXACTE (authenticated + service_role +
  -- proprietar; nimic pentru PUBLIC / anon), unica (fara supraincarcari)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ofertare_clar_puncte_poarta(bigint)')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'abd6b68b5b34a67f777045541aeff04a' AND l.lanname = 'sql' AND p.prokind = 'f'
                   AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset AND pg_get_function_result(p.oid) = 'boolean'
                   AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                   AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                          SELECT pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                            FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ofertare_clar_puncte_poarta') <> 1 THEN
    RAISE EXCEPTION '20270114a: postconditie: fn_ofertare_clar_puncte_poarta(bigint) nu are forma asteptata (corp md5 abd6b68b5b34a67f777045541aeff04a, sql STABLE DEFINER, cale, proprietar, drepturi exacte, unica)';
  END IF;
  -- fotografia: nimic altceva schimbat (drepturile tabelului, triggerele, cele 3 functii existente, RLS, numarul politicilor)
  SELECT string_agg(f.ce || ' (era ' || f.val || ', acum ' || coalesce(n.val, 'LIPSA') || ')', '; ' ORDER BY f.ce) INTO v_rau
    FROM cp_foto f
    LEFT JOIN (
      SELECT 'acl_tabel' AS ce, coalesce((SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END
                       || '/' || pg_get_userbyid(e.grantor) AS d
                  FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.ofertare_clarificari_puncte'::regclass) a), '(nimic)') AS val
      UNION ALL
      SELECT 'triggere', coalesce((SELECT string_agg(tg.tgname::text || '=' || md5(pg_get_triggerdef(tg.oid)) || ':' || tg.tgenabled::text, ', ' ORDER BY tg.tgname::text)
                                     FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari_puncte'::regclass AND NOT tg.tgisinternal), '(niciunul)')
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
      UNION ALL
      SELECT 'politici_nr', (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = 'public.ofertare_clarificari_puncte'::regclass)
    ) n ON n.ce = f.ce
   WHERE n.val IS DISTINCT FROM f.val;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270114a: postconditie: s-a schimbat altceva decat cele 2 politici + functia noua: %', v_rau; END IF;
  IF (SELECT count(*) FROM cp_foto) <> 7 THEN RAISE EXCEPTION '20270114a: postconditie: fotografia incompleta'; END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270114a_ofertare_clarificari_puncte_citire:' || txid_current() THEN
    RAISE EXCEPTION '20270114a: garda final invalida';
  END IF;
  RAISE NOTICE '20270114a: sfarsit la % ms de la BEGIN, lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
