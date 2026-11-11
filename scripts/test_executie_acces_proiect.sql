-- Harness 20261209a_executie_acces_proiect (r4) — DOAR pe clona schemei de producție (PG ca în producție, postgres NOSUPERUSER), NICIODATĂ pe producție.
-- Rulare din rădăcina repo-ului:  psql -X -v ON_ERROR_STOP=1 -f scripts/test_executie_acces_proiect.sql
-- Precondiție: 20261201a, 20261203a, 20261204a, 20261208a aplicate pe clonă (migrarea le cere); 20261207a și 20261211a (fibra) opționale.
-- O singură tranzacție, ANULATĂ la final (ROLLBACK).
-- Oracolul independent (L25):
--   * LISTA testată vine din CATALOG (scripts/executie_acces_catalog.sql: FK tranzitiv din executie_proiecte + coloane proiect_id), nu din
--     migrare; din inventarul migrării se ia doar CLASA pretinsă (citită într-un savepoint anulat), iar orice tabel din catalog fără clasă = FAIL;
--   * PROIECTUL fiecărui rând = expresia derivată din FK-uri (t_cat_proiect_expr), nu coloana declarată de migrare;
--   * CE VEDEA și CE PUTEA SCRIE fiecare cont ÎNAINTE de migrare (prin RLS-ul existent), pe TOATE probele („amprenta” contului: citire,
--     scriere fără efect pe REST și pe o cale SECURITY DEFINER, INSERT complet pe ambele căi, obiecte Storage, Inboxul AI, încărcări):
--     după migrare, fără niciun rând, amprenta fiecărui cont (A, B, C și owner-ul) e IDENTICĂ; cu B și C restrânși, owner-ul și A rămân
--     identici, iar B / C: identic pe proiectele lor, zero pe al treilea, iar o scriere care reușea înainte pe un proiect cu drept de scriere
--     TREBUIE să reușească și după (rândul scris efectiv, apoi anulat); un refuz trebuie să aibă MOTIVUL așteptat (garda sau RLS-ul), nu
--     „orice altă eroare”;
--   * regula rândurilor FĂRĂ proiect (specificația, nu migrarea): rămân vizibile pe graficul intern și pe raportul unui șantier fără proiect.
-- r4 (L25): harness-ul își creează singur, în tranzacție, câte un rând de PROBĂ pe fiecare tabel acoperit (p1 / p2 / p3 și, unde contează,
--   fără proiect), copiat dintr-un rând existent sau construit din constrângeri, plus obiecte Storage și rânduri în Inboxul AI; ce nu se
--   poate crea apare la final în lista „NEPROBAT”, cu motivul.
-- r5 (review r4): Inboxul AI — documentul lui B potrivit de clasificator pe p3 nu i se mai arată (nici rândul, nici fișierul), documentul lui
--   B încă fără proiect se vede ca înainte; clasificarea e simulată ca edge-ul (service_role, fără JWT). Orice refuz verificat are
--   SQLSTATE-ul ȘI fragmentul de mesaj așteptat (sau, la UPDATE prin REST, exact „OK 0” după ce aceeași probă scria înainte).
-- r6 (review r5 P1): clasificatorul (edge citeste-orice r6) caută DOAR în candidații dați de BD pentru contul care a urcat
--   (fn_executie_acces_candidati): T3c verifică lista față de specificație pentru fiecare cont + paritatea cu regula pe apelant, apoi că
--   documentul lui B cu un indiciu doar pe p3 rămâne vizibil, fără proiect (fără semnal); plasa din r5 rămâne probată pe o scriere directă.
-- r8 (review SQL P1-01 / P1-02): T3e cheamă DIRECT fiecare funcție publică a migrării, ca A0 (logat, fără drept pe modul), A (editor
--   nerestrâns) și B (restrâns), cu un id / o cale permisă, una existentă nepermisă și una inexistentă: „nepermis” = „inexistent”, valorile
--   = specificația, funcțiile interne = 42501.
-- r9 (review r8, ambii recenzenți P1): T3e SISTEMATIC — fiecare funcție cu EXECUTE pentru clienți × fiecare fel de argument × 4 conturi (A0,
--   A, B, B0 = B fără modul); vizibilitatea argumentului măsurată ca apelantul; existent invizibil = inexistent, exact (valoare / eroare /
--   SQLSTATE / mesaj); cazurile literale din verdicte; poarta swap cere scrierea pe modul (T3e, T4).
-- r10 (review r9, Jakarinos P1: în folderul propriu, documentul propriu legat de un proiect nepermis = fals, cale inexistentă = adevărat):
--   excepția din T3e a ieșit (folderul propriu e verificat ca oricare altul: invizibil = inexistent); rânduri de probă noi — documentul lui B
--   pe p1 și un fișier al lui B FĂRĂ rând; T3f = cazul literal (a) cale inexistentă, (b) fișier propriu cu rând pe un proiect nepermis,
--   (c) cu rând pe un proiect permis, (d) fără rând: citirea dă același rezultat în toate patru; scrierea comparată înainte / după.
-- NU presupune date reale: ia primul owner, primele 3 profiluri non-owner și cele 3 proiecte cu cele mai multe tabele acoperite cu date
-- (dacă clona are doar 2, al treilea se creează în tranzacție), le leagă DOAR în tranzacție și scrie date FICTIVE (T-ACC*, TA-*, test-acces/…,
-- NOD-TEST-ACCES, rapoarte pe 2001-01-01 / 1990–1998, mesajul TEST-ACCES-1).
-- Identități: A = Execuție editor, NErestrâns; B = Execuție editor, restrâns pe p1 (editor) + p2 (viewer); C = Execuție viewer, restrâns pe p1 (editor).
-- Fiecare test se termină cu NOTICE „Tn OK”; orice abatere oprește rularea (RAISE EXCEPTION).
\set ON_ERROR_STOP 1
BEGIN ISOLATION LEVEL READ COMMITTED;
\ir executie_acces_catalog.sql

