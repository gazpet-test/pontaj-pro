-- ============================================================================
-- Teste de comportament 20261003e_sec_trezorerie (date FICTIVE, PG16 local).
-- psql -v stare=initial  → fidelitate: gaura de azi există (atacurile REUȘESC)
-- psql -v stare=patch    → matricea țintă varianta A
-- psql -v stare=revenire → după revenirea tehnică: citire/scriere redeschise, ACL-urile anon/TRUNCATE rămân strânse
-- Fiecare acțiune rulează într-o subtranzacție anulată: nimic nu rămâne scris.
-- Aserțiune picată → 'ESEC TEST: <nume>' (excepție, psql iese ≠ 0).
-- ============================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;
SELECT set_config('test.stare', :'stare', true);

-- rulează SQL ca (rol, uid) și întoarce 'ok:<rânduri>' sau 'err:<SQLSTATE>'; mereu anulat
CREATE FUNCTION pg_temp.act(p_rol text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', p_rol)::text END, true);
    EXECUTE format('SET LOCAL ROLE %I', p_rol);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = n::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RETURN 'ok:' || SQLERRM;
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE;
  END;
END $$;
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'ESEC TEST: %', p_nume; END IF;
  RAISE NOTICE 'OK %', p_nume;
END $$;
CREATE FUNCTION pg_temp.eq(p_real text, p_astept text, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ok(p_real IS NOT DISTINCT FROM p_astept, p_nume || ' [' || coalesce(p_real,'NULL') || ' vs ' || p_astept || ']'); END $$;

DO $t$
DECLARE
  patch boolean := current_setting('test.stare') = 'patch';
  acl  boolean := current_setting('test.stare') IN ('patch','revenire');   -- ACL strânse (revenirea le păstrează)
  -- categoriile din matrice (uid fictiv)
  u_owner  text := '00000000-0000-0000-0000-00000000000a';
  u_flag   text := '00000000-0000-0000-0000-00000000000f';
  u_modfin text := '00000000-0000-0000-0000-00000000000b';
  u_rolui  text := '00000000-0000-0000-0000-00000000000c';
  u_exec   text := '00000000-0000-0000-0000-00000000000d';
  u_null   text := '00000000-0000-0000-0000-00000000000e';
  u_fara   text := '00000000-0000-0000-0000-0000000000ff';   -- JWT valid, fără profil
  tbl text; q_sel text; q_ins text; q_upd text; q_del text; cine text; drept boolean;
  grupuri text[][] := ARRAY[
    ARRAY['owner',                  '00000000-0000-0000-0000-00000000000a', 'da'],
    ARRAY['can_access_financiar',   '00000000-0000-0000-0000-00000000000f', 'da'],
    ARRAY['modul_financiar_fara_flag','00000000-0000-0000-0000-00000000000b','nu'],
    ARRAY['rol_scriere_UI_fara_modul','00000000-0000-0000-0000-00000000000c','nu'],
    ARRAY['cont_executie_oarecare', '00000000-0000-0000-0000-00000000000d', 'nu'],
    ARRAY['flag_NULL',              '00000000-0000-0000-0000-00000000000e', 'nu'],
    ARRAY['jwt_fara_profil',        '00000000-0000-0000-0000-0000000000ff', 'nu']];
  i int;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['trezorerie_conturi','trezorerie_extras_linii'] LOOP
    q_sel := format('SELECT * FROM public.%I', tbl);
    q_upd := format('UPDATE public.%I SET %s', tbl, CASE tbl WHEN 'trezorerie_conturi' THEN 'observatii = ''x''' ELSE 'sursa_fisier = ''x''' END);
    q_del := format('DELETE FROM public.%I', tbl);
    q_ins := CASE tbl WHEN 'trezorerie_conturi'
               THEN 'INSERT INTO public.trezorerie_conturi (iban, cont_intern) VALUES (''RO00TEST9999'', ''INT-NOU'')'
               ELSE 'INSERT INTO public.trezorerie_extras_linii (cont_id, data_extras) SELECT min(id), DATE ''2026-09-16'' FROM public.trezorerie_conturi' END;
    -- pentru linii, INSERT are nevoie de un cont_id existent: îl dau explicit (FK nu depinde de RLS)
    IF tbl = 'trezorerie_extras_linii' THEN
      q_ins := 'INSERT INTO public.trezorerie_extras_linii (cont_id, data_extras) VALUES ((SELECT min(id) FROM public.trezorerie_conturi), DATE ''2026-09-16'')';
    END IF;

    FOR i IN 1 .. array_length(grupuri, 1) LOOP
      cine := grupuri[i][1];
      drept := (NOT patch) OR grupuri[i][3] = 'da';   -- azi: toți au drept; după patch: doar matricea
      -- CITIRE
      PERFORM pg_temp.eq(pg_temp.act('authenticated', grupuri[i][2], q_sel), CASE WHEN drept THEN 'ok:3' ELSE 'ok:0' END,
                         format('%s CITIRE %s', cine, tbl));
      -- SCRIERE, separat pe INSERT / UPDATE / DELETE
      PERFORM pg_temp.eq(pg_temp.act('authenticated', grupuri[i][2], q_ins), CASE WHEN drept THEN 'ok:1' ELSE 'err:42501' END,
                         format('%s INSERT %s', cine, tbl));
      PERFORM pg_temp.eq(pg_temp.act('authenticated', grupuri[i][2], q_upd), CASE WHEN drept THEN 'ok:3' ELSE 'ok:0' END,
                         format('%s UPDATE %s', cine, tbl));
      PERFORM pg_temp.eq(pg_temp.act('authenticated', grupuri[i][2], q_del), CASE WHEN drept THEN 'ok:3' ELSE 'ok:0' END,
                         format('%s DELETE %s', cine, tbl));
    END LOOP;

    -- authenticated fără UID (claims goale)
    PERFORM pg_temp.eq(pg_temp.act('authenticated', NULL, q_sel), 'ok:0', format('authenticated_fara_uid CITIRE %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('authenticated', NULL, q_ins), 'err:42501', format('authenticated_fara_uid INSERT %s', tbl));
    -- anon: azi 0 rânduri prin RLS (dar cu GRANT); după patch: fără privilegiu deloc
    PERFORM pg_temp.eq(pg_temp.act('anon', NULL, q_sel), CASE WHEN acl THEN 'err:42501' ELSE 'ok:0' END, format('anon CITIRE %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('anon', NULL, q_ins), 'err:42501', format('anon INSERT %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('anon', NULL, q_upd), CASE WHEN acl THEN 'err:42501' ELSE 'ok:0' END, format('anon UPDATE %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('anon', NULL, q_del), CASE WHEN acl THEN 'err:42501' ELSE 'ok:0' END, format('anon DELETE %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('anon', NULL, format('TRUNCATE public.%I CASCADE', tbl)), 'err:42501', format('anon TRUNCATE %s', tbl));
    -- r2 01.10: TRUNCATE e închis pentru anon/authenticated în TOATE stările (F1 20260930i, aplicat 01.10).
    -- TRUNCATE ocolește RLS: după patch, authenticated nu-l mai are (nici ownerul aplicației prin JWT)
    PERFORM pg_temp.eq(pg_temp.act('authenticated', u_owner, format('TRUNCATE public.%I CASCADE', tbl)), 'err:42501', format('authenticated TRUNCATE %s', tbl));
    -- edge / service_role (BYPASSRLS) și postgres (MCP/migrări): neafectați
    PERFORM pg_temp.eq(pg_temp.act('service_role', NULL, q_sel), 'ok:3', format('service_role CITIRE %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('service_role', NULL, q_ins), 'ok:1', format('service_role INSERT %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('service_role', NULL, q_upd), 'ok:3', format('service_role UPDATE %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('service_role', NULL, q_del), 'ok:3', format('service_role DELETE %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('postgres', NULL, q_sel), 'ok:3', format('postgres CITIRE %s', tbl));
    PERFORM pg_temp.eq(pg_temp.act('postgres', NULL, q_upd), 'ok:3', format('postgres UPDATE %s', tbl));
  END LOOP;

  -- secvențe: anon nu mai consumă/resetează; authenticated nu mai poate setval
  PERFORM pg_temp.eq(pg_temp.act('anon', NULL, 'SELECT nextval(''public.trezorerie_conturi_id_seq'')'), CASE WHEN acl THEN 'err:42501' ELSE 'ok:1' END, 'anon nextval secventa');
  PERFORM pg_temp.eq(pg_temp.act('authenticated', u_exec, 'SELECT setval(''public.trezorerie_conturi_id_seq'', 1)'), CASE WHEN acl THEN 'err:42501' ELSE 'ok:1' END, 'authenticated setval secventa');

  -- invariant: scriere ⊆ citire (pe identitățile de test, direct pe helperi)
  IF patch THEN
    FOR i IN 1 .. array_length(grupuri, 1) LOOP
      PERFORM pg_temp.eq(pg_temp.act('authenticated', grupuri[i][2],
        'SELECT 1 WHERE public.fn_trezorerie_poate_scrie() AND NOT public.fn_trezorerie_poate_citi()'), 'ok:0',
        format('invariant scriere⊆citire %s', grupuri[i][1]));
    END LOOP;
    PERFORM pg_temp.eq(pg_temp.act('anon', NULL, 'SELECT public.fn_trezorerie_poate_citi()'), 'err:42501', 'anon EXECUTE helper');
  END IF;

  -- copilul prin FK (garantii) NU e în patch: legarea unei garanții de un cont merge ca azi (FK ocolește RLS)
  PERFORM pg_temp.eq(pg_temp.act('authenticated', u_exec,
    'INSERT INTO public.garantii (beneficiar, trezorerie_cont_id) VALUES (''B'', (SELECT max(trezorerie_cont_id) FROM public.garantii))'),
    'ok:1', 'garantii INSERT cu FK spre trezorerie (neafectat)');
  PERFORM pg_temp.eq(pg_temp.act('authenticated', u_exec, 'SELECT iban FROM public.garantii WHERE iban IS NOT NULL'), 'ok:1',
    'REZIDUAL: garantii.iban rămâne citibil de orice cont logat (în afara patch-ului)');
END
$t$;

ROLLBACK;
