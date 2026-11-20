-- Version 20261228120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261228a_redari_fan_operator.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului în
--   aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 v2 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ a runnerului (orice derivă a oricărei funcții, politici, drept sau
--   trigger față de baseline-ul revizuit = refuz, nimic comis). Manifestul .l15.tsv îl generează coordonatorul pe clonă (scripts/livrare_l15_manifest.sh);
--   lista OBIECTELOR pe care trebuie să le conțină e în supabase/tests/20261228a_redari_fan_operator.l15.obiecte.tsv (generată pe PGlite cu pașii
--   reali ai runnerului). Pe lângă ea, migrarea verifică pe amprentă (corp fără CR + proprietăți + drepturi), ÎNAINTE: poarta de drept fn_red_nivel
--   (20261126a) și TOATE cele 21 de funcții fn_red_fan_* ale bazei (19 din 20261212a, cu garda loturilor în forma din 20261227a, + cele 2 din
--   20261227a: fn_red_fan_lot_opod, fn_red_fan_awb_opod_jurnal; listă scrisă, nu citită din catalog); DUPĂ: toate cele 52 de funcții
--   fn_red_fan_* (vechi neschimbate, vechi înlocuite, noi) cu amprentele lor noi (AMPRENTE-NOI) și EXECUTE exact pe clasă.
-- BAZA = 20261212a + 20261227a (oPOD, #1135) aplicate, în această ordine (runda 2 pe #1136: re-bazare după îmbinarea #1135 în main). Ce schimbă
--   asta aici: (1) comanda primește alegerea oPOD cu care funcția edge a calculat hash-urile (p_opod) și o compară, sub lock-ul rândului
--   red_fan_loturi (poziția 4), cu alegerea lotului (lot nemarcat = implicitul false al marcajului automat): alta = RD038, nimic scris — o
--   schimbare a alegerii între citirea funcției edge și comandă nu poate produce aprobări pe un hash calculat cu cealaltă alegere (L03);
--   (2) trigger-ul de jurnal al 20261227a (trg_red_fan_awb_opod_jurnal, AFTER, red_fan_awb) rămâne neatins și rulează și în scrierile F1: el doar
--   citește red_fan_loturi fără lock de rând și INSEREAZĂ în red_jurnal (append-only, fără lock-uri de rând) — nicio așteptare nouă în ordinea
--   §6.2; (3) fn_red_fan_lot_opod (20261227a) refuză schimbarea alegerii cât lotul are rânduri în altă stare decât propus / eroare / anulat — deci
--   și cu rânduri de_aprobat (cererea peste plafon așteaptă pe hash-ul calculat cu alegerea de acum) sau retras (conservator); neschimbată.
--   Revenirea 20261227a NU se poate rula cât 20261228a e aplicată (amprentele funcțiilor din 20261212a pe care le verifică sunt înlocuite aici):
--   ordinea inversă obligatorie (întâi revenirea 20261228a).
-- 20261228a_redari_fan_operator — Redări FAN Courier, felia F1 a fluxului pentru operator (docs/redari/FAN_FLUX_OPERATOR_SPEC.md §13 F1):
--   operatorii numiți, plafonul zilei, butonul unic „Trimite la curier” (fn_red_fan_comanda, în trei faze L → V → M), separarea COMENZILOR
--   omului (clasa A) de ÎNSCRIEREA rezultatelor externe (clasa B, EXECUTE exclusiv service_role) și de excepțiile owner-ului (clasa C), garda
--   „doar proiecte de TEST” și în BD (red_fan_setari.doar_proiecte_test + fn_red_fan_lot_permis pe orice cale cu efect), intențiile (idempotența
--   apăsării, reluarea după crash), cererile de aprobare peste plafon (Q2 A: toată trimiterea așteaptă), retragerea din trimitere, anularea în
--   doi pași (cerere ≠ confirmare, trigger BEFORE UPDATE cu trei liste), „lotul tipărit nu se mai atinge” (RD036 / exclus lot_tiparit) și
--   „tirajul doar pe lotul încheiat” (RD031). Scrisă de Rocky (redari@), 18–19.11.2026, fără acces la BD; verdictul recenzentului pe
--   specificație: GO cu două condiții P2, ambele puse în practică aici (răspunsul comenzii = aprobările și consumul EFECTIV; Q2 A literal:
--   peste plafon nimic nu pleacă, nici rândurile aprobat preluabile; o comandă nouă nu trimite rândurile de_aprobat).
--
-- ORDINEA UNICĂ a lock-urilor la rulare (L06, spec §6.2), scrisă în comentariul fiecărei funcții care blochează rânduri din mai multe tabele:
--   1 red_loturi_plicuire (lot FOR UPDATE) → 2 red_plicuri (ORDER BY id FOR UPDATE) → 3 red_fan_awb (ORDER BY id FOR UPDATE; comanda: rândurile vii
--   ale lotului ȘI ale plicurilor cerute rămase pe alt lot, într-un singur SELECT) → 4 red_fan_loturi → 5 red_fan_setari → 6 red_fan_zi
--   (+ red_fan_zi_consum) → 7 red_fan_cereri_aprobare → 8 red_fan_intentii → 11 red_jurnal (INSERT, ÎNTOTDEAUNA ultimul). Fiecare RPC ia un
--   SUBȘIR al ei. Fazele unui RPC care scrie în mai multe tabele: L (lock-urile pe rândurile existente, fără scrieri) → V (verificările, fără
--   scrieri; refuz = RAISE, replay = RETURN) → M (mutațiile; niciun lock disputabil nou: rândurile noi nu sunt ținute de nimeni, punctele de
--   contact — indexurile unice pe plic / cheie / lot in_curs / cerere deschisa / zi — sunt serializate de 1 sau 5, luate deja în L).
-- CLASELE RPC-urilor (spec §7.3): A = comenzile omului (EXECUTE authenticated, în corp fn_red_fan_e_operator() sau fn_red_fan_e_owner());
--   B = înscrierea rezultatelor externe (EXECUTE EXCLUSIV service_role; în corp auth.uid() IS NULL, p_actor re-verificat ca operator / owner,
--   legătura cu intenția / solicitarea); C = excepțiile manuale ale owner-ului (authenticated, fn_red_fan_e_owner()). Interne = fără EXECUTE.
-- INVENTARUL predicatelor pe `stare` din 20261212a, recitite pentru stările noi de_aprobat și retras (Jakarinos, spec §13 F1): CHECK aprobare →
--   ambele în lista „fără aprobare”; CHECK generat → ambele în lista „fără AWB”; CHECK ridicat → neschimbat; CHECK in_curs → neschimbat;
--   indexul viu red_fan_awb_plic_viu_uq → retras adăugat la excluse, de_aprobat e viu; garda marcajului (fn_red_fan_lot_marcheaza) →
--   NOT IN ('propus','de_aprobat','eroare','anulat','retras'); plafonul pe lot (fn_red_fan_aproba + comandă) → de_aprobat se numără la „deja”;
--   claim → cere strict aprobat; fn_red_fan_propune → re-propune propus / aprobat (de_aprobat NU: tranziția de_aprobat → propus e doar a deciziei
--   / retragerii cererii, tabelul §8.8); urmărire / confirmări / soluționare → doar generat / ridicat, neschimbat; red_fan_awb_cerere_ix → neschimbat.
-- Lock-uri la APLICARE (punct unic, NOWAIT, ordine FIXĂ): red_proiecte, red_loturi_plicuire (SHARE ROW EXCLUSIVE: cheile străine ale tabelelor noi),
--   red_fan_awb (ACCESS EXCLUSIVE: coloane + CHECK-uri + index + trigger), red_fan_loturi (SHARE UPDATE EXCLUSIVE: comentariul coloanei marcat_de),
--   red_fan_setari (ACCESS EXCLUSIVE: coloanele noi). Bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI, verificat înaintea fiecărei
--   încercări și DUPĂ obținere; fiecare încercare = subtranzacție. Lock-urile IMPLICITE de după set: (a) pe relațiile setului, deja ținute cel
--   puțin la fel de tare (FK-urile tabelelor noi spre red_loturi_plicuire / red_proiecte / red_fan_awb; CREATE TRIGGER pe red_fan_awb); (b) în afara
--   setului, doar ACCESS SHARE: validarea corpurilor LANGUAGE sql la CREATE FUNCTION (profiles, user_module_access, red_fan_operatori nou,
--   red_fan_loturi) și view-urile (red_loturi_plicuire ținut; red_fan_loturi, red_fan_intentii nou). Corpurile plpgsql nu se analizează la creare.
--   Nicio cheie străină spre profiles. Nicio funcție creată nu rulează la aplicare (în afara postcondițiilor, care doar citesc).
-- Backfill (L14): rândurile `anulat` existente primesc coloanele confirmării (anulat_la = updated_at, anulat_de = aprobat_de sau propus_de,
--   motiv_anulare = 'alt_motiv', anulare_nota = motivul vechi tăiat la 200) ÎNAINTEA CHECK-ului red_fan_awb_anulat; numărul lor în NOTICE.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, bugetul lock-urilor
--   de 1 s și garda finală a runnerului.
-- RUNDA 4 (proba pe clonă, 20.11.2026): (1) poarta 0e a runnerului (cod 30) găsea 5 funcții expuse care scriau marcajul gărzii rândului FAN cu
--   funcția de configurare, iar (2) poarta Izometrie E2 (fn_izo_porti_lipsa) socotea cele 7 funcții care îl scriu „mutatori de cale” și
--   trigger-ul trg_red_fan_awb_garda (care le numește în listele lui) „invocare implicită neanalizată”. Acum marcajul se scrie cu instrucțiunea
--   statică SET LOCAL (precedentul 20261130l), fără id-ul rândului; postcondiția cere că doar cele 7 îl scriu și că niciun corp fn_red_fan_* nu
--   mai are tiparele porților (configurare / cale de căutare / SQL dinamic). Migrarea NU atinge perimetrul porților Izometrie (detectorul
--   scripts/izometrie/porti_regula.mjs: „nu atinge”), deci fără ritualul PRE / ștampile / POST. (3) Comanda pune marcajul automat al lotului
--   ÎNAINTEA scrierilor pe rânduri: primul eveniment de jurnal 20261227a al unui lot nemarcat are opod = false, nu NULL.
-- Revenire: supabase/revenire/20261228a_redari_fan_operator_ROLLBACK.sql (prin runner, plafonul 2000; LOCK … NOWAIT în ordinea §6.2; refuză cu
--   operatori numiți, zile / consum, cereri, intenții, rânduri de_aprobat / retras, coloane noi nenule, setări schimbate sau evenimente noi în
--   red_jurnal; readuce TEXTUAL corpurile vechi ale funcțiilor înlocuite, cu amprenta verificată DUPĂ).
-- Probe: scripts/pglite/test_redari_fan_operator_local.mjs (PGlite: aplicarea ca runnerul peste 20261212a, P1–P14, I1–I14, trigger-ul anulării,
--   clasele A / B / C ca operator ne-owner și ca service_role, revenirea, mutanții P6 / P13 / I14) + supabase/tests/20261228a_redari_fan_operator_doua_sesiuni.sh
--   (două sesiuni reale pe un cluster dispensabil: P5, I5, E15, E22 a–c cu mutantul fazei L — netestat local, serverul de cod nu are psql).
DO $pre$
DECLARE v_plafon text; r record; v_tip text; v_def text; v_rau text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261228a_redari_fan_operator:' || txid_current() THEN
    RAISE EXCEPTION '20261228a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261228a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261228a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261228a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261228a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261228a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- baza: 20261212a + 20261227a aplicate (cele trei tabele, coloana opod, exact 21 de funcții fn_red_fan_*); reaplicare = refuz
  IF to_regclass('public.red_fan_awb') IS NULL OR to_regclass('public.red_fan_loturi') IS NULL OR to_regclass('public.red_fan_setari') IS NULL THEN
    RAISE EXCEPTION '20261228a: 20261212a nu e aplicata (tabelele FAN lipsesc)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_loturi' AND column_name = 'opod'
                   AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false')
     OR to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NULL OR to_regprocedure('public.fn_red_fan_awb_opod_jurnal()') IS NULL THEN
    RAISE EXCEPTION '20261228a: 20261227a (oPOD) nu e aplicata (coloana red_fan_loturi.opod / fn_red_fan_lot_opod / fn_red_fan_awb_opod_jurnal lipsesc): ordinea e 20261212a -> 20261227a -> 20261228a';
  END IF;
  IF to_regclass('public.red_fan_operatori') IS NOT NULL OR to_regclass('public.red_fan_zi') IS NOT NULL OR to_regclass('public.red_fan_zi_consum') IS NOT NULL
     OR to_regclass('public.red_fan_cereri_aprobare') IS NOT NULL OR to_regclass('public.red_fan_intentii') IS NOT NULL
     OR to_regclass('public.v_red_fan_plafon_azi') IS NOT NULL OR to_regclass('public.v_red_fan_anulari') IS NOT NULL OR to_regclass('public.v_red_fan_intentii') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_setari' AND column_name IN ('limita_zi', 'doar_proiecte_test', 'presupunere_429'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_awb'
                 AND column_name IN ('cerere_aprobare_id', 'aprobare_owner_la', 'intentie_cheie', 'retras_de', 'retras_la', 'motiv_retragere', 'anulare_ceruta_de', 'anulare_ceruta_la',
                                     'anulare_ceruta_motiv', 'anulare_ceruta_nota', 'anulat_de', 'anulat_la', 'motiv_anulare', 'anulare_nota'))
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%') <> 21 THEN
    RAISE EXCEPTION '20261228a: obiectele exista deja sau numarul functiilor fn_red_fan_* nu e 21 (reaplicare / stare neasteptata)';
  END IF;
  -- coloanele citite / scrise, cu tipurile din migrările lor (20261126a, 20261129i, 20261212a)
  FOR r IN SELECT * FROM (VALUES
      ('profiles', 'id', '^uuid$'), ('profiles', 'is_owner', '^boolean$'),
      ('user_module_access', 'profile_id', '^uuid$'), ('user_module_access', 'module', '^text$'), ('user_module_access', 'access_level', '^text$'),
      ('red_proiecte', 'id', '^uuid$'), ('red_proiecte', 'cod', '^text$'),
      ('red_loturi_plicuire', 'id', '^uuid$'), ('red_loturi_plicuire', 'proiect_id', '^uuid$'), ('red_loturi_plicuire', 'nr_lot', '^text$'),
      ('red_plicuri', 'id', '^uuid$'), ('red_plicuri', 'proiect_id', '^uuid$'), ('red_plicuri', 'lot_id', '^uuid$'), ('red_plicuri', 'nr_plic', '^text$'),
      ('red_plicuri', 'stare', '^text$'), ('red_plicuri', 'awb', '^text$'), ('red_plicuri', 'data_expediere', '^date$'),
      ('red_fan_awb', 'id', '^uuid$'), ('red_fan_awb', 'lot_id', '^uuid$'), ('red_fan_awb', 'plic_id', '^uuid$'), ('red_fan_awb', 'proiect_id', '^uuid$'),
      ('red_fan_awb', 'stare', '^text$'), ('red_fan_awb', 'hash_date', '^text$'), ('red_fan_awb', 'cerere_id', '^uuid$'), ('red_fan_awb', 'aprobat_de', '^uuid$'),
      ('red_fan_awb', 'aprobat_la', '^timestamp with time zone$'), ('red_fan_awb', 'propus_de', '^uuid$'), ('red_fan_awb', 'motiv', '^text$'),
      ('red_fan_awb', 'updated_at', '^timestamp with time zone$'), ('red_fan_awb', 'tarif', '^numeric$'), ('red_fan_awb', 'awb', '^text$'),
      ('red_fan_loturi', 'lot_id', '^uuid$'), ('red_fan_loturi', 'test', '^boolean$'), ('red_fan_loturi', 'marcat_de', '^uuid$'), ('red_fan_loturi', 'tiraj_cheie', '^text$'),
      ('red_fan_loturi', 'prima_aprobare_la', '^timestamp with time zone$'), ('red_fan_loturi', 'prima_aprobare_de', '^uuid$'), ('red_fan_loturi', 'opod', '^boolean$'),
      ('red_fan_setari', 'id', '^boolean$'), ('red_fan_setari', 'limita_lot', '^integer$'),
      ('red_jurnal', 'tabela', '^text$'), ('red_jurnal', 'inregistrare_id', '^uuid$'), ('red_jurnal', 'actiune', '^text$'),
      ('red_jurnal', 'date_vechi', '^jsonb$'), ('red_jurnal', 'date_noi', '^jsonb$'), ('red_jurnal', 'user_id', '^uuid$')
    ) v(t, c, tip) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION '20261228a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  -- CHECK-urile rescrise textual (stare, aprobare, generat) și indexul viu: EXACT forma din 20261212a (altfel inventarul de mai sus nu se aplică)
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_fan_awb'::regclass AND c.conname = 'red_fan_awb_stare_check';
  IF v_def IS DISTINCT FROM 'CHECK ((stare = ANY (ARRAY[''propus''::text, ''aprobat''::text, ''in_curs''::text, ''generat''::text, ''eroare''::text, ''necunoscut''::text, ''anulat''::text, ''ridicat''::text])))' THEN
    RAISE EXCEPTION '20261228a: CHECK-ul starilor red_fan_awb nu e cel din 20261212a (%)', coalesce(v_def, 'lipsa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_fan_awb'::regclass AND conname = 'red_fan_awb_aprobare')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_fan_awb'::regclass AND conname = 'red_fan_awb_generat')
     OR (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_awb_plic_viu_uq')
        IS DISTINCT FROM 'CREATE UNIQUE INDEX red_fan_awb_plic_viu_uq ON public.red_fan_awb USING btree (plic_id) WHERE (stare <> ALL (ARRAY[''eroare''::text, ''anulat''::text]))' THEN
    RAISE EXCEPTION '20261228a: CHECK-urile aprobare / generat sau indexul viu red_fan_awb_plic_viu_uq nu sunt cele din 20261212a';
  END IF;
  -- pe red_fan_awb DOAR trigger-ul de jurnal al 20261227a, în forma exactă (AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW, fără coloane / WHEN /
  -- argumente; trigger-ul gărzii F1 e nou); un singur rând de setări
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_opod_jurnal'
                      AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = to_regprocedure('public.fn_red_fan_awb_opod_jurnal()')
                      AND tg.tgtype = (1 | 4 | 8 | 16) AND tg.tgattr::text = '')
     OR (SELECT count(*) FROM public.red_fan_setari) <> 1 THEN
    RAISE EXCEPTION '20261228a: red_fan_awb nu are exact trigger-ul de jurnal din 20261227a sau setarile nu au exact un rand';
  END IF;
  -- preflight (L14): un singur rând viu pe plic rămâne adevărat și cu `retras` exclus (azi nu există rânduri retras); rândurile anulat de completat
  IF EXISTS (SELECT 1 FROM public.red_fan_awb WHERE stare NOT IN ('eroare', 'anulat') GROUP BY plic_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261228a: preflight: plic cu mai multe randuri FAN vii';
  END IF;
  RAISE NOTICE '20261228a: preflight: % randuri anulat primesc coloanele confirmarii (backfill), % randuri FAN in total',
    (SELECT count(*) FROM public.red_fan_awb WHERE stare = 'anulat'), (SELECT count(*) FROM public.red_fan_awb);
  IF to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid
     OR NOT pg_has_role('postgres', 'authenticated', 'USAGE') OR NOT pg_has_role('postgres', 'anon', 'USAGE') OR NOT pg_has_role('postgres', 'service_role', 'USAGE') THEN
    RAISE EXCEPTION '20261228a: dependentele (auth.uid, rolurile aplicatiei) lipsesc sau difera';
  END IF;
END $pre$;

-- ── lanțul verificat pe amprentă ÎNAINTE: poarta de drept fn_red_nivel (20261126a) + cele 21 de funcții fn_red_fan_* EXACT ca după 20261227a
-- (19 din 20261212a, garda loturilor înlocuită de 20261227a, + fn_red_fan_lot_opod și fn_red_fan_awb_opod_jurnal din 20261227a; corp fără CR,
-- limbaj, DEFINER, volatilitate, tipul întors, proprietar, ACL). Garanția completă (orice altă funcție / politică / drept) =
-- amprenta globală L15 v2 a runnerului. DUPĂ: lista AMPRENTE-NOI din postcondiții.
CREATE FUNCTION pg_temp.lant_20261228a() RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $lant$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_nivel()', '21db8e5d4b69b7f19e571a7087c361ae', 'sql', true, 's', 'text', NULL),
      ('public.fn_red_fan_anulat(uuid,text,text)', '9e4edb2069281e97290bebdf7b1b219f', 'plpgsql', true, 'v', 'void', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_aproba(uuid,uuid[],text[])', 'e584116e292d5a307041225b2ff27fbc', 'plpgsql', true, 'v', 'integer', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_camp(text)', 'b3a822a4a5f35ccdd65460af7e81d635', 'sql', false, 'i', 'text', '{postgres=X/postgres}'),
      ('public.fn_red_fan_claim_lot(uuid,uuid[],text[],text[])', '2e10d8103f144fee46ceae430eff8f6f', 'plpgsql', true, 'v', 'uuid', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_confirmari(uuid,jsonb)', '38126aa49c67e10ead3106dbdfee3e02', 'plpgsql', true, 'v', 'jsonb', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_e_owner()', '941c20690f2ae0cda77869a1d865ea69', 'sql', true, 's', 'boolean', '{postgres=X/postgres}'),
      ('public.fn_red_fan_lot_marcheaza(uuid,boolean)', '7ea87499188a0c7d6a7189b017fa4805', 'plpgsql', true, 'v', 'boolean', '{postgres=X/postgres,authenticated=X/postgres}'),
      -- garda loturilor în forma din 20261227a (după prima aprobare nici opod nu se mai schimbă); cele două funcții noi ale 20261227a
      ('public.fn_red_fan_loturi_garda()', '5f167c38850bbfc30cb29c0a0fd734ad', 'plpgsql', false, 'v', 'trigger', '{postgres=X/postgres}'),
      ('public.fn_red_fan_lot_opod(uuid,boolean)', 'b591ff764adede2b335b96e89e41aaca', 'plpgsql', true, 'v', 'boolean', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_awb_opod_jurnal()', '76c319ae5359d29b0056ecb789054fe4', 'plpgsql', true, 'v', 'trigger', '{postgres=X/postgres}'),
      ('public.fn_red_fan_propune(uuid,text,numeric)', 'fa0e624dfc9d6a354914ce1da1784b64', 'plpgsql', true, 'v', 'uuid', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_reconciliaza(uuid,text,numeric,numeric,text)', '156b02110854f35d8817d65c11a12274', 'plpgsql', true, 'v', 'text', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_rezultate(uuid,jsonb)', 'd6aa943671b05296d0bf9548030c7c85', 'plpgsql', true, 'v', 'integer', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_ridicat(uuid,date)', 'f4d15e94e4cf50dcfa39403f42a83d81', 'plpgsql', true, 'v', 'void', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_setari_seteaza(integer)', 'c1be717db01d6bfd7a4c05ec18a7e24f', 'plpgsql', true, 'v', 'integer', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_suma(numeric)', 'e4c468b1a27473db01ba7cfd15421a7d', 'sql', false, 'i', 'numeric', '{postgres=X/postgres}'),
      ('public.fn_red_fan_surse(uuid)', 'dd250f175d559976c72412ded8a1ae06', 'sql', false, 's', 'text', '{postgres=X/postgres}'),
      ('public.fn_red_fan_tiraj(uuid,text,text)', '07346ffd900bb6a50f213dccab4526b9', 'plpgsql', true, 'v', 'jsonb', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_tiraj_opreste(uuid,text,boolean)', '63b507c349b2961c032468a3d542212a', 'plpgsql', true, 'v', 'jsonb', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_urmarire(uuid,jsonb)', '79166f3bdbf6c219745ac47a6c984119', 'plpgsql', true, 'v', 'jsonb', '{postgres=X/postgres,authenticated=X/postgres}'),
      ('public.fn_red_fan_urmarire_solutioneaza(uuid,integer,jsonb,text)', 'd286bb9f78d01f751eb123b0eb8ca5a5', 'plpgsql', true, 'v', 'jsonb', '{postgres=X/postgres,authenticated=X/postgres}')
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce, acl)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR (a.acl IS NOT NULL AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM a.acl)
      OR (a.acl IS NULL AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20261228a: lantul (inainte) difera de amprentele revizuite din 20261126a / 20261212a / 20261227a: %', v_rau;
  END IF;
END $lant$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.lant_20261228a(); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06), după verificările de catalog; ordinea FIXĂ (poziția din §6.2 pentru tabelele FAN): red_proiecte,
-- red_loturi_plicuire (SHARE ROW EXCLUSIVE), red_fan_awb (ACCESS EXCLUSIVE), red_fan_loturi (SHARE UPDATE EXCLUSIVE), red_fan_setari (ACCESS EXCLUSIVE).
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261228a: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000)
        USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.red_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.red_loturi_plicuire IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.red_fan_awb IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.red_fan_loturi IN SHARE UPDATE EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.red_fan_setari IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261228a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000)
      USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261228a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ═══ 1. Tabelele noi (RLS citire admin / editor; scrieri DOAR prin RPC: niciun GRANT de INSERT / UPDATE / DELETE pentru nimeni) ═══
