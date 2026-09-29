-- ════════════════════════════════════════════════════════════════════════════
-- 20261001a — ROLLBACK TEHNIC: scoate garda J05 și REDESCHIDE J05
--   (cei 9 non-owneri pot din nou rescrie / retrage derogarea fără audit; după depunere derogare_* redevin editabile).
-- ARTEFACT FĂRĂ GO DE EXECUȚIE. NU e migrare: stă în supabase/revenire/ și nu îl parcurge niciun runner
-- (supabase/revenire/README.md). Folosire doar la cererea explicită a lui Răzvan, cu decizie și review
-- specifice (Copilot). Existența comutatorului de armare NU e autorizare.
-- Revenire fără gaură: un flux legitim refuzat de gardă îl face ownerul (JWT, înainte de depunere) sau
-- administrarea fără JWT, documentat — garda rămâne.
-- Ordinea: acest rollback ÎNAINTEA lui 20260929b_ofertare_derogare_audit_ROLLBACK.sql (acela face DROP COLUMN
-- derogare_motiv, pe care garda îl citește: cu garda instalată, orice UPDATE pe ofertare_licitatii ar cădea).
--
-- GESTIONARUL TRANZACȚIEI E OPERATORUL: fișierul NU conține BEGIN/COMMIT. Se trimite UN SINGUR string:
--   BEGIN;
--   SELECT set_config('gazpet.rollback_20261001a', 'SCOATE_GARDA_J05:' || txid_current(), true);
--   <acest fișier, întreg>
--   COMMIT;
-- Armarea e legată de tranzacția curentă (txid). Refuz (42501, nimic schimbat) pentru: armare persistentă
-- (ALTER DATABASE / ROLE … SET, în pg_db_role_setting, nume comparat cu lower()); armare lipsă, veche, de
-- sesiune (SET / set_config(…, false)) sau dintr-o tranzacție eșuată; stare care nu e patch sau live.
-- Tot fișierul e UN bloc DO. Precondiție: amprenta gărzii = patch (sau starea live ⇒ no-op).
-- Postcondiție înainte de COMMIT: stare = live exact. La final se dezarmează comutatorul.
-- ════════════════════════════════════════════════════════════════════════════
DO $rollback$
DECLARE
  v_q CONSTANT text := $amprente$
