-- DRY 20270105b_executie_proiect_configurare: se ruleaza DUPA 20270105a + 20270105b, intr-o singura tranzactie cu ROLLBACK la final, pe clona PG17
-- (psql -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_executie_rest_decontat_local.mjs). Blocurile din plan (Task 2, pasul 1):
-- proiect fara oferta → MP: exceptie (fara_oferta); owner fara motiv: exceptie; owner cu motiv: ok + motiv salvat + jurnal; proiect cu oferta
-- confirmata: ok pentru MP (fara exceptie); in plus: coloanele poartei nu se schimba direct (nici de owner), idempotenta, jurnalul doar citibil.
-- Conturi SINTETICE: a = owner, b = MP al P1 si P3. FIXTURI: pe clona, daca profiles / employees cer alte coloane NOT NULL, se completeaza doar aici.
BEGIN;
SET LOCAL search_path = public, pg_temp;
CREATE TEMP TABLE rd_fix (k text PRIMARY KEY, id bigint) ON COMMIT DROP;
GRANT SELECT, INSERT ON rd_fix TO authenticated, service_role;
DO $fix$
DECLARE v bigint;
BEGIN
  INSERT INTO public.employees (id, name) VALUES (9201, 'RD MP POARTA');
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id) SELECT x::uuid FROM unnest(ARRAY['f0000000-0000-4000-8000-00000000001a', 'f0000000-0000-4000-8000-00000000001b']) x ON CONFLICT (id) DO NOTHING;
  END IF;
  INSERT INTO public.profiles (id, is_owner, employee_id) VALUES ('f0000000-0000-4000-8000-00000000001a', true, NULL), ('f0000000-0000-4000-8000-00000000001b', false, 9201)
  ON CONFLICT (id) DO UPDATE SET is_owner = EXCLUDED.is_owner, employee_id = EXCLUDED.employee_id;
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P1', 'Dry poarta P1', 9201) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p1', v);
  INSERT INTO public.executie_proiecte (cod_intern, nume, mp_employee_id) VALUES ('RD-P3', 'Dry poarta P3 fara oferta', 9201) RETURNING id INTO v;
  INSERT INTO rd_fix VALUES ('p3', v);
