-- ROLLBACK pentru 20260929c_conturi_legare_automata.sql (rulat DUPĂ rollback-urile e și d).
-- Idempotent. Legăturile profiles.employee_id deja făcute RĂMÂN (sunt date corecte).
-- ⚠️ Se pierde profiles.tip_cont (marcajele extern/test/sistem): exportă-le înainte în claude_context.
-- NU atinge triggerul S-A (trg_profiles_campuri_owner_only, 20260929g): e precondiție live, nu parte din pachet.

-- Gardă de ordine: d și e folosesc funcțiile din c (fn_cont_notifica_owneri, fn_identitate_*) → dacă obiectele lor
-- mai există, refuzăm în loc să lăsăm triggere pe employees / hr_personal_extern care cheamă funcții dispărute.
DO $garda$
BEGIN
  IF to_regprocedure('public.fn_cont_inchide(uuid,text,text,integer)') IS NOT NULL
     OR to_regclass('public.conturi_inchideri_jurnal') IS NOT NULL
     OR to_regprocedure('public.fn_employees_colab_ext_protectie()') IS NOT NULL
     OR to_regprocedure('public.fn_colaborare_externa_seteaza(integer,text,text,text)') IS NOT NULL THEN
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
-- ACL-ul de producție al funcției de trigger: EXECUTE doar postgres + service_role (migrarea c îl scosese și pe service_role).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

DROP TRIGGER IF EXISTS trg_profiles_protectie_legatura ON public.profiles;
DROP FUNCTION IF EXISTS public.fn_profiles_protectie_legatura();
DROP VIEW IF EXISTS public.v_admin_conturi_alerte;
DROP FUNCTION IF EXISTS public.fn_admin_conturi_alerte();
DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean);
DROP FUNCTION IF EXISTS public.fn_cont_leaga_automat(boolean, jsonb);
DROP FUNCTION IF EXISTS public.fn_cont_leaga_la_creare(uuid);
DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(uuid, integer, boolean);   -- r8 (semnătura cu p_cere_marcaj)
DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(uuid, integer);   -- r7 (dacă ar fi rămas)
DROP FUNCTION IF EXISTS public.fn_cont_revalideaza_candidat(text, integer);   -- r6 (dacă ar fi rămas)
DROP FUNCTION IF EXISTS public.fn_cont_candidati_angajat(text);
DROP FUNCTION IF EXISTS public.fn_cont_notifica_owneri(text, text, text, text);
DROP FUNCTION IF EXISTS public.fn_nume_familie(text);
DROP FUNCTION IF EXISTS public.fn_nume_cuvinte(text);          -- runda 3: mutată din e în c (o folosesc d și e)
DROP FUNCTION IF EXISTS public.fn_identitate_eticheta();
DROP FUNCTION IF EXISTS public.fn_identitate_om();
DROP FUNCTION IF EXISTS public.fn_identitate_revocata(uuid);
DROP FUNCTION IF EXISTS public.fn_identitate_uid();
DROP FUNCTION IF EXISTS public.fn_identitate_privilegiata();
DROP FUNCTION IF EXISTS public.fn_identitate_claims();
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_tip_cont_chk;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS tip_cont;
