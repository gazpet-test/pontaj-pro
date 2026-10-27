-- READ ONLY, de executat separat de operatorul autorizat, nu de acest livrabil.
-- Rezultatul se revizuieste; NU se importa automat ca lista alba.
-- Aceeasi forma canonica folosita de preflight si de poarta.
BEGIN READ ONLY;
SET LOCAL search_path = public, pg_temp;
SELECT 'public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')' AS semnatura,
       p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig, p.proacl,
       md5(pg_get_functiondef(p.oid)) AS md5_definitie
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND EXISTS (
  SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
ORDER BY ('public.'||quote_ident(p.proname)||'('||oidvectortypes(p.proargtypes)||')') COLLATE "C";
COMMIT;
