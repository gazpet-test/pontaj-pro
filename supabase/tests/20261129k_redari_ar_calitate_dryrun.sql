-- DRY 20261129k_redari_ar_calitate. Runner: o singura tranzactie ANULATA (marcaj + migrare + teste + control 0e + revenire + ROLLBACK), ca la 29i / 29j.
-- Ruleaza DUPA migrarea 29k (marcajul gazpet.livrare_migrare = '20261129k_redari_ar_calitate:<txid>'). Identitati reale (owner, un editor si un viewer
-- Redari, alesi din catalog), date FICTIVE (proiect TEST-29K, UAT ZXK), totul anulat la ROLLBACK.
-- Acopera: calitatea obligatorie la „alta persoana”, interzisa la destinatar si fara AR (CHECK NULL-safe), valoare invalida refuzata, imuabila dupa AR
-- (aplicatie, service_role, postgres cu JWT), mentenanta postgres fara JWT permisa, editorul o scrie la inregistrarea AR, viewer / anon nu;
-- privilegiile pe coloane si 0 functii expuse cu set_config.
CREATE FUNCTION pg_temp.r29k_ca(p_uid uuid,p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol='postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims','',true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims',CASE WHEN p_uid IS NULL THEN jsonb_build_object('role',p_rol)::text ELSE jsonb_build_object('sub',p_uid,'role',p_rol)::text END,true);
  EXECUTE format('SET LOCAL ROLE %I',p_rol);
END $h$;
CREATE FUNCTION pg_temp.r29k_refuza(p_sql text,p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RAISE NOTICE 'r29k_refuza: a trecut fara eroare: %', left(p_sql,160); RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>p_stare THEN RAISE NOTICE 'r29k_refuza: asteptat %, primit % (%)', p_stare, SQLSTATE, left(SQLERRM,160); END IF;
  RETURN SQLSTATE=p_stare;
END $h$;
CREATE FUNCTION pg_temp.r29k_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r29k.'||p,true),''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r29k_ca(uuid,text),pg_temp.r29k_refuza(text,text),pg_temp.r29k_g(text) TO authenticated,anon,service_role;

-- TEST0: garda, identitati, date fictive (3 persoane cu adresa, cate o convocare postala; A, B, D pe parcele diferite)
DO $t$
DECLARE own uuid; ed uuid; vw uuid; pr uuid; u uuid; par uuid; d uuid; k text; i integer := 0;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129k_redari_ar_calitate:'||txid_current() THEN RAISE EXCEPTION 'TEST0 FAIL: garda'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='red_plicuri' AND column_name='ar_primit_calitate') THEN RAISE EXCEPTION 'TEST0 FAIL: 29k neaplicata'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level IN ('editor','admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level='editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id=a.profile_id
    WHERE a.module='redari' AND a.access_level='viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  IF own IS NULL OR ed IS NULL OR vw IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_numere WHERE cheie='PL-ZXK') OR EXISTS (SELECT 1 FROM public.red_uat WHERE uat3='ZXK') OR EXISTS (SELECT 1 FROM public.red_proiecte WHERE cod='TEST-29K') THEN
    RAISE EXCEPTION 'TEST0 FAIL: ZXK / TEST-29K folosite';
  END IF;
  INSERT INTO public.red_proiecte(cod,denumire) VALUES('TEST-29K','FICTIV calitate AR') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES(pr,'FICTIV ZXK','ZXK','Test') RETURNING id INTO u;
  FOREACH k IN ARRAY ARRAY['A','B','D'] LOOP
    i := i + 1;
    INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,poz_hg) VALUES(pr,u,'ZXK-000'||i,(20+i)::text) RETURNING id INTO par;
    INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate) VALUES(par,'FICTIV '||k,'FICTIV '||k,'proprietar') RETURNING id INTO d;
    INSERT INTO public.red_detinatori_contact(detinator_id,adresa_strada,adresa_comuna,adresa_judet,adresa_cunoscuta) VALUES(d,'Str. Test '||k,'Comuna Test','Test',true);
    INSERT INTO public.red_convocari(detinator_id,canal,nr_document,stare) VALUES(d,'posta','C-T29K-'||k,'activ');
    PERFORM set_config('r29k.c'||k,(SELECT id FROM public.red_convocari WHERE nr_document='C-T29K-'||k)::text,true);
  END LOOP;
  PERFORM set_config('r29k.owner',own::text,true); PERFORM set_config('r29k.editor',ed::text,true); PERFORM set_config('r29k.viewer',vw::text,true);
  PERFORM set_config('r29k.pr',pr::text,true);
  RAISE NOTICE 'TEST0 OK';
