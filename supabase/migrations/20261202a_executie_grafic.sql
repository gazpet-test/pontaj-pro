-- Version 20261202120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261202a_executie_grafic — Execuție: graficul de execuție importat din MS Project / Primavera (pasul 1, cerere Răzvan 09.11.2026).
--
-- Ce face:
--   * executie_grafic_revizii: o revizie = un fișier de grafic importat pe un proiect (ex. „LOT 2 R5 sep 2026”), cu amprenta sha256
--     a fișierului (UNIQUE pe proiect: același fișier nu se importă de două ori), data de stare din fișier, câmpurile de raport găsite
--     („% PLAN” / „% Complete”, scrise de om în coloane text), statisticile importului și CEL MULT o revizie activă pe proiect.
--   * executie_grafic_activitati: activitățile reviziei, în ordinea din fișier (ordine 0..n-1), cu WBS, nivel, nume, datele plan /
--     real / baseline, durata în zile lucrătoare, % realizat (MS Project), % plan și % raportat (coloanele de raport, dacă există),
--     jalon, rezumat, activ, predecesori și resurse (text) și deviz_cod (gol; pentru legarea de devize, mai târziu).
--   * Scrierea: DOAR prin fn_executie_grafic_importa (SECURITY INVOKER), executabilă numai de proprietar (postgres): chat-ul rulează
--     SQL-ul generat de scripts/grafic/import_mpp.py --sql, după „da”-ul lui Răzvan. Toată revizia într-o singură tranzacție (L02),
--     validată în BD (tipuri, intervale, zecimale, ordinea, numărul de activități = cel declarat), idempotentă pe sha256 (L04/L16).
--     Nicio scriere pentru anon / authenticated / service_role (fără INSERT / UPDATE / DELETE, fără EXECUTE pe RPC).
--   * Citirea: owner sau user_module_access 'executie' (viewer / editor / admin), prin RLS, cu O SINGURĂ funcție de drept
--     (fn_executie_grafic_drept), folosită de ambele politici. Graficul arată întârzieri față de beneficiar: nu e deschis tuturor.
--   * importat_de = auth.uid() din RPC (NULL = importat de scriptul de pe server); niciodată din parametri (L08).
-- Ce NU face: nicio dată (importul îl face chat-ul), niciun drept, nicio atingere pe grafic_activitati (graficul intern editabil
--   din /grafic/:tip/:id, cu drum critic) — tabelele noi țin instantanee ale fișierelor primite, nu se editează.
-- Ordinea lock-urilor (L06), în RPC: lock consultativ pe proiect (pg_advisory_xact_lock) -> rândurile de revizie ale proiectului
--   (UPDATE activ) -> activitățile noi (INSERT; FK = KEY SHARE pe revizia nouă și pe executie_proiecte). Revenirea: revizii, apoi activitati.
-- Revenire: supabase/revenire/20261202a_executie_grafic_ROLLBACK.sql. Test pe clonă: scripts/test_executie_grafic.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261202a_executie_grafic:' || txid_current() THEN
    RAISE EXCEPTION '20261202a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261202a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.executie_grafic_revizii') IS NOT NULL OR to_regclass('public.executie_grafic_activitati') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname IN ('fn_executie_grafic_drept', 'fn_executie_grafic_importa', 'fn_executie_grafic_j_text',
                                                             'fn_executie_grafic_j_numar', 'fn_executie_grafic_j_data', 'fn_executie_grafic_j_bool')) THEN
    RAISE EXCEPTION '20261202a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele, cu tipurile citite din migrări (executie_proiecte.id bigint; profiles.is_owner; user_module_access)
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'bigint'
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access'
          AND column_name IN ('profile_id', 'module', 'access_level')) <> 3
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20261202a: dependentele (executie_proiecte.id bigint, profiles.is_owner, user_module_access, auth.uid) difera';
  END IF;
END $pre$;

