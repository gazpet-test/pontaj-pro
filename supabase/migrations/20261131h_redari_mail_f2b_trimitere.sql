-- Version 20261131180000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261131h_redari_mail_f2b_trimitere.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ v2 a runnerului. Manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh); lista OBIECTELOR pe care trebuie să le conțină (familie, etichetă, operație — scrisă și verificată pe PGlite cu
--   pașii reali ai runnerului) e în supabase/tests/20261131h_redari_mail_f2b_trimitere.l15.obiecte.tsv. Pe lângă ea, migrarea verifică pe amprentă
--   (corp + proprietăți + drepturi, ÎNAINTE și DUPĂ) cele două funcții F2 pe care le înlocuiește și cele trei pe care le cheamă.
-- 20261131h_redari_mail_f2b_trimitere — Redări e-mail, felia F2b: TRIMITEREA din redari@gazpet.ro (Gmail API, OAuth scopul `trimitere`),
--   docs/redari/PLAN_EMAIL_REDARI.md §1.3, §2.3; deciziile proprietarului din 18.11.2026 (fără căsuță de test separată pentru trimitere; transport
--   real DOAR pe proiecte cu codul „TEST-…”; doar trimiterea, nu și citirea / golirea). Toate migrările F1 / F2 (20261130j, 20261130k, 20261131a) sunt
--   APLICATE; aceasta e MICĂ și separată, cu DOAR ce lipsește ca trimiterea să poată porni pe proiectele de TEST:
--   * red_mail_setari: CHECK-ul inert din 20261131a (red_mail_f2_inert_ck: OFF și extern = false impuse deodată) e înlocuit cu
--     red_mail_f2b_extern_ck (extern_permis rămâne FALS: destinatarii externi = altă migrare, după „da”-urile din plan) și red_mail_f2b_pornire_ck
--     (trimiterea poate fi PORNITĂ doar cu căsuța conectată); coloana doar_proiecte_test (NOT NULL DEFAULT true, CHECK IS TRUE: scoaterea gărzii
--     „doar TEST” = altă migrare, revizuită) și starea conectării pentru trimitere (trimitere_conectata_la / _de / trimitere_casuta, împreună sau
--     deloc, căsuța = redari@gazpet.ro) — scrisă DOAR de fn_red_mail_secret_seteaza;
--   * red_mail_oauth_state: scopul `trimitere` intră în CHECK (F1 avea citire / citire_test / golire / golire_test);
--   * fn_red_mail_f2_poate (chemată sub lock de fn_red_mail_rezerva și fn_red_mail_apel_incepe): refuză `casuta_neconectata` și, cât
--     doar_proiecte_test e adevărat, orice lot al unui proiect al cărui cod NU începe cu „TEST-” (`doar_proiecte_test`) — regula impusă în BD, pe
--     toate căile (L07), nu doar în funcția edge; corpul 20261131a altfel neschimbat; convenția „TEST-” are O SINGURĂ definiție SQL (L19),
--     fn_red_proiect_e_test(cod), folosită și de triggerul de mai jos;
--   * CATEGORIA proiectului e garantată TEHNIC pe durata trimiterii (runda 2, Jakarinos #1134 P1): (i) fn_red_mail_rezerva și fn_red_mail_apel_incepe
--     iau rândul proiectului FOR SHARE (după lot, înaintea mesajelor — ordinea L06 setări → lot → proiect → mesaje), deci decizia „doar TEST” a lui
--     fn_red_mail_f2_poate e serializată cu orice UPDATE al rândului proiectului; (ii) triggerul BEFORE UPDATE OF cod trg_red_proiect_cod_test
--     (fn_red_proiect_cod_test_garda, SECURITY DEFINER ca să vadă loturile tuturor) refuză schimbarea CATEGORIEI codului (TEST- ↔ real) cât proiectul
--     are loturi de e-mail neîncheiate sau mesaje rezervate / în apel (deci și în intervalul dintre commit-ul lui apel_incepe și apelul HTTP) sau AWB-uri
--     FAN propuse / aprobate / în curs / necunoscute; în contextul aplicației (JWT) schimbarea categoriei o face DOAR owner-ul (42501);
--     redenumirile care păstrează categoria (TEST-A → TEST-B, LOT1 → LOT1-B) rămân ca azi (admin Redări). Mentenanța (postgres fără JWT) e scutită doar
--     de condiția „owner”, nu și de cea „în lucru”. Pe live, trg_red_autorizare_tgz (20261130m) refuză deja orice schimbare a codului cât există
--     autorizarea Transgaz; triggerul nou acoperă proiectele fără autorizare și căile de mentenanță.
--     CONTRACTUL pentru E-MAIL e COMPLET: (i) + (ii) închid cursa redenumire ↔ autorizare ↔ apel HTTP pe toate căile de trimitere (Jakarinos #1134 r2).
--     CONTRACTUL pentru FAN e PARȚIAL (runda 3, Jakarinos #1134 r2 P1 — restrâns, nu extins; NICIUN cod FAN modificat aici). Condiția pe red_fan_awb
--     ACOPERĂ doar atât: cât există AWB-uri în stările propus / aprobat / in_curs / necunoscut, categoria nu se schimbă — deci și intervalul în care un
--     AWB aprobat e deja rezervat `in_curs` de fn_red_fan_claim_lot (20261212a) și apelul POST e în desfășurare. NU ACOPERĂ: (a) intervalul verificare
--     categorie → autorizare (claim) → HTTP din handler-ul FAN (redariFanHandler.mjs → redariFanTransport.mjs `genereaza`) când la momentul verificării
--     nu există încă AWB-uri în stările protejate: handler-ul citește codul TEST- și lotul marcat TEST, categoria se schimbă în real (triggerul permite:
--     nimic în lucru), AWB-uri noi sunt propuse / aprobate cu codul real, iar fn_red_fan_claim_lot verifică aprobarea, hash-urile și sursele, NU categoria,
--     deci apelul poate continua; (b) acțiunea `evenimente` (GET /reports/awb-events, fără niciun AWB); (c) urmărirea / confirmările / etichetele /
--     ștergerea pe AWB-uri `generat` / `ridicat` (stări neblocante pentru trigger). Protecția COMPLETĂ a FAN = PR FAN separat (proiectul FOR SHARE +
--     verificarea categoriei în fn_red_fan_claim_lot și în celelalte căi), listat ca lucru rămas în docs/redari/PLAN_EMAIL_REDARI.md și RAPORT_F2_EMAIL.md.
--     EFECT ZILNIC pentru proprietar: un proiect de TEST cu loturi de e-mail active sau cu AWB-uri FAN în lucru nu poate fi redenumit cu un cod „real”,
--     și invers; redenumirile în aceeași categorie nu se schimbă; după încheierea loturilor (și AWB-urile ajunse generat / ridicat / anulat / eroare),
--     owner-ul poate schimba categoria.
--   * fn_red_mail_f2_setari: owner-ul poate PORNI trimiterea (p_oprit = false, cu versiunea curentă și căsuța conectată); p_extern = true rămâne refuzat
--     (`extern_amanat`); OFF rămâne fără condiții (L20);
--   * RPC-uri noi cu JWT-ul owner-ului (auth.uid(), L08): fn_red_mail_oauth_start (state-ul OAuth: doar sha256, scopul `trimitere`, 10 minute),
--     fn_red_mail_oauth_consuma (consumul ATOMIC, o singură dată, doar al owner-ului curent, neexpirat → scopul), fn_red_mail_oauth_eveniment
--     (jurnalul refuzurilor OAuth, cod din listă închisă, fără conținut);
--   * RPC-uri noi DOAR pentru service_role (funcțiile edge, după poarta owner din cod, cu p_apelant = uid-ul din getUser, re-verificat owner aici —
--     regula (ii) din §2.4): fn_red_mail_secret_seteaza (refresh token-ul în Vault prin vault.create_secret / update_secret, DOAR numele
--     REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN; '' = revocare: valoarea golită, trimitere_oprita = true, starea conectării ștearsă; evenimentul
--     oauth_conectat / oauth_revocat) și fn_red_mail_secret_citeste (valoarea, doar cu căsuța conectată; pentru motivul `trimitere` doar cu
--     trimiterea pornită și fără pauză). Niciun rol al aplicației nu le poate chema; valoarea nu apare în niciun jurnal.
-- Ce NU face: nu creează secrete în Vault (le scrie owner-ul prin conectare); nu pornește trimiterea (rămâne OFF); nu atinge citirea / golirea
--   (F1), datele din red_mail_loturi / red_mail_mesaje / red_fan_* (doar le CITEȘTE în trigger), drepturile de modul, cronuri; nicio dată de business.
-- Identitatea: auth.uid() în RPC-urile owner-ului; p_apelant (uid din getUser) DOAR în cele două RPC-uri service_role, re-verificat în profiles.
-- Ordinea lock-urilor la rulare (L06): red_mail_setari (FOR UPDATE / FOR SHARE) → red_mail_loturi FOR UPDATE → red_proiecte FOR SHARE (nou, doar în
--   rezerva / apel_incepe) → red_mail_mesaje ORDER BY id; fn_red_mail_secret_seteaza ia setările FOR UPDATE înaintea scrierii în Vault; RPC-urile de
--   state ating doar red_mail_oauth_state. Triggerul trg_red_proiect_cod_test rulează cu rândul proiectului deja blocat de UPDATE și nu ia alt lock
--   (citiri simple din red_mail_loturi / red_mail_mesaje / red_fan_awb); fn_red_mail_lot_creeaza ia KEY SHARE pe proiect (FK) după setări — niciun
--   drum nu ia proiectul înaintea setărilor sau lotului, deci fără ciclu.
-- Lock-uri la aplicare (punct unic, NOWAIT, ordine FIXĂ: red_mail_setari → red_mail_oauth_state, ambele ACCESS EXCLUSIVE, cerute de ALTER TABLE):
--   opresc și citirile din cele două tabele până la COMMIT (ecranul „Lot e-mail” așteaptă). Bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI
--   ÎNCERCĂRI, verificat înaintea fiecărei încercări și DUPĂ obținerea setului complet; fiecare încercare = subtranzacție. Lock-uri implicite:
--   CREATE OR REPLACE FUNCTION nu ia lock pe tabele; INSERT-urile RPC-urilor noi nu rulează aici.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, bugetul lock-urilor
--   de 1 s și garda finală a runnerului.
-- Revenire: supabase/revenire/20261131h_redari_mail_f2b_trimitere_ROLLBACK.sql (prin runner, plafon 2000; L14 textual: refuză la ORICE istoric
--   produs după aplicare — state `trimitere`, evenimente oauth_* ale trimiterii, rândul Vault, mesaje / jurnal F2 de transport — deci e posibilă doar
--   pe o bază pe care trimiterea n-a fost folosită; după prima conectare, întoarcerea = migrare nouă, revizuită). Probe:
--   scripts/pglite/test_redari_mail_f2b_local.mjs (PGlite, pașii reali L15 v2 ai runnerului, RPC-urile reale de trimitere, triggerul, refuzuri,
--   aplicare → revenire → reaplicare, mutanți) + supabase/tests/20261131h_redari_mail_f2b_concurenta.sh (două sesiuni psql REALE cu barieră explicită, pe un
--   cluster PostgreSQL complet dispensabil: redenumirea TEST → real și real → TEST concurentă cu rezervarea, UPDATE-ul proiectului concurent cu
--   autorizarea apelului; SQLSTATE-urile promise). Vault-ul real și regresiile pe clona completă: coordonatorul (docs/redari/MAIL_PROBA_PASI.md §3).
DO $pre$
DECLARE v_plafon text; v_rau text; v_def text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131h_redari_mail_f2b_trimitere:' || txid_current() THEN
    RAISE EXCEPTION '20261131h: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261131h: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261131h: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261131h: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261131h: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tabelul lui temporar, cu tag aleator, CREAT de tranzacția curentă și
  -- ținut de sesiune; tiparul 20261225a). Fără --amprenta-globala / --diferente-globale (sau în afara runnerului) = refuz.
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261131h: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regprocedure('public.fn_red_mail_secret_seteaza(text,text,uuid,text)') IS NOT NULL OR to_regprocedure('public.fn_red_mail_oauth_start(text,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_red_mail_secret_seteaza', 'fn_red_mail_secret_citeste', 'fn_red_mail_oauth_start', 'fn_red_mail_oauth_consuma', 'fn_red_mail_oauth_eveniment', 'fn_red_proiect_e_test', 'fn_red_proiect_cod_test_garda'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_proiect_cod_test')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.red_mail_setari'::regclass AND a.attname IN ('doar_proiecte_test', 'trimitere_conectata_la', 'trimitere_conectata_de', 'trimitere_casuta') AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '20261131h: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / scrise (tipurile din 20261126a / 20261130j / 20261131a / 20261212a)
  SELECT string_agg(v.t || '.' || v.c, ', ') INTO v_rau FROM (VALUES
      ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'), ('red_proiecte', 'id', 'uuid'), ('red_proiecte', 'cod', 'text'),
      ('red_mail_loturi', 'id', 'uuid'), ('red_mail_mesaje', 'lot_id', 'uuid'), ('red_mail_mesaje', 'stare', 'text'), ('red_mail_mesaje', 'id', 'uuid'),
      ('red_mail_mesaje', 'lease_token', 'uuid'), ('red_mail_mesaje', 'lease_pana', 'timestamp with time zone'), ('red_mail_mesaje', 'rezervat_la', 'timestamp with time zone'),
      ('red_fan_awb', 'proiect_id', 'uuid'), ('red_fan_awb', 'stare', 'text'), ('red_mail_jurnal_f2', 'cod', 'text'),
      ('red_mail_setari', 'id', 'smallint'), ('red_mail_setari', 'trimitere_oprita', 'boolean'), ('red_mail_setari', 'extern_permis', 'boolean'),
      ('red_mail_setari', 'pauza_pana', 'timestamp with time zone'), ('red_mail_setari', 'versiune', 'integer'),
      ('red_mail_oauth_state', 'id', 'uuid'), ('red_mail_oauth_state', 'state_sha256', 'text'), ('red_mail_oauth_state', 'scop', 'text'), ('red_mail_oauth_state', 'owner_id', 'uuid'),
      ('red_mail_oauth_state', 'creat_la', 'timestamp with time zone'), ('red_mail_oauth_state', 'expira_la', 'timestamp with time zone'), ('red_mail_oauth_state', 'consumat_la', 'timestamp with time zone'),
      ('red_mail_evenimente', 'tip', 'text'), ('red_mail_evenimente', 'cod', 'text'), ('red_mail_evenimente', 'casuta', 'text'), ('red_mail_evenimente', 'autor', 'uuid'),
      ('red_mail_loturi', 'proiect_id', 'uuid'), ('red_mail_loturi', 'stare', 'text'), ('red_mail_loturi', 'aprobat_de', 'uuid'), ('red_mail_loturi', 'aprobat_la', 'timestamp with time zone'),
      ('red_mail_loturi', 'lot_sha256', 'text'), ('red_mail_loturi', 'aprobat_lot_sha256', 'text')
    ) v(t, c, tip)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = v.t AND ic.column_name = v.c AND ic.data_type = v.tip);
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131h: coloane lipsa / alt tip: %', v_rau; END IF;
  -- CHECK-urile pe care le înlocuiește: EXACT cele din 20261131a / 20261130j
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_setari'::regclass AND c.conname = 'red_mail_f2_inert_ck';
  IF v_def IS DISTINCT FROM 'CHECK (((trimitere_oprita IS TRUE) AND (extern_permis IS FALSE)))' THEN
    RAISE EXCEPTION '20261131h: red_mail_f2_inert_ck nu e cel din 20261131a (%)', coalesce(v_def, 'lipsa');
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_oauth_state'::regclass AND c.conname = 'red_mail_oauth_state_scop_ck';
  IF v_def IS DISTINCT FROM 'CHECK ((scop = ANY (ARRAY[''citire''::text, ''citire_test''::text, ''golire''::text, ''golire_test''::text])))' THEN
    RAISE EXCEPTION '20261131h: red_mail_oauth_state_scop_ck nu e cel din 20261130j (%)', coalesce(v_def, 'lipsa');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_setari'::regclass AND c.conname LIKE 'red_mail_f2b_%') THEN
    RAISE EXCEPTION '20261131h: constrangeri red_mail_f2b_* deja prezente';
  END IF;
  -- evenimentele: tipurile OAuth există în CHECK (20261130j), triggerul append-only e activ
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_evenimente'::regclass AND c.conname = 'red_mail_evenimente_tip_ck';
  IF v_def IS NULL OR v_def NOT LIKE '%''oauth_conectat''::text%' OR v_def NOT LIKE '%''oauth_respins''::text%' OR v_def NOT LIKE '%''oauth_revocat''::text%' THEN
    RAISE EXCEPTION '20261131h: red_mail_evenimente_tip_ck fara tipurile oauth_*';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_mail_evenimente'::regclass AND t.tgname = 'trg_red_mail_evenimente_reguli' AND t.tgenabled = 'O') <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_mail_oauth_state'::regclass AND t.tgname = 'trg_red_mail_oauth_state_reguli' AND t.tgenabled = 'O') <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_mail_setari'::regclass AND t.tgname IN ('trg_red_mail_setari_reguli', 'trg_red_versiune') AND t.tgenabled = 'O') <> 2
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_mail_loturi'::regclass AND t.tgname = 'trg_red_mail_f2_lot' AND t.tgenabled = 'O') <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_mail_mesaje'::regclass AND t.tgname = 'trg_red_mail_f2_mesaj' AND t.tgenabled = 'O') <> 1 THEN
    RAISE EXCEPTION '20261131h: triggerele 20261130k / 20261131a pe evenimente / oauth_state / setari / loturi / mesaje lipsesc sau sunt oprite';
  END IF;
  -- stările FAN pe care le citește triggerul: CHECK-ul din 20261212a le conține
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_fan_awb'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE 'CHECK ((stare = ANY (ARRAY[%';
  IF v_def IS NULL OR v_def NOT LIKE '%''propus''::text%' OR v_def NOT LIKE '%''aprobat''::text%' OR v_def NOT LIKE '%''in_curs''::text%' OR v_def NOT LIKE '%''necunoscut''::text%' THEN
    RAISE EXCEPTION '20261131h: red_fan_awb.stare nu are starile asteptate (20261212a): %', coalesce(v_def, 'lipsa');
  END IF;
  -- funcțiile F2 înlocuite / chemate: EXACT cele din 20261131a (corp fără CR + proprietăți)
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_mail_f2_setari(boolean,boolean,integer)', '88b2a3f13a95d346b1fec56736aa89e3', 'plpgsql', true, 'v', 'boolean'),
      ('public.fn_red_mail_f2_poate(public.red_mail_loturi)', 'd239c6cc7bcb13691d798f99d4f1aa58', 'plpgsql', false, 's', 'text'),
      ('public.fn_red_mail_rezerva(uuid)', 'a5bf83c98b41d8665cce7e536eea4343', 'plpgsql', true, 'v', 'public.red_mail_mesaje'),
      ('public.fn_red_mail_apel_incepe(uuid,uuid)', 'b3834ab1c09d2671c0778621f3271255', 'plpgsql', true, 'v', 'boolean'),
      ('public.fn_red_mail_f2_owner()', '220cfdf1f3e97fde8cd597a5b24537ed', 'plpgsql', true, 's', 'void'),
      ('public.fn_red_mail_f2_audit(uuid,uuid,text)', '22f7267f17b19a625fc849ae217fc160', 'plpgsql', true, 'v', 'void'),
      ('public.fn_red_mail_f2_lot_hash(uuid)', '405820f220f0bd56b901f22b3ef35155', 'sql', false, 's', 'text')
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres';
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131h: functiile F2 nu sunt cele din 20261131a: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_red_mail_f2_setari', 'fn_red_mail_f2_poate', 'fn_red_mail_rezerva', 'fn_red_mail_apel_incepe')) <> 4
     OR (SELECT p.proretset FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_rezerva(uuid)'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION '20261131h: variante neasteptate ale functiilor inlocuite';
  END IF;
  -- istoricul pe care revenirea îl va trata ca „utilizare” (L14) nu există încă: trimiterea era imposibilă înainte (CHECK-ul inert), iar OAuth-ul
  -- F1 nu e livrat; evenimentele oauth_* / state-urile sunt append-only, deci după aplicare orice astfel de rând = urmă a acestei migrări
  IF EXISTS (SELECT 1 FROM public.red_mail_evenimente e WHERE (e.tip IN ('oauth_conectat', 'oauth_revocat') AND e.cod = 'trimitere') OR e.tip = 'oauth_respins')
     OR EXISTS (SELECT 1 FROM public.red_mail_jurnal_f2 j WHERE j.cod IN ('rezervat', 'apel_inceput', 'trimis', 'esuat_sigur', 'necunoscut', 'esuat_confirmat'))
     OR EXISTS (SELECT 1 FROM public.red_mail_mesaje m WHERE m.stare IN ('rezervat', 'in_apel', 'trimis', 'esuat_sigur', 'necunoscut', 'esuat_confirmat') OR m.rezervat_la IS NOT NULL) THEN
    RAISE EXCEPTION '20261131h: exista deja istoric de trimitere / OAuth trimitere (evenimente, jurnal F2, mesaje) — revenirea L14 nu l-ar putea deosebi';
  END IF;
  -- dependențele: identitatea, poarta owner, informarea, Vault-ul (create / update / vederea decriptată)
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('public.fn_sms_e_owner()') IS NULL OR to_regprocedure('public.fn_red_informare_publicata(text)') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION '20261131h: dependentele (auth.uid, fn_sms_e_owner, fn_red_informare_publicata, vault.create_secret / update_secret / decrypted_secrets) lipsesc';
  END IF;
  -- nimic „în zbor”: setările OFF și fără extern (CHECK-ul inert le garantează), niciun secret de trimitere cu valoare, niciun state `trimitere` (CHECK-ul vechi)
  IF NOT EXISTS (SELECT 1 FROM public.red_mail_setari WHERE id = 1 AND trimitere_oprita IS TRUE AND extern_permis IS FALSE) OR (SELECT count(*) FROM public.red_mail_setari) <> 1 THEN
    RAISE EXCEPTION '20261131h: red_mail_setari nu e in starea inerta asteptata (un rand, OFF, extern = false)';
  END IF;
  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN' AND coalesce(s.decrypted_secret, '') <> '') THEN
    RAISE EXCEPTION '20261131h: exista deja un secret REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN cu valoare in Vault';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261131h: anon/authenticated pot crea obiecte in public';
  END IF;
END $pre$;

-- drepturile EXACTE ale celor patru funcții înlocuite, ÎNAINTE (postcondiția: aceleași după CREATE OR REPLACE)
CREATE TEMP TABLE red_acl_20261131h ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS functie, coalesce(p.proacl, acldefault('f', p.proowner))::text AS acl
    FROM pg_proc p WHERE p.oid IN ('public.fn_red_mail_f2_setari(boolean,boolean,integer)'::regprocedure, 'public.fn_red_mail_f2_poate(public.red_mail_loturi)'::regprocedure,
                                   'public.fn_red_mail_rezerva(uuid)'::regprocedure, 'public.fn_red_mail_apel_incepe(uuid,uuid)'::regprocedure);

-- ── punctul UNIC de blocare (L06): red_mail_setari → red_mail_oauth_state, ACCESS EXCLUSIVE, NOWAIT; bugetul 1 s de la prima încercare ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261131h: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000)
        USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.red_mail_setari IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.red_mail_oauth_state IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261131h: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000)
      USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261131h: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. red_mail_setari: gărzile F2b în locul CHECK-ului inert + starea conectării ────────────────────────────────────────────────
ALTER TABLE public.red_mail_setari DROP CONSTRAINT red_mail_f2_inert_ck;
ALTER TABLE public.red_mail_setari
  ADD COLUMN doar_proiecte_test boolean NOT NULL DEFAULT true,
  ADD COLUMN trimitere_conectata_la timestamptz,
  ADD COLUMN trimitere_conectata_de uuid,
  ADD COLUMN trimitere_casuta text,
  ADD CONSTRAINT red_mail_f2b_extern_ck CHECK (extern_permis IS FALSE),
  ADD CONSTRAINT red_mail_f2b_doar_test_ck CHECK (doar_proiecte_test IS TRUE),
  ADD CONSTRAINT red_mail_f2b_conectare_ck CHECK ((trimitere_conectata_la IS NULL) = (trimitere_conectata_de IS NULL) AND (trimitere_conectata_la IS NULL) = (trimitere_casuta IS NULL)
    AND (trimitere_casuta IS NULL OR trimitere_casuta = 'redari@gazpet.ro')),
  ADD CONSTRAINT red_mail_f2b_pornire_ck CHECK (trimitere_oprita IS TRUE OR trimitere_conectata_la IS NOT NULL);
COMMENT ON COLUMN public.red_mail_setari.doar_proiecte_test IS 'Redări e-mail F2b: cât e adevărat, fn_red_mail_f2_poate refuză (doar_proiecte_test) orice lot al unui proiect al cărui cod nu începe cu TEST- (aceeași gardă ca în funcția edge). CHECK IS TRUE: se schimbă doar prin migrare revizuită. 20261131h.';
COMMENT ON COLUMN public.red_mail_setari.trimitere_conectata_la IS 'Redări e-mail F2b: momentul conectării căsuței pentru trimitere (refresh token în Vault). Scris DOAR de fn_red_mail_secret_seteaza (service_role, p_apelant owner). NULL = neconectată; trimiterea nu poate fi pornită fără ea (red_mail_f2b_pornire_ck).';
COMMENT ON COLUMN public.red_mail_setari.trimitere_conectata_de IS 'Redări e-mail F2b: owner-ul care a dat consimțământul (uid din getUser, re-verificat owner în RPC).';
COMMENT ON COLUMN public.red_mail_setari.trimitere_casuta IS 'Redări e-mail F2b: căsuța dovedită din id_token la conectare (doar redari@gazpet.ro).';

-- ─── 2. red_mail_oauth_state: scopul `trimitere` ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.red_mail_oauth_state DROP CONSTRAINT red_mail_oauth_state_scop_ck;
ALTER TABLE public.red_mail_oauth_state ADD CONSTRAINT red_mail_oauth_state_scop_ck CHECK (scop IN ('citire', 'citire_test', 'golire', 'golire_test', 'trimitere'));

-- ─── 3. convenția „TEST-” într-o singură definiție SQL (L19) + fn_red_mail_f2_poate: corpul 20261131a + `casuta_neconectata` + garda „doar TEST” ──
CREATE FUNCTION public.fn_red_proiect_e_test(p_cod text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
 SELECT left(p_cod,5)='TEST-'
$fn$;
COMMENT ON FUNCTION public.fn_red_proiect_e_test(text) IS 'Redări: proiect de TEST = codul începe EXACT cu „TEST-” (sensibil la caz, fără spații) — aceeași convenție ca în cod (redariMailF2.mjs / redariFanHandler.mjs). Folosită de fn_red_mail_f2_poate și de trg_red_proiect_cod_test. 20261131h.';
CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_poate(l public.red_mail_loturi) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_setari WHERE id=1 AND trimitere_oprita IS FALSE AND (pauza_pana IS NULL OR pauza_pana<=now())) THEN RETURN 'trimitere_oprita'; END IF;
 -- 20261131h: trimiterea cere căsuța conectată (refresh token în Vault), iar cât doar_proiecte_test e adevărat, doar proiecte cu codul „TEST-…”
 -- (apelantul — fn_red_mail_rezerva / fn_red_mail_apel_incepe — ține rândul proiectului FOR SHARE, deci codul citit aici nu se poate schimba până la COMMIT)
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_setari WHERE id=1 AND trimitere_conectata_la IS NOT NULL) THEN RETURN 'casuta_neconectata'; END IF;
 IF EXISTS(SELECT 1 FROM public.red_mail_setari WHERE id=1 AND doar_proiecte_test IS TRUE)
    AND NOT EXISTS(SELECT 1 FROM public.red_proiecte WHERE id=l.proiect_id AND public.fn_red_proiect_e_test(cod) IS TRUE) THEN RETURN 'doar_proiecte_test'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_proiecte WHERE id=l.proiect_id AND public.fn_red_informare_publicata(cod) IS TRUE) THEN RETURN 'informare_nepublicata'; END IF;
 IF l.stare NOT IN ('aprobat','in_trimitere') OR l.aprobat_de IS NULL THEN RETURN 'lot_neaprobat'; END IF;
 IF l.aprobat_la IS NULL OR l.aprobat_la+interval '7 days'<=now() THEN RETURN 'aprobare_expirata'; END IF;
 IF public.fn_red_mail_f2_lot_hash(l.id) IS DISTINCT FROM l.lot_sha256 OR l.lot_sha256 IS DISTINCT FROM l.aprobat_lot_sha256 THEN RETURN 'lot_integritate'; END IF;
 RETURN NULL;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_f2_poate(public.red_mail_loturi) IS 'Redări e-mail F2 (intern, chemată sub lock de fn_red_mail_rezerva / fn_red_mail_apel_incepe, care țin și proiectul FOR SHARE): motivul pentru care un lot NU poate trimite, sau NULL. 20261131h: casuta_neconectata; doar_proiecte_test cât red_mail_setari.doar_proiecte_test e adevărat (fn_red_proiect_e_test(cod) nu e adevărat).';

-- ─── 3b. categoria proiectului (TEST- / real) e blocată cât proiectul are trimiteri în lucru (e-mail) sau AWB-uri FAN în lucru ───────────────
-- Rulează cu rândul proiectului deja blocat de UPDATE (lock-ul cu care rezerva / apel_incepe se serializează prin FOR SHARE); nu ia alt lock (L06).
-- SECURITY DEFINER: loturile / mesajele / AWB-urile au RLS doar pentru owner, iar redenumirea o poate încerca un admin Redări (red_proiecte_upd).
CREATE FUNCTION public.fn_red_proiect_cod_test_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 IF NEW.cod IS NOT DISTINCT FROM OLD.cod OR public.fn_red_proiect_e_test(NEW.cod) IS NOT DISTINCT FROM public.fn_red_proiect_e_test(OLD.cod) THEN RETURN NEW; END IF;
 -- schimbarea CATEGORIEI: în contextul aplicației (JWT) doar owner-ul; mentenanța (postgres fără JWT) trece de această condiție, nu și de următoarele
 IF (auth.uid() IS NOT NULL OR coalesce(auth.role(),'') IN ('anon','authenticated')) AND public.fn_sms_e_owner() IS NOT TRUE THEN
  RAISE EXCEPTION 'red_proiecte: categoria codului (TEST- / real) o schimba doar owner-ul' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.red_mail_loturi l WHERE l.proiect_id=NEW.id
           AND (l.stare<>'incheiat' OR EXISTS(SELECT 1 FROM public.red_mail_mesaje m WHERE m.lot_id=l.id AND m.stare IN ('rezervat','in_apel')))) THEN
  RAISE EXCEPTION 'red_proiecte: categoria codului (TEST- / real) nu se schimba cat proiectul are loturi de e-mail neincheiate sau mesaje rezervate / in apel' USING ERRCODE='P0001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.red_fan_awb a WHERE a.proiect_id=NEW.id AND a.stare IN ('propus','aprobat','in_curs','necunoscut')) THEN
  RAISE EXCEPTION 'red_proiecte: categoria codului (TEST- / real) nu se schimba cat proiectul are AWB-uri FAN propuse / aprobate / in curs / necunoscute' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.fn_red_proiect_cod_test_garda() IS 'Redări: trigger BEFORE UPDATE OF cod pe red_proiecte — categoria codului (TEST- / real, fn_red_proiect_e_test) se schimbă doar de owner și doar fără loturi de e-mail neîncheiate / mesaje rezervate sau în apel / AWB-uri FAN propuse, aprobate, în curs, necunoscute; redenumirile din aceeași categorie trec. 20261131h.';
