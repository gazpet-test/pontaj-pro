-- Version 20261230120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 + --amprenta-globala / --diferente-globale (DOAR asa; marcajul gazpet.livrare_migrare legat de txid).
-- 20261230a_izometrie_porti_reconciliere — TKT-2026-0393: salvarea în Izometrie e refuzată pentru că porțile E2 / E3 / E3b / E4 / E4b sunt roșii pe producție.
-- FIȘIER GENERAT de scripts/izometrie/reconciliere/gen_20261230a.mjs (nu se editează de mână; testul src/izoPortiReconciliere.test.js
--   verifică generator = fișier).
--
-- Cauza (analiza coordonatorului pe producție, doar citire, 19.11.2026): ștampilele porților (COMMENT-urile porti*=md5) au fost puse de
--   20261120a. După ea s-au aplicat trei migrări legitime din repo care au schimbat obiecte amprentate de porți fără să refacă ștampilele:
--   20261209a (garda de acces pe proiect: trigger-ul trg_executie_acces_garda pe 4 tabele executie_* + 4 politici RESTRICTIVE executie_acces_*
--   pe executie_proiecte și executie_tronsoane), 20261211a (trigger-ul trg_executie_fibra_garda_tronson) și 20261218a (drepturile anon retrase
--   de pe secvențe, inclusiv magazie_bucati_id_seq). Fiecare ștampilă se reconstruiește EXACT din starea de azi cu aceste schimbări scoase.
--   Plus două semnale ale porții E2 care nu sunt ștampile, ambele cazuri cunoscute ale euristicii (fals-pozitive acceptate, fail-closed):
--   (1) excepția revizuită a trigger-ului on_auth_user_created (auth.users → handle_new_user) a căzut pentru că 20261119a a rescris corpul
--       funcției; amprenta nouă (calculată și din corpul din repo) = b1858fddd590635b445127fd6c680d97;
--   (2) porțile portalului fn_portal_porti_lipsa() / fn_portal_porti_lipsa_1b() (20261118a / 20261119a) intră ca „SQL dinamic” din cauza
--       literalului 'EXECUTE' din has_function_privilege; ca fn_conturi_inchideri_sweep, trec pe lista revizuită c_dinamice_revizuite, cu
--       amprenta md5(prosrc | proconfig | owner | proacl | prosecdef) (orice schimbare de corp / cale / owner / drepturi redeschide excepția).
--       fn_portal_1b_snapshot() iese apoi singură din închidere (singurii ei „părinți” erau cele două).
-- Ce face (o tranzacție, prin runner):
--   1. gărzi PRE (refuz cu mesaj, nimic schimbat): cele 5 ștampile stocate, cele 5 definiții de acum, corpul + proprietățile + ACL-ul porții E2,
--      corpurile fn_izo_porti_definitii / fn_izo_porti_e3_lipsa / fn_izo_porti_e4_lipsa, amprenta trigger-ului on_auth_user_created și
--      amprentele celor două porți ale portalului — toate = valorile citite pe producție (blocul BASELINE de mai jos);
--   2. CREATE OR REPLACE public.fn_izo_porti_lipsa(): corpul de pe producție (= 20261109b) cu EXACT cele două schimbări de listă; același
--      owner / SECURITY DEFINER / search_path; ACL-ul se păstrează (CREATE OR REPLACE nu-l atinge) și e verificat textual înainte și după;
--   3. refacerea celor 5 ștampile (ca 20261120a), DUPĂ schimbarea corpului (E2a și E4b includ corpurile fn_izo_*);
--   4. gărzi POST: corpul nou (md5 23da4c3c9e4639f3600197f3d7b88977) cu aceleași proprietăți și același ACL; fiecare ștampilă = definiția ei curentă; E3 / E3b / E4 =
--      exact definițiile de dinainte (corpul porții nu intră în ele); restul funcțiilor și toate celelalte comentarii neschimbate;
--      fn_izo_porti_lipsa() = '{}' (toate porțile verzi).
-- De ce DOAR cu amprenta globală (L15 v2): refacerea ștampilelor „binecuvântează” catalogul din momentul ei. Gărzile PRE fixează starea
--   analizată; pasul „după” al runnerului (diferența = exact manifestul 20261230a_izometrie_porti_reconciliere.l15.tsv, generat pe clonă: o singură linie, funcția
--   fn_izo_porti_lipsa() „schimbat”) refuză orice altă schimbare de catalog apărută între timp în aceeași tranzacție. Fără pasul
--   „înainte” al runnerului (tabelul temporar ag_ina_<T>) migrarea refuză (AG_LIPSA; gardă de protocol, nu autorizație).
-- Lock-uri (L06): niciun lock pe tabele. Lock-ul consultativ al runnerului (gazpet.livrare_migrare, exclusiv) ține pe loc intrările API
--   Izometrie (îl iau partajat) până la COMMIT; CREATE OR REPLACE / COMMENT iau doar lock-urile de obiect ale funcțiilor atinse.
-- Timpul: fn_izo_porti_lipsa() rulează o singură dată (POST); costul ei + cele două calcule ale amprentei globale se măsoară pe clonă.
-- Revenire: supabase/revenire/20261230a_izometrie_porti_reconciliere_ROLLBACK.sql (corpul vechi și ștampilele vechi EXACT; porțile redevin roșii, ca înainte).
-- Probe: scripts/pglite/test_izometrie_porti_reconciliere_local.mjs (PGlite) + src/izoPortiReconciliere.test.js (vitest).
DO $pre$
DECLARE v_plafon text; v_x text; v_n integer; r record;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261230a_izometrie_porti_reconciliere:' || txid_current() THEN
    RAISE EXCEPTION '20261230a: garda start invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261230a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261230a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  -- plafonul total = ceasul de tranzacție PostgreSQL 17, pus de runner înainte de BEGIN (sursa 'session'), citit calificat + marcajul prologului
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261230a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261230a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- amprenta globală L15 v2: pasul „înainte” al runnerului a rulat în această tranzacție (tabelul lui temporar există)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace = pg_catalog.pg_my_temp_schema() AND c.relkind = 'r'
                   AND c.relname ~ '^ag_ina_[0-9a-f]{16}$') THEN
    RAISE EXCEPTION '20261230a: AG_LIPSA: livrarea cere --amprenta-globala + --diferente-globale (pasul inainte al runnerului nu a rulat)';
  END IF;
  -- >>> BASELINE 20261230a (producție, 19.11.2026; sursa: citirea coordonatorului; amprentele independente de mediu se refac și din repo în teste)
  -- 1. ștampilele stocate, exact
  FOR r IN SELECT * FROM (VALUES
     ('fn_izo_porti_definitii', 'porti=a79c07584550c02aa32f30b7b4b56646'),
     ('fn_izo_porti_e3_definitii', 'porti_e3=785fed7197be69709988bada9e598bd4'),
     ('fn_izo_porti_e3b_definitii', 'porti_e3b=869a529d41f6891a545a7541696f9df7'),
     ('fn_izo_porti_e4_definitii', 'porti_e4=be112fb7cdbb55aa8f2b530430a4d9fd'),
     ('fn_izo_porti_e4b_definitii', 'porti_e4b=696f226046c3ae662ac889562edac863')
    ) v(f, s) LOOP
    v_x := obj_description(to_regprocedure('public.' || r.f || '()'), 'pg_proc');
    IF v_x IS DISTINCT FROM r.s THEN RAISE EXCEPTION '20261230a: stampila %() = % (asteptat %)', r.f, coalesce(v_x, 'lipsa'), r.s; END IF;
  END LOOP;
  -- 2. definițiile de acum (starea analizată)
  v_x := public.fn_izo_porti_definitii();
  IF v_x IS DISTINCT FROM '0839b958877f2c4b82d50905296c7b10' THEN RAISE EXCEPTION '20261230a: definitia fn_izo_porti_definitii() inainte = % (asteptat 0839b958877f2c4b82d50905296c7b10)', coalesce(v_x, 'NULL'); END IF;
  v_x := public.fn_izo_porti_e3_definitii();
  IF v_x IS DISTINCT FROM 'ee2e2689d3e35e820f221e93613e5a58' THEN RAISE EXCEPTION '20261230a: definitia fn_izo_porti_e3_definitii() inainte = % (asteptat ee2e2689d3e35e820f221e93613e5a58)', coalesce(v_x, 'NULL'); END IF;
  v_x := public.fn_izo_porti_e3b_definitii();
  IF v_x IS DISTINCT FROM '54d2b5e3f17bc8778589f7e18cc057cd' THEN RAISE EXCEPTION '20261230a: definitia fn_izo_porti_e3b_definitii() inainte = % (asteptat 54d2b5e3f17bc8778589f7e18cc057cd)', coalesce(v_x, 'NULL'); END IF;
  v_x := public.fn_izo_porti_e4_definitii();
  IF v_x IS DISTINCT FROM 'e9b5542202e21594b62997fbfd9ebd12' THEN RAISE EXCEPTION '20261230a: definitia fn_izo_porti_e4_definitii() inainte = % (asteptat e9b5542202e21594b62997fbfd9ebd12)', coalesce(v_x, 'NULL'); END IF;
  v_x := public.fn_izo_porti_e4b_definitii();
  IF v_x IS DISTINCT FROM '1aaa23cc057b6d698c74a29c38887cb9' THEN RAISE EXCEPTION '20261230a: definitia fn_izo_porti_e4b_definitii() inainte = % (asteptat 1aaa23cc057b6d698c74a29c38887cb9)', coalesce(v_x, 'NULL'); END IF;
  -- 3. poarta E2: corpul de pe producție (= 20261109b), proprietățile și ACL-ul exact
  v_x := (SELECT concat_ws('|', md5(p.prosrc), pg_get_userbyid(p.proowner), p.prosecdef::text, coalesce(p.proconfig::text, ''), p.provolatile::text,
                   l.lanname::text, p.prorettype::regtype::text, coalesce(p.proacl::text, ''), (p.prosqlbody IS NULL)::text, p.pronargs::text, p.prokind::text)
        FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_izo_porti_lipsa()'));
  IF v_x IS DISTINCT FROM '3c136ab43387e8d7807efcadb0768dda|postgres|true|{"search_path=public, pg_temp"}|s|plpgsql|text[]|{postgres=X/postgres,izo_registru_writer=X/postgres,izo_doc_editor=X/postgres,izo_receptie_writer=X/postgres,izo_cor_editor=X/postgres,izo_corectie_writer=X/postgres}|true|0|f' THEN
    RAISE EXCEPTION '20261230a: poarta fn_izo_porti_lipsa() nu e cea analizata: %', coalesce(v_x, 'lipsa');
  END IF;
  -- 4. corpurile funcțiilor porților pe care se sprijină analiza
  FOR r IN SELECT * FROM (VALUES
     ('fn_izo_porti_definitii', 'ad3b94b0eb39955db07e6ec1bd5b5e8f'),
     ('fn_izo_porti_e3_lipsa', 'f8510ff654386d504539ca4bbf2427c7'),
     ('fn_izo_porti_e4_lipsa', '6905733e1c2ccddce2a5757757f24b6b')
    ) v(f, m) LOOP
    SELECT md5(p.prosrc) INTO v_x FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || r.f || '()');
    IF v_x IS DISTINCT FROM r.m THEN RAISE EXCEPTION '20261230a: corpul %() = % (asteptat %)', r.f, coalesce(v_x, 'lipsa'), r.m; END IF;
  END LOOP;
  -- 5. amprenta trigger-ului on_auth_user_created, cu expresia porții (c_implicite_revizuite): corpul rescris de 20261119a
  SELECT count(*), max(md5(concat_ws('|', o.type, o.identity, f.identity, pg_get_userbyid(q.proowner), q.prosecdef::text, coalesce(q.proconfig::text, ''),
                                     l.lanname, md5(q.prosrc || '|' || coalesce(q.prosqlbody::text, '')))))
    INTO v_n, v_x
    FROM pg_trigger t JOIN pg_proc q ON q.oid = t.tgfoid JOIN pg_language l ON l.oid = q.prolang
         CROSS JOIN LATERAL pg_identify_object('pg_trigger'::regclass, t.oid, 0) o
         CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
   WHERE t.tgrelid = to_regclass('auth.users') AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;
  IF v_n IS DISTINCT FROM 1 OR v_x IS DISTINCT FROM 'b1858fddd590635b445127fd6c680d97' THEN
    RAISE EXCEPTION '20261230a: trigger on_auth_user_created: % rand(uri), amprenta % (asteptat b1858fddd590635b445127fd6c680d97)', v_n, coalesce(v_x, 'lipsa');
  END IF;
  -- 6. amprentele porților portalului, cu expresia porții (c_dinamice_revizuite)
  FOR r IN SELECT * FROM (VALUES
     ('fn_portal_porti_lipsa()', 'fn_portal_porti_lipsa()=38488af5684b583108b6ca7fc00fcb36'),
     ('fn_portal_porti_lipsa_1b()', 'fn_portal_porti_lipsa_1b()=4e5234fb19aab2a8cdf167c4621e6340')
    ) v(f, e) LOOP
    SELECT format('%s=%s', p.oid::regprocedure::text, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner)
                                                        || '|' || coalesce(p.proacl::text, '') || '|' || p.prosecdef::text))
      INTO v_x FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || r.f);
    IF v_x IS DISTINCT FROM r.e THEN RAISE EXCEPTION '20261230a: poarta portalului % = % (asteptat %)', r.f, coalesce(v_x, 'lipsa'), r.e; END IF;
  END LOOP;
  -- <<< BASELINE 20261230a
  CREATE TEMP TABLE rec_20261230a_inainte ON COMMIT DROP AS
    SELECT 'functie'::text AS tip, p.oid::text AS cheie,
           md5(concat_ws('|', p.proname, p.pronamespace::text, pg_get_userbyid(p.proowner), p.prosecdef::text, coalesce(p.proconfig::text, ''),
                         coalesce(p.proacl::text, ''), p.provolatile::text, p.prolang::text, md5(p.prosrc), coalesce(p.prosqlbody::text, ''),
                         p.proargtypes::text, p.prorettype::text, p.proisstrict::text, p.proleakproof::text, p.proparallel::text, p.prokind::text,
                         p.procost::text, p.prorows::text)) AS val
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
       AND p.oid IS DISTINCT FROM to_regprocedure('public.fn_izo_porti_lipsa()')
    UNION ALL
    SELECT 'comentariu', format('%s:%s:%s', d.classoid, d.objoid, d.objsubid), md5(d.description)
      FROM pg_description d
     WHERE NOT (d.classoid = 'pg_proc'::regclass AND d.objsubid = 0 AND d.objoid IN (
             SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.pronargs = 0
                AND p.proname IN ('fn_izo_porti_definitii', 'fn_izo_porti_e3_definitii', 'fn_izo_porti_e3b_definitii',
                                  'fn_izo_porti_e4_definitii', 'fn_izo_porti_e4b_definitii')));
