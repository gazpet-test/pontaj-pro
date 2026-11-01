-- REVENIRE 20261126a_redari_teren (armată; doar la cererea lui Răzvan, după decizie + review). NU e migrare — niciun runner nu parcurge directorul.
-- Scoate TOT ce a creat migrarea: politicile storage red_storage_*, bucket-ul `redari` (doar gol — DELETE pe storage.* cere
-- storage.allow_delete_query), cele 4 vederi, cele 14 tabele red_*, cele 21 de funcții fn_red_*, cheia de modul `redari` din app_modules
-- și rândul din supabase_migrations.schema_migrations (dacă tabelul există).
-- Refuză: nearmată; armare persistentă (ALTER DATABASE/ROLE … SET); migrarea neaplicată; obiecte în bucket (se golesc prin API întâi);
-- DATE în ORICARE din red_proiecte / uat / parcele / detinatori / convocari / raspunsuri / procese_verbale / import_loturi / numere / jurnal
-- fără al doilea GUC gazpet.revenire_20261126a_forta = 'DA' (Jakarinos r1 P2-7); drepturi acordate pe `redari` în user_module_access fără
-- același GUC (ștergerea cheii le șterge în cascadă — sunt listate în NOTICE); dependenți străini pe vederi.
-- Procedura (un singur string, gestionarul tranzacției e operatorul):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261126a', 'REDARI_TEREN_SCOASA:' || txid_current(), true);
--   -- opțional, DOAR cu decizia explicită a lui Răzvan: SELECT set_config('gazpet.revenire_20261126a_forta', 'DA', true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- FEREASTRĂ DE MENTENANȚĂ (Jakarinos r2 P1-01): ÎNAINTE de orice verificare de date / drepturi se iau LOCK TABLE … ACCESS EXCLUSIVE pe toate
-- tabelele red_* și SHARE ROW EXCLUSIVE pe public.user_module_access (blochează INSERT/UPDATE/DELETE pe drepturi, dar lasă citirile —
-- fn_red_nivel / meniul aplicației citesc uma la fiecare cerere, ACCESS EXCLUSIVE ar îngheța tot ERP-ul); lock-urile se țin până la COMMIT,
-- deci garda e atomică: nimeni nu poate strecura date sau drepturi între verificare și DROP. lock_timeout 5 s: dacă cineva ține tabelele,
-- revenirea pică fără să facă nimic — se reia în fereastră.
-- harness-armare: gazpet.revenire_20261126a REDARI_TEREN_SCOASA
DO $pre$
DECLARE v_parcele bigint; v_date text; v_drepturi text;
BEGIN
  IF current_setting('gazpet.revenire_20261126a', true) IS DISTINCT FROM 'REDARI_TEREN_SCOASA:' || txid_current() THEN
    RAISE EXCEPTION '20261126a revenire: neinarmata';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261126a revenire: necesita postgres'; END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.revenire_20261126a%') THEN
    RAISE EXCEPTION '20261126a revenire: armare persistenta (pg_db_role_setting) — refuz';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_parcele') IS NULL OR to_regclass('public.red_jurnal') IS NULL THEN
    RAISE EXCEPTION '20261126a revenire: migrarea nu e aplicata (red_parcele / red_jurnal lipsesc)';
  END IF;
  -- garda atomica (P1-01): lock-urile INAINTEA oricarei verificari, tinute pana la COMMIT
  LOCK TABLE public.red_proiecte, public.red_uat, public.red_parcele, public.red_detinatori, public.red_detinatori_contact, public.red_detinatori_token,
             public.red_convocari, public.red_raspunsuri, public.red_raspunsuri_meta, public.red_procese_verbale, public.red_jurnal, public.red_numere,
             public.red_import_loturi, public.red_rate_limit IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.user_module_access IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'redari') THEN
    RAISE EXCEPTION '20261126a revenire: bucket-ul redari nu e gol (% obiecte) — se goleste prin API, cu decizia lui Razvan, inainte',
      (SELECT count(*) FROM storage.objects WHERE bucket_id = 'redari');
  END IF;
  SELECT count(*) INTO v_parcele FROM public.red_parcele;
  SELECT string_agg(t.nume || '=' || t.n, ', ') INTO v_date FROM (
    SELECT 'red_proiecte' AS nume, count(*) AS n FROM public.red_proiecte UNION ALL SELECT 'red_uat', count(*) FROM public.red_uat
    UNION ALL SELECT 'red_parcele', count(*) FROM public.red_parcele UNION ALL SELECT 'red_detinatori', count(*) FROM public.red_detinatori
    UNION ALL SELECT 'red_convocari', count(*) FROM public.red_convocari UNION ALL SELECT 'red_raspunsuri', count(*) FROM public.red_raspunsuri
    UNION ALL SELECT 'red_procese_verbale', count(*) FROM public.red_procese_verbale UNION ALL SELECT 'red_import_loturi', count(*) FROM public.red_import_loturi
    UNION ALL SELECT 'red_numere', count(*) FROM public.red_numere UNION ALL SELECT 'red_jurnal', count(*) FROM public.red_jurnal) t WHERE t.n > 0;
  IF v_date IS NOT NULL AND current_setting('gazpet.revenire_20261126a_forta', true) IS DISTINCT FROM 'DA' THEN
    RAISE EXCEPTION '20261126a revenire: exista date reale (%) — revenirea le-ar pierde; refuz fara gazpet.revenire_20261126a_forta = DA', v_date;
  END IF;
  SELECT string_agg(profile_id::text || ':' || access_level, ', ' ORDER BY profile_id) INTO v_drepturi FROM public.user_module_access WHERE module = 'redari';
  IF v_drepturi IS NOT NULL AND current_setting('gazpet.revenire_20261126a_forta', true) IS DISTINCT FROM 'DA' THEN
    RAISE EXCEPTION '20261126a revenire: exista drepturi pe modulul redari (%) — stergerea cheii le-ar scoate in cascada; refuz fara forta', v_drepturi;
  END IF;
  -- vederile nu au dependenți în afara familiei red_v_*
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class c ON c.oid = r.ev_class
              WHERE d.refobjid IN ('public.red_v_stare_parcela'::regclass, 'public.red_v_parcele'::regclass, 'public.red_v_centralizator_uat'::regclass, 'public.red_v_tronson'::regclass)
                AND c.relname NOT LIKE 'red\_v\_%') THEN
    RAISE EXCEPTION '20261126a revenire: vederile red_v_* au dependenti straini';
  END IF;
  RAISE NOTICE '20261126a revenire: parcele=%, jurnal=%, drepturi=%', v_parcele, (SELECT count(*) FROM public.red_jurnal), coalesce(v_drepturi, '-');
