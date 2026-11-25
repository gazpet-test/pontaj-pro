-- Version 20270112120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270112a_ofertare_cantitati_masuratori.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA). Manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh --iesire, docs/LIVRARE_L15_V2.md §5); lista OBIECTELOR revizuită (generată pe PGlite cu pașii reali ai
--   runnerului): supabase/tests/20270112a_ofertare_cantitati_masuratori.l15.obiecte.tsv. Dry-run pe clonă după aplicare (ROLLBACK):
--   supabase/tests/20270112a_ofertare_cantitati_masuratori_dryrun.sql.
-- 20270112a_ofertare_cantitati_masuratori — Ofertare: aceeași cantitate, documente diferite (TKT-2026-0329, varianta A). Specificația:
--   docs/superpowers/specs/2026-11-25-ofertare-cantitati-intre-surse-design.md (v3); planul: docs/superpowers/plans/2026-11-25-ofertare-cantitati-intre-surse.md.
-- Ce face:
--   1. Listele închise ofertare_elemente_masura (elementele comparabile + UM canonică) și ofertare_tipare_cantitate (antetele de cantitate / UM
--      și cuvintele-cheie ale textului liber), scrise doar aici; citire pentru authenticated.
--   2. Tabelele: ofertare_cantitati_setari (prag / plafon pe licitație), ofertare_cantitati_evaluari (o rulare = o evaluare: token, fotografia
--      surselor, inventarul paginilor, stare), ofertare_cantitati_semnale (o identitate stabilă = o măsură: licitație, lot, obiect, element,
--      clasă, UM; evaluarea PUBLICATĂ; rezolvarea prin răspuns), ofertare_cantitati_masuratori (componentele unei evaluări, cu sau fără dovadă).
--      RLS: citire DOAR cu acces Ofertare; nicio scriere directă (scrierile vin din RPC-urile DEFINER). Triggerele de licitație
--      (CM_ALTA_LICITATIE) și de imuabilitate (CM_IMUABIL; DELETE doar din CASCADE sau din RPC-urile proprii, sub marcaj).
--      UNIQUE (licitatie_id, nr) pe ofertare_clarificari (decizia 10 a planului), după preflight-ul dublurilor live.
--   3. Clasificarea, regula numerică, UM canonică, lotul, paginile permise, verificarea deterministă a dovezilor (tabel / text) — funcții SQL,
--      o singură definiție, fără EXECUTE pentru clienți.
--   4. Fotografia surselor + RPC-urile edge (service_role): felii autoritative, context legat de fotografie, propunerea (măsurătorile unei
--      evaluări) și publicarea atomică (inventar, agregare, verdict, semnal + ciorna auto_surse_*); RPC-urile UI (authenticated): setările,
--      legarea răspunsului, lista semnalelor; starea LIVE a bazei (ofertare_semnal_baza_stare) și dispecerul fn_ofertare_ciorna_auto_stare.
--   5. Extinderea circuitului auto_planse_* la auto_surse_*: fn_trg_ofertare_clarificari_baza, ofertare_clarificare_reconfirma,
--      ofertare_clarificare_exceptie_identitate (refuz explicit pe surse), ofertare_clarificari_export, ofertare_clarificari_notifica
--      (ORDER BY nr FOR UPDATE — singura schimbare de ordine), v_ofertare_clarificari_baza (aceleași coloane). Corpurile = textul LIVE
--      (ultima formă cunoscută: docs/R5_MIGRARE_3_review_copilot.sql, 20261121a) cu DOAR schimbările din inventarul planului; $pre$ refuză
--      dacă amprenta LIVE a oricăruia diferă de cea din blocul AMPRENTE LIVE (valorile de confirmat de coordonator pe clonă).
--   6. ABATERE declarată față de plan (inventar #7): fn_ofertare_surse_valideaza (20261026a) decidea „utilizator” doar după rolul din JWT, deci refuza
--      scrierea baza_generare / sursa din RPC-urile DEFINER chemate de un om (reconfirmarea R9b de azi, legarea răspunsului de aici); textul LIVE
--      cu o singură linie schimbată (secțiunea 9i). Triggerele a02_* rămân pe aceeași funcție.
-- Ce NU face: nu schimbă cantitățile, nu trimite nimic, nu citește SEAP, nu atinge prețuri, nu dă acces la Ofertare, nu atinge date.
-- Datele existente: zero dubluri (licitatie_id, nr) în ofertare_clarificari (preflight sub lock, CM_NR_DUBLU la refuz); nimic rescris.
-- Lock-uri (L06): un singur tabel existent modificat (ofertare_clarificari: trigger rescris, UNIQUE nou) — ACCESS EXCLUSIVE NOWAIT, luat
--   ÎNAINTEA verificărilor de stare (L14), bugetul 1 s de la prima încercare (blocul $lock$); ocupat = 55P03, nimic schimbat. Vederea
--   v_ofertare_clarificari_baza se recreează (DROP + CREATE) sub același lock logic. Protocolul lock-urilor RPC-urilor (în comentariul fiecăruia):
--   (0) advisory pe licitație DOAR în propune / publica; (1) ofertare_licitatii FOR SHARE; (2) ofertare_documente_atribuire FOR SHARE ORDER BY id;
--   (3) ofertare_cantitati FOR SHARE ORDER BY id; (4) ofertare_cantitati_semnale FOR UPDATE ORDER BY id; (5) ofertare_clarificari auto_surse_%
--   FOR UPDATE ORDER BY nr, într-o singură instrucțiune, înaintea primei scrieri.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), bugetul de lock 1 s, lock_timeout 100 ms
--   (lock-urile implicite), garda finală a runnerului (PLAFON_TIMP + LOCK_TINUT).
-- Ordinea livrării: (1) această migrare, (2) deploy edge ofertare-cantitati-extrage (PR-extragere), (3) merge PR-UI.
-- Revenire: supabase/revenire/20270112a_ofertare_cantitati_masuratori_ROLLBACK.sql (refuză dacă există evaluări / semnale / măsurători / setări
--   sau ciorne auto_surse_%; readuce cele 6 funcții R9b + notificarea + vederea la corpurile EXACTE de dinainte).
-- Probe: scripts/pglite/test_ofertare_cantitati_masuratori_local.mjs (schelet + pașii L15 v2 reali; t1–t5, refuzuri, revenire, mutanți).
DO $pre$
DECLARE v_plafon text; r record; v_tip text; v_udt text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270112a_ofertare_cantitati_masuratori:' || txid_current() THEN
    RAISE EXCEPTION '20270112a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270112a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270112a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270112a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270112a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20270111a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270112a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR r IN SELECT * FROM (VALUES ('ofertare_licitatii'), ('ofertare_documente_atribuire'), ('ofertare_document_loturi'), ('ofertare_cantitati'),
      ('ofertare_clarificari'), ('ofertare_cant_obs'), ('ofertare_cant_extrageri'), ('ofertare_cant_felii'), ('ofertare_cant_doc_decizii')) v(t) LOOP
    IF to_regclass('public.' || r.t) IS NULL THEN RAISE EXCEPTION '20270112a: lipseste tabelul public.%', r.t; END IF;
  END LOOP;
  IF to_regclass('public.v_ofertare_clarificari_baza') IS NULL THEN RAISE EXCEPTION '20270112a: lipseste vederea v_ofertare_clarificari_baza'; END IF;
  -- reaplicare: niciun obiect nou nu există (tabele, funcții după nume, constrângerea UNIQUE)
  IF to_regclass('public.ofertare_elemente_masura') IS NOT NULL OR to_regclass('public.ofertare_tipare_cantitate') IS NOT NULL
     OR to_regclass('public.ofertare_cantitati_setari') IS NOT NULL OR to_regclass('public.ofertare_cantitati_evaluari') IS NOT NULL
     OR to_regclass('public.ofertare_cantitati_semnale') IS NOT NULL OR to_regclass('public.ofertare_cantitati_masuratori') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ofertare_clarificari_licitatie_nr_uq')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                 AND (p.proname LIKE 'fn\_ofertare\_masura\_%' OR p.proname LIKE 'fn\_ofertare\_semnal%' OR p.proname LIKE 'fn\_ofertare\_masuratori\_%'
                      OR p.proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare',
                                       'fn_trg_ofertare_masuratori_licitatie', 'fn_trg_ofertare_masuratori_imuabil'))) THEN
    RAISE EXCEPTION '20270112a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite, cu tipurile acceptate (information_schema; tablourile prin udt_name)
  FOR r IN SELECT * FROM (VALUES
      ('ofertare_licitatii', 'id', 'bigint', NULL), ('ofertare_licitatii', 'stare_loturi', 'text', NULL),
      ('ofertare_documente_atribuire', 'id', 'bigint', NULL), ('ofertare_documente_atribuire', 'licitatie_id', 'bigint', NULL),
      ('ofertare_documente_atribuire', 'tip', 'text', NULL), ('ofertare_documente_atribuire', 'nume_original', 'text', NULL),
      ('ofertare_documente_atribuire', 'revizie', 'text', NULL), ('ofertare_documente_atribuire', 'text_extras', 'text', NULL),
      ('ofertare_documente_atribuire', 'pagini_necitite', 'ARRAY', '_int4'), ('ofertare_documente_atribuire', 'lot_stare', 'text', NULL),
      ('ofertare_document_loturi', 'document_id', 'bigint', NULL), ('ofertare_document_loturi', 'lot_nr', 'integer', NULL),
      ('ofertare_cantitati', 'id', 'bigint', NULL), ('ofertare_cantitati', 'licitatie_id', 'bigint', NULL), ('ofertare_cantitati', 'cantitate', 'numeric', NULL),
      ('ofertare_cantitati', 'um', 'text', NULL), ('ofertare_cantitati', 'status', 'text', NULL), ('ofertare_cantitati', 'obiect', 'text', NULL),
      ('ofertare_cantitati', 'denumire', 'text', NULL), ('ofertare_cantitati', 'cod_articol', 'text', NULL), ('ofertare_cantitati', 'specificatii', 'text', NULL),
      ('ofertare_cantitati', 'lot_nr', 'ARRAY', '_int4'), ('ofertare_cantitati', 'lot_domeniu', 'text', NULL),
      ('ofertare_cantitati', 'surse_document_ids', 'ARRAY', '_int8'),
      ('ofertare_clarificari', 'id', 'bigint', NULL), ('ofertare_clarificari', 'licitatie_id', 'bigint', NULL), ('ofertare_clarificari', 'nr', 'integer', NULL),
      ('ofertare_clarificari', 'intrebare', 'text', NULL), ('ofertare_clarificari', 'sursa', 'text', NULL), ('ofertare_clarificari', 'status', 'text', NULL),
      ('ofertare_clarificari', 'origine', 'text', NULL), ('ofertare_clarificari', 'cheie', 'text', NULL), ('ofertare_clarificari', 'baza_generare', 'jsonb', NULL),
      ('ofertare_clarificari', 'surse_document_ids', 'ARRAY', '_int8'), ('ofertare_clarificari', 'surse_cantitati_ids', 'ARRAY', '_int8'),
      ('ofertare_clarificari', 'updated_at', 'timestamp with time zone', NULL),
      ('ofertare_cant_obs', 'id', 'bigint', NULL), ('ofertare_cant_obs', 'extragere_id', 'bigint', NULL), ('ofertare_cant_obs', 'felie_nr', 'integer', NULL),
      ('ofertare_cant_obs', 'lot_domeniu', 'text', NULL), ('ofertare_cant_obs', 'lot_nr', 'ARRAY', '_int4'), ('ofertare_cant_obs', 'rol_sursa', 'text', NULL),
      ('ofertare_cant_obs', 'pagina', 'integer', NULL), ('ofertare_cant_obs', 'denumire', 'text', NULL), ('ofertare_cant_obs', 'pozitie_dovedita', 'boolean', NULL),
      ('ofertare_cant_obs', 'tip_lucrare', 'text', NULL), ('ofertare_cant_obs', 'masura', 'text', NULL), ('ofertare_cant_obs', 'obiect_cheie', 'text', NULL),
      ('ofertare_cant_obs', 'material', 'text', NULL), ('ofertare_cant_obs', 'dn_mm', 'ARRAY', '_numeric'), ('ofertare_cant_obs', 'um_norm', 'text', NULL),
      ('ofertare_cant_obs', 'e_total', 'boolean', NULL), ('ofertare_cant_obs', 'e_subtotal', 'boolean', NULL), ('ofertare_cant_obs', 'citat', 'text', NULL),
      ('ofertare_cant_obs', 'hash_rand', 'text', NULL),
      ('ofertare_cant_extrageri', 'id', 'bigint', NULL), ('ofertare_cant_extrageri', 'document_id', 'bigint', NULL), ('ofertare_cant_extrageri', 'doc_sha256', 'text', NULL),
      ('ofertare_cant_extrageri', 'extractor_id', 'text', NULL), ('ofertare_cant_extrageri', 'stare', 'text', NULL),
      ('ofertare_cant_felii', 'id', 'bigint', NULL), ('ofertare_cant_felii', 'extragere_id', 'bigint', NULL), ('ofertare_cant_felii', 'felie_nr', 'integer', NULL),
      ('ofertare_cant_felii', 'incercare', 'integer', NULL), ('ofertare_cant_felii', 'de_la', 'integer', NULL), ('ofertare_cant_felii', 'pana_la', 'integer', NULL),
      ('ofertare_cant_felii', 'stare', 'text', NULL),
      ('ofertare_cant_doc_decizii', 'id', 'bigint', NULL), ('ofertare_cant_doc_decizii', 'document_id', 'bigint', NULL), ('ofertare_cant_doc_decizii', 'doc_sha256', 'text', NULL),
      ('ofertare_cant_doc_decizii', 'rol', 'text', NULL), ('ofertare_cant_doc_decizii', 'sectiune', 'text', NULL), ('ofertare_cant_doc_decizii', 'decizie', 'text', NULL),
      ('ofertare_cant_doc_decizii', 'revoca_id', 'bigint', NULL)
    ) v(t, c, tip, udt) LOOP
    SELECT data_type, udt_name INTO v_tip, v_udt FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR v_tip <> r.tip OR (r.udt IS NOT NULL AND v_udt IS DISTINCT FROM r.udt) THEN
      RAISE EXCEPTION '20270112a: coloana %.% lipseste sau are alt tip (% %; asteptat % %)', r.t, r.c, coalesce(v_tip, 'lipsa'), coalesce(v_udt, ''), r.tip, coalesce(r.udt, '');
    END IF;
  END LOOP;
  -- dependențele: funcțiile existente chemate de RPC-urile noi (nu se rescriu): există, DEFINER, cale sigură, proprietar postgres
  FOR r IN SELECT * FROM (VALUES ('public.fn_are_acces_ofertare()'), ('public.fn_ofertare_source_pack_poate_decide(bigint)')) v(fn) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn) AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
                     AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '20270112a: dependenta % lipseste sau nu e DEFINER cu cale sigura al lui postgres', r.fn;
    END IF;
  END LOOP;
  -- corpurile LIVE rescrise / dependente (circuitul R9b + notificarea + proveniența): amprenta, DEFINER, cale, proprietar — orice diferență = refuz
  FOR r IN SELECT * FROM (VALUES
      -- >>> AMPRENTE LIVE
      ('public.fn_trg_ofertare_clarificari_baza()', '2183cb89a14d499311ac823bb41ce204', false),
      ('public.ofertare_clarificare_reconfirma(bigint,text,text,text)', '704c8c2961fbaf6bfa1da493e59f4900', true),
      ('public.ofertare_clarificare_exceptie_identitate(bigint,text,text)', '1ff26128565d0b0901e00eb8e4cad47f', true),
      ('public.ofertare_clarificari_export(bigint)', 'a5c24ae8d822383ef66977d598543fd9', false),
      ('public.ofertare_clarificari_notifica(bigint)', '1a77b5c8226f86257b779140e18c56c7', true),
      ('public.ofertare_clarificare_baza_stare(bigint,text,text,jsonb)', '1eb3d1c9992ff06a6e76fb79692a9313', false),
      ('public.fn_ofertare_surse_valideaza()', '03b3a62bf2b4bdce1378e75397179099', true)
      -- <<< AMPRENTE LIVE
    ) v(fn, corp_md5, definer) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(r.fn)
                     AND md5(replace(p.prosrc, chr(13), '')) = r.corp_md5 AND l.lanname = 'plpgsql' AND p.prosecdef = r.definer
                     AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '20270112a: % nu e corpul LIVE asteptat (corp md5 %, definer %, cale sau proprietar); coordonatorul da textul exact (pg_get_functiondef)', r.fn, r.corp_md5, r.definer;
    END IF;
  END LOOP;
END $pre$;

-- ─── 0. Lock-ul, ÎNAINTEA verificărilor de stare (L14): punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare (șablonul 20270111a);
--     momentul în gazpet.lock_puternic_la pentru LOCK_TINUT. Ocupat peste buget = 55P03, nimic schimbat. ────────────────────────────
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270112a: BUGET_LOCK: ofertare_clarificari ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.ofertare_clarificari IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270112a: BUGET_LOCK: lock-ul pe ofertare_clarificari obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270112a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Starea EXACTĂ de dinainte (sub lock): triggerele de pe ofertare_clarificari, CHECK-ul de status, UNIQUE (licitatie_id, cheie),
--     absența UNIQUE (licitatie_id, nr), zero dubluri live de nr, drepturile vederii ─────────────────────────────────────────────────────
DO $stare$
DECLARE v_rau text; v_dublu integer; v_acl text;
BEGIN
  SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) INTO v_rau FROM pg_trigger
   WHERE tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tgisinternal;
  IF v_rau IS DISTINCT FROM 'a02_ofertare_clarificari_surse, trg_ofertare_cb_clarificari_jurnal, trg_ofertare_clarificari_baza' THEN
    RAISE EXCEPTION '20270112a: triggerele ofertare_clarificari difera de cele asteptate: %', coalesce(v_rau, '(niciunul)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND tg.tgname = 'trg_ofertare_clarificari_baza'
                   AND tg.tgfoid = to_regprocedure('public.fn_trg_ofertare_clarificari_baza()') AND tg.tgtype = 31 AND tg.tgenabled = 'O'
                   AND tg.tgqual IS NULL AND tg.tgnargs = 0) THEN
    RAISE EXCEPTION '20270112a: trg_ofertare_clarificari_baza nu e BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW pe fn_trg_ofertare_clarificari_baza (activ, fara WHEN)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ofertare_clarificari'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) = 'CHECK ((status = ANY (ARRAY[''propunere''::text, ''de_trimis''::text, ''trimisa''::text, ''raspunsa''::text, ''retrasa''::text])))') THEN
    RAISE EXCEPTION '20270112a: CHECK-ul de status al ofertare_clarificari nu e cel asteptat (propunere / de_trimis / trimisa / raspunsa / retrasa)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.ofertare_clarificari'::regclass AND c.contype = 'u'
                   AND (SELECT string_agg(a.attname::text, ',' ORDER BY k.o) FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
                          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) = 'licitatie_id,cheie') THEN
    RAISE EXCEPTION '20270112a: lipseste UNIQUE (licitatie_id, cheie) pe ofertare_clarificari';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.ofertare_clarificari'::regclass AND c.contype IN ('u', 'p')
               AND (SELECT string_agg(a.attname::text, ',' ORDER BY k.o) FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) = 'licitatie_id,nr')
     OR EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.ofertare_clarificari'::regclass AND i.indisunique
                  AND pg_get_indexdef(i.indexrelid) LIKE '%(licitatie_id, nr)%') THEN
    RAISE EXCEPTION '20270112a: exista deja o unicitate pe (licitatie_id, nr)';
  END IF;
  -- preflight-ul datelor (L14, decizia 10): zero dubluri live; altfel refuz, se lamuresc de om
  SELECT count(*) INTO v_dublu FROM (SELECT 1 FROM public.ofertare_clarificari WHERE nr IS NOT NULL GROUP BY licitatie_id, nr HAVING count(*) > 1) d;
  IF v_dublu > 0 THEN
    RAISE EXCEPTION '20270112a: CM_NR_DUBLU: % perechi (licitatie, nr) folosite de mai multe clarificari; se lamuresc intai in Clarificari; nimic schimbat', v_dublu;
  END IF;
  -- drepturile vederii recreate: fotografiate aici (rol, drept), re-acordate IDENTIC dupa CREATE VIEW si verificate in $post$;
  -- fail-closed pe forma asteptata: authenticated = doar SELECT, anon / PUBLIC = nimic
  CREATE TEMP TABLE cm_view_acl ON COMMIT DROP AS
    SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END AS rol, e.privilege_type AS drept
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass;
  SELECT string_agg(rol || ':' || drept, ', ' ORDER BY rol || ':' || drept COLLATE "C") INTO v_acl FROM cm_view_acl;
  -- drepturile functiilor rescrise (CREATE OR REPLACE le pastreaza; $post$ o verifica)
  CREATE TEMP TABLE cm_fn_acl ON COMMIT DROP AS
    SELECT f.fn, CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END AS rol, e.privilege_type AS drept
      FROM unnest(ARRAY['public.fn_trg_ofertare_clarificari_baza()', 'public.ofertare_clarificare_reconfirma(bigint,text,text,text)', 'public.ofertare_clarificare_exceptie_identitate(bigint,text,text)',
                        'public.ofertare_clarificari_export(bigint)', 'public.ofertare_clarificari_notifica(bigint)', 'public.fn_ofertare_surse_valideaza()']) f(fn)
      JOIN pg_proc p ON p.oid = to_regprocedure(f.fn), aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e;
  IF EXISTS (SELECT 1 FROM cm_view_acl WHERE rol IN ('PUBLIC', 'anon')) OR EXISTS (SELECT 1 FROM cm_view_acl WHERE rol = 'authenticated' AND drept <> 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM cm_view_acl WHERE rol = 'authenticated' AND drept = 'SELECT') OR NOT EXISTS (SELECT 1 FROM cm_view_acl WHERE rol = 'service_role' AND drept = 'SELECT') THEN
    RAISE EXCEPTION '20270112a: drepturile v_ofertare_clarificari_baza difera de forma asteptata (authenticated doar SELECT, anon nimic): %', v_acl;
  END IF;
  RAISE NOTICE '20270112a: stare verificata; clarificari existente: %', (SELECT count(*) FROM public.ofertare_clarificari);
END $stare$;

-- ─── 2. Listele închise ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.ofertare_elemente_masura (
  cod         text PRIMARY KEY CHECK (cod ~ '^[a-z0-9_]{3,40}$'),
  familie     text NOT NULL CHECK (familie IN ('teava', 'robinet', 'bransament', 'tub_protectie', 'sapatura', 'refacere', 'necunoscut')),
  um_canonica text CHECK (um_canonica IS NULL OR um_canonica IN ('m', 'buc', 'mc', 'mp', 'kg')),
  are_masa    boolean NOT NULL DEFAULT false,
  activ       boolean NOT NULL DEFAULT true,
  CHECK ((familie = 'necunoscut') = (um_canonica IS NULL))
);
INSERT INTO public.ofertare_elemente_masura (cod, familie, um_canonica, are_masa)
SELECT f.cod || '_dn' || dn, f.fam, 'm', f.fam = 'teava'
  FROM unnest(ARRAY[25, 32, 40, 50, 63, 65, 75, 80, 90, 100, 110, 125, 150, 160, 180, 200, 225, 250, 280, 300, 315, 355, 400, 450, 500, 560, 630]) dn
 CROSS JOIN (VALUES ('teava_pe', 'teava'), ('teava_ol', 'teava'), ('teava', 'teava'), ('tub_protectie', 'tub_protectie')) f(cod, fam);
