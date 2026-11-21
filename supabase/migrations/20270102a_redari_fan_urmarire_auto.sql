-- Version 20270102120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270102a_redari_fan_urmarire_auto.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului în
--   aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 v2 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ a runnerului. Lista OBIECTELOR din manifest e în
--   supabase/tests/20270102a_redari_fan_urmarire_auto.l15.obiecte.tsv (generată pe PGlite cu pașii reali ai runnerului). Pe lângă ea, migrarea
--   verifică pe amprentă (corp fără CR + proprietăți + EXECUTE), ÎNAINTE: poarta de drept fn_red_nivel (20261126a) și TOATE cele 52 de funcții
--   fn_red_fan_* ale bazei, EXACT lista AMPRENTE-NOI din 20261228a (listă scrisă, nu citită din catalog); DUPĂ: cele 58 de funcții (49 neschimbate,
--   3 înlocuite — fn_red_fan_srv_urmarire, fn_red_fan_urmarire, fn_red_fan_urmarire_intern —, 6 noi, între ele predicatul fn_red_fan_moment_posibil
--   din runda 5) cu amprentele lor (AMPRENTE-NOI 20270102a) și EXECUTE exact pe clasă.
-- RUNDA 5 (#1155, Jakarinos r4 P1): CLASA „dată imposibilă”, nu cazul C0. O singură regulă pentru ORICE eveniment (fn_red_fan_moment_posibil =
--   redariFan.mjs::momentPosibilFan): ziua ≥ ziua generării AWB-ului și momentul ≤ acum + 300 s (ora României). Codul o aplică înaintea faptelor
--   (evenimentele imposibile nu intră în stare / livrare / retur / ridicare / contradicții / cronologie, ci în `respinse`); BD-ul o reface cu ceasul
--   lui (dezacord = rând păstrat, fără fapte) și păstrează în audit fiecare eveniment imposibil (eveniment_data_imposibila, ales „respins”). O
--   livrare imposibilă nu e fapt final: AWB-ul rămâne în selecția rulării automate.
-- RUNDA 6 (#1155, Jakarinos r5 P1 / P2): (P1) returul cunoscut e fapt final DOAR pe o cronologie lipsă (returul legitim fără oră) sau posibilă; un
--   retur scris pe o cronologie imposibilă iese din fapte, lasă urmă în audit și nu mai împiedică corecția validă; AWB-ul rămâne de urmărit (selecția
--   folosește aceeași compunere). „Neordonabil” se judecă față de cronologia cunoscută POSIBILĂ. (P2) evenimentele imposibile ale răspunsului lasă
--   urmă în audit și pe rândurile DEPĂȘITE (CAS pe versiune / cronologie mai veche), fără să slăbească protecția faptelor.
-- RUNDA 2 (#1155, 21.11.2026) — DECIZIA OWNER-ULUI: „verificările de livrare la 2000 de oameni o să fie aproape imposibile, trebuie să mergem pe ce
--   livrează API-ul”. Faptele raportate de curier (ridicarea C0, livrarea S2, returul) se înregistrează AUTOMAT, pe buton ȘI pe cron (același corp
--   nou, fn_red_fan_urmarire_scrie, L19); contradicțiile NU mai blochează rândul la om: se rezolvă după o regulă deterministă și se păstrează DURABIL
--   în red_fan_contradictii (valorile, regula, rularea / omul), ca semnal de audit. REGULA (fan-contradictii-v1, aceeași în redariFan.mjs::
--   REGULI_CONTRADICTII): ridicarea = prima zi C0 (o zi deja înregistrată nu se mută); livrarea = ultima oră S2; livrare vs retur = evenimentul
--   final ULTERIOR după ora curierului, la egalitate / retur fără oră → retur; între două răspunsuri, motivul de retur al răspunsului mai nou; un
--   răspuns fără eveniment final nu șterge finalul cunoscut. Pe loturile de TEST ridicarea trece rândul generat → ridicat (ridicat_la = ziua C0),
--   cu un eveniment ridicare_auto în red_jurnal; pe loturile reale plicul NU se atinge (expedierea pe plic = D4 / F4, cu „da”-ul juridic), iar
--   ridicarea rămâne pentru butonul owner-ului (fn_red_fan_ridicat, neschimbată). O dată C0 înainte de generarea AWB-ului / în viitor nu se
--   înregistrează (semnal în audit; runda 5: eveniment_data_imposibila, pentru ORICE eveniment). Coloanele *_contrazis nu se mai scriu (verificarea prealabilă cere să fie goale).
-- RUNDA 3 (#1155, Jakarinos r2): (P1) evenimentele cu aceeași oră se departajează explicit în cod (redariFan.mjs::ORDINE_EGALITATE), toate cele de la
--   ora maximă contează (motive diferite la aceeași oră = contradicția retur_motiv din același răspuns, acceptată acum de validare); (P2) o zi C0
--   imposibilă nu se mai salvează în ridicat_propus și nu mai blochează o zi posibilă din același răspuns sau din următoarele (doar audit);
--   (P2) limita valorilor unei contradicții = 50 în cod, în validare și în CHECK (paritate testată), validarea pe forme fixe per tip.
-- BAZA = 20261212a + 20261227a + 20261228a aplicate, în această ordine.
-- 20270102a_redari_fan_urmarire_auto — Redări FAN: urmărirea AWB-urilor actualizată AUTOMAT (decizia owner-ului, 21.11.2026; spec
--   docs/redari/FAN_FLUX_OPERATOR_SPEC.md §9, felia „F2a” din docs/redari/FAN_URMARIRE_AUTOMATA.md). Faptul de pornire: un AWB livrat pe 20.11 la
--   10:40 a ajuns în ERP abia pe 21.11, la apăsarea butonului „Urmărire”.
--   Ce adaugă: (1) red_fan_rulari = jurnalul rulărilor automate (una singură în curs odată; o rulare de cron pe slotul zilei — dimineața / seara,
--   ora României; cel mult 4 rulări manuale ale owner-ului pe zi; plafonul de solicitări FAN pe rulare); (2) patru RPC-uri ale clasei B (EXECUTE
--   EXCLUSIV service_role, în corp auth.uid() IS NULL): fn_red_fan_srv_rulare_incepe (revendicarea), fn_red_fan_srv_de_urmarit (ce e de urmărit:
--   o singură definiție, L19), fn_red_fan_srv_rulare_apel (pasul durabil al plafonului ÎNAINTEA fiecărui GET către curier),
--   fn_red_fan_srv_rulare_incheie (închiderea + un rând în red_jurnal); (3) fn_red_fan_srv_urmarire acceptă p_rulare (rezervat din 20261228a):
--   exact unul dintre p_actor / p_rulare e nenul; cu p_rulare scrie prin ACELAȘI corp fn_red_fan_urmarire_intern (CAS pe versiune, propuneri) și
--   adună numerele în rândul rulării. NU se schimbă: fn_red_fan_srv_confirmari (confirmările rămân la buton: dovada de livrare e a omului, F3),
--   fn_red_fan_ridicat (butonul owner-ului, singura cale spre plic), plicul (nicio scriere pe red_plicuri). (Runda 2: vezi mai sus — faptele și
--   contradicțiile.)
--   Jobul cron NU e în migrare (postgres nu e superuser pe Supabase): îl pune coordonatorul cu cron.schedule DUPĂ aplicare (docs/redari/FAN_URMARIRE_AUTOMATA.md §5).
-- ORDINEA lock-urilor la rulare (L06; se adaugă la §6.2 ca poziția 12, DUPĂ red_fan_awb și ÎNAINTEA red_jurnal): fn_red_fan_srv_rulare_incepe =
--   advisory (cheia fixă a rulărilor) → rândurile red_fan_rulari; fn_red_fan_srv_rulare_apel = rândul rulării (UPDATE CAS); fn_red_fan_srv_urmarire
--   cu p_rulare = 3 red_fan_awb (ORDER BY id, în corpul comun) → INSERT red_fan_contradictii + INSERT red_jurnal (doar inserări: cheia unică a
--   contradicțiilor începe cu rândul FAN, deja blocat de aceeași tranzacție, deci nicio altă tranzacție nu poate ține aceeași cheie) → 12 rândul
--   rulării (UPDATE); fn_red_fan_srv_rulare_incheie = 12 rândul rulării → 11 red_jurnal (INSERT, ultimul). Nicio cale nu ia rândul rulării
--   înaintea rândurilor FAN. red_fan_contradictii.fan_awb_id → red_fan_awb (FK: la INSERT, FOR KEY SHARE pe rândul deja blocat FOR UPDATE de noi).
-- Lock-uri la APLICARE: cheia străină nouă ia SHARE ROW EXCLUSIVE pe red_fan_awb (blochează scrierile cât durează CREATE TABLE; lock_timeout 100 ms
--   → la concurență migrarea pică curat, nimic schimbat); restul = tabele noi, funcții noi, CREATE OR REPLACE = doar rândul funcției din pg_proc.
--   Nicio funcție creată nu rulează la aplicare (în afara postcondițiilor, care doar citesc).
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms și garda finală a runnerului.
-- Revenire: supabase/revenire/20270102a_redari_fan_urmarire_auto_ROLLBACK.sql (prin runner, plafonul 2000; LOCK … NOWAIT pe red_fan_rulari;
--   refuză cu orice rulare sau eveniment urmarire_auto în red_jurnal; readuce TEXTUAL corpul din 20261228a al fn_red_fan_srv_urmarire, cu amprenta verificată DUPĂ).
-- Probe: scripts/pglite/test_redari_fan_urmarire_auto_local.mjs (PGlite: aplicarea ca runnerul peste 20261212a + 20261227a + 20261228a, clasa B
--   ca authenticated / anon / service_role, revendicarea și suprapunerea, plafonul, expirarea, selecția, scrierea cu p_rulare, revenirea, mutanți)
--   + supabase/tests/20270102a_redari_fan_urmarire_auto_doua_sesiuni.sh (două sesiuni reale pe un cluster dispensabil; netestat local).
DO $pre$
DECLARE v_plafon text; r record; v_tip text; v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270102a_redari_fan_urmarire_auto:' || txid_current() THEN
    RAISE EXCEPTION '20270102a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270102a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270102a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270102a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20270102a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270102a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- baza: 20261228a aplicată (tabelele F1, exact 52 de funcții fn_red_fan_*); reaplicare = refuz
  IF to_regclass('public.red_fan_awb') IS NULL OR to_regclass('public.red_fan_loturi') IS NULL OR to_regclass('public.red_fan_intentii') IS NULL
     OR to_regclass('public.red_fan_operatori') IS NULL THEN
    RAISE EXCEPTION '20270102a: 20261228a nu e aplicata (tabelele FAN F1 lipsesc): ordinea e 20261212a -> 20261227a -> 20261228a -> 20270102a';
  END IF;
  IF to_regclass('public.red_fan_rulari') IS NOT NULL OR to_regclass('public.red_fan_contradictii') IS NOT NULL
     OR to_regprocedure('public.fn_red_fan_urmarire_scrie(uuid, jsonb, uuid, uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_red_fan_moment_posibil(timestamp, date, timestamp)') IS NOT NULL
     OR to_regprocedure('public.fn_red_fan_srv_rulare_incepe(text, uuid)') IS NOT NULL OR to_regprocedure('public.fn_red_fan_srv_rulare_apel(uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_red_fan_srv_de_urmarit(uuid)') IS NOT NULL OR to_regprocedure('public.fn_red_fan_srv_rulare_incheie(uuid, text, text, integer, integer)') IS NOT NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%') <> 52 THEN
    RAISE EXCEPTION '20270102a: obiectele exista deja sau numarul functiilor fn_red_fan_* nu e 52 (reaplicare / stare neasteptata)';
  END IF;
  -- coloanele citite / scrise, cu tipurile din migrările lor (20261126a, 20261129i, 20261212a, 20261228a)
  FOR r IN SELECT * FROM (VALUES
      ('profiles', 'id', '^uuid$'), ('profiles', 'is_owner', '^boolean$'),
      ('red_proiecte', 'id', '^uuid$'), ('red_proiecte', 'cod', '^text$'),
      ('red_loturi_plicuire', 'id', '^uuid$'), ('red_loturi_plicuire', 'proiect_id', '^uuid$'),
      ('red_fan_awb', 'id', '^uuid$'), ('red_fan_awb', 'lot_id', '^uuid$'), ('red_fan_awb', 'awb', '^text$'), ('red_fan_awb', 'stare', '^text$'),
      ('red_fan_awb', 'versiune_urmarire', '^integer$'), ('red_fan_awb', 'urmarire_stare', '^text$'), ('red_fan_awb', 'livrat_la', '^timestamp with time zone$'),
      ('red_fan_awb', 'retur_cunoscut', '^boolean$'), ('red_fan_awb', 'generat_la', '^timestamp with time zone$'), ('red_fan_awb', 'urmarit_la', '^timestamp with time zone$'),
      ('red_fan_awb', 'ultim_eveniment', '^text$'), ('red_fan_awb', 'ultim_eveniment_la', '^timestamp with time zone$'), ('red_fan_awb', 'ridicat_propus', '^date$'),
      ('red_fan_awb', 'retur_propus', '^text$'), ('red_fan_awb', 'ridicat_la', '^timestamp with time zone$'), ('red_fan_awb', 'ridicat_contrazis', '^date$'),
      ('red_fan_awb', 'livrat_contrazis', '^timestamp with time zone$'), ('red_fan_awb', 'retur_contrazis', '^text$'), ('red_fan_awb', 'updated_at', '^timestamp with time zone$'),
      ('red_fan_loturi', 'lot_id', '^uuid$'), ('red_fan_loturi', 'test', '^boolean$'),
      ('red_jurnal', 'tabela', '^text$'), ('red_jurnal', 'inregistrare_id', '^uuid$'), ('red_jurnal', 'actiune', '^text$'),
      ('red_jurnal', 'date_vechi', '^jsonb$'), ('red_jurnal', 'date_noi', '^jsonb$'), ('red_jurnal', 'user_id', '^uuid$')
    ) v(t, c, tip) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION '20270102a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  -- trigger-ele de pe red_fan_awb: EXACT cele două ale 20261228a (garda F1 + jurnalul oPOD 20261227a); scrierea urmăririi trece prin ele ca azi
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_garda' AND tg.tgenabled = 'O'
                      AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = to_regprocedure('public.fn_red_fan_awb_garda()') AND tg.tgtype = (1 | 2 | 16))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_awb'::regclass AND tg.tgname = 'trg_red_fan_awb_opod_jurnal' AND tg.tgenabled = 'O'
                      AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = to_regprocedure('public.fn_red_fan_awb_opod_jurnal()') AND tg.tgtype = (1 | 4 | 8 | 16)
                      AND tg.tgattr::text = '') THEN
    RAISE EXCEPTION '20270102a: red_fan_awb nu are exact trigger-ele din 20261228a (garda F1 + jurnalul oPOD)';
  END IF;
  -- runda 2 (L14, preflight pe datele live SUB lock): lock-ul pe care l-ar lua oricum cheia străină nouă, luat ÎNAINTEA verificării, ca nicio
  -- scriere prin corpul vechi să nu se strecoare între verificare și COMMIT; apoi: nicio contradicție veche nesoluționată (coloanele *_contrazis
  -- sau livrat + retur deodată). Corpul nou nu le mai scrie și nu le poate rezolva: se soluționează ÎNAINTE (fn_red_fan_urmarire_solutioneaza).
  LOCK TABLE public.red_fan_awb IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO v_n FROM public.red_fan_awb
   WHERE ridicat_contrazis IS NOT NULL OR livrat_contrazis IS NOT NULL OR retur_contrazis IS NOT NULL OR (livrat_la IS NOT NULL AND retur_cunoscut);
  IF v_n > 0 THEN
    RAISE EXCEPTION '20270102a: % rand(uri) red_fan_awb au contradictii vechi nesolutionate (*_contrazis / livrat + retur): se solutioneaza intai (fn_red_fan_urmarire_solutioneaza); nimic schimbat', v_n;
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid
     OR NOT pg_has_role('postgres', 'authenticated', 'USAGE') OR NOT pg_has_role('postgres', 'anon', 'USAGE') OR NOT pg_has_role('postgres', 'service_role', 'USAGE') THEN
    RAISE EXCEPTION '20270102a: dependentele (auth.uid, rolurile aplicatiei) lipsesc sau difera';
  END IF;
END $pre$;

-- ── lanțul verificat pe amprentă ÎNAINTE: poarta de drept fn_red_nivel (20261126a) + cele 52 de funcții fn_red_fan_* EXACT ca după 20261228a
-- (lista AMPRENTE-NOI 20261228a, copiată: corp fără CR, limbaj, DEFINER, volatilitate, tipul întors, proprietar, EXECUTE pe clasă). Garanția
-- completă (orice altă funcție / politică / drept) = amprenta globală L15 v2 a runnerului. DUPĂ: lista AMPRENTE-NOI 20270102a din postcondiții.
CREATE FUNCTION pg_temp.lant_20270102a() RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $lant$
DECLARE v_rau text; v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_nivel()') AND md5(replace(p.prosrc, chr(13), '')) = '21db8e5d4b69b7f19e571a7087c361ae'
                   AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20270102a: lantul (inainte) difera: poarta de drept public.fn_red_nivel()';
  END IF;
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
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
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20270102a: lantul (inainte) difera de amprentele revizuite din 20261228a: %', v_rau;
  END IF;
END $lant$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.lant_20270102a(); END $l15_inainte$;

-- ═══ 1. Jurnalul rulărilor (RLS citire admin / editor Redări; scrieri DOAR prin RPC-urile clasei B: niciun GRANT de scriere pentru nimeni) ═══
CREATE TABLE public.red_fan_rulari (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zi_ro date NOT NULL,                                   -- ziua în ora României a pornirii
  slot text NOT NULL CHECK (slot IN ('dimineata', 'seara', 'manual')),
  sursa text NOT NULL CHECK (sursa IN ('cron', 'owner')),
  pornita_de uuid,                                       -- owner-ul (rulare manuală); NULL la cron
  pornita_la timestamptz NOT NULL DEFAULT clock_timestamp(),
  incheiata_la timestamptz,
  stare text NOT NULL DEFAULT 'in_curs' CHECK (stare IN ('in_curs', 'incheiata', 'oprita_plafon', 'oprita_eroare', 'expirata')),
  plafon_apeluri integer NOT NULL CHECK (plafon_apeluri BETWEEN 1 AND 20),
  apeluri integer NOT NULL DEFAULT 0,                    -- solicitări GET către curier rezervate (pasul de dinaintea fiecărui apel)
  randuri integer NOT NULL DEFAULT 0 CHECK (randuri >= 0),
  scrise integer NOT NULL DEFAULT 0 CHECK (scrise >= 0),
  pastrate integer NOT NULL DEFAULT 0 CHECK (pastrate >= 0),
  depasite integer NOT NULL DEFAULT 0 CHECK (depasite >= 0),
  contradictii integer NOT NULL DEFAULT 0 CHECK (contradictii >= 0),   -- runda 2: semnale de contradicție înscrise / revăzute (red_fan_contradictii)
  ridicari integer NOT NULL DEFAULT 0 CHECK (ridicari >= 0),           -- runda 2: ridicări înregistrate automat (lot de TEST: generat → ridicat)
  loturi integer CHECK (loturi IS NULL OR loturi >= 0),                    -- raportate la închidere
  loturi_sarite integer CHECK (loturi_sarite IS NULL OR loturi_sarite >= 0),
  eroare_cod text CHECK (eroare_cod IS NULL OR eroare_cod ~ '^[a-z0-9_]{1,60}$'),
  CONSTRAINT red_fan_rulari_apeluri_plafon CHECK (apeluri >= 0 AND apeluri <= plafon_apeluri),
  CONSTRAINT red_fan_rulari_suma CHECK (scrise + pastrate + depasite = randuri),
  CONSTRAINT red_fan_rulari_pornire CHECK ((sursa = 'cron' AND pornita_de IS NULL AND slot <> 'manual') OR (sursa = 'owner' AND pornita_de IS NOT NULL AND slot = 'manual')),
  CONSTRAINT red_fan_rulari_inchiderea CHECK ((stare = 'in_curs') = (incheiata_la IS NULL)),
  CONSTRAINT red_fan_rulari_motiv CHECK ((stare IN ('oprita_plafon', 'oprita_eroare', 'expirata')) = (eroare_cod IS NOT NULL))
);
COMMENT ON TABLE public.red_fan_rulari IS 'Redări FAN: rulările automate ale urmăririi AWB-urilor (cron dimineața / seara, ora României, sau owner-ul). Una singură în curs odată; o rulare de cron pe slot; plafonul de solicitări pe rulare. Scris doar prin fn_red_fan_srv_rulare_* și fn_red_fan_srv_urmarire (clasa B, service_role). 20270102a.';
-- o singură rulare în curs (orice sursă) și o singură rulare de cron pe (zi, slot): suprapunerea = „ocupat”, nimic cerut curierului
CREATE UNIQUE INDEX red_fan_rulari_in_curs_uq ON public.red_fan_rulari (stare) WHERE stare = 'in_curs';
CREATE UNIQUE INDEX red_fan_rulari_slot_uq ON public.red_fan_rulari (zi_ro, slot) WHERE slot <> 'manual';
ALTER TABLE public.red_fan_rulari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_fan_rulari FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.red_fan_rulari TO authenticated;
CREATE POLICY red_fan_rulari_citire ON public.red_fan_rulari FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));

