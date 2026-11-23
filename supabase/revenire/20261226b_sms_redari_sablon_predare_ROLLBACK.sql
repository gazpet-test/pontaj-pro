-- Revenire 20261226b_sms_redari_sablon_predare. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Readuce fn_sms_redari_sablon_model() și fn_sms_redari_sablon_versiune() la corpurile EXACTE din 20261130c (textul cu „redare”, versiunea
--   'provizoriu-2026-11-03'), cu aceleași proprietăți și același ACL. Starea EXACTĂ a migrării e verificată înainte (amprentele AMPRENTE-NOI
--   20261226b + proprietăți + ACL); altă stare = refuz, nimic schimbat.
-- Fără refuz pe date: nu se șterge nimic. Loturile create cu versiunea 'provizoriu-2026-11-17' devin, după revenire, 'sablon_neaprobat' (nu pleacă;
--   se anulează din SMS -> Istoric; NOTICE-ul le numără). Revenirea merge ÎMPREUNĂ cu revenirea constantei din src/sms/sablonRedari.js (altfel
--   crearea lotului e refuzată cu 40001: textul afișat diferă de cel recalculat — fail-closed).
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261226b_sms_redari_sablon_predare_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261226120101 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Lock-uri: niciunul pe tabele (doar rândurile din pg_proc). Probe: scripts/pglite/test_sms_sablon_predare_local.mjs.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261226b_sms_redari_sablon_predare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261226b revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261226b revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261226b revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261226b revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261226b revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF EXISTS (SELECT 1 FROM (VALUES
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
        OR coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres}')
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('fn_sms_redari_sablon_model', 'fn_sms_redari_sablon_versiune')) <> 2 THEN
    RAISE EXCEPTION '20261226b revenire: starea nu e cea din 20261226b (corp, proprietati, drepturi sau variante)';
  END IF;
END $pre$;

-- ─── corpurile EXACTE din 20261130c ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_model() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 'Gazpet pt Transgaz: sesiune redare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}'::text
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_sablon_model() IS 'SMS Redari (pura, interna): textul PROVIZORIU al sablonului fix, oglinda SABLON_REDARI din src/sms/sablonRedari.js. Se schimba doar printr-o migrare noua, impreuna cu constanta din UI si cu fn_sms_redari_sablon_versiune().';

CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_versiune() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 'provizoriu-2026-11-03'::text
$fn$;
COMMENT ON FUNCTION public.fn_sms_redari_sablon_versiune() IS 'SMS Redari (pura, interna): versiunea textului sablonului. provizoriu-* = textul NU e aprobat de Juridic + Razvan: comutatorul Redari nu se porneste (docs/sms/ACTIVARE_SMS_REDARI.md).';

DO $post$
DECLARE v_n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES
        ('public.fn_sms_redari_sablon_model()', '228429272ed678584a9410ba0a3bb326'),
        ('public.fn_sms_redari_sablon_versiune()', 'a95b87be01cbf56f72af91c691255dc3')
      ) a(semnatura, amprenta)
      LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
     WHERE p.oid IS NULL
        OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
        OR p.prosecdef OR p.provolatile IS DISTINCT FROM 'i'
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
        OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
        OR coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM '{postgres=X/postgres}')
     OR public.fn_sms_redari_sablon_versiune() IS DISTINCT FROM 'provizoriu-2026-11-03' THEN
    RAISE EXCEPTION '20261226b revenire: postconditie: corpurile 20261130c';
  END IF;
  SELECT count(*) INTO v_n FROM public.sms_loturi l
   WHERE l.categorie = 'redari' AND (l.filtru->>'sablon_versiune') IS DISTINCT FROM 'provizoriu-2026-11-03'
     AND (l.stare IN ('draft', 'aprobat', 'in_trimitere')
          OR (l.stare = 'coada_golita' AND EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'necunoscut')));
  RAISE NOTICE '20261226b revenire: loturi Redari active cu alta versiune decat provizoriu-2026-11-03: % (nu mai pleaca: sablon_neaprobat; de anulat din SMS -> Istoric)', v_n;
END $post$;
