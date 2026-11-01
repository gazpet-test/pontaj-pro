-- Teste DRY pentru REVENIREA 20261124a (r5, review r4 Copilot P2-05), rulate ÎN tranzacția de probă DUPĂ fișierul de revenire (se anulează:
-- ROLLBACK). Două cazuri, după ce era în bază înainte de revenire:
--  (a) fără dovezi de numire (revenire imediat după livrare): coloanele de dovadă au dispărut, tabelul de arhivă NU a fost creat;
--  (b) cu dovezi (ex. după scripts/ofertare_poarta_cheltuiala_dry_teste.sql, care numește pe lic. 95 cu dovadă true ȘI false):
--      arhiva are asocierea completă (licitație, rol 1/2, responsabil, numit de, dovadă) pentru revenirea curentă, RLS activ, o singură
--      politică (SELECT, doar owner), authenticated doar SELECT, anon nimic, constrângerea UNIQUE (revenire, licitatie_id, rol).
-- Cazul se alege singur: tabelul există (b) sau nu (a). Rularea:  psql ... -f <migrare> -f <teste> -f <revenire> -f <acest fișier>.
DO $t$
DECLARE v_n int; v_rev text := '20261124a:' || txid_current();
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ofertare_licitatii'
               AND column_name IN ('responsabil_numitor_autorizat', 'responsabil2_numitor_autorizat')) THEN
    RAISE EXCEPTION 'REV1 coloanele de dovada au ramas pe ofertare_licitatii';
  END IF;
  IF to_regprocedure('public.fn_ofertare_poate_cheltui(bigint,uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_ofertare_poate_cheltui_fara_licitatie(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'REV1 functiile portii au ramas';
  END IF;
  IF to_regclass('public.ofertare_numiri_dovezi_arhiva') IS NULL THEN
    RAISE NOTICE 'REV OK (a): fara dovezi — coloane scoase, nicio arhiva creata';
    RETURN;
  END IF;
  -- (b) cu dovezi
  SELECT count(*) INTO v_n FROM public.ofertare_numiri_dovezi_arhiva WHERE revenire = v_rev;
  IF v_n = 0 THEN RAISE EXCEPTION 'REV2 arhiva exista, dar fara randuri pentru revenirea curenta'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_numiri_dovezi_arhiva WHERE revenire = v_rev AND dovada IS TRUE)
     OR NOT EXISTS (SELECT 1 FROM public.ofertare_numiri_dovezi_arhiva WHERE revenire = v_rev AND dovada IS FALSE) THEN
    RAISE EXCEPTION 'REV2 arhiva nu pastreaza si dovezile true si pe cele false (asteptat dupa TEST3 pe lic. 95)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofertare_numiri_dovezi_arhiva WHERE revenire = v_rev
               AND (rol NOT IN (1, 2) OR licitatie_id IS NULL OR dovada IS NULL)) THEN
    RAISE EXCEPTION 'REV2 asociere incompleta in arhiva';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ofertare_numiri_dovezi_arhiva'::regclass) THEN RAISE EXCEPTION 'REV3 RLS oprit'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ofertare_numiri_dovezi_arhiva') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ofertare_numiri_dovezi_arhiva'
                      AND cmd = 'SELECT' AND roles = '{authenticated}' AND qual ~ 'is_owner') THEN
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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ofertare_numiri_dovezi_arhiva'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'REV3 lipseste UNIQUE (revenire, licitatie_id, rol)';
  END IF;
  RAISE NOTICE 'REV OK (b): % dovezi arhivate (true si false), RLS + politica owner + privilegii + UNIQUE', v_n;
END $t$;
