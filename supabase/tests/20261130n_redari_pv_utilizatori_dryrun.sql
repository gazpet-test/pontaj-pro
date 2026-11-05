-- psql, ONLY on a disposable clone with production schema, roles and ACL. NO live data.
-- This file owns ONE transaction, always rolled back, including the migration and identities.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('gazpet.livrare_migrare','20261130n_redari_pv_utilizatori:'||txid_current(),true);
\ir ../migrations/20261130n_redari_pv_utilizatori.sql
-- Schema-only apply -> rollback -> re-apply, before any business fixture/history.
SELECT set_config('gazpet.livrare_migrare','20261130n_redari_pv_utilizatori_ROLLBACK:'||txid_current(),true);
\ir ../revenire/20261130n_redari_pv_utilizatori_ROLLBACK.sql
SELECT set_config('gazpet.livrare_migrare','20261130n_redari_pv_utilizatori:'||txid_current(),true);
\ir ../migrations/20261130n_redari_pv_utilizatori.sql
-- Fictive identities, no existing persons/accounts needed; refuse UUID collisions.
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-00000030a001','pr1.editor@example.invalid'),
 ('00000000-0000-4000-8000-00000030a002','pr1.fara-acces@example.invalid');
INSERT INTO public.profiles(id,email,name,role,is_owner) VALUES
 ('00000000-0000-4000-8000-00000030a001','pr1.editor@example.invalid','FICTIV EDITOR','manager_santier',false),
 ('00000000-0000-4000-8000-00000030a002','pr1.fara-acces@example.invalid','FICTIV FARA ACCES','manager_santier',false);
INSERT INTO public.user_module_access(profile_id,module,access_level)
 VALUES('00000000-0000-4000-8000-00000030a001','redari','editor');
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000030a001","role":"authenticated"}',true);
CREATE TEMP TABLE pr1_cazuri(nume text PRIMARY KEY, date jsonb, acoperita boolean, parcela uuid);
-- The exact VALUES below are read also by pvUtilizatori.test.js (independent expected values).
INSERT INTO pr1_cazuri(nume,date,acoperita) VALUES
 ('proprietar_unic_semnat','[{"rol":"proprietar","stare":"semnat"}]'::jsonb,true),
 ('coproprietari_partial','[{"rol":"coproprietar","stare":"semnat"},{"rol":"coproprietar"}]'::jsonb,false),
 ('coproprietari_utilizator_semnat','[{"rol":"coproprietar","stare":"semnat"},{"rol":"coproprietar"},{"rol":"utilizator","stare":"semnat"}]'::jsonb,true),
 ('coproprietari_arendas_semnat','[{"rol":"coproprietar"},{"rol":"coproprietar"},{"rol":"arendas","stare":"semnat"}]'::jsonb,true),
 ('doar_utilizator_nesemnat','[{"rol":"utilizator","stare":"generat"}]'::jsonb,false),
 ('utilizator_trimis','[{"rol":"utilizator","stare":"trimis_spre_semnare"}]'::jsonb,false),
 ('utilizator_anulat','[{"rol":"utilizator","stare":"anulat"}]'::jsonb,false),
 ('utilizator_semnat','[{"rol":"utilizator","stare":"semnat"}]'::jsonb,true),
 ('arendas_semnat','[{"rol":"arendas","stare":"semnat"}]'::jsonb,true),
 ('proprietari_toti_utilizator_absent','[{"rol":"coproprietar","stare":"semnat"},{"rol":"coproprietar","stare":"semnat"},{"rol":"utilizator"}]'::jsonb,true),
 ('zero_detinatori','[]'::jsonb,false),
 ('proprietar_nesemnat','[{"rol":"proprietar"}]'::jsonb,false),
 ('utilizator_rol_schimbat_dupa_semnare','[{"rol":"utilizator","stare":"semnat","actual":"proprietar"},{"rol":"coproprietar"}]'::jsonb,true),
 ('proprietar_devenit_utilizator','[{"rol":"proprietar","stare":"semnat","actual":"utilizator"},{"rol":"coproprietar"}]'::jsonb,false),
 ('utilizator_semnat_sters_pv','[{"rol":"utilizator","stare":"semnat","sters_pv":true},{"rol":"proprietar"}]'::jsonb,false),
 ('proprietar_sters','[{"rol":"proprietar","sters":true}]'::jsonb,false);
