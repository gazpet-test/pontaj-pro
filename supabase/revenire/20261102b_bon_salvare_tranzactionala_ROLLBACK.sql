-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261102b_bon_salvare_tranzactionala_ROLLBACK — NU e migrare. Două moduri, alese de date (r11, Jakarinos + Copilot r10):
--   • nicio creare n-a trecut prin RPC (cheie_operatie goală) → SCOATE TOT: RPC-urile fn_bon_salveaza / fn_bon_preia,
--     reface drepturile API de scriere pe linii (anon/authenticated = arwdxt, ca pe live), indexurile și coloana;
--   • există chei de operație → RETRAGERE: scoate RPC-urile și reface drepturile pe linii, dar PĂSTREAZĂ coloana
--     cheie_operatie și cele 2 indexuri (istoricul de idempotență nu se pierde: la o relivrare, un retry al aceleiași chei
--     găsește bonul). Migrarea acceptă relivrarea peste o retragere (precondiția 0b2).
-- UI-ul care cheamă RPC-urile (ConsumuriBonuriTab) se retrage ÎNAINTE (revert PR) — altfel salvarea / preluarea bonurilor
-- nu mai merge.
-- Refuză dacă funcțiile / indexurile / ACL-ul liniilor au fost modificate după migrare (amprenta din COMMENT) sau dacă alte
-- obiecte depind de ele.
-- Procedura (un singur string):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261102b', 'BON_RPC_SCOATE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $revenire$
DECLARE v_acum text; v_scrisa text; v_retragere boolean;
BEGIN
  IF current_setting('gazpet.revenire_20261102b', true) IS DISTINCT FROM 'BON_RPC_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261102b: nearmată (gazpet.revenire_20261102b legat de txid_current) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261102b: rulează ca postgres'; END IF;
  IF to_regprocedure('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)') IS NULL OR to_regprocedure('public.fn_bon_preia(bigint, timestamptz, jsonb)') IS NULL
     OR to_regclass('public.ux_bonc_cheie_operatie') IS NULL OR to_regclass('public.ux_bonc_proiect_numar') IS NULL THEN
    RAISE EXCEPTION 'Revenire 20261102b: fn_bon_salveaza / fn_bon_preia / indexurile nu există — nimic de scos';
  END IF;
  SELECT md5(string_agg(p.prosrc || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text
                        || '|' || pg_get_userbyid(p.proowner), '#' ORDER BY p.proname)
             || '|' || (SELECT pg_get_indexdef('public.ux_bonc_cheie_operatie'::regclass))
             || '|' || (SELECT pg_get_indexdef('public.ux_bonc_proiect_numar'::regclass))
             || '|' || (SELECT coalesce(c.relacl::text, '') FROM pg_class c WHERE c.oid = 'public.executie_bonuri_consum_linii'::regclass))
    INTO v_acum FROM pg_proc p WHERE p.oid IN ('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure,
                                               'public.fn_bon_preia(bigint, timestamptz, jsonb)'::regprocedure);
  v_scrisa := substring(obj_description('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)'::regprocedure, 'pg_proc') FROM 'amprenta=([0-9a-f]{32})');
  IF v_acum IS DISTINCT FROM v_scrisa THEN
    RAISE EXCEPTION 'Revenire 20261102b: funcțiile / indexurile / drepturile pe linii diferă de cele livrate (acum %, în COMMENT %) — refuz', v_acum, v_scrisa;
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- antetul întâi, apoi liniile (aceeași ordine ca RPC-urile)
  LOCK TABLE public.executie_bonuri_consum IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.executie_bonuri_consum_linii IN ACCESS EXCLUSIVE MODE;
  v_retragere := EXISTS (SELECT 1 FROM public.executie_bonuri_consum WHERE cheie_operatie IS NOT NULL);

  DROP FUNCTION public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb);   -- fără CASCADE: o dependență neașteptată anulează tot
  DROP FUNCTION public.fn_bon_preia(bigint, timestamptz, jsonb);
  -- drepturile API pe linii, ca înainte de migrare (precondiția 0g)
  GRANT INSERT, UPDATE, DELETE ON public.executie_bonuri_consum_linii TO anon, authenticated;
  IF NOT v_retragere THEN
    DROP INDEX public.ux_bonc_cheie_operatie;
    DROP INDEX public.ux_bonc_proiect_numar;
    ALTER TABLE public.executie_bonuri_consum DROP COLUMN cheie_operatie;
  ELSE
    RAISE NOTICE 'Revenire 20261102b: RETRAGERE — RPC-urile scoase, drepturile pe linii refăcute; coloana cheie_operatie și indexurile rămân (istoricul de idempotență)';
  END IF;

  IF to_regprocedure('public.fn_bon_salveaza(bigint, timestamptz, jsonb, jsonb)') IS NOT NULL OR to_regprocedure('public.fn_bon_preia(bigint, timestamptz, jsonb)') IS NOT NULL
     OR NOT has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.executie_bonuri_consum_linii', 'DELETE')
     OR (NOT v_retragere AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_bonuri_consum' AND column_name = 'cheie_operatie'))
     OR (v_retragere AND (to_regclass('public.ux_bonc_cheie_operatie') IS NULL OR to_regclass('public.ux_bonc_proiect_numar') IS NULL)) THEN
    RAISE EXCEPTION 'Revenire 20261102b: starea după revenire nu e cea așteptată';
  END IF;
  PERFORM set_config('gazpet.revenire_20261102b', '', true);
END
$revenire$;
