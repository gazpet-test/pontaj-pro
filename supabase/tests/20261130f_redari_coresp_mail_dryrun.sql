-- DRY 20261130f_redari_coresp_mail (r3, varianta A: fara reluare / intentie). Runner: o singura tranzactie ANULATA (migrare + teste + revenire + ROLLBACK).
-- Date fictive: corespondentele Z1 / Z2 pe proiectul TEST-RAZVAN si obiecte fictive in storage.objects (bucket redari), toate anulate la ROLLBACK.
-- Identitati: owner / admin / editor / viewer reale din user_module_access (ca DRY-ul 20261130e), simulate prin request.jwt.claims + SET LOCAL ROLE.
-- Revenirea (rulata de runner dupa acest fisier) isi verifica singura md5-ul functiei de reguli (0705e04f… = 20261130e) si numaratorile arhivei.
CREATE FUNCTION pg_temp.r30f_ca(p_uid uuid,p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol='postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims','',true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',CASE WHEN p_uid IS NULL THEN jsonb_build_object('role',p_rol)::text ELSE jsonb_build_object('sub',p_uid,'role',p_rol)::text END,true);
  EXECUTE format('SET LOCAL ROLE %I',p_rol);
END $h$;
CREATE FUNCTION pg_temp.r30f_refuza(p_sql text,p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE=p_stare;
END $h$;
-- ca r30f_refuza, dar cere si un fragment din mesaj (motivul exact, L25)
CREATE FUNCTION pg_temp.r30f_refuza_m(p_sql text,p_stare text,p_mesaj text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE=p_stare AND SQLERRM LIKE '%'||p_mesaj||'%';
END $h$;
CREATE FUNCTION pg_temp.r30f_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r30f.'||p,true),''); $h$;
-- apelul RPC-ului cu versiunea si fisierul aprobat CURENTE ale randului (ce „vede” utilizatorul)
CREATE FUNCTION pg_temp.r30f_incepe(p_cod text) RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT format($q$SELECT public.fn_red_coresp_mail_incepe(%1$L, (SELECT versiune FROM public.red_corespondenta WHERE id=%1$L), (SELECT aprobat_fisier_id FROM public.red_corespondenta WHERE id=%1$L))$q$,
                pg_temp.r30f_g(p_cod));
$h$;
-- apelul cu versiune / fisier dati explicit (pentru testele „randul s-a schimbat”)
CREATE FUNCTION pg_temp.r30f_incepe_x(p_cod text,p_versiune integer,p_fisier text) RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT format($q$SELECT public.fn_red_coresp_mail_incepe(%L, %s, %L)$q$, pg_temp.r30f_g(p_cod), p_versiune, p_fisier);
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30f_ca(uuid,text),pg_temp.r30f_refuza(text,text),pg_temp.r30f_refuza_m(text,text,text),pg_temp.r30f_g(text),pg_temp.r30f_incepe(text),
  pg_temp.r30f_incepe_x(text,integer,text) TO authenticated,anon,service_role;

-- TEST0: garda, identitati, date fictive (ca postgres = mentenanta)
DO $t$
DECLARE own uuid; adm uuid; ed uuid; vw uuid; pr uuid; z1 uuid; z2 uuid; pfx text := 'TEST-RAZVAN/corespondenta/';
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261130f_redari_coresp_mail:'||txid_current() THEN RAISE EXCEPTION 'TEST0 FAIL: garda'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO adm FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='admin' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='editor' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte WHERE cod='TEST-RAZVAN';
  IF own IS NULL OR ed IS NULL OR vw IS NULL OR pr IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect TEST-RAZVAN lipsa'; END IF;
  IF adm IS NULL THEN adm := own; RAISE NOTICE 'TEST0: fara admin non-owner pe Redari, admin = owner (fn_red_nivel = admin)'; END IF;
  INSERT INTO public.red_corespondenta(proiect_id,cod,ordine,destinatar,subiect) VALUES (pr,'Z1',901,'Destinatar test','Subiect test') RETURNING id INTO z1;
  INSERT INTO public.red_corespondenta(proiect_id,cod,ordine,destinatar,subiect) VALUES (pr,'Z2',902,'Destinatar test 2','Subiect test 2') RETURNING id INTO z2;
  PERFORM set_config('r30f.owner',own::text,true); PERFORM set_config('r30f.admin',adm::text,true);
  PERFORM set_config('r30f.editor',ed::text,true); PERFORM set_config('r30f.viewer',vw::text,true);
  PERFORM set_config('r30f.Z1',z1::text,true); PERFORM set_config('r30f.Z2',z2::text,true); PERFORM set_config('r30f.pr',pr::text,true);
  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
    ('redari',pfx||'Z1/20261104-110000-aaaaaaaa-scrisoare.pdf','{"mimetype":"application/pdf","size":1000,"eTag":"\"etag-z1\""}'::jsonb),
    ('redari',pfx||'Z2/20261104-110001-bbbbbbbb-scrisoare.pdf','{"mimetype":"application/pdf","size":2000,"eTag":"\"etag-z2\""}'::jsonb);
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1: CHECK-urile e-mailurilor = tabelul de paritate din supabase/functions/_shared/redariCorespMail.mjs (CAZURI_EMAIL), pe constrangerile reale
DO $t$
DECLARE r record; v_ok boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('dccprunisorjupa@transgaz.ro',true,false),
    ('registratura@isc-mehedinti.ro',true,false),
    ('Office@Gazpet.ro',true,true),
    ('cristina.dumitrescu@gazpet.ro',true,true),
    ('a+b@gazpet.ro',true,true),
    ('x@gazpet.ro.evil.com',true,false),
    ('x@gazpet-ro.com',true,false),
    ('x@sub.gazpet.ro',true,false),
    ('x@gazpetXro',false,false),
    ('fara-arond.ro',false,false),
    ('a b@gazpet.ro',false,false),
    ('a@-gazpet.ro',false,false),
    ('a@gazpet',false,false),
    ('a@@gazpet.ro',false,false),
    ('<a@gazpet.ro>',false,false),
    (E'a@gazpet.ro\nBcc: b@x.ro',false,false),
    ('',false,false)
  ) AS c(v, valid, gazpet) LOOP
    BEGIN UPDATE public.red_corespondenta SET destinatar_email=r.v WHERE id=pg_temp.r30f_g('Z1')::uuid; v_ok := true;
    EXCEPTION WHEN check_violation THEN v_ok := false; END;
    IF v_ok IS DISTINCT FROM r.valid THEN RAISE EXCEPTION 'TEST1 FAIL: destinatar_email % (asteptat %)', r.v, r.valid; END IF;
    BEGIN UPDATE public.red_corespondenta SET expeditor_email=r.v WHERE id=pg_temp.r30f_g('Z1')::uuid; v_ok := true;
    EXCEPTION WHEN check_violation THEN v_ok := false; END;
    IF v_ok IS DISTINCT FROM r.gazpet THEN RAISE EXCEPTION 'TEST1 FAIL: expeditor_email % (asteptat %)', r.v, r.gazpet; END IF;
  END LOOP;
  IF NOT pg_temp.r30f_refuza(format($q$UPDATE public.red_corespondenta SET mail_subiect=E'a\nb' WHERE id=%L$q$,pg_temp.r30f_g('Z1')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: subiect pe doua randuri'; END IF;
  IF NOT pg_temp.r30f_refuza(format($q$UPDATE public.red_corespondenta SET mail_subiect='   ' WHERE id=%L$q$,pg_temp.r30f_g('Z1')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: subiect gol'; END IF;
  IF NOT pg_temp.r30f_refuza(format($q$UPDATE public.red_corespondenta SET mail_text=repeat('x',20001) WHERE id=%L$q$,pg_temp.r30f_g('Z1')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: text prea lung'; END IF;
  UPDATE public.red_corespondenta SET destinatar_email=NULL, expeditor_email=NULL WHERE id=pg_temp.r30f_g('Z1')::uuid;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST1b (r2, J-P2-4): baseline L15 trece pe starea curenta si refuza un trigger de reguli dezactivat / un fn_red_nivel cu corp schimbat
-- (fiecare abatere in subtranzactie anulata, refacuta automat)
DO $t$ BEGIN
  PERFORM public.fn_red_coresp_mail_verifica_baza('e49bf054b32057acea04c3913a5c76f5');
  IF NOT pg_temp.r30f_refuza_m($q$SELECT public.fn_red_coresp_mail_verifica_baza('0705e04f3e26656c2116b6d1b9f87c6e')$q$,'P0001','fn_red_corespondenta_reguli') THEN RAISE EXCEPTION 'TEST1b FAIL: md5 vechi acceptat'; END IF;
  BEGIN
    ALTER TABLE public.red_corespondenta DISABLE TRIGGER trg_red_corespondenta_reguli;
    IF NOT pg_temp.r30f_refuza_m($q$SELECT public.fn_red_coresp_mail_verifica_baza('e49bf054b32057acea04c3913a5c76f5')$q$,'P0001','trg_red_corespondenta_reguli') THEN RAISE EXCEPTION 'TEST1b FAIL: trigger dezactivat neprins'; END IF;
    RAISE EXCEPTION 'r30f_anuleaza';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'r30f_anuleaza' THEN RAISE; END IF;
  END;
  BEGIN
    CREATE OR REPLACE FUNCTION public.fn_red_nivel() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$ SELECT 'admin'::text $fn$;
    IF NOT pg_temp.r30f_refuza_m($q$SELECT public.fn_red_coresp_mail_verifica_baza('e49bf054b32057acea04c3913a5c76f5')$q$,'P0001','fn_red_nivel') THEN RAISE EXCEPTION 'TEST1b FAIL: fn_red_nivel schimbat neprins'; END IF;
    RAISE EXCEPTION 'r30f_anuleaza';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'r30f_anuleaza' THEN RAISE; END IF;
  END;
  BEGIN
    GRANT EXECUTE ON FUNCTION public.fn_red_corespondenta_reguli() TO authenticated;
    IF NOT pg_temp.r30f_refuza_m($q$SELECT public.fn_red_coresp_mail_verifica_baza('e49bf054b32057acea04c3913a5c76f5')$q$,'P0001','EXECUTE') THEN RAISE EXCEPTION 'TEST1b FAIL: EXECUTE nou neprins'; END IF;
    RAISE EXCEPTION 'r30f_anuleaza';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'r30f_anuleaza' THEN RAISE; END IF;
  END;
  PERFORM public.fn_red_coresp_mail_verifica_baza('e49bf054b32057acea04c3913a5c76f5');   -- refacut
  RAISE NOTICE 'TEST1b OK';
END $t$;

-- TEST2: editorul completeaza mailul + urca de_trimis; Z2 primeste doar fisier (fara campurile mailului)
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_corespondenta SET destinatar_email='registratura@isc-mehedinti.ro', mail_subiect='Documente de calitate', mail_text=E'Buna ziua,\nVa transmitem adresa.',
         expeditor_email='Cristina.Dumitrescu@gazpet.ro' WHERE id=pg_temp.r30f_g('Z1')::uuid;
  INSERT INTO public.red_corespondenta_fisiere(corespondenta_id,rol,path,nume_original,mime,marime,sha256,storage_etag)
    VALUES (pg_temp.r30f_g('Z1')::uuid,'de_trimis','TEST-RAZVAN/corespondenta/Z1/20261104-110000-aaaaaaaa-scrisoare.pdf','scrisoare.pdf','application/pdf',5,repeat('a',64),'x');
  INSERT INTO public.red_corespondenta_fisiere(corespondenta_id,rol,path,nume_original,mime,marime,sha256,storage_etag)
    VALUES (pg_temp.r30f_g('Z2')::uuid,'de_trimis','TEST-RAZVAN/corespondenta/Z2/20261104-110001-bbbbbbbb-scrisoare.pdf','scrisoare2.pdf','application/pdf',5,repeat('b',64),'x');
  -- RPC pe rand neaprobat -> refuz (fisierul confirmat = NULL ≠ ... → intai lipsa fisierului confirmat)
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe_x('Z1',(SELECT versiune FROM public.red_corespondenta WHERE id=pg_temp.r30f_g('Z1')::uuid),
         (SELECT id::text FROM public.red_corespondenta_fisiere WHERE sha256=repeat('a',64))),'23514','randul s-a schimbat') THEN RAISE EXCEPTION 'TEST2 FAIL: mail pe rand neaprobat'; END IF;
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe('Z1'),'23514','lipsesc versiunea sau fisierul') THEN RAISE EXCEPTION 'TEST2 FAIL: fara fisier confirmat'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;

-- TEST3: owner-ul aproba Z1 si Z2
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('owner')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_corespondenta SET stare='aprobat', aprobat_fisier_id=(SELECT id FROM public.red_corespondenta_fisiere WHERE sha256=repeat('a',64)) WHERE id=pg_temp.r30f_g('Z1')::uuid;
  UPDATE public.red_corespondenta SET stare='aprobat', aprobat_fisier_id=(SELECT id FROM public.red_corespondenta_fisiere WHERE sha256=repeat('b',64)) WHERE id=pg_temp.r30f_g('Z2')::uuid;
  IF (SELECT count(*) FROM public.red_corespondenta WHERE id IN (pg_temp.r30f_g('Z1')::uuid,pg_temp.r30f_g('Z2')::uuid) AND stare='aprobat' AND aprobat_storage_etag IS NOT NULL) <> 2 THEN RAISE EXCEPTION 'TEST3 FAIL: aprobare'; END IF;
  RAISE NOTICE 'TEST3 OK';
END $t$;

-- TEST4: schimbarea campurilor mailului dupa aprobare -> aprobarea cade (ca destinatar / subiect / expeditor / documente)
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('editor')::uuid,'authenticated');
DO $t$ DECLARE k text; BEGIN
  FOREACH k IN ARRAY ARRAY['mail_text','mail_subiect','destinatar_email','expeditor_email'] LOOP
    IF NOT pg_temp.r30f_refuza_m(format($q$UPDATE public.red_corespondenta SET %I = %L WHERE id=%L$q$, k,
         CASE WHEN k LIKE '%email' THEN 'alt.cineva@gazpet.ro' ELSE 'text schimbat' END, pg_temp.r30f_g('Z1')),'23514','continutul s-a schimbat dupa aprobare') THEN
      RAISE EXCEPTION 'TEST4 FAIL: % schimbat pe rand aprobat fara trecere in draft', k;
    END IF;
  END LOOP;
  UPDATE public.red_corespondenta SET mail_text=E'Buna ziua,\nText corectat.', stare='draft' WHERE id=pg_temp.r30f_g('Z1')::uuid;
  IF (SELECT stare<>'draft' OR aprobat_la IS NOT NULL OR aprobat_fisier_id IS NOT NULL FROM public.red_corespondenta WHERE id=pg_temp.r30f_g('Z1')::uuid) THEN RAISE EXCEPTION 'TEST4 FAIL: aprobarea nu a cazut'; END IF;
  -- campuri NE-continut (observatii) nu fac aprobarea sa cada
  UPDATE public.red_corespondenta SET observatii='nota' WHERE id=pg_temp.r30f_g('Z2')::uuid;
  IF (SELECT stare<>'aprobat' OR aprobat_la IS NULL FROM public.red_corespondenta WHERE id=pg_temp.r30f_g('Z2')::uuid) THEN RAISE EXCEPTION 'TEST4 FAIL: observatiile au facut aprobarea sa cada'; END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('owner')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_corespondenta SET stare='aprobat', aprobat_fisier_id=(SELECT id FROM public.red_corespondenta_fisiere WHERE sha256=repeat('a',64)) WHERE id=pg_temp.r30f_g('Z1')::uuid;
  RAISE NOTICE 'TEST4b OK (reaprobat)';
END $t$;

-- TEST5: viewer: nu porneste RPC-ul, nu insereaza in urma; anon: nimic; service_role: fara INSERT / UPDATE / DELETE pe urma
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('viewer')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe('Z1'),'42501','doar admin / editor') THEN RAISE EXCEPTION 'TEST5 FAIL: viewer porneste mailul'; END IF;
  IF NOT pg_temp.r30f_refuza(format($q$INSERT INTO public.red_corespondenta_mailuri(corespondenta_id,proiect_id,fisier_id,versiune_confirmata,fisier_etag,catre,cc,subiect,created_by)
       SELECT id, proiect_id, aprobat_fisier_id, versiune, 'x', 'a@gazpet.ro', 'office@gazpet.ro', 's', %L FROM public.red_corespondenta WHERE id=%L$q$, pg_temp.r30f_g('viewer'), pg_temp.r30f_g('Z1')),'42501') THEN
    RAISE EXCEPTION 'TEST5 FAIL: viewer insereaza direct';
  END IF;
  RAISE NOTICE 'TEST5a OK';
END $t$;
SELECT pg_temp.r30f_ca(NULL,'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r30f_refuza(format($q$SELECT public.fn_red_coresp_mail_incepe(%L,1,%L)$q$,pg_temp.r30f_g('Z1'),gen_random_uuid()),'42501') THEN RAISE EXCEPTION 'TEST5 FAIL: anon porneste mailul'; END IF;
  IF NOT pg_temp.r30f_refuza('SELECT count(*) FROM public.red_corespondenta_mailuri','42501') THEN RAISE EXCEPTION 'TEST5 FAIL: anon citeste urma'; END IF;
  IF NOT pg_temp.r30f_refuza(format($q$SELECT public.fn_red_coresp_mail_inchide(%L,'trimis','x',NULL)$q$,gen_random_uuid()),'42501') THEN RAISE EXCEPTION 'TEST5 FAIL: anon inchide'; END IF;
  RAISE NOTICE 'TEST5b OK';
END $t$;
SELECT pg_temp.r30f_ca(NULL,'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.r30f_refuza($q$DELETE FROM public.red_corespondenta_mailuri$q$,'42501') OR NOT pg_temp.r30f_refuza($q$TRUNCATE public.red_corespondenta_mailuri$q$,'42501')
     OR NOT pg_temp.r30f_refuza($q$UPDATE public.red_corespondenta_mailuri SET eroare='x'$q$,'42501') THEN RAISE EXCEPTION 'TEST5 FAIL: service_role scrie urma'; END IF;
  RAISE NOTICE 'TEST5c OK';
END $t$;

-- TEST6: editorul porneste mailul -> rand in_curs (autor pus de server); al doilea click < 60 s -> refuz; versiune / fisier diferite de cele curente
-- -> refuz; INSERT / UPDATE / DELETE direct refuzate
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('editor')::uuid,'authenticated');
DO $t$ DECLARE j jsonb; v_id uuid; v_ver integer; BEGIN
  EXECUTE pg_temp.r30f_incepe('Z1') INTO j;
  v_id := (j->>'mail_id')::uuid;
  IF j->>'expeditor_email' <> 'cristina.dumitrescu@gazpet.ro' OR j->>'cc' <> 'office@gazpet.ro'
     OR j->>'destinatar_email' <> 'registratura@isc-mehedinti.ro' OR j#>>'{fisier,etag}' <> '"etag-z1"' OR j#>>'{fisier,path}' NOT LIKE 'TEST-RAZVAN/corespondenta/Z1/%.pdf'
     OR j->>'proiect_cod' <> 'TEST-RAZVAN' OR j ? 'mod' THEN
    RAISE EXCEPTION 'TEST6 FAIL: payload %', j;
  END IF;
  IF (SELECT stare<>'in_curs' OR created_by IS DISTINCT FROM pg_temp.r30f_g('editor')::uuid OR catre<>'cristina.dumitrescu@gazpet.ro' OR fisier_etag<>'"etag-z1"' OR finalizat_la IS NOT NULL
             OR versiune_confirmata IS DISTINCT FROM (SELECT versiune FROM public.red_corespondenta WHERE id=pg_temp.r30f_g('Z1')::uuid)
        FROM public.red_corespondenta_mailuri WHERE id=v_id) THEN RAISE EXCEPTION 'TEST6 FAIL: randul de urma'; END IF;
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe('Z1'),'23514','deja pregatit acum') THEN RAISE EXCEPTION 'TEST6 FAIL: al doilea click < 60 s'; END IF;
  SELECT versiune INTO v_ver FROM public.red_corespondenta WHERE id=pg_temp.r30f_g('Z1')::uuid;
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe_x('Z1',v_ver-1,(SELECT aprobat_fisier_id::text FROM public.red_corespondenta WHERE id=pg_temp.r30f_g('Z1')::uuid)),'23514','randul s-a schimbat') THEN
    RAISE EXCEPTION 'TEST6 FAIL: versiune veche acceptata';
  END IF;
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe_x('Z1',v_ver,(SELECT id::text FROM public.red_corespondenta_fisiere WHERE sha256=repeat('b',64))),'23514','randul s-a schimbat') THEN
    RAISE EXCEPTION 'TEST6 FAIL: alt fisier acceptat';
  END IF;
  IF NOT pg_temp.r30f_refuza(format($q$UPDATE public.red_corespondenta_mailuri SET stare='trimis', resend_id='x' WHERE id=%L$q$,v_id),'42501') THEN RAISE EXCEPTION 'TEST6 FAIL: UPDATE direct'; END IF;
  IF NOT pg_temp.r30f_refuza($q$DELETE FROM public.red_corespondenta_mailuri$q$,'42501') THEN RAISE EXCEPTION 'TEST6 FAIL: DELETE direct'; END IF;
  IF NOT pg_temp.r30f_refuza(format($q$INSERT INTO public.red_corespondenta_mailuri(corespondenta_id,proiect_id,fisier_id,versiune_confirmata,fisier_etag,catre,cc,subiect,created_by)
       SELECT id, proiect_id, aprobat_fisier_id, versiune, 'x', 'a@gazpet.ro', 'office@gazpet.ro', 's', %L FROM public.red_corespondenta WHERE id=%L$q$, pg_temp.r30f_g('editor'), pg_temp.r30f_g('Z1')),'42501') THEN
    RAISE EXCEPTION 'TEST6 FAIL: editor insereaza direct (ocolind RPC-ul)';
  END IF;
  IF NOT pg_temp.r30f_refuza_m(format($q$SELECT public.fn_red_coresp_mail_inchide(%L,'trimis',NULL,NULL)$q$,v_id),'23514','fara id Resend') THEN RAISE EXCEPTION 'TEST6 FAIL: trimis fara id'; END IF;
  IF NOT pg_temp.r30f_refuza(format($q$SELECT public.fn_red_coresp_mail_inchide(%L,'altceva',NULL,NULL)$q$,v_id),'23514') THEN RAISE EXCEPTION 'TEST6 FAIL: stare invalida'; END IF;
  PERFORM set_config('r30f.mail1',v_id::text,true);
  RAISE NOTICE 'TEST6a OK';
END $t$;
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('admin')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30f_refuza_m(format($q$SELECT public.fn_red_coresp_mail_inchide(%L,'trimis','re_alt',NULL)$q$,pg_temp.r30f_g('mail1')),'23514','nu e a ta') THEN RAISE EXCEPTION 'TEST6 FAIL: alt utilizator inchide'; END IF;
  RAISE NOTICE 'TEST6b OK';
END $t$;
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF public.fn_red_coresp_mail_inchide(pg_temp.r30f_g('mail1')::uuid,'trimis','re_123',NULL) <> 'trimis' THEN RAISE EXCEPTION 'TEST6 FAIL: inchidere trimis'; END IF;
  IF (SELECT stare<>'trimis' OR resend_id<>'re_123' OR finalizat_la IS NULL FROM public.red_corespondenta_mailuri WHERE id=pg_temp.r30f_g('mail1')::uuid) THEN RAISE EXCEPTION 'TEST6 FAIL: inchidere'; END IF;
  -- o singura inchidere: a doua (orice stare) e refuzata, randul ramane trimis
  IF NOT pg_temp.r30f_refuza_m(format($q$SELECT public.fn_red_coresp_mail_inchide(%L,'necunoscut',NULL,'x')$q$,pg_temp.r30f_g('mail1')),'23514','deja inchisa') THEN RAISE EXCEPTION 'TEST6 FAIL: a doua inchidere'; END IF;
  IF (SELECT stare<>'trimis' OR resend_id<>'re_123' FROM public.red_corespondenta_mailuri WHERE id=pg_temp.r30f_g('mail1')::uuid) THEN RAISE EXCEPTION 'TEST6 FAIL: trimis schimbat'; END IF;
  RAISE NOTICE 'TEST6c OK';
END $t$;

-- TEST7 (J-P2-1): fereastra de 60 s pe TOATE incercarile: o eroare inchisa de apelant NU deblocheaza; dupa 60 s se poate din nou (varianta A:
-- un rezultat necunoscut se verifica in inbox; un nou click dupa 60 s e permis — risc acceptat: mail intern dublu)
SELECT pg_temp.r30f_ca(NULL,'postgres');
ALTER TABLE public.red_corespondenta_mailuri DISABLE TRIGGER trg_red_coresp_mail_inainte;
UPDATE public.red_corespondenta_mailuri SET created_at = clock_timestamp() - interval '2 minutes' WHERE corespondenta_id = pg_temp.r30f_g('Z1')::uuid;
ALTER TABLE public.red_corespondenta_mailuri ENABLE TRIGGER trg_red_coresp_mail_inainte;
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('admin')::uuid,'authenticated');
DO $t$ DECLARE j jsonb; BEGIN
  EXECUTE pg_temp.r30f_incepe('Z1') INTO j;
  IF public.fn_red_coresp_mail_inchide((j->>'mail_id')::uuid,'eroare',NULL,'Resend 422: test') <> 'eroare' THEN RAISE EXCEPTION 'TEST7 FAIL: inchidere eroare'; END IF;
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe('Z1'),'23514','deja pregatit acum') THEN RAISE EXCEPTION 'TEST7 FAIL: eroarea inchisa de apelant deblocheaza fereastra'; END IF;
  RAISE NOTICE 'TEST7a OK';
