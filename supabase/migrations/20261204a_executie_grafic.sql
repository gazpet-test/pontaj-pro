-- Version 20261204120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261204a_executie_grafic — Execuție: graficul de execuție importat din MS Project / Primavera (pasul 1, cerere Răzvan 09.11.2026).
--
-- Ce face:
--   * executie_grafic_revizii: o revizie = un fișier de grafic importat pe un proiect (ex. „LOT 2 R5 sep 2026”), cu amprenta sha256
--     a fișierului (UNIQUE pe proiect: același fișier nu se importă de două ori), data de stare din fișier, câmpurile de raport găsite
--     („% PLAN” / „% Complete”, scrise de om în coloane text), statisticile importului, amprenta conținutului importat
--     (continut_sha256) și CEL MULT o revizie activă pe proiect.
--   * executie_grafic_activitati: activitățile reviziei, în ordinea din fișier (ordine 0..n-1), cu WBS, nivel, nume, datele plan /
--     real / baseline, durata în zile lucrătoare, % realizat (MS Project), % plan și % raportat (coloanele de raport, dacă există),
--     jalon, rezumat, activ, predecesori și resurse (text) și deviz_cod (gol; pentru legarea de devize, mai târziu).
--   * Scrierea: DOAR prin fn_executie_grafic_importa (SECURITY INVOKER), executabilă numai de proprietar (postgres): chat-ul rulează
--     SQL-ul generat de scripts/grafic/import_mpp.py --sql, după „da”-ul lui Răzvan. Toată revizia într-o singură tranzacție (L02),
--     validată în BD ÎNAINTE de orice scriere (tipuri, intervale, zecimale, ordinea, start / finish obligatorii, UID / WBS unice,
--     arborele, numărul de activități = cel declarat = inventarul cititorului), idempotentă pe sha256 + conținut (L04/L16).
--     Nicio scriere pentru anon / authenticated / service_role (fără INSERT / UPDATE / DELETE, fără EXECUTE pe RPC).
--   * Citirea: owner sau user_module_access 'executie' (viewer / editor / admin), prin RLS, cu O SINGURĂ funcție de drept
--     (fn_executie_grafic_drept), folosită de ambele politici. Graficul arată întârzieri față de beneficiar: nu e deschis tuturor.
--   * importat_de = auth.uid() din RPC (NULL = importat de scriptul de pe server); niciodată din parametri (L08).
-- Ce NU face: nicio dată (importul îl face chat-ul), niciun drept, nicio atingere pe grafic_activitati (graficul intern editabil
--   din /grafic/:tip/:id, cu drum critic) — tabelele noi țin instantanee ale fișierelor primite, nu se editează.
-- Ordinea lock-urilor (L06), în RPC: lock consultativ pe proiect (pg_advisory_xact_lock) -> rândurile de revizie ale proiectului
--   (UPDATE activ) -> activitățile noi (INSERT; FK = KEY SHARE pe revizia nouă și pe executie_proiecte). Revenirea: revizii, apoi activitati.
-- Revenire: supabase/revenire/20261204a_executie_grafic_ROLLBACK.sql. Test pe clonă: scripts/test_executie_grafic.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261204a_executie_grafic:' || txid_current() THEN
    RAISE EXCEPTION '20261204a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261204a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.executie_grafic_revizii') IS NOT NULL OR to_regclass('public.executie_grafic_activitati') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN ('fn_executie_grafic_drept', 'fn_executie_grafic_importa', 'fn_executie_grafic_j_text',
                                                             'fn_executie_grafic_j_numar', 'fn_executie_grafic_j_data', 'fn_executie_grafic_j_bool')) THEN
    RAISE EXCEPTION '20261204a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele, cu tipurile citite din migrări (executie_proiecte.id bigint; profiles.is_owner; user_module_access)
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'bigint'
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access'
          AND column_name IN ('profile_id', 'module', 'access_level')) <> 3
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20261204a: dependentele (executie_proiecte.id bigint, profiles.is_owner, user_module_access, auth.uid) difera';
  END IF;
END $pre$;

