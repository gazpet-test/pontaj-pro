-- Version 20270110120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270110a_achizitii_retur_furnizor.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA). Manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh --iesire, docs/LIVRARE_L15_V2.md §5); lista OBIECTELOR revizuită (generată pe PGlite cu pașii reali ai
--   runnerului): supabase/tests/20270110a_achizitii_retur_furnizor.l15.obiecte.tsv.
--   Dry-run pe clonă după aplicare (ROLLBACK): supabase/tests/20270110a_achizitii_retur_furnizor_dryrun.sql.
-- 20270110a_achizitii_retur_furnizor — Achiziții: retur la furnizor pe reperele unei comenzi (TKT-2026-0347), PR1 = baza de date.
--   Specificația: docs/superpowers/specs/2026-11-24-achizitii-retur-furnizor-design.md (v10); planul: docs/superpowers/plans/2026-11-24-achizitii-retur-furnizor.md.
-- Ce face:
--   * comenzi_furnizor_linii: coloana intrare_reconciliata (marcajul moștenirii, §3.3b), CHECK intrata_stoc <= coalesce(primita, cantitate) (NOT VALID +
--     VALIDATE după preflight), cantitățile (cantitate_primita, cantitate_intrata_stoc, intrare_reconciliata) NU mai pot fi scrise de client:
--     dreptul UPDATE pe tabel al lui authenticated devine UPDATE doar pe celelalte coloane + trigger-ul trg_cfl_protectie (orice cale, și postgres /
--     service_role) care cere marcajul de tranzacție pus DOAR de RPC-urile acestei migrări (SET LOCAL app.cf_cantitati); identitatea materialului
--     (denumire, um, comanda, iar pe liniile NULL și cantitatea) e înghețată de la prima dovadă de recepție; mutarea liniei în altă comandă e
--     refuzată la orice urmă de recepție pe linie, pe comanda sursă SAU pe destinație, iar marcajul moștenirii se recalculează pentru destinație (r2).
--   * tabele noi: comenzi_furnizor_retururi (retururi + anulări), comenzi_furnizor_receptii (jurnalul recepțiilor: sold inițial / recepție /
--     corectură), comenzi_furnizor_retur_alocari (recepție → retur), comenzi_furnizor_intentii (cheile de idempotență ale tuturor RPC-urilor).
--     RLS: citire pentru cine vede comanda; nicio scriere pentru clienți (doar RPC-urile); UPDATE / DELETE / TRUNCATE refuzate de trigger-e.
--   * stocuri_miscari: tipurile retur_furnizor (delta < 0) și retur_furnizor_anulare (delta > 0), cu ref_tip = 'comanda_furnizor_retur';
--     lock-ul pe cheia stocului la ORICE ieșire (trigger BEFORE INSERT WHEN delta < 0, din orice cale) și la ștergeri (mișcări și poziții);
--     istoricul de achiziție / retur nu se mai poate șterge sau modifica; mișcările de achiziție / retur se scriu DOAR prin RPC (marcajul).
--   * RPC-uri SECURITY DEFINER (dreptul reverificat DUPĂ lock-uri și după ultima operație care poate aștepta, cheie de idempotență pe fiecare): fn_cf_receptie_adauga, fn_cf_intra_stoc,
--     fn_cf_retur_inregistreaza, fn_cf_retur_anuleaza, fn_cf_retur_inchide_fara_inlocuire, fn_cf_reconciliaza_linie (owner), fn_stoc_sterge_pozitie (owner).
-- Ce NU face: nu schimbă statusul comenzilor, nu atinge facturi / note de credit, nu trimite nimic, nu modifică niciun rând existent (în afara
--   coloanei noi, false peste tot); atribuirea moștenirii (intrata_stoc din mișcările vechi) e DML separat: scripts/achizitii_retur_reconciliere_mostenire.sql
--   (preview / aplica, cu „da”-ul owner-ului). Până la reconcilierea unei linii vechi, pe ea merge doar recepția pozitivă.
-- ORDINEA LIVRĂRII: (1) această migrare, (2) imediat după, PR2 (interfața prin RPC-uri). Între cele două, ecranul vechi primește refuz curat
--   (CF_CLIENT_VECHI: „reîncărcați pagina”) la recepția pe repere, predarea în stoc și transportul direct: nimic scris. Până la PR2 se folosește
--   varianta C (ajustare manuală în Magazie).
-- ABATERI DECLARATE față de spec / plan (raportul PR-ului):
--   * cheia lock-ului de stoc = textul EXACT din stocuri (decizia 2 a planului), nu denumirea normalizată din spec §3.2;
--   * comenzile anulata / respinsa / de servicii (decizia 3) și cele încă neemise (draft / in_aprobare) refuză toate RPC-urile;
--   * pasul 0 al ordinii lock-urilor = lock-ul consultativ pe cheia de idempotență (înaintea pașilor 1–4 ai deciziei 4);
--   * REVOKE pe coloane nu are efect cât authenticated are UPDATE pe TABEL → REVOKE UPDATE pe tabel + GRANT UPDATE pe celelalte coloane; drepturile
--     celorlalte roluri neschimbate (trigger-ul se aplică oricui); o coloană nouă adăugată pe viitor cere GRANT explicit;
--   * trg_cfl_protectie e și BEFORE INSERT (o linie nouă nu poate veni cu cantități scrise; marcajul de reconciliere îl calculează serverul);
--   * în plus: provenienta pe stocuri_miscari (mișcările de achiziție / retur doar prin RPC), UPDATE pe istoricul protejat refuzat, cantitățile
--     cu mai mult de 3 zecimale refuzate (stocuri.cantitate e numeric(15,3): altfel s-ar rotunji în tăcere).
-- ORDINEA LOCK-URILOR (L06), aceeași în toate RPC-urile și trigger-ele (scrisă și în fiecare funcție):
--   0 cheia de idempotență (pg_advisory_xact_lock) → 1 comenzi_furnizor FOR SHARE → 2 comenzi_furnizor_linii FOR UPDATE → 3 cheile de stoc:
--   TOATE cheile pe care operația le atinge (intrare SAU ieșire; la transportul direct sediul ȘI proiectul), ÎNAINTEA primei mișcări: întâi
--   lock-urile consultative (pg_advisory_xact_lock) sortate crescător după fn_stoc_cheie, apoi rândurile din stocuri FOR UPDATE în aceeași ordine
--   → 4 comenzi_furnizor_retururi FOR UPDATE în ordinea id-ului.
--   Implicite, toate pe lock-uri deja ținute: FK la INSERT (KEY SHARE pe linie / comandă / mișcare / recepție); trigger-ul ieșirilor (cheia,
--   re-intrant); trigger-ul AFTER INSERT de pe stocuri_miscari (UPDATE pe rândul din stocuri blocat la pasul 3); fn_transfer_executa (mișcările
--   transferului, pe cele două chei luate la pasul 3: nicio cheie nouă după o mișcare — r2, inversarea rând → cheie față de cheie → rând).
--   Trigger-ul de identitate al liniei ia doar pasul 1 (rândul liniei e deja blocat de UPDATE); la mutarea liniei, ambele comenzi FOR SHARE în
--   ordinea id-ului.
--   DREPTUL (L01): verificat după lock-uri și REVERIFICAT după ultima operație care poate aștepta, la închiderea intenției
--   (fn_cf_intentie_inchide_intern, înaintea INSERT-ului intenției, care nu așteaptă: cheia ținută de la pasul 0, fără FK / trigger de inserare);
--   fn_stoc_sterge_pozitie îl reverifică după ștergeri.
-- Lock la aplicare (punct unic, NOWAIT, bugetul 1 s de la prima încercare, docs/LIVRARE_L15_V2.md §9): comenzi_furnizor SHARE ROW EXCLUSIVE (FK noi),
--   comenzi_furnizor_linii ACCESS EXCLUSIVE, stocuri_miscari ACCESS EXCLUSIVE, stocuri SHARE ROW EXCLUSIVE (trigger nou), toate într-un sub-bloc
--   (ocupat = lock-urile luate se eliberează, reîncercare la 50 ms).
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, garda finală.
-- Porțile: funcțiile expuse nu conțin cuvintele verificate de GATE 0e (marcajul = SET LOCAL static); niciun SQL dinamic; niciun obiect izo_* /
--   magazie_bucati* / profiles atins (proba PGlite rulează 0e și poarta E2 înainte / după; detectorul porti_regula.mjs: „nu atinge perimetrul”).
-- Revenire: supabase/revenire/20270110a_achizitii_retur_furnizor_ROLLBACK.sql (ÎNTÂI PR2 înapoi, apoi revenirea).
-- Probe: scripts/pglite/test_achizitii_retur_local.mjs (complet + mutanți); concurența: supabase/tests/20270110a_achizitii_retur_furnizor_concurenta.sh.
DO $pre$
DECLARE v_plafon text; r record; v_tip text; v_astept text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270110a_achizitii_retur_furnizor:' || txid_current() THEN
    RAISE EXCEPTION '20270110a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270110a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270110a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270110a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270110a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20270109a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270110a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR r IN SELECT * FROM (VALUES ('comenzi_furnizor'), ('comenzi_furnizor_linii'), ('stocuri'), ('stocuri_miscari'), ('profiles'), ('user_module_access'),
      ('transferuri_interne'), ('transferuri_linii')) v(t) LOOP
    IF to_regclass('public.' || r.t) IS NULL THEN RAISE EXCEPTION '20270110a: lipseste public.%', r.t; END IF;
  END LOOP;
  -- reaplicare = refuz (orice urmă a obiectelor migrării)
  IF to_regclass('public.comenzi_furnizor_retururi') IS NOT NULL OR to_regclass('public.comenzi_furnizor_receptii') IS NOT NULL
     OR to_regclass('public.comenzi_furnizor_retur_alocari') IS NOT NULL OR to_regclass('public.comenzi_furnizor_intentii') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor_linii'::regclass AND a.attname = 'intrare_reconciliata' AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace
                  AND k.conname IN ('comenzi_furnizor_linii_intrata_sub_primita_check', 'stocuri_miscari_retur_furnizor_check'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('trg_stoc_miscari_lock_iesire', 'trg_stoc_miscari_provenienta',
                  'trg_stoc_miscari_lock_stergere', 'trg_stoc_miscari_istoric_update', 'trg_stocuri_lock_stergere', 'trg_cfl_protectie'))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                  AND (p.proname LIKE 'fn\_cf\_%intern' OR p.proname LIKE 'fn\_cf\_retur%' OR p.proname LIKE 'fn\_stoc\_miscar%'
                       OR p.proname IN ('fn_cf_receptie_adauga', 'fn_cf_intra_stoc', 'fn_cf_reconciliaza_linie', 'fn_stoc_sterge_pozitie', 'fn_stoc_cheie', 'fn_stoc_cheie_lock',
                                        'fn_stoc_blocheaza', 'fn_stocuri_lock_stergere', 'fn_cfl_protectie', 'fn_cf_alocari_garda', 'fn_cf_jurnal_garda'))) THEN
    RAISE EXCEPTION '20270110a: CF_DEJA_APLICATA: obiectele migrarii exista deja (reaplicare); nimic schimbat';
  END IF;
  -- coloanele citite / scrise de funcțiile noi, cu tipul EXACT (pg_attribute + format_type), citite din catalog, nu ghicite
  FOR r IN SELECT * FROM (VALUES
      ('comenzi_furnizor', 'id', 'bigint', true), ('comenzi_furnizor', 'numar_comanda', 'text', true), ('comenzi_furnizor', 'proiect_id', 'bigint', false),
      ('comenzi_furnizor', 'livrare_tip', 'text', true), ('comenzi_furnizor', 'status', 'text', true), ('comenzi_furnizor', 'este_servicii', 'boolean', true),
      ('comenzi_furnizor', 'receptie_mp_la', 'timestamp with time zone', false), ('comenzi_furnizor', 'receptie_achizitii_la', 'timestamp with time zone', false),
      ('comenzi_furnizor_linii', 'id', 'bigint', true), ('comenzi_furnizor_linii', 'comanda_furnizor_id', 'bigint', true),
      ('comenzi_furnizor_linii', 'comanda_linie_id', 'bigint', false), ('comenzi_furnizor_linii', 'denumire', 'text', true),
      ('comenzi_furnizor_linii', 'um', 'text', false), ('comenzi_furnizor_linii', 'cantitate', 'numeric', true),
      ('comenzi_furnizor_linii', 'pret_unitar', 'numeric', false), ('comenzi_furnizor_linii', 'termen_livrare', 'date', false),
      ('comenzi_furnizor_linii', 'observatii', 'text', false), ('comenzi_furnizor_linii', 'display_order', 'integer', true),
      ('comenzi_furnizor_linii', 'created_at', 'timestamp with time zone', true), ('comenzi_furnizor_linii', 'cantitate_primita', 'numeric', false),
      ('comenzi_furnizor_linii', 'cantitate_intrata_stoc', 'numeric', true),
      ('stocuri', 'id', 'bigint', true), ('stocuri', 'locatie_tip', 'text', true), ('stocuri', 'locatie_id', 'bigint', false),
      ('stocuri', 'material_denumire', 'text', true), ('stocuri', 'um', 'text', false), ('stocuri', 'cantitate', 'numeric(15,3)', true),
      ('stocuri_miscari', 'id', 'bigint', true), ('stocuri_miscari', 'locatie_tip', 'text', true), ('stocuri_miscari', 'locatie_id', 'bigint', false),
      ('stocuri_miscari', 'material_denumire', 'text', true), ('stocuri_miscari', 'um', 'text', false), ('stocuri_miscari', 'delta', 'numeric', true),
      ('stocuri_miscari', 'tip', 'text', true), ('stocuri_miscari', 'motiv', 'text', false), ('stocuri_miscari', 'ref_tip', 'text', false),
      ('stocuri_miscari', 'ref_id', 'bigint', false), ('stocuri_miscari', 'created_by', 'uuid', false), ('stocuri_miscari', 'pret_unitar', 'numeric', false),
      ('profiles', 'id', 'uuid', true), ('profiles', 'is_owner', 'boolean', true), ('profiles', 'can_process_achizitii', 'boolean', true),
      ('profiles', 'can_create_comenzi', 'boolean', true), ('user_module_access', 'profile_id', 'uuid', true), ('user_module_access', 'module', 'text', true)
    ) v(t, c, tip, nn) LOOP
    SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END INTO v_tip
      FROM pg_attribute a WHERE a.attrelid = ('public.' || r.t)::regclass AND a.attname = r.c AND a.attnum > 0 AND NOT a.attisdropped;
    -- (forma așteptată calculată separat: un CASE în condiția unui IF se rupe la primul THEN în plpgsql)
    v_astept := r.tip || CASE WHEN r.nn THEN ' NOT NULL' ELSE '' END;
    IF v_tip IS DISTINCT FROM v_astept THEN
      RAISE EXCEPTION '20270110a: coloana %.% are alta forma (% ; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), v_astept;
    END IF;
  END LOOP;
