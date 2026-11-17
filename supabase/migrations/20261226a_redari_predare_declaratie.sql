-- Version 20261226120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261226a_redari_predare_declaratie.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ v2 a runnerului (orice derivă a unei funcții, politici, drept sau
--   trigger față de baseline-ul revizuit = refuz, nimic comis). Manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh); lista OBIECTELOR pe care trebuie să le conțină (familie, etichetă, operație — scrisă și verificată pe
--   PGlite cu pașii reali ai runnerului) e în supabase/tests/20261226a_redari_predare_declaratie.l15.obiecte.tsv. Pe lângă ea, migrarea verifică
--   pe amprentă (corp + proprietăți + drepturi, ÎNAINTE și DUPĂ) cele două funcții pe care le înlocuiește și mecanismul jurnalului.
-- 20261226a_redari_predare_declaratie — Redări, terminologia „predare” (deciziile proprietarului, 17.11.2026), partea de BAZĂ DE DATE:
--   * red_proiecte.text_declaratie (declarația din formularul public, opțiunea „Nu particip — nu am obiecții”): semnarea de la distanță se
--     face DOAR electronic. DEFAULT-ul nou = textul de mai jos (NOU), iar rândurile care au EXACT vechea valoare implicită (VECHI) primesc
--     textul nou; un proiect cu text personalizat rămâne neatins. Postcondiție: niciun rând cu VECHI;
--   * opțiunea de răspuns nu_particip_cu_obiectii NU se mai acceptă pentru răspunsuri NOI, pe ORICE cale (L07): triggerul BEFORE
--     fn_red_raspunsuri_valideaza (RPC-ul public, inserarea operatorului prin API, service_role, orice alt producător, inclusiv e-mailul) refuză
--     INSERT-ul cu acest cod și UPDATE-ul care schimbă opțiunea CĂTRE el (23514, mesajul pentru operator: cine are obiecții vine la sesiune
--     sau cere constatare pe teren). Codul RĂMÂNE în CHECK (istoric): răspunsurile vechi rămân valabile și afișabile, iar un rând vechi care îl
--     are deja se poate corecta în continuare (alt câmp, opțiunea neschimbată — regulile existente ale opțiunii rămân, ex. obiecțiile nevide);
--   * RPC-ul public fn_red_raspuns_public întoarce pentru acest cod refuzul EXISTENT 'optiune_invalida' (aceeași formă jsonb, în același punct
--     al corpului — după contoare, înainte de orice scriere): niciun motiv nou, deci niciun oracol nou și nicio schimbare cerută în formular;
--   * L19: „opțiunea e retrasă” = o singură definiție, public.fn_red_optiune_retrasa(text) (nouă, internă, fără drept de apel pentru roluri),
--     chemată de trigger și de RPC.
-- Textele (singurele noi; decizia proprietarului, 17.11.2026):
--   VECHI = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.'
--   NOU   = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.'
-- Evidența rândurilor schimbate (pentru revenire, fără tabel / coloană / RPC nou): fiecare UPDATE pe red_proiecte scrie singur un rând în
--   red_jurnal (triggerul trg_red_jurnal, fn_red_jurnal din 20261130j: rândul vechi și cel nou întregi, user_id = auth.uid(), user_email =
--   auth.jwt() ->> 'email') și crește red_proiecte.versiune (trg_red_versiune). r2 (review #1119 P1): rândurile de jurnal ale ACESTEI
--   execuții poartă MARCAJUL EXECUȚIEI în câmpul existent user_email: 'livrare:' || marcajul runnerului = 'livrare:20261226a_redari_predare_
--   declaratie:<txid>' (numele migrării + tranzacția concretă, din garda de livrare). Cum: doar pe durata UPDATE-ului, request.jwt.claims
--   (LOCAL, în tranzacție) = {"email": marcaj}, FĂRĂ sub și FĂRĂ role, deci auth.uid() și auth.role() rămân NULL (user_id = NULL ca înainte;
--   triggerele de pe red_proiecte nu primesc nicio identitate: nicio coloană de autorizare / aprobare / retenție nu se schimbă, verificat de
--   postcondiție); apoi claims = '' (verificat). Un JWT real nu poate produce marcajul: user_id ar fi nenul (sub), iar service_role nu are email.
--   Postcondiția verifică un rând de jurnal pe fiecare proiect schimbat: tabela red_proiecte, update, fără utilizator, CU MARCAJUL execuției,
--   created_at = momentul acestei tranzacții, VECHI -> NOU și NIMIC altceva schimbat în afară de versiune. Revenirea schimbă înapoi DOAR
--   proiectele al căror ULTIM rând de jurnal e un rând al ULTIMEI execuții a migrării (marcajul) și sunt identice cu date_noi din el
--   (to_jsonb(rând) = date_noi, deci și aceeași versiune): o tranziție VECHI -> NOU făcută de altcineva (fără marcaj), un proiect editat între
--   timp de un om sau creat după migrare rămân neatinse. NOTICE-ul listează marcajul și id / cod / versiunea fiecărui proiect schimbat (de
--   consemnat în jurnalul livrării).
-- Ce NU face: nicio altă dată (denumirea proiectului o schimbă coordonatorul, separat, cu preview și acord); niciun drept nou pe tabele sau
--   funcții existente; nimic în CHECK-ul red_raspunsuri; nimic în ecrane / șabloane / formular (PR #1117); niciun mail, SMS, cron.
-- ORDINEA (aceeași în ambele documente de livrare): ACEASTĂ migrare -> 20261226b -> publicarea coordonată #1117 + #1119 -> reîncărcarea
--   formularului public pe proiectul de test; de coordonator, cu acordul proprietarului (docs/redari/LIVRARE_20261226a_PREDARE_DECLARATIE.md:
--   stările intermediare, pașii obligatorii dinainte — amprentele pe producție, trimiterile SMS oprite). #1117 publicat fără această migrare =
--   formularul afișează textul vechi din BD; #1119 publicat înaintea 20261226b = crearea loturilor SMS Redări refuzată.
-- Ordinea lock-urilor (L06), punct unic, NOWAIT: red_proiecte ACCESS EXCLUSIVE (cerut de ALTER COLUMN … SET DEFAULT; același lock acoperă
--   UPDATE-ul). Lock-urile IMPLICITE de după set: (a) UPDATE-ul pe red_proiecte (ținut deja mai tare); (b) în afara setului: INSERT în
--   red_jurnal (ROW EXCLUSIVE, din trg_red_jurnal; intră în conflict doar cu SHARE și mai tare pe red_jurnal: DDL, LOCK) și citirile de catalog.
--   CREATE OR REPLACE FUNCTION nu ia lock pe red_raspunsuri (triggerul vede corpul nou de la COMMIT); un răspuns inserat concurent înainte de
--   COMMIT trece pe regula veche — ca înainte de migrare. red_raspunsuri NU se blochează.
--   Cât e ținut ACCESS EXCLUSIVE (până la COMMIT, inclusiv pasul „după” al runnerului — calculul final al amprentei: ~450 ms pe clonă,
--   ~1,3–1,6 s estimat pe producție) sunt oprite și CITIRILE din red_proiecte: formularul public (fn_red_formular_public) și ecranele Redări
--   așteaptă — de aplicat într-un moment liniștit. Bugetul de mai jos limitează OBȚINEREA lock-ului, nu durata ținerii lui.
--   Bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI, verificat înaintea fiecărei încercări și DUPĂ obținere (docs/LIVRARE_L15_V2.md
--   §9 „Bugetul de lock”); fiecare încercare = subtranzacție.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$, în forma acceptată de validator),
--   lock_timeout = 100 ms, bugetul lock-ului de 1 s și garda finală a runnerului. Fără alt plafon.
-- Revenire: supabase/revenire/20261226a_redari_predare_declaratie_ROLLBACK.sql. Probe: scripts/pglite/test_redari_predare_declaratie_local.mjs
--   (PGlite, cu pașii reali L15 v2 ai runnerului, mutanți, aplicare -> revenire -> reaplicare).
DO $pre$
DECLARE v_plafon text; v_def text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261226a_redari_predare_declaratie:' || txid_current() THEN
    RAISE EXCEPTION '20261226a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261226a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261226a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261226a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261226a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tabelul lui temporar, cu tag aleator, CREAT de tranzacția curentă și
  -- ținut de sesiune; tiparul 20261225a). Fără --amprenta-globala / --diferente-globale (sau în afara runnerului) = refuz.
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261226a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regprocedure('public.fn_red_optiune_retrasa(text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fn_red_optiune_retrasa') THEN
    RAISE EXCEPTION '20261226a: obiectele exista deja (reaplicare)';
  END IF;
  -- cele două funcții înlocuite sunt EXACT cele din 20261126a (corpul fără CR + proprietățile); fn_red_raspunsuri_valideaza = amprenta
  -- confirmată pe producție în allow-list-ul 20261131g; fn_red_raspuns_public: refuz dacă producția are alt corp
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_raspunsuri_valideaza()')
                   AND md5(replace(p.prosrc, chr(13), '')) = '3528222d7d8379dbbe8f3d2e64c60b94'
                   AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql') AND p.prosecdef
                   AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND p.prorettype = 'trigger'::regtype AND p.provolatile = 'v')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_raspuns_public(text,text,date,text,boolean,text)')
                   AND md5(replace(p.prosrc, chr(13), '')) = '230aa93e36c8d9b5f9ac5f3afc0066ad'
                   AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql') AND p.prosecdef
                   AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                   AND p.prorettype = 'jsonb'::regtype AND p.provolatile = 'v')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_red_raspunsuri_valideaza', 'fn_red_raspuns_public')) <> 2 THEN
    RAISE EXCEPTION '20261226a: fn_red_raspunsuri_valideaza / fn_red_raspuns_public nu sunt cele din 20261126a (corp, proprietati sau variante)';
  END IF;
  -- triggerul de validare, exact (funcția, BEFORE INSERT OR UPDATE pe rând, activ, fără WHEN / argumente / coloane)
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND t.tgname = 'trg_red_raspunsuri_valideaza'
        AND t.tgfoid = 'public.fn_red_raspunsuri_valideaza()'::regprocedure AND t.tgtype = 23 AND t.tgenabled = 'O' AND NOT t.tgisinternal
        AND t.tgqual IS NULL AND t.tgnargs = 0 AND cardinality(t.tgattr::int2[]) = 0) <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = 'public.fn_red_raspunsuri_valideaza()'::regprocedure) <> 1 THEN
    RAISE EXCEPTION '20261226a: triggerul trg_red_raspunsuri_valideaza nu e cel din 20261126a';
  END IF;
  -- CHECK-ul opțiunii: cele patru coduri (rămâne neschimbat; codul retras e istoric)
  IF (SELECT string_agg(pg_get_constraintdef(c.oid), '; ') FROM pg_constraint c
       WHERE c.conrelid = 'public.red_raspunsuri'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%optiune%')
     IS DISTINCT FROM 'CHECK ((optiune = ANY (ARRAY[''particip''::text, ''nu_particip_fara_obiectii''::text, ''nu_particip_cu_obiectii''::text, ''constatare_teren''::text])))' THEN
    RAISE EXCEPTION '20261226a: CHECK-ul pe red_raspunsuri.optiune nu e cel din 20261126a';
  END IF;
  -- declarația: coloana text NOT NULL, DEFAULT-ul = EXACT VECHI
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie';
  IF v_def IS DISTINCT FROM quote_literal('Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.') || '::text'
     OR (SELECT format_type(a.atttypid, a.atttypmod) || '/' || a.attnotnull::text FROM pg_attribute a
          WHERE a.attrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie' AND NOT a.attisdropped) IS DISTINCT FROM 'text/true'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = 'public.red_proiecte'::regclass AND a.attname = 'versiune' AND NOT a.attisdropped) IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION '20261226a: red_proiecte.text_declaratie (DEFAULT %) / versiune nu sunt cele asteptate', coalesce(v_def, 'lipsa');
  END IF;
  -- evidența pentru revenire: jurnalul și versiunea pe red_proiecte, exact (funcțiile din 20261130j / 20261127a, triggerele active)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_jurnal()') AND md5(replace(p.prosrc, chr(13), '')) = '41ab451b7fcb499a2284c9c82367069e')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_red_versiune_creste()') AND md5(replace(p.prosrc, chr(13), '')) = 'e7ab9318de671f0a94c678ee382250db')
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_jurnal'
           AND t.tgfoid = 'public.fn_red_jurnal()'::regprocedure AND t.tgtype = 29 AND t.tgenabled = 'O' AND t.tgqual IS NULL AND t.tgnargs = 0) <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND t.tgname = 'trg_red_versiune'
           AND t.tgfoid = 'public.fn_red_versiune_creste()'::regprocedure AND t.tgtype = 19 AND t.tgenabled = 'O' AND t.tgqual IS NULL AND t.tgnargs = 0) <> 1
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_jurnal'
           AND column_name IN ('tabela', 'inregistrare_id', 'actiune', 'date_vechi', 'date_noi', 'user_id', 'user_email', 'created_at')) <> 8 THEN
    RAISE EXCEPTION '20261226a: jurnalul / versiunea pe red_proiecte nu sunt cele asteptate (evidenta revenirii)';
  END IF;
  -- marcajul execuției (r2): sesiunea de livrare NU are JWT (altfel marcajul s-ar amesteca cu o identitate); toate sursele lui auth.*
  IF auth.uid() IS NOT NULL OR auth.jwt() IS NOT NULL OR auth.role() IS NOT NULL
     OR nullif(current_setting('request.jwt.claim', true), '') IS NOT NULL OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
     OR nullif(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL OR nullif(current_setting('request.jwt.claim.role', true), '') IS NOT NULL THEN
    RAISE EXCEPTION '20261226a: sesiunea de livrare are JWT / claims (marcajul executiei cere o sesiune fara identitate)';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261226a: anon/authenticated pot crea obiecte in public';
  END IF;
END $pre$;

-- drepturile EXACTE ale celor două funcții înlocuite, ÎNAINTE (postcondiția: aceleași după CREATE OR REPLACE)
CREATE TEMP TABLE red_acl_20261226a ON COMMIT DROP AS
  SELECT p.oid::regprocedure::text AS functie, coalesce(p.proacl, acldefault('f', p.proowner))::text AS acl
    FROM pg_proc p WHERE p.oid IN ('public.fn_red_raspunsuri_valideaza()'::regprocedure, 'public.fn_red_raspuns_public(text,text,date,text,boolean,text)'::regprocedure);

-- ── punctul UNIC de blocare (L06), după verificările de catalog: red_proiecte ACCESS EXCLUSIVE (SET DEFAULT + UPDATE). Bugetul = 1 s cu ceasul
-- pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI (nu la BEGIN), verificat ÎNAINTE de fiecare încercare și DUPĂ obținere (și pe calea fără coliziune);
-- fiecare încercare = subtranzacție. Lock-urile implicite de după set: în antet. ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261226a: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000)
        USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261226a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000)
      USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261226a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Opțiunea retrasă: o singură definiție (L19) ────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_red_optiune_retrasa(p_optiune text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT p_optiune IS NOT DISTINCT FROM 'nu_particip_cu_obiectii'
$fn$;
COMMENT ON FUNCTION public.fn_red_optiune_retrasa(text) IS 'Redări (intern): true = opțiunea de răspuns e RETRASĂ (nu se mai acceptă pentru răspunsuri noi: INSERT sau UPDATE către ea). Azi: nu_particip_cu_obiectii (decizia proprietarului, 17.11.2026). Codul rămâne în CHECK-ul red_raspunsuri (istoric). Singura definiție: o cheamă triggerul fn_red_raspunsuri_valideaza și RPC-ul public fn_red_raspuns_public. 20261226a.';
REVOKE ALL ON FUNCTION public.fn_red_optiune_retrasa(text) FROM PUBLIC, anon, authenticated, service_role;

-- ─── 2. Triggerul de validare (orice cale): corpul 20261126a + blocul marcat „20261226a” ──────────────────────────────────────
-- CREATE OR REPLACE păstrează proprietarul, ACL-ul și triggerul; SECURITY DEFINER și search_path se rescriu identic (postcondiția).
CREATE OR REPLACE FUNCTION public.fn_red_raspunsuri_valideaza() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r record;
  v_ob text := nullif(btrim(coalesce(NEW.obiectii_text, '')), '');
BEGIN
  -- created_at = momentul recepției: pus de trigger la INSERT (clientul nu are privilegiu pe coloană), imutabil la UPDATE;
  -- `data` = momentul declarat (editabil de operator) — „ultimul răspuns” = data DESC, seq DESC
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
    -- la UPDATE verificările rulează doar când se schimbă conținutul răspunsului
    IF NEW.canal IS NOT DISTINCT FROM OLD.canal AND NEW.optiune IS NOT DISTINCT FROM OLD.optiune AND NEW.zi_sesiune_aleasa IS NOT DISTINCT FROM OLD.zi_sesiune_aleasa
       AND NEW.obiectii_text IS NOT DISTINCT FROM OLD.obiectii_text AND NEW.declaratie_confirmata IS NOT DISTINCT FROM OLD.declaratie_confirmata THEN
      RETURN NEW;
    END IF;
  END IF;
  -- 20261226a (decizia proprietarului, 17.11.2026): opțiunea retrasă nu se mai acceptă pentru răspunsuri NOI — la INSERT (orice cale) și la
  -- UPDATE care schimbă opțiunea CĂTRE ea. Un rând vechi care o are deja rămâne valabil și se poate corecta (opțiunea neschimbată).
  IF public.fn_red_optiune_retrasa(NEW.optiune) IS TRUE AND (TG_OP = 'INSERT' OR NEW.optiune IS DISTINCT FROM OLD.optiune) THEN
    RAISE EXCEPTION 'redari: optiunea % nu se mai accepta pentru raspunsuri noi; cine are obiectii vine la sesiune sau cere constatare pe teren', NEW.optiune
      USING ERRCODE = '23514';
  END IF;
  IF length(coalesce(NEW.obiectii_text, '')) > 4000 THEN RAISE EXCEPTION 'redari: obiectii_text peste 4000 de caractere' USING ERRCODE = '23514'; END IF;
  -- aceleași reguli ca în RPC-ul public, și pentru operatori (telefon / scris / sesiune); RPC-ul își păstrează mesajele jsonb înaintea insertului
  IF NEW.optiune = 'particip' THEN
    IF NEW.zi_sesiune_aleasa IS NULL THEN RAISE EXCEPTION 'redari: particip cere zi_sesiune_aleasa' USING ERRCODE = '23514'; END IF;
    -- apartenența la sesiunile CURENTE ale UAT-ului: la INSERT, când se schimbă ziua și când opțiunea DEVINE particip (sesiunile se pot muta ulterior)
    IF TG_OP = 'INSERT' OR NEW.zi_sesiune_aleasa IS DISTINCT FROM OLD.zi_sesiune_aleasa OR OLD.optiune IS DISTINCT FROM 'particip' THEN
      SELECT u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3 INTO r
        FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id JOIN public.red_uat u ON u.id = p.uat_id
       WHERE d.id = NEW.detinator_id;
      IF NEW.zi_sesiune_aleasa IS DISTINCT FROM r.sesiune_zi1 AND NEW.zi_sesiune_aleasa IS DISTINCT FROM r.sesiune_zi2
         AND NEW.zi_sesiune_aleasa IS DISTINCT FROM r.sesiune_zi3 THEN
        RAISE EXCEPTION 'redari: particip cere zi_sesiune_aleasa = una din zilele de sesiune ale UAT-ului' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN
    IF v_ob IS NULL THEN RAISE EXCEPTION 'redari: % cere obiectii_text nevid', NEW.optiune USING ERRCODE = '23514'; END IF;
  ELSIF NEW.optiune = 'nu_particip_fara_obiectii' AND NEW.canal = 'online' AND NEW.declaratie_confirmata IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'redari: nu_particip_fara_obiectii online cere declaratie_confirmata = true' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.fn_red_raspunsuri_valideaza() IS 'Redări: trigger BEFORE INSERT/UPDATE pe red_raspunsuri — opțiunea retrasă (fn_red_optiune_retrasa: nu_particip_cu_obiectii, din 17.11.2026) refuzată la INSERT și la UPDATE către ea (rândurile vechi rămân valabile și corectabile; 20261226a); particip ⇒ zi din sesiunile UAT-ului deținătorului; nu_particip_cu_obiectii / constatare_teren ⇒ obiectii_text nevid; nu_particip_fara_obiectii pe canal online ⇒ declaratie_confirmata = true (telefon / scris / sesiune: operatorul confirmă); obiectii_text ≤ 4000; la UPDATE doar când se schimbă canal / opțiune / zi / obiecții / declarație (trecerea la particip re-verifică ziua); created_at = now() la INSERT, imutabil apoi.';

-- ─── 3. RPC-ul public: corpul 20261126a, cu opțiunea retrasă în refuzul EXISTENT optiune_invalida (același punct, aceeași formă) ───────
CREATE OR REPLACE FUNCTION public.fn_red_raspuns_public(p_token text, p_optiune text, p_zi date, p_obiectii text, p_declaratie_confirmata boolean, p_user_agent text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ip text := coalesce(public.fn_red_ip_client(), 'necunoscut');
  v_ob text := nullif(btrim(coalesce(p_obiectii, '')), '');
  v_deja boolean; v_id uuid; v_gasit boolean;
  r record;
BEGIN
  -- formatul tokenului (exact 43 caractere base64url) se verifică ÎNAINTE de orice scriere în red_rate_limit
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'token_invalid');
  END IF;
  SELECT d.id AS detinator_id, t.token_expira_la, u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3
    INTO r
    FROM public.red_detinatori_token t
    JOIN public.red_detinatori d ON d.id = t.detinator_id AND d.sters_la IS NULL
    JOIN public.red_parcele p ON p.id = d.parcela_id AND p.sters_la IS NULL
    JOIN public.red_uat u ON u.id = p.uat_id
   WHERE t.token_raspuns = p_token;
  v_gasit := FOUND AND (r.token_expira_la IS NULL OR now() <= r.token_expira_la);
  -- contorul IP se atinge mereu (ip:necunoscut cand x-forwarded-for lipseste — limita reala e la gateway-ul Supabase); cheia de token DOAR
  -- pentru tokenuri existente si valide (multime finita → fara DoS prin chei arbitrare)
  IF public.fn_red_rate_limit_atinge('ip:' || v_ip, 30) THEN RETURN jsonb_build_object('ok', false, 'motiv', 'prea_multe'); END IF;
  PERFORM public.fn_red_rate_limit_curata(false);
  IF NOT v_gasit THEN RETURN jsonb_build_object('ok', false, 'motiv', 'token_invalid'); END IF;
  IF public.fn_red_rate_limit_atinge('t:' || encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), 5) THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'prea_multe');
  END IF;
  -- 20261226a: opțiunea retrasă (fn_red_optiune_retrasa) = același refuz ca orice opțiune nepermisă (fără motiv nou); triggerul o refuză oricum
  IF p_optiune IS NULL OR p_optiune NOT IN ('particip', 'nu_particip_fara_obiectii', 'nu_particip_cu_obiectii', 'constatare_teren')
     OR public.fn_red_optiune_retrasa(p_optiune) IS TRUE THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'optiune_invalida');
  END IF;
  -- particip: ziua e obligatorie și trebuie să fie una din zilele de sesiune ale UAT-ului deținătorului
  IF p_optiune = 'particip' AND (p_zi IS NULL
     OR (p_zi IS DISTINCT FROM r.sesiune_zi1 AND p_zi IS DISTINCT FROM r.sesiune_zi2 AND p_zi IS DISTINCT FROM r.sesiune_zi3)) THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'zi_invalida');
  END IF;
  IF p_optiune = 'nu_particip_fara_obiectii' AND coalesce(p_declaratie_confirmata, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'declaratie_neconfirmata');
  END IF;
  IF p_optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN
    IF v_ob IS NULL THEN RETURN jsonb_build_object('ok', false, 'motiv', 'obiectii_lipsa'); END IF;
    IF length(v_ob) > 4000 THEN RETURN jsonb_build_object('ok', false, 'motiv', 'obiectii_prea_lungi'); END IF;
  ELSE
    v_ob := NULL;
  END IF;
  v_deja := EXISTS (SELECT 1 FROM public.red_raspunsuri x WHERE x.detinator_id = r.detinator_id);
  INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, zi_sesiune_aleasa, obiectii_text, declaratie_confirmata, created_by)
  VALUES (r.detinator_id, 'online', p_optiune, CASE WHEN p_optiune = 'particip' THEN p_zi END, v_ob,
          CASE WHEN p_optiune = 'nu_particip_fara_obiectii' THEN true END, NULL)
  RETURNING id INTO v_id;
  INSERT INTO public.red_raspunsuri_meta (raspuns_id, ip_sau_sursa, user_agent, raw_payload)
  VALUES (v_id, nullif(v_ip, 'necunoscut'), left(p_user_agent, 500),
          jsonb_build_object('optiune', p_optiune, 'zi', p_zi, 'obiectii_caractere', coalesce(length(v_ob), 0),
                             'declaratie_confirmata', p_declaratie_confirmata, 'user_agent', left(p_user_agent, 500)));
  RETURN jsonb_build_object('ok', true, 'raspuns_id', v_id, 'optiune', p_optiune, 'deja_raspuns', v_deja)
         || CASE WHEN v_deja THEN jsonb_build_object('mesaj', 'Răspunsul anterior a fost înlocuit.') ELSE '{}'::jsonb END;
