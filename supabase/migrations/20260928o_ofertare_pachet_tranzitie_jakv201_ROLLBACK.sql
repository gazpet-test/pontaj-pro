-- Rollback JAK-V2-01: elimină matricea de tranziții (revine la starea vulnerabilă — doar pentru dezvoltare).
DROP TRIGGER IF EXISTS trg_ofertare_pt_pachet_matrice ON public.ofertare_pt_pachet;
DROP FUNCTION IF EXISTS public.fn_ofertare_pt_pachet_matrice();
