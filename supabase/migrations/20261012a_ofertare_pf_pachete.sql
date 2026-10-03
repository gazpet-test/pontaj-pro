-- PR1 PF Package Shell. Numai runner, o singură tranzacție exterioară.
-- Necunoscutele din registru și marcajul PDF grafic sunt documentate în NOTE.md.
-- r2 (03.10.2026, decizii Răzvan după validare; redenumită 20261009a → 20261012a ca să sorteze după 20261011a):
--   * GRANT executor TO postgres WITH INHERIT TRUE, SET TRUE (postgres nesuperuser: ADMIN vine din CREATE ROLE);
--   * postcondiție fail-closed: executorul trebuie să poată folosi extensions.digest și wrapper-ul uid;
--   * fără service_role (BYPASSRLS) pe tabele/view/RPC; secvențele identity fără drepturi; ACL EXACT (aclexplode);
--   * scrierea PF cere access_level admin/editor (precedent 20261005b); viewer doar citește;
--   * închiderea cere filiație exactă: draftul înlocuiește versiunea închisă curentă a scope-ului (sau niciuna);
--   * hash-ul legacy din registru se compară doar dacă e SHA-256 hex (lower/btrim);
--   * mesaj corect pentru scrierea fără drept PF; garda finală $livrare_final$ ca ultimă instrucțiune.
-- r3 (03.10.2026, preflight live): postgres are USAGE pe schema auth FĂRĂ grant option ⇒ executorul PF NU primește
--   nimic pe auth. Identitatea apelantului se citește prin public.fn_ofertare_pf_uid() (SECURITY DEFINER al lui
--   postgres, corp `SELECT auth.uid()`, EXECUTE doar pentru executor); triggerele SECURITY INVOKER aleg wrapper-ul când
--   rulează ca executor și auth.uid() altfel; coloanele created_by/updated_by nu mai au DEFAULT auth.uid() (le scrie
--   triggerul). Precondiții noi: auth.uid() exact cel live (md5), coloanele și politica grafic_act_sel pe
--   grafic_activitati, fără politici PUBLIC pe registru. View-ul calculează informativ grafic_are_activitati.
-- r4 (03.10.2026, Copilot NO-GO mic pe e3bd3f4, P0.1 „confused deputy” pe registru): regula din UI devine invariant pe
--   server — orice folosire a unui registru_id (selecție, sursă de valoare, închidere, citirea de către executor) cere
--   acces general la Ofertare pentru APELANT (public.fn_ofertare_pf_acces_ofertare(), SECDEF peste fn_are_acces_ofertare)
--   și ca registrul să fie al licitației pachetului. Refuzul vine din trigger BEFORE, înaintea FK, cu un mesaj unic
--   pentru id existent sau inexistent (fără oracol). Dosarele pe proiect nu primesc documente din registru.
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261012a_ofertare_pf_pachete:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: folosiți scripts/livrare_migrare.sh' USING ERRCODE = '42501';
  END IF;
END $livrare_start$;

DO $pre$
DECLARE r record;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'REFUZ: owner așteptat postgres'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = ANY(ARRAY['fn_poate_citi_pf','fn_poate_scrie_pf','fn_ofertare_pf_pachet_garda','fn_ofertare_pf_valoare_garda','fn_ofertare_pf_inchide','fn_ofertare_pf_versiune_noua','fn_ofertare_pf_uid','fn_ofertare_pf_acces_ofertare']))
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ofertare_pf_executor')
     OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY(ARRAY['ofertare_pf_pachete','ofertare_pf_valori','v_ofertare_pf_control','ofertare_pf_pachete_id_seq','ofertare_pf_valori_id_seq'])) THEN
    RAISE EXCEPTION 'REFUZ: obiect PF sau rol executor deja existent';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_are_acces_ofertare') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure('public.fn_are_acces_ofertare()') AND p.prorettype = 'boolean'::regtype
         AND NOT p.proretset AND p.prosecdef AND p.provolatile = 's' AND l.lanname = 'sql'
         AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig = ARRAY['search_path=public, pg_temp']
         AND md5(p.prosrc) = '429d28e2a61fb24c8009d67050c16c85'
         AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 OR a.is_grantable OR a.grantee::regrole::text NOT IN ('postgres','authenticated','service_role'))
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'REFUZ: semnătura, owner, SECDEF, search_path sau ACL fn_are_acces_ofertare diferă';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('extensions.digest(text,text)') AND prorettype = 'bytea'::regtype) THEN
    RAISE EXCEPTION 'REFUZ: extensions.digest(text,text) lipsește';
  END IF;
  -- auth.uid() exact cel live (preflight 03.10): wrapper-ul SECDEF îl apelează ca postgres; dacă se schimbă, refuz.
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = to_regnamespace('auth') AND proname = 'uid') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure('auth.uid()') AND p.prorettype = 'uuid'::regtype AND NOT p.proretset AND p.provolatile = 's'
         AND l.lanname = 'sql' AND md5(p.prosrc) = 'cdef18c69c4f4cbbced2eaf81e628b49')
     OR NOT has_function_privilege('postgres', 'auth.uid()', 'EXECUTE') THEN
    RAISE EXCEPTION 'REFUZ: auth.uid() lipsește sau diferă de cel live (md5/limbaj/STABLE)';
  END IF;
  -- Indicatorul grafic (Q5) citește grafic_activitati prin view-ul security_invoker: politica SELECT trebuie să fie exact cea live.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.grafic_activitati') AND relkind = 'r' AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.grafic_activitati') AND polname = 'grafic_act_sel'
       AND polcmd = 'r' AND polpermissive AND polroles = ARRAY['authenticated'::regrole::oid] AND polwithcheck IS NULL
       AND pg_get_expr(polqual, polrelid) = '(auth.uid() IS NOT NULL)')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.grafic_activitati') AND NOT polpermissive)
     OR NOT has_table_privilege('authenticated', 'public.grafic_activitati', 'SELECT') THEN
    RAISE EXCEPTION 'REFUZ: grafic_activitati (RLS, politica grafic_act_sel sau dreptul SELECT) diferă de live';
  END IF;
  -- Executorul citește registrul la închidere: nicio politică PUBLIC acolo (ar rula ca executor, fără acces la auth).
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.ofertare_formulare_registru'::regclass AND 0::oid = ANY(polroles)) THEN
    RAISE EXCEPTION 'REFUZ: ofertare_formulare_registru are politici pentru PUBLIC';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('ofertare_licitatii','id','bigint'), ('executie_proiecte','id','bigint'),
    ('profiles','id','uuid'), ('profiles','is_owner','boolean'),
    ('user_module_access','profile_id','uuid'), ('user_module_access','module','text'), ('user_module_access','access_level','text'),
    ('ofertare_formulare_registru','id','bigint'), ('ofertare_formulare_registru','licitatie_id','bigint'),
    ('ofertare_formulare_registru','cod','text'), ('ofertare_formulare_registru','denumire','text'),
    ('ofertare_formulare_registru','fisier_path','text'), ('ofertare_formulare_registru','fisier_hash','text'),
    ('ofertare_formulare_registru','stare_depunere','text'),
    ('grafic_activitati','licitatie_id','bigint'), ('grafic_activitati','proiect_id','bigint')
  ) AS t(tab, col, tip) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.oid = to_regclass('public.' || r.tab) AND c.relkind = 'r' AND a.attname = r.col AND NOT a.attisdropped
        AND format_type(a.atttypid, a.atttypmod) = r.tip) THEN
      RAISE EXCEPTION 'REFUZ: coloană părinte %.% (%) absentă sau schimbată', r.tab, r.col, r.tip;
    END IF;
  END LOOP;
