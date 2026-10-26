-- 20261115a — repararea a două expuneri existente găsite la planul portalului angajat
-- (docs/portal_angajat/PLAN_ETAPA1.md §1; „da” Răzvan 26.10 pentru preview → confirmare → apply).
--
-- (A) magazie_inventar_angajat: azi orice utilizator logat CITEȘTE (USING true) și poate INSERA / MODIFICA / ȘTERGE
--     (auth.uid() IS NOT NULL) inventarul tuturor angajaților. După: citire = owner + modulul magazie / hr;
--     scriere = owner + modulul magazie (editor / admin). Singurul UI care folosește tabela (și view-urile
--     v_magazie_inventar_activ / v_magazie_echipamente / v_eip_stoc, toate security_invoker) e Magazie.jsx,
--     rută deja protejată de modulul magazie. Funcțiile EIP (fn_eip_muta / fn_eip_corectie) sunt DEFINER: neatinse.
-- (B) anon (rolul public, nelogat) are SELECT / INSERT / UPDATE / DELETE / REFERENCES / TRIGGER pe 4 tabele HR /
--     inventar. RLS-ul (politici doar TO authenticated) îl blochează azi; REVOKE = apărare în adâncime.
--     Nicio cale publică nu le folosește cu anon: /co trece prin edge-ul concediu-mobil (service_role).
--
-- Nu șterge date. DROP POLICY + CREATE POLICY în aceeași tranzacție; revenirea recreează exact politicile vechi
-- și granturile vechi (supabase/revenire/20261115a_sec_inventar_hr_anon_ROLLBACK.sql).

DO $pre$
BEGIN
  -- garda runner-ului (scripts/livrare_migrare.sh), ca la celelalte migrări cu livrare controlată
  IF current_user <> 'postgres' OR current_setting('gazpet.livrare_migrare', true)
     IS DISTINCT FROM '20261115a_sec_inventar_hr_anon:' || txid_current() THEN
    RAISE EXCEPTION '20261115a: numai prin runner, ca postgres';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION '20261115a: READ COMMITTED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'));
  -- amprenta EXACTĂ a celor 4 politici văzute în preview (26.10): nume, comandă, permisivă, roluri, USING, WITH CHECK
  IF (SELECT md5(string_agg(polname::text || '|' || polcmd::text || '|' || polpermissive::text || '|'
          || polroles::regrole[]::text || '|' || coalesce(pg_get_expr(polqual, polrelid), '') || '|'
          || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ';' ORDER BY polname))
      FROM pg_policy WHERE polrelid = 'public.magazie_inventar_angajat'::regclass)
     IS DISTINCT FROM '668a7e226edbe58202b35858ef0f2b96' THEN
    RAISE EXCEPTION '20261115a: politicile magazie_inventar_angajat nu mai sunt cele din preview (26.10)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.magazie_inventar_angajat'::regclass) THEN
    RAISE EXCEPTION '20261115a: RLS dezactivat pe magazie_inventar_angajat';
  END IF;
END
$pre$;

-- (A) inventarul pe angajat
DROP POLICY mia_select ON public.magazie_inventar_angajat;
DROP POLICY mia_insert ON public.magazie_inventar_angajat;
DROP POLICY mia_update ON public.magazie_inventar_angajat;
DROP POLICY mia_delete ON public.magazie_inventar_angajat;

CREATE POLICY mia_select ON public.magazie_inventar_angajat FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_owner = true)
    OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = (SELECT auth.uid())
               AND (u.module IN ('magazie', 'hr') OR left(u.module, 8) = 'magazie.' OR left(u.module, 3) = 'hr.'))
  );

CREATE POLICY mia_insert ON public.magazie_inventar_angajat FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_owner = true)
    OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = (SELECT auth.uid())
               AND (u.module = 'magazie' OR left(u.module, 8) = 'magazie.') AND u.access_level IN ('editor', 'admin'))
  );

CREATE POLICY mia_update ON public.magazie_inventar_angajat FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_owner = true)
    OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = (SELECT auth.uid())
               AND (u.module = 'magazie' OR left(u.module, 8) = 'magazie.') AND u.access_level IN ('editor', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_owner = true)
    OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = (SELECT auth.uid())
               AND (u.module = 'magazie' OR left(u.module, 8) = 'magazie.') AND u.access_level IN ('editor', 'admin'))
  );

CREATE POLICY mia_delete ON public.magazie_inventar_angajat FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_owner = true)
    OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = (SELECT auth.uid())
               AND (u.module = 'magazie' OR left(u.module, 8) = 'magazie.') AND u.access_level IN ('editor', 'admin'))
  );

-- (B) granturile anon pe tabelele HR / inventar
REVOKE ALL ON public.hr_aprobatori, public.hr_cereri_concediu, public.hr_concediu_rute, public.magazie_inventar_angajat
  FROM anon;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'anon'
             AND table_name IN ('hr_aprobatori', 'hr_cereri_concediu', 'hr_concediu_rute', 'magazie_inventar_angajat')) THEN
    RAISE EXCEPTION '20261115a: anon are încă granturi';
  END IF;
  -- exact cele 4 politici noi, toate permisive, doar TO authenticated, fiecare cu verificarea owner + user_module_access
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.magazie_inventar_angajat'::regclass) <> 4
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.magazie_inventar_angajat'::regclass
                AND (polname NOT IN ('mia_select', 'mia_insert', 'mia_update', 'mia_delete')
                     OR NOT polpermissive
                     OR polroles <> ARRAY['authenticated'::regrole]::oid[]
                     OR coalesce(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) !~ 'is_owner'
                     OR coalesce(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) !~ 'user_module_access'
                     OR (polname <> 'mia_select' AND coalesce(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) !~ 'editor')
                     OR (polcmd = 'w' AND pg_get_expr(polwithcheck, polrelid) IS NULL))) THEN
    RAISE EXCEPTION '20261115a: politicile finale nu sunt cele așteptate';
  END IF;
END
$post$;
