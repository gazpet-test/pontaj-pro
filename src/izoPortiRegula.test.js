// REGULA porților Izometrie (docs/izometrie/PORTI_REGULA.md): regresiile detectorului scripts/izometrie/porti_regula.mjs.
// Rulat în CI de .github/workflows/izometrie-porti-regula.yml la orice PR pe migrări / reveniri / detector (inclusiv draft-uri).
// Așteptările sunt scrise de mână din amprentele porților (fn_izo_porti_*_definitii) și din exemplele review-ului PR #1146 r1
// (Jakarinos P2-1..P2-3), nu din codul testat. Mutanții de la final dovedesc că bateria prinde fiecare regulă scoasă.
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as R from '../scripts/izometrie/porti_regula.mjs'

const RAD = fileURLToPath(new URL('..', import.meta.url))
const DETECTOR = join(RAD, 'scripts', 'izometrie', 'porti_regula.mjs')
const citeste = (rel) => readFileSync(join(RAD, rel), 'utf8').replace(/\r/g, '')
const MIGRARI = R.fisiere(RAD).filter((f) => f.cale.startsWith('migrations/')).map((f) => f.text)
const POARTA = citeste(R.POARTA_REL)
const VINOVATE = ['20261209a_executie_acces_proiect.sql', '20261211a_executie_fibra_optica.sql', '20261218a_securitate_anon_drepturi.sql']
const TEXT_VINOVATE = Object.fromEntries(VINOVATE.map((f) => [f, citeste(`supabase/migrations/${f}`)]))

// ritualul canonic (forma din document): PRE → schimbarea → 5 ștampile calculate → POST, în blocuri DO
const GARDA = (msg) => `  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION '${msg}'; END IF;`
const PRE = `DO $pre$\nBEGIN\n${GARDA('porti rosii inainte')}\nEND $pre$;\n`
const STAMPILA = (f, p) => `  EXECUTE format('COMMENT ON FUNCTION public.${f}() IS %L', '${p}=' || public.${f}());`
const STAMPILE = (lista = R.STAMPILE) => lista.map(([f, p]) => STAMPILA(f, p)).join('\n')
const DUPA = `DO $dupa$\nBEGIN\n${STAMPILE()}\n${GARDA('porti rosii dupa')}\nEND $dupa$;\n`
const ritual = (schimbare) => `${PRE}${schimbare}\n${DUPA}`
const LITERALE = R.STAMPILE.map(([f, p]) => `COMMENT ON FUNCTION public.${f}() IS '${p}=00000000000000000000000000000000';`).join('\n')
const EXCEPTIE = '-- IZO_PORTI: neatins — coloana nouă nu intră în nicio amprentă (verificat pe definiții)'

