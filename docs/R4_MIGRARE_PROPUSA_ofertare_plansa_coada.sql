-- ============================================================================================================
-- PROPUNERE — NEAPLICATĂ. NU rula fără GO Razvan: schemă nouă + automatizare nouă care cheltuie AI (CLAUDE.md pct. 3, 4, 7).
-- R4 (audit Ofertare): coada de citire a planșelor pe NAS Terra (worker/ofertare) — independentă de browser.
-- Design: docs/R4_REZERVARE_ZONE_SI_COADA_NAS.md §3. Aplicare după GO: apply_migration 'ofertare_plansa_coada',
-- apoi get_advisors, apoi fișa în claude_docs 'registru_automatizari'.
--
-- Un rând = o cerere de citire pe (document, tăiere). Idempotența PE ZONĂ nu stă aici: o dă mecanismul deja livrat în
-- edge (rezervări per zonă în analiza.rezervari_zone + CAS pe citire_ai.rev + fuziune pe zone + versiune) — workerul
-- rulează ACELAȘI handler, deci cooperează cu un tab deschis fără plată dublă.
-- ============================================================================================================

CREATE TABLE IF NOT EXISTS public.ofertare_plansa_coada (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id        bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id) ON DELETE CASCADE,
  licitatie_id  bigint NOT NULL,
  mod           text   NOT NULL DEFAULT 'citeste' CHECK (mod IN ('citeste', 'continua', 'reia_erori')),
  -- proveniența, înghețată la înscriere (workerul anulează jobul dacă documentul nu mai corespunde)
  taiat_la      text,                          -- analiza.plansa.taiat_la (NULL la tăierile istorice)
  cale_felii    text   NOT NULL,               -- analiza.plansa.cale_felii
  fisier_path   text,
  doc_sha256    text,                          -- din ofertare_seap_manifest (NULL: document neimportat din SEAP)
  versiune      text,                          -- cod|model|prompt_sha — completat de worker la prima rundă
  stare         text   NOT NULL DEFAULT 'asteapta'
                CHECK (stare IN ('asteapta', 'lucru', 'gata', 'partial', 'eroare', 'anulat', 'oprit_plafon')),
  incercari     int    NOT NULL DEFAULT 0,
  max_incercari int    NOT NULL DEFAULT 3,
  urmatoarea_la timestamptz NOT NULL DEFAULT now(),   -- backoff după erori de furnizor
  luat_de       text,
  luat_la       timestamptz,
  lease_pana    timestamptz,
  runde         int    NOT NULL DEFAULT 0,
  cost_usd      numeric(10,4) NOT NULL DEFAULT 0,
  plafon_usd    numeric(10,2),                 -- NULL = fără plafon pe job; valoarea implicită o decide Razvan
  jurnal        jsonb  NOT NULL DEFAULT '[]'::jsonb, -- pe rundă: {la, body, status, citite_acum, zone, in_lucru_alt_tab, cost_usd, ms}
  rezultat      jsonb,                         -- sumarul final (felii_citite, erori, tronsoane, lungime, cantitati)
  eroare        text,
  motiv_anulare text,
  cerut_de      uuid   NOT NULL REFERENCES auth.users(id),
  cerut_la      timestamptz NOT NULL DEFAULT now(),
  terminat_la   timestamptz
);

-- Idempotență la înscriere: cel mult UN job activ per (document, tăiere) — dublu-click / al doilea tab nu dublează.
CREATE UNIQUE INDEX IF NOT EXISTS ofertare_plansa_coada_activ_uq
  ON public.ofertare_plansa_coada (doc_id, (COALESCE(taiat_la, '')))
  WHERE stare IN ('asteapta', 'lucru');
CREATE INDEX IF NOT EXISTS ofertare_plansa_coada_de_luat
  ON public.ofertare_plansa_coada (cerut_la) WHERE stare IN ('asteapta', 'lucru');

