-- Revenire 20270108a_executie_dcc_registru. NEAPLICAT (ca și migrarea). Fără GO de execuție: doar la cererea explicită a proprietarului
-- (supabase/revenire/README.md). Scoate TOT ce a creat migrarea: vederea v_dcc_registru, cele 17 tabele dcc_* (cu politicile, triggerele, cheile,
-- indecșii și secvențele lor) și cele 57 de funcții fn_dcc_*. Tabelele și funcțiile existente (executie_proiecte, profiles, user_module_access,
-- lanțul 20261209a) NU se ating.
-- Starea EXACTĂ a migrării e verificată înainte, pe DEFINIȚIILE EFECTIVE (amprente md5 pe text, nu nume / numere): coloanele fiecărui tabel,
-- constrângerile (textul + validate), indecșii, politicile, triggerele (funcția, tipul, activ, fără WHEN / argumente / coloane), drepturile
-- (ACL-ul tabelului și al coloanelor), vederea (textul + opțiunile + ACL), secvențele (ACL), fiecare funcție (corpul fără CR, DEFINER, limbajul,
-- search_path-ul, proprietarul, ACL-ul, volatilitatea, tipul întors) și nimic străin dependent de ele. Altă stare = refuz, nimic schimbat.
-- Blocul DEFINITII se regenerează de pe baza cu migrarea aplicată: node scripts/pglite/test_executie_dcc_registru_local.mjs --scrie-definitii
-- (expresia DEF-ACTUAL e citită de probă din acest fișier; proba verifică la fiecare rulare că blocul e la zi).
-- Fără amprentă globală L15 (varianta A din docs/LIVRARE_L15_V2.md §9, plafonul 2000 al revenirilor).
-- REFUZĂ dacă ORICE tabel dcc_* are rânduri (inclusiv dcc_intentii): datele reale se scot printr-o decizie separată a proprietarului, nu prin
-- revenire (triggerele refuză DELETE / TRUNCATE pentru oricine, inclusiv postgres).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon:
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270108a_executie_dcc_registru_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270108120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
-- Ordinea (L06, L14): 1. gărzile + starea exactă (doar catalog); 2. lock-urile, NOWAIT, ACCESS EXCLUSIVE, în ordinea INVERSĂ a cheilor străine
--   (dcc_legaturi … dcc_casute), apoi executie_proiecte (modul pe care îl cere scoaterea triggerelor referențiale ale cheii străine), luat EXPLICIT
--   ultimul, cu bugetul de 1 s de la prima încercare; 3. sub lock: starea din nou, „fără date”, oid-urile relațiilor (pentru postcondiția de lock-uri,
--   citite ÎNAINTEA DROP-urilor), DROP-urile (fără CASCADE), postcondiția. Un SINGUR bloc DO.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_rau text; v_n integer; v_t0 timestamptz; v_m1 oid[]; v_ep oid; v_set text; v_f text;
  v_baza oid[]; v_dep oid[]; v_b_m2 oid[]; v_b_r1 oid[]; v_b_c oid[]; v_b_e oid[]; v_m2 oid[]; v_r1 oid[]; v_c oid[]; v_e oid[];
  -- CLASA-E-START (aceeași listă P-E ca în migrare; goală până la citirea P-E)
  v_e_moduri text[] := ARRAY[]::text[];
  -- CLASA-E-END
  v_tabele constant text[] := ARRAY['dcc_legaturi', 'dcc_snapshot_revizii', 'dcc_mesaje', 'dcc_snapshoturi', 'dcc_istoric_aparitii', 'dcc_revizii', 'dcc_anexe',
    'dcc_file', 'dcc_documente', 'dcc_serii', 'dcc_intentii', 'dcc_proiecte', 'dcc_contracte', 'dcc_ghid_intervale', 'dcc_ghid_valori', 'dcc_ghiduri', 'dcc_casute'];
  v_functii constant text[] := ARRAY['fn_dcc_interval_e_canonic(text)', 'fn_dcc_interval_canonic(text)', 'fn_dcc_format_valid(jsonb)',
    'fn_dcc_cod_text(jsonb, text, text, text, text, integer, integer, integer, integer, text)', 'fn_dcc_titlu_scurt(text)',
    'fn_dcc_nume_fisier(jsonb, text, text, text, text, integer, integer, integer, integer, text, text, text)', 'fn_dcc_hash_parametri(text, jsonb)',
    'fn_dcc_tranzitie_permisa(text, text)', 'fn_dcc_istoric_hash(text, text, integer, jsonb, text, text, text, text, integer, integer, integer, integer, text, text[])',
    'fn_dcc_snapshot_hash(text, text, text[], text[], text, text, text[], jsonb)', 'fn_dcc_server()', 'fn_dcc_e_owner()', 'fn_dcc_drept(bigint, text)',
    'fn_dcc_contract_vizibil(bigint)', 'fn_dcc_are_modul()', 'fn_dcc_intentie_reia(uuid, text, text)', 'fn_dcc_intentie_revendica(uuid, text, text)',
    'fn_dcc_intentie_incheie(uuid, jsonb)', 'fn_dcc_ghid_compatibil_intern(bigint, bigint)', 'fn_dcc_lock_contract(bigint, boolean)',
    'fn_dcc_lock_cheie_serie(bigint, text, text, text, text)', 'fn_dcc_ghid_garda()', 'fn_dcc_ghid_intervale_disjuncte()', 'fn_dcc_contracte_garda()',
    'fn_dcc_proiecte_garda()', 'fn_dcc_intentii_garda()', 'fn_dcc_serii_garda()', 'fn_dcc_documente_garda()', 'fn_dcc_file_garda()', 'fn_dcc_anexe_garda()',
    'fn_dcc_revizii_garda()', 'fn_dcc_istoric_garda()', 'fn_dcc_snapshoturi_garda()', 'fn_dcc_snapshot_revizii_garda()', 'fn_dcc_mesaje_garda()',
    'fn_dcc_legaturi_garda()', 'fn_dcc_fara_stergere()', 'fn_dcc_fara_golire()', 'fn_dcc_config_permisa_intern()', 'fn_dcc_valori_ghid_intern(bigint, text, text)',
    'fn_dcc_coduri_intern(bigint, text, text, text, text, integer, integer, integer, integer, text)', 'fn_dcc_ghid_creeaza(jsonb, uuid)',
    'fn_dcc_contract_creeaza(text, text, text, text, uuid)', 'fn_dcc_proiect_seteaza(bigint, bigint, bigint, text, text, text, text[], jsonb, text, integer, integer, uuid)',
    'fn_dcc_initializeaza_serie(bigint, text, text, text, text, integer, text, boolean, uuid)', 'fn_dcc_aloca(bigint, text, text, text, text, text, text, integer, uuid)',
    'fn_dcc_aloca_manual(bigint, text, text, text, integer, text, text, integer, uuid)', 'fn_dcc_revizie_noua(bigint, bigint, bigint, text, text, uuid)',
    'fn_dcc_fila_noua(bigint, integer, text, text, uuid)', 'fn_dcc_anexa_noua(bigint, text, text, uuid)', 'fn_dcc_anuleaza(bigint, bigint, text, uuid)',
    'fn_dcc_serii_proiect(bigint)', 'fn_dcc_lista_forma_intern(bigint[])', 'fn_dcc_lista_drept_intern(bigint[])', 'fn_dcc_istoric_importa(bigint, text, jsonb, uuid)',
    'fn_dcc_marcheaza_copiat(bigint[], jsonb, uuid)', 'fn_dcc_confirma_trimis_manual(bigint[], timestamptz, text, text, bigint, uuid)'];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270108a_executie_dcc_registru_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270108a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270108a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20270108a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270108a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270108a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      -- lock-urile: punctul unic, NOWAIT, ordinea inversă a cheilor străine, apoi executie_proiecte; bugetul 1 s de la prima încercare
      v_t0 := clock_timestamp();
      LOOP
        IF clock_timestamp() >= v_t0 + interval '1 second' THEN
          RAISE EXCEPTION '20270108a revenire: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul e 1 s); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.dcc_legaturi, public.dcc_snapshot_revizii, public.dcc_mesaje, public.dcc_snapshoturi, public.dcc_istoric_aparitii, public.dcc_revizii,
            public.dcc_anexe, public.dcc_file, public.dcc_documente, public.dcc_serii, public.dcc_intentii, public.dcc_proiecte, public.dcc_contracte,
            public.dcc_ghid_intervale, public.dcc_ghid_valori, public.dcc_ghiduri, public.dcc_casute IN ACCESS EXCLUSIVE MODE NOWAIT;
          -- modul fixat de rev_lock_set (proba PGlite): DROP TABLE dcc_proiecte scoate triggerele referențiale ale cheii străine de pe
          -- executie_proiecte, care cer ACCESS EXCLUSIVE pe ea; luat EXPLICIT, NOWAIT, ultimul (plafonul revenirii: 2 s)
          LOCK TABLE public.executie_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= v_t0 + interval '1 second' THEN
        RAISE EXCEPTION '20270108a revenire: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_tabele) t WHERE to_regclass('public.' || t) IS NULL OR (SELECT relkind FROM pg_catalog.pg_class WHERE oid = to_regclass('public.' || t)) <> 'r')
       OR to_regclass('public.v_dcc_registru') IS NULL OR (SELECT relkind FROM pg_catalog.pg_class WHERE oid = to_regclass('public.v_dcc_registru')) <> 'v'
       OR EXISTS (SELECT 1 FROM unnest(v_functii) f WHERE to_regprocedure('public.' || f) IS NULL)
       OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_dcc\_%') <> cardinality(v_functii)
       OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
            AND (c.relname LIKE 'dcc\_%' OR c.relname LIKE 'v\_dcc\_%')) <> cardinality(v_tabele) + 1 THEN
      RAISE EXCEPTION '20270108a revenire: starea nu e cea din 20270108a (pasul %, obiectele)', v_pas;
    END IF;
    -- DEFINIȚIILE efective: amprenta md5 a fiecărei categorii pe fiecare obiect. Textul așteptat (blocul DEFINITII) e generat de pe baza cu
    -- migrarea aplicată; expresia care citește starea reală (blocul DEF-ACTUAL) e aceeași în probă (citită de aici, nu copiată).
    SELECT string_agg(a.cheie, ', ' ORDER BY a.cheie) FILTER (WHERE a.def IS DISTINCT FROM a.real), count(*) FILTER (WHERE a.real IS NOT NULL)
      INTO v_rau, v_n
      FROM (SELECT a.cheie, a.def, (
        -- DEF-ACTUAL-START
        CASE split_part(a.cheie, ':', 1)
          WHEN 'coloane' THEN (SELECT md5(string_agg(c.attname || ':' || format_type(c.atttypid, c.atttypmod) || ':' || CASE WHEN c.attnotnull THEN 'nn' ELSE 'n' END
                                                     || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ':' || c.attidentity::text || c.attgenerated::text
                                                     || ':' || coalesce(c.attacl::text, '-'), ',' ORDER BY c.attnum))
                                 FROM pg_catalog.pg_attribute c LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.attrelid AND d.adnum = c.attnum
                                WHERE c.attrelid = to_regclass('public.' || split_part(a.cheie, ':', 2)) AND c.attnum > 0 AND NOT c.attisdropped)
          WHEN 'constrangeri' THEN (SELECT md5(string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid) || CASE WHEN k.convalidated THEN '' ELSE ' NOT VALID' END,
                                                          '; ' ORDER BY k.conname))
                                      FROM pg_catalog.pg_constraint k WHERE k.conrelid = to_regclass('public.' || split_part(a.cheie, ':', 2)) AND k.contype <> 'n')
          WHEN 'indexuri' THEN (SELECT md5(string_agg(pg_get_indexdef(i.indexrelid) || CASE WHEN i.indisvalid THEN '' ELSE ' INVALID' END, '; '
                                                      ORDER BY pg_get_indexdef(i.indexrelid)))
                                  FROM pg_catalog.pg_index i WHERE i.indrelid = to_regclass('public.' || split_part(a.cheie, ':', 2)))
          WHEN 'politici' THEN (SELECT md5(coalesce(string_agg(p.polname || '|' || p.polcmd::text || '|' || p.polpermissive::text || '|' || p.polroles::regrole[]::text || '|'
                                                               || coalesce(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '[[:space:]]+', ' ', 'g'), '-') || '|'
                                                               || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'), '; ' ORDER BY p.polname), '-')
                                           || '|rls=' || c.relrowsecurity::text || c.relforcerowsecurity::text)
                                  FROM pg_catalog.pg_class c LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
                                 WHERE c.oid = to_regclass('public.' || split_part(a.cheie, ':', 2)) GROUP BY c.relrowsecurity, c.relforcerowsecurity)
          WHEN 'triggere' THEN (SELECT md5(string_agg(t.tgname || '|' || t.tgtype::text || '|' || t.tgfoid::regprocedure::text || '|' || t.tgenabled::text || '|'
                                                      || t.tgnargs::text || '|' || (t.tgqual IS NULL)::text || '|' || t.tgattr::text, '; ' ORDER BY t.tgname))
                                  FROM pg_catalog.pg_trigger t WHERE t.tgrelid = to_regclass('public.' || split_part(a.cheie, ':', 2)) AND NOT t.tgisinternal)
          WHEN 'acl' THEN (SELECT md5(coalesce(c.relacl::text, 'implicit') || '|' || c.relowner::regrole::text || '|' || coalesce(array_to_string(c.reloptions, ','), '-'))
                             FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.' || split_part(a.cheie, ':', 2)))
          WHEN 'vedere' THEN (SELECT md5(regexp_replace(pg_get_viewdef(c.oid), '[[:space:]]+', ' ', 'g') || '|' || coalesce(array_to_string(c.reloptions, ','), '-'))
                                FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.' || split_part(a.cheie, ':', 2)))
          WHEN 'secvente' THEN (SELECT md5(string_agg(c.relname || '|' || coalesce(c.relacl::text, 'implicit') || '|' || c.relowner::regrole::text, '; ' ORDER BY c.relname))
                                  FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'dcc\_%')
          WHEN 'functie' THEN (SELECT md5(md5(replace(p.prosrc, chr(13), '')) || '|' || p.prosecdef::text || '|' || l.lanname || '|' || coalesce(p.proconfig::text, '-') || '|'
                                          || p.proowner::regrole::text || '|' || coalesce(p.proacl::text, 'implicit') || '|' || p.provolatile::text || '|'
                                          || format_type(p.prorettype, NULL) || '|' || p.proretset::text)
                                 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
                                WHERE p.oid = to_regprocedure('public.' || substr(a.cheie, length('functie:') + 1)))
        END
        -- DEF-ACTUAL-END
        ) AS real FROM (VALUES
        -- DEFINITII-START
        ('acl:dcc_anexe', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_casute', '038cf88935f1bef915444718755e343c'),
        ('acl:dcc_contracte', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_documente', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_file', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_ghid_intervale', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_ghid_valori', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_ghiduri', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_intentii', '038cf88935f1bef915444718755e343c'),
        ('acl:dcc_istoric_aparitii', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_legaturi', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_mesaje', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_proiecte', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_revizii', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_serii', '038cf88935f1bef915444718755e343c'),
        ('acl:dcc_snapshot_revizii', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:dcc_snapshoturi', '6f31953d660c2f2bcb92d7c966e4adfc'),
        ('acl:v_dcc_registru', '55f1151213fffb8ae18a9dcee6fbb287'),
        ('coloane:dcc_anexe', 'dc1ef6a059ed5d1a2aeb0885ea5dff64'),
        ('coloane:dcc_casute', '5002bdea96503a769e936aeec2f73dbc'),
        ('coloane:dcc_contracte', '2f47394985ccc8614558bf3d65a76640'),
        ('coloane:dcc_documente', '9a652434e24a67119c431f66cd947bc6'),
        ('coloane:dcc_file', '4e34c2eb4826279467a316a8450e430e'),
        ('coloane:dcc_ghid_intervale', '42ada3619a899fb5f60e8d91608534fd'),
        ('coloane:dcc_ghid_valori', '5291e149a92f7fa2505a8bf70f536c3e'),
        ('coloane:dcc_ghiduri', 'a4352426d9d9f1989eb4d22fa73c5700'),
        ('coloane:dcc_intentii', '2c4a3709df63f8f377a3a251ab202048'),
        ('coloane:dcc_istoric_aparitii', '77edff8be367b04d035959fca51a1688'),
        ('coloane:dcc_legaturi', '2cd9d13aeab6d6476a62c46e991c40fd'),
        ('coloane:dcc_mesaje', 'f21f2a245ac44376b965886404620608'),
        ('coloane:dcc_proiecte', '050cec5904933870263a3053970ba288'),
        ('coloane:dcc_revizii', 'f9c1498ffa74eac41e8afd58adf0a99c'),
        ('coloane:dcc_serii', '836e994515d6a63a831be2845a4a4362'),
        ('coloane:dcc_snapshot_revizii', 'ed791662a57330fb337764100f263633'),
        ('coloane:dcc_snapshoturi', '1936f747616549fc4e3fb6e61fa789cb'),
        ('coloane:v_dcc_registru', '1a31a2a2e4cc7b9e9f19491cd41504b8'),
        ('constrangeri:dcc_anexe', 'b241203afedbc19bf860730c9048bde9'),
        ('constrangeri:dcc_casute', 'c1719ba5f6ac05a5a75fa8824263b045'),
        ('constrangeri:dcc_contracte', '2795ebc22fc7b210b64f3b5ef7ae0550'),
        ('constrangeri:dcc_documente', 'adf92077dc6a6b793672a4f271a29e6d'),
        ('constrangeri:dcc_file', 'be085032fd3649fe374f4c7409b723dc'),
        ('constrangeri:dcc_ghid_intervale', '5c8b2d321f08c6ce304ab076d3d62bb2'),
        ('constrangeri:dcc_ghid_valori', 'cf4a55dc7ac0111f3c7f07ceed3e6f5c'),
        ('constrangeri:dcc_ghiduri', 'd0eb797353c067aacf994df0aad6ee9b'),
        ('constrangeri:dcc_intentii', 'c57866690ba635a5feb2f1425057cefb'),
        ('constrangeri:dcc_istoric_aparitii', '00785f6804ef87b98c468442337cc7f7'),
        ('constrangeri:dcc_legaturi', 'f9657911f04c0190a011a845ab321f12'),
        ('constrangeri:dcc_mesaje', '3f126feffdaa29d187ec703e6c37e2f1'),
        ('constrangeri:dcc_proiecte', '60f1eed2eba7a98e8c52a56013766bd7'),
        ('constrangeri:dcc_revizii', '1a9688b92267dab84c45a256f1677a38'),
        ('constrangeri:dcc_serii', '77d269ae8259ab1f75fe60d06d281f67'),
        ('constrangeri:dcc_snapshot_revizii', '938938479fa71d48945a34c49c0f3155'),
        ('constrangeri:dcc_snapshoturi', '3321523e4f4f306f4e30c19e6162155c'),
        ('functie:fn_dcc_aloca(bigint, text, text, text, text, text, text, integer, uuid)', 'ae278adf1917e560e66f7062837f727a'),
        ('functie:fn_dcc_aloca_manual(bigint, text, text, text, integer, text, text, integer, uuid)', 'a466bdd8741cc2a9b7795c1fc93c0073'),
        ('functie:fn_dcc_anexa_noua(bigint, text, text, uuid)', 'b7490af3a20624826ae2ed3feea52563'),
        ('functie:fn_dcc_anexe_garda()', '7dc9f692a9d409a86296339a2e02799c'),
        ('functie:fn_dcc_anuleaza(bigint, bigint, text, uuid)', 'b0f1b3b3d5df2e5bf2e83d0577ef5aac'),
        ('functie:fn_dcc_are_modul()', '438400b5fdbea1779c0340c472da7db4'),
        ('functie:fn_dcc_cod_text(jsonb, text, text, text, text, integer, integer, integer, integer, text)', 'bd3cb3ed038a2febcd1d0a2f2e968567'),
        ('functie:fn_dcc_coduri_intern(bigint, text, text, text, text, integer, integer, integer, integer, text)', '1ef9233327990c1ac6b72327e8f93f73'),
        ('functie:fn_dcc_config_permisa_intern()', 'f8cf7842f2a5485420a40f60b75a07d4'),
        ('functie:fn_dcc_confirma_trimis_manual(bigint[], timestamptz, text, text, bigint, uuid)', '7c913bce1788465e1e09df0b4a27540a'),
        ('functie:fn_dcc_contract_creeaza(text, text, text, text, uuid)', 'a2834c803eae698b137ead13c1a2bae7'),
        ('functie:fn_dcc_contract_vizibil(bigint)', '5e847d1cb770422ac00061bf96d1ddba'),
        ('functie:fn_dcc_contracte_garda()', '7ae5677aa28dded09241f8e708b3c1f7'),
        ('functie:fn_dcc_documente_garda()', '0ea057235bdd53f6435bf04eaf431007'),
        ('functie:fn_dcc_drept(bigint, text)', '39d64056bcdb9d5c13769dc17c0d8cd6'),
        ('functie:fn_dcc_e_owner()', '3b28041db57616b839681507441edfe3'),
        ('functie:fn_dcc_fara_golire()', 'c4b980d1183bc287c4f9c47253ad114a'),
        ('functie:fn_dcc_fara_stergere()', 'c9d4090fed003ed3bd39f16b9627d6da'),
        ('functie:fn_dcc_fila_noua(bigint, integer, text, text, uuid)', '623367800a30a7dc68f2a7e381c0aeec'),
        ('functie:fn_dcc_file_garda()', 'c6cec4aa1dc90990106574f4be76760f'),
        ('functie:fn_dcc_format_valid(jsonb)', '907e19685f64f26933935e7fee204d96'),
        ('functie:fn_dcc_ghid_compatibil_intern(bigint, bigint)', 'ec62458b0aa102d3f63a2460b9368d88'),
        ('functie:fn_dcc_ghid_creeaza(jsonb, uuid)', 'a14ec76d777ce909e8beb0341a9f7a28'),
        ('functie:fn_dcc_ghid_garda()', 'c00763a41ccb855109fbe4b4807969d1'),
        ('functie:fn_dcc_ghid_intervale_disjuncte()', 'ef8df7d57efdb28628d8618fbf43591b'),
        ('functie:fn_dcc_hash_parametri(text, jsonb)', '9964683c84ee23283fc6d53d07ae692b'),
        ('functie:fn_dcc_initializeaza_serie(bigint, text, text, text, text, integer, text, boolean, uuid)', 'd3676ec327e4b35520250bede2e8dc48'),
        ('functie:fn_dcc_intentie_incheie(uuid, jsonb)', '2f82c97886552948f103d6e424636437'),
        ('functie:fn_dcc_intentie_reia(uuid, text, text)', '034479cff3269c323e70b67b2ac14e1a'),
        ('functie:fn_dcc_intentie_revendica(uuid, text, text)', '856add5f4abfaded1975c5fc8c30ad49'),
        ('functie:fn_dcc_intentii_garda()', '96112d2a3d384f3dfd489ce562d0f2b2'),
        ('functie:fn_dcc_interval_canonic(text)', 'c73677ac286349afc0e5effa0487abeb'),
        ('functie:fn_dcc_interval_e_canonic(text)', 'd46f77d5e2f9c8d3dbbc8524ba133d39'),
        ('functie:fn_dcc_istoric_garda()', 'f87ac6474431c044acbec42ab6e22e76'),
        ('functie:fn_dcc_istoric_hash(text, text, integer, jsonb, text, text, text, text, integer, integer, integer, integer, text, text[])', '5a88b2b8f25537b2a4d2dfea37cadbaf'),
        ('functie:fn_dcc_istoric_importa(bigint, text, jsonb, uuid)', '82b9aa6fbfa3f99510b189798bd74eb0'),
        ('functie:fn_dcc_legaturi_garda()', 'b7ab87cb9186594408cb02129c2911ee'),
        ('functie:fn_dcc_lista_drept_intern(bigint[])', '6713091055b818f2d7658955f93142b7'),
        ('functie:fn_dcc_lista_forma_intern(bigint[])', '2b3e4a5c4586e34075f06be45cb62f40'),
        ('functie:fn_dcc_lock_cheie_serie(bigint, text, text, text, text)', '0b13cb905d1d73efa1670f32c4213fd9'),
        ('functie:fn_dcc_lock_contract(bigint, boolean)', 'f161bad63bb47f147027ac8b9fd9c53b'),
        ('functie:fn_dcc_marcheaza_copiat(bigint[], jsonb, uuid)', '9da8507cd324860714833ef6f05c97b9'),
        ('functie:fn_dcc_mesaje_garda()', '3f750ab8de78c58ea7fb7626118a085b'),
        ('functie:fn_dcc_nume_fisier(jsonb, text, text, text, text, integer, integer, integer, integer, text, text, text)', '3679a86bf7e79e75e9c0325a592da993'),
        ('functie:fn_dcc_proiect_seteaza(bigint, bigint, bigint, text, text, text, text[], jsonb, text, integer, integer, uuid)', '22867250cc7b7cecca24327ef0eaf1b9'),
        ('functie:fn_dcc_proiecte_garda()', '71eebc5c5f695cba0e71c3441c471dcc'),
        ('functie:fn_dcc_revizie_noua(bigint, bigint, bigint, text, text, uuid)', '7c026753a6dcd6e6773b7fd7ac3db2b5'),
        ('functie:fn_dcc_revizii_garda()', '79294cba89e9b71d1d5160ff4da3b218'),
        ('functie:fn_dcc_serii_garda()', '19c156b41088f276293f9d4f5e2c3e35'),
        ('functie:fn_dcc_serii_proiect(bigint)', '01f07e807106bc03b6f3612d5a5e6992'),
        ('functie:fn_dcc_server()', '51a9c8c35b4a354f69d2fb78dd825c6d'),
        ('functie:fn_dcc_snapshot_hash(text, text, text[], text[], text, text, text[], jsonb)', '4b37f213819515b0f123685829091df4'),
        ('functie:fn_dcc_snapshot_revizii_garda()', '1d173a7401590389a3744233abf59017'),
        ('functie:fn_dcc_snapshoturi_garda()', '145bc5a9fbcf8024c9f9c6980326cfb8'),
        ('functie:fn_dcc_titlu_scurt(text)', 'e23f806aa2abb673952d60f448ac4d5f'),
        ('functie:fn_dcc_tranzitie_permisa(text, text)', 'd458816112ddf22d8e4a5047e2955916'),
        ('functie:fn_dcc_valori_ghid_intern(bigint, text, text)', '3256b1945b6b2360c61ebb2ba2df250e'),
        ('indexuri:dcc_anexe', 'cdb9762468bdf45c6add009b87ad73c3'),
        ('indexuri:dcc_casute', 'beacc5fea3efdec7217ada97f0e211ed'),
        ('indexuri:dcc_contracte', 'c5776700d6dc8dfc23bf234ca9984412'),
        ('indexuri:dcc_documente', '4f29ef5792a0de0f13b71794c4708871'),
        ('indexuri:dcc_file', '5777ffe4d27170d83c29c937d28c9d5f'),
        ('indexuri:dcc_ghid_intervale', '63e9c1941356a03eb179cf20442ab26b'),
        ('indexuri:dcc_ghid_valori', 'ebe8d05e9812523736bf5f15affbf71d'),
        ('indexuri:dcc_ghiduri', '7cc34b9e32ff939b0538a1a5578e0b0f'),
        ('indexuri:dcc_intentii', '0f12b7d059711de37c631da5f33df7cf'),
        ('indexuri:dcc_istoric_aparitii', '42ef231ef50385fefcb0e54ba4ee1d94'),
        ('indexuri:dcc_legaturi', '6591a3fb144f307c3c812ee534c6a003'),
        ('indexuri:dcc_mesaje', '9da66cb892c73048f7e21138bc83f74b'),
        ('indexuri:dcc_proiecte', 'dec039e561be74b0899bc7d2474cf0a7'),
        ('indexuri:dcc_revizii', '667fe95213ecb796c7bc715227b4a307'),
        ('indexuri:dcc_serii', '9592deac2f46a418d2030b3ffa92cb64'),
        ('indexuri:dcc_snapshot_revizii', 'ec00a02734d869bcc1d0c0d561c3093d'),
        ('indexuri:dcc_snapshoturi', 'a87fb61f89b68330bbb968c81f136171'),
        ('politici:dcc_anexe', 'be3d5fa9ba47151a5b32fd6de5d29545'),
        ('politici:dcc_casute', 'a6d7496e64db4e933de657400d7c6783'),
        ('politici:dcc_contracte', '41aa29f8788d7df89f3cd1a17ba40cfa'),
        ('politici:dcc_documente', '52049932998eaf4aeff3ca1466c7cb46'),
        ('politici:dcc_file', 'b4587842608945b11ad271ff277a2441'),
        ('politici:dcc_ghid_intervale', '40093cf2a73a9b8c3c1675aa216eefeb'),
        ('politici:dcc_ghid_valori', '0f2c713c42c62ba04c86be2c15bddb17'),
        ('politici:dcc_ghiduri', '3acf4522d051ff5ac3b9267cc900e971'),
        ('politici:dcc_intentii', 'a6d7496e64db4e933de657400d7c6783'),
        ('politici:dcc_istoric_aparitii', 'fde114238918c45173a3ca597541cae8'),
        ('politici:dcc_legaturi', 'a0dbdd2e026a6c42a30a83638266a081'),
        ('politici:dcc_mesaje', '383235cb94831c3de1ed8fe017e95613'),
        ('politici:dcc_proiecte', 'aae3de56240f205f910528c20cfc99d7'),
        ('politici:dcc_revizii', '30bff08aa18733c72163885683989bbb'),
        ('politici:dcc_serii', 'a6d7496e64db4e933de657400d7c6783'),
        ('politici:dcc_snapshot_revizii', 'f1b649c79bbb1aedfb3600e757c1139e'),
        ('politici:dcc_snapshoturi', '9a88192becbdb92b2d77a86bc7f2e59f'),
        ('secvente:', '7fddfd1861dfb54e915ac6dfd4cb20ef'),
        ('triggere:dcc_anexe', '4cf8285c1cf32e1db79b3f5cdd5a7e0a'),
        ('triggere:dcc_casute', '6ad7b879705522714978833dd917af62'),
        ('triggere:dcc_contracte', '43d041d37b36195bcbbeeb74d82af306'),
        ('triggere:dcc_documente', 'c09306944d7b81e50cb0d48cb9d2b226'),
        ('triggere:dcc_file', '24caf0bcfd4ac29ec1680a5dfed0c7f3'),
        ('triggere:dcc_ghid_intervale', '36eefb750481f9cd153d6099670e61ed'),
        ('triggere:dcc_ghid_valori', 'e758724bd6cef2a0a35c084d5ef7419f'),
        ('triggere:dcc_ghiduri', '65dd78cc6733fd3ca0254fa4cd77b324'),
        ('triggere:dcc_intentii', 'bd153dc6ab85f174e41751c93f6dc900'),
        ('triggere:dcc_istoric_aparitii', 'f14f2c11489b9fd3b42dc65ff7b21e92'),
        ('triggere:dcc_legaturi', '09607cfad04b297d41e36fb22226dead'),
        ('triggere:dcc_mesaje', 'a6ad717c2bb9f35bb77cd03e23d92b23'),
        ('triggere:dcc_proiecte', 'a67c939fe2ac7e67b1ea8b6ec0e3443c'),
        ('triggere:dcc_revizii', '519aaeeed8e2add8da44eb71e92b85a8'),
        ('triggere:dcc_serii', 'ba11a7d533b95e48b420ee923bdb88b0'),
        ('triggere:dcc_snapshot_revizii', '7118c151c7a53261a0daa7aee746c0cc'),
        ('triggere:dcc_snapshoturi', '4e157098baaad53c4df813ba530b2fcb'),
        ('vedere:v_dcc_registru', 'cbff52055d7741d05665f671b6f50077'),
        ('', '')
        -- DEFINITII-END
      ) a(cheie, def) WHERE a.cheie <> '') a;
    -- 6 categorii pe fiecare tabel (coloane, constrângeri, indecși, politici, triggere, acl) + vederea (text, coloane, acl) + secvențele + fiecare funcție
    IF v_rau IS NOT NULL OR v_n IS DISTINCT FROM 6 * cardinality(v_tabele) + 4 + cardinality(v_functii) THEN
      RAISE EXCEPTION '20270108a revenire: starea nu e cea din 20270108a (pasul %, definitii: %)', v_pas,
        coalesce(v_rau, 'blocul DEFINITII incomplet (' || coalesce(v_n, 0) || ' din ' || (6 * cardinality(v_tabele) + 4 + cardinality(v_functii)) || ')');
    END IF;
    -- nimic STRĂIN dependent de obiectele migrării: vederi / reguli, constrângeri, triggere, politici, valori implicite, funcții ale ALTOR obiecte
    SELECT string_agg(DISTINCT d.classid::regclass::text || ':' || d.objid::text, ', ') INTO v_rau
      FROM pg_catalog.pg_depend d
     WHERE d.deptype = 'n'
       AND (d.refobjid IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele || ARRAY['v_dcc_registru']) t)
            OR d.refobjid IN (SELECT to_regprocedure('public.' || f)::oid FROM unnest(v_functii) f))
       AND NOT (
         (d.classid = 'pg_catalog.pg_class'::regclass AND (d.objid IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele || ARRAY['v_dcc_registru']) t)
                                                         OR (SELECT c.relname FROM pg_catalog.pg_class c WHERE c.oid = d.objid) LIKE 'dcc\_%'))
         OR (d.classid = 'pg_catalog.pg_rewrite'::regclass AND (SELECT r.ev_class FROM pg_catalog.pg_rewrite r WHERE r.oid = d.objid) = 'public.v_dcc_registru'::regclass)
         OR (d.classid = 'pg_catalog.pg_constraint'::regclass AND (SELECT k.conrelid FROM pg_catalog.pg_constraint k WHERE k.oid = d.objid)
                                                                    IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele) t))
         OR (d.classid = 'pg_catalog.pg_trigger'::regclass AND (SELECT t.tgrelid FROM pg_catalog.pg_trigger t WHERE t.oid = d.objid)
                                                                 IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele) t))
         OR (d.classid = 'pg_catalog.pg_policy'::regclass AND (SELECT p.polrelid FROM pg_catalog.pg_policy p WHERE p.oid = d.objid)
                                                                IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele) t))
         OR (d.classid = 'pg_catalog.pg_attrdef'::regclass AND (SELECT x.adrelid FROM pg_catalog.pg_attrdef x WHERE x.oid = d.objid)
                                                                 IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele) t))
         OR (d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid IN (SELECT to_regprocedure('public.' || f)::oid FROM unnest(v_functii) f))
         OR (d.classid = 'pg_catalog.pg_type'::regclass AND (SELECT t.typrelid FROM pg_catalog.pg_type t WHERE t.oid = d.objid)
                                                              IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele || ARRAY['v_dcc_registru']) t)));
    IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270108a revenire: obiecte straine depind de cele ale migrarii (pasul %): %', v_pas, v_rau; END IF;
  END LOOP;
  -- sub lock: fără date (orice rând, inclusiv o cheie de intenție = refuz)
  FOR v_f IN SELECT t FROM unnest(v_tabele) t LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_f) INTO v_n;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '20270108a revenire: REVENIRE_CU_DATE: % are % randuri (datele se scot printr-o decizie separata a proprietarului); nimic schimbat', v_f, v_n;
    END IF;
  END LOOP;
  -- clasa M1' a postcondiției: oid-urile relațiilor migrării + dependențele lor (indecși, TOAST, secvențe), citite ÎNAINTEA DROP-urilor
  SELECT coalesce(array_agg(DISTINCT z.o), '{}'::oid[]) INTO v_m1 FROM (
    SELECT to_regclass('public.' || t)::oid AS o FROM unnest(v_tabele || ARRAY['v_dcc_registru']) t
    UNION ALL SELECT i.indexrelid FROM pg_catalog.pg_index i WHERE i.indrelid IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele) t)
    UNION ALL SELECT c.reltoastrelid FROM pg_catalog.pg_class c WHERE c.oid IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele) t) AND c.reltoastrelid <> 0
    UNION ALL SELECT i.indexrelid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_index i ON i.indrelid = c.reltoastrelid
               WHERE c.oid IN (SELECT to_regclass('public.' || t)::oid FROM unnest(v_tabele) t)
    UNION ALL SELECT c.oid FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'dcc\_%') z;
  v_ep := 'public.executie_proiecte'::regclass;
  -- DROP-urile, fără CASCADE: vederea, tabelele în ordinea inversă a cheilor străine, apoi funcțiile pe lista exactă
  DROP VIEW public.v_dcc_registru;
  -- (statice, pe lista exactă: regula porților Izometrie refuză DROP-urile dinamice cu ținta necunoscută)
  DROP TABLE public.dcc_legaturi;
  DROP TABLE public.dcc_snapshot_revizii;
  DROP TABLE public.dcc_mesaje;
  DROP TABLE public.dcc_snapshoturi;
  DROP TABLE public.dcc_istoric_aparitii;
  DROP TABLE public.dcc_revizii;
  DROP TABLE public.dcc_anexe;
  DROP TABLE public.dcc_file;
  DROP TABLE public.dcc_documente;
  DROP TABLE public.dcc_serii;
  DROP TABLE public.dcc_intentii;
  DROP TABLE public.dcc_proiecte;
  DROP TABLE public.dcc_contracte;
  DROP TABLE public.dcc_ghid_intervale;
  DROP TABLE public.dcc_ghid_valori;
  DROP TABLE public.dcc_ghiduri;
  DROP TABLE public.dcc_casute;
  DROP FUNCTION public.fn_dcc_interval_e_canonic(text), public.fn_dcc_interval_canonic(text), public.fn_dcc_format_valid(jsonb),
    public.fn_dcc_cod_text(jsonb, text, text, text, text, integer, integer, integer, integer, text), public.fn_dcc_titlu_scurt(text),
    public.fn_dcc_nume_fisier(jsonb, text, text, text, text, integer, integer, integer, integer, text, text, text),
    public.fn_dcc_hash_parametri(text, jsonb), public.fn_dcc_tranzitie_permisa(text, text),
    public.fn_dcc_istoric_hash(text, text, integer, jsonb, text, text, text, text, integer, integer, integer, integer, text, text[]),
    public.fn_dcc_snapshot_hash(text, text, text[], text[], text, text, text[], jsonb), public.fn_dcc_server(), public.fn_dcc_e_owner(),
    public.fn_dcc_drept(bigint, text), public.fn_dcc_contract_vizibil(bigint), public.fn_dcc_are_modul(),
    public.fn_dcc_intentie_reia(uuid, text, text), public.fn_dcc_intentie_revendica(uuid, text, text), public.fn_dcc_intentie_incheie(uuid, jsonb),
    public.fn_dcc_ghid_compatibil_intern(bigint, bigint), public.fn_dcc_lock_contract(bigint, boolean),
    public.fn_dcc_lock_cheie_serie(bigint, text, text, text, text), public.fn_dcc_ghid_garda(), public.fn_dcc_ghid_intervale_disjuncte(),
    public.fn_dcc_contracte_garda(), public.fn_dcc_proiecte_garda(), public.fn_dcc_intentii_garda(), public.fn_dcc_serii_garda(),
    public.fn_dcc_documente_garda(), public.fn_dcc_file_garda(), public.fn_dcc_anexe_garda(), public.fn_dcc_revizii_garda(),
    public.fn_dcc_istoric_garda(), public.fn_dcc_snapshoturi_garda(), public.fn_dcc_snapshot_revizii_garda(), public.fn_dcc_mesaje_garda(),
    public.fn_dcc_legaturi_garda(), public.fn_dcc_fara_stergere(), public.fn_dcc_fara_golire(), public.fn_dcc_config_permisa_intern(),
    public.fn_dcc_valori_ghid_intern(bigint, text, text),
    public.fn_dcc_coduri_intern(bigint, text, text, text, text, integer, integer, integer, integer, text), public.fn_dcc_ghid_creeaza(jsonb, uuid),
    public.fn_dcc_contract_creeaza(text, text, text, text, uuid),
    public.fn_dcc_proiect_seteaza(bigint, bigint, bigint, text, text, text, text[], jsonb, text, integer, integer, uuid),
    public.fn_dcc_initializeaza_serie(bigint, text, text, text, text, integer, text, boolean, uuid),
    public.fn_dcc_aloca(bigint, text, text, text, text, text, text, integer, uuid),
    public.fn_dcc_aloca_manual(bigint, text, text, text, integer, text, text, integer, uuid),
    public.fn_dcc_revizie_noua(bigint, bigint, bigint, text, text, uuid), public.fn_dcc_fila_noua(bigint, integer, text, text, uuid),
    public.fn_dcc_anexa_noua(bigint, text, text, uuid), public.fn_dcc_anuleaza(bigint, bigint, text, uuid), public.fn_dcc_serii_proiect(bigint),
    public.fn_dcc_lista_forma_intern(bigint[]), public.fn_dcc_lista_drept_intern(bigint[]), public.fn_dcc_istoric_importa(bigint, text, jsonb, uuid),
    public.fn_dcc_marcheaza_copiat(bigint[], jsonb, uuid), public.fn_dcc_confirma_trimis_manual(bigint[], timestamptz, text, text, bigint, uuid);
  -- postcondiții: nimic rămas, lanțul de drept neschimbat
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace = 'public'::regnamespace AND (c.relname LIKE 'dcc\_%' OR c.relname = 'v_dcc_registru'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_dcc\_%')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgname LIKE 'trg\_dcc\_%') THEN
    RAISE EXCEPTION '20270108a revenire: au ramas obiecte dcc_ / fn_dcc_ / trg_dcc_';
  END IF;
  SELECT string_agg(a.s, ', ') INTO v_rau FROM (VALUES
      ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155'), ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1'),
      ('public.fn_executie_acces_nerestrans_cont(uuid)', '9a07e0089139e54ba5c6a0cfaaf093cc'), ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b'),
      ('public.fn_executie_acces_lista_cont(uuid, boolean)', 'e7cf9b852002a1c1cbe781772c33bf0c')) a(s, amp)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(a.s)
   WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amp;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270108a revenire: lantul de drept s-a schimbat: %', v_rau; END IF;
  -- POSTCONDIȚIA DE LOCK-URI a revenirii (aceeași regulă ca la migrare): M1' (oid-urile citite înaintea DROP-urilor), executie_proiecte (modul
  -- luat explicit) + dependențele ei DOAR AccessShareLock, R1 = dep(schema_migrations) DOAR AccessShareLock, C = schema pg_catalog + dep(), E = P-E.
  -- dep(X) = X + indecșii lui (pg_index, toți) + TOAST-ul lui + indecșii TOAST-ului
  v_b_m2 := ARRAY[v_ep];
  v_b_r1 := CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN '{}'::oid[]
                 ELSE ARRAY[to_regclass('supabase_migrations.schema_migrations')::oid] END;
  SELECT coalesce(array_agg(c.oid), '{}'::oid[]) INTO v_b_c FROM pg_catalog.pg_class c WHERE c.relnamespace = 'pg_catalog'::regnamespace;
  SELECT coalesce(array_agg(DISTINCT to_regclass(split_part(x, ':', 1))::oid), '{}'::oid[]) INTO v_b_e FROM unnest(v_e_moduri) x;
  FOR v_f IN SELECT x FROM unnest(ARRAY['M2', 'R1', 'C', 'E']) x LOOP
    v_baza := CASE v_f WHEN 'M2' THEN v_b_m2 WHEN 'R1' THEN v_b_r1 WHEN 'C' THEN v_b_c ELSE v_b_e END;
    SELECT coalesce(array_agg(DISTINCT z.o), '{}'::oid[]) INTO v_dep FROM (
      SELECT b AS o FROM unnest(v_baza) b
      UNION ALL SELECT i.indexrelid FROM pg_catalog.pg_index i WHERE i.indrelid = ANY (v_baza)
      UNION ALL SELECT c.reltoastrelid FROM pg_catalog.pg_class c WHERE c.oid = ANY (v_baza) AND c.reltoastrelid <> 0
      UNION ALL SELECT i.indexrelid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_index i ON i.indrelid = c.reltoastrelid WHERE c.oid = ANY (v_baza)) z;
    CASE v_f
      WHEN 'M2' THEN v_m2 := v_dep;
      WHEN 'R1' THEN v_r1 := v_dep;
      WHEN 'C' THEN v_c := v_dep;
      ELSE v_e := v_dep;
    END CASE;
  END LOOP;
  WITH lk AS (
    SELECT l.relation AS o, l.mode,
           coalesce((SELECT n.nspname || '.' || c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = l.relation),
                    'oid ' || l.relation::text) AS nume
      FROM pg_catalog.pg_locks l
     WHERE l.locktype = 'relation' AND l.pid = pg_backend_pid() AND l.granted
       AND (l.database = (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = current_database()) OR l.database = 0)
  ), cl AS (
    SELECT lk.*, CASE
        WHEN lk.o = ANY (v_m1) THEN 'M1'
        WHEN lk.o = v_ep AND lk.mode IN ('AccessExclusiveLock', 'ShareRowExclusiveLock', 'AccessShareLock', 'RowShareLock') THEN 'M2'
        WHEN lk.o = ANY (v_m2) AND lk.o <> v_ep AND lk.mode = 'AccessShareLock' THEN 'M2'
        WHEN lk.o = ANY (v_r1) AND lk.mode = 'AccessShareLock' THEN 'R1'
        WHEN lk.o = ANY (v_c) THEN 'C'
        WHEN lk.o = ANY (v_e) AND (lk.nume || ':' || lk.mode) = ANY (v_e_moduri) THEN 'E'
      END AS clasa FROM lk)
  SELECT string_agg(nume || ' ' || mode, '; ' ORDER BY nume, mode) FILTER (WHERE clasa IS NULL),
         format('M1=%s M2=%s R1=%s C=%s E=%s', count(*) FILTER (WHERE clasa = 'M1'),
                coalesce(string_agg(nume || ':' || mode, ',' ORDER BY nume, mode) FILTER (WHERE clasa = 'M2'), '-'),
                coalesce(string_agg(nume || ':' || mode, ',' ORDER BY nume, mode) FILTER (WHERE clasa = 'R1'), '-'), count(*) FILTER (WHERE clasa = 'C'),
                count(*) FILTER (WHERE clasa = 'E'))
    INTO v_rau, v_set FROM cl;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'L15_LOCK_NEDECLARAT: %', v_rau; END IF;
  RAISE NOTICE 'L15_LOCK_SET_REVENIRE %', v_set;
  RAISE NOTICE '20270108a revenire: obiectele migrarii scoase (% incercari de lock), la % ms de la BEGIN', v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
