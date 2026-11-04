-- DRY PRODUCȚIE 20261130j + 20261130k (Redări e-mail F1, schema). Runner: O SINGURĂ tranzacție ANULATĂ:
--   BEGIN; set_config('gazpet.livrare_migrare', '20261130j_redari_mail_f1_schema:' || txid_current(), true); \i migrarea j;
--          set_config('gazpet.livrare_migrare', '20261130k_redari_mail_f1_reguli:' || txid_current(), true); \i migrarea k;
--          \i ACEST fișier;
--          RESET ROLE + claims goale; set_config('gazpet.revenire_20261130k', 'REDARI_MAIL_F1_REGULI_SCOS:' || txid_current(), true); \i revenirea k;
--          set_config('gazpet.revenire_20261130j', 'REDARI_MAIL_F1_SCHEMA_SCOS:' || txid_current(), true); \i revenirea j;
--          SELECT public.fn_red_storage_verifica_redari(true);   -- starea storage de dinainte, exact (verificatorul 20261130e)
--          SELECT md5(prosrc) = '27479409c823996f436459089945c789' FROM pg_proc WHERE oid = 'public.fn_red_jurnal()'::regprocedure;   -- t
--   ROLLBACK;   (scris de runner, ultima instrucțiune)
-- Aici NU se scrie nimic în tabelele reale: doar citiri (catalog + numărători), refuzuri de PRIVILEGIU (verificate înaintea oricărei scrieri)
-- și SELECT-uri ca rolurile reale. Cazurile cu fixture (stările, CHECK-urile, proveniența cu INSERT / PATCH, storage INSERT, gardul owner)
-- sunt în DRY-ul LOCAL (_dryrun_local.sql, PG17 de test), unde se pot scrie rânduri.
-- BLOCĂRI (de știut la rularea pe prod): migrarea ia ACCESS EXCLUSIVE pe storage.objects (ALTER POLICY), red_jurnal (ALTER POLICY),
-- red_proiecte (ADD COLUMN) și SHARE ROW EXCLUSIVE pe red_raspunsuri (CREATE TRIGGER) până la ROLLBACK — deci DRY-ul se rulează scurt,
-- în afara orelor de lucru Redări; lock_timeout 5s în migrare, 2s aici: dacă așteaptă, pică fără să blocheze pe alții mai mult.
-- Identități REALE din user_module_access (owner, editor / viewer ne-owner pe redari) + un profil FĂRĂ nivel Redări, simulate prin
-- request.jwt.claims + SET LOCAL ROLE (ca DRY-ul 20261130i); anon și service_role.
SELECT set_config('lock_timeout', '2s', true);
CREATE FUNCTION pg_temp.r30j_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); RETURN; END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
END $h$;
CREATE FUNCTION pg_temp.r30j_refuza(p_sql text, p_stare text) RETURNS boolean LANGUAGE plpgsql AS $h$
BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE = p_stare;
END $h$;
CREATE FUNCTION pg_temp.r30j_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('r30j.' || p, true), ''); $h$;
CREATE FUNCTION pg_temp.r30j_n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $h$
DECLARE v bigint; BEGIN EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v; RETURN v; END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.r30j_ca(uuid, text), pg_temp.r30j_refuza(text, text), pg_temp.r30j_g(text), pg_temp.r30j_n(text) TO authenticated, anon, service_role;

-- TEST0: garda, identitățile reale, numărătorile de referință (ca postgres = mentenanța); nicio scriere
DO $t$
DECLARE ow uuid; ed uuid; vw uuid; fa uuid; pr uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130k_redari_mail_f1_reguli:' || txid_current() THEN
    RAISE EXCEPTION 'TEST0 FAIL: garda (j + k in aceeasi tranzactie, k ultima)';
  END IF;
  SELECT id INTO ow FROM public.profiles WHERE is_owner ORDER BY id LIMIT 1;
  SELECT a.profile_id INTO ed FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level IN ('editor', 'admin') AND p.is_owner IS NOT TRUE ORDER BY (a.access_level = 'editor') DESC, a.id LIMIT 1;
  SELECT a.profile_id INTO vw FROM public.user_module_access a JOIN public.profiles p ON p.id = a.profile_id
    WHERE a.module = 'redari' AND a.access_level = 'viewer' AND p.is_owner IS NOT TRUE ORDER BY a.id LIMIT 1;
  SELECT p.id INTO fa FROM public.profiles p WHERE p.is_owner IS NOT TRUE
    AND NOT EXISTS (SELECT 1 FROM public.user_module_access a WHERE a.profile_id = p.id AND a.module = 'redari') ORDER BY p.id LIMIT 1;
  SELECT id INTO pr FROM public.red_proiecte ORDER BY created_at LIMIT 1;
  IF ow IS NULL OR ed IS NULL OR vw IS NULL OR fa IS NULL OR pr IS NULL THEN RAISE EXCEPTION 'TEST0 FAIL: identitati / proiect lipsa'; END IF;
  PERFORM set_config('r30j.owner', ow::text, true); PERFORM set_config('r30j.editor', ed::text, true); PERFORM set_config('r30j.viewer', vw::text, true);
  PERFORM set_config('r30j.fara', fa::text, true); PERFORM set_config('r30j.proiect', pr::text, true);
  -- referințele pentru regresii (citite ca postgres, peste RLS): obiectele redari în afara mail/, jurnalul vizibil viewer-ului azi
  PERFORM set_config('r30j.obiecte_redari', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'redari' AND left(name, 5) <> 'mail/')::text, true);
  PERFORM set_config('r30j.jurnal_viewer', (SELECT count(*) FROM public.red_jurnal WHERE tabela <> ALL (ARRAY['red_detinatori_contact', 'red_raspunsuri_meta']))::text, true);
  PERFORM set_config('r30j.jurnal_tot', (SELECT count(*) FROM public.red_jurnal)::text, true);
  RAISE NOTICE 'TEST0 OK (obiecte redari %, jurnal %)', current_setting('r30j.obiecte_redari'), current_setting('r30j.jurnal_tot');