END $t$;
SELECT pg_temp.r30f_ca(NULL,'postgres');
ALTER TABLE public.red_corespondenta_mailuri DISABLE TRIGGER trg_red_coresp_mail_inainte;
UPDATE public.red_corespondenta_mailuri SET created_at = clock_timestamp() - interval '2 minutes' WHERE corespondenta_id = pg_temp.r30f_g('Z1')::uuid;
ALTER TABLE public.red_corespondenta_mailuri ENABLE TRIGGER trg_red_coresp_mail_inainte;
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('admin')::uuid,'authenticated');
DO $t$ DECLARE j jsonb; BEGIN
  EXECUTE pg_temp.r30f_incepe('Z1') INTO j;
  IF public.fn_red_coresp_mail_inchide((j->>'mail_id')::uuid,'necunoscut',NULL,'timeout') <> 'necunoscut' THEN RAISE EXCEPTION 'TEST7 FAIL: inchidere necunoscut'; END IF;
  IF NOT pg_temp.r30f_refuza_m(format($q$SELECT public.fn_red_coresp_mail_inchide(%L,'trimis','re_x',NULL)$q$,j->>'mail_id'),'23514','deja inchisa') THEN RAISE EXCEPTION 'TEST7 FAIL: necunoscut redeschis'; END IF;
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe('Z1'),'23514','deja pregatit acum') THEN RAISE EXCEPTION 'TEST7 FAIL: necunoscut deblocheaza fereastra'; END IF;
  IF (SELECT count(*) FROM public.red_corespondenta_mailuri WHERE corespondenta_id=pg_temp.r30f_g('Z1')::uuid) <> 3 THEN RAISE EXCEPTION 'TEST7 FAIL: numar incercari'; END IF;
  RAISE NOTICE 'TEST7b OK';
