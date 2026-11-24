-- Version 20270111120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270111a_ctc_autorizatii_ndt.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului
--   în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA). Manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh --iesire, docs/LIVRARE_L15_V2.md §5); lista OBIECTELOR revizuită (generată pe PGlite cu pașii reali ai
--   runnerului): supabase/tests/20270111a_ctc_autorizatii_ndt.l15.obiecte.tsv. Dry-run pe clonă după aplicare (ROLLBACK):
--   supabase/tests/20270111a_ctc_autorizatii_ndt_dryrun.sql.
-- 20270111a_ctc_autorizatii_ndt — CTC: autorizațiile FIRMELOR de control nedistructiv (NDT) la cartea tehnică (TKT-2026-0389, varianta A a
--   owner-ului: „le urcăm ca documente pe firma de control, fără modul nou”). Specificația: docs/superpowers/specs/2026-11-25-ctc-autorizatii-ndt-design.md (v4).
-- Ce face:
--   1. ofertare_parteneri_documente: categoria nouă 'autorizatie_ndt' în CHECK-ul ofertare_parteneri_documente_categorie_check (același nume);
--      `domeniu` ține metoda (RT / UT / PT / MT / VT sau text liber). Introducerea rămâne în Ofertare → Parteneri.
--   2. Garda căii fișierului (L07: pe TOATE căile de scriere, inclusiv PATCH direct prin PostgREST): trigger-ul trg_ofertare_doc_cale_garda,
--      BEFORE INSERT OR UPDATE OF fisier_path, partener_id, categorie, funcția fn_ofertare_doc_cale_garda() (SECURITY INVOKER, search_path fix,
--      fără EXECUTE pentru clienți; un trigger nu cere EXECUTE la declanșare), pentru TOATE categoriile, când fisier_path nu e NULL:
--        * calea nu e goală (nu e doar spațiu / tab / LF / VT / FF / CR), n-are backslash, „%”, caractere de control și niciun segment egal
--          cu „.” sau „..” (punctele din nume sunt permise). Ambele clase sunt EXPLICITE, din coduri (chr), nu [[:space:]] / [[:cntrl:]]
--          (acelea depind de colaționarea bazei): control = U+0001–U+001F și U+007F–U+009F. Aceeași listă în edge (caleNdtSigura) și în
--          ecran (caleValida), probată pe tabelul comun de cazuri. Spațiile, diacriticele și lungimea numelui sunt permise;
--        * 'autorizatie_ndt' = EXACT parteneri/<partener_id>/ndt/<nume> (un singur segment după ndt/, aceeași firmă);
--        * orice altă categorie = fără un segment „ndt/” (nimeni nu pune în subdosarul NDT un document de altă natură).
--      Plus unicitatea căii: indexul unic parțial ofertare_parteneri_documente_fisier_path_uq (fisier_path, unde nu e NULL) — un rând NDT nu
--      poate arăta fișierul altui document.
--   3. fn_ctc_autorizatii_ndt() — lista pentru CTC: DOAR rândurile 'autorizatie_ndt' (filtru în corp), cu firma (nume, CUI), număr, emitent,
--      metoda, datele, fara_expirare, starea (valabil / expirat / necunoscut, după ziua din România, L17) și are_fisier. NU întoarce calea,
--      observațiile, denumirea internă sau contactul. Dreptul = fn_ctc_autorizatii_drept() (20261222b, neschimbat) pe auth.uid(); fără = 42501.
--   4. fn_ctc_autorizatie_ndt_fisier(p_document_id) — calea scanului DOAR pentru un rând 'autorizatie_ndt' a cărui cale trece din nou regula NDT
--      de la pct. 2 (un rând vechi sau scris ocolind trigger-ul nu dă o cale); altfel NULL, fără să deosebească „nu există” de „nu e NDT” /
--      „fără fișier” / „cale invalidă” (fără oracol). Fără drept CTC = 42501. O folosește edge fn ctc-autorizatie-fisier (ramura
--      ndt_document_id), cu JWT-ul utilizatorului; edge-ul reverifică forma și semnează exact calea, 60 s, în bucket-ul ofertare.
--   Ambele RPC-uri: SECURITY DEFINER, search_path fix, EXECUTE doar authenticated. fn_ctc_autorizatie_fisier(bigint) (sudorii) rămâne neatinsă.
-- Ce NU face: nu dă acces la Ofertare, nu schimbă politicile / drepturile pe ofertare_parteneri_documente sau pe bucket-ul ofertare, nu atinge date.
-- Datele existente: garda și indexul se verifică pe rândurile existente, sub lock, ÎNAINTE de creare (blocul $stare$: orice cale existentă are
--   forma ecranului de azi, parteneri/<partener_id>/<timp>_<nume>, care trece garda; nicio cale dublă); altfel refuz, nimic schimbat.
-- Lock-uri (L06): un singur tabel, ACCESS EXCLUSIVE NOWAIT pe public.ofertare_parteneri_documente, luat ÎNAINTEA verificărilor de stare (L14),
--   cu bugetul de 1 s de la prima încercare (blocul $lock$); ocupat = 55P03, nimic schimbat. Celelalte obiecte (funcțiile) nu blochează tabele.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), bugetul de lock 1 s, lock_timeout 100 ms
--   (lock-urile implicite), garda finală a runnerului (PLAFON_TIMP + LOCK_TINUT).
-- Ordinea livrării: (1) această migrare, (2) deploy ctc-autorizatie-fisier (ramura ndt_document_id; verify_jwt = true), (3) merge (ecranele).
--   Ecranul nou înaintea BD-ului: secțiunea NDT arată „încă neactivă” (PGRST202), Parteneri refuză categoria nouă prin CHECK (eroare afișată).
-- Revenire: supabase/revenire/20270111a_ctc_autorizatii_ndt_ROLLBACK.sql (ordinea: întâi UI-ul, apoi edge-ul fără ramura ndt, apoi BD-ul).
--   Revenirea 20261222b refuză cât timp există funcțiile de aici (ele cheamă fn_ctc_autorizatii_drept): întâi se revine 20270111a.
-- Probe: scripts/pglite/test_ctc_autorizatii_ndt_local.mjs (pe 20260924 + 20261222b reale; pașii L15 v2 reali; refuzuri, revenire, mutanți).
DO $pre$
DECLARE v_plafon text; r record; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270111a_ctc_autorizatii_ndt:' || txid_current() THEN
    RAISE EXCEPTION '20270111a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270111a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270111a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270111a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270111a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261225a / 20270109a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270111a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.ofertare_parteneri_documente') IS NULL OR to_regclass('public.ofertare_parteneri') IS NULL THEN
    RAISE EXCEPTION '20270111a: lipseste ofertare_parteneri / ofertare_parteneri_documente';
  END IF;
  IF to_regprocedure('public.fn_ofertare_doc_cale_garda()') IS NOT NULL OR to_regprocedure('public.fn_ctc_autorizatii_ndt()') IS NOT NULL
     OR to_regprocedure('public.fn_ctc_autorizatie_ndt_fisier(bigint)') IS NOT NULL
     OR to_regclass('public.ofertare_parteneri_documente_fisier_path_uq') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN ('fn_ofertare_doc_cale_garda', 'fn_ctc_autorizatii_ndt', 'fn_ctc_autorizatie_ndt_fisier')) THEN
    RAISE EXCEPTION '20270111a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / păzite, cu tipurile acceptate (ofertare_parteneri e creat direct în producție: se verifică aici, nu se presupune)
  FOR r IN SELECT * FROM (VALUES
      ('ofertare_parteneri_documente', 'id', 'bigint'), ('ofertare_parteneri_documente', 'partener_id', 'bigint'),
      ('ofertare_parteneri_documente', 'categorie', 'text'), ('ofertare_parteneri_documente', 'numar_document', 'text'),
      ('ofertare_parteneri_documente', 'emitent', 'text'), ('ofertare_parteneri_documente', 'data_emitere', 'date'),
      ('ofertare_parteneri_documente', 'data_valabilitate', 'date'), ('ofertare_parteneri_documente', 'fara_expirare', 'boolean'),
      ('ofertare_parteneri_documente', 'domeniu', 'text'), ('ofertare_parteneri_documente', 'fisier_path', 'text'),
      ('ofertare_parteneri', 'id', 'bigint|integer'), ('ofertare_parteneri', 'nume', 'text|character varying'),
      ('ofertare_parteneri', 'cui', 'text|character varying')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20270111a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  -- dependența: predicatul CTC din 20261222b, neschimbat (corp fără CR, limbaj, DEFINER, volatil, search_path, proprietar, ACL doar postgres)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_ctc_autorizatii_drept()')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'fde56a1c781ebe02a9deb4b0f1ad57e6' AND l.lanname = 'sql'
                   AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text = '{postgres=X/postgres}') THEN
    RAISE EXCEPTION '20270111a: fn_ctc_autorizatii_drept nu e cea din 20261222b (corp, proprietati sau drepturi)';
  END IF;
