-- REVENIRE 20261126a_redari_teren (armată; doar la cererea lui Răzvan, după decizie + review). NU e migrare — niciun runner nu parcurge directorul.
-- Scoate TOT ce a creat migrarea: politicile storage red_storage_*, bucket-ul `redari` (doar gol — DELETE pe storage.* cere
-- storage.allow_delete_query), cele 4 vederi, cele 13 tabele red_*, cele 19 funcții fn_red_*, cheia de modul `redari` din app_modules
-- și rândul din supabase_migrations.schema_migrations (dacă tabelul există).
-- Refuză: nearmată; armare persistentă (ALTER DATABASE/ROLE … SET); migrarea neaplicată; obiecte în bucket (se golesc prin API întâi);
-- DATE în red_parcele (rânduri) fără al doilea GUC gazpet.revenire_20261126a_forta = 'DA'; drepturi acordate pe `redari` în
-- user_module_access fără același GUC (ștergerea cheii le șterge în cascadă — sunt listate în NOTICE); dependenți străini pe vederi.
-- Procedura (un singur string, gestionarul tranzacției e operatorul):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261126a', 'REDARI_TEREN_SCOASA:' || txid_current(), true);
--   -- opțional, DOAR cu decizia explicită a lui Răzvan: SELECT set_config('gazpet.revenire_20261126a_forta', 'DA', true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.revenire_20261126a REDARI_TEREN_SCOASA
DO $pre$
DECLARE v_parcele bigint; v_drepturi text;
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
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'redari') THEN
    RAISE EXCEPTION '20261126a revenire: bucket-ul redari nu e gol (% obiecte) — se goleste prin API, cu decizia lui Razvan, inainte',
      (SELECT count(*) FROM storage.objects WHERE bucket_id = 'redari');
  END IF;
  SELECT count(*) INTO v_parcele FROM public.red_parcele;
  IF v_parcele > 0 AND current_setting('gazpet.revenire_20261126a_forta', true) IS DISTINCT FROM 'DA' THEN
    RAISE EXCEPTION '20261126a revenire: red_parcele are % randuri (date reale) — revenirea le-ar pierde; refuz fara gazpet.revenire_20261126a_forta = DA', v_parcele;
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
DROP TABLE public.red_rate_limit, public.red_import_loturi, public.red_procese_verbale, public.red_raspunsuri, public.red_convocari,
  public.red_detinatori_contact, public.red_detinatori_token, public.red_detinatori, public.red_parcele, public.red_uat, public.red_proiecte, public.red_numere, public.red_jurnal;

-- funcțiile (cele 19 ale migrării, pe semnătură exactă)
DROP FUNCTION public.fn_red_formular_public(text);
DROP FUNCTION public.fn_red_raspuns_public(text, text, date, text, boolean, text);
DROP FUNCTION public.fn_red_rate_limit_atinge(text, integer);
DROP FUNCTION public.fn_red_ip_client();
DROP FUNCTION public.fn_red_valoare_parcela_seteaza(uuid, numeric);
DROP FUNCTION public.fn_red_valoare_parcela(uuid);
DROP FUNCTION public.fn_red_numar_document(text, text, integer);
DROP FUNCTION public.fn_red_rezerva_numere_parcele(text, integer, integer);
DROP FUNCTION public.fn_red_adresa_cunoscuta(uuid);
DROP FUNCTION public.fn_red_jurnal_imuabil();
DROP FUNCTION public.fn_red_jurnal();
DROP FUNCTION public.fn_red_updated_at();
DROP FUNCTION public.fn_red_parcela_uat_dupa();
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
