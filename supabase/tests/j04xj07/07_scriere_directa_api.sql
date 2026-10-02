-- JX-07 · Cerința 7: scriere DIRECTĂ pe căile API/RPC permise aplicației (authenticated cu modulul Ofertare = ce poate
-- face orice client PostgREST cu JWT-ul utilizatorului, fără UI), plus cheia de serviciu, anon și utilizator fără acces:
-- orice încercare de a pune „depus” / de a ocoli J04 sau J07 → REFUZ sau fără efect; starea și dovezile neschimbate.

-- JX-07a ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07a', 'PATCH direct stare=depus (editor, fără UI): fără nicio verificare → REFUZ J07; cu J07 OK dar fără J04 → REFUZ J04');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
-- @edge j07 1
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'verificare PASS lipsă');
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus', depus_la = now(), nota = 'direct' WHERE id = 1 RETURNING id$$, 'P0001', 'verificare PASS lipsă');
SELECT jx.trecut('JX-07a');
ROLLBACK;
SELECT jx.baza_intacta('JX-07a');

-- JX-07b ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07b', 'POST pachet nou direct în „depus”/„aprobat” (editor → RLS) → REFUZ; UPSERT pe pachetul existent fără verificări → REFUZ; cheia de serviciu cu J04+J07 OK → INSERT „depus” tot REFUZ (J07 pachet_versiune)');
:editor
SELECT jx.refuza_oricare($$INSERT INTO ofertare_pt_pachet(licitatie_id, versiune, stare, aprobat_de, aprobat_la, depus_la)
  VALUES (1, 9, 'depus', auth.uid(), now(), now())$$, ARRAY['42501', 'P0001']);
SELECT jx.refuza_oricare($$INSERT INTO ofertare_pt_pachet(licitatie_id, versiune, stare, aprobat_de, aprobat_la)
  VALUES (1, 9, 'aprobat', auth.uid(), now())$$, ARRAY['42501', 'P0001']);
-- UPSERT (PostgREST Prefer: resolution=merge-duplicates) = INSERT … ON CONFLICT DO UPDATE → aceleași triggere de UPDATE.
SELECT jx.refuza($$INSERT INTO ofertare_pt_pachet(id, licitatie_id, versiune) VALUES (1, 1, 1)
  ON CONFLICT (id) DO UPDATE SET stare = 'depus'$$, 'P0001', 'J07: controale blocante');
-- @edge j07 1
:editor
SELECT jx.refuza($$INSERT INTO ofertare_pt_pachet(id, licitatie_id, versiune) VALUES (1, 1, 1)
  ON CONFLICT (id) DO UPDATE SET stare = 'depus'$$, 'P0001', 'verificare PASS lipsă');
-- @edge j04 1
:service
-- BYPASSRLS nu ocolește triggerele. Pe INSERT, triggerul J04 (BEFORE UPDATE OF stare) NU rulează; refuzul vine din
-- J07 (pachet_versiune: rândul nou nu e încă „pachetul curent”) — chiar cu J04 + J07 OK. Dependență notată în raport.
SELECT jx.egal(jx.blocaje(1), '[]', 'J07 OK, J04 PASS: doar calea de INSERT e sub test');
SELECT jx.refuza($$INSERT INTO ofertare_pt_pachet(licitatie_id, versiune, stare, aprobat_de, aprobat_la, depus_la)
  VALUES (1, 9, 'depus', '00000000-0000-4000-8000-000000000007', now(), now())$$, 'P0001', 'J07: pachet_versiune');
SELECT jx.trecut('JX-07b');
ROLLBACK;
SELECT jx.baza_intacta('JX-07b');

