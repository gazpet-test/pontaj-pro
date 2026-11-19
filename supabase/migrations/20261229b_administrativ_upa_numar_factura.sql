-- Version 20261229120100. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261229b_administrativ_upa_numar_factura.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2, ca 20261229a).
--   Lista OBIECTELOR revizuită (familie, etichetă, operație; verificată pe PGlite cu pașii reali ai runnerului):
--   supabase/tests/20261229b_administrativ_upa_numar_factura.l15.obiecte.tsv.
-- 20261229b_administrativ_upa_numar_factura — Administrativ → Unități protejate: numărul facturii OBLIGATORIU pe rândurile NOI din upa_achizitii
--   (decizia owner-ului 19.11.2026, varianta B din raportul rundei 2). Pe toate căile de scriere (formularul, Citește Orice, API-ul direct).
-- Ce face:
--   * fn_upa_numar_factura_ok(text): predicatul UNIC (L19): numărul există ȘI are cel puțin un caracter care nu e spațiu (NULL = fals, nu
--     „necunoscut”: funcția NU e STRICT, verificat în postcondiții).
--   * CHECK upa_achizitii_numar_factura_nevid (fn_upa_numar_factura_ok(numar_factura)) NOT VALID: se aplică ORICĂRUI INSERT și ORICĂRUI UPDATE
--     de acum înainte — inclusiv unui UPDATE pe ALT câmp al unui rând vechi fără număr (rândul se completează întâi; ștergerea lui rămâne
--     posibilă). Rândurile vechi fără număr rămân (NOT VALID nu le verifică); VALIDATE CONSTRAINT doar într-o migrare separată, după ce nu mai
--     există niciunul (numărul lor îl tipărește preflight-ul: NOTICE 20261229b: randuri vechi fara numar = N).
--   * trigger trg_upa_achizitii_numar_factura BEFORE INSERT OR UPDATE OF numar_factura: același predicat, mesaj clar, 23514 cu numele
--     constrângerii (ecranul și Citește Orice îl traduc: „Completează numărul facturii”). Un UPDATE care nu atinge numar_factura nu trece prin
--     trigger: acolo refuzul vine de la CHECK (tot 23514, cu numele constrângerii) — ambele căi au același mesaj în ecran.
-- Ce NU face: nu modifică niciun rând, nu atinge politicile / drepturile / RLS-ul lui upa_achizitii, nu depinde de 20261229a (doar versiunea e
--   după ea; aceeași coloană existentă numar_factura).
-- ORDINEA LIVRĂRII: DUPĂ merge-ul ecranului (formularul manual cere deja numărul; Citește Orice are câmpul „Nr. factură” cu confirmarea oprită
--   cât e gol) — altfel ecranul vechi din Citește Orice ar primi refuzul fără explicație pentru o factură citită fără număr.
-- Ordinea lock-urilor (L06): migrarea ia doar upa_achizitii; triggerul nu blochează nimic în afara rândului scris.
-- Lock la aplicare (punct unic, NOWAIT, bugetul 1 s de la prima încercare, docs/LIVRARE_L15_V2.md §9): upa_achizitii ACCESS EXCLUSIVE
--   (ADD CONSTRAINT ... NOT VALID fără scanare + CREATE TRIGGER). Citirile din preflight / postcondiții: doar catalogul și upa_achizitii.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, garda finală.
-- Revenire: supabase/revenire/20261229b_administrativ_upa_numar_factura_ROLLBACK.sql. Probe: scripts/pglite/test_upa_alerta_local.mjs.
DO $pre$
DECLARE v_plafon text; v_tip text; v_n bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229b_administrativ_upa_numar_factura:' || txid_current() THEN
    RAISE EXCEPTION '20261229b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261229b: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261229b: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261229b: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261229b: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261229a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261229b: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.upa_achizitii') IS NULL THEN RAISE EXCEPTION '20261229b: upa_achizitii lipseste'; END IF;
  -- reaplicare = refuz
  IF to_regprocedure('public.fn_upa_numar_factura_ok(text)') IS NOT NULL OR to_regprocedure('public.fn_upa_numar_factura_obligatoriu()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_numar_factura_ok', 'fn_upa_numar_factura_obligatoriu'))
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace AND k.conname = 'upa_achizitii_numar_factura_nevid')
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.upa_achizitii'::regclass AND t.tgname = 'trg_upa_achizitii_numar_factura') THEN
    RAISE EXCEPTION '20261229b: obiectele exista deja (reaplicare)';
  END IF;
  SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'upa_achizitii' AND column_name = 'numar_factura';
  IF v_tip IS NULL OR v_tip NOT IN ('text', 'character varying') THEN
    RAISE EXCEPTION '20261229b: coloana upa_achizitii.numar_factura lipseste sau are alt tip (%)', coalesce(v_tip, 'lipsa');
  END IF;
