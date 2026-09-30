-- ============================================================================
-- 20261003e_sec_trezorerie.sql — SEC trezorerie: citire/scriere pe trezorerie_conturi +
-- trezorerie_extras_linii doar pentru actorii din matricea țintă (NEAPLICAT, DOAR LOCAL).
--
-- Gaura (structurală, NU abuz demonstrat): politicile trez_conturi_rw / trez_linii_rw sunt
-- FOR ALL TO authenticated USING/WITH CHECK (auth.uid() IS NOT NULL) → orice cont logat
-- citește, modifică și șterge conturile de trezorerie (IBAN) și soldurile din extrase.
--
-- Matricea țintă scrisă aici = VARIANTA A (recomandată, de aprobat de Răzvan):
--   citire  = owner SAU profiles.can_access_financiar   → public.fn_trezorerie_poate_citi()
--   scriere = owner SAU profiles.can_access_financiar   → public.fn_trezorerie_poate_scrie()
-- Cele două drepturi sunt decizii SEPARATE, în helperi separați: scrierea NU se deduce din
-- citire. Schimbarea variantei = corpul unui singur helper (+ amprentele lui de mai jos).
-- Invariant tehnic: scriere ⊆ citire (UPDATE/DELETE cu WHERE/RETURNING cer și SELECT).
--
-- Tot aici: anon și PUBLIC pierd orice privilegiu pe tabele/secvențe; authenticated păstrează
-- doar SELECT/INSERT/UPDATE/DELETE (fără TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) și USAGE/SELECT
-- pe secvențe. service_role (BYPASSRLS, edge) și postgres (owner) rămân neschimbate.
--
-- Tranzacția (runda 4, traseul comun cu #538): UN SINGUR gestionar = runnerul de livrare (scripts/livrare_migrare.sh, refăcut în runda 5 după NO-GO Copilot r4; neportat aici)
--   (psql --single-transaction: marcaj de livrare + ACEST fișier + INSERT în supabase_migrations.schema_migrations).
--   Fișierul NU conține BEGIN/COMMIT; garda de livrare (start + final, legată de txid) refuză rularea fără runner
--   (psql -f simplu, psql -c, apply_migration / execute_sql). Postcondiția rulează înaintea gărzii de final.
-- Precondiții fail-closed și NULL-safe (runda 2): starea COMPLETĂ (politici + ACL complet pe tabele/secvențe/helperi
--   + privilegii efective + legătura secvență↔id + proprietăți) trebuie să fie una din 3 stări cunoscute: live de azi,
--   patch exact (reaplicare fără efect net) sau starea lăsată de revenirea tehnică. Orice altă stare — inclusiv patch
--   cu DELETE retras ulterior — e refuzată ÎNAINTE de modificări (nu se reacordă nimic). Plus invarianții sursei
--   drepturilor (profiles.is_owner / can_access_financiar neautoatribuibile).
-- Revenirea tehnică stă în supabase/revenire/ (NU se descoperă ca migrare forward).
-- ============================================================================
DO $livrare_start$
BEGIN
  -- Garda de livrare (start): marcajul e pus de runnerul de livrare (runda 5) ÎN ACEEAȘI tranzacție (legat de txid);
  -- lipsește / altă tranzacție ⇒ fișierul rulează fără gestionarul unic (psql -f simplu, autocommit, apply_migration, execute_sql).
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003e_sec_trezorerie:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003e: garda de livrare (start) — rulează DOAR prin runnerul de livrare (psql --single-transaction: marcaj + migrare + înregistrare în aceeași tranzacție)';
  END IF;
END $livrare_start$;
SET LOCAL search_path = public, pg_temp;   -- deparse determinist pentru amprente
SET LOCAL lock_timeout = '5s';

-- 0. PRECONDIȚII ---------------------------------------------------------------
DO $pre$
DECLARE
  -- amprenta politicilor: nume|cmd|permisivă|roluri|md5(USING)|md5(WITH CHECK), ';' între politici
  c_init_c CONSTANT text := 'trez_conturi_rw|*|true|authenticated|dc71e447411e7aaf354179a11ad2e2ae|dc71e447411e7aaf354179a11ad2e2ae';
  c_init_l CONSTANT text := 'trez_linii_rw|*|true|authenticated|dc71e447411e7aaf354179a11ad2e2ae|dc71e447411e7aaf354179a11ad2e2ae';
  c_patch_c CONSTANT text := 'trez_conturi_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_conturi_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_conturi_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_conturi_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  c_patch_l CONSTANT text := 'trez_linii_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_linii_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_linii_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_linii_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  -- Runda 2 (verdict §2): perechea COMPLETĂ de privilegii. Amprenta de mai jos (blocul „amprenta-20261003e”, text identic
  -- în postcondiție) acoperă: tabele + secvențe (tip relație, RLS/FORCE, owner, moșteniri/partiționare, granturi pe
  -- coloane, triggere, ACL COMPLET cu grantor și grant options, orice rol), legătura secvență ↔ coloana id
  -- (pg_get_serial_sequence + pg_depend 'a' + default + proprietățile secvenței), privilegiile EFECTIVE (cu grant options)
  -- pentru anon/authenticated/PUBLIC/service_role și helperii (atribute + md5 + ACL complet + EXECUTE efectiv).
  -- MAINTAIN (doar PG17) e scos din listele ACL și verificat separat: deținătorii MAINTAIN = deținătorii TRUNCATE.
  -- c_*_init = citit read-only pe live 30.09 (PG17) = identic cu scheletul local (PG16); c_*_patch = rezultatul patch-ului.
  c_ob_init CONSTANT text := 's1:trezorerie_conturi_id_seq kind=S rls=f force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>anon:SELECT,postgres>anon:UPDATE,postgres>anon:USAGE,postgres>authenticated:SELECT,postgres>authenticated:UPDATE,postgres>authenticated:USAGE,postgres>postgres:SELECT,postgres>postgres:UPDATE,postgres>postgres:USAGE,postgres>service_role:SELECT,postgres>service_role:UPDATE,postgres>service_role:USAGE maintain_eq_truncate=t ; s2:trezorerie_extras_linii_id_seq kind=S rls=f force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>anon:SELECT,postgres>anon:UPDATE,postgres>anon:USAGE,postgres>authenticated:SELECT,postgres>authenticated:UPDATE,postgres>authenticated:USAGE,postgres>postgres:SELECT,postgres>postgres:UPDATE,postgres>postgres:USAGE,postgres>service_role:SELECT,postgres>service_role:UPDATE,postgres>service_role:USAGE maintain_eq_truncate=t ; t1:trezorerie_conturi kind=r rls=t force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>anon:DELETE,postgres>anon:INSERT,postgres>anon:REFERENCES,postgres>anon:SELECT,postgres>anon:TRIGGER,postgres>anon:TRUNCATE,postgres>anon:UPDATE,postgres>authenticated:DELETE,postgres>authenticated:INSERT,postgres>authenticated:REFERENCES,postgres>authenticated:SELECT,postgres>authenticated:TRIGGER,postgres>authenticated:TRUNCATE,postgres>authenticated:UPDATE,postgres>postgres:DELETE,postgres>postgres:INSERT,postgres>postgres:REFERENCES,postgres>postgres:SELECT,postgres>postgres:TRIGGER,postgres>postgres:TRUNCATE,postgres>postgres:UPDATE,postgres>service_role:DELETE,postgres>service_role:INSERT,postgres>service_role:REFERENCES,postgres>service_role:SELECT,postgres>service_role:TRIGGER,postgres>service_role:TRUNCATE,postgres>service_role:UPDATE maintain_eq_truncate=t ; t2:trezorerie_extras_linii kind=r rls=t force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>anon:DELETE,postgres>anon:INSERT,postgres>anon:REFERENCES,postgres>anon:SELECT,postgres>anon:TRIGGER,postgres>anon:TRUNCATE,postgres>anon:UPDATE,postgres>authenticated:DELETE,postgres>authenticated:INSERT,postgres>authenticated:REFERENCES,postgres>authenticated:SELECT,postgres>authenticated:TRIGGER,postgres>authenticated:TRUNCATE,postgres>authenticated:UPDATE,postgres>postgres:DELETE,postgres>postgres:INSERT,postgres>postgres:REFERENCES,postgres>postgres:SELECT,postgres>postgres:TRIGGER,postgres>postgres:TRUNCATE,postgres>postgres:UPDATE,postgres>service_role:DELETE,postgres>service_role:INSERT,postgres>service_role:REFERENCES,postgres>service_role:SELECT,postgres>service_role:TRIGGER,postgres>service_role:TRUNCATE,postgres>service_role:UPDATE maintain_eq_truncate=t';
  c_ob_patch CONSTANT text := 's1:trezorerie_conturi_id_seq kind=S rls=f force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>authenticated:SELECT,postgres>authenticated:USAGE,postgres>postgres:SELECT,postgres>postgres:UPDATE,postgres>postgres:USAGE,postgres>service_role:SELECT,postgres>service_role:UPDATE,postgres>service_role:USAGE maintain_eq_truncate=t ; s2:trezorerie_extras_linii_id_seq kind=S rls=f force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>authenticated:SELECT,postgres>authenticated:USAGE,postgres>postgres:SELECT,postgres>postgres:UPDATE,postgres>postgres:USAGE,postgres>service_role:SELECT,postgres>service_role:UPDATE,postgres>service_role:USAGE maintain_eq_truncate=t ; t1:trezorerie_conturi kind=r rls=t force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>authenticated:DELETE,postgres>authenticated:INSERT,postgres>authenticated:SELECT,postgres>authenticated:UPDATE,postgres>postgres:DELETE,postgres>postgres:INSERT,postgres>postgres:REFERENCES,postgres>postgres:SELECT,postgres>postgres:TRIGGER,postgres>postgres:TRUNCATE,postgres>postgres:UPDATE,postgres>service_role:DELETE,postgres>service_role:INSERT,postgres>service_role:REFERENCES,postgres>service_role:SELECT,postgres>service_role:TRIGGER,postgres>service_role:TRUNCATE,postgres>service_role:UPDATE maintain_eq_truncate=t ; t2:trezorerie_extras_linii kind=r rls=t force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>authenticated:DELETE,postgres>authenticated:INSERT,postgres>authenticated:SELECT,postgres>authenticated:UPDATE,postgres>postgres:DELETE,postgres>postgres:INSERT,postgres>postgres:REFERENCES,postgres>postgres:SELECT,postgres>postgres:TRIGGER,postgres>postgres:TRUNCATE,postgres>postgres:UPDATE,postgres>service_role:DELETE,postgres>service_role:INSERT,postgres>service_role:REFERENCES,postgres>service_role:SELECT,postgres>service_role:TRIGGER,postgres>service_role:TRUNCATE,postgres>service_role:UPDATE maintain_eq_truncate=t';
  c_seq CONSTANT text := 't1: serial=public.trezorerie_conturi_id_seq default=nextval(''trezorerie_conturi_id_seq''::regclass) dep=a:trezorerie_conturi.id tip=bigint start=1 inc=1 min=1 max=9223372036854775807 cache=1 cycle=f ; t2: serial=public.trezorerie_extras_linii_id_seq default=nextval(''trezorerie_extras_linii_id_seq''::regclass) dep=a:trezorerie_extras_linii.id tip=bigint start=1 inc=1 min=1 max=9223372036854775807 cache=1 cycle=f';
  c_ef_init CONSTANT text := 'anon=s1[USAGE,SELECT,UPDATE] s2[USAGE,SELECT,UPDATE] t1[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES] t2[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES] ; authenticated=s1[USAGE,SELECT,UPDATE] s2[USAGE,SELECT,UPDATE] t1[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES] t2[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES] ; public=s1[] s2[] t1[ col=] t2[ col=] ; service_role=s1[USAGE,SELECT,UPDATE] s2[USAGE,SELECT,UPDATE] t1[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES] t2[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES]';
  c_ef_patch CONSTANT text := 'anon=s1[] s2[] t1[ col=] t2[ col=] ; authenticated=s1[USAGE,SELECT] s2[USAGE,SELECT] t1[SELECT,INSERT,UPDATE,DELETE col=SELECT,INSERT,UPDATE] t2[SELECT,INSERT,UPDATE,DELETE col=SELECT,INSERT,UPDATE] ; public=s1[] s2[] t1[ col=] t2[ col=] ; service_role=s1[USAGE,SELECT,UPDATE] s2[USAGE,SELECT,UPDATE] t1[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES] t2[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES]';
  c_h_patch CONSTANT text := 'h1:fn_trezorerie_poate_citi() ret=boolean lang=sql secdef=t vol=s config={"search_path=public, pg_temp"} owner=postgres md5=82ba039146f7daf609e5abafb9f243a0 acl=postgres>authenticated:EXECUTE,postgres>postgres:EXECUTE efectiv=authenticated ; h2:fn_trezorerie_poate_scrie() ret=boolean lang=sql secdef=t vol=s config={"search_path=public, pg_temp"} owner=postgres md5=507e5309bb291ab712bb2df9a14fea42 acl=postgres>authenticated:EXECUTE,postgres>postgres:EXECUTE efectiv=authenticated';
  v_q CONSTANT text := $amp$
-- <amprenta-20261003e> (text identic în precondiție și postcondiție; harness-ul verifică)
WITH ob(k, oid) AS (VALUES ('t1', to_regclass('public.trezorerie_conturi')), ('t2', to_regclass('public.trezorerie_extras_linii')),
                           ('s1', to_regclass('public.trezorerie_conturi_id_seq')), ('s2', to_regclass('public.trezorerie_extras_linii_id_seq'))),
hf(k, nume) AS (VALUES ('h1', 'fn_trezorerie_poate_citi'), ('h2', 'fn_trezorerie_poate_scrie')),
rol(r, ord) AS (VALUES ('anon', 1), ('authenticated', 2), ('public', 3), ('service_role', 4)),
tp(p, ord) AS (VALUES ('SELECT', 1), ('INSERT', 2), ('UPDATE', 3), ('DELETE', 4), ('TRUNCATE', 5), ('REFERENCES', 6), ('TRIGGER', 7)),
sp(p, ord) AS (VALUES ('USAGE', 1), ('SELECT', 2), ('UPDATE', 3))
SELECT
  (SELECT string_agg(CASE WHEN c.oid IS NULL THEN ob.k || ':LIPSA' ELSE
     format('%s:%s kind=%s rls=%s force=%s owner=%s mosteniri=%s part=%s col_acl=%s triggere=%s acl=%s maintain_eq_truncate=%s', ob.k, c.relname, c.relkind,
       c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner),
       (SELECT count(*) FROM pg_catalog.pg_inherits i WHERE i.inhparent = c.oid OR i.inhrelid = c.oid), c.relispartition,
       (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND a.attacl IS NOT NULL),
       (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
       (SELECT string_agg(format('%s>%s:%s%s', pg_get_userbyid(x.grantor), CASE WHEN x.grantee = 0 THEN 'public' ELSE pg_get_userbyid(x.grantee)::text END,
                                 x.privilege_type, CASE WHEN x.is_grantable THEN '*' ELSE '' END), ','
                          ORDER BY CASE WHEN x.grantee = 0 THEN 'public' ELSE pg_get_userbyid(x.grantee)::text END COLLATE "C", x.privilege_type COLLATE "C", pg_get_userbyid(x.grantor) COLLATE "C")
          FROM aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) x
         WHERE x.privilege_type IS DISTINCT FROM 'MAINTAIN'),
       (SELECT coalesce(array_agg(x.grantee ORDER BY x.grantee) FILTER (WHERE x.privilege_type = 'MAINTAIN'), '{}')
               IS NOT DISTINCT FROM coalesce(array_agg(x.grantee ORDER BY x.grantee) FILTER (WHERE x.privilege_type = 'TRUNCATE'), '{}')
                 OR c.relkind = 'S'
                 OR current_setting('server_version_num')::int < 170000
          FROM aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) x)) END,
     ' ; ' ORDER BY ob.k) FROM ob LEFT JOIN pg_catalog.pg_class c ON c.oid = ob.oid) AS amp_obiecte,
  (SELECT string_agg(format('%s: serial=%s default=%s dep=%s tip=%s start=%s inc=%s min=%s max=%s cache=%s cycle=%s', t.k,
       pg_get_serial_sequence(t.tab, 'id'),
       (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         WHERE d.adrelid = to_regclass(t.tab) AND a.attname = 'id'),
       (SELECT string_agg(format('%s:%s.%s', d.deptype, d.refobjid::regclass, a.attname), ',' ORDER BY d.refobjid, d.refobjsubid)
          FROM pg_catalog.pg_depend d LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
         WHERE d.classid = 'pg_class'::regclass AND d.objid = to_regclass(t.seq) AND d.refclassid = 'pg_class'::regclass),
       s.seqtypid::regtype, s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle), ' ; ' ORDER BY t.k)
     FROM (VALUES ('t1', 'public.trezorerie_conturi', 'public.trezorerie_conturi_id_seq'),
                  ('t2', 'public.trezorerie_extras_linii', 'public.trezorerie_extras_linii_id_seq')) t(k, tab, seq)
     LEFT JOIN pg_catalog.pg_sequence s ON s.seqrelid = to_regclass(t.seq)) AS amp_secvente,
  (SELECT string_agg(format('%s=%s', rol.r, (SELECT string_agg(
       CASE WHEN c.relkind = 'S' THEN
         ob.k || '[' || coalesce((SELECT string_agg(sp.p || CASE WHEN has_sequence_privilege(rol.r, c.oid, sp.p || ' WITH GRANT OPTION') THEN '*' ELSE '' END, ',' ORDER BY sp.ord)
                                    FROM sp WHERE has_sequence_privilege(rol.r, c.oid, sp.p)), '') || ']'
       ELSE
         ob.k || '[' || coalesce((SELECT string_agg(tp.p || CASE WHEN has_table_privilege(rol.r, c.oid, tp.p || ' WITH GRANT OPTION') THEN '*' ELSE '' END, ',' ORDER BY tp.ord)
                                    FROM tp WHERE has_table_privilege(rol.r, c.oid, tp.p)), '')
                 || ' col=' || coalesce((SELECT string_agg(tp.p, ',' ORDER BY tp.ord) FROM tp
                                          WHERE tp.p IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') AND has_any_column_privilege(rol.r, c.oid, tp.p)), '') || ']'
       END, ' ' ORDER BY ob.k) FROM ob JOIN pg_catalog.pg_class c ON c.oid = ob.oid)), ' ; ' ORDER BY rol.ord)
     FROM rol) AS amp_efective,
  coalesce((SELECT string_agg(format('%s:%s(%s) ret=%s lang=%s secdef=%s vol=%s config=%s owner=%s md5=%s acl=%s efectiv=%s', hf.k, f.proname,
       pg_get_function_identity_arguments(f.oid), f.prorettype::regtype, l.lanname, f.prosecdef, f.provolatile, f.proconfig, pg_get_userbyid(f.proowner), md5(f.prosrc),
       (SELECT string_agg(format('%s>%s:%s%s', pg_get_userbyid(x.grantor), CASE WHEN x.grantee = 0 THEN 'public' ELSE pg_get_userbyid(x.grantee)::text END,
                                 x.privilege_type, CASE WHEN x.is_grantable THEN '*' ELSE '' END), ','
                          ORDER BY CASE WHEN x.grantee = 0 THEN 'public' ELSE pg_get_userbyid(x.grantee)::text END COLLATE "C", pg_get_userbyid(x.grantor) COLLATE "C")
          FROM aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) x),
       (SELECT string_agg(rol.r || CASE WHEN has_function_privilege(rol.r, f.oid, 'EXECUTE WITH GRANT OPTION') THEN '*' ELSE '' END, ',' ORDER BY rol.ord)
          FROM rol WHERE has_function_privilege(rol.r, f.oid, 'EXECUTE'))),
     ' ; ' ORDER BY hf.k, f.oid)
     FROM hf JOIN pg_catalog.pg_proc f ON f.proname = hf.nume AND f.pronamespace = 'public'::regnamespace
     JOIN pg_catalog.pg_language l ON l.oid = f.prolang), '<NICIUNUL>') AS amp_helperi
