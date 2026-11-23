-- Version 20261231120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261231a_magazie_intrare_referinta.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2, ca 20261229b).
--   Lista OBIECTELOR revizuită (familie, etichetă, operație; verificată pe PGlite cu pașii reali ai runnerului):
--   supabase/tests/20261231a_magazie_intrare_referinta.l15.obiecte.tsv.
-- 20261231a_magazie_intrare_referinta — Magazie → Echipamente, „Adaugă din factură” (TKT-2026-0353, PR #1150 runda 5; decizia owner-ului
--   20.11.2026, varianta A): ACEEAȘI intrare (aceeași referință de intenție) nu poate fi salvată de două ori ca rând nou.
-- Ce face:
--   * magazie_echipamente.referinta_intentie (uuid, NULL permis): cheia intenției „rând nou din factură”, generată în ecran o dată pe rând și
--     refolosită la orice retrimitere a ACELEIAȘI intenții (L04). NULL = rândurile existente și celelalte căi de scriere (Adaugă, EIP, mutări):
--     nu sunt atinse.
--   * UNIQUE magazie_echipamente_referinta_intentie_key (referinta_intentie), NULLS DISTINCT (implicit): rândurile fără referință nu intră în
--     comparație (NULL ≠ NULL), deci efectul e al unui index unic parțial „WHERE referinta_intentie IS NOT NULL”. De ce NU un index parțial:
--     ecranul scrie prin PostgREST `upsert(…, { onConflict: 'referinta_intentie', ignoreDuplicates: true })` = INSERT … ON CONFLICT
--     (referinta_intentie) DO NOTHING, iar PostgreSQL deduce un index PARȚIAL doar dacă instrucțiunea repetă predicatul (PostgREST nu îl poate
--     trimite) → 42P10 la orice salvare. Proba PGlite arată ambele (mutantul cu index parțial = salvarea refuzată).
--   * trigger trg_magazie_referinta_intentie BEFORE UPDATE OF referinta_intentie: referința se scrie DOAR la INSERT; orice UPDATE care o schimbă
--     (și NULL → valoare, și valoare → NULL) = 23514. Altfel un PATCH direct ar putea șterge cheia și o retrimitere ar dubla rândul (L08 / L07).
-- Retrimiterea (în ecran, src/magazieIntrareStoc.js insereazaNoi): INSERT … ON CONFLICT DO NOTHING, apoi recitirea pe referință: exact un rând
--   cu conținutul intenției = „salvat” (nu dublură); aceeași referință cu alt conținut = refuz, nimic scris pentru rândul acela.
-- Ce NU face: nu modifică niciun rând existent (coloana nouă e NULL peste tot), nu atinge politicile / drepturile / RLS-ul tabelului (coloana nu
--   primește drepturi proprii: le moștenește pe cele de pe tabel, verificat în postcondiții), nu adaugă RPC.
-- ORDINEA LIVRĂRII: migrarea ÎNAINTEA merge-ului codului din PR #1150 (ecranul nou trimite coloana; fără ea PostgREST refuză inserarea, 4xx,
--   nimic scris). Ecranul vechi nu trimite coloana și merge neschimbat și după migrare.
-- Ordinea lock-urilor (L06): migrarea ia doar magazie_echipamente; triggerul nu blochează nimic în afara rândului scris.
-- Lock la aplicare (punct unic, NOWAIT, bugetul 1 s de la prima încercare, docs/LIVRARE_L15_V2.md §9): magazie_echipamente ACCESS EXCLUSIVE
--   (ADD COLUMN fără valoare implicită = doar catalog; UNIQUE construiește indexul pe coloana goală; CREATE TRIGGER).
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, garda finală.
-- Porțile Izometrie: magazie_echipamente nu e amprentat de ele (docs/izometrie/PORTI_REGULA.md; detectorul o verifică în CI).
-- Revenire: supabase/revenire/20261231a_magazie_intrare_referinta_ROLLBACK.sql. Probe: scripts/pglite/test_magazie_intrare_referinta_local.mjs.
DO $pre$
DECLARE v_plafon text; v_tip text; r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261231a_magazie_intrare_referinta:' || txid_current() THEN
    RAISE EXCEPTION '20261231a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261231a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261231a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261231a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261231a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261229b)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261231a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.magazie_echipamente') IS NULL THEN RAISE EXCEPTION '20261231a: magazie_echipamente lipseste'; END IF;
  -- reaplicare = refuz (orice urmă a obiectelor migrării)
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie' AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace AND k.conname = 'magazie_echipamente_referinta_intentie_key')
     OR to_regclass('public.magazie_echipamente_referinta_intentie_key') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.magazie_echipamente'::regclass AND t.tgname = 'trg_magazie_referinta_intentie')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_magazie_referinta_intentie_imuabila') THEN
    RAISE EXCEPTION '20261231a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele pe care ecranul le scrie la inserare și le recitește după referință, cu tipurile acceptate (citite din catalog, nu ghicite)
  FOR r IN SELECT * FROM (VALUES ('id', 'bigint|integer'), ('denumire', 'text|character varying'), ('categorie', 'text|character varying'),
      ('este_eip', 'boolean'), ('um', 'text|character varying'), ('serie', 'text|character varying'), ('cantitate_total', 'numeric|integer|bigint'),
      ('stare', 'text|character varying'), ('observatii', 'text|character varying'), ('activ', 'boolean'), ('created_by', 'uuid')) v(c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'magazie_echipamente' AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261231a: coloana magazie_echipamente.% lipseste sau are alt tip (%; asteptat %)', r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  -- ecranul inserează și recitește ca authenticated: drepturile pe TABEL (coloana nouă le moștenește), verificate pe rând (has_table_privilege
  --   cu o listă e adevărat la ORICARE drept)
  IF NOT has_table_privilege('authenticated', 'public.magazie_echipamente', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.magazie_echipamente', 'SELECT') THEN
    RAISE EXCEPTION '20261231a: authenticated nu are INSERT / SELECT pe magazie_echipamente (designul a fost revizuit pe starea cu ambele drepturi)';
  END IF;
END $pre$;

-- ── lock-ul pe magazie_echipamente (punct unic, NOWAIT, bugetul 1 s de la PRIMA încercare; momentul în gazpet.lock_puternic_la pentru LOCK_TINUT) ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261231a: BUGET_LOCK: magazie_echipamente ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.magazie_echipamente IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261231a: BUGET_LOCK: lock-ul pe magazie_echipamente obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261231a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
  -- informativ (după lock: numărătoare stabilă): toate rândurile existente rămân fără referință (NULL), deci în afara regulii de unicitate
  RAISE NOTICE '20261231a: randuri existente (raman fara referinta) = %', (SELECT count(*) FROM public.magazie_echipamente);
END $lock$;

-- ─── 1. Coloana și unicitatea (NULLS DISTINCT: rândurile fără referință nu se compară între ele) ─────────────────────────────
ALTER TABLE public.magazie_echipamente ADD COLUMN referinta_intentie uuid;
ALTER TABLE public.magazie_echipamente ADD CONSTRAINT magazie_echipamente_referinta_intentie_key UNIQUE (referinta_intentie);
COMMENT ON COLUMN public.magazie_echipamente.referinta_intentie IS 'Magazie (20261231a): referinta intentiei „rand nou din factura” (retrimiterea cu aceeasi referinta nu dubleaza randul); scrisa doar la INSERT; NULL = alta cale.';

-- ─── 2. Referința nu se mai schimbă după INSERT ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_magazie_referinta_intentie_imuabila() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF NEW.referinta_intentie IS DISTINCT FROM OLD.referinta_intentie THEN
    RAISE EXCEPTION 'magazie: referinta intentiei se scrie doar la adaugarea randului (referinta_intentie)' USING ERRCODE = '23514',
      HINT = 'Referinta nu se modifica si nu se sterge.';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_magazie_referinta_intentie_imuabila() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_magazie_referinta_intentie BEFORE UPDATE OF referinta_intentie ON public.magazie_echipamente
  FOR EACH ROW EXECUTE FUNCTION public.fn_magazie_referinta_intentie_imuabila();

-- ─── 3. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_amp text;
BEGIN
  -- coloana: uuid, NULL permis, fără valoare implicită / identitate / generare, fără drepturi proprii (moștenește tabelul)
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie'
                   AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype AND NOT a.attnotnull AND NOT a.atthasdef AND a.attidentity = ''
                   AND a.attgenerated = '' AND a.attacl IS NULL) THEN
    RAISE EXCEPTION '20261231a post: coloana magazie_echipamente.referinta_intentie (uuid, NULL permis, fara implicit / drepturi proprii)';
  END IF;
  -- unicitatea: constrângerea exactă, indexul ei unic, NEPARȚIAL, NULLS DISTINCT, imediată (ON CONFLICT o poate deduce)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_index i ON i.indexrelid = k.conindid
                  WHERE k.conrelid = 'public.magazie_echipamente'::regclass AND k.conname = 'magazie_echipamente_referinta_intentie_key'
                    AND k.contype = 'u' AND k.convalidated AND NOT k.condeferrable AND pg_get_constraintdef(k.oid) = 'UNIQUE (referinta_intentie)'
                    AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL AND NOT i.indnullsnotdistinct AND i.indnatts = 1)
     OR (SELECT count(*) FROM pg_index i WHERE i.indrelid = 'public.magazie_echipamente'::regclass
           AND i.indkey::text = (SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie')) <> 1 THEN
    RAISE EXCEPTION '20261231a post: unicitatea pe referinta_intentie (UNIQUE neparțial, NULLS DISTINCT, un singur index)';
  END IF;
  -- drepturile ecranului pe coloana nouă, verificate pe rând
  IF NOT has_column_privilege('authenticated', 'public.magazie_echipamente', 'referinta_intentie', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.magazie_echipamente', 'referinta_intentie', 'SELECT') THEN
    RAISE EXCEPTION '20261231a post: authenticated nu poate scrie / citi referinta_intentie';
  END IF;
  -- funcția triggerului: plpgsql, INVOKER, volatilă, NU STRICT, search_path fix, proprietar postgres, fără EXECUTE pentru alții
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = to_regprocedure('public.fn_magazie_referinta_intentie_imuabila()') AND l.lanname = 'plpgsql' AND NOT p.prosecdef
                    AND p.provolatile = 'v' AND NOT p.proisstrict AND p.prokind = 'f' AND NOT p.proleakproof
                    AND p.prorettype = 'trigger'::regtype AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                    AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND (SELECT string_agg(a.d, ', ' ORDER BY a.d COLLATE "C") FROM (
                           SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                                  || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d
                             FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a) = 'postgres:EXECUTE')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_magazie_referinta_intentie_imuabila') <> 1 THEN
    RAISE EXCEPTION '20261231a post: functia fn_magazie_referinta_intentie_imuabila (limbaj / definer / strict / search_path / owner / drepturi exacte)';
  END IF;
  -- triggerul exact: BEFORE UPDATE OF referinta_intentie, pe rând, activ, fără WHEN / argumente (tgtype 19 = ROW + BEFORE + UPDATE)
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.magazie_echipamente'::regclass AND t.tgname = 'trg_magazie_referinta_intentie'
        AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgfoid = 'public.fn_magazie_referinta_intentie_imuabila()'::regprocedure AND t.tgtype = 19
        AND t.tgqual IS NULL AND t.tgnargs = 0
        -- (int2vector are indicele de început 0: se compară textul, „<attnum>” = exact o coloană)
        AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie')) <> 1 THEN
    RAISE EXCEPTION '20261231a post: triggerul trg_magazie_referinta_intentie';
  END IF;
  -- nimic schimbat în date: niciun rând nu are referință
  IF EXISTS (SELECT 1 FROM public.magazie_echipamente e WHERE e.referinta_intentie IS NOT NULL) THEN
    RAISE EXCEPTION '20261231a post: randuri cu referinta dupa migrare';
  END IF;
  -- AMPRENTA_20261231a_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'col ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' def=' || a.atthasdef
           || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text || ' acl=' || coalesce(a.attacl::text, '-') AS l
      FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie' AND NOT a.attisdropped
    UNION ALL
    SELECT 'con ' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' defer=' || k.condeferrable || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k WHERE k.conrelid = 'public.magazie_echipamente'::regclass AND k.conname = 'magazie_echipamente_referinta_intentie_key'
    UNION ALL
    -- orice index care conține coloana nouă (al constrângerii; un index în plus = abatere)
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' nnd=' || i.indnullsnotdistinct || ' valid=' || i.indisvalid
      FROM pg_index i WHERE i.indrelid = 'public.magazie_echipamente'::regclass
       AND (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie') = ANY (i.indkey::int2[])
    UNION ALL
    SELECT 'trg ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t WHERE t.tgrelid = 'public.magazie_echipamente'::regclass AND NOT t.tgisinternal AND t.tgname = 'trg_magazie_referinta_intentie'
    UNION ALL
    -- orice obiect care depinde de coloana nouă sau de funcția nouă (în afara constrângerii / indexului / triggerului = vedere, politică …: abatere)
    SELECT 'dep ' || pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> ' || pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) || ' ' || d.deptype::text
      FROM pg_depend d
     WHERE (d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.magazie_echipamente'::regclass
            AND d.refobjsubid = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.magazie_echipamente'::regclass AND a.attname = 'referinta_intentie'))
        OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure('public.fn_magazie_referinta_intentie_imuabila()'))
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_magazie_referinta_intentie_imuabila'
  ) x;
  -- AMPRENTA_20261231a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM 'fe28f2660a5d24a63b37b9d79f949158' THEN
    RAISE NOTICE 'AMPRENTA_20261231a_TEXT %', v_amp;
    RAISE EXCEPTION '20261231a post: AMPRENTA obiectelor % (asteptat fe28f2660a5d24a63b37b9d79f949158)', md5(coalesce(v_amp, ''));
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261231a_magazie_intrare_referinta:' || txid_current() THEN
    RAISE EXCEPTION '20261231a: garda final invalida';
  END IF;
  RAISE NOTICE '20261231a: sfarsit la % ms de la BEGIN; lock-ul pe magazie_echipamente tinut de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
