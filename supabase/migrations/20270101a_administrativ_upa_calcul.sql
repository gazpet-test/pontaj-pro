-- Version 20270101120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270101a_administrativ_upa_calcul.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 (docs/LIVRARE_L15_V2.md): lista OBIECTELOR (familie, etichetă, operație — verificată pe PGlite cu pașii reali ai runnerului) e în
--   supabase/tests/20270101a_administrativ_upa_calcul.l15.obiecte.tsv; manifestul .l15.tsv îl generează coordonatorul pe clonă.
-- 20270101a_administrativ_upa_calcul — Administrativ → Unități protejate (UPA): contribuția pentru fondul de handicap CALCULATĂ după răspunsul
--   expertului contabil (decizia owner-ului, 20.11.2026; docs/administrativ/UPA_CALCUL_EXPERT.md). Înlocuiește plafonul fix din setări.
--   Runda 2 (review PR #1154, 8 x P1 + P2): baza integrală, posturile cu 2 zecimale, suspendările și zilele nelucrătoare, închiderea
--   confirmată de owner pe amprenta datelor, intențiile vechi compatibile, alerta exactă recuperată, factura neplătită, termenul din decembrie.
--   Runda 3 (2 x P1 + P2): închiderea citește calculul și detaliul într-un singur instantaneu și reface după scriere calculul COMPLET
--   (blocajele de completitudine incluse) din sursele de acum (fn_upa_calcul_previziune_la); alerta exactă se recuperează pentru orice lună
--   închisă fără ea, și după scadență (mesaj „termenul a trecut”); calendarul cere și sărbătorile mobile din zile lucrătoare.
--   Runda 4 (răspunsul expertului, 24.11.2026): CFS-ul și suspendările se numără pe zile calendaristice, pe PERIOADA actului (weekendul
--     dintr-o suspendare e suspendat, weekendul de după sfârșitul ei e zi activă); contractul și corecțiile HR exact pe intervalul lor;
--     pragul de 50 pe NMA-ul rotunjit (NMA >= 50,00); coloana zile_fara_efectiv scoasă (nu mai există zile de contract fără efectiv).
--   Runda 6 (răspunsurile expertei contabile, 25.11.2026): absențele nemotivate (N) NU se numără ca zile lucrate (se scad ca suspendările);
--     reportul NU expiră la sfârșitul anului (trece dintr-un an în altul, cum era deja în cod — probat); termenul la stat = ZI configurabilă pe
--     perioade (upa_parametri 'termen_stat_zi', implicit 25): 21 pentru noiembrie 2026 (21.12.2026), 25 din decembrie 2026 — dacă 21 e regula
--     generală pentru decembrie sau o excepție se confirmă de expertă, de aceea nu e o regulă în cod; reportul inițial 0 la octombrie 2026.
--
-- Formula (pe luna M; o singură definiție: fn_upa_calcul_la, L19):
--   NMA = Σ_angajați Σ_zile normă(d) / zilele calendaristice ale lunii, rotunjit la 2 zecimale, pe fiecare zi d a contractului (între
--     employees.hire_date și employees.termination_date, ambele incluse). Ziua d NU se numără dacă: angajatul era administrator (semnatar
--     activ sau corecție HR pe interval); contractul era suspendat (corecție upa_angajat_perioade pe interval); era în CFS (CFP) sau într-o
--     suspendare de drept (CM, BO, BP, AM, M: incapacitate temporară de muncă, maternitate — Codul muncii art. 50) sau în absență nemotivată
--     (N; runda 6: experta — nu e zi lucrată, în sinteza pontajului de lichidare e la perioade suspendate), pe PERIOADA actului:
--     codul din pontaj pe ziua d (și pe weekend / sărbătoare, dacă e trecut), iar o zi nelucrătoare fără cod e în act doar dacă e între
--     două zile cu același cod (detaliul: fn_upa_nma_angajati). normă(d) = corecția pe perioadă sau procent_ocupare / 100.
--   posturi = round(4% × NMA, 2), doar dacă NMA >= 50 (altfel 0); Legea 448/2006 art. 78, Ordinul 1001/2022 art. 4: 2 zecimale, fără
--     rotunjire la întreg (rotunjire matematică, confirmată de expert)
--   locuri neocupate = max(posturi − angajați cu handicap, 0)
--   contribuția INTEGRALĂ B = round(locuri × salariul minim brut al lunii, 2) (upa_parametri 'salariu_minim', pe perioade)
--   deducerea maximă = trunc(B / 2, 2): la stat se plătește cel puțin jumătate din B; achizițiile acoperă cel mult cealaltă jumătate
--   achiziții A = Σ upa_achizitii.valoare_fara_tva ale lunii PLĂTITE până la ultima zi a lunii (stare_plata 'platita', data_plata ≤ ultima zi)
--   deducere = min(A + report intrat, deducerea maximă); de plată la stat = B − deducere; report ieșit = A + report intrat − deducere
--   termenul la stat = fn_upa_termen_stat: ziua 'termen_stat_zi' (upa_parametri, pe perioade; fără rând = 25) a lunii următoare, zi
--     nelucrătoare -> prima zi lucrătoare următoare (regula generală a termenelor, Codul de procedură fiscală art. 75). Rândurile migrării:
--     21 de la noiembrie 2026 (experta: 21.12.2026), 25 de la decembrie 2026 (de confirmat de expertă dacă 21 e regula fiecărui decembrie).
-- Stări: PREVIZIUNE cât luna nu e închisă; din 13 a lunii următoare luna se poate ÎNCHIDE doar de owner, din ecran, pe AMPRENTA datelor pe care
--   le-a văzut (pontaj pe fiecare zi lucrătoare, corecțiile HR, achizițiile, parametrii): orice schimbare între afișare și închidere = 40001.
--   Cronul nu mai închide (normele, administratorii și suspendările fără cod nu au istoric în ERP: le confirmă omul); îl anunță zilnic pe owner
--   (calcul_de_confirmat) sau, cu date lipsă, și Administrativ / UPA (calcul_neinchis), iar după închidere trimite O DATĂ alerta exactă
--   (cheia calcul:AAAA-LL, recuperată la prima rulare de după închidere, oricine a închis).
--
-- Ce face:
--   * upa_achizitii: valoare_fara_tva, data_plata, stare_plata ('platita' cu data / 'neplatita' / NULL = necunoscut). Intră în intenția
--     salvării din formular cu amprentă VERSIONATĂ (fn_upa_hash_intentie_v2): fără valorile noi = EXACT amprenta din 20261229a (reîncercările
--     intențiilor de dinainte de migrare și ale clientului vechi rămân 'existent', și după revenire); cu ele = 'v2:' + md5 pe toate câmpurile.
--     fn_upa_campuri_intentie / fn_upa_hash_intentie rămân neatinse; fn_upa_achizitii_intentie (triggerul) și fn_upa_achizitie_adauga folosesc v2.
--   * upa_parametri (salariul minim, angajații cu handicap, reportul inițial, ziua termenului la stat, pe perioade) — scris doar prin
--     fn_upa_parametru_seteaza.
--   * upa_angajat_perioade: corecțiile HR pe interval (normă, administrator da/nu, suspendare fără cod de pontaj), doar owner-ul, cu motiv.
--   * upa_calcul_lunar + upa_calcul_angajat: luna închisă (instantaneu nemodificabil, cu amprentele surselor și cine a confirmat).
--   * upa_alerta_jurnal: felul nou 'calcul' (cheia calcul:AAAA-LL), lângă cele vechi (rândurile legacy 'inchidere:AAAA-LL' nu mai suprimă nimic).
-- Ce NU face: nu modifică employees / pontaj_records / hr_decizii_semnatari / calendar_days (doar le citește), nu trimite nimic, nu schimbă
--   drepturi pe module, cronul (jobid 29) sau logistica_setari. upa_plafon_lunar / fn_upa_luni / fn_upa_plafon_seteaza rămân neatinse.
-- ORDINEA LIVRĂRII (docs/administrativ/UPA_CALCUL_EXPERT.md): edge-ul upa-plafon-alerta v11 -> migrarea -> merge-ul ecranului -> parametrii.
-- Ordinea lock-urilor (L06), aceeași pe toate căile: lock consultativ hashtext('upa_alerta_jurnal') (doar rularea cronului) -> lock consultativ
--   hashtext('upa_calcul_lunar') (închiderea, parametrii, corecțiile HR) -> upa_achizitii SHARE (doar închiderea) -> upa_calcul_lunar ->
--   upa_calcul_angajat -> upa_angajat_perioade -> upa_alerta_jurnal -> notifications. Cronul nu ia lock-ul calculului (nu mai închide).
--   employees / pontaj_records / calendar_days nu se blochează: închiderea citește calculul și detaliul într-o singură instrucțiune, apoi,
--   după scriere, reface calculul complet (cu blocajele de completitudine) din sursele de acum și refuză (40001) la orice diferență.
-- Lock-uri la aplicare (punct unic, NOWAIT, bugetul 1 s de la prima încercare, ordinea upa_achizitii -> upa_alerta_jurnal): ACCESS EXCLUSIVE
--   (3 coloane NULL fără rescriere + 2 CHECK-uri triviale pe upa_achizitii; 2 CHECK-uri înlocuite pe upa_alerta_jurnal, validate pe rândurile lui).
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, garda finală.
-- Revenire: supabase/revenire/20270101a_administrativ_upa_calcul_ROLLBACK.sql. Probe: scripts/pglite/test_upa_calcul_local.mjs.
DO $pre$
DECLARE r record; v_tip text; v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270101a_administrativ_upa_calcul:' || txid_current() THEN
    RAISE EXCEPTION '20270101a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270101a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270101a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270101a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270101a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261229a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270101a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.upa_parametri') IS NOT NULL OR to_regclass('public.upa_calcul_lunar') IS NOT NULL OR to_regclass('public.upa_calcul_angajat') IS NOT NULL
     OR to_regclass('public.upa_angajat_perioade') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['fn_upa_parametru_la', 'fn_upa_inceput_calcul',
                  'fn_upa_pontaj_inchis', 'fn_upa_zi_lucratoare', 'fn_upa_calendar_lipsa', 'fn_upa_termen_stat', 'fn_upa_cauza_cod', 'fn_upa_nma_angajati',
                  'fn_upa_rand_amprenta', 'fn_upa_amprenta_achizitii', 'fn_upa_calcul_previziune_la', 'fn_upa_calcul_la', 'fn_upa_situatie_la', 'fn_upa_situatie', 'fn_upa_calcul_inchide_la',
                  'fn_upa_calcul_inchide', 'fn_upa_calcul_detaliu', 'fn_upa_parametru_seteaza', 'fn_upa_perioada_adauga', 'fn_upa_perioada_sterge',
                  'fn_upa_campuri_intentie_v2', 'fn_upa_hash_intentie_v2']))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.upa_achizitii'::regclass AND a.attname IN ('valoare_fara_tva', 'data_plata', 'stare_plata') AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.upa_achizitii'::regclass AND c.conname IN ('upa_achizitii_fara_tva_interval', 'upa_achizitii_stare_plata')) THEN
    RAISE EXCEPTION '20270101a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite (tabelele HR / pontaj / calendar sunt create direct în producție: se verifică, nu se presupun)
  FOR r IN SELECT * FROM (VALUES
      ('employees', 'id', 'integer|bigint'), ('employees', 'active', 'boolean'), ('employees', 'hire_date', 'date'),
      ('employees', 'termination_date', 'date'), ('employees', 'procent_ocupare', 'numeric|integer|smallint|real|double precision'),
      ('employees', 'name', 'text|character varying'),
      ('pontaj_records', 'employee_id', 'integer|bigint'), ('pontaj_records', 'date', 'date'), ('pontaj_records', 'norma', 'text|character varying'),
      ('hr_decizii_semnatari', 'employee_id', 'integer|bigint'), ('hr_decizii_semnatari', 'calitate', 'text|character varying'),
      ('hr_decizii_semnatari', 'activ', 'boolean'),
      ('calendar_days', 'date', 'date'), ('calendar_days', 'type', 'text|character varying'),
      ('upa_achizitii', 'valoare', 'numeric'), ('upa_achizitii', 'luna', 'date'), ('upa_achizitii', 'cheie_intentie', 'uuid'),
      ('upa_achizitii', 'hash_intentie', 'text')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20270101a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  -- un singur rând de pontaj pe (angajat, zi) și o singură zi în calendar: calculul pe zile se bazează pe ele (altfel o zi s-ar număra de 2 ori)
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.pontaj_records'::regclass AND i.indisunique AND i.indpred IS NULL AND i.indnkeyatts = 2
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey))
                        = ARRAY['date', 'employee_id'])
     OR NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.calendar_days'::regclass AND i.indisunique AND i.indpred IS NULL AND i.indnkeyatts = 1
                    AND (SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) = 'date') THEN
    RAISE EXCEPTION '20270101a: lipseste unicitatea pontaj_records (employee_id, date) sau calendar_days (date); nimic schimbat';
  END IF;
  -- funcțiile din 20261229a pe care migrarea le înlocuiește / le folosește: EXACT forma revizuită (sursa md5, limbaj, definer, proprietar,
  --   search_path, drepturi); revenirea le reface identic, deci o abatere de azi s-ar pierde tăcut -> refuz
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_upa_campuri_intentie()', '4e4b376f96d4dd342fa4f1bb7ca8e77c', 'sql', false, 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_achizitii_intentie()', 'a821bc8b037b0f4a1294372ba5875cb2', 'plpgsql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_achizitie_adauga(uuid,jsonb)', '5209c63755b845071e0921939dfb328a', 'plpgsql', false, 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_alerta_inscrie(text,date,date,numeric,numeric,numeric,integer,text[],integer,text)', '86bf8045edf180cfc16deb01b25f363b', 'plpgsql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_alerta_rezerva_la(date)', 'a87d5f44064b658ca51828ae42184d99', 'plpgsql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_alerta_proba()', 'fe1128ac647385bcb4c03b01906ec4bf', 'plpgsql', true, 'postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_luna_inchisa_nemodificabil()', 'b67089852063f983526ca731781c9d98', 'plpgsql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_poate_scrie()', 'f471aac26eec8d6dfae5749073a00fc4', 'sql', true, 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_hash_intentie(jsonb)', '6ed0bf58f3be8ea4322890a3fcd195d9', 'sql', false, 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_destinatari(text)', '39822c32c3d2fe23161ef280e3be02ee', 'plpgsql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_lei(numeric)', '315ec7ff6377042913f09470946f408a', 'sql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_luna_text(date)', '38d79c5de25fd797b4add1af147b6b92', 'sql', false, 'postgres:EXECUTE'),
      ('public.fn_upa_zile_text(integer)', '44b28980e06025b0aac7b1ce893195c8', 'sql', false, 'postgres:EXECUTE')
    ) v(fn, src, limbaj, definer, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.prokind = 'f'
                      AND md5(replace(p.prosrc, chr(13), '')) = r.src
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                               FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = r.acl) THEN
      RAISE EXCEPTION '20270101a: functia % nu e exact cea din 20261229a (sursa / limbaj / definer / proprietar / drepturi); nimic schimbat', r.fn;
    END IF;
  END LOOP;
  IF to_regclass('public.upa_alerta_jurnal') IS NULL OR to_regclass('public.upa_luna_inchisa') IS NULL THEN
    RAISE EXCEPTION '20270101a: lipseste 20261229a (upa_alerta_jurnal / upa_luna_inchisa)';
  END IF;
  -- CHECK-urile jurnalului pe care migrarea le înlocuiește: EXACT cele din 20261229a (revenirea le reface din același text)
  IF (SELECT string_agg(k.conname || '=' || md5(pg_get_constraintdef(k.oid)), ',' ORDER BY k.conname) FROM pg_constraint k
       WHERE k.conrelid = 'public.upa_alerta_jurnal'::regclass AND k.contype = 'c' AND k.convalidated
         AND k.conname IN ('upa_alerta_jurnal_fel', 'upa_alerta_jurnal_forma_cheie'))
     IS DISTINCT FROM 'upa_alerta_jurnal_fel=12d6a4435982d7d98a7d8c142131acad,upa_alerta_jurnal_forma_cheie=8609fbc0de53efab1d1b20bcb0772969' THEN
    RAISE NOTICE 'JURNAL_CHECK %', (SELECT string_agg(k.conname || '=' || md5(pg_get_constraintdef(k.oid)), ',' ORDER BY k.conname) FROM pg_constraint k
       WHERE k.conrelid = 'public.upa_alerta_jurnal'::regclass AND k.contype = 'c' AND k.conname IN ('upa_alerta_jurnal_fel', 'upa_alerta_jurnal_forma_cheie'));
    RAISE EXCEPTION '20270101a: CHECK-urile upa_alerta_jurnal (fel / forma_cheie) nu sunt cele din 20261229a; nimic schimbat';
  END IF;
