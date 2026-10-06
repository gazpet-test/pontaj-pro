-- Teste SQL pentru 20261018a (generator decizii, PR1). Rulează DOAR prin scripts/test_hr_decizii.sh, pe baza locală *_test,
-- după schelet + migrare. Numerele (Tnn) trimit la testele de acceptare din docs/HR/GENERATOR_DECIZII_SPEC.md §10.
\set ON_ERROR_STOP on
SET client_min_messages = notice;
\set RAZVAN '00000000-0000-0000-0000-000000000121'
\set MARILENA '00000000-0000-0000-0000-000000000125'
\set NATALIA '00000000-0000-0000-0000-000000000126'
\set PANTEA '00000000-0000-0000-0000-000000000090'
\set EXEC '00000000-0000-0000-0000-0000000000e1'
\set CMC '00000000-0000-0000-0000-0000000000c1'
\set CLAUDE '00000000-0000-0000-0000-0000000000c2'
\set HRED '00000000-0000-0000-0000-0000000000a1'
\set HREX '00000000-0000-0000-0000-0000000000a2'
\set NUL '00000000-0000-0000-0000-0000000000f0'
\set AN `date +%Y`

-- ═══ T42 catalog: privilegii, invoker, excepția _hr_azi ═══
SELECT teste.e('T42a anon/service_role fara scriere pe registru', NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['hr_decizii','hr_decizii_evenimente','hr_decizii_contor','hr_decizii_semnatari','hr_decizii_tipuri']) t(n),
       unnest(ARRAY['anon','service_role']) r(n), unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p(n)
  WHERE has_table_privilege(r.n, 'public.' || t.n, p.n)));
SELECT teste.e('T42b authenticated: doar coloanele de redactare', has_column_privilege('authenticated','public.hr_decizii','titlu','UPDATE')
  AND NOT has_column_privilege('authenticated','public.hr_decizii','stare','UPDATE') AND NOT has_column_privilege('authenticated','public.hr_decizii','snapshot','INSERT')
  AND NOT has_table_privilege('authenticated','public.hr_decizii_evenimente','INSERT'));
SELECT teste.e('T42c _hr_* fara EXECUTE (exceptie _hr_azi)', NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  AND p.proname LIKE '\_hr\_%' AND p.proname <> '_hr_azi' AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
  OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')))
  AND has_function_privilege('authenticated', 'public._hr_azi()', 'EXECUTE'));
SELECT teste.e('T42d RPC-uri: fara EXECUTE pentru anon/service_role', NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  AND p.proname LIKE 'fn\_hr\_decizi%' AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'))));
SELECT teste.e('T42e trigger imuabil SECURITY INVOKER', NOT (SELECT prosecdef FROM pg_proc WHERE proname = '_hr_trg_imuabil'));
SELECT teste.e('T62 _hr_decizie_avertismente fara valoare implicita pentru p_mod',
  pg_get_function_arguments('public._hr_decizie_avertismente(jsonb,jsonb,integer,text)'::regprocedure) !~ 'DEFAULT');
SELECT teste.e('T47 fusul orar', (timestamptz '2026-10-06 23:30Z' AT TIME ZONE 'Europe/Bucharest')::date = '2026-10-07');
SELECT teste.e('T53 id lung din cale → NULL', public.fn_hr_decizii_id_din_cale('HR/2026/9223372036854775808/semnat_1.pdf') IS NULL
  AND public.fn_hr_decizii_id_din_cale('HR/2026/' || repeat('9', 300) || '/semnat_1.pdf') IS NULL
  AND public.fn_hr_decizii_id_din_cale('HR/2026/x/semnat_1.pdf') IS NULL AND public.fn_hr_decizii_id_din_cale('HR/2026/17/generat_1700000000000.pdf') = 17);
SELECT teste.e('T39 seed: 15 tipuri, 3 semnatari, implicit 121', (SELECT count(*) FROM hr_decizii_tipuri) = 15
  AND (SELECT count(DISTINCT semnatar_implicit_id) FROM hr_decizii_tipuri) = 1
  AND (SELECT s.employee_id FROM hr_decizii_semnatari s JOIN hr_decizii_tipuri t ON t.semnatar_implicit_id = s.id LIMIT 1) = 121
  AND (SELECT autorizatie_ceruta FROM hr_decizii_tipuri WHERE cod = 'CTC_QC') = 'nu'
  AND (SELECT este_reprezentant_legal FROM hr_decizii_semnatari WHERE employee_id = 125) = false);
SELECT teste.e('T36 hr.decizii nu e in app_modules', NOT EXISTS (SELECT 1 FROM app_modules WHERE key = 'hr.decizii'));
SELECT teste.e('T55v vectorii acoperaDomeniul', public._hr_acopera_domeniu(ARRAY['9.1'], ARRAY['1.1','9.1'])
  AND NOT public._hr_acopera_domeniu(ARRAY['8.2'], ARRAY['9.1']) AND NOT public._hr_acopera_domeniu(ARRAY['8.4D'], ARRAY['8.4T'])
  AND public._hr_acopera_domeniu(ARRAY['8.4'], ARRAY['8.4T']) AND NOT public._hr_acopera_domeniu(ARRAY[''], ARRAY['9.1']));

-- ═══ T36 preview-ul de la apply: liste nominale ═══
SELECT teste.e('T36a emitentii = {121,125,126}', (SELECT array_agg(p.employee_id ORDER BY p.employee_id) FROM profiles p
   WHERE (public._hr_decizii_termeni(p.id)->>'owner')::boolean OR (public._hr_decizii_termeni(p.id)->>'hr')::boolean) = ARRAY[121,125,126]::bigint[]);
SELECT teste.e('T27 contul Claude nu trece citire_scan (fara fisa)', NOT (public._hr_decizii_termeni(:'CLAUDE')->>'are_fisa')::boolean);

-- ═══ T41 fail-closed: profil fără nimic ═══
SELECT teste.ca(:'NUL');
SELECT teste.e('T41a poate() = false, nu NULL', public.fn_hr_decizii_poate('citire') = false AND public.fn_hr_decizii_poate('inventat') = false
  AND public.fn_hr_decizii_poate('citire_doc', 999999) = false AND public.fn_hr_decizii_poate('owner') = false);
SELECT teste.eroare('T41b rezerva', $$SELECT public.fn_hr_decizie_rezerva('{"cerere_id":"11111111-1111-1111-1111-111111111111"}')$$, 'fără drepturi');
SELECT teste.eroare('T41c importa', $$SELECT public.fn_hr_decizie_importa('{}')$$, 'fără drepturi');
SELECT teste.eroare('T41d contor', $$SELECT public.fn_hr_decizii_contor_initializeaza(2026, 1, 'x')$$, 'fără drepturi');
SELECT teste.eroare('T41e emite', $$SELECT public.fn_hr_decizie_emite(1, repeat('a',64), gen_random_uuid(), 12)$$, 'fără drepturi');
SELECT teste.eroare('T41f emitenti', $$SELECT public.fn_hr_decizii_emitenti()$$, 'fără drepturi');
SELECT teste.e('T41g SELECT pe registru = 0', (SELECT count(*) FROM hr_decizii) = 0 AND (SELECT count(*) FROM hr_decizii_semnatari) = 0);
RESET ROLE;
SELECT teste.ca(:'PANTEA');
SELECT teste.e('T24 superadmin fara HR nu citeste', public.fn_hr_decizii_poate('citire') = false AND public.fn_hr_decizii_poate('emitere') = false);
RESET ROLE;
SELECT teste.ca(:'HRED');
SELECT teste.e('T25/T36 editor hr din Ofertare: nimic', public.fn_hr_decizii_poate('redactare') = false AND public.fn_hr_decizii_poate('citire') = false);
RESET ROLE;

-- ═══ T20, T44, T67: importul seriei Mironu (Natalia) ═══
SELECT teste.ca(:'NATALIA');
SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'serie','HR','an',2026,'numar',912,'numar_sufix',' BIS ',
  'tip_cod','INSPECTOR_SSM','eticheta_functie','Inspector Sanatate si Securitate in Munca','nivel','proiect','proiect_id',32,
  'employee_id',201,'data_emitere','2026-09-28','data_efect','2026-09-28','titlu','Dl.')) AS r1 \gset
SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'serie','HR','an',2026,'numar',912,
  'tip_cod','COORDONATOR_SSM','eticheta_functie','Coordonator Sanatate si Securitate in Munca','nivel','proiect','proiect_id',32,
  'employee_id',90,'semnatar_id',(SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121),'data_emitere','2026-09-28','titlu','Dl.')) AS r2 \gset
SELECT teste.e('T44a 912-bis inainte de 912: ambele intra, sufix normalizat', (SELECT count(*) FROM hr_decizii WHERE an = 2026 AND numar = 912) = 2
  AND EXISTS (SELECT 1 FROM hr_decizii WHERE numar = 912 AND numar_sufix = 'bis'));
SELECT teste.eroare('T44b al doilea 912-bis', $$SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2026,'numar',912,'numar_sufix','bis',
  'tip_cod','MP','eticheta_functie','Manager Proiect','nivel','proiect','proiect_id',32,'employee_id',121,'data_emitere','2026-09-28'))$$, 'folosit');
SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2026,'numar',914,
  'tip_cod','MP','eticheta_functie','Manager Proiect','nivel','proiect','proiect_id',32,'employee_id',121,'data_emitere','2026-09-28','titlu','Dl.')) AS r3 \gset
SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2026,'numar',916,
  'tip_cod','RTE','eticheta_functie','RTE','nivel','proiect','proiect_id',32,'employee_id',200,'data_emitere','2026-09-28','titlu','Dl.','propune_efect',true)) AS r916imp \gset
SELECT teste.e('T20 contorul 2026 = 916, auto oprit', (SELECT ultimul = 916 AND NOT auto_permis FROM hr_decizii_contor WHERE an = 2026));
SELECT teste.eroare('T65 import REVOCARE refuzat', $$SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2026,'numar',700,
  'tip_cod','REVOCARE','nivel','firma','persoana_nume','X','data_emitere','2026-09-28'))$$, 'ALTA_DECIZIE');
SELECT teste.eroare('Vf12 import cu revoca_id', $$SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2026,'numar',701,
  'tip_cod','MP','eticheta_functie','Manager Proiect','nivel','proiect','proiect_id',32,'employee_id',121,'revoca_id',1))$$, 'nu se fac prin');
SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'serie','carte_tehnica','an',2025,'numar',391,
     'tip_cod','RTE','eticheta_functie','RTE','nivel','proiect','proiect_id',32,'employee_id',200))->>'numar' AS ct391 \gset
SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'serie','HR','an',2025,'numar',391,
     'tip_cod','ALTA_DECIZIE','eticheta_functie','Paza','descriere','Responsabil paza','nivel','firma','data_emitere','2025-05-05'))->>'numar' AS hr391 \gset
SELECT teste.e('T21 carte tehnica 391/2025 + HR 391/2025 coexista, fara data', :'ct391' = '391' AND :'hr391' = '391'
  AND (SELECT ultimul FROM hr_decizii_contor WHERE an = 2025) = 391 AND NOT EXISTS (SELECT 1 FROM hr_decizii_contor WHERE serie <> 'HR'));
SELECT teste.eroare('T58 ALTA_DECIZIE fara descriere', $$SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2025,'numar',392,
  'tip_cod','ALTA_DECIZIE','eticheta_functie','Gestionar','nivel','firma','data_emitere','2025-05-05'))$$, 'descriere');
SELECT teste.eroare('T50 an viitor', format($$SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',%s,'numar',1,
  'tip_cod','MP','eticheta_functie','Manager Proiect','nivel','proiect','proiect_id',32,'employee_id',121))$$, :AN + 1), 'an invalid');
SELECT teste.eroare('T50b an ≠ anul datei', $$SELECT public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2025,'numar',5,
  'tip_cod','MP','eticheta_functie','Manager Proiect','nivel','proiect','proiect_id',32,'employee_id',121,'data_emitere','2026-01-05'))$$, 'nu e anul');
SELECT teste.eroare('T73 import cerere_id NULL', $$SELECT public.fn_hr_decizie_importa('{"an":2026,"numar":5}')$$, 'cerere_id lipsa');
RESET ROLE;

-- ═══ T51/T5/T6/T59: contorul ═══
SELECT teste.ca(:'NATALIA');
SELECT public.fn_hr_decizii_contor_initializeaza(2026, 916, 'registrul fizic, verificat de Natalia') IS NOT NULL AS ok \gset
SELECT teste.e('T51 ultimul_initial = 916, baza 916', (SELECT ultimul = 916 AND ultimul_initial = 916 AND baza_fizica = 916 AND auto_permis FROM hr_decizii_contor WHERE an = 2026));
SELECT teste.e('T5 urmatorul = 917', (public.fn_hr_decizii_urmatorul_numar(2026)->>'numar')::int = 917);
SELECT teste.eroare('T6 corecteaza ca non-owner', $$SELECT public.fn_hr_decizii_contor_corecteaza(2026, 950, 'x')$$, 'fără drepturi');
SELECT teste.eroare('T6b initializeaza din nou', $$SELECT public.fn_hr_decizii_contor_initializeaza(2026, 920, 'x')$$, 'corecteaza');
SELECT teste.eroare('T6c valori limita', $$SELECT public.fn_hr_decizii_contor_opreste_auto(2026, NULL)$$, 'motivul');
RESET ROLE;
SELECT teste.ca(:'RAZVAN');
SELECT teste.eroare('T6d corecteaza sub baza fizica', $$SELECT public.fn_hr_decizii_contor_corecteaza(2026, 900, 'gresit')$$, 'registrul fizic');
SELECT teste.eroare('T6e baza peste ultimul', $$SELECT public.fn_hr_decizii_contor_corecteaza_baza(2026, 950, 'x')$$, 'ridica intai');
SELECT teste.eroare('T6f valoare 100000', $$SELECT public.fn_hr_decizii_contor_corecteaza(2026, 100000, 'x')$$, 'valoare invalida');
RESET ROLE;

