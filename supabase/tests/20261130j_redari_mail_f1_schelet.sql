-- Schelet LOCAL (PG17 de unică folosință) pentru 20261130j / 20261130k (Redări e-mail F1, schema). NU se rulează pe producție.
-- Reproduce DOAR ce ating / citesc cele două migrări, cu amprentele exacte de pe live (citite read-only 04.11.2026):
--   * rolurile anon / authenticated / service_role (BYPASSRLS) / supabase_auth_admin / dashboard_user / supabase_storage_admin;
--   * auth.uid() / auth.jwt() / auth.role() — textul live (pg_get_functiondef), owner supabase_auth_admin, ACL-ul live;
--   * profiles, app_modules, user_module_access; fn_red_nivel, fn_red_jurnal, fn_red_jurnal_imuabil, fn_red_legaturi, fn_red_raspunsuri_valideaza,
--     fn_red_versiune_creste, fn_red_storage_expr_bucket, fn_red_storage_verifica_redari — corpurile live (md5(prosrc) identic) și ACL-urile live;
--   * red_proiecte / red_uat / red_parcele / red_detinatori / red_detinatori_contact / red_raspunsuri / red_jurnal (coloanele folosite, triggerele
--     Redări de pe red_raspunsuri / red_proiecte / red_jurnal exact ca pe live, politicile și privilegiile pe coloană ale red_raspunsuri ca pe live);
--   * red_corespondenta / red_corespondenta_fisiere minimale (ținta FK-ului și a politicii storage a vieweri-lor);
--   * storage.buckets / storage.objects / storage.foldername (live) + cele 3 politici red_storage_* exacte + o politică permisivă a altui bucket
--     + o politică restrictivă neîncadrată pe bucket (ca izo_*), ca verificatorul să vadă aceeași formă ca pe live;
--   * fixture: owner (a1), admin redari (a2), editor (a3), viewer (a4), fără acces (a5); un proiect, un UAT, 2 parcele, 3 deținători.
-- Ordinea: A (roluri, scheme, profiles) → funcțiile live → B (tabele, triggere, politici, storage, fixture).
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN CREATE ROLE dashboard_user NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin NOLOGIN; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA supabase_migrations;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- privilegiile implicite periculoase ale platformei (ALL pe tabele / secvențe noi, EXECUTE pe funcții noi) — migrarea trebuie să le revoce
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, is_owner boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.app_modules (key text PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.user_module_access (
  id serial PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id), module text NOT NULL REFERENCES public.app_modules(key),
  access_level text NOT NULL CHECK (access_level IN ('admin', 'editor', 'viewer')), UNIQUE (profile_id, module));
ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
-- ---------------------------------------------------------------- funcțiile live (pg_get_functiondef, citit read-only 04.11.2026)
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$
;

CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$
;

CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
;

