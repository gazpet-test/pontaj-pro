-- Version 20270106120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270106a_executie_semnale.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului în
--   aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 v2 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ a runnerului. Lista OBIECTELOR din manifest e în
--   supabase/tests/20270106a_executie_semnale.l15.obiecte.tsv (generată pe PGlite cu pașii reali ai runnerului). Pe lângă ea, migrarea verifică pe
--   amprentă (corp fără CR + proprietăți + EXECUTE), ÎNAINTE și DUPĂ, poarta de drept pe proiect pe care o cheamă direct (fn_executie_proiect_permis,
--   20261209a) și lanțul ei (listă scrisă, revizuită pe corpurile din 20261209a, nu citită cu regex).
-- 20270106a_executie_semnale — Execuție: „🔔 Semnale” — faza 1 a agentului verificator (designul discutat cu Jakarinos, Tema 1 din
--   debate_agenti_jak.md: „bun cu schimbări”). Agentul de noapte (serverul AI, prin service_role) verifică proiectele din Execuție și scrie DOAR
--   semnale; oamenii le văd și acționează. Regulile de verificare le scrie coordonatorul separat (faza 2); pilotul: un proiect Transgaz cu ordin
--   de începere, apoi încă unul.
--
-- Ce face (DOAR obiecte noi, nicio dată, niciun drept pe tabele existente):
--   * executie_semnale: un semnal pe (proiect, tip, obiect) — cheia de deduplicare (UNIQUE): aceeași problemă ACTUALIZEAZĂ semnalul, nu creează
--     altul. Fluxul (lipsuri / tichete / corespondenta), tipul (cod stabil, ex. termen_apropiat, document_negasit, camp_lipsa_erp, polita_expira),
--     gravitatea (info / atentie / critic), titlul, detaliile; CONSTATAREA deosebește explicit „constatat” (dovadă: sursa document / mail / camp_erp,
--     data sursei, fragmentul scurt, linkul sau calea NAS) de „negasit_in_surse” (documentul NU a fost găsit în sursele consultate — lista lor e
--     obligatorie) și de „camp_lipsa” (câmp gol în ERP: dovada e câmpul); termenul identificat + baza calculului + dacă e confirmat; explicația
--     incertitudinii; propunerea; responsabilul (angajat; sursa lui: agent / om — ce a stabilit omul nu mai schimbă agentul); starea
--     (nou / in_lucru / asteapta_informatii / rezolvat / respins) cu motivul, dovada rezolvării / respingerii, acțiunea rezultată (legătura cu
--     tichetul), cine și când; versiunea regulii; detectat_la / ultima_verificare; versiunea rândului (CAS). Amprenta dovezii (md5 canonic, pusă
--     de SERVER) spune dacă dovada e NOUĂ: un semnal respins (sau rezolvat) cu aceeași dovadă NU reapare — doar ultima_verificare se mișcă; cu
--     dovadă nouă se redeschide (stare nou, decizia veche rămâne în jurnal).
--   * executie_semnale_jurnal: jurnal DOAR ADĂUGARE al schimbărilor (creat / actualizat / redeschis / stare / responsabil), cu actorul
--     (agent / om + contul), motivul, dovada, diferențele (câmp: [vechi, nou]) și versiunea regulii.
--   * Dreptul: O SINGURĂ definiție (fn_executie_semnal_drept): citire = owner SAU managerul de proiect (profiles.employee_id =
--     executie_proiecte.mp_employee_id) SAU responsabilul semnalului (profiles.employee_id = responsabil), TOȚI și cu restricția pe proiect
--     existentă (fn_executie_proiect_permis, 20261209a). Schimbarea stării = aceiași (respingerea și rezolvarea cer motiv). Un cont cu acces
--     general pe modul (viewer / editor / admin) sau șeful de șantier NU vede semnalele (0 rânduri) dacă nu e owner / MP / responsabil.
--   * Scrierea semnalelor DOAR prin fn_executie_semnal_scrie(jsonb) — EXECUTE exclusiv service_role, în corp auth.uid() IS NULL (calea server,
--     L08): validare strictă a cheilor și tipurilor, rândul blocat FOR UPDATE înaintea deciziei (L01), INSERT … ON CONFLICT DO NOTHING + recitire
--     la cursă (L04). Omul schimbă starea / responsabilul DOAR prin fn_executie_semnal_stare — EXECUTE authenticated, auth.uid() obligatoriu,
--     dreptul verificat DUPĂ lock, CAS pe versiune (0 rânduri = conflict, ecranul reîncarcă).
--   * Gărzi în BD pe ORICE cale (L07, trigger BEFORE pe OLD/NEW): identitatea imuabilă; versiunea crește la ORICE scriere; amprenta dovezii și
--     sursa responsabilului le pune serverul; AGENTUL (fără JWT) nu atinge starea / motivul / dovada / acțiunea omului și nu schimbă responsabilul
--     stabilit de om (singura lui tranziție: rezolvat / respins -> nou, și DOAR cu dovadă nouă); OMUL (cu JWT) nu rescrie constatarea agentului;
--     tranzițiile de stare = tabelul TRANZITII (aceeași listă ca src/executieSemnaleLogica.js, testul de paritate citește blocul); nicio
--     ștergere / golire (nici pentru postgres); jurnalul fără UPDATE / DELETE / TRUNCATE. Fără INSERT / UPDATE / DELETE pentru anon /
--     authenticated / service_role pe tabele (scrierile trec doar prin RPC-urile DEFINER, ca proprietarul).
--   * v_executie_semnale (security_invoker): semnalul + codul / numele proiectului (executie_proiecte, citită cu drepturile apelantului).
-- Ce NU face: nicio dată, niciun drept pe module, nicio schimbare pe tabelele / funcțiile existente (doar cheile străine spre executie_proiecte și
--   employees: trigger-ele referențiale interne pe ele). Nicio automatizare, niciun cron, niciun mail: agentul de noapte și regulile lui = faza 2
--   (coordonatorul), cu fișa de securitate în registrul automatizărilor atunci.
-- Depinde de 20261209a + 20261213a (restricția pe proiect: fn_executie_proiect_permis și lanțul), executie_proiecte.mp_employee_id,
--   profiles.employee_id, employees. Verificat mai jos.
-- Ordinea lock-urilor (L06), aceeași pe toate căile: fn_executie_semnal_scrie = rândul executie_semnale (FOR UPDATE; la INSERT nou: ON CONFLICT
--   DO NOTHING, apoi recitire FOR UPDATE) -> INSERT în executie_semnale_jurnal; fn_executie_semnal_stare = rândul executie_semnale (FOR UPDATE)
--   -> UPDATE (CAS) -> INSERT în jurnal. Lock-urile implicite: FK-urile (FOR KEY SHARE pe executie_proiecte / employees la INSERT / la schimbarea
--   responsabilului; pe rândul semnalului la INSERT în jurnal — deja ținut FOR UPDATE de aceeași tranzacție). Nicio altă cale nu blochează aceste
--   rânduri: fără ciclu.
-- Lock-uri la aplicare (punct unic, NOWAIT, ordine FIXĂ: executie_proiecte -> employees, SHARE ROW EXCLUSIVE, cheile străine ale tabelului nou;
--   docs/LIVRARE_L15_V2.md §9): bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI, verificat înaintea fiecărei încercări și DUPĂ
--   obținerea setului complet; fiecare încercare e o subtranzacție. employees e tabelul HR / pontaj: aplicarea se face într-un moment liniștit;
--   la coliziune migrarea refuză curat (55P03), nimic schimbat.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, bugetul lock-urilor de
--   1 s și garda finală a runnerului. Migrarea NU fixează statement_timeout și nu are alt plafon.
-- Revenire: supabase/revenire/20270106a_executie_semnale_ROLLBACK.sql (prin runner, plafonul 2000; refuză dacă există semnale / jurnal; verifică
--   DEFINIȚIILE, nu doar numerele).
-- Probe: scripts/pglite/test_executie_semnale_local.mjs (PGlite, cu pașii reali L15 v2 ai runnerului: drepturi pe 9 conturi, deduplicare, respins
--   nu reapare, agentul nu atinge starea omului, omul nu rescrie constatarea, revenirea, mutanți) + supabase/tests/20270106a_executie_semnale_dryrun.sql
--   (același scenariu, pe clonă, într-o tranzacție anulată).
DO $pre$
DECLARE v_plafon text; r record; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270106a_executie_semnale:' || txid_current() THEN
    RAISE EXCEPTION '20270106a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270106a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270106a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270106a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270106a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tabela lui temporară, creată de tranzacția curentă și blocată de ea)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270106a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.executie_semnale') IS NOT NULL OR to_regclass('public.executie_semnale_jurnal') IS NOT NULL
     OR to_regclass('public.v_executie_semnale') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_semnal\_%') THEN
    RAISE EXCEPTION '20270106a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite, cu tipurile din migrările lor (20261209a, 20260929c, 20261205a)
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id', '^bigint$'), ('executie_proiecte', 'cod_intern', '^(text|character varying)$'),
      ('executie_proiecte', 'nume', '^(text|character varying)$'), ('executie_proiecte', 'mp_employee_id', '^(integer|bigint)$'),
      ('profiles', 'id', '^uuid$'), ('profiles', 'is_owner', '^boolean$'), ('profiles', 'employee_id', '^(integer|bigint)$'),
      ('employees', 'id', '^(integer|bigint)$'), ('employees', 'name', '^(text|character varying)$'), ('employees', 'active', '^boolean$')
    ) v(t, c, tip) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION '20270106a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid
     OR to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)') IS NULL
     OR NOT pg_has_role('postgres', 'authenticated', 'USAGE') OR NOT pg_has_role('postgres', 'anon', 'USAGE') THEN
    RAISE EXCEPTION '20270106a: dependentele (auth.uid, fn_executie_proiect_permis din 20261209a, rolurile aplicatiei) lipsesc sau difera';
  END IF;
  -- cheile străine ale tabelului nou și vederea: postgres poate referi tabelele; authenticated citește coloanele proiectului din vedere
  IF NOT has_table_privilege('postgres', 'public.executie_proiecte', 'REFERENCES') OR NOT has_table_privilege('postgres', 'public.employees', 'REFERENCES')
     OR NOT has_column_privilege('authenticated', 'public.executie_proiecte', 'id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.executie_proiecte', 'cod_intern', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.executie_proiecte', 'nume', 'SELECT') THEN
    RAISE EXCEPTION '20270106a: drepturile pe executie_proiecte / employees (REFERENCES pentru postgres, SELECT pentru authenticated pe id / cod_intern / nume) lipsesc';
  END IF;
END $pre$;

-- ── lanțul funcției de drept pe proiect chemate DIRECT (fn_executie_proiect_permis) și al celor chemate de ea (listă revizuită pe corpurile din
-- 20261209a, aceleași amprente ca în 20261225a), cu amprenta corpului (fără CR) + proprietățile, ÎNAINTE și DUPĂ. Garanția completă (orice
-- altă funcție / politică / drept) e amprenta globală L15 v2 a runnerului.
CREATE FUNCTION pg_temp.lant_20270106a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $lant$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155', true, true),
      ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1', true, true),
      ('public.fn_executie_acces_nerestrans_cont(uuid)', '9a07e0089139e54ba5c6a0cfaaf093cc', false, false),
      ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b', true, false),
      ('public.fn_executie_acces_lista_cont(uuid, boolean)', 'e7cf9b852002a1c1cbe781772c33bf0c', false, false)
    ) a(semnatura, amprenta, definer, cu_auth)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = 'sql')
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR p.prorettype IS DISTINCT FROM (CASE WHEN a.semnatura LIKE '%lista%' THEN 'bigint[]'::regtype ELSE 'boolean'::regtype END)::oid
      OR p.provolatile IS DISTINCT FROM 's'
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth;
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20270106a: lantul de drept (%) difera de amprenta revizuita: %', p_moment, v_rau;
  END IF;
