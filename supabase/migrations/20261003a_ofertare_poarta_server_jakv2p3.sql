-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261003a — J07 / P3: poarta pe server a propunerii tehnice (12 controale + agregator), impusă la aprobarea / depunerea
-- pachetului și la licitația „depusă”. Controalele J07 nu au derogare. R5/R12/J02/J02b/J05 rămân în funcțiile existente:
-- J07 se INSEREAZĂ chirurgical (bloc „-- J07 BEGIN/END” înaintea singurului „RETURN NEW;”), corpurile istorice nu se rescriu.
-- Nicio modificare de date la instalare. Reaplicabilă. Rollback-ul păstrează istoricul.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT, DUPĂ J04 (20260930a).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003a_ofertare_poarta_server_jakv2p3:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;

-- Precondiții pinuite pe starea LIVE citită read-only pe 06.10.2026 (după J02b 20261004a și J05 20261001a): funcțiile în care
-- J07 se inserează trebuie să fie EXACT cele de azi (md5(prosrc)) sau deja patch-uite de J07 (reaplicare); J04 întâi.
DO $pre$
DECLARE r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- ordinea de livrare (decizia A, 29.09): J04 ACTIV înaintea lui J07 (Copilot conv. 3, NO-GO r1: tabelul de dovezi singur nu
  -- ajunge — revenirea J04 îl păstrează). Cerem semnătura pe care o verifică și postcondiția J04: cele 5 triggere active și
  -- fn_pt_pachet_depus_verifica cu dovezile J04 + C2, SECDEF, search_path fix.
  IF to_regclass('public.ofertare_pt_pachet_verificari') IS NULL
     OR (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND (t.tgrelid, t.tgname) IN (
           ('public.ofertare_pt_pachet_fisiere'::regclass, 'trg_pt_fisier_insert_stare'),
           ('public.ofertare_pt_pachet_fisiere'::regclass, 'trg_pt_fisier_imuabil'),
           ('public.ofertare_pt_pachet_fisiere'::regclass, 'trg_pt_fisier_path_obligatoriu'),
           ('public.ofertare_pt_pachet'::regclass, 'trg_pt_pachet_delete_garda'),
           ('public.ofertare_pt_pachet_verificari'::regclass, 'trg_pt_verificari_imuabile'))) <> 5
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.fn_pt_pachet_depus_verifica()'::regprocedure AND p.prosecdef
                      AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp'
                      AND position('ofertare_pt_pachet_verificari' in p.prosrc) > 0
                      AND position('ORDER BY u.id DESC LIMIT 1' in p.prosrc) > 0) THEN
    RAISE EXCEPTION 'Precondiție 0b: J04 (20260930a, cu C1–C3) trebuie să fie ACTIV înaintea lui J07 (triggere + funcția de depunere J04)';
  END IF;
  FOR r IN SELECT p.proname, md5(p.prosrc) AS h, position('-- J07 BEGIN' in p.prosrc) > 0 AS patchuit, p.prosecdef,
                  array_to_string(p.proconfig, ',') AS cfg, (SELECT string_agg(a::text, ' ' ORDER BY a::text) FROM unnest(p.proacl) a) AS acl
             FROM pg_proc p WHERE p.oid IN ('public.fn_gate_depunere()'::regprocedure, 'public.fn_ofertare_pt_pachet_poarta_documentatie()'::regprocedure) LOOP
    IF NOT (r.patchuit OR r.h = CASE r.proname WHEN 'fn_gate_depunere' THEN '04102c5e44af4f5fc2062c1a58737bdd'
                                               ELSE '68620a64bc87b3d9cbb80df629df8e93' END)
       OR r.prosecdef IS NOT TRUE OR r.cfg IS DISTINCT FROM 'search_path=public, pg_temp'
       OR r.acl IS DISTINCT FROM 'postgres=X/postgres service_role=X/postgres' THEN
      RAISE EXCEPTION 'Precondiție 0c: % diferă de starea live din 06.10 (md5 %, acl %) — recitește înainte de livrare', r.proname, r.h, r.acl;
    END IF;
  END LOOP;
  IF to_regprocedure('public.ofertare_r5_blocaj_sursa(bigint)') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ofertare_r5_blocaj_sursa' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Precondiție 0d: R5 (ofertare_r5_blocaj_sursa) lipsește';
  END IF;
END
$pre$;