-- ═══ T49/T23/T59/T73: rezervare ═══
SELECT teste.ca(:'NATALIA');
SELECT gen_random_uuid() AS c1 \gset
SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', :'c1', 'tip_cod','ALTA_DECIZIE','descriere','Decizie salarii','nivel','firma',
  'data_emitere', public._hr_azi()))->>'numar' AS rz1 \gset
SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', :'c1', 'tip_cod','ALTA_DECIZIE','descriere','Decizie salarii','nivel','firma',
  'data_emitere', public._hr_azi()))->>'numar' AS rz1b \gset
SELECT teste.e('T49a rezerva idempotenta', :'rz1' = :'rz1b' AND :'rz1' = '917' AND (SELECT ultimul FROM hr_decizii_contor WHERE an = 2026) = 917);
SELECT teste.eroare('T49b acelasi cerere_id, alt payload', format($$SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', %L, 'tip_cod','ALTA_DECIZIE',
  'descriere','Alta','nivel','firma','data_emitere', public._hr_azi()))$$, :'c1'), 'alt continut');
SELECT teste.eroare('T23a rezervare RTE pe Pantea semnata de Pantea → B1', $$SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', gen_random_uuid(),
  'tip_cod','RTE','eticheta_functie','RTE','nivel','proiect','proiect_id',32,'employee_id',90,'titlu','Dl.','data_emitere', public._hr_azi(),
  'semnatar_id',(SELECT id FROM hr_decizii_semnatari WHERE employee_id = 90)))$$, 'B1');
SELECT teste.eroare('T23b rezervare semnata de Tudorache fara R4 confirmat', $$SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', gen_random_uuid(),
  'tip_cod','MP','eticheta_functie','Manager Proiect','nivel','proiect','proiect_id',32,'employee_id',203,'titlu','D-na','data_emitere', public._hr_azi(),
  'semnatar_id',(SELECT id FROM hr_decizii_semnatari WHERE employee_id = 125)))$$, 'R4');
SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', gen_random_uuid(), 'tip_cod','MP','eticheta_functie','Manager Proiect','nivel','proiect',
  'proiect_id',32,'employee_id',203,'titlu','D-na','data_emitere', public._hr_azi(),'confirmari', jsonb_build_array('R4'),
  'semnatar_id',(SELECT id FROM hr_decizii_semnatari WHERE employee_id = 125)))->>'id' AS rz_mp \gset
SELECT teste.e('T23c R4 confirmat salvat in avertismente', (SELECT avertismente @> '[{"cod":"R4"}]' FROM hr_decizii WHERE id = :rz_mp));
SELECT teste.eroare('T73 salt mare cu confirm NULL', $$SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', gen_random_uuid(), 'tip_cod','ALTA_DECIZIE',
  'descriere','x','nivel','firma','data_emitere', public._hr_azi(), 'numar', 9160))$$, 'salt_mare');
SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', gen_random_uuid(), 'tip_cod','ALTA_DECIZIE','descriere','x','nivel','firma',
  'data_emitere', public._hr_azi(), 'numar', 9160, 'confirm_salt', true))->>'id' AS rz_salt \gset
SELECT teste.e('T59 R7 in avertismente + eveniment salt_confirmat', (SELECT avertismente @> '[{"cod":"R7","cerut":9160}]' FROM hr_decizii WHERE id = :rz_salt)
  AND EXISTS (SELECT 1 FROM hr_decizii_evenimente WHERE decizie_id = :rz_salt AND eveniment = 'salt_confirmat'));
SELECT public.fn_hr_decizie_anuleaza(:rz_salt, 'numar tastat gresit') IS NOT NULL AS ok \gset
SELECT teste.e('T19 anulare: numarul ramane ocupat', (SELECT stare FROM hr_decizii WHERE id = :rz_salt) = 'anulata'
  AND (SELECT ultimul FROM hr_decizii_contor WHERE an = 2026) = 9160);
RESET ROLE;
SELECT teste.ca(:'RAZVAN');
SELECT public.fn_hr_decizii_contor_corecteaza(2026, 918, 'salt gresit 9160') IS NOT NULL AS ok \gset
SELECT teste.e('T6g corectat la 918 dupa anulare', (public.fn_hr_decizii_urmatorul_numar(2026)->>'numar')::int = 919);
RESET ROLE;

-- ═══ T30: decizia 916 generată pe date identice (Natalia emite cu nr. manual 9160 → nu; pe un nr. liber 930) ═══
SELECT teste.ca(:'NATALIA');
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, autorizatie_id, domenii_isc, titlu,
                        data_emitere, data_efect, semnatar_id)
VALUES ('RTE','RTE','proiect',200,32,'Instalatie tehnologica de suprafata la sonda 16 Mironu',1,ARRAY['1.1'],'Dl.',
        '2026-09-28','2026-09-28',(SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121))
RETURNING id AS d916 \gset
SELECT public.fn_hr_decizie_previzualizeaza(:d916, 930) AS prev \gset
SELECT teste.e('T30a previzualizare fara blocante, hash 64 hex', (:'prev'::jsonb->>'hash_previzualizare') ~ '^[0-9a-f]{64}$');
SELECT gen_random_uuid() AS ce1 \gset
SELECT public.fn_hr_decizie_emite(:d916, :'prev'::jsonb->>'hash_previzualizare', :'ce1', 12, 930, '[]') AS em \gset
SELECT teste.e('T30b text identic cu 916 (preambul, Art.1–4, semnatura)', (SELECT
     continut->>'preambul' = 'D-nul TRUSU RAZVAN MIHAIL, reprezentant legal al S.C. GAZPET INSTAL SRL cu sediul in Ploiesti, str. Fluturilor, nr. 34, inregistrata la Registrul Comertului sub nr. J2007001650296 cod fiscal RO 22029920 in calitate de angajator;'
 AND continut->'articole'->0->>'text' = 'Incepand cu data de 28.09.2026 , Dl. Dadulescu Cosmin Grigoras se numeste in functia de RTE pentru domeniul 1.1 – Constructii civile, industriale si agricole, in baza Autorizatiei nr. 00004386/12.08.2024 in cadrul proiectului „Instalatie tehnologica de suprafata la sonda 16 Mironu”, contract de executie a lucrarilor nr. 52675/21.09.2026'
 AND continut->'articole'->1->>'text' = 'Atributiile legate de aceasta functie sunt cele prevazute in Fisa Postului.'
 AND continut->'articole'->2->>'text' = 'Aceasta decizie isi pastreaza valabilitatea pana la receptia definitiva a lucrarii.'
 AND continut->'articole'->3->>'text' = 'Prezenta decizie se comunica salariatului si va fi dusa la indeplinire prin intermediul Departamentului Personal.'
 AND jsonb_array_length(continut->'articole') = 4
 AND continut->>'bloc_semnatura' = 'Administrator' || chr(10) || 'Trusu Razvan,'
 AND continut->>'nr' = '930/28.09.2026' AND cod_verificare ~ ('^D' || id || '-[0-9a-f]{8}$')
 AND snapshot->>'font_pt' = '12' AND stare = 'emisa' AND mod_numar = 'manual'
 FROM hr_decizii WHERE id = :d916));
