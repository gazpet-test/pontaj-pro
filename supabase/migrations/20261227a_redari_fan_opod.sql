-- Version 20261227120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261227a_redari_fan_opod.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului în
--   aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 v2 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ a runnerului; manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh); lista OBIECTELOR pe care trebuie să le conțină (familie, etichetă, operație — verificată pe PGlite cu pașii
--   reali ai runnerului) e în supabase/tests/20261227a_redari_fan_opod.l15.obiecte.tsv. Pe lângă ea, migrarea verifică pe amprentă (corp fără CR +
--   proprietăți + drepturi, ÎNAINTE și DUPĂ) funcția pe care o înlocuiește (fn_red_fan_loturi_garda) și funcțiile din 20261212a de care depinde
--   regula ei (fn_red_fan_e_owner, fn_red_fan_lot_marcheaza, fn_red_fan_aproba, fn_red_fan_claim_lot, fn_red_fan_propune), plus poarta fn_red_nivel.
-- 20261227a_redari_fan_opod — Redări FAN Courier: confirmarea de primire în ORIGINAL (opțiunea B, „oPOD”, +14 lei / plic după ofertă) devine o
--   ALEGERE explicită a owner-ului, pe lot, implicit OPRITĂ. De ce (18.11.2026): primul AWB real al Testului 1 a costat 27,16 lei în loc de 13,16,
--   pentru că codul trimitea mereu options = ['B'] (proiectarea din 06.11.2026), deși la întâlnirea cu curierul din 09.11.2026 proprietarul decisese
--   „fără oPOD, confirmarea electronică de pe terminalul curierului”. Decizia proprietarului din 18.11.2026: oPOD rămâne posibil, dar doar cerut.
--   * red_fan_loturi.opod boolean NOT NULL DEFAULT false (coloană nouă; implicitul = fără oPOD, exact ce a decis proprietarul pe 09.11);
--     ISTORICUL (Jakarinos #1135 r1 P2, „AWB-ul taxat cu oPOD”): până la această migrare codul (redariFan.mjs::CONFIG_FAN_PLIC, options ['B'])
--     trimitea MEREU B, deci hash-urile aprobate și AWB-urile generate înainte au avut oPOD. DEDUCERE aplicată pe rândurile existente, sub lock:
--     opod = true pe orice lot cu o aprobare în istoric (prima_aprobare_la IS NOT NULL — pusă de fn_red_fan_aproba la prima aprobare, imuabilă —
--     SAU vreun rând red_fan_awb în altă stare decât 'propus': aprobat / in_curs / generat / eroare / necunoscut / anulat / ridicat, toate după
--     o aprobare); loturile fără nicio aprobare (doar propuneri sau nimic) rămân false. Așa (1) ecranul arată „oPOD” pe AWB-ul deja taxat
--     cu oPOD, (2) hash-urile deja propuse / aprobate pe loturile aprobate (calculate cu B) rămân valabile, (3) un lot aprobat o dată nu
--     își mai poate schimba alegerea (regula de mai jos), deci istoricul nu se falsifică. Numărătoarea e în NOTICE și în postcondiții.
--   * MARCAJ DE INSTALARE în red_jurnal (append-only, fără trigger pe red_fan_loturi): un rând (tabela 'red_fan_loturi', inregistrare_id NULL,
--     actiune 'insert', date_noi {eveniment:'opod_instalat', la, loturi_opod:[lot_id…], n_loturi, n_opod}) cu momentul aplicării (now() al
--     tranzacției) și lista loturilor deduse. Revenirea îl citește ca să deosebească datele PREEXISTENTE de folosirea de DUPĂ aplicare (L14) și
--     scrie 'opod_dezinstalat'; reaplicarea cere istoricul echilibrat (câte 'opod_instalat', atâtea 'opod_dezinstalat').
--   * fn_red_fan_lot_opod(p_lot_id, p_opod) — DOAR owner, prin RPC (nu UPDATE direct), DOAR pe un lot marcat (TEST / real) și DOAR înainte de
--     PRIMA aprobare a lotului (istoric: prima_aprobare_la; și fără rânduri aprobate / trimise în stările curente), ca pretul aprobat să nu se
--     schimbe între aprobare și generare; repetarea aceleiași valori = no-op; fiecare schimbare = un rând în red_jurnal (tabela red_fan_loturi,
--     evenimentul 'opod_schimbat', valoarea veche → nouă, autorul = auth.uid(), momentul efectiv), în aceeași tranzacție (L02);
--   * fn_red_fan_loturi_garda() înlocuită (CREATE OR REPLACE, același trigger trg_red_fan_loturi_garda): după prima aprobare NICI opod nu se mai
--     schimbă, pe ORICE cale (L07), ca marcajul TEST / real.
--   Unde se folosește valoarea: ecranul și funcția edge construiesc corpul fiecărui plic cu options = ['B'] DOAR dacă lotul are opod = true
--   (redariFan.mjs::configPlicFan, aceeași funcție în ambele, L19); corpul intră în hash-ul aprobat (red_fan_awb.hash_date) → valoarea folosită la
--   generare e EXACT cea văzută la aprobare: o alegere diferită după aprobare ar da alt hash, exclus de la generare și refuzat de claim — și oricum
--   e interzisă de RPC + trigger după prima aprobare. Nicio funcție existentă nu se schimbă în afara gărzii; singura dată existentă rescrisă e
--   coloana nouă (deducerea istorică de mai sus), iar red_jurnal primește marcajul de instalare.
-- FĂRĂ migrare (codul publicat înainte): citirea lotului (redariFan.mjs::citesteLotFan, aceeași în ecran și în funcția edge) tolerează lipsa
--   coloanei (opod = null): marcajul, urmărirea, confirmările, etichetele, reconcilierea, ștergerea merg ca înainte; DOAR generarea refuză (503,
--   nimic trimis) până la aplicare. Nu există ordine obligatorie față de 20261131h (atinge red_proiecte / citește red_fan_awb; trigger pe alt
--   tabel); manifestele L15 se generează pe clonă în ordinea efectivă de aplicare, cu baseline-ul actualizat după fiecare. Runda 4: forma
--   20261131h de pe main (#1134) citește din tabelele FAN DOAR red_fan_awb (stare, proiect_id; CHECK-ul stărilor + trigger-ul pe red_proiecte) și
--   nu scrie red_fan_awb / red_fan_loturi → trigger-ul nostru de jurnal nu se declanșează din ea. O altă formă a lui 20261131h (care ar citi și
--   red_fan_loturi sau ar scrie red_fan_awb) se verifică separat înainte de aplicare (amprenta funcției pe clonă = forma de pe main).
-- ORDINEA OBLIGATORIE COD → MIGRARE (runda 3, Jakarinos #1135 r2 P2): deducerea istorică de mai sus presupune că ORICE aprobare de dinaintea
--   aplicării a fost făcută cu hash-uri calculate cu B (codul vechi). De aceea codul se publică ÎNTÂI, iar migrarea se aplică DUPĂ ce ecranul nou e
--   live: cât coloana opod lipsește, ecranul nou NU permite propunerea, aprobarea și generarea (fanLot.js::stariPasi, motivul MESAJ_OPOD_NEINSTALAT_PASI;
--   doar citirea și acțiunile care nu creează rezultate noi: marcaj, urmărire, confirmări, etichete, reconciliere, ștergere), iar funcția edge
--   nouă refuză generarea (503). Așa nicio aprobare „fără B” nu poate preceda backfill-ul. Ordinea inversă (migrarea înaintea codului) NU e
--   sigură: codul vechi trimite B indiferent de coloană, deci un AWB generat în fereastra dintre aplicare și publicare ar sta pe un lot cu
--   opod = false → istoric falsificat. Verificarea coordonatorului ÎNAINTE de aplicare: pe un lot FAN din ERP (după Ctrl+Shift+R) „1. Propune” /
--   „2c. Aprobă” / „3. Generează AWB” sunt dezactivate cu motivul „alegerea oPOD nu e instalată”. RPC-urile din BD (fn_red_fan_propune / _aproba
--   din 20261212a) nu pot fi făcute să refuze „cât coloana lipsește” fără o migrare — adică exact migrarea aceasta — deci garda din BD nu există;
--   gardă există în ecran (singurul client) și în funcția edge (pasul plătit).
-- DOVADA DURABILĂ A FOLOSIRII DUPĂ APLICARE (runda 3, Jakarinos #1135 r2 P2, L14): o aprobare lasă urme în red_fan_awb (aprobat_la) și în
--   red_fan_loturi (prima_aprobare_la), dar re-propunerea șterge aprobat_la (20261212a:521), iar pe un lot DEJA aprobat înainte de migrare (în
--   lista dedusă) prima_aprobare_la nu spune nimic despre aprobările noi → revenirea ar fi acceptat „lot vechi → aprobare nouă → re-propunere”.
--   Soluția: trigger AFTER pe red_fan_awb (fn_red_fan_awb_opod_jurnal, SECURITY DEFINER ca fn_red_jurnal din 20261126a; runda 4: INSERT OR
--   UPDATE OR DELETE, la ORICE pas al ciclului de viață — vezi „RUNDA 4” mai jos; textul de aici descrie partea aprobărilor):
--   la FIECARE trecere a unui rând în 'aprobat' scrie în red_jurnal (append-only, trigger-ul trg_red_jurnal_imuabil) evenimentul 'opod_aprobare'
--   (tabela 'red_fan_awb', inregistrare_id = rândul, lotul, alegerea oPOD a lotului în acel moment, hash-ul aprobat, autorul = auth.uid(),
--   momentul). Nimic nu-l șterge: nici re-propunerea, nici anularea, nici revenirea. Revenirea refuză la ORICE eveniment 'opod_aprobare' (pe
--   conținut, nu pe timp); migrarea cere în $pre$ că nu există niciunul (trigger-ul nu exista înainte, iar o revenire nu trece cu el prezent).
--   Aprobarea „în zbor” (RPC pornit înainte de BEGIN-ul nostru, blocat pe lock-ul red_fan_awb): după COMMIT-ul nostru UPDATE-ul lui rulează cu
--   trigger-ul deja creat (lock-ul SHARE ROW EXCLUSIVE al lui CREATE TRIGGER garantează exact asta) → evenimentul există → revenirea refuză.
-- Identitatea = auth.uid() (L08); niciun parametru de utilizator. Ordinea lock-urilor la rulare (L06), ca în 20261212a: red_loturi_plicuire FOR
--   UPDATE → red_fan_loturi (rândul lotului) FOR UPDATE → INSERT red_jurnal, ultimul. Trigger-ul de jurnal rulează în UPDATE-ul red_fan_awb al lui
--   fn_red_fan_aproba (după lock-urile lot → plicuri → rânduri): citește red_fan_loturi (ACCESS SHARE, fără lock de rând) și inserează în
--   red_jurnal (ROW EXCLUSIVE; inserările nu se blochează între ele) — niciun lock nou de rând, nicio așteptare în plus față de 20261212a;
--   fn_red_fan_aproba scrie apoi red_fan_loturi (prima_aprobare_la), ca înainte. Runda 4: același lucru în orice altă scriere red_fan_awb
--   (propune, claim, rezultate, reconciliaza, ridicat, anulat, urmărire / confirmări): trigger-ul rulează DUPĂ lock-urile de rând ale RPC-ului,
--   citește red_fan_loturi fără lock de rând și inserează în red_jurnal (sau iese imediat, la scrierile doar de urmărire) — nicio așteptare nouă.
-- Lock-uri la aplicare: ALTER TABLE … ADD COLUMN cere ACCESS EXCLUSIVE pe red_fan_loturi (tabel mic: câteva rânduri; ADD COLUMN cu DEFAULT
--   constant nu rescrie tabelul pe PG ≥ 11) + SHARE ROW EXCLUSIVE pe red_fan_awb (runda 3: cerut de CREATE TRIGGER; citit și de deducerea istorică;
--   oprește scriitorii FAN în curs — aprobare / claim / rezultate / urmărire țin ROW EXCLUSIVE — ca momentul de instalare din marcaj să nu aibă
--   nicio scriere FAN în zbor; citirile ecranului și FOR UPDATE / FOR SHARE trec). AMBELE în același bloc, NOWAIT, în ordinea red_fan_loturi →
--   red_fan_awb (fără așteptare ⇒ fără deadlock), bugetul de 1 s de la PRIMA încercare (ca 20261212a), verificat înaintea fiecărei încercări și
--   după obținere; un eșec al celui de-al doilea eliberează și primul (sub-tranzacția blocului). Lock-uri IMPLICITE după set: CREATE OR REPLACE
--   FUNCTION / CREATE FUNCTION (plpgsql: corpul nu se analizează la creare — fără lock-uri pe tabele; doar rândul din pg_proc), CREATE TRIGGER
--   (SHARE ROW EXCLUSIVE pe red_fan_awb — deja ținut), COMMENT, REVOKE / GRANT (catalog), UPDATE red_fan_loturi (deja ținut, ROW EXCLUSIVE sub
--   ACCESS EXCLUSIVE), INSERT red_jurnal (ROW EXCLUSIVE pe red_jurnal + secvența), postcondițiile (catalog + cele două tabele ținute).
--   Nimic pe red_plicuri, red_proiecte, red_loturi_plicuire. Fiecare așteptare implicită e limitată de lock_timeout = 100 ms.
--   Rest cunoscut: un RPC FAN pornit înainte de BEGIN-ul nostru, care nu atinsese încă tabelele când am luat lock-urile (fereastra dintre
--   startul lui și prima citire: verificarea owner-ului), poate scrie după COMMIT-ul nostru cu now() < momentul din marcaj; pentru un lot
--   nou îl prinde revenirea pe CONȚINUT (aprobat + opod = false), pentru un lot deja aprobat înainte rezultatul (cu B) e identic cu istoricul;
--   în ambele cazuri aprobarea lui trece prin trigger-ul de jurnal (runda 3) → eveniment 'opod_aprobare' → revenirea refuză.
-- RUNDA 4 (Jakarinos #1135 r3 P2): jurnalul DOAR al trecerilor în 'aprobat' nu ajungea. Succesiunea reprodusă: lot legacy cu un plic APROBAT
--   înainte (negenerat) → aplicare (lot dedus true) → fn_red_fan_claim_lot rezervă plicul (POST la FAN cu corpul construit din coloana opod) →
--   fn_red_fan_rezultate scrie 'eroare' (generat_la NULL, aprobat_la de dinainte) → revenirea trecea: nicio trecere nouă în 'aprobat', iar
--   verificarea pe timp urmărea updated_at doar pe in_curs / necunoscut. La fel „necunoscut → reconciliere fără AWB → eroare”. Acum:
--   trigger-ul (același nume, aceeași funcție) e AFTER INSERT OR UPDATE OR DELETE și scrie un eveniment la ORICE pas al ciclului de viață al unui
--   rând FAN: 'opod_aprobare' la trecerea în 'aprobat' (ca în runda 3) și 'opod_folosire' la orice altă inserare, ștergere sau schimbare a
--   coloanelor ciclului de viață (stare, hash_date, cerere_id, awb, aprobat_la, generat_la, lot_id, plic_id): propunere / re-propunere, rezervare
--   (claim), rezultat (generat / eroare / necunoscut), reconciliere, ridicare, anulare, ștergere directă. Fiecare eveniment are lotul, alegerea
--   oPOD a lotului în acel moment, hash-ul, starea veche → nouă, autorul = auth.uid(), momentul. Scrierile DOAR de urmărire / confirmări
--   (urmarire_*, confirmare_stare, versiune_urmarire, urmarit_la, updated_at, tarif / motiv fără altă schimbare) nu scriu nimic (nu depind de opod).
--   Revenirea refuză la ORICE eveniment (oricare din cele două) și, ca apărare în adâncime, la orice rând red_fan_awb creat / scris (updated_at)
--   după momentul din marcaj — inclusiv urmărirea: revenirea e doar pentru aplicarea NEFOLOSITĂ.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, bugetul lock-ului
--   de 1 s, garda finală a runnerului.
-- Revenire: supabase/revenire/20261227a_redari_fan_opod_ROLLBACK.sql (prin runner, plafonul 2000; refuză la ORICE folosire de după aplicare,
--   L14 textual: evenimente 'opod_schimbat', evenimente 'opod_aprobare' / 'opod_folosire' (orice pas FAN după aplicare, oriunde — rundele 3–4),
--   lot aprobat după aplicare (aprobat cu opod = false sau în afara listei din marcaj), rânduri FAN create / scrise după momentul din marcaj,
--   loturi cu opod = true în afara listei deduse; datele preexistente — loturile deduse true — nu opresc revenirea). Scoate și trigger-ul +
--   funcția de jurnal. Probe: scripts/pglite/test_redari_fan_opod_local.mjs (PGlite, pașii reali L15 v2 ai runnerului peste 20261212a aplicată,
--   cu un lot aprobat + generat ÎNAINTE: comportament ca roluri, trigger, jurnal, deducerea, marcajul, refuzuri, revenire, mutanți; cu
--   OPOD_SQL_DIN=<sha> rulează pe fișierele SQL ale altui commit — dovada că scenariile noi pică pe forma de dinainte).
DO $pre$
DECLARE v_plafon text; v_rau text; v_tip text; r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261227a_redari_fan_opod:' || txid_current() THEN
    RAISE EXCEPTION '20261227a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261227a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261227a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261227a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261227a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261225a / 20261212a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261227a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- baza: 20261212a aplicată (tabelul, coloanele citite, trigger-ul gărzii în forma exactă, exact cele 19 funcții fn_red_fan_*)
  IF to_regclass('public.red_fan_loturi') IS NULL OR to_regclass('public.red_fan_awb') IS NULL OR to_regclass('public.red_loturi_plicuire') IS NULL
     OR to_regclass('public.red_jurnal') IS NULL THEN
    RAISE EXCEPTION '20261227a: tabelele din 20261212a / 20261126a lipsesc (migrarea FAN nu e aplicata)';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('red_fan_loturi', 'lot_id', '^uuid$'), ('red_fan_loturi', 'test', '^boolean$'), ('red_fan_loturi', 'prima_aprobare_la', '^timestamp with time zone$'),
      ('red_fan_loturi', 'prima_aprobare_de', '^uuid$'), ('red_fan_loturi', 'marcat_de', '^uuid$'), ('red_fan_loturi', 'marcat_la', '^timestamp with time zone$'),
      ('red_fan_loturi', 'proiect_id', '^uuid$'),
      ('red_fan_awb', 'lot_id', '^uuid$'), ('red_fan_awb', 'stare', '^text$'),
      ('red_loturi_plicuire', 'id', '^uuid$'),
      ('red_jurnal', 'tabela', '^text$'), ('red_jurnal', 'inregistrare_id', '^uuid$'), ('red_jurnal', 'actiune', '^text$'),
      ('red_jurnal', 'date_vechi', '^jsonb$'), ('red_jurnal', 'date_noi', '^jsonb$'), ('red_jurnal', 'user_id', '^uuid$')
    ) v(t, c, tip) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION '20261227a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_loturi' AND column_name = 'opod')
     OR to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '20261227a: coloana opod / fn_red_fan_lot_opod exista deja (reaplicare)';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%') <> 19
     OR to_regprocedure('public.fn_red_fan_awb_opod_jurnal()') IS NOT NULL THEN
    RAISE EXCEPTION '20261227a: numarul functiilor fn_red_fan_* difera de 19 (baza nu e 20261212a)';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_loturi'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_loturi'::regclass AND tg.tgname = 'trg_red_fan_loturi_garda'
                      AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = to_regprocedure('public.fn_red_fan_loturi_garda()')
                      AND tg.tgtype = (1 | 2 | 8 | 16)) THEN
    RAISE EXCEPTION '20261227a: trigger-ul trg_red_fan_loturi_garda nu e cel din 20261212a';
  END IF;
  -- runda 3: red_fan_awb nu are niciun trigger al aplicației în 20261212a (doar cele interne ale cheilor străine); al nostru va fi singurul
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 0 THEN
    RAISE EXCEPTION '20261227a: red_fan_awb are deja un trigger al aplicatiei (baza nu e 20261212a)';
  END IF;
  -- istoricul nu există încă (L14: revenirea refuză la istoric nou; aici dovada că e al acestei migrări); marcajele de instalare echilibrate
  -- (fiecare 'opod_instalat' are 'opod_dezinstalat'-ul lui: altfel migrarea e aplicată fără revenire sau coloana a fost scoasă pe altă cale)
  IF EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_fan_loturi' AND date_noi ->> 'eveniment' = 'opod_schimbat') THEN
    RAISE EXCEPTION '20261227a: red_jurnal are deja evenimente opod_schimbat';
  END IF;
  -- runda 3 + 4: evenimentele 'opod_aprobare' / 'opod_folosire' le scrie DOAR trigger-ul acestei migrări; revenirea nu trece cu ele prezente →
  -- aici nu poate exista niciunul
  IF EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_fan_awb' AND date_noi ->> 'eveniment' IN ('opod_aprobare', 'opod_folosire')) THEN
    RAISE EXCEPTION '20261227a: red_jurnal are deja evenimente opod_aprobare / opod_folosire (aplicare fara revenire?)';
  END IF;
  IF (SELECT count(*) FILTER (WHERE date_noi ->> 'eveniment' = 'opod_instalat') - count(*) FILTER (WHERE date_noi ->> 'eveniment' = 'opod_dezinstalat')
        FROM public.red_jurnal WHERE tabela = 'red_fan_loturi') <> 0 THEN
    RAISE EXCEPTION '20261227a: marcajele de instalare din red_jurnal (opod_instalat / opod_dezinstalat) nu sunt echilibrate (aplicare fara revenire?)';
  END IF;
  -- coloanele citite de deducerea istorică / de revenire
  FOR r IN SELECT * FROM (VALUES ('red_fan_awb', 'aprobat_la', '^timestamp with time zone$'), ('red_fan_awb', 'generat_la', '^timestamp with time zone$'),
      ('red_fan_awb', 'updated_at', '^timestamp with time zone$'), ('red_fan_awb', 'created_at', '^timestamp with time zone$'),
      ('red_fan_awb', 'hash_date', '^text$'), ('red_fan_awb', 'cerere_id', '^uuid$'), ('red_fan_awb', 'awb', '^text$'), ('red_fan_awb', 'plic_id', '^uuid$'),
      ('red_fan_awb', 'id', '^uuid$'), ('red_fan_loturi', 'marcat_la', '^timestamp with time zone$')) v(t, c, tip) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION '20261227a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid
     OR NOT pg_has_role('postgres', 'authenticated', 'USAGE') OR NOT pg_has_role('postgres', 'anon', 'USAGE') THEN
    RAISE EXCEPTION '20261227a: dependentele (auth.uid, rolurile aplicatiei) lipsesc sau difera';
  END IF;
END $pre$;

-- ── amprentele funcțiilor de care depinde regula (20261212a) + poarta de drept (20261126a), ÎNAINTE (garda = corpul vechi) și DUPĂ (garda = corpul
-- nou; restul neschimbat). Corp fără CR + limbaj + DEFINER + search_path + proprietar + EXECUTE (anon niciodată; authenticated exact ca în 20261212a).
CREATE FUNCTION pg_temp.lant_20261227a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $lant$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_nivel()', '21db8e5d4b69b7f19e571a7087c361ae', 'sql', true, true, 'text'),
      ('public.fn_red_fan_e_owner()', '941c20690f2ae0cda77869a1d865ea69', 'sql', true, false, 'boolean'),
      ('public.fn_red_fan_lot_marcheaza(uuid, boolean)', '7ea87499188a0c7d6a7189b017fa4805', 'plpgsql', true, true, 'boolean'),
      ('public.fn_red_fan_aproba(uuid, uuid[], text[])', 'e584116e292d5a307041225b2ff27fbc', 'plpgsql', true, true, 'integer'),
      ('public.fn_red_fan_claim_lot(uuid, uuid[], text[], text[])', '2e10d8103f144fee46ceae430eff8f6f', 'plpgsql', true, true, 'uuid'),
      ('public.fn_red_fan_propune(uuid, text, numeric)', 'fa0e624dfc9d6a354914ce1da1784b64', 'plpgsql', true, true, 'uuid'),
      -- >>> GARDA 20261227a (inainte = corpul din 20261212a; dupa = corpul nou, de mai jos)
      ('public.fn_red_fan_loturi_garda()', CASE WHEN p_moment = 'inainte' THEN '1931e70c3b15a07a6ee485537f27ce93' ELSE '5f167c38850bbfc30cb29c0a0fd734ad' END, 'plpgsql', false, false, 'trigger')
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
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.exec_auth
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0);
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20261227a: functiile de care depinde regula (%) difera de amprentele revizuite: %', p_moment, v_rau;
  END IF;
END $lant$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.lant_20261227a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06): ACCESS EXCLUSIVE pe red_fan_loturi (ADD COLUMN) + SHARE ROW EXCLUSIVE pe red_fan_awb (CREATE TRIGGER + deducerea
-- istorică, fără scriitori FAN în zbor), în același bloc, NOWAIT, bugetul de 1 s de la PRIMA încercare ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261227a: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000)
        USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.red_fan_loturi IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.red_fan_awb IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261227a: BUGET_LOCK: lock-ul obtinut abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000)
      USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261227a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. coloana: alegerea oPOD a lotului, implicit OPRITĂ ───
