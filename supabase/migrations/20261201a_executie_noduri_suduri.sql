-- Version 20261201120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261201a_executie_noduri_suduri — Execuție: sudurile unui nod de cuplare, pe schema de montaj (decizia lui Răzvan, 09.11.2026), versiunea minimă.
--
-- Ce face:
--   * UN tabel nou, executie_noduri_suduri: lista sudurilor unui nod (proiect_id + nod_cod, ex. NOD-CUPLARE-PRUNISOR pe Lot 1), cu starea curentă,
--     data stării, data sudării (pentru „azi”), sudorul, buletinul NDT, motivul și punctul de pe schemă: vederea principală (vedere + x/y în
--     procente din imagine) plus, opțional, punctele de pe alte vederi (pozitii_secundare, jsonb validat de o funcție IMMUTABLE în CHECK).
--     Separat de firul conductei: izo_suduri (T1–T11) nu se atinge.
--   * De ce nu izo_suduri: cere tronson în flux de montaj, declarație de pe tabletă (declaratie_id NOT NULL) și piese cu serie; stările ei sunt
--     declarata / aprobata / anulata (fără NDT), iar citirea cere atribuire izo pe proiect. Lot 1 nu folosește Izometria.
--   * Scrierea din aplicație: DOAR prin fn_executie_nod_sudura_stare (SECURITY DEFINER): auth.uid() obligatoriu, drept pe proiectul sudurii
--     (owner sau user_module_access 'executie' editor / admin), lock FOR UPDATE, CAS pe stare + versiune, tranziție din lista albă,
--     cheie de idempotență per apăsare. Nicio scriere directă (fără INSERT / UPDATE / DELETE pentru anon / authenticated / service_role).
--   * Citirea: owner sau user_module_access 'executie' (orice nivel), prin RLS. Dreptul e o singură funcție (fn_executie_nod_drept),
--     folosită de RLS, de RPC și de politica din Storage.
--   * Storage: bucket PRIVAT noduri-scheme (<proiect_id>/<nod_cod>/vederi.json + imaginile vederilor). Doar citire pentru aplicație
--     (signed URL), pe același drept, și doar pentru un nod care există pe acel proiect. Urcarea o face chat-ul.
-- Ce NU face: nicio dată (lista și punctele le încarcă chat-ul după „da”-ul lui Răzvan, cu SQL generat local de
--   scripts/noduri_cuplare_import_sql.mjs), niciun drept, nicio atingere pe rapoarte_zilnice / izo_*.
-- Ordinea lock-urilor (L06): RPC-ul blochează UN rând (executie_noduri_suduri FOR UPDATE) și nimic altceva.
-- Revenire: supabase/revenire/20261201a_executie_noduri_suduri_ROLLBACK.sql. Test pe clonă: scripts/test_executie_noduri_suduri.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261201a_executie_noduri_suduri:' || txid_current() THEN
    RAISE EXCEPTION '20261201a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261201a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.executie_noduri_suduri') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN ('fn_executie_nod_drept', 'fn_executie_nod_tranzitie', 'fn_executie_nod_sudura_stare',
                                                             'fn_executie_nod_sudura_provenienta', 'fn_executie_nod_obiect_citire',
                                                             'fn_executie_nod_pozitii_valide'))
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'noduri-scheme')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'noduri_scheme_citire') THEN
    RAISE EXCEPTION '20261201a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele, cu tipurile citite din migrări (executie_proiecte.id bigint; profiles.is_owner; user_module_access)
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'bigint'
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access'
          AND column_name IN ('profile_id', 'module', 'access_level')) <> 3
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20261201a: dependentele (executie_proiecte.id bigint, profiles.is_owner, user_module_access, auth.uid) difera';
  END IF;
END $pre$;

