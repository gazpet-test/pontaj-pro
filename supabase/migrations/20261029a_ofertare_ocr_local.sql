-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261029a — Ofertare: pilot OCR local (D3a, docs/paw/PLAN_OCR_LOCAL_OFERTARE.md §5–§8, decizia Răzvan 14.10.2026)
-- Obiecte NOI (nu atinge nicio tabelă / funcție existentă, nu scrie date):
--   * ofertare_ocr_rulari        — o cerere de citire locală pe o licitație (documente + pagini înghețate la cerere, plafon de cost).
--                                   Singura tabelă cu stare care se schimbă, DOAR prin RPC (fără UPDATE/DELETE din API).
--   * ofertare_ocr_pagini        — append-only: textul unei pagini per cititor (lighton / mineru / reconciliat) per rulare.
--   * ofertare_ocr_arbitraje     — append-only: tripletul pentru fiecare dezacord (citire LightOn / citire MinerU / decizia
--                                   arbitrului) cu amprenta item_sha256 a pipeline-ului (scripts/ocr_local).
--   * ofertare_ocr_verificari    — append-only: verdictul omului (corect / greșit) pe un arbitraj din eșantionul de audit.
--   * ofertare_ocr_pdf_jurnal    — append-only (final doar prin RPC): jurnal + limită pentru linkurile semnate către PDF-uri.
--   * RPC pentru UI (authenticated, poartă de rol în funcție): fn_ofertare_ocr_cerere, fn_ofertare_ocr_anuleaza,
--     fn_ofertare_ocr_verifica, fn_ofertare_ocr_esantion.
--   * RPC pentru edge-urile serverului AI (EXECUTE DOAR service_role; poarta = secretul OCR_LOCAL_SECRET verificat în edge, D3b):
--     fn_ofertare_ocr_preia, fn_ofertare_ocr_stare, fn_ofertare_ocr_pdf_rezerva, fn_ofertare_ocr_pdf_final,
--     fn_ofertare_ocr_scrie_pagina, fn_ofertare_ocr_cost_rezerva, fn_ofertare_ocr_scrie_arbitraj, fn_ofertare_ocr_heartbeat.
-- Poarta pe cheltuială (pct. 10): cererea o face DOAR owner / responsabilul licitației / admin Ofertare
-- (fn_ofertare_source_pack_poate_decide), doar pe documente eligibile (fn_ofertare_document_eligibil) din licitația cerută,
-- plafon ≤ 15 USD, o singură rulare activă pe licitație. Costul arbitrajului se REZERVĂ înainte de fiecare apel plătit și nu
-- poate depăși plafonul (verificare atomică în BD).
-- Promovarea în text_extras / ofertare_cantitati NU e aici (pas separat, „da promovare”). Secretul OCR_LOCAL_SECRET NU e creat aici.
-- Revenire: supabase/revenire/20261029a_ofertare_ocr_local_ROLLBACK.sql (șterge obiectele noi — datele OCR se pierd).
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
  IF to_regclass('public.ofertare_ocr_rulari') IS NOT NULL OR to_regclass('public.ofertare_ocr_pagini') IS NOT NULL
     OR to_regclass('public.ofertare_ocr_arbitraje') IS NOT NULL OR to_regclass('public.ofertare_ocr_verificari') IS NOT NULL
     OR to_regclass('public.ofertare_ocr_pdf_jurnal') IS NOT NULL
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
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_documente_atribuire'
        AND column_name = 'pagini_necitite') IS DISTINCT FROM 'ARRAY' THEN
    RAISE EXCEPTION '20261029a: ofertare_documente_atribuire.pagini_necitite nu e array';
  END IF;
END $pre$;

