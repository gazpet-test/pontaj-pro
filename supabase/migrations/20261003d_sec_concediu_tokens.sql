-- ════════════════════════════════════════════════════════════════════════════
-- 20261003d — SEC: tokenurile de concediu (public.hr_concediu_tokens) citibile DOAR de owner + modulul HR
-- DOAR PREGĂTIRE (Copilot 30.09: „GO DOAR PREGĂTIRE”). NEAPLICAT. Aplicarea cere GO-ul lui Copilot pe
-- revizia finală + acordul lui Răzvan; procedura: docs/SECURITATE_PATCH_CONCEDIU_TOKENURI.md §5.
-- ════════════════════════════════════════════════════════════════════════════
-- Gaura (29.09, read-only): politica hr_tokens_sel = SELECT TO authenticated USING (auth.uid() IS NOT NULL)
-- → orice cont logat citește toate cele 117 tokenuri. Toate 117 sunt VALIDE la edge-ul concediu-mobil
-- (criteriul real: activ = true + format ^[a-f0-9]{32}$; fără expirare, fără verificarea angajatului).
-- Tokenul deschide pagina PUBLICĂ /co?t=TOKEN: sold CO + ultimele 8 cereri + depunere de cerere în numele
-- angajatului. Expunere STRUCTURALĂ — nu furt demonstrat.
--
-- Ce face (o singură tranzacție, gestionată de ACEST fișier):
--   1. precondiție fail-closed: pornește doar din starea LIVE exactă sau din starea PATCH (reaplicare);
--   2. înlocuiește hr_tokens_sel cu hr_tokens_sel_modul_hr: SELECT pentru owner SAU modulul HR
--      ('hr' ori 'hr.*' în user_module_access) = EXACT poarta UI a butonului „🔗 Link mobil”
--      (App.jsx: ruta /hr cu requireModule="hr" → hasModuleAccess = is_owner || m==='hr' || m.startsWith('hr.'));
--   3. privilegii: anon → nimic; authenticated → doar SELECT (rândurile le decide RLS); PUBLIC → nimic;
--      service_role NEATINS (edge-ul concediu-mobil citește/validează tokenul cu service_role);
--   4. postcondiție ÎNAINTE de COMMIT: politicile și privilegiile efective = exact ținta, altfel se anulează tot.
-- Ce NU face: nu invalidează tokenurile (o copie luată anterior rămâne validă), nu schimbă edge-ul, UI-ul,
-- datele sau alte tabele. Revocarea/reemiterea și expirarea = DECIZIILE lui Răzvan (doc §6).
-- Scrierea rămâne ca azi: nicio politică de INSERT/UPDATE/DELETE → doar service_role/postgres.
-- Runner: psql -v ON_ERROR_STOP=1 -f, un singur simple query, sau runner cu tranzacție proprie —
-- toate trei demonstrate în scripts/test_sec_concediu_tokens.sh (fără meta-comenzi psql în fișier).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- pg_get_expr califică funcțiile după search_path: îl fixăm ca amprentele să fie deterministe.
SET LOCAL search_path = public, pg_temp;

-- ── 1. PRECONDIȚIE (fail-closed, comparații NULL-safe pe amprente text complete) ──
DO $pre$
DECLARE
  v17 CONSTANT boolean := current_setting('server_version_num')::int >= 170000;
  v_toate CONSTANT text := 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' || CASE WHEN v17 THEN ',MAINTAIN' ELSE '' END;
  v_col_toate CONSTANT text := 'SELECT,INSERT,UPDATE,REFERENCES';
  -- Stări COMPLETE acceptate (perechi politici + privilegii; tabelul e același în ambele):
  c_tabel CONSTANT text := 'kind=r rls=t force=f owner=postgres mosteniri=0 col_acl=0';
  c_pol_live CONSTANT text := 'hr_tokens_sel|r|permissive|authenticated|dc71e447411e7aaf354179a11ad2e2ae|<NULL>';
  c_pol_patch CONSTANT text := 'hr_tokens_sel_modul_hr|r|permissive|authenticated|ab5d2578ccdd006d09e5691066ea094b|<NULL>';
  c_priv_live text;
  c_priv_patch text;
  v_q CONSTANT text := $amp$
