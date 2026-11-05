-- Numai într-o tranzacție de probă: BEGIN; marcaj+baseline revizuit; migrare; acest fișier; ROLLBACK.
-- NU rulat în sesiunea Codex. Fixture-uri fictive; identități simulate, fără expunerea datelor identităților.
-- Acest DRY nu înlocuiește proba de concurență cu două sesiuni și testul API PostgREST.
CREATE FUNCTION pg_temp.f2_ca(p_uid uuid,p_role text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
 IF p_role='postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims','',true); RETURN; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'role',p_role)::text,true);
 EXECUTE format('SET LOCAL ROLE %I',p_role);
END $f$;
CREATE FUNCTION pg_temp.f2_eroare(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.f2_ca(uuid,text),pg_temp.f2_eroare(text) TO authenticated,anon;
DO $fixture$
DECLARE ow uuid;
BEGIN
 IF current_user<>'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261131a_redari_mail_f2_loturi:'||txid_current() THEN RAISE EXCEPTION 'F2 DRY: garda'; END IF;
 SELECT id INTO ow FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
 IF ow IS NULL THEN RAISE EXCEPTION 'F2 DRY: lipseste identitate owner'; END IF;
 PERFORM set_config('f2.owner',ow::text,true);
 INSERT INTO public.red_proiecte(id,cod,denumire) VALUES('f2000000-0000-4000-8000-000000000001','F2-DRY-FICTIV','Proiect fictiv F2');
 INSERT INTO public.red_uat(id,proiect_id,nume,uat3) VALUES('f2000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001','UAT Fictiv','FIC');
 INSERT INTO public.red_parcele(id,proiect_id,uat_id,id_parcela,tronson) VALUES('f2000000-0000-4000-8000-000000000003','f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002','T1-FIC-9999',1);
 INSERT INTO public.red_detinatori(id,parcela_id,nume,nume_normalizat,calitate) VALUES('f2000000-0000-4000-8000-000000000004','f2000000-0000-4000-8000-000000000003','DETINATOR FICTIV F2','DETINATOR FICTIV F2','proprietar');
 INSERT INTO public.red_detinatori_contact(detinator_id,email) VALUES('f2000000-0000-4000-8000-000000000004','fictiv@example.invalid');
END $fixture$;
SELECT pg_temp.f2_ca('f2000000-0000-4000-8000-000000000099','authenticated');
DO $negativ$
BEGIN
 IF pg_temp.f2_eroare($q$SELECT public.fn_red_mail_lot_creeaza('f2000000-0000-4000-8000-000000000005','f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002',ARRAY['f2000000-0000-4000-8000-000000000004']::uuid[],'Convocare fictiva','Text fictiv')$q$)<>'42501' THEN RAISE EXCEPTION 'F2 DRY: non-owner acceptat'; END IF;
 IF EXISTS(SELECT 1 FROM public.red_mail_mesaje) THEN RAISE EXCEPTION 'F2 DRY: non-owner vede continut'; END IF;
 IF pg_temp.f2_eroare($q$UPDATE public.red_mail_setari SET trimitere_oprita=false WHERE id=1$q$)<>'42501' THEN RAISE EXCEPTION 'F2 DRY: setari directe'; END IF;
END $negativ$;
SELECT pg_temp.f2_ca(current_setting('f2.owner')::uuid,'authenticated');
DO $owner$
DECLARE a uuid; b uuid; h text; v integer;
BEGIN
 a:=public.fn_red_mail_lot_creeaza('f2000000-0000-4000-8000-000000000005','f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002',ARRAY['f2000000-0000-4000-8000-000000000004']::uuid[],'Convocare fictiva','Text fictiv');
 b:=public.fn_red_mail_lot_creeaza('f2000000-0000-4000-8000-000000000005','f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002',ARRAY['f2000000-0000-4000-8000-000000000004']::uuid[],'Convocare fictiva','Text fictiv');
 IF a<>b OR (SELECT count(*) FROM public.red_mail_mesaje WHERE lot_id=a)<>1 THEN RAISE EXCEPTION 'F2 DRY: retry duplicat'; END IF;
 IF pg_temp.f2_eroare($q$SELECT public.fn_red_mail_lot_creeaza('f2000000-0000-4000-8000-000000000005','f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002',ARRAY['f2000000-0000-4000-8000-000000000004']::uuid[],'Alt subiect','Text fictiv')$q$)<>'P0001' THEN RAISE EXCEPTION 'F2 DRY: intentie reutilizata'; END IF;
 SELECT lot_sha256,versiune INTO h,v FROM public.red_mail_loturi WHERE id=a;
 BEGIN PERFORM public.fn_red_mail_lot_aproba(a,v,h); RAISE EXCEPTION 'informare acceptata' USING ERRCODE='XX000'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.fn_red_mail_rezerva(a)) THEN RAISE EXCEPTION 'F2 DRY: OFF rezerva'; END IF;
 IF pg_temp.f2_eroare($q$UPDATE public.red_mail_mesaje SET corp_text_final='Alterat' WHERE lot_id='f2000000-0000-4000-8000-000000000005'$q$)<>'42501' THEN RAISE EXCEPTION 'F2 DRY: PATCH snapshot'; END IF;
 IF pg_temp.f2_eroare($q$INSERT INTO public.red_convocari(detinator_id,canal) VALUES('f2000000-0000-4000-8000-000000000004','email')$q$)<>'23514' THEN RAISE EXCEPTION 'F2 DRY: canal email postal'; END IF;
 PERFORM public.fn_red_mail_lot_inchide(a,v);
 IF EXISTS(SELECT 1 FROM public.red_mail_mesaje WHERE lot_id=a AND stare<>'anulat') THEN RAISE EXCEPTION 'F2 DRY: inchidere'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar_antet WHERE lot_id=a AND nr_fisiere=0) THEN RAISE EXCEPTION 'F2 DRY: inventar zero'; END IF;
 IF pg_temp.f2_eroare($q$SELECT public.fn_red_mail_lot_goleste('f2000000-0000-4000-8000-000000000005',2,true)$q$)<>'P0001' THEN RAISE EXCEPTION 'F2 DRY: retentie fara termen'; END IF;
