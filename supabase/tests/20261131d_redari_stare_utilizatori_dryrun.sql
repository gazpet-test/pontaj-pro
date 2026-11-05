-- NUMAI pe clona dispensabila cu schema/ACL PostgreSQL 16 si PR1 deja aplicat.
-- Nu este pentru Supabase/producție. Totul, inclusiv identitatile, se anuleaza.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('gazpet.livrare_migrare','20261131d_redari_stare_utilizatori:'||txid_current(),true);
\ir ../migrations/20261131d_redari_stare_utilizatori.sql
SELECT set_config('gazpet.livrare_migrare','20261131d_redari_stare_utilizatori_ROLLBACK:'||txid_current(),true);
\ir ../revenire/20261131d_redari_stare_utilizatori_ROLLBACK.sql
SELECT set_config('gazpet.livrare_migrare','20261131d_redari_stare_utilizatori:'||txid_current(),true);
\ir ../migrations/20261131d_redari_stare_utilizatori.sql
-- L15: mutanti pe lantul vedere -> adresa -> nivel -> auth.uid (2-3 niveluri).
-- Fiecare subtranzactie este anulata prin sentinela; se verifica motivul exact al refuzului.
DO $mutanti$
DECLARE sig text; def text; corp text; refuz boolean; mesaj text;
BEGIN
  FOREACH sig IN ARRAY ARRAY['public.fn_red_adresa_cunoscuta(uuid)','public.fn_red_nivel()','auth.uid()'] LOOP
    SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT def,corp FROM pg_proc p WHERE p.oid=to_regprocedure(sig);
    BEGIN
      EXECUTE replace(def,corp,corp||E'\n-- FICTIV MUTANT PR2\n');
      refuz:=false;
      BEGIN PERFORM pg_temp.pr2_verifica_baza();
      EXCEPTION WHEN raise_exception THEN
        mesaj:=CASE WHEN sig='auth.uid()' THEN 'PR2: callee auth in afara baseline: ' ELSE 'PR2: functie in afara baseline revizuit: ' END||sig;
        IF SQLERRM<>mesaj THEN RAISE; END IF;
        refuz:=true;
      END;
      IF NOT refuz THEN RAISE EXCEPTION 'DRY mutant corp acceptat %',sig; END IF;
      RAISE EXCEPTION 'FICTIV rollback mutant' USING ERRCODE='ZX002';
    EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL;
    END;
  END LOOP;
  BEGIN
    REVOKE EXECUTE ON FUNCTION public.fn_red_parcela_acoperita_a(uuid) FROM authenticated;
    refuz:=false;
    BEGIN PERFORM pg_temp.pr2_verifica_baza();
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'PR2: functie in afara baseline revizuit: public.fn_red_parcela_acoperita_a(uuid)' THEN RAISE; END IF;
      refuz:=true;
    END;
    IF NOT refuz THEN RAISE EXCEPTION 'DRY mutant ACL acceptat'; END IF;
    RAISE EXCEPTION 'FICTIV rollback mutant' USING ERRCODE='ZX002';
  EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.red_procese_verbale DISABLE TRIGGER red_pv_aa_calitate;
    refuz:=false;
    BEGIN PERFORM pg_temp.pr2_verifica_baza();
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'PR2: trigger: red_procese_verbale.red_pv_aa_calitate' THEN RAISE; END IF;
      refuz:=true;
    END;
    IF NOT refuz THEN RAISE EXCEPTION 'DRY mutant trigger acceptat'; END IF;
    RAISE EXCEPTION 'FICTIV rollback mutant' USING ERRCODE='ZX002';
  EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL;
  END;
  BEGIN
    CREATE POLICY pr2_fictiv_mutant ON public.red_detinatori FOR SELECT TO authenticated USING(true);
    refuz:=false;
    BEGIN PERFORM pg_temp.pr2_verifica_baza();
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'PR2: inventar politici' THEN RAISE; END IF;
      refuz:=true;
    END;
    IF NOT refuz THEN RAISE EXCEPTION 'DRY mutant politica acceptat'; END IF;
    RAISE EXCEPTION 'FICTIV rollback mutant' USING ERRCODE='ZX002';
  EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL;
  END;
  PERFORM pg_temp.pr2_verifica_baza(); -- calea legitima dupa toate restaurarile
