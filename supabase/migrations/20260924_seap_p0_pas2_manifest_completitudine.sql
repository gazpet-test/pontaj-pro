-- P0 pas 2 (Copilot, aprobat Răzvan 24.09.2026): identitatea fișierelor din SEAP + stări + poarta de completitudine.
--
-- Traseul: publicare SEAP → container (.p7s) → arhivă / set de volume → fișier extras (cale + mărime + SHA-256)
--          → document ERP → rezultat de citire.
-- „enumerarea SEAP a eșuat” ≠ „nu lipsește nimic”; „fișier încărcat” ≠ „document citit”.
-- Blocajul e pe APROBAREA FINALĂ a pachetului PT (ofertare_pt_pachet → 'aprobat'/'depus'), verificat pe SERVER (trigger);
-- lucrul pe draft nu e atins.

-- 1) etapa la care a ajuns / a picat fiecare fișier SEAP
ALTER TABLE public.ofertare_seap_fisiere DROP CONSTRAINT IF EXISTS ofertare_seap_fisiere_stare_check;
ALTER TABLE public.ofertare_seap_fisiere ADD CONSTRAINT ofertare_seap_fisiere_stare_check
  CHECK (stare IN ('identificat', 'ok', 'eroare', 'sarit'));
ALTER TABLE public.ofertare_seap_fisiere ADD COLUMN IF NOT EXISTS etapa text
  CHECK (etapa IN ('identificare', 'descarcare', 'semnatura', 'set_volume', 'listare', 'extragere', 'urcare'));
COMMENT ON COLUMN public.ofertare_seap_fisiere.etapa IS 'etapa la care s-a oprit (stare=eroare) sau ultima etapă atinsă';

-- 2) manifestul fișierelor extrase (SHA-256 pe output-ul validat, după încheierea extragerii)
CREATE TABLE IF NOT EXISTS public.ofertare_seap_manifest (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id  bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  arhiva_cheie  text   NOT NULL,          -- cheia fișierului SEAP (primul volum / arhiva) din ofertare_seap_fisiere
  cale          text   NOT NULL,          -- calea în arhivă
  marime        bigint NOT NULL,
  sha256        text   NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  document_id   bigint REFERENCES public.ofertare_documente_atribuire(id) ON DELETE SET NULL,
  stare         text   NOT NULL CHECK (stare IN ('urcat', 'deja_in_platforma', 'eroare_urcare', 'ignorat')),
  motiv         text,
  verificat_la  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (licitatie_id, arhiva_cheie, cale)
);
ALTER TABLE public.ofertare_seap_manifest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ofertare_seap_manifest FROM PUBLIC, anon;
GRANT SELECT ON public.ofertare_seap_manifest TO authenticated;
GRANT ALL ON public.ofertare_seap_manifest TO service_role;
DROP POLICY IF EXISTS seap_manifest_citire ON public.ofertare_seap_manifest;
CREATE POLICY seap_manifest_citire ON public.ofertare_seap_manifest FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_are_acces_ofertare());
CREATE INDEX IF NOT EXISTS ofertare_seap_manifest_lic ON public.ofertare_seap_manifest (licitatie_id);
COMMENT ON TABLE public.ofertare_seap_manifest IS 'P0 pas 2: fiecare fișier extras dintr-o arhivă SEAP — cale, mărime, SHA-256, documentul ERP rezultat. Scris doar de workerul Terra (service_role).';

