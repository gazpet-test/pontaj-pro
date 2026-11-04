-- DRY PRODUCTIE 20261130l_redari_convocare_rezerva. Runner: o singura tranzactie ANULATA, READ COMMITTED
-- (marcaj gazpet.livrare_migrare + migrare + acest fisier + RESET ROLE + revenire + verificare + ROLLBACK explicit, ca la 20261130i).
-- r3: functia e SECURITY INVOKER (RLS + triggerele utilizatorului); refuzurile testate aici pica toate INAINTE de numar si de INSERT.
-- DOAR CITIRI: nicio rezervare reusita (o rezervare ar lua randul 'C' din red_numere pana la ROLLBACK si ar bloca generarea individuala).
-- Se testeaza: setarile + ACL-ul functiei, refuzurile care pica INAINTE de orice scriere (anon, authenticated fara sub, viewer real,
-- profil fara nivel Redari, service_role, parametri NULL, detinator inexistent) si — daca TEST-RAZVAN are o convocare postala activa
-- neexpediata — refuzul RD001 (dupa advisory lock, inainte de numar). Contorul 'C' si numarul de convocari trebuie sa ramana neschimbate.
-- Concurenta reala, garda de plic, rezervarea reusita si revenirea cu date: DRY-ul LOCAL (..._dryrun_local.sql, scripts/redari_30l_dry_local.sh).
-- Identitati REALE din user_module_access simulate prin request.jwt.claims + SET LOCAL ROLE; la final RESET ROLE + claims goale.
SELECT set_config('lock_timeout', '2s', true);
CREATE FUNCTION pg_temp.r30l_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
-- SQLSTATE-ul unui apel (sau 'OK'); subtranzactia apelului se anuleaza mereu (EXCEPTION) — nicio urma, chiar daca ar reusi
CREATE FUNCTION pg_temp.r30l_stare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  BEGIN EXECUTE p_sql; RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'r30l: apelul a reusit';
  EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM; END;
END $h$;
CREATE FUNCTION pg_temp.r30l_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r30l.' || p, true), ''); $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30l_ca(uuid, text), pg_temp.r30l_stare(text), pg_temp.r30l_g(text) TO authenticated, anon, service_role;

-- TEST0: garda, izolare, identitati, amprenta initiala (ca postgres); nicio scriere
DO $t$
DECLARE ed uuid; vw uuid; fa uuid; pr uuid; det uuid; detc uuid; nrc text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130l_redari_convocare_rezerva:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'TEST0 FAIL: DRY-ul cere READ COMMITTED (ca PostgREST)'; END IF;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level IN ('editor', 'admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level = 'editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level = 'viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT p.id INTO fa FROM public.profiles p WHERE p.is_owner IS NOT TRUE
    AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = p.id AND a.module = 'redari') ORDER BY p.id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte WHERE cod = 'TEST-RAZVAN';
  IF ed IS NULL OR vw IS NULL OR fa IS NULL OR pr IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect TEST-RAZVAN lipsa'; END IF;
  SELECT d.id INTO det FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id WHERE p.proiect_id = pr AND d.sters_la IS NULL AND p.sters_la IS NULL ORDER BY d.id LIMIT 1;
  IF det IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: TEST-RAZVAN fara detinatori'; END IF;
  SELECT c.detinator_id, c.nr_document INTO detc, nrc FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE p.proiect_id = pr AND d.sters_la IS NULL AND p.sters_la IS NULL AND c.canal = 'posta' AND c.stare = 'activ' AND c.data_expediere IS NULL AND c.sters_la IS NULL
   ORDER BY c.created_at, c.id LIMIT 1;
  PERFORM set_config('r30l.editor', ed::text, true); PERFORM set_config('r30l.viewer', vw::text, true); PERFORM set_config('r30l.fara', fa::text, true);
  PERFORM set_config('r30l.det', det::text, true); PERFORM set_config('r30l.detc', coalesce(detc::text, ''), true); PERFORM set_config('r30l.nrc', coalesce(nrc, ''), true);
  -- r5: gărzile de conținut (RD002) se verifică ÎNAINTEA RD001 — ordinea dorită. Așteptatul pentru TEST3 se calculează aici, INDEPENDENT de RPC,
  -- din datele reale (fără să le modificăm): lista exactă a lipsurilor pentru deținătorul detc, în ordinea mesajului din RPC.
  IF detc IS NOT NULL THEN
    PERFORM set_config('r30l.lipsa_c', coalesce((
      SELECT array_to_string(array_remove(ARRAY[
               CASE WHEN d.calitate = 'neidentificat' THEN 'detinator neidentificat (afisare la Primarie)' END,
               CASE WHEN btrim(coalesce(x.contract_nr, '')) = '' OR x.contract_data IS NULL THEN 'proiect fara nr./data contract' END,
               CASE WHEN btrim(coalesce(x.imputernicire_nr, '')) = '' OR x.imputernicire_data IS NULL THEN 'proiect fara nr./data imputernicire Transgaz' END,
               CASE WHEN NOT ((u.sesiune_zi1 IS NOT NULL AND btrim(coalesce(u.program_zi1, '')) <> '') OR (u.sesiune_zi2 IS NOT NULL AND btrim(coalesce(u.program_zi2, '')) <> '')
                              OR (u.sesiune_zi3 IS NOT NULL AND btrim(coalesce(u.program_zi3, '')) <> '')) THEN 'UAT fara zi de sesiune cu program' END,
               CASE WHEN btrim(coalesce(x.contact_nume, '')) = '' THEN 'proiect fara persoana de contact Gazpet' END,
               CASE WHEN btrim(coalesce(x.contact_telefon, '')) = '' THEN 'proiect fara telefonul de contact Gazpet' END,
               CASE WHEN btrim(coalesce(x.contact_email, '')) = '' THEN 'proiect fara e-mailul de contact Gazpet' END,
               CASE WHEN btrim(coalesce(x.text_gdpr, '')) = '' THEN 'proiect fara text GDPR' END,
               CASE WHEN btrim(coalesce(x.reprezentant_tgz_nume, '')) = '' THEN 'proiect fara reprezentant TGZ' END,
               CASE WHEN btrim(coalesce(x.reprezentant_tgz_telefon, '')) = '' THEN 'proiect fara telefonul reprezentantului TGZ' END], NULL), '; ')
        FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id JOIN public.red_uat u ON u.id = p.uat_id JOIN public.red_proiecte x ON x.id = p.proiect_id
       WHERE d.id = detc), ''), true);
  END IF;
  PERFORM set_config('r30l.amprenta', (SELECT coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0) || '|' || (SELECT count(*) FROM public.red_convocari)), true);
  RAISE NOTICE 'TEST0 OK (amprenta numere|convocari = %, convocare neexpediata pe TEST-RAZVAN: %)', current_setting('r30l.amprenta'), coalesce(nrc, 'niciuna');
