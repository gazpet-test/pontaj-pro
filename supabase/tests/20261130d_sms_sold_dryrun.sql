-- DRY 20261130d_sms_sold (r2). Runner (psql): o singura tranzactie ANULATA, izolare READ COMMITTED, peste 20261130a + 20261130b aplicate:
--   BEGIN; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.livrare_migrare', '20261130d_sms_sold:' || txid_current(), true);
--   \i supabase/migrations/20261130d_sms_sold.sql
--   \i supabase/tests/20261130d_sms_sold_dryrun.sql      (include revenirea + re-aplicarea, prin \ir)
--   ROLLBACK;
-- Identitati reale prin helperii pg_temp, cu JWT-ul fiecarui cont: own = un owner (profiles.is_owner), alt = un cont non-owner;
-- plus anon si service_role. Date: niciuna reala scrisa (doar randul sms_sold din tranzactia anulata); niciun furnizor apelat,
-- nicio cerere pg_net (jobul doar se programeaza, in tranzactia anulata). NOTICE-uri asteptate: TEST1 OK … TEST9 OK.
-- now() e acelasi in toata tranzactia: momentele de start ale citirilor sunt pg_temp.s3d_t(k) = now() - 10 min + k secunde.
CREATE FUNCTION pg_temp.s3d_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.s3d_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.s3d_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('s3d.' || p, true), ''); $h$;
CREATE FUNCTION pg_temp.s3d_t(k integer) RETURNS timestamptz LANGUAGE sql STABLE AS $h$ SELECT now() - interval '10 minutes' + k * interval '1 second'; $h$;
GRANT EXECUTE ON FUNCTION pg_temp.s3d_ca(uuid, text), pg_temp.s3d_refuza(text, text), pg_temp.s3d_g(text), pg_temp.s3d_t(integer) TO authenticated, anon, service_role;

-- ── TEST1: garda, starea initiala (nicio citire = alerta „citire veche”, nu „sub prag”), jobul ───────────────────────────────
DO $t$
DECLARE v jsonb; own uuid; alt uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130d_sms_sold:' || txid_current() THEN
    RAISE EXCEPTION 'TEST1 FAIL: garda';
  END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT id INTO alt FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 1;
  IF own IS NULL OR alt IS NULL THEN RAISE EXCEPTION 'TEST1 FAIL: identitati lipsa'; END IF;
  PERFORM set_config('s3d.own', own::text, true); PERFORM set_config('s3d.alt', alt::text, true);
  v := public.fn_sold_sms_stare();
  IF v->>'credit' IS NOT NULL OR (v->>'sub_prag')::boolean OR NOT (v->>'citire_veche')::boolean OR (v->>'eroare_dupa_citire')::boolean
     OR NOT (v->>'alerta')::boolean OR (v->>'prag')::integer <> 150 THEN
    RAISE EXCEPTION 'TEST1 FAIL: starea initiala %', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms_sold_zilnic' AND schedule = '10 5 * * *' AND active
                   AND command LIKE '%/functions/v1/sms-sold''%' AND command LIKE '%vault.decrypted_secrets%')
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms_sold_zilnic' AND command ~ '[0-9a-f]{64}') THEN
    RAISE EXCEPTION 'TEST1 FAIL: jobul (program / tinta / secretul citit din Vault, nu scris in comanda)';
  END IF;
  RAISE NOTICE 'TEST1 OK garda, stare initiala (citire_veche, fara sub_prag), jobul sms_sold_zilnic 10 5 * * * GMT, secretul doar din Vault';
END $t$;

-- ── TEST2: anon si contul non-owner nu vad soldul (nici prin vedere, nici la count), nu scriu; tabela inaccesibila direct ────
SELECT pg_temp.s3d_ca(NULL, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_citeste()', '42501') OR NOT pg_temp.s3d_refuza('SELECT count(*) FROM public.sms_sold', '42501')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(1, NULL, now())', '42501')
     OR NOT pg_temp.s3d_refuza('SELECT count(*) FROM public.v_sms_sold', '42501') THEN
    RAISE EXCEPTION 'TEST2 FAIL: anon';
  END IF;
