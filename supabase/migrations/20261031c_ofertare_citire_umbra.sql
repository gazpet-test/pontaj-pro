-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261031c — Ofertare: UMBRA „cititorului 3” (laborator OCR, decizia Răzvan 16.10.2026, varianta A apoi B).
-- O a treia citire (Claude Code headless pe serverul AI, backend claude_cli = abonament; mai târziu api) rulează ÎN UMBRĂ pe paginile
-- scanate ale licitațiilor reale (doar cele citite cu OCR AI în producție), pe PDF-urile de pe NAS potrivite pe SHA cu BD. Rezultatele
-- stau LÂNGĂ producție, legate de document / pagină / bandă / imagine, fără să atingă text_extras sau derivatele lui. Promovarea în
-- producție (varianta B, după ~5 licitații curate) trece pe protocolul de text CAS (20261031b), cu preview și „da”-ul lui Răzvan,
-- NICIODATĂ automat: de aceea rândul păstrează sha-ul text_extras de la momentul citirii și proveniența completă.
--   * ofertare_citire_umbra — citire pentru accesul Ofertare (fn_are_acces_ofertare); NICIO scriere pentru rolurile aplicației
--     (nici service_role): scrierea doar ca postgres, prin psql de pe serverul AI (fără edge nou acum).
--   * Numele NU are prefixul ofertare_ocr_: tabelul nu intră în amprenta pilotului OCR (fn_ofertare_ocr_amprenta), deci nu schimbă
--     revenirile 20261029b/c/e/30d.
-- Nu atinge nicio tabelă / funcție existentă.
-- Revenire: supabase/revenire/20261031c_ofertare_citire_umbra_ROLLBACK.sql.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261031c_ofertare_citire_umbra:' || txid_current() THEN
    RAISE EXCEPTION '20261031c: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261031c: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.ofertare_citire_umbra') IS NOT NULL THEN RAISE EXCEPTION '20261031c: deja aplicata'; END IF;
  IF to_regclass('public.ofertare_documente_atribuire') IS NULL OR to_regprocedure('public.fn_are_acces_ofertare()') IS NULL
     OR to_regprocedure('public.fn_ofertare_citire_umbra_pazeste()') IS NOT NULL THEN
    RAISE EXCEPTION '20261031c: preconditie (tabele / functia de acces Ofertare lipsa)';
  END IF;
END $pre$;

CREATE TABLE public.ofertare_citire_umbra (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- licitatia NU se stocheaza: se deriva din document (review Copilot r1 P1-1 - nicio pereche licitatie/document incoerenta)
  document_id         bigint NOT NULL REFERENCES public.ofertare_documente_atribuire(id) ON DELETE CASCADE,
  pagina              integer NOT NULL CHECK (pagina BETWEEN 1 AND 10000),            -- pagina in documentul din BD (dupa pagina_offset)
  pagina_offset       integer NOT NULL CHECK (pagina_offset BETWEEN 0 AND 10000),     -- maparea document -> PDF OBSERVATA la citire (P2-1)
  banda               text NOT NULL CHECK (banda ~ '^p[0-9]{4}_b[0-9]{1,2}$'),        -- banda din planul pipeline-ului
  pdf_sha256          text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),             -- PDF-ul de pe NAS (potrivit pe SHA cu BD)
  pagina_pdf          integer NOT NULL CHECK (pagina_pdf BETWEEN 1 AND 10000),        -- pagina in PDF-ul de pe NAS (parinte la split)
  image_sha256        text NOT NULL CHECK (image_sha256 ~ '^[0-9a-f]{64}$'),           -- imaginea benzii (planul pipeline-ului)
  orientare           smallint NOT NULL CHECK (orientare IN (0, 90, 180, 270)),
  orientare_sursa     text NOT NULL CHECK (orientare_sursa IN ('om', 'laborator', 'text_nativ')),
  cititor             text NOT NULL CHECK (cititor = 'cititor3'),
  backend             text NOT NULL CHECK (backend IN ('claude_cli', 'api')),
  model               text NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  prompt_versiune     text NOT NULL CHECK (length(prompt_versiune) BETWEEN 1 AND 40),
  ok                  boolean NOT NULL,                                                  -- false = garda / eroare (text gol)
  semnal              text CHECK (semnal IS NULL OR length(semnal) <= 200),
  text                text NOT NULL CHECK (length(text) <= 200000),
  text_sha256         text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  text_extras_sha256  text CHECK (text_extras_sha256 IS NULL OR text_extras_sha256 ~ '^[0-9a-f]{64}$'),  -- productia LA CITIRE (CAS)
  comparatie          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(comparatie) = 'object' AND pg_column_size(comparatie) <= 20000),
  secunde             numeric(8,1) CHECK (secunde IS NULL OR secunde >= 0),
  cost                text NOT NULL CHECK (cost IN ('abonament', 'api')),
  stare               text NOT NULL DEFAULT 'neevaluat' CHECK (stare IN ('neevaluat', 'bun', 'respins', 'promovat')),
  stare_motiv         text CHECK (stare_motiv IS NULL OR length(stare_motiv) <= 300),
  stare_la            timestamptz,
  citit_de            text NOT NULL CHECK (length(citit_de) BETWEEN 1 AND 100),
  citit_la            timestamptz NOT NULL DEFAULT now(),
  CHECK (ok OR text = ''),
  CHECK ((stare = 'neevaluat') = (stare_la IS NULL)),
  CHECK (pagina_pdf = pagina + pagina_offset),
  CHECK ((backend = 'claude_cli') = (cost = 'abonament')),                                         -- P2-2: backend <-> cost
  CHECK (stare <> 'promovat' OR (ok AND text_extras_sha256 IS NOT NULL)),                          -- P2-2: promovat doar citire ok, cu CAS
  UNIQUE (document_id, banda, image_sha256, backend, model, prompt_versiune)                       -- P1-2: backend in cheie
);
CREATE INDEX ofertare_citire_umbra_doc_idx ON public.ofertare_citire_umbra (document_id, pagina);
CREATE INDEX ofertare_citire_umbra_stare_idx ON public.ofertare_citire_umbra (stare, document_id);