-- Operatorii numiți (spec §7.1, D2): lista explicită, administrată de owner, cu istoric (retragerea nu șterge rândul; re-numirea golește retras_*).
CREATE TABLE public.red_fan_operatori (
  profile_id uuid PRIMARY KEY,                 -- contul colegului (fără FK spre profiles: ar cere lock la aplicare, ca în 20261212a)
  numit_de uuid NOT NULL,
  numit_la timestamptz NOT NULL DEFAULT now(),
  retras_de uuid,
  retras_la timestamptz,
  nota text CHECK (nota IS NULL OR length(nota) <= 200),
  CONSTRAINT red_fan_operatori_retras CHECK ((retras_de IS NULL) = (retras_la IS NULL))
);
COMMENT ON TABLE public.red_fan_operatori IS 'Redări FAN: operatorii numiți de owner să trimită plicuri la curier (D2). Nivelul admin / editor Redări rămâne precondiție. Scris doar prin fn_red_fan_operator_seteaza (owner); istoric (retras_* nu șterge rândul). 20261228a.';

-- Plafonul zilei (spec §7.2, D3): AWB-uri aprobate pe ZI (ora României), pe tot modulul; contorul nu scade; garda și în trigger.
CREATE TABLE public.red_fan_zi (
  zi_ro date PRIMARY KEY,
  aprobate integer NOT NULL DEFAULT 0 CHECK (aprobate >= 0)
);
COMMENT ON TABLE public.red_fan_zi IS 'Redări FAN: AWB-uri aprobate pe zi (Europe/Bucharest), pe tot modulul; sursa parității e red_fan_zi_consum. Scris doar de fn_red_fan_comanda. 20261228a.';
-- Registrul consumului: un rând pe (rând FAN, zi) — un rând re-propus și re-aprobat în aceeași zi nu se numără a doua oară.
CREATE TABLE public.red_fan_zi_consum (
  awb_id uuid NOT NULL REFERENCES public.red_fan_awb(id),
  zi_ro date NOT NULL,
  intentie uuid NOT NULL,
  la timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (awb_id, zi_ro)
);
COMMENT ON TABLE public.red_fan_zi_consum IS 'Redări FAN: registrul consumului plafonului zilei (un rând FAN consumă cel mult o dată pe zi). Paritate: red_fan_zi.aprobate = count(*) pe zi. 20261228a.';

-- Cererile de aprobare peste plafon (Q2 A): TOATĂ trimiterea așteaptă; cel mult o cerere deschisă pe lot.
CREATE TABLE public.red_fan_cereri_aprobare (
  id uuid PRIMARY KEY,
  lot_id uuid NOT NULL REFERENCES public.red_loturi_plicuire(id),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  cerut_de uuid NOT NULL,
  cerut_la timestamptz NOT NULL,
  intentie uuid NOT NULL,                      -- intenția care a cerut aprobarea: rândurile ei aprobat preluabile așteaptă cu ea (Q2 A literal, P14)
  n integer NOT NULL CHECK (n >= 1),
  zi_ro date NOT NULL,
  stare text NOT NULL DEFAULT 'deschisa' CHECK (stare IN ('deschisa', 'aprobata', 'respinsa', 'retrasa')),
  decis_de uuid,
  decis_la timestamptz,
  motiv text CHECK (motiv IS NULL OR length(motiv) <= 500),
  CONSTRAINT red_fan_cereri_aprobare_decizie CHECK ((stare = 'deschisa') = (decis_la IS NULL) AND (decis_de IS NULL) = (decis_la IS NULL))
);
CREATE UNIQUE INDEX red_fan_cereri_aprobare_lot_deschisa_uq ON public.red_fan_cereri_aprobare (lot_id) WHERE stare = 'deschisa';
CREATE INDEX red_fan_cereri_aprobare_lot_ix ON public.red_fan_cereri_aprobare (lot_id, cerut_la);
COMMENT ON TABLE public.red_fan_cereri_aprobare IS 'Redări FAN: cererile de aprobare ale owner-ului când o trimitere depășește plafonul zilei (Q2 A: toată trimiterea așteaptă). O cerere deschisă pe lot. Scris doar prin fn_red_fan_comanda / _cerere_decide / _cerere_retrage. 20261228a.';

-- Intențiile (spec §8.3): cheia UUID a apăsării pe „Trimite” (idempotență, reluare după crash); cel mult o intenție in_curs pe lot.
CREATE TABLE public.red_fan_intentii (
  cheie uuid PRIMARY KEY,
  lot_id uuid NOT NULL REFERENCES public.red_loturi_plicuire(id),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  operator uuid NOT NULL,
  hash_cerere text NOT NULL CHECK (hash_cerere ~ '^[0-9a-f]{64}$'),
  stare text NOT NULL DEFAULT 'in_curs' CHECK (stare IN ('in_curs', 'incheiata', 'neincheiata')),
  lucru_pana_la timestamptz NOT NULL,
  rezultat jsonb,
  inceput_la timestamptz NOT NULL DEFAULT clock_timestamp(),
  incheiata_la timestamptz,
  incheiata_de text CHECK (incheiata_de IS NULL OR incheiata_de IN ('edge', 'reconciliere', 'comanda', 'comanda_noua')),
  CONSTRAINT red_fan_intentii_incheiere CHECK ((stare = 'in_curs') = (incheiata_la IS NULL) AND (incheiata_la IS NULL) = (incheiata_de IS NULL))
);
CREATE UNIQUE INDEX red_fan_intentii_lot_in_curs_uq ON public.red_fan_intentii (lot_id) WHERE stare = 'in_curs';
CREATE INDEX red_fan_intentii_lot_ix ON public.red_fan_intentii (lot_id, inceput_la);
COMMENT ON TABLE public.red_fan_intentii IS 'Redări FAN: intențiile de trimitere (o cheie UUID pe apăsare, din ecran): in_curs (arenda lucru_pana_la), incheiata (rezultatul final cunoscut), neincheiata (preluată de o comandă nouă). Fără date personale. 20261228a.';

ALTER TABLE public.red_fan_operatori ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_fan_zi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_fan_zi_consum ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_fan_cereri_aprobare ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_fan_intentii ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_fan_operatori, public.red_fan_zi, public.red_fan_zi_consum, public.red_fan_cereri_aprobare, public.red_fan_intentii FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.red_fan_operatori, public.red_fan_zi, public.red_fan_zi_consum, public.red_fan_cereri_aprobare, public.red_fan_intentii TO authenticated, service_role;
CREATE POLICY red_fan_operatori_citire ON public.red_fan_operatori FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_fan_zi_citire ON public.red_fan_zi FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_fan_zi_consum_citire ON public.red_fan_zi_consum FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_fan_cereri_aprobare_citire ON public.red_fan_cereri_aprobare FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_fan_intentii_citire ON public.red_fan_intentii FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));

-- ═══ 2. Setările: plafonul zilei, garda „doar TEST” în BD, presupunerea P429 ═══
ALTER TABLE public.red_fan_setari
  ADD COLUMN limita_zi integer NOT NULL DEFAULT 20 CHECK (limita_zi BETWEEN 0 AND 5000),
  ADD COLUMN doar_proiecte_test boolean NOT NULL DEFAULT true,
  ADD COLUMN presupunere_429 boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.red_fan_setari.limita_zi IS 'Plafonul zilei (D3): AWB-uri aprobate pe zi fără aprobarea owner-ului, pe tot modulul; 0 = orice trimitere cere aprobare. Scris doar prin fn_red_fan_setari_limita_zi (owner). 20261228a.';
COMMENT ON COLUMN public.red_fan_setari.doar_proiecte_test IS 'Garda „doar proiecte de TEST” în BD (spec §7.3): cât e true, orice efect FAN cere lot marcat TEST pe un proiect cu codul TEST-… (fn_red_fan_lot_permis). Scris doar prin fn_red_fan_setari_doar_test (owner); cade la F4. 20261228a.';
COMMENT ON COLUMN public.red_fan_setari.presupunere_429 IS 'Presupunerea P429 (spec §8.8): un HTTP 429 FĂRĂ număr AWB în răspuns = nimic creat → rândurile revin aprobat (neincercat). false = același 429 dă necunoscut + reconciliere. Scris de fn_red_fan_setari_presupunere_429 (owner, cu motiv) și, doar spre false, de fn_red_fan_srv_rezultate la un 429 cu AWB. 20261228a.';
COMMENT ON COLUMN public.red_fan_loturi.marcat_de IS 'Cine a marcat lotul: owner (manual, fn_red_fan_lot_marcheaza) sau, de la 20261228a, operatorul a cărui primă trimitere a marcat automat lotul (test = proiectul e TEST-; doar pe TEST cât garda e pornită).';

-- ═══ 3. red_fan_awb: stările noi, legăturile cu intenția / cererea, retragerea, cererea și confirmarea anulării, CHECK-urile derivate din §8.8 ═══
ALTER TABLE public.red_fan_awb
  ADD COLUMN cerere_aprobare_id uuid,
  ADD COLUMN aprobare_owner_la timestamptz,
  ADD COLUMN intentie_cheie uuid,
  ADD COLUMN retras_de uuid,
  ADD COLUMN retras_la timestamptz,
  ADD COLUMN motiv_retragere text CHECK (motiv_retragere IS NULL OR motiv_retragere IN ('plic_mutat', 'plic_anulat', 'lot_tiparit', 'operator', 'owner')),
  ADD COLUMN anulare_ceruta_de uuid,
  ADD COLUMN anulare_ceruta_la timestamptz,
  ADD COLUMN anulare_ceruta_motiv text CHECK (anulare_ceruta_motiv IS NULL OR anulare_ceruta_motiv IN ('netiparit_3_zile', 'neridicat_3_zile', 'plic_retras', 'date_gresite', 'alt_motiv')),
  ADD COLUMN anulare_ceruta_nota text CHECK (anulare_ceruta_nota IS NULL OR length(anulare_ceruta_nota) BETWEEN 1 AND 200),
  ADD COLUMN anulat_de uuid,
  ADD COLUMN anulat_la timestamptz,
  ADD COLUMN motiv_anulare text CHECK (motiv_anulare IS NULL OR motiv_anulare IN ('netiparit_3_zile', 'neridicat_3_zile', 'plic_retras', 'date_gresite', 'alt_motiv')),
  ADD COLUMN anulare_nota text CHECK (anulare_nota IS NULL OR length(anulare_nota) BETWEEN 1 AND 200);
COMMENT ON COLUMN public.red_fan_awb.intentie_cheie IS 'Intenția CURENTĂ a rândului (cea care l-a aprobat / pus de_aprobat, rescrisă la preluare în de_trimis); istoricul consumului de plafon e în red_fan_zi_consum.intentie. 20261228a.';
COMMENT ON COLUMN public.red_fan_awb.cerere_aprobare_id IS 'Cererea de aprobare care a pus rândul de_aprobat (fără FK, ca cerere_id); rămâne ca istoric după decizie. 20261228a.';
-- backfill (L14): rândurile anulat existente primesc confirmarea, ÎNAINTEA CHECK-ului red_fan_awb_anulat și a trigger-ului gărzii. Trigger-ul de
-- jurnal al 20261227a rulează și aici, dar coloanele scrise nu sunt ale ciclului de viață (stare, hash_date, cerere_id, awb, aprobat_la, generat_la,
-- lot_id, plic_id) → iese fără nicio inserare; postcondiția cere ZERO rânduri red_jurnal scrise de această tranzacție.
UPDATE public.red_fan_awb
   SET anulat_la = updated_at, anulat_de = coalesce(aprobat_de, propus_de), motiv_anulare = 'alt_motiv',
       anulare_nota = coalesce(nullif(btrim(left(motiv, 200)), ''), 'anulat inainte de 20261228a')
 WHERE stare = 'anulat';
-- CHECK-urile rescrise textual (inventarul din antet) și cele noi
ALTER TABLE public.red_fan_awb DROP CONSTRAINT red_fan_awb_stare_check;
ALTER TABLE public.red_fan_awb DROP CONSTRAINT red_fan_awb_aprobare;
ALTER TABLE public.red_fan_awb DROP CONSTRAINT red_fan_awb_generat;
ALTER TABLE public.red_fan_awb
  ADD CONSTRAINT red_fan_awb_stare_check CHECK (stare IN ('propus', 'de_aprobat', 'aprobat', 'in_curs', 'generat', 'eroare', 'necunoscut', 'anulat', 'ridicat', 'retras')),
  ADD CONSTRAINT red_fan_awb_aprobare CHECK (stare IN ('propus', 'de_aprobat', 'eroare', 'anulat', 'retras') OR (aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL)),
  ADD CONSTRAINT red_fan_awb_generat CHECK (
    (stare IN ('generat', 'ridicat') AND awb IS NOT NULL AND generat_la IS NOT NULL)
    OR (stare IN ('propus', 'de_aprobat', 'aprobat', 'in_curs', 'eroare', 'necunoscut', 'retras') AND awb IS NULL)
    OR stare = 'anulat'),
  ADD CONSTRAINT red_fan_awb_retras CHECK ((stare = 'retras') = (retras_la IS NOT NULL) AND (retras_de IS NULL) = (retras_la IS NULL) AND (retras_la IS NULL) = (motiv_retragere IS NULL)),
  ADD CONSTRAINT red_fan_awb_anulat CHECK ((stare = 'anulat') = (anulat_la IS NOT NULL)),
  ADD CONSTRAINT red_fan_awb_anulare_cerere CHECK ((anulare_ceruta_de IS NULL) = (anulare_ceruta_la IS NULL) AND (anulare_ceruta_la IS NULL) = (anulare_ceruta_motiv IS NULL)
    AND (anulare_ceruta_nota IS NULL OR anulare_ceruta_motiv IS NOT NULL) AND (anulare_ceruta_motiv IS DISTINCT FROM 'alt_motiv' OR anulare_ceruta_nota IS NOT NULL)),
  ADD CONSTRAINT red_fan_awb_anulare_conf CHECK ((anulat_de IS NULL) = (anulat_la IS NULL) AND (anulat_la IS NULL) = (motiv_anulare IS NULL)
    AND (anulare_nota IS NULL OR motiv_anulare IS NOT NULL) AND (motiv_anulare IS DISTINCT FROM 'alt_motiv' OR anulare_nota IS NOT NULL)),
  ADD CONSTRAINT red_fan_awb_de_aprobat CHECK (stare <> 'de_aprobat' OR cerere_aprobare_id IS NOT NULL);
-- indexul viu: retras exclus (un singur rând viu pe plic rămâne regula)
DROP INDEX public.red_fan_awb_plic_viu_uq;
CREATE UNIQUE INDEX red_fan_awb_plic_viu_uq ON public.red_fan_awb (plic_id) WHERE stare NOT IN ('eroare', 'anulat', 'retras');
CREATE INDEX red_fan_awb_intentie_ix ON public.red_fan_awb (intentie_cheie) WHERE intentie_cheie IS NOT NULL;

