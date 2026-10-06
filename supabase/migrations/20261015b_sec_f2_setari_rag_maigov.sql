-- ════════════════════════════════════════════════════════════════════════════
-- 20261015b_sec_f2_setari_rag_maigov — DRAFT, NEAPLICAT. Task #17 faza 2, grupa A (claude_context #1602 / #1577).
-- Găsit la auditul read-only din 05.10.2026 pe sursa publicată + politicile live:
--   1. logistica_setari: INSERT/UPDATE/DELETE pentru ORICE cont logat (auth.uid() IS NOT NULL). Un angajat poate schimba
--      destinatarii mailurilor de parc / UPA / avize (trimise apoi de cron din gazpet.ro) sau datele firmei de pe documente.
--   2. necesar_setari: FOR ALL pentru orice cont logat — inclusiv aprobare_activa / prag_aprobare_ron (aprobarea achizițiilor)
--      și email_achizitor. Niciun ecran nu scrie aici (grep src/ 05.10: doar Consumabile.jsx citește).
--   3. mai_gov_redirect_log: SELECT pentru orice cont logat, iar rândurile țin codurile de login hub.mai.gov.ro.
--      Niciun ecran nu citește tabelul (grep src/ 05.10).
--   4. Joburile pg_cron 17 rag_utilaj_process_queue, 18 rag_utilaj_process_pending, 30 redirect-mai-gov au în comandă
--      secretul intern în clar (x-internal-secret / x-ingest-secret). Trec pe Vault INTERN_EDGE_SECRET (antetul
--      x-intern-secret, verificat de _shared/poartaIntern.ts), iar cheia anon pentru verify_jwt se citește din Vault
--      SUPABASE_ANON_JWT (aceeași valoare — verificat în precondiții), ca la 20261011a (#595).
-- Ce face:
--   A. logistica_setari: SELECT neschimbat; scrierea pe CHEI (o politică INSERT și una UPDATE cu aceeași expresie, DELETE
--      doar owner). Cine scrie ce (din ecranele care scriu azi, grep src/ 05.10):
--        * owner — orice cheie (AdminPage › Date firmă, cheile de reminder/alertă fără ecran);
--        * modul logistica admin/editor — pret_motorina_ron, pret_motorina_actualizat (Logistică › preț motorină);
--        * modul logistica admin — aviz_email_destinatari (Logistică › destinatari aviz; e o listă de mail ⇒ nivel admin);
--        * modul administrativ admin/editor sau administrativ.upa admin/editor — upa_plafon_lunar (Administrativ › UPA).
--      UPDATE are aceeași expresie în USING și WITH CHECK ⇒ nu se poate muta un rând pe o cheie nepermisă.
--   B. necesar_setari: SELECT neschimbat; scrierea doar owner.
--   C. mai_gov_redirect_log: SELECT doar owner (service_role, edge-ul, sare peste RLS ca înainte).
--   D. Joburile 17 / 18 / 30: aceeași țintă, corp, program și timeout; antetele = Content-Type + Authorization/apikey din
--      Vault SUPABASE_ANON_JWT + x-intern-secret din Vault INTERN_EDGE_SECRET. Secretul vechi dispare din cron.job.
-- E (r2). Cota RAG atomică: fn_rag_qr_rezerva + fn_rag_ask_rezerva (SECDEF, EXECUTE doar service_role ⇒ gate 0e neatins) +
--   tabelul rag_ask_log (RLS, citit doar de owner). Nu modifică date (codurile vechi din mai_gov_redirect_log rămân, ascunse prin C;
--   ștergerea lor e o decizie separată, cu previzualizare).
-- ORDINEA DE LIVRARE: migrarea → IMEDIAT deploy edge rag-utilaj, rag-utilaj-embed, redirect-mai-gov (workflow
--   deploy-edge-function, toate trei verify_jwt=true). Între cele două, cronul trimite antetul nou spre edge-urile vechi ⇒
--   401 câteva minute (rag la 5 min, redirect-mai-gov la 1 min — fereastra trebuie ținută scurtă).
-- Revenire (NU e migrare): supabase/revenire/20261015b_sec_f2_setari_rag_maigov_ROLLBACK.sql — politicile (A–C) și cota (E),
--   cu edge-urile retrase în aceeași fereastră (fără funcțiile de cotă, rag-utilaj întoarce 500 pe ask_qr / AI).
--   Joburile NU se readuc la secretul în clar (valoarea nu e și nu va fi în repo); dacă edge-urile noi trebuie retrase,
--   joburile se opresc (cron.alter_job active := false) până la o nouă livrare.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261015b_sec_f2_setari_rag_maigov:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261015b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
DECLARE v_anon text; v_pol text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user; END IF;

  -- 0b. Vault: exact un INTERN_EDGE_SECRET de 64 hex minuscule și exact un SUPABASE_ANON_JWT
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET') <> 1
     OR (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Precondiție 0b: INTERN_EDGE_SECRET lipsește, e dublat sau nu are formatul de 64 hex';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_JWT') <> 1 THEN
    RAISE EXCEPTION 'Precondiție 0b: SUPABASE_ANON_JWT lipsește sau e dublat în Vault';
  END IF;
  SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_JWT';
  IF v_anon IS NULL OR v_anon !~ '^eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Precondiție 0b: SUPABASE_ANON_JWT din Vault nu are forma unui JWT (header.payload.semnătură)';
  END IF;

  -- 0c. joburile, exact ca pe live (comanda normalizată: JWT și secretul din antet mascate), iar JWT-ul din comandă = Vault
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('rag_utilaj_process_queue', 'rag_utilaj_process_pending', 'redirect-mai-gov')) <> 3 THEN
    RAISE EXCEPTION 'Precondiție 0c: lipsește unul dintre joburile rag_utilaj_process_queue / rag_utilaj_process_pending / redirect-mai-gov';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag_utilaj_process_queue' AND schedule = '*/5 * * * *' AND username = 'postgres' AND active
                   AND md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'),
                         '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\1'',''<S>''', 'g')) = 'd5a9c2e77f45f30a777ed7a7ad6674a2'
                   AND (regexp_match(command, 'Bearer (eyJ[A-Za-z0-9_.-]+)'))[1] = v_anon)
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag_utilaj_process_pending' AND schedule = '2-59/5 * * * *' AND username = 'postgres' AND active
                   AND md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'),
                         '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\1'',''<S>''', 'g')) = '5595149af4543bf67e078e6a3b9b8bcc'
                   AND (regexp_match(command, 'Bearer (eyJ[A-Za-z0-9_.-]+)'))[1] = v_anon)
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'redirect-mai-gov' AND schedule = '* * * * *' AND username = 'postgres' AND active
                   AND md5(regexp_replace(regexp_replace(command, 'eyJ[A-Za-z0-9_.-]+', '<JWT>', 'g'),
                         '(x-internal-secret|x-ingest-secret)''[[:space:]]*,[[:space:]]*''[^'']*''', E'\\1'',''<S>''', 'g')) = '000dc9b944a2cd2abb473da66b9e446a'
                   AND (regexp_match(command, 'Bearer (eyJ[A-Za-z0-9_.-]+)'))[1] = v_anon) THEN
    RAISE EXCEPTION 'Precondiție 0c: comanda / programul / proprietarul unui job diferă de cel auditat pe 05.10.2026 sau JWT-ul din comandă nu e cel din Vault';
  END IF;

  -- 0d. politicile, exact ca pe live (nume, comandă, roluri, expresii)
  SELECT string_agg(format('%s|%s|%s|%s|%s', p.polname, p.polcmd, p.polpermissive,
                           coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'))
                    || '|' || (SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC')) FROM unnest(p.polroles) AS o(oid) LEFT JOIN pg_roles r ON r.oid = o.oid),
                    ' ; ' ORDER BY p.polname)
    INTO v_pol FROM pg_policy p WHERE p.polrelid = 'public.logistica_setari'::regclass;
  IF v_pol IS DISTINCT FROM
     'logistica_setari_delete_authenticated|d|t|(auth.uid() IS NOT NULL)|-|authenticated ; '
     'logistica_setari_insert_authenticated|a|t|-|(auth.uid() IS NOT NULL)|authenticated ; '
     'logistica_setari_select_authenticated|r|t|true|-|authenticated ; '
     'logistica_setari_update_authenticated|w|t|(auth.uid() IS NOT NULL)|(auth.uid() IS NOT NULL)|authenticated' THEN
    RAISE EXCEPTION 'Precondiție 0d: politicile logistica_setari diferă de cele auditate: %', v_pol;
  END IF;
  SELECT string_agg(format('%s|%s|%s|%s|%s', p.polname, p.polcmd, p.polpermissive,
                           coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'))
                    || '|' || (SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC')) FROM unnest(p.polroles) AS o(oid) LEFT JOIN pg_roles r ON r.oid = o.oid),
                    ' ; ' ORDER BY p.polname)
    INTO v_pol FROM pg_policy p WHERE p.polrelid = 'public.necesar_setari'::regclass;
  IF v_pol IS DISTINCT FROM
     'necesar_setari_select|r|t|(auth.uid() IS NOT NULL)|-|authenticated ; '
     'necesar_setari_write|*|t|(auth.uid() IS NOT NULL)|(auth.uid() IS NOT NULL)|authenticated' THEN
    RAISE EXCEPTION 'Precondiție 0d: politicile necesar_setari diferă de cele auditate: %', v_pol;
  END IF;
  SELECT string_agg(format('%s|%s|%s|%s|%s', p.polname, p.polcmd, p.polpermissive,
                           coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'))
                    || '|' || (SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC')) FROM unnest(p.polroles) AS o(oid) LEFT JOIN pg_roles r ON r.oid = o.oid),
                    ' ; ' ORDER BY p.polname)
    INTO v_pol FROM pg_policy p WHERE p.polrelid = 'public.mai_gov_redirect_log'::regclass;
  IF v_pol IS DISTINCT FROM 'mai_gov_redirect_log_select|r|t|(auth.uid() IS NOT NULL)|-|authenticated' THEN
    RAISE EXCEPTION 'Precondiție 0d: politicile mai_gov_redirect_log diferă de cele auditate: %', v_pol;
  END IF;
  IF NOT (SELECT bool_and(relrowsecurity) FROM pg_class
          WHERE oid IN ('public.logistica_setari'::regclass, 'public.necesar_setari'::regclass, 'public.mai_gov_redirect_log'::regclass)) THEN
    RAISE EXCEPTION 'Precondiție 0d: RLS nu e activ pe toate cele trei tabele';
  END IF;
  -- 0f. cota RAG: funcțiile și jurnalul AI nu există; rag_qr_log are coloanele folosite
  IF to_regprocedure('public.fn_rag_qr_rezerva(integer,text)') IS NOT NULL OR to_regprocedure('public.fn_rag_ask_rezerva(uuid)') IS NOT NULL
     OR to_regclass('public.rag_ask_log') IS NOT NULL
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rag_qr_log'
          AND column_name IN ('id', 'active_id', 'question', 'answered', 'created_at')) <> 5 THEN
    RAISE EXCEPTION 'Precondiție 0f: fn_rag_qr_rezerva / fn_rag_ask_rezerva / rag_ask_log există deja sau rag_qr_log nu are coloanele așteptate';
  END IF;
  -- 0g (r3, Jakarinos): cota se bazează pe created_at = now() din aceeași tranzacție și pe un public neinscriptibil
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rag_qr_log' AND column_name = 'created_at') IS DISTINCT FROM 'now()'
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.rag_qr_log'::regclass AND NOT tgisinternal)
     OR has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Precondiție 0g: rag_qr_log.created_at nu are DEFAULT now(), are triggere, sau anon/authenticated pot crea obiecte în public';
  END IF;
  -- 0e. coloanele folosite de politici
  IF to_regclass('public.user_module_access') IS NULL
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access'
          AND column_name IN ('profile_id', 'module', 'access_level')) <> 3
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'
          AND column_name IN ('id', 'is_owner')) <> 2
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'logistica_setari'
          AND column_name = 'key') <> 1 THEN
    RAISE EXCEPTION 'Precondiție 0e: coloanele user_module_access(profile_id, module, access_level) / profiles(id, is_owner) / logistica_setari(key) lipsesc';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- A. logistica_setari — scriere pe chei
-- ---------------------------------------------------------------------------
DROP POLICY logistica_setari_insert_authenticated ON public.logistica_setari;
DROP POLICY logistica_setari_update_authenticated ON public.logistica_setari;
DROP POLICY logistica_setari_delete_authenticated ON public.logistica_setari;

CREATE POLICY logistica_setari_insert_pe_chei ON public.logistica_setari FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true)
    OR (key IN ('pret_motorina_ron', 'pret_motorina_actualizat')
        AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'logistica' AND u.access_level IN ('admin', 'editor')))
    OR (key = 'aviz_email_destinatari'
        AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'logistica' AND u.access_level = 'admin'))
    OR (key = 'upa_plafon_lunar'
        AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid()
                      AND u.module IN ('administrativ', 'administrativ.upa') AND u.access_level IN ('admin', 'editor')))
  );