END $t$;

-- TEST1 (editor): plicurile A, B, D prin RPC, un lot; calitatea fara AR refuzata (CHECK NULL-safe: ar_primit_de NULL)
SELECT pg_temp.r29k_ca(pg_temp.r29k_g('editor')::uuid,'authenticated');
DO $t$ DECLARE pl public.red_plicuri; k text; lot public.red_loturi_plicuire; BEGIN
  FOREACH k IN ARRAY ARRAY['A','B','D'] LOOP
    pl := public.fn_red_plic_creeaza(pg_temp.r29k_g('pr')::uuid, ARRAY[pg_temp.r29k_g('c'||k)::uuid]);
    IF pl.id IS NULL OR pl.ar_primit_calitate IS NOT NULL THEN RAISE EXCEPTION 'TEST1 FAIL: plic %', k; END IF;
    PERFORM set_config('r29k.pl'||k,pl.id::text,true);
  END LOOP;
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate='vecin' WHERE id=%L$q$,pg_temp.r29k_g('plD')),'23514') THEN RAISE EXCEPTION 'TEST1 FAIL: calitate fara AR (plic neexpediat)'; END IF;
  lot := public.fn_red_lot_plicuire_creeaza(pg_temp.r29k_g('pr')::uuid, ARRAY[pg_temp.r29k_g('plA')::uuid, pg_temp.r29k_g('plB')::uuid, pg_temp.r29k_g('plD')::uuid], DATE '2026-11-03');
  IF lot.id IS NULL THEN RAISE EXCEPTION 'TEST1 FAIL: lot'; END IF;
  PERFORM set_config('r29k.lot',lot.id::text,true);
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- fisierele din Storage (PV lot, opisuri, scanuri AR) si imputernicirea, ca postgres
SELECT pg_temp.r29k_ca(NULL,'postgres');
INSERT INTO storage.objects(bucket_id,name,metadata)
  SELECT 'redari', x, '{"mimetype":"application/pdf"}'::jsonb FROM unnest(ARRAY[
    'plicuire/'||pg_temp.r29k_g('lot')||'/pv-1.pdf',
    'plicuri/'||pg_temp.r29k_g('plA')||'/opis-1.pdf', 'plicuri/'||pg_temp.r29k_g('plB')||'/opis-1.pdf', 'plicuri/'||pg_temp.r29k_g('plD')||'/opis-1.pdf',
    'plicuri/'||pg_temp.r29k_g('plA')||'/ar-1.pdf', 'plicuri/'||pg_temp.r29k_g('plB')||'/ar-1.pdf', 'plicuri/'||pg_temp.r29k_g('plD')||'/ar-1.pdf']) x;
UPDATE public.red_proiecte SET imputernicire_nr='TEST-29K', imputernicire_data='2026-11-01' WHERE id=pg_temp.r29k_g('pr')::uuid;