SELECT teste.e('T49c emite repetat = acelasi rezultat, un singur eveniment',
  (public.fn_hr_decizie_emite(:d916, :'prev'::jsonb->>'hash_previzualizare', :'ce1', 12, 930, '[]')->>'numar')::int = 930
  AND (SELECT count(*) FROM hr_decizii_evenimente WHERE decizie_id = :d916 AND eveniment = 'emitere') = 1);
SELECT teste.eroare('T63 acelasi cerere_id, alt font', format($$SELECT public.fn_hr_decizie_emite(%s, %L, %L, 11, 930, '[]')$$, :d916, :'prev'::jsonb->>'hash_previzualizare', :'ce1'), 'alt continut');
RESET ROLE;

-- ═══ T8/T42: imuabilitate din client ═══
SELECT teste.ca(:'NATALIA');
UPDATE hr_decizii SET titlu = 'D-na' WHERE id = :d916;   -- RLS: USING stare = 'draft' → 0 rânduri
SELECT teste.e('T8a2 nimic schimbat', (SELECT titlu FROM hr_decizii WHERE id = :d916) = 'Dl.');
SELECT teste.eroare('T8b INSERT cu stare semnata', $$INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, stare) VALUES ('MP','Manager Proiect','firma','semnata')$$, 'permission denied');
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, titlu) VALUES ('PSI','Responsabil PSI','firma',203,'D-na') RETURNING id AS dr \gset
SELECT teste.eroare('T42f UPDATE snapshot pe draft', format($$UPDATE hr_decizii SET snapshot = '{"x":1}' WHERE id = %s$$, :dr), 'permission denied');
UPDATE hr_decizii SET titlu = 'Dl.' WHERE id = :dr;
SELECT teste.e('T9 versiune++ si jurnal creare/modificare', (SELECT versiune FROM hr_decizii WHERE id = :dr) = 2
  AND (SELECT array_agg(eveniment ORDER BY id) FROM hr_decizii_evenimente WHERE decizie_id = :dr) = ARRAY['creare','modificare_draft']);
DELETE FROM hr_decizii WHERE id = :dr;
SELECT teste.e('T9b stergere draft lasa stergere_draft', EXISTS (SELECT 1 FROM hr_decizii_evenimente WHERE decizie_id = :dr AND eveniment = 'stergere_draft'));
SELECT teste.eroare('T17 jurnalul nu se modifica', 'UPDATE hr_decizii_evenimente SET eveniment = $$x$$', 'permission denied');
RESET ROLE;
SELECT teste.eroare('T17b nici ca postgres (trigger)', 'DELETE FROM hr_decizii_evenimente', 'insert-only');
SELECT teste.eroare('T17c TRUNCATE', 'TRUNCATE hr_decizii_evenimente', 'insert-only');
SET ROLE service_role;
SELECT teste.eroare('T42g service_role INSERT direct', $$INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, stare) VALUES ('MP','Manager Proiect','firma','semnata')$$, 'permission denied');
SELECT teste.eroare('T73b INSERT contor carte_tehnica (CHECK)', $$INSERT INTO hr_decizii_contor (serie, an) VALUES ('carte_tehnica', 2020)$$, NULL);
RESET ROLE;
SELECT teste.eroare('T73c contor carte_tehnica ca postgres → CHECK', $$INSERT INTO hr_decizii_contor (serie, an) VALUES ('carte_tehnica', 2020)$$, 'check');

-- ═══ T72, T29, T14: PDF, scan, efect, confirmare ═══
SELECT teste.ca(:'NATALIA');
SELECT 'HR/2026/' || :d916 || '/semnat_1700000000001.pdf' AS cale_s, 'HR/2026/' || :d916 || '/generat_1700000000000.pdf' AS cale_g \gset
SELECT teste.urca(:'cale_s');
SELECT teste.eroare('T72 scan fara PDF generat', format($$SELECT public.fn_hr_decizie_ataseaza_scan(%s, %L, %L, '{"nr":true,"persoana":true,"semnatura":true,"stampila":true,"cod":true,"lizibil":true,"sursa":"foto","pagini":1,"pagini_sursa":"detectat","generat":true}')$$,
  :d916, :'cale_s', repeat('b', 64)), 'PDF-ul generat');
SELECT teste.eroare('T29a seteaza_pdf fara obiect', format($$SELECT public.fn_hr_decizie_seteaza_pdf(%s, %L, %L)$$, :d916, :'cale_g', repeat('a', 64)), 'nu exista');
SELECT teste.urca(:'cale_g');
SELECT public.fn_hr_decizie_seteaza_pdf(:d916, :'cale_g', repeat('a', 64)) IS NOT NULL AS ok \gset
SELECT teste.e('T29b seteaza_pdf repetat = ok', (public.fn_hr_decizie_seteaza_pdf(:d916, :'cale_g', repeat('a', 64))->>'ok')::boolean);
SELECT teste.eroare('T29c alta cale', format($$SELECT public.fn_hr_decizie_seteaza_pdf(%s, %L, %L)$$, :d916, 'HR/2026/' || :d916 || '/generat_2.pdf', repeat('a', 64)), NULL);
SELECT teste.eroare('T38 scan fara cod bifat', format($$SELECT public.fn_hr_decizie_ataseaza_scan(%s, %L, %L, '{"nr":true,"persoana":true,"semnatura":true,"stampila":true,"lizibil":true,"sursa":"foto","pagini":1,"pagini_sursa":"detectat","generat":true}')$$,
  :d916, :'cale_s', repeat('b', 64)), 'cod');
SELECT public.fn_hr_decizie_ataseaza_scan(:d916, :'cale_s', repeat('b', 64),
  '{"nr":true,"persoana":true,"semnatura":true,"stampila":true,"cod":true,"lizibil":true,"sursa":"foto","pagini":2,"pagini_sursa":"detectat","generat":true}') AS sc \gset
SELECT teste.e('T14 scan → semnata + propunere cu hr_decizie_id', (SELECT stare FROM hr_decizii WHERE id = :d916) = 'semnata'
  AND EXISTS (SELECT 1 FROM executie_completari_propuse WHERE hr_decizie_id = :d916 AND sursa = 'decizie_numire' AND camp = 'rte_employee_id' AND valoare = '200'));
SELECT teste.e('T38b retry scan = ok, fara eveniment nou', (public.fn_hr_decizie_ataseaza_scan(:d916, :'cale_s', repeat('b', 64), '{}')->>'retry')::boolean
  AND (SELECT count(*) FROM hr_decizii_evenimente WHERE decizie_id = :d916 AND eveniment = 'scan') = 1);
