-- Schelet LOCAL pentru 20261130l_redari_convocare_rezerva (PG17 de unica folosinta, creat si sters de scripts/redari_30l_dry_local.sh).
-- NU se ruleaza pe productie. Reproduce ce citeste / apeleaza 20261130l:
--   * rolurile Supabase (anon, authenticated, service_role, supabase_auth_admin, dashboard_user), schema auth cu auth.uid() exact ca pe live;
--   * tabelele atinse, cu coloanele, valorile implicite si CHECK-urile citite read-only pe live 04.11.2026 (doar coloanele folosite);
--   * functiile amprentate de migrare, cu textul EXACT de pe live (pg_get_functiondef, citit read-only 04.11.2026, UTF-8):
--     fn_red_nivel, fn_red_numar_document, fn_red_plic_garda_persoana, fn_red_plic_incearca_lock_detinator, fn_red_cheie_persoana,
--     fn_red_convocari_posta_garda, fn_red_legaturi, fn_red_jurnal;
--   * nivelul 3 (neamprentat de migrare) ca STUB-uri: fn_red_plic_uat_detinator, fn_red_plic_incearca_lock (fara lock), fn_red_cheie_calc
--     (cheie = nume|strada|sat|comuna|judet|cod daca adresa e cunoscuta) — suficient ca garda de plic sa poata refuza in TEST5;
--   * triggerele red_convocari / red_numere cu numele si tipurile de pe live; RLS activ, owner postgres, fara FORCE.
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN CREATE ROLE dashboard_user NOLOGIN; END IF;
END $r$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$f$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, supabase_auth_admin, dashboard_user;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $f$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, is_owner boolean NOT NULL DEFAULT false);
CREATE TABLE public.user_module_access (id bigserial PRIMARY KEY, profile_id uuid NOT NULL, module text NOT NULL, access_level text);
CREATE TABLE public.red_proiecte (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cod text NOT NULL, denumire text);
CREATE TABLE public.red_uat (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id), nume text NOT NULL, uat3 text NOT NULL);
CREATE TABLE public.red_parcele (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proiect_id uuid NOT NULL, uat_id uuid NOT NULL REFERENCES public.red_uat(id),
  id_parcela text NOT NULL, tronson integer, sters_la timestamptz);
CREATE TABLE public.red_detinatori (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parcela_id uuid NOT NULL REFERENCES public.red_parcele(id), nume text NOT NULL,
  nume_normalizat text NOT NULL, calitate text NOT NULL, sters_la timestamptz);
CREATE TABLE public.red_detinatori_contact (detinator_id uuid PRIMARY KEY REFERENCES public.red_detinatori(id), adresa_strada text, adresa_sat text, adresa_comuna text,
  adresa_judet text, cod_postal text, adresa_cunoscuta boolean);
CREATE TABLE public.red_plicuri (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uat_id uuid NOT NULL, nr_plic text, cheie_persoana text, stare text NOT NULL DEFAULT 'activ', data_expediere date);
CREATE TABLE public.red_convocari (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, detinator_id uuid NOT NULL REFERENCES public.red_detinatori(id), canal text NOT NULL, nr_document text UNIQUE,
  data_expediere date, nr_tracking text, data_confirmare_primire date, retur text, retur_data date, continut_hash text, fisier_convocator_path text,
  stare text NOT NULL DEFAULT 'activ'::text, motiv_anulare text, sters_la timestamptz, sters_de uuid, sters_motiv text, created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(), adresa_tgz_nr text, reluare boolean NOT NULL DEFAULT false, plic_id uuid REFERENCES public.red_plicuri(id), retur_detaliu text);
ALTER TABLE public.red_convocari ADD CONSTRAINT red_convocari_canal_check CHECK ((canal = ANY (ARRAY['posta'::text, 'sms'::text, 'email'::text, 'afisare'::text, 'telefon'::text])));
ALTER TABLE public.red_convocari ADD CONSTRAINT red_convocari_stare_check CHECK ((stare = ANY (ARRAY['activ'::text, 'anulat'::text])));
CREATE TABLE public.red_numere (cheie text PRIMARY KEY, ultimul integer NOT NULL DEFAULT 0);
CREATE TABLE public.red_jurnal (id bigserial PRIMARY KEY, tabela text, inregistrare_id uuid, actiune text, date_vechi jsonb, date_noi jsonb, user_id uuid, user_email text,
  created_at timestamptz DEFAULT now());