-- TEST2 (editor): lotul finalizat, opisurile, expedierea celor 3 plicuri
SELECT pg_temp.r29k_ca(pg_temp.r29k_g('editor')::uuid,'authenticated');
DO $t$ DECLARE k text; i integer := 0; BEGIN
  UPDATE public.red_loturi_plicuire SET pv_path='plicuire/'||pg_temp.r29k_g('lot')||'/pv-1.pdf', semnatar1_id=pg_temp.r29k_g('editor')::uuid, semnatar2_id=pg_temp.r29k_g('owner')::uuid
   WHERE id=pg_temp.r29k_g('lot')::uuid;
  FOREACH k IN ARRAY ARRAY['A','B','D'] LOOP
    i := i + 1;
    UPDATE public.red_plicuri SET opis_path='plicuri/'||pg_temp.r29k_g('pl'||k)||'/opis-1.pdf' WHERE id=pg_temp.r29k_g('pl'||k)::uuid;
    UPDATE public.red_plicuri SET awb='RR00000000'||i||'RO', data_expediere='2026-11-03' WHERE id=pg_temp.r29k_g('pl'||k)::uuid;
  END LOOP;
  IF (SELECT count(*) FROM public.red_plicuri WHERE proiect_id=pg_temp.r29k_g('pr')::uuid AND data_expediere='2026-11-03') <> 3 THEN RAISE EXCEPTION 'TEST2 FAIL: expediere'; END IF;
  -- dupa expediere, fara AR: calitatea singura tot refuzata
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate='membru_familie' WHERE id=%L$q$,pg_temp.r29k_g('plD')),'23514') THEN RAISE EXCEPTION 'TEST2 FAIL: calitate fara AR (plic expediat)'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;

-- TEST3 (editor): AR „alta persoana” pe plicul A — calitatea obligatorie, din lista; mentiunea ramane obligatorie; editorul scrie calitatea odata cu AR-ul
DO $t$ DECLARE r public.red_plicuri; BEGIN
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='plicuri/%s/ar-1.pdf', ar_primit_de='alta_persoana', ar_mentiune='FICTIV mentiune' WHERE id=%L$q$,
       pg_temp.r29k_g('plA'),pg_temp.r29k_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: alta persoana fara calitate'; END IF;
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='plicuri/%s/ar-1.pdf', ar_primit_de='alta_persoana', ar_mentiune='FICTIV mentiune', ar_primit_calitate='prieten' WHERE id=%L$q$,
       pg_temp.r29k_g('plA'),pg_temp.r29k_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: calitate invalida'; END IF;
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='plicuri/%s/ar-1.pdf', ar_primit_de='alta_persoana', ar_primit_calitate='membru_familie' WHERE id=%L$q$,
       pg_temp.r29k_g('plA'),pg_temp.r29k_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: calitate fara mentiune (mentiunea ramane obligatorie)'; END IF;
  UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='plicuri/'||pg_temp.r29k_g('plA')||'/ar-1.pdf', ar_primit_de='alta_persoana',
         ar_mentiune='FICTIV mentiune de pe cartonas', ar_primit_calitate='membru_familie'
   WHERE id=pg_temp.r29k_g('plA')::uuid RETURNING * INTO r;
  IF r.id IS NULL OR r.ar_primit_calitate IS DISTINCT FROM 'membru_familie' OR r.ar_mentiune IS DISTINCT FROM 'FICTIV mentiune de pe cartonas' THEN RAISE EXCEPTION 'TEST3 FAIL: AR cu calitate'; END IF;
  IF (SELECT data_confirmare_primire FROM public.red_convocari WHERE id=pg_temp.r29k_g('cA')::uuid) IS DISTINCT FROM '2026-11-05'::date THEN RAISE EXCEPTION 'TEST3 FAIL: propagare AR'; END IF;
  -- imuabila dupa AR: alta valoare, NULL, si impreuna cu o alta coloana permisa
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate='vecin' WHERE id=%L$q$,pg_temp.r29k_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: calitate schimbata dupa AR'; END IF;
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate=NULL WHERE id=%L$q$,pg_temp.r29k_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: calitate stearsa dupa AR'; END IF;
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate='alta_persoana', motiv_anulare=NULL WHERE id=%L$q$,pg_temp.r29k_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST3 FAIL: calitate schimbata impreuna cu alta coloana'; END IF;
  IF (SELECT ar_primit_calitate FROM public.red_plicuri WHERE id=pg_temp.r29k_g('plA')::uuid) IS DISTINCT FROM 'membru_familie' THEN RAISE EXCEPTION 'TEST3 FAIL: valoarea s-a schimbat'; END IF;
  RAISE NOTICE 'TEST3 OK';
