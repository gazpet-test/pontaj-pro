-- Version 20261226120100. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261226b_sms_redari_sablon_predare.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ v2 a runnerului; manifestul .l15.tsv îl generează coordonatorul pe clonă,
--   lista OBIECTELOR (familie, etichetă, operație — verificată pe PGlite cu pașii reali ai runnerului) e în
--   supabase/tests/20261226b_sms_redari_sablon_predare.l15.obiecte.tsv. Migrarea verifică în plus pe amprentă (corp + proprietăți + drepturi,
--   înainte și după) cele două funcții pe care le înlocuiește și funcțiile care le folosesc.
-- 20261226b_sms_redari_sablon_predare — SMS Redări, terminologia „predare” (decizia proprietarului, 17.11.2026): șablonul fix spune „sesiune
--   PREDARE teren” în loc de „sesiune redare teren”; restul textului identic. Oglinda JS: SABLON_REDARI / SABLON_REDARI_VERSIUNE din
--   src/sms/sablonRedari.js (aceeași livrare; testul de paritate JS <-> SQL: scripts/pglite/test_sms_sablon_predare_local.mjs).
--   * fn_sms_redari_sablon_model() = 'Gazpet pt Transgaz: sesiune predare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}';
--   * fn_sms_redari_sablon_versiune() = 'provizoriu-2026-11-17': textul RĂMÂNE PROVIZORIU (neaprobat încă de beneficiar). Regulile nu se schimbă
--     (fn_sms_redari_sablon_aprobat neatinsă): o versiune provizoriu-* trece doar pe proiectele TEST-% cu 1-5 destinatari, iar comutatorul
--     Redări nu se pornește pe o versiune provizorie (docs/sms/ACTIVARE_SMS_REDARI.md);
--   * lungimea GSM-7 crește cu 1 caracter; cazurile de paritate P1-P15 rămân în aceleași condiții (un segment, P10 tot „prea_lung”).
-- Loturile existente: un lot creat înainte (filtru.sablon_versiune = 'provizoriu-2026-11-03', textul cu „redare”) e REFUZAT după migrare la
--   aprobare, la fiecare rezervare și de cron (fn_sms_redari_lot_motiv_la: 'sablon_neaprobat', versiunea nu mai e cea curentă; textul recalculat
--   diferă oricum: 'text_schimbat'); nicio rezervare NOUĂ din el. r2 (review #1119 P2): un worker sms-trimite care a REZERVAT mesaje înainte
--   de COMMIT le trimite după, cu textul vechi (trimiterea nu reverifică versiunea; funcția edge nu se schimbă) — garanția e valabilă doar
--   pentru rezervările făcute după schimbare; de aceea, ÎNAINTE de aplicare, procedura din docs/sms/LIVRARE_20261226b_SABLON_PREDARE.md §3
--   (comutatorul Redări oprit = nicio rezervare Redări; nicio rundă în curs, verificat doar-citire). Loturile Redări pot exista doar pe proiecte TEST-% (versiune provizorie).
--   Cât un astfel de lot rămâne „activ” (draft / aprobat / in_trimitere, sau coada_golita cu mesaje „necunoscut”) el ocupă UAT-ul (un singur lot
--   Redări activ pe UAT) → PASUL DE CURĂȚARE (doar descris, nu executat aici): operatorul anulează din SMS → Istoric loturile numărate în
--   NOTICE-ul de mai jos, apoi le recreează din șablon. Un lot creat în cele câteva secunde ale aplicării poate primi versiunea veche: același
--   refuz, aceeași anulare.
-- Ce NU face: nicio dată, niciun drept, nicio schimbare de reguli (aprobare, eligibilitate, trimitere); nu pornește comutatorul; niciun SMS.
-- ORDINEA (aceeași în ambele documente de livrare): 20261226a -> 20261226b -> publicarea coordonată #1117 + #1119 -> reîncărcarea formularului
--   public pe proiectul de test. Publicarea #1119 (constanta JS) ÎNAINTEA acestei migrări e interzisă: JS nou + SQL vechi = textul afișat diferă
--   de cel recalculat, crearea loturilor Redări refuzată (40001, fail-closed). Detalii: docs/sms/LIVRARE_20261226b_SABLON_PREDARE.md.
-- Lock-uri: NICIUN lock pe tabele (CREATE OR REPLACE FUNCTION ia doar rândul din pg_proc). sms_loturi / sms_mesaje / red_* doar citite
--   (ACCESS SHARE, NOTICE-ul loturilor). Fără bloc de lock: garda finală a runnerului afișează LOCK_TINUT „nedeclarat”.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, garda finală.
-- Revenire: supabase/revenire/20261226b_sms_redari_sablon_predare_ROLLBACK.sql. Probe: scripts/pglite/test_sms_sablon_predare_local.mjs.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261226b_sms_redari_sablon_predare:' || txid_current() THEN
    RAISE EXCEPTION '20261226b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261226b: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261226b: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261226b: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261226b: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261225a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261226b: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz (versiunea e deja cea nouă)
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_redari_sablon_versiune()')
               AND md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM 'a95b87be01cbf56f72af91c691255dc3'
               AND p.prosrc LIKE '%provizoriu-2026-11-17%') THEN
    RAISE EXCEPTION '20261226b: versiunea sablonului e deja provizoriu-2026-11-17 (reaplicare)';
  END IF;
  -- funcțiile înlocuite = EXACT cele din 20261130c (corp fără CR + proprietăți); cele care le folosesc, neschimbate (aceleași corpuri ca în 20261130c)
  IF EXISTS (SELECT 1 FROM (VALUES
        ('public.fn_sms_redari_sablon_model()', '228429272ed678584a9410ba0a3bb326', 'sql', false, 'i', 'text'),
        ('public.fn_sms_redari_sablon_versiune()', 'a95b87be01cbf56f72af91c691255dc3', 'sql', false, 'i', 'text'),
        ('public.fn_sms_redari_sablon_calc(text,date[],text[],text,timestamp)', '45e1189c4d887ca36fb3707df701a8ad', 'plpgsql', false, 'i', 'jsonb'),
        ('public.fn_sms_redari_sablon_aprobat(text,text,uuid,integer)', '549e00f42578299142a97c84f6663145', 'sql', true, 's', 'boolean')
      ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce)
      LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
     WHERE p.oid IS NULL
        OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
        OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
        OR p.prosecdef IS DISTINCT FROM a.definer OR p.provolatile IS DISTINCT FROM a.volatil
        OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
        OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
        OR coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres}')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('fn_sms_redari_sablon_model', 'fn_sms_redari_sablon_versiune')) <> 2 THEN
    RAISE EXCEPTION '20261226b: functiile sablonului nu sunt cele din 20261130c (corp, proprietati, drepturi sau variante)';
  END IF;
  -- textul folosit în GSM-7: verificarea din 20261130a (amprenta confirmată pe producție la 20261130c)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_sms_text_verifica(text)')
                   AND md5(replace(p.prosrc, chr(13), '')) = 'fb828f896937261687a9b2c386284218') THEN
    RAISE EXCEPTION '20261226b: fn_sms_text_verifica nu e cea din 20261130a';
  END IF;
