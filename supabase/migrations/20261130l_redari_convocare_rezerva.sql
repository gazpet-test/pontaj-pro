-- Version 20261130140000. Runner supplies one transaction.
-- 20261130l_redari_convocare_rezerva — Redări: rezervarea ATOMICĂ a unei convocări poștale (număr C + rând red_convocari).
-- Cerința: PR #989 (L1, convocatoare în masă pe UAT), Jakarinos NO-GO r1 P1-1 / r2 P1-1..P1-3: două taburi / doi utilizatori care pregătesc
-- același deținător ca „nou” rezervă fiecare un număr și inserează câte o convocare (UNIQUE(nr_document) nu ajută, numerele diferă).
-- r3 (direcția coordonatorului după Jakarinos r2): SECURITY **INVOKER** — rulează ca utilizatorul (authenticated), deci RLS-ul și TOATE triggerele
-- de pe red_convocari se aplică normal (inclusiv trg_red_convocari_posta_garda, care sare tot pentru current_user = 'postgres': garda de plic pe
-- persoană rulează acum din trigger, fără apel explicit). Fără tabele, vederi, politici, triggere sau drepturi noi.
-- Drepturile folosite (verificate read-only pe live 04.11.2026, NIMIC acordat aici): EXECUTE authenticated pe fn_red_nivel, fn_red_numar_document
-- (SECURITY DEFINER: scrie red_numere), fn_red_plic_garda_persoana; red_convocari arw + politicile red_convocari_ins / _sel (admin/editor);
-- red_detinatori arw + _sel / _upd (FOR SHARE cere UPDATE: admin/editor); red_parcele SELECT + UPDATE pe coloane + _sel / _upd; red_uat, red_proiecte
-- SELECT + _sel. pg_advisory_xact_lock / hashtextextended: PUBLIC.
-- r4: AMBELE căi folosesc funcția — generarea în masă (p_canal 'posta', fără confirmare) și calea individuală din Registru (ModalConvocator, prin
-- rezervaNumarConvocare: p_numar_nou_confirmat = bifa explicită din modal, p_canal = canalul ales). RD001 se decide pe ACELAȘI canal.
-- Ce face fn_red_convocare_rezerva(p_detinator_id uuid, p_numar_nou_confirmat boolean DEFAULT false, p_canal text DEFAULT 'posta') RETURNS TABLE (convocare_id, nr_document),
-- într-o singură tranzacție (cea a apelului PostgREST):
--   1. poarta: fn_red_nivel() ∈ {admin, editor}, altfel 42501; parametri NULL → 22023 (proba fără efecte a clientului); doar READ COMMITTED (25001);
--   2. citire preliminară deținător → (proiect, uat) DOAR pentru cheia lock-ului; P0002 dacă lipsește;
--   3. pg_advisory_xact_lock(hashtextextended('red_convocare_posta:' || proiect || ':' || deținător)) — serializează rezervările aceluiași deținător;
--   4. SUB lock, recitire: deținătorul + parcela ACTIVE, FOR SHARE (o ștergere logică concurentă așteaptă sfârșitul tranzacției; una deja în curs
--      e așteptată și recitită — P0002 dacă între timp a devenit ștearsă); calitate ≠ neidentificat; proiectul și UAT-ul (recitite, nu din client):
--      contract nr+dată, împuternicire nr+dată, persoană de contact, text GDPR, reprezentant TGZ, o zi de sesiune cu program — aceleași gărzi ca
--      motivBlocareConvocator; lipsă → RD002 cu lista;
--   5. EXISTS convocare poștală activă, neexpediată, neștearsă (inclusiv fără nr_document) și NU p_numar_nou_confirmat → RD001 (mesaj cu numerele);
--   6. fn_red_numar_document('C', uat3, tronson) (aceeași serie globală 'C'), apoi INSERT red_convocari (detinator_id, canal 'posta', nr_document):
--      triggerele (posta_garda → garda de plic pe persoană cu lock pe UAT, 55P03 dacă UAT-ul e ocupat; legaturi; jurnal) și RLS-ul se aplică;
--      orice eroare anulează împreună numărul și rândul. created_by = DEFAULT auth.uid().
--   Fișierul (cale + hash) îl pune apoi clientul prin reincarcaConvocator (UPDATE pe rând, RLS existent).
-- Limite (documentate): proiectul / UAT-ul se citesc fără lock de rând (editorul nu are UPDATE pe ele); o schimbare de admin comisă după citire
-- și înainte de COMMIT nu e prinsă. Fișa parcelei (reîncărcarea cu același număr) nu rezervă numere.
-- r5 (Copilot NO-GO #989):
--   P1-01: RPC-ul întoarce și identitatea folosită de server (parcela_id, uat_id, proiect_id); clientul o compară cu documentul pe care îl generează.
--   P1-02: protocolul e impus în BD pentru ORICE INSERT în red_convocari: trigger nou trg_red_convocari_garda_rezerva (BEFORE INSERT) cere marcajul
--     tranzacțional gazpet.convocare_rezerva = txid_current(), pus DOAR de fn_red_convocare_rezerva chiar înainte de INSERT (și șters imediat după).
--     PostgREST nu expune pg_catalog (set_config) și nicio funcție public executabilă de authenticated nu apelează set_config (verificat read-only
--     04.11.2026; poarta 0e rămâne). Un client vechi (fn_red_numar_document + INSERT direct) primește RD004 „reîncarcă pagina”.
--     Inventarul căilor de INSERT (read-only, 05.11.2026): în src/ doar docx.salveazaConvocator (nefolosit de UI după #989); în BD nicio funcție nu
--     inserează în red_convocari (fn_red_plic_* doar actualizează). Excepție explicită: current_user = 'postgres' (mentenanță / migrări /
--     fixture-uri SQL, ca trg_red_convocari_posta_garda). Toate canalele (posta / sms / email / afisare) trec prin RPC; 'telefon' nu e generat din UI.
--   P2-03: cheia advisory se păstrează separat; dacă proiectul recitit sub lock diferă de cel din cheie → RD003 (conflict, reîncearcă).
-- Revenire: supabase/revenire/20261130l_redari_convocare_rezerva_ROLLBACK.sql (DROP TRIGGER + funcțiile; convocările create rămân convocări obișnuite).
-- DRY producție (doar citiri, fără rezervare reușită): supabase/tests/20261130l_redari_convocare_rezerva_dryrun.sql.
-- DRY local PG17 (concurență prin dblink, funcțiile live reale): supabase/tests/20261130l_..._schelet.sql + _dryrun_local.sql, scripts/redari_30l_dry_local.sh.
-- NEAPLICATĂ: se aplică doar după GO Jakarinos + Copilot și DRY verde (regula 01.11). Fără ea, ambele căi refuză (fără fallback).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130l_redari_convocare_rezerva:' || txid_current() THEN
    RAISE EXCEPTION '20261130l: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_convocari') IS NULL OR to_regclass('public.red_detinatori') IS NULL OR to_regclass('public.red_parcele') IS NULL
     OR to_regclass('public.red_uat') IS NULL OR to_regclass('public.red_proiecte') IS NULL OR to_regclass('public.red_numere') IS NULL THEN
    RAISE EXCEPTION '20261130l: lipseste schema Redari (red_convocari, red_detinatori, red_parcele, red_uat, red_proiecte, red_numere)';
  END IF;
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean,text)') IS NOT NULL THEN RAISE EXCEPTION '20261130l: functia exista deja'; END IF;
  IF to_regprocedure('public.fn_red_convocari_rezerva_garda()') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_red_convocari_garda_rezerva') THEN
    RAISE EXCEPTION '20261130l: garda rezervarii exista deja'; END IF;
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
    RAISE EXCEPTION '20261130l: coloanele Redari au alta forma';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.red_convocari'::regclass AND conname = 'red_convocari_canal_check')
       IS DISTINCT FROM 'CHECK ((canal = ANY (ARRAY[''posta''::text, ''sms''::text, ''email''::text, ''afisare''::text, ''telefon''::text])))'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.red_convocari'::regclass AND conname = 'red_convocari_stare_check')
       IS DISTINCT FROM 'CHECK ((stare = ANY (ARRAY[''activ''::text, ''anulat''::text])))' THEN
    RAISE EXCEPTION '20261130l: CHECK-urile canal / stare pe red_convocari nu mai sunt cele revizuite';
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
    || 'fn_red_numar_document(text,text,integer)|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|b943c0eca339b7d6a03970f0a1f8323e|{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_plic_garda_persoana(uuid)|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|4c1f0bb4757c68630989e5e464b7682f|{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_plic_incearca_lock(uuid)|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|af77d2e7c85bdea490f76b12eb18dff1|{postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_plic_incearca_lock_detinator(uuid)|plpgsql|true|v|{"search_path=public, pg_temp"}|postgres|c7b8cff21c1999435246f84e085b7aea|{postgres=X/postgres,service_role=X/postgres};'
    || 'fn_red_plic_uat_detinator(uuid)|sql|true|v|{"search_path=public, pg_temp"}|postgres|f837713cf4f3373ae7f9a46dd60210f9|{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION '20261130l: lantul de functii apelate nu mai are amprenta revizuita (limbaj / DEFINER / volatilitate / search_path / owner / corp / ACL)';
  END IF;
  -- triggerele exacte: nume = functie / enabled / tip / WHEN / nr. argumente / argumente / coloane (tgattr)
  IF (SELECT string_agg(f, ';' ORDER BY f COLLATE "C") FROM (
        SELECT tgrelid::regclass::text || '.' || tgname::text || '=' || tgfoid::regprocedure::text || '/' || tgenabled::text || '/' || tgtype::text || '/'
               || coalesce(pg_get_expr(tgqual, tgrelid), '') || '/' || tgnargs::text || '/' || encode(tgargs, 'hex') || '/' || tgattr::text AS f
          FROM pg_trigger WHERE tgrelid IN ('public.red_convocari'::regclass, 'public.red_numere'::regclass) AND NOT tgisinternal) z)
     IS DISTINCT FROM 'red_convocari.trg_red_convocari_posta_garda=fn_red_convocari_posta_garda()/O/23//0//;red_convocari.trg_red_jurnal=fn_red_jurnal()/O/29//0//;'
                   || 'red_convocari.trg_red_legaturi=fn_red_legaturi()/O/23//0//;red_numere.trg_red_jurnal=fn_red_jurnal()/O/29//0//' THEN
    RAISE EXCEPTION '20261130l: triggerele pe red_convocari / red_numere nu sunt cele revizuite';
  END IF;
  -- RLS activ, fara FORCE, owner postgres pe tabelele atinse (functia ruleaza ca utilizatorul: RLS-ul e poarta)
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.red_convocari'::regclass, 'public.red_detinatori'::regclass, 'public.red_parcele'::regclass,
                                                  'public.red_uat'::regclass, 'public.red_proiecte'::regclass, 'public.red_numere'::regclass)
              AND (NOT relrowsecurity OR relforcerowsecurity OR pg_get_userbyid(relowner) <> 'postgres')) THEN
    RAISE EXCEPTION '20261130l: RLS / owner neasteptat pe tabelele atinse';
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
    RAISE EXCEPTION '20261130l: politicile RLS pe tabelele atinse nu sunt cele revizuite';
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
    RAISE EXCEPTION '20261130l: drepturile pe tabelele / coloanele atinse nu sunt cele revizuite';
  END IF;
  -- drepturile de care are nevoie authenticated EXISTA deja (nu se acorda nimic aici)
  IF NOT has_function_privilege('authenticated', 'public.fn_red_numar_document(text,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_red_nivel()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_red_plic_garda_persoana(uuid)', 'EXECUTE')
     OR NOT has_table_privilege('authenticated', 'public.red_convocari', 'INSERT') OR NOT has_table_privilege('authenticated', 'public.red_convocari', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.red_detinatori', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.red_detinatori', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.red_parcele', 'sters_la', 'SELECT') OR NOT has_column_privilege('authenticated', 'public.red_parcele', 'sters_la', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.red_uat', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.red_proiecte', 'SELECT') THEN
    RAISE EXCEPTION '20261130l: authenticated nu are drepturile asteptate (nu se acorda aici)';
  END IF;
END $pre$;

CREATE FUNCTION public.fn_red_convocare_rezerva(p_detinator_id uuid, p_numar_nou_confirmat boolean DEFAULT false, p_canal text DEFAULT 'posta')
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
  -- r5 P1-02: marcajul tranzacțional care autorizează EXACT acest INSERT (trg_red_convocari_garda_rezerva), șters imediat după.
  v_nr := public.fn_red_numar_document('C', v_uat3, v_tronson);
  PERFORM set_config('gazpet.convocare_rezerva', txid_current()::text, true);
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (p_detinator_id, p_canal, v_nr) RETURNING id INTO v_id;
  PERFORM set_config('gazpet.convocare_rezerva', '', true);
  -- r5 P1-01: identitatea folosită de server (clientul o compară cu documentul pe care îl generează)
  RETURN QUERY SELECT v_id, v_nr, v_parcela, v_uat, v_proiect;
END $fn$;
COMMENT ON FUNCTION public.fn_red_convocare_rezerva(uuid, boolean, text) IS 'Redări: rezervare atomică a unei convocări (SECURITY INVOKER: RLS + triggere ale utilizatorului). '
  'Lock pe proiect + deținător (RD003 dacă proiectul se schimbă sub lock), recitire sub lock (FOR SHARE deținător + parcelă, gărzi proiect/UAT → RD002), '
  'RD001 dacă există convocare neexpediată pe același canal (fără p_numar_nou_confirmat), număr C prin fn_red_numar_document, INSERT autorizat prin marcaj. '
  'Întoarce și parcela / UAT / proiect folosite. Doar admin/editor. Antet: migrarea 20261130l.';
REVOKE ALL ON FUNCTION public.fn_red_convocare_rezerva(uuid, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_convocare_rezerva(uuid, boolean, text) TO authenticated;

-- r5 P1-02: garda care impune protocolul pentru ORICE INSERT în red_convocari (clienți vechi, apeluri PostgREST directe)
CREATE FUNCTION public.fn_red_convocari_rezerva_garda()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
BEGIN
  -- excepție explicită: mentenanță / migrări / fixture-uri SQL ca owner (aceeași regulă ca trg_red_convocari_posta_garda)
  IF current_user = 'postgres' THEN RETURN NEW; END IF;
  IF current_setting('gazpet.convocare_rezerva', true) IS DISTINCT FROM txid_current()::text THEN
    RAISE EXCEPTION 'redari: convocatorul se genereaza doar prin rezervarea atomica (fn_red_convocare_rezerva). Reincarca pagina (Ctrl+Shift+R) si incearca din nou.'
      USING ERRCODE = 'RD004';
  END IF;
  RETURN NEW;
END $fn$;
COMMENT ON FUNCTION public.fn_red_convocari_rezerva_garda() IS 'Redări: INSERT în red_convocari doar prin fn_red_convocare_rezerva (marcaj gazpet.convocare_rezerva = txid_current()); RD004 altfel. Migrarea 20261130l.';
REVOKE ALL ON FUNCTION public.fn_red_convocari_rezerva_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_red_convocari_garda_rezerva BEFORE INSERT ON public.red_convocari FOR EACH ROW EXECUTE FUNCTION public.fn_red_convocari_rezerva_garda();

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure AND NOT prosecdef AND provolatile = 'v'
                  AND proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(proowner) = 'postgres') THEN
    RAISE EXCEPTION '20261130l: functia are setari gresite (INVOKER / VOLATILE / search_path / owner)';
  END IF;
  IF (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure)
       IS DISTINCT FROM ARRAY['authenticated=X/postgres', 'postgres=X/postgres']::text[] THEN
    RAISE EXCEPTION '20261130l: privilegii gresite pe fn_red_convocare_rezerva (doar authenticated + owner)';
  END IF;
  IF (SELECT array_agg(n ORDER BY o) FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, md, o)
       WHERE p.oid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure AND a.md = 't')
     IS DISTINCT FROM ARRAY['convocare_id', 'nr_document', 'parcela_id', 'uat_id', 'proiect_id']::text[] THEN
    RAISE EXCEPTION '20261130l: coloanele de iesire nu sunt cele asteptate';
  END IF;
  -- garda nouă: INVOKER, search_path fix, owner postgres, fără EXECUTE pentru nimeni în afară de owner; triggerele finale exacte
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocari_rezerva_garda()'::regprocedure AND NOT prosecdef
                  AND proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(proowner) = 'postgres')
     OR (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = 'public.fn_red_convocari_rezerva_garda()'::regprocedure)
       IS DISTINCT FROM ARRAY['postgres=X/postgres']::text[] THEN
    RAISE EXCEPTION '20261130l: garda trg_red_convocari_garda_rezerva are setari / privilegii gresite';
  END IF;
  IF (SELECT string_agg(f, ';' ORDER BY f COLLATE "C") FROM (
        SELECT tgrelid::regclass::text || '.' || tgname::text || '=' || tgfoid::regprocedure::text || '/' || tgenabled::text || '/' || tgtype::text || '/'
               || coalesce(pg_get_expr(tgqual, tgrelid), '') || '/' || tgnargs::text || '/' || encode(tgargs, 'hex') || '/' || tgattr::text AS f
          FROM pg_trigger WHERE tgrelid = 'public.red_convocari'::regclass AND NOT tgisinternal) z)
     IS DISTINCT FROM 'red_convocari.trg_red_convocari_garda_rezerva=fn_red_convocari_rezerva_garda()/O/7//0//;red_convocari.trg_red_convocari_posta_garda=fn_red_convocari_posta_garda()/O/23//0//;'
                   || 'red_convocari.trg_red_jurnal=fn_red_jurnal()/O/29//0//;red_convocari.trg_red_legaturi=fn_red_legaturi()/O/23//0//' THEN
    RAISE EXCEPTION '20261130l: triggerele finale pe red_convocari nu sunt cele asteptate';
  END IF;
END $post$;
