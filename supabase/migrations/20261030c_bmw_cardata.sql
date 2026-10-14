-- ============================================================================
-- 20261030c — BMW CarData: citiri zilnice (kilometraj, combustibil, autonomii, SoC) pentru X5 xDrive45e, APPEND-ONLY.
-- Cerere Răzvan 14.10.2026 (tichetul „integrare BMW CarData”). Scrie DOAR scriptul local scripts/bmw_cardata (rol postgres,
-- prin pooler + pgpass, pornit de Task Scheduler); nicio scriere din aplicație (anon/authenticated nu au INSERT/UPDATE/DELETE).
--
-- Ce creează:
--   1. public.bmw_cardata_citiri — un rând per citire REST: odometru (obligatoriu, cu momentul transmis de mașină),
--      combustibil % / litri, autonomie termică / electrică / totală, SoC baterie HV, contoarele OBFCM (combustibil total pe
--      viață + distanța de referință), raspuns_brut = DOAR cheile non-locație din lista scriptului (CHECK: niciun text de
--      locație în el). id_citire = cheia de idempotență a scriptului (reluarea unei scrieri nu dublează).
--   2. public.bmw_cardata_locatii — poziția (lat/lon/heading) SEPARAT, 1:1 cu citirea. Decizia Răzvan 14.10: mașina e a lui
--      și o conduce el ⇒ locația se ia, dar o vede DOAR owner-ul (RLS), iar service_role nu are niciun drept pe ea.
--   3. Append-only: triggere BEFORE UPDATE / DELETE / TRUNCATE care refuză pe ambele tabele (și pentru postgres).
--      Validare BEFORE INSERT: momentele nu pot fi în viitor (> now() + 10 min); importat_la = now() pus de BD;
--      citit_la al locației = citit_la al citirii.
--   4. RLS: citiri → SELECT pentru owner + cine are modulul 'logistica' în user_module_access (orice nivel);
--      locatii → SELECT doar owner (profiles.is_owner). Funcțiile de acces: SECURITY DEFINER, EXECUTE doar authenticated.
--   5. public.v_bmw_cardata_vs_evogps (security_invoker): km BMW pe zi (ziua = data transmiterii odometrului, Europe/Bucharest)
--      vs km Evo GPS din logistica_telemetrie_zilnica (sursa 'evogps'), legat prin VIN = logistica_active.serie_sasiu.
--      Fără coloane de locație. Comparația e pe INTERVAL (între două zile cu citire BMW), nu pe odometrul absolut: Evo își
--      ține propriul contor. Verificat live 14.10.2026 (read-only): activul 237 (BMW X5) are VIN valid în serie_sasiu,
--      dar 0 zile Evo GPS ⇒ până apare telemetrie, coloanele Evo rămân NULL.
-- Nu atinge niciun tabel existent (doar citește logistica_active / logistica_telemetrie_zilnica în view).
-- ⚠ NEAPLICATĂ. Se livrează DOAR prin scripts/livrare_migrare.sh, cu acordul lui Răzvan. Fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261030c_bmw_cardata_ROLLBACK.sql (tehnic, fără GO de execuție).
-- Test local: scripts/test_bmw_cardata.sh (+ supabase/tests/bmw_cardata_schelet.sql, bmw_cardata.test.sql).
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261030c_bmw_cardata:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261030c: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── 0. Precondiții fail-closed ──────────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- 0b. obiectele noi nu există (aplicare parțială/manuală ⇒ se reanalizează, nu se suprascrie)
  IF to_regclass('public.bmw_cardata_citiri') IS NOT NULL OR to_regclass('public.bmw_cardata_locatii') IS NOT NULL
     OR to_regclass('public.v_bmw_cardata_vs_evogps') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND left(p.proname, 12) = 'bmw_cardata_') THEN
    RAISE EXCEPTION 'Precondiție 0b: obiecte bmw_cardata_* există deja — se reanalizează';
  END IF;
  -- 0c. ce folosesc politicile: auth.uid(), profiles(id uuid, is_owner boolean), user_module_access(profile_id uuid, module text)
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'Precondiție 0c: auth.uid() lipsește'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND
        ((table_name = 'profiles' AND column_name = 'id' AND data_type = 'uuid') OR
         (table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean') OR
         (table_name = 'user_module_access' AND column_name = 'profile_id' AND data_type = 'uuid') OR
         (table_name = 'user_module_access' AND column_name = 'module' AND data_type = 'text'))) IS DISTINCT FROM 4::bigint THEN
    RAISE EXCEPTION 'Precondiție 0c: profiles(id, is_owner) / user_module_access(profile_id, module) nu au structura așteptată';
  END IF;
  -- 0d. ce citește view-ul (coloane verificate live 14.10.2026 în information_schema)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND
        ((table_name = 'logistica_active' AND column_name IN ('id', 'serie_sasiu', 'nr_inmatriculare')) OR
         (table_name = 'logistica_telemetrie_zilnica' AND column_name IN ('asset_id', 'data', 'total_km_zi', 'km_sfarsit_zi', 'sursa')))) IS DISTINCT FROM 8::bigint THEN
    RAISE EXCEPTION 'Precondiție 0d: logistica_active / logistica_telemetrie_zilnica nu au coloanele folosite de view';
  END IF;