END $pre$;

-- ── lock-urile (punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare; momentul în gazpet.lock_puternic_la pentru LOCK_TINUT) ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270101a: BUGET_LOCK: upa_achizitii / upa_alerta_jurnal ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.upa_achizitii IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.upa_alerta_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270101a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270101a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. upa_achizitii: valoarea fără TVA, starea și data plății ──────────────────────────────────────────────────────────
-- NULL = necompletat (rândurile vechi, Citește Orice, formularul vechi). Plata: 'platita' (cu data) / 'neplatita' (știut: nu se deduce) /
--   NULL (necunoscut: blochează închiderea lunii, L18 — necunoscut ≠ neplătit).
ALTER TABLE public.upa_achizitii ADD COLUMN valoare_fara_tva numeric(12,2);
ALTER TABLE public.upa_achizitii ADD COLUMN data_plata date;
ALTER TABLE public.upa_achizitii ADD COLUMN stare_plata text;
ALTER TABLE public.upa_achizitii ADD CONSTRAINT upa_achizitii_fara_tva_interval
  CHECK (valoare_fara_tva IS NULL OR (valoare_fara_tva > 0 AND valoare_fara_tva <= valoare));
ALTER TABLE public.upa_achizitii ADD CONSTRAINT upa_achizitii_stare_plata
  CHECK ((stare_plata IS NULL AND data_plata IS NULL) OR (stare_plata = 'neplatita' AND data_plata IS NULL)
         OR (stare_plata = 'platita' AND data_plata IS NOT NULL));
COMMENT ON COLUMN public.upa_achizitii.valoare_fara_tva IS 'UPA (20270101a): valoarea facturii FARA TVA (se deduce din contributie); NULL = necompletat.';
COMMENT ON COLUMN public.upa_achizitii.data_plata IS 'UPA (20270101a): data platii catre unitatea protejata (doar cu stare_plata = platita).';
COMMENT ON COLUMN public.upa_achizitii.stare_plata IS 'UPA (20270101a): platita (cu data) / neplatita (nu se deduce) / NULL = necunoscut (luna nu se inchide).';

-- ─── 2. Jurnalul alertei: felul 'calcul' (alerta exactă, cheia calcul:AAAA-LL) lângă cele vechi ─────────────────────────────
ALTER TABLE public.upa_alerta_jurnal DROP CONSTRAINT upa_alerta_jurnal_fel;
ALTER TABLE public.upa_alerta_jurnal DROP CONSTRAINT upa_alerta_jurnal_forma_cheie;
ALTER TABLE public.upa_alerta_jurnal ADD CONSTRAINT upa_alerta_jurnal_fel CHECK (fel = ANY (ARRAY['zilnic'::text, 'inchidere'::text, 'calcul'::text, 'eroare'::text]));
ALTER TABLE public.upa_alerta_jurnal ADD CONSTRAINT upa_alerta_jurnal_forma_cheie CHECK (
    (fel = 'zilnic' AND cheie = 'zilnic:' || to_char(zi, 'YYYY-MM-DD') AND luna = date_trunc('month', zi::timestamp)::date)
    OR (fel = 'inchidere' AND cheie = 'inchidere:' || to_char(luna, 'YYYY-MM') AND luna < date_trunc('month', zi::timestamp)::date)
    OR (fel = 'calcul' AND cheie = 'calcul:' || to_char(luna, 'YYYY-MM') AND luna < date_trunc('month', zi::timestamp)::date)
    OR (fel = 'eroare' AND cheie ~ ('^eroare:' || to_char(zi, 'YYYY-MM-DD') || ':[a-z_]{1,40}$')));

-- ─── 3. Tabelele ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.upa_parametri (
  cheie text NOT NULL,
  de_la date NOT NULL,
  valoare numeric(12,2) NOT NULL,
  sursa text NOT NULL,
  nota text,
  setat_de uuid,
  setat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upa_parametri_pk PRIMARY KEY (cheie, de_la),
  CONSTRAINT upa_parametri_cheie CHECK (cheie = ANY (ARRAY['salariu_minim'::text, 'angajati_handicap'::text, 'report_initial'::text, 'termen_stat_zi'::text])),
  CONSTRAINT upa_parametri_prima_zi CHECK (extract(day FROM de_la) = 1),
  CONSTRAINT upa_parametri_valoare CHECK (valoare >= 0 AND valoare < 10000000
    AND (cheie <> 'salariu_minim' OR valoare > 0) AND (cheie <> 'angajati_handicap' OR valoare = trunc(valoare))
    AND (cheie <> 'termen_stat_zi' OR (valoare = trunc(valoare) AND valoare BETWEEN 1 AND 25))),
  CONSTRAINT upa_parametri_sursa CHECK (sursa = ANY (ARRAY['ecran'::text, 'migrare'::text])),
  CONSTRAINT upa_parametri_autor CHECK ((sursa = 'ecran') = (setat_de IS NOT NULL)),
  CONSTRAINT upa_parametri_nota CHECK (nota IS NULL OR length(nota) <= 300)
);
COMMENT ON TABLE public.upa_parametri IS 'UPA (20270101a): intrarile calculului pe perioade (valabile de la luna randului pana la urmatorul rand al cheii): salariu_minim, angajati_handicap, report_initial (prima luna a calculului), termen_stat_zi (ziua din luna urmatoare pana la care se plateste la stat; fara rand = 25; 1..25). Scris doar prin fn_upa_parametru_seteaza.';

-- corecțiile HR pe interval (ERP-ul nu are istoricul normei, al calității de administrator și al suspendărilor fără cod de pontaj): pentru
--   zilele calendaristice din [de_la, pana_la] ale angajatului (runda 4: exact pe interval), norma (dacă e dată) și administrator (dacă e dat) înlocuiesc valorile de azi,
--   iar suspendat = true scoate zilele din calcul. Fără suprapuneri (impus în RPC, sub lock-ul calculului). Doar owner-ul (date personale HR).
CREATE TABLE public.upa_angajat_perioade (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id integer NOT NULL,
  de_la date NOT NULL,
  pana_la date NOT NULL,
  norma numeric(6,4),
  administrator boolean,
  suspendat boolean NOT NULL DEFAULT false,
  nota text NOT NULL,
  setat_de uuid NOT NULL,
  setat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upa_angajat_perioade_interval CHECK (pana_la >= de_la AND pana_la - de_la <= 3660),
  CONSTRAINT upa_angajat_perioade_norma CHECK (norma IS NULL OR (norma > 0 AND norma <= 1)),
  CONSTRAINT upa_angajat_perioade_ceva CHECK (norma IS NOT NULL OR administrator IS NOT NULL OR suspendat),
  CONSTRAINT upa_angajat_perioade_nota CHECK (nota ~ '[^[:space:]]' AND length(nota) <= 300)
);
CREATE INDEX upa_angajat_perioade_angajat_idx ON public.upa_angajat_perioade (employee_id, de_la);
COMMENT ON TABLE public.upa_angajat_perioade IS 'UPA (20270101a): corectii HR pe interval pentru numarul mediu de angajati (norma / administrator / suspendare fara cod de pontaj). Doar owner, prin fn_upa_perioada_adauga / _sterge.';

CREATE TABLE public.upa_calcul_lunar (
  luna date PRIMARY KEY,
  zile_luna integer NOT NULL,
  nr_angajati integer NOT NULL,
  nma numeric(10,2) NOT NULL,
  posturi numeric(10,2) NOT NULL,
  angajati_handicap numeric(12,2) NOT NULL,
  locuri numeric(10,2) NOT NULL,
  salariu_minim numeric(12,2) NOT NULL,
  suma_datorata numeric(12,2) NOT NULL,
  jumatate numeric(12,2) NOT NULL,
  achizitii_fara_tva numeric(12,2) NOT NULL,
  nr_achizitii integer NOT NULL,
  report_intrat numeric(12,2) NOT NULL,
  deducere numeric(12,2) NOT NULL,
  de_plata numeric(12,2) NOT NULL,
  report_iesit numeric(12,2) NOT NULL,
  termen_stat date NOT NULL,
  avertismente text[] NOT NULL DEFAULT '{}',
  versiune text NOT NULL,
  amprenta_angajati text NOT NULL,
  amprenta_achizitii text NOT NULL,
  amprenta text NOT NULL,
  confirmat_de uuid NOT NULL,
  inchis_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upa_calcul_lunar_prima_zi CHECK (extract(day FROM luna) = 1),
  CONSTRAINT upa_calcul_lunar_valori CHECK (zile_luna BETWEEN 28 AND 31 AND nr_angajati >= 0 AND nma >= 0 AND salariu_minim > 0
    AND angajati_handicap >= 0 AND achizitii_fara_tva >= 0 AND nr_achizitii >= 0 AND report_intrat >= 0),
  CONSTRAINT upa_calcul_lunar_regula CHECK (posturi = CASE WHEN nma < 50 THEN 0 ELSE round(nma * 0.04, 2) END
    AND locuri = greatest(posturi - angajati_handicap, 0) AND suma_datorata = round(locuri * salariu_minim, 2)
    AND jumatate = trunc(suma_datorata / 2, 2) AND deducere = least(achizitii_fara_tva + report_intrat, jumatate)
    AND de_plata = suma_datorata - deducere AND report_iesit = achizitii_fara_tva + report_intrat - deducere),
  CONSTRAINT upa_calcul_lunar_termen CHECK (termen_stat > (luna + interval '1 month' - interval '1 day')::date AND termen_stat < (luna + interval '2 months')::date)
);
COMMENT ON TABLE public.upa_calcul_lunar IS 'UPA (20270101a): calculul EXACT al unei luni, inchis o data de owner pe amprenta datelor (NMA, contributia integrala, achizitii fara TVA, report, deducere, de plata la stat si termenul). Nemodificabil.';

CREATE TABLE public.upa_calcul_angajat (
  luna date NOT NULL REFERENCES public.upa_calcul_lunar(luna),
  employee_id integer NOT NULL,
  zile_calcul integer NOT NULL,
  zile_cfs integer NOT NULL,
  zile_suspendare integer NOT NULL,
  zile_administrator integer NOT NULL,
  zile_numarate integer NOT NULL,
  contributie numeric(12,4) NOT NULL,
  CONSTRAINT upa_calcul_angajat_pk PRIMARY KEY (luna, employee_id),
  CONSTRAINT upa_calcul_angajat_valori CHECK (zile_calcul BETWEEN 1 AND 31 AND zile_cfs >= 0 AND zile_suspendare >= 0 AND zile_administrator >= 0
    AND zile_numarate >= 0
    AND zile_cfs + zile_suspendare + zile_administrator + zile_numarate = zile_calcul
    AND contributie >= 0 AND contributie <= zile_numarate)
);
COMMENT ON TABLE public.upa_calcul_angajat IS 'UPA (20270101a): detaliul NMA al unei luni inchise, pe angajat (zile pe categorii, contributia = suma normelor zilelor numarate). Citire doar owner; nemodificabil.';

-- instantaneele nu se schimbă pe nicio cale (L07): triggerul de nemodificare din 20261229a (aceeași regulă)
CREATE TRIGGER trg_upa_calcul_lunar_nemodificabil BEFORE UPDATE OR DELETE ON public.upa_calcul_lunar
  FOR EACH ROW EXECUTE FUNCTION public.fn_upa_luna_inchisa_nemodificabil();
CREATE TRIGGER trg_upa_calcul_angajat_nemodificabil BEFORE UPDATE OR DELETE ON public.upa_calcul_angajat
  FOR EACH ROW EXECUTE FUNCTION public.fn_upa_luna_inchisa_nemodificabil();

