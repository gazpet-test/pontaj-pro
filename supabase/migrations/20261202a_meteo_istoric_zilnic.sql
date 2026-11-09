-- Version 20261202120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261202a_meteo_istoric_zilnic — istoricul meteo zilnic pe șantiere (cererea lui Răzvan, 09.11.2026): dovezile pentru zilele nelucrabile.
--
-- Ce face:
--   * UN tabel nou, meteo_istoric_zilnic: o înregistrare pe (site_id, data) — precipitații, ploaie, zăpadă, Tmin, Tmax, vânt maxim, rafale,
--     codul vremii (WMO), coordonatele folosite la preluare, sursa și momentul preluării. Îl scrie DOAR edge fn meteo-sync (service_role),
--     din arhiva Open-Meteo, pentru site-urile cu meteo_activ; nimeni altcineva nu are drept de scriere (fără INSERT / UPDATE / DELETE
--     pentru anon / authenticated). Citirea: orice utilizator logat (ca meteo_cache: date meteo, nu personale).
--   * Pragurile „zi nelucrabilă” într-un tabel cu UN rând (meteo_praguri_nelucrabil, id = 1), cu ipoteza de pornire: precipitații ≥ 10 mm
--     SAU zăpadă ≥ 1 cm SAU Tmax < 0 °C SAU Tmin ≤ −5 °C. Le schimbă DOAR owner-ul, prin fn_meteo_praguri_seteaza (SECURITY DEFINER,
--     auth.uid() + profiles.is_owner, CAS pe versiune).
--   * „Zi nelucrabilă” se calculează într-un singur loc (L19): vederea v_meteo_zile (security_invoker), din istoric + pragurile curente.
--     true = cel puțin un prag atins (motive = lista lor); false = toate valorile cunoscute și niciun prag atins; NULL = niciun prag atins,
--     dar lipsește o valoare (necunoscut ≠ lucrabil, L18).
-- Ce NU face: nicio dată meteo (o aduce meteo-sync după deploy; backfill-ul îl pornește owner-ul), nicio automatizare nouă (pasul zilnic stă
--   în cron-ul existent meteo_sync_2h → meteo-sync), niciun drept nou pe alte tabele.
-- Ordinea lock-urilor (L06): RPC-ul actualizează UN rând (meteo_praguri_nelucrabil, id = 1) și nimic altceva.
-- Revenire: supabase/revenire/20261202a_meteo_istoric_zilnic_ROLLBACK.sql. Test pe clonă: scripts/test_meteo_istoric.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261202a_meteo_istoric_zilnic:' || txid_current() THEN
    RAISE EXCEPTION '20261202a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261202a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.meteo_istoric_zilnic') IS NOT NULL OR to_regclass('public.meteo_praguri_nelucrabil') IS NOT NULL
     OR to_regclass('public.v_meteo_zile') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_meteo_praguri_seteaza') THEN
    RAISE EXCEPTION '20261202a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele: sites (id întreg + coloanele citite de meteo-sync), executie_proiecte.data_start (backfill), profiles.is_owner, auth.uid()
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.sites'::regclass AND attname = 'id' AND NOT attisdropped) NOT IN ('integer', 'bigint')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sites'
          AND column_name IN ('name', 'lat', 'lng', 'meteo_activ', 'active', 'proiect_id')) <> 6
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sites'::regclass AND contype IN ('p', 'u')
                      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.sites'::regclass AND attname = 'id')]::int2[])
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name = 'data_start' AND data_type = 'date')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean')
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20261202a: dependentele (sites.id intreg cu cheie, coloanele sites, executie_proiecte.data_start date, profiles.is_owner, auth.uid) difera';
  END IF;
END $pre$;

-- ── pragurile (un singur rând) ──
CREATE TABLE public.meteo_praguri_nelucrabil (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  precipitatii_mm_min numeric(6,1) NOT NULL DEFAULT 10 CHECK (precipitatii_mm_min > 0 AND precipitatii_mm_min <= 500),
  zapada_cm_min numeric(6,1) NOT NULL DEFAULT 1 CHECK (zapada_cm_min > 0 AND zapada_cm_min <= 500),
  tmax_sub_c numeric(5,1) NOT NULL DEFAULT 0 CHECK (tmax_sub_c BETWEEN -40 AND 40),
  tmin_max_c numeric(5,1) NOT NULL DEFAULT -5 CHECK (tmin_max_c BETWEEN -50 AND 30),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune >= 1),
  actualizat_la timestamptz NOT NULL DEFAULT now(),
  actualizat_de uuid
);
COMMENT ON TABLE public.meteo_praguri_nelucrabil IS 'Pragurile „zi nelucrabilă” (un rând, id = 1): precipitații ≥ precipitatii_mm_min SAU zăpadă ≥ zapada_cm_min SAU Tmax < tmax_sub_c SAU Tmin ≤ tmin_max_c. Se schimbă doar prin fn_meteo_praguri_seteaza (owner).';
INSERT INTO public.meteo_praguri_nelucrabil (id) VALUES (1);