-- ── tabelele ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_grafic_revizii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  eticheta text NOT NULL CHECK (length(eticheta) BETWEEN 1 AND 200 AND eticheta = btrim(eticheta) AND eticheta ~ '[^[:space:]]' AND strpos(eticheta, chr(10)) = 0),
  sursa_fisier text NOT NULL CHECK (length(sursa_fisier) BETWEEN 1 AND 1000),
  sursa_sha256 text NOT NULL CHECK (sursa_sha256 ~ '^[0-9a-f]{64}$'),
  continut_sha256 text NOT NULL CHECK (continut_sha256 ~ '^[0-9a-f]{64}$'),
  tip_fisier text CHECK (tip_fisier IS NULL OR length(tip_fisier) BETWEEN 1 AND 20),
  data_stare date,
  camp_pct_plan text CHECK (camp_pct_plan IS NULL OR length(camp_pct_plan) BETWEEN 1 AND 120),
  camp_pct_raportat text CHECK (camp_pct_raportat IS NULL OR length(camp_pct_raportat) BETWEEN 1 AND 120),
  nr_activitati integer NOT NULL CHECK (nr_activitati BETWEEN 1 AND 5000),
  metadate jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadate) = 'object' AND octet_length(metadate::text) <= 262144),
  importat_la timestamptz NOT NULL DEFAULT now(),
  importat_de uuid,
  activ boolean NOT NULL DEFAULT false,
  CONSTRAINT executie_grafic_revizii_sha_uq UNIQUE (proiect_id, sursa_sha256),
  CONSTRAINT executie_grafic_revizii_eticheta_uq UNIQUE (proiect_id, eticheta)
);
CREATE UNIQUE INDEX executie_grafic_revizii_activa_uq ON public.executie_grafic_revizii (proiect_id) WHERE activ;
COMMENT ON TABLE public.executie_grafic_revizii IS
  'Execuție: o revizie importată a graficului de execuție (fișier MS Project / Primavera) pe un proiect. Scriere DOAR prin fn_executie_grafic_importa. 20261204a.';
COMMENT ON COLUMN public.executie_grafic_revizii.camp_pct_raportat IS 'Câmpul din fișier al coloanei de raport „% Complete” (ex. TEXT2), dacă există; NULL = fără.';
COMMENT ON COLUMN public.executie_grafic_revizii.metadate IS 'Numărul de activități (= inventarul cititorului), câmpurile lipsă, valorile incerte (WBS + câmp + text, cel mult 300), aplicația, versiunea MPXJ și datele fișierului; formă și mărime fixate de RPC.';
COMMENT ON COLUMN public.executie_grafic_revizii.continut_sha256 IS 'Amprenta conținutului normalizat scris în tabele (activitățile + câmpurile reviziei): reimportul aceluiași fișier e „deja” doar cu același conținut.';
COMMENT ON COLUMN public.executie_grafic_revizii.importat_de IS 'auth.uid() la import; NULL = importat de scriptul de pe server (scripts/grafic/import_mpp.py).';

CREATE TABLE public.executie_grafic_activitati (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  revizie_id bigint NOT NULL REFERENCES public.executie_grafic_revizii(id) ON DELETE CASCADE,
  ordine integer NOT NULL CHECK (ordine BETWEEN 0 AND 4999),
  uid_sursa integer NOT NULL,
  wbs text NOT NULL CHECK (length(wbs) BETWEEN 1 AND 60),
  nivel smallint NOT NULL CHECK (nivel BETWEEN 0 AND 30),
  nume text NOT NULL DEFAULT '' CHECK (length(nume) <= 1000),
  start_plan date NOT NULL,
  finish_plan date NOT NULL,
  start_real date,
  finish_real date,
  start_baseline date,
  finish_baseline date,
  durata_zile numeric(9,2) CHECK (durata_zile >= 0),
  pct_realizat numeric(5,2) NOT NULL DEFAULT 0 CHECK (pct_realizat BETWEEN 0 AND 100),
  pct_plan numeric(5,2) CHECK (pct_plan BETWEEN 0 AND 100),
  pct_raportat numeric(5,2) CHECK (pct_raportat BETWEEN 0 AND 100),
  milestone boolean NOT NULL DEFAULT false,
  rezumat boolean NOT NULL DEFAULT false,
  activ boolean NOT NULL DEFAULT true,
  predecesori text NOT NULL DEFAULT '' CHECK (length(predecesori) <= 20000),
  resurse text NOT NULL DEFAULT '' CHECK (length(resurse) <= 4000),
  deviz_cod text CHECK (deviz_cod IS NULL OR (length(deviz_cod) BETWEEN 1 AND 60 AND deviz_cod ~ '[^[:space:]]')),
  CONSTRAINT executie_grafic_activitati_ordine_uq UNIQUE (revizie_id, ordine),
  CONSTRAINT executie_grafic_activitati_uid_uq UNIQUE (revizie_id, uid_sursa),
  CONSTRAINT executie_grafic_activitati_wbs_uq UNIQUE (revizie_id, wbs),
  CONSTRAINT executie_grafic_activitati_plan CHECK (finish_plan >= start_plan)
);
COMMENT ON TABLE public.executie_grafic_activitati IS
  'Execuție: activitățile unei revizii de grafic, în ordinea din fișier. Instantaneu (nu se editează). Scriere DOAR prin fn_executie_grafic_importa. 20261204a.';