-- un rand PROMOVAT e proveniența unei schimbari de productie: nu se sterge (nici prin cascada de la document, nici direct)
-- si nu se mai modifica (review Copilot r1, ON DELETE CASCADE vs audit)
CREATE FUNCTION public.fn_ofertare_citire_umbra_pazeste() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
BEGIN
  IF OLD.stare = 'promovat' THEN
    RAISE EXCEPTION 'ofertare_citire_umbra %: randul promovat e provenienta unei schimbari de productie (nu se sterge / modifica)', OLD.id
      USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $f$;
REVOKE ALL ON FUNCTION public.fn_ofertare_citire_umbra_pazeste() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER ofertare_citire_umbra_pazeste BEFORE UPDATE OR DELETE ON public.ofertare_citire_umbra
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_citire_umbra_pazeste();

ALTER TABLE public.ofertare_citire_umbra ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_citire_umbra FROM PUBLIC, anon, authenticated, service_role;
DO $secventa$
BEGIN
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', pg_get_serial_sequence('public.ofertare_citire_umbra', 'id'));
END $secventa$;
GRANT SELECT ON public.ofertare_citire_umbra TO authenticated;
CREATE POLICY ofertare_citire_umbra_select ON public.ofertare_citire_umbra FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
COMMENT ON TABLE public.ofertare_citire_umbra IS 'Umbra cititorului 3 (20261031c): a treia citire langa productie, fara efect pe text_extras. Scriere doar postgres (psql, server AI). Promovare doar prin CAS cu da-ul lui Razvan.';

DO $post$
DECLARE rol text;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(rol, 'public.ofertare_citire_umbra', 'INSERT') OR has_table_privilege(rol, 'public.ofertare_citire_umbra', 'UPDATE')
       OR has_table_privilege(rol, 'public.ofertare_citire_umbra', 'DELETE') OR has_table_privilege(rol, 'public.ofertare_citire_umbra', 'TRUNCATE')
       OR has_table_privilege(rol, 'public.ofertare_citire_umbra', 'REFERENCES') OR has_table_privilege(rol, 'public.ofertare_citire_umbra', 'TRIGGER')
       OR has_any_column_privilege(rol, 'public.ofertare_citire_umbra', 'INSERT') OR has_any_column_privilege(rol, 'public.ofertare_citire_umbra', 'UPDATE')
       OR has_sequence_privilege(rol, pg_get_serial_sequence('public.ofertare_citire_umbra', 'id'), 'USAGE')
       OR has_sequence_privilege(rol, pg_get_serial_sequence('public.ofertare_citire_umbra', 'id'), 'UPDATE')
       OR has_sequence_privilege(rol, pg_get_serial_sequence('public.ofertare_citire_umbra', 'id'), 'SELECT')
       OR (rol <> 'authenticated') = has_table_privilege(rol, 'public.ofertare_citire_umbra', 'SELECT') THEN
      RAISE EXCEPTION '20261031c: postconditie drepturi / %', rol;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ofertare_citire_umbra'::regclass) THEN RAISE EXCEPTION '20261031c: RLS oprit'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ofertare_citire_umbra') <> 1 THEN
    RAISE EXCEPTION '20261031c: postconditie politici';
  END IF;
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(rol, 'public.fn_ofertare_citire_umbra_pazeste()', 'EXECUTE') THEN RAISE EXCEPTION '20261031c: postconditie executie / %', rol; END IF;
  END LOOP;
  IF current_setting('gazpet.livrare_migrare', true)
       IS DISTINCT FROM '20261031c_ofertare_citire_umbra:' || txid_current() THEN
    RAISE EXCEPTION '20261031c: garda final invalida';
  END IF;
END $post$;
