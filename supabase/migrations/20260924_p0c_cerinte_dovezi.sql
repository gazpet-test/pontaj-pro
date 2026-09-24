-- P0c — DOVEZI SUPLIMENTARE / observații de verificare pe cerință (24.09.2026, noaptea Claude ↔ Copilot).
--
-- ⚠️ NEAPLICATĂ în producție. Se aplică DOAR cu GO explicit de la Răzvan (apply_migration, nume: p0c_cerinte_dovezi).
--    Testată local pe schema-stub din test-fixtures/cerinte_dovezi/ (Postgres 16 în container), nu pe producție.
--
-- De ce: la pilotul Mânăstirea (P0C_PILOT_REVIEW.md §1–§2) excerptul înregistrat în pack (sursa_pasaj) susține doar o
--   PARTE din afirmația cerinței (REQ-021: doar „nu se acordă avans"; REQ-032: doar „65%"). Afirmația e susținută integral
--   de un pasaj mai larg din original, dar nu exista niciun loc structurat, per cerință, în care să persistăm
--   {document + versiune/amprentă, locator, pasajul exact, concluzia, verificatorul, data} fără să rescriem proveniența.
-- Ce NU face: nu atinge sursa_pasaj / pasaj_verificat / sursa_pack_id (triggerul de proveniență rămâne), nu setează
--   confirmata_de (E2 rămâne act uman separat), nu scrie în pack sau în deciziile pack. Documentează ce pasaj din
--   documentația AUTORITĂȚII susține interpretarea cerinței — NU certifică că Gazpet îndeplinește cerința
--   (asta e ofertare_pt_dovezi / acoperire, alt mecanism).
-- Legarea la text: text_md5 = md5(text_cerinta) la momentul verificării. Dacă textul cerinței se corectează ulterior,
--   dovada rămâne în istoric, dar view-ul o arată „nu mai e pentru textul curent" — nu pare că verifică noua formulare.
-- Append-only: fără UPDATE/DELETE; o corecție = rând nou cu corecteaza_id → rândul vechi (care apare „înlocuit").

CREATE TABLE IF NOT EXISTS public.ofertare_cerinte_dovezi (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cerinta_id bigint NOT NULL REFERENCES public.ofertare_cerinte(id) ON DELETE RESTRICT,
  text_md5 text NOT NULL,
  document_id bigint REFERENCES public.ofertare_documente_atribuire(id) ON DELETE RESTRICT,
  fisier_sha256_declarat text,
  locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  pasaj text NOT NULL,
  explicatie text NOT NULL,
  corecteaza_id bigint REFERENCES public.ofertare_cerinte_dovezi(id) ON DELETE RESTRICT,
  verificat_de uuid NOT NULL,
  verificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ofertare_cerinte_dovezi_pasaj_chk CHECK (length(btrim(pasaj)) >= 10),
  CONSTRAINT ofertare_cerinte_dovezi_explicatie_chk CHECK (length(btrim(explicatie)) >= 5),
  CONSTRAINT ofertare_cerinte_dovezi_sha_chk CHECK (fisier_sha256_declarat IS NULL OR fisier_sha256_declarat ~ '^[0-9a-f]{64}$'),
  -- locator: exact una dintre {pagina: n>0} | {interval: [a,b], 0<a<=b} | {verificat: 'document'}; opțional sectiune (text)
  CONSTRAINT ofertare_cerinte_dovezi_locator_chk CHECK (
    jsonb_typeof(locator) = 'object'
    AND ((locator ? 'pagina')::int + (locator ? 'interval')::int + (locator ? 'verificat')::int) = 1
    AND (NOT locator ? 'pagina' OR (jsonb_typeof(locator->'pagina') = 'number' AND (locator->>'pagina')::numeric > 0 AND (locator->>'pagina')::numeric = floor((locator->>'pagina')::numeric)))
    AND (NOT locator ? 'interval' OR (jsonb_typeof(locator->'interval') = 'array' AND jsonb_array_length(locator->'interval') = 2
         AND jsonb_typeof(locator->'interval'->0) = 'number' AND jsonb_typeof(locator->'interval'->1) = 'number'
         AND (locator->'interval'->>0)::numeric > 0 AND (locator->'interval'->>0)::numeric <= (locator->'interval'->>1)::numeric))
    AND (NOT locator ? 'verificat' OR locator->>'verificat' = 'document')
    AND (NOT locator ? 'sectiune' OR jsonb_typeof(locator->'sectiune') = 'string')),
  CONSTRAINT ofertare_cerinte_dovezi_md5_chk CHECK (text_md5 ~ '^[0-9a-f]{32}$')
);
COMMENT ON TABLE public.ofertare_cerinte_dovezi IS 'Dovezi suplimentare / observații de verificare pe cerință: ce pasaj EXACT din documentația autorității (document + amprentă + locator) susține interpretarea cerinței, cine a verificat și când. Append-only; NU setează confirmata_de, NU atinge proveniența (sursa_pasaj / pack). text_md5 = md5(text_cerinta) la verificare.';
COMMENT ON COLUMN public.ofertare_cerinte_dovezi.locator IS 'Exact una: {"pagina": 13} | {"interval": [3,5]} | {"verificat": "document"} + opțional {"sectiune": "III.1.7"}; paginile sunt cele ale fișierului original; un interval NU produce pagină exactă.';
COMMENT ON COLUMN public.ofertare_cerinte_dovezi.fisier_sha256_declarat IS 'Amprenta fișierului original, DECLARATĂ de cel care a verificat (nu e calculată de server, nu e „verificată” prin simpla transmitere).';
COMMENT ON COLUMN public.ofertare_cerinte_dovezi.pasaj IS 'Fragmentul EXACT din original, fără elipse care înlocuiesc text; mai multe fragmente = mai multe rânduri.';
CREATE INDEX IF NOT EXISTS ofertare_cerinte_dovezi_cerinta_idx ON public.ofertare_cerinte_dovezi (cerinta_id, id DESC);
CREATE INDEX IF NOT EXISTS ofertare_cerinte_dovezi_document_idx ON public.ofertare_cerinte_dovezi (document_id);
CREATE INDEX IF NOT EXISTS ofertare_cerinte_dovezi_corecteaza_idx ON public.ofertare_cerinte_dovezi (corecteaza_id);

CREATE OR REPLACE FUNCTION public.fn_ofertare_cerinte_dovezi_ro()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'ofertare_cerinte_dovezi: append-only (fără UPDATE/DELETE) — o corecție e un rând nou cu corecteaza_id'; END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_cerinte_dovezi_ro() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_ofertare_cerinte_dovezi_ro ON public.ofertare_cerinte_dovezi;
CREATE TRIGGER trg_ofertare_cerinte_dovezi_ro BEFORE UPDATE OR DELETE ON public.ofertare_cerinte_dovezi
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_cerinte_dovezi_ro();

ALTER TABLE public.ofertare_cerinte_dovezi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_cerinte_dovezi FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ofertare_cerinte_dovezi TO authenticated, service_role;
DROP POLICY IF EXISTS ofertare_cerinte_dovezi_select ON public.ofertare_cerinte_dovezi;
CREATE POLICY ofertare_cerinte_dovezi_select ON public.ofertare_cerinte_dovezi
  FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
-- INSERT doar prin RPC-ul DEFINER de mai jos (fără policy de INSERT pentru authenticated).

-- ── RPC: adaugă o dovadă. Actorul vine din sesiune; verifică accesul la Ofertare și concordanța licitației cerință ↔ document.
CREATE OR REPLACE FUNCTION public.fn_ofertare_cerinte_dovada_adauga(
  p_cerinta_id bigint, p_pasaj text, p_explicatie text,
  p_document_id bigint DEFAULT NULL, p_locator jsonb DEFAULT '{"verificat":"document"}'::jsonb,
  p_fisier_sha256 text DEFAULT NULL, p_corecteaza_id bigint DEFAULT NULL, p_text_vazut text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_actor uuid := auth.uid(); v_lic bigint; v_text text; v_lic_doc bigint; v_cer_vechi bigint; v_id bigint;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'dovadă: fără sesiune (auth.uid() NULL)'; END IF;
  IF NOT public.fn_are_acces_ofertare() THEN RAISE EXCEPTION 'dovadă: fără acces la Ofertare'; END IF;
  SELECT licitatie_id, text_cerinta INTO v_lic, v_text FROM public.ofertare_cerinte WHERE id = p_cerinta_id;
  IF v_lic IS NULL THEN RAISE EXCEPTION 'dovadă: cerința % nu există', p_cerinta_id; END IF;
  -- Textul pe care l-a VĂZUT verificatorul trebuie să fie cel curent: o editare intervenită între afișare și salvare
  -- ar lega tacit dovada de altă formulare. UI-ul trimite mereu p_text_vazut; apelurile fără el sunt acceptate (API), dar amprenta e a textului curent.
  IF p_text_vazut IS NOT NULL AND md5(p_text_vazut) <> md5(v_text) THEN
    RAISE EXCEPTION 'dovadă: textul cerinței % s-a schimbat între afișare și salvare — reîncarcă și verifică din nou', p_cerinta_id;
  END IF;
  IF p_document_id IS NOT NULL THEN
    SELECT licitatie_id INTO v_lic_doc FROM public.ofertare_documente_atribuire WHERE id = p_document_id;
    IF v_lic_doc IS NULL THEN RAISE EXCEPTION 'dovadă: documentul % nu există', p_document_id; END IF;
    IF v_lic_doc <> v_lic THEN RAISE EXCEPTION 'dovadă: documentul % e din altă licitație decât cerința %', p_document_id, p_cerinta_id; END IF;
  END IF;
  IF p_corecteaza_id IS NOT NULL THEN
    SELECT cerinta_id INTO v_cer_vechi FROM public.ofertare_cerinte_dovezi WHERE id = p_corecteaza_id;
    IF v_cer_vechi IS NULL THEN RAISE EXCEPTION 'dovadă: rândul corectat % nu există', p_corecteaza_id; END IF;
    IF v_cer_vechi <> p_cerinta_id THEN RAISE EXCEPTION 'dovadă: rândul corectat % e al altei cerințe', p_corecteaza_id; END IF;
  END IF;
  IF p_locator IS NULL OR jsonb_typeof(p_locator) <> 'object' THEN RAISE EXCEPTION 'dovadă: locatorul trebuie să fie obiect JSON'; END IF;
  IF ((p_locator ? 'pagina')::int + (p_locator ? 'interval')::int + (p_locator ? 'verificat')::int) <> 1 THEN
    RAISE EXCEPTION 'dovadă: locatorul are exact una dintre pagina / interval / verificat=document';
  END IF;
  INSERT INTO public.ofertare_cerinte_dovezi (cerinta_id, text_md5, document_id, fisier_sha256_declarat, locator, pasaj, explicatie, corecteaza_id, verificat_de)
  VALUES (p_cerinta_id, md5(v_text), p_document_id, NULLIF(lower(btrim(p_fisier_sha256)), ''), p_locator, btrim(p_pasaj), btrim(p_explicatie), p_corecteaza_id, v_actor)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'cerinta_id', p_cerinta_id, 'text_md5', md5(v_text), 'verificat_de', v_actor);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ofertare_cerinte_dovada_adauga(bigint, text, text, bigint, jsonb, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cerinte_dovada_adauga(bigint, text, text, bigint, jsonb, text, bigint, text) TO authenticated, service_role;

-- ── View: dovezile cu starea față de textul curent al cerinței
CREATE OR REPLACE VIEW public.v_ofertare_cerinte_dovezi WITH (security_invoker = on) AS
SELECT d.id, d.cerinta_id, c.licitatie_id, d.document_id, doc.nume_original AS document_nume, d.fisier_sha256_declarat, d.locator,
       d.pasaj, d.explicatie, d.corecteaza_id,
       EXISTS (SELECT 1 FROM public.ofertare_cerinte_dovezi x WHERE x.corecteaza_id = d.id) AS inlocuita,
       (d.text_md5 = md5(c.text_cerinta)) AS pentru_textul_curent,
       -- activă = neînlocuită ȘI pentru textul curent; o dovadă înlocuită nu redevine actuală doar fiindcă md5 încă se potrivește
       (NOT EXISTS (SELECT 1 FROM public.ofertare_cerinte_dovezi x WHERE x.corecteaza_id = d.id) AND d.text_md5 = md5(c.text_cerinta)) AS activa,
       d.verificat_de, pr.name AS verificat_de_nume, d.verificat_la
FROM public.ofertare_cerinte_dovezi d
JOIN public.ofertare_cerinte c ON c.id = d.cerinta_id
LEFT JOIN public.ofertare_documente_atribuire doc ON doc.id = d.document_id
LEFT JOIN public.profiles pr ON pr.id = d.verificat_de;
REVOKE ALL ON public.v_ofertare_cerinte_dovezi FROM PUBLIC, anon;
GRANT SELECT ON public.v_ofertare_cerinte_dovezi TO authenticated, service_role;
COMMENT ON VIEW public.v_ofertare_cerinte_dovezi IS 'Dovezile pe cerință + pentru_textul_curent (md5 la verificare = md5 acum) + inlocuita (există o corecție ulterioară) + activa (ambele). Nu spune nimic despre E2. security_invoker: RLS-ul tabelelor de bază se aplică cititorului.';