ALTER TABLE public.red_fan_loturi ADD COLUMN opod boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.red_fan_loturi.opod IS 'Redări FAN: confirmarea de primire în ORIGINAL (opțiunea B, oPOD, cost suplimentar pe plic) e cerută pe lot? Implicit false = confirmarea electronică a curierului (decizia proprietarului, 09.11 + 18.11.2026). Scrisă doar prin fn_red_fan_lot_opod (owner), înainte de prima aprobare; imuabilă după (trigger). Loturile aprobate înainte de 20261227a au true (codul trimitea mereu B; marcajul opod_instalat din red_jurnal le listează).';

-- ─── 1b. ISTORICUL: loturile cu o aprobare înainte de această migrare au plecat / pleacă cu B (oPOD) → opod = true; apoi marcajul de instalare ───
-- ÎNAINTEA gărzii noi (pasul 2): garda nouă refuză orice schimbare a lui opod pe un lot aprobat — exact loturile pe care deducerea le scrie.
DO $istoric$
DECLARE v_true integer; v_total integer; v_marcate integer; v_marcaj_id bigint;
BEGIN
  UPDATE public.red_fan_loturi l SET opod = true
   WHERE l.prima_aprobare_la IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.red_fan_awb a WHERE a.lot_id = l.lot_id AND a.stare <> 'propus');
  GET DIAGNOSTICS v_true = ROW_COUNT;
  SELECT count(*) INTO v_total FROM public.red_fan_loturi;
  -- (deducerea = exact predicatul se verifică în postcondiții)
  -- rânduri FAN trecute de „propus” pe loturi FĂRĂ rând red_fan_loturi nu pot exista (aprobarea cere marcajul): doar numărate, ca dovadă
  SELECT count(*) INTO v_marcate FROM public.red_fan_awb a WHERE a.stare <> 'propus' AND NOT EXISTS (SELECT 1 FROM public.red_fan_loturi l WHERE l.lot_id = a.lot_id);
  IF v_marcate <> 0 THEN RAISE EXCEPTION '20261227a: % randuri FAN aprobate pe loturi fara marcaj (date neasteptate; nimic schimbat)', v_marcate; END IF;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_loturi', NULL, 'insert', NULL,
          jsonb_build_object('eveniment', 'opod_instalat', 'migrare', '20261227a_redari_fan_opod', 'la', now(),
                             'loturi_opod', (SELECT coalesce(jsonb_agg(lot_id ORDER BY lot_id), '[]'::jsonb) FROM public.red_fan_loturi WHERE opod),
                             'n_loturi', v_total, 'n_opod', v_true), NULL)
  RETURNING id INTO v_marcaj_id;
  RAISE NOTICE '20261227a: istoric: % din % loturi marcate aveau o aprobare inainte (opod = true, dedus: codul trimitea mereu B); marcaj opod_instalat #%',
    v_true, v_total, v_marcaj_id;
