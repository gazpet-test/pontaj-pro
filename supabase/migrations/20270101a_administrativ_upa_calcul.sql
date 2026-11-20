-- Version 20270101120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270101a_administrativ_upa_calcul.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 (docs/LIVRARE_L15_V2.md): lista OBIECTELOR (familie, etichetă, operație — verificată pe PGlite cu pașii reali ai runnerului) e în
--   supabase/tests/20270101a_administrativ_upa_calcul.l15.obiecte.tsv; manifestul .l15.tsv îl generează coordonatorul pe clonă.
-- 20270101a_administrativ_upa_calcul — Administrativ → Unități protejate (UPA): contribuția pentru fondul de handicap CALCULATĂ după răspunsul
--   expertului contabil (decizia owner-ului, 20.11.2026; docs/administrativ/UPA_CALCUL_EXPERT.md). Înlocuiește plafonul fix din setări.
--
-- Formula (pe luna M; o singură definiție: fn_upa_calcul_la, L19):
--   NMA = Σ_angajați (zile calcul − zile CFS − zile suspendare) × normă / zilele calendaristice ale lunii, rotunjit la 2 zecimale
--     zile calcul = zilele lunii minus cele dinaintea angajării (employees.hire_date) și de după încetare (employees.termination_date, inclusiv)
--     normă = employees.procent_ocupare / 100 (= ore normă / 8, durata normală); CFS = cod pontaj 'CFP'; suspendare = cod pontaj 'SUSP'
--     administratorii (hr_decizii_semnatari activ, calitate 'Administrator') se scot din calcul
--   locuri neocupate = max(floor(4% × NMA) − angajați cu handicap, 0); 0 sub 50 de angajați (Legea 448/2006 art. 78)
--   suma datorată D = locuri × 50% × salariul minim brut al lunii (upa_parametri 'salariu_minim', pe perioade)
--   achiziții A = Σ upa_achizitii.valoare_fara_tva ale lunii, plătite până la ultima zi a lunii (data_plata)
--   disponibil = A + report intrat (report ieșit al lunii M−1; la prima lună a calculului = upa_parametri 'report_initial')
--   deducere = min(disponibil, D / 2); de plată la stat = D − deducere (până pe 25 a lunii următoare); report ieșit = disponibil − deducere
--   (expertul: achiziții < D/2 -> se plătește diferența întreagă; achiziții > D/2 -> se plătește D/2, diferența se reportează)
-- Stări: PREVIZIUNE până la închiderea pontajului (corecturile libere țin până pe 12 a lunii următoare, src/pontajLunaInchisa.js: pontajul lunii
--   e închis de pe 13), apoi calculul se ÎNCHIDE o dată (upa_calcul_lunar + detaliul pe angajat în upa_calcul_angajat, nemodificabile) dacă
--   nu lipsește nimic (blocaje); luna închisă = valoarea exactă, auditabilă (intrările, rezultatul, avertismentele, versiunea formulei).
--
-- Ce face:
--   * upa_parametri (cheie, de_la, valoare): salariul minim pe perioade (seed: 4.325 lei de la 01.07.2026, răspunsul expertului), numărul
--     angajaților cu handicap pe perioade (FĂRĂ seed: nu există în ERP, îl pune owner-ul / editorul din ecran; până atunci calculul e blocat),
--     reportul inițial (seed: 0 de la 01.10.2026 = prima lună a calculului; schimbabil cât nu e închisă nicio lună). Scris doar prin
--     fn_upa_parametru_seteaza (fn_upa_poate_scrie, CAS, refuz dacă o lună închisă folosește deja valoarea).
--   * upa_achizitii.valoare_fara_tva (NULL = necompletat; > 0 și <= valoare) + data_plata; intră în intenția salvării din formular
--     (fn_upa_campuri_intentie / fn_upa_achizitie_adauga înlocuite: aceleași reguli, plus cele 2 câmpuri).
--   * fn_upa_nma_angajati, fn_upa_calcul_la (intern), fn_upa_situatie (ecranul: lunile + luna curentă cu in_alerta = singura definiție a
--     alertei), fn_upa_calcul_inchide_la (intern) / fn_upa_calcul_inchide (ecranul, editor), fn_upa_calcul_detaliu (owner: pe angajat).
--   * Alerta (fn_upa_alerta_rezerva_la / _proba / _inscrie înlocuite): alerta zilei = PREVIZIUNE (mai sunt X lei de cumpărat ca să se
--     folosească toată deducerea); închiderea = calculul exact după pontaj (de plată la stat, termenul 25, reportul); calcul blocat = notificare
--     zilnică (owner + Administrativ / UPA). Vechiul upa_luna_inchisa nu mai primește rânduri (rămâne istoric); upa_plafon_lunar / fn_upa_luni /
--     fn_upa_plafon_seteaza / fn_upa_erori_config rămân neatinse (folosite doar de ecranul vechi până la merge; retragerea = migrare separată).
-- Ce NU face: nu modifică employees / pontaj_records / hr_decizii_semnatari (doar le citește), nu trimite nimic, nu schimbă drepturi pe module,
--   nu schimbă cronul (jobid 29, zilnic) și nici logistica_setari.
-- ORDINEA LIVRĂRII (docs/administrativ/UPA_CALCUL_EXPERT.md): edge-ul upa-plafon-alerta v11 (merge cu ambele forme ale rezervării) ->
--   migrarea -> merge-ul ecranului -> parametrii (numărul angajaților cu handicap) din ecran. Între migrare și merge ecranul vechi arată
--   plafonul vechi (fn_upa_luni neatins), iar formularul vechi salvează fără valoarea fără TVA (rândul rămâne de completat).
-- Ordinea lock-urilor (L06), aceeași pe toate căile: lock consultativ hashtext('upa_alerta_jurnal') (doar rezervarea) -> lock consultativ
--   hashtext('upa_calcul_lunar') (închiderea, parametrii) -> upa_calcul_lunar (INSERT) -> upa_calcul_angajat (INSERT) -> upa_alerta_jurnal ->
--   notifications. Nicio cale nu blochează upa_achizitii / employees / pontaj_records (citiri READ COMMITTED; închiderea reverifică în aceeași
--   subtranzacție că detaliul scris dă exact NMA-ul calculat, altfel nu închide).
-- Lock-uri la aplicare (punct unic, NOWAIT, bugetul 1 s de la prima încercare): upa_achizitii ACCESS EXCLUSIVE (ADD COLUMN x2 + CHECK pe
--   coloana nouă, NULL peste tot: fără rescriere, CHECK-ul trivial). Înlocuirea funcțiilor din 20261229a: fără lock pe tabele.
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
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY['fn_upa_parametru_la', 'fn_upa_inceput_calcul',
                  'fn_upa_pontaj_inchis', 'fn_upa_nma_angajati', 'fn_upa_calcul_la', 'fn_upa_situatie', 'fn_upa_calcul_inchide_la', 'fn_upa_calcul_inchide',
                  'fn_upa_calcul_detaliu', 'fn_upa_parametru_seteaza']))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.upa_achizitii'::regclass AND a.attname IN ('valoare_fara_tva', 'data_plata') AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.upa_achizitii'::regclass AND c.conname = 'upa_achizitii_fara_tva_interval') THEN
    RAISE EXCEPTION '20270101a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite (tabelele HR / pontaj sunt create direct în producție: se verifică, nu se presupun)
  FOR r IN SELECT * FROM (VALUES
      ('employees', 'id', 'integer|bigint'), ('employees', 'active', 'boolean'), ('employees', 'hire_date', 'date'),
      ('employees', 'termination_date', 'date'), ('employees', 'procent_ocupare', 'numeric|integer|smallint|real|double precision'),
      ('employees', 'name', 'text|character varying'),
      ('pontaj_records', 'employee_id', 'integer|bigint'), ('pontaj_records', 'date', 'date'), ('pontaj_records', 'norma', 'text|character varying'),
      ('hr_decizii_semnatari', 'employee_id', 'integer|bigint'), ('hr_decizii_semnatari', 'calitate', 'text|character varying'),
      ('hr_decizii_semnatari', 'activ', 'boolean'),
      ('upa_achizitii', 'valoare', 'numeric'), ('upa_achizitii', 'luna', 'date'), ('upa_achizitii', 'cheie_intentie', 'uuid')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20270101a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  -- funcțiile din 20261229a pe care migrarea le înlocuiește / le folosește: EXACT forma revizuită (sursa md5, limbaj, definer, proprietar,
  --   search_path, drepturi); revenirea le reface identic, deci o abatere de azi s-ar pierde tăcut -> refuz
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_upa_campuri_intentie()', '4e4b376f96d4dd342fa4f1bb7ca8e77c', 'sql', false, 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
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
END $pre$;

-- ── lock-ul pe upa_achizitii (punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare; momentul în gazpet.lock_puternic_la pentru LOCK_TINUT) ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270101a: BUGET_LOCK: upa_achizitii ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
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
    RAISE EXCEPTION '20270101a: BUGET_LOCK: lock-ul pe upa_achizitii obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270101a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. upa_achizitii: valoarea fără TVA și data plății ─────────────────────────────────────────────────────────────────
-- NULL = necompletat (rândurile vechi și Citește Orice / formularul vechi): luna lor nu se poate închide până se completează (blocaj vizibil, L18)
ALTER TABLE public.upa_achizitii ADD COLUMN valoare_fara_tva numeric(12,2);
ALTER TABLE public.upa_achizitii ADD COLUMN data_plata date;
ALTER TABLE public.upa_achizitii ADD CONSTRAINT upa_achizitii_fara_tva_interval
  CHECK (valoare_fara_tva IS NULL OR (valoare_fara_tva > 0 AND valoare_fara_tva <= valoare));
COMMENT ON COLUMN public.upa_achizitii.valoare_fara_tva IS 'UPA (20270101a): valoarea facturii FARA TVA (se deduce din contributie); NULL = necompletat, luna nu se poate inchide.';
COMMENT ON COLUMN public.upa_achizitii.data_plata IS 'UPA (20270101a): data platii catre unitatea protejata; se deduce doar factura platita pana la ultima zi a lunii.';

-- ─── 2. Tabelele ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.upa_parametri (
  cheie text NOT NULL,
  de_la date NOT NULL,
  valoare numeric(12,2) NOT NULL,
  sursa text NOT NULL,
  nota text,
  setat_de uuid,
  setat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upa_parametri_pk PRIMARY KEY (cheie, de_la),
  CONSTRAINT upa_parametri_cheie CHECK (cheie = ANY (ARRAY['salariu_minim'::text, 'angajati_handicap'::text, 'report_initial'::text])),
  CONSTRAINT upa_parametri_prima_zi CHECK (extract(day FROM de_la) = 1),
  CONSTRAINT upa_parametri_valoare CHECK (valoare >= 0 AND valoare < 10000000
    AND (cheie <> 'salariu_minim' OR valoare > 0) AND (cheie <> 'angajati_handicap' OR valoare = trunc(valoare))),
  CONSTRAINT upa_parametri_sursa CHECK (sursa = ANY (ARRAY['ecran'::text, 'migrare'::text])),
  CONSTRAINT upa_parametri_autor CHECK ((sursa = 'ecran') = (setat_de IS NOT NULL)),
  CONSTRAINT upa_parametri_nota CHECK (nota IS NULL OR length(nota) <= 300)
);
COMMENT ON TABLE public.upa_parametri IS 'UPA (20270101a): intrarile calculului pe perioade (valabile de la luna randului pana la urmatorul rand al cheii): salariu_minim, angajati_handicap, report_initial (prima luna a calculului). Scris doar prin fn_upa_parametru_seteaza.';

CREATE TABLE public.upa_calcul_lunar (
  luna date PRIMARY KEY,
  zile_luna integer NOT NULL,
  nr_angajati integer NOT NULL,
  nma numeric(10,2) NOT NULL,
  angajati_handicap numeric(12,2) NOT NULL,
  locuri integer NOT NULL,
  salariu_minim numeric(12,2) NOT NULL,
  suma_datorata numeric(12,2) NOT NULL,
  achizitii_fara_tva numeric(12,2) NOT NULL,
  nr_achizitii integer NOT NULL,
  report_intrat numeric(12,2) NOT NULL,
  deducere numeric(12,2) NOT NULL,
  de_plata numeric(12,2) NOT NULL,
  report_iesit numeric(12,2) NOT NULL,
  termen_stat date NOT NULL,
  avertismente text[] NOT NULL DEFAULT '{}',
  versiune text NOT NULL,
  inchis_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upa_calcul_lunar_prima_zi CHECK (extract(day FROM luna) = 1),
  CONSTRAINT upa_calcul_lunar_valori CHECK (zile_luna BETWEEN 28 AND 31 AND nr_angajati >= 0 AND nma >= 0 AND locuri >= 0 AND salariu_minim > 0
    AND suma_datorata >= 0 AND achizitii_fara_tva >= 0 AND nr_achizitii >= 0 AND report_intrat >= 0),
  CONSTRAINT upa_calcul_lunar_regula CHECK (deducere = least(achizitii_fara_tva + report_intrat, round(suma_datorata / 2, 2))
    AND de_plata = suma_datorata - deducere AND report_iesit = achizitii_fara_tva + report_intrat - deducere
    AND suma_datorata = round(locuri * salariu_minim / 2, 2)),
  CONSTRAINT upa_calcul_lunar_termen CHECK (termen_stat = (luna + interval '1 month')::date + 24)
);
COMMENT ON TABLE public.upa_calcul_lunar IS 'UPA (20270101a): calculul EXACT al unei luni, dupa inchiderea pontajului (NMA, suma datorata, achizitii fara TVA, report, deducere, de plata la stat pana pe 25). Scris O DATA de fn_upa_calcul_inchide_la; nemodificabil.';

CREATE TABLE public.upa_calcul_angajat (
  luna date NOT NULL REFERENCES public.upa_calcul_lunar(luna),
  employee_id integer NOT NULL,
  zile_calcul integer NOT NULL,
  zile_cfs integer NOT NULL,
  zile_suspendare integer NOT NULL,
  norma numeric(6,4) NOT NULL,
  contributie numeric(12,4) NOT NULL,
  CONSTRAINT upa_calcul_angajat_pk PRIMARY KEY (luna, employee_id),
  CONSTRAINT upa_calcul_angajat_valori CHECK (zile_calcul BETWEEN 1 AND 31 AND zile_cfs >= 0 AND zile_suspendare >= 0
    AND zile_cfs + zile_suspendare <= zile_calcul AND norma > 0 AND norma <= 1
    AND contributie = (zile_calcul - zile_cfs - zile_suspendare) * norma)
);
COMMENT ON TABLE public.upa_calcul_angajat IS 'UPA (20270101a): detaliul NMA al unei luni inchise, pe angajat (zile calcul, CFS, suspendare, norma). Citire doar owner; nemodificabil.';

-- instantaneele nu se schimbă pe nicio cale (L07): triggerul de nemodificare din 20261229a (aceeași regulă)
CREATE TRIGGER trg_upa_calcul_lunar_nemodificabil BEFORE UPDATE OR DELETE ON public.upa_calcul_lunar
  FOR EACH ROW EXECUTE FUNCTION public.fn_upa_luna_inchisa_nemodificabil();
CREATE TRIGGER trg_upa_calcul_angajat_nemodificabil BEFORE UPDATE OR DELETE ON public.upa_calcul_angajat
  FOR EACH ROW EXECUTE FUNCTION public.fn_upa_luna_inchisa_nemodificabil();

-- ─── 3. Intrările calculului ─────────────────────────────────────────────────────────────────────────────────────────────
-- valoarea unei chei în luna dată = ultimul rând cu de_la <= luna; NULL = neînregistrat (necunoscut, nu 0 — L18)
CREATE FUNCTION public.fn_upa_parametru_la(p_cheie text, p_luna date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT p.valoare FROM public.upa_parametri p
   WHERE p.cheie = p_cheie AND p.de_la <= date_trunc('month', p_luna::timestamp)::date ORDER BY p.de_la DESC LIMIT 1
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_parametru_la(text, date) FROM PUBLIC, anon, authenticated, service_role;
-- prima lună a calculului (rândul report_initial); NULL = nestabilită
CREATE FUNCTION public.fn_upa_inceput_calcul() RETURNS date
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT min(p.de_la) FROM public.upa_parametri p WHERE p.cheie = 'report_initial'
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_inceput_calcul() FROM PUBLIC, anon, authenticated, service_role;
-- pontajul lunii e închis din ziua 13 a lunii următoare (corecturile libere țin până pe 12: src/pontajLunaInchisa.js, ZI_TERMEN_CORECTURI)
CREATE FUNCTION public.fn_upa_pontaj_inchis(p_luna date, p_azi date) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT p_azi > (date_trunc('month', p_luna::timestamp) + interval '1 month' + interval '11 days')::date
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_pontaj_inchis(date, date) FROM PUBLIC, anon, authenticated, service_role;

-- NMA pe angajat (expertul contabil, 20.11.2026): zile calcul = zilele lunii între angajare și încetare (inclusiv); CFS = zilele cu codul de
--   pontaj 'CFP' (concediu fără plată), suspendare = codul 'SUSP' (propus: azi nu există în ERP nicio evidență a suspendărilor); normă =
--   procent_ocupare / 100 (NULL = 100%, semnalat). Intră: angajații activi și cei cu dată de încetare; cei inactivi FĂRĂ dată de încetare nu
--   au o perioadă cunoscută (semnalați de fn_upa_calcul_la). Administratorii (hr_decizii_semnatari activ, calitate 'Administrator') se scot.
CREATE FUNCTION public.fn_upa_nma_angajati(p_luna date)
RETURNS TABLE (employee_id integer, zile_calcul integer, zile_cfs integer, zile_suspendare integer, norma numeric, contributie numeric,
               fara_data_angajare boolean, fara_norma boolean)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  WITH z AS (SELECT date_trunc('month', p_luna::timestamp)::date AS l0,
                    (date_trunc('month', p_luna::timestamp) + interval '1 month' - interval '1 day')::date AS l1),
  e AS (SELECT em.id::integer AS id, greatest(coalesce(em.hire_date, z.l0), z.l0) AS d0, least(coalesce(em.termination_date, z.l1), z.l1) AS d1,
               (coalesce(em.procent_ocupare, 100) / 100.0)::numeric(6,4) AS norma, em.hire_date IS NULL AS fara_angajare, em.procent_ocupare IS NULL AS fara_norma
          FROM public.employees em CROSS JOIN z
         WHERE (em.active IS TRUE OR em.termination_date IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM public.hr_decizii_semnatari s
                            WHERE s.employee_id = em.id AND s.activ IS TRUE AND lower(btrim(s.calitate)) = 'administrator'))
  SELECT e.id, (e.d1 - e.d0 + 1), c.cfs, c.susp, e.norma, ((e.d1 - e.d0 + 1) - c.cfs - c.susp) * e.norma, e.fara_angajare, e.fara_norma
    FROM e CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE upper(btrim(p.norma)) = 'CFP')::integer AS cfs,
                                      count(*) FILTER (WHERE upper(btrim(p.norma)) = 'SUSP')::integer AS susp
                                 FROM public.pontaj_records p WHERE p.employee_id = e.id AND p.date BETWEEN e.d0 AND e.d1) c
   WHERE e.d0 <= e.d1
   ORDER BY e.id
