DO $diag_porti$
-- Portal E1 r19: DIAGNOSTICUL portilor 18a (scripts/portal/dry_prod_e1.sh --diagnostic-porti). Ruleaza in tranzactia
-- de diagnostic, imediat dupa copia 18a fara pasul 5 (postconditia), si inaintea garzii finale + ROLLBACK. Doar citeste
-- (catalogul si portal_public_baseline, creat in aceeasi tranzactie); nu scrie nimic, nu schimba setari.
-- Lista = UN singur apel al functiei portii (aceeasi pe care o verifica postconditia), tiparita element cu element:
--   DIAG_PORTI 18a: <N> porti lipsa      apoi N linii    DIAG_PORTI_LIPSA <i>: <poarta>
-- Detaliile (DIAG_PORTI_DETALIU) sunt doar ajutor de citire: lista autoritara e cea a functiei.
DECLARE
  v_lista text[]; v_x text; v_i integer := 0; v_rest text; r record; v_bl jsonb; v_viu jsonb;
BEGIN
  v_lista := public.fn_portal_porti_lipsa();
  IF v_lista IS NULL THEN
    RAISE NOTICE 'DIAG_PORTI 18a: NECUNOSCUT (functia portii a intors NULL)';
    RETURN;
  END IF;
  RAISE NOTICE 'DIAG_PORTI 18a: % porti lipsa', cardinality(v_lista);
  FOREACH v_x IN ARRAY v_lista LOOP
    v_i := v_i + 1;
    RAISE NOTICE 'DIAG_PORTI_LIPSA %: %', v_i, v_x;
    v_rest := substr(v_x, strpos(v_x, ':') + 1);
    IF v_x LIKE 'relatie:%' OR v_x LIKE 'secventa:%' THEN
      -- numele din poarta e fara schema: toate relatiile cu acest nume din schemele la care ajunge teren
      FOR r IN SELECT ns.nspname AS schema_rel, c.relkind::text AS tip_rel, pg_get_userbyid(c.relowner) AS owner_rel,
             c.oid AS oid_rel, coalesce(c.relacl::text, '(implicit al proprietarului)') AS acl_rel
          FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE c.relname = v_rest AND has_schema_privilege('teren', ns.oid, 'USAGE')
         ORDER BY ns.nspname COLLATE "C" LOOP
        RAISE NOTICE 'DIAG_PORTI_DETALIU %: %.% tip=% proprietar=% oid=% drepturi=%', v_i, r.schema_rel, v_rest,
          r.tip_rel, r.owner_rel, r.oid_rel, r.acl_rel;
      END LOOP;
    ELSIF v_x LIKE 'functie:%' THEN
      FOR r IN SELECT pg_get_userbyid(p.proowner) AS owner_fn, p.prosecdef AS definer_fn, p.oid AS oid_fn,
             coalesce(p.proacl::text, '(implicit: EXECUTE pentru PUBLIC)') AS acl_fn
          FROM pg_proc p WHERE p.oid = to_regprocedure(v_rest) LOOP
        RAISE NOTICE 'DIAG_PORTI_DETALIU %: % proprietar=% security_definer=% oid=% drepturi=%', v_i, v_rest,
          r.owner_fn, r.definer_fn, r.oid_fn, r.acl_fn;
      END LOOP;
    ELSIF v_x LIKE 'amprenta:%' THEN
      SELECT b.amprenta INTO v_bl FROM public.portal_public_baseline b WHERE b.semnatura = v_rest;
      IF v_rest LIKE 'rel:%' THEN
        v_viu := public.fn_portal_catalog_amprenta(to_regclass(substr(v_rest, 5)));
      ELSE
        SELECT jsonb_build_array(md5(pg_get_functiondef(p.oid)), p.prosecdef, p.proowner, p.proconfig, p.proacl)
          INTO v_viu FROM pg_proc p WHERE p.oid = to_regprocedure(v_rest);
      END IF;
      RAISE NOTICE 'DIAG_PORTI_DETALIU %: % fixat_la_inceputul_tranzactiei=% acum=%', v_i, v_rest,
        coalesce(v_bl::text, '(lipsa)'), coalesce(v_viu::text, '(obiectul nu mai exista)');
    END IF;
  END LOOP;
  -- Context (citire): schemele la care ajunge teren (prin PUBLIC), cele cu CREATE, versiunea pg_net.
  RAISE NOTICE 'DIAG_PORTI_CONTEXT scheme USAGE pentru teren: % (asteptat {information_schema,net,public})',
    (SELECT array_agg(ns.nspname::text ORDER BY ns.nspname COLLATE "C") FROM pg_namespace ns
      WHERE ns.nspname <> 'pg_catalog' AND ns.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('teren', ns.oid, 'USAGE'));
  RAISE NOTICE 'DIAG_PORTI_CONTEXT scheme CREATE pentru teren: % (asteptat NULL)',
    (SELECT array_agg(ns.nspname::text ORDER BY ns.nspname COLLATE "C") FROM pg_namespace ns
      WHERE ns.nspname !~ '^pg_(toast|temp)_' AND has_schema_privilege('teren', ns.oid, 'CREATE'));
  RAISE NOTICE 'DIAG_PORTI_CONTEXT pg_net: %',
    coalesce((SELECT e.extversion FROM pg_extension e WHERE e.extname = 'pg_net'), '(neinstalat)');
END $diag_porti$;
