-- Version 20261207120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261207a_executie_noduri_constructii — Execuție: elementele de CONSTRUCȚII ale unui nod de cuplare (fundații, cămine, suporturi, împrejmuire,
-- poartă, platforme, rigole, terasamente), cu etapele bifate zilnic pe telefon. Cererea lui Răzvan, 10.11.2026 (nodul Prunișor, planșa 1413-PR-C-00).
--
-- Ce face:
--   * UN tabel nou, executie_noduri_constructii: un rând = un element fizic al nodului (proiect_id + nod_cod, ca la executie_noduri_suduri din
--     20261201a), cu planșa de detaliu, planșa sursă, tipul, grupul (legătura cu echipamentul: rezervoare, spc, gara, robinete…), cantitatea și
--     unitatea, poziția și LISTA ORDONATĂ a etapelor lui (vocabular închis, validat de fn_executie_constr_etape_valide în CHECK).
--   * Etapele făcute stau pe ACELAȘI rând, în trei liste paralele completate în ordine: etape_data (ziua execuției), etape_de (cine a bifat;
--     NULL = stadiu inițial scris la import), etape_la (când s-a bifat). etapa_curenta e coloană GENERATĂ (nu se scrie, nu se desincronizează).
--     Fără tabel-copie și fără trigger de sincronizare: o singură scriere, un singur rând, un singur lock.
--   * Scrierea din aplicație: DOAR prin fn_executie_constr_etapa (SECURITY DEFINER): auth.uid() obligatoriu, lock FOR UPDATE pe rând, drept pe
--     proiectul rândului (fn_executie_nod_drept din 20261201a: owner sau user_module_access 'executie' editor / admin), cheie de idempotență per
--     apăsare, CAS pe versiune; „bifeaza” = DOAR etapa următoare, cu data în ultimele 7 zile (Europe/Bucharest) și nu înaintea etapei anterioare;
--     „retrage” = DOAR ultima etapă bifată, cu motiv (păstrat în ultima_retragere). Nicio scriere directă pentru anon / authenticated / service_role.
--   * Citirea: același drept ca la suduri (owner sau 'executie' de orice nivel), prin RLS, cu aceeași funcție (o singură definiție, L19).
-- Ce NU face: nicio dată (lista o încarcă chat-ul după „da”-ul lui Răzvan, cu SQL generat local de scripts/noduri_constructii_import_sql.mjs),
--   niciun drept, nicio atingere pe executie_noduri_suduri / storage / fn_executie_nod_* (doar FOLOSEȘTE fn_executie_nod_drept, cu amprenta verificată).
-- Ordinea lock-urilor (L06), aceeași pe toate căile: ÎNTÂI tabelul, APOI rândurile. RPC-ul: tabelul ROW EXCLUSIVE (explicit), apoi UN rând
--   FOR UPDATE. Importul (scripts/noduri_constructii_import_sql.mjs): tabelul SHARE ROW EXCLUSIVE, apoi rândurile. Cele două moduri de tabel se
--   exclud, deci un RPC și un import nu pot ține fiecare câte o parte (fără ciclu); două RPC-uri blochează câte un singur rând.
-- Revenire: supabase/revenire/20261207a_executie_noduri_constructii_ROLLBACK.sql. Test pe clonă: scripts/test_executie_noduri_constructii.sql.
DO $pre$
DECLARE v_drept regprocedure;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261207a_executie_noduri_constructii:' || txid_current() THEN
    RAISE EXCEPTION '20261207a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261207a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.executie_noduri_constructii') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_constr\_%') THEN
    RAISE EXCEPTION '20261207a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele: executie_proiecte.id bigint, auth.uid(), și dreptul din 20261201a cu amprenta EXACTĂ (corpul fără CR, limbajul, DEFINER,
  -- volatilitatea, search_path, tipul întors, proprietarul, EXECUTE: authenticated da, anon / PUBLIC nu)
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'bigint'
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20261207a: dependentele (executie_proiecte.id bigint, auth.uid) difera';
  END IF;
  v_drept := to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)');
  IF v_drept IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                     WHERE p.oid = v_drept AND md5(replace(p.prosrc, chr(13), '')) = '144649bae9a218b41b7e6df90cba5d9e'
                       AND l.lanname = 'sql' AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public, pg_temp']
                       AND p.prorettype = 'boolean'::regtype AND pg_get_userbyid(p.proowner) = 'postgres')
     OR has_function_privilege('anon', v_drept, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_drept, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = v_drept AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION '20261207a: dreptul fn_executie_nod_drept (20261201a) lipseste sau difera de amprenta asteptata';
  END IF;
END $pre$;

-- ── vocabularul etapelor (aceeași listă ca ETAPE din src/nodConstructiiLogica.js; testul de paritate citește blocul de mai jos) ──
-- Lista unui element: 1–12 coduri distincte din vocabular, ordonate, tablou 1-D cu indice de la 1, fără NULL.
CREATE FUNCTION public.fn_executie_constr_etape_valide(p text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE e text; v_vazute text[] := ARRAY[]::text[];
BEGIN
  -- verificări pe pași separați (fără să ne bazăm pe ordinea de evaluare a unui OR): forma tabloului, apoi fiecare element
  IF p IS NULL THEN RETURN false; END IF;
  IF cardinality(p) NOT BETWEEN 1 AND 12 THEN RETURN false; END IF;
  IF array_ndims(p) IS DISTINCT FROM 1 OR array_lower(p, 1) IS DISTINCT FROM 1 THEN RETURN false; END IF;
  FOREACH e IN ARRAY p LOOP
    IF e IS NULL OR e = ANY (v_vazute) THEN RETURN false; END IF;
    IF e NOT IN (
      -- ETAPE-START
      'trasare', 'sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie',
      'decofrare', 'umplutura', 'strat_suport', 'finisaj', 'confectionare', 'montaj'
      -- ETAPE-END
    ) THEN RETURN false; END IF;
    v_vazute := v_vazute || e;
  END LOOP;
  RETURN true;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_constr_etape_valide(text[]) FROM PUBLIC, anon, authenticated, service_role;

-- Etapele făcute: trei liste de aceeași lungime k (0 <= k <= numărul etapelor), 1-D de la indicele 1; data și momentul bifării nenule,
-- datele în ordine nedescrescătoare. Cine (etape_de) poate fi NULL doar pentru stadiul inițial scris de import (fără utilizator).
CREATE FUNCTION public.fn_executie_constr_bifari_valide(p_etape text[], p_data date[], p_de uuid[], p_la timestamptz[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE n integer; i integer;
BEGIN
  IF p_etape IS NULL OR p_data IS NULL OR p_de IS NULL OR p_la IS NULL THEN RETURN false; END IF;
  n := cardinality(p_data);
  IF cardinality(p_de) <> n OR cardinality(p_la) <> n OR n > cardinality(p_etape) THEN RETURN false; END IF;
  IF n = 0 THEN RETURN true; END IF;
  IF array_ndims(p_data) IS DISTINCT FROM 1 OR array_ndims(p_de) IS DISTINCT FROM 1 OR array_ndims(p_la) IS DISTINCT FROM 1
     OR array_lower(p_data, 1) IS DISTINCT FROM 1 OR array_lower(p_de, 1) IS DISTINCT FROM 1 OR array_lower(p_la, 1) IS DISTINCT FROM 1 THEN
    RETURN false;
  END IF;
  FOR i IN 1..n LOOP
    IF p_data[i] IS NULL OR p_la[i] IS NULL THEN RETURN false; END IF;
    IF i > 1 AND p_data[i] < p_data[i - 1] THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_constr_bifari_valide(text[], date[], uuid[], timestamptz[]) FROM PUBLIC, anon, authenticated, service_role;

-- ── tabelul ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_noduri_constructii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  nod_cod text NOT NULL CHECK (nod_cod ~ '^[A-Z0-9][A-Z0-9-]{1,59}$'),
  cod text NOT NULL CHECK (cod ~ '^[A-Z][A-Z0-9]{0,11}-[0-9]{1,3}$'),
  cod_detaliu text NOT NULL CHECK (cod_detaliu ~ '^[0-9A-Za-z][0-9A-Za-z-]{0,39}$'),
  plansa_sursa text NOT NULL CHECK (plansa_sursa ~ '^[0-9A-Za-z][0-9A-Za-z-]{0,39}$'),
  denumire text NOT NULL CHECK (length(denumire) BETWEEN 1 AND 200 AND denumire ~ '[^[:space:]]'),
  tip text NOT NULL CHECK (tip IN ('fundatie', 'camin', 'suport', 'imprejmuire', 'poarta', 'platforma', 'rigola', 'terasamente')),
  grup text NOT NULL CHECK (grup ~ '^[a-z][a-z0-9_]{0,29}$'),
  echipament text CHECK (echipament IS NULL OR (length(echipament) BETWEEN 1 AND 200 AND echipament ~ '[^[:space:]]')),
  cantitate numeric(10,2) NOT NULL DEFAULT 1 CHECK (cantitate > 0),
  um text NOT NULL DEFAULT 'buc' CHECK (um IN ('buc', 'm', 'mp', 'mc')),
  pozitie text CHECK (pozitie IS NULL OR (length(pozitie) BETWEEN 1 AND 300 AND pozitie ~ '[^[:space:]]')),
  certitudine text NOT NULL DEFAULT 'de_confirmat' CHECK (certitudine IN ('sigur', 'de_confirmat')),
  observatii text CHECK (observatii IS NULL OR (length(observatii) BETWEEN 1 AND 1000 AND observatii ~ '[^[:space:]]')),
  etape text[] NOT NULL,
  etape_data date[] NOT NULL DEFAULT '{}',
  etape_de uuid[] NOT NULL DEFAULT '{}',
  etape_la timestamptz[] NOT NULL DEFAULT '{}',
  etapa_curenta text GENERATED ALWAYS AS (CASE WHEN stare = 'anulat' THEN 'anulat'
                                               WHEN cardinality(etape_data) >= cardinality(etape) THEN 'gata'
                                               ELSE etape[cardinality(etape_data) + 1] END) STORED,
  stare text NOT NULL DEFAULT 'activ' CHECK (stare IN ('activ', 'anulat')),
  motiv text CHECK (motiv IS NULL OR (length(motiv) BETWEEN 1 AND 500 AND motiv ~ '[^[:space:]]')),
  ultima_retragere text CHECK (ultima_retragere IS NULL OR length(ultima_retragere) BETWEEN 1 AND 700),
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  ultima_cheie uuid,
  ultima_amprenta text CHECK (ultima_amprenta IS NULL OR ultima_amprenta ~ '^[0-9a-f]{32}$'),
  modificat_de uuid,
  modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_noduri_constructii_cod_uq UNIQUE (proiect_id, nod_cod, cod),
  CONSTRAINT executie_noduri_constructii_etape CHECK (public.fn_executie_constr_etape_valide(etape)),
  CONSTRAINT executie_noduri_constructii_bifari CHECK (public.fn_executie_constr_bifari_valide(etape, etape_data, etape_de, etape_la)),
  CONSTRAINT executie_noduri_constructii_anulat CHECK (stare = 'activ' OR motiv IS NOT NULL),
  CONSTRAINT executie_noduri_constructii_cheie CHECK ((ultima_cheie IS NULL) = (ultima_amprenta IS NULL))
);
CREATE INDEX executie_noduri_constructii_nod_idx ON public.executie_noduri_constructii (proiect_id, nod_cod, id);
CREATE UNIQUE INDEX executie_noduri_constructii_cheie_uq ON public.executie_noduri_constructii (ultima_cheie) WHERE ultima_cheie IS NOT NULL;
COMMENT ON TABLE public.executie_noduri_constructii IS
  'Execuție: elementele de construcții ale unui nod de cuplare (proiect + nod_cod), cu etapele bifate. Etapele se bifează DOAR prin fn_executie_constr_etapa. 20261207a.';
COMMENT ON COLUMN public.executie_noduri_constructii.etape IS 'Etapele elementului, în ordine (vocabular închis: fn_executie_constr_etape_valide).';
COMMENT ON COLUMN public.executie_noduri_constructii.etape_data IS 'Ziua execuției pentru primele k etape (k = câte sunt bifate); etape_de / etape_la = cine și când a bifat (etape_de NULL = stadiu inițial din import).';
COMMENT ON COLUMN public.executie_noduri_constructii.etapa_curenta IS 'Generată: etapa următoare de făcut, „gata” sau „anulat”.';
COMMENT ON COLUMN public.executie_noduri_constructii.grup IS 'Legătura cu instalația (ex. rezervoare, spc, gara, robinete, iluminat); filtrul din aplicație.';

-- ── proveniența (L08): modificat_de / modificat_la le pune serverul, la orice INSERT / UPDATE; identitatea rândului e imuabilă (L16) ──
CREATE FUNCTION public.fn_executie_constr_provenienta() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.proiect_id, NEW.nod_cod, NEW.cod) IS DISTINCT FROM (OLD.proiect_id, OLD.nod_cod, OLD.cod) THEN
    RAISE EXCEPTION 'constructii: proiectul, nodul și codul elementului nu se schimbă' USING ERRCODE = '23514';
  END IF;
  NEW.modificat_de := auth.uid();
  NEW.modificat_la := now();
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_constr_provenienta() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_constr_provenienta BEFORE INSERT OR UPDATE ON public.executie_noduri_constructii
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_constr_provenienta();

-- ── RPC-ul de bifare / retragere a unei etape (L01, L02, L04, L07, L08, L09, L17, L20) ──
-- Ordinea: identitate -> parametri -> lock pe tabel (ROW EXCLUSIVE) -> lock pe rând (FOR UPDATE) -> drept pe proiectul rândului -> idempotență ->
-- CAS -> stare -> regulile acțiunii -> UPDATE. Lock-ul pe tabel e ÎNAINTEA rândului (L06): un import care ține SHARE ROW EXCLUSIVE face RPC-ul să
-- aștepte aici, fără niciun rând blocat; invers, importul așteaptă RPC-ul la LOCK-ul lui de tabel, înaintea oricărui rând.
-- Rezultat: {ok, duplicat, element} sau {ok:false, motiv:'conflict', element} (rândul s-a schimbat între timp: clientul reîncarcă).
CREATE FUNCTION public.fn_executie_constr_etapa(p_id bigint, p_versiune integer, p_actiune text, p_etapa text, p_data date, p_motiv text, p_cheie uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  r public.executie_noduri_constructii;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_motiv text := nullif(btrim(coalesce(p_motiv, '')), '');
  v_k integer;
  v_amprenta text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'constructii: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_versiune IS NULL OR p_actiune IS NULL OR p_etapa IS NULL OR p_cheie IS NULL THEN
    RAISE EXCEPTION 'constructii: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  IF p_actiune NOT IN ('bifeaza', 'retrage') THEN RAISE EXCEPTION 'constructii: acțiune necunoscută' USING ERRCODE = '22023'; END IF;
  LOCK TABLE public.executie_noduri_constructii IN ROW EXCLUSIVE MODE;
  SELECT * INTO r FROM public.executie_noduri_constructii WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fn_executie_nod_drept(r.proiect_id, true) THEN
    RAISE EXCEPTION 'constructii: elementul nu există sau nu ai drept de scriere pe Execuție' USING ERRCODE = '42501';
  END IF;
  v_amprenta := md5(jsonb_build_object('id', p_id, 'versiune', p_versiune, 'actiune', p_actiune, 'etapa', p_etapa, 'data', p_data, 'motiv', v_motiv)::text);
  -- reluarea aceleiași apăsări (aceeași cheie): același conținut = succesul de data trecută; alt conținut = eroare
  IF r.ultima_cheie = p_cheie THEN
    IF r.ultima_amprenta = v_amprenta THEN RETURN jsonb_build_object('ok', true, 'duplicat', true, 'element', to_jsonb(r)); END IF;
    RAISE EXCEPTION 'constructii: cheia apăsării a fost folosită pentru altă schimbare' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_noduri_constructii WHERE ultima_cheie = p_cheie) THEN
    RAISE EXCEPTION 'constructii: cheia apăsării a fost folosită pe alt element' USING ERRCODE = '22023';
  END IF;
  -- CAS: versiunea văzută de client
  IF r.versiune IS DISTINCT FROM p_versiune THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'element', to_jsonb(r));
  END IF;
  IF r.stare IS DISTINCT FROM 'activ' THEN RAISE EXCEPTION 'constructii: elementul e anulat' USING ERRCODE = '22023'; END IF;
  v_k := cardinality(r.etape_data);

  IF p_actiune = 'bifeaza' THEN
    IF v_k >= cardinality(r.etape) THEN RAISE EXCEPTION 'constructii: toate etapele sunt deja bifate' USING ERRCODE = '22023'; END IF;
    IF p_etapa IS DISTINCT FROM r.etape[v_k + 1] THEN
      RAISE EXCEPTION 'constructii: se bifează doar etapa următoare (%)', r.etape[v_k + 1] USING ERRCODE = '22023';
    END IF;
    IF v_motiv IS NOT NULL THEN RAISE EXCEPTION 'constructii: motivul se dă doar la retragere' USING ERRCODE = '22023'; END IF;
    IF p_data IS NULL OR p_data > v_azi OR p_data < v_azi - 7 THEN
      RAISE EXCEPTION 'constructii: data trebuie să fie între % și %', v_azi - 7, v_azi USING ERRCODE = '22023';
    END IF;
    IF v_k > 0 AND p_data < r.etape_data[v_k] THEN
      RAISE EXCEPTION 'constructii: data e înaintea etapei anterioare (%)', r.etape_data[v_k] USING ERRCODE = '22023';
    END IF;
    UPDATE public.executie_noduri_constructii SET
      etape_data = r.etape_data || p_data,
      etape_de = r.etape_de || v_uid,
      etape_la = r.etape_la || now(),
      versiune = r.versiune + 1,
      ultima_cheie = p_cheie,
      ultima_amprenta = v_amprenta
    WHERE id = p_id
    RETURNING * INTO r;
  ELSE
    IF v_k = 0 THEN RAISE EXCEPTION 'constructii: nicio etapă bifată' USING ERRCODE = '22023'; END IF;
    IF p_etapa IS DISTINCT FROM r.etape[v_k] THEN
      RAISE EXCEPTION 'constructii: se retrage doar ultima etapă bifată (%)', r.etape[v_k] USING ERRCODE = '22023';
    END IF;
    IF p_data IS NOT NULL THEN RAISE EXCEPTION 'constructii: retragerea nu are dată' USING ERRCODE = '22023'; END IF;
    IF v_motiv IS NULL OR length(v_motiv) > 500 THEN RAISE EXCEPTION 'constructii: motivul retragerii e obligatoriu (cel mult 500 de caractere)' USING ERRCODE = '22023'; END IF;
    UPDATE public.executie_noduri_constructii SET
      etape_data = r.etape_data[1:v_k - 1],
      etape_de = r.etape_de[1:v_k - 1],
      etape_la = r.etape_la[1:v_k - 1],
      ultima_retragere = format('%s (bifată pe %s): %s', p_etapa, to_char(r.etape_data[v_k], 'DD.MM.YYYY'), v_motiv),
      versiune = r.versiune + 1,
      ultima_cheie = p_cheie,
      ultima_amprenta = v_amprenta
    WHERE id = p_id
    RETURNING * INTO r;
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'element', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_constr_etapa(bigint, integer, text, text, date, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_constr_etapa(bigint, integer, text, text, date, text, uuid) TO authenticated;

-- ── RLS + privilegii: doar citire pentru aplicație (L07); scrierea trece numai prin RPC ──
ALTER TABLE public.executie_noduri_constructii ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_noduri_constructii FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_noduri_constructii TO authenticated, service_role;
-- secvența identității (numele implicit; postcondiția verifică pg_get_serial_sequence)
REVOKE ALL ON SEQUENCE public.executie_noduri_constructii_id_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY executie_noduri_constructii_citire ON public.executie_noduri_constructii FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept(proiect_id, false));

-- ── postcondiții ──
DO $post$
DECLARE v_rel oid := 'public.executie_noduri_constructii'::regclass;
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_noduri_constructii') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_noduri_constructii'
                     AND policyname = 'executie_noduri_constructii_citire' AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE'
                     AND qual = 'fn_executie_nod_drept(proiect_id, false)') THEN
    RAISE EXCEPTION '20261207a post: RLS / politica tabelului';
  END IF;
  -- privilegiile efective: doar SELECT pentru authenticated / service_role, nimic pentru anon; nimic pe coloane; nimic pe secvență
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
              WHERE has_table_privilege(r, v_rel, p))
     OR has_table_privilege('anon', v_rel, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
                 WHERE has_sequence_privilege(r, pg_get_serial_sequence('public.executie_noduri_constructii', 'id'), p)) THEN
    RAISE EXCEPTION '20261207a post: privilegii pe tabel / secventa';
  END IF;
  -- funcțiile: exact 4, DEFINER doar RPC-ul, search_path fix, EXECUTE doar authenticated pe RPC; nimic pentru PUBLIC / anon / service_role
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_constr\_%') <> 4
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_constr\_%'
                   AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                        OR p.prosecdef IS DISTINCT FROM (p.proname = 'fn_executie_constr_etapa')
                        OR has_function_privilege('anon', p.oid, 'EXECUTE')
                        OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                        OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname = 'fn_executie_constr_etapa')
                        OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0))) THEN
    RAISE EXCEPTION '20261207a post: functii (numar / definer / search_path / EXECUTE)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_rel AND tgname = 'trg_executie_constr_provenienta' AND tgenabled = 'O'
                  AND tgfoid = 'public.fn_executie_constr_provenienta()'::regprocedure)
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = v_rel AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION '20261207a post: trigger-ul de proveniență';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_noduri_constructii) THEN
    RAISE EXCEPTION '20261207a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261207a_executie_noduri_constructii:' || txid_current() THEN
    RAISE EXCEPTION '20261207a: garda final invalida';
  END IF;
END $post$;
