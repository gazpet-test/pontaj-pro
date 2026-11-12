-- Derivarea din CATALOG a obiectelor care ajung la un proiect de Execuție (20261209a). Independentă de migrare: harness-ul o folosește ca
-- oracol pentru inventar (L25: lista testată NU se copiază din migrare), iar scripts/executie_acces_catalog_lista.sql o afișează singură,
-- fără migrare, ca să se poată clasifica tot ce există în BD înainte de dry-run. Doar funcții pg_temp (dispar la închiderea sesiunii).
--   t_cat_tabele(stop, prefixe)  — tabelele legate de executie_proiecte prin FK (tranzitiv) sau cu o coloană întreagă proiect_id;
--                                  din tabelele „stop” (nume exacte / prefixe) nu se mai coboară; adâncime maximă 6.
--   t_cat_proiect_expr(rel)      — expresia SQL (alias t) a proiectului unui rând: coloana proiect_id, FK direct spre executie_proiecte,
--                                  altfel drumul pe FK (întâi coloanele NOT NULL), cel mult 4 niveluri; NULL = nu se poate deriva.
--   t_cat_vederi(baza)           — vederile (și vederile peste vederi) peste relațiile date: invoker? materializată? citibilă din API?
--   t_cat_functii(nume)          — funcțiile SECURITY DEFINER din public, apelabile de anon / authenticated, al căror corp numește una din relații.
CREATE FUNCTION pg_temp.t_cat_tabele(p_stop text[], p_prefixe text[])
RETURNS TABLE (rel oid, nume text, e_public boolean, adancime integer) LANGUAGE sql STABLE AS $h$
  WITH RECURSIVE n(rel, adancime) AS (
    SELECT 'public.executie_proiecte'::regclass::oid, 0
    UNION
    SELECT a.attrelid, 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
     WHERE a.attname = 'proiect_id' AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid IN ('int4'::regtype, 'int8'::regtype)
       AND c.relkind IN ('r', 'p') AND c.relnamespace = 'public'::regnamespace
    UNION
    SELECT k.conrelid, n.adancime + 1 FROM n JOIN pg_constraint k ON k.confrelid = n.rel AND k.contype = 'f' AND k.conrelid <> n.rel
      JOIN pg_class c ON c.oid = n.rel
     WHERE n.adancime < 6
       AND NOT (c.relnamespace = 'public'::regnamespace
                AND (c.relname = ANY (coalesce(p_stop, '{}')) OR EXISTS (SELECT 1 FROM unnest(coalesce(p_prefixe, '{}')) x WHERE starts_with(c.relname::text, x)))))
  SELECT n.rel, c.relname::text, c.relnamespace = 'public'::regnamespace, min(n.adancime)::integer
    FROM n JOIN pg_class c ON c.oid = n.rel GROUP BY n.rel, c.relname, c.relnamespace
$h$;

CREATE FUNCTION pg_temp.t_cat_proiect_expr(p_rel oid, p_alias text DEFAULT 't', p_adancime integer DEFAULT 0)
RETURNS text LANGUAGE plpgsql STABLE AS $h$
DECLARE k record; v text; v_alias text := 'x' || (p_adancime + 1);
BEGIN
  IF p_rel = 'public.executie_proiecte'::regclass THEN RETURN p_alias || '.id'; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = p_rel AND attname = 'proiect_id' AND attnum > 0 AND NOT attisdropped
               AND atttypid IN ('int4'::regtype, 'int8'::regtype)) THEN
    RETURN p_alias || '.proiect_id';
  END IF;
  IF p_adancime >= 4 THEN RETURN NULL; END IF;
  FOR k IN SELECT c.confrelid, a.attname AS col, af.attname AS refcol
             FROM pg_constraint c
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
             JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
            WHERE c.conrelid = p_rel AND c.contype = 'f' AND cardinality(c.conkey) = 1 AND c.confrelid <> p_rel
            ORDER BY (c.confrelid = 'public.executie_proiecte'::regclass) DESC, a.attnotnull DESC, c.conname LOOP
    IF k.confrelid = 'public.executie_proiecte'::regclass THEN RETURN format('%s.%I', p_alias, k.col); END IF;
    v := pg_temp.t_cat_proiect_expr(k.confrelid, v_alias, p_adancime + 1);
    IF v IS NOT NULL THEN
      RETURN format('(SELECT %s FROM %s %s WHERE %s.%I = %s.%I)', v, k.confrelid::regclass, v_alias, v_alias, k.refcol, p_alias, k.col);
    END IF;
  END LOOP;
  RETURN NULL;
END $h$;

CREATE FUNCTION pg_temp.t_cat_vederi(p_baza oid[])
RETURNS TABLE (rel oid, nume text, invoker boolean, materializata boolean, citibila boolean) LANGUAGE sql STABLE AS $h$
  WITH RECURSIVE dep(rel) AS (
    SELECT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
     WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (p_baza) AND rw.ev_class <> d.refobjid
    UNION
    SELECT rw.ev_class FROM dep JOIN pg_depend d ON d.refobjid = dep.rel AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
      JOIN pg_rewrite rw ON rw.oid = d.objid WHERE rw.ev_class <> dep.rel)
  SELECT DISTINCT c.oid, c.relname::text,
         EXISTS (SELECT 1 FROM unnest(coalesce(c.reloptions, '{}'::text[])) o WHERE lower(o) IN ('security_invoker=on', 'security_invoker=true', 'security_invoker=1', 'security_invoker=yes')),
         c.relkind = 'm',
         has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')
    FROM dep JOIN pg_class c ON c.oid = dep.rel WHERE c.relkind IN ('v', 'm')
$h$;

CREATE FUNCTION pg_temp.t_cat_functii(p_nume text[])
RETURNS TABLE (fn regprocedure, nume text, amprenta text) LANGUAGE sql STABLE AS $h$
  SELECT p.oid::regprocedure, p.proname::text, md5(replace(p.prosrc, chr(13), ''))
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     AND cardinality(p_nume) > 0
     AND p.prosrc ~* ('\m(' || array_to_string(p_nume, '|') || ')\M')
$h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_cat_tabele(text[], text[]), pg_temp.t_cat_proiect_expr(oid, text, integer), pg_temp.t_cat_vederi(oid[]),
  pg_temp.t_cat_functii(text[]) TO authenticated, anon, service_role;