END $mutanti$;
-- R2: dependente tranzitive de autorizare si vedere, fiecare mutatie anulata separat.
DO $mutanti_tranzitivi$
DECLARE t text; varianta text; refuz boolean; def text; mesaj text; politica text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','user_module_access'] LOOP
    FOREACH varianta IN ARRAY ARRAY['acl','rls','force','coloana','politica_noua','select_null'] LOOP
      BEGIN
        mesaj:='PR2: sursa autorizare RLS/owner/ACL: '||t;
        CASE varianta
          WHEN 'acl' THEN EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated',t);
          WHEN 'rls' THEN EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY',t);
          WHEN 'force' THEN EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
          WHEN 'coloana' THEN
            EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO pr2_fictiv_coloana',t,CASE t WHEN 'profiles' THEN 'is_owner' ELSE 'access_level' END);
            mesaj:='PR2: coloana sursa autorizare: '||t||'.'||CASE t WHEN 'profiles' THEN 'is_owner' ELSE 'access_level' END;
          WHEN 'politica_noua' THEN
            EXECUTE format('CREATE POLICY pr2_fictiv_mutant ON public.%I FOR SELECT TO authenticated USING (true)',t);
            mesaj:='PR2: inventar politici autorizare';
          WHEN 'select_null' THEN
            -- NULL qual este permisiv in PG, dar nu este baseline-ul revizuit (true explicit).
            politica:=CASE t WHEN 'profiles' THEN 'profiles_select_all_authenticated' ELSE 'user_module_access_select_authenticated' END;
            EXECUTE format('DROP POLICY %I ON public.%I',politica,t);
            EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated',politica,t);
            mesaj:='PR2: politica autorizare: '||t||'.'||politica;
        END CASE;
        refuz:=false;
        BEGIN PERFORM pg_temp.pr2_verifica_baza();
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM<>mesaj THEN RAISE; END IF;
          refuz:=true;
        END;
        IF NOT refuz THEN RAISE EXCEPTION 'DRY mutant tranzitiv acceptat %.%',t,varianta; END IF;
        RAISE EXCEPTION 'FICTIV rollback mutant tranzitiv' USING ERRCODE='ZX002';
      EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL;
      END;
    END LOOP;
  END LOOP;
  FOREACH varianta IN ARRAY ARRAY['definitie','security_invoker','acl'] LOOP
    BEGIN
      CASE varianta
        WHEN 'definitie' THEN
          SELECT pg_get_viewdef('public.red_v_tronson'::regclass,true) INTO def;
          EXECUTE 'CREATE OR REPLACE VIEW public.red_v_tronson WITH (security_invoker=on) AS SELECT * FROM ('||rtrim(def,E'; \n')||') v WHERE false';
        WHEN 'security_invoker' THEN ALTER VIEW public.red_v_tronson SET (security_invoker=off);
        WHEN 'acl' THEN REVOKE SELECT ON public.red_v_tronson FROM authenticated;
      END CASE;
      refuz:=false;
      BEGIN PERFORM pg_temp.pr2_verifica_baza();
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>'PR2: red_v_tronson definitie/coloane/owner/ACL/security_invoker' THEN RAISE; END IF;
        refuz:=true;
      END;
      IF NOT refuz THEN RAISE EXCEPTION 'DRY mutant tronson acceptat %',varianta; END IF;
      RAISE EXCEPTION 'FICTIV rollback mutant tronson' USING ERRCODE='ZX002';
    EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL;
    END;
  END LOOP;
  PERFORM pg_temp.pr2_verifica_baza(); -- restaurarea baseline-ului legitim este obligatorie