END $owner$;
SELECT pg_temp.f2_ca(NULL,'postgres');
-- Expected independent: SHA256 RFC8785 pentru {"a":null,"z":["a",1]} se verifică și în JS.
DO $paritate$
BEGIN
 IF public.fn_red_mail_f2_canonic('{"z":["a",1],"a":null}'::jsonb)<>'{"a":null,"z":["a",1]}' THEN RAISE EXCEPTION 'F2 DRY: canonic'; END IF;
 IF public.fn_red_mail_f2_email('a@example.invalid') IS NOT TRUE OR public.fn_red_mail_f2_email(E'a@example.invalid\r\nBcc:b@b.invalid') IS NOT FALSE OR public.fn_red_mail_f2_email('a@example.invalid,b@example.invalid') IS NOT FALSE THEN RAISE EXCEPTION 'F2 DRY: email'; END IF;
 IF EXISTS(SELECT 1 FROM public.red_convocari WHERE detinator_id='f2000000-0000-4000-8000-000000000004' AND canal='email') THEN RAISE EXCEPTION 'F2 DRY: postal alterat'; END IF;
 RAISE NOTICE 'F2 DRY: subset inert OK; concurenta/API/OAuth/SENT necesita probe separate';
END $paritate$;
-- Matrice suplimentară: refuz pe fiecare RPC expus pentru non-owner și anon.
CREATE FUNCTION pg_temp.f2_refuz(p_sql text,p_state text,p_mesaj text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE cod text; mesaj text;
BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS cod=RETURNED_SQLSTATE,mesaj=MESSAGE_TEXT; END;
 IF cod IS DISTINCT FROM p_state OR (p_mesaj IS NOT NULL AND mesaj IS DISTINCT FROM p_mesaj) THEN
  RAISE EXCEPTION 'F2 DRY: refuz incorect pentru %, asteptat % / %, primit % / %',p_sql,p_state,p_mesaj,cod,mesaj;
 END IF;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.f2_refuz(text,text,text) TO authenticated,anon;
SELECT pg_temp.f2_ca('f2000000-0000-4000-8000-000000000099','authenticated');
DO $matrix$
DECLARE q text;
BEGIN
 FOREACH q IN ARRAY ARRAY[
 'SELECT public.fn_red_mail_destinatari(NULL,NULL,NULL)',
 'SELECT public.fn_red_mail_lot_creeaza(NULL,NULL,NULL,NULL,NULL,NULL)',
 'SELECT public.fn_red_mail_lot_aproba(NULL,NULL,NULL)',
 'SELECT public.fn_red_mail_rezerva(NULL)',
 'SELECT public.fn_red_mail_apel_incepe(NULL,NULL)',
 'SELECT public.fn_red_mail_rezultat(NULL,NULL,NULL,NULL,NULL)',
 'SELECT public.fn_red_mail_lot_inchide(NULL,NULL)',
 'SELECT public.fn_red_mail_lot_goleste(NULL,NULL,NULL)',
 'SELECT public.fn_red_mail_lot_sterge_final(NULL,NULL,NULL)',
 'SELECT public.fn_red_mail_f2_setari(NULL,NULL,NULL)',
 'SELECT public.fn_red_mail_f2_optout(NULL,NULL,NULL)'
 ] LOOP
  PERFORM pg_temp.f2_refuz(q,'42501','non_owner');
 END LOOP;
END $matrix$;
SELECT pg_temp.f2_ca(NULL,'anon');
DO $anon$
DECLARE f record;
BEGIN
 FOR f IN SELECT oid,oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND (left(proname,15)='fn_red_mail_f2_' OR proname IN ('fn_red_mail_destinatari','fn_red_mail_lot_creeaza','fn_red_mail_lot_aproba','fn_red_mail_rezerva','fn_red_mail_apel_incepe','fn_red_mail_rezultat','fn_red_mail_lot_inchide','fn_red_mail_lot_goleste','fn_red_mail_lot_sterge_final')) LOOP
  IF has_function_privilege('anon',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'F2 DRY: anon EXECUTE %',f.sig; END IF;
 END LOOP;
 PERFORM pg_temp.f2_refuz('SELECT public.fn_red_mail_rezerva(NULL)','42501');
END $anon$;
SELECT pg_temp.f2_ca(NULL,'postgres');
-- Fixture privilegiat pentru izolarea triggerelor/CAS, fără activare transport.
DO $immutabil$
DECLARE l uuid:='f2000000-0000-4000-8000-000000000005'; m uuid; token uuid:='f2000000-0000-4000-8000-000000000088';
BEGIN
 SELECT id INTO STRICT m FROM public.red_mail_mesaje WHERE lot_id=l;
 PERFORM pg_temp.f2_refuz(format('UPDATE public.red_mail_mesaje SET corp_text_final=%L WHERE id=%L','Alterare fictiva',m),'P0001','snapshot_imuabil');
 -- Lotul încheiat are aprobare NULL; orice rescriere rămâne interzisă.
 PERFORM pg_temp.f2_refuz(format('UPDATE public.red_mail_loturi SET aprobat_de=%L WHERE id=%L',current_setting('f2.owner'),l),'P0001','aprobare_imuabila');
 UPDATE public.red_mail_mesaje SET lease_token=token WHERE id=m;
 PERFORM set_config('f2.mesaj',m::text,true);
END $immutabil$;
SELECT pg_temp.f2_ca(current_setting('f2.owner')::uuid,'authenticated');
DO $cas$
DECLARE m uuid:=current_setting('f2.mesaj')::uuid;
BEGIN
 IF public.fn_red_mail_apel_incepe(m,'f2000000-0000-4000-8000-000000000089') IS DISTINCT FROM false THEN RAISE EXCEPTION 'F2 DRY: CAS incepe cu token pierdut'; END IF;
 IF public.fn_red_mail_rezultat(m,'f2000000-0000-4000-8000-000000000089','trimis','fictiv','fictiv') IS DISTINCT FROM false THEN RAISE EXCEPTION 'F2 DRY: CAS rezultat cu token pierdut'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_mesaje WHERE id=m AND stare='anulat' AND lease_token='f2000000-0000-4000-8000-000000000088') THEN RAISE EXCEPTION 'F2 DRY: CAS pierdut a modificat mesajul'; END IF;
END $cas$;
SELECT pg_temp.f2_ca(NULL,'postgres');
-- Calea legitimă de aprobare: informare fictivă publicată, transportul rămâne OFF.
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
VALUES('redari','F2-DRY-FICTIV/autorizare_tgz/fictiv.pdf',current_setting('f2.owner'),'{"eTag":"fictiv-f2"}');
UPDATE public.red_proiecte SET autorizare_tgz_nr='FICTIV-F2',autorizare_tgz_data='2026-11-05',
 autorizare_tgz_fisier='F2-DRY-FICTIV/autorizare_tgz/fictiv.pdf',autorizare_tgz_etag='fictiv-f2',
 autorizare_tgz_obiect=(SELECT id FROM storage.objects WHERE bucket_id='redari' AND name='F2-DRY-FICTIV/autorizare_tgz/fictiv.pdf')
WHERE id='f2000000-0000-4000-8000-000000000001';
SELECT pg_temp.f2_ca(current_setting('f2.owner')::uuid,'authenticated');
DO $aprobare_ok$
DECLARE l uuid; h text; v integer;
BEGIN
 IF public.fn_red_informare_publicata('F2-DRY-FICTIV') IS NOT TRUE THEN RAISE EXCEPTION 'F2 DRY: fixture publicare invalida'; END IF;
 l:=public.fn_red_mail_lot_creeaza('f2000000-0000-4000-8000-000000000006','f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002',ARRAY['f2000000-0000-4000-8000-000000000004']::uuid[],'Convocare fictiva','Text fictiv');
 SELECT lot_sha256,versiune INTO h,v FROM public.red_mail_loturi WHERE id=l;
 IF public.fn_red_mail_lot_aproba(l,v,h) IS NOT TRUE THEN RAISE EXCEPTION 'F2 DRY: aprobare owner legitima refuzata'; END IF;
 IF public.fn_red_mail_lot_aproba(l,v,h) IS NOT TRUE THEN RAISE EXCEPTION 'F2 DRY: retry aprobare refuzat'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_loturi WHERE id=l AND aprobat_de=auth.uid() AND aprobat_lot_sha256=h AND aprobat_versiune=v) THEN RAISE EXCEPTION 'F2 DRY: semnatura aprobare incorecta'; END IF;
 IF EXISTS(SELECT 1 FROM public.fn_red_mail_rezerva(l)) THEN RAISE EXCEPTION 'F2 DRY: OFF permite rezervare lot aprobat cu informare publicata'; END IF;