-- </amprenta-20261003e>
$amp$;
  -- Runda 2 (verdict §2, §4): invarianții SURSEI drepturilor variantei A, citiți read-only pe live 30.09 cu aceeași
  -- interogare. Un cont authenticated fără drept NU își poate seta is_owner / can_access_financiar: politicile de scriere
  -- pe profiles (INSERT/DELETE/UPDATE-altcuiva doar owner; UPDATE propriu permis) + triggerele prevent_role_escalation
  -- (excepție la is_owner/role) și enforce_owner_only_salary_flags (resetează is_owner și can_access_*, inclusiv
  -- can_access_financiar). Orice diferență → refuz; se reanalizează, nu se copiază amprenta nouă.
  c_inv_tabel CONSTANT text := 'profiles rls=t force=f owner=postgres kind=r';
  c_inv_pol CONSTANT text := 'profiles_delete_owner|d|permissive|authenticated|c820f31f788833db3c8d7830979c8803|<NULL>;profiles_insert_owner|a|permissive|authenticated|<NULL>|c820f31f788833db3c8d7830979c8803;profiles_update_own|w|permissive|authenticated|bc9c729a84690340789a4e4f01175335|bc9c729a84690340789a4e4f01175335;profiles_update_owner|w|permissive|authenticated|c820f31f788833db3c8d7830979c8803|c820f31f788833db3c8d7830979c8803';
  c_inv_trg CONSTANT text := 'prevent_role_escalation_trigger|O|93294585aa40f0ef96cfc50f3b525005|16112659be92143e6539ae0e54e47a06|t;trg_enforce_owner_only_salary_flags|O|235b88ed60c6cfe3eefb775b33a78aca|0470660c0a819981ff914355c7f6d00a|t';
  c_inv_col CONSTANT text := 'can_access_financiar:boolean,id:uuid,is_owner:boolean';
  c_inv_rol CONSTANT text := 'anon bypassrls=f super=f ; authenticated bypassrls=f super=f';
  v_qi CONSTANT text := $inv$
