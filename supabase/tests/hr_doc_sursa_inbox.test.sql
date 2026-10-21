-- ============================================================================
-- 20261103a — proveniența structurală sursa_inbox_id (unică, nemodificabilă). Date FICTIVE, PG local *_test.
-- Rulat de scripts/test_hr_doc_sursa_inbox.sh DUPĂ aplicarea migrării pe hr_doc_sursa_inbox_schelet.sql.
-- Fiecare acțiune: subtranzacție anulată (nu rămâne nimic). Aserțiune picată → 'ESEC TEST: …'; la final SUITA_OK.
-- ============================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

-- rulează p_sql (instrucțiuni separate prin ';;') ca (rol, uid), apoi p_verif (SELECT → text, opțional);
-- întoarce 'ok:<rânduri>[:<verificare>]' sau 'err:<SQLSTATE>'; mereu anulat
CREATE FUNCTION pg_temp.efect(p_rol text, p_uid text, p_sql text, p_verif text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; s text; m bigint; v text; BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', p_rol)::text END, true);
    EXECUTE format('SET LOCAL ROLE %I', p_rol);
    n := 0;
    FOREACH s IN ARRAY string_to_array(p_sql, ';;') LOOP
      EXECUTE s; GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
    END LOOP;
    IF p_verif IS NOT NULL THEN EXECUTE p_verif INTO v; END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'ok:' || n || CASE WHEN p_verif IS NULL THEN '' ELSE ':' || coalesce(v, 'NULL') END;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM;
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE;
  END;
END $$;
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'ESEC TEST: %', p_nume; END IF; RAISE NOTICE 'OK %', p_nume; END $$;
CREATE FUNCTION pg_temp.eq(p_real text, p_astept text, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ok(p_real IS NOT DISTINCT FROM p_astept, p_nume || ' [' || coalesce(p_real, 'NULL') || ' vs ' || p_astept || ']'); END $$;

DO $t$
DECLARE
  hr  text := '00000000-0000-0000-0000-0000000000e1';
  own text := '00000000-0000-0000-0000-0000000000e2';
  nu  text := '00000000-0000-0000-0000-0000000000e3';
  ins text := 'INSERT INTO public.hr_documente_personale (employee_id, tip_id, fisier_path, fisier_nume, fisier_size_bytes, activ, observatii, uploadat_de, sursa_inbox_id) VALUES ';
  fn oid := to_regprocedure('public.hr_docp_sursa_inbox_imutabil()');
  amprenta0 text;
BEGIN
  -- T1 structura: coloana bigint NULL, index unic parțial, trigger BEFORE UPDATE pe rând, funcție INVOKER fără EXECUTE pentru roluri
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hr_documente_personale'
      AND column_name = 'sursa_inbox_id' AND data_type = 'bigint' AND is_nullable = 'YES')
    AND EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'hr_documente_personale_sursa_inbox_unic' AND i.indisunique AND i.indisvalid
        AND pg_get_indexdef(i.indexrelid) LIKE '%USING btree (sursa_inbox_id) WHERE (sursa_inbox_id IS NOT NULL)')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_docp_sursa_inbox_imutabil' AND tgtype = 19 AND tgfoid = fn)
    AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn)
    AND NOT has_function_privilege('anon', fn, 'EXECUTE') AND NOT has_function_privilege('authenticated', fn, 'EXECUTE')
    AND NOT has_function_privilege('service_role', fn, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = fn AND a.grantee = 0),
    'T1 coloană bigint NULL + index unic parțial + trigger BEFORE UPDATE + funcție INVOKER fără EXECUTE (PUBLIC/anon/authenticated/service_role)');
  SELECT string_agg(id || ':' || coalesce(sursa_inbox_id::text, '-') || ':' || coalesce(observatii, '') || ':' || modificat_la, ',' ORDER BY id)
    INTO amprenta0 FROM public.hr_documente_personale;

  -- T2 confirmHR: HR salvează documentul din rândul 501 cu proveniența
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, true, ''CI Popescu'', ''' || hr || ''', 501)'),
    'ok:1', 'T2 INSERT cu sursa_inbox_id = 501 → 1 rând');

  -- T3 al doilea document din același rând (alt angajat — corecția pierdută) → 23505
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, true, NULL, ''' || hr || ''', 501);;'
    || ins || '(8, 1, ''8/aidoc_b.pdf'', ''CI.pdf'', 1234, true, NULL, ''' || hr || ''', 501)'),
    'err:23505', 'T3 al doilea INSERT din rândul 501 (alt angajat) → 23505');

  -- T4 cursa celor două taburi: același rând, același angajat, același fișier → al doilea cade
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, true, NULL, ''' || hr || ''', 502);;'
    || ins || '(7, 1, ''7/aidoc_c.pdf'', ''CI.pdf'', 1234, true, NULL, ''' || hr || ''', 502)'),
    'err:23505', 'T4 două taburi pe rândul 502 → al doilea INSERT 23505');

  -- T5 copia ștearsă logic (deleted_at) contează: rândul ei nu mai produce alt document (se restaurează din Coș)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, true, NULL, ''' || hr || ''', 503);;'
    || 'UPDATE public.hr_documente_personale SET deleted_at = now(), deleted_by = ''' || hr || ''' WHERE sursa_inbox_id = 503;;'
    || ins || '(7, 1, ''7/aidoc_d.pdf'', ''CI.pdf'', 1234, true, NULL, ''' || hr || ''', 503)'),
    'err:23505', 'T5 rândul 503 cu documentul șters logic → al doilea INSERT tot 23505');

  -- T6–T8 nemodificabilă: schimbare / golire / punere ulterioară → 23514
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, true, NULL, ''' || hr || ''', 504);;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = 505 WHERE sursa_inbox_id = 504'),
    'err:23514', 'T6 UPDATE care schimbă sursa_inbox_id (504 → 505) → 23514');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, true, NULL, ''' || hr || ''', 504);;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = NULL WHERE sursa_inbox_id = 504'),
    'err:23514', 'T7 UPDATE care golește sursa_inbox_id → 23514');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    'UPDATE public.hr_documente_personale SET sursa_inbox_id = 505 WHERE id = 10'),
    'err:23514', 'T8 UPDATE care pune sursa_inbox_id pe un document vechi (Drive, NULL) → 23514');

  -- T9 nici service_role (cron-ul Drive, sare RLS), nici ownerul, nici postgres nu o schimbă
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL,
    'INSERT INTO public.hr_documente_personale (employee_id, fisier_nume, sursa_inbox_id) VALUES (7, ''s.pdf'', 506);;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = NULL WHERE sursa_inbox_id = 506'),
    'err:23514', 'T9a service_role → 23514');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', own,
    'INSERT INTO public.hr_documente_personale (employee_id, fisier_nume, sursa_inbox_id) VALUES (7, ''o.pdf'', 506);;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = 999 WHERE sursa_inbox_id = 506'),
    'err:23514', 'T9b owner → 23514');
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL,
    'UPDATE public.hr_documente_personale SET sursa_inbox_id = 999 WHERE id = 11'),
    'err:23514', 'T9c postgres → 23514');

  -- T10 editările normale pe un document cu proveniență trec: observații, nr., arhivare, ștergere logică, restaurare (Coș),
  --     clientul care retrimite rândul întreg (sursa_inbox_id = aceeași valoare); trg_hr_docp_modificat_la merge în continuare
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, true, ''CI'', ''' || hr || ''', 501);;'
    || 'UPDATE public.hr_documente_personale SET observatii = ''notă HR'', numar_document = ''RX 1'' WHERE sursa_inbox_id = 501;;'
    || 'UPDATE public.hr_documente_personale SET activ = false WHERE sursa_inbox_id = 501;;'
    || 'UPDATE public.hr_documente_personale SET deleted_at = now(), deleted_by = ''' || hr || ''' WHERE sursa_inbox_id = 501;;'
    || 'UPDATE public.hr_documente_personale SET deleted_at = NULL, deleted_by = NULL WHERE sursa_inbox_id = 501;;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = 501, activ = true WHERE sursa_inbox_id = 501',
    'SELECT sursa_inbox_id || '':'' || observatii || '':'' || activ || '':'' || (modificat_la > ''2026-01-02'') FROM public.hr_documente_personale WHERE sursa_inbox_id = 501'),
    'ok:6:501:notă HR:true:true', 'T10 editări normale pe documentul cu proveniență → trec');

  -- T11 rândurile fără proveniență: oricâte NULL; editarea documentului din Drive merge ca înainte
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(8, 1, ''8/m1.pdf'', ''m.pdf'', 5, true, NULL, ''' || hr || ''', NULL);;'
    || ins || '(8, 1, ''8/m2.pdf'', ''m.pdf'', 5, true, NULL, ''' || hr || ''', NULL);;'
    || 'UPDATE public.hr_documente_personale SET numar_document = ''AB 1'' WHERE id = 10',
    'SELECT (modificat_la > ''2026-01-02'')::text FROM public.hr_documente_personale WHERE id = 10'),
    'ok:3:true', 'T11 documente fără sursa_inbox_id (2 × NULL) + editare doc Drive → trec; trg_hr_docp_modificat_la pune tot modificat_la');

  -- T12 importul din Drive (service_role) inserează fără proveniență, ca azi
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL,
    'INSERT INTO public.hr_documente_personale (employee_id, fisier_path, fisier_nume, drive_file_id) VALUES (7, ''7/drive/q.pdf'', ''q.pdf'', ''q'')'),
    'ok:1', 'T12 cron-ul Drive (service_role) inserează fără sursa_inbox_id');

  -- T13 RLS neschimbat: fără can_access_personal_data / is_owner → INSERT refuzat
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', nu,
    ins || '(7, 1, ''7/x.pdf'', ''x.pdf'', 1, true, NULL, ''' || nu || ''', 504)'),
    'err:42501', 'T13 profil fără drept → RLS 42501 (neschimbat)');

  -- T14 nimic nu a rămas modificat
  PERFORM pg_temp.eq((SELECT string_agg(id || ':' || coalesce(sursa_inbox_id::text, '-') || ':' || coalesce(observatii, '') || ':' || modificat_la, ',' ORDER BY id)
      FROM public.hr_documente_personale), amprenta0, 'T14 datele fixture neatinse');
END $t$;

ROLLBACK;
\echo SUITA_OK