END $aprobare_ok$;
SELECT pg_temp.f2_ca(NULL,'postgres');
DO $fixture_lease$
BEGIN
 UPDATE public.red_mail_mesaje SET stare='rezervat',lease_token='f2000000-0000-4000-8000-000000000088',lease_pana=now()+interval '2 minutes'
 WHERE lot_id='f2000000-0000-4000-8000-000000000006';
 PERFORM set_config('f2.mesaj',id::text,true) FROM public.red_mail_mesaje WHERE lot_id='f2000000-0000-4000-8000-000000000006';
END $fixture_lease$;
SELECT pg_temp.f2_ca(current_setting('f2.owner')::uuid,'authenticated');
DO $cas_valid$
DECLARE m uuid:=current_setting('f2.mesaj')::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.fn_red_mail_destinatari('f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002') WHERE id='f2000000-0000-4000-8000-000000000004' AND 'deja_rezervat_trimis'=ANY(motive)) THEN RAISE EXCEPTION 'F2 DRY: inventar ascunde rezervarea'; END IF;
 IF public.fn_red_mail_rezultat(m,'f2000000-0000-4000-8000-000000000089','esuat_sigur') IS DISTINCT FROM false THEN RAISE EXCEPTION 'F2 DRY: token pierdut acceptat pe rezervare vie'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_mesaje WHERE id=m AND stare='rezervat') THEN RAISE EXCEPTION 'F2 DRY: token pierdut a schimbat starea'; END IF;
 IF public.fn_red_mail_rezultat(m,'f2000000-0000-4000-8000-000000000088','esuat_sigur') IS DISTINCT FROM true THEN RAISE EXCEPTION 'F2 DRY: token propriu refuzat'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_evenimente WHERE tip='f2' AND cod='f2_esuat_sigur' AND obiect_id=m) THEN RAISE EXCEPTION 'F2 DRY: eveniment F1 lipsa'; END IF;
