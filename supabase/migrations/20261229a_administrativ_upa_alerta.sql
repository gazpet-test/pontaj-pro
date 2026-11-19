-- Version 20261229120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261229a_administrativ_upa_alerta.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ v2 a runnerului; manifestul .l15.tsv îl generează coordonatorul pe clonă,
--   lista OBIECTELOR (familie, etichetă, operație — verificată pe PGlite cu pașii reali ai runnerului) e în
--   supabase/tests/20261229a_administrativ_upa_alerta.l15.obiecte.tsv. Pe lângă ea, migrarea verifică înainte forma EXACTĂ a ce schimbă
--   (politica upa_achizitii_all, coloanele citite, setarea plafonului) și, după, drepturile / politicile / proprietățile exacte ale obiectelor noi.
-- 20261229a_administrativ_upa_alerta — Administrativ → Unități protejate (UPA): fondul de handicap necheltuit (deciziile owner-ului, 19.11.2026).
--   Plafonul lunar rămâne o valoare SETATĂ de firmă (nu se calculează aici obligația), dar devine VERSIONAT pe lună: istoricul și alerta
--   folosesc plafonul valabil în luna respectivă, nu pe cel de azi.
--
-- Ce face (obiecte noi + politicile pe upa_achizitii; nicio dată existentă modificată):
--   * upa_plafon_lunar (luna, plafon, setat_de, setat_la, sursa): plafonul valabil DE LA luna rândului până la următorul rând (fn_upa_plafon_la).
--     La aplicare primește UN rând: luna curentă (ora României) = valoarea din logistica_setari.upa_plafon_lunar (sursa 'migrare').
--     Se scrie DOAR prin fn_upa_plafon_seteaza (luna curentă, deci și lunile viitoare; trecutul nu se rescrie), cu CAS pe valoarea afișată.
--   * upa_luna_inchisa (luna, plafon, consumat, ramas_necheltuit, nr_achizitii, inchis_la): scrisă O DATĂ, la prima rulare a alertei din luna
--     următoare (INSERT .. ON CONFLICT DO NOTHING); nemodificabilă (trigger BEFORE UPDATE / DELETE, pe orice cale).
--   * upa_alerta_jurnal: o rezervare pe cheie (UNIQUE): 'zilnic:<zi>' (cel mult o alertă pe zi), 'inchidere:<luna>' (o dată pe lună),
--     'eroare:<zi>:<cod>' (eroare de business, o dată pe zi și cod). rezervat -> trimis / eroare (4xx) / necunoscut (timeout, 5xx, rețea,
--     rezervare rămasă > 1 h: fără retrimitere automată, L05); fara_mail = lista de destinatari goală sau invalidă (notificările pleacă oricum).
--   * fn_upa_poate_scrie(): predicatul UNIC (L19) de scriere: owner sau administrativ / administrativ.upa la nivel admin / editor (aceeași regulă ca
--     politica cheii upa_plafon_lunar din 20261015b). Îl folosesc politicile upa_achizitii, fn_upa_plafon_seteaza și ecranul (ascunde butoanele).
--   * fn_upa_luni(p_azi, p_luni): situația pe luni (plafonul lunii, cheltuit acum, închiderea, zilele rămase, pragul și in_alerta pentru luna
--     curentă) = SINGURA definiție a „sub plafon după ziua upa_alerta_zi”, folosită de ecran (banner, istoric) și de rezervarea alertei.
--   * fn_upa_alerta_rezerva() (service_role, edge upa-plafon-alerta): închide luna anterioară dacă nu e închisă, apoi rezervă alerta zilei
--     (de la ziua upa_alerta_zi până la sfârșitul lunii, cât cheltuit < plafon) și pune notificările în aplicație (owner + administrativ /
--     administrativ.upa); întoarce edge-ului rândurile de trimis + destinatarii validați. fn_upa_alerta_proba() (service_role) = ce s-ar face
--     azi, fără nicio scriere (?dry=1, owner). fn_upa_alerta_marcheaza() (service_role) = rezultatul trimiterii (CAS din 'rezervat').
--   * upa_achizitii: politica veche upa_achizitii_all (ALL, orice cont logat) se înlocuiește: citire ca azi (orice cont logat), adăugare /
--     modificare / ștergere doar cu fn_upa_poate_scrie(). Forma veche a politicii (rolurile ȘI clauza WITH CHECK, cele două forme acceptate)
--     se păstrează în comentariul politicii de citire (roluri_vechi=... check_vechi=...), ca revenirea să o refacă identic în catalog.
--   * upa_achizitii.cheie_intentie (uuid, UNIQUE, NULL permis) + hash_intentie (text): cheia de intenție a salvării din formular și amprenta
--     DURABILĂ a valorilor ei (L04 / L16; runda 3): hash_intentie = md5 pe TOATE câmpurile semantice (fn_upa_campuri_intentie, definiția
--     unică), pus de server (trigger BEFORE INSERT, L08), nemodificabil împreună cu cheia (BEFORE UPDATE); NULL <=> cheie NULL (CHECK).
--     Citește Orice și rândurile vechi rămân cu NULL.
--   * fn_upa_achizitie_adauga(p_cheie, p_rand) (SECURITY INVOKER: politicile tabelului se aplică apelantului): salvarea idempotentă din
--     formular. ÎNTÂI caută cheia (orice cont logat citește): există cu aceeași amprentă -> 'existent' (reluarea unei salvări intrate NU
--     depinde de dreptul de acum: un drept retras între timp nu mai poate face o reluare să pară „refuzată”, runda 3 P1); există cu altă
--     amprentă -> UPA02 (aceeași cheie + alt payload = eroare); altfel INSERT .. ON CONFLICT (cheie_intentie) DO NOTHING RETURNING + recitire.
--   * fn_upa_erori_config(zi_prag, plafon): codurile de business ale configurării (setare_zi_invalida / fara_plafon), întoarse de rezervare și
--     de probă la FIECARE rulare (erori_config), nu doar scrise în jurnal la prima rulare din zi (L18).
--   * Destinatarii mailului (runda 3, decizia owner-ului 19.11.2026): DOAR adrese interne (@gazpet.ro). fn_upa_destinatari întoarce adresele
--     interne (fără dubluri, cel mult 10, altfel NULL) și pe cele IGNORATE (alt domeniu / formă invalidă): ignoratele nu primesc nimic, numărul
--     lor intră în jurnal (nr_dest_ignorati) și în răspuns; adresele lor apar doar în proba owner-ului (?dry=1). Fără adrese în repo.
--   * Lunile vechi (decizia owner-ului 19.11.2026): alerta privește DOAR luna curentă și luna tocmai încheiată (luna anterioară zilei de
--     rulare); nicio recuperare / alertă retroactivă pentru lunile dinainte de aplicare (n-au plafon înregistrat) sau pentru o lună sărită.
-- AMPRENTA (L14 / L15): postcondițiile calculează amprenta COMPLETĂ a obiectelor migrării (definiții, proprietari, ACL pe tabele ȘI pe
--   coloane, RLS, coloane, constrângeri, indecși, triggere, secvență, politicile pe upa_achizitii și pe tabelele noi, sursa funcțiilor, plus
--   TOATE obiectele care depind de coloanele noi din upa_achizitii, oricum s-ar numi — pg_depend) și o compară cu constanta revizuită;
--   revenirea recalculează aceeași amprentă (bloc de text identic, verificat de proba PGlite) și refuză la orice abatere.
-- Ce NU face: nu atinge logistica_setari (upa_plafon_lunar rămâne acolo ca valoare veche, necitită de codul nou; upa_alerta_activa /
--   upa_alerta_emails / upa_alerta_zi se citesc ca azi), nu schimbă cronul (jobid 29), nu trimite nimic, nu schimbă drepturi pe module.
-- ORDINEA LIVRĂRII (docs/administrativ/UPA_FOND_HANDICAP.md): migrarea -> merge-ul ecranului (salvează prin fn_upa_achizitie_adauga) ->
--   20261229b (numărul facturii) / 20261229c (bucketul, după verificarea de pe live) -> funcția edge upa-plafon-alerta (verify_jwt neschimbat,
--   poarta cronSauOwner) -> destinatarii în setări -> cronul zilnic propus (0 6 * * *, de coordonator). Între migrare și merge, ecranul vechi:
--   butonul de plafon scrie în logistica_setari (valoare care NU mai e citită: se reface din ecranul nou), adăugarea / ștergerea respectă deja
--   politicile noi (inserarea directă, fără cheie, rămâne permisă cu dreptul de scriere).
-- Ordinea lock-urilor (L06), aceeași pe toate căile: lock consultativ hashtext('upa_alerta_jurnal') -> upa_luna_inchisa (INSERT) ->
--   upa_alerta_jurnal (UPDATE / INSERT) -> notifications (INSERT). fn_upa_plafon_seteaza: lock consultativ hashtext('upa_plafon_lunar') -> rândul
--   lunii (INSERT .. ON CONFLICT). fn_upa_achizitie_adauga: doar rândul nou din upa_achizitii (o inserare concurentă cu aceeași cheie așteaptă
--   doar pe indexul UNIQUE al cheii, apoi ON CONFLICT DO NOTHING + recitire); nicio altă cale nu blochează upa_achizitii (suma se citește în
--   READ COMMITTED: o factură adăugată după închidere apare în ecran ca diferență față de instantaneul închis, nu se pierde).
-- Lock-uri la aplicare (punct unic, NOWAIT, bugetul 1 s de la prima încercare, docs/LIVRARE_L15_V2.md §9): upa_achizitii ACCESS EXCLUSIVE
--   (DROP / CREATE / COMMENT POLICY, ADD COLUMN cheie_intentie + UNIQUE: indexul se construiește pe tabelul mic, coloana nouă e NULL, fără
--   rescriere). Lock-urile implicite de după set: citiri (ACCESS SHARE) pe logistica_setari, notifications, profiles, user_module_access,
--   logistica_furnizori în postcondiții și la seed; nicio cheie străină spre tabele existente. Proba notificărilor din $pre$ (înaintea punctului
--   unic) ia ROW EXCLUSIVE pe notifications doar în subtranzacția anulată (eliberat la anulare).
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, garda finală.
-- Revenire: supabase/revenire/20261229a_administrativ_upa_alerta_ROLLBACK.sql. Probe: scripts/pglite/test_upa_alerta_local.mjs.
DO $pre$
DECLARE r record; v_tip text; v_plafon text; v_val text; v_n integer; v_pol record; v_owner uuid; v_proba text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229a_administrativ_upa_alerta:' || txid_current() THEN
    RAISE EXCEPTION '20261229a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261229a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261229a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261229a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261229a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261225a / 20261226b)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261229a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.upa_plafon_lunar') IS NOT NULL OR to_regclass('public.upa_luna_inchisa') IS NOT NULL
     OR to_regclass('public.upa_alerta_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['fn_upa_poate_scrie', 'fn_upa_plafon_la',
                  'fn_upa_luni', 'fn_upa_destinatari', 'fn_upa_lei', 'fn_upa_luna_text', 'fn_upa_zile_text', 'fn_upa_erori_config', 'fn_upa_plafon_seteaza',
                  'fn_upa_alerta_inscrie', 'fn_upa_alerta_rezerva_la', 'fn_upa_alerta_rezerva', 'fn_upa_alerta_proba', 'fn_upa_alerta_marcheaza',
                  'fn_upa_luna_inchisa_nemodificabil', 'fn_upa_campuri_intentie', 'fn_upa_hash_intentie', 'fn_upa_achizitii_intentie',
                  'fn_upa_achizitie_adauga']))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.upa_achizitii'::regclass AND a.attname IN ('cheie_intentie', 'hash_intentie') AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace
                  AND c.conname IN ('upa_achizitii_cheie_intentie_uidx', 'upa_achizitii_hash_intentie_cu_cheie'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.upa_achizitii'::regclass AND t.tgname = 'trg_upa_achizitii_intentie')
     OR to_regclass('public.upa_achizitii_cheie_intentie_uidx') IS NOT NULL THEN
    RAISE EXCEPTION '20261229a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / scrise, cu tipurile acceptate (tabelele UPA / Logistică sunt create direct în producție: se verifică, nu se presupun);
  --   runda 3: și toate coloanele pe care le scrie fn_upa_achizitie_adauga (câmpurile intenției + created_by)
  FOR r IN SELECT * FROM (VALUES
      ('upa_achizitii', 'id', 'bigint|integer'), ('upa_achizitii', 'luna', 'date'),
      ('upa_achizitii', 'valoare', 'numeric|double precision|real|integer|bigint'),
      ('upa_achizitii', 'furnizor_id', 'bigint|integer'), ('upa_achizitii', 'furnizor_nume', 'text|character varying'),
      ('upa_achizitii', 'numar_factura', 'text|character varying'), ('upa_achizitii', 'data_factura', 'date'),
      ('upa_achizitii', 'descriere', 'text|character varying'), ('upa_achizitii', 'document_path', 'text|character varying'),
      ('upa_achizitii', 'created_by', 'uuid'),
      ('logistica_setari', 'key', 'text|character varying'), ('logistica_setari', 'value', 'text|character varying'),
      ('logistica_furnizori', 'nume', 'text|character varying'), ('logistica_furnizori', 'este_upa', 'boolean'),
      ('logistica_furnizori', 'activ', 'boolean'), ('logistica_furnizori', 'upa_valabil_pana', 'date'),
      ('notifications', 'profile_id', 'uuid'), ('notifications', 'type', 'text|character varying'), ('notifications', 'modul', 'text|character varying'),
      ('notifications', 'title', 'text|character varying'), ('notifications', 'message', 'text|character varying'),
      ('notifications', 'link_to', 'text|character varying'),
      ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'),
      ('user_module_access', 'profile_id', 'uuid'), ('user_module_access', 'module', 'text|character varying'),
      ('user_module_access', 'access_level', 'text|character varying')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261229a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION '20261229a: auth.uid() lipseste'; END IF;
  -- notificările (L15, runda 2): nu se caută literali în textul regulilor (o regulă cu 'warning' și 'error' care exclude totuși 'error' ar
  --   trece), ci se face EXACT inserarea alertei — ambele tipuri (warning / error), modulul Administrativ, linkul, lungimile maxime puse de
  --   fn_upa_alerta_inscrie (200 / 1000), către un owner real — într-o subtranzacție anulată imediat: trec TOATE regulile tabelului (CHECK,
  --   NOT NULL, cheia străină, triggerele) sau migrarea refuză. Rândurile și lock-urile subtranzacției dispar la anulare (doar secvența avansează).
  SELECT p.id INTO v_owner FROM public.profiles p WHERE p.is_owner IS TRUE ORDER BY p.id LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION '20261229a: niciun owner in profiles (notificarile alertei nu ar avea destinatar); nimic schimbat'; END IF;
  BEGIN
    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    VALUES (v_owner, 'warning', 'Administrativ', repeat('x', 200), repeat('x', 1000), '/administrativ?tab=upa'),
           (v_owner, 'error', 'Administrativ', repeat('x', 200), repeat('x', 1000), '/administrativ?tab=upa');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'proba_notificari:%', v_n USING ERRCODE = 'UPA01';
  EXCEPTION
    WHEN SQLSTATE 'UPA01' THEN v_proba := SQLERRM;
    WHEN OTHERS THEN
      RAISE EXCEPTION '20261229a: notificarile alertei nu trec regulile tabelului notifications (%: %); nimic schimbat', SQLSTATE, SQLERRM;
  END;
  IF v_proba IS DISTINCT FROM 'proba_notificari:2' THEN
    RAISE EXCEPTION '20261229a: notificarile alertei nu se inscriu intregi in notifications (%); nimic schimbat', coalesce(v_proba, 'fara rezultat');
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.profile_id = v_owner AND n.title = repeat('x', 200)) THEN
    RAISE EXCEPTION '20261229a: proba notificarilor a ramas scrisa; nimic schimbat';
  END IF;
  -- upa_achizitii: RLS pornit și EXACT politica veche (ALL, orice cont logat), singura
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.upa_achizitii'::regclass) THEN
    RAISE EXCEPTION '20261229a: upa_achizitii nu are RLS pornit';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass;
  SELECT p.polname, p.polcmd, p.polpermissive, p.polroles, pg_get_expr(p.polqual, p.polrelid) AS qual, pg_get_expr(p.polwithcheck, p.polrelid) AS chk
    INTO v_pol FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass AND p.polname = 'upa_achizitii_all';
  IF v_n <> 1 OR v_pol.polname IS NULL OR v_pol.polcmd::text <> '*' OR NOT v_pol.polpermissive
     OR NOT (v_pol.polroles = ARRAY[0]::oid[] OR v_pol.polroles = ARRAY['authenticated'::regrole::oid])
     OR v_pol.qual IS DISTINCT FROM '(auth.uid() IS NOT NULL)'
     OR (v_pol.chk IS NOT NULL AND v_pol.chk IS DISTINCT FROM '(auth.uid() IS NOT NULL)') THEN
    RAISE EXCEPTION '20261229a: politicile upa_achizitii nu sunt exact upa_achizitii_all (ALL, auth.uid() IS NOT NULL): % politici', v_n;
  END IF;
  -- plafonul de azi (devine rândul lunii curente): exact o valoare, număr pozitiv cu cel mult 2 zecimale
  SELECT count(*), min(s.value) INTO v_n, v_val FROM public.logistica_setari s WHERE s.key = 'upa_plafon_lunar';
  IF v_n <> 1 OR v_val IS NULL OR btrim(v_val) !~ '^[0-9]{1,7}([.][0-9]{1,2})?$' OR btrim(v_val)::numeric <= 0 THEN
    RAISE EXCEPTION '20261229a: logistica_setari.upa_plafon_lunar lipseste, e dublat sau nu e un numar pozitiv (% randuri)', v_n;
  END IF;
END $pre$;

-- ── lock-ul pe upa_achizitii (punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare; momentul în gazpet.lock_puternic_la pentru LOCK_TINUT) ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261229a: BUGET_LOCK: upa_achizitii ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
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
    RAISE EXCEPTION '20261229a: BUGET_LOCK: lock-ul pe upa_achizitii obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261229a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Tabelele ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.upa_plafon_lunar (
  luna date PRIMARY KEY,
  plafon numeric(12,2) NOT NULL,
  setat_de uuid,
  setat_la timestamptz NOT NULL DEFAULT now(),
  sursa text NOT NULL,
  CONSTRAINT upa_plafon_lunar_prima_zi CHECK (extract(day FROM luna) = 1),
  CONSTRAINT upa_plafon_lunar_valoare CHECK (plafon > 0 AND plafon < 10000000),
  CONSTRAINT upa_plafon_lunar_sursa CHECK (sursa = ANY (ARRAY['ecran'::text, 'migrare'::text])),
  CONSTRAINT upa_plafon_lunar_autor CHECK ((sursa = 'ecran') = (setat_de IS NOT NULL))
);
COMMENT ON TABLE public.upa_plafon_lunar IS 'UPA (20261229a): plafonul lunar deductibil, VERSIONAT: valabil de la luna randului pana la urmatorul rand (fn_upa_plafon_la). Scris doar prin fn_upa_plafon_seteaza (luna curenta).';

