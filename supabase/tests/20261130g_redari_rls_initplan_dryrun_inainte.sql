-- DRY 20261130g_redari_rls_initplan — PASUL 1 din 2 („înainte”). Se rulează ÎNAINTEA migrării, în ACEEAȘI tranzacție anulată:
--   BEGIN ISOLATION LEVEL REPEATABLE READ;     -- OBLIGATORIU: un singur snapshot pentru „înainte” și „după” (pasul 1 refuză altfel)
--   SELECT set_config('gazpet.livrare_migrare', '20261130g_redari_rls_initplan:' || txid_current(), true);
--   \i supabase/tests/20261130g_redari_rls_initplan_dryrun_inainte.sql     -- instantaneul „inainte” (forma veche, per rând)
--   \i supabase/migrations/20261130g_redari_rls_initplan.sql
--   \i supabase/tests/20261130g_redari_rls_initplan_dryrun.sql             -- instantaneul „dupa” + comparație + EXPLAIN + timpi
--   ROLLBACK;
-- Revenirea NU se rulează în tranzacția DRY de pe live: după ea politicile sunt iar per rând (lente) și s-ar citi sub ACCESS EXCLUSIVE.
--   Pe live revenirea se verifică prin postcondiția ei (expresiile vechi EXACTE); ciclul apply → revenire → re-apply + „înainte = revenire” e în harness.
-- Fereastra de lock (L06 / Copilot r2 P2-01): tot ce e greu (instantaneul pe 6 identități cu politicile vechi, per rând; benchmark-ul „înainte”) rulează
--   AICI, ÎNAINTEA migrării — tranzacția ține doar ACCESS SHARE (nu blochează citirile / scrierile aplicației, doar DDL concurent). După \i migrare
--   rămân doar verificări rapide (politicile sunt deja InitPlan); pasul 2 raportează durata ferestrei și refuză peste prag.
-- De ce două fișiere: după migrare forma veche nu mai există, deci instantaneul „înainte” se ia înainte de \i migrare, într-o tabelă TEMP
-- (ON COMMIT DROP, dispare la ROLLBACK), scrisă doar ca postgres.
-- Ce reține, pe fiecare identitate × fiecare tabel / view red_*:
--   • număr de rânduri VĂZUTE + md5 pe conținut, pe PROIECȚIA coloanelor pe care authenticated are SELECT (privilegii reale pe coloană,
--     ex. red_parcele fără valoare_lei; aceeași proiecție și pentru referința postgres), sau SQLSTATE-ul refuzului;
--   • pentru fiecare coloană fără SELECT pentru authenticated, obiectul „tabel.coloana”: refuzul (42501) trebuie să rămână refuz;
--   • deciziile politicilor (TEST4), FĂRĂ NICIUN DML: expresia USING / WITH CHECK a fiecărei politici e evaluată direct ca fiecare identitate
--     (SELECT <expr> FROM (VALUES <tabela>) — singura coloană de rând folosită e red_jurnal.tabela). Nicio scriere, niciun trigger, nicio secvență
--     consumată (Jakarinos r2 P2-01). Echivalența de scriere rezultă din: expresia nouă = expresia veche cu fn_red_nivel() → (select fn_red_nivel())
--     (comparată EXACT în preflight + postcondiție) + aceeași valoare a expresiei pe fiecare identitate înainte / după + valoarea așteptată
--     independent (nivelul identității din user_module_access / profiles pus în locul funcției);
--   • timpii (NOTICE) pe interogările REALE ale aplicației, ca viewer: DashboardEcran (red_v_centralizator_uat, red_v_tronson) și ultima pagină
--     din Registru (red_v_stare_parcela cu count exact + ORDER BY id_parcela, nume + LIMIT 100 OFFSET ultima pagină), pe proiectul cu cele mai
--     multe parcele; ordinea EXACTĂ din UI + cheia unică doar ca ultim criteriu, md5 agregat cu ORDER BY (identic înainte / după).
-- Identități (reale, simulate prin request.jwt.claims + SET LOCAL ROLE): owner, admin non-owner, editor, viewer, fără acces, anon.
-- Izolare (Jakarinos r3 P2-01): tranzacția DRY e REPEATABLE READ, deci toate citirile (înainte, după, benchmark, alegerea proiectului) văd
--   ACELAȘI snapshot, luat la prima interogare din acest fișier; scrierile concurente comise între faze nu produc diferențe false. Migrarea nu
--   cere READ COMMITTED: face doar DDL (ALTER POLICY, CREATE INDEX) și citiri de catalog (care folosesc snapshot de catalog propriu).
-- Fereastra de lock: migrarea pune lock_timeout 2 s + statement_timeout 5 s înaintea primului LOCK; ambele rămân active și în pasul 2, deci
--   fiecare verificare de după migrare are cel mult 5 s (limita superioară e scrisă în antetul migrării și în pasul 2).
CREATE FUNCTION pg_temp.r30g_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                                ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30g_ca(uuid, text) TO authenticated, anon;