CREATE OR REPLACE FUNCTION public.fn_red_jurnal_imuabil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'red_jurnal este append-only (% refuzat)', TG_OP USING ERRCODE = '42501';
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_red_jurnal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vechi jsonb; v_noi jsonb; v_id uuid; v_hash_noi jsonb; v_hash_vechi jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_vechi := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_noi := to_jsonb(NEW); END IF;
  -- actualizările care schimbă doar updated_at nu se jurnalizează
  IF TG_OP = 'UPDATE' AND (v_vechi - 'updated_at') = (v_noi - 'updated_at') THEN
    RETURN NULL;
  END IF;
  -- mascare: valoarea (admin) nu intră în jurnal — doar faptul că e setată
  IF TG_TABLE_NAME = 'red_parcele' THEN
    IF v_vechi IS NOT NULL THEN v_vechi := (v_vechi - 'valoare_lei') || jsonb_build_object('valoare_lei_setata', (v_vechi ->> 'valoare_lei') IS NOT NULL); END IF;
    IF v_noi IS NOT NULL THEN v_noi := (v_noi - 'valoare_lei') || jsonb_build_object('valoare_lei_setata', (v_noi ->> 'valoare_lei') IS NOT NULL); END IF;
  -- PII: pe contact / meta jurnalul primește DOAR numele câmpurilor schimbate („modificat”), niciodată valorile și nici hash-uri (reversibile prin dicționar)
  ELSIF TG_TABLE_NAME IN ('red_detinatori_contact', 'red_raspunsuri_meta') THEN
    SELECT jsonb_object_agg(e.k, 'modificat') INTO v_hash_noi
      FROM jsonb_each_text(coalesce(v_noi, '{}'::jsonb) - 'updated_at' - 'detinator_id' - 'raspuns_id') e(k, v)
     WHERE e.v IS NOT NULL AND (v_vechi IS NULL OR (v_vechi ->> e.k) IS DISTINCT FROM e.v);
    SELECT jsonb_object_agg(e.k, 'modificat') INTO v_hash_vechi
      FROM jsonb_each_text(coalesce(v_vechi, '{}'::jsonb) - 'updated_at' - 'detinator_id' - 'raspuns_id') e(k, v)
     WHERE e.v IS NOT NULL AND (v_noi IS NULL OR (v_noi ->> e.k) IS DISTINCT FROM e.v);
    v_noi := CASE WHEN v_noi IS NULL THEN NULL ELSE coalesce(v_hash_noi, '{}'::jsonb) END;
    v_vechi := CASE WHEN v_vechi IS NULL THEN NULL ELSE coalesce(v_hash_vechi, '{}'::jsonb) END;
  END IF;
  v_id := coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id', to_jsonb(NEW) ->> 'detinator_id', to_jsonb(OLD) ->> 'detinator_id',
                   to_jsonb(NEW) ->> 'raspuns_id', to_jsonb(OLD) ->> 'raspuns_id')::uuid;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id, user_email)
  VALUES (TG_TABLE_NAME, v_id, lower(TG_OP), v_vechi, v_noi, auth.uid(), auth.jwt() ->> 'email');
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_red_legaturi()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      -- Copilot f8a r1 P1-01: tronsonul se schimba DOAR de admin (direct sau prin fn_red_seteaza_tronson);
      -- Copilot f8a r2 P3-01: scutit doar contextul de mentenanta (fara JWT de aplicatie: postgres / service_role);
      -- o cerere anon/authenticated fara sub NU e mentenanta (auth.role() citeste claim-ul, nu current_user - triggerul e SECURITY DEFINER).
      IF (auth.uid() IS NOT NULL OR coalesce(auth.role(),'') IN ('anon','authenticated')) AND public.fn_red_nivel() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'redari: tronsonul il schimba doar administratorul' USING ERRCODE='42501';
      END IF;
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
      -- Copilot f8a r2 P2: un PV A/B neanulat care poarta deja un tronson ramane coerent cu parcela (documentul emis nu se rescrie).
      -- Generat/trimis: se anuleaza intai; semnat: inghetat (20261129c), deci tronsonul parcelei ramane definitiv. PV A/B emis fara tronson (NULL) nu afirma niciun tronson: atribuirea initiala e permisa.
      -- PV-ul nou blocheaza parcela FOR UPDATE inainte de INSERT; aici randul parcelei e deja blocat de UPDATE -> se vede PV-ul comis.
      IF EXISTS (SELECT 1 FROM public.red_procese_verbale v
        WHERE v.parcela_id=(to_jsonb(NEW) ->> 'id')::uuid AND v.tip IN ('A','B') AND v.stare<>'anulat' AND v.sters_la IS NULL
          AND v.tronson IS NOT NULL AND v.tronson IS DISTINCT FROM (to_jsonb(NEW) ->> 'tronson')::int) THEN
        RAISE EXCEPTION 'redari: parcela % are PV A/B emis pe alt tronson (semnat = definitiv; generat/trimis se anuleaza intai)', to_jsonb(NEW) ->> 'id_parcela' USING ERRCODE='23514';
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
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_red_nivel()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner) THEN 'admin'
    ELSE (SELECT uma.access_level FROM public.user_module_access uma WHERE uma.profile_id = auth.uid() AND uma.module = 'redari')
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_red_raspunsuri_valideaza()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_ob text := nullif(btrim(coalesce(NEW.obiectii_text, '')), '');
BEGIN
  -- created_at = momentul recepției: pus de trigger la INSERT (clientul nu are privilegiu pe coloană), imutabil la UPDATE;
  -- `data` = momentul declarat (editabil de operator) — „ultimul răspuns” = data DESC, seq DESC
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
    -- la UPDATE verificările rulează doar când se schimbă conținutul răspunsului
    IF NEW.canal IS NOT DISTINCT FROM OLD.canal AND NEW.optiune IS NOT DISTINCT FROM OLD.optiune AND NEW.zi_sesiune_aleasa IS NOT DISTINCT FROM OLD.zi_sesiune_aleasa
       AND NEW.obiectii_text IS NOT DISTINCT FROM OLD.obiectii_text AND NEW.declaratie_confirmata IS NOT DISTINCT FROM OLD.declaratie_confirmata THEN
      RETURN NEW;
    END IF;
  END IF;
  IF length(coalesce(NEW.obiectii_text, '')) > 4000 THEN RAISE EXCEPTION 'redari: obiectii_text peste 4000 de caractere' USING ERRCODE = '23514'; END IF;
  -- aceleași reguli ca în RPC-ul public, și pentru operatori (telefon / scris / sesiune); RPC-ul își păstrează mesajele jsonb înaintea insertului
  IF NEW.optiune = 'particip' THEN
    IF NEW.zi_sesiune_aleasa IS NULL THEN RAISE EXCEPTION 'redari: particip cere zi_sesiune_aleasa' USING ERRCODE = '23514'; END IF;
    -- apartenența la sesiunile CURENTE ale UAT-ului: la INSERT, când se schimbă ziua și când opțiunea DEVINE particip (sesiunile se pot muta ulterior)
    IF TG_OP = 'INSERT' OR NEW.zi_sesiune_aleasa IS DISTINCT FROM OLD.zi_sesiune_aleasa OR OLD.optiune IS DISTINCT FROM 'particip' THEN
      SELECT u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3 INTO r
        FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id JOIN public.red_uat u ON u.id = p.uat_id
       WHERE d.id = NEW.detinator_id;
      IF NEW.zi_sesiune_aleasa IS DISTINCT FROM r.sesiune_zi1 AND NEW.zi_sesiune_aleasa IS DISTINCT FROM r.sesiune_zi2
         AND NEW.zi_sesiune_aleasa IS DISTINCT FROM r.sesiune_zi3 THEN
        RAISE EXCEPTION 'redari: particip cere zi_sesiune_aleasa = una din zilele de sesiune ale UAT-ului' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.optiune IN ('nu_particip_cu_obiectii', 'constatare_teren') THEN
    IF v_ob IS NULL THEN RAISE EXCEPTION 'redari: % cere obiectii_text nevid', NEW.optiune USING ERRCODE = '23514'; END IF;
  ELSIF NEW.optiune = 'nu_particip_fara_obiectii' AND NEW.canal = 'online' AND NEW.declaratie_confirmata IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'redari: nu_particip_fara_obiectii online cere declaratie_confirmata = true' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_red_storage_expr_bucket(p_expr text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  m text[]; v_adanc int; v_rest text; i int; c text; v_ghilimea boolean := false; n int; v_is_true boolean := false;
BEGIN
  -- Bucket-ul la care e legată o expresie de politică storage, DOAR dacă legarea e sigură: expresia începe cu (bucket_id = 'x'::text) ca prim
  -- operand al unui AND de nivel superior și nu există niciun OR la nivelul acelui AND sau mai sus (parantezele sunt numărate, literalele sărite).
  -- Altfel NULL (= nu se poate garanta că politica nu acoperă alt bucket). Deparse-ul PostgreSQL pune paranteze la orice OR/AND imbricat.
  IF p_expr IS NULL THEN RETURN NULL; END IF;
  m := regexp_match(btrim(p_expr), '^([(]*)bucket_id = ''([^'']+)''::text([)]*)(.*)$');
  IF m IS NULL THEN RETURN NULL; END IF;
  v_adanc := length(m[1]) - length(m[3]);
  v_rest := m[4];
  IF v_adanc < 0 THEN RETURN NULL; END IF;
  IF v_rest = '' THEN RETURN CASE WHEN v_adanc = 0 THEN m[2] END; END IF;
  -- forma ((bucket_id = 'x'::text) IS TRUE): singurul sufix acceptat, exact o dată, apoi doar parantezele de închidere
  IF v_adanc >= 1 AND v_rest ~ ('^ IS TRUE[)]{' || v_adanc || '}$') THEN RETURN m[2]; END IF;
  IF v_rest NOT LIKE ' AND %' THEN RETURN NULL; END IF;
  -- grupul AND al bucket-ului trebuie să fie între paranteze (deparse-ul le pune mereu) și expresia să se TERMINE exact la închiderea lui:
  -- după ce adâncimea coboară sub cea a grupului, mai pot urma doar „ IS TRUE” (o singură dată, imediat după grup) și parantezele de închidere
  -- ale învelișurilor (fără IS FALSE / IS NOT TRUE / IS NULL / OR / ::)
  IF v_adanc < 1 THEN RETURN NULL; END IF;
  n := length(v_rest); i := 1;
  WHILE i <= n LOOP
    c := substr(v_rest, i, 1);
    IF v_ghilimea THEN
      IF c = '''' THEN v_ghilimea := false; END IF;
    ELSIF v_adanc < length(m[1]) - length(m[3]) THEN
      IF c = ' ' AND substr(v_rest, i, 8) = ' IS TRUE' AND NOT v_is_true AND substr(v_rest, i - 1, 1) = ')' THEN
        v_is_true := true; i := i + 8; CONTINUE;
      END IF;
      IF c <> ')' THEN RETURN NULL; END IF;
      v_adanc := v_adanc - 1; IF v_adanc < 0 THEN RETURN NULL; END IF;
    ELSIF c = '''' THEN v_ghilimea := true;
    ELSIF c = '(' THEN v_adanc := v_adanc + 1;
    ELSIF c = ')' THEN v_adanc := v_adanc - 1;
    ELSIF c = ' ' AND substr(v_rest, i, 4) = ' OR ' AND v_adanc <= length(m[1]) - length(m[3]) THEN RETURN NULL;
    END IF;
    i := i + 1;
  END LOOP;
  IF v_adanc <> 0 OR v_ghilimea THEN RETURN NULL; END IF;
  RETURN m[2];
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_red_versiune_creste()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.versiune := OLD.versiune + 1;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_red_storage_verifica_redari(p_cu_viewer boolean)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_pred constant text := '((bucket_id = ''redari''::text) AND (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text])))';
        -- r3 (J-P2-3 / C-P2-04): predicatul viewer, deparsat de PostgreSQL 17 cu search_path = public, pg_temp, cu spatiile albe normalizate
        v_pred_viewer constant text := '((bucket_id = ''redari''::text) AND ((storage.foldername(name))[2] = ''corespondenta''::text) AND (fn_red_nivel() = ''viewer''::text) '
                                       'AND (EXISTS ( SELECT 1 FROM red_corespondenta_fisiere f WHERE (f.path = objects.name))))';
        v_expuse text[]; v_asteptate integer := CASE WHEN p_cu_viewer THEN 3 ELSE 2 END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'redari' AND public IS FALSE) THEN
    RAISE EXCEPTION 'redari storage: bucket-ul redari lipseste sau e public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_sel' AND cmd = 'SELECT'
                  AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND qual = v_pred)
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_ins' AND cmd = 'INSERT'
                  AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND with_check = v_pred) THEN
    RAISE EXCEPTION 'redari storage: red_storage_sel / red_storage_ins nu mai au predicatul admin/editor din 20261126a';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'red\_storage\_%') <> v_asteptate
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'red\_%' AND cmd NOT IN ('SELECT', 'INSERT'))
     OR (p_cu_viewer AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'red_storage_coresp_sel'
           AND cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']::name[] AND with_check IS NULL
           AND btrim(regexp_replace(qual, '\s+', ' ', 'g')) = v_pred_viewer)) THEN
    RAISE EXCEPTION 'redari storage: politicile red_storage_* nu sunt cele asteptate';
  END IF;
  SELECT array_agg(p.policyname::text ORDER BY p.policyname) INTO v_expuse
    FROM pg_policies p
   WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.permissive = 'PERMISSIVE' AND p.policyname NOT LIKE 'red\_storage\_%'
     AND ((p.cmd IN ('SELECT', 'DELETE', 'UPDATE', 'ALL') AND p.qual IS NULL) OR (p.cmd = 'INSERT' AND p.with_check IS NULL)
          OR EXISTS (SELECT 1 FROM unnest(ARRAY[p.qual, p.with_check]) e
                      WHERE e IS NOT NULL AND coalesce(public.fn_red_storage_expr_bucket(e), 'redari') = 'redari'));
  IF v_expuse IS NOT NULL THEN
    RAISE EXCEPTION 'redari storage: politici storage.objects care ar putea acoperi bucket-ul redari (nelegate sigur de alt bucket): %', v_expuse;
  END IF;