-- ── tabele ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.ofertare_ocr_rulari (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id   bigint NOT NULL REFERENCES public.ofertare_licitatii(id),
  -- pagini înghețate la cerere: [{"document_id": 1247, "pagini": [325, 326, …]}, …] — serverul citește DOAR acestea
  documente      jsonb NOT NULL CHECK (jsonb_typeof(documente) = 'array' AND jsonb_array_length(documente) BETWEEN 1 AND 50),
  plafon_usd     numeric(8,2) NOT NULL CHECK (plafon_usd > 0 AND plafon_usd <= 15),
  cost_usd       numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  cost_rezervat  numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_rezervat >= 0),
  stare          text NOT NULL DEFAULT 'ceruta'
                 CHECK (stare IN ('ceruta', 'preluata', 'citita', 'arbitrata', 'finalizata', 'oprita', 'anulata', 'esuata')),
  oprit_motiv    text CHECK (oprit_motiv IS NULL OR length(oprit_motiv) <= 300),
  protocol       text CHECK (protocol IS NULL OR protocol ~ '^[a-z0-9.-]{1,40}$'),
  pornit_de      uuid NOT NULL,
  pornit_la      timestamptz NOT NULL DEFAULT now(),
  preluata_la    timestamptz,
  terminata_la   timestamptz,
  CHECK (cost_usd + cost_rezervat <= plafon_usd)
);
CREATE UNIQUE INDEX ofertare_ocr_rulari_o_activa ON public.ofertare_ocr_rulari (licitatie_id)
  WHERE stare IN ('ceruta', 'preluata', 'citita', 'arbitrata');
COMMENT ON TABLE public.ofertare_ocr_rulari IS 'Pilot OCR local (20261029a). Stare doar prin RPC. Plafon cost <= 15 USD, verificat atomic.';

CREATE TABLE public.ofertare_ocr_pagini (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rulare_id     bigint NOT NULL REFERENCES public.ofertare_ocr_rulari(id),
  document_id   bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  pagina        integer NOT NULL CHECK (pagina BETWEEN 1 AND 100000),
  cititor       text NOT NULL CHECK (cititor IN ('lighton', 'mineru', 'reconciliat')),
  text          text NOT NULL CHECK (length(text) <= 200000),
  stare         text NOT NULL CHECK (stare IN ('citit', 'de_arbitrat', 'needs_human', 'reconciliat')),
  protocol      text NOT NULL CHECK (protocol ~ '^[a-z0-9.-]{1,40}$'),
  model_rev     text NOT NULL CHECK (length(model_rev) BETWEEN 1 AND 200),
  raw_sha256    text NOT NULL CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
  image_sha256  text CHECK (image_sha256 IS NULL OR image_sha256 ~ '^[0-9a-f]{64}$'),
  garda         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(garda) = 'object'),
  creat_la      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rulare_id, document_id, pagina, cititor)
);
CREATE INDEX ofertare_ocr_pagini_doc_idx ON public.ofertare_ocr_pagini (document_id, pagina);
COMMENT ON TABLE public.ofertare_ocr_pagini IS 'Pilot OCR local (20261029a). Append-only: textul unei pagini per cititor per rulare. NU e text_extras.';

CREATE TABLE public.ofertare_ocr_arbitraje (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rulare_id           bigint NOT NULL REFERENCES public.ofertare_ocr_rulari(id),
  document_id         bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id),
  pagina              integer NOT NULL CHECK (pagina BETWEEN 1 AND 100000),
  item_id             text NOT NULL CHECK (item_id ~ '^p[0-9]{4}_b[0-9]+_[a-z0-9_]+$'),
  item_sha256         text NOT NULL CHECK (item_sha256 ~ '^[0-9a-f]{64}$'),
  tip                 text NOT NULL CHECK (tip IN ('text', 'rand_tabel', 'rand_lipsa_lighton', 'rand_lipsa_mineru', 'banda_intreaga', 'structura_tabele')),
  citire_lighton      text NOT NULL CHECK (length(citire_lighton) <= 50000),
  citire_mineru       text NOT NULL CHECK (length(citire_mineru) <= 50000),
  decizie             text NOT NULL CHECK (decizie IN ('ales_lighton', 'ales_mineru', 'text_propus', 'needs_human')),
  text_ales           text CHECK (text_ales IS NULL OR length(text_ales) <= 50000),
  motiv               text NOT NULL CHECK (length(motiv) <= 200),
  e_cantitate         boolean NOT NULL,
  anomalie_separator  boolean NOT NULL,
  arbitru_model       text NOT NULL CHECK (length(arbitru_model) BETWEEN 1 AND 100),
  prompt_versiune     text NOT NULL CHECK (prompt_versiune ~ '^[a-z0-9._-]{1,40}$'),
  cost_usd            numeric(10,4) NOT NULL CHECK (cost_usd >= 0 AND cost_usd <= 1),
  creat_la            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rulare_id, item_sha256),
  CHECK ((decizie = 'needs_human') = (text_ales IS NULL))
);
CREATE INDEX ofertare_ocr_arbitraje_rulare_idx ON public.ofertare_ocr_arbitraje (rulare_id);
COMMENT ON TABLE public.ofertare_ocr_arbitraje IS 'Pilot OCR local (20261029a). Append-only: triplet citire LightOn / MinerU / decizia arbitrului (arbitrat de Claude).';

