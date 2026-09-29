-- ════════════════════════════════════════════════════════════════════════════
-- 20261001a — J05 GARDA (prevenție): derogare_depunere / derogare_motiv nu se mai schimbă
-- decât de owner (JWT, înainte de depunere) sau de administrare fără JWT; înghețate după depunere.
--
-- Finding J05 (OPEN, severitate ridicată; verdict Copilot 30.09: detecția nu ajunge, trebuie prevenție
-- autorizată separat, inclusiv DUPĂ depunere). Live 30.09 (PG 17.6, citit read-only din cataloage):
-- cei 9 non-owneri cu modul Ofertare pot rescrie motivul sau retrage derogarea fără audit, iar
-- depusa_pe_derogare copiază coloana editabilă la depunere.
--
-- Ce face: trigger BEFORE UPDATE, PRIMUL din lanț (a00_ofertare_derogare_garda_j05). Dacă derogare_*
-- se schimbă (IS DISTINCT FROM), trec DOAR: (1) postgres / supabase_admin fără claims JWT (reparații
-- documentate, inclusiv după depunere); (2) claims role=authenticated cu sub = profil is_owner, cât timp
-- OLD.status <> 'depusa'. Orice altceva → 42501. Fără ramura „auth.uid() IS NULL ⇒ sistem” (model S-A).
--
-- Aliniere la standardul Copilot (30.09, după NO-GO pe #537/#538 runda 2):
--   • amprente independente de versiunea PG: md5(prosrc) (textul literal al corpului, identic PG16/PG17,
--     citit read-only din live) + atribute explicite (SECURITY DEFINER, proconfig exact, proprietar, limbaj,
--     volatilitate, STRICT/LEAKPROOF/PARALLEL/COST/ROWS, fără supraîncărcări, argumente, tip întors, ACL
--     sortat). Triggerele: câmpuri structurale (nume, funcția țintă, tgtype, tgenabled, tgqual IS NULL,
--     tgattr). CHECK-ul pe actiune: contype + conkey + md5(pg_get_constraintdef) — md5-ul e citit din live
--     (PG17) și coincide cu PG16; dacă o versiune viitoare deparsează altfel, precondiția REFUZĂ (fail-closed):
--     operatorul compară textul CHECK-ului cu cel din antet și actualizează amprenta doar prin commit revizuit;
--   • toate comparațiile sunt NULL-safe (IS DISTINCT FROM); obiect lipsă = NULL = refuz;
--   • stări COMPLETE: live (fără gardă) sau patch (reaplicare, no-op); orice stare mixtă e refuzată;
--   • postcondiție ÎNAINTE de COMMIT: amprente + privilegii EFECTIVE (has_function_privilege pentru anon,
--     authenticated, PUBLIC pe gardă și pe funcțiile de trigger ale porții);
--   • NICIO listă albă nu se actualizează automat după apply.
--
-- Ce NU face (docs/AUDIT_OFERTARE_V2/J05_GARDA_PATCH.md): nu atinge date, poarta, RPC-ul, auditul;
-- GOL: retragerea / schimbarea motivului de către OWNER prin UPDATE direct nu lasă audit; INSERT neacoperit;
-- înghețul e legat de status='depusa'.
--
-- ⚠ NU SE APLICĂ fără: GO Copilot + acordul explicit al lui Răzvan + EXCEPȚIE DE FREEZE pe Ofertare.
-- ⚠ GESTIONARUL TRANZACȚIEI E ACEST FIȘIER (BEGIN; … COMMIT;). Se trimite ÎNTREG, cu LF. Comportament
--   demonstrat în scripts/test_j05_garda.sh pe 3 runnere: psql -f (ON_ERROR_STOP), un singur simple query
--   (psql -c) și runner cu BEGIN propriu + INSERT în supabase_migrations.schema_migrations în același string;
--   eroare injectată după prima schimbare sau în postcondiție ⇒ stare inițială, migrare neînregistrată.
--   La runner-ul cu BEGIN propriu, BEGIN-ul de mai jos dă WARNING, iar COMMIT-ul de aici îi închide tranzacția.
-- Revenire: NU e în acest director — supabase/revenire/20261001a_ofertare_derogare_garda_j05_ROLLBACK.sql
--   (rollback tehnic, redeschide J05; armare legată de txid, doar la cererea explicită a lui Răzvan).
-- Test: scripts/test_j05_garda.sh + supabase/tests/j05_garda.test.sql (PG16 local, copia definițiilor live).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

-- ── 0. Precondiții (înainte de orice DDL) ────────────────────────────────────────
DO $pre$
DECLARE
  -- Aceeași interogare de amprente în migrare, în postcondiție și în rollback (harness-ul verifică identitatea textului).
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
  v_garda_exista boolean := to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL;
BEGIN
  EXECUTE v_q INTO r;
  -- 1. Funcțiile de care depinde garda: exact live 30.09 (md5(prosrc) + atribute + ACL), NULL-safe.
  IF (r.fn_ok ->> 'gate') IS DISTINCT FROM 'true' OR (r.fn_ok ->> 'rpc') IS DISTINCT FROM 'true'
     OR (r.fn_ok ->> 'a00') IS DISTINCT FROM 'true' OR (r.fn_ok ->> 'acces') IS DISTINCT FROM 'true'
     OR (r.fn_ok ->> 'owner') IS DISTINCT FROM 'true' OR (r.fn_ok ->> 'imuabil') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Precondiție 20261001a: funcțiile de care depinde garda diferă de starea auditată 30.09. Recitește live și reauditează.'
      USING ERRCODE = '55000', DETAIL = coalesce(r.fn_dif, '-');
  END IF;
  -- 2. Stare COMPLETĂ cunoscută: live (fără gardă) sau patch (reaplicare). Stările mixte se refuză.
  IF NOT ((NOT v_garda_exista AND r.trg_licitatii IS NOT DISTINCT FROM 'a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=')
       OR (v_garda_exista AND (r.fn_ok ->> 'garda') IS NOT DISTINCT FROM 'true'
           AND r.trg_licitatii IS NOT DISTINCT FROM 'a00_ofertare_derogare_garda_j05:public.fn_ofertare_derogare_garda_j05 type=19 en=O qual_null=t attr=;a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr=')) THEN
    RAISE EXCEPTION 'Precondiție 20261001a: starea nu e nici live 30.09, nici patch-ul (gardă prezentă=%, triggere=%). Nu suprascriu o stare necunoscută.', v_garda_exista, coalesce(r.trg_licitatii, 'NULL')
      USING ERRCODE = '55000', DETAIL = coalesce(r.fn_dif, '-');
  END IF;
  -- 3. Auditul J05: triggerul append-only, CHECK-ul pe actiune (contype, conkey, md5 al textului CHECK — vezi antet), coloanele.
  IF r.trg_audit IS DISTINCT FROM 'trg_ofertare_derogari_audit_imuabil:public.fn_ofertare_derogari_audit_imuabil type=58 en=O qual_null=t attr='
     OR r.chk IS DISTINCT FROM 'c|{3}|ccb3f643d993ae9d68284aca20a58366'
     OR r.coloane IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Precondiție 20261001a: auditul (trigger append-only / CHECK actiune) sau coloanele nu sunt cele auditate (trigger=%, check=%, coloane=%).', coalesce(r.trg_audit, 'NULL'), coalesce(r.chk, 'NULL'), r.coloane
      USING ERRCODE = '55000';
  END IF;
END $pre$;

-- ── 1. Garda ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ofertare_derogare_garda_j05()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- J05-20261001a: garda derogării de depunere (prevenție). Identitate explicită, modelul S-A (20260929g),
-- fără ramura „auth.uid() IS NULL ⇒ sistem”. Detalii: docs/AUDIT_OFERTARE_V2/J05_GARDA_PATCH.md.
DECLARE
  v_claims jsonb;
  v_rol    text;
  v_sub    text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;                                   -- garda e definită doar pe UPDATE
  END IF;
  IF NEW.derogare_depunere IS NOT DISTINCT FROM OLD.derogare_depunere
     AND NEW.derogare_motiv IS NOT DISTINCT FROM OLD.derogare_motiv THEN
    RETURN NEW;                                   -- derogare_* neschimbate: garda nu intervine
  END IF;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''),
                       nullif(current_setting('request.jwt.claim', true), ''))::jsonb;
  v_rol := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), v_claims ->> 'role');
  v_sub := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_claims ->> 'sub');

  IF v_rol IS NULL AND v_sub IS NULL THEN
    -- Fără context de cerere = conexiune directă la BD. Trec DOAR login-urile de administrare
    -- (migrări MCP/CLI, SQL editor, pg_cron), inclusiv după depunere: reparații documentate.
    IF session_user IN ('postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan); conexiune fără identitate autorizată: %.', session_user
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'depusa' THEN
    RAISE EXCEPTION 'J05: licitația % este depusă; derogare_depunere / derogare_motiv sunt înghețate după depunere, inclusiv pentru owner.', OLD.id
      USING ERRCODE = '42501';
  END IF;

  IF v_rol = 'authenticated' AND v_sub IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id::text = v_sub AND is_owner IS TRUE) THEN
    RETURN NEW;                                   -- ownerul prin JWT, înainte de depunere
  END IF;
  RAISE EXCEPTION 'J05: derogare_depunere / derogare_motiv le poate schimba doar ownerul (Razvan), prin ofertare_derogare_depunere.'
    USING ERRCODE = '42501';