END $pre$;

-- poarta E2: corpul de pe producție cu EXACT cele două schimbări de listă (c_dinamice_revizuite: + porțile portalului;
-- c_implicite_revizuite: amprenta nouă a trigger-ului on_auth_user_created)
CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v text[] := '{}'; r record;
  BEGIN
    -- triggerele: există și sunt ENABLE ALWAYS ('A' — trag și sub session_replication_role = replica)
    FOR r IN SELECT x.tabel, x.trg, g.tgenabled
               FROM (VALUES ('magazie_bucati','trg_magbuc_izo_garda'), ('magazie_bucati','trg_magbuc_izo_truncate'),
                            ('magazie_bucati_evenimente','trg_izo_ev_garda'), ('magazie_bucati_evenimente','trg_izo_ev_truncate'),
                            ('magazie_bucati_miscari','trg_izo_mis_garda'), ('magazie_bucati_miscari','trg_izo_mis_truncate'),
                            ('izo_importuri','trg_izo_imp_garda'), ('izo_importuri','trg_izo_imp_truncate'),
                            ('izo_proiect_config','trg_izo_cfg_garda'), ('izo_proiect_config','trg_izo_cfg_truncate'),
                            ('izo_atribuiri','trg_izo_atr_garda'), ('izo_atribuiri','trg_izo_atr_truncate'),
                            ('executie_tevi','trg_executie_tevi_izo_delete'), ('executie_tevi','trg_executie_tevi_izo_mutare'),
                            ('executie_pachete_lansare','trg_pachete_izo_delete'), ('executie_pachete_lansare','trg_pachete_izo_mutare'),
                            ('executie_tronsoane','trg_tronsoane_izo_mutare'), ('logistica_depozite','trg_depozite_izo_mutare'),
                            ('executie_proiecte','trg_proiecte_izo_site'),
                            ('executie_tevi','trg_executie_tevi_izo_truncate'), ('executie_pachete_lansare','trg_pachete_izo_truncate'),
                            ('executie_bonuri_consum_linii','trg_bon_linii_izo_bucata')) x(tabel, trg)
               LEFT JOIN pg_trigger g ON g.tgname = x.trg AND g.tgrelid = to_regclass('public.' || x.tabel) AND NOT g.tgisinternal
    LOOP
      IF r.tgenabled IS DISTINCT FROM 'A' THEN v := array_append(v, format('trigger %s.%s (%s)', r.tabel, r.trg, coalesce(r.tgenabled::text, 'lipsă'))); END IF;
    END LOOP;
    -- RLS activ pe tabelele registrului și pe magazie_bucati
    FOR r IN SELECT t.n, c.relrowsecurity FROM unnest(ARRAY['magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri',
                      'magazie_bucati_evenimente','magazie_bucati_miscari']) t(n) LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.n)
    LOOP
      IF r.relrowsecurity IS NOT TRUE THEN v := array_append(v, format('RLS inactiv pe %s', r.n)); END IF;
    END LOOP;
    -- politicile RESTRICTIVE ale clientului pe magazie_bucati
    IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'public.magazie_bucati'::regclass AND NOT p.polpermissive
          AND p.polname IN ('magbuc_izo_client_sel','magbuc_izo_client_ins','magbuc_izo_client_upd','magbuc_izo_client_del')) <> 4 THEN
      v := array_append(v, 'politicile RESTRICTIVE magbuc_izo_client_*');
    END IF;
    -- rolul scriitor: fără BYPASSRLS/LOGIN/SUPERUSER/INHERIT; singurul membru = postgres; niciun rol API nu-l poate prelua
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'izo_registru_writer' AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit) THEN
      v := array_append(v, 'rolul izo_registru_writer (lipsă sau BYPASSRLS/LOGIN/SUPERUSER/INHERIT)');
    -- membri: doar postgres (PG16+: CREATE ROLE de către un non-superuser adaugă automat un rând ADMIN fără SET/INHERIT,
    -- grantor = superuser-ul de bootstrap — pe Supabase supabase_admin; găsit de testul pe branch PG17); SET da, INHERIT nu
    ELSIF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole AND m.member <> 'postgres'::regrole)
       OR NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole AND m.member = 'postgres'::regrole AND m.set_option)
       OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole AND m.inherit_option)
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','authenticator']) a(n)
                   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = a.n) AND pg_has_role(a.n, 'izo_registru_writer', 'MEMBER')) THEN
      v := array_append(v, 'membrii rolului izo_registru_writer');
    END IF;
    -- ACL: clientul nu scrie tabelele registrului și nu execută funcțiile writer-ului
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari']) t(n),
                             unnest(ARRAY['anon','authenticated','service_role']) a(n), unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p(n)
                WHERE to_regclass('public.' || t.n) IS NULL OR has_table_privilege(a.n, 'public.' || t.n, p.n)) THEN
      v := array_append(v, 'ACL de scriere pe tabelele registrului');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) a(n)
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_izo_seteaza_nivel','fn_izo_import_sold_initial','fn_izo_import_storno','fn_izo_activeaza_si_importa')
                  AND has_function_privilege(a.n, p.oid, 'EXECUTE')) THEN
      v := array_append(v, 'EXECUTE din API pe funcțiile registrului');
    END IF;
    -- allowlist pe ACL (invariantul principal, Copilot r6 c): intrările writer-ului se execută DOAR de owner și postgres
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname IN ('fn_izo_seteaza_nivel','fn_izo_import_sold_initial','fn_izo_import_storno','fn_izo_activeaza_si_importa')
                  AND a.privilege_type = 'EXECUTE' AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) NOT IN ('izo_registru_writer','postgres'))) THEN
      v := array_append(v, 'EXECUTE pe funcțiile registrului pentru alt rol decât writer / postgres (allowlist)');
    END IF;
    -- wrapper-e (plasă de siguranță peste allowlist): o funcție cu alt owner decât writer-ul sau un view / o regulă care cheamă funcțiile registrului ar
    -- deveni o cale nouă spre ele (Codex r5 6) — acceptate doar după review, cu actualizarea acestei porți
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.proowner <> 'izo_registru_writer'::regrole
                AND p.oid <> 'public.fn_izo_porti_lipsa()'::regprocedure   -- poarta însăși le numește în verificarea ACL
                -- corpul complet: prosrc (plpgsql / sql clasic) + corpul BEGIN ATOMIC (prosrc gol, corpul în prosqlbody) — review r7
                AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), ''))
                    ~* 'fn_izo_(seteaza_nivel|import_sold_initial|import_storno|activeaza_si_importa)')   -- fără majuscule (N3)
       OR EXISTS (SELECT 1 FROM pg_rewrite rw WHERE pg_get_ruledef(rw.oid) ~* 'fn_izo_(seteaza_nivel|import_sold_initial|import_storno|activeaza_si_importa)') THEN
      v := array_append(v, 'o funcție / un view din afara writer-ului cheamă funcțiile registrului (wrapper nerevizuit)');
    END IF;
    -- CITIRILE (acțiunea 6, Codex r4 / Jakarinos r6–r10): filtrarea citirii (RLS restrictiv + fn_izo_citire) se poate ocoli
    -- fără niciun trigger de scriere printr-un view cu drepturile ownerului sau printr-o funcție DEFINER care întoarce rânduri.
    -- Inventarul de pe live (docs/izometrie/E2A_INVENTAR_CITIRI.md, 21.10.2026): 0 view-uri, 0 funcții care ating
    -- magazie_bucati, 5 DEFINER cu SQL dinamic pe tabele fixe (profiles / executie_proiecte), neexpuse. Porțile de mai jos
    -- refuză activarea dacă apare ceva nou, nerevizuit (r11: porți pe tipuri; r12: închiderea tranzitivă de mai jos):
    -- r12 (Jakarinos + Copilot r11): ÎNCHIDEREA TRANZITIVĂ a tot ce poate citi registrul, până la punct fix:
    --   sămânța = tabelele registrului + funcțiile cu SQL dinamic (pot citi orice tabel) din afara listei revizuite;
    --   se adaugă repetat: view-urile / view-urile materializate care depind (pg_depend → pg_rewrite) de ceva din închidere
    --   (inclusiv cele security_invoker — un DEFINER care le citește le ocolește RLS-ul), și funcțiile (orice schemă
    --   non-sistem, în afara public.fn_izo_*) al căror corp NUMEȘTE ceva din închidere (în public: numele simplu; în alte
    --   scheme: schema.nume) sau depind de el în catalog (corpuri BEGIN ATOMIC).
    -- Refuz dacă în închidere apare: un view fără security_invoker, un view materializat sau o funcție SECURITY DEFINER.
    -- Funcțiile DEFINER cu SQL dinamic din afara listei revizuite sunt refuzate oricum (citesc orice, fără să numească).
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
        'fn_portal_porti_lipsa()=38488af5684b583108b6ca7fc00fcb36',
        'fn_portal_porti_lipsa_1b()=4e5234fb19aab2a8cdf167c4621e6340',
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
      -- cu alternanța numelor din frontieră (r5f: pe bucăți mărginite, nu o singură expresie); corpurile se citesc o dată
      k_oid oid[]; k_corp text[]; k_cale text[]; f_rel oid[]; f_fn oid[]; f_mut oid[]; n_rel oid[]; n_fn oid[]; n_mut oid[];
      -- r5f (#825 NO-GO): tiparele frontierei, pe bucăți: a_x = alternanța (≤ ~4000 de caractere), a_s = schema de platformă
      -- căreia i se aplică (NULL = oricărei funcții)
      a_s text[]; a_x text[];
      k_i int; k_n int; k_s text; k_s2 text; k_adanc oid[] := '{}';
      -- r5g (#825) NO-GO P2: o schemă a platformei urmată (după ghilimele / spații / un punct opțional) de deschiderea unui
      -- comentariu — singura formă în care un comentariu rupe apelul ei calificat
      k_com text := c_st || '(' || array_to_string(c_scheme_platforma, '|') || ')"?[[:space:]]*(\.[[:space:]]*)?(/\*|--)';
      -- r5g (#825) NO-GO P1-D: invocările implicite revizuite, de pe prod — singurele obiecte din catalog care cheamă implicit o
      -- funcție din închiderea de pe prod sau (r5h) un mutator de cale; citite read-only 22.10.2026 (baseline_pre_e3.json, cheia
      -- „implicite”). r5h (#825 r5g NO-GO, Jak P1): amprenta = md5(tip | identitate | funcția | owner | SECURITY DEFINER |
      -- proconfig | limbaj | md5(corp)) — CU corpul: un corp schimbat (același owner / config) nu mai păstrează excepția. Un
      -- upgrade Supabase care schimbă corpul uneia dintre funcțiile de platformă înroșește poarta (fail-closed): captură nouă
      -- + review + migrare (design §17)
      c_implicite_revizuite constant text[] := ARRAY[
        'event trigger issue_graphql_placeholder=2aa685a004bc87f7a10ef72d134a88bb',
        'event trigger issue_pg_graphql_access=7ed4741489f49636791f930411cfb345',
        'event trigger issue_pg_net_access=d62f8ab601b809080c679266fbdb8a06',
        'trigger a01_ofertare_cantitati_lot_canonic on public.ofertare_cantitati=62d07782ee60e73b327be8c82d4dd34b',
        'trigger a01_ofertare_cerinte_lot_canonic on public.ofertare_cerinte=b2b9b1f753fae9e4f8a7a10ee6c6b351',
        'trigger on_auth_user_created on auth.users=b1858fddd590635b445127fd6c680d97',
        'trigger prevent_role_escalation_trigger on public.profiles=06b7e4fcaab58c9a3faecb7ff4856b45',
        'trigger tr_check_filters on realtime.subscription=ed76f4ff4e3c6abd998eded3d159d3c3',
        'trigger trg_employees_persoana_lock on public.employees=9dcecd0c70efdf1bf5e24e9c1157bc11',
        'trigger trg_employees_zz_ciclu_cont on public.employees=8b5dbbd69476106544cff2b5393c116a',
        'trigger trg_enforce_owner_only_salary_flags on public.profiles=46f1b6af2f30d56993ca988b267e76d8',
        'trigger trg_hr_autorizatii_rsvti_doar_rpc on public.hr_autorizatii=9a7f49627ab4e62e14aa43252a2ab56e',
        'trigger trg_hr_employees_private_persoana_lock on public.hr_employees_private=32261dc19c5d0da91f0487ab2f33bb08',
        'trigger trg_profiles_campuri_owner_only on public.profiles=e80a3aed6ff3f2055785bdc974702cd5',
        'trigger trg_protect_can_access_pontaj_brut on public.profiles=3a58112eec4c06bef2d66159ad6f82a5'];
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
      -- r5f (#825): + tabelele documentelor E3 — RLS cu citire prin fn_izo_citire, ca registrul (design §13.2): un DEFINER /
      -- un view fără security_invoker / un lanț din afara fn_izo_* care ajunge la ele e refuzat la fel. Funcțiile E3 legitime
      -- (fn_izo_doc_* / fn_izo_scan_*, owner izo_doc_editor / izo_receptie_writer / postgres) sunt fn_izo_*: în afara
      -- închiderii, ca la E2a, și acoperite de ștampila E2a (fn_izo_porti_definitii: owner, corp, config, ACL)
      c_rel := c_rel || ARRAY(SELECT c.oid FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('izo_documente_intrare','izo_documente_intrare_randuri','izo_documente_scanuri'));
      -- r5g (#825) NO-GO P1-C: + TOATE funcțiile public.fn_izo_* ca ȚINTE (nu candidați): cititorii INVOKER ai documentelor
      -- (owner postgres) și DEFINER-ele interne citesc ce RLS-ul ascunde; un DEFINER / view / lanț din afara fn_izo_* care le
      -- cheamă (după nume, BEGIN ATOMIC, view, operator / cast / agregat) intră în închidere, ca un cititor direct. După
      -- propagare ele ies din c_fn (mai jos): sunt API-ul revizuit, sub ștampila E2a. Invocările lor implicite din catalog
      -- (trigger / politică / DEFAULT / CHECK …) sunt fixate de ștampila E3 (fn_izo_porti_e3_definitii)
      c_fn := c_fn || ARRAY(SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_%');
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
      -- r5f (#825 NO-GO): un comentariu între schemă și nume („storage/**/.f()”, „storage -- x⏎.f()”) ascunde forma calificată —
      -- contează la schemele platformei, unde necalificatul cere calea. Corpului i se adaugă o copie fără comentarii (blocurile
      -- imbricate din interior spre exterior, până la punct fix; apoi „--” până la capăt de rând). Copia doar ADAUGĂ potriviri
      -- (originalul rămâne): un „/*” sau „--” dintr-un șir taie din copie, nu din original. Cel mult 20 de niveluri (fiecare nivel
      -- = o trecere peste tot corpul — fără plafon, mii de comentarii imbricate ar ține poarta minute întregi): mai adânc → corpul
      -- nu se poate citi sigur, intră în sămânță ca SQL-ul dinamic (k_adanc, mai jos)
      -- r5g (#825, Copilot P1): copia nu înțelege literalii — un „--” / „/*” dintr-un șir taie din copie chiar apelul ascuns
      -- de comentariu („x := '--'; PERFORM storage /* c */ . f();”), iar originalul nu-l are calificat. Fail-closed, fără
      -- tokenizer: calea devine NECUNOSCUTĂ (NULL, în ambele bucle) și numele schemei se potrivesc în corp necalificat.
      -- r5g (#825) NO-GO P2: nu la orice „/*” / „--” (pe prod: 192 de corpuri, 162 DEFINER — un comentariu + „CAST(” /
      -- „send” / „search” ar fi înroșit poarta), ci doar când o schemă a platformei e urmată de deschiderea unui comentariu
      -- (k_com), pe ORIGINAL: comentariul care rupe apelul apare textual acolo, deci un literal nu-l poate ascunde; pe prod: 0
      -- corpuri. La celelalte scheme necalificatul se potrivește oricum, deci forma calificată ruptă nu ascunde nimic
      FOR k_i IN 1 .. cardinality(k_corp) LOOP
        IF k_corp[k_i] ~* k_com THEN k_cale[k_i] := NULL; END IF;
        k_s := k_corp[k_i]; k_n := 0;
        LOOP
          k_s2 := regexp_replace(k_s, '/\*([^*/]|\*+[^*/]|/+[^*/])*\*+/', ' ', 'g');
          EXIT WHEN k_s2 = k_s;
          k_s := k_s2; k_n := k_n + 1;
          IF k_n >= 20 THEN k_adanc := k_adanc || k_oid[k_i]; EXIT; END IF;
        END LOOP;
        k_s := regexp_replace(k_s, '--[^\n]*', ' ', 'g');
        IF k_s <> k_corp[k_i] THEN k_corp[k_i] := k_corp[k_i] || ' ' || k_s; END IF;
      END LOOP;
      -- r5f (#825 NO-GO): în sămânță și funcțiile care pot citi un tabel FĂRĂ să-i scrie numele și fără EXECUTE — identificatori
      -- U&"…" (escape-uri Unicode), SQL dat ca text (query/table/schema/database_to_xml, ts_stat / ts_rewrite, crosstab /
      -- connectby, dblink), fișierele / paginile tabelelor (pg_read_[binary_]file, lo_import, get_raw_page); ca SQL-ul
      -- dinamic: un DEFINER care le conține (sau le cheamă) e refuzat. Mai strict decât E2a, care le lasă verzi. Tot aici:
      -- corpurile cu comentarii imbricate peste plafon (k_adanc)
      c_fn := c_fn || ARRAY(SELECT k.oid FROM unnest(k_oid, k_corp) k(oid, corp) WHERE k.oid <> ALL (c_fn)
                              AND (k.oid = ANY (k_adanc)
                                   OR k.corp ~* ('u&"|\m(query|table|schema|database)_to_xml|\mts_(stat|rewrite)\M|\m(crosstab|connectby|dblink)'
                                                 || '|\mpg_read_(binary_)?file\M|\mlo_import\M|\mget_raw_page\M')));
      -- mutatorii de cale (r15): sămânța = corp cu set_config / search_path; propagați până la punct fix
      SELECT coalesce(array_agg(k.oid), '{}') INTO c_mut FROM unnest(k_oid, k_corp) k(oid, corp) WHERE k.corp ~* '(set_config|search_path)';
      f_mut := c_mut; v_iter := 0;
      WHILE cardinality(f_mut) > 0 AND v_iter < 100 LOOP
        v_iter := v_iter + 1;
        -- r5f (#825 NO-GO): tiparele pe BUCĂȚI de ~4000 de caractere, nu o singură alternanță: cu ~1000 de nume lungi în
        -- frontieră, motorul de regex refuză („invalid memory alloc request size” / „regular expression is too complex”) —
        -- poarta ar da eroare unde E2a răspunde (testul „frontieră largă”), iar compilarea crește pătratic. Fiecare nume dă două
        -- alternative: calificat (s = NULL, oricui) și necalificat (s = NULL în afara platformei; s = schema platformei: doar
        -- dacă e în calea fixată a funcției sau calea e nefixată).
        -- r5f (#825 NO-GO, P1): și SCHEMA se escapează (nsx), ca numele: o schemă construită („x)(?=x)y(x”) ar închide grupul
        -- comun și ar face bucata (deci toate numele ei) imposibil de potrivit — verde fals; nsp (brut) rămâne doar pentru s
        WITH t AS (SELECT n2.nspname::text nsp, regexp_replace(n2.nspname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nsx,
                          regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                     FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_mut)),
             y AS (SELECT NULL::text s, t.nsx || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume f FROM t
                   UNION ALL SELECT CASE WHEN t.nsp = ANY (c_scheme_platforma) THEN t.nsp END, t.nume FROM t)
        SELECT coalesce(array_agg(z.s), '{}'), coalesce(array_agg(c_st || '(' || z.alt || ')' || c_dr), '{}') INTO a_s, a_x
          FROM (SELECT y2.s, string_agg(y2.f, '|') alt
                  FROM (SELECT y.s, y.f, (sum(length(y.f) + 1) OVER (PARTITION BY y.s ORDER BY y.f ROWS UNBOUNDED PRECEDING) - 1) / 4000 b FROM y) y2
                 GROUP BY y2.s, y2.b) z;
        -- bucata în exterior (LATERAL … OFFSET 0: nu se aplatizează), corpurile în interior — fiecare tipar se compilează o dată;
        -- CASE fixează ordinea: întâi filtrele ieftine, regex-ul ultimul (planificatorul l-ar evalua primul)
        n_mut := ARRAY(SELECT DISTINCT m.oid FROM unnest(a_s, a_x) p(s, x)
                         CROSS JOIN LATERAL (SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale)
                                              WHERE CASE WHEN k.oid = ANY (c_mut) THEN false
                                                         WHEN p.s IS NULL OR k.cale IS NULL OR p.s = ANY (string_to_array(k.cale, ',')) THEN k.corp ~* p.x
                                                         ELSE false END OFFSET 0) m);
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
        -- r5f (#825 NO-GO): aceleași bucăți de tipare ca la mutatori, cu schema escapată (P1; vezi mai sus)
        WITH t AS (SELECT n2.nspname::text nsp, regexp_replace(n2.nspname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nsx,
                          regexp_replace(c.relname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                     FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE c.oid = ANY (f_rel)
                   UNION
                   SELECT n2.nspname::text, regexp_replace(n2.nspname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'),
                          regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
                     FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_fn)),
             y AS (SELECT NULL::text s, t.nsx || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume f FROM t
                   UNION ALL SELECT CASE WHEN t.nsp = ANY (c_scheme_platforma) THEN t.nsp END, t.nume FROM t)
        SELECT coalesce(array_agg(z.s), '{}'), coalesce(array_agg(c_st || '(' || z.alt || ')' || c_dr), '{}') INTO a_s, a_x
          FROM (SELECT y2.s, string_agg(y2.f, '|') alt
                  FROM (SELECT y.s, y.f, (sum(length(y.f) + 1) OVER (PARTITION BY y.s ORDER BY y.f ROWS UNBOUNDED PRECEDING) - 1) / 4000 b FROM y) y2
                 GROUP BY y2.s, y2.b) z;
        -- schemele platformei: necalificat doar dacă schema e în calea funcției; calea e necunoscută dacă nu e fixată SAU dacă
        -- funcția e mutator (r15)
        n_fn := ARRAY(SELECT DISTINCT m.oid FROM unnest(a_s, a_x) p(s, x)
                        CROSS JOIN LATERAL (SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale)
                                             WHERE CASE WHEN k.oid = ANY (c_fn) THEN false
                                                        WHEN p.s IS NULL OR k.oid = ANY (c_mut) OR k.cale IS NULL OR p.s = ANY (string_to_array(k.cale, ','))
                                                          THEN k.corp ~* p.x
                                                        ELSE false END OFFSET 0) m);
        -- sau depind de ceva din frontieră în catalog (BEGIN ATOMIC)
        n_fn := n_fn || ARRAY(SELECT k.oid FROM unnest(k_oid) k(oid) WHERE k.oid <> ALL (c_fn) AND k.oid <> ALL (n_fn)
                                AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = k.oid
                                               AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                                                    OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn)))));
        c_fn := c_fn || n_fn;
        f_rel := n_rel; f_fn := n_fn;
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;
      -- r5f (#825 NO-GO, P1): un element al închiderii (sau mutator) al cărui nume nu se poate căuta sigur în corpuri → refuz:
      -- schemă cu caractere speciale de regex (E2a dă eroare pe ea, deci rămâne închisă — poarta nouă refuză la fel, nu dă
      -- verde) sau ghilimele în schemă / nume (în corp apar dublate, „"x""y"” — nicio expresie nu le găsește; în E2a: verde fals)
      IF EXISTS (SELECT 1 FROM (SELECT c.relname::text nume, c.relnamespace ns FROM pg_class c WHERE c.oid = ANY (c_rel)
                                UNION ALL SELECT q.proname::text, q.pronamespace FROM pg_proc q WHERE q.oid = ANY (c_fn || c_mut)) o
                  JOIN pg_namespace n2 ON n2.oid = o.ns
                 WHERE n2.nspname ~ '[.^$*+?()\[\]{}|\\"]' OR o.nume ~ '"') THEN
        v := array_append(v, 'un nume din închiderea citirilor nu se poate căuta sigur în corpuri (schemă cu caractere speciale de regex / nume cu ghilimele) (citire nerevizuită)');
      END IF;
      -- r5g (#825, Jak P1): invocarea IMPLICITĂ cheamă o funcție fără să-i scrie numele — operatorul (oprcode / oprrest /
      -- oprjoin: „OPERATOR(s.#!#) x”, infix / prefix), cast-ul (castfunc: „x::tip”), agregatul (aggtransfn / aggfinalfn /
      -- aggcombinefn / aggserialfn / aggdeserialfn / aggmtransfn / aggminvtransfn / aggmfinalfn; agregatul e prolang
      -- internal, deci nu e candidat și numele lui nu se caută); corpurile ne-ATOMIC n-au nici dependențe în catalog. Nu se
      -- propagă (forma infix nu se poate căuta sigur în corpuri): funcția-suport în închidere sau mutator de cale → refuz
      -- explicit, oricine ar folosi operatorul / cast-ul / agregatul (fals-pozitive acceptate). Pe prod: 0 (suportul din afara
      -- pg_catalog e doar C, în extensions — niciodată candidat). Celelalte obiecte din catalog: regula P1-D, mai jos
      FOR k_s IN SELECT x.d FROM (
          SELECT format('operator %s → %s', o.oid::regoperator, f.f::regprocedure) d
            FROM pg_operator o CROSS JOIN LATERAL unnest(ARRAY[o.oprcode::oid, o.oprrest::oid, o.oprjoin::oid]) f(f)
           WHERE f.f = ANY (c_fn || c_mut)
          UNION
          SELECT format('cast (%s AS %s) → %s', c.castsource::regtype, c.casttarget::regtype, c.castfunc::regprocedure)
            FROM pg_cast c WHERE c.castfunc = ANY (c_fn || c_mut)
          UNION
          SELECT format('agregat %s → %s', a.aggfnoid::regprocedure, f.f::regprocedure)
            FROM pg_aggregate a CROSS JOIN LATERAL unnest(ARRAY[a.aggtransfn::oid, a.aggfinalfn::oid, a.aggcombinefn::oid, a.aggserialfn::oid,
                                                                a.aggdeserialfn::oid, a.aggmtransfn::oid, a.aggminvtransfn::oid, a.aggmfinalfn::oid]) f(f)
           WHERE f.f = ANY (c_fn || c_mut)) x
        ORDER BY x.d COLLATE "C"
      LOOP
        v := array_append(v, 'invocare implicită neanalizată: ' || k_s || ' (funcție-suport din închiderea citirilor sau mutator de cale) (citire nerevizuită)');
      END LOOP;
      -- r5g (#825) NO-GO P1-C: țintele fn_izo_* ies din c_fn după propagare (API-ul revizuit, sub ștampila E2a; un DEFINER
      -- fn_izo_* nu e „DEFINER din afara registrului”). Fără sămânța E3 c_fn nu conține fn_izo_* (nici candidați, nici
      -- SQL dinamic), deci aici nu schimbă nimic
      c_fn := ARRAY(SELECT x.f FROM unnest(c_fn) x(f) JOIN pg_proc q ON q.oid = x.f
                     WHERE NOT (q.pronamespace = 'public'::regnamespace AND q.proname LIKE 'fn\_izo\_%'));
      -- r5g (#825) NO-GO P1-D: invocarea implicită prin EXPRESII DIN CATALOG — CHECK pe domeniu / tabel, DEFAULT, coloană
      -- generată, expresie de index, trigger (și event trigger), politică, statistici, I/O de tip, clasă de operatori …: un
      -- DEFINER care scrie / convertește / sortează le pornește fără să numească funcția. Orice rând pg_depend spre o funcție
      -- din închidere al cărui obiect nu e propagat mai sus (view / regulă: pg_rewrite; funcție: pg_proc — candidații prin
      -- propagare, agregatele prin regula de deasupra; operator / cast: regula de deasupra) → refuz explicit, cu obiectul numit,
      -- în afara listei revizuite (c_implicite_revizuite).
      -- r5h (#825 r5g NO-GO, Jak P1): și spre MUTATORII de cale (c_mut), ca spre închidere: un trigger INVOKER care face
      -- set_config('search_path', 'storage, public', true) pe un tabel auxiliar, pornit de un DEFINER cu cale fixă care inserează
      -- acolo și apoi cheamă necalificat un cititor de platformă, schimbă calea efectivă FĂRĂ ca DEFINER-ul să numească mutatorul
      -- (deci el nu devine mutator, iar apelul necalificat se judecă pe calea declarată). Refuz explicit, cu obiectul numit; pe
      -- prod: 12 obiecte peste mutatori (11 trigger-e + issue_graphql_placeholder; tr_check_filters / issue_pg_net_access și în
      -- închidere), toate pe lista revizuită, cu corpul în amprentă
      FOR k_s IN SELECT x.d FROM (
          SELECT DISTINCT format('%s → %s%s', pg_describe_object(d.classid, d.objid, d.objsubid), d.refobjid::regprocedure,
                                 CASE WHEN d.refobjid = ANY (c_fn) THEN ' (obiect din catalog care cheamă o funcție din închiderea citirilor)'
                                      ELSE ' (obiect din catalog care cheamă un mutator de cale)' END) d
            FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid JOIN pg_language l ON l.oid = q.prolang
                 CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
                 CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, q.oid, 0) f
           WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (c_fn || c_mut)
             AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass, 'pg_operator'::regclass, 'pg_cast'::regclass)
             AND format('%s %s=%s', o.type, o.identity, md5(concat_ws('|', o.type, o.identity, f.identity, pg_get_userbyid(q.proowner), q.prosecdef::text, coalesce(q.proconfig::text, ''), l.lanname, md5(q.prosrc || '|' || coalesce(q.prosqlbody::text, ''))))) <> ALL (c_implicite_revizuite)) x
        ORDER BY x.d COLLATE "C"
      LOOP
        v := array_append(v, 'invocare implicită neanalizată: ' || k_s || ' (citire nerevizuită)');
      END LOOP;
      IF EXISTS (SELECT 1 FROM pg_class vw WHERE vw.oid = ANY (c_rel)   -- alias ≠ variabila v
                  AND (vw.relkind = 'm' OR (vw.relkind = 'v' AND NOT coalesce(vw.reloptions && ARRAY['security_invoker=true','security_invoker=on','security_invoker=1'], false)))) THEN
        v := array_append(v, 'un view / view materializat citește registrul fără security_invoker (citire nerevizuită)');
      END IF;
      IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = ANY (c_fn) AND p.prosecdef) THEN
        v := array_append(v, 'o funcție DEFINER din afara registrului poate citi registrul — direct, prin view sau tranzitiv (citire nerevizuită)');
      END IF;
    END;
    -- writer-ul are exact ce-i trebuie (un GRANT retras ar lăsa activarea admisă și importul nefuncțional)
    -- câte un privilegiu pe rând: has_table_privilege(…, 'A,B') e adevărat dacă există ORICARE (Codex r4 8)
    IF EXISTS (SELECT 1 FROM (VALUES ('magazie_bucati','SELECT'), ('magazie_bucati','INSERT'), ('magazie_bucati','UPDATE'),
                                     ('magazie_bucati_evenimente','SELECT'), ('magazie_bucati_evenimente','INSERT'),
                                     ('magazie_bucati_miscari','SELECT'), ('magazie_bucati_miscari','INSERT'),
                                     ('izo_importuri','SELECT'), ('izo_importuri','INSERT'), ('izo_importuri','UPDATE'),
                                     ('izo_proiect_config','SELECT'), ('izo_proiect_config','INSERT'), ('izo_proiect_config','UPDATE'),
                                     ('izo_atribuiri','SELECT')) d(t, pr)
                WHERE NOT has_table_privilege('izo_registru_writer', 'public.' || d.t, d.pr))
       OR NOT (true
            AND has_sequence_privilege('izo_registru_writer', 'public.izo_server_ver_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.magazie_bucati_id_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.magazie_bucati_evenimente_id_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.magazie_bucati_miscari_id_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.izo_importuri_id_seq', 'USAGE')) THEN
      v := array_append(v, 'drepturile writer-ului (tabele / secvențe) incomplete');
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) a(n) WHERE has_table_privilege(a.n, 'public.magazie_bucati', 'TRUNCATE')) THEN
      v := array_append(v, 'TRUNCATE pe magazie_bucati pentru un rol API');
    END IF;
    -- definițiile (nu doar numele): amprenta curentă = cea fixată la migrare (review #806 r2)
    IF public.fn_izo_porti_definitii() IS DISTINCT FROM
       substring(obj_description('public.fn_izo_porti_definitii()'::regprocedure, 'pg_proc') FROM '^porti=([0-9a-f]{32})$') THEN
      v := array_append(v, 'definițiile porților diferă de amprenta de la migrare (trigger / politică / funcție / ACL modificat)');
    END IF;
    -- E3 (20261103b): poarta documentelor de intrare, chemată de aici, ca orice activare / import E2a s-o includă (r5d §13.1)
    v := v || public.fn_izo_porti_e3_lipsa();
    v := v || public.fn_izo_porti_e3b_lipsa();
    v := v || public.fn_izo_porti_e4_lipsa();
    v := v || public.fn_izo_porti_e4b_lipsa();
    RETURN v;
  END $f$;

-- ștampilele, DUPĂ corpul nou (ca 20261120a)
DO $stampile$
BEGIN
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L', 'porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L', 'porti_e4=' || public.fn_izo_porti_e4_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());
END $stampile$;

DO $post$
DECLARE v_x text; v_lipsa text[]; r record;
BEGIN
  -- 1. poarta: corpul nou, aceleași proprietăți, același ACL
  v_x := (SELECT concat_ws('|', md5(p.prosrc), pg_get_userbyid(p.proowner), p.prosecdef::text, coalesce(p.proconfig::text, ''), p.provolatile::text,
                   l.lanname::text, p.prorettype::regtype::text, coalesce(p.proacl::text, ''), (p.prosqlbody IS NULL)::text, p.pronargs::text, p.prokind::text)
        FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_izo_porti_lipsa()'));
  IF v_x IS DISTINCT FROM '23da4c3c9e4639f3600197f3d7b88977|postgres|true|{"search_path=public, pg_temp"}|s|plpgsql|text[]|{postgres=X/postgres,izo_registru_writer=X/postgres,izo_doc_editor=X/postgres,izo_receptie_writer=X/postgres,izo_cor_editor=X/postgres,izo_corectie_writer=X/postgres}|true|0|f' THEN
    RAISE EXCEPTION '20261230a: postconditie poarta E2: %', coalesce(v_x, 'lipsa');
  END IF;
  -- 2. ștampilele = definiția curentă; E3 / E3b / E4 = exact definițiile de dinainte; E2a / E4b s-au schimbat (includ corpul porții)
  FOR r IN SELECT * FROM (VALUES
     ('fn_izo_porti_definitii', 'porti', '0839b958877f2c4b82d50905296c7b10', false),
     ('fn_izo_porti_e3_definitii', 'porti_e3', 'ee2e2689d3e35e820f221e93613e5a58', true),
     ('fn_izo_porti_e3b_definitii', 'porti_e3b', '54d2b5e3f17bc8778589f7e18cc057cd', true),
     ('fn_izo_porti_e4_definitii', 'porti_e4', 'e9b5542202e21594b62997fbfd9ebd12', true),
     ('fn_izo_porti_e4b_definitii', 'porti_e4b', '1aaa23cc057b6d698c74a29c38887cb9', false)
    ) v(f, pref, acum, egal) LOOP
    EXECUTE format('SELECT public.%I()', r.f) INTO v_x;
    IF v_x IS NULL OR v_x !~ '^[0-9a-f]{32}$' OR obj_description(to_regprocedure('public.' || r.f || '()'), 'pg_proc') IS DISTINCT FROM r.pref || '=' || v_x
       OR (v_x = r.acum) IS DISTINCT FROM r.egal THEN
      RAISE EXCEPTION '20261230a: postconditie stampila %(): definitia %, stampila %, inainte %', r.f, coalesce(v_x, 'NULL'),
        coalesce(obj_description(to_regprocedure('public.' || r.f || '()'), 'pg_proc'), 'lipsa'), r.acum;
    END IF;
  END LOOP;
  -- nimic altceva atins: restul funcțiilor (corp, drepturi, proprietăți) și comentariile, identice cu instantaneul de la început
  IF EXISTS (SELECT tip, cheie, val FROM rec_20261230a_inainte EXCEPT
             SELECT 'functie'::text, p.oid::text,
                    md5(concat_ws('|', p.proname, p.pronamespace::text, pg_get_userbyid(p.proowner), p.prosecdef::text, coalesce(p.proconfig::text, ''),
                                  coalesce(p.proacl::text, ''), p.provolatile::text, p.prolang::text, md5(p.prosrc), coalesce(p.prosqlbody::text, ''),
                                  p.proargtypes::text, p.prorettype::text, p.proisstrict::text, p.proleakproof::text, p.proparallel::text, p.prokind::text,
                                  p.procost::text, p.prorows::text))
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
                AND p.oid IS DISTINCT FROM to_regprocedure('public.fn_izo_porti_lipsa()')
             UNION ALL
             SELECT 'comentariu', format('%s:%s:%s', d.classoid, d.objoid, d.objsubid), md5(d.description)
               FROM pg_description d
              WHERE NOT (d.classoid = 'pg_proc'::regclass AND d.objsubid = 0 AND d.objoid IN (
                      SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.pronargs = 0
                         AND p.proname IN ('fn_izo_porti_definitii', 'fn_izo_porti_e3_definitii', 'fn_izo_porti_e3b_definitii',
                                           'fn_izo_porti_e4_definitii', 'fn_izo_porti_e4b_definitii'))))
     OR (SELECT count(*) FROM rec_20261230a_inainte) IS DISTINCT FROM
        ((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
             AND p.oid IS DISTINCT FROM to_regprocedure('public.fn_izo_porti_lipsa()'))
         + (SELECT count(*) FROM pg_description d
             WHERE NOT (d.classoid = 'pg_proc'::regclass AND d.objsubid = 0 AND d.objoid IN (
                     SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.pronargs = 0
                        AND p.proname IN ('fn_izo_porti_definitii', 'fn_izo_porti_e3_definitii', 'fn_izo_porti_e3b_definitii',
                                          'fn_izo_porti_e4_definitii', 'fn_izo_porti_e4b_definitii'))))) THEN
    RAISE EXCEPTION '20261230a: alta functie sau alt comentariu s-a schimbat in tranzactie (in afara portii E2 si a celor 5 stampile) - refuz';
  END IF;
  -- 3. toate porțile verzi
  v_lipsa := public.fn_izo_porti_lipsa();
  IF v_lipsa IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION '20261230a: postconditie porti: %', v_lipsa; END IF;
END $post$;