END $pre$;

-- ─── 0. Lock-urile, ÎNAINTEA verificărilor de stare (L14): punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare (docs/LIVRARE_L15_V2.md,
--     „Bugetul de lock”); ordinea = ordinea L06 (comanda → linii → mișcări → stocuri); într-un sub-bloc: un tabel ocupat eliberează lock-urile
--     luate deja în încercarea curentă (rollback la savepoint) și se reia la 50 ms. Ocupat peste buget = 55P03, nimic schimbat. ─────────────
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270110a: BUGET_LOCK: comenzi_furnizor / comenzi_furnizor_linii / stocuri_miscari / stocuri ocupate; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.comenzi_furnizor IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.comenzi_furnizor_linii IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.stocuri_miscari IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.stocuri IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270110a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270110a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Starea EXACTĂ de dinainte (sub lock): CHECK-urile, trigger-ele, politicile de bază, dependențele pe amprentă, drepturile pe linii,
--     preflight-ul datelor pentru CHECK-ul nou. Altceva = refuz, nimic schimbat. ────────────────────────────────────────────────────────────
DO $stare$
DECLARE v_rau text; v_n bigint; r record;
BEGIN
  -- CHECK-urile tabelelor atinse (lista completă; altceva = refuz)
  SELECT string_agg(coalesce(a.t || '.' || a.conname, '+' || c.t || '.' || c.conname), ', ' ORDER BY coalesce(a.conname, c.conname)) INTO v_rau
    FROM (VALUES
      ('comenzi_furnizor', 'comenzi_furnizor_livrare_tip_check', 'CHECK ((livrare_tip = ANY (ARRAY[''sediu''::text, ''santier''::text])))'),
      ('comenzi_furnizor', 'comenzi_furnizor_note_interne_lung_ck', 'CHECK (((note_interne IS NULL) OR (length(note_interne) <= 4000)))'),
      ('comenzi_furnizor', 'comenzi_furnizor_status_check', 'CHECK ((status = ANY (ARRAY[''draft''::text, ''in_aprobare''::text, ''emisa''::text, ''in_tranzit''::text, ''ajunsa''::text, ''receptionata''::text, ''in_stoc''::text, ''anulata''::text, ''respinsa''::text])))'),
      ('comenzi_furnizor_linii', 'comenzi_furnizor_linii_cantitate_intrata_stoc_check', 'CHECK ((cantitate_intrata_stoc >= (0)::numeric))'),
      ('stocuri', 'stocuri_locatie_tip_check', 'CHECK ((locatie_tip = ANY (ARRAY[''sediu''::text, ''proiect''::text])))'),
      ('stocuri_miscari', 'stocuri_miscari_tip_check', 'CHECK ((tip = ANY (ARRAY[''intrare_achizitie''::text, ''ajustare_plus''::text, ''ajustare_minus''::text, ''transfer_out''::text, ''transfer_in''::text, ''consum_proiect''::text, ''corectie_initiala''::text])))')
    ) a(t, conname, def)
    FULL JOIN (SELECT k.conrelid::regclass::text AS t0, replace(k.conrelid::regclass::text, 'public.', '') AS t, k.conname, pg_get_constraintdef(k.oid) AS def
                 FROM pg_constraint k WHERE k.contype = 'c' AND k.conrelid IN ('public.comenzi_furnizor'::regclass, 'public.comenzi_furnizor_linii'::regclass,
                                                                                'public.stocuri'::regclass, 'public.stocuri_miscari'::regclass)) c
      ON c.t = a.t AND c.conname = a.conname
   WHERE a.conname IS NULL OR c.conname IS NULL OR a.def IS DISTINCT FROM c.def;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270110a: CHECK-urile tabelelor atinse difera de starea revizuita: %', v_rau; END IF;
  -- trigger-ele utilizatorului de pe tabelele atinse (lista completă: nume, funcție, tip, activ, fără WHEN / argumente)
  SELECT string_agg(coalesce(a.t || '.' || a.tg, '+' || c.t || '.' || c.tg), ', ' ORDER BY coalesce(a.tg, c.tg)) INTO v_rau
    FROM (VALUES
      ('comenzi_furnizor', 'tg_cf_touch', 'fn_cf_touch_updated', 19, false),
      ('comenzi_furnizor', 'trg_cf_sync_cereri', 'fn_cf_sync_cereri', 17, true),
      ('comenzi_furnizor_linii', 'trg_cfl_automatch', 'fn_cfl_automatch', 7, false),
      ('comenzi_furnizor_linii', 'trg_cfl_sync_cereri', 'fn_cfl_sync_cereri', 29, true),
      ('stocuri', 'trg_stocuri_touch', 'fn_comercial_touch_updated_at', 19, false),
      ('stocuri_miscari', 'trg_stocuri_aplica_miscare', 'fn_stocuri_aplica_miscare', 5, false)
    ) a(t, tg, fn, tip, cu_coloane)
    FULL JOIN (SELECT replace(t.tgrelid::regclass::text, 'public.', '') AS t, t.tgname AS tg, p.proname AS fn, n.nspname, t.tgtype::int AS tip,
                      t.tgenabled, t.tgqual IS NULL AS fara_when, t.tgnargs, t.tgattr::text <> '' AS cu_coloane
                 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.comenzi_furnizor'::regclass, 'public.comenzi_furnizor_linii'::regclass,
                                                           'public.stocuri'::regclass, 'public.stocuri_miscari'::regclass)) c
      ON c.t = a.t AND c.tg = a.tg
   WHERE a.tg IS NULL OR c.tg IS NULL OR a.fn IS DISTINCT FROM c.fn OR c.nspname IS DISTINCT FROM 'public' OR a.tip IS DISTINCT FROM c.tip
      OR c.tgenabled IS DISTINCT FROM 'O' OR NOT c.fara_when OR c.tgnargs <> 0 OR a.cu_coloane IS DISTINCT FROM c.cu_coloane;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270110a: trigger-ele tabelelor atinse difera de starea revizuita: %', v_rau; END IF;
  -- dependențele (corp fără CR, DEFINER, search_path, proprietar): neatinse de migrare, verificate și în postcondiții
  FOR r IN SELECT * FROM (VALUES
      -- >>> DEPENDENTE 20270110a
      ('public.fn_stocuri_aplica_miscare()', 'b56c13c686ad49f4c641eb461be371b5'),
      ('public.fn_stoc_ajustare(text,bigint,text,text,numeric,text)', '4e8c598952ae6278c9e702d7d00748e4'),
      ('public.fn_transfer_executa(text,bigint,text,bigint,text,jsonb)', '4e46abcbbd65110cdbad363b52146b93'),
      ('public.fn_cfl_sync_cereri()', '800ff2655c3b5cd2e971cd86a99b5bf1'),
      ('public.fn_cfl_automatch()', 'cf167608e329c87b294e5e76102dfe02'),
      ('public.fn_cerere_rollup_status(bigint)', 'ed06d5aa3bc5f5977a393c50a007b010')
      -- <<< DEPENDENTE 20270110a
    ) v(semn, md5) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.semn) AND md5(replace(p.prosrc, chr(13), '')) = r.md5
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '20270110a: dependenta % nu e cea revizuita (corp, DEFINER, search_path sau proprietar)', r.semn;
    END IF;
  END LOOP;
  -- politicile de citire pe care se sprijină predicatul „vede comanda” al tabelelor noi (citire pentru orice cont logat, ca azi)
  IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN ('public.comenzi_furnizor'::regclass, 'public.comenzi_furnizor_linii'::regclass)
        AND p.polname IN ('cf_select', 'cfl_select') AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid]
        AND pg_get_expr(p.polqual, p.polrelid) = 'true') <> 2 THEN
    RAISE EXCEPTION '20270110a: politicile cf_select / cfl_select nu sunt cele revizuite (citire USING true pentru authenticated)';
  END IF;
  -- drepturile pe linii pe care le schimbă migrarea: authenticated are UPDATE pe TABEL (fără GRANT OPTION) și nicio coloană nu are drepturi proprii
  IF NOT has_table_privilege('authenticated', 'public.comenzi_furnizor_linii', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.comenzi_furnizor_linii', 'UPDATE WITH GRANT OPTION')
     OR NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = 'public.comenzi_furnizor_linii'::regclass
                      AND e.grantee = 'authenticated'::regrole AND e.privilege_type = 'UPDATE')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor_linii'::regclass AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20270110a: drepturile pe comenzi_furnizor_linii nu sunt cele revizuite (UPDATE pe tabel pentru authenticated, fara drepturi pe coloane)';
  END IF;
  -- preflight (sub lock): CHECK-ul nou intrata_stoc <= coalesce(primita, cantitate)
  SELECT count(*) INTO v_n FROM public.comenzi_furnizor_linii l WHERE NOT (l.cantitate_intrata_stoc <= coalesce(l.cantitate_primita, l.cantitate));
  IF v_n > 0 THEN
    RAISE EXCEPTION '20270110a: % linii au cantitate_intrata_stoc peste cantitatea primita (CHECK-ul nou ar pica); de lamurit inainte; nimic schimbat', v_n;
  END IF;
  -- numele noi de referință nu sunt deja folosite de alte mișcări
  SELECT count(*) INTO v_n FROM public.stocuri_miscari m WHERE m.ref_tip IN ('comanda_furnizor_linie', 'comanda_furnizor_retur');
  IF v_n > 0 THEN RAISE EXCEPTION '20270110a: % miscari folosesc deja ref_tip comanda_furnizor_linie / comanda_furnizor_retur; nimic schimbat', v_n; END IF;
  -- informativ: moștenirea (de reconciliat prin scripts/achizitii_retur_reconciliere_mostenire.sql)
  RAISE NOTICE '20270110a: linii existente (intrare_reconciliata = false pana la reconciliere) = %, miscari vechi de intrare pe comenzi = %',
    (SELECT count(*) FROM public.comenzi_furnizor_linii),
    (SELECT count(*) FROM public.stocuri_miscari m WHERE m.tip = 'intrare_achizitie' AND m.ref_tip = 'comanda_furnizor');
END $stare$;
-- ─── 2. Liniile comenzii: marcajul moștenirii, CHECK-ul cantităților, drepturile pe coloane ───────────────────────────────────────────
ALTER TABLE public.comenzi_furnizor_linii ADD COLUMN intrare_reconciliata boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.comenzi_furnizor_linii.intrare_reconciliata IS 'Achizitii retur (20270110a): true = cantitate_intrata_stoc e o limita sigura (intrarile vechi, legate doar de comanda, au fost atribuite liniei). Scris doar de server: liniile vechi = false pana la reconciliere (scripts/achizitii_retur_reconciliere_mostenire.sql / fn_cf_reconciliaza_linie); o linie noua = true daca comanda nu are intrari vechi.';
ALTER TABLE public.comenzi_furnizor_linii ADD CONSTRAINT comenzi_furnizor_linii_intrata_sub_primita_check
  CHECK (cantitate_intrata_stoc <= coalesce(cantitate_primita, cantitate)) NOT VALID;
ALTER TABLE public.comenzi_furnizor_linii VALIDATE CONSTRAINT comenzi_furnizor_linii_intrata_sub_primita_check;
-- cantitățile nu mai pot fi scrise de client (REVOKE pe coloane nu ajunge cât există UPDATE pe tabel): UPDATE doar pe celelalte coloane
REVOKE UPDATE ON TABLE public.comenzi_furnizor_linii FROM authenticated;
GRANT UPDATE (comanda_furnizor_id, comanda_linie_id, denumire, um, cantitate, pret_unitar, termen_livrare, observatii, display_order)
  ON TABLE public.comenzi_furnizor_linii TO authenticated;