// ─── cazurile (tabele de mână) ─────────────────────────────────────────────────────────────────────────────────────────
// [sql, sigur] — fiecare trebuie să ATINGĂ perimetrul (și să fie refuzat fără ritual)
const ATINGE = [
  // P2-2: exemplele lui Jak
  ['DROP TABLE public.izo_importuri;', true],
  ['CREATE OR REPLACE FUNCTION public.fn_executie_acces_garda() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$ BEGIN RETURN NEW; END $f$;', true],
  // tabele / funcții / trigger-e izo
  ['DROP TABLE IF EXISTS public.alt, public.izo_fronturi CASCADE;', true],
  ['ALTER TABLE public.izo_fronturi DROP COLUMN x;', true],
  ['CREATE OR REPLACE FUNCTION public.fn_izo_x() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;', true],
  ['DROP FUNCTION public.fn_izo_x(integer);', true],
  ['ALTER FUNCTION public.fn_izo_x() OWNER TO postgres;', true],
  ['REVOKE EXECUTE ON FUNCTION public.fn_izo_doc_salveaza(jsonb) FROM authenticated;', true],
  // funcțiile trigger-elor de pe tabelele E4 (corpul intră în amprenta E4), derivate din migrări
  ['ALTER FUNCTION public.fn_executie_fibra_garda_tronson() SET search_path = public;', true],
  ['DROP FUNCTION public.fn_executie_acces_garda_copil();', true],
  ['DROP TRIGGER trg_executie_acces_garda ON public.executie_tevi;', true],
  ['CREATE TRIGGER t_nou BEFORE UPDATE ON public.executie_pachete_documente FOR EACH ROW EXECUTE FUNCTION public.f_oarecare();', true],
  ['ALTER TABLE public.executie_tevi DISABLE TRIGGER ALL;', true],
  // SQL dinamic cu ținta necunoscută (ca 20261209a / 20261218a)
  ["DO $$ BEGIN EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', 'x'); END $$;", true],
  ["DO $$ DECLARE s text; BEGIN FOR s IN SELECT relname FROM pg_class WHERE relkind = 'S' LOOP EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', s); END LOOP; END $$;", true],
  ["DO $$ BEGIN EXECUTE 'DROP TABLE ' || quote_ident('x'); END $$;", true],
  // drepturi: secvențe amprentate, tot schema, schema public pentru rolurile izo, rolurile izo
  ['REVOKE USAGE ON SEQUENCE public.magazie_bucati_id_seq FROM anon;', true],
  ['GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;', true],
  ['GRANT CREATE ON SCHEMA public TO izo_cor_editor;', true],
  ['GRANT izo_doc_editor TO authenticated;', true],
  ['DROP ROLE izo_teren_editor;', true],
  // politici / RLS / indexuri amprentate
  ['CREATE POLICY p_nou ON public.executie_proiecte FOR SELECT USING (true);', true],
  ['CREATE POLICY izo_doc_x ON storage.objects FOR SELECT USING (true);', true],
  ['ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;', true],
  ['CREATE INDEX ix_alt ON public.profiles (email);', true],
  // închiderea citirilor porții E2
  ['CREATE VIEW public.v_alt AS SELECT * FROM public.magazie_bucati;', true],
  ["CREATE FUNCTION public.f_dinamic() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN EXECUTE 'SELECT 1'; END $f$;", true],
  ['CREATE FUNCTION public.f_cit() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $f$ SELECT count(*) FROM public.izo_importuri $f$;', true],
  ['ALTER TABLE public.alt ADD CONSTRAINT c_izo CHECK (public.fn_izo_citire(proiect_id));', true],
  // listele revizuite ale porții E2 (c_dinamice_revizuite / c_implicite_revizuite) + handle_new_user
  ['CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN RETURN NEW; END $f$;', true],
  ['CREATE OR REPLACE FUNCTION public.fn_portal_porti_lipsa() RETURNS text[] LANGUAGE sql AS $f$ SELECT ARRAY[]::text[] $f$;', true],
  ['DROP TRIGGER trg_employees_persoana_lock ON public.employees;', true],
  // redenumire, bucket, catalog
  ['ALTER TABLE public.alt RENAME TO izo_alt;', true],
  ["UPDATE storage.buckets SET public = true WHERE id = 'izo-documente';", true],
  ['REASSIGN OWNED BY rol_vechi TO postgres;', true],
  ['UPDATE pg_catalog.pg_proc SET prosecdef = false;', true],
  // „posibile”: ating perimetrul, dar nu sigur o amprentă — excepția declarată e acceptată
  ['ALTER TABLE public.profiles ADD COLUMN x int;', false],
  ['ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;', false],
  ['CREATE EVENT TRIGGER e_nou ON ddl_command_end EXECUTE FUNCTION public.f();', false],
  ['DROP TABLE public.alt CASCADE;', false],
  ['CREATE FUNCTION public.f_inv() RETURNS bigint LANGUAGE sql AS $f$ SELECT count(*) FROM public.magazie_bucati $f$;', false],
  ['CREATE TRIGGER t2 BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.f();', false],
]
// în afara perimetrului: nimic de cerut
const NEATINS = [
  'CREATE TABLE public.alt (id int REFERENCES public.profiles(id));',
  'CREATE POLICY p ON public.alt USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));',
  "CREATE POLICY alt_cit ON storage.objects FOR SELECT USING (bucket_id = 'alt');",
  'GRANT SELECT ON public.alt TO authenticated;',
  'REVOKE ALL ON SEQUENCE public.alt_id_seq FROM anon;',
  "INSERT INTO storage.buckets (id, name) VALUES ('alt', 'alt');",
  "CREATE FUNCTION public.f_inv2() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN EXECUTE 'SELECT 1'; END $f$;",
  'CREATE INDEX i ON public.profiles_vechi (id);',
  'CREATE TRIGGER t BEFORE UPDATE ON public.executie_tevi_arhiva FOR EACH ROW EXECUTE FUNCTION f();',
  'INSERT INTO pg_temp.x VALUES (1);',
  'CREATE TEMP TABLE tmp_x ON COMMIT DROP AS SELECT * FROM public.magazie_bucati;',
  "DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon'] LOOP EXECUTE format('REVOKE ALL ON public.alt FROM %I', r); END LOOP; END $$;",
  // totul doar în comentarii (P2-3: comentariile se scot înainte de analiză)
  '-- ALTER TABLE profiles ADD COLUMN x int;\n/* DROP TABLE public.izo_importuri; /* imbricat */ DROP ROLE izo_x; */\nSELECT 1;',
]
// r3 (Jak r2 P2): literalii folosiți ca DATE nu sunt DDL executat → nicio atingere, nimic de cerut
const LITERALI_DATE = [
  "CREATE FUNCTION public.alt_text() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'ALTER TABLE public.executie_proiecte DISABLE ROW LEVEL SECURITY; GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;'::text $$;",
  "COMMENT ON TABLE public.alt IS 'DROP TABLE public.izo_importuri; GRANT izo_doc_editor TO anon';",
  "INSERT INTO public.alt (sql) VALUES ('DROP TABLE public.izo_importuri;'), ($q$REVOKE ALL ON SEQUENCE public.magazie_bucati_id_seq FROM anon$q$);",
  "CREATE TABLE public.alt (nota text DEFAULT 'DROP TABLE public.izo_importuri' CHECK (nota <> 'ALTER TABLE public.profiles ADD COLUMN x int'));",
  "DO $$ BEGIN RAISE NOTICE 'DROP TABLE public.izo_importuri'; END $$;",
  "SELECT format('DROP TABLE public.%I', 'izo_importuri');",
  "SELECT jsonb_build_object('sql', 'GRANT CREATE ON SCHEMA public TO izo_cor_editor');",
  "SELECT E'DROP ROLE izo_teren_editor;\\n'::text;",
  "CREATE FUNCTION public.alt_f(p text DEFAULT 'DROP TABLE public.alt CASCADE') RETURNS text LANGUAGE sql AS $$ SELECT p $$;",
  // view cu literali care seamănă cu tabelele registrului (ca 20261107a, '^izo_e3_ocr:'): poarta leagă view-urile de tabele prin
  // pg_depend, unde un literal nu intră
  "CREATE VIEW public.v_alt AS SELECT 'izo_importuri'::text AS x, r.cheie FROM public.alt r WHERE r.cheie ~ '^izo_e3_ocr:[0-9]+$';",
]
// exemplul EXACT al lui Jak (r2): fără „DROP TABLE”, fără atingere sigură, excepția declarată acceptată. Rămâne „posibilă” atingerea
// „corp care numește registrul”: poarta E2 citește prosrc TEXTUAL (cu literali), deci funcția intră în închiderea ei
const JAK_R2 = "CREATE FUNCTION public.alt_mesaj() RETURNS text\nLANGUAGE sql IMMUTABLE AS $$\n  SELECT 'DROP TABLE public.izo_importuri;'::text\n$$;"
// același text, dar EXECUTAT (sau citit ca nume de obiect) → atingere; [sql, sigur]
const LITERALI_ATINSI = [
  ["DO $$ BEGIN EXECUTE 'DROP TABLE public.izo_importuri;'; END $$;", true],
  ["CREATE FUNCTION public.alt_exec() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'DROP TABLE public.izo_importuri;'; END $$;", true],
  ["DO $$ DECLARE s text := 'DROP TABLE public.izo_importuri;'; BEGIN EXECUTE s; END $$;", true],
  ["DO $$ BEGIN EXECUTE format('%s', 'DROP TABLE public.izo_importuri;'); END $$;", true],
  ['DO $$ BEGIN EXECUTE $q$DROP TABLE public.izo_importuri$q$; END $$;', true],
  ["CREATE FUNCTION public.alt_sql() RETURNS void LANGUAGE sql AS 'DROP TABLE public.izo_importuri';", true],
  ["DO 'BEGIN DROP TABLE public.izo_importuri; END';", true],
  ["DO LANGUAGE plpgsql 'BEGIN DROP TABLE public.izo_importuri; END';", true],
  ["SELECT 'DROP TABLE public.izo_importuri' \\gexec", true],
  ["\\set q 'DROP TABLE public.izo_importuri'\n:q;", true],
  ["SELECT public.ruleaza_sql('DROP TABLE public.izo_importuri');", true],
  ["SELECT public.ruleaza_sql(format('%s', 'DROP TABLE public.izo_importuri'));", true],
  ["SELECT public.format('DROP TABLE public.izo_importuri');", true],
  ["SELECT dblink_exec('dbname=x', 'DROP TABLE public.izo_importuri');", true],
  ["SELECT cron.schedule('j', '0 3 * * *', $c$DROP TABLE public.izo_importuri$c$);", true],
  // corp DEFINER care numește registrul DOAR într-un literal: poarta citește prosrc textual → DEFINER în închidere = roșu
  ["CREATE FUNCTION public.alt_def() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$ SELECT 'izo_importuri'::text $f$;", true],
  // fn_izo_* numit DOAR într-un literal, într-un corp INVOKER / într-un view: poarta caută wrapper-ele registrului TEXTUAL
  // (prosrc ~* 'fn_izo_(seteaza_nivel|…)', pg_get_ruledef ~* …), deci e roșu, ca un apel scris
  ["CREATE FUNCTION public.alt_inv() RETURNS text LANGUAGE sql AS $f$ SELECT 'fn_izo_seteaza_nivel'::text $f$;", true],
  ["CREATE VIEW public.v_alt AS SELECT 'fn_izo_seteaza_nivel'::text AS x;", true],
  // constanta regclass într-un CHECK = dependență în catalog (ca numele scris)
  ["CREATE TABLE public.alt (id int CHECK ('public.izo_importuri'::regclass IS NOT NULL));", false],
]