-- <amprenta-20261003d> (text identic în migrare, postcondiție și revenire; harness-ul verifică)
WITH tb AS (SELECT to_regclass('public.hr_concediu_tokens') AS oid),
priv AS (SELECT u.p, u.ord FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
           || CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END)
           WITH ORDINALITY AS u(p, ord)),
colp AS (SELECT u.p, u.ord FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) WITH ORDINALITY AS u(p, ord)),
rol(r, ord) AS (VALUES ('anon', 1), ('authenticated', 2), ('public', 3), ('service_role', 4))
SELECT
  (SELECT CASE WHEN c.oid IS NULL THEN 'LIPSA' ELSE
     format('kind=%s rls=%s force=%s owner=%s mosteniri=%s col_acl=%s', c.relkind, c.relrowsecurity, c.relforcerowsecurity,
            pg_get_userbyid(c.relowner),
            (SELECT count(*) FROM pg_catalog.pg_inherits i WHERE i.inhparent = c.oid OR i.inhrelid = c.oid),
            (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND a.attacl IS NOT NULL)) END
     FROM tb LEFT JOIN pg_catalog.pg_class c ON c.oid = tb.oid) AS amp_tabel,
  coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s', p.polname, p.polcmd,
                     CASE WHEN p.polpermissive THEN 'permissive' ELSE 'restrictive' END,
                     (SELECT string_agg(CASE WHEN x = 0 THEN 'public' ELSE pg_get_userbyid(x)::text END, ',' ORDER BY 1)
                        FROM unnest(p.polroles) AS x),
                     coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '<NULL>'),
                     coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '<NULL>')),
                   ';' ORDER BY p.polname COLLATE "C")
              FROM tb JOIN pg_catalog.pg_policy p ON p.polrelid = tb.oid), '<NICIUNA>') AS amp_politici,
  (SELECT string_agg(format('%s=%s col=%s go=%s', rol.r,
            (SELECT string_agg(priv.p, ',' ORDER BY priv.ord) FROM priv WHERE has_table_privilege(rol.r, tb.oid, priv.p)),
            (SELECT string_agg(colp.p, ',' ORDER BY colp.ord) FROM colp WHERE has_any_column_privilege(rol.r, tb.oid, colp.p)),
            (SELECT string_agg(priv.p, ',' ORDER BY priv.ord) FROM priv WHERE has_table_privilege(rol.r, tb.oid, priv.p || ' WITH GRANT OPTION'))),
          ' ; ' ORDER BY rol.ord)
     FROM rol, tb WHERE tb.oid IS NOT NULL) AS amp_privilegii
-- </amprenta-20261003d>
$amp$;
  v_t text; v_p text; v_a text; v_stare text;
