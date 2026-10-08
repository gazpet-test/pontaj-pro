-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261022a — SEC F4: avertismentele Supabase rămase (get_advisors 08.10.2026), varianta A aleasă de Răzvan (08.10).
-- Retrage drepturi care nu folosesc nimănui. NU creează și NU șterge obiecte, NU atinge date.
--
-- Ce face:
--   1. heartbeat_alerta() și heartbeat_muti() — SECURITY DEFINER, EXECUTE pentru PUBLIC (deci anon, de pe internet, cu
--      cheia publică din aplicație): anon putea porni alertele către owneri (INSERT notifications + UPDATE
--      procese_heartbeat.alertat_la) și citea lista proceselor (nume, gazda = numele calculatorului, ultimul mesaj).
--      ⇒ EXECUTE retras de la PUBLIC/anon/authenticated. Rămân postgres + service_role. Cine le folosește: jobul cron
--      heartbeat_alerta_orar (rulează ca postgres — verificat în cron.job, precondiția 0e) și heartbeat_alerta → heartbeat_muti
--      (DEFINER, rulează ca postgres). UI/edge/worker/scripts: 0 apeluri (grep 08.10).
--   2. fn_get_next_nr_aviz(text) — SECURITY DEFINER fără poartă: orice cont logat consuma numere din seria avizelor
--      (INSERT/UPDATE avize_serii_counter). 0 apelanți (repo + funcții SQL + cron) ⇒ EXECUTE retras de la authenticated
--      (și PUBLIC/anon, deja fără). Audit 30.09 P10.
--   3. 9 tabele cu RLS PORNIT și FĂRĂ politici (advisor 0008 „rls_enabled_no_policy”), care încă aveau GRANT
--      SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER pentru anon și authenticated: _backup_acoperire_racari_20260921,
--      _backup_clar63_20260927, _eval_candidati_inainte_20260921, _eval_runda1_20260921, _eval_runda2_20260921,
--      olx_tokens (tokenuri OAuth OLX!), piese_import_staging, rag_qr_log, storage_rls_errors.
--      Azi RLS le blochează oricum (0 rânduri vizibile), deci e APĂRARE ÎN PROFUNZIME: dacă RLS-ul s-ar opri vreodată pe
--      unul dintre ele, anon nu primește nimic. ⇒ REVOKE ALL de la PUBLIC/anon/authenticated. service_role neatins.
--      Cine le folosește: olx-aplicari-sync și rag-utilaj (edge, service_role), fn_rag_qr_rezerva și
--      log_storage_upload_error (DEFINER, rulează ca postgres) — neafectate.
--      Singura schimbare vizibilă: fn_storage_rls_report(integer) e SECURITY INVOKER cu EXECUTE pentru authenticated; apelată
--      de un cont logat dădea până acum totaluri 0 (RLS fără politici), de acum dă „permission denied”. 0 apelanți în repo;
--      cu service_role (singurul care vede date) merge ca înainte.
--   Celelalte 13 tabele din lista 0008 au deja doar postgres/service_role — neatinse.
--
-- Ce NU face (în afara variantei A): funcțiile de Ofertare (fn_trg_categorie_cantitate, fn_sectiune_sursa,
--   fn_ofertare_acoperire_reverifica_alese) — merg la sesiunea Ofertare; poarta pe fn_concediu_* (P7), heartbeat_scrie (P12),
--   setarea implicită pentru funcții noi (P13) — varianta B, cer decizia lui Răzvan. Backup-urile nu se șterg (date).
--
-- AMPRENTĂ (tiparul 20261021a): ACL-urile normalizate ale celor 12 obiecte (+ owner, SECURITY DEFINER, RLS, numărul de
--   politici și de ACL-uri pe coloane). Precondiția cere EXACT starea live citită pe 08.10 (c_live), postcondiția EXACT
--   starea țintă (c_tinta). Expresia e identică textual în revenire (verificată de harness). Ordonare COLLATE "C" ⇒ aceeași
--   valoare pe producție (ICU en-US) și în harness.
-- UN SINGUR bloc DO: garda, precondițiile, REVOKE-urile și postcondițiile sunt o singură instrucțiune — și la o rulare greșită
--   cu `psql -f` simplu (autocommit, fără ON_ERROR_STOP) orice refuz anulează tot.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261022a_sec_f4_advisors_revoke_ROLLBACK.sql. Harness: scripts/test_sec_f4_advisors.sh.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrare$
DECLARE
  v_n bigint;
  v_acum text;
  v_lista text;
  c_live  CONSTANT text := '331d7c127e6d3f11af80081b2cf82d06';  -- producție 08.10.2026 (execute_sql read-only) = harness
  c_tinta CONSTANT text := 'c40f642b53bbfb8f025b6f41699aecca';  -- harness PG17; confirmată pe producție prin dry-run (tranzacție anulată)
