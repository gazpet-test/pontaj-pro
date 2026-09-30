-- ============================================================================
-- ROLLBACK TEHNIC pentru supabase/migrations/20260930i_sec_f1_truncate_revoke.sql (SEC F1, 30.09.2026).
--
-- ⚠ REVERT TEHNIC, NU EXACT: pentru tabelele create DUPĂ 30.09 nu reproduce o stare anterioară (le dă TRUNCATE ca și cum
--   setarea implicită veche ar fi fost în vigoare). NU se rulează automat (niciun runner/CI/cron) — doar manual, prin
--   scripts/livrare_migrare.sh, la decizia explicită a lui Răzvan.
--
-- ⚠ Readuce EXACT drepturile TRUNCATE de dinainte (starea citită read-only pe 30.09.2026: anon 332 tabele,
--   authenticated 344, 345 pentru cel puțin unul) și setarea implicită a lui postgres pe public — adică REDESCHIDE
--   gaura latentă. Fără GO de execuție: doar la decizia explicită a lui Răzvan, cu motivul consemnat, după review.
--   Nu există nicio revenire operațională necesară: nimic din aplicație nu folosește TRUNCATE ca anon/authenticated.
--
-- Tranzacția: același gestionar unic, scripts/livrare_migrare.sh (garda de livrare pe numele acestui fișier).
-- Metoda: GRANT pe toate relațiile, apoi REVOKE pe excepțiile de dinainte (cele 29 blindate pentru ambele roluri,
--   cele 13 pe care doar authenticated le avea, cea pe care doar anon o avea). Tabelele create DUPĂ 30.09 primesc și
--   ele TRUNCATE (ca și cum setarea implicită veche ar fi fost în vigoare) — consemnat în RAISE NOTICE.
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930i_sec_f1_truncate_revoke_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION 'Rollback 20260930i: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- 0. Precondiție: rollback-ul se aplică doar peste starea produsă de migrare (0 relații cu TRUNCATE pentru anon/authenticated)
DO $pre$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND (has_table_privilege('anon', c.oid, 'TRUNCATE') IS TRUE OR has_table_privilege('authenticated', c.oid, 'TRUNCATE') IS TRUE);
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Rollback 20260930i, precondiție: % relații au deja TRUNCATE pentru anon/authenticated — starea nu e cea de după migrare; se reanalizează', v_n;
  END IF;
END $pre$;

-- 1. Setarea implicită a lui postgres pe public: la loc (arwdDxtm pentru anon/authenticated, ca în 30.09)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO anon, authenticated;

-- 2. Drepturile pe relațiile existente: la loc, cu excepțiile de dinainte (tabelele dispărute între timp se sar, consemnat)
GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
DO $exceptii$
DECLARE
  -- 2a. cele 29 de tabele care NU aveau TRUNCATE pentru niciunul dintre roluri (30.09.2026)
  c_ambele text[] := ARRAY['_backup_analiza_plansa', '_backup_cantitati_29aug', '_backup_cantitati_domnesti_20260911',
    '_backup_categorii_haiku_20260911', '_backup_dedup_racari_20260911', '_backup_docs_alterate_29aug',
    '_backup_duplicate_cantitati_20260911', '_backup_hr_dedup_20260830', '_backup_hr_docpers_dedup_20260909',
    '_backup_ofertare_docs_20260910', '_backup_ofertare_licitatii_20260910', '_backup_word_text_20260911',
    'app_secrets', 'ofertare_cantitati_istoric', 'ofertare_cerinte_dovezi', 'ofertare_cerinte_subiect',
    'ofertare_cerinte_titular', 'ofertare_derogari_audit', 'ofertare_plansa_buget', 'ofertare_plansa_coada',
    'ofertare_pt_capitole_versiuni', 'ofertare_raspuns_set', 'ofertare_raspuns_set_doc', 'ofertare_seap_cereri',
    'ofertare_seap_fisiere', 'ofertare_source_pack', 'ofertare_source_pack_decizii', 'ofertare_source_pack_importuri',
    'ofertare_subiecte_regula'];
  -- 2b. cele 13 pe care doar authenticated le avea
  c_doar_auth text[] := ARRAY['ctc_carti', 'ctc_documente_carte', 'ctc_template_pozitii', 'ctc_templates', 'hr_formare_profesionala',
    'logistica_imprumuturi', 'ofertare_clarificari_puncte', 'ofertare_pt_afirmatii', 'ofertare_pt_capitole',
    'ofertare_pt_legaturi', 'ofertare_pt_observatii', 'ofertare_pt_poarta', 'ofertare_seap_manifest'];
  -- 2c. cea pe care doar anon o avea (REVOKE-ul făcut invers în 20260924, consemnat în advisors §3A)
  c_doar_anon text[] := ARRAY['ofertare_pt_pachet_fisiere'];
  v_t   text;
  v_n29 integer := 0;
  v_n13 integer := 0;
  v_n1  integer := 0;