BEGIN
  c_priv_live := format('anon=%1$s col=%2$s go= ; authenticated=%1$s col=%2$s go= ; public= col= go= ; service_role=%1$s col=%2$s go=', v_toate, v_col_toate);
  c_priv_patch := format('anon= col= go= ; authenticated=SELECT col=SELECT go= ; public= col= go= ; service_role=%1$s col=%2$s go=', v_toate, v_col_toate);
  -- dependențele politicii noi (tipuri exacte)
  IF (SELECT count(*) FROM pg_catalog.pg_attribute a
       WHERE NOT a.attisdropped AND a.attnum > 0 AND (
             (a.attrelid = to_regclass('public.profiles') AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype)
          OR (a.attrelid = to_regclass('public.profiles') AND a.attname = 'is_owner' AND a.atttypid = 'boolean'::regtype)
          OR (a.attrelid = to_regclass('public.user_module_access') AND a.attname = 'profile_id' AND a.atttypid = 'uuid'::regtype)
          OR (a.attrelid = to_regclass('public.user_module_access') AND a.attname = 'module' AND a.atttypid = 'text'::regtype)))
     IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'Precondiție 20261003d: lipsesc profiles(id uuid, is_owner boolean) / user_module_access(profile_id uuid, module text)' USING ERRCODE = '55000';
  END IF;
  EXECUTE v_q INTO v_t, v_p, v_a;
  IF v_t IS DISTINCT FROM c_tabel THEN  -- [pre:tabel]
    RAISE EXCEPTION 'Precondiție 20261003d: tabelul nu e în starea cunoscută (RLS/owner/moșteniri/ACL pe coloane)' USING ERRCODE = '55000', DETAIL = v_t;
  END IF;
  IF v_p IS NOT DISTINCT FROM c_pol_live AND v_a IS NOT DISTINCT FROM c_priv_live THEN
    v_stare := 'live';
  ELSIF v_p IS NOT DISTINCT FROM c_pol_patch AND v_a IS NOT DISTINCT FROM c_priv_patch THEN
    v_stare := 'patch';
    RAISE NOTICE '20261003d: starea e deja patch-ul — reaplicare fără efect net';
  ELSE
    RAISE EXCEPTION 'Precondiție 20261003d: stare necunoscută sau mixtă — nu suprascriu. Compară înainte de orice aplicare.' USING ERRCODE = '55000', DETAIL = 'politici: ' || v_p || E'\nprivilegii: ' || v_a;  -- [pre:stare]
  END IF;
  RAISE NOTICE '20261003d: precondiție OK (pornire din %)', v_stare;
END $pre$;

-- ── 2. SCHIMBAREA ──
DROP POLICY IF EXISTS hr_tokens_sel ON public.hr_concediu_tokens;  -- [schimbare-1]
DROP POLICY IF EXISTS hr_tokens_sel_modul_hr ON public.hr_concediu_tokens;
CREATE POLICY hr_tokens_sel_modul_hr ON public.hr_concediu_tokens
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner = true)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
                WHERE uma.profile_id = auth.uid()
                  AND (uma.module = 'hr' OR left(uma.module, 3) = 'hr.'))
  );
COMMENT ON POLICY hr_tokens_sel_modul_hr ON public.hr_concediu_tokens IS
  'SEC-20261003d: tokenurile /co doar pentru owner sau modulul HR (hr / hr.*), ca butonul „Link mobil” din HR → Concedii. Edge-ul concediu-mobil folosește service_role.';
REVOKE ALL ON TABLE public.hr_concediu_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.hr_concediu_tokens TO authenticated;

-- ── 3. POSTCONDIȚIE (înainte de COMMIT; orice abatere anulează TOT) ──
-- <postconditie>
DO $post$
DECLARE
  v17 CONSTANT boolean := current_setting('server_version_num')::int >= 170000;
  v_toate CONSTANT text := 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' || CASE WHEN v17 THEN ',MAINTAIN' ELSE '' END;
  v_col_toate CONSTANT text := 'SELECT,INSERT,UPDATE,REFERENCES';
  -- Stări COMPLETE acceptate (perechi politici + privilegii; tabelul e același în ambele):
  c_tabel CONSTANT text := 'kind=r rls=t force=f owner=postgres mosteniri=0 col_acl=0';
  c_pol_live CONSTANT text := 'hr_tokens_sel|r|permissive|authenticated|dc71e447411e7aaf354179a11ad2e2ae|<NULL>';
  c_pol_patch CONSTANT text := 'hr_tokens_sel_modul_hr|r|permissive|authenticated|ab5d2578ccdd006d09e5691066ea094b|<NULL>';
  c_priv_live text;
  c_priv_patch text;
  v_q CONSTANT text := $amp$