CREATE TABLE public.upa_luna_inchisa (
  luna date PRIMARY KEY,
  plafon numeric(12,2) NOT NULL,
  consumat numeric NOT NULL,
  ramas_necheltuit numeric NOT NULL,
  nr_achizitii integer NOT NULL,
  inchis_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upa_luna_inchisa_prima_zi CHECK (extract(day FROM luna) = 1),
  CONSTRAINT upa_luna_inchisa_valori CHECK (plafon > 0 AND consumat >= 0 AND nr_achizitii >= 0),
  CONSTRAINT upa_luna_inchisa_ramas CHECK (ramas_necheltuit = greatest(plafon - consumat, 0))
);
COMMENT ON TABLE public.upa_luna_inchisa IS 'UPA (20261229a): instantaneul unei luni incheiate (plafonul lunii, cheltuit, necheltuit = de platit la bugetul de stat), scris O DATA de fn_upa_alerta_rezerva; nemodificabil.';

CREATE TABLE public.upa_alerta_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cheie text NOT NULL,
  fel text NOT NULL,
  zi date NOT NULL,
  luna date NOT NULL,
  plafon numeric(12,2),
  consumat numeric,
  ramas numeric,
  zile_ramase integer,
  nr_destinatari integer NOT NULL DEFAULT 0,
  nr_notificari integer NOT NULL DEFAULT 0,
  nr_dest_ignorati integer NOT NULL DEFAULT 0,
  stare text NOT NULL,
  eroare text,
  resend_id text,
  creat_la timestamptz NOT NULL DEFAULT now(),
  actualizat_la timestamptz,
  CONSTRAINT upa_alerta_jurnal_cheie_uidx UNIQUE (cheie),
  CONSTRAINT upa_alerta_jurnal_fel CHECK (fel = ANY (ARRAY['zilnic'::text, 'inchidere'::text, 'eroare'::text])),
  CONSTRAINT upa_alerta_jurnal_forma_cheie CHECK (
    (fel = 'zilnic' AND cheie = 'zilnic:' || to_char(zi, 'YYYY-MM-DD') AND luna = date_trunc('month', zi::timestamp)::date)
    OR (fel = 'inchidere' AND cheie = 'inchidere:' || to_char(luna, 'YYYY-MM') AND luna < date_trunc('month', zi::timestamp)::date)
    OR (fel = 'eroare' AND cheie ~ ('^eroare:' || to_char(zi, 'YYYY-MM-DD') || ':[a-z_]{1,40}$'))),
  CONSTRAINT upa_alerta_jurnal_prima_zi CHECK (extract(day FROM luna) = 1),
  CONSTRAINT upa_alerta_jurnal_stare CHECK (stare = ANY (ARRAY['rezervat'::text, 'trimis'::text, 'necunoscut'::text, 'eroare'::text, 'fara_mail'::text])),
  CONSTRAINT upa_alerta_jurnal_cod_eroare CHECK (eroare IS NULL OR eroare ~ '^[a-z0-9_]{1,60}$'),
  CONSTRAINT upa_alerta_jurnal_resend CHECK (resend_id IS NULL OR resend_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  CONSTRAINT upa_alerta_jurnal_trimis CHECK ((stare = 'trimis') = (eroare IS NULL AND stare <> 'rezervat') OR stare = 'rezervat'),
  CONSTRAINT upa_alerta_jurnal_dest CHECK (nr_destinatari BETWEEN 0 AND 10 AND (stare <> 'rezervat' OR nr_destinatari > 0)),
  CONSTRAINT upa_alerta_jurnal_ignorati CHECK (nr_dest_ignorati >= 0)
);
CREATE INDEX upa_alerta_jurnal_creat_idx ON public.upa_alerta_jurnal (creat_la DESC);
COMMENT ON TABLE public.upa_alerta_jurnal IS 'UPA (20261229a): jurnalul alertei fondului de handicap (o rezervare pe cheie: zilnic:<zi> / inchidere:<luna> / eroare:<zi>:<cod>). rezervat -> trimis / eroare / necunoscut (fara retrimitere automata); fara_mail = fara destinatari interni; nr_dest_ignorati = adresele din setari ignorate (alt domeniu / invalide, nu primesc nimic). Scris doar prin RPC-uri.';