END $pre$;

-- Identitate exclusiv internă: fără login, membri API, drept de creare sau funcții generice.
-- Numai administratorul tehnic postgres o administrează. Nu ocolește RLS.
CREATE ROLE ofertare_pf_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE TABLE public.ofertare_pf_pachete (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id bigint REFERENCES public.ofertare_licitatii(id) ON DELETE RESTRICT,
  proiect_id bigint REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
  versiune integer NOT NULL CHECK (versiune > 0),
  eticheta text NOT NULL CHECK (btrim(eticheta) <> ''),
  rol_oferta text NOT NULL CHECK (rol_oferta IN ('ofertant_unic','lider_asociere','asociat','subcontractant','tert_sustinator')),
  instrument text NOT NULL CHECK (instrument IN ('doclib','isdp','edevize','excel','boq','forfetar','altul','necunoscut')),
  instrument_dovada text,
  moneda text NOT NULL DEFAULT 'RON' CHECK (moneda IN ('RON','EUR')),
  stare text NOT NULL DEFAULT 'lucru' CHECK (stare IN ('lucru','inchis','inlocuit')),
  inlocuieste_id bigint REFERENCES public.ofertare_pf_pachete(id),
  data_depunere timestamptz, dovada_depunere text, nas_folder text,
  documente_selectate jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(documente_selectate) = 'array'),
  manifest jsonb, manifest_hash text, inchis_la timestamptz, inchis_de uuid,
  -- created_by/updated_by: le scrie triggerul pf_pachet_garda (fără DEFAULT auth.uid(): executorul nu are acces la auth).
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CONSTRAINT pf_parinte_xor CHECK ((licitatie_id IS NOT NULL)::int + (proiect_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX pf_lic_versiune ON public.ofertare_pf_pachete(licitatie_id, rol_oferta, versiune) WHERE licitatie_id IS NOT NULL;
CREATE UNIQUE INDEX pf_pro_versiune ON public.ofertare_pf_pachete(proiect_id, rol_oferta, versiune) WHERE proiect_id IS NOT NULL;
CREATE UNIQUE INDEX pf_lic_draft ON public.ofertare_pf_pachete(licitatie_id, rol_oferta) WHERE stare = 'lucru';
CREATE UNIQUE INDEX pf_pro_draft ON public.ofertare_pf_pachete(proiect_id, rol_oferta) WHERE stare = 'lucru';
CREATE UNIQUE INDEX pf_lic_curent ON public.ofertare_pf_pachete(licitatie_id, rol_oferta) WHERE stare = 'inchis';
CREATE UNIQUE INDEX pf_pro_curent ON public.ofertare_pf_pachete(proiect_id, rol_oferta) WHERE stare = 'inchis';

CREATE TABLE public.ofertare_pf_valori (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pachet_id bigint NOT NULL REFERENCES public.ofertare_pf_pachete(id) ON DELETE CASCADE,
  rol_valoare text NOT NULL CHECK (rol_valoare IN ('total_oferta','platibil','materiale_beneficiar','contract_initial','act_aditional','ajustari','grafic_valoric','cota')),
  domeniu_valoric text NOT NULL CHECK (domeniu_valoric IN ('asociere_total','gazpet','subcontract','beneficiar','lider','asociat')),
  participant text,
  valoare numeric(16,2) NOT NULL CHECK (valoare <> 'NaN'::numeric),
  tva_inclus boolean NOT NULL DEFAULT false,
  cota_pct numeric(7,4) CHECK (cota_pct <> 'NaN'::numeric), baza_text text,
  sursa_registru_id bigint REFERENCES public.ofertare_formulare_registru(id), sursa_externa_cheie text,
  localizare text NOT NULL CHECK (btrim(localizare) <> ''),
  confirmat_de uuid, confirmat_la timestamptz, nota text,
  CONSTRAINT pf_cota CHECK (rol_valoare <> 'cota' OR cota_pct IS NOT NULL),
  CONSTRAINT pf_confirmare CHECK ((confirmat_de IS NULL) = (confirmat_la IS NULL)),
  CONSTRAINT pf_sursa CHECK (sursa_registru_id IS NULL OR sursa_externa_cheie IS NULL)
);
CREATE INDEX pf_valori_pachet ON public.ofertare_pf_valori(pachet_id);

CREATE FUNCTION public.fn_poate_citi_pf() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner IS TRUE)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare_pf')
  );
$fn$;
-- Scrierea: owner sau 'ofertare_pf' cu access_level admin/editor (viewer doar citește; precedent 20261005b).
CREATE FUNCTION public.fn_poate_scrie_pf() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner IS TRUE)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare_pf'
                 AND uma.access_level IN ('admin','editor'))
  );
$fn$;

-- Identitatea apelantului pentru executorul PF. Live: postgres are USAGE pe auth fără GRANT OPTION, deci executorul nu
-- poate primi USAGE pe auth. Wrapper-ul rulează ca postgres; request.jwt.* sunt setări ale sesiunii, deci întoarce
-- uid-ul apelantului (nu al ownerului). EXECUTE doar pentru executor: triggerele rulate de API folosesc auth.uid().
CREATE FUNCTION public.fn_ofertare_pf_uid() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT auth.uid();
$fn$;

-- Acces general la Ofertare al APELANTULUI (Copilot P0.1): restrânge registrul Ofertare la cine îl poate citi direct.
-- SECDEF al lui postgres peste fn_are_acces_ofertare() (SECDEF, auth.uid() ⇒ identitatea din JWT-ul sesiunii).
-- EXECUTE: ofertare_pf_executor (închiderea și politica pf_executor_registru_sel) și authenticated (triggerele PF rulează
-- ca apelantul API). Nu lărgește nimic: fn_are_acces_ofertare() e deja executabilă de authenticated și întoarce același răspuns.
CREATE FUNCTION public.fn_ofertare_pf_acces_ofertare() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT public.fn_are_acces_ofertare();
$fn$;