END $t$;

-- TEST1: inventarul (j) și regulile (k) — verificatorul + triggerele, privilegiile, ACL-ul funcțiilor; răspunsurile email preexistente = 0
DO $t$ BEGIN
  PERFORM public.fn_red_mail_verifica_baza('dupa_j');
  IF (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname ~ '^red_mail_') <> 9
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_raspunsuri'::regclass AND NOT tgisinternal) <> 5
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_raspunsuri'::regclass AND tgname = 'trg_red_raspunsuri_mail_sursa' AND tgdeferrable AND tginitdeferred)
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_proiecte'::regclass AND NOT tgisinternal) <> 3
     OR EXISTS (SELECT 1 FROM public.red_raspunsuri WHERE canal = 'email')
     OR has_function_privilege('anon', 'public.fn_red_mail_numaratori(uuid)', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.fn_red_mail_numaratori(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_red_mail_are_legatura_juridica(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_red_mail_verifica_baza(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST1 FAIL: inventar / reguli / ACL';
  END IF;
  RAISE NOTICE 'TEST1 OK';
END $t$;

-- TEST2: viewer — 0 rânduri red_mail_* (setari / flux au rânduri), numărătorile merg; jurnalul vizibil lui = ca azi; storage redari: ca azi (0 în afara corespondenței)
SELECT pg_temp.r30j_ca(pg_temp.r30j_g('viewer')::uuid, 'authenticated');
DO $t$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['red_mail_setari', 'red_mail_flux', 'red_mail_primite', 'red_mail_obiecte', 'red_mail_dedup', 'red_mail_evenimente', 'red_mail_raspuns_sursa', 'red_mail_adrese_propuse'] LOOP
    IF pg_temp.r30j_n('SELECT 1 FROM public.' || t) <> 0 THEN RAISE EXCEPTION 'TEST2 FAIL: viewer vede %', t; END IF;
  END LOOP;
  IF NOT pg_temp.r30j_refuza('SELECT 1 FROM public.red_mail_oauth_state', '42501') THEN RAISE EXCEPTION 'TEST2 FAIL: viewer pe oauth_state'; END IF;
  IF pg_temp.r30j_n(format('SELECT 1 FROM public.fn_red_mail_numaratori(%L::uuid)', pg_temp.r30j_g('proiect'))) <> 0 THEN RAISE EXCEPTION 'TEST2 FAIL: numaratori (asteptat 0 randuri)'; END IF;
  IF pg_temp.r30j_n('SELECT 1 FROM public.red_jurnal') IS DISTINCT FROM current_setting('r30j.jurnal_viewer')::bigint THEN
    RAISE EXCEPTION 'TEST2 FAIL: jurnalul vizibil viewer-ului s-a schimbat (% vs %)', pg_temp.r30j_n('SELECT 1 FROM public.red_jurnal'), current_setting('r30j.jurnal_viewer');
  END IF;
  IF pg_temp.r30j_n('SELECT 1 FROM storage.objects WHERE bucket_id = ''redari'' AND left(name, 5) = ''mail/''') <> 0 THEN RAISE EXCEPTION 'TEST2 FAIL: viewer pe mail/'; END IF;
  RAISE NOTICE 'TEST2 OK';
END $t$;

-- TEST3: editor (și owner) — văd setările / fluxurile, NU pot scrie nimic direct (refuz de privilegiu, înainte de orice rând); storage în afara mail/ ca azi
DO $t$
DECLARE u uuid; t text;
BEGIN
  FOREACH u IN ARRAY ARRAY[pg_temp.r30j_g('editor')::uuid, pg_temp.r30j_g('owner')::uuid] LOOP
    PERFORM pg_temp.r30j_ca(u, 'authenticated');
    IF pg_temp.r30j_n('SELECT 1 FROM public.red_mail_setari') <> 1 OR pg_temp.r30j_n('SELECT 1 FROM public.red_mail_flux') <> 2 THEN RAISE EXCEPTION 'TEST3 FAIL: % nu vede setari / flux', u; END IF;
    FOREACH t IN ARRAY ARRAY['red_mail_setari', 'red_mail_flux', 'red_mail_primite', 'red_mail_obiecte', 'red_mail_dedup', 'red_mail_evenimente', 'red_mail_raspuns_sursa', 'red_mail_adrese_propuse', 'red_mail_oauth_state'] LOOP
      IF NOT pg_temp.r30j_refuza(format('INSERT INTO public.%I DEFAULT VALUES', t), '42501') OR NOT pg_temp.r30j_refuza(format('DELETE FROM public.%I', t), '42501') THEN
        RAISE EXCEPTION 'TEST3 FAIL: % are drept de scriere pe %', u, t;
      END IF;
    END LOOP;
    IF NOT pg_temp.r30j_refuza('UPDATE public.red_mail_setari SET citire_activa = true', '42501') OR NOT pg_temp.r30j_refuza('UPDATE public.red_mail_flux SET activ = true', '42501') THEN
      RAISE EXCEPTION 'TEST3 FAIL: % porneste comutatoare direct', u;
    END IF;
    IF pg_temp.r30j_n('SELECT 1 FROM storage.objects WHERE bucket_id = ''redari''') IS DISTINCT FROM current_setting('r30j.obiecte_redari')::bigint THEN
      RAISE EXCEPTION 'TEST3 FAIL: % nu mai vede bucketul redari in afara mail/ (regresie)', u;
    END IF;
  END LOOP;
  PERFORM pg_temp.r30j_ca(NULL, 'postgres');
  RAISE NOTICE 'TEST3 OK';
END $t$;

-- TEST4: fără nivel Redări / anon / authenticated fără sub — nimic (0 rânduri sau 42501); service_role — citește, nu scrie
SELECT pg_temp.r30j_ca(pg_temp.r30j_g('fara')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.r30j_n('SELECT 1 FROM public.red_mail_setari') <> 0 OR pg_temp.r30j_n('SELECT 1 FROM public.red_mail_flux') <> 0
     OR NOT pg_temp.r30j_refuza(format('SELECT 1 FROM public.fn_red_mail_numaratori(%L::uuid)', pg_temp.r30j_g('proiect')), '42501') THEN
    RAISE EXCEPTION 'TEST4 FAIL: fara nivel';
  END IF;
  RAISE NOTICE 'TEST4a OK';
END $t$;
SELECT pg_temp.r30j_ca(NULL, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.r30j_n('SELECT 1 FROM public.red_mail_setari') <> 0 OR NOT pg_temp.r30j_refuza(format('SELECT 1 FROM public.fn_red_mail_numaratori(%L::uuid)', pg_temp.r30j_g('proiect')), '42501') THEN
    RAISE EXCEPTION 'TEST4 FAIL: authenticated fara sub';
  END IF;
  RAISE NOTICE 'TEST4b OK';
END $t$;
SELECT pg_temp.r30j_ca(pg_temp.r30j_g('viewer')::uuid, 'anon');
DO $t$ BEGIN
  IF NOT pg_temp.r30j_refuza('SELECT 1 FROM public.red_mail_setari', '42501') OR NOT pg_temp.r30j_refuza('SELECT 1 FROM public.red_mail_primite', '42501')
     OR NOT pg_temp.r30j_refuza(format('SELECT 1 FROM public.fn_red_mail_numaratori(%L::uuid)', pg_temp.r30j_g('proiect')), '42501') THEN
    RAISE EXCEPTION 'TEST4 FAIL: anon (cu sub de viewer in claims)';
  END IF;
  RAISE NOTICE 'TEST4c OK';
END $t$;
SELECT pg_temp.r30j_ca(NULL, 'service_role');
DO $t$ BEGIN
  IF pg_temp.r30j_n('SELECT 1 FROM public.red_mail_flux') <> 2 OR NOT pg_temp.r30j_refuza('INSERT INTO public.red_mail_evenimente (tip) VALUES (''activare'')', '42501')
     OR NOT pg_temp.r30j_refuza('UPDATE public.red_mail_setari SET citire_activa = true', '42501') OR NOT pg_temp.r30j_refuza('SELECT 1 FROM public.red_mail_oauth_state', '42501') THEN
    RAISE EXCEPTION 'TEST4 FAIL: service_role';
  END IF;
  RAISE NOTICE 'TEST4d OK';
END $t$;

-- final: sesiunea revine la postgres, fără claims; nimic scris (jurnalul neschimbat)
SELECT pg_temp.r30j_ca(NULL, 'postgres');
DO $t$ BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR coalesce(current_setting('request.jwt.claims', true), '') <> '' THEN RAISE EXCEPTION 'FINAL FAIL: rol / claims'; END IF;
  IF (SELECT count(*) FROM public.red_jurnal) IS DISTINCT FROM current_setting('r30j.jurnal_tot')::bigint OR EXISTS (SELECT 1 FROM public.red_mail_evenimente) THEN
    RAISE EXCEPTION 'FINAL FAIL: DRY-ul a scris ceva';
  END IF;
  RAISE NOTICE 'DRY productie 20261130j + 20261130k OK';
END $t$;