END $fix$;
CREATE FUNCTION pg_temp.rd_id(p text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT id FROM rd_fix WHERE k = p $f$;
CREATE FUNCTION pg_temp.rd_identitate(p uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF auth.uid() IS DISTINCT FROM p OR current_user <> 'authenticated' OR (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'identitate gresita: uid % user %', auth.uid(), current_user;
  END IF;
END $f$;

-- ── t_poarta_mp: MP-ul pe un proiect fara oferta → fara_oferta; starea ramane „in configurare” ──────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000001b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000001b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000001b');
  BEGIN
    v := public.fn_executie_proiect_configurare_completa(pg_temp.rd_id('p3'), 'MP incearca cu motiv');
    RAISE EXCEPTION 't_poarta_mp FAIL: MP-ul a declarat configurarea fara oferta';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%fara_oferta%' THEN RAISE; END IF; END;
  IF (SELECT configurare_completa_la FROM public.executie_proiecte WHERE id = pg_temp.rd_id('p3')) IS NOT NULL THEN RAISE EXCEPTION 't_poarta_mp FAIL: starea s-a schimbat'; END IF;
  IF EXISTS (SELECT 1 FROM public.executie_proiect_configurare_jurnal) THEN RAISE EXCEPTION 't_poarta_mp FAIL: jurnal scris la refuz'; END IF;
  RAISE NOTICE 't_poarta_mp ok: fara oferta, MP-ul e refuzat (fara_oferta), nimic scris';
END $t$;
RESET ROLE;

-- ── t_poarta_owner: owner fara motiv → exceptie; cu motiv → ok, motiv salvat, jurnal cu exceptie; a doua chemare = deja ───────────
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000001a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000001a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000001a');
  BEGIN
    v := public.fn_executie_proiect_configurare_completa(pg_temp.rd_id('p3'), NULL);
    RAISE EXCEPTION 't_poarta_owner FAIL: owner fara motiv acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    v := public.fn_executie_proiect_configurare_completa(pg_temp.rd_id('p3'), '   ');
    RAISE EXCEPTION 't_poarta_owner FAIL: owner cu motiv gol acceptat';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT configurare_completa_la FROM public.executie_proiecte WHERE id = pg_temp.rd_id('p3')) IS NOT NULL THEN RAISE EXCEPTION 't_poarta_owner FAIL: starea s-a schimbat la refuz'; END IF;
  v := public.fn_executie_proiect_configurare_completa(pg_temp.rd_id('p3'), '  Urgenta:  oferta  vine saptamana viitoare ');
  IF (v->>'ok')::boolean IS NOT TRUE OR (v->>'deja')::boolean IS NOT FALSE OR (v->>'exceptie')::boolean IS NOT TRUE OR v->>'motiv' <> 'Urgenta: oferta vine saptamana viitoare' THEN
    RAISE EXCEPTION 't_poarta_owner FAIL: %', v;
  END IF;
  SELECT configurare_completa_la, configurare_exceptie_motiv INTO r FROM public.executie_proiecte WHERE id = pg_temp.rd_id('p3');
  IF r.configurare_completa_la IS NULL OR r.configurare_exceptie_motiv <> 'Urgenta: oferta vine saptamana viitoare' THEN RAISE EXCEPTION 't_poarta_owner FAIL: coloanele (%)', row_to_json(r); END IF;
  SELECT profile_id, cu_exceptie, motiv, oferta_randuri INTO r FROM public.executie_proiect_configurare_jurnal WHERE proiect_id = pg_temp.rd_id('p3');
  IF r.profile_id <> auth.uid() OR r.cu_exceptie IS NOT TRUE OR r.motiv <> 'Urgenta: oferta vine saptamana viitoare' OR r.oferta_randuri <> 0 THEN RAISE EXCEPTION 't_poarta_owner FAIL: jurnal (%)', row_to_json(r); END IF;
  v := public.fn_executie_proiect_configurare_completa(pg_temp.rd_id('p3'), 'alt motiv');
  IF (v->>'deja')::boolean IS NOT TRUE OR v->>'motiv' <> 'Urgenta: oferta vine saptamana viitoare' OR (SELECT count(*) FROM public.executie_proiect_configurare_jurnal WHERE proiect_id = pg_temp.rd_id('p3')) <> 1 THEN
    RAISE EXCEPTION 't_poarta_owner FAIL: a doua chemare (%)', v;
  END IF;
  -- lipsurile: proiectul ramane „fara_oferta” (exceptia nu inventeaza oferta)
  IF NOT EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p3') AND tip = 'fara_oferta') THEN RAISE EXCEPTION 't_poarta_owner FAIL: lipsa fara_oferta a disparut'; END IF;
  RAISE NOTICE 't_poarta_owner ok: fara motiv / motiv gol refuzate; cu motiv → configurare completa cu exceptie, motiv normalizat, jurnal; idempotent';
END $t$;
RESET ROLE;

-- ── t_poarta_cu_oferta: oferta confirmata de MP → MP-ul declara configurarea completa fara exceptie ───────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000001b', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000001b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE v jsonb; r record;
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000001b');
  v := public.fn_rest_decontat_confirma_baza(pg_temp.rd_id('p1'), 'contract_initial', NULL, NULL, NULL, 'oferta.xlsx', repeat('b9', 32),
         '[{"obiect_cod":"0001","deviz_cod":"D1","nr":"1","cod":"A100","denumire":"Conducta","um":"M","cantitate":100,"pret_unitar":100,"valoare":10000},
           {"obiect_cod":"0001","deviz_cod":"D1","nr":"2","cod":"B200","denumire":"Sapatura","um":"MC","cantitate":50,"pret_unitar":10,"valoare":500}]'::jsonb);
  v := public.fn_executie_proiect_configurare_completa(pg_temp.rd_id('p1'), 'motivul e ignorat cand exista oferta');
  IF (v->>'ok')::boolean IS NOT TRUE OR (v->>'exceptie')::boolean IS NOT FALSE OR v->>'motiv' IS NOT NULL THEN RAISE EXCEPTION 't_poarta_cu_oferta FAIL: %', v; END IF;
  SELECT configurare_completa_la, configurare_exceptie_motiv INTO r FROM public.executie_proiecte WHERE id = pg_temp.rd_id('p1');
  IF r.configurare_completa_la IS NULL OR r.configurare_exceptie_motiv IS NOT NULL THEN RAISE EXCEPTION 't_poarta_cu_oferta FAIL: coloanele (%)', row_to_json(r); END IF;
  SELECT cu_exceptie, motiv, oferta_randuri INTO r FROM public.executie_proiect_configurare_jurnal WHERE proiect_id = pg_temp.rd_id('p1');
  IF r.cu_exceptie IS NOT FALSE OR r.motiv IS NOT NULL OR r.oferta_randuri <> 2 THEN RAISE EXCEPTION 't_poarta_cu_oferta FAIL: jurnal (%)', row_to_json(r); END IF;
  IF EXISTS (SELECT 1 FROM public.v_executie_rest_decontat_lipsuri WHERE proiect_id = pg_temp.rd_id('p1') AND tip = 'fara_oferta') THEN RAISE EXCEPTION 't_poarta_cu_oferta FAIL: lipsa fara_oferta ramasa'; END IF;
  RAISE NOTICE 't_poarta_cu_oferta ok: cu oferta confirmata (2 randuri), MP-ul declara configurarea completa fara exceptie; jurnal';
END $t$;
RESET ROLE;

-- ── t_poarta_direct: coloanele poartei nu se schimba direct (nici owner-ul), jurnalul nu se modifica; alte coloane raman libere ────
SELECT set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-00000000001a', true), set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-00000000001a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  PERFORM pg_temp.rd_identitate('f0000000-0000-4000-8000-00000000001a');
  BEGIN UPDATE public.executie_proiecte SET configurare_completa_la = NULL, configurare_exceptie_motiv = NULL WHERE id = pg_temp.rd_id('p3'); RAISE EXCEPTION 't_poarta_direct FAIL: starea schimbata direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.executie_proiecte SET configurare_exceptie_motiv = 'alt motiv' WHERE id = pg_temp.rd_id('p3'); RAISE EXCEPTION 't_poarta_direct FAIL: motivul schimbat direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.executie_proiect_configurare_jurnal SET motiv = 'x' WHERE proiect_id = pg_temp.rd_id('p3'); RAISE EXCEPTION 't_poarta_direct FAIL: jurnalul modificat';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.executie_proiect_configurare_jurnal (proiect_id, profile_id, cu_exceptie, motiv, oferta_randuri) VALUES (pg_temp.rd_id('p3'), auth.uid(), false, NULL, 1); RAISE EXCEPTION 't_poarta_direct FAIL: jurnal scris direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- o alta coloana a proiectului ramane editabila ca inainte (garda e doar pe coloanele poartei)
  UPDATE public.executie_proiecte SET nume = 'Dry poarta P3 redenumit' WHERE id = pg_temp.rd_id('p3');
  IF (SELECT nume FROM public.executie_proiecte WHERE id = pg_temp.rd_id('p3')) <> 'Dry poarta P3 redenumit' THEN RAISE EXCEPTION 't_poarta_direct FAIL: redenumirea'; END IF;
  IF (SELECT count(*) FROM public.executie_proiect_configurare_jurnal) <> 2 THEN RAISE EXCEPTION 't_poarta_direct FAIL: jurnalul nu are 2 randuri'; END IF;
  RAISE NOTICE 't_poarta_direct ok: coloanele poartei si jurnalul nu se scriu direct (nici de owner); alte coloane ale proiectului raman libere';
END $t$;
RESET ROLE;

SELECT 'DRY_COMPLET' AS rezultat;
ROLLBACK;