-- ─── 3. Tabelele noi (scriere doar prin RPC-uri; citire pentru cine vede comanda) ───────────────────────────────────────────────────
CREATE TABLE public.comenzi_furnizor_intentii (
  cheie uuid NOT NULL,
  rpc text NOT NULL,
  payload_hash text NOT NULL,
  autor uuid NOT NULL,
  rezultat jsonb NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comenzi_furnizor_intentii_pkey PRIMARY KEY (cheie),
  CONSTRAINT comenzi_furnizor_intentii_rpc_check CHECK (rpc IN ('fn_cf_receptie_adauga', 'fn_cf_intra_stoc', 'fn_cf_retur_inregistreaza',
    'fn_cf_retur_anuleaza', 'fn_cf_retur_inchide_fara_inlocuire', 'fn_cf_reconciliaza_linie')),
  CONSTRAINT comenzi_furnizor_intentii_hash_check CHECK (payload_hash ~ '^[0-9a-f]{32}$')
);
COMMENT ON TABLE public.comenzi_furnizor_intentii IS 'Achizitii retur (20270110a): cheile de idempotenta ale RPC-urilor (aceeasi cheie + acelasi payload = rezultatul comis; alt payload = refuz). Fara acces pentru clienti.';
CREATE TABLE public.comenzi_furnizor_receptii (
  id bigint GENERATED ALWAYS AS IDENTITY,
  linie_id bigint NOT NULL,
  tip text NOT NULL,
  cantitate numeric NOT NULL,
  receptie_id bigint,
  cheie uuid,
  moment timestamptz,
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comenzi_furnizor_receptii_pkey PRIMARY KEY (id),
  CONSTRAINT comenzi_furnizor_receptii_linie_fkey FOREIGN KEY (linie_id) REFERENCES public.comenzi_furnizor_linii(id),
  CONSTRAINT comenzi_furnizor_receptii_receptie_fkey FOREIGN KEY (receptie_id) REFERENCES public.comenzi_furnizor_receptii(id),
  CONSTRAINT comenzi_furnizor_receptii_tip_ck CHECK (tip IN ('sold_initial', 'receptie', 'corectura')),
  CONSTRAINT comenzi_furnizor_receptii_cantitate_ck CHECK (cantitate > 0),
  CONSTRAINT comenzi_furnizor_receptii_legatura_ck CHECK ((tip = 'corectura') = (receptie_id IS NOT NULL)),
  CONSTRAINT comenzi_furnizor_receptii_cheie_ck CHECK ((tip = 'sold_initial') = (cheie IS NULL))
);
COMMENT ON TABLE public.comenzi_furnizor_receptii IS 'Achizitii retur (20270110a): jurnalul receptiilor pe linie. sold_initial = primita de dinaintea primei operatii noi (moment = receptia veche a comenzii, NULL = necunoscut); receptie = +N; corectura = -N consumat dintr-o receptie (receptie_id), cronologic de la cea mai noua. Suma (sold + receptii - corecturi) = primita + retururile neanulate.';
CREATE TABLE public.comenzi_furnizor_retururi (
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  comanda_furnizor_id bigint NOT NULL,
  linie_id bigint NOT NULL,
  tip text NOT NULL,
  retur_id bigint,
  cantitate numeric NOT NULL,
  din_stoc numeric NOT NULL,
  motiv text NOT NULL,
  pv_retur_path text,
  asteapta_inlocuire boolean NOT NULL DEFAULT false,
  cantitate_inlocuita numeric NOT NULL DEFAULT 0,
  cantitate_renuntata numeric NOT NULL DEFAULT 0,
  inchis_la timestamptz,
  inchis_fel text,
  inchis_motiv text,
  denumire text NOT NULL,
  um text,
  locatie_tip text NOT NULL,
  locatie_id bigint,
  stoc_miscare_id bigint,
  cheie uuid NOT NULL,
  payload_hash text NOT NULL,
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comenzi_furnizor_retururi_pkey PRIMARY KEY (id),
  CONSTRAINT comenzi_furnizor_retururi_comanda_fkey FOREIGN KEY (comanda_furnizor_id) REFERENCES public.comenzi_furnizor(id),
  CONSTRAINT comenzi_furnizor_retururi_linie_fkey FOREIGN KEY (linie_id) REFERENCES public.comenzi_furnizor_linii(id),
  CONSTRAINT comenzi_furnizor_retururi_retur_fkey FOREIGN KEY (retur_id) REFERENCES public.comenzi_furnizor_retururi(id),
  CONSTRAINT comenzi_furnizor_retururi_miscare_fkey FOREIGN KEY (stoc_miscare_id) REFERENCES public.stocuri_miscari(id),
  CONSTRAINT comenzi_furnizor_retururi_cheie_key UNIQUE (cheie),
  CONSTRAINT comenzi_furnizor_retururi_retur_id_key UNIQUE (retur_id),
  CONSTRAINT comenzi_furnizor_retururi_tip_ck CHECK (tip IN ('retur', 'anulare')),
  CONSTRAINT comenzi_furnizor_retururi_legatura_ck CHECK ((tip = 'anulare') = (retur_id IS NOT NULL)),
  CONSTRAINT comenzi_furnizor_retururi_cantitate_ck CHECK (cantitate > 0),
  CONSTRAINT comenzi_furnizor_retururi_din_stoc_ck CHECK (din_stoc >= 0 AND din_stoc <= cantitate),
  CONSTRAINT comenzi_furnizor_retururi_motiv_ck CHECK (length(btrim(motiv)) >= 5),
  CONSTRAINT comenzi_furnizor_retururi_inlocuire_ck CHECK (cantitate_inlocuita >= 0 AND cantitate_renuntata >= 0
    AND cantitate_inlocuita + cantitate_renuntata <= cantitate),
  CONSTRAINT comenzi_furnizor_retururi_inchis_fel_ck CHECK (inchis_fel IS NULL OR inchis_fel IN ('acoperit', 'renuntat', 'anulat')),
  CONSTRAINT comenzi_furnizor_retururi_inchis_ck CHECK ((inchis_la IS NULL) = (inchis_fel IS NULL) AND (inchis_fel IS NULL OR NOT asteapta_inlocuire)),
  CONSTRAINT comenzi_furnizor_retururi_acoperit_ck CHECK (inchis_fel IS DISTINCT FROM 'acoperit' OR cantitate_inlocuita + cantitate_renuntata = cantitate),
  CONSTRAINT comenzi_furnizor_retururi_anulare_ck CHECK (tip = 'retur' OR (NOT asteapta_inlocuire AND cantitate_inlocuita = 0
    AND cantitate_renuntata = 0 AND inchis_fel IS NULL AND inchis_la IS NULL)),
  CONSTRAINT comenzi_furnizor_retururi_stoc_ck CHECK ((din_stoc > 0) = (stoc_miscare_id IS NOT NULL)),
  CONSTRAINT comenzi_furnizor_retururi_locatie_ck CHECK (locatie_tip IN ('sediu', 'proiect') AND (locatie_tip = 'sediu') = (locatie_id IS NULL)),
  CONSTRAINT comenzi_furnizor_retururi_hash_ck CHECK (payload_hash ~ '^[0-9a-f]{32}$')
);
COMMENT ON TABLE public.comenzi_furnizor_retururi IS 'Achizitii retur (20270110a): retururi la furnizor pe linia comenzii (tip retur) si anularile lor (tip anulare, retur_id, una pe retur). Cheia de stoc (denumire, um, locatie) e copiata pe rand: anularea pune marfa inapoi exact acolo. Inlocuirea: cantitate_inlocuita (din alocarile receptiilor), cantitate_renuntata (Inchide fara inlocuire). Se scrie doar prin RPC-uri.';
CREATE TABLE public.comenzi_furnizor_retur_alocari (
  id bigint GENERATED ALWAYS AS IDENTITY,
  receptie_id bigint NOT NULL,
  retur_id bigint NOT NULL,
  cantitate numeric NOT NULL,
  inversata_de_receptie_id bigint,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comenzi_furnizor_retur_alocari_pkey PRIMARY KEY (id),
  CONSTRAINT comenzi_furnizor_retur_alocari_receptie_fkey FOREIGN KEY (receptie_id) REFERENCES public.comenzi_furnizor_receptii(id),
  CONSTRAINT comenzi_furnizor_retur_alocari_retur_fkey FOREIGN KEY (retur_id) REFERENCES public.comenzi_furnizor_retururi(id),
  CONSTRAINT comenzi_furnizor_retur_alocari_inversata_fkey FOREIGN KEY (inversata_de_receptie_id) REFERENCES public.comenzi_furnizor_receptii(id),
  CONSTRAINT comenzi_furnizor_retur_alocari_cantitate_ck CHECK (cantitate > 0)
);
COMMENT ON TABLE public.comenzi_furnizor_retur_alocari IS 'Achizitii retur (20270110a): ce parte dintr-o receptie a acoperit un retur care astepta inlocuire. inversata_de_receptie_id = corectura care a consumat alocarea (partea ramasa devine o alocare noua).';
CREATE INDEX comenzi_furnizor_retururi_linie_idx ON public.comenzi_furnizor_retururi (linie_id, id);
CREATE INDEX comenzi_furnizor_retururi_comanda_idx ON public.comenzi_furnizor_retururi (comanda_furnizor_id);
CREATE INDEX comenzi_furnizor_receptii_linie_idx ON public.comenzi_furnizor_receptii (linie_id, id);
CREATE INDEX comenzi_furnizor_receptii_receptie_idx ON public.comenzi_furnizor_receptii (receptie_id);
CREATE INDEX comenzi_furnizor_retur_alocari_receptie_idx ON public.comenzi_furnizor_retur_alocari (receptie_id, id);
CREATE INDEX comenzi_furnizor_retur_alocari_retur_idx ON public.comenzi_furnizor_retur_alocari (retur_id);
ALTER TABLE public.comenzi_furnizor_intentii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comenzi_furnizor_receptii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comenzi_furnizor_retururi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comenzi_furnizor_retur_alocari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.comenzi_furnizor_intentii, public.comenzi_furnizor_receptii, public.comenzi_furnizor_retururi, public.comenzi_furnizor_retur_alocari
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.comenzi_furnizor_receptii_id_seq, public.comenzi_furnizor_retururi_id_seq, public.comenzi_furnizor_retur_alocari_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.comenzi_furnizor_receptii, public.comenzi_furnizor_retururi, public.comenzi_furnizor_retur_alocari TO authenticated;
-- „vede comanda” = politica de citire a comenzii / liniei (azi: orice cont logat), aplicată prin subinterogare (RLS-ul lor se aplică și aici)
CREATE POLICY cf_retururi_citire ON public.comenzi_furnizor_retururi FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.comenzi_furnizor cf WHERE cf.id = comenzi_furnizor_retururi.comanda_furnizor_id));
CREATE POLICY cf_receptii_citire ON public.comenzi_furnizor_receptii FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.comenzi_furnizor_linii l JOIN public.comenzi_furnizor cf ON cf.id = l.comanda_furnizor_id
                                             WHERE l.id = comenzi_furnizor_receptii.linie_id));
CREATE POLICY cf_retur_alocari_citire ON public.comenzi_furnizor_retur_alocari FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.comenzi_furnizor_retururi r WHERE r.id = comenzi_furnizor_retur_alocari.retur_id));

-- ─── 4. stocuri_miscari: tipurile noi (același nume de constrângere) + sensul lor ─────────────────────────────────────────────────────
ALTER TABLE public.stocuri_miscari DROP CONSTRAINT stocuri_miscari_tip_check;
ALTER TABLE public.stocuri_miscari
  ADD CONSTRAINT stocuri_miscari_tip_check CHECK (tip = ANY (ARRAY['intrare_achizitie'::text, 'ajustare_plus'::text, 'ajustare_minus'::text,
    'transfer_out'::text, 'transfer_in'::text, 'consum_proiect'::text, 'corectie_initiala'::text, 'retur_furnizor'::text, 'retur_furnizor_anulare'::text])),
  ADD CONSTRAINT stocuri_miscari_retur_furnizor_check CHECK ((tip <> 'retur_furnizor' OR delta < 0) AND (tip <> 'retur_furnizor_anulare' OR delta > 0)
    AND (tip NOT IN ('retur_furnizor', 'retur_furnizor_anulare') OR ref_tip IS NOT DISTINCT FROM 'comanda_furnizor_retur'));