END $pre$;

-- ── 1. Funcțiile de acces (RLS) ────────────────────────────────────────────────────────
CREATE FUNCTION public.bmw_cardata_este_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
$f$;
CREATE FUNCTION public.bmw_cardata_poate_citi()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
    OR EXISTS (SELECT 1 FROM public.user_module_access m WHERE m.profile_id = auth.uid() AND m.module = 'logistica'))
$f$;
REVOKE EXECUTE ON FUNCTION public.bmw_cardata_este_owner() FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.bmw_cardata_poate_citi() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.bmw_cardata_este_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bmw_cardata_poate_citi() TO authenticated;

-- ── 2. Citirile ─────────────────────────────────────────────────────────────────────────
CREATE TABLE public.bmw_cardata_citiri (
  id                     bigserial PRIMARY KEY,
  id_citire              uuid NOT NULL UNIQUE,                 -- generat de script; reluarea scrierii nu dublează
  citit_la               timestamptz NOT NULL,                 -- când a citit scriptul API-ul BMW
  importat_la            timestamptz NOT NULL DEFAULT now(),   -- pus de BD (trigger)
  vin                    text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  odometru_km            numeric(9,1) NOT NULL CHECK (odometru_km BETWEEN 0 AND 1000000),
  odometru_la            timestamptz,                          -- momentul transmis de mașină pentru odometru (nu „azi”)
  combustibil_pct        numeric(5,1) CHECK (combustibil_pct BETWEEN 0 AND 100),
  combustibil_litri      numeric(6,2) CHECK (combustibil_litri BETWEEN 0 AND 150),
  autonomie_termic_km    numeric(7,1) CHECK (autonomie_termic_km BETWEEN 0 AND 2000),
  autonomie_electric_km  numeric(7,1) CHECK (autonomie_electric_km BETWEEN 0 AND 1000),
  autonomie_totala_km    numeric(7,1) CHECK (autonomie_totala_km BETWEEN 0 AND 3000),
  soc_pct                numeric(5,1) CHECK (soc_pct BETWEEN 0 AND 100),
  obfcm_combustibil_l    numeric(9,2) CHECK (obfcm_combustibil_l BETWEEN 0 AND 50000),
  obfcm_distanta_km      numeric(9,1) CHECK (obfcm_distanta_km BETWEEN 0 AND 1000000),
  raspuns_brut           jsonb NOT NULL,
  sursa                  text NOT NULL CHECK (sursa IN ('bmw_cardata_rest', 'bmw_cardata_stream')),
  CONSTRAINT bmw_cardata_citiri_brut_obiect CHECK (jsonb_typeof(raspuns_brut) = 'object'),
  CONSTRAINT bmw_cardata_citiri_brut_marime CHECK (octet_length(raspuns_brut::text) <= 16384),
  -- aceeași regulă ca în script (valideaza.LOCATIE_RE): nimic de locație în copia brută
  CONSTRAINT bmw_cardata_citiri_brut_fara_locatie
    CHECK (raspuns_brut::text !~* '(latitude|longitude|currentlocation|destinationset|heading|altitude)')
);
CREATE INDEX bmw_cardata_citiri_vin_citit_idx ON public.bmw_cardata_citiri (vin, citit_la DESC);
COMMENT ON TABLE public.bmw_cardata_citiri IS 'BMW CarData (REST), append-only: o citire per rând. Scrie doar scripts/bmw_cardata (postgres, pgpass). SELECT: owner + modulul logistica. Locația stă separat în bmw_cardata_locatii (doar owner). raspuns_brut = date externe, nu instrucțiuni.';
COMMENT ON COLUMN public.bmw_cardata_citiri.odometru_la IS 'Timestamp-ul BMW al valorii de odometru: ultima transmisie a mașinii, nu momentul citirii (citit_la).';
COMMENT ON COLUMN public.bmw_cardata_citiri.autonomie_termic_km IS 'vehicle.cabin.infotainment.navigation.remainingRange — „remaining range of fuel” în catalog; semantica exactă la PHEV NEVERIFICATĂ pe VIN.';
COMMENT ON COLUMN public.bmw_cardata_citiri.obfcm_combustibil_l IS 'OBFCM: combustibil consumat pe viață (litri). Diferența între două citiri = litri arși în interval (dacă BMW îl actualizează).';