CREATE TRIGGER trg_red_proiect_cod_test BEFORE UPDATE OF cod ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_proiect_cod_test_garda();

-- ─── 3c. fn_red_mail_rezerva / fn_red_mail_apel_incepe: corpurile 20261131a + proiectul FOR SHARE după lot (ordinea L06: setări → lot → proiect → mesaje) ──
CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva(p_lot uuid) RETURNS SETOF public.red_mail_mesaje
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; s public.red_mail_setari; cod text;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> proiect (FOR SHARE, 20261131h) -> mesaje ORDER BY id. Setările serializează și cotele globale.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=p_lot FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lot_inexistent'; END IF;
 -- 20261131h: decizia „doar TEST” a lui fn_red_mail_f2_poate e serializată cu orice UPDATE al proiectului (redenumire); trg_red_proiect_cod_test refuză
 -- schimbarea categoriei cât lotul nu e încheiat sau are mesaje rezervate / în apel, deci și între COMMIT-ul de aici și apelul HTTP.
 PERFORM 1 FROM public.red_proiecte WHERE id=l.proiect_id FOR SHARE;
 -- Reconcilierea locală a lease-urilor nu reia un send ambiguu.
 PERFORM 1 FROM public.red_mail_mesaje WHERE lot_id=l.id ORDER BY id FOR UPDATE;
 UPDATE public.red_mail_mesaje SET stare='necunoscut',eroare_cod='lease_expirat' WHERE lot_id=l.id AND stare='in_apel' AND lease_pana<=now();
 UPDATE public.red_mail_mesaje SET stare=CASE WHEN l.stare IN ('incheiat','blocat_integritate') THEN 'anulat' ELSE 'in_coada' END,rezervat_la=NULL,lease_token=NULL,lease_pana=NULL WHERE lot_id=l.id AND stare='rezervat' AND lease_pana<=now();
 cod:=public.fn_red_mail_f2_poate(l);
 IF cod='lot_integritate' THEN UPDATE public.red_mail_loturi SET stare='blocat_integritate',versiune=versiune+1 WHERE id=l.id; PERFORM public.fn_red_mail_f2_audit(l.id,NULL,cod); END IF;
 IF cod='aprobare_expirata' THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod=cod WHERE lot_id=l.id AND stare='in_coada'; END IF;
 IF cod IS NOT NULL THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.red_mail_mesaje WHERE stare IN ('rezervat','in_apel','necunoscut'))>=50 THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.red_mail_mesaje WHERE rezervat_la IS NOT NULL AND (rezervat_la AT TIME ZONE 'Europe/Bucharest')::date=(now() AT TIME ZONE 'Europe/Bucharest')::date)>=s.plafon_zi OR (SELECT count(*) FROM public.red_mail_mesaje WHERE rezervat_la IS NOT NULL AND date_trunc('month',rezervat_la AT TIME ZONE 'Europe/Bucharest')=date_trunc('month',now() AT TIME ZONE 'Europe/Bucharest'))>=s.plafon_luna THEN RETURN; END IF;
 SELECT * INTO m FROM public.red_mail_mesaje WHERE lot_id=l.id AND stare='in_coada' ORDER BY id LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.red_mail_optout WHERE email=m.catre AND activ) THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='optout' WHERE id=m.id; RETURN; END IF;
 IF NOT s.extern_permis AND split_part(m.catre,'@',2)<>'gazpet.ro' THEN RETURN; END IF;
 IF l.stare='aprobat' THEN UPDATE public.red_mail_loturi SET stare='in_trimitere',versiune=versiune+1 WHERE id=l.id; END IF;
 UPDATE public.red_mail_mesaje SET stare='rezervat',lease_token=gen_random_uuid(),lease_pana=now()+interval '2 minutes',rezervat_la=now(),rezervare_nr=rezervare_nr+1 WHERE id=m.id RETURNING * INTO m;
 PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'rezervat'); RETURN NEXT m;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_rezerva(uuid) IS 'Redări e-mail F2 (owner): rezervă următorul mesaj al lotului sub lock (setări → lot → proiect FOR SHARE → mesaje). 20261131h: proiectul FOR SHARE, ca decizia „doar TEST” să fie serializată cu redenumirea (trg_red_proiect_cod_test).';
CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe(p_mesaj uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE l public.red_mail_loturi; m public.red_mail_mesaje; cod text; s public.red_mail_setari;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- Ordine: setări -> lot -> proiect (FOR SHARE, 20261131h) -> mesaj; primul SELECT al id-ului nu blochează.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;  -- r3 (Gem r2 P2-02)
 SELECT * INTO l FROM public.red_mail_loturi WHERE id=(SELECT lot_id FROM public.red_mail_mesaje WHERE id=p_mesaj) FOR UPDATE;
 -- 20261131h: proiectul FOR SHARE (vezi fn_red_mail_rezerva); autorizarea apelului HTTP nu poate fi dată cu un cod de proiect care se schimbă în paralel
 PERFORM 1 FROM public.red_proiecte WHERE id=l.proiect_id FOR SHARE;
 SELECT * INTO m FROM public.red_mail_mesaje WHERE id=p_mesaj FOR UPDATE;
 IF NOT FOUND OR m.stare<>'rezervat' OR m.lease_token IS DISTINCT FROM p_token OR m.lease_pana<=now() THEN RETURN false; END IF;
 cod:=public.fn_red_mail_f2_poate(l);
 IF cod='lot_integritate' THEN UPDATE public.red_mail_loturi SET stare='blocat_integritate',versiune=versiune+1 WHERE id=l.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,cod); END IF;
 IF cod IS NOT NULL OR (NOT s.extern_permis AND split_part(m.catre,'@',2)<>'gazpet.ro') OR EXISTS(SELECT 1 FROM public.red_mail_optout WHERE email=m.catre AND activ) OR s.ultim_apel_la>now()-interval '2 seconds' THEN RETURN false; END IF;
 UPDATE public.red_mail_mesaje SET stare='in_apel',apel_inceput_la=now() WHERE id=m.id;
 UPDATE public.red_mail_setari SET ultim_apel_la=now() WHERE id=1;
 PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'apel_inceput'); RETURN true;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_apel_incepe(uuid,uuid) IS 'Redări e-mail F2 (owner): autorizează UN apel Gmail pentru mesajul rezervat (CAS pe lease). 20261131h: proiectul FOR SHARE, ca decizia „doar TEST” să fie serializată cu redenumirea (trg_red_proiect_cod_test).';