-- <invarianti-20261003e> (sursa drepturilor variantei A: profiles.is_owner + profiles.can_access_financiar; runda 2)
SELECT
  (SELECT format('%s rls=%s force=%s owner=%s kind=%s', c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner), c.relkind)
     FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.profiles')) AS inv_tabel,
  coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s|%s', p.polname, p.polcmd,
                     CASE WHEN p.polpermissive THEN 'permissive' ELSE 'restrictive' END,
                     (SELECT string_agg(CASE WHEN x = 0 THEN 'public' ELSE pg_get_userbyid(x)::text END, ',' ORDER BY 1) FROM unnest(p.polroles) AS x),
                     coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '<NULL>'),
                     coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '<NULL>')),
                   ';' ORDER BY p.polname COLLATE "C")
              FROM pg_catalog.pg_policy p WHERE p.polrelid = to_regclass('public.profiles') AND p.polcmd IS DISTINCT FROM 'r'), '<NICIUNA>') AS inv_politici_scriere,
  coalesce((SELECT string_agg(format('%s|%s|%s|%s|%s', t.tgname, t.tgenabled, md5(pg_get_triggerdef(t.oid)), md5(f.prosrc), f.prosecdef),
                   ';' ORDER BY t.tgname COLLATE "C")
              FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc f ON f.oid = t.tgfoid
             WHERE t.tgrelid = to_regclass('public.profiles') AND NOT t.tgisinternal
               AND t.tgname IN ('prevent_role_escalation_trigger', 'trg_enforce_owner_only_salary_flags')), '<NICIUNUL>') AS inv_triggere,
  (SELECT string_agg(format('%s:%s', a.attname, format_type(a.atttypid, a.atttypmod)), ',' ORDER BY a.attname COLLATE "C")
     FROM pg_catalog.pg_attribute a WHERE a.attrelid = to_regclass('public.profiles') AND a.attname IN ('id', 'is_owner', 'can_access_financiar') AND NOT a.attisdropped) AS inv_coloane,
  (SELECT string_agg(format('%s bypassrls=%s super=%s', r.rolname, r.rolbypassrls, r.rolsuper), ' ; ' ORDER BY r.rolname COLLATE "C")
     FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon', 'authenticated')) AS inv_roluri
-- </invarianti-20261003e>
$inv$;
  v_fp_c text; v_fp_l text; v_ob text; v_seq text; v_ef text; v_h text; v_i1 text; v_i2 text; v_i3 text; v_i4 text; v_i5 text; t regclass;
BEGIN
  IF to_regclass('public.trezorerie_conturi') IS NULL OR to_regclass('public.trezorerie_extras_linii') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITIE: tabelele trezorerie lipsesc';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'PRECONDITIE: auth.uid() lipsește'; END IF;
  EXECUTE v_qi INTO v_i1, v_i2, v_i3, v_i4, v_i5;
  IF v_i1 IS DISTINCT FROM c_inv_tabel OR v_i2 IS DISTINCT FROM c_inv_pol OR v_i3 IS DISTINCT FROM c_inv_trg
     OR v_i4 IS DISTINCT FROM c_inv_col OR v_i5 IS DISTINCT FROM c_inv_rol THEN  -- [pre:invarianti]
    RAISE EXCEPTION 'PRECONDITIE: sursa drepturilor (profiles.is_owner / can_access_financiar) nu e în starea verificată — autoatribuirea nu mai e exclusă demonstrat'
      USING DETAIL = concat_ws(E'\n', 'tabel: ' || v_i1, 'politici scriere: ' || v_i2, 'triggere: ' || v_i3, 'coloane: ' || v_i4, 'roluri: ' || v_i5);
  END IF;

  SELECT coalesce(string_agg(p.polname::text||'|'||p.polcmd::text||'|'||p.polpermissive::text||'|'||
           (SELECT coalesce(string_agg(z.n, ',' ORDER BY z.n), '') FROM (SELECT CASE WHEN rr = 0 THEN 'public' ELSE pg_get_userbyid(rr)::text END AS n FROM unnest(p.polroles) rr) z)
           ||'|'||coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '-')||'|'||coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-'),
           ';' ORDER BY p.polname), '')
    INTO v_fp_c FROM pg_policy p WHERE p.polrelid = 'public.trezorerie_conturi'::regclass;
  SELECT coalesce(string_agg(p.polname::text||'|'||p.polcmd::text||'|'||p.polpermissive::text||'|'||
           (SELECT coalesce(string_agg(z.n, ',' ORDER BY z.n), '') FROM (SELECT CASE WHEN rr = 0 THEN 'public' ELSE pg_get_userbyid(rr)::text END AS n FROM unnest(p.polroles) rr) z)
           ||'|'||coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '-')||'|'||coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-'),
           ';' ORDER BY p.polname), '')
    INTO v_fp_l FROM pg_policy p WHERE p.polrelid = 'public.trezorerie_extras_linii'::regclass;

  EXECUTE v_q INTO v_ob, v_seq, v_ef, v_h;
  IF v_seq IS DISTINCT FROM c_seq THEN  -- [pre:secvente]
    RAISE EXCEPTION 'PRECONDITIE: secvențele ID nu sunt cele legate de coloanele id (sau proprietățile lor diferă), refuz' USING DETAIL = v_seq;
  END IF;

  -- numai două stări COMPLETE acceptate: (live de azi, fără helperi) sau (patch: politici + ACL + helperi exacți)
  IF v_fp_c IS NOT DISTINCT FROM c_init_c AND v_fp_l IS NOT DISTINCT FROM c_init_l
     AND v_ob IS NOT DISTINCT FROM c_ob_init AND v_ef IS NOT DISTINCT FROM c_ef_init AND v_h IS NOT DISTINCT FROM '<NICIUNUL>' THEN
    RAISE NOTICE 'sec_trezorerie: stare inițială recunoscută, aplic';
  ELSIF v_fp_c IS NOT DISTINCT FROM c_patch_c AND v_fp_l IS NOT DISTINCT FROM c_patch_l
     AND v_ob IS NOT DISTINCT FROM c_ob_patch AND v_ef IS NOT DISTINCT FROM c_ef_patch AND v_h IS NOT DISTINCT FROM c_h_patch THEN
    RAISE NOTICE 'sec_trezorerie: starea patch-ului deja prezentă, reaplic idempotent';
  ELSIF v_fp_c IS NOT DISTINCT FROM c_init_c AND v_fp_l IS NOT DISTINCT FROM c_init_l
     AND v_ob IS NOT DISTINCT FROM c_ob_patch AND v_ef IS NOT DISTINCT FROM c_ef_patch AND v_h IS NOT DISTINCT FROM '<NICIUNUL>' THEN
    -- a treia stare cunoscută, produsă DOAR de revenirea tehnică (supabase/revenire/): politici deschise, ACL-uri strânse, fără helperi
    RAISE NOTICE 'sec_trezorerie: starea de după revenirea tehnică recunoscută, aplic';
  ELSE  -- [pre:stare]
    RAISE EXCEPTION 'PRECONDITIE: stare necunoscută (politici conturi=%, linii=%), refuz înainte de orice modificare', v_fp_c, v_fp_l
      USING DETAIL = concat_ws(E'\n', 'obiecte: ' || v_ob, 'efective: ' || v_ef, 'helperi: ' || v_h);
  END IF;
  -- service_role: privilegiile efective ÎNAINTE, comparate în postcondiție (aceeași tranzacție)
  PERFORM set_config('gazpet.sec_trez_service_role', coalesce(substring(v_ef from 'service_role=[^;]*$'), '<LIPSA>'), true);