-- ═══ 1b. Contradicțiile FAN (runda 2, decizia owner-ului 21.11.2026): semnal DURABIL de audit, nu blocaj. Un rând = o contradicție văzută pe un
-- AWB: valorile contradictorii, valoarea aleasă, regula aplicată (versiunea ei), cine a văzut-o (rularea automată sau omul de la buton), de câte
-- ori și când. Nimic nu le șterge (nicio cale de scriere în afara corpului comun; niciun GRANT de scriere); o rulare ulterioară cu un singur
-- eveniment NU șterge urma și nu mai cere omul. Fără date personale (AWB, coduri, date / ore ale curierului). Citire: admin / editor Redări. ═══
CREATE TABLE public.red_fan_contradictii (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_awb_id uuid NOT NULL REFERENCES public.red_fan_awb(id),
  lot_id uuid NOT NULL,
  awb text NOT NULL CHECK (awb ~ '^[0-9]{6,20}$'),
  sursa text NOT NULL CHECK (sursa IN ('acelasi_raspuns', 'intre_raspunsuri')),   -- în același răspuns FAN / între răspunsul nou și faptul înregistrat
  tip text NOT NULL,
  -- runda 3 (#1155 r2 P2): aceeași limită ca în cod (LIMITA_VALORI_CONTRADICTIE = 50) și ca validarea din fn_red_fan_urmarire_scrie (test de paritate)
  valori jsonb NOT NULL CHECK (jsonb_typeof(valori) = 'array' AND jsonb_array_length(valori) BETWEEN 1 AND 50),
  ales text NOT NULL CHECK (ales ~ '^[A-Za-z0-9_: -]{1,40}$'),
  regula text NOT NULL,
  versiune_regula text NOT NULL CHECK (versiune_regula = 'fan-contradictii-v1'),
  rulare_id uuid,                                        -- rularea automată care a văzut-o prima dată (NULL = butonul)
  actor uuid,                                            -- omul de la buton (NULL = rularea automată)
  cheie text NOT NULL CHECK (cheie ~ '^[0-9a-f]{32}$'), -- md5(sursa|tip|valori|ales|regula): aceeași contradicție revăzută = același rând
  observari integer NOT NULL DEFAULT 1 CHECK (observari >= 1),
  prima_la timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultima_la timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultima_rulare_id uuid,
  CONSTRAINT red_fan_contradictii_regula CHECK ((tip, regula) IN (('ridicare_zile', 'prima_ridicare'), ('livrare_ore', 'ultima_livrare'),
    ('livrare_retur', 'final_ulterior'), ('retur_motiv', 'ultimul_semnal'), ('eveniment_data_imposibila', 'data_imposibila'))),
  CONSTRAINT red_fan_contradictii_cheie_uq UNIQUE (fan_awb_id, cheie)
);
CREATE INDEX red_fan_contradictii_lot_ix ON public.red_fan_contradictii (lot_id, prima_la DESC);
COMMENT ON TABLE public.red_fan_contradictii IS 'Redări FAN: contradicțiile din răspunsurile curierului, rezolvate automat după regula fan-contradictii-v1 și păstrate ca semnal de audit (nu blochează rândul). Scris doar prin fn_red_fan_urmarire_scrie. 20270102a.';
ALTER TABLE public.red_fan_contradictii ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_fan_contradictii FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.red_fan_contradictii TO authenticated;
CREATE POLICY red_fan_contradictii_citire ON public.red_fan_contradictii FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));