SELECT id AS prop916 FROM executie_completari_propuse WHERE hr_decizie_id = :d916 \gset
SELECT teste.eroare('T28 HR nu confirma efectul', format('SELECT public.fn_completare_aplica(%s, true)', :prop916), 'fără drepturi');
RESET ROLE;
SELECT teste.ca(:'CMC');
SELECT teste.eroare('T46 propunere falsificata (sursa decizie_numire)', $$INSERT INTO executie_completari_propuse (proiect_id, camp, valoare, sursa) VALUES (32,'rte_employee_id','201','decizie_numire')$$, 'row-level security');
INSERT INTO executie_completari_propuse (proiect_id, camp, valoare, sursa) VALUES (32,'nr_contract','52675-X','nas') RETURNING id AS pman \gset
SELECT public.fn_completare_aplica(:pman, true) IS NOT NULL AS ok \gset
SELECT teste.e('T46b propunere manuala merge ca inainte', (SELECT nr_contract FROM executie_proiecte WHERE id = 32) = '52675-X');
SELECT public.fn_completare_aplica(:prop916, true) IS NOT NULL AS ok \gset
SELECT teste.e('T14b confirmare → rte_employee_id = 200', (SELECT rte_employee_id FROM executie_proiecte WHERE id = 32) = 200);
RESET ROLE;
UPDATE executie_proiecte SET nr_contract = '52675' WHERE id = 32;

-- ═══ T26/T27/T42: cititori pe proiect ═══
SELECT teste.ca(:'EXEC');
SELECT teste.e('T26 editor executie: vede numirea pe proiect, nu firma/ALTA/draft', EXISTS (SELECT 1 FROM hr_decizii WHERE id = :d916)
  AND NOT EXISTS (SELECT 1 FROM hr_decizii WHERE nivel = 'firma' OR tip_cod = 'ALTA_DECIZIE' OR stare = 'draft'));
SELECT teste.e('T42h SELECT efectiv din view, fara permission denied', (SELECT count(*) FROM v_hr_decizii_curente) >= 1);
SELECT teste.e('T60 semnatari invizibili pentru exec', (SELECT count(*) FROM hr_decizii_semnatari) = 0);
SELECT teste.e('T26b PDF da, scan nu', public.fn_hr_decizii_storage_poate(:'cale_g', 'select') AND NOT public.fn_hr_decizii_storage_poate(:'cale_s', 'select'));
RESET ROLE;
SELECT teste.ca(:'CMC');
SELECT teste.e('T27 can_manage_contracts cu fisa vede scanul pe proiect', public.fn_hr_decizii_storage_poate(:'cale_s', 'select'));
RESET ROLE;
SELECT teste.ca(:'CLAUDE');
SELECT teste.e('T27b contul Claude (fara fisa) nu vede scanul', NOT public.fn_hr_decizii_storage_poate(:'cale_s', 'select'));
RESET ROLE;

-- ═══ T18/T70/T62: revocare + golire ═══
SELECT teste.ca(:'NATALIA');
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, revoca_id, data_emitere, data_efect, semnatar_id)
VALUES ('REVOCARE','Revocare','firma',:d916, public._hr_azi(), public._hr_azi(), (SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121))
RETURNING id AS drv \gset
SELECT teste.e('T18a trigger: copiat din tinta', (SELECT nivel = 'proiect' AND proiect_id = 32 AND employee_id = 200 AND titlu = 'Dl.' FROM hr_decizii WHERE id = :drv));
SELECT public.fn_hr_decizie_previzualizeaza(:drv) AS prv \gset
SELECT teste.e('T62 revocare pe matricea revocare: R5, fara B2/B6', (:'prv'::jsonb->'avertismente') @> '[{"cod":"R5"}]'
  AND NOT (:'prv'::jsonb->'avertismente') @> '[{"cod":"B6"}]' AND (:'prv'::jsonb->'continut') IS NOT NULL);
SELECT teste.eroare('T55 emitere fara R5 confirmat', format($$SELECT public.fn_hr_decizie_emite(%s, %L, gen_random_uuid(), 12)$$, :drv, :'prv'::jsonb->>'hash_previzualizare'), 'R5');
SELECT public.fn_hr_decizie_emite(:drv, :'prv'::jsonb->>'hash_previzualizare', gen_random_uuid(), 12, NULL, '["R5","INVENTAT"]') AS emr \gset
SELECT teste.e('T55b cod inventat nu apare; Art.1 revocare', (SELECT NOT avertismente @> '[{"cod":"INVENTAT"}]'
  AND continut->'articole'->0->>'text' LIKE 'Incepand cu data de %, se revoca Decizia nr. 930/28.09.2026 privind numirea Dl. Dadulescu Cosmin Grigoras in functia de RTE.'
  FROM hr_decizii WHERE id = :drv));
SELECT 'HR/2026/' || :drv || '/generat_1.pdf' AS rg, 'HR/2026/' || :drv || '/semnat_2.pdf' AS rs \gset
SELECT teste.urca(:'rg'); SELECT teste.urca(:'rs');
SELECT public.fn_hr_decizie_seteaza_pdf(:drv, :'rg', repeat('c', 64)) IS NOT NULL AS ok \gset
SELECT public.fn_hr_decizie_ataseaza_scan(:drv, :'rs', repeat('d', 64),
  '{"nr":true,"persoana":true,"semnatura":true,"stampila":true,"cod":true,"lizibil":true,"sursa":"pdf","pagini":1,"pagini_sursa":"manual","generat":true}') AS scr \gset
SELECT teste.e('T70a tinta revocata + golire propusa', (SELECT stare FROM hr_decizii WHERE id = :d916) = 'revocata'
  AND EXISTS (SELECT 1 FROM executie_completari_propuse WHERE hr_decizie_id = :drv AND sursa = 'decizie_revocare' AND valoare = '' AND status = 'propus'));
SELECT id AS pgol FROM executie_completari_propuse WHERE hr_decizie_id = :drv \gset
RESET ROLE;
SELECT teste.ca(:'RAZVAN');
SELECT public.fn_completare_aplica(:pgol, true) IS NOT NULL AS ok \gset
SELECT teste.e('T70b golire confirmata → camp NULL', (SELECT rte_employee_id FROM executie_proiecte WHERE id = 32) IS NULL
  AND (SELECT status FROM executie_completari_propuse WHERE id = :pgol) = 'confirmat');
RESET ROLE;

-- ═══ T56/T71/T73: hash, cerere globală, NULL ═══
SELECT teste.ca(:'NATALIA');
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, titlu, data_emitere, data_efect, semnatar_id, autorizatie_id)
VALUES ('RSVTI','RSVTI','firma',81,'Dl.', public._hr_azi(), public._hr_azi(), (SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121), 3)
RETURNING id AS drs \gset
UPDATE hr_decizii SET temei = 'Legea {aut_nr} <img src=x onerror=alert(1)>' WHERE id = :drs;
SELECT public.fn_hr_decizie_previzualizeaza(:drs) AS prs \gset
SELECT teste.e('T69 substitutie nerecursiva: {aut_nr} din temei ramane literal', (:'prs'::jsonb->'continut'->'articole'->0->>'text')
  LIKE '%Autorizatiei ISCIR nr. R-77, conform Legea {aut_nr} <img src=x onerror=alert(1)>.');