$f$;
REVOKE ALL ON FUNCTION public.fn_upa_nma_angajati(date) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 4. Calculul unei luni (definiția unică, L19) ─────────────────────────────────────────────────────────────────────────
-- jsonb: stare 'definitiv' (rândul închis + achizitii_acum, pentru diferențele de după închidere) | 'previziune' | 'in_afara_calculului'
--   (înaintea primei luni a calculului). blocaje = ce oprește închiderea (lista de coduri); avertismente = ce se ia în seamă, dar nu oprește.
--   Achizițiile: cât luna e în curs, cele neplătite încă se numără (previziune: se presupune plata la termen); după ultima zi, doar cele plătite
--   până la ultima zi; fără valoare fără TVA sau, după lună, fără data plății = blocaj (luna nu se închide până se completează).
--   Reportul intrat: luna anterioară închisă; la prima lună = report_initial; altfel (lună anterioară neînchisă) = previziunea ei (cel mult 2
--   niveluri, p_adancime), cu blocajul luna_anterioara_neinchisa.
CREATE FUNCTION public.fn_upa_calcul_la(p_luna date, p_azi date, p_adancime integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v_l date; v_l1 date; v_s public.upa_calcul_lunar; v_start date; v_zile integer; v_sum numeric; v_n integer; v_fa integer; v_fn integer;
        v_inact integer; v_nma numeric; v_sal numeric; v_hand numeric; v_loc integer; v_d numeric; v_jum numeric; v_a numeric; v_na integer;
        v_neplatit numeric; v_ftva integer; v_fplata integer; v_tarziu integer; v_rin numeric; v_ant jsonb; v_ded numeric; v_plata numeric;
        v_rout numeric; v_ramas numeric; v_bl text[] := '{}'; v_av text[] := '{}'; v_acum numeric; v_inchis boolean; v_final boolean;
BEGIN
  IF p_luna IS NULL OR p_azi IS NULL THEN RAISE EXCEPTION 'upa: luna si ziua sunt obligatorii' USING ERRCODE = '22023'; END IF;
  v_l := date_trunc('month', p_luna::timestamp)::date;
  v_l1 := (v_l + interval '1 month' - interval '1 day')::date;
  SELECT coalesce(sum(a.valoare_fara_tva), 0) INTO v_acum FROM public.upa_achizitii a WHERE a.luna >= v_l AND a.luna <= v_l1;
  SELECT * INTO v_s FROM public.upa_calcul_lunar c WHERE c.luna = v_l;
  IF FOUND THEN
    RETURN to_jsonb(v_s) || jsonb_build_object('stare', 'definitiv', 'pontaj_inchis', true, 'poate_inchide', false,
      'jumatate', round(v_s.suma_datorata / 2, 2), 'ramas_de_cumparat', 0, 'termen_upa', v_l1, 'achizitii_acum', v_acum,
      'blocaje', '[]'::jsonb, 'avertismente', to_jsonb(v_s.avertismente));
  END IF;
  v_start := public.fn_upa_inceput_calcul();
  IF v_start IS NULL OR v_l < v_start THEN
    RETURN jsonb_build_object('luna', v_l, 'stare', 'in_afara_calculului', 'poate_inchide', false, 'termen_upa', v_l1,
      'termen_stat', (v_l + interval '1 month')::date + 24, 'achizitii_acum', v_acum,
      'blocaje', to_jsonb(ARRAY[CASE WHEN v_start IS NULL THEN 'fara_inceput_calcul' ELSE 'inainte_de_inceput' END]), 'avertismente', '[]'::jsonb);
  END IF;
  v_inchis := public.fn_upa_pontaj_inchis(v_l, p_azi);
  v_final := p_azi > v_l1;
  v_zile := v_l1 - v_l + 1;
  -- NMA
  SELECT coalesce(sum(x.contributie), 0), count(*)::integer, (count(*) FILTER (WHERE x.fara_data_angajare))::integer,
         (count(*) FILTER (WHERE x.fara_norma))::integer
    INTO v_sum, v_n, v_fa, v_fn FROM public.fn_upa_nma_angajati(v_l) x;
  v_nma := round(v_sum / v_zile, 2);
  SELECT count(*)::integer INTO v_inact FROM public.employees em
   WHERE em.active IS NOT TRUE AND em.termination_date IS NULL
     AND EXISTS (SELECT 1 FROM public.pontaj_records p WHERE p.employee_id = em.id AND p.date BETWEEN v_l AND v_l1);
  IF v_fa > 0 THEN v_av := v_av || ('angajati_fara_data_angajarii:' || v_fa); END IF;
  IF v_fn > 0 THEN v_av := v_av || ('angajati_fara_norma:' || v_fn); END IF;
  IF v_inact > 0 THEN v_av := v_av || ('inactivi_fara_data_incetarii_cu_pontaj:' || v_inact); END IF;
  IF NOT v_inchis THEN v_av := v_av || 'pontaj_neinchis'::text; END IF;
  -- intrările pe perioade
  v_sal := public.fn_upa_parametru_la('salariu_minim', v_l);
  v_hand := public.fn_upa_parametru_la('angajati_handicap', v_l);
  IF v_sal IS NULL THEN v_bl := v_bl || 'fara_salariu_minim'::text; END IF;
  IF v_hand IS NULL THEN v_bl := v_bl || 'fara_nr_handicap'::text; END IF;
  IF v_sal IS NOT NULL AND v_hand IS NOT NULL THEN
    v_loc := CASE WHEN v_nma < 50 THEN 0 ELSE greatest(floor(v_nma * 0.04)::integer - v_hand::integer, 0) END;
    IF v_nma < 50 THEN v_av := v_av || 'sub_50_angajati'::text; END IF;
    v_d := round(v_loc * v_sal / 2, 2);
    v_jum := round(v_d / 2, 2);
  END IF;
  -- achizițiile lunii (fără TVA)
  SELECT count(*)::integer, (count(*) FILTER (WHERE a.valoare_fara_tva IS NULL))::integer,
         (count(*) FILTER (WHERE a.data_plata IS NULL))::integer, (count(*) FILTER (WHERE a.data_plata > v_l1))::integer,
         coalesce(sum(a.valoare_fara_tva) FILTER (WHERE a.data_plata <= v_l1), 0),
         coalesce(sum(a.valoare_fara_tva) FILTER (WHERE a.data_plata IS NULL), 0)
    INTO v_na, v_ftva, v_fplata, v_tarziu, v_a, v_neplatit
    FROM public.upa_achizitii a WHERE a.luna >= v_l AND a.luna <= v_l1;
  IF v_ftva > 0 THEN
    IF v_final THEN v_bl := v_bl || ('achizitii_fara_tva:' || v_ftva); ELSE v_av := v_av || ('achizitii_fara_tva:' || v_ftva); END IF;
  END IF;
  IF v_final THEN
    IF v_fplata > 0 THEN v_bl := v_bl || ('achizitii_fara_data_platii:' || v_fplata); END IF;
  ELSE
    IF v_fplata > 0 THEN v_av := v_av || ('achizitii_neplatite:' || v_fplata); END IF;
    v_a := v_a + v_neplatit;
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
    'poate_inchide', v_inchis AND cardinality(v_bl) = 0 AND v_ded IS NOT NULL,
    'zile_luna', v_zile, 'nr_angajati', v_n, 'nma', v_nma, 'salariu_minim', v_sal, 'angajati_handicap', v_hand, 'locuri', v_loc,
    'suma_datorata', v_d, 'jumatate', v_jum, 'achizitii_fara_tva', v_a, 'nr_achizitii', v_na, 'achizitii_neplatite', v_neplatit,
    'achizitii_acum', v_acum, 'report_intrat', v_rin, 'deducere', v_ded, 'de_plata', v_plata, 'report_iesit', v_rout,
    'ramas_de_cumparat', v_ramas, 'termen_upa', v_l1, 'termen_stat', (v_l + interval '1 month')::date + 24,
    'blocaje', to_jsonb(v_bl), 'avertismente', to_jsonb(v_av), 'versiune', 'v1-20270101a');
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_calcul_la(date, date, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 5. Situația pentru ecran (lunile + luna curentă cu in_alerta: SINGURA definiție a alertei, folosită și de rezervare) ─────
-- in_alerta (luna curentă, previziune): ziua >= pragul (upa_alerta_zi, plafonat la ultima zi) ȘI mai e de cumpărat (ramas_de_cumparat > 0)
--   ȘI configurarea e în regulă; NULL = necunoscut. erori_config: setare_zi_invalida / fara_inceput_calcul / fara_salariu_minim / fara_nr_handicap.
--   Doar agregate (NMA, sume): detaliul pe angajat e la fn_upa_calcul_detaliu (owner).
CREATE FUNCTION public.fn_upa_situatie(p_azi date DEFAULT NULL, p_luni integer DEFAULT 12) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_azi date := coalesce(p_azi, (now() AT TIME ZONE 'Europe/Bucharest')::date); v_luna date; v_ultima date; v_txt text; v_prag integer;
        v_luni jsonb; v_cur jsonb; v_cfg text[] := '{}'; v_alerta boolean;
BEGIN
  IF p_luni IS NULL OR p_luni < 1 OR p_luni > 36 THEN RAISE EXCEPTION 'upa: p_luni intre 1 si 36' USING ERRCODE = '22023'; END IF;
  v_luna := date_trunc('month', v_azi::timestamp)::date;
  v_ultima := (v_luna + interval '1 month' - interval '1 day')::date;
  SELECT s.value INTO v_txt FROM public.logistica_setari s WHERE s.key = 'upa_alerta_zi';
  IF btrim(v_txt) ~ '^[0-9]{1,2}$' AND btrim(v_txt)::integer BETWEEN 1 AND 31 THEN
    v_prag := least(btrim(v_txt)::integer, extract(day FROM v_ultima)::integer);
  END IF;
  SELECT jsonb_agg(public.fn_upa_calcul_la((v_luna - make_interval(months => g.g))::date, v_azi) ORDER BY g.g) INTO v_luni
    FROM generate_series(0, p_luni - 1) AS g(g);
  v_cur := v_luni -> 0;
  IF v_prag IS NULL THEN v_cfg := v_cfg || 'setare_zi_invalida'::text; END IF;
  IF v_cur -> 'blocaje' ? 'fara_inceput_calcul' THEN v_cfg := v_cfg || 'fara_inceput_calcul'::text; END IF;
  IF v_cur -> 'blocaje' ? 'fara_salariu_minim' THEN v_cfg := v_cfg || 'fara_salariu_minim'::text; END IF;
  IF v_cur -> 'blocaje' ? 'fara_nr_handicap' THEN v_cfg := v_cfg || 'fara_nr_handicap'::text; END IF;
  IF cardinality(v_cfg) = 0 AND v_cur ->> 'stare' = 'previziune' AND v_cur ? 'ramas_de_cumparat' AND jsonb_typeof(v_cur -> 'ramas_de_cumparat') = 'number' THEN
    v_alerta := extract(day FROM v_azi)::integer >= v_prag AND (v_cur ->> 'ramas_de_cumparat')::numeric > 0;
  END IF;
  RETURN jsonb_build_object('azi', v_azi, 'luna_curenta', v_luna, 'zi_prag', v_prag, 'zile_ramase', v_ultima - v_azi + 1,
    'in_alerta', v_alerta, 'erori_config', to_jsonb(v_cfg), 'inceput_calcul', public.fn_upa_inceput_calcul(), 'luni', v_luni);
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_situatie(date, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_situatie(date, integer) TO authenticated;
COMMENT ON FUNCTION public.fn_upa_situatie(date, integer) IS 'UPA (20270101a): situatia pe luni (calculul fiecarei luni: previziune / definitiv) + in_alerta pentru luna curenta. Definitia unica: ecran + fn_upa_alerta_rezerva.';

-- ─── 6. Închiderea calculului (o dată, după pontaj, fără blocaje) ──────────────────────────────────────────────────────────
-- Lock-uri (L06): lock consultativ hashtext('upa_calcul_lunar') -> upa_calcul_lunar (INSERT .. ON CONFLICT DO NOTHING) -> upa_calcul_angajat.
--   Detaliul se recitește după scriere: dacă nu dă exact NMA-ul (pontajul s-a schimbat între cele două citiri), subtranzacția se anulează și
--   luna rămâne neînchisă (se reîncearcă la rularea următoare). Întoarce calculul definitiv sau NULL (nimic închis).
CREATE FUNCTION public.fn_upa_calcul_inchide_la(p_luna date, p_azi date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_c jsonb; v_l date; v_nma numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('upa_calcul_lunar'));
  v_c := public.fn_upa_calcul_la(p_luna, p_azi);
  IF v_c ->> 'stare' IS DISTINCT FROM 'previziune' OR (v_c ->> 'poate_inchide')::boolean IS NOT TRUE THEN RETURN NULL; END IF;
  BEGIN
    INSERT INTO public.upa_calcul_lunar AS c (luna, zile_luna, nr_angajati, nma, angajati_handicap, locuri, salariu_minim, suma_datorata,
                                              achizitii_fara_tva, nr_achizitii, report_intrat, deducere, de_plata, report_iesit, termen_stat,
                                              avertismente, versiune)
    VALUES ((v_c ->> 'luna')::date, (v_c ->> 'zile_luna')::integer, (v_c ->> 'nr_angajati')::integer, (v_c ->> 'nma')::numeric,
            (v_c ->> 'angajati_handicap')::numeric, (v_c ->> 'locuri')::integer, (v_c ->> 'salariu_minim')::numeric,
            (v_c ->> 'suma_datorata')::numeric, (v_c ->> 'achizitii_fara_tva')::numeric, (v_c ->> 'nr_achizitii')::integer,
            (v_c ->> 'report_intrat')::numeric, (v_c ->> 'deducere')::numeric, (v_c ->> 'de_plata')::numeric, (v_c ->> 'report_iesit')::numeric,
            (v_c ->> 'termen_stat')::date, ARRAY(SELECT jsonb_array_elements_text(v_c -> 'avertismente')), v_c ->> 'versiune')
    ON CONFLICT (luna) DO NOTHING
    RETURNING c.luna INTO v_l;
    IF v_l IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.upa_calcul_angajat (luna, employee_id, zile_calcul, zile_cfs, zile_suspendare, norma, contributie)
    SELECT v_l, x.employee_id, x.zile_calcul, x.zile_cfs, x.zile_suspendare, x.norma, x.contributie FROM public.fn_upa_nma_angajati(v_l) x;
    SELECT round(coalesce(sum(a.contributie), 0) / (v_c ->> 'zile_luna')::integer, 2) INTO v_nma FROM public.upa_calcul_angajat a WHERE a.luna = v_l;
    IF v_nma IS DISTINCT FROM (v_c ->> 'nma')::numeric
       OR (SELECT count(*) FROM public.upa_calcul_angajat a WHERE a.luna = v_l) <> (v_c ->> 'nr_angajati')::integer THEN
      RAISE EXCEPTION 'upa: detaliul nu da NMA-ul calculat' USING ERRCODE = 'UPA04';
    END IF;
  EXCEPTION WHEN SQLSTATE 'UPA04' THEN
    RETURN NULL;
  END;
  RETURN public.fn_upa_calcul_la(v_l, p_azi);
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_calcul_inchide_la(date, date) FROM PUBLIC, anon, authenticated, service_role;

-- din ecran (editor / owner): închide luna dată acum, fără să aștepte rularea de dimineață (aceeași funcție, ziua din România)
CREATE FUNCTION public.fn_upa_calcul_inchide(p_luna date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date; v_c jsonb;
BEGIN
  IF NOT public.fn_upa_poate_scrie() THEN
    RAISE EXCEPTION 'upa: inchiderea calculului cere Administrativ / Unitati protejate (admin sau editor)' USING ERRCODE = '42501';
  END IF;
  IF p_luna IS NULL THEN RAISE EXCEPTION 'upa: luna lipseste' USING ERRCODE = '22023'; END IF;
  v_c := public.fn_upa_calcul_inchide_la(p_luna, v_azi);
  IF v_c IS NULL THEN
    v_c := public.fn_upa_calcul_la(p_luna, v_azi);
    RETURN jsonb_build_object('inchis', v_c ->> 'stare' = 'definitiv', 'deja', v_c ->> 'stare' = 'definitiv', 'calcul', v_c);
  END IF;
  RETURN jsonb_build_object('inchis', true, 'deja', false, 'calcul', v_c);
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_calcul_inchide(date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_calcul_inchide(date) TO authenticated;

-- detaliul NMA pe angajat (owner): luna închisă = rândurile scrise; altfel calculul de acum
CREATE FUNCTION public.fn_upa_calcul_detaliu(p_luna date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_l date := date_trunc('month', p_luna::timestamp)::date; v_r jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN
    RAISE EXCEPTION 'upa: detaliul pe angajat e doar pentru owner' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.upa_calcul_lunar c WHERE c.luna = v_l) THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id', a.employee_id, 'nume', em.name, 'zile_calcul', a.zile_calcul, 'zile_cfs', a.zile_cfs,
             'zile_suspendare', a.zile_suspendare, 'norma', a.norma, 'contributie', a.contributie) ORDER BY em.name, a.employee_id), '[]'::jsonb)
      INTO v_r FROM public.upa_calcul_angajat a LEFT JOIN public.employees em ON em.id = a.employee_id WHERE a.luna = v_l;
    RETURN jsonb_build_object('luna', v_l, 'definitiv', true, 'angajati', v_r);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'nume', em.name, 'zile_calcul', x.zile_calcul, 'zile_cfs', x.zile_cfs,
           'zile_suspendare', x.zile_suspendare, 'norma', x.norma, 'contributie', x.contributie, 'fara_data_angajare', x.fara_data_angajare,
           'fara_norma', x.fara_norma) ORDER BY em.name, x.employee_id), '[]'::jsonb)
    INTO v_r FROM public.fn_upa_nma_angajati(v_l) x LEFT JOIN public.employees em ON em.id = x.employee_id;
  RETURN jsonb_build_object('luna', v_l, 'definitiv', false, 'angajati', v_r);