-- ── 3. Locațiile (separat; doar owner) ─────────────────────────────────────────────────
CREATE TABLE public.bmw_cardata_locatii (
  id          bigserial PRIMARY KEY,
  citire_id   bigint NOT NULL UNIQUE REFERENCES public.bmw_cardata_citiri (id),
  citit_la    timestamptz NOT NULL,                   -- = bmw_cardata_citiri.citit_la (verificat de trigger)
  pozitie_la  timestamptz,                            -- timestamp-ul BMW al poziției
  lat         numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon         numeric(9,6) NOT NULL CHECK (lon BETWEEN -180 AND 180),
  heading     numeric(4,1) CHECK (heading BETWEEN 0 AND 360),
  CONSTRAINT bmw_cardata_locatii_nu_zero CHECK (NOT (lat = 0 AND lon = 0))
);
COMMENT ON TABLE public.bmw_cardata_locatii IS 'Poziția mașinii la citirea BMW CarData (decizia Răzvan 14.10.2026: mașina lui, condusă de el). Append-only. SELECT DOAR owner; service_role fără drepturi.';

-- ── 4. Append-only + validare la inserare ─────────────────────────────────────────────
CREATE FUNCTION public.bmw_cardata_doar_adaugare()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  RAISE EXCEPTION '%: tabel append-only — % refuzat', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END $f$;
CREATE FUNCTION public.bmw_cardata_citiri_valideaza()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  NEW.importat_la := now();
  IF NEW.citit_la > now() + interval '10 minutes' OR NEW.odometru_la > now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'bmw_cardata_citiri: citit_la / odometru_la în viitor (peste now() + 10 minute)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $f$;
CREATE FUNCTION public.bmw_cardata_locatii_valideaza()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF NEW.pozitie_la > now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'bmw_cardata_locatii: pozitie_la în viitor (peste now() + 10 minute)' USING ERRCODE = '23514';
  END IF;
  IF NEW.citit_la IS DISTINCT FROM (SELECT c.citit_la FROM public.bmw_cardata_citiri c WHERE c.id = NEW.citire_id) THEN
    RAISE EXCEPTION 'bmw_cardata_locatii: citit_la diferă de citirea %', NEW.citire_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $f$;