CREATE TABLE public.ofertare_ocr_verificari (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  arbitraj_id   bigint NOT NULL REFERENCES public.ofertare_ocr_arbitraje(id),
  verdict       text NOT NULL CHECK (verdict IN ('corect', 'gresit')),
  nota          text CHECK (nota IS NULL OR length(nota) <= 500),
  verificat_de  uuid NOT NULL,
  verificat_la  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (arbitraj_id)
);
COMMENT ON TABLE public.ofertare_ocr_verificari IS 'Pilot OCR local (20261029a). Append-only: verdictul omului pe imagine, un singur verdict per arbitraj.';

CREATE TABLE public.ofertare_ocr_pdf_jurnal (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  la           timestamptz NOT NULL DEFAULT now(),
  rulare_id    bigint,
  document_id  bigint,
  rezultat     text NOT NULL CHECK (rezultat IN ('rezervat', 'emis', 'cale_invalida', 'eroare_semnare', 'respins', 'limita'))
);
CREATE INDEX ofertare_ocr_pdf_jurnal_la_idx ON public.ofertare_ocr_pdf_jurnal (la DESC);
COMMENT ON TABLE public.ofertare_ocr_pdf_jurnal IS 'Pilot OCR local (20261029a). Jurnal + limita linkuri semnate. Fara URL-uri/secrete.';

-- ── drepturi și RLS: citire pentru accesul Ofertare, scriere DOAR prin RPC ────────────────────────────────
DO $drepturi$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ofertare_ocr_rulari', 'ofertare_ocr_pagini', 'ofertare_ocr_arbitraje', 'ofertare_ocr_verificari', 'ofertare_ocr_pdf_jurnal'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', pg_get_serial_sequence('public.' || t, 'id'));
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ofertare_ocr_rulari', 'ofertare_ocr_pagini', 'ofertare_ocr_arbitraje', 'ofertare_ocr_verificari'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()))', t || '_select', t);
  END LOOP;
  GRANT SELECT ON public.ofertare_ocr_pdf_jurnal TO service_role;  -- jurnalul tehnic: fără acces din UI
END $drepturi$;

-- ── RPC pentru UI ────────────────────────────────────────────────────────────────────────────────────────
-- Cererea (poarta pe cheltuială): rol verificat aici, documente eligibile din licitație, pagini = pagini_necitite înghețate acum.
CREATE FUNCTION public.fn_ofertare_ocr_cerere(p_licitatie_id bigint, p_document_ids bigint[], p_plafon_usd numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE
  v_docs jsonb := '[]'::jsonb; v_id bigint; d record; e jsonb; v_rulare bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_ofertare_source_pack_poate_decide(p_licitatie_id), false) THEN
    RAISE EXCEPTION 'Doar owner-ul, responsabilul licitației sau un admin Ofertare pornește citirea locală' USING ERRCODE = '42501';
  END IF;
  IF p_plafon_usd IS NULL OR p_plafon_usd <= 0 OR p_plafon_usd > 15 THEN
    RAISE EXCEPTION 'Plafonul trebuie să fie între 0 și 15 USD' USING ERRCODE = '22023';
  END IF;
  IF p_document_ids IS NULL OR cardinality(p_document_ids) = 0 OR cardinality(p_document_ids) > 50
     OR cardinality(p_document_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_document_ids) x) THEN
    RAISE EXCEPTION 'Lista de documente e goală, prea lungă sau are duplicate' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Licitație inexistentă' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_ocr_rulari WHERE licitatie_id = p_licitatie_id AND stare IN ('ceruta', 'preluata', 'citita', 'arbitrata')) THEN
    RAISE EXCEPTION 'Există deja o rulare activă pe această licitație' USING ERRCODE = '55000';
  END IF;
  FOREACH v_id IN ARRAY p_document_ids LOOP
    SELECT id, licitatie_id, pagini_necitite INTO d FROM public.ofertare_documente_atribuire WHERE id = v_id;
    IF NOT FOUND OR d.licitatie_id <> p_licitatie_id THEN
      RAISE EXCEPTION 'Documentul % nu aparține licitației', v_id USING ERRCODE = '22023';
    END IF;
    e := public.fn_ofertare_document_eligibil(v_id);
    IF NOT coalesce((e->>'eligibil')::boolean, false) THEN
      RAISE EXCEPTION 'Documentul % nu e eligibil (%)', v_id, e->>'motiv' USING ERRCODE = '55000';
    END IF;
    IF d.pagini_necitite IS NULL OR cardinality(d.pagini_necitite) = 0 THEN
      RAISE EXCEPTION 'Documentul % nu are pagini necitite', v_id USING ERRCODE = '55000';
    END IF;
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('document_id', v_id,
                'pagini', (SELECT jsonb_agg(DISTINCT x ORDER BY x) FROM unnest(d.pagini_necitite) x WHERE x BETWEEN 1 AND 100000)));
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Rulare inexistentă' USING ERRCODE = 'P0002'; END IF;
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_ofertare_source_pack_poate_decide(r.licitatie_id), false) THEN
    RAISE EXCEPTION 'Doar owner-ul, responsabilul licitației sau un admin Ofertare anulează' USING ERRCODE = '42501';
  END IF;
  IF r.stare NOT IN ('ceruta', 'preluata', 'citita', 'arbitrata') THEN
    RAISE EXCEPTION 'Rularea e deja închisă (%)', r.stare USING ERRCODE = '55000';
  END IF;
  UPDATE public.ofertare_ocr_rulari SET stare = 'anulata', oprit_motiv = 'anulata de utilizator', terminata_la = now(), cost_rezervat = 0
   WHERE id = p_rulare_id;
  RETURN jsonb_build_object('ok', true, 'rulare_id', p_rulare_id);