END $mutanti_tranzitivi$;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-00000031d001','pr2.editor@example.invalid'),
 ('00000000-0000-4000-8000-00000031d002','pr2.viewer@example.invalid'),
 ('00000000-0000-4000-8000-00000031d003','pr2.refuz@example.invalid');
-- on_auth_user_created -> handle_new_user creeaza deja profilurile (20260929c).
-- Nicio exceptie pentru owner: actualizam numai cele trei UUID-uri fictive si cerem toate trei randurile.
DO $profiluri$
DECLARE n int;
BEGIN
  UPDATE public.profiles p SET email=x.email,name=x.nume,role='manager_santier',is_owner=false
  FROM (VALUES
    ('00000000-0000-4000-8000-00000031d001'::uuid,'pr2.editor@example.invalid','FICTIV PR2 EDITOR'),
    ('00000000-0000-4000-8000-00000031d002'::uuid,'pr2.viewer@example.invalid','FICTIV PR2 VIEWER'),
    ('00000000-0000-4000-8000-00000031d003'::uuid,'pr2.refuz@example.invalid','FICTIV PR2 REFUZ')
  ) x(id,email,nume) WHERE p.id=x.id;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>3 OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN (
      '00000000-0000-4000-8000-00000031d001'::uuid,'00000000-0000-4000-8000-00000031d002'::uuid,'00000000-0000-4000-8000-00000031d003'::uuid)
      AND (is_owner IS DISTINCT FROM false OR role IS DISTINCT FROM 'manager_santier')) THEN
    RAISE EXCEPTION 'DRY: cele trei profiluri automate non-owner nu au fost pregatite';
  END IF;
END $profiluri$;
INSERT INTO public.user_module_access(profile_id,module,access_level) VALUES
 ('00000000-0000-4000-8000-00000031d001','redari','editor'),
 ('00000000-0000-4000-8000-00000031d002','redari','viewer');
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000031d001","role":"authenticated"}',true);
CREATE TEMP TABLE pr2_cazuri(nume text PRIMARY KEY,date jsonb,observat int,stare text,acoperita boolean,parcela uuid,uat uuid);
-- Acest tabel este citit si de stareUtilizatori.test.js, cu expected literal, independent de implementare.
INSERT INTO pr2_cazuri(nume,date,observat,stare,acoperita) VALUES
 ('utilizator_acopera','[{"rol":"coproprietar"},{"rol":"coproprietar"},{"rol":"utilizator","pv":"semnat"}]'::jsonb,0,'PV_A_ACOPERIT_PARCELA',true),
 ('arendas_acopera','[{"rol":"proprietar"},{"rol":"arendas","pv":"semnat"}]'::jsonb,0,'PV_A_ACOPERIT_PARCELA',true),
 ('semnatura_proprie','[{"rol":"proprietar"},{"rol":"utilizator","pv":"semnat"}]'::jsonb,1,'PV_A_SEMNAT',true),
 ('coproprietari_partial','[{"rol":"coproprietar","pv":"semnat"},{"rol":"coproprietar"}]'::jsonb,1,'FARA_ADRESA_AFISARE',false),
 ('proprietari_toti_utilizator_absent','[{"rol":"coproprietar","pv":"semnat"},{"rol":"coproprietar","pv":"semnat"},{"rol":"utilizator"}]'::jsonb,2,'PV_A_ACOPERIT_PARCELA',true),
 ('utilizator_generat','[{"rol":"proprietar"},{"rol":"utilizator","pv":"generat"}]'::jsonb,0,'FARA_ADRESA_AFISARE',false),
 ('utilizator_trimis','[{"rol":"proprietar"},{"rol":"utilizator","pv":"trimis_spre_semnare"}]'::jsonb,0,'FARA_ADRESA_AFISARE',false),
 ('utilizator_anulat','[{"rol":"proprietar"},{"rol":"utilizator","pv":"anulat"}]'::jsonb,0,'FARA_ADRESA_AFISARE',false),
 ('raspuns_nu_semnatura','[{"rol":"proprietar","raspuns":"particip"},{"rol":"utilizator","raspuns":"nu_particip_fara_obiectii"}]'::jsonb,0,'A_RASPUNS_PARTICIPA',false),
 ('utilizator_rol_schimbat','[{"rol":"coproprietar"},{"rol":"utilizator","pv":"semnat","actual":"proprietar"}]'::jsonb,0,'PV_A_ACOPERIT_PARCELA',true),
 ('proprietar_devenit_utilizator','[{"rol":"coproprietar"},{"rol":"proprietar","pv":"semnat","actual":"utilizator"}]'::jsonb,0,'FARA_ADRESA_AFISARE',false),
 ('detinator_semnatar_sters','[{"rol":"coproprietar"},{"rol":"utilizator","pv":"semnat","sters":true}]'::jsonb,0,'PV_A_ACOPERIT_PARCELA',true),
 ('doar_utilizator_fara_semnatura','[{"rol":"utilizator"}]'::jsonb,0,'FARA_ADRESA_AFISARE',false),
 ('proprietar_unic_semnat','[{"rol":"proprietar","pv":"semnat"}]'::jsonb,0,'PV_A_SEMNAT',true),
 ('pv_b','[{"rol":"proprietar"},{"rol":"utilizator"}]'::jsonb,0,'PV_B_CONSTATARE',false),
 ('pv_b_anulat','[{"rol":"proprietar"},{"rol":"utilizator"}]'::jsonb,0,'FARA_ADRESA_AFISARE',false),
 ('contact_absent_null','[{"rol":"proprietar","adresa_cunoscuta":null}]'::jsonb,0,'FARA_ADRESA_AFISARE',false),
 ('acoperire_peste_b_vechi','[{"rol":"proprietar"},{"rol":"utilizator","pv":"semnat"}]'::jsonb,0,'PV_A_ACOPERIT_PARCELA',true);
