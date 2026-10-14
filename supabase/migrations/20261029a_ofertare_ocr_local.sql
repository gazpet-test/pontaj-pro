-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261029a — Ofertare: pilot OCR local (D3a, docs/paw/PLAN_OCR_LOCAL_OFERTARE.md §5–§8, decizia Răzvan 14.10.2026) — r2
-- (după review r1: Copilot NO-GO 5 P1, Jakarinos NO-GO 3 P1 — rezervări per apel, dezacorduri canonice în BD, text ales derivat,
--  eșantion înghețat, idempotență concurentă, amprentă pentru revenire)
-- Obiecte NOI (nu atinge nicio tabelă / funcție existentă, nu scrie date):
--   * ofertare_ocr_rulari        — cererea de citire locală (documente + pagini înghețate, plafon). Stare DOAR prin RPC.
--   * ofertare_ocr_pagini        — append-only: textul unei pagini per cititor (lighton / mineru / reconciliat).
--   * ofertare_ocr_dezacorduri   — append-only: dezacordul canonic produs de scripts/ocr_local (item_id, item_sha256, cele două
--                                   citiri), scris DOAR dacă paginile ambilor cititori există deja în BD.
--   * ofertare_ocr_rezervari     — o rezervare de cost per apel plătit (deschisa → decontata / abandonata), decontare unică.
--   * ofertare_ocr_arbitraje     — append-only: decizia arbitrului pe UN dezacord (unică); textul ales e DERIVAT din citiri pentru
--                                   ales_lighton / ales_mineru, nenul pentru text_propus, NULL pentru needs_human.
--   * ofertare_ocr_verificari    — append-only: verdictul omului pe un arbitraj din eșantionul (înghețat) de audit.
--   * ofertare_ocr_pdf_jurnal    — jurnal + limită pentru linkurile semnate (final doar prin RPC).
--   * RPC UI (authenticated, poartă de rol în funcție): fn_ofertare_ocr_cerere, _anuleaza, _esantion, _verifica.
--   * RPC server (EXECUTE DOAR service_role; poarta = OCR_LOCAL_SECRET în edge, D3b): _preia, _stare, _pdf_rezerva, _pdf_final,
--     _scrie_pagina, _scrie_dezacord, _cost_rezerva, _scrie_arbitraj, _rezervare_abandon, _heartbeat.
-- Poarta pe cheltuială (pct. 10): cererea DOAR owner / responsabil / admin Ofertare (verificat și după blocarea licitației), doar
-- documente eligibile din licitație, plafon ≤ 15 USD, o rulare activă. Costul se REZERVĂ per apel înainte de apelul plătit; suma
-- (decontat + rezervări deschise + abandonate) nu poate depăși plafonul (CHECK + UPDATE atomic). Un apel deja plătit se poate
-- deconta și după oprirea rulării (cheltuiala nu dispare din evidență).
-- Promovarea în text_extras / ofertare_cantitati NU e aici. Secretul OCR_LOCAL_SECRET NU e creat aici.
-- Revenire: supabase/revenire/20261029a_ofertare_ocr_local_ROLLBACK.sql (verifică amprenta obiectelor; datele OCR se pierd).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261029a_ofertare_ocr_local:' || txid_current() THEN
    RAISE EXCEPTION '20261029a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261029a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname LIKE 'ofertare\_ocr\_%')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') THEN
    RAISE EXCEPTION '20261029a: obiectele exista deja';
  END IF;
  IF to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)') IS NULL
     OR to_regprocedure('public.fn_ofertare_document_eligibil(bigint)') IS NULL
     OR to_regprocedure('public.fn_are_acces_ofertare()') IS NULL
     OR to_regclass('public.ai_usage_log') IS NULL OR to_regclass('public.procese_heartbeat') IS NULL THEN
    RAISE EXCEPTION '20261029a: dependinte lipsa';
  END IF;
  IF (SELECT udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_documente_atribuire'
        AND column_name = 'pagini_necitite') IS DISTINCT FROM '_int4' THEN
    RAISE EXCEPTION '20261029a: ofertare_documente_atribuire.pagini_necitite nu e integer[]';
  END IF;
END $pre$;

-- ── tabele ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.ofertare_ocr_rulari (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id     bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  -- pagini înghețate la cerere: [{"document_id": 1247, "pagini": [325, 326, …]}, …] — serverul citește DOAR acestea
  documente        jsonb NOT NULL CHECK (jsonb_typeof(documente) = 'array' AND jsonb_array_length(documente) BETWEEN 1 AND 50),
  plafon_usd       numeric(8,2) NOT NULL CHECK (plafon_usd > 0 AND plafon_usd <= 15),
  cost_usd         numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  cost_rezervat    numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_rezervat >= 0),
  cost_abandonat   numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_abandonat >= 0),
  stare            text NOT NULL DEFAULT 'ceruta'
                   CHECK (stare IN ('ceruta', 'preluata', 'citita', 'arbitrata', 'finalizata', 'oprita', 'anulata', 'esuata')),
  oprit_motiv      text CHECK (oprit_motiv IS NULL OR length(oprit_motiv) <= 300),
  protocol         text CHECK (protocol IS NULL OR protocol ~ '^[a-z0-9.-]{1,40}$'),
  pornit_de        uuid NOT NULL,
  pornit_la        timestamptz NOT NULL DEFAULT now(),
  preluata_la      timestamptz,
  terminata_la     timestamptz,
  CHECK (cost_usd + cost_rezervat + cost_abandonat <= plafon_usd)
);
CREATE UNIQUE INDEX ofertare_ocr_rulari_o_activa ON public.ofertare_ocr_rulari (licitatie_id)
  WHERE stare IN ('ceruta', 'preluata', 'citita', 'arbitrata');