END $f$;

-- Eșantionul de audit (spec §4), reproductibil, fără coloane mutabile: 100% text_propus pe cantități, 100% anomalii de separator,
-- plus 10% (minimum 20) din restul arbitrajelor pe cantități, ordonate după md5(rulare || item_sha256).
CREATE FUNCTION public.fn_ofertare_ocr_esantion(p_rulare_id bigint)
RETURNS TABLE (arbitraj_id bigint, motiv_esantion text, verdict text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  WITH acc AS (SELECT (SELECT public.fn_are_acces_ofertare()) AS ok),
  a AS (SELECT * FROM public.ofertare_ocr_arbitraje x WHERE x.rulare_id = p_rulare_id AND x.decizie <> 'needs_human' AND (SELECT ok FROM acc)),
  obligatoriu AS (
    SELECT id, CASE WHEN anomalie_separator THEN 'anomalie_separator' ELSE 'text_propus_cantitate' END AS m FROM a
     WHERE anomalie_separator OR (e_cantitate AND decizie = 'text_propus')),
  rest AS (SELECT id FROM a WHERE e_cantitate AND id NOT IN (SELECT id FROM obligatoriu)),
  aleator AS (
    SELECT r.id, 'aleator_10pct'::text AS m FROM rest r JOIN a USING (id)
     ORDER BY md5(p_rulare_id::text || a.item_sha256)
     LIMIT (SELECT greatest(20, ceil(0.1 * count(*))::int) FROM rest))
  SELECT s.id, s.m, v.verdict
    FROM (SELECT id, m FROM obligatoriu UNION ALL SELECT id, m FROM aleator) s
    LEFT JOIN public.ofertare_ocr_verificari v ON v.arbitraj_id = s.id
   ORDER BY s.id
$f$;

CREATE FUNCTION public.fn_ofertare_ocr_verifica(p_arbitraj_id bigint, p_verdict text, p_nota text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_lic bigint;
BEGIN
  SELECT r.licitatie_id INTO v_lic FROM public.ofertare_ocr_arbitraje a JOIN public.ofertare_ocr_rulari r ON r.id = a.rulare_id
   WHERE a.id = p_arbitraj_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Arbitraj inexistent' USING ERRCODE = 'P0002'; END IF;
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_ofertare_source_pack_poate_decide(v_lic), false) THEN
    RAISE EXCEPTION 'Doar owner-ul, responsabilul licitației sau un admin Ofertare verifică' USING ERRCODE = '42501';
  END IF;
  IF p_verdict IS NULL OR p_verdict NOT IN ('corect', 'gresit') THEN RAISE EXCEPTION 'Verdict invalid' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fn_ofertare_ocr_esantion((SELECT rulare_id FROM public.ofertare_ocr_arbitraje WHERE id = p_arbitraj_id)) s
                  WHERE s.arbitraj_id = p_arbitraj_id) THEN
    RAISE EXCEPTION 'Arbitrajul nu e în eșantionul de audit' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.ofertare_ocr_verificari (arbitraj_id, verdict, nota, verificat_de)
  VALUES (p_arbitraj_id, p_verdict, nullif(btrim(coalesce(p_nota, '')), ''), auth.uid());
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Arbitrajul are deja un verdict' USING ERRCODE = '23505';
END $f$;