CREATE TEMP TABLE pr2_det(caz text,i int,spec jsonb,id uuid,parcela uuid,pv uuid);
DO $fixture$
DECLARE pr uuid;u uuid;p uuid;d uuid;r record;s jsonb;i int;n int:=0;
BEGIN
  INSERT INTO public.red_proiecte(cod,denumire) VALUES('TEST-PR2-STARE','FICTIV PR2') RETURNING id INTO pr;
  INSERT INTO public.red_uat(proiect_id,nume,uat3,judet,sesiune_zi1) VALUES(pr,'FICTIV PR2','ZXS','FICTIV','2026-11-20') RETURNING id INTO u;
  FOR r IN SELECT * FROM pr2_cazuri ORDER BY nume LOOP
    n:=n+1;
    INSERT INTO public.red_parcele(proiect_id,uat_id,id_parcela,tronson) VALUES(pr,u,'ZXS-'||lpad(n::text,4,'0'),1) RETURNING id INTO p;
    UPDATE pr2_cazuri SET parcela=p,uat=u WHERE nume=r.nume;
    i:=0;
    FOR s IN SELECT * FROM jsonb_array_elements(r.date) LOOP
      INSERT INTO public.red_detinatori(parcela_id,nume,nume_normalizat,calitate)
        VALUES(p,'FICTIV PR2 '||i,upper('FICTIV PR2 '||i),s->>'rol') RETURNING id INTO d;
      INSERT INTO pr2_det VALUES(r.nume,i,s,d,p,NULL);
      i:=i+1;
    END LOOP;
  END LOOP;