-- ─── 4. Intrările calculului ─────────────────────────────────────────────────────────────────────────────────────────────
-- valoarea unei chei în luna dată = ultimul rând cu de_la <= luna; NULL = neînregistrat (necunoscut, nu 0 — L18)
CREATE FUNCTION public.fn_upa_parametru_la(p_cheie text, p_luna date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT p.valoare FROM public.upa_parametri p
   WHERE p.cheie = p_cheie AND p.de_la <= date_trunc('month', p_luna::timestamp)::date ORDER BY p.de_la DESC LIMIT 1
$f$;
-- prima lună a calculului (rândul report_initial); NULL = nestabilită
CREATE FUNCTION public.fn_upa_inceput_calcul() RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT min(p.de_la) FROM public.upa_parametri p WHERE p.cheie = 'report_initial'
$f$;
-- cel mai devreme se poate închide din ziua 13 a lunii următoare (corecturile libere țin până pe 12: src/pontajLunaInchisa.js); data NU
--   dovedește completitudinea: aceea o dau blocajele (pontaj pe fiecare zi lucrătoare, date de contract) + confirmarea owner-ului
CREATE FUNCTION public.fn_upa_pontaj_inchis(p_luna date, p_azi date) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT p_azi > (date_trunc('month', p_luna::timestamp) + interval '1 month' + interval '11 days')::date
$f$;
-- zi lucrătoare = luni–vineri și nu e sărbătoare legală (calendar_days 'legal'); definiția unică pentru NMA și termene (L19)
CREATE FUNCTION public.fn_upa_zi_lucratoare(p date) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT extract(isodow FROM p) < 6 AND NOT EXISTS (SELECT 1 FROM public.calendar_days c WHERE c.date = p AND c.type = 'legal')
$f$;
-- câte dintre sărbătorile legale ale anului (Codul muncii art. 139) LIPSESC din calendar_days: > 0 = calendarul anului nu e încărcat, deci
--   zilele nelucrătoare nu se cunosc (blocaj calendar_incomplet, L12: numitor determinist). Lista = datele fixe + sărbătorile MOBILE care
--   cad în zile lucrătoare (runda 3, P2): Vinerea Mare, a doua zi de Paște, a doua zi de Rusalii (Paștele ortodox = algoritmul iulian
--   Meeus + 13 zile, valabil 1900–2099; în afara intervalului anul nu se poate verifica -> 99 = blocaj). Duminicile de Paște / Rusalii nu
--   se cer: sunt nelucrătoare oricum, lipsa lor nu schimbă calculul. Datele care coincid (Rusalii = 1 iunie) se numără o dată.
CREATE FUNCTION public.fn_upa_calendar_lipsa(p_an integer) RETURNS integer
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  WITH j AS (SELECT (19 * (p_an % 19) + 15) % 30 AS d, p_an % 4 AS a, p_an % 7 AS b),
  p AS (SELECT make_date(p_an, (j.d + (2 * j.a + 4 * j.b - j.d + 34) % 7 + 114) / 31, (j.d + (2 * j.a + 4 * j.b - j.d + 34) % 7 + 114) % 31 + 1) + 13 AS paste FROM j),
  z AS (SELECT make_date(p_an, split_part(m.md, '-', 1)::integer, split_part(m.md, '-', 2)::integer) AS zi
          FROM unnest(ARRAY['01-01', '01-02', '01-06', '01-07', '01-24', '05-01', '06-01', '08-15', '11-30', '12-01', '12-25', '12-26']) AS m(md)
        UNION SELECT p.paste - 2 FROM p UNION SELECT p.paste + 1 FROM p UNION SELECT p.paste + 50 FROM p)
  SELECT CASE WHEN p_an IS NULL OR p_an < 1900 OR p_an > 2099 THEN 99
              ELSE (SELECT count(*)::integer FROM z WHERE NOT EXISTS (SELECT 1 FROM public.calendar_days c WHERE c.date = z.zi AND c.type = 'legal')) END
$f$;
-- termenul plății la stat pentru luna dată: ziua 'termen_stat_zi' a lunii următoare (upa_parametri, pe perioade — valabilă de la luna rândului
--   până la următorul rând; FĂRĂ rând = 25, Codul de procedură fiscală art. 155 alin. (1)); dacă e nelucrătoare -> prima zi lucrătoare
--   următoare (regula generală a termenelor, art. 75). Runda 6 (experta contabilă, 25.11.2026): pentru noiembrie 2026 termenul e 21.12.2026 —
--   rândul 21 de la 2026-11-01 și 25 de la 2026-12-01 (secțiunea 13); dacă 21 e regula fiecărui decembrie sau doar o excepție NU se știe încă,
--   de aceea ziua e valoare pe perioade (schimbabilă din ecran), nu o regulă în cod. Valoarea e 1..25 (CHECK + RPC): cu zilele nelucrătoare
--   de după, termenul rămâne în luna următoare (CHECK upa_calcul_lunar_termen). Rândurile din afara acestor limite = eroare, nu o presupunere (L18).
CREATE FUNCTION public.fn_upa_termen_stat(p_luna date) RETURNS date
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v_t date; v_n integer := 0; v_zi numeric;
BEGIN
  IF p_luna IS NULL THEN RETURN NULL; END IF;
  v_zi := coalesce(public.fn_upa_parametru_la('termen_stat_zi', p_luna), 25);
  IF v_zi <> trunc(v_zi) OR v_zi < 1 OR v_zi > 25 THEN
    RAISE EXCEPTION 'upa: termen_stat_zi invalid (%): zi intreaga intre 1 si 25', v_zi USING ERRCODE = '22023';
  END IF;
  v_t := (date_trunc('month', p_luna::timestamp) + interval '1 month')::date + (v_zi::integer - 1);
  WHILE NOT public.fn_upa_zi_lucratoare(v_t) LOOP
    v_t := v_t + 1; v_n := v_n + 1;
    IF v_n > 10 THEN RAISE EXCEPTION 'upa: calendarul nu are zile lucratoare dupa termen' USING ERRCODE = '22023'; END IF;
  END LOOP;
  RETURN v_t;
END $f$;
-- codul de pontaj -> cauza excluderii: CFS ('CFP') sau suspendare (CM / BO / BP / AM = incapacitate temporară de muncă, M = maternitate —
--   Codul muncii art. 50; N = absență nemotivată — runda 6, experta contabilă 25.11.2026: nu e zi lucrată, se scade ca suspendările);
--   NULL = ziua se numără (CO, O, PRM, PRB, LL, ore lucrate)
CREATE FUNCTION public.fn_upa_cauza_cod(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN upper(btrim(p)) = 'CFP' THEN 'cfs' WHEN upper(btrim(p)) IN ('CM', 'BO', 'BP', 'AM', 'M', 'N') THEN 'suspendare' END
$f$;

-- NMA pe angajat, pe zile calendaristice (vezi formula din antet). Intră angajații activi și cei cu dată de încetare, cu contractul suprapus
--   pe lună; cei inactivi FĂRĂ dată de încetare nu au o perioadă cunoscută (blocaj în fn_upa_calcul_la dacă au pontaj).
-- Runda 4 (răspunsul expertului, 24.11.2026): fiecare zi se judecă pe PERIOADA actului care o acoperă, nu prin ziua lucrătoare dinainte:
--   * contractul: zilele dintre hire_date și termination_date, ambele incluse (angajat sâmbătă = sâmbăta se numără);
--   * corecția HR (upa_angajat_perioade: normă / administrator / suspendat) se aplică exact pe zilele intervalului ei;
--   * codul din pontaj al zilei (și pe weekend / sărbătoare, dacă e trecut acolo): CFS (CFP) / suspendare (CM, BO, BP, AM, M; runda 6: și N,
--     absența nemotivată) scot ziua;
--   * o zi nelucrătoare FĂRĂ informație (fără rând în pontaj, sau cu un cod care nu spune nimic despre suspendare: CO, LL, O ... pe o zi
--     liberă) e înăuntrul unei suspendări doar dacă cea mai apropiată zi cu informație dinainte ȘI cea de după (în contract, fereastra
--     luna ± 14 zile) au ACELAȘI cod de CFS / suspendare (sau aceeași corecție HR): weekendul dintre CM vineri și CM luni e suspendat, iar
--     weekendul de după un CM terminat vineri (luni lucrează) se numără. Dacă după ea nu mai există nicio zi a contractului (contractul
--     se termină în weekend), suspendarea DIN PONTAJ se consideră continuată până la capăt (fără dovada reluării).
--   * runda 5 (Jakarinos r4, P1-1): corecția HR are intervalul ei explicit, deci nu se prelungește NICIODATĂ peste zilele libere din afara
--     lui (nici când contractul se încheie în weekend: suspendare HR 9–13.11 + încetare duminică 15.11 = 5 zile, nu 7). Zilele libere de
--     lângă o corecție HR nu intră nici în avertismentul „lângă o suspendare” (intervalul e cunoscut, nu e nimic de verificat).
--   * runda 5 (Jakarinos r4, P1-2): zi liberă fără informație urmată de o zi lucrătoare FĂRĂ pontaj (și în luna următoare, de ex. 2.12
--     pentru 28–30.11) = fără pontaj, ORICARE ar fi starea dinainte (și după o vineri lucrată: actul poate începe în weekend). La fel, zi
--     liberă după o zi lucrătoare fără pontaj. Altfel (contract activ, fără suspendare în jur) ziua liberă se numără.
-- zile_fara_pontaj = zilele lucrătoare fără rând în pontaj de care depinde luna: ale lunii și cele din afara ei (dinainte / de după) de care
--   depind zilele libere ale lunii; fiecare zi o singură dată (r = ziua însăși / ziua dinainte, r_urm = ziua de după). Se numără în
--   previziune, dar blochează închiderea. zile_libere_langa_suspendare = zilele libere fără informație numărate active la capătul unei
--   suspendări / CFS din pontaj (actul le-ar putea acoperi: avertisment, nu blocaj; dacă le acoperă, codul se trece și pe ele în pontaj sau
--   printr-o corecție HR).
CREATE FUNCTION public.fn_upa_nma_angajati(p_luna date)
RETURNS TABLE (employee_id integer, zile_calcul integer, zile_cfs integer, zile_suspendare integer, zile_administrator integer,
               zile_numarate integer, contributie numeric, zile_fara_pontaj integer, fara_data_angajare boolean,
               fara_norma boolean, corectii boolean, zile_libere_langa_suspendare integer)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  WITH z AS (SELECT date_trunc('month', p_luna::timestamp)::date AS l0,
                    (date_trunc('month', p_luna::timestamp) + interval '1 month' - interval '1 day')::date AS l1),
  c AS (SELECT g::date AS d, public.fn_upa_zi_lucratoare(g::date) AS lucr FROM z, generate_series((z.l0 - 14)::timestamp, (z.l1 + 14)::timestamp, interval '1 day') AS g),
  e AS (SELECT em.id::integer AS id, em.hire_date, em.termination_date, em.procent_ocupare,
               EXISTS (SELECT 1 FROM public.hr_decizii_semnatari s
                        WHERE s.employee_id = em.id AND s.activ IS TRUE AND lower(btrim(s.calitate)) = 'administrator') AS admin
          FROM public.employees em, z
         WHERE (em.active IS TRUE OR em.termination_date IS NOT NULL)
           AND (em.hire_date IS NULL OR em.hire_date <= z.l1) AND (em.termination_date IS NULL OR em.termination_date >= z.l0)),
  -- fiecare zi a contractului din fereastră, cu ce se știe despre ea: st = administrator / suspendare / cfs / numarat / fara_pontaj, NULL = zi
  --   liberă fără informație; cod = identitatea actului (codul din pontaj sau 'HR' + id-ul corecției) pentru continuitatea peste zilele libere
  s AS (
    SELECT e.id, c.d, c.lucr, e.hire_date IS NULL AS fa, o.id AS oid, coalesce(o.norma, e.procent_ocupare / 100.0) AS norma,
           CASE WHEN o.suspendat IS TRUE THEN 'HR' || o.id ELSE nullif(upper(btrim(p.norma)), '') END AS cod,
           CASE
             WHEN coalesce(o.administrator, e.admin) THEN 'administrator'
             WHEN o.suspendat IS TRUE THEN 'suspendare'
             WHEN public.fn_upa_cauza_cod(p.norma) IS NOT NULL THEN public.fn_upa_cauza_cod(p.norma)
             WHEN p.employee_id IS NOT NULL AND (c.lucr OR nullif(btrim(p.norma), '') IS NULL) THEN 'numarat'
             WHEN c.lucr THEN 'fara_pontaj'
           END AS st
      FROM e CROSS JOIN z CROSS JOIN c
      LEFT JOIN LATERAL (SELECT o.id, o.norma, o.administrator, o.suspendat FROM public.upa_angajat_perioade o
                          WHERE o.employee_id = e.id AND c.d BETWEEN o.de_la AND o.pana_la ORDER BY o.de_la LIMIT 1) o ON true
      LEFT JOIN public.pontaj_records p ON p.employee_id = e.id AND p.date = c.d
     WHERE c.d >= coalesce(e.hire_date, z.l0) AND c.d <= coalesce(e.termination_date, 'infinity'::date)),
  -- cea mai apropiată zi cu informație dinainte / de după (în contract și în fereastră)
  w AS (
    SELECT s.*,
           max(s.d) FILTER (WHERE s.st IS NOT NULL) OVER (PARTITION BY s.id ORDER BY s.d ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS d_ant,
           min(s.d) FILTER (WHERE s.st IS NOT NULL) OVER (PARTITION BY s.id ORDER BY s.d ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING) AS d_urm
      FROM s),
  y AS (
    SELECT w.id, w.d, w.fa, w.oid, w.norma, w.st, w.d_ant, w.d_urm, a.st AS st_ant, a.cod AS cod_ant, u.st AS st_urm, u.cod AS cod_urm
      FROM w CROSS JOIN z
      LEFT JOIN s a ON a.id = w.id AND a.d = w.d_ant
      LEFT JOIN s u ON u.id = w.id AND u.d = w.d_urm
     WHERE w.d BETWEEN z.l0 AND z.l1),
  x AS (
    SELECT y.id, y.d, y.fa, y.oid IS NOT NULL AS cor, y.norma,
           CASE
             WHEN y.st IS NOT NULL THEN y.st
             WHEN y.st_urm = 'fara_pontaj' THEN 'fara_pontaj'
             WHEN y.st_ant = 'fara_pontaj' THEN 'fara_pontaj'
             WHEN y.st_ant IN ('cfs', 'suspendare') AND y.cod_ant NOT LIKE 'HR%' AND (y.d_urm IS NULL OR y.cod_urm = y.cod_ant) THEN y.st_ant
             ELSE 'numarat'
           END AS cat,
           CASE WHEN y.st IS NOT NULL THEN y.d WHEN y.st_ant = 'fara_pontaj' THEN y.d_ant END AS r,
           CASE WHEN y.st IS NULL AND y.st_urm = 'fara_pontaj' THEN y.d_urm END AS r_urm,
           (y.st IS NULL AND ((y.st_ant IN ('cfs', 'suspendare') AND y.cod_ant NOT LIKE 'HR%')
                              OR (y.st_urm IN ('cfs', 'suspendare') AND y.cod_urm NOT LIKE 'HR%'))) AS langa
      FROM y)
  SELECT x.id, count(*)::integer, (count(*) FILTER (WHERE x.cat = 'cfs'))::integer, (count(*) FILTER (WHERE x.cat = 'suspendare'))::integer,
         (count(*) FILTER (WHERE x.cat = 'administrator'))::integer,
         (count(*) FILTER (WHERE x.cat IN ('numarat', 'fara_pontaj')))::integer,
         (coalesce(sum(coalesce(x.norma, 1)) FILTER (WHERE x.cat IN ('numarat', 'fara_pontaj')), 0))::numeric(12,4),
         (SELECT count(DISTINCT q.r)::integer FROM unnest(array_agg(x.r) FILTER (WHERE x.cat = 'fara_pontaj')
                                                          || array_agg(x.r_urm) FILTER (WHERE x.cat = 'fara_pontaj')) AS q(r)),
         bool_or(x.fa), coalesce(bool_or(x.norma IS NULL) FILTER (WHERE x.cat IN ('numarat', 'fara_pontaj')), false), bool_or(x.cor),
         (count(*) FILTER (WHERE x.langa AND x.cat = 'numarat'))::integer
    FROM x GROUP BY x.id ORDER BY x.id
$f$;
-- amprenta unui rând de detaliu (aceeași formă pentru calcul și pentru rândurile scrise la închidere, L19)
CREATE FUNCTION public.fn_upa_rand_amprenta(p_id integer, p_zc integer, p_cfs integer, p_susp integer, p_adm integer, p_num integer,
                                            p_contr numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT concat_ws(':', p_id, p_zc, p_cfs, p_susp, p_adm, p_num, p_contr::numeric(12,4)::text)
$f$;
-- amprenta achizițiilor lunii (id, luna, valoarea fără TVA, starea și data plății): închiderea cere aceeași amprentă ca pe ecran
CREATE FUNCTION public.fn_upa_amprenta_achizitii(p_luna date) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT md5(coalesce(string_agg(concat_ws(':', a.id, a.luna, coalesce(a.valoare_fara_tva::text, '-'), coalesce(a.stare_plata, '-'),
                                           coalesce(a.data_plata::text, '-')), ',' ORDER BY a.id), ''))
    FROM public.upa_achizitii a
   WHERE a.luna >= date_trunc('month', p_luna::timestamp)::date
     AND a.luna <= (date_trunc('month', p_luna::timestamp) + interval '1 month' - interval '1 day')::date
$f$;

-- ─── 5. Calculul unei luni (definiția unică, L19) ─────────────────────────────────────────────────────────────────────────
-- jsonb: stare 'definitiv' (rândul închis + achizitii_acum + surse_schimbate: ce s-a schimbat în surse după închidere) | 'previziune' |
--   'in_afara_calculului' (înaintea primei luni). blocaje = ce oprește închiderea; avertismente = ce se ia în seamă, dar nu oprește.
--   Achizițiile: cât luna e în curs, cele neplătite / cu plata necunoscută se numără (previziune: plata se presupune la termen); după ultima
--   zi se deduc DOAR cele plătite până la ultima zi; 'neplatita' și plătită după termen ies din deducere (avertisment); plata necunoscută
--   și, pentru cele plătite la termen, valoarea fără TVA lipsă = blocaj. Reportul intrat: luna anterioară închisă; la prima lună =
--   report_initial; altfel = previziunea ei (cel mult 2 niveluri, p_adancime), cu blocajul luna_anterioara_neinchisa.
--   amprenta = md5 pe intrări (detaliul pe angajat, achizițiile, parametrii, reportul, ZIUA configurată a termenului și termenul rezultat,
--   versiunea): închiderea cere exact valoarea văzută. Ziua configurată intră separat (Jakarinos r6, P2): 20 -> 21 pentru ianuarie 2027 dă
--   aceeași dată (22.02.2027), dar parametrul s-a schimbat după afișare -> 40001.
-- fn_upa_calcul_previziune_la = calculul din sursele de ACUM, și pentru o lună deja închisă (runda 3: închiderea îl reverifică după scriere,
--   iar luna închisă îl compară cu instantaneul); fn_upa_calcul_la = instantaneul dacă luna e închisă, altfel previziunea.
CREATE FUNCTION public.fn_upa_calcul_previziune_la(p_luna date, p_azi date, p_adancime integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v_l date; v_l1 date; v_start date; v_zile integer; v_sum numeric; v_n integer; v_fa integer; v_fn integer;
        v_fp integer; v_cor integer; v_lg integer; v_amp_ang text; v_amp_ach text; v_inact integer; v_nma numeric; v_sal numeric; v_hand numeric; v_post numeric;
        v_loc numeric; v_d numeric; v_jum numeric; v_a numeric; v_na integer; v_astept numeric; v_fstare integer; v_nepl integer; v_tarziu integer;
        v_ftva integer; v_ftva_t integer; v_rin numeric; v_ant jsonb; v_ded numeric; v_plata numeric; v_rout numeric; v_ramas numeric;
        v_bl text[] := '{}'; v_av text[] := '{}'; v_acum numeric; v_inchis boolean; v_final boolean; v_termen date; v_tz numeric; v_cal integer;
        v_vers constant text := 'v2-20270101a';
BEGIN
  IF p_luna IS NULL OR p_azi IS NULL THEN RAISE EXCEPTION 'upa: luna si ziua sunt obligatorii' USING ERRCODE = '22023'; END IF;
  v_l := date_trunc('month', p_luna::timestamp)::date;
  v_l1 := (v_l + interval '1 month' - interval '1 day')::date;
  SELECT coalesce(sum(a.valoare_fara_tva), 0) INTO v_acum FROM public.upa_achizitii a WHERE a.luna >= v_l AND a.luna <= v_l1;
  v_amp_ach := public.fn_upa_amprenta_achizitii(v_l);
  v_start := public.fn_upa_inceput_calcul();
  IF v_start IS NULL OR v_l < v_start THEN
    RETURN jsonb_build_object('luna', v_l, 'stare', 'in_afara_calculului', 'poate_inchide', false, 'termen_upa', v_l1,
      'termen_stat', public.fn_upa_termen_stat(v_l), 'achizitii_acum', v_acum,
      'blocaje', to_jsonb(ARRAY[CASE WHEN v_start IS NULL THEN 'fara_inceput_calcul' ELSE 'inainte_de_inceput' END]), 'avertismente', '[]'::jsonb);
  END IF;
  v_inchis := public.fn_upa_pontaj_inchis(v_l, p_azi);
  v_final := p_azi > v_l1;
  v_zile := v_l1 - v_l + 1;
  -- calendarul (zilele nelucrătoare ale lunii și ale termenului): fără el, zilele de referință și termenul nu se cunosc
  v_cal := public.fn_upa_calendar_lipsa(extract(year FROM v_l)::integer);
  IF v_cal > 0 THEN v_bl := v_bl || ('calendar_incomplet:' || extract(year FROM v_l)::integer); END IF;
  IF extract(month FROM v_l) = 12 AND public.fn_upa_calendar_lipsa(extract(year FROM v_l)::integer + 1) > 0 THEN
    v_bl := v_bl || ('calendar_incomplet:' || (extract(year FROM v_l)::integer + 1));
  END IF;
  v_termen := public.fn_upa_termen_stat(v_l);
  v_tz := public.fn_upa_parametru_la('termen_stat_zi', v_l);
  -- NMA (o singură citire a detaliului: sumele și amprenta din aceleași rânduri)
  SELECT coalesce(sum(x.contributie), 0), count(*)::integer, (count(*) FILTER (WHERE x.fara_data_angajare))::integer,
         (count(*) FILTER (WHERE x.fara_norma))::integer, coalesce(sum(x.zile_fara_pontaj), 0)::integer, (count(*) FILTER (WHERE x.corectii))::integer,
         (count(*) FILTER (WHERE x.zile_libere_langa_suspendare > 0))::integer,
         md5(coalesce(string_agg(public.fn_upa_rand_amprenta(x.employee_id, x.zile_calcul, x.zile_cfs, x.zile_suspendare, x.zile_administrator,
                                   x.zile_numarate, x.contributie), ',' ORDER BY x.employee_id), ''))
    INTO v_sum, v_n, v_fa, v_fn, v_fp, v_cor, v_lg, v_amp_ang FROM public.fn_upa_nma_angajati(v_l) x;
  v_nma := round(v_sum / v_zile, 2);
  SELECT count(*)::integer INTO v_inact FROM public.employees em
   WHERE em.active IS NOT TRUE AND em.termination_date IS NULL
     AND EXISTS (SELECT 1 FROM public.pontaj_records p WHERE p.employee_id = em.id AND p.date BETWEEN v_l AND v_l1);
  -- date de contract necunoscute = blocaj (L18: necunoscut nu se înlocuiește cu o valoare)
  IF v_fa > 0 THEN v_bl := v_bl || ('angajati_fara_data_angajarii:' || v_fa); END IF;
  IF v_fn > 0 THEN v_bl := v_bl || ('angajati_fara_norma:' || v_fn); END IF;
  IF v_inact > 0 THEN v_bl := v_bl || ('inactivi_fara_data_incetarii_cu_pontaj:' || v_inact); END IF;
  IF v_final THEN
    IF v_fp > 0 THEN v_bl := v_bl || ('pontaj_lipsa:' || v_fp); END IF;
  ELSE
    v_av := v_av || 'pontaj_in_curs'::text;
  END IF;
  IF v_cor > 0 THEN v_av := v_av || ('angajati_cu_corectii:' || v_cor); END IF;
  -- runda 4: zilele libere de la capătul unei suspendări / CFS se numără active (pontajul nu arată actul pe ele): omul verifică actul
  IF v_lg > 0 THEN v_av := v_av || ('suspendari_langa_zile_libere:' || v_lg); END IF;
  IF NOT v_inchis THEN v_av := v_av || 'pontaj_neinchis'::text; END IF;
  -- intrările pe perioade și formula (posturi cu 2 zecimale, contribuția integrală, deducerea maximă = jumătate)
  v_sal := public.fn_upa_parametru_la('salariu_minim', v_l);
  v_hand := public.fn_upa_parametru_la('angajati_handicap', v_l);
  IF v_sal IS NULL THEN v_bl := v_bl || 'fara_salariu_minim'::text; END IF;
  IF v_hand IS NULL THEN v_bl := v_bl || 'fara_nr_handicap'::text; END IF;
  IF v_sal IS NOT NULL AND v_hand IS NOT NULL THEN
    -- pragul (expertul, 24.11.2026): obligația există doar dacă NMA >= 50, pe NMA-ul DEJA rotunjit la 2 zecimale (49,99 -> 0;
    --   50,00 -> 2,00 posturi; 49,995 se rotunjește la 50,00, deci obligație); același prag în CHECK-ul upa_calcul_lunar_regula
    v_post := CASE WHEN v_nma < 50 THEN 0 ELSE round(v_nma * 0.04, 2) END;
    IF v_nma < 50 THEN v_av := v_av || 'sub_50_angajati'::text; END IF;
    v_loc := greatest(v_post - v_hand, 0);
    v_d := round(v_loc * v_sal, 2);
    v_jum := trunc(v_d / 2, 2);
  END IF;
  -- achizițiile lunii (fără TVA)
  SELECT count(*)::integer, (count(*) FILTER (WHERE a.stare_plata IS NULL))::integer, (count(*) FILTER (WHERE a.stare_plata = 'neplatita'))::integer,
         (count(*) FILTER (WHERE a.stare_plata = 'platita' AND a.data_plata > v_l1))::integer,
         (count(*) FILTER (WHERE a.valoare_fara_tva IS NULL AND a.stare_plata = 'platita' AND a.data_plata <= v_l1))::integer,
         (count(*) FILTER (WHERE a.valoare_fara_tva IS NULL AND (a.stare_plata IS DISTINCT FROM 'platita' OR a.data_plata <= v_l1)))::integer,
         coalesce(sum(a.valoare_fara_tva) FILTER (WHERE a.stare_plata = 'platita' AND a.data_plata <= v_l1), 0),
         coalesce(sum(a.valoare_fara_tva) FILTER (WHERE a.stare_plata IS DISTINCT FROM 'platita'), 0)
    INTO v_na, v_fstare, v_nepl, v_tarziu, v_ftva, v_ftva_t, v_a, v_astept
    FROM public.upa_achizitii a WHERE a.luna >= v_l AND a.luna <= v_l1;
  IF v_final THEN
    IF v_fstare > 0 THEN v_bl := v_bl || ('achizitii_fara_stare_plata:' || v_fstare); END IF;
    IF v_ftva > 0 THEN v_bl := v_bl || ('achizitii_fara_tva:' || v_ftva); END IF;
    IF v_nepl > 0 THEN v_av := v_av || ('achizitii_neplatite_excluse:' || v_nepl); END IF;
  ELSE
    IF v_ftva_t > 0 THEN v_av := v_av || ('achizitii_fara_tva:' || v_ftva_t); END IF;
    IF v_fstare + v_nepl > 0 THEN v_av := v_av || ('achizitii_neplatite:' || (v_fstare + v_nepl)); END IF;
    v_a := v_a + v_astept;
  END IF;
  IF v_tarziu > 0 THEN v_av := v_av || ('achizitii_platite_dupa_termen:' || v_tarziu); END IF;
  -- reportul intrat
  IF v_l = v_start THEN
    v_rin := public.fn_upa_parametru_la('report_initial', v_l);
  ELSE
    SELECT c.report_iesit INTO v_rin FROM public.upa_calcul_lunar c WHERE c.luna = (v_l - interval '1 month')::date;
    IF NOT FOUND THEN
      v_bl := v_bl || 'luna_anterioara_neinchisa'::text;
      v_rin := NULL;
      IF p_adancime < 2 THEN
        v_ant := public.fn_upa_calcul_la((v_l - interval '1 month')::date, p_azi, p_adancime + 1);
        v_rin := (v_ant ->> 'report_iesit')::numeric;
        IF v_rin IS NOT NULL THEN v_av := v_av || 'report_din_previziune'::text; END IF;
      END IF;
      IF v_rin IS NULL THEN v_bl := v_bl || 'report_necunoscut'::text; END IF;
    END IF;
  END IF;
  IF v_d IS NOT NULL AND v_rin IS NOT NULL THEN
    v_ded := least(v_a + v_rin, v_jum);
    v_plata := v_d - v_ded;
    v_rout := v_a + v_rin - v_ded;
    v_ramas := greatest(v_jum - v_rin - v_a, 0);
  END IF;
  RETURN jsonb_build_object('luna', v_l, 'stare', 'previziune', 'pontaj_inchis', v_inchis,
    'poate_inchide', v_inchis AND v_final AND cardinality(v_bl) = 0 AND v_ded IS NOT NULL,
    'zile_luna', v_zile, 'nr_angajati', v_n, 'nma', v_nma, 'posturi', v_post, 'salariu_minim', v_sal, 'angajati_handicap', v_hand, 'locuri', v_loc,
    'suma_datorata', v_d, 'jumatate', v_jum, 'achizitii_fara_tva', v_a, 'nr_achizitii', v_na, 'achizitii_neplatite', v_astept,
    'achizitii_acum', v_acum, 'report_intrat', v_rin, 'deducere', v_ded, 'de_plata', v_plata, 'report_iesit', v_rout,
    'ramas_de_cumparat', v_ramas, 'termen_upa', v_l1, 'termen_stat', v_termen, 'zile_fara_pontaj', v_fp,
    'blocaje', to_jsonb(v_bl), 'avertismente', to_jsonb(v_av), 'versiune', v_vers,
    'amprenta_angajati', v_amp_ang, 'amprenta_achizitii', v_amp_ach,
    'amprenta', md5(concat_ws('|', v_amp_ang, v_amp_ach, coalesce(v_sal::text, '-'), coalesce(v_hand::text, '-'), coalesce(v_rin::text, '-'),
                              coalesce(v_tz::text, '-'), v_termen::text, v_vers)));
END $f$;
-- luna închisă = instantaneul + surse_schimbate: ce arată ACUM sursele față de închidere (detaliul pe angajat, achizițiile) și dacă datele
--   lunii mai sunt complete (runda 3, P1: o zi de pontaj ștearsă după închidere se numără la fel ca una pontată, deci se semnalează din
--   blocajele calculului de acum: pontaj lipsă, contract fără dată / normă, inactiv fără dată, calendar incomplet)
CREATE FUNCTION public.fn_upa_calcul_la(p_luna date, p_azi date, p_adancime integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v_l date; v_s public.upa_calcul_lunar; v_p jsonb; v_bl text[];
BEGIN
  IF p_luna IS NULL OR p_azi IS NULL THEN RAISE EXCEPTION 'upa: luna si ziua sunt obligatorii' USING ERRCODE = '22023'; END IF;
  v_l := date_trunc('month', p_luna::timestamp)::date;
  v_p := public.fn_upa_calcul_previziune_la(v_l, p_azi, p_adancime);
  SELECT * INTO v_s FROM public.upa_calcul_lunar c WHERE c.luna = v_l;
  IF NOT FOUND THEN RETURN v_p; END IF;
  v_bl := ARRAY(SELECT jsonb_array_elements_text(v_p -> 'blocaje'));
  RETURN to_jsonb(v_s) || jsonb_build_object('stare', 'definitiv', 'pontaj_inchis', true, 'poate_inchide', false,
    'ramas_de_cumparat', 0, 'termen_upa', (v_l + interval '1 month' - interval '1 day')::date, 'achizitii_acum', v_p -> 'achizitii_acum',
    'surse_schimbate', jsonb_build_object(
      'angajati', (v_p ->> 'amprenta_angajati') IS DISTINCT FROM v_s.amprenta_angajati
                  OR EXISTS (SELECT 1 FROM unnest(v_bl) AS b(b) WHERE b.b ~ '^(pontaj_lipsa|angajati_fara_|inactivi_fara_|calendar_incomplet)'),
      'achizitii', (v_p ->> 'amprenta_achizitii') IS DISTINCT FROM v_s.amprenta_achizitii,
      'complet', (v_p ->> 'poate_inchide')::boolean IS TRUE, 'blocaje_acum', v_p -> 'blocaje'),
    'blocaje', '[]'::jsonb, 'avertismente', to_jsonb(v_s.avertismente));
END $f$;

-- ─── 6. Situația (lunile + luna curentă cu in_alerta: SINGURA definiție a alertei, folosită și de rezervare) ─────────────────
-- in_alerta (luna curentă, previziune): ziua >= pragul (upa_alerta_zi, plafonat la ultima zi) ȘI mai e de cumpărat (ramas_de_cumparat > 0)
--   ȘI configurarea e în regulă; NULL = necunoscut. erori_config: setare_zi_invalida / fara_inceput_calcul / fara_salariu_minim /
--   fara_nr_handicap. Doar agregate (NMA, sume): detaliul pe angajat e la fn_upa_calcul_detaliu (owner). Internă: fără EXECUTE pentru roluri.
CREATE FUNCTION public.fn_upa_situatie_la(p_azi date, p_luni integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v_luna date; v_ultima date; v_txt text; v_prag integer; v_luni jsonb; v_cur jsonb; v_cfg text[] := '{}'; v_alerta boolean;
BEGIN
  IF p_azi IS NULL THEN RAISE EXCEPTION 'upa: ziua lipseste' USING ERRCODE = '22023'; END IF;
  IF p_luni IS NULL OR p_luni < 1 OR p_luni > 36 THEN RAISE EXCEPTION 'upa: p_luni intre 1 si 36' USING ERRCODE = '22023'; END IF;
  v_luna := date_trunc('month', p_azi::timestamp)::date;
  v_ultima := (v_luna + interval '1 month' - interval '1 day')::date;
  SELECT s.value INTO v_txt FROM public.logistica_setari s WHERE s.key = 'upa_alerta_zi';
  IF btrim(v_txt) ~ '^[0-9]{1,2}$' AND btrim(v_txt)::integer BETWEEN 1 AND 31 THEN
    v_prag := least(btrim(v_txt)::integer, extract(day FROM v_ultima)::integer);
  END IF;
  SELECT jsonb_agg(public.fn_upa_calcul_la((v_luna - make_interval(months => g.g))::date, p_azi) ORDER BY g.g) INTO v_luni
    FROM generate_series(0, p_luni - 1) AS g(g);
  v_cur := v_luni -> 0;
  IF v_prag IS NULL THEN v_cfg := v_cfg || 'setare_zi_invalida'::text; END IF;
  IF v_cur -> 'blocaje' ? 'fara_inceput_calcul' THEN v_cfg := v_cfg || 'fara_inceput_calcul'::text; END IF;
  IF v_cur -> 'blocaje' ? 'fara_salariu_minim' THEN v_cfg := v_cfg || 'fara_salariu_minim'::text; END IF;
  IF v_cur -> 'blocaje' ? 'fara_nr_handicap' THEN v_cfg := v_cfg || 'fara_nr_handicap'::text; END IF;
  IF cardinality(v_cfg) = 0 AND v_cur ->> 'stare' = 'previziune' AND v_cur ? 'ramas_de_cumparat' AND jsonb_typeof(v_cur -> 'ramas_de_cumparat') = 'number' THEN
    v_alerta := extract(day FROM p_azi)::integer >= v_prag AND (v_cur ->> 'ramas_de_cumparat')::numeric > 0;
  END IF;
  RETURN jsonb_build_object('azi', p_azi, 'luna_curenta', v_luna, 'zi_prag', v_prag, 'zile_ramase', v_ultima - p_azi + 1,
    'in_alerta', v_alerta, 'erori_config', to_jsonb(v_cfg), 'inceput_calcul', public.fn_upa_inceput_calcul(), 'luni', v_luni);
END $f$;
-- ecranul: doar un cont logat (L08: auth.uid() NULL = refuz); aceleași cifre ca rezervarea (fn_upa_situatie_la)
CREATE FUNCTION public.fn_upa_situatie(p_azi date DEFAULT NULL, p_luni integer DEFAULT 12) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'upa: cont neautentificat' USING ERRCODE = '42501'; END IF;
  RETURN public.fn_upa_situatie_la(coalesce(p_azi, (now() AT TIME ZONE 'Europe/Bucharest')::date), p_luni);
END $f$;
COMMENT ON FUNCTION public.fn_upa_situatie(date, integer) IS 'UPA (20270101a): situatia pe luni (calculul fiecarei luni: previziune / definitiv) + in_alerta pentru luna curenta. Doar agregate; cont logat.';

-- ─── 7. Închiderea calculului: owner-ul, din ecran, pe amprenta datelor văzute ──────────────────────────────────────────────
-- Lock-uri (L06): lock consultativ hashtext('upa_calcul_lunar') -> upa_achizitii SHARE (nicio factură nu se schimbă între calcul și scriere)
--   -> upa_calcul_lunar (INSERT) -> upa_calcul_angajat (INSERT). Pașii: luna deja închisă = 'deja'; nu se poate închide (blocaje, înainte de 13)
--   = nimic scris, cu calculul; amprenta diferită de cea văzută de om = 40001 (nimic scris); altfel instantaneul + detaliul.
-- Runda 3 (P1, cursa dintre citiri): (1) calculul și detaliul pe angajat se citesc într-o SINGURĂ instrucțiune (același instantaneu al
--   surselor: nu mai există o a doua citire a pontajului pentru detaliu); (2) după scriere, calculul COMPLET se refa din sursele de acum
--   (fn_upa_calcul_previziune_la: blocajele de completitudine incluse — pontaj lipsă, contract fără dată / normă, inactiv fără dată,
--   calendar) și trebuie să dea aceeași amprentă ȘI poate_inchide, altfel 40001 și nimic scris: o zi de pontaj ștearsă în timpul închiderii
--   (numărată la fel ca una pontată, deci invizibilă în cifre) oprește închiderea; (3) rândurile scrise dau exact amprenta și NMA-ul.
--   employees / pontaj_records / calendar_days nu se blochează (tabele folosite zilnic): o schimbare comisă DUPĂ pasul (2) e ulterioară
--   instantaneului și apare în surse_schimbate (fn_upa_calcul_la), inclusiv pierderea completitudinii.
CREATE FUNCTION public.fn_upa_calcul_inchide_la(p_luna date, p_azi date, p_amprenta text, p_uid uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_c jsonb; v_det jsonb; v_v jsonb; v_l date; v_amp text; v_nma numeric; v_n integer;
BEGIN
  IF p_uid IS NULL THEN RAISE EXCEPTION 'upa: confirmarea cere un cont' USING ERRCODE = '42501'; END IF;
  IF p_luna IS NULL OR p_azi IS NULL THEN RAISE EXCEPTION 'upa: luna si ziua sunt obligatorii' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('upa_calcul_lunar'));
  LOCK TABLE public.upa_achizitii IN SHARE MODE;
  -- (1) o singură instrucțiune = un singur instantaneu: funcțiile STABLE folosesc instantaneul instrucțiunii care le cheamă
  SELECT public.fn_upa_calcul_la(p_luna, p_azi),
         (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.employee_id), '[]'::jsonb) FROM public.fn_upa_nma_angajati(date_trunc('month', p_luna::timestamp)::date) x)
    INTO v_c, v_det;
  IF v_c ->> 'stare' = 'definitiv' THEN RETURN jsonb_build_object('inchis', true, 'deja', true, 'calcul', v_c); END IF;
  IF v_c ->> 'stare' IS DISTINCT FROM 'previziune' OR (v_c ->> 'poate_inchide')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('inchis', false, 'deja', false, 'calcul', v_c);
  END IF;
  IF p_amprenta IS NULL OR p_amprenta IS DISTINCT FROM v_c ->> 'amprenta' THEN
    RAISE EXCEPTION 'upa: datele lunii s-au schimbat de la afisare; reincarca si verifica din nou' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.upa_calcul_lunar AS c (luna, zile_luna, nr_angajati, nma, posturi, angajati_handicap, locuri, salariu_minim, suma_datorata, jumatate,
                                            achizitii_fara_tva, nr_achizitii, report_intrat, deducere, de_plata, report_iesit, termen_stat, avertismente,
                                            versiune, amprenta_angajati, amprenta_achizitii, amprenta, confirmat_de)
  VALUES ((v_c ->> 'luna')::date, (v_c ->> 'zile_luna')::integer, (v_c ->> 'nr_angajati')::integer, (v_c ->> 'nma')::numeric,
          (v_c ->> 'posturi')::numeric, (v_c ->> 'angajati_handicap')::numeric, (v_c ->> 'locuri')::numeric, (v_c ->> 'salariu_minim')::numeric,
          (v_c ->> 'suma_datorata')::numeric, (v_c ->> 'jumatate')::numeric, (v_c ->> 'achizitii_fara_tva')::numeric, (v_c ->> 'nr_achizitii')::integer,
          (v_c ->> 'report_intrat')::numeric, (v_c ->> 'deducere')::numeric, (v_c ->> 'de_plata')::numeric, (v_c ->> 'report_iesit')::numeric,
          (v_c ->> 'termen_stat')::date, ARRAY(SELECT jsonb_array_elements_text(v_c -> 'avertismente')), v_c ->> 'versiune',
          v_c ->> 'amprenta_angajati', v_c ->> 'amprenta_achizitii', v_c ->> 'amprenta', p_uid)
  RETURNING c.luna INTO v_l;
  INSERT INTO public.upa_calcul_angajat (luna, employee_id, zile_calcul, zile_cfs, zile_suspendare, zile_administrator, zile_numarate, contributie)
  SELECT v_l, x.employee_id, x.zile_calcul, x.zile_cfs, x.zile_suspendare, x.zile_administrator, x.zile_numarate, x.contributie
    FROM jsonb_populate_recordset(NULL::public.upa_calcul_angajat, v_det) x;
  -- (2) reverificarea pe sursele de acum, cu completitudinea (instrucțiune nouă = instantaneu nou: vede ce s-a comis între timp)
  v_v := public.fn_upa_calcul_previziune_la(v_l, p_azi, 0);
  IF (v_v ->> 'poate_inchide')::boolean IS NOT TRUE OR (v_v ->> 'amprenta') IS DISTINCT FROM (v_c ->> 'amprenta') THEN
    RAISE EXCEPTION 'upa: datele lunii (pontaj, contracte, calendar) s-au schimbat in timpul inchiderii; reincarca si verifica din nou' USING ERRCODE = '40001';
  END IF;
  -- (3) rândurile scrise
  SELECT md5(coalesce(string_agg(public.fn_upa_rand_amprenta(a.employee_id, a.zile_calcul, a.zile_cfs, a.zile_suspendare, a.zile_administrator,
                                   a.zile_numarate, a.contributie), ',' ORDER BY a.employee_id), '')),
         round(coalesce(sum(a.contributie), 0) / (v_c ->> 'zile_luna')::integer, 2), count(*)::integer
    INTO v_amp, v_nma, v_n FROM public.upa_calcul_angajat a WHERE a.luna = v_l;
  IF v_amp IS DISTINCT FROM v_c ->> 'amprenta_angajati' OR v_nma IS DISTINCT FROM (v_c ->> 'nma')::numeric OR v_n <> (v_c ->> 'nr_angajati')::integer THEN
    RAISE EXCEPTION 'upa: pontajul s-a schimbat in timpul inchiderii; reincarca si verifica din nou' USING ERRCODE = '40001';
  END IF;
  RETURN jsonb_build_object('inchis', true, 'deja', false, 'calcul', public.fn_upa_calcul_la(v_l, p_azi));
END $f$;
-- din ecran: DOAR owner-ul (confirmă normele, administratorii, suspendările fără cod și facturile, pe care le vede în detaliu); identitatea =
--   auth.uid() (L08); ziua = azi în România
CREATE FUNCTION public.fn_upa_calcul_inchide(p_luna date, p_amprenta text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN
    RAISE EXCEPTION 'upa: inchiderea calculului (confirmarea datelor HR) e doar pentru owner' USING ERRCODE = '42501';
  END IF;
  IF p_luna IS NULL THEN RAISE EXCEPTION 'upa: luna lipseste' USING ERRCODE = '22023'; END IF;
  RETURN public.fn_upa_calcul_inchide_la(p_luna, (now() AT TIME ZONE 'Europe/Bucharest')::date, p_amprenta, auth.uid());
END $f$;

-- detaliul NMA pe angajat + corecțiile HR care ating luna (owner): luna închisă = rândurile scrise; altfel calculul de acum
CREATE FUNCTION public.fn_upa_calcul_detaliu(p_luna date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_l date; v_l1 date; v_r jsonb; v_p jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN
    RAISE EXCEPTION 'upa: detaliul pe angajat e doar pentru owner' USING ERRCODE = '42501';
  END IF;
  IF p_luna IS NULL THEN RAISE EXCEPTION 'upa: luna lipseste' USING ERRCODE = '22023'; END IF;
  v_l := date_trunc('month', p_luna::timestamp)::date;
  v_l1 := (v_l + interval '1 month' - interval '1 day')::date;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'employee_id', o.employee_id, 'nume', em.name, 'de_la', o.de_la, 'pana_la', o.pana_la,
           'norma', o.norma, 'administrator', o.administrator, 'suspendat', o.suspendat, 'nota', o.nota, 'setat_la', o.setat_la)
           ORDER BY em.name, o.de_la, o.id), '[]'::jsonb)
    INTO v_p FROM public.upa_angajat_perioade o LEFT JOIN public.employees em ON em.id = o.employee_id
   WHERE o.de_la <= v_l1 + 14 AND o.pana_la >= v_l - 14;
  IF EXISTS (SELECT 1 FROM public.upa_calcul_lunar c WHERE c.luna = v_l) THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id', a.employee_id, 'nume', em.name, 'zile_calcul', a.zile_calcul, 'zile_cfs', a.zile_cfs,
             'zile_suspendare', a.zile_suspendare, 'zile_administrator', a.zile_administrator,
             'zile_numarate', a.zile_numarate, 'contributie', a.contributie) ORDER BY em.name, a.employee_id), '[]'::jsonb)
      INTO v_r FROM public.upa_calcul_angajat a LEFT JOIN public.employees em ON em.id = a.employee_id WHERE a.luna = v_l;
    RETURN jsonb_build_object('luna', v_l, 'definitiv', true, 'angajati', v_r, 'perioade', v_p);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'nume', em.name, 'zile_calcul', x.zile_calcul, 'zile_cfs', x.zile_cfs,
           'zile_suspendare', x.zile_suspendare, 'zile_administrator', x.zile_administrator,
           'zile_numarate', x.zile_numarate, 'contributie', x.contributie, 'zile_fara_pontaj', x.zile_fara_pontaj,
           'fara_data_angajare', x.fara_data_angajare, 'fara_norma', x.fara_norma, 'corectii', x.corectii,
           'zile_libere_langa_suspendare', x.zile_libere_langa_suspendare) ORDER BY em.name, x.employee_id), '[]'::jsonb)
    INTO v_r FROM public.fn_upa_nma_angajati(v_l) x LEFT JOIN public.employees em ON em.id = x.employee_id;
  RETURN jsonb_build_object('luna', v_l, 'definitiv', false, 'angajati', v_r, 'perioade', v_p);
