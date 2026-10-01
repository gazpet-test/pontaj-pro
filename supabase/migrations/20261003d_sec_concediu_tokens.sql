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
-- Ce face (o singură tranzacție, gestionată de runnerul de livrare — tiparul rundei 4):
--   1. precondiție fail-closed: pornește doar din starea LIVE exactă sau din starea PATCH (reaplicare);
--      + invarianții sursei drepturilor (runda 2): politicile de scriere și triggerele care împiedică
--      autoatribuirea is_owner / user_module_access sunt exact cele verificate pe live 30.09;
--   2. înlocuiește hr_tokens_sel cu hr_tokens_sel_modul_hr: SELECT pentru owner SAU modulul HR
--      ('hr' ori 'hr.*' în user_module_access) = EXACT poarta UI a butonului „🔗 Link mobil”
--      (App.jsx: ruta /hr cu requireModule="hr" → hasModuleAccess = is_owner || m==='hr' || m.startsWith('hr.'));
--   3. privilegii: anon → nimic; authenticated → doar SELECT (rândurile le decide RLS); PUBLIC → nimic;
--      service_role NEATINS (edge-ul concediu-mobil citește/validează tokenul cu service_role);
--   4. postcondiție ÎNAINTE de COMMIT: politicile și privilegiile efective = exact ținta, altfel se anulează tot.
-- Ce NU face: nu invalidează tokenurile (o copie luată anterior rămâne validă), nu schimbă edge-ul, UI-ul,
-- datele sau alte tabele. Revocarea/reemiterea și expirarea = DECIZIILE lui Răzvan (doc §6).
-- Scrierea rămâne ca azi: nicio politică de INSERT/UPDATE/DELETE → doar service_role/postgres.
-- Tranzacția (runda 4, traseul comun cu #538): UN SINGUR gestionar = runnerul de livrare (scripts/livrare_migrare.sh, refăcut în runda 5 după NO-GO Copilot r4; neportat aici)
--   (psql -X -v ON_ERROR_STOP=1 --single-transaction: marcaj de livrare + ACEST fișier + INSERT în
--   supabase_migrations.schema_migrations, toate în aceeași tranzacție). Fișierul NU conține BEGIN/COMMIT.
--   Garda de livrare (start + final, legată de txid): fără marcajul runnerului fișierul refuză — psql -f simplu,
--   psql -c, apply_migration / execute_sql MCP nu îl pot aplica. Precondiția, schimbarea, postcondiția și garda
--   de final rulează înaintea înregistrării și a COMMIT-ului runnerului: orice eșec anulează tot.
--   Demonstrat în scripts/test_sec_concediu_tokens.sh pasul 3 (fără meta-comenzi psql în fișier).
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  -- Garda de livrare (start): marcajul e pus de runnerul de livrare (runda 5) ÎN ACEEAȘI tranzacție (legat de txid);
  -- lipsește / altă tranzacție ⇒ fișierul rulează fără gestionarul unic (psql -f simplu, autocommit, apply_migration, execute_sql).
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003d_sec_concediu_tokens:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003d: garda de livrare (start) — rulează DOAR prin runnerul de livrare (psql --single-transaction: marcaj + migrare + înregistrare în aceeași tranzacție)';
  END IF;
END $livrare_start$;

-- pg_get_expr califică funcțiile după search_path: îl fixăm ca amprentele să fie deterministe.
SET LOCAL search_path = public, pg_temp;

-- ── 1. PRECONDIȚIE (fail-closed, comparații NULL-safe pe amprente text complete) ──
DO $pre$
DECLARE
  v17 CONSTANT boolean := current_setting('server_version_num')::int >= 170000;
  v_toate CONSTANT text := 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' || CASE WHEN v17 THEN ',MAINTAIN' ELSE '' END;
  v_toate_fara_trunc CONSTANT text := 'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER' || CASE WHEN v17 THEN ',MAINTAIN' ELSE '' END;
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
  -- Runda 2 (verdict §2): invarianții SURSEI drepturilor, citiți read-only pe live 30.09 cu aceeași interogare.
  -- Un cont authenticated fără modul NU își poate seta is_owner (trigger prevent_role_escalation + resetarea din
  -- enforce_owner_only_salary_flags) și NU poate scrie în user_module_access (INSERT/UPDATE/DELETE doar owner).
  -- Orice diferență (politică de scriere nouă/schimbată, trigger dezactivat/modificat, BYPASSRLS) → refuz; se
  -- reanalizează și se consemnează revizia, nu se adaugă automat amprenta găsită.
  c_inv_tabele CONSTANT text := 'profiles rls=t force=f owner=postgres ; user_module_access rls=t force=f owner=postgres';
  c_inv_pol CONSTANT text := 'profiles.profiles_delete_owner|d|permissive|authenticated|c820f31f788833db3c8d7830979c8803|<NULL>;profiles.profiles_insert_owner|a|permissive|authenticated|<NULL>|c820f31f788833db3c8d7830979c8803;profiles.profiles_update_own|w|permissive|authenticated|bc9c729a84690340789a4e4f01175335|bc9c729a84690340789a4e4f01175335;profiles.profiles_update_owner|w|permissive|authenticated|c820f31f788833db3c8d7830979c8803|c820f31f788833db3c8d7830979c8803;user_module_access.user_module_access_delete_owner|d|permissive|authenticated|8d156f05d1916a18e703d322295e7715|<NULL>;user_module_access.user_module_access_insert_owner|a|permissive|authenticated|<NULL>|8d156f05d1916a18e703d322295e7715;user_module_access.user_module_access_update_owner|w|permissive|authenticated|8d156f05d1916a18e703d322295e7715|8d156f05d1916a18e703d322295e7715';
  c_inv_trg CONSTANT text := 'profiles.prevent_role_escalation_trigger|O|93294585aa40f0ef96cfc50f3b525005|cf75b37d522e2a6b0b9c9eabd72c27b4;profiles.trg_enforce_owner_only_salary_flags|O|235b88ed60c6cfe3eefb775b33a78aca|daaa561298c10c259944600e6c39467e';
  c_inv_rol CONSTANT text := 'anon bypassrls=f super=f ; authenticated bypassrls=f super=f';
  v_qi CONSTANT text := $inv$
-- <invarianti-20261003d> (sursa drepturilor: profiles.is_owner + user_module_access; runda 2)
SELECT
  (SELECT string_agg(format('%s rls=%s force=%s owner=%s', c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)), ' ; ' ORDER BY c.relname COLLATE "C")
     FROM pg_catalog.pg_class c WHERE c.oid IN (to_regclass('public.profiles'), to_regclass('public.user_module_access'))) AS inv_tabele,
  coalesce((SELECT string_agg(format('%s.%s|%s|%s|%s|%s|%s', c.relname, p.polname, p.polcmd,
                     CASE WHEN p.polpermissive THEN 'permissive' ELSE 'restrictive' END,
                     (SELECT string_agg(CASE WHEN x = 0 THEN 'public' ELSE pg_get_userbyid(x)::text END, ',' ORDER BY 1) FROM unnest(p.polroles) AS x),
                     coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '<NULL>'),
                     coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '<NULL>')),
                   ';' ORDER BY c.relname COLLATE "C", p.polname COLLATE "C")
              FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
             WHERE p.polrelid IN (to_regclass('public.profiles'), to_regclass('public.user_module_access'))
               AND p.polcmd <> 'r'), '<NICIUNA>') AS inv_politici_scriere,
  coalesce((SELECT string_agg(format('%s.%s|%s|%s|%s', c.relname, t.tgname, t.tgenabled, md5(pg_get_triggerdef(t.oid)), md5(f.prosrc)),
                   ';' ORDER BY c.relname COLLATE "C", t.tgname COLLATE "C")
              FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN pg_catalog.pg_proc f ON f.oid = t.tgfoid
             WHERE t.tgrelid = to_regclass('public.profiles') AND NOT t.tgisinternal
               AND t.tgname IN ('prevent_role_escalation_trigger', 'trg_enforce_owner_only_salary_flags')), '<NICIUNUL>') AS inv_triggere,
  (SELECT string_agg(format('%s bypassrls=%s super=%s', r.rolname, r.rolbypassrls, r.rolsuper), ' ; ' ORDER BY r.rolname COLLATE "C")
     FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon', 'authenticated')) AS inv_roluri
-- </invarianti-20261003d>
$inv$;
  v_i1 text; v_i2 text; v_i3 text; v_i4 text;
  v_t text; v_p text; v_a text; v_stare text;
BEGIN
  c_priv_live := format('anon=%1$s col=%2$s go= ; authenticated=%1$s col=%2$s go= ; public= col= go= ; service_role=%3$s col=%2$s go=', v_toate_fara_trunc, v_col_toate, v_toate);  -- r2 01.10: live DUPĂ F1 (20260930i) = fără TRUNCATE pt anon/authenticated
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
  EXECUTE v_qi INTO v_i1, v_i2, v_i3, v_i4;
  IF v_i1 IS DISTINCT FROM c_inv_tabele OR v_i2 IS DISTINCT FROM c_inv_pol OR v_i3 IS DISTINCT FROM c_inv_trg OR v_i4 IS DISTINCT FROM c_inv_rol THEN  -- [pre:invarianti]
    RAISE EXCEPTION 'Precondiție 20261003d: sursa drepturilor (profiles.is_owner / user_module_access) nu e în starea verificată — autoatribuirea nu mai e exclusă demonstrat' USING ERRCODE = '55000',
      DETAIL = concat_ws(E'\n', 'tabele: ' || v_i1, 'politici scriere: ' || v_i2, 'triggere: ' || v_i3, 'roluri: ' || v_i4);
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

-- ── 3. POSTCONDIȚIE (înainte de garda de final și de COMMIT-ul runnerului; orice abatere anulează TOT) ──
-- <postconditie>
DO $post$
DECLARE
  v17 CONSTANT boolean := current_setting('server_version_num')::int >= 170000;
  v_toate CONSTANT text := 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' || CASE WHEN v17 THEN ',MAINTAIN' ELSE '' END;
  v_toate_fara_trunc CONSTANT text := 'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER' || CASE WHEN v17 THEN ',MAINTAIN' ELSE '' END;
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
  c_priv_live := format('anon=%1$s col=%2$s go= ; authenticated=%1$s col=%2$s go= ; public= col= go= ; service_role=%3$s col=%2$s go=', v_toate_fara_trunc, v_col_toate, v_toate);  -- r2 01.10: live DUPĂ F1 (20260930i) = fără TRUNCATE pt anon/authenticated
  c_priv_patch := format('anon= col= go= ; authenticated=SELECT col=SELECT go= ; public= col= go= ; service_role=%1$s col=%2$s go=', v_toate, v_col_toate);
  EXECUTE v_q INTO v_t, v_p, v_a;
  IF v_t IS DISTINCT FROM c_tabel OR v_p IS DISTINCT FROM c_pol_patch OR v_a IS DISTINCT FROM c_priv_patch THEN
    RAISE EXCEPTION 'Postcondiție 20261003d: rezultatul nu e exact ținta — se anulează tot' USING ERRCODE = '55000',
      DETAIL = 'tabel: ' || v_t || E'\npolitici: ' || v_p || E'\nprivilegii: ' || v_a;
  END IF;
  RAISE NOTICE '20261003d: postcondiție OK (politici + privilegii efective anon/authenticated/PUBLIC/service_role)';
END $post$;
-- </postconditie>

DO $livrare_final$
BEGIN
  -- Garda de livrare (final, după postcondiții): marcajul e pus de runnerul de livrare (runda 5) ÎN ACEEAȘI tranzacție (legat de txid);
  -- lipsește / altă tranzacție ⇒ fișierul rulează fără gestionarul unic (psql -f simplu, autocommit, apply_migration, execute_sql).
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003d_sec_concediu_tokens:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003d: garda de livrare (final, după postcondiții) — rulează DOAR prin runnerul de livrare (psql --single-transaction: marcaj + migrare + înregistrare în aceeași tranzacție)';
  END IF;
END $livrare_final$;