END $function$;

-- Funcție de trigger: nu e apelabilă din API (triggerul rulează fără EXECUTE pentru apelant).
REVOKE ALL ON FUNCTION public.fn_ofertare_derogare_garda_j05() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER a00_ofertare_derogare_garda_j05
  BEFORE UPDATE ON public.ofertare_licitatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_derogare_garda_j05();

COMMENT ON FUNCTION public.fn_ofertare_derogare_garda_j05() IS
  'J05 20261001a: derogare_depunere / derogare_motiv se schimbă doar de owner (JWT authenticated, înainte de depunere) sau de login-urile postgres/supabase_admin fără claims; după status=depusa sunt înghețate și pentru owner.';

-- ── 2. Postcondiție (în aceeași tranzacție) ────────────────────────────────────────
DO $post$
DECLARE
  -- Aceeași interogare de amprente în migrare, în postcondiție și în rollback (harness-ul verifică identitatea textului).
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
  v_garda_exista boolean := to_regprocedure('public.fn_ofertare_derogare_garda_j05()') IS NOT NULL;
BEGIN
  EXECUTE v_q INTO r;
  -- Postcondiție ÎNAINTE de COMMIT: dacă pică, se anulează tot (inclusiv garda).
  IF (SELECT bool_and(v::boolean) FROM jsonb_each_text(r.fn_ok) AS e(k, v)) IS DISTINCT FROM true
     OR (SELECT count(*) FROM jsonb_object_keys(r.fn_ok)) IS DISTINCT FROM 7::bigint
     OR r.trg_licitatii IS DISTINCT FROM 'a00_ofertare_derogare_garda_j05:public.fn_ofertare_derogare_garda_j05 type=19 en=O qual_null=t attr=;a00_ofertare_licitatii_scriere:public.fn_ofertare_licitatii_scriere type=19 en=O qual_null=t attr=;trg_gate_depunere:public.fn_gate_depunere type=23 en=O qual_null=t attr='
     OR r.trg_audit IS DISTINCT FROM 'trg_ofertare_derogari_audit_imuabil:public.fn_ofertare_derogari_audit_imuabil type=58 en=O qual_null=t attr='
     OR r.chk IS DISTINCT FROM 'c|{3}|ccb3f643d993ae9d68284aca20a58366' THEN
    RAISE EXCEPTION 'Postcondiție 20261001a: starea rezultată nu e exact patch-ul (triggere=%).', coalesce(r.trg_licitatii, 'NULL')
      USING DETAIL = coalesce(r.fn_dif, '-');
  END IF;
  -- Privilegii EFECTIVE (includ PUBLIC și moștenirea): funcțiile de trigger nu sunt executabile din API.
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'public']) AS ro(rol),
                           unnest(ARRAY['public.fn_ofertare_derogare_garda_j05()', 'public.fn_gate_depunere()',
                                        'public.fn_ofertare_licitatii_scriere()', 'public.fn_gate_depunere_derogare_owner()',
                                        'public.fn_ofertare_derogari_audit_imuabil()']) AS f(sig)
             WHERE has_function_privilege(ro.rol, f.sig, 'EXECUTE') IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'Postcondiție 20261001a: o funcție de trigger (garda sau helperii porții) e executabilă de anon / authenticated / PUBLIC.';
  END IF;
END $post$;

COMMIT;
