-- Version 20270109120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270109a_izo_ocr_local_rezerva_sonnet.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA). Manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh --iesire, docs/LIVRARE_L15_V2.md §5); lista OBIECTELOR revizuită (generată pe PGlite cu pașii reali ai
--   runnerului): supabase/tests/20270109a_izo_ocr_local_rezerva_sonnet.l15.obiecte.tsv — 2 obiecte, `constrangere` (CHECK-ul rezerva_usd,
--   schimbat) și `coloana` (public.ocr_local_config.rezerva_usd: valoarea implicită, schimbată). Nicio funcție, drept, politică sau tabel nou.
--   Dry-run pe clonă după aplicare (ROLLBACK): supabase/tests/20270109a_izo_ocr_local_rezerva_sonnet_dryrun.sql.
-- 20270109a_izo_ocr_local_rezerva_sonnet — Izometrie E3 / OCR local (E9): rezerva apelului plătit 0,05 → 0,20 USD.
--   Decizia Răzvan 24.11.2026: avizele se citesc întâi local; dacă citirea locală nu reușește → Sonnet 5.5 (fallback + arbitrajul celulelor,
--   edge-ul izo-e3-ocr-local); Haiku nu mai citește avize (pe Lot 2 a citit greșit seria la 2 din 11 avize).
-- De ce 0,20: costul MAXIM al unui apel Sonnet 5.5, cu plafoanele impuse de edge ÎNAINTE de apel = 46.000 tokeni de intrare (count_tokens,
--   refuz peste) × 2 USD/1M + 10.400 tokeni de ieșire (max_tokens) × 10 USD/1M = 0,092 + 0,104 = 0,196 USD (costMaximApelE3(10400)).
--   Minimul justificat e 0,196; 0,20 = aceeași rezervă ca citirea directă Sonnet din ocr-packing-list (rezervaE3(Sonnet)) și suma anunțată în
--   UI („rezervă maximă 0,20 USD”). Arbitrajul (≤ 4.000 tokeni de ieșire) = 0,132, încape. Plafonul lunar pe proiect (10 USD) neschimbat.
-- Ce face: CHECK (rezerva_usd = 0.05) → CHECK (rezerva_usd = 0.20) cu ACELAȘI nume, DEFAULT 0.20, rândul unic de configurare 0.05 → 0.20.
-- Ce NU face: termenele, plafonul, RPC-urile cozii (fn_ocr_local_rezerva_apel citește config-ul la fiecare rezervare, corpul neatins — verificat
--   pe amprentă înainte și după), eticheta ramurii din ocr_local_cereri.ramura ('haiku' = ramura plătită, istoric; modelul stă în rezultat.model).
-- Ordinea livrării: (1) această migrare, (2) deploy izo-e3-ocr-local (Sonnet). Ordinea inversă e și ea sigură: edge-ul nou citește suma
--   rezervată și refuză FĂRĂ apel (rezerva_insuficienta, cost 0) cât BD are 0,05. Edge-ul vechi (Haiku, cost maxim 0,05) cu BD nouă rezervă 0,20:
--   supra-rezervare temporară, decontată la costul real.
-- Rezervările deja deschise își păstrează suma (ai_plafon_rezervari.suma_rezervata); doar rezervările de după COMMIT folosesc 0,20.
-- Lock-uri (L06): un singur tabel, ACCESS EXCLUSIVE NOWAIT pe public.ocr_local_config, luat ÎNAINTEA verificărilor de stare (L14), cu bugetul
--   de 1 s de la prima încercare (blocul $lock$): un RPC al cozii în curs (citește config-ul, ACCESS SHARE) = reîncercare la 50 ms, apoi
--   BUGET_LOCK, nimic schimbat; se reia. Niciun alt tabel blocat.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), bugetul de lock 1 s, lock_timeout = 100 ms
--   (lock-urile implicite), garda finală a runnerului (PLAFON_TIMP + LOCK_TINUT).
-- Revenire: supabase/revenire/20270109a_izo_ocr_local_rezerva_sonnet_ROLLBACK.sql (ÎNTÂI edge-ul înapoi, apoi revenirea).
-- Probe: scripts/pglite/test_izo_ocr_local_rezerva_sonnet_local.mjs (aplicare pe 20261105a + 20261108a/b reale, rezervarea de 0,20,
--   revenire, reaplicare, refuzuri, mutanți).
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270109a_izo_ocr_local_rezerva_sonnet:' || txid_current() THEN
    RAISE EXCEPTION '20270109a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270109a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270109a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270109a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270109a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261225a / 20261226b)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270109a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ocr_local_config') IS NULL THEN RAISE EXCEPTION '20270109a: lipseste public.ocr_local_config (20261108a)'; END IF;
