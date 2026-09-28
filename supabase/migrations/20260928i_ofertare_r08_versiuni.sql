-- Audit Ofertare R08 (28.09.2026): modificările care schimbă CE a confirmat omul invalidează verificarea.
--  * capitolul PT: titlul, eticheta, formularul și numărul (apar în exportul depus) produc o versiune nouă,
--    la fel ca textul/fișierul — deci legăturile verificate pe versiunea veche nu mai trec drept verificate;
--  * cerința editată direct (text_cerinta schimbat, nu prin înlocuire) invalidează legăturile verificate
--    și păstrează textul vechi în constatare (urmă a ce s-a confirmat).
CREATE OR REPLACE FUNCTION public.fn_pt_capitol_versioneaza()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Conținutul SAU ce apare în exportul depus (titlu, etichetă, formular, număr). Responsabilul,
  -- starea etc. nu sunt revizii ale piesei depuse.
  IF NEW.continut IS DISTINCT FROM OLD.continut
     OR NEW.fisier_path IS DISTINCT FROM OLD.fisier_path
     OR NEW.titlu IS DISTINCT FROM OLD.titlu
     OR NEW.eticheta IS DISTINCT FROM OLD.eticheta
     OR NEW.formular IS DISTINCT FROM OLD.formular
     OR NEW.nr IS DISTINCT FROM OLD.nr THEN
    INSERT INTO public.ofertare_pt_capitole_versiuni
      (capitol_id, versiune, titlu, continut, fisier_path, sursa, stare, schimbat_de)
    VALUES (OLD.id, OLD.versiune, OLD.titlu, OLD.continut, OLD.fisier_path, OLD.sursa, OLD.stare, auth.uid())
    ON CONFLICT (capitol_id, versiune) DO NOTHING;
    NEW.versiune := OLD.versiune + 1;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_pt_invalideaza_la_inlocuire()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.inlocuita_de IS NOT NULL AND OLD.inlocuita_de IS NULL THEN
    UPDATE public.ofertare_pt_legaturi
       SET stare = 'atribuita',
           verificat_la_versiunea = NULL,
           constatare = concat_ws(' | ', nullif(constatare, ''),
             format('INVALIDATA %s: cerinta a fost inlocuita prin clarificare (noua: #%s)', to_char(now(), 'DD.MM.YYYY'), NEW.inlocuita_de))
     WHERE cerinta_id = NEW.id AND fel = 'capitol' AND stare IN ('verificata', 'dovedita', 'redactata');
  ELSIF NEW.text_cerinta IS DISTINCT FROM OLD.text_cerinta THEN
    UPDATE public.ofertare_pt_legaturi
       SET stare = 'atribuita',
           verificat_la_versiunea = NULL,
           constatare = concat_ws(' | ', nullif(constatare, ''),
             format('INVALIDATA %s: textul cerintei a fost editat; verificat pe textul vechi: %s', to_char(now(), 'DD.MM.YYYY'), left(OLD.text_cerinta, 300)))
     WHERE cerinta_id = NEW.id AND fel = 'capitol' AND stare IN ('verificata', 'dovedita', 'redactata');
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_pt_invalideaza_la_inlocuire ON public.ofertare_cerinte;
CREATE TRIGGER trg_pt_invalideaza_la_inlocuire AFTER UPDATE OF inlocuita_de, text_cerinta ON public.ofertare_cerinte
  FOR EACH ROW EXECUTE FUNCTION public.fn_pt_invalideaza_la_inlocuire();
