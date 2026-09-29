-- Audit Ofertare V2 — JAK-V2-01 (28.09.2026): matrice de tranziții pe ofertare_pt_pachet.
-- PROBLEMA: pe ofertare_pt_pachet sunt DOUĂ politici UPDATE PERMISSIVE (ofertare_pt_pachet_update
-- USING stare='propus', și ofertare_pt_pachet_depune USING stare='aprobat'). Postgres combină
-- USING-urile permisive cu OR și CHECK-urile permisive cu OR, INDEPENDENT. Astfel rândul vechi
-- 'aprobat' trece USING-ul din _depune, iar rândul nou 'propus' trece CHECK-ul din _update →
-- retrogradarea aprobat→propus e permisă; la fel propus→depus direct (sare peste aprobare).
-- Retrogradarea la 'propus' scoate obiectele din înghețare (fn_ofertare_obiect_in_pachet_inghetat
-- verifică stare IN ('aprobat','depus')), deci fișierul din manifest poate fi înlocuit în Storage,
-- apoi reaprobat cu același sha256 — se pierde integritatea „ce bytes s-au aprobat/depus" (R11/R12).
--
-- FIX (defensiv, independent de OR-ul politicilor): un trigger BEFORE UPDATE care vede simultan
-- OLD și NEW și impune matricea de tranziții + imuabilitatea coloanelor de proveniență. Triggerul
-- rulează după RLS USING și înainte de RLS WITH CHECK, deci prinde orice combinație de politici.
-- Nu modifică politicile existente (fluxurile normale propus→aprobat→depus rămân valide).
--
-- Timpii aprobat_la/depus_la sunt puși de server (now()) în tranziție; nu se pot pre-seta.
-- Matrice permisă:  propus → propus | aprobat(semnat de auth.uid())   ;   aprobat → depus   ;   depus → (imuabil)
-- Refuzat explicit: aprobat → propus (retrogradare) ; propus → depus (sare peste aprobare) ; orice pe pachet depus.

CREATE OR REPLACE FUNCTION public.fn_ofertare_pt_pachet_matrice()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- pachetul depus e complet imuabil (bytes-ii depuși nu se mai ating)
  IF OLD.stare = 'depus' THEN
    RAISE EXCEPTION 'Pachetul depus este imuabil; nicio modificare nu e permisă.' USING ERRCODE = 'P0001';
  END IF;
  -- coloane de proveniență imuabile pe un pachet existent
  IF NEW.licitatie_id IS DISTINCT FROM OLD.licitatie_id OR NEW.versiune IS DISTINCT FROM OLD.versiune THEN
    RAISE EXCEPTION 'licitatie_id și versiune sunt imuabile pe un pachet existent.' USING ERRCODE = 'P0001';
  END IF;
  -- semnătura de aprobare nu se rescrie / backdatează după ce a fost pusă
  IF OLD.aprobat_de IS NOT NULL
     AND (NEW.aprobat_de IS DISTINCT FROM OLD.aprobat_de OR NEW.aprobat_la IS DISTINCT FROM OLD.aprobat_la) THEN
    RAISE EXCEPTION 'aprobat_de/aprobat_la nu se pot modifica după aprobare.' USING ERRCODE = 'P0001';
  END IF;
  -- proveniența temporală o scrie SERVERUL (Copilot, NO-GO 1 pe #515): aprobat_de/aprobat_la/depus_la
  -- nu se pot pre-seta de client; se completează doar în tranziția corespunzătoare, cu now().
  IF OLD.stare = 'propus' AND NEW.stare = 'propus'
     AND (NEW.aprobat_de IS DISTINCT FROM OLD.aprobat_de OR NEW.aprobat_la IS DISTINCT FROM OLD.aprobat_la) THEN
    RAISE EXCEPTION 'aprobat_de/aprobat_la se scriu doar la aprobare (propus→aprobat).' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.depus_la IS DISTINCT FROM OLD.depus_la AND NOT (OLD.stare = 'aprobat' AND NEW.stare = 'depus') THEN
    RAISE EXCEPTION 'depus_la se scrie doar la depunere (aprobat→depus).' USING ERRCODE = 'P0001';
  END IF;
  -- matricea de tranziții (numai la schimbarea stării)
  IF OLD.stare IS DISTINCT FROM NEW.stare THEN
    IF NOT ( (OLD.stare = 'propus'  AND NEW.stare = 'aprobat')
          OR (OLD.stare = 'aprobat' AND NEW.stare = 'depus') ) THEN
      RAISE EXCEPTION 'Tranziție de pachet interzisă: % → % (permis doar: propus→aprobat, aprobat→depus).',
        OLD.stare, NEW.stare USING ERRCODE = 'P0001';
    END IF;
    -- aprobarea trebuie semnată de utilizatorul curent, în prezent (nu de altcineva, nu antedatat gol)
    IF NEW.stare = 'aprobat' AND (NEW.aprobat_de IS NULL OR NEW.aprobat_de IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Aprobarea trebuie semnată de utilizatorul curent (aprobat_de = auth.uid()).' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.stare = 'aprobat' THEN NEW.aprobat_la := now(); END IF;  -- ora aprobării = ora serverului
    IF NEW.stare = 'depus'   THEN NEW.depus_la   := now(); END IF;  -- (și fn_pt_pachet_depus_verifica o face)
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_pt_pachet_matrice() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_ofertare_pt_pachet_matrice ON public.ofertare_pt_pachet;
-- BEFORE UPDATE pe TOATE coloanele (nu doar OF stare): imuabilitatea de proveniență trebuie prinsă
-- și la un UPDATE care nu schimbă starea. Numele sortează înaintea celorlalte triggere ofertare_*.
CREATE TRIGGER trg_ofertare_pt_pachet_matrice BEFORE UPDATE ON public.ofertare_pt_pachet
  FOR EACH ROW EXECUTE FUNCTION public.fn_ofertare_pt_pachet_matrice();