-- ── punctele de pe alte vederi: [{vedere, x_pct, y_pct, certitudine?}], cel mult 20, vederi distincte și diferite de cea principală ──
CREATE FUNCTION public.fn_executie_nod_pozitii_valide(p jsonb, p_principala text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE e jsonb; v_vazute text[] := ARRAY[]::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p) > 20 THEN RETURN false; END IF;
  IF jsonb_array_length(p) > 0 AND p_principala IS NULL THEN RETURN false; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p) x LOOP
    -- verificări pe pași separați (fără să ne bazăm pe ordinea de evaluare a unui OR): tipul, apoi cheile, apoi valorile
    IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
    IF NOT (e ?& ARRAY['vedere', 'x_pct', 'y_pct'])
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('vedere', 'x_pct', 'y_pct', 'certitudine')) THEN RETURN false; END IF;
    IF jsonb_typeof(e->'vedere') <> 'string' OR jsonb_typeof(e->'x_pct') <> 'number' OR jsonb_typeof(e->'y_pct') <> 'number' THEN RETURN false; END IF;
    IF (e->>'vedere') !~ '^[A-Z0-9][A-Z0-9_-]{0,19}$' OR (e->>'vedere') = p_principala OR (e->>'vedere') = ANY (v_vazute) THEN RETURN false; END IF;
    IF (e->>'x_pct')::numeric NOT BETWEEN 0 AND 100 OR (e->>'y_pct')::numeric NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
    IF e ? 'certitudine' AND (jsonb_typeof(e->'certitudine') <> 'string' OR length(e->>'certitudine') NOT BETWEEN 1 AND 60) THEN RETURN false; END IF;
    v_vazute := v_vazute || (e->>'vedere');
  END LOOP;
  RETURN true;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_nod_pozitii_valide(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_nod_pozitii_valide(jsonb, text) TO authenticated, service_role;

-- ── tabelul ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_noduri_suduri (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  nod_cod text NOT NULL CHECK (nod_cod ~ '^[A-Z0-9][A-Z0-9-]{1,59}$'),
  cod text NOT NULL CHECK (cod ~ '^[A-Z]{1,6}-[0-9]{1,5}$'),
  subansamblu text NOT NULL DEFAULT '' CHECK (length(subansamblu) <= 300),
  dn integer CHECK (dn BETWEEN 10 AND 2000),
  diametru text CHECK (diametru IS NULL OR length(diametru) BETWEEN 1 AND 120),
  poz1 text CHECK (poz1 IS NULL OR length(poz1) BETWEEN 1 AND 200),
  poz2 text CHECK (poz2 IS NULL OR length(poz2) BETWEEN 1 AND 200),
  certitudine text NOT NULL DEFAULT 'de_confirmat' CHECK (certitudine IN ('sigur', 'de_confirmat', 'posibil')),
  stare text NOT NULL DEFAULT 'de_executat' CHECK (stare IN ('de_executat', 'insailat', 'sudat', 'ndt', 'acceptat', 'reparat', 'anulat')),
  data_stare date,
  data_sudare date,
  sudor text CHECK (sudor IS NULL OR (length(sudor) BETWEEN 1 AND 80 AND sudor ~ '[^[:space:]]')),
  buletin_ndt text CHECK (buletin_ndt IS NULL OR (length(buletin_ndt) BETWEEN 1 AND 80 AND buletin_ndt ~ '[^[:space:]]')),
  motiv text CHECK (motiv IS NULL OR (length(motiv) BETWEEN 1 AND 500 AND motiv ~ '[^[:space:]]')),
  vedere text CHECK (vedere IS NULL OR vedere ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  x_pct numeric(6,3) CHECK (x_pct BETWEEN 0 AND 100),
  y_pct numeric(6,3) CHECK (y_pct BETWEEN 0 AND 100),
  pozitie_certitudine text CHECK (pozitie_certitudine IS NULL OR length(pozitie_certitudine) BETWEEN 1 AND 60),
  pozitii_secundare jsonb NOT NULL DEFAULT '[]'::jsonb,
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  ultima_cheie uuid,
  ultima_amprenta text CHECK (ultima_amprenta IS NULL OR ultima_amprenta ~ '^[0-9a-f]{32}$'),
  modificat_de uuid,
  modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_noduri_suduri_cod_uq UNIQUE (proiect_id, nod_cod, cod),
  CONSTRAINT executie_noduri_suduri_pozitie CHECK ((vedere IS NULL) = (x_pct IS NULL) AND (vedere IS NULL) = (y_pct IS NULL)
                                                   AND (vedere IS NOT NULL OR pozitie_certitudine IS NULL)),
  CONSTRAINT executie_noduri_suduri_pozitii_secundare CHECK (public.fn_executie_nod_pozitii_valide(pozitii_secundare, vedere)),
  CONSTRAINT executie_noduri_suduri_data_stare CHECK (stare = 'de_executat' OR data_stare IS NOT NULL),
  CONSTRAINT executie_noduri_suduri_sudata CHECK (stare NOT IN ('sudat', 'ndt', 'acceptat', 'reparat') OR (data_sudare IS NOT NULL AND sudor IS NOT NULL)),
  CONSTRAINT executie_noduri_suduri_ndt CHECK (stare NOT IN ('ndt', 'acceptat') OR buletin_ndt IS NOT NULL),
  CONSTRAINT executie_noduri_suduri_motiv CHECK (stare NOT IN ('reparat', 'anulat') OR motiv IS NOT NULL),
  CONSTRAINT executie_noduri_suduri_cheie CHECK ((ultima_cheie IS NULL) = (ultima_amprenta IS NULL))
);
CREATE INDEX executie_noduri_suduri_nod_idx ON public.executie_noduri_suduri (proiect_id, nod_cod, id);
CREATE UNIQUE INDEX executie_noduri_suduri_cheie_uq ON public.executie_noduri_suduri (ultima_cheie) WHERE ultima_cheie IS NOT NULL;
COMMENT ON TABLE public.executie_noduri_suduri IS
  'Execuție: sudurile unui nod de cuplare (proiect + nod_cod), separat de fir. Starea se schimbă DOAR prin fn_executie_nod_sudura_stare. 20261201a.';
COMMENT ON COLUMN public.executie_noduri_suduri.stare IS
  'de_executat / insailat / sudat / ndt (buletin, fără rezultat) / acceptat / reparat (= NDT sau vizual respins, de reparat) / anulat.';
COMMENT ON COLUMN public.executie_noduri_suduri.data_sudare IS 'Ziua primei sudări (de_executat/insailat -> sudat); o reparație nu o schimbă. Contorul „azi”.';
COMMENT ON COLUMN public.executie_noduri_suduri.vedere IS 'Vederea PRINCIPALĂ a schemei (cod din vederi.json, ex. PLAN / A / D); x_pct / y_pct = poziția punctului în procente din imagine.';
COMMENT ON COLUMN public.executie_noduri_suduri.pozitii_secundare IS 'Punctele aceleiași suduri pe alte vederi: [{vedere, x_pct, y_pct, certitudine?}] (validat de fn_executie_nod_pozitii_valide).';

-- ── dreptul: O SINGURĂ definiție (RLS, RPC, Storage). Execuția nu are drepturi pe proiect: dreptul e pe modul, proiectul vine din rând ──
CREATE FUNCTION public.fn_executie_nod_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_scriere IS FALSE AND u.access_level = 'viewer'))))
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_nod_drept(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_nod_drept(bigint, boolean) TO authenticated, service_role;

-- ── tranzițiile: lista albă (aceeași ca TRANZITII din src/nodCuplareLogica.js; testul de paritate citește blocul de mai jos) ──
CREATE FUNCTION public.fn_executie_nod_tranzitie(p_veche text, p_noua text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT EXISTS (SELECT 1 FROM (VALUES
    -- TRANZITII-START
    ('de_executat', 'insailat'), ('de_executat', 'sudat'), ('de_executat', 'anulat'),
    ('insailat', 'sudat'), ('insailat', 'anulat'),
    ('sudat', 'ndt'), ('sudat', 'reparat'),
    ('ndt', 'acceptat'), ('ndt', 'reparat'),
    ('reparat', 'sudat')
    -- TRANZITII-END
  ) t(v, n) WHERE t.v = p_veche AND t.n = p_noua)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_nod_tranzitie(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_nod_tranzitie(text, text) TO authenticated, service_role;

-- ── proveniența (L08): modificat_de / modificat_la le pune serverul, la orice INSERT / UPDATE; identitatea rândului e imuabilă (L16) ──
CREATE FUNCTION public.fn_executie_nod_sudura_provenienta() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.proiect_id, NEW.nod_cod, NEW.cod) IS DISTINCT FROM (OLD.proiect_id, OLD.nod_cod, OLD.cod) THEN
    RAISE EXCEPTION 'noduri: proiectul, nodul și codul sudurii nu se schimbă' USING ERRCODE = '23514';
  END IF;
  NEW.modificat_de := auth.uid();
  NEW.modificat_la := now();
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_nod_sudura_provenienta() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_nod_sudura_provenienta BEFORE INSERT OR UPDATE ON public.executie_noduri_suduri
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_nod_sudura_provenienta();

-- ── RPC-ul de schimbare a stării (L01, L02, L04, L07, L08, L09, L17, L20) ──
-- Ordinea: identitate -> lock pe rând (FOR UPDATE) -> drept pe proiectul rândului -> idempotență -> CAS -> tranziție -> reguli -> UPDATE.
-- Rezultat: {ok, duplicat, sudura} sau {ok:false, motiv:'conflict', sudura} (starea s-a schimbat între timp: clientul reîncarcă).
CREATE FUNCTION public.fn_executie_nod_sudura_stare(p_id bigint, p_stare_veche text, p_versiune integer, p_stare_noua text,
  p_data date, p_sudor text, p_buletin_ndt text, p_motiv text, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  r public.executie_noduri_suduri;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_sudor text := nullif(btrim(coalesce(p_sudor, '')), '');
  v_buletin text := nullif(btrim(coalesce(p_buletin_ndt, '')), '');
  v_motiv text := nullif(btrim(coalesce(p_motiv, '')), '');
  v_amprenta text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'noduri: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_cheie IS NULL OR p_stare_noua IS NULL OR p_data IS NULL THEN
    RAISE EXCEPTION 'noduri: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.executie_noduri_suduri WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_executie_nod_drept(r.proiect_id, true) THEN
    RAISE EXCEPTION 'noduri: sudura nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('id', p_id, 'veche', p_stare_veche, 'versiune', p_versiune, 'noua', p_stare_noua, 'data', p_data,
                                       'sudor', v_sudor, 'buletin', v_buletin, 'motiv', v_motiv)::text);
  -- reluarea aceleiași apăsări (aceeași cheie): același conținut = succesul de data trecută; alt conținut = eroare
  IF r.ultima_cheie = p_cheie THEN
    IF r.ultima_amprenta = v_amprenta THEN RETURN jsonb_build_object('ok', true, 'duplicat', true, 'sudura', to_jsonb(r)); END IF;
    RAISE EXCEPTION 'noduri: cheia apăsării a fost folosită pentru altă schimbare' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_noduri_suduri WHERE ultima_cheie = p_cheie) THEN
    RAISE EXCEPTION 'noduri: cheia apăsării a fost folosită pe altă sudură' USING ERRCODE = '22023';
  END IF;
  -- CAS: starea și versiunea văzute de client
  IF r.stare IS DISTINCT FROM p_stare_veche OR r.versiune IS DISTINCT FROM p_versiune THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'sudura', to_jsonb(r));
  END IF;
  IF NOT public.fn_executie_nod_tranzitie(r.stare, p_stare_noua) THEN
    RAISE EXCEPTION 'noduri: tranziție nepermisă % -> %', r.stare, p_stare_noua USING ERRCODE = '22023';
  END IF;
  IF p_data > v_azi OR p_data < v_azi - 7 THEN
    RAISE EXCEPTION 'noduri: data trebuie să fie între % și %', v_azi - 7, v_azi USING ERRCODE = '22023';
  END IF;
  IF r.data_stare IS NOT NULL AND p_data < r.data_stare THEN
    RAISE EXCEPTION 'noduri: data e înaintea ultimei schimbări (%)', r.data_stare USING ERRCODE = '22023';
  END IF;
  IF p_stare_noua = 'sudat' AND v_sudor IS NULL THEN RAISE EXCEPTION 'noduri: sudorul e obligatoriu' USING ERRCODE = '22023'; END IF;
  IF p_stare_noua = 'ndt' AND v_buletin IS NULL THEN RAISE EXCEPTION 'noduri: codul buletinului NDT e obligatoriu' USING ERRCODE = '22023'; END IF;
  IF p_stare_noua IN ('reparat', 'anulat') AND v_motiv IS NULL THEN RAISE EXCEPTION 'noduri: motivul e obligatoriu' USING ERRCODE = '22023'; END IF;

  UPDATE public.executie_noduri_suduri SET
    stare = p_stare_noua,
    data_stare = p_data,
    data_sudare = CASE WHEN p_stare_noua = 'sudat' AND r.stare IN ('de_executat', 'insailat') THEN p_data ELSE r.data_sudare END,
    sudor = CASE WHEN p_stare_noua IN ('insailat', 'sudat') AND v_sudor IS NOT NULL THEN v_sudor ELSE r.sudor END,
    buletin_ndt = CASE WHEN p_stare_noua = 'ndt' THEN v_buletin ELSE r.buletin_ndt END,
    motiv = CASE WHEN p_stare_noua IN ('reparat', 'anulat') THEN v_motiv ELSE r.motiv END,
    versiune = r.versiune + 1,
    ultima_cheie = p_cheie,
    ultima_amprenta = v_amprenta
  WHERE id = p_id
  RETURNING * INTO r;
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'sudura', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_nod_sudura_stare(bigint, text, integer, text, date, text, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_nod_sudura_stare(bigint, text, integer, text, date, text, text, text, uuid) TO authenticated;

-- ── RLS + privilegii: doar citire pentru aplicație (L07); scrierea trece numai prin RPC ──
ALTER TABLE public.executie_noduri_suduri ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_noduri_suduri FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_noduri_suduri TO authenticated, service_role;
-- secvența identității (numele implicit; postcondiția verifică pg_get_serial_sequence)
REVOKE ALL ON SEQUENCE public.executie_noduri_suduri_id_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY executie_noduri_suduri_citire ON public.executie_noduri_suduri FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));