-- SECURITY INVOKER este esențial: observă identitatea RPC-ului, nu owner-ul triggerului.
CREATE FUNCTION public.fn_ofertare_pf_pachet_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $fn$
DECLARE v public.ofertare_pf_pachete; d jsonb; docs jsonb := '[]'; anterioare jsonb := '[]'; v_uid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.stare <> 'lucru' THEN RAISE EXCEPTION 'PF: versiunea înghețată nu se șterge'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.stare <> 'lucru' THEN
    IF current_user = 'ofertare_pf_executor' AND OLD.stare = 'inchis' AND NEW.stare = 'inlocuit'
       AND (pg_catalog.to_jsonb(NEW) - 'stare') = (pg_catalog.to_jsonb(OLD) - 'stare') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'PF: versiunea înghețată este imuabilă';
  END IF;
  -- Executorul nu are USAGE pe auth: citește uid-ul apelantului prin wrapper. Ceilalți (API) prin auth.uid().
  -- Instrucțiuni separate: PL/pgSQL pregătește doar ramura executată, deci executorul nu atinge schema auth.
  IF current_user = 'ofertare_pf_executor' THEN v_uid := public.fn_ofertare_pf_uid(); ELSE v_uid := auth.uid(); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.stare <> 'lucru' OR NEW.manifest IS NOT NULL OR NEW.manifest_hash IS NOT NULL OR NEW.inchis_la IS NOT NULL OR NEW.inchis_de IS NOT NULL THEN
      RAISE EXCEPTION 'PF: INSERT numai draft fără manifest';
    END IF;
    NEW.created_at := now(); NEW.created_by := v_uid;
  ELSE
    IF (NEW.id, NEW.licitatie_id, NEW.proiect_id, NEW.rol_oferta, NEW.versiune, NEW.inlocuieste_id, NEW.created_at, NEW.created_by)
       IS DISTINCT FROM (OLD.id, OLD.licitatie_id, OLD.proiect_id, OLD.rol_oferta, OLD.versiune, OLD.inlocuieste_id, OLD.created_at, OLD.created_by) THEN
      RAISE EXCEPTION 'PF: identitatea și filiația versiunii nu se mută';
    END IF;
    IF NEW.stare <> 'lucru' AND NOT (current_user = 'ofertare_pf_executor' AND NEW.stare = 'inchis') THEN
      RAISE EXCEPTION 'PF: închiderea este permisă numai prin RPC';
    END IF;
    IF (NEW.manifest, NEW.manifest_hash, NEW.inchis_la, NEW.inchis_de) IS DISTINCT FROM (OLD.manifest, OLD.manifest_hash, OLD.inchis_la, OLD.inchis_de)
       AND NOT (current_user = 'ofertare_pf_executor' AND NEW.stare = 'inchis') THEN
      RAISE EXCEPTION 'PF: manifestul se scrie numai la închidere';
    END IF;
  END IF;
  IF NEW.inlocuieste_id IS NOT NULL THEN
    SELECT * INTO v FROM public.ofertare_pf_pachete WHERE id = NEW.inlocuieste_id;
    IF NOT FOUND OR NOT (v.stare = 'inchis' OR current_user = 'ofertare_pf_executor' AND NEW.stare = 'inchis' AND v.stare = 'inlocuit') OR (v.licitatie_id, v.proiect_id, v.rol_oferta) IS DISTINCT FROM (NEW.licitatie_id, NEW.proiect_id, NEW.rol_oferta)
       OR NEW.versiune <= v.versiune THEN RAISE EXCEPTION 'PF: versiunea sursă nu este curentul aceluiași scope'; END IF;
  END IF;
  -- Registrul Ofertare: orice registru_id din selecție cere acces general la Ofertare pentru apelant și aparține licitației
  -- pachetului. Mesaj unic înaintea oricărei citiri din registru (nu dezvăluie dacă id-ul există).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.documente_selectate) x WHERE nullif(x->>'registru_id','') IS NOT NULL) THEN
    IF NOT public.fn_ofertare_pf_acces_ofertare() THEN
      RAISE EXCEPTION 'PF: documentele din registru cer acces la Ofertare' USING ERRCODE = '42501';
    END IF;
    IF NEW.licitatie_id IS NULL THEN RAISE EXCEPTION 'PF: documentele din registru sunt permise doar pe dosarul unei licitații'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.documente_selectate) x WHERE nullif(x->>'registru_id','') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.ofertare_formulare_registru r
                                WHERE r.id = (x->>'registru_id')::bigint AND r.licitatie_id = NEW.licitatie_id)) THEN
      RAISE EXCEPTION 'PF: document din altă licitație sau absent';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN anterioare := OLD.documente_selectate;
  ELSIF current_user = 'ofertare_pf_executor' AND NEW.inlocuieste_id IS NOT NULL THEN anterioare := v.documente_selectate;
  END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(NEW.documente_selectate) LOOP
    IF d->>'hash_confirmat_de' IS NOT NULL OR d->>'hash_confirmat_la' IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(anterioare) x WHERE x = d) THEN
        IF v_uid IS NULL THEN RAISE EXCEPTION 'PF: confirmarea hash cere utilizator'; END IF;
        d := d || pg_catalog.jsonb_build_object('hash_confirmat_de',v_uid,'hash_confirmat_la',now());
      END IF;
    END IF;
    docs := docs || pg_catalog.jsonb_build_array(d);
  END LOOP;
  NEW.documente_selectate := docs;
  NEW.updated_at := now(); NEW.updated_by := v_uid;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER pf_pachet_garda BEFORE INSERT OR UPDATE OR DELETE ON public.ofertare_pf_pachete
FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_pf_pachet_garda();

CREATE FUNCTION public.fn_ofertare_pf_valoare_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $fn$
DECLARE v_stare text; v_id bigint; v_uid uuid; v_lic bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.pachet_id) IS DISTINCT FROM (OLD.id, OLD.pachet_id) THEN
    RAISE EXCEPTION 'PF: valoarea nu se mută între versiuni';
  END IF;
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.pachet_id ELSE NEW.pachet_id END;
  -- Serializează orice editare a valorilor cu închiderea pachetului.
  SELECT stare, licitatie_id INTO v_stare, v_lic FROM public.ofertare_pf_pachete WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    -- DELETE în cascadă: pachetul tocmai a fost șters. Altfel RLS ascunde pachetul: lipsă sau fără drept de scriere PF.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'PF: pachet inexistent sau fără drept de scriere PF' USING ERRCODE = '42501';
  END IF;
  IF v_stare IS DISTINCT FROM 'lucru' THEN RAISE EXCEPTION 'PF: valorile versiunii înghețate sunt imuabile'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  -- Sursa din registrul Ofertare: acces general la Ofertare pentru apelant, verificat ÎNAINTEA FK-ului (trigger BEFORE) și
  -- cu un mesaj unic pentru id existent sau inexistent (fără oracol); apoi registrul trebuie să fie al licitației pachetului.
  IF NEW.sursa_registru_id IS NOT NULL THEN
    IF NOT public.fn_ofertare_pf_acces_ofertare() THEN
      RAISE EXCEPTION 'PF: documentele din registru cer acces la Ofertare' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ofertare_formulare_registru r WHERE r.id = NEW.sursa_registru_id AND r.licitatie_id = v_lic) THEN
      RAISE EXCEPTION 'PF: document din altă licitație sau absent';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (pg_catalog.to_jsonb(NEW) - 'confirmat_de' - 'confirmat_la') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'confirmat_de' - 'confirmat_la')
     AND (NEW.confirmat_de,NEW.confirmat_la) IS NOT DISTINCT FROM (OLD.confirmat_de,OLD.confirmat_la) THEN
    NEW.confirmat_de := NULL; NEW.confirmat_la := NULL;
  END IF;
  IF NEW.confirmat_de IS NOT NULL OR NEW.confirmat_la IS NOT NULL THEN
    IF current_user = 'ofertare_pf_executor' THEN v_uid := public.fn_ofertare_pf_uid(); ELSE v_uid := auth.uid(); END IF;
    IF v_uid IS NULL THEN RAISE EXCEPTION 'PF: confirmarea cere utilizator'; END IF;
    NEW.confirmat_de := v_uid; NEW.confirmat_la := now();
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER pf_valoare_garda BEFORE INSERT OR UPDATE OR DELETE ON public.ofertare_pf_valori
FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_pf_valoare_garda();