END
$pre$;

-- 1. POLITICI: le scot pe cele deschise ------------------------------------------
DROP POLICY IF EXISTS trez_conturi_rw ON public.trezorerie_conturi;
-- @@INJECTIE_1@@
DROP POLICY IF EXISTS trez_linii_rw ON public.trezorerie_extras_linii;

-- 2. HELPERI — singurul loc unde stă decizia lui Răzvan ----------------------------
CREATE OR REPLACE FUNCTION public.fn_trezorerie_poate_citi()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  -- CITIRE trezorerie (varianta A): owner SAU can_access_financiar (flag protejat de trigger, owner-only).
  -- UID absent / profil absent → false (EXISTS nu întoarce niciodată NULL).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (p.is_owner IS TRUE OR p.can_access_financiar IS TRUE)
  )
$fn$;

CREATE OR REPLACE FUNCTION public.fn_trezorerie_poate_scrie()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  -- SCRIERE trezorerie (varianta A): owner SAU can_access_financiar. Decizie SEPARATĂ de citire;
  -- trebuie să rămână submulțime a citirii (UPDATE/DELETE cu WHERE cer și SELECT).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND (p.is_owner IS TRUE OR p.can_access_financiar IS TRUE)
  )
$fn$;

REVOKE ALL ON FUNCTION public.fn_trezorerie_poate_citi()  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_trezorerie_poate_scrie() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_citi()  TO authenticated;   -- evaluat în politici ca authenticated
GRANT EXECUTE ON FUNCTION public.fn_trezorerie_poate_scrie() TO authenticated;