-- ─── 5. Funcțiile interne și trigger-ele (fără EXECUTE pentru clienți) ──────────────────────────────────────────────────────────────
-- predicatul „mișcare protejată” (L19: o singură definiție — trigger-ele de ștergere / modificare, poziția, RPC-ul de ștergere)
CREATE FUNCTION public.fn_stoc_miscare_protejata(p_tip text, p_ref_tip text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT coalesce(p_tip IN ('retur_furnizor', 'retur_furnizor_anulare')
                  OR (p_tip = 'intrare_achizitie' AND p_ref_tip IN ('comanda_furnizor', 'comanda_furnizor_linie')), false)
$f$;
-- cantitate acceptată de RPC-uri: finită, cu cel mult 3 zecimale (stocuri.cantitate e numeric(15,3): altfel s-ar rotunji în tăcere)
CREATE FUNCTION public.fn_cf_cantitate_valida_intern(p numeric) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p IS NULL OR p = 'NaN'::numeric OR p >= 1e12 OR p <= -1e12 THEN false ELSE p = round(p, 3) END
$f$;
-- cheia lock-ului de stoc = textul EXACT al rândului din stocuri (decizia 2 a planului), ca fn_stocuri_aplica_miscare (L19: o singură definiție,
-- folosită de lock-ul blocant și de încercarea fără așteptare)
CREATE FUNCTION public.fn_stoc_cheie(p_locatie_tip text, p_locatie_id bigint, p_denumire text) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT hashtextextended('stoc|' || coalesce(p_locatie_tip, '') || '|' || coalesce(p_locatie_id, 0)::text || '|' || coalesce(p_denumire, ''), 0)
$f$;
CREATE FUNCTION public.fn_stoc_cheie_lock(p_locatie_tip text, p_locatie_id bigint, p_denumire text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  PERFORM pg_advisory_xact_lock(public.fn_stoc_cheie(p_locatie_tip, p_locatie_id, p_denumire));
END $f$;
-- lock-ul pe cheie + rândul din stocuri FOR UPDATE; întoarce cantitatea (0 dacă rândul lipsește); două rânduri cu aceeași cheie = refuz
CREATE FUNCTION public.fn_stoc_blocheaza(p_locatie_tip text, p_locatie_id bigint, p_denumire text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r record; v_n integer := 0; v_c numeric;
BEGIN
  PERFORM public.fn_stoc_cheie_lock(p_locatie_tip, p_locatie_id, p_denumire);
  FOR r IN SELECT s.cantitate FROM public.stocuri s
            WHERE s.locatie_tip = p_locatie_tip AND s.locatie_id IS NOT DISTINCT FROM p_locatie_id AND s.material_denumire = p_denumire
            ORDER BY s.id FOR UPDATE LOOP
    v_n := v_n + 1;
    v_c := r.cantitate;
  END LOOP;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'CF_STOC_AMBIGUU: pozitia de stoc apare de % ori; de corectat in Magazie', v_n USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce(v_c, 0);
END $f$;
-- dreptul de scriere = achiziții cu drept de creare (ctx.canCreate din Achizitii.jsx: owner / can_process_achizitii / can_create_comenzi) + accesul
-- la modulul 'achizitii' (cheia exactă sau un sub-modul, ca hasModuleAccess) sau owner (L09)
CREATE FUNCTION public.fn_cf_drept_achizitii_intern(p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_uid
       AND (p.is_owner IS TRUE
            OR ((p.can_process_achizitii IS TRUE OR p.can_create_comenzi IS TRUE)
                AND EXISTS (SELECT 1 FROM public.user_module_access m
                             WHERE m.profile_id = p_uid AND (m.module = 'achizitii' OR m.module LIKE 'achizitii.%')))))
$f$;
CREATE FUNCTION public.fn_cf_este_owner_intern(p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_uid AND p.is_owner IS TRUE)
$f$;
-- dovada de recepție (spec §3.0 / §3.2b; L19: aceeași pentru RPC-uri și pentru trigger-ul de identitate); necunoscut = dovadă (fail-closed)
CREATE FUNCTION public.fn_cf_dovada_receptie_intern(p_l public.comenzi_furnizor_linii, p_cf public.comenzi_furnizor) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce(p_l.cantitate_primita IS NOT NULL
               OR p_l.cantitate_intrata_stoc > 0
               OR p_cf.receptie_mp_la IS NOT NULL OR p_cf.receptie_achizitii_la IS NOT NULL
               OR p_cf.status IN ('receptionata', 'in_stoc')
               OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_receptii r WHERE r.linie_id = p_l.id), true)
$f$;
-- idempotența (L04): pasul 0 al ordinii lock-urilor = cheia; rezultatul comis se dă doar autorului, cu același RPC și același payload
CREATE FUNCTION public.fn_cf_intentie_reia_intern(p_cheie uuid, p_rpc text, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.comenzi_furnizor_intentii; v_uid uuid := auth.uid();
BEGIN
  IF p_cheie IS NULL THEN RAISE EXCEPTION 'CF_CHEIE_LIPSA: cheia operatiei lipseste' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cf_intentie|' || p_cheie::text, 0));
  SELECT * INTO r FROM public.comenzi_furnizor_intentii i WHERE i.cheie = p_cheie;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.autor IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'CF_CHEIE_ALT_AUTOR: cheia operatiei apartine altui utilizator; reincarcati pagina' USING ERRCODE = 'P0001';
  END IF;
  IF r.rpc IS DISTINCT FROM p_rpc OR r.payload_hash IS DISTINCT FROM md5(p_payload::text) THEN
    RAISE EXCEPTION 'CF_CHEIE_ALTI_PARAMETRI: cheia operatiei a fost folosita cu alti parametri; reincarcati pagina' USING ERRCODE = 'P0001';
  END IF;
  RETURN r.rezultat || jsonb_build_object('reluat', true);
END $f$;
-- închiderea intenției = ULTIMUL pas al fiecărui RPC cu cheie: dreptul se REVERIFICĂ aici, după ultima operație care poate aștepta (L01: rânduri
-- din stocuri, FK-uri, trigger-e); INSERT-ul de mai jos nu așteaptă (cheia ținută de la pasul 0, fără FK, fără trigger de inserare). Reconcilierea = owner.
CREATE FUNCTION public.fn_cf_intentie_inchide_intern(p_cheie uuid, p_rpc text, p_payload jsonb, p_rezultat jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_ok boolean;
BEGIN
  IF p_rpc = 'fn_cf_reconciliaza_linie' THEN
    v_ok := public.fn_cf_este_owner_intern(auth.uid());
  ELSE
    v_ok := public.fn_cf_drept_achizitii_intern(auth.uid());
  END IF;
  IF NOT coalesce(v_ok, false) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.comenzi_furnizor_intentii (cheie, rpc, payload_hash, autor, rezultat)
  VALUES (p_cheie, p_rpc, md5(p_payload::text), auth.uid(), p_rezultat);
END $f$;
-- pregătirea liniei, comună tuturor RPC-urilor. Ordinea lock-urilor (L06): 1 comenzi_furnizor FOR SHARE → 2 comenzi_furnizor_linii FOR UPDATE.
-- Comanda validă (decizia 3), NULL → cantitate dacă există dovada de recepție (altfel refuz când se cere), soldul inițial la prima operație nouă.
CREATE FUNCTION public.fn_cf_linie_pregateste_intern(p_linie_id bigint, p_cere_dovada boolean,
  OUT linie public.comenzi_furnizor_linii, OUT primita_bruta numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_cf_id bigint; v_cf public.comenzi_furnizor;
BEGIN
  SELECT l.comanda_furnizor_id INTO v_cf_id FROM public.comenzi_furnizor_linii l WHERE l.id = p_linie_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CF_LINIE_INEXISTENTA: reperul nu exista' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_cf FROM public.comenzi_furnizor c WHERE c.id = v_cf_id FOR SHARE;
  SELECT * INTO linie FROM public.comenzi_furnizor_linii l WHERE l.id = p_linie_id FOR UPDATE;
  IF linie.id IS NULL OR v_cf.id IS NULL OR linie.comanda_furnizor_id IS DISTINCT FROM v_cf.id THEN
    RAISE EXCEPTION 'CF_VALOARE_SCHIMBATA: reperul s-a schimbat intre timp; reincarcati pagina' USING ERRCODE = 'P0001';
  END IF;
  IF v_cf.este_servicii IS NOT FALSE OR NOT coalesce(v_cf.status IN ('emisa', 'in_tranzit', 'ajunsa', 'receptionata', 'in_stoc'), false) THEN
    RAISE EXCEPTION 'CF_COMANDA_INVALIDA: comanda nu permite receptie / retur (status %, servicii %)', v_cf.status, v_cf.este_servicii USING ERRCODE = 'P0001';
  END IF;
  primita_bruta := linie.cantitate_primita;
  IF linie.cantitate_primita IS NULL THEN
    IF public.fn_cf_dovada_receptie_intern(linie, v_cf) THEN
      SET LOCAL app.cf_cantitati = '1';
      UPDATE public.comenzi_furnizor_linii l SET cantitate_primita = l.cantitate WHERE l.id = p_linie_id RETURNING l.* INTO linie;
      SET LOCAL app.cf_cantitati = '';
    ELSIF p_cere_dovada THEN
      RAISE EXCEPTION 'CF_FARA_RECEPTIE: faceti intai receptia reperului' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF linie.cantitate_primita > 0 AND NOT EXISTS (SELECT 1 FROM public.comenzi_furnizor_receptii r WHERE r.linie_id = p_linie_id) THEN
    INSERT INTO public.comenzi_furnizor_receptii (linie_id, tip, cantitate, cheie, moment, creat_de)
    VALUES (p_linie_id, 'sold_initial', linie.cantitate_primita, NULL, least(v_cf.receptie_mp_la, v_cf.receptie_achizitii_la), auth.uid());
  END IF;
END $f$;
-- cât mai e de înlocuit pe linie (retururile deschise care așteaptă înlocuire)
CREATE FUNCTION public.fn_cf_de_inlocuit_intern(p_linie_id bigint) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce(sum(t.cantitate - t.cantitate_inlocuita - t.cantitate_renuntata), 0) FROM public.comenzi_furnizor_retururi t
   WHERE t.linie_id = p_linie_id AND t.tip = 'retur' AND t.asteapta_inlocuire AND t.inchis_fel IS NULL
$f$;
-- invarianții liniei, verificați la finalul fiecărei operații (spec §3.3, „Soldul inițial”): jurnal = primita + retururi neanulate; alocările
-- active = cantitate_inlocuita pe fiecare retur; o recepție nu e consumată peste cantitatea ei; alocările leagă doar recepții și retururi ale liniei
CREATE FUNCTION public.fn_cf_linie_verifica_intern(p_linie_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_primita numeric; v_jurnal numeric; v_retur numeric; v_are boolean; v_rau text;
BEGIN
  SELECT coalesce(l.cantitate_primita, 0) INTO v_primita FROM public.comenzi_furnizor_linii l WHERE l.id = p_linie_id;
  SELECT coalesce(sum(CASE WHEN r.tip = 'corectura' THEN -r.cantitate ELSE r.cantitate END), 0), count(*) > 0 INTO v_jurnal, v_are
    FROM public.comenzi_furnizor_receptii r WHERE r.linie_id = p_linie_id;
  SELECT coalesce(sum(t.cantitate), 0) INTO v_retur FROM public.comenzi_furnizor_retururi t
   WHERE t.linie_id = p_linie_id AND t.tip = 'retur' AND NOT EXISTS (SELECT 1 FROM public.comenzi_furnizor_retururi a WHERE a.retur_id = t.id);
  IF (v_are OR v_retur > 0) AND v_jurnal IS DISTINCT FROM v_primita + v_retur THEN
    RAISE EXCEPTION 'CF_INVARIANT: jurnalul receptiilor (%) difera de primita (%) + retururi (%) pe linia %', v_jurnal, v_primita, v_retur, p_linie_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT string_agg(t.id::text, ',') INTO v_rau FROM public.comenzi_furnizor_retururi t
   WHERE t.linie_id = p_linie_id AND t.tip = 'retur'
     AND (t.cantitate_inlocuita IS DISTINCT FROM (SELECT coalesce(sum(a.cantitate), 0) FROM public.comenzi_furnizor_retur_alocari a
                                                  WHERE a.retur_id = t.id AND a.inversata_de_receptie_id IS NULL)
          OR (t.asteapta_inlocuire AND t.cantitate - t.cantitate_inlocuita - t.cantitate_renuntata <= 0));
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'CF_INVARIANT: inlocuirea retururilor % nu se potriveste cu alocarile', v_rau USING ERRCODE = 'P0001'; END IF;
  SELECT string_agg(r.id::text, ',') INTO v_rau FROM public.comenzi_furnizor_receptii r
   WHERE r.linie_id = p_linie_id AND r.tip <> 'corectura'
     AND (SELECT coalesce(sum(a.cantitate), 0) FROM public.comenzi_furnizor_retur_alocari a WHERE a.receptie_id = r.id AND a.inversata_de_receptie_id IS NULL)
       + (SELECT coalesce(sum(c.cantitate), 0) FROM public.comenzi_furnizor_receptii c WHERE c.receptie_id = r.id) > r.cantitate;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'CF_INVARIANT: receptiile % sunt consumate peste cantitate', v_rau USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.comenzi_furnizor_retur_alocari a
               JOIN public.comenzi_furnizor_receptii r ON r.id = a.receptie_id JOIN public.comenzi_furnizor_retururi t ON t.id = a.retur_id
              WHERE (r.linie_id = p_linie_id OR t.linie_id = p_linie_id) AND (r.linie_id IS DISTINCT FROM t.linie_id OR r.tip = 'corectura' OR t.tip <> 'retur')) THEN
    RAISE EXCEPTION 'CF_INVARIANT: alocari intre linii diferite pe linia %', p_linie_id USING ERRCODE = 'P0001';
  END IF;
END $f$;
-- trigger: orice ieșire (delta < 0), din orice cale, se serializează pe cheia stocului (spec §3.2); regulile de minus NU se schimbă
CREATE FUNCTION public.fn_stoc_miscari_lock_iesire() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  PERFORM public.fn_stoc_cheie_lock(NEW.locatie_tip, NEW.locatie_id, NEW.material_denumire);
  RETURN NEW;
END $f$;
-- trigger: mișcările de achiziție / retur (după tip sau referință) se scriu DOAR prin RPC-urile acestei migrări (marcajul de tranzacție)
CREATE FUNCTION public.fn_stoc_miscari_provenienta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF current_setting('app.cf_cantitati', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'CF_CLIENT_VECHI: miscarile de achizitie / retur se scriu doar prin operatiile din Achizitii; reincarcati pagina' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
-- trigger: ștergerea (cu lock-ul pe cheie, pasul 3) și modificarea istoricului protejat
CREATE FUNCTION public.fn_stoc_miscari_garda_istoric() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_stoc_cheie_lock(OLD.locatie_tip, OLD.locatie_id, OLD.material_denumire);
    IF public.fn_stoc_miscare_protejata(OLD.tip, OLD.ref_tip) THEN
      RAISE EXCEPTION 'CF_ISTORIC_PROTEJAT: pozitie cu istoric de achizitie / retur; corectati prin ajustare' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF public.fn_stoc_miscare_protejata(OLD.tip, OLD.ref_tip) OR public.fn_stoc_miscare_protejata(NEW.tip, NEW.ref_tip) THEN
    RAISE EXCEPTION 'CF_ISTORIC_PROTEJAT: miscarile de achizitie / retur nu se modifica; corectati prin ajustare' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $f$;
-- trigger: ștergerea unei poziții din stocuri ia lock-ul pe cheie și refuză pozițiile cu istoric de achiziție / retur. Ordinea (L06): DELETE-ul a
-- blocat deja RÂNDUL din stocuri, iar RPC-urile iau cheia ÎNAINTEA rândului → aici doar ÎNCERCAREA fără așteptare (blocant = deadlock cu un retur
-- în curs): cheia ocupată = refuz curat, nimic șters; fn_stoc_sterge_pozitie ține deja cheia (re-intrant), deci trece.
CREATE FUNCTION public.fn_stocuri_lock_stergere() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NOT pg_try_advisory_xact_lock(public.fn_stoc_cheie(OLD.locatie_tip, OLD.locatie_id, OLD.material_denumire)) THEN
    RAISE EXCEPTION 'CF_OCUPAT: pozitia de stoc e folosita de o operatie in curs; reincercati' USING ERRCODE = '55P03';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stocuri_miscari m
              WHERE m.locatie_tip = OLD.locatie_tip AND m.locatie_id IS NOT DISTINCT FROM OLD.locatie_id AND m.material_denumire = OLD.material_denumire
                AND public.fn_stoc_miscare_protejata(m.tip, m.ref_tip)) THEN
    RAISE EXCEPTION 'CF_ISTORIC_PROTEJAT: pozitie cu istoric de achizitie / retur; corectati prin ajustare' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $f$;
-- trigger: protecția cantităților și a identității liniei, pe orice cale (spec §3.2b). Ordinea lock-urilor (L06): rândul liniei e deja blocat
-- de INSERT / UPDATE; trigger-ul ia doar pasul 1 (comenzi_furnizor FOR SHARE; la mutare ambele comenzi, în ordinea id-ului), ca o recepție
-- concurentă să nu treacă printre verificare și redenumire / mutare.
CREATE FUNCTION public.fn_cfl_protectie() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_rpc boolean := current_setting('app.cf_cantitati', true) IS NOT DISTINCT FROM '1'; v_cf public.comenzi_furnizor;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_rpc THEN
      IF NEW.cantitate_primita IS NOT NULL OR NEW.cantitate_intrata_stoc IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'CF_CLIENT_VECHI: cantitatile primite / intrate se scriu doar prin receptie si predare; reincarcati pagina' USING ERRCODE = 'P0001';
      END IF;
      -- marcajul moștenirii îl calculează serverul (L08): linie nouă reconciliată doar dacă comanda nu are intrări vechi (legate doar de comandă)
      NEW.intrare_reconciliata := NOT EXISTS (SELECT 1 FROM public.stocuri_miscari m
                                               WHERE m.tip = 'intrare_achizitie' AND m.ref_tip = 'comanda_furnizor' AND m.ref_id = NEW.comanda_furnizor_id);
    END IF;
    RETURN NEW;
  END IF;
  IF NOT v_rpc AND (NEW.cantitate_primita IS DISTINCT FROM OLD.cantitate_primita OR NEW.cantitate_intrata_stoc IS DISTINCT FROM OLD.cantitate_intrata_stoc
                    OR NEW.intrare_reconciliata IS DISTINCT FROM OLD.intrare_reconciliata) THEN
    RAISE EXCEPTION 'CF_CLIENT_VECHI: cantitatile primite / intrate se scriu doar prin receptie si predare; reincarcati pagina' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.comanda_furnizor_id IS DISTINCT FROM OLD.comanda_furnizor_id THEN
    -- mutarea liniei în altă comandă (§3.3b, L07, r2): pasul 1 pe AMBELE comenzi, FOR SHARE în ordinea id-ului (o recepție / un status schimbat pe
    -- comandă nu trece printre verificare și mutare). Refuz dacă linia sau oricare dintre comenzi (sursa / destinația) are ORICE urmă de recepție:
    -- dovada pe comandă, cantități pe vreo linie, jurnal, retururi, intrări vechi (doar pe comandă) sau pe linie — moștenirea ar deveni ambiguă.
    -- Altfel marcajul moștenirii se RECALCULEAZĂ pentru destinație (ca la INSERT). Intrările vechi nu mai pot apărea (trg_stoc_miscari_provenienta).
    PERFORM 1 FROM public.comenzi_furnizor c WHERE c.id IN (OLD.comanda_furnizor_id, NEW.comanda_furnizor_id) ORDER BY c.id FOR SHARE;
    SELECT * INTO v_cf FROM public.comenzi_furnizor c WHERE c.id = OLD.comanda_furnizor_id;
    IF public.fn_cf_dovada_receptie_intern(OLD, v_cf)
       OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_retururi t WHERE t.linie_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.stocuri_miscari m WHERE m.ref_tip = 'comanda_furnizor_linie' AND m.ref_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.comenzi_furnizor c
                   WHERE c.id IN (OLD.comanda_furnizor_id, NEW.comanda_furnizor_id)
                     AND (coalesce(c.receptie_mp_la IS NOT NULL OR c.receptie_achizitii_la IS NOT NULL OR c.status IN ('receptionata', 'in_stoc'), true)
                          OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_linii x WHERE x.comanda_furnizor_id = c.id
                                        AND (x.cantitate_primita IS NOT NULL OR x.cantitate_intrata_stoc IS DISTINCT FROM 0))
                          OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_receptii r JOIN public.comenzi_furnizor_linii x ON x.id = r.linie_id
                                      WHERE x.comanda_furnizor_id = c.id)
                          OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_retururi t WHERE t.comanda_furnizor_id = c.id)
                          OR EXISTS (SELECT 1 FROM public.stocuri_miscari m WHERE m.tip = 'intrare_achizitie' AND m.ref_tip = 'comanda_furnizor' AND m.ref_id = c.id)
                          OR EXISTS (SELECT 1 FROM public.stocuri_miscari m JOIN public.comenzi_furnizor_linii x ON x.id = m.ref_id
                                      WHERE m.ref_tip = 'comanda_furnizor_linie' AND x.comanda_furnizor_id = c.id))) THEN
      RAISE EXCEPTION 'CF_MUTARE_REFUZATA: reperul nu se muta in alta comanda: linia sau comanda (sursa / destinatia) are receptii, retururi sau intrari in stoc'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.intrare_reconciliata := NOT EXISTS (SELECT 1 FROM public.stocuri_miscari m
                                             WHERE m.tip = 'intrare_achizitie' AND m.ref_tip = 'comanda_furnizor' AND m.ref_id = NEW.comanda_furnizor_id);
  ELSIF NEW.denumire IS DISTINCT FROM OLD.denumire OR NEW.um IS DISTINCT FROM OLD.um
     OR (OLD.cantitate_primita IS NULL AND NEW.cantitate IS DISTINCT FROM OLD.cantitate) THEN
    SELECT * INTO v_cf FROM public.comenzi_furnizor c WHERE c.id = OLD.comanda_furnizor_id FOR SHARE;
    IF public.fn_cf_dovada_receptie_intern(OLD, v_cf) THEN
      RAISE EXCEPTION 'CF_MATERIAL_RECEPTIONAT: materialul a fost receptionat; corectati prin retur sau ajustare de stoc' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $f$;
-- trigger: retururile se schimbă doar prin RPC-uri (marcajul) și doar în câmpurile înlocuirii / închiderii; nicio ștergere / golire
CREATE FUNCTION public.fn_cf_retururi_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('app.cf_cantitati', true) IS NOT DISTINCT FROM '1'
       AND (NEW.id, NEW.comanda_furnizor_id, NEW.linie_id, NEW.tip, NEW.retur_id, NEW.cantitate, NEW.din_stoc, NEW.motiv, NEW.pv_retur_path, NEW.denumire,
            NEW.um, NEW.locatie_tip, NEW.locatie_id, NEW.stoc_miscare_id, NEW.cheie, NEW.payload_hash, NEW.creat_de, NEW.creat_la)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.comanda_furnizor_id, OLD.linie_id, OLD.tip, OLD.retur_id, OLD.cantitate, OLD.din_stoc, OLD.motiv, OLD.pv_retur_path, OLD.denumire,
            OLD.um, OLD.locatie_tip, OLD.locatie_id, OLD.stoc_miscare_id, OLD.cheie, OLD.payload_hash, OLD.creat_de, OLD.creat_la) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'CF_ISTORIC_PROTEJAT: retururile se modifica doar prin operatiile din Achizitii' USING ERRCODE = 'P0001';