// r4 (Jak r3 P2-1): corpul scris ca literal ('…' cu ghilimelele dublate, E'…' cu \') e EXACT textul decodat (ce ajunge în prosrc /
// se execută) → aceeași judecată ca forma $$; exemplul exact al lui Jak r3 = exemplul r2 în forma AS '…'
const JAK_R3 = "CREATE FUNCTION public.alt_mesaj() RETURNS text\nLANGUAGE sql IMMUTABLE\nAS 'SELECT ''DROP TABLE public.izo_importuri;''::text';"
const LITERALI_DATE_R4 = [
  "CREATE FUNCTION public.alt_text2() RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT ''ALTER TABLE public.executie_proiecte DISABLE ROW LEVEL SECURITY; GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;''::text';",
  "DO 'BEGIN RAISE NOTICE ''DROP TABLE public.izo_importuri''; END';",
  "DO E'BEGIN RAISE NOTICE \\'DROP TABLE public.izo_importuri\\'; END';",
  "DO LANGUAGE plpgsql 'BEGIN RAISE NOTICE ''GRANT CREATE ON SCHEMA public TO izo_cor_editor''; END';",
  "CREATE FUNCTION public.alt_f2(p text DEFAULT 'x') RETURNS text LANGUAGE sql AS E'SELECT \\'ALTER TABLE public.executie_proiecte DISABLE ROW LEVEL SECURITY\\' || p';",
]
// [sql, sigur]: același text EXECUTAT din corpul AS '…' / DO '…' (P2-1, contrapartea) și referințele regclass ascunse de paranteze /
// cast-uri (P2-2, exemplul exact al lui Jak r3 primul): atinse
const LITERALI_ATINSI_R4 = [
  ["CREATE FUNCTION public.alt_exec2() RETURNS void LANGUAGE plpgsql AS 'BEGIN EXECUTE ''DROP TABLE public.izo_importuri;''; END';", true],
  ["DO 'BEGIN EXECUTE ''DROP TABLE public.izo_importuri''; END';", true],
  ["DO E'BEGIN EXECUTE \\'DROP TABLE public.izo_importuri\\'; END';", true],
  ["CREATE FUNCTION public.alt_exec3() RETURNS void LANGUAGE plpgsql AS 'BEGIN EXECUTE ''ALTER TABLE public.executie_proiecte DISABLE ROW LEVEL SECURITY''; END';", true],
  // corp E'…' cu alt escape (\n): nu se decodează, e citit integral ca SQL (aici chiar execută DROP)
  ["DO E'BEGIN\\n DROP TABLE public.izo_importuri; END';", true],
  ["CREATE FUNCTION public.alt_e() RETURNS void LANGUAGE plpgsql AS E'BEGIN\\n DROP TABLE public.izo_importuri; END';", true],
  ["CREATE TABLE public.alt (\n  id int CHECK (('public.izo_importuri')::regclass IS NOT NULL)\n);", false],
  ["CREATE TABLE public.alt (id int CHECK (CAST(('public.izo_importuri') AS regclass) IS NOT NULL));", false],
  ["CREATE TABLE public.alt (id int CHECK ('public.izo_importuri'::text::regclass IS NOT NULL));", false],
  ["CREATE TABLE public.alt (id int CHECK ((regclass 'public.izo_importuri') IS NOT NULL));", false],
  ["CREATE POLICY p ON public.alt USING (((('public.izo_importuri'))::pg_catalog.\"regclass\") IS NOT NULL);", false],
]
// fail-closed DECLARAT: corpul E'…' cu \n conține doar un literal-dată, dar nu se decodează → citit ca SQL (fals pozitiv acceptat)
const FAIL_CLOSED_R4 = ["DO E'BEGIN\\n RAISE NOTICE \\'DROP TABLE public.izo_importuri\\'; END';"]
// paritatea: orice caz cu corp $tag$…$tag$ după AS / DO, rescris ca '…' (regula de citare SQL: ' → ''), dă aceleași atingeri și același verdict
const caCitat = (sql) => sql.replace(/(\b(?:AS|DO)\s+)\$([A-Za-z_]*)\$([\s\S]*?)\$\2\$/g, (_, p, tag, corp) => `${p}'${corp.replace(/'/g, "''")}'`)
const PARITATE = [...ATINGE.map(([s]) => s), ...NEATINS, ...LITERALI_DATE, ...LITERALI_ATINSI.map(([s]) => s), JAK_R2].filter((s) => caCitat(s) !== s)