CREATE TABLE IF NOT EXISTS public.ofertare_poarta_rezultate_text (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  control_code text NOT NULL CHECK (control_code IN ('garantie','anexe','numere','pachet')),
  licitatie_id bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  parser_version text NOT NULL CHECK (btrim(parser_version) <> ''),
  sursa_hash text NOT NULL CHECK (sursa_hash ~ '^[0-9a-f]{64}$'),
  stare text NOT NULL CHECK (stare IN ('ok','block','undetermined')),
  detalii jsonb NOT NULL CHECK (jsonb_typeof(detalii) = 'object'),
  calculat_la timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ofertare_poarta_text_lookup ON public.ofertare_poarta_rezultate_text
  (licitatie_id, control_code, parser_version, sursa_hash, id DESC);
ALTER TABLE public.ofertare_poarta_rezultate_text ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_poarta_rezultate_text FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ofertare_poarta_rezultate_text_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ofertare_poarta_rezultate_text TO authenticated;
GRANT SELECT, INSERT ON public.ofertare_poarta_rezultate_text TO service_role;
GRANT USAGE ON SEQUENCE public.ofertare_poarta_rezultate_text_id_seq TO service_role;
DO $pol$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.ofertare_poarta_rezultate_text'::regclass AND polname='poarta_text_select') THEN
    CREATE POLICY poarta_text_select ON public.ofertare_poarta_rezultate_text FOR SELECT TO authenticated
      USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
  END IF;
END $pol$;
CREATE OR REPLACE FUNCTION public.fn_ofertare_poarta_text_imuabil() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $fn$
BEGIN RAISE EXCEPTION 'Rezultatele porții text sunt append-only' USING ERRCODE='42501'; END $fn$;
CREATE OR REPLACE TRIGGER trg_poarta_text_imuabil BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public.ofertare_poarta_rezultate_text FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ofertare_poarta_text_imuabil();

CREATE OR REPLACE FUNCTION public.ofertare_poarta_parser_version() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $$ SELECT 'j07-text-v1'::text $$;

CREATE OR REPLACE FUNCTION public.ofertare_poarta_rezultat(c text, s text, d text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO 'public','pg_temp' AS $$
  SELECT jsonb_build_object('control_code',c,'stare',s,'detalii',d)
$$;

-- Snapshot unic pentru Edge: datele și hash-ul vin din aceeași instrucțiune/snapshot PG.
-- Parsarea de bază a textului rămâne cea a view-ului folosit de UI (regexurile deja aplicate).
-- Include TOATE capitolele și TOATE versiunile graficului, nu doar rândul cu id maxim.
-- Starea aprobat/depus nu schimbă conținutul controlului H9: se normalizează la „asamblat”.
CREATE OR REPLACE FUNCTION public.ofertare_poarta_text_sursa(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' SET timezone TO 'UTC' AS $fn$
DECLARE st jsonb; date_control jsonb; sursa jsonb;
BEGIN
  SELECT to_jsonb(v) INTO st FROM public.v_ofertare_pt_stare v WHERE v.licitatie_id=p_licitatie_id;
  IF st IS NULL THEN RAISE EXCEPTION 'Licitație / control indisponibil' USING ERRCODE='P0001'; END IF;
  SELECT jsonb_object_agg(key, CASE WHEN jsonb_typeof(value)='array' THEN
      (SELECT coalesce(jsonb_agg(e ORDER BY e::text),'[]'::jsonb) FROM jsonb_array_elements(value) e)
      ELSE value END) INTO date_control
  FROM jsonb_each(st) WHERE key = ANY(ARRAY[
    'garantie_cerut_luni','garantie_cerut_moment','garantie_oferit_luni','garantie_oferit_moment',
    'garantie_confirmata','garantie_justificata','garantie_luni_in_capitole','garantie_cerinte_lucrari',
    'anexe_referite','anexe_existente','fraze_anexe','capitole_ref',
    'bransamente_in_capitole','bransamente_in_cerinte',
    'anexe_asteptate','anexe_declarate','anexe_responsabili','pachet_fisiere']);
  date_control := date_control || jsonb_build_object('pachet_stare',
    CASE WHEN st->>'pachet_stare' IS NOT NULL THEN 'asamblat' ELSE NULL END);
  sursa := jsonb_build_object('date',date_control,
    'capitole',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.id),'[]'::jsonb)
      FROM public.ofertare_pt_capitole k WHERE k.licitatie_id=p_licitatie_id),
    'grafice',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.versiune),'[]'::jsonb)
      FROM public.grafic_versiuni g WHERE g.licitatie_id=p_licitatie_id),
    'cerinte',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'text',c.text_cerinta,
      'inlocuita_de',c.inlocuita_de,'duplicat_al',c.duplicat_al) ORDER BY c.id),'[]'::jsonb)
      FROM public.ofertare_cerinte c WHERE c.licitatie_id=p_licitatie_id),
    'pachet_id',(SELECT p.id FROM public.ofertare_pt_pachet p WHERE p.licitatie_id=p_licitatie_id ORDER BY p.versiune DESC LIMIT 1));
  RETURN jsonb_build_object('date',date_control,'parser_version',public.ofertare_poarta_parser_version(),
    'sursa_hash',encode(sha256(convert_to(sursa::text,'UTF8')),'hex'));