CREATE TEMP TABLE pr1_det(caz text, spec jsonb, id uuid, parcela uuid, pv uuid);
DO $fixture$
DECLARE pr uuid; u uuid; p uuid; d uuid; r record; spec jsonb; n int:=0;
BEGIN
  INSERT INTO public.red_proiecte(cod,denumire) VALUES('TEST-PR1-PV','FICTIV PR1') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet) VALUES(pr,'FICTIV PR1','ZXP','FICTIV') RETURNING id INTO u;
  FOR r IN SELECT * FROM pr1_cazuri ORDER BY nume LOOP
    n:=n+1;
    INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson)
      VALUES(pr,u,'ZXP-'||lpad(n::text,4,'0'),1) RETURNING id INTO p;
    UPDATE pr1_cazuri SET parcela=p WHERE nume=r.nume;
    FOR spec IN SELECT * FROM jsonb_array_elements(r.date) LOOP
      INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate,sters_la,sters_motiv)
        VALUES(p,'FICTIV '||gen_random_uuid(),upper('FICTIV '||gen_random_uuid()),spec->>'rol',
          CASE WHEN (spec->>'sters')::boolean THEN now() END,CASE WHEN (spec->>'sters')::boolean THEN 'FICTIV' END) RETURNING id INTO d;
      INSERT INTO pr1_det VALUES(r.nume,spec,d,p,NULL);
    END LOOP;
  END LOOP;
END $fixture$;
GRANT SELECT,UPDATE ON pr1_cazuri,pr1_det TO authenticated;
SET LOCAL ROLE authenticated;
-- INSERT direct ca editor non-owner: inclusiv cu scan/data, numai generat este permis.
SAVEPOINT pr1_insert;
DO $insert_direct$
DECLARE r record; st text; refuz boolean; v public.red_procese_verbale;
BEGIN
  SELECT d.id,d.parcela,p.uat_id INTO STRICT r FROM pr1_det d JOIN public.red_parcele p ON p.id=d.parcela WHERE d.caz='utilizator_trimis';
  FOREACH st IN ARRAY ARRAY['semnat','trimis_spre_semnare','anulat',NULL]::text[] LOOP
    refuz:=false;
    BEGIN
      INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,nr_pv,data_pv,stare)
        VALUES('A',r.parcela,r.id,r.uat_id,'PVA-ZXP-9898','2026-11-05',st);
    EXCEPTION WHEN check_violation THEN refuz:=SQLERRM='PV: INSERT permis numai in starea generat'; END;
    IF NOT refuz THEN RAISE EXCEPTION 'DRY INSERT direct stare % permis',st; END IF;
  END LOOP;
  refuz:=false;
  BEGIN
    INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,nr_pv,data_pv,stare,fisier_semnat_path,semnat_primit_data)
      VALUES('A',r.parcela,r.id,r.uat_id,'PVA-ZXP-9898','2026-11-05','semnat','FICTIV/scan.pdf','2026-11-05');
  EXCEPTION WHEN check_violation THEN refuz:=SQLERRM='PV: INSERT permis numai in starea generat'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'DRY INSERT direct semnat cu scan/data permis'; END IF;
  INSERT INTO public.red_procese_verbale(tip,parcela_id,detinator_id,uat_id,nr_pv,data_pv,stare)
    VALUES('A',r.parcela,r.id,r.uat_id,'PVA-ZXP-9898','2026-11-05','generat') RETURNING * INTO v;
  IF v.calitate_semnatar IS DISTINCT FROM 'utilizator' THEN RAISE EXCEPTION 'DRY INSERT generat legitim'; END IF;
  UPDATE public.red_procese_verbale SET sters_la=now(),sters_motiv='FICTIV' WHERE id=v.id;
  refuz:=false;
  BEGIN
    UPDATE public.red_procese_verbale SET stare='semnat',semnat_primit_data='2026-11-05',fisier_semnat_path='FICTIV/scan.pdf' WHERE id=v.id;
  EXCEPTION WHEN check_violation THEN refuz:=SQLERRM='PV: un PV sters nu poate fi semnat'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'DRY semnare PV sters permisa'; END IF;
  UPDATE public.red_procese_verbale SET stare='anulat',motiv_anulare='FICTIV' WHERE id=v.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRY anulare PV sters legitima'; END IF;