END $t$;
-- TEST7c (J-P2-3): randul s-a schimbat dupa ce utilizatorul l-a vazut (versiune noua) -> pornirea cu versiunea veche e refuzata
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('admin')::uuid,'authenticated');
DO $t$ DECLARE v_vechi integer; BEGIN
  SELECT versiune INTO v_vechi FROM public.red_corespondenta WHERE id=pg_temp.r30f_g('Z1')::uuid;
  UPDATE public.red_corespondenta SET observatii='nota noua' WHERE id=pg_temp.r30f_g('Z1')::uuid;
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe_x('Z1',v_vechi,(SELECT aprobat_fisier_id::text FROM public.red_corespondenta WHERE id=pg_temp.r30f_g('Z1')::uuid)),'23514','randul s-a schimbat') THEN
    RAISE EXCEPTION 'TEST7c FAIL: versiune veche';
  END IF;
  RAISE NOTICE 'TEST7c OK';
END $t$;

-- TEST8: Z2 aprobat dar fara campurile mailului -> refuz; eTag schimbat in Storage -> refuz; randul inexistent -> P0002
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe('Z2'),'23514','@gazpet.ro') THEN RAISE EXCEPTION 'TEST8 FAIL: Z2 fara expeditor'; END IF;
  IF NOT pg_temp.r30f_refuza(format($q$SELECT public.fn_red_coresp_mail_incepe(%L,1,%L)$q$,gen_random_uuid(),gen_random_uuid()),'P0002') THEN RAISE EXCEPTION 'TEST8 FAIL: rand inexistent'; END IF;
  RAISE NOTICE 'TEST8a OK';