END $fixture$;
GRANT SELECT,UPDATE ON pr2_cazuri,pr2_det TO authenticated;
SET LOCAL ROLE authenticated;
DO $semnaturi$
DECLARE r record;v public.red_procese_verbale;b public.red_procese_verbale;
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'editor' THEN RAISE EXCEPTION 'DRY editor non-owner'; END IF;
  -- B vechi, apoi A al utilizatorului: starea A trebuie sa aiba prioritate.
  SELECT * INTO STRICT r FROM pr2_cazuri WHERE nume='acoperire_peste_b_vechi';
  b:=public.fn_red_pv_creeaza('B',r.parcela,NULL,NULL);
  FOR r IN SELECT * FROM pr2_det LOOP
    IF r.spec ? 'pv' THEN
      v:=public.fn_red_pv_creeaza('A',r.parcela,r.id,NULL);
      UPDATE pr2_det SET pv=v.id WHERE id=r.id;
      IF r.spec->>'pv'='semnat' THEN
        UPDATE public.red_procese_verbale SET fisier_generat_path='TEST-PR2-STARE/ZXS/pv/'||v.nr_pv||'_v1_'||(r.spec->>'rol')||'.docx',calitate_document=r.spec->>'rol' WHERE id=v.id;
        UPDATE public.red_procese_verbale SET stare='semnat',fisier_semnat_path='FICTIV/scan.pdf',semnat_primit_data='2026-11-05' WHERE id=v.id;
      ELSIF r.spec->>'pv'='anulat' THEN
        UPDATE public.red_procese_verbale SET stare='anulat',motiv_anulare='FICTIV' WHERE id=v.id;
      ELSIF r.spec->>'pv'='trimis_spre_semnare' THEN
        UPDATE public.red_procese_verbale SET stare='trimis_spre_semnare',trimis_spre_semnare_data='2026-11-05' WHERE id=v.id;
      END IF;
    END IF;
    IF r.spec ? 'raspuns' THEN
      INSERT INTO public.red_raspunsuri(detinator_id,canal,data,optiune,zi_sesiune_aleasa,declaratie_confirmata)
        VALUES(r.id,'telefon','2026-11-05T10:00:00Z',r.spec->>'raspuns',CASE WHEN r.spec->>'raspuns'='particip' THEN '2026-11-20'::date END,
          CASE WHEN r.spec->>'raspuns'='nu_particip_fara_obiectii' THEN true END);
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM pr2_cazuri WHERE nume IN ('pv_b','pv_b_anulat') LOOP
    b:=public.fn_red_pv_creeaza('B',r.parcela,NULL,NULL);
    IF r.nume='pv_b_anulat' THEN
      UPDATE public.red_procese_verbale SET stare='anulat',motiv_anulare='FICTIV' WHERE id=b.id;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM pr2_det WHERE spec ? 'actual' LOOP
    UPDATE public.red_detinatori SET calitate=r.spec->>'actual' WHERE id=r.id;
  END LOOP;
  FOR r IN SELECT * FROM pr2_det WHERE (spec->>'sters')::boolean LOOP
    UPDATE public.red_detinatori SET sters_la=now(),sters_motiv='FICTIV' WHERE id=r.id;
  END LOOP;
