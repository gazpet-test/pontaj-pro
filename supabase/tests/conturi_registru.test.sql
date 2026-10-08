-- Teste SQL pentru 20261021a (conturi_registru v1). Rulează DOAR prin scripts/test_conturi_registru.sh, pe baza locală
-- *_test, după schelet + migrare (aplicată prin runner).
\set ON_ERROR_STOP on
SET client_min_messages = notice;
\set RAZVAN '00000000-0000-0000-0000-000000000121'
\set MARILENA '00000000-0000-0000-0000-000000000125'
\set NATALIA '00000000-0000-0000-0000-000000000126'
\set FARA '00000000-0000-0000-0000-0000000000f0'

-- ═══ T1 catalog ═══
SELECT teste.e('T1a RLS activ', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conturi_registru'::regclass));
SELECT teste.e('T1b anon: niciun drept pe tabel sau secvență', NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(n)
  WHERE has_table_privilege('anon', 'public.conturi_registru', p.n))
  AND NOT has_sequence_privilege('anon', 'public.conturi_registru_id_seq', 'USAGE')
  AND NOT has_sequence_privilege('anon', 'public.conturi_registru_id_seq', 'SELECT')
  AND NOT has_sequence_privilege('anon', 'public.conturi_registru_id_seq', 'UPDATE'));
