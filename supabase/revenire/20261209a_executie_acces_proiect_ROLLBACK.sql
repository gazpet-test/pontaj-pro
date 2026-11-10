-- Revenire 20261209a_executie_acces_proiect. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a lui Răzvan (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelul executie_acces_proiect, cele 11 funcții (lista exactă), politicile RESTRICTIVE executie_acces_*
-- și trigger-ele trg_executie_acces_garda de pe cele 22 de tabele, și redă EXACT corpurile vechi ale celor 4 funcții de drept
-- (fn_executie_nod_drept / contract / grafic / tinte), cu amprenta verificată după.
-- REFUZĂ dacă vreun cont e restrâns (are rânduri): după revenire acel cont ar vedea DIN NOU toate proiectele, pe tăcute. Scoaterea
-- restricțiilor e o decizie separată (din ecranul owner-ului, „scoate restricția”, sau preview -> „da” Răzvan -> apply).
-- Gestionarul tranzacției e operatorul (fișierul nu are BEGIN / COMMIT). Un singur string:
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261209a', 'SCOATE_ACCES_PROIECT:' || txid_current(), true);
--   <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261209a SCOATE_ACCES_PROIECT
-- Ordinea lock-urilor: executie_acces_proiect ACCESS EXCLUSIVE NOWAIT ÎNAINTEA verificării „fără rânduri” (o setare concurentă nu poate fi
-- numărată 0 și apoi pierdută la DROP), apoi tabelele acoperite, în ordinea listei, ACCESS EXCLUSIVE NOWAIT. Ocupat = 55P03, nimic scris.
-- Trebuie rulată ÎNAINTEA revenirii oricăreia dintre 20261201a / 20261203a / 20261204a / 20261208a (acelea verifică amprenta veche).
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează (nimic nu rulează după el), iar harness-ul îi verifică mesajul.
DO $revenire$
DECLARE r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.revenire_20261209a', true) IS DISTINCT FROM 'SCOATE_ACCES_PROIECT:' || txid_current() THEN
    RAISE EXCEPTION '20261209a revenire: garda invalida (armare lipsa sau din alta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261209a=%') THEN
    RAISE EXCEPTION '20261209a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261209a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- starea exactă a migrării: tabelul, cele 11 funcții, corpurile noi ale funcțiilor de drept
  IF to_regclass('public.executie_acces_proiect') IS NULL
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY['fn_executie_acces_e_owner', 'fn_executie_acces_nerestrans', 'fn_executie_acces_lista',
            'fn_executie_proiect_permis', 'fn_executie_acces_sl_permis', 'fn_executie_acces_bon_permis', 'fn_executie_acces_canon',
            'fn_executie_acces_proiect_seteaza', 'fn_executie_acces_proiect_prov', 'fn_executie_acces_garda', 'fn_executie_acces_garda_copil']::name[])) <> 11
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')) <> 11
     OR EXISTS (SELECT 1 FROM (VALUES
               ('public.fn_executie_nod_drept(bigint, boolean)', '1f0faa030d0459412aafb6e1a024beff'),
               ('public.fn_executie_contract_drept(bigint, boolean)', 'f3c3dc6add32d563682494e804864e99'),
               ('public.fn_executie_grafic_drept(bigint)', '5df5d4ecce38a81472fc4f17cf410b97'),
               ('public.fn_executie_tinte_drept(bigint, text)', '9bc9c10212d8f0a7ca5ad94e0220c7c2')) a(semnatura, amprenta)
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta) THEN
    RAISE EXCEPTION '20261209a revenire: starea nu e cea din 20261209a';
  END IF;
  -- lock ÎNAINTE de numărare
  LOCK TABLE public.executie_acces_proiect IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION '20261209a revenire: exista conturi restranse pe proiect (ar vedea din nou toate proiectele); scoate intai restrictiile';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte'), ('executie_tronsoane'), ('executie_documente_contract'), ('executie_acte_aditionale'), ('executie_ordine_sistare'),
      ('executie_ordine_detectate'), ('executie_completari_propuse'), ('executie_faze_determinante'), ('executie_probe_presiune'),
      ('executie_situatii_plata'), ('executie_bonuri_consum'), ('executie_alocari_personal'), ('executie_ture'), ('executie_tura_subcontractori'),
      ('executie_tura_activitati'), ('executie_tura_naveta'), ('proiect_unitati'), ('proiect_activitati'), ('proiect_articole'),
      ('executie_situatii_plata_linii'), ('executie_sl_ajustari'), ('executie_bonuri_consum_linii')) t(tabel)
  LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE NOWAIT', r.tabel);
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tabel AND policyname LIKE 'executie\_acces\_%') <> 4
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || r.tabel) AND tgname = 'trg_executie_acces_garda') THEN
      RAISE EXCEPTION '20261209a revenire: politicile / trigger-ul lipsesc pe %', r.tabel;
    END IF;
    EXECUTE format('DROP TRIGGER trg_executie_acces_garda ON public.%I', r.tabel);
    EXECUTE format('DROP POLICY executie_acces_citire ON public.%I', r.tabel);
    EXECUTE format('DROP POLICY executie_acces_adauga ON public.%I', r.tabel);
    EXECUTE format('DROP POLICY executie_acces_modifica ON public.%I', r.tabel);
    EXECUTE format('DROP POLICY executie_acces_sterge ON public.%I', r.tabel);
  END LOOP;

  -- corpurile vechi, EXACT ca în 20261201a / 20261203a / 20261204a / 20261208a (CREATE OR REPLACE păstrează owner / ACL)
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_executie_nod_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_scriere IS FALSE AND u.access_level = 'viewer'))))
$f$$sql$;
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_executie_contract_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level = 'admin' OR (p_scriere IS FALSE AND u.access_level IN ('viewer', 'editor')))))
$f$$sql$;
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_executie_grafic_drept(p_proiect bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin')))
$f$$sql$;
  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_executie_tinte_drept(p_proiect bigint, p_nivel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_nivel IN ('citire', 'configurare')
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_nivel = 'citire' AND u.access_level = 'viewer')))
         OR (p_nivel = 'citire' AND EXISTS (
               SELECT 1 FROM public.profile_sites ps JOIN public.sites s ON s.id = ps.site_id
                WHERE ps.profile_id = auth.uid() AND s.proiect_id = p_proiect
                  AND (ps.valid_until IS NULL OR ps.valid_until >= (now() AT TIME ZONE 'Europe/Bucharest')::date))))