END $t$;

-- TEST1: setari, ACL, iesire
DO $t$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure AND NOT prosecdef AND provolatile = 'v'
                  AND proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(proowner) = 'postgres') THEN RAISE EXCEPTION 'TEST1 FAIL: setari'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.fn_red_convocare_rezerva(uuid,boolean,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_red_convocare_rezerva(uuid,boolean,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.fn_red_convocare_rezerva(uuid,boolean,text)', 'EXECUTE') THEN RAISE EXCEPTION 'TEST1 FAIL: ACL'; END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: refuzuri inainte de orice scriere
SELECT pg_temp.r30l_ca(NULL, 'anon');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL anon: %', r; END IF; RAISE NOTICE 'TEST2a OK'; END $t$;
SELECT pg_temp.r30l_ca(NULL, 'authenticated');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL authenticated fara sub: %', r; END IF; RAISE NOTICE 'TEST2b OK'; END $t$;
SELECT pg_temp.r30l_ca(pg_temp.r30l_g('viewer')::uuid, 'authenticated');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL viewer: %', r; END IF; RAISE NOTICE 'TEST2c OK'; END $t$;
SELECT pg_temp.r30l_ca(pg_temp.r30l_g('fara')::uuid, 'authenticated');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL fara nivel: %', r; END IF; RAISE NOTICE 'TEST2d OK'; END $t$;
SELECT pg_temp.r30l_ca(NULL, 'service_role');
DO $t$ DECLARE r text := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('det'))); BEGIN
  IF r NOT LIKE '42501:%' THEN RAISE EXCEPTION 'TEST2 FAIL service_role: %', r; END IF; RAISE NOTICE 'TEST2e OK'; END $t$;
SELECT pg_temp.r30l_ca(pg_temp.r30l_g('editor')::uuid, 'authenticated');
DO $t$ DECLARE r text; BEGIN
  r := pg_temp.r30l_stare('SELECT * FROM public.fn_red_convocare_rezerva(NULL)');
  IF r NOT LIKE '22023:%' THEN RAISE EXCEPTION 'TEST2 FAIL null: %', r; END IF;
  r := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid, NULL)', pg_temp.r30l_g('det')));
  IF r NOT LIKE '22023:%' THEN RAISE EXCEPTION 'TEST2 FAIL confirmat null: %', r; END IF;
  r := pg_temp.r30l_stare('SELECT * FROM public.fn_red_convocare_rezerva(''00000000-0000-0000-0000-000000000000''::uuid)');
  IF r NOT LIKE 'P0002:%' THEN RAISE EXCEPTION 'TEST2 FAIL inexistent: %', r; END IF;
  RAISE NOTICE 'TEST2f OK (editor: 22023 / P0002)';