-- ── unelte ──
CREATE FUNCTION pg_temp.t_ca(p_uid uuid, p_rol text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_rol = 'postgres' THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN jsonb_build_object('role', p_rol)::text
                                              ELSE jsonb_build_object('sub', p_uid, 'role', p_rol)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
  IF auth.uid() IS DISTINCT FROM p_uid OR current_user IS DISTINCT FROM p_rol
     OR (p_rol IN ('authenticated', 'anon') AND (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 't_ca: identitatea nu s-a schimbat (% / %)', auth.uid(), current_user;
  END IF;
END $h$;
CREATE FUNCTION pg_temp.t_g(p text) RETURNS text LANGUAGE sql STABLE AS $h$ SELECT nullif(current_setting('tacc.' || p, true), ''); $h$;
-- rezultatul unei instrucțiuni, SCRISĂ EFECTIV apoi anulată (subtranzacție): 'OK <rânduri>' sau '<SQLSTATE> <mesaj>'
CREATE FUNCTION pg_temp.t_proba(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE n integer; r text;
BEGIN
  BEGIN
    EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT;
    r := 'OK ' || n;
    RAISE EXCEPTION USING ERRCODE = 'TACC0', MESSAGE = r;
  EXCEPTION WHEN SQLSTATE 'TACC0' THEN RETURN r;
            WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
  END;
END $h$;
-- aceeași probă pe o cale SECURITY DEFINER (ca RPC-urile vechi: ocolește RLS, dar NU trigger-ul de gardă)
CREATE FUNCTION pg_temp.t_proba_definer(p_sql text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $h$
BEGIN RETURN pg_temp.t_proba(p_sql); END $h$;
-- o instrucțiune care RĂMÂNE scrisă (în tranzacția harness-ului): 'OK <rânduri>' sau eroarea
CREATE FUNCTION pg_temp.t_stare(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE n integer;
BEGIN
  EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN 'OK ' || n;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || left(SQLERRM, 200);
END $h$;
-- motivele refuzului: garda migrării / politica RLS (WITH CHECK) — nimic altceva nu e „refuz confirmat”
CREATE FUNCTION pg_temp.t_e_garda(p_rez text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $h$
  SELECT coalesce(p_rez LIKE '42501 %nu ai drept de scriere pe acest proiect%', false)
$h$;
CREATE FUNCTION pg_temp.t_e_rls(p_rez text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $h$
  SELECT coalesce(p_rez LIKE '42501 new row violates row-level security policy%', false)
$h$;
CREATE FUNCTION pg_temp.t_eroare(p_test text, p_eroare text, p_stare text, p_mesaj text, p_stare_ast text, p_fragment text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  IF p_eroare IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '% FAIL: operația trebuia refuzată, dar a trecut', p_test; END IF;
  IF p_stare IS DISTINCT FROM p_stare_ast OR position(p_fragment IN coalesce(p_mesaj, '')) = 0 THEN
    RAISE EXCEPTION '% FAIL: refuz cu alt motiv (% / %)', p_test, p_stare, p_mesaj;
  END IF;
  RAISE NOTICE '% refuz confirmat: %', p_test, p_mesaj;
END $h$;
CREATE FUNCTION pg_temp.t_neprobat(p text) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  PERFORM set_config('tacc.neprobat', coalesce(pg_temp.t_g('neprobat') || '; ', '') || p, true);
END $h$;
-- plpgsql (nu sql): RPC-ul apare abia după migrare, corpul nu se validează la creare
CREATE FUNCTION pg_temp.t_seteaza(p_profil text, p_restrans boolean, p_lista jsonb, p_veche jsonb) RETURNS jsonb LANGUAGE plpgsql AS $h$
BEGIN
  RETURN public.fn_executie_acces_proiect_seteaza(pg_temp.t_g(p_profil)::uuid, p_restrans, p_lista, p_veche);
END $h$;
CREATE FUNCTION pg_temp.t_lista(p text) RETURNS jsonb LANGUAGE sql STABLE AS $h$
  SELECT coalesce(jsonb_agg(jsonb_build_object('proiect_id', pg_temp.t_g(split_part(e, ':', 1))::bigint, 'nivel', split_part(e, ':', 2))), '[]'::jsonb)
    FROM unnest(string_to_array(nullif(p, ''), ',')) e
$h$;
-- SPECIFICAȚIA (decizia scrisă, nu codul migrării): tabelele pe care un rând FĂRĂ proiect rămâne vizibil și pentru contul restrâns —
-- graficul intern (rândurile licitațiilor) și raportul zilnic al unui șantier fără proiect (antet + liniile de distribuție)
CREATE FUNCTION pg_temp.t_nul_permis(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $h$
  SELECT p = ANY (ARRAY['grafic_activitati', 'rapoarte_zilnice', 'raport_distributie_linii'])
$h$;
-- r6 (T3c): rezultatele pașilor dintr-un savepoint, adunate într-un singur jsonb (trec prin \gset peste ROLLBACK TO)
CREATE FUNCTION pg_temp.t_pune(p_k text, p_v jsonb) RETURNS void LANGUAGE plpgsql AS $h$
BEGIN
  PERFORM set_config('tacc.t3c', (coalesce(pg_temp.t_g('t3c'), '{}')::jsonb || jsonb_build_object(p_k, p_v))::text, true);
END $h$;
-- id-urile (sortate) dintr-un tablou de candidați [{id, nume, cod_intern}]
CREATE FUNCTION pg_temp.t_ids(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $h$
  SELECT coalesce(jsonb_agg((e->>'id')::bigint ORDER BY (e->>'id')::bigint), '[]'::jsonb) FROM jsonb_array_elements(p) e
$h$;
-- edge-ul citeste-orice r6, simulat (service_role, fără JWT): candidații = fn_executie_acces_candidati(contul care a urcat RÂNDUL), apoi
-- prima potrivire a indiciului (p_potriviri, în ordinea scorului) care e printre candidați; niciuna = rândul neatins (bestMatch → null).
-- plpgsql: funcția din BD apare abia după migrare, corpul nu se validează la creare
CREATE FUNCTION pg_temp.t_clasifica_r6(p_inbox bigint, p_potriviri bigint[]) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE v_id bigint;
BEGIN
  SELECT x.id INTO v_id
    FROM public.ai_documente_inbox j
   CROSS JOIN LATERAL (SELECT (e->>'id')::bigint AS id FROM jsonb_array_elements(public.fn_executie_acces_candidati(j.uploadat_de)) e) x
   WHERE j.id = p_inbox AND x.id = ANY (p_potriviri)
   ORDER BY array_position(p_potriviri, x.id) LIMIT 1;
  IF v_id IS NULL THEN RETURN 'fara potrivire'; END IF;
  RETURN pg_temp.t_stare(format('UPDATE public.ai_documente_inbox SET entitate_tip = %L, entitate_id = %s, entitate_match_confidence = 88 WHERE id = %s',
                                'proiect', v_id, p_inbox)) || ' ' || v_id;
END $h$;
-- ce vede contul curent din rândul de probă k al Inboxului: '<rânduri>:<fișiere>:<proiectul văzut sau ->'
CREATE FUNCTION pg_temp.t_vede_ib(p_k text) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  RETURN (SELECT count(*) FROM public.ai_documente_inbox i JOIN t_ib ON t_ib.id = i.id AND t_ib.k = p_k)::text
      || ':' || (SELECT count(*) FROM storage.objects s JOIN t_ib ON t_ib.cale = s.name AND t_ib.k = p_k WHERE s.bucket_id = 'ai-documente-inbox')::text
      || ':' || coalesce((SELECT i.entitate_id::text FROM public.ai_documente_inbox i JOIN t_ib ON t_ib.id = i.id AND t_ib.k = p_k), '-');
END $h$;
-- prima diferență între două amprente (mesajele de FAIL)
CREATE FUNCTION pg_temp.t_dif(p_a jsonb, p_b jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $h$
  SELECT left(string_agg(format('%s.%s: %s / %s', s.k, x.k2, x.va, x.vb), '; ' ORDER BY s.k, x.k2), 900)
    FROM (SELECT jsonb_object_keys(p_a) AS k UNION SELECT jsonb_object_keys(p_b)) s
    CROSS JOIN LATERAL (SELECT w.k2, p_a->s.k->w.k2 AS va, p_b->s.k->w.k2 AS vb
                          FROM (SELECT jsonb_object_keys(coalesce(p_a->s.k, '{}'::jsonb)) AS k2
                                UNION SELECT jsonb_object_keys(coalesce(p_b->s.k, '{}'::jsonb))) w) x
   WHERE x.va IS DISTINCT FROM x.vb
$h$;

-- ── T0a: inventarul pretins de migrare (clasa fiecărui obiect), citit într-un savepoint ANULAT ──
SAVEPOINT t_inv;
SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);
\ir ../supabase/migrations/20261209a_executie_acces_proiect.sql
SELECT (SELECT json_agg(i)::text FROM public.fn_executie_acces_inventar() i) AS t_inv_json
\gset
ROLLBACK TO SAVEPOINT t_inv;
CREATE TEMP TABLE t_inv AS SELECT * FROM json_to_recordset(:'t_inv_json'::json) AS x(tip text, obiect text, clasa text, cheie text, parinte text, motiv text);
DO $t$ BEGIN
  IF to_regclass('public.executie_acces_proiect') IS NOT NULL OR (SELECT count(*) FROM t_inv) < 50 THEN
    RAISE EXCEPTION 'T0a FAIL: savepoint-ul nu a anulat migrarea sau inventarul e gol';
  END IF;
END $t$;

-- ── T0b: lista testată, din CATALOG ──
-- t_tab: fiecare tabel din catalog (oprire la cele declarate excluse) + tabelele acoperite din inventar; clasa = cea pretinsă.
-- Clase: G = proiect | proiect_optional | copil (politici + gardă din migrare), drept (politicile lor), inbox (probat separat, T3i).
CREATE TEMP TABLE t_tab AS
  SELECT DISTINCT ON (c.rel) c.rel, c.nume, c.e_public,
         coalesce((SELECT i.clasa FROM t_inv i WHERE i.tip = 'tabel' AND i.obiect = c.nume AND c.e_public),
                  (SELECT i.clasa FROM t_inv i WHERE i.tip = 'prefix_tabel' AND starts_with(c.nume, i.obiect) AND c.e_public
                    ORDER BY length(i.obiect) DESC LIMIT 1)) AS clasa,
         pg_temp.t_cat_proiect_expr(c.rel) AS expr, NULL::text AS col_upd, NULL::text AS col_ins
    FROM (SELECT t.rel, t.nume, t.e_public FROM pg_temp.t_cat_tabele(
                   ARRAY(SELECT obiect FROM t_inv WHERE tip = 'tabel' AND clasa IN ('exclus', 'comun')),
                   ARRAY(SELECT obiect FROM t_inv WHERE tip = 'prefix_tabel')) t
          UNION SELECT to_regclass('public.' || i.obiect)::oid, i.obiect, true FROM t_inv i
                 WHERE i.tip = 'tabel' AND i.clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox', 'drept') AND to_regclass('public.' || i.obiect) IS NOT NULL) c
   ORDER BY c.rel;
DO $t$
DECLARE v text;
BEGIN
  SELECT string_agg(nume, ', ' ORDER BY nume) INTO v FROM t_tab WHERE clasa IS NULL;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'T0b FAIL: tabele legate de proiecte, fără clasă în inventar: %', v; END IF;
  SELECT string_agg(nume, ', ' ORDER BY nume) INTO v FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil', 'drept') AND expr IS NULL;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'T0b FAIL: nu pot deriva proiectul rândurilor din FK-uri pentru: %', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM t_tab WHERE nume = 'ai_documente_inbox' AND clasa = 'inbox') THEN
    RAISE EXCEPTION 'T0b FAIL: coada Inboxului AI lipsește din lista testată';
  END IF;
  -- coloana pentru scrierea „fără efect” (prima coloană obișnuită) și coloana-cheie a INSERT-ului (cea din expresie, nivelul de sus)
  UPDATE t_tab SET col_upd = (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = t_tab.rel AND a.attnum > 0 AND NOT a.attisdropped
                                AND a.attidentity = '' AND a.attgenerated = '' ORDER BY a.attnum LIMIT 1),
                   col_ins = coalesce(substring(expr FROM '^t\.([a-z_][a-z_0-9]*)$'), substring(expr FROM 'WHERE x1\.[a-z_0-9]+ = t\.([a-z_][a-z_0-9]*)\)$'))
   WHERE clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox', 'drept');
  RAISE NOTICE 'T0b OK (% tabele din catalog: % acoperite, % cu funcție de drept, % excluse, % comune)', (SELECT count(*) FROM t_tab),
    (SELECT count(*) FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox')), (SELECT count(*) FROM t_tab WHERE clasa = 'drept'),
    (SELECT count(*) FROM t_tab WHERE clasa = 'exclus'), (SELECT count(*) FROM t_tab WHERE clasa = 'comun');
END $t$;
GRANT SELECT ON t_inv, t_tab TO authenticated, anon, service_role;

-- ── rânduri de probă (r4, L25) ──
-- cheia străină cu o singură coloană a lui p_rel pe coloana p_col: (tabelul referit, coloana referită)
CREATE FUNCTION pg_temp.t_fk(p_rel oid, p_col text) RETURNS TABLE (confrelid oid, refcol text) LANGUAGE sql STABLE AS $h$
  SELECT c.confrelid, af.attname::text FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
   WHERE c.conrelid = p_rel AND c.contype = 'f' AND cardinality(c.conkey) = 1 AND a.attname = p_col
   ORDER BY c.conname LIMIT 1
$h$;
-- valoarea cheii care leagă un rând nou de proiectul n (n = 0: de „niciun proiect”): proiectul însuși sau un părinte al lui (ales ca
-- postgres, după proiectul DERIVAT din FK-uri). '' = NULL SQL (cheie directă, n = 0); NULL = nu există un asemenea părinte.
CREATE FUNCTION pg_temp.t_cheie_proba(p_tabel text, p_n integer) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r record; k record; v text; v_p bigint := CASE WHEN p_n > 0 THEN pg_temp.t_g('p' || p_n)::bigint END;
BEGIN
  SELECT * INTO r FROM t_tab WHERE nume = p_tabel;
  IF r.col_ins IS NULL THEN RETURN NULL; END IF;
  IF r.expr ~ '^t\.[a-z_][a-z_0-9]*$' THEN RETURN coalesce(v_p::text, ''); END IF;
  SELECT * INTO k FROM pg_temp.t_fk(r.rel, r.col_ins);
  IF k.confrelid IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT p.%I::text FROM %s p WHERE (%s)::bigint IS NOT DISTINCT FROM $1 ORDER BY p.%I LIMIT 1',
                 k.refcol, k.confrelid::regclass, pg_temp.t_cat_proiect_expr(k.confrelid, 'p'), k.refcol) INTO v USING v_p;
  RETURN v;
END $h$;
-- o valoare sintetică (literal SQL) pentru o coloană: cheie străină = primul rând referit; CHECK cu o listă = prima valoare; altfel după tip
CREATE FUNCTION pg_temp.t_val_sint(p_rel oid, p_col text, p_tip oid, p_tipnume text, p_unic boolean) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE k record; v text;
BEGIN
  SELECT * INTO k FROM pg_temp.t_fk(p_rel, p_col);
  IF k.confrelid IS NOT NULL THEN
    EXECUTE format('SELECT %I::text FROM %s ORDER BY 1 LIMIT 1', k.refcol, k.confrelid::regclass) INTO v;
    RETURN CASE WHEN v IS NULL THEN NULL ELSE quote_literal(v) || '::' || p_tipnume END;
  END IF;
  IF NOT p_unic THEN
    SELECT substring(pg_get_constraintdef(c.oid) FROM '''((?:[^'']|'''')*)''') INTO v FROM pg_constraint c
     WHERE c.conrelid = p_rel AND c.contype = 'c'
       AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = p_rel AND a.attname = p_col)]::int2[]
       AND pg_get_constraintdef(c.oid) ~ '(ANY|IN) \('
     ORDER BY c.conname LIMIT 1;
    IF v IS NOT NULL THEN RETURN quote_literal(replace(v, '''''', '''')) || '::' || p_tipnume; END IF;
  END IF;
  RETURN CASE
    WHEN p_tip IN ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype) THEN quote_literal('TA-' || left(md5(random()::text), 10)) || '::' || p_tipnume
    WHEN p_tip IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype) THEN (900000 + floor(random() * 99999))::bigint::text || '::' || p_tipnume
    WHEN p_tip IN ('numeric'::regtype, 'float4'::regtype, 'float8'::regtype) THEN '1::' || p_tipnume
    WHEN p_tip = 'bool'::regtype THEN 'false'
    WHEN p_tip = 'date'::regtype THEN quote_literal((DATE '1990-01-01' + floor(random() * 3000)::integer)::text) || '::date'
    WHEN p_tip IN ('timestamptz'::regtype, 'timestamp'::regtype) THEN
      quote_literal((TIMESTAMPTZ '1990-01-01 08:00:00+02' + floor(random() * 3000) * interval '1 day')::text) || '::' || p_tipnume
    WHEN p_tip IN ('jsonb'::regtype, 'json'::regtype) THEN '''{}''::' || p_tipnume
    WHEN p_tip = 'uuid'::regtype THEN quote_literal(gen_random_uuid()::text) || '::uuid'
    ELSE NULL END;
END $h$;
-- INSERT-ul (TEXT, cu valori literale: îl poate rula orice rol, fără să depindă de ce vede) al unui rând nou în p_rel, cu p_col = p_cheie
-- ('' = NULL), copiat din rândul-sursă p_src (ctid) sau construit din constrângeri. Coloanele din indecși unici (fără cheie străină)
-- primesc valori noi (altfel copia s-ar ciocni de sursă), căile de fișier o cale de test; p_over = valori impuse {coloana: literal SQL}.
CREATE FUNCTION pg_temp.t_sql_proba(p_rel oid, p_col text, p_cheie text, p_src text, p_over jsonb DEFAULT '{}'::jsonb) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE a record; v_cols text[] := '{}'; v_expr text[] := '{}'; v_vals text; v_e text;
BEGIN
  FOR a IN SELECT at.attname::text AS col, at.atttypid, at.attnotnull, at.atthasdef, format_type(at.atttypid, at.atttypmod) AS tip,
                  EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = p_rel AND (i.indisprimary OR i.indisunique) AND at.attnum = ANY (i.indkey)) AS unic,
                  EXISTS (SELECT 1 FROM pg_temp.t_fk(p_rel, at.attname::text) f WHERE f.confrelid IS NOT NULL) AS fk
             FROM pg_attribute at
            WHERE at.attrelid = p_rel AND at.attnum > 0 AND NOT at.attisdropped AND at.attidentity = '' AND at.attgenerated = ''
            ORDER BY at.attnum LOOP
    IF p_over ? a.col THEN v_e := quote_literal(p_over->>a.col);
    ELSIF a.col = p_col THEN v_e := quote_literal(CASE WHEN p_cheie = '' THEN 'NULL' ELSE quote_literal(p_cheie) END || '::' || a.tip);
    ELSIF a.unic AND a.atthasdef THEN CONTINUE;
    ELSIF a.col ~ '(storage|fisier)_path$' AND a.atttypid = 'text'::regtype THEN
      v_e := quote_literal(quote_literal('test-acces/' || gen_random_uuid()) || '::text');
    ELSIF a.unic AND NOT a.fk THEN
      -- valoare nouă doar unde sursa are una (NULL nu se ciocnește într-un index unic și poate fi cerut de un CHECK de pereche)
      v_e := quote_literal(coalesce(pg_temp.t_val_sint(p_rel, a.col, a.atttypid, a.tip, true), 'NULL'));
      IF p_src IS NOT NULL THEN v_e := format('CASE WHEN s.%I IS NULL THEN %L ELSE %s END', a.col, 'NULL::' || a.tip, v_e);
      ELSIF NOT a.attnotnull THEN CONTINUE; END IF;
    ELSIF p_src IS NOT NULL THEN v_e := format('quote_nullable(s.%I::text) || %L', a.col, '::' || a.tip);
    ELSIF a.atthasdef OR NOT a.attnotnull THEN CONTINUE;
    ELSE v_e := quote_literal(coalesce(pg_temp.t_val_sint(p_rel, a.col, a.atttypid, a.tip, false), 'NULL'));
    END IF;
    v_cols := v_cols || quote_ident(a.col); v_expr := v_expr || v_e;
  END LOOP;
  IF p_src IS NOT NULL THEN
    EXECUTE format('SELECT array_to_string(ARRAY[%s], %L) FROM %s s WHERE s.ctid = %L::tid', array_to_string(v_expr, ', '), ', ', p_rel::regclass, p_src) INTO v_vals;
  ELSE
    EXECUTE format('SELECT array_to_string(ARRAY[%s]::text[], %L)', array_to_string(v_expr, ', '), ', ') INTO v_vals;
  END IF;
  RETURN format('INSERT INTO %s (%s) VALUES (%s)', p_rel::regclass, array_to_string(v_cols, ', '), v_vals);
END $h$;
-- un obiect de probă în Storage (ca postgres), cu proprietarul dat dacă tabelul are owner_id
CREATE FUNCTION pg_temp.t_obiect_nou(p_bucket text, p_name text, p_owner uuid) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = p_bucket AND name = p_name) THEN RETURN 'OK exista'; END IF;
  IF p_owner IS NOT NULL AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'storage.objects'::regclass AND attname = 'owner_id' AND NOT attisdropped) THEN
    RETURN pg_temp.t_stare(format('INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES (%L, %L, %L)', p_bucket, p_name, p_owner));
  END IF;
  RETURN pg_temp.t_stare(format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', p_bucket, p_name));
END $h$;

-- ── T0c: identități, proiecte, drepturi rescrise în tranzacție, date fictive + rânduri de probă (ca postgres) ──
CREATE TEMP TABLE t_most (tabel text, n integer, ctid_txt text, val_ins text, PRIMARY KEY (tabel, n));
CREATE TEMP TABLE t_ins_sql (tabel text, n integer, sql text, PRIMARY KEY (tabel, n));
CREATE TEMP TABLE t_proba_motiv (tabel text, n integer, motiv text, PRIMARY KEY (tabel, n));
CREATE TEMP TABLE t_ib (k text PRIMARY KEY, id bigint, cale text, motiv text);
CREATE TEMP TABLE t_up (k text PRIMARY KEY, n integer, sql text);
GRANT SELECT ON t_most, t_ins_sql, t_ib, t_up TO authenticated, anon, service_role;
DO $t$
DECLARE own uuid; ids uuid[]; pr bigint[]; v_cols text; p3 bigint; n integer; j integer; r record; v_ct text; v_val text; v_src text;
  v_are boolean; v_trecere integer; n_probe integer := 0; v_sql text; v_site bigint;
  u1 bigint; u3 bigint; s1 bigint; s3 bigint; si1 bigint; a1 bigint; d1 bigint;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'T0 FAIL: rulează ca postgres'; END IF;
  SELECT id INTO own FROM public.profiles WHERE is_owner IS TRUE ORDER BY id LIMIT 1;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 3) q;
  -- proiectele: cele mai multe tabele acoperite cu date (ca testul să aibă rânduri de comparat), apoi după id
  CREATE TEMP TABLE t_acop (proiect bigint, tabel text) ON COMMIT DROP;
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil', 'drept') LOOP
    EXECUTE format('INSERT INTO t_acop SELECT DISTINCT (%s)::bigint, %L FROM %s t WHERE (%s) IS NOT NULL', r.expr, r.nume, r.rel::regclass, r.expr);
  END LOOP;
  SELECT array_agg(id ORDER BY k DESC, id) INTO pr FROM (
    SELECT e.id, (SELECT count(DISTINCT a.tabel) FROM t_acop a WHERE a.proiect = e.id) AS k FROM public.executie_proiecte e
     ORDER BY 2 DESC, 1 LIMIT 3) q;
  IF own IS NULL OR coalesce(array_length(ids, 1), 0) < 3 OR coalesce(array_length(pr, 1), 0) < 2 THEN
    RAISE EXCEPTION 'T0 FAIL: identități / proiecte insuficiente';
  END IF;
  IF array_length(pr, 1) = 2 THEN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name <> 'id' AND is_identity = 'NO' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO public.executie_proiecte (%s) SELECT %s FROM public.executie_proiecte WHERE id = $1 RETURNING id', v_cols, v_cols)
      INTO p3 USING pr[1];
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name = 'cod_intern') THEN
      EXECUTE 'UPDATE public.executie_proiecte SET cod_intern = ''TEST-ACCES-3'' WHERE id = $1' USING p3;
    END IF;
    pr := pr || p3;
  END IF;
  -- ordinea: p1 = cel mai acoperit, p3 = al doilea (ambele cu date), p2 = al treilea
  pr := ARRAY[pr[1], pr[3], pr[2]];
  PERFORM set_config('tacc.own', own::text, true);
  PERFORM set_config('tacc.a', ids[1]::text, true);
  PERFORM set_config('tacc.b', ids[2]::text, true);
  PERFORM set_config('tacc.c', ids[3]::text, true);
  FOR n IN 1..3 LOOP PERFORM set_config('tacc.p' || n, pr[n]::text, true); END LOOP;
  DELETE FROM public.user_module_access WHERE profile_id = ANY (ids) AND module = 'executie';
  INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (ids[1], 'executie', 'editor'), (ids[2], 'executie', 'editor'), (ids[3], 'executie', 'viewer');
  -- date fictive: unități (tabel vechi) + o sudură pe nod (tabel nou, 20261201a) pe p1 și p3
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (pr[1], 'tronson', 'T-ACC1', 'Unitate test acces 1', 991, true) RETURNING id INTO u1;
  INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) VALUES (pr[3], 'tronson', 'T-ACC3', 'Unitate test acces 3', 991, true) RETURNING id INTO u3;
  INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod) VALUES (pr[1], 'NOD-TEST-ACCES', 'TA-1') RETURNING id INTO s1;
  INSERT INTO public.executie_noduri_suduri (proiect_id, nod_cod, cod) VALUES (pr[3], 'NOD-TEST-ACCES', 'TA-3') RETURNING id INTO s3;
  PERFORM set_config('tacc.u1', u1::text, true); PERFORM set_config('tacc.u3', u3::text, true);
  PERFORM set_config('tacc.s1', s1::text, true); PERFORM set_config('tacc.s3', s3::text, true);
  -- raportul zilnic: un șantier pe fiecare proiect + unul FĂRĂ proiect (cele existente sau copii fictive); B șef pe toate patru
  FOREACH n IN ARRAY ARRAY[1, 2, 3, 0] LOOP
    SELECT id INTO si1 FROM public.sites WHERE proiect_id IS NOT DISTINCT FROM CASE WHEN n > 0 THEN pr[n] END ORDER BY id LIMIT 1;
    IF si1 IS NULL THEN
      SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sites' AND column_name NOT IN ('id', 'proiect_id') AND is_identity = 'NO' AND is_generated = 'NEVER';
      EXECUTE format('INSERT INTO public.sites (%s, proiect_id) SELECT %s, $1 FROM public.sites ORDER BY id LIMIT 1 RETURNING id', v_cols, v_cols)
        INTO si1 USING CASE WHEN n > 0 THEN pr[n] END;
    END IF;
    PERFORM set_config('tacc.site' || n, si1::text, true);
    INSERT INTO public.profile_sites (profile_id, site_id, valid_until) VALUES (ids[2], si1, NULL) ON CONFLICT DO NOTHING;
    UPDATE public.profile_sites SET valid_until = NULL WHERE profile_id = ids[2] AND site_id = si1;
    si1 := NULL;
  END LOOP;
  -- Inboxul AI decide azi după alocarea pe șantierul PROIECTULUI (executie_proiecte.site_id): B alocat pe șantierul fiecăruia
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name = 'site_id') THEN
    FOR n IN 1..3 LOOP
      EXECUTE 'UPDATE public.executie_proiecte SET site_id = $1 WHERE id = $2 AND site_id IS NULL' USING pg_temp.t_g('site' || n)::bigint, pr[n];
      EXECUTE 'SELECT site_id::bigint FROM public.executie_proiecte WHERE id = $1' INTO v_site USING pr[n];
      INSERT INTO public.profile_sites (profile_id, site_id, valid_until) VALUES (ids[2], v_site, NULL) ON CONFLICT DO NOTHING;
      UPDATE public.profile_sites SET valid_until = NULL WHERE profile_id = ids[2] AND site_id = v_site;
    END LOOP;
  ELSE PERFORM pg_temp.t_neprobat('Inbox AI: executie_proiecte.site_id lipsește (regula de azi a Inboxului nu se poate reproduce)'); END IF;
  SELECT id INTO a1 FROM public.proiect_activitati WHERE proiect_id = pr[1] AND coalesce(tip_raportare, 'cantitate') <> 'bifa' AND sursa_executat = 'raport' ORDER BY id LIMIT 1;
  IF a1 IS NULL THEN
    INSERT INTO public.proiect_activitati (proiect_id, nume, um, activ) VALUES (pr[1], 'Activitate test acces', 'm', true) RETURNING id INTO a1;
  END IF;
  PERFORM set_config('tacc.a1', a1::text, true);
  -- coada de repartizat: un mesaj fictiv cu candidați p1 + p3 (etichetele fictive doar dacă lipsesc)
  UPDATE public.executie_proiecte SET eticheta_gmail = 'test-acces-' || id WHERE id IN (pr[1], pr[3]) AND eticheta_gmail IS NULL;
  INSERT INTO public.documente_de_repartizat (gmail_message_id, nume_fisier, storage_path, candidati)
  SELECT 'TEST-ACCES-1', 'test.pdf', '_de_repartizat/test/test.pdf', ARRAY[(SELECT eticheta_gmail FROM public.executie_proiecte WHERE id = pr[1]),
                                                                          (SELECT eticheta_gmail FROM public.executie_proiecte WHERE id = pr[3])]
  RETURNING id INTO d1;
  PERFORM set_config('tacc.d1', d1::text, true);

  -- RÂNDURI DE PROBĂ: pe fiecare tabel acoperit, unde lipsește un rând al proiectului n (și, pe tabelele „fără proiect permis”, un rând fără
  -- proiect), se creează unul; trei treceri (un părinte creat la trecerea 1 permite copilul la trecerea 2). Ce nu se poate = neprobat, cu motiv.
  FOR v_trecere IN 1..3 LOOP
    FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil', 'drept') AND col_ins IS NOT NULL
               AND rel <> 'public.executie_proiecte'::regclass ORDER BY nume LOOP
      FOREACH j IN ARRAY CASE WHEN pg_temp.t_nul_permis(r.nume) THEN ARRAY[1, 2, 3, 0] ELSE ARRAY[1, 2, 3] END LOOP
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s t WHERE (%s)::bigint IS NOT DISTINCT FROM $1)', r.rel::regclass, r.expr)
          INTO v_are USING CASE WHEN j > 0 THEN pr[j] END;
        IF v_are THEN DELETE FROM t_proba_motiv m WHERE m.tabel = r.nume AND m.n = j; CONTINUE; END IF;
        v_val := pg_temp.t_cheie_proba(r.nume, j);
        IF v_val IS NULL THEN v_ct := 'fără părinte ' || CASE WHEN j = 0 THEN 'fără proiect' ELSE 'pe p' || j END;
        ELSE
          EXECUTE format('SELECT t.ctid::text FROM %s t ORDER BY ((%s) IS NULL), t.ctid LIMIT 1', r.rel::regclass, r.expr) INTO v_src;
          v_ct := pg_temp.t_stare(pg_temp.t_sql_proba(r.rel, r.col_ins, v_val, v_src));
          IF v_ct = 'OK 1' THEN n_probe := n_probe + 1; END IF;
        END IF;
        INSERT INTO t_proba_motiv VALUES (r.nume, j, v_ct) ON CONFLICT ON CONSTRAINT t_proba_motiv_pkey DO UPDATE SET motiv = EXCLUDED.motiv;
      END LOOP;
    END LOOP;
  END LOOP;
  -- ce a rămas fără rând de probă (cu motivul ultimei încercări)
  FOR r IN SELECT m.* FROM t_proba_motiv m WHERE m.motiv <> 'OK 1' ORDER BY m.tabel, m.n LOOP
    PERFORM pg_temp.t_neprobat(format('rând de probă %s %s: %s', r.tabel, CASE WHEN r.n = 0 THEN 'fără proiect' ELSE 'p' || r.n END, left(r.motiv, 140)));
  END LOOP;

  -- proiectul FIECĂRUI rând al lui p1 / p2 / p3 (0 = fără proiect, doar pe tabelele unde rândul fără proiect rămâne vizibil), calculat ca
  -- postgres (fără RLS: altfel un părinte ascuns ar ascunde și un copil vizibil, adică exact scurgerea căutată), legat de rând prin ctid
  -- (stabil în tranzacție: DDL-ul migrării nu rescrie tabelele)
  CREATE TEMP TABLE t_rand (tabel text, ct tid, n integer);
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil', 'drept') LOOP
    EXECUTE format('INSERT INTO t_rand SELECT %L, t.ctid, CASE WHEN (%s) IS NULL THEN 0 ELSE CASE (%s)::bigint WHEN $1 THEN 1 WHEN $2 THEN 2 WHEN $3 THEN 3 END END
                      FROM %s t WHERE (%s)::bigint IN ($1, $2, $3) OR ($4 AND (%s) IS NULL)',
                   r.nume, r.expr, r.expr, r.rel::regclass, r.expr, r.expr) USING pr[1], pr[2], pr[3], pg_temp.t_nul_permis(r.nume);
  END LOOP;
  CREATE INDEX ON t_rand (tabel, ct);
  -- mostrele: un rând existent pe fiecare proiect, pe fiecare tabel acoperit (+ valoarea cheii)
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil', 'drept') AND col_upd IS NOT NULL LOOP
    FOR n IN 1..3 LOOP
      EXECUTE format('SELECT t.ctid::text AS ct, %s::text AS v FROM %s t JOIN t_rand q ON q.tabel = %L AND q.ct = t.ctid AND q.n = $1 ORDER BY t.ctid LIMIT 1',
                     CASE WHEN r.col_ins IS NULL THEN 'NULL' ELSE 't.' || quote_ident(r.col_ins) END, r.rel::regclass, r.nume)
        INTO v_ct, v_val USING n;
      IF v_ct IS NOT NULL THEN INSERT INTO t_most VALUES (r.nume, n, v_ct, v_val); END IF;
    END LOOP;
  END LOOP;
  -- INSERT-ul COMPLET de probă pe fiecare tabel G și proiect (copie a unui rând al aceluiași proiect, cu valori unice noi), rulat apoi
  -- ca fiecare cont pe REST și pe calea DEFINER (scris efectiv, apoi anulat)
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil') AND col_ins IS NOT NULL
             AND rel <> 'public.executie_proiecte'::regclass LOOP
    FOR n IN 1..3 LOOP
      v_val := pg_temp.t_cheie_proba(r.nume, n);
      CONTINUE WHEN v_val IS NULL;
      EXECUTE format('SELECT t.ctid::text FROM %s t ORDER BY ((%s)::bigint IS DISTINCT FROM $1), t.ctid LIMIT 1', r.rel::regclass, r.expr) INTO v_src USING pr[n];
      INSERT INTO t_ins_sql VALUES (r.nume, n, pg_temp.t_sql_proba(r.rel, r.col_ins, v_val, v_src));
    END LOOP;
  END LOOP;

  -- Storage: obiecte de probă pe căile canonice ale lui p1 și p3 (+ cele existente, găsite din tabel / cale), ca postgres
  FOREACH j IN ARRAY ARRAY[1, 3] LOOP
    v_ct := pg_temp.t_obiect_nou('executie-contracte', pr[j] || '/test-acces/proba-' || j || '.pdf', NULL);
    IF v_ct NOT LIKE 'OK %' THEN PERFORM pg_temp.t_neprobat('obiect de probă executie-contracte p' || j || ': ' || left(v_ct, 120)); END IF;
    v_ct := pg_temp.t_obiect_nou('executie-borderouri', 'sl_' || pr[j] || '/test-acces-' || j || '.xls', NULL);
    IF v_ct NOT LIKE 'OK %' THEN PERFORM pg_temp.t_neprobat('obiect de probă executie-borderouri p' || j || ': ' || left(v_ct, 120)); END IF;
    SELECT l.id::text INTO v_val FROM public.executie_pachete_lansare l WHERE l.proiect_id = pr[j] ORDER BY l.id LIMIT 1;
    IF v_val IS NOT NULL THEN
      v_ct := pg_temp.t_obiect_nou('executie-pachete-pdf', v_val || '/test-acces-' || j || '.pdf', NULL);
      IF v_ct NOT LIKE 'OK %' THEN PERFORM pg_temp.t_neprobat('obiect de probă executie-pachete-pdf p' || j || ': ' || left(v_ct, 120)); END IF;
    END IF;
    -- documente-proiect: calea unui rând al proiectului pe care nu o mai folosește alt proiect
    SELECT d.storage_path INTO v_val FROM public.documente_proiect d
     WHERE d.proiect_id = pr[j] AND NOT EXISTS (SELECT 1 FROM public.documente_proiect d2 WHERE d2.storage_path = d.storage_path AND d2.proiect_id IS DISTINCT FROM pr[j])
     ORDER BY d.id LIMIT 1;
    IF v_val IS NOT NULL THEN
      v_ct := pg_temp.t_obiect_nou('documente-proiect', v_val, NULL);
      IF v_ct NOT LIKE 'OK %' THEN PERFORM pg_temp.t_neprobat('obiect de probă documente-proiect p' || j || ': ' || left(v_ct, 120)); END IF;
    ELSE PERFORM pg_temp.t_neprobat('obiect de probă documente-proiect p' || j || ': niciun document propriu'); END IF;
  END LOOP;
  CREATE TEMP TABLE t_obj AS
  SELECT DISTINCT ON (b, k) b AS bucket, k AS n, o AS nume FROM (
    SELECT 'documente-proiect' AS b, k, d.storage_path AS o FROM unnest(ARRAY[1, 3]) k
      JOIN public.documente_proiect d ON d.proiect_id = pr[k]
     WHERE EXISTS (SELECT 1 FROM storage.objects s WHERE s.bucket_id = 'documente-proiect' AND s.name = d.storage_path)
       AND NOT EXISTS (SELECT 1 FROM public.documente_proiect d2 WHERE d2.storage_path = d.storage_path AND d2.proiect_id IS DISTINCT FROM pr[k])
    UNION ALL
    SELECT 'executie-pachete-pdf', k, s.name FROM unnest(ARRAY[1, 3]) k
      JOIN public.executie_pachete_lansare l ON l.proiect_id = pr[k]
      JOIN storage.objects s ON s.bucket_id = 'executie-pachete-pdf' AND split_part(s.name, '/', 1) = l.id::text
    UNION ALL
    SELECT 'executie-contracte', k, s.name FROM unnest(ARRAY[1, 3]) k
      JOIN storage.objects s ON s.bucket_id = 'executie-contracte' AND split_part(s.name, '/', 1) = pr[k]::text
    UNION ALL
    SELECT 'executie-borderouri', k, s.name FROM unnest(ARRAY[1, 3]) k
      JOIN storage.objects s ON s.bucket_id = 'executie-borderouri' AND split_part(s.name, '/', 1) = 'sl_' || pr[k]
  ) q ORDER BY b, k, o;
  -- încărcările de probă (ca B): p1 = legitim, p3 / cale necunoscută = refuz
  INSERT INTO t_up VALUES
    ('contracte_p1', 1, format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'executie-contracte', pr[1] || '/test-acces-b.pdf')),
    ('borderouri_p1', 1, format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'executie-borderouri', 'sl_' || pr[1] || '/test-acces-b.xls')),
    ('contracte_p3', 3, format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'executie-contracte', pr[3] || '/test-acces-b.pdf')),
    ('borderouri_p3', 3, format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'executie-borderouri', 'sl_' || pr[3] || '/test-acces-b.xls')),
    ('contracte_nou', 0, format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'executie-contracte', '_nou/test-acces/x.pdf'));

  -- Inboxul AI: rânduri de probă (copiate dintr-un rând deja clasificat — niciodată „in_asteptare”, care ar porni clasificarea) + fișierele lor
  SELECT ctid::text INTO v_src FROM public.ai_documente_inbox WHERE status IS DISTINCT FROM 'in_asteptare' ORDER BY ctid LIMIT 1;
  -- r5: 'nul_al_lui_b' = documentul lui B clasificat pentru Execuție, încă fără proiect (excepția celui care a urcat)
  -- r10: 'p1_al_lui_b' = documentul lui B pe un proiect PERMIS (cazul (c) din T3f)
  FOR r IN SELECT * FROM (VALUES ('p1', 'executie', 1, 'a'), ('p2', 'executie', 2, 'a'), ('p3', 'executie', 3, 'a'), ('p3_al_lui_b', 'executie', 3, 'b'),
                                 ('p1_al_lui_b', 'executie', 1, 'b'), ('nul_al_lui_b', 'executie', 0, 'b'), ('hr', 'hr', 0, 'a'), ('nedecis', NULL, 0, 'a')) x(k, modul, n, cine) LOOP
    v_val := pg_temp.t_g(r.cine) || '/test-acces-' || r.k || '-' || gen_random_uuid() || '.pdf';
    v_sql := pg_temp.t_sql_proba('public.ai_documente_inbox'::regclass, 'entitate_id', CASE WHEN r.n > 0 THEN pr[r.n]::text ELSE '' END, v_src,
               jsonb_build_object('modul_tinta', CASE WHEN r.modul IS NULL THEN 'NULL' ELSE quote_literal(r.modul) END || '::text',
                                  'uploadat_de', quote_literal(pg_temp.t_g(r.cine)) || '::uuid',
                                  'fisier_path', quote_literal(v_val) || '::text')
               || CASE WHEN v_src IS NULL THEN jsonb_build_object('status', '''clasificat''::text') ELSE '{}'::jsonb END);
    v_ct := pg_temp.t_stare(v_sql);
    INSERT INTO t_ib VALUES (r.k, (SELECT i.id FROM public.ai_documente_inbox i WHERE i.fisier_path = v_val), v_val, v_ct);
    IF v_ct = 'OK 1' THEN
      v_ct := pg_temp.t_obiect_nou('ai-documente-inbox', v_val, pg_temp.t_g(r.cine)::uuid);
      IF v_ct NOT LIKE 'OK %' THEN PERFORM pg_temp.t_neprobat('fișierul de probă al Inboxului (' || r.k || '): ' || left(v_ct, 120)); END IF;
    ELSE PERFORM pg_temp.t_neprobat('rând de probă în Inboxul AI (' || r.k || '): ' || left(v_ct, 140)); END IF;
  END LOOP;
  -- r10: un fișier al lui B în folderul lui, FĂRĂ rând în coadă (cazul (d) din T3f; ca după un upload al cărui rând n-a mai fost creat)
  v_val := pg_temp.t_g('b') || '/test-acces-orfan-' || gen_random_uuid() || '.pdf';
  v_ct := pg_temp.t_obiect_nou('ai-documente-inbox', v_val, pg_temp.t_g('b')::uuid);
  INSERT INTO t_ib VALUES ('orfan_al_lui_b', NULL, v_val, v_ct);
  IF v_ct NOT LIKE 'OK %' THEN PERFORM pg_temp.t_neprobat('fișierul fără rând al lui B: ' || left(v_ct, 120)); END IF;
  -- căile cazului literal din T3f: (a) inexistentă, (b) rând pe p3, (c) rând pe p1, (d) fără rând — toate în folderul lui B
  PERFORM set_config('tacc.propriu_cai', jsonb_strip_nulls(jsonb_build_object(
    'a', pg_temp.t_g('b') || '/test-acces-propriu-inexistent-' || gen_random_uuid() || '.pdf',
    'b', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'p3_al_lui_b' AND t_ib.id IS NOT NULL),
    'c', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'p1_al_lui_b' AND t_ib.id IS NOT NULL),
    'd', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'orfan_al_lui_b' AND t_ib.motiv LIKE 'OK %')))::text, true);

  -- poarta fn_executie_swap_tevi_pozitie (6b): două țevi din același pachet (cu poziție), pe p1 și pe p3, dacă există
  FOREACH n IN ARRAY ARRAY[1, 3] LOOP
    SELECT string_agg(q.id::text, ',' ORDER BY q.id) INTO v_val FROM (
      SELECT t.id FROM public.executie_tevi t
       WHERE t.poz_in_pachet IS NOT NULL
         AND t.pachet_id = (SELECT t2.pachet_id FROM public.executie_tevi t2 JOIN public.executie_pachete_lansare k2 ON k2.id = t2.pachet_id
                             WHERE k2.proiect_id = pr[n] AND t2.poz_in_pachet IS NOT NULL
                             GROUP BY t2.pachet_id HAVING count(*) >= 2 ORDER BY t2.pachet_id LIMIT 1)
       ORDER BY t.id LIMIT 2) q;
    PERFORM set_config('tacc.tevi' || n, coalesce(v_val, ''), true);
  END LOOP;
  RAISE NOTICE 'T0 OK (proiecte %, rânduri de probă create %, rânduri mapate %, mostre %, INSERT-uri de probă %, obiecte %, rânduri Inbox %, șantiere % / % / % / fără proiect %)',
    pr, n_probe, (SELECT count(*) FROM t_rand), (SELECT count(*) FROM t_most), (SELECT count(*) FROM t_ins_sql), (SELECT count(*) FROM t_obj),
    (SELECT count(*) FROM t_ib WHERE id IS NOT NULL), pg_temp.t_g('site1'), pg_temp.t_g('site2'), pg_temp.t_g('site3'), pg_temp.t_g('site0');
END $t$;
GRANT SELECT ON t_rand, t_obj TO authenticated, anon, service_role;

-- ce vede apelantul curent (prin RLS), pe fiecare tabel testat: [p1, p2, p3, fără proiect] (proiectul rândului = t_rand)
CREATE FUNCTION pg_temp.t_vede() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE r record; v jsonb := '{}'::jsonb; n1 bigint; n2 bigint; n3 bigint; n0 bigint;
BEGIN
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil', 'drept') ORDER BY nume LOOP
    IF NOT has_table_privilege(r.rel, 'SELECT') THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FILTER (WHERE q.n = 1), count(*) FILTER (WHERE q.n = 2), count(*) FILTER (WHERE q.n = 3), count(*) FILTER (WHERE q.n = 0)
                      FROM %s t JOIN t_rand q ON q.tabel = %L AND q.ct = t.ctid', r.rel::regclass, r.nume)
      INTO n1, n2, n3, n0;
    v := v || jsonb_build_object(r.nume, jsonb_build_array(n1, n2, n3, n0));
  END LOOP;
  RETURN v;
END $h$;
-- scrierea „fără efect” (col = col) pe mostra proiectului n, pe calea dată ('rest' / 'definer'): rândul se scrie efectiv, apoi se anulează
CREATE FUNCTION pg_temp.t_scrie(p_tabel text, p_n integer, p_cale text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r record; m record; v_sql text;
BEGIN
  SELECT * INTO r FROM t_tab WHERE nume = p_tabel;
  SELECT * INTO m FROM t_most WHERE tabel = p_tabel AND n = p_n;
  IF m IS NULL OR r.col_upd IS NULL THEN RETURN NULL; END IF;
  v_sql := format('UPDATE %s SET %I = %I WHERE ctid = %L::tid', r.rel::regclass, r.col_upd, r.col_upd, m.ctid_txt);
  RETURN CASE p_cale WHEN 'definer' THEN pg_temp.t_proba_definer(v_sql) ELSE pg_temp.t_proba(v_sql) END;
END $h$;
-- INSERT-ul COMPLET de probă pe proiectul n (t_ins_sql), pe calea dată; scris efectiv, apoi anulat
CREATE FUNCTION pg_temp.t_ins(p_tabel text, p_n integer, p_cale text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE v_sql text;
BEGIN
  SELECT sql INTO v_sql FROM t_ins_sql WHERE tabel = p_tabel AND n = p_n;
  IF v_sql IS NULL THEN RETURN NULL; END IF;
  RETURN CASE p_cale WHEN 'definer' THEN pg_temp.t_proba_definer(v_sql) ELSE pg_temp.t_proba(v_sql) END;
END $h$;
-- obiectele de test (t_obj, alese ca postgres) văzute de apelantul curent prin politicile Storage
CREATE FUNCTION pg_temp.t_vede_obiecte() RETURNS jsonb LANGUAGE sql STABLE AS $h$
  SELECT coalesce(jsonb_object_agg(o.bucket || ':' || o.n, (SELECT count(*) FROM storage.objects s WHERE s.bucket_id = o.bucket AND s.name = o.nume)), '{}'::jsonb)
    FROM t_obj o
$h$;
-- Inboxul AI, pe fiecare rând de probă: rândul văzut, fișierul văzut, scrierea fără efect pe REST și pe calea DEFINER, ștergerea
-- fișierului (REST; scrisă efectiv, apoi anulată)
CREATE FUNCTION pg_temp.t_inbox_stare() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE r record; v jsonb := '{}'::jsonb; v_col text := coalesce((SELECT col_upd FROM t_tab WHERE nume = 'ai_documente_inbox'), 'id'); v_sql text;
BEGIN
  FOR r IN SELECT * FROM t_ib WHERE id IS NOT NULL ORDER BY k LOOP
    v_sql := format('UPDATE public.ai_documente_inbox SET %I = %I WHERE id = %s', v_col, v_col, r.id);
    v := v || jsonb_build_object(r.k, jsonb_build_object(
      'vede', (SELECT count(*) FROM public.ai_documente_inbox i WHERE i.id = r.id),
      'obiect', (SELECT count(*) FROM storage.objects s WHERE s.bucket_id = 'ai-documente-inbox' AND s.name = r.cale),
      'sterge_obiect', pg_temp.t_norm(pg_temp.t_proba(format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'ai-documente-inbox', r.cale))),
      'scrie', pg_temp.t_norm(pg_temp.t_proba(v_sql)), 'definer', pg_temp.t_norm(pg_temp.t_proba_definer(v_sql))));
  END LOOP;
  RETURN v;
END $h$;
-- r10 (T3f): folderul propriu, pe fiecare cale a cazului literal (tacc.propriu_cai), ca apelantul curent: rândul din coadă văzut, obiectul
-- văzut, ștergerea, modificarea (UPDATE fără efect), încărcarea pe aceeași cale (INSERT, ca storage-api: owner_id = contul) și
-- „reurcarea” (ștergere + încărcare pe aceeași cale, garda 4d din 20261103c). Totul scris efectiv, apoi anulat.
CREATE FUNCTION pg_temp.t_propriu() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE c jsonb := coalesce(pg_temp.t_g('propriu_cai'), '{}')::jsonb; k text; p text; v jsonb := '{}'::jsonb;
  v_del text; v_ins text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(c) LOOP
    p := c->>k;
    v_del := format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'ai-documente-inbox', p);
    v_ins := format('INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES (%L, %L, %L)', 'ai-documente-inbox', p, auth.uid()::text);
    v := v || jsonb_build_object(k, jsonb_build_object(
      'rand', (SELECT count(*) FROM public.ai_documente_inbox i WHERE i.fisier_path = p),
      'citeste', (SELECT count(*) FROM storage.objects s WHERE s.bucket_id = 'ai-documente-inbox' AND s.name = p),
      'sterge', pg_temp.t_norm(pg_temp.t_proba(v_del)),
      'modifica', pg_temp.t_norm(pg_temp.t_proba(format('UPDATE storage.objects SET name = name WHERE bucket_id = %L AND name = %L', 'ai-documente-inbox', p))),
      'urca', pg_temp.t_norm(pg_temp.t_proba(v_ins)),
      'reurca', pg_temp.t_norm(pg_temp.t_proba(format('DO $d$ BEGIN %s; %s; END $d$', v_del, v_ins)))));
  END LOOP;
  RETURN v;
END $h$;
-- un refuz în amprentă: SQLSTATE-ul rămâne exact, cifrele din MESAJ (id-uri din secvențe, ore) nu fac parte din comparație; 'OK n' exact
CREATE FUNCTION pg_temp.t_norm(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $h$
  SELECT CASE WHEN p IS NULL OR p LIKE 'OK %' OR position(' ' IN p) = 0 THEN p
              ELSE split_part(p, ' ', 1) || ' ' || regexp_replace(substr(p, position(' ' IN p) + 1), '[0-9]+', '#', 'g') END
$h$;
-- AMPRENTA apelantului curent: tot ce vede și tot ce poate scrie, pe toate probele
CREATE FUNCTION pg_temp.t_amprenta() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE r record; j integer; sr jsonb := '{}'::jsonb; sd jsonb := '{}'::jsonb; ir jsonb := '{}'::jsonb; idf jsonb := '{}'::jsonb; up jsonb := '{}'::jsonb; u record;
BEGIN
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil') ORDER BY nume LOOP
    FOR j IN 1..3 LOOP
      sr := sr || jsonb_build_object(r.nume || ':' || j, pg_temp.t_norm(pg_temp.t_scrie(r.nume, j, 'rest')));
      sd := sd || jsonb_build_object(r.nume || ':' || j, pg_temp.t_norm(pg_temp.t_scrie(r.nume, j, 'definer')));
      ir := ir || jsonb_build_object(r.nume || ':' || j, pg_temp.t_norm(pg_temp.t_ins(r.nume, j, 'rest')));
      idf := idf || jsonb_build_object(r.nume || ':' || j, pg_temp.t_norm(pg_temp.t_ins(r.nume, j, 'definer')));
    END LOOP;
  END LOOP;
  FOR u IN SELECT * FROM t_up ORDER BY t_up.k LOOP up := up || jsonb_build_object(u.k, pg_temp.t_norm(pg_temp.t_proba(u.sql))); END LOOP;
  RETURN jsonb_build_object('vede', pg_temp.t_vede(), 'obiecte', pg_temp.t_vede_obiecte(), 'scrie', sr, 'scrie_definer', sd,
                            'insert', ir, 'insert_definer', idf, 'inbox', pg_temp.t_inbox_stare(), 'upload', up);
END $h$;
-- salvarea raportului zilnic pe un șantier, DOAR antetul (p_linii = NULL, p_distributie = NULL) sau cu o linie; verifică și ce s-a scris
CREATE FUNCTION pg_temp.t_raport_salveaza(p_site text, p_cu_linie boolean) RETURNS text LANGUAGE plpgsql AS $h$
BEGIN
  RETURN pg_temp.t_proba(format($q$DO $d$ DECLARE r jsonb; BEGIN
         r := public.fn_raport_zilnic_salveaza(%s, DATE '2001-01-01', '{"probleme": "test antet acces"}'::jsonb, %s, NULL, 0, gen_random_uuid());
         IF r->>'ok' IS DISTINCT FROM 'true'
            OR NOT EXISTS (SELECT 1 FROM public.rapoarte_zilnice z WHERE z.id = (r->>'raport_id')::bigint AND z.probleme = 'test antet acces')
            OR (%L AND NOT EXISTS (SELECT 1 FROM public.raport_lucrari l WHERE l.raport_id = (r->>'raport_id')::bigint AND l.activitate_id = %s)) THEN
           RAISE EXCEPTION 'salvare: %%', r;
         END IF;
       END $d$;$q$, p_site,
       CASE WHEN p_cu_linie THEN format('jsonb_build_array(jsonb_build_object(%L, %s, %L, NULL, %L, 1))', 'activitate_id', pg_temp.t_g('a1'), 'unitate_id', 'cantitate') ELSE 'NULL' END,
       p_cu_linie, pg_temp.t_g('a1')));
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_ca(uuid, text), pg_temp.t_g(text), pg_temp.t_proba(text), pg_temp.t_proba_definer(text), pg_temp.t_stare(text),
  pg_temp.t_e_garda(text), pg_temp.t_e_rls(text), pg_temp.t_eroare(text, text, text, text, text, text), pg_temp.t_neprobat(text),
  pg_temp.t_seteaza(text, boolean, jsonb, jsonb), pg_temp.t_lista(text), pg_temp.t_nul_permis(text), pg_temp.t_dif(jsonb, jsonb),
  pg_temp.t_vede(), pg_temp.t_scrie(text, integer, text), pg_temp.t_ins(text, integer, text), pg_temp.t_vede_obiecte(), pg_temp.t_inbox_stare(),
  pg_temp.t_norm(text), pg_temp.t_amprenta(), pg_temp.t_raport_salveaza(text, boolean), pg_temp.t_propriu()
  TO authenticated, anon, service_role;

-- ── TB: ÎNAINTE de migrare, ca fiecare cont (RLS-ul de azi): amprenta completă; raportul zilnic ──
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT length(set_config('tacc.ma0', pg_temp.t_amprenta()::text, true)) AS amprenta_a;
-- r5: mesajul de azi al schimbului de țevi pentru o țeavă inexistentă (referința lui T4, nu un tipar ghicit)
SELECT set_config('tacc.swap0', pg_temp.t_norm(pg_temp.t_proba('SELECT public.fn_executie_swap_tevi_pozitie(-1, -2)')), true);
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
SELECT length(set_config('tacc.mc0', pg_temp.t_amprenta()::text, true)) AS amprenta_c;
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
SELECT length(set_config('tacc.mo0', pg_temp.t_amprenta()::text, true)) AS amprenta_owner;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT length(set_config('tacc.mb0', pg_temp.t_amprenta()::text, true)) AS amprenta_b;
-- r10: folderul propriu al lui B, cazul literal (referința „înainte” a lui T3f)
SELECT length(set_config('tacc.pb0', pg_temp.t_propriu()::text, true)) AS propriu_b;
SELECT set_config('tacc.rb0', pg_temp.t_proba(format('SELECT public.fn_raport_zilnic_citeste(%s, DATE %L)', pg_temp.t_g('site3'), '2001-01-01')), true);
SELECT set_config('tacc.rh2', pg_temp.t_raport_salveaza(pg_temp.t_g('site2'), false), true);
SELECT set_config('tacc.rh1', pg_temp.t_raport_salveaza(pg_temp.t_g('site1'), false), true);
SELECT set_config('tacc.rh0', pg_temp.t_raport_salveaza(pg_temp.t_g('site0'), false), true);
-- r5: UPDATE-ul direct al antetelor pe șantierul lui p2, pe REST și pe calea DEFINER (referința lui T3r)
SELECT set_config('tacc.ru2', pg_temp.t_proba(format('UPDATE public.rapoarte_zilnice SET probleme = probleme WHERE site_id = %s', pg_temp.t_g('site2'))), true);
SELECT set_config('tacc.ru2d', pg_temp.t_proba_definer(format('UPDATE public.rapoarte_zilnice SET probleme = probleme WHERE site_id = %s', pg_temp.t_g('site2'))), true);
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('tacc.pol0', (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', polrelid::regclass, polname, polpermissive, polroles,
                                                                       coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')), ';'
                                                                ORDER BY polrelid::regclass::text, polname), ''))
                                  FROM pg_policy WHERE polrelid IN (SELECT rel FROM t_tab) OR polrelid = 'storage.objects'::regclass), true);
DO $t$ BEGIN
  IF pg_temp.t_g('rb0') NOT LIKE 'OK %' THEN RAISE EXCEPTION 'TB FAIL: B nu putea citi raportul șantierului p3 înainte (%): testul n-ar dovedi nimic', pg_temp.t_g('rb0'); END IF;
  IF pg_temp.t_g('rh2') NOT LIKE 'OK %' THEN
    RAISE EXCEPTION 'TB FAIL: B nu putea salva antetul raportului pe șantierul lui p2 înainte (%): refuzul de după n-ar dovedi nimic', pg_temp.t_g('rh2');
  END IF;
  RAISE NOTICE 'TB OK (B: % tabele văzute, % obiecte de test, % rânduri Inbox; antet p1 %, fără proiect %)',
    (SELECT count(*) FROM jsonb_object_keys(pg_temp.t_g('mb0')::jsonb->'vede')), (SELECT count(*) FROM jsonb_object_keys(pg_temp.t_g('mb0')::jsonb->'obiecte')),
    (SELECT count(*) FROM jsonb_object_keys(pg_temp.t_g('mb0')::jsonb->'inbox')), pg_temp.t_g('rh1'), pg_temp.t_g('rh0');
END $t$;

SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);
\ir ../supabase/migrations/20261209a_executie_acces_proiect.sql

-- ── T1: după migrare, fără niciun rând = comportamentul de azi: amprenta FIECĂRUI cont identică (A, B, C, owner); politicile vechi neatinse ──
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN RAISE EXCEPTION 'T1 FAIL: tabelul nou are date'; END IF;
  IF (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', polrelid::regclass, polname, polpermissive, polroles,
                                            coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')), ';'
                                     ORDER BY polrelid::regclass::text, polname), ''))
        FROM pg_policy WHERE (polrelid IN (SELECT rel FROM t_tab) OR polrelid = 'storage.objects'::regclass) AND polname NOT LIKE 'executie\_acces\_%')
     IS DISTINCT FROM pg_temp.t_g('pol0') THEN
    RAISE EXCEPTION 'T1 FAIL: politicile vechi ale tabelelor testate / Storage s-au schimbat';
  END IF;
  -- inventarul real al migrării = cel citit în T0a
  IF (SELECT count(*) FROM public.fn_executie_acces_inventar() i FULL JOIN t_inv t ON (t.tip, t.obiect, t.clasa) = (i.tip, i.obiect, i.clasa)
       WHERE i.tip IS NULL OR t.tip IS NULL) <> 0 THEN
    RAISE EXCEPTION 'T1 FAIL: inventarul diferă de cel citit în T0a';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
DO $t$ DECLARE m jsonb := pg_temp.t_amprenta(); BEGIN
  IF m IS DISTINCT FROM pg_temp.t_g('ma0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: A după migrare: %', pg_temp.t_dif(m, pg_temp.t_g('ma0')::jsonb); END IF;
  IF NOT public.fn_executie_acces_nerestrans() OR NOT public.fn_executie_proiect_permis(pg_temp.t_g('p3')::bigint, true) THEN RAISE EXCEPTION 'T1 FAIL: A nu e nerestrâns'; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
DO $t$ DECLARE m jsonb := pg_temp.t_amprenta(); BEGIN
  IF m IS DISTINCT FROM pg_temp.t_g('mc0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: C după migrare: %', pg_temp.t_dif(m, pg_temp.t_g('mc0')::jsonb); END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$ DECLARE m jsonb := pg_temp.t_amprenta(); BEGIN
  IF m IS DISTINCT FROM pg_temp.t_g('mo0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: owner-ul după migrare: %', pg_temp.t_dif(m, pg_temp.t_g('mo0')::jsonb); END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$ DECLARE m jsonb := pg_temp.t_amprenta(); BEGIN
  IF m IS DISTINCT FROM pg_temp.t_g('mb0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: B după migrare (fără rânduri): %', pg_temp.t_dif(m, pg_temp.t_g('mb0')::jsonb); END IF;
  IF pg_temp.t_propriu() IS DISTINCT FROM pg_temp.t_g('pb0')::jsonb THEN RAISE EXCEPTION 'T1 FAIL: B după migrare (fără rânduri), folderul propriu: % / înainte %', pg_temp.t_propriu(), pg_temp.t_g('pb0'); END IF;
  RAISE NOTICE 'T1 OK (amprentele A / B / C / owner identice cu cele de dinainte)';
END $t$;

-- ── T2: owner-ul restrânge B (p1 editor + p2 viewer) și C (p1 editor) prin RPC ──
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb;
BEGIN
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p1:editor,p2:viewer'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'duplicat' IS DISTINCT FROM 'false' OR jsonb_array_length(r->'lista') <> 2 THEN RAISE EXCEPTION 'T2 FAIL: setarea B: %', r; END IF;
  r := pg_temp.t_seteaza('c', true, pg_temp.t_lista('p1:editor'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T2 FAIL: setarea C: %', r; END IF;
  IF (SELECT count(*) FROM public.executie_acces_proiect) <> 3
     OR EXISTS (SELECT 1 FROM public.executie_acces_proiect WHERE acordat_de IS DISTINCT FROM pg_temp.t_g('own')::uuid) THEN
    RAISE EXCEPTION 'T2 FAIL: rândurile / proveniența';
  END IF;
  RAISE NOTICE 'T2 OK';
END $t$;

-- ── T3: B citește doar p1 + p2 (exact ce vedea înainte pe ele) și nimic pe p3, pe TOATE tabelele din catalog; scrie doar pe p1, pe toate căile ──
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT length(set_config('tacc.mb1', pg_temp.t_amprenta()::text, true)) AS amprenta_b_restrans;
DO $t$
DECLARE m jsonb := pg_temp.t_g('mb1')::jsonb; m0 jsonb := pg_temp.t_g('mb0')::jsonb; v jsonb; v0 jsonb; k text; r record; x text; x0 text; c text; j integer;
  p1 bigint := pg_temp.t_g('p1')::bigint; p2 bigint := pg_temp.t_g('p2')::bigint; p3 bigint := pg_temp.t_g('p3')::bigint;
  n_cit integer := 0; n_nul integer := 0; n_scr integer := 0; n_scr_ref integer := 0; n_def_ok integer := 0; n_def integer := 0; n_ins_ok integer := 0; n_ins integer := 0;
BEGIN
  -- citire: p1 și p2 ca înainte, p3 zero; rândurile fără proiect (doar unde specificația le lasă vizibile) ca înainte
  v := m->'vede'; v0 := m0->'vede';
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF v->k->0 IS DISTINCT FROM v0->k->0 OR v->k->1 IS DISTINCT FROM v0->k->1 OR (v->k->>2)::bigint <> 0
       OR (pg_temp.t_nul_permis(k) AND v->k->3 IS DISTINCT FROM v0->k->3) THEN
      RAISE EXCEPTION 'T3 FAIL: citire pe %: după % / înainte %', k, v->k, v0->k;
    END IF;
    IF (v0->k->>0)::bigint > 0 AND (v0->k->>2)::bigint > 0 THEN n_cit := n_cit + 1;
    ELSE PERFORM pg_temp.t_neprobat('citire ' || k || ' (înainte: ' || (v0->k)::text || ')'); END IF;
    IF pg_temp.t_nul_permis(k) THEN
      IF (v0->k->>3)::bigint > 0 THEN n_nul := n_nul + 1; ELSE PERFORM pg_temp.t_neprobat('rânduri fără proiect pe ' || k || ' (niciunul vizibil înainte)'); END IF;
    END IF;
  END LOOP;
  -- regula (r8: lista e internă — B o vede pe rândurile proprii din executie_acces_proiect; T3e verifică refuzul apelului direct)
  IF public.fn_executie_acces_nerestrans()
     OR (SELECT array_agg(a.proiect_id ORDER BY a.proiect_id) FROM public.executie_acces_proiect a WHERE a.profile_id = auth.uid()) <> ARRAY[least(p1, p2), greatest(p1, p2)]
     OR NOT public.fn_executie_proiect_permis(p1, true) OR public.fn_executie_proiect_permis(p2, true) OR NOT public.fn_executie_proiect_permis(p2)
     OR public.fn_executie_proiect_permis(p3) OR public.fn_executie_proiect_permis(NULL) THEN
    RAISE EXCEPTION 'T3 FAIL: regula (nerestrans / lista / permis)';
  END IF;
  -- scrierea, pe fiecare tabel G, pe fiecare proiect, pe REST și pe calea DEFINER (UPDATE fără efect + INSERT complet). Referința = ce dădea
  -- ACEEAȘI probă înainte (L25): p1 (editor) = exact ca înainte, deci o scriere care reușea TREBUIE să reușească; p2 (viewer) și p3 = refuz cu
  -- MOTIVUL așteptat (REST: 0 rânduri la UPDATE, garda / RLS la INSERT; DEFINER: garda)
  FOR r IN SELECT * FROM t_tab WHERE clasa IN ('proiect', 'proiect_optional', 'copil') ORDER BY nume LOOP
    FOR j IN 1..3 LOOP
      c := r.nume || ':' || j;
      -- UPDATE REST
      x := m->'scrie'->>c; x0 := m0->'scrie'->>c;
      IF j = 1 THEN
        IF x0 = 'OK 1' THEN
          IF x IS DISTINCT FROM 'OK 1' THEN RAISE EXCEPTION 'T3 FAIL: scrierea legitimă pe % (p1, editor) nu mai reușește: %', r.nume, x; END IF;
          n_scr := n_scr + 1;
        ELSE PERFORM pg_temp.t_neprobat('scriere legitimă ' || r.nume || ' (înainte: ' || coalesce(x0, 'fără rând pe p1') || ')'); END IF;
      ELSIF x0 = 'OK 1' THEN
        IF x IS DISTINCT FROM 'OK 0' THEN RAISE EXCEPTION 'T3 FAIL: B scrie pe % (p%) prin REST: %', r.nume, j, x; END IF;
        n_scr_ref := n_scr_ref + 1;
      ELSIF x LIKE 'OK 1%' THEN RAISE EXCEPTION 'T3 FAIL: B scrie pe % (p%) prin REST: %', r.nume, j, x;
      END IF;
      -- UPDATE pe calea DEFINER (ocolește RLS, nu și garda)
      x := m->'scrie_definer'->>c; x0 := m0->'scrie_definer'->>c;
      IF j = 1 THEN
        IF x0 = 'OK 1' THEN
          IF x IS DISTINCT FROM 'OK 1' THEN RAISE EXCEPTION 'T3 FAIL: scrierea legitimă DEFINER pe % (p1, editor) nu mai reușește: %', r.nume, x; END IF;
          n_def_ok := n_def_ok + 1;
        ELSIF x0 IS NOT NULL THEN PERFORM pg_temp.t_neprobat('DEFINER legitim ' || r.nume || ' (înainte: ' || left(x0, 100) || ')'); END IF;
      ELSIF x0 IS NOT NULL THEN
        IF pg_temp.t_e_garda(x) THEN n_def := n_def + 1;
        ELSIF x0 = 'OK 1' OR x LIKE 'OK %' OR x LIKE '23%' THEN RAISE EXCEPTION 'T3 FAIL: calea DEFINER pe % (p%): % (înainte: %)', r.nume, j, x, x0;
        ELSE PERFORM pg_temp.t_neprobat('DEFINER ' || r.nume || ' p' || j || ': alt refuz înaintea gărzii (' || left(x, 120) || ')'); END IF;
      END IF;
      -- INSERT complet, pe ambele căi
      FOREACH k IN ARRAY ARRAY['insert', 'insert_definer'] LOOP
        x := m->k->>c; x0 := m0->k->>c;
        CONTINUE WHEN x0 IS NULL;
        IF j = 1 THEN
          IF x0 = 'OK 1' THEN
            IF x IS DISTINCT FROM 'OK 1' THEN RAISE EXCEPTION 'T3 FAIL: INSERT-ul legitim (%) pe % (p1, editor) nu mai reușește: %', k, r.nume, x; END IF;
            n_ins_ok := n_ins_ok + 1;
          ELSE PERFORM pg_temp.t_neprobat(k || ' legitim ' || r.nume || ' (înainte: ' || left(x0, 100) || ')'); END IF;
        ELSIF pg_temp.t_e_garda(x) OR (k = 'insert' AND pg_temp.t_e_rls(x)) THEN n_ins := n_ins + 1;
        ELSIF x0 = 'OK 1' OR x LIKE 'OK %' OR x LIKE '23%' THEN RAISE EXCEPTION 'T3 FAIL: % pe % (p%): % (înainte: %)', k, r.nume, j, x, x0;
        ELSE PERFORM pg_temp.t_neprobat(k || ' ' || r.nume || ' p' || j || ': alt refuz înaintea gărzii (' || left(x, 120) || ')'); END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  -- un părinte inexistent nu e „al nimănui”: pentru un cont restrâns e refuz
  FOR r IN SELECT * FROM t_inv WHERE tip = 'tabel' AND clasa = 'copil' LOOP
    x := pg_temp.t_proba_definer(format('INSERT INTO public.%I (%I) VALUES (-1)', r.obiect, r.cheie));
    IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3 FAIL: garda pe % (părinte inexistent): %', r.obiect, x; END IF;
  END LOOP;
  -- un rând FĂRĂ proiect pe un tabel strict ('proiect') nu e „al nimănui” (doar pe cele cu proiect opțional, specificația de mai sus)
  FOR r IN SELECT * FROM t_inv WHERE tip = 'tabel' AND clasa = 'proiect' AND obiect <> 'executie_proiecte' ORDER BY obiect LOOP
    x := pg_temp.t_proba_definer(format('INSERT INTO public.%I (%I) VALUES (NULL)', r.obiect, r.cheie));
    IF pg_temp.t_e_garda(x) THEN NULL;
    ELSIF x LIKE 'OK %' OR x LIKE '23%' THEN RAISE EXCEPTION 'T3 FAIL: garda pe % lasă un rând fără proiect: %', r.obiect, x;
    ELSE PERFORM pg_temp.t_neprobat('rând fără proiect pe ' || r.obiect || ': alt refuz înaintea gărzii (' || left(x, 120) || ')'); END IF;
  END LOOP;
  -- mutarea unui rând pe alt proiect, modificarea pe p1, ștergerea pe p3 (invizibil = 0 rânduri)
  IF NOT pg_temp.t_e_garda(pg_temp.t_proba(format('UPDATE public.proiect_unitati SET proiect_id = %s WHERE id = %s', p3, pg_temp.t_g('u1'))))
     OR pg_temp.t_proba(format('UPDATE public.proiect_unitati SET nume = nume || %L WHERE id = %s', ' ', pg_temp.t_g('u1'))) <> 'OK 1'
     OR pg_temp.t_proba(format('DELETE FROM public.proiect_unitati WHERE id = %s', pg_temp.t_g('u3'))) <> 'OK 0'
     OR pg_temp.t_proba(format('DELETE FROM public.executie_proiecte WHERE id = %s', p3)) <> 'OK 0' THEN
    RAISE EXCEPTION 'T3 FAIL: UPDATE / DELETE direct';
  END IF;
  -- funcțiile de drept ale tabelelor noi (RLS + RPC + Storage le folosesc)
  IF NOT public.fn_executie_nod_drept(p1, true) OR public.fn_executie_nod_drept(p2, true) OR NOT public.fn_executie_nod_drept(p2, false)
     OR public.fn_executie_nod_drept(p3, false)
     OR NOT public.fn_executie_contract_drept(p1, false) OR public.fn_executie_contract_drept(p3, false)
     OR NOT public.fn_executie_grafic_drept(p1) OR public.fn_executie_grafic_drept(p3)
     OR NOT public.fn_executie_tinte_drept(p1, 'configurare') OR public.fn_executie_tinte_drept(p2, 'configurare')
     OR NOT public.fn_executie_tinte_drept(p2, 'citire') OR public.fn_executie_tinte_drept(p3, 'citire') THEN
    RAISE EXCEPTION 'T3 FAIL: funcțiile de drept';
  END IF;
  IF public.fn_executie_nod_obiect_citire('noduri-scheme', p3 || '/NOD-TEST-ACCES/vederi.json')
     OR NOT public.fn_executie_nod_obiect_citire('noduri-scheme', p1 || '/NOD-TEST-ACCES/vederi.json') THEN
    RAISE EXCEPTION 'T3 FAIL: Storage noduri-scheme';
  END IF;
  -- RPC-ul de stare al sudurii (20261201a): p3 refuz, p1 trece (scris efectiv, apoi anulat)
  IF pg_temp.t_proba(format('SELECT public.fn_executie_nod_sudura_stare(%s, %L, 1, %L, (now() AT TIME ZONE %L)::date, %L, NULL, NULL, gen_random_uuid())',
                            pg_temp.t_g('s3'), 'de_executat', 'insailat', 'Europe/Bucharest', 'Sudor Test')) NOT LIKE '42501 %nu ai drept de scriere pe Execuție%'
     OR pg_temp.t_proba(format('SELECT public.fn_executie_nod_sudura_stare(%s, %L, 1, %L, (now() AT TIME ZONE %L)::date, %L, NULL, NULL, gen_random_uuid())',
                               pg_temp.t_g('s1'), 'de_executat', 'insailat', 'Europe/Bucharest', 'Sudor Test')) <> 'OK 1' THEN
    RAISE EXCEPTION 'T3 FAIL: RPC-ul sudurii';
  END IF;
  -- fibra optică (20261211a), dacă e aplicată: funcția ei de drept primește condiția de proiect prin fn_executie_nod_drept
  IF to_regprocedure('public.fn_executie_fibra_drept(bigint, boolean)') IS NOT NULL THEN
    IF NOT public.fn_executie_fibra_drept(p1, true) OR public.fn_executie_fibra_drept(p2, true) OR NOT public.fn_executie_fibra_drept(p2, false)
       OR public.fn_executie_fibra_drept(p3, false) THEN
      RAISE EXCEPTION 'T3 FAIL: fn_executie_fibra_drept nu urmează lista contului';
    END IF;
  ELSE PERFORM pg_temp.t_neprobat('fibra optică (20261211a) neaplicată pe această bază'); END IF;
  -- poarta fn_executie_swap_tevi_pozitie (6b): țevile lui p3 și o țeavă inexistentă = refuzul porții (înainte de orice citire / mesaj
  -- despre ele); originalul nu se poate apela direct; pe p1 schimbul reușește (scris efectiv, apoi anulat)
  x := pg_temp.t_proba('SELECT public.fn_executie_swap_tevi_pozitie(-1, -2)');
  IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3 FAIL: poarta swap, țevi inexistente: %', x; END IF;
  x := pg_temp.t_proba('SELECT executie_acces_intern.fn_executie_swap_tevi_pozitie(-1, -2)');
  IF x NOT LIKE '42501 permission denied for schema executie_acces_intern%' THEN RAISE EXCEPTION 'T3 FAIL: originalul swap se poate apela direct: %', x; END IF;
  IF pg_temp.t_g('tevi3') IS NOT NULL THEN
    x := pg_temp.t_proba(format('SELECT public.fn_executie_swap_tevi_pozitie(%s, %s)', split_part(pg_temp.t_g('tevi3'), ',', 1), split_part(pg_temp.t_g('tevi3'), ',', 2)));
    IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3 FAIL: poarta swap pe p3: %', x; END IF;
  ELSE PERFORM pg_temp.t_neprobat('swap pe p3 (nu există un pachet cu 2 țevi)'); END IF;
  IF pg_temp.t_g('tevi1') IS NOT NULL THEN
    x := pg_temp.t_proba(format('SELECT public.fn_executie_swap_tevi_pozitie(%s, %s)', split_part(pg_temp.t_g('tevi1'), ',', 1), split_part(pg_temp.t_g('tevi1'), ',', 2)));
    IF x <> 'OK 1' THEN RAISE EXCEPTION 'T3 FAIL: schimbul legitim pe p1 nu mai reușește: %', x; END IF;
    -- amestec p1 + p3: refuz
    IF pg_temp.t_g('tevi3') IS NOT NULL AND NOT pg_temp.t_e_garda(pg_temp.t_proba(format('SELECT public.fn_executie_swap_tevi_pozitie(%s, %s)',
         split_part(pg_temp.t_g('tevi1'), ',', 1), split_part(pg_temp.t_g('tevi3'), ',', 1)))) THEN
      RAISE EXCEPTION 'T3 FAIL: poarta swap, o țeavă p1 + una p3';
    END IF;
  ELSE PERFORM pg_temp.t_neprobat('swap legitim pe p1 (nu există un pachet cu 2 țevi)'); END IF;
  -- tabelul de acces: B vede doar rândurile lui; nu poate seta nimic
  IF (SELECT count(*) FROM public.executie_acces_proiect) <> 2 OR EXISTS (SELECT 1 FROM public.executie_acces_proiect WHERE profile_id <> auth.uid())
     OR pg_temp.t_proba(format('SELECT pg_temp.t_seteaza(%L, true, pg_temp.t_lista(%L), pg_temp.t_lista(%L))', 'b', 'p1:editor,p2:editor,p3:editor', 'p1:editor,p2:viewer')) NOT LIKE '42501 %doar owner-ul stabilește%'
     OR pg_temp.t_proba(format('INSERT INTO public.executie_acces_proiect (profile_id, proiect_id) VALUES (auth.uid(), %s)', p3)) NOT LIKE '42501 permission denied for table executie_acces_proiect%' THEN
    RAISE EXCEPTION 'T3 FAIL: tabelul de acces (citire / setare de către non-owner)';
  END IF;
  RAISE NOTICE 'T3 OK (citire probată pe % tabele, rânduri fără proiect pe %; UPDATE legitim REST % / DEFINER %; UPDATE refuzat REST % / DEFINER (gardă) %; INSERT legitim %, INSERT refuzat cu motivul așteptat %)',
    n_cit, n_nul, n_scr, n_def_ok, n_scr_ref, n_def, n_ins_ok, n_ins;
END $t$;

-- ── T3r: raportul zilnic (review r1 P1 + r3 P1): p3 = nici citire, nici salvare; p2 (viewer) = citire DA, salvare NU (nici doar antetul);
--   p1 (editor) și șantierul fără proiect = salvare reușită, cu antetul scris ──
DO $t$
DECLARE x text;
BEGIN
  x := pg_temp.t_proba(format('SELECT public.fn_raport_zilnic_citeste(%s, DATE %L)', pg_temp.t_g('site3'), '2001-01-01'));
  IF x NOT LIKE '42501 %nu ai drept pe șantier%' THEN RAISE EXCEPTION 'T3r FAIL: B citește raportul șantierului p3: %', x; END IF;
  x := pg_temp.t_proba(format('SELECT public.fn_raport_zilnic_salveaza(%s, DATE %L, %L::jsonb, %L::jsonb, NULL, 0, gen_random_uuid())',
                              pg_temp.t_g('site3'), '2001-01-01', '{"probleme": "test"}', '[]'));
  IF x NOT LIKE '42501 %nu ai drept pe șantier%' THEN RAISE EXCEPTION 'T3r FAIL: B salvează raportul șantierului p3: %', x; END IF;
  x := pg_temp.t_proba(format('SELECT public.fn_raport_zilnic_citeste(%s, DATE %L)', pg_temp.t_g('site1'), '2001-01-01'));
  IF x <> 'OK 1' THEN RAISE EXCEPTION 'T3r FAIL: B nu mai citește raportul șantierului p1: %', x; END IF;
  -- p2, viewer pe proiect: citește, dar NU salvează — nici doar antetul (p_linii = NULL); înainte reușea (TB), deci refuzul e al gărzii
  x := pg_temp.t_proba(format('SELECT public.fn_raport_zilnic_citeste(%s, DATE %L)', pg_temp.t_g('site2'), '2001-01-01'));
  IF x <> 'OK 1' THEN RAISE EXCEPTION 'T3r FAIL: B (viewer pe p2) nu mai citește raportul șantierului p2: %', x; END IF;
  x := pg_temp.t_raport_salveaza(pg_temp.t_g('site2'), false);
  IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3r FAIL: B (viewer pe p2) salvează antetul raportului: % (înainte: %)', x, pg_temp.t_g('rh2'); END IF;
  -- scrierea directă a antetului pe p2 (r5, L20 / L25: referința = ACEEAȘI probă înainte, TB): REST = exact 0 rânduri (politica de
  -- modificare filtrează), DEFINER = refuzul gărzii (SQLSTATE + mesaj); orice alt rezultat (altă eroare, rânduri scrise) = FAIL.
  -- Dacă înainte proba nu scria nimic, refuzul de după n-ar dovedi nimic: NEPROBAT, nu „trecut”.
  x := pg_temp.t_proba(format('UPDATE public.rapoarte_zilnice SET probleme = probleme WHERE site_id = %s', pg_temp.t_g('site2')));
  IF pg_temp.t_g('ru2') LIKE 'OK %' AND pg_temp.t_g('ru2') <> 'OK 0' THEN
    IF x IS DISTINCT FROM 'OK 0' THEN RAISE EXCEPTION 'T3r FAIL: UPDATE direct al antetului pe p2 (REST): % (înainte: %)', x, pg_temp.t_g('ru2'); END IF;
  ELSIF pg_temp.t_norm(x) IS DISTINCT FROM pg_temp.t_norm(pg_temp.t_g('ru2')) THEN
    RAISE EXCEPTION 'T3r FAIL: UPDATE direct al antetului pe p2 (REST), alt rezultat decât înainte: % (înainte: %)', x, pg_temp.t_g('ru2');
  ELSE PERFORM pg_temp.t_neprobat('UPDATE direct al antetului pe p2, REST (înainte: ' || left(coalesce(pg_temp.t_g('ru2'), 'nimic'), 100) || ')'); END IF;
  x := pg_temp.t_proba_definer(format('UPDATE public.rapoarte_zilnice SET probleme = probleme WHERE site_id = %s', pg_temp.t_g('site2')));
  IF pg_temp.t_g('ru2d') LIKE 'OK %' AND pg_temp.t_g('ru2d') <> 'OK 0' THEN
    IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3r FAIL: UPDATE direct al antetului pe p2 (DEFINER): % (înainte: %)', x, pg_temp.t_g('ru2d'); END IF;
  ELSIF x LIKE 'OK %' AND x <> 'OK 0' THEN RAISE EXCEPTION 'T3r FAIL: UPDATE direct al antetului pe p2 (DEFINER): % (înainte: %)', x, pg_temp.t_g('ru2d');
  ELSE PERFORM pg_temp.t_neprobat('UPDATE direct al antetului pe p2, DEFINER (înainte: ' || left(coalesce(pg_temp.t_g('ru2d'), 'nimic'), 100) || ')'); END IF;
  x := pg_temp.t_proba(format('INSERT INTO public.rapoarte_zilnice (site_id, data, probleme) VALUES (%s, DATE %L, %L)', pg_temp.t_g('site2'), '2001-01-02', 'test'));
  IF NOT (pg_temp.t_e_garda(x) OR pg_temp.t_e_rls(x)) THEN RAISE EXCEPTION 'T3r FAIL: B creează direct un antet de raport pe p2: %', x; END IF;
  -- p1 (editor): doar antetul, apoi antet + o linie — reușesc și scriu
  x := pg_temp.t_raport_salveaza(pg_temp.t_g('site1'), false);
  IF x NOT LIKE 'OK %' THEN RAISE EXCEPTION 'T3r FAIL: salvarea legitimă a antetului pe p1 nu reușește: %', x; END IF;
  x := pg_temp.t_raport_salveaza(pg_temp.t_g('site1'), true);
  IF x NOT LIKE 'OK %' THEN RAISE EXCEPTION 'T3r FAIL: salvarea legitimă a raportului pe p1 (cu linie) nu reușește: %', x; END IF;
  -- șantierul fără proiect: ca înainte (nu e dată de proiect)
  IF pg_temp.t_g('rh0') LIKE 'OK %' THEN
    x := pg_temp.t_raport_salveaza(pg_temp.t_g('site0'), false);
    IF x NOT LIKE 'OK %' THEN RAISE EXCEPTION 'T3r FAIL: salvarea pe șantierul fără proiect nu mai reușește: %', x; END IF;
  ELSE PERFORM pg_temp.t_neprobat('raport pe șantierul fără proiect (înainte: ' || left(pg_temp.t_g('rh0'), 100) || ')'); END IF;
  RAISE NOTICE 'T3r OK';
END $t$;

-- ── T3d: coada de repartizat + documentele proiectului (review r1 P1): B nu repartizează nimic; A (nerestrâns) repartizează efectiv ──
DO $t$
DECLARE x text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.documente_de_repartizat WHERE id = pg_temp.t_g('d1')::bigint) THEN
    RAISE EXCEPTION 'T3d FAIL: B (restrâns) vede coada comună';
  END IF;
  FOREACH x IN ARRAY ARRAY[pg_temp.t_g('p3'), pg_temp.t_g('p1')] LOOP
    x := pg_temp.t_proba(format('SELECT public.fn_doc_repartizeaza(%s, %s)', pg_temp.t_g('d1'), x));
    IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3d FAIL: B repartizează: %', x; END IF;
  END LOOP;
  x := pg_temp.t_proba(format('SELECT public.fn_doc_ignora(%s)', pg_temp.t_g('d1')));
  IF NOT pg_temp.t_e_garda(x) THEN RAISE EXCEPTION 'T3d FAIL: B ignoră un mesaj din coadă: %', x; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb;
BEGIN
  r := public.fn_doc_repartizeaza(pg_temp.t_g('d1')::bigint, pg_temp.t_g('p3')::bigint);
  IF r->>'ok' IS DISTINCT FROM 'true' OR NOT EXISTS (SELECT 1 FROM public.documente_proiect WHERE id = (r->>'document_proiect_id')::bigint AND proiect_id = pg_temp.t_g('p3')::bigint) THEN
    RAISE EXCEPTION 'T3d FAIL: repartizarea legitimă (A, nerestrâns) nu reușește: %', r;
  END IF;
  PERFORM set_config('tacc.doc3', r->>'document_proiect_id', true);
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$ BEGIN
  IF EXISTS (SELECT 1 FROM public.documente_proiect WHERE id = pg_temp.t_g('doc3')::bigint) THEN RAISE EXCEPTION 'T3d FAIL: B vede documentul repartizat pe p3'; END IF;
  RAISE NOTICE 'T3d OK';
END $t$;

-- ── T3s: Storage (review r1 P1, r3 P2): B vede obiectele p1 ca înainte, niciunul al lui p3; încărcările: p1 ca înainte, p3 / cale
--   necunoscută = refuzul POLITICII (42501 RLS), nu altă eroare; rezolvarea căilor ──
DO $t$
DECLARE m jsonb := pg_temp.t_g('mb1')::jsonb; m0 jsonb := pg_temp.t_g('mb0')::jsonb; v jsonb; v0 jsonb; k text; n integer := 0; n_up integer := 0; u record; x text; x0 text;
BEGIN
  v := m->'obiecte'; v0 := m0->'obiecte';
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF (k LIKE '%:1' AND v->k IS DISTINCT FROM v0->k) OR (k LIKE '%:3' AND (v->>k)::integer <> 0) THEN
      RAISE EXCEPTION 'T3s FAIL: obiectul % — după % / înainte %', k, v->k, v0->k;
    END IF;
    IF k LIKE '%:3' THEN
      IF (v0->>k)::integer > 0 THEN n := n + 1; ELSE PERFORM pg_temp.t_neprobat('Storage ' || k || ': obiectul lui p3 nu era vizibil nici înainte'); END IF;
    END IF;
  END LOOP;
  IF n = 0 THEN PERFORM pg_temp.t_neprobat('Storage: niciun obiect al lui p3 vizibil înainte'); END IF;
  FOR u IN SELECT * FROM t_up ORDER BY t_up.k LOOP
    x := m->'upload'->>u.k; x0 := m0->'upload'->>u.k;
    IF u.n = 1 THEN
      IF x IS DISTINCT FROM x0 THEN RAISE EXCEPTION 'T3s FAIL: încărcarea legitimă % (p1): după % / înainte %', u.k, x, x0; END IF;
      IF x0 NOT LIKE 'OK %' THEN PERFORM pg_temp.t_neprobat('încărcare legitimă ' || u.k || ' (oprită și înainte: ' || left(x0, 100) || ')'); END IF;
    ELSE
      IF NOT pg_temp.t_e_rls(x) THEN RAISE EXCEPTION 'T3s FAIL: încărcarea % — alt rezultat decât refuzul politicii: % (înainte: %)', u.k, x, x0; END IF;
      IF x0 LIKE 'OK %' THEN n_up := n_up + 1; ELSE PERFORM pg_temp.t_neprobat('încărcare ' || u.k || ': oprită și înainte (' || left(x0, 100) || ')'); END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'T3s OK (obiecte p3 probate: %, încărcări refuzate de politică după ce reușeau înainte: %)', n, n_up;
END $t$;
-- r9: rezolvarea căilor, prin predicatul PUBLIC, ca B (restrâns: p1 editor, p2 viewer) — fn_executie_acces_obiect_proiecte nu mai există.
-- Pachetul și documentul se aleg ca postgres; ca B, aceleași căi.
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('tacc.t3s_pk', coalesce((SELECT min(id)::text FROM public.executie_pachete_lansare WHERE proiect_id = pg_temp.t_g('p1')::bigint), ''), true) IS NOT NULL AS t3s_pk,
       set_config('tacc.t3s_doc3', coalesce((SELECT storage_path FROM public.documente_proiect WHERE id = pg_temp.t_g('doc3')::bigint), ''), true) IS NOT NULL AS t3s_doc3;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE p1 text := pg_temp.t_g('p1'); p2 text := pg_temp.t_g('p2'); p3 text := pg_temp.t_g('p3'); v_pk text := pg_temp.t_g('t3s_pk'); v_doc3 text := pg_temp.t_g('t3s_doc3');
BEGIN
  IF public.fn_executie_acces_obiect_permis('executie-contracte', p1 || '/docs_tehnice/x.pdf', true) IS NOT TRUE
     OR public.fn_executie_acces_obiect_permis('executie-contracte', 'pccvi/' || p1 || '/x.pdf', true) IS NOT TRUE
     OR public.fn_executie_acces_obiect_permis('executie-contracte', 'probe-presiune/' || p2 || '/x.pdf', false) IS NOT TRUE
     OR public.fn_executie_acces_obiect_permis('executie-contracte', 'probe-presiune/' || p2 || '/x.pdf', true) IS NOT FALSE
     OR public.fn_executie_acces_obiect_permis('executie-contracte', 'ordin-incepere/' || p3 || '/x.pdf', false) IS NOT FALSE
     OR public.fn_executie_acces_obiect_permis('executie-contracte', '_nou/' || p1 || '/x.pdf', false) IS NOT FALSE
     OR public.fn_executie_acces_obiect_permis('executie-contracte', p1 || '/../' || p3 || '/x.pdf', false) IS NOT FALSE
     OR public.fn_executie_acces_obiect_permis('executie-contracte', 'x' || p1 || '/y.pdf', false) IS NOT FALSE
     OR public.fn_executie_acces_obiect_permis('executie-borderouri', 'sl_' || p1 || '/1_borderou.xls', true) IS NOT TRUE
     OR public.fn_executie_acces_obiect_permis('executie-borderouri', 'sl_' || p3 || '/1_borderou.xls', false) IS NOT FALSE
     OR public.fn_executie_acces_obiect_permis('executie-borderouri', 'x/sl_' || p1 || '/1.xls', false) IS NOT FALSE
     OR public.fn_executie_acces_obiect_permis('alt-bucket', p3 || '/x.pdf', true) IS NOT TRUE
     OR public.fn_executie_acces_obiect_permis(NULL, 'x', false) IS NOT FALSE
     OR public.fn_executie_acces_obiect_permis('executie-contracte', NULL, false) IS NOT FALSE THEN
    RAISE EXCEPTION 'T3s FAIL: rezolvarea căilor (contracte / borderouri), ca B';
  END IF;
  IF v_pk IS NOT NULL AND (public.fn_executie_acces_obiect_permis('executie-pachete-pdf', v_pk || '/2026-11-01_ab_x.xlsx', true) IS NOT TRUE
     OR public.fn_executie_acces_obiect_permis('executie-pachete-pdf', p1 || '/' || v_pk || '/aprobare/x.pdf', true) IS NOT TRUE
     OR public.fn_executie_acces_obiect_permis('executie-pachete-pdf', p3 || '/' || v_pk || '/aprobare/x.pdf', false) IS NOT FALSE) THEN
    RAISE EXCEPTION 'T3s FAIL: rezolvarea căilor (pachete), ca B';
  END IF;
  IF v_pk IS NULL THEN PERFORM pg_temp.t_neprobat('Storage executie-pachete-pdf: niciun pachet pe p1'); END IF;
  -- documentul lui p3: fals (rândul nu se vede); scrierea în documente-proiect: fals pentru contul restrâns (r9, doar serverul scrie acolo)
  IF v_doc3 IS NULL OR public.fn_executie_acces_obiect_permis('documente-proiect', v_doc3, false) IS NOT FALSE
     OR public.fn_executie_acces_obiect_permis('documente-proiect', v_doc3, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'T3s FAIL: rezolvarea documentelor, ca B (%)', v_doc3;
  END IF;
END $t$;

-- ── T3i: Inboxul AI (review r3 P1): pentru B (restrâns), rândurile / fișierele clasificate pentru Execuție urmează lista: p1 (editor) ca
--   înainte; p2 (viewer) citire ca înainte, scriere NU; p3 nimic (nici citire, nici scriere) — r5: nici documentul urcat chiar de B, odată
--   potrivit pe p3 (altfel B ar afla proiectul / scorul găsit de clasificator); documentul lui B fără proiect: citire ca înainte, scriere NU;
--   rândurile altor module / nedecise: ca înainte. r10: FIȘIERELE proprii ale lui B (folderul lui) nu mai urmează rândul — le vede și le
--   șterge ca înainte de migrare, inclusiv pe cel al rândului ascuns de pe p3; RÂNDUL rămâne ascuns / nemodificabil ca în r5–r9 ──
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb := pg_temp.t_g('mb1')::jsonb->'inbox'; v0 jsonb := pg_temp.t_g('mb0')::jsonb->'inbox'; k text; n_cit integer := 0; n_scr integer := 0; n_al integer := 0; x text;
BEGIN
  IF v0 = '{}'::jsonb THEN PERFORM pg_temp.t_neprobat('Inbox AI: niciun rând de probă'); END IF;
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF k = 'p3' THEN
      IF (v->k->>'vede')::integer <> 0 OR (v->k->>'obiect')::integer <> 0 THEN RAISE EXCEPTION 'T3i FAIL: B vede rândul / fișierul Inboxului (%) pe p3: %', k, v->k; END IF;
      IF (v0->k->>'vede')::integer > 0 THEN n_cit := n_cit + 1; ELSE PERFORM pg_temp.t_neprobat('Inbox ' || k || ': B nu vedea rândul nici înainte'); END IF;
      IF (v0->k->>'obiect')::integer > 0 THEN n_cit := n_cit + 1; ELSE PERFORM pg_temp.t_neprobat('Inbox ' || k || ': B nu vedea fișierul nici înainte'); END IF;
    ELSIF k = 'p3_al_lui_b' THEN
      -- r10: rândul (legătura cu p3) ascuns; fișierul propriu (din folderul lui B) ca înainte
      IF (v->k->>'vede')::integer <> 0 THEN RAISE EXCEPTION 'T3i FAIL: B vede rândul propriu (%) de pe p3: %', k, v->k; END IF;
      IF v->k->'obiect' IS DISTINCT FROM v0->k->'obiect' THEN RAISE EXCEPTION 'T3i FAIL: fișierul propriu al lui B (rând pe p3): după % / înainte %', v->k, v0->k; END IF;
      IF (v0->k->>'vede')::integer > 0 THEN n_cit := n_cit + 1; ELSE PERFORM pg_temp.t_neprobat('Inbox ' || k || ': B nu vedea rândul nici înainte'); END IF;
    ELSIF v->k->'vede' IS DISTINCT FROM v0->k->'vede' OR v->k->'obiect' IS DISTINCT FROM v0->k->'obiect' THEN
      RAISE EXCEPTION 'T3i FAIL: citirea Inboxului (%): după % / înainte %', k, v->k, v0->k;
    ELSIF k = 'nul_al_lui_b' THEN
      -- calea legitimă a excepției (L20): documentul propriu, încă fără proiect, rămâne vizibil
      IF (v0->k->>'vede')::integer > 0 THEN n_al := n_al + 1; ELSE PERFORM pg_temp.t_neprobat('Inbox nul_al_lui_b: B nu vedea rândul nici înainte'); END IF;
    END IF;
    -- scrierea: p1 și rândurile altor module = ca înainte; p2 (viewer), p3, documentele lui B (pe p3 sau fără proiect) = refuz
    IF k IN ('p2', 'p3', 'p3_al_lui_b', 'nul_al_lui_b') THEN
      IF v0->k->>'scrie' = 'OK 1' THEN
        IF v->k->>'scrie' IS DISTINCT FROM 'OK 0' THEN RAISE EXCEPTION 'T3i FAIL: B modifică rândul Inboxului % (REST): %', k, v->k->>'scrie'; END IF;
        n_scr := n_scr + 1;
      ELSIF v->k->>'scrie' LIKE 'OK 1%' THEN RAISE EXCEPTION 'T3i FAIL: B modifică rândul Inboxului % (REST): %', k, v->k->>'scrie';
      ELSE PERFORM pg_temp.t_neprobat('Inbox ' || k || ' REST: B nu-l putea modifica nici înainte'); END IF;
      IF NOT pg_temp.t_e_garda(v->k->>'definer') THEN RAISE EXCEPTION 'T3i FAIL: calea DEFINER pe rândul Inboxului %: %', k, v->k->>'definer'; END IF;
      n_scr := n_scr + 1;
      -- ștergerea fișierului (politica de ștergere de azi o permite celui care poate confirma rândul, inclusiv unui „viewer” pe proiect);
      -- r10: fișierul PROPRIU al lui B (folderul lui) — ca înainte, oricare ar fi rândul
      IF k IN ('p3_al_lui_b', 'nul_al_lui_b') THEN
        IF v->k->'sterge_obiect' IS DISTINCT FROM v0->k->'sterge_obiect' THEN
          RAISE EXCEPTION 'T3i FAIL: ștergerea fișierului propriu al lui B (%): după % / înainte %', k, v->k->>'sterge_obiect', v0->k->>'sterge_obiect';
        END IF;
      ELSIF v0->k->>'sterge_obiect' = 'OK 1' THEN
        IF v->k->>'sterge_obiect' IS DISTINCT FROM 'OK 0' THEN RAISE EXCEPTION 'T3i FAIL: B șterge fișierul Inboxului % : %', k, v->k->>'sterge_obiect'; END IF;
        n_scr := n_scr + 1;
      ELSIF v->k->>'sterge_obiect' LIKE 'OK 1%' THEN RAISE EXCEPTION 'T3i FAIL: B șterge fișierul Inboxului % : %', k, v->k->>'sterge_obiect';
      ELSE PERFORM pg_temp.t_neprobat('Inbox ' || k || ': B nu putea șterge fișierul nici înainte'); END IF;
    ELSIF v->k->'scrie' IS DISTINCT FROM v0->k->'scrie' OR v->k->'definer' IS DISTINCT FROM v0->k->'definer'
          OR v->k->'sterge_obiect' IS DISTINCT FROM v0->k->'sterge_obiect' THEN
      RAISE EXCEPTION 'T3i FAIL: scrierea în Inbox (%): după % / înainte %', k, v->k, v0->k;
    END IF;
  END LOOP;
  IF v0->'p1'->>'scrie' = 'OK 1' THEN
    -- mutarea rândului lui p1 pe p3: refuz (garda sau politica)
    x := pg_temp.t_proba(format('UPDATE public.ai_documente_inbox SET entitate_id = %s WHERE id = %s', pg_temp.t_g('p3'), (SELECT t_ib.id FROM t_ib WHERE t_ib.k = 'p1')));
    IF NOT (pg_temp.t_e_garda(x) OR pg_temp.t_e_rls(x)) THEN RAISE EXCEPTION 'T3i FAIL: B mută rândul Inboxului de pe p1 pe p3: %', x; END IF;
    n_scr := n_scr + 1;
  ELSE PERFORM pg_temp.t_neprobat('Inbox: mutarea p1 -> p3 (B nu putea modifica rândul lui p1 nici înainte)'); END IF;
  -- regula, direct (oracolul = specificația r5, nu politica): excepția celui care a urcat ține doar fără proiect, doar la citire, doar pentru el
  IF public.fn_executie_acces_inbox_rand('executie', pg_temp.t_g('p3')::bigint, auth.uid(), false) IS NOT FALSE
     OR public.fn_executie_acces_inbox_rand('executie', NULL, auth.uid(), false) IS NOT TRUE
     OR public.fn_executie_acces_inbox_rand('executie', NULL, auth.uid(), true) IS NOT FALSE
     OR public.fn_executie_acces_inbox_rand('executie', NULL, pg_temp.t_g('a')::uuid, false) IS NOT FALSE
     OR public.fn_executie_acces_inbox_rand('executie', pg_temp.t_g('p2')::bigint, pg_temp.t_g('a')::uuid, false) IS NOT TRUE
     OR public.fn_executie_acces_inbox_rand('hr', pg_temp.t_g('p3')::bigint, pg_temp.t_g('a')::uuid, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'T3i FAIL: regula rândului (excepția celui care a urcat)';
  END IF;
  RAISE NOTICE 'T3i OK (citiri refuzate %, scrieri refuzate %, documente proprii fără proiect vizibile %)', n_cit, n_scr, n_al;
END $t$;

-- ── T3f (r10, Jakarinos r9 P1 — cazul LITERAL): B (restrâns), folderul PROPRIU al Inboxului: (a) cale inexistentă, (b) fișier propriu cu rând
--   pe p3 (proiect NEPERMIS: rândul nu-i mai e vizibil), (c) fișier propriu cu rând pe p1 (permis), (d) fișier propriu FĂRĂ rând.
--   CITIRE: predicatul Storage (la citire și la scriere) = ACELAȘI în toate patru; ce vede B din obiecte = exact ca înainte de migrare.
--   SCRIERE (ștergere, modificare, încărcare pe aceeași cale, „reurcare” = ștergere + încărcare): comparată înainte / după, pe fiecare cale:
--     (1) (b) „rând ascuns” = (d) „fără rând” pe FIECARE operație (invizibil = inexistent, exact);
--     (2) o pereche de căi care se distinge DUPĂ, dar nu se distingea ÎNAINTE, are neapărat rândul din coadă vizibil pentru B pe una și
--         invizibil pe cealaltă (B o deosebește oricum printr-un SELECT pe coadă): Storage nu adaugă nimic peste ce vede B;
--     (3) ștergerea / modificarea = exact ca înainte, pe toate căile; încărcarea pe o cale nouă (a) = ca înainte și reușește.
--   Tabelul înainte / după apare în NOTICE (și în PR). ──
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb := pg_temp.t_propriu(); v0 jsonb := coalesce(pg_temp.t_g('pb0'), '{}')::jsonb; c jsonb := coalesce(pg_temp.t_g('propriu_cai'), '{}')::jsonb;
  op text; x text; y text; k text; pr jsonb := '{}'::jsonb; tabel text := ''; n integer := 0;
BEGIN
  IF NOT (c ?& ARRAY['a', 'b', 'c', 'd']) THEN
    PERFORM pg_temp.t_neprobat('T3f: lipsește o cale de probă din folderul lui B: ' || c::text);
    RAISE NOTICE 'T3f NEPROBAT (căi lipsă)';
    RETURN;
  END IF;
  -- premisele: (b), (c), (d) au obiect pe care B îl vedea înainte; rândul lui (b) era vizibil înainte și nu mai e; (c) vizibil; (d) fără rând
  IF (v0->'a'->>'citeste')::integer <> 0 OR (v0->'b'->>'citeste')::integer <> 1 OR (v0->'c'->>'citeste')::integer <> 1 OR (v0->'d'->>'citeste')::integer <> 1
     OR (v0->'b'->>'rand')::integer <> 1 OR (v->'b'->>'rand')::integer <> 0 OR (v->'c'->>'rand')::integer <> 1
     OR (v0->'d'->>'rand')::integer <> 0 OR (v->'d'->>'rand')::integer <> 0 THEN
    RAISE EXCEPTION 'T3f FAIL: premisele cazului literal (înainte %, după %)', v0, v;
  END IF;
  -- CITIRE: predicatul, același în toate patru (adevărat), la citire și la scriere
  FOR k IN SELECT jsonb_object_keys(c) LOOP
    pr := pr || jsonb_build_object(k, jsonb_build_array(public.fn_executie_acces_obiect_permis('ai-documente-inbox', c->>k, false),
                                                        public.fn_executie_acces_obiect_permis('ai-documente-inbox', c->>k, true)));
  END LOOP;
  IF (SELECT count(DISTINCT pr->k2) FROM unnest(ARRAY['a', 'b', 'c', 'd']) k2) <> 1 OR pr->'a' IS DISTINCT FROM '[true, true]'::jsonb THEN
    RAISE EXCEPTION 'T3f FAIL: predicatul Storage în folderul propriu diferă între cazuri (a/b/c/d): %', pr;
  END IF;
  -- ce vede B din obiecte = ca înainte
  FOREACH k IN ARRAY ARRAY['a', 'b', 'c', 'd'] LOOP
    IF v->k->'citeste' IS DISTINCT FROM v0->k->'citeste' THEN RAISE EXCEPTION 'T3f FAIL: citirea obiectului (%): după % / înainte %', k, v->k->'citeste', v0->k->'citeste'; END IF;
  END LOOP;
  FOREACH op IN ARRAY ARRAY['sterge', 'modifica', 'urca', 'reurca'] LOOP
    -- (1) rând ascuns = fără rând
    IF v->'b'->op IS DISTINCT FROM v->'d'->op THEN
      RAISE EXCEPTION 'T3f FAIL: % — rândul ascuns (b: %) se deosebește de lipsa rândului (d: %)', op, v->'b'->>op, v->'d'->>op;
    END IF;
    -- (2) deosebirile noi urmează doar rândul VIZIBIL lui B
    FOREACH x IN ARRAY ARRAY['a', 'b', 'c', 'd'] LOOP
      FOREACH y IN ARRAY ARRAY['a', 'b', 'c', 'd'] LOOP
        CONTINUE WHEN x >= y;
        IF v->x->op IS DISTINCT FROM v->y->op AND v0->x->op IS NOT DISTINCT FROM v0->y->op
           AND v->x->'rand' IS NOT DISTINCT FROM v->y->'rand' THEN
          RAISE EXCEPTION 'T3f FAIL: % — % și % se deosebesc după migrare (% / %), nu și înainte (%), deși B vede la fel rândul din coadă', op, x, y,
            v->x->>op, v->y->>op, v0->x->>op;
        END IF;
        n := n + 1;
      END LOOP;
    END LOOP;
    -- (3) ștergerea și modificarea: exact ca înainte
    IF op IN ('sterge', 'modifica') THEN
      FOREACH k IN ARRAY ARRAY['a', 'b', 'c', 'd'] LOOP
        IF v->k->op IS DISTINCT FROM v0->k->op THEN RAISE EXCEPTION 'T3f FAIL: % pe % : după % / înainte %', op, k, v->k->>op, v0->k->>op; END IF;
      END LOOP;
    END IF;
    tabel := tabel || format(' | %s: înainte a=%s b=%s c=%s d=%s ; după a=%s b=%s c=%s d=%s', op,
      v0->'a'->>op, v0->'b'->>op, v0->'c'->>op, v0->'d'->>op, v->'a'->>op, v->'b'->>op, v->'c'->>op, v->'d'->>op);
  END LOOP;
  -- (3) încărcarea pe o cale nouă: ca înainte și reușește (calea legitimă a panoului, L20)
  IF v->'a'->>'urca' IS DISTINCT FROM 'OK 1' OR v0->'a'->>'urca' IS DISTINCT FROM 'OK 1' THEN
    RAISE EXCEPTION 'T3f FAIL: încărcarea pe o cale nouă din folderul propriu: după % / înainte %', v->'a'->>'urca', v0->'a'->>'urca';
  END IF;
  RAISE NOTICE 'T3f OK (folderul propriu al lui B: predicat identic a/b/c/d = %, citirea obiectelor ca înainte; % perechi comparate%)', pr->'a', n, tabel;
END $t$;

-- ── T3c: clasificarea (r6, review r5 P1 — dispariția documentului propriu era ea însăși un semnal de existență), simulată ca edge-ul
--   citeste-orice r6: service_role, fără JWT; candidații vin din BD, fn_executie_acces_candidati(contul care a urcat), iar potrivirea se
--   face DOAR printre ei (pg_temp.t_clasifica_r6). Într-un savepoint anulat, cu p1, p2, p3 active:
--   (a) candidații = SPECIFICAȚIA, nu funcția: A (nerestrâns) / owner / rând fără cont = toate proiectele active; B = {p1, p2} (p2 e
--       'viewer': rândul potrivit pe el îi rămâne vizibil); C = {p1}; paritate cu regula pe apelant (ca B, fn_executie_proiect_permis pe
--       fiecare proiect activ; L19); forma exactă [{id, nume, cod_intern}]; un client logat (B) sau anon NU cheamă funcția (42501, doar
--       service_role); apoi p2 dezactivat → iese din candidații lui B și ai lui A (filtrul „activ” de azi al edge-ului); r7: un UUID fără
--       profil = refuz explicit 22023 (nu „toate”);
--   (b) documentul lui B fără proiect, cu un indiciu care potrivește DOAR p3: p3 nu e candidat → rândul rămâne fără proiect, iar B îl vede
--       exact ca înainte (rândul și fișierul) — nu mai dispare, deci nu mai e semnal;
--   (c) indiciu care potrivește p3 și p1 (p3 mai bine): potrivit pe p1 (candidat) → B îl vede, cu p1;
--   (d) plasa din r5: o scriere care OCOLEȘTE lista (service_role direct pe p3, ca edge-ul vechi) tot ascunde rândul (r10: fișierul
--       propriu, din folderul lui B, rămâne ca înainte — legătura cu proiectul e în rând). ──
SAVEPOINT t3c;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT pg_temp.t_pune('activ', to_jsonb(pg_temp.t_stare(format('UPDATE public.executie_proiecte SET activ = true WHERE id IN (%s, %s, %s) AND activ IS NOT TRUE',
                                                               pg_temp.t_g('p1'), pg_temp.t_g('p2'), pg_temp.t_g('p3')))));
SELECT pg_temp.t_ca(NULL, 'service_role');
SELECT pg_temp.t_pune('tot', (SELECT coalesce(jsonb_agg(e.id::bigint ORDER BY e.id), '[]'::jsonb) FROM public.executie_proiecte e WHERE e.activ IS TRUE));
SELECT pg_temp.t_pune('cand', jsonb_build_object(
         'a', public.fn_executie_acces_candidati(pg_temp.t_g('a')::uuid), 'b', public.fn_executie_acces_candidati(pg_temp.t_g('b')::uuid),
         'c', public.fn_executie_acces_candidati(pg_temp.t_g('c')::uuid), 'own', public.fn_executie_acces_candidati(pg_temp.t_g('own')::uuid),
         'nul', public.fn_executie_acces_candidati(NULL)));
-- r7 (review r6 P2): un cont dat care NU există (UUID fără profil) = refuz explicit, nu „toate proiectele”
SELECT pg_temp.t_pune('inexistent', to_jsonb(pg_temp.t_proba(format('SELECT public.fn_executie_acces_candidati(%L::uuid)', gen_random_uuid()))));
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT pg_temp.t_pune('permis_b', (SELECT coalesce(jsonb_agg(t.x ORDER BY t.x), '[]'::jsonb)
                                     FROM (SELECT v::bigint AS x FROM jsonb_array_elements_text(pg_temp.t_g('t3c')::jsonb->'tot') v) t
                                    WHERE public.fn_executie_proiect_permis(t.x, false)));
SELECT pg_temp.t_pune('acl_b', to_jsonb(pg_temp.t_proba(format('SELECT public.fn_executie_acces_candidati(%L::uuid)', pg_temp.t_g('a')))));
SELECT pg_temp.t_ca(NULL, 'anon');
SELECT pg_temp.t_pune('acl_anon', to_jsonb(pg_temp.t_proba(format('SELECT public.fn_executie_acces_candidati(%L::uuid)', pg_temp.t_g('b')))));
-- filtrul „activ”: p2 dezactivat → iese din candidații lui B și ai lui A
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT pg_temp.t_pune('inactiv', to_jsonb(pg_temp.t_stare(format('UPDATE public.executie_proiecte SET activ = false WHERE id = %s', pg_temp.t_g('p2')))));
SELECT pg_temp.t_ca(NULL, 'service_role');
SELECT pg_temp.t_pune('tot2', (SELECT coalesce(jsonb_agg(e.id::bigint ORDER BY e.id), '[]'::jsonb) FROM public.executie_proiecte e WHERE e.activ IS TRUE));
SELECT pg_temp.t_pune('cand2', jsonb_build_object('a', public.fn_executie_acces_candidati(pg_temp.t_g('a')::uuid),
                                                  'b', public.fn_executie_acces_candidati(pg_temp.t_g('b')::uuid)));
-- (b) indiciu doar pe p3
SELECT pg_temp.t_ca(NULL, 'service_role');
SELECT pg_temp.t_pune('b_clas', to_jsonb(pg_temp.t_clasifica_r6(coalesce((SELECT t_ib.id FROM t_ib WHERE t_ib.k = 'nul_al_lui_b'), -1),
                                                                ARRAY[pg_temp.t_g('p3')::bigint])));
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT pg_temp.t_pune('b_vede', to_jsonb(pg_temp.t_vede_ib('nul_al_lui_b')));
-- (c) indiciu pe p3 și p1
SELECT pg_temp.t_ca(NULL, 'service_role');
SELECT pg_temp.t_pune('c_clas', to_jsonb(pg_temp.t_clasifica_r6(coalesce((SELECT t_ib.id FROM t_ib WHERE t_ib.k = 'nul_al_lui_b'), -1),
                                                                ARRAY[pg_temp.t_g('p3')::bigint, pg_temp.t_g('p1')::bigint])));
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT pg_temp.t_pune('c_vede', to_jsonb(pg_temp.t_vede_ib('nul_al_lui_b')));
-- (d) plasa: scriere directă pe p3, ocolind lista
SELECT pg_temp.t_ca(NULL, 'service_role');
SELECT pg_temp.t_pune('d_clas', to_jsonb(pg_temp.t_stare(format('UPDATE public.ai_documente_inbox SET entitate_id = %s, entitate_match_confidence = 88 WHERE id = %s',
                                                                 pg_temp.t_g('p3'), coalesce((SELECT t_ib.id FROM t_ib WHERE t_ib.k = 'nul_al_lui_b'), -1)))));
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT pg_temp.t_pune('d_vede', to_jsonb(pg_temp.t_vede_ib('nul_al_lui_b')));
-- set_config din savepoint se anulează odată cu el: rezultatele trec printr-o variabilă psql (\gset), apoi înapoi în tacc.t3c după ROLLBACK TO
-- (\set de mai jos nu schimbă nimic: doar golește bufferul, ca \gset să primească o singură interogare și în proba locală PGlite)
\set ON_ERROR_STOP 1
SELECT coalesce(pg_temp.t_g('t3c'), '{}') AS t3c_json
\gset
ROLLBACK TO SAVEPOINT t3c;
SELECT set_config('tacc.t3c', :'t3c_json', true);
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$
DECLARE r jsonb := pg_temp.t_g('t3c')::jsonb; p1 bigint := pg_temp.t_g('p1')::bigint; p2 bigint := pg_temp.t_g('p2')::bigint; p3 bigint := pg_temp.t_g('p3')::bigint;
  tot jsonb := r->'tot'; spec_b jsonb; k text; inainte text;
  v0 jsonb := pg_temp.t_g('mb0')::jsonb->'inbox'->'nul_al_lui_b';
BEGIN
  IF coalesce(r->>'activ', '') NOT LIKE 'OK %' OR coalesce(r->>'inactiv', '') IS DISTINCT FROM 'OK 1' THEN
    RAISE EXCEPTION 'T3c FAIL: proiectele de probă nu s-au putut (de)activa în savepoint: % / %', r->>'activ', r->>'inactiv';
  END IF;
  IF tot IS NULL OR NOT (tot @> to_jsonb(p1) AND tot @> to_jsonb(p2) AND tot @> to_jsonb(p3))
     OR r->'tot2' IS DISTINCT FROM (SELECT coalesce(jsonb_agg(v::bigint ORDER BY v::bigint), '[]'::jsonb) FROM jsonb_array_elements_text(tot) v WHERE v::bigint <> p2) THEN
    RAISE EXCEPTION 'T3c FAIL: starea „activ” din savepoint (p1, p2, p3 active, apoi p2 inactiv): % / %', tot, r->'tot2';
  END IF;
  -- (a) specificația: B are pe listă p1 (editor) + p2 (viewer) → {p1, p2}; după dezactivarea lui p2 → {p1}; C are p1
  spec_b := (SELECT coalesce(jsonb_agg(t.x ORDER BY t.x), '[]'::jsonb) FROM (SELECT v::bigint AS x FROM jsonb_array_elements_text(tot) v) t WHERE t.x IN (p1, p2));
  IF spec_b IS DISTINCT FROM (SELECT jsonb_agg(x ORDER BY x) FROM unnest(ARRAY[p1, p2]) x) THEN RAISE EXCEPTION 'T3c FAIL: oracolul lui B (%)', spec_b; END IF;
  FOREACH k IN ARRAY ARRAY['a', 'own', 'nul'] LOOP
    IF pg_temp.t_ids(r->'cand'->k) IS DISTINCT FROM tot THEN
      RAISE EXCEPTION 'T3c FAIL: candidații contului % (nerestrâns / owner / fără cont) nu sunt toate proiectele active: % / %', k, pg_temp.t_ids(r->'cand'->k), tot;
    END IF;
  END LOOP;
  IF pg_temp.t_ids(r->'cand'->'b') IS DISTINCT FROM spec_b THEN RAISE EXCEPTION 'T3c FAIL: candidații lui B: % (așteptat %)', pg_temp.t_ids(r->'cand'->'b'), spec_b; END IF;
  IF pg_temp.t_ids(r->'cand'->'c') IS DISTINCT FROM jsonb_build_array(p1) THEN RAISE EXCEPTION 'T3c FAIL: candidații lui C: %', pg_temp.t_ids(r->'cand'->'c'); END IF;
  IF pg_temp.t_ids(r->'cand2'->'b') IS DISTINCT FROM jsonb_build_array(p1) OR pg_temp.t_ids(r->'cand2'->'a') IS DISTINCT FROM r->'tot2' THEN
    RAISE EXCEPTION 'T3c FAIL: candidații contului după dezactivarea lui p2 (filtrul activ): B % / A % (active %)',
      pg_temp.t_ids(r->'cand2'->'b'), pg_temp.t_ids(r->'cand2'->'a'), r->'tot2';
  END IF;
  IF r->'permis_b' IS DISTINCT FROM pg_temp.t_ids(r->'cand'->'b') THEN
    RAISE EXCEPTION 'T3c FAIL: paritate cont / apelant (L19): candidați % / permise ca B %', pg_temp.t_ids(r->'cand'->'b'), r->'permis_b';
  END IF;
  IF jsonb_typeof(r->'cand'->'a') IS DISTINCT FROM 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'cand'->'a') e
                 WHERE jsonb_typeof(e) <> 'object' OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(e) x) IS DISTINCT FROM ARRAY['cod_intern', 'id', 'nume']
                    OR jsonb_typeof(e->'id') <> 'number') THEN
    RAISE EXCEPTION 'T3c FAIL: forma candidaților (așteptat [{id, nume, cod_intern}]): %', left((r->'cand'->'a')::text, 300);
  END IF;
  IF coalesce(r->>'acl_b', '') NOT LIKE '42501 permission denied for function fn_executie_acces_candidati%'
     OR coalesce(r->>'acl_anon', '') NOT LIKE '42501 permission denied for function fn_executie_acces_candidati%' THEN
    RAISE EXCEPTION 'T3c FAIL: un client (B / anon) cheamă candidații: % / %', r->>'acl_b', r->>'acl_anon';
  END IF;
  IF coalesce(r->>'inexistent', '') NOT LIKE '22023 acces proiect: candidații cer un cont existent%' THEN
    RAISE EXCEPTION 'T3c FAIL: cont inexistent (UUID fără profil) nu e refuzat: %', left(coalesce(r->>'inexistent', '(lipsă)'), 200);
  END IF;
  -- (b)(c)(d) pe documentul lui B fără proiect
  IF (SELECT t_ib.id FROM t_ib WHERE t_ib.k = 'nul_al_lui_b') IS NULL OR coalesce((v0->>'vede')::integer, 0) = 0 THEN
    PERFORM pg_temp.t_neprobat('T3c clasificarea: rândul de probă al lui B fără proiect lipsește sau nu era vizibil nici înainte');
    RAISE NOTICE 'T3c OK (doar candidații; clasificarea NEPROBATĂ)';
  ELSE
    inainte := (v0->>'vede') || ':' || coalesce(v0->>'obiect', '?');
    IF r->>'b_clas' IS DISTINCT FROM 'fara potrivire' THEN RAISE EXCEPTION 'T3c FAIL: indiciul doar pe p3 a fost potrivit pe un candidat: %', r->>'b_clas'; END IF;
    IF r->>'b_vede' IS DISTINCT FROM inainte || ':-' THEN
      RAISE EXCEPTION 'T3c FAIL: documentul lui B (indiciu doar pe p3) nu se vede ca înainte: % (înainte %)', r->>'b_vede', inainte;
    END IF;
    IF r->>'c_clas' IS DISTINCT FROM 'OK 1 ' || p1 THEN RAISE EXCEPTION 'T3c FAIL: indiciul pe p3 + p1 nu a fost potrivit pe p1: %', r->>'c_clas'; END IF;
    IF r->>'c_vede' IS DISTINCT FROM inainte || ':' || p1 THEN RAISE EXCEPTION 'T3c FAIL: documentul lui B potrivit pe p1 nu se vede: %', r->>'c_vede'; END IF;
    IF r->>'d_clas' IS DISTINCT FROM 'OK 1' THEN RAISE EXCEPTION 'T3c FAIL: scrierea directă (plasa) nu a scris: %', r->>'d_clas'; END IF;
    -- r10: rândul (legătura cu p3) ascuns; fișierul propriu, din folderul lui B, rămâne cum era înainte
    IF r->>'d_vede' IS DISTINCT FROM '0:' || coalesce(v0->>'obiect', '?') || ':-' THEN
      RAISE EXCEPTION 'T3c FAIL: plasa r5: rândul lui B scris direct pe p3 se vede (sau fișierul propriu nu mai e ca înainte): %', r->>'d_vede';
    END IF;
    RAISE NOTICE 'T3c OK (candidații = specificația pentru A, B, C, owner, fără cont; indiciu doar pe p3 = documentul rămâne vizibil, fără proiect; p3 + p1 = potrivit pe p1; plasa r5 ascunde rândul scris direct pe p3)';
  END IF;
END $t$;

-- ── T3e (r8; r9 SISTEMATIC — review r8, ambii recenzenți P1: un boolean poate fi tot oracol). EXPUNEREA prin apel DIRECT (RPC, argumente
--   alese de apelant), pentru FIECARE funcție cu EXECUTE pentru clienți și FIECARE fel de argument, ca patru conturi:
--     A0 = logat FĂRĂ drept pe modulul executie (A cu dreptul scos, savepoint anulat), A = editor nerestrâns,
--     B = restrâns (p1 editor, p2 viewer), B0 = B fără drept pe modul (savepoint anulat), restrâns în continuare.
--   Argumentele (alese ca postgres): pe p1 / p2 / p3, fără proiect (șantierul lui B și unul neatribuit lui B), rândurile Inboxului (ale lui A
--   pe p1 / p2 / p3, al altui modul, nedecis; ale lui B pe p3 / fără proiect), țevile și câte un argument INEXISTENT.
--   VIZIBILITATEA fiecărui argument se măsoară CA APELANTUL (SELECT sub RLS-ul lui, pe rândul căutat de funcție).
--   (a) ORACOL: un argument EXISTENT, dar INVIZIBIL apelantului, dă EXACT rezultatul celui inexistent (valoare, NULL, eroare cu SQLSTATE și
--       mesaj) — pe fiecare funcție × argument × cont, FĂRĂ excepții (r10: excepția folderului propriu din r9 a ieșit, odată cu
--       fn_executie_acces_inbox_propriu; folderul propriu = adevărat pentru orice cale, deci și pentru cele invizibile / inexistente).
--   (b) SPECIFICAȚIA pe argumentele vizibile (nu codul): predicatele = adevărat pentru orice argument la contul nerestrâns (A0, A); la B / B0
--       citire p1 / p2 / fără proiect = adevărat, p3 = fals; scriere doar p1 / fără proiect; documente-proiect: scriere = fals; funcțiile de
--       drept cer modulul; poarta swap cere scrierea pe modul (P2: A0 = refuz, ca țeava inexistentă; mesaj fără id-uri).
--   (c) cazurile LITERALE din verdictele r8: B0 + șantier / raport fără proiect; B + rândul Inboxului al altui modul / nedecis, în afara
--       folderului propriu; A0 + schimbul de țevi. r10 (verdictul r9): B / B0, folderul propriu — cale inexistentă, fișier propriu cu rând pe
--       un proiect nepermis / permis, fără rând: același predicat (la citire și la scriere) în toate (detaliat, cu scrierea, în T3f).
--   (d) funcțiile interne = 42501 pentru toți; rezolvările brute din r8 nu mai există; RPC-ul owner-ului = același 42501.
SELECT pg_temp.t_ca(NULL, 'postgres');
CREATE FUNCTION pg_temp.t_val(p_sql text) RETURNS text LANGUAGE plpgsql AS $h$
DECLARE r text;
BEGIN
  EXECUTE p_sql INTO r; RETURN coalesce(r, 'null');
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $h$;
-- argumentele, ca postgres (fără RLS): pe fiecare fel, {eticheta: valoare}; un argument fără rând de probă lipsește (NEPROBAT la final)
DO $t$
DECLARE p jsonb := jsonb_build_object('p1', pg_temp.t_g('p1')::bigint, 'p2', pg_temp.t_g('p2')::bigint, 'p3', pg_temp.t_g('p3')::bigint);
  v jsonb := '{}'::jsonb; r record; k text; x jsonb; b uuid := pg_temp.t_g('b')::uuid; v_nul2 bigint;
BEGIN
  v := v || jsonb_build_object('proiect', p || jsonb_build_object('inex', (SELECT coalesce(max(id), 0) + 100000 FROM public.executie_proiecte)));
  FOR r IN SELECT * FROM (VALUES ('sl', 'executie_situatii_plata'), ('bon', 'executie_bonuri_consum'), ('pachet', 'executie_pachete_lansare'),
                                 ('cumulat', 'executie_pachete_cumulat_final'), ('activitate', 'proiect_activitati'), ('site', 'sites')) q(fel, tabel) LOOP
    EXECUTE format('SELECT jsonb_strip_nulls(jsonb_build_object(%L, min(id) FILTER (WHERE proiect_id = $1), %L, min(id) FILTER (WHERE proiect_id = $2), %L, min(id) FILTER (WHERE proiect_id = $3),'
                   || ' %L, coalesce(max(id), 0) + 100000)) FROM public.%I', 'p1', 'p2', 'p3', 'inex', r.tabel)
      INTO x USING (p->>'p1')::bigint, (p->>'p2')::bigint, (p->>'p3')::bigint;
    v := v || jsonb_build_object(r.fel, x);
  END LOOP;
  -- șantierele fără proiect: cel al lui B (T0c) și unul NEATRIBUIT lui B (cazul literal din verdict: B0 nu-l vede prin alocare)
  SELECT min(s.id) INTO v_nul2 FROM public.sites s
   WHERE s.proiect_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.profile_sites ps WHERE ps.profile_id = b AND ps.site_id = s.id);
  v := jsonb_set(v, '{site}', (v->'site') || jsonb_strip_nulls(jsonb_build_object('nul', pg_temp.t_g('site0')::bigint, 'nul2', v_nul2)));
  v := v || jsonb_build_object('raport', jsonb_strip_nulls(jsonb_build_object(
         'p1', (SELECT min(z.id) FROM public.rapoarte_zilnice z JOIN public.sites s ON s.id = z.site_id WHERE s.proiect_id = (p->>'p1')::bigint),
         'p2', (SELECT min(z.id) FROM public.rapoarte_zilnice z JOIN public.sites s ON s.id = z.site_id WHERE s.proiect_id = (p->>'p2')::bigint),
         'p3', (SELECT min(z.id) FROM public.rapoarte_zilnice z JOIN public.sites s ON s.id = z.site_id WHERE s.proiect_id = (p->>'p3')::bigint),
         'nul', (SELECT min(z.id) FROM public.rapoarte_zilnice z WHERE z.site_id = pg_temp.t_g('site0')::bigint),
         'nul2', (SELECT min(z.id) FROM public.rapoarte_zilnice z WHERE z.site_id = v_nul2),
         'inex', (SELECT coalesce(max(id), 0) + 100000 FROM public.rapoarte_zilnice))));
  -- documente-proiect: o cale legată DOAR de proiectul ei
  x := '{}'::jsonb;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    x := x || jsonb_strip_nulls(jsonb_build_object(k, (SELECT min(d.storage_path) FROM public.documente_proiect d WHERE d.proiect_id = (p->>k)::bigint AND d.storage_path IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.documente_proiect e WHERE e.storage_path = d.storage_path AND e.proiect_id IS DISTINCT FROM d.proiect_id))));
  END LOOP;
  v := v || jsonb_build_object('doc', x || jsonb_build_object('inex', 'test-acces/inexistent-' || gen_random_uuid() || '.pdf'));
  -- Inboxul AI: rândurile de probă (t_ib) + căi inexistente în folderul lui A, al lui B și într-unul al nimănui
  v := v || jsonb_build_object('inbox', jsonb_strip_nulls(jsonb_build_object(
         'a_p1', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'p1' AND t_ib.id IS NOT NULL), 'a_p2', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'p2' AND t_ib.id IS NOT NULL),
         'a_p3', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'p3' AND t_ib.id IS NOT NULL), 'a_hr', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'hr' AND t_ib.id IS NOT NULL),
         'a_nedecis', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'nedecis' AND t_ib.id IS NOT NULL),
         'b_p3', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'p3_al_lui_b' AND t_ib.id IS NOT NULL),
         'b_p1', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'p1_al_lui_b' AND t_ib.id IS NOT NULL),
         'b_nul', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'nul_al_lui_b' AND t_ib.id IS NOT NULL),
         'b_orfan', (SELECT t_ib.cale FROM t_ib WHERE t_ib.k = 'orfan_al_lui_b' AND t_ib.motiv LIKE 'OK %'),
         'inex_a', pg_temp.t_g('a') || '/test-acces-inexistent-' || gen_random_uuid() || '.pdf',
         'inex_b', pg_temp.t_g('b') || '/test-acces-inexistent-' || gen_random_uuid() || '.pdf',
         'inex_x', gen_random_uuid() || '/test-acces-inexistent-' || gen_random_uuid() || '.pdf')));
  -- țevile: perechi din același pachet (T0c); inexistente
  v := v || jsonb_build_object('tevi', jsonb_strip_nulls(jsonb_build_object('p1', pg_temp.t_g('tevi1'), 'p3', pg_temp.t_g('tevi3'), 'inex', '-1,-2')));
  PERFORM set_config('tacc.e_ids', v::text, true);
END $t$;
-- funcțiile probate: cheie → felul argumentului + apelul (%1$s = valoarea, ca literal SQL); 'proba' = scrisă efectiv, apoi anulată
CREATE TEMP TABLE t_exp_fn (cheie text PRIMARY KEY, fel text NOT NULL, cale text NOT NULL, sql text NOT NULL);
INSERT INTO t_exp_fn VALUES
  ('permis_c', 'proiect', 'val', 'SELECT public.fn_executie_proiect_permis(%1$s::bigint, false)'),
  ('permis_s', 'proiect', 'val', 'SELECT public.fn_executie_proiect_permis(%1$s::bigint, true)'),
  ('inbox_rand', 'proiect', 'val', 'SELECT public.fn_executie_acces_inbox_rand(''executie'', %1$s::bigint, NULL, false)'),
  ('nod', 'proiect', 'val', 'SELECT public.fn_executie_nod_drept(%1$s::bigint, false)'),
  ('contract', 'proiect', 'val', 'SELECT public.fn_executie_contract_drept(%1$s::bigint, false)'),
  ('grafic', 'proiect', 'val', 'SELECT public.fn_executie_grafic_drept(%1$s::bigint)'),
  ('tinte', 'proiect', 'val', 'SELECT public.fn_executie_tinte_drept(%1$s::bigint, ''citire'')'),
  ('contracte_c', 'proiect', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''executie-contracte'', %1$s || ''/test-acces/x.pdf'', false)'),
  ('contracte_s', 'proiect', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''executie-contracte'', ''pccvi/'' || %1$s || ''/x.pdf'', true)'),
  ('borderouri_c', 'proiect', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''executie-borderouri'', ''sl_'' || %1$s || ''/x.xls'', false)'),
  ('borderouri_s', 'proiect', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''executie-borderouri'', ''sl_'' || %1$s || ''/x.xls'', true)'),
  ('pachete_c', 'pachet', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''executie-pachete-pdf'', %1$s || ''/x.pdf'', false)'),
  ('pachete_s', 'pachet', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''executie-pachete-pdf'', %1$s || ''/x.pdf'', true)'),
  ('raport_santier', 'site', 'val', 'SELECT public.fn_raport_santier_drept(%1$s::bigint)'),
  ('documente_c', 'doc', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''documente-proiect'', %1$s, false)'),
  ('documente_s', 'doc', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''documente-proiect'', %1$s, true)'),
  ('inbox_c', 'inbox', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''ai-documente-inbox'', %1$s, false)'),
  ('inbox_s', 'inbox', 'val', 'SELECT public.fn_executie_acces_obiect_permis(''ai-documente-inbox'', %1$s, true)'),
  ('swap', 'tevi', 'proba', 'SELECT public.fn_executie_swap_tevi_pozitie(split_part(%1$s, '','', 1)::bigint, split_part(%1$s, '','', 2)::bigint)');
INSERT INTO t_exp_fn SELECT 'parinte_' || t || '_' || c, t, 'val', format('SELECT public.fn_executie_acces_parinte_permis(%L, %%1$s::bigint, %s)', t, CASE c WHEN 's' THEN 'true' ELSE 'false' END)
  FROM unnest(ARRAY['sl', 'bon', 'pachet', 'cumulat', 'activitate', 'site', 'raport']) t, unnest(ARRAY['c', 's']) c;
GRANT SELECT ON t_exp_fn TO authenticated, anon, service_role;
-- vizibilitatea unui argument CA APELANTUL: câte dintre rândurile căutate de funcție le vede prin RLS (comparație pe tipul coloanei, ca
-- filtrul să nu aștepte politicile pe fiecare rând)
CREATE FUNCTION pg_temp.t_vizibil(p_fel text, p_v text) RETURNS integer LANGUAGE plpgsql AS $h$
DECLARE v_t text; v_c text; v_tip text; n integer;
BEGIN
  SELECT x.t, x.c INTO v_t, v_c FROM (VALUES ('proiect', 'executie_proiecte', 'id'), ('sl', 'executie_situatii_plata', 'id'), ('bon', 'executie_bonuri_consum', 'id'),
      ('pachet', 'executie_pachete_lansare', 'id'), ('cumulat', 'executie_pachete_cumulat_final', 'id'), ('activitate', 'proiect_activitati', 'id'),
      ('site', 'sites', 'id'), ('raport', 'rapoarte_zilnice', 'id'), ('doc', 'documente_proiect', 'storage_path'), ('inbox', 'ai_documente_inbox', 'fisier_path'),
      ('tevi', 'executie_tevi', 'id')) x(f, t, c) WHERE x.f = p_fel;
  IF v_t IS NULL THEN RAISE EXCEPTION 't_vizibil: fel necunoscut %', p_fel; END IF;
  SELECT format_type(a.atttypid, NULL) INTO v_tip FROM pg_attribute a WHERE a.attrelid = ('public.' || v_t)::regclass AND a.attname = v_c;
  IF p_fel = 'tevi' THEN
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE x.%I = ANY (CAST(string_to_array($1, %L) AS %s[]))', v_t, v_c, ',', v_tip) INTO n USING p_v;
  ELSE
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE x.%I = CAST($1 AS %s)', v_t, v_c, v_tip) INTO n USING p_v;
  END IF;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN 0;
END $h$;
-- toate apelurile, ca apelantul curent: {'<cheie>|<eticheta>': rezultat}, plus vizibilitatea {'<fel>|<eticheta>': rânduri văzute} și
-- predicatele fără argument / funcțiile interne (cheile i_*)
CREATE FUNCTION pg_temp.t_expunere() RETURNS jsonb LANGUAGE plpgsql AS $h$
DECLARE e jsonb := pg_temp.t_g('e_ids')::jsonb; v jsonb := '{}'::jsonb; viz jsonb := '{}'::jsonb; f record; et text; x text; q text;
BEGIN
  FOR f IN SELECT * FROM t_exp_fn ORDER BY cheie LOOP
    FOR et IN SELECT jsonb_object_keys(e->f.fel) LOOP
      q := format(f.sql, quote_literal(e->f.fel->>et));
      x := CASE f.cale WHEN 'proba' THEN pg_temp.t_proba(q) ELSE pg_temp.t_val(q) END;
      v := v || jsonb_build_object(f.cheie || '|' || et, x);
    END LOOP;
  END LOOP;
  FOR f IN SELECT DISTINCT fel FROM t_exp_fn LOOP
    FOR et IN SELECT jsonb_object_keys(e->f.fel) LOOP
      viz := viz || jsonb_build_object(f.fel || '|' || et, pg_temp.t_vizibil(f.fel, e->f.fel->>et));
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('r', v, 'viz', viz, 'x', jsonb_build_object(
    'inbox_propriu_nou', pg_temp.t_val(format('SELECT public.fn_executie_acces_obiect_permis(%L, %L, true)', 'ai-documente-inbox',
                                              coalesce(auth.uid()::text, '-') || '/test-acces-propriu-' || gen_random_uuid() || '.pdf')),
    'alt_bucket', pg_temp.t_val(format('SELECT public.fn_executie_acces_obiect_permis(%L, %L, true)', 'alt-bucket', (e->'proiect'->>'p3') || '/x.pdf')),
    'e_owner', pg_temp.t_val('SELECT public.fn_executie_acces_e_owner()'),
    'nerestrans', pg_temp.t_val('SELECT public.fn_executie_acces_nerestrans()'),
    -- interne: 42501 pentru orice client
    'i_lista', pg_temp.t_val('SELECT public.fn_executie_acces_lista(false)::text'),
    'i_nerestrans_cont', pg_temp.t_val(format('SELECT public.fn_executie_acces_nerestrans_cont(%L::uuid)', pg_temp.t_g('b'))),
    'i_lista_cont', pg_temp.t_val(format('SELECT public.fn_executie_acces_lista_cont(%L::uuid, false)::text', pg_temp.t_g('b'))),
    'i_candidati', pg_temp.t_val(format('SELECT public.fn_executie_acces_candidati(%L::uuid)::text', pg_temp.t_g('b'))),
    'i_canon', pg_temp.t_val('SELECT public.fn_executie_acces_canon(''[]''::jsonb)::text'),
    'i_inventar', pg_temp.t_val('SELECT count(*) FROM public.fn_executie_acces_inventar()'),
    -- RPC-ul owner-ului: același refuz pentru un cont existent și pentru unul inexistent
    'seteaza_existent', pg_temp.t_val(format('SELECT public.fn_executie_acces_proiect_seteaza(%L::uuid, true, %L::jsonb, %L::jsonb)::text',
                                             pg_temp.t_g('c'), jsonb_build_array(jsonb_build_object('proiect_id', (e->'proiect'->>'p3')::bigint, 'nivel', 'viewer')), '[]')),
    'seteaza_inexistent', pg_temp.t_val(format('SELECT public.fn_executie_acces_proiect_seteaza(%L::uuid, true, %L::jsonb, %L::jsonb)::text',
                                               gen_random_uuid(), jsonb_build_array(jsonb_build_object('proiect_id', (e->'proiect'->>'p3')::bigint, 'nivel', 'viewer')), '[]'))));
END $h$;
GRANT EXECUTE ON FUNCTION pg_temp.t_val(text), pg_temp.t_vizibil(text, text), pg_temp.t_expunere() TO authenticated, anon, service_role;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT length(set_config('tacc.e_b', pg_temp.t_expunere()::text, true)) AS expunere_b;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT length(set_config('tacc.e_a', pg_temp.t_expunere()::text, true)) AS expunere_a;
-- A0 = A fără dreptul pe modul, B0 = B fără dreptul pe modul (restrâns în continuare), fiecare într-un savepoint anulat (rezultatul trece
-- prin \gset, ca la T3c)
SAVEPOINT t3e;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT pg_temp.t_stare(format('DELETE FROM public.user_module_access WHERE profile_id = %L::uuid AND module = %L', pg_temp.t_g('a'), 'executie')) AS a0_fara_modul;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
SELECT set_config('tacc.e_a0', pg_temp.t_expunere()::text, true) IS NOT NULL AS expunere_a0;
\set ON_ERROR_STOP 1
SELECT coalesce(pg_temp.t_g('e_a0'), '{}') AS e_a0_json
\gset
ROLLBACK TO SAVEPOINT t3e;
SELECT set_config('tacc.e_a0', :'e_a0_json', true) IS NOT NULL AS e_a0_inapoi;
SAVEPOINT t3e_b0;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT pg_temp.t_stare(format('DELETE FROM public.user_module_access WHERE profile_id = %L::uuid AND module = %L', pg_temp.t_g('b'), 'executie')) AS b0_fara_modul;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
SELECT set_config('tacc.e_b0', pg_temp.t_expunere()::text, true) IS NOT NULL AS expunere_b0;
\set ON_ERROR_STOP 1
SELECT coalesce(pg_temp.t_g('e_b0'), '{}') AS e_b0_json
\gset
ROLLBACK TO SAVEPOINT t3e_b0;
SELECT set_config('tacc.e_b0', :'e_b0_json', true) IS NOT NULL AS e_b0_inapoi;
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$
DECLARE e jsonb := pg_temp.t_g('e_ids')::jsonb; f record; et text; ref text; cont text; m jsonb; rez text; ast text; vz integer;
  n_oracol integer := 0; n_spec integer := 0; n_lit integer := 0; n integer := 0; v_fold text; v_propriu text; k2 text; n_or_b integer := 0; n_or_b0 integer := 0;
  toate jsonb := jsonb_build_object('a0', pg_temp.t_g('e_a0')::jsonb, 'a', pg_temp.t_g('e_a')::jsonb, 'b', pg_temp.t_g('e_b')::jsonb, 'b0', pg_temp.t_g('e_b0')::jsonb);
  v_a uuid := pg_temp.t_g('a')::uuid; v_b uuid := pg_temp.t_g('b')::uuid;
  poarta text := '42501 Execuție: nu ai drept de scriere pe acest proiect';
  pred text[] := ARRAY['permis_c', 'permis_s', 'inbox_rand', 'contracte_c', 'contracte_s', 'borderouri_c', 'borderouri_s', 'pachete_c', 'pachete_s',
                       'documente_c', 'documente_s', 'inbox_c', 'inbox_s'];
BEGIN
  FOREACH cont IN ARRAY ARRAY['a0', 'a', 'b', 'b0'] LOOP
    IF toate->cont IS NULL OR toate->cont = '{}'::jsonb OR toate->cont->'r' IS NULL THEN RAISE EXCEPTION 'T3e FAIL: rezultatele lipsesc pentru %', cont; END IF;
  END LOOP;
  FOR f IN SELECT * FROM t_exp_fn ORDER BY cheie LOOP
    FOR et IN SELECT jsonb_object_keys(e->f.fel) LOOP
      FOREACH cont IN ARRAY ARRAY['a0', 'a', 'b', 'b0'] LOOP
        m := toate->cont;
        rez := m->'r'->>(f.cheie || '|' || et);
        vz := (m->'viz'->>(f.fel || '|' || et))::integer;
        IF rez IS NULL OR vz IS NULL THEN RAISE EXCEPTION 'T3e FAIL: lipsește %|% pentru %', f.cheie, et, cont; END IF;
        -- folderul Inboxului: al lui A (a_*, inex_a), al lui B (b_*, inex_b), al nimănui (inex_x); propriu = al contului
        v_fold := CASE WHEN f.fel <> 'inbox' THEN NULL WHEN et LIKE 'a\_%' OR et = 'inex_a' THEN 'a' WHEN et LIKE 'b\_%' OR et = 'inex_b' THEN 'b' ELSE 'x' END;
        v_propriu := CASE WHEN cont IN ('a', 'a0') THEN 'a' ELSE 'b' END;
        ref := CASE WHEN f.fel = 'inbox' THEN 'inex_' || v_fold ELSE 'inex' END;
        -- (a) ORACOL: existent + invizibil = inexistent (exact), pe TOATE argumentele (r10: fără excepția folderului propriu din r9)
        IF et NOT LIKE 'inex%' AND vz = 0 THEN
          IF rez IS DISTINCT FROM m->'r'->>(f.cheie || '|' || ref) THEN
            RAISE EXCEPTION 'T3e FAIL: oracol de existență pentru % pe %(%): existent invizibil = % / inexistent (%) = %', cont, f.cheie, et, rez, ref, m->'r'->>(f.cheie || '|' || ref);
          END IF;
          n_oracol := n_oracol + 1;
          IF cont = 'b' THEN n_or_b := n_or_b + 1; ELSIF cont = 'b0' THEN n_or_b0 := n_or_b0 + 1; END IF;
        END IF;
        -- calea inexistentă într-un folder al nimănui = aceeași ca într-un folder străin
        IF et = 'inex_x' AND rez IS DISTINCT FROM m->'r'->>(f.cheie || '|inex_' || CASE v_propriu WHEN 'a' THEN 'b' ELSE 'a' END) THEN
          RAISE EXCEPTION 'T3e FAIL: oracol pe folder pentru % pe %: folder al nimănui % / folder străin %', cont, f.cheie, rez,
            m->'r'->>(f.cheie || '|inex_' || CASE v_propriu WHEN 'a' THEN 'b' ELSE 'a' END);
        END IF;
        -- (b) SPECIFICAȚIA
        ast := NULL;
        IF f.cheie = 'raport_santier' THEN
          -- fn_raport_santier_drept NU e apelabilă de clienți (20261208a: doar din RPC-urile raportului) — rămâne așa
          IF rez NOT LIKE '42501 permission denied for function fn\_raport\_santier\_drept%' THEN
            RAISE EXCEPTION 'T3e FAIL: fn_raport_santier_drept|% pentru % = % (așteptat 42501)', et, cont, rez;
          END IF;
          n_spec := n_spec + 1; CONTINUE;
        ELSIF f.cheie = 'swap' THEN
          ast := CASE WHEN cont = 'a' AND et <> 'inex' THEN 'OK 1' WHEN cont = 'b' AND et = 'p1' THEN 'OK 1' ELSE poarta END;
        ELSIF f.cheie IN ('nod', 'contract', 'grafic', 'tinte') THEN
          ast := CASE WHEN et = 'inex' THEN 'false'
                      WHEN cont = 'a' THEN 'true'
                      WHEN cont = 'b' THEN (et IN ('p1', 'p2'))::text
                      -- fără modul: fals; ținte la citire: alocarea pe un șantier al proiectului (din date), în limita listei (B0)
                      WHEN f.cheie = 'tinte' THEN (EXISTS (SELECT 1 FROM public.profile_sites ps JOIN public.sites s ON s.id = ps.site_id
                                                            WHERE ps.profile_id = CASE cont WHEN 'a0' THEN v_a ELSE v_b END AND s.proiect_id = (e->'proiect'->>et)::bigint
                                                              AND (ps.valid_until IS NULL OR ps.valid_until >= (now() AT TIME ZONE 'Europe/Bucharest')::date))
                                                   AND (cont = 'a0' OR et IN ('p1', 'p2')))::text
                      ELSE 'false' END;
        ELSIF f.cheie = ANY (pred) OR f.cheie LIKE 'parinte\_%' THEN
          IF cont IN ('a', 'a0') THEN ast := 'true';
          ELSIF f.fel = 'inbox' AND v_fold = v_propriu THEN
            -- r10: folderul propriu al contului restrâns = adevărat pentru ORICE cale (inexistentă, fără rând, rând pe p1 / pe p3 / fără proiect),
            -- la citire și la scriere: răspunsul nu depinde de rândul din coadă (restul îl decid politicile 20261103c, T3f)
            ast := 'true';
          ELSIF et LIKE 'inex%' OR vz = 0 THEN ast := 'false';
          ELSIF f.cheie = 'documente_s' THEN ast := 'false';
          ELSIF f.cheie LIKE '%\_s' THEN ast := (et IN ('p1', 'nul', 'nul2', 'a_p1', 'a_hr', 'a_nedecis'))::text;
          ELSE ast := (et IN ('p1', 'p2', 'nul', 'nul2', 'a_p1', 'a_p2', 'a_hr', 'a_nedecis'))::text;
          END IF;
        END IF;
        IF ast IS NULL THEN RAISE EXCEPTION 'T3e FAIL: cheie fără specificație: %', f.cheie; END IF;
        IF rez IS DISTINCT FROM ast THEN
          RAISE EXCEPTION 'T3e FAIL: % pe %(%) = % (așteptat %; vizibil: %)', cont, f.cheie, et, rez, ast, vz;
        END IF;
        n_spec := n_spec + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  -- argumentele fără rând de probă: NEPROBAT, cu numele lor
  FOR f IN SELECT DISTINCT fel FROM t_exp_fn LOOP
    FOREACH et IN ARRAY CASE f.fel WHEN 'inbox' THEN ARRAY['a_p1', 'a_p2', 'a_p3', 'a_hr', 'a_nedecis', 'b_p3', 'b_p1', 'b_nul', 'b_orfan']
                                   WHEN 'site' THEN ARRAY['p1', 'p2', 'p3', 'nul', 'nul2'] WHEN 'raport' THEN ARRAY['p1', 'p2', 'p3', 'nul', 'nul2']
                                   WHEN 'tevi' THEN ARRAY['p1', 'p3'] ELSE ARRAY['p1', 'p2', 'p3'] END LOOP
      IF NOT (e->f.fel) ? et THEN PERFORM pg_temp.t_neprobat('T3e: argument ' || f.fel || '|' || et || ' fără rând de probă'); END IF;
    END LOOP;
  END LOOP;
  -- (c) cazurile LITERALE din verdictele r8 (pe lângă regula generală de mai sus, cu numele lor)
  --   Jakarinos P1-1 / al doilea recenzent P1-02: contul restrâns fără modul (B0), șantier / raport FĂRĂ proiect, față de id inexistent
  FOREACH k2 IN ARRAY ARRAY['site', 'raport'] LOOP
    et := 'nul2';
    IF (e->k2) ? et THEN
      vz := (toate->'b0'->'viz'->>(k2 || '|' || et))::integer;
      IF vz = 0 THEN
        IF toate->'b0'->'r'->>('parinte_' || k2 || '_c|nul2') IS DISTINCT FROM toate->'b0'->'r'->>('parinte_' || k2 || '_c|inex')
           OR toate->'b0'->'r'->>('parinte_' || k2 || '_c|nul2') IS DISTINCT FROM 'false' THEN
          RAISE EXCEPTION 'T3e FAIL: cazul literal r8 (B0, % fără proiect): % / inexistent %', k2,
            toate->'b0'->'r'->>('parinte_' || k2 || '_c|nul2'), toate->'b0'->'r'->>('parinte_' || k2 || '_c|inex');
        END IF;
        n_lit := n_lit + 1;
      ELSE PERFORM pg_temp.t_neprobat('T3e literal ' || k2 || ': B0 vede șantierul fără proiect (RLS-ul lui sites pe această bază) — răspunsul e cel al unui SELECT direct'); END IF;
    ELSE PERFORM pg_temp.t_neprobat('T3e literal ' || k2 || ': niciun șantier fără proiect neatribuit lui B'); END IF;
  END LOOP;
  --   Jakarinos P1-2 / al doilea recenzent P1-01: B, rândul Inboxului al altui modul / nedecis, pe care NU îl vede, în afara folderului propriu
  FOREACH et IN ARRAY ARRAY['a_hr', 'a_nedecis'] LOOP
    IF (e->'inbox') ? et AND (toate->'b'->'viz'->>('inbox|' || et))::integer = 0 THEN
      IF toate->'b'->'r'->>('inbox_c|' || et) IS DISTINCT FROM toate->'b'->'r'->>'inbox_c|inex_a'
         OR toate->'b'->'r'->>('inbox_s|' || et) IS DISTINCT FROM toate->'b'->'r'->>'inbox_s|inex_a'
         OR toate->'b'->'r'->>('inbox_c|' || et) IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION 'T3e FAIL: cazul literal r8 (B, Inbox %, rând ascuns): % / inexistent %', et, toate->'b'->'r'->>('inbox_c|' || et), toate->'b'->'r'->>'inbox_c|inex_a';
      END IF;
      n_lit := n_lit + 1;
    ELSE PERFORM pg_temp.t_neprobat('T3e literal Inbox ' || et || ': rândul lipsește sau B îl vede pe această bază'); END IF;
  END LOOP;
  --   r10, Jakarinos r9 P1: contul restrâns (B și B0), folderul PROPRIU — (a) cale inexistentă, (b) fișier propriu cu rând pe p3 (nepermis,
  --   rândul invizibil), (c) cu rând pe p1 (permis), (d) fără rând: același predicat, la citire și la scriere (adevărat)
  FOREACH cont IN ARRAY ARRAY['b', 'b0'] LOOP
    FOREACH k2 IN ARRAY ARRAY['inbox_c', 'inbox_s'] LOOP
      IF NOT ((e->'inbox') ? 'b_p3' AND (e->'inbox') ? 'b_p1' AND (e->'inbox') ? 'b_orfan') THEN
        PERFORM pg_temp.t_neprobat('T3e literal r9 (' || cont || ', ' || k2 || '): lipsește un fișier de probă al lui B'); CONTINUE;
      END IF;
      IF (toate->cont->'viz'->>'inbox|b_p3')::integer <> 0 THEN
        PERFORM pg_temp.t_neprobat('T3e literal r9 (' || cont || '): rândul lui B de pe p3 e vizibil pe această bază'); CONTINUE;
      END IF;
      IF (SELECT count(DISTINCT coalesce(toate->cont->'r'->>(k2 || '|' || x), '(lipsă)')) FROM unnest(ARRAY['inex_b', 'b_p3', 'b_p1', 'b_orfan']) x) <> 1
         OR toate->cont->'r'->>(k2 || '|inex_b') IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'T3e FAIL: cazul literal r9 (%, %, folderul propriu): inexistent % / rând pe p3 % / rând pe p1 % / fără rând %', cont, k2,
          toate->cont->'r'->>(k2 || '|inex_b'), toate->cont->'r'->>(k2 || '|b_p3'), toate->cont->'r'->>(k2 || '|b_p1'), toate->cont->'r'->>(k2 || '|b_orfan');
      END IF;
      n_lit := n_lit + 1;
    END LOOP;
  END LOOP;
  --   Jakarinos P2: contul nerestrâns FĂRĂ modul (A0) nu mai ajunge la originalul swap; refuzul nu conține id-uri (doar SQLSTATE-ul are cifre)
  FOR et IN SELECT jsonb_object_keys(e->'tevi') LOOP
    rez := toate->'a0'->'r'->>('swap|' || et);
    IF rez IS DISTINCT FROM poarta OR substr(rez, 7) ~ '[0-9]' THEN RAISE EXCEPTION 'T3e FAIL: A0 (fără modul) la schimbul de țevi %: %', et, rez; END IF;
    n_lit := n_lit + 1;
  END LOOP;
  IF NOT (e->'tevi') ? 'p3' THEN PERFORM pg_temp.t_neprobat('T3e literal swap: nu există două țevi pe p3'); END IF;
  -- (d) despre apelant, interne, RPC-ul owner-ului
  FOREACH cont IN ARRAY ARRAY['a0', 'a', 'b', 'b0'] LOOP
    m := toate->cont->'x';
    IF m->>'e_owner' <> 'false' OR m->>'nerestrans' <> (cont IN ('a', 'a0'))::text OR m->>'alt_bucket' <> 'true' OR m->>'inbox_propriu_nou' <> 'true' THEN
      RAISE EXCEPTION 'T3e FAIL: predicatele despre apelant pentru %: %', cont, jsonb_build_array(m->'e_owner', m->'nerestrans', m->'alt_bucket', m->'inbox_propriu_nou');
    END IF;
    FOR et IN SELECT x FROM jsonb_object_keys(m) x WHERE x LIKE 'i\_%' LOOP
      IF coalesce(m->>et, '') NOT LIKE '42501 permission denied for function fn\_executie\_acces\_%' THEN
        RAISE EXCEPTION 'T3e FAIL: funcția internă % apelabilă de % : %', et, cont, left(m->>et, 120);
      END IF;
      n := n + 1;
    END LOOP;
    IF (SELECT count(*) FROM jsonb_object_keys(m) x WHERE x LIKE 'i\_%') <> 6 THEN RAISE EXCEPTION 'T3e FAIL: lipsesc probe pe funcțiile interne'; END IF;
    IF coalesce(m->>'seteaza_existent', '') NOT LIKE '42501 acces proiect: doar owner-ul%' OR m->>'seteaza_existent' IS DISTINCT FROM m->>'seteaza_inexistent'
       OR m->>'seteaza_existent' IS DISTINCT FROM toate->'b'->'x'->>'seteaza_existent' THEN
      RAISE EXCEPTION 'T3e FAIL: RPC-ul de setare ca non-owner (%): % / %', cont, m->>'seteaza_existent', m->>'seteaza_inexistent';
    END IF;
  END LOOP;
  IF to_regprocedure('public.fn_executie_acces_parinti(text, boolean)') IS NOT NULL
     OR to_regprocedure('public.fn_executie_acces_obiect_proiecte(text, text)') IS NOT NULL
     OR to_regprocedure('public.fn_executie_acces_inbox_obiect(text, boolean)') IS NOT NULL
     OR to_regprocedure('public.fn_executie_acces_inbox_propriu(text, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'T3e FAIL: o rezolvare brută (setul părinților / proiectele unui obiect / fișierul Inboxului / folderul propriu r9) încă există';
  END IF;
  IF (SELECT count(*) FROM public.executie_acces_proiect) <> 3 THEN RAISE EXCEPTION 'T3e FAIL: apelurile au scris în lista de acces'; END IF;
  -- verificarea anti-oracol trebuie să fi rulat efectiv pe conturile restrânse (nu doar pe cele pentru care totul e „adevărat”)
  IF n_or_b = 0 OR n_or_b0 = 0 OR n_lit = 0 THEN
    RAISE EXCEPTION 'T3e FAIL: perechi existent invizibil / inexistent probate: B %, B0 %, literale % (trebuie > 0)', n_or_b, n_or_b0, n_lit;
  END IF;
  RAISE NOTICE 'T3e OK (% funcții × argumente × 4 conturi: % verificări de specificație, % perechi existent invizibil = inexistent — B %, B0 % —, % cazuri literale din r8, % interne = 42501)',
    (SELECT count(*) FROM t_exp_fn), n_spec, n_oracol, n_or_b, n_or_b0, n_lit, n;
END $t$;

-- ── T3x: ce rămâne EXCLUS (decizie scrisă): câte rânduri ale lui p3 vede B pe fiecare tabel exclus din catalog (informativ) ──
DO $t$
DECLARE r record; n bigint; v text := '';
BEGIN
  FOR r IN SELECT t.*, (SELECT i.motiv FROM t_inv i WHERE (i.tip = 'tabel' AND i.obiect = t.nume) OR (i.tip = 'prefix_tabel' AND starts_with(t.nume, i.obiect)) LIMIT 1) AS motiv
             FROM t_tab t WHERE t.clasa = 'exclus' AND t.expr IS NOT NULL ORDER BY t.nume LOOP
    IF NOT has_table_privilege(r.rel, 'SELECT') THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s t WHERE (%s) = $1', r.rel::regclass, r.expr) INTO n USING pg_temp.t_g('p3')::bigint;
    EXCEPTION WHEN OTHERS THEN n := NULL;
    END;
    IF coalesce(n, 0) > 0 THEN v := v || format('%s: %s rânduri (%s); ', r.nume, n, left(r.motiv, 60)); END IF;
  END LOOP;
  RAISE NOTICE 'T3x (informativ) excluse vizibile lui B pe p3: %', CASE WHEN v = '' THEN 'niciunul' ELSE v END;
END $t$;

-- ── T4: C (modul viewer, restrâns pe p1 editor): proiectul nu ridică dreptul de modul; A și owner-ul: amprenta IDENTICĂ ──
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb := pg_temp.t_vede(); v0 jsonb := pg_temp.t_g('mc0')::jsonb->'vede'; k text; p1 bigint := pg_temp.t_g('p1')::bigint;
BEGIN
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF v->k->0 IS DISTINCT FROM v0->k->0 OR (v->k->>1)::bigint <> 0 OR (v->k->>2)::bigint <> 0
       OR (pg_temp.t_nul_permis(k) AND v->k->3 IS DISTINCT FROM v0->k->3) THEN
      RAISE EXCEPTION 'T4 FAIL: citire C pe %: după % / înainte %', k, v->k, v0->k;
    END IF;
  END LOOP;
  IF NOT public.fn_executie_proiect_permis(p1, true) OR public.fn_executie_nod_drept(p1, true) OR NOT public.fn_executie_nod_drept(p1, false)
     OR public.fn_executie_tinte_drept(p1, 'configurare') THEN
    RAISE EXCEPTION 'T4 FAIL: C (modul viewer) a primit scriere prin proiect';
  END IF;
  -- r9 (P2): schimbul de țevi cere scrierea pe MODUL — C (viewer pe modul, editor pe p1) e refuzat de poartă, ca țeava inexistentă
  IF pg_temp.t_g('tevi1') IS NOT NULL
     AND pg_temp.t_proba(format('SELECT public.fn_executie_swap_tevi_pozitie(%s, %s)', split_part(pg_temp.t_g('tevi1'), ',', 1), split_part(pg_temp.t_g('tevi1'), ',', 2)))
         IS DISTINCT FROM '42501 Execuție: nu ai drept de scriere pe acest proiect' THEN
    RAISE EXCEPTION 'T4 FAIL: C (modul viewer) schimbă țevile pe p1';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$ DECLARE m jsonb := pg_temp.t_amprenta(); BEGIN
  -- (rândurile scrise în T3d nu sunt în t_rand / t_ib, deci nu schimbă amprenta)
  IF m IS DISTINCT FROM pg_temp.t_g('mo0')::jsonb THEN
    RAISE EXCEPTION 'T4 FAIL: owner-ul, cu B și C restrânși, are altă amprentă decât înainte: %', pg_temp.t_dif(m, pg_temp.t_g('mo0')::jsonb);
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('a')::uuid, 'authenticated');
DO $t$ DECLARE m jsonb := pg_temp.t_amprenta(); BEGIN
  IF m IS DISTINCT FROM pg_temp.t_g('ma0')::jsonb OR EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION 'T4 FAIL: A (nerestrâns) afectat / vede rândurile altora: %', pg_temp.t_dif(m, pg_temp.t_g('ma0')::jsonb);
  END IF;
  -- poarta swap: pentru un editor nerestrâns schimbul pe p3 reușește ca azi
  IF pg_temp.t_g('tevi3') IS NOT NULL
     AND pg_temp.t_proba(format('SELECT public.fn_executie_swap_tevi_pozitie(%s, %s)', split_part(pg_temp.t_g('tevi3'), ',', 1), split_part(pg_temp.t_g('tevi3'), ',', 2))) <> 'OK 1' THEN
    RAISE EXCEPTION 'T4 FAIL: A (nerestrâns) nu mai schimbă țevile pe p3';
  END IF;
  -- r9 (P2): țeava inexistentă nu mai ajunge la original nici pentru contul nerestrâns: refuzul porții (fără id-uri), nu mesajul de azi
  -- (TB, același cont: înainte trebuia să fie tot un refuz, al originalului)
  IF pg_temp.t_g('swap0') IS NULL OR pg_temp.t_g('swap0') LIKE 'OK %' THEN
    RAISE EXCEPTION 'T4 FAIL: înainte de migrare, țeava inexistentă nu era refuzată (%): comparația n-ar dovedi nimic', pg_temp.t_g('swap0');
  END IF;
  IF pg_temp.t_proba('SELECT public.fn_executie_swap_tevi_pozitie(-1, -2)') IS DISTINCT FROM '42501 Execuție: nu ai drept de scriere pe acest proiect' THEN
    RAISE EXCEPTION 'T4 FAIL: A (nerestrâns), țeavă inexistentă: % (așteptat refuzul porții; azi: %)', pg_temp.t_proba('SELECT public.fn_executie_swap_tevi_pozitie(-1, -2)'), pg_temp.t_g('swap0');
  END IF;
  RAISE NOTICE 'T4 OK (owner și A: amprenta identică cu cea de dinainte)';
END $t$;

-- ── T5: RPC-ul de setare: refuzuri, CAS, idempotență, scoaterea restricției ──
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$
DECLARE r jsonb; acum jsonb := pg_temp.t_lista('p1:editor,p2:viewer'); s text; c text; v_rez text;
BEGIN
  IF pg_temp.t_stare(format('SELECT pg_temp.t_seteaza(%L, true, %L::jsonb, %L::jsonb)', 'b', '[]', acum)) NOT LIKE '22023 %lista goală%' THEN RAISE EXCEPTION 'T5 FAIL: lista goală'; END IF;
  IF pg_temp.t_stare(format('SELECT pg_temp.t_seteaza(%L, false, %L::jsonb, %L::jsonb)', 'b', pg_temp.t_lista('p1:editor'), acum)) NOT LIKE '22023 %nu primește proiecte%' THEN RAISE EXCEPTION 'T5 FAIL: scoate restricția cu proiecte'; END IF;
  -- r5: fiecare element invalid cu motivul LUI (SQLSTATE + fragment), nu orice 22023
  FOR s, c IN SELECT * FROM (VALUES
      (format('[{"proiect_id":"%s","nivel":"editor"}]', pg_temp.t_g('p1')), 'întreg pozitiv'),
      (format('[{"proiect_id":%s,"nivel":"editor","x":1}]', pg_temp.t_g('p1')), 'exact proiect_id și nivel'),
      (format('[{"proiect_id":%s,"nivel":"admin"}]', pg_temp.t_g('p1')), 'întreg pozitiv'),
      (format('[{"proiect_id":%s,"nivel":"editor"},{"proiect_id":%s,"nivel":"viewer"}]', pg_temp.t_g('p1'), pg_temp.t_g('p1')), 'apare de două ori'),
      (format('[{"proiect_id":%s,"nivel":"editor"}]', (SELECT max(id) + 1000 FROM public.executie_proiecte)), 'nu există'),
      (format('[{"proiect_id":%s.5,"nivel":"editor"}]', pg_temp.t_g('p1')), 'întreg pozitiv'),
      ('[{"proiect_id":0,"nivel":"editor"}]', 'întreg pozitiv'), ('{"proiect_id":1}', 'trebuie să fie un tablou'), ('[null]', 'element invalid')) q(lista, motiv) LOOP
    v_rez := pg_temp.t_stare(format('SELECT pg_temp.t_seteaza(%L, true, %L::jsonb, %L::jsonb)', 'b', s, acum));
    IF v_rez NOT LIKE '22023 acces proiect: %' OR position(c IN v_rez) = 0 THEN RAISE EXCEPTION 'T5 FAIL: element invalid % — rezultat % (așteptat: 22023 … %)', s, v_rez, c; END IF;
  END LOOP;
  IF pg_temp.t_stare(format('SELECT public.fn_executie_acces_proiect_seteaza(%L::uuid, true, %L::jsonb, %L::jsonb)', pg_temp.t_g('own'), pg_temp.t_lista('p1:editor'), '[]')) NOT LIKE '22023 %owner%'
     OR pg_temp.t_stare(format('SELECT public.fn_executie_acces_proiect_seteaza(gen_random_uuid(), true, %L::jsonb, %L::jsonb)', pg_temp.t_lista('p1:editor'), '[]')) NOT LIKE '22023 %nu există%' THEN
    RAISE EXCEPTION 'T5 FAIL: ținta owner / cont inexistent';
  END IF;
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p1:editor'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'motiv' IS DISTINCT FROM 'conflict' OR (SELECT count(*) FROM public.executie_acces_proiect WHERE profile_id = pg_temp.t_g('b')::uuid) <> 2 THEN
    RAISE EXCEPTION 'T5 FAIL: CAS %', r;
  END IF;
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p2:viewer,p1:editor'), '[]'::jsonb);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'duplicat' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'T5 FAIL: idempotență %', r; END IF;
  r := pg_temp.t_seteaza('b', true, pg_temp.t_lista('p1:viewer,p3:editor'), acum);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->'lista' IS DISTINCT FROM (SELECT jsonb_agg(e ORDER BY (e->>'proiect_id')::bigint) FROM jsonb_array_elements(pg_temp.t_lista('p1:viewer,p3:editor')) e)
     OR (SELECT array_agg(proiect_id || ':' || nivel ORDER BY proiect_id) FROM public.executie_acces_proiect WHERE profile_id = pg_temp.t_g('b')::uuid)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY split_part(x, ':', 1)::bigint) FROM unnest(ARRAY[pg_temp.t_g('p1') || ':viewer', pg_temp.t_g('p3') || ':editor']) x) THEN
    RAISE EXCEPTION 'T5 FAIL: schimbarea %', r;
  END IF;
  IF pg_temp.t_stare(format('INSERT INTO public.executie_acces_proiect (profile_id, proiect_id) VALUES (%L, %s)', pg_temp.t_g('a'), pg_temp.t_g('p1'))) NOT LIKE '42501 permission denied for table executie_acces_proiect%'
     OR pg_temp.t_stare(format('DELETE FROM public.executie_acces_proiect WHERE profile_id = %L', pg_temp.t_g('b'))) NOT LIKE '42501 permission denied for table executie_acces_proiect%' THEN
    RAISE EXCEPTION 'T5 FAIL: scriere directă în tabelul de acces';
  END IF;
  r := pg_temp.t_seteaza('b', false, '[]'::jsonb, pg_temp.t_lista('p1:viewer,p3:editor'));
  IF r->>'ok' IS DISTINCT FROM 'true' OR EXISTS (SELECT 1 FROM public.executie_acces_proiect WHERE profile_id = pg_temp.t_g('b')::uuid) THEN RAISE EXCEPTION 'T5 FAIL: scoate restricția %', r; END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('b')::uuid, 'authenticated');
DO $t$
DECLARE v jsonb := pg_temp.t_vede(); v0 jsonb := pg_temp.t_g('mb0')::jsonb->'vede'; k text;
BEGIN
  -- B nerestrâns din nou: vede exact ce vedea înainte
  FOR k IN SELECT jsonb_object_keys(v0) LOOP
    IF v->k IS DISTINCT FROM v0->k THEN RAISE EXCEPTION 'T5 FAIL: B după scoaterea restricției, pe %: % vs %', k, v->k, v0->k; END IF;
  END LOOP;
  IF pg_temp.t_inbox_stare() IS DISTINCT FROM pg_temp.t_g('mb0')::jsonb->'inbox' THEN RAISE EXCEPTION 'T5 FAIL: B după scoaterea restricției, în Inbox'; END IF;
  IF pg_temp.t_propriu() IS DISTINCT FROM pg_temp.t_g('pb0')::jsonb THEN RAISE EXCEPTION 'T5 FAIL: B după scoaterea restricției, folderul propriu (T3f)'; END IF;
  RAISE NOTICE 'T5 OK';
END $t$;

-- ── T6: FK RESTRICT — un proiect cu conturi restrânse pe el nu se șterge (lista nu se golește pe tăcute) ──
SELECT pg_temp.t_ca(NULL, 'postgres');
DO $t$ DECLARE x text; v_cols text; v_np bigint; BEGIN
  IF (SELECT array_agg(confdeltype::text) FROM pg_constraint WHERE conrelid = 'public.executie_acces_proiect'::regclass AND contype = 'f'
        AND confrelid = 'public.executie_proiecte'::regclass) IS DISTINCT FROM ARRAY['r'] THEN
    RAISE EXCEPTION 'T6 FAIL: cheia străină a tabelului de acces nu e RESTRICT';
  END IF;
  -- r5: refuzul trebuie să fie al cheii străine a tabelului de acces (SQLSTATE + mesaj + tabel). Un proiect real are și alți copii (pică
  -- întâi altă cheie), deci proba se face pe o COPIE fără copii a lui p1, cu un singur rând de acces, într-un bloc anulat la final.
  BEGIN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name <> 'id' AND is_identity = 'NO' AND is_generated = 'NEVER';
    EXECUTE format('INSERT INTO public.executie_proiecte (%s) SELECT %s FROM public.executie_proiecte WHERE id = $1 RETURNING id', v_cols, v_cols)
      INTO v_np USING pg_temp.t_g('p1')::bigint;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name = 'cod_intern') THEN
      EXECUTE 'UPDATE public.executie_proiecte SET cod_intern = ''TEST-ACCES-T6'' WHERE id = $1' USING v_np;
    END IF;
    INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES (pg_temp.t_g('c')::uuid, v_np, 'viewer');
    x := pg_temp.t_proba(format('DELETE FROM public.executie_proiecte WHERE id = %s', v_np));
    RAISE EXCEPTION USING ERRCODE = 'TACC1', MESSAGE = 'anulare T6';
  EXCEPTION WHEN SQLSTATE 'TACC1' THEN NULL;
            WHEN OTHERS THEN x := 'pregătire: ' || SQLSTATE || ' ' || left(SQLERRM, 140);
  END;
  -- RESTRICT = 23001 „violates RESTRICT setting…” (PG 16+; PGlite și producția); 23503 doar pe versiunile vechi, tot cu tabelul de acces
  IF x LIKE '23001 %violates RESTRICT setting of foreign key constraint%on table "executie_acces_proiect"%'
     OR x LIKE '23503 %violates foreign key constraint%on table "executie_acces_proiect"%' THEN NULL;
  ELSIF x LIKE '23001 %' OR x LIKE '23503 %' OR x LIKE 'pregătire: %' THEN
    PERFORM pg_temp.t_neprobat('T6: ștergerea copiei de proiect neizolată (' || left(x, 160) || ')');
  ELSE RAISE EXCEPTION 'T6 FAIL: ștergerea unui proiect cu un cont restrâns pe el: %', x; END IF;
  RAISE NOTICE 'T6 OK';
END $t$;

-- ── T7: revenirea — nearmată = refuz; armată cu un cont restrâns (C) = refuz; nimic atins ──
SELECT set_config('tacc.ngarzi', (SELECT count(*) FROM t_inv WHERE tip = 'tabel' AND clasa IN ('proiect', 'proiect_optional', 'copil', 'inbox'))::text, true);
SAVEPOINT t7a;
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql
\set t7a_eroare :ERROR
\set t7a_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7a;
SELECT pg_temp.t_eroare('T7a', :'t7a_eroare', :'t7a_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'garda invalida');
SAVEPOINT t7b;
SELECT set_config('gazpet.revenire_20261209a', 'SCOATE_ACCES_PROIECT:' || txid_current(), true);
\set ON_ERROR_STOP 0
\ir ../supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql
\set t7b_eroare :ERROR
\set t7b_stare :SQLSTATE
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT t7b;
SELECT pg_temp.t_eroare('T7b', :'t7b_eroare', :'t7b_stare', :'LAST_ERROR_MESSAGE', 'P0001', 'exista conturi restranse');
DO $t$ BEGIN
  IF (SELECT count(*) FROM public.executie_acces_proiect) <> 1 OR to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)') IS NULL
     OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda') <> pg_temp.t_g('ngarzi')::integer
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'executie\_acces\_%') <> 4
     OR to_regprocedure('executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)') IS NULL THEN
    RAISE EXCEPTION 'T7 FAIL: revenirea refuzată a atins ceva';
  END IF;
  RAISE NOTICE 'T7 OK';
END $t$;

-- ── T8: owner-ul scoate restricția lui C; revenirea armată scoate tot și redă corpurile vechi; vizibilitatea = cea de dinainte; re-aplicarea merge ──
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
SELECT pg_temp.t_seteaza('c', false, '[]'::jsonb, pg_temp.t_lista('p1:editor'));
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('gazpet.revenire_20261209a', 'SCOATE_ACCES_PROIECT:' || txid_current(), true);
\ir ../supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_acces_proiect') IS NOT NULL
     -- r6: și funcțiile noi (candidații clasificatorului + regula pe cont): fără ele edge-ul citeste-orice revine la calea de azi
     OR to_regprocedure('public.fn_executie_acces_candidati(uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_executie_acces_nerestrans_cont(uuid)') IS NOT NULL
     OR to_regprocedure('public.fn_executie_acces_lista_cont(uuid, boolean)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polname LIKE 'executie\_acces\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda')
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_executie_nod_drept(bigint, boolean)'::regprocedure), chr(13), '')) <> '144649bae9a218b41b7e6df90cba5d9e'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_raport_santier_drept(bigint)'::regprocedure), chr(13), '')) <> '2c8833d76db7145ab0bd2fc5103e55e9'
     -- originalul swap înapoi în public, cu amprenta din inventar; schema internă ștearsă
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.fn_executie_swap_tevi_pozitie(bigint, bigint)')), chr(13), ''))
        IS DISTINCT FROM (SELECT cheie FROM t_inv WHERE tip = 'functie' AND obiect = 'fn_executie_swap_tevi_pozitie')
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'executie_acces_intern')
     OR (SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', polrelid::regclass, polname, polpermissive, polroles,
                                               coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')), ';'
                                        ORDER BY polrelid::regclass::text, polname), ''))
           FROM pg_policy WHERE polrelid IN (SELECT rel FROM t_tab) OR polrelid = 'storage.objects'::regclass) IS DISTINCT FROM pg_temp.t_g('pol0') THEN
    RAISE EXCEPTION 'T8 FAIL: după revenire';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('c')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.t_vede() IS DISTINCT FROM pg_temp.t_g('mc0')::jsonb->'vede' THEN
    RAISE EXCEPTION 'T8 FAIL: C după revenire vede altceva decât înainte';
  END IF;
END $t$;
SELECT pg_temp.t_ca(pg_temp.t_g('own')::uuid, 'authenticated');
DO $t$ BEGIN
  IF pg_temp.t_vede() IS DISTINCT FROM pg_temp.t_g('mo0')::jsonb->'vede' OR pg_temp.t_inbox_stare() IS DISTINCT FROM pg_temp.t_g('mo0')::jsonb->'inbox' THEN
    RAISE EXCEPTION 'T8 FAIL: owner-ul după revenire vede altceva decât înainte';
  END IF;
END $t$;
SELECT pg_temp.t_ca(NULL, 'postgres');
SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);
\ir ../supabase/migrations/20261209a_executie_acces_proiect.sql
DO $t$ BEGIN
  IF to_regclass('public.executie_acces_proiect') IS NULL
     OR to_regprocedure('public.fn_executie_acces_candidati(uuid)') IS NULL
     OR NOT has_function_privilege('service_role', 'public.fn_executie_acces_candidati(uuid)', 'EXECUTE')
     OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda') <> pg_temp.t_g('ngarzi')::integer
     OR to_regprocedure('executie_acces_intern.fn_executie_swap_tevi_pozitie(bigint, bigint)') IS NULL THEN
    RAISE EXCEPTION 'T8 FAIL: re-aplicarea';
  END IF;
  RAISE NOTICE 'NEPROBAT pe datele acestei baze: %', coalesce(pg_temp.t_g('neprobat'), 'nimic');
  RAISE NOTICE 'T8 OK — toate testele 20261209a au trecut';
END $t$;
ROLLBACK;