END $f$;
-- trigger: o alocare se poate doar inversa (o dată), prin RPC; nicio ștergere / golire
CREATE FUNCTION public.fn_cf_alocari_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('app.cf_cantitati', true) IS NOT DISTINCT FROM '1' AND OLD.inversata_de_receptie_id IS NULL AND NEW.inversata_de_receptie_id IS NOT NULL
       AND (NEW.id, NEW.receptie_id, NEW.retur_id, NEW.cantitate, NEW.creat_la) IS NOT DISTINCT FROM (OLD.id, OLD.receptie_id, OLD.retur_id, OLD.cantitate, OLD.creat_la) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'CF_ISTORIC_PROTEJAT: alocarile se modifica doar prin operatiile din Achizitii' USING ERRCODE = 'P0001';
END $f$;
-- trigger: jurnalul recepțiilor și intențiile nu se modifică și nu se șterg
CREATE FUNCTION public.fn_cf_jurnal_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'CF_ISTORIC_PROTEJAT: jurnalul (%) nu se modifica si nu se sterge', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $f$;
CREATE TRIGGER trg_stoc_miscari_lock_iesire BEFORE INSERT ON public.stocuri_miscari FOR EACH ROW WHEN (NEW.delta < 0)
  EXECUTE FUNCTION public.fn_stoc_miscari_lock_iesire();
CREATE TRIGGER trg_stoc_miscari_provenienta BEFORE INSERT ON public.stocuri_miscari FOR EACH ROW
  WHEN (NEW.tip IN ('retur_furnizor', 'retur_furnizor_anulare') OR NEW.ref_tip IN ('comanda_furnizor', 'comanda_furnizor_linie', 'comanda_furnizor_retur'))
  EXECUTE FUNCTION public.fn_stoc_miscari_provenienta();
CREATE TRIGGER trg_stoc_miscari_lock_stergere BEFORE DELETE ON public.stocuri_miscari FOR EACH ROW EXECUTE FUNCTION public.fn_stoc_miscari_garda_istoric();
CREATE TRIGGER trg_stoc_miscari_istoric_update BEFORE UPDATE ON public.stocuri_miscari FOR EACH ROW EXECUTE FUNCTION public.fn_stoc_miscari_garda_istoric();
CREATE TRIGGER trg_stocuri_lock_stergere BEFORE DELETE ON public.stocuri FOR EACH ROW EXECUTE FUNCTION public.fn_stocuri_lock_stergere();
CREATE TRIGGER trg_cfl_protectie BEFORE INSERT OR UPDATE ON public.comenzi_furnizor_linii FOR EACH ROW EXECUTE FUNCTION public.fn_cfl_protectie();
CREATE TRIGGER trg_cf_retururi_garda BEFORE UPDATE OR DELETE ON public.comenzi_furnizor_retururi FOR EACH ROW EXECUTE FUNCTION public.fn_cf_retururi_garda();
CREATE TRIGGER trg_cf_retururi_golire BEFORE TRUNCATE ON public.comenzi_furnizor_retururi FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cf_retururi_garda();
CREATE TRIGGER trg_cf_retur_alocari_garda BEFORE UPDATE OR DELETE ON public.comenzi_furnizor_retur_alocari FOR EACH ROW EXECUTE FUNCTION public.fn_cf_alocari_garda();
CREATE TRIGGER trg_cf_retur_alocari_golire BEFORE TRUNCATE ON public.comenzi_furnizor_retur_alocari FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cf_alocari_garda();
CREATE TRIGGER trg_cf_receptii_garda BEFORE UPDATE OR DELETE ON public.comenzi_furnizor_receptii FOR EACH ROW EXECUTE FUNCTION public.fn_cf_jurnal_garda();
CREATE TRIGGER trg_cf_receptii_golire BEFORE TRUNCATE ON public.comenzi_furnizor_receptii FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cf_jurnal_garda();
CREATE TRIGGER trg_cf_intentii_garda BEFORE UPDATE OR DELETE ON public.comenzi_furnizor_intentii FOR EACH ROW EXECUTE FUNCTION public.fn_cf_jurnal_garda();
CREATE TRIGGER trg_cf_intentii_golire BEFORE TRUNCATE ON public.comenzi_furnizor_intentii FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cf_jurnal_garda();