-- ── istoricul zilnic ──
CREATE TABLE public.meteo_istoric_zilnic (
  site_id bigint NOT NULL REFERENCES public.sites(id),
  data date NOT NULL CHECK (data >= DATE '2015-01-01'),
  precipitatii_mm numeric(7,2) CHECK (precipitatii_mm >= 0 AND precipitatii_mm < 1000),
  ploaie_mm numeric(7,2) CHECK (ploaie_mm >= 0 AND ploaie_mm < 1000),
  zapada_cm numeric(7,2) CHECK (zapada_cm >= 0 AND zapada_cm < 1000),
  tmin_c numeric(5,2) CHECK (tmin_c BETWEEN -60 AND 60),
  tmax_c numeric(5,2) CHECK (tmax_c BETWEEN -60 AND 60),
  vant_max_kmh numeric(6,2) CHECK (vant_max_kmh >= 0 AND vant_max_kmh < 400),
  rafale_max_kmh numeric(6,2) CHECK (rafale_max_kmh >= 0 AND rafale_max_kmh < 400),
  cod_vreme smallint CHECK (cod_vreme BETWEEN 0 AND 99),
  lat numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  sursa text NOT NULL CHECK (sursa IN ('open-meteo-archive')),
  preluat_la timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, data),
  CHECK (tmin_c IS NULL OR tmax_c IS NULL OR tmin_c <= tmax_c),
  CHECK (precipitatii_mm IS NOT NULL OR ploaie_mm IS NOT NULL OR zapada_cm IS NOT NULL OR tmin_c IS NOT NULL OR tmax_c IS NOT NULL)
);
COMMENT ON TABLE public.meteo_istoric_zilnic IS 'Vremea zilnică pe șantier (site_id, data), din arhiva Open-Meteo, ziua în Europe/Bucharest. Scrisă doar de edge fn meteo-sync (service_role). lat/lng = coordonatele folosite la preluare (dovadă). „Zi nelucrabilă”: v_meteo_zile.';

ALTER TABLE public.meteo_praguri_nelucrabil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meteo_istoric_zilnic ENABLE ROW LEVEL SECURITY;
CREATE POLICY meteo_praguri_select ON public.meteo_praguri_nelucrabil FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY meteo_istoric_select ON public.meteo_istoric_zilnic FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
REVOKE ALL ON public.meteo_praguri_nelucrabil, public.meteo_istoric_zilnic FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.meteo_praguri_nelucrabil, public.meteo_istoric_zilnic TO authenticated;
GRANT SELECT ON public.meteo_praguri_nelucrabil TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.meteo_istoric_zilnic TO service_role;

-- ── „zi nelucrabilă”, într-un singur loc (L19) ──
CREATE VIEW public.v_meteo_zile WITH (security_invoker = on) AS
SELECT i.site_id, i.data, i.precipitatii_mm, i.ploaie_mm, i.zapada_cm, i.tmin_c, i.tmax_c, i.vant_max_kmh, i.rafale_max_kmh, i.cod_vreme,
       i.lat, i.lng, i.sursa, i.preluat_la,
       CASE WHEN cardinality(m.motive) > 0 THEN true
            WHEN i.precipitatii_mm IS NULL OR i.zapada_cm IS NULL OR i.tmax_c IS NULL OR i.tmin_c IS NULL THEN NULL
            ELSE false END AS zi_nelucrabila,
       m.motive,
       p.precipitatii_mm_min, p.zapada_cm_min, p.tmax_sub_c, p.tmin_max_c, p.versiune AS praguri_versiune
  FROM public.meteo_istoric_zilnic i
  JOIN public.meteo_praguri_nelucrabil p ON p.id = 1
  CROSS JOIN LATERAL (SELECT array_remove(ARRAY[
      CASE WHEN i.precipitatii_mm >= p.precipitatii_mm_min THEN 'precipitatii' END,
      CASE WHEN i.zapada_cm >= p.zapada_cm_min THEN 'zapada' END,
      CASE WHEN i.tmax_c < p.tmax_sub_c THEN 'tmax' END,
      CASE WHEN i.tmin_c <= p.tmin_max_c THEN 'tmin' END]::text[], NULL) AS motive) m;
REVOKE ALL ON public.v_meteo_zile FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_meteo_zile TO authenticated, service_role;