-- JX-07c ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07c', 'ocoliri pe coloane (editor): depus_la / aprobat_* / versiune / licitatie_id / retrogradare aprobat→propus → REFUZ; depus_la antedatat e rescris de server');
:editor
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET depus_la = now() WHERE id = 1$$, 'P0001', 'depus_la se scrie doar');
SELECT jx.refuza_oricare($$UPDATE ofertare_pt_pachet SET aprobat_la = now() - interval '1 day' WHERE id = 1$$, ARRAY['P0001', '42501']);
SELECT jx.refuza_oricare($$UPDATE ofertare_pt_pachet SET versiune = 7 WHERE id = 1$$, ARRAY['P0001', '42501']);
SELECT jx.refuza_oricare($$UPDATE ofertare_pt_pachet SET licitatie_id = 2 WHERE id = 1$$, ARRAY['P0001', '42501']);
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'propus', aprobat_de = NULL, aprobat_la = NULL WHERE id = 1$$, 'P0001', 'aprobat_de/aprobat_la nu se pot modifica');
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'propus' WHERE id = 1$$, 'P0001', 'Tranziție de pachet interzisă: aprobat → propus');
-- @edge j04 1
-- @edge j07 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus', depus_la = timestamptz '2020-01-01 00:00:00+00' WHERE id = 1;
:admin
SELECT jx.ok((SELECT depus_la = now() FROM ofertare_pt_pachet WHERE id = 1), 'depus_la antedatat de client e înlocuit cu ora serverului');
SELECT jx.trecut('JX-07c');
ROLLBACK;
SELECT jx.baza_intacta('JX-07c');

-- JX-07d ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07d', 'dovezi falsificate prin API: INSERT/UPDATE/DELETE pe verificări J04 și rezultate J07 (editor, anon) → permission denied');
:editor
SELECT jx.refuza($$INSERT INTO ofertare_pt_pachet_verificari(pachet_fisier_id, bucket, fisier_path, obj_id, obj_updated_at, obj_size,
  sha256_calculat, sha256_declarat, rezultat) SELECT id, 'ofertare', fisier_path, gen_random_uuid(), now(), 1, sha256, sha256, 'PASS'
  FROM ofertare_pt_pachet_fisiere WHERE fisier_path = 'pt/1/v1/Propunere.docx'$$, '42501', 'permission denied');
SELECT jx.refuza($$INSERT INTO ofertare_poarta_rezultate_text(control_code, licitatie_id, parser_version, sursa_hash, stare, detalii)
  VALUES ('anexe', 1, 'j07-text-v1', repeat('a', 64), 'ok', '{}')$$, '42501', 'permission denied');
SELECT jx.refuza($$UPDATE ofertare_poarta_rezultate_text SET stare = 'ok'$$, '42501', 'permission denied');
SELECT jx.refuza($$DELETE FROM ofertare_pt_pachet_verificari$$, '42501', 'permission denied');
:anon
SELECT jx.refuza($$INSERT INTO ofertare_poarta_rezultate_text(control_code, licitatie_id, parser_version, sursa_hash, stare, detalii)
  VALUES ('anexe', 1, 'j07-text-v1', repeat('a', 64), 'ok', '{}')$$, '42501', 'permission denied');
SELECT jx.trecut('JX-07d');
ROLLBACK;
SELECT jx.baza_intacta('JX-07d');

-- JX-07e ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07e', 'RPC-uri: cele interne J04/J07 (snapshot, sursă text, impune, controale) neexecutabile de authenticated/anon; poarta_server e read-only; suprafața RPC SECURITY DEFINER volatilă e cunoscută și nu atinge pachetul/dovezile');
:admin
SELECT jx.egal((SELECT coalesce(jsonb_agg(p.proname ORDER BY p.proname), '[]') FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'ofertare_ctl_%' OR p.proname IN ('ofertare_pt_fisier_snapshot',
    'ofertare_poarta_text_sursa', 'ofertare_poarta_impune', 'ofertare_poarta_parser_version', 'ofertare_poarta_rezultat', 'fn_pt_fisier_cere_verificare'))
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  '[]', 'funcțiile interne J04/J07 nu sunt executabile de authenticated/anon');
SELECT jx.ok((SELECT provolatile = 's' AND prosecdef FROM pg_proc WHERE oid = 'public.ofertare_poarta_server(bigint)'::regprocedure)
  AND has_function_privilege('authenticated', 'public.ofertare_poarta_server(bigint)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ofertare_poarta_server(bigint)'::regprocedure, 'EXECUTE'),
  'singurul RPC J07 pentru UI: ofertare_poarta_server, STABLE (nu poate scrie), doar authenticated');