CREATE FUNCTION public.fn_ofertare_pf_inchide(p_pachet bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE p public.ofertare_pf_pachete; r public.ofertare_formulare_registru;
  d jsonb; intrare jsonb; m jsonb := '[]'; k text; rid bigint; h text; hs text; hc uuid; ht timestamptz; v_curent bigint; legacy text;
BEGIN
  IF NOT public.fn_poate_scrie_pf() THEN RAISE EXCEPTION 'PF: fără drept de scriere' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.ofertare_pf_pachete WHERE id = p_pachet;
  IF NOT FOUND THEN RAISE EXCEPTION 'PF: pachet inexistent'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('PF:' || coalesce('L' || p.licitatie_id, 'P' || p.proiect_id) || ':' || p.rol_oferta, 0));
  SELECT * INTO p FROM public.ofertare_pf_pachete WHERE id = p_pachet FOR UPDATE;
  IF NOT FOUND OR p.stare <> 'lucru' THEN RAISE EXCEPTION 'PF: închiderea cere un draft'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_pf_valori WHERE pachet_id = p.id AND rol_valoare IN ('total_oferta','platibil'))
     OR EXISTS (SELECT 1 FROM public.ofertare_pf_valori WHERE pachet_id = p.id AND (confirmat_de IS NULL OR confirmat_la IS NULL)) THEN
    RAISE EXCEPTION 'PF: trebuie total_oferta sau platibil și toate valorile confirmate';
  END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(p.documente_selectate) LOOP
    IF jsonb_typeof(d) <> 'object' THEN RAISE EXCEPTION 'PF: document invalid'; END IF;
    rid := (d->>'registru_id')::bigint; k := nullif(btrim(d->>'cheie'), '');
    IF (rid IS NOT NULL)::int + (k IS NOT NULL)::int <> 1 THEN RAISE EXCEPTION 'PF: documentul cere registru_id XOR cheie'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(m) x WHERE (rid IS NOT NULL AND (x->>'registru_id')::bigint = rid) OR (k IS NOT NULL AND x->>'cheie' = k)) THEN
      RAISE EXCEPTION 'PF: document duplicat';
    END IF;
    h := nullif(d->>'hash_valoare',''); hs := nullif(d->>'hash_sursa',''); hc := (d->>'hash_confirmat_de')::uuid; ht := (d->>'hash_confirmat_la')::timestamptz;
    IF h IS NOT NULL THEN
      IF d->>'hash_algoritm' IS DISTINCT FROM 'sha256' OR h !~ '^[0-9a-f]{64}$' OR hs IS DISTINCT FROM 'client' OR hc IS NULL OR ht IS NULL
         THEN
        RAISE EXCEPTION 'PF: hash client SHA-256 fără confirmare umană validă';
      END IF;
    ELSIF hs IS NOT NULL OR hc IS NOT NULL OR ht IS NOT NULL OR d->>'hash_algoritm' IS NOT NULL THEN
      RAISE EXCEPTION 'PF: metadate hash fără hash';
    END IF;
    IF rid IS NOT NULL THEN
      -- Defensiv (P0.1): executorul citește registrul doar pentru un apelant cu acces general la Ofertare.
      IF NOT public.fn_ofertare_pf_acces_ofertare() THEN
        RAISE EXCEPTION 'PF: documentele din registru cer acces la Ofertare' USING ERRCODE = '42501';
      END IF;
      SELECT * INTO r FROM public.ofertare_formulare_registru WHERE id = rid;
      IF NOT FOUND OR p.licitatie_id IS NULL OR r.licitatie_id IS DISTINCT FROM p.licitatie_id THEN
        RAISE EXCEPTION 'PF: document din altă licitație sau absent';
      END IF;
      -- Metadatele de registru nu sunt acceptate din payload. Hash-ul legacy nu are proveniență cunoscută.
      intrare := pg_catalog.jsonb_build_object('registru_id',r.id,'cheie',NULL,'cod',r.cod,'denumire',r.denumire,'fisier_path',r.fisier_path,
        'marime',NULL,'hash_algoritm',CASE WHEN h IS NOT NULL THEN 'sha256' END,'hash_valoare',coalesce(h,r.fisier_hash),
        'hash_sursa',hs,'hash_confirmat_de',hc,'hash_confirmat_la',to_char(ht AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'stare_depunere',r.stare_depunere,'provenienta','ofertare_formulare_registru');
      -- Hash-ul legacy e text liber (scris de mână): se compară doar când arată ca SHA-256 hex, normalizat.
      legacy := lower(btrim(r.fisier_hash));
      IF h IS NOT NULL AND (d->>'fisier_path' IS DISTINCT FROM r.fisier_path OR legacy ~ '^[0-9a-f]{64}$' AND legacy <> h) THEN
        RAISE EXCEPTION 'PF: hash client diferă de fișierul selectat în registru';
      END IF;
    ELSE
      IF nullif(btrim(d->>'denumire'),'') IS NULL OR nullif(btrim(d->>'provenienta'),'') IS NULL THEN
        RAISE EXCEPTION 'PF: documentul extern cere denumire și proveniență';
      END IF;
      IF (d->>'marime')::bigint < 0 THEN RAISE EXCEPTION 'PF: mărime negativă'; END IF;
      intrare := pg_catalog.jsonb_build_object('registru_id',NULL,'cheie',k,'cod',d->>'cod','denumire',d->>'denumire','fisier_path',d->>'fisier_path',
        'marime',(d->>'marime')::bigint,'hash_algoritm',CASE WHEN h IS NOT NULL THEN 'sha256' END,'hash_valoare',h,
        'hash_sursa',hs,'hash_confirmat_de',hc,'hash_confirmat_la',to_char(ht AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'stare_depunere',d->>'stare_depunere','provenienta',d->>'provenienta');
    END IF;
    m := m || pg_catalog.jsonb_build_array(intrare);
  END LOOP;
  SELECT coalesce(pg_catalog.jsonb_agg(x ORDER BY (x->>'registru_id')::bigint NULLS LAST, (x->>'cheie') COLLATE "C"),'[]') INTO m FROM jsonb_array_elements(m) x;
  IF EXISTS (SELECT 1 FROM public.ofertare_pf_valori v WHERE v.pachet_id = p.id AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(m) x WHERE (v.sursa_registru_id IS NOT NULL AND (x->>'registru_id')::bigint = v.sursa_registru_id)
      OR (v.sursa_externa_cheie IS NOT NULL AND x->>'cheie' = v.sursa_externa_cheie))) THEN
    RAISE EXCEPTION 'PF: valoare cu sursă în afara manifestului';
  END IF;
  -- Filiație exactă, validată cât sursa este încă închisă: draftul înlocuiește versiunea închisă curentă a scope-ului,
  -- sau niciuna când scope-ul nu are încă o versiune închisă. Un draft inserat direct fără inlocuieste_id nu rupe lanțul.
  SELECT x.id INTO v_curent FROM public.ofertare_pf_pachete x
    WHERE x.stare = 'inchis' AND (x.licitatie_id,x.proiect_id,x.rol_oferta) IS NOT DISTINCT FROM (p.licitatie_id,p.proiect_id,p.rol_oferta);
  IF p.inlocuieste_id IS DISTINCT FROM v_curent THEN
    RAISE EXCEPTION 'PF: filiație invalidă: draftul trebuie să înlocuiască versiunea închisă curentă (%)', coalesce(v_curent::text,'niciuna');
  END IF;
  UPDATE public.ofertare_pf_pachete SET stare = 'inlocuit' WHERE stare = 'inchis'
    AND (licitatie_id,proiect_id,rol_oferta) IS NOT DISTINCT FROM (p.licitatie_id,p.proiect_id,p.rol_oferta);
  UPDATE public.ofertare_pf_pachete SET stare = 'inchis', manifest = m,
    manifest_hash = encode(extensions.digest(m::text,'sha256'),'hex'), inchis_la = now(), inchis_de = public.fn_ofertare_pf_uid() WHERE id = p.id;
  RETURN p.id;
END;
$fn$;

CREATE FUNCTION public.fn_ofertare_pf_versiune_noua(p_pachet bigint, p_eticheta text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE p public.ofertare_pf_pachete; v_id bigint; v_nr integer;
BEGIN
  IF NOT public.fn_poate_scrie_pf() THEN RAISE EXCEPTION 'PF: fără drept de scriere' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(p_eticheta),'') IS NULL THEN RAISE EXCEPTION 'PF: eticheta este obligatorie'; END IF;
  SELECT * INTO p FROM public.ofertare_pf_pachete WHERE id = p_pachet;
  IF NOT FOUND THEN RAISE EXCEPTION 'PF: pachet inexistent'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('PF:' || coalesce('L' || p.licitatie_id, 'P' || p.proiect_id) || ':' || p.rol_oferta, 0));
  SELECT * INTO p FROM public.ofertare_pf_pachete WHERE id = p_pachet FOR UPDATE;
  IF NOT FOUND OR p.stare <> 'inchis' THEN RAISE EXCEPTION 'PF: versiunea nouă pornește din curentul închis'; END IF;
  SELECT max(versiune) + 1 INTO v_nr FROM public.ofertare_pf_pachete WHERE
    (licitatie_id,proiect_id,rol_oferta) IS NOT DISTINCT FROM (p.licitatie_id,p.proiect_id,p.rol_oferta);
  INSERT INTO public.ofertare_pf_pachete(licitatie_id,proiect_id,versiune,eticheta,rol_oferta,instrument,instrument_dovada,moneda,
    inlocuieste_id,data_depunere,dovada_depunere,nas_folder,documente_selectate)
  VALUES(p.licitatie_id,p.proiect_id,v_nr,p_eticheta,p.rol_oferta,p.instrument,p.instrument_dovada,p.moneda,
    p.id,p.data_depunere,p.dovada_depunere,p.nas_folder,p.documente_selectate) RETURNING id INTO v_id;
  INSERT INTO public.ofertare_pf_valori(pachet_id,rol_valoare,domeniu_valoric,participant,valoare,tva_inclus,cota_pct,baza_text,
    sursa_registru_id,sursa_externa_cheie,localizare,nota)
  SELECT v_id,rol_valoare,domeniu_valoric,participant,valoare,tva_inclus,cota_pct,baza_text,sursa_registru_id,sursa_externa_cheie,localizare,nota
    FROM public.ofertare_pf_valori WHERE pachet_id = p.id;
  RETURN v_id;