END $fn$;
COMMENT ON FUNCTION public.fn_red_raspuns_public(text, text, date, text, boolean, text) IS 'Redări, RPC public (anon): înregistrează răspunsul online (canal online, created_by NULL, IP din x-forwarded-for). Validări prin jsonb (token_invalid — la format greșit înainte de orice contor, la token inexistent / expirat după contorul IP; cheia de token se atinge doar pentru tokenuri existente; optiune_invalida — și pentru opțiunea retrasă nu_particip_cu_obiectii, din 17.11.2026, 20261226a; zi_invalida — particip cere o zi din sesiunile UAT-ului; declaratie_neconfirmata; obiectii_lipsa; obiectii_prea_lungi; prea_multe). Al doilea răspuns se acceptă (istoricul rămâne, ultimul contează) cu deja_raspuns = true. NU trimite mail/SMS, NU generează PV (decizia 6).';

-- ─── 4. Declarația: DEFAULT-ul nou + rândurile cu EXACT vechea valoare implicită (sub lock-ul pe red_proiecte) ─────────────────────
ALTER TABLE public.red_proiecte ALTER COLUMN text_declaratie
  SET DEFAULT 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.';
CREATE TEMP TABLE red_decl_20261226a (id uuid, cod text, versiune integer) ON COMMIT DROP;
-- marcajul EXECUȚIEI în rândurile de jurnal ale UPDATE-ului (r2, antet): claims LOCALE cu doar e-mailul = 'livrare:<nume>:<txid>'
DO $marcaj$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('email', 'livrare:' || current_setting('gazpet.livrare_migrare'))::text, true);
  IF auth.uid() IS NOT NULL OR auth.role() IS NOT NULL
     OR auth.jwt() IS DISTINCT FROM jsonb_build_object('email', 'livrare:20261226a_redari_predare_declaratie:' || txid_current()) THEN
    RAISE EXCEPTION '20261226a: marcajul executiei nu e cel asteptat (auth.uid / auth.role / auth.jwt)';
  END IF;