-- ═══ 4. Funcțiile interne (fără EXECUTE pentru roluri): predicatele comune (L19) ═══
-- Garda „doar TEST” pe VALORI (pură): chemată de comandă în faza V (pe marcajul pe care l-ar avea rândul) și de fn_red_fan_lot_permis.
CREATE FUNCTION public.fn_red_fan_lot_permis_valori(p_test boolean, p_cod text, p_doar_test boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT NOT coalesce(p_doar_test, true) OR (p_test IS TRUE AND coalesce(p_cod, '') LIKE 'TEST-%');
$fn$;
-- Garda „doar TEST” pe rândul stocat: lot FAN nemarcat = fals (nimic nu are efect fără marcaj). Citită sub lock-urile deja luate.
CREATE FUNCTION public.fn_red_fan_lot_permis(p_lot_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce((SELECT public.fn_red_fan_lot_permis_valori(fl.test, pr.cod, s.doar_proiecte_test)
                     FROM public.red_fan_loturi fl JOIN public.red_loturi_plicuire l ON l.id = fl.lot_id JOIN public.red_proiecte pr ON pr.id = l.proiect_id
                     CROSS JOIN public.red_fan_setari s WHERE fl.lot_id = p_lot_id), false);
$fn$;
-- „Lot încheiat” (spec §8.8, D15): niciun rând de_aprobat / aprobat / in_curs / necunoscut și nicio cerere deschisă; intenția NU intră în definiție.
-- Evaluată SUB lock-ul lotului de fn_red_fan_tiraj (RD031); funcția edge nu o evaluează.
CREATE FUNCTION public.fn_red_fan_lot_incheiat(p_lot_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT NOT EXISTS (SELECT 1 FROM public.red_fan_awb a WHERE a.lot_id = p_lot_id AND a.stare IN ('de_aprobat', 'aprobat', 'in_curs', 'necunoscut'))
     AND NOT EXISTS (SELECT 1 FROM public.red_fan_cereri_aprobare c WHERE c.lot_id = p_lot_id AND c.stare = 'deschisa');
$fn$;
-- Un profil e operator ACTIV: owner, sau (nivel Redări admin / editor ȘI rând nenretras în lista operatorilor). Folosită pentru p_actor (clasa B)
-- și de fn_red_fan_e_operator pentru auth.uid() (aceeași definiție, L19).
CREATE FUNCTION public.fn_red_fan_e_operator_profil(p_profil uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT p_profil IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profil AND p.is_owner IS TRUE)
    OR (EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = p_profil AND u.module = 'redari' AND u.access_level IN ('admin', 'editor'))
        AND EXISTS (SELECT 1 FROM public.red_fan_operatori o WHERE o.profile_id = p_profil AND o.retras_la IS NULL)));
$fn$;
-- Sumarul unei intenții, DERIVAT din rânduri (memo-ul nu e adevăr, spec §8.3): generate, respinse, retrase, ramase (aprobat), necunoscute, de_aprobat, tarif_total.
CREATE FUNCTION public.fn_red_fan_intentie_sumar(p_cheie uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object(
    'generate', count(*) FILTER (WHERE a.stare IN ('generat', 'ridicat')),
    'respinse', count(*) FILTER (WHERE a.stare = 'eroare'),
    'retrase', count(*) FILTER (WHERE a.stare = 'retras'),
    'ramase', count(*) FILTER (WHERE a.stare = 'aprobat'),
    'necunoscute', count(*) FILTER (WHERE a.stare IN ('in_curs', 'necunoscut')),
    'de_aprobat', count(*) FILTER (WHERE a.stare = 'de_aprobat'),
    'tarif_total', sum(a.tarif) FILTER (WHERE a.stare IN ('generat', 'ridicat')))
    FROM public.red_fan_awb a WHERE a.intentie_cheie = p_cheie;
$fn$;
-- Încheierea unei intenții (apelantul ține deja lock-ul ei, poziția 8): sumarul derivat + cheile permise din p_extra; jurnalul îl scrie apelantul.
CREATE FUNCTION public.fn_red_fan_intentie_incheie_intern(p_cheie uuid, p_de text, p_extra jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_rez jsonb;
BEGIN
  v_rez := public.fn_red_fan_intentie_sumar(p_cheie) || coalesce(p_extra, '{}'::jsonb);
  UPDATE public.red_fan_intentii SET stare = 'incheiata', incheiata_de = p_de, incheiata_la = clock_timestamp(), rezultat = v_rez
   WHERE cheie = p_cheie AND stare = 'in_curs';
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: intentia nu mai e in curs' USING ERRCODE = 'RD034'; END IF;
  RETURN v_rez;
END $fn$;

-- ═══ 5. Trigger-ele gărzilor (L07: regula impusă în BD pe orice cale) ═══
-- Plafonul zilei: contorul nu depășește limita și nu scade (o retragere nu restituie plafonul). Nimeni nu are GRANT de scriere pe red_fan_zi.
CREATE FUNCTION public.fn_red_fan_zi_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_limita integer;
BEGIN
  SELECT limita_zi INTO v_limita FROM public.red_fan_setari WHERE id;
  IF v_limita IS NULL THEN RAISE EXCEPTION 'redari fan: setarile lipsesc' USING ERRCODE = 'P0002'; END IF;
  IF NEW.aprobate > v_limita THEN RAISE EXCEPTION 'redari fan: plafonul zilei (%) ar fi depasit (%)', v_limita, NEW.aprobate USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.aprobate < OLD.aprobate OR NEW.zi_ro IS DISTINCT FROM OLD.zi_ro) THEN
    RAISE EXCEPTION 'redari fan: contorul zilei nu scade si nu se muta' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_red_fan_zi_garda BEFORE INSERT OR UPDATE ON public.red_fan_zi FOR EACH ROW EXECUTE FUNCTION public.fn_red_fan_zi_garda();

-- Garda rândului FAN (spec §8.4.1, L07 / L08): TREI liste de coloane, fiecare scrisă DOAR din funcțiile numite, identificate prin marcajul de
-- tranzacție `redari_fan.garda = '<functie>'` pus de funcția DEFINER cu instrucțiunea STATICĂ `SET LOCAL redari_fan.garda = '<functie>'`
-- imediat înaintea SINGURULUI ei UPDATE pe rândul blocat (WHERE id = rândul) și golit (`SET LOCAL … = ''`) imediat după (nu current_user, nu
-- pg_trigger_depth). Runda 4 (proba pe clonă): marcajul nu mai e scris cu funcția de configurare: poarta 0e a runnerului refuză orice funcție
-- expusă care o cheamă, iar poarta Izometrie E2 socotește corpul care o cheamă „mutator de cale” și trigger-ul care le numește „invocare
-- implicită”. Forma statică e precedentul 20261130l (fără clauză SET pe funcție: pe Supabase cere superuser); valoarea nu mai poartă id-ul
-- rândului (o instrucțiune statică nu-l poate primi), legătura cu rândul o dă UPDATE-ul unic dintre cele două instrucțiuni; postcondiția verifică
-- că marcajul e scris DOAR de cele 7 funcții de pe liste. (a) cererea de anulare: punerea (toate împreună) doar din fn_red_fan_anulare_cere, golirea (toate împreună)
-- doar din fn_red_fan_srv_anuleaza; ORICE altă schimbare (alt motiv / altă notă cât cererea e deschisă, parțial, altă funcție) = 42501.
-- (b) confirmarea (anulat_de, anulat_la, motiv_anulare, anulare_nota) + trecerea stare → anulat: toate odată, doar din fn_red_fan_srv_anuleaza /
-- fn_red_fan_anulat; imuabile după scriere. fn_red_fan_anulare_cere NU e pe lista (b): nu poate fabrica `anulat`. (c) retras_* + stare → retras:
-- doar din fn_red_fan_comanda / _retrage / _cerere_decide / _srv_claim; imuabile după scriere. UPDATE-ul direct cade oricum la 42501 (fără GRANT).
CREATE FUNCTION public.fn_red_fan_awb_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_fn text := coalesce(current_setting('redari_fan.garda', true), '');
BEGIN
  -- (a) cererea de anulare
  IF NEW.anulare_ceruta_de IS DISTINCT FROM OLD.anulare_ceruta_de OR NEW.anulare_ceruta_la IS DISTINCT FROM OLD.anulare_ceruta_la
     OR NEW.anulare_ceruta_motiv IS DISTINCT FROM OLD.anulare_ceruta_motiv OR NEW.anulare_ceruta_nota IS DISTINCT FROM OLD.anulare_ceruta_nota THEN
    IF NOT ((v_fn = 'fn_red_fan_anulare_cere' AND OLD.anulare_ceruta_la IS NULL AND NEW.anulare_ceruta_la IS NOT NULL AND NEW.anulare_ceruta_de IS NOT NULL AND NEW.anulare_ceruta_motiv IS NOT NULL)
         OR (v_fn = 'fn_red_fan_srv_anuleaza' AND OLD.anulare_ceruta_la IS NOT NULL AND NEW.anulare_ceruta_la IS NULL AND NEW.anulare_ceruta_de IS NULL
             AND NEW.anulare_ceruta_motiv IS NULL AND NEW.anulare_ceruta_nota IS NULL)) THEN
      RAISE EXCEPTION 'redari fan: schimbarea neautorizata a cererii de anulare e refuzata' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- (b) confirmarea anulării și trecerea la anulat
  IF NEW.anulat_de IS DISTINCT FROM OLD.anulat_de OR NEW.anulat_la IS DISTINCT FROM OLD.anulat_la OR NEW.motiv_anulare IS DISTINCT FROM OLD.motiv_anulare
     OR NEW.anulare_nota IS DISTINCT FROM OLD.anulare_nota OR (NEW.stare = 'anulat' AND OLD.stare <> 'anulat') THEN
    IF OLD.anulat_la IS NOT NULL THEN RAISE EXCEPTION 'redari fan: confirmarea anularii e imuabila' USING ERRCODE = '42501'; END IF;
    IF v_fn NOT IN ('fn_red_fan_srv_anuleaza', 'fn_red_fan_anulat') OR NEW.stare <> 'anulat' OR NEW.anulat_de IS NULL OR NEW.anulat_la IS NULL OR NEW.motiv_anulare IS NULL THEN
      RAISE EXCEPTION 'redari fan: anularea se inscrie doar de server sau de owner, toata odata' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- (c) retragerea
  IF NEW.retras_de IS DISTINCT FROM OLD.retras_de OR NEW.retras_la IS DISTINCT FROM OLD.retras_la OR NEW.motiv_retragere IS DISTINCT FROM OLD.motiv_retragere
     OR (NEW.stare = 'retras' AND OLD.stare <> 'retras') THEN
    IF OLD.retras_la IS NOT NULL THEN RAISE EXCEPTION 'redari fan: retragerea e imuabila' USING ERRCODE = '42501'; END IF;
    IF v_fn NOT IN ('fn_red_fan_comanda', 'fn_red_fan_retrage', 'fn_red_fan_cerere_decide', 'fn_red_fan_srv_claim') OR NEW.stare <> 'retras'
       OR NEW.retras_de IS NULL OR NEW.retras_la IS NULL OR NEW.motiv_retragere IS NULL THEN
      RAISE EXCEPTION 'redari fan: retragerea se scrie doar din comanda, retragere, decizie sau rezervare, toata odata' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_red_fan_awb_garda BEFORE UPDATE ON public.red_fan_awb FOR EACH ROW EXECUTE FUNCTION public.fn_red_fan_awb_garda();

-- ═══ 6. Clasa A — comenzile omului (EXECUTE authenticated; identitatea = auth.uid(), L08) ═══
-- Poarta operatorului (spec §7.1): o SINGURĂ definiție (L19) pentru RPC-uri, funcția edge (deps.operator) și ecran.
CREATE FUNCTION public.fn_red_fan_e_operator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.fn_red_fan_e_owner()
      OR (auth.uid() IS NOT NULL AND coalesce(public.fn_red_nivel(), '') IN ('admin', 'editor')
          AND EXISTS (SELECT 1 FROM public.red_fan_operatori o WHERE o.profile_id = auth.uid() AND o.retras_la IS NULL));
$fn$;

-- Lista operatorilor (DOAR owner): numire / retragere; profilul trebuie să existe și să aibă nivel Redări admin / editor (sau owner); fiecare
-- schimbare = rând în red_jurnal. Retragerea NU șterge rândul (istoric); re-numirea golește retras_*. Lock: rândul listei FOR UPDATE → jurnal.
CREATE FUNCTION public.fn_red_fan_operator_seteaza(p_profile uuid, p_activ boolean, p_nota text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_vechi record; v_nota text := nullif(btrim(coalesce(p_nota, '')), ''); v_now timestamptz; v_nivel text;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul administreaza operatorii' USING ERRCODE = '42501'; END IF;
  IF p_profile IS NULL OR p_activ IS NULL OR (v_nota IS NOT NULL AND length(v_nota) > 200) THEN RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile) THEN RAISE EXCEPTION 'redari fan: profil inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile AND is_owner IS TRUE) THEN 'admin'
              ELSE (SELECT u.access_level FROM public.user_module_access u WHERE u.profile_id = p_profile AND u.module = 'redari') END INTO v_nivel;
  IF p_activ AND coalesce(v_nivel, '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari fan: operatorul trebuie sa aiba nivel Redari admin / editor (precoditie, nu se acorda de aici)' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_vechi FROM public.red_fan_operatori WHERE profile_id = p_profile FOR UPDATE;
  v_now := clock_timestamp();
  IF v_vechi.profile_id IS NULL THEN
    IF NOT p_activ THEN RAISE EXCEPTION 'redari fan: profilul nu e in lista operatorilor' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.red_fan_operatori (profile_id, numit_de, numit_la, nota) VALUES (p_profile, auth.uid(), v_now, v_nota);
  ELSIF p_activ THEN
    IF v_vechi.retras_la IS NULL THEN RETURN jsonb_build_object('profile_id', p_profile, 'activ', true, 'schimbat', false); END IF;
    UPDATE public.red_fan_operatori SET numit_de = auth.uid(), numit_la = v_now, retras_de = NULL, retras_la = NULL, nota = coalesce(v_nota, nota) WHERE profile_id = p_profile;
  ELSE
    IF v_vechi.retras_la IS NOT NULL THEN RETURN jsonb_build_object('profile_id', p_profile, 'activ', false, 'schimbat', false); END IF;
    UPDATE public.red_fan_operatori SET retras_de = auth.uid(), retras_la = v_now, nota = coalesce(v_nota, nota) WHERE profile_id = p_profile;
  END IF;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_operatori', p_profile, CASE WHEN v_vechi.profile_id IS NULL THEN 'insert' ELSE 'update' END,
          CASE WHEN v_vechi.profile_id IS NULL THEN NULL ELSE jsonb_build_object('activ', v_vechi.retras_la IS NULL, 'retras_la', v_vechi.retras_la) END,
          jsonb_build_object('eveniment', CASE WHEN p_activ THEN 'operator_numit' ELSE 'operator_retras' END, 'profile_id', p_profile, 'nota', v_nota, 'la', v_now), auth.uid());
  RETURN jsonb_build_object('profile_id', p_profile, 'activ', p_activ, 'schimbat', true);
END $fn$;

-- Setările noi (DOAR owner), câte un RPC pe setare (fără supraîncărcare pe nume, PostgREST ar alege ambiguu); semnătura veche
-- fn_red_fan_setari_seteaza(integer) rămâne neschimbată. Lock: red_fan_setari FOR UPDATE (poziția 5) → jurnal.
CREATE FUNCTION public.fn_red_fan_setari_limita_zi(p_limita integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_vechi integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul schimba setarile' USING ERRCODE = '42501'; END IF;
  IF p_limita IS NULL OR p_limita < 0 OR p_limita > 5000 THEN RAISE EXCEPTION 'redari fan: plafonul zilei invalid (0..5000)' USING ERRCODE = '22023'; END IF;
  SELECT limita_zi INTO v_vechi FROM public.red_fan_setari WHERE id FOR UPDATE;
  IF v_vechi IS NULL THEN RAISE EXCEPTION 'redari fan: randul de setari lipseste' USING ERRCODE = 'P0002'; END IF;
  IF v_vechi = p_limita THEN RETURN p_limita; END IF;
  UPDATE public.red_fan_setari SET limita_zi = p_limita, actualizat_de = auth.uid(), actualizat_la = now() WHERE id;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_setari', NULL, 'update', jsonb_build_object('limita_zi', v_vechi), jsonb_build_object('eveniment', 'setari_limita_zi', 'limita_zi', p_limita), auth.uid());
  RETURN p_limita;
END $fn$;
CREATE FUNCTION public.fn_red_fan_setari_doar_test(p_activ boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_vechi boolean;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul schimba setarile' USING ERRCODE = '42501'; END IF;
  IF p_activ IS NULL THEN RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT doar_proiecte_test INTO v_vechi FROM public.red_fan_setari WHERE id FOR UPDATE;
  IF v_vechi IS NULL THEN RAISE EXCEPTION 'redari fan: randul de setari lipseste' USING ERRCODE = 'P0002'; END IF;
  IF v_vechi = p_activ THEN RETURN p_activ; END IF;
  UPDATE public.red_fan_setari SET doar_proiecte_test = p_activ, actualizat_de = auth.uid(), actualizat_la = now() WHERE id;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_setari', NULL, 'update', jsonb_build_object('doar_proiecte_test', v_vechi), jsonb_build_object('eveniment', 'setari_doar_test', 'doar_proiecte_test', p_activ), auth.uid());
  RETURN p_activ;
END $fn$;
-- Presupunerea P429 (owner, ambele sensuri, cu motiv ≤ 200: răspunsul scris al curierului sau dovada); serverul o pune false singur la un 429 cu AWB.
CREATE FUNCTION public.fn_red_fan_setari_presupunere_429(p_valida boolean, p_motiv text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_vechi boolean; v_motiv text := btrim(coalesce(p_motiv, ''));
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul schimba setarile' USING ERRCODE = '42501'; END IF;
  IF p_valida IS NULL OR v_motiv !~ '[^[:space:]]' OR length(v_motiv) > 200 THEN RAISE EXCEPTION 'redari fan: presupunerea P429 cere valoarea si motivul (1..200)' USING ERRCODE = '22023'; END IF;
  SELECT presupunere_429 INTO v_vechi FROM public.red_fan_setari WHERE id FOR UPDATE;
  IF v_vechi IS NULL THEN RAISE EXCEPTION 'redari fan: randul de setari lipseste' USING ERRCODE = 'P0002'; END IF;
  IF v_vechi = p_valida THEN RETURN p_valida; END IF;
  UPDATE public.red_fan_setari SET presupunere_429 = p_valida, actualizat_de = auth.uid(), actualizat_la = now() WHERE id;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_setari', NULL, 'update', jsonb_build_object('presupunere_429', v_vechi),
          jsonb_build_object('eveniment', 'presupunere_429_schimbata', 'presupunere_429', p_valida, 'motiv', v_motiv, 'la', clock_timestamp()), auth.uid());
  RETURN p_valida;
END $fn$;

-- „Retrage din trimitere” (spec §8.8): propus / aprobat → retras (operator: motiv 'operator'; owner: 'operator' sau 'owner'); plafonul consumat
-- nu se restituie. Lock (§6.2): 2 plic FOR UPDATE → 3 rândul FOR UPDATE → 11 jurnal.
CREATE FUNCTION public.fn_red_fan_retrage(p_id uuid, p_motiv_cod text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid; v_r record; v_now timestamptz;
BEGIN
  IF NOT public.fn_red_fan_e_operator() THEN RAISE EXCEPTION 'redari fan: doar operatorii numiti sau owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_motiv_cod IS NULL OR p_motiv_cod NOT IN ('operator', 'owner') OR (p_motiv_cod = 'owner' AND NOT public.fn_red_fan_e_owner()) THEN
    RAISE EXCEPTION 'redari fan: parametri invalizi (motivul: operator / owner)' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  SELECT id, stare, lot_id, nr_plic INTO v_r FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  IF v_r.stare NOT IN ('propus', 'aprobat') THEN RAISE EXCEPTION 'redari fan: doar un rand propus sau aprobat se retrage (stare %)', v_r.stare USING ERRCODE = 'P0001'; END IF;
  v_now := clock_timestamp();
  SET LOCAL redari_fan.garda = 'fn_red_fan_retrage';
  UPDATE public.red_fan_awb SET stare = 'retras', retras_de = auth.uid(), retras_la = v_now, motiv_retragere = p_motiv_cod, updated_at = v_now WHERE id = p_id;
  SET LOCAL redari_fan.garda = '';
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_awb', p_id, 'update', jsonb_build_object('stare', v_r.stare), jsonb_build_object('eveniment', 'retragere', 'motiv', p_motiv_cod, 'lot_id', v_r.lot_id, 'la', v_now), auth.uid());
  RETURN 'retras';
END $fn$;

-- Decizia owner-ului pe o cerere de aprobare (spec §7.2): aprobă (fără consum de plafon; aprobare_owner_la) sau respinge (rândurile → propus).
-- Lock (§6.2): 1 lot → 2 plicurile rândurilor → 3 rândurile → 4 red_fan_loturi → 7 cererea → 11 jurnal. Un rând al cărui plic nu mai e activ / în lot → retras.
CREATE FUNCTION public.fn_red_fan_cerere_decide(p_id uuid, p_aproba boolean, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_c record; v_motiv text := nullif(btrim(coalesce(p_motiv, '')), ''); v_now timestamptz; r record; v_aprobate integer := 0; v_retrase integer := 0; v_propuse integer := 0;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul decide cererile' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_aproba IS NULL OR (v_motiv IS NOT NULL AND length(v_motiv) > 500) OR (NOT p_aproba AND v_motiv IS NULL) THEN
    RAISE EXCEPTION 'redari fan: parametri invalizi (respingerea cere motivul, <= 500)' USING ERRCODE = '22023'; END IF;
  SELECT lot_id INTO v_c FROM public.red_fan_cereri_aprobare WHERE id = p_id;
  IF v_c.lot_id IS NULL THEN RAISE EXCEPTION 'redari fan: cerere inexistenta' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = v_c.lot_id FOR UPDATE;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE cerere_aprobare_id = p_id AND stare = 'de_aprobat') ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE cerere_aprobare_id = p_id AND stare = 'de_aprobat' ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_loturi WHERE lot_id = v_c.lot_id FOR UPDATE;
  SELECT * INTO v_c FROM public.red_fan_cereri_aprobare WHERE id = p_id FOR UPDATE;
  IF v_c.stare <> 'deschisa' THEN RAISE EXCEPTION 'redari fan: cererea nu mai e deschisa (%)', v_c.stare USING ERRCODE = 'P0001'; END IF;
  IF p_aproba AND NOT public.fn_red_fan_lot_permis(v_c.lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  v_now := clock_timestamp();
  FOR r IN SELECT a.id, a.plic_id, pl.stare AS plic_stare, pl.lot_id AS plic_lot, pl.awb AS plic_awb, pl.data_expediere
             FROM public.red_fan_awb a LEFT JOIN public.red_plicuri pl ON pl.id = a.plic_id
            WHERE a.cerere_aprobare_id = p_id AND a.stare = 'de_aprobat' ORDER BY a.id LOOP
    IF r.plic_stare IS DISTINCT FROM 'activ' OR r.plic_lot IS DISTINCT FROM v_c.lot_id OR r.plic_awb IS NOT NULL OR r.data_expediere IS NOT NULL THEN
      SET LOCAL redari_fan.garda = 'fn_red_fan_cerere_decide';
      UPDATE public.red_fan_awb SET stare = 'retras', retras_de = auth.uid(), retras_la = v_now, updated_at = v_now,
             motiv_retragere = CASE WHEN r.plic_stare IS DISTINCT FROM 'activ' OR r.plic_awb IS NOT NULL OR r.data_expediere IS NOT NULL THEN 'plic_anulat' ELSE 'plic_mutat' END WHERE id = r.id;
      SET LOCAL redari_fan.garda = '';
      v_retrase := v_retrase + 1;
    ELSIF p_aproba THEN
      UPDATE public.red_fan_awb SET stare = 'aprobat', aprobat_de = auth.uid(), aprobat_la = v_now, aprobare_owner_la = v_now, updated_at = v_now WHERE id = r.id;
      v_aprobate := v_aprobate + 1;
    ELSE
      UPDATE public.red_fan_awb SET stare = 'propus', aprobat_de = NULL, aprobat_la = NULL, updated_at = v_now WHERE id = r.id;
      v_propuse := v_propuse + 1;
    END IF;
  END LOOP;
  IF p_aproba AND v_aprobate > 0 THEN
    UPDATE public.red_fan_loturi SET prima_aprobare_la = v_now, prima_aprobare_de = auth.uid() WHERE lot_id = v_c.lot_id AND prima_aprobare_la IS NULL;
  END IF;
  UPDATE public.red_fan_cereri_aprobare SET stare = CASE WHEN p_aproba THEN 'aprobata' ELSE 'respinsa' END, decis_de = auth.uid(), decis_la = v_now, motiv = v_motiv WHERE id = p_id;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_cereri_aprobare', p_id, 'update', jsonb_build_object('stare', 'deschisa', 'n', v_c.n),
          jsonb_build_object('eveniment', 'cerere_decisa', 'aproba', p_aproba, 'lot_id', v_c.lot_id, 'aprobate', v_aprobate, 'propuse', v_propuse, 'retrase', v_retrase, 'motiv', v_motiv, 'la', v_now), auth.uid());
  RETURN jsonb_build_object('id', p_id, 'stare', CASE WHEN p_aproba THEN 'aprobata' ELSE 'respinsa' END, 'aprobate', v_aprobate, 'propuse', v_propuse, 'retrase', v_retrase);
END $fn$;

-- Retragerea cererii de către operatorul care a cerut-o (sau owner): deschisa → retrasa, rândurile → propus. Aceeași ordine de lock.
CREATE FUNCTION public.fn_red_fan_cerere_retrage(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_c record; v_now timestamptz; v_n integer;
BEGIN
  IF NOT public.fn_red_fan_e_operator() THEN RAISE EXCEPTION 'redari fan: doar operatorii numiti sau owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT lot_id, cerut_de INTO v_c FROM public.red_fan_cereri_aprobare WHERE id = p_id;
  IF v_c.lot_id IS NULL THEN RAISE EXCEPTION 'redari fan: cerere inexistenta' USING ERRCODE = 'P0002'; END IF;
  IF v_c.cerut_de IS DISTINCT FROM auth.uid() AND NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar cel care a cerut sau owner-ul retrage cererea' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = v_c.lot_id FOR UPDATE;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE cerere_aprobare_id = p_id AND stare = 'de_aprobat') ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE cerere_aprobare_id = p_id AND stare = 'de_aprobat' ORDER BY id FOR UPDATE;
  SELECT * INTO v_c FROM public.red_fan_cereri_aprobare WHERE id = p_id FOR UPDATE;
  IF v_c.stare <> 'deschisa' THEN RAISE EXCEPTION 'redari fan: cererea nu mai e deschisa (%)', v_c.stare USING ERRCODE = 'P0001'; END IF;
  v_now := clock_timestamp();
  UPDATE public.red_fan_awb SET stare = 'propus', aprobat_de = NULL, aprobat_la = NULL, updated_at = v_now WHERE cerere_aprobare_id = p_id AND stare = 'de_aprobat';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.red_fan_cereri_aprobare SET stare = 'retrasa', decis_de = auth.uid(), decis_la = v_now WHERE id = p_id;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_cereri_aprobare', p_id, 'update', jsonb_build_object('stare', 'deschisa', 'n', v_c.n),
          jsonb_build_object('eveniment', 'cerere_retrasa', 'lot_id', v_c.lot_id, 'propuse', v_n, 'la', v_now), auth.uid());
  RETURN jsonb_build_object('id', p_id, 'stare', 'retrasa', 'propuse', v_n);
END $fn$;

-- Cererea de anulare (spec §8.4.1 pasul 1): scrie DOAR coloanele cererii; stare rămâne generat; confirmarea rămâne NULL; RD035 dacă e deja cerută.
-- Lock (§6.2): 2 plic → 3 rândul → 11 jurnal. Trece de trigger prin marcajul 'fn_red_fan_anulare_cere:<id>' (lista (a)); nu e pe lista (b).
CREATE FUNCTION public.fn_red_fan_anulare_cere(p_id uuid, p_awb text, p_motiv_cod text, p_nota text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid; v_r record; v_nota text := nullif(btrim(coalesce(p_nota, '')), ''); v_now timestamptz;
BEGIN
  IF NOT public.fn_red_fan_e_operator() THEN RAISE EXCEPTION 'redari fan: doar operatorii numiti sau owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_awb IS NULL OR p_awb !~ '^[0-9]{6,20}$'
     OR p_motiv_cod IS NULL OR p_motiv_cod NOT IN ('netiparit_3_zile', 'neridicat_3_zile', 'plic_retras', 'date_gresite', 'alt_motiv')
     OR (v_nota IS NOT NULL AND length(v_nota) > 200) OR (p_motiv_cod = 'alt_motiv' AND v_nota IS NULL) THEN
    RAISE EXCEPTION 'redari fan: cerere de anulare invalida (AWB, motiv din lista, nota <= 200 obligatorie la alt_motiv)' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  SELECT id, stare, awb, lot_id, ridicat_la, ridicat_contrazis, anulare_ceruta_la INTO v_r FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  IF NOT public.fn_red_fan_lot_permis(v_r.lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  IF v_r.anulare_ceruta_la IS NOT NULL THEN RAISE EXCEPTION 'redari fan: anularea AWB-ului e deja in curs; asteapta raspunsul curierului' USING ERRCODE = 'RD035'; END IF;
  IF v_r.stare <> 'generat' OR v_r.awb IS DISTINCT FROM p_awb OR v_r.ridicat_la IS NOT NULL OR v_r.ridicat_contrazis IS NOT NULL THEN
    RAISE EXCEPTION 'redari fan: doar un AWB generat, neridicat, cu acelasi numar se poate anula (CAS)' USING ERRCODE = 'P0001'; END IF;
  v_now := clock_timestamp();
  SET LOCAL redari_fan.garda = 'fn_red_fan_anulare_cere';
  UPDATE public.red_fan_awb SET anulare_ceruta_de = auth.uid(), anulare_ceruta_la = v_now, anulare_ceruta_motiv = p_motiv_cod, anulare_ceruta_nota = v_nota, updated_at = v_now WHERE id = p_id;
  SET LOCAL redari_fan.garda = '';
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_awb', p_id, 'update', jsonb_build_object('stare', 'generat'), jsonb_build_object('eveniment', 'anulare_ceruta', 'motiv', p_motiv_cod, 'lot_id', v_r.lot_id, 'la', v_now), auth.uid());
  RETURN 'ceruta';
END $fn$;

-- ═══ 7. Butonul unic: fn_red_fan_comanda (clasa A, spec §8.1 — într-O tranzacție, în TREI faze) ═══
-- p_plicuri = [{plic_id, hash}] (hash-ul corpului calculat de funcția edge din citirile ei); p_hash_cerere = sha256 pe lista canonică a plicurilor
-- (idempotență, L04); p_intentie = cheia UUID a apăsării (registrul local al ecranului, L05 în UI); p_opod = alegerea oPOD cu care funcția edge a
-- calculat TOATE hash-urile din p_plicuri (redariFan.mjs::configPlicFan: options ['B'] doar la true) — comparată în faza V cu alegerea lotului
-- (rândul red_fan_loturi blocat la (4); lot nemarcat = false, implicitul coloanei pentru marcajul automat): alta = RD038, nimic scris (L03:
-- aprobările se scriu doar pe hash-uri calculate cu alegerea pe care lotul o are sub lock; după prima aprobare ea e înghețată de garda 20261227a).
-- Identitatea (fn_red_fan_e_operator, 42501) și FORMA payloadului (22023) se refuză ÎNAINTEA fazei L (nu au nevoie de rânduri blocate; nicio scriere).
-- Faza L — lock-urile pe rândurile EXISTENTE, fără nicio scriere, în ordinea §6.2:
--   (1) lotul FOR UPDATE; (2) plicurile cerute ORDER BY id FOR UPDATE; (3) ÎNTR-UN SINGUR SELECT … ORDER BY id FOR UPDATE: rândurile FAN vii ale
--   lotului ȘI rândurile FAN vii ale plicurilor cerute rămase pe ALT lot (plic mutat după propunere / aprobare — E22); (4) red_fan_loturi dacă
--   există; (5) red_fan_setari; (6) rândul zilei dacă există; (7) cererea deschisă a lotului dacă există; (8) intenția cu cheia primită și
--   intenția in_curs a lotului, dacă există.
-- Faza V — verificările, fără nicio scriere (refuz = RAISE, replay = RETURN): contractul cheii (22023 / replay / RD030 / reluare / RD034 /
--   preluare; RD033 peste un rând in_curs / necunoscut al intenției vechi); alegerea oPOD (RD038); garda „doar TEST” pe VALORILE pe care le-ar avea rândul (RD032);
--   lotul tipărit (Q5 A: exclus lot_tiparit + de retras); clasificarea fiecărui plic cerut → A (de aprobat acum) și N ⊆ A (de numărat: fără consum
--   pe azi); rândurile lotului de retras (plic anulat / mutat); plafonul pe lot (P0001); decizia plafonului zilei o SINGURĂ dată
--   (v_peste := v_n > 0 AND v_acum + v_n > limita; RD037 dacă v_peste și există cerere deschisă); de_trimis := A ∪ „deja aprobat” sau ∅ (Q2 A literal).
-- Faza M — mutațiile, fără niciun lock disputabil nou: (4) marcajul automat ÎNTÂI (rândul nou al lotului, ca primul eveniment de jurnal 20261227a
--   să vadă opod = false, nu NULL — runda 4); (3) retrageri (marcaj pe rând), rânduri noi, refolosiri, aprobări pe
--   TOT A sau de_aprobat pe tot A, intentie_cheie pe de_trimis; (4) prima aprobare + postcondiția fn_red_fan_lot_permis;
--   (6) contorul zilei + registrul consumului DOAR pentru N și DOAR sub plafon, cu postcondiție; (7) cererea (doar peste plafon); (8) intenția
--   (preluare = cea veche neincheiata; cheie nouă = INSERT … ON CONFLICT DO NOTHING; reluare = arenda reînnoită; de_trimis gol = încheiată de RPC);
--   (11) jurnalul, ULTIMUL. Răspunsul = ce s-a făcut EFECTIV (condiția P2-1 a recenzentului): aprobate = rândurile puse aprobat în ACEASTĂ comandă
--   (zero pe ramura peste plafon), numarate = consumul efectiv (zero peste plafon).
CREATE FUNCTION public.fn_red_fan_comanda(p_lot_id uuid, p_intentie uuid, p_plicuri jsonb, p_hash_cerere text, p_opod boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_owner boolean; v_lot record; v_cod text; v_fl record; v_set record; v_azi date; v_acum integer; v_cer record;
  v_int record; v_int_lot record; v_mod text := 'noua'; v_test boolean; v_tiparit boolean; v_ids uuid[]; v_now timestamptz; v_cl jsonb; r record;
  v_a uuid[] := '{}'; v_n uuid[] := '{}'; v_trimis uuid[] := '{}'; v_deja uuid[] := '{}'; v_noi integer := 0; v_pe_lot integer;
  v_excluse jsonb := '[]'; v_retrase jsonb := '[]'; v_de_retras jsonb := '[]'; v_peste boolean; v_cerere uuid; v_dupa integer; v_cheie_veche uuid;
  v_id uuid; v_marcaj boolean := false; v_incheiata boolean := false; v_rez jsonb; v_n_cnt integer; v_noi_randuri integer := 0; v_prima boolean := false;
  v_lucru interval := interval '10 minutes';
BEGIN
  -- identitatea și forma payloadului: refuz fără lock-uri, nicio scriere
  IF NOT public.fn_red_fan_e_operator() THEN RAISE EXCEPTION 'redari fan: doar operatorii numiti de owner sau owner-ul trimit la curier' USING ERRCODE = '42501'; END IF;
  v_owner := public.fn_red_fan_e_owner();
  IF p_lot_id IS NULL OR p_intentie IS NULL OR p_hash_cerere IS NULL OR p_hash_cerere !~ '^[0-9a-f]{64}$' OR p_opod IS NULL
     OR p_plicuri IS NULL OR jsonb_typeof(p_plicuri) <> 'array' OR jsonb_array_length(p_plicuri) NOT BETWEEN 1 AND 2000
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_plicuri) e WHERE jsonb_typeof(e) <> 'object' OR (e ->> 'plic_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR (e ->> 'hash') !~ '^[0-9a-f]{64}$')
     OR (SELECT count(DISTINCT e ->> 'plic_id') FROM jsonb_array_elements(p_plicuri) e) <> jsonb_array_length(p_plicuri) THEN
    RAISE EXCEPTION 'redari fan: cerere invalida (lot, intentie, hash, alegerea oPOD si 1..2000 plicuri distincte cu hash)' USING ERRCODE = '22023'; END IF;
  SELECT array_agg(x ORDER BY x) INTO v_ids FROM (SELECT (e ->> 'plic_id')::uuid AS x FROM jsonb_array_elements(p_plicuri) e) s;
  -- ── Faza L ──
  SELECT id, proiect_id INTO v_lot FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;                                        -- (1)
  IF v_lot.id IS NULL THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT cod INTO v_cod FROM public.red_proiecte WHERE id = v_lot.proiect_id;
  PERFORM 1 FROM public.red_plicuri WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;                                                          -- (2)
  PERFORM 1 FROM public.red_fan_awb WHERE stare NOT IN ('eroare', 'anulat', 'retras') AND (lot_id = p_lot_id OR plic_id = ANY (v_ids)) ORDER BY id FOR UPDATE;   -- (3)
  SELECT lot_id, test, tiraj_cheie, prima_aprobare_la, opod INTO v_fl FROM public.red_fan_loturi WHERE lot_id = p_lot_id FOR UPDATE;       -- (4)
  SELECT limita_zi, limita_lot, doar_proiecte_test INTO v_set FROM public.red_fan_setari WHERE id FOR UPDATE;                               -- (5)
  IF v_set.limita_zi IS NULL THEN RAISE EXCEPTION 'redari fan: setarile lipsesc' USING ERRCODE = 'P0002'; END IF;
  v_azi := (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date;
  SELECT aprobate INTO v_acum FROM public.red_fan_zi WHERE zi_ro = v_azi FOR UPDATE;                                                        -- (6)
  v_acum := coalesce(v_acum, 0);   -- zi absentă = 0, explicit
  SELECT id, stare, intentie INTO v_cer FROM public.red_fan_cereri_aprobare WHERE lot_id = p_lot_id AND stare = 'deschisa' FOR UPDATE;     -- (7)
  SELECT * INTO v_int FROM public.red_fan_intentii WHERE cheie = p_intentie FOR UPDATE;                                                     -- (8)
  SELECT * INTO v_int_lot FROM public.red_fan_intentii WHERE lot_id = p_lot_id AND stare = 'in_curs' AND cheie <> p_intentie FOR UPDATE;
  -- ── Faza V ──
  v_now := clock_timestamp();
  IF v_int.cheie IS NOT NULL THEN
    IF v_int.lot_id <> p_lot_id OR v_int.hash_cerere <> p_hash_cerere OR (v_int.operator <> v_uid AND NOT v_owner) THEN
      RAISE EXCEPTION 'redari fan: cerere corupta (cheia intentiei apartine altei trimiteri)' USING ERRCODE = '22023'; END IF;
    IF v_int.stare = 'incheiata' THEN
      RETURN jsonb_build_object('intentie', p_intentie, 'replay', true, 'mod', 'replay', 'stare', 'incheiata', 'incheiata', true, 'rezultat', v_int.rezultat, 'incheiata_la', v_int.incheiata_la);
    END IF;
    IF v_int.stare = 'neincheiata' THEN RAISE EXCEPTION 'redari fan: trimiterea anterioara a fost inchisa; apasa din nou Trimite' USING ERRCODE = 'RD034'; END IF;
    IF v_int.lucru_pana_la > v_now THEN
      RAISE EXCEPTION 'redari fan: trimiterea e in curs (alt tab sau inca ruleaza); asteapta pana la %', to_char(v_int.lucru_pana_la AT TIME ZONE 'Europe/Bucharest', 'HH24:MI') USING ERRCODE = 'RD030'; END IF;
    v_mod := 'reluare'; v_cheie_veche := p_intentie;
  ELSIF v_int_lot.cheie IS NOT NULL THEN
    IF v_int_lot.lucru_pana_la > v_now THEN
      RAISE EXCEPTION 'redari fan: trimiterea e in curs (alt tab sau inca ruleaza); asteapta pana la %', to_char(v_int_lot.lucru_pana_la AT TIME ZONE 'Europe/Bucharest', 'HH24:MI') USING ERRCODE = 'RD030'; END IF;
    v_mod := 'preluare'; v_cheie_veche := v_int_lot.cheie;
  END IF;
  IF v_cheie_veche IS NOT NULL AND EXISTS (SELECT 1 FROM public.red_fan_awb WHERE intentie_cheie = v_cheie_veche AND stare IN ('in_curs', 'necunoscut')) THEN
    RAISE EXCEPTION 'redari fan: % plicuri au rezultatul neconfirmat; intai Verifica la curier',
      (SELECT count(*) FROM public.red_fan_awb WHERE intentie_cheie = v_cheie_veche AND stare IN ('in_curs', 'necunoscut')) USING ERRCODE = 'RD033'; END IF;
  -- alegerea oPOD (20261227a): hash-urile primite au fost calculate cu p_opod; lotul o are pe a lui sub lock (4); lot nemarcat = false (implicitul
  -- coloanei, pe care îl primește marcajul automat din faza M). Alta = refuz, nimic scris (L03); ecranul / funcția edge recitesc lotul și reapasă.
  IF coalesce(v_fl.opod, false) IS DISTINCT FROM p_opod THEN
    RAISE EXCEPTION 'redari fan: alegerea oPOD a lotului s-a schimbat (lotul: %, cererea: %); reincarca si apasa din nou', coalesce(v_fl.opod, false), p_opod USING ERRCODE = 'RD038'; END IF;
  -- garda „doar TEST” pe valorile pe care le-ar avea rândul (rând lipsă = marcajul care s-ar insera; rând existent = marcajul owner-ului)
  v_test := coalesce(v_fl.test, v_cod LIKE 'TEST-%');
  IF NOT public.fn_red_fan_lot_permis_valori(v_test, v_cod, v_set.doar_proiecte_test) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  v_tiparit := v_fl.tiraj_cheie IS NOT NULL;
  -- clasificarea plicurilor cerute (rândul viu al plicului, oriunde i-ar fi lot_id-ul — blocat la (3))
  SELECT coalesce(jsonb_agg(jsonb_build_object('plic_id', c.plic_id, 'hash', c.hash, 'nr_plic', coalesce(pl.nr_plic, a.nr_plic, '?'),
           'plic_ok', (pl.id IS NOT NULL AND pl.stare = 'activ' AND pl.lot_id = p_lot_id AND pl.data_expediere IS NULL AND pl.awb IS NULL),
           'plic_exp', (pl.awb IS NOT NULL OR pl.data_expediere IS NOT NULL), 'rand_id', a.id, 'rand_stare', a.stare, 'rand_hash', a.hash_date, 'rand_lot', a.lot_id, 'rand_intentie', a.intentie_cheie,
           'consumat', EXISTS (SELECT 1 FROM public.red_fan_zi_consum zc WHERE zc.awb_id = a.id AND zc.zi_ro = v_azi)) ORDER BY c.plic_id), '[]'::jsonb)
    INTO v_cl
    FROM jsonb_to_recordset(p_plicuri) AS c(plic_id uuid, hash text)
    LEFT JOIN public.red_plicuri pl ON pl.id = c.plic_id
    LEFT JOIN public.red_fan_awb a ON a.plic_id = c.plic_id AND a.stare NOT IN ('eroare', 'anulat', 'retras');
  FOR r IN SELECT * FROM jsonb_to_recordset(v_cl) AS x(plic_id uuid, hash text, nr_plic text, plic_ok boolean, plic_exp boolean, rand_id uuid, rand_stare text, rand_hash text, rand_lot uuid, rand_intentie uuid, consumat boolean) LOOP
    IF NOT r.plic_ok THEN
      v_excluse := v_excluse || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', CASE WHEN r.plic_exp THEN 'are_deja_expediere' ELSE 'nu_mai_e_in_lot' END);
    ELSIF r.rand_id IS NULL THEN
      IF v_tiparit THEN v_excluse := v_excluse || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', 'lot_tiparit');
      ELSIF v_mod = 'reluare' THEN v_excluse := v_excluse || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', 'date_schimbate');
      ELSE v_noi := v_noi + 1; v_noi_randuri := v_noi_randuri + 1;   -- „de propus”: rând nou (în A și N; se inserează în M)
      END IF;
    ELSIF r.rand_stare IN ('in_curs', 'necunoscut', 'generat', 'ridicat') THEN
      v_excluse := v_excluse || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', 'are_deja_expediere');
    ELSIF v_tiparit THEN
      v_excluse := v_excluse || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', 'lot_tiparit');
      v_de_retras := v_de_retras || jsonb_build_object('id', r.rand_id, 'nr_plic', r.nr_plic, 'motiv_cod', 'lot_tiparit', 'stare', r.rand_stare);
    ELSIF r.rand_stare = 'de_aprobat' THEN
      v_excluse := v_excluse || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', 'in_asteptare_aprobare');
    ELSIF r.rand_stare = 'aprobat' AND v_cer.id IS NOT NULL AND r.rand_intentie IS NOT DISTINCT FROM v_cer.intentie THEN
      -- Q2 A literal (condiția P2-2 a recenzentului): partea deja aprobată a trimiterii mixte care așteaptă decizia NU pleacă cu o cheie nouă
      v_excluse := v_excluse || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', 'in_asteptare_aprobare');
    ELSIF r.rand_stare = 'aprobat' AND r.rand_hash = r.hash THEN
      v_deja := v_deja || r.rand_id;   -- „deja aprobat”: intră direct în de_trimis, nenumărat
    ELSIF v_mod = 'reluare' THEN
      v_excluse := v_excluse || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', 'date_schimbate');   -- reluarea nu aprobă nimic nou
    ELSE
      v_a := v_a || r.rand_id;   -- „de refolosit” (propus) sau re-aprobare (aprobat cu hash schimbat)
      IF NOT r.consumat THEN v_n := v_n || r.rand_id; END IF;
      IF r.rand_stare = 'propus' THEN v_noi := v_noi + 1; END IF;
    END IF;
  END LOOP;
  -- rândurile lotului de retras: plicul nu mai e activ / în lot (și, pe un lot tipărit, orice rest propus / aprobat / de_aprobat)
  FOR r IN SELECT a.id, a.nr_plic, a.stare, pl.stare AS plic_stare, pl.lot_id AS plic_lot, pl.awb AS plic_awb, pl.data_expediere
             FROM public.red_fan_awb a LEFT JOIN public.red_plicuri pl ON pl.id = a.plic_id
            WHERE a.lot_id = p_lot_id AND a.stare IN ('propus', 'aprobat', 'de_aprobat') AND NOT (a.id = ANY (v_a)) AND NOT (a.id = ANY (v_deja))
              AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_de_retras) d WHERE (d ->> 'id')::uuid = a.id) ORDER BY a.id LOOP
    IF r.plic_stare IS DISTINCT FROM 'activ' OR r.plic_awb IS NOT NULL OR r.data_expediere IS NOT NULL THEN
      v_de_retras := v_de_retras || jsonb_build_object('id', r.id, 'nr_plic', r.nr_plic, 'motiv_cod', 'plic_anulat', 'stare', r.stare);
    ELSIF r.plic_lot IS DISTINCT FROM p_lot_id THEN
      v_de_retras := v_de_retras || jsonb_build_object('id', r.id, 'nr_plic', r.nr_plic, 'motiv_cod', 'plic_mutat', 'stare', r.stare);
    ELSIF v_tiparit THEN
      v_de_retras := v_de_retras || jsonb_build_object('id', r.id, 'nr_plic', r.nr_plic, 'motiv_cod', 'lot_tiparit', 'stare', r.stare);
    END IF;
  END LOOP;
  -- plafonul pe lot (conservator: deja aprobate / de_aprobat / trimise, fără a scădea retragerile de acum)
  SELECT count(*) INTO v_pe_lot FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat', 'retras');
  IF v_pe_lot + v_noi > v_set.limita_lot THEN
    RAISE EXCEPTION 'redari fan: lotul ar avea % plicuri aprobate, peste plafonul lotului (%)', v_pe_lot + v_noi, v_set.limita_lot USING ERRCODE = 'P0001'; END IF;
  -- decizia plafonului zilei, o singură dată: N = rândurile din A fără consum pe azi (rândurile noi n-au cum să aibă)
  v_n_cnt := cardinality(v_n) + v_noi_randuri;
  v_peste := v_n_cnt > 0 AND v_acum + v_n_cnt > v_set.limita_zi;
  IF v_peste AND v_cer.id IS NOT NULL THEN
    RAISE EXCEPTION 'redari fan: lotul are deja o cerere de aprobare deschisa; asteapta decizia proprietarului sau retrage cererea' USING ERRCODE = 'RD037'; END IF;
  -- ── Faza M ──
  -- (4) marcajul automat la prima trimitere, ÎNAINTEA scrierilor pe rânduri (runda 4, observația probei pe clonă): trigger-ul de jurnal al
  -- 20261227a citește alegerea oPOD a lotului la fiecare scriere red_fan_awb, deci cu rândul lotului deja inserat primul eveniment are opod =
  -- false (implicitul coloanei, aceeași valoare ca RD038 de mai sus), nu NULL. Rândul nou nu e ținut de nimeni (cheia lot_id e serializată de
  -- (1)); INSERT: trigger-ul gărzii loturilor e BEFORE UPDATE OR DELETE
  IF v_fl.lot_id IS NULL THEN
    INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de) VALUES (p_lot_id, v_lot.proiect_id, v_test, v_uid);
    v_marcaj := true;
  END IF;
  -- (3) retragerile (marcaj pe rând, lista (c) a trigger-ului)
  FOR r IN SELECT (d ->> 'id')::uuid AS id, d ->> 'nr_plic' AS nr_plic, d ->> 'motiv_cod' AS motiv_cod, d ->> 'stare' AS stare FROM jsonb_array_elements(v_de_retras) d LOOP
    SET LOCAL redari_fan.garda = 'fn_red_fan_comanda';
    UPDATE public.red_fan_awb SET stare = 'retras', retras_de = v_uid, retras_la = v_now, motiv_retragere = r.motiv_cod, updated_at = v_now WHERE id = r.id;
    SET LOCAL redari_fan.garda = '';
    v_retrase := v_retrase || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', r.motiv_cod);
    IF r.stare = 'de_aprobat' AND v_cer.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.red_fan_awb WHERE cerere_aprobare_id = v_cer.id AND stare = 'de_aprobat') THEN
      UPDATE public.red_fan_cereri_aprobare SET stare = 'retrasa', decis_de = v_uid, decis_la = v_now, motiv = 'toate randurile retrase' WHERE id = v_cer.id;   -- (7, rândul deja blocat)
      v_cer := NULL;
    END IF;
  END LOOP;
  IF v_peste THEN v_cerere := gen_random_uuid(); END IF;
  -- rândurile noi („de propus”): direct în starea finală (două tranziții din §8.8 scrise odată)
  FOR r IN SELECT * FROM jsonb_to_recordset(v_cl) AS x(plic_id uuid, hash text, nr_plic text, plic_ok boolean, rand_id uuid)
            WHERE plic_ok AND rand_id IS NULL AND NOT v_tiparit AND v_mod <> 'reluare' LOOP
    INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, hash_date, propus_de, stare, aprobat_de, aprobat_la, cerere_aprobare_id, intentie_cheie, created_at, updated_at)
    VALUES (v_lot.proiect_id, p_lot_id, r.plic_id, r.nr_plic, r.hash, v_uid, CASE WHEN v_peste THEN 'de_aprobat' ELSE 'aprobat' END,
            CASE WHEN v_peste THEN NULL ELSE v_uid END, CASE WHEN v_peste THEN NULL ELSE v_now END, v_cerere, p_intentie, v_now, v_now)
    RETURNING id INTO v_id;
    v_a := v_a || v_id;
    v_n := v_n || v_id;
  END LOOP;
  -- „de refolosit” / re-aprobare: hash-ul nou, lot_id / proiect_id aliniate la plicul de azi, apoi starea finală pe tot A
  UPDATE public.red_fan_awb a SET hash_date = x.hash, lot_id = p_lot_id, proiect_id = v_lot.proiect_id, propus_de = v_uid, tarif_estimat = NULL, updated_at = v_now,
         stare = CASE WHEN v_peste THEN 'de_aprobat' ELSE 'aprobat' END, aprobat_de = CASE WHEN v_peste THEN NULL ELSE v_uid END, aprobat_la = CASE WHEN v_peste THEN NULL ELSE v_now END,
         cerere_aprobare_id = CASE WHEN v_peste THEN v_cerere ELSE a.cerere_aprobare_id END, intentie_cheie = p_intentie
    FROM jsonb_to_recordset(v_cl) AS x(plic_id uuid, hash text, rand_id uuid)
   WHERE a.id = x.rand_id AND a.id = ANY (v_a);
  -- „deja aprobat”: realiniat la plic, preluat în trimiterea de acum (doar sub plafon; peste plafon rămâne neatins — Q2 A: ele pleacă după decizie,
  -- cu intentie_cheie neschimbată, în aceeași trimitere cu rândurile de_aprobat)
  IF NOT v_peste AND cardinality(v_deja) > 0 THEN
    UPDATE public.red_fan_awb SET lot_id = p_lot_id, proiect_id = v_lot.proiect_id, intentie_cheie = p_intentie, updated_at = v_now WHERE id = ANY (v_deja);
  END IF;
  IF v_peste AND cardinality(v_deja) > 0 THEN
    -- rândurile aprobat preluabile rămân neatinse, dar aparțin de acum trimiterii care așteaptă (Q2 A literal, P14): le leagă intenția cererii
    UPDATE public.red_fan_awb SET intentie_cheie = p_intentie, updated_at = v_now WHERE id = ANY (v_deja);
  END IF;
  IF NOT v_peste THEN v_trimis := v_a || v_deja; END IF;
  -- (4) prima aprobare (marcajul automat e la începutul fazei M)
  IF NOT v_peste AND cardinality(v_a) > 0 THEN
    UPDATE public.red_fan_loturi SET prima_aprobare_la = v_now, prima_aprobare_de = v_uid WHERE lot_id = p_lot_id AND prima_aprobare_la IS NULL;
    v_prima := FOUND;
  END IF;
  IF NOT public.fn_red_fan_lot_permis(p_lot_id) THEN RAISE EXCEPTION 'redari fan: garda doar TEST nu mai trece dupa marcaj (defect)' USING ERRCODE = 'P0001'; END IF;
  -- (6) contorul zilei + registrul consumului: DOAR pe N, DOAR sub plafon
  IF NOT v_peste AND cardinality(v_n) > 0 THEN
    INSERT INTO public.red_fan_zi (zi_ro, aprobate) VALUES (v_azi, v_acum + cardinality(v_n))
      ON CONFLICT (zi_ro) DO UPDATE SET aprobate = red_fan_zi.aprobate + cardinality(v_n) RETURNING aprobate INTO v_dupa;
    IF v_dupa IS NULL OR v_dupa <> v_acum + cardinality(v_n) OR v_dupa > v_set.limita_zi THEN
      RAISE EXCEPTION 'redari fan: contorul zilei nu e cel asteptat (% fata de %); nimic aprobat', v_dupa, v_acum + cardinality(v_n) USING ERRCODE = 'P0001'; END IF;
    INSERT INTO public.red_fan_zi_consum (awb_id, zi_ro, intentie, la) SELECT x, v_azi, p_intentie, v_now FROM unnest(v_n) x;
  END IF;
  -- (7) cererea de aprobare (doar peste plafon)
  IF v_peste THEN
    INSERT INTO public.red_fan_cereri_aprobare (id, lot_id, proiect_id, cerut_de, cerut_la, intentie, n, zi_ro, stare) VALUES (v_cerere, p_lot_id, v_lot.proiect_id, v_uid, v_now, p_intentie, cardinality(v_a), v_azi, 'deschisa');
  END IF;
  -- (8) intenția
  IF v_mod = 'preluare' THEN
    UPDATE public.red_fan_intentii SET stare = 'neincheiata', incheiata_de = 'comanda_noua', incheiata_la = v_now,
           rezultat = coalesce(rezultat, '{}'::jsonb) || jsonb_build_object('preluata_de', p_intentie) WHERE cheie = v_cheie_veche AND stare = 'in_curs';
  END IF;
  IF v_mod IN ('noua', 'preluare') THEN
    INSERT INTO public.red_fan_intentii (cheie, lot_id, proiect_id, operator, hash_cerere, stare, lucru_pana_la, inceput_la)
    VALUES (p_intentie, p_lot_id, v_lot.proiect_id, v_uid, p_hash_cerere, 'in_curs', v_now + v_lucru, v_now) ON CONFLICT (cheie) DO NOTHING RETURNING cheie INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'redari fan: cheia intentiei e deja folosita' USING ERRCODE = '22023'; END IF;
  ELSE
    UPDATE public.red_fan_intentii SET lucru_pana_la = v_now + v_lucru WHERE cheie = p_intentie;
  END IF;
  IF cardinality(v_trimis) = 0 THEN
    v_rez := public.fn_red_fan_intentie_incheie_intern(p_intentie, 'comanda', jsonb_build_object('mod', v_mod, 'de_aprobat', CASE WHEN v_peste THEN cardinality(v_a) ELSE 0 END,
               'cerere_id', v_cerere, 'excluse', v_excluse, 'retrase', v_retrase, 'nimic_de_trimis', NOT v_peste));
    v_incheiata := true;
  END IF;
  -- (11) jurnalul, ultimul (fără date personale: id-uri, numere, coduri)
  IF v_marcaj THEN
    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
    VALUES ('red_fan_loturi', p_lot_id, 'insert', jsonb_build_object('eveniment', 'marcaj_automat', 'test', v_test, 'intentie', p_intentie, 'la', v_now), v_uid);
  END IF;
  IF v_mod = 'preluare' THEN
    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
    VALUES ('red_fan_intentii', v_cheie_veche, 'update', jsonb_build_object('eveniment', 'intentie_neincheiata', 'preluata_de', p_intentie, 'la', v_now), v_uid);
  END IF;
  IF v_peste THEN
    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
    VALUES ('red_fan_cereri_aprobare', v_cerere, 'insert', jsonb_build_object('eveniment', 'cerere_deschisa', 'lot_id', p_lot_id, 'n', cardinality(v_a), 'zi_ro', v_azi, 'intentie', p_intentie, 'la', v_now), v_uid);
  END IF;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
  VALUES ('red_fan_intentii', p_intentie, CASE WHEN v_mod = 'reluare' THEN 'update' ELSE 'insert' END,
          jsonb_build_object('eveniment', 'comanda', 'lot_id', p_lot_id, 'mod', v_mod, 'aprobate', CASE WHEN v_peste THEN 0 ELSE cardinality(v_a) END, 'numarate', CASE WHEN v_peste THEN 0 ELSE cardinality(v_n) END,
            'de_aprobat', CASE WHEN v_peste THEN cardinality(v_a) ELSE 0 END, 'preluate', CASE WHEN v_peste THEN 0 ELSE cardinality(v_deja) END, 'de_trimis', cardinality(v_trimis),
            'excluse', jsonb_array_length(v_excluse), 'retrase', jsonb_array_length(v_retrase), 'incheiata', v_incheiata, 'la', v_now), v_uid);
  RETURN jsonb_build_object('intentie', p_intentie, 'mod', v_mod, 'replay', false, 'incheiata', v_incheiata, 'rezultat', v_rez,
    'aprobate', CASE WHEN v_peste THEN '[]'::jsonb ELSE to_jsonb(v_a) END, 'numarate', CASE WHEN v_peste THEN 0 ELSE cardinality(v_n) END,
    'de_trimis', to_jsonb(v_trimis), 'preluate', CASE WHEN v_peste THEN 0 ELSE cardinality(v_deja) END, 'de_aprobat', CASE WHEN v_peste THEN cardinality(v_a) ELSE 0 END,
    'cerere_id', v_cerere, 'excluse', v_excluse, 'retrase', v_retrase, 'marcaj_automat', v_marcaj, 'prima_aprobare', v_prima,
    'azi', jsonb_build_object('zi_ro', v_azi, 'limita', v_set.limita_zi, 'aprobate_inainte', v_acum, 'aprobate_dupa', CASE WHEN v_peste THEN v_acum ELSE v_acum + cardinality(v_n) END,
                              'incapeau', greatest(0, v_set.limita_zi - v_acum)));
END $fn$;

-- ═══ 8. Corpurile comune (interne, L19) ale rezervării, rezultatelor, urmăririi, confirmărilor și reconcilierii: le cheamă primitivele owner
-- (clasa C, calea veche „genereaza” / „urmarire” / „confirmari”) ȘI RPC-urile clasei B (funcția edge nouă, service_role) ═══
-- Rezervarea înaintea UNUI apel plătit (L04 / L22): ≤ 100 de rânduri aprobat → in_curs, O cheie nouă pe solicitare; hash-urile recalculate și
-- amprenta SURSELOR verificate ACUM (ca în 20261212a). p_intentie / p_actor NULL = calea veche (owner). Cu p_retrage, rândurile al căror plic
-- nu mai e activ / în lot → retras (plic_anulat / plic_mutat), nu refuz (spec §8.8); hash-ul schimbat = refuz TOTAL (nimic scris).
-- Lock (§6.2): 1 lot → 2 plicuri → 3 rânduri → citire lot_permis (RD032) → 8 intenția → 11 jurnal.
CREATE FUNCTION public.fn_red_fan_claim_intern(p_lot_id uuid, p_ids uuid[], p_hashuri text[], p_surse text[], p_intentie uuid, p_actor uuid, p_retrage boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cerere uuid := gen_random_uuid(); v_n integer; v_int record; v_now timestamptz; r record; v_retrase jsonb := '[]'; v_ramase uuid[]; v_de_retras uuid[] := '{}';
BEGIN
  IF p_lot_id IS NULL OR p_ids IS NULL OR p_hashuri IS NULL OR p_surse IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 100
     OR cardinality(p_ids) <> cardinality(p_hashuri) OR cardinality(p_ids) <> cardinality(p_surse)
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) OR array_position(p_ids, NULL) IS NOT NULL
     OR EXISTS (SELECT 1 FROM unnest(p_surse) s WHERE s IS NULL OR s !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'redari fan: solicitare invalida (1..100 randuri distincte, cu hash si amprenta surselor)' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = p_lot_id) THEN RAISE EXCEPTION 'redari fan: lot nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE id = ANY(p_ids)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  IF NOT public.fn_red_fan_lot_permis(p_lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  IF p_intentie IS NOT NULL THEN
    SELECT * INTO v_int FROM public.red_fan_intentii WHERE cheie = p_intentie FOR UPDATE;
    IF v_int.cheie IS NULL OR v_int.lot_id <> p_lot_id OR (v_int.operator <> p_actor AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND is_owner IS TRUE)) THEN
      RAISE EXCEPTION 'redari fan: intentia nu e a acestui lot / operator' USING ERRCODE = '22023'; END IF;
    IF v_int.stare <> 'in_curs' THEN RAISE EXCEPTION 'redari fan: intentia nu mai e in curs; apasa din nou Trimite' USING ERRCODE = 'RD034'; END IF;
    IF EXISTS (SELECT 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) AND intentie_cheie IS DISTINCT FROM p_intentie) THEN
      RAISE EXCEPTION 'redari fan: randurile nu sunt ale acestei intentii' USING ERRCODE = 'P0001'; END IF;
  END IF;
  -- V: plicul anulat / expediat manual / mutat din lot după aprobare → de retras (dacă e permis) sau refuz
  FOR r IN SELECT a.id, a.nr_plic, pl.stare AS plic_stare, pl.lot_id AS plic_lot, pl.awb AS plic_awb, pl.data_expediere
             FROM public.red_fan_awb a JOIN public.red_plicuri pl ON pl.id = a.plic_id WHERE a.id = ANY(p_ids) ORDER BY a.id LOOP
    IF r.plic_stare <> 'activ' OR r.plic_awb IS NOT NULL OR r.data_expediere IS NOT NULL OR r.plic_lot IS DISTINCT FROM p_lot_id THEN
      IF NOT p_retrage THEN RAISE EXCEPTION 'redari fan: 1 din % randuri nu mai sunt aprobate cu aceleasi date (plic schimbat, anulat sau deja trimis)', cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
      v_de_retras := v_de_retras || r.id;
      v_retrase := v_retrase || jsonb_build_object('nr_plic', r.nr_plic, 'motiv_cod', CASE WHEN r.plic_stare <> 'activ' OR r.plic_awb IS NOT NULL OR r.data_expediere IS NOT NULL THEN 'plic_anulat' ELSE 'plic_mutat' END);
    END IF;
  END LOOP;
  SELECT coalesce(array_agg(x), '{}') INTO v_ramase FROM unnest(p_ids) x WHERE NOT (x = ANY(v_de_retras));
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_hashuri) AS t(id, h) ON t.id = a.id
   WHERE a.id = ANY(v_ramase) AND a.lot_id = p_lot_id AND a.stare = 'aprobat' AND a.hash_date = t.h;
  IF v_n <> cardinality(v_ramase) THEN
    RAISE EXCEPTION 'redari fan: % din % randuri nu mai sunt aprobate cu aceleasi date (plic schimbat, anulat sau deja trimis)', cardinality(v_ramase) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_surse) AS t(id, s) ON t.id = a.id
   WHERE a.id = ANY(v_ramase) AND public.fn_red_fan_surse(a.plic_id) IS NOT DISTINCT FROM t.s;
  IF v_n <> cardinality(v_ramase) THEN
    RAISE EXCEPTION 'redari fan: datele de contact / plicul s-au schimbat la % din % randuri dupa citire; nimic rezervat, reincarca', cardinality(v_ramase) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  -- M
  v_now := clock_timestamp();
  FOREACH r.id IN ARRAY v_de_retras LOOP
    SET LOCAL redari_fan.garda = 'fn_red_fan_srv_claim';
    UPDATE public.red_fan_awb a SET stare = 'retras', retras_de = p_actor, retras_la = v_now, updated_at = v_now,
           motiv_retragere = CASE WHEN EXISTS (SELECT 1 FROM public.red_plicuri pl WHERE pl.id = a.plic_id AND pl.stare = 'activ' AND pl.awb IS NULL AND pl.data_expediere IS NULL) THEN 'plic_mutat' ELSE 'plic_anulat' END
     WHERE a.id = r.id;
    SET LOCAL redari_fan.garda = '';
  END LOOP;
  IF cardinality(v_ramase) > 0 THEN
    -- ceasul (20261212a runda 5): updated_at al rezervării = începutul celor 10 minute ale reconcilierii → clock_timestamp() după lock-uri
    UPDATE public.red_fan_awb SET stare = 'in_curs', cerere_id = v_cerere, motiv = NULL, updated_at = v_now WHERE id = ANY(v_ramase);
  ELSE
    v_cerere := NULL;
  END IF;
  IF p_intentie IS NOT NULL THEN
    UPDATE public.red_fan_intentii SET lucru_pana_la = v_now + interval '10 minutes' WHERE cheie = p_intentie;
    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
    VALUES ('red_fan_intentii', p_intentie, 'update', jsonb_build_object('eveniment', 'claim', 'cerere_id', v_cerere, 'lot_id', p_lot_id, 'rezervate', cardinality(v_ramase), 'retrase', v_retrase, 'sursa', 'edge', 'actor', p_actor, 'la', v_now), NULL);
  END IF;
  RETURN jsonb_build_object('cerere_id', v_cerere, 'rezervate', cardinality(v_ramase), 'retrase', v_retrase);