INSERT INTO public.ofertare_elemente_masura (cod, familie, um_canonica, are_masa)
SELECT 'robinet_dn' || dn, 'robinet', 'buc', false
  FROM unnest(ARRAY[25, 32, 40, 50, 63, 65, 75, 80, 90, 100, 110, 125, 150, 160, 180, 200, 225, 250, 280, 300, 315, 355, 400, 450, 500, 560, 630]) dn;
INSERT INTO public.ofertare_elemente_masura (cod, familie, um_canonica, are_masa) VALUES
  ('bransament', 'bransament', 'buc', false), ('sapatura', 'sapatura', 'mc', false), ('refacere', 'refacere', 'mp', false), ('necunoscut', 'necunoscut', NULL, false);
CREATE TABLE public.ofertare_tipare_cantitate (
  id    smallint PRIMARY KEY,
  fel   text NOT NULL CHECK (fel IN ('antet_cantitate', 'antet_um', 'cuvant_cheie')),
  tipar text NOT NULL CHECK (length(tipar) BETWEEN 1 AND 80),
  activ boolean NOT NULL DEFAULT true,
  UNIQUE (fel, tipar),
  CHECK (fel <> 'cuvant_cheie' OR (tipar !~ '[(][^?]' AND tipar !~ '[(]$'))
);
-- antetele: forme normalizate (minuscule, fara diacritice; tokenii multi-cuvant se lipesc cu „_” inaintea impartirii); cuvintele-cheie: regex
-- POSIX pe textul normalizat, DOAR cu grupuri necapturante (?:…) — grupurile capturante ar deplasa capturile verificarii —, cuvantul INAINTEA
-- numarului (spec §3.2); verificarea textului liber e in trepte (fn_ofertare_masura_verifica)
INSERT INTO public.ofertare_tipare_cantitate (id, fel, tipar) VALUES
  (1, 'antet_cantitate', 'cantitate'), (2, 'antet_cantitate', 'cant.'), (3, 'antet_cantitate', 'cant'), (4, 'antet_cantitate', 'cantit.'),
  (5, 'antet_cantitate', 'lungime'), (6, 'antet_cantitate', 'l (m)'), (7, 'antet_cantitate', 'nr. buc'), (8, 'antet_cantitate', 'volum'),
  (9, 'antet_cantitate', 'suprafata'),
  (11, 'antet_um', 'um'), (12, 'antet_um', 'u.m.'), (13, 'antet_um', 'u/m'), (14, 'antet_um', 'unitate'), (15, 'antet_um', 'unit.'),
  (21, 'cuvant_cheie', 'lungime(?: totala)?'), (22, 'cuvant_cheie', 'l'), (23, 'cuvant_cheie', 'in lungime(?: totala)? de'),
  (24, 'cuvant_cheie', 'cantitate'), (25, 'cuvant_cheie', 'numar(?: de bucati)?|nr[.]?(?: buc[.]?)?');
ALTER TABLE public.ofertare_elemente_masura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_tipare_cantitate ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_elemente_masura_select ON public.ofertare_elemente_masura FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_tipare_cantitate_select ON public.ofertare_tipare_cantitate FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
REVOKE ALL ON public.ofertare_elemente_masura, public.ofertare_tipare_cantitate FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ofertare_elemente_masura, public.ofertare_tipare_cantitate TO authenticated, service_role;
COMMENT ON TABLE public.ofertare_elemente_masura IS 'Ofertare: lista inchisa a elementelor comparabile intre documente (teava / tub de protectie / robinet pe DN, bransament, sapatura, refacere; necunoscut = doar pentru semnalele de verificat), cu UM canonica. Scrisa doar in migrare. 20270112a.';
COMMENT ON TABLE public.ofertare_tipare_cantitate IS 'Ofertare: lista inchisa a antetelor de cantitate / UM (tabele) si a cuvintelor-cheie (text liber) acceptate la verificarea dovezilor. Scrisa doar in migrare. 20270112a.';

