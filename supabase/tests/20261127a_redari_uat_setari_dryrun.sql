-- DRY 20261127a_redari_uat_setari — rulat de chat ÎN ACEEAȘI TRANZACȚIE cu migrarea, după ea, apoi ROLLBACK (ca la 20261126a):
--   BEGIN;  SELECT set_config('gazpet.livrare_migrare', '20261127a_redari_uat_setari:' || txid_current(), true);
--   \i supabase/migrations/20261127a_redari_uat_setari.sql     \i supabase/tests/20261127a_redari_uat_setari_dryrun.sql     ROLLBACK;
-- TEST0 refuză să ruleze fără marcajul tranzacției curente și dacă versiunea 20261127120000 e deja în istoricul migrărilor (Jakarinos f2 r1 P3). Identități REALE (owner-ul, un editor și un viewer din user_module_access 'redari'),
-- date fictive (proiect TEST-27A, UAT „Test UAT” / TST), dispar la ROLLBACK. Fiecare bloc: RAISE NOTICE 'TESTn OK' sau RAISE EXCEPTION 'TESTn FAIL'.

CREATE FUNCTION pg_temp.r27_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- întoarce true dacă instrucțiunea pică exact cu SQLSTATE-ul așteptat (aserțiunea e în afara blocului EXCEPTION)
CREATE FUNCTION pg_temp.r27_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.r27_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r27.' || p, true), ''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r27_ca(uuid, text), pg_temp.r27_refuza(text, text), pg_temp.r27_g(text) TO authenticated, anon;

-- ── TEST0: garda tranzacției de probă + identitățile ──────────────────────────────────────────────────────────────────────
DO $t$
DECLARE v_owner uuid; v_editor uuid; v_viewer uuid;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261127a_redari_uat_setari:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: marcajul migrarii nu e al tranzactiei curente — DRY-ul ruleaza doar in tranzactia de proba';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261127120000') THEN
    RAISE EXCEPTION 'TEST0 FAIL: migrarea 20261127a e deja comisa (schema_migrations) — DRY-ul nu se ruleaza pe ea';
  END IF;
  SELECT id INTO v_owner FROM public.profiles WHERE is_owner AND email = 'razvan.trusu@gazpet.ro';
  SELECT u.profile_id INTO v_editor FROM public.user_module_access u JOIN public.profiles p ON p.id = u.profile_id
   WHERE u.module = 'redari' AND u.access_level = 'editor' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  SELECT u.profile_id INTO v_viewer FROM public.user_module_access u JOIN public.profiles p ON p.id = u.profile_id
   WHERE u.module = 'redari' AND u.access_level = 'viewer' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  IF v_owner IS NULL OR v_editor IS NULL OR v_viewer IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati lipsa (owner/editor/viewer)'; END IF;
  PERFORM set_config('r27.owner', v_owner::text, true);
  PERFORM set_config('r27.editor', v_editor::text, true);
  PERFORM set_config('r27.viewer', v_viewer::text, true);
  RAISE NOTICE 'TEST0 OK identitati';
END $t$;

