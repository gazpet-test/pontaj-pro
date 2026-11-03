-- DRY 20261129i_redari_plicuri. Runner: o singura tranzactie ANULATA (migrare + teste + revenire + ROLLBACK). Date FICTIVE (proiect TEST-29I, UAT ZXH).
CREATE FUNCTION pg_temp.r29i_ca(p_uid uuid,p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol='postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims','',true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',CASE WHEN p_uid IS NULL THEN jsonb_build_object('role',p_rol)::text ELSE jsonb_build_object('sub',p_uid,'role',p_rol)::text END,true);
  EXECUTE format('SET LOCAL ROLE %I',p_rol);
END $h$;
CREATE FUNCTION pg_temp.r29i_refuza(p_sql text,p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 'r29i_refuza: a trecut fara eroare: %', left(p_sql,120); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>p_stare THEN RAISE NOTICE 'r29i_refuza: asteptat %, primit % (%)', p_stare, SQLSTATE, left(SQLERRM,160); END IF;
  RETURN SQLSTATE=p_stare;
END $h$;
CREATE FUNCTION pg_temp.r29i_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r29i.'||p,true),''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r29i_ca(uuid,text),pg_temp.r29i_refuza(text,text),pg_temp.r29i_g(text) TO authenticated,anon,service_role;

DO $t$
DECLARE own uuid; ed uuid; vw uuid; pr uuid; u uuid; par uuid[]; d uuid; k text; i integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129i_redari_plicuri:'||txid_current() THEN RAISE EXCEPTION 'TEST0 FAIL: garda'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level IN ('editor','admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level='editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  IF own IS NULL OR ed IS NULL OR vw IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_numere WHERE cheie IN ('PL-ZXH','PP')) OR EXISTS (SELECT 1 FROM public.red_uat WHERE uat3='ZXH') THEN RAISE EXCEPTION 'TEST0 FAIL: ZXH/PP folosite'; END IF;
  INSERT INTO public.red_proiecte(cod,denumire) VALUES('TEST-29I','FICTIV plicuri') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES(pr,'FICTIV ZXH','ZXH','Test') RETURNING id INTO u;
  FOR i IN 1..6 LOOP
    INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,poz_hg) VALUES(pr,u,'ZXH-000'||i,(10+i)::text) RETURNING id INTO d;
    par := par || d;
  END LOOP;
  -- A: aceeasi persoana pe parcelele 1 si 2 (aceeasi adresa); B: parcela 3; C: parcela 4, fara adresa; D: parcela 5
  FOREACH k IN ARRAY ARRAY['A1','A2','B','C','D'] LOOP
    INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate)
      VALUES(par[CASE k WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END],
             'FICTIV '||left(k,1),'FICTIV '||left(k,1),'proprietar') RETURNING id INTO d;
    INSERT INTO public.red_detinatori_contact(detinator_id,adresa_strada,adresa_sat,adresa_comuna,adresa_judet,cod_postal,adresa_cunoscuta)
      VALUES(d, CASE WHEN k='C' THEN NULL ELSE 'Str. Test '||left(k,1) END, NULL, CASE WHEN k='C' THEN NULL ELSE 'Comuna Test' END, 'Test', NULL, k<>'C');
    INSERT INTO public.red_convocari(detinator_id,canal,nr_document,stare) VALUES(d,'posta','C-T29I-'||k,'activ');
    PERFORM set_config('r29i.c'||k,(SELECT id FROM public.red_convocari WHERE nr_document='C-T29I-'||k)::text,true);
    PERFORM set_config('r29i.d'||k,d::text,true);
  END LOOP;
  -- A3: aceeasi persoana ca A, pe parcela 6, fara convocare deocamdata (pentru testele de completitudine)
  INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(par[6],'FICTIV A','FICTIV A','proprietar') RETURNING id INTO d;
  INSERT INTO public.red_detinatori_contact(detinator_id,adresa_strada,adresa_comuna,adresa_judet,adresa_cunoscuta) VALUES(d,'Str. Test A','Comuna Test','Test',true);
  PERFORM set_config('r29i.dA3',d::text,true);
  PERFORM set_config('r29i.owner',own::text,true); PERFORM set_config('r29i.editor',ed::text,true); PERFORM set_config('r29i.viewer',vw::text,true);
  PERFORM set_config('r29i.pr',pr::text,true);
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1: editorul nu scrie evidenta postala direct; plicul doar prin RPC, doar aceeasi persoana cu adresa, acelasi UAT
SELECT pg_temp.r29i_ca(pg_temp.r29i_g('editor')::uuid,'authenticated');
DO $t$ DECLARE pl public.red_plicuri; BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_convocari SET data_expediere='2026-11-03', nr_tracking='RR1' WHERE id=%L$q$,pg_temp.r29i_g('cA1')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: expediere directa'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$INSERT INTO public.red_plicuri(proiect_id,uat_id,nr_plic,cheie_persoana,destinatar_nume) SELECT %L,uat_id,'PL-ZXH-0099','x','y' FROM public.red_parcele WHERE proiect_id=%L LIMIT 1$q$,pg_temp.r29i_g('pr'),pg_temp.r29i_g('pr')),'42501') THEN RAISE EXCEPTION 'TEST1 FAIL: insert direct plic'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$SELECT public.fn_red_plic_creeaza(%L, ARRAY[%L,%L]::uuid[])$q$,pg_temp.r29i_g('pr'),pg_temp.r29i_g('cB'),pg_temp.r29i_g('cD')),'P0001') THEN RAISE EXCEPTION 'TEST1 FAIL: persoane diferite'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$SELECT public.fn_red_plic_creeaza(%L, ARRAY[%L]::uuid[])$q$,pg_temp.r29i_g('pr'),pg_temp.r29i_g('cC')),'P0001') THEN RAISE EXCEPTION 'TEST1 FAIL: fara adresa'; END IF;
  -- r1 P1: plic partial (doar A1, desi A2 e eligibila pentru aceeasi persoana) -> refuz
  IF NOT pg_temp.r29i_refuza(format($q$SELECT public.fn_red_plic_creeaza(%L, ARRAY[%L]::uuid[])$q$,pg_temp.r29i_g('pr'),pg_temp.r29i_g('cA1')),'P0001') THEN RAISE EXCEPTION 'TEST1 FAIL: plic partial'; END IF;
  pl := public.fn_red_plic_creeaza(pg_temp.r29i_g('pr')::uuid, ARRAY[pg_temp.r29i_g('cA1')::uuid, pg_temp.r29i_g('cA2')::uuid]);
  IF pl.nr_plic <> 'PL-ZXH-0001' OR (SELECT count(*) FROM public.red_convocari WHERE plic_id=pl.id) <> 2 THEN RAISE EXCEPTION 'TEST1 FAIL: plic A'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$SELECT public.fn_red_plic_creeaza(%L, ARRAY[%L]::uuid[])$q$,pg_temp.r29i_g('pr'),pg_temp.r29i_g('cA1')),'P0001') THEN RAISE EXCEPTION 'TEST1 FAIL: deja in plic'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_convocari SET plic_id=NULL WHERE id=%L$q$,pg_temp.r29i_g('cA1')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: plic_id direct'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_convocari SET sters_la=now(), sters_motiv='x' WHERE id=%L$q$,pg_temp.r29i_g('cA1')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: stergere logica din plic activ'; END IF;
  PERFORM set_config('r29i.plA',pl.id::text,true);
  -- r2 P1: convocare postala noua pentru aceeasi persoana, cat plicul e neexpediat -> refuz
  IF NOT pg_temp.r29i_refuza(format($q$INSERT INTO public.red_convocari(detinator_id,canal,nr_document,stare) VALUES(%L,'posta','C-T29I-A3','activ')$q$,pg_temp.r29i_g('dA3')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: convocare noua cu plic neexpediat'; END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: expedierea cere lot FINALIZAT (PV semnat atasat + 2 semnatari, data plicuirii <= expedierea); lotul doar prin RPC; propagare
DO $t$ DECLARE lot public.red_loturi_plicuire; BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET awb='RR000000001RO', data_expediere='2026-11-03' WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: expediere fara lot'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET lot_id=gen_random_uuid() WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: lot direct'; END IF;
  lot := public.fn_red_lot_plicuire_creeaza(pg_temp.r29i_g('pr')::uuid, ARRAY[pg_temp.r29i_g('plA')::uuid], DATE '2026-11-03');
  IF lot.nr_lot <> 'PP-0001' OR (SELECT lot_id FROM public.red_plicuri WHERE id=pg_temp.r29i_g('plA')::uuid) IS DISTINCT FROM lot.id THEN RAISE EXCEPTION 'TEST2 FAIL: lot'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET awb='RR000000001RO', data_expediere='2026-11-03' WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: expediere cu lot nefinalizat'; END IF;
  PERFORM set_config('r29i.lot',lot.id::text,true);
  RAISE NOTICE 'TEST2a OK';
END $t$;
SELECT pg_temp.r29i_ca(NULL,'postgres');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('redari','plicuire/'||pg_temp.r29i_g('lot')||'/pv-1.pdf','{"mimetype":"application/pdf"}'::jsonb);
SELECT pg_temp.r29i_ca(pg_temp.r29i_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_loturi_plicuire SET pv_path='plicuire/%s/pv-1.pdf', semnatar1='FICTIV 1' WHERE id=%L$q$,pg_temp.r29i_g('lot'),pg_temp.r29i_g('lot')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: PV fara al doilea semnatar'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_loturi_plicuire SET pv_path='plicuire/%s/../pv-1.pdf', semnatar1='FICTIV 1', semnatar2='FICTIV 2' WHERE id=%L$q$,pg_temp.r29i_g('lot'),pg_temp.r29i_g('lot')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: cale PV'; END IF;
  UPDATE public.red_loturi_plicuire SET pv_path='plicuire/'||pg_temp.r29i_g('lot')||'/pv-1.pdf', semnatar1='FICTIV 1', semnatar2='FICTIV 2' WHERE id=pg_temp.r29i_g('lot')::uuid;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_loturi_plicuire SET semnatar2='ALTUL' WHERE id=%L$q$,pg_temp.r29i_g('lot')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: semnatar schimbat dupa PV'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET awb='RR000000001RO', data_expediere='2026-11-02' WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: expediere inaintea plicuirii'; END IF;
  RAISE NOTICE 'TEST2b OK';
END $t$;
-- r2 P1 (secvential): o convocare noua a aceleiasi persoane aparuta dupa plicuire (aici inserata ca postgres, ocolind garda) blocheaza expedierea
SELECT pg_temp.r29i_ca(NULL,'postgres');
INSERT INTO public.red_convocari(detinator_id,canal,nr_document,stare) VALUES(pg_temp.r29i_g('dA3')::uuid,'posta','C-T29I-A3','activ');
SELECT pg_temp.r29i_ca(pg_temp.r29i_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET awb='RR000000001RO', data_expediere='2026-11-03' WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: expediere cu plic incomplet'; END IF;
  RAISE NOTICE 'TEST2c OK';
END $t$;
-- r2 P2: adresa unui detinator din plic schimbata dupa plicuire -> expedierea refuzata; convocarea noua anulata
SELECT pg_temp.r29i_ca(NULL,'postgres');
UPDATE public.red_convocari SET stare='anulat', motiv_anulare='test' WHERE nr_document='C-T29I-A3';
UPDATE public.red_detinatori_contact SET adresa_strada='Str. Alta' WHERE detinator_id=pg_temp.r29i_g('dA2')::uuid;
SELECT pg_temp.r29i_ca(pg_temp.r29i_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET awb='RR000000001RO', data_expediere='2026-11-03' WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: expediere cu adresa schimbata'; END IF;
  RAISE NOTICE 'TEST2d OK';
END $t$;
SELECT pg_temp.r29i_ca(NULL,'postgres');
UPDATE public.red_detinatori_contact SET adresa_strada='Str. Test A' WHERE detinator_id=pg_temp.r29i_g('dA2')::uuid;
SELECT pg_temp.r29i_ca(pg_temp.r29i_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_plicuri SET awb='rr 000000001 ro', data_expediere='2026-11-03' WHERE id=pg_temp.r29i_g('plA')::uuid;
  IF (SELECT count(*) FROM public.red_convocari WHERE plic_id=pg_temp.r29i_g('plA')::uuid AND data_expediere='2026-11-03' AND nr_tracking='RR000000001RO') <> 2 THEN RAISE EXCEPTION 'TEST2 FAIL: propagare expediere'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET awb='RR000000009RO' WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: awb schimbat'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;

-- TEST3: AR cere scan existent in Storage, in folderul plicului; propagare; retur dupa AR refuzat
DO $t$ BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET data_ar='2026-11-05' WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: AR fara scan'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='plicuri/%s/ar.pdf' WHERE id=%L$q$,pg_temp.r29i_g('plA'),pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: scan inexistent'; END IF;
  RAISE NOTICE 'TEST3a OK';
END $t$;
SELECT pg_temp.r29i_ca(NULL,'postgres');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('redari','plicuri/'||pg_temp.r29i_g('plA')||'/ar.pdf','{"mimetype":"application/pdf"}'::jsonb),
  ('redari','alt_folder/ar.pdf','{"mimetype":"application/pdf"}'::jsonb);
SELECT pg_temp.r29i_ca(pg_temp.r29i_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='alt_folder/ar.pdf' WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: scan in alt folder'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET data_ar='2026-11-01', ar_scan_path='plicuri/%s/ar.pdf' WHERE id=%L$q$,pg_temp.r29i_g('plA'),pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: AR inainte de expediere'; END IF;
  UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='plicuri/'||pg_temp.r29i_g('plA')||'/ar.pdf' WHERE id=pg_temp.r29i_g('plA')::uuid;
  IF (SELECT count(*) FROM public.red_convocari WHERE plic_id=pg_temp.r29i_g('plA')::uuid AND data_confirmare_primire='2026-11-05') <> 2 THEN RAISE EXCEPTION 'TEST3 FAIL: propagare AR'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET retur='refuz', retur_data='2026-11-06', retur_scan_path='plicuri/%s/ar.pdf' WHERE id=%L$q$,pg_temp.r29i_g('plA'),pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: retur dupa AR'; END IF;
  RAISE NOTICE 'TEST3 OK';
END $t$;

-- TEST4: retur „decedat” pe plicul lui B: convocarea primeste returul, detinatorul e marcat decedat; „altul” cere text
DO $t$ DECLARE pl public.red_plicuri; BEGIN
  pl := public.fn_red_plic_creeaza(pg_temp.r29i_g('pr')::uuid, ARRAY[pg_temp.r29i_g('cB')::uuid]);
  IF pl.nr_plic <> 'PL-ZXH-0002' THEN RAISE EXCEPTION 'TEST4 FAIL: numar'; END IF;
  PERFORM set_config('r29i.lotB',(public.fn_red_lot_plicuire_creeaza(pg_temp.r29i_g('pr')::uuid, ARRAY[pl.id], DATE '2026-11-03')).id::text,true);
  PERFORM set_config('r29i.plB',pl.id::text,true);
  RAISE NOTICE 'TEST4a OK';
END $t$;
SELECT pg_temp.r29i_ca(NULL,'postgres');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('redari','plicuire/'||pg_temp.r29i_g('lotB')||'/pv-1.pdf','{"mimetype":"application/pdf"}'::jsonb);
SELECT pg_temp.r29i_ca(pg_temp.r29i_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  UPDATE public.red_loturi_plicuire SET pv_path='plicuire/'||pg_temp.r29i_g('lotB')||'/pv-1.pdf', semnatar1='FICTIV 1', semnatar2='FICTIV 2' WHERE id=pg_temp.r29i_g('lotB')::uuid;
  UPDATE public.red_plicuri SET awb='RR000000002RO', data_expediere='2026-11-03' WHERE id=pg_temp.r29i_g('plB')::uuid;
  RAISE NOTICE 'TEST4b OK';
END $t$;
SELECT pg_temp.r29i_ca(NULL,'postgres');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('redari','plicuri/'||pg_temp.r29i_g('plB')||'/retur.pdf','{"mimetype":"application/pdf"}'::jsonb);
SELECT pg_temp.r29i_ca(pg_temp.r29i_g('editor')::uuid,'authenticated');
DO $t$ BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET retur='altul', retur_data='2026-11-07', retur_scan_path='plicuri/%s/retur.pdf' WHERE id=%L$q$,pg_temp.r29i_g('plB'),pg_temp.r29i_g('plB')),'23514') THEN RAISE EXCEPTION 'TEST4 FAIL: altul fara text'; END IF;
  UPDATE public.red_plicuri SET retur='decedat', retur_data='2026-11-07', retur_scan_path='plicuri/'||pg_temp.r29i_g('plB')||'/retur.pdf' WHERE id=pg_temp.r29i_g('plB')::uuid;
  IF (SELECT retur IS DISTINCT FROM 'decedat' OR retur_data IS DISTINCT FROM '2026-11-07' FROM public.red_convocari WHERE id=pg_temp.r29i_g('cB')::uuid) THEN RAISE EXCEPTION 'TEST4 FAIL: propagare retur'; END IF;
  IF (SELECT decedat IS NOT TRUE FROM public.red_detinatori WHERE id=pg_temp.r29i_g('dB')::uuid) THEN RAISE EXCEPTION 'TEST4 FAIL: decedat'; END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;

-- TEST5: anulare — refuzata dupa expediere; inainte de expediere elibereaza convocarile
DO $t$ DECLARE pl public.red_plicuri; BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET stare='anulat', motiv_anulare='test' WHERE id=%L$q$,pg_temp.r29i_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST5 FAIL: anulare dupa expediere'; END IF;
  pl := public.fn_red_plic_creeaza(pg_temp.r29i_g('pr')::uuid, ARRAY[pg_temp.r29i_g('cD')::uuid]);
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_convocari SET stare='anulat', motiv_anulare='x' WHERE id=%L$q$,pg_temp.r29i_g('cD')),'23514') THEN RAISE EXCEPTION 'TEST5 FAIL: convocare anulata din plic activ'; END IF;
  UPDATE public.red_plicuri SET stare='anulat', motiv_anulare='adresa gresita' WHERE id=pl.id;
  IF (SELECT plic_id IS NOT NULL FROM public.red_convocari WHERE id=pg_temp.r29i_g('cD')::uuid) THEN RAISE EXCEPTION 'TEST5 FAIL: convocarea nu a fost eliberata'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_plicuri SET stare='activ' WHERE id=%L$q$,pl.id),'23514') THEN RAISE EXCEPTION 'TEST5 FAIL: plic anulat modificat'; END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;

-- TEST6: viewer nu scrie, anon nu citeste, service_role nu ocoleste garda postala pe convocari
SELECT pg_temp.r29i_ca(pg_temp.r29i_g('viewer')::uuid,'authenticated');
DO $t$ DECLARE n integer; BEGIN
  IF (SELECT count(*) FROM public.red_plicuri WHERE proiect_id=pg_temp.r29i_g('pr')::uuid) <> 3 THEN RAISE EXCEPTION 'TEST6 FAIL: viewer nu vede'; END IF;
  BEGIN UPDATE public.red_loturi_plicuire SET observatii='viewer' WHERE id=pg_temp.r29i_g('lot')::uuid; GET DIAGNOSTICS n=ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n:=0; END;
  IF n <> 0 THEN RAISE EXCEPTION 'TEST6 FAIL: viewer a scris'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$SELECT public.fn_red_plic_creeaza(%L, ARRAY[%L]::uuid[])$q$,pg_temp.r29i_g('pr'),pg_temp.r29i_g('cD')),'42501') THEN RAISE EXCEPTION 'TEST6 FAIL: viewer plicuieste'; END IF;
  RAISE NOTICE 'TEST6a OK';
