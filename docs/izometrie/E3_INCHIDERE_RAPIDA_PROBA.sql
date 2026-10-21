-- Închiderea tranzitivă a citirilor: varianta E2a (referință) vs varianta rapidă (semi-naivă + o expresie per iterație).
-- READ ONLY. Întoarce timpii și dacă mulțimile c_rel / c_fn / c_mut sunt identice.
BEGIN;  -- doar tabele TEMP; ROLLBACK la final
CREATE TEMP TABLE _rez (k text, v text) ON COMMIT DROP;
DO $t$
DECLARE
  c_dinamice_revizuite text[] := ARRAY[
    '_completare_goleste_camp(bigint,text,integer)=888fde4d4e7fbea6889835dd96c2225d',
    '_completare_scrie_camp(bigint,text,text)=77d7b091a049ccc86b47d078957db39f',
    'fn_cont_inchide(uuid,text,text,integer)=c4a6ca93a52ca8a97aa90f168debf30e',
    'fn_cont_restaureaza_flaguri(uuid,jsonb)=ecd803a2dda6b734ea92ebaf10564397',
    'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',
    'fn_tichete_notif_on_insert()=1ffa41a8750b6d48d721d9e2a00b3f54'];
  c_st constant text := '(^|[^[:alnum:]_$"])"?';
  c_dr constant text := '"?($|[^[:alnum:]_$])';
  c_scheme_platforma constant text[] := ARRAY['auth','storage','realtime','extensions','graphql','graphql_public','vault','net',
                                              'supabase_functions','supabase_migrations','pgbouncer','pgsodium','pgsodium_masks','cron'];
  -- referință
  r_rel oid[]; r_fn oid[]; r_mut oid[] := '{}'; v_marime int; v_iter int;
  -- rapid
  q_rel oid[]; q_fn oid[]; q_mut oid[]; f_rel oid[]; f_fn oid[]; f_mut oid[]; n_rel oid[]; n_fn oid[]; n_mut oid[];
  p_cal text; p_neq text; p_plat jsonb; it int := 0;
  t0 timestamptz; t1 timestamptz;