END $cas_valid$;
-- Scriere directă refuzată inclusiv owner-ului, pentru fiecare tabel F2.
DO $dml$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['red_mail_loturi','red_mail_mesaje','red_mail_optout','red_mail_fisiere_inventar','red_mail_fisiere_inventar_antet','red_mail_jurnal_f2'] LOOP
  PERFORM pg_temp.f2_refuz(format('INSERT INTO public.%I DEFAULT VALUES',t),'42501');
  PERFORM pg_temp.f2_refuz(format('UPDATE public.%I SET %I=%I WHERE false',t,CASE WHEN t='red_mail_fisiere_inventar_antet' THEN 'lot_id' ELSE 'id' END,CASE WHEN t='red_mail_fisiere_inventar_antet' THEN 'lot_id' ELSE 'id' END),'42501');
  PERFORM pg_temp.f2_refuz(format('DELETE FROM public.%I WHERE false',t),'42501');
 END LOOP;
END $dml$;
DO $optout_preview$
BEGIN
 PERFORM public.fn_red_mail_f2_optout('fictiv@example.invalid',true,'Cerere fictiva DRY');
 IF NOT EXISTS(SELECT 1 FROM public.fn_red_mail_destinatari('f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002') WHERE id='f2000000-0000-4000-8000-000000000004' AND motive=ARRAY['opt_out']) THEN RAISE EXCEPTION 'F2 DRY: opt-out dispare din numitor'; END IF;
 PERFORM public.fn_red_mail_f2_optout('fictiv@example.invalid',false,'Retragere fictiva DRY');
 IF NOT EXISTS(SELECT 1 FROM public.fn_red_mail_destinatari('f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002') WHERE id='f2000000-0000-4000-8000-000000000004' AND cardinality(motive)=0) THEN RAISE EXCEPTION 'F2 DRY: eligibil legitim ascuns'; END IF;