UPDATE hr_decizii SET temei = 'Legea 64/2008' WHERE id = :drs;
SELECT teste.eroare('T56 hash vechi dupa modificare', format($$SELECT public.fn_hr_decizie_emite(%s, %L, gen_random_uuid(), 12, NULL, '["R5"]')$$, :drs, :'prs'::jsonb->>'hash_previzualizare'), 's-a schimbat');
SELECT teste.eroare('T73d emite cu hash NULL', format($$SELECT public.fn_hr_decizie_emite(%s, NULL, gen_random_uuid(), 12)$$, :drs), 'previzualizeaza');
SELECT teste.eroare('T73e emite cu cerere NULL', format($$SELECT public.fn_hr_decizie_emite(%s, %L, NULL, 12)$$, :drs, repeat('a',64)), 'cerere_id');
SELECT teste.eroare('T56b font 10', format($$SELECT public.fn_hr_decizie_emite(%s, %L, gen_random_uuid(), 10)$$, :drs, repeat('a',64)), '11 sau 12');
SELECT teste.eroare('T71 cerere de emitere de pe alt draft', format($$SELECT public.fn_hr_decizie_emite(%s, %L, %L, 12)$$, :drs, repeat('a',64), :'ce1'), 'alt draft');
RESET ROLE;

-- ═══ T74: semnatar inactiv → B11 ═══
UPDATE hr_decizii_semnatari SET activ = false WHERE employee_id = 121;
SELECT teste.ca(:'NATALIA');
SELECT teste.e('T74 B11 la previzualizare', (public.fn_hr_decizie_previzualizeaza(:drs)->'avertismente') @> '[{"cod":"B11"}]');
RESET ROLE;
UPDATE hr_decizii_semnatari SET activ = true WHERE employee_id = 121;

-- ═══ T35: Tudorache semnatar pe numirea altcuiva → R4 + preambul de împuternicit ═══
SELECT teste.ca(:'MARILENA');
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, titlu, data_emitere, data_efect, semnatar_id)
VALUES ('SEF_SANTIER','Sef Santier','proiect',201,32,'Sonda 16 Mironu','Dl.', public._hr_azi(), public._hr_azi(), (SELECT id FROM hr_decizii_semnatari WHERE employee_id = 125))
RETURNING id AS dtd \gset
SELECT public.fn_hr_decizie_previzualizeaza(:dtd) AS ptd \gset
SELECT teste.e('T35 R4 + preambul „D-na TUDORACHE ..., imputernicita”, fara segmentul de imputernicire',
  (:'ptd'::jsonb->'avertismente') @> '[{"cod":"R4"}]'
  AND (:'ptd'::jsonb->'continut'->>'preambul') LIKE '%prin D-na TUDORACHE MARILENA CLAUDIA, imputernicita, in calitate de angajator;'
  AND (:'ptd'::jsonb->'continut'->>'bloc_semnatura') = 'Pentru Administrator' || ',' || chr(10) || 'Tudorache Marilena');
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, titlu, data_emitere, data_efect, semnatar_id)
VALUES ('SEF_SANTIER','Sef Santier','proiect',125,32,'Sonda 16 Mironu','D-na', public._hr_azi(), public._hr_azi(), (SELECT id FROM hr_decizii_semnatari WHERE employee_id = 125))
RETURNING id AS dtd2 \gset
SELECT teste.e('T35b Tudorache pe propria numire → B1, continut NULL', (public.fn_hr_decizie_previzualizeaza(:dtd2)->'avertismente') @> '[{"cod":"B1"}]'
  AND public.fn_hr_decizie_previzualizeaza(:dtd2)->'continut' = 'null'::jsonb);
RESET ROLE;
SELECT teste.e('T32 variante de gen pe PSI firma (pe doamna/pe domnul)', public._hr_sablon((SELECT art1_firma FROM hr_decizii_tipuri WHERE cod = 'PSI'),
  '{"functie":"Responsabil PSI","pe_titlu":"pe doamna","nume":"Ionescu Maria","data_efect":"01.10.2026"}')
  = 'Numirea in functia de Responsabil PSI pe doamna Ionescu Maria incepand cu data de 01.10.2026, conform art. 12 din Legea 307/2006 si art. 13 din Legea 481/2004.');
SELECT teste.eroare('T66 variabila obligatorie lipsa → eroare, nu text', $$SELECT public._hr_sablon('a {lipsa} b', '{}')$$, 'fara valoare');


-- ═══ T17/T66/T48: înlocuire completă pe un RTE importat (fără titlu) + extern la scan ═══
SELECT teste.ca(:'NATALIA');
SELECT (public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2026,'numar',940,
  'tip_cod','RTE','eticheta_functie','RTE','nivel','proiect','proiect_id',32,'employee_id',201,'data_emitere', public._hr_azi(),'propune_efect',false))->>'id')::bigint AS imp \gset
SELECT 'HR/2026/' || :imp || '/semnat_5.pdf' AS ims \gset
SELECT teste.urca(:'ims');
SELECT public.fn_hr_decizie_ataseaza_scan(:imp, :'ims', repeat('e', 64),
  '{"nr":true,"persoana":true,"semnatar":true,"semnatura":true,"stampila":false,"observatie":"originalul nu are stampila","lizibil":true,"sursa":"pdf","pagini":1,"pagini_sursa":"detectat","generat":false}') IS NOT NULL AS ok \gset
SELECT teste.e('T38c import cu stampila=false + observatie → semnata', (SELECT stare FROM hr_decizii WHERE id = :imp) = 'semnata');
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, autorizatie_id, domenii_isc, titlu,
                        data_emitere, data_efect, semnatar_id, inlocuieste_id)
VALUES ('RTE','RTE','proiect',200,32,'Sonda 16 Mironu',1,ARRAY['1.1'],'Dl.', public._hr_azi(), public._hr_azi(),
        (SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121), :imp)
RETURNING id AS inl \gset
SELECT public.fn_hr_decizie_previzualizeaza(:inl) AS pin \gset
SELECT teste.e('T66c inlocuire: R5 pe articolul de inlocuire + articol fara titlu tinta', (:'pin'::jsonb->'avertismente') @> '[{"cod":"R5"}]'
  AND (:'pin'::jsonb->'continut'->'articole'->1->>'text') LIKE 'Prezenta decizie inlocuieste Decizia nr. 940/% privind numirea Popescu Ion in functia de RTE, care isi inceteaza efectele incepand cu data de %.');
SELECT public.fn_hr_decizie_emite(:inl, :'pin'::jsonb->>'hash_previzualizare', gen_random_uuid(), 12, NULL, '["R5"]') IS NOT NULL AS ok \gset
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, autorizatie_id, domenii_isc, titlu,
                        data_emitere, data_efect, semnatar_id, inlocuieste_id)
VALUES ('RTE','RTE','proiect',200,32,'Sonda 16 Mironu',1,ARRAY['1.1'],'Dl.', public._hr_azi(), public._hr_azi(),
        (SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121), :imp)
RETURNING id AS inl2 \gset
SELECT teste.e('T17b a doua inlocuire pe aceeasi tinta → B9', (public.fn_hr_decizie_previzualizeaza(:inl2)->'avertismente') @> '[{"cod":"B9"}]');
SELECT 'HR/2026/' || :inl || '/generat_7.pdf' AS ig, 'HR/2026/' || :inl || '/semnat_8.pdf' AS is2 \gset
SELECT teste.urca(:'ig'); SELECT teste.urca(:'is2');
SELECT public.fn_hr_decizie_seteaza_pdf(:inl, :'ig', repeat('f', 64)) IS NOT NULL AS ok \gset
SELECT public.fn_hr_decizie_ataseaza_scan(:inl, :'is2', repeat('0', 64),
  '{"nr":true,"persoana":true,"semnatura":true,"stampila":true,"cod":true,"lizibil":true,"sursa":"foto","pagini":1,"pagini_sursa":"detectat","generat":true}') IS NOT NULL AS ok \gset
