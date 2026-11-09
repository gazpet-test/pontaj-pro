-- Runner supplies one transaction. No business data removed.
-- harness-armare: gazpet.revenire_20261129g REDARI_TRONSON_OPT_SCOASA
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261129g',true) IS DISTINCT FROM 'REDARI_TRONSON_OPT_SCOASA:'||txid_current() THEN RAISE EXCEPTION '20261129g: revenire neinarmata'; END IF;
  IF EXISTS(SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261129g%') THEN RAISE EXCEPTION '20261129g: armare persistenta'; END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_procese_verbale IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.red_parcele IN ACCESS EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.red_parcele WHERE id_parcela ~ '^[A-Z]{3}-[0-9]{4}$' OR tronson IS NULL) THEN
    RAISE EXCEPTION '20261129g: revenire refuzata, exista parcele in format nou sau fara tronson';
  END IF;
  IF to_regprocedure('public.fn_red_seteaza_tronson(uuid,uuid,integer,integer,integer)') IS NULL THEN RAISE EXCEPTION '20261129g: migrarea lipseste'; END IF;
END $pre$;
ALTER TABLE public.red_parcele DROP CONSTRAINT red_parcele_id_parcela_check;
ALTER TABLE public.red_parcele ADD CONSTRAINT red_parcele_id_parcela_check CHECK (id_parcela ~ '^T([1-9]|1[01])-[A-Z]{3}-[0-9]{4}$');
ALTER TABLE public.red_parcele ALTER COLUMN tronson SET NOT NULL;
DROP FUNCTION public.fn_red_seteaza_tronson(uuid,uuid,integer,integer,integer);
DROP FUNCTION public.fn_red_rezerva_numere_parcele(text,integer);
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
       OR (TG_TABLE_NAME = 'red_parcele' AND ((to_jsonb(NEW) ->> 'id_parcela') IS DISTINCT FROM (to_jsonb(OLD) ->> 'id_parcela')
                                             OR (to_jsonb(NEW) ->> 'tronson') IS DISTINCT FROM (to_jsonb(OLD) ->> 'tronson'))) THEN
      RAISE EXCEPTION 'redari: coloanele de legatura (proiect_id / uat_id / parcela_id / detinator_id / raspuns_id / seq; id_parcela / tronson) sunt imutabile pe %', TG_TABLE_NAME USING ERRCODE = '23514';
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
      -- id_parcela = T{tronson}-{uat3}-{nnnn}, coerent cu tronsonul si UAT-ul randului
      IF (to_jsonb(NEW) ->> 'id_parcela') !~ ('^T' || (to_jsonb(NEW) ->> 'tronson') || '-' || v_uat3 || '-[0-9]{4}$') THEN
        RAISE EXCEPTION 'redari: id_parcela % nu corespunde tronsonului % si UAT-ului %', to_jsonb(NEW) ->> 'id_parcela', to_jsonb(NEW) ->> 'tronson', v_uat3 USING ERRCODE = '23514';
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
COMMENT ON FUNCTION public.fn_red_legaturi() IS 'Redări: trigger BEFORE INSERT/UPDATE — coerența legăturilor (UAT → proiect, parcelă → UAT-ul proiectului cu id_parcela = T{tronson}-{uat3}-nnnn, deținător → parcelă activă, contact/token/convocări/răspunsuri → deținător, PV A/B/C coerent) și imutabilitatea coloanelor de legătură (seq, id_parcela, tronson incluse) după insert, pentru oricine.';
CREATE FUNCTION public.fn_red_rezerva_numere_parcele(p_uat3 text, p_tronson int, p_n int) RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_cheie text; v_baza int; v_ultim int;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de numerotare' USING ERRCODE = '42501';
  END IF;
  IF p_uat3 IS NULL OR p_uat3 !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'redari: uat3 invalid (%)', p_uat3; END IF;
  IF p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 THEN RAISE EXCEPTION 'redari: tronson invalid (%)', p_tronson; END IF;
  IF p_n IS NULL OR p_n NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'redari: numar de parcele invalid (%)', p_n; END IF;
  v_cheie := 'P-T' || p_tronson || '-' || p_uat3;
  -- baza = cel mai mare nnnn deja folosit pe (tronson, uat3) — un import anterior fără rezervare nu poate fi depășit
  SELECT coalesce(max(substring(p.id_parcela from '[0-9]{4}$')::int), 0) INTO v_baza
    FROM public.red_parcele p WHERE p.tronson = p_tronson AND p.id_parcela LIKE 'T' || p_tronson || '-' || p_uat3 || '-%';
  INSERT INTO public.red_numere (cheie, ultimul) VALUES (v_cheie, v_baza + p_n)
  ON CONFLICT (cheie) DO UPDATE SET ultimul = greatest(red_numere.ultimul, v_baza) + p_n
  RETURNING ultimul INTO v_ultim;
  IF v_ultim > 9999 THEN RAISE EXCEPTION 'redari: numerotarea parcelelor pe % depaseste 9999', v_cheie; END IF;
  RETURN v_ultim - p_n + 1;
END $fn$;
COMMENT ON FUNCTION public.fn_red_rezerva_numere_parcele(text, integer, integer) IS 'Redări: rezervă un bloc de p_n numere (1..5000) pentru id_parcela pe cheia P-T{tronson}-{uat3} și întoarce PRIMUL număr din bloc; id_parcela = T{tronson}-{uat3}-{nnnn}. Pornește de la max(nnnn) existent în red_parcele. Doar admin/editor; sigură la concurență (UPDATE sub lock de rând).';
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
REVOKE EXECUTE ON FUNCTION public.fn_red_rezerva_numere_parcele(text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_rezerva_numere_parcele(text,integer,integer) TO authenticated, service_role;
COMMENT ON COLUMN public.red_parcele.id_parcela IS NULL;
COMMENT ON COLUMN public.red_parcele.tronson IS NULL;
COMMENT ON TABLE public.red_numere IS 'Redari: ultimul numar alocat pe cheie (C, PVA-HUS, PVB-HUS, PVC-T3). Scris doar de fn_red_numar_document.';
DO $post$
BEGIN
  IF to_regprocedure('public.fn_red_seteaza_tronson(uuid,uuid,integer,integer,integer)') IS NOT NULL
    OR to_regprocedure('public.fn_red_rezerva_numere_parcele(text,integer)') IS NOT NULL
    OR to_regprocedure('public.fn_red_rezerva_numere_parcele(text,integer,integer)') IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.red_parcele'::regclass AND attname='tronson' AND attnotnull)
    THEN RAISE EXCEPTION '20261129g: revenire incompleta'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE version='20261129120600';
  END IF;
END $post$;