END $optout_preview$;
SELECT pg_temp.f2_ca(NULL,'postgres');
INSERT INTO public.red_convocari(detinator_id,canal) VALUES('f2000000-0000-4000-8000-000000000004','posta');
UPDATE public.red_detinatori_contact SET email=NULL WHERE detinator_id='f2000000-0000-4000-8000-000000000004';
SELECT pg_temp.f2_ca(current_setting('f2.owner')::uuid,'authenticated');
DO $fara_email_preview$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.fn_red_mail_destinatari('f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002') WHERE id='f2000000-0000-4000-8000-000000000004' AND motive=ARRAY['fara_email','canal_postal']) THEN RAISE EXCEPTION 'F2 DRY: fara email/canal postal ascuns'; END IF;
END $fara_email_preview$;
SELECT pg_temp.f2_ca(NULL,'postgres');
-- R2: toate probele de mai jos sunt în tranzacția anulată, exclusiv fixture fictiv.
DO $hash_r2$
DECLARE m public.red_mail_mesaje;
BEGIN
 m.id:='00000000-0000-4000-8000-000000000001';
 m.catre:='destinatar.fictiv@example.invalid'; m.subiect_final:='Convocare fictivă';
 m.corp_text_final:=E'Țară\r\nLinia 2'; m.message_id:='<'||m.id||'@gazpet.ro>';
 IF public.fn_red_mail_f2_mesaj_hash(m) IS DISTINCT FROM '84926e2cb15dd2b2d219e296f441177f6a6087a672deabf0a585855e17937604' THEN RAISE EXCEPTION 'R2 hash fara PDF'; END IF;
 m.atasament_path:='FICTIV/convocator.pdf'; m.atasament_nume:='convocator-fictiv.pdf';
 m.atasament_mime:='application/pdf'; m.atasament_marime:=7; m.atasament_sha256:=repeat('a',64);
 IF public.fn_red_mail_f2_mesaj_hash(m) IS DISTINCT FROM 'b1993ca04f6a78edc04a443885b40c2eb03f31f9c121b9f940d97d12bd1752ce' THEN RAISE EXCEPTION 'R2 hash PDF'; END IF;
