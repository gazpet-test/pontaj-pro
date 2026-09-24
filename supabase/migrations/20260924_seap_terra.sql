-- Importul SEAP pe NAS Terra (24.09.2026, decizie Răzvan). Arhivele mari (Jilava: .zip.p7s de 54 MB;
-- Botoșani: RAR în 9 volume .p7s, ~850 MB) nu încap în Supabase (prag 20 MB) și nici în Vercel.
-- Workerul de pe Terra descarcă fișier cu fișier, scoate semnătura, despachetează ZIP/RAR (7z) și urcă.
--
-- 1) ofertare_seap_cereri: cine a cerut aducerea documentației unei licitații („Adu din SEAP" / veghe /
--    reconcilierea orară a workerului). Workerul ia rândurile cu cerut_la > terminat_la.
-- 2) ofertare_seap_fisiere: evidența PER FIȘIER DIN SEAP — stare, hash, mărime, câte fișiere au ieșit din
--    arhivă și MOTIVUL eșecului. Fără ea, arhivele (al căror nume nu apare ca document) s-ar re-descărca
--    la fiecare trecere, iar eșecurile ar rămâne tăcute (Botoșani nu avea nici măcar un rând de avertisment).
-- Scriere: doar service_role (workerul) + RPC-ul de cerere; citire: utilizatorii Ofertare.
CREATE TABLE IF NOT EXISTS public.ofertare_seap_cereri (
  licitatie_id bigint PRIMARY KEY REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  cerut_la     timestamptz NOT NULL DEFAULT now(),
  cerut_de     uuid,
  sursa        text NOT NULL DEFAULT 'om' CHECK (sursa IN ('om', 'veghe', 'reconciliere')),
  preluat_la   timestamptz,
  terminat_la  timestamptz,
  raport       jsonb
);
ALTER TABLE public.ofertare_seap_cereri ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofertare_seap_cereri_select ON public.ofertare_seap_cereri;
CREATE POLICY ofertare_seap_cereri_select ON public.ofertare_seap_cereri
  FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
REVOKE ALL ON public.ofertare_seap_cereri FROM anon, authenticated;
GRANT SELECT ON public.ofertare_seap_cereri TO authenticated;
GRANT ALL ON public.ofertare_seap_cereri TO service_role;

CREATE TABLE IF NOT EXISTS public.ofertare_seap_fisiere (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  licitatie_id    bigint NOT NULL REFERENCES public.ofertare_licitatii(id) ON DELETE CASCADE,
  nume_seap       text   NOT NULL,                 -- numele exact din SEAP (cu .p7s)
  cheie           text   NOT NULL,                 -- cheieNume (fără .p7s, fără spații/virgule/paranteze)
  stare           text   NOT NULL CHECK (stare IN ('ok', 'eroare', 'sarit')),
  motiv           text,                            -- de ce a eșuat / de ce s-a sărit
  marime          bigint,
  sha256          text,
  fisiere_extrase int,
  incercari       int    NOT NULL DEFAULT 1,
  procesat_la     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (licitatie_id, cheie)
);
ALTER TABLE public.ofertare_seap_fisiere ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ofertare_seap_fisiere_select ON public.ofertare_seap_fisiere;
CREATE POLICY ofertare_seap_fisiere_select ON public.ofertare_seap_fisiere
  FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
REVOKE ALL ON public.ofertare_seap_fisiere FROM anon, authenticated;
GRANT SELECT ON public.ofertare_seap_fisiere TO authenticated;
GRANT ALL ON public.ofertare_seap_fisiere TO service_role;

-- Cererea din UI („Adu din SEAP" → pe Terra). Doar utilizatori Ofertare; nu declanșează nimic plătit
-- (descărcarea e gratuită; citirea cu AI rămâne pe butonul separat „Procesează").
CREATE OR REPLACE FUNCTION public.fn_ofertare_seap_cere(p_licitatie_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_ofertare() THEN
    RAISE EXCEPTION 'Fără acces la modulul Ofertare' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id = p_licitatie_id AND c_notice_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Licitația % nu are anunț SEAP legat', p_licitatie_id;
  END IF;
  INSERT INTO public.ofertare_seap_cereri (licitatie_id, cerut_la, cerut_de, sursa)
  VALUES (p_licitatie_id, now(), auth.uid(), 'om')
  ON CONFLICT (licitatie_id) DO UPDATE SET cerut_la = now(), cerut_de = auth.uid(), sursa = 'om';
  RETURN jsonb_build_object('licitatie_id', p_licitatie_id, 'cerut_la', now());
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_seap_cere(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_seap_cere(bigint) TO authenticated, service_role;
