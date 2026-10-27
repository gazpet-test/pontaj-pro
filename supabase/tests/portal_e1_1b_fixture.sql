-- Exclusiv harness efemer, executat de bootstrap supabase_admin inaintea baseline-ului.
SET ROLE postgres;
ALTER TABLE public.profiles ADD COLUMN is_owner boolean NOT NULL DEFAULT false;
UPDATE public.profiles SET is_owner=true WHERE id='00000000-0000-0000-0000-000000000001';
ALTER TABLE public.profiles RENAME CONSTRAINT profiles_role_check TO profiles_role_chk;
CREATE FUNCTION public.fn_cont_candidati_angajat(text)
RETURNS TABLE(employee_id integer,employee_name text,metoda text,profil_legat uuid)
LANGUAGE sql SET search_path TO 'public','pg_temp' AS $$
 SELECT NULL::integer,NULL::text,NULL::text,NULL::uuid WHERE false;
$$;
CREATE FUNCTION public.fn_cont_notifica_owneri(text,text,text,text) RETURNS void
LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$ BEGIN NULL; END $$;
REVOKE ALL ON FUNCTION public.fn_cont_candidati_angajat(text),public.fn_cont_notifica_owneri(text,text,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n         integer := 0;
  v_emp       integer;
  v_nume      text;
  v_metoda    text;
  v_ocupat    boolean := false;
  v_incredere boolean := false;
  v_are_fisa  boolean := false;
  v_eroare    text;
  v_motiv     text;
BEGIN
  -- Inserăm doar dacă nu există deja (idempotent) — neschimbat
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    INITCAP(REPLACE(REPLACE(SPLIT_PART(NEW.email, '@', 1), '.', ' '), '_', ' ')),
    'manager_santier'
  )
  ON CONFLICT (id) DO NOTHING;

  -- R1 sub-bloc 1: DOAR potrivirea (fără nicio scriere în profiles). Nicio eroare de aici nu blochează crearea contului.
  BEGIN
    v_incredere := COALESCE(NEW.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true';
    SELECT count(*), min(c.employee_id), min(c.employee_name), min(c.metoda),
           COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
      INTO v_n, v_emp, v_nume, v_metoda, v_ocupat
      FROM public.fn_cont_candidati_angajat(NEW.email) c;       -- emailul de LOGARE (GoTrue)
    SELECT p.employee_id IS NOT NULL INTO v_are_fisa FROM public.profiles p WHERE p.id = NEW.id;
    v_are_fisa := COALESCE(v_are_fisa, false);
  EXCEPTION WHEN OTHERS THEN
    v_eroare := SQLERRM;
    RAISE WARNING 'handle_new_user R1 (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  -- R1 sub-bloc 2: notificarea owner-ilor (separat; best-effort)
  BEGIN
    IF v_eroare IS NULL AND v_n = 1 AND NOT v_ocupat AND NOT v_are_fisa THEN
      IF NOT v_incredere THEN
        -- orice domeniu: potrivirea pe email poate fi și pe adresa personală trecută pe fișă
        PERFORM public.fn_cont_notifica_owneri('cont_legare_propusa', '🔗 Cont nou: confirmă legarea de fișă',
          format('Cont nou %s → propunere: %s (#%s, prin %s). Dacă tu ai creat contul, confirmă din Admin → Manageri → „Leagă automat”. Dacă nu-l recunoști, NU-l lega și închide-l.',
                 NEW.email, v_nume, v_emp, v_metoda),
          '/admin?tab=managers&cont=' || NEW.id::text);
      END IF;
      -- calea de încredere: legarea și anunțul le face fn_cont_leaga_la_creare (cont-nou); dacă RPC-ul nu vine,
      -- contul apare în alerta fara_angajat cu candidatul unic.
    ELSIF v_eroare IS NOT NULL OR v_incredere
          OR lower(split_part(btrim(COALESCE(NEW.email, '')), '@', 2)) = 'gazpet.ro' THEN
      v_motiv := CASE
        WHEN v_eroare IS NOT NULL THEN 'eroare la potrivire: ' || v_eroare
        WHEN v_n = 0 THEN '0 candidați'
        WHEN v_n > 1 THEN v_n || ' candidați'
        WHEN v_ocupat THEN 'candidatul unic are deja cont'
        ELSE 'legătură existentă păstrată' END;
      PERFORM public.fn_cont_notifica_owneri('cont_nelegat', '⚠️ Cont nou nelegat de fișa de angajat',
        format('Cont nou %s nelegat: %s', NEW.email, v_motiv),
        '/admin?tab=managers&cont=' || NEW.id::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user R1 notificare (%): % [%]', NEW.email, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated,service_role;
RESET ROLE;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- GoTrue executa INSERT ca supabase_auth_admin, nu ca proprietarul functiei.