-- nivel 3: stub-uri (neamprentate de migrare)
CREATE FUNCTION public.fn_red_plic_uat_detinator(p_detinator uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p.uat_id FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id WHERE d.id = p_detinator $f$;
CREATE FUNCTION public.fn_red_plic_incearca_lock(p_uat uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN; END $f$;
CREATE FUNCTION public.fn_red_cheie_calc(p_nume text, p_strada text, p_sat text, p_comuna text, p_judet text, p_cod text, p_cunoscuta boolean) RETURNS text
  LANGUAGE sql IMMUTABLE AS $f$ SELECT CASE WHEN p_cunoscuta IS TRUE THEN concat_ws('|', p_nume, p_strada, p_sat, p_comuna, p_judet, p_cod) END $f$;

-- ===== functiile de pe live (text exact) =====
CREATE OR REPLACE FUNCTION public.fn_red_cheie_persoana(p_detinator uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.fn_red_cheie_calc(d.nume_normalizat, c.adresa_strada, c.adresa_sat, c.adresa_comuna, c.adresa_judet, c.cod_postal, c.adresa_cunoscuta)
  FROM public.red_detinatori d LEFT JOIN public.red_detinatori_contact c ON c.detinator_id = d.id
  WHERE d.id = p_detinator AND d.sters_la IS NULL;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_red_convocari_posta_garda()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user = 'postgres' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.plic_id IS NOT NULL OR (NEW.canal = 'posta' AND (NEW.data_expediere IS NOT NULL OR NEW.nr_tracking IS NOT NULL OR NEW.data_confirmare_primire IS NOT NULL
        OR NEW.retur IS NOT NULL OR NEW.retur_data IS NOT NULL OR NEW.retur_detaliu IS NOT NULL)) THEN
      RAISE EXCEPTION 'redari: evidenta postala se tine pe plic (Redari -> Posta)' USING ERRCODE = '23514';
    END IF;
    IF NEW.canal = 'posta' AND NEW.stare = 'activ' AND NEW.sters_la IS NULL THEN PERFORM public.fn_red_plic_garda_persoana(NEW.detinator_id); END IF;
    RETURN NEW;
  END IF;
  IF NEW.plic_id IS DISTINCT FROM OLD.plic_id THEN
    RAISE EXCEPTION 'redari: plicul unei convocari se schimba doar prin plic' USING ERRCODE = '23514';
  END IF;
  IF (OLD.canal = 'posta' OR NEW.canal = 'posta') AND (NEW.canal, NEW.data_expediere, NEW.nr_tracking, NEW.data_confirmare_primire, NEW.retur, NEW.retur_data, NEW.retur_detaliu)
       IS DISTINCT FROM (OLD.canal, OLD.data_expediere, OLD.nr_tracking, OLD.data_confirmare_primire, OLD.retur, OLD.retur_data, OLD.retur_detaliu) THEN
    RAISE EXCEPTION 'redari: evidenta postala se tine pe plic (Redari -> Posta)' USING ERRCODE = '23514';
  END IF;
  -- o convocare dintr-un plic activ nu se anuleaza direct (plicul ar ramane cu o convocare anulata inauntru)
  IF ((NEW.stare = 'anulat' AND OLD.stare <> 'anulat') OR (NEW.sters_la IS NOT NULL AND OLD.sters_la IS NULL)) AND OLD.plic_id IS NOT NULL   -- r1: si stergerea logica
     AND EXISTS (SELECT 1 FROM public.red_plicuri p WHERE p.id = OLD.plic_id AND p.stare = 'activ') THEN
    RAISE EXCEPTION 'redari: convocarea e intr-un plic activ; anuleaza intai plicul' USING ERRCODE = '23514';
  END IF;
  -- r2 P1: convocarea redevine eligibila pentru plic (reactivare / scoasa din stergere) -> aceeasi garda pe persoana
  IF NEW.canal = 'posta' AND NEW.stare = 'activ' AND NEW.sters_la IS NULL AND NEW.plic_id IS NULL
     AND NOT (OLD.canal = 'posta' AND OLD.stare = 'activ' AND OLD.sters_la IS NULL) THEN
    PERFORM public.fn_red_plic_garda_persoana(NEW.detinator_id);
  END IF;
  RETURN NEW;
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
CREATE OR REPLACE FUNCTION public.fn_red_numar_document(p_tip text, p_uat3 text, p_tronson integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cheie text; v_n int;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de numerotare' USING ERRCODE = '42501';
  END IF;
  CASE p_tip
    WHEN 'C' THEN v_cheie := 'C';
    WHEN 'AU' THEN v_cheie := 'AU';
    WHEN 'PVA', 'PVB' THEN
      IF p_uat3 IS NULL OR p_uat3 !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'redari: uat3 invalid (%)', p_uat3; END IF;
      v_cheie := p_tip || '-' || p_uat3;
    WHEN 'PVC' THEN
      IF p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 THEN RAISE EXCEPTION 'redari: tronson invalid (%)', p_tronson; END IF;
      v_cheie := 'PVC-T' || p_tronson;
    ELSE RAISE EXCEPTION 'redari: tip document necunoscut (%)', p_tip;
  END CASE;
  INSERT INTO public.red_numere (cheie, ultimul) VALUES (v_cheie, 1)
  ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul + 1
  RETURNING ultimul INTO v_n;
  IF v_n > 9999 THEN RAISE EXCEPTION 'redari: numerotarea pe % depaseste 9999', v_cheie; END IF;
  RETURN v_cheie || '-' || lpad(v_n::text, 4, '0');
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_red_plic_garda_persoana(p_detinator uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cheie text; v_uat uuid; v_nr text;
BEGIN
  -- Jakarinos r6: lock-ul UAT-ului ÎNAINTE de citirea identității, și când deținătorul e șters / fără adresă (cheia NULL)
  v_uat := public.fn_red_plic_incearca_lock_detinator(p_detinator);
  v_cheie := public.fn_red_cheie_persoana(p_detinator);
  IF v_cheie IS NULL OR v_uat IS NULL THEN RETURN; END IF;
  SELECT nr_plic INTO v_nr FROM public.red_plicuri WHERE uat_id = v_uat AND cheie_persoana = v_cheie AND stare = 'activ' AND data_expediere IS NULL LIMIT 1;
  IF v_nr IS NOT NULL THEN
    RAISE EXCEPTION 'redari: persoana are plicul neexpediat %; anuleaza-l si refa-l cu toate convocarile', v_nr USING ERRCODE = '23514';
  END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.fn_red_plic_incearca_lock_detinator(p_detinator uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uat uuid;
BEGIN
  v_uat := public.fn_red_plic_uat_detinator(p_detinator);
  PERFORM public.fn_red_plic_incearca_lock(v_uat);
  IF public.fn_red_plic_uat_detinator(p_detinator) IS DISTINCT FROM v_uat THEN
    RAISE EXCEPTION 'redari: deținătorul a fost mutat între timp; reîncercați' USING ERRCODE = '55P03';
  END IF;
  RETURN v_uat;
END $function$
;

-- ===== ACL, triggere, RLS ca pe live =====
REVOKE ALL ON FUNCTION public.fn_red_nivel() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_red_nivel() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_red_numar_document(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_red_numar_document(text, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_red_plic_garda_persoana(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_red_plic_garda_persoana(uuid) TO authenticated, service_role;
CREATE TRIGGER trg_red_convocari_posta_garda BEFORE INSERT OR UPDATE ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_red_convocari_posta_garda();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR DELETE OR UPDATE ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
CREATE TRIGGER trg_red_legaturi BEFORE INSERT OR UPDATE ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_red_legaturi();
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR DELETE OR UPDATE ON public.red_numere FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();
ALTER TABLE public.red_convocari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_detinatori ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_parcele ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_numere ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_uat ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.red_convocari, public.red_detinatori TO authenticated;
GRANT SELECT ON public.red_numere TO authenticated;
CREATE POLICY red_convocari_sel ON public.red_convocari FOR SELECT USING (( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL);
CREATE POLICY red_convocari_ins ON public.red_convocari FOR INSERT WITH CHECK (( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY['admin'::text, 'editor'::text]));
CREATE POLICY red_numere_sel ON public.red_numere FOR SELECT USING (( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL);