END $pre$;

-- ── lock-ul pe upa_achizitii (punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare; momentul în gazpet.lock_puternic_la pentru LOCK_TINUT) ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261229b: BUGET_LOCK: upa_achizitii ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.upa_achizitii IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261229b: BUGET_LOCK: lock-ul pe upa_achizitii obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261229b: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
  -- informativ (după lock: numărătoare stabilă): rândurile vechi fără număr rămân (NOT VALID); chat-ul compară cifra cu BD-ul live
  RAISE NOTICE '20261229b: randuri vechi fara numar = %', (SELECT count(*) FROM public.upa_achizitii a
                                                           WHERE a.numar_factura IS NULL OR a.numar_factura !~ '[^[:space:]]');
END $lock$;

-- ─── 1. Predicatul unic (L19) ────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_upa_numar_factura_ok(p_numar text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT p_numar IS NOT NULL AND p_numar ~ '[^[:space:]]'
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_numar_factura_ok(text) FROM PUBLIC, anon, authenticated, service_role;
-- funcție pură: EXECUTE pentru rolurile care scriu în upa_achizitii (CHECK-ul și triggerul o cheamă ca apelantul)
GRANT EXECUTE ON FUNCTION public.fn_upa_numar_factura_ok(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_upa_numar_factura_ok(text) IS 'UPA (20261229b): numarul facturii exista si are cel putin un caracter care nu e spatiu (NULL = fals). Predicatul unic: CHECK + trigger.';

-- ─── 2. CHECK pe rândurile noi / modificate (NOT VALID: rândurile vechi nu se verifică) ──────────────────────────────────
ALTER TABLE public.upa_achizitii ADD CONSTRAINT upa_achizitii_numar_factura_nevid CHECK (public.fn_upa_numar_factura_ok(numar_factura)) NOT VALID;
COMMENT ON CONSTRAINT upa_achizitii_numar_factura_nevid ON public.upa_achizitii IS 'UPA (20261229b): numarul facturii obligatoriu pe orice INSERT / UPDATE de acum inainte (NOT VALID: randurile vechi raman).';

-- ─── 3. Trigger cu mesaj clar (INSERT + schimbarea numărului) ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_upa_numar_factura_obligatoriu() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF NOT public.fn_upa_numar_factura_ok(NEW.numar_factura) THEN
    RAISE EXCEPTION 'upa: numarul facturii e obligatoriu (numar_factura)' USING ERRCODE = '23514',
      CONSTRAINT = 'upa_achizitii_numar_factura_nevid', HINT = 'Completeaza numarul facturii.';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_numar_factura_obligatoriu() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_upa_achizitii_numar_factura BEFORE INSERT OR UPDATE OF numar_factura ON public.upa_achizitii
  FOR EACH ROW EXECUTE FUNCTION public.fn_upa_numar_factura_obligatoriu();

-- ─── 4. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE r record; v_amp text;
BEGIN
  -- funcțiile: limbaj, fără DEFINER, volatilitate, NU STRICT (NULL trebuie să fie fals), search_path, proprietar, drepturile EXACTE
  FOR r IN SELECT * FROM (VALUES ('public.fn_upa_numar_factura_ok(text)', 'sql', 'i', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
                                 ('public.fn_upa_numar_factura_obligatoriu()', 'plpgsql', 'v', 'postgres:EXECUTE')) v(fn, limbaj, volatil, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND NOT p.prosecdef AND p.provolatile = r.volatil AND NOT p.proisstrict
                      AND p.prokind = 'f' AND NOT p.proleakproof AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                      AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                               FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = r.acl) THEN
      RAISE EXCEPTION '20261229b post: functia % (limbaj / definer / volatil / strict / search_path / owner / drepturi exacte)', r.fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_numar_factura_ok', 'fn_upa_numar_factura_obligatoriu')) <> 2 THEN
    RAISE EXCEPTION '20261229b post: supraincarcari ale functiilor noi';
  END IF;
  -- predicatul: NULL / gol / doar spații = fals, un caracter = adevărat (cazurile scrise de mână)
  IF public.fn_upa_numar_factura_ok(NULL) IS DISTINCT FROM false OR public.fn_upa_numar_factura_ok('') IS DISTINCT FROM false
     OR public.fn_upa_numar_factura_ok(' ' || chr(9) || chr(10) || ' ') IS DISTINCT FROM false OR public.fn_upa_numar_factura_ok('F 1') IS DISTINCT FROM true
     OR public.fn_upa_numar_factura_ok('0') IS DISTINCT FROM true THEN
    RAISE EXCEPTION '20261229b post: predicatul numarului facturii';
  END IF;
  -- CHECK-ul exact, NEVALIDAT (rândurile vechi rămân); triggerul exact (BEFORE INSERT OR UPDATE OF numar_factura, pe rând, activ, fără WHEN)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.upa_achizitii'::regclass AND k.conname = 'upa_achizitii_numar_factura_nevid'
                   AND k.contype = 'c' AND NOT k.convalidated AND pg_get_constraintdef(k.oid) = 'CHECK (fn_upa_numar_factura_ok(numar_factura)) NOT VALID')
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.upa_achizitii'::regclass AND t.tgname = 'trg_upa_achizitii_numar_factura'
           AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgfoid = 'public.fn_upa_numar_factura_obligatoriu()'::regprocedure AND t.tgtype = 23
           AND t.tgqual IS NULL AND t.tgnargs = 0
           -- (int2vector are indicele de început 0: se compară textul, „<attnum>” = exact o coloană)
           AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid = 'public.upa_achizitii'::regclass AND a.attname = 'numar_factura')) <> 1 THEN
    RAISE EXCEPTION '20261229b post: CHECK-ul / triggerul numarului facturii';
  END IF;
  -- AMPRENTA_20261229b_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'con ' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' ' || pg_get_constraintdef(k.oid) AS l
      FROM pg_constraint k WHERE k.conrelid = 'public.upa_achizitii'::regclass AND k.conname = 'upa_achizitii_numar_factura_nevid'
    UNION ALL
    SELECT 'trg ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t WHERE t.tgrelid = 'public.upa_achizitii'::regclass AND NOT t.tgisinternal AND t.tgname = 'trg_upa_achizitii_numar_factura'
    UNION ALL
    -- orice obiect care depinde de funcțiile noi (în afara CHECK-ului și a triggerului de mai sus = altă politică / vedere / trigger: abatere)
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> ' || p.proname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
     WHERE d.refclassid = 'pg_proc'::regclass AND p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_numar_factura_ok', 'fn_upa_numar_factura_obligatoriu')
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_numar_factura_ok', 'fn_upa_numar_factura_obligatoriu')
  ) x;
  -- AMPRENTA_20261229b_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '96b7109570727ea2d0377aa1b02a6418' THEN
    RAISE NOTICE 'AMPRENTA_20261229b_TEXT %', v_amp;
    RAISE EXCEPTION '20261229b post: AMPRENTA obiectelor % (asteptat 96b7109570727ea2d0377aa1b02a6418)', md5(coalesce(v_amp, ''));
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229b_administrativ_upa_numar_factura:' || txid_current() THEN
    RAISE EXCEPTION '20261229b: garda final invalida';
  END IF;
  RAISE NOTICE '20261229b: sfarsit la % ms de la BEGIN; lock-ul pe upa_achizitii tinut de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