CREATE TEMP TABLE r30g_id (eticheta text PRIMARY KEY, uid uuid, rol text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE r30g_snap (faza text, eticheta text, obiect text, n bigint, h text, eroare text, PRIMARY KEY (faza, eticheta, obiect)) ON COMMIT DROP;
CREATE TEMP TABLE r30g_timp (faza text, obiect text, ms numeric, h text, PRIMARY KEY (faza, obiect)) ON COMMIT DROP;
CREATE TEMP TABLE r30g_eval (faza text, eticheta text, politica text, tip text, rez text, PRIMARY KEY (faza, eticheta, politica, tip)) ON COMMIT DROP;

DO $t$
DECLARE own uuid; adm uuid; ed uuid; vw uuid; fara uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130g_redari_rls_initplan:' || txid_current() THEN
    RAISE EXCEPTION 'DRY30g inainte FAIL: garda (ruleaza in tranzactia migrarii, inaintea ei)';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'repeatable read' THEN
    RAISE EXCEPTION 'DRY30g inainte FAIL: tranzactia trebuie sa fie REPEATABLE READ (BEGIN ISOLATION LEVEL REPEATABLE READ), nu %', current_setting('transaction_isolation');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.red_uat'::regclass AND pg_get_expr(p.polqual, p.polrelid) LIKE '%SELECT fn_red_nivel%') THEN
    RAISE EXCEPTION 'DRY30g inainte FAIL: politicile sunt deja in forma noua (ruleaza fisierul INAINTEA migrarii)';
  END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO adm FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level = 'admin' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level = 'editor' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.module = 'redari' AND a.access_level = 'viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT p.id INTO fara FROM public.profiles p
   WHERE p.is_owner IS NOT TRUE AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = p.id AND a.module = 'redari') ORDER BY p.id LIMIT 1;
  IF own IS NULL OR adm IS NULL OR ed IS NULL OR vw IS NULL OR fara IS NULL THEN RAISE EXCEPTION 'DRY30g inainte FAIL: identitati lipsa'; END IF;
  INSERT INTO pg_temp.r30g_id VALUES ('owner', own, 'authenticated'), ('admin', adm, 'authenticated'), ('editor', ed, 'authenticated'),
                                     ('viewer', vw, 'authenticated'), ('fara_acces', fara, 'authenticated'), ('anon', NULL, 'anon');
END $t$;