-- ─── 3. Identitatea măsurii (IMMUTABLE, folosită de CHECK) ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_ofertare_masura_identitate(p_licitatie_id bigint, p_lot_nr integer, p_obiect_cheie text, p_element text, p_clasa text, p_um_canonica text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT left(md5(p_licitatie_id::text || '|' || coalesce(p_lot_nr::text, '-') || '|' || coalesce(p_obiect_cheie, '*') || '|' || coalesce(p_element, 'necunoscut')
                         || '|' || coalesce(p_clasa, 'necunoscuta') || '|' || coalesce(p_um_canonica, '-')), 16) $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_identitate(bigint, integer, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 4. Tabelele: setări, evaluări, semnale, măsurători (RLS: citire cu acces Ofertare; nicio scriere directă) ──────────────────────
CREATE TABLE public.ofertare_cantitati_setari (
  licitatie_id  bigint PRIMARY KEY REFERENCES public.ofertare_licitatii(id),
  prag          numeric(5,4) NOT NULL DEFAULT 0.0500 CHECK (prag BETWEEN 0.001 AND 0.5),
  plafon_pagini integer NOT NULL DEFAULT 200 CHECK (plafon_pagini BETWEEN 10 AND 2000),
  setat_de      uuid,
  setat_la      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ofertare_cantitati_evaluari (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  token        uuid NOT NULL UNIQUE,
  surse_sha    text NOT NULL CHECK (surse_sha ~ '^[0-9a-f]{64}$'),
  fotografie   jsonb NOT NULL CHECK (jsonb_typeof(fotografie) = 'object'),
  pagini       jsonb NOT NULL CHECK (jsonb_typeof(pagini) = 'object'),
  stare        text NOT NULL DEFAULT 'in_curs' CHECK (stare IN ('in_curs', 'publicata', 'depasita', 'abandonata')),
  creat_la     timestamptz NOT NULL DEFAULT now(),
  inchisa_la   timestamptz,
  CHECK ((stare = 'in_curs') = (inchisa_la IS NULL))
);
CREATE INDEX ofertare_cantitati_evaluari_lic ON public.ofertare_cantitati_evaluari (licitatie_id, stare);
CREATE TABLE public.ofertare_cantitati_semnale (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id               bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  lot_nr                     integer,
  obiect_cheie               text NOT NULL,
  element                    text NOT NULL REFERENCES public.ofertare_elemente_masura(cod),
  clasa                      text NOT NULL CHECK (clasa IN ('fizica', 'montaj', 'proba', 'necunoscuta')),
  um_canonica                text,
  identitate                 text NOT NULL CHECK (identitate ~ '^[0-9a-f]{16}$'),
  evaluare_id                bigint REFERENCES public.ofertare_cantitati_evaluari(id),
  evaluare_in_curs_id        bigint REFERENCES public.ofertare_cantitati_evaluari(id),
  surse_sha                  text CHECK (surse_sha IS NULL OR surse_sha ~ '^[0-9a-f]{64}$'),
  evaluare_amprenta          text CHECK (evaluare_amprenta IS NULL OR evaluare_amprenta ~ '^[0-9a-f]{64}$'),
  verdict                    text CHECK (verdict IS NULL OR verdict IN ('in_regula', 'diferenta', 'de_verificat', 'neverificat')),
  motiv                      text,
  valoare_a                  numeric,
  valoare_b                  numeric,
  valori_b                   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(valori_b) = 'array'),
  inventar                   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(inventar) = 'object'),
  evaluare_la                timestamptz,
  clarificare_id             bigint REFERENCES public.ofertare_clarificari(id),
  reaparut_dupa_respingere   boolean NOT NULL DEFAULT false,
  rezolvare                  jsonb CHECK (rezolvare IS NULL OR (jsonb_typeof(rezolvare) = 'object' AND rezolvare ? 'document_id' AND rezolvare ? 'revizie' AND rezolvare ? 'valoare')),
  UNIQUE (licitatie_id, identitate),
  CHECK ((element = 'necunoscut') = (clasa = 'necunoscuta')),
  CHECK (identitate = public.fn_ofertare_masura_identitate(licitatie_id, lot_nr, obiect_cheie, element, clasa, um_canonica))
);
CREATE INDEX ofertare_cantitati_semnale_ev ON public.ofertare_cantitati_semnale (evaluare_in_curs_id);
CREATE TABLE public.ofertare_cantitati_masuratori (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id   bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  evaluare_id    bigint NOT NULL REFERENCES public.ofertare_cantitati_evaluari(id) ON DELETE CASCADE,
  semnal_id      bigint NOT NULL REFERENCES public.ofertare_cantitati_semnale(id) ON DELETE CASCADE,
  parte          text NOT NULL CHECK (parte IN ('a', 'b')),
  cantitate_id   bigint REFERENCES public.ofertare_cantitati(id) ON DELETE CASCADE,
  obs_id         bigint REFERENCES public.ofertare_cant_obs(id) ON DELETE CASCADE,
  document_id    bigint REFERENCES public.ofertare_documente_atribuire(id) ON DELETE CASCADE,
  revizie        text,
  doc_sha256     text CHECK (doc_sha256 IS NULL OR doc_sha256 ~ '^[0-9a-f]{64}$'),
  pagina         integer CHECK (pagina IS NULL OR pagina BETWEEN 1 AND 99999),
  fel_dovada     text CHECK (fel_dovada IS NULL OR fel_dovada IN ('tabel', 'text')),
  rand           text,
  celula         text,
  fragment       text,
  antet_coloana  text,
  antet_um       text,
  valoare_text   text,
  um_text        text,
  valoare        numeric,
  um_canonica    text,
  natura         text CHECK (natura IS NULL OR natura IN ('furnizare', 'montaj', 'proba', 'total_lucrare')),
  e_total        boolean NOT NULL DEFAULT false,
  e_subtotal     boolean NOT NULL DEFAULT false,
  verificare     text NOT NULL CHECK (verificare IN ('ok', 'nedovedit', 'fara_sursa', 'neclasificat', 'lot_necunoscut', 'neatribuibil', 'pagina_nepermisa',
                                                     'fragment_lipsa', 'rand_lipsa', 'rand_ambiguu', 'antet_lipsa', 'coloana_necunoscuta', 'um_lipsa',
                                                     'tipar_necunoscut', 'numar_ambiguu', 'numar_neintreg', 'diametru_nu_cantitate', 'unitate_incompatibila')),
  creat_la       timestamptz NOT NULL DEFAULT now(),
  CHECK ((parte = 'a') = (cantitate_id IS NOT NULL)),
  CHECK ((parte = 'b') = (obs_id IS NOT NULL)),
  CHECK (verificare = 'fara_sursa' OR document_id IS NOT NULL),
  CHECK (document_id IS NULL OR (revizie IS NOT NULL AND doc_sha256 IS NOT NULL)),
  CHECK (verificare IN ('nedovedit', 'fara_sursa', 'neclasificat', 'lot_necunoscut', 'neatribuibil', 'pagina_nepermisa') OR fel_dovada IS NOT NULL),
  CHECK (verificare NOT IN ('neatribuibil', 'pagina_nepermisa') OR (parte = 'b' AND valoare IS NULL AND fel_dovada IS NULL)),
  CHECK (fel_dovada IS DISTINCT FROM 'tabel' OR (rand IS NOT NULL AND celula IS NOT NULL AND fragment IS NULL)),
  CHECK (fel_dovada IS DISTINCT FROM 'text' OR (fragment IS NOT NULL AND rand IS NULL AND celula IS NULL)),
  CHECK ((verificare = 'ok') = (valoare IS NOT NULL AND um_canonica IS NOT NULL AND pagina IS NOT NULL AND fel_dovada IS NOT NULL))
);
CREATE INDEX ofertare_cantitati_masuratori_semnal ON public.ofertare_cantitati_masuratori (semnal_id, evaluare_id);
CREATE INDEX ofertare_cantitati_masuratori_ev ON public.ofertare_cantitati_masuratori (evaluare_id);
CREATE INDEX ofertare_cantitati_masuratori_doc ON public.ofertare_cantitati_masuratori (document_id);
ALTER TABLE public.ofertare_cantitati_setari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_cantitati_evaluari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_cantitati_semnale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_cantitati_masuratori ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_cantitati_setari_select ON public.ofertare_cantitati_setari FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
CREATE POLICY ofertare_cantitati_evaluari_select ON public.ofertare_cantitati_evaluari FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
CREATE POLICY ofertare_cantitati_semnale_select ON public.ofertare_cantitati_semnale FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
CREATE POLICY ofertare_cantitati_masuratori_select ON public.ofertare_cantitati_masuratori FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
REVOKE ALL ON public.ofertare_cantitati_setari, public.ofertare_cantitati_evaluari, public.ofertare_cantitati_semnale, public.ofertare_cantitati_masuratori
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ofertare_cantitati_setari, public.ofertare_cantitati_evaluari, public.ofertare_cantitati_semnale, public.ofertare_cantitati_masuratori
  TO authenticated, service_role;
COMMENT ON TABLE public.ofertare_cantitati_setari IS 'Ofertare: pragul (implicit 5 %) si plafonul de pagini (implicit 200) ale comparatiei cantitatilor intre documente, pe licitatie; scris doar prin fn_ofertare_semnale_setari (drept de decizie). 20270112a.';
COMMENT ON TABLE public.ofertare_cantitati_evaluari IS 'Ofertare: o rulare a comparatiei = o evaluare (token, fotografia surselor, inventarul paginilor, stare in_curs / publicata / depasita). Scrisa doar de RPC-urile service_role. 20270112a.';
COMMENT ON TABLE public.ofertare_cantitati_semnale IS 'Ofertare: o masura comparabila (licitatie, lot, obiect, element, clasa, UM) cu evaluarea PUBLICATA (verdict, valori, inventar), ciorna auto_surse_* si rezolvarea prin raspunsul Autoritatii. Scrisa doar de RPC-uri. 20270112a.';
COMMENT ON TABLE public.ofertare_cantitati_masuratori IS 'Ofertare: componentele unei evaluari (pozitiile F3 = partea a, observatiile documentelor = partea b), fiecare cu dovada verificata determinist sau cu motivul lipsei; imuabile; sterse doar in cascada / la o evaluare depasita. 20270112a.';

-- ─── 5. UNIQUE (licitatie_id, nr) pe ofertare_clarificari (L16; după preflight-ul din $stare$) ────────────────────────────────────────
ALTER TABLE public.ofertare_clarificari ADD CONSTRAINT ofertare_clarificari_licitatie_nr_uq UNIQUE (licitatie_id, nr);

-- ─── 6. Triggerele măsurătorilor: aceeași licitație pe toate referințele; imuabilitate (UPDATE refuzat; DELETE doar din CASCADE sau din RPC-urile
--     proprii sub marcajul ofertare.masuratori_rpc — semnal intern pe o cale deja protejata prin EXECUTE doar service_role, nu identitate) ───
CREATE FUNCTION public.fn_trg_ofertare_masuratori_licitatie() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE v_lic bigint;
BEGIN
  SELECT s.licitatie_id INTO v_lic FROM public.ofertare_cantitati_semnale s WHERE s.id = NEW.semnal_id;
  IF v_lic IS DISTINCT FROM NEW.licitatie_id THEN RAISE EXCEPTION 'CM_ALTA_LICITATIE: semnalul e al altei licitatii' USING ERRCODE = 'P0001'; END IF;
  SELECT e.licitatie_id INTO v_lic FROM public.ofertare_cantitati_evaluari e WHERE e.id = NEW.evaluare_id;
  IF v_lic IS DISTINCT FROM NEW.licitatie_id THEN RAISE EXCEPTION 'CM_ALTA_LICITATIE: evaluarea e a altei licitatii' USING ERRCODE = 'P0001'; END IF;
  IF NEW.document_id IS NOT NULL THEN
    SELECT d.licitatie_id INTO v_lic FROM public.ofertare_documente_atribuire d WHERE d.id = NEW.document_id FOR KEY SHARE;
    IF v_lic IS DISTINCT FROM NEW.licitatie_id THEN RAISE EXCEPTION 'CM_ALTA_LICITATIE: documentul e al altei licitatii' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF NEW.cantitate_id IS NOT NULL THEN
    SELECT q.licitatie_id INTO v_lic FROM public.ofertare_cantitati q WHERE q.id = NEW.cantitate_id;
    IF v_lic IS DISTINCT FROM NEW.licitatie_id THEN RAISE EXCEPTION 'CM_ALTA_LICITATIE: pozitia F3 e a altei licitatii' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF NEW.obs_id IS NOT NULL THEN
    SELECT o.licitatie_id INTO v_lic FROM public.ofertare_cant_obs o WHERE o.id = NEW.obs_id;
    IF v_lic IS DISTINCT FROM NEW.licitatie_id THEN RAISE EXCEPTION 'CM_ALTA_LICITATIE: observatia e a altei licitatii' USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_masuratori_licitatie() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_ofertare_masuratori_licitatie BEFORE INSERT OR UPDATE ON public.ofertare_cantitati_masuratori
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_masuratori_licitatie();
CREATE FUNCTION public.fn_trg_ofertare_masuratori_imuabil() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'ofertare_cantitati_evaluari' AND current_setting('ofertare.masuratori_rpc', true) = '1'
       AND to_jsonb(NEW) - 'stare' - 'inchisa_la' = to_jsonb(OLD) - 'stare' - 'inchisa_la' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'CM_IMUABIL: % nu se modifica', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_TABLE_NAME = 'ofertare_cantitati_evaluari' THEN RAISE EXCEPTION 'CM_IMUABIL: evaluarile nu se sterg' USING ERRCODE = 'P0001'; END IF;
  IF pg_trigger_depth() >= 2 OR current_setting('ofertare.masuratori_rpc', true) = '1' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'CM_IMUABIL: masuratorile se sterg doar in cascada sau de RPC-urile proprii' USING ERRCODE = 'P0001';
END $f$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_masuratori_imuabil() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_ofertare_masuratori_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cantitati_masuratori
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_masuratori_imuabil();
CREATE TRIGGER trg_ofertare_evaluari_imuabil BEFORE UPDATE OR DELETE ON public.ofertare_cantitati_evaluari
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_masuratori_imuabil();

-- ─── 7. Clasificarea, regula numerică, UM canonică, lotul, paginile permise, verificarea dovezilor (spec §3.1–3.3; o singură definiție, L19;
--     fără EXECUTE pentru clienți — chemate doar din RPC-urile DEFINER ale lui postgres) ─────────────────────────────────────────────────
-- normalizarea textului: minuscule, fără diacritice, spațiile / tab-urile strânse (spațiile neîntrerupte rămân: sunt separatori de mii)
CREATE FUNCTION public.fn_ofertare_masura_norm(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT btrim(regexp_replace(translate(lower(coalesce(p, '')), 'ăâîșşțţ', 'aaisstt'), '[ ' || chr(9) || ']+', ' ', 'g')) $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_norm(text) FROM PUBLIC, anon, authenticated, service_role;
-- regula numerică (spec §3.3): punct SAU spațiu neîntrerupt (U+00A0, U+202F, U+2009) = mii, DOAR în grupuri exacte de 3; virgulă = zecimale;
-- grupuri de altă lungime după punct = format_numeric_ambiguu; orice altceva = nu_e_numar. Niciodată ::numeric pe textul brut.
CREATE FUNCTION public.fn_ofertare_numar_ro(p_text text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $f$
DECLARE s text := replace(replace(replace(btrim(coalesce(p_text, '')), chr(160), '.'), chr(8239), '.'), chr(8201), '.'); v_int text; v_dec text;
BEGIN
  IF s ~ '^[0-9]{1,3}([.][0-9]{3})*(,[0-9]+)?$' OR s ~ '^[0-9]+(,[0-9]+)?$' THEN
    v_int := replace(split_part(s, ',', 1), '.', ''); v_dec := split_part(s, ',', 2);
    RETURN jsonb_build_object('valoare', (v_int || CASE WHEN v_dec <> '' THEN '.' || v_dec ELSE '' END)::numeric, 'motiv', NULL, 'intreg', v_dec = '');
  ELSIF s ~ '^[0-9]+([.][0-9]+)+(,[0-9]+)?$' THEN
    RETURN jsonb_build_object('valoare', NULL, 'motiv', 'format_numeric_ambiguu', 'intreg', false);
  END IF;
  RETURN jsonb_build_object('valoare', NULL, 'motiv', 'nu_e_numar', 'intreg', false);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_numar_ro(text) FROM PUBLIC, anon, authenticated, service_role;
-- UM canonică pe listă: m / buc / mc / mp / kg; conversii DOAR km→m ×1000, ml→m ×1, bucati→buc, t→kg ×1000 (doar elemente cu masă);
-- mm = diametru_nu_cantitate; UM diferită de cea a elementului = unitate_incompatibila
CREATE FUNCTION public.fn_ofertare_um_canonica(p_um text, p_element text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $f$
DECLARE u text := replace(replace(public.fn_ofertare_masura_norm(p_um), '.', ''), ' ', ''); v_um text; v_f numeric := 1; v_masa boolean := false; e record;
BEGIN
  IF u IN ('m', 'ml', 'metri', 'metru', 'metriliniari', 'metruliniar', 'mliniar') THEN v_um := 'm';
  ELSIF u = 'km' THEN v_um := 'm'; v_f := 1000;
  ELSIF u IN ('buc', 'bucati', 'bucata', 'bc') THEN v_um := 'buc';
  ELSIF u IN ('mc', 'm3', 'm' || chr(179)) THEN v_um := 'mc';
  ELSIF u IN ('mp', 'm2', 'm' || chr(178)) THEN v_um := 'mp';
  ELSIF u = 'kg' THEN v_um := 'kg';
  ELSIF u IN ('t', 'to', 'tone', 'tona') THEN v_um := 'kg'; v_f := 1000; v_masa := true;
  ELSIF u = 'mm' THEN RETURN jsonb_build_object('um', NULL, 'factor', NULL, 'motiv', 'diametru_nu_cantitate');
  ELSE RETURN jsonb_build_object('um', NULL, 'factor', NULL, 'motiv', 'um_necunoscuta');
  END IF;
  IF p_element IS NOT NULL THEN
    SELECT * INTO e FROM public.ofertare_elemente_masura x WHERE x.cod = p_element;
    IF NOT FOUND THEN RETURN jsonb_build_object('um', v_um, 'factor', v_f, 'motiv', 'element_necunoscut'); END IF;
    IF e.um_canonica IS DISTINCT FROM v_um OR (v_masa AND NOT e.are_masa) THEN
      RETURN jsonb_build_object('um', v_um, 'factor', v_f, 'motiv', 'unitate_incompatibila');
    END IF;
  END IF;
  RETURN jsonb_build_object('um', v_um, 'factor', v_f, 'motiv', NULL);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_um_canonica(text, text) FROM PUBLIC, anon, authenticated, service_role;
-- DN-urile dintr-un text: DN / Dn / dn / De / D / Ø + număr (2–4 cifre), și forma „D= 90 MM”; distincte, ordonate
CREATE FUNCTION public.fn_ofertare_masura_dn(p_text text) RETURNS numeric[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT coalesce(array_agg(DISTINCT m[1]::numeric ORDER BY m[1]::numeric), '{}'::numeric[])
          FROM regexp_matches(coalesce(p_text, ''), '(?:\m(?:DN|Dn|dn|De|D)|' || chr(216) || ')[ ]*=?[ ]*([0-9]{2,4})(?:[ ]*(?:MM|mm))?\M', 'g') m $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_dn(text) FROM PUBLIC, anon, authenticated, service_role;
-- clasificarea (decizia 5 a planului): element din lista închisă + natura + clasa + UM canonică a textului; element / natura necunoscute
-- NU dispar: cunoscut = false, cu motivul (semnalul „necunoscut” se formează în RPC)
CREATE FUNCTION public.fn_ofertare_masura_clasifica(p_denumire text, p_um text, p_tip_lucrare text, p_dn numeric[], p_material text, p_masura text, p_rol text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $f$
DECLARE d text := public.fn_ofertare_masura_norm(p_denumire); dn numeric[] := coalesce(p_dn, '{}'); n int := cardinality(coalesce(p_dn, '{}'));
        dnt text; mat text; el text; nat text; cls text; um jsonb; motiv text;
BEGIN
  IF n = 1 THEN dnt := trim_scale(dn[1])::text; END IF;
  mat := CASE WHEN p_material ~* '^PE' THEN 'pe' WHEN p_material ~* '^(OL|OTEL)' THEN 'ol'
              WHEN d ~ '\m(pe|pehd|pe100|pe80|polietilena)\M' THEN 'pe' WHEN d ~ '\m(ol|otel)\M' THEN 'ol' END;
  el := CASE p_tip_lucrare
          WHEN 'conducta' THEN CASE WHEN n = 1 THEN 'teava_' || coalesce(mat || '_', '') || 'dn' || dnt END
          WHEN 'bransament' THEN 'bransament'
          WHEN 'protectie' THEN CASE WHEN n = 1 THEN 'tub_protectie_dn' || dnt END
          ELSE CASE WHEN d ~ '\m(robinet|robineti|vana|vane)\M' AND n = 1 THEN 'robinet_dn' || dnt
                    WHEN d ~ '(sapatur|excava)' THEN 'sapatura' WHEN d ~ 'refacer' THEN 'refacere' END
        END;
  IF el IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ofertare_elemente_masura x WHERE x.cod = el AND x.activ AND x.familie <> 'necunoscut') THEN el := NULL; END IF;
  IF el IS NULL THEN motiv := 'element necunoscut'; END IF;
  nat := CASE WHEN d ~ '(furnizare|procurare)' THEN 'furnizare' WHEN d ~ '(montaj|montare|pozare)' THEN 'montaj'
              WHEN d ~ '\m(proba|probe|incercare|incercari)\M' THEN 'proba'
              WHEN p_masura = 'material' THEN 'furnizare' WHEN p_masura = 'montaj' THEN 'montaj' WHEN p_masura = 'proba' THEN 'proba'
              WHEN p_rol IN ('atr', 'cs', 'memoriu', 'plansa', 'raspuns') THEN 'total_lucrare' END;
  IF nat IS NULL THEN motiv := concat_ws('; ', motiv, 'natura necunoscuta'); END IF;
  cls := CASE nat WHEN 'furnizare' THEN 'fizica' WHEN 'total_lucrare' THEN 'fizica' WHEN 'montaj' THEN 'montaj' WHEN 'proba' THEN 'proba' ELSE 'necunoscuta' END;
  um := public.fn_ofertare_um_canonica(p_um, NULL);
  RETURN jsonb_build_object('element', el, 'natura', nat, 'clasa', cls, 'um_canonica', um ->> 'um', 'cunoscut', el IS NOT NULL AND nat IS NOT NULL,
                            'motiv', concat_ws('; ', motiv, CASE WHEN um ->> 'motiv' = 'um_necunoscuta' THEN 'um necunoscuta' END));
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_clasifica(text, text, text, numeric[], text, text, text) FROM PUBLIC, anon, authenticated, service_role;
-- lotul (decizia 6): lista cu un lot → acel lot; lista cu ≥ 2 / necunoscut → necunoscut; toate (sau fără lot) → NULL doar pe fara_loturi
CREATE FUNCTION public.fn_ofertare_masura_lot(p_lot_domeniu text, p_lot_nr integer[], p_stare_loturi text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT CASE WHEN p_lot_domeniu = 'lista' AND cardinality(coalesce(p_lot_nr, '{}')) = 1 THEN jsonb_build_object('lot', p_lot_nr[1], 'cunoscut', true)
                   WHEN p_lot_domeniu IN ('lista', 'necunoscut') THEN jsonb_build_object('lot', NULL, 'cunoscut', false)
                   WHEN coalesce(p_lot_domeniu, 'toate') = 'toate' AND p_stare_loturi = 'fara_loturi' THEN jsonb_build_object('lot', NULL, 'cunoscut', true)
                   ELSE jsonb_build_object('lot', NULL, 'cunoscut', false) END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_lot(text, integer[], text) FROM PUBLIC, anon, authenticated, service_role;
-- plafonul de pagini (decizia 18): UN numărător cumulat peste documentele ordonate după id (inclusiv cele din cache); o felie e permisă ⇔
-- pagina_pana_la ≤ ultima_pagina_permisa a documentului (o felie care traversează limita e exclusă întreagă)
CREATE FUNCTION public.fn_ofertare_masura_pagini_permise(p_documente jsonb, p_plafon integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ WITH d AS (SELECT (x ->> 'id')::bigint AS id, greatest(coalesce((x ->> 'pagini')::int, 0), 0) AS pagini
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_documente) = 'array' THEN p_documente ELSE '[]'::jsonb END) x),
            c AS (SELECT id, pagini, sum(pagini) OVER (ORDER BY id) AS cumul FROM d)
       SELECT jsonb_build_object('limita', coalesce(jsonb_agg(jsonb_build_object('document_id', id, 'ultima_pagina_permisa',
                                                      greatest(0, least(pagini, coalesce(p_plafon, 0) - (cumul - pagini)))) ORDER BY id), '[]'::jsonb),
                                 'plafon_atins', coalesce(max(cumul), 0) > coalesce(p_plafon, 0)) FROM c $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_pagini_permise(jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
-- paginile unui text: numărul marcajelor ⟦PAGINA n⟧ (maximul); textul paginii n = de la marcaj până la următorul; fără marcaje = o singură pagină
CREATE FUNCTION public.fn_ofertare_masura_pagini(p_text text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT coalesce(max(m[1]::int), CASE WHEN coalesce(p_text, '') <> '' THEN 1 ELSE 0 END)
          FROM regexp_matches(coalesce(p_text, ''), chr(10214) || 'PAGINA[ ]*([0-9]{1,5})' || chr(10215), 'g') m $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_pagini(text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.fn_ofertare_masura_pagina(p_text text, p_pagina integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $f$
DECLARE s int; e int;
BEGIN
  IF p_text IS NULL OR p_pagina IS NULL THEN RETURN NULL; END IF;
  IF strpos(p_text, chr(10214) || 'PAGINA') = 0 THEN RETURN CASE WHEN p_pagina = 1 THEN p_text END; END IF;
  s := regexp_instr(p_text, chr(10214) || 'PAGINA[ ]*' || p_pagina || chr(10215), 1, 1, 1);
  IF s = 0 THEN RETURN NULL; END IF;
  e := strpos(substr(p_text, s), chr(10214) || 'PAGINA');
  RETURN CASE WHEN e = 0 THEN substr(p_text, s) ELSE substr(p_text, s, e - 1) END;
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_pagina(text, integer) FROM PUBLIC, anon, authenticated, service_role;
-- verificarea deterministă a dovezii (spec §3.2, L11): tabel = rândul literal o singură dată pe pagină, antetul de cantitate deasupra, coloana la
-- același index DE LA DREAPTA, UM din coloana / antetul UM; text = fragmentul literal pe pagină, apoi treptele 3b (tipar) → 3c (diametru) →
-- 3d (UM) → 3e (număr întreg). Primul eșec oprește.
CREATE FUNCTION public.fn_ofertare_masura_verifica(p_text_extras text, p_dovada jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $f$
DECLARE v_pag int := (p_dovada ->> 'pagina')::int; v_fel text := p_dovada ->> 'fel_dovada'; v_el text := p_dovada ->> 'element'; v_text text;
        v_rand text; v_cel text; v_frag text; lines text[]; i int; j int; k int; v_nn int; toks text[]; htoks text[]; hgasit boolean := false;
        v_pos int; v_posum int; v_um text; v_ant text; v_antum text; v_num jsonb; v_umj jsonb; v_kw text; m text[]; v_goale int; r record; s text;
        c_nbsp constant text := chr(160) || chr(8239) || chr(8201);
BEGIN
  v_text := public.fn_ofertare_masura_pagina(p_text_extras, v_pag);
  IF v_text IS NULL THEN RETURN jsonb_build_object('verificare', CASE WHEN v_fel = 'tabel' THEN 'rand_lipsa' ELSE 'fragment_lipsa' END); END IF;
  IF v_fel = 'tabel' THEN
    v_rand := p_dovada ->> 'rand'; v_cel := p_dovada ->> 'celula';
    IF coalesce(v_rand, '') = '' OR coalesce(v_cel, '') = '' THEN RETURN jsonb_build_object('verificare', 'rand_lipsa'); END IF;
    v_nn := (length(v_text) - length(replace(v_text, v_rand, ''))) / length(v_rand);
    IF v_nn = 0 THEN RETURN jsonb_build_object('verificare', 'rand_lipsa'); END IF;
    IF v_nn > 1 THEN RETURN jsonb_build_object('verificare', 'rand_ambiguu'); END IF;
    lines := string_to_array(v_text, chr(10));
    i := NULL;
    FOR k IN 1..cardinality(lines) LOOP IF strpos(lines[k], v_rand) > 0 THEN i := k; EXIT; END IF; END LOOP;
    IF i IS NULL THEN RETURN jsonb_build_object('verificare', 'rand_lipsa'); END IF;
    -- linia de antet: cea mai apropiată de deasupra care conține un antet de cantitate ca token întreg; oprire la două linii goale consecutive
    j := i - 1; v_goale := 0;
    WHILE j >= 1 AND NOT hgasit LOOP
      s := public.fn_ofertare_masura_norm(lines[j]);
      IF s = '' THEN v_goale := v_goale + 1; IF v_goale >= 2 THEN EXIT; END IF;
      ELSE
        v_goale := 0;
        FOR r IN SELECT tipar FROM public.ofertare_tipare_cantitate WHERE fel IN ('antet_cantitate', 'antet_um') AND activ AND tipar LIKE '% %' LOOP
          s := replace(s, r.tipar, replace(r.tipar, ' ', '_'));
        END LOOP;
        htoks := regexp_split_to_array(s, ' ');
        FOR k IN 1..cardinality(htoks) LOOP
          IF EXISTS (SELECT 1 FROM public.ofertare_tipare_cantitate t WHERE t.fel = 'antet_cantitate' AND t.activ AND replace(t.tipar, ' ', '_') = htoks[k]) THEN
            hgasit := true; v_pos := cardinality(htoks) - k; v_ant := replace(htoks[k], '_', ' ');
          END IF;
        END LOOP;
      END IF;
      j := j - 1;
    END LOOP;
    IF NOT hgasit THEN RETURN jsonb_build_object('verificare', 'antet_lipsa'); END IF;
    toks := regexp_split_to_array(btrim(regexp_replace(lines[i], '[ ' || chr(9) || ']+', ' ', 'g')), ' ');
    IF cardinality(toks) - v_pos < 1 OR toks[cardinality(toks) - v_pos] IS DISTINCT FROM v_cel THEN RETURN jsonb_build_object('verificare', 'coloana_necunoscuta'); END IF;
    v_posum := NULL;
    FOR k IN 1..cardinality(htoks) LOOP
      IF EXISTS (SELECT 1 FROM public.ofertare_tipare_cantitate t WHERE t.fel = 'antet_um' AND t.activ AND replace(t.tipar, ' ', '_') = htoks[k]) THEN
        v_posum := cardinality(htoks) - k; v_antum := replace(htoks[k], '_', ' ');
      END IF;
    END LOOP;
    IF v_posum IS NOT NULL AND cardinality(toks) - v_posum >= 1 THEN v_um := toks[cardinality(toks) - v_posum];
    ELSIF v_ant ~ '\(([a-z0-9]+)\)' THEN v_um := (regexp_match(v_ant, '\(([a-z0-9]+)\)'))[1]; v_antum := v_ant;
    END IF;
    IF coalesce(v_um, '') = '' THEN RETURN jsonb_build_object('verificare', 'um_lipsa'); END IF;
    v_umj := public.fn_ofertare_um_canonica(v_um, v_el);
    IF v_umj ->> 'motiv' IS NOT NULL THEN
      RETURN jsonb_build_object('verificare', CASE WHEN v_umj ->> 'motiv' = 'diametru_nu_cantitate' THEN 'diametru_nu_cantitate' ELSE 'unitate_incompatibila' END,
                                'antet_coloana', v_ant, 'antet_um', v_antum, 'valoare_text', v_cel, 'um_text', v_um);
    END IF;
    v_num := public.fn_ofertare_numar_ro(v_cel);
    IF v_num ->> 'motiv' IS NOT NULL THEN
      RETURN jsonb_build_object('verificare', CASE WHEN v_num ->> 'motiv' = 'format_numeric_ambiguu' THEN 'numar_ambiguu' ELSE 'tipar_necunoscut' END,
                                'antet_coloana', v_ant, 'antet_um', v_antum, 'valoare_text', v_cel, 'um_text', v_um);
    END IF;
    RETURN jsonb_build_object('verificare', 'ok', 'valoare', (v_num ->> 'valoare')::numeric * (v_umj ->> 'factor')::numeric, 'um_canonica', v_umj ->> 'um',
                              'antet_coloana', v_ant, 'antet_um', v_antum, 'valoare_text', v_cel, 'um_text', v_um);
  END IF;
  -- text liber, în trepte
  v_frag := p_dovada ->> 'fragment';
  IF coalesce(v_frag, '') = '' OR strpos(v_text, v_frag) = 0 THEN RETURN jsonb_build_object('verificare', 'fragment_lipsa'); END IF;
  SELECT string_agg('(?:' || tipar || ')', '|' ORDER BY length(tipar) DESC, tipar) INTO v_kw FROM public.ofertare_tipare_cantitate WHERE fel = 'cuvant_cheie' AND activ;
  m := regexp_match(public.fn_ofertare_masura_norm(v_frag),
         '\m(?:' || v_kw || ')[ ]?[:=]?[ ]?(?:(dn|' || chr(248) || '|pn|sdr|de)[ ]?)?([0-9][0-9.,' || c_nbsp || ']*)[ ' || c_nbsp || ']?([a-z.]+)\M');
  IF m IS NULL THEN RETURN jsonb_build_object('verificare', 'tipar_necunoscut'); END IF;
  m[2] := rtrim(m[2], '., ' || c_nbsp);
  IF m[1] IS NOT NULL OR m[3] = 'mm' THEN RETURN jsonb_build_object('verificare', 'diametru_nu_cantitate', 'valoare_text', m[2], 'um_text', m[3]); END IF;
  v_umj := public.fn_ofertare_um_canonica(m[3], v_el);
  IF v_umj ->> 'motiv' IS NOT NULL THEN RETURN jsonb_build_object('verificare', 'unitate_incompatibila', 'valoare_text', m[2], 'um_text', m[3]); END IF;
  v_num := public.fn_ofertare_numar_ro(m[2]);
  IF v_num ->> 'motiv' = 'format_numeric_ambiguu' THEN RETURN jsonb_build_object('verificare', 'numar_ambiguu', 'valoare_text', m[2], 'um_text', m[3]); END IF;
  IF v_num ->> 'motiv' IS NOT NULL THEN RETURN jsonb_build_object('verificare', 'tipar_necunoscut', 'valoare_text', m[2], 'um_text', m[3]); END IF;
  IF NOT (v_num ->> 'intreg')::boolean THEN RETURN jsonb_build_object('verificare', 'numar_neintreg', 'valoare_text', m[2], 'um_text', m[3]); END IF;
  RETURN jsonb_build_object('verificare', 'ok', 'valoare', (v_num ->> 'valoare')::numeric * (v_umj ->> 'factor')::numeric, 'um_canonica', v_umj ->> 'um',
                            'antet_coloana', NULL, 'antet_um', NULL, 'valoare_text', m[2], 'um_text', m[3]);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_verifica(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 8. Fotografia surselor, feliile autoritative, contextul, RPC-urile edge (service_role) și UI (authenticated) ──────────────────────
-- 8a. încercarea autoritativă a fiecărei felii logice (decizia 8): DISTINCT ON (felie_nr) cu încercarea maximă; incercari = numărul încercărilor;
--     obs_atribuibile = NOT (incercari > 1 AND există observații pe (extragere, felie)) — observațiile nu sunt legate de încercare
CREATE FUNCTION public.fn_ofertare_masura_felii_autoritative(p_extragere_id bigint)
RETURNS TABLE (felie_id bigint, felie_nr integer, incercare integer, incercari integer, de_la integer, pana_la integer, stare text, obs_numar integer, obs_atribuibile boolean)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $f$ WITH f AS (SELECT DISTINCT ON (x.felie_nr) x.id, x.felie_nr, x.incercare, x.de_la, x.pana_la, x.stare
                    FROM public.ofertare_cant_felii x WHERE x.extragere_id = p_extragere_id ORDER BY x.felie_nr, x.incercare DESC),
            n AS (SELECT x.felie_nr, count(*)::int AS incercari FROM public.ofertare_cant_felii x WHERE x.extragere_id = p_extragere_id GROUP BY x.felie_nr),
            o AS (SELECT y.felie_nr, count(*)::int AS obs_numar FROM public.ofertare_cant_obs y WHERE y.extragere_id = p_extragere_id GROUP BY y.felie_nr)
       SELECT f.id, f.felie_nr, f.incercare, n.incercari, f.de_la, f.pana_la, f.stare, coalesce(o.obs_numar, 0), NOT (n.incercari > 1 AND coalesce(o.obs_numar, 0) > 0)
         FROM f JOIN n ON n.felie_nr = f.felie_nr LEFT JOIN o ON o.felie_nr = f.felie_nr ORDER BY f.felie_nr $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_felii_autoritative(bigint) FROM PUBLIC, anon, authenticated, service_role;
-- paginile unui document NEacoperite de feliile `gata` ale încercărilor autoritative (o pagină e acoperită dacă o felie gata o cuprinde întreagă)
CREATE FUNCTION public.fn_ofertare_masura_pagini_neacoperite(p_text text, p_extragere_id bigint) RETURNS integer[]
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $f$ WITH p AS (SELECT n, regexp_instr(coalesce(p_text, ''), chr(10214) || 'PAGINA[ ]*' || n || chr(10215)) AS s FROM generate_series(1, public.fn_ofertare_masura_pagini(p_text)) n),
            q AS (SELECT n, CASE WHEN s = 0 AND n = 1 THEN 1 ELSE s END AS s,
                         coalesce((SELECT min(p2.s) FROM p p2 WHERE p2.s > p.s), length(coalesce(p_text, '')) + 1) AS e FROM p)
       SELECT coalesce(array_agg(q.n ORDER BY q.n), '{}') FROM q
        WHERE q.s = 0 OR p_extragere_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM public.fn_ofertare_masura_felii_autoritative(p_extragere_id) f WHERE f.stare = 'gata' AND f.de_la <= q.s - 1 AND f.pana_la >= q.e - 1) $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_pagini_neacoperite(text, bigint) FROM PUBLIC, anon, authenticated, service_role;
-- 8b. fotografia surselor (decizia 8): TOATE intrările clasificării, agregării și reconstruirii rolurilor; sha = sha256 peste tot; orice schimbare
--     (cantitate, revizie, text, document adăugat / șters, lot, prag, plafon, extragere nouă devenită autoritativă, decizie de rol) = alt sha
CREATE FUNCTION public.fn_ofertare_semnale_fotografie(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic record; v_prag numeric; v_plafon integer; v_docs jsonb; v_cant text; v_dl text; v_foto jsonb;
BEGIN
  SELECT l.id, l.stare_loturi INTO v_lic FROM public.ofertare_licitatii l WHERE l.id = p_licitatie_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CM_LICITATIE: licitatie inexistenta' USING ERRCODE = 'P0001'; END IF;
  SELECT s.prag, s.plafon_pagini INTO v_prag, v_plafon FROM public.ofertare_cantitati_setari s WHERE s.licitatie_id = p_licitatie_id;
  v_prag := coalesce(v_prag, 0.05); v_plafon := coalesce(v_plafon, 200);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'tip', d.tip, 'nume_original', d.nume_original, 'revizie', coalesce(d.revizie, '-'), 'sha', s.sha,
             'pagini', s.pagini, 'pagini_necitite', coalesce((SELECT jsonb_agg(x ORDER BY x) FROM unnest(d.pagini_necitite) x), '[]'::jsonb), 'lot_stare', d.lot_stare,
             'extragere_id', e.id, 'extractor_id', e.extractor_id, 'felii_distincte', coalesce(fa.n, 0), 'felii_sha', fa.sha, 'obs_sha', oa.sha, 'decizii_sha', da.sha) ORDER BY d.id), '[]'::jsonb)
    INTO v_docs
    FROM public.ofertare_documente_atribuire d
    CROSS JOIN LATERAL (SELECT encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex') AS sha, public.fn_ofertare_masura_pagini(d.text_extras) AS pagini) s
    LEFT JOIN LATERAL (SELECT e.id, e.extractor_id FROM public.ofertare_cant_extrageri e WHERE e.document_id = d.id AND e.doc_sha256 = s.sha AND e.stare = 'gata' ORDER BY e.id DESC LIMIT 1) e ON true
    LEFT JOIN LATERAL (SELECT count(*)::int AS n, encode(sha256(convert_to(coalesce(string_agg(f.felie_nr || '|' || f.incercare || '|' || f.incercari || '|' || f.de_la || '|' || f.pana_la || '|' || f.stare || '|' || f.obs_atribuibile, ';' ORDER BY f.felie_nr), ''), 'UTF8')), 'hex') AS sha
                         FROM public.fn_ofertare_masura_felii_autoritative(e.id) f) fa ON e.id IS NOT NULL
    LEFT JOIN LATERAL (SELECT encode(sha256(convert_to(coalesce(string_agg(o.id || '|' || o.hash_rand, ';' ORDER BY o.id), ''), 'UTF8')), 'hex') AS sha
                         FROM public.ofertare_cant_obs o WHERE o.extragere_id = e.id) oa ON e.id IS NOT NULL
    LEFT JOIN LATERAL (SELECT encode(sha256(convert_to(coalesce(string_agg(z.id || '|' || coalesce(z.rol, '') || '|' || coalesce(z.sectiune, '') || '|' || z.decizie, ';' ORDER BY z.id), ''), 'UTF8')), 'hex') AS sha
                         FROM public.ofertare_cant_doc_decizii z WHERE z.document_id = d.id AND z.doc_sha256 = s.sha AND z.decizie IN ('rol_confirmat', 'nu_e_sursa_cantitativa')
                          AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii rv WHERE rv.revoca_id = z.id)) da ON true
   WHERE d.licitatie_id = p_licitatie_id;
  SELECT encode(sha256(convert_to(coalesce(string_agg(q.id || '|' || coalesce(q.cantitate::text, '') || '|' || coalesce(q.um, '') || '|' || coalesce(q.status, '') || '|' || coalesce(q.lot_domeniu, '')
             || '|' || coalesce(q.lot_nr::text, '') || '|' || coalesce(q.obiect, '') || '|' || coalesce(q.denumire, '') || '|' || coalesce(q.cod_articol, '') || '|' || coalesce(q.specificatii, '')
             || '|' || coalesce(q.surse_document_ids::text, ''), ';' ORDER BY q.id), ''), 'UTF8')), 'hex')
    INTO v_cant FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id;
  SELECT encode(sha256(convert_to(coalesce(string_agg(dl.document_id || '|' || dl.lot_nr, ';' ORDER BY dl.document_id, dl.lot_nr), ''), 'UTF8')), 'hex')
    INTO v_dl FROM public.ofertare_document_loturi dl JOIN public.ofertare_documente_atribuire d ON d.id = dl.document_id WHERE d.licitatie_id = p_licitatie_id;
  v_foto := jsonb_build_object('licitatie_id', p_licitatie_id, 'documente', v_docs, 'document_loturi_sha', v_dl, 'stare_loturi', v_lic.stare_loturi,
                               'cantitati_sha', v_cant, 'prag', v_prag, 'plafon', v_plafon, 'v', 'surse_v1');
  RETURN v_foto || jsonb_build_object('sha', encode(sha256(convert_to(v_foto::text, 'UTF8')), 'hex'));
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnale_fotografie(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnale_fotografie(bigint) TO service_role;
COMMENT ON FUNCTION public.fn_ofertare_semnale_fotografie(bigint) IS 'Ofertare (edge, service_role): fotografia surselor unei licitatii (documente cu sha-ul textului, extragerea autoritativa, feliile, observatiile, deciziile de rol; cantitatile; loturile; prag; plafon) si sha-ul ei — orice schimbare = alt sha. 20270112a.';
-- 8c. contextul reconstruirii rolurilor, legat de fotografie (decizia 17): un document pe apel; fotografia schimbată = refuz
CREATE FUNCTION public.fn_ofertare_semnale_context(p_licitatie_id bigint, p_fotografie_sha text, p_document_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_foto jsonb; d record; v_sha text; v_dec jsonb; v_dec_sha text;
BEGIN
  v_foto := public.fn_ofertare_semnale_fotografie(p_licitatie_id);
  IF v_foto ->> 'sha' IS DISTINCT FROM p_fotografie_sha THEN RETURN jsonb_build_object('refuz', 'fotografie_schimbata'); END IF;
  SELECT x.id, x.text_extras, x.nume_original, x.tip INTO d FROM public.ofertare_documente_atribuire x WHERE x.id = p_document_id AND x.licitatie_id = p_licitatie_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('refuz', 'document_necunoscut'); END IF;
  v_sha := encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'rol', z.rol, 'sectiune', z.sectiune, 'decizie', z.decizie) ORDER BY z.id), '[]'::jsonb),
         encode(sha256(convert_to(coalesce(string_agg(z.id || '|' || coalesce(z.rol, '') || '|' || coalesce(z.sectiune, '') || '|' || z.decizie, ';' ORDER BY z.id), ''), 'UTF8')), 'hex')
    INTO v_dec, v_dec_sha
    FROM public.ofertare_cant_doc_decizii z WHERE z.document_id = d.id AND z.doc_sha256 = v_sha AND z.decizie IN ('rol_confirmat', 'nu_e_sursa_cantitativa')
     AND NOT EXISTS (SELECT 1 FROM public.ofertare_cant_doc_decizii rv WHERE rv.revoca_id = z.id);
  RETURN jsonb_build_object('document_id', d.id, 'text_extras', d.text_extras, 'nume_original', d.nume_original, 'tip', d.tip, 'sha', v_sha, 'decizii', v_dec, 'decizii_sha', v_dec_sha);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnale_context(bigint, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnale_context(bigint, text, bigint) TO service_role;
-- 8d. feliile logice ale extragerilor din fotografie, keyset pe (extragere_id, felie_nr), ≤ 200 pe pagină; obs = [] când nu sunt atribuibile
CREATE FUNCTION public.fn_ofertare_semnale_felii(p_licitatie_id bigint, p_extrageri bigint[], p_dupa_extragere bigint, p_dupa_felie integer, p_limita integer)
RETURNS TABLE (document_id bigint, extragere_id bigint, felie_nr integer, incercare integer, incercari integer, de_la integer, pana_la integer, stare text, obs_numar integer, obs_atribuibile boolean, obs jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT e.document_id, e.id, f.felie_nr, f.incercare, f.incercari, f.de_la, f.pana_la, f.stare, f.obs_numar, f.obs_atribuibile,
              CASE WHEN f.obs_atribuibile THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'felie_nr', o.felie_nr, 'pozitie_dovedita', o.pozitie_dovedita, 'cantitate_offset', o.cantitate_offset,
                                                             'hash_rand', o.hash_rand, 'e_total', o.e_total, 'e_subtotal', o.e_subtotal) ORDER BY o.id)
                                                   FROM public.ofertare_cant_obs o WHERE o.extragere_id = e.id AND o.felie_nr = f.felie_nr), '[]'::jsonb)
                   ELSE '[]'::jsonb END
         FROM public.ofertare_cant_extrageri e
        CROSS JOIN LATERAL public.fn_ofertare_masura_felii_autoritative(e.id) f
        WHERE e.licitatie_id = p_licitatie_id AND e.id = ANY (coalesce(p_extrageri, '{}'))
          AND (e.id, f.felie_nr) > (coalesce(p_dupa_extragere, -1), coalesce(p_dupa_felie, -1))
        ORDER BY e.id, f.felie_nr
        LIMIT least(greatest(coalesce(p_limita, 200), 1), 200) $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnale_felii(bigint, bigint[], bigint, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnale_felii(bigint, bigint[], bigint, integer, integer) TO service_role;
-- 8e. predicatul unic al rezolvării prin răspuns (decizia 16): documentul există, e al licitației, revizia e cea reținută
CREATE FUNCTION public.fn_ofertare_semnal_rezolvat(s public.ofertare_cantitati_semnale) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$ SELECT s.rezolvare IS NOT NULL AND (s.rezolvare ->> 'document_id') ~ '^[0-9]{1,18}$'
          AND EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = (s.rezolvare ->> 'document_id')::bigint AND d.licitatie_id = s.licitatie_id
                        AND coalesce(d.revizie, '-') = s.rezolvare ->> 'revizie') $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnal_rezolvat(public.ofertare_cantitati_semnale) FROM PUBLIC, anon, authenticated, service_role;
-- ciorna „liberă” = propunere needitată (gen_<md5 text> în sursa) și neaprobată (fără reconfirmare): singura pe care sistemul o rescrie / retrage
CREATE FUNCTION public.fn_ofertare_semnal_ciorna_libera(c public.ofertare_clarificari) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT c.status = 'propunere' AND NOT coalesce(c.baza_generare, '{}'::jsonb) ? 'text_editat_de' AND NOT coalesce(c.baza_generare, '{}'::jsonb) ? 'reconfirmare'
          AND position(',gen_' || left(md5(coalesce(c.intrebare, '')), 12) || ',' IN ',' || coalesce(c.sursa, '') || ',') > 0 $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnal_ciorna_libera(public.ofertare_clarificari) FROM PUBLIC, anon, authenticated, service_role;
-- semnalul (măsura) unei componente: UPSERT pe identitate, cu evaluarea în curs; necunoscut = element 'necunoscut' / clasa 'necunoscuta'
CREATE FUNCTION public.fn_ofertare_semnal_upsert(p_licitatie_id bigint, p_evaluare_id bigint, p_lot_nr integer, p_obiect_cheie text, p_element text, p_clasa text, p_um_canonica text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp
AS $f$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.ofertare_cantitati_semnale (licitatie_id, lot_nr, obiect_cheie, element, clasa, um_canonica, identitate, evaluare_in_curs_id)
  VALUES (p_licitatie_id, p_lot_nr, p_obiect_cheie, p_element, p_clasa, p_um_canonica,
          public.fn_ofertare_masura_identitate(p_licitatie_id, p_lot_nr, p_obiect_cheie, p_element, p_clasa, p_um_canonica), p_evaluare_id)
  ON CONFLICT (licitatie_id, identitate) DO UPDATE SET evaluare_in_curs_id = EXCLUDED.evaluare_in_curs_id
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnal_upsert(bigint, bigint, integer, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
-- numărul în text (RO): fără zecimale inutile, virgulă la zecimale
CREATE FUNCTION public.fn_ofertare_masura_numar_text(p numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $f$ SELECT replace(trim_scale(p)::text, '.', ',') $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masura_numar_text(numeric) FROM PUBLIC, anon, authenticated, service_role;
-- textul ciornei auto_surse_* (decizia 12): generat în SQL, fix, din componentele ok ale evaluării; fără nume de firmă
CREATE FUNCTION public.fn_ofertare_semnal_text(p_semnal_id bigint, p_evaluare_id bigint) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $f$
DECLARE s record; v_a text; v_b text; v_doc_b bigint; v_el text;
BEGIN
  SELECT * INTO s FROM public.ofertare_cantitati_semnale x WHERE x.id = p_semnal_id;
  v_el := replace(s.element, '_', ' ');
  SELECT string_agg(format('- în documentul „%s” (pagina %s, rândul „%s”): %s %s', d.nume_original, m.pagina, m.rand, public.fn_ofertare_masura_numar_text(m.valoare), m.um_canonica), chr(10) ORDER BY m.cantitate_id)
    INTO v_a
    FROM (SELECT DISTINCT ON (x.cantitate_id) x.* FROM public.ofertare_cantitati_masuratori x WHERE x.semnal_id = p_semnal_id AND x.evaluare_id = p_evaluare_id AND x.parte = 'a' AND x.verificare = 'ok'
           ORDER BY x.cantitate_id, x.id) m
    JOIN public.ofertare_documente_atribuire d ON d.id = m.document_id;
  v_doc_b := nullif(s.inventar ->> 'document_b', '')::bigint;
  SELECT string_agg(format('- în documentul „%s” (pagina %s, fragmentul „%s”): %s %s', d.nume_original, m.pagina, coalesce(m.fragment, m.rand), public.fn_ofertare_masura_numar_text(m.valoare), m.um_canonica), chr(10) ORDER BY m.pagina, m.obs_id)
    INTO v_b
    FROM public.ofertare_cantitati_masuratori m JOIN public.ofertare_documente_atribuire d ON d.id = m.document_id
   WHERE m.semnal_id = p_semnal_id AND m.evaluare_id = p_evaluare_id AND m.parte = 'b' AND m.verificare = 'ok' AND m.document_id = v_doc_b;
  RETURN 'Solicitare de clarificare — cantități diferite între documentele documentației de atribuire' || chr(10) || chr(10)
      || format('Pentru elementul „%s”%s%s, documentele documentației de atribuire indică cantități diferite:', v_el,
                CASE WHEN s.obiect_cheie <> '*' THEN ' (obiectul „' || s.obiect_cheie || '”)' ELSE '' END,
                CASE WHEN s.lot_nr IS NOT NULL THEN ' (lotul ' || s.lot_nr || ')' ELSE '' END) || chr(10)
      || coalesce(v_a, '- (lista de cantități: fără rând dovedit)') || chr(10)
      || format('  Total în lista de cantități: %s %s', public.fn_ofertare_masura_numar_text(s.valoare_a), s.um_canonica) || chr(10)
      || coalesce(v_b, '- (document: fără rând dovedit)') || chr(10)
      || format('  Total în document: %s %s', public.fn_ofertare_masura_numar_text(s.valoare_b), s.um_canonica) || chr(10) || chr(10)
      || 'Vă rugăm să precizați cantitatea care stă la baza ofertei.';
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnal_text(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;
-- 8f. setările pe licitație (UI, drept de decizie); limitele din CHECK
CREATE FUNCTION public.fn_ofertare_semnale_setari(p_licitatie_id bigint, p_prag numeric, p_plafon_pagini integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CM_FARA_DREPT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.ofertare_licitatii l WHERE l.id = p_licitatie_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CM_LICITATIE: licitatie inexistenta' USING ERRCODE = 'P0001'; END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id), false) THEN RAISE EXCEPTION 'CM_FARA_DREPT: setarile cer drept de decizie pe licitatie' USING ERRCODE = '42501'; END IF;
  IF p_prag IS NULL OR p_plafon_pagini IS NULL OR NOT (p_prag BETWEEN 0.001 AND 0.5) OR NOT (p_plafon_pagini BETWEEN 10 AND 2000) THEN
    RAISE EXCEPTION 'CM_SETARI: pragul trebuie sa fie intre 0,001 si 0,5, plafonul intre 10 si 2000 de pagini' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ofertare_cantitati_setari (licitatie_id, prag, plafon_pagini, setat_de, setat_la) VALUES (p_licitatie_id, p_prag, p_plafon_pagini, auth.uid(), now())
  ON CONFLICT (licitatie_id) DO UPDATE SET prag = EXCLUDED.prag, plafon_pagini = EXCLUDED.plafon_pagini, setat_de = EXCLUDED.setat_de, setat_la = EXCLUDED.setat_la
  RETURNING * INTO r;
  RETURN jsonb_build_object('ok', true, 'licitatie_id', r.licitatie_id, 'prag', r.prag, 'plafon_pagini', r.plafon_pagini);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnale_setari(bigint, numeric, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnale_setari(bigint, numeric, integer) TO authenticated;
-- 8g. legarea răspunsului Autorității (spec §3.6): omul confirmă semnalul + valoarea reținută; drept de decizie reverificat DUPĂ lock-uri (L09)
-- lock-urile: (1) licitatia FOR SHARE → (2) documentul FOR SHARE → (4) semnalul FOR UPDATE → (5) ciorna FOR UPDATE; fără advisory (decizia din plan)
CREATE FUNCTION public.fn_ofertare_semnal_raspuns_leaga(p_semnal_id bigint, p_document_id bigint, p_valoare numeric) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE s public.ofertare_cantitati_semnale%ROWTYPE; d record; c public.ofertare_clarificari%ROWTYPE; v_lic bigint; v_cl text := NULL;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CM_FARA_DREPT: autentificare necesara' USING ERRCODE = '42501'; END IF;
  SELECT x.licitatie_id INTO v_lic FROM public.ofertare_cantitati_semnale x WHERE x.id = p_semnal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CM_SEMNAL: semnal inexistent' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.ofertare_licitatii l WHERE l.id = v_lic FOR SHARE;
  SELECT x.id, x.licitatie_id, x.tip, x.revizie INTO d FROM public.ofertare_documente_atribuire x WHERE x.id = p_document_id FOR SHARE;
  SELECT * INTO s FROM public.ofertare_cantitati_semnale x WHERE x.id = p_semnal_id FOR UPDATE;
  SELECT * INTO c FROM public.ofertare_clarificari x WHERE x.licitatie_id = s.licitatie_id AND x.cheie = 'auto_surse_' || s.identitate FOR UPDATE;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(s.licitatie_id), false) THEN RAISE EXCEPTION 'CM_FARA_DREPT: legarea raspunsului cere drept de decizie pe licitatie' USING ERRCODE = '42501'; END IF;
  IF d.id IS NULL OR d.licitatie_id <> s.licitatie_id OR d.tip IS DISTINCT FROM 'raspuns_clarificare' THEN
    RAISE EXCEPTION 'CM_DOCUMENT: documentul trebuie sa fie un raspuns la clarificari al aceleiasi licitatii' USING ERRCODE = 'P0001';
  END IF;
  IF p_valoare IS NULL OR p_valoare <> p_valoare OR p_valoare IN ('Infinity'::numeric, '-Infinity'::numeric) OR p_valoare < 0 THEN
    RAISE EXCEPTION 'CM_VALOARE: valoarea retinuta e obligatorie, finita si >= 0' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ofertare_cantitati_semnale SET rezolvare = jsonb_build_object('document_id', d.id, 'revizie', coalesce(d.revizie, '-'), 'valoare', p_valoare, 'de', auth.uid(), 'la', now())
   WHERE id = s.id;
  IF c.id IS NOT NULL AND public.fn_ofertare_semnal_ciorna_libera(c) THEN
    UPDATE public.ofertare_clarificari SET status = 'retrasa', updated_at = now(),
           baza_generare = coalesce(baza_generare, '{}'::jsonb) || jsonb_build_object('retrasa_de', 'sistem', 'retrasa_motiv', 'rezolvat_de_raspuns', 'retrasa_la', now())
     WHERE id = c.id;
    v_cl := 'retrasa';
  ELSIF c.id IS NOT NULL THEN v_cl := 'neatinsa';
  END IF;
  RETURN jsonb_build_object('ok', true, 'semnal_id', s.id, 'clarificare', v_cl);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnal_raspuns_leaga(bigint, bigint, numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnal_raspuns_leaga(bigint, bigint, numeric) TO authenticated;
-- 8h. lista semnalelor (UI): doar cu acces Ofertare; actual = sursele de acum = cele evaluate; măsurătorile DOAR ale evaluării publicate
CREATE FUNCTION public.fn_ofertare_semnale_lista(p_licitatie_id bigint) RETURNS TABLE (semnal jsonb, rezolvat boolean, actual boolean, in_curs boolean, masuratori jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_sha text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(), false) THEN RAISE EXCEPTION 'CM_FARA_DREPT: fara acces la Ofertare' USING ERRCODE = '42501'; END IF;
  v_sha := public.fn_ofertare_semnale_fotografie(p_licitatie_id) ->> 'sha';
  RETURN QUERY
  SELECT to_jsonb(s), public.fn_ofertare_semnal_rezolvat(s), s.surse_sha IS NOT DISTINCT FROM v_sha, s.evaluare_in_curs_id IS NOT NULL,
         coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.parte, m.id) FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = s.evaluare_id), '[]'::jsonb)
    FROM public.ofertare_cantitati_semnale s WHERE s.licitatie_id = p_licitatie_id ORDER BY s.id;
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnale_lista(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnale_lista(bigint) TO authenticated;

-- 8i. propunerea (edge, service_role): măsurătorile unei evaluări noi, pe fotografia pe care a lucrat edge-ul (deciziile 2, 4–6, 8, 15, 18)
-- Lock-urile (L01, L06): (0) advisory 'ofertare_cantitati_semnale:<licitatie>' → (1) ofertare_licitatii FOR SHARE → (2) ofertare_documente_atribuire
-- FOR SHARE ORDER BY id → (3) ofertare_cantitati FOR SHARE ORDER BY id → (4) ofertare_cantitati_semnale FOR UPDATE ORDER BY id. Nu atinge ofertare_clarificari.
CREATE FUNCTION public.fn_ofertare_masuratori_propune(p_licitatie_id bigint, p_token uuid, p_fotografie jsonb, p_pagini jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic record; v_foto jsonb; v_ev bigint; v_vechi bigint[]; v_lim jsonb; r record; o record; v_cl jsonb; v_lot jsonb; v_um text; v_ob text; v_sem bigint;
        v_ver text; v_dov jsonb; v_tip text; v_dn numeric[]; v_masura text; v_ignorate jsonb; v_semnale jsonb; v_obiecte text[]; v_o text;
        v_el text; v_cls text; v_nat text; v_cunoscut boolean; v_doc_id bigint; v_doc_rev text; v_doc_text text; v_doc_sha text; v_g_pag integer; v_g_linie text; v_g_tok text;
BEGIN
  IF p_licitatie_id IS NULL OR p_token IS NULL OR jsonb_typeof(p_fotografie) IS DISTINCT FROM 'object' OR jsonb_typeof(p_pagini) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CM_PARAMETRI: licitatie, token, fotografie (obiect) si pagini (obiect) sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ofertare_cantitati_semnale:' || p_licitatie_id, 0));
  SELECT l.id, l.stare_loturi INTO v_lic FROM public.ofertare_licitatii l WHERE l.id = p_licitatie_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CM_LICITATIE: licitatie inexistenta' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM (SELECT d.id FROM public.ofertare_documente_atribuire d WHERE d.licitatie_id = p_licitatie_id ORDER BY d.id FOR SHARE) x;
  PERFORM 1 FROM (SELECT q.id FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id ORDER BY q.id FOR SHARE) x;
  PERFORM 1 FROM (SELECT s.id FROM public.ofertare_cantitati_semnale s WHERE s.licitatie_id = p_licitatie_id ORDER BY s.id FOR UPDATE) x;
  -- (a) fotografia DE ACUM = cea pe care a lucrat edge-ul; altfel nimic scris
  v_foto := public.fn_ofertare_semnale_fotografie(p_licitatie_id);
  IF p_fotografie ->> 'sha' IS DISTINCT FROM v_foto ->> 'sha' THEN RETURN jsonb_build_object('refuz', 'evaluare_depasita', 'sha_acum', v_foto ->> 'sha'); END IF;
  -- (b) evaluarile in_curs mai vechi → depasita (masuratorile lor sterse sub marcaj; semnalele lor eliberate)
  SELECT array_agg(e.id) INTO v_vechi FROM public.ofertare_cantitati_evaluari e WHERE e.licitatie_id = p_licitatie_id AND e.stare = 'in_curs';
  IF v_vechi IS NOT NULL THEN
    PERFORM set_config('ofertare.masuratori_rpc', '1', true);
    DELETE FROM public.ofertare_cantitati_masuratori m WHERE m.evaluare_id = ANY (v_vechi);
    UPDATE public.ofertare_cantitati_evaluari e SET stare = 'depasita', inchisa_la = now() WHERE e.id = ANY (v_vechi);
    PERFORM set_config('ofertare.masuratori_rpc', '0', true);
    UPDATE public.ofertare_cantitati_semnale s SET evaluare_in_curs_id = NULL WHERE s.evaluare_in_curs_id = ANY (v_vechi);
  END IF;
  INSERT INTO public.ofertare_cantitati_evaluari (licitatie_id, token, surse_sha, fotografie, pagini) VALUES (p_licitatie_id, p_token, v_foto ->> 'sha', v_foto, p_pagini) RETURNING id INTO v_ev;
  -- (c) toate semnalele existente intra in evaluarea noua (CAS pe evaluare_in_curs_id IS NULL)
  UPDATE public.ofertare_cantitati_semnale s SET evaluare_in_curs_id = v_ev WHERE s.licitatie_id = p_licitatie_id AND s.evaluare_in_curs_id IS NULL;
  v_lim := public.fn_ofertare_masura_pagini_permise((SELECT coalesce(jsonb_agg(jsonb_build_object('id', x -> 'id', 'pagini', x -> 'pagini')), '[]'::jsonb) FROM jsonb_array_elements(v_foto -> 'documente') x),
                                                    (v_foto ->> 'plafon')::int);
  -- liniile documentelor-sursa ale pozitiilor F3 (o data), pentru dovada A
  DROP TABLE IF EXISTS cm_linii;
  CREATE TEMP TABLE cm_linii (document_id bigint, pagina integer, nr integer, linie text) ON COMMIT DROP;
  INSERT INTO cm_linii (document_id, pagina, nr, linie)
    SELECT d.id, pg.n, l.nr::int, l.linie
      FROM public.ofertare_documente_atribuire d
      CROSS JOIN LATERAL generate_series(1, public.fn_ofertare_masura_pagini(d.text_extras)) pg(n)
      CROSS JOIN LATERAL regexp_split_to_table(coalesce(public.fn_ofertare_masura_pagina(d.text_extras, pg.n), ''), chr(10)) WITH ORDINALITY l(linie, nr)
     WHERE d.licitatie_id = p_licitatie_id
       AND d.id IN (SELECT q.surse_document_ids[1] FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id AND q.surse_document_ids IS NOT NULL AND cardinality(q.surse_document_ids) > 0);
  -- (d) pozitiile F3 (partea A): clasificare in SQL, lot, obiect; componenta A se scrie MEREU (pe obiect SI pe nivelul lucrarii '*')
  FOR r IN SELECT q.* FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id AND q.status IS DISTINCT FROM 'retrasa' ORDER BY q.id LOOP
    v_tip := CASE WHEN public.fn_ofertare_masura_norm(r.denumire) ~ 'protect' THEN 'protectie' WHEN public.fn_ofertare_masura_norm(r.denumire) ~ 'bransament' THEN 'bransament'
                  WHEN public.fn_ofertare_masura_norm(r.denumire) ~ '(conduct|teav|tub)' THEN 'conducta' ELSE 'alt' END;
    v_dn := public.fn_ofertare_masura_dn(coalesce(r.denumire, '') || ' ' || coalesce(r.specificatii, ''));
    v_um := public.fn_ofertare_um_canonica(r.um, NULL) ->> 'um';
    v_masura := CASE WHEN v_um = 'm' THEN 'lungime' ELSE 'alt' END;
    v_cl := public.fn_ofertare_masura_clasifica(r.denumire, r.um, v_tip, v_dn, NULL, v_masura, 'f3');
    v_lot := public.fn_ofertare_masura_lot(r.lot_domeniu, r.lot_nr, v_lic.stare_loturi);
    v_ob := nullif(public.fn_ofertare_masura_norm(r.obiect), '');
    v_cunoscut := (v_cl ->> 'cunoscut')::boolean AND (v_lot ->> 'cunoscut')::boolean;
    -- dovada A: randul din text_extras al primei surse care contine codul articolului (sau denumirea) si un token egal cu cantitatea
    v_doc_id := NULL; v_doc_rev := NULL; v_doc_text := NULL; v_doc_sha := NULL; v_dov := NULL; v_ver := 'fara_sursa'; v_g_pag := NULL; v_g_linie := NULL; v_g_tok := NULL;
    IF r.surse_document_ids IS NOT NULL AND cardinality(r.surse_document_ids) > 0 THEN
      SELECT d.id, coalesce(d.revizie, '-'), d.text_extras, encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex')
        INTO v_doc_id, v_doc_rev, v_doc_text, v_doc_sha FROM public.ofertare_documente_atribuire d WHERE d.id = r.surse_document_ids[1] AND d.licitatie_id = p_licitatie_id;
      IF v_doc_id IS NOT NULL THEN
        v_ver := 'nedovedit';
        -- candidatii: randurile cu ancora si un token egal cu cantitatea (de la dreapta spre stanga: coloana cantitatii e la dreapta, „003” s-ar citi ca 3);
        -- primul care trece verificarea deterministă decide; altfel ramane prima verificare picată (vizibila cu motivul ei)
        FOR o IN SELECT l.pagina, l.linie, t.tok
                   FROM cm_linii l
                   CROSS JOIN LATERAL unnest(regexp_split_to_array(btrim(regexp_replace(l.linie, '[ ' || chr(9) || ']+', ' ', 'g')), ' ')) WITH ORDINALITY t(tok, poz)
                  WHERE l.document_id = v_doc_id
                    AND CASE WHEN nullif(btrim(r.cod_articol), '') IS NOT NULL THEN strpos(l.linie, btrim(r.cod_articol)) > 0
                             ELSE strpos(public.fn_ofertare_masura_norm(l.linie), public.fn_ofertare_masura_norm(r.denumire)) > 0 END
                    AND r.cantitate IS NOT NULL AND (public.fn_ofertare_numar_ro(t.tok) ->> 'valoare')::numeric = r.cantitate
                  ORDER BY l.pagina, l.nr, t.poz DESC LOOP
          v_dov := public.fn_ofertare_masura_verifica(v_doc_text, jsonb_build_object('pagina', o.pagina, 'fel_dovada', 'tabel', 'rand', o.linie, 'celula', o.tok, 'element', v_cl ->> 'element'));
          IF v_g_linie IS NULL OR v_dov ->> 'verificare' = 'ok' THEN v_g_pag := o.pagina; v_g_linie := o.linie; v_g_tok := o.tok; v_ver := v_dov ->> 'verificare'; END IF;
          IF v_ver = 'ok' THEN EXIT; END IF;
        END LOOP;
        IF v_ver <> 'ok' AND v_g_linie IS NOT NULL THEN
          v_dov := public.fn_ofertare_masura_verifica(v_doc_text, jsonb_build_object('pagina', v_g_pag, 'fel_dovada', 'tabel', 'rand', v_g_linie, 'celula', v_g_tok, 'element', v_cl ->> 'element'));
        END IF;
      END IF;
    END IF;
    IF NOT (v_lot ->> 'cunoscut')::boolean THEN v_ver := 'lot_necunoscut'; END IF;
    IF NOT (v_cl ->> 'cunoscut')::boolean THEN v_ver := 'neclasificat'; END IF;
    v_el := CASE WHEN v_cunoscut THEN v_cl ->> 'element' ELSE 'necunoscut' END;
    v_cls := CASE WHEN v_cunoscut THEN v_cl ->> 'clasa' ELSE 'necunoscuta' END;
    v_nat := CASE WHEN v_cunoscut THEN v_cl ->> 'natura' END;
    v_obiecte := CASE WHEN v_ob IS NULL THEN ARRAY['*'] ELSE ARRAY[v_ob, '*'] END;
    FOREACH v_o IN ARRAY v_obiecte LOOP
      v_sem := public.fn_ofertare_semnal_upsert(p_licitatie_id, v_ev, (v_lot ->> 'lot')::int, v_o, v_el, v_cls, v_cl ->> 'um_canonica');
      INSERT INTO public.ofertare_cantitati_masuratori (licitatie_id, evaluare_id, semnal_id, parte, cantitate_id, document_id, revizie, doc_sha256, pagina, fel_dovada, rand, celula,
                                                        antet_coloana, antet_um, valoare_text, um_text, valoare, um_canonica, natura, verificare)
      VALUES (p_licitatie_id, v_ev, v_sem, 'a', r.id, v_doc_id, v_doc_rev, v_doc_sha,
              CASE WHEN v_g_linie IS NOT NULL THEN v_g_pag END, CASE WHEN v_g_linie IS NOT NULL THEN 'tabel' END, v_g_linie, v_g_tok,
              v_dov ->> 'antet_coloana', v_dov ->> 'antet_um', coalesce(v_dov ->> 'valoare_text', v_g_tok), v_dov ->> 'um_text',
              CASE WHEN v_ver = 'ok' THEN (v_dov ->> 'valoare')::numeric END, CASE WHEN v_ver = 'ok' THEN v_dov ->> 'um_canonica' END, v_nat, v_ver);
    END LOOP;
  END LOOP;
  -- (e) observatiile partii B: EXACT extragerea autoritativa din fotografie, rolurile atr / cs / memoriu / plansa / raspuns, TOATE clasificate si scrise
  --     (e1) felie cu obs_atribuibile = false → neatribuibil; (e2) pagina nepermisa de plafon → pagina_nepermisa; (e3) nedovedita → nedovedit; (e4) verificata
  FOR o IN SELECT ob.*, fa.obs_atribuibile, (x ->> 'id')::bigint AS doc_id, x ->> 'revizie' AS doc_rev, x ->> 'sha' AS doc_sha, d.text_extras,
                  coalesce((SELECT (y ->> 'ultima_pagina_permisa')::int FROM jsonb_array_elements(v_lim -> 'limita') y WHERE (y ->> 'document_id')::bigint = (x ->> 'id')::bigint), 0) AS lim
             FROM jsonb_array_elements(v_foto -> 'documente') x
             JOIN public.ofertare_documente_atribuire d ON d.id = (x ->> 'id')::bigint
             JOIN public.ofertare_cant_obs ob ON ob.extragere_id = (x ->> 'extragere_id')::bigint
             LEFT JOIN LATERAL public.fn_ofertare_masura_felii_autoritative((x ->> 'extragere_id')::bigint) fa ON fa.felie_nr = ob.felie_nr
            WHERE x ->> 'extragere_id' IS NOT NULL AND ob.rol_sursa IN ('atr', 'cs', 'memoriu', 'plansa', 'raspuns')
            ORDER BY ob.id LOOP
    v_cl := public.fn_ofertare_masura_clasifica(o.denumire, o.um_norm, o.tip_lucrare, CASE WHEN cardinality(o.dn_mm) > 0 THEN o.dn_mm ELSE public.fn_ofertare_masura_dn(o.denumire) END,
                                                o.material, o.masura, o.rol_sursa);
    v_lot := public.fn_ofertare_masura_lot(o.lot_domeniu, o.lot_nr, v_lic.stare_loturi);
    v_ob := coalesce(nullif(public.fn_ofertare_masura_norm(o.obiect_cheie), ''), '*');
    v_cunoscut := (v_cl ->> 'cunoscut')::boolean AND (v_lot ->> 'cunoscut')::boolean;
    v_dov := NULL;
    IF o.obs_atribuibile IS FALSE THEN v_ver := 'neatribuibil';
    ELSIF o.pagina IS NOT NULL AND o.pagina > o.lim THEN v_ver := 'pagina_nepermisa';
    ELSIF o.pagina IS NULL OR NOT o.pozitie_dovedita THEN v_ver := 'nedovedit';
    ELSE
      v_dov := public.fn_ofertare_masura_verifica(o.text_extras, jsonb_build_object('pagina', o.pagina, 'fel_dovada', 'text', 'fragment', o.citat, 'element', v_cl ->> 'element'));
      v_ver := v_dov ->> 'verificare';
    END IF;
    IF v_ver NOT IN ('neatribuibil', 'pagina_nepermisa') THEN
      IF NOT (v_lot ->> 'cunoscut')::boolean THEN v_ver := 'lot_necunoscut'; END IF;
      IF NOT (v_cl ->> 'cunoscut')::boolean THEN v_ver := 'neclasificat'; END IF;
    END IF;
    v_el := CASE WHEN v_cunoscut THEN v_cl ->> 'element' ELSE 'necunoscut' END;
    v_cls := CASE WHEN v_cunoscut THEN v_cl ->> 'clasa' ELSE 'necunoscuta' END;
    v_sem := public.fn_ofertare_semnal_upsert(p_licitatie_id, v_ev, (v_lot ->> 'lot')::int, v_ob, v_el, v_cls, v_cl ->> 'um_canonica');
    INSERT INTO public.ofertare_cantitati_masuratori (licitatie_id, evaluare_id, semnal_id, parte, obs_id, document_id, revizie, doc_sha256, pagina, fel_dovada, fragment,
                                                      valoare_text, um_text, valoare, um_canonica, natura, e_total, e_subtotal, verificare)
    VALUES (p_licitatie_id, v_ev, v_sem, 'b', o.id, o.doc_id, o.doc_rev, o.doc_sha,
            CASE WHEN v_ver IN ('neatribuibil', 'pagina_nepermisa') THEN NULL ELSE o.pagina END, CASE WHEN v_ver IN ('neatribuibil', 'pagina_nepermisa') THEN NULL ELSE 'text' END,
            CASE WHEN v_ver IN ('neatribuibil', 'pagina_nepermisa') THEN NULL ELSE o.citat END,
            v_dov ->> 'valoare_text', v_dov ->> 'um_text', CASE WHEN v_ver = 'ok' THEN (v_dov ->> 'valoare')::numeric END, CASE WHEN v_ver = 'ok' THEN v_dov ->> 'um_canonica' END,
            CASE WHEN v_cunoscut THEN v_cl ->> 'natura' END, o.e_total, o.e_subtotal, v_ver);
  END LOOP;
  DROP TABLE IF EXISTS cm_linii;
  -- (f) raportul: extragerile `gata` ale licitatiei care NU sunt autoritative (alt extractor pe acelasi text, sau text vechi)
  SELECT coalesce(jsonb_agg(jsonb_build_object('extragere_id', e.id, 'document_id', e.document_id, 'motiv',
            CASE WHEN e.doc_sha256 = x ->> 'sha' THEN 'extragere_neautoritativa' ELSE 'sha_vechi' END) ORDER BY e.id), '[]'::jsonb)
    INTO v_ignorate
    FROM public.ofertare_cant_extrageri e JOIN jsonb_array_elements(v_foto -> 'documente') x ON (x ->> 'id')::bigint = e.document_id
   WHERE e.licitatie_id = p_licitatie_id AND e.stare = 'gata' AND e.id IS DISTINCT FROM (x ->> 'extragere_id')::bigint;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'identitate', s.identitate) ORDER BY s.id), '[]'::jsonb) INTO v_semnale
    FROM public.ofertare_cantitati_semnale s WHERE s.licitatie_id = p_licitatie_id AND s.evaluare_in_curs_id = v_ev;
  RETURN jsonb_build_object('evaluare_id', v_ev, 'semnale', v_semnale, 'ignorate', v_ignorate);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_masuratori_propune(bigint, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_masuratori_propune(bigint, uuid, jsonb, jsonb) TO service_role;
COMMENT ON FUNCTION public.fn_ofertare_masuratori_propune(bigint, uuid, jsonb, jsonb) IS 'Ofertare (edge, service_role): o evaluare noua a cantitatilor intre documente — pozitiile F3 (partea a) si observatiile documentelor (partea b), clasificate si verificate in SQL, scrise ca masuratori; refuza (evaluare_depasita) daca fotografia s-a schimbat. 20270112a.';

-- 8j. publicarea atomica (edge, service_role): inventar, agregare, verdict (ordinea stricta a regulilor), semnalul si tranzitiile ciornei auto_surse_*
-- Lock-urile (L01, L06): (0) advisory → (1) licitatia FOR SHARE → (2) documentele FOR SHARE ORDER BY id → (3) cantitatile FOR SHARE ORDER BY id →
-- (4) semnalele FOR UPDATE ORDER BY id → (5) ciornele auto_surse_% ale licitatiei, TOATE, intr-o singura instructiune FOR UPDATE ORDER BY nr, inaintea
-- primei scrieri pe vreuna. Alocarea nr = max(nr)+1 sub aceste lock-uri; coliziunea cu alt generator = 23505 (vizibila, reincercabila).
CREATE FUNCTION public.fn_ofertare_semnale_publica(p_licitatie_id bigint, p_evaluare_id bigint, p_token uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic record; v_ev record; v_foto jsonb; v_prag numeric; s public.ofertare_cantitati_semnale%ROWTYPE; c public.ofertare_clarificari%ROWTYPE; v_out jsonb := '[]'::jsonb;
        v_necitite jsonb; v_necitite_txt text; v_lim jsonb;
        v_a record; v_docs_b jsonb; v_contrib bigint[]; v_probleme text; v_inv jsonb; v_verdict text; v_motiv text; v_va numeric; v_vb numeric;
        v_valori_b jsonb; v_amprenta text; v_total_rau boolean; v_difera boolean; v_fara_ok int; v_componente_fara_ok jsonb; v_text text; v_gen text; v_evt text; v_sursa text; v_baza jsonb;
        v_surse_doc bigint[]; v_surse_cant bigint[]; v_cl text; v_rez boolean; v_nr int; v_neclas boolean; v_doc_b_id bigint; v_n_sem int := 0;
BEGIN
  IF p_licitatie_id IS NULL OR p_evaluare_id IS NULL OR p_token IS NULL THEN RAISE EXCEPTION 'CM_PARAMETRI: licitatie, evaluare si token sunt obligatorii' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ofertare_cantitati_semnale:' || p_licitatie_id, 0));
  SELECT l.id, l.stare_loturi INTO v_lic FROM public.ofertare_licitatii l WHERE l.id = p_licitatie_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CM_LICITATIE: licitatie inexistenta' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM (SELECT d.id FROM public.ofertare_documente_atribuire d WHERE d.licitatie_id = p_licitatie_id ORDER BY d.id FOR SHARE) x;
  PERFORM 1 FROM (SELECT q.id FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id ORDER BY q.id FOR SHARE) x;
  PERFORM 1 FROM (SELECT s2.id FROM public.ofertare_cantitati_semnale s2 WHERE s2.licitatie_id = p_licitatie_id ORDER BY s2.id FOR UPDATE) x;
  -- (a) evaluarea: a licitatiei, in_curs, cu tokenul ei; fotografia de acum = cea evaluata
  SELECT * INTO v_ev FROM public.ofertare_cantitati_evaluari e WHERE e.id = p_evaluare_id;
  IF NOT FOUND OR v_ev.licitatie_id <> p_licitatie_id OR v_ev.stare <> 'in_curs' OR v_ev.token IS DISTINCT FROM p_token THEN RETURN jsonb_build_object('refuz', 'evaluare_necunoscuta'); END IF;
  v_foto := public.fn_ofertare_semnale_fotografie(p_licitatie_id);
  IF v_foto ->> 'sha' IS DISTINCT FROM v_ev.surse_sha THEN
    PERFORM set_config('ofertare.masuratori_rpc', '1', true);
    DELETE FROM public.ofertare_cantitati_masuratori m WHERE m.evaluare_id = v_ev.id;
    UPDATE public.ofertare_cantitati_evaluari e SET stare = 'depasita', inchisa_la = now() WHERE e.id = v_ev.id;
    PERFORM set_config('ofertare.masuratori_rpc', '0', true);
    UPDATE public.ofertare_cantitati_semnale s2 SET evaluare_in_curs_id = NULL WHERE s2.evaluare_in_curs_id = v_ev.id;
    RETURN jsonb_build_object('refuz', 'evaluare_depasita');
  END IF;
  v_prag := (v_foto ->> 'prag')::numeric;
  v_necitite := CASE WHEN jsonb_typeof(v_ev.pagini -> 'documente_necitite') = 'array' THEN v_ev.pagini -> 'documente_necitite' ELSE '[]'::jsonb END;
  SELECT string_agg(coalesce(x ->> 'nume_original', x ->> 'id'), ', ' ORDER BY (x ->> 'id')::bigint) INTO v_necitite_txt
    FROM jsonb_array_elements(v_foto -> 'documente') x WHERE v_necitite @> to_jsonb(ARRAY[(x ->> 'id')::bigint]) OR v_necitite @> to_jsonb(ARRAY[x ->> 'id']);
  IF v_necitite_txt IS NULL AND jsonb_array_length(v_necitite) > 0 THEN v_necitite_txt := v_necitite::text; END IF;
  v_lim := public.fn_ofertare_masura_pagini_permise((SELECT coalesce(jsonb_agg(jsonb_build_object('id', x -> 'id', 'pagini', x -> 'pagini')), '[]'::jsonb) FROM jsonb_array_elements(v_foto -> 'documente') x),
                                                    (v_foto ->> 'plafon')::int);
  -- (5) ciornele auto_surse_% ale licitatiei, toate, o singura instructiune, ORDER BY nr
  PERFORM 1 FROM (SELECT k.id FROM public.ofertare_clarificari k WHERE k.licitatie_id = p_licitatie_id AND k.cheie LIKE 'auto_surse_%' ORDER BY k.nr FOR UPDATE) x;
  -- inventarul documentelor (decizia 17, L19): paginile neacoperite de felii gata, paginile necitite (document ∪ rulare ∪ peste plafon), feliile incomplete
  -- (edge ∪ feliile cu observatii neatribuibile, calculate de server din fn_ofertare_masura_felii_autoritative)
  DROP TABLE IF EXISTS cm_doc;
  CREATE TEMP TABLE cm_doc (document_id bigint, nume text, pagini integer, extragere_id bigint, neacoperite integer[], necitite integer[], felii_incomplete jsonb) ON COMMIT DROP;
  INSERT INTO cm_doc (document_id, nume, pagini, extragere_id, neacoperite, necitite, felii_incomplete)
    SELECT (x ->> 'id')::bigint, x ->> 'nume_original', (x ->> 'pagini')::int, (x ->> 'extragere_id')::bigint,
           public.fn_ofertare_masura_pagini_neacoperite(d.text_extras, (x ->> 'extragere_id')::bigint),
           (SELECT coalesce(array_agg(DISTINCT p ORDER BY p), '{}') FROM (
              SELECT (y)::int AS p FROM jsonb_array_elements_text(x -> 'pagini_necitite') y
              UNION SELECT (z)::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_ev.pagini -> 'pagini_necitite') = 'array' THEN v_ev.pagini -> 'pagini_necitite' ELSE '[]'::jsonb END) pn
                                       CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(pn -> 'pagini') = 'array' THEN pn -> 'pagini' ELSE '[]'::jsonb END) z
                     WHERE (pn ->> 'document_id')::bigint = (x ->> 'id')::bigint AND z ~ '^[0-9]{1,5}$'
              UNION SELECT g FROM generate_series(coalesce((SELECT (y ->> 'ultima_pagina_permisa')::int FROM jsonb_array_elements(v_lim -> 'limita') y WHERE (y ->> 'document_id')::bigint = (x ->> 'id')::bigint), 0) + 1,
                                                  (x ->> 'pagini')::int) g) u WHERE p BETWEEN 1 AND 99999),
           (SELECT coalesce(jsonb_agg(DISTINCT fi), '[]'::jsonb) FROM (
              SELECT jsonb_build_object('extragere_id', (fe ->> 'extragere_id')::bigint, 'felie_nr', (fe ->> 'felie_nr')::int, 'motiv', fe ->> 'motiv') AS fi
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_ev.pagini -> 'felii_incomplete') = 'array' THEN v_ev.pagini -> 'felii_incomplete' ELSE '[]'::jsonb END) fe
               WHERE (fe ->> 'extragere_id')::bigint = (x ->> 'extragere_id')::bigint
              UNION ALL
              SELECT jsonb_build_object('extragere_id', (x ->> 'extragere_id')::bigint, 'felie_nr', fa.felie_nr, 'motiv', 'observatii_neatribuibile')
                FROM public.fn_ofertare_masura_felii_autoritative((x ->> 'extragere_id')::bigint) fa WHERE NOT fa.obs_atribuibile) w)
      FROM jsonb_array_elements(v_foto -> 'documente') x JOIN public.ofertare_documente_atribuire d ON d.id = (x ->> 'id')::bigint;
  -- semnalele evaluarii, in ordinea id
  FOR s IN SELECT * FROM public.ofertare_cantitati_semnale s2 WHERE s2.licitatie_id = p_licitatie_id AND s2.evaluare_in_curs_id = v_ev.id ORDER BY s2.id LOOP
    -- (b) inventarul: A = fiecare cantitate_id o data (ok preferat); B = pe document; documentele care contribuie = orice componenta a / b
    SELECT count(*)::int AS n, count(*) FILTER (WHERE t.verificare <> 'ok')::int AS fara_ok, coalesce(sum(t.valoare) FILTER (WHERE t.verificare = 'ok'), 0) AS suma
      INTO v_a
      FROM (SELECT DISTINCT ON (m.cantitate_id) m.* FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.parte = 'a'
             ORDER BY m.cantitate_id, (m.verificare = 'ok') DESC, m.id) t;
    SELECT coalesce(jsonb_agg(jsonb_build_object('document_id', b.document_id, 'n', b.n, 'n_ok', b.n_ok, 'fara_ok', b.n - b.n_ok, 'n_comp_ok', b.n_comp_ok, 'n_total_ok', b.n_total_ok,
                                                 'suma_componente', b.suma_comp, 'suma_totaluri', b.suma_tot,
                                                 'valoare', CASE WHEN b.n_comp_ok > 0 THEN b.suma_comp WHEN b.n_total_ok > 0 THEN b.suma_tot END,
                                                 'total_rau', b.n_comp_ok > 0 AND b.n_total_ok > 0 AND abs(b.suma_tot - b.suma_comp) >= 1
                                                              AND abs(b.suma_tot - b.suma_comp) / greatest(abs(b.suma_tot), abs(b.suma_comp)) > v_prag) ORDER BY b.n_ok DESC, b.document_id), '[]'::jsonb)
      INTO v_docs_b
      FROM (SELECT t.document_id, count(*)::int AS n, count(*) FILTER (WHERE t.verificare = 'ok')::int AS n_ok,
                   count(*) FILTER (WHERE t.verificare = 'ok' AND NOT t.e_total AND NOT t.e_subtotal)::int AS n_comp_ok,
                   count(*) FILTER (WHERE t.verificare = 'ok' AND t.e_total)::int AS n_total_ok,
                   coalesce(sum(t.valoare) FILTER (WHERE t.verificare = 'ok' AND NOT t.e_total AND NOT t.e_subtotal), 0) AS suma_comp,
                   coalesce(sum(t.valoare) FILTER (WHERE t.verificare = 'ok' AND t.e_total), 0) AS suma_tot
              FROM (SELECT DISTINCT ON (m.obs_id) m.* FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.parte = 'b' ORDER BY m.obs_id, m.id) t
             GROUP BY t.document_id) b;
    SELECT coalesce(array_agg(DISTINCT m.document_id ORDER BY m.document_id), '{}') INTO v_contrib
      FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.document_id IS NOT NULL;
    IF v_a.n = 0 AND jsonb_array_length(v_docs_b) = 0 THEN
      IF s.evaluare_id IS NULL THEN
        -- niciodata publicat, nicio componenta, nicio ciorna: urma unei evaluari depasite
        DELETE FROM public.ofertare_cantitati_semnale s2 WHERE s2.id = s.id AND s2.clarificare_id IS NULL;
        IF FOUND THEN CONTINUE; END IF;
      END IF;
    END IF;
    SELECT string_agg(format('%s: %s%s', coalesce(cd.nume, cd.document_id::text),
                             CASE WHEN cardinality(cd.neacoperite) + cardinality(cd.necitite) > 0 THEN 'pagini ' || array_to_string((SELECT array_agg(DISTINCT p ORDER BY p) FROM unnest(cd.neacoperite || cd.necitite) p), ',') ELSE '' END,
                             CASE WHEN jsonb_array_length(cd.felii_incomplete) > 0 THEN concat(CASE WHEN cardinality(cd.neacoperite) + cardinality(cd.necitite) > 0 THEN ' / ' ELSE '' END, 'felii ',
                                       (SELECT string_agg((fi ->> 'felie_nr') || ' ' || (fi ->> 'motiv'), ', ' ORDER BY (fi ->> 'felie_nr')::int, fi ->> 'motiv') FROM jsonb_array_elements(cd.felii_incomplete) fi)) ELSE '' END),
                      '; ' ORDER BY cd.document_id)
      INTO v_probleme
      FROM cm_doc cd WHERE cd.document_id = ANY (v_contrib) AND (cardinality(cd.neacoperite) + cardinality(cd.necitite) > 0 OR jsonb_array_length(cd.felii_incomplete) > 0);
    SELECT coalesce(jsonb_agg(jsonb_build_object('parte', m.parte, 'document_id', m.document_id, 'obs_id', m.obs_id, 'cantitate_id', m.cantitate_id, 'verificare', m.verificare) ORDER BY m.parte, m.id), '[]'::jsonb)
      INTO v_componente_fara_ok FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.verificare <> 'ok';
    v_fara_ok := jsonb_array_length(v_componente_fara_ok);
    v_total_rau := EXISTS (SELECT 1 FROM jsonb_array_elements(v_docs_b) b WHERE (b ->> 'total_rau')::boolean);
    v_difera := EXISTS (SELECT 1 FROM jsonb_array_elements(v_docs_b) b1 CROSS JOIN jsonb_array_elements(v_docs_b) b2
                         WHERE (b1 ->> 'document_id')::bigint < (b2 ->> 'document_id')::bigint AND b1 ->> 'valoare' IS NOT NULL AND b2 ->> 'valoare' IS NOT NULL
                           AND abs((b1 ->> 'valoare')::numeric - (b2 ->> 'valoare')::numeric) >= 1
                           AND abs((b1 ->> 'valoare')::numeric - (b2 ->> 'valoare')::numeric) / greatest(abs((b1 ->> 'valoare')::numeric), abs((b2 ->> 'valoare')::numeric)) > v_prag);
    SELECT (b ->> 'document_id')::bigint, (b ->> 'valoare')::numeric INTO v_doc_b_id, v_vb FROM jsonb_array_elements(v_docs_b) b ORDER BY (b ->> 'n_ok')::int DESC, (b ->> 'document_id')::bigint LIMIT 1;
    v_va := CASE WHEN v_a.n > 0 THEN v_a.suma END;
    v_valori_b := (SELECT coalesce(jsonb_agg(jsonb_build_object('document_id', b -> 'document_id', 'valoare', b -> 'valoare', 'componente_ok', b -> 'n_ok') ORDER BY (b ->> 'document_id')::bigint), '[]'::jsonb) FROM jsonb_array_elements(v_docs_b) b);
    -- pozitii F3 neclasificate cu acelasi lot si UM, pe acelasi obiect sau pe nivelul lucrarii
    v_neclas := s.element <> 'necunoscut' AND EXISTS (
      SELECT 1 FROM public.ofertare_cantitati_semnale n JOIN public.ofertare_cantitati_masuratori m ON m.semnal_id = n.id AND m.evaluare_id = v_ev.id AND m.parte = 'a' AND m.verificare = 'neclasificat'
       WHERE n.licitatie_id = p_licitatie_id AND n.element = 'necunoscut' AND n.lot_nr IS NOT DISTINCT FROM s.lot_nr AND n.um_canonica IS NOT DISTINCT FROM s.um_canonica
         AND (n.obiect_cheie = s.obiect_cheie OR s.obiect_cheie = '*'));
    -- (d) verdictul, in ordinea stricta a regulilor — prima adevarata decide
    IF jsonb_array_length(v_necitite) > 0 THEN v_verdict := 'neverificat'; v_motiv := 'document necitit (' || v_necitite_txt || ')';
    ELSIF s.element = 'necunoscut' THEN
      v_verdict := 'de_verificat';
      v_motiv := CASE WHEN EXISTS (SELECT 1 FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.verificare = 'neclasificat')
                      THEN 'element sau natură necunoscute' ELSE 'lot necunoscut' END;
    ELSIF v_a.n = 0 AND jsonb_array_length(v_docs_b) = 0 THEN v_verdict := 'de_verificat'; v_motiv := 'sursă dispărută';
    ELSIF v_fara_ok > 0 OR v_probleme IS NOT NULL THEN v_verdict := 'neverificat'; v_motiv := 'agregare incompletă' || coalesce(' (' || v_probleme || ')', '');
    ELSIF v_neclas THEN v_verdict := 'neverificat'; v_motiv := 'poziții F3 neclasificate';
    ELSIF v_total_rau THEN v_verdict := 'de_verificat'; v_motiv := 'totalul documentului nu corespunde componentelor';
    ELSIF v_difera THEN v_verdict := 'de_verificat'; v_motiv := 'documentele diferă între ele';
    ELSIF v_a.n = 0 OR jsonb_array_length(v_docs_b) = 0 THEN v_verdict := 'de_verificat'; v_motiv := 'o singură sursă';
    ELSIF v_va = 0 AND v_vb = 0 THEN v_verdict := 'in_regula'; v_motiv := NULL;
    ELSIF v_va = 0 OR v_vb = 0 THEN v_verdict := 'de_verificat'; v_motiv := 'valoare zero';
    ELSIF abs(v_va - v_vb) < 1 THEN v_verdict := 'in_regula'; v_motiv := NULL;
    ELSIF abs(v_va - v_vb) / greatest(abs(v_va), abs(v_vb)) > v_prag THEN
      v_verdict := 'diferenta';
      v_motiv := format('A %s %s, B %s %s (%s %% > %s %%)', public.fn_ofertare_masura_numar_text(v_va), coalesce(s.um_canonica, ''), public.fn_ofertare_masura_numar_text(v_vb), coalesce(s.um_canonica, ''),
                        public.fn_ofertare_masura_numar_text(round(abs(v_va - v_vb) / greatest(abs(v_va), abs(v_vb)) * 100, 1)), public.fn_ofertare_masura_numar_text(v_prag * 100));
    ELSE v_verdict := 'in_regula'; v_motiv := NULL;
    END IF;
    v_inv := jsonb_build_object('a', jsonb_build_object('componente', v_a.n, 'fara_ok', v_a.fara_ok), 'b', v_docs_b, 'document_b', v_doc_b_id, 'documente', to_jsonb(v_contrib),
                                'componente_fara_ok', v_componente_fara_ok, 'documente_necitite', v_necitite, 'probleme', v_probleme, 'prag', v_prag,
                                'pagini_lipsa', (SELECT coalesce(jsonb_agg(jsonb_build_object('document_id', cd.document_id, 'pagini', to_jsonb((SELECT array_agg(DISTINCT p ORDER BY p) FROM unnest(cd.neacoperite || cd.necitite) p))) ORDER BY cd.document_id), '[]'::jsonb)
                                                   FROM cm_doc cd WHERE cd.document_id = ANY (v_contrib) AND cardinality(cd.neacoperite) + cardinality(cd.necitite) > 0),
                                'felii_incomplete', (SELECT coalesce(jsonb_agg(fi ORDER BY (fi ->> 'extragere_id')::bigint, (fi ->> 'felie_nr')::int, fi ->> 'motiv'), '[]'::jsonb)
                                                       FROM cm_doc cd CROSS JOIN LATERAL jsonb_array_elements(cd.felii_incomplete) fi WHERE cd.document_id = ANY (v_contrib)));
    -- (e) amprenta evaluarii (decizia 8)
    SELECT encode(sha256(convert_to(s.identitate || '|' || v_ev.surse_sha || '|' || coalesce(string_agg(m.parte || '|' || coalesce(m.cantitate_id, m.obs_id) || '|' || coalesce(m.document_id::text, '') || '|' || coalesce(m.pagina::text, '')
             || '|' || coalesce(m.rand, m.fragment, '') || '|' || coalesce(m.valoare_text, '') || '|' || m.verificare, ';' ORDER BY m.parte, coalesce(m.cantitate_id, m.obs_id), m.document_id, m.id), '')
             || '|' || v_inv::text || '|' || v_verdict || '|' || coalesce(v_va::text, '') || '|' || coalesce(v_vb::text, ''), 'UTF8')), 'hex')
      INTO v_amprenta FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id;
    UPDATE public.ofertare_cantitati_semnale s2 SET evaluare_id = v_ev.id, surse_sha = v_ev.surse_sha, evaluare_amprenta = v_amprenta, verdict = v_verdict, motiv = v_motiv,
           valoare_a = v_va, valoare_b = v_vb, valori_b = v_valori_b, inventar = v_inv, evaluare_la = now(), evaluare_in_curs_id = NULL
     WHERE s2.id = s.id;
    SELECT * INTO s FROM public.ofertare_cantitati_semnale s2 WHERE s2.id = s.id;
    v_n_sem := v_n_sem + 1;
    -- (f) tranzitiile ciornei (spec §3.4, deciziile 12, 13, 16)
    v_rez := public.fn_ofertare_semnal_rezolvat(s);
    SELECT * INTO c FROM public.ofertare_clarificari k WHERE k.licitatie_id = p_licitatie_id AND k.cheie = 'auto_surse_' || s.identitate;
    v_cl := CASE WHEN c.id IS NULL THEN NULL ELSE 'neatinsa' END;
    IF v_verdict = 'diferenta' AND NOT v_rez THEN
      v_text := public.fn_ofertare_semnal_text(s.id, v_ev.id);
      v_gen := left(md5(v_text), 12); v_evt := left(md5(v_amprenta), 12);
      v_sursa := 'surse_auto:' || coalesce(v_doc_b_id::text, '') || ',gen_' || v_gen || ',ev_' || v_evt;
      v_baza := jsonb_build_object('evaluare', 'surse_v1', 'evaluare_amprenta', v_amprenta, 'surse_sha', v_ev.surse_sha, 'text_hash', md5(v_text), 'verdict', v_verdict,
                                   'a', v_va, 'b', v_vb, 'prag', v_prag, 'semnal_id', s.id, 'la', now());
      SELECT coalesce(array_agg(DISTINCT m.document_id ORDER BY m.document_id), '{}'), coalesce(array_agg(DISTINCT m.cantitate_id ORDER BY m.cantitate_id) FILTER (WHERE m.cantitate_id IS NOT NULL), '{}')
        INTO v_surse_doc, v_surse_cant FROM public.ofertare_cantitati_masuratori m WHERE m.semnal_id = s.id AND m.evaluare_id = v_ev.id AND m.document_id IS NOT NULL;
      IF c.id IS NULL THEN
        SELECT coalesce(max(k.nr), 0) + 1 INTO v_nr FROM public.ofertare_clarificari k WHERE k.licitatie_id = p_licitatie_id;
        INSERT INTO public.ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare, surse_document_ids, surse_cantitati_ids)
        VALUES (p_licitatie_id, v_nr, v_text, v_sursa, 'propunere', 'automat', 'auto_surse_' || s.identitate, v_baza, v_surse_doc, v_surse_cant) RETURNING id INTO c;
        UPDATE public.ofertare_cantitati_semnale s2 SET clarificare_id = c.id WHERE s2.id = s.id;
        v_cl := 'creata';
      ELSIF c.status = 'retrasa' AND c.baza_generare ->> 'retrasa_de' = 'sistem' THEN
        UPDATE public.ofertare_clarificari k SET status = 'propunere', intrebare = v_text, sursa = v_sursa, updated_at = now(),
               baza_generare = (coalesce(k.baza_generare, '{}'::jsonb) - 'retrasa_de' - 'retrasa_motiv' - 'retrasa_la' - 'reconfirmare') || v_baza,
               surse_document_ids = v_surse_doc, surse_cantitati_ids = v_surse_cant
         WHERE k.id = c.id;
        v_cl := 'reactivata';
      ELSIF c.status = 'retrasa' THEN
        UPDATE public.ofertare_cantitati_semnale s2 SET reaparut_dupa_respingere = (c.baza_generare ->> 'evaluare_amprenta' IS DISTINCT FROM v_amprenta) WHERE s2.id = s.id;
        v_cl := 'neatinsa';
      ELSIF public.fn_ofertare_semnal_ciorna_libera(c) THEN
        IF c.intrebare IS DISTINCT FROM v_text THEN
          UPDATE public.ofertare_clarificari k SET intrebare = v_text, sursa = v_sursa, baza_generare = coalesce(k.baza_generare, '{}'::jsonb) || v_baza, updated_at = now(),
                 surse_document_ids = v_surse_doc, surse_cantitati_ids = v_surse_cant
           WHERE k.id = c.id AND k.status = 'propunere' AND k.intrebare IS NOT DISTINCT FROM c.intrebare;
          v_cl := CASE WHEN FOUND THEN 'regenerata' ELSE 'neatinsa' END;
        ELSIF c.baza_generare ->> 'evaluare_amprenta' IS DISTINCT FROM v_amprenta THEN
          UPDATE public.ofertare_clarificari k SET sursa = v_sursa, baza_generare = coalesce(k.baza_generare, '{}'::jsonb) || v_baza, updated_at = now(),
                 surse_document_ids = v_surse_doc, surse_cantitati_ids = v_surse_cant
           WHERE k.id = c.id AND k.status = 'propunere' AND k.intrebare IS NOT DISTINCT FROM c.intrebare;
          v_cl := 'neatinsa';
        END IF;
      END IF;
      IF s.clarificare_id IS NULL AND c.id IS NOT NULL THEN UPDATE public.ofertare_cantitati_semnale s2 SET clarificare_id = c.id WHERE s2.id = s.id; END IF;
    ELSIF c.id IS NOT NULL AND public.fn_ofertare_semnal_ciorna_libera(c) THEN
      UPDATE public.ofertare_clarificari k SET status = 'retrasa', updated_at = now(),
             baza_generare = coalesce(k.baza_generare, '{}'::jsonb) || jsonb_build_object('retrasa_de', 'sistem', 'retrasa_la', now(),
               'retrasa_motiv', CASE WHEN v_rez THEN 'rezolvat_de_raspuns' ELSE 'verdict_' || v_verdict END, 'evaluare_amprenta', v_amprenta)
       WHERE k.id = c.id;
      v_cl := 'retrasa';
    END IF;
    v_out := v_out || jsonb_build_object('id', s.id, 'identitate', s.identitate, 'verdict', v_verdict, 'motiv', v_motiv, 'a', v_va, 'b', v_vb, 'clarificare', v_cl);
  END LOOP;
  DROP TABLE IF EXISTS cm_doc;
  PERFORM set_config('ofertare.masuratori_rpc', '1', true);
  UPDATE public.ofertare_cantitati_evaluari e SET stare = 'publicata', inchisa_la = now() WHERE e.id = v_ev.id;
  PERFORM set_config('ofertare.masuratori_rpc', '0', true);
  RETURN jsonb_build_object('evaluare_id', v_ev.id, 'semnale', v_out, 'n', v_n_sem);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_semnale_publica(bigint, bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_semnale_publica(bigint, bigint, uuid) TO service_role;
COMMENT ON FUNCTION public.fn_ofertare_semnale_publica(bigint, bigint, uuid) IS 'Ofertare (edge, service_role): publicarea atomica a unei evaluari — inventar, agregare, verdict (ordinea stricta a regulilor), semnalul si ciorna auto_surse_*; refuza daca fotografia s-a schimbat (evaluare_depasita). 20270112a.';

-- ─── 9. Circuitul ciornelor automate, extins explicit la auto_surse_* (inventarul planului #2–#6, #9; deciziile 11, 13) ─────────────────
-- 9a. starea LIVE a bazei unei ciorne auto_surse_* (decizia 8, Task 4): primeste RANDUL candidat (in trigger NEW); doua moduri, doua intrebari:
--     tranzitie = „textul candidat e aprobat pe evaluarea publicata, actuala?” (c.status NU se citeste); afisare = pentru propunere / de_trimis /
--     retrasa aceeasi ordine, pentru trimisa / raspunsa comparatia cu baza ciornei LA APROBARE (reconfirmare.surse_sha / .evaluare_amprenta).
--     Intoarce DOAR starea, tokenii si diferentele (nicio dovada, niciun text de document). Nu ia advisory, nu blocheaza nimic.
CREATE FUNCTION public.ofertare_semnal_baza_stare(c public.ofertare_clarificari, p_mod text DEFAULT 'afisare') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE s public.ofertare_cantitati_semnale%ROWTYPE; v_foto jsonb; v_hash text := md5(coalesce(c.intrebare, '')); v_tok_apr text; v_tok_cur text; v_st text; v_rc jsonb; v_rez boolean; v_mod text;
BEGIN
  v_mod := CASE WHEN p_mod = 'tranzitie' THEN 'tranzitie' ELSE 'afisare' END;
  SELECT * INTO s FROM public.ofertare_cantitati_semnale x WHERE x.licitatie_id = c.licitatie_id AND 'auto_surse_' || x.identitate = coalesce(c.cheie, '');
  IF NOT FOUND OR s.evaluare_id IS NULL OR s.evaluare_amprenta IS NULL THEN
    RETURN jsonb_build_object('stare', 'indisponibila', 'mod', v_mod, 'evaluare', 'surse_v1', 'mod_ciorna', 'surse', 'marcaj_planse', false, 'curent', jsonb_build_object('mod', 'surse'),
                              'text', 'necesită review — semnalul ciornei nu are o evaluare publicată');
  END IF;
  v_foto := public.fn_ofertare_semnale_fotografie(c.licitatie_id);
  v_tok_apr := md5(s.evaluare_amprenta || '|' || v_hash);
  v_tok_cur := md5(s.evaluare_amprenta || '|' || (v_foto ->> 'sha') || '|' || v_hash);
  v_rez := public.fn_ofertare_semnal_rezolvat(s);
  v_rc := c.baza_generare -> 'reconfirmare';
  IF v_mod = 'afisare' AND c.status IN ('trimisa', 'raspunsa') THEN
    IF v_rc IS NULL THEN v_st := 'indisponibila';
    ELSIF (v_foto ->> 'sha') IS DISTINCT FROM (v_rc ->> 'surse_sha') OR s.evaluare_amprenta IS DISTINCT FROM (v_rc ->> 'evaluare_amprenta') THEN
      v_st := CASE WHEN c.baza_generare -> 'luat_act' ->> 'token' = v_tok_cur THEN 'luat_act' ELSE 'schimbata' END;
    ELSE v_st := 'ok';
    END IF;
  ELSE
    v_st := CASE WHEN (v_foto ->> 'sha') IS DISTINCT FROM s.surse_sha THEN 'schimbata'
                 WHEN s.evaluare_in_curs_id IS NOT NULL THEN 'evaluare_in_curs'
                 WHEN v_rez THEN 'rezolvata_de_raspuns'
                 WHEN s.verdict IS DISTINCT FROM 'diferenta' THEN 'fara_diferenta'
                 WHEN (v_rc ->> 'token') = v_tok_apr THEN 'ok'
                 ELSE 'necesita_review' END;
  END IF;
  RETURN jsonb_build_object('stare', v_st, 'mod', v_mod, 'evaluare', 'surse_v1', 'amprenta_curenta', v_tok_cur, 'amprenta_baza', s.evaluare_amprenta, 'token_aprobare', v_tok_apr,
    'surse_sha', s.surse_sha, 'text_hash', v_hash, 'semnal_id', s.id, 'verdict', s.verdict, 'marcaj_planse', false, 'mod_ciorna', 'surse', 'curent', jsonb_build_object('mod', 'surse'),
    'diferente', jsonb_build_object('verdict', jsonb_build_object('vechi', c.baza_generare -> 'verdict', 'acum', s.verdict), 'a', jsonb_build_object('vechi', c.baza_generare -> 'a', 'acum', s.valoare_a),
                                    'b', jsonb_build_object('vechi', c.baza_generare -> 'b', 'acum', s.valoare_b), 'prag', jsonb_build_object('vechi', c.baza_generare -> 'prag', 'acum', v_foto -> 'prag')),
    'text', CASE v_st WHEN 'ok' THEN 'Text aprobat de om pe evaluarea publicată, actuală. Cantitățile din text nu sunt validate automat.'
                      WHEN 'rezolvata_de_raspuns' THEN 'semnal rezolvat prin răspunsul Autorității — ciorna nu mai e necesară'
                      WHEN 'luat_act' THEN 'baza s-a schimbat după transmitere — luat act; textul transmis rămâne neschimbat'
                      WHEN 'indisponibila' THEN 'necesită review — baza ciornei nu este demonstrabilă'
                      WHEN 'necesita_review' THEN 'necesită review — aprobă textul exact pe baza curentă'
                      ELSE 'baza s-a schimbat — de reverificat' END);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('stare', 'indisponibila', 'mod', v_mod, 'evaluare', 'surse_v1', 'mod_ciorna', 'surse', 'marcaj_planse', false, 'text', 'nu putem verifica baza: ' || SQLERRM);
END $f$;
REVOKE ALL ON FUNCTION public.ofertare_semnal_baza_stare(public.ofertare_clarificari, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ofertare_semnal_baza_stare(public.ofertare_clarificari, text) TO authenticated, service_role;
-- 9b. dispecerul (decizia 11): o singura functie pentru ambele feluri de ciorne automate; p_mod ajunge doar la ramura auto_surse_*
CREATE FUNCTION public.fn_ofertare_ciorna_auto_stare(c public.ofertare_clarificari, p_mod text DEFAULT 'afisare') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  IF coalesce(c.cheie, '') LIKE 'auto_planse_%' THEN RETURN public.ofertare_clarificare_baza_stare(c.licitatie_id, c.intrebare, c.sursa, c.baza_generare); END IF;
  IF coalesce(c.cheie, '') LIKE 'auto_surse_%' THEN RETURN public.ofertare_semnal_baza_stare(c, p_mod); END IF;
  RETURN jsonb_build_object('stare', 'indisponibila', 'text', 'nu e ciornă automată', 'marcaj_planse', false);
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari, text) TO authenticated, service_role;
-- 9c. triggerul ciornelor: textul LIVE (docs/R5_MIGRARE_3_review_copilot.sql) cu DOAR: v_auto pe ambele prefixe (si pe OLD), DELETE blocat pe ambele,
--     marcajul retragerii de om (decizia 13), starea prin dispecer CU NEW in mod tranzitie. CREATE OR REPLACE: OID, trigger, ACL pastrate.
CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_clarificari_baza()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_st jsonb; v_auto boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF coalesce(OLD.cheie,'') ~ '^auto_(planse|surse)_' THEN RAISE EXCEPTION 'Proveniența și deciziile se păstrează; retrage ciorna în loc de ștergere'; END IF;
    IF OLD.origine IN ('platforma','automat') AND OLD.status IN ('trimisa','raspunsa') THEN
      RAISE EXCEPTION 'Documentul transmis este imuabil';
    END IF;
    RETURN OLD;
  END IF;
  v_auto := coalesce(NEW.cheie,'') ~ '^auto_(planse|surse)_' OR (TG_OP='UPDATE' AND coalesce(OLD.cheie,'') ~ '^auto_(planse|surse)_');
  -- F02/F03: proveniența veche contează și când clientul încearcă s-o schimbe.
  IF NEW.origine IN ('platforma','automat') OR (TG_OP='UPDATE' AND OLD.origine IN ('platforma','automat')) OR v_auto THEN
    IF TG_OP='UPDATE' AND (NEW.origine,NEW.licitatie_id) IS DISTINCT FROM (OLD.origine,OLD.licitatie_id) THEN
      RAISE EXCEPTION 'Proveniența clarificării de platformă este imuabilă';
    END IF;
    IF NEW.status='raspunsa' AND (TG_OP='INSERT' OR OLD.status IS NULL OR OLD.status NOT IN ('trimisa','raspunsa')) THEN
      RAISE EXCEPTION 'Clarificare blocată: răspunsul cere o clarificare trimisă';
    END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.status IN ('trimisa','raspunsa') AND ((NEW.intrebare,NEW.fisier_path) IS DISTINCT FROM (OLD.intrebare,OLD.fisier_path)
        OR NEW.status IS NULL OR NEW.status NOT IN ('trimisa','raspunsa')) THEN RAISE EXCEPTION 'Documentul transmis este imuabil'; END IF;
      -- O editare nu moștenește aprobarea textului anterior, indiferent de writer.
      IF NEW.intrebare IS DISTINCT FROM OLD.intrebare
         AND (OLD.status='de_trimis' OR NEW.status='de_trimis') THEN NEW.status := 'propunere'; END IF;
    END IF;
    IF NEW.status IN ('de_trimis','trimisa') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
       AND current_user IN ('authenticated','anon')
       AND NOT coalesce(public.fn_ofertare_source_pack_poate_decide(NEW.licitatie_id),false) THEN
      RAISE EXCEPTION 'Clarificare blocată: aprobarea cere drept de decizie pe licitație';
    END IF;
  END IF;
  -- Amprenta ciornelor automate: auto_planse_% (R9b) și auto_surse_% (20270112a).
  IF NOT v_auto THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.cheie,NEW.licitatie_id,NEW.origine) IS DISTINCT FROM (OLD.cheie,OLD.licitatie_id,OLD.origine) THEN
      RAISE EXCEPTION 'Proveniența clarificării automate este imuabilă';
    END IF;
  END IF;
  IF current_user IN ('authenticated','anon','service_role') THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Ciorna automată se creează doar prin generatorul controlat'; END IF;
    IF NEW.baza_generare IS DISTINCT FROM OLD.baza_generare THEN RAISE EXCEPTION 'Baza și aprobarea se scriu doar prin reconfirmare'; END IF;
    NEW.sursa := OLD.sursa;
  END IF;
  -- 20270112a (decizia 13): retragerea de OM se marchează pe server (RPC-urile de publicare scriu retrasa_de = 'sistem').
  IF TG_OP='UPDATE' AND NEW.status='retrasa' AND OLD.status IS DISTINCT FROM 'retrasa' AND current_user IN ('authenticated','anon') THEN
    NEW.baza_generare := coalesce(NEW.baza_generare,'{}'::jsonb) || jsonb_build_object('retrasa_de','om','retrasa_de_uid',auth.uid(),'retrasa_la',now());
  END IF;
  IF TG_OP='UPDATE' AND NEW.intrebare IS DISTINCT FROM OLD.intrebare AND current_user IN ('authenticated','anon','service_role') THEN
    -- Textul se salvează, aprobarea nu se transferă. Istoricul deciziilor se păstrează.
    NEW.baza_generare := (coalesce(NEW.baza_generare,'{}'::jsonb)-'reconfirmare') ||
      CASE WHEN OLD.baza_generare ? 'reconfirmare' AND NOT (OLD.baza_generare ? 'istoric_decizii')
        THEN jsonb_build_object('istoric_decizii',jsonb_build_array(OLD.baza_generare->'reconfirmare')) ELSE '{}'::jsonb END ||
      jsonb_build_object('text_editat_de',auth.uid(),'text_editat_la',now());
    IF NEW.status='de_trimis' THEN NEW.status := 'propunere'; END IF;
  END IF;
  -- F04: o editare nu poate reactiva excepția nici după revenirea la textul anterior.
  -- Generatorul poate rescrie baza unei propuneri încă nereconfirmate: nu pierde auditul excepției.
  IF TG_OP='UPDATE' AND OLD.baza_generare ? 'istoric_decizii'
     AND NOT (coalesce(NEW.baza_generare,'{}'::jsonb) ? 'istoric_decizii') THEN
    NEW.baza_generare := coalesce(NEW.baza_generare,'{}'::jsonb) ||
      jsonb_build_object('istoric_decizii',OLD.baza_generare->'istoric_decizii');
  END IF;
  IF TG_OP='UPDATE' AND NEW.intrebare IS DISTINCT FROM OLD.intrebare THEN
    NEW.baza_generare := NEW.baza_generare - 'exceptie_identitate';
  END IF;
  IF NEW.status IN ('de_trimis','trimisa') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    -- 20270112a: starea pe RÂNDUL CANDIDAT (NEW, după ce editarea i-a scos aprobarea), prin dispecer, în modul tranzitie
    v_st := public.fn_ofertare_ciorna_auto_stare(NEW,'tranzitie');
    IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') OR coalesce((v_st->>'marcaj_planse')::boolean,true) THEN
      RAISE EXCEPTION 'Clarificare blocată: %. Reconfirmă textul pe baza curentă.',v_st->>'text';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
-- 9d. reconfirmarea: textul LIVE cu DOAR: ambele prefixe; starea prin dispecer; ramura auto_surse_* (tokenul primit = token_curent; revizuit cere
--     evaluarea publicata actuala; reconfirmare = {token: token_aprobare, token_curent, evaluare_amprenta, surse_sha, …}; luat_act = {token: token_curent, …})
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_reconfirma(p_id bigint,p_amprenta text,p_decizie text,p_nota text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.ofertare_clarificari; v_st jsonb; v_cur jsonb; v_decizie jsonb; v_sursa text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces la Ofertare'); END IF;
  IF coalesce(p_decizie,'') NOT IN ('revizuit','luat_act') THEN RETURN jsonb_build_object('error','alege revizuit sau, după transmitere, luat_act'); END IF;
  IF length(btrim(coalesce(p_nota,''))) < (CASE WHEN p_decizie='luat_act' THEN 10 ELSE 5 END) THEN RETURN jsonb_build_object('error','nota de review este prea scurtă'); END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.cheie,'') !~ '^auto_(planse|surse)_' THEN RETURN jsonb_build_object('error','nu e ciornă automată'); END IF;
  -- R9b (Copilot): reconfirmarea cere DREPT DE DECIZIE pe licitație (owner / responsabil / admin Ofertare), nu doar acces la modul.
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(c.licitatie_id),false) THEN RETURN jsonb_build_object('error','fără drept de decizie pe licitație'); END IF;
  v_st := public.fn_ofertare_ciorna_auto_stare(c,'afisare');
  IF p_amprenta IS NULL OR v_st->>'amprenta_curenta' IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','textul sau baza s-au schimbat — reîncarcă și verifică'); END IF;
  -- 20270112a: ciornele de surse — aprobarea leaga textul exact de evaluarea publicata (token_aprobare), luarea la cunostinta de fotografia vazuta acum (token_curent)
  IF coalesce(c.cheie,'') LIKE 'auto_surse_%' THEN
    v_decizie := jsonb_build_object('token',v_st->>'token_aprobare','token_curent',p_amprenta,'evaluare_amprenta',v_st->>'amprenta_baza','surse_sha',v_st->>'surse_sha',
      'text_hash',md5(coalesce(c.intrebare,'')),'text_aprobat',c.intrebare,'de',auth.uid(),'la',now(),'decizie',p_decizie,'nota',btrim(p_nota));
    IF c.status IN ('trimisa','raspunsa') THEN
      IF p_decizie <> 'luat_act' THEN RETURN jsonb_build_object('error','document transmis imuabil — doar luat_act'); END IF;
      UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('luat_act',v_decizie||jsonb_build_object('token',p_amprenta),
        'istoric_decizii',coalesce(baza_generare->'istoric_decizii','[]'::jsonb)||jsonb_build_array(v_decizie)) WHERE id=p_id;
    ELSE
      IF c.status NOT IN ('propunere','de_trimis') OR p_decizie <> 'revizuit' THEN RETURN jsonb_build_object('error','decizie incompatibilă cu starea ciornei'); END IF;
      IF coalesce(v_st->>'stare','') NOT IN ('necesita_review','ok') THEN RETURN jsonb_build_object('error','baza s-a schimbat în timpul verificării'); END IF;
      UPDATE public.ofertare_clarificari SET updated_at=now(),
        baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('text_hash',md5(coalesce(c.intrebare,'')),'reconfirmare',v_decizie,
        'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
          CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii') THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
        WHERE id=p_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'id',p_id,'decizie',p_decizie);
  END IF;
  v_decizie := jsonb_build_object('token',p_amprenta,'text_hash',md5(coalesce(c.intrebare,'')),
    'amprenta',v_st->>'amprenta_baza','text_aprobat',c.intrebare,'de',auth.uid(),'la',now(),'decizie',p_decizie,'nota',btrim(p_nota));
  IF c.status IN ('trimisa','raspunsa') THEN
    IF p_decizie <> 'luat_act' THEN RETURN jsonb_build_object('error','document transmis imuabil — doar luat_act'); END IF;
    UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('luat_act',v_decizie,
      'istoric_decizii',coalesce(baza_generare->'istoric_decizii','[]'::jsonb)||jsonb_build_array(v_decizie)) WHERE id=p_id;
  ELSE
    IF c.status NOT IN ('propunere','de_trimis') OR p_decizie <> 'revizuit' THEN RETURN jsonb_build_object('error','decizie incompatibilă cu starea ciornei'); END IF;
    v_cur := public.ofertare_f3_baza(c.licitatie_id);
    IF md5((v_cur->>'amprenta') || '|' || md5(coalesce(c.intrebare,''))) IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','baza s-a schimbat în timpul verificării'); END IF;
    SELECT string_agg(t,',' ORDER BY o) INTO v_sursa FROM unnest(string_to_array(coalesce(c.sursa,''),',')) WITH ORDINALITY x(t,o) WHERE t <> 'revizie_planse_auto';
    UPDATE public.ofertare_clarificari SET sursa=v_sursa, updated_at=now(),
      baza_generare=v_cur||
        CASE WHEN c.baza_generare->'exceptie_identitate'->>'token'=p_amprenta
          THEN jsonb_build_object('exceptie_identitate',c.baza_generare->'exceptie_identitate') ELSE '{}'::jsonb END ||
        jsonb_build_object('text_hash',md5(coalesce(c.intrebare,'')),'reconfirmare',v_decizie,
        'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
          CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii') THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
      WHERE id=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'decizie',p_decizie);
END $function$;
-- 9e. exportul: textul LIVE cu DOAR: blocul pe ambele prefixe, starea prin dispecer in mod tranzitie; ordinea ORDER BY nr FOR SHARE neschimbata
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE c public.ofertare_clarificari; v_st jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RAISE EXCEPTION 'fără acces'; END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id),false) THEN RAISE EXCEPTION 'Export blocat: fără drept de decizie pe licitație'; END IF;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND status='de_trimis' ORDER BY nr FOR SHARE LOOP
    IF coalesce(c.sursa,'') ~ '(^|,)revizie_' THEN RAISE EXCEPTION 'Clarificarea #% necesită revizie',c.nr; END IF;
    IF coalesce(c.cheie,'') ~ '^auto_(planse|surse)_' THEN
      v_st := public.fn_ofertare_ciorna_auto_stare(c,'tranzitie');
      IF coalesce(v_st->>'stare','') NOT IN ('ok','ok_identitate_limitata') THEN RAISE EXCEPTION 'Export blocat: %',v_st->>'text'; END IF;
    END IF;
    v_out := v_out || jsonb_build_array(to_jsonb(c));
  END LOOP;
  RETURN v_out;
END $function$;
-- 9f. exceptia de identitate: ramane DOAR pe auto_planse_* (decizia (d) a owner-ului); pe auto_surse_* refuz explicit
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_exceptie_identitate(p_id bigint,p_amprenta text,p_motiv text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_decizie jsonb; v_documente jsonb; v_metadate jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','autentificare necesară'); END IF;
  IF length(btrim(coalesce(p_motiv,''))) < 10 THEN RETURN jsonb_build_object('error','motivul trebuie să aibă minimum 10 caractere'); END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE id=p_id FOR UPDATE;
  IF FOUND AND coalesce(c.cheie,'') LIKE 'auto_surse_%' THEN RETURN jsonb_build_object('error','nu se aplică ciornelor de surse'); END IF;
  IF NOT FOUND OR coalesce(c.cheie,'') NOT LIKE 'auto_planse_%' THEN RETURN jsonb_build_object('error','nu e ciornă automată'); END IF;
  IF NOT coalesce(public.fn_ofertare_source_pack_poate_decide(c.licitatie_id),false) THEN
    RETURN jsonb_build_object('error','fără drept de decizie pe licitație');
  END IF;
  IF c.status IS NULL OR c.status NOT IN ('propunere','de_trimis') THEN RETURN jsonb_build_object('error','excepția se acceptă doar pentru o ciornă netransmisă'); END IF;
  v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
  IF p_amprenta IS NULL OR v_st->>'amprenta_curenta' IS DISTINCT FROM p_amprenta THEN
    RETURN jsonb_build_object('error','baza s-a schimbat — reîncarcă și verifică textul și documentele');
  END IF;
  IF coalesce(v_st->>'stare','') NOT IN ('identitate_limitata','ok_identitate_limitata') THEN
    RETURN jsonb_build_object('error',CASE WHEN v_st->>'stare'='identitate_contradictorie' THEN v_st->>'text'
      ELSE 'baza curentă nu cere excepție de identitate' END);
  END IF;
  SELECT jsonb_agg(x->'id' ORDER BY (x->>'id')::bigint),
    jsonb_object_agg(x->>'id',jsonb_build_object('fisier_path',x->'fisier_path','marime',x->'marime'))
    INTO v_documente,v_metadate FROM jsonb_array_elements(v_st->'curent'->'documente') x WHERE x->>'identitate'='limitata';
  v_decizie := jsonb_build_object('token',p_amprenta,'de',auth.uid(),'la',now(),'motiv',btrim(p_motiv),
    'documente',v_documente,'metadate',v_metadate,'decizie','exceptie_identitate');
  UPDATE public.ofertare_clarificari SET updated_at=now(),
    baza_generare=coalesce(c.baza_generare,'{}'::jsonb)||jsonb_build_object('exceptie_identitate',v_decizie,
      'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
        CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii')
          THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
    WHERE id=p_id;
  RETURN jsonb_build_object('ok',true,'id',p_id);
END $function$;
-- 9g. notificarea: textul LIVE (20261121a) cu DOAR: ambele prefixe, starea prin dispecer, ORDER BY nr FOR UPDATE (protocolul lock-urilor — singura
--     schimbare de ordine, declarata), o notificare pe amprenta (notificat_neactual = amprenta_curenta = token_curent la surse)
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_notifica(p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.ofertare_clarificari; v_st jsonb; v_resp uuid[]; v_n int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces'); END IF;
  -- 20261121a: ambii responsabili (fără NULL, fără dubluri)
  SELECT array(SELECT DISTINCT x FROM unnest(ARRAY[responsabil_id, responsabil2_id]) x WHERE x IS NOT NULL) INTO v_resp FROM public.ofertare_licitatii WHERE id=p_licitatie_id;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND cheie ~ '^auto_(planse|surse)_' AND status <> 'retrasa' ORDER BY nr FOR UPDATE LOOP
    v_st := public.fn_ofertare_ciorna_auto_stare(c,'afisare');
    IF v_st->>'stare' IN ('schimbata','indisponibila') AND v_st->>'amprenta_curenta' IS NOT NULL AND cardinality(v_resp) > 0 AND c.baza_generare->>'notificat_neactual' IS DISTINCT FROM v_st->>'amprenta_curenta' THEN
      INSERT INTO public.notifications(profile_id,type,modul,title,message,link_to)
        SELECT r,'info','Ofertare','Clarificare de reverificat','Licitația #'||p_licitatie_id||': baza s-a schimbat — de reverificat. Textul rămâne păstrat. Nimic trimis automat.','/ofertare'
        FROM unnest(v_resp) r;
      UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('notificat_neactual',v_st->>'amprenta_curenta') WHERE id=c.id;
      v_n:=v_n+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'notificari',v_n);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('error',SQLERRM);
END $function$;
-- 9h. vederea: aceleasi coloane (UI-ul le citeste dupa nume), ambele prefixe, starea prin dispecer; drepturile re-acordate IDENTIC cu cele fotografiate
DROP VIEW public.v_ofertare_clarificari_baza;
CREATE VIEW public.v_ofertare_clarificari_baza WITH (security_invoker = on) AS
SELECT c.id, c.licitatie_id, c.nr, c.status, s.x ->> 'stare' AS stare, s.x ->> 'mod_ciorna' AS mod_ciorna, s.x -> 'curent' ->> 'mod' AS mod_curent,
       s.x ->> 'amprenta_curenta' AS amprenta_curenta, coalesce((s.x ->> 'marcaj_planse')::boolean, false) AS marcaj_planse, s.x ->> 'text' AS text, s.x AS detalii
  FROM public.ofertare_clarificari c
 CROSS JOIN LATERAL (SELECT public.fn_ofertare_ciorna_auto_stare(c, 'afisare') AS x) s
 WHERE coalesce(c.cheie, '') ~ '^auto_(planse|surse)_' AND c.status <> 'retrasa';
REVOKE ALL ON public.v_ofertare_clarificari_baza FROM PUBLIC, anon, authenticated, service_role;
DO $acl$
DECLARE r record;
BEGIN
  FOR r IN SELECT rol, string_agg(drept, ', ' ORDER BY drept) AS drepturi FROM cm_view_acl WHERE rol <> 'postgres' GROUP BY rol LOOP
    EXECUTE format('GRANT %s ON public.v_ofertare_clarificari_baza TO %I', r.drepturi, r.rol);
  END LOOP;
END $acl$;
COMMENT ON VIEW public.v_ofertare_clarificari_baza IS 'R9b + 20270112a: starea review-ului textului exact pe baza curentă (auto_planse_* = baza F3; auto_surse_* = evaluarea publicată a semnalului), cu diferențe și valori pentru panoul intern. Necesita_review și luat_act nu sunt aprobări de export. security_invoker.';
-- 9i. proveniența (20261026a) — ABATERE DECLARATĂ față de inventarul planului (#7 „neatins”), găsită de dry-run-ul cu JWT complet: fn_ofertare_surse_valideaza
--     decide „utilizator” DOAR după rolul din request.jwt.claims; într-un RPC SECURITY DEFINER chemat de un om (ofertare_clarificare_reconfirma de azi,
--     fn_ofertare_semnal_raspuns_leaga de aici) rolul JWT rămâne „authenticated”, deci scrierea baza_generare / sursa pe o ciornă automată era refuzată
--     („Proveniența clarificării automate … o scrie doar serverul”). Textul LIVE EXACT, cu O schimbare: utilizator = rolul JWT ȘI current_user ∈ (authenticated, anon)
--     (în DEFINER current_user = proprietarul funcției, postgres; scrierile directe prin PostgREST rămân cu current_user = authenticated → refuzate ca azi).
--     Verificabil pe clonă cu JWT real pe o ciornă auto_planse_*: înainte de migrare reconfirmarea pică, după migrare trece. Revenirea readuce textul LIVE.
CREATE OR REPLACE FUNCTION public.fn_ofertare_surse_valideaza()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_lipsa bigint;
  v_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_utilizator boolean;
  -- 20261026a: pe ofertare_cerinte se validează surse_document_ids (blocul comun de la final), ca pe cantități.
  -- sursele derivate de server (clarificarea automată): un ID DISPĂRUT (inexistent global) se păstrează — codul îl tratează ca
  -- neverificabil = exclus; un ID existent în ALTĂ licitație se refuză ca la orice scriere (review Copilot r1 P1 #1)
  v_derivat boolean := false;
  v_max constant int := 20000;   -- fără trunchiere: baza F3 a clarificării automate poate avea sute de rânduri (Jakarinos r6 P2)
BEGIN
  -- 20270112a: scrierile din RPC-urile SECURITY DEFINER (current_user = proprietarul) nu sunt scrieri de utilizator, oricare ar fi rolul din JWT
  v_utilizator := v_rol IN ('authenticated', 'anon') AND current_user IN ('authenticated', 'anon');
  IF v_utilizator THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.surse_document_ids IS NOT NULL THEN
        RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
      END IF;
      IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
        -- originile rezervate serverului (automat, platforma) nu se inserează de utilizator (review Copilot r3 P1)
        IF NEW.surse_cerinte_ids IS NOT NULL OR NEW.surse_cantitati_ids IS NOT NULL OR NEW.origine IN ('automat', 'platforma') THEN
          RAISE EXCEPTION 'Sursele (surse_*) și clarificările generate (automat / platforma) le scrie doar serverul' USING ERRCODE = '42501';
        END IF;
      END IF;
    ELSE
      IF NEW.surse_document_ids IS DISTINCT FROM OLD.surse_document_ids THEN
        RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
      END IF;
      IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
        IF NEW.surse_cerinte_ids IS DISTINCT FROM OLD.surse_cerinte_ids OR NEW.surse_cantitati_ids IS DISTINCT FROM OLD.surse_cantitati_ids THEN
          RAISE EXCEPTION 'Sursele (surse_*) le scrie doar serverul' USING ERRCODE = '42501';
        END IF;
        -- originea e atribut de proveniență: imuabilă pentru utilizator după INSERT (fără spălare platforma -> manual, Copilot r3 P1)
        IF NEW.origine IS DISTINCT FROM OLD.origine THEN
          RAISE EXCEPTION 'Originea clarificării nu se schimbă după creare' USING ERRCODE = '42501';
        END IF;
        IF OLD.origine = 'automat' AND (NEW.sursa, NEW.baza_generare) IS DISTINCT FROM (OLD.sursa, OLD.baza_generare) THEN
          RAISE EXCEPTION 'Proveniența clarificării automate (origine / sursa / baza_generare) o scrie doar serverul' USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'ofertare_clarificari' THEN
    -- Clarificarea AUTOMATĂ din planșe (ofertare_clarificare_planse_auto, scrisă doar de server): sursele se derivă din
    -- ce a folosit funcția — planșele din `sursa` („planse_auto:475,474,…”), documentele și rândurile de cantități din
    -- baza_generare. Fără să rescriem RPC-ul de 12k. La UPDATE sursele NU scad (reuniune cu cele vechi, Jakarinos r6 P1 #6):
    -- o ciornă protejată își poate păstra textul despre o planșă scoasă din `sursa` — planșa rămâne în proveniență.
    IF NEW.origine = 'automat' AND (TG_OP = 'INSERT' OR NEW.sursa IS DISTINCT FROM OLD.sursa
                                    OR NEW.baza_generare IS DISTINCT FROM OLD.baza_generare OR NEW.origine IS DISTINCT FROM OLD.origine
                                    OR NEW.surse_document_ids IS DISTINCT FROM OLD.surse_document_ids
                                    OR NEW.surse_cantitati_ids IS DISTINCT FROM OLD.surse_cantitati_ids) THEN
      NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT t::bigint AS x FROM unnest(string_to_array(replace(coalesce(NEW.sursa, ''), 'planse_auto:', ''), ',')) t
           WHERE coalesce(NEW.sursa, '') LIKE 'planse_auto:%' AND t ~ '^[0-9]{1,18}$'
          UNION
          SELECT (e->>'id')::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'documente') = 'array'
                                                                   THEN NEW.baza_generare->'documente' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$'
          UNION
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_document_ids END) y WHERE y IS NOT NULL
          UNION   -- 20261026a: sursele scrise EXPLICIT de server odată cu textul (ofertare_clarificare_planse_auto)
          SELECT y FROM unnest(NEW.surse_document_ids) y WHERE y IS NOT NULL) s);
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
          SELECT (e->>'id')::bigint AS x
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.baza_generare->'randuri') = 'array'
                                           THEN NEW.baza_generare->'randuri' ELSE '[]'::jsonb END) e
           WHERE e->>'id' ~ '^[0-9]{1,18}$'
          UNION
          SELECT y FROM unnest(CASE WHEN TG_OP = 'UPDATE' THEN OLD.surse_cantitati_ids END) y WHERE y IS NOT NULL
          UNION   -- 20261026a: idem, cantitățile scrise explicit
          SELECT y FROM unnest(NEW.surse_cantitati_ids) y WHERE y IS NOT NULL) s);
      v_derivat := true;
    END IF;
    IF NEW.surse_cerinte_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cerinte_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cerinte_ids) > v_max THEN
        RAISE EXCEPTION 'surse_cerinte_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
      END IF;
      NEW.surse_cerinte_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cerinte_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cerinte_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte c WHERE c.id = x AND c.licitatie_id = NEW.licitatie_id) LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'surse_cerinte_ids: cerința % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
    IF NEW.surse_cantitati_ids IS NOT NULL THEN
      IF array_position(NEW.surse_cantitati_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_cantitati_ids) > v_max THEN
        RAISE EXCEPTION 'surse_cantitati_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
      END IF;
      NEW.surse_cantitati_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_cantitati_ids) x);
      SELECT x INTO v_lipsa FROM unnest(NEW.surse_cantitati_ids) x
       WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_cantitati q WHERE q.id = x AND q.licitatie_id = NEW.licitatie_id)
         AND (NOT v_derivat OR EXISTS (SELECT 1 FROM public.ofertare_cantitati q WHERE q.id = x)) LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'surse_cantitati_ids: cantitatea % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
    END IF;
  END IF;
  -- surse_document_ids: pe ambele tabele
  IF NEW.surse_document_ids IS NOT NULL THEN
    IF array_position(NEW.surse_document_ids, NULL) IS NOT NULL OR cardinality(NEW.surse_document_ids) > v_max THEN
      RAISE EXCEPTION 'surse_document_ids: fără NULL, maxim %', v_max USING ERRCODE = '22023';
    END IF;
    NEW.surse_document_ids := (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.surse_document_ids) x);
    SELECT x INTO v_lipsa FROM unnest(NEW.surse_document_ids) x
     WHERE NOT EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x AND d.licitatie_id = NEW.licitatie_id)
       AND (NOT v_derivat OR EXISTS (SELECT 1 FROM public.ofertare_documente_atribuire d WHERE d.id = x)) LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'surse_document_ids: documentul % nu există în licitația %', v_lipsa, NEW.licitatie_id USING ERRCODE = '23503'; END IF;
  END IF;
  RETURN NEW;