END $t$;
SELECT pg_temp.r29i_ca(NULL,'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r29i_refuza('SELECT count(*) FROM public.red_plicuri','42501') THEN RAISE EXCEPTION 'TEST6 FAIL: anon citeste'; END IF;
  RAISE NOTICE 'TEST6b OK';
END $t$;
SELECT pg_temp.r29i_ca(NULL,'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.r29i_refuza(format($q$UPDATE public.red_convocari SET data_confirmare_primire='2026-11-08' WHERE id=%L$q$,pg_temp.r29i_g('cD')),'23514') THEN RAISE EXCEPTION 'TEST6 FAIL: service_role ocoleste garda'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$INSERT INTO public.red_plicuri(proiect_id,uat_id,nr_plic,cheie_persoana,destinatar_nume) SELECT %L,uat_id,'PL-ZXH-0098','x','y' FROM public.red_plicuri LIMIT 1$q$,pg_temp.r29i_g('pr')),'42501') THEN RAISE EXCEPTION 'TEST6 FAIL: service_role insereaza plic'; END IF;
  IF NOT pg_temp.r29i_refuza(format($q$DELETE FROM public.red_loturi_plicuire WHERE id=%L$q$,pg_temp.r29i_g('lot')),'42501') THEN RAISE EXCEPTION 'TEST6 FAIL: service_role sterge lot'; END IF;
  RAISE NOTICE 'TEST6c OK';
END $t$;
-- TEST7: celelalte canale raman cu evidenta directa; jurnalul a primit plicurile si lotul
SELECT pg_temp.r29i_ca(NULL,'postgres');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.red_jurnal WHERE tabela='red_plicuri') < 3 OR (SELECT count(*) FROM public.red_jurnal WHERE tabela='red_loturi_plicuire') < 2 THEN RAISE EXCEPTION 'TEST7 FAIL: jurnal'; END IF;
  RAISE NOTICE 'TEST7 OK';
END $t$;