SELECT teste.e('T1c authenticated: exact SELECT/INSERT/UPDATE (fără DELETE), nimic pe secvență',
  has_table_privilege('authenticated', 'public.conturi_registru', 'SELECT') AND has_table_privilege('authenticated', 'public.conturi_registru', 'INSERT')
  AND has_table_privilege('authenticated', 'public.conturi_registru', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.conturi_registru', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.conturi_registru', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.conturi_registru', 'REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.conturi_registru', 'TRIGGER')
  AND NOT has_sequence_privilege('authenticated', 'public.conturi_registru_id_seq', 'USAGE')
  AND NOT has_sequence_privilege('authenticated', 'public.conturi_registru_id_seq', 'SELECT')
  AND NOT has_sequence_privilege('authenticated', 'public.conturi_registru_id_seq', 'UPDATE'));
SELECT teste.e('T1d 3 politici (SELECT/INSERT/UPDATE, fără DELETE), toate pe authenticated și cu is_owner',
  (SELECT array_agg(cmd ORDER BY cmd) FROM pg_policies WHERE tablename = 'conturi_registru') = ARRAY['INSERT','SELECT','UPDATE']::text[]
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conturi_registru'
                   AND (roles <> '{authenticated}' OR coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%is_owner%')));
SELECT teste.e('T1f id e IDENTITY ALWAYS', (SELECT attidentity FROM pg_attribute WHERE attrelid = 'public.conturi_registru'::regclass AND attname = 'id') = 'a');
SELECT teste.e('T1g COMMENT-ul are amprenta', obj_description('public.conturi_registru'::regclass, 'pg_class') ~ 'amprenta=[0-9a-f]{32}$');
SELECT teste.e('T1e nicio coloană de parolă', NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.conturi_registru'::regclass
  AND attnum > 0 AND NOT attisdropped AND (attname ILIKE '%parol%' OR attname ILIKE '%pass%' OR attname ILIKE '%secret%')));

-- ═══ T2 owner: adaugă, vede, editează, dezactivează ═══
SELECT teste.ca(:'RAZVAN');
INSERT INTO public.conturi_registru (categorie, serviciu, url, utilizator, titular, cod_client, personal, locatie_ids, observatii)
VALUES ('utilitati', 'MyElectrica', 'https://myelectrica.ro', 'test@example.com', 'Titular Test', '9000000001', true, '{1}', 'test'),
       ('firma', 'licitatie-publica.ro', NULL, 'office@example.com', NULL, NULL, false, NULL, NULL);
SELECT teste.e('T2a owner vede rândurile lui', (SELECT count(*) FROM public.conturi_registru) = 2);
SELECT teste.e('T2b created_by = auth.uid()', (SELECT bool_and(created_by = :'RAZVAN'::uuid) FROM public.conturi_registru));
SELECT teste.e('T2c owner editează', teste.n($$UPDATE public.conturi_registru SET observatii = 'modificat' WHERE serviciu = 'MyElectrica'$$) = 1);
SELECT teste.e('T2d ștergere = activ=false (1 rând)', teste.n($$UPDATE public.conturi_registru SET activ = false WHERE serviciu = 'licitatie-publica.ro'$$) = 1);
SELECT teste.e('T2e rândul dezactivat rămâne vizibil, cu activ=false', (SELECT NOT activ FROM public.conturi_registru WHERE serviciu = 'licitatie-publica.ro'));
SELECT teste.eroare('T2f owner: DELETE real refuzat (ștergere = dezactivare, impus în BD)', $$DELETE FROM public.conturi_registru WHERE serviciu = 'licitatie-publica.ro'$$, 'permission denied');
SELECT teste.eroare('T2g owner: id explicit refuzat (IDENTITY ALWAYS)', $$INSERT INTO public.conturi_registru (id, categorie, serviciu) VALUES (999, 'altele', 'x')$$, 'non-DEFAULT');
RESET ROLE;

-- ═══ T3 al doilea owner (is_owner = true) vede registrul — comportamentul din spec („doar owner”) ═══
SELECT teste.ca(:'MARILENA');
SELECT teste.e('T3 al doilea owner vede toate rândurile', (SELECT count(*) FROM public.conturi_registru) = 2);
RESET ROLE;

-- ═══ T4 utilizator logat, non-owner: nu vede, nu scrie, nu modifică, nu șterge ═══
SELECT teste.ca(:'NATALIA');
SELECT teste.e('T4a non-owner: SELECT = 0 rânduri', (SELECT count(*) FROM public.conturi_registru) = 0);
SELECT teste.eroare('T4b non-owner: INSERT refuzat de RLS',
  $$INSERT INTO public.conturi_registru (categorie, serviciu) VALUES ('altele', 'furt')$$, 'row-level security');
SELECT teste.e('T4c non-owner: UPDATE atinge 0 rânduri', teste.n($$UPDATE public.conturi_registru SET observatii = 'x'$$) = 0);
SELECT teste.eroare('T4d non-owner: DELETE refuzat', $$DELETE FROM public.conturi_registru$$, 'permission denied');
SELECT teste.eroare('T4e2 non-owner: nextval pe secvență refuzat', $$SELECT nextval('public.conturi_registru_id_seq')$$, 'permission denied');
SELECT teste.eroare('T4e3 non-owner: last_value pe secvență refuzat', $$SELECT last_value FROM public.conturi_registru_id_seq$$, 'permission denied');
RESET ROLE;
SELECT teste.e('T4e după non-owner: datele neatinse', (SELECT count(*) FROM public.conturi_registru) = 2
  AND (SELECT observatii FROM public.conturi_registru WHERE serviciu = 'MyElectrica') = 'modificat');

-- ═══ T5 JWT valid fără rând în profiles (ex. cheia anon nu are sub; un cont fără profil) ═══
SELECT teste.ca(:'FARA');
SELECT teste.e('T5a fără profil: SELECT = 0', (SELECT count(*) FROM public.conturi_registru) = 0);
SELECT teste.eroare('T5b fără profil: INSERT refuzat', $$INSERT INTO public.conturi_registru (categorie, serviciu) VALUES ('altele', 'x')$$, 'row-level security');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SET ROLE authenticated;
SELECT teste.e('T5c authenticated fără sub: SELECT = 0', (SELECT count(*) FROM public.conturi_registru) = 0);
RESET ROLE;

-- ═══ T6 anon: permission denied ═══
SET ROLE anon;
SELECT teste.eroare('T6a anon SELECT', $$SELECT count(*) FROM public.conturi_registru$$, 'permission denied');
SELECT teste.eroare('T6b anon INSERT', $$INSERT INTO public.conturi_registru (categorie, serviciu) VALUES ('altele', 'x')$$, 'permission denied');
RESET ROLE;

-- ═══ T7 CHECK-uri (ca owner, ca să treacă de RLS și să lovească CHECK-ul) ═══
SELECT teste.ca(:'RAZVAN');
SELECT teste.eroare('T7a url javascript: refuzat', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'javascript:alert(1)')$$, 'check');
SELECT teste.eroare('T7b url data: refuzat', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'data:text/html,x')$$, 'check');
SELECT teste.eroare('T7c url cu spațiu refuzat', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'https://a b')$$, 'check');
SELECT teste.eroare('T7d categorie necunoscută', $$INSERT INTO public.conturi_registru (categorie, serviciu) VALUES ('banci', 'x')$$, 'check');
SELECT teste.eroare('T7e serviciu gol', $$INSERT INTO public.conturi_registru (categorie, serviciu) VALUES ('altele', '   ')$$, 'check');
SELECT teste.eroare('T7f locatie_ids cu NULL', $$INSERT INTO public.conturi_registru (categorie, serviciu, locatie_ids) VALUES ('altele', 'x', ARRAY[1, NULL]::bigint[])$$, 'check');
SELECT teste.eroare('T7g locatie_ids > 20', $$INSERT INTO public.conturi_registru (categorie, serviciu, locatie_ids) VALUES ('altele', 'x', (SELECT array_agg(g)::bigint[] FROM generate_series(1, 21) g))$$, 'check');
SELECT teste.eroare('T7e2 serviciu doar tab/newline', $$INSERT INTO public.conturi_registru (categorie, serviciu) VALUES ('altele', E'\t\n')$$, 'check');
SELECT teste.eroare('T7e3 serviciu doar NBSP', $$INSERT INTO public.conturi_registru (categorie, serviciu) VALUES ('altele', E'\u00a0')$$, 'check');
SELECT teste.eroare('T7j url cu utilizator:parolă', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'https://admin:Parola1@192.168.1.1/')$$, 'check');
SELECT teste.eroare('T7k url cu utilizator@', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'HTTPS://admin@router.local')$$, 'check');
SELECT teste.eroare('T7m url cu slash-uri în plus și credențiale (J16-2)', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'https:////admin:abc123@example.com/')$$, 'check');
SELECT teste.eroare('T7n url cu backslash', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', E'https://x.ro\\@evil.ro/')$$, 'check');
SELECT teste.eroare('T7o url fără gazdă', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'https:///cale')$$, 'check');
SELECT teste.eroare('T7p observații cu parolă', $$INSERT INTO public.conturi_registru (categorie, serviciu, observatii) VALUES ('altele', 'x', 'parola contului: Abc123')$$, 'conturi_registru_fara_parole');
SELECT teste.eroare('T7q url cu ?password=', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'https://portal.ro/?password=Secret123')$$, 'conturi_registru_fara_parole');
SELECT teste.eroare('T7r utilizator cu PIN-ul:', $$INSERT INTO public.conturi_registru (categorie, serviciu, utilizator) VALUES ('altele', 'x', 'PIN-ul: 1234')$$, 'conturi_registru_fara_parole');
SELECT teste.e('T7s observații obișnuite acceptate (fără parolă aici, consum: …, = sediu)', teste.n($$INSERT INTO public.conturi_registru (categorie, serviciu, observatii, utilizator)
  VALUES ('altele', 'ok3', 'Locație: X. SSID „test”; fără parolă aici. Locuri de consum: str. Y; cod 700 = sediu. Passport: 1. opinie: bună', '+40700000000')$$) = 1);
