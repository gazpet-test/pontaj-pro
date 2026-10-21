-- Generat de gen_e3.py: închiderea citirilor din poarta E2a (20261102a, exact) și din poarta E3 (20261103b, exact),
-- ca funcții de test INVOKER (doar în baza *_test), pentru testul diferențial din scripts/test_izometrie_e3.sh.
CREATE FUNCTION teste.inchidere_veche(OUT o_rel oid[], OUT o_fn oid[], OUT o_mut oid[], OUT o_mesaje text[])
  LANGUAGE plpgsql STABLE AS $t$
DECLARE v text[] := '{}';
BEGIN
    DECLARE
      c_rel oid[]; c_fn oid[] := '{}'; v_marime int := -1; v_iter int := 0; c_mut oid[] := '{}';
      -- funcțiile DEFINER cu SQL dinamic revizuite pe live (docs/izometrie/E2A_INVENTAR_CITIRI.md, 21.10.2026): tabele fixe
      -- (executie_proiecte / profiles), identificatori pe listă albă. Amprenta excepției = md5(prosrc | proconfig | owner |
      -- proacl | prosecdef) (Jakarinos r12): orice schimbare de corp, search_path, owner sau drepturi cere review
      c_dinamice_revizuite text[] := ARRAY[
        '_completare_goleste_camp(bigint,text,integer)=888fde4d4e7fbea6889835dd96c2225d',
        '_completare_scrie_camp(bigint,text,text)=77d7b091a049ccc86b47d078957db39f',
        'fn_cont_inchide(uuid,text,text,integer)=c4a6ca93a52ca8a97aa90f168debf30e',
        'fn_cont_restaureaza_flaguri(uuid,jsonb)=ecd803a2dda6b734ea92ebaf10564397',
        'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',
        'fn_tichete_notif_on_insert()=1ffa41a8750b6d48d721d9e2a00b3f54'];
      -- limitele unui identificator, inclusiv citat („"teste".f()”), fără \m / \M (ghilimelele nu sunt caractere de cuvânt)
      c_st constant text := '(^|[^[:alnum:]_$"])"?';
      c_dr constant text := '"?($|[^[:alnum:]_$])';
      -- schemele platformei Supabase: obiectele lor din închidere (funcții INVOKER cu SQL dinamic: realtime.cast, storage.search…)
      -- se potrivesc necalificat DOAR când schema e în search_path-ul funcției; ale noastre (orice altă schemă) se potrivesc
      -- necalificat ÎNTOTDEAUNA — conservator, fals-pozitivele sunt acceptate (Copilot r12 P1)
      c_scheme_platforma constant text[] := ARRAY['auth','storage','realtime','extensions','graphql','graphql_public','vault','net',
                                                  'supabase_functions','supabase_migrations','pgbouncer','pgsodium','pgsodium_masks','cron'];
    BEGIN
      SELECT array_agg(c.oid) INTO c_rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari');
      -- funcțiile cu SQL dinamic (orice EXECUTE), în afara registrului și a listei revizuite: în închidere de la început
      SELECT coalesce(array_agg(p.oid), '{}') INTO c_fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
         AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '\mexecute\M'
         AND format('%s=%s', p.oid::regprocedure::text, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner)
                                                           || '|' || coalesce(p.proacl::text, '') || '|' || p.prosecdef::text))
             <> ALL (c_dinamice_revizuite);
      -- r15 (Jakarinos + Copilot r14): funcțiile „mutator” — pot schimba calea de căutare a tranzacției: corpul conține
      -- set_config (ORICE argumente, inclusiv variabile) sau textul search_path; până la punct fix, orice funcție care
      -- numește un mutator (calificat, sau necalificat cu regulile de mai jos) devine și ea mutator. Un mutator are calea
      -- NECUNOSCUTĂ, chiar dacă are search_path în proconfig (r14 trata doar set_config('search_path', …) literal)
      SELECT coalesce(array_agg(p.oid), '{}') INTO c_mut FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
         AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '(set_config|search_path)';
      WHILE cardinality(c_mut) <> v_marime AND v_iter < 100 LOOP
        v_marime := cardinality(c_mut); v_iter := v_iter + 1;
        c_mut := c_mut || ARRAY(
          SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL (SELECT p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') AS corp,
                                      (SELECT string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ',')
                                         FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) AS cale) x
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
             AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%') AND p.oid <> ALL (c_mut)
             AND EXISTS (SELECT 1 FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace
                          CROSS JOIN LATERAL (SELECT regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') AS nume) t
                          WHERE q.oid = ANY (c_mut)
                            AND (x.corp ~* (c_st || n2.nspname || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume || c_dr)
                                 OR ((n2.nspname <> ALL (c_scheme_platforma) OR x.cale IS NULL OR n2.nspname = ANY (x.cale))
                                     AND x.corp ~* (c_st || t.nume || c_dr)))));
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'propagarea mutatorilor de cale nu converge (citire nerevizuită)'); END IF;
      v_marime := -1; v_iter := 0;
      WHILE cardinality(c_rel) + cardinality(c_fn) <> v_marime AND v_iter < 100 LOOP
        v_marime := cardinality(c_rel) + cardinality(c_fn); v_iter := v_iter + 1;
        -- view-urile: dependențe din pg_rewrite spre pg_class (relații) / pg_proc (funcții) — cataloagele explicite (Jak r12 P3)
        c_rel := c_rel || ARRAY(SELECT DISTINCT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                                 WHERE d.classid = 'pg_rewrite'::regclass
                                   AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (c_rel))
                                        OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (c_fn)))
                                   AND rw.ev_class <> ALL (c_rel));
        -- funcțiile: corpul numește ceva din închidere — calificat (schema.nume, și citat) sau necalificat (pentru schemele
        -- platformei: doar dacă schema e în search_path-ul FUNCȚIEI) — Jak + Copilot r12; sau depind de el în catalog (BEGIN ATOMIC)
        c_fn := c_fn || ARRAY(
          SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL (SELECT p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') AS corp) x0
           -- calea de căutare a funcției: cea fixată în proconfig; NECUNOSCUTĂ (NULL) dacă nu e fixată — funcția moștenește calea
           -- apelantului (r14) — sau dacă e mutator, direct sau prin ce cheamă (r15)
           CROSS JOIN LATERAL (SELECT x0.corp,
                                      CASE WHEN p.oid = ANY (c_mut) THEN NULL   -- mutator (r15): calea poate fi schimbată în tranzacție
                                           ELSE (SELECT string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ',')
                                                   FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) END AS cale) x
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
             AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%') AND p.oid <> ALL (c_fn) AND p.prolang NOT IN (12, 13)
             AND (EXISTS (SELECT 1 FROM (SELECT n2.nspname::text nsp, regexp_replace(c.relname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                                           FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE c.oid = ANY (c_rel)
                                         UNION
                                         SELECT n2.nspname::text, regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
                                           FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (c_fn)) t
                           WHERE x.corp ~* (c_st || t.nsp || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume || c_dr)
                              OR ((t.nsp <> ALL (c_scheme_platforma) OR x.cale IS NULL OR t.nsp = ANY (x.cale)) AND x.corp ~* (c_st || t.nume || c_dr)))
                  OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                                AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (c_rel))
                                     OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (c_fn))))));
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;
      o_rel := c_rel; o_fn := c_fn; o_mut := c_mut; o_mesaje := v;
    END;