END $t$;
SELECT pg_temp.r30f_ca(NULL,'postgres');
UPDATE storage.objects SET metadata = metadata || '{"eTag":"\"etag-schimbat\""}'::jsonb WHERE bucket_id='redari' AND name='TEST-RAZVAN/corespondenta/Z1/20261104-110000-aaaaaaaa-scrisoare.pdf';
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe('Z1'),'23514','s-a schimbat sau lipseste din Storage') THEN RAISE EXCEPTION 'TEST8 FAIL: eTag schimbat'; END IF;
  RAISE NOTICE 'TEST8b OK';
END $t$;
SELECT pg_temp.r30f_ca(NULL,'postgres');
UPDATE storage.objects SET metadata = metadata || '{"eTag":"\"etag-z1\""}'::jsonb WHERE bucket_id='redari' AND name='TEST-RAZVAN/corespondenta/Z1/20261104-110000-aaaaaaaa-scrisoare.pdf';

-- TEST9: plafonul de 20 / zi / proiect (17 intentii fictive azi + cele 3 de pe Z1 = 20) -> refuz; viewer-ul vede urma
ALTER TABLE public.red_corespondenta_mailuri DISABLE TRIGGER trg_red_coresp_mail_inainte;
UPDATE public.red_corespondenta_mailuri SET created_at = clock_timestamp() - interval '2 minutes' WHERE corespondenta_id = pg_temp.r30f_g('Z1')::uuid;
INSERT INTO public.red_corespondenta_mailuri(corespondenta_id,proiect_id,fisier_id,versiune_confirmata,fisier_etag,catre,cc,subiect,stare,eroare,created_by,created_at,finalizat_la)
  SELECT c.id, c.proiect_id, c.aprobat_fisier_id, c.versiune, '"etag-z2"', 'a@gazpet.ro', 'office@gazpet.ro', 'fictiv', 'eroare', 'fictiv',
         pg_temp.r30f_g('editor')::uuid, clock_timestamp() - interval '5 minutes', clock_timestamp()
    FROM public.red_corespondenta c, generate_series(1,17) g WHERE c.id = pg_temp.r30f_g('Z2')::uuid;