END $insert_direct$;
ROLLBACK TO SAVEPOINT pr1_insert;
RELEASE SAVEPOINT pr1_insert;
-- Stergerea draftului ramane posibila dupa stergerea detinatorului SAU a parcelei.
SAVEPOINT pr1_soft_delete;
DO $soft_delete$
DECLARE r record; a public.red_procese_verbale;
BEGIN
  FOR r IN SELECT * FROM pr1_det WHERE caz IN ('utilizator_trimis','proprietar_nesemnat') LOOP
    a:=public.fn_red_pv_creeaza('A',r.parcela,r.id,NULL);
    IF r.caz='utilizator_trimis' THEN
      UPDATE public.red_detinatori SET sters_la=now(),sters_motiv='FICTIV' WHERE id=r.id;
    ELSE
      UPDATE public.red_parcele SET sters_la=now(),sters_motiv='FICTIV' WHERE id=r.parcela;
    END IF;
    UPDATE public.red_procese_verbale SET sters_la=now(),sters_motiv='FICTIV' WHERE id=a.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'DRY stergere draft cu sursa stearsa esuata %',r.caz; END IF;
  END LOOP;
END $soft_delete$;
ROLLBACK TO SAVEPOINT pr1_soft_delete;
RELEASE SAVEPOINT pr1_soft_delete;
DO $sign$
DECLARE r record; v public.red_procese_verbale;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'editor' THEN RAISE EXCEPTION 'DRY: identitate editor invalida'; END IF;
  FOR r IN SELECT * FROM pr1_det WHERE spec ? 'stare' LOOP
    v:=public.fn_red_pv_creeaza('A',r.parcela,r.id,NULL);
    IF v.calitate_semnatar IS DISTINCT FROM (r.spec->>'rol') THEN RAISE EXCEPTION 'DRY: calitate server creare'; END IF;
    UPDATE pr1_det SET pv=v.id WHERE id=r.id;
    IF r.spec->>'stare'='semnat' THEN
      UPDATE public.red_procese_verbale SET fisier_generat_path='FICTIV/'||v.id||'_v1.docx',calitate_document=r.spec->>'rol' WHERE id=v.id;
      UPDATE public.red_procese_verbale SET stare='semnat',semnat_primit_data='2026-11-05',fisier_semnat_path='FICTIV/scan.pdf' WHERE id=v.id;
    ELSIF r.spec->>'stare'='anulat' THEN
      UPDATE public.red_procese_verbale SET stare='anulat',motiv_anulare='FICTIV' WHERE id=v.id;
    ELSIF r.spec->>'stare'='trimis_spre_semnare' THEN
      UPDATE public.red_procese_verbale SET stare='trimis_spre_semnare',trimis_spre_semnare_data='2026-11-05' WHERE id=v.id;
    END IF;
  END LOOP;
  -- Protecția 20261129c ramane activa pentru editor: nu se sterge logic un PV semnat.
  SELECT * INTO STRICT r FROM pr1_det WHERE (spec->>'sters_pv')::boolean;
  BEGIN
    UPDATE public.red_procese_verbale SET sters_la=now(),sters_motiv='FICTIV' WHERE id=r.pv;
    RAISE EXCEPTION 'DRY stergere PV semnat de editor permisa';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'Un PV semnat sau anulat nu mai poate fi modificat (exceptie: data remedierii).' THEN RAISE; END IF;
  END;
END $sign$;
RESET ROLE;
-- Fixture istoric: construit DUPA semnare, numai ca postgres pe clona anulata.
-- 20261129c interzice stergerea unui PV semnat inclusiv pentru postgres. Dezactivam strict acel
-- trigger pentru acest singur fixture; il reactivam imediat, fara relaxarea regulii in migrare.
ALTER TABLE public.red_procese_verbale DISABLE TRIGGER red_pv_stare_tranzitie;
UPDATE public.red_procese_verbale v SET sters_la=now(),sters_motiv='FICTIV: istoric dupa semnare'
  FROM pr1_det d WHERE d.pv=v.id AND (d.spec->>'sters_pv')::boolean AND v.stare='semnat';