END $semnaturi$;
DO $paritate$
DECLARE r record;v text;n int;
BEGIN
  FOR r IN SELECT c.*,d.id FROM pr2_cazuri c JOIN pr2_det d ON d.caz=c.nume AND d.i=c.observat LOOP
    SELECT stare INTO STRICT v FROM public.red_v_stare_parcela WHERE parcela_id=r.parcela AND detinator_id=r.id;
    IF r.nume='contact_absent_null' AND (EXISTS (SELECT 1 FROM public.red_detinatori_contact WHERE detinator_id=r.id)
        OR (SELECT adresa_cunoscuta FROM public.red_v_stare_parcela WHERE parcela_id=r.parcela AND detinator_id=r.id) IS NOT NULL) THEN
      RAISE EXCEPTION 'DRY: cazul null trebuie sa aiba contact absent si adresa SQL NULL'; END IF;
    IF v IS DISTINCT FROM r.stare THEN RAISE EXCEPTION 'DRY stare %: % asteptat %',r.nume,v,r.stare; END IF;
    IF public.fn_red_parcela_acoperita_a(r.parcela) IS DISTINCT FROM r.acoperita THEN RAISE EXCEPTION 'DRY acoperire %',r.nume; END IF;
    IF r.acoperita AND EXISTS (SELECT 1 FROM public.red_v_stare_parcela WHERE parcela_id=r.parcela AND stare NOT IN ('PV_A_SEMNAT','PV_A_ACOPERIT_PARCELA')) THEN
      RAISE EXCEPTION 'DRY parcela acoperita mai contine destinatari neinchisi %',r.nume; END IF;
  END LOOP;
  SELECT sum(numar) INTO n FROM public.red_v_centralizator_uat WHERE uat_id=(SELECT uat FROM pr2_cazuri LIMIT 1);
  IF n IS DISTINCT FROM 18 THEN RAISE EXCEPTION 'DRY Q5: 18 parcele numarate o data, gasit %',n; END IF;
  -- 8 parcele A acoperite + 1 B = 9/18 => 50.0%; coproprietar partial nu e inchis.
  IF EXISTS (SELECT 1 FROM public.red_v_centralizator_uat WHERE uat_id=(SELECT uat FROM pr2_cazuri LIMIT 1)
      AND (total_uat<>18 OR procent_inchise<>50.0)) THEN RAISE EXCEPTION 'DRY Q5 procent'; END IF;
END $paritate$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000031d002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $viewer$
BEGIN
  IF public.fn_red_nivel() IS DISTINCT FROM 'viewer' THEN RAISE EXCEPTION 'DRY viewer'; END IF;
  IF (SELECT count(*) FROM public.red_v_stare_parcela WHERE parcela_id IN (SELECT parcela FROM pr2_cazuri))<>34 THEN RAISE EXCEPTION 'DRY viewer randuri'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_v_stare_parcela WHERE parcela_id IN (SELECT parcela FROM pr2_cazuri) AND adresa_cunoscuta IS NOT NULL) THEN
    RAISE EXCEPTION 'DRY viewer vede contact'; END IF;
  IF (SELECT sum(numar) FROM public.red_v_centralizator_uat WHERE uat_id=(SELECT uat FROM pr2_cazuri LIMIT 1))<>18 THEN
    RAISE EXCEPTION 'DRY viewer Q5'; END IF;
END $viewer$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-00000031d003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $refuz$
BEGIN
  IF EXISTS (SELECT 1 FROM public.red_v_stare_parcela WHERE parcela_id IN (SELECT parcela FROM pr2_cazuri))
    OR EXISTS (SELECT 1 FROM public.red_v_centralizator_uat WHERE uat_id=(SELECT uat FROM pr2_cazuri LIMIT 1)) THEN
    RAISE EXCEPTION 'DRY non-owner fara acces vede date'; END IF;
END $refuz$;
RESET ROLE;
-- Revenirea este doar o proiectie: trebuie sa pastreze inclusiv datele/istoricul nou create.
CREATE TEMP TABLE pr2_istoric AS SELECT count(*) AS n FROM public.red_jurnal;
SELECT set_config('gazpet.livrare_migrare','20261131d_redari_stare_utilizatori_ROLLBACK:'||txid_current(),true);
\ir ../revenire/20261131d_redari_stare_utilizatori_ROLLBACK.sql
DO $istoric$
BEGIN
  IF (SELECT count(*) FROM public.red_jurnal)<>(SELECT n FROM pr2_istoric) THEN RAISE EXCEPTION 'DRY revenire a modificat istoricul'; END IF;
  IF (SELECT count(*) FROM public.red_parcele WHERE id IN (SELECT parcela FROM pr2_cazuri))<>18 THEN RAISE EXCEPTION 'DRY revenire a modificat datele'; END IF;
END $istoric$;
SELECT set_config('gazpet.livrare_migrare','20261131d_redari_stare_utilizatori:'||txid_current(),true);
\ir ../migrations/20261131d_redari_stare_utilizatori.sql
ROLLBACK;
