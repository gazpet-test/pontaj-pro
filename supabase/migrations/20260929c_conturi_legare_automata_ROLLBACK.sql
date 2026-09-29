-- ROLLBACK pentru 20260929c_conturi_legare_automata.sql (rulat DUPĂ rollback-urile e și d).
-- Idempotent. Legăturile profiles.employee_id deja făcute RĂMÂN (sunt date corecte).
-- ⚠️ Se pierde profiles.tip_cont (marcajele extern/test/sistem): exportă-le înainte în claude_context.

-- Gardă de ordine: dacă obiectele din migrarea d mai există, fn_cont_notifica_owneri (șters mai jos) ar lipsi
-- din triggerul R2 → refuzăm în loc să lăsăm un trigger pe employees care cheamă o funcție dispărută.
DO $garda$
BEGIN
  IF to_regprocedure('public.fn_cont_inchide(uuid,text,text,integer)') IS NOT NULL
     OR to_regclass('public.conturi_inchideri_jurnal') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback-ul 20260929c rulează DUPĂ rollback-urile 20260929e și 20260929d (ordinea e → d → c)'
      USING ERRCODE = '55000';
  END IF;
END $garda$;

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