-- ── schimbarea pragurilor: doar owner-ul, CAS pe versiune (L01, L08) ──
CREATE FUNCTION public.fn_meteo_praguri_seteaza(p_versiune integer, p_precipitatii_mm numeric, p_zapada_cm numeric, p_tmax_sub_c numeric, p_tmin_max_c numeric)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_ver integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'neautentificat' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_owner IS TRUE) THEN
    RAISE EXCEPTION 'doar owner-ul schimbă pragurile' USING ERRCODE = '42501';
  END IF;
  IF p_versiune IS NULL OR p_precipitatii_mm IS NULL OR p_zapada_cm IS NULL OR p_tmax_sub_c IS NULL OR p_tmin_max_c IS NULL THEN
    RAISE EXCEPTION 'pragurile sunt incomplete' USING ERRCODE = '22023';
  END IF;
  UPDATE public.meteo_praguri_nelucrabil
     SET precipitatii_mm_min = p_precipitatii_mm, zapada_cm_min = p_zapada_cm, tmax_sub_c = p_tmax_sub_c, tmin_max_c = p_tmin_max_c,
         versiune = versiune + 1, actualizat_la = now(), actualizat_de = v_uid
   WHERE id = 1 AND versiune = p_versiune
   RETURNING versiune INTO v_ver;
  IF v_ver IS NULL THEN RAISE EXCEPTION 'pragurile au fost schimbate între timp — reîncarcă pagina' USING ERRCODE = '40001'; END IF;
  RETURN v_ver;
END $f$;
REVOKE ALL ON FUNCTION public.fn_meteo_praguri_seteaza(integer, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_meteo_praguri_seteaza(integer, numeric, numeric, numeric, numeric) TO authenticated;

-- ── postcondiții ──
DO $post$
BEGIN
  IF (SELECT count(*) FROM public.meteo_praguri_nelucrabil WHERE id = 1 AND precipitatii_mm_min = 10 AND zapada_cm_min = 1 AND tmax_sub_c = 0 AND tmin_max_c = -5 AND versiune = 1) <> 1
     OR (SELECT count(*) FROM public.meteo_praguri_nelucrabil) <> 1 THEN
    RAISE EXCEPTION '20261202a post: pragurile de pornire';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN ('public.meteo_praguri_nelucrabil'::regclass, 'public.meteo_istoric_zilnic'::regclass)
               AND (NOT c.relrowsecurity OR c.relforcerowsecurity OR pg_get_userbyid(c.relowner) <> 'postgres'))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('meteo_praguri_nelucrabil', 'meteo_istoric_zilnic')) <> 2
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('meteo_praguri_nelucrabil', 'meteo_istoric_zilnic')
                  AND (cmd <> 'SELECT' OR roles <> ARRAY['authenticated']::name[] OR permissive <> 'PERMISSIVE')) THEN
    RAISE EXCEPTION '20261202a post: RLS / politici';
  END IF;
  -- drepturi exacte: authenticated doar SELECT; service_role SELECT (+ INSERT / UPDATE pe istoric); anon nimic
  IF has_table_privilege('anon', 'public.meteo_istoric_zilnic', 'SELECT') OR has_table_privilege('anon', 'public.v_meteo_zile', 'SELECT')
     OR has_table_privilege('authenticated', 'public.meteo_istoric_zilnic', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated', 'public.meteo_praguri_nelucrabil', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'public.meteo_istoric_zilnic', 'DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'public.meteo_praguri_nelucrabil', 'INSERT,UPDATE,DELETE,TRUNCATE')
     -- cu o listă, has_table_privilege e adevărat dacă ORICARE drept există: drepturile obligatorii se verifică pe rând
     OR NOT has_table_privilege('service_role', 'public.meteo_istoric_zilnic', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.meteo_istoric_zilnic', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.meteo_istoric_zilnic', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.meteo_praguri_nelucrabil', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.meteo_istoric_zilnic', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.meteo_praguri_nelucrabil', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.v_meteo_zile', 'SELECT')
     OR has_table_privilege('authenticated', 'public.v_meteo_zile', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION '20261202a post: drepturi pe tabele';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_meteo_zile'::regclass AND reloptions = ARRAY['security_invoker=on']) THEN
    RAISE EXCEPTION '20261202a post: vederea nu e security_invoker';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_meteo_praguri_seteaza(integer, numeric, numeric, numeric, numeric)'::regprocedure
                   AND prosecdef AND proconfig = ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(proowner) = 'postgres')
     OR has_function_privilege('anon', 'public.fn_meteo_praguri_seteaza(integer, numeric, numeric, numeric, numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_meteo_praguri_seteaza(integer, numeric, numeric, numeric, numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261202a post: funcția pragurilor';
  END IF;
END $post$;
