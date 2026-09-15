-- Razvan 15.09.2026: documentele care APAR in SEAP dupa importul initial al licitatiei
-- (raspunsuri la clarificari, erate, planse noi) se vad separat, in tab-ul Clarificari
-- al fisei, cu buton de citire AI. Marcajul il pune ofertare-seap-veghe (v4) la fiecare
-- rulare care gaseste documente noi; backfill-ul de mai jos acopera ce a intrat deja.
ALTER TABLE public.ofertare_documente_atribuire
  ADD COLUMN IF NOT EXISTS aparut_ulterior boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ofertare_documente_atribuire.aparut_ulterior IS
  'true = documentul a aparut in SEAP dupa importul initial (adus de ofertare-seap-veghe sau placeholder /neincarcat/). Se afiseaza in sectiunea „Documente noi din SEAP” din tab-ul Clarificari.';

-- Backfill: ce a venit din SEAP la mai mult de o zi dupa crearea licitatiei = aparut ulterior
UPDATE public.ofertare_documente_atribuire d
   SET aparut_ulterior = true
  FROM public.ofertare_licitatii l
 WHERE d.licitatie_id = l.id
   AND d.sursa = 'seap'
   AND d.created_at > l.created_at + interval '1 day'
   AND NOT d.aparut_ulterior;

CREATE INDEX IF NOT EXISTS ofertare_documente_atribuire_aparut_ulterior_idx
  ON public.ofertare_documente_atribuire (licitatie_id)
  WHERE aparut_ulterior;
