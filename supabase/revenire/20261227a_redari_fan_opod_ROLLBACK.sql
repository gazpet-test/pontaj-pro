-- Revenire 20261227a_redari_fan_opod. NEAPLICAT (ca și migrarea). Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate ce a creat migrarea: funcția fn_red_fan_lot_opod(uuid, boolean), coloana red_fan_loturi.opod (cu DEFAULT-ul ei) și readuce
--   fn_red_fan_loturi_garda() la corpul EXACT din 20261212a (același trigger trg_red_fan_loturi_garda, neatins). Tabelele, celelalte funcții și
--   datele existente NU se ating. 20261212a rămâne aplicată; revenirea ei (19 funcții) e posibilă doar DUPĂ aceasta.
-- REFUZĂ (L14, textual) dacă există ISTORIC NOU: vreun lot cu opod = true (alegerea owner-ului s-ar pierde; se renunță din ecran mai întâi, dacă
--   lotul nu e aprobat) sau evenimente 'opod_schimbat' în red_jurnal (jurnalul e append-only: nu se șterge; cu istoric, revenirea DDL nu se face).
-- Starea EXACTĂ a migrării e verificată înainte (coloana, funcția nouă cu proprietățile ei, garda cu amprenta 20261227a, exact 20 funcții
--   fn_red_fan_*, trigger-ul în forma exactă) și din nou SUB LOCK; altă stare = refuz, nimic schimbat.
-- LIVRAREA = prin runner, DOAR cu plafon (forma revenirilor: FĂRĂ amprentă globală, plafonul 2000 — docs/LIVRARE_L15_V2.md §9, varianta A):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261227a_redari_fan_opod_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261227120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Ordinea (L06, L14): 1. gărzile + starea (doar catalog); 2. lock-ul ACCESS EXCLUSIVE pe red_fan_loturi (DROP COLUMN), NOWAIT, bugetul de 1 s de
--   la BEGIN verificat înaintea fiecărei încercări și DUPĂ obținere; 3. sub lock: starea din nou, „fără istoric nou”, DROP-urile, corpul vechi al
--   gărzii, postcondiția. Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
-- Probe: scripts/pglite/test_redari_fan_opod_local.mjs (aplicare → revenire → re-aplicare pe bază nefolosită; refuz cu opod = true / istoric în
--   jurnal / fără migrare / funcție în plus / fără marcaj / plafon greșit).
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_rau text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261227a_redari_fan_opod_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261227a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261227a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261227a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261227a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261227a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        IF clock_timestamp() >= now() + interval '1 second' THEN
          RAISE EXCEPTION '20261227a revenire: BUGET_LOCK: % incercari, % ms de la BEGIN (bugetul lock-urilor e 1 s de la BEGIN); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.red_fan_loturi IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261227a revenire: BUGET_LOCK: lock-ul obtinut abia la % ms de la BEGIN (% incercari; bugetul e 1 s de la BEGIN); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
    END IF;
    -- starea EXACTĂ a lui 20261227a: coloana, funcția nouă (proprietăți + EXECUTE), garda cu corpul 20261227a, exact 20 funcții, trigger-ul neatins
    IF to_regclass('public.red_fan_loturi') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_loturi' AND column_name = 'opod'
                        AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false') THEN
      RAISE EXCEPTION '20261227a revenire: starea nu e cea din 20261227a (pasul %, coloana opod)', v_pas;
    END IF;
    SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
      FROM (VALUES
        ('public.fn_red_fan_lot_opod(uuid, boolean)', 'b591ff764adede2b335b96e89e41aaca', 'plpgsql', true, true, 'boolean'),
        -- >>> GARDA 20261227a (corpul nou)
        ('public.fn_red_fan_loturi_garda()', '5f167c38850bbfc30cb29c0a0fd734ad', 'plpgsql', false, false, 'trigger')
        -- <<< GARDA 20261227a
      ) a(semnatura, amprenta, limbaj, definer, exec_auth, intoarce)
      LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
     WHERE p.oid IS NULL
        OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
        OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
        OR p.prosecdef IS DISTINCT FROM a.definer
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
        OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
        OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
        OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_auth
        OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0);
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20261227a revenire: starea nu e cea din 20261227a (pasul %, functii: %)', v_pas, v_rau;
    END IF;
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%') <> 20 THEN
      RAISE EXCEPTION '20261227a revenire: starea nu e cea din 20261227a (pasul %, numarul functiilor fn_red_fan_* difera de 20)', v_pas;
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_loturi'::regclass AND NOT tgisinternal) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_loturi'::regclass AND tg.tgname = 'trg_red_fan_loturi_garda'
                        AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = to_regprocedure('public.fn_red_fan_loturi_garda()')
                        AND tg.tgtype = (1 | 2 | 8 | 16)) THEN
      RAISE EXCEPTION '20261227a revenire: starea nu e cea din 20261227a (pasul %, trigger)', v_pas;
    END IF;
    -- dependențe străine spre coloana / funcția migrării (o vedere, un index, o politică, altă funcție sql care le citește) = refuz
    IF EXISTS (SELECT 1 FROM pg_depend d
                WHERE ((d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.red_fan_loturi'::regclass
                        AND d.refobjsubid = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.red_fan_loturi'::regclass AND attname = 'opod'))
                    OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)')::oid))
                  AND d.deptype = 'n'
                  AND NOT (d.classid = 'pg_attrdef'::regclass)) THEN
      RAISE EXCEPTION '20261227a revenire: alte obiecte depind de coloana opod / fn_red_fan_lot_opod';
    END IF;
  END LOOP;
  -- sub lock: fără ISTORIC NOU (L14 textual): nicio alegere oPOD pornită, niciun eveniment opod_schimbat în jurnal (append-only, nu se șterge)
  IF EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE opod IS DISTINCT FROM false) THEN
    RAISE EXCEPTION '20261227a revenire: exista loturi cu oPOD cerut (opod = true) - refuz (alegerea owner-ului nu se pierde prin revenire)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_fan_loturi' AND date_noi ->> 'eveniment' = 'opod_schimbat') THEN
    RAISE EXCEPTION '20261227a revenire: red_jurnal are istoric opod_schimbat - refuz (jurnalul nu se sterge)';
  END IF;
  DROP FUNCTION public.fn_red_fan_lot_opod(uuid, boolean);
  ALTER TABLE public.red_fan_loturi DROP COLUMN opod;
  -- corpul EXACT din 20261212a (CREATE OR REPLACE păstrează proprietarul, ACL-ul și trigger-ul)
  CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'redari fan: marcajul unui lot nu se sterge' USING ERRCODE = '42501'; END IF;
  IF NEW.lot_id IS DISTINCT FROM OLD.lot_id OR NEW.proiect_id IS DISTINCT FROM OLD.proiect_id
     OR (OLD.prima_aprobare_la IS NOT NULL AND (NEW.test IS DISTINCT FROM OLD.test OR NEW.prima_aprobare_la IS DISTINCT FROM OLD.prima_aprobare_la
         OR NEW.prima_aprobare_de IS DISTINCT FROM OLD.prima_aprobare_de OR NEW.marcat_de IS DISTINCT FROM OLD.marcat_de OR NEW.marcat_la IS DISTINCT FROM OLD.marcat_la)) THEN
    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; marcajul de test nu se mai schimba' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
  -- postcondiție: starea din 20261212a
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_loturi' AND column_name = 'opod')
     OR to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NOT NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%') <> 19
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_fan_loturi_garda()')
                      AND md5(replace(p.prosrc, chr(13), '')) = '1931e70c3b15a07a6ee485537f27ce93' AND NOT p.prosecdef
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_loturi'::regclass AND tg.tgname = 'trg_red_fan_loturi_garda'
                      AND tg.tgenabled = 'O' AND tg.tgfoid = to_regprocedure('public.fn_red_fan_loturi_garda()') AND tg.tgtype = (1 | 2 | 8 | 16)) THEN
    RAISE EXCEPTION '20261227a revenire post: starea nu e cea din 20261212a';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261227a_redari_fan_opod_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261227a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261227a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