END $t$;

CREATE FUNCTION teste.inchidere_noua(OUT o_rel oid[], OUT o_fn oid[], OUT o_mut oid[], OUT o_mesaje text[])
  LANGUAGE plpgsql STABLE AS $t$
DECLARE v text[] := '{}';
BEGIN
    DECLARE
      c_rel oid[]; c_fn oid[] := '{}'; v_marime int := -1; v_iter int := 0; c_mut oid[] := '{}';
      -- funcțiile DEFINER cu SQL dinamic revizuite pe live (docs/izometrie/E2A_INVENTAR_CITIRI.md, 21.10.2026): tabele fixe
      -- (executie_proiecte / profiles), identificatori pe listă albă. Amprenta excepției = md5(prosrc | proconfig | owner |
      -- proacl | prosecdef) (Jakarinos r12): orice schimbare de corp, search_path, owner sau drepturi cere review
      c_dinamice_revizuite text[] := ARRAY[
        '_completare_goleste_camp(bigint,text,integer)=888fde4d4e7fbea6889835dd96c2225d',
        '_completare_scrie_camp(bigint,text,text)=77d7b091a049ccc86b47d078957db39f',
        'fn_cont_inchide(uuid,text,text,integer)=c4a6ca93a52ca8a97aa90f168debf30e',
        'fn_cont_restaureaza_flaguri(uuid,jsonb)=ecd803a2dda6b734ea92ebaf10564397',
        'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',
        'fn_tichete_notif_on_insert()=1ffa41a8750b6d48d721d9e2a00b3f54'];
      -- limitele unui identificator, inclusiv citat („"teste".f()”), fără \m / \M (ghilimelele nu sunt caractere de cuvânt)
      c_st constant text := '(^|[^[:alnum:]_$"])"?';
      c_dr constant text := '"?($|[^[:alnum:]_$])';
      -- schemele platformei Supabase: obiectele lor din închidere (funcții INVOKER cu SQL dinamic: realtime.cast, storage.search…)
      -- se potrivesc necalificat DOAR când schema e în search_path-ul funcției; ale noastre (orice altă schemă) se potrivesc
      -- necalificat ÎNTOTDEAUNA — conservator, fals-pozitivele sunt acceptate (Copilot r12 P1)
      c_scheme_platforma constant text[] := ARRAY['auth','storage','realtime','extensions','graphql','graphql_public','vault','net',
                                                  'supabase_functions','supabase_migrations','pgbouncer','pgsodium','pgsodium_masks','cron'];
      -- r5d (20261103b): aceeași semantică, evaluare SEMI-NAIVĂ — fiecare element nou al închiderii se caută o singură dată,
      -- cu o singură expresie per iterație (alternanța numelor din frontieră); corpurile se citesc o dată
      k_oid oid[]; k_corp text[]; k_cale text[]; f_rel oid[]; f_fn oid[]; f_mut oid[]; n_rel oid[]; n_fn oid[]; n_mut oid[];
      p_cal text; p_neq text; p_plat jsonb;
    BEGIN
      SELECT array_agg(c.oid) INTO c_rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari');
      -- funcțiile cu SQL dinamic (orice EXECUTE), în afara registrului și a listei revizuite: în închidere de la început
      SELECT coalesce(array_agg(p.oid), '{}') INTO c_fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
         AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '\mexecute\M'
         AND format('%s=%s', p.oid::regprocedure::text, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner)
                                                           || '|' || coalesce(p.proacl::text, '') || '|' || p.prosecdef::text))
             <> ALL (c_dinamice_revizuite);
      -- corpurile candidate (orice schemă non-sistem, în afara public.fn_izo_*), o singură dată; calea fixată în proconfig
      -- (NULL = necunoscută: funcția moștenește calea apelantului)
      SELECT coalesce(array_agg(p.oid ORDER BY p.oid), '{}'),
             coalesce(array_agg(p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') ORDER BY p.oid), '{}'),
             coalesce(array_agg((SELECT array_to_string(string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ','), ',')
                                   FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) ORDER BY p.oid), '{}')
        INTO k_oid, k_corp, k_cale
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%');
      -- mutatorii de cale (r15): sămânța = corp cu set_config / search_path; propagați până la punct fix
      SELECT coalesce(array_agg(k.oid), '{}') INTO c_mut FROM unnest(k_oid, k_corp) k(oid, corp) WHERE k.corp ~* '(set_config|search_path)';
      f_mut := c_mut; v_iter := 0;
      WHILE cardinality(f_mut) > 0 AND v_iter < 100 LOOP
        v_iter := v_iter + 1;
        SELECT c_st || '(' || string_agg(n2.nspname || '"?[[:space:]]*\.[[:space:]]*"?' || regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') || ')' || c_dr,
               c_st || '(' || string_agg(regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') FILTER (WHERE n2.nspname <> ALL (c_scheme_platforma)) || ')' || c_dr
          INTO p_cal, p_neq
          FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_mut);
        SELECT coalesce(jsonb_object_agg(z.s, c_st || '(' || z.nume || ')' || c_dr), '{}') INTO p_plat
          FROM (SELECT n2.nspname::text s, string_agg(regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') nume
                  FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace
                 WHERE q.oid = ANY (f_mut) AND n2.nspname = ANY (c_scheme_platforma) GROUP BY 1) z;
        n_mut := ARRAY(SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale) WHERE k.oid <> ALL (c_mut)
                         AND (k.corp ~* p_cal OR (p_neq IS NOT NULL AND k.corp ~* p_neq)
                              OR EXISTS (SELECT 1 FROM jsonb_each_text(p_plat) e
                                          WHERE (k.cale IS NULL OR e.key = ANY (string_to_array(k.cale, ','))) AND k.corp ~* e.value)));
        c_mut := c_mut || n_mut; f_mut := n_mut;
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'propagarea mutatorilor de cale nu converge (citire nerevizuită)'); END IF;
      -- închiderea: frontiera = elementele adăugate în iterația precedentă (view-urile noi intră în frontiera aceleiași iterații,
      -- ca în E2a, unde sunt adăugate înaintea funcțiilor)
      f_rel := c_rel; f_fn := c_fn; v_iter := 0;
      WHILE (cardinality(f_rel) > 0 OR cardinality(f_fn) > 0) AND v_iter < 100 LOOP
        v_iter := v_iter + 1;
        n_rel := ARRAY(SELECT DISTINCT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                        WHERE d.classid = 'pg_rewrite'::regclass
                          AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                               OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn)))
                          AND rw.ev_class <> ALL (c_rel));
        c_rel := c_rel || n_rel; f_rel := f_rel || n_rel;
        p_cal := NULL; p_neq := NULL; p_plat := '{}';
        WITH t AS (SELECT n2.nspname::text nsp, regexp_replace(c.relname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                     FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE c.oid = ANY (f_rel)
                   UNION
                   SELECT n2.nspname::text, regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
                     FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_fn))
        SELECT c_st || '(' || string_agg(t.nsp || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume, '|') || ')' || c_dr,
               c_st || '(' || string_agg(t.nume, '|') FILTER (WHERE t.nsp <> ALL (c_scheme_platforma)) || ')' || c_dr,
               (SELECT coalesce(jsonb_object_agg(z.s, c_st || '(' || z.nn || ')' || c_dr), '{}')
                  FROM (SELECT t2.nsp s, string_agg(t2.nume, '|') nn FROM t t2 WHERE t2.nsp = ANY (c_scheme_platforma) GROUP BY 1) z)
          INTO p_cal, p_neq, p_plat FROM t;
        n_fn := ARRAY(SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale) WHERE k.oid <> ALL (c_fn)
                        AND ((p_cal IS NOT NULL AND k.corp ~* p_cal) OR (p_neq IS NOT NULL AND k.corp ~* p_neq)
                             -- schemele platformei: necalificat doar dacă schema e în calea funcției; calea e necunoscută dacă nu e
                             -- fixată SAU dacă funcția e mutator (r15)
                             OR EXISTS (SELECT 1 FROM jsonb_each_text(coalesce(p_plat, '{}')) e
                                         WHERE (k.oid = ANY (c_mut) OR k.cale IS NULL OR e.key = ANY (string_to_array(k.cale, ','))) AND k.corp ~* e.value)
                             OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = k.oid
                                           AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                                                OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn))))));
        c_fn := c_fn || n_fn;
        f_rel := n_rel; f_fn := n_fn;
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;
      o_rel := c_rel; o_fn := c_fn; o_mut := c_mut; o_mesaje := v;
    END;

END $t$;