END $t$;
SELECT pg_temp.s3d_ca(pg_temp.s3d_g('alt')::uuid, 'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_citeste()', '42501') OR NOT pg_temp.s3d_refuza('SELECT count(*) FROM public.sms_sold', '42501')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(1, NULL, now())', '42501')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_stare()', '42501')
     OR NOT pg_temp.s3d_refuza('UPDATE public.sms_sold SET credit = 1, citit_la = now()', '42501')
     OR NOT pg_temp.s3d_refuza('SELECT count(*) FROM public.v_sms_sold', '42501')
     OR NOT pg_temp.s3d_refuza('SELECT * FROM public.v_sms_sold', '42501')
     OR NOT pg_temp.s3d_refuza('SELECT id FROM public.v_sms_sold', '42501') THEN
    RAISE EXCEPTION 'TEST2 FAIL: contul non-owner';
  END IF;
  RAISE NOTICE 'TEST2 OK anon / non-owner: RPC-urile, tabela si vederea v_sms_sold (si count / id) refuzate cu 42501';
END $t$;

-- ── TEST3: owner-ul citeste (RPC + vedere), dar nu scrie; service_role scrie doar prin RPC, nu citeste prin cele de UI ──────────
SELECT pg_temp.s3d_ca(pg_temp.s3d_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF (public.fn_sold_sms_citeste()->>'prag')::integer IS DISTINCT FROM 150
     OR (SELECT count(*) FROM public.v_sms_sold WHERE prag = 150 AND alerta AND citire_veche AND credit IS NULL) <> 1
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(1, NULL, now())', '42501')
     OR NOT pg_temp.s3d_refuza('SELECT count(*) FROM public.sms_sold', '42501') THEN
    RAISE EXCEPTION 'TEST3 FAIL: owner';
  END IF;
END $t$;
SELECT pg_temp.s3d_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_citeste()', '42501') OR NOT pg_temp.s3d_refuza('SELECT count(*) FROM public.sms_sold', '42501')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_stare()', '42501') OR NOT pg_temp.s3d_refuza('SELECT count(*) FROM public.v_sms_sold', '42501') THEN
    RAISE EXCEPTION 'TEST3 FAIL: service_role citeste';
  END IF;
  IF (public.fn_sold_sms_inregistreaza(1000, NULL, pg_temp.s3d_t(1))->>'credit')::integer IS DISTINCT FROM 1000 THEN RAISE EXCEPTION 'TEST3 FAIL: service_role scrie'; END IF;
  RAISE NOTICE 'TEST3 OK owner: doar citeste (RPC + vederea); service_role: doar fn_sold_sms_inregistreaza';
END $t$;

-- ── TEST4: validarea intrarii (exact una dintre credit / eroare; limite; cod scurt; momentul de start in fereastra) ───────────
DO $t$ BEGIN
  IF NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(NULL, NULL, now())', '22023')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(5, ''smslink_7'', now())', '22023')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(-1, NULL, now())', '22023')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(10000001, NULL, now())', '22023')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(NULL, ''Password X is not approved!'', now())', '22023')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(NULL, ''' || repeat('a', 41) || ''', now())', '22023')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(NULL, '''', now())', '22023')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(5, NULL, NULL)', '22023')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(5, NULL, now() + interval ''3 minutes'')', '22023')
     OR NOT pg_temp.s3d_refuza('SELECT public.fn_sold_sms_inregistreaza(5, NULL, now() - interval ''20 minutes'')', '22023') THEN
    RAISE EXCEPTION 'TEST4 FAIL: validarea';
  END IF;
  RAISE NOTICE 'TEST4 OK intrarile invalide refuzate (22023): ambele / niciuna, limite, text liber, cod lung / gol, start lipsa / viitor / prea vechi';
END $t$;

