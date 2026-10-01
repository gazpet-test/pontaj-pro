-- ════════════════════════════════════════════════════════════════════════════
-- 20261006b_sec_garantii_iban — DRAFT, NEAPLICAT. IBAN-ul garanțiilor îl citesc DOAR cei care pot scrie garanții.
-- Vine DUPĂ 20261005b (#561): folosește helperul public.fn_poate_scrie_garantii() (owner ∨ superadmin/contabilitate/
--   admin_logistica ∨ financiar|financiar.garantii admin/editor). Helperul e deja pe live (citit 01.10: md5 e8ee20a0…).
-- Gaura (citită read-only pe live dxczwkbciseqniprspcu, 01.10.2026): garantii.iban (16 rânduri) e citibil de orice cont
--   logat prin 3 căi: (1) tabela garantii (SELECT pe tabel pentru anon/authenticated + politica SELECT auth.uid() IS NOT NULL),
--   (2) view-ul v_garantii_situatie (security_invoker, expune coloana iban), (3) RPC-ul garantii_adresa_eliberare(bigint)
--   (SECURITY DEFINER, EXECUTE authenticated) — pune IBAN-ul în textul adresei pentru formele depozit_bancar/trezorerie.
--   Nicio altă funcție/view din public nu citește garantii.iban (pg_depend + prosrc). v_garantii_plafon_emitent nu are IBAN.
-- Varianta aleasă (cea mai simplă care nu strică UI-ul — niciun ecran nu citește garantii.iban direct din tabel):
--   1. public.fn_garantie_iban(bigint) — SECDEF, STABLE, sql: IBAN-ul rândului dacă fn_poate_scrie_garantii(), altfel NULL.
--      EXECUTE: authenticated, service_role (nu PUBLIC/anon).
--   2. garantii: SELECT pe tabel retras de la anon/authenticated și redat PE COLOANE, toate în afară de iban (32 din 33).
--      Scrierea (INSERT/UPDATE/DELETE) neatinsă — rămâne guvernată de RLS-ul din 20261005b.
--   3. v_garantii_situatie: aceeași listă și ordine de coloane; „iban” devine public.fn_garantie_iban(g.id) (NULL pentru
--      cine nu poate scrie). security_invoker = on păstrat; ACL-ul view-ului neatins.
--   4. garantii_adresa_eliberare: corp identic, doar cele 2 apariții coalesce(g.iban,'___') ⇒ IBAN doar pentru scriitori
--      (ceilalți văd „___” în adresă). Semnătura, SECDEF, search_path și ACL neatinse.
-- Ecrane: Financiar › Garanții (GarantiiRegistru: view + RPC; IBAN-ul apare doar în tooltip-ul coloanei Formă și în textul
--   adresei), Ofertare › Registru garanție (OfertareGarantieRegistru: SELECT pe coloane explicite, fără iban — merge).
-- Neatins: contracte_terti.gbe_cont_iban (GbeEvidenta) — altă tabelă, în afara acestui patch (risc rezidual, separat).
-- Precondiții (fail-closed): postgres; helper exact (md5 + SECDEF + STABLE + search_path + fără EXECUTE anon/PUBLIC);
--   coloanele garantii exact cele live (md5 0cd06900…); SELECT pe tabel la anon/authenticated, fără ACL pe coloane;
--   view md5 e0457893… + security_invoker; RPC md5 3645ed09…; singura dependență de garantii.iban = v_garantii_situatie;
--   fn_garantie_iban nu există. Postcondiții: privilegii pe coloane exacte, amprente noi, ACL-uri.
-- Revenire (NU e migrare): supabase/revenire/20261006b_sec_garantii_iban_ROLLBACK.sql
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT. Gate 0e = 0.
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261006b_sec_garantii_iban:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261006b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
DECLARE v_n integer; v_s text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user; END IF;
  -- 0b. helperul din 20261005b, exact
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.proname = 'fn_poate_scrie_garantii';
  IF v_n <> 1 OR to_regprocedure('public.fn_poate_scrie_garantii()') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: public.fn_poate_scrie_garantii() lipsește sau are supraîncărcări (%) — 20261005b (#561) trebuie aplicată întâi', v_n;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_poate_scrie_garantii()'::regprocedure) IS DISTINCT FROM 'e8ee20a08440f3c93c763e4bff0670cf'
     OR NOT (SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.fn_poate_scrie_garantii()'::regprocedure)
     OR has_function_privilege('anon', 'public.fn_poate_scrie_garantii()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_poate_scrie_garantii()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Precondiție 0b: fn_poate_scrie_garantii() ≠ varianta live din 20261005b (md5 e8ee20a0…, SECDEF, STABLE, search_path, EXECUTE authenticated fără anon)';
  END IF;
  -- 0c. coloanele garantii = cele live
  SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) INTO v_s
    FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_s IS DISTINCT FROM '0cd06900cf48a7501cc00a57f9a24264' THEN
    RAISE EXCEPTION 'Precondiție 0c: coloanele public.garantii s-au schimbat (md5 % ≠ 0cd06900…) — lista de GRANT pe coloane trebuie refăcută', v_s;
  END IF;
  -- 0d. SELECT pe tabel la anon și authenticated; fără ACL pe coloane; PUBLIC fără SELECT
  IF NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.garantii'::regclass AND a.privilege_type = 'SELECT' AND a.grantee = 'anon'::regrole)
     OR NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.garantii'::regclass AND a.privilege_type = 'SELECT' AND a.grantee = 'authenticated'::regrole)
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.garantii'::regclass AND a.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'Precondiție 0d: ACL-ul garantii ≠ cel live (SELECT pe tabel pentru anon/authenticated, nimic pentru PUBLIC, fără ACL pe coloane)';
  END IF;
  -- 0e. view-ul și RPC-ul = cele live
  IF md5(pg_get_viewdef('public.v_garantii_situatie'::regclass)) IS DISTINCT FROM 'e0457893f4071bd3a63d247454c84fee'
     OR NOT coalesce((SELECT 'security_invoker=on' = ANY(reloptions) FROM pg_class WHERE oid = 'public.v_garantii_situatie'::regclass), false) THEN
    RAISE EXCEPTION 'Precondiție 0e: v_garantii_situatie ≠ varianta live (md5 e0457893…, security_invoker=on)';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.garantii_adresa_eliberare(bigint)')) IS DISTINCT FROM '3645ed09558cf2b347f5822cd4c76da4'
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'garantii_adresa_eliberare') <> 1 THEN
    RAISE EXCEPTION 'Precondiție 0e: garantii_adresa_eliberare(bigint) ≠ varianta live (md5 3645ed09…) sau are supraîncărcări';
  END IF;
  -- 0f. singura regulă (view) care depinde de garantii.iban = v_garantii_situatie; nicio altă funcție din public nu citește iban
  SELECT count(DISTINCT r.ev_class) INTO v_n FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
   WHERE d.refobjid = 'public.garantii'::regclass
     AND d.refobjsubid = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attname = 'iban')
     AND r.ev_class <> 'public.v_garantii_situatie'::regclass;
  IF v_n <> 0 THEN RAISE EXCEPTION 'Precondiție 0f: % view-uri noi depind de garantii.iban — se reanalizează', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc ILIKE '%iban%' AND p.prosrc ILIKE '%garantii%' AND p.proname <> 'garantii_adresa_eliberare';
  IF v_n <> 0 THEN RAISE EXCEPTION 'Precondiție 0f: % alte funcții citesc iban din garantii — se reanalizează', v_n; END IF;
  -- 0g. funcția nouă nu există (reaplicare = refuz)
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_garantie_iban') THEN
    RAISE EXCEPTION 'Precondiție 0g: fn_garantie_iban există deja — reaplicare sau coliziune de nume';
  END IF;