COMMENT ON COLUMN public.executie_grafic_activitati.uid_sursa IS 'UniqueID din fișier (stabil între revizii la MS Project): cheia pentru compararea reviziilor și legarea de devize.';
COMMENT ON COLUMN public.executie_grafic_activitati.pct_realizat IS '% Complete din MS Project (pe durată). Procentul din raportul lunar, dacă există în fișier, e în pct_raportat.';
COMMENT ON COLUMN public.executie_grafic_activitati.durata_zile IS 'Durata în zile lucrătoare (minutele pe zi din fișier), rotunjită la 2 zecimale de script.';
COMMENT ON COLUMN public.executie_grafic_activitati.predecesori IS 'Text: „<WBS predecesor> <FS|SS|FF|SF>[+/-<zile>z|<procent>%]”, separate prin „; ”.';
COMMENT ON COLUMN public.executie_grafic_activitati.deviz_cod IS 'Codul articolului de deviz legat (gol la import; se completează într-un pas ulterior).';

-- ── dreptul de citire: O SINGURĂ definiție (ambele politici). Execuția nu are drepturi pe proiect: dreptul e pe modul, proiectul vine din rând ──
CREATE FUNCTION public.fn_executie_grafic_drept(p_proiect bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin')))
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_grafic_drept(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_grafic_drept(bigint) TO authenticated, service_role;

-- ── citirea valorilor din JSON-ul importului: tipul exact sau refuz (L13), fără conversii tacite ──
-- p_cale = numele câmpului, doar pentru mesaj; p_null = lipsa / null sunt permise (-> NULL)
CREATE FUNCTION public.fn_executie_grafic_j_text(p jsonb, p_cale text, p_max integer, p_null boolean) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN
    IF p_null THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'grafic: % lipsă', p_cale USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p) <> 'string' OR length(p #>> '{}') > p_max THEN
    RAISE EXCEPTION 'grafic: % trebuie să fie text de cel mult % caractere', p_cale, p_max USING ERRCODE = '22023';
  END IF;
  RETURN p #>> '{}';
END $f$;
CREATE FUNCTION public.fn_executie_grafic_j_numar(p jsonb, p_cale text, p_min numeric, p_max numeric, p_zecimale integer, p_null boolean) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE v numeric;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN
    IF p_null THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'grafic: % lipsă', p_cale USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p) <> 'number' THEN RAISE EXCEPTION 'grafic: % trebuie să fie număr', p_cale USING ERRCODE = '22023'; END IF;
  v := (p #>> '{}')::numeric;
  -- zecimalele în plus se refuză (numeric(…,2) le-ar rotunji în tăcere)
  IF v < p_min OR v > p_max OR v <> round(v, p_zecimale) THEN
    RAISE EXCEPTION 'grafic: % în afara intervalului [%, %] sau cu peste % zecimale', p_cale, p_min, p_max, p_zecimale USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $f$;
CREATE FUNCTION public.fn_executie_grafic_j_data(p jsonb, p_cale text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE s text; v date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN NULL; END IF;
  s := CASE WHEN jsonb_typeof(p) = 'string' THEN p #>> '{}' END;
  IF s IS NULL OR s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'grafic: % trebuie să fie dată AAAA-LL-ZZ validă', p_cale USING ERRCODE = '22023';
  END IF;
  BEGIN
    v := s::date;   -- 2026-02-30 / 2026-13-01 / anul 0000 = eroare aici, transformată în refuzul de mai jos
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;
  IF v IS NULL OR to_char(v, 'YYYY-MM-DD') <> s THEN
    RAISE EXCEPTION 'grafic: % trebuie să fie dată AAAA-LL-ZZ validă', p_cale USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $f$;
CREATE FUNCTION public.fn_executie_grafic_j_bool(p jsonb, p_cale text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'boolean' THEN RAISE EXCEPTION 'grafic: % trebuie să fie true / false', p_cale USING ERRCODE = '22023'; END IF;
  RETURN (p #>> '{}')::boolean;
END $f$;

-- ── importul: o revizie întreagă, într-o tranzacție; p = JSON-ul „gazpet.grafic.v1” din scripts/grafic/import_mpp.py ──
-- Pașii: (1) structura documentului; (2) TOATE activitățile citite cu tipul exact și normalizate (v_norm), ÎNAINTE de orice
-- scriere; (3) regulile de structură pe v_norm: ordine 0..n-1, start / finish plan obligatorii, UID și WBS unice, arborele
-- (părintele declarat = rândul precedent cu nivelul imediat superior; rădăcinile au nivelul primei activități); (4) amprenta
-- conținutului normalizat (continut_sha256); (5) lock + idempotență; (6) scrierea din v_norm. Aceleași reguli în Python:
-- valideaza_document din import_mpp.py; cazurile comune: test-fixtures/grafic/cazuri_validare.json (L19).
-- Ordinea lock-urilor (L06): advisory pe proiect -> revizii (UPDATE activ) -> activitati (INSERT). Nimic din alt modul nu se blochează.
CREATE FUNCTION public.fn_executie_grafic_importa(p jsonb, p_activeaza boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE
  r jsonb; v_acts jsonb; v_norm jsonb; a jsonb; n integer;
  v_proiect bigint; v_eticheta text; v_sursa text; v_sha text; v_nr integer; v_continut text;
  v_tip text; v_data_stare date; v_camp_plan text; v_camp_rap text;
  v_id bigint; v_exista public.executie_grafic_revizii%ROWTYPE; v_ins integer;
  v_stiva_uid integer[] := ARRAY[]::integer[]; v_stiva_niv integer[] := ARRAY[]::integer[];
  v_nivel integer; v_parinte integer; v_nivel_radacina integer; v_meta jsonb;
BEGIN
  -- (1) structura documentului
  IF p_activeaza IS NULL OR p IS NULL OR jsonb_typeof(p) <> 'object' OR p->>'format' IS DISTINCT FROM 'gazpet.grafic.v1' THEN
    RAISE EXCEPTION 'grafic: format necunoscut (aștept gazpet.grafic.v1)' USING ERRCODE = '22023';
  END IF;
  r := p->'revizie'; v_acts := p->'activitati';
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR jsonb_typeof(v_acts) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p->'avertismente') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'incerte') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p->'statistici') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'complet') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'grafic: structura JSON incompletă' USING ERRCODE = '22023';
  END IF;
  -- completitudinea (L12): abaterile de structură opresc importul; valorile incerte doar dacă un om le-a acceptat la generare
  IF jsonb_array_length(p->'avertismente') > 0 THEN
    RAISE EXCEPTION 'grafic: importul are avertismente de structură' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p->'incerte') > 0 AND (r->'incerte_acceptate') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'grafic: valori incerte neacceptate' USING ERRCODE = '22023';
  END IF;
  IF (p->>'complet')::boolean IS DISTINCT FROM (jsonb_array_length(p->'incerte') = 0) THEN
    RAISE EXCEPTION 'grafic: „complet” nu corespunde listelor' USING ERRCODE = '22023';
  END IF;
  -- metadatele stocate: fiecare componentă are formă și mărime fixe (aceleași reguli în valideaza_document), deci totalul nu poate
  -- trece de CHECK-ul tabelului: incerte <= 300 x (60 + 20 + 40 caractere, <= 4 octeți fiecare, + ~40 de structură) ~= 156 KB,
  -- campuri_lipsa <= 20 x 60, statisticile = 2 numere, restul câmpurilor mărginite mai jos -> sub 170 KB < 262.144.
  IF jsonb_array_length(p->'incerte') > 300 THEN
    RAISE EXCEPTION 'grafic: peste 300 de valori incerte (fișierul trebuie reparat la sursă)' USING ERRCODE = '22023';
  END IF;
  FOR a IN SELECT x FROM jsonb_array_elements(p->'incerte') x LOOP
    IF jsonb_typeof(a) <> 'object' THEN RAISE EXCEPTION 'grafic: o valoare incertă nu e obiect' USING ERRCODE = '22023'; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(a) k) IS DISTINCT FROM ARRAY['camp', 'valoare', 'wbs']::text[] THEN
      RAISE EXCEPTION 'grafic: o valoare incertă trebuie să aibă exact wbs, camp, valoare' USING ERRCODE = '22023';
    END IF;
    IF length(public.fn_executie_grafic_j_text(a->'wbs', 'incerte.wbs', 60, false)) < 1
       OR length(public.fn_executie_grafic_j_text(a->'camp', 'incerte.camp', 20, false)) < 1 THEN
      RAISE EXCEPTION 'grafic: wbs / camp gol într-o valoare incertă' USING ERRCODE = '22023';
    END IF;
    PERFORM public.fn_executie_grafic_j_text(a->'valoare', 'incerte.valoare', 40, false);
  END LOOP;
  IF jsonb_typeof(p->'campuri_lipsa') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'campuri_lipsa') > 20 THEN
    RAISE EXCEPTION 'grafic: campuri_lipsa trebuie să fie o listă de cel mult 20' USING ERRCODE = '22023';
  END IF;
  FOR a IN SELECT x FROM jsonb_array_elements(p->'campuri_lipsa') x LOOP
    IF length(public.fn_executie_grafic_j_text(a, 'campuri_lipsa', 60, false)) < 1 THEN
      RAISE EXCEPTION 'grafic: un câmp lipsă gol' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_proiect := public.fn_executie_grafic_j_numar(r->'proiect_id', 'proiect_id', 1, 9223372036854775807, 0, false)::bigint;
  v_eticheta := public.fn_executie_grafic_j_text(r->'eticheta', 'eticheta', 200, false);
  v_sursa := public.fn_executie_grafic_j_text(r->'sursa_fisier', 'sursa_fisier', 1000, false);
  v_sha := public.fn_executie_grafic_j_text(r->'sursa_sha256', 'sursa_sha256', 64, false);
  IF v_sha !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'grafic: sursa_sha256 invalid' USING ERRCODE = '22023'; END IF;
  v_tip := public.fn_executie_grafic_j_text(r->'tip_fisier', 'tip_fisier', 20, true);
  v_data_stare := public.fn_executie_grafic_j_data(r->'data_stare', 'data_stare');
  v_camp_plan := public.fn_executie_grafic_j_text(r->'camp_pct_plan', 'camp_pct_plan', 120, true);
  v_camp_rap := public.fn_executie_grafic_j_text(r->'camp_pct_raportat', 'camp_pct_raportat', 120, true);
  v_meta := jsonb_strip_nulls(jsonb_build_object(
              'aplicatie', public.fn_executie_grafic_j_text(r->'aplicatie', 'aplicatie', 60, true),
              'mpxj_versiune', public.fn_executie_grafic_j_text(r->'mpxj_versiune', 'mpxj_versiune', 20, true),
              'minute_pe_zi', public.fn_executie_grafic_j_numar(r->'minute_pe_zi', 'minute_pe_zi', 0, 1440, 0, true),
              'proiect_start', public.fn_executie_grafic_j_data(r->'proiect_start', 'proiect_start'),
              'proiect_finish', public.fn_executie_grafic_j_data(r->'proiect_finish', 'proiect_finish'),
              'randuri_goale', public.fn_executie_grafic_j_numar(r->'randuri_goale', 'randuri_goale', 0, 100000, 0, true),
              'sursa_octeti', public.fn_executie_grafic_j_numar(r->'sursa_octeti', 'sursa_octeti', 0, 2147483647, 0, true),
              'extras_la', public.fn_executie_grafic_j_text(r->'extras_la', 'extras_la', 40, true)));
  -- numitorul (L12): lungimea listei = numărul declarat = inventarul independent al cititorului (getTasks, fără rândurile goale)
  v_nr := jsonb_array_length(v_acts);
  IF v_nr NOT BETWEEN 1 AND 5000
     OR public.fn_executie_grafic_j_numar(p->'statistici'->'activitati', 'statistici.activitati', 1, 5000, 0, false) <> v_nr
     OR public.fn_executie_grafic_j_numar(p->'statistici'->'inventar_cititor', 'statistici.inventar_cititor', 1, 5000, 0, false) <> v_nr THEN
    RAISE EXCEPTION 'grafic: numărul activităților (%) nu corespunde celui declarat / inventarului cititorului', v_nr USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = v_proiect) THEN
    RAISE EXCEPTION 'grafic: proiectul % nu există', v_proiect USING ERRCODE = '22023';
  END IF;

  -- (2) activitățile, citite o singură dată cu tipul exact (orice abatere = refuz) și normalizate
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_acts) x WHERE jsonb_typeof(x) <> 'object') THEN
    RAISE EXCEPTION 'grafic: o activitate nu e obiect' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
           'ordine', public.fn_executie_grafic_j_numar(e->'ordine', 'ordine', 0, 4999, 0, false)::integer,
           'uid', public.fn_executie_grafic_j_numar(e->'uid', 'uid', -2147483648, 2147483647, 0, false)::integer,
           'parinte', public.fn_executie_grafic_j_numar(e->'parinte_uid', 'parinte_uid', -2147483648, 2147483647, 0, true)::integer,
           'wbs', public.fn_executie_grafic_j_text(e->'wbs', 'wbs', 60, false),
           'nivel', public.fn_executie_grafic_j_numar(e->'nivel', 'nivel', 0, 30, 0, false)::integer,
           'nume', public.fn_executie_grafic_j_text(e->'nume', 'nume', 1000, false),
           'start_plan', public.fn_executie_grafic_j_data(e->'start_plan', 'start_plan'),
           'finish_plan', public.fn_executie_grafic_j_data(e->'finish_plan', 'finish_plan'),
           'start_real', public.fn_executie_grafic_j_data(e->'start_real', 'start_real'),
           'finish_real', public.fn_executie_grafic_j_data(e->'finish_real', 'finish_real'),
           'start_baseline', public.fn_executie_grafic_j_data(e->'start_baseline', 'start_baseline'),
           'finish_baseline', public.fn_executie_grafic_j_data(e->'finish_baseline', 'finish_baseline'),
           'durata_zile', round(public.fn_executie_grafic_j_numar(e->'durata_zile', 'durata_zile', 0, 9999999.99, 2, true), 2),
           'pct_realizat', round(public.fn_executie_grafic_j_numar(e->'pct_realizat', 'pct_realizat', 0, 100, 2, false), 2),
           'pct_plan', round(public.fn_executie_grafic_j_numar(e->'pct_plan', 'pct_plan', 0, 100, 2, true), 2),
           'pct_raportat', round(public.fn_executie_grafic_j_numar(e->'pct_raportat', 'pct_raportat', 0, 100, 2, true), 2),
           'milestone', public.fn_executie_grafic_j_bool(e->'milestone', 'milestone'),
           'rezumat', public.fn_executie_grafic_j_bool(e->'rezumat', 'rezumat'),
           'activ', public.fn_executie_grafic_j_bool(e->'activ', 'activ'),
           'predecesori', public.fn_executie_grafic_j_text(e->'predecesori', 'predecesori', 20000, false),
           'resurse', public.fn_executie_grafic_j_text(e->'resurse', 'resurse', 4000, false)) ORDER BY o)
    INTO v_norm FROM jsonb_array_elements(v_acts) WITH ORDINALITY t(e, o);

  -- (3) regulile de structură (aceleași ca în valideaza_document din import_mpp.py)
  IF (SELECT count(DISTINCT x->>'uid') FROM jsonb_array_elements(v_norm) x) <> v_nr THEN
    RAISE EXCEPTION 'grafic: UniqueID duplicat' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x->>'wbs') FROM jsonb_array_elements(v_norm) x) <> v_nr THEN
    RAISE EXCEPTION 'grafic: WBS duplicat' USING ERRCODE = '22023';
  END IF;
  FOR a, n IN SELECT x, (o - 1)::integer FROM jsonb_array_elements(v_norm) WITH ORDINALITY t(x, o) LOOP
    IF (a->>'ordine')::integer <> n THEN
      RAISE EXCEPTION 'grafic: ordinea activităților nu e 0..n-1 (poziția %)', n USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(a->'start_plan') <> 'string' OR jsonb_typeof(a->'finish_plan') <> 'string' THEN
      RAISE EXCEPTION 'grafic: start / finish plan lipsă la %', a->>'wbs' USING ERRCODE = '22023';
    END IF;
    IF (a->>'finish_plan')::date < (a->>'start_plan')::date THEN
      RAISE EXCEPTION 'grafic: finish înaintea start-ului la %', a->>'wbs' USING ERRCODE = '22023';
    END IF;
    v_nivel := (a->>'nivel')::integer;
    v_parinte := (a->>'parinte')::integer;
    WHILE coalesce(array_length(v_stiva_niv, 1), 0) > 0 AND v_stiva_niv[array_length(v_stiva_niv, 1)] >= v_nivel LOOP
      v_stiva_niv := v_stiva_niv[1:array_length(v_stiva_niv, 1) - 1];
      v_stiva_uid := v_stiva_uid[1:array_length(v_stiva_uid, 1) - 1];
    END LOOP;
    IF v_parinte IS NULL THEN
      v_nivel_radacina := coalesce(v_nivel_radacina, v_nivel);
      IF coalesce(array_length(v_stiva_niv, 1), 0) > 0 OR v_nivel <> v_nivel_radacina THEN
        RAISE EXCEPTION 'grafic: rădăcină pe alt nivel decât prima activitate la %', a->>'wbs' USING ERRCODE = '22023';
      END IF;
    ELSIF coalesce(array_length(v_stiva_niv, 1), 0) = 0 OR v_stiva_uid[array_length(v_stiva_uid, 1)] <> v_parinte
          OR v_stiva_niv[array_length(v_stiva_niv, 1)] <> v_nivel - 1 THEN
      RAISE EXCEPTION 'grafic: nivelul / părintele nu corespund ordinii la %', a->>'wbs' USING ERRCODE = '22023';
    END IF;
    v_stiva_niv := v_stiva_niv || v_nivel;
    v_stiva_uid := v_stiva_uid || (a->>'uid')::integer;
  END LOOP;

  -- (4) amprenta conținutului care ajunge în tabele (aceleași valori normalizate) — „deja importat” doar cu același conținut
  -- (incertele intră în amprentă: aceeași valoare goală declarată o dată „lipsă” și o dată „necitibilă” nu e același import)
  v_continut := encode(sha256(convert_to(jsonb_build_object('activitati', v_norm, 'incerte', p->'incerte', 'tip_fisier', v_tip,
                                                            'data_stare', v_data_stare, 'camp_pct_plan', v_camp_plan,
                                                            'camp_pct_raportat', v_camp_rap)::text, 'UTF8')), 'hex');

  -- (5) lock + idempotență (L04): același fișier, aceeași etichetă și același conținut = aceeași revizie; orice altă combinație = refuz
  PERFORM pg_advisory_xact_lock(hashtextextended('executie_grafic:' || v_proiect, 0));
  SELECT * INTO v_exista FROM public.executie_grafic_revizii WHERE proiect_id = v_proiect AND sursa_sha256 = v_sha;
  IF FOUND THEN
    IF v_exista.eticheta = v_eticheta AND v_exista.continut_sha256 = v_continut THEN
      RETURN jsonb_build_object('ok', true, 'deja', true, 'revizie_id', v_exista.id, 'activitati', v_exista.nr_activitati, 'activ', v_exista.activ);
    END IF;
    RAISE EXCEPTION 'grafic: fișierul e deja importat pe proiect ca „%” (altă etichetă sau alt conținut / alte opțiuni de import)', v_exista.eticheta
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_grafic_revizii WHERE proiect_id = v_proiect AND eticheta = v_eticheta) THEN
    RAISE EXCEPTION 'grafic: eticheta „%” e deja folosită pe proiect pentru alt fișier', v_eticheta USING ERRCODE = '23505';
  END IF;

  -- (6) scrierea, din valorile normalizate
  INSERT INTO public.executie_grafic_revizii (proiect_id, eticheta, sursa_fisier, sursa_sha256, continut_sha256, tip_fisier, data_stare, camp_pct_plan, camp_pct_raportat, nr_activitati, metadate, importat_de, activ)
  VALUES (v_proiect, v_eticheta, v_sursa, v_sha, v_continut, v_tip, v_data_stare, v_camp_plan, v_camp_rap, v_nr,
          jsonb_build_object('statistici', jsonb_build_object('activitati', v_nr, 'inventar_cititor', v_nr),
                             'campuri_lipsa', p->'campuri_lipsa', 'incerte', p->'incerte') || v_meta,
          auth.uid(), false)
  RETURNING id INTO v_id;
  INSERT INTO public.executie_grafic_activitati (revizie_id, ordine, uid_sursa, wbs, nivel, nume, start_plan, finish_plan, start_real, finish_real, start_baseline, finish_baseline, durata_zile, pct_realizat, pct_plan, pct_raportat, milestone, rezumat, activ, predecesori, resurse)
  SELECT v_id, (x->>'ordine')::integer, (x->>'uid')::integer, x->>'wbs', (x->>'nivel')::smallint, x->>'nume',
         (x->>'start_plan')::date, (x->>'finish_plan')::date, (x->>'start_real')::date, (x->>'finish_real')::date,
         (x->>'start_baseline')::date, (x->>'finish_baseline')::date, (x->>'durata_zile')::numeric,
         (x->>'pct_realizat')::numeric, (x->>'pct_plan')::numeric, (x->>'pct_raportat')::numeric,
         (x->>'milestone')::boolean, (x->>'rezumat')::boolean, (x->>'activ')::boolean, x->>'predecesori', x->>'resurse'
    FROM jsonb_array_elements(v_norm) x;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  IF v_ins <> v_nr THEN RAISE EXCEPTION 'grafic: s-au scris % din % activități', v_ins, v_nr; END IF;

  IF p_activeaza THEN
    UPDATE public.executie_grafic_revizii SET activ = false WHERE proiect_id = v_proiect AND activ;
    UPDATE public.executie_grafic_revizii SET activ = true WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'deja', false, 'revizie_id', v_id, 'activitati', v_nr, 'activ', p_activeaza);
