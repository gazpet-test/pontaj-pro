-- ════════════════════════════════════════════════════════════════════════════
-- 20261003d — ROLLBACK TEHNIC: REDESCHIDE citirea tokenurilor de concediu pentru ORICE cont logat
-- ARTEFACT FĂRĂ GO DE EXECUȚIE. NU e migrare: stă în supabase/revenire/ și nu îl parcurge niciun runner
-- (supabase/revenire/README.md). Folosire doar la cererea explicită a lui Răzvan + review specific (Copilot).
-- Existența comutatorului de armare NU e autorizare.
-- ════════════════════════════════════════════════════════════════════════════
-- Readuce EXACT starea live din 29.09.2026: politica hr_tokens_sel (auth.uid() IS NOT NULL) și
-- GRANT ALL pentru anon + authenticated (arwdDxt[m]). Asta REDESCHIDE expunerea #2 (117 tokenuri /co).
-- Dacă patch-ul strică un flux legitim, întâi se lărgește ȚINTIT poarta (alt patch revizuit), nu asta.
--
-- GESTIONARUL TRANZACȚIEI E OPERATORUL: fișierul NU conține BEGIN/COMMIT. Execuția documentată e UN SINGUR
-- string, trimis ca un singur query:
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261003d', 'REDESCHIDE_CITIRE_TOKENURI:' || txid_current(), true);
--   <acest fișier, întreg>
--   COMMIT;
-- Armarea e legată de tranzacția curentă (txid): o setare rămasă în sesiune (SET de sesiune, set_config(…, false),
-- armare dintr-o tranzacție eșuată, conexiune refolosită de pooler) poartă alt txid și e refuzată.
-- Tot fișierul e UN SINGUR bloc DO: orice refuz sau eroare îl anulează întreg, oricum ar fi rulat.
-- Refuză (42501 / 55000, nimic schimbat): armare PERSISTENTĂ (pg_db_role_setting, orice scriere a numelui);
-- armare lipsă / greșită / din altă tranzacție; pornire din altă stare decât EXACT patch-ul 20261003d.
-- Postcondiție înainte de COMMIT: starea = EXACT live 29.09. La final dezarmează comutatorul (local + sesiune).
-- ════════════════════════════════════════════════════════════════════════════
DO $rollback_tehnic$
DECLARE
  v17 CONSTANT boolean := current_setting('server_version_num')::int >= 170000;
  v_toate CONSTANT text := 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' || CASE WHEN v17 THEN ',MAINTAIN' ELSE '' END;
  v_toate_fara_trunc CONSTANT text := 'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER' || CASE WHEN v17 THEN ',MAINTAIN' ELSE '' END;
  v_col_toate CONSTANT text := 'SELECT,INSERT,UPDATE,REFERENCES';
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
  -- 1. Armare persistentă = refuz (numele GUC nu țin cont de majuscule, deci nici căutarea).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) = 'gazpet.rollback_tehnic_20261003d') THEN  -- [rb:persistent]
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003d blocat: comutatorul e armat PERSISTENT (ALTER DATABASE/ROLE … SET, în pg_db_role_setting). Șterge setarea cu … RESET; armarea se face doar în tranzacția rollback-ului.'
      USING ERRCODE = '42501';
  END IF;
  -- 2. Armare legată de tranzacția curentă.
  IF current_setting('gazpet.rollback_tehnic_20261003d', true) IS DISTINCT FROM ('REDESCHIDE_CITIRE_TOKENURI:' || txid_current()::text) THEN  -- [rb:txid]
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003d blocat: nearmat în tranzacția curentă (txid %). Artefact fără GO de execuție; doar la cererea explicită a lui Răzvan, în același string: BEGIN; SELECT set_config(''gazpet.rollback_tehnic_20261003d'', ''REDESCHIDE_CITIRE_TOKENURI:'' || txid_current(), true); <fișierul> COMMIT;', txid_current()
      USING ERRCODE = '42501';
  END IF;
  -- 3. Pornire DOAR din starea exactă a patch-ului.
  EXECUTE v_q INTO v_t, v_p, v_a;
  IF v_t IS DISTINCT FROM c_tabel OR v_p IS DISTINCT FROM c_pol_patch OR v_a IS DISTINCT FROM c_priv_patch THEN  -- [rb:pornire]
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003d blocat: se pornește doar din starea exactă a patch-ului 20261003d' USING ERRCODE = '55000',
      DETAIL = 'tabel: ' || v_t || E'\npolitici: ' || v_p || E'\nprivilegii: ' || v_a;
  END IF;

  EXECUTE 'DROP POLICY hr_tokens_sel_modul_hr ON public.hr_concediu_tokens';
  EXECUTE 'CREATE POLICY hr_tokens_sel ON public.hr_concediu_tokens FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)';
  EXECUTE 'GRANT ALL ON TABLE public.hr_concediu_tokens TO anon, authenticated';
  EXECUTE 'REVOKE TRUNCATE ON TABLE public.hr_concediu_tokens FROM anon, authenticated';  -- r2 01.10: F1 rămâne în vigoare

  -- 4. Postcondiție: EXACT live 29.09.
  EXECUTE v_q INTO v_t, v_p, v_a;
  IF v_t IS DISTINCT FROM c_tabel OR v_p IS DISTINCT FROM c_pol_live OR v_a IS DISTINCT FROM c_priv_live THEN  -- [rb:post]
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261003d: postcondiție eșuată — rezultatul nu e starea live 29.09; se anulează tot' USING ERRCODE = '55000',
      DETAIL = 'tabel: ' || v_t || E'\npolitici: ' || v_p || E'\nprivilegii: ' || v_a;
  END IF;
  -- 5. Dezarmare (varianta de sesiune + cea locală).
  PERFORM set_config('gazpet.rollback_tehnic_20261003d', '', false);  -- [rb:dezarmare]
  PERFORM set_config('gazpet.rollback_tehnic_20261003d', '', true);
  RAISE WARNING 'ROLLBACK TEHNIC 20261003d aplicat: citirea tokenurilor e din nou DESCHISĂ oricărui cont logat (expunerea #2 redeschisă).';
END $rollback_tehnic$;