CREATE TABLE public.ofertare_ocr_pagini (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rulare_id     bigint NOT NULL REFERENCES public.ofertare_ocr_rulari(id),
  document_id   bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  pagina        integer NOT NULL CHECK (pagina BETWEEN 1 AND 9999),
  cititor       text NOT NULL CHECK (cititor IN ('lighton', 'mineru', 'reconciliat')),
  text          text NOT NULL CHECK (length(text) <= 200000),
  stare         text NOT NULL CHECK (stare IN ('citit', 'incomplet', 'needs_human', 'reconciliat')),
  protocol      text NOT NULL CHECK (protocol ~ '^[a-z0-9.-]{1,40}$'),
  model_rev     text NOT NULL CHECK (length(model_rev) BETWEEN 1 AND 200),
  raw_sha256    text NOT NULL CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
  image_sha256  text CHECK (image_sha256 IS NULL OR image_sha256 ~ '^[0-9a-f]{64}$'),
  garda         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(garda) = 'object'),
  creat_la      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rulare_id, document_id, pagina, cititor)
);
CREATE INDEX ofertare_ocr_pagini_doc_idx ON public.ofertare_ocr_pagini (document_id, pagina);

CREATE TABLE public.ofertare_ocr_dezacorduri (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rulare_id           bigint NOT NULL REFERENCES public.ofertare_ocr_rulari(id),
  document_id         bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  pagina              integer NOT NULL CHECK (pagina BETWEEN 1 AND 9999),
  item_id             text NOT NULL CHECK (item_id ~ '^p[0-9]{4}_b[0-9]{1,3}_[a-z0-9_]{1,30}$'),
  item_sha256         text NOT NULL CHECK (item_sha256 ~ '^[0-9a-f]{64}$'),
  tip                 text NOT NULL CHECK (tip IN ('text', 'rand_tabel', 'rand_lipsa_lighton', 'rand_lipsa_mineru', 'banda_intreaga', 'structura_tabele')),
  citire_lighton      text NOT NULL CHECK (length(citire_lighton) <= 50000),
  citire_mineru       text NOT NULL CHECK (length(citire_mineru) <= 50000),
  e_cantitate         boolean NOT NULL,
  anomalie_separator  boolean NOT NULL,
  creat_la            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rulare_id, document_id, item_id),
  UNIQUE (rulare_id, item_sha256),
  CHECK (substring(item_id FROM '^p([0-9]{4})_')::int = pagina)
);

CREATE TABLE public.ofertare_ocr_rezervari (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rulare_id    bigint NOT NULL REFERENCES public.ofertare_ocr_rulari(id),
  suma         numeric(10,4) NOT NULL CHECK (suma >= 0.0001 AND suma <= 1),
  stare        text NOT NULL DEFAULT 'deschisa' CHECK (stare IN ('deschisa', 'decontata', 'abandonata')),
  cost_real    numeric(10,4) CHECK (cost_real IS NULL OR (cost_real >= 0 AND cost_real <= suma)),
  creat_la     timestamptz NOT NULL DEFAULT now(),
  inchisa_la   timestamptz,
  CHECK ((stare = 'deschisa') = (inchisa_la IS NULL)),
  CHECK ((stare = 'decontata') = (cost_real IS NOT NULL))
);
CREATE INDEX ofertare_ocr_rezervari_deschise ON public.ofertare_ocr_rezervari (rulare_id) WHERE stare = 'deschisa';

CREATE TABLE public.ofertare_ocr_arbitraje (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dezacord_id         bigint NOT NULL UNIQUE REFERENCES public.ofertare_ocr_dezacorduri(id),
  rezervare_id        bigint NOT NULL UNIQUE REFERENCES public.ofertare_ocr_rezervari(id),
  decizie             text NOT NULL CHECK (decizie IN ('ales_lighton', 'ales_mineru', 'text_propus', 'needs_human')),
  text_ales           text CHECK (text_ales IS NULL OR length(text_ales) <= 50000),
  motiv               text NOT NULL CHECK (length(motiv) <= 200),
  e_cantitate_arbitru boolean NOT NULL,
  anomalie_arbitru    boolean NOT NULL,
  arbitru_model       text NOT NULL CHECK (length(arbitru_model) BETWEEN 1 AND 100),
  prompt_versiune     text NOT NULL CHECK (prompt_versiune ~ '^[a-z0-9._-]{1,40}$'),
  cost_usd            numeric(10,4) NOT NULL CHECK (cost_usd >= 0 AND cost_usd <= 1),
  creat_la            timestamptz NOT NULL DEFAULT now(),
  CHECK ((decizie = 'needs_human') = (text_ales IS NULL)),
  CHECK (decizie <> 'text_propus' OR btrim(text_ales) <> '')
);