-- 3. POLITICI NOI (citire și scriere separate) -----------------------------------
DROP POLICY IF EXISTS trez_conturi_select ON public.trezorerie_conturi;
DROP POLICY IF EXISTS trez_conturi_insert ON public.trezorerie_conturi;
DROP POLICY IF EXISTS trez_conturi_update ON public.trezorerie_conturi;
DROP POLICY IF EXISTS trez_conturi_delete ON public.trezorerie_conturi;
CREATE POLICY trez_conturi_select ON public.trezorerie_conturi FOR SELECT TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_citi()));
CREATE POLICY trez_conturi_insert ON public.trezorerie_conturi FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_trezorerie_poate_scrie()));
CREATE POLICY trez_conturi_update ON public.trezorerie_conturi FOR UPDATE TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_scrie())) WITH CHECK ((SELECT public.fn_trezorerie_poate_scrie()));
CREATE POLICY trez_conturi_delete ON public.trezorerie_conturi FOR DELETE TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_scrie()));

DROP POLICY IF EXISTS trez_linii_select ON public.trezorerie_extras_linii;
DROP POLICY IF EXISTS trez_linii_insert ON public.trezorerie_extras_linii;
DROP POLICY IF EXISTS trez_linii_update ON public.trezorerie_extras_linii;
DROP POLICY IF EXISTS trez_linii_delete ON public.trezorerie_extras_linii;
CREATE POLICY trez_linii_select ON public.trezorerie_extras_linii FOR SELECT TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_citi()));
CREATE POLICY trez_linii_insert ON public.trezorerie_extras_linii FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.fn_trezorerie_poate_scrie()));
CREATE POLICY trez_linii_update ON public.trezorerie_extras_linii FOR UPDATE TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_scrie())) WITH CHECK ((SELECT public.fn_trezorerie_poate_scrie()));
CREATE POLICY trez_linii_delete ON public.trezorerie_extras_linii FOR DELETE TO authenticated
  USING ((SELECT public.fn_trezorerie_poate_scrie()));

-- 4. PRIVILEGII (REVOKE ALL acoperă și MAINTAIN pe PG17) ---------------------------
REVOKE ALL ON public.trezorerie_conturi, public.trezorerie_extras_linii FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trezorerie_conturi, public.trezorerie_extras_linii TO authenticated;
REVOKE ALL ON SEQUENCE public.trezorerie_conturi_id_seq, public.trezorerie_extras_linii_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.trezorerie_conturi_id_seq, public.trezorerie_extras_linii_id_seq TO authenticated;