ALTER TABLE public.ofertare_plansa_coada ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ofertare_plansa_coada TO authenticated;
GRANT ALL ON public.ofertare_plansa_coada TO service_role;
-- Citire pentru utilizatorii autentificați (starea jobului în UI). FĂRĂ INSERT/UPDATE/DELETE pentru authenticated:
-- înscrierea se face DOAR prin RPC-ul cu poarta pe cheltuială (spre deosebire de ofertare_acoperire_coada /
-- ofertare_clarificari_coada / ofertare_ingest_coada, unde politica ALL permite oricărui autentificat să înscrie).
CREATE POLICY ofertare_plansa_coada_citire ON public.ofertare_plansa_coada
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- ---- Înscriere (UI) — poarta pe cheltuială verificată ÎN SQL (aceeași regulă ca poateCheltui din poarta.ts) ----
CREATE OR REPLACE FUNCTION public.ofertare_plansa_coada_inscrie(p_doc_id bigint, p_mod text DEFAULT 'citeste')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_doc   record;
  v_resp  uuid;
  v_owner boolean := false;
  v_sha   text;
  v_id    bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'neautentificat'; END IF;
  IF p_mod NOT IN ('citeste', 'continua', 'reia_erori') THEN RAISE EXCEPTION 'mod invalid'; END IF;
  SELECT d.id, d.licitatie_id, d.fisier_path, d.analiza INTO v_doc
    FROM ofertare_documente_atribuire d WHERE d.id = p_doc_id;
  SELECT l.responsabil_id INTO v_resp FROM ofertare_licitatii l WHERE l.id = v_doc.licitatie_id;
  SELECT COALESCE(p.is_owner, false) INTO v_owner FROM profiles p WHERE p.id = v_uid;
  -- același mesaj dacă documentul nu există (fără enumerare de id-uri)
  IF v_doc.id IS NULL OR NOT (COALESCE(v_owner, false) OR (v_resp IS NOT NULL AND v_resp = v_uid)) THEN
    RAISE EXCEPTION 'Fără drept pe acest document — citirea planșei costă și o pornește doar ownerul sau responsabilul licitației.';
  END IF;
  IF v_doc.analiza -> 'plansa' ->> 'cale_felii' IS NULL THEN
    RETURN jsonb_build_object('eroare', 'planșa nu e tăiată în felii — rulează întâi /api/plansa-felii');
  END IF;
  IF (v_doc.analiza -> 'plansa' ->> 'citibila') = 'false' THEN
    RETURN jsonb_build_object('eroare', 'planșa e marcată necitibilă');
  END IF;
  SELECT m.sha256 INTO v_sha FROM ofertare_seap_manifest m
   WHERE m.document_id = p_doc_id AND m.sha256 IS NOT NULL ORDER BY m.verificat_la DESC NULLS LAST LIMIT 1;

  INSERT INTO ofertare_plansa_coada (doc_id, licitatie_id, mod, taiat_la, cale_felii, fisier_path, doc_sha256, cerut_de)
  VALUES (p_doc_id, v_doc.licitatie_id, p_mod, v_doc.analiza -> 'plansa' ->> 'taiat_la',
          v_doc.analiza -> 'plansa' ->> 'cale_felii', v_doc.fisier_path, v_sha, v_uid)
  ON CONFLICT (doc_id, (COALESCE(taiat_la, ''))) WHERE stare IN ('asteapta', 'lucru') DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT q.id INTO v_id FROM ofertare_plansa_coada q
     WHERE q.doc_id = p_doc_id AND COALESCE(q.taiat_la, '') = COALESCE(v_doc.analiza -> 'plansa' ->> 'taiat_la', '')
       AND q.stare IN ('asteapta', 'lucru');
    RETURN jsonb_build_object('id', v_id, 'existent', true);
  END IF;
  RETURN jsonb_build_object('id', v_id, 'existent', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ofertare_plansa_coada_inscrie(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_plansa_coada_inscrie(bigint, text) TO authenticated;

-- ---- Claim atomic (worker, DOAR service_role) — SKIP LOCKED; lease expirat = worker căzut => se reia ----
CREATE OR REPLACE FUNCTION public.ofertare_plansa_coada_ia(p_worker text, p_lease_min int DEFAULT 10)
RETURNS SETOF public.ofertare_plansa_coada
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- joburile reluate de prea multe ori (worker mort repetat) nu se mai iau: eroare vizibilă
  UPDATE ofertare_plansa_coada SET stare = 'eroare', eroare = 'lease expirat de ' || incercari || ' ori — worker oprit repetat',
         terminat_la = now()
   WHERE stare = 'lucru' AND lease_pana < now() AND incercari >= max_incercari;

  RETURN QUERY
  UPDATE ofertare_plansa_coada q
     SET stare = 'lucru', luat_de = p_worker, luat_la = now(),
         lease_pana = now() + make_interval(mins => GREATEST(p_lease_min, 1)), incercari = q.incercari + 1
   WHERE q.id = (
     SELECT c.id FROM ofertare_plansa_coada c
      WHERE (c.stare = 'asteapta' AND c.urmatoarea_la <= now())
         OR (c.stare = 'lucru' AND c.lease_pana < now())
      ORDER BY c.cerut_la
      LIMIT 1
      FOR UPDATE SKIP LOCKED)
  RETURNING q.*;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ofertare_plansa_coada_ia(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_plansa_coada_ia(text, int) TO service_role;

-- Prelungirea lease-ului și finalizarea le face workerul direct (service_role), condiționat:
--   UPDATE ofertare_plansa_coada SET lease_pana = now() + interval '10 min', runde = ..., cost_usd = ..., jurnal = ...
--    WHERE id = $1 AND luat_de = $worker AND stare = 'lucru'   -- 0 rânduri => lease pierdut => workerul se oprește
