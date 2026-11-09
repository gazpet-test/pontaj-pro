-- Numai citire. Pentru DRY executat separat de Claude; nu rulat pe BD externa de cdx.
BEGIN READ ONLY;
-- has_* include PUBLIC si membership mostenit, nu doar ACL direct authenticated.
SELECT role_name, has_table_privilege(role_name,'public.hr_personal_extern','INSERT') AS table_insert,
  has_table_privilege(role_name,'public.hr_personal_extern','UPDATE') AS table_update,
  has_any_column_privilege(role_name,'public.hr_personal_extern','INSERT') AS any_column_insert,
  has_any_column_privilege(role_name,'public.hr_personal_extern','UPDATE') AS any_column_update
FROM unnest(ARRAY['authenticated','anon','service_role']) role_name;
WITH RECURSIVE ancestors(id) AS (
  SELECT unnest(ARRAY['authenticated'::regrole::oid,'anon'::regrole::oid,'service_role'::regrole::oid])
  UNION SELECT m.roleid FROM pg_auth_members m JOIN ancestors a ON m.member=a.id
)
SELECT c.relname, coalesce(a.attname,'') AS col, x.*
FROM pg_class c
LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
CROSS JOIN LATERAL aclexplode(a.attacl) x
WHERE c.oid='public.hr_personal_extern'::regclass AND (x.grantee=0 OR x.grantee IN (SELECT id FROM ancestors))
UNION ALL
SELECT c.relname, '' AS col, x.* FROM pg_class c
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
WHERE c.oid='public.hr_personal_extern'::regclass AND (x.grantee=0 OR x.grantee IN (SELECT id FROM ancestors));
SELECT tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid='public.employees'::regclass AND NOT tgisinternal ORDER BY tgname COLLATE "C";
ROLLBACK;