END;
$fn$;

-- Transfer de owner posibil și pentru un runner postgres nesuperuser cu CREATEROLE.
-- CREATE este temporar. Membership postgres rămâne pentru administrare și revenire.
GRANT ofertare_pf_executor TO postgres WITH INHERIT TRUE, SET TRUE; -- PG16+: ADMIN vine deja din CREATE ROLE (postgres nesuperuser CREATEROLE); WITH ADMIN OPTION ar eșua
GRANT CREATE ON SCHEMA public TO ofertare_pf_executor;
ALTER FUNCTION public.fn_ofertare_pf_inchide(bigint) OWNER TO ofertare_pf_executor;
ALTER FUNCTION public.fn_ofertare_pf_versiune_noua(bigint,text) OWNER TO ofertare_pf_executor;
REVOKE CREATE ON SCHEMA public FROM ofertare_pf_executor;
REVOKE ALL ON FUNCTION public.fn_poate_citi_pf(), public.fn_poate_scrie_pf(), public.fn_ofertare_pf_pachet_garda(), public.fn_ofertare_pf_uid(), public.fn_ofertare_pf_acces_ofertare(),
  public.fn_ofertare_pf_valoare_garda(), public.fn_ofertare_pf_inchide(bigint), public.fn_ofertare_pf_versiune_noua(bigint,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_poate_citi_pf(), public.fn_poate_scrie_pf(), public.fn_ofertare_pf_acces_ofertare(), public.fn_ofertare_pf_inchide(bigint),
  public.fn_ofertare_pf_versiune_noua(bigint,text) TO authenticated; -- fără service_role (BYPASSRLS), ca în 20261010a r2
GRANT EXECUTE ON FUNCTION public.fn_poate_citi_pf(), public.fn_poate_scrie_pf(), public.fn_ofertare_pf_uid(), public.fn_ofertare_pf_acces_ofertare() TO ofertare_pf_executor;
-- Fără nimic pe schema auth (live: postgres nu are GRANT OPTION acolo); identitatea vine prin fn_ofertare_pf_uid().
GRANT USAGE ON SCHEMA public, extensions TO ofertare_pf_executor;
GRANT EXECUTE ON FUNCTION extensions.digest(text,text) TO ofertare_pf_executor;
-- GRANT fără GRANT OPTION dă doar WARNING; RPC-ul de închidere ar pica la rulare. Fail-closed aici.
DO $pf_executor_acces$
BEGIN
  IF NOT (has_schema_privilege('ofertare_pf_executor','extensions','USAGE')
      AND has_function_privilege('ofertare_pf_executor','extensions.digest(text,text)','EXECUTE')
      AND has_function_privilege('ofertare_pf_executor','public.fn_ofertare_pf_uid()','EXECUTE')) THEN
    RAISE EXCEPTION 'REFUZ: executorul PF nu poate folosi extensions.digest sau fn_ofertare_pf_uid (runnerul nu are GRANT OPTION pe extensions)';
  END IF;
  IF has_schema_privilege('ofertare_pf_executor','auth','USAGE') THEN
    RAISE EXCEPTION 'REFUZ: executorul PF nu trebuie să aibă USAGE pe schema auth';
  END IF;
END $pf_executor_acces$;
GRANT SELECT ON public.ofertare_formulare_registru TO ofertare_pf_executor;
-- Executorul citește registrul doar pentru un apelant cu drept PF ȘI acces general la Ofertare (P0.1).
CREATE POLICY pf_executor_registru_sel ON public.ofertare_formulare_registru FOR SELECT TO ofertare_pf_executor
  USING ((SELECT public.fn_poate_citi_pf()) AND (SELECT public.fn_ofertare_pf_acces_ofertare()));

ALTER TABLE public.ofertare_pf_pachete ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_pf_valori ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_pf_pachete, public.ofertare_pf_valori FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_pf_pachete, public.ofertare_pf_valori TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ofertare_pf_pachete TO ofertare_pf_executor;
GRANT SELECT, INSERT ON public.ofertare_pf_valori TO ofertare_pf_executor;
REVOKE ALL ON SEQUENCE public.ofertare_pf_pachete_id_seq, public.ofertare_pf_valori_id_seq FROM PUBLIC, anon, authenticated, service_role;
-- Identity GENERATED ALWAYS nu cere USAGE pe secvență: niciun drept în afara ownerului.
CREATE POLICY pf_pachete_sel ON public.ofertare_pf_pachete FOR SELECT TO authenticated, ofertare_pf_executor USING ((SELECT public.fn_poate_citi_pf()));
CREATE POLICY pf_pachete_ins ON public.ofertare_pf_pachete FOR INSERT TO authenticated, ofertare_pf_executor WITH CHECK ((SELECT public.fn_poate_scrie_pf()));
CREATE POLICY pf_pachete_upd ON public.ofertare_pf_pachete FOR UPDATE TO authenticated, ofertare_pf_executor USING ((SELECT public.fn_poate_scrie_pf())) WITH CHECK ((SELECT public.fn_poate_scrie_pf()));
CREATE POLICY pf_pachete_del ON public.ofertare_pf_pachete FOR DELETE TO authenticated, ofertare_pf_executor USING ((SELECT public.fn_poate_scrie_pf()));
CREATE POLICY pf_valori_sel ON public.ofertare_pf_valori FOR SELECT TO authenticated, ofertare_pf_executor USING ((SELECT public.fn_poate_citi_pf()));
CREATE POLICY pf_valori_ins ON public.ofertare_pf_valori FOR INSERT TO authenticated, ofertare_pf_executor WITH CHECK ((SELECT public.fn_poate_scrie_pf()));
CREATE POLICY pf_valori_upd ON public.ofertare_pf_valori FOR UPDATE TO authenticated, ofertare_pf_executor USING ((SELECT public.fn_poate_scrie_pf())) WITH CHECK ((SELECT public.fn_poate_scrie_pf()));
CREATE POLICY pf_valori_del ON public.ofertare_pf_valori FOR DELETE TO authenticated, ofertare_pf_executor USING ((SELECT public.fn_poate_scrie_pf()));

CREATE VIEW public.v_ofertare_pf_control WITH (security_invoker = on) AS
SELECT p.id AS pachet_id, a.id AS valoare_a_id, b.id AS valoare_b_id, a.rol_valoare, a.domeniu_valoric, a.participant, a.tva_inclus,
  a.valoare AS valoare_a, b.valoare AS valoare_b,
  CASE WHEN a.rol_valoare NOT IN ('cota','grafic_valoric') AND a.confirmat_de IS NOT NULL AND b.confirmat_de IS NOT NULL
    THEN a.valoare - b.valoare END AS diferenta,
  CASE WHEN b.id IS NULL OR a.rol_valoare IN ('cota','grafic_valoric') OR a.confirmat_de IS NULL OR b.confirmat_de IS NULL THEN 'neverificat'
    WHEN a.valoare = b.valoare THEN 'egal' ELSE 'diferenta' END AS verdict,
  -- Informativ (Q5, confirmat pe live 03.10): grafic_activitati.licitatie_id / proiect_id, SELECT pentru orice autentificat
  -- (grafic_act_sel: auth.uid() IS NOT NULL, pinuită în precondiții). Fără verdict pe sumă; PDF-ul de grafic nu are marcaj.
  CASE WHEN p.licitatie_id IS NOT NULL THEN EXISTS (SELECT 1 FROM public.grafic_activitati g WHERE g.licitatie_id = p.licitatie_id)
    ELSE EXISTS (SELECT 1 FROM public.grafic_activitati g WHERE g.proiect_id = p.proiect_id) END AS grafic_are_activitati,
  NULL::boolean AS grafic_pdf_in_manifest, 'neverificat'::text AS grafic_verdict
FROM public.ofertare_pf_pachete p
LEFT JOIN public.ofertare_pf_valori a ON a.pachet_id = p.id
LEFT JOIN public.ofertare_pf_valori b ON b.pachet_id = a.pachet_id AND b.id > a.id
  AND b.rol_valoare = a.rol_valoare AND b.domeniu_valoric = a.domeniu_valoric
  AND b.participant IS NOT DISTINCT FROM a.participant AND b.tva_inclus = a.tva_inclus
  AND (a.sursa_registru_id IS NOT NULL OR a.sursa_externa_cheie IS NOT NULL)
  AND (b.sursa_registru_id IS NOT NULL OR b.sursa_externa_cheie IS NOT NULL)
  AND (a.sursa_registru_id,a.sursa_externa_cheie) IS DISTINCT FROM (b.sursa_registru_id,b.sursa_externa_cheie)
WHERE public.fn_poate_citi_pf() AND (a.id IS NULL OR b.id IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM public.ofertare_pf_valori c WHERE c.pachet_id = a.pachet_id AND c.id <> a.id
    AND c.rol_valoare = a.rol_valoare AND c.domeniu_valoric = a.domeniu_valoric
    AND c.participant IS NOT DISTINCT FROM a.participant AND c.tva_inclus = a.tva_inclus
    AND (a.sursa_registru_id IS NOT NULL OR a.sursa_externa_cheie IS NOT NULL)
    AND (c.sursa_registru_id IS NOT NULL OR c.sursa_externa_cheie IS NOT NULL)
    AND (a.sursa_registru_id,a.sursa_externa_cheie) IS DISTINCT FROM (c.sursa_registru_id,c.sursa_externa_cheie)));