CREATE TABLE public.ofertare_ocr_verificari (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  arbitraj_id   bigint NOT NULL UNIQUE REFERENCES public.ofertare_ocr_arbitraje(id),
  verdict       text NOT NULL CHECK (verdict IN ('corect', 'gresit')),
  nota          text CHECK (nota IS NULL OR length(nota) <= 500),
  verificat_de  uuid NOT NULL,
  verificat_la  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ofertare_ocr_pdf_jurnal (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  la           timestamptz NOT NULL DEFAULT now(),
  rulare_id    bigint,
  document_id  bigint,
  rezultat     text NOT NULL CHECK (rezultat IN ('rezervat', 'emis', 'cale_invalida', 'eroare_semnare', 'respins', 'limita'))
);
CREATE INDEX ofertare_ocr_pdf_jurnal_la_idx ON public.ofertare_ocr_pdf_jurnal (la DESC);

-- ── drepturi și RLS: citire pentru accesul Ofertare (nu jurnalul PDF), scriere DOAR prin RPC ──────────────
DO $drepturi$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ofertare_ocr_rulari', 'ofertare_ocr_pagini', 'ofertare_ocr_dezacorduri', 'ofertare_ocr_rezervari',
                           'ofertare_ocr_arbitraje', 'ofertare_ocr_verificari', 'ofertare_ocr_pdf_jurnal'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', pg_get_serial_sequence('public.' || t, 'id'));
    EXECUTE format('COMMENT ON TABLE public.%I IS %L', t, 'Pilot OCR local (20261029a). Scriere doar prin RPC fn_ofertare_ocr_*.');
    IF t <> 'ofertare_ocr_pdf_jurnal' THEN
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))', t || '_select', t);
    END IF;
  END LOOP;
END $drepturi$;

-- ── RPC pentru UI ────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_ofertare_ocr_cerere(p_licitatie_id bigint, p_document_ids bigint[], p_plafon_usd numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_docs jsonb := '[]'::jsonb; v_id bigint; d record; e jsonb; v_pag jsonb; v_rulare bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id), false) THEN
    RAISE EXCEPTION 'Doar owner-ul, responsabilul licitației sau un admin Ofertare pornește citirea locală' USING ERRCODE = '42501';
  END IF;
  IF p_plafon_usd IS NULL OR p_plafon_usd <= 0 OR p_plafon_usd > 15 OR p_plafon_usd <> round(p_plafon_usd, 2) THEN
    RAISE EXCEPTION 'Plafonul trebuie să fie între 0 și 15 USD (cel mult 2 zecimale)' USING ERRCODE = '22023';
  END IF;
  IF p_document_ids IS NULL OR cardinality(p_document_ids) = 0 OR cardinality(p_document_ids) > 50
     OR array_position(p_document_ids, NULL) IS NOT NULL
     OR cardinality(p_document_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_document_ids) x) THEN
    RAISE EXCEPTION 'Lista de documente e goală, prea lungă, are NULL sau duplicate' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  -- poarta se reverifică DUPĂ blocarea licitației (o responsabilitate retrasă concurent nu mai trece; review Copilot r1 P2)
  IF NOT FOUND OR NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id), false) THEN
    RAISE EXCEPTION 'Doar owner-ul, responsabilul licitației sau un admin Ofertare pornește citirea locală' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_rulari WHERE licitatie_id = p_licitatie_id AND stare IN ('ceruta', 'preluata', 'citita', 'arbitrata')) THEN
    RAISE EXCEPTION 'Există deja o rulare activă pe această licitație' USING ERRCODE = '55000';
  END IF;
  FOREACH v_id IN ARRAY p_document_ids LOOP
    SELECT id, licitatie_id, pagini_necitite INTO d FROM public.ofertare_documente_atribuire WHERE id = v_id;
    IF NOT FOUND OR d.licitatie_id <> p_licitatie_id THEN RAISE EXCEPTION 'Documentul % nu aparține licitației', v_id USING ERRCODE = '22023'; END IF;
    e := public.fn_ofertare_document_eligibil(v_id);
    IF NOT coalesce((e->>'eligibil')::boolean, false) THEN
      RAISE EXCEPTION 'Documentul % nu e eligibil (%)', v_id, e->>'motiv' USING ERRCODE = '55000';
    END IF;
    SELECT jsonb_agg(DISTINCT x ORDER BY x) INTO v_pag FROM unnest(d.pagini_necitite) x WHERE x BETWEEN 1 AND 9999;
    IF v_pag IS NULL THEN RAISE EXCEPTION 'Documentul % nu are pagini necitite valide', v_id USING ERRCODE = '55000'; END IF;
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('document_id', v_id, 'pagini', v_pag));
  END LOOP;
  INSERT INTO public.ofertare_ocr_rulari (licitatie_id, documente, plafon_usd, pornit_de)
  VALUES (p_licitatie_id, v_docs, p_plafon_usd, auth.uid()) RETURNING id INTO v_rulare;
  RETURN jsonb_build_object('ok', true, 'rulare_id', v_rulare, 'documente', v_docs);
END $f$;

