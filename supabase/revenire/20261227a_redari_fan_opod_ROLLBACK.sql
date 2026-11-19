-- Revenire 20261227a_redari_fan_opod. NEAPLICAT (ca și migrarea). Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate ce a creat migrarea: trigger-ul trg_red_fan_awb_opod_jurnal + funcția fn_red_fan_awb_opod_jurnal() (runda 3), funcția
--   fn_red_fan_lot_opod(uuid, boolean), coloana red_fan_loturi.opod (cu DEFAULT-ul ei) și readuce fn_red_fan_loturi_garda() la corpul EXACT din
--   20261212a (același trigger trg_red_fan_loturi_garda, neatins). Tabelele, celelalte funcții și datele existente NU se ating. 20261212a
--   rămâne aplicată; revenirea ei (19 funcții) e posibilă doar DUPĂ aceasta (și, ca la orice folosire FAN jurnalizată, refuză cât red_jurnal
--   are rânduri FAN — marcajele de instalare / dezinstalare rămân).
-- REFUZĂ (L14, textual) la ORICE FOLOSIRE DE DUPĂ APLICARE, deosebită de datele PREEXISTENTE prin marcajul de instalare scris de migrare în
--   red_jurnal ('opod_instalat': momentul aplicării + lista loturilor deduse true — cele aprobate înainte, care plecaseră cu B):
--   (1) evenimente 'opod_schimbat' (owner-ul a ales ceva); (2) un lot cu opod = true în afara listei din marcaj sau unul din listă ajuns false
--   (schimbare fără jurnal = stare incoerentă); (3) un lot aprobat după aplicare — orice lot cu prima_aprobare_la în afara listei din marcaj,
--   inclusiv cel aprobat cu implicitul false (Jakarinos #1135 r1 P2: aprobarea / generarea cu „fără oPOD” e o decizie care depinde de coloană);
--   (4) rânduri FAN create / scrise după momentul din marcaj (aprobat_la, generat_la, created_at, updated_at — în orice stare, runda 4), și pe
--   loturile deduse true (o generare / rezervare nouă pe un lot vechi tot după aplicare s-a făcut); (5) marcaje de instalare
--   dezechilibrate; (6) (runda 3, Jakarinos #1135 r2 P2) ORICE eveniment 'opod_aprobare' în red_jurnal — scris de trigger-ul migrării la fiecare
--   aprobare a unui rând FAN, pe orice lot (și pe cele deduse true), DURABIL: re-propunerea șterge aprobat_la (20261212a:521) și (3) nu vede un
--   lot deja în listă, dar evenimentul rămâne (jurnal append-only) → scenariul „lot vechi → aprobare nouă → re-propunere → revenire” = refuz.
--   RUNDA 4 (Jakarinos #1135 r3 P2): (6) acoperă ORICE pas FAN de după aplicare, nu doar aprobările — evenimentele 'opod_folosire' (propunere,
--   rezervare / claim, rezultat generat / eroare / necunoscut, reconciliere, ridicare, anulare, ștergere): succesiunea „plic aprobat ÎNAINTE →
--   aplicare → claim → rezultat 'eroare'” (și „necunoscut → reconciliere fără AWB”) nu mai trece; (4) prinde orice rând creat / scris
--   (created_at / updated_at) după marcaj, în ORICE stare (înainte: updated_at doar pe in_curs / necunoscut) — inclusiv scrierile de urmărire.
--   (3) și (4) rămân ca apărare în adâncime (un trigger dezactivat de mentenanță nu scrie evenimentul). Jurnalul e append-only: nu se șterge
--   nimic; revenirea scrie 'opod_dezinstalat' (cu marcajul citit în date_vechi).
--   Datele preexistente (loturile deduse true, rândurile lor generate înainte) NU opresc revenirea: ele erau cu B și înainte, și după.
--   Marcajele după aplicare fără aprobare (lot nou marcat TEST / real, cu implicitul false, dar neaprobat) sunt doar numărate în NOTICE: nimic
--   nu a plecat și nimic nu s-a aprobat pe ele.
-- Starea EXACTĂ a migrării e verificată înainte (coloana, funcțiile noi cu proprietățile lor, garda cu amprenta 20261227a, exact 21 funcții
--   fn_red_fan_*, cele două trigger-e în forma exactă) și din nou SUB LOCK; altă stare = refuz, nimic schimbat.
-- LIVRAREA = prin runner, DOAR cu plafon (forma revenirilor: FĂRĂ amprentă globală, plafonul 2000 — docs/LIVRARE_L15_V2.md §9, varianta A):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261227a_redari_fan_opod_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261227120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Ordinea (L06, L14): 1. gărzile + starea (doar catalog); 2. lock-urile ACCESS EXCLUSIVE pe red_fan_loturi (DROP COLUMN) și pe red_fan_awb
--   (DROP TRIGGER, runda 3), în această ordine (aceeași ca în migrare), NOWAIT, bugetul de 1 s de la BEGIN verificat înaintea fiecărei încercări
--   și DUPĂ obținere (un eșec al celui de-al doilea eliberează și primul: sub-tranzacția blocului); 3. sub lock: starea din nou, „fără istoric
--   nou”, DROP-urile, corpul vechi al gărzii, postcondiția. Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează. ACCESS EXCLUSIVE pe
--   red_fan_awb oprește și citirile FAN pe durata revenirii (≤ 1 s buget + lucrul sub lock, plafon 2000 ms): acceptat pentru o revenire cerută
--   explicit de owner.
-- Probe: scripts/pglite/test_redari_fan_opod_local.mjs (aplicare → revenire → re-aplicare pe bază NEFOLOSITĂ, cu un lot aprobat + generat
--   înainte de aplicare — datele preexistente nu opresc revenirea; refuz: lot nou aprobat după aplicare cu implicitul false, rând nou aprobat /
--   generat pe lotul vechi, aprobare nouă pe lotul vechi urmată de re-propunere (scenariul Jakarinos r2 — doar jurnalul 'opod_aprobare' o prinde),
--   rând inserat direct ca aprobat apoi re-propus, runda 4: plic aprobat înainte → claim după aplicare → rezultat 'eroare' (scenariul Jakarinos
--   r3) și → 'necunoscut' → reconciliere fără AWB, ștergere directă, doar urmărire; opod = true ales de owner / istoric opod_schimbat, true fără
--   jurnal, marcaj lipsă; fără migrare /
--   funcție în plus / fără marcajul runnerului / plafon greșit; mutanți: fiecare verificare scoasă lasă DOAR scenariul ei să treacă).
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_rau text; v_marcaj record; v_la timestamptz; v_n integer; v_noi integer;
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
          LOCK TABLE public.red_fan_awb IN ACCESS EXCLUSIVE MODE NOWAIT;
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
    -- starea EXACTĂ a lui 20261227a: coloana, funcțiile noi (proprietăți + EXECUTE), garda cu corpul 20261227a, exact 21 funcții, trigger-ele în forma exactă
    IF to_regclass('public.red_fan_loturi') IS NULL OR to_regclass('public.red_fan_awb') IS NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_loturi' AND column_name = 'opod'
                        AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false') THEN
      RAISE EXCEPTION '20261227a revenire: starea nu e cea din 20261227a (pasul %, coloana opod)', v_pas;
    END IF;
    SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
      FROM (VALUES
        ('public.fn_red_fan_lot_opod(uuid, boolean)', 'b591ff764adede2b335b96e89e41aaca', 'plpgsql', true, true, 'boolean'),
        -- runda 3 + 4: trigger-ul de jurnal al ciclului de viață FAN (DEFINER, fără EXECUTE pentru roluri)
        ('public.fn_red_fan_awb_opod_jurnal()', '76c319ae5359d29b0056ecb789054fe4', 'plpgsql', true, false, 'trigger'),
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
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%') <> 21 THEN
      RAISE EXCEPTION '20261227a revenire: starea nu e cea din 20261227a (pasul %, numarul functiilor fn_red_fan_* difera de 21)', v_pas;
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_loturi'::regclass AND NOT tgisinternal) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_loturi'::regclass AND tg.tgname = 'trg_red_fan_loturi_garda'
                        AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = to_regprocedure('public.fn_red_fan_loturi_garda()')
                        AND tg.tgtype = (1 | 2 | 8 | 16)) THEN
      RAISE EXCEPTION '20261227a revenire: starea nu e cea din 20261227a (pasul %, trigger)', v_pas;
    END IF;
    -- runda 3 + 4: trigger-ul de jurnal, singurul al aplicației pe red_fan_awb, în forma exactă (AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW,
    -- fără coloane / WHEN / argumente)
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_opod_jurnal'
                        AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = to_regprocedure('public.fn_red_fan_awb_opod_jurnal()')
                        AND tg.tgtype = (1 | 4 | 8 | 16) AND tg.tgattr::text = '') THEN
      RAISE EXCEPTION '20261227a revenire: starea nu e cea din 20261227a (pasul %, trigger-ul de jurnal pe red_fan_awb)', v_pas;
    END IF;
    -- dependențe străine spre coloana / funcțiile migrării (o vedere, un index, o politică, altă funcție sql care le citește, alt trigger) = refuz;
    -- singura dependență permisă: trigger-ul nostru spre funcția lui de jurnal
    IF EXISTS (SELECT 1 FROM pg_depend d
                WHERE ((d.refclassid = 'pg_class'::regclass AND d.refobjid = 'public.red_fan_loturi'::regclass
                        AND d.refobjsubid = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.red_fan_loturi'::regclass AND attname = 'opod'))
                    OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)')::oid)
                    OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = to_regprocedure('public.fn_red_fan_awb_opod_jurnal()')::oid
                        AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid = (SELECT tg.oid FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_opod_jurnal'))))
                  AND d.deptype = 'n'
                  AND NOT (d.classid = 'pg_attrdef'::regclass)) THEN
      RAISE EXCEPTION '20261227a revenire: alte obiecte depind de coloana opod / fn_red_fan_lot_opod / fn_red_fan_awb_opod_jurnal';
    END IF;
  END LOOP;
  -- sub lock: fără FOLOSIRE DE DUPĂ APLICARE (L14 textual). Marcajul de instalare (ultimul 'opod_instalat', cu exact un 'opod_instalat' peste
  -- 'opod_dezinstalat') dă momentul aplicării și lista loturilor deduse true (date preexistente).
  IF EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_fan_loturi' AND date_noi ->> 'eveniment' = 'opod_schimbat') THEN
    RAISE EXCEPTION '20261227a revenire: red_jurnal are istoric opod_schimbat (alegeri ale owner-ului dupa aplicare) - refuz (jurnalul nu se sterge)';
  END IF;
  IF (SELECT count(*) FILTER (WHERE date_noi ->> 'eveniment' = 'opod_instalat') - count(*) FILTER (WHERE date_noi ->> 'eveniment' = 'opod_dezinstalat')
        FROM public.red_jurnal WHERE tabela = 'red_fan_loturi') <> 1 THEN
    RAISE EXCEPTION '20261227a revenire: marcajul de instalare (opod_instalat) lipseste sau e dezechilibrat in red_jurnal - refuz';
  END IF;
  SELECT j.id, j.created_at, j.date_noi INTO v_marcaj FROM public.red_jurnal j
   WHERE j.tabela = 'red_fan_loturi' AND j.date_noi ->> 'eveniment' = 'opod_instalat' ORDER BY j.id DESC LIMIT 1;
  IF v_marcaj.date_noi ->> 'la' IS NULL OR jsonb_typeof(v_marcaj.date_noi -> 'loturi_opod') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '20261227a revenire: marcajul opod_instalat #% nu are forma asteptata (la, loturi_opod)', v_marcaj.id;
  END IF;
  v_la := (v_marcaj.date_noi ->> 'la')::timestamptz;
  -- (2) loturile cu opod = true = EXACT lista dedusă la aplicare (altceva = alegere fără jurnal / stare incoerentă)
  IF EXISTS (SELECT 1 FROM public.red_fan_loturi l WHERE l.opod AND NOT (v_marcaj.date_noi -> 'loturi_opod') ? l.lot_id::text)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_marcaj.date_noi -> 'loturi_opod') x(id) LEFT JOIN public.red_fan_loturi l ON l.lot_id = x.id::uuid
                 WHERE l.lot_id IS NULL OR NOT l.opod) THEN
    RAISE EXCEPTION '20261227a revenire: loturile cu opod = true difera de lista dedusa la aplicare (marcaj #%) - refuz', v_marcaj.id;
  END IF;
  -- (3) lot aprobat DUPĂ aplicare (orice lot cu aprobare în afara listei din marcaj — cu implicitul false sau altfel): decizie luată cu coloana
  SELECT count(*) INTO v_n FROM public.red_fan_loturi l WHERE l.prima_aprobare_la IS NOT NULL AND NOT (v_marcaj.date_noi -> 'loturi_opod') ? l.lot_id::text;
  IF v_n > 0 THEN
    RAISE EXCEPTION '20261227a revenire: % lot(uri) aprobat(e) dupa aplicarea migrarii (cu alegerea oPOD din coloana, implicit false) - refuz', v_n;
  END IF;
  -- (4) rânduri FAN create / scrise după momentul aplicării, în ORICE stare (și pe loturile deduse true): aprobare, rezervare, rezultat
  -- (generat / eroare / necunoscut), reconciliere, urmărire — runda 4: înainte updated_at se citea doar pe in_curs / necunoscut, iar un claim
  -- de după aplicare încheiat cu 'eroare' (generat_la NULL, aprobat_la de dinainte) trecea
  SELECT count(*) INTO v_n FROM public.red_fan_awb a
   WHERE a.aprobat_la >= v_la OR a.generat_la >= v_la OR a.created_at >= v_la OR a.updated_at >= v_la;
  IF v_n > 0 THEN
    RAISE EXCEPTION '20261227a revenire: % rand(uri) FAN create / scrise dupa aplicarea migrarii (%: aprobare, rezervare, rezultat, reconciliere sau urmarire) - refuz', v_n, v_la;
  END IF;
  -- (6) runda 3 + 4: ORICE pas FAN de după aplicare, pe orice lot, DURABIL (jurnalul 'opod_aprobare' / 'opod_folosire' scris de trigger-ul
  -- migrării la aprobare, propunere, rezervare, rezultat, reconciliere, ridicare, anulare, ștergere; nicio tranziție ulterioară nu șterge
  -- evenimentul; pe conținut, nu pe timp — prinde și scrierea „în zbor” cu now() dinaintea marcajului)
  SELECT count(*) INTO v_n FROM public.red_jurnal j WHERE j.tabela = 'red_fan_awb' AND j.date_noi ->> 'eveniment' IN ('opod_aprobare', 'opod_folosire');
  IF v_n > 0 THEN
    RAISE EXCEPTION '20261227a revenire: % pas(i) FAN dupa aplicarea migrarii (jurnal opod_aprobare / opod_folosire: aprobari, rezervari, rezultate, reconcilieri cu alegerea oPOD din coloana, chiar daca randul a ajuns intre timp in alta stare) - refuz (jurnalul nu se sterge)', v_n;
  END IF;
  SELECT count(*) INTO v_noi FROM public.red_fan_loturi l WHERE l.marcat_la >= v_la;
  -- marcajul de dezinstalare (append-only; marcajul citit în date_vechi), ÎNAINTE de DDL — rândul intră în aceeași tranzacție
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_loturi', NULL, 'delete', v_marcaj.date_noi,
          jsonb_build_object('eveniment', 'opod_dezinstalat', 'migrare', '20261227a_redari_fan_opod', 'la', now(), 'marcaj_instalat', v_marcaj.id,
                             'loturi_marcate_dupa', v_noi), NULL);
  DROP TRIGGER trg_red_fan_awb_opod_jurnal ON public.red_fan_awb;
  DROP FUNCTION public.fn_red_fan_awb_opod_jurnal();
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
     OR to_regprocedure('public.fn_red_fan_awb_opod_jurnal()') IS NOT NULL
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 0
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%') <> 19
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_fan_loturi_garda()')
                      AND md5(replace(p.prosrc, chr(13), '')) = '1931e70c3b15a07a6ee485537f27ce93' AND NOT p.prosecdef
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_loturi'::regclass AND tg.tgname = 'trg_red_fan_loturi_garda'
                      AND tg.tgenabled = 'O' AND tg.tgfoid = to_regprocedure('public.fn_red_fan_loturi_garda()') AND tg.tgtype = (1 | 2 | 8 | 16)) THEN
    RAISE EXCEPTION '20261227a revenire post: starea nu e cea din 20261212a';
  END IF;
  -- marcajele echilibrate după revenire; un singur rând scris în jurnal de această tranzacție
  IF (SELECT count(*) FILTER (WHERE date_noi ->> 'eveniment' = 'opod_instalat') - count(*) FILTER (WHERE date_noi ->> 'eveniment' = 'opod_dezinstalat')
        FROM public.red_jurnal WHERE tabela = 'red_fan_loturi') <> 0
     OR (SELECT count(*) FROM public.red_jurnal j WHERE j.xmin::text = (txid_current() % 4294967296)::text) <> 1 THEN
    RAISE EXCEPTION '20261227a revenire post: marcajul opod_dezinstalat';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261227a_redari_fan_opod_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261227a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261227a revenire: sfarsit la % ms de la BEGIN (marcaj #%, % loturi deduse la aplicare, % loturi marcate dupa, neaprobate)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_marcaj.id, jsonb_array_length(v_marcaj.date_noi -> 'loturi_opod'), v_noi;
END $revenire$;