REVOKE ALL ON public.v_ofertare_pf_control FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_ofertare_pf_control TO authenticated;

-- Referință structurală independentă, comparată prin deparserul PostgreSQL.
CREATE TEMP VIEW pf_control_asteptat AS
SELECT p.id AS pachet_id, a.id AS valoare_a_id, b.id AS valoare_b_id, a.rol_valoare, a.domeniu_valoric, a.participant, a.tva_inclus,
  a.valoare AS valoare_a, b.valoare AS valoare_b,
  CASE WHEN a.rol_valoare NOT IN ('cota','grafic_valoric') AND a.confirmat_de IS NOT NULL AND b.confirmat_de IS NOT NULL
    THEN a.valoare - b.valoare END AS diferenta,
  CASE WHEN b.id IS NULL OR a.rol_valoare IN ('cota','grafic_valoric') OR a.confirmat_de IS NULL OR b.confirmat_de IS NULL THEN 'neverificat'
    WHEN a.valoare = b.valoare THEN 'egal' ELSE 'diferenta' END AS verdict,
  -- Informativ (Q5, confirmat pe live 03.10): grafic_activitati.licitatie_id / proiect_id, SELECT pentru orice autentificat
  -- (grafic_act_sel: auth.uid() IS NOT NULL, pinuită în precondiții). Fără verdict pe sumă; PDF-ul de grafic nu are marcaj.
  CASE WHEN p.licitatie_id IS NOT NULL THEN EXISTS (SELECT 1 FROM public.grafic_activitati g WHERE g.licitatie_id = p.licitatie_id)
    ELSE EXISTS (SELECT 1 FROM public.grafic_activitati g WHERE g.proiect_id = p.proiect_id) END AS grafic_are_activitati,
  NULL::boolean AS grafic_pdf_in_manifest, 'neverificat'::text AS grafic_verdict
