-- PR 2 Laza — „proveniența temporală".
-- Solicitările de clarificare primite de la AUTORITATEA CONTRACTANTĂ (direcția inversă față de
-- ofertare_clarificari, care sunt întrebările NOASTRE). Unitatea e PUNCTUL (Laza: 11 puncte, termen 1 zi).
-- Anexele răspunsului poartă document_date + sha256; proveniența NU se declară, se DEMONSTREAZĂ:
--   retrimis      = sha256 identic cu un fișier din manifestul pachetului depus
--   pre_depunere  = document_date <= data depunerii
--   post_depunere = document_date > data depunerii  (ATSD 11.09 la Laza) — cere justificare scrisă
--   fara_data     = nu s-a completat data documentului
-- Nu se modifică documentele depuse; răspunsul se construiește în jurul lor (decis Răzvan 14.09).

CREATE TABLE IF NOT EXISTS public.ofertare_solicitari_ac (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id  bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  nr            integer NOT NULL DEFAULT 1,
  primita_la    timestamptz NOT NULL DEFAULT now(),
  termen_raspuns timestamptz,
  fisier_path   text,
  nota          text,
  stare         text NOT NULL DEFAULT 'deschisa' CHECK (stare IN ('deschisa','trimisa','trimisa_cu_rezerve')),
  trimisa_la    timestamptz,
  trimisa_de    uuid,
  rezerve       text,
  creat_de      uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (licitatie_id, nr)
);

CREATE TABLE IF NOT EXISTS public.ofertare_solicitari_ac_puncte (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  solicitare_id  bigint NOT NULL REFERENCES public.ofertare_solicitari_ac(id) ON DELETE CASCADE,
  nr             integer NOT NULL,
  intrebare      text NOT NULL,
  cerinta_id     bigint REFERENCES public.ofertare_cerinte(id) ON DELETE SET NULL,
  raspuns        text,
  -- unde în oferta DEPUSĂ se află informația (pagină/capitol) — cauza comună la Laza: exista, dar nu era localizabilă
  locator_oferta text,
  stare          text NOT NULL DEFAULT 'de_raspuns' CHECK (stare IN ('de_raspuns','raspuns')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (solicitare_id, nr)
);

CREATE TABLE IF NOT EXISTS public.ofertare_solicitari_ac_anexe (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  punct_id       bigint NOT NULL REFERENCES public.ofertare_solicitari_ac_puncte(id) ON DELETE CASCADE,
  nume           text NOT NULL,
  fisier_path    text,
  sha256         text,
  size_bytes     bigint,
  document_date  date,
  -- calea onestă: „e post-depunere, iată de ce e admisibil" (ex. dovadă a unei stări de fapt pre-existente)
  justificare_post_depunere text,
  creat_de       uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ofertare_solicitari_ac_lic_idx ON public.ofertare_solicitari_ac(licitatie_id);
CREATE INDEX IF NOT EXISTS ofertare_solicitari_ac_puncte_sol_idx ON public.ofertare_solicitari_ac_puncte(solicitare_id);
CREATE INDEX IF NOT EXISTS ofertare_solicitari_ac_anexe_punct_idx ON public.ofertare_solicitari_ac_anexe(punct_id);

ALTER TABLE public.ofertare_solicitari_ac ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_solicitari_ac_puncte ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertare_solicitari_ac_anexe ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertare_solicitari_ac, public.ofertare_solicitari_ac_puncte, public.ofertare_solicitari_ac_anexe TO authenticated;
GRANT ALL ON public.ofertare_solicitari_ac, public.ofertare_solicitari_ac_puncte, public.ofertare_solicitari_ac_anexe TO service_role;
CREATE POLICY solicitari_ac_rw ON public.ofertare_solicitari_ac FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY solicitari_ac_puncte_rw ON public.ofertare_solicitari_ac_puncte FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY solicitari_ac_anexe_rw ON public.ofertare_solicitari_ac_anexe FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Starea unei solicitări, un rând per solicitare — hrana pentru evalueazaPoartaClarificare (funcție pură).
-- Data depunerii: pachetul cu stare='depus' (depus_la); dacă nu există (Laza a fost depusă în afara ERP),
-- cade pe termenul de depunere al licitației — și view-ul spune de unde a luat-o (depus_sursa).
CREATE OR REPLACE VIEW public.v_ofertare_solicitari_ac_stare WITH (security_invoker = on) AS
WITH dep AS (
  SELECT l.id AS licitatie_id,
         COALESCE((SELECT max(pk.depus_la) FROM ofertare_pt_pachet pk WHERE pk.licitatie_id = l.id AND pk.stare = 'depus'), l.termen_depunere) AS depus_la,
         CASE WHEN EXISTS (SELECT 1 FROM ofertare_pt_pachet pk WHERE pk.licitatie_id = l.id AND pk.stare = 'depus') THEN 'pachet' ELSE 'termen_licitatie' END AS depus_sursa
  FROM ofertare_licitatii l
), anx AS (
  SELECT a.id, a.punct_id, p.solicitare_id, a.nume, a.document_date, a.sha256, a.justificare_post_depunere,
         d.depus_la,
         CASE
           WHEN a.sha256 IS NOT NULL AND EXISTS (
             SELECT 1 FROM ofertare_pt_pachet_fisiere f JOIN ofertare_pt_pachet pk ON pk.id = f.pachet_id
             WHERE pk.licitatie_id = s.licitatie_id AND pk.stare = 'depus' AND f.sha256 = a.sha256) THEN 'retrimis'
           WHEN a.document_date IS NULL THEN 'fara_data'
           WHEN d.depus_la IS NULL THEN 'fara_data'
           WHEN a.document_date <= d.depus_la::date THEN 'pre_depunere'
           ELSE 'post_depunere'
         END AS provenienta
  FROM ofertare_solicitari_ac_anexe a
  JOIN ofertare_solicitari_ac_puncte p ON p.id = a.punct_id
  JOIN ofertare_solicitari_ac s ON s.id = p.solicitare_id
  JOIN dep d ON d.licitatie_id = s.licitatie_id
)
SELECT s.id AS solicitare_id, s.licitatie_id, s.nr, s.primita_la, s.termen_raspuns, s.stare, s.trimisa_la, s.rezerve,
       d.depus_la, d.depus_sursa,
       (SELECT count(*) FROM ofertare_solicitari_ac_puncte p WHERE p.solicitare_id = s.id) AS puncte,
       (SELECT count(*) FROM ofertare_solicitari_ac_puncte p WHERE p.solicitare_id = s.id AND (p.stare <> 'raspuns' OR COALESCE(btrim(p.raspuns),'') = '')) AS puncte_fara_raspuns,
       (SELECT count(*) FROM ofertare_solicitari_ac_puncte p WHERE p.solicitare_id = s.id AND p.stare = 'raspuns' AND COALESCE(btrim(p.locator_oferta),'') = '') AS puncte_fara_locator,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'punct_id', x.punct_id, 'nume', x.nume, 'document_date', x.document_date,
                'provenienta', x.provenienta, 'justificata', COALESCE(btrim(x.justificare_post_depunere),'') <> '') ORDER BY x.id), '[]'::jsonb)
          FROM anx x WHERE x.solicitare_id = s.id) AS anexe
FROM ofertare_solicitari_ac s
JOIN dep d ON d.licitatie_id = s.licitatie_id;