WITH ams(fn, sig, asteptat) AS (VALUES
  ('gate',     'public.fn_gate_depunere()',                              'src=4bddf68cfe53107a622d210f4ef3ec51 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres,service_role=X/postgres}'),
  ('rpc',      'public.ofertare_derogare_depunere(bigint,text,boolean)', 'src=50656c3c958e3a822c9ea1c3f70ae7d9 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=(p_licitatie_id bigint, p_motiv text, p_acorda boolean DEFAULT true) rez=void acl={authenticated=X/postgres,postgres=X/postgres}'),
  ('a00',      'public.fn_ofertare_licitatii_scriere()',                 'src=7d7591ef2bd5143ace505b85b1010977 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres,service_role=X/postgres}'),
  ('acces',    'public.fn_are_acces_ofertare()',                         'src=429d28e2a61fb24c8009d67050c16c85 secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=sql vol=s strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=boolean acl={authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
  ('owner',    'public.fn_gate_depunere_derogare_owner()',               'src=e97f091143d6b492b6fdedf03dd283ea secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=sql vol=s strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=boolean acl={postgres=X/postgres,service_role=X/postgres}'),
  ('imuabil',  'public.fn_ofertare_derogari_audit_imuabil()',            'src=22bab03fb862ae7fbd95538aa4bd6b28 secdef=f cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}'),
  ('garda',    'public.fn_ofertare_derogare_garda_j05()',                'src=f84c9aeeb80fd990ee6f5110865a1aac secdef=t cfg={"search_path=public, pg_temp"} owner=postgres lang=plpgsql vol=v strict=f leak=f par=u cost=100 rows=0 n=1 args=() rez=trigger acl={postgres=X/postgres}')
), fn AS (
  SELECT a.fn, a.asteptat,
    (SELECT format('src=%s secdef=%s cfg=%s owner=%s lang=%s vol=%s strict=%s leak=%s par=%s cost=%s rows=%s n=%s args=(%s) rez=%s acl=%s',
        md5(p.prosrc), CASE WHEN p.prosecdef THEN 't' ELSE 'f' END, p.proconfig::text, pg_get_userbyid(p.proowner), l.lanname,
        p.provolatile, CASE WHEN p.proisstrict THEN 't' ELSE 'f' END, CASE WHEN p.proleakproof THEN 't' ELSE 'f' END,
        p.proparallel, p.procost, p.prorows,
        (SELECT count(*) FROM pg_catalog.pg_proc q WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname),
        pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
        (SELECT array_agg(x::text ORDER BY x::text COLLATE "C") FROM unnest(coalesce(p.proacl, acldefault('f', p.proowner))) x)::text)
     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE p.oid = to_regprocedure(a.sig)) AS gasit
  FROM ams a
), trg AS (
  SELECT c.relname AS tabel,
         string_agg(format('%s:%s.%s type=%s en=%s qual_null=%s attr=%s', t.tgname, n.nspname, p.proname, t.tgtype,
                           t.tgenabled, t.tgqual IS NULL, t.tgattr::text), ';' ORDER BY t.tgname COLLATE "C") AS gasit
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE t.tgrelid IN ('public.ofertare_licitatii'::regclass, 'public.ofertare_derogari_audit'::regclass) AND NOT t.tgisinternal
  GROUP BY c.relname
)
SELECT
  (SELECT jsonb_object_agg(fn, gasit IS NOT DISTINCT FROM asteptat) FROM fn) AS fn_ok,
  (SELECT string_agg(format('%s: %s', fn, coalesce(gasit, 'LIPSĂ')), E'\n' ORDER BY fn) FROM fn WHERE gasit IS DISTINCT FROM asteptat) AS fn_dif,
  (SELECT gasit FROM trg WHERE tabel = 'ofertare_licitatii') AS trg_licitatii,
  (SELECT gasit FROM trg WHERE tabel = 'ofertare_derogari_audit') AS trg_audit,
  (SELECT format('%s|%s|%s', c.contype, c.conkey::text, md5(pg_get_constraintdef(c.oid))) FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.ofertare_derogari_audit'::regclass AND c.conname = 'ofertare_derogari_audit_actiune_check') AS chk,
  (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid = 'public.ofertare_licitatii'::regclass AND NOT attisdropped
     AND ((attname = 'derogare_depunere' AND atttypid = 'boolean'::regtype AND attnotnull)
       OR (attname = 'derogare_motiv' AND atttypid = 'text'::regtype)
       OR (attname = 'status' AND atttypid = 'text'::regtype)))
   + (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid = 'public.profiles'::regclass AND NOT attisdropped
     AND attname = 'is_owner' AND atttypid = 'boolean'::regtype) AS coloane
$amprente$;
  r record;
  v_garda_exista boolean;
BEGIN
  -- 1. Armare persistentă = refuz (numele GUC nu ține cont de majuscule).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) = 'gazpet.rollback_20261001a') THEN
    RAISE EXCEPTION 'ROLLBACK 20261001a blocat: comutatorul e armat PERSISTENT (pg_db_role_setting). Șterge setarea cu ALTER DATABASE/ROLE … RESET; armarea se face doar în tranzacția rollback-ului.'
      USING ERRCODE = '42501';
  END IF;
  -- 2. Armare legată de tranzacția curentă.
  IF current_setting('gazpet.rollback_20261001a', true) IS DISTINCT FROM ('SCOATE_GARDA_J05:' || txid_current()::text) THEN
    RAISE EXCEPTION 'ROLLBACK 20261001a blocat: nearmat în tranzacția curentă (redeschide J05). Doar la cererea explicită a lui Răzvan, într-un singur string: BEGIN; SELECT set_config(''gazpet.rollback_20261001a'', ''SCOATE_GARDA_J05:'' || txid_current(), true); <fișierul>; COMMIT;'
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- 3. Precondiție: stare completă cunoscută (patch, sau live ⇒ nimic de retras).
  v_garda_exista := to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL;
  EXECUTE v_q INTO r;
  IF NOT v_garda_exista AND r.trg_licitatii IS NOT DISTINCT FROM 'a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=' THEN
    PERFORM set_config('gazpet.rollback_20261001a', '', false);
    RAISE NOTICE 'ROLLBACK 20261001a: starea e deja live (fără gardă); nimic de retras.';
    RETURN;
  END IF;
  IF NOT (v_garda_exista AND (r.fn_ok ->> 'garda') IS NOT DISTINCT FROM 'true'
          AND r.trg_licitatii IS NOT DISTINCT FROM 'a00_ofertare_derogare_garda_j05:public.fn_ofertare_derogare_garda_j05 type=19 en=O qual_null=t attr=;a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=') THEN
    RAISE EXCEPTION 'ROLLBACK 20261001a refuzat: garda / triggerele nu sunt exact versiunea patch-ului (triggere=%). Nu retrag o versiune neauditată.', coalesce(r.trg_licitatii, 'NULL')
      USING ERRCODE = '42501', DETAIL = coalesce(r.fn_dif, '-');
  END IF;

  DROP TRIGGER a00_ofertare_derogare_garda_j05 ON public.ofertare_licitatii;
  DROP FUNCTION public.fn_ofertare_derogare_garda_j05();

  -- 4. Postcondiție înainte de COMMIT: exact starea live (funcțiile porții neatinse, triggerele live).
  EXECUTE v_q INTO r;
  IF to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL
     OR r.trg_licitatii IS DISTINCT FROM 'a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr='
     OR (SELECT bool_and(v::boolean) FROM jsonb_each_text(r.fn_ok - 'garda') AS e(k, v)) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Postcondiție ROLLBACK 20261001a: starea rezultată nu e exact live 30.09. Nimic nu se comite.'
      USING DETAIL = coalesce(r.fn_dif, '-');
  END IF;
  -- 5. Dezarmare (și varianta de sesiune).
  PERFORM set_config('gazpet.rollback_20261001a', '', false);
  RAISE WARNING 'ROLLBACK 20261001a aplicat: garda J05 retrasă. J05 e din nou DESCHIS.';
END $rollback$;