SELECT teste.e('T17 inlocuire semnata → tinta inlocuita, propunere noua', (SELECT stare FROM hr_decizii WHERE id = :imp) = 'inlocuita'
  AND EXISTS (SELECT 1 FROM executie_completari_propuse WHERE hr_decizie_id = :inl AND sursa = 'decizie_numire' AND status = 'propus'));
RESET ROLE;
SELECT teste.ca(:'RAZVAN');
SELECT 'HR/2026/' || :inl || '/semnat_9.pdf' AS is3, (SELECT scan_path FROM hr_decizii WHERE id = :inl) AS sv, (SELECT scan_sha256 FROM hr_decizii WHERE id = :inl) AS shv \gset
SELECT teste.urca(:'is3');
SELECT gen_random_uuid() AS cis \gset
SELECT teste.eroare('T65a inlocuieste_scan cu un generat_*', format($$SELECT public.fn_hr_decizie_inlocuieste_scan(%s, %L, %L, %L, %L, %L, 'x', '{}')$$,
  :inl, gen_random_uuid(), :'sv', :'shv', :'ig', repeat('1',64)), 'cale invalida');
SELECT public.fn_hr_decizie_inlocuieste_scan(:inl, :'cis', :'sv', :'shv', :'is3', repeat('2', 64), 'pagina lipsa',
  '{"nr":true,"persoana":true,"semnatura":true,"stampila":true,"cod":true,"lizibil":true,"sursa":"pdf","pagini":1,"pagini_sursa":"detectat","generat":true}') IS NOT NULL AS ok \gset
SELECT teste.e('T65b retry identic = ok, fara eveniment nou', (public.fn_hr_decizie_inlocuieste_scan(:inl, :'cis', :'sv', :'shv', :'is3', repeat('2', 64), 'pagina lipsa',
  '{"nr":true,"persoana":true,"semnatura":true,"stampila":true,"cod":true,"lizibil":true,"sursa":"pdf","pagini":1,"pagini_sursa":"detectat","generat":true}')->>'retry')::boolean);
SELECT teste.e('T65c un singur scan_inlocuit, scanul curent nou, propunerea pe noua dovada',
  (SELECT count(*) FROM hr_decizii_evenimente WHERE decizie_id = :inl AND eveniment = 'scan_inlocuit') = 1
  AND (SELECT scan_path FROM hr_decizii WHERE id = :inl) = :'is3'
  AND (SELECT dovada_path FROM executie_completari_propuse WHERE hr_decizie_id = :inl) = :'is3');
SELECT teste.eroare('T65d baseline vechi', format($$SELECT public.fn_hr_decizie_inlocuieste_scan(%s, %L, %L, %L, %L, %L, 'x', '{}')$$,
  :inl, gen_random_uuid(), :'sv', :'shv', :'is2', repeat('3',64)), 's-a schimbat');
RESET ROLE;


-- ═══ Regresii runda 5 (Jakarinos J5-*, Copilot P5-*) ═══
SELECT teste.ca(:'NATALIA');
SELECT teste.eroare('J5-1a rezerva cu confirmari [null]', $$SELECT public.fn_hr_decizie_rezerva(jsonb_build_object('cerere_id', gen_random_uuid(),
  'tip_cod','MP','eticheta_functie','Manager Proiect','nivel','proiect','proiect_id',32,'employee_id',203,'titlu','D-na','data_emitere', public._hr_azi(),
  'semnatar_id',(SELECT id FROM hr_decizii_semnatari WHERE employee_id = 125),'confirmari','[null]'::jsonb))$$, 'confirmari');
SELECT teste.eroare('J5-1b emite cu ["INVENTAT",null]', format($$SELECT public.fn_hr_decizie_emite(%s, %L, gen_random_uuid(), 12, NULL, '["INVENTAT",null]')$$, :drs, repeat('a',64)), 'confirmari');
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, titlu, data_emitere, data_efect, semnatar_id)
VALUES ('SEF_SANTIER','Sef Santier','proiect',201,32,'Sonda 16 Mironu','Dl.', public._hr_azi(), public._hr_azi(), (SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121))
RETURNING id AS j52 \gset
SELECT teste.e('J5-2a tip fara atestat: fara R1/R2/G9', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.fn_hr_decizie_previzualizeaza(:j52)->'avertismente') a
  WHERE a->>'cod' IN ('R1','R2','R3','G9')));
INSERT INTO hr_decizii (tip_cod, eticheta_functie, nivel, employee_id, proiect_id, proiect_denumire, domenii_isc, titlu, data_emitere, data_efect, semnatar_id)
VALUES ('RTE','RTE','proiect',201,32,'Sonda 16 Mironu',ARRAY['8.4D'],'Dl.', public._hr_azi(), public._hr_azi(), (SELECT id FROM hr_decizii_semnatari WHERE employee_id = 121))
RETURNING id AS j52b \gset
SELECT public.fn_hr_decizie_previzualizeaza(:j52b) AS pj \gset
SELECT teste.e('J5-2b/T66 RTE fara atestat: R1, fara R2/R3; text fara segmentul de autorizatie', (:'pj'::jsonb->'avertismente') @> '[{"cod":"R1"}]'
  AND NOT (:'pj'::jsonb->'avertismente') @> '[{"cod":"R2"}]' AND NOT (:'pj'::jsonb->'avertismente') @> '[{"cod":"R3"}]'
  AND (:'pj'::jsonb->'continut'->'articole'->0->>'text') LIKE '%RTE pentru domeniul 8.4 (D) – Retele de gaze naturale combustibile in cadrul proiectului%'
  AND (:'pj'::jsonb->'continut'->'articole'->0->>'text') NOT LIKE '%Autorizatiei%');
SELECT teste.e('J5-2c/T66 emitere cu R1 confirmat', (public.fn_hr_decizie_emite(:j52b, :'pj'::jsonb->>'hash_previzualizare', gen_random_uuid(), 12, NULL, '["R1"]')->>'numar') IS NOT NULL);
SELECT (public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2026,'numar',778,'tip_cod','RTE','eticheta_functie','RTE',
  'nivel','proiect','proiect_id',32,'employee_id',201,'titlu','Dl.','data_emitere', public._hr_azi(),'data_efect', public._hr_azi() - 10,
  'data_efect_pana', public._hr_azi() - 1,'domenii_isc','["8.4 (D)"]'::jsonb,'propune_efect',true))->>'id')::bigint AS j53 \gset