// ritualul cu o abatere de structură → refuz (P2-3)
const SCH = 'DROP TABLE public.izo_importuri;'
const STRUCTURA_GRESITA = [
  ['PRE după schimbare', `${SCH}\n${PRE}${DUPA}`],
  ['ștampilele înaintea schimbării', `${PRE}${DUPA}${SCH}\n`],
  ['ștampilele înaintea schimbării, POST după ea', `${PRE}${DUPA}${SCH}\nDO $post$\nBEGIN\n${GARDA('x')}\nEND $post$;\n`],
  ['o ștampilă lipsă', `${PRE}${SCH}\n${DUPA.replace(STAMPILA('fn_izo_porti_e3b_definitii', 'porti_e3b') + '\n', '')}`],
  ['prefix greșit', `${PRE}${SCH}\n${DUPA.replace("'porti_e3b=' || public.fn_izo_porti_e3b", "'porti_e3=' || public.fn_izo_porti_e3b")}`],
  ['ștampila calculată din altă funcție', `${PRE}${SCH}\n${DUPA.replace("'porti_e3b=' || public.fn_izo_porti_e3b_definitii()", "'porti_e3b=' || public.fn_izo_porti_e3_definitii()")}`],
  ['POST lipsă', `${PRE}${SCH}\nDO $dupa$\nBEGIN\n${STAMPILE()}\nEND $dupa$;\n`],
  ['PRE = SELECT simplu', `SELECT public.fn_izo_porti_lipsa() = '{}'::text[];\n${SCH}\n${DUPA}`],
  ['PRE cu =', `DO $pre$\nBEGIN\n  IF public.fn_izo_porti_lipsa() = '{}'::text[] THEN RAISE EXCEPTION 'x'; END IF;\nEND $pre$;\n${SCH}\n${DUPA}`],
  ['PRE fără RAISE', `DO $pre$\nBEGIN\n  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN NULL; END IF;\nEND $pre$;\n${SCH}\n${DUPA}`],
  ['PRE cu AND false', `DO $pre$\nBEGIN\n  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] AND false THEN RAISE EXCEPTION 'x'; END IF;\nEND $pre$;\n${SCH}\n${DUPA}`],
  ['PRE într-un corp de funcție', `CREATE FUNCTION pg_temp.g() RETURNS void LANGUAGE plpgsql AS $g$\nBEGIN\n${GARDA('x')}\nEND $g$;\n${SCH}\n${DUPA}`],
  ['PRE înghițit de EXCEPTION WHEN', `DO $pre$\nBEGIN\n${GARDA('x')}\nEXCEPTION WHEN OTHERS THEN NULL;\nEND $pre$;\n${SCH}\n${DUPA}`],
  ['PRE într-un literal', `DO $pre$\nBEGIN\n  RAISE NOTICE '%', 'IF public.fn_izo_porti_lipsa() IS DISTINCT FROM ''{}''::text[] THEN RAISE EXCEPTION x';\nEND $pre$;\n${SCH}\n${DUPA}`],
  ['PRE într-un literal $…$', `DO $pre$\nBEGIN\n  PERFORM $t$ IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'x'; $t$;\nEND $pre$;\n${SCH}\n${DUPA}`],
  ['PRE într-un comentariu /* */', `/*\n${PRE}*/\n${SCH}\n${DUPA}`],
  ['ritualul întreg într-un comentariu', `${SCH}\n/*\n${PRE}${DUPA}*/`],
  ['ștampilele în comentarii --', `${PRE}${SCH}\n${DUPA.split('\n').map((l) => (l.includes('EXECUTE') ? '-- ' + l : l)).join('\n')}`],
  ['COMMIT înainte de ștampile', `${PRE}${SCH}\nCOMMIT;\n${DUPA}`],
  ['END (= COMMIT) înainte de ștampile', `${PRE}${SCH}\nEND;\n${DUPA}`],
  ['ștampilă literală în plus', `${PRE}${SCH}\n${DUPA}COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS 'porti_e4=00000000000000000000000000000000';\n`],
  ['ștampilă dinamică necanonică', `${PRE}${SCH}\n${DUPA}DO $x$ BEGIN EXECUTE 'COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS ' || quote_literal('porti_e4=x'); END $x$;\n`],
  ['ritual într-un literal $…$', `${SCH}\nDO $x$ BEGIN PERFORM $q$${PRE}${DUPA}$q$; END $x$;`],
  ['schimbare după POST', `${PRE}${DUPA}${SCH}\n`],
]