FROM public.ofertare_pf_pachete p
LEFT JOIN public.ofertare_pf_valori a ON a.pachet_id = p.id
LEFT JOIN public.ofertare_pf_valori b ON b.pachet_id = a.pachet_id AND b.id > a.id
  AND b.rol_valoare = a.rol_valoare AND b.domeniu_valoric = a.domeniu_valoric
  AND b.participant IS NOT DISTINCT FROM a.participant AND b.tva_inclus = a.tva_inclus
  AND (a.sursa_registru_id IS NOT NULL OR a.sursa_externa_cheie IS NOT NULL)
  AND (b.sursa_registru_id IS NOT NULL OR b.sursa_externa_cheie IS NOT NULL)
  AND (a.sursa_registru_id,a.sursa_externa_cheie) IS DISTINCT FROM (b.sursa_registru_id,b.sursa_externa_cheie)
WHERE public.fn_poate_citi_pf() AND (a.id IS NULL OR b.id IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM public.ofertare_pf_valori c WHERE c.pachet_id = a.pachet_id AND c.id <> a.id
    AND c.rol_valoare = a.rol_valoare AND c.domeniu_valoric = a.domeniu_valoric
    AND c.participant IS NOT DISTINCT FROM a.participant AND c.tva_inclus = a.tva_inclus
    AND (a.sursa_registru_id IS NOT NULL OR a.sursa_externa_cheie IS NOT NULL)
    AND (c.sursa_registru_id IS NOT NULL OR c.sursa_externa_cheie IS NOT NULL)
    AND (a.sursa_registru_id,a.sursa_externa_cheie) IS DISTINCT FROM (c.sursa_registru_id,c.sursa_externa_cheie)));