BEGIN
  -- ── garda de livrare (start) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261022a_sec_f4_advisors_revoke:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261022a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ──────────────────────────────────────────────────────────────────────────────────────
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;

  SELECT string_agg(x.o, ', ') INTO v_lista
    FROM (VALUES ('public.heartbeat_alerta()'), ('public.heartbeat_muti()'), ('public.fn_get_next_nr_aviz(text)')) AS x(o)
   WHERE to_regprocedure(x.o) IS NULL;
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: funcții lipsă: %', v_lista;
  END IF;
  SELECT string_agg(x.o, ', ') INTO v_lista
    FROM (VALUES ('public._backup_acoperire_racari_20260921'), ('public._backup_clar63_20260927'),
                 ('public._eval_candidati_inainte_20260921'), ('public._eval_runda1_20260921'), ('public._eval_runda2_20260921'),
                 ('public.olx_tokens'), ('public.piese_import_staging'), ('public.rag_qr_log'), ('public.storage_rls_errors')) AS x(o)
   WHERE to_regclass(x.o) IS NULL;
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: tabele lipsă: %', v_lista;
  END IF;

  -- 0c. starea EXACTĂ de pe live (ACL-uri, owner, DEFINER, RLS, politici, ACL-uri pe coloane)
  -- <amprenta> (expresie IDENTICĂ în migrare și în revenire — verificată textual de scripts/test_sec_f4_advisors.sh)
  SELECT md5(string_agg(o.k, E'\n' ORDER BY o.k COLLATE "C")) || ':' || count(*)
    INTO v_acum
    FROM (
      SELECT format('fn|%s|%s|%s|%s', p.oid::regprocedure, pg_get_userbyid(p.proowner), p.prosecdef,
               coalesce((SELECT string_agg(g.e, ',' ORDER BY g.e COLLATE "C")
                           FROM (SELECT format('%s=%s/%s%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                               a.privilege_type, pg_get_userbyid(a.grantor), CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS e
                                   FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) g), '')) AS k
        FROM pg_proc p
       WHERE p.oid IN (to_regprocedure('public.heartbeat_alerta()'), to_regprocedure('public.heartbeat_muti()'),
                       to_regprocedure('public.fn_get_next_nr_aviz(text)'))
      UNION ALL
      SELECT format('tb|%s|%s|%s|%s|%s|%s|%s', c.oid::regclass, pg_get_userbyid(c.relowner), c.relkind, c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policy po WHERE po.polrelid = c.oid)
                 + (SELECT count(*) FROM pg_attribute at WHERE at.attrelid = c.oid AND at.attnum > 0 AND at.attacl IS NOT NULL) * 1000,
               coalesce((SELECT string_agg(g.e, ',' ORDER BY g.e COLLATE "C")
                           FROM (SELECT format('%s=%s/%s%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                               a.privilege_type, pg_get_userbyid(a.grantor), CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS e
                                   FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a) g), '')) AS k
        FROM pg_class c
       WHERE c.oid IN (to_regclass('public._backup_acoperire_racari_20260921'), to_regclass('public._backup_clar63_20260927'),
                       to_regclass('public._eval_candidati_inainte_20260921'), to_regclass('public._eval_runda1_20260921'),
                       to_regclass('public._eval_runda2_20260921'), to_regclass('public.olx_tokens'),
                       to_regclass('public.piese_import_staging'), to_regclass('public.rag_qr_log'),
                       to_regclass('public.storage_rls_errors'))
    ) o;
  -- </amprenta>
  IF v_acum = c_tinta || ':12' THEN
    RAISE EXCEPTION 'Precondiție 0c: starea e deja cea țintă (amprenta %) — migrarea a fost aplicată; nimic de făcut', v_acum;
  END IF;
  IF v_acum IS DISTINCT FROM c_live || ':12' THEN
    RAISE EXCEPTION 'Precondiție 0c: drepturile celor 12 obiecte diferă de starea live din 08.10 (amprenta %, așteptat %:12) — se recitește starea și se reface migrarea',
      v_acum, c_live;
  END IF;

  -- 0d. cine depinde de cele 3 funcții: doar heartbeat_alerta → heartbeat_muti (DEFINER). Orice alt apelant SQL (funcție,
  --     view, politică) ar pierde dreptul ⇒ refuz.
  SELECT string_agg(DISTINCT format('%s → %s', p.oid::regprocedure, f.n), ', ') INTO v_lista
    FROM (VALUES ('heartbeat_alerta'), ('heartbeat_muti'), ('fn_get_next_nr_aviz')) AS f(n)
    JOIN pg_proc p ON p.prosrc ~ ('\m' || f.n || '\M') AND p.proname <> f.n
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
     AND NOT (p.oid = to_regprocedure('public.heartbeat_alerta()') AND f.n = 'heartbeat_muti');
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0d: alte funcții apelează funcțiile vizate: %', v_lista;
  END IF;
  SELECT string_agg(DISTINCT v.schemaname || '.' || v.viewname, ', ') INTO v_lista
    FROM pg_views v
   WHERE v.schemaname NOT IN ('pg_catalog', 'information_schema')
     AND v.definition ~ '\m(heartbeat_alerta|heartbeat_muti|fn_get_next_nr_aviz)\M';
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0d: view-uri care apelează funcțiile vizate: %', v_lista;
  END IF;
  SELECT string_agg(DISTINCT p.polrelid::regclass::text || '.' || p.polname, ', ') INTO v_lista
    FROM pg_policy p
   WHERE coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
         ~ '\m(heartbeat_alerta|heartbeat_muti|fn_get_next_nr_aviz)\M';
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0d: politici care apelează funcțiile vizate: %', v_lista;
  END IF;

  -- 0e. jobul cron care pornește heartbeat_alerta trebuie să ruleze ca postgres (altfel pierde dreptul)
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT string_agg(format('%s (%s)', jobname, username), ', ') FROM cron.job
                WHERE command ~ '\m(heartbeat_alerta|heartbeat_muti|fn_get_next_nr_aviz)\M' AND username IS DISTINCT FROM 'postgres'$q$
      INTO v_lista;
    IF v_lista IS NOT NULL THEN
      RAISE EXCEPTION 'Precondiție 0e: joburi cron care apelează funcțiile vizate și nu rulează ca postgres: %', v_lista;
    END IF;
  ELSE
    RAISE NOTICE 'Precondiție 0e: cron.job lipsește (nu e pg_cron) — nimic de verificat';
  END IF;

  -- 0f. cine folosește cele 9 tabele: view-uri ⇒ refuz (un view INVOKER ar da eroare celor care îl citesc);
  --     funcții ⇒ doar cele cunoscute (fn_rag_qr_rezerva / log_storage_upload_error DEFINER, fn_storage_rls_report INVOKER)
  SELECT string_agg(DISTINCT d.refobjid::regclass::text || ' ← ' || r.ev_class::regclass::text, ', ') INTO v_lista
    FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
   WHERE d.classid = 'pg_rewrite'::regclass AND r.ev_class <> d.refobjid
     AND d.refobjid IN (to_regclass('public._backup_acoperire_racari_20260921'), to_regclass('public._backup_clar63_20260927'),
                        to_regclass('public._eval_candidati_inainte_20260921'), to_regclass('public._eval_runda1_20260921'),
                        to_regclass('public._eval_runda2_20260921'), to_regclass('public.olx_tokens'),
                        to_regclass('public.piese_import_staging'), to_regclass('public.rag_qr_log'),
                        to_regclass('public.storage_rls_errors'));
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0f: view-uri peste tabelele vizate: %', v_lista;
  END IF;
  SELECT string_agg(DISTINCT format('%s → %s', p.oid::regprocedure, t.n), ', ') INTO v_lista
    FROM (VALUES ('_backup_acoperire_racari_20260921'), ('_backup_clar63_20260927'), ('_eval_candidati_inainte_20260921'),
                 ('_eval_runda1_20260921'), ('_eval_runda2_20260921'), ('olx_tokens'), ('piese_import_staging'),
                 ('rag_qr_log'), ('storage_rls_errors')) AS t(n)
    JOIN pg_proc p ON p.prosrc ~ ('\m' || t.n || '\M')
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid IS DISTINCT FROM to_regprocedure('public.fn_rag_qr_rezerva(integer,text)')
     AND p.oid IS DISTINCT FROM to_regprocedure('public.log_storage_upload_error(text,text,text)')
     AND p.oid IS DISTINCT FROM to_regprocedure('public.fn_storage_rls_report(integer)');
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0f: funcții necunoscute folosesc tabelele vizate: %', v_lista;
  END IF;

  -- ── 1. funcțiile ─────────────────────────────────────────────────────────────────────────────────────
  REVOKE EXECUTE ON FUNCTION public.heartbeat_alerta(), public.heartbeat_muti(), public.fn_get_next_nr_aviz(text)
    FROM PUBLIC, anon, authenticated;

  -- ── 2. tabelele (RLS fără politici) ──────────────────────────────────────────────────────────────────
  REVOKE ALL ON TABLE public._backup_acoperire_racari_20260921, public._backup_clar63_20260927,
                      public._eval_candidati_inainte_20260921, public._eval_runda1_20260921, public._eval_runda2_20260921,
                      public.olx_tokens, public.piese_import_staging, public.rag_qr_log, public.storage_rls_errors
    FROM PUBLIC, anon, authenticated;

  -- ── 3. postcondiții ──────────────────────────────────────────────────────────────────────────────────
  SELECT string_agg(format('%s/%s', x.o, r.n), ', ') INTO v_lista
    FROM (VALUES ('public.heartbeat_alerta()'), ('public.heartbeat_muti()'), ('public.fn_get_next_nr_aviz(text)')) AS x(o),
         (VALUES ('anon'), ('authenticated'), ('public')) AS r(n)
   WHERE has_function_privilege(r.n, to_regprocedure(x.o), 'EXECUTE');
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Postcondiție 3a: EXECUTE rămas: %', v_lista;
  END IF;
  SELECT string_agg(format('%s/%s', x.o, r.n), ', ') INTO v_lista
    FROM (VALUES ('public.heartbeat_alerta()'), ('public.heartbeat_muti()'), ('public.fn_get_next_nr_aviz(text)')) AS x(o),
         (VALUES ('postgres'), ('service_role')) AS r(n)
   WHERE NOT has_function_privilege(r.n, to_regprocedure(x.o), 'EXECUTE');
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Postcondiție 3b: EXECUTE pierdut pentru postgres/service_role: %', v_lista;
  END IF;
  SELECT string_agg(format('%s/%s/%s', t.o, r.n, p.n), ', ') INTO v_lista
    FROM (VALUES ('public._backup_acoperire_racari_20260921'), ('public._backup_clar63_20260927'),
                 ('public._eval_candidati_inainte_20260921'), ('public._eval_runda1_20260921'), ('public._eval_runda2_20260921'),
                 ('public.olx_tokens'), ('public.piese_import_staging'), ('public.rag_qr_log'), ('public.storage_rls_errors')) AS t(o),
         (VALUES ('anon'), ('authenticated'), ('public')) AS r(n),
         (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(n)
   WHERE has_table_privilege(r.n, to_regclass(t.o), p.n)
      OR has_any_column_privilege(r.n, to_regclass(t.o), CASE WHEN p.n IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN p.n ELSE 'SELECT' END);
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Postcondiție 3c: drepturi rămase pe tabele: %', v_lista;
  END IF;
  SELECT string_agg(format('%s/%s', t.o, p.n), ', ') INTO v_lista
    FROM (VALUES ('public._backup_acoperire_racari_20260921'), ('public._backup_clar63_20260927'),
                 ('public._eval_candidati_inainte_20260921'), ('public._eval_runda1_20260921'), ('public._eval_runda2_20260921'),
                 ('public.olx_tokens'), ('public.piese_import_staging'), ('public.rag_qr_log'), ('public.storage_rls_errors')) AS t(o),
         (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(n)
   WHERE NOT has_table_privilege('service_role', to_regclass(t.o), p.n);
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Postcondiție 3d: service_role a pierdut drepturi: %', v_lista;
  END IF;
  -- 3e. amprenta țintă EXACTĂ (aceeași expresie ca la 0c; nimic altceva nu s-a mișcat)
  SELECT md5(string_agg(o.k, E'\n' ORDER BY o.k COLLATE "C")) || ':' || count(*)
    INTO v_acum
    FROM (
      SELECT format('fn|%s|%s|%s|%s', p.oid::regprocedure, pg_get_userbyid(p.proowner), p.prosecdef,
               coalesce((SELECT string_agg(g.e, ',' ORDER BY g.e COLLATE "C")
                           FROM (SELECT format('%s=%s/%s%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                               a.privilege_type, pg_get_userbyid(a.grantor), CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS e
                                   FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) g), '')) AS k
        FROM pg_proc p
       WHERE p.oid IN (to_regprocedure('public.heartbeat_alerta()'), to_regprocedure('public.heartbeat_muti()'),
                       to_regprocedure('public.fn_get_next_nr_aviz(text)'))
      UNION ALL
      SELECT format('tb|%s|%s|%s|%s|%s|%s|%s', c.oid::regclass, pg_get_userbyid(c.relowner), c.relkind, c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policy po WHERE po.polrelid = c.oid)
                 + (SELECT count(*) FROM pg_attribute at WHERE at.attrelid = c.oid AND at.attnum > 0 AND at.attacl IS NOT NULL) * 1000,
               coalesce((SELECT string_agg(g.e, ',' ORDER BY g.e COLLATE "C")
                           FROM (SELECT format('%s=%s/%s%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                               a.privilege_type, pg_get_userbyid(a.grantor), CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS e
                                   FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a) g), '')) AS k
        FROM pg_class c
       WHERE c.oid IN (to_regclass('public._backup_acoperire_racari_20260921'), to_regclass('public._backup_clar63_20260927'),
                       to_regclass('public._eval_candidati_inainte_20260921'), to_regclass('public._eval_runda1_20260921'),
                       to_regclass('public._eval_runda2_20260921'), to_regclass('public.olx_tokens'),
                       to_regclass('public.piese_import_staging'), to_regclass('public.rag_qr_log'),
                       to_regclass('public.storage_rls_errors'))
    ) o;
  IF v_acum IS DISTINCT FROM c_tinta || ':12' THEN
    RAISE EXCEPTION 'Postcondiție 3e: amprenta după REVOKE = %, așteptat %:12', v_acum, c_tinta;
  END IF;
  RAISE NOTICE 'SEC F4: aplicat — amprenta % → %', c_live, c_tinta;

  -- ── garda de livrare (final) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261022a_sec_f4_advisors_revoke:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261022a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$migrare$;
