-- Rollback V2-J04: restaureaz? 20260928k, p?streaz? toate dovezile ?i protec?ia append-only.
-- Matricea 20260928o ?i por?ile R12/R5 nu se modific?. Nu se ?terg date.
CREATE OR REPLACE FUNCTION public.fn_pt_pachet_depus_verifica()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.stare = 'depus' AND OLD.stare IS DISTINCT FROM 'depus' THEN
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id = NEW.id AND f.rol = 'depus_final') THEN
      RAISE EXCEPTION 'Pachetul nu poate fi marcat depus fără fișierele efectiv depuse în SEAP (rol depus_final, cu SHA-256).' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f WHERE f.pachet_id = NEW.id AND f.rol = 'dovada_seap') THEN
      RAISE EXCEPTION 'Pachetul nu poate fi marcat depus fără dovada depunerii din SEAP (rol dovada_seap).' USING ERRCODE = 'P0001';
    END IF;
    NEW.depus_la := now();
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.fn_pt_pachet_depus_verifica() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_pt_fisier_path_obligatoriu ON public.ofertare_pt_pachet_fisiere;
DROP TRIGGER IF EXISTS trg_pt_fisier_insert_stare ON public.ofertare_pt_pachet_fisiere;   -- C1
DROP TRIGGER IF EXISTS trg_pt_fisier_imuabil ON public.ofertare_pt_pachet_fisiere;        -- C3
DROP TRIGGER IF EXISTS trg_pt_pachet_delete_garda ON public.ofertare_pt_pachet;           -- C3 (pachet aprobat / depus)
REVOKE INSERT ON public.ofertare_pt_pachet_verificari FROM service_role;
REVOKE USAGE ON SEQUENCE public.ofertare_pt_pachet_verificari_id_seq FROM service_role;
REVOKE EXECUTE ON FUNCTION public.ofertare_pt_fisier_snapshot(bigint) FROM service_role;