END $f$;
REVOKE ALL ON FUNCTION public.fn_upa_calcul_detaliu(date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_calcul_detaliu(date) TO authenticated;

-- ─── 7. Parametrii din ecran (CAS pe valoarea văzută; o lună închisă nu se recalculează) ────────────────────────────────────
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
  IF p_cheie IS NULL OR p_cheie NOT IN ('salariu_minim', 'angajati_handicap', 'report_initial') THEN
    RAISE EXCEPTION 'upa: parametru necunoscut' USING ERRCODE = '22023';
  END IF;
  IF p_de_la IS NULL OR extract(day FROM p_de_la) <> 1 OR p_de_la < DATE '2020-01-01' OR p_de_la > DATE '2100-01-01' THEN
    RAISE EXCEPTION 'upa: data de inceput trebuie sa fie prima zi a unei luni' USING ERRCODE = '22023';
  END IF;
  IF p_valoare IS NULL OR p_valoare < 0 OR p_valoare >= 10000000 OR p_valoare <> round(p_valoare, 2)
     OR (p_cheie = 'salariu_minim' AND p_valoare <= 0) OR (p_cheie = 'angajati_handicap' AND p_valoare <> trunc(p_valoare)) THEN
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
REVOKE ALL ON FUNCTION public.fn_upa_parametru_seteaza(text, date, numeric, numeric, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_upa_parametru_seteaza(text, date, numeric, numeric, text) TO authenticated;

-- ─── 8. Salvarea din formular: intenția are și valoarea fără TVA + data plății (înlocuiri ale funcțiilor din 20261229a) ─────────
CREATE OR REPLACE FUNCTION public.fn_upa_campuri_intentie() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT ARRAY['furnizor_id', 'furnizor_nume', 'numar_factura', 'data_factura', 'luna', 'valoare', 'descriere', 'document_path',
               'valoare_fara_tva', 'data_plata']::text[]
$f$;
-- aceeași funcție ca în 20261229a (cheia, amprenta, existent / UPA02 / nou), cu cele 2 coloane noi în INSERT
CREATE OR REPLACE FUNCTION public.fn_upa_achizitie_adauga(p_cheie uuid, p_rand jsonb) RETURNS jsonb
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
                                           valoare_fara_tva, data_plata, cheie_intentie, created_by)
    VALUES (v_r.furnizor_id, v_r.furnizor_nume, v_r.numar_factura, v_r.data_factura, v_r.luna, v_r.valoare, v_r.descriere, v_r.document_path,
            v_r.valoare_fara_tva, v_r.data_plata, p_cheie, auth.uid())
    ON CONFLICT (cheie_intentie) DO NOTHING
    RETURNING a.id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('stare', 'nou', 'id', v_id); END IF;
  END LOOP;
  RAISE EXCEPTION 'upa: cheia intentiei in conflict, fara rand vizibil; reincearca' USING ERRCODE = '40001';
END $f$;

-- ─── 9. Alerta pe calculul nou (înlocuiri ale funcțiilor din 20261229a; aceeași semnătură, același jurnal) ──────────────────────
-- Jurnalul păstrează coloanele: zilnic -> plafon = deducerea maximă rămasă (jumătate − report intrat), consumat = achiziții fără TVA,
--   ramas = de cumpărat; inchidere -> plafon = suma datorată, consumat = achiziții fără TVA, ramas = de plată la stat.
CREATE OR REPLACE FUNCTION public.fn_upa_alerta_inscrie(p_fel text, p_zi date, p_luna date, p_plafon numeric, p_consumat numeric, p_ramas numeric,
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
    v_titlu := 'Fond handicap ' || public.fn_upa_luna_text(p_luna) || ' (previziune): mai sunt ' || public.fn_upa_lei(p_ramas) || ' lei de cumpărat de la unități protejate';
    v_mesaj := 'Deducerea maximă estimată a lunii: ' || public.fn_upa_lei(p_plafon) || ' lei; cumpărat ' || public.fn_upa_lei(p_consumat)
               || ' lei fără TVA; ' || public.fn_upa_zile_text(p_zile) || ' din lună. Facturile se plătesc până la sfârșitul lunii; '
               || 'ce nu se deduce se plătește la bugetul de stat. Previziune: valoarea exactă se calculează după închiderea pontajului.';
  ELSIF p_fel = 'inchidere' THEN
    v_tip := 'error';
    v_titlu := 'Fond handicap ' || public.fn_upa_luna_text(p_luna) || ': de plată la bugetul de stat ' || public.fn_upa_lei(p_ramas)
               || ' lei până pe ' || to_char((p_luna + interval '1 month')::date + 24, 'DD.MM.YYYY');
    v_mesaj := 'Calcul exact după închiderea pontajului: contribuția datorată ' || public.fn_upa_lei(p_plafon) || ' lei, achiziții de la unități '
               || 'protejate ' || public.fn_upa_lei(p_consumat) || ' lei fără TVA. Reportul pe lunile următoare: Administrativ → Unități protejate.';
  ELSE
    v_tip := 'error';
    v_titlu := 'Fondul de handicap: calculul nu poate rula (' || p_cod || ')';
    v_mesaj := CASE p_cod WHEN 'setare_zi_invalida' THEN 'Setarea upa_alerta_zi lipsește sau nu e o zi între 1 și 31.'
                          WHEN 'fara_salariu_minim' THEN 'Salariul minim al lunii nu e înregistrat (Administrativ → Unități protejate → Parametri).'
                          WHEN 'fara_nr_handicap' THEN 'Numărul angajaților cu handicap nu e înregistrat (Administrativ → Unități protejate → Parametri).'
                          WHEN 'fara_inceput_calcul' THEN 'Prima lună a calculului (reportul inițial) nu e stabilită.'
                          WHEN 'calcul_neinchis' THEN 'Calculul unei luni încheiate nu se poate închide: lipsesc date (facturi fără valoare fără TVA sau fără data plății, parametri). Vezi Administrativ → Unități protejate.'
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

-- Rularea zilei: (1) reconcilierea rezervărilor rămase (> 1 h -> necunoscut); (2) închiderea calculului pentru lunile încheiate de la prima
--   lună a calculului, în ordine, după închiderea pontajului (prima care nu se poate închide oprește bucla; independent de comutator; mailul
--   și notificările doar cu alerta pornită și suma datorată > 0); (3) comutatorul oprit -> doar atât; (4) erorile de configurare și o lună cu
--   pontajul închis care nu se poate închide (calcul_neinchis) — în jurnal o dată pe zi și cod, în răspuns la fiecare rulare; (5) alerta zilei
--   pe in_alerta din fn_upa_situatie. Răspuns: UN jsonb {activ, zi, inchis, inchise, erori_config, n, randuri (cu `calcul` pe fiecare rând)}.
CREATE OR REPLACE FUNCTION public.fn_upa_alerta_rezerva_la(p_azi date) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $f$
DECLARE v_activ boolean; v_dest text[]; v_ign integer; v_sit jsonb; v_cur jsonb; v_lc date; v_start date; v_m date; v_c jsonb; v_ids bigint[] := '{}';
        v_id bigint; v_rez jsonb; v_inchis jsonb := NULL; v_inchise jsonb := '[]'::jsonb; v_furn jsonb; v_reconciliate integer; v_cfg text[];
        v_cod text; v_blocat date;
BEGIN
  IF p_azi IS NULL THEN RAISE EXCEPTION 'upa: ziua lipseste' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('upa_alerta_jurnal'));
  UPDATE public.upa_alerta_jurnal j SET stare = 'necunoscut', eroare = 'rezervare_veche', actualizat_la = now()
   WHERE j.stare = 'rezervat' AND j.creat_la < now() - interval '1 hour';
  GET DIAGNOSTICS v_reconciliate = ROW_COUNT;
  v_activ := (SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_activa') IS NOT DISTINCT FROM 'true';
  SELECT d.interni, cardinality(d.ignorate) INTO v_dest, v_ign
    FROM public.fn_upa_destinatari((SELECT s.value FROM public.logistica_setari s WHERE s.key = 'upa_alerta_emails')) d;
  -- (2) închiderea lunilor încheiate (de la prima lună a calculului; cel mult 36), în ordine
  v_lc := date_trunc('month', p_azi::timestamp)::date;
  v_start := public.fn_upa_inceput_calcul();
  IF v_start IS NOT NULL AND v_start < v_lc THEN
    v_m := greatest(v_start, (v_lc - interval '36 months')::date);
    WHILE v_m < v_lc LOOP
      IF NOT EXISTS (SELECT 1 FROM public.upa_calcul_lunar c WHERE c.luna = v_m) THEN
        EXIT WHEN NOT public.fn_upa_pontaj_inchis(v_m, p_azi);
        v_c := public.fn_upa_calcul_inchide_la(v_m, p_azi);
        IF v_c IS NULL THEN v_blocat := v_m; EXIT; END IF;
        v_inchis := jsonb_build_object('luna', v_m, 'suma_datorata', v_c -> 'suma_datorata', 'de_plata', v_c -> 'de_plata', 'report_iesit', v_c -> 'report_iesit');
        v_inchise := v_inchise || jsonb_build_array(v_inchis);
        IF v_activ AND (v_c ->> 'suma_datorata')::numeric > 0 THEN
          v_id := public.fn_upa_alerta_inscrie('inchidere', p_azi, v_m, (v_c ->> 'suma_datorata')::numeric, (v_c ->> 'achizitii_fara_tva')::numeric,
                                               (v_c ->> 'de_plata')::numeric, NULL, v_dest, v_ign, NULL);
          IF v_id IS NOT NULL THEN v_ids := v_ids || v_id; END IF;
        END IF;
      END IF;
      v_m := (v_m + interval '1 month')::date;
    END LOOP;
  END IF;
  v_sit := public.fn_upa_situatie(p_azi, 1);
  v_cur := v_sit -> 'luni' -> 0;
  v_cfg := ARRAY(SELECT jsonb_array_elements_text(v_sit -> 'erori_config'));
  IF v_blocat IS NOT NULL THEN v_cfg := v_cfg || 'calcul_neinchis'::text; END IF;
  IF NOT v_activ THEN
    RETURN jsonb_build_object('activ', false, 'zi', p_azi, 'inchis', v_inchis, 'inchise', v_inchise, 'luna_blocata', v_blocat,
                              'reconciliate', v_reconciliate, 'erori_config', to_jsonb(v_cfg), 'destinatari_ignorati', v_ign, 'n', 0, 'randuri', '[]'::jsonb);
  END IF;
  -- (4) erorile: în jurnal (+ notificările) o dată pe zi și cod; în răspuns la fiecare rulare
  FOREACH v_cod IN ARRAY v_cfg LOOP
    PERFORM public.fn_upa_alerta_inscrie('eroare', p_azi, v_lc, NULL, NULL, NULL, NULL, NULL, NULL, v_cod);
  END LOOP;
  IF (v_sit ->> 'in_alerta')::boolean IS TRUE THEN
    -- (5) alerta zilei (previziune): cel mult una pe zi (cheia zilnic:<zi>)
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
                                               'calcul', CASE WHEN j.fel = 'zilnic' THEN v_cur ELSE public.fn_upa_calcul_la(j.luna, p_azi) END,
                                               'destinatari', CASE WHEN j.stare = 'rezervat' THEN to_jsonb(v_dest) ELSE '[]'::jsonb END) ORDER BY j.id), '[]'::jsonb)
    INTO v_rez FROM public.upa_alerta_jurnal j WHERE j.id = ANY (v_ids);
  RETURN jsonb_build_object('activ', true, 'zi', p_azi, 'inchis', v_inchis, 'inchise', v_inchise, 'luna_blocata', v_blocat,
                            'reconciliate', v_reconciliate, 'furnizori_upa', v_furn, 'erori_config', to_jsonb(v_cfg), 'destinatari_ignorati', v_ign,
                            'n', jsonb_array_length(v_rez), 'randuri', v_rez);