END $fn$;

-- Rezultatele UNEI solicitări, toate odată (L02), CAS pe cheie + stare. p_http = codul HTTP al POST-ului (NULL pe calea veche). Observația
-- `neincercat` (spec §8.8): DOAR cu p_http = 429, pe TOATĂ solicitarea, fără niciun AWB — altfel 22023; starea o decide BD-ul după presupunerea
-- P429: true → rândurile revin aprobat (cerere_id NULL, consumul rămâne), false → necunoscut cu cerere_id păstrat (reconciliere; niciodată eroare).
-- Un 429 cu rânduri necunoscut (AWB în răspuns) contrazice P429: presupunere_429 := false (poziția 5 FOR UPDATE, după 3) + jurnal.
-- Lock (§6.2): 3 rândurile solicitării → citire lot_permis → (5 doar pe calea contrazicerii) → 8 intenția → 11 jurnal.
CREATE FUNCTION public.fn_red_fan_rezultate_intern(p_cerere uuid, p_rezultate jsonb, p_http integer, p_intentie uuid, p_actor uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_asteptate integer; v_n integer; v_bune integer; v_dist integer; v_neinc integer; v_lot uuid; v_p429 boolean; v_stare_429 text; v_now timestamptz; v_necun integer; v_vechi boolean;
BEGIN
  IF p_cerere IS NULL OR p_rezultate IS NULL OR jsonb_typeof(p_rezultate) <> 'array' OR jsonb_array_length(p_rezultate) NOT BETWEEN 1 AND 100
     OR (p_http IS NOT NULL AND (p_http < 0 OR p_http > 999)) THEN
    RAISE EXCEPTION 'redari fan: rezultate invalide' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE r.id IS NOT NULL AND r.stare IN ('generat', 'eroare', 'necunoscut', 'neincercat')
           AND ((r.stare = 'generat' AND r.awb ~ '^[0-9]{6,20}$') OR (r.stare <> 'generat' AND r.awb IS NULL))
           AND (r.tarif IS NULL OR r.tarif >= 0) AND (r.tva IS NULL OR r.tva >= 0)), count(DISTINCT r.id), count(*) FILTER (WHERE r.stare = 'neincercat')
    INTO v_n, v_bune, v_dist, v_neinc FROM jsonb_to_recordset(p_rezultate) AS r(id uuid, stare text, awb text, tarif numeric, tva numeric, motiv text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: rezultat invalid' USING ERRCODE = '22023'; END IF;
  IF v_neinc > 0 AND (v_neinc <> v_n OR p_http IS DISTINCT FROM 429) THEN
    RAISE EXCEPTION 'redari fan: observatia neincercat e permisa doar la HTTP 429, pe toata solicitarea, fara niciun AWB' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE cerere_id = p_cerere ORDER BY id FOR UPDATE;
  SELECT count(*), (array_agg(lot_id ORDER BY id))[1] INTO v_asteptate, v_lot FROM public.red_fan_awb WHERE cerere_id = p_cerere AND stare = 'in_curs';
  IF v_asteptate = 0 OR v_n <> v_asteptate OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rezultate) AS r(id uuid)
       LEFT JOIN public.red_fan_awb a ON a.id = r.id AND a.cerere_id = p_cerere AND a.stare = 'in_curs' WHERE a.id IS NULL) THEN
    RAISE EXCEPTION 'redari fan: rezultat vechi, partial sau cheie straina (CAS)' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.fn_red_fan_lot_permis(v_lot) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  v_now := clock_timestamp();
  IF v_neinc > 0 THEN
    SELECT presupunere_429 INTO v_p429 FROM public.red_fan_setari WHERE id;   -- citire simplă (fără lock), spec §6.2 poziția 5
    v_stare_429 := CASE WHEN v_p429 IS TRUE THEN 'aprobat' ELSE 'necunoscut' END;
    UPDATE public.red_fan_awb a SET stare = v_stare_429, cerere_id = CASE WHEN v_p429 IS TRUE THEN NULL ELSE a.cerere_id END,
           motiv = left(CASE WHEN v_p429 IS TRUE THEN 'HTTP 429 (curierul a cerut o pauza): neincercat, revine la aprobat' ELSE 'HTTP 429 (P429 contrazisa): de verificat in borderou' END, 500), updated_at = v_now
     WHERE a.cerere_id = p_cerere AND a.stare = 'in_curs';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_asteptate THEN RAISE EXCEPTION 'redari fan: rezultat partial (CAS)' USING ERRCODE = 'P0001'; END IF;
  ELSE
    UPDATE public.red_fan_awb a SET stare = r.stare, awb = r.awb, tarif = public.fn_red_fan_suma(r.tarif), tva = public.fn_red_fan_suma(r.tva), motiv = left(r.motiv, 500),
           generat_la = CASE WHEN r.stare = 'generat' THEN now() END, updated_at = now()
      FROM jsonb_to_recordset(p_rezultate) AS r(id uuid, stare text, awb text, tarif numeric, tva numeric, motiv text)
     WHERE a.id = r.id AND a.cerere_id = p_cerere AND a.stare = 'in_curs';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_asteptate THEN RAISE EXCEPTION 'redari fan: rezultat partial (CAS)' USING ERRCODE = 'P0001'; END IF;
    SELECT count(*) INTO v_necun FROM public.red_fan_awb WHERE cerere_id = p_cerere AND stare = 'necunoscut';
    IF p_http = 429 AND v_necun > 0 THEN
      SELECT presupunere_429 INTO v_vechi FROM public.red_fan_setari WHERE id FOR UPDATE;   -- poziția 5, după 3, înaintea intenției
      IF v_vechi IS TRUE THEN
        UPDATE public.red_fan_setari SET presupunere_429 = false WHERE id;
        INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
        VALUES ('red_fan_setari', NULL, 'update', jsonb_build_object('presupunere_429', true),
                jsonb_build_object('eveniment', 'presupunere_429_contrazisa', 'presupunere_429', false, 'cerere_id', p_cerere, 'randuri_necunoscute', v_necun, 'la', v_now), NULL);
      END IF;
    END IF;
  END IF;
  IF p_intentie IS NOT NULL THEN
    PERFORM 1 FROM public.red_fan_intentii WHERE cheie = p_intentie FOR UPDATE;
    UPDATE public.red_fan_intentii SET lucru_pana_la = v_now + interval '10 minutes' WHERE cheie = p_intentie AND stare = 'in_curs';
  END IF;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
  VALUES ('red_fan_awb', NULL, 'update', jsonb_build_object('eveniment', CASE WHEN v_neinc > 0 THEN 'rezultate_neincercat' ELSE 'rezultate' END, 'cerere_id', p_cerere, 'lot_id', v_lot,
            'http', p_http, 'randuri', v_n, 'stare_429', v_stare_429, 'intentie', p_intentie, 'sursa', CASE WHEN p_intentie IS NULL THEN 'owner' ELSE 'edge' END, 'actor', p_actor, 'la', v_now), p_actor);
  RETURN v_n;