END $pre$;

-- ─── 1. Modelul și versiunea (CREATE OR REPLACE păstrează proprietarul și ACL-ul; postcondiția le verifică) ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_model() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 'Gazpet pt Transgaz: sesiune predare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}'::text
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_sablon_model() IS 'SMS Redari (pura, interna): textul PROVIZORIU al sablonului fix (terminologia „predare”, 17.11.2026, 20261226b), oglinda SABLON_REDARI din src/sms/sablonRedari.js. Se schimba doar printr-o migrare noua, impreuna cu constanta din UI si cu fn_sms_redari_sablon_versiune().';

CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_versiune() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 'provizoriu-2026-11-17'::text
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_sablon_versiune() IS 'SMS Redari (pura, interna): versiunea textului sablonului (20261226b: provizoriu-2026-11-17, textul cu „predare”). provizoriu-* = textul NU e aprobat: comutatorul Redari nu se porneste (docs/sms/ACTIVARE_SMS_REDARI.md).';

-- ─── 2. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_rau text; v_j jsonb; v_loturi text; v_n integer;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      -- >>> AMPRENTE-NOI 20261226b
      ('public.fn_sms_redari_sablon_model()', '13e27c6f3e4202c36259948a92ee19ac'),
      ('public.fn_sms_redari_sablon_versiune()', '46f62d7d8964fed49465a4e96edc9c4a')
      -- <<< AMPRENTE-NOI 20261226b
    ) a(semnatura, amprenta)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = 'sql')
      OR p.prosecdef OR p.provolatile IS DISTINCT FROM 'i' OR p.prorettype IS DISTINCT FROM 'text'::regtype
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres}';
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261226b: postconditie: functiile sablonului (corp / proprietati / drepturi): %', v_rau; END IF;
  IF public.fn_sms_redari_sablon_model() IS DISTINCT FROM 'Gazpet pt Transgaz: sesiune predare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}'
     OR public.fn_sms_redari_sablon_versiune() IS DISTINCT FROM 'provizoriu-2026-11-17' THEN
    RAISE EXCEPTION '20261226b: postconditie: modelul / versiunea';
  END IF;
  -- completarea de control (cazul P2 al testelor de paritate): textul nou, GSM-7, un segment
  v_j := public.fn_sms_redari_sablon_calc('Jupa', ARRAY['2026-11-05', '2026-11-12', NULL]::date[], ARRAY['08:00-12:00', '9.30 - 15:00', NULL], '0700000112', '2026-11-10 08:00');
  IF v_j->>'text' IS DISTINCT FROM 'Gazpet pt Transgaz: sesiune predare teren la Primaria Jupa, 12.11 ora 09:30. Raspuns si online, cu QR-ul din scrisoare. Tel 0700000112'
     OR (v_j->>'ok')::boolean IS NOT TRUE OR (v_j->>'lungime')::integer IS DISTINCT FROM 134 THEN
    RAISE EXCEPTION '20261226b: postconditie: completarea de control %', v_j;
  END IF;
  -- versiunea rămâne provizorie: niciun lot pe un proiect real; versiunea veche nu mai trece nicăieri
  IF public.fn_sms_redari_sablon_aprobat(public.fn_sms_redari_sablon_versiune(), public.fn_sms_redari_sablon_versiune(), NULL, 1) IS NOT FALSE
     OR public.fn_sms_redari_sablon_aprobat('provizoriu-2026-11-03', public.fn_sms_redari_sablon_versiune(), NULL, 1) IS NOT FALSE
     OR left(public.fn_sms_redari_sablon_versiune(), 10) IS DISTINCT FROM 'provizoriu' THEN
    RAISE EXCEPTION '20261226b: postconditie: versiunea trebuie sa ramana provizorie';
  END IF;
  -- loturile Redări „active” cu versiunea veche: de anulat din SMS -> Istoric (pasul de curățare, doar descris)
  SELECT count(*), string_agg(l.id::text || ' ' || l.stare, '; ' ORDER BY l.id) INTO v_n, v_loturi
    FROM public.sms_loturi l
   WHERE l.categorie = 'redari' AND (l.filtru->>'sablon_versiune') IS DISTINCT FROM public.fn_sms_redari_sablon_versiune()
     AND (l.stare IN ('draft', 'aprobat', 'in_trimitere')
          OR (l.stare = 'coada_golita' AND EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'necunoscut')));
  RAISE NOTICE '20261226b: loturi Redari active cu alta versiune decat provizoriu-2026-11-17: % (%; nu mai pleaca: sablon_neaprobat; de anulat din SMS -> Istoric)',
    v_n, coalesce(v_loturi, '-');
  RAISE NOTICE '20261226b: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