// bateria: întoarce lista așteptărilor încălcate (goală = detectorul e cel bun); primește modulul (originalul sau un mutant)
function baterie(M) {
  const P = M.perimetru(POARTA, MIGRARI)
  const gresit = []
  const v = (t) => M.verifica(t, P)
  if (!P.functii.has('fn_executie_acces_garda') || !P.functii.has('fn_executie_fibra_garda_tronson')) gresit.push('perimetru: funcțiile trigger-elor E4 lipsesc')
  for (const [sql, sigur] of ATINGE) {
    const r = v(sql)
    if (!r.atinge.length || r.ok) gresit.push(`nu prinde: ${sql}`)
    if (!v(ritual(sql)).ok) gresit.push(`ritualul refuzat pe: ${sql}`)
    const ex = v(`${sql}\n${EXCEPTIE}`)
    if (ex.ok !== !sigur) gresit.push(`excepția ${sigur ? 'acceptată la atingere sigură' : 'refuzată la atingere posibilă'}: ${sql}`)
  }
  for (const sql of NEATINS) { const r = v(sql); if (r.atinge.length || !r.ok) gresit.push(`fals pozitiv: ${sql} → ${r.atinge.join('; ')}`) }
  for (const [ce, sql] of STRUCTURA_GRESITA) if (v(sql).ok) gresit.push(`structură acceptată greșit: ${ce}`)
  // r3: literal-dată → neatins; același text executat → atins (sigur: excepția refuzată; ritualul acceptat)
  for (const sql of LITERALI_DATE) { const r = v(sql); if (r.atinge.length || !r.ok) gresit.push(`literal-dată tratat ca SQL: ${sql} → ${r.atinge.join('; ')}`) }
  const jr = v(JAK_R2), jre = v(`${JAK_R2}\n${EXCEPTIE}`)
  if (jr.atinge.some((a) => /DROP/.test(a)) || !jre.ok || !v(ritual(JAK_R2)).ok) gresit.push(`exemplul Jak r2: ${jr.atinge.join('; ')} / excepția ${jre.ok ? 'acceptată' : 'refuzată'}`)
  if (!jr.atinge.some((a) => a.includes('numește registrul'))) gresit.push('exemplul Jak r2: corpul nu mai e citit textual (ca poarta)')
  for (const [sql, sigur] of LITERALI_ATINSI) {
    const r = v(sql)
    if (!r.atinge.length || r.ok) gresit.push(`literal executat neprins: ${sql}`)
    if (!v(ritual(sql)).ok) gresit.push(`ritualul refuzat pe: ${sql}`)
    if (v(`${sql}\n${EXCEPTIE}`).ok !== !sigur) gresit.push(`excepția ${sigur ? 'acceptată la atingere sigură' : 'refuzată la atingere posibilă'}: ${sql}`)
  }
  // r4 (Jak r3): corpul AS '…' = corpul $$ (exemplul exact + paritatea pe toate cazurile cu corp); regclass ascuns de paranteze / cast-uri
  const j3 = v(JAK_R3), j3e = v(`${JAK_R3}\n${EXCEPTIE}`)
  if (j3.atinge.join('|') !== jr.atinge.join('|') || !j3e.ok || !v(ritual(JAK_R3)).ok) gresit.push(`exemplul Jak r3: ${j3.atinge.join('; ')} / excepția ${j3e.ok ? 'acceptată' : 'refuzată'}`)
  for (const sql of LITERALI_DATE_R4) { const r = v(sql); if (r.atinge.length || !r.ok) gresit.push(`literal-dată din corp '…' tratat ca SQL: ${sql} → ${r.atinge.join('; ')}`) }
  for (const [sql, sigur] of LITERALI_ATINSI_R4) {
    const r = v(sql)
    if (!r.atinge.length || r.ok) gresit.push(`atingere r4 neprinsă: ${sql}`)
    if (!v(ritual(sql)).ok) gresit.push(`ritualul refuzat pe: ${sql}`)
    if (v(`${sql}\n${EXCEPTIE}`).ok !== !sigur) gresit.push(`excepția ${sigur ? 'acceptată la atingere sigură' : 'refuzată la atingere posibilă'}: ${sql}`)
  }
  for (const sql of FAIL_CLOSED_R4) if (!v(sql).atinge.length) gresit.push(`corpul E'…' nedecodabil tratat ca date: ${sql}`)
  for (const sql of PARITATE) {
    const a = v(sql), b = v(caCitat(sql))
    if (a.atinge.join('|') !== b.atinge.join('|') || a.ok !== b.ok) gresit.push(`paritate $$ / '…': ${sql} → [${a.atinge.join('; ')}] vs [${b.atinge.join('; ')}]`)
  }
  // exemplul lui Jak (P2-3): ALTER TABLE profiles + SELECT simplu + ștampile literale; și varianta cu verificările într-un comentariu
  const jak1 = v(`ALTER TABLE profiles ADD COLUMN x int;\nSELECT public.fn_izo_porti_lipsa() = '{}';\n${LITERALE}\n`)
  if (jak1.ok || !jak1.lipsa.some((l) => l.startsWith('PRE')) || !jak1.lipsa.some((l) => l.includes('necalculată')) || !jak1.lipsa.some((l) => l.startsWith('POST'))) gresit.push('exemplul Jak 1 (SELECT + ștampile literale)')
  if (v(`ALTER TABLE profiles ADD COLUMN x int;\n/*\n${PRE}${DUPA}*/\n`).ok) gresit.push('exemplul Jak 2 (verificările într-un comentariu)')
  // excepția: motiv scurt, în interiorul unui /* */, sau nu la început de rând = nu contează
  const pos = 'ALTER TABLE public.profiles ADD COLUMN x int;'
  if (v(`${pos}\n-- IZO_PORTI: neatins — scurt`).ok) gresit.push('excepția cu motiv scurt')
  if (v(`${pos}\n/*\n${EXCEPTIE}\n*/`).ok) gresit.push('excepția dintr-un comentariu /* */')
  if (v(`${pos} ${EXCEPTIE}`).ok) gresit.push('excepția care nu e la început de rând')
  // cele trei migrări care au înroșit porțile: prinse (fiecare cu o atingere sigură), refuzate
  for (const f of VINOVATE) {
    const lx = M.lexeaza(TEXT_VINOVATE[f]), at = M.atingeri(lx, P), r = v(TEXT_VINOVATE[f])
    if (!at.some((a) => a.sigur) || r.ok) gresit.push(`migrarea vinovată nu e prinsă sigur: ${f}`)
  }
  return gresit
}