END $function$
;

-- ---------------------------------------------------------------- ACL-urile / owner-ii live ai funcțiilor
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
REVOKE ALL ON FUNCTION auth.uid(), auth.jwt(), auth.role() FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role() TO PUBLIC, supabase_auth_admin, dashboard_user;
REVOKE ALL ON FUNCTION public.fn_red_nivel() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_red_jurnal(), public.fn_red_jurnal_imuabil(), public.fn_red_legaturi(), public.fn_red_raspunsuri_valideaza(),
  public.fn_red_storage_expr_bucket(text), public.fn_red_storage_verifica_redari(boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_red_versiune_creste() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_versiune_creste() TO service_role;
-- ---------------------------------------------------------------- tabelele Redări (coloanele folosite; red_raspunsuri / red_jurnal exact)
CREATE TABLE public.red_proiecte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cod text NOT NULL UNIQUE, denumire text, activ boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), versiune integer NOT NULL DEFAULT 1);
CREATE TABLE public.red_uat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), nume text NOT NULL, uat3 text NOT NULL,
  sesiune_zi1 date, sesiune_zi2 date, sesiune_zi3 date, versiune integer NOT NULL DEFAULT 1);
CREATE TABLE public.red_parcele (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), uat_id uuid NOT NULL REFERENCES public.red_uat(id),
  id_parcela text NOT NULL, tronson integer, sters_la timestamptz);
