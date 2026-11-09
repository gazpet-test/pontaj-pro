-- READ ONLY. Inventarul pentru portalul angajatului E1 r3 (migrarile 20261118a + 20261119a), de rulat de operatorul
-- autorizat (chat) pe prod sau pe clona, INAINTE de DRY. Nu scrie nimic (BEGIN READ ONLY ... ROLLBACK).
-- Rezultatul are date personale (emailuri, nume): se salveaza DOAR intern (paw-data), NU in repo / PR / commit.
-- In migrare intra doar: semnaturile + md5-urile (sectiunile 1-2) si hash-urile conturilor ERP aprobate de Razvan (3).
-- Sectiunile 4-6 sunt verificari: orice abatere fata de valoarea asteptata = migrarea trebuie revizuita, nu fortata.
BEGIN READ ONLY;
SET LOCAL search_path = public, pg_temp;

-- 0) Schemele in care PUBLIC are USAGE (poarta asteapta exact information_schema, net, public; pg_catalog exclus).
SELECT '0_scheme_public_usage' AS sectiune, n.nspname AS semnatura
FROM pg_namespace n
WHERE n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('public', n.oid, 'USAGE')
ORDER BY n.nspname COLLATE "C";

-- 1) Functiile din public executabile prin PUBLIC -> fn_portal_public_aprobat() + fn_portal_public_md5().
SELECT '1_public' AS sectiune,
       'public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')' AS semnatura,
       p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig, md5(pg_get_functiondef(p.oid)) AS md5_definitie
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND EXISTS (
  SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
ORDER BY 2 COLLATE "C";

-- 2) Functiile din net executabile prin PUBLIC (le-ar putea apela rolul teren) -> fn_portal_net_md5().
--    Asteptat: niciuna SECURITY DEFINER.
SELECT '2_net' AS sectiune,
       quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')' AS semnatura,
       p.prosecdef, pg_get_userbyid(p.proowner) AS owner, md5(pg_get_functiondef(p.oid)) AS md5_definitie
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='net' AND has_schema_privilege('public', n.oid, 'USAGE')
  AND has_function_privilege('public', p.oid, 'EXECUTE')
ORDER BY 2 COLLATE "C";

-- 3) Conturile (INTERN, cu date personale): Razvan alege care sunt ERP aprobate. Pentru cele alese, in migrare intra
--    DOAR coloana sha256_id. Conturile @teren.gazpet.ro NU intra in lista ERP. Owner-ul TREBUIE sa fie in lista.
SELECT '3_conturi' AS sectiune, encode(sha256(convert_to(u.id::text,'UTF8')),'hex') AS sha256_id,
       u.email, u.created_at::date AS creat, u.last_sign_in_at::date AS ultima_logare,
       (u.banned_until IS NOT NULL AND u.banned_until > now()) AS banat, u.raw_app_meta_data->>'tip_cont' AS tip_cont_meta,
       p.role, p.is_owner, p.employee_id, e.name AS angajat, e.active AS angajat_activ,
       (SELECT string_agg(a.module||':'||coalesce(a.access_level,'?'),', ' ORDER BY a.module)
          FROM public.user_module_access a WHERE a.profile_id=u.id) AS module
FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id LEFT JOIN public.employees e ON e.id=p.employee_id
ORDER BY (lower(split_part(u.email,'@',2))='teren.gazpet.ro'), p.is_owner IS NOT TRUE, u.email;

-- 4) Precondițiile 18a: exact cele 3 conturi @teren cu fisele 55 / 70 / fara fisa (alt numar = migrarea se revizuieste).
SELECT '4_teren' AS sectiune, count(*) AS conturi_teren_domeniu,
       count(*) FILTER (WHERE p.employee_id IS NOT NULL) AS cu_fisa,
       (SELECT count(*) FROM pg_roles WHERE rolname='teren') AS rol_teren_exista,
       to_regclass('public.conturi_tip') IS NOT NULL AS conturi_tip_exista
FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id
WHERE lower(split_part(u.email,'@',2))='teren.gazpet.ro';

-- 5) Precondițiile 19a: handle_new_user neschimbat fata de 27.10 si CHECK-ul de roluri; asteptat:
--    prosrc_sha256 = 6b485d76b92304bcfe6165494addbd7b1389cc6ab9e4913348189368e3bdadf5, acl {postgres=X/postgres},
--    config {search_path=public, pg_temp}, CHECK cu cele 8 roluri, roluri_in_profiles doar din acele 8.
SELECT '5_handle_new_user' AS sectiune, encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS prosrc_sha256,
       encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6b485d76b92304bcfe6165494addbd7b1389cc6ab9e4913348189368e3bdadf5' AS identic_27_10,
       pg_get_userbyid(p.proowner) AS owner, p.proacl::text AS acl, p.proconfig, p.prosecdef,
       (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid='public.profiles'::regclass AND c.conname='profiles_role_chk') AS profiles_role_chk,
       (SELECT string_agg(DISTINCT coalesce(role,'NULL'),', ') FROM public.profiles) AS roluri_in_profiles,
       (SELECT string_agg(t.tgname||':'||t.tgenabled,', ') FROM pg_trigger t WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal) AS triggere_auth_users
FROM pg_proc p WHERE p.oid='public.handle_new_user()'::regprocedure;

-- 6) Starea expunerilor din plan (doar da / nu, fara valori):
SELECT '6_expuneri' AS sectiune,
  has_column_privilege('authenticated','public.employees','cnp','SELECT') AS cnp_citibil_de_orice_cont,
  (SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polrelid='public.magazie_inventar_angajat'::regclass AND polname='mia_select') AS inventar_politica_citire,
  (SELECT count(*) FROM public.hr_concediu_tokens WHERE activ IS TRUE) AS tokenuri_co_active,
  (SELECT count(*) FROM public.hr_concediu_tokens WHERE token IS NOT NULL) AS tokenuri_co_in_clar;

ROLLBACK;
