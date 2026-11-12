-- DRY 20261131e_intrebari_cercetare_surse — runda 3 (regresiile SQL din review-ul #1012 r2). DOAR pe CLONĂ, ca postgres.
-- Runner: o singură tranzacție ANULATĂ (migrare + teste + revenire + re-aplicare + ROLLBACK), din rădăcina repo-ului:
--   psql -X -v ON_ERROR_STOP=1 <<'SQL'
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.livrare_migrare', '20261131e_intrebari_cercetare_surse:' || txid_current(), true);
--   \i supabase/migrations/20261131e_intrebari_cercetare_surse.sql
--   \i supabase/tests/20261131e_intrebari_cercetare_surse_dryrun.sql
--   ROLLBACK;
--   SQL
-- Fiecare test rulează într-un SAVEPOINT anulat la final. Date FICTIVE: întrebări „TEST 20261131e r3” ale ownerului (autorul vine
-- din JWT, ca în UI: request.jwt.claim.sub + request.jwt.claims), anulate odată cu tranzacția.
--   T1 (r2 P2-4) revenirea STANDARD (SCOATE_CERCETARE, fără date noi, deci fără arhivă) merge până la capăt — postcondiția nu mai
--      rezolvă numele arhivei inexistente — și lasă starea 20261105a; apoi migrarea se RE-APLICĂ (apply → rollback → re-apply).
--   T2 (r2 P2-4) revenirea cu ARHIVEAZA, cu date noi: arhiva există, are RLS, fără politici, fără SELECT pentru anon / authenticated,
--      conține întrebarea marcată, iar 'de_verificat' a trecut în 'raspuns'.
--   T3 (r2 P2-5) fn_intrebari_preia blochează întrebările expirate ÎNAINTEA jurnalului (ordinea din corp) și expirarea închide jurnalul
--      ('expirat') + întrebarea ('eroare'). Concurența reală (2 sesiuni, fără deadlock, mutantul r2 = 40P01):
--      scripts/test_intrebari_preia_lock.sh.
--   T4 (runda 4, review r3 P2 / L15) MIGRAREA REFUZĂ o schemă care nu e baseline-ul: după revenire, o versiune ulterioară a unei
--      funcții înlocuite (T4a, corp schimbat), o setare nouă pe o funcție de care depinde (T4b) și un trigger nou pe tabel (T4c);
--      martorul T4m (fără mutant) trece. Cere blocul AMPRENTE BASELINE completat (pașii 1-5 din antetul migrării).
--   T5 (runda 4) REVENIREA REFUZĂ o versiune ulterioară sub același nume: corp schimbat (T5a), SECURITY INVOKER (T5b).
--   Fișierele migrării și revenirii se citesc EXACT de pe disc (\copy, linie cu linie) și se execută prin pg_temp.r31e_aplica;
--   fiecare mutant se anulează (santinelă), ca la PR #1029.
CREATE FUNCTION pg_temp.r31e_intrebare(p_titlu text) RETURNS bigint LANGUAGE plpgsql AS $h$
DECLARE own uuid; q bigint;
BEGIN
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  IF own IS NULL THEN RAISE EXCEPTION 'pregătire: lipsește ownerul'; END IF;
  PERFORM set_config('request.jwt.claim.sub', own::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', own, 'role', 'authenticated')::text, true);
  INSERT INTO public.intrebari_tehnice (titlu, intrebare) VALUES (p_titlu, 'Întrebare fictivă pentru DRY 20261131e r3') RETURNING id INTO q;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN q;
END $h$;

-- ─── T1: revenirea standard + re-aplicarea ────────────────────────────────
SAVEPOINT t1;
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM public.intrebari_preluari WHERE NOT din_istoric) THEN RAISE EXCEPTION 'T1 PREGĂTIRE: jurnalul are deja rânduri noi'; END IF;
  IF to_regclass('public.intrebari_cercetare_arhiva_20261131e') IS NOT NULL THEN RAISE EXCEPTION 'T1 PREGĂTIRE: arhiva există deja'; END IF;
END $t$;
SELECT set_config('gazpet.revenire_20261131e', 'SCOATE_CERCETARE:' || txid_current(), true);
\ir ../revenire/20261131e_intrebari_cercetare_surse_ROLLBACK.sql
DO $t$
BEGIN
  IF to_regclass('public.intrebari_preluari') IS NOT NULL
     OR to_regclass('public.intrebari_cercetare_arhiva_20261131e') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_reia(bigint)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'intrebari_tehnice'
                  AND column_name IN ('surse', 'de_verificat_la', 'interogari_web')) THEN
    RAISE EXCEPTION 'T1 FAIL: revenirea standard nu a lăsat starea 20261105a';
  END IF;
  IF coalesce(current_setting('gazpet.revenire_20261131e', true), '') <> '' THEN RAISE EXCEPTION 'T1 FAIL: revenirea nu s-a dezarmat'; END IF;