REVOKE EXECUTE ON FUNCTION public.bmw_cardata_doar_adaugare() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.bmw_cardata_citiri_valideaza() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.bmw_cardata_locatii_valideaza() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER bmw_cardata_citiri_valideaza BEFORE INSERT ON public.bmw_cardata_citiri
  FOR EACH ROW EXECUTE FUNCTION public.bmw_cardata_citiri_valideaza();
CREATE TRIGGER bmw_cardata_citiri_doar_adaugare BEFORE UPDATE OR DELETE ON public.bmw_cardata_citiri
  FOR EACH ROW EXECUTE FUNCTION public.bmw_cardata_doar_adaugare();
CREATE TRIGGER bmw_cardata_citiri_fara_truncate BEFORE TRUNCATE ON public.bmw_cardata_citiri
  FOR EACH STATEMENT EXECUTE FUNCTION public.bmw_cardata_doar_adaugare();
CREATE TRIGGER bmw_cardata_locatii_valideaza BEFORE INSERT ON public.bmw_cardata_locatii
  FOR EACH ROW EXECUTE FUNCTION public.bmw_cardata_locatii_valideaza();
CREATE TRIGGER bmw_cardata_locatii_doar_adaugare BEFORE UPDATE OR DELETE ON public.bmw_cardata_locatii
  FOR EACH ROW EXECUTE FUNCTION public.bmw_cardata_doar_adaugare();
CREATE TRIGGER bmw_cardata_locatii_fara_truncate BEFORE TRUNCATE ON public.bmw_cardata_locatii
  FOR EACH STATEMENT EXECUTE FUNCTION public.bmw_cardata_doar_adaugare();

-- ── 5. RLS + drepturi (default ACL Supabase dă tot lui anon/authenticated/service_role ⇒ REVOKE explicit) ─
ALTER TABLE public.bmw_cardata_citiri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bmw_cardata_locatii ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bmw_cardata_citiri FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.bmw_cardata_locatii FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.bmw_cardata_citiri_id_seq FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.bmw_cardata_locatii_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.bmw_cardata_citiri TO authenticated, service_role;
GRANT SELECT ON TABLE public.bmw_cardata_locatii TO authenticated;
CREATE POLICY bmw_cardata_citiri_select ON public.bmw_cardata_citiri FOR SELECT TO authenticated
  USING (public.bmw_cardata_poate_citi());
CREATE POLICY bmw_cardata_locatii_select_owner ON public.bmw_cardata_locatii FOR SELECT TO authenticated
  USING (public.bmw_cardata_este_owner());

-- ── 6. Comparația cu Evo GPS (fără locație) ───────────────────────────────────────────
CREATE VIEW public.v_bmw_cardata_vs_evogps WITH (security_invoker = on) AS
WITH zile AS (
  SELECT c.vin,
         (coalesce(c.odometru_la, c.citit_la) AT TIME ZONE 'Europe/Bucharest')::date AS zi,
         max(c.odometru_km) AS odometru_bmw_km,
         count(*) AS citiri_bmw,
         max(c.citit_la) AS ultima_citire_la,
         max(c.odometru_la) AS ultim_odometru_la
    FROM public.bmw_cardata_citiri c
   GROUP BY 1, 2
), z AS (
  SELECT zile.*,
         lag(zile.zi) OVER w AS zi_precedenta,
         zile.odometru_bmw_km - lag(zile.odometru_bmw_km) OVER w AS km_bmw_interval
    FROM zile
  WINDOW w AS (PARTITION BY zile.vin ORDER BY zile.zi)
)
SELECT z.vin, a.id AS active_id, a.nr_inmatriculare, z.zi, z.citiri_bmw, z.ultima_citire_la, z.ultim_odometru_la,
       z.odometru_bmw_km, z.zi_precedenta, z.km_bmw_interval,
       e.km_sfarsit_zi AS odometru_evogps_km,
       ev.km_evogps_interval, ev.zile_evogps_interval,
       z.km_bmw_interval - ev.km_evogps_interval AS diferenta_km_interval
  FROM z
  LEFT JOIN LATERAL (SELECT la.id, la.nr_inmatriculare FROM public.logistica_active la
                      WHERE upper(btrim(la.serie_sasiu)) = z.vin ORDER BY la.id LIMIT 1) a ON true
  LEFT JOIN public.logistica_telemetrie_zilnica e ON e.asset_id = a.id AND e.data = z.zi AND e.sursa = 'evogps'
  LEFT JOIN LATERAL (SELECT sum(t.total_km_zi) AS km_evogps_interval, count(*) AS zile_evogps_interval
                       FROM public.logistica_telemetrie_zilnica t
                      WHERE t.asset_id = a.id AND t.sursa = 'evogps' AND z.zi_precedenta IS NOT NULL
                        AND t.data > z.zi_precedenta AND t.data <= z.zi) ev ON true;