END $pre$;

-- ─── 0. Lock-ul, ÎNAINTEA verificărilor de stare (L14): punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare (șablonul 20270109a);
--     momentul în gazpet.lock_puternic_la pentru LOCK_TINUT. Ocupat peste buget = 55P03, nimic schimbat. Lock-urile IMPLICITE de după
--     (CHECK, index, trigger pe același tabel — deja ținut mai tare; citirea ofertare_parteneri doar la apelul RPC-urilor) = lock_timeout. ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270111a: BUGET_LOCK: ofertare_parteneri_documente ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.ofertare_parteneri_documente IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270111a: BUGET_LOCK: lock-ul pe ofertare_parteneri_documente obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270111a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Starea EXACTĂ din 20260924 (sub lock): CHECK-urile tabelului, triggerele, datele pe care le vor păzi garda și indexul ─────────
DO $stare$
DECLARE v_rau text; v_n integer; v_strain integer; v_dublu integer;
BEGIN
  -- toate CHECK-urile tabelului, cu numele și definiția (lista completă; altceva = refuz)
  SELECT string_agg(coalesce(a.conname, '+' || c.conname), ', ' ORDER BY coalesce(a.conname, c.conname)) INTO v_rau
    FROM (VALUES
      -- >>> CHECK-URI 20260924
      ('ofertare_parteneri_documente_categorie_check', 'CHECK ((categorie = ANY (ARRAY[''autorizatie_isc''::text, ''iso''::text, ''certificat_legal''::text, ''atestat''::text, ''etalonare''::text, ''alta''::text])))')
      -- <<< CHECK-URI 20260924
    ) a(conname, def)
    FULL JOIN (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                WHERE conrelid = 'public.ofertare_parteneri_documente'::regclass AND contype = 'c') c ON c.conname = a.conname
   WHERE a.conname IS NULL OR c.conname IS NULL OR a.def IS DISTINCT FROM c.def;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270111a: CHECK-urile ofertare_parteneri_documente difera de 20260924: %', v_rau; END IF;
  -- triggerele de azi (doar cel de updated_at); altul = refuz (ordinea triggerelor BEFORE ar putea schimba ce vede garda)
  SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) INTO v_rau FROM pg_trigger
   WHERE tgrelid = 'public.ofertare_parteneri_documente'::regclass AND NOT tgisinternal;
  IF v_rau IS DISTINCT FROM 'trg_ofertare_parteneri_documente_touch' THEN
    RAISE EXCEPTION '20270111a: triggerele ofertare_parteneri_documente difera de 20260924: %', coalesce(v_rau, '(niciunul)');
  END IF;
  -- datele: orice cale existentă are forma ecranului de azi (parteneri/<partener_id>/<timp>_<nume>, nume din [A-Za-z0-9._-]), formă care trece
  --   garda de mai jos pentru orice categorie existentă (condiție SUFICIENTĂ, nu a doua definiție a regulii); nicio cale folosită de două ori
  SELECT count(*) FILTER (WHERE fisier_path IS NOT NULL),
         count(*) FILTER (WHERE fisier_path IS NOT NULL AND (categorie = 'autorizatie_ndt'
                            OR fisier_path !~ ('^parteneri/' || partener_id::text || '/[0-9]+_[A-Za-z0-9._-]+$')))
    INTO v_n, v_strain FROM public.ofertare_parteneri_documente;
  SELECT count(*) INTO v_dublu FROM (SELECT 1 FROM public.ofertare_parteneri_documente WHERE fisier_path IS NOT NULL
                                      GROUP BY fisier_path HAVING count(*) > 1) x;
  IF v_strain > 0 OR v_dublu > 0 THEN
    RAISE EXCEPTION '20270111a: date existente de lamurit inainte de garda: % cai in alta forma decat a ecranului, % cai folosite de mai multe randuri; nimic schimbat',
      v_strain, v_dublu;
  END IF;
  RAISE NOTICE '20270111a: documente cu fisier existente (forma ecranului, trec garda): %', v_n;
