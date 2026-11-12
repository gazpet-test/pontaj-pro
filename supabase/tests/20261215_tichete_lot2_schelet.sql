-- Schelet minim „tip Supabase” pentru proba LOCALĂ (PGlite, în memorie) a migrărilor 20261215a / b / c și a scriptului
-- scripts/tichete_lot2_amprente.sql. NU e migrare și nu se rulează pe nicio bază reală (runner: scripts/pglite/test_tichete_lot2_local.mjs).
-- Reproduce: rolurile (service_role cu BYPASSRLS), privilegiile implicite din public (ALL pentru anon / authenticated / service_role, ca la
-- Supabase), auth.uid() din cele două surse JWT; tabelele atinse de migrări, cu RLS, politici pe funcții de drept (cu un callee tranzitiv
-- pe care pg_depend NU îl vede: fn_lot2_nivel_modul) și câte un trigger; pentru 20261215c: schimbul în forma de după 20261209a — poarta
-- din public EXTRASĂ EXACT din 20261209a (amprenta ei se verifică) și un ÎNLOCUITOR de test pentru original în executie_acces_intern
-- (originalul real e creat direct în BD; runner-ul înlocuiește amprenta reală cu a acestui corp, doar în test) + un trigger POZ KM.
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text, is_owner boolean DEFAULT false);
CREATE TABLE public.user_module_access (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid NOT NULL REFERENCES public.profiles(id),
  module text NOT NULL, access_level text NOT NULL, UNIQUE (profile_id, module));
INSERT INTO public.profiles (id, name, is_owner) VALUES
  ('00000000-0000-4000-8000-000000000001', 'SINTETIC OWNER', true),
  ('00000000-0000-4000-8000-000000000002', 'SINTETIC DOI', false),
  ('00000000-0000-4000-8000-000000000003', 'SINTETIC TREI', false);

-- callee tranzitiv comun (SQL: corpul nu lasă pg_depend), chemat de funcțiile de drept ale politicilor
CREATE FUNCTION public.fn_lot2_nivel_modul(p_modul text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE) THEN 'admin'
              ELSE (SELECT u.access_level FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module = p_modul) END
$f$;
REVOKE ALL ON FUNCTION public.fn_lot2_nivel_modul(text) FROM PUBLIC, anon;

-- 20261215a: comenzile către furnizor
CREATE FUNCTION public.fn_lot2_poate_achizitii() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND public.fn_lot2_nivel_modul('achizitii') IS NOT NULL
$f$;
REVOKE ALL ON FUNCTION public.fn_lot2_poate_achizitii() FROM PUBLIC, anon;
CREATE FUNCTION public.fn_lot2_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN NEW.updated_at := now(); RETURN NEW; END $f$;
CREATE TABLE public.comenzi_furnizor (id bigserial PRIMARY KEY, numar text, observatii text, updated_at timestamptz DEFAULT now());
ALTER TABLE public.comenzi_furnizor ENABLE ROW LEVEL SECURITY;
CREATE POLICY cf_sel ON public.comenzi_furnizor FOR SELECT TO authenticated USING ((SELECT public.fn_lot2_poate_achizitii()));
CREATE POLICY cf_upd ON public.comenzi_furnizor FOR UPDATE TO authenticated USING ((SELECT public.fn_lot2_poate_achizitii()))
  WITH CHECK ((SELECT public.fn_lot2_poate_achizitii()));
CREATE TRIGGER trg_cf_updated BEFORE UPDATE ON public.comenzi_furnizor FOR EACH ROW EXECUTE FUNCTION public.fn_lot2_updated_at();
INSERT INTO public.comenzi_furnizor (numar, observatii) VALUES ('CF-1', 'publica'), ('CF-2', NULL);

-- 20261215b: ofertele de probe (politicile ca în 20261004b, pe funcția de acces la Ofertare)
CREATE FUNCTION public.fn_are_acces_ofertare() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND public.fn_lot2_nivel_modul('ofertare') IS NOT NULL
$f$;
REVOKE ALL ON FUNCTION public.fn_are_acces_ofertare() FROM PUBLIC, anon;
CREATE TABLE public.probe_oferte (id bigserial PRIMARY KEY, client text, valoare numeric);
ALTER TABLE public.probe_oferte ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.probe_oferte FROM anon;
CREATE POLICY probe_oferte_rls_sel ON public.probe_oferte AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY probe_oferte_rls_ins ON public.probe_oferte AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY probe_oferte_rls_upd ON public.probe_oferte AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY probe_oferte_rls_del ON public.probe_oferte AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
INSERT INTO public.probe_oferte (client, valoare) VALUES ('Beneficiar SRL', 100);