CREATE FUNCTION public.fn_ofertare_ocr_anuleaza(p_rulare_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id FOR UPDATE;
  -- același mesaj pentru „nu există” și „nu ai drept” (nu se divulgă existența ID-ului; review Jakarinos r1)
  IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(public.fn_ofertare_source_pack_poate_decide(r.licitatie_id), false) THEN
    RAISE EXCEPTION 'Rulare inexistentă sau fără drept de anulare' USING ERRCODE = '42501';
  END IF;
  IF r.stare NOT IN ('ceruta', 'preluata', 'citita', 'arbitrata') THEN RAISE EXCEPTION 'Rularea e deja închisă (%)', r.stare USING ERRCODE = '55000'; END IF;
  -- rezervările deschise RĂMÂN (un apel deja plătit se poate deconta și după anulare)
  UPDATE public.ofertare_ocr_rulari SET stare = 'anulata', oprit_motiv = 'anulata de utilizator', terminata_la = now() WHERE id = p_rulare_id;
  RETURN jsonb_build_object('ok', true, 'rulare_id', p_rulare_id);
END $f$;

-- Eșantionul de audit (spec §4), DOAR după înghețarea setului (arbitrata / finalizata): 100% anomalii de separator și 100% text_propus
-- pe cantități, plus max(20, 10%) din restul arbitrajelor pe cantități (toate dacă sunt mai puține), ordonate după md5(rulare||item_sha256).
-- Deciziile needs_human NU intră: merg integral la om, nu sunt decizii automate de auditat.
CREATE FUNCTION public.fn_ofertare_ocr_esantion(p_rulare_id bigint)
RETURNS TABLE (arbitraj_id bigint, motiv_esantion text, verdict text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  WITH ok AS (
    SELECT 1 FROM public.ofertare_ocr_rulari r
     WHERE r.id = p_rulare_id AND r.stare IN ('arbitrata', 'finalizata') AND (SELECT public.fn_are_acces_ofertare())),
  a AS (
    SELECT x.id, x.decizie, (d.e_cantitate OR x.e_cantitate_arbitru) AS cant, (d.anomalie_separator OR x.anomalie_arbitru) AS anom, d.item_sha256
      FROM public.ofertare_ocr_arbitraje x JOIN public.ofertare_ocr_dezacorduri d ON d.id = x.dezacord_id
     WHERE d.rulare_id = p_rulare_id AND x.decizie <> 'needs_human' AND EXISTS (SELECT 1 FROM ok)),
  obligatoriu AS (
    SELECT id, CASE WHEN anom THEN 'anomalie_separator' ELSE 'text_propus_cantitate' END AS m FROM a
     WHERE anom OR (cant AND decizie = 'text_propus')),
  rest AS (SELECT id, item_sha256 FROM a WHERE cant AND id NOT IN (SELECT id FROM obligatoriu)),
  aleator AS (
    SELECT id, 'aleator_10pct'::text AS m FROM rest ORDER BY md5(p_rulare_id::text || item_sha256)
     LIMIT (SELECT greatest(20, ceil(0.1 * count(*))::int) FROM rest))
  SELECT s.id, s.m, v.verdict
    FROM (SELECT id, m FROM obligatoriu UNION ALL SELECT id, m FROM aleator) s
    LEFT JOIN public.ofertare_ocr_verificari v ON v.arbitraj_id = s.id
   ORDER BY s.id
$f$;

CREATE FUNCTION public.fn_ofertare_ocr_verifica(p_arbitraj_id bigint, p_verdict text, p_nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint; v_rulare bigint; v_id bigint;
BEGIN
  SELECT r.licitatie_id, r.id INTO v_lic, v_rulare
    FROM public.ofertare_ocr_arbitraje a JOIN public.ofertare_ocr_dezacorduri d ON d.id = a.dezacord_id
    JOIN public.ofertare_ocr_rulari r ON r.id = d.rulare_id
   WHERE a.id = p_arbitraj_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(public.fn_ofertare_source_pack_poate_decide(v_lic), false) THEN
    RAISE EXCEPTION 'Arbitraj inexistent sau fără drept de verificare' USING ERRCODE = '42501';
  END IF;
  IF p_verdict IS NULL OR p_verdict NOT IN ('corect', 'gresit') THEN RAISE EXCEPTION 'Verdict invalid' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fn_ofertare_ocr_esantion(v_rulare) s WHERE s.arbitraj_id = p_arbitraj_id) THEN
    RAISE EXCEPTION 'Arbitrajul nu e în eșantionul de audit (sau rularea nu e încă arbitrată)' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ofertare_ocr_verificari (arbitraj_id, verdict, nota, verificat_de)
  VALUES (p_arbitraj_id, p_verdict, nullif(btrim(coalesce(p_nota, '')), ''), auth.uid())
  ON CONFLICT (arbitraj_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Arbitrajul are deja un verdict' USING ERRCODE = '23505'; END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $f$;

-- ── RPC pentru edge-urile serverului AI (EXECUTE DOAR service_role) ───────────────────────────────────────
CREATE FUNCTION public.fn_ofertare_ocr_preia(p_protocol text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record;
BEGIN
  IF p_protocol IS NULL OR p_protocol !~ '^[a-z0-9.-]{1,40}$' THEN RAISE EXCEPTION 'protocol invalid' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE stare = 'ceruta' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('rulare', NULL); END IF;
  UPDATE public.ofertare_ocr_rulari SET stare = 'preluata', preluata_la = now(), protocol = p_protocol WHERE id = r.id;
  RETURN jsonb_build_object('rulare', jsonb_build_object('id', r.id, 'licitatie_id', r.licitatie_id, 'documente', r.documente, 'plafon_usd', r.plafon_usd));
END $f$;

-- Tranziții: preluata→citita→arbitrata→finalizata (citita→arbitrata doar fără rezervări deschise); orice activă → oprita / esuata.
CREATE FUNCTION public.fn_ofertare_ocr_stare(p_rulare_id bigint, p_stare text, p_motiv text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rulare inexistentă' USING ERRCODE = 'P0002'; END IF;
  IF NOT ((r.stare = 'preluata' AND p_stare = 'citita') OR (r.stare = 'citita' AND p_stare = 'arbitrata')
          OR (r.stare = 'arbitrata' AND p_stare = 'finalizata')
          OR (r.stare IN ('preluata', 'citita', 'arbitrata') AND p_stare IN ('oprita', 'esuata'))) THEN
    RAISE EXCEPTION 'Tranziție nepermisă % → %', r.stare, p_stare USING ERRCODE = '55000';
  END IF;
  IF p_stare = 'arbitrata' AND r.cost_rezervat <> 0 THEN
    RAISE EXCEPTION 'Mai sunt rezervări deschise: decontează-le sau abandonează-le înainte de arbitrata' USING ERRCODE = '55000';
  END IF;
  IF p_stare IN ('oprita', 'esuata') AND (p_motiv IS NULL OR btrim(p_motiv) = '' OR length(p_motiv) > 300) THEN
    RAISE EXCEPTION 'Motivul opririi e obligatoriu (max 300)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ofertare_ocr_rulari
     SET stare = p_stare, oprit_motiv = CASE WHEN p_stare IN ('oprita', 'esuata') THEN p_motiv ELSE oprit_motiv END,
         terminata_la = CASE WHEN p_stare IN ('finalizata', 'oprita', 'esuata') THEN now() ELSE terminata_la END
   WHERE id = p_rulare_id;
  RETURN jsonb_build_object('ok', true, 'stare', p_stare);
END $f$;

CREATE FUNCTION public.fn_ofertare_ocr_pdf_rezerva(p_rulare_id bigint, p_document_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_minut int; v_zi int; v_path text; v_id bigint; r record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ofertare_ocr_pdf'));
  SELECT count(*) INTO v_minut FROM public.ofertare_ocr_pdf_jurnal WHERE la > now() - interval '1 minute' AND rezultat <> 'limita';
  SELECT count(*) INTO v_zi FROM public.ofertare_ocr_pdf_jurnal WHERE la > now() - interval '24 hours' AND rezultat <> 'limita';
  IF v_minut >= 30 OR v_zi >= 500 THEN
    IF NOT EXISTS (SELECT 1 FROM public.ofertare_ocr_pdf_jurnal WHERE rezultat = 'limita' AND la > now() - interval '10 minutes') THEN
      INSERT INTO public.ofertare_ocr_pdf_jurnal (rulare_id, document_id, rezultat) VALUES (p_rulare_id, p_document_id, 'limita');
    END IF;
    RETURN jsonb_build_object('rezultat', 'limita');
  END IF;
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id;
  IF NOT FOUND OR r.stare <> 'preluata'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.documente) x WHERE (x->>'document_id')::bigint = p_document_id)
     OR NOT coalesce((public.fn_ofertare_document_eligibil(p_document_id)->>'eligibil')::boolean, false) THEN
    INSERT INTO public.ofertare_ocr_pdf_jurnal (rulare_id, document_id, rezultat) VALUES (p_rulare_id, p_document_id, 'respins');
    RETURN jsonb_build_object('rezultat', 'respins');
  END IF;
  SELECT fisier_path INTO v_path FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
  INSERT INTO public.ofertare_ocr_pdf_jurnal (rulare_id, document_id, rezultat) VALUES (p_rulare_id, p_document_id, 'rezervat') RETURNING id INTO v_id;
  RETURN jsonb_build_object('rezultat', 'permis', 'fisier_path', v_path, 'jurnal_id', v_id);
END $f$;

CREATE FUNCTION public.fn_ofertare_ocr_pdf_final(p_jurnal_id bigint, p_rezultat text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_n int;
BEGIN
  IF p_rezultat IS NULL OR p_rezultat NOT IN ('emis', 'cale_invalida', 'eroare_semnare') THEN RETURN false; END IF;
  UPDATE public.ofertare_ocr_pdf_jurnal SET rezultat = p_rezultat
   WHERE id = p_jurnal_id AND rezultat = 'rezervat' AND la > now() - interval '2 minutes';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END $f$;

-- Pagina citită: doar în rularea potrivită, doar pagini înghețate, sha verificat. Idempotent și la reîncercare CONCURENTĂ
-- (ON CONFLICT DO NOTHING + recitire); „deja” doar dacă TOATE câmpurile imuabile coincid, altfel conflict append-only.
CREATE FUNCTION public.fn_ofertare_ocr_scrie_pagina(p_rulare_id bigint, p_document_id bigint, p_pagina integer, p_cititor text,
                                                    p_text text, p_stare text, p_model_rev text, p_raw_sha256 text,
                                                    p_image_sha256 text, p_garda jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; v_old record; v_id bigint; v_garda jsonb := coalesce(p_garda, '{}'::jsonb);
BEGIN
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rulare inexistentă' USING ERRCODE = '55000'; END IF;
  IF NOT ((p_cititor IN ('lighton', 'mineru') AND r.stare = 'preluata') OR (p_cititor = 'reconciliat' AND r.stare = 'arbitrata')) THEN
    RAISE EXCEPTION 'Citirile se scriu doar în preluata, textul reconciliat doar în arbitrata (acum: %)', r.stare USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.documente) x
                  WHERE (x->>'document_id')::bigint = p_document_id AND (x->'pagini') @> to_jsonb(p_pagina)) THEN
    RAISE EXCEPTION 'Pagina % a documentului % nu e în rulare', p_pagina, p_document_id USING ERRCODE = '22023';
  END IF;
  IF p_text IS NULL OR p_raw_sha256 IS NULL OR encode(sha256(convert_to(p_text, 'UTF8')), 'hex') <> p_raw_sha256 THEN
    RAISE EXCEPTION 'raw_sha256 nu corespunde textului' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ofertare_ocr_pagini (rulare_id, document_id, pagina, cititor, text, stare, protocol, model_rev, raw_sha256, image_sha256, garda)
  VALUES (p_rulare_id, p_document_id, p_pagina, p_cititor, p_text, p_stare, r.protocol, p_model_rev, p_raw_sha256, p_image_sha256, v_garda)
  ON CONFLICT (rulare_id, document_id, pagina, cititor) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'deja', false, 'id', v_id); END IF;
  SELECT * INTO v_old FROM public.ofertare_ocr_pagini
   WHERE rulare_id = p_rulare_id AND document_id = p_document_id AND pagina = p_pagina AND cititor = p_cititor;
  IF v_old.text = p_text AND v_old.raw_sha256 = p_raw_sha256 AND v_old.stare = p_stare AND v_old.model_rev = p_model_rev
     AND v_old.image_sha256 IS NOT DISTINCT FROM p_image_sha256 AND v_old.garda = v_garda THEN
    RETURN jsonb_build_object('ok', true, 'deja', true, 'id', v_old.id);
  END IF;
  RAISE EXCEPTION 'Pagina există deja cu alt conținut (append-only)' USING ERRCODE = '23505';
END $f$;

-- Dezacordul canonic (din scripts/ocr_local compara): doar în citita, doar dacă paginile AMBILOR cititori există în BD.
-- Idempotent pe conținut identic; același item_id / item_sha256 cu alt conținut = conflict.
CREATE FUNCTION public.fn_ofertare_ocr_scrie_dezacord(p_rulare_id bigint, p_dezacord jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; v_doc bigint; v_pag int; v_id bigint; v_old record; a jsonb := p_dezacord;
BEGIN
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id FOR SHARE;
  IF NOT FOUND OR r.stare <> 'citita' THEN RAISE EXCEPTION 'Dezacordurile se scriu doar în citita' USING ERRCODE = '55000'; END IF;
  IF jsonb_typeof(a) <> 'object' OR jsonb_typeof(a->'e_cantitate') <> 'boolean' OR jsonb_typeof(a->'anomalie_separator') <> 'boolean' THEN
    RAISE EXCEPTION 'Dezacord invalid' USING ERRCODE = '22023';
  END IF;
  v_doc := (a->>'document_id')::bigint; v_pag := (a->>'pagina')::int;
  IF (SELECT count(*) FROM public.ofertare_ocr_pagini WHERE rulare_id = p_rulare_id AND document_id = v_doc AND pagina = v_pag
         AND cititor IN ('lighton', 'mineru')) <> 2 THEN
    RAISE EXCEPTION 'Lipsesc citirile ambilor cititori pentru pagina % a documentului %', v_pag, v_doc USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ofertare_ocr_dezacorduri (rulare_id, document_id, pagina, item_id, item_sha256, tip, citire_lighton, citire_mineru, e_cantitate, anomalie_separator)
  VALUES (p_rulare_id, v_doc, v_pag, a->>'item_id', a->>'item_sha256', a->>'tip', a->>'citire_lighton', a->>'citire_mineru',
          (a->>'e_cantitate')::boolean, (a->>'anomalie_separator')::boolean)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'deja', false, 'id', v_id); END IF;
  SELECT * INTO v_old FROM public.ofertare_ocr_dezacorduri
   WHERE rulare_id = p_rulare_id AND ((document_id = v_doc AND item_id = a->>'item_id') OR item_sha256 = a->>'item_sha256');
  IF v_old.document_id = v_doc AND v_old.pagina = v_pag AND v_old.item_id = a->>'item_id' AND v_old.item_sha256 = a->>'item_sha256'
     AND v_old.tip = a->>'tip' AND v_old.citire_lighton = a->>'citire_lighton' AND v_old.citire_mineru = a->>'citire_mineru'
     AND v_old.e_cantitate = (a->>'e_cantitate')::boolean AND v_old.anomalie_separator = (a->>'anomalie_separator')::boolean THEN
    RETURN jsonb_build_object('ok', true, 'deja', true, 'id', v_old.id);
  END IF;
  RAISE EXCEPTION 'Dezacordul există deja cu alt conținut (append-only)' USING ERRCODE = '23505';
END $f$;

-- Rezervare per apel plătit, ÎNAINTE de apel: atomic, granularitate 0,0001 USD (o sumă sub precizia stocată e refuzată, nu rotunjită
-- la zero), nu depășește plafonul. Întoarce id-ul rezervării sau NULL (refuz = edge-ul NU cheamă API-ul).
CREATE FUNCTION public.fn_ofertare_ocr_cost_rezerva(p_rulare_id bigint, p_suma numeric)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_n int; v_id bigint;
BEGIN
  IF p_suma IS NULL OR p_suma < 0.0001 OR p_suma > 1 OR p_suma <> round(p_suma, 4) THEN RETURN NULL; END IF;
  UPDATE public.ofertare_ocr_rulari SET cost_rezervat = cost_rezervat + p_suma
   WHERE id = p_rulare_id AND stare = 'citita' AND cost_usd + cost_rezervat + cost_abandonat + p_suma <= plafon_usd;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RETURN NULL; END IF;
  INSERT INTO public.ofertare_ocr_rezervari (rulare_id, suma) VALUES (p_rulare_id, p_suma) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Decontarea unei rezervări (o singură dată) + decizia arbitrului pe un dezacord existent al aceleiași rulări.
-- Textul ales e DERIVAT: ales_lighton → citire_lighton, ales_mineru → citire_mineru, text_propus → text nenul, needs_human → NULL.
-- Dacă rularea nu mai e în citita (oprită / anulată între timp), apelul plătit se DECONTEAZĂ oricum, dar decizia nu se înregistrează.
CREATE FUNCTION public.fn_ofertare_ocr_scrie_arbitraj(p_rezervare_id bigint, p_arbitraj jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE z record; r record; d record; a jsonb := p_arbitraj; v_cost numeric; v_text text; v_id bigint;
BEGIN
  SELECT * INTO z FROM public.ofertare_ocr_rezervari WHERE id = p_rezervare_id FOR UPDATE;
  IF NOT FOUND OR z.stare <> 'deschisa' THEN RAISE EXCEPTION 'Rezervare inexistentă sau deja închisă' USING ERRCODE = '55000'; END IF;
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = z.rulare_id FOR UPDATE;
  v_cost := (a->>'cost_usd')::numeric;
  IF v_cost IS NULL OR v_cost < 0 OR v_cost > z.suma OR v_cost <> round(v_cost, 4) THEN
    RAISE EXCEPTION 'Cost real invalid sau peste rezervare' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ofertare_ocr_rezervari SET stare = 'decontata', cost_real = v_cost, inchisa_la = now() WHERE id = p_rezervare_id;
  UPDATE public.ofertare_ocr_rulari SET cost_rezervat = cost_rezervat - z.suma, cost_usd = cost_usd + v_cost WHERE id = r.id;
  IF r.stare <> 'citita' THEN
    INSERT INTO public.ai_usage_log (function_name, model, tokens_in, tokens_out, cost_usd, ref_table, ref_id)
    VALUES ('ofertare-ocr-arbitreaza', left(a->>'arbitru_model', 100), coalesce((a->>'tokens_in')::int, 0), coalesce((a->>'tokens_out')::int, 0),
            v_cost, 'ofertare_ocr_rezervari', p_rezervare_id);
    RETURN jsonb_build_object('ok', true, 'decontat', true, 'arbitraj_inregistrat', false, 'motiv', 'rularea nu mai e în citita');
  END IF;
  SELECT * INTO d FROM public.ofertare_ocr_dezacorduri WHERE id = (a->>'dezacord_id')::bigint;
  IF NOT FOUND OR d.rulare_id <> r.id OR d.item_sha256 IS DISTINCT FROM a->>'item_sha256' THEN
    RAISE EXCEPTION 'Dezacordul nu aparține rulării rezervării sau amprenta diferă' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(a->'e_cantitate') <> 'boolean' OR jsonb_typeof(a->'anomalie_separator') <> 'boolean' THEN
    RAISE EXCEPTION 'Marcaje arbitru invalide' USING ERRCODE = '22023';
  END IF;
  v_text := CASE a->>'decizie' WHEN 'ales_lighton' THEN d.citire_lighton WHEN 'ales_mineru' THEN d.citire_mineru
                               WHEN 'text_propus' THEN a->>'text' ELSE NULL END;
  INSERT INTO public.ofertare_ocr_arbitraje (dezacord_id, rezervare_id, decizie, text_ales, motiv, e_cantitate_arbitru, anomalie_arbitru,
                                             arbitru_model, prompt_versiune, cost_usd)
  VALUES (d.id, p_rezervare_id, a->>'decizie', v_text, a->>'motiv', (a->>'e_cantitate')::boolean, (a->>'anomalie_separator')::boolean,
          a->>'arbitru_model', a->>'prompt_versiune', v_cost)
  RETURNING id INTO v_id;
  INSERT INTO public.ai_usage_log (function_name, model, tokens_in, tokens_out, cost_usd, ref_table, ref_id)
  VALUES ('ofertare-ocr-arbitreaza', a->>'arbitru_model', coalesce((a->>'tokens_in')::int, 0), coalesce((a->>'tokens_out')::int, 0),
          v_cost, 'ofertare_ocr_arbitraje', v_id);
  RETURN jsonb_build_object('ok', true, 'decontat', true, 'arbitraj_inregistrat', true, 'id', v_id);
END $f$;

-- Abandonarea unei rezervări rămase deschise (apel pierdut): doar după 15 minute, auditată (suma trece în cost_abandonat,
-- rămâne socotită în plafon). Nu se șterge nimic în tăcere.
CREATE FUNCTION public.fn_ofertare_ocr_rezervare_abandon(p_rezervare_id bigint)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE z record;
BEGIN
  SELECT * INTO z FROM public.ofertare_ocr_rezervari WHERE id = p_rezervare_id FOR UPDATE;
  IF NOT FOUND OR z.stare <> 'deschisa' OR z.creat_la > now() - interval '15 minutes' THEN RETURN false; END IF;
  PERFORM 1 FROM public.ofertare_ocr_rulari WHERE id = z.rulare_id FOR UPDATE;
  UPDATE public.ofertare_ocr_rezervari SET stare = 'abandonata', inchisa_la = now() WHERE id = p_rezervare_id;
  UPDATE public.ofertare_ocr_rulari SET cost_rezervat = cost_rezervat - z.suma, cost_abandonat = cost_abandonat + z.suma WHERE id = z.rulare_id;
  RETURN true;
END $f$;

CREATE FUNCTION public.fn_ofertare_ocr_heartbeat(p_ok boolean, p_mesaj text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  INSERT INTO public.procese_heartbeat (cheie, descriere, gazda, ultimul_semn, ultim_ok, ultim_mesaj, prag_minute, activ)
  VALUES ('ocr_local_ofertare', 'Pilot OCR local Ofertare (20261029a)', 'Gazpet-Claude', now(), coalesce(p_ok, false), left(coalesce(p_mesaj, ''), 300), 30, true)
  ON CONFLICT (cheie) DO UPDATE SET ultimul_semn = now(), ultim_ok = coalesce(p_ok, false), ultim_mesaj = left(coalesce(p_mesaj, ''), 300), activ = true;
  RETURN true;
END $f$;

-- ── execuție ─────────────────────────────────────────────────────────────────────────────────────────────
DO $exec$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_ocr_cerere(bigint,bigint[],numeric)', 'public.fn_ofertare_ocr_anuleaza(bigint)',
                           'public.fn_ofertare_ocr_esantion(bigint)', 'public.fn_ofertare_ocr_verifica(bigint,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_ocr_preia(text)', 'public.fn_ofertare_ocr_stare(bigint,text,text)',
                           'public.fn_ofertare_ocr_pdf_rezerva(bigint,bigint)', 'public.fn_ofertare_ocr_pdf_final(bigint,text)',
                           'public.fn_ofertare_ocr_scrie_pagina(bigint,bigint,integer,text,text,text,text,text,text,jsonb)',
                           'public.fn_ofertare_ocr_scrie_dezacord(bigint,jsonb)', 'public.fn_ofertare_ocr_cost_rezerva(bigint,numeric)',
                           'public.fn_ofertare_ocr_scrie_arbitraj(bigint,jsonb)', 'public.fn_ofertare_ocr_rezervare_abandon(bigint)',
                           'public.fn_ofertare_ocr_heartbeat(boolean,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $exec$;

-- ── postcondiții + amprenta (folosită de revenire ca să refuze dacă obiectele s-au schimbat după aplicare) ──
DO $post$
DECLARE t text; f text; rol text; v_fp text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ofertare_ocr_rulari', 'ofertare_ocr_pagini', 'ofertare_ocr_dezacorduri', 'ofertare_ocr_rezervari',
                           'ofertare_ocr_arbitraje', 'ofertare_ocr_verificari', 'ofertare_ocr_pdf_jurnal'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN RAISE EXCEPTION '20261029a: RLS oprit pe %', t; END IF;
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_table_privilege(rol, 'public.' || t, 'INSERT') OR has_table_privilege(rol, 'public.' || t, 'UPDATE')
         OR has_table_privilege(rol, 'public.' || t, 'DELETE') OR has_table_privilege(rol, 'public.' || t, 'TRUNCATE')
         OR has_table_privilege(rol, 'public.' || t, 'REFERENCES') OR has_table_privilege(rol, 'public.' || t, 'TRIGGER')
         OR has_any_column_privilege(rol, 'public.' || t, 'INSERT') OR has_any_column_privilege(rol, 'public.' || t, 'UPDATE')
         OR has_sequence_privilege(rol, pg_get_serial_sequence('public.' || t, 'id'), 'USAGE')
         OR has_sequence_privilege(rol, pg_get_serial_sequence('public.' || t, 'id'), 'UPDATE')
         OR has_sequence_privilege(rol, pg_get_serial_sequence('public.' || t, 'id'), 'SELECT')
         OR (rol <> 'authenticated' AND has_table_privilege(rol, 'public.' || t, 'SELECT'))
         OR (rol = 'authenticated' AND (t = 'ofertare_ocr_pdf_jurnal') = has_table_privilege(rol, 'public.' || t, 'SELECT')) THEN
        RAISE EXCEPTION '20261029a: postconditie drepturi % / %', t, rol;
      END IF;
    END LOOP;
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%' LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR (f ~ '_(cerere|anuleaza|esantion|verifica)\(' AND (NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE')))
       OR (f !~ '_(cerere|anuleaza|esantion|verifica)\(' AND (has_function_privilege('authenticated', f, 'EXECUTE') OR NOT has_function_privilege('service_role', f, 'EXECUTE'))) THEN
      RAISE EXCEPTION '20261029a: postconditie executie %', f;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%') <> 14 THEN
    RAISE EXCEPTION '20261029a: numar functii neasteptat';
  END IF;
  -- amprenta: definițiile + ACL-urile funcțiilor și coloanele + ACL-urile + politicile + constrângerile tabelelor noi
  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_fp FROM (
    SELECT p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '') AS x
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_ofertare\_ocr\_%'
    UNION ALL
    SELECT c.relname || ':' || coalesce(c.relacl::text, '') || ':' || (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || a.attnotnull::text, ',' ORDER BY a.attnum)
                                                                     FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
           || ':' || coalesce((SELECT string_agg(pg_get_constraintdef(k.oid), ',' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid), '')
           || ':' || coalesce((SELECT string_agg(po.polname || pg_get_expr(po.polqual, po.polrelid), ',' ORDER BY po.polname) FROM pg_policy po WHERE po.polrelid = c.oid), '')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'ofertare\_ocr\_%') s;
  EXECUTE format('COMMENT ON TABLE public.ofertare_ocr_rulari IS %L', 'Pilot OCR local (20261029a). Stare doar prin RPC. amprenta=' || v_fp);
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261029a_ofertare_ocr_local:' || txid_current() THEN
    RAISE EXCEPTION '20261029a: garda final invalida';
  END IF;
END $post$;