-- ── tabelele ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_grafic_revizii (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  eticheta text NOT NULL CHECK (length(eticheta) BETWEEN 1 AND 200 AND eticheta = btrim(eticheta) AND eticheta ~ '[^[:space:]]' AND strpos(eticheta, chr(10)) = 0),
  sursa_fisier text NOT NULL CHECK (length(sursa_fisier) BETWEEN 1 AND 1000),
  sursa_sha256 text NOT NULL CHECK (sursa_sha256 ~ '^[0-9a-f]{64}$'),
  tip_fisier text CHECK (tip_fisier IS NULL OR length(tip_fisier) BETWEEN 1 AND 20),
  data_stare date,
  camp_pct_plan text CHECK (camp_pct_plan IS NULL OR length(camp_pct_plan) BETWEEN 1 AND 120),
  camp_pct_raportat text CHECK (camp_pct_raportat IS NULL OR length(camp_pct_raportat) BETWEEN 1 AND 120),
  nr_activitati integer NOT NULL CHECK (nr_activitati BETWEEN 1 AND 5000),
  metadate jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadate) = 'object' AND octet_length(metadate::text) <= 65536),
  importat_la timestamptz NOT NULL DEFAULT now(),
  importat_de uuid,
  activ boolean NOT NULL DEFAULT false,
  CONSTRAINT executie_grafic_revizii_sha_uq UNIQUE (proiect_id, sursa_sha256),
  CONSTRAINT executie_grafic_revizii_eticheta_uq UNIQUE (proiect_id, eticheta)
);
CREATE UNIQUE INDEX executie_grafic_revizii_activa_uq ON public.executie_grafic_revizii (proiect_id) WHERE activ;
COMMENT ON TABLE public.executie_grafic_revizii IS
  'Execuție: o revizie importată a graficului de execuție (fișier MS Project / Primavera) pe un proiect. Scriere DOAR prin fn_executie_grafic_importa. 20261202a.';
COMMENT ON COLUMN public.executie_grafic_revizii.camp_pct_raportat IS 'Câmpul din fișier al coloanei de raport „% Complete” (ex. TEXT2), dacă există; NULL = fără.';
COMMENT ON COLUMN public.executie_grafic_revizii.metadate IS 'Statisticile importului, câmpurile lipsă, valorile incerte (WBS + câmp + text), aplicația și versiunea MPXJ.';
COMMENT ON COLUMN public.executie_grafic_revizii.importat_de IS 'auth.uid() la import; NULL = importat de scriptul de pe server (scripts/grafic/import_mpp.py).';