END $istoric$;

-- ─── 2. garda (același trigger): după prima aprobare nici opod nu se mai schimbă, pe orice cale (L07) ───
CREATE OR REPLACE FUNCTION public.fn_red_fan_loturi_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'redari fan: marcajul unui lot nu se sterge' USING ERRCODE = '42501'; END IF;
  IF NEW.lot_id IS DISTINCT FROM OLD.lot_id OR NEW.proiect_id IS DISTINCT FROM OLD.proiect_id
     OR (OLD.prima_aprobare_la IS NOT NULL AND (NEW.test IS DISTINCT FROM OLD.test OR NEW.opod IS DISTINCT FROM OLD.opod
         OR NEW.prima_aprobare_la IS DISTINCT FROM OLD.prima_aprobare_la
         OR NEW.prima_aprobare_de IS DISTINCT FROM OLD.prima_aprobare_de OR NEW.marcat_de IS DISTINCT FROM OLD.marcat_de OR NEW.marcat_la IS DISTINCT FROM OLD.marcat_la)) THEN
    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; marcajul de test si alegerea oPOD nu se mai schimba' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

-- ─── 3. alegerea oPOD (DOAR owner), după marcaj, înainte de PRIMA aprobare; jurnal. Lock: lot FOR UPDATE → red_fan_loturi → INSERT red_jurnal ───
CREATE FUNCTION public.fn_red_fan_lot_opod(p_lot_id uuid, p_opod boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_fl record; v_la timestamptz;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul alege oPOD' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_opod IS NULL THEN RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT lot_id, opod, prima_aprobare_la INTO v_fl FROM public.red_fan_loturi WHERE lot_id = p_lot_id FOR UPDATE;
  IF v_fl.lot_id IS NULL THEN RAISE EXCEPTION 'redari fan: alege intai daca lotul e de TEST sau real (lot FAN nemarcat)' USING ERRCODE = 'P0001'; END IF;
  IF v_fl.opod = p_opod THEN RETURN p_opod; END IF;   -- repetare = no-op (nimic in jurnal)
  IF v_fl.prima_aprobare_la IS NOT NULL OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat')) THEN
    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; alegerea oPOD nu se mai schimba' USING ERRCODE = 'P0001'; END IF;
  v_la := clock_timestamp();
  UPDATE public.red_fan_loturi SET opod = p_opod WHERE lot_id = p_lot_id;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_loturi', p_lot_id, 'update', jsonb_build_object('opod', v_fl.opod),
          jsonb_build_object('eveniment', 'opod_schimbat', 'opod', p_opod, 'la', v_la), auth.uid());
  RETURN p_opod;
