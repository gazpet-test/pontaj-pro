-- Revenire 20270109a_izo_ocr_local_rezerva_sonnet. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce rezerva apelului plătit E3 la 0,05 USD: CHECK (rezerva_usd = 0.05) cu același nume, DEFAULT 0.05, rândul unic 0.20 → 0.05.
--   Starea EXACTĂ a migrării e verificată înainte, sub lock (rând, CHECK-uri, valoare implicită, RPC-ul neatins); altă stare = refuz, nimic schimbat.
-- ORDINEA: ÎNTÂI edge-ul izo-e3-ocr-local înapoi (sau lăsat pe Sonnet: după revenire el refuză fallback-ul FĂRĂ apel, rezerva_insuficienta,
--   cost 0 — fail-closed), apoi această revenire. Rezervările deschise de 0,20 își păstrează suma și se decontează la costul real.
-- Fără refuz pe date: nu se șterge nimic; NOTICE-ul numără apelurile plătite în curs.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270109a_izo_ocr_local_rezerva_sonnet_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270109120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri: ACCESS EXCLUSIVE pe public.ocr_local_config, înaintea verificărilor (L14), lock_timeout 100 ms. Probe: scripts/pglite/test_izo_ocr_local_rezerva_sonnet_local.mjs.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270109a_izo_ocr_local_rezerva_sonnet_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270109a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270109a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270109a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270109a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270109a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ocr_local_config') IS NULL THEN RAISE EXCEPTION '20270109a revenire: lipseste public.ocr_local_config'; END IF;
END $pre$;

LOCK TABLE public.ocr_local_config IN ACCESS EXCLUSIVE MODE;

DO $stare$
DECLARE v_rau text;
BEGIN
  IF (SELECT count(*) FROM public.ocr_local_config) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.ocr_local_config WHERE id AND rezerva_usd = 0.20 AND plafon_usd = 10) THEN
    RAISE EXCEPTION '20270109a revenire: ocr_local_config nu e in starea din 20270109a (rezerva 0.20, plafon 10)';
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
                WHERE conrelid = 'public.ocr_local_config'::regclass AND contype = 'c') c ON c.conname = a.conname
   WHERE a.conname IS NULL OR c.conname IS NULL OR a.def IS DISTINCT FROM c.def;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270109a revenire: CHECK-urile ocr_local_config difera de 20270109a: %', v_rau; END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute t ON t.attrelid = d.adrelid AND t.attnum = d.adnum
       WHERE d.adrelid = 'public.ocr_local_config'::regclass AND t.attname = 'rezerva_usd') IS DISTINCT FROM '0.20' THEN
    RAISE EXCEPTION '20270109a revenire: valoarea implicita a rezerva_usd nu e 0.20';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ocr_local_rezerva_apel(uuid)')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'e24930150252c190a33a9c0b58665525'
                   AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION '20270109a revenire: fn_ocr_local_rezerva_apel nu e cea din 20261108a (corp, proprietati sau drepturi)';
  END IF;
END $stare$;

ALTER TABLE public.ocr_local_config DROP CONSTRAINT ocr_local_config_rezerva_usd_check;
UPDATE public.ocr_local_config SET rezerva_usd = 0.05 WHERE id AND rezerva_usd = 0.20;
ALTER TABLE public.ocr_local_config
  ADD CONSTRAINT ocr_local_config_rezerva_usd_check CHECK (rezerva_usd = 0.05),
  ALTER COLUMN rezerva_usd SET DEFAULT 0.05;

DO $post$
DECLARE v_rau text; v_n integer;
BEGIN
  IF (SELECT count(*) FROM public.ocr_local_config) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.ocr_local_config WHERE id AND rezerva_usd = 0.05 AND plafon_usd = 10) THEN
    RAISE EXCEPTION '20270109a revenire: postconditie: randul de configurare (rezerva 0.05)';
  END IF;
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
                WHERE conrelid = 'public.ocr_local_config'::regclass AND contype = 'c' AND convalidated) c ON c.conname = a.conname
   WHERE a.conname IS NULL OR c.conname IS NULL OR a.def IS DISTINCT FROM c.def;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270109a revenire: postconditie: CHECK-urile ocr_local_config: %', v_rau; END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute t ON t.attrelid = d.adrelid AND t.attnum = d.adnum
       WHERE d.adrelid = 'public.ocr_local_config'::regclass AND t.attname = 'rezerva_usd') IS DISTINCT FROM '0.05' THEN
    RAISE EXCEPTION '20270109a revenire: postconditie: valoarea implicita a rezerva_usd';
  END IF;
  SELECT count(*) INTO v_n FROM public.ocr_local_cereri WHERE apel_faza IN ('acordat', 'rezervat', 'trimis', 'raspuns');
  RAISE NOTICE '20270109a revenire: apeluri platite E3 in curs (pastreaza suma rezervata inainte): %', v_n;
END $post$;