END $t$;
-- TEST3: pe o convocare reala neexpediata a TEST-RAZVAN (daca exista) — refuz dupa lock, inainte de numar. Determinist pe datele reale:
-- gărzile de conținut trec → RD001 cu numărul existent; altfel → EXACT RD002 cu lista calculată în TEST0 (RD002 înaintea RD001).
DO $t$ DECLARE r text; v_lipsa text := coalesce(pg_temp.r30l_g('lipsa_c'), ''); BEGIN
  IF pg_temp.r30l_g('detc') IS NULL THEN RAISE NOTICE 'TEST3 SARIT (TEST-RAZVAN nu are convocare postala activa neexpediata)'; RETURN; END IF;
  r := pg_temp.r30l_stare(format('SELECT * FROM public.fn_red_convocare_rezerva(%L::uuid)', pg_temp.r30l_g('detc')));
  IF v_lipsa = '' THEN
    IF r NOT LIKE 'RD001:%' || pg_temp.r30l_g('nrc') || '%' THEN RAISE EXCEPTION 'TEST3 FAIL (gărzi OK, aștept RD001): %', r; END IF;
    RAISE NOTICE 'TEST3 OK (RD001 pe %)', pg_temp.r30l_g('nrc');
  ELSE
    IF r IS DISTINCT FROM 'RD002:redari: convocatorul nu se poate rezerva: ' || v_lipsa THEN RAISE EXCEPTION 'TEST3 FAIL (aștept RD002: %): %', v_lipsa, r; END IF;
    RAISE NOTICE 'TEST3 OK (RD002 inaintea RD001 pe %, garzi de continut neindeplinite pe datele reale: %)', pg_temp.r30l_g('nrc'), v_lipsa;
  END IF;
END $t$;
-- TEST3b (r5 P1-02): INSERT direct în red_convocari ca editor real (client vechi / PostgREST direct) → RD004, înaintea oricărei alte gărzi
-- (triggerul trg_red_convocari_garda_rezerva rulează primul: nu ia lock-ul de plic). Subtranzacția se anulează oricum (r30l_stare).
DO $t$ DECLARE r text; BEGIN
  r := pg_temp.r30l_stare(format('INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (%L::uuid, ''posta'', ''DRY30L-INSERT-DIRECT'')', pg_temp.r30l_g('det')));
  IF r NOT LIKE 'RD004:%' THEN RAISE EXCEPTION 'TEST3b FAIL: %', r; END IF;
  RAISE NOTICE 'TEST3b OK (INSERT direct refuzat: RD004)';
END $t$;
-- TEST3d (r7, Copilot r2 P1-01): clientul vechi — numărul C cerut separat de editorul real → RD005 ÎNAINTE de increment (contorul C neschimbat,
-- verificat imediat și în TEST4); apoi INSERT direct → RD004 (TEST3b). Nicio rezervare reușită.
DO $t$ DECLARE r text; n0 int := coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0); BEGIN
  r := pg_temp.r30l_stare('SELECT public.fn_red_numar_document(''C'', ''TST'', 1)');
  IF r NOT LIKE 'RD005:%' THEN RAISE EXCEPTION 'TEST3d FAIL: %', r; END IF;
  IF coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0) <> n0 THEN RAISE EXCEPTION 'TEST3d FAIL: contorul C s-a schimbat'; END IF;
  RAISE NOTICE 'TEST3d OK (numar C direct refuzat: RD005, contor neschimbat)';
END $t$;
SELECT pg_temp.r30l_ca(NULL, 'postgres');
-- TEST3c: garda rezervării — INVOKER, fără EXECUTE public, trigger BEFORE INSERT primul în ordine
DO $t$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocari_rezerva_garda()'::regprocedure AND NOT prosecdef)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_convocari'::regclass AND tgname = 'trg_red_convocari_garda_rezerva' AND tgenabled = 'O' AND tgtype = 7)
     OR (SELECT min(tgname::text COLLATE "C") FROM pg_trigger WHERE tgrelid = 'public.red_convocari'::regclass AND NOT tgisinternal AND (tgtype & 2) = 2) <> 'trg_red_convocari_garda_rezerva' THEN
    RAISE EXCEPTION 'TEST3c FAIL: garda rezervarii';
  END IF;
  RAISE NOTICE 'TEST3c OK';
END $t$;
-- TEST4: nimic scris (contorul C si numarul de convocari neschimbate)
DO $t$ BEGIN
  IF (SELECT coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0) || '|' || (SELECT count(*) FROM public.red_convocari)) IS DISTINCT FROM current_setting('r30l.amprenta') THEN
    RAISE EXCEPTION 'TEST4 FAIL: s-a scris ceva (amprenta % -> %)', current_setting('r30l.amprenta'),
      (SELECT coalesce((SELECT ultimul FROM public.red_numere WHERE cheie = 'C'), 0) || '|' || (SELECT count(*) FROM public.red_convocari));
  END IF;
  RAISE NOTICE 'TEST4 OK (nimic scris)';
END $t$;
SELECT 'DRY productie 20261130l: teste OK';