CREATE POLICY logistica_setari_update_pe_chei ON public.logistica_setari FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true)
    OR (key IN ('pret_motorina_ron', 'pret_motorina_actualizat')
        AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'logistica' AND u.access_level IN ('admin', 'editor')))
    OR (key = 'aviz_email_destinatari'
        AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'logistica' AND u.access_level = 'admin'))
    OR (key = 'upa_plafon_lunar'
        AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid()
                      AND u.module IN ('administrativ', 'administrativ.upa') AND u.access_level IN ('admin', 'editor')))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true)
    OR (key IN ('pret_motorina_ron', 'pret_motorina_actualizat')
        AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'logistica' AND u.access_level IN ('admin', 'editor')))
    OR (key = 'aviz_email_destinatari'
        AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = 'logistica' AND u.access_level = 'admin'))
    OR (key = 'upa_plafon_lunar'
        AND EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid()
                      AND u.module IN ('administrativ', 'administrativ.upa') AND u.access_level IN ('admin', 'editor')))
  );

CREATE POLICY logistica_setari_delete_owner ON public.logistica_setari FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true));

-- ---------------------------------------------------------------------------
-- B. necesar_setari — scriere doar owner
-- ---------------------------------------------------------------------------
DROP POLICY necesar_setari_write ON public.necesar_setari;
CREATE POLICY necesar_setari_write_owner ON public.necesar_setari FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true));