-- ── TEST5: pragul (150): 1000 / 150 = fara alerta; 149 / 0 = sub prag ──────────────────────────────────────────────────────────
DO $t$
DECLARE v jsonb;
BEGIN
  v := public.fn_sold_sms_inregistreaza(1000, NULL, pg_temp.s3d_t(10));
  IF (v->>'sub_prag')::boolean OR (v->>'alerta')::boolean OR (v->>'citire_veche')::boolean OR NOT (v->>'scris')::boolean THEN RAISE EXCEPTION 'TEST5 FAIL: 1000 %', v; END IF;
  v := public.fn_sold_sms_inregistreaza(150, NULL, pg_temp.s3d_t(11));
  IF (v->>'sub_prag')::boolean OR (v->>'alerta')::boolean THEN RAISE EXCEPTION 'TEST5 FAIL: 150 %', v; END IF;
  v := public.fn_sold_sms_inregistreaza(149, NULL, pg_temp.s3d_t(12));
  IF NOT (v->>'sub_prag')::boolean OR NOT (v->>'alerta')::boolean THEN RAISE EXCEPTION 'TEST5 FAIL: 149 %', v; END IF;
  v := public.fn_sold_sms_inregistreaza(0, NULL, pg_temp.s3d_t(13));
  IF NOT (v->>'sub_prag')::boolean OR (v->>'credit')::integer <> 0 THEN RAISE EXCEPTION 'TEST5 FAIL: 0 %', v; END IF;
  RAISE NOTICE 'TEST5 OK pragul 150: 1000 si 150 fara alerta, 149 si 0 sub prag';
END $t$;

-- ── TEST6: eroarea nu sterge citirea buna; citirea buna urmatoare stinge „eroare dupa citire” ───────────────────────────────────
DO $t$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_sold_sms_inregistreaza(500, NULL, pg_temp.s3d_t(20));
  v := public.fn_sold_sms_inregistreaza(NULL, 'smslink_7', pg_temp.s3d_t(21));
  IF (v->>'credit')::integer IS DISTINCT FROM 500 OR v->>'eroare' IS DISTINCT FROM 'smslink_7' OR NOT (v->>'eroare_dupa_citire')::boolean
     OR NOT (v->>'alerta')::boolean OR (v->>'sub_prag')::boolean THEN
    RAISE EXCEPTION 'TEST6 FAIL: eroarea dupa citire %', v;
  END IF;
  v := public.fn_sold_sms_inregistreaza(400, NULL, pg_temp.s3d_t(22));
  IF (v->>'eroare_dupa_citire')::boolean OR (v->>'alerta')::boolean OR v->>'eroare' IS DISTINCT FROM 'smslink_7' THEN
    RAISE EXCEPTION 'TEST6 FAIL: citirea buna dupa eroare %', v;
  END IF;
  RAISE NOTICE 'TEST6 OK eroarea pastreaza citirea buna (alerta), citirea buna noua o stinge; doar codul scurt e pastrat';
END $t$;

