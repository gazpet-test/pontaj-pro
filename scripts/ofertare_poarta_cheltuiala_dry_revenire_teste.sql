-- Teste DRY pentru REVENIREA 20261124a (r5, review r4 Copilot P2-05 + review r5 Jakarinos P2-01/P2-02), PASUL 2: rulat ÎN tranzacția de
-- probă DUPĂ fișierul de revenire (se anulează: ROLLBACK). Compară arhiva cu fotografia independentă _dry_dovezi_908 făcută ÎNAINTE de
-- revenire (scripts/ofertare_poarta_cheltuiala_dry_revenire_inainte.sql) — fără ea, testul pică (nu ghicește cazul din starea de după).
--  (a) fotografia goală (revenire imediat după livrare): coloanele de dovadă au dispărut, tabelul de arhivă NU a fost creat;
--  (b) fotografia cu dovezi (ex. după scripts/ofertare_poarta_cheltuiala_dry_teste.sql: lic. 95 cu true ȘI false): arhiva conține EXACT
--      aceleași asocieri (licitație, rol, responsabil, numit de, dovadă) pentru revenirea curentă, în ambele sensuri, același număr;
--      RLS activ, o singură politică (SELECT, authenticated, doar owner), authenticated doar SELECT, anon nimic, UNIQUE exact
--      (revenire, licitatie_id, rol) cu coloane NOT NULL.
DO $t$
DECLARE v_n int; v_f int; v_rev text := '20261124a:' || txid_current();
BEGIN
  IF to_regclass('pg_temp._dry_dovezi_908') IS NULL THEN RAISE EXCEPTION 'REV0 lipseste fotografia _dry_dovezi_908 (pasul 1 nerulat)'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_licitatii'
               AND column_name IN ('responsabil_numitor_autorizat', 'responsabil2_numitor_autorizat')) THEN
    RAISE EXCEPTION 'REV1 coloanele de dovada au ramas pe ofertare_licitatii';
  END IF;
  IF to_regprocedure('public.fn_ofertare_poate_cheltui(bigint,uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_ofertare_poate_cheltui_fara_licitatie(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'REV1 functiile portii au ramas';
  END IF;
  SELECT count(*) INTO v_f FROM _dry_dovezi_908;
  IF v_f = 0 THEN
    IF to_regclass('public.ofertare_numiri_dovezi_arhiva') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.ofertare_numiri_dovezi_arhiva WHERE revenire = v_rev) THEN
      RAISE EXCEPTION 'REV2a fara dovezi inainte, dar arhiva are randuri pentru revenirea curenta';
    END IF;
    RAISE NOTICE 'REV OK (a): fara dovezi — coloane scoase, nimic arhivat';
    RETURN;
  END IF;
  -- (b) cu dovezi: arhiva trebuie să existe și să fie EXACT fotografia
  IF to_regclass('public.ofertare_numiri_dovezi_arhiva') IS NULL THEN RAISE EXCEPTION 'REV2 % dovezi inainte, dar arhiva lipseste (pierdute)', v_f; END IF;
  SELECT count(*) INTO v_n FROM public.ofertare_numiri_dovezi_arhiva WHERE revenire = v_rev;
  IF v_n <> v_f THEN RAISE EXCEPTION 'REV2 arhiva are % randuri, fotografia %', v_n, v_f; END IF;
  IF EXISTS (SELECT licitatie_id, rol, responsabil_id, numit_de, dovada FROM _dry_dovezi_908
             EXCEPT SELECT licitatie_id, rol, responsabil_id, numit_de, dovada FROM public.ofertare_numiri_dovezi_arhiva WHERE revenire = v_rev)
     OR EXISTS (SELECT licitatie_id, rol, responsabil_id, numit_de, dovada FROM public.ofertare_numiri_dovezi_arhiva WHERE revenire = v_rev
                EXCEPT SELECT licitatie_id, rol, responsabil_id, numit_de, dovada FROM _dry_dovezi_908) THEN
    RAISE EXCEPTION 'REV2 arhiva difera de fotografia de dinainte de revenire';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ofertare_numiri_dovezi_arhiva'::regclass) THEN RAISE EXCEPTION 'REV3 RLS oprit'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ofertare_numiri_dovezi_arhiva') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ofertare_numiri_dovezi_arhiva'
                      AND policyname = 'ofertare_numiri_dovezi_arhiva_owner_sel' AND cmd = 'SELECT' AND roles = '{authenticated}'
                      AND qual ~ 'is_owner IS TRUE' AND qual ~ 'auth\.uid\(\)') THEN
    RAISE EXCEPTION 'REV3 politicile arhivei nu sunt exact SELECT doar owner';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.ofertare_numiri_dovezi_arhiva', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ofertare_numiri_dovezi_arhiva', 'INSERT')
     OR has_table_privilege('authenticated', 'public.ofertare_numiri_dovezi_arhiva', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.ofertare_numiri_dovezi_arhiva', 'DELETE')
     OR has_table_privilege('anon', 'public.ofertare_numiri_dovezi_arhiva', 'SELECT')
     OR has_table_privilege('anon', 'public.ofertare_numiri_dovezi_arhiva', 'INSERT') THEN
    RAISE EXCEPTION 'REV3 privilegii gresite pe arhiva';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.ofertare_numiri_dovezi_arhiva'::regclass AND k.contype = 'u'
                   AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                         WHERE a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)) = ARRAY['licitatie_id', 'revenire', 'rol'])
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.ofertare_numiri_dovezi_arhiva'::regclass
                  AND a.attname IN ('licitatie_id', 'revenire', 'rol', 'dovada') AND NOT a.attnotnull) THEN
    RAISE EXCEPTION 'REV3 lipseste UNIQUE exact (revenire, licitatie_id, rol) / NOT NULL';
  END IF;
  RAISE NOTICE 'REV OK (b): % dovezi arhivate = fotografia exacta; RLS + politica owner + privilegii + UNIQUE exact', v_n;
END $t$;