SELECT teste.e('J5-3/P5-1 import persista termenul si domeniile normalizate', (SELECT data_efect_pana = public._hr_azi() - 1 AND domenii_isc = ARRAY['8.4D'] FROM hr_decizii WHERE id = :j53));
RESET ROLE;
SELECT teste.e('J5-3b import expirat: nu e eligibil (nu e semnat inca, dar termenul e persistat)', public._hr_decizie_motiv_neeligibil(:j53) IS NOT NULL);
-- 70(d): importul expirat, semnat → fără propunere, eveniment propunere_omisa „decizie expirata”
SELECT teste.ca(:'NATALIA');
SELECT 'HR/2026/' || :j53 || '/semnat_1.pdf' AS j53s \gset
SELECT teste.urca(:'j53s');
SELECT public.fn_hr_decizie_ataseaza_scan(:j53, :'j53s', repeat('5', 64),
  '{"nr":true,"persoana":true,"semnatar":true,"semnatura":true,"stampila":true,"lizibil":true,"sursa":"pdf","pagini":1,"pagini_sursa":"detectat","generat":false}') IS NOT NULL AS ok \gset
RESET ROLE;
SELECT teste.e('70d import expirat semnat: fara propunere, propunere_omisa „decizie expirata”', NOT EXISTS (SELECT 1 FROM executie_completari_propuse WHERE hr_decizie_id = :j53)
  AND EXISTS (SELECT 1 FROM hr_decizii_evenimente WHERE decizie_id = :j53 AND eveniment = 'propunere_omisa' AND detalii->>'motiv' = 'decizie expirata'));
SELECT teste.e('J5-7 G7 nu numara un RTE expirat pe alt domeniu', NOT coalesce((public._hr_decizie_context(jsonb_build_object('decizie',
  jsonb_build_object('tip_cod','RTE','nivel','proiect','proiect_id',32,'propune_efect',false,'domenii_isc','["9.1"]'::jsonb),
  'tip', jsonb_build_object('necesita_domeniu_isc', true)))->>'g7')::boolean, false)
  OR EXISTS (SELECT 1 FROM hr_decizii c WHERE c.tip_cod = 'RTE' AND c.proiect_id = 32 AND c.stare IN ('emisa','semnata')
               AND (c.data_efect_pana IS NULL OR c.data_efect_pana >= public._hr_azi()) AND NOT (coalesce(c.domenii_isc,'{}') && ARRAY['9.1'])));
-- J5-4: renumire cu efect viitor a persoanei deja în echipă → are propunere
UPDATE executie_proiecte SET rts_employee_id = 201 WHERE id = 32;
SELECT teste.ca(:'NATALIA');
SELECT (public.fn_hr_decizie_importa(jsonb_build_object('cerere_id', gen_random_uuid(), 'an',2026,'numar',779,'tip_cod','RTS','eticheta_functie','Responsabil Tehnic cu Sudura',
  'nivel','proiect','proiect_id',32,'employee_id',201,'titlu','Dl.','data_emitere', public._hr_azi(),'data_efect', public._hr_azi() + 1,'propune_efect',true))->>'id')::bigint AS j54 \gset
SELECT 'HR/2026/' || :j54 || '/semnat_1.pdf' AS j54s \gset
SELECT teste.urca(:'j54s');
SELECT public.fn_hr_decizie_ataseaza_scan(:j54, :'j54s', repeat('4', 64),
  '{"nr":true,"persoana":true,"semnatar":true,"semnatura":true,"stampila":true,"lizibil":true,"sursa":"pdf","pagini":1,"pagini_sursa":"detectat","generat":false}') IS NOT NULL AS ok \gset
SELECT teste.e('J5-4 renumire viitoare a persoanei deja in echipa → propunere (confirmabila de la data efectului)',
  EXISTS (SELECT 1 FROM executie_completari_propuse WHERE hr_decizie_id = :j54 AND status = 'propus'));
RESET ROLE;
SELECT teste.ca(:'RAZVAN');
SELECT id AS pj54 FROM executie_completari_propuse WHERE hr_decizie_id = :j54 \gset
SELECT teste.eroare('J5-4b confirmarea inainte de data efectului', format('SELECT public.fn_completare_aplica(%s, true)', :pj54), 'efect de la');
RESET ROLE;
-- fn_completare_aplica pe propuneri manuale: fiecare cast, câmp nepermis, respingere, eroare de cast (Jakarinos: regresie gate 0e)
SELECT teste.ca(:'CMC');
INSERT INTO executie_completari_propuse (proiect_id, camp, valoare, sursa) VALUES
  (34,'data_start','2026-11-01','nas'), (34,'valoare_lei','1234.50','nas'), (34,'mp_employee_id','203','nas'), (34,'beneficiar_final','Romgaz','mail'),
  (34,'nume','X','nas'), (34,'mp_employee_id','abc','nas'), (34,'rts_employee_id','201','nas');
SELECT public.fn_completare_aplica(id, true) FROM executie_completari_propuse WHERE proiect_id = 34 AND camp IN ('data_start','valoare_lei','mp_employee_id','beneficiar_final') AND valoare <> 'abc' AND status = 'propus';
SELECT teste.e('G0e casturi date/numeric/int/text aplicate', (SELECT data_start = '2026-11-01' AND valoare_lei = 1234.50 AND mp_employee_id = 203 AND beneficiar_final = 'Romgaz' FROM executie_proiecte WHERE id = 34));
SELECT teste.eroare('G0e camp nepermis', format('SELECT public.fn_completare_aplica(%s, true)', (SELECT id FROM executie_completari_propuse WHERE camp = 'nume')), 'câmp nepermis');
SELECT teste.eroare('G0e cast invalid', format('SELECT public.fn_completare_aplica(%s, true)', (SELECT id FROM executie_completari_propuse WHERE valoare = 'abc')), 'invalid input');
SELECT public.fn_completare_aplica((SELECT id FROM executie_completari_propuse WHERE proiect_id = 34 AND camp = 'rts_employee_id'), false) IS NOT NULL AS ok \gset
SELECT teste.e('G0e respingere: camp neschimbat, status respins', (SELECT rts_employee_id IS NULL FROM executie_proiecte WHERE id = 34)
  AND (SELECT status FROM executie_completari_propuse WHERE proiect_id = 34 AND camp = 'rts_employee_id') = 'respins');
RESET ROLE;
SELECT teste.e('J5-6 view-ul nu e acordat lui service_role', NOT has_table_privilege('service_role', 'public.v_hr_decizii_curente', 'SELECT'));
SELECT teste.e('P5-3 fn_completare_aplica: owner postgres, definer, ACL neschimbat', (SELECT pg_get_userbyid(proowner) = 'postgres' AND prosecdef
  AND NOT has_function_privilege('anon', oid, 'EXECUTE') FROM pg_proc WHERE proname = 'fn_completare_aplica'));

-- ═══ gate 0e e verificat de harness; T61 grep: randarea/avertismentele nu citesc tabele ═══
SELECT teste.e('T61 _hr_decizie_randeaza / _avertismente / _acopera fara FROM pe tabele', NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN
  ('_hr_decizie_randeaza','_hr_decizie_avertismente','_hr_acopera_domeniu') AND prosrc ~* 'from[[:space:]]+public[.](hr_|executie|employees|profiles)'));
\echo 'TESTE SQL: TOATE OK'