BEGIN
  -- ── REFERINȚA (copia fidelă a buclei E2a r15) ──
  t0 := clock_timestamp();
  SELECT array_agg(c.oid) INTO r_rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari');
  SELECT coalesce(array_agg(p.oid), '{}') INTO r_fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
     AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
     AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '\mexecute\M'
     AND format('%s=%s', p.oid::regprocedure::text, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner)
                                                       || '|' || coalesce(p.proacl::text, '') || '|' || p.prosecdef::text))
         <> ALL (c_dinamice_revizuite);
  SELECT coalesce(array_agg(p.oid), '{}') INTO r_mut FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
     AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
     AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '(set_config|search_path)';
  v_marime := -1; v_iter := 0;
  WHILE cardinality(r_mut) <> v_marime AND v_iter < 100 LOOP
    v_marime := cardinality(r_mut); v_iter := v_iter + 1;
    r_mut := r_mut || ARRAY(
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL (SELECT p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') AS corp,
                                  (SELECT string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ',')
                                     FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) AS cale) x
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%') AND p.oid <> ALL (r_mut)
         AND EXISTS (SELECT 1 FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace
                      CROSS JOIN LATERAL (SELECT regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') AS nume) t
                      WHERE q.oid = ANY (r_mut)
                        AND (x.corp ~* (c_st || n2.nspname || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume || c_dr)
                             OR ((n2.nspname <> ALL (c_scheme_platforma) OR x.cale IS NULL OR n2.nspname = ANY (x.cale))
                                 AND x.corp ~* (c_st || t.nume || c_dr)))));
  END LOOP;
  v_marime := -1; v_iter := 0;
  WHILE cardinality(r_rel) + cardinality(r_fn) <> v_marime AND v_iter < 100 LOOP
    v_marime := cardinality(r_rel) + cardinality(r_fn); v_iter := v_iter + 1;
    r_rel := r_rel || ARRAY(SELECT DISTINCT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                             WHERE d.classid = 'pg_rewrite'::regclass
                               AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (r_rel))
                                    OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (r_fn)))
                               AND rw.ev_class <> ALL (r_rel));
    r_fn := r_fn || ARRAY(
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL (SELECT p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') AS corp) x0
       CROSS JOIN LATERAL (SELECT x0.corp,
                                  CASE WHEN p.oid = ANY (r_mut) THEN NULL
                                       ELSE (SELECT string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ',')
                                               FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) END AS cale) x
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%') AND p.oid <> ALL (r_fn) AND p.prolang NOT IN (12, 13)
         AND (EXISTS (SELECT 1 FROM (SELECT n2.nspname::text nsp, regexp_replace(c.relname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                                       FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE c.oid = ANY (r_rel)
                                     UNION
                                     SELECT n2.nspname::text, regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
                                       FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (r_fn)) t
                       WHERE x.corp ~* (c_st || t.nsp || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume || c_dr)
                          OR ((t.nsp <> ALL (c_scheme_platforma) OR x.cale IS NULL OR t.nsp = ANY (x.cale)) AND x.corp ~* (c_st || t.nume || c_dr)))
              OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                            AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (r_rel))
                                 OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (r_fn))))));
  END LOOP;
  t1 := clock_timestamp();
  INSERT INTO _rez VALUES ('ms_referinta', round(extract(epoch FROM t1 - t0) * 1000)::text), ('iter_referinta', v_iter::text);

  -- ── RAPID: semi-naiv (fiecare element nou se caută O DATĂ) + o singură expresie per iterație ──
  t0 := clock_timestamp();
  SELECT array_agg(c.oid) INTO q_rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari');
  SELECT coalesce(array_agg(p.oid), '{}') INTO q_fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
     AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
     AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '\mexecute\M'
     AND format('%s=%s', p.oid::regprocedure::text, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner)
                                                       || '|' || coalesce(p.proacl::text, '') || '|' || p.prosecdef::text))
         <> ALL (c_dinamice_revizuite);
  -- corpurile o singură dată
  CREATE TEMP TABLE _corp ON COMMIT DROP AS
    SELECT p.oid, n.nspname::text AS nsp, p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') AS corp,
           (SELECT string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ',')
              FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) AS cale_cfg
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
       AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%');
  SELECT coalesce(array_agg(oid), '{}') INTO q_mut FROM _corp WHERE corp ~* '(set_config|search_path)';
  f_mut := q_mut;
  WHILE cardinality(f_mut) > 0 AND it < 100 LOOP
    it := it + 1;
    -- expresiile frontierei: calificat (toate) / necalificat (scheme non-platformă) / necalificat pe schemă de platformă
    SELECT '(^|[^[:alnum:]_$"])"?(' || string_agg(n2.nspname || '"?[[:space:]]*\.[[:space:]]*"?' || regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') || ')"?($|[^[:alnum:]_$])',
           '(^|[^[:alnum:]_$"])"?(' || string_agg(regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') FILTER (WHERE n2.nspname <> ALL (c_scheme_platforma)) || ')"?($|[^[:alnum:]_$])'
      INTO p_cal, p_neq
      FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_mut);
    SELECT coalesce(jsonb_object_agg(s, '(^|[^[:alnum:]_$"])"?(' || nume || ')"?($|[^[:alnum:]_$])'), '{}') INTO p_plat
      FROM (SELECT n2.nspname::text s, string_agg(regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') nume
              FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_mut) AND n2.nspname = ANY (c_scheme_platforma)
             GROUP BY 1) z;
    n_mut := ARRAY(SELECT k.oid FROM _corp k WHERE k.oid <> ALL (q_mut)
                     AND (k.corp ~* p_cal OR (p_neq IS NOT NULL AND k.corp ~* p_neq)
                          OR EXISTS (SELECT 1 FROM jsonb_each_text(p_plat) e WHERE (k.cale_cfg IS NULL OR e.key = ANY (k.cale_cfg)) AND k.corp ~* e.value)));
    q_mut := q_mut || n_mut; f_mut := n_mut;
  END LOOP;
  f_rel := q_rel; f_fn := q_fn;
  WHILE (cardinality(f_rel) > 0 OR cardinality(f_fn) > 0) AND it < 200 LOOP
    it := it + 1;
    n_rel := ARRAY(SELECT DISTINCT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                    WHERE d.classid = 'pg_rewrite'::regclass
                      AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                           OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn)))
                      AND rw.ev_class <> ALL (q_rel));
    q_rel := q_rel || n_rel; f_rel := f_rel || n_rel;   -- view-urile noi intră în aceeași frontieră (ca în E2a: adăugate înaintea funcțiilor)
    WITH t AS (SELECT n2.nspname::text nsp, regexp_replace(c.relname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                 FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE c.oid = ANY (f_rel)
               UNION
               SELECT n2.nspname::text, regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
                 FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_fn))
    SELECT '(^|[^[:alnum:]_$"])"?(' || string_agg(nsp || '"?[[:space:]]*\.[[:space:]]*"?' || nume, '|') || ')"?($|[^[:alnum:]_$])',
           '(^|[^[:alnum:]_$"])"?(' || string_agg(nume, '|') FILTER (WHERE nsp <> ALL (c_scheme_platforma)) || ')"?($|[^[:alnum:]_$])',
           (SELECT coalesce(jsonb_object_agg(s, '(^|[^[:alnum:]_$"])"?(' || nn || ')"?($|[^[:alnum:]_$])'), '{}')
              FROM (SELECT nsp s, string_agg(nume, '|') nn FROM t WHERE nsp = ANY (c_scheme_platforma) GROUP BY 1) z)
      INTO p_cal, p_neq, p_plat FROM t;
    n_fn := ARRAY(SELECT k.oid FROM _corp k WHERE k.oid <> ALL (q_fn)
                    AND ((p_cal IS NOT NULL AND k.corp ~* p_cal) OR (p_neq IS NOT NULL AND k.corp ~* p_neq)
                         OR EXISTS (SELECT 1 FROM jsonb_each_text(p_plat) e
                                     WHERE (k.oid = ANY (q_mut) OR k.cale_cfg IS NULL OR e.key = ANY (k.cale_cfg)) AND k.corp ~* e.value)
                         OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = k.oid
                                       AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                                            OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn))))));
    q_fn := q_fn || n_fn;
    f_rel := '{}'; f_fn := n_fn;
  END LOOP;
  t1 := clock_timestamp();
  INSERT INTO _rez VALUES ('ms_rapid', round(extract(epoch FROM t1 - t0) * 1000)::text), ('iter_rapid', it::text),
    ('rel_identic', ((SELECT array_agg(x ORDER BY x) FROM unnest(r_rel) x) IS NOT DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(q_rel) x))::text),
    ('fn_identic', ((SELECT array_agg(x ORDER BY x) FROM unnest(r_fn) x) IS NOT DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(q_fn) x))::text),
    ('mut_identic', ((SELECT array_agg(x ORDER BY x) FROM unnest(r_mut) x) IS NOT DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(q_mut) x))::text),
    ('nr_rel', cardinality(q_rel)::text), ('nr_fn', cardinality(q_fn)::text), ('nr_mut', cardinality(q_mut)::text),
    ('definer_in_inchidere', (SELECT count(*) FROM pg_proc p WHERE p.oid = ANY (q_fn) AND p.prosecdef)::text);
END $t$;
SELECT string_agg(k || '=' || v, ' ' ORDER BY k) FROM _rez;
ROLLBACK;