-- 5. POSTCONDIȚIE (înainte de garda de final și de COMMIT-ul runnerului) ----------------------------------------------
DO $post$
DECLARE
  c_patch_c CONSTANT text := 'trez_conturi_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_conturi_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_conturi_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_conturi_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  c_patch_l CONSTANT text := 'trez_linii_delete|d|true|authenticated|045167d08a35e722528d1226e144ebae|-;trez_linii_insert|a|true|authenticated|-|045167d08a35e722528d1226e144ebae;trez_linii_select|r|true|authenticated|6bfc268df3eaadedbbc55f0b3cb3e582|-;trez_linii_update|w|true|authenticated|045167d08a35e722528d1226e144ebae|045167d08a35e722528d1226e144ebae';
  c_md5_citi  CONSTANT text := '82ba039146f7daf609e5abafb9f243a0';
  c_md5_scrie CONSTANT text := '507e5309bb291ab712bb2df9a14fea42';
  v_fp_c text; v_fp_l text; v_n int; t regclass; s regclass; r text; pr text; f regprocedure;
  v_ob text; v_seq text; v_ef text; v_h text;
  c_ob_patch CONSTANT text := 's1:trezorerie_conturi_id_seq kind=S rls=f force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>authenticated:SELECT,postgres>authenticated:USAGE,postgres>postgres:SELECT,postgres>postgres:UPDATE,postgres>postgres:USAGE,postgres>service_role:SELECT,postgres>service_role:UPDATE,postgres>service_role:USAGE maintain_eq_truncate=t ; s2:trezorerie_extras_linii_id_seq kind=S rls=f force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>authenticated:SELECT,postgres>authenticated:USAGE,postgres>postgres:SELECT,postgres>postgres:UPDATE,postgres>postgres:USAGE,postgres>service_role:SELECT,postgres>service_role:UPDATE,postgres>service_role:USAGE maintain_eq_truncate=t ; t1:trezorerie_conturi kind=r rls=t force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>authenticated:DELETE,postgres>authenticated:INSERT,postgres>authenticated:SELECT,postgres>authenticated:UPDATE,postgres>postgres:DELETE,postgres>postgres:INSERT,postgres>postgres:REFERENCES,postgres>postgres:SELECT,postgres>postgres:TRIGGER,postgres>postgres:TRUNCATE,postgres>postgres:UPDATE,postgres>service_role:DELETE,postgres>service_role:INSERT,postgres>service_role:REFERENCES,postgres>service_role:SELECT,postgres>service_role:TRIGGER,postgres>service_role:TRUNCATE,postgres>service_role:UPDATE maintain_eq_truncate=t ; t2:trezorerie_extras_linii kind=r rls=t force=f owner=postgres mosteniri=0 part=f col_acl=0 triggere=0 acl=postgres>authenticated:DELETE,postgres>authenticated:INSERT,postgres>authenticated:SELECT,postgres>authenticated:UPDATE,postgres>postgres:DELETE,postgres>postgres:INSERT,postgres>postgres:REFERENCES,postgres>postgres:SELECT,postgres>postgres:TRIGGER,postgres>postgres:TRUNCATE,postgres>postgres:UPDATE,postgres>service_role:DELETE,postgres>service_role:INSERT,postgres>service_role:REFERENCES,postgres>service_role:SELECT,postgres>service_role:TRIGGER,postgres>service_role:TRUNCATE,postgres>service_role:UPDATE maintain_eq_truncate=t';
  c_seq CONSTANT text := 't1: serial=public.trezorerie_conturi_id_seq default=nextval(''trezorerie_conturi_id_seq''::regclass) dep=a:trezorerie_conturi.id tip=bigint start=1 inc=1 min=1 max=9223372036854775807 cache=1 cycle=f ; t2: serial=public.trezorerie_extras_linii_id_seq default=nextval(''trezorerie_extras_linii_id_seq''::regclass) dep=a:trezorerie_extras_linii.id tip=bigint start=1 inc=1 min=1 max=9223372036854775807 cache=1 cycle=f';
  c_ef_patch CONSTANT text := 'anon=s1[] s2[] t1[ col=] t2[ col=] ; authenticated=s1[USAGE,SELECT] s2[USAGE,SELECT] t1[SELECT,INSERT,UPDATE,DELETE col=SELECT,INSERT,UPDATE] t2[SELECT,INSERT,UPDATE,DELETE col=SELECT,INSERT,UPDATE] ; public=s1[] s2[] t1[ col=] t2[ col=] ; service_role=s1[USAGE,SELECT,UPDATE] s2[USAGE,SELECT,UPDATE] t1[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES] t2[SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER col=SELECT,INSERT,UPDATE,REFERENCES]';
  c_h_patch CONSTANT text := 'h1:fn_trezorerie_poate_citi() ret=boolean lang=sql secdef=t vol=s config={"search_path=public, pg_temp"} owner=postgres md5=82ba039146f7daf609e5abafb9f243a0 acl=postgres>authenticated:EXECUTE,postgres>postgres:EXECUTE efectiv=authenticated ; h2:fn_trezorerie_poate_scrie() ret=boolean lang=sql secdef=t vol=s config={"search_path=public, pg_temp"} owner=postgres md5=507e5309bb291ab712bb2df9a14fea42 acl=postgres>authenticated:EXECUTE,postgres>postgres:EXECUTE efectiv=authenticated';
  v_q CONSTANT text := $amp$
-- <amprenta-20261003e> (text identic în precondiție și postcondiție; harness-ul verifică)
WITH ob(k, oid) AS (VALUES ('t1', to_regclass('public.trezorerie_conturi')), ('t2', to_regclass('public.trezorerie_extras_linii')),
                           ('s1', to_regclass('public.trezorerie_conturi_id_seq')), ('s2', to_regclass('public.trezorerie_extras_linii_id_seq'))),