-- POSTCONDITII_GENERATE: amprente prosrc calculate din textul livrat, nu din baza testată.
DO $post$
DECLARE r record; f record; c record; expected text; actual text;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261012a_ofertare_pf_pachete:' || txid_current() THEN
    RAISE EXCEPTION 'POST: garda runnerului s-a pierdut';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ofertare_pf_executor' AND NOT rolcanlogin AND NOT rolinherit
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = 'ofertare_pf_executor'::regrole AND member <> 'postgres'::regrole)
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = 'ofertare_pf_executor'::regrole)
     OR has_schema_privilege('ofertare_pf_executor','public','CREATE') THEN
    RAISE EXCEPTION 'POST: executorul nu este izolat';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('fn_poate_citi_pf()','postgres','sql',true,'s','boolean','1b62664126fcee2a0c36cf5df18710b2'),
    ('fn_ofertare_pf_acces_ofertare()','postgres','sql',true,'s','boolean','b551a0fa932e0677b5657325f77ad77e'),
    ('fn_ofertare_pf_uid()','postgres','sql',true,'s','uuid','412eea584efb77d7e81af77a14220051'),
    ('fn_poate_scrie_pf()','postgres','sql',true,'s','boolean','eefc0d2bb6faf04f00144bfa388a2417'),
    ('fn_ofertare_pf_pachet_garda()','postgres','plpgsql',false,'v','trigger','07598c3dcd8c542c8172ba0de31832e7'),
    ('fn_ofertare_pf_valoare_garda()','postgres','plpgsql',false,'v','trigger','3a0c1b863a021dc393f7f9297284207e'),
    ('fn_ofertare_pf_inchide(bigint)','ofertare_pf_executor','plpgsql',true,'v','bigint','3489c8e9c8fc59a02c960aabddaf0aca'),
    ('fn_ofertare_pf_versiune_noua(bigint,text)','ofertare_pf_executor','plpgsql',true,'v','bigint','041bf050c522858e061006e00da27a20')
  ) AS t(signature,owner_name,lang,secdef,vol,ret,hash) LOOP
    SELECT p.*, l.lanname INTO f FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.' || r.signature);
    IF NOT FOUND OR md5(f.prosrc) <> r.hash OR pg_get_userbyid(f.proowner) <> r.owner_name OR f.lanname <> r.lang
       OR f.prosecdef <> r.secdef OR f.provolatile::text <> r.vol OR f.prorettype <> r.ret::regtype OR f.proretset
       OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
      RAISE EXCEPTION 'POST: amprenta funcției % diferă', r.signature;
    END IF;
    expected := CASE WHEN r.ret = 'trigger' THEN 'postgres:EXECUTE:false'
      WHEN r.signature = 'fn_ofertare_pf_uid()' THEN 'ofertare_pf_executor:EXECUTE:false,postgres:EXECUTE:false'
      WHEN r.owner_name = 'ofertare_pf_executor' THEN 'authenticated:EXECUTE:false,ofertare_pf_executor:EXECUTE:false'
      ELSE 'authenticated:EXECUTE:false,ofertare_pf_executor:EXECUTE:false,postgres:EXECUTE:false' END;
    SELECT string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ',' ORDER BY a.grantee::regrole::text COLLATE "C") INTO actual
      FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a;
    IF actual IS DISTINCT FROM expected OR has_function_privilege('anon',f.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'POST: ACL funcție % diferă (%)', r.signature,actual;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE proowner = 'ofertare_pf_executor'::regrole) <> 2 THEN RAISE EXCEPTION 'POST: funcție executor neașteptată'; END IF;
  IF md5(pg_get_viewdef('public.v_ofertare_pf_control'::regclass)) IS DISTINCT FROM md5(pg_get_viewdef('pg_temp.pf_control_asteptat'::regclass)) THEN
    RAISE EXCEPTION 'POST: amprenta view-ului diferă';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('ofertare_pf_pachete','bffbcae1962c46702ff7b7eca5ef0e2e'),
    ('ofertare_pf_valori','b6b3eeed74b5239282c0cb28355a4120')
  ) AS t(tab,hash) LOOP
    SELECT md5(string_agg(attname || ':' || format_type(atttypid,atttypmod) || ':' || attnotnull::text || ':' || attidentity::text, ',' ORDER BY attnum)) INTO actual
      FROM pg_attribute WHERE attrelid = ('public.' || r.tab)::regclass AND attnum > 0 AND NOT attisdropped;
    IF actual IS DISTINCT FROM r.hash THEN RAISE EXCEPTION 'POST: amprenta coloanelor % diferă (%)',r.tab,actual; END IF;
  END LOOP;
  -- ACL EXACT (aclexplode), modelul 20261010a r2: în afara ownerului doar drepturile enumerate; secvențele identity
  -- fără niciun drept; fără PUBLIC, anon, service_role, grant option sau ACL pe coloane.
  FOR r IN SELECT * FROM (VALUES
    ('ofertare_pf_pachete','r','authenticated=DELETE,authenticated=INSERT,authenticated=SELECT,authenticated=UPDATE,ofertare_pf_executor=INSERT,ofertare_pf_executor=SELECT,ofertare_pf_executor=UPDATE'),
    ('ofertare_pf_valori','r','authenticated=DELETE,authenticated=INSERT,authenticated=SELECT,authenticated=UPDATE,ofertare_pf_executor=INSERT,ofertare_pf_executor=SELECT'),
    ('ofertare_pf_pachete_id_seq','S',''),
    ('ofertare_pf_valori_id_seq','S',''),
    ('v_ofertare_pf_control','v','authenticated=SELECT')
  ) AS t(obj,kind,acl) LOOP
    SELECT * INTO c FROM pg_class WHERE oid = to_regclass('public.' || r.obj);
    IF NOT FOUND OR c.relkind::text <> r.kind OR pg_get_userbyid(c.relowner) <> 'postgres' OR c.relacl IS NULL
      OR c.relkind = 'r' AND NOT c.relrowsecurity
      OR c.relkind = 'v' AND NOT coalesce('security_invoker=on' = ANY(c.reloptions),false) THEN
      RAISE EXCEPTION 'POST: owner/tip/RLS/view sau ACL implicit pe %',r.obj;
    END IF;
    SELECT coalesce(string_agg(coalesce(pg_get_userbyid(nullif(a.grantee,0)),'PUBLIC') || '=' || a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END,
             ',' ORDER BY coalesce(pg_get_userbyid(nullif(a.grantee,0)),'PUBLIC') COLLATE "C", a.privilege_type COLLATE "C"),'') INTO actual
      FROM aclexplode(c.relacl) a WHERE a.grantee <> c.relowner;
    IF actual IS DISTINCT FROM r.acl OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = c.oid AND attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'POST: ACL % nu este exact (%)',r.obj,actual;
    END IF;
    IF has_table_privilege('anon',c.oid,'SELECT') OR has_table_privilege('service_role',c.oid,'SELECT')
       OR c.relkind = 'S' AND (has_sequence_privilege('authenticated',c.oid,'USAGE') OR has_sequence_privilege('service_role',c.oid,'USAGE')
         OR has_sequence_privilege('anon',c.oid,'USAGE')) THEN
      RAISE EXCEPTION 'POST: drept efectiv neașteptat pe % (anon/service_role/secvență)',r.obj;
    END IF;
  END LOOP;
  -- Registrul: executorul are exact SELECT (recitirea metadatelor la închidere), fără grant option.
  SELECT coalesce(string_agg(a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END, ',' ORDER BY a.privilege_type COLLATE "C"),'') INTO actual
    FROM pg_class x, aclexplode(x.relacl) a WHERE x.oid = 'public.ofertare_formulare_registru'::regclass AND a.grantee = 'ofertare_pf_executor'::regrole;
  IF actual IS DISTINCT FROM 'SELECT' THEN RAISE EXCEPTION 'POST: ACL registru pentru executor nu este exact SELECT (%)',actual; END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid IN ('public.ofertare_pf_pachete'::regclass,'public.ofertare_pf_valori'::regclass)) <> 8 THEN
    RAISE EXCEPTION 'POST: număr politici PF diferit de 8';
  END IF;
  FOR r IN SELECT * FROM pg_policy WHERE polrelid IN ('public.ofertare_pf_pachete'::regclass,'public.ofertare_pf_valori'::regclass)
      OR polrelid = 'public.ofertare_formulare_registru'::regclass AND polname = 'pf_executor_registru_sel' LOOP
    expected := CASE WHEN r.polcmd = 'r' THEN 'fn_poate_citi_pf' ELSE 'fn_poate_scrie_pf' END;
    expected := 'SELECT' || expected || 'AS' || expected
      || CASE WHEN r.polname = 'pf_executor_registru_sel' THEN 'ANDSELECTfn_ofertare_pf_acces_ofertareASfn_ofertare_pf_acces_ofertare' ELSE '' END;
    IF NOT r.polpermissive OR r.polcmd NOT IN ('r','a','w','d')
      OR r.polroles @> ARRAY[0::oid] OR NOT ('ofertare_pf_executor'::regrole::oid = ANY(r.polroles))
      OR (r.polname <> 'pf_executor_registru_sel' AND (cardinality(r.polroles) <> 2 OR NOT ('authenticated'::regrole::oid = ANY(r.polroles))))
      OR (r.polname = 'pf_executor_registru_sel' AND cardinality(r.polroles) <> 1) THEN RAISE EXCEPTION 'POST: poartă politică %',r.polname; END IF;
    IF (r.polqual IS NULL) <> (r.polcmd = 'a') OR (r.polwithcheck IS NULL) <> (r.polcmd IN ('r','d')) THEN
      RAISE EXCEPTION 'POST: USING/WITH CHECK %',r.polname;
    END IF;
    FOR actual IN SELECT x FROM unnest(ARRAY[pg_get_expr(r.polqual,r.polrelid),pg_get_expr(r.polwithcheck,r.polrelid)]) x WHERE x IS NOT NULL LOOP
      actual := replace(regexp_replace(actual,'[[:space:]()]','','g'),'public.','');
      IF actual <> expected THEN RAISE EXCEPTION 'POST: expresie politică % diferă (%)',r.polname,actual; END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.ofertare_pf_pachete'::regclass,'public.ofertare_pf_valori'::regclass) AND NOT tgisinternal
      AND tgenabled = 'O' AND tgtype = 31 AND ((tgname = 'pf_pachet_garda' AND tgfoid = 'public.fn_ofertare_pf_pachet_garda()'::regprocedure)
      OR (tgname = 'pf_valoare_garda' AND tgfoid = 'public.fn_ofertare_pf_valoare_garda()'::regprocedure))) <> 2 THEN
    RAISE EXCEPTION 'POST: amprenta triggerelor diferă';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('pf_lic_draft','lucru'),('pf_pro_draft','lucru'),('pf_lic_curent','inchis'),('pf_pro_curent','inchis')) t(idx,stare) LOOP
    SELECT replace(regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[[:space:]()]','','g'),'::text','') INTO actual
      FROM pg_index i WHERE i.indexrelid = ('public.' || r.idx)::regclass AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 2;
    IF actual IS DISTINCT FROM 'stare=' || quote_literal(r.stare) THEN RAISE EXCEPTION 'POST: predicat index % diferă (%)',r.idx,actual; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_index WHERE indrelid = 'public.ofertare_pf_pachete'::regclass AND indisunique AND indisvalid) <> 7
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.ofertare_pf_pachete'::regclass AND contype = 'f') <> 3
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.ofertare_pf_valori'::regclass AND contype = 'f') <> 2 THEN
    RAISE EXCEPTION 'POST: indecși sau chei externe incomplete';
  END IF;
END $post$;

DROP VIEW pg_temp.pf_control_asteptat;

-- Garda finală ca ultimă instrucțiune (modelul 20261010a).
DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261012a_ofertare_pf_pachete:' || txid_current() THEN
    RAISE EXCEPTION 'REFUZ: garda de livrare (final) s-a pierdut' USING ERRCODE = '42501';
  END IF;
END $livrare_final$;