-- ── RPC pentru edge-urile serverului AI (EXECUTE DOAR service_role) ───────────────────────────────────────
-- Preia cea mai veche cerere 'ceruta' (una singură, FOR UPDATE SKIP LOCKED) și o trece în 'preluata'.
CREATE FUNCTION public.fn_ofertare_ocr_preia(p_protocol text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record;
BEGIN
  IF p_protocol IS NULL OR p_protocol !~ '^[a-z0-9.-]{1,40}$' THEN RAISE EXCEPTION 'protocol invalid' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE stare = 'ceruta' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('rulare', NULL); END IF;
  UPDATE public.ofertare_ocr_rulari SET stare = 'preluata', preluata_la = now(), protocol = p_protocol WHERE id = r.id;
  RETURN jsonb_build_object('rulare', jsonb_build_object('id', r.id, 'licitatie_id', r.licitatie_id, 'documente', r.documente,
                                                         'plafon_usd', r.plafon_usd));
END $f$;

-- Tranziții permise: preluata→citita→arbitrata→finalizata; orice activă → oprita / esuata (cu motiv). Rezervarea rămasă se anulează.
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
  IF p_stare IN ('oprita', 'esuata') AND (p_motiv IS NULL OR btrim(p_motiv) = '' OR length(p_motiv) > 300) THEN
    RAISE EXCEPTION 'Motivul opririi e obligatoriu (max 300)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ofertare_ocr_rulari
     SET stare = p_stare, oprit_motiv = CASE WHEN p_stare IN ('oprita', 'esuata') THEN p_motiv ELSE oprit_motiv END,
         terminata_la = CASE WHEN p_stare IN ('finalizata', 'oprita', 'esuata') THEN now() ELSE terminata_la END,
         cost_rezervat = CASE WHEN p_stare IN ('finalizata', 'oprita', 'esuata') THEN 0 ELSE cost_rezervat END
   WHERE id = p_rulare_id;
  RETURN jsonb_build_object('ok', true, 'stare', p_stare);
END $f$;

-- Linkul către PDF: doar documente din rularea preluată, încă eligibile ACUM; limită 30/minut și 500/24h; un rând de jurnal per cerere.
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

-- Pagina citită: doar în rularea preluată, doar pagini înghețate la cerere, protocolul rulării. Idempotent pe octeți identici
-- (răspuns pierdut → aceeași scriere reîntoarce ok + deja); altă variantă pentru aceeași cheie = eroare (append-only).
CREATE FUNCTION public.fn_ofertare_ocr_scrie_pagina(p_rulare_id bigint, p_document_id bigint, p_pagina integer, p_cititor text,
                                                    p_text text, p_stare text, p_model_rev text, p_raw_sha256 text,
                                                    p_image_sha256 text, p_garda jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; v_old record; v_id bigint;
BEGIN
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id FOR SHARE;
  IF NOT FOUND OR r.stare NOT IN ('preluata', 'citita', 'arbitrata') THEN RAISE EXCEPTION 'Rulare inexistentă sau închisă' USING ERRCODE = '55000'; END IF;
  IF (p_cititor = 'reconciliat') <> (r.stare = 'arbitrata') THEN
    RAISE EXCEPTION 'Cititorii scriu în preluata/citita, reconcilierea doar în arbitrata' USING ERRCODE = '55000';
  END IF;
  IF p_cititor IN ('lighton', 'mineru') AND r.stare <> 'preluata' THEN RAISE EXCEPTION 'Citirile se scriu doar în preluata' USING ERRCODE = '55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.documente) x
                  WHERE (x->>'document_id')::bigint = p_document_id AND (x->'pagini') @> to_jsonb(p_pagina)) THEN
    RAISE EXCEPTION 'Pagina % a documentului % nu e în rulare', p_pagina, p_document_id USING ERRCODE = '22023';
  END IF;
  IF p_text IS NULL OR p_raw_sha256 IS NULL OR encode(sha256(convert_to(p_text, 'UTF8')), 'hex') <> p_raw_sha256 THEN
    RAISE EXCEPTION 'raw_sha256 nu corespunde textului' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_old FROM public.ofertare_ocr_pagini
   WHERE rulare_id = p_rulare_id AND document_id = p_document_id AND pagina = p_pagina AND cititor = p_cititor;
  IF FOUND THEN
    IF v_old.raw_sha256 = p_raw_sha256 AND v_old.text = p_text THEN RETURN jsonb_build_object('ok', true, 'deja', true, 'id', v_old.id); END IF;
    RAISE EXCEPTION 'Pagina există deja cu alt conținut (append-only)' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.ofertare_ocr_pagini (rulare_id, document_id, pagina, cititor, text, stare, protocol, model_rev, raw_sha256, image_sha256, garda)
  VALUES (p_rulare_id, p_document_id, p_pagina, p_cititor, p_text, p_stare, r.protocol, p_model_rev, p_raw_sha256, p_image_sha256, coalesce(p_garda, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'deja', false, 'id', v_id);
END $f$;

-- Rezervarea costului ÎNAINTE de un apel plătit: atomic, nu poate depăși plafonul. Refuz = edge-ul nu cheamă API-ul.
CREATE FUNCTION public.fn_ofertare_ocr_cost_rezerva(p_rulare_id bigint, p_suma numeric)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE v_n int;
BEGIN
  IF p_suma IS NULL OR p_suma <= 0 OR p_suma > 1 THEN RETURN false; END IF;
  UPDATE public.ofertare_ocr_rulari SET cost_rezervat = cost_rezervat + p_suma
   WHERE id = p_rulare_id AND stare = 'citita' AND cost_usd + cost_rezervat + p_suma <= plafon_usd;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END $f$;

-- Decizia arbitrului: eliberează rezervarea, adaugă costul real (plafonat la rezervare), scrie tripletul + ai_usage_log, atomic.
CREATE FUNCTION public.fn_ofertare_ocr_scrie_arbitraj(p_rulare_id bigint, p_rezervat numeric, p_arbitraj jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE r record; v_cost numeric; v_id bigint; a jsonb := p_arbitraj;
BEGIN
  SELECT * INTO r FROM public.ofertare_ocr_rulari WHERE id = p_rulare_id FOR UPDATE;
  IF NOT FOUND OR r.stare <> 'citita' THEN RAISE EXCEPTION 'Rulare inexistentă sau nu e în citita' USING ERRCODE = '55000'; END IF;
  IF p_rezervat IS NULL OR p_rezervat <= 0 OR p_rezervat > r.cost_rezervat THEN RAISE EXCEPTION 'Rezervare invalidă' USING ERRCODE = '22023'; END IF;
  v_cost := (a->>'cost_usd')::numeric;
  IF v_cost IS NULL OR v_cost < 0 OR v_cost > p_rezervat THEN RAISE EXCEPTION 'Cost real invalid sau peste rezervare' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.documente) x
                  WHERE (x->>'document_id')::bigint = (a->>'document_id')::bigint AND (x->'pagini') @> to_jsonb((a->>'pagina')::int)) THEN
    RAISE EXCEPTION 'Pagina arbitrată nu e în rulare' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ofertare_ocr_rulari SET cost_rezervat = cost_rezervat - p_rezervat, cost_usd = cost_usd + v_cost WHERE id = p_rulare_id;
  INSERT INTO public.ofertare_ocr_arbitraje (rulare_id, document_id, pagina, item_id, item_sha256, tip, citire_lighton, citire_mineru, decizie,
                                             text_ales, motiv, e_cantitate, anomalie_separator, arbitru_model, prompt_versiune, cost_usd)
  VALUES (p_rulare_id, (a->>'document_id')::bigint, (a->>'pagina')::int, a->>'item_id', a->>'item_sha256', a->>'tip',
          a->>'citire_lighton', a->>'citire_mineru', a->>'decizie', a->>'text_ales', a->>'motiv',
          (a->>'e_cantitate')::boolean, (a->>'anomalie_separator')::boolean, a->>'arbitru_model', a->>'prompt_versiune', v_cost)
  RETURNING id INTO v_id;
  INSERT INTO public.ai_usage_log (function_name, model, tokens_in, tokens_out, cost_usd, ref_table, ref_id)
  VALUES ('ofertare-ocr-arbitreaza', a->>'arbitru_model', coalesce((a->>'tokens_in')::int, 0), coalesce((a->>'tokens_out')::int, 0),
          v_cost, 'ofertare_ocr_arbitraje', v_id);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'cost_total', r.cost_usd + v_cost);
