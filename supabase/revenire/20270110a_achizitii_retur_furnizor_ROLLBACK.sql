-- Revenire 20270110a_achizitii_retur_furnizor. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate returul la furnizor din baza de date: trigger-ele noi de pe stocuri_miscari / stocuri / comenzi_furnizor_linii, tabelele
--   comenzi_furnizor_retururi / _receptii / _retur_alocari / _intentii, cele 28 de funcții, coloana intrare_reconciliata, CHECK-ul
--   intrata_stoc <= primita și CHECK-ul sensului retururilor; pune la loc CHECK-ul de tipuri de mișcare de dinainte și dreptul UPDATE pe TABEL al
--   lui authenticated pe comenzi_furnizor_linii (fără drepturi pe coloane). Corpurile funcțiilor existente nu au fost atinse de migrare
--   (verificat pe amprentă în migrare), deci nu se restaurează nimic acolo.
-- ORDINEA: ÎNTÂI se retrage interfața (PR2: recepția / predarea prin RPC, butonul Retur, ștergerea poziției prin RPC) și revine varianta din client a
--   lui intraInStoc / a recepției pe repere / a lui deleteStoc; apoi revenirea. Altfel ecranul nou cheamă RPC-uri care nu mai există.
-- REFUZĂ (nimic schimbat) dacă:
--   * există ORICE rând în tabelele noi (retururi, anulări, jurnalul recepțiilor — inclusiv soldurile inițiale și corecturile —, alocări, intenții)
--     sau mișcări de stoc retur_furnizor* / cu ref_tip comanda_furnizor_linie / comanda_furnizor_retur (L14: istoricul scris de calea nouă nu se
--     pierde prin revenire); numerele apar în mesaj; ce se face cu ele decide owner-ul, separat;
--   * amprenta COMPLETĂ a obiectelor migrării (blocul AMPRENTA, identic cu cel din postcondițiile migrării) diferă de constanta revizuită.
--   Lock-urile se iau ÎNAINTEA verificărilor (L14), NOWAIT, pe toate tabelele noi și pe cele atinse.
-- Liniile marcate intrare_reconciliata = true (scriptul de moștenire, linii noi) NU opresc revenirea: marcajul se pierde (se reface rulând din nou
--   scriptul după o re-aplicare); valorile cantitate_intrata_stoc rămân cum sunt (sensul lor nu se schimbă). Numărul apare în NOTICE.
-- LIVRAREA = prin runner, DOAR cu plafon (revenirile se livrează fără amprenta globală, docs/LIVRARE_L15_V2.md §9):
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270110a_achizitii_retur_furnizor_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270110120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Probe: scripts/pglite/test_achizitii_retur_local.mjs (aplicare → revenire → reaplicare, refuzurile, starea de dinainte).
DO $pre$
DECLARE v_plafon text; v_amp text; v_n bigint; v_rau text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270110a_achizitii_retur_furnizor_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270110a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270110a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270110a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270110a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270110a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.comenzi_furnizor_retururi') IS NULL OR to_regclass('public.comenzi_furnizor_receptii') IS NULL
     OR to_regclass('public.comenzi_furnizor_retur_alocari') IS NULL OR to_regclass('public.comenzi_furnizor_intentii') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor_linii'::regclass AND a.attname = 'intrare_reconciliata' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '20270110a revenire: starea nu e cea din 20270110a (obiectele migrarii lipsesc)';
  END IF;
  -- lock-urile ÎNAINTEA verificărilor (L14), NOWAIT, în ordinea L06 (comanda → linii → mișcări → stocuri → tabelele noi)
  LOCK TABLE public.comenzi_furnizor IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.comenzi_furnizor_linii IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.stocuri_miscari IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.stocuri IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.comenzi_furnizor_retururi, public.comenzi_furnizor_receptii, public.comenzi_furnizor_retur_alocari, public.comenzi_furnizor_intentii
    IN ACCESS EXCLUSIVE MODE NOWAIT;
  -- istoricul scris de calea nouă = refuz (după lock: numărători stabile)
  SELECT concat_ws(', ',
           CASE WHEN (SELECT count(*) FROM public.comenzi_furnizor_retururi) > 0 THEN (SELECT count(*) FROM public.comenzi_furnizor_retururi) || ' retururi / anulari' END,
           CASE WHEN (SELECT count(*) FROM public.comenzi_furnizor_receptii) > 0 THEN (SELECT count(*) FROM public.comenzi_furnizor_receptii) || ' randuri in jurnalul receptiilor' END,
           CASE WHEN (SELECT count(*) FROM public.comenzi_furnizor_retur_alocari) > 0 THEN (SELECT count(*) FROM public.comenzi_furnizor_retur_alocari) || ' alocari' END,
           CASE WHEN (SELECT count(*) FROM public.comenzi_furnizor_intentii) > 0 THEN (SELECT count(*) FROM public.comenzi_furnizor_intentii) || ' intentii' END,
           CASE WHEN (SELECT count(*) FROM public.stocuri_miscari m WHERE m.tip IN ('retur_furnizor', 'retur_furnizor_anulare')
                        OR m.ref_tip IN ('comanda_furnizor_linie', 'comanda_furnizor_retur')) > 0
                THEN (SELECT count(*) FROM public.stocuri_miscari m WHERE m.tip IN ('retur_furnizor', 'retur_furnizor_anulare')
                        OR m.ref_tip IN ('comanda_furnizor_linie', 'comanda_furnizor_retur')) || ' miscari de stoc ale caii noi' END)
    INTO v_rau;
  IF v_rau IS DISTINCT FROM '' THEN
    RAISE EXCEPTION '20270110a revenire: ISTORIC_NOU: %; revenirea le-ar pierde; nimic schimbat', v_rau;
  END IF;
  SELECT count(*) INTO v_n FROM public.comenzi_furnizor_linii l WHERE l.intrare_reconciliata;
  RAISE NOTICE '20270110a revenire: linii cu intrare_reconciliata = true (marcajul se pierde) = %', v_n;
  -- AMPRENTA_20270110a_INCEPUT
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'rel ' || c.relname || ' k=' || c.relkind::text || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
           || ' own=' || pg_get_userbyid(c.relowner) || ' acl=' || coalesce(c.relacl::text, '-') AS l
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii',
                         'comenzi_furnizor_retururi_id_seq', 'comenzi_furnizor_receptii_id_seq', 'comenzi_furnizor_retur_alocari_id_seq')
    UNION ALL
    SELECT 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull
           || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text
           || ' acl=' || coalesce(a.attacl::text, '-')
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii')
            OR (c.relname = 'comenzi_furnizor_linii' AND (a.attname = 'intrare_reconciliata' OR a.attacl IS NOT NULL)))
    UNION ALL
    SELECT 'con ' || c.relname || '.' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' defer=' || k.condeferrable
           || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype <> 'n' AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii')
            OR k.conname IN ('comenzi_furnizor_linii_intrata_sub_primita_check', 'stocuri_miscari_tip_check', 'stocuri_miscari_retur_furnizor_check'))
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' valid=' || i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii')
    UNION ALL
    SELECT 'pol ' || c.relname || '.' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roluri=' || (SELECT string_agg(CASE WHEN o = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(o) END, ',' ORDER BY 1) FROM unnest(p.polroles) o)
           || ' q=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' c=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('comenzi_furnizor_retururi', 'comenzi_furnizor_receptii', 'comenzi_furnizor_retur_alocari', 'comenzi_furnizor_intentii')
    UNION ALL
    SELECT 'trg ' || c.relname || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
       AND t.tgname IN ('trg_stoc_miscari_lock_iesire', 'trg_stoc_miscari_provenienta', 'trg_stoc_miscari_lock_stergere', 'trg_stoc_miscari_istoric_update',
                        'trg_stocuri_lock_stergere', 'trg_cfl_protectie', 'trg_cf_retururi_garda', 'trg_cf_retururi_golire', 'trg_cf_retur_alocari_garda',
                        'trg_cf_retur_alocari_golire', 'trg_cf_receptii_garda', 'trg_cf_receptii_golire', 'trg_cf_intentii_garda', 'trg_cf_intentii_golire')
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('fn_stoc_miscare_protejata', 'fn_cf_cantitate_valida_intern', 'fn_stoc_cheie', 'fn_stoc_cheie_lock', 'fn_stoc_blocheaza', 'fn_cf_drept_achizitii_intern',
         'fn_cf_este_owner_intern', 'fn_cf_dovada_receptie_intern', 'fn_cf_intentie_reia_intern', 'fn_cf_intentie_inchide_intern', 'fn_cf_linie_pregateste_intern',
         'fn_cf_de_inlocuit_intern', 'fn_cf_linie_verifica_intern', 'fn_stoc_miscari_lock_iesire', 'fn_stoc_miscari_provenienta', 'fn_stoc_miscari_garda_istoric',
         'fn_stocuri_lock_stergere', 'fn_cfl_protectie', 'fn_cf_retururi_garda', 'fn_cf_alocari_garda', 'fn_cf_jurnal_garda', 'fn_cf_receptie_adauga',
         'fn_cf_intra_stoc', 'fn_cf_retur_inregistreaza', 'fn_cf_retur_anuleaza', 'fn_cf_retur_inchide_fara_inlocuire', 'fn_cf_reconciliaza_linie',
         'fn_stoc_sterge_pozitie')
  ) x;
  -- AMPRENTA_20270110a_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM '0375c10450825f19574047add1fcd670' THEN
    RAISE NOTICE 'AMPRENTA_20270110a_TEXT %', v_amp;
    RAISE EXCEPTION '20270110a revenire: AMPRENTA obiectelor migrarii % (asteptat 0375c10450825f19574047add1fcd670): starea nu e cea din 20270110a; nimic schimbat',
      md5(coalesce(v_amp, ''));
  END IF;