BEGIN
  FOREACH v_t IN ARRAY c_ambele LOOP
    IF to_regclass('public.' || quote_ident(v_t)) IS NULL THEN
      RAISE NOTICE 'Rollback 20260930i: tabelul public.% nu mai există — sărit', v_t;
    ELSE
      EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon, authenticated', v_t);
      v_n29 := v_n29 + 1;
    END IF;
  END LOOP;
  FOREACH v_t IN ARRAY c_doar_auth LOOP
    IF to_regclass('public.' || quote_ident(v_t)) IS NULL THEN
      RAISE NOTICE 'Rollback 20260930i: tabelul public.% nu mai există — sărit', v_t;
    ELSE
      EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon', v_t);
      v_n13 := v_n13 + 1;
    END IF;
  END LOOP;
  FOREACH v_t IN ARRAY c_doar_anon LOOP
    IF to_regclass('public.' || quote_ident(v_t)) IS NULL THEN
      RAISE NOTICE 'Rollback 20260930i: tabelul public.% nu mai există — sărit', v_t;
    ELSE
      EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated', v_t);
      v_n1 := v_n1 + 1;
    END IF;
  END LOOP;
  -- valorile așteptate pentru postcondiție (pe 30.09.2026: 29 / 13 / 1 ⇒ anon 332, authenticated 344 din 374)
  PERFORM set_config('gazpet.sec_f1_rb_exceptii', v_n29::text || ',' || v_n13::text || ',' || v_n1::text, true);
END $exceptii$;

-- 3. Postcondiții: starea din 30.09 (excepțiile de mai sus scăzute din total; tabelele create ulterior au TRUNCATE pentru ambele)
DO $post$
DECLARE
  v_anon integer; v_auth integer; v_total integer; v_def integer;
  v_exc  integer[];
BEGIN
  v_exc := string_to_array(current_setting('gazpet.sec_f1_rb_exceptii', true), ',')::integer[];
  SELECT count(*) INTO v_total FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
  SELECT count(*) INTO v_anon FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege('anon', c.oid, 'TRUNCATE') IS TRUE;
  SELECT count(*) INTO v_auth FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege('authenticated', c.oid, 'TRUNCATE') IS TRUE;
  RAISE NOTICE 'Rollback 20260930i: % tabele în public; TRUNCATE anon=% authenticated=% (30.09.2026: 374 / 332 / 344)', v_total, v_anon, v_auth;
  IF v_exc IS NULL OR array_length(v_exc, 1) IS DISTINCT FROM 3
     OR v_anon IS DISTINCT FROM v_total - v_exc[1] - v_exc[2]
     OR v_auth IS DISTINCT FROM v_total - v_exc[1] - v_exc[3] THEN
    RAISE EXCEPTION 'Rollback 20260930i, postcondiție: anon=% authenticated=% din % tabele (excepții %) — nu e starea din 30.09; se anulează tot', v_anon, v_auth, v_total, v_exc;
  END IF;
  SELECT count(*) INTO v_def
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
   WHERE pg_get_userbyid(d.defaclrole)::text = 'postgres' AND n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND a.privilege_type = 'TRUNCATE' AND a.grantee <> 0 AND pg_get_userbyid(a.grantee)::text IN ('anon', 'authenticated');
  IF v_def IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Rollback 20260930i, postcondiție: setarea implicită a lui postgres pe public are % intrări TRUNCATE pentru anon/authenticated (așteptat 2)', v_def;
  END IF;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260930i_sec_f1_truncate_revoke_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION 'Rollback 20260930i: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