-- ---------------------------------------------------------------------------
-- C. mai_gov_redirect_log — citire doar owner
-- ---------------------------------------------------------------------------
DROP POLICY mai_gov_redirect_log_select ON public.mai_gov_redirect_log;
CREATE POLICY mai_gov_redirect_log_select_owner ON public.mai_gov_redirect_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true));

-- ---------------------------------------------------------------------------
-- D. Joburile 17 / 18 / 30 pe Vault (aceeași țintă, corp, program, timeout)
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'rag_utilaj_process_queue'),
    command := $cmd$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/rag-utilaj',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
    ),
    body := '{"action":"process_queue"}'::jsonb,
    timeout_milliseconds := 150000
  )$cmd$);
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'rag_utilaj_process_pending'),
    command := $cmd$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/rag-utilaj-embed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )$cmd$);
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname = 'redirect-mai-gov'),
    command := $cmd$SELECT net.http_post(
      url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/redirect-mai-gov?polls=8',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
        'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
        'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 80000
    )$cmd$);
END $cron$;

-- ---------------------------------------------------------------------------
-- E. Cota RAG atomică (r2, Copilot P0/P1 + Jakarinos P1 pe #621)
--    fn_rag_qr_rezerva: pagina publică /q/:id — verifică limita pe utilaj (30) și globală (200) pe ziua RO și scrie
--    rândul în rag_qr_log DOAR dacă mai e loc, totul sub un lock de tranzacție ⇒ peste limită = zero DML, fără cursă,
--    fără cursa la miezul nopții (ziua și created_at vin din același now()).
--    fn_rag_ask_rezerva + rag_ask_log: ask cu ai=true din Logistică — 50 de răspunsuri AI pe zi per utilizator.
--    Ambele: SECURITY DEFINER, EXECUTE doar service_role (edge-ul) ⇒ nu sunt expuse PostgREST (gate 0e neatins).
-- ---------------------------------------------------------------------------
CREATE TABLE public.rag_ask_log (
  id bigserial PRIMARY KEY,
  profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rag_ask_log_profil_zi_idx ON public.rag_ask_log (profile_id, created_at);
ALTER TABLE public.rag_ask_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rag_ask_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.rag_ask_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.rag_ask_log TO service_role;
GRANT USAGE ON SEQUENCE public.rag_ask_log_id_seq TO service_role;
GRANT SELECT ON public.rag_ask_log TO authenticated;
CREATE POLICY rag_ask_log_select_owner ON public.rag_ask_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true));