END $pre$;

-- storage: politicile, apoi bucket-ul (gol — verificat mai sus; FK-ul storage.objects → buckets oprește oricum un DELETE pe un bucket cu obiecte)
DROP POLICY IF EXISTS red_storage_sel ON storage.objects;
DROP POLICY IF EXISTS red_storage_ins ON storage.objects;
DROP POLICY IF EXISTS red_storage_upd ON storage.objects;
SELECT set_config('storage.allow_delete_query', 'true', true);
DELETE FROM storage.buckets WHERE id = 'redari';

-- vederi (cele dependente întâi), apoi tabelele (toate într-o comandă — FK-urile dintre ele nu cer CASCADE)
DROP VIEW public.red_v_centralizator_uat;
DROP VIEW public.red_v_tronson;
DROP VIEW public.red_v_stare_parcela;
DROP VIEW public.red_v_parcele;
DROP TABLE public.red_rate_limit, public.red_import_loturi, public.red_procese_verbale, public.red_raspunsuri_meta, public.red_raspunsuri, public.red_convocari,
  public.red_detinatori_contact, public.red_detinatori_token, public.red_detinatori, public.red_parcele, public.red_uat, public.red_proiecte, public.red_numere, public.red_jurnal;

-- funcțiile (cele 19 ale migrării, pe semnătură exactă)
DROP FUNCTION public.fn_red_formular_public(text);
DROP FUNCTION public.fn_red_raspuns_public(text, text, date, text, boolean, text);
DROP FUNCTION public.fn_red_rate_limit_atinge(text, integer);
DROP FUNCTION public.fn_red_rate_limit_curata(boolean);
DROP FUNCTION public.fn_red_raspunsuri_valideaza();
DROP FUNCTION public.fn_red_ip_client();
DROP FUNCTION public.fn_red_valoare_parcela_seteaza(uuid, numeric);
DROP FUNCTION public.fn_red_valoare_parcela(uuid);
DROP FUNCTION public.fn_red_numar_document(text, text, integer);
DROP FUNCTION public.fn_red_rezerva_numere_parcele(text, integer, integer);
DROP FUNCTION public.fn_red_adresa_cunoscuta(uuid);
DROP FUNCTION public.fn_red_jurnal_imuabil();
DROP FUNCTION public.fn_red_jurnal();
DROP FUNCTION public.fn_red_updated_at();
DROP FUNCTION public.fn_red_legaturi();
DROP FUNCTION public.fn_red_uat_sesiuni_dupa();
DROP FUNCTION public.fn_red_detinatori_before();
DROP FUNCTION public.fn_red_detinatori_token_dupa();
DROP FUNCTION public.fn_red_token_imutabil();
DROP FUNCTION public.fn_red_token_expira_calc(uuid);
DROP FUNCTION public.fn_red_nivel();

-- cheia de modul (cu forta: drepturile pe redari pleacă în cascadă — listate în NOTICE-ul de mai sus)
DELETE FROM public.app_modules WHERE key = 'redari';

-- istoricul livrării, doar dacă tabelul există (pe un PG local de test poate lipsi)
DO $mig$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE name = '20261126a_redari_teren';
  END IF;
END $mig$;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname LIKE 'red\_%')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_%')
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'redari')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'red\_storage\_%')
     OR EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'redari') THEN
    RAISE EXCEPTION '20261126a revenire: au ramas obiecte red_*';
  END IF;
  PERFORM set_config('gazpet.revenire_20261126a', '', true);
  PERFORM set_config('gazpet.revenire_20261126a_forta', '', true);
END $post$;