hf(k, nume) AS (VALUES ('h1', 'fn_trezorerie_poate_citi'), ('h2', 'fn_trezorerie_poate_scrie')),
rol(r, ord) AS (VALUES ('anon', 1), ('authenticated', 2), ('public', 3), ('service_role', 4)),
tp(p, ord) AS (VALUES ('SELECT', 1), ('INSERT', 2), ('UPDATE', 3), ('DELETE', 4), ('TRUNCATE', 5), ('REFERENCES', 6), ('TRIGGER', 7)),
sp(p, ord) AS (VALUES ('USAGE', 1), ('SELECT', 2), ('UPDATE', 3))
SELECT
  (SELECT string_agg(CASE WHEN c.oid IS NULL THEN ob.k || ':LIPSA' ELSE
     format('%s:%s kind=%s rls=%s force=%s owner=%s mosteniri=%s part=%s col_acl=%s triggere=%s acl=%s maintain_eq_truncate=%s', ob.k, c.relname, c.relkind,
       c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner),
       (SELECT count(*) FROM pg_catalog.pg_inherits i WHERE i.inhparent = c.oid OR i.inhrelid = c.oid), c.relispartition,
       (SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND a.attacl IS NOT NULL),
       (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal),
       (SELECT string_agg(format('%s>%s:%s%s', pg_get_userbyid(x.grantor), CASE WHEN x.grantee = 0 THEN 'public' ELSE pg_get_userbyid(x.grantee)::text END,
                                 x.privilege_type, CASE WHEN x.is_grantable THEN '*' ELSE '' END), ','
                          ORDER BY CASE WHEN x.grantee = 0 THEN 'public' ELSE pg_get_userbyid(x.grantee)::text END COLLATE "C", x.privilege_type COLLATE "C", pg_get_userbyid(x.grantor) COLLATE "C")
          FROM aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) x
         WHERE x.privilege_type IS DISTINCT FROM 'MAINTAIN'),
       (SELECT coalesce(array_agg(x.grantee ORDER BY x.grantee) FILTER (WHERE x.privilege_type = 'MAINTAIN'), '{}')
               IS NOT DISTINCT FROM coalesce(array_agg(x.grantee ORDER BY x.grantee) FILTER (WHERE x.privilege_type = 'TRUNCATE'), '{}')
                 OR c.relkind = 'S'
                 OR current_setting('server_version_num')::int < 170000
          FROM aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) x)) END,
     ' ; ' ORDER BY ob.k) FROM ob LEFT JOIN pg_catalog.pg_class c ON c.oid = ob.oid) AS amp_obiecte,
  (SELECT string_agg(format('%s: serial=%s default=%s dep=%s tip=%s start=%s inc=%s min=%s max=%s cache=%s cycle=%s', t.k,
       pg_get_serial_sequence(t.tab, 'id'),
       (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         WHERE d.adrelid = to_regclass(t.tab) AND a.attname = 'id'),
       (SELECT string_agg(format('%s:%s.%s', d.deptype, d.refobjid::regclass, a.attname), ',' ORDER BY d.refobjid, d.refobjsubid)
          FROM pg_catalog.pg_depend d LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
         WHERE d.classid = 'pg_class'::regclass AND d.objid = to_regclass(t.seq) AND d.refclassid = 'pg_class'::regclass),
       s.seqtypid::regtype, s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle), ' ; ' ORDER BY t.k)
     FROM (VALUES ('t1', 'public.trezorerie_conturi', 'public.trezorerie_conturi_id_seq'),
                  ('t2', 'public.trezorerie_extras_linii', 'public.trezorerie_extras_linii_id_seq')) t(k, tab, seq)
     LEFT JOIN pg_catalog.pg_sequence s ON s.seqrelid = to_regclass(t.seq)) AS amp_secvente,
  (SELECT string_agg(format('%s=%s', rol.r, (SELECT string_agg(
       CASE WHEN c.relkind = 'S' THEN
         ob.k || '[' || coalesce((SELECT string_agg(sp.p || CASE WHEN has_sequence_privilege(rol.r, c.oid, sp.p || ' WITH GRANT OPTION') THEN '*' ELSE '' END, ',' ORDER BY sp.ord)
                                    FROM sp WHERE has_sequence_privilege(rol.r, c.oid, sp.p)), '') || ']'
       ELSE
         ob.k || '[' || coalesce((SELECT string_agg(tp.p || CASE WHEN has_table_privilege(rol.r, c.oid, tp.p || ' WITH GRANT OPTION') THEN '*' ELSE '' END, ',' ORDER BY tp.ord)
                                    FROM tp WHERE has_table_privilege(rol.r, c.oid, tp.p)), '')
                 || ' col=' || coalesce((SELECT string_agg(tp.p, ',' ORDER BY tp.ord) FROM tp
                                          WHERE tp.p IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') AND has_any_column_privilege(rol.r, c.oid, tp.p)), '') || ']'
       END, ' ' ORDER BY ob.k) FROM ob JOIN pg_catalog.pg_class c ON c.oid = ob.oid)), ' ; ' ORDER BY rol.ord)
     FROM rol) AS amp_efective,
  coalesce((SELECT string_agg(format('%s:%s(%s) ret=%s lang=%s secdef=%s vol=%s config=%s owner=%s md5=%s acl=%s efectiv=%s', hf.k, f.proname,
       pg_get_function_identity_arguments(f.oid), f.prorettype::regtype, l.lanname, f.prosecdef, f.provolatile, f.proconfig, pg_get_userbyid(f.proowner), md5(f.prosrc),
       (SELECT string_agg(format('%s>%s:%s%s', pg_get_userbyid(x.grantor), CASE WHEN x.grantee = 0 THEN 'public' ELSE pg_get_userbyid(x.grantee)::text END,
                                 x.privilege_type, CASE WHEN x.is_grantable THEN '*' ELSE '' END), ','
                          ORDER BY CASE WHEN x.grantee = 0 THEN 'public' ELSE pg_get_userbyid(x.grantee)::text END COLLATE "C", pg_get_userbyid(x.grantor) COLLATE "C")
          FROM aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) x),
       (SELECT string_agg(rol.r || CASE WHEN has_function_privilege(rol.r, f.oid, 'EXECUTE WITH GRANT OPTION') THEN '*' ELSE '' END, ',' ORDER BY rol.ord)
          FROM rol WHERE has_function_privilege(rol.r, f.oid, 'EXECUTE'))),
     ' ; ' ORDER BY hf.k, f.oid)
     FROM hf JOIN pg_catalog.pg_proc f ON f.proname = hf.nume AND f.pronamespace = 'public'::regnamespace
     JOIN pg_catalog.pg_language l ON l.oid = f.prolang), '<NICIUNUL>') AS amp_helperi