$f$$sql$;

  DROP FUNCTION public.fn_executie_acces_proiect_seteaza(uuid, boolean, jsonb, jsonb);
  DROP FUNCTION public.fn_executie_acces_canon(jsonb);
  DROP FUNCTION public.fn_executie_acces_garda();
  DROP FUNCTION public.fn_executie_acces_garda_copil();
  DROP FUNCTION public.fn_executie_acces_sl_permis(bigint, boolean);
  DROP FUNCTION public.fn_executie_acces_bon_permis(bigint, boolean);
  DROP FUNCTION public.fn_executie_proiect_permis(bigint, boolean);
  DROP TABLE public.executie_acces_proiect;   -- ia cu el politica și trigger-ul de proveniență
  DROP FUNCTION public.fn_executie_acces_proiect_prov();
  DROP FUNCTION public.fn_executie_acces_lista(boolean);
  DROP FUNCTION public.fn_executie_acces_nerestrans();
  DROP FUNCTION public.fn_executie_acces_e_owner();

  -- postcondiții: amprentele vechi la loc, nimic rămas
  IF EXISTS (SELECT 1 FROM (VALUES
               ('public.fn_executie_nod_drept(bigint, boolean)', '144649bae9a218b41b7e6df90cba5d9e', true),
               ('public.fn_executie_contract_drept(bigint, boolean)', '85a131c3aa59813b1a8cb8535c53e703', true),
               ('public.fn_executie_grafic_drept(bigint)', '1dbaedfd117f7234a6e30fdaf856ac7b', true),
               ('public.fn_executie_tinte_drept(bigint, text)', 'bda0b6c3e01a5a039732b2713df8ebab', false)) a(semnatura, amprenta, cu_service)
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
                 OR p.prosecdef IS NOT TRUE OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                 OR has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_service) THEN
    RAISE EXCEPTION '20261209a revenire post: functiile de drept nu au revenit la amprenta veche';
  END IF;
  IF to_regclass('public.executie_acces_proiect') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis'))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'executie\_acces\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda') THEN
    RAISE EXCEPTION '20261209a revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.revenire_20261209a', true) IS DISTINCT FROM 'SCOATE_ACCES_PROIECT:' || txid_current() THEN
    RAISE EXCEPTION '20261209a revenire: garda final invalida';
  END IF;
END $revenire$;