-- ── TEST1: admin (owner) creează proiect + UAT și scrie coloanele noi ────────────────────────────────────────────────────
SELECT pg_temp.r27_ca(pg_temp.r27_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE v_pr uuid; v_uat uuid; v_n int;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'TEST1 FAIL: owner-ul nu e admin'; END IF;
  INSERT INTO public.red_proiecte (cod, denumire, apm_nume) VALUES ('TEST-27A', 'Proiect de proba 27a', 'APM TEST') RETURNING id INTO v_pr;
  INSERT INTO public.red_uat (proiect_id, nume, uat3, judet) VALUES (v_pr, 'Test UAT', 'TST', 'Test') RETURNING id INTO v_uat;
  UPDATE public.red_uat SET sesiune_zi1 = DATE '2026-12-10', sesiune_zi2 = DATE '2026-12-11', sesiune_zi3 = DATE '2026-12-12',
         termen_confirmare = DATE '2026-11-28', afisare_ora = '09:30', afisare_reprezentant_gazpet = 'Operator test',
         reprezentant_uat_telefon = '0000 000 000', afisare_data_start = DATE '2026-11-20', afisare_data_end = DATE '2026-12-12'
   WHERE id = v_uat;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST1 FAIL: update admin pe red_uat = % randuri', v_n; END IF;
  UPDATE public.red_proiecte SET apm_nume = 'APM TEST 2' WHERE id = v_pr;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST1 FAIL: update admin pe red_proiecte = % randuri', v_n; END IF;
  PERFORM set_config('r27.uat', v_uat::text, true);
  PERFORM set_config('r27.pr', v_pr::text, true);
  RAISE NOTICE 'TEST1 OK admin scrie UAT + proiect';
END $t$;

-- ── TEST2: constrângerile pe zile / termen / afișare / formate ───────────────────────────────────────────────────────────
DO $t$
DECLARE u text := pg_temp.r27_g('uat');
BEGIN
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET sesiune_zi1 = NULL WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST2 FAIL: zi2/zi3 fara zi1 acceptat';
  END IF;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET sesiune_zi2 = DATE ''2026-12-10'' WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST2 FAIL: zi2 = zi1 acceptat';
  END IF;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET sesiune_zi3 = DATE ''2026-12-01'' WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST2 FAIL: zi3 < zi2 acceptat';
  END IF;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET termen_confirmare = DATE ''2026-12-10'' WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST2 FAIL: termen = zi1 acceptat';
  END IF;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET afisare_data_end = DATE ''2026-11-01'' WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST2 FAIL: afisare_end < afisare_start acceptat';
  END IF;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET afisare_ora = ''25:00'' WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST2 FAIL: ora 25:00 acceptata';
  END IF;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET adresa_nr = ''AU-12'' WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST2 FAIL: adresa_nr AU-12 acceptat';
  END IF;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET reprezentant_uat_telefon = repeat(''1'', 41) WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST2 FAIL: telefon de 41 caractere acceptat';
  END IF;
  -- zilele cu coadă NULL sunt permise (doar zi1)
  UPDATE public.red_uat SET sesiune_zi3 = NULL WHERE id = u::uuid;
  UPDATE public.red_uat SET sesiune_zi2 = NULL WHERE id = u::uuid;
  UPDATE public.red_uat SET sesiune_zi2 = DATE '2026-12-11', sesiune_zi3 = DATE '2026-12-12' WHERE id = u::uuid;
  RAISE NOTICE 'TEST2 OK constrangeri';
END $t$;

-- ── TEST3: numerotarea AU (admin), unicitatea adresa_nr ──────────────────────────────────────────────────────────────────
DO $t$
DECLARE a text; b text; v_uat2 uuid;
BEGIN
  a := public.fn_red_numar_document('AU', NULL, NULL);
  b := public.fn_red_numar_document('AU', NULL, NULL);
  IF a IS DISTINCT FROM 'AU-0001' OR b IS DISTINCT FROM 'AU-0002' THEN RAISE EXCEPTION 'TEST3 FAIL: AU = % / %', a, b; END IF;
  UPDATE public.red_uat SET adresa_nr = a, adresa_data = DATE '2026-11-15' WHERE id = pg_temp.r27_g('uat')::uuid;
  INSERT INTO public.red_uat (proiect_id, nume, uat3) VALUES (pg_temp.r27_g('pr')::uuid, 'Test UAT 2', 'TSU') RETURNING id INTO v_uat2;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET adresa_nr = %L WHERE id = %L', a, v_uat2), '23505') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST3 FAIL: adresa_nr duplicat acceptat';
  END IF;
  -- ramurile vechi neschimbate
  IF public.fn_red_numar_document('C', NULL, NULL) IS DISTINCT FROM 'C-0001' THEN RAISE EXCEPTION 'TEST3 FAIL: ramura C'; END IF;
  IF public.fn_red_numar_document('PVA', 'TST', NULL) IS DISTINCT FROM 'PVA-TST-0001' THEN RAISE EXCEPTION 'TEST3 FAIL: ramura PVA'; END IF;
  IF pg_temp.r27_refuza($s$SELECT public.fn_red_numar_document('XX', NULL, NULL)$s$, 'P0001') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST3 FAIL: tip necunoscut acceptat';
  END IF;
  RAISE NOTICE 'TEST3 OK numerotare AU + unicitate';
END $t$;

-- ── TEST4: editorul NU scrie UAT / proiect (RLS), dar numerotează AU ─────────────────────────────────────────────────────
SELECT pg_temp.r27_ca(pg_temp.r27_g('editor')::uuid, 'authenticated');
DO $t$
DECLARE v_n int; a text;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'editor' THEN RAISE EXCEPTION 'TEST4 FAIL: nivel editor = %', public.fn_red_nivel(); END IF;
  UPDATE public.red_uat SET termen_confirmare = DATE '2026-11-27' WHERE id = pg_temp.r27_g('uat')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'TEST4 FAIL: editorul a modificat red_uat (% randuri)', v_n; END IF;
  UPDATE public.red_proiecte SET apm_nume = 'X' WHERE id = pg_temp.r27_g('pr')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'TEST4 FAIL: editorul a modificat red_proiecte (% randuri)', v_n; END IF;
  IF pg_temp.r27_refuza(format('INSERT INTO public.red_uat (proiect_id, nume, uat3) VALUES (%L, ''X'', ''XXX'')', pg_temp.r27_g('pr')), '42501') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST4 FAIL: editorul a inserat UAT';
  END IF;
  a := public.fn_red_numar_document('AU', NULL, NULL);
  IF a IS DISTINCT FROM 'AU-0003' THEN RAISE EXCEPTION 'TEST4 FAIL: AU editor = %', a; END IF;
  IF (SELECT termen_confirmare FROM public.red_uat WHERE id = pg_temp.r27_g('uat')::uuid) IS DISTINCT FROM DATE '2026-11-28' THEN
    RAISE EXCEPTION 'TEST4 FAIL: editorul vede alt termen (RLS select?)';
  END IF;
  RAISE NOTICE 'TEST4 OK editor';
END $t$;

-- ── TEST5: viewer-ul citește, nu scrie, nu numerotează; anon nu are acces ────────────────────────────────────────────────
SELECT pg_temp.r27_ca(pg_temp.r27_g('viewer')::uuid, 'authenticated');
DO $t$
DECLARE v_n int;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'viewer' THEN RAISE EXCEPTION 'TEST5 FAIL: nivel viewer = %', public.fn_red_nivel(); END IF;
  IF (SELECT count(*) FROM public.red_uat WHERE id = pg_temp.r27_g('uat')::uuid) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'TEST5 FAIL: viewer-ul nu vede UAT-ul'; END IF;
  UPDATE public.red_uat SET afisare_ora = '10:00' WHERE id = pg_temp.r27_g('uat')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'TEST5 FAIL: viewer-ul a modificat red_uat'; END IF;
  IF pg_temp.r27_refuza($s$SELECT public.fn_red_numar_document('AU', NULL, NULL)$s$, '42501') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST5 FAIL: viewer-ul a numerotat AU';
  END IF;
  RAISE NOTICE 'TEST5 OK viewer';
END $t$;
SELECT pg_temp.r27_ca(NULL, 'anon');
DO $t$
BEGIN
  IF pg_temp.r27_refuza($s$SELECT public.fn_red_numar_document('AU', NULL, NULL)$s$, '42501') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST6 FAIL: anon a apelat fn_red_numar_document';
  END IF;
  IF pg_temp.r27_refuza($s$SELECT adresa_nr FROM public.red_uat$s$, '42501') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST6 FAIL: anon citeste red_uat';
  END IF;
  RAISE NOTICE 'TEST6 OK anon';
END $t$;
SELECT pg_temp.r27_ca(NULL, 'postgres');

-- ── TEST8 (Copilot f2 r1): trigger-ele din 20261126a cu schema nouă — uat3 blocat după parcele (inclusiv șterse logic),
--    expirarea tokenului recalculată la schimbarea zilelor ─────────────────────────────────────────────────────────────
SELECT pg_temp.r27_ca(pg_temp.r27_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE v_par uuid; v_det uuid; v_exp1 timestamptz; v_exp2 timestamptz; u uuid := pg_temp.r27_g('uat')::uuid;
BEGIN
  INSERT INTO public.red_parcele (proiect_id, uat_id, id_parcela, tronson) VALUES (pg_temp.r27_g('pr')::uuid, u, 'T1-TST-0001', 1) RETURNING id INTO v_par;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET uat3 = ''TSX'' WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST8 FAIL: uat3 schimbat cu parcela activa';
  END IF;
  UPDATE public.red_parcele SET sters_la = now(), sters_motiv = 'test' WHERE id = v_par;
  IF pg_temp.r27_refuza(format('UPDATE public.red_uat SET uat3 = ''TSX'' WHERE id = %L', u), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST8 FAIL: uat3 schimbat cu parcela stearsa logic (UI-ul presupune ca trigger-ul le numara pe toate)';
  END IF;
  UPDATE public.red_parcele SET sters_la = NULL, sters_motiv = NULL WHERE id = v_par;
  INSERT INTO public.red_detinatori (parcela_id, nume, nume_normalizat, calitate) VALUES (v_par, 'POPESCU TEST', 'POPESCU TEST', 'proprietar') RETURNING id INTO v_det;
  RESET ROLE;   -- tokenul se citește ca postgres (SELECT doar admin/editor; aici verificăm valoarea, nu dreptul)
  SELECT token_expira_la INTO v_exp1 FROM public.red_detinatori_token WHERE detinator_id = v_det;
  IF v_exp1 IS DISTINCT FROM ((DATE '2026-12-12' + 30) + time '23:59:59') AT TIME ZONE 'Europe/Bucharest' THEN
    RAISE EXCEPTION 'TEST8 FAIL: expirarea initiala = %', v_exp1;
  END IF;
  PERFORM pg_temp.r27_ca(pg_temp.r27_g('owner')::uuid, 'authenticated');
  UPDATE public.red_uat SET sesiune_zi3 = DATE '2026-12-15' WHERE id = u;
  RESET ROLE;
  SELECT token_expira_la INTO v_exp2 FROM public.red_detinatori_token WHERE detinator_id = v_det;
  IF v_exp2 IS DISTINCT FROM ((DATE '2026-12-15' + 30) + time '23:59:59') AT TIME ZONE 'Europe/Bucharest' THEN
    RAISE EXCEPTION 'TEST8 FAIL: expirarea dupa schimbarea zilei 3 = %', v_exp2;
  END IF;
  RAISE NOTICE 'TEST8 OK uat3 blocat + expirare token';
END $t$;
SELECT pg_temp.r27_ca(NULL, 'postgres');

-- ── TEST9 (Copilot f2 r2 P2): blocarea optimistă — versiunea crește la fiecare UPDATE, valoarea trimisă e ignorată,
--    un UPDATE cu versiunea veche nu atinge nimic ─────────────────────────────────────────────────────────────────────
SELECT pg_temp.r27_ca(pg_temp.r27_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE v0 int; v1 int; v_n int; p uuid := pg_temp.r27_g('pr')::uuid;
BEGIN
  SELECT versiune INTO v0 FROM public.red_proiecte WHERE id = p;
  UPDATE public.red_proiecte SET contact_nume = 'A', versiune = 999 WHERE id = p AND versiune = v0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT versiune INTO v1 FROM public.red_proiecte WHERE id = p;
  IF v_n <> 1 OR v1 IS DISTINCT FROM v0 + 1 THEN RAISE EXCEPTION 'TEST9 FAIL: versiune % -> % (randuri %)', v0, v1, v_n; END IF;
  UPDATE public.red_proiecte SET contact_nume = 'B' WHERE id = p AND versiune = v0;   -- al doilea admin, cu versiunea veche
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 OR (SELECT contact_nume FROM public.red_proiecte WHERE id = p) IS DISTINCT FROM 'A' THEN
    RAISE EXCEPTION 'TEST9 FAIL: UPDATE-ul cu versiunea veche a scris peste';
  END IF;
  SELECT versiune INTO v0 FROM public.red_uat WHERE id = pg_temp.r27_g('uat')::uuid;
  UPDATE public.red_uat SET afisare_ora = '11:00' WHERE id = pg_temp.r27_g('uat')::uuid;
  IF (SELECT versiune FROM public.red_uat WHERE id = pg_temp.r27_g('uat')::uuid) IS DISTINCT FROM v0 + 1 THEN RAISE EXCEPTION 'TEST9 FAIL: versiune red_uat'; END IF;
  IF pg_temp.r27_refuza($s$SELECT public.fn_red_versiune_creste()$s$, '42501') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST9 FAIL: authenticated poate apela fn_red_versiune_creste';
  END IF;
  RAISE NOTICE 'TEST9 OK versiune';
END $t$;
SELECT pg_temp.r27_ca(NULL, 'postgres');

-- ── TEST7: jurnalul a prins modificările pe UAT (append-only, fără date de deținători) ───────────────────────────────────
DO $t$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_uat' AND inregistrare_id = pg_temp.r27_g('uat')::uuid AND actiune = 'update'
                   AND date_noi ? 'termen_confirmare') THEN
    RAISE EXCEPTION 'TEST7 FAIL: jurnalul nu are update-ul pe red_uat cu coloanele noi';
  END IF;
  RAISE NOTICE 'TEST7 OK jurnal';
END $t$;
