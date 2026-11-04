-- DRY 20261130e_redari_corespondenta_fisiere. Runner: o singura tranzactie ANULATA (migrare + teste + revenire + ROLLBACK).
-- Date fictive: doua corespondente Z1 / Z2 pe proiectul TEST-RAZVAN si obiecte fictive in storage.objects (bucket redari), toate anulate la ROLLBACK.
-- Identitati: owner / editor / viewer reale din user_module_access (ca DRY-ul 20261129h), simulate prin request.jwt.claims + SET LOCAL ROLE.
CREATE FUNCTION pg_temp.r30e_ca(p_uid uuid,p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol='postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims','',true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',CASE WHEN p_uid IS NULL THEN jsonb_build_object('role',p_rol)::text ELSE jsonb_build_object('sub',p_uid,'role',p_rol)::text END,true);
  EXECUTE format('SET LOCAL ROLE %I',p_rol);
END $h$;
CREATE FUNCTION pg_temp.r30e_refuza(p_sql text,p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE=p_stare;
END $h$;
CREATE FUNCTION pg_temp.r30e_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r30e.'||p,true),''); $h$;
-- insert de fisier (textul SQL), ca sa poata fi folosit si prin r30e_refuza
CREATE FUNCTION pg_temp.r30e_ins(p_cod text,p_rol text,p_path text,p_sha text) RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT format($q$INSERT INTO public.red_corespondenta_fisiere(corespondenta_id,rol,path,nume_original,mime,marime,sha256) VALUES (%L,%L,%L,'test.pdf','application/pdf',5,%L)$q$,
                pg_temp.r30e_g(p_cod), p_rol, p_path, p_sha);
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30e_ca(uuid,text),pg_temp.r30e_refuza(text,text),pg_temp.r30e_g(text),pg_temp.r30e_ins(text,text,text,text) TO authenticated,anon,service_role;

-- TEST0: garda, identitati, date fictive (ca postgres = mentenanta)
DO $t$
DECLARE own uuid; ed uuid; vw uuid; pr uuid; z1 uuid; z2 uuid; pfx text := 'TEST-RAZVAN/corespondenta/';
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261130e_redari_corespondenta_fisiere:'||txid_current() THEN RAISE EXCEPTION 'TEST0 FAIL: garda'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level IN ('editor','admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level='editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte WHERE cod='TEST-RAZVAN';
  IF own IS NULL OR ed IS NULL OR vw IS NULL OR pr IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect TEST-RAZVAN lipsa'; END IF;
  INSERT INTO public.red_corespondenta(proiect_id,cod,ordine,destinatar,subiect) VALUES (pr,'Z1',901,'Destinatar test','Subiect test') RETURNING id INTO z1;
  INSERT INTO public.red_corespondenta(proiect_id,cod,ordine,destinatar,subiect) VALUES (pr,'Z2',902,'Destinatar test 2','Subiect test 2') RETURNING id INTO z2;
  PERFORM set_config('r30e.owner',own::text,true); PERFORM set_config('r30e.editor',ed::text,true); PERFORM set_config('r30e.viewer',vw::text,true);
  PERFORM set_config('r30e.Z1',z1::text,true); PERFORM set_config('r30e.Z2',z2::text,true);
  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
    ('redari',pfx||'Z1/20261104-100000-aaaaaaaa-scrisoare.pdf','{"mimetype":"application/pdf","size":1000}'::jsonb),
    ('redari',pfx||'Z1/20261104-100001-bbbbbbbb-scrisoare-v2.pdf','{"mimetype":"application/pdf","size":2000}'::jsonb),
    ('redari',pfx||'Z1/20261104-100002-cccccccc-scrisoare-v3.pdf','{"mimetype":"application/pdf","size":3000}'::jsonb),
    ('redari',pfx||'Z1/20261104-100003-dddddddd-dovada.pdf','{"mimetype":"application/pdf","size":400}'::jsonb),
    ('redari',pfx||'Z1/20261104-100004-eeeeeeee-tarziu.pdf','{"mimetype":"application/pdf","size":500}'::jsonb),
    ('redari',pfx||'Z1/20261104-100005-ffffffff-orfan.pdf','{"mimetype":"application/pdf","size":600}'::jsonb),
    ('redari',pfx||'Z2/20261104-100006-11111111-dovada.pdf','{"mimetype":"application/pdf","size":700}'::jsonb),
    ('redari','TEST-RAZVAN/TST/0001/test-v1.docx','{"mimetype":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":800}'::jsonb);
  IF (SELECT count(*) FROM public.red_corespondenta WHERE cod IN ('D1','D2') AND stare='trimis' AND aprobat_fisier_id IS NULL) <> 2 THEN RAISE EXCEPTION 'TEST0 FAIL: D1/D2 istorice'; END IF;
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1: viewer-ul citeste, dar nu urca
SELECT pg_temp.r30e_ca(pg_temp.r30e_g('viewer')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30e_refuza(pg_temp.r30e_ins('Z1','de_trimis','TEST-RAZVAN/corespondenta/Z1/20261104-100000-aaaaaaaa-scrisoare.pdf',repeat('a',64)),'42501') THEN RAISE EXCEPTION 'TEST1 FAIL: viewer urca'; END IF;
  PERFORM count(*) FROM public.red_corespondenta_fisiere;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: editorul urca doar cu obiect existent si cale corecta; autorul / marimea le pune serverul; UPDATE / DELETE refuzate; nu aproba
SELECT pg_temp.r30e_ca(pg_temp.r30e_g('editor')::uuid,'authenticated');
DO $t$ DECLARE v1 integer; v2 integer; BEGIN
  IF NOT pg_temp.r30e_refuza(pg_temp.r30e_ins('Z1','de_trimis','TEST-RAZVAN/corespondenta/Z1/20261104-999999-00000000-lipsa.pdf',repeat('a',64)),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: obiect inexistent'; END IF;
  IF NOT pg_temp.r30e_refuza(pg_temp.r30e_ins('Z1','dovada_trimitere','TEST-RAZVAN/corespondenta/Z2/20261104-100006-11111111-dovada.pdf',repeat('a',64)),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: cale din alt rand'; END IF;
  IF NOT pg_temp.r30e_refuza(pg_temp.r30e_ins('Z1','altul','TEST-RAZVAN/TST/0001/test-v1.docx',repeat('a',64)),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: cale in afara corespondentei'; END IF;
  IF NOT pg_temp.r30e_refuza(pg_temp.r30e_ins('Z1','de_trimis','TEST-RAZVAN/corespondenta/Z1/20261104-100000-aaaaaaaa-scrisoare.pdf','NU-E-SHA'),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: sha invalid'; END IF;
  IF NOT pg_temp.r30e_refuza(pg_temp.r30e_ins('Z1','alt_rol','TEST-RAZVAN/corespondenta/Z1/20261104-100000-aaaaaaaa-scrisoare.pdf',repeat('a',64)),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: rol invalid'; END IF;
  SELECT versiune INTO v1 FROM public.red_corespondenta WHERE id=pg_temp.r30e_g('Z1')::uuid;
  EXECUTE pg_temp.r30e_ins('Z1','de_trimis','TEST-RAZVAN/corespondenta/Z1/20261104-100000-aaaaaaaa-scrisoare.pdf',repeat('a',64));
  SELECT versiune INTO v2 FROM public.red_corespondenta WHERE id=pg_temp.r30e_g('Z1')::uuid;
  IF v2 <> v1 + 1 THEN RAISE EXCEPTION 'TEST2 FAIL: de_trimis nu creste versiunea parintelui (CAS)'; END IF;
  IF (SELECT created_by IS DISTINCT FROM pg_temp.r30e_g('editor')::uuid OR marime <> 1000 FROM public.red_corespondenta_fisiere WHERE sha256=repeat('a',64)) THEN RAISE EXCEPTION 'TEST2 FAIL: autor / marime din Storage'; END IF;
  IF NOT pg_temp.r30e_refuza(pg_temp.r30e_ins('Z1','dovada_trimitere','TEST-RAZVAN/corespondenta/Z1/20261104-100000-aaaaaaaa-scrisoare.pdf',repeat('9',64)),'23505') THEN RAISE EXCEPTION 'TEST2 FAIL: aceeasi cale de doua ori'; END IF;
  EXECUTE pg_temp.r30e_ins('Z1','de_trimis','TEST-RAZVAN/corespondenta/Z1/20261104-100001-bbbbbbbb-scrisoare-v2.pdf',repeat('b',64));
  EXECUTE pg_temp.r30e_ins('Z2','dovada_trimitere','TEST-RAZVAN/corespondenta/Z2/20261104-100006-11111111-dovada.pdf',repeat('1',64));
  IF NOT pg_temp.r30e_refuza($q$UPDATE public.red_corespondenta_fisiere SET observatii='x'$q$,'42501') THEN RAISE EXCEPTION 'TEST2 FAIL: editor UPDATE'; END IF;
  IF NOT pg_temp.r30e_refuza($q$DELETE FROM public.red_corespondenta_fisiere$q$,'42501') THEN RAISE EXCEPTION 'TEST2 FAIL: editor DELETE'; END IF;
  IF NOT pg_temp.r30e_refuza(format($q$UPDATE public.red_corespondenta SET stare='aprobat' WHERE id=%L$q$,pg_temp.r30e_g('Z1')),'42501') THEN RAISE EXCEPTION 'TEST2 FAIL: editor aproba'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;

-- TEST3: owner-ul: fara de_trimis -> refuz; cu de_trimis -> aprobarea retine ULTIMUL fisier de_trimis (id + sha256)
SELECT pg_temp.r30e_ca(pg_temp.r30e_g('owner')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30e_refuza(format($q$UPDATE public.red_corespondenta SET stare='aprobat' WHERE id=%L$q$,pg_temp.r30e_g('Z2')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: aprobare fara de_trimis (doar dovada)'; END IF;
  UPDATE public.red_corespondenta SET stare='aprobat' WHERE id=pg_temp.r30e_g('Z1')::uuid;
  IF (SELECT c.aprobat_fisier_id IS DISTINCT FROM f.id OR c.aprobat_sha256 IS DISTINCT FROM repeat('b',64) OR c.aprobat_de IS DISTINCT FROM pg_temp.r30e_g('owner')::uuid
        FROM public.red_corespondenta c JOIN public.red_corespondenta_fisiere f ON f.sha256=repeat('b',64) WHERE c.id=pg_temp.r30e_g('Z1')::uuid) THEN
    RAISE EXCEPTION 'TEST3 FAIL: aprobarea nu retine ultimul de_trimis';
  END IF;
  RAISE NOTICE 'TEST3 OK';
END $t$;

-- TEST4: editorul nu poate scrie aprobat_fisier_id; un de_trimis nou dupa aprobare -> draft, aprobat_* golite
SELECT pg_temp.r30e_ca(pg_temp.r30e_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_corespondenta SET aprobat_fisier_id=NULL, aprobat_sha256=repeat('0',64), observatii='test' WHERE id=pg_temp.r30e_g('Z1')::uuid;
  IF (SELECT aprobat_sha256 IS DISTINCT FROM repeat('b',64) OR aprobat_fisier_id IS NULL FROM public.red_corespondenta WHERE id=pg_temp.r30e_g('Z1')::uuid) THEN RAISE EXCEPTION 'TEST4 FAIL: aprobat_* scrise din aplicatie'; END IF;
  EXECUTE pg_temp.r30e_ins('Z1','de_trimis','TEST-RAZVAN/corespondenta/Z1/20261104-100002-cccccccc-scrisoare-v3.pdf',repeat('c',64));
  IF (SELECT stare<>'draft' OR aprobat_la IS NOT NULL OR aprobat_de IS NOT NULL OR aprobat_fisier_id IS NOT NULL OR aprobat_sha256 IS NOT NULL FROM public.red_corespondenta WHERE id=pg_temp.r30e_g('Z1')::uuid) THEN
    RAISE EXCEPTION 'TEST4 FAIL: aprobarea nu a cazut la de_trimis nou';
  END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;

-- TEST5: owner reaproba (-> v3); dupa trimis: de_trimis refuzat, dovada acceptata
SELECT pg_temp.r30e_ca(pg_temp.r30e_g('owner')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_corespondenta SET stare='aprobat' WHERE id=pg_temp.r30e_g('Z1')::uuid;
  IF (SELECT aprobat_sha256 IS DISTINCT FROM repeat('c',64) FROM public.red_corespondenta WHERE id=pg_temp.r30e_g('Z1')::uuid) THEN RAISE EXCEPTION 'TEST5 FAIL: reaprobare'; END IF;
  RAISE NOTICE 'TEST5a OK';
END $t$;
SELECT pg_temp.r30e_ca(pg_temp.r30e_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_corespondenta SET stare='trimis', trimis_la='2026-11-04' WHERE id=pg_temp.r30e_g('Z1')::uuid;
  IF (SELECT stare<>'trimis' OR aprobat_sha256 IS DISTINCT FROM repeat('c',64) FROM public.red_corespondenta WHERE id=pg_temp.r30e_g('Z1')::uuid) THEN RAISE EXCEPTION 'TEST5 FAIL: trimis pastreaza fisierul aprobat'; END IF;
  IF NOT pg_temp.r30e_refuza(pg_temp.r30e_ins('Z1','de_trimis','TEST-RAZVAN/corespondenta/Z1/20261104-100004-eeeeeeee-tarziu.pdf',repeat('e',64)),'23514') THEN RAISE EXCEPTION 'TEST5 FAIL: de_trimis dupa trimis'; END IF;
  EXECUTE pg_temp.r30e_ins('Z1','dovada_trimitere','TEST-RAZVAN/corespondenta/Z1/20261104-100003-dddddddd-dovada.pdf',repeat('d',64));
  IF (SELECT stare<>'trimis' FROM public.red_corespondenta WHERE id=pg_temp.r30e_g('Z1')::uuid) THEN RAISE EXCEPTION 'TEST5 FAIL: dovada schimba starea'; END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;

-- TEST6: storage — viewer-ul vede DOAR fisierele inregistrate sub /corespondenta/; editorul vede tot bucket-ul (red_storage_sel)
SELECT pg_temp.r30e_ca(pg_temp.r30e_g('viewer')::uuid,'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='redari' AND name='TEST-RAZVAN/corespondenta/Z1/20261104-100002-cccccccc-scrisoare-v3.pdf') <> 1 THEN RAISE EXCEPTION 'TEST6 FAIL: viewer nu vede fisierul inregistrat'; END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='redari' AND name='TEST-RAZVAN/corespondenta/Z1/20261104-100005-ffffffff-orfan.pdf') <> 0 THEN RAISE EXCEPTION 'TEST6 FAIL: viewer vede un orfan'; END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='redari' AND name='TEST-RAZVAN/TST/0001/test-v1.docx') <> 0 THEN RAISE EXCEPTION 'TEST6 FAIL: viewer vede in afara corespondentei'; END IF;
  IF (SELECT count(*) FROM public.red_corespondenta_fisiere f JOIN public.red_corespondenta c ON c.id=f.corespondenta_id WHERE c.cod IN ('Z1','Z2')) <> 5 THEN RAISE EXCEPTION 'TEST6 FAIL: viewer nu vede lista fisierelor'; END IF;
  RAISE NOTICE 'TEST6a OK';
END $t$;
SELECT pg_temp.r30e_ca(pg_temp.r30e_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='redari' AND name IN ('TEST-RAZVAN/corespondenta/Z1/20261104-100005-ffffffff-orfan.pdf','TEST-RAZVAN/TST/0001/test-v1.docx')) <> 2 THEN RAISE EXCEPTION 'TEST6 FAIL: editor'; END IF;
  RAISE NOTICE 'TEST6b OK';
END $t$;

-- TEST7: anon nu vede nimic; service_role nu modifica / sterge
SELECT pg_temp.r30e_ca(NULL,'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r30e_refuza('SELECT count(*) FROM public.red_corespondenta_fisiere','42501') THEN RAISE EXCEPTION 'TEST7 FAIL: anon citeste'; END IF;
  RAISE NOTICE 'TEST7a OK';
END $t$;
SELECT pg_temp.r30e_ca(NULL,'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.r30e_refuza($q$DELETE FROM public.red_corespondenta_fisiere$q$,'42501') OR NOT pg_temp.r30e_refuza($q$TRUNCATE public.red_corespondenta_fisiere$q$,'42501') THEN RAISE EXCEPTION 'TEST7 FAIL: service_role sterge'; END IF;
  RAISE NOTICE 'TEST7b OK';
END $t$;

-- TEST8: mentenanta: UPDATE / DELETE tot refuzate (trigger); aprobarea fara fisier permisa (D1/D2 istorice); continut schimbat goleste aprobarea
SELECT pg_temp.r30e_ca(NULL,'postgres');
DO $t$ BEGIN
  IF NOT pg_temp.r30e_refuza($q$UPDATE public.red_corespondenta_fisiere SET observatii='x'$q$,'23514') THEN RAISE EXCEPTION 'TEST8 FAIL: UPDATE mentenanta'; END IF;
  IF NOT pg_temp.r30e_refuza($q$DELETE FROM public.red_corespondenta_fisiere$q$,'23514') THEN RAISE EXCEPTION 'TEST8 FAIL: DELETE mentenanta'; END IF;
  UPDATE public.red_corespondenta SET stare='aprobat' WHERE id=pg_temp.r30e_g('Z2')::uuid;
  IF (SELECT aprobat_la IS NULL OR aprobat_fisier_id IS NOT NULL FROM public.red_corespondenta WHERE id=pg_temp.r30e_g('Z2')::uuid) THEN RAISE EXCEPTION 'TEST8 FAIL: mentenanta aproba fara fisier'; END IF;
  IF (SELECT count(*) FROM public.red_jurnal WHERE tabela='red_corespondenta_fisiere' AND actiune='insert') < 5 THEN RAISE EXCEPTION 'TEST8 FAIL: jurnal'; END IF;
  RAISE NOTICE 'TEST8 OK';
END $t$;