END $hash_r2$;
DO $atasament_r2$
DECLARE m public.red_mail_mesaje; varianta jsonb; cod text; constr text;
BEGIN
 INSERT INTO public.red_mail_loturi(id,proiect_id,uat_id,cerere_sha256,lot_sha256,creat_de)
 SELECT 'f2000000-0000-4000-8000-000000000007',proiect_id,uat_id,cerere_sha256,lot_sha256,creat_de
 FROM public.red_mail_loturi WHERE id='f2000000-0000-4000-8000-000000000005';
 SELECT * INTO STRICT m FROM public.red_mail_mesaje WHERE lot_id='f2000000-0000-4000-8000-000000000005';
 m.id:=gen_random_uuid(); m.lot_id:='f2000000-0000-4000-8000-000000000007'; m.nr_document:='F2-DRY-ATASAMENT';
 m.message_id:='<'||m.id||'@gazpet.ro>'; m.stare:='in_coada';
 m.atasament_path:='FICTIV/convocator.pdf'; m.atasament_nume:='convocator-fictiv.pdf';
 m.atasament_mime:='application/pdf'; m.atasament_marime:=7; m.atasament_sha256:=repeat('a',64);
 FOR varianta IN SELECT value FROM jsonb_array_elements('[{"atasament_path":null},{"atasament_nume":null},{"atasament_mime":null},{"atasament_sha256":null},{"atasament_marime":null},{"atasament_mime":"text/plain"},{"atasament_marime":4},{"atasament_marime":10000001},{"atasament_sha256":"ABC"}]') LOOP
  cod:=NULL; constr:=NULL;
  BEGIN
   INSERT INTO public.red_mail_mesaje SELECT (jsonb_populate_record(m,varianta)).*;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS cod=RETURNED_SQLSTATE,constr=CONSTRAINT_NAME;
  END;
  IF cod IS DISTINCT FROM '23514' OR constr IS DISTINCT FROM 'red_mail_f2_atasament_ck' THEN RAISE EXCEPTION 'R2 atasament invalid acceptat / alt refuz: % % %',varianta,cod,constr; END IF;
 END LOOP;
 -- Calea legitimă: toate prezente. Cazul toate NULL e exercitat de lot_creeaza.
 m.mesaj_sha256:=public.fn_red_mail_f2_mesaj_hash(m);
 INSERT INTO public.red_mail_mesaje SELECT m.*;