END $f$;

-- ─── 8. Parametrii din ecran (CAS pe valoarea văzută; o lună închisă nu se recalculează) ────────────────────────────────────
-- p_vechi = valoarea rândului (cheie, de_la) pe care a văzut-o omul (NULL dacă nu exista rândul); altă valoare acum = 40001.
-- Refuz (UPA03) dacă o lună ÎNCHISĂ folosește valoarea pe care rândul o schimbă (de la p_de_la până la următorul rând al cheii); reportul
--   inițial (= prima lună a calculului) se schimbă doar cât nu e închisă nicio lună și rămâne un singur rând.
CREATE FUNCTION public.fn_upa_parametru_seteaza(p_cheie text, p_de_la date, p_valoare numeric, p_vechi numeric, p_nota text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_urm date; v_acum numeric;
BEGIN
  IF NOT public.fn_upa_poate_scrie() THEN
    RAISE EXCEPTION 'upa: parametrii calculului cer Administrativ / Unitati protejate (admin sau editor)' USING ERRCODE = '42501';
  END IF;
  IF p_cheie IS NULL OR p_cheie NOT IN ('salariu_minim', 'angajati_handicap', 'report_initial', 'termen_stat_zi') THEN
    RAISE EXCEPTION 'upa: parametru necunoscut' USING ERRCODE = '22023';
  END IF;
  IF p_de_la IS NULL OR extract(day FROM p_de_la) <> 1 OR p_de_la < DATE '2020-01-01' OR p_de_la > DATE '2100-01-01' THEN
    RAISE EXCEPTION 'upa: data de inceput trebuie sa fie prima zi a unei luni' USING ERRCODE = '22023';
  END IF;
  -- termen_stat_zi (runda 6): zi întreagă 1..25 (aceeași regulă ca CHECK-ul upa_parametri_valoare și fn_upa_termen_stat)
  IF p_valoare IS NULL OR p_valoare < 0 OR p_valoare >= 10000000 OR p_valoare <> round(p_valoare, 2)
     OR (p_cheie = 'salariu_minim' AND p_valoare <= 0) OR (p_cheie = 'angajati_handicap' AND p_valoare <> trunc(p_valoare))
     OR (p_cheie = 'termen_stat_zi' AND (p_valoare <> trunc(p_valoare) OR p_valoare < 1 OR p_valoare > 25)) THEN
    RAISE EXCEPTION 'upa: valoare invalida pentru %', p_cheie USING ERRCODE = '22023';
  END IF;
  IF p_nota IS NOT NULL AND length(p_nota) > 300 THEN RAISE EXCEPTION 'upa: nota are peste 300 de caractere' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('upa_calcul_lunar'));
  SELECT p.valoare INTO v_acum FROM public.upa_parametri p WHERE p.cheie = p_cheie AND p.de_la = p_de_la;
  IF v_acum IS DISTINCT FROM p_vechi THEN
    RAISE EXCEPTION 'upa: parametrul s-a schimbat intre timp; reincarca pagina' USING ERRCODE = '40001';
  END IF;
  IF p_cheie = 'report_initial' THEN
    IF EXISTS (SELECT 1 FROM public.upa_calcul_lunar) THEN
      RAISE EXCEPTION 'upa: reportul initial nu se mai schimba dupa prima luna inchisa' USING ERRCODE = 'UPA03';
    END IF;
    IF EXISTS (SELECT 1 FROM public.upa_parametri p WHERE p.cheie = 'report_initial' AND p.de_la <> p_de_la) THEN
      RAISE EXCEPTION 'upa: reportul initial are deja alta luna de inceput' USING ERRCODE = 'UPA03';
    END IF;
  ELSE
    SELECT min(p.de_la) INTO v_urm FROM public.upa_parametri p WHERE p.cheie = p_cheie AND p.de_la > p_de_la;
    IF EXISTS (SELECT 1 FROM public.upa_calcul_lunar c WHERE c.luna >= p_de_la AND (v_urm IS NULL OR c.luna < v_urm)) THEN
      RAISE EXCEPTION 'upa: o luna inchisa foloseste deja valoarea; alege o luna de dupa ultima luna inchisa' USING ERRCODE = 'UPA03';
    END IF;
  END IF;
  INSERT INTO public.upa_parametri AS p (cheie, de_la, valoare, sursa, nota, setat_de, setat_la)
  VALUES (p_cheie, p_de_la, p_valoare, 'ecran', nullif(btrim(p_nota), ''), auth.uid(), now())
  ON CONFLICT (cheie, de_la) DO UPDATE SET valoare = EXCLUDED.valoare, sursa = 'ecran', nota = EXCLUDED.nota, setat_de = EXCLUDED.setat_de,
                                           setat_la = EXCLUDED.setat_la;
  RETURN jsonb_build_object('cheie', p_cheie, 'de_la', p_de_la, 'valoare', p_valoare);
