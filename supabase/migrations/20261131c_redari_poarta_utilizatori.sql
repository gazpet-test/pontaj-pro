-- Baseline 30l/30m preluat din fisierele revizuite din repo, NU recitit live in aceasta sesiune.
-- PR3a juridic#040. DOAR FISIERE, NEAPLICATA. Niciun sablon / import / date reale.
-- Runner: BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261131c_redari_poarta_utilizatori:' || txid_current(), true);
-- apoi acest fisier; COMMIT (sau DRY + ROLLBACK). Garda cu txid interzice pornirea accidentala.
-- Politici si ACL existente NESCHIMBATE; CREATE OR REPLACE pastreaza owner/ACL RPC.
-- Inventar 30l/30m: RPC rezerva (toate canalele); numar_document si garda_rezerva raman;
-- informare_garda ramane; noul trigger acopera INSERT/PATCH, regenerare si expediere, inclusiv schimbarea tintei/canalului.
-- Anulare/stergere logica/AR/tracking raman permise. Fara bypass de mentenanta la poarta noua.
-- Ordine lock: convocari -> proiecte pentru DDL; RPC: advisory -> detinator/parcela -> proiect; trigger: detinator/parcela -> proiect.
-- Rollback refuza orice aprobare (inclusiv revocata) / istoric; toate coloanele noi au default sigur.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131c_redari_poarta_utilizatori:' || txid_current() THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_convocari') IS NULL OR to_regclass('public.red_detinatori') IS NULL OR to_regclass('public.red_parcele') IS NULL
     OR to_regclass('public.red_uat') IS NULL OR to_regclass('public.red_proiecte') IS NULL OR to_regclass('public.red_numere') IS NULL THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: lipseste schema Redari (red_convocari, red_detinatori, red_parcele, red_uat, red_proiecte, red_numere)';
  END IF;
  -- coloanele citite / scrise (baseline read-only pe live 04.11.2026)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_convocari'
        AND column_name IN ('id', 'detinator_id', 'canal', 'nr_document', 'data_expediere', 'stare', 'sters_la', 'created_by', 'created_at', 'plic_id')) <> 10
     OR (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_convocari' AND column_name = 'created_by') IS DISTINCT FROM 'auth.uid()'
     OR (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_convocari' AND column_name = 'stare') IS DISTINCT FROM '''activ''::text'
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_detinatori' AND column_name IN ('id', 'parcela_id', 'calitate', 'sters_la')) <> 4
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name IN ('id', 'proiect_id', 'uat_id', 'tronson', 'sters_la')) <> 5
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_uat'
           AND column_name IN ('id', 'proiect_id', 'uat3', 'sesiune_zi1', 'sesiune_zi2', 'sesiune_zi3', 'program_zi1', 'program_zi2', 'program_zi3')) <> 9
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte'
           AND column_name IN ('id', 'contract_nr', 'contract_data', 'imputernicire_nr', 'imputernicire_data', 'contact_nume', 'contact_telefon', 'contact_email', 'text_gdpr', 'reprezentant_tgz_nume', 'reprezentant_tgz_telefon')) <> 11 THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: coloanele Redari au alta forma';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.red_convocari'::regclass AND conname = 'red_convocari_canal_check')
       IS DISTINCT FROM 'CHECK ((canal = ANY (ARRAY[''posta''::text, ''sms''::text, ''email''::text, ''afisare''::text, ''telefon''::text])))'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.red_convocari'::regclass AND conname = 'red_convocari_stare_check')
       IS DISTINCT FROM 'CHECK ((stare = ANY (ARRAY[''activ''::text, ''anulat''::text])))' THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: CHECK-urile canal / stare pe red_convocari nu mai sunt cele revizuite';
  END IF;
  -- L15: amprenta completă a lanțului apelat (direct + triggere + tranzitiv până la frunze): limbaj, SECURITY DEFINER, volatilitate, search_path,
  -- owner, md5(corp), ACL (sortat). Baseline citit read-only pe live 04.11.2026. Orice schimbare = refuz + review.
  IF (SELECT string_agg(f, ';' ORDER BY f COLLATE "C") FROM (
        SELECT p.oid::regprocedure::text || '|' || l.lanname || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(p.proconfig::text, '') || '|'
               || pg_get_userbyid(p.proowner) || '|' || md5(p.prosrc) || '|' || coalesce((SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(p.proacl::text[]) a)::text, '') AS f
          FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
         WHERE p.oid IN (to_regprocedure('public.fn_red_nivel()'), to_regprocedure('public.fn_red_numar_document(text,text,integer)'),
                         to_regprocedure('public.fn_red_plic_garda_persoana(uuid)'), to_regprocedure('public.fn_red_plic_incearca_lock_detinator(uuid)'),
                         to_regprocedure('public.fn_red_plic_incearca_lock(uuid)'), to_regprocedure('public.fn_red_plic_uat_detinator(uuid)'),
                         to_regprocedure('public.fn_red_cheie_persoana(uuid)'), to_regprocedure('public.fn_red_cheie_calc(text,text,text,text,text,text,boolean)'),
                         to_regprocedure('public.fn_red_convocari_posta_garda()'), to_regprocedure('public.fn_red_legaturi()'), to_regprocedure('public.fn_red_jurnal()'),
                         to_regprocedure('auth.uid()'), to_regprocedure('auth.jwt()'), to_regprocedure('auth.role()'))) z)
     IS DISTINCT FROM
       'auth.jwt()|sql|false|s||supabase_auth_admin|2db09c3fc855ba90e71d3ae28cfadae3|{=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin,postgres=X/supabase_auth_admin,supabase_auth_admin=X/supabase_auth_admin};'
    || 'auth.role()|sql|false|s||supabase_auth_admin|f31486fed08a7402e89d4aa71b0ad273|{=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin,supabase_auth_admin=X/supabase_auth_admin};'
    || 'auth.uid()|sql|false|s||supabase_auth_admin|cdef18c69c4f4cbbced2eaf81e628b49|{=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin,supabase_auth_admin=X/supabase_auth_admin};'
    || 'fn_red_cheie_calc(text,text,text,text,text,text,boolean)|sql|true|s|{"search_path=public, pg_temp"}|postgres|826d79dd53dc47c14410ed8ce0a6ce12|{postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_cheie_persoana(uuid)|sql|true|s|{"search_path=public, pg_temp"}|postgres|2d2a98bf9d8747668718c5a7eb6404e7|{postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_convocari_posta_garda()|plpgsql|false|v|{"search_path=public, pg_temp"}|postgres|27f9e3fd61880e97cb43fc7599536ed3|{postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_jurnal()|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|27479409c823996f436459089945c789|{postgres=X/postgres};'
    || 'fn_red_legaturi()|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|d1912ec6514cba162babea3bcebdfb24|{postgres=X/postgres};'
    || 'fn_red_nivel()|sql|true|s|{"search_path=public, pg_temp"}|postgres|21db8e5d4b69b7f19e571a7087c361ae|{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_numar_document(text,text,integer)|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|002a8dbb14f9a69db48d0b4c0428fef0|{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_plic_garda_persoana(uuid)|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|4c1f0bb4757c68630989e5e464b7682f|{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_plic_incearca_lock(uuid)|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|af77d2e7c85bdea490f76b12eb18dff1|{postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_plic_incearca_lock_detinator(uuid)|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|c7b8cff21c1999435246f84e085b7aea|{postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_plic_uat_detinator(uuid)|sql|true|v|{"search_path=public, pg_temp"}|postgres|f837713cf4f3373ae7f9a46dd60210f9|{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: lantul de functii apelate nu mai are amprenta revizuita (limbaj / DEFINER / volatilitate / search_path / owner / corp / ACL)';
  END IF;
  -- triggerele exacte: nume = functie / enabled / tip / WHEN / nr. argumente / argumente / coloane (tgattr)
  IF (SELECT string_agg(f, ';' ORDER BY f COLLATE "C") FROM (
        SELECT tgrelid::regclass::text || '.' || tgname::text || '=' || tgfoid::regprocedure::text || '/' || tgenabled::text || '/' || tgtype::text || '/'
               || coalesce(pg_get_expr(tgqual, tgrelid), '') || '/' || tgnargs::text || '/' || encode(tgargs, 'hex') || '/' || tgattr::text AS f
          FROM pg_trigger WHERE tgrelid IN ('public.red_convocari'::regclass, 'public.red_numere'::regclass) AND NOT tgisinternal) z)
     IS DISTINCT FROM 'red_convocari.trg_red_convocari_garda_rezerva=fn_red_convocari_rezerva_garda()/O/7//0//;red_convocari.trg_red_convocari_informare=fn_red_convocari_informare_garda()/O/23//0//;red_convocari.trg_red_convocari_posta_garda=fn_red_convocari_posta_garda()/O/23//0//;red_convocari.trg_red_jurnal=fn_red_jurnal()/O/29//0//;'
                   || 'red_convocari.trg_red_legaturi=fn_red_legaturi()/O/23//0//;red_numere.trg_red_jurnal=fn_red_jurnal()/O/29//0//' THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: triggerele pe red_convocari / red_numere nu sunt cele revizuite';
  END IF;
  -- RLS activ, fara FORCE, owner postgres pe tabelele atinse (functia ruleaza ca utilizatorul: RLS-ul e poarta)
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.red_convocari'::regclass, 'public.red_detinatori'::regclass, 'public.red_parcele'::regclass,
                                                  'public.red_uat'::regclass, 'public.red_proiecte'::regclass, 'public.red_numere'::regclass)
              AND (NOT relrowsecurity OR relforcerowsecurity OR pg_get_userbyid(relowner) <> 'postgres')) THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: RLS / owner neasteptat pe tabelele atinse';
  END IF;
  -- r4 (L15 pe RLS, Jakarinos r3 P2): politicile EXACTE ale tabelelor atinse — nume, comandă, permissive/restrictive, roluri, USING, WITH CHECK;
  -- o politică în plus, lipsă sau modificată = refuz. Baseline citit read-only pe live 04.11.2026.
  IF (SELECT string_agg(f, ';' ORDER BY f COLLATE "C") FROM (
        SELECT polrelid::regclass::text || '.' || polname::text || '|' || polcmd::text || '|' || polpermissive::text || '|'
               || (SELECT string_agg(r::regrole::text, ',' ORDER BY r::regrole::text COLLATE "C") FROM unnest(polroles) r) || '|'
               || coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '') AS f
          FROM pg_policy WHERE polrelid IN ('public.red_convocari'::regclass, 'public.red_detinatori'::regclass, 'public.red_parcele'::regclass,
                                            'public.red_uat'::regclass, 'public.red_proiecte'::regclass, 'public.red_numere'::regclass)) z)
     IS DISTINCT FROM
       'red_convocari.red_convocari_ins|a|true|authenticated||(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]));'
    || 'red_convocari.red_convocari_sel|r|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)|;'
    || 'red_convocari.red_convocari_upd|w|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))|(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]));'
    || 'red_detinatori.red_detinatori_ins|a|true|authenticated||(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]));'
    || 'red_detinatori.red_detinatori_sel|r|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)|;'
    || 'red_detinatori.red_detinatori_upd|w|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))|(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]));'
    || 'red_numere.red_numere_sel|r|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)|;'
    || 'red_parcele.red_parcele_ins|a|true|authenticated||(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]));'
    || 'red_parcele.red_parcele_sel|r|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)|;'
    || 'red_parcele.red_parcele_upd|w|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]))|(( SELECT fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY[''admin''::text, ''editor''::text]));'
    || 'red_proiecte.red_proiecte_ins|a|true|authenticated||(( SELECT fn_red_nivel() AS fn_red_nivel) = ''admin''::text);'
    || 'red_proiecte.red_proiecte_sel|r|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)|;'
    || 'red_proiecte.red_proiecte_upd|w|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) = ''admin''::text)|(( SELECT fn_red_nivel() AS fn_red_nivel) = ''admin''::text);'
    || 'red_uat.red_uat_ins|a|true|authenticated||(( SELECT fn_red_nivel() AS fn_red_nivel) = ''admin''::text);'
    || 'red_uat.red_uat_sel|r|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) IS NOT NULL)|;'
    || 'red_uat.red_uat_upd|w|true|authenticated|(( SELECT fn_red_nivel() AS fn_red_nivel) = ''admin''::text)|(( SELECT fn_red_nivel() AS fn_red_nivel) = ''admin''::text)' THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: politicile RLS pe tabelele atinse nu sunt cele revizuite';
  END IF;
  -- drepturile pe tabele (relacl) și pe coloanele red_parcele citite / blocate de RPC (attacl) — exact ca baseline-ul
  IF (SELECT string_agg(f, ';' ORDER BY f COLLATE "C") FROM (
        SELECT c.relname || '|' || coalesce((SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(c.relacl::text[]) a)::text, '') AS f
          FROM pg_class c WHERE c.oid IN ('public.red_convocari'::regclass, 'public.red_detinatori'::regclass, 'public.red_parcele'::regclass,
                                          'public.red_uat'::regclass, 'public.red_proiecte'::regclass, 'public.red_numere'::regclass)) z)
     IS DISTINCT FROM 'red_convocari|{authenticated=arw/postgres,postgres=arwdDxtm/postgres,service_role=arw/postgres};red_detinatori|{authenticated=arw/postgres,postgres=arwdDxtm/postgres,service_role=arw/postgres};'
                   || 'red_numere|{authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=r/postgres};red_parcele|{postgres=arwdDxtm/postgres,service_role=arw/postgres};'
                   || 'red_proiecte|{authenticated=arw/postgres,postgres=arwdDxtm/postgres,service_role=arw/postgres};red_uat|{authenticated=arw/postgres,postgres=arwdDxtm/postgres,service_role=arw/postgres}'
     OR (SELECT string_agg(f, ';' ORDER BY f COLLATE "C") FROM (
        SELECT c.relname || '.' || a.attname || '|' || coalesce((SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(a.attacl::text[]) x)::text, '') AS f
          FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
         WHERE c.oid = 'public.red_parcele'::regclass AND a.attname IN ('id', 'proiect_id', 'uat_id', 'tronson', 'sters_la')) z)
     IS DISTINCT FROM 'red_parcele.id|{authenticated=ar/postgres};red_parcele.proiect_id|{authenticated=arw/postgres};red_parcele.sters_la|{authenticated=arw/postgres};'
                   || 'red_parcele.tronson|{authenticated=arw/postgres};red_parcele.uat_id|{authenticated=arw/postgres}' THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: drepturile pe tabelele / coloanele atinse nu sunt cele revizuite';
  END IF;
  -- drepturile de care are nevoie authenticated EXISTA deja (nu se acorda nimic aici)
  IF NOT has_function_privilege('authenticated', 'public.fn_red_numar_document(text,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_red_nivel()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_red_plic_garda_persoana(uuid)', 'EXECUTE')
     OR NOT has_table_privilege('authenticated', 'public.red_convocari', 'INSERT') OR NOT has_table_privilege('authenticated', 'public.red_convocari', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.red_detinatori', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.red_detinatori', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.red_parcele', 'sters_la', 'SELECT') OR NOT has_column_privilege('authenticated', 'public.red_parcele', 'sters_la', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.red_uat', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.red_proiecte', 'SELECT') THEN
    RAISE EXCEPTION '20261131c_redari_poarta_utilizatori: authenticated nu are drepturile asteptate (nu se acorda aici)';
  END IF;

  -- Baseline surse versionate 30l/30m, fara introspectie dinamica / regex SQL.
  IF EXISTS (SELECT 1 FROM (VALUES
    ('fn_red_convocare_rezerva(uuid,boolean,text)', 'fbb7d6f96294c93a965fc97a930cd3c2', 'plpgsql', false, 'v', '{authenticated=X/postgres,postgres=X/postgres}'),
    ('fn_red_convocari_rezerva_garda()', '7ea11de788ce3ee28f2f9066668c6448', 'plpgsql', false, 'v', '{postgres=X/postgres}'),
    ('fn_red_convocari_informare_garda()', '0ad4dab815eb77d27e9f924b2f3b1316', 'plpgsql', true, 'v', '{postgres=X/postgres,service_role=X/postgres}'),
    ('fn_red_informare_publicata(text)', '78eb6b0d404b1cd519c5d6953f0f7146', 'sql', true, 's', '{anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
    ('fn_red_autorizare_tgz_garda()', 'ebcee139e54a3267dbc1cb5add595c57', 'plpgsql', true, 'v', '{postgres=X/postgres,service_role=X/postgres}'),
    ('fn_red_versiune_creste()', 'e7ab9318de671f0a94c678ee382250db', 'plpgsql', false, 'v', '{postgres=X/postgres,service_role=X/postgres}'),
    ('fn_red_mail_proiect_retentie()', '1aff1430b7f87e43275f52306e7dfcfd', 'plpgsql', true, 'v', '{postgres=X/postgres}'),
    ('fn_sms_e_owner()', '4ea29d605a2a8b491594f9d43da7385c', 'sql', true, 's', '{authenticated=X/postgres,postgres=X/postgres}')
  ) AS b(sig, hash, limbaj, definer, volatilitate, acl)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || b.sig)
  LEFT JOIN pg_language g ON g.oid = p.prolang
  WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM b.hash OR g.lanname IS DISTINCT FROM b.limbaj
    OR p.prosecdef IS DISTINCT FROM b.definer OR p.provolatile::text IS DISTINCT FROM b.volatilitate
    OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
    OR coalesce((SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(p.proacl::text[]) a)::text, '') IS DISTINCT FROM b.acl) THEN
    RAISE EXCEPTION '31c: lantul 30l/30m / owner / versiune nu mai are amprenta revizuita';
  END IF;
  -- BEGIN L15_PLICURI_R2 (baseline 29i/29j/29k, callees comune verificate mai sus)
  IF EXISTS (SELECT 1 FROM (VALUES
    ('fn_red_plic_creeaza(uuid,uuid[])', '3ecc79e23de600a3b29235abed0a5c1c', 'plpgsql', true, 'v', '{authenticated=X/postgres,postgres=X/postgres}', ARRAY['search_path=public, pg_temp','lock_timeout=5s']::text[]),
    ('fn_red_plic_reguli()', 'cda947fbd65187a73b7929b59c74f2fb', 'plpgsql', true, 'v', '{postgres=X/postgres,service_role=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_plic_propaga()', '888ad343fc14223ce5260e5e89305927', 'plpgsql', true, 'v', '{postgres=X/postgres,service_role=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_plic_scan_exista(uuid,text)', '1fabc3317c0b7d655d7701ee9d500d7b', 'sql', true, 's', '{postgres=X/postgres,service_role=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_plic_ar_calitate()', '2034d30779ea05a58c45fc6516fe7f8e', 'plpgsql', false, 'v', '{postgres=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_plic_identitate_garda()', 'edce63d7568ccb5c51574007b42e17ad', 'plpgsql', true, 'v', '{postgres=X/postgres,service_role=X/postgres}', ARRAY['search_path=public, pg_temp']::text[]),
    ('fn_red_detinatori_before()', 'dbdd7dc25c6da9322e1275e582642e66', 'plpgsql', true, 'v', '{postgres=X/postgres}', ARRAY['search_path=public, pg_temp']::text[])
  ) b(sig, hash, limbaj, definer, volatilitate, acl, config)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || b.sig)
    LEFT JOIN pg_language g ON g.oid = p.prolang
  WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM b.hash OR g.lanname IS DISTINCT FROM b.limbaj
    OR p.prosecdef IS DISTINCT FROM b.definer OR p.provolatile::text IS DISTINCT FROM b.volatilitate
    OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR p.proconfig IS DISTINCT FROM b.config
    OR coalesce((SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(p.proacl::text[]) a)::text, '') IS DISTINCT FROM b.acl) THEN
    RAISE EXCEPTION '31c: preflight plicuri - functii/callee/ACL/config schimbate';
  END IF;
  IF (SELECT string_agg(t.tgname || '=' || t.tgfoid::regprocedure::text || '/' || t.tgenabled::text || '/' || t.tgtype::text || '/'
      || coalesce(pg_get_expr(t.tgqual,t.tgrelid), '') || '/' || t.tgnargs::text || '/' || encode(t.tgargs,'hex') || '/' || t.tgattr::text, ';' ORDER BY t.tgname COLLATE "C")
    FROM pg_trigger t WHERE t.tgrelid = 'public.red_plicuri'::regclass AND NOT t.tgisinternal)
    IS DISTINCT FROM 'trg_red_jurnal=fn_red_jurnal()/O/29//0//;trg_red_plic_propaga=fn_red_plic_propaga()/O/17//0//;trg_red_plic_reguli=fn_red_plic_reguli()/O/23//0//;trg_red_versiune=fn_red_versiune_creste()/O/19//0//;trg_red_zz_ar_calitate=fn_red_plic_ar_calitate()/O/19//0//' THEN
    RAISE EXCEPTION '31c: preflight plicuri - triggere/argumente/coloane schimbate';
  END IF;
  -- END L15_PLICURI_R2
  -- Triggerele detinatorului pot modifica NEW.calitate; fixam inventarul complet, inclusiv argumente/UPDATE OF.
  IF (SELECT string_agg(t.tgname || '=' || t.tgfoid::regprocedure::text || '/' || t.tgenabled::text || '/' || t.tgtype::text || '/'
      || coalesce(pg_get_expr(t.tgqual,t.tgrelid), '') || '/' || t.tgnargs::text || '/' || encode(t.tgargs,'hex') || '/' || t.tgattr::text, ';' ORDER BY t.tgname COLLATE "C")
    FROM pg_trigger t WHERE t.tgrelid = 'public.red_detinatori'::regclass AND NOT t.tgisinternal)
    IS DISTINCT FROM 'trg_red_detinatori_before=fn_red_detinatori_before()/O/23//0//;trg_red_detinatori_token=fn_red_detinatori_token_dupa()/O/5//0//;trg_red_jurnal=fn_red_jurnal()/O/29//0//;trg_red_legaturi=fn_red_legaturi()/O/23//0//;trg_red_plic_identitate=fn_red_plic_identitate_garda()/O/19//0//' THEN
    RAISE EXCEPTION '31c: triggere red_detinatori - inventar/argumente/coloane schimbate';
  END IF;
  -- BEFORE UPDATE alfabetic: autorizare_tgz < proiect_utilizatori (nou) < proiecte_retentie_mail < versiune.
  -- Jurnalul este AFTER. Ordinea, tgargs si tgattr sunt parte din baseline; nicio garda nu modifica campurile celeilalte.
  IF (SELECT string_agg(t.tgname || '=' || t.tgfoid::regprocedure::text || '/' || t.tgenabled::text || '/' || t.tgtype::text || '/'
      || coalesce(pg_get_expr(t.tgqual,t.tgrelid), '') || '/' || t.tgnargs::text || '/' || encode(t.tgargs,'hex') || '/' || t.tgattr::text, ';' ORDER BY t.tgname COLLATE "C")
    FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND NOT t.tgisinternal)
    IS DISTINCT FROM 'trg_red_autorizare_tgz=fn_red_autorizare_tgz_garda()/O/23//0//;trg_red_jurnal=fn_red_jurnal()/O/29//0//;trg_red_proiecte_retentie_mail=fn_red_mail_proiect_retentie()/O/23//0//;trg_red_versiune=fn_red_versiune_creste()/O/19//0//' THEN
    RAISE EXCEPTION '31c: triggere red_proiecte - ordine/argumente/coloane schimbate';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.red_proiecte'::regclass AND attname = 'convocare_utilizatori_aprobata' AND NOT attisdropped)
    OR to_regprocedure('public.fn_red_proiect_utilizatori_garda()') IS NOT NULL
    OR to_regprocedure('public.fn_red_convocari_utilizatori_garda()') IS NOT NULL
    OR to_regprocedure('public.fn_red_detinatori_calitate_utilizatori_garda()') IS NOT NULL THEN
    RAISE EXCEPTION '31c: poarta exista deja';
  END IF;
  IF (SELECT md5(string_agg(t.tgname || '|' || t.tgenabled::text || '|' || t.tgtype::text || '|' || t.tgfoid::regprocedure::text || '|' || coalesce(pg_get_expr(t.tgqual, t.tgrelid), ''), E'\n' ORDER BY t.tgname))
        FROM pg_trigger t WHERE t.tgrelid = 'storage.objects'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM 'cf114a62838c44b5d9d1a20365cbaba4' THEN
    RAISE EXCEPTION '20261130m: triggerele de pe storage.objects nu sunt cele revizuite';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION '20261130m: RLS nu e activ pe storage.objects';
  END IF;
  -- r3 (Jakarinos r2 P2-2): TOATE politicile de pe storage.objects (nu doar cele care pomenesc bucket-ul): o politica globala permisiva ar
  -- acoperi si obiectele autorizarii. Legarea PDF-ului se bazeaza pe owner_id pus de Storage la upload si pe id-ul obiectului.
  IF (SELECT md5(string_agg(policyname || '|' || permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' ORDER BY policyname))
        FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects') IS DISTINCT FROM '8fa9339261517543c8a20f97ea4d751b' THEN
    RAISE EXCEPTION '20261130m: politicile de pe storage.objects nu sunt cele revizuite (132 politici, baseline 05.11.2026)';
  END IF;
END $pre$;

-- Aceeasi ordine DDL ca 30m; lock inaintea verificarilor de date.
LOCK TABLE public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.red_detinatori IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.red_proiecte
  ADD COLUMN convocare_utilizatori_aprobata boolean NOT NULL DEFAULT false,
  ADD COLUMN convocare_utilizatori_aprobata_de uuid,
  ADD COLUMN convocare_utilizatori_aprobata_la timestamptz;
COMMENT ON COLUMN public.red_proiecte.convocare_utilizatori_aprobata IS 'PR3a: doar owner-ul (profiles.is_owner prin auth.uid()); nu cere aviz avocat. Implicit false. Sablon separat PR3b.';
COMMENT ON COLUMN public.red_proiecte.convocare_utilizatori_aprobata_de IS 'Ultimul owner care a aprobat; scris numai de trigger; pastrat la OFF pentru istoric / rollback.';
COMMENT ON COLUMN public.red_proiecte.convocare_utilizatori_aprobata_la IS 'Momentul ultimei aprobari, pus de server; pastrat la OFF.';

CREATE FUNCTION public.fn_red_proiect_utilizatori_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_schimbat boolean;
BEGIN
  -- UPDATE are deja lock pe proiect. Nicio identitate din parametri / GUC custom.
  IF TG_OP = 'INSERT' THEN
    IF NEW.convocare_utilizatori_aprobata_de IS NOT NULL OR NEW.convocare_utilizatori_aprobata_la IS NOT NULL THEN
      RAISE EXCEPTION '31c: provenienta aprobarii o scrie doar serverul' USING ERRCODE = '42501';
    END IF;
    v_schimbat := NEW.convocare_utilizatori_aprobata IS TRUE;
  ELSE
    IF NEW.convocare_utilizatori_aprobata_de IS DISTINCT FROM OLD.convocare_utilizatori_aprobata_de
      OR NEW.convocare_utilizatori_aprobata_la IS DISTINCT FROM OLD.convocare_utilizatori_aprobata_la THEN
      RAISE EXCEPTION '31c: provenienta aprobarii o scrie doar serverul' USING ERRCODE = '42501';
    END IF;
    v_schimbat := NEW.convocare_utilizatori_aprobata IS DISTINCT FROM OLD.convocare_utilizatori_aprobata;
  END IF;
  IF v_schimbat THEN
    IF auth.uid() IS NULL OR public.fn_sms_e_owner() IS NOT TRUE THEN
      RAISE EXCEPTION '31c: convocarea utilizatorilor o aproba/opreste doar owner-ul' USING ERRCODE = '42501';
    END IF;
    IF NEW.convocare_utilizatori_aprobata IS TRUE THEN
      NEW.convocare_utilizatori_aprobata_de := auth.uid();
      NEW.convocare_utilizatori_aprobata_la := clock_timestamp();
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_red_proiect_utilizatori_garda() FROM PUBLIC, anon, authenticated, service_role;
-- Ordine BEFORE UPDATE: autorizare_tgz -> proiect_utilizatori -> proiecte_retentie_mail -> versiune.
CREATE TRIGGER trg_red_proiect_utilizatori BEFORE INSERT OR UPDATE ON public.red_proiecte
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_proiect_utilizatori_garda();

CREATE FUNCTION public.fn_red_convocari_utilizatori_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_calitate text; v_proiect uuid; v_aprobata boolean;
BEGIN
  -- Operatiile de siguranta OFF/anulare si completarea AR/tracking nu sunt blocate.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.detinator_id IS NOT DISTINCT FROM OLD.detinator_id AND NEW.canal IS NOT DISTINCT FROM OLD.canal
      AND NEW.fisier_convocator_path IS NOT DISTINCT FROM OLD.fisier_convocator_path
      AND NEW.nr_document IS NOT DISTINCT FROM OLD.nr_document
      AND NEW.continut_hash IS NOT DISTINCT FROM OLD.continut_hash
      AND (NEW.plic_id IS NULL OR NEW.plic_id IS NOT DISTINCT FROM OLD.plic_id)
      AND (NEW.data_expediere IS NULL OR NEW.data_expediere IS NOT DISTINCT FROM OLD.data_expediere)
      AND (NEW.stare = 'anulat' OR NEW.sters_la IS NOT NULL
        OR (NEW.stare IS NOT DISTINCT FROM OLD.stare AND NEW.sters_la IS NOT DISTINCT FROM OLD.sters_la))
    THEN RETURN NEW; END IF;
  END IF;
  -- L06: detinator/parcela FOR SHARE -> proiect FOR SHARE, ca RPC; triggerul h_ ruleaza inainte de informare/posta.
  -- Inclusiv la PATCH direct: calitatea / mutarea detinatorului nu se pot schimba in timpul deciziei.
  SELECT d.calitate, p.proiect_id INTO v_calitate, v_proiect
    FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id
    WHERE d.id = NEW.detinator_id FOR SHARE OF d, p NOWAIT;
  IF v_proiect IS NULL THEN RAISE EXCEPTION '31c: tinta convocarii inaccesibila' USING ERRCODE = '42501'; END IF;
  -- Lock implicit pe convocare -> detinator/parcela NOWAIT -> TRY acelasi advisory ca RPC -> proiect NOWAIT.
  -- TRY este obligatoriu: un UPDATE direct pe detinator poate avea deja lock-ul de rand inainte de trigger.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('red_convocare_posta:' || v_proiect::text || ':' || NEW.detinator_id::text, 0)) THEN
    RAISE EXCEPTION '31c: convocarea/calitatea se modifica simultan; reincercati' USING ERRCODE = '55P03';
  END IF;
  IF v_calitate IN ('utilizator', 'arendas') THEN
    SELECT pr.convocare_utilizatori_aprobata INTO v_aprobata FROM public.red_proiecte pr
      WHERE pr.id = v_proiect FOR SHARE NOWAIT;
    IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
      RAISE EXCEPTION '31c: fara drept de convocare' USING ERRCODE = '42501';
    END IF;
    IF v_aprobata IS NOT TRUE THEN
      RAISE EXCEPTION 'utilizator - convocare neaprobata' USING ERRCODE = 'RD006';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_red_convocari_utilizatori_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_convocari_h_utilizatori BEFORE INSERT OR UPDATE ON public.red_convocari
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_convocari_utilizatori_garda();


-- P1 r2: calitatea nu poate servi ca ocolire a portii intre doua scrieri pe convocari.
CREATE FUNCTION public.fn_red_detinatori_calitate_utilizatori_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_proiect uuid; v_aprobata boolean; v_utilizator_vechi boolean; v_utilizator_nou boolean;
BEGIN
  IF NEW.calitate IS NOT DISTINCT FROM OLD.calitate AND NEW.parcela_id IS NOT DISTINCT FROM OLD.parcela_id THEN RETURN NEW; END IF;
  v_utilizator_vechi := OLD.calitate IN ('utilizator','arendas');
  v_utilizator_nou := NEW.calitate IN ('utilizator','arendas');
  IF NOT v_utilizator_vechi AND NOT v_utilizator_nou THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin','editor') THEN
    RAISE EXCEPTION '31c: fara drept de modificare a calitatii' USING ERRCODE = '42501';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '31c: schimbarea calitatii cere READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  -- L01/L06: UPDATE are deja lock implicit pe detinator. Nu asteptam nici advisory-ul, nici proiectul:
  -- TRY advisory (aceeasi cheie ca rezervarea / expedierea), proiect FOR SHARE NOWAIT, apoi EXISTS.
  -- Un concurent care are advisory si asteapta detinatorul castiga; acest UPDATE cedeaza cu 55P03, fara deadlock.
  -- Proiectele vechi/nou se parcurg ordonat; reparentarea nu poate alege o poarta mai permisiva.
  FOR v_proiect IN SELECT DISTINCT p.proiect_id FROM public.red_parcele p
    WHERE p.id IN (OLD.parcela_id, NEW.parcela_id) ORDER BY p.proiect_id LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('red_convocare_posta:' || v_proiect::text || ':' || OLD.id::text, 0)) THEN
      RAISE EXCEPTION '31c: convocarea/calitatea se modifica simultan; reincercati' USING ERRCODE = '55P03';
    END IF;
    SELECT pr.convocare_utilizatori_aprobata INTO v_aprobata FROM public.red_proiecte pr
      WHERE pr.id = v_proiect FOR SHARE NOWAIT;
    IF v_aprobata IS NOT TRUE THEN
      -- Refuzam mascarea utilizator -> proprietar chiar fara convocare: altfel ar putea rezerva imediat ca proprietar.
      IF v_utilizator_vechi AND NOT v_utilizator_nou THEN
        RAISE EXCEPTION '31c: utilizator - schimbarea in proprietar cere aprobarea convocarii utilizatorilor' USING ERRCODE = 'RD007';
      END IF;
      IF v_utilizator_nou AND EXISTS (SELECT 1 FROM public.red_convocari c WHERE c.detinator_id = OLD.id
        AND c.stare = 'activ' AND c.sters_la IS NULL) THEN
        RAISE EXCEPTION '31c: utilizator - convocare activa, schimbarea calitatii neaprobata' USING ERRCODE = 'RD007';
      END IF;
    END IF;
  END LOOP;
  -- Schimbarile permise sunt consemnate de trg_red_jurnal (calitate veche/noua, auth.uid, moment).
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_red_detinatori_calitate_utilizatori_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_detinatori_calitate_utilizatori BEFORE UPDATE ON public.red_detinatori
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_detinatori_calitate_utilizatori_garda();

CREATE OR REPLACE FUNCTION public.fn_red_convocare_rezerva(p_detinator_id uuid, p_numar_nou_confirmat boolean DEFAULT false, p_canal text DEFAULT 'posta')
RETURNS TABLE (convocare_id uuid, nr_document text, parcela_id uuid, uat_id uuid, proiect_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
#variable_conflict error
DECLARE v_proiect_cheie uuid; v_proiect uuid; v_parcela uuid; v_uat uuid; v_uat3 text; v_tronson integer; v_calitate text; v_lipsa text[] := '{}';
  v_existente text; v_nr text; v_id uuid; pr record; u record;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de rezervare a convocarii' USING ERRCODE = '42501';
  END IF;
  IF p_detinator_id IS NULL OR p_numar_nou_confirmat IS NULL OR p_canal IS NULL THEN RAISE EXCEPTION 'redari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  -- canalele pe care UI-ul le generează cu număr C (generarea în masă: doar 'posta'; calea individuală: alegerea din modal, fără 'telefon')
  IF p_canal NOT IN ('posta', 'sms', 'email', 'afisare') THEN RAISE EXCEPTION 'redari: canal invalid (%)', p_canal USING ERRCODE = '22023'; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'redari: rezervarea convocarii doar in READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  -- (2) doar cheia lock-ului; starea se verifica DUPA lock
  SELECT p.proiect_id INTO v_proiect_cheie FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id WHERE d.id = p_detinator_id;
  IF v_proiect_cheie IS NULL THEN RAISE EXCEPTION 'redari: detinator inexistent' USING ERRCODE = 'P0002'; END IF;
  -- (3)
  PERFORM pg_advisory_xact_lock(hashtextextended('red_convocare_posta:' || v_proiect_cheie::text || ':' || p_detinator_id::text, 0));
  -- (4) sub lock: deținător + parcelă ACTIVE, blocate FOR SHARE (o ștergere logică / mutare concurentă e așteptată și recitită)
  SELECT p.id, p.proiect_id, p.uat_id, p.tronson, d.calitate INTO v_parcela, v_proiect, v_uat, v_tronson, v_calitate
    FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE d.id = p_detinator_id AND d.sters_la IS NULL AND p.sters_la IS NULL
     FOR SHARE OF d, p;
  IF v_uat IS NULL THEN RAISE EXCEPTION 'redari: detinatorul sau parcela au fost sterse' USING ERRCODE = 'P0002'; END IF;
  -- r5 P2-03: cheia lock-ului trebuie să fie a proiectului recitit sub lock (altfel două tranzacții ar putea bloca chei diferite)
  IF v_proiect IS DISTINCT FROM v_proiect_cheie THEN
    RAISE EXCEPTION 'redari: detinatorul a fost mutat in alt proiect intre timp; reincercati' USING ERRCODE = 'RD003';
  END IF;
  SELECT * INTO u FROM public.red_uat x WHERE x.id = v_uat AND x.proiect_id = v_proiect;
  SELECT * INTO pr FROM public.red_proiecte x WHERE x.id = v_proiect;
  IF u.id IS NULL OR pr.id IS NULL THEN RAISE EXCEPTION 'redari: proiect / UAT inaccesibil' USING ERRCODE = 'P0002'; END IF;
  -- L01/L06: advisory (proiect, detinator) -> detinator/parcela FOR SHARE -> proiect in trigger.
  -- Verificare sub ACELASI advisory, inainte de numar. Triggerul revalideaza sub lock pe proiect la INSERT.
  IF v_calitate IN ('utilizator', 'arendas') AND pr.convocare_utilizatori_aprobata IS NOT TRUE THEN
    RAISE EXCEPTION 'utilizator - convocare neaprobata' USING ERRCODE = 'RD006';
  END IF;
  v_uat3 := u.uat3;
  IF v_calitate = 'neidentificat' THEN v_lipsa := array_append(v_lipsa, 'detinator neidentificat (afisare la Primarie)'); END IF;
  IF btrim(coalesce(pr.contract_nr, '')) = '' OR pr.contract_data IS NULL THEN v_lipsa := array_append(v_lipsa, 'proiect fara nr./data contract'); END IF;
  IF btrim(coalesce(pr.imputernicire_nr, '')) = '' OR pr.imputernicire_data IS NULL THEN v_lipsa := array_append(v_lipsa, 'proiect fara nr./data imputernicire Transgaz'); END IF;
  IF NOT ((u.sesiune_zi1 IS NOT NULL AND btrim(coalesce(u.program_zi1, '')) <> '') OR (u.sesiune_zi2 IS NOT NULL AND btrim(coalesce(u.program_zi2, '')) <> '')
          OR (u.sesiune_zi3 IS NOT NULL AND btrim(coalesce(u.program_zi3, '')) <> '')) THEN v_lipsa := array_append(v_lipsa, 'UAT fara zi de sesiune cu program'); END IF;
  -- D3 (#991): șablonul tipărește numele, telefonul și e-mailul de contact + telefonul TGZ → fiecare obligatoriu (ca motivBlocareConvocator)
  IF btrim(coalesce(pr.contact_nume, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara persoana de contact Gazpet'); END IF;
  IF btrim(coalesce(pr.contact_telefon, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara telefonul de contact Gazpet'); END IF;
  IF btrim(coalesce(pr.contact_email, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara e-mailul de contact Gazpet'); END IF;
  IF btrim(coalesce(pr.text_gdpr, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara text GDPR'); END IF;
  IF btrim(coalesce(pr.reprezentant_tgz_nume, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara reprezentant TGZ'); END IF;
  IF btrim(coalesce(pr.reprezentant_tgz_telefon, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara telefonul reprezentantului TGZ'); END IF;
  IF cardinality(v_lipsa) > 0 THEN
    RAISE EXCEPTION 'redari: convocatorul nu se poate rezerva: %', array_to_string(v_lipsa, '; ') USING ERRCODE = 'RD002';
  END IF;
  -- (5) decizia pe EXISTS (prinde și convocările fără nr_document); agregarea doar pentru mesaj
  -- pe ACELAȘI canal (lotul și calea individuală pe poștă se exclud reciproc); excepția explicită = p_numar_nou_confirmat (bifa din modal)
  IF NOT p_numar_nou_confirmat AND EXISTS (SELECT 1 FROM public.red_convocari c WHERE c.detinator_id = p_detinator_id AND c.canal = p_canal
                                             AND c.stare = 'activ' AND c.data_expediere IS NULL AND c.sters_la IS NULL) THEN
    SELECT string_agg(coalesce(c.nr_document, '(fara numar)'), ', ' ORDER BY c.created_at, c.id) INTO v_existente FROM public.red_convocari c
     WHERE c.detinator_id = p_detinator_id AND c.canal = p_canal AND c.stare = 'activ' AND c.data_expediere IS NULL AND c.sters_la IS NULL;
    RAISE EXCEPTION 'redari: detinatorul are deja convocare % neexpediata (%)', p_canal, v_existente USING ERRCODE = 'RD001';
  END IF;
  -- (6) numărul + rândul; triggerele (garda rezervării, garda de plic pe persoană, legături, jurnal) și RLS-ul se aplică utilizatorului.
  -- r8: INSERT-ul (și numărul C) sunt autorizate de instrucțiunea STATICĂ SET LOCAL de mai jos (pe Supabase, postgres nu e superuser: clauza SET a
  -- funcției pe un GUC placeholder e refuzată la CREATE). SET LOCAL ține până la sfârșitul tranzacției, deci se anulează explicit imediat după INSERT.
  SET LOCAL gazpet.convocare_rezerva = 'activ';
  v_nr := public.fn_red_numar_document('C', v_uat3, v_tronson);
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (p_detinator_id, p_canal, v_nr) RETURNING id INTO v_id;
  SET LOCAL gazpet.convocare_rezerva = 'inactiv';
  -- r5 P1-01: identitatea folosită de server (clientul o compară cu documentul pe care îl generează)
  RETURN QUERY SELECT v_id, v_nr, v_parcela, v_uat, v_proiect;
END $fn$;

DO $post$
BEGIN
  -- Triggerele detinatorului pot modifica NEW.calitate; fixam inventarul complet, inclusiv argumente/UPDATE OF.
  IF (SELECT string_agg(t.tgname || '=' || t.tgfoid::regprocedure::text || '/' || t.tgenabled::text || '/' || t.tgtype::text || '/'
      || coalesce(pg_get_expr(t.tgqual,t.tgrelid), '') || '/' || t.tgnargs::text || '/' || encode(t.tgargs,'hex') || '/' || t.tgattr::text, ';' ORDER BY t.tgname COLLATE "C")
    FROM pg_trigger t WHERE t.tgrelid = 'public.red_detinatori'::regclass AND NOT t.tgisinternal)
    IS DISTINCT FROM 'trg_red_detinatori_before=fn_red_detinatori_before()/O/23//0//;trg_red_detinatori_calitate_utilizatori=fn_red_detinatori_calitate_utilizatori_garda()/O/19//0//;trg_red_detinatori_token=fn_red_detinatori_token_dupa()/O/5//0//;trg_red_jurnal=fn_red_jurnal()/O/29//0//;trg_red_legaturi=fn_red_legaturi()/O/23//0//;trg_red_plic_identitate=fn_red_plic_identitate_garda()/O/19//0//' THEN
    RAISE EXCEPTION '31c: triggere red_detinatori - inventar/argumente/coloane schimbate';
  END IF;

  -- BEFORE UPDATE alfabetic: autorizare_tgz < proiect_utilizatori (nou) < proiecte_retentie_mail < versiune.
  -- Jurnalul este AFTER. Ordinea, tgargs si tgattr sunt parte din baseline; nicio garda nu modifica campurile celeilalte.
  IF (SELECT string_agg(t.tgname || '=' || t.tgfoid::regprocedure::text || '/' || t.tgenabled::text || '/' || t.tgtype::text || '/'
      || coalesce(pg_get_expr(t.tgqual,t.tgrelid), '') || '/' || t.tgnargs::text || '/' || encode(t.tgargs,'hex') || '/' || t.tgattr::text, ';' ORDER BY t.tgname COLLATE "C")
    FROM pg_trigger t WHERE t.tgrelid = 'public.red_proiecte'::regclass AND NOT t.tgisinternal)
    IS DISTINCT FROM 'trg_red_autorizare_tgz=fn_red_autorizare_tgz_garda()/O/23//0//;trg_red_jurnal=fn_red_jurnal()/O/29//0//;trg_red_proiect_utilizatori=fn_red_proiect_utilizatori_garda()/O/23//0//;trg_red_proiecte_retentie_mail=fn_red_mail_proiect_retentie()/O/23//0//;trg_red_versiune=fn_red_versiune_creste()/O/19//0//' THEN
    RAISE EXCEPTION '31c: triggere red_proiecte - ordine/argumente/coloane schimbate';
  END IF;

  IF EXISTS (SELECT 1 FROM public.red_proiecte WHERE convocare_utilizatori_aprobata IS NOT FALSE
      OR convocare_utilizatori_aprobata_de IS NOT NULL OR convocare_utilizatori_aprobata_la IS NOT NULL) THEN
    RAISE EXCEPTION '31c: starea initiala nu este inchisa';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.red_proiecte'::regclass AND NOT attisdropped
      AND attname IN ('convocare_utilizatori_aprobata', 'convocare_utilizatori_aprobata_de', 'convocare_utilizatori_aprobata_la')) <> 3
    OR NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.red_proiecte'::regclass AND attname = 'convocare_utilizatori_aprobata')
    OR (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE a.attrelid = 'public.red_proiecte'::regclass AND a.attname = 'convocare_utilizatori_aprobata') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION '31c: coloane / NOT NULL / default';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
    ('fn_red_proiect_utilizatori_garda()', 'trg_red_proiect_utilizatori', 'public.red_proiecte', 23),
    ('fn_red_convocari_utilizatori_garda()', 'trg_red_convocari_h_utilizatori', 'public.red_convocari', 23),
    ('fn_red_detinatori_calitate_utilizatori_garda()', 'trg_red_detinatori_calitate_utilizatori', 'public.red_detinatori', 19)
  ) b(fn, tr, tab, typ) LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || b.fn)
    LEFT JOIN pg_trigger t ON t.tgrelid = b.tab::regclass AND t.tgname = b.tr
  WHERE p.oid IS NULL OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
    OR pg_get_userbyid(p.proowner) <> 'postgres'
    OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR t.tgfoid IS DISTINCT FROM p.oid OR t.tgenabled IS DISTINCT FROM 'O' OR t.tgtype IS DISTINCT FROM b.typ::smallint OR t.tgqual IS NOT NULL OR t.tgnargs <> 0 OR encode(t.tgargs,'hex') <> '' OR t.tgattr::text <> '') THEN
    RAISE EXCEPTION '31c: triggere / ACL / configuratie';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure
    AND NOT prosecdef AND pg_get_userbyid(proowner) = 'postgres' AND proconfig = ARRAY['search_path=public, pg_temp']::text[]
    AND md5(prosrc) = '6c5e0281f95e6242731e2d61301033f3'
    AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(proacl::text[]) a) = ARRAY['authenticated=X/postgres','postgres=X/postgres']) THEN
    RAISE EXCEPTION '31c: RPC / ACL nu sunt cele asteptate';
  END IF;
END $post$;