-- ═══ 1b'. RUNDA 5 (#1155, Jakarinos r4 P1, L03 / L17 / L18 / L19): predicatul UNIC al momentului POSIBIL al oricărui eveniment al curierului ═══
-- Un moment (ora României, `timestamp` fără fus) e posibil dacă ziua lui e ≥ ziua generării AWB-ului ȘI momentul e ≤ acum + 300 de secunde (toleranța
-- mică pentru ceasurile diferite ale curierului și ale noastre; aceeași valoare în redariFan.mjs::TOLERANTA_VIITOR_S, test de paritate). Adunarea e
-- naivă pe ora locală, ca în cod (adunaSecundeLocal). NULL oriunde = imposibil (IS TRUE, L18). Folosit de corpul comun (fiecare eveniment al
-- răspunsului, cele respinse de cod, faptele răspunsului și faptele cunoscute) și de selecția rulării automate (o livrare imposibilă nu e un fapt
-- final). Pur: fără tabele, fără drepturi de execuție pentru nimeni (îl cheamă doar funcțiile DEFINER ale proprietarului).
CREATE FUNCTION public.fn_red_fan_moment_posibil(p_la timestamp, p_generat_zi date, p_acum timestamp) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT (p_la::date >= p_generat_zi AND p_la <= p_acum + interval '300 seconds') IS TRUE
$fn$;
REVOKE ALL ON FUNCTION public.fn_red_fan_moment_posibil(timestamp, date, timestamp) FROM PUBLIC, anon, authenticated, service_role;