-- Suprafața: funcții din public executabile de authenticated/anon, care nu sunt triggere, VOLATILE și SECURITY DEFINER
-- (singurele care pot scrie ocolind RLS). Lista e fixată: o funcție nouă aici cere test explicit.
SELECT jx.egal((SELECT jsonb_agg(p.proname ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.prorettype <> 'trigger'::regtype AND p.provolatile = 'v' AND p.prosecdef
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  '["ofertare_clarificare_exceptie_identitate","ofertare_clarificare_reconfirma","ofertare_clarificari_notifica","ofertare_derogare_depunere","ofertare_transfer_conflicte_confirma"]',
  'suprafața RPC care poate scrie e cea cunoscută');
SELECT jx.egal((SELECT coalesce(jsonb_agg(p.proname ORDER BY p.proname), '[]') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND p.prorettype <> 'trigger'::regtype
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
    AND pg_get_functiondef(p.oid) ~* '(ofertare_pt_pachet|ofertare_poarta_rezultate_text|storage\.objects)'
    AND pg_get_functiondef(p.oid) ~* '\m(insert|update|delete|truncate)\M'),
  '[]', 'niciun RPC accesibil aplicației nu scrie pachetul / manifestul / dovezile / Storage');
SELECT jx.egal((SELECT coalesce(jsonb_agg(p.proname), '[]') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND pg_get_functiondef(p.oid) ~* '(session_replication_role|disable\s+trigger)'),
  '[]', 'nicio funcție nu poate dezactiva triggerele (session_replication_role / DISABLE TRIGGER)');
:editor
SELECT jx.refuza($$SELECT public.ofertare_pt_fisier_snapshot(2)$$, '42501', 'permission denied');
SELECT jx.refuza($$SELECT public.ofertare_poarta_text_sursa(1)$$, '42501', 'permission denied');
SELECT jx.refuza($$SELECT public.ofertare_poarta_impune(1, 1)$$, '42501', 'permission denied');
SELECT jx.refuza($$SELECT public.ofertare_ctl_text(1, 'anexe')$$, '42501', 'permission denied');
SELECT jx.fotografiaza('inainte_rpc');
SELECT (public.ofertare_poarta_server(1))->>'stare';
SELECT jx.neschimbat('inainte_rpc', 'ofertare_poarta_server nu scrie nimic');
:anon
SELECT jx.refuza($$SELECT public.ofertare_poarta_server(1)$$, '42501', 'permission denied');
:fara_acces
SELECT jx.refuza($$SELECT public.ofertare_poarta_server(1)$$, '42501', 'Nu ai acces la Ofertare');
SELECT jx.trecut('JX-07e');
ROLLBACK;
SELECT jx.baza_intacta('JX-07e');

-- JX-07f ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07f', 'licitație „depusă” prin API: fără pachet depus → REFUZ J02; derogare de ne-owner (RPC sau coloană) → 42501; derogare owner cu J07 BLOCK → REFUZ J07, auditul J05 anulat atomic');
:editor
SELECT jx.refuza($$UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1$$, 'P0001', 'lipseste pachetul PT in stare depus');
SELECT jx.refuza($$SELECT public.ofertare_derogare_depunere(1, 'motiv suficient de lung', true)$$, '42501', 'doar ownerul');
SELECT jx.refuza($$UPDATE ofertare_licitatii SET derogare_depunere = true WHERE id = 1$$, '42501', 'doar ownerul');
:owner
SELECT jx.refuza($$UPDATE ofertare_licitatii SET status = 'depusa', derogare_depunere = true, derogare_motiv = 'derogare de test' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
SELECT jx.ok((SELECT count(*) = 0 FROM ofertare_derogari_audit), 'refuzul J07 a anulat și rândul de audit J05');
SELECT public.ofertare_derogare_depunere(1, 'derogare prin RPC, de test', true);
SELECT jx.refuza($$UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
SELECT jx.trecut('JX-07f');
ROLLBACK;
SELECT jx.baza_intacta('JX-07f');

-- JX-07g ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07g', 'Storage prin API (editor): obiectele din pachetul aprobat sunt înghețate — UPDATE/DELETE fără efect, reupload la aceeași cale refuzat, upsert refuzat');
:editor
SELECT jx.fara_efect($$UPDATE storage.objects SET metadata = '{"size":1,"eTag":"x"}' WHERE name = 'pt/1/v1/depus/depus_final_Final.pdf'$$);
SELECT jx.fara_efect($$DELETE FROM storage.objects WHERE name = 'pt/1/v1/Propunere.docx'$$);
SELECT jx.refuza($$SELECT jx.urca('pt/1/v1/depus/depus_final_Final.pdf', 'alt continut')$$, '23505', 'duplicate key');
SELECT jx.refuza_oricare($$INSERT INTO storage.objects(id, bucket_id, name, updated_at, metadata)
  VALUES (gen_random_uuid(), 'ofertare', 'pt/1/v1/depus/depus_final_Final.pdf', now(), '{"size":3,"eTag":"y"}')
  ON CONFLICT (bucket_id, name) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at$$, ARRAY['42501']);
SELECT jx.trecut('JX-07g');
ROLLBACK;
SELECT jx.baza_intacta('JX-07g');

-- JX-07h ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07h', 'cheia de serviciu (BYPASSRLS), fără dovezi: UPDATE stare=depus → REFUZ (triggerele nu se ocolesc cu BYPASSRLS)');
:service
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'J07: controale blocante');
-- @edge j07 1
:service
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, 'P0001', 'verificare PASS lipsă');
SELECT jx.trecut('JX-07h');
ROLLBACK;
SELECT jx.baza_intacta('JX-07h');

-- JX-07i ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07i', 'fără drept: utilizator fără modulul Ofertare → UPDATE fără efect (RLS); anon → fără efect sau permission denied; chiar cu ambele verificări OK');
-- @edge j04 1
-- @edge j07 1
:fara_acces
SELECT jx.fara_efect($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$);
SELECT jx.refuza_oricare($$INSERT INTO ofertare_pt_pachet(licitatie_id, versiune) VALUES (1, 5)$$, ARRAY['42501']);
:anon
SELECT jx.fara_efect_sau($$UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1$$, ARRAY['42501']);
-- Fixture-ul nu are RLS pe ofertare_licitatii: anon ajunge la poarta de depunere, care refuză (P0001). Oricum, fără efect.
SELECT jx.fara_efect_sau($$UPDATE ofertare_licitatii SET status = 'depusa' WHERE id = 1$$, ARRAY['42501', 'P0001']);
SELECT jx.trecut('JX-07i');
ROLLBACK;
SELECT jx.baza_intacta('JX-07i');

-- JX-07j ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SELECT jx.start('JX-07j', 'după depunere pachetul e imuabil pe orice cale: editor → fără efect (RLS), cheia de serviciu → REFUZ; manifestul nu mai primește rânduri');
-- @edge j04 1
-- @edge j07 1
:editor
UPDATE ofertare_pt_pachet SET stare = 'depus' WHERE id = 1;
SELECT jx.fara_efect($$UPDATE ofertare_pt_pachet SET stare = 'aprobat' WHERE id = 1$$);
SELECT jx.fara_efect($$UPDATE ofertare_pt_pachet SET nota = 'modificat după depunere' WHERE id = 1$$);
SELECT jx.urca('pt/1/v1/depus/depus_final_Dupa.pdf', 'dupa depunere');
SELECT jx.refuza($$SELECT jx.fisier(1, 'depus_final', 'Dupa.pdf', 'pt/1/v1/depus/depus_final_Dupa.pdf', 'dupa depunere')$$, '42501', 'row-level security');
:service
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET stare = 'aprobat' WHERE id = 1$$, 'P0001', 'Pachetul depus este imuabil');
SELECT jx.refuza($$UPDATE ofertare_pt_pachet SET depus_la = now() - interval '1 day' WHERE id = 1$$, 'P0001', 'Pachetul depus este imuabil');
SELECT jx.trecut('JX-07j');
ROLLBACK;
SELECT jx.baza_intacta('JX-07j');