ALTER TABLE public.red_procese_verbale ENABLE TRIGGER red_pv_stare_tranzitie;
UPDATE public.red_detinatori d SET calitate=x.spec->>'actual' FROM pr1_det x WHERE d.id=x.id AND x.spec ? 'actual';
SET LOCAL ROLE authenticated;
DO $paritate$
DECLARE r record; v public.red_procese_verbale; refuz boolean;
BEGIN
  FOR r IN SELECT * FROM pr1_cazuri ORDER BY nume LOOP
    IF public.fn_red_parcela_acoperita_a(r.parcela) IS DISTINCT FROM r.acoperita THEN RAISE EXCEPTION 'DRY helper %',r.nume; END IF;
    IF (SELECT tip_pv FROM public.red_v_tronson WHERE parcela_id=r.parcela) IS DISTINCT FROM
      (CASE WHEN r.acoperita THEN 'A'::text ELSE NULL::text END) THEN RAISE EXCEPTION 'DRY view %',r.nume; END IF;
    refuz:=false;
    BEGIN
      v:=public.fn_red_pv_creeaza('B',r.parcela,NULL,NULL);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'redari: parcela acoperita prin PV A semnat; PV B nu este necesar' THEN RAISE; END IF;
      refuz:=true;
    END;
    IF refuz IS DISTINCT FROM r.acoperita THEN RAISE EXCEPTION 'DRY creare B %',r.nume; END IF;
    IF NOT r.acoperita AND r.nume<>'utilizator_trimis' THEN
      UPDATE public.red_procese_verbale SET stare='semnat',motiv_pv_b='neprezentat',semnat_primit_data='2026-11-05',fisier_semnat_path='FICTIV/b.pdf' WHERE id=v.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'DRY semnare legitima B %',r.nume; END IF;
    END IF;
    RAISE NOTICE 'PARITATE OK %',r.nume;
  END LOOP;
END $paritate$;
-- Snapshot freeze + anti-spoof, after holder's role changes.
DO $freeze$
DECLARE r record; refuz boolean:=false;
BEGIN
  SELECT * INTO STRICT r FROM pr1_det WHERE caz='utilizator_rol_schimbat_dupa_semnare' AND pv IS NOT NULL;
  IF (SELECT calitate_semnatar FROM public.red_procese_verbale WHERE id=r.pv) IS DISTINCT FROM 'utilizator' THEN RAISE EXCEPTION 'DRY freeze calitate'; END IF;
  BEGIN UPDATE public.red_procese_verbale SET calitate_semnatar='proprietar' WHERE id=r.pv;
  EXCEPTION WHEN check_violation THEN refuz:=SQLERRM='Calitatea semnatarului este inghetata'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'DRY freeze PATCH permis'; END IF;
  -- Legitimate exception: remediat_la remains editable on a signed PV.
  UPDATE public.red_procese_verbale SET remediat_la='2026-11-05' WHERE id=r.pv;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRY remediere legitima'; END IF;
