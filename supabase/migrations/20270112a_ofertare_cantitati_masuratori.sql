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
  UNIQUE (fel, tipar)
);
-- antetele: forme normalizate (minuscule, fara diacritice; tokenii multi-cuvant se lipesc cu „_” inaintea impartirii); cuvintele-cheie: regex
-- POSIX pe textul normalizat, cuvantul INAINTEA numarului (spec §3.2); verificarea textului liber e in trepte (fn_ofertare_masura_verifica)
INSERT INTO public.ofertare_tipare_cantitate (id, fel, tipar) VALUES
  (1, 'antet_cantitate', 'cantitate'), (2, 'antet_cantitate', 'cant.'), (3, 'antet_cantitate', 'cant'), (4, 'antet_cantitate', 'cantit.'),
  (5, 'antet_cantitate', 'lungime'), (6, 'antet_cantitate', 'l (m)'), (7, 'antet_cantitate', 'nr. buc'), (8, 'antet_cantitate', 'volum'),
  (9, 'antet_cantitate', 'suprafata'),
  (11, 'antet_um', 'um'), (12, 'antet_um', 'u.m.'), (13, 'antet_um', 'u/m'), (14, 'antet_um', 'unitate'), (15, 'antet_um', 'unit.'),
  (21, 'cuvant_cheie', 'lungime( totala)?'), (22, 'cuvant_cheie', 'l'), (23, 'cuvant_cheie', 'in lungime( totala)? de'),
  (24, 'cuvant_cheie', 'cantitate'), (25, 'cuvant_cheie', 'numar( de bucati)?|nr\.?( buc\.?)?');
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

-- @@SECTIUNE_7@@

-- ─── 99. Postcondiții ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE r record; v_rau text; v_alt text;
BEGIN
  -- @@POST@@
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270112a_ofertare_cantitati_masuratori:' || txid_current() THEN
    RAISE EXCEPTION '20270112a: garda final invalida';
  END IF;
  RAISE NOTICE '20270112a: sfarsit la % ms de la BEGIN, lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