END$fn$;

-- ─── 10. Postcondiții (exacte): funcțiile noi (limbaj / definer / volatil / drepturi ca rol:drept), corpurile rescrise (amprentă + ACL păstrat),
--     triggerele, tabelele (RLS, politici, drepturi), UNIQUE-ul, vederea (coloane, opțiune, drepturi), lanțul de apel al funcțiilor noi ──────
DO $post$
DECLARE r record; v_rau text; v_alt text; v_n integer;
BEGIN
  -- functiile noi: limbaj / definer / volatil / strict / leakproof / search_path / proprietar / drepturi EXACTE (forma amprentei, rol:drept)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_ofertare_masura_identitate(bigint,integer,text,text,text,text)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_trg_ofertare_masuratori_licitatie()', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_trg_ofertare_masuratori_imuabil()', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_norm(text)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_numar_ro(text)', 'plpgsql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_um_canonica(text,text)', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_dn(text)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_clasifica(text,text,text,numeric[],text,text,text)', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_lot(text,integer[],text)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_pagini_permise(jsonb,integer)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_pagini(text)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_pagina(text,integer)', 'plpgsql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_verifica(text,jsonb)', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_felii_autoritative(bigint)', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_pagini_neacoperite(text,bigint)', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnale_fotografie(bigint)', 'plpgsql', true, 's', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_semnale_context(bigint,text,bigint)', 'plpgsql', true, 's', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_semnale_felii(bigint,bigint[],bigint,integer,integer)', 'sql', true, 's', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_semnal_rezolvat(public.ofertare_cantitati_semnale)', 'sql', true, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnal_ciorna_libera(public.ofertare_clarificari)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnal_upsert(bigint,bigint,integer,text,text,text,text)', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_ofertare_masura_numar_text(numeric)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnal_text(bigint,bigint)', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_ofertare_semnale_setari(bigint,numeric,integer)', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_ofertare_semnal_raspuns_leaga(bigint,bigint,numeric)', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_ofertare_semnale_lista(bigint)', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_ofertare_masuratori_propune(bigint,uuid,jsonb,jsonb)', 'plpgsql', true, 'v', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_semnale_publica(bigint,bigint,uuid)', 'plpgsql', true, 'v', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.ofertare_semnal_baza_stare(public.ofertare_clarificari,text)', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari,text)', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE')
    ) v(fn, limbaj, definer, volatil, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.provolatile = r.volatil
                      AND p.prokind = 'f' AND NOT p.proisstrict AND NOT p.proleakproof
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                      AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                               FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = r.acl) THEN
      RAISE EXCEPTION '20270112a: postconditie: functia % (limbaj / definer / volatil / strict / leakproof / search_path / owner / drepturi exacte)', r.fn;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND (p.proname LIKE 'fn\_ofertare\_masura\_%' OR p.proname LIKE 'fn\_ofertare\_semnal%' OR p.proname LIKE 'fn\_ofertare\_masuratori\_%'
        OR p.proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare', 'fn_trg_ofertare_masuratori_licitatie', 'fn_trg_ofertare_masuratori_imuabil'));
  IF v_n <> 30 THEN RAISE EXCEPTION '20270112a: postconditie: % functii noi in loc de 30 (supraincarcari sau lipsuri)', v_n; END IF;
  -- corpurile rescrise: amprenta noua EXACTA (valorile = md5 al textului din acest fisier, verificate de proba PGlite), proprietati si ACL pastrate
  FOR r IN SELECT * FROM (VALUES
      -- >>> AMPRENTE NOI
      ('public.fn_trg_ofertare_clarificari_baza()', 'fde8334c4a8af8db114423e95220b74f', false, '{postgres=X/postgres}'),
      ('public.ofertare_clarificare_reconfirma(bigint,text,text,text)', 'c01c40284cb4513abb79aa9eea69e86b', true, '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.ofertare_clarificare_exceptie_identitate(bigint,text,text)', 'd35e5e1fb801d843a9d5192ce30df282', true, '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.ofertare_clarificari_export(bigint)', '328b25f3431c5fc51a016d5ef359e453', false, '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.ofertare_clarificari_notifica(bigint)', 'c18e8787e66b34f6b69b0d005f344896', true, '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.fn_ofertare_surse_valideaza()', '739ba119df5d51bc4981091de810a25e', true, '{postgres=X/postgres}')
      -- <<< AMPRENTE NOI
    ) v(fn, corp_md5, definer, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(r.fn)
                     AND md5(replace(p.prosrc, chr(13), '')) = r.corp_md5 AND l.lanname = 'plpgsql' AND p.prosecdef = r.definer
                     AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '20270112a: postconditie: % nu are corpul / proprietatile asteptate dupa rescriere', r.fn;
    END IF;
    -- ACL-ul: identic cu cel fotografiat in $stare$ (CREATE OR REPLACE il pastreaza); forma asteptata documentata in VALUES
    IF (SELECT string_agg(rol || ':' || drept, ', ' ORDER BY rol || ':' || drept COLLATE "C") FROM cm_fn_acl WHERE fn = r.fn)
       IS DISTINCT FROM (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                           SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type AS d
                             FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE p.oid = to_regprocedure(r.fn)) a) THEN
      RAISE EXCEPTION '20270112a: postconditie: drepturile functiei % s-au schimbat la rescriere', r.fn;
    END IF;
  END LOOP;
  -- dependenta neatinsa (baza F3 a ciornelor de planse)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.ofertare_clarificare_baza_stare(bigint,text,text,jsonb)') AND md5(replace(p.prosrc, chr(13), '')) = '1eb3d1c9992ff06a6e76fb79692a9313') THEN
    RAISE EXCEPTION '20270112a: postconditie: ofertare_clarificare_baza_stare schimbata';
  END IF;
  -- triggerul de provenienta ramane pe aceeasi functie, neschimbat ca definitie (doar corpul functiei e rescris)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND tg.tgname = 'a02_ofertare_clarificari_surse'
                   AND tg.tgfoid = to_regprocedure('public.fn_ofertare_surse_valideaza()') AND tg.tgenabled = 'O' AND tg.tgtype = 23) THEN
    RAISE EXCEPTION '20270112a: postconditie: triggerul a02_ofertare_clarificari_surse';
  END IF;
  -- triggerele: pe ofertare_clarificari lista neschimbata si trg_ofertare_clarificari_baza exact; pe tabelele noi, exact
  IF (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_clarificari'::regclass AND NOT tgisinternal)
       IS DISTINCT FROM 'a02_ofertare_clarificari_surse, trg_ofertare_cb_clarificari_jurnal, trg_ofertare_clarificari_baza'
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_clarificari'::regclass AND tg.tgname = 'trg_ofertare_clarificari_baza'
                      AND tg.tgfoid = to_regprocedure('public.fn_trg_ofertare_clarificari_baza()') AND tg.tgtype = 31 AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0) THEN
    RAISE EXCEPTION '20270112a: postconditie: triggerele ofertare_clarificari';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.ofertare_cantitati_masuratori', 'trg_ofertare_masuratori_licitatie', 'public.fn_trg_ofertare_masuratori_licitatie()', 23),
      ('public.ofertare_cantitati_masuratori', 'trg_ofertare_masuratori_imuabil', 'public.fn_trg_ofertare_masuratori_imuabil()', 27),
      ('public.ofertare_cantitati_evaluari', 'trg_ofertare_evaluari_imuabil', 'public.fn_trg_ofertare_masuratori_imuabil()', 27)) v(t, tg, fn, tip) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = r.t::regclass AND tg.tgname = r.tg AND NOT tg.tgisinternal AND tg.tgfoid = to_regprocedure(r.fn)
                     AND tg.tgtype = r.tip AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgattr = ''::int2vector) THEN
      RAISE EXCEPTION '20270112a: postconditie: triggerul % pe %', r.tg, r.t;
    END IF;
  END LOOP;
  IF (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_cantitati_masuratori'::regclass AND NOT tgisinternal)
       IS DISTINCT FROM 'trg_ofertare_masuratori_imuabil, trg_ofertare_masuratori_licitatie'
     OR (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger WHERE tgrelid = 'public.ofertare_cantitati_evaluari'::regclass AND NOT tgisinternal)
       IS DISTINCT FROM 'trg_ofertare_evaluari_imuabil' THEN
    RAISE EXCEPTION '20270112a: postconditie: lista triggerelor pe masuratori / evaluari';
  END IF;
  -- tabelele noi: RLS activ, o singura politica (SELECT, authenticated), drepturi EXACTE (authenticated / service_role: SELECT; anon / PUBLIC: nimic)
  FOR r IN SELECT * FROM (VALUES
      ('public.ofertare_elemente_masura', 'ofertare_elemente_masura_select', '(auth.uid() IS NOT NULL)'),
      ('public.ofertare_tipare_cantitate', 'ofertare_tipare_cantitate_select', '(auth.uid() IS NOT NULL)'),
      ('public.ofertare_cantitati_setari', 'ofertare_cantitati_setari_select', '((auth.uid() IS NOT NULL) AND fn_are_acces_ofertare())'),
      ('public.ofertare_cantitati_evaluari', 'ofertare_cantitati_evaluari_select', '((auth.uid() IS NOT NULL) AND fn_are_acces_ofertare())'),
      ('public.ofertare_cantitati_semnale', 'ofertare_cantitati_semnale_select', '((auth.uid() IS NOT NULL) AND fn_are_acces_ofertare())'),
      ('public.ofertare_cantitati_masuratori', 'ofertare_cantitati_masuratori_select', '((auth.uid() IS NOT NULL) AND fn_are_acces_ofertare())')) v(t, pol, qual) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = r.t::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity)
       OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = r.t::regclass) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.t::regclass AND p.polname = r.pol AND p.polcmd = 'r' AND p.polpermissive
                        AND p.polroles = ARRAY['authenticated'::regrole]::oid[] AND pg_get_expr(p.polqual, p.polrelid) = r.qual AND p.polwithcheck IS NULL)
       OR (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type AS d
               FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = r.t::regclass AND pg_get_userbyid(e.grantee) <> 'postgres') a)
          IS DISTINCT FROM 'authenticated:SELECT, service_role:SELECT' THEN
      RAISE EXCEPTION '20270112a: postconditie: RLS / politica / drepturile tabelului %', r.t;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.ofertare_elemente_masura) <> 139 OR (SELECT count(*) FROM public.ofertare_tipare_cantitate) <> 19 THEN
    RAISE EXCEPTION '20270112a: postconditie: listele inchise (139 elemente, 19 tipare)';
  END IF;
  -- UNIQUE (licitatie_id, nr), validat
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.ofertare_clarificari'::regclass AND c.conname = 'ofertare_clarificari_licitatie_nr_uq' AND c.contype = 'u'
                   AND c.convalidated AND pg_get_constraintdef(c.oid) = 'UNIQUE (licitatie_id, nr)') THEN
    RAISE EXCEPTION '20270112a: postconditie: UNIQUE (licitatie_id, nr) pe ofertare_clarificari';
  END IF;
  -- vederea: aceleasi coloane (ordinea si numele), security_invoker, dispecerul in definitie, drepturile identice cu cele fotografiate
  IF (SELECT string_agg(a.attname::text, ',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = 'public.v_ofertare_clarificari_baza'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM 'id,licitatie_id,nr,status,stare,mod_ciorna,mod_curent,amprenta_curenta,marcaj_planse,text,detalii'
     OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass AND c.relkind = 'v' AND 'security_invoker=on' = ANY (c.reloptions))
     OR pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass) NOT LIKE '%fn_ofertare_ciorna_auto_stare(c.*, ''afisare''::text)%'
     OR pg_get_viewdef('public.v_ofertare_clarificari_baza'::regclass) NOT LIKE '%~ ''^auto_(planse|surse)_''%'
     OR (SELECT string_agg(rol || ':' || drept, ', ' ORDER BY rol || ':' || drept COLLATE "C") FROM cm_view_acl)
        IS DISTINCT FROM (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                            SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type AS d
                              FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.v_ofertare_clarificari_baza'::regclass) a) THEN
    RAISE EXCEPTION '20270112a: postconditie: vederea v_ofertare_clarificari_baza (coloane / security_invoker / dispecer / drepturi)';
  END IF;
  -- protocolul lock-urilor: niciuna dintre functiile circuitului nu ia advisory si nu parcurge ciornele ORDER BY id FOR UPDATE; advisory DOAR in propune / publica
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.fn_trg_ofertare_clarificari_baza()'), to_regprocedure('public.ofertare_clarificare_reconfirma(bigint,text,text,text)'),
               to_regprocedure('public.ofertare_clarificare_exceptie_identitate(bigint,text,text)'), to_regprocedure('public.ofertare_clarificari_export(bigint)'),
               to_regprocedure('public.ofertare_clarificari_notifica(bigint)'), to_regprocedure('public.ofertare_semnal_baza_stare(public.ofertare_clarificari,text)'),
               to_regprocedure('public.fn_ofertare_ciorna_auto_stare(public.ofertare_clarificari,text)'), to_regprocedure('public.fn_ofertare_semnal_raspuns_leaga(bigint,bigint,numeric)'))
               AND (p.prosrc ~* 'pg_advisory' OR p.prosrc ~* 'ORDER BY id FOR UPDATE'))
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ 'pg_advisory_xact_lock\(hashtextextended\(''ofertare_cantitati_semnale:') <> 2 THEN
    RAISE EXCEPTION '20270112a: postconditie: protocolul lock-urilor (advisory / ORDER BY id FOR UPDATE)';
  END IF;
  -- functiile noi cheama (in afara pg_catalog) DOAR: una pe alta, auth.uid, fn_are_acces_ofertare, fn_ofertare_source_pack_poate_decide, ofertare_clarificare_baza_stare; nimic dinamic
  SELECT string_agg(DISTINCT p2.oid::regprocedure::text, ', ') INTO v_alt
    FROM pg_proc p CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*[(]', 'g') w
    JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1]) AND p2.oid <> p.oid
   WHERE p.pronamespace = 'public'::regnamespace
     AND (p.proname LIKE 'fn\_ofertare\_masura\_%' OR p.proname LIKE 'fn\_ofertare\_semnal%' OR p.proname LIKE 'fn\_ofertare\_masuratori\_%'
          OR p.proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare', 'fn_trg_ofertare_masuratori_licitatie', 'fn_trg_ofertare_masuratori_imuabil'))
     AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND NOT (p2.pronamespace = 'public'::regnamespace AND (p2.proname LIKE 'fn\_ofertare\_masura\_%' OR p2.proname LIKE 'fn\_ofertare\_semnal%' OR p2.proname LIKE 'fn\_ofertare\_masuratori\_%'
          OR p2.proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare')))
     AND p2.oid NOT IN (to_regprocedure('auth.uid()'), to_regprocedure('public.fn_are_acces_ofertare()'), to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)'),
                        to_regprocedure('public.ofertare_clarificare_baza_stare(bigint,text,text,jsonb)'));
  IF v_alt IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                  AND (p.proname LIKE 'fn\_ofertare\_masura\_%' OR p.proname LIKE 'fn\_ofertare\_semnal%' OR p.proname LIKE 'fn\_ofertare\_masuratori\_%'
                       OR p.proname IN ('fn_ofertare_numar_ro', 'fn_ofertare_um_canonica', 'fn_ofertare_ciorna_auto_stare', 'ofertare_semnal_baza_stare', 'fn_trg_ofertare_masuratori_licitatie', 'fn_trg_ofertare_masuratori_imuabil'))
                  AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '[[:<:]]execute[[:>:]]') THEN
    RAISE EXCEPTION '20270112a: postconditie: functiile noi cheama in afara lantului declarat: %', coalesce(v_alt, 'cod dinamic');
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270112a_ofertare_cantitati_masuratori:' || txid_current() THEN
    RAISE EXCEPTION '20270112a: garda final invalida';
  END IF;
  RAISE NOTICE '20270112a: sfarsit la % ms de la BEGIN, lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