CREATE TABLE public.red_detinatori (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parcela_id uuid NOT NULL REFERENCES public.red_parcele(id), nume text NOT NULL, nume_normalizat text NOT NULL,
  calitate text NOT NULL, sters_la timestamptz);
CREATE TABLE public.red_detinatori_contact (
  detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id), telefon text, email text, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.red_raspunsuri (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  seq bigint NOT NULL GENERATED ALWAYS AS IDENTITY CONSTRAINT red_raspunsuri_seq_key UNIQUE,
  detinator_id uuid NOT NULL CONSTRAINT red_raspunsuri_detinator_id_fkey REFERENCES public.red_detinatori(id),
  canal text NOT NULL,
  data timestamp with time zone DEFAULT now() NOT NULL,
  optiune text NOT NULL,
  zi_sesiune_aleasa date,
  obiectii_text text,
  declaratie_confirmata boolean,
  semnatura_electronica_ref text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT red_raspunsuri_canal_check CHECK ((canal = ANY (ARRAY['online'::text, 'telefon'::text, 'scris'::text, 'sesiune'::text, 'email'::text, 'sms'::text]))),
  CONSTRAINT red_raspunsuri_optiune_check CHECK ((optiune = ANY (ARRAY['particip'::text, 'nu_particip_fara_obiectii'::text, 'nu_particip_cu_obiectii'::text, 'constatare_teren'::text])))
);
CREATE TABLE public.red_jurnal (
  id bigserial PRIMARY KEY, tabela text NOT NULL, inregistrare_id uuid, actiune text NOT NULL, date_vechi jsonb, date_noi jsonb, user_id uuid, user_email text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT red_jurnal_actiune_check CHECK ((actiune = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))));