-- obiectele si interogarile instantaneului, din catalog (include red_corespondenta_mailuri daca exista):
--   proiectia = coloanele cu SELECT pentru authenticated (fara ele: count(*) simplu); plus cate un obiect „tabel.coloana” per coloana refuzata
CREATE FUNCTION pg_temp.r30g_obiecte() RETURNS TABLE (obiect text, q text) LANGUAGE sql AS $h$
  WITH rel AS (SELECT c.oid, c.relname::text AS rel FROM pg_class c
                WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v') AND c.relname ~ '^red_'),
  col AS (SELECT r.rel, string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) FILTER (WHERE has_column_privilege('authenticated', r.oid, a.attnum, 'SELECT')) AS permise
            FROM rel r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped GROUP BY r.rel)
  SELECT c.rel, CASE WHEN c.permise IS NULL THEN format('SELECT count(*), NULL::text FROM public.%I', c.rel)
                     ELSE format('SELECT count(*), md5(coalesce(string_agg(md5(ROW(%s)::text), '','' ORDER BY md5(ROW(%s)::text)), '''')) FROM public.%I t',
                                 c.permise, c.permise, c.rel) END
    FROM col c
  UNION ALL
  SELECT r.rel || '.' || a.attname, format('SELECT count(%I), NULL::text FROM public.%I', a.attname, r.rel)
    FROM rel r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE NOT has_column_privilege('authenticated', r.oid, a.attnum, 'SELECT') AND has_any_column_privilege('authenticated', r.oid, 'SELECT')
$h$;

-- instantaneu: ce VEDE fiecare identitate
CREATE FUNCTION pg_temp.r30g_numara(p_faza text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE i record; o record; v_n bigint; v_h text; v_e text; v_rez jsonb; v_ob jsonb;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'DRY30g: r30g_numara se apeleaza ca postgres'; END IF;
  SELECT jsonb_agg(jsonb_build_object('o', obiect, 'q', q) ORDER BY obiect) INTO v_ob FROM pg_temp.r30g_obiecte();
  FOR i IN SELECT * FROM pg_temp.r30g_id ORDER BY eticheta LOOP
    v_rez := '{}'::jsonb;
    PERFORM pg_temp.r30g_ca(i.uid, i.rol);
    FOR o IN SELECT x ->> 'o' AS obiect, x ->> 'q' AS q FROM jsonb_array_elements(v_ob) x LOOP
      BEGIN
        EXECUTE o.q INTO v_n, v_h; v_e := NULL;
      EXCEPTION WHEN OTHERS THEN v_n := NULL; v_h := NULL; v_e := SQLSTATE;
      END;
      v_rez := v_rez || jsonb_build_object(o.obiect, jsonb_build_object('n', v_n, 'h', v_h, 'e', v_e));
    END LOOP;
    PERFORM pg_temp.r30g_ca(NULL, 'postgres');
    INSERT INTO pg_temp.r30g_snap SELECT p_faza, i.eticheta, k, (v ->> 'n')::bigint, v ->> 'h', v ->> 'e' FROM jsonb_each(v_rez) e(k, v);
  END LOOP;
  -- referinta (fara RLS): aceleasi interogari, ca postgres
  FOR o IN SELECT x ->> 'o' AS obiect, x ->> 'q' AS q FROM jsonb_array_elements(v_ob) x LOOP
    EXECUTE o.q INTO v_n, v_h;
    INSERT INTO pg_temp.r30g_snap VALUES (p_faza, 'postgres', o.obiect, v_n, v_h, NULL);
  END LOOP;
END $h$;

-- deciziile politicilor, fara DML: fiecare expresie (USING = q, WITH CHECK = w) a fiecarei politici red_* evaluata ca fiecare identitate
--   pe cele 3 valori relevante ale coloanei de rand red_jurnal.tabela (celelalte politici nu folosesc coloane); rezultat = vectorul de boolean
--   sau 'err:SQLSTATE'. Expresiile se deparseaza cu search_path = public, pg_temp (ca baseline-ul migrarii).
CREATE FUNCTION pg_temp.r30g_evalueaza(p_faza text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE i record; x record; v_sp text := current_setting('search_path'); v_r text; v_exp jsonb; v_rez jsonb;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'DRY30g: r30g_evalueaza se apeleaza ca postgres'; END IF;
  PERFORM set_config('search_path', 'public, pg_temp', true);
  SELECT jsonb_agg(jsonb_build_object('p', c.relname || '.' || p.polname, 't', t.tip, 'e', t.expr) ORDER BY c.relname, p.polname, t.tip) INTO v_exp
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    CROSS JOIN LATERAL (VALUES ('q', pg_get_expr(p.polqual, p.polrelid)), ('w', pg_get_expr(p.polwithcheck, p.polrelid))) t(tip, expr)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname ~ '^red_' AND t.expr IS NOT NULL;
  FOR i IN SELECT * FROM pg_temp.r30g_id ORDER BY eticheta LOOP
    v_rez := '{}'::jsonb;
    PERFORM pg_temp.r30g_ca(i.uid, i.rol);
    FOR x IN SELECT e ->> 'p' AS p, e ->> 't' AS t, e ->> 'e' AS expr FROM jsonb_array_elements(v_exp) e LOOP
      BEGIN
        EXECUTE format('SELECT array_agg((%s) ORDER BY v.tabela)::text FROM (VALUES (%L), (%L), (%L)) v(tabela)', x.expr,
                       'red_detinatori_contact', 'red_parcele', 'red_raspunsuri_meta') INTO v_r;
      EXCEPTION WHEN OTHERS THEN v_r := 'err:' || SQLSTATE;
      END;
      v_rez := v_rez || jsonb_build_object(x.p || '|' || x.t, v_r);
    END LOOP;
    PERFORM pg_temp.r30g_ca(NULL, 'postgres');
    INSERT INTO pg_temp.r30g_eval SELECT p_faza, i.eticheta, split_part(k, '|', 1), split_part(k, '|', 2), v #>> '{}' FROM jsonb_each(v_rez) e(k, v);
  END LOOP;
  -- asteptarea independenta (doar in faza inainte): aceeasi expresie veche, cu fn_red_nivel() inlocuit de nivelul ASTEPTAT al identitatii
  --   (cel dupa care a fost aleasa din user_module_access / profiles, nu din functie), evaluata ca postgres; anon nu are EXECUTE pe fn_red_nivel
  IF p_faza = 'inainte' THEN
    FOR i IN SELECT r.eticheta, CASE r.eticheta WHEN 'owner' THEN 'admin' WHEN 'admin' THEN 'admin' WHEN 'editor' THEN 'editor' WHEN 'viewer' THEN 'viewer' END AS niv
               FROM pg_temp.r30g_id r ORDER BY 1 LOOP
      FOR x IN SELECT e ->> 'p' AS p, e ->> 't' AS t, e ->> 'e' AS expr FROM jsonb_array_elements(v_exp) e LOOP
        IF i.eticheta = 'anon' THEN v_r := 'err:42501';
        ELSE
          EXECUTE format('SELECT array_agg((%s) ORDER BY v.tabela)::text FROM (VALUES (%L), (%L), (%L)) v(tabela)',
                         replace(x.expr, 'fn_red_nivel()', quote_nullable(i.niv) || '::text'), 'red_detinatori_contact', 'red_parcele', 'red_raspunsuri_meta') INTO v_r;
        END IF;
        INSERT INTO pg_temp.r30g_eval VALUES ('asteptat', i.eticheta, x.p, x.t, v_r);
      END LOOP;
    END LOOP;
  END IF;
  PERFORM set_config('search_path', v_sp, true);
END $h$;

-- timpi ca viewer pe interogarile reale ale aplicatiei (min din 3; informativ, NOTICE) + md5 pe rezultat (trebuie identic intre faze)
--   ordinea EXACTA din UI (DashboardEcran: uat_id, stare / parcela_id; Registru: id_parcela, nume), cu cheia unica a vederii ca ultim criteriu
--   unde ordinea UI nu e deja totala (verificat live 04.11: (uat_id, stare), parcela_id si (parcela_id, detinator_id) sunt unice in vederi)
CREATE FUNCTION pg_temp.r30g_cronometreaza(p_faza text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE v_vw uuid := (SELECT uid FROM pg_temp.r30g_id WHERE eticheta = 'viewer'); v_pr uuid; o record; k integer; t0 timestamptz;
        v_min numeric; v_ms numeric; v_h text; v_n bigint; v_rez jsonb := '{}'::jsonb;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'DRY30g: r30g_cronometreaza se apeleaza ca postgres'; END IF;
  SELECT proiect_id INTO v_pr FROM public.red_parcele GROUP BY proiect_id ORDER BY count(*) DESC, proiect_id LIMIT 1;
  PERFORM pg_temp.r30g_ca(v_vw, 'authenticated');
  FOR o IN SELECT * FROM (VALUES
      ('dashboard_centralizator', format('SELECT md5(coalesce(string_agg(q::text, %L ORDER BY q::text), %L)) FROM (SELECT uat_id, uat3, uat_nume, stare, numar, total_uat, procent_inchise'
         || ' FROM public.red_v_centralizator_uat t WHERE stare IS NOT NULL AND proiect_id = %L ORDER BY uat_id, stare LIMIT 1000) q', '|', '', v_pr)),
      ('dashboard_tronson', format('SELECT md5(coalesce(string_agg(q::text, %L ORDER BY q::text), %L)) FROM (SELECT parcela_id, tronson, tip_pv, obiectii_deschise'
         || ' FROM public.red_v_tronson t WHERE proiect_id = %L ORDER BY parcela_id LIMIT 1000) q', '|', '', v_pr)),
      ('registru_ultima_pagina', NULL)) AS v(obiect, q) LOOP
    v_min := NULL;
    FOR k IN 1..3 LOOP
      t0 := clock_timestamp();
      IF o.q IS NOT NULL THEN
        EXECUTE o.q INTO v_h;
      ELSE   -- Registru: count exact + pagina 100 (ORDER BY id_parcela, nume EXACT ca UI-ul; + parcela_id, detinator_id = cheia unica, ultim criteriu), ultima pagina
        EXECUTE 'SELECT count(*) FROM public.red_v_stare_parcela WHERE proiect_id = $1' INTO v_n USING v_pr;
        EXECUTE 'SELECT md5(coalesce(string_agg(q::text, ''|'' ORDER BY q::text), '''')) FROM (SELECT t.* FROM public.red_v_stare_parcela t WHERE proiect_id = $1'
             || ' ORDER BY id_parcela, nume, parcela_id, detinator_id LIMIT 100 OFFSET $2) q' INTO v_h USING v_pr, greatest(0, ((v_n - 1) / 100) * 100);
        v_h := v_n || ':' || v_h;
      END IF;
      v_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1);
      v_min := least(coalesce(v_min, v_ms), v_ms);
    END LOOP;
    v_rez := v_rez || jsonb_build_object(o.obiect, jsonb_build_object('ms', v_min, 'h', v_h));
  END LOOP;
  PERFORM pg_temp.r30g_ca(NULL, 'postgres');
  INSERT INTO pg_temp.r30g_timp SELECT p_faza, k2, (v ->> 'ms')::numeric, v ->> 'h' FROM jsonb_each(v_rez) e(k2, v);
  RAISE NOTICE 'DRY30g timpi % (viewer, ms, min din 3, proiect %): %', p_faza, v_pr, (SELECT jsonb_object_agg(k2, v -> 'ms') FROM jsonb_each(v_rez) e(k2, v));