END $stare$;

-- ─── 2. Categoria nouă: CHECK-ul cu același nume ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ofertare_parteneri_documente DROP CONSTRAINT ofertare_parteneri_documente_categorie_check,
  ADD CONSTRAINT ofertare_parteneri_documente_categorie_check
  CHECK (categorie IN ('autorizatie_isc', 'iso', 'certificat_legal', 'atestat', 'etalonare', 'alta', 'autorizatie_ndt'));

-- ─── 3. Garda căii (L07, L13: regex ancorat, partener_id numeric) + unicitatea căii (L16) ──────────────────────────────────────────────
CREATE FUNCTION public.fn_ofertare_doc_cale_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
BEGIN
  IF NEW.fisier_path IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.fisier_path !~ ('[^' || chr(9) || '-' || chr(13) || chr(32) || ']') OR strpos(NEW.fisier_path, chr(92)) > 0 OR strpos(NEW.fisier_path, '%') > 0
     OR NEW.fisier_path ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')
     OR '.' = ANY (string_to_array(NEW.fisier_path, '/')) OR '..' = ANY (string_to_array(NEW.fisier_path, '/')) THEN
    RAISE EXCEPTION 'ofertare: calea fișierului e invalidă (goală, backslash, procent, caractere de control sau segment . / ..)'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.categorie = 'autorizatie_ndt' THEN
    IF NEW.fisier_path !~ ('^parteneri/' || NEW.partener_id::text || '/ndt/[^/]+$') THEN
      RAISE EXCEPTION 'ofertare: autorizația NDT trebuie să aibă fișierul în dosarul NDT al aceleiași firme (parteneri/<firmă>/ndt/<nume>)'
        USING ERRCODE = '23514';
    END IF;
  ELSIF strpos('/' || NEW.fisier_path, '/ndt/') > 0 THEN
    RAISE EXCEPTION 'ofertare: dosarul NDT e doar pentru autorizațiile de control nedistructiv'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_doc_cale_garda() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_ofertare_doc_cale_garda() IS 'Ofertare / CTC (trigger): calea fișierului unui document de partener — fără segmente . / .., backslash, %, control; autorizatie_ndt = parteneri/<partener_id>/ndt/<nume>; altă categorie = nu sub ndt/. 20270111a.';