END $pre$;

DROP TRIGGER trg_stoc_miscari_lock_iesire ON public.stocuri_miscari;
DROP TRIGGER trg_stoc_miscari_provenienta ON public.stocuri_miscari;
DROP TRIGGER trg_stoc_miscari_lock_stergere ON public.stocuri_miscari;
DROP TRIGGER trg_stoc_miscari_istoric_update ON public.stocuri_miscari;
DROP TRIGGER trg_stocuri_lock_stergere ON public.stocuri;
DROP TRIGGER trg_cfl_protectie ON public.comenzi_furnizor_linii;
DROP TABLE public.comenzi_furnizor_retur_alocari;
DROP TABLE public.comenzi_furnizor_retururi;
DROP TABLE public.comenzi_furnizor_receptii;
DROP TABLE public.comenzi_furnizor_intentii;
DROP FUNCTION public.fn_stoc_sterge_pozitie(bigint);
DROP FUNCTION public.fn_cf_reconciliaza_linie(uuid, bigint, numeric, text);
DROP FUNCTION public.fn_cf_retur_inchide_fara_inlocuire(uuid, bigint, text);
DROP FUNCTION public.fn_cf_retur_anuleaza(uuid, bigint, text);
DROP FUNCTION public.fn_cf_retur_inregistreaza(uuid, bigint, numeric, numeric, text, bigint, text, text, boolean);
DROP FUNCTION public.fn_cf_intra_stoc(uuid, bigint, numeric, boolean);
DROP FUNCTION public.fn_cf_receptie_adauga(uuid, bigint, numeric, numeric);
DROP FUNCTION public.fn_cf_jurnal_garda();
DROP FUNCTION public.fn_cf_alocari_garda();
DROP FUNCTION public.fn_cf_retururi_garda();
DROP FUNCTION public.fn_cfl_protectie();
DROP FUNCTION public.fn_stocuri_lock_stergere();
DROP FUNCTION public.fn_stoc_miscari_garda_istoric();
DROP FUNCTION public.fn_stoc_miscari_provenienta();
DROP FUNCTION public.fn_stoc_miscari_lock_iesire();
DROP FUNCTION public.fn_cf_linie_verifica_intern(bigint);
DROP FUNCTION public.fn_cf_de_inlocuit_intern(bigint);
DROP FUNCTION public.fn_cf_linie_pregateste_intern(bigint, boolean);
DROP FUNCTION public.fn_cf_intentie_inchide_intern(uuid, text, jsonb, jsonb);
DROP FUNCTION public.fn_cf_intentie_reia_intern(uuid, text, jsonb);
DROP FUNCTION public.fn_cf_dovada_receptie_intern(public.comenzi_furnizor_linii, public.comenzi_furnizor);
DROP FUNCTION public.fn_cf_este_owner_intern(uuid);
DROP FUNCTION public.fn_cf_drept_achizitii_intern(uuid);
DROP FUNCTION public.fn_stoc_blocheaza(text, bigint, text);
DROP FUNCTION public.fn_stoc_cheie_lock(text, bigint, text);
DROP FUNCTION public.fn_stoc_cheie(text, bigint, text);
DROP FUNCTION public.fn_cf_cantitate_valida_intern(numeric);
DROP FUNCTION public.fn_stoc_miscare_protejata(text, text);
ALTER TABLE public.stocuri_miscari DROP CONSTRAINT stocuri_miscari_retur_furnizor_check;
ALTER TABLE public.stocuri_miscari DROP CONSTRAINT stocuri_miscari_tip_check;
ALTER TABLE public.stocuri_miscari ADD CONSTRAINT stocuri_miscari_tip_check CHECK (tip = ANY (ARRAY['intrare_achizitie'::text, 'ajustare_plus'::text,
  'ajustare_minus'::text, 'transfer_out'::text, 'transfer_in'::text, 'consum_proiect'::text, 'corectie_initiala'::text]));
