-- Revenire numai inainte de folosirea B1; nu sterge istoric operational.
BEGIN;
-- Aceeasi ordine ca RPC-urile; o cerere in curs se termina inaintea garzilor.
SELECT pg_advisory_xact_lock(20261110,1);
LOCK TABLE public.magazie_inventar_angajat IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.magazie_echipamente IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.eip_intrari,public.eip_receptii IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  -- Verificam inclusiv randuri inactive si randuri cu jurnal ramas fara mapare.
  IF EXISTS (SELECT 1 FROM public.magazie_echipamente e
    WHERE (e.articol_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.eip_intrari i WHERE i.echipament_id=e.id))
      AND e.cantitate_total IS DISTINCT FROM (SELECT coalesce(sum(i.cantitate),0) FROM public.eip_intrari i WHERE i.echipament_id=e.id)) THEN
    RAISE EXCEPTION 'eip_jurnal_divergent';
  END IF;
  IF EXISTS (SELECT 1 FROM public.eip_intrari WHERE sursa <> 'migrare')
    OR EXISTS (SELECT 1 FROM public.eip_receptii)
    OR EXISTS (SELECT 1 FROM public.magazie_inventar_angajat WHERE marime IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.magazie_echipamente WHERE marime IS NOT NULL) THEN
    RAISE EXCEPTION 'eip_rollback_refuzat_istoric';
  END IF;
END $$;
DROP VIEW public.v_eip_stoc;
DROP FUNCTION public.fn_eip_intrare_factura(jsonb,jsonb,text);
DROP FUNCTION public.fn_eip_corectie(bigint,numeric,text);
DROP FUNCTION public.fn_eip_muta(bigint,bigint,text,numeric,text);
DROP FUNCTION public.fn_eip_articol_gaseste(text,text,text);
DROP FUNCTION public.fn_eip_verifica_drept();
DROP TRIGGER eip_inventar_marime ON public.magazie_inventar_angajat;
DROP FUNCTION public.fn_eip_copiaza_marime();
DROP TABLE public.eip_receptii;
DROP TABLE public.eip_intrari;
DROP TABLE public.eip_alias_furnizor;
DROP INDEX public.eip_stoc_articol_marime_uq;
ALTER TABLE public.magazie_inventar_angajat DROP COLUMN marime;
ALTER TABLE public.magazie_echipamente DROP COLUMN marime,DROP COLUMN articol_id;
DROP TABLE public.eip_articole;
COMMIT;
