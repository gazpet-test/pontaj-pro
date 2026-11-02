-- Version 20261129120600. Runner MUST supply one transaction (apply + post).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129g_redari_tronson_optional:'||txid_current() THEN RAISE EXCEPTION '20261129g: garda start invalida'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.red_parcele IN ACCESS EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.red_parcele) THEN RAISE EXCEPTION '20261129g: red_parcele trebuie sa fie gol'; END IF;
  IF to_regprocedure('public.fn_red_rezerva_numere_parcele(text,integer,integer)') IS NULL
    OR to_regprocedure('public.fn_red_rezerva_numere_parcele(text,integer)') IS NOT NULL
    OR to_regprocedure('public.fn_red_seteaza_tronson(uuid,uuid,integer,integer,integer)') IS NOT NULL THEN RAISE EXCEPTION '20261129g: semnaturi initiale invalide'; END IF;
  PERFORM set_config('gazpet.r29g_acl',(SELECT coalesce(proacl::text,'NULL') FROM pg_proc WHERE oid='public.fn_red_pv_c_creeaza(uuid,integer)'::regprocedure),true);
  PERFORM set_config('gazpet.r29g_policies',(SELECT md5(coalesce(string_agg(tablename||'|'||policyname||'|'||permissive||'|'||cmd||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''),E'\n' ORDER BY tablename,policyname),''))
    FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_parcele','red_procese_verbale')),true);
END $pre$;
ALTER TABLE public.red_parcele DROP CONSTRAINT red_parcele_id_parcela_check;
ALTER TABLE public.red_parcele ADD CONSTRAINT red_parcele_id_parcela_check CHECK (id_parcela ~ '^[A-Z]{3}-[0-9]{4}$');
ALTER TABLE public.red_parcele ALTER COLUMN tronson DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.fn_red_legaturi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uat uuid; v_parcela uuid; v_uat3 text;
BEGIN
  -- coloanele de legătură sunt imutabile după insert, pentru toată lumea (și postgres)
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) ->> 'proiect_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'proiect_id')
       OR (to_jsonb(NEW) ->> 'uat_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'uat_id')
       OR (to_jsonb(NEW) ->> 'parcela_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'parcela_id')
       OR (to_jsonb(NEW) ->> 'detinator_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'detinator_id')
       OR (to_jsonb(NEW) ->> 'raspuns_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'raspuns_id')
       OR (to_jsonb(NEW) ->> 'seq') IS DISTINCT FROM (to_jsonb(OLD) ->> 'seq')
       OR (TG_TABLE_NAME = 'red_parcele' AND (to_jsonb(NEW) ->> 'id_parcela') IS DISTINCT FROM (to_jsonb(OLD) ->> 'id_parcela')) THEN
      RAISE EXCEPTION 'redari: coloanele de legatura (proiect_id / uat_id / parcela_id / detinator_id / raspuns_id / seq; id_parcela) sunt imutabile pe %', TG_TABLE_NAME USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'red_parcele' AND (to_jsonb(NEW) ->> 'tronson') IS DISTINCT FROM (to_jsonb(OLD) ->> 'tronson') THEN
      -- UPDATE already holds ROW EXCLUSIVE on red_parcele: PV C creation's SHARE waits.
      -- No PV row locks here; RPC order is PV table -> parcel table -> parcel rows.
      IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'redari: schimbarea tronsonului doar in READ COMMITTED' USING ERRCODE='25001';
      END IF;
      IF EXISTS (SELECT 1 FROM public.red_procese_verbale v JOIN public.red_uat u ON u.id=v.uat_id
        WHERE u.proiect_id=(to_jsonb(NEW) ->> 'proiect_id')::uuid AND v.tip='C' AND v.stare<>'anulat' AND v.sters_la IS NULL
          AND (v.tronson=(to_jsonb(OLD) ->> 'tronson')::int OR v.tronson=(to_jsonb(NEW) ->> 'tronson')::int)) THEN
        RAISE EXCEPTION 'redari: tronson protejat de PV C activ' USING ERRCODE='23514';
      END IF;
    END IF;
    -- uat3 intra in id_parcela: nu se mai schimba cat exista parcele pe UAT (numele ramane editabil); randul UAT e deja blocat FOR UPDATE de
    -- UPDATE-ul in curs, deci inserarile de parcele (FOR SHARE) asteapta, iar EXISTS-ul vede parcelele deja comise
    IF TG_TABLE_NAME = 'red_uat' AND (to_jsonb(NEW) ->> 'uat3') IS DISTINCT FROM (to_jsonb(OLD) ->> 'uat3') THEN
      -- sub REPEATABLE READ / SERIALIZABLE EXISTS-ul de mai jos n-ar vedea o parcela comisa dupa snapshot (lock-ul FOR SHARE al parcelei nu
      -- modifica randul UAT, deci nu da eroare de serializare) — schimbarea codului UAT se face doar in READ COMMITTED (asa ruleaza PostgREST)
      IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'redari: schimbarea codului UAT doar in tranzactii READ COMMITTED' USING ERRCODE = '25001';
      END IF;
      IF EXISTS (SELECT 1 FROM public.red_parcele p WHERE p.uat_id = (to_jsonb(OLD) ->> 'id')::uuid) THEN
        RAISE EXCEPTION 'redari: uat3 nu se poate schimba cat exista parcele pe UAT' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  CASE TG_TABLE_NAME
    WHEN 'red_uat', 'red_import_loturi' THEN
      IF NOT EXISTS (SELECT 1 FROM public.red_proiecte pr WHERE pr.id = (to_jsonb(NEW) ->> 'proiect_id')::uuid) THEN
        RAISE EXCEPTION 'redari: proiect inexistent' USING ERRCODE = '23503';
      END IF;
    WHEN 'red_parcele' THEN
      -- FOR SHARE pe randul UAT: o schimbare concurenta de uat3 (UPDATE = lock FOR UPDATE pe rand) asteapta parcela sau parcela asteapta
      -- schimbarea si re-citeste valoarea comisa; invers, trigger-ul de pe red_uat vede parcela comisa cand verifica EXISTS dupa lock
      SELECT u.uat3 INTO v_uat3 FROM public.red_uat u WHERE u.id = (to_jsonb(NEW) ->> 'uat_id')::uuid AND u.proiect_id = (to_jsonb(NEW) ->> 'proiect_id')::uuid FOR SHARE;
      IF v_uat3 IS NULL THEN RAISE EXCEPTION 'redari: UAT-ul nu apartine proiectului parcelei' USING ERRCODE = '23503'; END IF;
      -- id_parcela = {uat3}-{nnnn}, independent de tronson
      IF (to_jsonb(NEW) ->> 'id_parcela') !~ ('^' || v_uat3 || '-[0-9]{4}$') THEN
        RAISE EXCEPTION 'redari: id_parcela % nu corespunde UAT-ului %', to_jsonb(NEW) ->> 'id_parcela', v_uat3 USING ERRCODE = '23514';
      END IF;
    WHEN 'red_detinatori' THEN
      IF NOT EXISTS (SELECT 1 FROM public.red_parcele p WHERE p.id = (to_jsonb(NEW) ->> 'parcela_id')::uuid AND p.sters_la IS NULL) THEN
        RAISE EXCEPTION 'redari: parcela inexistenta sau stearsa' USING ERRCODE = '23503';
      END IF;
    WHEN 'red_detinatori_contact', 'red_detinatori_token', 'red_convocari', 'red_raspunsuri' THEN
      IF NOT EXISTS (SELECT 1 FROM public.red_detinatori d WHERE d.id = (to_jsonb(NEW) ->> 'detinator_id')::uuid) THEN
        RAISE EXCEPTION 'redari: detinator inexistent' USING ERRCODE = '23503';
      END IF;
    WHEN 'red_raspunsuri_meta' THEN
      IF NOT EXISTS (SELECT 1 FROM public.red_raspunsuri x WHERE x.id = (to_jsonb(NEW) ->> 'raspuns_id')::uuid) THEN
        RAISE EXCEPTION 'redari: raspuns inexistent' USING ERRCODE = '23503';
      END IF;
    WHEN 'red_procese_verbale' THEN
      v_uat := (to_jsonb(NEW) ->> 'uat_id')::uuid;
      v_parcela := (to_jsonb(NEW) ->> 'parcela_id')::uuid;
      IF to_jsonb(NEW) ->> 'tip' = 'A' THEN
        IF (to_jsonb(NEW) ->> 'detinator_id') IS NULL OR v_parcela IS NULL
           OR NOT EXISTS (SELECT 1 FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id
                           WHERE d.id = (to_jsonb(NEW) ->> 'detinator_id')::uuid AND d.parcela_id = v_parcela AND p.uat_id = v_uat) THEN
          RAISE EXCEPTION 'redari: PV tip A — detinatorul nu e pe parcela sau UAT-ul nu e al parcelei' USING ERRCODE = '23514';
        END IF;
      ELSIF to_jsonb(NEW) ->> 'tip' = 'B' THEN
        IF v_parcela IS NULL OR (to_jsonb(NEW) ->> 'detinator_id') IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.red_parcele p WHERE p.id = v_parcela AND p.uat_id = v_uat) THEN
          RAISE EXCEPTION 'redari: PV tip B — parcela lipseste, are detinator sau UAT-ul nu e al parcelei' USING ERRCODE = '23514';
        END IF;
      ELSE
        IF v_parcela IS NOT NULL OR (to_jsonb(NEW) ->> 'detinator_id') IS NOT NULL OR (to_jsonb(NEW) ->> 'tronson') IS NULL OR v_uat IS NULL
           OR NOT EXISTS (SELECT 1 FROM public.red_uat u WHERE u.id = v_uat) THEN
          RAISE EXCEPTION 'redari: PV tip C — fara parcela / detinator, cu tronson si UAT existent' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END $fn$;
DROP FUNCTION public.fn_red_rezerva_numere_parcele(text,integer,integer);
CREATE FUNCTION public.fn_red_rezerva_numere_parcele(p_uat3 text, p_n int) RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cheie text; v_baza int; v_ultim int;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de numerotare' USING ERRCODE='42501';
  END IF;
  IF p_uat3 IS NULL OR p_uat3 !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'redari: uat3 invalid (%)',p_uat3; END IF;
  IF p_n IS NULL OR p_n NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'redari: numar de parcele invalid (%)',p_n; END IF;
  v_cheie := 'P-' || p_uat3;
  -- Order: counter advisory -> counter row. Serialize reservations before reading max.
  PERFORM pg_advisory_xact_lock(hashtextextended('red_parcele_numere|'||v_cheie,0));
  SELECT coalesce(max(substring(p.id_parcela from '[0-9]{4}$')::int),0) INTO v_baza
    FROM public.red_parcele p WHERE p.id_parcela LIKE p_uat3 || '-%';
  INSERT INTO public.red_numere(cheie,ultimul) VALUES(v_cheie,v_baza+p_n)
    ON CONFLICT(cheie) DO UPDATE SET ultimul=greatest(red_numere.ultimul,v_baza)+p_n
    RETURNING ultimul INTO v_ultim;
  IF v_ultim>9999 THEN RAISE EXCEPTION 'redari: numerotarea parcelelor pe % depaseste 9999',v_cheie; END IF;
  RETURN v_ultim-p_n+1;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_rezerva_numere_parcele(text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_rezerva_numere_parcele(text,integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_red_rezerva_numere_parcele(text,integer) IS 'Rezerva 1..5000 numere pe cheia P-{uat3}; intoarce primul numar. Admin/editor.';
CREATE FUNCTION public.fn_red_seteaza_tronson(p_proiect_id uuid, p_uat_id uuid, p_hg_de_la integer, p_hg_pana_la integer, p_tronson integer)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE v_ids uuid[]; v_n integer;
BEGIN
  IF auth.uid() IS NULL OR public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'redari: atribuire tronson doar admin' USING ERRCODE='42501';
  END IF;
  IF p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 OR p_hg_de_la IS NULL OR p_hg_pana_la IS NULL
    OR p_hg_de_la<1 OR p_hg_pana_la<1 OR p_hg_de_la>p_hg_pana_la THEN
    RAISE EXCEPTION 'redari: tronson/interval HG invalid' USING ERRCODE='22023';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'redari: atribuire tronson doar in READ COMMITTED' USING ERRCODE='25001';
  END IF;
  -- Same order as PV C: PV table -> parcel table -> parcel rows ORDER BY id.
  -- PV lock serializes with creation/cancellation; parcel lock precedes eligibility checks.
  LOCK TABLE public.red_procese_verbale IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_parcele IN ROW EXCLUSIVE MODE;
  IF p_proiect_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.red_proiecte WHERE id=p_proiect_id)
    OR (p_uat_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.red_uat WHERE id=p_uat_id AND proiect_id=p_proiect_id)) THEN
    RAISE EXCEPTION 'redari: proiect/UAT incompatibil' USING ERRCODE='23503';
  END IF;
  SELECT coalesce(array_agg(q.id ORDER BY q.id),ARRAY[]::uuid[]) INTO v_ids FROM (
    SELECT p.id FROM public.red_parcele p JOIN public.red_uat u ON u.id=p.uat_id AND u.proiect_id=p.proiect_id
    WHERE u.proiect_id=p_proiect_id AND (p_uat_id IS NULL OR u.id=p_uat_id) AND p.sters_la IS NULL
      -- Numeric avoids int overflow for arbitrary text prefixes; integral bounds are unchanged.
      AND substring(p.poz_hg from '^[0-9]+')::numeric BETWEEN p_hg_de_la AND p_hg_pana_la
    ORDER BY p.id FOR UPDATE OF p
  ) q;
  IF EXISTS(SELECT 1 FROM public.red_procese_verbale v JOIN public.red_uat u ON u.id=v.uat_id
    WHERE u.proiect_id=p_proiect_id AND v.tip='C' AND v.stare<>'anulat' AND v.sters_la IS NULL
      AND (v.tronson=p_tronson OR EXISTS(SELECT 1 FROM public.red_parcele p WHERE p.id=ANY(v_ids) AND p.tronson=v.tronson))) THEN
    RAISE EXCEPTION 'redari: interval sau destinatie cu PV C activ' USING ERRCODE='P0001';
  END IF;
  UPDATE public.red_parcele SET tronson=p_tronson WHERE id=ANY(v_ids);
  GET DIAGNOSTICS v_n=ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_red_seteaza_tronson(uuid,uuid,integer,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_seteaza_tronson(uuid,uuid,integer,integer,integer) TO authenticated;
COMMENT ON FUNCTION public.fn_red_seteaza_tronson(uuid,uuid,integer,integer,integer) IS 'Admin: prefix numeric poz_hg, UAT optional, parcele active; PV C activ protejeaza sursa si destinatia.';
CREATE OR REPLACE FUNCTION public.fn_red_pv_c_creeaza(p_proiect_id uuid,p_tronson int)
RETURNS public.red_procese_verbale LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp SET lock_timeout = '5s' AS $fn$
DECLARE ancora uuid; lipsa bigint; r public.red_procese_verbale;
BEGIN
  -- Order: advisory project/tronson -> counter -> INSERT/FK locks. No child row locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('red_pv_c|'||p_proiect_id::text||'|'||p_tronson::text,0));
  IF auth.uid() IS NULL OR public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'redari: PV C doar admin' USING ERRCODE='42501'; END IF;
  IF p_proiect_id IS NULL OR p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 THEN RAISE EXCEPTION 'redari: proiect/tronson invalid' USING ERRCODE='22023'; END IF;
  -- Copilot f4d r1 P2-01: eligibilitatea (parcelele tronsonului + acoperirea A/B) ramane stabila pana la COMMIT.
  -- SHARE pe parcele blocheaza INSERT/UPDATE concurente pe parcele; SHARE ROW EXCLUSIVE pe PV blocheaza
  -- anularea/crearea concurenta de PV si serializeaza crearile PV C (actiune rara de admin; lock_timeout 5s).
  -- Ordine (Copilot f4d r3 P3): advisory -> red_procese_verbale -> red_parcele -> contor, aceeasi ca la semnare
  -- (unde UPDATE-ul detine deja PV), deci fara ciclu creare/semnare; fn_red_pv_creeaza: parcela (ROW SHARE) apoi PV.
  LOCK TABLE public.red_procese_verbale IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_parcele IN SHARE MODE;
  SELECT count(*) INTO lipsa FROM public.red_parcele p
    WHERE p.proiect_id=p_proiect_id AND p.sters_la IS NULL AND p.tronson IS NULL;
  IF lipsa>0 THEN RAISE EXCEPTION 'Proiectul are % parcele fara tronson atribuit; atribuie-l inainte de PV C',lipsa USING ERRCODE='P0001'; END IF;
  -- PV C is per tronson; uat_id is only the anchor required by the schema.
  SELECT u.id INTO ancora FROM public.red_parcele p JOIN public.red_uat u ON u.id=p.uat_id AND u.proiect_id=p.proiect_id
    WHERE p.proiect_id=p_proiect_id AND p.tronson=p_tronson AND p.sters_la IS NULL
    GROUP BY u.id,u.uat3 ORDER BY count(*) DESC,u.uat3 ASC LIMIT 1;
  IF ancora IS NULL THEN RAISE EXCEPTION 'Tronsonul nu are parcele active' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.red_procese_verbale v JOIN public.red_uat u ON u.id=v.uat_id
    WHERE u.proiect_id=p_proiect_id AND v.tronson=p_tronson AND v.tip='C' AND v.stare<>'anulat' AND v.sters_la IS NULL)
    THEN RAISE EXCEPTION 'Exista deja un PV C activ pe tronson in proiect' USING ERRCODE='P0001'; END IF;
  SELECT count(*) INTO lipsa FROM public.red_v_tronson WHERE proiect_id=p_proiect_id AND tronson=p_tronson AND tip_pv IS NULL;
  IF lipsa>0 THEN RAISE EXCEPTION 'Tronsonul are parcele fara PV A semnat sau PV B: %',lipsa USING ERRCODE='P0001'; END IF;
  INSERT INTO public.red_procese_verbale(tip,tronson,uat_id,nr_pv,data_pv,stare)
    VALUES('C',p_tronson,ancora,public.fn_red_numar_document('PVC',NULL,p_tronson),(now() AT TIME ZONE 'Europe/Bucharest')::date,'generat') RETURNING * INTO r;
  RETURN r;
END $fn$;
COMMENT ON COLUMN public.red_parcele.id_parcela IS 'Identitate imutabila {UAT3}-{nnnn}, cheia P-{uat3}, independenta de tronson.';
COMMENT ON COLUMN public.red_parcele.tronson IS '1..11 sau NULL (neatribuit); modificabil pana la PV C activ pe sursa/destinatie in proiect.';
COMMENT ON FUNCTION public.fn_red_legaturi() IS 'Coerenta si identitati imutabile; id_parcela={uat3}-{nnnn}; tronson modificabil fara PV C activ.';
COMMENT ON TABLE public.red_numere IS 'Ultimul numar alocat pe cheie: C, PVA-{uat3}, PVB-{uat3}, PVC-T{n}, P-{uat3} (parcele).';
DO $post$
DECLARE f regprocedure;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.red_parcele'::regclass AND attname='tronson' AND attnotnull)
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.red_parcele'::regclass AND conname='red_parcele_id_parcela_check' AND convalidated AND pg_get_constraintdef(oid) LIKE '%^[A-Z]{3}-[0-9]{4}$%')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.red_parcele'::regclass AND conname='red_parcele_tronson_check' AND convalidated)
    THEN RAISE EXCEPTION '20261129g: constrangeri incorecte'; END IF;
  IF position('tronson protejat de PV C activ' in pg_get_functiondef('public.fn_red_legaturi()'::regprocedure))=0
    OR position('''^'' || v_uat3' in pg_get_functiondef('public.fn_red_legaturi()'::regprocedure))=0
    OR position('fara tronson atribuit' in pg_get_functiondef('public.fn_red_pv_c_creeaza(uuid,integer)'::regprocedure))=0
    THEN RAISE EXCEPTION '20261129g: garzi lipsa'; END IF;
  IF to_regprocedure('public.fn_red_rezerva_numere_parcele(text,integer,integer)') IS NOT NULL THEN RAISE EXCEPTION '20261129g: semnatura veche exista'; END IF;
  FOREACH f IN ARRAY ARRAY['public.fn_red_rezerva_numere_parcele(text,integer)'::regprocedure,'public.fn_red_seteaza_tronson(uuid,uuid,integer,integer,integer)'::regprocedure] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=f AND prosecdef AND 'search_path=public, pg_temp'=ANY(proconfig))
      OR has_function_privilege('anon',f,'EXECUTE') OR NOT has_function_privilege('authenticated',f,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=f AND a.grantee=0 AND a.privilege_type='EXECUTE')
      THEN RAISE EXCEPTION '20261129g: functie/ACL incorect %',f; END IF;
  END LOOP;
  IF (SELECT coalesce(proacl::text,'NULL') FROM pg_proc WHERE oid='public.fn_red_pv_c_creeaza(uuid,integer)'::regprocedure) IS DISTINCT FROM current_setting('gazpet.r29g_acl',true) THEN RAISE EXCEPTION '20261129g: ACL C schimbat'; END IF;
  IF (SELECT md5(coalesce(string_agg(tablename||'|'||policyname||'|'||permissive||'|'||cmd||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''),E'\n' ORDER BY tablename,policyname),''))
    FROM pg_policies WHERE schemaname='public' AND tablename IN ('red_parcele','red_procese_verbale')) IS DISTINCT FROM current_setting('gazpet.r29g_policies',true) THEN RAISE EXCEPTION '20261129g: politici schimbate'; END IF;
END $post$;