END $atasament_r2$;
SELECT pg_temp.f2_ca(current_setting('f2.owner')::uuid,'authenticated');
SELECT public.fn_red_mail_lot_inchide('f2000000-0000-4000-8000-000000000007',1);
DO $rezultat_r2$
DECLARE m uuid:=current_setting('f2.mesaj')::uuid;
BEGIN
 IF public.fn_red_mail_rezultat(m,'f2000000-0000-4000-8000-000000000088','esuat_sigur') IS NOT TRUE THEN RAISE EXCEPTION 'R2 retry identic'; END IF;
 PERFORM pg_temp.f2_refuz(format('SELECT public.fn_red_mail_rezultat(%L,%L,%L,NULL,%L)',m,'f2000000-0000-4000-8000-000000000088','esuat_sigur','alt_thread'),'22023','rezultat_conflict');
 PERFORM pg_temp.f2_refuz(format('SELECT public.fn_red_mail_rezultat(%L,%L,%L)',m,'f2000000-0000-4000-8000-000000000088','necunoscut'),'22023','rezultat_conflict');
 PERFORM pg_temp.f2_refuz($q$UPDATE public.red_mail_setari SET trimitere_oprita=false WHERE id=1$q$,'42501');
 PERFORM pg_temp.f2_refuz($q$UPDATE public.red_mail_setari SET extern_permis=true WHERE id=1$q$,'42501');
 PERFORM pg_temp.f2_refuz($q$SELECT public.fn_red_mail_f2_optout('fictiv@example.invalid',true,NULL)$q$,'22023','motiv_invalid');
 PERFORM pg_temp.f2_refuz($q$SELECT public.fn_red_mail_f2_optout('fictiv@example.invalid',true,'')$q$,'22023','motiv_invalid');
 PERFORM pg_temp.f2_refuz($q$SELECT public.fn_red_mail_f2_optout('fictiv@example.invalid',true,E' \t\n')$q$,'22023','motiv_invalid');
 PERFORM pg_temp.f2_refuz($q$SELECT public.fn_red_mail_f2_optout('fictiv@example.invalid',true,repeat('x',501))$q$,'22023','motiv_invalid');
END $rezultat_r2$;
SELECT pg_temp.f2_ca(NULL,'postgres');
-- Verifică separat CHECK-ul sub privilegiul proprietarului BD, păstrând identitatea JWT owner.
-- Nu acordăm UPDATE temporar: calea authenticated de mai sus trebuie să refuze deja prin ACL.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('f2.owner'),'role','authenticated')::text,true);
SELECT pg_temp.f2_refuz('UPDATE public.red_mail_setari SET trimitere_oprita=false WHERE id=1','23514');
SELECT pg_temp.f2_refuz('UPDATE public.red_mail_setari SET extern_permis=true WHERE id=1','23514');
SELECT pg_temp.f2_ca(NULL,'postgres');
-- Identitate fictivă reală pe FK auth.users -> profiles -> user_module_access; fără parole.
INSERT INTO auth.users(id,email) VALUES('f2000000-0000-4000-8000-000000000099','f2-editor@example.invalid');
INSERT INTO public.profiles(id,email,name,is_owner)
VALUES('f2000000-0000-4000-8000-000000000099','f2-editor@example.invalid','F2 DRY FICTIV',false)
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.user_module_access(profile_id,module,access_level)
VALUES('f2000000-0000-4000-8000-000000000099','redari','editor');
CREATE FUNCTION pg_temp.f2_select_r2(p_vizibil boolean) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE t text; nr bigint;
BEGIN
 FOREACH t IN ARRAY ARRAY['red_mail_loturi','red_mail_mesaje','red_mail_optout','red_mail_fisiere_inventar','red_mail_fisiere_inventar_antet','red_mail_jurnal_f2'] LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',t) INTO nr;
  IF (nr>0) IS DISTINCT FROM p_vizibil THEN RAISE EXCEPTION 'R2 RLS % vizibil=% nr=%',t,p_vizibil,nr; END IF;
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.f2_select_r2(boolean) TO authenticated;
SELECT pg_temp.f2_ca('f2000000-0000-4000-8000-000000000099','authenticated');
DO $editor_r2$ BEGIN
 IF public.fn_red_nivel() IS DISTINCT FROM 'editor' THEN RAISE EXCEPTION 'R2 fixture editor'; END IF;
 PERFORM pg_temp.f2_select_r2(false);