-- ─── 6. RPC-urile (SECURITY DEFINER; dreptul reverificat DUPĂ lock-uri — L01; cheia de idempotență — L04; refuz cu cod stabil CF_*) ─────
-- 6.1 Recepția incrementală (spec §3.3.3): +N acoperă retururile care așteaptă înlocuire (de la cel mai vechi); -N (corectură) consumă
--     recepțiile de la cea mai nouă: întâi partea nealocată, apoi alocările ei (de la cea mai nouă); retururile atinse se redeschid exact
--     pentru partea inversată (renunțarea rămâne renunțare). CAS pe valoarea BRUTĂ citită de ecran (p_primita_citita, NULL = necompletată).
--     Ordinea lock-urilor (L06): 0 cheia → 1 comanda FOR SHARE → 2 linia FOR UPDATE → 4 retururile liniei FOR UPDATE (ordinea id-ului); fără
--     mișcări de stoc. Dreptul: după pasul 4 și din nou la închiderea intenției (FK-ul corecturii pe recepție poate aștepta).
CREATE FUNCTION public.fn_cf_receptie_adauga(p_cheie uuid, p_linie_id bigint, p_cantitate numeric, p_primita_citita numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid(); v_payload jsonb; v_rez jsonb; v_p record; v_l public.comenzi_furnizor_linii; v_primita numeric;
  v_rec_id bigint; v_rest numeric; v_rem numeric; v_x numeric; v_take numeric; v_corectat numeric; v_alocat numeric; v_corr_id bigint;
  v_fel text; v_redeschise bigint[] := '{}'; t record; a record; r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  v_payload := jsonb_build_object('linie', p_linie_id, 'cantitate', trim_scale(p_cantitate), 'primita_citita', trim_scale(p_primita_citita));
  v_rez := public.fn_cf_intentie_reia_intern(p_cheie, 'fn_cf_receptie_adauga', v_payload);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  SELECT * INTO v_p FROM public.fn_cf_linie_pregateste_intern(p_linie_id, false);
  v_l := v_p.linie;
  PERFORM 1 FROM public.comenzi_furnizor_retururi t0 WHERE t0.linie_id = p_linie_id AND t0.tip = 'retur' ORDER BY t0.id FOR UPDATE;
  IF NOT public.fn_cf_drept_achizitii_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  IF v_p.primita_bruta IS DISTINCT FROM p_primita_citita THEN
    RAISE EXCEPTION 'CF_VALOARE_SCHIMBATA: cantitatea primita s-a schimbat intre timp (acum %); reincarcati pagina',
      coalesce(trim_scale(v_p.primita_bruta)::text, 'necompletata') USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.fn_cf_cantitate_valida_intern(p_cantitate) OR p_cantitate = 0 THEN
    RAISE EXCEPTION 'CF_CANTITATE_INVALIDA: cantitatea receptiei trebuie sa fie nenula, cu cel mult 3 zecimale' USING ERRCODE = 'P0001';
  END IF;
  v_primita := coalesce(v_l.cantitate_primita, 0);
  IF p_cantitate > 0 THEN
    INSERT INTO public.comenzi_furnizor_receptii (linie_id, tip, cantitate, cheie, moment, creat_de)
    VALUES (p_linie_id, 'receptie', p_cantitate, p_cheie, now(), v_uid) RETURNING id INTO v_rec_id;
    v_rest := p_cantitate;
    FOR t IN SELECT * FROM public.comenzi_furnizor_retururi t1
              WHERE t1.linie_id = p_linie_id AND t1.tip = 'retur' AND t1.asteapta_inlocuire AND t1.inchis_fel IS NULL ORDER BY t1.id LOOP
      EXIT WHEN v_rest <= 0;
      v_x := least(v_rest, t.cantitate - t.cantitate_inlocuita - t.cantitate_renuntata);
      CONTINUE WHEN v_x <= 0;
      INSERT INTO public.comenzi_furnizor_retur_alocari (receptie_id, retur_id, cantitate) VALUES (v_rec_id, t.id, v_x);
      SET LOCAL app.cf_cantitati = '1';
      UPDATE public.comenzi_furnizor_retururi t2
         SET cantitate_inlocuita = t2.cantitate_inlocuita + v_x,
             asteapta_inlocuire = (t2.cantitate_inlocuita + v_x + t2.cantitate_renuntata < t2.cantitate),
             inchis_fel = CASE WHEN t2.cantitate_inlocuita + v_x + t2.cantitate_renuntata >= t2.cantitate THEN 'acoperit' END,
             inchis_la = CASE WHEN t2.cantitate_inlocuita + v_x + t2.cantitate_renuntata >= t2.cantitate THEN now() END
       WHERE t2.id = t.id;
      SET LOCAL app.cf_cantitati = '';
      v_rest := v_rest - v_x;
    END LOOP;
  ELSE
    IF NOT v_l.intrare_reconciliata THEN
      RAISE EXCEPTION 'CF_NERECONCILIATA: receptie veche nereconciliata: reconciliati intai' USING ERRCODE = 'P0001';
    END IF;
    IF v_primita + p_cantitate < v_l.cantitate_intrata_stoc OR v_primita + p_cantitate < 0 THEN
      RAISE EXCEPTION 'CF_SUB_INTRAT: primita nu poate cobori sub % (intrat in stoc); pentru marfa intrata folositi returul',
        trim_scale(greatest(v_l.cantitate_intrata_stoc, 0)) USING ERRCODE = 'P0001';
    END IF;
    v_rest := -p_cantitate;
    FOR r IN SELECT * FROM public.comenzi_furnizor_receptii r1 WHERE r1.linie_id = p_linie_id AND r1.tip <> 'corectura' ORDER BY r1.id DESC LOOP
      EXIT WHEN v_rest <= 0;
      SELECT coalesce(sum(c.cantitate), 0) INTO v_corectat FROM public.comenzi_furnizor_receptii c WHERE c.receptie_id = r.id;
      SELECT coalesce(sum(a1.cantitate), 0) INTO v_alocat FROM public.comenzi_furnizor_retur_alocari a1
       WHERE a1.receptie_id = r.id AND a1.inversata_de_receptie_id IS NULL;
      v_take := least(v_rest, r.cantitate - v_corectat);
      CONTINUE WHEN v_take <= 0;
      INSERT INTO public.comenzi_furnizor_receptii (linie_id, tip, cantitate, receptie_id, cheie, moment, creat_de)
      VALUES (p_linie_id, 'corectura', v_take, r.id, p_cheie, now(), v_uid) RETURNING id INTO v_corr_id;
      -- întâi partea nealocată a recepției, apoi alocările ei, de la cea mai nouă
      v_rem := v_take - least(v_take, greatest(r.cantitate - v_corectat - v_alocat, 0));
      FOR a IN SELECT * FROM public.comenzi_furnizor_retur_alocari a2
                WHERE a2.receptie_id = r.id AND a2.inversata_de_receptie_id IS NULL ORDER BY a2.id DESC LOOP
        EXIT WHEN v_rem <= 0;
        v_x := least(v_rem, a.cantitate);
        SELECT t3.inchis_fel INTO v_fel FROM public.comenzi_furnizor_retururi t3 WHERE t3.id = a.retur_id;
        SET LOCAL app.cf_cantitati = '1';
        UPDATE public.comenzi_furnizor_retur_alocari a3 SET inversata_de_receptie_id = v_corr_id WHERE a3.id = a.id;
        IF a.cantitate > v_x THEN
          INSERT INTO public.comenzi_furnizor_retur_alocari (receptie_id, retur_id, cantitate) VALUES (r.id, a.retur_id, a.cantitate - v_x);
        END IF;
        -- partea inversată reapare „de înlocuit”: returul se redeschide; o renunțare rămâne renunțare (cantitate_renuntata neatinsă)
        UPDATE public.comenzi_furnizor_retururi t4
           SET cantitate_inlocuita = t4.cantitate_inlocuita - v_x, asteapta_inlocuire = true, inchis_fel = NULL, inchis_la = NULL
         WHERE t4.id = a.retur_id;
        SET LOCAL app.cf_cantitati = '';
        IF v_fel IS NOT NULL AND NOT (a.retur_id = ANY (v_redeschise)) THEN v_redeschise := v_redeschise || a.retur_id; END IF;
        v_rem := v_rem - v_x;
      END LOOP;
      IF v_rem > 0 THEN RAISE EXCEPTION 'CF_INVARIANT: alocarile receptiei % nu acopera corectura', r.id USING ERRCODE = 'P0001'; END IF;
      v_rest := v_rest - v_take;
    END LOOP;
    IF v_rest > 0 THEN RAISE EXCEPTION 'CF_INVARIANT: jurnalul nu acopera corectura pe linia %', p_linie_id USING ERRCODE = 'P0001'; END IF;
  END IF;
  v_primita := v_primita + p_cantitate;
  SET LOCAL app.cf_cantitati = '1';
  UPDATE public.comenzi_furnizor_linii l SET cantitate_primita = v_primita WHERE l.id = p_linie_id;
  SET LOCAL app.cf_cantitati = '';
  PERFORM public.fn_cf_linie_verifica_intern(p_linie_id);
  v_rez := jsonb_build_object('linie_id', p_linie_id, 'primita', trim_scale(v_primita), 'de_inlocuit', trim_scale(public.fn_cf_de_inlocuit_intern(p_linie_id)),
                              'retururi_redeschise', to_jsonb(v_redeschise), 'reluat', false);
  PERFORM public.fn_cf_intentie_inchide_intern(p_cheie, 'fn_cf_receptie_adauga', v_payload, v_rez);
  RETURN v_rez;
END $f$;
-- 6.2 Predarea în stoc (spec §3.3.4 / §3.3b): mișcarea intrare_achizitie legată de LINIE + intrata_stoc += N, într-o tranzacție; cu
--     p_transfer_proiect = transportul direct: intrare la sediu + fn_transfer_executa spre proiect, în aceeași tranzacție.
--     Ordinea lock-urilor (L06): 0 cheia → 1 comanda FOR SHARE → 2 linia FOR UPDATE → 3 TOATE cheile de stoc atinse (locația intrării; la
--     transportul direct sediul ȘI proiectul), ÎNAINTEA primei mișcări: lock-urile consultative sortate după fn_stoc_cheie, apoi rândurile din
--     stocuri FOR UPDATE (r2: altfel intrarea ține rândul sediului și transferul cere cheia lui = deadlock cu un retur care ține cheia și așteaptă
--     rândul). Dreptul: după pasul 3 și din nou la închiderea intenției (după ultima operație care poate aștepta).
CREATE FUNCTION public.fn_cf_intra_stoc(p_cheie uuid, p_linie_id bigint, p_cantitate numeric, p_transfer_proiect boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid(); v_payload jsonb; v_rez jsonb; v_p record; v_l public.comenzi_furnizor_linii; v_cf public.comenzi_furnizor;
  v_transfer boolean := coalesce(p_transfer_proiect, false); v_loc_tip text; v_loc_id bigint; v_loc_err text; v_mid bigint; v_tr bigint; k record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  v_payload := jsonb_build_object('linie', p_linie_id, 'cantitate', trim_scale(p_cantitate), 'transfer_proiect', v_transfer);
  v_rez := public.fn_cf_intentie_reia_intern(p_cheie, 'fn_cf_intra_stoc', v_payload);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  SELECT * INTO v_p FROM public.fn_cf_linie_pregateste_intern(p_linie_id, true);
  v_l := v_p.linie;
  SELECT * INTO v_cf FROM public.comenzi_furnizor c WHERE c.id = v_l.comanda_furnizor_id;
  -- locația intrării (refuzul vine după verificarea dreptului)
  IF v_transfer THEN
    IF v_cf.proiect_id IS NULL THEN
      v_loc_err := 'CF_LOCATIE_INVALIDA: comanda nu are proiect pentru transportul direct';
    ELSIF v_l.denumire IS DISTINCT FROM btrim(v_l.denumire) THEN
      v_loc_err := 'CF_DENUMIRE_NECANONICA: transportul direct cere denumirea reperului fara spatii la capete';
    END IF;
    v_loc_tip := 'sediu'; v_loc_id := NULL;
  ELSIF v_cf.livrare_tip = 'sediu' THEN
    v_loc_tip := 'sediu'; v_loc_id := NULL;
  ELSIF v_cf.proiect_id IS NOT NULL THEN
    v_loc_tip := 'proiect'; v_loc_id := v_cf.proiect_id;
  ELSE
    v_loc_err := 'CF_LOCATIE_INVALIDA: comanda cu livrare pe santier fara proiect';
  END IF;
  -- pasul 3: toate cheile atinse, ÎNAINTEA primei mișcări (lock-urile consultative sortate, apoi rândurile, în aceeași ordine)
  IF v_loc_err IS NULL THEN
    FOR k IN SELECT x.t, x.i FROM (VALUES (v_loc_tip, v_loc_id, true), ('proiect'::text, v_cf.proiect_id, v_transfer)) x(t, i, atinsa)
              WHERE x.atinsa ORDER BY public.fn_stoc_cheie(x.t, x.i, v_l.denumire) LOOP
      PERFORM public.fn_stoc_cheie_lock(k.t, k.i, v_l.denumire);
    END LOOP;
    FOR k IN SELECT x.t, x.i FROM (VALUES (v_loc_tip, v_loc_id, true), ('proiect'::text, v_cf.proiect_id, v_transfer)) x(t, i, atinsa)
              WHERE x.atinsa ORDER BY public.fn_stoc_cheie(x.t, x.i, v_l.denumire) LOOP
      PERFORM public.fn_stoc_blocheaza(k.t, k.i, v_l.denumire);
    END LOOP;
  END IF;
  IF NOT public.fn_cf_drept_achizitii_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  IF NOT v_l.intrare_reconciliata THEN
    RAISE EXCEPTION 'CF_NERECONCILIATA: receptie veche nereconciliata: reconciliati intai' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.fn_cf_cantitate_valida_intern(p_cantitate) OR p_cantitate <= 0 THEN
    RAISE EXCEPTION 'CF_CANTITATE_INVALIDA: cantitatea predata trebuie sa fie pozitiva, cu cel mult 3 zecimale' USING ERRCODE = 'P0001';
  END IF;
  IF p_cantitate > v_l.cantitate_primita - v_l.cantitate_intrata_stoc THEN
    RAISE EXCEPTION 'CF_PESTE_PRIMIT: se pot preda in stoc cel mult % (primit, neintrat)',
      trim_scale(greatest(v_l.cantitate_primita - v_l.cantitate_intrata_stoc, 0)) USING ERRCODE = 'P0001';
  END IF;
  IF v_loc_err IS NOT NULL THEN RAISE EXCEPTION '%', v_loc_err USING ERRCODE = 'P0001'; END IF;
  SET LOCAL app.cf_cantitati = '1';
  INSERT INTO public.stocuri_miscari (locatie_tip, locatie_id, material_denumire, um, delta, tip, motiv, ref_tip, ref_id, created_by, pret_unitar)
  VALUES (v_loc_tip, v_loc_id, v_l.denumire, v_l.um, p_cantitate, 'intrare_achizitie', 'Predare în stoc ' || v_cf.numar_comanda,
          'comanda_furnizor_linie', p_linie_id, v_uid, v_l.pret_unitar)
  RETURNING id INTO v_mid;
  UPDATE public.comenzi_furnizor_linii l SET cantitate_intrata_stoc = l.cantitate_intrata_stoc + p_cantitate WHERE l.id = p_linie_id RETURNING l.* INTO v_l;
  SET LOCAL app.cf_cantitati = '';
  IF v_transfer THEN
    v_tr := public.fn_transfer_executa('sediu', NULL, 'proiect', v_cf.proiect_id, 'Transport direct la șantier — comanda ' || v_cf.numar_comanda,
              jsonb_build_array(jsonb_build_object('material_denumire', v_l.denumire, 'um', v_l.um, 'cantitate', p_cantitate)));
  END IF;
  v_rez := jsonb_build_object('linie_id', p_linie_id, 'intrata_stoc', trim_scale(v_l.cantitate_intrata_stoc), 'miscare_id', v_mid, 'transfer_id', v_tr,
                              'reluat', false);
  PERFORM public.fn_cf_intentie_inchide_intern(p_cheie, 'fn_cf_intra_stoc', v_payload, v_rez);
  RETURN v_rez;
END $f$;
-- 6.3 Returul (spec §3.3.1): returnabil maxim = primita efectivă; partea din stoc între max(0, q - (primita - intrata)) și min(q, intrata)
--     (implicit maximul); stocul locației alese (sediul sau proiectul comenzii) >= partea din stoc, citit SUB lock-ul cheii (pasul 3).
--     Ordinea lock-urilor (L06): 0 cheia → 1 comanda FOR SHARE → 2 linia FOR UPDATE → 3 cheia de stoc + rândul din stocuri (singura cheie atinsă,
--     înaintea mișcării). Dreptul: după pasul 3 și din nou la închiderea intenției.
CREATE FUNCTION public.fn_cf_retur_inregistreaza(p_cheie uuid, p_linie_id bigint, p_cantitate numeric, p_din_stoc numeric, p_locatie_tip text,
  p_locatie_id bigint, p_motiv text, p_pv_path text, p_asteapta_inlocuire boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid(); v_payload jsonb; v_rez jsonb; v_p record; v_l public.comenzi_furnizor_linii; v_cf public.comenzi_furnizor;
  v_loc_ok boolean; v_stoc numeric; v_min numeric; v_max numeric; v_din numeric; v_id bigint; v_mid bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  v_payload := jsonb_build_object('linie', p_linie_id, 'cantitate', trim_scale(p_cantitate), 'din_stoc', trim_scale(p_din_stoc),
    'locatie_tip', p_locatie_tip, 'locatie_id', p_locatie_id, 'motiv', btrim(p_motiv), 'pv', p_pv_path, 'asteapta', coalesce(p_asteapta_inlocuire, false));
  v_rez := public.fn_cf_intentie_reia_intern(p_cheie, 'fn_cf_retur_inregistreaza', v_payload);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  SELECT * INTO v_p FROM public.fn_cf_linie_pregateste_intern(p_linie_id, true);
  v_l := v_p.linie;
  SELECT * INTO v_cf FROM public.comenzi_furnizor c WHERE c.id = v_l.comanda_furnizor_id;
  v_loc_ok := (p_locatie_tip = 'sediu' AND p_locatie_id IS NULL)
              OR (p_locatie_tip = 'proiect' AND p_locatie_id IS NOT NULL AND p_locatie_id IS NOT DISTINCT FROM v_cf.proiect_id);
  IF coalesce(v_loc_ok, false) THEN
    v_stoc := public.fn_stoc_blocheaza(p_locatie_tip, p_locatie_id, v_l.denumire);
  END IF;
  IF NOT public.fn_cf_drept_achizitii_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(v_loc_ok, false) THEN
    RAISE EXCEPTION 'CF_LOCATIE_INVALIDA: returul se face din sediu sau din proiectul comenzii' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_l.intrare_reconciliata THEN
    RAISE EXCEPTION 'CF_NERECONCILIATA: receptie veche nereconciliata: reconciliati intai' USING ERRCODE = 'P0001';
  END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 5 THEN
    RAISE EXCEPTION 'CF_MOTIV: motivul are cel putin 5 caractere' USING ERRCODE = 'P0001';
  END IF;
  IF p_pv_path IS NOT NULL AND (p_pv_path NOT LIKE v_cf.id::text || '/%' OR position('..' IN p_pv_path) > 0) THEN
    RAISE EXCEPTION 'CF_PV_INVALID: PV-ul returului apartine altei comenzi' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.fn_cf_cantitate_valida_intern(p_cantitate) OR p_cantitate <= 0 THEN
    RAISE EXCEPTION 'CF_CANTITATE_INVALIDA: cantitatea returnata trebuie sa fie pozitiva, cu cel mult 3 zecimale' USING ERRCODE = 'P0001';
  END IF;
  IF p_cantitate > v_l.cantitate_primita THEN
    RAISE EXCEPTION 'CF_PESTE_PRIMIT: se pot returna cel mult %', trim_scale(greatest(v_l.cantitate_primita, 0)) USING ERRCODE = 'P0001';
  END IF;
  v_min := greatest(0, p_cantitate - (v_l.cantitate_primita - v_l.cantitate_intrata_stoc));
  v_max := least(p_cantitate, v_l.cantitate_intrata_stoc);
  v_din := coalesce(p_din_stoc, v_max);
  IF NOT public.fn_cf_cantitate_valida_intern(v_din) OR v_din < v_min OR v_din > v_max THEN
    RAISE EXCEPTION 'CF_DIN_STOC_INVALID: partea din stoc trebuie sa fie intre % si %', trim_scale(v_min), trim_scale(v_max) USING ERRCODE = 'P0001';
  END IF;
  IF v_din > v_stoc THEN
    RAISE EXCEPTION 'CF_STOC_INSUFICIENT: in stoc sunt doar %', trim_scale(v_stoc) USING ERRCODE = 'P0001';
  END IF;
  v_id := nextval('public.comenzi_furnizor_retururi_id_seq'::regclass);
  SET LOCAL app.cf_cantitati = '1';
  IF v_din > 0 THEN
    INSERT INTO public.stocuri_miscari (locatie_tip, locatie_id, material_denumire, um, delta, tip, motiv, ref_tip, ref_id, created_by)
    VALUES (p_locatie_tip, p_locatie_id, v_l.denumire, v_l.um, -v_din, 'retur_furnizor', 'Retur la furnizor, comanda ' || v_cf.numar_comanda || ': ' || btrim(p_motiv),
            'comanda_furnizor_retur', v_id, v_uid)
    RETURNING id INTO v_mid;
  END IF;
  UPDATE public.comenzi_furnizor_linii l
     SET cantitate_primita = l.cantitate_primita - p_cantitate, cantitate_intrata_stoc = l.cantitate_intrata_stoc - v_din
   WHERE l.id = p_linie_id RETURNING l.* INTO v_l;
  SET LOCAL app.cf_cantitati = '';
  INSERT INTO public.comenzi_furnizor_retururi (id, comanda_furnizor_id, linie_id, tip, cantitate, din_stoc, motiv, pv_retur_path, asteapta_inlocuire,
    denumire, um, locatie_tip, locatie_id, stoc_miscare_id, cheie, payload_hash, creat_de)
  VALUES (v_id, v_cf.id, p_linie_id, 'retur', p_cantitate, v_din, btrim(p_motiv), p_pv_path, coalesce(p_asteapta_inlocuire, false),
    v_l.denumire, v_l.um, p_locatie_tip, p_locatie_id, v_mid, p_cheie, md5(v_payload::text), v_uid);
  PERFORM public.fn_cf_linie_verifica_intern(p_linie_id);
  v_rez := jsonb_build_object('retur_id', v_id, 'din_stoc', trim_scale(v_din), 'primita', trim_scale(v_l.cantitate_primita),
                              'intrata_stoc', trim_scale(v_l.cantitate_intrata_stoc), 'stoc_ramas', trim_scale(v_stoc - v_din), 'reluat', false);
  PERFORM public.fn_cf_intentie_inchide_intern(p_cheie, 'fn_cf_retur_inregistreaza', v_payload, v_rez);
  RETURN v_rez;
END $f$;
-- 6.4 Anularea returului (spec §3.3.2): o singură dată, refuzată după înlocuire; pune la loc exact din_stoc, pe cheia SALVATĂ pe retur.
--     Ordinea lock-urilor (L06): 0 cheia → 1 comanda → 2 linia → 3 cheia de stoc salvată (singura atinsă, înaintea mișcării) → 4 returul FOR UPDATE.
--     Dreptul: după pasul 4 și din nou la închiderea intenției.
CREATE FUNCTION public.fn_cf_retur_anuleaza(p_cheie uuid, p_retur_id bigint, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid(); v_payload jsonb; v_rez jsonb; v_p record; v_l public.comenzi_furnizor_linii; v_linie_id bigint;
  v_t public.comenzi_furnizor_retururi; v_id bigint; v_mid bigint; v_numar text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  v_payload := jsonb_build_object('retur', p_retur_id, 'motiv', btrim(p_motiv));
  v_rez := public.fn_cf_intentie_reia_intern(p_cheie, 'fn_cf_retur_anuleaza', v_payload);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  SELECT t.linie_id INTO v_linie_id FROM public.comenzi_furnizor_retururi t WHERE t.id = p_retur_id AND t.tip = 'retur';
  IF NOT FOUND THEN RAISE EXCEPTION 'CF_RETUR_INEXISTENT: returul nu exista' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_p FROM public.fn_cf_linie_pregateste_intern(v_linie_id, true);
  v_l := v_p.linie;
  SELECT * INTO v_t FROM public.comenzi_furnizor_retururi t WHERE t.id = p_retur_id;
  PERFORM public.fn_stoc_blocheaza(v_t.locatie_tip, v_t.locatie_id, v_t.denumire);
  SELECT * INTO v_t FROM public.comenzi_furnizor_retururi t WHERE t.id = p_retur_id FOR UPDATE;
  IF NOT public.fn_cf_drept_achizitii_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  IF NOT v_l.intrare_reconciliata THEN
    RAISE EXCEPTION 'CF_NERECONCILIATA: receptie veche nereconciliata: reconciliati intai' USING ERRCODE = 'P0001';
  END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 5 THEN
    RAISE EXCEPTION 'CF_MOTIV: motivul are cel putin 5 caractere' USING ERRCODE = 'P0001';
  END IF;
  IF v_t.inchis_fel IS NOT DISTINCT FROM 'anulat' OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_retururi a WHERE a.retur_id = p_retur_id) THEN
    RAISE EXCEPTION 'CF_DEJA_ANULAT: returul a fost deja anulat' USING ERRCODE = 'P0001';
  END IF;
  IF v_t.cantitate_inlocuita > 0 THEN
    RAISE EXCEPTION 'CF_RETUR_INLOCUIT: returul are deja inlocuire receptionata (%); nu se mai anuleaza', trim_scale(v_t.cantitate_inlocuita) USING ERRCODE = 'P0001';
  END IF;
  SELECT c.numar_comanda INTO v_numar FROM public.comenzi_furnizor c WHERE c.id = v_t.comanda_furnizor_id;
  v_id := nextval('public.comenzi_furnizor_retururi_id_seq'::regclass);
  SET LOCAL app.cf_cantitati = '1';
  IF v_t.din_stoc > 0 THEN
    INSERT INTO public.stocuri_miscari (locatie_tip, locatie_id, material_denumire, um, delta, tip, motiv, ref_tip, ref_id, created_by)
    VALUES (v_t.locatie_tip, v_t.locatie_id, v_t.denumire, v_t.um, v_t.din_stoc, 'retur_furnizor_anulare',
            'Anulare retur la furnizor, comanda ' || v_numar || ': ' || btrim(p_motiv), 'comanda_furnizor_retur', v_id, v_uid)
    RETURNING id INTO v_mid;
  END IF;
  UPDATE public.comenzi_furnizor_linii l
     SET cantitate_primita = l.cantitate_primita + v_t.cantitate, cantitate_intrata_stoc = l.cantitate_intrata_stoc + v_t.din_stoc
   WHERE l.id = v_linie_id RETURNING l.* INTO v_l;
  UPDATE public.comenzi_furnizor_retururi t
     SET asteapta_inlocuire = false, inchis_fel = 'anulat', inchis_la = now(), inchis_motiv = btrim(p_motiv)
   WHERE t.id = p_retur_id;
  SET LOCAL app.cf_cantitati = '';
  INSERT INTO public.comenzi_furnizor_retururi (id, comanda_furnizor_id, linie_id, tip, retur_id, cantitate, din_stoc, motiv, denumire, um, locatie_tip,
    locatie_id, stoc_miscare_id, cheie, payload_hash, creat_de)
  VALUES (v_id, v_t.comanda_furnizor_id, v_linie_id, 'anulare', p_retur_id, v_t.cantitate, v_t.din_stoc, btrim(p_motiv), v_t.denumire, v_t.um,
    v_t.locatie_tip, v_t.locatie_id, v_mid, p_cheie, md5(v_payload::text), v_uid);
  PERFORM public.fn_cf_linie_verifica_intern(v_linie_id);
  v_rez := jsonb_build_object('anulare_id', v_id, 'retur_id', p_retur_id, 'pus_inapoi_in_stoc', trim_scale(v_t.din_stoc),
                              'primita', trim_scale(v_l.cantitate_primita), 'intrata_stoc', trim_scale(v_l.cantitate_intrata_stoc), 'reluat', false);
  PERFORM public.fn_cf_intentie_inchide_intern(p_cheie, 'fn_cf_retur_anuleaza', v_payload, v_rez);
  RETURN v_rez;
END $f$;
-- 6.5 Închide fără înlocuire (spec §3.3.5): renunțarea = restul neînlocuit; nicio corectură de recepție nu o anulează.
--     Ordinea lock-urilor (L06): 0 cheia → 1 comanda → 2 linia → 4 returul FOR UPDATE; fără mișcări de stoc. Dreptul: după pasul 4 și din nou la
--     închiderea intenției.
CREATE FUNCTION public.fn_cf_retur_inchide_fara_inlocuire(p_cheie uuid, p_retur_id bigint, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid(); v_payload jsonb; v_rez jsonb; v_p record; v_linie_id bigint; v_t public.comenzi_furnizor_retururi;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  v_payload := jsonb_build_object('retur', p_retur_id, 'motiv', btrim(p_motiv));
  v_rez := public.fn_cf_intentie_reia_intern(p_cheie, 'fn_cf_retur_inchide_fara_inlocuire', v_payload);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  SELECT t.linie_id INTO v_linie_id FROM public.comenzi_furnizor_retururi t WHERE t.id = p_retur_id AND t.tip = 'retur';
  IF NOT FOUND THEN RAISE EXCEPTION 'CF_RETUR_INEXISTENT: returul nu exista' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_p FROM public.fn_cf_linie_pregateste_intern(v_linie_id, true);
  SELECT * INTO v_t FROM public.comenzi_furnizor_retururi t WHERE t.id = p_retur_id FOR UPDATE;
  IF NOT public.fn_cf_drept_achizitii_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 5 THEN
    RAISE EXCEPTION 'CF_MOTIV: motivul are cel putin 5 caractere' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_t.asteapta_inlocuire OR v_t.inchis_fel IS NOT NULL THEN
    RAISE EXCEPTION 'CF_RETUR_INCHIS: returul nu asteapta inlocuire' USING ERRCODE = 'P0001';
  END IF;
  SET LOCAL app.cf_cantitati = '1';
  UPDATE public.comenzi_furnizor_retururi t
     SET cantitate_renuntata = t.cantitate - t.cantitate_inlocuita, asteapta_inlocuire = false, inchis_fel = 'renuntat', inchis_la = now(),
         inchis_motiv = btrim(p_motiv)
   WHERE t.id = p_retur_id RETURNING t.* INTO v_t;
  SET LOCAL app.cf_cantitati = '';
  PERFORM public.fn_cf_linie_verifica_intern(v_linie_id);
  v_rez := jsonb_build_object('retur_id', p_retur_id, 'renuntat', trim_scale(v_t.cantitate_renuntata),
                              'de_inlocuit', trim_scale(public.fn_cf_de_inlocuit_intern(v_linie_id)), 'reluat', false);
  PERFORM public.fn_cf_intentie_inchide_intern(p_cheie, 'fn_cf_retur_inchide_fara_inlocuire', v_payload, v_rez);
  RETURN v_rez;
END $f$;
-- 6.6 Reconcilierea manuală a unei linii vechi (spec §3.3b), DOAR owner: intrata_stoc atribuit de un om + marcajul. O singură dată pe linie.
--     Ordinea lock-urilor (L06): 0 cheia → 1 comanda → 2 linia; fără mișcări de stoc. Dreptul (owner): după pasul 2 și din nou la închiderea intenției.
CREATE FUNCTION public.fn_cf_reconciliaza_linie(p_cheie uuid, p_linie_id bigint, p_intrata_stoc numeric, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid(); v_payload jsonb; v_rez jsonb; v_p record; v_l public.comenzi_furnizor_linii; v_inainte numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  v_payload := jsonb_build_object('linie', p_linie_id, 'intrata_stoc', trim_scale(p_intrata_stoc), 'motiv', btrim(p_motiv));
  v_rez := public.fn_cf_intentie_reia_intern(p_cheie, 'fn_cf_reconciliaza_linie', v_payload);
  IF v_rez IS NOT NULL THEN RETURN v_rez; END IF;
  SELECT * INTO v_p FROM public.fn_cf_linie_pregateste_intern(p_linie_id, false);
  v_l := v_p.linie;
  IF NOT public.fn_cf_este_owner_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  IF v_l.intrare_reconciliata THEN
    RAISE EXCEPTION 'CF_DEJA_RECONCILIATA: linia este deja reconciliata' USING ERRCODE = 'P0001';
  END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 5 THEN
    RAISE EXCEPTION 'CF_MOTIV: motivul are cel putin 5 caractere' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.fn_cf_cantitate_valida_intern(p_intrata_stoc) OR p_intrata_stoc < 0 OR p_intrata_stoc > coalesce(v_l.cantitate_primita, 0) THEN
    RAISE EXCEPTION 'CF_CANTITATE_INVALIDA: intrat in stoc trebuie sa fie intre 0 si % (primit)', trim_scale(coalesce(v_l.cantitate_primita, 0))
      USING ERRCODE = 'P0001';
  END IF;
  v_inainte := v_l.cantitate_intrata_stoc;
  SET LOCAL app.cf_cantitati = '1';
  UPDATE public.comenzi_furnizor_linii l SET cantitate_intrata_stoc = p_intrata_stoc, intrare_reconciliata = true WHERE l.id = p_linie_id RETURNING l.* INTO v_l;
  SET LOCAL app.cf_cantitati = '';
  v_rez := jsonb_build_object('linie_id', p_linie_id, 'intrata_stoc_inainte', trim_scale(v_inainte), 'intrata_stoc', trim_scale(v_l.cantitate_intrata_stoc),
                              'motiv', btrim(p_motiv), 'reluat', false);
  PERFORM public.fn_cf_intentie_inchide_intern(p_cheie, 'fn_cf_reconciliaza_linie', v_payload, v_rez);
  RETURN v_rez;
END $f$;
-- 6.7 Ștergerea unei poziții de stoc (Magazie, „Șterge poziția”), DOAR owner (ca azi): mișcările neprotejate + poziția, într-o tranzacție, sub lock.
--     Ordinea lock-urilor (L06): 3 cheia de stoc → rândul din stocuri FOR UPDATE (apoi trigger-ele de ștergere, pe aceeași cheie). Dreptul: după
--     lock-uri și din nou după ștergeri.
CREATE FUNCTION public.fn_stoc_sterge_pozitie(p_stoc_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_k record; v_s public.stocuri; v_n bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  SELECT s.locatie_tip, s.locatie_id, s.material_denumire INTO v_k FROM public.stocuri s WHERE s.id = p_stoc_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CF_POZITIE_INEXISTENTA: pozitia de stoc nu exista' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.fn_stoc_cheie_lock(v_k.locatie_tip, v_k.locatie_id, v_k.material_denumire);
  SELECT * INTO v_s FROM public.stocuri s WHERE s.id = p_stoc_id FOR UPDATE;
  IF v_s.id IS NULL OR (v_s.locatie_tip, v_s.locatie_id, v_s.material_denumire) IS DISTINCT FROM (v_k.locatie_tip, v_k.locatie_id, v_k.material_denumire) THEN
    RAISE EXCEPTION 'CF_VALOARE_SCHIMBATA: pozitia s-a schimbat intre timp; reincarcati pagina' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.fn_cf_este_owner_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.stocuri_miscari m
              WHERE m.locatie_tip = v_s.locatie_tip AND m.locatie_id IS NOT DISTINCT FROM v_s.locatie_id AND m.material_denumire = v_s.material_denumire
                AND public.fn_stoc_miscare_protejata(m.tip, m.ref_tip)) THEN
    RAISE EXCEPTION 'CF_ISTORIC_PROTEJAT: pozitie cu istoric de achizitie / retur; corectati prin ajustare' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.stocuri_miscari m
   WHERE m.locatie_tip = v_s.locatie_tip AND m.locatie_id IS NOT DISTINCT FROM v_s.locatie_id AND m.material_denumire = v_s.material_denumire;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.stocuri s WHERE s.id = p_stoc_id;
  -- reverificarea FINALĂ a dreptului, după ultima operație care poate aștepta (ștergerea mișcărilor: rânduri ținute de alte tranzacții)
  IF NOT public.fn_cf_este_owner_intern(v_uid) THEN RAISE EXCEPTION 'CF_DREPT: operatie nepermisa' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('stoc_id', p_stoc_id, 'material', v_s.material_denumire, 'miscari_sterse', v_n);
END $f$;
-- drepturile: nimic pentru PUBLIC / anon / service_role; EXECUTE pentru authenticated DOAR pe RPC-urile ecranului
REVOKE ALL ON FUNCTION public.fn_stoc_miscare_protejata(text, text), public.fn_cf_cantitate_valida_intern(numeric),
  public.fn_stoc_cheie(text, bigint, text), public.fn_stoc_cheie_lock(text, bigint, text), public.fn_stoc_blocheaza(text, bigint, text),
  public.fn_cf_drept_achizitii_intern(uuid),
  public.fn_cf_este_owner_intern(uuid), public.fn_cf_dovada_receptie_intern(public.comenzi_furnizor_linii, public.comenzi_furnizor),
  public.fn_cf_intentie_reia_intern(uuid, text, jsonb), public.fn_cf_intentie_inchide_intern(uuid, text, jsonb, jsonb),
  public.fn_cf_linie_pregateste_intern(bigint, boolean), public.fn_cf_de_inlocuit_intern(bigint), public.fn_cf_linie_verifica_intern(bigint),
  public.fn_stoc_miscari_lock_iesire(), public.fn_stoc_miscari_provenienta(), public.fn_stoc_miscari_garda_istoric(), public.fn_stocuri_lock_stergere(),
  public.fn_cfl_protectie(), public.fn_cf_retururi_garda(), public.fn_cf_alocari_garda(), public.fn_cf_jurnal_garda(),
  public.fn_cf_receptie_adauga(uuid, bigint, numeric, numeric), public.fn_cf_intra_stoc(uuid, bigint, numeric, boolean),
  public.fn_cf_retur_inregistreaza(uuid, bigint, numeric, numeric, text, bigint, text, text, boolean), public.fn_cf_retur_anuleaza(uuid, bigint, text),
  public.fn_cf_retur_inchide_fara_inlocuire(uuid, bigint, text), public.fn_cf_reconciliaza_linie(uuid, bigint, numeric, text),
  public.fn_stoc_sterge_pozitie(bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cf_receptie_adauga(uuid, bigint, numeric, numeric), public.fn_cf_intra_stoc(uuid, bigint, numeric, boolean),
  public.fn_cf_retur_inregistreaza(uuid, bigint, numeric, numeric, text, bigint, text, text, boolean), public.fn_cf_retur_anuleaza(uuid, bigint, text),
  public.fn_cf_retur_inchide_fara_inlocuire(uuid, bigint, text), public.fn_cf_reconciliaza_linie(uuid, bigint, numeric, text),
  public.fn_stoc_sterge_pozitie(bigint)
  TO authenticated;

-- ─── 7. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_amp text; v_rau text; r record;
BEGIN
  -- drepturile pe tabelele noi, verificate pe rând (has_table_privilege cu o listă e adevărat la ORICARE drept)
  FOR r IN SELECT t, rol, drept, astept FROM (VALUES ('comenzi_furnizor_retururi'), ('comenzi_furnizor_receptii'), ('comenzi_furnizor_retur_alocari'),
              ('comenzi_furnizor_intentii')) a(t)
           CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) b(rol)
           CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) c(drept)
           CROSS JOIN LATERAL (SELECT b.rol = 'authenticated' AND c.drept = 'SELECT' AND a.t <> 'comenzi_furnizor_intentii' AS astept) d LOOP
    IF has_table_privilege(r.rol, 'public.' || r.t, r.drept) IS DISTINCT FROM r.astept THEN
      RAISE EXCEPTION '20270110a post: dreptul % al lui % pe % (asteptat %)', r.drept, r.rol, r.t, r.astept;
    END IF;
  END LOOP;
  -- liniile: authenticated nu mai are UPDATE pe tabel și nici pe cele 3 coloane; are UPDATE pe celelalte coloane
  IF has_table_privilege('authenticated', 'public.comenzi_furnizor_linii', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.comenzi_furnizor_linii', 'cantitate_primita', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.comenzi_furnizor_linii', 'cantitate_intrata_stoc', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.comenzi_furnizor_linii', 'intrare_reconciliata', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.comenzi_furnizor_linii', 'termen_livrare', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.comenzi_furnizor_linii', 'cantitate', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.comenzi_furnizor_linii', 'observatii', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.comenzi_furnizor_linii', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.comenzi_furnizor_linii', 'SELECT') THEN
    RAISE EXCEPTION '20270110a post: drepturile authenticated pe comenzi_furnizor_linii';
  END IF;
  -- EXECUTE: doar authenticated, doar pe cele 7 RPC-uri ale ecranului; nimic pentru anon / service_role / PUBLIC pe funcțiile noi
  SELECT string_agg(p.proname || ':' || x.rol, ', ') INTO v_rau
    FROM pg_proc p CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('public')) x(rol)
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('fn_stoc_miscare_protejata', 'fn_cf_cantitate_valida_intern', 'fn_stoc_cheie', 'fn_stoc_cheie_lock', 'fn_stoc_blocheaza', 'fn_cf_drept_achizitii_intern',
       'fn_cf_este_owner_intern', 'fn_cf_dovada_receptie_intern', 'fn_cf_intentie_reia_intern', 'fn_cf_intentie_inchide_intern', 'fn_cf_linie_pregateste_intern',
       'fn_cf_de_inlocuit_intern', 'fn_cf_linie_verifica_intern', 'fn_stoc_miscari_lock_iesire', 'fn_stoc_miscari_provenienta', 'fn_stoc_miscari_garda_istoric',
       'fn_stocuri_lock_stergere', 'fn_cfl_protectie', 'fn_cf_retururi_garda', 'fn_cf_alocari_garda', 'fn_cf_jurnal_garda', 'fn_cf_receptie_adauga',
       'fn_cf_intra_stoc', 'fn_cf_retur_inregistreaza', 'fn_cf_retur_anuleaza', 'fn_cf_retur_inchide_fara_inlocuire', 'fn_cf_reconciliaza_linie',
       'fn_stoc_sterge_pozitie')
     AND (CASE WHEN x.rol = 'public' THEN EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0)
               ELSE has_function_privilege(x.rol, p.oid, 'EXECUTE') END)
       IS DISTINCT FROM (x.rol = 'authenticated' AND p.proname IN ('fn_cf_receptie_adauga', 'fn_cf_intra_stoc', 'fn_cf_retur_inregistreaza',
         'fn_cf_retur_anuleaza', 'fn_cf_retur_inchide_fara_inlocuire', 'fn_cf_reconciliaza_linie', 'fn_stoc_sterge_pozitie'));
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270110a post: drepturile EXECUTE pe functiile noi: %', v_rau; END IF;
  -- marcajul de tranzacție e scris DOAR de RPC-urile / ajutătoarele acestei migrări și citit doar de trigger-ele ei
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_rau FROM pg_proc p
   WHERE p.prosrc LIKE '%app.cf\_cantitati%'
     AND p.proname NOT IN ('fn_cf_linie_pregateste_intern', 'fn_cf_receptie_adauga', 'fn_cf_intra_stoc', 'fn_cf_retur_inregistreaza', 'fn_cf_retur_anuleaza',
                           'fn_cf_retur_inchide_fara_inlocuire', 'fn_cf_reconciliaza_linie', 'fn_stoc_miscari_provenienta', 'fn_cfl_protectie',
                           'fn_cf_retururi_garda', 'fn_cf_alocari_garda');
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270110a post: alte functii ating marcajul app.cf_cantitati: %', v_rau; END IF;
  -- RPC-urile expuse nu conțin cuvintele verificate de GATE 0e (scripts/control_0e.sql)
  SELECT string_agg(p.proname, ', ') INTO v_rau FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND p.proname IN ('fn_cf_receptie_adauga', 'fn_cf_intra_stoc', 'fn_cf_retur_inregistreaza', 'fn_cf_retur_anuleaza', 'fn_cf_retur_inchide_fara_inlocuire',
                       'fn_cf_reconciliaza_linie', 'fn_stoc_sterge_pozitie')
     AND lower(p.prosrc) ~ '(\mexecute\M|set_config|request\.jwt|session_authorization|\mu&)';
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270110a post: cuvinte GATE 0e in %', v_rau; END IF;
  -- dependențele: neatinse
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_stocuri_aplica_miscare()', 'b56c13c686ad49f4c641eb461be371b5'),
      ('public.fn_stoc_ajustare(text,bigint,text,text,numeric,text)', '4e8c598952ae6278c9e702d7d00748e4'),
      ('public.fn_transfer_executa(text,bigint,text,bigint,text,jsonb)', '4e46abcbbd65110cdbad363b52146b93'),
      ('public.fn_cfl_sync_cereri()', '800ff2655c3b5cd2e971cd86a99b5bf1'),
      ('public.fn_cfl_automatch()', 'cf167608e329c87b294e5e76102dfe02'),
      ('public.fn_cerere_rollup_status(bigint)', 'ed06d5aa3bc5f5977a393c50a007b010')
    ) v(semn, md5) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.semn) AND md5(replace(p.prosrc, chr(13), '')) = r.md5
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '20270110a post: dependenta % schimbata', r.semn;
    END IF;
  END LOOP;
  -- datele: nimic scris în tabelele noi, toate liniile existente nereconciliate, CHECK-urile validate
  IF EXISTS (SELECT 1 FROM public.comenzi_furnizor_retururi) OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_receptii)
     OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_retur_alocari) OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_intentii)
     OR EXISTS (SELECT 1 FROM public.comenzi_furnizor_linii l WHERE l.intrare_reconciliata) THEN
    RAISE EXCEPTION '20270110a post: date scrise de migrare';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid IN ('public.comenzi_furnizor_linii'::regclass, 'public.stocuri_miscari'::regclass)
               AND k.contype = 'c' AND NOT k.convalidated) THEN
    RAISE EXCEPTION '20270110a post: CHECK nevalidat pe linii / miscari';
  END IF;
  -- AMPRENTA_20270110a_INCEPUT
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'rel ' || c.relname || ' k=' || c.relkind::text || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
           || ' own=' || pg_get_userbyid(c.relowner) || ' acl=' || coalesce(c.relacl::text, '-') AS l
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii',
                         'comenzi_furnizor_retururi_id_seq', 'comenzi_furnizor_receptii_id_seq', 'comenzi_furnizor_retur_alocari_id_seq')
    UNION ALL
    SELECT 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull
           || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text
           || ' acl=' || coalesce(a.attacl::text, '-')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii')
            OR (c.relname = 'comenzi_furnizor_linii' AND (a.attname = 'intrare_reconciliata' OR a.attacl IS NOT NULL)))
    UNION ALL
    SELECT 'con ' || c.relname || '.' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' defer=' || k.condeferrable
           || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype <> 'n' AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii')
            OR k.conname IN ('comenzi_furnizor_linii_intrata_sub_primita_check', 'stocuri_miscari_tip_check', 'stocuri_miscari_retur_furnizor_check'))
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' valid=' || i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii')
    UNION ALL
    SELECT 'pol ' || c.relname || '.' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roluri=' || (SELECT string_agg(CASE WHEN o = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(o) END, ',' ORDER BY 1) FROM unnest(p.polroles) o)
           || ' q=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' c=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii')
    UNION ALL
    SELECT 'trg ' || c.relname || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
       AND t.tgname IN ('trg_stoc_miscari_lock_iesire', 'trg_stoc_miscari_provenienta', 'trg_stoc_miscari_lock_stergere', 'trg_stoc_miscari_istoric_update',
                        'trg_stocuri_lock_stergere', 'trg_cfl_protectie', 'trg_cf_retururi_garda', 'trg_cf_retururi_golire', 'trg_cf_retur_alocari_garda',
                        'trg_cf_retur_alocari_golire', 'trg_cf_receptii_garda', 'trg_cf_receptii_golire', 'trg_cf_intentii_garda', 'trg_cf_intentii_golire')
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('fn_stoc_miscare_protejata', 'fn_cf_cantitate_valida_intern', 'fn_stoc_cheie', 'fn_stoc_cheie_lock', 'fn_stoc_blocheaza', 'fn_cf_drept_achizitii_intern',
         'fn_cf_este_owner_intern', 'fn_cf_dovada_receptie_intern', 'fn_cf_intentie_reia_intern', 'fn_cf_intentie_inchide_intern', 'fn_cf_linie_pregateste_intern',
         'fn_cf_de_inlocuit_intern', 'fn_cf_linie_verifica_intern', 'fn_stoc_miscari_lock_iesire', 'fn_stoc_miscari_provenienta', 'fn_stoc_miscari_garda_istoric',
         'fn_stocuri_lock_stergere', 'fn_cfl_protectie', 'fn_cf_retururi_garda', 'fn_cf_alocari_garda', 'fn_cf_jurnal_garda', 'fn_cf_receptie_adauga',
         'fn_cf_intra_stoc', 'fn_cf_retur_inregistreaza', 'fn_cf_retur_anuleaza', 'fn_cf_retur_inchide_fara_inlocuire', 'fn_cf_reconciliaza_linie',
         'fn_stoc_sterge_pozitie')
  ) x;
  -- AMPRENTA_20270110a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM 'a1f187b8c1d25c4f81d434cb04eff23d' THEN
    RAISE NOTICE 'AMPRENTA_20270110a_TEXT %', v_amp;
    RAISE EXCEPTION '20270110a post: AMPRENTA obiectelor % (asteptat a1f187b8c1d25c4f81d434cb04eff23d)', md5(coalesce(v_amp, ''));
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270110a_achizitii_retur_furnizor:' || txid_current() THEN
    RAISE EXCEPTION '20270110a: garda final invalida';
  END IF;
  RAISE NOTICE '20270110a: sfarsit la % ms de la BEGIN; lock-urile tinute de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