-- </amprenta-20261003e>
$amp$;
BEGIN
  SELECT coalesce(string_agg(p.polname::text||'|'||p.polcmd::text||'|'||p.polpermissive::text||'|'||
           (SELECT coalesce(string_agg(z.n, ',' ORDER BY z.n), '') FROM (SELECT CASE WHEN rr = 0 THEN 'public' ELSE pg_get_userbyid(rr)::text END AS n FROM unnest(p.polroles) rr) z)
           ||'|'||coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '-')||'|'||coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-'),
           ';' ORDER BY p.polname), '')
    INTO v_fp_c FROM pg_policy p WHERE p.polrelid = 'public.trezorerie_conturi'::regclass;
  SELECT coalesce(string_agg(p.polname::text||'|'||p.polcmd::text||'|'||p.polpermissive::text||'|'||
           (SELECT coalesce(string_agg(z.n, ',' ORDER BY z.n), '') FROM (SELECT CASE WHEN rr = 0 THEN 'public' ELSE pg_get_userbyid(rr)::text END AS n FROM unnest(p.polroles) rr) z)
           ||'|'||coalesce(md5(pg_get_expr(p.polqual, p.polrelid)), '-')||'|'||coalesce(md5(pg_get_expr(p.polwithcheck, p.polrelid)), '-'),
           ';' ORDER BY p.polname), '')
    INTO v_fp_l FROM pg_policy p WHERE p.polrelid = 'public.trezorerie_extras_linii'::regclass;
  IF v_fp_c IS DISTINCT FROM c_patch_c OR v_fp_l IS DISTINCT FROM c_patch_l THEN
    RAISE EXCEPTION 'POSTCONDITIE: politici neașteptate (conturi=%, linii=%)', v_fp_c, v_fp_l;
  END IF;

  FOREACH t IN ARRAY ARRAY['public.trezorerie_conturi'::regclass, 'public.trezorerie_extras_linii'::regclass] LOOP
    IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = t) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'POSTCONDITIE: RLS oprit pe %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'POSTCONDITIE: granturi pe coloane pe %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = t
                AND (x.grantee = 0 OR pg_get_userbyid(x.grantee) NOT IN ('postgres','service_role','authenticated'))) THEN
      RAISE EXCEPTION 'POSTCONDITIE: grantee neașteptat pe %', t;
    END IF;
    -- privilegii EFECTIVE (includ PUBLIC și moștenirea)
    FOREACH r IN ARRAY ARRAY['anon','public'] LOOP
      FOREACH pr IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(r, t, pr) IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'POSTCONDITIE: % are % pe %', r, pr, t;
        END IF;
      END LOOP;
      FOREACH pr IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_any_column_privilege(r, t, pr) IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'POSTCONDITIE: % are % pe coloane din %', r, pr, t;
        END IF;
      END LOOP;
    END LOOP;
    FOREACH pr IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('authenticated', t, pr) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'POSTCONDITIE: authenticated fără % pe %', pr, t;
      END IF;
      IF has_table_privilege('service_role', t, pr) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'POSTCONDITIE: service_role fără % pe % (edge afectat)', pr, t;
      END IF;
    END LOOP;
    FOREACH pr IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('authenticated', t, pr) IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'POSTCONDITIE: authenticated are % pe %', pr, t;
      END IF;
    END LOOP;
    IF current_setting('server_version_num')::int >= 170000 THEN
      FOREACH r IN ARRAY ARRAY['anon','public','authenticated'] LOOP
        IF has_table_privilege(r, t, 'MAINTAIN') IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'POSTCONDITIE: % are MAINTAIN pe %', r, t;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  FOREACH s IN ARRAY ARRAY['public.trezorerie_conturi_id_seq'::regclass, 'public.trezorerie_extras_linii_id_seq'::regclass] LOOP
    FOREACH r IN ARRAY ARRAY['anon','public'] LOOP
      FOREACH pr IN ARRAY ARRAY['USAGE','SELECT','UPDATE'] LOOP
        IF has_sequence_privilege(r, s, pr) IS DISTINCT FROM false THEN
          RAISE EXCEPTION 'POSTCONDITIE: % are % pe %', r, pr, s;
        END IF;
      END LOOP;
    END LOOP;
    IF has_sequence_privilege('authenticated', s, 'USAGE') IS DISTINCT FROM true
       OR has_sequence_privilege('authenticated', s, 'UPDATE') IS DISTINCT FROM false
       OR has_sequence_privilege('service_role', s, 'USAGE') IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'POSTCONDITIE: privilegii neașteptate pe %', s;
    END IF;
  END LOOP;

  -- helperii: atribute exacte
  SELECT count(*) INTO v_n FROM pg_proc f
   WHERE f.pronamespace = 'public'::regnamespace AND f.proname IN ('fn_trezorerie_poate_citi','fn_trezorerie_poate_scrie');
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'POSTCONDITIE: % variante de helperi (se cer 2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_proc f
   WHERE f.pronamespace = 'public'::regnamespace AND f.pronargs = 0
     AND f.prorettype = 'boolean'::regtype AND f.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
     AND f.prosecdef IS TRUE AND f.provolatile = 's'
     AND f.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND f.proowner = 'postgres'::regrole
     AND ((f.proname = 'fn_trezorerie_poate_citi'  AND md5(f.prosrc) IS NOT DISTINCT FROM c_md5_citi)
       OR (f.proname = 'fn_trezorerie_poate_scrie' AND md5(f.prosrc) IS NOT DISTINCT FROM c_md5_scrie));
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'POSTCONDITIE: atributele helperilor diferă (prosrc/secdef/config/owner)'; END IF;

  FOREACH f IN ARRAY ARRAY['public.fn_trezorerie_poate_citi()'::regprocedure, 'public.fn_trezorerie_poate_scrie()'::regprocedure] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') IS DISTINCT FROM true
       OR has_function_privilege('anon', f, 'EXECUTE') IS DISTINCT FROM false
       OR has_function_privilege('public', f, 'EXECUTE') IS DISTINCT FROM false
       OR has_function_privilege('service_role', f, 'EXECUTE') IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'POSTCONDITIE: EXECUTE neașteptat pe %', f;
    END IF;
  END LOOP;
  -- Runda 2 (verdict §2): starea COMPLETĂ exactă (ACL aprobat complet pe tabele/secvențe/helperi, niciun rol în plus,
  -- toate proprietățile secvențelor, legătura cu coloanele id, privilegii efective cu grant options)
  EXECUTE v_q INTO v_ob, v_seq, v_ef, v_h;
  IF v_ob IS DISTINCT FROM c_ob_patch THEN RAISE EXCEPTION 'POSTCONDITIE: obiecte/ACL diferite de ținta aprobată' USING DETAIL = v_ob; END IF;
  IF v_seq IS DISTINCT FROM c_seq THEN RAISE EXCEPTION 'POSTCONDITIE: secvențele diferă' USING DETAIL = v_seq; END IF;
  IF v_ef IS DISTINCT FROM c_ef_patch THEN RAISE EXCEPTION 'POSTCONDITIE: privilegii efective diferite de țintă' USING DETAIL = v_ef; END IF;
  IF v_h IS DISTINCT FROM c_h_patch THEN RAISE EXCEPTION 'POSTCONDITIE: helperii (atribute/ACL) diferă de țintă' USING DETAIL = v_h; END IF;
  IF substring(v_ef from 'service_role=[^;]*$') IS DISTINCT FROM current_setting('gazpet.sec_trez_service_role', true) THEN
    RAISE EXCEPTION 'POSTCONDITIE: privilegiile efective service_role s-au schimbat (înainte: %, după: %)',
      current_setting('gazpet.sec_trez_service_role', true), substring(v_ef from 'service_role=[^;]*$');
  END IF;
  PERFORM set_config('gazpet.sec_trez_service_role', '', true);
  -- @@INJECTIE_2@@
  RAISE NOTICE 'sec_trezorerie: postcondiție OK';
END
$post$;

DO $livrare_final$
BEGIN
  -- Garda de livrare (final, după postcondiții): marcajul e pus de runnerul de livrare (runda 5) ÎN ACEEAȘI tranzacție (legat de txid);
  -- lipsește / altă tranzacție ⇒ fișierul rulează fără gestionarul unic (psql -f simplu, autocommit, apply_migration, execute_sql).
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003e_sec_trezorerie:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003e: garda de livrare (final, după postcondiții) — rulează DOAR prin runnerul de livrare (psql --single-transaction: marcaj + migrare + înregistrare în aceeași tranzacție)';
  END IF;
END $livrare_final$;