-- instantaneul unei luni închise nu se schimbă pe nicio cale (L07)
CREATE FUNCTION public.fn_upa_luna_inchisa_nemodificabil() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'upa: o luna inchisa nu se modifica si nu se sterge' USING ERRCODE = '42501';
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_luna_inchisa_nemodificabil() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_upa_luna_inchisa_nemodificabil BEFORE UPDATE OR DELETE ON public.upa_luna_inchisa
  FOR EACH ROW EXECUTE FUNCTION public.fn_upa_luna_inchisa_nemodificabil();

-- ─── 2. Predicatul de scriere (L19, L08: identitatea = auth.uid()) ───────────────────────────────────────────────────────
CREATE FUNCTION public.fn_upa_poate_scrie() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL
     AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
          OR EXISTS (SELECT 1 FROM public.user_module_access u
                      WHERE u.profile_id = auth.uid() AND u.module IN ('administrativ', 'administrativ.upa')
                        AND u.access_level IN ('admin', 'editor')))
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_poate_scrie() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_poate_scrie() TO authenticated;
COMMENT ON FUNCTION public.fn_upa_poate_scrie() IS 'UPA (20261229a): apelantul (auth.uid()) e owner sau are administrativ / administrativ.upa la nivel admin / editor. Predicatul unic: politicile upa_achizitii, fn_upa_plafon_seteaza, ecranul.';