END $t$;
SELECT set_config('gazpet.livrare_migrare', '20261131e_intrebari_cercetare_surse:' || txid_current(), true);
\ir ../migrations/20261131e_intrebari_cercetare_surse.sql
DO $t$
BEGIN
  IF to_regclass('public.intrebari_preluari') IS NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'T1 FAIL: re-aplicarea migrării după revenire';
  END IF;
  RAISE NOTICE 'T1 OK: apply → revenire standard (fără arhivă) → re-apply';
END $t$;
ROLLBACK TO SAVEPOINT t1;

-- ─── T2: revenirea cu arhivare, cu date noi ───────────────────────────────
SAVEPOINT t2;
DO $t$
DECLARE q bigint := pg_temp.r31e_intrebare('TEST 20261131e r3 T2');
BEGIN
  UPDATE public.intrebari_tehnice SET stare = 'de_verificat', de_verificat_la = now(), surse = '[{"id": "C1", "tip": "corpus"}]'::jsonb WHERE id = q;
  INSERT INTO public.intrebari_preluari (intrebare_id, incercare_id) VALUES (q, gen_random_uuid());
  PERFORM set_config('r31e.q', q::text, true);
END $t$;
SELECT set_config('gazpet.revenire_20261131e', 'SCOATE_CERCETARE_ARHIVEAZA:' || txid_current(), true);
\ir ../revenire/20261131e_intrebari_cercetare_surse_ROLLBACK.sql
DO $t$
DECLARE a oid := to_regclass('public.intrebari_cercetare_arhiva_20261131e'); q bigint := current_setting('r31e.q')::bigint;
BEGIN
  IF a IS NULL OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = a) OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = a)
     OR has_table_privilege('authenticated', a, 'SELECT') OR has_table_privilege('anon', a, 'SELECT') THEN
    RAISE EXCEPTION 'T2 FAIL: arhiva lipsește sau e citibilă de anon / authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.intrebari_cercetare_arhiva_20261131e WHERE fel = 'intrebare' AND intrebare_id = q)
     OR NOT EXISTS (SELECT 1 FROM public.intrebari_cercetare_arhiva_20261131e WHERE fel = 'preluare' AND intrebare_id = q)
     OR (SELECT stare FROM public.intrebari_tehnice WHERE id = q) IS DISTINCT FROM 'raspuns' THEN
    RAISE EXCEPTION 'T2 FAIL: datele noi nu sunt în arhivă / de_verificat nu a trecut în raspuns';
  END IF;
  RAISE NOTICE 'T2 OK: revenire cu arhivare';
END $t$;
ROLLBACK TO SAVEPOINT t2;

-- ─── T3: expirarea în fn_intrebari_preia — ordinea lock-urilor și efectul ───
SAVEPOINT t3;
DO $t$
DECLARE
  src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_intrebari_preia()'::regprocedure);
  p_lock int; p_jurnal int;
  q bigint; u uuid := gen_random_uuid();
BEGIN
  p_lock := position('FOR UPDATE OF t' IN src);
  p_jurnal := position('UPDATE public.intrebari_preluari' IN src);
  IF p_lock = 0 OR p_jurnal = 0 OR p_lock > p_jurnal THEN
    RAISE EXCEPTION 'T3 FAIL: fn_intrebari_preia nu blochează întrebările înaintea jurnalului (lock %, jurnal %)', p_lock, p_jurnal;
  END IF;
  q := pg_temp.r31e_intrebare('TEST 20261131e r3 T3');
  UPDATE public.intrebari_tehnice SET stare = 'in_lucru', preluat_la = now() - interval '31 minutes', incercari = 1, incercare_id = u WHERE id = q;
  INSERT INTO public.intrebari_preluari (intrebare_id, incercare_id, preluat_la) VALUES (q, u, now() - interval '31 minutes');
  PERFORM public.fn_intrebari_preia();
  IF (SELECT rezultat FROM public.intrebari_preluari WHERE incercare_id = u) IS DISTINCT FROM 'expirat'
     OR (SELECT inchis_la FROM public.intrebari_preluari WHERE incercare_id = u) IS NULL
     OR (SELECT tokeni->>'cost_necunoscut' FROM public.intrebari_preluari WHERE incercare_id = u) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'T3 FAIL: jurnalul preluării expirate nu e închis „expirat” cu cost necunoscut';
  END IF;
  IF (SELECT stare FROM public.intrebari_tehnice WHERE id = q) IS DISTINCT FROM 'eroare'
     OR (SELECT incercare_id FROM public.intrebari_tehnice WHERE id = q) IS NOT NULL THEN
    RAISE EXCEPTION 'T3 FAIL: întrebarea expirată nu a trecut în eroare';
  END IF;
  RAISE NOTICE 'T3 OK: expirarea blochează întrebarea înaintea jurnalului și le închide pe amândouă';