CREATE TABLE public.red_corespondenta (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id));
CREATE TABLE public.red_corespondenta_fisiere (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), corespondenta_id uuid NOT NULL REFERENCES public.red_corespondenta(id), path text NOT NULL UNIQUE);
DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['red_proiecte', 'red_uat', 'red_parcele', 'red_detinatori', 'red_detinatori_contact', 'red_raspunsuri', 'red_jurnal', 'red_corespondenta', 'red_corespondenta_fisiere'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $t$;
-- triggerele live: red_raspunsuri (jurnal, legaturi, valideaza), red_proiecte (jurnal, versiune), red_jurnal (append-only)
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR DELETE OR UPDATE ON public.red_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_legaturi BEFORE INSERT OR UPDATE ON public.red_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_legaturi();
CREATE TRIGGER trg_red_raspunsuri_valideaza BEFORE INSERT OR UPDATE ON public.red_raspunsuri FOR EACH ROW EXECUTE FUNCTION public.fn_red_raspunsuri_valideaza();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR DELETE OR UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_versiune BEFORE UPDATE ON public.red_proiecte FOR EACH ROW EXECUTE FUNCTION public.fn_red_versiune_creste();
CREATE TRIGGER trg_red_jurnal_fara_truncate BEFORE TRUNCATE ON public.red_jurnal FOR EACH STATEMENT EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
CREATE TRIGGER trg_red_jurnal_imuabil BEFORE DELETE OR UPDATE ON public.red_jurnal FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal_imuabil();
-- politicile și privilegiile live
CREATE POLICY red_proiecte_ins ON public.red_proiecte FOR INSERT TO authenticated WITH CHECK ((( SELECT public.fn_red_nivel() AS fn_red_nivel) = 'admin'::text));
CREATE POLICY red_proiecte_sel ON public.red_proiecte FOR SELECT TO authenticated USING ((( SELECT public.fn_red_nivel() AS fn_red_nivel) IS NOT NULL));
CREATE POLICY red_proiecte_upd ON public.red_proiecte FOR UPDATE TO authenticated USING ((( SELECT public.fn_red_nivel() AS fn_red_nivel) = 'admin'::text)) WITH CHECK ((( SELECT public.fn_red_nivel() AS fn_red_nivel) = 'admin'::text));
CREATE POLICY red_detinatori_sel ON public.red_detinatori FOR SELECT TO authenticated USING ((( SELECT public.fn_red_nivel() AS fn_red_nivel) IS NOT NULL));
CREATE POLICY red_parcele_sel ON public.red_parcele FOR SELECT TO authenticated USING ((( SELECT public.fn_red_nivel() AS fn_red_nivel) IS NOT NULL));
CREATE POLICY red_raspunsuri_ins ON public.red_raspunsuri FOR INSERT TO authenticated WITH CHECK ((( SELECT public.fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY['admin'::text, 'editor'::text])));
CREATE POLICY red_raspunsuri_sel ON public.red_raspunsuri FOR SELECT TO authenticated USING ((( SELECT public.fn_red_nivel() AS fn_red_nivel) IS NOT NULL));
CREATE POLICY red_raspunsuri_upd ON public.red_raspunsuri FOR UPDATE TO authenticated USING ((( SELECT public.fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY['admin'::text, 'editor'::text]))) WITH CHECK ((( SELECT public.fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY['admin'::text, 'editor'::text])));
CREATE POLICY red_jurnal_sel ON public.red_jurnal FOR SELECT TO authenticated USING (((( SELECT public.fn_red_nivel() AS fn_red_nivel) IS NOT NULL) AND ((tabela <> ALL (ARRAY['red_detinatori_contact'::text, 'red_raspunsuri_meta'::text])) OR (( SELECT public.fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY['admin'::text, 'editor'::text])))));
GRANT SELECT, INSERT, UPDATE ON public.red_proiecte, public.red_detinatori, public.red_detinatori_contact TO authenticated, service_role;
GRANT SELECT ON public.red_parcele, public.red_uat, public.red_corespondenta, public.red_corespondenta_fisiere TO authenticated;
CREATE POLICY red_corespondenta_fisiere_sel ON public.red_corespondenta_fisiere FOR SELECT TO authenticated USING ((( SELECT public.fn_red_nivel() AS fn_red_nivel) IS NOT NULL));
GRANT SELECT ON public.red_jurnal TO authenticated, service_role;
GRANT SELECT ON public.red_raspunsuri TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.red_raspunsuri TO service_role;
GRANT INSERT (id, detinator_id, created_by) ON public.red_raspunsuri TO authenticated;
GRANT INSERT (canal, data, optiune, zi_sesiune_aleasa, obiectii_text, declaratie_confirmata, semnatura_electronica_ref),
      UPDATE (canal, data, optiune, zi_sesiune_aleasa, obiectii_text, declaratie_confirmata, semnatura_electronica_ref) ON public.red_raspunsuri TO authenticated;
GRANT USAGE ON SEQUENCE public.red_raspunsuri_seq_seq TO authenticated, service_role;
-- ---------------------------------------------------------------- Storage (forma live: owner supabase_storage_admin, politici, privilegii)
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb,
  created_at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;
ALTER FUNCTION storage.foldername(text) OWNER TO supabase_storage_admin;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
GRANT ALL ON storage.objects, storage.buckets TO service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated;
INSERT INTO storage.buckets (id, name, public) VALUES ('redari', 'redari', false), ('documente-flota', 'documente-flota', false), ('tts-audio', 'tts-audio', false);
CREATE POLICY red_storage_sel ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'redari'::text) AND (public.fn_red_nivel() = ANY (ARRAY['admin'::text, 'editor'::text]))));
CREATE POLICY red_storage_ins ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'redari'::text) AND (public.fn_red_nivel() = ANY (ARRAY['admin'::text, 'editor'::text]))));
CREATE POLICY red_storage_coresp_sel ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'redari'::text) AND ((storage.foldername(name))[2] = 'corespondenta'::text)
  AND (public.fn_red_nivel() = 'viewer'::text) AND (EXISTS ( SELECT 1 FROM public.red_corespondenta_fisiere f WHERE (f.path = objects.name)))));