END $lant$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.lant_20270106a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06), după verificările de catalog. Ordinea FIXĂ: executie_proiecte, apoi employees (SHARE ROW EXCLUSIVE: cheile
-- străine ale tabelului nou). Bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI (v_t0), verificat ÎNAINTE de fiecare încercare
-- și DUPĂ obținerea setului complet. Fiecare încercare = subtranzacție (eșecul unui lock eliberează lock-urile luate deja în ea, înaintea pauzei).
-- Momentul obținerii (gazpet.lock_puternic_la, µs de la epoch) îl citește garda finală a runnerului (LOCK_TINUT). ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270106a: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000)
        USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.employees IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270106a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000)
      USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270106a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ── semnalele ──
CREATE TABLE public.executie_semnale (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  flux text NOT NULL,
  tip text NOT NULL,
  obiect text NOT NULL,
  gravitate text NOT NULL,
  titlu text NOT NULL,
  detalii text,
  constatare text NOT NULL,
  surse_consultate text[] NOT NULL DEFAULT '{}'::text[],
  dovada_sursa text,
  dovada_data date,
  dovada_fragment text,
  dovada_ref text,
  dovada_amprenta text NOT NULL,
  termen date,
  termen_baza text,
  termen_confirmat boolean,
  incertitudine text,
  propunere text,
  responsabil_employee_id integer REFERENCES public.employees(id),
  responsabil_sursa text,
  stare text NOT NULL DEFAULT 'nou',
  stare_motiv text,
  stare_dovada text,
  actiune_ref text,
  stare_de uuid,
  stare_la timestamptz,
  regula_versiune text NOT NULL,
  detectat_la timestamptz NOT NULL DEFAULT now(),
  ultima_verificare timestamptz NOT NULL DEFAULT now(),
  versiune integer NOT NULL DEFAULT 1,
  CONSTRAINT executie_semnale_cheie_uq UNIQUE (proiect_id, tip, obiect),
  CONSTRAINT executie_semnale_flux_ck CHECK (flux IN ('lipsuri', 'tichete', 'corespondenta')),
  CONSTRAINT executie_semnale_tip_ck CHECK (tip ~ '^[a-z][a-z0-9_]{1,59}$'),
  CONSTRAINT executie_semnale_obiect_ck CHECK (length(obiect) BETWEEN 1 AND 200 AND obiect !~ '[[:cntrl:]]' AND obiect ~ '[^[:space:]]'),
  CONSTRAINT executie_semnale_gravitate_ck CHECK (gravitate IN ('info', 'atentie', 'critic')),
  CONSTRAINT executie_semnale_titlu_ck CHECK (length(titlu) BETWEEN 3 AND 200 AND titlu !~ '[[:cntrl:]]' AND titlu ~ '[^[:space:]]'),
  CONSTRAINT executie_semnale_texte_ck CHECK (
    (detalii IS NULL OR (length(detalii) BETWEEN 1 AND 4000 AND detalii ~ '[^[:space:]]'))
    AND (dovada_fragment IS NULL OR (length(dovada_fragment) BETWEEN 1 AND 1000 AND dovada_fragment ~ '[^[:space:]]'))
    AND (dovada_ref IS NULL OR (length(dovada_ref) BETWEEN 1 AND 1000 AND dovada_ref !~ '[[:cntrl:]]' AND dovada_ref ~ '[^[:space:]]'))
    AND (termen_baza IS NULL OR (length(termen_baza) BETWEEN 1 AND 500 AND termen_baza ~ '[^[:space:]]'))
    AND (incertitudine IS NULL OR (length(incertitudine) BETWEEN 1 AND 1000 AND incertitudine ~ '[^[:space:]]'))
    AND (propunere IS NULL OR (length(propunere) BETWEEN 1 AND 2000 AND propunere ~ '[^[:space:]]'))
    AND (stare_motiv IS NULL OR (length(stare_motiv) BETWEEN 1 AND 2000 AND stare_motiv ~ '[^[:space:]]'))
    AND (stare_dovada IS NULL OR (length(stare_dovada) BETWEEN 1 AND 1000 AND stare_dovada ~ '[^[:space:]]'))
    AND (actiune_ref IS NULL OR (length(actiune_ref) BETWEEN 1 AND 200 AND actiune_ref !~ '[[:cntrl:]]' AND actiune_ref ~ '[^[:space:]]'))),
  CONSTRAINT executie_semnale_constatare_ck CHECK (
    constatare IN ('constatat', 'negasit_in_surse', 'camp_lipsa')
    AND (dovada_sursa IS NULL OR dovada_sursa IN ('document', 'mail', 'camp_erp'))
    AND cardinality(surse_consultate) <= 50
    AND (constatare <> 'constatat' OR (dovada_sursa IS NOT NULL AND (dovada_fragment IS NOT NULL OR dovada_ref IS NOT NULL)))
    AND (constatare <> 'negasit_in_surse' OR cardinality(surse_consultate) >= 1)
    AND (constatare <> 'camp_lipsa' OR (dovada_sursa = 'camp_erp' AND dovada_ref IS NOT NULL))),
  CONSTRAINT executie_semnale_amprenta_ck CHECK (dovada_amprenta ~ '^[0-9a-f]{32}$'),
  CONSTRAINT executie_semnale_termen_ck CHECK (
    (termen IS NULL OR (termen BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' AND termen_confirmat IS NOT NULL))
    AND (termen IS NOT NULL OR (termen_baza IS NULL AND termen_confirmat IS NULL))
    AND (dovada_data IS NULL OR dovada_data BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')),
  CONSTRAINT executie_semnale_responsabil_ck CHECK (
    (responsabil_employee_id IS NULL) = (responsabil_sursa IS NULL) AND (responsabil_sursa IS NULL OR responsabil_sursa IN ('agent', 'om'))),
  CONSTRAINT executie_semnale_stare_ck CHECK (
    stare IN ('nou', 'in_lucru', 'asteapta_informatii', 'rezolvat', 'respins')
    AND ((stare = 'nou' AND stare_motiv IS NULL AND stare_dovada IS NULL AND actiune_ref IS NULL AND stare_de IS NULL AND stare_la IS NULL)
         OR (stare <> 'nou' AND stare_de IS NOT NULL AND stare_la IS NOT NULL AND (stare NOT IN ('rezolvat', 'respins') OR stare_motiv IS NOT NULL)))),
  CONSTRAINT executie_semnale_regula_ck CHECK (regula_versiune ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  CONSTRAINT executie_semnale_timp_ck CHECK (versiune >= 1 AND ultima_verificare >= detectat_la)
);
CREATE INDEX executie_semnale_proiect_stare_idx ON public.executie_semnale (proiect_id, stare, gravitate);
CREATE INDEX executie_semnale_responsabil_idx ON public.executie_semnale (responsabil_employee_id) WHERE responsabil_employee_id IS NOT NULL;
COMMENT ON TABLE public.executie_semnale IS
  'Execuție: semnalele agentului verificator (faza 1). Un rând pe (proiect, tip, obiect); scris doar de agent prin fn_executie_semnal_scrie; starea / responsabilul le schimbă omul prin fn_executie_semnal_stare. 20270106a.';
COMMENT ON COLUMN public.executie_semnale.constatare IS 'constatat = cu dovadă; negasit_in_surse = documentul NU a fost găsit în sursele consultate (nu înseamnă că lipsește); camp_lipsa = câmp gol în ERP. 20270106a.';
COMMENT ON COLUMN public.executie_semnale.dovada_amprenta IS 'md5 canonic al dovezii (constatare, surse, sursă, dată, fragment, ref), pus de server: aceeași amprentă pe un semnal respins / rezolvat = nu reapare. 20270106a.';
COMMENT ON COLUMN public.executie_semnale.responsabil_sursa IS 'agent = propus de agent (agentul îl poate schimba); om = stabilit de om (agentul nu-l mai atinge). 20270106a.';

-- ── jurnalul (doar adăugare) ──
CREATE TABLE public.executie_semnale_jurnal (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  semnal_id bigint NOT NULL REFERENCES public.executie_semnale(id),
  proiect_id bigint NOT NULL,
  actiune text NOT NULL,
  stare_veche text,
  stare_noua text,
  actor text NOT NULL,
  actor_profile uuid,
  motiv text,
  dovada text,
  valori jsonb NOT NULL DEFAULT '{}'::jsonb,
  regula_versiune text,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_semnale_jurnal_actiune_ck CHECK (actiune IN ('creat', 'actualizat', 'redeschis', 'stare', 'responsabil')),
  CONSTRAINT executie_semnale_jurnal_actor_ck CHECK (actor IN ('agent', 'om') AND (actor = 'om') = (actor_profile IS NOT NULL)),
  CONSTRAINT executie_semnale_jurnal_valori_ck CHECK (jsonb_typeof(valori) = 'object')
);
CREATE INDEX executie_semnale_jurnal_semnal_idx ON public.executie_semnale_jurnal (semnal_id, id);
COMMENT ON TABLE public.executie_semnale_jurnal IS 'Execuție: jurnalul doar-adăugare al semnalelor (creat / actualizat / redeschis / stare / responsabil), cu actorul și diferențele. 20270106a.';

-- ── dreptul: O SINGURĂ definiție (politici, RPC, vedere). owner / managerul de proiect / responsabilul semnalului, cu restricția pe proiect ──
CREATE FUNCTION public.fn_executie_semnal_drept(p_proiect bigint, p_responsabil integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND public.fn_executie_proiect_permis(p_proiect, false)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.profiles p JOIN public.executie_proiecte e ON e.id = p_proiect
                     WHERE p.id = auth.uid() AND p.employee_id IS NOT NULL
                       AND (p.employee_id = e.mp_employee_id OR p.employee_id = p_responsabil)))
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_drept(bigint, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_semnal_drept(bigint, integer) TO authenticated;
-- același drept, pe id-ul semnalului (politica jurnalului)
CREATE FUNCTION public.fn_executie_semnal_drept_id(p_semnal bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM public.executie_semnale s WHERE s.id = p_semnal AND public.fn_executie_semnal_drept(s.proiect_id, s.responsabil_employee_id))
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_drept_id(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_semnal_drept_id(bigint) TO authenticated;

-- ── tranzițiile de stare: lista albă pe actor (aceeași ca TRANZITII din src/executieSemnaleLogica.js; testul de paritate citește blocul) ──
CREATE FUNCTION public.fn_executie_semnal_tranzitie(p_veche text, p_noua text, p_actor text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM (VALUES
    -- TRANZITII-START
    ('om', 'nou', 'in_lucru'), ('om', 'nou', 'asteapta_informatii'), ('om', 'nou', 'rezolvat'), ('om', 'nou', 'respins'),
    ('om', 'in_lucru', 'asteapta_informatii'), ('om', 'in_lucru', 'rezolvat'), ('om', 'in_lucru', 'respins'),
    ('om', 'asteapta_informatii', 'in_lucru'), ('om', 'asteapta_informatii', 'rezolvat'), ('om', 'asteapta_informatii', 'respins'),
    ('om', 'rezolvat', 'in_lucru'), ('om', 'respins', 'in_lucru'),
    ('agent', 'rezolvat', 'nou'), ('agent', 'respins', 'nou')
    -- TRANZITII-END
  ) t(actor, veche, noua) WHERE t.actor = p_actor AND t.veche = p_veche AND t.noua = p_noua)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_tranzitie(text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── amprenta dovezii: md5 canonic (jsonb ordonează cheile); NULL-urile intră ca null ──
CREATE FUNCTION public.fn_executie_semnal_amprenta(p_constatare text, p_surse text[], p_sursa text, p_data date, p_fragment text, p_ref text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT md5(jsonb_build_object('constatare', p_constatare, 'surse', to_jsonb(coalesce(p_surse, '{}'::text[])), 'sursa', p_sursa,
                                'data', p_data, 'fragment', p_fragment, 'ref', p_ref)::text)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_amprenta(text, text[], text, date, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── diferențele dintre două instantanee ale rândului (câmp: [vechi, nou]), pe câmpurile care contează în jurnal ──
CREATE FUNCTION public.fn_executie_semnal_dif(p_vechi jsonb, p_nou jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_array(p_vechi -> k, p_nou -> k)), '{}'::jsonb)
    FROM unnest(ARRAY['gravitate', 'titlu', 'detalii', 'constatare', 'surse_consultate', 'dovada_sursa', 'dovada_data', 'dovada_fragment', 'dovada_ref',
                      'termen', 'termen_baza', 'termen_confirmat', 'incertitudine', 'propunere', 'responsabil_employee_id', 'responsabil_sursa',
                      'regula_versiune', 'stare', 'stare_motiv', 'stare_dovada', 'actiune_ref']) k
   WHERE p_vechi -> k IS DISTINCT FROM p_nou -> k
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_dif(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── garda semnalului (L07), pe ORICE cale: identitatea, versiunea, amprenta, ce poate atinge agentul (fără JWT) și ce poate atinge omul (cu JWT) ──
CREATE FUNCTION public.fn_executie_semnal_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'semnale: semnalele nu se șterg (istoricul rămâne)' USING ERRCODE = '42501';
  END IF;
  NEW.dovada_amprenta := public.fn_executie_semnal_amprenta(NEW.constatare, NEW.surse_consultate, NEW.dovada_sursa, NEW.dovada_data, NEW.dovada_fragment, NEW.dovada_ref);
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      RAISE EXCEPTION 'semnale: semnalele le scrie doar agentul (calea server)' USING ERRCODE = '42501';
    END IF;
    NEW.stare := 'nou'; NEW.stare_motiv := NULL; NEW.stare_dovada := NULL; NEW.actiune_ref := NULL; NEW.stare_de := NULL; NEW.stare_la := NULL;
    NEW.versiune := 1; NEW.detectat_la := now(); NEW.ultima_verificare := now();
    NEW.responsabil_sursa := CASE WHEN NEW.responsabil_employee_id IS NULL THEN NULL ELSE 'agent' END;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.proiect_id, NEW.flux, NEW.tip, NEW.obiect, NEW.detectat_la) IS DISTINCT FROM (OLD.id, OLD.proiect_id, OLD.flux, OLD.tip, OLD.obiect, OLD.detectat_la) THEN
    RAISE EXCEPTION 'semnale: identitatea semnalului (proiect, flux, tip, obiect, detectat_la) nu se schimbă' USING ERRCODE = '23514';
  END IF;
  NEW.versiune := OLD.versiune + 1;
  IF v_uid IS NULL THEN
    -- AGENTUL: constatarea și redeschiderea cu dovadă nouă; niciodată starea / motivul / dovada / acțiunea omului
    IF NEW.stare IS DISTINCT FROM OLD.stare THEN
      IF NOT public.fn_executie_semnal_tranzitie(OLD.stare, NEW.stare, 'agent') THEN
        RAISE EXCEPTION 'semnale: agentul nu schimbă starea dată de om (% -> %)', OLD.stare, NEW.stare USING ERRCODE = '42501';
      END IF;
      IF NEW.dovada_amprenta = OLD.dovada_amprenta THEN
        RAISE EXCEPTION 'semnale: un semnal % se redeschide doar cu o dovadă nouă', OLD.stare USING ERRCODE = '42501';
      END IF;
      NEW.stare_motiv := NULL; NEW.stare_dovada := NULL; NEW.actiune_ref := NULL; NEW.stare_de := NULL; NEW.stare_la := NULL;
    ELSIF (NEW.stare_motiv, NEW.stare_dovada, NEW.actiune_ref, NEW.stare_de, NEW.stare_la) IS DISTINCT FROM (OLD.stare_motiv, OLD.stare_dovada, OLD.actiune_ref, OLD.stare_de, OLD.stare_la) THEN
      RAISE EXCEPTION 'semnale: agentul nu atinge motivul / dovada / acțiunea date de om' USING ERRCODE = '42501';
    END IF;
    IF NEW.responsabil_employee_id IS DISTINCT FROM OLD.responsabil_employee_id THEN
      IF OLD.responsabil_sursa = 'om' THEN
        RAISE EXCEPTION 'semnale: responsabilul stabilit de om nu se schimbă de agent' USING ERRCODE = '42501';
      END IF;
      NEW.responsabil_sursa := CASE WHEN NEW.responsabil_employee_id IS NULL THEN NULL ELSE 'agent' END;
    ELSE
      NEW.responsabil_sursa := OLD.responsabil_sursa;
    END IF;
    NEW.ultima_verificare := now();
    RETURN NEW;
  END IF;
  -- OMUL: starea (cu motiv / dovadă / acțiune) și responsabilul; nimic din ce a constatat agentul
  IF (NEW.gravitate, NEW.titlu, NEW.detalii, NEW.constatare, NEW.surse_consultate, NEW.dovada_sursa, NEW.dovada_data, NEW.dovada_fragment, NEW.dovada_ref,
      NEW.termen, NEW.termen_baza, NEW.termen_confirmat, NEW.incertitudine, NEW.propunere, NEW.regula_versiune, NEW.ultima_verificare)
     IS DISTINCT FROM
     (OLD.gravitate, OLD.titlu, OLD.detalii, OLD.constatare, OLD.surse_consultate, OLD.dovada_sursa, OLD.dovada_data, OLD.dovada_fragment, OLD.dovada_ref,
      OLD.termen, OLD.termen_baza, OLD.termen_confirmat, OLD.incertitudine, OLD.propunere, OLD.regula_versiune, OLD.ultima_verificare) THEN
    RAISE EXCEPTION 'semnale: constatarea agentului nu se rescrie de om' USING ERRCODE = '42501';
  END IF;
  IF NEW.stare IS DISTINCT FROM OLD.stare AND NOT public.fn_executie_semnal_tranzitie(OLD.stare, NEW.stare, 'om') THEN
    RAISE EXCEPTION 'semnale: tranziție nepermisă (% -> %)', OLD.stare, NEW.stare USING ERRCODE = '23514';
  END IF;
  IF (NEW.stare, NEW.stare_motiv, NEW.stare_dovada, NEW.actiune_ref) IS DISTINCT FROM (OLD.stare, OLD.stare_motiv, OLD.stare_dovada, OLD.actiune_ref) THEN
    NEW.stare_de := v_uid; NEW.stare_la := now();
  ELSE
    NEW.stare_de := OLD.stare_de; NEW.stare_la := OLD.stare_la;
  END IF;
  IF NEW.responsabil_employee_id IS DISTINCT FROM OLD.responsabil_employee_id THEN
    NEW.responsabil_sursa := CASE WHEN NEW.responsabil_employee_id IS NULL THEN NULL ELSE 'om' END;
  ELSE
    NEW.responsabil_sursa := OLD.responsabil_sursa;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_semnal_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_semnale
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_semnal_garda();

-- ── jurnalul: doar adăugare; actorul și ora le pune serverul ──
CREATE FUNCTION public.fn_executie_semnal_jurnal_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'semnale: jurnalul e doar adăugare' USING ERRCODE = '42501';
  END IF;
  NEW.creat_la := now();
  NEW.actor_profile := auth.uid();
  NEW.actor := CASE WHEN NEW.actor_profile IS NULL THEN 'agent' ELSE 'om' END;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_jurnal_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_semnal_jurnal_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_semnale_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_semnal_jurnal_garda();
-- fără golire (TRUNCATE), pe ambele tabele, pentru oricine
CREATE FUNCTION public.fn_executie_semnal_fara_golire() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'semnale: % nu se golește', TG_TABLE_NAME USING ERRCODE = '42501';
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_fara_golire() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_semnale_fara_golire BEFORE TRUNCATE ON public.executie_semnale
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_semnal_fara_golire();
CREATE TRIGGER trg_executie_semnale_jurnal_fara_golire BEFORE TRUNCATE ON public.executie_semnale_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_executie_semnal_fara_golire();

-- ── RPC-ul AGENTULUI: scrie / actualizează un semnal. EXECUTE exclusiv service_role; în corp auth.uid() IS NULL (calea server, L08).
-- p_semnal: obiect cu cheile EXACTE (necunoscute = refuz): proiect_id, flux, tip, obiect, gravitate, titlu, constatare, regula_versiune
-- (obligatorii), detalii, surse_consultate (listă de texte), dovada_sursa, dovada_data (AAAA-LL-ZZ), dovada_fragment, dovada_ref, termen,
-- termen_baza, termen_confirmat, incertitudine, propunere, responsabil_employee_id (opționale, null = lipsă). Întoarce {ok, actiune, id, stare,
-- versiune}: actiune = creat | actualizat | neschimbat | redeschis | neschimbat_inchis (respins / rezolvat cu aceeași dovadă: nu reapare). ──
CREATE FUNCTION public.fn_executie_semnal_scrie(p_semnal jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  c record; v_strain text; v_proiect bigint; v_flux text; v_tip text; v_obiect text; v_resp integer; v_surse text[];
  v_dovada_data date; v_termen date; r public.executie_semnale; r2 public.executie_semnale; v_act text; v_dif jsonb; v_amp text;
  v_txt text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'semnale: calea agentului nu se cheamă cu un cont de utilizator' USING ERRCODE = '42501';
  END IF;
  IF p_semnal IS NULL OR jsonb_typeof(p_semnal) <> 'object' THEN
    RAISE EXCEPTION 'semnale: semnalul trebuie să fie un obiect' USING ERRCODE = '22023';
  END IF;
  -- 1. cheile și tipurile (listă exactă; null = lipsă pentru cele opționale)
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_strain FROM jsonb_object_keys(p_semnal) k
   WHERE k <> ALL (ARRAY['proiect_id', 'flux', 'tip', 'obiect', 'gravitate', 'titlu', 'detalii', 'constatare', 'surse_consultate', 'dovada_sursa', 'dovada_data',
                         'dovada_fragment', 'dovada_ref', 'termen', 'termen_baza', 'termen_confirmat', 'incertitudine', 'propunere', 'responsabil_employee_id', 'regula_versiune']);
  IF v_strain IS NOT NULL THEN RAISE EXCEPTION 'semnale: câmpuri necunoscute: %', v_strain USING ERRCODE = '22023'; END IF;
  FOR c IN SELECT * FROM (VALUES
      ('proiect_id', 'number', true), ('flux', 'string', true), ('tip', 'string', true), ('obiect', 'string', true), ('gravitate', 'string', true),
      ('titlu', 'string', true), ('constatare', 'string', true), ('regula_versiune', 'string', true),
      ('detalii', 'string', false), ('surse_consultate', 'array', false), ('dovada_sursa', 'string', false), ('dovada_data', 'string', false),
      ('dovada_fragment', 'string', false), ('dovada_ref', 'string', false), ('termen', 'string', false), ('termen_baza', 'string', false),
      ('termen_confirmat', 'boolean', false), ('incertitudine', 'string', false), ('propunere', 'string', false), ('responsabil_employee_id', 'number', false)
    ) v(cheie, tip, obligatoriu) LOOP
    IF c.obligatoriu AND coalesce(jsonb_typeof(p_semnal -> c.cheie), 'null') = 'null' THEN
      RAISE EXCEPTION 'semnale: câmpul % e obligatoriu', c.cheie USING ERRCODE = '22023';
    END IF;
    IF p_semnal ? c.cheie AND jsonb_typeof(p_semnal -> c.cheie) NOT IN (c.tip, 'null') THEN
      RAISE EXCEPTION 'semnale: câmpul % trebuie să fie % (primit %)', c.cheie, c.tip, jsonb_typeof(p_semnal -> c.cheie) USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (p_semnal ->> 'proiect_id') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'semnale: proiect_id invalid' USING ERRCODE = '22023'; END IF;
  v_proiect := (p_semnal ->> 'proiect_id')::bigint;
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = v_proiect) THEN
    RAISE EXCEPTION 'semnale: proiectul nu există' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_semnal -> 'responsabil_employee_id') = 'number' THEN
    IF (p_semnal ->> 'responsabil_employee_id') !~ '^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'semnale: responsabil_employee_id invalid' USING ERRCODE = '22023'; END IF;
    v_resp := (p_semnal ->> 'responsabil_employee_id')::integer;
    IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v_resp AND e.active IS NOT FALSE) THEN
      RAISE EXCEPTION 'semnale: responsabilul nu e un angajat activ' USING ERRCODE = '22023';
    END IF;
  END IF;
  FOREACH v_txt IN ARRAY ARRAY['dovada_data', 'termen'] LOOP
    IF jsonb_typeof(p_semnal -> v_txt) = 'string' AND (p_semnal ->> v_txt) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'semnale: % trebuie să fie o zi AAAA-LL-ZZ', v_txt USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_dovada_data := (p_semnal ->> 'dovada_data')::date;
  v_termen := (p_semnal ->> 'termen')::date;
  IF jsonb_typeof(p_semnal -> 'surse_consultate') = 'array' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_semnal -> 'surse_consultate') e(x)
                WHERE jsonb_typeof(e.x) <> 'string' OR length(e.x #>> '{}') NOT BETWEEN 1 AND 200 OR (e.x #>> '{}') !~ '[^[:space:]]' OR (e.x #>> '{}') ~ '[[:cntrl:]]') THEN
      RAISE EXCEPTION 'semnale: surse_consultate = listă de texte (1–200 de caractere, fără caractere de control)' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(btrim(e.x #>> '{}') ORDER BY ord), '{}'::text[]) INTO v_surse FROM jsonb_array_elements(p_semnal -> 'surse_consultate') WITH ORDINALITY e(x, ord);
  ELSE
    v_surse := '{}'::text[];
  END IF;
  v_flux := p_semnal ->> 'flux'; v_tip := p_semnal ->> 'tip'; v_obiect := btrim(p_semnal ->> 'obiect');
  -- 2. rândul existent, blocat ÎNAINTEA deciziei (L01); lipsă = INSERT cu ON CONFLICT DO NOTHING + recitire (L04: o cursă nu creează dublură)
  SELECT * INTO r FROM public.executie_semnale s WHERE s.proiect_id = v_proiect AND s.tip = v_tip AND s.obiect = v_obiect FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.executie_semnale (proiect_id, flux, tip, obiect, gravitate, titlu, detalii, constatare, surse_consultate, dovada_sursa, dovada_data,
                                         dovada_fragment, dovada_ref, dovada_amprenta, termen, termen_baza, termen_confirmat, incertitudine, propunere,
                                         responsabil_employee_id, regula_versiune)
    VALUES (v_proiect, v_flux, v_tip, v_obiect, p_semnal ->> 'gravitate', btrim(p_semnal ->> 'titlu'), nullif(btrim(p_semnal ->> 'detalii'), ''),
            p_semnal ->> 'constatare', v_surse, p_semnal ->> 'dovada_sursa', v_dovada_data, nullif(btrim(p_semnal ->> 'dovada_fragment'), ''),
            nullif(btrim(p_semnal ->> 'dovada_ref'), ''), repeat('0', 32), v_termen, nullif(btrim(p_semnal ->> 'termen_baza'), ''),
            (p_semnal ->> 'termen_confirmat')::boolean, nullif(btrim(p_semnal ->> 'incertitudine'), ''), nullif(btrim(p_semnal ->> 'propunere'), ''),
            v_resp, p_semnal ->> 'regula_versiune')
    ON CONFLICT ON CONSTRAINT executie_semnale_cheie_uq DO NOTHING
    RETURNING * INTO r2;
    IF r2.id IS NOT NULL THEN
      INSERT INTO public.executie_semnale_jurnal (semnal_id, proiect_id, actiune, stare_veche, stare_noua, actor, valori, regula_versiune)
      VALUES (r2.id, r2.proiect_id, 'creat', NULL, r2.stare, 'agent', public.fn_executie_semnal_dif('{}'::jsonb, to_jsonb(r2)), r2.regula_versiune);
      RETURN jsonb_build_object('ok', true, 'actiune', 'creat', 'id', r2.id, 'stare', r2.stare, 'versiune', r2.versiune);
    END IF;
    -- inserat între timp de altă tranzacție (necomis când am citit): acum e vizibil și îl blocăm
    SELECT * INTO STRICT r FROM public.executie_semnale s WHERE s.proiect_id = v_proiect AND s.tip = v_tip AND s.obiect = v_obiect FOR UPDATE;
  END IF;
  IF r.flux IS DISTINCT FROM v_flux THEN
    RAISE EXCEPTION 'semnale: tipul % e înregistrat pe fluxul %, nu %', v_tip, r.flux, v_flux USING ERRCODE = '22023';
  END IF;
  -- 3. semnal închis de om cu ACEEAȘI dovadă: nu reapare (doar ultima_verificare, prin gardă)
  v_amp := public.fn_executie_semnal_amprenta(p_semnal ->> 'constatare', v_surse, p_semnal ->> 'dovada_sursa', v_dovada_data,
                                               nullif(btrim(p_semnal ->> 'dovada_fragment'), ''), nullif(btrim(p_semnal ->> 'dovada_ref'), ''));
  IF r.stare IN ('rezolvat', 'respins') AND r.dovada_amprenta = v_amp THEN
    UPDATE public.executie_semnale s SET ultima_verificare = now() WHERE s.id = r.id RETURNING * INTO r2;
    RETURN jsonb_build_object('ok', true, 'actiune', 'neschimbat_inchis', 'id', r2.id, 'stare', r2.stare, 'versiune', r2.versiune);
  END IF;
  -- 4. actualizare (deschis) sau redeschidere cu dovadă nouă (închis); responsabilul stabilit de om rămâne
  v_act := CASE WHEN r.stare IN ('rezolvat', 'respins') THEN 'redeschis' ELSE 'actualizat' END;
  UPDATE public.executie_semnale s
     SET gravitate = p_semnal ->> 'gravitate', titlu = btrim(p_semnal ->> 'titlu'), detalii = nullif(btrim(p_semnal ->> 'detalii'), ''),
         constatare = p_semnal ->> 'constatare', surse_consultate = v_surse, dovada_sursa = p_semnal ->> 'dovada_sursa', dovada_data = v_dovada_data,
         dovada_fragment = nullif(btrim(p_semnal ->> 'dovada_fragment'), ''), dovada_ref = nullif(btrim(p_semnal ->> 'dovada_ref'), ''),
         termen = v_termen, termen_baza = nullif(btrim(p_semnal ->> 'termen_baza'), ''), termen_confirmat = (p_semnal ->> 'termen_confirmat')::boolean,
         incertitudine = nullif(btrim(p_semnal ->> 'incertitudine'), ''), propunere = nullif(btrim(p_semnal ->> 'propunere'), ''),
         responsabil_employee_id = CASE WHEN s.responsabil_sursa = 'om' THEN s.responsabil_employee_id ELSE v_resp END,
         regula_versiune = p_semnal ->> 'regula_versiune',
         stare = CASE WHEN v_act = 'redeschis' THEN 'nou' ELSE s.stare END,
         stare_motiv = CASE WHEN v_act = 'redeschis' THEN NULL ELSE s.stare_motiv END,
         stare_dovada = CASE WHEN v_act = 'redeschis' THEN NULL ELSE s.stare_dovada END,
         actiune_ref = CASE WHEN v_act = 'redeschis' THEN NULL ELSE s.actiune_ref END,
         stare_de = CASE WHEN v_act = 'redeschis' THEN NULL ELSE s.stare_de END,
         stare_la = CASE WHEN v_act = 'redeschis' THEN NULL ELSE s.stare_la END
   WHERE s.id = r.id
   RETURNING * INTO r2;
  v_dif := public.fn_executie_semnal_dif(to_jsonb(r), to_jsonb(r2));
  IF v_act = 'actualizat' AND v_dif = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', true, 'actiune', 'neschimbat', 'id', r2.id, 'stare', r2.stare, 'versiune', r2.versiune);
  END IF;
  INSERT INTO public.executie_semnale_jurnal (semnal_id, proiect_id, actiune, stare_veche, stare_noua, actor, motiv, valori, regula_versiune)
  VALUES (r2.id, r2.proiect_id, v_act, r.stare, r2.stare, 'agent',
          CASE WHEN v_act = 'redeschis' THEN 'dovadă nouă (amprenta ' || left(r.dovada_amprenta, 8) || ' -> ' || left(r2.dovada_amprenta, 8) || ')' END,
          v_dif, r2.regula_versiune);
  RETURN jsonb_build_object('ok', true, 'actiune', v_act, 'id', r2.id, 'stare', r2.stare, 'versiune', r2.versiune);
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_scrie(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_semnal_scrie(jsonb) TO service_role;

-- ── RPC-ul OMULUI: schimbă starea (cu motiv / dovadă / acțiune) și / sau responsabilul. EXECUTE authenticated; dreptul = fn_executie_semnal_drept,
-- verificat DUPĂ lock (L01); CAS pe versiune (L01: 0 rânduri = conflict, {ok: false, motiv: conflict, semnal}); p_stare NULL = starea rămâne;
-- p_schimba_responsabil = true aplică p_responsabil (NULL = fără responsabil). Rezolvarea / respingerea / redeschiderea cer motiv. ──
CREATE FUNCTION public.fn_executie_semnal_stare(p_id bigint, p_versiune integer, p_stare text, p_motiv text, p_dovada text, p_actiune_ref text,
                                                p_responsabil integer, p_schimba_responsabil boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); r public.executie_semnale; r2 public.executie_semnale; v_motiv text; v_dovada text; v_ref text; v_stare text;
  v_dif jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'semnale: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_versiune IS NULL THEN RAISE EXCEPTION 'semnale: id și versiune obligatorii' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.executie_semnale s WHERE s.id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_executie_semnal_drept(r.proiect_id, r.responsabil_employee_id) THEN
    RAISE EXCEPTION 'semnale: semnalul nu există sau nu ai drept asupra lui' USING ERRCODE = '42501';
  END IF;
  IF r.versiune <> p_versiune THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'semnal', to_jsonb(r));
  END IF;
  IF p_stare IS NOT NULL AND p_stare NOT IN ('in_lucru', 'asteapta_informatii', 'rezolvat', 'respins') THEN
    RAISE EXCEPTION 'semnale: stare necunoscută sau nepermisă omului (%)', p_stare USING ERRCODE = '22023';
  END IF;
  v_stare := coalesce(p_stare, r.stare);
  -- starea neschimbată + text lipsă = textul rămâne (schimbarea doar a responsabilului nu cere rescrierea motivului); la o stare nouă textele sunt cele trimise
  v_motiv := coalesce(nullif(btrim(coalesce(p_motiv, '')), ''), CASE WHEN v_stare = r.stare THEN r.stare_motiv END);
  v_dovada := coalesce(nullif(btrim(coalesce(p_dovada, '')), ''), CASE WHEN v_stare = r.stare THEN r.stare_dovada END);
  v_ref := coalesce(nullif(btrim(coalesce(p_actiune_ref, '')), ''), CASE WHEN v_stare = r.stare THEN r.actiune_ref END);
  IF v_stare = 'nou' AND (v_motiv IS NOT NULL OR v_dovada IS NOT NULL OR v_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'semnale: motivul / dovada / acțiunea se scriu odată cu o stare (semnalul e încă nou)' USING ERRCODE = '22023';
  END IF;
  IF v_stare <> r.stare AND NOT public.fn_executie_semnal_tranzitie(r.stare, v_stare, 'om') THEN
    RAISE EXCEPTION 'semnale: tranziție nepermisă (% -> %)', r.stare, v_stare USING ERRCODE = '22023';
  END IF;
  IF v_stare IN ('rezolvat', 'respins') AND v_motiv IS NULL THEN
    RAISE EXCEPTION 'semnale: rezolvarea / respingerea cere un motiv' USING ERRCODE = '22023';
  END IF;
  IF r.stare IN ('rezolvat', 'respins') AND v_stare <> r.stare AND v_motiv IS NULL THEN
    RAISE EXCEPTION 'semnale: redeschiderea cere un motiv' USING ERRCODE = '22023';
  END IF;
  IF p_schimba_responsabil IS TRUE AND p_responsabil IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_responsabil AND e.active IS NOT FALSE) THEN
    RAISE EXCEPTION 'semnale: responsabilul nu e un angajat activ' USING ERRCODE = '22023';
  END IF;
  IF v_stare = r.stare AND v_motiv IS NOT DISTINCT FROM r.stare_motiv AND v_dovada IS NOT DISTINCT FROM r.stare_dovada AND v_ref IS NOT DISTINCT FROM r.actiune_ref
     AND NOT (p_schimba_responsabil IS TRUE AND p_responsabil IS DISTINCT FROM r.responsabil_employee_id) THEN
    RAISE EXCEPTION 'semnale: nimic de schimbat' USING ERRCODE = '22023';
  END IF;
  UPDATE public.executie_semnale s
     SET stare = v_stare, stare_motiv = v_motiv, stare_dovada = v_dovada, actiune_ref = v_ref,
         responsabil_employee_id = CASE WHEN p_schimba_responsabil IS TRUE THEN p_responsabil ELSE s.responsabil_employee_id END
   WHERE s.id = r.id AND s.versiune = p_versiune
   RETURNING * INTO r2;
  IF r2.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'semnal', to_jsonb(r));
  END IF;
  v_dif := public.fn_executie_semnal_dif(to_jsonb(r), to_jsonb(r2));
  INSERT INTO public.executie_semnale_jurnal (semnal_id, proiect_id, actiune, stare_veche, stare_noua, actor, actor_profile, motiv, dovada, valori, regula_versiune)
  VALUES (r2.id, r2.proiect_id, CASE WHEN v_stare <> r.stare OR v_motiv IS DISTINCT FROM r.stare_motiv OR v_dovada IS DISTINCT FROM r.stare_dovada
                                          OR v_ref IS DISTINCT FROM r.actiune_ref THEN 'stare' ELSE 'responsabil' END,
          r.stare, r2.stare, 'om', v_uid, v_motiv, v_dovada, v_dif, r2.regula_versiune);
  RETURN jsonb_build_object('ok', true, 'semnal', to_jsonb(r2));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_semnal_stare(bigint, integer, text, text, text, text, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_semnal_stare(bigint, integer, text, text, text, text, integer, boolean) TO authenticated;

-- ── RLS + drepturi: citire prin politici (același drept); nicio scriere directă pentru rolurile API (L07) ──
ALTER TABLE public.executie_semnale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_semnale_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_semnale, public.executie_semnale_jurnal FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.executie_semnale_id_seq, public.executie_semnale_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_semnale, public.executie_semnale_jurnal TO authenticated, service_role;
CREATE POLICY executie_semnale_citire ON public.executie_semnale FOR SELECT TO authenticated
  USING (public.fn_executie_semnal_drept(proiect_id, responsabil_employee_id));
CREATE POLICY executie_semnale_jurnal_citire ON public.executie_semnale_jurnal FOR SELECT TO authenticated
  USING (public.fn_executie_semnal_drept_id(semnal_id));

-- ── vederea ecranului: semnalul + codul / numele proiectului (cu drepturile apelantului) ──
CREATE VIEW public.v_executie_semnale WITH (security_invoker = on) AS
  SELECT s.*, e.cod_intern AS proiect_cod, e.nume AS proiect_nume
    FROM public.executie_semnale s
    JOIN public.executie_proiecte e ON e.id = s.proiect_id;
REVOKE ALL ON public.v_executie_semnale FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_executie_semnale TO authenticated, service_role;
COMMENT ON VIEW public.v_executie_semnale IS 'Execuție: semnalele agentului verificator, cu codul și numele proiectului (security_invoker: RLS-ul apelantului). 20270106a.';

-- ── postcondiții ──
DO $post$
DECLARE v_s oid := 'public.executie_semnale'::regclass; v_j oid := 'public.executie_semnale_jurnal'::regclass; v_rau text;
  v_fn name[] := ARRAY['fn_executie_semnal_drept', 'fn_executie_semnal_drept_id', 'fn_executie_semnal_tranzitie', 'fn_executie_semnal_amprenta',
    'fn_executie_semnal_dif', 'fn_executie_semnal_garda', 'fn_executie_semnal_jurnal_garda', 'fn_executie_semnal_fara_golire',
    'fn_executie_semnal_scrie', 'fn_executie_semnal_stare']::name[];
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_s) IS NOT TRUE OR (SELECT relrowsecurity FROM pg_class WHERE oid = v_j) IS NOT TRUE
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('executie_semnale', 'executie_semnale_jurnal')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_semnale' AND policyname = 'executie_semnale_citire'
                      AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE'
                      AND replace(qual, 'public.', '') = 'fn_executie_semnal_drept(proiect_id, responsabil_employee_id)')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_semnale_jurnal' AND policyname = 'executie_semnale_jurnal_citire'
                      AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE'
                      AND replace(qual, 'public.', '') = 'fn_executie_semnal_drept_id(semnal_id)') THEN
    RAISE EXCEPTION '20270106a post: RLS / politicile';
  END IF;
  -- drepturile pe tabele, fiecare pe rând: doar SELECT pentru authenticated / service_role; nimic pentru anon / PUBLIC / pe coloane / secvențe
  SELECT string_agg(DISTINCT x.tab || '/' || y.rol || '/' || z.drept, ', ') INTO v_rau
    FROM unnest(ARRAY['executie_semnale', 'executie_semnale_jurnal', 'v_executie_semnale']) x(tab), unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol),
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
   WHERE has_table_privilege(y.rol, ('public.' || x.tab)::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol <> 'anon');
  IF v_rau IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e
                 WHERE c.oid IN (v_s, v_j, 'public.v_executie_semnale'::regclass) AND e.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN (v_s, v_j) AND a.attnum > 0 AND a.attacl IS NOT NULL)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol), unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) d(drept)
                 WHERE has_sequence_privilege(r.rol, 'public.executie_semnale_id_seq', d.drept) OR has_sequence_privilege(r.rol, 'public.executie_semnale_jurnal_id_seq', d.drept))
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_executie_semnale'::regclass AND 'security_invoker=on' = ANY (reloptions)) THEN
    RAISE EXCEPTION '20270106a post: privilegii pe tabele / secvente / vedere: %', coalesce(v_rau, 'PUBLIC / coloane / secvente / security_invoker');
  END IF;
  -- funcțiile: exact 10, search_path fix, DEFINER doar la drept / drept_id / scrie / stare, proprietar postgres, EXECUTE exact pe clasă
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_executie\_semnal\_%') <> 10
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_fn)
                 AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
                      OR p.prosecdef IS DISTINCT FROM (p.proname IN ('fn_executie_semnal_drept', 'fn_executie_semnal_drept_id', 'fn_executie_semnal_scrie', 'fn_executie_semnal_stare'))
                      OR has_function_privilege('anon', p.oid, 'EXECUTE')
                      OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname = 'fn_executie_semnal_scrie')
                      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                         IS DISTINCT FROM (p.proname IN ('fn_executie_semnal_drept', 'fn_executie_semnal_drept_id', 'fn_executie_semnal_stare'))
                      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0))) THEN
    RAISE EXCEPTION '20270106a post: functii (numar / definer / search_path / EXECUTE)';
  END IF;
  -- trigger-ele: exact cele 4, cu funcția și tipul lor, active, fără WHEN / argumente / coloane
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (v_s, v_j)) <> 4
     OR (SELECT count(*) FROM pg_trigger tg JOIN (VALUES
           (v_s, 'trg_executie_semnal_garda', 'public.fn_executie_semnal_garda()', 1 | 2 | 4 | 8 | 16),
           (v_j, 'trg_executie_semnal_jurnal_garda', 'public.fn_executie_semnal_jurnal_garda()', 1 | 2 | 4 | 8 | 16),
           (v_s, 'trg_executie_semnale_fara_golire', 'public.fn_executie_semnal_fara_golire()', 2 | 32),
           (v_j, 'trg_executie_semnale_jurnal_fara_golire', 'public.fn_executie_semnal_fara_golire()', 2 | 32)
         ) a(rel, nume, fn, tip) ON tg.tgrelid = a.rel AND tg.tgname = a.nume AND tg.tgfoid = to_regprocedure(a.fn) AND tg.tgtype = a.tip::int2
            AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgattr::text = '') <> 4 THEN
    RAISE EXCEPTION '20270106a post: trigger-ele';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = v_s AND contype = 'u' AND conname = 'executie_semnale_cheie_uq') <> 1
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = v_s AND contype = 'f') <> 2
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = v_j AND contype = 'f') <> 1 THEN
    RAISE EXCEPTION '20270106a post: cheile';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_semnale) OR EXISTS (SELECT 1 FROM public.executie_semnale_jurnal) THEN
    RAISE EXCEPTION '20270106a post: migrarea nu scrie date';
  END IF;
  PERFORM pg_temp.lant_20270106a('dupa');
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270106a_executie_semnale:' || txid_current() THEN
    RAISE EXCEPTION '20270106a: garda final invalida';
  END IF;
  RAISE NOTICE '20270106a: sfarsit la % ms de la BEGIN; lock-uri puternice tinute de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
DROP FUNCTION pg_temp.lant_20270106a(text);