-- ─── 3. Plafonul lunii, situația pe luni, textele ────────────────────────────────────────────────────────────────────────
-- plafonul valabil în luna dată = ultimul rând cu luna <= luna dată; NULL = neînregistrat (necunoscut, nu 0 — L18)
CREATE FUNCTION public.fn_upa_plafon_la(p_luna date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT p.plafon FROM public.upa_plafon_lunar p WHERE p.luna <= date_trunc('month', p_luna::timestamp)::date ORDER BY p.luna DESC LIMIT 1
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_plafon_la(date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_plafon_la(date) TO authenticated;

-- situația pe luni (ultimele p_luni, cu luna zilei p_azi; p_azi NULL = azi în România, L17). in_alerta (doar luna curentă):
--   ziua >= pragul (upa_alerta_zi, plafonat la ultima zi a lunii) ȘI cheltuit < plafonul lunii; NULL = necunoscut (prag invalid / fără plafon).
CREATE FUNCTION public.fn_upa_luni(p_azi date DEFAULT NULL, p_luni integer DEFAULT 12)
RETURNS TABLE (luna date, plafon numeric, consumat numeric, nr_achizitii integer, inchisa boolean, plafon_inchis numeric, consumat_inchis numeric,
               ramas_necheltuit numeric, inchis_la timestamptz, e_curenta boolean, zile_ramase integer, zi_prag integer, in_alerta boolean)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
-- toate coloanele din interogare sunt calificate (l. / pl. / a. / i. / x.): numele lor nu se confundă cu coloanele de ieșire
DECLARE v_azi date := coalesce(p_azi, (now() AT TIME ZONE 'Europe/Bucharest')::date); v_luna date; v_ultima date; v_txt text; v_prag integer;
BEGIN
  IF p_luni IS NULL OR p_luni < 1 OR p_luni > 36 THEN RAISE EXCEPTION 'upa: p_luni intre 1 si 36' USING ERRCODE = '22023'; END IF;
  v_luna := date_trunc('month', v_azi::timestamp)::date;
  v_ultima := (v_luna + interval '1 month' - interval '1 day')::date;
  SELECT s.value INTO v_txt FROM public.logistica_setari s WHERE s.key = 'upa_alerta_zi';
  IF btrim(v_txt) ~ '^[0-9]{1,2}$' AND btrim(v_txt)::integer BETWEEN 1 AND 31 THEN
    v_prag := least(btrim(v_txt)::integer, extract(day FROM v_ultima)::integer);
  END IF;
  RETURN QUERY
  SELECT l.luna, pl.plafon, coalesce(a.s, 0)::numeric, coalesce(a.n, 0)::integer, (i.luna IS NOT NULL), i.plafon::numeric, i.consumat,
         i.ramas_necheltuit, i.inchis_la, (l.luna = v_luna),
         CASE WHEN l.luna = v_luna THEN (v_ultima - v_azi + 1) END,
         CASE WHEN l.luna = v_luna THEN v_prag END,
         CASE WHEN l.luna <> v_luna OR v_prag IS NULL OR pl.plafon IS NULL THEN NULL
              ELSE extract(day FROM v_azi)::integer >= v_prag AND coalesce(a.s, 0) < pl.plafon END
    FROM (SELECT (v_luna - make_interval(months => g.g))::date AS luna FROM generate_series(0, p_luni - 1) AS g(g)) l
    CROSS JOIN LATERAL (SELECT public.fn_upa_plafon_la(l.luna)::numeric AS plafon) pl
    LEFT JOIN LATERAL (SELECT sum(x.valoare)::numeric AS s, count(*) AS n FROM public.upa_achizitii x
                        WHERE x.luna >= l.luna AND x.luna < (l.luna + interval '1 month')::date) a ON true
    LEFT JOIN public.upa_luna_inchisa i ON i.luna = l.luna
   ORDER BY l.luna DESC;
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_luni(date, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_luni(date, integer) TO authenticated;
COMMENT ON FUNCTION public.fn_upa_luni(date, integer) IS 'UPA (20261229a): situatia pe luni (plafonul lunii, cheltuit, inchiderea; pentru luna curenta zilele ramase, pragul si in_alerta). Definitia unica a alertei: ecran + fn_upa_alerta_rezerva.';

-- destinatarii mailului din upa_alerta_emails (runda 3, decizia owner-ului: DOAR adrese interne): lista separată prin virgulă, litere mici,
--   fără dubluri, ordinea păstrată. interni = adresele @gazpet.ro (forma ^[a-z0-9._%+-]{1,64}@gazpet[.]ro$, ancorată: nici subdomenii, nici
--   „@gazpet.ro.altceva”); peste 10 interne = NULL (lista refuzată întreagă, fail-closed). ignorate = tot restul (alt domeniu, formă invalidă,
--   cel mult 200 de caractere fiecare): NU primesc nimic; numărul lor se jurnalizează. '' / NULL = ambele goale. Definiția unică (L19) pentru
--   rezervare și probă; edge-ul reverifică domeniul înainte de trimitere (DOMENIU_INTERN, aceeași formă, paritate testată).
CREATE FUNCTION public.fn_upa_destinatari(p_text text, OUT interni text[], OUT ignorate text[])
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE v_e text;
BEGIN
  interni := '{}'; ignorate := '{}';
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN; END IF;
  FOREACH v_e IN ARRAY string_to_array(p_text, ',') LOOP
    v_e := lower(btrim(v_e));
    IF v_e = '' THEN CONTINUE; END IF;
    IF v_e ~ '^[a-z0-9._%+-]{1,64}@gazpet[.]ro$' THEN
      IF NOT (v_e = ANY (interni)) THEN interni := interni || v_e; END IF;
    ELSIF NOT (left(v_e, 200) = ANY (ignorate)) THEN
      ignorate := ignorate || left(v_e, 200);
    END IF;
  END LOOP;
  IF cardinality(interni) > 10 THEN interni := NULL; END IF;
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_destinatari(text) FROM PUBLIC, anon, authenticated, service_role;

-- ── Salvarea idempotentă a unei achiziții din formular (runda 3: L04 / L05 / L16, P1 + P2 din review) ──
-- câmpurile SEMANTICE ale intenției = singurele pe care le primește fn_upa_achizitie_adauga și singurele din amprentă (definiția unică, L19)
CREATE FUNCTION public.fn_upa_campuri_intentie() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT ARRAY['furnizor_id', 'furnizor_nume', 'numar_factura', 'data_factura', 'luna', 'valoare', 'descriere', 'document_path']::text[]
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_campuri_intentie() FROM PUBLIC, anon, authenticated, service_role;
-- funcții pure, fără date: EXECUTE pentru rolurile care scriu în upa_achizitii (triggerul și RPC-ul rulează ca apelantul)
GRANT EXECUTE ON FUNCTION public.fn_upa_campuri_intentie() TO authenticated, service_role;
-- amprenta intenției: md5 pe obiectul jsonb cu EXACT câmpurile de mai sus (lipsă = null), din rândul TIPIZAT (to_jsonb pe un rând
--   upa_achizitii: aceleași tipuri și aceeași formă canonică la trigger și la RPC)
CREATE FUNCTION public.fn_upa_hash_intentie(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT md5(jsonb_object_agg(k.k, p -> k.k)::text) FROM unnest(public.fn_upa_campuri_intentie()) AS k(k)
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_hash_intentie(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_hash_intentie(jsonb) TO authenticated, service_role;

-- sumele în lei, ca în ecran / mail (7.000,00); luna în română (noiembrie 2026); „N zile” cu acordul românesc (20 de zile)
CREATE FUNCTION public.fn_upa_lei(p numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT translate(to_char(round(p, 2), 'FM999,999,999,990.00'), ',.', '.,')
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_lei(numeric) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.fn_upa_luna_text(p date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT (ARRAY['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie',
                'decembrie'])[extract(month FROM p)::integer] || ' ' || extract(year FROM p)::integer::text
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_luna_text(date) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.fn_upa_zile_text(p integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p = 1 THEN 'mai este 1 zi' WHEN p % 100 = 0 OR p % 100 >= 20 THEN 'mai sunt ' || p || ' de zile' ELSE 'mai sunt ' || p || ' zile' END
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_zile_text(integer) FROM PUBLIC, anon, authenticated, service_role;

-- codurile de business ale configurării lunii curente (din rândul fn_upa_luni): ziua pragului invalidă, plafonul neînregistrat; '{}' = în regulă.
--   Definiția unică (L19) pentru rezervare (jurnal + răspuns) și probă.
CREATE FUNCTION public.fn_upa_erori_config(p_zi_prag integer, p_plafon numeric) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT array_remove(ARRAY[CASE WHEN p_zi_prag IS NULL THEN 'setare_zi_invalida' END, CASE WHEN p_plafon IS NULL THEN 'fara_plafon' END]::text[], NULL)
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_erori_config(integer, numeric) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 4. Schimbarea plafonului (ecranul): luna curentă, CAS pe valoarea afișată ────────────────────────────────────────────
-- p_vechi = plafonul pe care l-a văzut omul pentru luna curentă (NULL dacă nu era niciunul); altă valoare acum = 40001 (reîncarcă).
CREATE FUNCTION public.fn_upa_plafon_seteaza(p_plafon numeric, p_vechi numeric) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_luna date := date_trunc('month', now() AT TIME ZONE 'Europe/Bucharest')::date; v_acum numeric;
BEGIN
  IF NOT public.fn_upa_poate_scrie() THEN
    RAISE EXCEPTION 'upa: schimbarea plafonului cere Administrativ / Unitati protejate (admin sau editor)' USING ERRCODE = '42501';
  END IF;
  IF p_plafon IS NULL OR p_plafon <= 0 OR p_plafon >= 10000000 OR p_plafon <> round(p_plafon, 2) THEN
    RAISE EXCEPTION 'upa: plafonul trebuie sa fie un numar pozitiv, cu cel mult doua zecimale' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('upa_plafon_lunar'));
  v_acum := public.fn_upa_plafon_la(v_luna);
  IF v_acum IS DISTINCT FROM p_vechi THEN
    RAISE EXCEPTION 'upa: plafonul s-a schimbat intre timp (acum %); reincarca pagina', coalesce(public.fn_upa_lei(v_acum), 'neinregistrat') USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.upa_plafon_lunar AS p (luna, plafon, setat_de, setat_la, sursa)
  VALUES (v_luna, p_plafon, auth.uid(), now(), 'ecran')
  ON CONFLICT (luna) DO UPDATE SET plafon = EXCLUDED.plafon, setat_de = EXCLUDED.setat_de, setat_la = EXCLUDED.setat_la, sursa = 'ecran';
  RETURN jsonb_build_object('luna', v_luna, 'plafon', p_plafon);
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_plafon_seteaza(numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_plafon_seteaza(numeric, numeric) TO authenticated;
COMMENT ON FUNCTION public.fn_upa_plafon_seteaza(numeric, numeric) IS 'UPA (20261229a): plafonul de la luna curenta (Romania) incolo; trecutul nu se rescrie. Doar fn_upa_poate_scrie(); CAS pe valoarea vazuta (40001).';

-- ─── 5. Alerta: înscrierea unui rând + notificările (intern) ─────────────────────────────────────────────────────────────
-- Un rând nou în jurnal (ON CONFLICT DO NOTHING: aceeași cheie = nimic, nici notificări); notificările în aplicație pleacă în aceeași
--   instrucțiune, doar pentru rândul nou: owner-ii + cei cu administrativ / administrativ.upa (orice nivel); la 'eroare' doar owner-ii.
-- p_dest = adresele INTERNE (fn_upa_destinatari.interni; NULL = peste 10), p_ignorati = câte adrese din setări au fost ignorate (jurnalizat).
CREATE FUNCTION public.fn_upa_alerta_inscrie(p_fel text, p_zi date, p_luna date, p_plafon numeric, p_consumat numeric, p_ramas numeric,
                                             p_zile integer, p_dest text[], p_ignorati integer, p_cod text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_id bigint; v_cheie text; v_stare text; v_eroare text; v_nd integer := 0; v_tip text; v_titlu text; v_mesaj text; v_n integer;
        v_ign integer := greatest(coalesce(p_ignorati, 0), 0);
BEGIN
  v_cheie := CASE p_fel WHEN 'zilnic' THEN 'zilnic:' || to_char(p_zi, 'YYYY-MM-DD')
                        WHEN 'inchidere' THEN 'inchidere:' || to_char(p_luna, 'YYYY-MM')
                        ELSE 'eroare:' || to_char(p_zi, 'YYYY-MM-DD') || ':' || p_cod END;
  IF p_fel = 'eroare' THEN v_stare := 'eroare'; v_eroare := p_cod; v_ign := 0;
  ELSIF p_dest IS NULL THEN v_stare := 'fara_mail'; v_eroare := 'prea_multi_destinatari';
  ELSIF cardinality(p_dest) = 0 AND v_ign > 0 THEN v_stare := 'fara_mail'; v_eroare := 'doar_destinatari_externi';
  ELSIF cardinality(p_dest) = 0 THEN v_stare := 'fara_mail'; v_eroare := 'fara_destinatari';
  ELSE v_stare := 'rezervat'; v_nd := cardinality(p_dest);
  END IF;
  INSERT INTO public.upa_alerta_jurnal AS j (cheie, fel, zi, luna, plafon, consumat, ramas, zile_ramase, nr_destinatari, nr_dest_ignorati, stare, eroare)
  VALUES (v_cheie, p_fel, p_zi, p_luna, p_plafon, p_consumat, p_ramas, p_zile, v_nd, v_ign, v_stare, v_eroare)
  ON CONFLICT (cheie) DO NOTHING
  RETURNING j.id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF p_fel = 'zilnic' THEN
    v_tip := CASE WHEN p_zile <= 3 THEN 'error' ELSE 'warning' END;
    v_titlu := 'Fond handicap ' || public.fn_upa_luna_text(p_luna) || ': rămân ' || public.fn_upa_lei(p_ramas) || ' lei de cheltuit';
    v_mesaj := 'Cheltuit ' || public.fn_upa_lei(p_consumat) || ' din ' || public.fn_upa_lei(p_plafon) || ' lei la unități protejate; '
               || public.fn_upa_zile_text(p_zile) || ' din lună. Ce nu se cheltuie până la final se plătește la bugetul de stat.';
  ELSIF p_fel = 'inchidere' THEN
    v_tip := 'error';
    v_titlu := 'Fond handicap ' || public.fn_upa_luna_text(p_luna) || ': necheltuit ' || public.fn_upa_lei(p_ramas) || ' lei';
    v_mesaj := 'Luna s-a încheiat: plafon ' || public.fn_upa_lei(p_plafon) || ' lei, cheltuit ' || public.fn_upa_lei(p_consumat)
               || ' lei la unități protejate. Suma necheltuită se plătește la bugetul de stat.';
  ELSE
    v_tip := 'error';
    v_titlu := 'Alerta fondului de handicap nu a rulat (' || p_cod || ')';
    v_mesaj := CASE p_cod WHEN 'setare_zi_invalida' THEN 'Setarea upa_alerta_zi lipsește sau nu e o zi între 1 și 31.'
                          WHEN 'fara_plafon' THEN 'Plafonul lunii curente nu e înregistrat (Administrativ → Unități protejate → Plafon).'
                          ELSE 'Eroare de configurare.' END;
  END IF;
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  SELECT d.id, v_tip, 'Administrativ', left(v_titlu, 200), left(v_mesaj, 1000), '/administrativ?tab=upa'
    FROM (SELECT p.id FROM public.profiles p WHERE p.is_owner IS TRUE
          UNION
          SELECT u.profile_id FROM public.user_module_access u
           WHERE p_fel <> 'eroare' AND u.module IN ('administrativ', 'administrativ.upa')) d
   ORDER BY d.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.upa_alerta_jurnal j SET nr_notificari = v_n WHERE j.id = v_id;
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_alerta_inscrie(text, date, date, numeric, numeric, numeric, integer, text[], integer, text) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 6. Alerta: rezervarea zilei (intern, cu ziua dată; cronul trece prin fn_upa_alerta_rezerva = ziua din România) ───────
-- (1) reconcilierea rezervărilor rămase (> 1 h -> necunoscut, fără retrimitere); (2) închiderea lunii anterioare dacă nu e închisă (independent
--   de comutator; mailul / notificările de închidere doar cu alerta pornită și necheltuit > 0); (3) comutatorul oprit -> doar atât;
--   (4) erorile de configurare (în jurnal o dată pe zi și cod; în răspuns, erori_config, la FIECARE rulare); (5) alerta zilnică pe in_alerta din
--   fn_upa_luni, doar cu configurarea în regulă. Întoarce UN jsonb {activ, zi, erori_config, n, randuri} (randurile de trimis, cu destinatarii
--   validați) — nu un set, ca plafonul max-rows al PostgREST să nu-l poată tăia.
CREATE FUNCTION public.fn_upa_alerta_rezerva_la(p_azi date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_activ boolean; v_dest text[]; v_ign integer; v_c record; v_a record; v_l date; v_ids bigint[] := '{}'; v_id bigint; v_rez jsonb;
        v_inchis jsonb := NULL; v_furn jsonb; v_reconciliate integer; v_cfg text[]; v_cod text;
BEGIN
  IF p_azi IS NULL THEN RAISE EXCEPTION 'upa: ziua lipseste' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('upa_alerta_jurnal'));
  UPDATE public.upa_alerta_jurnal j SET stare = 'necunoscut', eroare = 'rezervare_veche', actualizat_la = now()
   WHERE j.stare = 'rezervat' AND j.creat_la < now() - interval '1 hour';
  GET DIAGNOSTICS v_reconciliate = ROW_COUNT;
  v_activ := (SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_activa') IS NOT DISTINCT FROM 'true';
  -- doar adresele interne primesc mail; cele ignorate se numără (jurnal + răspuns), fără adrese
  SELECT d.interni, cardinality(d.ignorate) INTO v_dest, v_ign
    FROM public.fn_upa_destinatari((SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_emails')) d;
  SELECT * INTO v_c FROM public.fn_upa_luni(p_azi, 2) f WHERE f.e_curenta;
  SELECT * INTO v_a FROM public.fn_upa_luni(p_azi, 2) f WHERE NOT f.e_curenta;
  v_cfg := public.fn_upa_erori_config(v_c.zi_prag, v_c.plafon);
  -- (2) închiderea lunii anterioare: o dată (ON CONFLICT DO NOTHING), cu valorile din fn_upa_luni
  IF NOT v_a.inchisa AND v_a.plafon IS NOT NULL THEN
    INSERT INTO public.upa_luna_inchisa AS i (luna, plafon, consumat, ramas_necheltuit, nr_achizitii)
    VALUES (v_a.luna, v_a.plafon, v_a.consumat, greatest(v_a.plafon - v_a.consumat, 0), v_a.nr_achizitii)
    ON CONFLICT (luna) DO NOTHING
    RETURNING i.luna INTO v_l;
    IF v_l IS NOT NULL THEN
      v_inchis := jsonb_build_object('luna', v_a.luna, 'plafon', v_a.plafon, 'consumat', v_a.consumat, 'ramas', greatest(v_a.plafon - v_a.consumat, 0));
      IF v_activ AND v_a.plafon > v_a.consumat THEN
        v_id := public.fn_upa_alerta_inscrie('inchidere', p_azi, v_a.luna, v_a.plafon, v_a.consumat, v_a.plafon - v_a.consumat, NULL, v_dest, v_ign, NULL);
        IF v_id IS NOT NULL THEN v_ids := v_ids || v_id; END IF;
      END IF;
    END IF;
  END IF;
  IF NOT v_activ THEN
    RETURN jsonb_build_object('activ', false, 'zi', p_azi, 'inchis', v_inchis, 'reconciliate', v_reconciliate, 'erori_config', to_jsonb(v_cfg),
                              'destinatari_ignorati', v_ign, 'n', 0, 'randuri', '[]'::jsonb);
  END IF;
  -- (4) erorile de configurare: în jurnal (+ notificarea owner-ului) o dată pe zi și cod; în răspuns la fiecare rulare (erori_config).
  --   O lună anterioară FĂRĂ plafon nu e o eroare: fn_upa_plafon_la caută înapoi fără limită, deci NULL înseamnă că luna e dinaintea primului
  --   plafon înregistrat (de ex. luna dinaintea aplicării) — nu se închide, iar ecranul o arată „plafon neînregistrat”.
  FOREACH v_cod IN ARRAY v_cfg LOOP
    PERFORM public.fn_upa_alerta_inscrie('eroare', p_azi, v_c.luna, NULL, v_c.consumat, NULL, NULL, NULL, NULL, v_cod);
  END LOOP;
  IF cardinality(v_cfg) = 0 AND v_c.in_alerta IS TRUE THEN
    -- (5) alerta zilei: cel mult una pe zi (cheia zilnic:<zi>)
    v_id := public.fn_upa_alerta_inscrie('zilnic', p_azi, v_c.luna, v_c.plafon, v_c.consumat, v_c.plafon - v_c.consumat, v_c.zile_ramase, v_dest, v_ign, NULL);
    IF v_id IS NOT NULL THEN v_ids := v_ids || v_id; END IF;
  END IF;
  -- furnizorii UPA activi cu autorizația valabilă (doar numele; pentru mail)
  SELECT coalesce(jsonb_agg(f.nume ORDER BY f.nume), '[]'::jsonb) INTO v_furn
    FROM (SELECT DISTINCT fz.nume::text AS nume FROM public.logistica_furnizori fz
           WHERE fz.este_upa IS TRUE AND fz.activ IS TRUE AND (fz.upa_valabil_pana IS NULL OR fz.upa_valabil_pana >= p_azi)
             AND fz.nume IS NOT NULL ORDER BY 1 LIMIT 15) f;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'cheie', j.cheie, 'fel', j.fel, 'luna', j.luna, 'plafon', j.plafon, 'consumat', j.consumat,
                                               'ramas', j.ramas, 'zile_ramase', j.zile_ramase, 'stare', j.stare, 'eroare', j.eroare,
                                               'dest_ignorati', j.nr_dest_ignorati,
                                               'destinatari', CASE WHEN j.stare = 'rezervat' THEN to_jsonb(v_dest) ELSE '[]'::jsonb END) ORDER BY j.id), '[]'::jsonb)
    INTO v_rez FROM public.upa_alerta_jurnal j WHERE j.id = ANY (v_ids);
  RETURN jsonb_build_object('activ', true, 'zi', p_azi, 'inchis', v_inchis, 'reconciliate', v_reconciliate, 'furnizori_upa', v_furn,
                            'erori_config', to_jsonb(v_cfg), 'destinatari_ignorati', v_ign, 'n', jsonb_array_length(v_rez), 'randuri', v_rez);
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_alerta_rezerva_la(date) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fn_upa_alerta_rezerva() RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT public.fn_upa_alerta_rezerva_la((now() AT TIME ZONE 'Europe/Bucharest')::date)
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_alerta_rezerva() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_alerta_rezerva() TO service_role;
COMMENT ON FUNCTION public.fn_upa_alerta_rezerva() IS 'UPA (20261229a): edge upa-plafon-alerta (service_role, dupa poarta cronSauOwner). Inchide luna anterioara, rezerva alerta zilei, pune notificarile; jsonb {activ, zi, n, randuri}.';

-- ce s-ar face azi, FĂRĂ nicio scriere (?dry=1 al owner-ului): aceleași predicate (fn_upa_luni + fn_upa_destinatari)
CREATE FUNCTION public.fn_upa_alerta_proba() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date; v_c record; v_a record; v_dest text[]; v_ignorate text[];
BEGIN
  SELECT * INTO v_c FROM public.fn_upa_luni(v_azi, 2) f WHERE f.e_curenta;
  SELECT * INTO v_a FROM public.fn_upa_luni(v_azi, 2) f WHERE NOT f.e_curenta;
  SELECT d.interni, d.ignorate INTO v_dest, v_ignorate
    FROM public.fn_upa_destinatari((SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_emails')) d;
  RETURN jsonb_build_object(
    'zi', v_azi,
    'activ', (SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_activa') IS NOT DISTINCT FROM 'true',
    'luna', v_c.luna, 'plafon', v_c.plafon, 'consumat', v_c.consumat, 'zile_ramase', v_c.zile_ramase, 'zi_prag', v_c.zi_prag, 'in_alerta', v_c.in_alerta,
    'erori_config', to_jsonb(public.fn_upa_erori_config(v_c.zi_prag, v_c.plafon)),
    'alerta_azi_deja', EXISTS (SELECT 1 FROM public.upa_alerta_jurnal j WHERE j.cheie = 'zilnic:' || to_char(v_azi, 'YYYY-MM-DD')),
    'luna_anterioara', v_a.luna, 'luna_anterioara_inchisa', v_a.inchisa, 'luna_anterioara_plafon', v_a.plafon, 'luna_anterioara_consumat', v_a.consumat,
    'destinatari_valizi', v_dest IS NOT NULL, 'destinatari', coalesce(to_jsonb(v_dest), '[]'::jsonb),
    -- doar în proba owner-ului: adresele ignorate (alt domeniu / invalide), ca să poată corecta setarea
    'destinatari_ignorate', to_jsonb(v_ignorate));
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_alerta_proba() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_alerta_proba() TO service_role;

-- rezultatul trimiterii (edge): doar din 'rezervat' (CAS); trimis = fără cod de eroare
CREATE FUNCTION public.fn_upa_alerta_marcheaza(p_id bigint, p_stare text, p_resend_id text, p_eroare text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_n integer;
BEGIN
  IF p_id IS NULL OR p_stare IS NULL OR p_stare NOT IN ('trimis', 'necunoscut', 'eroare') OR (p_stare = 'trimis') <> (p_eroare IS NULL) THEN
    RAISE EXCEPTION 'upa: argument_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.upa_alerta_jurnal j SET stare = p_stare, resend_id = p_resend_id, eroare = p_eroare, actualizat_la = now()
   WHERE j.id = p_id AND j.stare = 'rezervat';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_alerta_marcheaza(bigint, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_alerta_marcheaza(bigint, text, text, text) TO service_role;

-- ─── 7. Drepturi și RLS pe tabelele noi (fără scriere directă pentru nimeni: doar prin RPC-uri) ─────────────────────────────
ALTER TABLE public.upa_plafon_lunar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upa_luna_inchisa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upa_alerta_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upa_plafon_lunar, public.upa_luna_inchisa, public.upa_alerta_jurnal FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.upa_alerta_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.upa_plafon_lunar, public.upa_luna_inchisa, public.upa_alerta_jurnal TO authenticated;
CREATE POLICY upa_plafon_lunar_citire ON public.upa_plafon_lunar FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY upa_luna_inchisa_citire ON public.upa_luna_inchisa FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY upa_alerta_jurnal_citire_owner ON public.upa_alerta_jurnal FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE));

-- ─── 8. upa_achizitii: citire ca azi, scriere doar cu fn_upa_poate_scrie() ──────────────────────────────────────────────────
-- forma veche (verificată în $pre$: una din cele 2 x 2 forme acceptate) se păstrează întreagă în comentariu: rolurile (public / authenticated)
--   și clauza WITH CHECK (gol = fără clauză, uid = WITH CHECK (auth.uid() IS NOT NULL)); revenirea o reface identic în catalog.
DO $pol$
DECLARE v_roluri text; v_check text;
BEGIN
  SELECT CASE WHEN p.polroles = ARRAY[0]::oid[] THEN 'public' ELSE 'authenticated' END,
         CASE WHEN p.polwithcheck IS NULL THEN 'gol' ELSE 'uid' END INTO v_roluri, v_check
    FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass AND p.polname = 'upa_achizitii_all';
  DROP POLICY upa_achizitii_all ON public.upa_achizitii;
  CREATE POLICY upa_achizitii_citire ON public.upa_achizitii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
  CREATE POLICY upa_achizitii_adaugare ON public.upa_achizitii FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_upa_poate_scrie()));
  CREATE POLICY upa_achizitii_modificare ON public.upa_achizitii FOR UPDATE TO authenticated
    USING ((SELECT public.fn_upa_poate_scrie())) WITH CHECK ((SELECT public.fn_upa_poate_scrie()));
  CREATE POLICY upa_achizitii_stergere ON public.upa_achizitii FOR DELETE TO authenticated USING ((SELECT public.fn_upa_poate_scrie()));
  EXECUTE format('COMMENT ON POLICY upa_achizitii_citire ON public.upa_achizitii IS %L',
                 'UPA (20261229a): citire pentru orice cont logat (ca inainte). roluri_vechi=' || v_roluri || ' check_vechi=' || v_check);
END $pol$;
-- cheia de intenție a salvării din formular (L04 / L16): UNIQUE, NULL permis (Citește Orice, rândurile vechi); drepturile = cele ale tabelului
ALTER TABLE public.upa_achizitii ADD COLUMN cheie_intentie uuid;
ALTER TABLE public.upa_achizitii ADD CONSTRAINT upa_achizitii_cheie_intentie_uidx UNIQUE (cheie_intentie);
COMMENT ON COLUMN public.upa_achizitii.cheie_intentie IS 'UPA (20261229a): cheia de intentie a salvarii din formular (reincercarea cu aceeasi cheie nu dubleaza); NULL = alta cale.';
-- runda 3: amprenta DURABILĂ a valorilor intenției (pusă de server, nemodificabilă împreună cu cheia; NULL <=> cheie NULL)
ALTER TABLE public.upa_achizitii ADD COLUMN hash_intentie text;
ALTER TABLE public.upa_achizitii ADD CONSTRAINT upa_achizitii_hash_intentie_cu_cheie CHECK ((cheie_intentie IS NULL) = (hash_intentie IS NULL));
COMMENT ON COLUMN public.upa_achizitii.hash_intentie IS 'UPA (20261229a): md5 pe campurile semantice ale intentiei (fn_upa_hash_intentie), pus de trigger la INSERT; nemodificabil.';
-- INSERT: amprenta din rândul care se scrie (orice valoare trimisă de client e înlocuită, L08); UPDATE: cheia și amprenta nu se schimbă
--   (amprenta rămâne cea a intenției salvate, chiar dacă rândul e corectat ulterior). Nu blochează nimic în afara rândului.
CREATE FUNCTION public.fn_upa_achizitii_intentie() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.hash_intentie := CASE WHEN NEW.cheie_intentie IS NULL THEN NULL ELSE public.fn_upa_hash_intentie(to_jsonb(NEW)) END;
  ELSIF NEW.cheie_intentie IS DISTINCT FROM OLD.cheie_intentie OR NEW.hash_intentie IS DISTINCT FROM OLD.hash_intentie THEN
    RAISE EXCEPTION 'upa: cheia si amprenta intentiei nu se modifica' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_achizitii_intentie() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_upa_achizitii_intentie BEFORE INSERT OR UPDATE ON public.upa_achizitii
  FOR EACH ROW EXECUTE FUNCTION public.fn_upa_achizitii_intentie();
-- salvarea din formular. SECURITY INVOKER: citirea după cheie și adăugarea trec prin politicile tabelului, ca apelantul (L07 / L08).
--   (1) cheia există: aceeași amprentă -> 'existent' (fără să ceară dreptul de scriere: reluarea unei salvări intrate, cu răspunsul pierdut,
--       nu poate deveni „refuzată” pentru că dreptul s-a retras între timp — runda 3 P1); altă amprentă -> UPA02 (nimic scris);
--   (2) altfel INSERT .. ON CONFLICT (cheie_intentie) DO NOTHING RETURNING (dreptul și regulile tabelului se aplică AICI: 42501 / 23514);
--       o inserare concurentă cu aceeași cheie -> recitire (1). 40001 = conflict fără rând vizibil (n-ar trebui să se întâmple).
-- Lock-uri (L06): doar rândul nou din upa_achizitii (și așteptarea pe indexul UNIQUE al cheii la o inserare concurentă).
CREATE FUNCTION public.fn_upa_achizitie_adauga(p_cheie uuid, p_rand jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_r public.upa_achizitii; v_hash text; v_ex record; v_id bigint; v_k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'upa: cont neautentificat' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_rand IS NULL OR jsonb_typeof(p_rand) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'upa: cheia si campurile achizitiei sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  SELECT k.k INTO v_k FROM jsonb_object_keys(p_rand) AS k(k) WHERE NOT (k.k = ANY (public.fn_upa_campuri_intentie())) LIMIT 1;
  IF v_k IS NOT NULL THEN RAISE EXCEPTION 'upa: camp nepermis in achizitie (%)', left(v_k, 40) USING ERRCODE = '22023'; END IF;
  v_r := jsonb_populate_record(NULL::public.upa_achizitii, p_rand);
  v_hash := public.fn_upa_hash_intentie(to_jsonb(v_r));
  FOR v_pas IN 1..2 LOOP
    SELECT a.id, a.hash_intentie INTO v_ex FROM public.upa_achizitii a WHERE a.cheie_intentie = p_cheie;
    IF FOUND THEN
      IF v_ex.hash_intentie IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'upa: cheia intentiei exista deja cu alte valori; nimic scris' USING ERRCODE = 'UPA02';
      END IF;
      RETURN jsonb_build_object('stare', 'existent', 'id', v_ex.id);
    END IF;
    EXIT WHEN v_pas = 2;
    INSERT INTO public.upa_achizitii AS a (furnizor_id, furnizor_nume, numar_factura, data_factura, luna, valoare, descriere, document_path,
                                           cheie_intentie, created_by)
    VALUES (v_r.furnizor_id, v_r.furnizor_nume, v_r.numar_factura, v_r.data_factura, v_r.luna, v_r.valoare, v_r.descriere, v_r.document_path,
            p_cheie, auth.uid())
    ON CONFLICT (cheie_intentie) DO NOTHING
    RETURNING a.id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('stare', 'nou', 'id', v_id); END IF;
  END LOOP;
  RAISE EXCEPTION 'upa: cheia intentiei in conflict, fara rand vizibil; reincearca' USING ERRCODE = '40001';
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_achizitie_adauga(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_achizitie_adauga(uuid, jsonb) TO authenticated;
COMMENT ON FUNCTION public.fn_upa_achizitie_adauga(uuid, jsonb) IS 'UPA (20261229a): salvarea idempotenta din formular (cheie de intentie + amprenta durabila). existent / nou; UPA02 = aceeasi cheie, alte valori. SECURITY INVOKER.';

-- ─── 9. Plafonul lunii curente = valoarea de azi din logistica_setari ─────────────────────────────────────────────────────
INSERT INTO public.upa_plafon_lunar (luna, plafon, setat_de, setat_la, sursa)
SELECT date_trunc('month', now() AT TIME ZONE 'Europe/Bucharest')::date, btrim(s.value)::numeric(12,2), NULL, now(), 'migrare'
  FROM public.logistica_setari s WHERE s.key = 'upa_plafon_lunar';

-- ─── 10. Postcondiții ────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE r record; v_acl text; v_pol text; v_n integer; v_amp text;
BEGIN
  -- tabelele noi: RLS, fără FORCE, proprietar postgres, drepturile EXACTE (doar SELECT pentru authenticated)
  FOR r IN SELECT * FROM (VALUES ('public.upa_plafon_lunar'), ('public.upa_luna_inchisa'), ('public.upa_alerta_jurnal')) v(t) LOOP
    SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") INTO v_acl FROM (
      SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
        FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = r.t::regclass) a;
    IF v_acl IS DISTINCT FROM 'authenticated:SELECT, postgres:DELETE, postgres:INSERT, postgres:MAINTAIN, postgres:REFERENCES, postgres:SELECT, postgres:TRIGGER, postgres:TRUNCATE, postgres:UPDATE'
       OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = r.t::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity
                        AND pg_get_userbyid(c.relowner) = 'postgres') THEN
      RAISE EXCEPTION '20261229a post: tabelul % (RLS / proprietar / drepturi exacte: %)', r.t, v_acl;
    END IF;
  END LOOP;
  SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") INTO v_acl FROM (
    SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type AS d
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) e WHERE c.oid = 'public.upa_alerta_jurnal_id_seq'::regclass) a;
  IF v_acl IS DISTINCT FROM 'postgres:SELECT, postgres:UPDATE, postgres:USAGE' THEN
    RAISE EXCEPTION '20261229a post: secventa jurnalului (drepturi exacte: %)', v_acl;
  END IF;
  -- politicile EXACTE (nume | comanda | roluri | USING | CHECK), pe tabelele noi și pe upa_achizitii
  SELECT string_agg(c.oid::regclass::text || ' ' || p.polname || ' | ' || p.polcmd::text || ' | ' || CASE WHEN p.polpermissive THEN 'P' ELSE 'R' END || ' | '
                    || (SELECT string_agg(CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END, ',' ORDER BY 1) FROM unnest(p.polroles) ro) || ' | '
                    || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' | ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                    chr(10) ORDER BY c.oid::regclass::text, p.polname)
    INTO v_pol FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.oid IN ('public.upa_plafon_lunar'::regclass, 'public.upa_luna_inchisa'::regclass, 'public.upa_alerta_jurnal'::regclass, 'public.upa_achizitii'::regclass);
  IF v_pol IS DISTINCT FROM concat_ws(chr(10),
       'upa_achizitii upa_achizitii_adaugare | a | P | authenticated | - | ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie)',
       'upa_achizitii upa_achizitii_citire | r | P | authenticated | (auth.uid() IS NOT NULL) | -',
       'upa_achizitii upa_achizitii_modificare | w | P | authenticated | ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie) | ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie)',
       'upa_achizitii upa_achizitii_stergere | d | P | authenticated | ( SELECT fn_upa_poate_scrie() AS fn_upa_poate_scrie) | -',
       'upa_alerta_jurnal upa_alerta_jurnal_citire_owner | r | P | authenticated | (EXISTS ( SELECT 1' || chr(10) || '   FROM profiles p' || chr(10)
         || '  WHERE ((p.id = auth.uid()) AND (p.is_owner IS TRUE)))) | -',
       'upa_luna_inchisa upa_luna_inchisa_citire | r | P | authenticated | (auth.uid() IS NOT NULL) | -',
       'upa_plafon_lunar upa_plafon_lunar_citire | r | P | authenticated | (auth.uid() IS NOT NULL) | -') THEN
    RAISE EXCEPTION '20261229a post: politicile nu sunt cele declarate: %', v_pol;
  END IF;
  IF (SELECT obj_description(p.oid, 'pg_policy') FROM pg_policy p WHERE p.polrelid = 'public.upa_achizitii'::regclass AND p.polname = 'upa_achizitii_citire')
     !~ ' roluri_vechi=(public|authenticated) check_vechi=(gol|uid)$' THEN
    RAISE EXCEPTION '20261229a post: comentariul politicii de citire (roluri_vechi / check_vechi) lipseste';
  END IF;
  -- cheia de intenție: coloana uuid, NULL permis, UNIQUE exact pe ea
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.upa_achizitii'::regclass AND a.attname = 'cheie_intentie' AND NOT a.attisdropped
                   AND a.atttypid = 'uuid'::regtype AND NOT a.attnotnull)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.upa_achizitii'::regclass AND k.conname = 'upa_achizitii_cheie_intentie_uidx'
                      AND k.contype = 'u' AND pg_get_constraintdef(k.oid) = 'UNIQUE (cheie_intentie)') THEN
    RAISE EXCEPTION '20261229a post: upa_achizitii.cheie_intentie (uuid, NULL permis, UNIQUE)';
  END IF;
  -- amprenta intenției: coloana text, CHECK-ul exact, triggerul exact (BEFORE INSERT OR UPDATE, pe rând, activ, fără WHEN / argumente / coloane)
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.upa_achizitii'::regclass AND a.attname = 'hash_intentie' AND NOT a.attisdropped
                   AND a.atttypid = 'text'::regtype AND NOT a.attnotnull AND a.attacl IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.upa_achizitii'::regclass AND k.conname = 'upa_achizitii_hash_intentie_cu_cheie'
                      AND k.contype = 'c' AND k.convalidated AND pg_get_constraintdef(k.oid) = 'CHECK (((cheie_intentie IS NULL) = (hash_intentie IS NULL)))')
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.upa_achizitii'::regclass AND t.tgname = 'trg_upa_achizitii_intentie'
           AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgfoid = 'public.fn_upa_achizitii_intentie()'::regprocedure AND t.tgtype = 23
           AND t.tgqual IS NULL AND t.tgnargs = 0 AND coalesce(array_length(t.tgattr::int2[], 1), 0) = 0) <> 1 THEN
    RAISE EXCEPTION '20261229a post: upa_achizitii.hash_intentie (coloana / CHECK / trigger)';
  END IF;
  -- funcțiile noi: limbaj, definer, volatilitate, search_path, proprietar, drepturile EXACTE
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_upa_poate_scrie()', 'sql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_plafon_la(date)', 'sql', false, 's', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_luni(date,integer)', 'plpgsql', false, 's', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_destinatari(text)', 'plpgsql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_upa_lei(numeric)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_upa_luna_text(date)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_upa_zile_text(integer)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_upa_erori_config(integer,numeric)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_upa_plafon_seteaza(numeric,numeric)', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_alerta_inscrie(text,date,date,numeric,numeric,numeric,integer,text[],integer,text)', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_upa_alerta_rezerva_la(date)', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_upa_alerta_rezerva()', 'sql', true, 'v', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_alerta_proba()', 'plpgsql', true, 's', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_alerta_marcheaza(bigint,text,text,text)', 'plpgsql', true, 'v', 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_luna_inchisa_nemodificabil()', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_upa_campuri_intentie()', 'sql', false, 'i', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_hash_intentie(jsonb)', 'sql', false, 'i', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_achizitii_intentie()', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_upa_achizitie_adauga(uuid,jsonb)', 'plpgsql', false, 'v', 'authenticated:EXECUTE, postgres:EXECUTE')
    ) v(fn, limbaj, definer, volatil, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.provolatile = r.volatil
                      AND p.prokind = 'f' AND NOT p.proleakproof
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                               FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = r.acl) THEN
      RAISE EXCEPTION '20261229a post: functia % (limbaj / definer / volatil / search_path / owner / drepturi exacte)', r.fn;
    END IF;
  END LOOP;
  -- câte o singură variantă pe fiecare nume nou (fără supraîncărcări)
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['fn_upa_poate_scrie', 'fn_upa_plafon_la',
    'fn_upa_luni', 'fn_upa_destinatari', 'fn_upa_lei', 'fn_upa_luna_text', 'fn_upa_zile_text', 'fn_upa_erori_config', 'fn_upa_plafon_seteaza',
    'fn_upa_alerta_inscrie', 'fn_upa_alerta_rezerva_la', 'fn_upa_alerta_rezerva', 'fn_upa_alerta_proba', 'fn_upa_alerta_marcheaza',
    'fn_upa_luna_inchisa_nemodificabil', 'fn_upa_campuri_intentie', 'fn_upa_hash_intentie', 'fn_upa_achizitii_intentie', 'fn_upa_achizitie_adauga']);
  IF v_n <> 19 THEN RAISE EXCEPTION '20261229a post: % functii cu numele noi (asteptat 19)', v_n; END IF;
  -- triggerul de nemodificare
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.upa_luna_inchisa'::regclass AND NOT t.tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.upa_luna_inchisa'::regclass AND t.tgname = 'trg_upa_luna_inchisa_nemodificabil'
                      AND t.tgenabled = 'O' AND t.tgfoid = 'public.fn_upa_luna_inchisa_nemodificabil()'::regprocedure AND t.tgtype = 27 AND t.tgqual IS NULL) THEN
    RAISE EXCEPTION '20261229a post: triggerul upa_luna_inchisa';
  END IF;
  -- rândul de start: luna curentă = valoarea din logistica_setari, singurul rând
  IF (SELECT count(*) FROM public.upa_plafon_lunar) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.upa_plafon_lunar p, public.logistica_setari s
                     WHERE s.key = 'upa_plafon_lunar' AND p.plafon = btrim(s.value)::numeric AND p.sursa = 'migrare' AND p.setat_de IS NULL
                       AND p.luna = date_trunc('month', now() AT TIME ZONE 'Europe/Bucharest')::date) THEN
    RAISE EXCEPTION '20261229a post: plafonul lunii curente';
  END IF;
  IF EXISTS (SELECT 1 FROM public.upa_luna_inchisa) OR EXISTS (SELECT 1 FROM public.upa_alerta_jurnal) THEN
    RAISE EXCEPTION '20261229a post: tabelele de istoric trebuie sa fie goale';
  END IF;
  -- textele: aceleași forme ca în ecran / mail
  IF public.fn_upa_lei(7000) IS DISTINCT FROM '7.000,00' OR public.fn_upa_lei(1234567.5) IS DISTINCT FROM '1.234.567,50' OR public.fn_upa_lei(0) IS DISTINCT FROM '0,00'
     OR public.fn_upa_luna_text('2026-11-01') IS DISTINCT FROM 'noiembrie 2026' OR public.fn_upa_zile_text(1) IS DISTINCT FROM 'mai este 1 zi'
     OR public.fn_upa_zile_text(6) IS DISTINCT FROM 'mai sunt 6 zile' OR public.fn_upa_zile_text(21) IS DISTINCT FROM 'mai sunt 21 de zile' THEN
    RAISE EXCEPTION '20261229a post: textele (lei / luna / zile)';
  END IF;
  -- destinatarii: doar interni; restul ignorat (nu refuză lista); peste 10 interne = NULL
  IF (SELECT d.interni = ARRAY['a@gazpet.ro', 'b@gazpet.ro'] AND d.ignorate = '{}'::text[]
        FROM public.fn_upa_destinatari(' A@gazpet.ro, b@gazpet.ro ,a@gazpet.ro,') d) IS NOT TRUE
     OR (SELECT d.interni = ARRAY['a@gazpet.ro'] AND d.ignorate = ARRAY['x@altundeva.ro', 'b@gazpet.ro.ro', 'c@sub.gazpet.ro', 'fara-arond']
           FROM public.fn_upa_destinatari('a@gazpet.ro, X@altundeva.ro, b@gazpet.ro.ro, c@sub.gazpet.ro, fara-arond') d) IS NOT TRUE
     OR (SELECT d.interni = '{}'::text[] AND d.ignorate = '{}'::text[] FROM public.fn_upa_destinatari('') d) IS NOT TRUE
     OR (SELECT d.interni IS NULL FROM public.fn_upa_destinatari((SELECT string_agg('a' || g || '@gazpet.ro', ',') FROM generate_series(1, 11) g)) d) IS NOT TRUE THEN
    RAISE EXCEPTION '20261229a post: validarea destinatarilor';
  END IF;
  -- amprenta intenției: aceleași câmpuri, aceeași valoare pentru tipuri echivalente, alt câmp = altă amprentă
  IF public.fn_upa_campuri_intentie() IS DISTINCT FROM ARRAY['furnizor_id', 'furnizor_nume', 'numar_factura', 'data_factura', 'luna', 'valoare', 'descriere', 'document_path']
     OR public.fn_upa_hash_intentie('{"luna": "2031-05-01", "valoare": 10}') IS DISTINCT FROM public.fn_upa_hash_intentie('{"valoare": 10, "luna": "2031-05-01", "x": 1}')
     OR public.fn_upa_hash_intentie('{"luna": "2031-05-01", "valoare": 10}') = public.fn_upa_hash_intentie('{"luna": "2031-05-01", "valoare": 10, "descriere": "x"}') THEN
    RAISE EXCEPTION '20261229a post: amprenta intentiei';
  END IF;
  IF public.fn_upa_erori_config(25, 7000) IS DISTINCT FROM '{}'::text[] OR public.fn_upa_erori_config(NULL, 7000) IS DISTINCT FROM ARRAY['setare_zi_invalida']
     OR public.fn_upa_erori_config(25, NULL) IS DISTINCT FROM ARRAY['fara_plafon']
     OR public.fn_upa_erori_config(NULL, NULL) IS DISTINCT FROM ARRAY['setare_zi_invalida', 'fara_plafon'] THEN
    RAISE EXCEPTION '20261229a post: codurile de configurare';
  END IF;
  -- amprenta COMPLETĂ a obiectelor migrării = constanta revizuită (aceeași pe care o verifică revenirea înainte de a scoate ceva)
  -- AMPRENTA_20261229a_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul; PG17 / PG18: NOT NULL-urile din pg_constraint scoase)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'rel ' || c.relname || ' ' || c.relkind::text || ' own=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(c.relacl) e) a), '-') AS l
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal', 'upa_alerta_jurnal_id_seq')
    UNION ALL
    SELECT 'rls upa_achizitii ' || c.relrowsecurity || ' ' || c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'public.upa_achizitii'::regclass
    UNION ALL
    SELECT 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' id=' || a.attidentity::text
           || ' gen=' || a.attgenerated::text || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || ' acl=' || coalesce((SELECT string_agg(e.d, ',' ORDER BY e.d COLLATE "C") FROM (
                SELECT CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ':' || x.privilege_type
                       || CASE WHEN x.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(a.attacl) x) e), '-')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal') OR (c.relname = 'upa_achizitii' AND a.attname IN ('cheie_intentie', 'hash_intentie')))
    UNION ALL
    SELECT 'con ' || c.relname || ' ' || k.conname || ' ' || k.contype::text || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype <> 'n' AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal')
            OR (c.relname = 'upa_achizitii' AND k.conname IN ('upa_achizitii_cheie_intentie_uidx', 'upa_achizitii_hash_intentie_cu_cheie')))
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' own=' || pg_get_userbyid(ic.relowner)
      FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE t.relnamespace = 'public'::regnamespace
       AND (t.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal') OR (t.relname = 'upa_achizitii' AND ic.relname = 'upa_achizitii_cheie_intentie_uidx'))
    UNION ALL
    SELECT 'trg ' || c.relname || ' ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal') OR (c.relname = 'upa_achizitii' AND t.tgname = 'trg_upa_achizitii_intentie'))
    UNION ALL
    -- runda 3 (L14 / L15): ORICE obiect care depinde de coloanele noi din upa_achizitii (index / constrângere / statistică / vedere / politică /
    --   trigger, oricum s-ar numi) — DROP COLUMN ar scoate tăcut dependențele automate, deci orice dependență în plus schimbă amprenta
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> upa_achizitii.' || a.attname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
     WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.upa_achizitii'::regclass AND a.attname IN ('cheie_intentie', 'hash_intentie')
    UNION ALL
    SELECT 'pol ' || c.relname || ' ' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(rl.nume, ',' ORDER BY rl.nume COLLATE "C") FROM (
                SELECT CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END AS nume FROM unnest(p.polroles) ro) rl), '-')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_plafon_lunar', 'upa_luna_inchisa', 'upa_alerta_jurnal', 'upa_achizitii')
    UNION ALL
    SELECT 'seq ' || c.relname || ' ' || format_type(s.seqtypid, NULL) || ' ' || s.seqstart || ' ' || s.seqincrement || ' ' || s.seqmin || ' ' || s.seqmax
           || ' ' || s.seqcache || ' ' || s.seqcycle
      FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'upa_alerta_jurnal_id_seq'
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_poate_scrie', 'fn_upa_plafon_la', 'fn_upa_luni', 'fn_upa_destinatari',
             'fn_upa_lei', 'fn_upa_luna_text', 'fn_upa_zile_text', 'fn_upa_erori_config', 'fn_upa_plafon_seteaza', 'fn_upa_alerta_inscrie',
             'fn_upa_alerta_rezerva_la', 'fn_upa_alerta_rezerva', 'fn_upa_alerta_proba', 'fn_upa_alerta_marcheaza', 'fn_upa_luna_inchisa_nemodificabil',
             'fn_upa_campuri_intentie', 'fn_upa_hash_intentie', 'fn_upa_achizitii_intentie', 'fn_upa_achizitie_adauga')
  ) x;
  -- AMPRENTA_20261229a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '59c0f9a02655f444dc9c2a7bb2a5783d' THEN
    RAISE NOTICE 'AMPRENTA_20261229a_TEXT %', v_amp;
    RAISE EXCEPTION '20261229a post: AMPRENTA obiectelor % (asteptat 59c0f9a02655f444dc9c2a7bb2a5783d)', md5(coalesce(v_amp, ''));
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261229a_administrativ_upa_alerta:' || txid_current() THEN
    RAISE EXCEPTION '20261229a: garda final invalida';
  END IF;
  RAISE NOTICE '20261229a: sfarsit la % ms de la BEGIN; lock-ul pe upa_achizitii tinut de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