END $t$;

-- TEST4 (editor): AR „destinatar” pe plicul B — calitatea interzisa; dupa AR nu se poate adauga
DO $t$ BEGIN
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='plicuri/%s/ar-1.pdf', ar_primit_de='destinatar', ar_primit_calitate='vecin' WHERE id=%L$q$,
       pg_temp.r29k_g('plB'),pg_temp.r29k_g('plB')),'23514') THEN RAISE EXCEPTION 'TEST4 FAIL: calitate la destinatar'; END IF;
  UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='plicuri/'||pg_temp.r29k_g('plB')||'/ar-1.pdf', ar_primit_de='destinatar' WHERE id=pg_temp.r29k_g('plB')::uuid;
  IF (SELECT data_ar IS NULL OR ar_primit_calitate IS NOT NULL FROM public.red_plicuri WHERE id=pg_temp.r29k_g('plB')::uuid) THEN RAISE EXCEPTION 'TEST4 FAIL: AR destinatar'; END IF;
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate='vecin' WHERE id=%L$q$,pg_temp.r29k_g('plB')),'23514') THEN RAISE EXCEPTION 'TEST4 FAIL: calitate adaugata dupa AR destinatar'; END IF;
  RAISE NOTICE 'TEST4 OK';
END $t$;

-- TEST5 (viewer): citeste calitatea, nu o scrie (RLS: 0 randuri sau refuz de privilegiu)
SELECT pg_temp.r29k_ca(pg_temp.r29k_g('viewer')::uuid,'authenticated');
DO $t$ DECLARE n integer; BEGIN
  IF (SELECT ar_primit_calitate FROM public.red_plicuri WHERE id=pg_temp.r29k_g('plA')::uuid) IS DISTINCT FROM 'membru_familie' THEN RAISE EXCEPTION 'TEST5 FAIL: viewer nu citeste calitatea'; END IF;
  BEGIN
    UPDATE public.red_plicuri SET data_ar='2026-11-05', ar_scan_path='plicuri/'||pg_temp.r29k_g('plD')||'/ar-1.pdf', ar_primit_de='alta_persoana', ar_mentiune='FICTIV', ar_primit_calitate='vecin'
     WHERE id=pg_temp.r29k_g('plD')::uuid;
    GET DIAGNOSTICS n=ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n:=0; END;
  IF n <> 0 THEN RAISE EXCEPTION 'TEST5 FAIL: viewer a scris'; END IF;
  RAISE NOTICE 'TEST5 OK';
END $t$;

-- TEST6 (anon): nici citire, nici scriere
SELECT pg_temp.r29k_ca(NULL,'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r29k_refuza('SELECT ar_primit_calitate FROM public.red_plicuri LIMIT 1','42501') THEN RAISE EXCEPTION 'TEST6 FAIL: anon citeste'; END IF;
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate='vecin' WHERE id=%L$q$,pg_temp.r29k_g('plD')),'42501') THEN RAISE EXCEPTION 'TEST6 FAIL: anon scrie'; END IF;
  RAISE NOTICE 'TEST6 OK';
END $t$;

-- TEST7 (service_role, BYPASSRLS, are UPDATE pe coloana): tot nu schimba calitatea dupa AR
SELECT pg_temp.r29k_ca(NULL,'service_role');
DO $t$ BEGIN
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate='vecin' WHERE id=%L$q$,pg_temp.r29k_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST7 FAIL: service_role schimba calitatea'; END IF;
  RAISE NOTICE 'TEST7 OK';
END $t$;