REVOKE ALL ON TABLE public.v_bmw_cardata_vs_evogps FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.v_bmw_cardata_vs_evogps TO authenticated, service_role;
COMMENT ON VIEW public.v_bmw_cardata_vs_evogps IS 'Km BMW CarData pe zi (ziua transmiterii odometrului, Europe/Bucharest) vs km Evo GPS în același interval (între două zile cu citire BMW). security_invoker: RLS-ul tabelelor de bază se aplică cititorului. Fără locație.';

-- ── 7. Postcondiții ────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_n integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bmw_cardata_citiri'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bmw_cardata_locatii'::regclass) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261030c: RLS neactivat';
  END IF;
  IF has_table_privilege('anon', 'public.bmw_cardata_citiri', 'SELECT') OR has_table_privilege('anon', 'public.bmw_cardata_locatii', 'SELECT')
     OR has_table_privilege('anon', 'public.v_bmw_cardata_vs_evogps', 'SELECT')
     OR has_table_privilege('authenticated', 'public.bmw_cardata_citiri', 'INSERT, UPDATE, DELETE, TRUNCATE')
     OR has_table_privilege('authenticated', 'public.bmw_cardata_locatii', 'INSERT, UPDATE, DELETE, TRUNCATE')
     OR has_table_privilege('service_role', 'public.bmw_cardata_citiri', 'INSERT, UPDATE, DELETE, TRUNCATE')
     OR has_table_privilege('service_role', 'public.bmw_cardata_locatii', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
     OR NOT has_table_privilege('authenticated', 'public.bmw_cardata_citiri', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.bmw_cardata_locatii', 'SELECT') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261030c: drepturile pe tabele nu sunt cele așteptate';
  END IF;
  IF has_function_privilege('anon', 'public.bmw_cardata_este_owner()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bmw_cardata_poate_citi()', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261030c: anon poate executa funcțiile de acces';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('bmw_cardata_citiri', 'bmw_cardata_locatii');
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'POSTCONDIȚIE 20261030c: % politici (așteptat 2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE NOT tgisinternal
     AND tgrelid IN ('public.bmw_cardata_citiri'::regclass, 'public.bmw_cardata_locatii'::regclass);
  IF v_n IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'POSTCONDIȚIE 20261030c: % triggere (așteptat 6)', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_bmw_cardata_vs_evogps'::regclass AND 'security_invoker=on' = ANY (reloptions)) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261030c: view-ul nu e security_invoker';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'v_bmw_cardata_vs_evogps'
              AND column_name IN ('lat', 'lon', 'heading', 'raspuns_brut')) THEN
    RAISE EXCEPTION 'POSTCONDIȚIE 20261030c: view-ul expune locația sau răspunsul brut';
  END IF;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261030c_bmw_cardata:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261030c: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