-- <amprenta-20261003d> (text identic în migrare, postcondiție și revenire; harness-ul verifică)
WITH tb AS (SELECT to_regclass('public.hr_concediu_tokens') AS oid),
priv AS (SELECT u.p, u.ord FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
           || CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END)
           WITH ORDINALITY AS u(p, ord)),
colp AS (SELECT u.p, u.ord FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) WITH ORDINALITY AS u(p, ord)),
rol(r, ord) AS (VALUES ('anon', 1), ('authenticated', 2), ('public', 3), ('service_role', 4))
SELECT
  (SELECT CASE WHEN c.oid IS NULL THEN 'LIPSA' ELSE
     format('kind=%s rls=%s force=%s owner=%s mosteniri=%s col_acl=%s', c.relkind, c.relrowsecurity, c.relforcerowsecurity,
            pg_get_userbyid(c.relowner),
            (SELECT count(*) FROM pg_catalog.pg_inherits i WHERE i.inhparent = c.oid OR i.inhrelid = c.oid),
            (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND a.attacl IS NOT NULL)) END
     FROM tb LEFT JOIN pg_catalog.pg_class c ON c.oid = tb.oid) AS amp_tabel,
  coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s', p.polname, p.polcmd,
                     CASE WHEN p.polpermissive THEN 'permissive' ELSE 'restrictive' END,
                     (SELECT string_agg(CASE WHEN x = 0 THEN 'public' ELSE pg_get_userbyid(x)::text END, ',' ORDER BY 1)
                        FROM unnest(p.polroles) AS x),
                     coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '<NULL>'),
                     coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '<NULL>')),
                   ';' ORDER BY p.polname COLLATE "C")
              FROM tb JOIN pg_catalog.pg_policy p ON p.polrelid = tb.oid), '<NICIUNA>') AS amp_politici,
  (SELECT string_agg(format('%s=%s col=%s go=%s', rol.r,
            (SELECT string_agg(priv.p, ',' ORDER BY priv.ord) FROM priv WHERE has_table_privilege(rol.r, tb.oid, priv.p)),
            (SELECT string_agg(colp.p, ',' ORDER BY colp.ord) FROM colp WHERE has_any_column_privilege(rol.r, tb.oid, colp.p)),
            (SELECT string_agg(priv.p, ',' ORDER BY priv.ord) FROM priv WHERE has_table_privilege(rol.r, tb.oid, priv.p || ' WITH GRANT OPTION'))),
          ' ; ' ORDER BY rol.ord)
     FROM rol, tb WHERE tb.oid IS NOT NULL) AS amp_privilegii
-- </amprenta-20261003d>
$amp$;
  v_t text; v_p text; v_a text;
BEGIN
  c_priv_live := format('anon=%1$s col=%2$s go= ; authenticated=%1$s col=%2$s go= ; public= col= go= ; service_role=%1$s col=%2$s go=', v_toate, v_col_toate);
  c_priv_patch := format('anon= col= go= ; authenticated=SELECT col=SELECT go= ; public= col= go= ; service_role=%1$s col=%2$s go=', v_toate, v_col_toate);
  EXECUTE v_q INTO v_t, v_p, v_a;
  IF v_t IS DISTINCT FROM c_tabel OR v_p IS DISTINCT FROM c_pol_patch OR v_a IS DISTINCT FROM c_priv_patch THEN
    RAISE EXCEPTION 'Postcondiție 20261003d: rezultatul nu e exact ținta — se anulează tot' USING ERRCODE = '55000',
      DETAIL = 'tabel: ' || v_t || E'\npolitici: ' || v_p || E'\nprivilegii: ' || v_a;
  END IF;
  RAISE NOTICE '20261003d: postcondiție OK (politici + privilegii efective anon/authenticated/PUBLIC/service_role)';
END $post$;
-- </postconditie>

COMMIT;