END $marcaj$;
WITH s AS (
  UPDATE public.red_proiecte pr
     SET text_declaratie = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.'
   WHERE pr.text_declaratie = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.'
  RETURNING pr.id, pr.cod, pr.versiune)
INSERT INTO red_decl_20261226a (id, cod, versiune) SELECT s.id, s.cod, s.versiune FROM s;
DO $marcaj_gata$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.jwt() IS NOT NULL OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION '20261226a: marcajul executiei a ramas in sesiune'; END IF;
END $marcaj_gata$;

-- ─── 5. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_rau text; v_n integer; v_j integer; v_def text; v_lista text; v_pers integer;
BEGIN
  -- marcajul execuției nu mai e în sesiune (restul tranzacției — runnerul — scrie fără el)
  IF nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL OR auth.jwt() IS NOT NULL THEN
    RAISE EXCEPTION '20261226a: postconditie: claims ramase in sesiune dupa UPDATE';
  END IF;
  -- corpurile noi (amprentele: AMPRENTE-NOI 20261226a — aceleași constante în revenire) + proprietățile
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      -- >>> AMPRENTE-NOI 20261226a
      ('public.fn_red_optiune_retrasa(text)', '212cdf9e3b9bbca29f4517444e5c5fbf', 'sql', false, 'i', 'boolean'),
      ('public.fn_red_raspunsuri_valideaza()', '49e20867bfb42325cb954e5858045d1a', 'plpgsql', true, 'v', 'trigger'),
      ('public.fn_red_raspuns_public(text,text,date,text,boolean,text)', 'f316b7a75a868c36ffe491d6628b0e98', 'plpgsql', true, 'v', 'jsonb')
      -- <<< AMPRENTE-NOI 20261226a
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
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261226a: postconditie: functiile (corp / proprietati) difera: %', v_rau; END IF;
  -- drepturile: funcțiile înlocuite = EXACT ACL-ul de dinainte; fn_red_optiune_retrasa = doar proprietarul (niciun rol al aplicației, nici PUBLIC)
  IF EXISTS (SELECT 1 FROM red_acl_20261226a a JOIN pg_proc p ON p.oid = to_regprocedure(a.functie)
              WHERE coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM a.acl)
     OR (SELECT count(*) FROM red_acl_20261226a) <> 2
     OR (SELECT coalesce(p.proacl, acldefault('f', p.proowner))::text FROM pg_proc p WHERE p.oid = 'public.fn_red_optiune_retrasa(text)'::regprocedure)
        IS DISTINCT FROM '{postgres=X/postgres}' THEN
    RAISE EXCEPTION '20261226a: postconditie: drepturile functiilor difera';
  END IF;
  -- triggerul a rămas cel din 20261126a (aceeași funcție, același tip)
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.red_raspunsuri'::regclass AND t.tgname = 'trg_red_raspunsuri_valideaza'
        AND t.tgfoid = 'public.fn_red_raspunsuri_valideaza()'::regprocedure AND t.tgtype = 23 AND t.tgenabled = 'O' AND t.tgqual IS NULL AND t.tgnargs = 0) <> 1 THEN
    RAISE EXCEPTION '20261226a: postconditie: triggerul de validare';
  END IF;
  -- predicatul: exact codul retras, nimic altceva (inclusiv NULL)
  IF public.fn_red_optiune_retrasa('nu_particip_cu_obiectii') IS NOT TRUE OR public.fn_red_optiune_retrasa('particip') IS NOT FALSE
     OR public.fn_red_optiune_retrasa('nu_particip_fara_obiectii') IS NOT FALSE OR public.fn_red_optiune_retrasa('constatare_teren') IS NOT FALSE
     OR public.fn_red_optiune_retrasa(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION '20261226a: postconditie: fn_red_optiune_retrasa';
  END IF;
  -- DEFAULT-ul = NOU; niciun rând cu VECHI
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie';
  IF v_def IS DISTINCT FROM quote_literal('Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.') || '::text' THEN
    RAISE EXCEPTION '20261226a: postconditie: DEFAULT-ul declaratiei (%)', coalesce(v_def, 'lipsa');
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_proiecte pr
              WHERE pr.text_declaratie = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.') THEN
    RAISE EXCEPTION '20261226a: postconditie: a ramas un proiect cu declaratia veche';
  END IF;
  -- evidența: un rând de jurnal pe FIECARE proiect schimbat (fără utilizator, CU MARCAJUL acestei execuții, în această tranzacție, VECHI -> NOU,
  -- doar textul și versiunea); pe red_proiecte niciun alt rând de jurnal cu marcajul (doar UPDATE-ul declarației l-a purtat; filtrul pe
  -- tabelă folosește indexul (tabela, inregistrare_id) — fără parcurgerea întregului jurnal sub lock)
  SELECT count(*) INTO v_n FROM red_decl_20261226a;
  SELECT count(*) INTO v_j FROM public.red_jurnal j
   WHERE j.tabela = 'red_proiecte' AND j.user_email = 'livrare:' || current_setting('gazpet.livrare_migrare');
  IF v_j IS DISTINCT FROM v_n THEN
    RAISE EXCEPTION '20261226a: postconditie: randurile de jurnal cu marcajul executiei (% fata de % proiecte schimbate)', v_j, v_n;
  END IF;
  SELECT count(*) INTO v_j FROM red_decl_20261226a s
   WHERE (SELECT count(*) FROM public.red_jurnal j
           WHERE j.tabela = 'red_proiecte' AND j.actiune = 'update' AND j.inregistrare_id = s.id AND j.user_id IS NULL AND j.created_at = now()
             AND j.user_email = 'livrare:' || current_setting('gazpet.livrare_migrare')
             AND j.date_vechi ->> 'text_declaratie' = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.'
             AND j.date_noi ->> 'text_declaratie' = 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.'
             AND (j.date_noi ->> 'versiune')::int = s.versiune
             AND (j.date_vechi - 'text_declaratie' - 'versiune') = (j.date_noi - 'text_declaratie' - 'versiune')
             AND j.date_noi = (SELECT to_jsonb(pr) FROM public.red_proiecte pr WHERE pr.id = s.id)) = 1;
  IF v_j IS DISTINCT FROM v_n THEN
    RAISE EXCEPTION '20261226a: postconditie: evidenta din red_jurnal (% din % proiecte schimbate)', v_j, v_n;
  END IF;
  SELECT string_agg(s.id::text || ' ' || s.cod || ' v' || s.versiune, '; ' ORDER BY s.cod) INTO v_lista FROM red_decl_20261226a s;
  SELECT count(*) INTO v_pers FROM public.red_proiecte pr
   WHERE pr.text_declaratie IS DISTINCT FROM 'Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.';
  RAISE NOTICE '20261226a: declaratia: % proiecte schimbate (id cod versiune: %), % cu text personalizat neatinse; marcajul executiei in red_jurnal.user_email: livrare:%',
    v_n, coalesce(v_lista, '-'), v_pers, current_setting('gazpet.livrare_migrare');
  RAISE NOTICE '20261226a: sfarsit la % ms de la BEGIN; lock-uri puternice tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::bigint / 1000.0);
END $post$;
