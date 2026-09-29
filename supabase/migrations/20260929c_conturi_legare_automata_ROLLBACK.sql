-- ROLLBACK pentru 20260929c_conturi_legare_automata.sql (rulat DUPĂ rollback-urile e și d).
-- Idempotent. Legăturile profiles.employee_id deja făcute RĂMÂN (sunt date corecte).
-- ⚠️ Se pierde profiles.tip_cont (marcajele extern/test/sistem): exportă-le înainte în claude_context.

-- handle_new_user revine la corpul original, VERBATIM (inclusiv SET search_path TO 'public').
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Inserăm doar dacă nu există deja (idempotent)
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    -- Nume default: prima parte a emailului, „Title Case" (înlocuim . și _ cu spațiu)
    INITCAP(REPLACE(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '), '_', ' ')),
    'manager_santier'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_profiles_protectie_legatura ON public.profiles;
DROP FUNCTION IF EXISTS public.fn_profiles_protectie_legatura();
DROP VIEW IF EXISTS public.v_admin_conturi_alerte;
DROP FUNCTION IF EXISTS public.fn_admin_conturi_alerte();
DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean);
DROP FUNCTION IF EXISTS public.fn_cont_candidati_angajat(text);
DROP FUNCTION IF EXISTS public.fn_cont_notifica_owneri(text, text, text, text);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_tip_cont_chk;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS tip_cont;
