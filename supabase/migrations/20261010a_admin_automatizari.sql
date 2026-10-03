-- ════════════════════════════════════════════════════════════════════════════
-- 20261010a_admin_automatizari — DRAFT r2, NEAPLICAT. Registrul automatizărilor ca tabel (pagina Administrator › ⚙️ Automatizări).
-- r2 (03.10.2026, NO-GO Copilot pe aeac75b): service_role fără niciun drept (scrie DOAR postgres, proprietarul); secvența
--   identity fără drepturi pentru PUBLIC/anon/authenticated/service_role; postcondiție ACL EXACTĂ (aclexplode) pe tabel și
--   secvență; precondiția helperului de trigger pin-uită complet; coloana secrete → secrete_nume; revenirea refuză dacă
--   tabelul are rânduri, fără a doua armare separată pentru date.
-- Cerere Răzvan 03.10.2026: „o pagină cu toate automatizările, în modulul administratorului, și regula ca după orice
--   automatizare să o trecem în pagină” (varianta A: tabel nou + tab). Regula intră în CLAUDE.md pct. 7.
-- Ce face:
--   1. public.automatizari — un rând per automatizare (rutină Claude, cron pg_cron, edge function automată, trigger BD
--      notabil, script pe PC/NAS, webhook, extern), cu fișa de securitate a–e din CLAUDE.md pct. 7 pe coloane.
--      NU conține valori de secrete — doar NUMELE lor (coloana secrete_nume).
--   2. RLS OWNER-ONLY: SELECT doar pentru fn_is_app_owner(auth.uid()). Fără politici de scriere ⇒ din UI e read-only;
--      rândurile le scrie Claude prin execute_sql (postgres, proprietarul tabelului) după fiecare automatizare nouă.
--   3. ACL explicit: live, ALTER DEFAULT PRIVILEGES dă tabelelor/secvențelor noi drepturi largi ⇒ REVOKE ALL de la
--      PUBLIC/anon/authenticated/service_role pe tabel ȘI pe secvența identity; apoi doar SELECT pentru authenticated
--      (filtrat de RLS). service_role NU primește nimic: niciun edge/backend nu scrie în registru.
--   4. updated_at prin fn_comercial_touch_updated_at() existent (același model ca contracte_terti).
-- Precondiții (fail-closed): postgres; tabelul nu există; fn_is_app_owner(uuid) exact (unică, owner postgres, md5 8d335ed3…,
--   SECDEF, STABLE, search_path, fără EXECUTE anon); fn_comercial_touch_updated_at() exact (unică, owner postgres, plpgsql,
--   md5 5bdc21b8…, SECURITY INVOKER, VOLATILE, search_path).
-- Postcondiții: RLS activ, exact 1 politică (SELECT, authenticated, fn_is_app_owner), ACL EXACT pe tabel (doar owner +
--   authenticated=SELECT) și pe secvență (doar owner), trigger-ul de touch.
-- Popularea inițială NU e în migrare (date): Claude o face după aplicare, cu preview → „da” (seed separat).
-- Revenire (NU e migrare): supabase/revenire/20261010a_admin_automatizari_ROLLBACK.sql
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT. Gate 0e = 0.
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261010a_admin_automatizari:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261010a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user; END IF;
  IF to_regclass('public.automatizari') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: public.automatizari există deja — nimic aplicat';
  END IF;
  IF to_regprocedure('public.fn_is_app_owner(uuid)') IS NULL
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_is_app_owner(uuid)'::regprocedure) IS DISTINCT FROM '8d335ed3fe345d3bf95ef0f1b2f8850a'
     OR NOT (SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.fn_is_app_owner(uuid)'::regprocedure)
     OR has_function_privilege('anon', 'public.fn_is_app_owner(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_is_app_owner(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Precondiție 0c: public.fn_is_app_owner(uuid) lipsește sau diferă de cea live (md5/SECDEF/STABLE/search_path/ACL)';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'fn_is_app_owner') <> 1
     OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.fn_is_app_owner(uuid)'::regprocedure)) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0c: fn_is_app_owner are supraîncărcări sau alt owner decât postgres';
  END IF;
  IF to_regprocedure('public.fn_comercial_touch_updated_at()') IS NULL
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_comercial_touch_updated_at') <> 1
     OR NOT (SELECT md5(p.prosrc) = '5bdc21b8fa8fb1231bdb021e09a5bc8e' AND pg_get_userbyid(p.proowner) = 'postgres' AND l.lanname = 'plpgsql'
                    AND NOT p.prosecdef AND p.provolatile = 'v' AND p.proconfig = ARRAY['search_path=public, pg_temp']
                    AND p.prorettype = 'trigger'::regtype
             FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_comercial_touch_updated_at()'::regprocedure) THEN
    RAISE EXCEPTION 'Precondiție 0d: public.fn_comercial_touch_updated_at() lipsește sau diferă de cea live (md5/owner/limbaj/INVOKER/VOLATILE/search_path)';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Tabelul
-- ---------------------------------------------------------------------------
CREATE TABLE public.automatizari (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cod               text NOT NULL UNIQUE CHECK (cod ~ '^[a-z0-9_]{3,60}$'),
  nume              text NOT NULL CHECK (length(btrim(nume)) BETWEEN 3 AND 200),
  tip               text NOT NULL CHECK (tip IN ('rutina_claude','cron_bd','edge_function','trigger_bd','script_pc','webhook','extern')),
  unde              text NOT NULL,                 -- unde rulează (Supabase pg_cron, Claude Routines, PC Răzvan, NAS Terra, GitHub Actions…)
  program           text,                          -- când (ora României), ex. „L–V 09:00 RO”, „la 30 min”, „la eveniment”
  referinta         text,                          -- id tehnic: trig_…, jobname, nume edge fn, cale fișier
  ce_face           text NOT NULL,
  responsabil       text,                          -- Claude / Jakarinos / Răzvan / modulul X
  citeste_extern    text,                          -- fișa (a) — ce conținut extern citește
  ce_scrie          text,                          -- fișa (b) — ce poate scrie/face (tabele, mail, bani, drepturi)
  identitate        text,                          -- fișa (c) — cu ce identitate rulează (service_role = sare peste RLS)
  cine_porneste     text,                          -- fișa (d) — cine o poate porni (poarta de rol)
  confirmare_umana  text,                          -- fișa (e) — ce acțiuni cer confirmare umană
  secrete_nume      text,                          -- DOAR numele secretelor și unde stau — NICIODATĂ valori
  stare             text NOT NULL DEFAULT 'activ' CHECK (stare IN ('activ','oprit','de_verificat','retras')),
  decis_de          text,
  decis_la          date,
  verificat_la      date,                          -- ultima verificare că rulează/există (Claude)
  registru_sectiune text,                          -- titlul secțiunii din claude_docs registru_automatizari
  observatii        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.automatizari IS 'Registrul automatizărilor (pagina Administrator › Automatizări). Owner-only. Fără valori de secrete. Scris de Claude după fiecare automatizare nouă (CLAUDE.md pct. 7).';
CREATE INDEX automatizari_tip_stare_idx ON public.automatizari (tip, stare);

CREATE TRIGGER trg_automatizari_touch BEFORE UPDATE ON public.automatizari
  FOR EACH ROW EXECUTE FUNCTION public.fn_comercial_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS — citire doar owner; fără politici de scriere (UI read-only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.automatizari ENABLE ROW LEVEL SECURITY;
CREATE POLICY automatizari_select_owner ON public.automatizari
  FOR SELECT TO authenticated USING (public.fn_is_app_owner(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. ACL explicit (default privileges live dau drepturi largi pe tabele ȘI secvențe noi)
--    Scrie DOAR postgres (proprietarul). service_role nu primește nimic.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.automatizari FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.automatizari TO authenticated;
DO $secventa$
DECLARE v_seq text := pg_get_serial_sequence('public.automatizari', 'id');
BEGIN
  IF v_seq IS NULL THEN RAISE EXCEPTION 'Pas 3: secvența identity a automatizari nu a fost găsită'; END IF;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_seq);
END $secventa$;

-- ---------------------------------------------------------------------------
-- 4. Postcondiții
-- ---------------------------------------------------------------------------
DO $post$
DECLARE v_n integer; v_s text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.automatizari'::regclass) THEN
    RAISE EXCEPTION 'Postcondiție 1: RLS inactiv pe automatizari';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'automatizari';
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'automatizari'
      AND policyname = 'automatizari_select_owner' AND cmd = 'SELECT' AND roles = '{authenticated}' AND qual ~ 'fn_is_app_owner\(auth\.uid\(\)\)') THEN
    RAISE EXCEPTION 'Postcondiție 2: politicile automatizari nu sunt exact {SELECT owner} (n=%)', v_n;
  END IF;
  -- 3. ACL EXACT pe tabel: în afară de proprietar (postgres), un singur drept — SELECT pentru authenticated.
  SELECT string_agg(coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') || '=' || a.privilege_type, ',' ORDER BY 1)
    INTO v_s FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.automatizari'::regclass AND a.grantee IS DISTINCT FROM c.relowner;
  IF v_s IS DISTINCT FROM 'authenticated=SELECT' THEN
    RAISE EXCEPTION 'Postcondiție 3: ACL tabel automatizari nu e exact {authenticated=SELECT} în afara ownerului: %', v_s;
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.automatizari'::regclass)) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Postcondiție 3: proprietarul tabelului nu e postgres';
  END IF;
  -- 4. secvența identity: niciun drept în afara proprietarului.
  SELECT string_agg(coalesce(pg_get_userbyid(nullif(a.grantee, 0)), 'PUBLIC') || '=' || a.privilege_type, ',')
    INTO v_s FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = pg_get_serial_sequence('public.automatizari', 'id')::regclass AND a.grantee IS DISTINCT FROM c.relowner;
  IF v_s IS NOT NULL OR (SELECT relacl IS NULL FROM pg_class WHERE oid = pg_get_serial_sequence('public.automatizari', 'id')::regclass) THEN
    RAISE EXCEPTION 'Postcondiție 4: secvența automatizari are drepturi în afara ownerului (sau ACL implicit): %', coalesce(v_s, 'ACL NULL');
  END IF;
  -- 5. trigger-ul de touch, exact unul.
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.automatizari'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.automatizari'::regclass AND tgname = 'trg_automatizari_touch'
                    AND tgfoid = 'public.fn_comercial_touch_updated_at()'::regprocedure) THEN
    RAISE EXCEPTION 'Postcondiție 5: trigger-ul trg_automatizari_touch lipsește sau există altele';
  END IF;
  RAISE NOTICE '20261010a după: automatizari creat, RLS owner-only, ACL exact (tabel + secvență), fără service_role';
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261010a_admin_automatizari:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261010a: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