SELECT teste.eroare('T7t url cu gazdă goală și „:” (J17-3)', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'https://:')$$, 'check');
SELECT teste.eroare('T7u url cu port nenumeric (J17-3)', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'https://x.ro:abc')$$, 'check');
SELECT teste.eroare('T7v url cu gazdă care începe cu punct', $$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'x', 'https://.x.ro/')$$, 'check');
SELECT teste.e('T7w per câmp, nu concatenat (J17-2): „Proton Pass” + „Contact: IT” acceptat', teste.n($$INSERT INTO public.conturi_registru (categorie, serviciu, observatii, url)
  VALUES ('aplicatii', 'Proton Pass', 'Contact: IT', 'https://x.ro:8443/a#b')$$) = 1);
SELECT teste.e('T7l url cu @ în query acceptat', teste.n($$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'ok2', 'https://x.ro/p?e=a@b.ro')$$) = 1);
SELECT teste.eroare('T7h serviciu > 200', $$INSERT INTO public.conturi_registru (categorie, serviciu) VALUES ('altele', repeat('a', 201))$$, 'check');
SELECT teste.e('T7i url HTTPS cu majuscule acceptat', teste.n($$INSERT INTO public.conturi_registru (categorie, serviciu, url) VALUES ('altele', 'ok', 'HTTPS://Exemplu.ro/x?a=1')$$) = 1);
RESET ROLE;

-- ═══ T8 updated_at se mișcă la UPDATE ═══
UPDATE public.conturi_registru SET updated_at = now() - interval '1 day' WHERE serviciu = 'MyElectrica';
SELECT teste.ca(:'RAZVAN');
UPDATE public.conturi_registru SET observatii = 'din nou' WHERE serviciu = 'MyElectrica';
RESET ROLE;
SELECT teste.e('T8 updated_at actualizat de trigger', (SELECT updated_at > now() - interval '1 minute' FROM public.conturi_registru WHERE serviciu = 'MyElectrica'));

-- ═══ T9 service_role (edge) vede tot — BYPASSRLS, ca pe live ═══
SET ROLE service_role;
SELECT teste.e('T9 service_role vede toate rândurile', (SELECT count(*) FROM public.conturi_registru) = 6);
RESET ROLE;

DO $f$ BEGIN RAISE NOTICE 'TESTE SQL: TOATE OK'; END $f$;