-- ── TEST9 (r2, P2-04): CAS pe momentul de start — o citire inceputa mai devreme, terminata mai tarziu, nu suprascrie ─────────────
DO $t$
DECLARE v jsonb;
BEGIN
  -- B incepe la t40 si se termina primul (80 SMS); A, inceputa la t35, raspunde dupa (200 SMS): A NU se scrie
  v := public.fn_sold_sms_inregistreaza(80, NULL, pg_temp.s3d_t(40));
  IF NOT (v->>'scris')::boolean OR (v->>'credit')::integer <> 80 THEN RAISE EXCEPTION 'TEST9 FAIL: B %', v; END IF;
  v := public.fn_sold_sms_inregistreaza(200, NULL, pg_temp.s3d_t(35));
  IF (v->>'scris')::boolean OR (v->>'credit')::integer <> 80 OR NOT (v->>'sub_prag')::boolean THEN RAISE EXCEPTION 'TEST9 FAIL: A veche a suprascris %', v; END IF;
  -- acelasi moment (dubla livrare) nu rescrie
  v := public.fn_sold_sms_inregistreaza(300, NULL, pg_temp.s3d_t(40));
  IF (v->>'scris')::boolean OR (v->>'credit')::integer <> 80 THEN RAISE EXCEPTION 'TEST9 FAIL: acelasi moment %', v; END IF;
  -- o eroare inceputa INAINTEA citirii bune existente nu devine „eroare dupa citire”; una mai veche decat eroarea existenta nu o inlocuieste
  v := public.fn_sold_sms_inregistreaza(NULL, 'retea_timeout', pg_temp.s3d_t(38));
  IF NOT (v->>'scris')::boolean OR (v->>'eroare_dupa_citire')::boolean THEN RAISE EXCEPTION 'TEST9 FAIL: eroare veche fata de citire %', v; END IF;
  v := public.fn_sold_sms_inregistreaza(NULL, 'http_502', pg_temp.s3d_t(37));
  IF (v->>'scris')::boolean OR v->>'eroare' IS DISTINCT FROM 'retea_timeout' THEN RAISE EXCEPTION 'TEST9 FAIL: eroare mai veche a inlocuit %', v; END IF;
  RAISE NOTICE 'TEST9 OK CAS: citirea inceputa mai devreme (raspuns intarziat) si dublura nu suprascriu; ordinea erorilor dupa momentul de start';
END $t$;
SELECT pg_temp.s3d_ca(NULL, 'postgres');

-- ── TEST7: citirea veche (peste 36 h) = alerta, si pentru owner prin RPC-ul UI si prin vedere ──────────────────────────────────
UPDATE public.sms_sold SET credit = 400, citit_la = now() - interval '37 hours', eroare_la = now() - interval '38 hours' WHERE id;
SELECT pg_temp.s3d_ca(pg_temp.s3d_g('own')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb;
BEGIN
  v := public.fn_sold_sms_citeste();
  IF NOT (v->>'citire_veche')::boolean OR NOT (v->>'alerta')::boolean OR (v->>'sub_prag')::boolean OR (v->>'credit')::integer <> 400
     OR (SELECT count(*) FROM public.v_sms_sold WHERE credit = 400 AND citire_veche AND alerta AND NOT sub_prag) <> 1 THEN
    RAISE EXCEPTION 'TEST7 FAIL: citirea veche %', v;
  END IF;
  RAISE NOTICE 'TEST7 OK citirea mai veche de 36 h = alerta (vazuta de owner prin fn_sold_sms_citeste si v_sms_sold)';
END $t$;
SELECT pg_temp.s3d_ca(NULL, 'postgres');

-- ── TEST8: revenirea scoate tot (job, vedere, functii, tabela), apoi migrarea se re-aplica in aceeasi tranzactie ──────────────
SELECT set_config('gazpet.revenire_20261130d', 'SMS_SOLD_SCOS:' || txid_current(), true) IS NOT NULL AS garda_revenire;
\ir ../revenire/20261130d_sms_sold_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.sms_sold') IS NOT NULL OR to_regclass('public.v_sms_sold') IS NOT NULL OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sms_sold_zilnic')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'fn!_sold!_sms!_%' ESCAPE '!') THEN
    RAISE EXCEPTION 'TEST8 FAIL: revenirea a lasat obiecte';
  END IF;
  IF to_regclass('public.sms_setari') IS NULL OR to_regprocedure('public.fn_sms_e_owner()') IS NULL OR to_regprocedure('public.fn_sms_nivel()') IS NULL THEN
    RAISE EXCEPTION 'TEST8 FAIL: revenirea a atins 20261130a / 20261130b';
  END IF;
END $t$;
\ir ../migrations/20261130d_sms_sold.sql
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.sms_sold) <> 1 OR (SELECT count(*) FROM cron.job WHERE jobname = 'sms_sold_zilnic') <> 1 THEN
    RAISE EXCEPTION 'TEST8 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'TEST8 OK revenire (amprenta exacta; job + vedere + 4 functii + tabela scoase, 30a/30b neatinse) -> re-aplicare cu postconditiile trecute';
END $t$;
