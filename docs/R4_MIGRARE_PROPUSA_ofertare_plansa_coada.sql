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
  plafon_usd    numeric(10,2) DEFAULT 10,      -- D1 Răzvan 27.09: 10 USD pe planșă (NULL => workerul folosește tot 10)
  claim_token   uuid,                          -- unic per preluare: scrierile workerului se condiționează pe el, nu pe nume
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
-- Verificator R4 (runda 1): privilegiile implicite din `public` dau ALL (arwdDxtm) lui anon ȘI authenticated pe orice tabel
-- nou (SELECT pe pg_default_acl, 25.09.2026: rolurile postgres și supabase_admin). RLS le-ar bloca oricum, dar nu ne bazăm
-- doar pe RLS: întâi se retrag, apoi se dă exact ce trebuie.
REVOKE ALL ON public.ofertare_plansa_coada FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ofertare_plansa_coada TO authenticated;
GRANT ALL ON public.ofertare_plansa_coada TO service_role;
-- Citire pentru utilizatorii autentificați (starea jobului în UI). FĂRĂ INSERT/UPDATE/DELETE pentru authenticated:
-- înscrierea se face DOAR prin RPC-ul cu poarta pe cheltuială (spre deosebire de ofertare_acoperire_coada /
-- ofertare_clarificari_coada / ofertare_ingest_coada, unde politica ALL permite oricărui autentificat să înscrie).
CREATE POLICY ofertare_plansa_coada_citire ON public.ofertare_plansa_coada
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Registrul păstrează ziua REZERVĂRII, inclusiv după retry/re-claim sau regularizare a doua zi.
CREATE TABLE IF NOT EXISTS public.ofertare_plansa_buget (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES public.ofertare_plansa_coada(id),
  claim_token uuid NOT NULL,
  zi date NOT NULL DEFAULT ((clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date),
  rezervat_usd numeric(10,4) NOT NULL CHECK (rezervat_usd > 0 AND rezervat_usd < 'Infinity'::numeric),
  cost_usd numeric(10,4) CHECK (cost_usd >= 0 AND cost_usd < 'Infinity'::numeric),
  stare text NOT NULL DEFAULT 'rezervat' CHECK (stare IN ('rezervat', 'regularizat', 'incert')),
  creat_la timestamptz NOT NULL DEFAULT clock_timestamp(),
  regularizat_la timestamptz,
  CHECK ((stare = 'rezervat' AND cost_usd IS NULL AND regularizat_la IS NULL)
      OR (stare <> 'rezervat' AND cost_usd IS NOT NULL AND regularizat_la IS NOT NULL)),
  CHECK (stare <> 'incert' OR cost_usd >= rezervat_usd)
);
CREATE INDEX IF NOT EXISTS ofertare_plansa_buget_job ON public.ofertare_plansa_buget(job_id);
CREATE INDEX IF NOT EXISTS ofertare_plansa_buget_zi ON public.ofertare_plansa_buget(zi);
ALTER TABLE public.ofertare_plansa_buget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_plansa_buget FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ofertare_plansa_buget TO authenticated;
GRANT ALL ON public.ofertare_plansa_buget TO service_role;
REVOKE ALL ON SEQUENCE public.ofertare_plansa_buget_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.ofertare_plansa_buget_id_seq TO service_role;
CREATE POLICY ofertare_plansa_buget_citire ON public.ofertare_plansa_buget
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
  v_mod_existent text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'neautentificat'; END IF;
  IF p_mod NOT IN ('citeste', 'continua', 'reia_erori') THEN RAISE EXCEPTION 'mod invalid'; END IF;
  SELECT d.id, d.licitatie_id, d.fisier_path, d.analiza, d.tip INTO v_doc
    FROM ofertare_documente_atribuire d WHERE d.id = p_doc_id;
  SELECT l.responsabil_id INTO v_resp FROM ofertare_licitatii l WHERE l.id = v_doc.licitatie_id;
  SELECT COALESCE(p.is_owner, false) INTO v_owner FROM profiles p WHERE p.id = v_uid;
  -- același mesaj dacă documentul nu există (fără enumerare de id-uri)
  IF v_doc.id IS NULL OR NOT (COALESCE(v_owner, false) OR (v_resp IS NOT NULL AND v_resp = v_uid)) THEN
    RAISE EXCEPTION 'Fără drept pe acest document — citirea planșei costă și o pornește doar ownerul sau responsabilul licitației.';
  END IF;
  -- verificator R4 (runda 1): coada citește DOAR planșe (tip='plansa' — 40 de documente la 25.09.2026); orice alt tip are
  -- fluxul lui (ofertare-ingest-doc), iar citirea pe zone cu Opus e cea mai scumpă.
  IF v_doc.tip IS DISTINCT FROM 'plansa' THEN
    RETURN jsonb_build_object('eroare', 'documentul nu e planșă (tip ≠ plansa) — coada citește doar planșe');
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
    -- un singur job activ pe tăiere: întoarcem modul JOBULUI EXISTENT (UI nu afișează modul cerut ca fiind cel pus în coadă)
    SELECT q.id, q.mod INTO v_id, v_mod_existent FROM ofertare_plansa_coada q
     WHERE q.doc_id = p_doc_id AND COALESCE(q.taiat_la, '') = COALESCE(v_doc.analiza -> 'plansa' ->> 'taiat_la', '')
       AND q.stare IN ('asteapta', 'lucru');
    RETURN jsonb_build_object('id', v_id, 'existent', true, 'mod', v_mod_existent);
  END IF;
  RETURN jsonb_build_object('id', v_id, 'existent', false, 'mod', p_mod);
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
  -- Rezervările workerului căzut rămân în registru; claim-ul nu le eliberează și nu le schimbă ziua.
  UPDATE ofertare_plansa_coada SET stare = 'eroare', eroare = 'lease expirat de ' || incercari || ' ori — worker oprit repetat',
         terminat_la = now(), claim_token = NULL
   WHERE stare = 'lucru' AND lease_pana < now() AND incercari >= max_incercari;

  RETURN QUERY
  UPDATE ofertare_plansa_coada q
     SET stare = 'lucru', luat_de = p_worker, luat_la = now(), claim_token = gen_random_uuid(),
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

-- Ordinea comună a lock-urilor: zi bugetară → job → rezervare. Lock-ul de job serializează și zile diferite.
-- SECURITY INVOKER: numai service_role are drepturile necesare; niciun privilegiu suplimentar nu e necesar.
CREATE OR REPLACE FUNCTION public.ofertare_plansa_rezerva(
  p_job_id bigint, p_claim_token uuid, p_suma numeric, p_plafon_zi numeric)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_zi date;
  v_job ofertare_plansa_coada%ROWTYPE;
  v_job_cost numeric;
  v_zi_cost numeric;
  v_id bigint;
BEGIN
  IF p_suma IS NULL OR p_suma <= 0 OR p_suma >= 'Infinity'::numeric
     OR p_plafon_zi IS NULL OR p_plafon_zi < 0 OR p_plafon_zi >= 'Infinity'::numeric THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'buget invalid');
  END IF;
  -- Rotunjire conservatoare la precizia registrului.
  p_suma := ceil(p_suma * 10000) / 10000;
  LOOP
    v_zi := (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date;
    PERFORM pg_advisory_xact_lock(494003, v_zi - DATE '2000-01-01');
    EXIT WHEN v_zi = (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date;
  END LOOP;
  SELECT * INTO v_job FROM ofertare_plansa_coada WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.stare <> 'lucru' OR p_claim_token IS NULL
     OR v_job.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'lease');
  END IF;
  SELECT COALESCE(sum(COALESCE(cost_usd, rezervat_usd)), 0) INTO v_job_cost
    FROM ofertare_plansa_buget WHERE job_id = p_job_id;
  IF v_job_cost + p_suma > COALESCE(v_job.plafon_usd, 10) THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'plafon job');
  END IF;
  SELECT COALESCE(sum(COALESCE(cost_usd, rezervat_usd)), 0) INTO v_zi_cost
    FROM ofertare_plansa_buget WHERE zi = v_zi;
  IF v_zi_cost + p_suma > p_plafon_zi THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'plafon pe zi');
  END IF;
  INSERT INTO ofertare_plansa_buget(job_id, claim_token, zi, rezervat_usd)
    VALUES (p_job_id, p_claim_token, v_zi, p_suma) RETURNING id INTO v_id;
  UPDATE ofertare_plansa_coada SET cost_usd = v_job_cost + p_suma WHERE id = p_job_id;
  RETURN jsonb_build_object('ok', true, 'rezervare_id', v_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ofertare_plansa_rezerva(bigint, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_plansa_rezerva(bigint, uuid, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.ofertare_plansa_regularizeaza(
  p_rezervare_id bigint, p_claim_token uuid, p_cost numeric, p_cert boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_r ofertare_plansa_buget%ROWTYPE;
  v_total numeric;
BEGIN
  SELECT * INTO v_r FROM ofertare_plansa_buget WHERE id = p_rezervare_id;
  IF NOT FOUND OR p_claim_token IS NULL OR v_r.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'lease');
  END IF;
  IF (p_cert IS TRUE AND p_cost IS NULL)
     OR (p_cost IS NOT NULL AND (p_cost < 0 OR p_cost >= 'Infinity'::numeric)) THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'cost invalid');
  END IF;
  PERFORM pg_advisory_xact_lock(494003, v_r.zi - DATE '2000-01-01');
  PERFORM 1 FROM ofertare_plansa_coada WHERE id = v_r.job_id FOR UPDATE;
  SELECT * INTO v_r FROM ofertare_plansa_buget WHERE id = p_rezervare_id FOR UPDATE;
  -- Tokenul aparține rezervării: și un răspuns întârziat poate contabiliza costul claim-ului vechi.
  -- Repetarea RPC-ului nu regularizează a doua oară și nu poate elibera ulterior o sumă incertă.
  IF v_r.stare = 'rezervat' THEN
    UPDATE ofertare_plansa_buget
       SET cost_usd = CASE WHEN p_cert IS TRUE THEN ceil(p_cost * 10000) / 10000
                          ELSE greatest(ceil(p_cost * 10000) / 10000, rezervat_usd) END,
           stare = CASE WHEN p_cert IS TRUE THEN 'regularizat' ELSE 'incert' END,
           regularizat_la = clock_timestamp()
     WHERE id = p_rezervare_id AND claim_token = p_claim_token;
  END IF;
  SELECT COALESCE(sum(COALESCE(cost_usd, rezervat_usd)), 0) INTO v_total
    FROM ofertare_plansa_buget WHERE job_id = v_r.job_id;
  UPDATE ofertare_plansa_coada SET cost_usd = v_total WHERE id = v_r.job_id;
  RETURN jsonb_build_object('ok', true, 'cost_usd', v_total);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ofertare_plansa_regularizeaza(bigint, uuid, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_plansa_regularizeaza(bigint, uuid, numeric, boolean) TO service_role;

-- Prelungirea lease-ului și finalizarea le face workerul direct (service_role), condiționat:
--   UPDATE ofertare_plansa_coada SET lease_pana = now() + interval '10 min', runde = ..., jurnal = ...
--    WHERE id = $1 AND claim_token = $token AND stare = 'lucru'   -- 0 rânduri => lease pierdut => workerul se oprește