-- 3) completitudinea documentației, per licitație
CREATE OR REPLACE VIEW public.v_ofertare_seap_completitudine WITH (security_invoker = on) AS
WITH ess AS (
  SELECT d.licitatie_id,
         count(*) FILTER (WHERE d.tip IN ('fisa_date', 'cs_volum', 'lista_cantitati')) AS esentiale,
         count(*) FILTER (WHERE d.tip = 'cs_volum') AS caiete,
         count(*) FILTER (WHERE d.tip IN ('fisa_date', 'cs_volum', 'lista_cantitati') AND d.status_procesare <> 'procesat') AS esentiale_necitite,
         count(*) FILTER (WHERE d.status_procesare = 'neprocesat') AS necitite_total
  FROM public.ofertare_documente_atribuire d GROUP BY d.licitatie_id
), sf AS (
  SELECT f.licitatie_id,
         count(*) FILTER (WHERE f.stare = 'eroare') AS seap_erori,
         count(*) FILTER (WHERE f.stare = 'identificat') AS seap_in_curs,
         string_agg(f.nume_seap || ' [' || coalesce(f.etapa, '?') || ']', '; ' ORDER BY f.nume_seap) FILTER (WHERE f.stare = 'eroare') AS seap_erori_lista
  FROM public.ofertare_seap_fisiere f GROUP BY f.licitatie_id
)
SELECT l.id AS licitatie_id,
       (l.c_notice_id IS NOT NULL) AS din_seap,
       CASE WHEN l.c_notice_id IS NULL THEN 'n/a'
            WHEN c.licitatie_id IS NULL OR c.terminat_la IS NULL THEN 'nerulata'
            WHEN c.raport ? 'eroare' THEN 'eroare'
            ELSE 'ok' END AS enumerare,
       c.terminat_la AS enumerare_la,
       (c.raport->>'seap')::int AS seap_total,
       coalesce(sf.seap_erori, 0) AS seap_erori,
       coalesce(sf.seap_in_curs, 0) AS seap_in_curs,
       sf.seap_erori_lista,
       coalesce(e.esentiale, 0) AS esentiale,
       coalesce(e.caiete, 0) AS caiete,
       coalesce(e.esentiale_necitite, 0) AS esentiale_necitite,
       coalesce(e.necitite_total, 0) AS necitite_total,
       -- motivul blocajului final (NULL = complet); ordinea = etapa cea mai timpurie care lipsește
       CASE
         WHEN l.c_notice_id IS NOT NULL AND (c.licitatie_id IS NULL OR c.terminat_la IS NULL)
           THEN 'nu putem verifica completitudinea: documentația din SEAP nu a fost încă enumerată'
         WHEN l.c_notice_id IS NOT NULL AND c.raport ? 'eroare'
           THEN 'nu putem verifica completitudinea: enumerarea SEAP a eșuat (' || left(c.raport->>'eroare', 120) || ')'
         WHEN coalesce(sf.seap_erori, 0) > 0
           THEN sf.seap_erori || ' fișier(e) din SEAP nerecuperate: ' || left(sf.seap_erori_lista, 300)
         WHEN coalesce(sf.seap_in_curs, 0) > 0
           THEN sf.seap_in_curs || ' fișier(e) din SEAP încă în curs de aducere'
         WHEN coalesce(e.caiete, 0) = 0
           THEN 'niciun caiet de sarcini / volum de proiect identificat în documentație'
         WHEN coalesce(e.esentiale_necitite, 0) > 0
           THEN e.esentiale_necitite || ' document(e) esențiale (fișa de date, caiete/PT, liste de cantități) necitite sau citite parțial'
       END AS blocaj
FROM public.ofertare_licitatii l
LEFT JOIN public.ofertare_seap_cereri c ON c.licitatie_id = l.id
LEFT JOIN sf ON sf.licitatie_id = l.id
LEFT JOIN ess e ON e.licitatie_id = l.id;
REVOKE ALL ON public.v_ofertare_seap_completitudine FROM PUBLIC, anon;
GRANT SELECT ON public.v_ofertare_seap_completitudine TO authenticated, service_role;
COMMENT ON VIEW public.v_ofertare_seap_completitudine IS 'P0 pas 2: completitudinea documentației (enumerare SEAP, fișiere nerecuperate, caiete/PT, esențiale necitite). blocaj NULL = complet. Rând de poartă „documentatie” + trigger pe ofertare_pt_pachet.';

-- 4) poarta pe SERVER: pachetul PT nu trece în 'aprobat'/'depus' cât timp documentația nu e completă
CREATE OR REPLACE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_blocaj text; v_gasit boolean;
BEGIN
  IF NEW.stare IN ('aprobat', 'depus') AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM NEW.stare) THEN
    SELECT true, blocaj INTO v_gasit, v_blocaj FROM public.v_ofertare_seap_completitudine WHERE licitatie_id = NEW.licitatie_id;
    IF v_gasit IS NULL THEN
      RAISE EXCEPTION 'Aprobare blocată: nu putem verifica completitudinea documentației (licitația % nu apare în control)', NEW.licitatie_id USING ERRCODE = 'P0001';
    END IF;
    IF v_blocaj IS NOT NULL THEN
      RAISE EXCEPTION 'Aprobare blocată — documentația nu e completă: %', v_blocaj USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ofertare_pt_pachet_poarta_documentatie ON public.ofertare_pt_pachet;
CREATE TRIGGER trg_ofertare_pt_pachet_poarta_documentatie BEFORE INSERT OR UPDATE OF stare ON public.ofertare_pt_pachet
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie();