END $fn$;

-- Urmărirea (corpul din 20261212a + garda doar TEST; un corp pentru om și server, L19). Lock: 3 rânduri ORDER BY id.
CREATE FUNCTION public.fn_red_fan_urmarire_intern(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer; v_scrise integer; v_pastrate integer;
BEGIN
  IF p_lot_id IS NULL OR p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE u.id IS NOT NULL AND u.awb ~ '^[0-9]{6,20}$' AND u.versiune IS NOT NULL AND u.versiune >= 0
           AND u.urmarire_stare IN ('fara_evenimente', 'in_tranzit', 'ridicat', 'livrat', 'retur', 'de_verificat')
           AND (u.ultim_eveniment IS NULL OR u.ultim_eveniment ~ '^[A-Z]{1,2}[0-9]{1,3}$')
           AND (u.ultim_eveniment_la IS NULL OR u.ultim_eveniment_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.livrat_la IS NULL OR u.livrat_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.ridicat_propus IS NULL OR u.ridicat_propus ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
           AND (u.retur_propus IS NULL OR u.retur_propus IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta'))), count(DISTINCT u.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text, versiune integer, urmarire_stare text, ultim_eveniment text,
      ultim_eveniment_la text, ridicat_propus text, livrat_la text, retur_propus text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id IN (SELECT u.id FROM jsonb_to_recordset(p_randuri) AS u(id uuid)) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text)
             LEFT JOIN public.red_fan_awb a ON a.id = u.id AND a.lot_id = p_lot_id AND a.awb = u.awb AND a.stare IN ('generat', 'ridicat')
             WHERE a.id IS NULL) THEN RAISE EXCEPTION 'redari fan: rand strain sau AWB diferit' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.fn_red_fan_lot_permis(p_lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  UPDATE public.red_fan_awb a SET urmarit_la = now(), updated_at = now(), versiune_urmarire = a.versiune_urmarire + 1
    FROM jsonb_to_recordset(p_randuri) AS u(id uuid, versiune integer, ultim_eveniment_la text)
   WHERE a.id = u.id AND a.versiune_urmarire = u.versiune AND a.ultim_eveniment_la IS NOT NULL AND u.ultim_eveniment_la IS NULL;
  GET DIAGNOSTICS v_pastrate = ROW_COUNT;
  UPDATE public.red_fan_awb a SET
         urmarire_stare = CASE WHEN m.contradictie OR m.n_stare = 'de_verificat' THEN 'de_verificat' WHEN m.retur THEN 'retur'
                               WHEN m.livrat IS NOT NULL THEN 'livrat' WHEN m.ridicat IS NOT NULL AND m.n_stare IN ('fara_evenimente', 'in_tranzit') THEN 'ridicat'
                               ELSE m.n_stare END,
         ultim_eveniment = m.n_ev, ultim_eveniment_la = m.n_la, ridicat_propus = m.ridicat, livrat_la = m.livrat, retur_propus = m.motiv,
         retur_cunoscut = m.retur, ridicat_contrazis = m.c_rid, livrat_contrazis = m.c_liv, retur_contrazis = m.c_ret,
         urmarit_la = now(), updated_at = now(), versiune_urmarire = a.versiune_urmarire + 1
    FROM (SELECT f.*, (f.c_rid IS NOT NULL OR f.c_liv IS NOT NULL OR f.c_ret IS NOT NULL OR (f.livrat IS NOT NULL AND f.retur)) AS contradictie
            FROM (SELECT u.id, u.versiune, u.urmarire_stare AS n_stare, u.ultim_eveniment AS n_ev, n.la AS n_la,
                         coalesce(b.ridicat_propus, n.rid) AS ridicat, coalesce(b.livrat_la, n.liv) AS livrat, coalesce(b.retur_propus, u.retur_propus) AS motiv,
                         (b.retur_cunoscut OR u.urmarire_stare = 'retur' OR u.retur_propus IS NOT NULL) AS retur,
                         coalesce(b.ridicat_contrazis, CASE WHEN n.rid <> b.ridicat_propus THEN n.rid END) AS c_rid,
                         coalesce(b.livrat_contrazis, CASE WHEN n.liv <> b.livrat_la THEN n.liv END) AS c_liv,
                         coalesce(b.retur_contrazis, CASE WHEN u.retur_propus <> b.retur_propus THEN u.retur_propus END) AS c_ret
                    FROM jsonb_to_recordset(p_randuri) AS u(id uuid, versiune integer, urmarire_stare text, ultim_eveniment text,
                           ultim_eveniment_la text, ridicat_propus text, livrat_la text, retur_propus text)
                    JOIN public.red_fan_awb b ON b.id = u.id
                    CROSS JOIN LATERAL (SELECT (u.ultim_eveniment_la::timestamp AT TIME ZONE 'Europe/Bucharest') AS la, u.ridicat_propus::date AS rid,
                                               (u.livrat_la::timestamp AT TIME ZONE 'Europe/Bucharest') AS liv) n) f) m
   WHERE a.id = m.id AND a.versiune_urmarire = m.versiune
     AND (a.ultim_eveniment_la IS NULL OR (m.n_la IS NOT NULL AND m.n_la >= a.ultim_eveniment_la));
  GET DIAGNOSTICS v_scrise = ROW_COUNT;
  RETURN jsonb_build_object('scrise', v_scrise, 'pastrate', v_pastrate, 'depasite', v_n - v_scrise - v_pastrate);
END $fn$;

CREATE FUNCTION public.fn_red_fan_confirmari_intern(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer; v_scrise integer;
BEGIN
  IF p_lot_id IS NULL OR p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: confirmari invalide' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE c.id IS NOT NULL AND c.awb ~ '^[0-9]{6,20}$' AND c.versiune IS NOT NULL AND c.versiune >= 0
           AND c.confirmare_stare IN ('lipsa', 'primita_de_verificat', 'forma_necunoscuta')), count(DISTINCT c.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text, versiune integer, confirmare_stare text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: confirmari invalide' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id IN (SELECT c.id FROM jsonb_to_recordset(p_randuri) AS c(id uuid)) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text)
             LEFT JOIN public.red_fan_awb a ON a.id = c.id AND a.lot_id = p_lot_id AND a.awb = c.awb AND a.stare IN ('generat', 'ridicat')
             WHERE a.id IS NULL) THEN RAISE EXCEPTION 'redari fan: rand strain sau AWB diferit' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.fn_red_fan_lot_permis(p_lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  UPDATE public.red_fan_awb a SET confirmare_stare = c.confirmare_stare, urmarit_la = now(), updated_at = now(), versiune_urmarire = a.versiune_urmarire + 1
    FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text, versiune integer, confirmare_stare text) WHERE a.id = c.id AND a.versiune_urmarire = c.versiune;
  GET DIAGNOSTICS v_scrise = ROW_COUNT;
  RETURN jsonb_build_object('scrise', v_scrise, 'depasite', v_n - v_scrise);
END $fn$;

-- Reconcilierea unui rând (necunoscut, sau in_curs de peste 10 minute): p_awb găsit → generat; p_awb NULL (DOAR owner, p_permite_absenta) → eroare.
-- Apoi intenția rândului: dacă e in_curs și nu mai are rânduri aprobat / in_curs / necunoscut → incheiata (reconciliere). Lock: 3 rândul → 8 intenția → 11.
CREATE FUNCTION public.fn_red_fan_reconciliaza_intern(p_id uuid, p_awb text, p_tarif numeric, p_tva numeric, p_motiv text, p_actor uuid, p_permite_absenta boolean) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_rand record; v_stare text; v_int record; v_inchisa boolean := false; v_now timestamptz;
BEGIN
  IF p_id IS NULL OR (p_awb IS NOT NULL AND p_awb !~ '^[0-9]{6,20}$') OR (p_awb IS NULL AND (NOT p_permite_absenta OR coalesce(left(p_motiv, 500), '') !~ '[^[:space:]]')) THEN
    RAISE EXCEPTION 'redari fan: reconciliere invalida (AWB valid sau motivul verificarii; absenta o confirma doar owner-ul)' USING ERRCODE = '22023'; END IF;
  SELECT id, stare, updated_at, lot_id, intentie_cheie INTO v_rand FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  IF v_rand.id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.fn_red_fan_lot_permis(v_rand.lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  IF NOT (v_rand.stare = 'necunoscut' OR (v_rand.stare = 'in_curs' AND v_rand.updated_at < clock_timestamp() - interval '10 minutes')) THEN
    RAISE EXCEPTION 'redari fan: doar randurile necunoscute (sau in curs de peste 10 minute) se reconciliaza' USING ERRCODE = 'P0001'; END IF;
  v_stare := CASE WHEN p_awb IS NOT NULL THEN 'generat' ELSE 'eroare' END;
  v_now := clock_timestamp();
  UPDATE public.red_fan_awb SET stare = v_stare, awb = p_awb, tarif = public.fn_red_fan_suma(p_tarif), tva = public.fn_red_fan_suma(p_tva), motiv = left(p_motiv, 500),
         generat_la = CASE WHEN p_awb IS NOT NULL THEN now() END, updated_at = now()
   WHERE id = p_id;
  IF v_rand.intentie_cheie IS NOT NULL THEN
    SELECT * INTO v_int FROM public.red_fan_intentii WHERE cheie = v_rand.intentie_cheie FOR UPDATE;
    IF v_int.stare = 'in_curs' AND NOT EXISTS (SELECT 1 FROM public.red_fan_awb WHERE intentie_cheie = v_rand.intentie_cheie AND stare IN ('aprobat', 'in_curs', 'necunoscut')) THEN
      PERFORM public.fn_red_fan_intentie_incheie_intern(v_rand.intentie_cheie, 'reconciliere', '{}'::jsonb);
      v_inchisa := true;
    END IF;
  END IF;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_awb', p_id, 'update', jsonb_build_object('stare', v_rand.stare), jsonb_build_object('eveniment', 'reconciliere', 'stare', v_stare, 'lot_id', v_rand.lot_id,
            'intentie', v_rand.intentie_cheie, 'intentie_incheiata', v_inchisa, 'actor', p_actor, 'la', v_now), p_actor);
  RETURN v_stare;
END $fn$;

-- ═══ 9. Clasa B — înscrierea rezultatelor externe: EXECUTE EXCLUSIV service_role; în corp auth.uid() IS NULL (un JWT de om = 42501), p_actor
-- re-verificat ca operator / owner ACTIV (rezervare, urmărire, confirmări, reconciliere, anulare) sau ca operatorul intenției / owner (rezultate,
-- încheiere: banii sunt cheltuiți, un operator retras între timp nu le poate pierde — L20; jurnal „operator retras”). ═══
CREATE FUNCTION public.fn_red_fan_srv_poarta(p_actor uuid, p_activ_cerut boolean) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: inscrierea rezultatelor externe nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'redari fan: actorul lipseste' USING ERRCODE = '42501'; END IF;
  IF p_activ_cerut AND NOT public.fn_red_fan_e_operator_profil(p_actor) THEN RAISE EXCEPTION 'redari fan: actorul nu e operator activ sau owner' USING ERRCODE = '42501'; END IF;
END $fn$;

CREATE FUNCTION public.fn_red_fan_srv_claim(p_actor uuid, p_intentie uuid, p_lot_id uuid, p_ids uuid[], p_hashuri text[], p_surse text[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.fn_red_fan_srv_poarta(p_actor, true);
  IF p_intentie IS NULL THEN RAISE EXCEPTION 'redari fan: rezervarea cere intentia' USING ERRCODE = '22023'; END IF;
  RETURN public.fn_red_fan_claim_intern(p_lot_id, p_ids, p_hashuri, p_surse, p_intentie, p_actor, true);
END $fn$;

CREATE FUNCTION public.fn_red_fan_srv_rezultate(p_actor uuid, p_intentie uuid, p_cerere uuid, p_rezultate jsonb, p_http integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_int record; v_n integer;
BEGIN
  PERFORM public.fn_red_fan_srv_poarta(p_actor, false);
  IF p_intentie IS NULL OR p_http IS NULL THEN RAISE EXCEPTION 'redari fan: rezultatele cer intentia si codul HTTP' USING ERRCODE = '22023'; END IF;
  SELECT operator INTO v_int FROM public.red_fan_intentii WHERE cheie = p_intentie;
  IF v_int.operator IS NULL OR (v_int.operator <> p_actor AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND is_owner IS TRUE)) THEN
    RAISE EXCEPTION 'redari fan: actorul nu e operatorul intentiei' USING ERRCODE = '42501'; END IF;
  v_n := public.fn_red_fan_rezultate_intern(p_cerere, p_rezultate, p_http, p_intentie, p_actor);
  IF NOT public.fn_red_fan_e_operator_profil(p_actor) THEN
    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
    VALUES ('red_fan_intentii', p_intentie, 'update', jsonb_build_object('eveniment', 'operator_retras_intre_timp', 'pas', 'rezultate', 'actor', p_actor, 'cerere_id', p_cerere), NULL);
  END IF;
  RETURN v_n;
END $fn$;

-- p_actor XOR p_rulare: în F1 doar p_actor (p_rulare prinde viață în F2, cu rularea automată); p_rulare nenul = 22023 până atunci.
CREATE FUNCTION public.fn_red_fan_srv_urmarire(p_actor uuid, p_rulare uuid, p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.fn_red_fan_srv_poarta(p_actor, true);
  IF p_rulare IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e livrata (F2)' USING ERRCODE = '22023'; END IF;
  RETURN public.fn_red_fan_urmarire_intern(p_lot_id, p_randuri);
END $fn$;
CREATE FUNCTION public.fn_red_fan_srv_confirmari(p_actor uuid, p_rulare uuid, p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.fn_red_fan_srv_poarta(p_actor, true);
  IF p_rulare IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e livrata (F2)' USING ERRCODE = '22023'; END IF;
  RETURN public.fn_red_fan_confirmari_intern(p_lot_id, p_randuri);
END $fn$;

-- „Găsit” reverificat în borderou de funcția edge (operatorul nu alege el AWB-ul); absența rămâne a owner-ului (clasa C).
CREATE FUNCTION public.fn_red_fan_srv_reconciliaza(p_actor uuid, p_id uuid, p_awb text, p_tarif numeric, p_tva numeric) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.fn_red_fan_srv_poarta(p_actor, true);
  IF p_awb IS NULL THEN RAISE EXCEPTION 'redari fan: serverul inscrie doar AWB-ul gasit in borderou (absenta o confirma owner-ul)' USING ERRCODE = '22023'; END IF;
  RETURN public.fn_red_fan_reconciliaza_intern(p_id, p_awb, p_tarif, p_tva, 'gasit in borderoul curierului (reverificat de server)', p_actor, false);
END $fn$;

-- Anularea, pasul 2 (spec §8.4.1): sters → anulat + confirmarea copiată din cerere; refuzat_ridicat / prezent → cererea golită; ambiguu → nimic.
-- Lock: 2 plic → 3 rândul → 11 jurnal. Marcajul 'fn_red_fan_srv_anuleaza:<id>' (listele (a) golire și (b) confirmare).
CREATE FUNCTION public.fn_red_fan_srv_anuleaza(p_actor uuid, p_id uuid, p_awb text, p_rezultat text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid; v_r record; v_now timestamptz;
BEGIN
  PERFORM public.fn_red_fan_srv_poarta(p_actor, true);
  IF p_id IS NULL OR p_awb IS NULL OR p_awb !~ '^[0-9]{6,20}$' OR p_rezultat IS NULL OR p_rezultat NOT IN ('sters', 'refuzat_ridicat', 'prezent', 'ambiguu') THEN
    RAISE EXCEPTION 'redari fan: inscriere de anulare invalida' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  SELECT id, stare, awb, lot_id, anulare_ceruta_de, anulare_ceruta_la, anulare_ceruta_motiv, anulare_ceruta_nota INTO v_r FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  IF NOT public.fn_red_fan_lot_permis(v_r.lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  IF v_r.anulare_ceruta_la IS NULL OR v_r.stare <> 'generat' OR v_r.awb IS DISTINCT FROM p_awb THEN
    RAISE EXCEPTION 'redari fan: nicio cerere de anulare deschisa pe acest AWB generat (CAS)' USING ERRCODE = 'P0001'; END IF;
  IF p_rezultat = 'ambiguu' THEN RETURN 'ambiguu'; END IF;
  v_now := clock_timestamp();
  SET LOCAL redari_fan.garda = 'fn_red_fan_srv_anuleaza';
  IF p_rezultat = 'sters' THEN
    UPDATE public.red_fan_awb SET stare = 'anulat', anulat_de = v_r.anulare_ceruta_de, anulat_la = v_now, motiv_anulare = v_r.anulare_ceruta_motiv, anulare_nota = v_r.anulare_ceruta_nota,
           motiv = left('AWB sters la curier (DELETE confirmat), cerut de operator: ' || v_r.anulare_ceruta_motiv, 500), updated_at = v_now WHERE id = p_id;
  ELSE
    UPDATE public.red_fan_awb SET anulare_ceruta_de = NULL, anulare_ceruta_la = NULL, anulare_ceruta_motiv = NULL, anulare_ceruta_nota = NULL, updated_at = v_now WHERE id = p_id;
  END IF;
  SET LOCAL redari_fan.garda = '';
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_awb', p_id, 'update', jsonb_build_object('stare', 'generat', 'anulare_ceruta_motiv', v_r.anulare_ceruta_motiv, 'anulare_ceruta_de', v_r.anulare_ceruta_de),
          jsonb_build_object('eveniment', CASE WHEN p_rezultat = 'sters' THEN 'anulat' ELSE 'anulare_golita' END, 'rezultat', p_rezultat, 'lot_id', v_r.lot_id, 'actor', p_actor, 'la', v_now), p_actor);
  RETURN p_rezultat;
END $fn$;

-- Încheierea intenției (spec §8.3): după bucla claim → POST → rezultate, ÎNAINTEA etichetelor. CAS pe in_curs; incheiata DOAR fără rânduri
-- in_curs / necunoscut (altfel {incheiata:false, necunoscute:N}, nimic scris); sumarul DERIVAT din rânduri + lista albă din p_rezultat.
-- Lock: 3 rândurile intenției ORDER BY id → 8 intenția → 11 jurnal.
CREATE FUNCTION public.fn_red_fan_srv_intentie_incheie(p_actor uuid, p_cheie uuid, p_rezultat jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_int record; v_necun integer; v_rez jsonb; v_extra jsonb;
BEGIN
  PERFORM public.fn_red_fan_srv_poarta(p_actor, false);
  IF p_cheie IS NULL OR p_rezultat IS NULL OR jsonb_typeof(p_rezultat) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_rezultat) k WHERE k NOT IN ('oprit', 'motiv_oprire', 'excluse', 'retrase'))
     OR (p_rezultat ? 'oprit' AND jsonb_typeof(p_rezultat -> 'oprit') <> 'boolean')
     OR (p_rezultat ? 'motiv_oprire' AND (p_rezultat ->> 'motiv_oprire') NOT IN ('429', 'limita_solicitari', 'scriere_neconfirmata', 'rezervare_refuzata'))
     OR (p_rezultat ? 'excluse' AND jsonb_typeof(p_rezultat -> 'excluse') <> 'array') OR (p_rezultat ? 'retrase' AND jsonb_typeof(p_rezultat -> 'retrase') <> 'array') THEN
    RAISE EXCEPTION 'redari fan: rezultatul incheierii are chei nepermise sau forma gresita' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE intentie_cheie = p_cheie ORDER BY id FOR UPDATE;
  SELECT * INTO v_int FROM public.red_fan_intentii WHERE cheie = p_cheie FOR UPDATE;
  IF v_int.cheie IS NULL THEN RAISE EXCEPTION 'redari fan: intentie inexistenta' USING ERRCODE = 'P0002'; END IF;
  IF v_int.operator <> p_actor AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND is_owner IS TRUE) THEN
    RAISE EXCEPTION 'redari fan: actorul nu e operatorul intentiei' USING ERRCODE = '42501'; END IF;
  IF v_int.stare <> 'in_curs' THEN RETURN jsonb_build_object('incheiata', v_int.stare = 'incheiata', 'stare', v_int.stare, 'deja', true, 'rezultat', v_int.rezultat); END IF;
  SELECT count(*) INTO v_necun FROM public.red_fan_awb WHERE intentie_cheie = p_cheie AND stare IN ('in_curs', 'necunoscut');
  IF v_necun > 0 THEN RETURN jsonb_build_object('incheiata', false, 'necunoscute', v_necun); END IF;
  v_extra := jsonb_build_object('oprit', coalesce((p_rezultat ->> 'oprit')::boolean, false)) || (p_rezultat - 'oprit');
  v_rez := public.fn_red_fan_intentie_incheie_intern(p_cheie, 'edge', v_extra);
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
  VALUES ('red_fan_intentii', p_cheie, 'update', jsonb_build_object('eveniment', 'intentie_incheiata', 'de', 'edge', 'rezultat', v_rez, 'actor', p_actor,
            'operator_retras', NOT public.fn_red_fan_e_operator_profil(p_actor), 'la', clock_timestamp()), NULL);
  RETURN jsonb_build_object('incheiata', true, 'rezultat', v_rez);
END $fn$;

-- ═══ 10. Primitivele din 20261212a înlocuite (CREATE OR REPLACE după amprenta verificată în lant_20261228a; semnăturile și proprietățile neschimbate) ═══
-- (1) Propunere: operator sau owner (spec §13: azi admin / editor); + RD036 pe lot cu tiraj (Q5 A); re-propunerea aliniază lot_id / proiect_id la plic;
-- un rând de_aprobat NU se re-propune (tranziția de_aprobat → propus e doar a deciziei / retragerii cererii, §8.8). Lock: 1 lot → 2 plic → 3 rândul viu.
CREATE OR REPLACE FUNCTION public.fn_red_fan_propune(p_plic_id uuid, p_hash text, p_tarif_estimat numeric) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic record; v_rand record; v_id uuid; v_lot uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_red_fan_e_operator() THEN RAISE EXCEPTION 'redari fan: fara drept (doar operatorii numiti sau owner-ul)' USING ERRCODE = '42501'; END IF;
  IF p_plic_id IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR (p_tarif_estimat IS NOT NULL AND public.fn_red_fan_suma(p_tarif_estimat) IS NULL) THEN
    RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT lot_id INTO v_lot FROM public.red_plicuri WHERE id = p_plic_id;
  IF v_lot IS NOT NULL THEN PERFORM 1 FROM public.red_loturi_plicuire WHERE id = v_lot FOR UPDATE; END IF;
  SELECT id, proiect_id, lot_id, nr_plic, stare, data_expediere, awb INTO v_plic FROM public.red_plicuri WHERE id = p_plic_id FOR UPDATE;
  IF v_plic.id IS NULL THEN RAISE EXCEPTION 'redari fan: plic inexistent' USING ERRCODE = 'P0002'; END IF;
  IF v_plic.lot_id IS DISTINCT FROM v_lot THEN RAISE EXCEPTION 'redari fan: plicul s-a mutat intre loturi chiar acum; reincercati' USING ERRCODE = '55P03'; END IF;
  IF v_plic.stare <> 'activ' OR v_plic.data_expediere IS NOT NULL OR v_plic.awb IS NOT NULL OR v_plic.lot_id IS NULL THEN
    RAISE EXCEPTION 'redari fan: plicul nu e activ, neexpediat si intr-un lot' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = v_lot AND tiraj_cheie IS NOT NULL) THEN
    RAISE EXCEPTION 'redari fan: lotul e tiparit; plic nou doar intr-un lot nou de plicuire' USING ERRCODE = 'RD036'; END IF;
  SELECT id, stare INTO v_rand FROM public.red_fan_awb WHERE plic_id = p_plic_id AND stare NOT IN ('eroare', 'anulat', 'retras') FOR UPDATE;
  IF v_rand.id IS NOT NULL THEN
    IF v_rand.stare NOT IN ('propus', 'aprobat') THEN RAISE EXCEPTION 'redari fan: plicul are deja un AWB % (nu se re-propune)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
    UPDATE public.red_fan_awb SET stare = 'propus', hash_date = p_hash, tarif_estimat = p_tarif_estimat, propus_de = auth.uid(), lot_id = v_plic.lot_id, proiect_id = v_plic.proiect_id,
           aprobat_de = NULL, aprobat_la = NULL, updated_at = now() WHERE id = v_rand.id;
    RETURN v_rand.id;
  END IF;
  INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, hash_date, tarif_estimat)
    VALUES (v_plic.proiect_id, v_plic.lot_id, p_plic_id, v_plic.nr_plic, p_hash, p_tarif_estimat) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- (2) Aprobarea owner-ului (calea veche): + aprobare_owner_la, + RD036 pe lot cu tiraj, + red_fan_loturi FOR UPDATE în poziția 4, + de_aprobat la „deja”.
-- Lock: 1 lot → 2 plicuri → 3 rânduri → 4 red_fan_loturi.
CREATE OR REPLACE FUNCTION public.fn_red_fan_aproba(p_lot_id uuid, p_ids uuid[], p_hashuri text[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_deja integer; v_limita integer; v_fl record; v_now timestamptz;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul aproba' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_ids IS NULL OR p_hashuri IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) <> cardinality(p_hashuri) OR cardinality(p_ids) > 2000
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'redari fan: lista invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE id = ANY(p_ids)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  SELECT lot_id, tiraj_cheie INTO v_fl FROM public.red_fan_loturi WHERE lot_id = p_lot_id FOR UPDATE;
  IF v_fl.lot_id IS NULL THEN RAISE EXCEPTION 'redari fan: alege intai daca lotul e de TEST sau real' USING ERRCODE = 'P0001'; END IF;
  IF v_fl.tiraj_cheie IS NOT NULL THEN RAISE EXCEPTION 'redari fan: lotul e tiparit; plic nou doar intr-un lot nou de plicuire' USING ERRCODE = 'RD036'; END IF;
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_hashuri) AS t(id, h) ON t.id = a.id
    JOIN public.red_plicuri pl ON pl.id = a.plic_id
   WHERE a.lot_id = p_lot_id AND a.stare = 'propus' AND a.hash_date = t.h
     AND pl.stare = 'activ' AND pl.data_expediere IS NULL AND pl.awb IS NULL AND pl.lot_id = a.lot_id;
  IF v_n <> cardinality(p_ids) THEN RAISE EXCEPTION 'redari fan: % din % randuri s-au schimbat de la previzualizare; reincarca', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_deja FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat', 'retras');
  SELECT limita_lot INTO v_limita FROM public.red_fan_setari WHERE id;
  IF v_limita IS NULL THEN RAISE EXCEPTION 'redari fan: setarile lipsesc' USING ERRCODE = 'P0002'; END IF;
  IF v_deja + v_n > v_limita THEN
    RAISE EXCEPTION 'redari fan: lotul ar avea % plicuri aprobate, peste plafonul lotului pilot (%)', v_deja + v_n, v_limita USING ERRCODE = 'P0001'; END IF;
  v_now := clock_timestamp();
  UPDATE public.red_fan_awb SET stare = 'aprobat', aprobat_de = auth.uid(), aprobat_la = now(), aprobare_owner_la = v_now, updated_at = now() WHERE id = ANY(p_ids);
  UPDATE public.red_fan_loturi SET prima_aprobare_la = now(), prima_aprobare_de = auth.uid() WHERE lot_id = p_lot_id AND prima_aprobare_la IS NULL;
  RETURN v_n;
END $fn$;

-- (3)–(5), (7), (8): primitivele owner (clasa C de fapt: calea veche a funcției edge) → corpurile comune + garda doar TEST; semnătura și poarta neschimbate.
CREATE OR REPLACE FUNCTION public.fn_red_fan_claim_lot(p_lot_id uuid, p_ids uuid[], p_hashuri text[], p_surse text[]) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul genereaza' USING ERRCODE = '42501'; END IF;
  RETURN (public.fn_red_fan_claim_intern(p_lot_id, p_ids, p_hashuri, p_surse, NULL, auth.uid(), false) ->> 'cerere_id')::uuid;
END $fn$;
CREATE OR REPLACE FUNCTION public.fn_red_fan_rezultate(p_cerere uuid, p_rezultate jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  RETURN public.fn_red_fan_rezultate_intern(p_cerere, p_rezultate, NULL, NULL, auth.uid());
END $fn$;
CREATE OR REPLACE FUNCTION public.fn_red_fan_urmarire(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  RETURN public.fn_red_fan_urmarire_intern(p_lot_id, p_randuri);
END $fn$;
CREATE OR REPLACE FUNCTION public.fn_red_fan_confirmari(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  RETURN public.fn_red_fan_confirmari_intern(p_lot_id, p_randuri);
END $fn$;
-- Reconcilierea owner-ului (clasa C): găsit sau ABSENȚA confirmată (p_awb NULL = eroare, deschide al doilea AWB); + încheie intenția rândului.
CREATE OR REPLACE FUNCTION public.fn_red_fan_reconciliaza(p_id uuid, p_awb text, p_tarif numeric, p_tva numeric, p_motiv text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  RETURN public.fn_red_fan_reconciliaza_intern(p_id, p_awb, p_tarif, p_tva, p_motiv, auth.uid(), true);
END $fn$;

-- (6) Ridicarea confirmată manual de owner (clasa C): + garda doar TEST (RD032). Lock: 2 plic → 3 rândul.
CREATE OR REPLACE FUNCTION public.fn_red_fan_ridicat(p_id uuid, p_data date) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid; v_pl record; v_rand record; v_test boolean;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_data IS NULL OR p_data > (now() AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'redari fan: data ridicarii invalida' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT id, stare, awb, data_expediere INTO v_pl FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  SELECT id, stare, awb, ridicat_la, generat_la, lot_id INTO v_rand FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  SELECT test INTO v_test FROM public.red_fan_loturi WHERE lot_id = v_rand.lot_id;
  IF v_test IS NULL THEN RAISE EXCEPTION 'redari fan: lot nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.fn_red_fan_lot_permis(v_rand.lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  IF v_rand.stare = 'ridicat' AND (v_test OR v_pl.awb IS NOT DISTINCT FROM v_rand.awb) THEN RETURN; END IF;   -- C0 repetat
  IF v_rand.stare <> 'generat' THEN RAISE EXCEPTION 'redari fan: doar un AWB generat poate fi ridicat (stare %)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
  IF p_data < (v_rand.generat_la AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'redari fan: ridicarea nu poate fi inainte de generarea AWB-ului' USING ERRCODE = '22023'; END IF;
  IF NOT v_test THEN
    IF v_pl.stare <> 'activ' OR v_pl.data_expediere IS NOT NULL OR v_pl.awb IS NOT NULL THEN
      RAISE EXCEPTION 'redari fan: plicul e anulat sau are deja o expediere inregistrata; verificare manuala' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.red_plicuri SET awb = v_rand.awb, data_expediere = p_data WHERE id = v_plic_id;
  END IF;
  UPDATE public.red_fan_awb SET stare = 'ridicat', ridicat_la = (p_data::timestamp AT TIME ZONE 'Europe/Bucharest'), updated_at = now() WHERE id = p_id;
END $fn$;

-- (9) Anularea verificată manual de owner (clasa C, D18): rămâne până la publicarea funcției edge noi; + garda doar TEST, + confirmarea
-- (anulat_de / anulat_la / motiv_anulare = motivul cerut dacă există cerere deschisă, altfel alt_motiv; anulare_nota = textul vechi tăiat la 200).
CREATE OR REPLACE FUNCTION public.fn_red_fan_anulat(p_id uuid, p_awb text, p_motiv text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid; v_r record; v_now timestamptz;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_awb IS NULL OR p_awb !~ '^[0-9]{6,20}$' OR coalesce(left(p_motiv, 500), '') !~ '[^[:space:]]' THEN
    RAISE EXCEPTION 'redari fan: anulare invalida (AWB + motiv)' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  SELECT id, lot_id, anulare_ceruta_motiv, anulare_ceruta_nota INTO v_r FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  IF NOT public.fn_red_fan_lot_permis(v_r.lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  v_now := clock_timestamp();
  SET LOCAL redari_fan.garda = 'fn_red_fan_anulat';
  UPDATE public.red_fan_awb SET stare = 'anulat', motiv = left(p_motiv, 500), updated_at = now(), anulat_de = auth.uid(), anulat_la = v_now,
         motiv_anulare = coalesce(v_r.anulare_ceruta_motiv, 'alt_motiv'), anulare_nota = coalesce(v_r.anulare_ceruta_nota, left(btrim(p_motiv), 200))
   WHERE id = p_id AND stare = 'generat' AND awb = p_awb;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: doar un AWB generat, neridicat, se anuleaza (CAS)' USING ERRCODE = 'P0001'; END IF;
  SET LOCAL redari_fan.garda = '';
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_awb', p_id, 'update', jsonb_build_object('stare', 'generat'), jsonb_build_object('eveniment', 'anulat', 'rezultat', 'owner', 'lot_id', v_r.lot_id, 'motiv_anulare', coalesce(v_r.anulare_ceruta_motiv, 'alt_motiv'), 'la', v_now), auth.uid());
END $fn$;

-- (0b) Marcajul manual (owner): lista stărilor „aprobat o dată” extinsă (o cerere în așteptare nu e o aprobare, dar nici un rest).
CREATE OR REPLACE FUNCTION public.fn_red_fan_lot_marcheaza(p_lot_id uuid, p_test boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_lot record; v_vechi record;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul marcheaza lotul' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_test IS NULL THEN RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT id, proiect_id INTO v_lot FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF v_lot.id IS NULL THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT lot_id, test, prima_aprobare_la INTO v_vechi FROM public.red_fan_loturi WHERE lot_id = p_lot_id FOR UPDATE;
  IF v_vechi.lot_id IS NOT NULL AND v_vechi.test = p_test THEN RETURN p_test; END IF;   -- repetare = no-op
  IF v_vechi.prima_aprobare_la IS NOT NULL OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'de_aprobat', 'eroare', 'anulat', 'retras')) THEN
    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; marcajul de test nu se mai schimba' USING ERRCODE = 'P0001'; END IF;
  IF v_vechi.lot_id IS NULL THEN
    INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de) VALUES (p_lot_id, v_lot.proiect_id, p_test, auth.uid());
  ELSE
    UPDATE public.red_fan_loturi SET test = p_test, marcat_de = auth.uid(), marcat_la = now() WHERE lot_id = p_lot_id;
  END IF;
  RETURN p_test;
END $fn$;

-- (0c) Tirajul: începerea / confirmarea = operator sau owner (clasa A; înlocuirea rămâne a owner-ului); la ÎNCEPERE + garda doar TEST (RD032) și
-- „lotul încheiat” (fn_red_fan_lot_incheiat, RD031, D15), evaluate sub lock-ul lotului. Restul corpului = 20261212a (runda 5).
CREATE OR REPLACE FUNCTION public.fn_red_fan_tiraj(p_lot_id uuid, p_cheie text, p_inlocuieste text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_fl record; v_stare text; v_la timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_red_fan_e_operator()
     OR (p_inlocuieste IS NOT NULL AND NOT public.fn_red_fan_e_owner()) THEN
    RAISE EXCEPTION 'redari fan: fara drept pe tiraj (operatorii numiti sau owner-ul; inlocuirea: doar owner-ul)' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_cheie IS NULL OR p_cheie !~ '^[0-9a-f]{64}$' OR (p_inlocuieste IS NOT NULL AND p_inlocuieste !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'redari fan: cheie de tiraj invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT lot_id, tiraj_cheie, tiraj_nr, tiraj_oprit_la INTO v_fl FROM public.red_fan_loturi WHERE lot_id = p_lot_id FOR UPDATE;
  IF v_fl.lot_id IS NULL THEN RAISE EXCEPTION 'redari fan: lot FAN nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  IF p_inlocuieste IS NULL THEN
    IF v_fl.tiraj_oprit_la IS NOT NULL THEN
      RAISE EXCEPTION 'redari fan: descarcarile tirajului nr. % sunt oprite (inlocuire in curs); nimic descarcat', v_fl.tiraj_nr USING ERRCODE = 'RD021'; END IF;
    IF v_fl.tiraj_cheie IS NOT DISTINCT FROM p_cheie THEN v_stare := 'acelasi';
    ELSIF v_fl.tiraj_cheie IS NULL THEN
      IF NOT public.fn_red_fan_lot_permis(p_lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
      IF NOT public.fn_red_fan_lot_incheiat(p_lot_id) THEN
        RAISE EXCEPTION 'redari fan: lotul nu e incheiat (plicuri in asteptare, aprobate netrimise, in curs sau cu rezultat necunoscut); AWB-urile se tiparesc dupa ce se termina trimiterea' USING ERRCODE = 'RD031'; END IF;
      v_stare := 'inceput';
    ELSE RAISE EXCEPTION 'redari fan: tirajul s-a schimbat (tirajul nr. % a inceput cu alt continut); retipareste tot lotul', v_fl.tiraj_nr USING ERRCODE = 'RD020';
    END IF;
  ELSE
    IF v_fl.tiraj_cheie IS DISTINCT FROM p_inlocuieste THEN
      RAISE EXCEPTION 'redari fan: tirajul s-a schimbat (tirajul nr. % a inceput cu alt continut); retipareste tot lotul', v_fl.tiraj_nr USING ERRCODE = 'RD020'; END IF;
    IF p_cheie = v_fl.tiraj_cheie THEN v_stare := 'acelasi';
    ELSIF v_fl.tiraj_oprit_la IS NULL OR v_fl.tiraj_oprit_la > clock_timestamp() - interval '30 seconds' THEN
      RAISE EXCEPTION 'redari fan: opreste intai descarcarile tirajului nr. % si asteapta 30 de secunde, distruge foile, apoi inlocuieste', v_fl.tiraj_nr USING ERRCODE = 'RD022';
    ELSE v_stare := 'inlocuit';
    END IF;
  END IF;
  IF v_stare <> 'acelasi' THEN
    v_la := clock_timestamp();
    UPDATE public.red_fan_loturi SET tiraj_cheie = p_cheie, tiraj_nr = tiraj_nr + 1, tiraj_la = v_la, tiraj_de = auth.uid(),
           tiraj_oprit_la = NULL, tiraj_oprit_de = NULL WHERE lot_id = p_lot_id;
    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
    VALUES ('red_fan_loturi', p_lot_id, 'update',
            jsonb_build_object('tiraj_cheie', v_fl.tiraj_cheie, 'tiraj_nr', v_fl.tiraj_nr, 'tiraj_oprit_la', v_fl.tiraj_oprit_la),
            jsonb_build_object('eveniment', 'tiraj_' || v_stare, 'tiraj_cheie', p_cheie, 'tiraj_nr', v_fl.tiraj_nr + 1, 'la', v_la), auth.uid());
  END IF;
  RETURN (SELECT jsonb_build_object('stare', v_stare, 'cheie', tiraj_cheie, 'nr', tiraj_nr, 'inceput_la', tiraj_la, 'oprit_la', tiraj_oprit_la)
            FROM public.red_fan_loturi WHERE lot_id = p_lot_id);
END $fn$;

-- ═══ 11. View-urile (security_invoker: RLS-ul tabelelor de dedesubt) ═══
-- Plafonul zilei pentru ecran: aceeași zi (Europe/Bucharest) ca în fn_red_fan_comanda (L17 / L19); „cât mai încape” calculat în SQL.
CREATE VIEW public.v_red_fan_plafon_azi WITH (security_invoker = on) AS
  SELECT (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date AS zi_ro, s.limita_zi, coalesce(z.aprobate, 0) AS aprobate,
         greatest(0, s.limita_zi - coalesce(z.aprobate, 0)) AS incap, s.doar_proiecte_test, s.presupunere_429, s.limita_lot
    FROM public.red_fan_setari s
    LEFT JOIN public.red_fan_zi z ON z.zi_ro = (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date;
-- Lista anulărilor pentru owner (spec §8.4.1): cererile deschise și anulările confirmate; „avea foaia tipărită” = NULL (necunoscut) până la F1b (L18).
CREATE VIEW public.v_red_fan_anulari WITH (security_invoker = on) AS
  SELECT a.id, a.lot_id, l.nr_lot, a.proiect_id, a.nr_plic, a.awb, a.stare, a.anulare_ceruta_de, a.anulare_ceruta_la, a.anulare_ceruta_motiv, a.anulare_ceruta_nota,
         a.anulat_de, a.anulat_la, a.motiv_anulare, a.anulare_nota, NULL::boolean AS foaie_tiparita
    FROM public.red_fan_awb a JOIN public.red_loturi_plicuire l ON l.id = a.lot_id
   WHERE a.anulare_ceruta_la IS NOT NULL OR a.anulat_la IS NOT NULL;
-- Intențiile pentru ecran („Reia trimiterea” / „Verifică la curier” la redeschidere): sumarul numărat din rânduri, nu din memo.
CREATE VIEW public.v_red_fan_intentii WITH (security_invoker = on) AS
  SELECT i.cheie, i.lot_id, i.proiect_id, i.operator, i.hash_cerere, i.stare, i.lucru_pana_la, i.inceput_la, i.incheiata_la, i.incheiata_de, i.rezultat,
         (SELECT count(*) FROM public.red_fan_awb a WHERE a.intentie_cheie = i.cheie AND a.stare = 'aprobat') AS ramase,
         (SELECT count(*) FROM public.red_fan_awb a WHERE a.intentie_cheie = i.cheie AND a.stare IN ('in_curs', 'necunoscut')) AS necunoscute,
         (SELECT count(*) FROM public.red_fan_awb a WHERE a.intentie_cheie = i.cheie AND a.stare IN ('generat', 'ridicat')) AS generate,
         (SELECT count(*) FROM public.red_fan_awb a WHERE a.intentie_cheie = i.cheie AND a.stare = 'de_aprobat') AS de_aprobat
    FROM public.red_fan_intentii i;
REVOKE ALL ON public.v_red_fan_plafon_azi, public.v_red_fan_anulari, public.v_red_fan_intentii FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_red_fan_plafon_azi, public.v_red_fan_anulari, public.v_red_fan_intentii TO authenticated, service_role;

-- ═══ 12. Drepturile pe funcții: totul retras, apoi EXECUTE exact pe clasă (A / C: authenticated; B: service_role; interne: nimeni) ═══
REVOKE ALL ON FUNCTION public.fn_red_fan_lot_permis_valori(boolean, text, boolean), public.fn_red_fan_lot_permis(uuid), public.fn_red_fan_lot_incheiat(uuid),
  public.fn_red_fan_e_operator_profil(uuid), public.fn_red_fan_intentie_sumar(uuid), public.fn_red_fan_intentie_incheie_intern(uuid, text, jsonb),
  public.fn_red_fan_zi_garda(), public.fn_red_fan_awb_garda(), public.fn_red_fan_e_operator(), public.fn_red_fan_operator_seteaza(uuid, boolean, text),
  public.fn_red_fan_setari_limita_zi(integer), public.fn_red_fan_setari_doar_test(boolean), public.fn_red_fan_setari_presupunere_429(boolean, text),
  public.fn_red_fan_retrage(uuid, text), public.fn_red_fan_cerere_decide(uuid, boolean, text), public.fn_red_fan_cerere_retrage(uuid),
  public.fn_red_fan_anulare_cere(uuid, text, text, text), public.fn_red_fan_comanda(uuid, uuid, jsonb, text, boolean),
  public.fn_red_fan_claim_intern(uuid, uuid[], text[], text[], uuid, uuid, boolean), public.fn_red_fan_rezultate_intern(uuid, jsonb, integer, uuid, uuid),
  public.fn_red_fan_urmarire_intern(uuid, jsonb), public.fn_red_fan_confirmari_intern(uuid, jsonb),
  public.fn_red_fan_reconciliaza_intern(uuid, text, numeric, numeric, text, uuid, boolean), public.fn_red_fan_srv_poarta(uuid, boolean),
  public.fn_red_fan_srv_claim(uuid, uuid, uuid, uuid[], text[], text[]), public.fn_red_fan_srv_rezultate(uuid, uuid, uuid, jsonb, integer),
  public.fn_red_fan_srv_urmarire(uuid, uuid, uuid, jsonb), public.fn_red_fan_srv_confirmari(uuid, uuid, uuid, jsonb),
  public.fn_red_fan_srv_reconciliaza(uuid, uuid, text, numeric, numeric), public.fn_red_fan_srv_anuleaza(uuid, uuid, text, text),
  public.fn_red_fan_srv_intentie_incheie(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_fan_e_operator(), public.fn_red_fan_operator_seteaza(uuid, boolean, text), public.fn_red_fan_setari_limita_zi(integer),
  public.fn_red_fan_setari_doar_test(boolean), public.fn_red_fan_setari_presupunere_429(boolean, text), public.fn_red_fan_retrage(uuid, text),
  public.fn_red_fan_cerere_decide(uuid, boolean, text), public.fn_red_fan_cerere_retrage(uuid), public.fn_red_fan_anulare_cere(uuid, text, text, text),
  public.fn_red_fan_comanda(uuid, uuid, jsonb, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_red_fan_srv_claim(uuid, uuid, uuid, uuid[], text[], text[]), public.fn_red_fan_srv_rezultate(uuid, uuid, uuid, jsonb, integer),
  public.fn_red_fan_srv_urmarire(uuid, uuid, uuid, jsonb), public.fn_red_fan_srv_confirmari(uuid, uuid, uuid, jsonb),
  public.fn_red_fan_srv_reconciliaza(uuid, uuid, text, numeric, numeric), public.fn_red_fan_srv_anuleaza(uuid, uuid, text, text),
  public.fn_red_fan_srv_intentie_incheie(uuid, uuid, jsonb) TO service_role;

-- ═══ 13. Postcondiții ═══
DO $post$
DECLARE r record; v_rau text; v_n integer;
BEGIN
  -- tabelele noi: RLS activ (fără FORCE), proprietar postgres, exact o politică de citire, drepturi doar SELECT pentru authenticated / service_role
  FOR r IN SELECT * FROM (VALUES ('red_fan_operatori'), ('red_fan_zi'), ('red_fan_zi_consum'), ('red_fan_cereri_aprobare'), ('red_fan_intentii')) v(t) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = ('public.' || r.t)::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner) = 'postgres')
       OR (SELECT count(*) FROM pg_policy WHERE polrelid = ('public.' || r.t)::regclass) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = ('public.' || r.t)::regclass AND pol.polname = r.t || '_citire' AND pol.polcmd = 'r'
                        AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polwithcheck IS NULL
                        AND pg_get_expr(pol.polqual, pol.polrelid) = '((auth.uid() IS NOT NULL) AND (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text])))') THEN
      RAISE EXCEPTION '20261228a post: RLS / politica pe %', r.t;
    END IF;
  END LOOP;
  SELECT string_agg(DISTINCT x.t || '/' || y.rol || '/' || z.drept, ', ') INTO v_rau
    FROM unnest(ARRAY['red_fan_setari', 'red_fan_loturi', 'red_fan_awb', 'red_fan_operatori', 'red_fan_zi', 'red_fan_zi_consum', 'red_fan_cereri_aprobare', 'red_fan_intentii',
                      'v_red_fan_plafon_azi', 'v_red_fan_anulari', 'v_red_fan_intentii']) x(t),
         unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
   WHERE has_table_privilege(y.rol, ('public.' || x.t)::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol <> 'anon');
  IF v_rau IS NOT NULL
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['red_fan_operatori', 'red_fan_zi', 'red_fan_zi_consum', 'red_fan_cereri_aprobare', 'red_fan_intentii', 'v_red_fan_plafon_azi', 'v_red_fan_anulari', 'v_red_fan_intentii']) x(t)
                  JOIN pg_class c ON c.oid = ('public.' || x.t)::regclass CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE e.grantee = 0)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['red_fan_setari', 'red_fan_awb', 'red_fan_operatori', 'red_fan_zi', 'red_fan_zi_consum', 'red_fan_cereri_aprobare', 'red_fan_intentii']) x(t)
                  JOIN pg_attribute a ON a.attrelid = ('public.' || x.t)::regclass WHERE a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261228a post: drepturi pe tabele / view-uri (%)', coalesce(v_rau, 'PUBLIC / coloane');
  END IF;
  FOR r IN SELECT * FROM (VALUES ('v_red_fan_plafon_azi'), ('v_red_fan_anulari'), ('v_red_fan_intentii')) v(t) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = ('public.' || r.t)::regclass AND c.relkind = 'v' AND c.reloptions @> ARRAY['security_invoker=on'] AND pg_get_userbyid(c.relowner) = 'postgres') THEN
      RAISE EXCEPTION '20261228a post: view-ul % nu e security_invoker', r.t;
    END IF;
  END LOOP;
  -- funcțiile: exact 52 fn_red_fan_* (21 ale bazei 20261212a + 20261227a, dintre care 11 înlocuite, + 31 noi), fiecare cu corpul (AMPRENTE-NOI), limbajul, DEFINER, volatilitatea, tipul întors, proprietarul și EXECUTE EXACT pe clasă
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      -- >>> AMPRENTE-NOI 20261228a (semnătura, md5(replace(prosrc, chr(13), '')), limbaj, DEFINER, volatilitate, tipul întors, EXECUTE authenticated, EXECUTE service_role)
      ('public.fn_red_fan_anulare_cere(uuid,text,text,text)', 'ca53da3cbf13b5dc8edb2e24ddfe2f85', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_anulat(uuid,text,text)', '6af4ea9ab74f812a29a82ee076550ff2', 'plpgsql', true, 'v', 'void', true, false),
      ('public.fn_red_fan_aproba(uuid,uuid[],text[])', 'f19e630e2e105cab2f0d65f18dcf47d8', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_awb_garda()', '7e8e1302f342d268bcd4a8c9906bce4f', 'plpgsql', false, 'v', 'trigger', false, false),
      ('public.fn_red_fan_camp(text)', 'b3a822a4a5f35ccdd65460af7e81d635', 'sql', false, 'i', 'text', false, false),
      ('public.fn_red_fan_cerere_decide(uuid,boolean,text)', '7515320fedb0b29fa2c23bc9d685966f', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_cerere_retrage(uuid)', '1825378bc3b3ae1f799186cd53e8c409', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_claim_intern(uuid,uuid[],text[],text[],uuid,uuid,boolean)', 'c36df6081bb2e28766f0d5e6e31def02', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_claim_lot(uuid,uuid[],text[],text[])', 'bb7fe9239528916d08e5e9a905fe587f', 'plpgsql', true, 'v', 'uuid', true, false),
      ('public.fn_red_fan_comanda(uuid,uuid,jsonb,text,boolean)', '437ae4f2662ea5626aa0dff220fdfa3c', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_confirmari(uuid,jsonb)', 'da2e4ec6ab90886ffcf40a7dbc5562ca', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_confirmari_intern(uuid,jsonb)', 'f34677deebaf08abb03deec737e9db05', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_e_operator()', 'e1c0af5d6997c9c751929bcf652edc10', 'sql', true, 's', 'boolean', true, false),
      ('public.fn_red_fan_e_operator_profil(uuid)', 'c3ebc7662c7a99cf9122c7d0b0905671', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_e_owner()', '941c20690f2ae0cda77869a1d865ea69', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_intentie_incheie_intern(uuid,text,jsonb)', 'ac018ee8fe12ca3e8fe087a08c42ebf3', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_intentie_sumar(uuid)', '706c9c1fb43ee56f2ef030f7e226c62d', 'sql', true, 's', 'jsonb', false, false),
      ('public.fn_red_fan_lot_incheiat(uuid)', 'a788cd02f2ccbbf5fc6b1b5515790c58', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_lot_marcheaza(uuid,boolean)', '49a056c348411ba320061c4da1ab3c25', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_lot_permis(uuid)', '74a3a78930b42f6100c2d76917461475', 'sql', true, 's', 'boolean', false, false),
      ('public.fn_red_fan_lot_permis_valori(boolean,text,boolean)', '1b1110d5bb4934075e626e23a49e8d79', 'sql', false, 'i', 'boolean', false, false),
      ('public.fn_red_fan_loturi_garda()', '5f167c38850bbfc30cb29c0a0fd734ad', 'plpgsql', false, 'v', 'trigger', false, false),
      ('public.fn_red_fan_lot_opod(uuid,boolean)', 'b591ff764adede2b335b96e89e41aaca', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_awb_opod_jurnal()', '76c319ae5359d29b0056ecb789054fe4', 'plpgsql', true, 'v', 'trigger', false, false),
      ('public.fn_red_fan_operator_seteaza(uuid,boolean,text)', '2312ff35d3b98c5a0fb41a4d385166de', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_propune(uuid,text,numeric)', '98ed533dba82a221c3e874aee2af62d5', 'plpgsql', true, 'v', 'uuid', true, false),
      ('public.fn_red_fan_reconciliaza(uuid,text,numeric,numeric,text)', '95d5b20b47d04dd11ba230017d8fde85', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_reconciliaza_intern(uuid,text,numeric,numeric,text,uuid,boolean)', '64afc6f76bcd26692ad694f8297d6334', 'plpgsql', true, 'v', 'text', false, false),
      ('public.fn_red_fan_retrage(uuid,text)', '1c786f1641f82f0287f2e8ee943465e9', 'plpgsql', true, 'v', 'text', true, false),
      ('public.fn_red_fan_rezultate(uuid,jsonb)', 'f2a5a8d722a06dc34e5060321be15e12', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_rezultate_intern(uuid,jsonb,integer,uuid,uuid)', 'c46607410f5b6c8cdcb6710d0f9f2982', 'plpgsql', true, 'v', 'integer', false, false),
      ('public.fn_red_fan_ridicat(uuid,date)', '99fc55589bdf77c775d7ae1046edd537', 'plpgsql', true, 'v', 'void', true, false),
      ('public.fn_red_fan_setari_doar_test(boolean)', '5ca6a20b3ff16f37ee0fb497194a6c83', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_setari_limita_zi(integer)', 'e6b5c61362b113c681298a8a66c0e2ca', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_setari_presupunere_429(boolean,text)', 'd7aa9ac982db4139f048452b7e71ff9f', 'plpgsql', true, 'v', 'boolean', true, false),
      ('public.fn_red_fan_setari_seteaza(integer)', 'c1be717db01d6bfd7a4c05ec18a7e24f', 'plpgsql', true, 'v', 'integer', true, false),
      ('public.fn_red_fan_srv_anuleaza(uuid,uuid,text,text)', '08958a14896e5b07c0892567f012c90d', 'plpgsql', true, 'v', 'text', false, true),
      ('public.fn_red_fan_srv_claim(uuid,uuid,uuid,uuid[],text[],text[])', 'b8625e36c2dfec0a549287391b83374e', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_confirmari(uuid,uuid,uuid,jsonb)', 'a142ed8f327967633ed3b1e1bc334e87', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_intentie_incheie(uuid,uuid,jsonb)', '1017ae767ed3d8f947a18f8d3b9c2c6d', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_poarta(uuid,boolean)', 'eae0c2fa2fc3ec18b44ce55b60a96848', 'plpgsql', true, 's', 'void', false, false),
      ('public.fn_red_fan_srv_reconciliaza(uuid,uuid,text,numeric,numeric)', '38e16206cef4468c73e2cf103b163127', 'plpgsql', true, 'v', 'text', false, true),
      ('public.fn_red_fan_srv_rezultate(uuid,uuid,uuid,jsonb,integer)', '216688178ad5d77bb059054a96a31a7a', 'plpgsql', true, 'v', 'integer', false, true),
      ('public.fn_red_fan_srv_urmarire(uuid,uuid,uuid,jsonb)', '63ffdb70ebefb68fc1e944e0cd7305c7', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_suma(numeric)', 'e4c468b1a27473db01ba7cfd15421a7d', 'sql', false, 'i', 'numeric', false, false),
      ('public.fn_red_fan_surse(uuid)', 'dd250f175d559976c72412ded8a1ae06', 'sql', false, 's', 'text', false, false),
      ('public.fn_red_fan_tiraj(uuid,text,text)', '36cafe6b98cf2436e5ffb42370139765', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_tiraj_opreste(uuid,text,boolean)', '63b507c349b2961c032468a3d542212a', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire(uuid,jsonb)', '966a88fd8c20655714cf7a72dc25e748', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire_intern(uuid,jsonb)', '40109588fdeb59c56784ab4b7ff616be', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_urmarire_solutioneaza(uuid,integer,jsonb,text)', 'd286bb9f78d01f751eb123b0eb8ca5a5', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_zi_garda()', '5c51181772f185ac5559913dd32918ec', 'plpgsql', true, 'v', 'trigger', false, false)
      -- <<< AMPRENTE-NOI 20261228a
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce, exec_auth, exec_srv)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_auth
      OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_srv
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0);
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261228a post: functiile (corp / proprietati / EXECUTE) difera: %', v_rau; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%';
  IF v_n <> 52 THEN RAISE EXCEPTION '20261228a post: numarul functiilor fn_red_fan_* este %, asteptat 52', v_n; END IF;
  -- runda 4 (proba pe clonă: poarta 0e a runnerului + poarta Izometrie E2): (a) marcajul gărzii rândului FAN e scris DOAR de cele 7 funcții ale
  -- listelor trigger-ului (valoarea fn_red_fan_srv_claim o scrie corpul comun fn_red_fan_claim_intern), cu instrucțiunea statică SET LOCAL, în toate schemele non-sistem, și nu apare în proconfig-ul niciunei funcții (ca la
  -- 20261130l); (b) niciun corp fn_red_fan_* nu cheamă funcția de configurare și nu numește calea de căutare (sămânța „mutatorilor de cale” a
  -- porții E2: un trigger peste un astfel de corp e „invocare implicită neanalizată”) și nu are SQL dinamic (sămânța închiderii citirilor E2;
  -- motivul „execute” al porții 0e). Sunt aceleași tipare ca în porți, pe corpul fără CR.
  IF (SELECT array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
         AND (p.prosrc ~* 'set\s+(local\s+|session\s+)?redari_fan\.garda' OR p.prosrc ~* 'set_config\s*\(\s*''redari_fan\.garda'))
     IS DISTINCT FROM ARRAY['fn_red_fan_anulare_cere', 'fn_red_fan_anulat', 'fn_red_fan_cerere_decide', 'fn_red_fan_claim_intern', 'fn_red_fan_comanda',
                            'fn_red_fan_retrage', 'fn_red_fan_srv_anuleaza']::text[]
     OR EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c WHERE c ILIKE 'redari_fan.garda=%') THEN
    RAISE EXCEPTION '20261228a post: marcajul redari_fan.garda e scris de alte functii decat cele 7 de pe listele trigger-ului (sau apare in proconfig)';
  END IF;
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_rau FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%'
     AND (p.prosrc ~* '(set_config|search_path)' OR p.prosrc ~* '\mexecute\M');
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20261228a post: corpuri fn_red_fan_* prinse de portile 0e / Izometrie E2 (configurare, cale de cautare sau SQL dinamic): %', v_rau;
  END IF;
  -- trigger-ele: exact (tgqual NULL, fără argumente, tipul), activ; red_fan_awb are garda F1 + jurnalul 20261227a neatins; red_fan_zi DOAR garda;
  -- red_fan_loturi neschimbat
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_garda' AND tg.tgenabled = 'O'
                      AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_red_fan_awb_garda()'::regprocedure AND tg.tgtype = (1 | 2 | 16))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_opod_jurnal' AND tg.tgenabled = 'O'
                      AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_red_fan_awb_opod_jurnal()'::regprocedure AND tg.tgtype = (1 | 4 | 8 | 16)
                      AND tg.tgattr::text = '')
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_zi'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_zi'::regclass AND tg.tgname = 'trg_red_fan_zi_garda' AND tg.tgenabled = 'O'
                      AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_red_fan_zi_garda()'::regprocedure AND tg.tgtype = (1 | 2 | 4 | 16))
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_loturi'::regclass AND NOT tgisinternal) <> 1
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.red_fan_setari'::regclass, 'public.red_fan_operatori'::regclass, 'public.red_fan_cereri_aprobare'::regclass, 'public.red_fan_intentii'::regclass, 'public.red_fan_zi_consum'::regclass) AND NOT tgisinternal) THEN
    RAISE EXCEPTION '20261228a post: trigger-ele';
  END IF;
  -- CHECK-urile derivate din §8.8 și indexurile unice noi
  FOR r IN SELECT * FROM (VALUES ('red_fan_awb_stare_check'), ('red_fan_awb_aprobare'), ('red_fan_awb_generat'), ('red_fan_awb_retras'), ('red_fan_awb_anulat'),
                                 ('red_fan_awb_anulare_cerere'), ('red_fan_awb_anulare_conf'), ('red_fan_awb_de_aprobat'), ('red_fan_awb_ridicat'), ('red_fan_awb_in_curs')) v(c) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_fan_awb'::regclass AND conname = r.c AND contype = 'c' AND convalidated) THEN
      RAISE EXCEPTION '20261228a post: CHECK-ul % lipseste', r.c; END IF;
  END LOOP;
  IF (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_awb_plic_viu_uq')
       IS DISTINCT FROM 'CREATE UNIQUE INDEX red_fan_awb_plic_viu_uq ON public.red_fan_awb USING btree (plic_id) WHERE (stare <> ALL (ARRAY[''eroare''::text, ''anulat''::text, ''retras''::text]))'
     OR NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_intentii_lot_in_curs_uq' AND i.indisunique)
     OR NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_cereri_aprobare_lot_deschisa_uq' AND i.indisunique) THEN
    RAISE EXCEPTION '20261228a post: indexurile unice';
  END IF;
  -- coloanele noi, setările implicite, backfill-ul complet
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_awb'
        AND column_name IN ('cerere_aprobare_id', 'aprobare_owner_la', 'intentie_cheie', 'retras_de', 'retras_la', 'motiv_retragere', 'anulare_ceruta_de', 'anulare_ceruta_la',
                            'anulare_ceruta_motiv', 'anulare_ceruta_nota', 'anulat_de', 'anulat_la', 'motiv_anulare', 'anulare_nota')) <> 14
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_setari' AND column_name IN ('limita_zi', 'doar_proiecte_test', 'presupunere_429')) <> 3 THEN
    RAISE EXCEPTION '20261228a post: coloanele noi lipsesc';
  END IF;
  IF (SELECT count(*) FROM public.red_fan_setari) <> 1 OR EXISTS (SELECT 1 FROM public.red_fan_setari WHERE limita_zi <> 20 OR doar_proiecte_test IS NOT TRUE OR presupunere_429 IS NOT TRUE) THEN
    RAISE EXCEPTION '20261228a post: setarile implicite (limita_zi 20, doar_proiecte_test, presupunere_429)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_awb WHERE (stare = 'anulat') <> (anulat_la IS NOT NULL)) OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE stare IN ('de_aprobat', 'retras'))
     OR EXISTS (SELECT 1 FROM public.red_fan_operatori) OR EXISTS (SELECT 1 FROM public.red_fan_zi) OR EXISTS (SELECT 1 FROM public.red_fan_cereri_aprobare) OR EXISTS (SELECT 1 FROM public.red_fan_intentii) THEN
    RAISE EXCEPTION '20261228a post: backfill incomplet sau tabele noi cu randuri';
  END IF;
  -- nimic scris în red_jurnal de această migrare (nici de trigger-ul de jurnal al 20261227a la backfill): revenirea 20261227a / 20261228a nu vede urme false
  IF EXISTS (SELECT 1 FROM public.red_jurnal j WHERE j.xmin::text = (txid_current() % 4294967296)::text) THEN
    RAISE EXCEPTION '20261228a post: migrarea a scris in red_jurnal (trigger-ul de jurnal 20261227a la backfill?)';
  END IF;
  -- predicatele pure (paritate L19 cu esteProiectTest / transportPermis): doar TEST- exact, cu lotul marcat TEST, cât garda e pornită
  IF public.fn_red_fan_lot_permis_valori(true, 'TEST-RAZVAN', true) IS NOT TRUE OR public.fn_red_fan_lot_permis_valori(false, 'TEST-RAZVAN', true) IS NOT FALSE
     OR public.fn_red_fan_lot_permis_valori(true, 'test-razvan', true) IS NOT FALSE OR public.fn_red_fan_lot_permis_valori(true, ' TEST-X', true) IS NOT FALSE
     OR public.fn_red_fan_lot_permis_valori(NULL, 'TEST-RAZVAN', true) IS NOT FALSE OR public.fn_red_fan_lot_permis_valori(true, NULL, true) IS NOT FALSE
     OR public.fn_red_fan_lot_permis_valori(false, 'LOT1-X', false) IS NOT TRUE OR public.fn_red_fan_lot_permis_valori(false, 'LOT1-X', NULL) IS NOT FALSE THEN
    RAISE EXCEPTION '20261228a post: fn_red_fan_lot_permis_valori';
  END IF;
  RAISE NOTICE '20261228a: sfarsit la % ms de la BEGIN; lock-uri puternice tinute de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;

-- L15: lanțul verificat și DUPĂ pentru poarta de drept neschimbată (fn_red_nivel); garda finală; funcția pg_temp se șterge
DO $l15_dupa$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_nivel()') AND md5(replace(p.prosrc, chr(13), '')) = '21db8e5d4b69b7f19e571a7087c361ae'
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20261228a: poarta de drept (dupa) difera de amprenta revizuita';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261228a_redari_fan_operator:' || txid_current() OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '20261228a: garda final invalida';
  END IF;
END $l15_dupa$;
DROP FUNCTION pg_temp.lant_20261228a();
