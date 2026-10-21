-- ============================================================================
-- 20261103c — politicile storage ale bucket-ului ai-documente-inbox + rândul din coadă legat la INSERT de fișierul celui care
-- l-a urcat (trg_ai_inbox_fisier_legat) și nemodificabil după (trg_ai_inbox_fisier_imutabil), un rând per fișier.
-- Date FICTIVE, PG local *_test. Rulat de scripts/test_ai_inbox_storage_politici.sh DUPĂ aplicarea migrării pe
-- ai_inbox_storage_politici_schelet.sql (pe schelet fără migrare TREBUIE să cadă — T1).
-- Fiecare acțiune: subtranzacție anulată (nu rămâne nimic). Aserțiune picată → 'ESEC TEST: …'; la final SUITA_OK.
-- Ce NU acoperă (îl acoperă planul din docs/HR/INBOX_STORAGE_RLS.md, pe un branch Supabase cu Storage real): storage-api
-- însuși (upload / download / createSignedUrl / remove / list prin HTTP, owner_id pus de server, protect_objects_delete).
-- Aici storage.objects e o tabelă-stub cu aceleași coloane, RLS și drepturi; SQL-ul pe care îl rulează storage-api
-- (INSERT [RETURNING], SELECT, DELETE [RETURNING], INSERT … ON CONFLICT DO UPDATE la upsert, UPDATE la move) e imitat direct.
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
-- ca efect, dar întâi p_setup ca postgres (date de pregătire); totul anulat la final
CREATE FUNCTION pg_temp.cu(p_setup text, p_rol text, p_uid text, p_sql text, p_verif text DEFAULT NULL, p_msg boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; s text; BEGIN
  BEGIN
    FOREACH s IN ARRAY string_to_array(p_setup, ';;') LOOP EXECUTE s; END LOOP;
    r := pg_temp.efect(p_rol, p_uid, p_sql, p_verif, p_msg);
    RAISE EXCEPTION USING ERRCODE = 'P0098', MESSAGE = r;
  EXCEPTION WHEN SQLSTATE 'P0098' THEN RETURN SQLERRM;
  END;
END $$;
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'ESEC TEST: %', p_nume; END IF; RAISE NOTICE 'OK %', p_nume; END $$;
CREATE FUNCTION pg_temp.eq(p_real text, p_astept text, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ok(p_real IS NOT DISTINCT FROM p_astept, p_nume || ' [' || coalesce(p_real, 'NULL') || ' vs ' || p_astept || ']'); END $$;
CREATE FUNCTION pg_temp.like(p_real text, p_tipar text, p_nume text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.ok(p_real LIKE p_tipar, p_nume || ' [' || coalesce(p_real, 'NULL') || ' ~ ' || p_tipar || ']'); END $$;

DO $t$
DECLARE
  a1 text := '00000000-0000-0000-0000-0000000000a1';   -- urcă (fără drepturi)
  a2 text := '00000000-0000-0000-0000-0000000000a2';   -- HR
  a3 text := '00000000-0000-0000-0000-0000000000a3';   -- owner
  a4 text := '00000000-0000-0000-0000-0000000000a4';   -- fără drepturi (atacatorul)
  a5 text := '00000000-0000-0000-0000-0000000000a5';   -- admin_logistica
  a6 text := '00000000-0000-0000-0000-0000000000a6';   -- MP pe șantierul proiectului 5
  a7 text := '00000000-0000-0000-0000-0000000000a7';   -- financiar
  a8 text := '00000000-0000-0000-0000-0000000000a8';   -- cont fără rând în profiles
  b  text := 'ai-documente-inbox';
  -- lista obiectelor din bucket pe care le vede apelantul (ultimul segment al căii, sortat)
  lista text := $q$SELECT coalesce(string_agg(regexp_replace(name, '^.*/', ''), ',' ORDER BY regexp_replace(name, '^.*/', '')), '-') FROM storage.objects WHERE bucket_id = 'ai-documente-inbox'$q$;
  tot text := '10_exec.pdf,1_ci.pdf,2_nedecis.pdf,3_rca.pdf,4_contract.pdf,5_cert.pdf,6_orfan.pdf,7_hr.pdf,9_upa.pdf,CI.pdf';
  o1 text; o2 text; o4 text; o6 text; o7 text; o10 text;
  ins text := 'INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ';
  m_imut text := 'err:23514:ai_documente_inbox #%: fișierul rândului %nemodificabile%';
  m_leg text := 'err:42501:ai_documente_inbox: fișierul rândului nu e în coadă sau nu l-ai urcat tu%';
  rand text := 'INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, status, uploadat_de) VALUES ';
  fn oid := to_regprocedure('public.ai_inbox_fisier_imutabil()');
  fl oid := to_regprocedure('public.ai_inbox_fisier_legat()');
BEGIN
  o1 := a1 || '/1_ci.pdf'; o2 := a1 || '/2_nedecis.pdf'; o4 := a1 || '/4_contract.pdf'; o6 := a1 || '/6_orfan.pdf';
  o7 := a2 || '/7_hr.pdf'; o10 := a1 || '/10_exec.pdf';

  -- T1 structura: ai_inbox_obj_all scoasă; exact INSERT / SELECT / DELETE pentru authenticated; nicio politică UPDATE / ALL pe bucket;
  --    trigger BEFORE UPDATE (INVOKER) + BEFORE INSERT (DEFINER) pe rând, funcții fără EXECUTE pentru roluri; index UNIC pe fisier_path
  PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'ai_inbox_obj_all')
    AND (SELECT string_agg(policyname || ':' || cmd || ':' || permissive || ':' || roles::text, ',' ORDER BY policyname) FROM pg_policies
          WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'ai_inbox_obj%')
        = 'ai_inbox_obj_delete:DELETE:PERMISSIVE:{authenticated},ai_inbox_obj_insert:INSERT:PERMISSIVE:{authenticated},ai_inbox_obj_select:SELECT:PERMISSIVE:{authenticated}'
    AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('UPDATE', 'ALL')
                     AND position(b IN coalesce(qual, '') || coalesce(with_check, '')) > 0)
    AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_ai_inbox_fisier_imutabil' AND t.tgrelid = 'public.ai_documente_inbox'::regclass
                 AND t.tgfoid = fn AND t.tgtype = 19 AND t.tgenabled = 'O')
    AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn)
    AND NOT has_function_privilege('authenticated', fn, 'EXECUTE') AND NOT has_function_privilege('service_role', fn, 'EXECUTE')
    AND NOT has_function_privilege('anon', fn, 'EXECUTE')
    AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_ai_inbox_fisier_legat' AND t.tgrelid = 'public.ai_documente_inbox'::regclass
                 AND t.tgfoid = fl AND t.tgtype = 7 AND t.tgenabled = 'O')
    AND (SELECT prosecdef FROM pg_proc WHERE oid = fl)
    AND NOT has_function_privilege('authenticated', fl, 'EXECUTE') AND NOT has_function_privilege('service_role', fl, 'EXECUTE')
    AND NOT has_function_privilege('anon', fl, 'EXECUTE')
    AND (SELECT indisunique FROM pg_index WHERE indexrelid = to_regclass('public.idx_ai_inbox_fisier_path')),
    'T1 structura: ai_inbox_obj_all scoasă; insert / select / delete pentru authenticated; fără UPDATE / ALL; trigger-e imutabil (INVOKER) + legat (DEFINER) fără EXECUTE; index UNIC fisier_path');

  -- T2 ce vede fiecare (listare = SELECT pe storage.objects, ca list() / download / createSignedUrl din storage-api)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, 'SELECT 1', lista),
    'ok:1:10_exec.pdf,1_ci.pdf,2_nedecis.pdf,3_rca.pdf,4_contract.pdf,5_cert.pdf,6_orfan.pdf,9_upa.pdf',
    'T2a cine a urcat vede tot ce a urcat (și orfanul, și rândul UPA / Execuție fără proiect), nimic din ce au urcat alții');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a2, 'SELECT 1', lista), 'ok:1:1_ci.pdf,2_nedecis.pdf,7_hr.pdf,CI.pdf',
    'T2b HR: rândurile HR (și ale altora) + ce a urcat el (inclusiv calea wizard-ului) + nedecisul; nimic din logistică / execuție / financiar / UPA / orfan');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a3, 'SELECT 1', lista), 'ok:1:' || tot, 'T2c owner: tot (și orfanul)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a4, 'SELECT 1', lista), 'ok:1:2_nedecis.pdf',
    'T2d fără drepturi: doar nedecisul (limitarea a — ca rândul însuși); actele HR NU (gaura închisă)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a5, 'SELECT 1', lista), 'ok:1:2_nedecis.pdf,3_rca.pdf', 'T2e admin_logistica: coada logistică + nedecis');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a6, 'SELECT 1', lista), 'ok:1:2_nedecis.pdf,4_contract.pdf',
    'T2f MP: proiectul lui din Execuție + nedecis; Execuție fără proiect = doar owner (ca rândul)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a7, 'SELECT 1', lista), 'ok:1:2_nedecis.pdf,5_cert.pdf', 'T2g financiar: coada financiar + nedecis');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a8, 'SELECT 1', lista), 'ok:1:-', 'T2h cont fără profil: nimic (funcția de drept = false)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', NULL, 'SELECT 1', lista), 'ok:1:-',
    'T2i authenticated FĂRĂ uid: nimic (fn_ai_inbox_poate_confirma ar da true pentru uid NULL — politicile cer uid)');
  PERFORM pg_temp.eq(pg_temp.efect('anon', NULL, 'SELECT 1', lista), 'ok:1:-', 'T2j anon: nimic');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL, 'SELECT 1', lista), 'ok:1:' || tot, 'T2k service_role (edge citeste-orice / cleanup): tot');

  -- T3 upload (INSERT; storage-api face INSERT … RETURNING cu identitatea apelantului; upsert:false peste tot în cod)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L)', b, a1 || '/11_nou.pdf', a1, a1)), 'ok:1',
    'T3a panou: în folderul propriu (uid/…) → permis');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L) RETURNING id', b, a1 || '/sub/12.pdf', a1, a1)), 'ok:1',
    'T3b INSERT … RETURNING (forma storage-api), și cu subfolder sub uid → permis');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L)', b, a4 || '/fals.pdf', a1, a1)), 'err:42501',
    'T3c în folderul altcuiva → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L)', b, 'radacina.pdf', a1, a1)), 'err:42501',
    'T3d în rădăcina bucket-ului → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L)', b, a1, a1, a1)), 'err:42501',
    'T3e obiect numit exact uid-ul (fără folder) → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a4, ins || format('(%L, %L, %L, %L)', b, 'wizard-angajare/9_x/CI.pdf', a4, a4)), 'err:42501',
    'T3f wizard-angajare/… fără drept HR → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a2, ins || format('(%L, %L, %L, %L)', b, 'wizard-angajare/9_x/CI.pdf', a2, a2)), 'ok:1',
    'T3g wizard-angajare/… cu can_access_personal_data → permis (calea de azi a wizard-ului)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a3, ins || format('(%L, %L, %L, %L)', b, 'wizard-angajare/9_y/CI.pdf', a3, a3)), 'ok:1',
    'T3h wizard-angajare/… ca owner → permis');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a8, ins || format('(%L, %L, %L, %L)', b, a8 || '/x.pdf', a8, a8), lista), 'ok:1:x.pdf',
    'T3i cont fără profil: urcă în folderul propriu și își vede doar fișierul (paritate cu ai_inbox_insert)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', NULL, ins || format('(%L, %L, NULL, NULL)', b, 'null/x.pdf')), 'err:42501',
    'T3j authenticated fără uid → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('anon', NULL, ins || format('(%L, %L, NULL, NULL)', b, 'anon/x.pdf')), 'err:42501', 'T3k anon → refuz');
  -- căi-limită (primul segment se compară EXACT, ca text); ce face storage-api cu ele se verifică pe branch (plan, pasul 4)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L)', b, '/' || a1 || '/x.pdf', a1, a1)), 'err:42501',
    'T3l cale cu „/” la început (primul segment gol) → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L)', b, '../' || a1 || '/x.pdf', a1, a1)), 'err:42501',
    'T3m „../uid/…” (primul segment „..”) → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L)', b, upper(a1) || '/x.pdf', a1, a1)), 'err:42501',
    'T3n uid cu MAJUSCULE în cale (≠ auth.uid()::text) → refuz (fail-closed)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L)', b, a1 || '//x.pdf', a1, a1)), 'ok:1',
    'T3o segment gol după uid („uid//x”) → permis: rămâne în folderul propriu');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L)', b, a1 || '/../' || a4 || '/z.pdf', a1, a1), lista),
    'ok:1:10_exec.pdf,1_ci.pdf,2_nedecis.pdf,3_rca.pdf,4_contract.pdf,5_cert.pdf,6_orfan.pdf,9_upa.pdf,z.pdf',
    'T3p „uid/../altul/z” → permis la nivel SQL (numele e literal, sub folderul propriu; owner_id = cine a urcat; altul nu-l vede)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a4, ins || format('(%L, %L, %L, %L)', b, a1 || '/../' || a4 || '/z.pdf', a4, a4)), 'err:42501',
    'T3q … dar altcineva nu scrie sub folderul uid-ului (a4 cu „a1/../a4/z”) → refuz');

  -- T4 suprascriere / mutare: fără politică UPDATE nimeni (în afară de service_role) nu atinge obiectele existente
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, format('UPDATE storage.objects SET metadata = %L::jsonb WHERE bucket_id = %L AND name = %L', '{"x":1}', b, o1)),
    'ok:0', 'T4a cine a urcat nu-și mai suprascrie obiectul (UPDATE = 0 rânduri)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a3, format('UPDATE storage.objects SET name = %L WHERE bucket_id = %L AND name = %L', a3 || '/mutat.pdf', b, o1)),
    'ok:0', 'T4b nici ownerul nu mută (move = UPDATE name) prin API');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a4, format('UPDATE storage.objects SET owner_id = %L WHERE bucket_id = %L', a4, b)),
    'ok:0', 'T4c atacatorul nu-și pune owner_id pe obiectele altora');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, ins || format('(%L, %L, %L, %L) ON CONFLICT (bucket_id, name) DO UPDATE SET metadata = %L::jsonb', b, o1, a1, a1, '{"x":1}')),
    'err:42501', 'T4d upsert peste un obiect existent (upsert:true) → refuz');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL, format('UPDATE storage.objects SET metadata = %L::jsonb WHERE bucket_id = %L AND name = %L', '{"x":1}', b, o1)),
    'ok:1', 'T4e service_role neatins');

  -- T5 ștergere (remove = DELETE … RETURNING; aceeași expresie ca SELECT)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a4, format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o1)), 'ok:0', 'T5a fără drepturi nu șterge actul HR');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a5, format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o1)), 'ok:0', 'T5b logistica nu șterge actul HR');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a2, format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L RETURNING id', b, o1)), 'ok:1',
    'T5c HR șterge staging-ul HR după confirmare (DELETE … RETURNING)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o1)), 'ok:1', 'T5d cine a urcat își șterge fișierul');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o7)), 'ok:0', 'T5e nu și fișierul HR-ului');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a2, format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o6)), 'ok:0', 'T5f orfanul: HR nu');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a3, format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o6)), 'ok:1', 'T5g orfanul: ownerul da');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a4, format('DELETE FROM storage.objects WHERE bucket_id = %L', b)), 'ok:1',
    'T5h fără drepturi șterge DOAR nedecisul (limitarea a, documentată), nu restul bucket-ului');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL, format('DELETE FROM storage.objects WHERE bucket_id = %L', b)), 'ok:10', 'T5i service_role (cleanup-recycle-bin) neatins');

  -- T6 legătura obiect ↔ rând nu se poate falsifica (nici la INSERT, nici după)
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a4, rand || format('(%L, %L, %L, %L)', o1, 'x.pdf', 'in_asteptare', a4), NULL, true),
    m_leg, 'T6a rând nou „nedecis” cu calea actului HR al altcuiva (ai_inbox_insert l-ar permite) → refuz 42501 la INSERT (trg_ai_inbox_fisier_legat)');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a4, format('UPDATE public.ai_documente_inbox SET fisier_path = %L WHERE id = 602', o1), NULL, true),
    m_imut, 'T6b rândul nedecis (editabil de oricine) nu primește altă cale → 23514');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a4, format('UPDATE public.ai_documente_inbox SET uploadat_de = %L WHERE id = 602', a4), NULL, true),
    m_imut, 'T6c … nici alt uploadat_de');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a4, 'UPDATE public.ai_documente_inbox SET fisier_nume = ''alt.pdf'' WHERE id = 602', NULL, true),
    m_imut, 'T6d … nici alt fisier_nume');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a4, 'UPDATE public.ai_documente_inbox SET fisier_size_bytes = 1 WHERE id = 602', NULL, true),
    m_imut, 'T6e … nici altă mărime');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a4, 'UPDATE public.ai_documente_inbox SET fisier_mime = NULL WHERE id = 602', NULL, true),
    m_imut, 'T6f … nici alt tip MIME');
  PERFORM pg_temp.like(pg_temp.efect('service_role', NULL, format('UPDATE public.ai_documente_inbox SET fisier_path = %L WHERE id = 601', o7), NULL, true),
    m_imut, 'T6g nemodificabil și pentru service_role');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, 'UPDATE public.ai_documente_inbox SET fisier_path = fisier_path, uploadat_de = uploadat_de WHERE id = 601'),
    'ok:1', 'T6h același fișier (SET col = col) trece');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL,
      'UPDATE public.ai_documente_inbox SET status = ''clasificat'', modul_tinta = ''hr'', payload_ai = ''{}''::jsonb, ai_eroare = NULL, fisier_sters_la = now() WHERE id IN (601, 602)'),
    'ok:2', 'T6i edge-urile (clasificare, curățenie) își fac UPDATE-urile ca înainte');
  PERFORM pg_temp.eq(pg_temp.cu(format('%s(%L, %L, %L, %L);;INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, status, uploadat_de) VALUES (%L, %L, %L, %L)',
        ins, b, a4 || '/fals.pdf', a4, a4, a4 || '/fals.pdf', 'fals.pdf', 'clasificat', a1), 'authenticated', a5, 'SELECT 1', lista),
    'ok:1:2_nedecis.pdf,3_rca.pdf', 'T6j rând nedecis cu uploadat_de ≠ owner_id-ul obiectului (pus pe ocolite, ca service_role) → nu leagă');
  PERFORM pg_temp.eq(pg_temp.cu(format('%s(%L, %L, %L, %L);;INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, status, uploadat_de) VALUES (%L, %L, %L, %L)',
        ins, b, a4 || '/fals.pdf', a4, a4, a4 || '/fals.pdf', 'fals.pdf', 'clasificat', a4), 'authenticated', a5, 'SELECT 1', lista),
    'ok:1:2_nedecis.pdf,3_rca.pdf,fals.pdf', 'T6k … cu uploadat_de = owner_id → leagă (controlul lui T6j)');
  PERFORM pg_temp.eq(pg_temp.cu(format('%s(%L, %L, NULL, NULL);;INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, status, modul_tinta, uploadat_de) VALUES (%L, %L, %L, %L, %L)',
        ins, b, a1 || '/fara_owner.pdf', a1 || '/fara_owner.pdf', 'f.pdf', 'clasificat', 'hr', a1), 'authenticated', a2, 'SELECT 1', lista),
    'ok:1:1_ci.pdf,2_nedecis.pdf,7_hr.pdf,CI.pdf', 'T6l obiect fără owner_id: nu se leagă de rând (fail-closed; doar ownerul îl vede)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a4, 'UPDATE public.ai_documente_inbox SET modul_tinta = ''hr'' WHERE id = 602'),
    'err:42501', 'T6m rândul nedecis nu se mută într-un modul în care cel care mută nu-l mai vede (RLS aplică ai_inbox_select și rândului nou)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a2, 'UPDATE public.ai_documente_inbox SET modul_tinta = NULL WHERE id = 601'),
    'ok:1', 'T6n limitarea b: HR poate muta un rând HR în „nedecis” (îl vede și acolo) …');
  PERFORM pg_temp.eq(pg_temp.cu('UPDATE public.ai_documente_inbox SET modul_tinta = NULL WHERE id = 601', 'authenticated', a4, 'SELECT 1', lista),
    'ok:1:1_ci.pdf,2_nedecis.pdf', 'T6o … și atunci actul devine vizibil oricui (insider cu drept HR; decizie separată pe ai_inbox_update)');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a4, rand || format('(%L, %L, %L, %L)', a4 || '/nu_exista.pdf', 'n.pdf', 'in_asteptare', a4), NULL, true),
    m_leg, 'T6p rând pentru un fișier care nu există (nici măcar în folderul propriu) → refuz, același mesaj (fără oracol)');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a4, rand || format('(%L, %L, %L, %L)', o1, 'x.pdf', 'in_asteptare', a1), NULL, true),
    m_leg, 'T6q rând în numele victimei (uploadat_de = cine a urcat actul, ≠ apelantul) → refuz la trigger (independent de ai_inbox_insert)');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a2, rand || format('(%L, %L, %L, %L)', o1, 'x.pdf', 'in_asteptare', a2), NULL, true),
    m_leg, 'T6r HR VEDE actul lui a1 (clauza b), dar nu-și leagă un rând nou de el → refuz (contează owner_id, nu vizibilitatea)');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a3, rand || format('(%L, %L, %L, %L)', o6, 'x.pdf', 'in_asteptare', a3), NULL, true),
    m_leg, 'T6s nici ownerul (vede tot) nu leagă un rând de fișierul altcuiva');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, rand || format('(%L, %L, %L, %L)', o6, 'orfan.pdf', 'in_asteptare', a1)),
    'ok:1', 'T6t cine a urcat orfanul îi poate crea rândul (fișier propriu, încă fără rând)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1, rand || format('(%L, %L, %L, %L)', o1, 'CI.pdf', 'in_asteptare', a1)),
    'err:23505', 'T6u al doilea rând pentru același fișier (chiar al lui) → refuz: un fișier = un rând (index unic)');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL, rand || format('(%L, %L, %L, %L)', 'srv/x.pdf', 'x.pdf', 'in_asteptare', a1)),
    'ok:1', 'T6v service_role (fără uid) neatins de legătură — ocolește oricum RLS-ul; azi nu creează rânduri');

  -- T7 fluxurile din cod, cap-coadă (SQL-ul echivalent al apelurilor storage-js + PostgREST)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1,
      ins || format('(%L, %L, %L, %L);;', b, a1 || '/13_dubla.pdf', a1, a1) || format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, a1 || '/13_dubla.pdf')),
    'ok:2', 'T7a panou: upload, INSERT-ul rândului pică (dublură) → își șterge fișierul fără rând');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a1,
      ins || format('(%L, %L, %L, %L);;', b, a1 || '/14.pdf', a1, a1)
      || format('INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, status, uploadat_de) VALUES (%L, %L, %L, %L);;', a1 || '/14.pdf', '14.pdf', 'in_asteptare', a1)
      || format('UPDATE public.ai_documente_inbox SET status = %L, modul_tinta = %L WHERE fisier_path = %L', 'clasificat', 'hr', a1 || '/14.pdf'),
      'SELECT count(*)::text FROM storage.objects WHERE name = ''' || a1 || '/14.pdf'''),
    'ok:3:1', 'T7b panou: upload + rând + clasificat în HR — cine a urcat îl vede în continuare (previzualizare)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a2,
      format('SELECT 1 FROM storage.objects WHERE bucket_id = %L AND name = %L;;', b, o1)
      || format('UPDATE public.ai_documente_inbox SET status = %L, confirmat_de = %L, confirmat_la = now(), confirmat_ref_id = 1 WHERE id = 601 AND status IN (%L, %L);;', 'confirmat', a2, 'clasificat', 'eroare')
      || format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o1)),
    'ok:3', 'T7c HR confirmă actul altcuiva: descarcă (mutaFisier), închide rândul, șterge staging-ul (finalizeInbox)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a2,
      ins || format('(%L, %L, %L, %L);;', b, 'wizard-angajare/2_x/CI.pdf', a2, a2)
      || format('INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, fisier_mime, status, uploadat_de) VALUES (%L, %L, %L, %L, %L);;', 'wizard-angajare/2_x/CI.pdf', 'CI.pdf', 'application/pdf', 'in_asteptare', a2)
      || format('SELECT 1 FROM storage.objects WHERE bucket_id = %L AND name = %L;;', b, 'wizard-angajare/2_x/CI.pdf')
      || format('UPDATE public.ai_documente_inbox SET modul_tinta = %L WHERE fisier_path = %L;;', 'hr', 'wizard-angajare/2_x/CI.pdf')
      || format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, 'wizard-angajare/2_x/CI.pdf')),
    'ok:5', 'T7d wizard „Angajat nou”: upload sub wizard-angajare/, rând, descărcare la Finish, trecere pe HR, ștergerea staging-ului');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a2, format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, 'wizard-angajare/1_abc/CI.pdf')),
    'ok:1', 'T7e wizard scoateDoc / abandon: își șterge fișierul');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a6,
      format('SELECT 1 FROM storage.objects WHERE bucket_id = %L AND name = %L;;', b, o4)
      || format('UPDATE public.ai_documente_inbox SET status = %L, confirmat_de = %L WHERE id = 604;;', 'confirmat', a6)
      || format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o4)),
    'ok:3', 'T7f MP confirmă documentul proiectului lui (Execuție)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a6, format('SELECT 1 FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o10)),
    'ok:0', 'T7g MP nu descarcă documentul Execuție fără proiect (ca rândul: owner-only)');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a5, format('SELECT 1 FROM storage.objects WHERE bucket_id = %L AND name IN (%L, %L)', b, a1 || '/3_rca.pdf', o1)),
    'ok:1', 'T7h logistica descarcă documentul flotei, nu actul HR');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a4,
      format('SELECT 1 FROM storage.objects WHERE bucket_id = %L AND name = %L;;', b, o2)
      || format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', b, o2)),
    'ok:2', 'T7i Execuție confirmă un rând nedecis (oricine logat — limitarea a, paritate cu panoul)');

  -- T9 atacurile indirecte prin service_role (edge citeste-orice descarcă row.fisier_path; cleanup-recycle-bin șterge fișierele
  --    rândurilor „respins”): atacatorul nu mai are un rând care să arate spre fișierul altcuiva, deci edge-urile ating doar ce a urcat el
  PERFORM pg_temp.eq(pg_temp.cu(
      format('%s(%L, %L, %L, %L)', ins, b, a4 || '/al_meu.pdf', a4, a4), 'authenticated', a4,
      rand || format('(%L, %L, %L, %L);;', a4 || '/al_meu.pdf', 'al_meu.pdf', 'in_asteptare', a4)
      || format('UPDATE public.ai_documente_inbox SET status = %L, respins_motiv = %L WHERE fisier_path = %L', 'respins', 'x', a4 || '/al_meu.pdf'),
      format('SELECT string_agg(i.fisier_path, %L ORDER BY i.id) FROM public.ai_documente_inbox i WHERE i.status = %L AND i.uploadat_de = %L', ',', 'respins', a4)),
    'ok:2:' || a4 || '/al_meu.pdf', 'T9a atacatorul își respinge rândul: curățenia vede doar calea fișierului LUI (cel fals fusese refuzat la INSERT)');
  PERFORM pg_temp.eq(pg_temp.efect('service_role', NULL, 'SELECT 1',
      $q$SELECT count(*)::text FROM public.ai_documente_inbox i JOIN storage.objects o ON o.bucket_id = 'ai-documente-inbox' AND o.name = i.fisier_path
          WHERE o.owner_id IS DISTINCT FROM i.uploadat_de::text$q$),
    'ok:1:0', 'T9b invariantul pe care se bazează edge-urile: niciun rând nu arată spre obiectul altui cont decât uploadat_de');
  PERFORM pg_temp.like(pg_temp.efect('authenticated', a4, rand || format('(%L, %L, %L, %L)', o7, 'cazier.pdf', 'respins', a4), NULL, true),
    m_leg, 'T9c rând „respins” direct, cu calea cazierului HR → refuz la INSERT (curățenia nu mai are ce șterge din fișierele altora)');

  -- T8 celelalte bucket-uri: neatinse (aceleași politici, aceleași drepturi)
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a2, 'SELECT 1 FROM storage.objects WHERE bucket_id = ''documente-personal'''), 'ok:1', 'T8a documente-personal: HR vede ca înainte');
  PERFORM pg_temp.eq(pg_temp.efect('authenticated', a4, 'SELECT 1 FROM storage.objects WHERE bucket_id = ''documente-personal'''), 'ok:0', 'T8b documente-personal: fără drepturi nu vede, ca înainte');
END $t$;

ROLLBACK;
SELECT 'SUITA_OK';