END $f$;

-- ce s-ar face azi, FĂRĂ nicio scriere (?dry=1 al owner-ului): aceleași predicate (fn_upa_situatie + fn_upa_destinatari + fn_upa_calcul_la)
CREATE OR REPLACE FUNCTION public.fn_upa_alerta_proba() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date; v_sit jsonb; v_cur jsonb; v_dest text[]; v_ignorate text[]; v_ant jsonb;
BEGIN
  v_sit := public.fn_upa_situatie(v_azi, 2);
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
    'destinatari_valizi', v_dest IS NOT NULL, 'destinatari', coalesce(to_jsonb(v_dest), '[]'::jsonb),
    'destinatari_ignorate', to_jsonb(v_ignorate));
END $f$;

-- ─── 10. Drepturi și RLS pe tabelele noi (fără scriere directă: doar prin RPC-uri) ───────────────────────────────────────────
ALTER TABLE public.upa_parametri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upa_calcul_lunar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upa_calcul_angajat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upa_parametri, public.upa_calcul_lunar, public.upa_calcul_angajat FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.upa_parametri, public.upa_calcul_lunar, public.upa_calcul_angajat TO authenticated;
CREATE POLICY upa_parametri_citire ON public.upa_parametri FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY upa_calcul_lunar_citire ON public.upa_calcul_lunar FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY upa_calcul_angajat_citire_owner ON public.upa_calcul_angajat FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE));