END $freeze$;
-- Race regression: B generated before user signs, signing B afterward must fail; cancellation stays legal.
DO $late$
DECLARE p uuid; d uuid; a public.red_procese_verbale; b public.red_procese_verbale; refuz boolean:=false;
BEGIN
  SELECT parcela,id,pv INTO p,d,a.id FROM pr1_det WHERE caz='utilizator_trimis';
  SELECT * INTO STRICT b FROM public.red_procese_verbale WHERE parcela_id=p AND tip='B' AND stare='generat';
  UPDATE public.red_detinatori SET calitate='proprietar' WHERE id=d;
  UPDATE public.red_procese_verbale SET fisier_generat_path='FICTIV/regenerat.docx',calitate_document='proprietar' WHERE id=a.id;
  IF (SELECT calitate_semnatar FROM public.red_procese_verbale WHERE id=a.id) IS DISTINCT FROM 'proprietar' THEN
    RAISE EXCEPTION 'DRY snapshot regenerare nu urmeaza detinatorul'; END IF;
  UPDATE public.red_detinatori SET calitate='arendas' WHERE id=d;
  BEGIN
    UPDATE public.red_procese_verbale SET stare='semnat',semnat_primit_data='2026-11-05',fisier_semnat_path='FICTIV/scan-proprietar-vechi.pdf' WHERE id=a.id;
  EXCEPTION WHEN check_violation THEN refuz:=SQLERRM='PV: calitatea s-a schimbat dupa generare - regenereaza documentul si semneaza noua versiune'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'DRY scan proprietar vechi semnat ca arendas'; END IF;
  IF (SELECT stare FROM public.red_procese_verbale WHERE id=a.id) IS DISTINCT FROM 'trimis_spre_semnare' THEN
    RAISE EXCEPTION 'DRY refuz semnare nu a pastrat starea'; END IF;
  refuz:=false;
  BEGIN
    UPDATE public.red_procese_verbale SET calitate_document='arendas' WHERE id=a.id;
  EXCEPTION WHEN check_violation THEN refuz:=SQLERRM='PV: calitatea documentului se scrie numai la generare'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'DRY calitate document modificata fara regenerare'; END IF;
  refuz:=false;
  BEGIN
    UPDATE public.red_procese_verbale SET fisier_generat_path='FICTIV/sursa-veche.docx',calitate_document='proprietar' WHERE id=a.id;
  EXCEPTION WHEN check_violation THEN refuz:=SQLERRM='PV: calitatea s-a schimbat in timpul generarii - regenereaza documentul'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'DRY rol citit vechi acceptat la legarea DOCX'; END IF;
  UPDATE public.red_procese_verbale SET fisier_generat_path='FICTIV/arendas-v2.docx',calitate_document='arendas' WHERE id=a.id;
  UPDATE public.red_procese_verbale SET stare='semnat',semnat_primit_data='2026-11-05',fisier_semnat_path='FICTIV/a-late.pdf' WHERE id=a.id;
  IF (SELECT calitate_semnatar FROM public.red_procese_verbale WHERE id=a.id) IS DISTINCT FROM 'arendas' THEN
    RAISE EXCEPTION 'DRY calitate recitita la semnare'; END IF;
  refuz:=false;
  IF (SELECT calitate_document IS NOT DISTINCT FROM calitate_semnatar FROM public.red_procese_verbale WHERE id=a.id) IS NOT TRUE THEN RAISE EXCEPTION 'DRY concordanta document snapshot'; END IF;
  BEGIN
    UPDATE public.red_procese_verbale SET stare='semnat',motiv_pv_b='neprezentat',semnat_primit_data='2026-11-05',fisier_semnat_path='FICTIV/b-late.pdf' WHERE id=b.id;
  EXCEPTION WHEN check_violation THEN refuz:=SQLERRM='PV B refuzat: parcela acoperita prin PV A semnat; anuleaza PV B'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'DRY semnare B dupa utilizator A permisa'; END IF;
  UPDATE public.red_procese_verbale SET stare='anulat',motiv_anulare='FICTIV: acoperita A' WHERE id=b.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRY anulare legitima B'; END IF;
  refuz:=false;
  -- Assertion for direct INSERT bypass on an already covered parcel.
  SELECT parcela INTO p FROM pr1_cazuri WHERE nume='coproprietari_utilizator_semnat';
  BEGIN
    INSERT INTO public.red_procese_verbale(tip,parcela_id,uat_id,nr_pv,data_pv,stare)
      SELECT 'B',p,uat_id,'FICTIV-DIRECT-B','2026-11-05','generat' FROM public.red_parcele WHERE id=p;
  EXCEPTION WHEN check_violation THEN refuz:=SQLERRM='PV B refuzat: parcela acoperita prin PV A semnat; anuleaza PV B'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'DRY INSERT B direct permis'; END IF;
END $late$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000030a002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $denied$
DECLARE p uuid; refuz boolean:=false;
BEGIN
  SELECT parcela INTO p FROM pr1_cazuri LIMIT 1;
  BEGIN PERFORM public.fn_red_pv_creeaza('B',p,NULL,NULL);
  EXCEPTION WHEN insufficient_privilege THEN refuz:=SQLERRM='redari: creare PV doar admin/editor'; END;
  IF NOT refuz THEN RAISE EXCEPTION 'DRY acces non-owner fara modul permis'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_v_tronson WHERE parcela_id=p) THEN RAISE EXCEPTION 'DRY RLS view'; END IF;
END $denied$;
RESET ROLE;
ROLLBACK;