END $fn$;

CREATE OR REPLACE FUNCTION public.ofertare_ctl_text(p_licitatie_id bigint, p_control text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $fn$
DECLARE src jsonb; r public.ofertare_poarta_rezultate_text;
BEGIN
  src := public.ofertare_poarta_text_sursa(p_licitatie_id);
  SELECT * INTO r FROM public.ofertare_poarta_rezultate_text t
    WHERE t.licitatie_id=p_licitatie_id AND t.control_code=p_control
      AND t.parser_version=src->>'parser_version' AND t.sursa_hash=src->>'sursa_hash'
    ORDER BY t.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN public.ofertare_poarta_rezultat(p_control,'undetermined','Rezultat text lipsă, sursă schimbată sau parser vechi'); END IF;
  RETURN jsonb_build_object('control_code',p_control,'stare',r.stare,'detalii',r.detalii,
    'parser_version',r.parser_version,'sursa_hash',r.sursa_hash);
EXCEPTION WHEN OTHERS THEN
  RETURN public.ofertare_poarta_rezultat(p_control,'undetermined','Nu putem citi sursa / rezultatul text: '||SQLERRM);
END $fn$;

-- Citim contoarele din aceeași definiție ca UI, inclusiv R09 (legătură blocată).
CREATE OR REPLACE FUNCTION public.ofertare_ctl_contor(p_licitatie_id bigint, c text, camp text, minim boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $fn$
DECLARE st jsonb; n bigint;
BEGIN
  SELECT to_jsonb(v) INTO st FROM public.v_ofertare_pt_stare v WHERE v.licitatie_id=p_licitatie_id;
  n := (st->>camp)::bigint;
  IF n IS NULL OR n<0 THEN RETURN public.ofertare_poarta_rezultat(c,'undetermined','Contor indisponibil: '||camp); END IF;
  RETURN public.ofertare_poarta_rezultat(c,CASE WHEN (minim AND n=0) OR (NOT minim AND n>0) THEN 'block' ELSE 'ok' END, camp||' = '||n);
EXCEPTION WHEN OTHERS THEN RETURN public.ofertare_poarta_rezultat(c,'undetermined',SQLERRM);
END $fn$;
CREATE OR REPLACE FUNCTION public.ofertare_ctl_cuprins(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $$ SELECT public.ofertare_ctl_contor(p_licitatie_id,'cuprins','capitole',true) $$;
CREATE OR REPLACE FUNCTION public.ofertare_ctl_neverificate(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $$ SELECT public.ofertare_ctl_contor(p_licitatie_id,'neverificate','cerinte_neverificate') $$;
CREATE OR REPLACE FUNCTION public.ofertare_ctl_capcane(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $$ SELECT public.ofertare_ctl_contor(p_licitatie_id,'capcane','capcane_descoperite') $$;
CREATE OR REPLACE FUNCTION public.ofertare_ctl_goale(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $$ SELECT public.ofertare_ctl_contor(p_licitatie_id,'goale','capitole_goale') $$;
CREATE OR REPLACE FUNCTION public.ofertare_ctl_nescrise(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $$ SELECT public.ofertare_ctl_contor(p_licitatie_id,'nescrise','capitole_nescrise_de_om') $$;

CREATE OR REPLACE FUNCTION public.ofertare_ctl_cantitati_f3_grafic(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $fn$
DECLARE f3 numeric; gr numeric; st jsonb; s text;
BEGIN
  SELECT to_jsonb(v) INTO st FROM public.v_ofertare_pt_stare v WHERE v.licitatie_id=p_licitatie_id;
  IF st IS NULL OR NOT (st ?& ARRAY['lista_f3_m','grafic_fronturi_m']) THEN
    RETURN public.ofertare_poarta_rezultat('cantitati_f3_grafic','undetermined','Comparația F3 / grafic indisponibilă'); END IF;
  f3 := (st->>'lista_f3_m')::numeric; gr := (st->>'grafic_fronturi_m')::numeric;
  -- Exact ca H2: fără F3 = block; fără fronturi = avertisment UI, nu regulă BLOCK nouă.
  s := CASE WHEN f3 IS NULL THEN 'block' WHEN gr IS NULL THEN 'ok'
    WHEN (f3=0 AND gr<>0) OR (f3<>0 AND abs(gr-f3)/f3>0.001) THEN 'block' ELSE 'ok' END;
  RETURN public.ofertare_poarta_rezultat('cantitati_f3_grafic',s,
    format('F3: %s m; grafic: %s m; toleranță 0,1%%',coalesce(f3::text,'lipsă'),coalesce(gr::text,'lipsă (avertisment UI)')));
EXCEPTION WHEN OTHERS THEN RETURN public.ofertare_poarta_rezultat('cantitati_f3_grafic','undetermined',SQLERRM);
END $fn$;

CREATE OR REPLACE FUNCTION public.ofertare_ctl_garantie(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $fn$
DECLARE st jsonb; cl numeric; ol numeric; cm text; om text;
BEGIN
  SELECT to_jsonb(v) INTO st FROM public.v_ofertare_pt_stare v WHERE v.licitatie_id=p_licitatie_id;
  IF st IS NULL OR NOT (st ?& ARRAY['garantie_cerut_luni','garantie_oferit_luni','garantie_cerut_moment','garantie_oferit_moment','garantie_cerinte_lucrari']) THEN
    RETURN public.ofertare_poarta_rezultat('garantie','undetermined','Garanția structurată indisponibilă'); END IF;
  cl := (st->>'garantie_cerut_luni')::numeric; ol := (st->>'garantie_oferit_luni')::numeric;
  cm := nullif(st->>'garantie_cerut_moment',''); om := nullif(st->>'garantie_oferit_moment','');
  IF ((ol IS NULL OR om IS NULL) AND (st->>'garantie_cerinte_lucrari')::int>0)
    OR (ol IS NOT NULL AND om IS NOT NULL AND (ol<cl OR om<>cm)) THEN
    RETURN public.ofertare_poarta_rezultat('garantie','block','Garanția oferită lipsește sau diferă de minimul / momentul cerut'); END IF;
  RETURN public.ofertare_ctl_text(p_licitatie_id,'garantie');
EXCEPTION WHEN OTHERS THEN RETURN public.ofertare_poarta_rezultat('garantie','undetermined',SQLERRM);
END $fn$;

CREATE OR REPLACE FUNCTION public.ofertare_ctl_grafic_sursa(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $fn$
DECLARE st jsonb; f jsonb; ver text; src text;
BEGIN
  SELECT to_jsonb(v) INTO st FROM public.v_ofertare_pt_stare v WHERE v.licitatie_id=p_licitatie_id;
  IF st IS NULL OR NOT (st ?& ARRAY['grafic_versiune','pachet_fisiere']) THEN
    RETURN public.ofertare_poarta_rezultat('grafic_sursa','undetermined','Sursa graficului indisponibilă'); END IF;
  ver := st->>'grafic_versiune';
  FOR f IN SELECT * FROM jsonb_array_elements(coalesce(nullif(st->'pachet_fisiere','null'::jsonb),'[]'::jsonb)) LOOP
    IF coalesce(f->>'nume','') ~* 'grafic|gantt|pert|drum(ul)?\s*critic|e[șs]alonare|program(ul)?\s+de\s+execu'
      OR coalesce(f->>'rol','') ~* 'grafic|gantt|pert|drum(ul)?\s*critic|e[șs]alonare|program(ul)?\s+de\s+execu' THEN
      src := substring(btrim(f->>'sursa_versiune') FROM '^(?:grafic@v)?([1-9][0-9]*)$');
      IF ver IS NULL OR src IS NULL OR src<>ver THEN
        RETURN public.ofertare_poarta_rezultat('grafic_sursa','block','Sursa graficului nu corespunde versiunii înghețate: '||coalesce(f->>'nume','—')); END IF;
    END IF;
  END LOOP;
  RETURN public.ofertare_poarta_rezultat('grafic_sursa','ok','Piesele de grafic corespund versiunii înghețate (sau nu există încă)');
EXCEPTION WHEN OTHERS THEN RETURN public.ofertare_poarta_rezultat('grafic_sursa','undetermined',SQLERRM);
END $fn$;

CREATE OR REPLACE FUNCTION public.ofertare_ctl_grafic_relatii(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $fn$
DECLARE st jsonb; acts jsonb; a jsonb; s jsonb; p jsonb; pred jsonb; tip text;
  incl int:=0; excl int:=0; plus int; minim numeric; real numeric; lag numeric; es numeric; ef numeric; durata numeric;
BEGIN
  SELECT to_jsonb(v) INTO st FROM public.v_ofertare_pt_stare v WHERE v.licitatie_id=p_licitatie_id;
  IF st IS NULL OR NOT (st ?& ARRAY['grafic_versiune','grafic_activitati_declarate']) THEN
    RETURN public.ofertare_poarta_rezultat('grafic_relatii','undetermined','Datele graficului indisponibile'); END IF;
  SELECT coalesce(jsonb_agg(x||jsonb_build_object('cod',coalesce(x->>'cod',x->>'id',''),
    'durata',coalesce(nullif(x->'durata','null'::jsonb),x->'durata_zile'))),'[]'::jsonb) INTO acts
    FROM jsonb_array_elements(coalesce(nullif(st->'grafic_activitati_declarate','null'::jsonb),'[]'::jsonb)) x
    WHERE coalesce(x->>'cod',x->>'id','')<>'';
  IF st->>'grafic_versiune' IS NULL OR jsonb_array_length(acts)=0 THEN
    RETURN public.ofertare_poarta_rezultat('grafic_relatii','ok','Fără versiune / activități: avertisment UI, nu control verificat'); END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(acts) x WHERE x->>'es' IS NOT NULL AND x->>'ef' IS NOT NULL) THEN
    RETURN public.ofertare_poarta_rezultat('grafic_relatii','ok','Date calculate de motor, nu declarate'); END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(acts) LOOP
    es:=(a->>'es')::numeric; ef:=(a->>'ef')::numeric; durata:=(a->>'durata')::numeric;
    IF ef=es+durata-1 THEN incl:=incl+1; ELSIF ef=es+durata THEN excl:=excl+1; END IF;
  END LOOP;
  plus:=CASE WHEN incl>=excl THEN 1 ELSE 0 END;
  FOR s IN SELECT * FROM jsonb_array_elements(acts) LOOP
    FOR p IN SELECT * FROM jsonb_array_elements(coalesce(nullif(s->'predecesori','null'::jsonb),'[]'::jsonb)) LOOP
      tip:=upper(coalesce(p->>'relatie',p->>'tip','FS')); IF tip='' THEN tip:='FS'; END IF;
      lag:=coalesce(nullif(p->>'lag','')::numeric,0);
      SELECT x INTO pred FROM jsonb_array_elements(acts) WITH ORDINALITY t(x,n)
        WHERE x->>'cod'=coalesce(p->>'cod',p->>'id','') ORDER BY n DESC LIMIT 1;
      IF pred IS NULL OR tip NOT IN ('FS','SS','FF','SF') THEN
        RETURN public.ofertare_poarta_rezultat('grafic_relatii','block','Predecesor inexistent sau tip de relație necunoscut'); END IF;
      IF s->>'es' IS NULL OR s->>'ef' IS NULL OR pred->>'es' IS NULL OR pred->>'ef' IS NULL THEN CONTINUE; END IF;
      minim:=CASE WHEN tip IN ('FS','FF') THEN (pred->>'ef')::numeric ELSE (pred->>'es')::numeric END+lag+CASE WHEN tip='FS' THEN plus ELSE 0 END;
      real:=CASE WHEN tip IN ('FS','SS') THEN (s->>'es')::numeric ELSE (s->>'ef')::numeric END;
      IF real<minim THEN RETURN public.ofertare_poarta_rezultat('grafic_relatii','block',format('%s → %s %s: declarat %s, minim %s',pred->>'cod',s->>'cod',tip,real,minim)); END IF;
    END LOOP;
  END LOOP;
  RETURN public.ofertare_poarta_rezultat('grafic_relatii','ok','Nicio relație declarată contradictorie; avertismentele rămân în UI');
EXCEPTION WHEN OTHERS THEN RETURN public.ofertare_poarta_rezultat('grafic_relatii','undetermined',SQLERRM);
END $fn$;

CREATE OR REPLACE FUNCTION public.ofertare_poarta_server(p_licitatie_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE controale jsonb; blocaje jsonb;
BEGIN
  IF NOT (session_user='postgres' OR current_setting('role',true)='service_role'
    OR (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare())) THEN
    RAISE EXCEPTION 'Nu ai acces la Ofertare' USING ERRCODE='42501'; END IF;
  controale:=jsonb_build_array(
    public.ofertare_ctl_cuprins(p_licitatie_id),public.ofertare_ctl_neverificate(p_licitatie_id),
    public.ofertare_ctl_capcane(p_licitatie_id),public.ofertare_ctl_goale(p_licitatie_id),public.ofertare_ctl_nescrise(p_licitatie_id),
    public.ofertare_ctl_cantitati_f3_grafic(p_licitatie_id),public.ofertare_ctl_garantie(p_licitatie_id),
    public.ofertare_ctl_text(p_licitatie_id,'anexe'),public.ofertare_ctl_text(p_licitatie_id,'numere'),public.ofertare_ctl_text(p_licitatie_id,'pachet'),
    public.ofertare_ctl_grafic_relatii(p_licitatie_id),public.ofertare_ctl_grafic_sursa(p_licitatie_id));
  SELECT coalesce(jsonb_agg(c->>'control_code'),'[]'::jsonb) INTO blocaje FROM jsonb_array_elements(controale) c WHERE c->>'stare'<>'ok';
  RETURN jsonb_build_object('stare',CASE WHEN jsonb_array_length(blocaje)>0 THEN 'block' ELSE 'ok' END,
    'controale',controale,'blocaje',blocaje,'identitate',jsonb_build_object('control_code','identitate',
      'stare','BUSINESS_DECISION_REQUIRED','enforcement','none','contribuie_la_verde',false));
END $fn$;

CREATE OR REPLACE FUNCTION public.ofertare_poarta_impune(p_licitatie_id bigint, p_pachet_id bigint DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $fn$
DECLARE r jsonb; ultim bigint;
BEGIN
  SELECT id INTO ultim FROM public.ofertare_pt_pachet WHERE licitatie_id=p_licitatie_id ORDER BY versiune DESC LIMIT 1;
  IF p_pachet_id IS NOT NULL AND p_pachet_id IS DISTINCT FROM ultim THEN
    RAISE EXCEPTION 'J07: pachet_versiune — aprobarea trebuie să verifice pachetul curent' USING ERRCODE='P0001'; END IF;
  -- La licitație depusă, nu evaluăm un draft nou în locul pachetului efectiv depus.
  -- Lipsa oricărui pachet depus rămâne la J02 (și derogarea sa istorică).
  IF p_pachet_id IS NULL
    AND EXISTS (SELECT 1 FROM public.ofertare_pt_pachet WHERE licitatie_id=p_licitatie_id AND stare='depus')
    AND NOT EXISTS (SELECT 1 FROM public.ofertare_pt_pachet WHERE id=ultim AND stare='depus') THEN
    RAISE EXCEPTION 'J07: pachet_versiune — pachetul depus nu este versiunea curentă verificată' USING ERRCODE='P0001'; END IF;
  r:=public.ofertare_poarta_server(p_licitatie_id);
  IF r->>'stare' IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION 'J07: controale blocante: %', r->'blocaje' USING ERRCODE='P0001'; END IF;
END $fn$;

-- Inserție chirurgicală: nu înlocuiește corpurile istorice, ACL sau triggerele existente.
-- Garda cere R5 și J05; la abatere de la forma așteptată migrarea e refuzată.
DO $patch$
DECLARE sig text; d text; apel text;
BEGIN
  FOREACH sig IN ARRAY ARRAY['public.fn_ofertare_pt_pachet_poarta_documentatie()','public.fn_gate_depunere()'] LOOP
    d:=pg_get_functiondef(sig::regprocedure);
    IF position('ofertare_r5_blocaj_sursa' in d)=0 THEN RAISE EXCEPTION 'J07: lipsește R5 în %',sig; END IF;
    IF sig='public.fn_gate_depunere()' AND position('ofertare_derogari_audit' in d)=0 THEN RAISE EXCEPTION 'J07: lipsește J05'; END IF;
    IF position('-- J07 BEGIN' in d)>0 THEN CONTINUE; END IF;
    IF (length(d)-length(replace(d,'RETURN NEW;','')))/length('RETURN NEW;')<>1 THEN RAISE EXCEPTION 'J07: ancoră ambiguă în %',sig; END IF;
    apel:=CASE WHEN sig='public.fn_gate_depunere()' THEN $a$
  -- J07 BEGIN
  IF NEW.status='depusa' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'depusa') THEN
    PERFORM public.ofertare_poarta_impune(NEW.id);
  END IF;
  -- J07 END
  $a$ ELSE $a$
  -- J07 BEGIN
  IF NEW.stare IN ('aprobat','depus') AND (TG_OP='INSERT' OR OLD.stare IS DISTINCT FROM NEW.stare) THEN
    PERFORM public.ofertare_poarta_impune(NEW.licitatie_id,NEW.id);
  END IF;
  -- J07 END
  $a$ END;
    EXECUTE replace(d,'RETURN NEW;',apel||'RETURN NEW;');
  END LOOP;
END $patch$;

-- Închidem inclusiv grant-urile implicite Supabase. Numai RPC-ul agregat e pentru UI.
DO $acl$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND (proname IN ('ofertare_poarta_parser_version','ofertare_poarta_rezultat','ofertare_poarta_text_sursa','ofertare_ctl_text',
      'ofertare_ctl_contor','ofertare_ctl_cuprins','ofertare_ctl_neverificate','ofertare_ctl_capcane','ofertare_ctl_goale',
      'ofertare_ctl_nescrise','ofertare_ctl_cantitati_f3_grafic','ofertare_ctl_garantie','ofertare_ctl_grafic_sursa',
      'ofertare_ctl_grafic_relatii','ofertare_poarta_server','ofertare_poarta_impune','fn_ofertare_poarta_text_imuabil')) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.sig);
  END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.ofertare_poarta_server(bigint) TO authenticated;

-- Postcondiții: inserția J07 exact o dată în fiecare funcție, R5 / J05 păstrate, ACL-urile neschimbate; RPC-ul agregat e singurul
-- apelabil din UI; rezultatele text append-only.
DO $post$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.proname, p.prosrc, p.prosecdef, array_to_string(p.proconfig, ',') AS cfg,
                  (SELECT string_agg(a::text, ' ' ORDER BY a::text) FROM unnest(p.proacl) a) AS acl
             FROM pg_proc p WHERE p.oid IN ('public.fn_gate_depunere()'::regprocedure, 'public.fn_ofertare_pt_pachet_poarta_documentatie()'::regprocedure) LOOP
    IF (length(r.prosrc) - length(replace(r.prosrc, '-- J07 BEGIN', ''))) / length('-- J07 BEGIN') <> 1
       OR position('ofertare_r5_blocaj_sursa' in r.prosrc) = 0
       OR (r.proname = 'fn_gate_depunere' AND position('ofertare_derogari_audit' in r.prosrc) = 0)
       OR r.prosecdef IS NOT TRUE OR r.cfg IS DISTINCT FROM 'search_path=public, pg_temp'
       OR r.acl IS DISTINCT FROM 'postgres=X/postgres service_role=X/postgres' THEN
      RAISE EXCEPTION 'Postcondiție 1: % — J07 nu e inserat exact o dată sau R5 / J05 / SECDEF / search_path / ACL s-au schimbat', r.proname;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.ofertare_poarta_server(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ofertare_poarta_impune(bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ofertare_poarta_server(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție 2: doar ofertare_poarta_server e apelabil de authenticated (nu anon, nu impune)';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ofertare_poarta_rezultate_text'::regclass) IS NOT TRUE
     OR has_table_privilege('authenticated', 'public.ofertare_poarta_rezultate_text', 'INSERT')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_poarta_text_imuabil') THEN
    RAISE EXCEPTION 'Postcondiție 3: ofertare_poarta_rezultate_text fără RLS / scriere pentru authenticated / fără append-only';
  END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003a_ofertare_poarta_server_jakv2p3:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$livrare_final$;