END $editor_r2$;
SELECT pg_temp.f2_ca(NULL,'postgres');
UPDATE public.user_module_access SET access_level='admin' WHERE profile_id='f2000000-0000-4000-8000-000000000099' AND module='redari';
SELECT pg_temp.f2_ca('f2000000-0000-4000-8000-000000000099','authenticated');
DO $admin_r2$ BEGIN
 IF public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'R2 fixture admin'; END IF;
 PERFORM pg_temp.f2_select_r2(false);
END $admin_r2$;
SELECT pg_temp.f2_ca(current_setting('f2.owner')::uuid,'authenticated');
SELECT pg_temp.f2_select_r2(true);
SELECT pg_temp.f2_ca(NULL,'postgres');
UPDATE public.red_proiecte SET retentie_mail_pana=(now() AT TIME ZONE 'Europe/Bucharest')::date-1 WHERE id='f2000000-0000-4000-8000-000000000001';
-- Simulează numai confirmarea absenței fișierului fictiv; niciun Storage real atins.
UPDATE public.red_mail_fisiere_inventar SET stare='sters' WHERE lot_id='f2000000-0000-4000-8000-000000000007';
DO $retentie_pre_r2$ BEGIN
 IF public.fn_red_mail_f2_retentie_poate('f2000000-0000-4000-8000-000000000007') IS NOT TRUE THEN RAISE EXCEPTION 'R2 fixture retentie neeligibil'; END IF;
END $retentie_pre_r2$;
SELECT pg_temp.f2_ca(current_setting('f2.owner')::uuid,'authenticated');
DO $sterge_r2$
DECLARE l uuid:='f2000000-0000-4000-8000-000000000007';
BEGIN
 IF public.fn_red_mail_lot_sterge_final(l,2,true) IS NOT TRUE THEN RAISE EXCEPTION 'R2 stergere finala refuzata'; END IF;
 IF EXISTS(SELECT 1 FROM public.red_mail_loturi WHERE id=l) OR EXISTS(SELECT 1 FROM public.red_mail_mesaje WHERE lot_id=l)
 OR EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar WHERE lot_id=l) OR EXISTS(SELECT 1 FROM public.red_mail_fisiere_inventar_antet WHERE lot_id=l)
 THEN RAISE EXCEPTION 'R2 stergere finala incompleta'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_jurnal_f2 WHERE lot_id=l AND cod='lot_sters_final') THEN RAISE EXCEPTION 'R2 audit stergere lipsa'; END IF;
END $sterge_r2$;
SELECT pg_temp.f2_ca(NULL,'postgres');-- Rând singleton absent: defect de infrastructură controlat, nu succes fals.
-- Triggerul F1 de interzicere DELETE este suspendat NUMAI în subtranzacția de fixture,
-- anulată prin PZ001; nu schimbăm migrarea F1 sau drepturi de producție.
DO $setari_absente_r2$
BEGIN
 BEGIN
  ALTER TABLE public.red_mail_setari DISABLE TRIGGER trg_red_mail_setari_reguli;
  DELETE FROM public.red_mail_setari WHERE id=1;
  PERFORM pg_temp.f2_ca(current_setting('f2.owner')::uuid,'authenticated');
  PERFORM pg_temp.f2_refuz('SELECT public.fn_red_mail_f2_setari(true,false,1)','22023','setari_absente');
  PERFORM pg_temp.f2_refuz($q$SELECT public.fn_red_mail_lot_creeaza('f2000000-0000-4000-8000-000000000008','f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002',ARRAY['f2000000-0000-4000-8000-000000000004']::uuid[],'Fictiv','Text fictiv')$q$,'22023','setari_absente');
  PERFORM pg_temp.f2_ca(NULL,'postgres');
  RAISE EXCEPTION 'anuleaza fixture singleton' USING ERRCODE='PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
 END;
 IF NOT EXISTS(SELECT 1 FROM public.red_mail_setari WHERE id=1) OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.red_mail_setari'::regclass AND tgname='trg_red_mail_setari_reguli' AND tgenabled='O') THEN RAISE EXCEPTION 'R2 fixture singleton nerestaurat'; END IF;
END $setari_absente_r2$;
ROLLBACK;