ALTER TABLE public.comenzi_furnizor_linii DROP CONSTRAINT comenzi_furnizor_linii_intrata_sub_primita_check;
ALTER TABLE public.comenzi_furnizor_linii DROP COLUMN intrare_reconciliata;
REVOKE UPDATE (comanda_furnizor_id, comanda_linie_id, denumire, um, cantitate, pret_unitar, termen_livrare, observatii, display_order)
  ON TABLE public.comenzi_furnizor_linii FROM authenticated;
GRANT UPDATE ON TABLE public.comenzi_furnizor_linii TO authenticated;

DO $post$
BEGIN
  IF to_regclass('public.comenzi_furnizor_retururi') IS NOT NULL OR to_regclass('public.comenzi_furnizor_receptii') IS NOT NULL
     OR to_regclass('public.comenzi_furnizor_retur_alocari') IS NOT NULL OR to_regclass('public.comenzi_furnizor_intentii') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor_linii'::regclass AND a.attname = 'intrare_reconciliata' AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace
                  AND k.conname IN ('comenzi_furnizor_linii_intrata_sub_primita_check', 'stocuri_miscari_retur_furnizor_check'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('trg_stoc_miscari_lock_iesire', 'trg_stoc_miscari_provenienta',
                  'trg_stoc_miscari_lock_stergere', 'trg_stoc_miscari_istoric_update', 'trg_stocuri_lock_stergere', 'trg_cfl_protectie'))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname IN ('fn_stoc_miscare_protejata', 'fn_cf_cantitate_valida_intern', 'fn_stoc_cheie', 'fn_stoc_cheie_lock', 'fn_stoc_blocheaza',
                    'fn_cf_drept_achizitii_intern', 'fn_cf_este_owner_intern', 'fn_cf_dovada_receptie_intern', 'fn_cf_intentie_reia_intern',
                    'fn_cf_intentie_inchide_intern', 'fn_cf_linie_pregateste_intern', 'fn_cf_de_inlocuit_intern', 'fn_cf_linie_verifica_intern',
                    'fn_stoc_miscari_lock_iesire', 'fn_stoc_miscari_provenienta', 'fn_stoc_miscari_garda_istoric', 'fn_stocuri_lock_stergere', 'fn_cfl_protectie',
                    'fn_cf_retururi_garda', 'fn_cf_alocari_garda', 'fn_cf_jurnal_garda', 'fn_cf_receptie_adauga', 'fn_cf_intra_stoc', 'fn_cf_retur_inregistreaza',
                    'fn_cf_retur_anuleaza', 'fn_cf_retur_inchide_fara_inlocuire', 'fn_cf_reconciliaza_linie', 'fn_stoc_sterge_pozitie')) THEN
    RAISE EXCEPTION '20270110a revenire: postconditie: obiectele migrarii au ramas';
  END IF;
  IF (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = 'public.stocuri_miscari'::regclass AND k.conname = 'stocuri_miscari_tip_check' AND k.convalidated)
       IS DISTINCT FROM 'CHECK ((tip = ANY (ARRAY[''intrare_achizitie''::text, ''ajustare_plus''::text, ''ajustare_minus''::text, ''transfer_out''::text, ''transfer_in''::text, ''consum_proiect''::text, ''corectie_initiala''::text])))' THEN
    RAISE EXCEPTION '20270110a revenire: postconditie: stocuri_miscari_tip_check nu e cel de dinainte';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.comenzi_furnizor_linii', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.comenzi_furnizor_linii', 'UPDATE WITH GRANT OPTION')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.comenzi_furnizor_linii'::regclass AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20270110a revenire: postconditie: drepturile authenticated pe comenzi_furnizor_linii nu sunt cele de dinainte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270110a_achizitii_retur_furnizor_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270110a revenire: garda final invalida';
  END IF;
END $post$;