CREATE POLICY "Authenticated can read documente-flota" ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'documente-flota'::text));
CREATE POLICY tts_audio_inchis ON storage.objects AS RESTRICTIVE FOR ALL TO public USING ((bucket_id IS DISTINCT FROM 'tts-audio'::text)) WITH CHECK ((bucket_id IS DISTINCT FROM 'tts-audio'::text));
GRANT USAGE ON SCHEMA storage TO supabase_storage_admin;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
-- ---------------------------------------------------------------- fixture (fictiv)
INSERT INTO public.app_modules (key, name) VALUES ('redari', 'Redari');
INSERT INTO public.profiles (id, email, name, is_owner) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner@exemplu.local', 'OWNER TEST', true),
  ('00000000-0000-0000-0000-0000000000a2', 'admin@exemplu.local', 'ADMIN TEST', false),
  ('00000000-0000-0000-0000-0000000000a3', 'editor@exemplu.local', 'EDITOR TEST', false),
  ('00000000-0000-0000-0000-0000000000a4', 'viewer@exemplu.local', 'VIEWER TEST', false),
  ('00000000-0000-0000-0000-0000000000a5', 'fara@exemplu.local', 'FARA ACCES', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'redari', 'admin'), ('00000000-0000-0000-0000-0000000000a3', 'redari', 'editor'),
  ('00000000-0000-0000-0000-0000000000a4', 'redari', 'viewer');
INSERT INTO public.red_proiecte (id, cod, denumire) VALUES ('00000000-0000-0000-0000-00000000b001', 'TEST-MAIL', 'Proiect test mail');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1) VALUES ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', 'Test', 'TST', DATE '2026-12-01');
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001', 'TST-0001'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001', 'TST-0002');
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate) VALUES
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000d001', 'TEST UNU', 'TEST UNU', 'proprietar'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000d001', 'TEST DOI', 'TEST DOI', 'coproprietar'),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-00000000d002', 'TEST TREI', 'TEST TREI', 'proprietar');
INSERT INTO public.red_corespondenta (id, proiect_id) VALUES ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000b001');
-- un răspuns preexistent (telefon) — trebuie să rămână editabil ca azi după 20261130k
INSERT INTO public.red_raspunsuri (id, detinator_id, canal, data, optiune) VALUES
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-00000000e003', 'telefon', now() - interval '2 days', 'nu_particip_fara_obiectii');
-- un obiect existent în bucketul redari (în afara mail/), ca politicile să aibă ce filtra
INSERT INTO storage.objects (bucket_id, name) VALUES ('redari', '00000000-0000-0000-0000-00000000b001/convocari/c1.pdf');
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