END $f$;

-- ─── 9. Corecțiile HR pe interval (owner) ─────────────────────────────────────────────────────────────────────────────────
-- Refuz: alt cont decât owner-ul (42501); valori invalide / angajat inexistent / fără motiv (22023); suprapunere cu altă corecție a
--   aceluiași angajat (UPA05); o lună ÎNCHISĂ care ar folosi intervalul (UPA03): de la cele 14 zile dinaintea lunii până la PRIMA zi
--   lucrătoare de după ea (runda 4: zilele libere de la sfârșitul lunii se judecă și după ziua cu informație de după, care e cel târziu
--   acea zi lucrătoare; o corecție de mai târziu în luna următoare nu atinge luna închisă). Lock: consultativ hashtext('upa_calcul_lunar') -> upa_angajat_perioade.
CREATE FUNCTION public.fn_upa_perioada_adauga(p_employee_id integer, p_de_la date, p_pana_la date, p_norma numeric, p_administrator boolean,
                                              p_suspendat boolean, p_nota text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN
    RAISE EXCEPTION 'upa: corectiile HR sunt doar pentru owner' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id IS NULL OR p_de_la IS NULL OR p_pana_la IS NULL OR p_suspendat IS NULL OR p_pana_la < p_de_la OR p_pana_la - p_de_la > 3660
     OR (p_norma IS NOT NULL AND (p_norma <= 0 OR p_norma > 1 OR p_norma <> round(p_norma, 4)))
     OR (p_norma IS NULL AND p_administrator IS NULL AND NOT p_suspendat)
     OR p_nota IS NULL OR NOT (p_nota ~ '[^[:space:]]') OR length(p_nota) > 300 THEN
    RAISE EXCEPTION 'upa: corectie invalida (interval, norma intre 0 si 1, cel putin o schimbare, motivul obligatoriu)' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees em WHERE em.id = p_employee_id) THEN
    RAISE EXCEPTION 'upa: angajat inexistent' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('upa_calcul_lunar'));
  IF EXISTS (SELECT 1 FROM public.upa_calcul_lunar c
              WHERE c.luna <= p_pana_la + 14
                AND coalesce((SELECT min(g::date) FROM generate_series((c.luna + interval '1 month')::timestamp, (c.luna + interval '1 month' + interval '14 days')::timestamp,
                                                                       interval '1 day') AS g WHERE public.fn_upa_zi_lucratoare(g::date)),
                              (c.luna + interval '1 month' + interval '14 days')::date) >= p_de_la) THEN
    RAISE EXCEPTION 'upa: o luna inchisa foloseste deja intervalul' USING ERRCODE = 'UPA03';
  END IF;
  IF EXISTS (SELECT 1 FROM public.upa_angajat_perioade o WHERE o.employee_id = p_employee_id AND o.de_la <= p_pana_la AND o.pana_la >= p_de_la) THEN
    RAISE EXCEPTION 'upa: intervalul se suprapune cu alta corectie a angajatului' USING ERRCODE = 'UPA05';
  END IF;
  INSERT INTO public.upa_angajat_perioade (employee_id, de_la, pana_la, norma, administrator, suspendat, nota, setat_de)
  VALUES (p_employee_id, p_de_la, p_pana_la, p_norma, p_administrator, p_suspendat, btrim(p_nota), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END $f$;
-- ștergerea unei corecții (owner), aceleași reguli de lună închisă; 0 rânduri = ștearsă deja (nimic de făcut)
CREATE FUNCTION public.fn_upa_perioada_sterge(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_o public.upa_angajat_perioade; v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN
    RAISE EXCEPTION 'upa: corectiile HR sunt doar pentru owner' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'upa: id lipsa' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('upa_calcul_lunar'));
  SELECT * INTO v_o FROM public.upa_angajat_perioade o WHERE o.id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sters', 0); END IF;
  IF EXISTS (SELECT 1 FROM public.upa_calcul_lunar c
              WHERE c.luna <= v_o.pana_la + 14
                AND coalesce((SELECT min(g::date) FROM generate_series((c.luna + interval '1 month')::timestamp, (c.luna + interval '1 month' + interval '14 days')::timestamp,
                                                                       interval '1 day') AS g WHERE public.fn_upa_zi_lucratoare(g::date)),
                              (c.luna + interval '1 month' + interval '14 days')::date) >= v_o.de_la) THEN
    RAISE EXCEPTION 'upa: o luna inchisa foloseste corectia' USING ERRCODE = 'UPA03';
  END IF;
  DELETE FROM public.upa_angajat_perioade o WHERE o.id = p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('sters', v_n);
END $f$;

-- ─── 10. Salvarea din formular: amprentă VERSIONATĂ (compatibilă cu intențiile de dinainte și cu revenirea) ─────────────────
-- câmpurile permise (v2) = cele din 20261229a + valoarea fără TVA, data și starea plății
CREATE FUNCTION public.fn_upa_campuri_intentie_v2() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT public.fn_upa_campuri_intentie() || ARRAY['valoare_fara_tva', 'data_plata', 'stare_plata']::text[]
$f$;
-- fără valorile noi: EXACT amprenta din 20261229a (fn_upa_hash_intentie, neatinsă); cu ele: 'v2:' + md5 pe toate câmpurile v2
CREATE FUNCTION public.fn_upa_hash_intentie_v2(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN coalesce(jsonb_typeof(p -> 'valoare_fara_tva'), 'null') = 'null' AND coalesce(jsonb_typeof(p -> 'data_plata'), 'null') = 'null'
                   AND coalesce(jsonb_typeof(p -> 'stare_plata'), 'null') = 'null'
              THEN public.fn_upa_hash_intentie(p)
              ELSE 'v2:' || (SELECT md5(jsonb_object_agg(k.k, p -> k.k)::text) FROM unnest(public.fn_upa_campuri_intentie_v2()) AS k(k)) END
$f$;
-- triggerul din 20261229a, cu amprenta v2 (aceleași reguli: pusă de server la INSERT, nemodificabilă)
CREATE OR REPLACE FUNCTION public.fn_upa_achizitii_intentie() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.hash_intentie := CASE WHEN NEW.cheie_intentie IS NULL THEN NULL ELSE public.fn_upa_hash_intentie_v2(to_jsonb(NEW)) END;
  ELSIF NEW.cheie_intentie IS DISTINCT FROM OLD.cheie_intentie OR NEW.hash_intentie IS DISTINCT FROM OLD.hash_intentie THEN
    RAISE EXCEPTION 'upa: cheia si amprenta intentiei nu se modifica' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $f$;
-- aceeași funcție ca în 20261229a (cheia, amprenta, existent / UPA02 / nou), cu câmpurile și amprenta v2
CREATE OR REPLACE FUNCTION public.fn_upa_achizitie_adauga(p_cheie uuid, p_rand jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_r public.upa_achizitii; v_hash text; v_ex record; v_id bigint; v_k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'upa: cont neautentificat' USING ERRCODE = '42501'; END IF;
  IF p_cheie IS NULL OR p_rand IS NULL OR jsonb_typeof(p_rand) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'upa: cheia si campurile achizitiei sunt obligatorii' USING ERRCODE = '22023';
  END IF;
  SELECT k.k INTO v_k FROM jsonb_object_keys(p_rand) AS k(k) WHERE NOT (k.k = ANY (public.fn_upa_campuri_intentie_v2())) LIMIT 1;
  IF v_k IS NOT NULL THEN RAISE EXCEPTION 'upa: camp nepermis in achizitie (%)', left(v_k, 40) USING ERRCODE = '22023'; END IF;
  v_r := jsonb_populate_record(NULL::public.upa_achizitii, p_rand);
  v_hash := public.fn_upa_hash_intentie_v2(to_jsonb(v_r));
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
                                           valoare_fara_tva, data_plata, stare_plata, cheie_intentie, created_by)
    VALUES (v_r.furnizor_id, v_r.furnizor_nume, v_r.numar_factura, v_r.data_factura, v_r.luna, v_r.valoare, v_r.descriere, v_r.document_path,
            v_r.valoare_fara_tva, v_r.data_plata, v_r.stare_plata, p_cheie, auth.uid())
    ON CONFLICT (cheie_intentie) DO NOTHING
    RETURNING a.id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('stare', 'nou', 'id', v_id); END IF;
  END LOOP;
  RAISE EXCEPTION 'upa: cheia intentiei in conflict, fara rand vizibil; reincearca' USING ERRCODE = '40001';
END $f$;

-- ─── 11. Alerta pe calculul nou (înlocuiri ale funcțiilor din 20261229a; aceeași semnătură, același jurnal) ──────────────────────
-- Jurnalul: zilnic -> plafon = deducerea maximă rămasă (jumătate − report intrat), consumat = achiziții fără TVA, ramas = de cumpărat;
--   calcul -> plafon = contribuția integrală, consumat = achiziții fără TVA, ramas = de plată la stat (termenul din luna închisă).
CREATE OR REPLACE FUNCTION public.fn_upa_alerta_inscrie(p_fel text, p_zi date, p_luna date, p_plafon numeric, p_consumat numeric, p_ramas numeric,
                                             p_zile integer, p_dest text[], p_ignorati integer, p_cod text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_id bigint; v_cheie text; v_stare text; v_eroare text; v_nd integer := 0; v_tip text; v_titlu text; v_mesaj text; v_n integer;
        v_ign integer := greatest(coalesce(p_ignorati, 0), 0); v_termen date;
BEGIN
  IF p_fel IS NULL OR p_fel NOT IN ('zilnic', 'calcul', 'eroare') THEN RAISE EXCEPTION 'upa: fel necunoscut' USING ERRCODE = '22023'; END IF;
  v_cheie := CASE p_fel WHEN 'zilnic' THEN 'zilnic:' || to_char(p_zi, 'YYYY-MM-DD')
                        WHEN 'calcul' THEN 'calcul:' || to_char(p_luna, 'YYYY-MM')
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
    v_titlu := 'Fond handicap ' || public.fn_upa_luna_text(p_luna) || ' (previziune): mai sunt ' || public.fn_upa_lei(p_ramas) || ' lei de cumpărat de la unități protejate';
    v_mesaj := 'Deducerea maximă estimată a lunii: ' || public.fn_upa_lei(p_plafon) || ' lei; cumpărat ' || public.fn_upa_lei(p_consumat)
               || ' lei fără TVA; ' || public.fn_upa_zile_text(p_zile) || ' din lună. Facturile se plătesc până la sfârșitul lunii; '
               || 'ce nu se deduce se plătește la bugetul de stat. Previziune: valoarea exactă se calculează după închiderea pontajului.';
  ELSIF p_fel = 'calcul' THEN
    SELECT c.termen_stat INTO v_termen FROM public.upa_calcul_lunar c WHERE c.luna = p_luna;
    v_tip := 'error';
    -- runda 3 (P1): luna închisă după scadență (sau cronul oprit până după ea) primește alerta, cu termenul declarat depășit
    IF v_termen < p_zi THEN
      v_titlu := 'Fond handicap ' || public.fn_upa_luna_text(p_luna) || ': de plată la bugetul de stat ' || public.fn_upa_lei(p_ramas)
                 || ' lei; termenul ' || to_char(v_termen, 'DD.MM.YYYY') || ' a trecut';
    ELSE
      v_titlu := 'Fond handicap ' || public.fn_upa_luna_text(p_luna) || ': de plată la bugetul de stat ' || public.fn_upa_lei(p_ramas)
                 || ' lei până pe ' || coalesce(to_char(v_termen, 'DD.MM.YYYY'), '—');
    END IF;
    v_mesaj := CASE WHEN v_termen < p_zi THEN 'Termenul de plată la bugetul de stat (' || to_char(v_termen, 'DD.MM.YYYY') || ') a trecut: plata se face cât mai curând. ' ELSE '' END
               || 'Calcul exact, confirmat după închiderea pontajului: contribuția integrală ' || public.fn_upa_lei(p_plafon) || ' lei, achiziții de la unități '
               || 'protejate ' || public.fn_upa_lei(p_consumat) || ' lei fără TVA. Reportul pe lunile următoare: Administrativ → Unități protejate.';
  ELSE
    v_tip := 'error';
    v_titlu := 'Fondul de handicap: ' || CASE p_cod WHEN 'calcul_de_confirmat' THEN 'calculul unei luni e gata de închis'
                                                     ELSE 'calculul nu poate rula (' || p_cod || ')' END;
    v_mesaj := CASE p_cod WHEN 'setare_zi_invalida' THEN 'Setarea upa_alerta_zi lipsește sau nu e o zi între 1 și 31.'
                          WHEN 'fara_salariu_minim' THEN 'Salariul minim al lunii nu e înregistrat (Administrativ → Unități protejate → Parametri).'
                          WHEN 'fara_nr_handicap' THEN 'Numărul angajaților cu handicap nu e înregistrat (Administrativ → Unități protejate → Parametri).'
                          WHEN 'fara_inceput_calcul' THEN 'Prima lună a calculului (reportul inițial) nu e stabilită.'
                          WHEN 'calcul_neinchis' THEN 'Calculul unei luni încheiate nu se poate închide: lipsesc date (pontaj, contracte, facturi fără valoare fără TVA sau fără starea plății, parametri, calendar). Vezi Administrativ → Unități protejate.'
                          WHEN 'calcul_de_confirmat' THEN 'Pontajul lunii e închis și datele sunt complete: verifică detaliul pe angajați (normă, administratori, suspendări) și apasă „Închide calculul” în Administrativ → Unități protejate.'
                          ELSE 'Eroare de configurare.' END;
  END IF;
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  SELECT d.id, v_tip, 'Administrativ', left(v_titlu, 200), left(v_mesaj, 1000), '/administrativ?tab=upa'
    FROM (SELECT p.id FROM public.profiles p WHERE p.is_owner IS TRUE
          UNION
          SELECT u.profile_id FROM public.user_module_access u
           WHERE (p_fel <> 'eroare' OR p_cod = 'calcul_neinchis') AND u.module IN ('administrativ', 'administrativ.upa')) d
   ORDER BY d.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.upa_alerta_jurnal j SET nr_notificari = v_n WHERE j.id = v_id;
  RETURN v_id;
END $f$;

-- Rularea zilei: (1) reconcilierea rezervărilor rămase (> 1 h -> necunoscut); (2) alerta EXACTĂ pentru fiecare lună închisă (oricine a
--   închis-o, oricât de târziu) care nu o are încă în jurnal (cheia calcul:AAAA-LL), cu contribuția > 0 (alerta pornită); runda 3 (P1):
--   fără filtru pe termen sau pe fereastră — o lună închisă după scadență sau cu cronul oprit primește alerta la prima rulare, cu
--   termen_depasit = true (mesajul spune că termenul a trecut);
--   (3) prima lună de la începutul calculului care nu e închisă, cu data de 13 trecută: gata = calcul_de_confirmat (owner), date lipsă =
--   calcul_neinchis (owner + Administrativ / UPA); (4) comutatorul oprit -> doar atât; (5) erorile — în jurnal o dată pe zi și cod, în
--   răspuns la fiecare rulare; (6) alerta zilei pe in_alerta din fn_upa_situatie_la. Cronul NU închide luni.
--   Răspuns: UN jsonb {activ, zi, inchis, inchise, luna_de_inchis, erori_config, n, randuri (cu `calcul` pe fiecare rând)}.
CREATE OR REPLACE FUNCTION public.fn_upa_alerta_rezerva_la(p_azi date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_activ boolean; v_dest text[]; v_ign integer; v_sit jsonb; v_cur jsonb; v_lc date; v_start date; v_c jsonb; v_ids bigint[] := '{}';
        v_id bigint; v_rez jsonb; v_furn jsonb; v_reconciliate integer; v_cfg text[]; v_cod text; v_pend date; v_de_inchis jsonb; r record;
BEGIN
  IF p_azi IS NULL THEN RAISE EXCEPTION 'upa: ziua lipseste' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('upa_alerta_jurnal'));
  UPDATE public.upa_alerta_jurnal j SET stare = 'necunoscut', eroare = 'rezervare_veche', actualizat_la = now()
   WHERE j.stare = 'rezervat' AND j.creat_la < now() - interval '1 hour';
  GET DIAGNOSTICS v_reconciliate = ROW_COUNT;
  v_activ := (SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_activa') IS NOT DISTINCT FROM 'true';
  SELECT d.interni, cardinality(d.ignorate) INTO v_dest, v_ign
    FROM public.fn_upa_destinatari((SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_emails')) d;
  v_lc := date_trunc('month', p_azi::timestamp)::date;
  v_start := public.fn_upa_inceput_calcul();
  -- (2) alerta exactă a lunilor închise, recuperată (închiderea din ecran nu trimite nimic; aici se trimite o dată)
  IF v_activ THEN
    FOR r IN SELECT c.luna, c.suma_datorata, c.achizitii_fara_tva, c.de_plata FROM public.upa_calcul_lunar c
              WHERE c.luna < v_lc AND c.suma_datorata > 0
                AND NOT EXISTS (SELECT 1 FROM public.upa_alerta_jurnal j WHERE j.cheie = 'calcul:' || to_char(c.luna, 'YYYY-MM'))
              ORDER BY c.luna LOOP
      v_id := public.fn_upa_alerta_inscrie('calcul', p_azi, r.luna, r.suma_datorata, r.achizitii_fara_tva, r.de_plata, NULL, v_dest, v_ign, NULL);
      IF v_id IS NOT NULL THEN v_ids := v_ids || v_id; END IF;
    END LOOP;
  END IF;
  -- (3) prima lună neînchisă, cu pontajul închis
  IF v_start IS NOT NULL AND v_start < v_lc THEN
    SELECT min(g.m::date) INTO v_pend FROM generate_series(greatest(v_start, (v_lc - interval '36 months')::date)::timestamp,
                                                           (v_lc - interval '1 month')::timestamp, interval '1 month') AS g(m)
     WHERE NOT EXISTS (SELECT 1 FROM public.upa_calcul_lunar c WHERE c.luna = g.m::date);
    IF v_pend IS NOT NULL AND public.fn_upa_pontaj_inchis(v_pend, p_azi) THEN
      v_c := public.fn_upa_calcul_la(v_pend, p_azi);
      v_de_inchis := jsonb_build_object('luna', v_pend, 'gata', (v_c ->> 'poate_inchide')::boolean IS TRUE, 'blocaje', v_c -> 'blocaje');
    END IF;
  END IF;
  v_sit := public.fn_upa_situatie_la(p_azi, 1);
  v_cur := v_sit -> 'luni' -> 0;
  v_cfg := ARRAY(SELECT jsonb_array_elements_text(v_sit -> 'erori_config'));
  IF v_de_inchis IS NOT NULL AND (v_de_inchis ->> 'gata')::boolean IS NOT TRUE THEN v_cfg := v_cfg || 'calcul_neinchis'::text; END IF;
  IF NOT v_activ THEN
    RETURN jsonb_build_object('activ', false, 'zi', p_azi, 'inchis', NULL, 'inchise', '[]'::jsonb, 'luna_de_inchis', v_de_inchis,
                              'reconciliate', v_reconciliate, 'erori_config', to_jsonb(v_cfg), 'destinatari_ignorati', v_ign, 'n', 0, 'randuri', '[]'::jsonb);
  END IF;
  -- (5) erorile: în jurnal (+ notificările) o dată pe zi și cod; în răspuns la fiecare rulare
  FOREACH v_cod IN ARRAY v_cfg LOOP
    PERFORM public.fn_upa_alerta_inscrie('eroare', p_azi, v_lc, NULL, NULL, NULL, NULL, NULL, NULL, v_cod);
  END LOOP;
  IF (v_de_inchis ->> 'gata')::boolean IS TRUE THEN
    PERFORM public.fn_upa_alerta_inscrie('eroare', p_azi, v_lc, NULL, NULL, NULL, NULL, NULL, NULL, 'calcul_de_confirmat');
  END IF;
  IF (v_sit ->> 'in_alerta')::boolean IS TRUE THEN
    -- (6) alerta zilei (previziune): cel mult una pe zi (cheia zilnic:<zi>)
    v_id := public.fn_upa_alerta_inscrie('zilnic', p_azi, v_lc, (v_cur ->> 'jumatate')::numeric - (v_cur ->> 'report_intrat')::numeric,
                                         (v_cur ->> 'achizitii_fara_tva')::numeric, (v_cur ->> 'ramas_de_cumparat')::numeric,
                                         (v_sit ->> 'zile_ramase')::integer, v_dest, v_ign, NULL);
    IF v_id IS NOT NULL THEN v_ids := v_ids || v_id; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(f.nume ORDER BY f.nume), '[]'::jsonb) INTO v_furn
    FROM (SELECT DISTINCT fz.nume::text AS nume FROM public.logistica_furnizori fz
           WHERE fz.este_upa IS TRUE AND fz.activ IS TRUE AND (fz.upa_valabil_pana IS NULL OR fz.upa_valabil_pana >= p_azi)
             AND fz.nume IS NOT NULL ORDER BY 1 LIMIT 15) f;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'cheie', j.cheie, 'fel', j.fel, 'luna', j.luna, 'plafon', j.plafon, 'consumat', j.consumat,
                                               'ramas', j.ramas, 'zile_ramase', j.zile_ramase, 'stare', j.stare, 'eroare', j.eroare,
                                               'dest_ignorati', j.nr_dest_ignorati,
                                               'termen_depasit', CASE WHEN j.fel = 'calcul' THEN
                                                 (SELECT c.termen_stat < j.zi FROM public.upa_calcul_lunar c WHERE c.luna = j.luna) END,
                                               'calcul', CASE WHEN j.fel = 'zilnic' THEN v_cur ELSE public.fn_upa_calcul_la(j.luna, p_azi) END,
                                               'destinatari', CASE WHEN j.stare = 'rezervat' THEN to_jsonb(v_dest) ELSE '[]'::jsonb END) ORDER BY j.id), '[]'::jsonb)
    INTO v_rez FROM public.upa_alerta_jurnal j WHERE j.id = ANY (v_ids);
  RETURN jsonb_build_object('activ', true, 'zi', p_azi, 'inchis', NULL, 'inchise', '[]'::jsonb, 'luna_de_inchis', v_de_inchis,
                            'reconciliate', v_reconciliate, 'furnizori_upa', v_furn, 'erori_config', to_jsonb(v_cfg), 'destinatari_ignorati', v_ign,
                            'n', jsonb_array_length(v_rez), 'randuri', v_rez);
END $f$;

-- ce s-ar face azi, FĂRĂ nicio scriere (?dry=1 al owner-ului): aceleași predicate (fn_upa_situatie_la + fn_upa_destinatari + fn_upa_calcul_la)
CREATE OR REPLACE FUNCTION public.fn_upa_alerta_proba() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date; v_sit jsonb; v_cur jsonb; v_dest text[]; v_ignorate text[]; v_ant jsonb;
BEGIN
  v_sit := public.fn_upa_situatie_la(v_azi, 2);
  v_cur := v_sit -> 'luni' -> 0;
  v_ant := v_sit -> 'luni' -> 1;
  SELECT d.interni, d.ignorate INTO v_dest, v_ignorate
    FROM public.fn_upa_destinatari((SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_emails')) d;
  RETURN jsonb_build_object(
    'zi', v_azi,
    'activ', (SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_activa') IS NOT DISTINCT FROM 'true',
    'luna', v_cur ->> 'luna', 'calcul', v_cur, 'zile_ramase', v_sit -> 'zile_ramase', 'zi_prag', v_sit -> 'zi_prag', 'in_alerta', v_sit -> 'in_alerta',
    'erori_config', v_sit -> 'erori_config', 'inceput_calcul', v_sit -> 'inceput_calcul',
    'alerta_azi_deja', EXISTS (SELECT 1 FROM public.upa_alerta_jurnal j WHERE j.cheie = 'zilnic:' || to_char(v_azi, 'YYYY-MM-DD')),
    'luna_anterioara', v_ant ->> 'luna', 'luna_anterioara_calcul', v_ant,
    'alerta_exacta_anterioara_deja', EXISTS (SELECT 1 FROM public.upa_alerta_jurnal j WHERE j.cheie = 'calcul:' || to_char((v_ant ->> 'luna')::date, 'YYYY-MM')),
    'destinatari_valizi', v_dest IS NOT NULL, 'destinatari', coalesce(to_jsonb(v_dest), '[]'::jsonb),
    'destinatari_ignorate', to_jsonb(v_ignorate));
END $f$;

-- ─── 12. Drepturi și RLS (fără scriere directă: doar prin RPC-uri) ──────────────────────────────────────────────────────────
-- funcțiile noi: implicit nimic (Supabase dă EXECUTE implicit rolurilor API); apoi doar ce cheamă ecranul / apelantul
REVOKE ALL ON FUNCTION public.fn_upa_parametru_la(text, date), public.fn_upa_inceput_calcul(), public.fn_upa_pontaj_inchis(date, date),
  public.fn_upa_zi_lucratoare(date), public.fn_upa_calendar_lipsa(integer), public.fn_upa_termen_stat(date), public.fn_upa_cauza_cod(text),
  public.fn_upa_nma_angajati(date), public.fn_upa_rand_amprenta(integer, integer, integer, integer, integer, integer, numeric),
  public.fn_upa_amprenta_achizitii(date), public.fn_upa_calcul_previziune_la(date, date, integer), public.fn_upa_calcul_la(date, date, integer),
  public.fn_upa_situatie_la(date, integer),
  public.fn_upa_situatie(date, integer), public.fn_upa_calcul_inchide_la(date, date, text, uuid), public.fn_upa_calcul_inchide(date, text),
  public.fn_upa_calcul_detaliu(date), public.fn_upa_parametru_seteaza(text, date, numeric, numeric, text),
  public.fn_upa_perioada_adauga(integer, date, date, numeric, boolean, boolean, text), public.fn_upa_perioada_sterge(bigint),
  public.fn_upa_campuri_intentie_v2(), public.fn_upa_hash_intentie_v2(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_situatie(date, integer), public.fn_upa_calcul_inchide(date, text), public.fn_upa_calcul_detaliu(date),
  public.fn_upa_parametru_seteaza(text, date, numeric, numeric, text), public.fn_upa_perioada_adauga(integer, date, date, numeric, boolean, boolean, text),
  public.fn_upa_perioada_sterge(bigint) TO authenticated;
-- funcții pure, fără date: EXECUTE pentru rolurile care scriu în upa_achizitii (triggerul și RPC-ul rulează ca apelantul)
GRANT EXECUTE ON FUNCTION public.fn_upa_campuri_intentie_v2(), public.fn_upa_hash_intentie_v2(jsonb) TO authenticated, service_role;
ALTER TABLE public.upa_parametri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upa_calcul_lunar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upa_calcul_angajat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upa_angajat_perioade ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upa_parametri, public.upa_calcul_lunar, public.upa_calcul_angajat, public.upa_angajat_perioade FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.upa_angajat_perioade_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.upa_parametri, public.upa_calcul_lunar, public.upa_calcul_angajat, public.upa_angajat_perioade TO authenticated;
-- agregatele (parametri, lunile închise) = orice cont logat, ca achizițiile din 20261229a; datele pe angajat = doar owner-ul
CREATE POLICY upa_parametri_citire ON public.upa_parametri FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY upa_calcul_lunar_citire ON public.upa_calcul_lunar FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY upa_calcul_angajat_citire_owner ON public.upa_calcul_angajat FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE));
CREATE POLICY upa_angajat_perioade_citire_owner ON public.upa_angajat_perioade FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE));

-- ─── 13. Intrările cunoscute (răspunsurile expertei contabile, 20.11 și 25.11.2026) ────────────────────────────────────────────
-- salariul minim: DOAR valoarea confirmată de expertă; prima lună a calculului: octombrie 2026, report inițial 0 (confirmat 25.11.2026;
-- schimbabil cât nu e închisă nicio lună). Termenul la stat: 21 pentru noiembrie 2026 (21.12.2026, confirmat 25.11.2026), apoi înapoi la 25
-- (implicitul) din decembrie 2026 — dacă 21 e regula fiecărui decembrie, expertă confirmă și se adaugă rândul din ecran.
-- Numărul angajaților cu handicap NU se pune aici (nu există în ERP): până îl înregistrează cineva, calculul e blocat.
INSERT INTO public.upa_parametri (cheie, de_la, valoare, sursa, nota) VALUES
  ('salariu_minim', DATE '2026-07-01', 4325, 'migrare', 'salariul minim brut pe tara de la 01.07.2026 (raspunsul expertei contabile, 20.11.2026)'),
  ('report_initial', DATE '2026-10-01', 0, 'migrare', 'prima luna a calculului; report initial 0 (confirmat de experta contabila, 25.11.2026)'),
  ('termen_stat_zi', DATE '2026-11-01', 21, 'migrare', 'termenul pentru noiembrie 2026 = 21.12.2026 (experta contabila, 25.11.2026)'),
  ('termen_stat_zi', DATE '2026-12-01', 25, 'migrare', 'din decembrie 2026 inapoi la 25 a lunii urmatoare; daca 21 e regula fiecarui decembrie, de confirmat de experta');

-- ─── 14. Postcondiții ────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE r record; v_acl text; v_pol text; v_n integer; v_amp text;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('public.upa_parametri'), ('public.upa_calcul_lunar'), ('public.upa_calcul_angajat'), ('public.upa_angajat_perioade')) v(t) LOOP
    SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") INTO v_acl FROM (
      SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
        FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = r.t::regclass) a;
    IF v_acl IS DISTINCT FROM 'authenticated:SELECT, postgres:DELETE, postgres:INSERT, postgres:MAINTAIN, postgres:REFERENCES, postgres:SELECT, postgres:TRIGGER, postgres:TRUNCATE, postgres:UPDATE'
       OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = r.t::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity
                        AND pg_get_userbyid(c.relowner) = 'postgres') THEN
      RAISE EXCEPTION '20270101a post: tabelul % (RLS / proprietar / drepturi exacte: %)', r.t, v_acl;
    END IF;
  END LOOP;
  SELECT string_agg(c.oid::regclass::text || ' ' || p.polname || ' | ' || p.polcmd::text || ' | ' || CASE WHEN p.polpermissive THEN 'P' ELSE 'R' END || ' | '
                    || (SELECT string_agg(CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END, ',' ORDER BY 1) FROM unnest(p.polroles) ro) || ' | '
                    || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' | ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'),
                    chr(10) ORDER BY c.oid::regclass::text, p.polname)
    INTO v_pol FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.oid IN ('public.upa_parametri'::regclass, 'public.upa_calcul_lunar'::regclass, 'public.upa_calcul_angajat'::regclass, 'public.upa_angajat_perioade'::regclass);
  IF v_pol IS DISTINCT FROM concat_ws(chr(10),
       'upa_angajat_perioade upa_angajat_perioade_citire_owner | r | P | authenticated | (EXISTS ( SELECT 1' || chr(10) || '   FROM profiles p' || chr(10)
         || '  WHERE ((p.id = auth.uid()) AND (p.is_owner IS TRUE)))) | -',
       'upa_calcul_angajat upa_calcul_angajat_citire_owner | r | P | authenticated | (EXISTS ( SELECT 1' || chr(10) || '   FROM profiles p' || chr(10)
         || '  WHERE ((p.id = auth.uid()) AND (p.is_owner IS TRUE)))) | -',
       'upa_calcul_lunar upa_calcul_lunar_citire | r | P | authenticated | (auth.uid() IS NOT NULL) | -',
       'upa_parametri upa_parametri_citire | r | P | authenticated | (auth.uid() IS NOT NULL) | -') THEN
    RAISE EXCEPTION '20270101a post: politicile nu sunt cele declarate: %', v_pol;
  END IF;
  -- funcțiile noi și cele înlocuite: limbaj, definer, volatilitate, search_path, proprietar, drepturile EXACTE
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_upa_parametru_la(text,date)', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_inceput_calcul()', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_pontaj_inchis(date,date)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_upa_zi_lucratoare(date)', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_calendar_lipsa(integer)', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_termen_stat(date)', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_cauza_cod(text)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_upa_nma_angajati(date)', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_rand_amprenta(integer,integer,integer,integer,integer,integer,numeric)', 'sql', false, 'i', 'postgres:EXECUTE'),
      ('public.fn_upa_amprenta_achizitii(date)', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_calcul_previziune_la(date,date,integer)', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_calcul_la(date,date,integer)', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_situatie_la(date,integer)', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_situatie(date,integer)', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_calcul_inchide_la(date,date,text,uuid)', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_upa_calcul_inchide(date,text)', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_calcul_detaliu(date)', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_parametru_seteaza(text,date,numeric,numeric,text)', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_perioada_adauga(integer,date,date,numeric,boolean,boolean,text)', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_perioada_sterge(bigint)', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_campuri_intentie_v2()', 'sql', false, 'i', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_hash_intentie_v2(jsonb)', 'sql', false, 'i', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
      ('public.fn_upa_achizitii_intentie()', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_upa_achizitie_adauga(uuid,jsonb)', 'plpgsql', false, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_alerta_inscrie(text,date,date,numeric,numeric,numeric,integer,text[],integer,text)', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_upa_alerta_rezerva_la(date)', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_upa_alerta_proba()', 'plpgsql', true, 's', 'postgres:EXECUTE, service_role:EXECUTE')
    ) v(fn, limbaj, definer, volatil, acl) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer AND p.provolatile = r.volatil
                      AND p.prokind = 'f' AND NOT p.proleakproof
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                             SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                    || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                               FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = r.acl) THEN
      RAISE EXCEPTION '20270101a post: functia % (limbaj / definer / volatil / search_path / owner / drepturi exacte)', r.fn;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['fn_upa_parametru_la', 'fn_upa_inceput_calcul',
    'fn_upa_pontaj_inchis', 'fn_upa_zi_lucratoare', 'fn_upa_calendar_lipsa', 'fn_upa_termen_stat', 'fn_upa_cauza_cod', 'fn_upa_nma_angajati',
    'fn_upa_rand_amprenta', 'fn_upa_amprenta_achizitii', 'fn_upa_calcul_previziune_la', 'fn_upa_calcul_la', 'fn_upa_situatie_la', 'fn_upa_situatie', 'fn_upa_calcul_inchide_la',
    'fn_upa_calcul_inchide', 'fn_upa_calcul_detaliu', 'fn_upa_parametru_seteaza', 'fn_upa_perioada_adauga', 'fn_upa_perioada_sterge',
    'fn_upa_campuri_intentie_v2', 'fn_upa_hash_intentie_v2', 'fn_upa_achizitii_intentie', 'fn_upa_achizitie_adauga', 'fn_upa_alerta_inscrie',
    'fn_upa_alerta_rezerva_la', 'fn_upa_alerta_proba']);
  IF v_n <> 27 THEN RAISE EXCEPTION '20270101a post: % functii cu numele noi / inlocuite (asteptat 27)', v_n; END IF;
  IF (SELECT count(*) FROM public.upa_parametri) <> 4 OR EXISTS (SELECT 1 FROM public.upa_calcul_lunar) OR EXISTS (SELECT 1 FROM public.upa_angajat_perioade) THEN
    RAISE EXCEPTION '20270101a post: parametrii de start / calculul gol';
  END IF;
  -- intrările și regulile fără date: pontajul închis din 13, salariul minim pe perioade, prima lună cu reportul inițial 0, termenele (25.11.2026
  --   pentru octombrie, fără rând = 25; 26.10.2026 când 25 e duminică; 21.12.2026 pentru noiembrie 2026; 25.01.2027 pentru decembrie 2026 —
  --   zile fără sărbători legale), codurile de suspendare (N inclus, runda 6), amprenta intenției compatibilă cu 20261229a
  IF public.fn_upa_pontaj_inchis(DATE '2026-10-01', DATE '2026-11-12') OR NOT public.fn_upa_pontaj_inchis(DATE '2026-10-01', DATE '2026-11-13')
     OR public.fn_upa_parametru_la('salariu_minim', DATE '2026-06-01') IS NOT NULL OR public.fn_upa_parametru_la('salariu_minim', DATE '2026-11-15') <> 4325
     OR public.fn_upa_inceput_calcul() <> DATE '2026-10-01' OR public.fn_upa_parametru_la('report_initial', DATE '2026-10-01') IS DISTINCT FROM 0
     OR public.fn_upa_parametru_la('termen_stat_zi', DATE '2026-10-01') IS NOT NULL
     OR public.fn_upa_termen_stat(DATE '2026-10-01') IS DISTINCT FROM DATE '2026-11-25' OR public.fn_upa_termen_stat(DATE '2026-09-01') IS DISTINCT FROM DATE '2026-10-26'
     OR public.fn_upa_termen_stat(DATE '2026-11-01') IS DISTINCT FROM DATE '2026-12-21' OR public.fn_upa_termen_stat(DATE '2026-12-01') IS DISTINCT FROM DATE '2027-01-25'
     OR public.fn_upa_cauza_cod(' cfp') IS DISTINCT FROM 'cfs' OR public.fn_upa_cauza_cod('M') IS DISTINCT FROM 'suspendare'
     OR public.fn_upa_cauza_cod('n ') IS DISTINCT FROM 'suspendare' OR public.fn_upa_cauza_cod('CO') IS NOT NULL OR public.fn_upa_cauza_cod('O') IS NOT NULL
     OR public.fn_upa_hash_intentie_v2(to_jsonb(jsonb_populate_record(NULL::public.upa_achizitii, '{"luna": "2031-05-01", "valoare": 10}')))
        IS DISTINCT FROM public.fn_upa_hash_intentie(to_jsonb(jsonb_populate_record(NULL::public.upa_achizitii, '{"luna": "2031-05-01", "valoare": 10}')))
     OR public.fn_upa_hash_intentie_v2(to_jsonb(jsonb_populate_record(NULL::public.upa_achizitii, '{"luna": "2031-05-01", "valoare": 10, "stare_plata": "neplatita"}')))
        NOT LIKE 'v2:%' THEN
    RAISE EXCEPTION '20270101a post: intrarile / regulile calculului (pontaj inchis / salariu minim / inceput / termene / coduri / amprenta intentiei)';
  END IF;
  -- AMPRENTA_20270101a_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul; PG17 / PG18: NOT NULL-urile din pg_constraint scoase)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'rel ' || c.relname || ' ' || c.relkind::text || ' own=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(c.relacl) e) a), '-') AS l
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade',
                                                                     'upa_angajat_perioade_id_seq')
    UNION ALL
    SELECT 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' id=' || a.attidentity::text
           || ' gen=' || a.attgenerated::text || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || ' acl=' || coalesce((SELECT string_agg(e.d, ',' ORDER BY e.d COLLATE "C") FROM (
                SELECT CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ':' || x.privilege_type
                       || CASE WHEN x.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(a.attacl) x) e), '-')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
            OR (c.relname = 'upa_achizitii' AND a.attname IN ('valoare_fara_tva', 'data_plata', 'stare_plata')))
    UNION ALL
    SELECT 'con ' || c.relname || ' ' || k.conname || ' ' || k.contype::text || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype <> 'n' AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
            OR (c.relname = 'upa_achizitii' AND k.conname IN ('upa_achizitii_fara_tva_interval', 'upa_achizitii_stare_plata'))
            OR (c.relname = 'upa_alerta_jurnal' AND k.conname IN ('upa_alerta_jurnal_fel', 'upa_alerta_jurnal_forma_cheie')))
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' own=' || pg_get_userbyid(ic.relowner)
      FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE t.relnamespace = 'public'::regnamespace AND t.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
    UNION ALL
    SELECT 'trg ' || c.relname || ' ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
    UNION ALL
    -- ORICE obiect care depinde de coloanele noi din upa_achizitii (DROP COLUMN le-ar scoate tăcut la revenire)
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> upa_achizitii.' || a.attname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
     WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.upa_achizitii'::regclass AND a.attname IN ('valoare_fara_tva', 'data_plata', 'stare_plata')
    UNION ALL
    -- orice obiect care depinde de tabelele noi (vederi, chei străine, politici în alte tabele): DROP TABLE fără CASCADE ar pica, dar se vede aici
    SELECT 'deptab ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> ' || c.relname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_class c ON c.oid = d.refobjid
     WHERE d.refclassid = 'pg_class'::regclass AND c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
       AND d.deptype = 'n' AND d.classid <> 'pg_class'::regclass
    UNION ALL
    SELECT 'pol ' || c.relname || ' ' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(rl.nume, ',' ORDER BY rl.nume COLLATE "C") FROM (
                SELECT CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END AS nume FROM unnest(p.polroles) ro) rl), '-')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat', 'upa_angajat_perioade')
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_upa_parametru_la', 'fn_upa_inceput_calcul', 'fn_upa_pontaj_inchis',
             'fn_upa_zi_lucratoare', 'fn_upa_calendar_lipsa', 'fn_upa_termen_stat', 'fn_upa_cauza_cod', 'fn_upa_nma_angajati', 'fn_upa_rand_amprenta',
             'fn_upa_amprenta_achizitii', 'fn_upa_calcul_previziune_la', 'fn_upa_calcul_la', 'fn_upa_situatie_la', 'fn_upa_situatie', 'fn_upa_calcul_inchide_la', 'fn_upa_calcul_inchide',
             'fn_upa_calcul_detaliu', 'fn_upa_parametru_seteaza', 'fn_upa_perioada_adauga', 'fn_upa_perioada_sterge', 'fn_upa_campuri_intentie_v2',
             'fn_upa_hash_intentie_v2', 'fn_upa_achizitii_intentie', 'fn_upa_achizitie_adauga', 'fn_upa_alerta_inscrie', 'fn_upa_alerta_rezerva_la',
             'fn_upa_alerta_proba')
  ) x;
  -- AMPRENTA_20270101a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '10d0f74e66c5b40b4dda297d1df21edc' THEN
    RAISE NOTICE 'AMPRENTA_20270101a_TEXT %', v_amp;
    RAISE EXCEPTION '20270101a post: AMPRENTA obiectelor % (asteptat 10d0f74e66c5b40b4dda297d1df21edc)', md5(coalesce(v_amp, ''));
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270101a_administrativ_upa_calcul:' || txid_current() THEN
    RAISE EXCEPTION '20270101a: garda final invalida';
  END IF;
  RAISE NOTICE '20270101a: sfarsit la % ms de la BEGIN; lock-urile pe upa_achizitii / upa_alerta_jurnal tinute de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