END $t$;
ROLLBACK TO SAVEPOINT t3;

-- ─── T4 / T5 (runda 4): amprentele — refuzul la o versiune ulterioară ─────
-- fișierele, exact de pe disc (CSV cu delimitatori care nu apar în SQL: fiecare linie = un rând, fără interpretarea backslash-ului)
CREATE TEMP TABLE r31e_src (fisier text, nr bigint GENERATED ALWAYS AS IDENTITY, linie text);
\copy r31e_src (linie) FROM 'supabase/migrations/20261131e_intrebari_cercetare_surse.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02')
UPDATE r31e_src SET fisier = 'mig' WHERE fisier IS NULL;
\copy r31e_src (linie) FROM 'supabase/revenire/20261131e_intrebari_cercetare_surse_ROLLBACK.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02')
UPDATE r31e_src SET fisier = 'rb' WHERE fisier IS NULL;

-- aplică migrarea ('mig', cu marcajul runnerului) sau revenirea standard ('rb', armată SCOATE_CERCETARE); 'ok' sau 'SQLSTATE: mesaj'
CREATE FUNCTION pg_temp.r31e_aplica(p_fisier text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_sql text := (SELECT string_agg(coalesce(s.linie, ''), E'\n' ORDER BY s.nr) FROM pg_temp.r31e_src s WHERE s.fisier = p_fisier);
  v_marcaj text := current_setting('gazpet.livrare_migrare', true);
  v_r text := 'ok';
BEGIN
  IF v_sql IS NULL THEN RETURN 'EROARE_TEST: fisierul ' || p_fisier || ' nu s-a citit'; END IF;
  IF p_fisier = 'mig' THEN
    PERFORM set_config('gazpet.livrare_migrare', '20261131e_intrebari_cercetare_surse:' || txid_current(), true);
  ELSE
    PERFORM set_config('gazpet.revenire_20261131e', 'SCOATE_CERCETARE:' || txid_current(), true);
  END IF;
  BEGIN
    EXECUTE v_sql;
  EXCEPTION WHEN OTHERS THEN
    v_r := SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('gazpet.livrare_migrare', coalesce(v_marcaj, ''), true);
  PERFORM set_config('gazpet.revenire_20261131e', '', true);
  RETURN v_r;
END $f$;

-- (opțional revenirea întâi) + schimbarea de schemă + aplicarea, toate anulate la final (santinelă); întoarce rezultatul aplicării
CREATE FUNCTION pg_temp.r31e_mutant(p_revenire_intai boolean, p_ddl text, p_fisier text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_r text;
BEGIN
  BEGIN
    IF p_revenire_intai THEN
      v_r := pg_temp.r31e_aplica('rb');
      IF v_r <> 'ok' THEN v_r := 'EROARE_TEST: revenirea de pregatire: ' || v_r; RAISE EXCEPTION 'r31e_santinela'; END IF;
    END IF;
    IF p_ddl IS NOT NULL THEN EXECUTE p_ddl; END IF;
    v_r := pg_temp.r31e_aplica(p_fisier);
    RAISE EXCEPTION 'r31e_santinela';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'r31e_santinela' THEN v_r := 'EROARE_TEST: ' || SQLERRM; END IF;
  END;
  RETURN v_r;
END $f$;

-- versiunea „cu un comentariu în plus” a unei funcții existente (CREATE OR REPLACE: aceeași semnătură, alt corp)
CREATE FUNCTION pg_temp.r31e_corp_schimbat(p_oid oid) RETURNS text LANGUAGE sql AS $f$
  SELECT regexp_replace(pg_get_functiondef(p_oid), 'AS (\$[A-Za-z0-9_]*\$)', 'AS \1' || chr(10) || '-- mutant dry-run 20261131e r4')
$f$;

DO $t$
DECLARE v_r text;
BEGIN
  -- T4m: martorul — după revenire, migrarea neschimbată trece (amprentele de după revenire = baseline-ul)
  v_r := pg_temp.r31e_mutant(true, NULL, 'mig');
  IF v_r IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'T4m FAIL: migrarea dupa revenire, fara mutant: %', v_r; END IF;
  -- T4a: o versiune ulterioară a unei funcții înlocuite de migrare (corp schimbat DUPĂ revenire, aceeași semnătură)
  v_r := pg_temp.r31e_mutant(true,
           'DO $m$ BEGIN EXECUTE pg_temp.r31e_corp_schimbat(''public.fn_intrebari_amana(bigint,uuid)''::regprocedure); END $m$', 'mig');
  IF v_r NOT LIKE 'P0001: 20261131e: amprentele schemei difera%fn:public.fn_intrebari_amana(bigint,uuid) (difera)%' THEN
    RAISE EXCEPTION 'T4a FAIL: amprentele schemei difera era asteptat pentru fn_intrebari_amana, a iesit: %', v_r;
  END IF;
  -- T4b: o setare nouă pe o funcție de care depinde migrarea (proconfig)
  v_r := pg_temp.r31e_mutant(true, 'ALTER FUNCTION public.fn_are_acces_intrebari() SET work_mem = ''64kB''', 'mig');
  IF v_r NOT LIKE 'P0001: 20261131e: amprentele schemei difera%fn:public.fn_are_acces_intrebari() (difera)%' THEN
    RAISE EXCEPTION 'T4b FAIL: amprentele schemei difera era asteptat pentru fn_are_acces_intrebari, a iesit: %', v_r;
  END IF;
  -- T4c: un trigger nou pe intrebari_tehnice
  v_r := pg_temp.r31e_mutant(true, 'CREATE TRIGGER zz_dryrun_20261131e BEFORE UPDATE ON public.intrebari_tehnice FOR EACH ROW '
                                   || 'EXECUTE FUNCTION public.fn_intrebari_inainte_insert()', 'mig');
  IF v_r NOT LIKE 'P0001: 20261131e: amprentele schemei difera%trg:public.intrebari_tehnice.zz_dryrun_20261131e (nou pe tinta)%' THEN
    RAISE EXCEPTION 'T4c FAIL: amprentele schemei difera era asteptat pentru triggerul nou, a iesit: %', v_r;
  END IF;
  RAISE NOTICE 'T4 OK: migrarea refuza versiunea ulterioara a unei functii, o setare noua si un trigger nou (martorul trece)';

  -- T5a: revenirea pe o versiune ulterioară a unei funcții create de migrare (corp schimbat)
  v_r := pg_temp.r31e_mutant(false, 'DO $m$ BEGIN EXECUTE pg_temp.r31e_corp_schimbat(''public.fn_intrebari_preia()''::regprocedure); END $m$', 'rb');
  IF v_r NOT LIKE 'P0001: 20261131e revenire: public.fn_intrebari_preia() are alt corp decat versiunea 20261131e%' THEN
    RAISE EXCEPTION 'T5a FAIL: alt corp decat versiunea 20261131e era asteptat, a iesit: %', v_r;
  END IF;
  -- T5b: aceeași funcție, alt atribut (SECURITY INVOKER)
  v_r := pg_temp.r31e_mutant(false, 'ALTER FUNCTION public.fn_intrebari_reia(bigint) SECURITY INVOKER', 'rb');
  IF v_r NOT LIKE 'P0001: 20261131e revenire: atributele public.fn_intrebari_reia(bigint) difera%' THEN
    RAISE EXCEPTION 'T5b FAIL: refuzul pe atribute era asteptat, a iesit: %', v_r;
  END IF;
  -- martorul T5m: revenirea neschimbată trece (și se anulează)
  v_r := pg_temp.r31e_mutant(false, NULL, 'rb');
  IF v_r IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'T5m FAIL: revenirea fara mutant: %', v_r; END IF;
  RAISE NOTICE 'T5 OK: revenirea refuza o versiune ulterioara (alt corp decat versiunea 20261131e, alt atribut); martorul trece';
END $t$;

DO $t$ BEGIN RAISE NOTICE 'DRY 20261131e r4: T1–T5 OK (tranzacția se anulează de runner)'; END $t$;