END $fn$;
COMMENT ON FUNCTION public.fn_red_fan_lot_opod(uuid, boolean) IS 'Redări FAN (owner): cere / renunță la oPOD pe lot, doar după marcajul TEST / real și înainte de prima aprobare; schimbarea intră în red_jurnal (opod_schimbat).';
REVOKE ALL ON FUNCTION public.fn_red_fan_lot_opod(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_fan_lot_opod(uuid, boolean) TO authenticated;

-- ─── 4. (runda 3 + 4) jurnalul ciclului de viață FAN: fiecare pas al unui rând red_fan_awb de după aplicare = un eveniment în red_jurnal
-- (append-only), cu alegerea oPOD a lotului în acel moment — dovada DURABILĂ a folosirii, pe care nicio tranziție ulterioară n-o șterge:
--   'opod_aprobare' = trecerea în 'aprobat' (INSERT direct ca aprobat sau UPDATE din altă stare);
--   'opod_folosire' = orice alt INSERT, orice DELETE, orice UPDATE care schimbă o coloană a ciclului de viață (stare, hash_date, cerere_id, awb,
--     aprobat_la, generat_la, lot_id, plic_id): propunere, re-propunere, rezervare (claim → POST), rezultat, reconciliere, ridicare, anulare.
--   Scrierile DOAR de urmărire / confirmări / tarif (celelalte coloane) nu scriu nimic: nu depind de alegerea oPOD.
-- AFTER (nu BEFORE): nu schimbă rândul; RETURN NULL. SECURITY DEFINER (ca fn_red_jurnal, 20261126a): red_jurnal nu are INSERT pentru rolurile
-- aplicației, iar scrierile pe red_fan_awb vin doar din RPC-urile DEFINER sau de la postgres. Fără drept de EXECUTE pentru roluri (e trigger).
-- Fără coloane în definiția trigger-ului (UPDATE OF …): filtrul e în corp, pe valori (OLD vs NEW), deci prinde și un UPDATE direct care nu
-- numește coloana stare. OLD / NEW se citesc doar pe ramura operației care le are. ───
CREATE FUNCTION public.fn_red_fan_awb_opod_jurnal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_opod boolean; v_r public.red_fan_awb; v_din text; v_ev text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- filtrul ciclului de viață: doar urmărire / confirmări / tarif = nimic de jurnalizat
    IF (OLD.stare, OLD.hash_date, OLD.cerere_id, OLD.awb, OLD.aprobat_la, OLD.generat_la, OLD.lot_id, OLD.plic_id)
       IS NOT DISTINCT FROM (NEW.stare, NEW.hash_date, NEW.cerere_id, NEW.awb, NEW.aprobat_la, NEW.generat_la, NEW.lot_id, NEW.plic_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN v_r := OLD; ELSE v_r := NEW; END IF;
  IF TG_OP <> 'INSERT' THEN v_din := OLD.stare; END IF;
  v_ev := 'opod_folosire';
  IF TG_OP <> 'DELETE' AND v_r.stare = 'aprobat' AND v_din IS DISTINCT FROM 'aprobat' THEN v_ev := 'opod_aprobare'; END IF;
  SELECT opod INTO v_opod FROM public.red_fan_loturi WHERE lot_id = v_r.lot_id;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  VALUES ('red_fan_awb', v_r.id, lower(TG_OP), CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('stare', v_din) END,
          jsonb_build_object('eveniment', v_ev, 'lot_id', v_r.lot_id, 'opod', v_opod, 'hash_date', v_r.hash_date, 'din', v_din,
                             'in', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_r.stare END, 'la', now()), auth.uid());
  RETURN NULL;
END $fn$;
COMMENT ON FUNCTION public.fn_red_fan_awb_opod_jurnal() IS 'Redări FAN (20261227a): la fiecare pas al ciclului de viață al unui rând FAN (aprobare = opod_aprobare; propunere, rezervare, rezultat, reconciliere, ridicare, anulare, ștergere = opod_folosire) scrie în red_jurnal lotul, alegerea oPOD a lotului, hash-ul, starea veche → nouă și autorul; revenirea migrării refuză cât există vreunul.';
REVOKE ALL ON FUNCTION public.fn_red_fan_awb_opod_jurnal() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_fan_awb_opod_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_fan_awb FOR EACH ROW EXECUTE FUNCTION public.fn_red_fan_awb_opod_jurnal();

-- ── postcondiții ──
DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_fan_loturi' AND column_name = 'opod'
                   AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION '20261227a post: coloana opod (boolean NOT NULL DEFAULT false)';
  END IF;
  -- rândurile existente: opod = deducerea istorică (aprobare în istoric ⇔ true); marcajul de instalare scris în ACEASTĂ tranzacție, cu lista exactă
  IF EXISTS (SELECT 1 FROM public.red_fan_loturi l
              WHERE l.opod IS DISTINCT FROM (l.prima_aprobare_la IS NOT NULL OR EXISTS (SELECT 1 FROM public.red_fan_awb a WHERE a.lot_id = l.lot_id AND a.stare <> 'propus'))) THEN
    RAISE EXCEPTION '20261227a post: opod difera de deducerea istorica (aprobare in istoric = true, altfel false)';
  END IF;
  IF (SELECT count(*) FILTER (WHERE date_noi ->> 'eveniment' = 'opod_instalat') - count(*) FILTER (WHERE date_noi ->> 'eveniment' = 'opod_dezinstalat')
        FROM public.red_jurnal WHERE tabela = 'red_fan_loturi') <> 1
     OR NOT EXISTS (SELECT 1 FROM public.red_jurnal j
                     WHERE j.tabela = 'red_fan_loturi' AND j.date_noi ->> 'eveniment' = 'opod_instalat' AND j.inregistrare_id IS NULL AND j.actiune = 'insert'
                       AND j.xmin::text = (txid_current() % 4294967296)::text
                       AND (j.date_noi ->> 'la')::timestamptz = now()
                       AND (SELECT coalesce(jsonb_agg(lot_id ORDER BY lot_id), '[]'::jsonb) FROM public.red_fan_loturi WHERE opod) = j.date_noi -> 'loturi_opod'
                       AND (j.date_noi ->> 'n_loturi')::int = (SELECT count(*) FROM public.red_fan_loturi)
                       AND (j.date_noi ->> 'n_opod')::int = (SELECT count(*) FROM public.red_fan_loturi WHERE opod)) THEN
    RAISE EXCEPTION '20261227a post: marcajul opod_instalat lipseste sau nu descrie exact loturile deduse';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.red_fan_loturi'::regclass AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261227a post: drepturi pe coloane';
  END IF;
  -- funcția nouă: DEFINER, search_path fix, proprietar, EXECUTE doar authenticated
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = to_regprocedure('public.fn_red_fan_lot_opod(uuid, boolean)') AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0)) THEN
    RAISE EXCEPTION '20261227a post: fn_red_fan_lot_opod (limbaj / definer / search_path / owner / EXECUTE)';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%') <> 21 THEN
    RAISE EXCEPTION '20261227a post: numarul functiilor fn_red_fan_* difera de 21';
  END IF;
  -- runda 3 + 4: funcția de jurnal (DEFINER, search_path fix, proprietar, fără EXECUTE pentru roluri) + trigger-ul ei, singurul de pe red_fan_awb, în
  -- forma exactă (AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW, fără coloane / WHEN / argumente); nimic jurnalizat în această tranzacție
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                  WHERE p.oid = to_regprocedure('public.fn_red_fan_awb_opod_jurnal()') AND l.lanname = 'plpgsql' AND p.prosecdef AND p.prorettype = 'trigger'::regtype
                    AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0)) THEN
    RAISE EXCEPTION '20261227a post: fn_red_fan_awb_opod_jurnal (limbaj / definer / search_path / owner / EXECUTE)';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_opod_jurnal'
                      AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_red_fan_awb_opod_jurnal()'::regprocedure
                      AND tg.tgtype = (1 | 4 | 8 | 16) AND tg.tgattr::text = '') THEN
    RAISE EXCEPTION '20261227a post: trigger-ul trg_red_fan_awb_opod_jurnal (forma exacta: AFTER INSERT OR UPDATE OR DELETE, FOR EACH ROW, fara coloane)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_fan_awb' AND date_noi ->> 'eveniment' IN ('opod_aprobare', 'opod_folosire')) THEN
    RAISE EXCEPTION '20261227a post: evenimente opod_aprobare / opod_folosire in red_jurnal la aplicare';
  END IF;
  -- trigger-ul gărzii: neatins (forma exactă din 20261212a), singurul de pe tabel
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_loturi'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_loturi'::regclass AND tg.tgname = 'trg_red_fan_loturi_garda'
                      AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_red_fan_loturi_garda()'::regprocedure
                      AND tg.tgtype = (1 | 2 | 8 | 16)) THEN
    RAISE EXCEPTION '20261227a post: trigger-ul trg_red_fan_loturi_garda';
  END IF;
  -- RLS și drepturile pe red_fan_loturi neschimbate (doar SELECT pentru authenticated / service_role, nimic pentru anon / PUBLIC)
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
              WHERE has_table_privilege(y.rol, 'public.red_fan_loturi'::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol <> 'anon'))
     OR NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.red_fan_loturi'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '20261227a post: drepturile / RLS pe red_fan_loturi s-au schimbat';
  END IF;
  -- red_jurnal: doar rândul marcajului în plus (nimic altceva scris acolo de migrare), drepturile neatinse (nimic de scris pentru rolurile aplicației)
  IF (SELECT count(*) FROM public.red_jurnal j WHERE j.xmin::text = (txid_current() % 4294967296)::text) <> 1
     OR has_table_privilege('authenticated', 'public.red_jurnal'::regclass, 'INSERT') OR has_table_privilege('anon', 'public.red_jurnal'::regclass, 'SELECT') THEN
    RAISE EXCEPTION '20261227a post: red_jurnal (randuri scrise / drepturi)';
  END IF;
END $post$;

-- L15: aceeași listă DUPĂ schimbare (garda = corpul nou), garda finală, timpul, apoi funcția pg_temp se șterge
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.lant_20261227a('dupa');
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261227a_redari_fan_opod:' || txid_current() OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '20261227a: garda final invalida';
  END IF;
  RAISE NOTICE '20261227a: sfarsit la % ms de la BEGIN; lock-uri puternice tinute de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.lant_20261227a(text);