CREATE FUNCTION public.fn_rag_qr_rezerva(p_active_id integer, p_question text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_zi timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest';
  v_id bigint;
BEGIN
  IF p_active_id IS NULL OR coalesce(btrim(p_question), '') = '' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.rag_qr_cota'));
  IF (SELECT count(*) FROM public.rag_qr_log WHERE created_at >= v_zi) >= 200
     OR (SELECT count(*) FROM public.rag_qr_log WHERE active_id = p_active_id AND created_at >= v_zi) >= 30 THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.rag_qr_log (active_id, question, answered) VALUES (p_active_id, left(btrim(p_question), 300), false)
    RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_rag_qr_rezerva(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rag_qr_rezerva(integer, text) TO service_role;

CREATE FUNCTION public.fn_rag_ask_rezerva(p_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_zi timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest';
BEGIN
  IF p_profile_id IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.rag_ask_cota'), hashtext(p_profile_id::text));
  IF (SELECT count(*) FROM public.rag_ask_log WHERE profile_id = p_profile_id AND created_at >= v_zi) >= 50 THEN
    RETURN false;
  END IF;
  INSERT INTO public.rag_ask_log (profile_id) VALUES (p_profile_id);
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_rag_ask_rezerva(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rag_ask_rezerva(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Postcondiții
-- ---------------------------------------------------------------------------
DO $post$
BEGIN
  IF (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.logistica_setari'::regclass)
       IS DISTINCT FROM 'logistica_setari_delete_owner:d,logistica_setari_insert_pe_chei:a,logistica_setari_select_authenticated:r,logistica_setari_update_pe_chei:w'
     OR (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.necesar_setari'::regclass)
       IS DISTINCT FROM 'necesar_setari_select:r,necesar_setari_write_owner:*'
     OR (SELECT string_agg(polname || ':' || polcmd::text, ',' ORDER BY polname) FROM pg_policy WHERE polrelid = 'public.mai_gov_redirect_log'::regclass)
       IS DISTINCT FROM 'mai_gov_redirect_log_select_owner:r' THEN
    RAISE EXCEPTION 'Postcondiție 1: setul de politici nu e cel așteptat';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid IN ('public.logistica_setari'::regclass, 'public.necesar_setari'::regclass, 'public.mai_gov_redirect_log'::regclass)
               AND polcmd <> 'r' AND (coalesce(pg_get_expr(polqual, polrelid), '') = '(auth.uid() IS NOT NULL)'
                                      OR coalesce(pg_get_expr(polwithcheck, polrelid), '') = '(auth.uid() IS NOT NULL)')) THEN
    RAISE EXCEPTION 'Postcondiție 2: a rămas o politică de scriere pentru orice cont logat';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('rag_utilaj_process_queue', 'rag_utilaj_process_pending', 'redirect-mai-gov')
        AND active AND username = 'postgres'
        AND command ~ 'x-intern-secret.*INTERN_EDGE_SECRET' AND command ~ 'SUPABASE_ANON_JWT'
        AND command !~ 'eyJ' AND command !~ 'x-internal-secret' AND command !~ 'x-ingest-secret') <> 3
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag_utilaj_process_queue' AND schedule = '*/5 * * * *' AND command ~ 'functions/v1/rag-utilaj''' AND command ~ 'process_queue')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag_utilaj_process_pending' AND schedule = '2-59/5 * * * *' AND command ~ 'functions/v1/rag-utilaj-embed')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'redirect-mai-gov' AND schedule = '* * * * *' AND command ~ 'functions/v1/redirect-mai-gov[?]polls=8') THEN
    RAISE EXCEPTION 'Postcondiție 3: joburile nu citesc din Vault, mai au un secret/JWT în clar sau ținta/programul s-a schimbat';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
        WHERE p.oid IN ('public.fn_rag_qr_rezerva(integer,text)'::regprocedure, 'public.fn_rag_ask_rezerva(uuid)'::regprocedure)
          AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
          AND p.proconfig = ARRAY['search_path=public, pg_temp']
          AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}') <> 2
     OR has_function_privilege('anon', 'public.fn_rag_qr_rezerva(integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_rag_ask_rezerva(uuid)', 'EXECUTE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rag_ask_log'::regclass)
     OR has_table_privilege('anon', 'public.rag_ask_log', 'SELECT')
     OR has_table_privilege('authenticated', 'public.rag_ask_log', 'INSERT') THEN
    RAISE EXCEPTION 'Postcondiție 4: funcțiile de cotă RAG nu sunt SECDEF/postgres/search_path/ACL doar service_role sau rag_ask_log e deschis';
  END IF;
  RAISE NOTICE '20261015b după: scrierea în logistica_setari pe chei, necesar_setari doar owner, jurnalul MAI doar owner, 3 joburi pe Vault, cota RAG atomică';
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261015b_sec_f2_setari_rag_maigov:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261015b: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