-- ── Storage: bucket privat, doar citire pe același drept, doar pentru un nod care există pe proiectul din cale ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('noduri-scheme', 'noduri-scheme', false, 26214400, ARRAY['image/png', 'image/webp', 'image/jpeg', 'application/json']);

-- cale: <proiect_id>/<nod_cod>/<fisier>; alt bucket sau altă formă = refuz (CASE: conversia la bigint doar după verificarea formei;
-- bucket-ul verificat primul, ca obiectele altor bucket-uri să nu ajungă la interogare)
CREATE FUNCTION public.fn_executie_nod_obiect_citire(p_bucket text, p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p_bucket IS DISTINCT FROM 'noduri-scheme' THEN false
    WHEN p_name ~ '^[0-9]{1,18}/[A-Z0-9][A-Z0-9-]{1,59}/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' AND position('..' IN p_name) = 0 THEN
    EXISTS (SELECT 1 FROM public.executie_noduri_suduri s
             WHERE s.proiect_id = split_part(p_name, '/', 1)::bigint AND s.nod_cod = split_part(p_name, '/', 2))
    AND public.fn_executie_nod_drept(split_part(p_name, '/', 1)::bigint, false)
  ELSE false END
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_nod_obiect_citire(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_nod_obiect_citire(text, text) TO authenticated, service_role;
CREATE POLICY noduri_scheme_citire ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'noduri-scheme' AND public.fn_executie_nod_obiect_citire(bucket_id, name));

-- ── postcondiții ──
DO $post$
DECLARE v_rel oid := 'public.executie_noduri_suduri'::regclass;
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_noduri_suduri') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_noduri_suduri'
                     AND policyname = 'executie_noduri_suduri_citire' AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE') THEN
    RAISE EXCEPTION '20261201a post: RLS / politica tabelului';
  END IF;
  -- privilegiile efective: doar SELECT pentru authenticated / service_role, nimic pentru anon; nimic pe coloane
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
              WHERE has_table_privilege(r, v_rel, p))
     OR has_table_privilege('anon', v_rel, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
                 WHERE has_sequence_privilege(r, pg_get_serial_sequence('public.executie_noduri_suduri', 'id'), 'USAGE,SELECT,UPDATE')) THEN
    RAISE EXCEPTION '20261201a post: privilegii pe tabel / secventa';
  END IF;
  -- funcțiile: DEFINER doar unde trebuie, search_path fix, EXECUTE doar unde trebuie
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_nod\_%'
                AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                     OR p.prosecdef IS DISTINCT FROM (p.proname IN ('fn_executie_nod_drept', 'fn_executie_nod_sudura_stare', 'fn_executie_nod_obiect_citire'))
                     OR has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname <> 'fn_executie_nod_sudura_provenienta')
                     OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname NOT IN ('fn_executie_nod_sudura_provenienta', 'fn_executie_nod_sudura_stare'))))
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_nod\_%') <> 6 THEN
    RAISE EXCEPTION '20261201a post: functii (definer / search_path / EXECUTE)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_rel AND tgname = 'trg_executie_nod_sudura_provenienta' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '20261201a post: trigger-ul de proveniență';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'noduri-scheme' AND public IS FALSE)
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'noduri_scheme_citire'
           AND cmd = 'SELECT' AND roles = '{authenticated}') <> 1
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname <> 'noduri_scheme_citire'
                 AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%noduri-scheme%') THEN
    RAISE EXCEPTION '20261201a post: bucket privat / politica storage';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_noduri_suduri) OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'noduri-scheme') THEN
    RAISE EXCEPTION '20261201a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261201a_executie_noduri_suduri:' || txid_current() THEN
    RAISE EXCEPTION '20261201a: garda final invalida';
  END IF;
END $post$;
