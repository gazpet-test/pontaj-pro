-- DRY: BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261128a_redari_legatura_executie:' || txid_current(), true);
-- Executa migrarea, apoi acest fisier; se termina cu ROLLBACK.
CREATE FUNCTION pg_temp.r28_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- întoarce true dacă instrucțiunea pică exact cu SQLSTATE-ul așteptat (aserțiunea e în afara blocului EXCEPTION)
CREATE FUNCTION pg_temp.r28_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.r28_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r28.' || p, true), ''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r28_ca(uuid, text), pg_temp.r28_refuza(text, text), pg_temp.r28_g(text) TO authenticated, anon;

-- ── TEST0: garda tranzacției de probă + identitățile ──────────────────────────────────────────────────────────────────────
DO $t$
DECLARE v_owner uuid; v_editor uuid; v_viewer uuid;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261128a_redari_legatura_executie:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: marcajul migrarii nu e al tranzactiei curente — DRY-ul ruleaza doar in tranzactia de proba';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261128120000') THEN
      RAISE EXCEPTION 'TEST0 FAIL: migrarea 20261128a e deja comisa (schema_migrations) — DRY-ul nu se ruleaza pe ea';
    END IF;
  END IF;
  SELECT id INTO v_owner FROM public.profiles WHERE is_owner AND email = 'razvan.trusu@gazpet.ro';
  SELECT u.profile_id INTO v_editor FROM public.user_module_access u JOIN public.profiles p ON p.id = u.profile_id
   WHERE u.module = 'redari' AND u.access_level = 'editor' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  SELECT u.profile_id INTO v_viewer FROM public.user_module_access u JOIN public.profiles p ON p.id = u.profile_id
   WHERE u.module = 'redari' AND u.access_level = 'viewer' AND NOT p.is_owner ORDER BY u.id LIMIT 1;
  IF v_owner IS NULL OR v_editor IS NULL OR v_viewer IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati lipsa (owner/editor/viewer)'; END IF;
  PERFORM set_config('r28.owner', v_owner::text, true);
  PERFORM set_config('r28.editor', v_editor::text, true);
  PERFORM set_config('r28.viewer', v_viewer::text, true);
  RAISE NOTICE 'TEST0 OK identitati';
END $t$;



-- TEST1: owner autenticat; numai date Redări fictive; Execuție se citește, nu se modifică.
SELECT pg_temp.r28_ca(pg_temp.r28_g('owner')::uuid, 'authenticated');
DO $t$
DECLARE p uuid; e bigint; v integer; n integer; inexistent bigint;   -- executie_proiecte.id e bigint
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'TEST1 FAIL owner nu e admin'; END IF;
  SELECT min(id) INTO e FROM public.executie_proiecte;
  IF e IS NULL THEN RAISE EXCEPTION 'TEST1 FAIL necesita proiect de montaj existent si vizibil'; END IF;
  SELECT x INTO inexistent FROM generate_series(-1, -100000, -1) x WHERE NOT EXISTS (SELECT 1 FROM public.executie_proiecte ep WHERE ep.id = x) LIMIT 1;
  IF inexistent IS NULL THEN RAISE EXCEPTION 'TEST1 FAIL nu exista id liber pentru FK negativ'; END IF;
  INSERT INTO public.red_proiecte(cod, denumire) VALUES ('TEST-28A', 'Proiect fictiv 28A') RETURNING id, versiune INTO p, v;
  UPDATE public.red_proiecte SET executie_proiect_id = e, link_informare_gdpr = 'https://example.invalid/gdpr' WHERE id = p AND versiune = v;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 OR (SELECT versiune FROM public.red_proiecte WHERE id = p) IS DISTINCT FROM v + 1 THEN RAISE EXCEPTION 'TEST1 FAIL CAS/versiune'; END IF;
  PERFORM set_config('r28.pr', p::text, true);
  IF pg_temp.r28_refuza(format('INSERT INTO public.red_proiecte(cod, executie_proiect_id) VALUES (''TEST-28A-DUP'', %s)', e), '23505') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST1 FAIL UNIQUE'; END IF;
  IF pg_temp.r28_refuza(format('UPDATE public.red_proiecte SET executie_proiect_id = %s WHERE id = %L', inexistent, p), '23503') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST1 FAIL FK'; END IF;
  IF pg_temp.r28_refuza(format('UPDATE public.red_proiecte SET link_informare_gdpr = ''http://x'' WHERE id = %L', p), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST1 FAIL HTTPS'; END IF;
  IF pg_temp.r28_refuza(format('UPDATE public.red_proiecte SET link_informare_gdpr = ''https://'' || repeat(''x'',293) WHERE id = %L', p), '23514') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST1 FAIL lungime'; END IF;
  UPDATE public.red_proiecte SET link_informare_gdpr = 'https://' || repeat('x',292) WHERE id = p;
  UPDATE public.red_proiecte SET link_informare_gdpr = NULL WHERE id = p;
  -- NULL permite proiecte fără legătură, inclusiv mai multe.
  INSERT INTO public.red_proiecte(cod) VALUES ('TEST-28A-NULL1'), ('TEST-28A-NULL2');
  UPDATE public.red_proiecte SET denumire = 'Nu trebuie scris' WHERE id = p AND versiune = v;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'TEST1 FAIL CAS vechi'; END IF;
  RAISE NOTICE 'TEST1 OK admin/FK/UNIQUE/CHECK/NULL/versiune';
END $t$;

SELECT pg_temp.r28_ca(pg_temp.r28_g('editor')::uuid, 'authenticated');
DO $t$
DECLARE n integer;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'editor' THEN RAISE EXCEPTION 'TEST2 FAIL identitate editor'; END IF;
  UPDATE public.red_proiecte SET link_informare_gdpr = 'https://example.invalid/editor' WHERE id = pg_temp.r28_g('pr')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'TEST2 FAIL editor scrie'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_proiecte WHERE id = pg_temp.r28_g('pr')::uuid AND executie_proiect_id IS NOT NULL) THEN
    RAISE EXCEPTION 'TEST2 FAIL editor nu citeste'; END IF;
  RAISE NOTICE 'TEST2 OK editor citeste, nu scrie';
END $t$;

SELECT pg_temp.r28_ca(pg_temp.r28_g('viewer')::uuid, 'authenticated');
DO $t$
DECLARE n integer;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'viewer' THEN RAISE EXCEPTION 'TEST3 FAIL identitate viewer'; END IF;
  UPDATE public.red_proiecte SET executie_proiect_id = NULL WHERE id = pg_temp.r28_g('pr')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'TEST3 FAIL viewer scrie'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_proiecte WHERE id = pg_temp.r28_g('pr')::uuid) THEN RAISE EXCEPTION 'TEST3 FAIL viewer nu citeste'; END IF;
  RAISE NOTICE 'TEST3 OK viewer citeste, nu scrie';
END $t$;
SELECT pg_temp.r28_ca(NULL, 'postgres');
-- Tranzacția (migrare + DRY) o anulează OPERATORUL din runner (ROLLBACK la final); fișierul nu conține control de tranzacție.