END $pre$;

-- ─── 0. Lock-ul, ÎNAINTEA verificărilor de stare (L14): punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare (docs/LIVRARE_L15_V2.md,
--     „Bugetul de lock”, șablonul r16); momentul în gazpet.lock_puternic_la pentru LOCK_TINUT. Ocupat peste buget = 55P03, nimic schimbat.
--     Lock-urile IMPLICITE de după set: doar ROW EXCLUSIVE pe ocr_local_config (deja ținut mai tare) și citiri (ACCESS SHARE) pe
--     ocr_local_cereri (NOTICE-ul din postcondiții) — limitate de lock_timeout 100 ms. ───────────────────────────────────────────────
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270109a: BUGET_LOCK: ocr_local_config ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.ocr_local_config IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270109a: BUGET_LOCK: lock-ul pe ocr_local_config obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270109a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Starea EXACTĂ din 20261108a (sub lock): rândul unic, CHECK-urile, valoarea implicită, RPC-ul care citește rezerva ─────────────────
DO $stare$
DECLARE v_rau text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ocr_local_config WHERE id AND rezerva_usd = 0.20) THEN
    RAISE EXCEPTION '20270109a: rezerva e deja 0.20 (reaplicare)';
  END IF;
  IF (SELECT count(*) FROM public.ocr_local_config) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.ocr_local_config WHERE id AND rezerva_usd = 0.05 AND plafon_usd = 10) THEN
    RAISE EXCEPTION '20270109a: ocr_local_config nu are exact randul din 20261108a (rezerva 0.05, plafon 10)';
  END IF;
  -- toate CHECK-urile tabelului, cu numele și definiția (lista completă; altceva = refuz)
  SELECT string_agg(coalesce(a.conname, '+' || c.conname), ', ' ORDER BY coalesce(a.conname, c.conname)) INTO v_rau
    FROM (VALUES
      -- >>> CHECK-URI 20261108a
      ('ocr_local_config_apel_s_check', 'CHECK ((apel_s = 120))'),
      ('ocr_local_config_arbitraj_marja_s_check', 'CHECK ((arbitraj_marja_s = 40))'),
      ('ocr_local_config_id_check', 'CHECK (id)'),
      ('ocr_local_config_local_s_check', 'CHECK ((local_s = 90))'),
      ('ocr_local_config_plafon_usd_check', 'CHECK ((plafon_usd = (10)::numeric))'),
      ('ocr_local_config_preluare_s_check', 'CHECK ((preluare_s = 20))'),
      ('ocr_local_config_retentie_check', 'CHECK ((retentie = ''7 days''::interval))'),
      ('ocr_local_config_rezerva_usd_check', 'CHECK ((rezerva_usd = 0.05))'),
      ('ocr_local_config_semn_s_check', 'CHECK ((semn_s = 45))'),
      ('ocr_local_config_upload_s_check', 'CHECK ((upload_s = 60))')
      -- <<< CHECK-URI 20261108a
    ) a(conname, def)
    FULL JOIN (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                WHERE conrelid = 'public.ocr_local_config'::regclass AND contype = 'c') c ON c.conname = a.conname
   WHERE a.conname IS NULL OR c.conname IS NULL OR a.def IS DISTINCT FROM c.def;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270109a: CHECK-urile ocr_local_config difera de 20261108a: %', v_rau; END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute t ON t.attrelid = d.adrelid AND t.attnum = d.adnum
       WHERE d.adrelid = 'public.ocr_local_config'::regclass AND t.attname = 'rezerva_usd') IS DISTINCT FROM '0.05' THEN
    RAISE EXCEPTION '20270109a: valoarea implicita a rezerva_usd nu e 0.05';
  END IF;
  -- dependența: RPC-ul care citește rezerva din config (corp fără CR, proprietar, DEFINER, search_path, ACL doar service_role) — neatins
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ocr_local_rezerva_apel(uuid)')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'e24930150252c190a33a9c0b58665525'
                   AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION '20270109a: fn_ocr_local_rezerva_apel nu e cea din 20261108a (corp, proprietati sau drepturi)';
  END IF;