ALTER TABLE public.red_corespondenta_mailuri ENABLE TRIGGER trg_red_coresp_mail_inainte;
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.red_corespondenta_mailuri WHERE proiect_id=pg_temp.r30f_g('pr')::uuid) <> 20 THEN RAISE EXCEPTION 'TEST9 FAIL: preconditie 20'; END IF;
  IF NOT pg_temp.r30f_refuza_m(pg_temp.r30f_incepe('Z1'),'23514','plafonul de 20') THEN RAISE EXCEPTION 'TEST9 FAIL: plafon'; END IF;
  RAISE NOTICE 'TEST9a OK';
END $t$;
SELECT pg_temp.r30f_ca(pg_temp.r30f_g('viewer')::uuid,'authenticated');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.red_corespondenta_mailuri WHERE proiect_id=pg_temp.r30f_g('pr')::uuid) <> 20 THEN RAISE EXCEPTION 'TEST9 FAIL: viewer nu vede urma'; END IF;
  RAISE NOTICE 'TEST9b OK';
END $t$;

-- TEST10: jurnal + mentenanta (fara JWT) nu porneste mailul
SELECT pg_temp.r30f_ca(NULL,'postgres');
DO $t$ BEGIN
  IF NOT pg_temp.r30f_refuza(pg_temp.r30f_incepe('Z1'),'42501') THEN RAISE EXCEPTION 'TEST10 FAIL: mentenanta porneste mailul'; END IF;
  IF (SELECT count(*) FROM public.red_jurnal WHERE tabela='red_corespondenta_mailuri') < 3 THEN RAISE EXCEPTION 'TEST10 FAIL: jurnal'; END IF;
  RAISE NOTICE 'TEST10 OK';
END $t$;
RESET ROLE;
SELECT set_config('request.jwt.claims','',true);