-- ─── 11. Intrările cunoscute (răspunsul expertului contabil, 20.11.2026) ─────────────────────────────────────────────────────
-- salariul minim: DOAR valoarea confirmată de expert (lunile dinainte rămân „neînregistrat”: se adaugă din ecran, cu sursa lor);
-- prima lună a calculului: octombrie 2026 (plata la stat pentru ea e pe 25.11.2026), report inițial 0 (schimbabil cât nu e închisă nicio lună).
-- Numărul angajaților cu handicap NU se pune aici (nu există în ERP): până îl înregistrează cineva, calculul e blocat (fara_nr_handicap).
INSERT INTO public.upa_parametri (cheie, de_la, valoare, sursa, nota) VALUES
  ('salariu_minim', DATE '2026-07-01', 4325, 'migrare', 'salariul minim brut pe tara de la 01.07.2026 (raspunsul expertului contabil, 20.11.2026)'),
  ('report_initial', DATE '2026-10-01', 0, 'migrare', 'prima luna a calculului; report initial 0');

-- ─── 12. Postcondiții ────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE r record; v_acl text; v_pol text; v_n integer; v_amp text;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('public.upa_parametri'), ('public.upa_calcul_lunar'), ('public.upa_calcul_angajat')) v(t) LOOP
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
   WHERE c.oid IN ('public.upa_parametri'::regclass, 'public.upa_calcul_lunar'::regclass, 'public.upa_calcul_angajat'::regclass);
  IF v_pol IS DISTINCT FROM concat_ws(chr(10),
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
      ('public.fn_upa_nma_angajati(date)', 'sql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_calcul_la(date,date,integer)', 'plpgsql', false, 's', 'postgres:EXECUTE'),
      ('public.fn_upa_situatie(date,integer)', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_calcul_inchide_la(date,date)', 'plpgsql', false, 'v', 'postgres:EXECUTE'),
      ('public.fn_upa_calcul_inchide(date)', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_calcul_detaliu(date)', 'plpgsql', true, 's', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_parametru_seteaza(text,date,numeric,numeric,text)', 'plpgsql', true, 'v', 'authenticated:EXECUTE, postgres:EXECUTE'),
      ('public.fn_upa_campuri_intentie()', 'sql', false, 'i', 'authenticated:EXECUTE, postgres:EXECUTE, service_role:EXECUTE'),
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
    'fn_upa_pontaj_inchis', 'fn_upa_nma_angajati', 'fn_upa_calcul_la', 'fn_upa_situatie', 'fn_upa_calcul_inchide_la', 'fn_upa_calcul_inchide',
    'fn_upa_calcul_detaliu', 'fn_upa_parametru_seteaza', 'fn_upa_campuri_intentie', 'fn_upa_achizitie_adauga', 'fn_upa_alerta_inscrie',
    'fn_upa_alerta_rezerva_la', 'fn_upa_alerta_proba']);
  IF v_n <> 15 THEN RAISE EXCEPTION '20270101a post: % functii cu numele noi / inlocuite (asteptat 15)', v_n; END IF;
  IF (SELECT count(*) FROM public.upa_parametri) <> 2 OR EXISTS (SELECT 1 FROM public.upa_calcul_lunar) THEN
    RAISE EXCEPTION '20270101a post: parametrii de start / calculul gol';
  END IF;
  -- formula pe un caz fără date (doar intrările): regula jumătății și reportul (aceeași aritmetică ca CHECK-ul tabelului)
  IF public.fn_upa_pontaj_inchis(DATE '2026-10-01', DATE '2026-11-12') OR NOT public.fn_upa_pontaj_inchis(DATE '2026-10-01', DATE '2026-11-13')
     OR public.fn_upa_parametru_la('salariu_minim', DATE '2026-06-01') IS NOT NULL OR public.fn_upa_parametru_la('salariu_minim', DATE '2026-11-15') <> 4325
     OR public.fn_upa_inceput_calcul() <> DATE '2026-10-01' THEN
    RAISE EXCEPTION '20270101a post: intrarile calculului (pontaj inchis / salariu minim / inceput)';
  END IF;
  -- AMPRENTA_20270101a_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul; PG17 / PG18: NOT NULL-urile din pg_constraint scoase)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'rel ' || c.relname || ' ' || c.relkind::text || ' own=' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(c.relacl) e) a), '-') AS l
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat')
    UNION ALL
    SELECT 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' id=' || a.attidentity::text
           || ' gen=' || a.attgenerated::text || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || ' acl=' || coalesce((SELECT string_agg(e.d, ',' ORDER BY e.d COLLATE "C") FROM (
                SELECT CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ':' || x.privilege_type
                       || CASE WHEN x.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(a.attacl) x) e), '-')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat') OR (c.relname = 'upa_achizitii' AND a.attname IN ('valoare_fara_tva', 'data_plata')))
    UNION ALL
    SELECT 'con ' || c.relname || ' ' || k.conname || ' ' || k.contype::text || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype <> 'n' AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat') OR (c.relname = 'upa_achizitii' AND k.conname = 'upa_achizitii_fara_tva_interval'))
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' own=' || pg_get_userbyid(ic.relowner)
      FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE t.relnamespace = 'public'::regnamespace AND t.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat')
    UNION ALL
    SELECT 'trg ' || c.relname || ' ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat')
    UNION ALL
    -- ORICE obiect care depinde de coloanele noi din upa_achizitii (DROP COLUMN le-ar scoate tăcut la revenire)
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> upa_achizitii.' || a.attname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
     WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.upa_achizitii'::regclass AND a.attname IN ('valoare_fara_tva', 'data_plata')
    UNION ALL
    -- orice obiect care depinde de tabelele noi (vederi, chei străine, politici în alte tabele): DROP TABLE fără CASCADE ar pica, dar se vede aici
    SELECT 'deptab ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> ' || c.relname || ' ' || d.deptype::text
      FROM pg_depend d JOIN pg_class c ON c.oid = d.refobjid
     WHERE d.refclassid = 'pg_class'::regclass AND c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat')
       AND d.deptype = 'n' AND d.classid <> 'pg_class'::regclass
    UNION ALL
    SELECT 'pol ' || c.relname || ' ' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(rl.nume, ',' ORDER BY rl.nume COLLATE "C") FROM (
                SELECT CASE ro WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(ro) END AS nume FROM unnest(p.polroles) ro) rl), '-')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('upa_parametri', 'upa_calcul_lunar', 'upa_calcul_angajat')
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
             'fn_upa_nma_angajati', 'fn_upa_calcul_la', 'fn_upa_situatie', 'fn_upa_calcul_inchide_la', 'fn_upa_calcul_inchide', 'fn_upa_calcul_detaliu',
             'fn_upa_parametru_seteaza', 'fn_upa_campuri_intentie', 'fn_upa_achizitie_adauga', 'fn_upa_alerta_inscrie', 'fn_upa_alerta_rezerva_la',
             'fn_upa_alerta_proba')
  ) x;
  -- AMPRENTA_20270101a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '4a07273f741fb01317cd5133c29379d6' THEN
    RAISE NOTICE 'AMPRENTA_20270101a_TEXT %', v_amp;
    RAISE EXCEPTION '20270101a post: AMPRENTA obiectelor % (asteptat 4a07273f741fb01317cd5133c29379d6)', md5(coalesce(v_amp, ''));
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270101a_administrativ_upa_calcul:' || txid_current() THEN
    RAISE EXCEPTION '20270101a: garda final invalida';
  END IF;
  RAISE NOTICE '20270101a: sfarsit la % ms de la BEGIN; lock-ul pe upa_achizitii tinut de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
