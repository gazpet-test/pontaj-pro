-- r10: volum ~2x productia, NUMAI pe clusterul efemer al probei de volum (scripts/test_portal_e1.sh, la final).
-- Ruleaza ca bootstrap supabase_admin dupa schelet + fixture 1b. Date sintetice, fara legatura cu productia.
-- Ce conteaza pentru fereastra de lock: randurile citite / scanate sub lock (auth.users, profiles, employees,
-- user_module_access) si catalogul parcurs de poarta (tabele + coloane + functii din public).
SET ROLE postgres;
INSERT INTO public.employees(id,name,active)
SELECT 1000+g,'VOLUM ANGAJAT '||g,true FROM generate_series(1,400) g;
DO $v$
BEGIN
 FOR i IN 1..600 LOOP
  EXECUTE format('CREATE TABLE public.volum_t%s (id integer PRIMARY KEY, %s)', i,
   (SELECT string_agg(format('c%s text', k), ', ') FROM generate_series(1,19) k));
 END LOOP;
 -- Fara EXECUTE pentru PUBLIC: setul PUBLIC aprobat (21) si suprafata rolului teren raman cele ale fixture-ului.
 FOR i IN 1..1500 LOOP
  EXECUTE format('CREATE FUNCTION public.volum_f%s(integer) RETURNS integer LANGUAGE sql IMMUTABLE AS %L', i, 'SELECT $1');
  EXECUTE format('REVOKE ALL ON FUNCTION public.volum_f%s(integer) FROM PUBLIC', i);
 END LOOP;
END $v$;
RESET ROLE;
-- Conturile intra ca la GoTrue (supabase_auth_admin); profilurile le creeaza handle_new_user (fixture = corpul de pe prod).
SET ROLE supabase_auth_admin;
INSERT INTO auth.users(id,email)
SELECT ('40000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'volum.'||g||'@example.invalid' FROM generate_series(1,400) g;
RESET ROLE;
SET ROLE postgres;
UPDATE public.profiles p SET employee_id=1000+substr(p.email,7,strpos(p.email,'@')-7)::integer
 WHERE p.email LIKE 'volum.%@example.invalid';
INSERT INTO public.user_module_access(profile_id,module,access_level)
SELECT p.id,m,'editor' FROM public.profiles p CROSS JOIN unnest(ARRAY['hr','logistica','magazie','executie']) m
 WHERE p.email LIKE 'volum.%@example.invalid';
RESET ROLE;
ANALYZE;