END $f$;
-- doar proprietarul (postgres) execută importul și funcțiile lui de citire a JSON-ului
REVOKE ALL ON FUNCTION public.fn_executie_grafic_importa(jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_grafic_j_text(jsonb, text, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_grafic_j_numar(jsonb, text, numeric, numeric, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_grafic_j_data(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_grafic_j_bool(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── RLS + privilegii: doar SELECT pentru authenticated / service_role, nimic pentru anon ──
ALTER TABLE public.executie_grafic_revizii ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_grafic_activitati ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_grafic_revizii, public.executie_grafic_activitati FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_grafic_revizii, public.executie_grafic_activitati TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.executie_grafic_revizii_id_seq, public.executie_grafic_activitati_id_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY executie_grafic_revizii_citire ON public.executie_grafic_revizii FOR SELECT TO authenticated
  USING (public.fn_executie_grafic_drept(proiect_id));
CREATE POLICY executie_grafic_activitati_citire ON public.executie_grafic_activitati FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.executie_grafic_revizii r WHERE r.id = revizie_id AND public.fn_executie_grafic_drept(r.proiect_id)));
CREATE INDEX executie_grafic_activitati_revizie_idx ON public.executie_grafic_activitati (revizie_id, id);

-- ── postcondiții ──
DO $post$
DECLARE v_rev oid := 'public.executie_grafic_revizii'::regclass; v_act oid := 'public.executie_grafic_activitati'::regclass;
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_rev) IS NOT TRUE OR (SELECT relrowsecurity FROM pg_class WHERE oid = v_act) IS NOT TRUE
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('executie_grafic_revizii', 'executie_grafic_activitati')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_grafic_revizii'
                     AND policyname = 'executie_grafic_revizii_citire' AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_grafic_activitati'
                     AND policyname = 'executie_grafic_activitati_citire' AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE') THEN
    RAISE EXCEPTION '20261204a post: RLS / politicile tabelelor';
  END IF;
  -- privilegiile efective, fiecare drept verificat separat (has_table_privilege cu listă = ORICARE)
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[v_rev, v_act]) t, unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                           unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
              WHERE has_table_privilege(r, t, p))
     OR has_table_privilege('anon', v_rev, 'SELECT') OR has_table_privilege('anon', v_act, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rev, 'SELECT') OR NOT has_table_privilege('authenticated', v_act, 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid IN (v_rev, v_act) AND attnum > 0 AND attacl IS NOT NULL)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['executie_grafic_revizii', 'executie_grafic_activitati']) t, unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                              unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
                 WHERE has_sequence_privilege(r, pg_get_serial_sequence('public.' || t, 'id'), p)) THEN
    RAISE EXCEPTION '20261204a post: privilegii pe tabele / secvente';
  END IF;
  -- funcțiile: DEFINER doar fn_executie_grafic_drept, search_path fix, EXECUTE doar unde trebuie
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('fn_executie_grafic_drept', 'fn_executie_grafic_importa', 'fn_executie_grafic_j_text',
                                                          'fn_executie_grafic_j_numar', 'fn_executie_grafic_j_data', 'fn_executie_grafic_j_bool')
                AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                     OR p.prosecdef IS DISTINCT FROM (p.proname = 'fn_executie_grafic_drept')
                     OR has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname = 'fn_executie_grafic_drept')
                     OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname = 'fn_executie_grafic_drept')))
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname IN ('fn_executie_grafic_drept', 'fn_executie_grafic_importa', 'fn_executie_grafic_j_text',
                                                      'fn_executie_grafic_j_numar', 'fn_executie_grafic_j_data', 'fn_executie_grafic_j_bool')) <> 6 THEN
    RAISE EXCEPTION '20261204a post: functii (definer / search_path / EXECUTE)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN (v_rev, v_act) AND NOT tgisinternal) THEN
    RAISE EXCEPTION '20261204a post: triggere neasteptate';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_grafic_revizii) OR EXISTS (SELECT 1 FROM public.executie_grafic_activitati) THEN
    RAISE EXCEPTION '20261204a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261204a_executie_grafic:' || txid_current() THEN
    RAISE EXCEPTION '20261204a: garda final invalida';
  END IF;
END $post$;
