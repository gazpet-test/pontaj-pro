-- ============================================================================
-- Runda 2 (verdictul Copilot pe #541, §4) — teste de comportament pe starea PATCH (date FICTIVE, PG16 local).
--   R2-X: autoatribuirea is_owner / can_access_financiar cu politicile și triggerele reale de pe profiles;
--         încercarea și citirea/scrierea trezoreriei în ACEEAȘI tranzacție → fără acces
--   R2-D: efectele DELETE pe fixture: actor neautorizat (nimic nu se schimbă: conturi, extrase, legături garantii)
--         vs actor autorizat explicit (cascada EXACTĂ: 1 cont, extrasele lui, legătura din garantii → NULL, restul neatins)
-- Rulat pe starea inițială TREBUIE să cadă (discriminare). Fiecare acțiune: subtranzacție anulată.
-- psql -v stare=patch|initial ; aserțiune picată → 'ESEC TEST: …'
-- ============================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;
SELECT set_config('test.stare', :'stare', true);

-- amprenta datelor (fără valori sensibile: doar id-uri, numărători și md5)
CREATE FUNCTION pg_temp.stare_date() RETURNS text LANGUAGE sql AS $$
  SELECT format('conturi=%s linii=%s garantii_legate=%s md5=%s',
    (SELECT count(*) FROM public.trezorerie_conturi), (SELECT count(*) FROM public.trezorerie_extras_linii),
    (SELECT count(*) FROM public.garantii WHERE trezorerie_cont_id IS NOT NULL),
    md5(concat_ws('#',
      (SELECT string_agg(id::text || ':' || iban || ':' || coalesce(observatii, ''), ',' ORDER BY id) FROM public.trezorerie_conturi),
      (SELECT string_agg(id::text || ':' || cont_id::text || ':' || coalesce(sold_final::text, ''), ',' ORDER BY id) FROM public.trezorerie_extras_linii),
      (SELECT string_agg(id::text || ':' || coalesce(trezorerie_cont_id::text, 'NULL'), ',' ORDER BY id) FROM public.garantii))))
$$;
-- rulează p_sql ca (rol, uid), apoi întoarce 'ok:<rânduri>|<stare date văzută de superuser>' sau 'err:<SQLSTATE>'; mereu anulat
CREATE FUNCTION pg_temp.efect(p_rol text, p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; r text; BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', p_rol)::text END, true);
    EXECUTE format('SET LOCAL ROLE %I', p_rol);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    r := 'ok:' || n || '|' || pg_temp.stare_date();
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = r;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM;
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE;
  END;
END $$;
-- încercare de autoatribuire + citire/scriere trezorerie în ACEEAȘI subtranzacție, cu același JWT
CREATE FUNCTION pg_temp.escaladare(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; v bigint; w bigint; BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      EXECUTE p_sql; GET DIAGNOSTICS v = ROW_COUNT; r := 'OK:' || v;
    EXCEPTION WHEN OTHERS THEN r := 'ERR:' || SQLSTATE;
    END;
    SELECT count(*) INTO v FROM public.trezorerie_conturi;
    UPDATE public.trezorerie_conturi SET observatii = 'escaladare'; GET DIAGNOSTICS w = ROW_COUNT;
    r := r || ' vede=' || v || ' modifica=' || w;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = r;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM; WHEN OTHERS THEN RETURN 'ERRX:' || SQLSTATE;
  END;
END $$;
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'ESEC TEST: %', p_nume; END IF; RAISE NOTICE 'OK %', p_nume; END $$;
CREATE FUNCTION pg_temp.eq(p_real text, p_astept text, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ok(p_real IS NOT DISTINCT FROM p_astept, p_nume || ' [' || coalesce(p_real, 'NULL') || ' vs ' || p_astept || ']'); END $$;

DO $t$
DECLARE
  u_owner text := '00000000-0000-0000-0000-00000000000a';
  u_flag  text := '00000000-0000-0000-0000-00000000000f';
  u_modfin text := '00000000-0000-0000-0000-00000000000b';
  u_exec  text := '00000000-0000-0000-0000-00000000000d';
  u_fara  text := '00000000-0000-0000-0000-0000000000ff';
  s0 text := pg_temp.stare_date();
  c_leg bigint; n_linii_leg bigint; n_gar_leg bigint; astept text; r text;
  x text[][] := ARRAY[
    ARRAY['X1 fără drept: UPDATE propriul profil can_access_financiar=true', u_exec, 'UPDATE public.profiles SET can_access_financiar = true WHERE id = auth.uid()', 'OK:1 vede=0 modifica=0'],
    ARRAY['X2 fără drept: UPDATE propriul profil is_owner=true', u_exec, 'UPDATE public.profiles SET is_owner = true WHERE id = auth.uid()', 'ERR:P0001 vede=0 modifica=0'],
    ARRAY['X3 modul financiar: UPDATE is_owner + can_access_financiar', u_modfin, 'UPDATE public.profiles SET is_owner = true, can_access_financiar = true WHERE id = auth.uid()', 'ERR:P0001 vede=0 modifica=0'],
    ARRAY['X4 fără drept: UPDATE flagul altcuiva (propriul rând e singurul permis)', u_exec, 'UPDATE public.profiles SET can_access_financiar = true WHERE id = ''00000000-0000-0000-0000-00000000000b''', 'OK:0 vede=0 modifica=0'],
    ARRAY['X5 uid fără profil: INSERT profil propriu cu flag', u_fara, 'INSERT INTO public.profiles (id, role, is_owner, can_access_financiar) VALUES (auth.uid(), ''x'', false, true)', 'ERR:42501 vede=0 modifica=0'],
    ARRAY['X6 uid fără profil: INSERT profil propriu is_owner', u_fara, 'INSERT INTO public.profiles (id, role, is_owner) VALUES (auth.uid(), ''x'', true)', 'ERR:42501 vede=0 modifica=0'],
    ARRAY['X7 fără drept: DELETE profilul ownerului (nu dă drept, nici nu trebuie să poată)', u_exec, 'DELETE FROM public.profiles WHERE is_owner', 'OK:0 vede=0 modifica=0']];
  i int;
BEGIN
  -- R2-X: autoatribuire
  FOR i IN 1 .. array_length(x, 1) LOOP
    PERFORM pg_temp.eq(pg_temp.escaladare(x[i][2], x[i][3]), x[i][4], x[i][1]);
  END LOOP;
  -- control pozitiv (aceeași funcție): contul cu flag vede și modifică
  PERFORM pg_temp.eq(pg_temp.escaladare(u_flag, 'SELECT 1'), 'OK:1 vede=3 modifica=3', 'X0 control: can_access_financiar vede și modifică (3/3)');

  -- R2-D: efectele DELETE. Contul legat de garantii (fixture): 1 cont, extrasele lui, legăturile din garantii.
  SELECT trezorerie_cont_id INTO c_leg FROM public.garantii WHERE trezorerie_cont_id IS NOT NULL LIMIT 1;
  SELECT count(*) INTO n_linii_leg FROM public.trezorerie_extras_linii WHERE cont_id = c_leg;
  SELECT count(*) INTO n_gar_leg FROM public.garantii WHERE trezorerie_cont_id = c_leg;
  PERFORM pg_temp.ok(c_leg IS NOT NULL AND n_linii_leg >= 1 AND n_gar_leg >= 1, format('D0 fixture: cont %s cu %s extras(e) și %s garanție(i) legată(e)', c_leg, n_linii_leg, n_gar_leg));
  -- neautorizat: 0 rânduri, NIMIC schimbat (cont, extrase, legături)
  FOREACH r IN ARRAY ARRAY[u_exec, u_modfin, u_fara] LOOP
    PERFORM pg_temp.eq(pg_temp.efect('authenticated', r, format('DELETE FROM public.trezorerie_conturi WHERE id = %s', c_leg)), 'ok:0|' || s0,
      format('D1 neautorizat %s: DELETE cont legat → 0 rânduri, conturi/extrase/garantii neschimbate', r));
    PERFORM pg_temp.eq(pg_temp.efect('authenticated', r, format('DELETE FROM public.trezorerie_extras_linii WHERE cont_id = %s', c_leg)), 'ok:0|' || s0,
      format('D2 neautorizat %s: DELETE extrase → 0 rânduri, neschimbat', r));
  END LOOP;
  PERFORM pg_temp.eq(pg_temp.efect('anon', NULL, format('DELETE FROM public.trezorerie_conturi WHERE id = %s', c_leg)), 'err:42501', 'D3 anon: DELETE refuzat de privilegiu');
  -- autorizat explicit: cascada EXACTĂ
  SELECT format('ok:1|conturi=%s linii=%s garantii_legate=%s md5=%s',
      (SELECT count(*) FROM public.trezorerie_conturi WHERE id IS DISTINCT FROM c_leg),
      (SELECT count(*) FROM public.trezorerie_extras_linii WHERE cont_id IS DISTINCT FROM c_leg),
      (SELECT count(*) FROM public.garantii WHERE trezorerie_cont_id IS NOT NULL AND trezorerie_cont_id IS DISTINCT FROM c_leg),
      md5(concat_ws('#',
        (SELECT string_agg(id::text || ':' || iban || ':' || coalesce(observatii, ''), ',' ORDER BY id) FROM public.trezorerie_conturi WHERE id IS DISTINCT FROM c_leg),
        (SELECT string_agg(id::text || ':' || cont_id::text || ':' || coalesce(sold_final::text, ''), ',' ORDER BY id) FROM public.trezorerie_extras_linii WHERE cont_id IS DISTINCT FROM c_leg),
        (SELECT string_agg(id::text || ':' || CASE WHEN trezorerie_cont_id = c_leg THEN 'NULL' ELSE coalesce(trezorerie_cont_id::text, 'NULL') END, ',' ORDER BY id) FROM public.garantii))))
    INTO astept;
  FOREACH r IN ARRAY ARRAY[u_owner, u_flag] LOOP
    PERFORM pg_temp.eq(pg_temp.efect('authenticated', r, format('DELETE FROM public.trezorerie_conturi WHERE id = %s', c_leg)), astept,
      format('D4 autorizat %s: DELETE cont → exact 1 cont, %s extras(e) în cascadă, %s legătur(i) garantii → NULL, restul neatins', r, n_linii_leg, n_gar_leg));
  END LOOP;
  -- garantii rămâne în afara patch-ului (incident separat): orice cont logat poate ÎNCĂ rupe legătura direct
  PERFORM pg_temp.eq(split_part(pg_temp.efect('authenticated', u_exec, format('UPDATE public.garantii SET trezorerie_cont_id = NULL WHERE trezorerie_cont_id = %s', c_leg)), '|', 1),
    'ok:' || n_gar_leg, 'D5 LIMITĂ: garantii (în afara patch-ului) — cont fără drept rupe legătura cu trezoreria direct pe garantii');
END
$t$;

ROLLBACK;