-- ═══ 1c. Corpul COMUN al urmăririi (runda 2): buton (owner fn_red_fan_urmarire / operator fn_red_fan_srv_urmarire cu p_actor) și rularea automată
-- (fn_red_fan_srv_urmarire cu p_rulare) scriu prin ACEEAȘI funcție (L19). Intern: EXECUTE nimănui; autorul vine DOAR de la apelanții de mai sus
-- (auth.uid() verificat ca owner / p_actor verificat de poartă / p_rulare verificată în curs), niciodată din p_randuri.
-- Pașii: (1) validarea completă a rândurilor (inclusiv retur_la și lista de contradicții din același răspuns, pe listă albă) → (2) rândurile FAN
-- FOR UPDATE ORDER BY id → (3) rând străin = P0001, lot în afara gărzii = RD032 → (4) „păstrate” (răspuns fără cronologie, ca înainte) → (5) FAPTELE
-- după regula fan-contradictii-v1 (TOATE contradicțiile între răspunsul nou și faptele înregistrate se evaluează înainte, apoi faptul rezolvat se
-- scrie; CAS pe versiune + cronologia ne-mai-veche, ca înainte) și, pe un lot de TEST, ridicarea generat → ridicat → (6) contradicțiile (din răspuns
-- + dintre răspunsuri) în red_fan_contradictii pentru rândurile scrise, iar evenimentele la un moment imposibil pe TOATE rândurile (scrise, păstrate,
-- depășite; runda 6) → (7) jurnalul ridicărilor automate.
CREATE FUNCTION public.fn_red_fan_urmarire_scrie(p_lot_id uuid, p_randuri jsonb, p_rulare uuid, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer; v_scrise integer; v_pastrate integer; v_test boolean; v_azi date; v_w jsonb;
  v_contr integer := 0; v_rid integer := 0; v_acum timestamp;
BEGIN
  IF p_lot_id IS NULL OR p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 100
     OR (p_rulare IS NOT NULL AND p_actor IS NOT NULL) THEN
    RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE u.id IS NOT NULL AND u.awb ~ '^[0-9]{6,20}$' AND u.versiune IS NOT NULL AND u.versiune >= 0
           AND u.urmarire_stare IN ('fara_evenimente', 'in_tranzit', 'ridicat', 'livrat', 'retur', 'de_verificat')
           AND (u.ultim_eveniment IS NULL OR u.ultim_eveniment ~ '^[A-Z]{1,2}[0-9]{1,3}$')
           AND (u.ultim_eveniment_la IS NULL OR u.ultim_eveniment_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.livrat_la IS NULL OR u.livrat_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.ridicat_propus IS NULL OR u.ridicat_propus ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
           AND (u.retur_propus IS NULL OR u.retur_propus IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta'))
           -- runda 2: faptele rezolvate în răspuns sunt coerente (o livrare și un retur nu vin deodată; ora returului doar la retur)
           AND (u.livrat_la IS NULL OR u.urmarire_stare <> 'retur') AND (u.retur_propus IS NULL OR u.urmarire_stare = 'retur')
           AND (u.retur_la IS NULL OR (u.urmarire_stare = 'retur' AND u.retur_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'))
           AND c.ok AND cr.ok AND rs.ok), count(DISTINCT u.id)
    INTO v_n, v_bune, v_dist
    FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text, versiune integer, urmarire_stare text, ultim_eveniment text,
      ultim_eveniment_la text, ridicat_propus text, livrat_la text, retur_propus text, retur_la text, contradictii jsonb, evenimente jsonb, respinse jsonb)
    -- RUNDA 5 (#1155 r4 P1): `respinse` = evenimentele respinse de cod ca imposibile (redariFan.mjs::momentPosibilFan), aceeași formă ca lista de mai
    -- jos: lipsă (NULL, funcția edge de dinainte) sau 0..100 texte „COD AAAA-LL-ZZ HH:MM:SS”, orele nedescrescătoare, fără dubluri alăturate.
    -- Clasificarea codului NU se crede: pasul (5) o reface cu fn_red_fan_moment_posibil, cu ceasul bazei.
    CROSS JOIN LATERAL (SELECT CASE WHEN u.respinse IS NULL THEN true WHEN jsonb_typeof(u.respinse) IS DISTINCT FROM 'array' THEN false
        WHEN jsonb_array_length(u.respinse) > 100 THEN false
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(u.respinse) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string'
                      OR (x #>> '{}') !~ '^[A-Z]{1,2}[0-9]{1,3} [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$') THEN false
        ELSE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(u.respinse) WITH ORDINALITY a(x, i)
                           JOIN jsonb_array_elements_text(u.respinse) WITH ORDINALITY b(x, i) ON b.i = a.i + 1
                          WHERE right(b.x, 19) COLLATE "C" < right(a.x, 19) COLLATE "C" OR b.x = a.x) END) AS rs(ok)
    -- RUNDA 4 (#1155 r3 P2): lista evenimentelor citite (redariFan.mjs::rezumatUrmarireFan, `evenimente`), din care se ia cronologia la pasul (5).
    -- Lipsă (NULL) = derivată din ultim_eveniment + ultim_eveniment_la (compatibilitate cu funcția edge de dinainte); altfel EXACT: listă de
    -- 0..100 texte (LIMITA_EVENIMENTE_CRONOLOGIE din cod; testul de paritate compară) „COD AAAA-LL-ZZ HH:MM:SS”, orele nedescrescătoare, fără
    -- dubluri alăturate (ordinea din cod le pune alături), goală exact când răspunsul n-are cronologie, ultimul = ultimul eveniment al răspunsului.
    CROSS JOIN LATERAL (SELECT CASE WHEN u.evenimente IS NULL THEN true WHEN jsonb_typeof(u.evenimente) IS DISTINCT FROM 'array' THEN false
        WHEN jsonb_array_length(u.evenimente) > 100 THEN false
        WHEN (jsonb_array_length(u.evenimente) = 0) IS DISTINCT FROM (u.ultim_eveniment_la IS NULL) THEN false
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(u.evenimente) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string'
                      OR (x #>> '{}') !~ '^[A-Z]{1,2}[0-9]{1,3} [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$') THEN false
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(u.evenimente) WITH ORDINALITY a(x, i)
                       JOIN jsonb_array_elements_text(u.evenimente) WITH ORDINALITY b(x, i) ON b.i = a.i + 1
                      WHERE right(b.x, 19) COLLATE "C" < right(a.x, 19) COLLATE "C" OR b.x = a.x) THEN false
        WHEN jsonb_array_length(u.evenimente) = 0 THEN true
        ELSE (u.evenimente ->> -1) = u.ultim_eveniment || ' ' || u.ultim_eveniment_la END) AS cr(ok)
    -- lista de contradicții din același răspuns (redariFan.mjs::rezumatUrmarireFan): lipsă / [] / ≤ 4 elemente cu tipuri DIFERITE, fiecare EXACT
    -- {tip, valori, ales, regula}, perechea (tip, regula) pe lista albă. Runda 3 (#1155 r2 P2 / P1, L13 / L19): valorile = 2..50 texte
    -- (LIMITA_VALORI_CONTRADICTIE din cod; testul de paritate compară), cu forma FIXĂ a tipului (zi C0 / oră S2 / motiv de retur / [S2 + oră, cod +
    -- oră sau returnAwbNumber]), în ordine strict crescătoare ca în cod; alesul = regula aplicată pe valori (prima zi / ultima oră / motivul) și
    -- legat de faptele rândului (ridicat_propus / livrat_la / retur_propus / starea). Conținut extern tratat ca date: orice element care nu se
    -- potrivește EXACT (inclusiv NULL, prin IS NOT TRUE, L18) = 22023, nimic scris. CASE-ul ordonează verificările (forma înaintea conținutului).
    CROSS JOIN LATERAL (SELECT CASE WHEN u.contradictii IS NULL THEN true WHEN jsonb_typeof(u.contradictii) IS DISTINCT FROM 'array' THEN false
        WHEN jsonb_array_length(u.contradictii) > 4 THEN false ELSE (
        NOT EXISTS (SELECT 1 FROM jsonb_array_elements(u.contradictii) e WHERE (CASE
          WHEN jsonb_typeof(e) IS DISTINCT FROM 'object' THEN false
          WHEN (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(e) k) IS DISTINCT FROM ARRAY['ales', 'regula', 'tip', 'valori'] THEN false
          WHEN jsonb_typeof(e -> 'valori') IS DISTINCT FROM 'array' OR jsonb_typeof(e -> 'ales') IS DISTINCT FROM 'string' THEN false
          WHEN ((e ->> 'tip', e ->> 'regula') IN (('ridicare_zile', 'prima_ridicare'), ('livrare_ore', 'ultima_livrare'), ('livrare_retur', 'final_ulterior'),
                                                 ('retur_motiv', 'ultimul_semnal'))) IS NOT TRUE THEN false
          WHEN jsonb_array_length(e -> 'valori') NOT BETWEEN 2 AND 50 THEN false
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(e -> 'valori') WITH ORDINALITY v(x, i) WHERE jsonb_typeof(v.x) IS DISTINCT FROM 'string'
                OR (v.x #>> '{}') !~ CASE e ->> 'tip'
                     WHEN 'ridicare_zile' THEN '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                     WHEN 'livrare_ore' THEN '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
                     WHEN 'retur_motiv' THEN '^(destinatar_necunoscut|mutat|avizat_neridicat|refuz|adresa_incompleta)$'
                     WHEN 'livrare_retur' THEN CASE WHEN v.i = 1 THEN '^S2 [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
                                                    ELSE '^([A-Z]{1,2}[0-9]{1,3} [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}|returnAwbNumber)$' END END) THEN false
          -- livrare_retur = [livrarea, returul]; celelalte: strict crescătoare (deci și distincte), ca în cod
          WHEN e ->> 'tip' = 'livrare_retur' THEN jsonb_array_length(e -> 'valori') = 2 AND (e ->> 'ales') IN ('livrat', 'retur')
                                                  AND ((e ->> 'ales') = 'retur') = (u.urmarire_stare = 'retur')
          WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(e -> 'valori') WITH ORDINALITY a(x, i)
                         JOIN jsonb_array_elements_text(e -> 'valori') WITH ORDINALITY b(x, i) ON b.i = a.i + 1 WHERE b.x COLLATE "C" <= a.x COLLATE "C") THEN false
          WHEN e ->> 'tip' = 'ridicare_zile' THEN (e ->> 'ales') = (e -> 'valori' ->> 0) AND (e ->> 'ales') IS NOT DISTINCT FROM u.ridicat_propus
          WHEN e ->> 'tip' = 'livrare_ore' THEN (e ->> 'ales') = (e -> 'valori' ->> -1) AND (u.livrat_la IS NULL OR u.livrat_la = (e ->> 'ales'))
          ELSE u.urmarire_stare = 'retur' AND (e -> 'valori') @> jsonb_build_array(e -> 'ales') AND (e ->> 'ales') IS NOT DISTINCT FROM u.retur_propus
        END) IS NOT TRUE)
        AND (SELECT count(DISTINCT e ->> 'tip') FROM jsonb_array_elements(u.contradictii) e) = jsonb_array_length(u.contradictii)) END) AS c(ok);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id IN (SELECT u.id FROM jsonb_to_recordset(p_randuri) AS u(id uuid)) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text)
             LEFT JOIN public.red_fan_awb a ON a.id = u.id AND a.lot_id = p_lot_id AND a.awb = u.awb AND a.stare IN ('generat', 'ridicat')
             WHERE a.id IS NULL) THEN RAISE EXCEPTION 'redari fan: rand strain sau AWB diferit' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.fn_red_fan_lot_permis(p_lot_id) THEN RAISE EXCEPTION 'redari fan: doar proiecte de TEST' USING ERRCODE = 'RD032'; END IF;
  -- marcajul TEST al lotului: imuabil după prima aprobare (trigger-ul fn_red_fan_loturi_garda), iar un lot cu AWB-uri a fost aprobat → fără lock
  SELECT test INTO v_test FROM public.red_fan_loturi WHERE lot_id = p_lot_id;
  -- runda 4: UN singur reper de timp pentru toată scrierea (momentul acum și ziua de azi, ora României, L17)
  v_acum := clock_timestamp() AT TIME ZONE 'Europe/Bucharest';
  v_azi := v_acum::date;
  -- (4) răspuns FĂRĂ cronologie (posibilă) pe un rând cu eveniment cunoscut: doar „verificat la” (ca în 20261212a runda 3). Runda 5: e ramura
  -- `pastrat` a pasului (5) (aceeași scriere: urmarit_la + versiunea), ca auditul evenimentelor respinse să se scrie și pe ea.
  -- (5) faptele. n = răspunsul nou (deja rezolvat în el însuși de rezumatUrmarireFan), k = faptele înregistrate (rândul blocat mai sus).
  -- Finalul (livrat / retur): un răspuns fără final păstrează finalul cunoscut; același final: livrarea = ULTIMA oră, returul = motivul
  -- răspunsului nou (lipsa lui păstrează motivul cunoscut); finaluri diferite = finalul ULTERIOR după ora curierului: retur nou peste livrare
  -- cunoscută dacă returul n-are oră sau e la / după livrare; livrare nouă peste retur cunoscut doar dacă livrarea e DUPĂ ultimul eveniment
  -- cunoscut la înregistrarea returului (altfel retur: egalitatea / necunoscutul merg la retur). Ridicarea: ziua înregistrată rămâne.
  -- RUNDA 3 (#1155 r2 P2): o zi C0 IMPOSIBILĂ (înainte de ziua generării AWB-ului sau în viitor, ora României) nu devine NICIODATĂ fapt: nu se
  -- salvează în ridicat_propus și nu prevalează asupra răspunsurilor următoare; rămâne doar în audit. Runda 5: e un caz al clasei de mai jos (codul
  -- n-o mai pune printre zilele C0, BD-ul o refuză ca dezacord). Ziua cunoscută prevalează DOAR dacă e posibilă (o zi veche imposibilă, scrisă de
  -- corpul de dinainte de 20270102a, iese din fapte și intră în audit).
  -- RUNDA 4 (#1155 r3 P2, L03 / L17 / L18 / L19): CRONOLOGIA = DOAR evenimentele la un moment POSIBIL (ziua ≥ ziua generării AWB-ului, momentul
  -- ≤ acum + toleranța; runda 5: predicatul fn_red_fan_moment_posibil, chemat o dată), pentru ambele părți ale gărzii:
  --   n_ev / n_la = ULTIMUL eveniment posibil din lista răspunsului (ordinea din cod; la aceeași oră, departajarea codului) → ce se salvează în
  --                 ultim_eveniment / ultim_eveniment_la. Un eveniment respins ca fapt pentru că data lui e imposibilă (C0 în viitor / înainte de
  --                 generare, sau orice alt cod la o asemenea dată) NU intră în cronologie, deci nu blochează corecția validă de la rularea următoare
  --                 (exemplul recenzentului: C0 24.11 respins pe 21.11, apoi C0 20.11 → se înregistrează). Ziua imposibilă rămâne în audit (ca în r3).
  --   k_la        = ultimul eveniment cunoscut, DOAR dacă e posibil: o oră viitoare scrisă de corpul de dinainte de 20270102a nu mai blochează nimic
  --                 (e înlocuită de cronologia posibilă a răspunsului; un moment scris de acest corp a fost posibil la scriere, deci rămâne posibil).
  -- Garda „ne-mai-veche” (protecția împotriva unui răspuns mai vechi, pe lângă CAS-ul pe versiune) compară n_la cu k_la. Un răspuns CU evenimente,
  -- dar fără niciunul posibil, pe un rând cu cronologie cunoscută (neord) nu se poate ordona față de ea: faptele lui NU se iau (rândul rămâne
  -- neschimbat, doar „verificat la”, numărat „păstrat”, ca răspunsul fără cronologie de la pasul 4), iar zilele lui C0 imposibile intră în audit.
  -- RUNDA 5 (#1155 r4 P1, L03 / L11 / L17 / L18 / L19): CLASA, nu cazul. O SINGURĂ regulă pentru ORICE eveniment (ridicare, livrare, retur, refuz,
  -- tranzit…): fn_red_fan_moment_posibil(momentul, ziua generării, v_acum), chemată O DATĂ, pe fiecare moment al rândului (lateral-ul p):
  --   'n' = lista posibilă a codului (ce afirmă că e posibil), 'r' = ce a respins codul, 'f' = fiecare moment pe care îl afirmă faptele răspunsului
  --   (ziua ridicării la 00:00, livrarea, returul, valorile contradicțiilor), 'k' / 'kl' / 'kr' = cronologia / livrarea / ziua ridicării CUNOSCUTE.
  -- Codul a aplicat deja aceeași regulă ÎNAINTEA faptelor (redariFan.mjs::rezumatUrmarireFan), cu ceasul lui. BD-ul NU crede clasificarea:
  --   dezacord = un moment 'n' / 'f' imposibil aici SAU un moment 'r' posibil aici (ceasuri diferite la granița toleranței, cod vechi, payload
  --              fabricat) → rândul e `pastrat` (neschimbat, doar „verificat la”), niciun fapt dintr-o clasificare contestată; auditul se scrie.
  --   un fapt CUNOSCUT imposibil (livrarea / ziua ridicării scrise de corpul de dinainte) iese din fapte (k_liv / k_rid_ok = NULL) și intră în
  --              audit; o livrare imposibilă nu mai e „fapt final”, deci AWB-ul rămâne de urmărit (fn_red_fan_srv_de_urmarit, același predicat).
  -- Auditul: câte un rând eveniment_data_imposibila (ales „respins”) pe fiecare eveniment imposibil al răspunsului (respins de cod sau găsit aici) și
  -- pe fiecare fapt cunoscut ieșit din fapte (doar când rândul se scrie: un rând păstrat nu-și schimbă faptele).
  -- RUNDA 6 (#1155 r5 P1 / P2, L03 / L12 / L19 / L20): (P1) RETURUL cunoscut (retur_cunoscut) nu are oră proprie pe rând: faptul lui stă pe
  --   cronologia cu care a fost înregistrat (ultim_eveniment_la = „ultimul eveniment cunoscut la înregistrarea returului”, regula fan-contradictii-v1).
  --   E fapt final DOAR dacă acea cronologie lipsește (returul legitim fără oră: returnAwbNumber, fără evenimente) sau e POSIBILĂ (k_ret). Un retur
  --   scris de corpul de dinainte pe o cronologie imposibilă iese din fapte (k_ret / k_mot NULL): nu mai câștigă la departajare, AWB-ul rămâne de
  --   urmărit (fn_red_fan_srv_de_urmarit, aceeași compunere), o corecție validă îl înlocuiește, iar cronologia imposibilă intră în audit ('k' în
  --   imp_cunoscute, ca 'kr' / 'kl'). „Neordonabil” = față de o cronologie cunoscută POSIBILĂ (k_la), nu față de una imposibilă: o cronologie veche
  --   imposibilă nu mai ține rândul „păstrat” la nesfârșit (rândul se scrie, faptele imposibile ies și se auditează).
  --   (P2) auditul evenimentelor imposibile ale răspunsului se scrie pe TOATE ramurile — scris, păstrat ȘI depășit (CAS pe versiune sau cronologie
  --   mai veche): lista contradicțiilor se construiește din m (toate rândurile), nu din RETURNING-ul UPDATE-ului; pe un rând depășit / păstrat
  --   intră DOAR evenimentele imposibile ale răspunsului (faptele lui nu s-au luat), protecția CAS a faptelor rămâne neatinsă.
  WITH n AS (
    SELECT u.id, u.versiune, u.urmarire_stare AS n_stare, p.n_ev, p.n_la, b.awb AS k_awb, b.lot_id AS k_lot,
           -- ziua ridicării din răspuns: o zi posibilă prin construcție (codul o ia doar din C0 posibile; un moment 'f' imposibil = dezacord)
           u.ridicat_propus::date AS n_rid_ok,
           (u.livrat_la::timestamp AT TIME ZONE 'Europe/Bucharest') AS n_liv, u.urmarire_stare = 'retur' AS n_ret, u.retur_propus AS n_mot,
           (u.retur_la::timestamp AT TIME ZONE 'Europe/Bucharest') AS n_ret_la, coalesce(u.contradictii, '[]'::jsonb) AS n_contr,
           b.stare AS k_stare,
           -- faptele cunoscute DOAR dacă sunt posibile (o valoare imposibilă scrisă de corpul de dinainte iese din fapte și intră în audit)
           CASE WHEN p.k_rid_posibil THEN b.ridicat_propus END AS k_rid_ok, CASE WHEN p.k_liv_posibil THEN b.livrat_la END AS k_liv,
           -- runda 6: returul cunoscut = fapt doar pe o cronologie lipsă sau posibilă (p.k_ret); motivul lui la fel
           p.k_ret, CASE WHEN p.k_ret THEN b.retur_propus END AS k_mot, p.k_la, p.imp_raspuns, p.imp_cunoscute,
           -- păstrat = răspunsul n-are niciun moment posibil față de o cronologie cunoscută POSIBILĂ (neordonabil, pasul 4; runda 6: k_la, nu
           -- ultim_eveniment_la brut) SAU clasificarea codului e contestată
           (p.k_la IS NOT NULL AND p.n_la IS NULL) OR p.dezacord AS pastrat
      FROM jsonb_to_recordset(p_randuri) AS u(id uuid, versiune integer, urmarire_stare text, ultim_eveniment text, ultim_eveniment_la text,
             ridicat_propus text, livrat_la text, retur_propus text, retur_la text, contradictii jsonb, evenimente jsonb, respinse jsonb)
      JOIN public.red_fan_awb b ON b.id = u.id
      -- momentele rândului (s = sursa, vezi mai sus); `la` = ora României pentru predicat, `tz` = momentul exact al cronologiei (fără dus-întors prin
      -- ora locală, ambiguă la schimbarea orei), `txt` = textul din audit. Predicatul: O singură chemare (y.ok).
      CROSS JOIN LATERAL (SELECT (array_agg(y.ev ORDER BY y.i DESC) FILTER (WHERE y.s = 'n' AND y.ok))[1] AS n_ev,
                                 (array_agg(y.tz ORDER BY y.i DESC) FILTER (WHERE y.s = 'n' AND y.ok))[1] AS n_la,
                                 max(y.tz) FILTER (WHERE y.s = 'k' AND y.ok) AS k_la,
                                 bool_and(y.ok) FILTER (WHERE y.s = 'kr') AS k_rid_posibil, bool_and(y.ok) FILTER (WHERE y.s = 'kl') AS k_liv_posibil,
                                 -- runda 6: returul cunoscut e fapt dacă cronologia lui lipsește (bool_and = NULL → true) sau e posibilă
                                 (b.retur_cunoscut AND coalesce(bool_and(y.ok) FILTER (WHERE y.s = 'k'), true)) AS k_ret,
                                 coalesce(bool_or(CASE WHEN y.s IN ('n', 'f') THEN NOT y.ok WHEN y.s = 'r' THEN y.ok ELSE false END), false) AS dezacord,
                                 coalesce(jsonb_agg(jsonb_build_array(y.txt, y.reper) ORDER BY y.s, y.i) FILTER (WHERE y.s = 'r' OR (y.s = 'n' AND NOT y.ok)), '[]'::jsonb) AS imp_raspuns,
                                 coalesce(jsonb_agg(jsonb_build_array(y.txt, y.reper) ORDER BY y.s, y.i) FILTER (WHERE y.s IN ('kr', 'kl', 'k') AND NOT y.ok), '[]'::jsonb) AS imp_cunoscute
          FROM (SELECT x.*, public.fn_red_fan_moment_posibil(x.la, g.zi, v_acum) AS ok,
                       CASE WHEN x.la::date < g.zi THEN 'generat ' || to_char(g.zi, 'YYYY-MM-DD') ELSE 'azi ' || to_char(v_azi, 'YYYY-MM-DD') END AS reper
                  FROM (SELECT 'n' AS s, e.i, left(e.x, -20) AS ev, right(e.x, 19)::timestamp AS la, (right(e.x, 19)::timestamp AT TIME ZONE 'Europe/Bucharest') AS tz, e.x AS txt
                          FROM jsonb_array_elements_text(coalesce(u.evenimente, CASE WHEN u.ultim_eveniment_la IS NULL THEN '[]'::jsonb
                                 ELSE jsonb_build_array(u.ultim_eveniment || ' ' || u.ultim_eveniment_la) END)) WITH ORDINALITY e(x, i)
                        UNION ALL SELECT 'r', e.i, left(e.x, -20), right(e.x, 19)::timestamp, NULL, e.x
                          FROM jsonb_array_elements_text(coalesce(u.respinse, '[]'::jsonb)) WITH ORDINALITY e(x, i)
                        UNION ALL SELECT 'f', 0, NULL, v.la, NULL, NULL
                          FROM (VALUES (u.ridicat_propus::date::timestamp), (u.livrat_la::timestamp), (u.retur_la::timestamp)) v(la) WHERE v.la IS NOT NULL
                        UNION ALL SELECT 'f', 0, NULL, CASE WHEN length(v.x) = 10 THEN v.x::date::timestamp ELSE right(v.x, 19)::timestamp END, NULL, NULL
                          FROM jsonb_array_elements(coalesce(u.contradictii, '[]'::jsonb)) c CROSS JOIN LATERAL jsonb_array_elements_text(c -> 'valori') v(x)
                         WHERE c ->> 'tip' IN ('ridicare_zile', 'livrare_ore', 'livrare_retur') AND v.x ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}'
                        -- runda 6: cronologia cunoscută are text de audit (iese din fapte când e imposibilă, ca livrarea / ziua ridicării)
                        UNION ALL SELECT 'k', 0, NULL, b.ultim_eveniment_la AT TIME ZONE 'Europe/Bucharest', b.ultim_eveniment_la,
                                         coalesce(b.ultim_eveniment, '?') || ' ' || to_char(b.ultim_eveniment_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS') WHERE b.ultim_eveniment_la IS NOT NULL
                        UNION ALL SELECT 'kl', 0, NULL, b.livrat_la AT TIME ZONE 'Europe/Bucharest', NULL,
                                         'S2 ' || to_char(b.livrat_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS') WHERE b.livrat_la IS NOT NULL
                        UNION ALL SELECT 'kr', 0, NULL, b.ridicat_propus::timestamp, NULL, 'C0 ' || to_char(b.ridicat_propus, 'YYYY-MM-DD') WHERE b.ridicat_propus IS NOT NULL) x
                 CROSS JOIN (SELECT (b.generat_la AT TIME ZONE 'Europe/Bucharest')::date AS zi) g) y) p
  ), f AS (
    SELECT n.*,
           CASE WHEN n.n_ret THEN 'retur' WHEN n.n_liv IS NOT NULL THEN 'livrat' END AS n_fin,
           CASE WHEN n.k_ret THEN 'retur' WHEN n.k_liv IS NOT NULL THEN 'livrat' END AS k_fin
      FROM n
  ), g AS (
    SELECT f.*, coalesce(f.k_rid_ok, f.n_rid_ok) AS rid,
                CASE WHEN f.n_fin IS NULL THEN f.k_fin
                     WHEN f.k_fin IS NULL OR f.k_fin = f.n_fin THEN f.n_fin
                     WHEN f.k_fin = 'livrat' THEN CASE WHEN f.n_ret_la IS NULL OR f.n_ret_la >= f.k_liv THEN 'retur' ELSE 'livrat' END
                     ELSE CASE WHEN f.k_la IS NOT NULL AND f.n_liv > f.k_la THEN 'livrat' ELSE 'retur' END END AS fin
      FROM f
  ), m AS (
    SELECT g.*,
           CASE WHEN g.fin = 'livrat' THEN CASE WHEN g.n_fin = 'livrat' AND g.k_fin = 'livrat' THEN greatest(g.k_liv, g.n_liv)
                                                WHEN g.n_fin = 'livrat' THEN g.n_liv ELSE g.k_liv END END AS liv,
           CASE WHEN g.fin = 'retur' THEN CASE WHEN g.n_fin = 'retur' THEN coalesce(g.n_mot, g.k_mot) ELSE g.k_mot END END AS mot,
           -- rid e prin construcție o zi posibilă (≥ generare, ≤ azi); un rând păstrat (neordonabil / dezacord) nu înregistrează nimic
           NOT g.pastrat AND (v_test IS TRUE AND g.k_stare = 'generat' AND g.rid IS NOT NULL) AS auto_rid
      FROM g
  ), w AS (
    UPDATE public.red_fan_awb a SET
           -- „ridicat” din răspuns fără nicio zi posibilă → „în tranzit” (starea nu afirmă o ridicare pe care faptele nu o au)
           -- runda 4: un răspuns neordonabil (m.pastrat) lasă rândul NESCHIMBAT (doar „verificat la” + versiunea, ca pasul 4)
           urmarire_stare = CASE WHEN m.pastrat THEN a.urmarire_stare
                                 WHEN m.n_stare = 'de_verificat' THEN 'de_verificat' WHEN m.fin = 'retur' THEN 'retur' WHEN m.fin = 'livrat' THEN 'livrat'
                                 WHEN m.rid IS NOT NULL AND m.n_stare IN ('fara_evenimente', 'in_tranzit') THEN 'ridicat'
                                 WHEN m.rid IS NULL AND m.n_stare = 'ridicat' THEN 'in_tranzit' ELSE m.n_stare END,
           -- cronologia = ultimul eveniment POSIBIL al răspunsului (NULL dacă n-are niciunul: nu se reține nimic imposibil)
           ultim_eveniment = CASE WHEN m.pastrat THEN a.ultim_eveniment ELSE m.n_ev END,
           ultim_eveniment_la = CASE WHEN m.pastrat THEN a.ultim_eveniment_la ELSE m.n_la END,
           ridicat_propus = CASE WHEN m.pastrat THEN a.ridicat_propus ELSE m.rid END, livrat_la = CASE WHEN m.pastrat THEN a.livrat_la ELSE m.liv END,
           retur_propus = CASE WHEN m.pastrat THEN a.retur_propus ELSE m.mot END,
           retur_cunoscut = CASE WHEN m.pastrat THEN a.retur_cunoscut ELSE (m.fin IS NOT DISTINCT FROM 'retur') END,
           stare = CASE WHEN m.auto_rid THEN 'ridicat' ELSE a.stare END,
           ridicat_la = CASE WHEN m.auto_rid THEN (m.rid::timestamp AT TIME ZONE 'Europe/Bucharest') ELSE a.ridicat_la END,
           urmarit_la = now(), updated_at = now(), versiune_urmarire = a.versiune_urmarire + 1
      FROM m
     WHERE a.id = m.id AND a.versiune_urmarire = m.versiune
       -- garda „ne-mai-veche” pe cronologia POSIBILĂ (runda 4): k_la = ultimul eveniment cunoscut posibil (rândul e blocat, deci k_la e chiar
       -- valoarea din a, filtrată); neord = nimic posibil în răspuns față de o cronologie cunoscută → rândul se atinge doar ca „verificat”
       AND (m.k_la IS NULL OR m.pastrat OR m.n_la >= m.k_la)
    RETURNING a.id, a.ultim_eveniment, a.ultim_eveniment_la, a.ridicat_la, m.auto_rid, m.pastrat
  )
  -- runda 4 / 5: rândurile păstrate (răspuns neordonabil sau clasificare contestată) se numără „păstrate” (atinse doar ca „verificat”), nu „scrise”;
  -- runda 6 (P2): TOATE rândurile (m), nu doar cele atinse de UPDATE (w): un rând depășit (CAS pe versiune / cronologie mai veche) nu e în w, dar
  -- evenimentele imposibile ale răspunsului lui tot intră în audit (s.scris = scris cu fapte; altfel doar imp_raspuns)
  SELECT (count(*) FILTER (WHERE s.scris))::integer, (count(*) FILTER (WHERE w.pastrat))::integer,
         coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'awb', m.k_awb, 'lot', m.k_lot, 'ev', w.ultim_eveniment, 'la', w.ultim_eveniment_la,
           'rid', m.rid, 'rid_la', w.ridicat_la, 'auto_rid', coalesce(w.auto_rid, false),
      -- contradicțiile rândului: pe un rând SCRIS cele din același răspuns + cele dintre răspunsuri + faptele cunoscute ieșite din fapte; pe orice
      -- rând (scris, păstrat, depășit) evenimentele imposibile ale răspunsului. Pe un răspuns neordonabil / depășit faptele nu s-au luat, deci nici
      -- alegerile dintre ele.
      'contr', (SELECT coalesce(jsonb_agg(x.c), '[]'::jsonb) FROM (
         SELECT jsonb_build_object('sursa', 'acelasi_raspuns', 'tip', e ->> 'tip', 'valori', e -> 'valori', 'ales', e ->> 'ales', 'regula', e ->> 'regula') AS c
           FROM jsonb_array_elements(m.n_contr) e WHERE s.scris
         UNION ALL SELECT jsonb_build_object('sursa', 'intre_raspunsuri', 'tip', 'ridicare_zile', 'regula', 'prima_ridicare', 'ales', to_char(m.k_rid_ok, 'YYYY-MM-DD'),
                  'valori', jsonb_build_array(to_char(least(m.k_rid_ok, m.n_rid_ok), 'YYYY-MM-DD'), to_char(greatest(m.k_rid_ok, m.n_rid_ok), 'YYYY-MM-DD')))
          WHERE m.k_rid_ok IS NOT NULL AND m.n_rid_ok IS NOT NULL AND m.n_rid_ok <> m.k_rid_ok AND s.scris
         UNION ALL SELECT jsonb_build_object('sursa', 'intre_raspunsuri', 'tip', 'livrare_ore', 'regula', 'ultima_livrare',
                  'ales', to_char(m.liv AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS'),
                  'valori', jsonb_build_array(to_char(least(m.k_liv, m.n_liv) AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS'),
                                              to_char(greatest(m.k_liv, m.n_liv) AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS')))
          WHERE m.k_fin = 'livrat' AND m.n_fin = 'livrat' AND m.n_liv <> m.k_liv AND s.scris
         UNION ALL SELECT jsonb_build_object('sursa', 'intre_raspunsuri', 'tip', 'retur_motiv', 'regula', 'ultimul_semnal', 'ales', m.mot,
                  'valori', jsonb_build_array(m.k_mot, m.n_mot))
          WHERE m.k_fin = 'retur' AND m.n_fin = 'retur' AND m.k_mot IS NOT NULL AND m.n_mot IS NOT NULL AND m.n_mot <> m.k_mot AND s.scris
         UNION ALL SELECT jsonb_build_object('sursa', 'intre_raspunsuri', 'tip', 'livrare_retur', 'regula', 'final_ulterior', 'ales', m.fin,
                  'valori', CASE WHEN m.k_fin = 'livrat'
                                 THEN jsonb_build_array('S2 ' || to_char(m.k_liv AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS'),
                                        coalesce('retur ' || to_char(m.n_ret_la AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS'), 'retur fara_ora'))
                                 ELSE jsonb_build_array('retur_cunoscut', 'S2 ' || to_char(m.n_liv AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD HH24:MI:SS')) END)
          WHERE m.k_fin IS NOT NULL AND m.n_fin IS NOT NULL AND m.k_fin <> m.n_fin AND s.scris
         -- runda 5: câte un rând pe EVENIMENT la un moment imposibil, ORICE cod (ales „respins”, valorile [eveniment, reper]): cele ale răspunsului
         -- (respinse de cod sau găsite aici) mereu (runda 6: și pe rândul depășit); faptele cunoscute ieșite din fapte (ziua ridicării, livrarea,
         -- cronologia pe care stă returul) doar pe un rând scris (un rând păstrat / depășit nu-și schimbă faptele).
         -- Reperul = generarea (moment înainte de ziua generării) sau azi (moment în viitor): revăzut în aceeași zi = același rând (observări + 1)
         UNION ALL SELECT jsonb_build_object('sursa', 'acelasi_raspuns', 'tip', 'eveniment_data_imposibila', 'regula', 'data_imposibila', 'ales', 'respins', 'valori', v.x)
           FROM jsonb_array_elements(m.imp_raspuns) v(x)
         UNION ALL SELECT jsonb_build_object('sursa', 'intre_raspunsuri', 'tip', 'eveniment_data_imposibila', 'regula', 'data_imposibila', 'ales', 'respins', 'valori', v.x)
           FROM jsonb_array_elements(m.imp_cunoscute) v(x) WHERE s.scris) x))), '[]'::jsonb)
    INTO v_scrise, v_pastrate, v_w
    FROM m LEFT JOIN w ON w.id = m.id
    CROSS JOIN LATERAL (SELECT (w.id IS NOT NULL AND NOT w.pastrat) IS TRUE AS scris) s;
  -- (6) contradicțiile, durabil; aceeași contradicție revăzută (aceeași cheie pe același AWB) = observări + 1, nu rând nou
  INSERT INTO public.red_fan_contradictii AS t (fan_awb_id, lot_id, awb, sursa, tip, valori, ales, regula, versiune_regula, rulare_id, actor, cheie, ultima_rulare_id)
  SELECT DISTINCT ON (x.id, md5(c.sursa || '|' || c.tip || '|' || c.valori::text || '|' || c.ales || '|' || c.regula))
         x.id, x.lot, x.awb, c.sursa, c.tip, c.valori, c.ales, c.regula, 'fan-contradictii-v1', p_rulare, p_actor,
         md5(c.sursa || '|' || c.tip || '|' || c.valori::text || '|' || c.ales || '|' || c.regula), p_rulare
    FROM jsonb_to_recordset(v_w) AS x(id uuid, awb text, lot uuid, contr jsonb)
    CROSS JOIN LATERAL jsonb_to_recordset(x.contr) AS c(sursa text, tip text, valori jsonb, ales text, regula text)
  ON CONFLICT (fan_awb_id, cheie) DO UPDATE SET observari = t.observari + 1, ultima_la = clock_timestamp(), ultima_rulare_id = EXCLUDED.ultima_rulare_id;
  GET DIAGNOSTICS v_contr = ROW_COUNT;
  -- (7) jurnalul ridicărilor înregistrate automat (lot de TEST): ziua C0, ultimul eveniment (nu „ora ridicării”), sursa, regula
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id)
  SELECT 'red_fan_awb', x.id, 'update', jsonb_build_object('stare', 'generat'),
         jsonb_build_object('eveniment', 'ridicare_auto', 'cod', 'C0', 'ridicat_propus', x.rid, 'ridicat_la', x.rid_la, 'ultim_eveniment', x.ev,
           'ultim_eveniment_la', x.la, 'lot_id', x.lot, 'rulare_id', p_rulare, 'sursa', CASE WHEN p_rulare IS NULL THEN 'buton' ELSE 'rulare_automata' END,
           'regula', 'fan-contradictii-v1'), p_actor
    FROM jsonb_to_recordset(v_w) AS x(id uuid, lot uuid, ev text, la timestamptz, rid date, rid_la timestamptz, auto_rid boolean)
   WHERE x.auto_rid;
  GET DIAGNOSTICS v_rid = ROW_COUNT;
  RETURN jsonb_build_object('scrise', v_scrise, 'pastrate', v_pastrate, 'depasite', v_n - v_scrise - v_pastrate, 'contradictii', v_contr, 'ridicari', v_rid);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_red_fan_urmarire_scrie(uuid, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- vechiul corp intern devine un înveliș al celui nou (fără autor: nu mai are apelanți în baza de după migrare; rămâne pentru compatibilitate,
-- EXECUTE nimănui, ca înainte)
CREATE OR REPLACE FUNCTION public.fn_red_fan_urmarire_intern(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  RETURN public.fn_red_fan_urmarire_scrie(p_lot_id, p_randuri, NULL, NULL);
END $fn$;
-- RPC-ul vechi al owner-ului (clasa C, calea detaliată): același corp nou, autorul = auth.uid() verificat ca owner
CREATE OR REPLACE FUNCTION public.fn_red_fan_urmarire(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  RETURN public.fn_red_fan_urmarire_scrie(p_lot_id, p_randuri, NULL, auth.uid());
END $fn$;

-- ═══ 2. Clasa B — rularea automată (EXECUTE EXCLUSIV service_role; un JWT de om = 42501) ═══
-- Revendicarea: lock (advisory pe cheia fixă a rulărilor, L01) → rularea în curs de peste 15 minute se închide „expirata” (limita de execuție a
-- funcției edge e mult mai mică) → una în curs = „ocupat” → slotul de cron deja rulat azi = „ocupat” → rularea manuală: cel mult 4 pe zi → INSERT.
CREATE FUNCTION public.fn_red_fan_srv_rulare_incepe(p_sursa text, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_now timestamptz := clock_timestamp(); v_ro timestamp; v_zi date; v_slot text; v_id uuid; v_n integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  IF p_sursa IS NULL OR p_sursa NOT IN ('cron', 'owner') OR (p_sursa = 'cron') <> (p_actor IS NULL) THEN
    RAISE EXCEPTION 'redari fan: pornire invalida (cron fara actor, owner cu actor)' USING ERRCODE = '22023'; END IF;
  IF p_sursa = 'owner' AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor AND is_owner IS TRUE) THEN
    RAISE EXCEPTION 'redari fan: rularea manuala o porneste doar owner-ul' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('redari_fan_rulari', 0));
  UPDATE public.red_fan_rulari SET stare = 'expirata', incheiata_la = v_now, eroare_cod = 'lease_expirat'
   WHERE stare = 'in_curs' AND pornita_la < v_now - interval '15 minutes';
  IF EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE stare = 'in_curs') THEN RETURN jsonb_build_object('ocupat', true, 'motiv', 'rulare_in_curs'); END IF;
  v_ro := v_now AT TIME ZONE 'Europe/Bucharest';
  v_zi := v_ro::date;
  IF p_sursa = 'cron' THEN
    v_slot := CASE WHEN extract(hour FROM v_ro) < 13 THEN 'dimineata' ELSE 'seara' END;
    IF EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE zi_ro = v_zi AND slot = v_slot) THEN RETURN jsonb_build_object('ocupat', true, 'motiv', 'slot_rulat'); END IF;
  ELSE
    v_slot := 'manual';
    SELECT count(*) INTO v_n FROM public.red_fan_rulari WHERE zi_ro = v_zi AND slot = 'manual';
    IF v_n >= 4 THEN RETURN jsonb_build_object('ocupat', true, 'motiv', 'plafon_manual_zi'); END IF;
  END IF;
  INSERT INTO public.red_fan_rulari (zi_ro, slot, sursa, pornita_de, pornita_la, plafon_apeluri)
  VALUES (v_zi, v_slot, p_sursa, p_actor, v_now, 20) RETURNING id INTO v_id;
  RETURN jsonb_build_object('rulare_id', v_id, 'zi_ro', v_zi, 'slot', v_slot, 'plafon_apeluri', 20);
END $fn$;

-- Pasul durabil ÎNAINTEA fiecărui GET către curier: contorul rulării, CAS (rularea în curs, neexpirată, sub plafon). Plafon atins = RD040;
-- rularea închisă / expirată / inexistentă = RD041. Nimic altceva scris.
CREATE FUNCTION public.fn_red_fan_srv_rulare_apel(p_rulare uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  IF p_rulare IS NULL THEN RAISE EXCEPTION 'redari fan: rularea lipseste' USING ERRCODE = '22023'; END IF;
  UPDATE public.red_fan_rulari SET apeluri = apeluri + 1
   WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes' AND apeluri < plafon_apeluri
  RETURNING apeluri INTO v_n;
  IF v_n IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes') THEN
      RAISE EXCEPTION 'redari fan: plafonul de solicitari al rularii e atins' USING ERRCODE = 'RD040';
    END IF;
    RAISE EXCEPTION 'redari fan: rularea nu e in curs' USING ERRCODE = 'RD041';
  END IF;
  RETURN v_n;
END $fn$;

-- Ce e de urmărit (o singură definiție, L19): rândurile generat / ridicat cu AWB, încă nelivrate și fără retur cunoscut, generate în ultimele
-- 60 de zile, pe loturile permise de garda „doar TEST” (fn_red_fan_lot_permis, ca pe orice cale cu efect); cele mai vechi urmărite primele
-- (urmarit_la NULLS FIRST, id), cel mult plafon × 100 de rânduri; grupate pe lot, cu codul proiectului și marcajul TEST (garda din cod).
CREATE FUNCTION public.fn_red_fan_srv_de_urmarit(p_rulare uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plafon integer; v_lim integer; v_loturi jsonb; v_n integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  SELECT plafon_apeluri INTO v_plafon FROM public.red_fan_rulari
   WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes';
  IF v_plafon IS NULL THEN RAISE EXCEPTION 'redari fan: rularea nu e in curs' USING ERRCODE = 'RD041'; END IF;
  v_lim := v_plafon * 100;
  -- runda 5 (#1155 r4 P1): „livrat” = DOAR o livrare la un moment POSIBIL (fn_red_fan_moment_posibil, același predicat ca scrierea); o livrare
  -- imposibilă (scrisă de corpul de dinainte, ex. în viitor) nu e fapt final: AWB-ul rămâne de urmărit până la un fapt final valid.
  -- runda 6 (#1155 r5 P1): la fel RETURUL cunoscut: fapt final doar dacă cronologia pe care stă (ultim_eveniment_la) lipsește (returul legitim fără
  -- oră) sau e posibilă — ACEEAȘI compunere ca k_ret din fn_red_fan_urmarire_scrie (testul K20 compară eligibilitatea cu faptele scrise).
  -- generat_la intră în rând: ziua generării = limita de jos a momentului posibil în cod (redariFan.mjs::reperUrmarireFan).
  WITH ales AS (
    SELECT a.id, a.lot_id, a.awb, a.stare, a.versiune_urmarire, a.urmarit_la, a.generat_la
      FROM public.red_fan_awb a
      CROSS JOIN LATERAL (SELECT (a.generat_la AT TIME ZONE 'Europe/Bucharest')::date AS zi, clock_timestamp() AT TIME ZONE 'Europe/Bucharest' AS acum) g
      CROSS JOIN LATERAL (SELECT a.livrat_la IS NOT NULL AND public.fn_red_fan_moment_posibil(a.livrat_la AT TIME ZONE 'Europe/Bucharest', g.zi, g.acum) AS livrare,
                                 a.retur_cunoscut AND (a.ultim_eveniment_la IS NULL OR public.fn_red_fan_moment_posibil(a.ultim_eveniment_la AT TIME ZONE 'Europe/Bucharest', g.zi, g.acum)) AS retur) fin
     WHERE a.stare IN ('generat', 'ridicat') AND a.awb IS NOT NULL
       AND NOT fin.livrare AND NOT fin.retur AND (a.urmarire_stare <> 'livrat' OR a.livrat_la IS NOT NULL)
       AND a.generat_la >= clock_timestamp() - interval '60 days'
       AND public.fn_red_fan_lot_permis(a.lot_id)
     ORDER BY a.urmarit_la ASC NULLS FIRST, a.id
     LIMIT v_lim
  ), pe_lot AS (
    SELECT x.lot_id, count(*)::integer AS n, min(coalesce(x.urmarit_la, '-infinity'::timestamptz)) AS primul, min(x.id::text) AS primul_id,
           jsonb_agg(jsonb_build_object('id', x.id, 'awb', x.awb, 'stare', x.stare, 'versiune_urmarire', x.versiune_urmarire, 'generat_la', x.generat_la)
                     ORDER BY x.urmarit_la ASC NULLS FIRST, x.id) AS randuri
      FROM ales x GROUP BY x.lot_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('lot_id', l.lot_id, 'proiect_cod', pr.cod, 'test', coalesce(fl.test, false), 'randuri', l.randuri)
                            ORDER BY l.primul, l.primul_id), '[]'::jsonb),
         coalesce(sum(l.n), 0)::integer
    INTO v_loturi, v_n
    FROM pe_lot l
    JOIN public.red_loturi_plicuire lp ON lp.id = l.lot_id
    JOIN public.red_proiecte pr ON pr.id = lp.proiect_id
    LEFT JOIN public.red_fan_loturi fl ON fl.lot_id = l.lot_id;
  RETURN jsonb_build_object('loturi', v_loturi, 'randuri', v_n, 'limita', v_lim);
END $fn$;

-- Închiderea rulării (o dată; a doua oară = starea ei, fără scriere): numerele de urmărire le-a adunat BD-ul (fn_red_fan_srv_urmarire), nu
-- funcția edge; loturile raportate de edge se păstrează doar ca diagnostic. Lock: 12 rândul rulării → 11 red_jurnal (INSERT, ultimul).
CREATE FUNCTION public.fn_red_fan_srv_rulare_incheie(p_rulare uuid, p_stare text, p_eroare_cod text, p_loturi integer, p_loturi_sarite integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_r public.red_fan_rulari; v_deja boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  IF p_rulare IS NULL OR p_stare IS NULL OR p_stare NOT IN ('incheiata', 'oprita_plafon', 'oprita_eroare') OR (p_stare = 'incheiata') <> (p_eroare_cod IS NULL)
     OR (p_eroare_cod IS NOT NULL AND p_eroare_cod !~ '^[a-z0-9_]{1,60}$') OR coalesce(p_loturi, 0) < 0 OR coalesce(p_loturi_sarite, 0) < 0 THEN
    RAISE EXCEPTION 'redari fan: inchidere de rulare invalida' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_r FROM public.red_fan_rulari WHERE id = p_rulare FOR UPDATE;
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'redari fan: rulare inexistenta' USING ERRCODE = 'P0002'; END IF;
  IF v_r.stare <> 'in_curs' THEN
    v_deja := true;
  ELSE
    UPDATE public.red_fan_rulari SET stare = p_stare, incheiata_la = clock_timestamp(), eroare_cod = p_eroare_cod, loturi = p_loturi, loturi_sarite = p_loturi_sarite
     WHERE id = p_rulare RETURNING * INTO v_r;
    INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_noi, user_id)
    VALUES ('red_fan_rulari', v_r.id, 'update', jsonb_build_object('eveniment', 'urmarire_auto', 'sursa', v_r.sursa, 'slot', v_r.slot, 'zi_ro', v_r.zi_ro,
              'stare', v_r.stare, 'eroare_cod', v_r.eroare_cod, 'apeluri', v_r.apeluri, 'randuri', v_r.randuri, 'scrise', v_r.scrise, 'pastrate', v_r.pastrate,
              'depasite', v_r.depasite, 'contradictii', v_r.contradictii, 'ridicari', v_r.ridicari, 'loturi', v_r.loturi, 'loturi_sarite', v_r.loturi_sarite,
              'pornita_la', v_r.pornita_la, 'la', v_r.incheiata_la), v_r.pornita_de);
  END IF;
  RETURN jsonb_build_object('rulare_id', v_r.id, 'stare', v_r.stare, 'eroare_cod', v_r.eroare_cod, 'apeluri', v_r.apeluri, 'randuri', v_r.randuri,
    'scrise', v_r.scrise, 'pastrate', v_r.pastrate, 'depasite', v_r.depasite, 'contradictii', v_r.contradictii, 'ridicari', v_r.ridicari, 'deja_inchisa', v_deja);
END $fn$;

-- fn_red_fan_srv_urmarire: p_rulare prinde viață (rezervat din 20261228a). Exact unul dintre p_actor / p_rulare: p_actor = omul verificat din JWT
-- (F1, neschimbat: poarta operator / owner activ); p_rulare = rularea automată în curs, neexpirată (fără om: auth.uid() NULL, p_actor NULL).
-- Ambele căi scriu prin ACELAȘI corp fn_red_fan_urmarire_scrie (L19; runda 2), cu autorul: p_actor (omul) SAU p_rulare (rularea). Cu p_rulare,
-- numerele (inclusiv contradicțiile și ridicările automate) se adună în rândul rulării DUPĂ scriere; rularea închisă între timp = RD041 și TOTUL
-- se anulează (nici urmărirea, nici contradicțiile, nici jurnalul nu rămân scrise). Lock: 3 red_fan_awb (în corpul comun) → inserări → 12 rândul rulării.
CREATE OR REPLACE FUNCTION public.fn_red_fan_srv_urmarire(p_actor uuid, p_rulare uuid, p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_r jsonb;
BEGIN
  IF p_rulare IS NULL THEN
    PERFORM public.fn_red_fan_srv_poarta(p_actor, true);
    RETURN public.fn_red_fan_urmarire_scrie(p_lot_id, p_randuri, NULL, p_actor);
  END IF;
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'redari fan: rularea automata nu e apelabila de un om' USING ERRCODE = '42501'; END IF;
  IF p_actor IS NOT NULL THEN RAISE EXCEPTION 'redari fan: exact unul dintre actor si rulare' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_fan_rulari WHERE id = p_rulare AND stare = 'in_curs' AND pornita_la >= clock_timestamp() - interval '15 minutes') THEN
    RAISE EXCEPTION 'redari fan: rularea nu e in curs' USING ERRCODE = 'RD041'; END IF;
  v_r := public.fn_red_fan_urmarire_scrie(p_lot_id, p_randuri, p_rulare, NULL);
  UPDATE public.red_fan_rulari SET randuri = randuri + jsonb_array_length(p_randuri), scrise = scrise + (v_r ->> 'scrise')::integer,
         pastrate = pastrate + (v_r ->> 'pastrate')::integer, depasite = depasite + (v_r ->> 'depasite')::integer,
         contradictii = contradictii + (v_r ->> 'contradictii')::integer, ridicari = ridicari + (v_r ->> 'ridicari')::integer
   WHERE id = p_rulare AND stare = 'in_curs';
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: rularea s-a inchis in timpul scrierii' USING ERRCODE = 'RD041'; END IF;
  RETURN v_r;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_red_fan_srv_rulare_incepe(text, uuid), public.fn_red_fan_srv_rulare_apel(uuid), public.fn_red_fan_srv_de_urmarit(uuid),
  public.fn_red_fan_srv_rulare_incheie(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_fan_srv_rulare_incepe(text, uuid), public.fn_red_fan_srv_rulare_apel(uuid), public.fn_red_fan_srv_de_urmarit(uuid),
  public.fn_red_fan_srv_rulare_incheie(uuid, text, text, integer, integer) TO service_role;

-- ═══ 3. Postcondiții ═══
DO $post$
DECLARE r record; v_rau text; v_n integer;
BEGIN
  -- tabelul nou: RLS activ (fără FORCE), proprietar postgres, exact politica de citire; drepturi: DOAR SELECT pentru authenticated (service_role nimic)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.red_fan_rulari'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner) = 'postgres')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.red_fan_rulari'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'public.red_fan_rulari'::regclass AND pol.polname = 'red_fan_rulari_citire' AND pol.polcmd = 'r'
                      AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polwithcheck IS NULL
                      AND pg_get_expr(pol.polqual, pol.polrelid) = '((auth.uid() IS NOT NULL) AND (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text])))') THEN
    RAISE EXCEPTION '20270102a post: RLS / politica pe red_fan_rulari';
  END IF;
  SELECT string_agg(y.rol || '/' || z.drept, ', ') INTO v_rau
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
   WHERE has_table_privilege(y.rol, 'public.red_fan_rulari'::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol = 'authenticated');
  IF v_rau IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.red_fan_rulari'::regclass AND e.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.red_fan_rulari'::regclass AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20270102a post: drepturi pe red_fan_rulari (%)', coalesce(v_rau, 'PUBLIC / coloane');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_fan_rulari'::regclass AND NOT tgisinternal)
     OR (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_rulari_in_curs_uq')
        IS DISTINCT FROM 'CREATE UNIQUE INDEX red_fan_rulari_in_curs_uq ON public.red_fan_rulari USING btree (stare) WHERE (stare = ''in_curs''::text)'
     OR (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'red_fan_rulari_slot_uq')
        IS DISTINCT FROM 'CREATE UNIQUE INDEX red_fan_rulari_slot_uq ON public.red_fan_rulari USING btree (zi_ro, slot) WHERE (slot <> ''manual''::text)' THEN
    RAISE EXCEPTION '20270102a post: trigger-e sau indexurile unice pe red_fan_rulari';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('red_fan_rulari_apeluri_plafon'), ('red_fan_rulari_suma'), ('red_fan_rulari_pornire'), ('red_fan_rulari_inchiderea'), ('red_fan_rulari_motiv')) v(c) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_fan_rulari'::regclass AND conname = r.c AND contype = 'c' AND convalidated) THEN
      RAISE EXCEPTION '20270102a post: CHECK-ul % lipseste', r.c; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.red_fan_rulari) THEN RAISE EXCEPTION '20270102a post: red_fan_rulari are randuri'; END IF;
  -- runda 2: red_fan_contradictii — RLS (fără FORCE), exact politica de citire, DOAR SELECT pentru authenticated, fără trigger-e, cheia unică, CHECK-urile, gol
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.red_fan_contradictii'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity AND pg_get_userbyid(c.relowner) = 'postgres')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.red_fan_contradictii'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'public.red_fan_contradictii'::regclass AND pol.polname = 'red_fan_contradictii_citire' AND pol.polcmd = 'r'
                      AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polwithcheck IS NULL
                      AND pg_get_expr(pol.polqual, pol.polrelid) = '((auth.uid() IS NOT NULL) AND (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text])))') THEN
    RAISE EXCEPTION '20270102a post: RLS / politica pe red_fan_contradictii';
  END IF;
  SELECT string_agg(y.rol || '/' || z.drept, ', ') INTO v_rau
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
   WHERE has_table_privilege(y.rol, 'public.red_fan_contradictii'::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol = 'authenticated');
  IF v_rau IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE c.oid = 'public.red_fan_contradictii'::regclass AND e.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.red_fan_contradictii'::regclass AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20270102a post: drepturi pe red_fan_contradictii (%)', coalesce(v_rau, 'PUBLIC / coloane');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_fan_contradictii'::regclass AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_fan_contradictii'::regclass AND conname = 'red_fan_contradictii_cheie_uq' AND contype = 'u'
                      AND pg_get_constraintdef(oid) = 'UNIQUE (fan_awb_id, cheie)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_fan_contradictii'::regclass AND contype = 'f' AND confrelid = 'public.red_fan_awb'::regclass
                      AND pg_get_constraintdef(oid) = 'FOREIGN KEY (fan_awb_id) REFERENCES red_fan_awb(id)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_fan_contradictii'::regclass AND conname = 'red_fan_contradictii_regula' AND contype = 'c' AND convalidated)
     OR EXISTS (SELECT 1 FROM public.red_fan_contradictii) THEN
    RAISE EXCEPTION '20270102a post: trigger-e / cheia unica / cheia straina / CHECK-ul regulii pe red_fan_contradictii, sau tabelul are randuri';
  END IF;
  -- funcțiile: exact 58 fn_red_fan_* (52 ale bazei, dintre care 3 înlocuite, + 6 noi), fiecare cu corpul (AMPRENTE-NOI), limbajul, DEFINER, volatilitatea, tipul întors, proprietarul și EXECUTE EXACT pe clasă
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      -- >>> AMPRENTE-NOI 20270102a (semnătura, md5(replace(prosrc, chr(13), '')), limbaj, DEFINER, volatilitate, tipul întors, EXECUTE authenticated, EXECUTE service_role)
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
      ('public.fn_red_fan_srv_de_urmarit(uuid)', '984f50f20172f2d57e3991229c84fdb2', 'plpgsql', true, 's', 'jsonb', false, true),
      ('public.fn_red_fan_moment_posibil(timestamp,date,timestamp)', 'eba02dda21fe7494c16bf991e19d9d14', 'sql', false, 'i', 'boolean', false, false),
      ('public.fn_red_fan_srv_intentie_incheie(uuid,uuid,jsonb)', '1017ae767ed3d8f947a18f8d3b9c2c6d', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_poarta(uuid,boolean)', 'eae0c2fa2fc3ec18b44ce55b60a96848', 'plpgsql', true, 's', 'void', false, false),
      ('public.fn_red_fan_srv_reconciliaza(uuid,uuid,text,numeric,numeric)', '38e16206cef4468c73e2cf103b163127', 'plpgsql', true, 'v', 'text', false, true),
      ('public.fn_red_fan_srv_rezultate(uuid,uuid,uuid,jsonb,integer)', '216688178ad5d77bb059054a96a31a7a', 'plpgsql', true, 'v', 'integer', false, true),
      ('public.fn_red_fan_srv_rulare_apel(uuid)', 'ca597a7446e9b9bd1a1d3c4029f13c43', 'plpgsql', true, 'v', 'integer', false, true),
      ('public.fn_red_fan_srv_rulare_incepe(text,uuid)', '2b1f1bf31f225284a2d9f4ca613933c8', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_rulare_incheie(uuid,text,text,integer,integer)', '4cd929e8d0a3f440ff0015ab4b8161e3', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_srv_urmarire(uuid,uuid,uuid,jsonb)', 'c822d21b2f713f5a61ebb65b403718c6', 'plpgsql', true, 'v', 'jsonb', false, true),
      ('public.fn_red_fan_suma(numeric)', 'e4c468b1a27473db01ba7cfd15421a7d', 'sql', false, 'i', 'numeric', false, false),
      ('public.fn_red_fan_surse(uuid)', 'dd250f175d559976c72412ded8a1ae06', 'sql', false, 's', 'text', false, false),
      ('public.fn_red_fan_tiraj(uuid,text,text)', '36cafe6b98cf2436e5ffb42370139765', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_tiraj_opreste(uuid,text,boolean)', '63b507c349b2961c032468a3d542212a', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire(uuid,jsonb)', 'f310b4933f6064f4c2187e1602b46bb1', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_urmarire_intern(uuid,jsonb)', '50512f2506fcbf23bda6e4559cfbc71f', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_urmarire_scrie(uuid,jsonb,uuid,uuid)', '0c4c99f8a0d2dc5028aff4bf8f5edd78', 'plpgsql', true, 'v', 'jsonb', false, false),
      ('public.fn_red_fan_urmarire_solutioneaza(uuid,integer,jsonb,text)', 'd286bb9f78d01f751eb123b0eb8ca5a5', 'plpgsql', true, 'v', 'jsonb', true, false),
      ('public.fn_red_fan_zi_garda()', '5c51181772f185ac5559913dd32918ec', 'plpgsql', true, 'v', 'trigger', false, false)
      -- <<< AMPRENTE-NOI 20270102a
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
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270102a post: functiile (corp / proprietati / EXECUTE) difera: %', v_rau; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%';
  IF v_n <> 58 THEN RAISE EXCEPTION '20270102a post: numarul functiilor fn_red_fan_* este %, asteptat 58', v_n; END IF;
  -- porțile 0e / Izometrie E2 (ca 20261228a runda 4): marcajul gărzii rândului FAN scris DOAR de cele 7 funcții ale listelor trigger-ului; niciun corp
  -- fn_red_fan_* nu cheamă funcția de configurare, nu numește calea de căutare și nu are SQL dinamic
  IF (SELECT array_agg(p.proname::text ORDER BY p.proname::text COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast'
         AND (p.prosrc ~* 'set\s+(local\s+|session\s+)?redari_fan\.garda' OR p.prosrc ~* 'set_config\s*\(\s*''redari_fan\.garda'))
     IS DISTINCT FROM ARRAY['fn_red_fan_anulare_cere', 'fn_red_fan_anulat', 'fn_red_fan_cerere_decide', 'fn_red_fan_claim_intern', 'fn_red_fan_comanda',
                            'fn_red_fan_retrage', 'fn_red_fan_srv_anuleaza']::text[]
     OR EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c WHERE c ILIKE 'redari_fan.garda=%') THEN
    RAISE EXCEPTION '20270102a post: marcajul redari_fan.garda e scris de alte functii decat cele 7 de pe listele trigger-ului (sau apare in proconfig)';
  END IF;
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_rau FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_red\_fan\_%'
     AND (p.prosrc ~* '(set_config|search_path)' OR p.prosrc ~* '\mexecute\M');
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20270102a post: corpuri fn_red_fan_* prinse de portile 0e / Izometrie E2 (configurare, cale de cautare sau SQL dinamic): %', v_rau;
  END IF;
  -- trigger-ele de pe red_fan_awb: neschimbate (exact cele două)
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_awb'::regclass AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '20270102a post: trigger-ele de pe red_fan_awb s-au schimbat';
  END IF;
  -- nimic scris în red_jurnal de această migrare
  IF EXISTS (SELECT 1 FROM public.red_jurnal j WHERE j.xmin::text = (txid_current() % 4294967296)::text) THEN
    RAISE EXCEPTION '20270102a post: migrarea a scris in red_jurnal';
  END IF;
  RAISE NOTICE '20270102a: sfarsit la % ms de la BEGIN (fara lock-uri pe tabelele existente)', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;

-- L15: lanțul verificat și DUPĂ pentru poarta de drept neschimbată (fn_red_nivel); garda finală; funcția pg_temp se șterge
DO $l15_dupa$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_nivel()') AND md5(replace(p.prosrc, chr(13), '')) = '21db8e5d4b69b7f19e571a7087c361ae'
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20270102a: poarta de drept (dupa) difera de amprenta revizuita';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270102a_redari_fan_urmarire_auto:' || txid_current() OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '20270102a: garda final invalida';
  END IF;
END $l15_dupa$;
DROP FUNCTION pg_temp.lant_20270102a();