END $f$;

-- Heartbeat: doar cheia acestui proces, mesaj scurt.
CREATE FUNCTION public.fn_ofertare_ocr_heartbeat(p_ok boolean, p_mesaj text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  INSERT INTO public.procese_heartbeat (cheie, descriere, gazda, ultimul_semn, ultim_ok, ultim_mesaj, prag_minute, activ)
  VALUES ('ocr_local_ofertare', 'Pilot OCR local Ofertare (20261029a)', 'Gazpet-Claude', now(), coalesce(p_ok, false), left(coalesce(p_mesaj, ''), 300), 30, true)
  ON CONFLICT (cheie) DO UPDATE SET ultimul_semn = now(), ultim_ok = coalesce(p_ok, false), ultim_mesaj = left(coalesce(p_mesaj, ''), 300);
  RETURN true;
END $f$;

DO $exec$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_ocr_cerere(bigint,bigint[],numeric)', 'public.fn_ofertare_ocr_anuleaza(bigint)',
                           'public.fn_ofertare_ocr_esantion(bigint)', 'public.fn_ofertare_ocr_verifica(bigint,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_ocr_preia(text)', 'public.fn_ofertare_ocr_stare(bigint,text,text)',
                           'public.fn_ofertare_ocr_pdf_rezerva(bigint,bigint)', 'public.fn_ofertare_ocr_pdf_final(bigint,text)',
                           'public.fn_ofertare_ocr_scrie_pagina(bigint,bigint,integer,text,text,text,text,text,text,jsonb)',
                           'public.fn_ofertare_ocr_cost_rezerva(bigint,numeric)', 'public.fn_ofertare_ocr_scrie_arbitraj(bigint,numeric,jsonb)',
                           'public.fn_ofertare_ocr_heartbeat(boolean,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $exec$;

DO $post$
DECLARE t text; f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ofertare_ocr_rulari', 'ofertare_ocr_pagini', 'ofertare_ocr_arbitraje', 'ofertare_ocr_verificari', 'ofertare_ocr_pdf_jurnal'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass)
       OR has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT') OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') OR has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE')
       OR has_table_privilege('service_role', 'public.' || t, 'INSERT') OR has_table_privilege('service_role', 'public.' || t, 'UPDATE')
       OR has_table_privilege('service_role', 'public.' || t, 'DELETE') OR has_table_privilege('service_role', 'public.' || t, 'TRUNCATE')
       OR has_sequence_privilege('authenticated', pg_get_serial_sequence('public.' || t, 'id'), 'USAGE')
       OR has_sequence_privilege('service_role', pg_get_serial_sequence('public.' || t, 'id'), 'USAGE') THEN
      RAISE EXCEPTION '20261029a: postconditie drepturi %', t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.ofertare_ocr_pdf_jurnal', 'SELECT') THEN RAISE EXCEPTION '20261029a: jurnalul pdf vizibil din UI'; END IF;
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_ocr_preia(text)', 'public.fn_ofertare_ocr_stare(bigint,text,text)',
                           'public.fn_ofertare_ocr_pdf_rezerva(bigint,bigint)', 'public.fn_ofertare_ocr_pdf_final(bigint,text)',
                           'public.fn_ofertare_ocr_scrie_pagina(bigint,bigint,integer,text,text,text,text,text,text,jsonb)',
                           'public.fn_ofertare_ocr_cost_rezerva(bigint,numeric)', 'public.fn_ofertare_ocr_scrie_arbitraj(bigint,numeric,jsonb)',
                           'public.fn_ofertare_ocr_heartbeat(boolean,text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '20261029a: postconditie executie %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.fn_ofertare_ocr_cerere(bigint,bigint[],numeric)', 'public.fn_ofertare_ocr_anuleaza(bigint)',
                           'public.fn_ofertare_ocr_esantion(bigint)', 'public.fn_ofertare_ocr_verifica(bigint,text,text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '20261029a: postconditie executie UI %', f;
    END IF;
  END LOOP;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261029a_ofertare_ocr_local:' || txid_current() THEN
    RAISE EXCEPTION '20261029a: garda final invalida';
  END IF;
END $post$;