CREATE TABLE public.executie_grafic_activitati (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  revizie_id bigint NOT NULL REFERENCES public.executie_grafic_revizii(id) ON DELETE CASCADE,
  ordine integer NOT NULL CHECK (ordine BETWEEN 0 AND 4999),
  uid_sursa integer NOT NULL,
  wbs text NOT NULL CHECK (length(wbs) BETWEEN 1 AND 60),
  nivel smallint NOT NULL CHECK (nivel BETWEEN 0 AND 30),
  nume text NOT NULL DEFAULT '' CHECK (length(nume) <= 1000),
  start_plan date,
  finish_plan date,
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
  CONSTRAINT executie_grafic_activitati_plan CHECK (start_plan IS NULL OR finish_plan IS NULL OR finish_plan >= start_plan)
);
COMMENT ON TABLE public.executie_grafic_activitati IS
  'Execuție: activitățile unei revizii de grafic, în ordinea din fișier. Instantaneu (nu se editează). Scriere DOAR prin fn_executie_grafic_importa. 20261202a.';
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
-- Ordinea lock-urilor (L06): advisory pe proiect -> revizii (UPDATE activ) -> activitati (INSERT). Nimic din alt modul nu se blochează.
CREATE FUNCTION public.fn_executie_grafic_importa(p jsonb, p_activeaza boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
DECLARE
  r jsonb; v_acts jsonb; e jsonb; n integer;
  v_proiect bigint; v_eticheta text; v_sursa text; v_sha text; v_nr integer;
  v_id bigint; v_exista public.executie_grafic_revizii%ROWTYPE; v_ins integer;
  v_start date; v_finish date;
BEGIN
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
  v_proiect := public.fn_executie_grafic_j_numar(r->'proiect_id', 'proiect_id', 1, 9223372036854775807, 0, false)::bigint;
  v_eticheta := public.fn_executie_grafic_j_text(r->'eticheta', 'eticheta', 200, false);
  v_sursa := public.fn_executie_grafic_j_text(r->'sursa_fisier', 'sursa_fisier', 1000, false);
  v_sha := public.fn_executie_grafic_j_text(r->'sursa_sha256', 'sursa_sha256', 64, false);
  IF v_sha !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'grafic: sursa_sha256 invalid' USING ERRCODE = '22023'; END IF;
  v_nr := jsonb_array_length(v_acts);
  IF v_nr NOT BETWEEN 1 AND 5000
     OR public.fn_executie_grafic_j_numar(p->'statistici'->'activitati', 'statistici.activitati', 1, 5000, 0, false) <> v_nr THEN
    RAISE EXCEPTION 'grafic: numărul activităților (%) nu corespunde celui declarat', v_nr USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = v_proiect) THEN
    RAISE EXCEPTION 'grafic: proiectul % nu există', v_proiect USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('executie_grafic:' || v_proiect, 0));
  -- idempotență (L04): același fișier pe același proiect = aceeași revizie; altă etichetă / alt fișier sub aceeași etichetă = refuz
  SELECT * INTO v_exista FROM public.executie_grafic_revizii WHERE proiect_id = v_proiect AND sursa_sha256 = v_sha;
  IF FOUND THEN
    IF v_exista.eticheta = v_eticheta AND v_exista.nr_activitati = v_nr THEN
      RETURN jsonb_build_object('ok', true, 'deja', true, 'revizie_id', v_exista.id, 'activitati', v_exista.nr_activitati, 'activ', v_exista.activ);
    END IF;
    RAISE EXCEPTION 'grafic: fișierul e deja importat pe proiect ca „%”', v_exista.eticheta USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_grafic_revizii WHERE proiect_id = v_proiect AND eticheta = v_eticheta) THEN
    RAISE EXCEPTION 'grafic: eticheta „%” e deja folosită pe proiect pentru alt fișier', v_eticheta USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.executie_grafic_revizii (proiect_id, eticheta, sursa_fisier, sursa_sha256, tip_fisier, data_stare,
                                              camp_pct_plan, camp_pct_raportat, nr_activitati, metadate, importat_de, activ)
  VALUES (v_proiect, v_eticheta, v_sursa, v_sha,
          public.fn_executie_grafic_j_text(r->'tip_fisier', 'tip_fisier', 20, true),
          public.fn_executie_grafic_j_data(r->'data_stare', 'data_stare'),
          public.fn_executie_grafic_j_text(r->'camp_pct_plan', 'camp_pct_plan', 120, true),
          public.fn_executie_grafic_j_text(r->'camp_pct_raportat', 'camp_pct_raportat', 120, true),
          v_nr,
          jsonb_build_object('statistici', p->'statistici', 'campuri_lipsa', coalesce(p->'campuri_lipsa', '[]'::jsonb), 'incerte', p->'incerte')
            || jsonb_strip_nulls(jsonb_build_object('aplicatie', r->'aplicatie', 'mpxj_versiune', r->'mpxj_versiune', 'minute_pe_zi', r->'minute_pe_zi',
                                                    'proiect_start', r->'proiect_start', 'proiect_finish', r->'proiect_finish',
                                                    'randuri_goale', r->'randuri_goale', 'sursa_octeti', r->'sursa_octeti', 'extras_la', r->'extras_la')),
          auth.uid(), false)
  RETURNING id INTO v_id;

  FOR e, n IN SELECT x, (o - 1)::integer FROM jsonb_array_elements(v_acts) WITH ORDINALITY t(x, o) LOOP
    IF jsonb_typeof(e) <> 'object' THEN RAISE EXCEPTION 'grafic: activitatea % nu e obiect', n USING ERRCODE = '22023'; END IF;
    -- ordinea din fișier se păstrează exact (UI-ul construiește arborele pe ordine + nivel)
    IF public.fn_executie_grafic_j_numar(e->'ordine', 'ordine', 0, 4999, 0, false) <> n THEN
      RAISE EXCEPTION 'grafic: ordinea activităților nu e 0..n-1 (poziția %)', n USING ERRCODE = '22023';
    END IF;
    v_start := public.fn_executie_grafic_j_data(e->'start_plan', 'start_plan');
    v_finish := public.fn_executie_grafic_j_data(e->'finish_plan', 'finish_plan');
    INSERT INTO public.executie_grafic_activitati (revizie_id, ordine, uid_sursa, wbs, nivel, nume, start_plan, finish_plan,
                                                   start_real, finish_real, start_baseline, finish_baseline, durata_zile,
                                                   pct_realizat, pct_plan, pct_raportat, milestone, rezumat, activ, predecesori, resurse)
    VALUES (v_id, n,
            public.fn_executie_grafic_j_numar(e->'uid', 'uid', -2147483648, 2147483647, 0, false)::integer,
            public.fn_executie_grafic_j_text(e->'wbs', 'wbs', 60, false),
            public.fn_executie_grafic_j_numar(e->'nivel', 'nivel', 0, 30, 0, false)::smallint,
            public.fn_executie_grafic_j_text(e->'nume', 'nume', 1000, false),
            v_start, v_finish,
            public.fn_executie_grafic_j_data(e->'start_real', 'start_real'),
            public.fn_executie_grafic_j_data(e->'finish_real', 'finish_real'),
            public.fn_executie_grafic_j_data(e->'start_baseline', 'start_baseline'),
            public.fn_executie_grafic_j_data(e->'finish_baseline', 'finish_baseline'),
            public.fn_executie_grafic_j_numar(e->'durata_zile', 'durata_zile', 0, 9999999.99, 2, true),
            public.fn_executie_grafic_j_numar(e->'pct_realizat', 'pct_realizat', 0, 100, 2, false),
            public.fn_executie_grafic_j_numar(e->'pct_plan', 'pct_plan', 0, 100, 2, true),
            public.fn_executie_grafic_j_numar(e->'pct_raportat', 'pct_raportat', 0, 100, 2, true),
            public.fn_executie_grafic_j_bool(e->'milestone', 'milestone'),
            public.fn_executie_grafic_j_bool(e->'rezumat', 'rezumat'),
            public.fn_executie_grafic_j_bool(e->'activ', 'activ'),
            public.fn_executie_grafic_j_text(e->'predecesori', 'predecesori', 20000, false),
            public.fn_executie_grafic_j_text(e->'resurse', 'resurse', 4000, false));
  END LOOP;
  SELECT count(*) INTO v_ins FROM public.executie_grafic_activitati WHERE revizie_id = v_id;
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
    RAISE EXCEPTION '20261202a post: RLS / politicile tabelelor';
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
    RAISE EXCEPTION '20261202a post: privilegii pe tabele / secvente';
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
    RAISE EXCEPTION '20261202a post: functii (definer / search_path / EXECUTE)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN (v_rev, v_act) AND NOT tgisinternal) THEN
    RAISE EXCEPTION '20261202a post: triggere neasteptate';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_grafic_revizii) OR EXISTS (SELECT 1 FROM public.executie_grafic_activitati) THEN
    RAISE EXCEPTION '20261202a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261202a_executie_grafic:' || txid_current() THEN
    RAISE EXCEPTION '20261202a: garda final invalida';
  END IF;
END $post$;
