-- ════════════════════════════════════════════════════════════════════════════
-- 20261010a_admin_automatizari — DRAFT, NEAPLICAT. Registrul automatizărilor ca tabel (pagina Administrator › ⚙️ Automatizări).
-- Cerere Răzvan 03.10.2026: „o pagină cu toate automatizările, în modulul administratorului, și regula ca după orice
--   automatizare să o trecem în pagină” (varianta A: tabel nou + tab). Regula intră în CLAUDE.md pct. 7.
-- Ce face:
--   1. public.automatizari — un rând per automatizare (rutină Claude, cron pg_cron, edge function automată, trigger BD
--      notabil, script pe PC/NAS, webhook, extern), cu fișa de securitate a–e din CLAUDE.md pct. 7 pe coloane.
--      NU conține valori de secrete — doar NUMELE lor (coloana secrete).
--   2. RLS OWNER-ONLY: SELECT doar pentru fn_is_app_owner(auth.uid()). Fără politici de scriere ⇒ din UI e read-only;
--      rândurile le scrie Claude prin execute_sql (postgres, proprietarul tabelului) după fiecare automatizare nouă.
--   3. ACL explicit: live, ALTER DEFAULT PRIVILEGES dă tabelelor noi ALL pentru anon/authenticated ⇒ REVOKE ALL de la
--      PUBLIC/anon/authenticated, apoi doar SELECT pentru authenticated (filtrat de RLS) și ALL pentru service_role.
--   4. updated_at prin fn_comercial_touch_updated_at() existent (același model ca contracte_terti).
-- Precondiții (fail-closed): postgres; tabelul nu există; fn_is_app_owner(uuid) exact (md5 8d335ed3…, SECDEF, STABLE,
--   search_path, fără EXECUTE anon); fn_comercial_touch_updated_at() exact (md5 5bdc21b8…).
-- Postcondiții: RLS activ, exact 1 politică (SELECT, authenticated, fn_is_app_owner), ACL exact, fără drepturi anon.
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
  IF to_regprocedure('public.fn_comercial_touch_updated_at()') IS NULL
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_comercial_touch_updated_at()'::regprocedure) IS DISTINCT FROM '5bdc21b8fa8fb1231bdb021e09a5bc8e' THEN
    RAISE EXCEPTION 'Precondiție 0d: public.fn_comercial_touch_updated_at() lipsește sau diferă de cea live';
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
  secrete           text,                          -- DOAR numele secretelor și unde stau — NICIODATĂ valori
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
-- 3. ACL explicit (default privileges live dau ALL la anon/authenticated)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.automatizari FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.automatizari TO authenticated;
GRANT ALL ON public.automatizari TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Postcondiții
-- ---------------------------------------------------------------------------
DO $post$
DECLARE v_n integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.automatizari'::regclass) THEN
    RAISE EXCEPTION 'Postcondiție 1: RLS inactiv pe automatizari';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'automatizari';
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'automatizari'
      AND policyname = 'automatizari_select_owner' AND cmd = 'SELECT' AND roles = '{authenticated}' AND qual ~ 'fn_is_app_owner\(auth\.uid\(\)\)') THEN
    RAISE EXCEPTION 'Postcondiție 2: politicile automatizari nu sunt exact {SELECT owner} (n=%)', v_n;
  END IF;
  IF has_table_privilege('anon', 'public.automatizari', 'SELECT') OR has_table_privilege('anon', 'public.automatizari', 'INSERT')
     OR has_table_privilege('anon', 'public.automatizari', 'UPDATE') OR has_table_privilege('anon', 'public.automatizari', 'DELETE')
     OR has_table_privilege('anon', 'public.automatizari', 'TRUNCATE')
     OR NOT has_table_privilege('authenticated', 'public.automatizari', 'SELECT')
     OR has_table_privilege('authenticated', 'public.automatizari', 'INSERT') OR has_table_privilege('authenticated', 'public.automatizari', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.automatizari', 'DELETE') OR has_table_privilege('authenticated', 'public.automatizari', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Postcondiție 3: ACL automatizari greșit (anon fără nimic, authenticated doar SELECT)';
  END IF;
  RAISE NOTICE '20261010a după: automatizari creat, RLS owner-only, ACL ok';
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261010a_admin_automatizari:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261010a: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