END $stare$;

-- ─── 2. Schimbarea: CHECK-ul cu același nume, rândul, valoarea implicită ─────────────────────────────────────────────────────────────────
ALTER TABLE public.ocr_local_config DROP CONSTRAINT ocr_local_config_rezerva_usd_check;
UPDATE public.ocr_local_config SET rezerva_usd = 0.20 WHERE id AND rezerva_usd = 0.05;
ALTER TABLE public.ocr_local_config
  ADD CONSTRAINT ocr_local_config_rezerva_usd_check CHECK (rezerva_usd = 0.20),
  ALTER COLUMN rezerva_usd SET DEFAULT 0.20;

-- ─── 3. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_rau text; v_n integer;
BEGIN
  IF (SELECT count(*) FROM public.ocr_local_config) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.ocr_local_config WHERE id AND rezerva_usd = 0.20 AND plafon_usd = 10) THEN
    RAISE EXCEPTION '20270109a: postconditie: randul de configurare (rezerva 0.20, plafon 10)';
  END IF;
  SELECT string_agg(coalesce(a.conname, '+' || c.conname), ', ' ORDER BY coalesce(a.conname, c.conname)) INTO v_rau
    FROM (VALUES
      -- >>> CHECK-URI 20270109a
      ('ocr_local_config_apel_s_check', 'CHECK ((apel_s = 120))'),
      ('ocr_local_config_arbitraj_marja_s_check', 'CHECK ((arbitraj_marja_s = 40))'),
      ('ocr_local_config_id_check', 'CHECK (id)'),
      ('ocr_local_config_local_s_check', 'CHECK ((local_s = 90))'),
      ('ocr_local_config_plafon_usd_check', 'CHECK ((plafon_usd = (10)::numeric))'),
      ('ocr_local_config_preluare_s_check', 'CHECK ((preluare_s = 20))'),
      ('ocr_local_config_retentie_check', 'CHECK ((retentie = ''7 days''::interval))'),
      ('ocr_local_config_rezerva_usd_check', 'CHECK ((rezerva_usd = 0.20))'),
      ('ocr_local_config_semn_s_check', 'CHECK ((semn_s = 45))'),
      ('ocr_local_config_upload_s_check', 'CHECK ((upload_s = 60))')
      -- <<< CHECK-URI 20270109a
    ) a(conname, def)
    FULL JOIN (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                WHERE conrelid = 'public.ocr_local_config'::regclass AND contype = 'c' AND convalidated) c ON c.conname = a.conname
   WHERE a.conname IS NULL OR c.conname IS NULL OR a.def IS DISTINCT FROM c.def;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270109a: postconditie: CHECK-urile ocr_local_config: %', v_rau; END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute t ON t.attrelid = d.adrelid AND t.attnum = d.adnum
       WHERE d.adrelid = 'public.ocr_local_config'::regclass AND t.attname = 'rezerva_usd') IS DISTINCT FROM '0.20' THEN
    RAISE EXCEPTION '20270109a: postconditie: valoarea implicita a rezerva_usd';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ocr_local_rezerva_apel(uuid)')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'e24930150252c190a33a9c0b58665525'
                   AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION '20270109a: postconditie: fn_ocr_local_rezerva_apel schimbata';
  END IF;
  -- costul maxim Sonnet (0,196) încape în rezerva nouă; arbitrajul (0,132) la fel
  IF NOT ((SELECT rezerva_usd FROM public.ocr_local_config WHERE id) >= 46000 * 2 / 1e6 + 10400 * 10 / 1e6) THEN
    RAISE EXCEPTION '20270109a: postconditie: rezerva sub costul maxim Sonnet';
  END IF;
  -- rezervările E3 încă deschise (luate înainte, cu suma veche): doar numărate
  SELECT count(*) INTO v_n FROM public.ocr_local_cereri WHERE apel_faza IN ('acordat', 'rezervat', 'trimis', 'raspuns');
  RAISE NOTICE '20270109a: apeluri platite E3 in curs (pastreaza suma rezervata inainte): %', v_n;
  RAISE NOTICE '20270109a: sfarsit la % ms de la BEGIN, lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
