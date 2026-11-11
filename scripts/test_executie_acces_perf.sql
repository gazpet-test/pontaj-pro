-- Harness 20261213a_executie_acces_proiect_perf — inclus de scripts/test_executie_acces_proiect.sql DUPĂ T2 (20261209a aplicată, B restrâns pe
-- p1 editor + p2 viewer, C restrâns pe p1 editor), în aceeași tranzacție ANULATĂ. Fără el (psql -v fara_20261213a=1) harness-ul e cel din r13.
-- Oracolul (L25): ce vede și ce poate scrie FIECARE tip de cont ÎNAINTE de 20261213a, măsurat prin RLS-ul de atunci (politicile 20261209a):
--   rând cu rând (t13_randuri: ctid-urile vizibile pe fiecare tabel acoperit / 'drept' + id-urile obiectelor pe fiecare bucket din inventar) +
--   amprenta completă r13 (t_amprenta: citire pe p1 / p2 / p3 / fără proiect, scriere REST / DEFINER, INSERT-uri, obiecte, încărcări, Inbox) +
--   folderul propriu al Inboxului; conturile: owner, A (editor nerestrâns), A0 (A fără modul), B, B0 (B fără modul), C (modul viewer).
--   După 20261213a: IDENTIC, pentru fiecare cont. Apoi toate testele r13 (T3–T6, cu anti-oracolul T3e) rulează peste politicile noi.
-- T9a  refuzuri la aplicare: o politică 20261209a schimbată = refuz; (după aplicare) a doua aplicare = refuz.
-- T9b  echivalența (de mai sus).
-- T9c  proba de PLAN, ca B (scripts/executie_acces_masurare_corp.sql, EXPLAIN ANALYZE): ÎNAINTE, predicatul de acces apare în filtre pe
--      FIECARE tabel acoperit și bucket (proba nu e oarbă); DUPĂ, pe niciunul; fiecare InitPlan cu o funcție de acces executat ≤ 1 dată;
--      nicio subinterogare corelată în plus; aceleași rânduri. A (nerestrâns): aceleași rânduri, fără erori.
-- T9d  lista proprie (fn_executie_acces_proprii_citire / _scriere): pentru fiecare cont = rândurile PROPRII din executie_acces_proiect citite
--      de el prin SELECT (deci nu spune nimic nou) + specificația (B = {p1, p2} / {p1}, C = {p1} / {p1}, nerestrânși = {}); anon = 42501;
--      generatorul și verificarea politicilor = 42501 pentru clienți.
-- T9r  revenirea: revenirea 20261209a REFUZĂ cât timp 20261213a e aplicată; nearmată = refuz; armată = politicile 20261209a la loc (aceeași
--      amprentă), echivalența din nou, planul vechi din nou; re-aplicarea = din nou politicile noi și echivalența.
SELECT pg_temp.t_ca(NULL, 'postgres');
-- ce rânduri vede apelantul curent: pe fiecare tabel acoperit / 'drept' din t_tab, numărul și md5-ul ctid-urilor (ordonate); pe fiecare
-- bucket din inventar, numărul și md5-ul id-urilor obiectelor
CREATE FUNCTION pg_temp.t13_randuri() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE r record; v jsonb := '{}'::jsonb; x text; b text;
BEGIN
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox', 'drept') ORDER BY nume LOOP
    IF NOT has_table_privilege(r.rel, 'SELECT') THEN v := v || jsonb_build_object(r.nume, 'fara drept'); CONTINUE; END IF;
    BEGIN
      EXECUTE format('SELECT count(*) || %L || md5(coalesce(string_agg(t.ctid::text, %L ORDER BY t.ctid), %L)) FROM %s t', ':', ',', '', r.rel::regclass) INTO x;
    EXCEPTION WHEN OTHERS THEN x := pg_temp.t_norm(SQLSTATE || ' ' || SQLERRM);
    END;
    v := v || jsonb_build_object(r.nume, x);
  END LOOP;
  FOR b IN SELECT obiect FROM t_inv WHERE tip = 'bucket' ORDER BY obiect LOOP
    SELECT count(*) || ':' || md5(coalesce(string_agg(s.id::text, ',' ORDER BY s.id), '')) INTO x FROM storage.objects s WHERE s.bucket_id = b;
    v := v || jsonb_build_object('storage:' || b, x);
  END LOOP;
  RETURN v;