-- ─── 4. fn_red_mail_f2_setari: owner-ul poate porni trimiterea (căsuța conectată, versiunea curentă); extern rămâne refuzat; OFF fără condiții ──
CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_setari(p_oprit boolean,p_extern boolean,p_versiune integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE s public.red_mail_setari;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;
 IF p_oprit IS NULL OR p_extern IS NULL THEN RAISE EXCEPTION 'setari_invalide'; END IF;
 -- OFF nu depinde de cotă sau de versiunea dintr-un ecran vechi (L20).
 IF NOT p_oprit AND s.versiune IS DISTINCT FROM p_versiune THEN RAISE EXCEPTION 'versiune_veche'; END IF;
 -- 20261131h: destinatarii externi rămân închiși (migrare separată, după „da”-urile din plan); pornirea cere căsuța conectată.
 IF p_extern THEN RAISE EXCEPTION 'extern_amanat'; END IF;
 IF NOT p_oprit AND s.trimitere_conectata_la IS NULL THEN RAISE EXCEPTION 'casuta_neconectata'; END IF;
 UPDATE public.red_mail_setari SET trimitere_oprita=p_oprit,extern_permis=false WHERE id=1;
 PERFORM public.fn_red_mail_f2_audit(NULL,NULL,'setari'); RETURN true;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_f2_setari(boolean,boolean,integer) IS 'Redări e-mail F2 (owner): comutatorul de trimitere. 20261131h: p_oprit = false permis cu versiunea curentă și căsuța conectată (trimitere_conectata_la); p_extern = true refuzat (extern_amanat); OFF fără condiții.';

-- ─── 5. state-ul OAuth (owner, auth.uid()) ───────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_red_mail_oauth_start(p_scop text, p_state_sha256 text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 -- F2b: un singur scop; F1 își adaugă scopurile (citire / golire) în migrarea ei
 IF p_scop IS DISTINCT FROM 'trimitere' THEN RAISE EXCEPTION 'scop_nepermis' USING ERRCODE='22023'; END IF;
 IF p_state_sha256 IS NULL OR p_state_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'state_invalid' USING ERRCODE='22023'; END IF;
 -- curățenie: state-urile consumate / expirate ale scopului, mai vechi de o zi (triggerul 20261130k refuză ștergerea unui state activ)
 DELETE FROM public.red_mail_oauth_state WHERE scop='trimitere' AND (consumat_la IS NOT NULL OR expira_la<=now()) AND creat_la<now()-interval '1 day';
 INSERT INTO public.red_mail_oauth_state(state_sha256,scop,owner_id,expira_la) VALUES(p_state_sha256,p_scop,auth.uid(),now()+interval '10 minutes') RETURNING id INTO v_id;
 RETURN v_id;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_oauth_start(text,text) IS 'Redări e-mail F2b (owner): înregistrează state-ul OAuth (doar sha256, 64 hex) pentru scopul trimitere, legat de auth.uid(), 10 minute. 20261131h.';
CREATE FUNCTION public.fn_red_mail_oauth_consuma(p_state_sha256 text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_scop text;
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 IF p_state_sha256 IS NULL OR p_state_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'state_invalid' USING ERRCODE='22023'; END IF;
 -- consum ATOMIC, o singură dată: doar neconsumat, neexpirat și al owner-ului curent (L01 / L04)
 UPDATE public.red_mail_oauth_state SET consumat_la=now()
  WHERE state_sha256=p_state_sha256 AND consumat_la IS NULL AND expira_la>now() AND owner_id=auth.uid()
  RETURNING scop INTO v_scop;
 IF NOT FOUND THEN RAISE EXCEPTION 'state_invalid' USING ERRCODE='22023'; END IF;
 RETURN v_scop;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_oauth_consuma(text) IS 'Redări e-mail F2b (owner): consumă atomic state-ul OAuth (o singură dată, neexpirat, doar al owner-ului curent) și întoarce scopul; altfel state_invalid. 20261131h.';
CREATE FUNCTION public.fn_red_mail_oauth_eveniment(p_tip text, p_cod text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 PERFORM public.fn_red_mail_f2_owner();
 IF p_tip IS DISTINCT FROM 'oauth_respins' OR p_cod IS NULL OR p_cod NOT IN ('schimb_esuat','scope_diferit','fara_refresh_token','casuta_gresita','id_token_lipsa','id_token_forma',
   'id_token_alg','jwks_indisponibil','id_token_cheie','id_token_semnatura','id_token_iss','id_token_aud','id_token_exp','id_token_iat','id_token_neverificat','id_token_hd') THEN
  RAISE EXCEPTION 'eveniment_invalid' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.red_mail_evenimente(tip,cod,casuta,autor) VALUES(p_tip,p_cod,'redari@gazpet.ro',auth.uid());
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_oauth_eveniment(text,text) IS 'Redări e-mail F2b (owner): jurnalul unui refuz la callback-ul OAuth de trimitere (cod din listă închisă, fără conținut). 20261131h.';

-- ─── 6. Vault: doar service_role (funcțiile edge), p_apelant = uid-ul din getUser, re-verificat owner ─────────────────────────────
CREATE FUNCTION public.fn_red_mail_secret_seteaza(p_nume text, p_valoare text, p_apelant uuid, p_casuta text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE s public.red_mail_setari; v_id uuid;
BEGIN
 IF p_nume IS DISTINCT FROM 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN' THEN RAISE EXCEPTION 'secret_nepermis' USING ERRCODE='22023'; END IF;
 IF p_apelant IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=p_apelant AND pr.is_owner IS TRUE) THEN RAISE EXCEPTION 'non_owner' USING ERRCODE='42501'; END IF;
 IF p_valoare IS NULL OR length(p_valoare)>4096 OR p_valoare ~ '[[:space:][:cntrl:]]' THEN RAISE EXCEPTION 'valoare_invalida' USING ERRCODE='22023'; END IF;
 -- Ordine: setări FOR UPDATE -> Vault. Fără valoarea secretului în vreun jurnal.
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;
 SELECT d.id INTO v_id FROM vault.decrypted_secrets d WHERE d.name=p_nume;
 IF p_valoare='' THEN
  -- revocare / golire: valoarea golită (rândul rămâne, fără secret), trimiterea OPRITĂ, starea conectării ștearsă
  IF v_id IS NOT NULL THEN PERFORM vault.update_secret(v_id,''); END IF;
  UPDATE public.red_mail_setari SET trimitere_oprita=true,trimitere_conectata_la=NULL,trimitere_conectata_de=NULL,trimitere_casuta=NULL WHERE id=1;
  INSERT INTO public.red_mail_evenimente(tip,cod,casuta,autor) VALUES('oauth_revocat','trimitere','redari@gazpet.ro',p_apelant);
 ELSE
  IF p_casuta IS DISTINCT FROM 'redari@gazpet.ro' THEN RAISE EXCEPTION 'casuta_gresita' USING ERRCODE='22023'; END IF;
  IF v_id IS NULL THEN
   PERFORM vault.create_secret(p_valoare,p_nume,'Redari e-mail: refresh token OAuth pentru trimitere (gmail.send) din redari@gazpet.ro; scris doar de fn_red_mail_secret_seteaza (20261131h)');
  ELSE
   PERFORM vault.update_secret(v_id,p_valoare);
  END IF;
  UPDATE public.red_mail_setari SET trimitere_conectata_la=now(),trimitere_conectata_de=p_apelant,trimitere_casuta=p_casuta WHERE id=1;
  INSERT INTO public.red_mail_evenimente(tip,cod,casuta,autor) VALUES('oauth_conectat','trimitere','redari@gazpet.ro',p_apelant);
 END IF;
 RETURN true;
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_secret_seteaza(text,text,uuid,text) IS 'Redări e-mail F2b (DOAR service_role, din redari-mail-oauth după poarta owner): scrie în Vault refresh token-ul de trimitere (doar numele REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN) și starea conectării; p_apelant = uid-ul din getUser, re-verificat owner; p_valoare = '''' = revocare (valoare golită, trimitere_oprita = true). 20261131h.';
CREATE FUNCTION public.fn_red_mail_secret_citeste(p_nume text, p_apelant uuid, p_motiv text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE s public.red_mail_setari; v text;
BEGIN
 IF p_nume IS DISTINCT FROM 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN' THEN RAISE EXCEPTION 'secret_nepermis' USING ERRCODE='22023'; END IF;
 IF p_apelant IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=p_apelant AND pr.is_owner IS TRUE) THEN RAISE EXCEPTION 'non_owner' USING ERRCODE='42501'; END IF;
 IF p_motiv IS NULL OR p_motiv NOT IN ('trimitere','revocare') THEN RAISE EXCEPTION 'motiv_invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.red_mail_setari WHERE id=1 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'setari_absente' USING ERRCODE='22023'; END IF;
 IF s.trimitere_conectata_la IS NULL THEN RETURN NULL; END IF;
 -- pentru trimitere: doar cu comutatorul pornit și fără pauza de după un rezultat necunoscut (aceeași regulă ca fn_red_mail_f2_poate)
 IF p_motiv='trimitere' AND (s.trimitere_oprita IS NOT FALSE OR (s.pauza_pana IS NOT NULL AND s.pauza_pana>now())) THEN RAISE EXCEPTION 'trimitere_oprita' USING ERRCODE='22023'; END IF;
 SELECT d.decrypted_secret INTO v FROM vault.decrypted_secrets d WHERE d.name=p_nume;
 RETURN nullif(v,'');
END $fn$;
COMMENT ON FUNCTION public.fn_red_mail_secret_citeste(text,uuid,text) IS 'Redări e-mail F2b (DOAR service_role, din funcțiile edge după poarta owner): refresh token-ul de trimitere din Vault (doar numele REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN), doar cu căsuța conectată; motivul trimitere cere trimiterea pornită și fără pauză. 20261131h.';

-- ─── 7. Drepturi: nimic pentru PUBLIC / anon; owner-ul (authenticated, verificat în corp) pe state / eveniment; service_role doar pe Vault;
--        funcția convenției și cea a triggerului: doar proprietarul (sunt chemate din funcții ale lui postgres / de trigger) ─────────────────
REVOKE ALL ON FUNCTION public.fn_red_mail_oauth_start(text,text), public.fn_red_mail_oauth_consuma(text), public.fn_red_mail_oauth_eveniment(text,text),
  public.fn_red_mail_secret_seteaza(text,text,uuid,text), public.fn_red_mail_secret_citeste(text,uuid,text),
  public.fn_red_proiect_e_test(text), public.fn_red_proiect_cod_test_garda() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_mail_oauth_start(text,text), public.fn_red_mail_oauth_consuma(text), public.fn_red_mail_oauth_eveniment(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_red_mail_secret_seteaza(text,text,uuid,text), public.fn_red_mail_secret_citeste(text,uuid,text) TO service_role;

-- ─── 8. Postcondiții ───────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_rau text; v_def text;
BEGIN
  -- corpurile noi (amprentele: AMPRENTE-NOI 20261131h — aceleași constante în revenire) + proprietățile
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      -- >>> AMPRENTE-NOI 20261131h
      ('public.fn_red_mail_f2_poate(public.red_mail_loturi)', '01d3390b765bedc9fd64801f113109c9', 'plpgsql', false, 's', 'text'),
      ('public.fn_red_mail_f2_setari(boolean,boolean,integer)', '06f8a334c57a61109aa2086870712ace', 'plpgsql', true, 'v', 'boolean'),
      ('public.fn_red_mail_rezerva(uuid)', 'd779e03d0644e437db412b0c3721e6c0', 'plpgsql', true, 'v', 'public.red_mail_mesaje'),
      ('public.fn_red_mail_apel_incepe(uuid,uuid)', '9e8dbac708ee9512cd402a960d1d446a', 'plpgsql', true, 'v', 'boolean'),
      ('public.fn_red_proiect_e_test(text)', 'b3a152708e032c698980981ab0eb3cf9', 'sql', false, 'i', 'boolean'),
      ('public.fn_red_proiect_cod_test_garda()', '5754b1afd6385c9a2c96a5330be85bb5', 'plpgsql', true, 'v', 'trigger'),
      ('public.fn_red_mail_oauth_start(text,text)', '3c99764f8b3ae99b845301477387dd31', 'plpgsql', true, 'v', 'uuid'),
      ('public.fn_red_mail_oauth_consuma(text)', '376c86dba339df3453368f1964359452', 'plpgsql', true, 'v', 'text'),
      ('public.fn_red_mail_oauth_eveniment(text,text)', 'c7c0629bcde5687075f531278987c374', 'plpgsql', true, 'v', 'void'),
      ('public.fn_red_mail_secret_seteaza(text,text,uuid,text)', '0044821f5c4f4b33fbef1ecfc7d27e54', 'plpgsql', true, 'v', 'boolean'),
      ('public.fn_red_mail_secret_citeste(text,uuid,text)', '48306df63e0ef6383a610563687e8271', 'plpgsql', true, 'v', 'text')
      -- <<< AMPRENTE-NOI 20261131h
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres';
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131h: postconditie: functiile (corp / proprietati) difera: %', v_rau; END IF;
  IF (SELECT p.proretset FROM pg_proc p WHERE p.oid = 'public.fn_red_mail_rezerva(uuid)'::regprocedure) IS NOT TRUE THEN RAISE EXCEPTION '20261131h: postconditie: fn_red_mail_rezerva nu mai e SETOF'; END IF;
  -- drepturile: funcțiile înlocuite = EXACT ACL-ul de dinainte; cele noi: owner-ul (authenticated) pe state / eveniment, service_role pe Vault,
  -- convenția și funcția triggerului doar postgres, nimic altceva
  IF EXISTS (SELECT 1 FROM red_acl_20261131h a JOIN pg_proc p ON p.oid = to_regprocedure(a.functie)
              WHERE coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM a.acl)
     OR (SELECT count(*) FROM red_acl_20261131h) <> 4
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.fn_red_mail_oauth_start(text,text)'::regprocedure, 'public.fn_red_mail_oauth_consuma(text)'::regprocedure, 'public.fn_red_mail_oauth_eveniment(text,text)'::regprocedure)
                 AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.fn_red_mail_secret_seteaza(text,text,uuid,text)'::regprocedure, 'public.fn_red_mail_secret_citeste(text,uuid,text)'::regprocedure)
                 AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.fn_red_proiect_e_test(text)'::regprocedure, 'public.fn_red_proiect_cod_test_garda()'::regprocedure)
                 AND coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
    RAISE EXCEPTION '20261131h: postconditie: drepturile functiilor difera';
  END IF;
  -- triggerul: exact unul, BEFORE UPDATE OF cod, FOR EACH ROW, fără WHEN / argumente, pornit, pe funcția lui
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_proiect_cod_test' AND NOT t.tgisinternal
        AND t.tgfoid = 'public.fn_red_proiect_cod_test_garda()'::regprocedure AND t.tgenabled = 'O' AND t.tgtype = 19 AND t.tgqual IS NULL AND t.tgnargs = 0
        AND t.tgattr::text = (SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid = 'public.red_proiecte'::regclass AND a.attname = 'cod')) <> 1 THEN
    RAISE EXCEPTION '20261131h: postconditie: trg_red_proiect_cod_test lipseste sau difera';
  END IF;
  -- constrângerile noi, exact; cea inertă dispărută; scopul `trimitere` în CHECK
  SELECT string_agg(c.conname || ' = ' || pg_get_constraintdef(c.oid), '; ' ORDER BY c.conname) INTO v_def
    FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_setari'::regclass AND c.conname LIKE 'red_mail_f2%';
  IF v_def IS DISTINCT FROM 'red_mail_f2b_conectare_ck = CHECK ((((trimitere_conectata_la IS NULL) = (trimitere_conectata_de IS NULL)) AND ((trimitere_conectata_la IS NULL) = (trimitere_casuta IS NULL)) AND ((trimitere_casuta IS NULL) OR (trimitere_casuta = ''redari@gazpet.ro''::text)))); '
     'red_mail_f2b_doar_test_ck = CHECK ((doar_proiecte_test IS TRUE)); red_mail_f2b_extern_ck = CHECK ((extern_permis IS FALSE)); red_mail_f2b_pornire_ck = CHECK (((trimitere_oprita IS TRUE) OR (trimitere_conectata_la IS NOT NULL)))' THEN
    RAISE EXCEPTION '20261131h: postconditie: constrangerile red_mail_setari: %', coalesce(v_def, 'lipsa');
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_oauth_state'::regclass AND c.conname = 'red_mail_oauth_state_scop_ck';
  IF v_def IS DISTINCT FROM 'CHECK ((scop = ANY (ARRAY[''citire''::text, ''citire_test''::text, ''golire''::text, ''golire_test''::text, ''trimitere''::text])))' THEN
    RAISE EXCEPTION '20261131h: postconditie: red_mail_oauth_state_scop_ck (%)', coalesce(v_def, 'lipsa');
  END IF;
  -- coloanele noi, cu tipurile și implicitele lor
  IF (SELECT count(*) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'public.red_mail_setari'::regclass AND NOT a.attisdropped
         AND ((a.attname = 'doar_proiecte_test' AND format_type(a.atttypid, a.atttypmod) = 'boolean' AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = 'true')
           OR (a.attname = 'trimitere_conectata_la' AND format_type(a.atttypid, a.atttypmod) = 'timestamp with time zone' AND NOT a.attnotnull AND d.adbin IS NULL)
           OR (a.attname = 'trimitere_conectata_de' AND format_type(a.atttypid, a.atttypmod) = 'uuid' AND NOT a.attnotnull AND d.adbin IS NULL)
           OR (a.attname = 'trimitere_casuta' AND format_type(a.atttypid, a.atttypmod) = 'text' AND NOT a.attnotnull AND d.adbin IS NULL))) <> 4 THEN
    RAISE EXCEPTION '20261131h: postconditie: coloanele noi red_mail_setari';
  END IF;
  -- starea: tot OFF, extern = false, doar TEST, neconectată; niciun state `trimitere`; niciun secret cu valoare
  IF NOT EXISTS (SELECT 1 FROM public.red_mail_setari WHERE id = 1 AND trimitere_oprita IS TRUE AND extern_permis IS FALSE AND doar_proiecte_test IS TRUE
                   AND trimitere_conectata_la IS NULL AND trimitere_conectata_de IS NULL AND trimitere_casuta IS NULL)
     OR EXISTS (SELECT 1 FROM public.red_mail_oauth_state WHERE scop = 'trimitere')
     OR EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN' AND coalesce(s.decrypted_secret, '') <> '') THEN
    RAISE EXCEPTION '20261131h: postconditie: starea initiala (OFF, neconectata, fara state / secret)';
  END IF;
  -- tabelele atinse: fără drepturi de scriere pentru roluri (ca în 20261130j / 20261131a), RLS pornit
  IF has_table_privilege('authenticated', 'public.red_mail_setari', 'INSERT') OR has_table_privilege('authenticated', 'public.red_mail_setari', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.red_mail_setari', 'DELETE') OR has_table_privilege('service_role', 'public.red_mail_setari', 'UPDATE')
     OR has_table_privilege('anon', 'public.red_mail_setari', 'SELECT') OR has_table_privilege('authenticated', 'public.red_mail_oauth_state', 'SELECT')
     OR has_table_privilege('service_role', 'public.red_mail_oauth_state', 'SELECT') OR has_table_privilege('authenticated', 'public.red_mail_oauth_state', 'UPDATE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.red_mail_setari'::regclass) OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.red_mail_oauth_state'::regclass) THEN
    RAISE EXCEPTION '20261131h: postconditie: drepturile / RLS pe red_mail_setari / red_mail_oauth_state';
  END IF;
  RAISE NOTICE '20261131h: sfarsit la % ms de la BEGIN; lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::bigint / 1000.0);
END $post$;