END $pre$;

-- 1. IBAN-ul unui rând, doar pentru cine poate scrie garanții (fără set_config / request.jwt / EXECUTE dinamic — gate 0e)
CREATE FUNCTION public.fn_garantie_iban(p_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT g.iban FROM public.garantii g WHERE g.id = p_id AND public.fn_poate_scrie_garantii();
$fn$;
REVOKE ALL ON FUNCTION public.fn_garantie_iban(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_garantie_iban(bigint) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_garantie_iban(bigint) IS 'IBAN-ul garanției doar pentru fn_poate_scrie_garantii(); altfel NULL (20261006b)';

-- 2. SELECT pe coloane: tot în afară de iban
REVOKE SELECT ON public.garantii FROM anon, authenticated;
GRANT SELECT (id, forma, tip, beneficiar, contract_numar, contract_data, lucrare, proiect_id, licitatie_id, valoare, moneda, procent, trezorerie_cont_id, banca, emitent, numar_document, data_emitere, data_expirare, stare, lucrare_receptionata, data_receptie, document_receptie, data_eliberare, eliberare_solicitata_la, sursa_document, observatii, created_at, updated_at, contract_terti_id, gbe_polita_id, blocat_litigiu, litigiu_detalii) ON public.garantii TO anon, authenticated;

-- 3. view-ul: aceeași formă, iban prin funcție
CREATE OR REPLACE VIEW public.v_garantii_situatie WITH (security_invoker = on) AS
 SELECT id,
    forma,
    tip,
    beneficiar,
    contract_numar,
    contract_data,
    lucrare,
    proiect_id,
    licitatie_id,
    valoare,
    moneda,
    procent,
    trezorerie_cont_id,
    public.fn_garantie_iban(g.id) AS iban,
    banca,
    emitent,
    numar_document,
    data_emitere,
    data_expirare,
    stare,
    lucrare_receptionata,
    data_receptie,
    document_receptie,
    data_eliberare,
    eliberare_solicitata_la,
    sursa_document,
    observatii,
    created_at,
    updated_at,
    (data_expirare - CURRENT_DATE) AS zile_pana_expirare,
        CASE
            WHEN (stare <> 'activa'::text) THEN NULL::text
            WHEN (lucrare_receptionata AND (eliberare_solicitata_la IS NULL)) THEN 'Lucrare receptionata - se poate cere eliberarea'::text
            WHEN ((data_expirare IS NOT NULL) AND (data_expirare < CURRENT_DATE) AND (NOT lucrare_receptionata)) THEN 'EXPIRATA dar lucrarea nu e receptionata - risc de garantie neacoperita'::text
            WHEN ((data_expirare IS NOT NULL) AND ((data_expirare - CURRENT_DATE) <= 30)) THEN 'Expira in sub 30 de zile'::text
            WHEN ((data_expirare IS NOT NULL) AND ((data_expirare - CURRENT_DATE) <= 60)) THEN 'Expira in sub 60 de zile'::text
            WHEN (eliberare_solicitata_la IS NOT NULL) THEN ('Eliberare ceruta la '::text || eliberare_solicitata_la)
            ELSE NULL::text
        END AS de_facut
   FROM public.garantii g;

-- 4. RPC-ul: IBAN doar pentru scriitori
CREATE OR REPLACE FUNCTION public.garantii_adresa_eliberare(p_id bigint)
 RETURNS TABLE(destinatar text, subiect text, corp text, avertisment text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    coalesce(g.emitent, g.banca, 'Trezoreria Municipiului Ploiesti'),
    'Solicitare eliberare garantie de buna executie – contract nr. ' ||
      coalesce(g.contract_numar, '___') || ' – ' || coalesce(g.lucrare, g.beneficiar),
    CASE WHEN g.blocat_litigiu THEN
      '⛔ Garantia e blocata de un litigiu in curs cu ' || g.beneficiar || '.' || E'\n\n' ||
      coalesce(g.litigiu_detalii || E'\n\n', '') ||
      'Nu se genereaza adresa de eliberare cat timp litigiul e deschis. ' ||
      'Daca litigiul s-a incheiat, scoate bifa de litigiu din fisa garantiei si genereaza adresa din nou.'
    ELSE
      'Catre, ' || coalesce(g.emitent, g.banca, 'Trezoreria Municipiului Ploiesti') || E'\n\n' ||
      'Subscrisa GAZPET INSTAL SRL, CUI RO22029920, cu sediul in Ploiesti, str. Fluturilor nr. 34, ' ||
      'jud. Prahova, reprezentata prin Trusu Razvan Mihail in calitate de administrator,' || E'\n\n' ||
      'Referitor la ' ||
        CASE g.forma
          WHEN 'polita_asigurare' THEN 'polita de asigurare pentru garantia de buna executie nr. ' || coalesce(g.numar_document,'___')
          WHEN 'scrisoare_bancara' THEN 'scrisoarea de garantie bancara nr. ' || coalesce(g.numar_document,'___')
          WHEN 'depozit_bancar' THEN 'depozitul pentru garantii de buna executie, cont ' || coalesce(CASE WHEN public.fn_poate_scrie_garantii() THEN g.iban END,'___')
          ELSE 'contul de disponibil din sume reprezentand garantie de buna executie ' || coalesce(CASE WHEN public.fn_poate_scrie_garantii() THEN g.iban END,'___')
        END ||
        coalesce(', constituit(a) la data de ' || to_char(g.data_emitere, 'DD.MM.YYYY'), '') ||
        coalesce(' cu scadenta ' || to_char(g.data_expirare, 'DD.MM.YYYY'), '') ||
        ', in favoarea ' || g.beneficiar ||
        ', pentru contractul nr. ' || coalesce(g.contract_numar,'___') ||
        coalesce('/' || to_char(g.contract_data, 'DD.MM.YYYY'), '') ||
        coalesce(' – „' || g.lucrare || '”', '') || ',' || E'\n\n' ||
      'va aducem la cunostinta ca lucrarile au fost receptionate' ||
        coalesce(' prin ' || g.document_receptie, '') ||
        coalesce(' din data de ' || to_char(g.data_receptie, 'DD.MM.YYYY'), '') ||
        ', iar obligatiile contractuale au fost indeplinite integral.' || E'\n\n' ||
      'Prin prezenta va solicitam eliberarea garantiei' ||
        coalesce(' in valoare de ' ||
          translate(trim(to_char(g.valoare, 'FM999,999,999.00')), ',.', '.,') || ' ' || g.moneda, '') ||
        ' si diminuarea corespunzatoare a expunerii inregistrate pe numele societatii noastre.' || E'\n\n' ||
      'Anexam documentele justificative.' || E'\n\n' ||
      'Cu stima,' || E'\n' ||
      'GAZPET INSTAL SRL' || E'\n' ||
      'Trusu Razvan Mihail, Administrator'
    END,
    CASE
      WHEN g.blocat_litigiu
        THEN 'BLOCAT DE LITIGIU — nu trimite nimic pana nu se lamureste.'
      WHEN NOT g.lucrare_receptionata AND g.data_receptie IS NOT NULL
        THEN 'Receptia e documentata (' || coalesce(g.document_receptie,'PV gasit') ||
             ') dar nu e inca bifata in fisa. Bifeaza „Receptie" inainte de a trimite.'
      WHEN NOT g.lucrare_receptionata
        THEN 'ATENTIE: lucrarea NU e marcata ca receptionata si nu avem niciun PV. Expirarea nu inseamna eliberare - cererea va fi respinsa.'
      WHEN g.document_receptie IS NULL
        THEN 'Lucrarea e marcata receptionata dar nu e trecut documentul de receptie (PVR/PVRTL). Completeaza-l inainte de a trimite.'
      WHEN g.document_receptie ILIKE '%PVRTL%' OR g.document_receptie ILIKE '%terminarea lucrarilor%'
        THEN 'Receptia e la TERMINAREA lucrarilor, nu finala - de regula se elibereaza doar 70%. Verifica ce procent ceri.'
      WHEN g.stare <> 'activa'
        THEN 'Garantia nu mai e activa (stare: ' || g.stare || '). Verifica daca adresa mai are rost.'
      ELSE NULL
    END
  FROM public.garantii g WHERE g.id = p_id;
$function$;

DO $post$
DECLARE v_n integer; v_s text;
BEGIN
  -- iban: nimeni dintre anon/authenticated/PUBLIC nu-l mai poate SELECT-a; restul coloanelor da; service_role neatins
  IF has_column_privilege('anon', 'public.garantii', 'iban', 'SELECT') OR has_column_privilege('authenticated', 'public.garantii', 'iban', 'SELECT')
     OR has_column_privilege('public', 'public.garantii', 'iban', 'SELECT') OR NOT has_column_privilege('service_role', 'public.garantii', 'iban', 'SELECT') THEN
    RAISE EXCEPTION 'Postcondiție 1: SELECT pe garantii.iban greșit (anon/authenticated/public trebuie fals, service_role adevărat)';
  END IF;
  SELECT count(*) INTO v_n FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'iban'
     AND NOT (has_column_privilege('anon', 'public.garantii', attname, 'SELECT') AND has_column_privilege('authenticated', 'public.garantii', attname, 'SELECT'));
  IF v_n <> 0 THEN RAISE EXCEPTION 'Postcondiție 2: % coloane (în afară de iban) nu mai sunt citibile de anon/authenticated', v_n; END IF;
  IF has_table_privilege('authenticated', 'public.garantii', 'SELECT') THEN RAISE EXCEPTION 'Postcondiție 2: SELECT pe tabel încă acordat'; END IF;
  IF NOT (has_table_privilege('authenticated', 'public.garantii', 'INSERT') AND has_table_privilege('authenticated', 'public.garantii', 'UPDATE')
          AND has_table_privilege('authenticated', 'public.garantii', 'DELETE')) THEN
    RAISE EXCEPTION 'Postcondiție 2: privilegiile de scriere ale lui authenticated s-au schimbat (trebuie neatinse — RLS decide)';
  END IF;
  -- funcția nouă
  IF NOT (SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.fn_garantie_iban(bigint)'::regprocedure)
     OR has_function_privilege('anon', 'public.fn_garantie_iban(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_garantie_iban(bigint)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.fn_garantie_iban(bigint)'::regprocedure AND a.grantee = 0) THEN
    RAISE EXCEPTION 'Postcondiție 3: fn_garantie_iban — atribute/ACL greșite';
  END IF;
  -- view: aceleași coloane, același tip, security_invoker, ACL
  SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) INTO v_s FROM pg_attribute WHERE attrelid = 'public.v_garantii_situatie'::regclass AND attnum > 0;
  IF md5(v_s) IS DISTINCT FROM md5((SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attnum > 0 AND NOT attisdropped AND attnum <= 29) || ',zile_pana_expirare:integer,de_facut:text') THEN
    RAISE EXCEPTION 'Postcondiție 4: coloanele v_garantii_situatie s-au schimbat: %', v_s;
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=on' = ANY(reloptions) FROM pg_class WHERE oid = 'public.v_garantii_situatie'::regclass), false)
     OR pg_get_viewdef('public.v_garantii_situatie'::regclass) !~ 'fn_garantie_iban\((g\.)?id\) AS iban'
     OR NOT has_table_privilege('authenticated', 'public.v_garantii_situatie', 'SELECT') THEN
    RAISE EXCEPTION 'Postcondiție 4: v_garantii_situatie — security_invoker / iban prin funcție / SELECT authenticated';
  END IF;
  -- RPC
  SELECT md5(prosrc) INTO v_s FROM pg_proc WHERE oid = 'public.garantii_adresa_eliberare(bigint)'::regprocedure;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.garantii_adresa_eliberare(bigint)'::regprocedure) ~ 'coalesce\(g\.iban'
     OR NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = 'public.garantii_adresa_eliberare(bigint)'::regprocedure)
     OR has_function_privilege('anon', 'public.garantii_adresa_eliberare(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.garantii_adresa_eliberare(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție 5: garantii_adresa_eliberare — mai citește g.iban direct sau atribute/ACL schimbate';
  END IF;
  RAISE NOTICE '20261006b după: RPC md5 %, view md5 %', v_s, md5(pg_get_viewdef('public.v_garantii_situatie'::regclass));
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261006b_sec_garantii_iban:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261006b: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