-- 20261215c: proiecte, pachete, țevi (RLS pe dreptul de Execuție), POZ KM, funcția de drept, schimbul după 20261209a
CREATE TABLE public.executie_proiecte (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, cod_intern text, nume text NOT NULL);
CREATE TABLE public.executie_pachete_lansare (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  cod_document_full text NOT NULL);
CREATE TABLE public.executie_tevi (id bigserial PRIMARY KEY, pachet_id bigint REFERENCES public.executie_pachete_lansare(id),
  serie_unica text NOT NULL UNIQUE, poz_in_pachet integer, lungime_m numeric, poz_km_m numeric);
CREATE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p_proiect IS NOT NULL
$f$;
CREATE FUNCTION public.fn_executie_nod_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_scriere IS FALSE AND u.access_level = 'viewer'))))
    AND public.fn_executie_proiect_permis(p_proiect, p_scriere)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_proiect_permis(bigint, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_executie_nod_drept(bigint, boolean) FROM PUBLIC, anon;
ALTER TABLE public.executie_pachete_lansare ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executie_tevi ENABLE ROW LEVEL SECURITY;
CREATE POLICY pachete_sel ON public.executie_pachete_lansare FOR SELECT TO authenticated USING (public.fn_executie_nod_drept(proiect_id, false));
CREATE POLICY tevi_sel ON public.executie_tevi FOR SELECT TO authenticated
  USING (public.fn_executie_nod_drept((SELECT k.proiect_id FROM public.executie_pachete_lansare k WHERE k.id = pachet_id), false));
CREATE POLICY tevi_upd ON public.executie_tevi FOR UPDATE TO authenticated
  USING (public.fn_executie_nod_drept((SELECT k.proiect_id FROM public.executie_pachete_lansare k WHERE k.id = pachet_id), true));
-- POZ KM: lungimile cumulate în ordinea pachetului, recalculate după orice schimbare de poziție
CREATE FUNCTION public.fn_lot2_poz_km() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  UPDATE public.executie_tevi t SET poz_km_m = s.km
    FROM (SELECT x.id, sum(coalesce(x.lungime_m, 0)) OVER (ORDER BY x.poz_in_pachet, x.id) AS km FROM public.executie_tevi x WHERE x.pachet_id = NEW.pachet_id) s
   WHERE t.id = s.id AND t.poz_km_m IS DISTINCT FROM s.km;
  RETURN NULL;
END $f$;
CREATE TRIGGER trg_lot2_poz_km AFTER INSERT OR UPDATE OF poz_in_pachet ON public.executie_tevi FOR EACH ROW EXECUTE FUNCTION public.fn_lot2_poz_km();
-- schema internă de după 20261209a: ÎNLOCUITORUL de test al originalului (același contract: schimbă pozițiile a două țevi din același pachet)
CREATE SCHEMA executie_acces_intern;
REVOKE ALL ON SCHEMA executie_acces_intern FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION executie_acces_intern.fn_executie_swap_tevi_pozitie(p_id_a bigint, p_id_b bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE a integer; b integer; pa bigint; pb bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Neautorizat: trebuie autentificare'; END IF;
  SELECT poz_in_pachet, pachet_id INTO a, pa FROM public.executie_tevi WHERE id = p_id_a FOR UPDATE;
  SELECT poz_in_pachet, pachet_id INTO b, pb FROM public.executie_tevi WHERE id = p_id_b FOR UPDATE;
  IF a IS NULL THEN RAISE EXCEPTION 'Teava ID % nu exista', p_id_a; END IF;
  IF b IS NULL THEN RAISE EXCEPTION 'Teava ID % nu exista', p_id_b; END IF;
  IF pa IS DISTINCT FROM pb THEN RAISE EXCEPTION 'Tevile nu sunt in acelasi pachet'; END IF;
  UPDATE public.executie_tevi SET poz_in_pachet = CASE WHEN id = p_id_a THEN b ELSE a END WHERE id IN (p_id_a, p_id_b);
END $f$;
GRANT EXECUTE ON FUNCTION executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint) TO authenticated, service_role;
-- (poarta din public o adaugă runner-ul, EXTRASĂ din 20261209a)