END $h$;

-- comparatie intre doua faze: aceleasi obiecte, acelasi numar + acelasi continut + acelasi refuz, pe fiecare identitate
CREATE FUNCTION pg_temp.r30g_compara(p_a text, p_b text) RETURNS void LANGUAGE plpgsql AS $h$
DECLARE v_dif text[]; v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_temp.r30g_snap WHERE faza = p_a;
  IF v_n = 0 THEN RAISE EXCEPTION 'DRY30g FAIL: faza % lipseste (ai rulat fisierul _inainte?)', p_a; END IF;
  SELECT array_agg(coalesce(a.eticheta, b.eticheta) || '/' || coalesce(a.obiect, b.obiect) ORDER BY 1) INTO v_dif
    FROM (SELECT * FROM pg_temp.r30g_snap WHERE faza = p_a) a
    FULL JOIN (SELECT * FROM pg_temp.r30g_snap WHERE faza = p_b) b ON b.eticheta = a.eticheta AND b.obiect = a.obiect
   WHERE a.obiect IS NULL OR b.obiect IS NULL OR a.n IS DISTINCT FROM b.n OR a.h IS DISTINCT FROM b.h OR a.eroare IS DISTINCT FROM b.eroare;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION 'DRY30g FAIL: randuri vazute diferite % vs %: %', p_a, p_b, v_dif; END IF;
  RAISE NOTICE 'DRY30g OK: % = % pe % (identitate, obiect)', p_a, p_b, v_n;
END $h$;

SELECT pg_temp.r30g_numara('inainte');
SELECT pg_temp.r30g_evalueaza('inainte');
SELECT pg_temp.r30g_cronometreaza('inainte');
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN RAISE EXCEPTION 'DRY30g inainte FAIL: rol / claims ramase'; END IF;
  RAISE NOTICE 'DRY30g inainte OK: % randuri in instantaneu, % evaluari de politica', (SELECT count(*) FROM pg_temp.r30g_snap WHERE faza = 'inainte'),
               (SELECT count(*) FROM pg_temp.r30g_eval WHERE faza = 'inainte');
END $t$;