-- TEST8 (postgres): cu JWT (ca in RPC-uri) refuzat; mentenanta fara JWT permisa, dar tot in CHECK-uri
SELECT pg_temp.r29k_ca(NULL,'postgres');
DO $t$ DECLARE ok boolean := false; BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
  BEGIN
    UPDATE public.red_plicuri SET ar_primit_calitate='vecin' WHERE id=pg_temp.r29k_g('plA')::uuid;
    RAISE EXCEPTION 'TEST8 FAIL: postgres cu JWT schimba calitatea';
  EXCEPTION WHEN check_violation THEN ok := true; END;
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT ok THEN RAISE EXCEPTION 'TEST8 FAIL'; END IF;
  UPDATE public.red_plicuri SET ar_primit_calitate='vecin' WHERE id=pg_temp.r29k_g('plA')::uuid;
  IF (SELECT ar_primit_calitate FROM public.red_plicuri WHERE id=pg_temp.r29k_g('plA')::uuid) IS DISTINCT FROM 'vecin' THEN RAISE EXCEPTION 'TEST8 FAIL: mentenanta'; END IF;
  UPDATE public.red_plicuri SET ar_primit_calitate='membru_familie' WHERE id=pg_temp.r29k_g('plA')::uuid;
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate=NULL WHERE id=%L$q$,pg_temp.r29k_g('plA')),'23514') THEN RAISE EXCEPTION 'TEST8 FAIL: mentenanta ocoleste CHECK-ul'; END IF;
  IF NOT pg_temp.r29k_refuza(format($q$UPDATE public.red_plicuri SET ar_primit_calitate='membru_familie' WHERE id=%L$q$,pg_temp.r29k_g('plB')),'23514') THEN RAISE EXCEPTION 'TEST8 FAIL: mentenanta pune calitate la destinatar'; END IF;
  RAISE NOTICE 'TEST8 OK';
END $t$;

-- TEST9 (catalog): privilegii pe coloana, functia neexpusa, lot_id tot fara UPDATE, 0 functii expuse cu set_config
DO $t$ BEGIN
  IF NOT has_column_privilege('authenticated','public.red_plicuri','ar_primit_calitate','UPDATE') OR NOT has_column_privilege('service_role','public.red_plicuri','ar_primit_calitate','UPDATE')
     OR has_column_privilege('anon','public.red_plicuri','ar_primit_calitate','UPDATE') OR has_column_privilege('authenticated','public.red_plicuri','ar_primit_calitate','INSERT') THEN
    RAISE EXCEPTION 'TEST9 FAIL: privilegii pe ar_primit_calitate';
  END IF;
  IF has_column_privilege('authenticated','public.red_plicuri','lot_id','UPDATE') OR has_table_privilege('authenticated','public.red_plicuri','UPDATE') THEN RAISE EXCEPTION 'TEST9 FAIL: lot_id / tabel scriibil'; END IF;
  IF has_function_privilege('authenticated','public.fn_red_plic_ar_calitate()','EXECUTE') OR has_function_privilege('anon','public.fn_red_plic_ar_calitate()','EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid='public.fn_red_plic_ar_calitate()'::regprocedure) THEN RAISE EXCEPTION 'TEST9 FAIL: functia triggerului expusa / DEFINER'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public','graphql_public') AND p.prosrc ~* 'set_config'
               AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'TEST9 FAIL: set_config in functie expusa';
  END IF;
  -- jurnalul a primit AR-ul cu calitatea, scris de editor
  IF NOT EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela='red_plicuri' AND inregistrare_id=pg_temp.r29k_g('plA')::uuid AND actiune='update'
                   AND date_noi->>'ar_primit_calitate'='membru_familie' AND date_vechi->>'ar_primit_calitate' IS NULL AND user_id=pg_temp.r29k_g('editor')::uuid) THEN
    RAISE EXCEPTION 'TEST9 FAIL: jurnal';
  END IF;
  RAISE NOTICE 'TEST9 OK';
END $t$;