END $h$;
-- obiecte-LIMITĂ pe fiecare formă de cale a predicatului Storage (ca postgres), pe lângă obiectele de probă din T0c: proiect de citire
-- (p2 viewer), formele cu prefix (pccvi / ordin-incepere / probe-presiune), forma „aprobare” cu perechea corectă și cu perechea GREȘITĂ
-- (pachetul lui p1 sub proiectul p3 și invers), `..`, zero în față, formă necunoscută, document fără rând; plus căile de ÎNCĂRCARE (t13_up)
CREATE TEMP TABLE t13_obj (bucket text, nume text, spec_b boolean, PRIMARY KEY (bucket, nume));
CREATE TEMP TABLE t13_up (bucket text, nume text, PRIMARY KEY (bucket, nume));
DO $t$
DECLARE p1 text := pg_temp.t_g('p1'); p2 text := pg_temp.t_g('p2'); p3 text := pg_temp.t_g('p3'); k1 text; k2 text; k3 text; r record; x text;
BEGIN
  SELECT min(id)::text INTO k1 FROM public.executie_pachete_lansare WHERE proiect_id = p1::bigint;
  SELECT min(id)::text INTO k2 FROM public.executie_pachete_lansare WHERE proiect_id = p2::bigint;
  SELECT min(id)::text INTO k3 FROM public.executie_pachete_lansare WHERE proiect_id = p3::bigint;
  -- spec_b = B (p1 editor, p2 viewer) are voie să citească obiectul (specificația predicatului, nu codul lui)
  FOR r IN SELECT * FROM (VALUES
      ('executie-contracte', p2 || '/test-acces-13a/a.pdf', true), ('executie-contracte', 'pccvi/' || p1 || '/test-acces-13a.pdf', true),
      ('executie-contracte', 'probe-presiune/' || p2 || '/test-acces-13a.pdf', true), ('executie-contracte', 'ordin-incepere/' || p3 || '/test-acces-13a.pdf', false),
      ('executie-contracte', '_nou/' || p1 || '/test-acces-13a.pdf', false), ('executie-contracte', p1 || '/../test-acces-13a.pdf', false),
      ('executie-contracte', '0' || p1 || '/test-acces-13a.pdf', false),
      ('executie-borderouri', 'sl_' || p2 || '/test-acces-13a.xls', true), ('executie-borderouri', 'sl_x/test-acces-13a.xls', false),
      ('executie-borderouri', 'sl_' || p1 || '/../test-acces-13a.xls', false),
      ('executie-pachete-pdf', p1 || '/' || k1 || '/aprobare/test-acces-13a.pdf', true), ('executie-pachete-pdf', p3 || '/' || k1 || '/aprobare/test-acces-13a.pdf', false),
      ('executie-pachete-pdf', p1 || '/' || k3 || '/aprobare/test-acces-13a.pdf', false), ('executie-pachete-pdf', k2 || '/test-acces-13a.pdf', true),
      ('executie-pachete-pdf', k1 || '/../test-acces-13a.pdf', false),
      ('documente-proiect', 'test-acces-13a/fara-rand-' || p1 || '.pdf', false)) v(b, n, s) WHERE v.n IS NOT NULL LOOP
    x := pg_temp.t_obiect_nou(r.b, r.n, NULL);
    IF x LIKE 'OK %' THEN INSERT INTO t13_obj VALUES (r.b, r.n, r.s); ELSE PERFORM pg_temp.t_neprobat('T9 obiect-limită ' || r.b || ' ' || r.n || ': ' || left(x, 100)); END IF;
  END LOOP;
  INSERT INTO t13_up SELECT v.b, v.n FROM (VALUES
      ('executie-contracte', p1 || '/test-acces-13a/nou.pdf'), ('executie-contracte', p2 || '/test-acces-13a/nou.pdf'), ('executie-contracte', 'pccvi/' || p1 || '/test-acces-13a-nou.pdf'),
      ('executie-contracte', p1 || '/../test-acces-13a-nou.pdf'), ('executie-borderouri', 'sl_' || p1 || '/test-acces-13a-nou.xls'), ('executie-borderouri', 'sl_' || p2 || '/test-acces-13a-nou.xls'),
      ('executie-pachete-pdf', p1 || '/' || k1 || '/aprobare/test-acces-13a-nou.pdf'), ('executie-pachete-pdf', p3 || '/' || k1 || '/aprobare/test-acces-13a-nou.pdf'),
      ('executie-pachete-pdf', k1 || '/test-acces-13a-nou.pdf'), ('documente-proiect', 'test-acces-13a/nou-' || p1 || '.pdf')) v(b, n) WHERE v.n IS NOT NULL
   ON CONFLICT DO NOTHING;
  IF k1 IS NULL OR k3 IS NULL THEN PERFORM pg_temp.t_neprobat('T9: forma „aprobare” cu perechea greșită (lipsește un pachet pe p1 / p3)'); END IF;
