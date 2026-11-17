-- Revenire 20261212a_redari_fan_awb. NEAPLICAT (ca și migrarea). Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelele red_fan_awb, red_fan_loturi, red_fan_setari (cu politicile, indecșii, trigger-ul gărzii marcajului
-- și cheile lor) și cele 17 funcții fn_red_fan_* (runda 3: + fn_red_fan_tiraj). Tabelele și funcțiile existente NU se ating.
-- REFUZĂ (L14) dacă există ORICE rând FAN (un AWB generat e evidență de cost și dovadă de expediere: se PĂSTREAZĂ), un lot marcat (test / real)
-- sau setări schimbate față de cele implicite. Cu date: NU se rulează; se oprește doar generarea (TRANSPORT_REAL_ACTIV = false + funcția edge
-- ștearsă), tabelele rămân.
-- Starea verificată înainte (doar catalog) și din nou SUB LOCK: tabelele, numele + semnăturile EXACTE ale celor 17 funcții (nicio altă
-- fn_red_fan_*), trigger-ul gărzii, nicio dependență străină (vederi / chei străine / politici pe alte tabele) spre obiectele migrării.
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon (forma revenirilor: FĂRĂ amprentă globală, plafonul 2000 al revenirilor —
-- docs/LIVRARE_L15_V2.md §9, „Fișierele de revenire”, varianta A):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261212120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul (gazpet.livrare_migrare = '20261212a_redari_fan_awb_ROLLBACK:<txid>') și plafonul; fără ele fișierul refuză.
-- Ordinea (L06, L14): 1. gărzile + starea (doar catalog); 2. lock-urile, NOWAIT, cu bugetul de 1 s de la BEGIN verificat înaintea fiecărei
--   încercări și DUPĂ obținere (un lock luat după prima secundă = refuz, nimic schimbat), în ordinea căilor aplicației: red_proiecte,
--   red_loturi_plicuire, red_plicuri (SHARE ROW EXCLUSIVE: cheile străine ale tabelelor FAN se scot odată cu ele), red_fan_awb, red_fan_loturi,
--   red_fan_setari (ACCESS EXCLUSIVE), ÎNAINTEA verificării „fără date”; 3. sub lock: starea din nou, „fără date”, DROP-urile, postcondiția.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
-- Probe: scripts/pglite/test_redari_fan_awb_local.mjs (aplicare → revenire → re-aplicare; refuz cu AWB / lot marcat / setări schimbate /
--   funcție în plus / fără marcaj / plafon greșit).
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_rau text;
  v_functii constant text[] := ARRAY['fn_red_fan_e_owner()', 'fn_red_fan_suma(numeric)', 'fn_red_fan_camp(text)', 'fn_red_fan_surse(uuid)',
    'fn_red_fan_loturi_garda()', 'fn_red_fan_setari_seteaza(integer)', 'fn_red_fan_lot_marcheaza(uuid,boolean)', 'fn_red_fan_propune(uuid,text,numeric)',
    'fn_red_fan_aproba(uuid,uuid[],text[])', 'fn_red_fan_claim_lot(uuid,uuid[],text[],text[])', 'fn_red_fan_rezultate(uuid,jsonb)',
    'fn_red_fan_reconciliaza(uuid,text,numeric,numeric,text)', 'fn_red_fan_ridicat(uuid,date)', 'fn_red_fan_urmarire(uuid,jsonb)',
    'fn_red_fan_confirmari(uuid,jsonb)', 'fn_red_fan_anulat(uuid,text,text)', 'fn_red_fan_tiraj(uuid,text,text)'];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261212a_redari_fan_awb_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261212a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261212a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261212a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261212a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261212a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        IF clock_timestamp() >= now() + interval '1 second' THEN
          RAISE EXCEPTION '20261212a revenire: BUGET_LOCK: % incercari, % ms de la BEGIN (bugetul lock-urilor e 1 s de la BEGIN); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.red_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_loturi_plicuire IN SHARE ROW EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_plicuri IN SHARE ROW EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_awb IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_loturi IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.red_fan_setari IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261212a revenire: BUGET_LOCK: lock-urile obtinute abia la % ms de la BEGIN (% incercari; bugetul e 1 s de la BEGIN); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
    END IF;
    IF to_regclass('public.red_fan_awb') IS NULL OR to_regclass('public.red_fan_loturi') IS NULL OR to_regclass('public.red_fan_setari') IS NULL THEN
      RAISE EXCEPTION '20261212a revenire: starea nu e cea din 20261212a (pasul %, tabele)', v_pas;
    END IF;
    -- exact cele 17 funcții, cu semnăturile lor; nicio altă fn_red_fan_*
    SELECT string_agg(x.f, ', ') INTO v_rau FROM (
      SELECT f FROM unnest(v_functii) f WHERE to_regprocedure('public.' || f) IS NULL
      UNION ALL
      SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%' AND NOT (p.oid = ANY (SELECT to_regprocedure('public.' || f)::oid FROM unnest(v_functii) f))) x;
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20261212a revenire: starea nu e cea din 20261212a (pasul %, functii: %)', v_pas, v_rau;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_loturi'::regclass AND tg.tgname = 'trg_red_fan_loturi_garda'
                     AND tg.tgfoid = 'public.fn_red_fan_loturi_garda()'::regprocedure) THEN
      RAISE EXCEPTION '20261212a revenire: starea nu e cea din 20261212a (pasul %, trigger)', v_pas;
    END IF;
    -- dependențe străine spre obiectele migrării (o vedere / cheie străină / politică / funcție a altei migrări) = refuz: DROP-ul le-ar rupe
    IF EXISTS (SELECT 1 FROM pg_depend d
                WHERE d.refclassid = 'pg_class'::regclass
                  AND d.refobjid IN ('public.red_fan_awb'::regclass, 'public.red_fan_loturi'::regclass, 'public.red_fan_setari'::regclass)
                  AND d.deptype = 'n'
                  AND NOT (d.classid = 'pg_class'::regclass AND d.objid IN ('public.red_fan_awb'::regclass, 'public.red_fan_loturi'::regclass, 'public.red_fan_setari'::regclass))
                  AND NOT (d.classid = 'pg_constraint'::regclass AND d.objid IN (SELECT oid FROM pg_constraint
                           WHERE conrelid IN ('public.red_fan_awb'::regclass, 'public.red_fan_loturi'::regclass, 'public.red_fan_setari'::regclass)))
                  AND NOT (d.classid = 'pg_policy'::regclass AND d.objid IN (SELECT oid FROM pg_policy
                           WHERE polrelid IN ('public.red_fan_awb'::regclass, 'public.red_fan_loturi'::regclass, 'public.red_fan_setari'::regclass)))
                  AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid IN (SELECT oid FROM pg_trigger WHERE tgrelid = 'public.red_fan_loturi'::regclass)))
       OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f'
                   AND c.confrelid IN ('public.red_fan_awb'::regclass, 'public.red_fan_loturi'::regclass, 'public.red_fan_setari'::regclass)) THEN
      RAISE EXCEPTION '20261212a revenire: alte obiecte depind de obiectele migrarii (vederi / chei straine / politici)';
    END IF;
  END LOOP;
  -- sub lock: fără date (AWB-urile sunt evidență de cost și dovadă de expediere: se păstrează)
  IF EXISTS (SELECT 1 FROM public.red_fan_awb) THEN
    RAISE EXCEPTION '20261212a revenire: red_fan_awb are randuri - refuz (opreste doar generarea, pastreaza evidenta)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_loturi) THEN
    RAISE EXCEPTION '20261212a revenire: exista loturi marcate pentru FAN - refuz';
  END IF;
  IF (SELECT count(*) FROM public.red_fan_setari) <> 1
     OR EXISTS (SELECT 1 FROM public.red_fan_setari WHERE limita_lot <> 20 OR actualizat_de IS NOT NULL OR actualizat_la IS NOT NULL) THEN
    RAISE EXCEPTION '20261212a revenire: setarile FAN au fost schimbate - refuz';
  END IF;
  DROP TABLE public.red_fan_awb;
  DROP TABLE public.red_fan_loturi;
  DROP TABLE public.red_fan_setari;
  DROP FUNCTION public.fn_red_fan_tiraj(uuid, text, text);
  DROP FUNCTION public.fn_red_fan_anulat(uuid, text, text);
  DROP FUNCTION public.fn_red_fan_confirmari(uuid, jsonb);
  DROP FUNCTION public.fn_red_fan_urmarire(uuid, jsonb);
  DROP FUNCTION public.fn_red_fan_ridicat(uuid, date);
  DROP FUNCTION public.fn_red_fan_reconciliaza(uuid, text, numeric, numeric, text);
  DROP FUNCTION public.fn_red_fan_rezultate(uuid, jsonb);
  DROP FUNCTION public.fn_red_fan_claim_lot(uuid, uuid[], text[], text[]);
  DROP FUNCTION public.fn_red_fan_aproba(uuid, uuid[], text[]);
  DROP FUNCTION public.fn_red_fan_propune(uuid, text, numeric);
  DROP FUNCTION public.fn_red_fan_lot_marcheaza(uuid, boolean);
  DROP FUNCTION public.fn_red_fan_setari_seteaza(integer);
  DROP FUNCTION public.fn_red_fan_loturi_garda();
  DROP FUNCTION public.fn_red_fan_surse(uuid);
  DROP FUNCTION public.fn_red_fan_camp(text);
  DROP FUNCTION public.fn_red_fan_suma(numeric);
  DROP FUNCTION public.fn_red_fan_e_owner();
  IF to_regclass('public.red_fan_awb') IS NOT NULL OR to_regclass('public.red_fan_loturi') IS NOT NULL OR to_regclass('public.red_fan_setari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%') THEN
    RAISE EXCEPTION '20261212a revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261212a_redari_fan_awb_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261212a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261212a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
