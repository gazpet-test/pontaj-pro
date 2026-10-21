-- ============================================================================
-- 20261103a — proveniența structurală sursa_inbox_id (verificată la INSERT: rând HR deschis + același nume / mărime / tip MIME;
-- unică, nemodificabilă). Date FICTIVE, PG local *_test.
-- Rulat de scripts/test_hr_doc_sursa_inbox.sh DUPĂ aplicarea migrării pe hr_doc_sursa_inbox_schelet.sql.
-- Fiecare acțiune: subtranzacție anulată (nu rămâne nimic). Aserțiune picată → 'ESEC TEST: …'; la final SUITA_OK.
-- ============================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

-- rulează p_sql (instrucțiuni separate prin ';;') ca (rol, uid), apoi p_verif (SELECT → text, opțional);
-- întoarce 'ok:<rânduri>[:<verificare>]' sau 'err:<SQLSTATE>' (cu p_msg: 'err:<SQLSTATE>:<mesaj>'); mereu anulat
CREATE FUNCTION pg_temp.efect(p_rol text, p_uid text, p_sql text, p_verif text DEFAULT NULL, p_msg boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
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
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE || CASE WHEN p_msg THEN ':' || SQLERRM ELSE '' END;
  END;
END $$;
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'ESEC TEST: %', p_nume; END IF; RAISE NOTICE 'OK %', p_nume; END $$;
CREATE FUNCTION pg_temp.eq(p_real text, p_astept text, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ok(p_real IS NOT DISTINCT FROM p_astept, p_nume || ' [' || coalesce(p_real, 'NULL') || ' vs ' || p_astept || ']'); END $$;
-- ca eq, dar p_real LIKE p_tipar (mesajul spune CARE gardă a refuzat — 23514 vine din două trigger-e)
CREATE FUNCTION pg_temp.like(p_real text, p_tipar text, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ok(p_real LIKE p_tipar, p_nume || ' [' || coalesce(p_real, 'NULL') || ' ~ ' || p_tipar || ']'); END $$;

DO $t$
DECLARE
  hr  text := '00000000-0000-0000-0000-0000000000e1';
  own text := '00000000-0000-0000-0000-0000000000e2';
  nu  text := '00000000-0000-0000-0000-0000000000e3';
  ins text := 'INSERT INTO public.hr_documente_personale (employee_id, tip_id, fisier_path, fisier_nume, fisier_size_bytes, fisier_mime, activ, observatii, uploadat_de, sursa_inbox_id) VALUES ';
  -- forma scurtă (service_role / owner / postgres): tot cu mărimea și tipul rândului — garda le cere (Jakarinos r2 P1)
  ins3 text := 'INSERT INTO public.hr_documente_personale (employee_id, fisier_nume, fisier_size_bytes, fisier_mime, sursa_inbox_id) VALUES ';
  fn oid := to_regprocedure('public.hr_docp_sursa_inbox_imutabil()');
  fv oid := to_regprocedure('public.hr_docp_sursa_inbox_verifica()');
  -- mesajele celor două gărzi (ambele 23514)
  m_imut text := 'err:23514:%sursa_inbox_id e nemodificabilă%';
  m_ins  text := 'err:23514:hr_documente_personale: sursa_inbox_id = % refuzată la INSERT — ';
  amprenta0 text; a text; b text;
BEGIN
  -- T1 structura: coloana bigint NULL, index unic parțial, trigger BEFORE UPDATE + BEFORE INSERT pe rând, funcții INVOKER fără
  --    EXECUTE pentru roluri
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hr_documente_personale'
      AND column_name = 'sursa_inbox_id' AND data_type = 'bigint' AND is_nullable = 'YES')
    AND EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'hr_documente_personale_sursa_inbox_unic' AND i.indisunique AND i.indisvalid
        AND pg_get_indexdef(i.indexrelid) LIKE '%USING btree (sursa_inbox_id) WHERE (sursa_inbox_id IS NOT NULL)')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_docp_sursa_inbox_imutabil' AND tgtype = 19 AND tgfoid = fn)
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_docp_sursa_inbox_verifica' AND tgtype = 7 AND tgfoid = fv)
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (fn, fv) AND (prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']))
    AND NOT has_function_privilege('anon', fn, 'EXECUTE') AND NOT has_function_privilege('authenticated', fn, 'EXECUTE')
    AND NOT has_function_privilege('service_role', fn, 'EXECUTE')
    AND NOT has_function_privilege('anon', fv, 'EXECUTE') AND NOT has_function_privilege('authenticated', fv, 'EXECUTE')
    AND NOT has_function_privilege('service_role', fv, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid IN (fn, fv) AND a.grantee = 0),
    'T1 coloană bigint NULL + index unic parțial + trigger BEFORE UPDATE (19) + BEFORE INSERT (7) + funcții INVOKER, search_path fix, fără EXECUTE (PUBLIC/anon/authenticated/service_role)');
  SELECT string_agg(id || ':' || coalesce(sursa_inbox_id::text, '-') || ':' || coalesce(observatii, '') || ':' || modificat_la, ',' ORDER BY id)
    INTO amprenta0 FROM public.hr_documente_personale;

  -- T2 confirmHR: HR salvează documentul din rândul 501 cu proveniența
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, ''CI Popescu'', ''' || hr || ''', 501)'),
    'ok:1', 'T2 INSERT cu sursa_inbox_id = 501 → 1 rând');

  -- T3 al doilea document din același rând (alt angajat — corecția pierdută) → 23505
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 501);;'
    || ins || '(8, 1, ''8/aidoc_b.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 501)'),
    'err:23505', 'T3 al doilea INSERT din rândul 501 (alt angajat) → 23505');

  -- T4 cursa celor două taburi: același rând, același angajat, același fișier → al doilea cade
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 5678, ''application/pdf'', true, NULL, ''' || hr || ''', 502);;'
    || ins || '(7, 1, ''7/aidoc_c.pdf'', ''CI.pdf'', 5678, ''application/pdf'', true, NULL, ''' || hr || ''', 502)'),
    'err:23505', 'T4 două taburi pe rândul 502 → al doilea INSERT 23505');

  -- T5 copia ștearsă logic (deleted_at) contează: rândul ei nu mai produce alt document (se restaurează din Coș)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''cazier.pdf'', 99, ''application/pdf'', true, NULL, ''' || hr || ''', 503);;'
    || 'UPDATE public.hr_documente_personale SET deleted_at = now(), deleted_by = ''' || hr || ''' WHERE sursa_inbox_id = 503;;'
    || ins || '(7, 1, ''7/aidoc_d.pdf'', ''cazier.pdf'', 99, ''application/pdf'', true, NULL, ''' || hr || ''', 503)'),
    'err:23505', 'T5 rândul 503 cu documentul șters logic → al doilea INSERT tot 23505');

  -- T6–T8 nemodificabilă: schimbare / golire / punere ulterioară → 23514 (mesajul gărzii de UPDATE, nu al celei de INSERT)
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''x.pdf'', 1, ''application/pdf'', true, NULL, ''' || hr || ''', 504);;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = 505 WHERE sursa_inbox_id = 504', NULL, true),
    m_imut, 'T6 UPDATE care schimbă sursa_inbox_id (504 → 505) → 23514 nemodificabilă');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/aidoc_a.pdf'', ''x.pdf'', 1, ''application/pdf'', true, NULL, ''' || hr || ''', 504);;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = NULL WHERE sursa_inbox_id = 504', NULL, true),
    m_imut, 'T7 UPDATE care golește sursa_inbox_id → 23514 nemodificabilă');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr,
    'UPDATE public.hr_documente_personale SET sursa_inbox_id = 505 WHERE id = 10', NULL, true),
    m_imut, 'T8 UPDATE care pune sursa_inbox_id pe un document vechi (Drive, NULL) → 23514 nemodificabilă');

  -- T9 nici service_role (cron-ul Drive, sare RLS), nici ownerul, nici postgres nu o schimbă
  PERFORM pg_temp.like(pg_temp.efect('service_role', NULL,
    ins3 || '(7, ''z.pdf'', 3, ''application/pdf'', 506);;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = NULL WHERE sursa_inbox_id = 506', NULL, true),
    m_imut, 'T9a service_role → 23514 nemodificabilă');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', own,
    ins3 || '(7, ''z.pdf'', 3, ''application/pdf'', 506);;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = 999 WHERE sursa_inbox_id = 506', NULL, true),
    m_imut, 'T9b owner → 23514 nemodificabilă');
  PERFORM pg_temp.like(pg_temp.efect('postgres', NULL,
    'UPDATE public.hr_documente_personale SET sursa_inbox_id = 999 WHERE id = 11', NULL, true),
    m_imut, 'T9c postgres → 23514 nemodificabilă');

  -- T10 editările normale pe un document cu proveniență trec: observații, nr., arhivare, ștergere logică, restaurare (Coș),
  --     clientul care retrimite rândul întreg (sursa_inbox_id = aceeași valoare); trg_hr_docp_modificat_la merge în continuare.
  --     INSERT-ul pune modificat_la explicit în trecut (2026-01-01; INSERT-ul nu trece prin trigger-ele BEFORE UPDATE): cu
  --     default-ul now() verificarea „> 2026-01-02” ar fi adevărată și fără UPDATE-uri (now() e fix în tranzacție), deci nu
  --     ar prinde un trigger de proveniență care repune OLD.modificat_la; acum doar trg_hr_docp_modificat_la o face adevărată
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    'INSERT INTO public.hr_documente_personale (employee_id, tip_id, fisier_path, fisier_nume, fisier_size_bytes, fisier_mime, activ, observatii, uploadat_de, modificat_la, sursa_inbox_id) VALUES '
    || '(7, 1, ''7/aidoc_a.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, ''CI'', ''' || hr || ''', ''2026-01-01 00:00+00'', 501);;'
    || 'UPDATE public.hr_documente_personale SET observatii = ''notă HR'', numar_document = ''RX 1'' WHERE sursa_inbox_id = 501;;'
    || 'UPDATE public.hr_documente_personale SET activ = false WHERE sursa_inbox_id = 501;;'
    || 'UPDATE public.hr_documente_personale SET deleted_at = now(), deleted_by = ''' || hr || ''' WHERE sursa_inbox_id = 501;;'
    || 'UPDATE public.hr_documente_personale SET deleted_at = NULL, deleted_by = NULL WHERE sursa_inbox_id = 501;;'
    || 'UPDATE public.hr_documente_personale SET sursa_inbox_id = 501, activ = true WHERE sursa_inbox_id = 501',
    'SELECT sursa_inbox_id || '':'' || observatii || '':'' || activ || '':'' || (modificat_la > ''2026-01-02'') FROM public.hr_documente_personale WHERE sursa_inbox_id = 501'),
    'ok:6:501:notă HR:true:true', 'T10 editări normale pe documentul cu proveniență → trec');

  -- T11 rândurile fără proveniență: oricâte NULL; editarea documentului din Drive merge ca înainte
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(8, 1, ''8/m1.pdf'', ''m.pdf'', 5, ''application/pdf'', true, NULL, ''' || hr || ''', NULL);;'
    || ins || '(8, 1, ''8/m2.pdf'', ''m.pdf'', 5, ''application/pdf'', true, NULL, ''' || hr || ''', NULL);;'
    || 'UPDATE public.hr_documente_personale SET numar_document = ''AB 1'' WHERE id = 10',
    'SELECT (modificat_la > ''2026-01-02'')::text FROM public.hr_documente_personale WHERE id = 10'),
    'ok:3:true', 'T11 documente fără sursa_inbox_id (2 × NULL) + editare doc Drive → trec; trg_hr_docp_modificat_la pune tot modificat_la');

  -- T12 importul din Drive (service_role) inserează fără proveniență, ca azi
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL,
    'INSERT INTO public.hr_documente_personale (employee_id, fisier_path, fisier_nume, drive_file_id) VALUES (7, ''7/drive/q.pdf'', ''q.pdf'', ''q'')'),
    'ok:1', 'T12 cron-ul Drive (service_role) inserează fără sursa_inbox_id');

  -- T13 RLS neschimbat: fără can_access_personal_data / is_owner → INSERT refuzat (fără proveniență, și cu proveniența unui rând
  --     pe care îl vede — 513, urcat de el: garda de la INSERT trece, RLS-ul tabelei refuză ca înainte)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', nu,
    ins || '(7, 1, ''7/x.pdf'', ''x.pdf'', 1, ''application/pdf'', true, NULL, ''' || nu || ''', NULL)'),
    'err:42501', 'T13a profil fără drept, fără proveniență → RLS 42501 (neschimbat)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', nu,
    ins || '(7, 1, ''7/x.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || nu || ''', 513)'),
    'err:42501', 'T13b profil fără drept, rândul lui (513, HR deschis, același fișier) → garda trece, RLS 42501');

  -- T15 (review extern #821, F2) proveniență FALSIFICATĂ la INSERT → 23514 cu motivul gărzii de INSERT, pentru oricine
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/f.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 503)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă', 'T15a alt rând din coadă (503 = cazier.pdf) pentru CI.pdf → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/f.pdf'', ''alt.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 501)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă', 'T15b alt nume de fișier decât rândul 501 → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/f.pdf'', NULL, 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 501)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă', 'T15c fisier_nume NULL cu proveniență → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/f.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 507)', NULL, true),
    m_ins || 'rândul nu există în coadă (sau nu îl vezi)', 'T15d rând din coada Logistică (507), pe care HR nu-l vede → refuz „nu există”');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', own, ins3 || '(7, ''CI.pdf'', 1234, ''application/pdf'', 507)', NULL, true),
    m_ins || 'rândul nu e în coada HR', 'T15d2 ownerul vede rândul din Logistică (507) → refuz „nu e în coada HR”');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/f.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 509)', NULL, true),
    m_ins || 'rândul nu e în coada HR', 'T15e rând nedecis (509, modul NULL) → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/f.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 508)', NULL, true),
    m_ins || 'rândul nu mai e deschis în coadă (status confirmat)', 'T15f rând deja confirmat (508) → refuz, deși niciun document nu-l poartă');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/f.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 512)', NULL, true),
    m_ins || 'rândul nu mai e deschis în coadă (status respins)', 'T15g rând respins (512) → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/f.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 511)', NULL, true),
    m_ins || 'rândul nu mai e deschis în coadă (status in_asteptare)', 'T15h rând încă necitit (511, in_asteptare) → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/f.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 99999)', NULL, true),
    m_ins || 'rândul nu există în coadă (sau nu îl vezi)', 'T15i rând inexistent (99999) → refuz');
  PERFORM pg_temp.like(pg_temp.efect('service_role', NULL, ins3 || '(7, ''CI.pdf'', 1234, ''application/pdf'', 507)', NULL, true),
    m_ins || 'rândul nu e în coada HR', 'T15j service_role (sare RLS) tot refuzat pe rândul din Logistică');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', own, ins3 || '(7, ''CI.pdf'', 1234, ''application/pdf'', 508)', NULL, true),
    m_ins || 'rândul nu mai e deschis%', 'T15k ownerul tot refuzat pe rândul confirmat');
  PERFORM pg_temp.like(pg_temp.efect('postgres', NULL, ins3 || '(7, ''CI.pdf'', 1234, ''application/pdf'', 512)', NULL, true),
    m_ins || 'rândul nu mai e deschis%', 'T15l postgres tot refuzat pe rândul respins');

  -- T16 legitim: HR pe rândul în status eroare (510), service_role pe un rând deschis (502); fără proveniență (manual / Drive)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/l.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 510)'),
    'ok:1', 'T16a HR din rândul 510 (status eroare, același fișier) → 1 rând');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL, ins3 || '(7, ''CI.pdf'', 5678, ''application/pdf'', 502)'),
    'ok:1', 'T16b service_role din rândul deschis 502 → 1 rând');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    ins || '(7, 1, ''7/d1.pdf'', ''d.pdf'', 5, ''application/pdf'', true, NULL, ''' || hr || ''', NULL);;'
    || 'INSERT INTO public.hr_documente_personale (employee_id, fisier_path, fisier_nume, drive_file_id) VALUES (7, ''7/drive/d2.pdf'', ''d.pdf'', ''d2'')'),
    'ok:2', 'T16c fără proveniență (manual / Drive), ca HR → trec, garda nu citește coada');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL,
    'INSERT INTO public.hr_documente_personale (employee_id, fisier_path, fisier_nume, drive_file_id) VALUES (8, ''8/drive/e.pdf'', ''e.pdf'', ''e'')'),
    'ok:1', 'T16d cron-ul Drive (service_role, NULL) → trece');

  -- T17 garda e la momentul INSERT-ului: documentul salvat rămâne când rândul se închide; o nouă inserare din rândul închis cade
  --     pe gardă (înaintea indexului unic)
  PERFORM pg_temp.eq(pg_temp.efect('postgres', NULL,
    ins3 || '(7, ''x.pdf'', 1, ''application/pdf'', 504);;'
    || 'UPDATE public.ai_documente_inbox SET status = ''confirmat'', confirmat_ref_id = 1 WHERE id = 504',
    'SELECT count(*)::text FROM public.hr_documente_personale WHERE sursa_inbox_id = 504'),
    'ok:2:1', 'T17a INSERT pe rândul deschis 504, apoi închiderea rândului → documentul rămâne');
  PERFORM pg_temp.like(pg_temp.efect('postgres', NULL,
    ins3 || '(7, ''x.pdf'', 1, ''application/pdf'', 504);;'
    || 'UPDATE public.ai_documente_inbox SET status = ''confirmat'' WHERE id = 504;;'
    || ins3 || '(8, ''x.pdf'', 1, ''application/pdf'', 504)', NULL, true),
    m_ins || 'rândul nu mai e deschis în coadă (status confirmat)', 'T17b al doilea INSERT din rândul închis → garda (23514), nu doar indexul');

  -- T18 fără oracol (INVOKER): profilul fără drept nu vede rândul HR 501 → același motiv ca pentru un rând inexistent, deși
  --     numele fișierului e cel corect (o gardă DEFINER i-ar fi spus, înaintea RLS-ului, că 501 e HR, deschis, „CI.pdf”)
  a := replace(pg_temp.efect('authenticated', nu, ins || '(7, 1, ''7/o.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || nu || ''', 501)', NULL, true), '501', 'N');
  b := replace(pg_temp.efect('authenticated', nu, ins || '(7, 1, ''7/o.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || nu || ''', 99999)', NULL, true), '99999', 'N');
  PERFORM pg_temp.like(a, m_ins || 'rândul nu există în coadă (sau nu îl vezi)', 'T18a fără drept, rândul HR 501 (nume corect) → „nu există”');
  PERFORM pg_temp.eq(a, b, 'T18b … același răspuns ca pentru rândul inexistent 99999');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', nu, 'SELECT 1 FROM public.ai_documente_inbox WHERE id = 501'),
    'ok:0', 'T18c (reperul) profilul fără drept chiar nu vede rândul 501 prin RLS');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr, 'SELECT 1 FROM public.ai_documente_inbox WHERE id IN (501, 513)'),
    'ok:2', 'T18d HR vede rândurile HR (și pe 513, urcat de altul) — garda îi citește rândul');

  -- T19 (Jakarinos r2 P1) același nume NU ajunge: documentul trebuie să aibă mărimea și tipul MIME ale rândului, ne-NULL.
  --     501 și 502 au același nume („CI.pdf”), dar mărimi diferite (1234 / 5678).
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/alt.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 502)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (mărime / tip diferite)',
    'T19a HR alege rândul 502 (CI.pdf, 5678) dar salvează fișierul lui 501 (CI.pdf, 1234) → refuz, deși numele e același');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/alt.pdf'', ''CI.pdf'', 1234, ''image/jpeg'', true, NULL, ''' || hr || ''', 501)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (mărime / tip diferite)', 'T19b același nume + mărime, alt tip MIME (image/jpeg) → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/alt.pdf'', ''CI.pdf'', 1234, ''Application/PDF'', true, NULL, ''' || hr || ''', 501)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (mărime / tip diferite)', 'T19c tipul MIME se compară exact (Application/PDF ≠ application/pdf) → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, 'INSERT INTO public.hr_documente_personale (employee_id, tip_id, fisier_path, fisier_nume, fisier_size_bytes, fisier_mime, activ, sursa_inbox_id) VALUES (7, 1, ''7/n.pdf'', ''CI.pdf'', NULL, ''application/pdf'', true, 501)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (mărimea / tipul lipsesc din document)', 'T19d mărime NULL cu proveniență → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, 'INSERT INTO public.hr_documente_personale (employee_id, tip_id, fisier_path, fisier_nume, fisier_size_bytes, fisier_mime, activ, sursa_inbox_id) VALUES (7, 1, ''7/n.pdf'', ''CI.pdf'', 1234, NULL, true, 501)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (mărimea / tipul lipsesc din document)', 'T19e tip MIME NULL cu proveniență → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, 'INSERT INTO public.hr_documente_personale (employee_id, fisier_path, fisier_nume, sursa_inbox_id) VALUES (7, ''7/n.pdf'', ''CI.pdf'', 501)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (mărimea / tipul lipsesc din document)', 'T19f mărime și tip omise (NULL) cu proveniență → refuz');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/n.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 514)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (rândul din coadă nu are mărimea / tipul)', 'T19g rândul 514 fără fisier_mime → refuz (nu se leagă orice tip)');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', hr, 'INSERT INTO public.hr_documente_personale (employee_id, fisier_path, fisier_nume, fisier_size_bytes, fisier_mime, sursa_inbox_id) VALUES (7, ''7/n.pdf'', ''CI.pdf'', NULL, ''application/pdf'', 515)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (mărimea / tipul lipsesc din document)', 'T19h rândul 515 fără mărime, documentul tot fără → refuz (NULL = NULL nu trece)');
  PERFORM pg_temp.like(pg_temp.efect('service_role', NULL, ins3 || '(7, ''CI.pdf'', 999, ''application/pdf'', 501)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (mărime / tip diferite)', 'T19i service_role (sare RLS) tot refuzat la mărime diferită');
  PERFORM pg_temp.like(pg_temp.efect('postgres', NULL, ins3 || '(7, ''CI.pdf'', 1234, ''image/png'', 501)', NULL, true),
    m_ins || 'fișierul documentului nu e cel din rândul din coadă (mărime / tip diferite)', 'T19j postgres tot refuzat la tip diferit');
  -- legitim: exact coloanele trimise de panou (confirmHR) și de wizard (docWizardHR), cu mărimea / tipul copiate din rând
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    'INSERT INTO public.hr_documente_personale (employee_id, tip_id, numar_document, emitent, data_emitere, data_expirare, fara_expirare, fisier_path, fisier_nume, fisier_size_bytes, fisier_mime, activ, observatii, uploadat_de, sursa_inbox_id) VALUES '
    || '(7, 1, ''RX 1'', ''SPCLEP'', ''2021-01-02'', ''2031-01-02'', false, ''7/aidoc_p.pdf'', ''CI.pdf'', 5678, ''application/pdf'', true, ''CI Popescu'', ''' || hr || ''', 502)',
    'SELECT fisier_size_bytes || '':'' || fisier_mime FROM public.hr_documente_personale WHERE sursa_inbox_id = 502'),
    'ok:1:5678:application/pdf', 'T19k panoul (confirmHR) din rândul 502 cu mărimea / tipul rândului → 1 rând');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr,
    'INSERT INTO public.hr_documente_personale (employee_id, tip_id, numar_document, data_emitere, data_expirare, fara_expirare, fisier_path, fisier_nume, fisier_size_bytes, fisier_mime, activ, uploadat_de, sursa_inbox_id) VALUES '
    || '(8, 1, ''RX 2'', NULL, NULL, true, ''8/1_ab_y.pdf'', ''y.pdf'', 2, ''application/pdf'', true, ''' || hr || ''', 505)'),
    'ok:1', 'T19l wizard-ul (docWizardHR) din rândul 505 cu mărimea / tipul rândului → 1 rând');
  -- reziduul P2 ACCEPTAT (limitarea d din antet), fixat aici ca să nu fie uitat: alt fișier (alt fisier_path) cu același nume,
  -- aceeași mărime și același tip ca rândul trece — garda leagă prin metadate, nu prin conținut
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', hr, ins || '(7, 1, ''7/ALT_FISIER.pdf'', ''CI.pdf'', 1234, ''application/pdf'', true, NULL, ''' || hr || ''', 501)'),
    'ok:1', 'T19m (rezidual P2, documentat) alt fisier_path cu exact aceleași metadate ca rândul 501 → trece');

  -- T14 nimic nu a rămas modificat
  PERFORM pg_temp.eq((SELECT string_agg(id || ':' || coalesce(sursa_inbox_id::text, '-') || ':' || coalesce(observatii, '') || ':' || modificat_la, ',' ORDER BY id)
      FROM public.hr_documente_personale), amprenta0, 'T14 datele fixture neatinse');
END $t$;

ROLLBACK;
\echo SUITA_OK