END $t$;
GRANT SELECT ON t13_obj, t13_up TO authenticated, anon, service_role;
-- ce poate face apelantul curent cu fiecare obiect (văzut, modificat, șters — scris efectiv, apoi anulat) și încărcările pe căile-limită
CREATE FUNCTION pg_temp.t13_obiecte() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE r record; v jsonb := '{}'::jsonb; v_vechi text := current_setting('storage.allow_delete_query', true);
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  FOR r IN SELECT o.bucket, o.nume FROM t13_obj o UNION SELECT o.bucket, o.nume FROM t_obj o ORDER BY 1, 2 LOOP
    v := v || jsonb_build_object(r.bucket || ':' || r.nume, jsonb_build_object(
      'vede', (SELECT count(*) FROM storage.objects s WHERE s.bucket_id = r.bucket AND s.name = r.nume),
      'modifica', pg_temp.t_norm(pg_temp.t_proba(format('UPDATE storage.objects SET name = name WHERE bucket_id = %L AND name = %L', r.bucket, r.nume))),
      'sterge', pg_temp.t_norm(pg_temp.t_proba(format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', r.bucket, r.nume)))));
  END LOOP;
  FOR r IN SELECT u.bucket, u.nume FROM t13_up u ORDER BY 1, 2 LOOP
    v := v || jsonb_build_object('urca:' || r.bucket || ':' || r.nume, pg_temp.t_norm(pg_temp.t_proba(
      format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', r.bucket, r.nume))));
  END LOOP;
  PERFORM set_config('storage.allow_delete_query', coalesce(v_vechi, ''), true);
  RETURN v;
END $h$;
-- tot ce se compară pentru un cont
CREATE FUNCTION pg_temp.t13_tot() RETURNS jsonb LANGUAGE plpgsql AS $h$
BEGIN
  RETURN jsonb_build_object('randuri', pg_temp.t13_randuri(), 'amprenta', pg_temp.t_amprenta(), 'propriu', pg_temp.t_propriu(),
                            'obiecte', pg_temp.t13_obiecte());
END $h$;
-- amprenta politicilor executie_acces_* (tabelele testate + Storage)
CREATE FUNCTION pg_temp.t13_pol() RETURNS text LANGUAGE sql STABLE AS $h$
  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', polrelid::regclass, polname, polcmd, polpermissive, polroles,
                                        coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')), ';'
                                 ORDER BY polrelid::regclass::text, polname), ''))
    FROM pg_policy WHERE (polrelid IN (SELECT rel FROM t_tab) OR polrelid = 'storage.objects'::regclass) AND polname LIKE 'executie\_acces\_%'
$h$;
CREATE FUNCTION pg_temp.t13_val(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r text;
BEGIN
  EXECUTE p_sql INTO r; RETURN coalesce(r, 'null');
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $h$;
-- T9d: lista proprie, ca apelantul curent, față de SELECT-ul lui pe executie_acces_proiect
CREATE FUNCTION pg_temp.t13_proprii() RETURNS jsonb LANGUAGE plpgsql AS $h$
BEGIN
  RETURN jsonb_build_object(
    'citire', pg_temp.t13_val('SELECT public.fn_executie_acces_proprii_citire()::text'),
    'scriere', pg_temp.t13_val('SELECT public.fn_executie_acces_proprii_scriere()::text'),
    'select_citire', pg_temp.t13_val('SELECT coalesce(array_agg(a.proiect_id ORDER BY a.proiect_id), ''{}''::bigint[])::text FROM public.executie_acces_proiect a WHERE a.profile_id = auth.uid()'),
    'select_scriere', pg_temp.t13_val('SELECT coalesce(array_agg(a.proiect_id ORDER BY a.proiect_id), ''{}''::bigint[])::text FROM public.executie_acces_proiect a WHERE a.profile_id = auth.uid() AND a.nivel = ''editor'''),
    'i_politici', pg_temp.t13_val('SELECT count(*)::text FROM public.fn_executie_acces_politici()'),
    'i_verifica', pg_temp.t13_val('SELECT public.fn_executie_acces_politici_verifica(''nou'')'));
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t13_randuri(), pg_temp.t13_obiecte(), pg_temp.t13_tot(), pg_temp.t13_pol(), pg_temp.t13_val(text), pg_temp.t13_proprii()
  TO authenticated, anon, service_role;

-- ── T9: ÎNAINTE (politicile 20261209a), ca fiecare cont ──
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
SELECT length(set_config('tacc.s0_own', pg_temp.t13_tot()::text, true)) AS s0_own;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT length(set_config('tacc.s0_a', pg_temp.t13_tot()::text, true)) AS s0_a;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT length(set_config('tacc.s0_b', pg_temp.t13_tot()::text, true)) AS s0_b;
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
SELECT length(set_config('tacc.s0_c', pg_temp.t13_tot()::text, true)) AS s0_c;
SAVEPOINT t9_a0;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT pg_temp.t_stare(format('DELETE FROM public.user_module_access WHERE profile_id = %L::uuid AND module = %L', pg_temp.t_g('a'), 'executie')) AS a0_fara_modul;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
\set ON_ERROR_STOP 1
SELECT pg_temp.t13_tot()::text AS t9_s0_a0
\gset
ROLLBACK TO SAVEPOINT t9_a0;
SELECT length(set_config('tacc.s0_a0', :'t9_s0_a0', true)) AS s0_a0;
SAVEPOINT t9_b0;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT pg_temp.t_stare(format('DELETE FROM public.user_module_access WHERE profile_id = %L::uuid AND module = %L', pg_temp.t_g('b'), 'executie')) AS b0_fara_modul;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
\set ON_ERROR_STOP 1
SELECT pg_temp.t13_tot()::text AS t9_s0_b0
\gset
ROLLBACK TO SAVEPOINT t9_b0;
SELECT length(set_config('tacc.s0_b0', :'t9_s0_b0', true)) AS s0_b0;
SELECT pg_temp.t_ca(NULL, 'postgres');
-- comparația nu e oarbă: B (restrâns) vede MAI PUȚINE rânduri decât A pe cel puțin un tabel, iar planul vechi are predicatul pe rând
DO $t$
DECLARE a jsonb := pg_temp.t_g('s0_a')::jsonb->'randuri'; b jsonb := pg_temp.t_g('s0_b')::jsonb->'randuri'; n integer; v text;
BEGIN
  SELECT count(*) INTO n FROM jsonb_each_text(b) x
   WHERE x.value ~ '^[0-9]+:' AND (a->>x.key) ~ '^[0-9]+:' AND split_part(x.value, ':', 1)::bigint < split_part(a->>x.key, ':', 1)::bigint;
  IF n = 0 THEN RAISE EXCEPTION 'T9 FAIL: B restrâns vede tot ce vede A — comparația n-ar dovedi nimic'; END IF;
  PERFORM set_config('tacc.t9_mai_putin', n::text, true);
  -- obiectele-limită, oracol independent (specificația): B vede un obiect ⟺ îl vede A (politicile permisive de azi) ȘI forma căii îl permite
  SELECT string_agg(o.bucket || ':' || o.nume, ', ') INTO v FROM t13_obj o
   WHERE ((pg_temp.t_g('s0_b')::jsonb->'obiecte'->(o.bucket || ':' || o.nume)->>'vede')::integer > 0)
         IS DISTINCT FROM (o.spec_b AND (pg_temp.t_g('s0_a')::jsonb->'obiecte'->(o.bucket || ':' || o.nume)->>'vede')::integer > 0);
  IF v IS NOT NULL THEN RAISE EXCEPTION 'T9 FAIL: obiectele-limită văzute de B înainte de 20261213a ≠ specificația: %', v; END IF;
  SELECT count(*) INTO n FROM t13_obj o WHERE (pg_temp.t_g('s0_a')::jsonb->'obiecte'->(o.bucket || ':' || o.nume)->>'vede')::integer > 0 AND NOT o.spec_b;
  IF n = 0 THEN PERFORM pg_temp.t_neprobat('T9: niciun obiect-limită nepermis lui B vizibil lui A'); END IF;
  PERFORM set_config('tacc.pol13_0', pg_temp.t13_pol(), true);
END $t$;
SELECT set_config('tacc.masurare_cont', pg_temp.t_g('b'), true) IS NOT NULL AS cont_b, set_config('tacc.masurare_eticheta', 'T9 inainte B', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
SELECT length(set_config('tacc.plan0_b', current_setting('tacc.masurare_rez'), true)) AS plan0_b;
SELECT set_config('tacc.masurare_cont', pg_temp.t_g('a'), true) IS NOT NULL AS cont_a, set_config('tacc.masurare_eticheta', 'T9 inainte A', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
SELECT length(set_config('tacc.plan0_a', current_setting('tacc.masurare_rez'), true)) AS plan0_a;
DO $t$
DECLARE p jsonb := pg_temp.t_g('plan0_b')::jsonb; k text; n integer := 0;
BEGIN
  FOR k IN SELECT x FROM jsonb_object_keys(p) x ORDER BY x LOOP
    IF p->k ? 'eroare' THEN RAISE EXCEPTION 'T9c FAIL: măsurarea înainte, B, pe %: %', k, p->k->>'eroare'; END IF;
    IF p->k ? 'fara_drept' THEN PERFORM pg_temp.t_neprobat('T9c: B fără SELECT pe ' || k); CONTINUE; END IF;
    -- forma veche: predicatul pe rând pe orice tabel acoperit (în afara cozii Inboxului, deja o evaluare pe interogare) și pe orice bucket
    IF p->k->>'clasa' IN ('proiect', 'proiect_optional', 'copil') OR p->k->>'clasa' LIKE 'bucket\_%' THEN
      IF jsonb_array_length(p->k->'fn_pe_rand') = 0 THEN
        RAISE EXCEPTION 'T9c FAIL: proba de plan e oarbă — înainte de 20261213a, % nu arată predicatul de acces pe rând (%)', k, p->k;
      END IF;
      n := n + 1;
    END IF;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'T9c FAIL: niciun obiect probat'; END IF;
  PERFORM set_config('tacc.t9_vechi', n::text, true);
END $t$;

-- ── T9a: refuzurile la aplicare (o politică 20261209a schimbată) ──
SAVEPOINT t9a1;
ALTER POLICY executie_acces_citire ON public.executie_tronsoane USING ((SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(proiect_id::bigint, true));
SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/migrations/20261213a_executie_acces_proiect_perf.sql
\set t9a1_eroare :ERROR
\set t9a1_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t9a1;
SELECT pg_temp.t_eroare('T9a1', :'t9a1_eroare', :'t9a1_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'politicile nu sunt cele din 20261209a');
-- fără marcaj de livrare = refuz
SAVEPOINT t9a2;
SELECT set_config('gazpet.livrare_migrare', '', true);
\set ON_ERROR_STOP 0
\ir ../supabase/migrations/20261213a_executie_acces_proiect_perf.sql
\set t9a2_eroare :ERROR
\set t9a2_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t9a2;
SELECT pg_temp.t_eroare('T9a2', :'t9a2_eroare', :'t9a2_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda start invalida');

-- ── aplicarea 20261213a ──
SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true);
\ir ../supabase/migrations/20261213a_executie_acces_proiect_perf.sql
DO $t$ BEGIN
  IF public.fn_executie_acces_politici_verifica('nou') IS NOT NULL OR pg_temp.t13_pol() = pg_temp.t_g('pol13_0') THEN
    RAISE EXCEPTION 'T9 FAIL: după aplicare, politicile nu au forma nouă: %', public.fn_executie_acces_politici_verifica('nou');
  END IF;
END $t$;
-- a doua aplicare = refuz
SAVEPOINT t9a3;
SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/migrations/20261213a_executie_acces_proiect_perf.sql
\set t9a3_eroare :ERROR
\set t9a3_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t9a3;
SELECT pg_temp.t_eroare('T9a3', :'t9a3_eroare', :'t9a3_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'reaplicare');

-- ── T9b: DUPĂ, ca fiecare cont: identic ──
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
SELECT length(set_config('tacc.s1_own', pg_temp.t13_tot()::text, true)) AS s1_own;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT length(set_config('tacc.s1_a', pg_temp.t13_tot()::text, true)) AS s1_a;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT length(set_config('tacc.s1_b', pg_temp.t13_tot()::text, true)) AS s1_b;
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
SELECT length(set_config('tacc.s1_c', pg_temp.t13_tot()::text, true)) AS s1_c;
SAVEPOINT t9_a0b;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT pg_temp.t_stare(format('DELETE FROM public.user_module_access WHERE profile_id = %L::uuid AND module = %L', pg_temp.t_g('a'), 'executie')) AS a0_fara_modul;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
\set ON_ERROR_STOP 1
SELECT pg_temp.t13_tot()::text AS t9_s1_a0
\gset
ROLLBACK TO SAVEPOINT t9_a0b;
SELECT length(set_config('tacc.s1_a0', :'t9_s1_a0', true)) AS s1_a0;
SAVEPOINT t9_b0b;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT pg_temp.t_stare(format('DELETE FROM public.user_module_access WHERE profile_id = %L::uuid AND module = %L', pg_temp.t_g('b'), 'executie')) AS b0_fara_modul;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
\set ON_ERROR_STOP 1
SELECT pg_temp.t13_tot()::text AS t9_s1_b0
\gset
SELECT pg_temp.t13_proprii()::text AS t9_proprii_b0
\gset
ROLLBACK TO SAVEPOINT t9_b0b;
SELECT length(set_config('tacc.s1_b0', :'t9_s1_b0', true)) AS s1_b0;
SELECT length(set_config('tacc.pr_b0', :'t9_proprii_b0', true)) AS pr_b0;
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$
DECLARE k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['own', 'a', 'a0', 'b', 'b0', 'c'] LOOP
    IF pg_temp.t_g('s0_' || k) IS NULL OR pg_temp.t_g('s1_' || k) IS NULL THEN RAISE EXCEPTION 'T9b FAIL: lipsește amprenta pentru %', k; END IF;
    IF pg_temp.t_g('s1_' || k)::jsonb IS DISTINCT FROM pg_temp.t_g('s0_' || k)::jsonb THEN
      RAISE EXCEPTION 'T9b FAIL: % după 20261213a diferă de înainte: % | %', k,
        pg_temp.t_dif(pg_temp.t_g('s1_' || k)::jsonb, pg_temp.t_g('s0_' || k)::jsonb),
        pg_temp.t_dif(pg_temp.t_g('s1_' || k)::jsonb->'amprenta', pg_temp.t_g('s0_' || k)::jsonb->'amprenta');
    END IF;
  END LOOP;
  RAISE NOTICE 'T9b OK (owner / A / A0 / B / B0 / C: rândurile văzute pe % tabele și % bucket-uri, amprenta r13 și folderul propriu — identice; B vede mai puțin decât A pe % tabele)',
    (SELECT count(*) FROM jsonb_object_keys(pg_temp.t_g('s0_b')::jsonb->'randuri') x WHERE x NOT LIKE 'storage:%'),
    (SELECT count(*) FROM jsonb_object_keys(pg_temp.t_g('s0_b')::jsonb->'randuri') x WHERE x LIKE 'storage:%'), pg_temp.t_g('t9_mai_putin');
END $t$;

-- ── T9c: proba de PLAN după (prag care pică testul) ──
SELECT set_config('tacc.masurare_cont', pg_temp.t_g('b'), true) IS NOT NULL AS cont_b, set_config('tacc.masurare_eticheta', 'T9 dupa B', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
SELECT length(set_config('tacc.plan1_b', current_setting('tacc.masurare_rez'), true)) AS plan1_b;
SELECT set_config('tacc.masurare_cont', pg_temp.t_g('a'), true) IS NOT NULL AS cont_a, set_config('tacc.masurare_eticheta', 'T9 dupa A', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
SELECT length(set_config('tacc.plan1_a', current_setting('tacc.masurare_rez'), true)) AS plan1_a;
CREATE FUNCTION pg_temp.t13_plan_nou(p_cont text, p_inainte jsonb, p_dupa jsonb) RETURNS integer LANGUAGE plpgsql AS $h$
DECLARE k text; n integer := 0; i jsonb; d jsonb;
BEGIN
  FOR k IN SELECT x FROM jsonb_object_keys(p_inainte) x ORDER BY x LOOP
    i := p_inainte->k; d := p_dupa->k;
    IF d IS NULL OR d ? 'eroare' THEN RAISE EXCEPTION 'T9c FAIL: măsurarea după, %, pe %: %', p_cont, k, coalesce(d->>'eroare', 'lipsă'); END IF;
    IF i ? 'fara_drept' OR d ? 'fara_drept' THEN
      IF (i ? 'fara_drept') IS DISTINCT FROM (d ? 'fara_drept') THEN RAISE EXCEPTION 'T9c FAIL: dreptul de citire al lui % pe % s-a schimbat', p_cont, k; END IF;
      CONTINUE;
    END IF;
    IF d->>'randuri' IS DISTINCT FROM i->>'randuri' THEN RAISE EXCEPTION 'T9c FAIL: % vede pe % % rânduri după / % înainte', p_cont, k, d->>'randuri', i->>'randuri'; END IF;
    IF d->>'clasa' <> 'drept' THEN
      IF jsonb_array_length(d->'fn_pe_rand') <> 0 THEN
        RAISE EXCEPTION 'T9c FAIL (prag): % pe % — predicatul de acces se evaluează încă pe fiecare rând: % (plan: %)', p_cont, k, d->'fn_pe_rand', d;
      END IF;
      IF (d->>'initplan_loops_max')::numeric > 1 THEN
        RAISE EXCEPTION 'T9c FAIL (prag): % pe % — un InitPlan cu funcția de acces s-a executat de % ori (maxim 1)', p_cont, k, d->>'initplan_loops_max';
      END IF;
      IF (d->>'subplan_corelate')::integer > (i->>'subplan_corelate')::integer THEN
        RAISE EXCEPTION 'T9c FAIL (prag): % pe % — % subinterogări corelate (pe rând) după / % înainte', p_cont, k, d->>'subplan_corelate', i->>'subplan_corelate';
      END IF;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $h$;
DO $t$
DECLARE nb integer; na integer;
BEGIN
  nb := pg_temp.t13_plan_nou('B', pg_temp.t_g('plan0_b')::jsonb, pg_temp.t_g('plan1_b')::jsonb);
  na := pg_temp.t13_plan_nou('A', pg_temp.t_g('plan0_a')::jsonb, pg_temp.t_g('plan1_a')::jsonb);
  IF nb < pg_temp.t_g('t9_vechi')::integer THEN RAISE EXCEPTION 'T9c FAIL: probate după % / cu predicat pe rând înainte %', nb, pg_temp.t_g('t9_vechi'); END IF;
  RAISE NOTICE 'T9c OK (B: % obiecte cu predicatul pe rând înainte → 0 după, InitPlan-urile de acces ≤ 1 execuție, fără subinterogări corelate noi, aceleași rânduri; A: % obiecte, aceleași rânduri)',
    pg_temp.t_g('t9_vechi'), na;
END $t$;

-- ── T9d: lista proprie = SELECT-ul propriu, pentru fiecare cont; anon = 42501; interne = 42501 ──
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
SELECT set_config('tacc.pr_own', pg_temp.t13_proprii()::text, true) IS NOT NULL AS pr_own;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT set_config('tacc.pr_a', pg_temp.t13_proprii()::text, true) IS NOT NULL AS pr_a;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT set_config('tacc.pr_b', pg_temp.t13_proprii()::text, true) IS NOT NULL AS pr_b;
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
SELECT set_config('tacc.pr_c', pg_temp.t13_proprii()::text, true) IS NOT NULL AS pr_c;
SELECT pg_temp.t_ca(NULL, 'anon');
SELECT set_config('tacc.pr_anon', jsonb_build_object('citire', pg_temp.t13_val('SELECT public.fn_executie_acces_proprii_citire()::text'),
                                                     'scriere', pg_temp.t13_val('SELECT public.fn_executie_acces_proprii_scriere()::text'))::text, true) IS NOT NULL AS pr_anon;
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$
DECLARE k text; m jsonb; p1 bigint := pg_temp.t_g('p1')::bigint; p2 bigint := pg_temp.t_g('p2')::bigint; ast_c text; ast_s text;
BEGIN
  FOREACH k IN ARRAY ARRAY['own', 'a', 'b', 'b0', 'c'] LOOP
    m := pg_temp.t_g('pr_' || k)::jsonb;
    IF m IS NULL THEN RAISE EXCEPTION 'T9d FAIL: lipsesc rezultatele pentru %', k; END IF;
    -- (1) = ce citește contul însuși din executie_acces_proiect (nimic nou)
    IF m->>'citire' IS DISTINCT FROM m->>'select_citire' OR m->>'scriere' IS DISTINCT FROM m->>'select_scriere' THEN
      RAISE EXCEPTION 'T9d FAIL: lista proprie a lui % ≠ SELECT-ul propriu: %', k, m;
    END IF;
    -- (2) specificația
    ast_c := CASE k WHEN 'b' THEN ARRAY(SELECT unnest(ARRAY[p1, p2]) ORDER BY 1)::text WHEN 'b0' THEN ARRAY(SELECT unnest(ARRAY[p1, p2]) ORDER BY 1)::text
                    WHEN 'c' THEN ARRAY[p1]::text ELSE '{}' END;
    ast_s := CASE WHEN k IN ('b', 'b0', 'c') THEN ARRAY[p1]::text ELSE '{}' END;
    IF m->>'citire' IS DISTINCT FROM ast_c OR m->>'scriere' IS DISTINCT FROM ast_s THEN
      RAISE EXCEPTION 'T9d FAIL: lista proprie a lui %: % / % (așteptat % / %)', k, m->>'citire', m->>'scriere', ast_c, ast_s;
    END IF;
    -- (3) generatorul și verificarea politicilor: interne
    IF coalesce(m->>'i_politici', '') NOT LIKE '42501 permission denied for function fn\_executie\_acces\_politici%'
       OR coalesce(m->>'i_verifica', '') NOT LIKE '42501 permission denied for function fn\_executie\_acces\_politici\_verifica%' THEN
      RAISE EXCEPTION 'T9d FAIL: funcțiile interne ale 20261213a apelabile de %: %', k, m;
    END IF;
  END LOOP;
  m := pg_temp.t_g('pr_anon')::jsonb;
  IF coalesce(m->>'citire', '') NOT LIKE '42501 permission denied for function fn\_executie\_acces\_proprii\_citire%'
     OR coalesce(m->>'scriere', '') NOT LIKE '42501 permission denied for function fn\_executie\_acces\_proprii\_scriere%' THEN
    RAISE EXCEPTION 'T9d FAIL: anon cheamă lista proprie: %', m;
  END IF;
  RAISE NOTICE 'T9d OK (lista proprie = SELECT-ul propriu pentru owner / A / B / B0 / C, specificația, anon și internele = 42501)';
END $t$;

-- ── T9r: revenirea ──
-- (a) revenirea 20261209a, ARMATĂ, refuză cât timp 20261213a e aplicată (ordinea revenirilor)
SAVEPOINT t9r1;
SELECT set_config('gazpet.revenire_20261209a', 'SCOATE_ACCES_PROIECT:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql
\set t9r1_eroare :ERROR
\set t9r1_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t9r1;
SELECT pg_temp.t_eroare('T9r1', :'t9r1_eroare', :'t9r1_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'starea nu e cea din 20261209a');
-- (b) nearmată = refuz
SAVEPOINT t9r2;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql
\set t9r2_eroare :ERROR
\set t9r2_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t9r2;
SELECT pg_temp.t_eroare('T9r2', :'t9r2_eroare', :'t9r2_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
-- (c) o politică schimbată după aplicare = refuz, nimic atins
SAVEPOINT t9r3;
ALTER POLICY executie_acces_sterge ON public.executie_tronsoane USING (true);
SELECT set_config('gazpet.revenire_20261213a', 'REDA_POLITICILE_20261209A:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql
\set t9r3_eroare :ERROR
\set t9r3_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t9r3;
SELECT pg_temp.t_eroare('T9r3', :'t9r3_eroare', :'t9r3_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'starea nu e cea din 20261213a');
-- (d) armată = politicile 20261209a la loc, echivalența și planul vechi din nou
SELECT set_config('gazpet.revenire_20261213a', 'REDA_POLITICILE_20261209A:' || txid_current(), true);
\ir ../supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql
DO $t$ BEGIN
  IF pg_temp.t13_pol() IS DISTINCT FROM pg_temp.t_g('pol13_0')
     OR to_regprocedure('public.fn_executie_acces_politici()') IS NOT NULL OR to_regprocedure('public.fn_executie_acces_proprii_citire()') IS NOT NULL
     OR to_regprocedure('public.fn_executie_acces_proprii_scriere()') IS NOT NULL OR to_regprocedure('public.fn_executie_acces_politici_verifica(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'T9r FAIL: după revenire, politicile / funcțiile nu sunt cele din 20261209a';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT length(set_config('tacc.s2_b', pg_temp.t13_tot()::text, true)) AS s2_b;
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
SELECT length(set_config('tacc.s2_c', pg_temp.t13_tot()::text, true)) AS s2_c;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT length(set_config('tacc.s2_a', pg_temp.t13_tot()::text, true)) AS s2_a;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('tacc.masurare_cont', pg_temp.t_g('b'), true) IS NOT NULL AS cont_b, set_config('tacc.masurare_eticheta', 'T9r revenire B', true) AS eticheta;
\ir executie_acces_masurare_corp.sql
DO $t$
DECLARE k text; p jsonb := current_setting('tacc.masurare_rez')::jsonb; p0 jsonb := pg_temp.t_g('plan0_b')::jsonb;
BEGIN
  FOREACH k IN ARRAY ARRAY['a', 'b', 'c'] LOOP
    IF pg_temp.t_g('s2_' || k)::jsonb IS DISTINCT FROM pg_temp.t_g('s0_' || k)::jsonb THEN
      RAISE EXCEPTION 'T9r FAIL: % după revenire diferă de înainte: %', k, pg_temp.t_dif(pg_temp.t_g('s2_' || k)::jsonb, pg_temp.t_g('s0_' || k)::jsonb);
    END IF;
  END LOOP;
  FOR k IN SELECT x FROM jsonb_object_keys(p0) x LOOP
    IF p->k->'fn_pe_rand' IS DISTINCT FROM p0->k->'fn_pe_rand' OR p->k->>'randuri' IS DISTINCT FROM p0->k->>'randuri' THEN
      RAISE EXCEPTION 'T9r FAIL: planul după revenire pe % (%) ≠ planul de dinainte (%)', k, p->k, p0->k;
    END IF;
  END LOOP;
END $t$;
-- (e) re-aplicarea: din nou forma nouă și echivalența
SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true);
\ir ../supabase/migrations/20261213a_executie_acces_proiect_perf.sql
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT length(set_config('tacc.s3_b', pg_temp.t13_tot()::text, true)) AS s3_b;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT length(set_config('tacc.s3_a', pg_temp.t13_tot()::text, true)) AS s3_a;
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$
DECLARE k text;
BEGIN
  IF public.fn_executie_acces_politici_verifica('nou') IS NOT NULL THEN RAISE EXCEPTION 'T9r FAIL: re-aplicarea nu a dat forma nouă'; END IF;
  FOREACH k IN ARRAY ARRAY['a', 'b'] LOOP
    IF pg_temp.t_g('s3_' || k)::jsonb IS DISTINCT FROM pg_temp.t_g('s0_' || k)::jsonb THEN
      RAISE EXCEPTION 'T9r FAIL: % după re-aplicare diferă: %', k, pg_temp.t_dif(pg_temp.t_g('s3_' || k)::jsonb, pg_temp.t_g('s0_' || k)::jsonb);
    END IF;
  END LOOP;
  RAISE NOTICE 'T9 OK — 20261213a: refuzuri la aplicare (politică schimbată, fără marcaj, a doua oară), echivalența pe 6 conturi, planul fără predicat pe rând, lista proprie, revenirea (refuz 20261209a / nearmată / politică schimbată; armată = exact 20261209a) și re-aplicarea';
END $t$;