CREATE TRIGGER trg_ofertare_doc_cale_garda BEFORE INSERT OR UPDATE OF fisier_path, partener_id, categorie ON public.ofertare_parteneri_documente
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_doc_cale_garda();
CREATE UNIQUE INDEX ofertare_parteneri_documente_fisier_path_uq ON public.ofertare_parteneri_documente (fisier_path) WHERE fisier_path IS NOT NULL;

-- ─── 4. Lista pentru CTC: DOAR autorizațiile NDT, DOAR câmpurile permise; starea după ziua din România (L17) ───────────────────────────
CREATE FUNCTION public.fn_ctc_autorizatii_ndt()
RETURNS TABLE (id bigint, firma text, cui text, numar_document text, emitent text, metoda text, data_emitere date, data_valabilitate date,
               fara_expirare boolean, stare text, are_fisier boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
BEGIN
  IF NOT public.fn_ctc_autorizatii_drept() THEN
    RAISE EXCEPTION 'ctc: autorizațiile pentru cartea tehnică cer acces la modulul CTC' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT d.id::bigint, p.nume::text, p.cui::text, d.numar_document::text, d.emitent::text, d.domeniu::text,
         d.data_emitere, d.data_valabilitate, (d.fara_expirare IS TRUE),
         (CASE WHEN d.fara_expirare IS TRUE THEN 'valabil'
               WHEN d.data_valabilitate IS NULL THEN 'necunoscut'
               WHEN d.data_valabilitate < v_azi THEN 'expirat'
               ELSE 'valabil' END)::text,
         (d.fisier_path IS NOT NULL AND d.fisier_path ~ ('[^' || chr(9) || '-' || chr(13) || chr(32) || ']'))
    FROM public.ofertare_parteneri_documente d
    JOIN public.ofertare_parteneri p ON p.id = d.partener_id
   WHERE d.categorie = 'autorizatie_ndt';
END $f$;
REVOKE ALL ON FUNCTION public.fn_ctc_autorizatii_ndt() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatii_ndt() TO authenticated;
COMMENT ON FUNCTION public.fn_ctc_autorizatii_ndt() IS 'CTC: autorizațiile firmelor de control nedistructiv (ofertare_parteneri_documente, categoria autorizatie_ndt), doar câmpurile profesionale, pentru cartea tehnică; stare = valabil / expirat / necunoscut. Cont fără CTC = 42501. 20270111a.';

-- ─── 5. Calea scanului NDT: doar rândul NDT cu calea care trece din nou regula NDT; NULL altfel (fără oracol); fără CTC = 42501 ────────
CREATE FUNCTION public.fn_ctc_autorizatie_ndt_fisier(p_document_id bigint) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_cale text;
BEGIN
  IF NOT public.fn_ctc_autorizatii_drept() THEN
    RAISE EXCEPTION 'ctc: autorizațiile pentru cartea tehnică cer acces la modulul CTC' USING ERRCODE = '42501';
  END IF;
  SELECT d.fisier_path INTO v_cale
    FROM public.ofertare_parteneri_documente d
   WHERE d.id = p_document_id AND d.categorie = 'autorizatie_ndt'
     AND d.fisier_path ~ ('^parteneri/' || d.partener_id::text || '/ndt/[^/]+$')
     AND strpos(d.fisier_path, chr(92)) = 0 AND strpos(d.fisier_path, '%') = 0 AND d.fisier_path !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')
     AND NOT ('.' = ANY (string_to_array(d.fisier_path, '/')) OR '..' = ANY (string_to_array(d.fisier_path, '/')));
  RETURN v_cale;
END $f$;
REVOKE ALL ON FUNCTION public.fn_ctc_autorizatie_ndt_fisier(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ctc_autorizatie_ndt_fisier(bigint) TO authenticated;
COMMENT ON FUNCTION public.fn_ctc_autorizatie_ndt_fisier(bigint) IS 'CTC: calea scanului unei autorizații NDT (parteneri/<firmă>/ndt/<nume>, reverificată), pentru apelantul cu CTC; o semnează edge fn ctc-autorizatie-fisier (bucket ofertare, 60 s). Altfel NULL; fără CTC = 42501. 20270111a.';

-- ─── 6. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE r record; v_rau text; v_alt text;
BEGIN
  -- CHECK-urile tabelului, exact (doar categoria nouă în plus), validate
  SELECT string_agg(coalesce(a.conname, '+' || c.conname), ', ' ORDER BY coalesce(a.conname, c.conname)) INTO v_rau
    FROM (VALUES
      -- >>> CHECK-URI 20270111a
      ('ofertare_parteneri_documente_categorie_check', 'CHECK ((categorie = ANY (ARRAY[''autorizatie_isc''::text, ''iso''::text, ''certificat_legal''::text, ''atestat''::text, ''etalonare''::text, ''alta''::text, ''autorizatie_ndt''::text])))')
      -- <<< CHECK-URI 20270111a
    ) a(conname, def)
    FULL JOIN (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                WHERE conrelid = 'public.ofertare_parteneri_documente'::regclass AND contype = 'c' AND convalidated) c ON c.conname = a.conname
   WHERE a.conname IS NULL OR c.conname IS NULL OR a.def IS DISTINCT FROM c.def;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270111a: postconditie: CHECK-urile ofertare_parteneri_documente: %', v_rau; END IF;
  -- trigger-ul EXACT: funcția, BEFORE ROW INSERT + UPDATE (tgtype 23), coloanele UPDATE OF, activ, fără WHEN, fără argumente
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.ofertare_parteneri_documente'::regclass AND tg.tgname = 'trg_ofertare_doc_cale_garda'
                   AND NOT tg.tgisinternal AND tg.tgfoid = to_regprocedure('public.fn_ofertare_doc_cale_garda()') AND tg.tgtype = 23
                   AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0
                   AND (SELECT string_agg(a.attname::text, ',' ORDER BY a.attname::text) FROM unnest(tg.tgattr::int2[]) k(n)
                          JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = k.n) = 'categorie,fisier_path,partener_id')
     OR (SELECT string_agg(tgname::text, ', ' ORDER BY tgname::text) FROM pg_trigger
          WHERE tgrelid = 'public.ofertare_parteneri_documente'::regclass AND NOT tgisinternal)
        IS DISTINCT FROM 'trg_ofertare_doc_cale_garda, trg_ofertare_parteneri_documente_touch' THEN
    RAISE EXCEPTION '20270111a: postconditie: trigger-ul de cale (functie / moment / evenimente / coloane / stare / lista triggerelor)';
  END IF;
  -- indexul unic parțial EXACT
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.ofertare_parteneri_documente_fisier_path_uq')
                   AND i.indrelid = 'public.ofertare_parteneri_documente'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
                   AND pg_get_indexdef(i.indexrelid) = 'CREATE UNIQUE INDEX ofertare_parteneri_documente_fisier_path_uq ON public.ofertare_parteneri_documente USING btree (fisier_path) WHERE (fisier_path IS NOT NULL)') THEN
    RAISE EXCEPTION '20270111a: postconditie: indexul unic pe fisier_path';
  END IF;
  -- funcțiile noi: limbaj / definer / volatil / strict / leakproof / search_path / proprietar / drepturi EXACTE (forma amprentei, rol:drept)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_ofertare_doc_cale_garda()', 'plpgsql', false, 'v', false, 'postgres:EXECUTE'),
      ('public.fn_ctc_autorizatii_ndt()', 'plpgsql', true, 's', true, 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_ctc_autorizatie_ndt_fisier(bigint)', 'plpgsql', true, 's', true, 'authenticated:EXECUTE, postgres:EXECUTE')
    ) v(fn, limbaj, definer, volatil, exec_auth, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.provolatile = r.volatil
                      AND p.prokind = 'f' AND NOT p.proisstrict AND NOT p.proleakproof
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = r.exec_auth
                      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
                      AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                               FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = r.acl) THEN
      RAISE EXCEPTION '20270111a: postconditie: functia % (limbaj / definer / volatil / strict / leakproof / search_path / owner / drepturi exacte)', r.fn;
    END IF;
  END LOOP;
  -- funcțiile noi cheamă (în afara pg_catalog) DOAR predicatul CTC din 20261222b; nimic dinamic
  SELECT string_agg(DISTINCT p2.oid::regprocedure::text, ', ') INTO v_alt
    FROM pg_proc p CROSS JOIN LATERAL regexp_matches(p.prosrc, '([[:alpha:]_][[:alnum:]_$]*)"?[[:space:]]*[(]', 'g') w
    JOIN pg_proc p2 ON lower(p2.proname) = lower(w[1]) AND p2.oid <> p.oid
   WHERE p.oid IN (to_regprocedure('public.fn_ofertare_doc_cale_garda()'), to_regprocedure('public.fn_ctc_autorizatii_ndt()'),
                   to_regprocedure('public.fn_ctc_autorizatie_ndt_fisier(bigint)'))
     AND p2.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p2.oid IS DISTINCT FROM to_regprocedure('public.fn_ctc_autorizatii_drept()');
  IF v_alt IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.fn_ofertare_doc_cale_garda()'), to_regprocedure('public.fn_ctc_autorizatii_ndt()'),
                  to_regprocedure('public.fn_ctc_autorizatie_ndt_fisier(bigint)')) AND regexp_replace(p.prosrc, '''execute''', '', 'gi') ~* '[[:<:]]execute[[:>:]]') THEN
    RAISE EXCEPTION '20270111a: postconditie: functiile noi cheama in afara predicatului CTC: %', coalesce(v_alt, 'cod dinamic');
  END IF;
  -- predicatul CTC, încă neschimbat
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_ctc_autorizatii_drept()')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'fde56a1c781ebe02a9deb4b0f1ad57e6'
                   AND coalesce(p.proacl, acldefault('f', p.proowner))::text = '{postgres=X/postgres}') THEN
    RAISE EXCEPTION '20270111a: postconditie: fn_ctc_autorizatii_drept schimbata';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270111a_ctc_autorizatii_ndt:' || txid_current() THEN
    RAISE EXCEPTION '20270111a: garda final invalida';
  END IF;
  RAISE NOTICE '20270111a: sfarsit la % ms de la BEGIN, lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