describe('regula porților Izometrie — detectorul (P2-2 perimetrul, P2-3 structura)', () => {
  it('bateria completă trece pe detectorul din repo', () => {
    expect(baterie(R)).toEqual([])
  })
  it('tabelele vechi rămân neschimbate (42 atingeri / 13 neatingeri / 24 structuri) + cele noi din r3 și r4', () => {
    expect([ATINGE.length, NEATINS.length, STRUCTURA_GRESITA.length]).toEqual([42, 13, 24])
    expect([LITERALI_DATE.length, LITERALI_ATINSI.length]).toEqual([10, 19])
    expect([LITERALI_DATE_R4.length, LITERALI_ATINSI_R4.length, FAIL_CLOSED_R4.length]).toEqual([5, 11, 1])
    // paritatea nu e vidă: cazurile cu corp $…$ după AS / DO, fiecare rescris efectiv
    expect(PARITATE.length).toBe(23)
  })
  it('exemplele lui Jak (review r3): corpul AS \'…\' ca forma $$; regclass între paranteze', () => {
    const P = R.perimetru(POARTA, MIGRARI)
    expect(R.verifica(JAK_R3, P).atinge).toEqual(['funcție care numește registrul / fn_izo_*: alt_mesaj'])
    expect(R.verifica(`${JAK_R3}\n${EXCEPTIE}`, P)).toMatchObject({ ok: true, exceptie: expect.any(String) })
    // contrapartea executată: atingere sigură, declarația refuzată
    const ex = "CREATE FUNCTION public.alt_exec2() RETURNS void LANGUAGE plpgsql AS 'BEGIN EXECUTE ''DROP TABLE public.izo_importuri;''; END';"
    expect(R.verifica(ex, P).atinge).toContain('DROP TABLE izo_importuri')
    expect(R.verifica(`${ex}\n${EXCEPTIE}`, P).ok).toBe(false)
    const rc = R.verifica("CREATE TABLE public.alt (\n  id int CHECK (('public.izo_importuri')::regclass IS NOT NULL)\n);", P)
    expect(rc).toMatchObject({ ok: false, atinge: ['instrucțiune care numește registrul: izo_importuri'] })
    // rescrierea: corpul devine $corpN$ cu textul decodat; corpul E'…' cu \n rămâne literal
    expect(R.lexeaza(JAK_R3).cod).toContain("$corp1$SELECT 'DROP TABLE public.izo_importuri;'::text$corp1$")
    expect(R.lexeaza("DO E'a\\nb';").regiuni).toHaveLength(0)
    expect(R.lexeaza("DO E'BEGIN RAISE NOTICE \\'x\\\\y\\'; END';").cod).toContain("$corp1$BEGIN RAISE NOTICE 'x\\y'; END$corp1$")
    // tag-ul ales nu apare în text și nu se lipește de finalul corpului
    expect(R.lexeaza("DO 'BEGIN NULL; END -- $corp1$';").cod).toContain('$corp2$')
    expect(R.lexeaza("DO 'SELECT 1 -- x$corp1';").cod).toContain('$corp2$')
  })
  it('exemplul lui Jak (review r2): literalul returnat nu e DDL; același text în EXECUTE e', () => {
    const P = R.perimetru(POARTA, MIGRARI)
    const r = R.verifica(JAK_R2, P)
    expect(r.atinge).toEqual(['funcție care numește registrul / fn_izo_*: alt_mesaj'])
    expect(R.verifica(`${JAK_R2}\n${EXCEPTIE}`, P)).toMatchObject({ ok: true, exceptie: expect.any(String) })
    const e = R.verifica("DO $$ BEGIN EXECUTE 'DROP TABLE public.izo_importuri;'; END $$;", P)
    expect(e.atinge).toContain('DROP TABLE izo_importuri')
    expect(R.verifica(`DO $$ BEGIN EXECUTE 'DROP TABLE public.izo_importuri;'; END $$;\n${EXCEPTIE}`, P).ok).toBe(false)
    // pozițiile se păstrează: `exe` are aceeași lungime și aceleași rânduri ca `cod`
    const lx = R.lexeaza(`${JAK_R2}\nDO $$ BEGIN EXECUTE 'x'; END $$;`)
    expect(lx.exe.length).toBe(lx.cod.length)
    expect(lx.exe.split('\n').length).toBe(lx.cod.split('\n').length)
    expect(lx.exe).not.toContain('DROP TABLE')
    expect(lx.exe).toContain("EXECUTE 'x'")
  })
  it('exemplele lui Jak (review r1): fiecare refuzat, cu motivul așteptat', () => {
    const P = R.perimetru(POARTA, MIGRARI)
    expect(R.verifica('DROP TABLE public.izo_importuri;', P)).toMatchObject({ ok: false })
    const g = R.verifica('CREATE OR REPLACE FUNCTION public.fn_executie_acces_garda() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;', P)
    expect(g.ok).toBe(false)
    expect(g.atinge.join(' ')).toContain('fn_executie_acces_garda')
    const j = R.verifica(`ALTER TABLE profiles ADD COLUMN x int;\nSELECT public.fn_izo_porti_lipsa() = '{}';\n${LITERALE}\n`, P)
    expect(j.ok).toBe(false)
    expect(j.lipsa.filter((l) => l.includes('necalculată'))).toHaveLength(5)
    expect(R.verifica(`ALTER TABLE profiles ADD COLUMN x int;\n/*\n${PRE}${DUPA}*/\n`, P).ok).toBe(false)
  })
  it('migrările reale: cele trei vinovate refuzate; 20261230a și 20261120a au ritualul canonic minus PRE-ul verde', () => {
    const P = R.perimetru(POARTA, MIGRARI)
    for (const f of VINOVATE) expect(R.verifica(TEXT_VINOVATE[f], P).ok, f).toBe(false)
    // 20261230a e o reconciliere: PRE-ul fixează starea ROȘIE analizată (nu '{}'), deci singura lipsă e PRE-ul verde
    const rec = R.verifica(POARTA, P)
    expect(rec.ok).toBe(false)
    expect(rec.lipsa).toHaveLength(1)
    expect(rec.lipsa[0]).toMatch(/^PRE:/)
    // 20261120a (ultima care a refăcut ștampilele) n-avea PRE-ul verde; restul formei e cel cerut
    const r120 = R.verifica(citeste('supabase/migrations/20261120a_izometrie_aviz_iesire.sql'), P)
    expect(r120.lipsa).toEqual([expect.stringMatching(/^PRE:/)])
    // revenirea reconcilierii pune ștampilele vechi LITERAL (starea roșie de dinainte): refuzată de regulă, scutită prin lista veche
    const rev = R.verifica(citeste('supabase/revenire/20261230a_izometrie_porti_reconciliere_ROLLBACK.sql'), P)
    expect(rev.ok).toBe(false)
    expect(rev.lipsa.filter((l) => l.includes('necalculată'))).toHaveLength(5)
  })
  it('lexerul: comentarii imbricate, literali, corpuri $…$; text nelexabil = refuz', () => {
    const lx = R.lexeaza("SELECT 'a -- b' /* x /* y */ z */, $f$ -- c\n$f$, E'\\' -- d';")
    expect(lx.eroare).toBeNull()
    expect(lx.cod).toContain("'a -- b'")
    expect(lx.cod).not.toMatch(/[xyz] \*\//)
    expect(lx.cod).toContain("E'\\' -- d'")
    expect(lx.regiuni).toHaveLength(1)
    const P = R.perimetru(POARTA, MIGRARI)
    expect(R.verifica('ALTER TABLE public.profiles ADD COLUMN x int; /* neînchis', P)).toMatchObject({ ok: false })
    expect(R.verifica("SELECT $f$ neînchis", P)).toMatchObject({ ok: false })
  })
})

describe('regula porților Izometrie — depozitul și lista veche', () => {
  const LISTA = citeste(R.LISTA_VECHE_REL)
  const L = R.citesteLista(LISTA)
  it('niciun fișier din supabase/migrations + supabase/revenire nu încalcă regula', () => {
    const rez = R.verificaRadacina(RAD)
    expect(rez.probleme).toEqual([])
  })
  it('lista veche e fixă: numărul și amprenta ei (nu se adaugă rânduri)', () => {
    // valori puse la introducerea regulii (19.11.2026): o listă schimbată cere schimbarea ACESTUI test, în review
    expect(L.size).toBe(503)
    expect(R.sha256(LISTA)).toBe('c674a498663133a7535fd787c5858e44375ea500b4608bc203687c63b3af635c')
  })
  it('lista veche: reconcilierea și cele trei vinovate sunt în ea, cu motivul corect', () => {
    expect(L.get('migrations/20261230a_izometrie_porti_reconciliere.sql')?.motiv).toBe('reconciliere')
    expect(L.get('revenire/20261230a_izometrie_porti_reconciliere_ROLLBACK.sql')?.motiv).toBe('reconciliere')
    for (const f of VINOVATE) expect(L.get(`migrations/${f}`)?.motiv, f).toBe('vechi')
    expect([...L.values()].filter((e) => e.motiv === 'reconciliere')).toHaveLength(2)
  })
  it('lista veche: rândurile invalide sau dublate sunt refuzate', () => {
    const r = 'migrations/x.sql\t' + 'a'.repeat(64) + '\tvechi'
    expect(() => R.citesteLista(`${r}\n${r}`)).toThrow(/dublur/)
    expect(() => R.citesteLista('migrations/x.sql\tabc\tvechi')).toThrow(/invalid/)
    expect(() => R.citesteLista('migrations/x.sql\t' + 'a'.repeat(64) + '\tscutit')).toThrow(/invalid/)
  })
})

describe('regula porților Izometrie — rularea automată (P2-1)', () => {
  it('CLI-ul pe depozit: cod 0', () => {
    const r = spawnSync(process.execPath, [DETECTOR], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('IZO_PORTI_REGULA OK')
  })
  it('CLI-ul pe un arbore cu o migrare nouă greșită: cod 1 și numele fișierului; reparată: cod 0; un fișier vechi modificat se verifică', () => {
    const t = mkdtempSync(join(tmpdir(), 'izo-regula-'))
    try {
      for (const d of ['migrations', 'revenire', 'tests']) mkdirSync(join(t, 'supabase', d), { recursive: true })
      writeFileSync(join(t, R.POARTA_REL), POARTA)
      const vechi = 'CREATE TABLE public.alt (id int);\n'
      writeFileSync(join(t, 'supabase/migrations/20261101a_vechi.sql'), vechi)
      const lista = `migrations/20261230a_izometrie_porti_reconciliere.sql\t${R.sha256(POARTA)}\treconciliere\nmigrations/20261101a_vechi.sql\t${R.sha256(vechi)}\tvechi\n`
      writeFileSync(join(t, R.LISTA_VECHE_REL), lista)
      const ruleaza = () => spawnSync(process.execPath, [DETECTOR, '--radacina', t], { encoding: 'utf8' })
      expect(ruleaza().status).toBe(0)
      // o migrare nouă cu un număr MAI MIC decât 20261230a (numerotarea nu e cronologică): verificată oricum
      writeFileSync(join(t, 'supabase/migrations/20261131z_noua.sql'), 'DROP TABLE public.izo_importuri;\n')
      let r = ruleaza()
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('migrations/20261131z_noua.sql')
      writeFileSync(join(t, 'supabase/migrations/20261131z_noua.sql'), ritual('DROP TABLE public.izo_importuri;'))
      expect(ruleaza().status).toBe(0)
      // o revenire nouă greșită
      writeFileSync(join(t, 'supabase/revenire/20261131z_noua_ROLLBACK.sql'), `CREATE TABLE public.izo_importuri (id int);\n${LITERALE}\n`)
      r = ruleaza()
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('revenire/20261131z_noua_ROLLBACK.sql')
      rmSync(join(t, 'supabase/revenire/20261131z_noua_ROLLBACK.sql'))
      // fișierul vechi modificat (alt sha256) iese din scutire
      writeFileSync(join(t, 'supabase/migrations/20261101a_vechi.sql'), vechi + 'ALTER TABLE public.izo_fronturi ADD COLUMN y int;\n')
      r = ruleaza()
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('migrations/20261101a_vechi.sql (în lista veche cu alt sha256')
      // poarta lipsă / lista lipsă = eroare (cod 2), nu „totul bine”
      rmSync(join(t, R.LISTA_VECHE_REL))
      expect(ruleaza().status).toBe(2)
    } finally { rmSync(t, { recursive: true, force: true }) }
  })
  it('workflow-ul CI: căile, fără condiție pe draft, fără continue-on-error, cei doi pași', () => {
    const w = citeste(R.WORKFLOW_REL)
    expect(R.verificaWorkflow(w)).toEqual([])
    // mutanții workflow-ului: fiecare trebuie refuzat
    const mutanti = [
      w.replace("      - 'supabase/revenire/**'\n", ''),
      w.replace("      - 'supabase/migrations/**'\n", ''),
      w.replace("      - 'scripts/izometrie/porti_regula.mjs'\n", ''),
      w.replace('    runs-on: ubuntu-latest\n', '    if: github.event.pull_request.draft == false\n    runs-on: ubuntu-latest\n'),
      w.replace('    timeout-minutes: 10\n', '    timeout-minutes: 10\n    continue-on-error: true\n'),
      w.replace('        run: node scripts/izometrie/porti_regula.mjs\n', '        run: echo sarit\n'),
      w.replace('        run: npx vitest run src/izoPortiRegula\n', '        run: echo sarit\n'),
      w.replace('types: [opened, synchronize, reopened, ready_for_review]', 'types: [ready_for_review]'),
      w.replace('  pull_request:\n', '  push:\n'),
    ]
    for (const [i, m] of mutanti.entries()) {
      expect(m, `mutantul ${i} nu s-a aplicat`).not.toBe(w)
      expect(R.verificaWorkflow(m).length, `mutantul ${i}`).toBeGreaterThan(0)
    }
  })
})

// mutanții detectorului: fiecare scoate O regulă; bateria trebuie să pice pe fiecare (altfel testele nu păzesc regula)
const MUTANTI = [
  ['comentariile /* */ nu se mai scot', "if (c === '/' && d === '*') {", 'if (false) {'],
  ['comentariile -- nu se mai scot', "if (c === '-' && d === '-') {", 'if (false) {'],
  ['PRE fără ordine', 'if (!garzi.some((g) => g < prim))', 'if (!garzi.length)'],
  ['ștampilele fără ordine', '.filter((i) => i > ultim && inDo(i))', '.filter((i) => inDo(i))'],
  ['ștampilele literale acceptate', 'if (!canonice.some(([a, b]) => m.index >= a && m.index < b))', 'if (false)'],
  ['garda oriunde (și în funcții / literali $…$)', 'return l.length > 0 && l.every(', 'return true || l.every('],
  // („garda și din literali '…'” NU e în listă: mutantul e echivalent — un ' din literal e dublat / escapat, deci forma canonică a
  //  gărzii / ștampilei nu se poate potrivi înăuntru; verificarea rămâne ca apărare suplimentară, declarată ca atare în detector)
  ['EXCEPTION WHEN ignorat', "!/\\bEXCEPTION\\s+WHEN\\b/i.test(simplu.slice(r.start, r.end))", 'true'],
  ['DROP <listă> ignorat', "for (const n of (lista.length ? lista : ['?'])) adauga(", 'for (const n of []) adauga('],
  ['funcțiile trigger-elor nederivate', "if (g.functie !== '?') functii.add(", 'if (false) functii.add('],
  ['POST ignorat', 'if (!post.length) lipsa.push(', 'if (false) lipsa.push('],
  ['COMMIT ignorat', 'if (m.index < finalPost) lipsa.push(`${m[1].toUpperCase()}', 'if (false) lipsa.push(`${m[1].toUpperCase()}'],
  ['ținta dinamică necunoscută ignorată', `if (v === "'" || /%[IsL]/.test(v) || v === '') return '?'`, "if (v === '') return '?'"],
  ['excepția acceptată și la atingeri sigure', 'if (!sigure.length) return { atinge, ok: true, exceptie: exceptie[1] }', 'return { atinge, ok: true, exceptie: exceptie[1] }'],
  ['DEFINER cu SQL dinamic ignorat', 'if (definer && RE_DINAMIC.test(corp))', 'if (false)'],
  ['secvențele dinamice ignorate', "if (n === '?' || RE_IZO.test(n.split('.').pop())) { adauga('drepturi pe secvență'", "if (RE_IZO.test(n.split('.').pop())) { adauga('drepturi pe secvență'"],
  ['trigger-ele de pe tabelele E4 ca „posibile”', "if (ctx === 'trigger') return TAB_E4.has(n) ? { sigur: true }", "if (ctx === 'trigger') return TAB_E4.has(n) ? { sigur: false }"],
  ['politicile ignorate', "(m, i, sf) => peTabel('CREATE POLICY', normeaza(m[1]), normeaza(m[2]), 'politica', i, sf))", '(m, i, sf) => 0)'],
  ['tipurile de tabel din perimetru goale', "const TAB_SIGUR = new Set(['executie_proiecte', 'executie_tronsoane', 'logistica_depozite'])", 'const TAB_SIGUR = new Set([])'],
  // r3 (Jak r2 P2): distincția literal-dată / SQL executat — fiecare regulă scoasă trebuie prinsă
  ['literalii-date tratați ca SQL (fără distincție, ca în r2)', 'if (pastreaza(e)) continue', 'if (true) continue'],
  ['toți literalii tratați ca date (și cei din EXECUTE)', 'const pastreaza = (e) => {', 'const pastreaza = (e) => { return false;'],
  ["corpul DO '…' (nedecodabil) tratat ca dată", 'if (RE_CORP_DO.test(inainte)) return true', 'if (false) return true'],
  ["corpul de funcție AS '…' (nedecodabil) tratat ca dată", 'if (/\\bAS\\s*$/i.test(inainte) &&', 'if (false &&'],
  ['constanta regclass tratată ca dată', 'if (RE_REG.test(M.slice(s + 1, f))) return true', 'if (false) return true'],
  // r4 (Jak r3)
  ["corpurile '…' nerescrise ca $…$ (comportamentul r3)", 'if (!de.length) break', 'break'],
  ["corpurile E'…' cu alte escape-uri rescrise oricum", "if (esc && /\\\\/.test(brut.replace(/''|\\\\[\\\\']/g, ''))) continue", ''],
  ["prefixul E al corpului nedecodabil nerecunoscut", ".replace(e.esc ? /[eE]$/ : /$^/, '')", ''],
  ['regclass doar imediat după literal (forma r3)', 'if (RE_REG.test(M.slice(s + 1, f))) return true', 'if (/^\\s*(?:::\\s*|AS\\s+)"?(?:pg_catalog\\s*\\.\\s*)?reg[a-z]+/i.test(M.slice(e.b, Math.min(b0, e.b + 100)))) return true'],
  ["ghilimelele dublate din corpul '…' nedecodate", `brut.replace(/''/g, "'")`, 'brut'],
  ['EXECUTE din corp ignorat', 'if (RE_EXECUTA.test(simplu.slice(e.P.start, e.P.end))) return true', 'if (false) return true'],
  ['instrucțiunea de sus / psql (\\gexec) ignorate', 'else if (RE_EXECUTA.test(M.slice(s + 1, f)) || (!e.P && psql)) return true', 'else if (false) return true'],
  ['orice funcție tratată ca pură', "if (FUNCTII_PURE.has(baza) && (!nume.includes('.') || nume.startsWith('pg_catalog.'))) continue", 'continue'],
  ['funcția pură calificată cu altă schemă (public.format)', "(!nume.includes('.') || nume.startsWith('pg_catalog.'))", 'true'],
  ['definițiile (CREATE TABLE t (… DEFAULT …)) tratate ca apeluri', 'if (cuv && DEFINITIE.has(cuv[1].toLowerCase())) continue', ''],
  ['sfârșitul instrucțiunii la \\gexec ignorat', 're = /;|\\\\[A-Za-z]/g', 're = /;/g'],
  ['bucket-ul izo- citit din literalii goliți', '/izo-/i.test(lx.cod.slice(i, sf))', '/izo-/i.test(cod.slice(i, sf))'],
  ['corpurile de funcții citite fără literali (altfel decât poarta)', 'corp = lx.cod.slice(rg.start, rg.end)', 'corp = cod.slice(rg.start, rg.end)'],
  ['view-urile citite fără literali (altfel decât pg_get_ruledef)', 'RE_REF_FN.exec(vedere ? lx.cod.slice(i, i + bucata.length) : bucata)', 'RE_REF_FN.exec(bucata)'],
  ['corpul INVOKER care numește fn_izo_* ca „posibil”', '{ sigur: definer || numesteFn }', '{ sigur: definer }'],
]

describe('regula porților Izometrie — mutanții detectorului', () => {
  const sursa = readFileSync(DETECTOR, 'utf8')
  it.each(MUTANTI)('mutantul „%s” e prins de baterie', async (ce, din, in_) => {
    const n = sursa.split(din).length - 1
    expect(n, `textul mutantului „${ce}” apare de ${n} ori (trebuie o dată)`).toBe(1)
    // calea REALĂ a folderului temporar (pe Windows tmpdir() poate fi scurtă, „GAZPET~1”, pe care vite n-o încarcă)
    const t = realpathSync.native(mkdtempSync(join(tmpdir(), 'izo-mutant-')))
    try {
      const f = join(t, 'm.mjs')
      writeFileSync(f, sursa.replace(din, in_))
      const M = await import(pathToFileURL(f).href)
      expect(baterie(M).length, ce).toBeGreaterThan(0)
    } finally { rmSync(t, { recursive: true, force: true }) }
  }, 60000)
})
