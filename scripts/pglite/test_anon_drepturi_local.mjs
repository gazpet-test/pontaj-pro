// Proba LOCALĂ a treptelor 20261218a / b / c (drepturile rolului anon în public) pe PGlite (Postgres în WASM, în memorie) — NU atinge
// nicio bază reală. Tiparul: scripts/pglite/test_raport_linii_proiect_local.mjs.
// Baza: o schemă falsă tip Supabase (anon / authenticated / service_role, auth.uid() din request.jwt.claim.sub, drepturile implicite ale lui
//   postgres pe public ca în producție: anon arwdxt pe tabele, rwU pe secvențe) cu câte un obiect din fiecare caz al regulii: tabel fără
//   politici (serial), tabel IDENTITY, tabel cu politică pentru PUBLIC, tabel cu drepturi DOAR pe coloane, vedere security_invoker, tabel al
//   altui proprietar, formular public (politică INSERT pentru anon + vedere peste el), RPC SECURITY DEFINER apelat de o pagină publică,
//   funcție fără DEFINER apelabilă de anon, drept implicit al altui rol.
// 1. scripts/anon_drepturi_citire.sql (READ ONLY) -> rândurile BASELINE puse în migrări, ca după review; aplicare a -> b -> c ca runnerul
//    (plafon 2000 + marcaje); verificări INDEPENDENTE de regulă (L25): instantaneul drepturilor din catalog, cererile reale ca anon.
// 2. revenire c -> b -> a = EXACT starea de dinainte (instantaneul complet al lui anon + al celorlalte roluri); re-aplicare.
// 3. refuzuri + MUTANȚI (fiecare TREBUIE să pice la verificarea lui).
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_anon_drepturi_local.mjs
// Limită: PGlite = PostgreSQL 18, o singură conexiune: lock_timeout / concurența reală nu se probează aici (doar ce lock-uri ia REVOKE).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const CITIRE = citeste('scripts/anon_drepturi_citire.sql')
const MIG = {
  a: citeste('supabase/migrations/20261218a_securitate_anon_drepturi.sql'),
  b: citeste('supabase/migrations/20261218b_securitate_anon_drepturi_tabele.sql'),
  c: citeste('supabase/migrations/20261218c_securitate_anon_drepturi_implicite.sql'),
}
const REV = {
  a: citeste('supabase/revenire/20261218a_securitate_anon_drepturi_ROLLBACK.sql'),
  b: citeste('supabase/revenire/20261218b_securitate_anon_drepturi_tabele_ROLLBACK.sql'),
  c: citeste('supabase/revenire/20261218c_securitate_anon_drepturi_implicite_ROLLBACK.sql'),
}
const NUME = { a: '20261218a_securitate_anon_drepturi', b: '20261218b_securitate_anon_drepturi_tabele', c: '20261218c_securitate_anon_drepturi_implicite' }
const TREAPTA = { a: 'T1', b: 'T2', c: 'T3' }
const PLASARE = (t) => `    ('${t}', NULL::integer, 'DE_COMPLETAT')`
// r5: blocul BASELINE din repo poate fi deja completat cu valorile de pe producție (T1 și T3, #1083): proba locală îl readuce la forma
// necompletată (rândul exact, un singur rând pe migrare), apoi pune BASELINE-ul citit din baza PGlite
for (const k of ['a', 'b', 'c']) {
  const re = new RegExp(`    \\('${TREAPTA[k]}', [0-9]+, '[0-9a-f]{32}'\\)\\n  \\) v\\(treapta, obiecte, amprenta\\)`, 'g')
  const n = (MIG[k].match(re) || []).length
  if (n > 1 || (n === 0 && !MIG[k].includes(PLASARE(TREAPTA[k])))) throw new Error(`BASELINE ${k}: forma necunoscută (${n} rânduri completate)`)
  MIG[k] = MIG[k].replace(re, PLASARE(TREAPTA[k]) + '\n  ) v(treapta, obiecte, amprenta)')
}
const PASTRATE_GOL = 'SELECT x.obiect, x.motiv FROM (VALUES (NULL::text, NULL::text)) x(obiect, motiv) WHERE x.obiect IS NOT NULL'
const PASTRATE_FORMULAR = "SELECT x.obiect, x.motiv FROM (VALUES ('public.v_formular_public', 'pagina publica de test')) x(obiect, motiv) WHERE x.obiect IS NOT NULL"

function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}

const SCHEMA = `
CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE supabase_admin NOLOGIN; CREATE ROLE authenticator NOLOGIN NOINHERIT;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO supabase_admin;
-- drepturile implicite ca în producție (anon fără TRUNCATE / MAINTAIN; authenticated și service_role complet)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
-- tabel fără politici (serial)
CREATE TABLE public.t_fara_politici (id serial PRIMARY KEY, x text);
ALTER TABLE public.t_fara_politici ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_fp_auth ON public.t_fara_politici TO authenticated USING (auth.uid() IS NOT NULL);
-- tabel IDENTITY fără politici
CREATE TABLE public.t_identity (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, x text);
ALTER TABLE public.t_identity ENABLE ROW LEVEL SECURITY;
-- tabel cu politică pentru PUBLIC (cere cont): rămâne în afara T2
CREATE TABLE public.t_cu_politica (id serial PRIMARY KEY, x text);
ALTER TABLE public.t_cu_politica ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_cp_all ON public.t_cu_politica USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
-- tabel cu drepturi DOAR pe coloane pentru anon (ca garantii)
CREATE TABLE public.t_coloane (id serial PRIMARY KEY, a text, secret text);
ALTER TABLE public.t_coloane ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.t_coloane FROM anon, authenticated;
GRANT SELECT (id, a) ON public.t_coloane TO anon, authenticated;
-- vedere security_invoker
CREATE VIEW public.v_simplu WITH (security_invoker = on) AS SELECT id, x FROM public.t_fara_politici;
-- tabel al altui proprietar
CREATE TABLE public.t_alt_proprietar (id integer);
ALTER TABLE public.t_alt_proprietar OWNER TO supabase_admin;
-- formular public: politică INSERT pentru anon, citit printr-o vedere
CREATE TABLE public.formular_public (id serial PRIMARY KEY, nume text);
ALTER TABLE public.formular_public ENABLE ROW LEVEL SECURITY;
CREATE POLICY fp_insert ON public.formular_public FOR INSERT TO anon WITH CHECK (true);
CREATE VIEW public.v_formular_public WITH (security_invoker = on) AS SELECT id, nume FROM public.formular_public;
-- RPC SECURITY DEFINER apelat de o pagină publică (scrie în t_fara_politici fără drepturi pentru anon pe tabel)
CREATE FUNCTION public.fn_pagina_publica(p_x text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v integer; BEGIN INSERT INTO public.t_fara_politici (x) VALUES (p_x) RETURNING id INTO v; RETURN v; END $f$;
REVOKE ALL ON FUNCTION public.fn_pagina_publica(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.fn_pagina_publica(text) TO anon;
-- funcție FĂRĂ DEFINER apelabilă de anon (FUNCTII_ANON)
CREATE FUNCTION public.fn_invoker_citeste() RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT count(*) FROM public.t_fara_politici $f$;
-- vedere-agregat (contoare): anon primește UN rând cu zero, fără date (SIMULARE: AGREGAT_FARA_DATE, nu DATE_CITIBILE)
CREATE VIEW public.v_contor WITH (security_invoker = on) AS SELECT count(*) AS n FROM public.t_cu_politica;
-- partiții (r2): părintele cu politică pentru PUBLIC + partiție fără politici; și invers
CREATE TABLE public.t_part (id integer, x text) PARTITION BY RANGE (id);
CREATE TABLE public.t_part_1 PARTITION OF public.t_part FOR VALUES FROM (0) TO (100);
ALTER TABLE public.t_part ENABLE ROW LEVEL SECURITY; ALTER TABLE public.t_part_1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_part_p ON public.t_part FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE TABLE public.t_part2 (id integer, x text) PARTITION BY RANGE (id);
CREATE TABLE public.t_part2_1 PARTITION OF public.t_part2 FOR VALUES FROM (0) TO (100);
ALTER TABLE public.t_part2 ENABLE ROW LEVEL SECURITY; ALTER TABLE public.t_part2_1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_part2_1_p ON public.t_part2_1 FOR SELECT USING (auth.uid() IS NOT NULL);
`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHEMA)
  await db.exec(`SET ROLE supabase_admin; GRANT SELECT, INSERT ON public.t_alt_proprietar TO anon; RESET ROLE;`)
  return db
}
// aplicarea ca runnerul cu --plafon-tranzactie-ms 2000: SET de sesiune înainte de BEGIN, marcajele (livrare + plafon) în tranzacție
async function caRunner(db, nume, text, { plafon = 2000, marcajPlafon = true, marcaj = true, inainteDeCommit = null } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const jurnal = []
  let rez
  try {
    rez = await db.exec(`${pre} BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}\n${text}\n${inainteDeCommit ? inainteDeCommit + '\nROLLBACK;' : 'COMMIT;'}`,
      { onNotice: (n) => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return { jurnal, rez }
}
async function citire(db, text = CITIRE) {
  const jurnal = []
  const rez = await db.exec(text, { onNotice: (n) => jurnal.push(n.message) })
  const randuri = rez.flatMap(r => r.rows || [])
  return { randuri, jurnal }
}
const sectiune = (c, s) => c.randuri.filter(r => r.sectiune === s)
async function migrariCuBaseline(db, { citireText = CITIRE, mig = MIG } = {}) {
  const c = await citire(db, citireText)
  const out = {}
  for (const k of ['a', 'b', 'c']) {
    const b = sectiune(c, 'BASELINE').find(r => r.treapta === TREAPTA[k])
    out[k] = aplica(mig[k], [[PLASARE(TREAPTA[k]), b.detaliu]])
  }
  return { mig: out, citire: c }
}
// instantaneul INDEPENDENT de regulă (L25): toate aclitem-urile din public (relații, coloane) și toate drepturile implicite, ca text
async function instantaneu(db) {
  const r = await db.query(`
    SELECT 'rel ' || c.oid::regclass::text || ' ' || x::text AS l FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(c.relacl) x WHERE n.nspname = 'public'
    UNION ALL SELECT 'col ' || c.oid::regclass::text || '.' || a.attname || ' ' || x::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0, unnest(a.attacl) x WHERE n.nspname = 'public'
    UNION ALL SELECT 'def ' || d.defaclrole::regrole::text || ' ' || coalesce(d.defaclnamespace::regnamespace::text, '-') || ' ' || d.defaclobjtype::text || ' ' || x::text
      FROM pg_default_acl d, unnest(d.defaclacl) x
    ORDER BY 1`)
  return r.rows.map(x => x.l)
}
const anonDin = (inst) => inst.filter(l => / anon=/.test(l))
const altiiDin = (inst) => inst.filter(l => !/ anon=/.test(l))
async function caAnon(db, sql) {
  try {
    const r = await db.exec(`BEGIN; SET LOCAL ROLE anon; SELECT set_config('request.jwt.claims', '{"role":"anon"}', true); ${sql}; COMMIT;`)
    return { ok: true, rows: r[r.length - 2]?.rows }
  } catch (e) { await db.exec('ROLLBACK'); return { ok: false, code: e.code, mesaj: e.message } }
}

let esecuri = 0, treceri = 0
const verifica = (cond, mesaj) => { if (cond) { treceri++; console.log('  ok   ' + mesaj) } else { esecuri++; console.error('  PICA ' + mesaj) } }
async function trebuieSaRefuze(promisiune, fragment, mesaj) {
  try { await promisiune; verifica(false, `${mesaj} (a trecut, trebuia refuz „${fragment}”)`) } catch (e) {
    verifica(e.message.includes(fragment), `${mesaj} -> refuz: ${e.message.slice(0, 150)}`)
    return e
  }
}

// ── 1. aplicare reală a -> b -> c ──
console.log('1. citire + aplicare a -> b -> c')
const db = await bazaNoua()
const inst0 = await instantaneu(db)
const { mig: M, citire: C0 } = await migrariCuBaseline(db)
const ob = sectiune(C0, 'OBIECT')
const tr = (t) => ob.filter(r => r.treapta === t).map(r => r.eticheta).sort()
console.log('   T1:', tr('T1').join(', '))
console.log('   T2:', tr('T2').join(', '))
console.log('   T3:', tr('T3').join(', '))
console.log('   RAMANE:', ob.filter(r => r.treapta === 'RAMANE').map(r => r.eticheta + ' (' + r.motiv + ')').join('; '))
verifica(JSON.stringify(tr('T1')) === JSON.stringify(['secventa public.t_coloane_id_seq', 'secventa public.t_fara_politici_id_seq',
  'secventa public.t_identity_id_seq']), 'T1 = secvențele lui postgres, fără cele din DEFAULT-ul tabelelor cu politică INSERT / ALL pentru anon / PUBLIC')
verifica(['secventa public.formular_public_id_seq', 'secventa public.t_cu_politica_id_seq'].every(e => ob.some(r => r.eticheta === e && r.treapta === 'RAMANE' && /poate insera/.test(r.motiv))),
  'RAMANE: secvențele tabelelor în care anon poate insera după politici (INSERT / ALL)')
verifica(JSON.stringify(tr('T2')) === JSON.stringify(['tabel public.t_coloane', 'tabel public.t_fara_politici',
  'tabel public.t_identity', 'tabel public.t_part_1', 'tabel_partitionat public.t_part2', 'vedere public.v_contor', 'vedere public.v_formular_public',
  'vedere public.v_simplu']), 'T2 = tabelele fără politici pentru anon/PUBLIC + vederile; partițiile judecate separat de părinte')
verifica(['tabel_partitionat public.t_part', 'tabel public.t_part2_1'].every(e => ob.some(r => r.eticheta === e && r.treapta === 'RAMANE')),
  'partiții: părintele cu politică și partiția cu politică rămân, fiecare pe rândul ei')
const det = (e) => ob.find(r => r.eticheta === e)?.detaliu || ''
verifica(/; oid=\d+;/.test(det('tabel public.t_identity')) && /; rls=true\/false;/.test(det('tabel public.t_identity'))
  && /; reguli=[0-9a-f]{32};/.test(det('vedere public.v_simplu')) && /; politici=[0-9a-f]{32};/.test(det('tabel public.t_fara_politici'))
  && /; implicite=[0-9a-f]{32}$/.test(det('secventa public.t_fara_politici_id_seq')) && /; parinti=\d+;/.test(det('tabel public.t_part_1')),
  'amprenta v2: oid, RLS / FORCE, corpul vederii, politicile, DEFAULT-urile (și la secvență), părintele partiției')
const control = (c, t) => sectiune(c, 'CONTROL').find(r => r.treapta === t)
verifica(sectiune(C0, 'CONTROL').length === 2 && /^\d+ obiecte$/.test(control(C0, 'RAMANE')?.detaliu) && control(C0, 'POLITICI_ANON')?.detaliu === '0 politici'
  && sectiune(C0, 'BASELINE').length === 3,
  'citirea: 3 rânduri BASELINE (T1 / T2 / T3) + 2 rânduri CONTROL (RAMANE; r5: POLITICI_ANON pe relații fără drept, azi 0)')
verifica(ob.some(r => r.treapta === 'RAMANE' && r.eticheta === 'tabel public.formular_public'), 'RAMANE: tabelul cu politică INSERT pentru anon')
verifica(JSON.stringify(tr('T3')) === JSON.stringify(['implicit postgres public S', 'implicit postgres public r']), 'T3 = implicitele lui postgres pe public (tabele + secvențe)')
verifica(ob.some(r => r.treapta === 'RAMANE' && r.eticheta === 'tabel public.t_cu_politica' && /politici/.test(r.motiv)), 'RAMANE: tabelul cu politică pentru PUBLIC')
verifica(ob.some(r => r.treapta === 'RAMANE' && r.eticheta === 'tabel public.t_alt_proprietar' && /proprietar supabase_admin/.test(r.motiv)), 'RAMANE: tabelul altui proprietar')
verifica(ob.some(r => r.treapta === 'RAMANE' && r.eticheta === 'implicit supabase_admin public r'), 'RAMANE: implicitul lui supabase_admin')
verifica(ob.find(r => r.eticheta === 'tabel public.t_coloane')?.detaliu.includes('coloane=1:23:-1 id anon=r/postgres;2:25:-1 a anon=r/postgres'),
  'drepturile pe coloane în detaliu, cu attnum:tip:typmod')
verifica(sectiune(C0, 'FUNCTII_ANON').some(r => r.functie === 'public.fn_invoker_citeste()') && !sectiune(C0, 'FUNCTII_ANON').some(r => /fn_pagina_publica/.test(r.functie)),
  'FUNCTII_ANON: funcția fără DEFINER apelabilă de anon (nu și RPC-ul DEFINER)')
verifica(sectiune(C0, 'RAMANE').some(r => r.treapta === 'dupa T1+T2+T3' && r.eticheta === 'tabel'), 'RAMANE după toate treptele: tabelele cu politici / alt proprietar')
verifica(C0.jurnal.some(m => /SIMULARE rezumat: rolul curent anon, 0 relatii cu date citibile, 0 ambigue, 0 neexecutate, 1 fara date la sursa, 0 constante \(fara surse in catalog\), \d+ goale, \d+ erori \(din care 0 necunoscute/.test(m))
  && C0.jurnal.includes('SIMULARE concluzie: ZERO date citibile ca anon (proba pe aceasta baza, in limitele din document)'),
  'SIMULARE: rulează ca anon, 0 date citibile / ambigue / neexecutate, vederea-contor = fără date la sursă; concluzia ZERO (probă, nu „dovedit”)')
verifica(C0.jurnal.includes('SIMULARE anon FARA_DATE_LA_SURSA in public.v_contor (1 rand doar NULL / zero; 1 tabele de baza: 0 fara drept, 1 cu 0 randuri vizibile)'),
  'SIMULARE: vederea-contor (count peste un tabel cu RLS, 0 rânduri vizibile ca anon) = FARA_DATE_LA_SURSA, cu numărătorile')
// r5 + r6 (review r4, review #1090): „un rând doar NULL / zero” se judecă la SURSĂ, DUPĂ analiza închiderii cu lista albă de funcții (r6: orice
// funcție din afara listei => NEEXECUTATA, relația nu se execută deloc). Fixture-uri (totul anulat la final):
//   v_kpi = forma vederii-contor de pe producție (CTE-uri cu agregate peste tabele cu RLS + o vedere + o constantă regclass spre un tabel fără
//     drept pentru anon) => FARA_DATE_LA_SURSA, 3 tabele de bază (1 fără drept, 2 cu 0 rânduri);
//   v_fara_invoker / v_peste_fara_invoker, v_mat, t_zero, v_grup => DATE_CITIBILE; v_kpi_auth (auth.uid()), v_peste_contor, v_now (now(),
//     date_trunc, to_char, jsonb_build_object: stabile din listă) => FARA_DATE_LA_SURSA; v_sum_const (sum peste VALUES (1), (-1)) => CONSTANTA;
//   NEEXECUTATA, cu numele și motivul: v_kpi_fn (SECURITY DEFINER), v_kpi_atomic (funcție proprie BEGIN ATOMIC), v_kpi_plpgsql;
//     contraexemplele review-ului #1090: v_probe_cfg (funcție INVOKER BEGIN ATOMIC cu SET request.jwt.claims = un utilizator: vede rândurile
//     (1), (-1) ale lui t_probe prin politica auth.uid(), sum = 0), v_xml (query_to_xml peste un tabel din altă schemă, extras prin xpath);
//     v_tabel_xml (table_to_xml: de sistem, stabilă, în afara listei); v_lacat (funcție volatilă cu pg_advisory_lock: lock-ul NU se ia);
//     t_antet (politică pentru anon dependentă de request.headers, nemodelat); t_cheie_calc (cheie calculată, nu constantă); v_rol (auth.role() al cărui corp citește request.headers);
//     v_jwt (auth.jwt(): revendicările complete nu sunt modelate);
//   t_metoda (politică pentru anon: request.method = GET, cu un rând) => DATE_CITIBILE (contextul cererii GET e pus);
//   AMBIGUU: v_alta_schema (tabel din altă schemă) și v_catalog (pg_catalog.pg_class: fix în sistem, invizibil în pg_depend, văzut în arbore).
{
  await db.exec(`BEGIN; CREATE TABLE public.t_zero (n integer); INSERT INTO public.t_zero VALUES (0); GRANT SELECT ON public.t_zero TO anon;
    CREATE VIEW public.v_grup WITH (security_invoker = on) AS SELECT max(n) AS m FROM public.t_zero GROUP BY n; GRANT SELECT ON public.v_grup TO anon;
    CREATE VIEW public.v_peste_contor WITH (security_invoker = on) AS SELECT * FROM public.v_contor; GRANT SELECT ON public.v_peste_contor TO anon;
    CREATE TABLE public.t_kpi_a (id serial PRIMARY KEY, x integer); ALTER TABLE public.t_kpi_a ENABLE ROW LEVEL SECURITY;
    CREATE POLICY t_kpi_a_p ON public.t_kpi_a FOR SELECT USING (auth.uid() IS NOT NULL);
    CREATE TABLE public.t_kpi_b (id serial PRIMARY KEY, x integer); ALTER TABLE public.t_kpi_b ENABLE ROW LEVEL SECURITY;
    CREATE POLICY t_kpi_b_p ON public.t_kpi_b FOR SELECT USING (auth.uid() IS NOT NULL);
    CREATE TABLE public.t_kpi_secret (id integer); REVOKE ALL ON public.t_kpi_secret FROM anon;
    INSERT INTO public.t_kpi_a (x) VALUES (5), (7); INSERT INTO public.t_kpi_b (x) VALUES (3); INSERT INTO public.t_kpi_secret VALUES (1);
    CREATE VIEW public.v_kpi_alerte WITH (security_invoker = on) AS SELECT id, x FROM public.t_kpi_b WHERE x > 0;
    CREATE VIEW public.v_kpi WITH (security_invoker = on) AS
      WITH a AS (SELECT count(*) AS n_active FROM public.t_kpi_a),
           b AS (SELECT count(*) FILTER (WHERE x > 0) AS n_fise FROM public.t_kpi_b),
           c AS (SELECT count(DISTINCT id) AS n_alerte FROM public.v_kpi_alerte)
      SELECT a.n_active, b.n_fise, c.n_alerte, CASE WHEN 'public.t_kpi_secret'::regclass IS NULL THEN 1 ELSE 0 END AS z
        FROM a CROSS JOIN b CROSS JOIN c;
    CREATE VIEW public.v_fara_invoker AS SELECT count(*) FILTER (WHERE x > 100) AS n FROM public.t_kpi_b;
    CREATE VIEW public.v_peste_fara_invoker WITH (security_invoker = on) AS SELECT n FROM public.v_fara_invoker;
    CREATE FUNCTION public.fn_kpi_definer() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
      BEGIN ATOMIC SELECT count(*) - count(*) FROM public.t_kpi_a; END;
    CREATE VIEW public.v_kpi_fn WITH (security_invoker = on) AS SELECT public.fn_kpi_definer() AS n;
    CREATE FUNCTION public.fn_kpi_atomic() RETURNS bigint LANGUAGE sql STABLE BEGIN ATOMIC SELECT count(*) FROM public.t_kpi_a; END;
    CREATE VIEW public.v_kpi_atomic WITH (security_invoker = on) AS SELECT public.fn_kpi_atomic() AS n;
    CREATE FUNCTION public.fn_kpi_plpgsql() RETURNS bigint LANGUAGE plpgsql STABLE AS $f$ BEGIN RETURN 0; END $f$;
    CREATE VIEW public.v_kpi_plpgsql WITH (security_invoker = on) AS SELECT public.fn_kpi_plpgsql() AS n;
    CREATE VIEW public.v_kpi_auth WITH (security_invoker = on) AS SELECT count(*) AS n FROM public.t_kpi_a WHERE auth.uid() IS NOT NULL;
    CREATE VIEW public.v_sum_const WITH (security_invoker = on) AS SELECT sum(x) AS s FROM (VALUES (1), (-1)) v(x);
    CREATE MATERIALIZED VIEW public.v_mat AS SELECT count(*) * 0 AS n FROM public.t_kpi_a; GRANT SELECT ON public.v_mat TO anon;
    CREATE VIEW public.v_now WITH (security_invoker = on) AS
      SELECT count(*) FILTER (WHERE date_trunc('day', now()) > to_timestamp(0) AND to_char(now(), 'YYYY') <> '' AND jsonb_build_object('a', x) IS NOT NULL) AS n
        FROM public.t_kpi_a;
    CREATE TABLE public.t_probe (x integer); ALTER TABLE public.t_probe ENABLE ROW LEVEL SECURITY;
    CREATE POLICY t_probe_p ON public.t_probe FOR SELECT TO anon USING (auth.uid() IS NOT NULL); INSERT INTO public.t_probe VALUES (1), (-1);
    CREATE FUNCTION public.fn_probe_cfg() RETURNS bigint LANGUAGE sql STABLE
      SET request.jwt.claims = '{"role":"anon","sub":"00000000-0000-0000-0000-000000000001"}'
      BEGIN ATOMIC SELECT coalesce(sum(x), 0) FROM public.t_probe; END;
    CREATE VIEW public.v_probe_cfg WITH (security_invoker = on) AS SELECT public.fn_probe_cfg() AS s;
    CREATE SCHEMA sursa; GRANT USAGE ON SCHEMA sursa TO anon; CREATE TABLE sursa.t (x integer); INSERT INTO sursa.t VALUES (1), (-1);
    GRANT SELECT ON sursa.t TO anon;
    CREATE VIEW public.v_xml WITH (security_invoker = on) AS
      SELECT ((xpath('/row/s/text()', query_to_xml('SELECT sum(x) AS s FROM sursa.t', false, true, '')))[1])::text::integer AS s;
    CREATE VIEW public.v_tabel_xml WITH (security_invoker = on) AS SELECT length(table_to_xml('public.t_kpi_a', false, true, '')::text) * 0 AS n;
    CREATE FUNCTION public.fn_lacat() RETURNS integer LANGUAGE sql VOLATILE AS $f$ SELECT pg_advisory_lock(4242); SELECT 0 $f$;
    CREATE VIEW public.v_lacat WITH (security_invoker = on) AS SELECT public.fn_lacat() AS n;
    CREATE TABLE public.t_metoda (x integer); ALTER TABLE public.t_metoda ENABLE ROW LEVEL SECURITY;
    CREATE POLICY t_metoda_p ON public.t_metoda FOR SELECT TO anon USING (current_setting('request.method', true) = 'GET');
    INSERT INTO public.t_metoda VALUES (7);
    CREATE TABLE public.t_antet (x integer); ALTER TABLE public.t_antet ENABLE ROW LEVEL SECURITY;
    CREATE POLICY t_antet_p ON public.t_antet FOR SELECT TO anon USING ((current_setting('request.headers', true)::jsonb ->> 'x-cheie') = 'da');
    INSERT INTO public.t_antet VALUES (9);
    CREATE TABLE public.t_cheie_calc (x integer); ALTER TABLE public.t_cheie_calc ENABLE ROW LEVEL SECURITY;
    CREATE POLICY t_cheie_calc_p ON public.t_cheie_calc FOR SELECT TO anon USING (current_setting('request.' || 'method', true) = 'GET');
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT current_setting('request.headers', true) $f$;
    CREATE VIEW public.v_rol WITH (security_invoker = on) AS SELECT count(*) FILTER (WHERE auth.role() IS NULL) AS n FROM public.t_kpi_a;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $f$;
    CREATE VIEW public.v_jwt WITH (security_invoker = on) AS SELECT count(*) FILTER (WHERE auth.jwt() IS NULL) AS n FROM public.t_kpi_a;
    CREATE VIEW public.v_alta_schema WITH (security_invoker = on) AS SELECT count(*) * 0 AS n FROM sursa.t;
    CREATE VIEW public.v_catalog WITH (security_invoker = on) AS SELECT count(*) * 0 AS n FROM pg_catalog.pg_class;`)
  const SP = (t) => t.replace('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;', 'SAVEPOINT s_citire;').replace(/ROLLBACK;\s*$/, 'ROLLBACK TO SAVEPOINT s_citire;')
  const lacate = async () => (await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`)).rows[0].n
  const cz = await citire(db, SP(CITIRE))
  const cls = (c, n) => (c.jurnal.find(m => m.startsWith(`SIMULARE anon `) && m.includes(` in public.${n} (`)) || '').replace(/^SIMULARE anon /, '')
  console.log('   ' + cz.jurnal.filter(m => /SIMULARE (anon (DATE|FARA|CONST|AMBIGUU|NEEX)|rezumat|concluzie)/.test(m)).join('\n   '))
  verifica(cls(cz, 'v_kpi') === 'FARA_DATE_LA_SURSA in public.v_kpi (1 rand doar NULL / zero; 3 tabele de baza: 1 fara drept, 2 cu 0 randuri vizibile)',
    'vederea de forma vederii-contor de pe producție (CTE-uri cu agregate + CROSS JOIN + regclass) peste tabele cu RLS = FARA_DATE_LA_SURSA (1 fără drept, 2 cu 0 rânduri)')
  verifica(['v_kpi_auth', 'v_peste_contor', 'v_now'].every(n => cls(cz, n).startsWith(`FARA_DATE_LA_SURSA in public.${n} (1 rand doar NULL / zero; 1 tabele de baza: 0 fara drept, 1 cu 0`)),
    'L20: auth.uid() (corpul verificat), vedere peste vedere-contor și funcțiile stabile din listă (now, date_trunc, to_char, jsonb_build_object) = FARA_DATE_LA_SURSA')
  verifica(cls(cz, 'v_fara_invoker') === 'DATE_CITIBILE in public.v_fara_invoker (1 rand doar NULL / zero; vedere fara security_invoker: citeste ca proprietarul)'
    && cls(cz, 'v_peste_fara_invoker') === 'DATE_CITIBILE in public.v_peste_fara_invoker (1 rand doar NULL / zero; vedere intermediara fara security_invoker (citeste ca proprietarul): public.v_fara_invoker)',
    'vedere fără security_invoker (la vârf sau intermediară) = DATE_CITIBILE')
  verifica(cls(cz, 'v_kpi_fn') === 'NEEXECUTATA in public.v_kpi_fn (functie in afara listei: public.fn_kpi_definer() [SECURITY DEFINER])'
    && cls(cz, 'v_kpi_atomic') === 'NEEXECUTATA in public.v_kpi_atomic (functie in afara listei: public.fn_kpi_atomic() [proprie / de extensie, limbaj sql, stabila])'
    && cls(cz, 'v_kpi_plpgsql') === 'NEEXECUTATA in public.v_kpi_plpgsql (functie in afara listei: public.fn_kpi_plpgsql() [proprie / de extensie, limbaj plpgsql, stabila])',
    'r6 P1.1: orice funcție a noastră (DEFINER, BEGIN ATOMIC, plpgsql) = NEEXECUTATA cu numele și motivul (corpurile nu se mai urmăresc)')
  verifica(cls(cz, 'v_probe_cfg') === 'NEEXECUTATA in public.v_probe_cfg (functie in afara listei: public.fn_probe_cfg() [SET in definitie: request.jwt.claims])',
    'r6 P1.1: contraexemplul review-ului (funcție INVOKER cu SET request.jwt.claims, sum peste (1), (-1)) = NEEXECUTATA, nu FARA_DATE_LA_SURSA')
  verifica(cls(cz, 'v_xml').startsWith('NEEXECUTATA in public.v_xml (functie in afara listei: ') && cls(cz, 'v_xml').includes('pg_catalog.query_to_xml(') && cls(cz, 'v_xml').includes('[de sistem, volatila]')
    && cls(cz, 'v_tabel_xml').startsWith('NEEXECUTATA in public.v_tabel_xml (functie in afara listei: pg_catalog.table_to_xml(') && cls(cz, 'v_tabel_xml').includes('[de sistem, stabila, in afara listei]'),
    'r6 P1.2: contraexemplul review-ului (query_to_xml peste un tabel din altă schemă) și table_to_xml = NEEXECUTATA (funcții de sistem din afara listei), nu CONSTANTA')
  verifica(cls(cz, 'v_lacat') === 'NEEXECUTATA in public.v_lacat (functie in afara listei: public.fn_lacat() [proprie / de extensie, limbaj sql, volatila])' && await lacate() === 0,
    'r6 P1.5: funcția volatilă cu pg_advisory_lock NU se execută (NEEXECUTATA) și sesiunea nu ține niciun lock consultativ după citire')
  verifica(cls(cz, 't_metoda') === 'DATE_CITIBILE in public.t_metoda (1 randuri citite, valorile nu se afiseaza)'
    && cls(cz, 't_antet') === 'NEEXECUTATA in public.t_antet (functie in afara listei: pg_catalog.current_setting [setari nemodelate: request.headers])'
    && cls(cz, 't_cheie_calc') === 'NEEXECUTATA in public.t_cheie_calc (functie in afara listei: pg_catalog.current_setting [setari nemodelate: cheie calculata])',
    'r6 P1.3: politica dependentă de request.method = GET vede rândul (contextul cererii e pus); request.headers (nemodelat) sau o cheie calculată = NEEXECUTATA cu numele setării (cheia decodată din arborele intern)')
  verifica(cls(cz, 'v_rol') === 'NEEXECUTATA in public.v_rol (functie in afara listei: auth.role() [corp in afara listei: setari request.headers])'
    && cls(cz, 'v_jwt') === 'NEEXECUTATA in public.v_jwt (functie in afara listei: auth.jwt() [revendicarile complete ale cheii (ref / iat / exp) nu sunt modelate])',
    'r6 P1.3: auth.role() al cărui corp citește o setare nemodelată și auth.jwt() = NEEXECUTATA cu motivul')
  verifica(cls(cz, 'v_sum_const') === 'CONSTANTA (fara surse in catalog) in public.v_sum_const (1 rand doar NULL / zero; nicio relatie pe calea de date, doar functii din lista alba)',
    'r6 P1.2: sum peste VALUES (1), (-1) = „CONSTANTA (fără surse în catalog)”, fără „dovedit”')
  verifica(cls(cz, 'v_alta_schema') === 'AMBIGUU in public.v_alta_schema (1 rand doar NULL / zero; relatie in afara schemelor noastre: sursa.t)'
    && cls(cz, 'v_catalog') === 'AMBIGUU in public.v_catalog (1 rand doar NULL / zero; relatie in afara schemelor noastre: pg_catalog.pg_class)',
    'r6: relația din altă schemă și cea din catalog (fixă: văzută doar în arborele intern, nu în pg_depend) = AMBIGUU, nu CONSTANTA')
  verifica(cls(cz, 't_zero') === 'DATE_CITIBILE in public.t_zero (1 rand doar NULL / zero; tabel: randul poate fi un rand de date)'
    && cls(cz, 'v_grup') === 'DATE_CITIBILE in public.v_grup (1 rand doar NULL / zero; tabel de baza cu randuri vizibile ca anon: public.t_zero)'
    && cls(cz, 'v_mat') === 'DATE_CITIBILE in public.v_mat (1 rand doar NULL / zero; vedere materializata: date proprii, fara RLS)',
    'tabel cu un rând (0) vizibil, vedere peste el, vedere materializată = DATE_CITIBILE')
  verifica(cz.jurnal.includes('SIMULARE concluzie: NEDOVEDIT: 6 cu date citibile, 2 ambigue, 11 neexecutate, 0 erori necunoscute - de analizat inainte de T2')
    && cz.jurnal.some(m => /^SIMULARE rezumat: rolul curent anon, 6 relatii cu date citibile, 2 ambigue, 11 neexecutate, 5 fara date la sursa, 1 constante \(fara surse in catalog\)/.test(m)),
    'rezumatul numără fiecare clasă (6 date, 2 ambigue, 11 neexecutate, 5 la sursă, 1 constantă); concluzia NEDOVEDIT')
  // mutanți: fiecare scoate o regulă; verificările de mai sus îl prind (aici se arată defectul pe care l-ar lăsa să treacă)
  const m1 = await citire(db, SP(aplica(CITIRE, [['              IF d.invoker IS NOT TRUE THEN', '              IF false THEN']])))
  verifica(cls(m1, 'v_fara_invoker').startsWith('FARA_DATE_LA_SURSA') && cls(m1, 'v_peste_fara_invoker').startsWith('FARA_DATE_LA_SURSA'),
    'mutant fără verificarea security_invoker: vederile care citesc ca proprietarul ies „fără date la sursă”')
  const LISTA = "ELSIF d.pro_schema = 'pg_catalog' AND d.sistem AND NOT d.prosecdef AND d.fara_config AND (d.volatil = 'i' OR d.proname = ANY (v_stabile)) THEN"
  const mA = await citire(db, SP(aplica(CITIRE, [[LISTA, "ELSIF NOT d.prosecdef AND (d.pro_schema = 'pg_catalog' OR d.corp_atomic) THEN"]])))
  verifica(/^(CONSTANTA|FARA_DATE_LA_SURSA)/.test(cls(mA, 'v_probe_cfg')) && /^(CONSTANTA|FARA_DATE_LA_SURSA)/.test(cls(mA, 'v_kpi_atomic')),
    `mutant „regula r5” (funcții proprii cu corp analizat admise, fără proconfig): contraexemplul cu SET request.jwt.claims iese „dovedit” (${cls(mA, 'v_probe_cfg').split(' (')[0]})`)
  const mB = await citire(db, SP(aplica(CITIRE, [[LISTA, "ELSIF d.pro_schema = 'pg_catalog' AND NOT d.prosecdef THEN"]])))
  verifica(cls(mB, 'v_xml').startsWith('CONSTANTA') && cls(mB, 'v_catalog').startsWith('AMBIGUU'),
    `mutant „orice funcție de sistem”: query_to_xml peste date reale iese CONSTANTA (${cls(mB, 'v_xml').split(' (')[0]})`)
  const mC = await citire(db, SP(aplica(CITIRE, [['      IF v_neadmise IS NOT NULL THEN', '      IF false THEN']])))
  const lC = await lacate()
  await db.query('SELECT pg_advisory_unlock_all()')
  verifica(lC === 1 && !cls(mC, 'v_lacat').startsWith('NEEXECUTATA'), `mutant „execuție fără poarta listei albe” (ordinea r5): funcția cu pg_advisory_lock rulează, lock-ul rămâne după ROLLBACK (${lC})`)
  const mD = await citire(db, SP(aplica(CITIRE, [['        IF v_c1 = 0 OR v_c1 <> v_c2 THEN', '        IF false THEN']])))
  verifica(!cls(mD, 't_antet').startsWith('NEEXECUTATA'), `mutant fără verificarea cheilor din current_setting: politica pe request.headers se execută (${cls(mD, 't_antet').split(' (')[0]})`)
  const mE = await citire(db, SP(aplica(CITIRE, [["set_config('request.method', 'GET', true), ", '']])))
  verifica(cls(mE, 't_metoda') === '', `mutant fără request.method: politica dependentă de metodă ascunde rândul văzut prin API (iese GOL, fără linie)`)
  const mF = await citire(db, SP(aplica(CITIRE, [["IF v_c1 = 0 OR v_c1 <> v_c2 OR d.prosrc ~* '[[:<:]]from[[:>:]]' THEN", 'IF false THEN']])))
  verifica(!cls(mF, 'v_rol').startsWith('NEEXECUTATA'), 'mutant fără verificarea corpului auth.uid / auth.role: auth.role() cu request.headers se execută')
  // același v_kpi când un tabel de bază are un rând VIZIBIL ca anon (rezultatul vederii rămâne zero: filtrele x > 0)
  await db.exec(`CREATE POLICY t_kpi_b_anon ON public.t_kpi_b FOR SELECT TO anon USING (x <= 0); INSERT INTO public.t_kpi_b (x) VALUES (0);`)
  const cv = await citire(db, SP(CITIRE))
  verifica(cls(cv, 'v_kpi') === 'DATE_CITIBILE in public.v_kpi (1 rand doar NULL / zero; tabel de baza cu randuri vizibile ca anon: public.t_kpi_b)',
    'același v_kpi, cu un rând vizibil ca anon într-un tabel de bază (vederea tot zero) = DATE_CITIBILE')
  const m2 = await citire(db, SP(aplica(CITIRE, [["              EXECUTE 'SELECT /* anon_drepturi_citire */ EXISTS (SELECT 1 FROM ' || v_b || ')' INTO v_ex;", '              v_ex := false;']])))
  verifica(cls(m2, 'v_kpi').startsWith('FARA_DATE_LA_SURSA'), 'mutant fără citirea efectivă a tabelelor de bază: v_kpi cu rând vizibil iese „fără date la sursă”')
  await db.exec('ROLLBACK')
}
// SIMULARE deosebește datele citibile: o politică temporară care lasă anon să vadă un rând => DATE_CITIBILE (anulată la final)
{
  await db.exec(`BEGIN; INSERT INTO public.t_cu_politica (x) VALUES ('vizibil'); CREATE POLICY p_tmp ON public.t_cu_politica FOR SELECT TO anon USING (true);`)
  const cs = await citire(db, CITIRE.replace('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;', 'SAVEPOINT s_citire;').replace(/ROLLBACK;\s*$/, 'ROLLBACK TO SAVEPOINT s_citire;'))
  await db.exec('ROLLBACK')
  console.log('   ' + cs.jurnal.filter(m => /SIMULARE (anon DATE|anon AGREGAT|anon EROARE|rezumat)/.test(m)).join(' | '))
  verifica(cs.jurnal.some(m => /SIMULARE anon DATE_CITIBILE in public\.t_cu_politica \(1 randuri/.test(m))
    && cs.jurnal.some(m => /SIMULARE anon DATE_CITIBILE in public\.v_contor/.test(m))
    && cs.jurnal.some(m => /SIMULARE rezumat: rolul curent anon, 2 relatii cu date citibile/.test(m)),
    'SIMULARE: un rând vizibil = DATE_CITIBILE (tabelul și contorul cu valoare nenulă), fără valori în NOTICE')
  verifica(!cs.jurnal.some(m => m.includes('vizibil')), 'SIMULARE: valorile citite nu apar în NOTICE')
}
verifica(C0.jurnal.some(m => /STATISTICI: extensia pg_stat_statements nu e instalata - LIPSA DE DOVADA/.test(m)), 'STATISTICI: lipsa extensiei raportată ca LIPSĂ DE DOVADĂ, fără eroare')

// lock-urile ținute de tranzacția T2 la final (OBSERVAȚIE pe PG18, nu garanție pentru PG17.6): pe relațiile din public cel mult ACCESS SHARE
// (nu oprește citiri / scrieri); serializarea cu alte sesiuni vine din rândurile de catalog rescrise (xmin, verificat mai jos), nu din lock-uri
await caRunner(db, NUME.a, M.a)
const lk = await caRunner(db, NUME.b, M.b, { inainteDeCommit: `SELECT l.mode, c.relname, n.nspname FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname IN ('public', 'pg_catalog');` })
const lkr = lk.rez[lk.rez.length - 2].rows
const moduri = [...new Set(lkr.filter(r => r.nspname === 'public').map(r => r.mode))]
console.log('   lock-uri observate (PG18): public = ' + moduri.join(', ') + '; catalog = ' + [...new Set(lkr.filter(r => r.nspname === 'pg_catalog' && /^pg_(class|attribute)$/.test(r.relname)).map(r => r.relname + ' ' + r.mode))].join(', '))
// r4: lista goală NU e „ok” (L18; PGlite 0.3 nu raporta pg_locks): ACCESS SHARE pe FIECARE tabel / vedere din T2 (LOCK explicit, review r3 P1)
const blocate = new Set(lkr.filter(r => r.nspname === 'public' && r.mode === 'AccessShareLock').map(r => r.relname))
const T2_LOCK = ['t_coloane', 't_fara_politici', 't_identity', 't_part_1', 't_part2', 'v_contor', 'v_formular_public', 'v_simplu']
verifica(moduri.length > 0 && moduri.every(m => m === 'AccessShareLock') && T2_LOCK.every(n => blocate.has(n)),
  `T2: ACCESS SHARE pe fiecare țintă (tabele, partiții, vederi) și nimic peste ACCESS SHARE în public (observat: ${moduri.join(', ') || 'nimic'}; ${blocate.size} relații)`)
verifica(!blocate.has('t_part2_1'), 'T2: LOCK … ONLY — partiția din afara listei (cu politică) nu e blocată prin părinte')
const xm = (await caRunner(db, NUME.b, M.b, { inainteDeCommit: `SELECT count(*) FILTER (WHERE c.xmin::text <> (txid_current() % 4294967296)::text)::int AS straine, count(*)::int AS n
  FROM securitate_intern.anon_revocari j JOIN pg_class c ON c.oid = j.obiect_oid WHERE j.migrare = '20261218b';` })).rez
verifica(xm[xm.length - 2].rows[0].straine === 0 && xm[xm.length - 2].rows[0].n === 8, 'T2: la final, rândul din pg_class al fiecărui obiect din jurnal e al tranzacției (blocat până la COMMIT)')
const jb = await caRunner(db, NUME.b, M.b)
console.log('   ' + jb.jurnal.filter(m => /sfarsit/.test(m)).join(' | '))
const jc = await caRunner(db, NUME.c, M.c)
console.log('   ' + jc.jurnal.filter(m => /sfarsit/.test(m)).join(' | '))
const inst1 = await instantaneu(db)
console.log('   anon după a+b+c:', anonDin(inst1).join(' | '))
verifica(JSON.stringify(altiiDin(inst1)) === JSON.stringify(altiiDin(inst0)), 'celelalte roluri: exact ca înainte (instantaneu independent)')
verifica(JSON.stringify(anonDin(inst1).map(l => l.split(' ').slice(0, 2).join(' '))) === JSON.stringify(['def supabase_admin', 'rel formular_public',
  'rel formular_public_id_seq', 'rel t_alt_proprietar', 'rel t_cu_politica', 'rel t_cu_politica_id_seq', 'rel t_part', 'rel t_part2_1']),
  'anon păstrează DOAR: tabelele cu politici (+ secvențele lor, + părintele / partiția cu politică), tabelul altui proprietar, implicitul supabase_admin')
// partițiile (r2): retragerea nu se propagă; cererea pe părinte cere doar dreptul pe părinte, cea directă doar pe partiție
let rp = await caAnon(db, 'SELECT * FROM public.t_part')
verifica(rp.ok && rp.rows.length === 0, 'partiții: părintele păstrat (politică) se citește ca anon (0 rânduri), deși partiția lui e retrasă' + (rp.ok ? '' : ' — ' + rp.mesaj))
rp = await caAnon(db, 'SELECT * FROM public.t_part_1')
verifica(!rp.ok && rp.code === '42501', 'partiții: partiția fără politici, retrasă: 42501 direct')
rp = await caAnon(db, 'SELECT * FROM public.t_part2')
verifica(!rp.ok && rp.code === '42501', 'partiții: părintele fără politici, retras: 42501 (partiția păstrată nu-l deschide)')
rp = await caAnon(db, 'SELECT * FROM public.t_part2_1')
verifica(rp.ok && rp.rows.length === 0, 'partiții: partiția cu politică, păstrată: 0 rânduri direct (retragerea pe părinte n-a atins-o)' + (rp.ok ? '' : ' — ' + rp.mesaj))
// căile reale (L20): RPC-ul paginii publice merge; citirea directă a unui obiect retras = 42501; obiectul rămas = 0 rânduri, fără eroare
let r = await caAnon(db, `SELECT public.fn_pagina_publica('din pagina')`)
verifica(r.ok, 'RPC SECURITY DEFINER al paginii publice: merge după T1+T2+T3' + (r.ok ? '' : ' — ' + r.mesaj))
r = await caAnon(db, 'SELECT * FROM public.t_fara_politici')
verifica(!r.ok && r.code === '42501', 'citire directă ca anon pe un tabel retras: 42501 (înainte: 0 rânduri)')
r = await caAnon(db, 'SELECT * FROM public.t_cu_politica')
verifica(r.ok && r.rows.length === 0, 'citire directă ca anon pe tabelul rămas (politică cu cont): 0 rânduri, fără eroare')
r = await caAnon(db, `INSERT INTO public.formular_public (nume) VALUES ('fara cont')`)
verifica(r.ok, 'INSERT-ul ca anon permis de o politică (serial) merge după T1+T2+T3' + (r.ok ? '' : ' — ' + r.mesaj))
r = await caAnon(db, 'SELECT * FROM public.v_formular_public')
verifica(!r.ok && r.code === '42501', 'vederea nedeclarată la pct. 1: 42501 după T2 (de aceea lista pct. 1)')
r = await caAnon(db, 'SELECT public.fn_invoker_citeste()')
verifica(!r.ok && r.code === '42501', 'funcția fără DEFINER apelabilă de anon: 42501 după T2 (de aceea FUNCTII_ANON în citire)')
await db.exec('CREATE TABLE public.t_dupa (id serial PRIMARY KEY); CREATE VIEW public.v_dupa AS SELECT id FROM public.t_dupa;')
const nou = (await instantaneu(db)).filter(l => /t_dupa|v_dupa/.test(l) && / anon=/.test(l))
verifica(nou.length === 0, 'după T3: un tabel / o secvență / o vedere NOI nu dau nimic lui anon')
await db.exec('DROP VIEW public.v_dupa; DROP TABLE public.t_dupa;')
const C1 = await citire(db)
verifica(sectiune(C1, 'OBIECT').filter(x => ['T1', 'T2', 'T3'].includes(x.treapta)).length === 0, 'citirea după: nimic de retras în T1 / T2 / T3')
const jr = (await db.query(`SELECT migrare, count(*)::int n FROM securitate_intern.anon_revocari GROUP BY 1 ORDER BY 1`)).rows
verifica(JSON.stringify(jr) === JSON.stringify([{ migrare: '20261218a', n: 3 }, { migrare: '20261218b', n: 8 }, { migrare: '20261218c', n: 2 }]), 'jurnalul = listele: ' + JSON.stringify(jr))
// controlul periodic pe RAMANE (r2): un obiect creat de platformă (supabase_admin, cu drepturile lui implicite pentru anon) după aplicare
{
  const k0 = control(C1, 'RAMANE')
  await db.exec('SET ROLE supabase_admin; CREATE TABLE public.t_platforma (id integer); RESET ROLE;')
  const C2 = await citire(db)
  const k1 = control(C2, 'RAMANE')
  verifica(k1.amprenta !== k0.amprenta && Number(k1.detaliu.split(' ')[0]) === Number(k0.detaliu.split(' ')[0]) + 1
    && sectiune(C2, 'OBIECT').some(x => x.eticheta === 'tabel public.t_platforma' && x.treapta === 'RAMANE' && /proprietar supabase_admin/.test(x.motiv))
    && sectiune(C2, 'BASELINE').every(x => x.detaliu.includes(", 0, '")),
    'control periodic: obiectul nou al lui supabase_admin schimbă CONTROL RAMANE (+1, amprentă nouă) și apare în OBIECT; T1 / T2 / T3 rămân 0')
  await db.exec('DROP TABLE public.t_platforma;')
}
// r5 (review r4): o politică pentru anon / PUBLIC creată DUPĂ retragere, pe un tabel fără drept pentru anon: fără acces azi, dar CONTROL
// POLITICI_ANON o vede (+1, amprentă nouă), iar RAMANE nu se schimbă; în POLITICI_ANON apare cu anon_are_drept = false
{
  const p0 = control(C1, 'POLITICI_ANON'), r0 = control(C1, 'RAMANE')
  await db.exec('CREATE POLICY p_dupa ON public.t_identity FOR SELECT TO anon USING (true); CREATE POLICY p_dupa_pub ON public.t_fara_politici FOR SELECT USING (true);')
  const C3 = await citire(db)
  const p1 = control(C3, 'POLITICI_ANON'), r1 = control(C3, 'RAMANE')
  const x = await caAnon(db, 'SELECT * FROM public.t_identity')
  verifica(p0.detaliu === '0 politici' && p1.detaliu === '2 politici' && p1.amprenta !== p0.amprenta && r1.amprenta === r0.amprenta && !x.ok && x.code === '42501'
    && ['p_dupa', 'p_dupa_pub'].every(n => sectiune(C3, 'POLITICI_ANON').some(r => r.politica === n && r.anon_are_drept === false)),
    'CONTROL POLITICI_ANON: politicile noi pentru anon / PUBLIC pe tabele fără drept (fără acces: 42501) schimbă rândul (0 -> 2), RAMANE neschimbat')
  await db.exec('ALTER POLICY p_dupa ON public.t_identity USING (id > 0);')
  const p2 = control(await citire(db), 'POLITICI_ANON')
  verifica(p2.detaliu === '2 politici' && p2.amprenta !== p1.amprenta, 'CONTROL POLITICI_ANON: expresia unei astfel de politici schimbată = amprentă nouă')
  await db.exec('DROP POLICY p_dupa ON public.t_identity; DROP POLICY p_dupa_pub ON public.t_fara_politici;')
  verifica(control(await citire(db), 'POLITICI_ANON').amprenta === p0.amprenta, 'CONTROL POLITICI_ANON: după ștergere, amprenta revine la cea dinainte')
}
// r5 + r6: STATISTICI pe o extensie FALSĂ (PGlite nu are pg_stat_statements): aceeași citire, cu schema extensiei înlocuită de o schemă cu
// tabelele de aceeași formă (PG 17: toplevel, stats_since). Așteptat din fixture (L25), r6 (review #1090 P1.4 + P2):
//   directe = forma PostgREST („WITH pgrst_…”) fără pgrst_call, pe "public"."…": 11 (105), 12 (17), 16 (INSERT cu listă de coloane: 4)
//     => 3 interogări, 126 apeluri; rpc = pgrst_call: 13 (40), 17 (pgrst_args: 6) => 2, 46; alte: 14 (3) și 18 (SQL scris de mână cu
//     "public"."t_a": 9) și 31 (martorul) => 3, 5012; proprii: 19 (eticheta scriptului); alt rol: nenumărat; martorul = 31: configurarea
//     PostgREST (set_config), înregistrată sub anon, preferată celei sub authenticator (32).
{
  const SP = (t) => t.replace('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;', 'SAVEPOINT s_citire;').replace(/ROLLBACK;\s*$/, 'ROLLBACK TO SAVEPOINT s_citire;')
  const EXT = ["SELECT n.nspname INTO v_schema FROM pg_extension x JOIN pg_namespace n ON n.oid = x.extnamespace WHERE x.extname = 'pg_stat_statements';",
    "v_schema := 'stat_fals';"]
  const FALS = aplica(CITIRE, [EXT])
  await db.exec(`BEGIN; SET LOCAL pg_stat_statements.track = 'top'; CREATE SCHEMA stat_fals;
    CREATE TABLE stat_fals.pg_stat_statements (userid oid, dbid oid, toplevel boolean, queryid bigint, calls bigint, query text, stats_since timestamptz);
    CREATE TABLE stat_fals.pg_stat_statements_info (stats_reset timestamptz, dealloc bigint);
    INSERT INTO stat_fals.pg_stat_statements SELECT r.oid, d.oid, true, q.id, q.c, q.t, q.s::timestamptz FROM pg_database d, pg_roles r, (VALUES
      ('anon', 11, 105, 'WITH pgrst_source AS ( SELECT "public"."t_a".* FROM "public"."t_a" LIMIT $1 OFFSET $2 ) SELECT null', '2026-11-01 08:00:00+00'),
      ('anon', 12, 17, 'WITH pgrst_source AS (SELECT "public"."t_b".* FROM "public"."t_b"   WHERE "public"."t_b"."id" = $1) SELECT null', '2026-11-01 08:00:00+00'),
      ('anon', 16, 4, 'WITH pgrst_source AS (INSERT INTO "public"."t_c"("x") SELECT "pgrst_body"."x" FROM pgrst_body RETURNING 1) SELECT null', '2026-11-10 08:00:00+00'),
      ('anon', 13, 40, 'WITH pgrst_source AS (SELECT "pgrst_call".* FROM "public"."fn_pagina"($1) pgrst_call) SELECT null', '2026-11-01 08:00:00+00'),
      ('anon', 17, 6, 'WITH pgrst_args AS (SELECT * FROM json_to_recordset($1) AS _("p" text)), pgrst_source AS (SELECT "pgrst_call".* FROM "public"."fn_pagina2"("p" := (SELECT "p" FROM pgrst_args LIMIT $2)) pgrst_call) SELECT null', '2026-11-01 08:00:00+00'),
      ('anon', 14, 3, 'SELECT $1', '2026-11-01 08:00:00+00'),
      ('anon', 18, 9, 'SELECT * FROM "public"."t_a" WHERE "id" = $1', '2026-11-01 08:00:00+00'),
      ('anon', 19, 1, 'DO $simulare$ BEGIN PERFORM /* anon_drepturi_citire */ 1; END $simulare$', '2026-11-13 09:00:00+00'),
      ('authenticated', 21, 999, 'WITH pgrst_source AS (SELECT "public"."t_a".* FROM "public"."t_a") SELECT null', '2026-11-01 08:00:00+00'),
      ('anon', 31, 5000, 'select set_config($1, $2, $3), set_config($4, $5, $6), set_config($7, $8, $9)', '2026-11-01 08:00:00+00'),
      ('authenticator', 32, 7000, 'select set_config($1, $2, $3), set_config($4, $5, $6), set_config($7, $8, $9)', '2026-11-01 08:00:00+00')) q(rol, id, c, t, s)
     WHERE d.datname = current_database() AND r.rolname = q.rol;
    INSERT INTO stat_fals.pg_stat_statements_info VALUES ('2026-11-01 08:00:00+00', 0);`)
  const rez = (c) => c.jurnal.find(m => m.startsWith('STATISTICI rezumat anon')) || ''
  const directe = (c) => Object.fromEntries(c.jurnal.filter(m => m.startsWith('STATISTICI anon directa: '))
    .map(m => /^STATISTICI anon directa: queryid (\d+) \| (\d+) apeluri \| stats_since ([^|]+) \|/.exec(m)).filter(Boolean).map(x => [x[1], { apeluri: Number(x[2]), since: x[3].trim() }]))
  // regula de comparare din docs/SECURITATE_ANON_DREPTURI.md §2, scrisă independent de script (L25): pentru fiecare intrare directă din A,
  // B trebuie să o aibă cu același stats_since și apeluri ≥; altfel „fără probă”. Intrare nouă în B sau apeluri crescute = „a crescut”.
  const compara = (a, b) => {
    const A = directe(a), B = directe(b), out = { fara_proba: [], crescut: [], nou: Object.keys(B).filter(q => !(q in A)) }
    for (const [q, x] of Object.entries(A)) {
      if (!(q in B) || B[q].since !== x.since || B[q].apeluri < x.apeluri) out.fara_proba.push(q)
      else if (B[q].apeluri > x.apeluri) out.crescut.push(q)
    }
    return out
  }
  const s1 = await citire(db, SP(FALS))
  console.log('   ' + rez(s1))
  verifica(rez(s1) === 'STATISTICI rezumat anon | directe: 3 interogari, 126 apeluri | rpc: 2 interogari, 46 apeluri | alte: 3 interogari, 5012 apeluri | proprii: 1 | resetare: 2026-11-01 08:00:00+00 | evacuari: 0 | ascunse: 0 | track: top | stats_since: da | martor: da | dovada: DA',
    'STATISTICI r6: clasele (directe = forma PostgREST fără pgrst_call, inclusiv INSERT cu listă de coloane; rpc; alte = SQL scris de mână; proprii), track, stats_since, martor')
  verifica(s1.jurnal.includes('STATISTICI anon directa: queryid 16 | 4 apeluri | stats_since 2026-11-10 08:00:00+00 | sus | WITH pgrst_source AS (INSERT INTO "public"."t_c"("x") SELECT "pgrst_body"."x" FROM pgrst_body RETURNING 1) SELECT null')
    && s1.jurnal.includes('STATISTICI anon alta: queryid 18 | 9 apeluri | stats_since 2026-11-01 08:00:00+00 | sus | SELECT * FROM "public"."t_a" WHERE "id" = $1')
    && s1.jurnal.some(m => m.startsWith('STATISTICI anon proprie: queryid 19 '))
    && s1.jurnal.includes('STATISTICI martor (configurarea fiecarei cereri PostgREST): rol anon | queryid 31 | 5000 apeluri | stats_since 2026-11-01 08:00:00+00')
    && s1.jurnal.findIndex(m => m.startsWith('STATISTICI anon directa')) < s1.jurnal.findIndex(m => m.startsWith('STATISTICI anon alta')),
    'STATISTICI r6: fiecare intrare are queryid | apeluri | stats_since | nivel; directele primele; martorul (sub anon, preferat celui sub authenticator) cu queryid și stats_since')
  // P1.4 (b): resetare SELECTIVĂ a intrării 11 + încă 105 apeluri: sumele și rezumatul rămân identice, dar stats_since al intrării se schimbă
  await db.exec(`UPDATE stat_fals.pg_stat_statements SET stats_since = '2026-11-12 08:00:00+00' WHERE queryid = 11; UPDATE stat_fals.pg_stat_statements SET calls = 5100 WHERE queryid = 31;`)
  const s2 = await citire(db, SP(FALS))
  const c12 = compara(s1, s2)
  const dir = (c) => (/ directe: [^|]+\|/.exec(rez(c)) || [])[0]
  verifica(dir(s1) && dir(s2) === dir(s1) && JSON.stringify(c12) === JSON.stringify({ fara_proba: ['11'], crescut: [], nou: [] }),
    'STATISTICI r6: resetarea selectivă păstrează rezumatul directelor identic (fals liniștitor), dar regula pe stats_since o marchează „fără probă” (11)')
  await db.exec(`UPDATE stat_fals.pg_stat_statements SET stats_since = '2026-11-01 08:00:00+00' WHERE queryid = 11; UPDATE stat_fals.pg_stat_statements SET calls = 18 WHERE queryid = 12;`)
  verifica(JSON.stringify(compara(s1, await citire(db, SP(FALS)))) === JSON.stringify({ fara_proba: [], crescut: ['12'], nou: [] }), 'STATISTICI r6: un apel direct nou pe aceeași intrare = „a crescut”')
  await db.exec(`UPDATE stat_fals.pg_stat_statements SET calls = 17 WHERE queryid = 12;`)
  // P1.4 (a) track = none; setare pe rol; fără martor; fără stats_since; text ascuns; fără momentul resetării = LIPSĂ DE DOVADĂ
  await db.exec(`SET LOCAL pg_stat_statements.track = 'none';`)
  verifica(/ track: none \| .*dovada: LIPSA DE DOVADA \(track = none: interogarile nu se colecteaza\)$/.test(rez(await citire(db, SP(FALS)))), 'STATISTICI r6: track = none = LIPSĂ DE DOVADĂ (valoarea tipărită)')
  const mT = await citire(db, SP(aplica(FALS, [["           WHEN v_track NOT IN ('top', 'all') THEN 'LIPSA DE DOVADA (track = ' || v_track || ': interogarile nu se colecteaza)'\n", '']])))
  verifica(/ track: none \| .*dovada: DA$/.test(rez(mT)), 'mutant fără verificarea track: contoare care nu se mai colectează dau „dovada: DA”')
  await db.exec(`SET LOCAL pg_stat_statements.track = 'top'; ALTER ROLE anon SET pg_stat_statements.track = 'none';`)
  verifica(/dovada: LIPSA DE DOVADA \(setari pg_stat_statements pe roluri: anon:pg_stat_statements.track\)$/.test(rez(await citire(db, SP(FALS)))), 'STATISTICI r6: setare pg_stat_statements pe rolul anon = LIPSĂ DE DOVADĂ')
  await db.exec(`ALTER ROLE anon RESET pg_stat_statements.track; DELETE FROM stat_fals.pg_stat_statements WHERE queryid IN (31, 32);`)
  verifica(/ martor: absent \| dovada: LIPSA DE DOVADA \(martor absent/.test(rez(await citire(db, SP(FALS)))), 'STATISTICI r6: fără martor PostgREST = LIPSĂ DE DOVADĂ')
  await db.exec(`INSERT INTO stat_fals.pg_stat_statements SELECT 'anon'::regrole, d.oid, true, 31, 5000, 'select set_config($1, $2, $3)', '2026-11-01 08:00:00+00' FROM pg_database d WHERE d.datname = current_database();`)
  const mP = await citire(db, SP(aplica(FALS, [["'^WITH pgrst_[a-z]+ AS', 'pgrst_call', 'rpc', '^WITH pgrst_[a-z]+ AS'", "'.', 'pgrst_call', 'rpc', '.'"]])))
  verifica(/ directe: 4 interogari, 135 apeluri /.test(rez(mP)), 'mutant fără forma PostgREST: SQL-ul scris de mână cu "public"."t_a" e numărat ca interogare directă')
  await db.exec(`ALTER TABLE stat_fals.pg_stat_statements DROP COLUMN stats_since;`)
  const s3 = await citire(db, SP(FALS))
  verifica(/ stats_since: nu \| .*dovada: LIPSA DE DOVADA \(fara stats_since/.test(rez(s3)) && s3.jurnal.some(m => /^STATISTICI anon directa: queryid 11 \| 105 apeluri \| stats_since necunoscut \| \? \|/.test(m)),
    'STATISTICI r6: fără stats_since pe intrări (PG < 17) = LIPSĂ DE DOVADĂ')
  await db.exec(`ALTER TABLE stat_fals.pg_stat_statements ADD COLUMN stats_since timestamptz DEFAULT '2026-11-01 08:00:00+00';
    INSERT INTO stat_fals.pg_stat_statements SELECT 'anon'::regrole, d.oid, true, 15, 2, '<insufficient privilege>' FROM pg_database d WHERE d.datname = current_database();`)
  verifica(/ascunse: 1 \| .*dovada: LIPSA DE DOVADA \(texte ascunse/.test(rez(await citire(db, SP(FALS)))), 'STATISTICI: un text ascuns = LIPSĂ DE DOVADĂ (nu „0 directe”)')
  await db.exec('DELETE FROM stat_fals.pg_stat_statements WHERE queryid = 15; DROP TABLE stat_fals.pg_stat_statements_info;')
  verifica(/resetare: necunoscuta \| evacuari: necunoscut .*dovada: LIPSA DE DOVADA \(momentul resetarii/.test(rez(await citire(db, SP(FALS)))), 'STATISTICI: fără momentul resetării = LIPSĂ DE DOVADĂ')
  await db.exec('ROLLBACK')
}
const acl = (await db.query(`SELECT has_table_privilege('anon', 'securitate_intern.anon_revocari', 'SELECT') a, has_schema_privilege('anon', 'securitate_intern', 'USAGE') s,
  has_table_privilege('authenticated', 'securitate_intern.anon_revocari', 'SELECT') b, has_table_privilege('service_role', 'securitate_intern.anon_revocari', 'SELECT') c`)).rows[0]
verifica(!acl.a && !acl.s && !acl.b && !acl.c, 'jurnalul: niciun drept pentru anon / authenticated / service_role')

// ── 2. reveniri + re-aplicare ──
console.log('2. revenire c -> b -> a, re-aplicare')
await trebuieSaRefuze(caRunner(db, NUME.a + '_ROLLBACK', REV.a), 'randuri 20261218b / 20261218c', 'revenirea a înaintea lui b / c')
await caRunner(db, NUME.c + '_ROLLBACK', REV.c)
await caRunner(db, NUME.b + '_ROLLBACK', REV.b)
await caRunner(db, NUME.a + '_ROLLBACK', REV.a)
const inst2 = await instantaneu(db)
verifica(JSON.stringify(inst2) === JSON.stringify(inst0), 'după revenirile c -> b -> a: TOATE drepturile exact ca la început (anon + ceilalți, pe obiecte, coloane, implicite)')
verifica((await db.query(`SELECT to_regnamespace('securitate_intern') s`)).rows[0].s === null, 'jurnalul și schema lui au dispărut')
await caRunner(db, NUME.a, M.a); await caRunner(db, NUME.b, M.b); await caRunner(db, NUME.c, M.c)
verifica(JSON.stringify(altiiDin(await instantaneu(db))) === JSON.stringify(altiiDin(inst0)) && JSON.stringify(anonDin(await instantaneu(db))) === JSON.stringify(anonDin(inst1)), 're-aplicarea a -> b -> c: aceeași stare ca prima dată')
await trebuieSaRefuze(caRunner(db, NUME.b, M.b), 'reaplicare', 'b de două ori')
await trebuieSaRefuze(caRunner(db, NUME.a, M.a), 'exista deja', 'a de două ori')
// revenirea refuză când starea s-a schimbat după livrare
await db.exec('GRANT SELECT ON public.t_identity TO anon;')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'drepturi noi pentru anon', 'revenirea b după un drept nou pentru anon pe un obiect retras')
await db.exec('REVOKE SELECT ON public.t_identity FROM anon;')
// coloana recreată (contraexemplul review-ului #1081 P1): „a” redenumită, alta nouă cu numele „a” => refuz, iar coloana nouă nu primește nimic
await db.exec('ALTER TABLE public.t_coloane RENAME COLUMN a TO a_vechi; ALTER TABLE public.t_coloane ADD COLUMN a text;')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'coloane schimbate', 'revenirea b după redenumirea coloanei a + o coloană nouă „a”')
verifica(!(await db.query(`SELECT has_column_privilege('anon', 'public.t_coloane', 'a', 'SELECT') x`)).rows[0].x
  && !(await db.query(`SELECT has_column_privilege('anon', 'public.t_coloane', 'a_vechi', 'SELECT') x`)).rows[0].x, 'coloana nouă „a” (și cea veche) NU au primit dreptul')
await db.exec('ALTER TABLE public.t_coloane DROP COLUMN a; ALTER TABLE public.t_coloane RENAME COLUMN a_vechi TO a;')
await db.exec('ALTER TABLE public.t_coloane ALTER COLUMN a TYPE varchar(50);')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'coloane schimbate', 'revenirea b după schimbarea tipului coloanei a')
await db.exec('ALTER TABLE public.t_coloane ALTER COLUMN a TYPE text;')
await db.exec('ALTER TABLE public.t_coloane DROP COLUMN a; ALTER TABLE public.t_coloane ADD COLUMN a text;')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'coloane schimbate', 'revenirea b după scoaterea coloanei a și adăugarea alteia cu același nume')
await db.exec('DROP VIEW public.v_simplu;')
await trebuieSaRefuze(caRunner(db, NUME.b + '_ROLLBACK', REV.b), 'disparute', 'revenirea b după ștergerea unui obiect retras')
await db.exec('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon;')
await trebuieSaRefuze(caRunner(db, NUME.c + '_ROLLBACK', REV.c), 'date dupa livrare', 'revenirea c după un drept implicit nou pentru anon')
await db.close()

// ── 3. refuzuri și mutanți ──
console.log('3. refuzuri și mutanți')
async function cuBaza(fn) { const d = await bazaNoua(); try { return await fn(d) } finally { await d.close() } }
for (const k of ['a', 'b', 'c']) {
  await cuBaza(async (d) => {
    const { mig } = await migrariCuBaseline(d)
    if (k !== 'a') await caRunner(d, NUME.a, mig.a)
    await trebuieSaRefuze(caRunner(d, NUME[k], MIG[k]), 'BASELINE necompletat', `${k}: BASELINE necompletat`)
    await trebuieSaRefuze(caRunner(d, NUME[k], mig[k], { plafon: 0, marcajPlafon: false }), 'PLAFON_TRANZACTIE lipsa', `${k}: fără plafon`)
    await trebuieSaRefuze(caRunner(d, NUME[k], mig[k], { marcaj: false }), 'garda start invalida', `${k}: fără marcajul runnerului`)
  })
}
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'se aplica intai 20261218a', 'b înaintea lui a')
  await trebuieSaRefuze(caRunner(d, NUME.c, mig.c), 'se aplica intai 20261218a', 'c înaintea lui a')
})
// un obiect NOU apărut între citire (baseline) și aplicare = refuz, cu lista de acum în NOTICE
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await d.exec('CREATE TABLE public.t_aparut (id serial PRIMARY KEY);')
  const e = await trebuieSaRefuze(caRunner(d, NUME.a, mig.a), 'difera de BASELINE', 'a: o secvență nouă după citire')
  verifica(e?.jurnal?.some(m => m.includes('secventa public.t_aparut_id_seq')), 'a: NOTICE-ul refuzului arată obiectul nou')
  await d.exec('DROP TABLE public.t_aparut;')
  await caRunner(d, NUME.a, mig.a)
  await d.exec('CREATE VIEW public.v_aparuta AS SELECT 1 AS x;')
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'difera de BASELINE', 'b: o vedere nouă după citire')
  await d.exec('DROP VIEW public.v_aparuta; CREATE POLICY p_noua ON public.t_identity TO anon USING (true);')
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'difera de BASELINE', 'b: o politică nouă pentru anon după citire (obiectul iese din T2)')
  await d.exec('DROP POLICY p_noua ON public.t_identity; GRANT SELECT (a) ON public.t_fara_politici TO anon;'.replace('(a)', '(x)'))
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'difera de BASELINE', 'b: alte drepturi (o coloană) după citire')
  await d.exec('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE USAGE ON SEQUENCES FROM anon;')
  await trebuieSaRefuze(caRunner(d, NUME.c, mig.c), 'difera de BASELINE', 'c: implicitele schimbate după citire')
})
// r2 (review #1081 P1): un obiect RECREAT cu același nume / aceleași drepturi, sau schimbat în ce nu ține de drepturile lui anon, după citire
const RECREARI = [
  ['a', 'secvența IDENTITY recreată (tabelul șters și recreat identic)', `DROP TABLE public.t_identity;
    CREATE TABLE public.t_identity (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, x text); ALTER TABLE public.t_identity ENABLE ROW LEVEL SECURITY;`],
  ['a', 'secvența scoasă din DEFAULT-ul tabelului ei', 'ALTER TABLE public.t_coloane ALTER COLUMN id SET DEFAULT 0;'],
  ['b', 'vederea ștearsă și recreată IDENTIC (alt oid)', `DROP VIEW public.v_simplu;
    CREATE VIEW public.v_simplu WITH (security_invoker = on) AS SELECT id, x FROM public.t_fara_politici;`],
  ['b', 'corpul vederii rescris (același oid)', 'CREATE OR REPLACE VIEW public.v_simplu WITH (security_invoker = on) AS SELECT id, x, 1 AS y FROM public.t_fara_politici;'],
  ['b', 'FORCE ROW LEVEL SECURITY pornit', 'ALTER TABLE public.t_identity FORCE ROW LEVEL SECURITY;'],
  ['b', 'RLS oprit', 'ALTER TABLE public.t_identity DISABLE ROW LEVEL SECURITY;'],
  ['b', 'expresia unei politici (pentru authenticated) schimbată', 'ALTER POLICY t_fp_auth ON public.t_fara_politici USING (true);'],
  ['b', 'un DEFAULT schimbat', `ALTER TABLE public.t_fara_politici ALTER COLUMN x SET DEFAULT 'z';`],
  ['b', 'partiția desprinsă de părinte', 'ALTER TABLE public.t_part DETACH PARTITION public.t_part_1;'],
]
for (const [k, nume, sql] of RECREARI) {
  await cuBaza(async (d) => {
    const { mig } = await migrariCuBaseline(d)
    if (k !== 'a') await caRunner(d, NUME.a, mig.a)
    await d.exec(sql)
    await trebuieSaRefuze(caRunner(d, NUME[k], mig[k]), 'difera de BASELINE', `${k}: ${nume} după citire`)
  })
}
// r2: CURSA dintre calculul listei și REVOKE (review #1081 P1). PGlite are o singură conexiune: „cealaltă sesiune” e simulată determinist,
// cu instrucțiunea ei injectată EXACT în fereastră (proba cu două sesiuni reale: scripts/anon_drepturi_concurenta.mjs, pe clona PG17).
const INJ_A = '-- ── jurnalul comun al treptelor (neexpus în API, doar postgres) ──'
const INJ_B = '-- ── jurnal, blocarea rândurilor + recitirea, apoi UN SINGUR REVOKE pe lista din jurnal + verificarea coloanelor ──'
const INJ_C = 'CREATE ROLE gazpet_santinela_20261218c NOLOGIN NOINHERIT;'
const REV_B_IN = "  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';"
// blocarea din r3 (FROM PUBLIC), pentru mutanții care reproduc defectul review-ului r3 P1
const SANT = {
  a: ["  EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM gazpet_santinela_20261218a';", "  EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM PUBLIC';"],
  b: ["  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM gazpet_santinela_20261218b';", "  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM PUBLIC';"],
  c: ['ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM gazpet_santinela_20261218c;',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;'],
}
const GRANT_SEQ = 'GRANT SELECT ON SEQUENCE public.t_identity_id_seq TO anon WITH GRANT OPTION;'
const jurnalT = async (d, m, e) => (await d.query(`SELECT drepturi, coloane FROM securitate_intern.anon_revocari WHERE migrare = '${m}' AND eticheta = '${e}'`)).rows[0]
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await trebuieSaRefuze(caRunner(d, NUME.a, aplica(mig.a, [[INJ_A, GRANT_SEQ + '\n' + INJ_A]])), 'schimbare concurenta',
    'cursa a: un drept nou (opțiune de acordare) pe o secvență din listă, între calcul și blocare')
  await trebuieSaRefuze(caRunner(d, NUME.a, aplica(mig.a, [[SANT.a[0], '  NULL;']])),
    'blocarea randurilor din catalog nu s-a facut', 'mutant a fără blocare: dovada pe xmin refuză')
  // r4: fără recitirea regulii, aceeași cursă e prinsă de recitirea ACL-ului complet (intrarea lui anon s-a schimbat)
  const FARA_REG = ["  IF v_dif IS NOT NULL THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta", "  IF false THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta"]
  const FARA_ACL = ["  IF v_dif IS NOT NULL THEN\n    RAISE EXCEPTION '20261218a: ACL complet schimbat concurent", "  IF false THEN\n    RAISE EXCEPTION '20261218a: ACL complet schimbat concurent"]
  await trebuieSaRefuze(caRunner(d, NUME.a, aplica(mig.a, [[INJ_A, GRANT_SEQ + '\n' + INJ_A], FARA_REG])), 'ACL complet schimbat concurent',
    'a fără recitirea regulii: dreptul nou al lui anon e prins de recitirea ACL complet')
  // mutantul fără AMBELE recitiri: aceeași cursă TRECE și dreptul injectat dispare fără jurnal (defectul din review, reprodus)
  await caRunner(d, NUME.a, aplica(mig.a, [[INJ_A, GRANT_SEQ + '\n' + INJ_A], FARA_REG, FARA_ACL]))
  const j = await jurnalT(d, '20261218a', 'secventa public.t_identity_id_seq')
  const acum = (await d.query(`SELECT has_sequence_privilege('anon', 'public.t_identity_id_seq', 'SELECT WITH GRANT OPTION') x`)).rows[0].x
  verifica(j && !j.drepturi.some(x => x.includes('*')) && !acum, 'mutant a fără cele două recitiri: dreptul dat în fereastră e retras și LIPSEȘTE din jurnal (recitirile îl prind)')
})
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await caRunner(d, NUME.a, mig.a)
  await trebuieSaRefuze(caRunner(d, NUME.b, aplica(mig.b, [[INJ_B, 'GRANT SELECT ON public.t_identity TO anon WITH GRANT OPTION;\n' + INJ_B]])), 'schimbare concurenta',
    'cursa b: un drept nou pe un tabel din listă, între calcul și blocare')
  const COL = `  EXECUTE 'GRANT SELECT (x) ON public.t_identity TO anon';\n` + REV_B_IN
  await trebuieSaRefuze(caRunner(d, NUME.b, aplica(mig.b, [[REV_B_IN, COL]])), 'drepturi pe coloane schimbate concurent',
    'cursa b: un drept pe o coloană FĂRĂ drepturi (rând neblocat), între recitire și REVOKE')
  await caRunner(d, NUME.b, aplica(mig.b, [[REV_B_IN, COL], ['  IF v_col_dupa IS DISTINCT FROM v_col THEN', '  IF false THEN']]))
  const j = await jurnalT(d, '20261218b', 'tabel public.t_identity')
  verifica(j && !j.coloane.some(x => / x anon=/.test(x)), 'mutant b fără verificarea coloanelor: dreptul pe coloană dat în fereastră e retras și LIPSEȘTE din jurnal')
})
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await caRunner(d, NUME.a, mig.a)
  await trebuieSaRefuze(caRunner(d, NUME.c, aplica(mig.c, [[INJ_C, 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO anon;\n' + INJ_C]])),
    'schimbare concurenta', 'cursa c: un drept implicit nou pentru anon, între calcul și blocare')
})
// r4 (review r3 P1): un drept dat lui PUBLIC între calcul și blocare. Cu santinela: refuz (dreptul nu e consumat, recitirea îl vede).
// Mutantul cu blocarea din r3 (FROM PUBLIC): A COMITE și dreptul PUBLIC dispare fără jurnal = defectul din review, reprodus.
const PUB = {
  a: ['GRANT SELECT ON SEQUENCE public.t_identity_id_seq TO PUBLIC;', INJ_A, `SELECT count(*)::int n FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = 'public.t_identity_id_seq'::regclass AND e.grantee = 0`],
  b: ['GRANT SELECT ON public.t_identity TO PUBLIC;', INJ_B, `SELECT count(*)::int n FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = 'public.t_identity'::regclass AND e.grantee = 0`],
  c: ['ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;', INJ_C,
      `SELECT count(*)::int n FROM pg_default_acl d, aclexplode(d.defaclacl) e WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r' AND e.grantee = 0`],
}
for (const k of ['a', 'b', 'c']) {
  await cuBaza(async (d) => {
    const { mig } = await migrariCuBaseline(d)
    if (k !== 'a') await caRunner(d, NUME.a, mig.a)
    const [g, inj, nPub] = PUB[k]
    await trebuieSaRefuze(caRunner(d, NUME[k], aplica(mig[k], [[inj, g + '\n' + inj]])), k === 'c' ? 'ACL complet schimbat concurent' : 'schimbare concurenta',
      `cursa ${k} (R7): un drept nou pentru PUBLIC pe o țintă, între calcul și blocare => refuz, nimic consumat`)
    await caRunner(d, NUME[k], aplica(mig[k], [[inj, g + '\n' + inj], SANT[k]]))
    const dupa = (await d.query(nPub)).rows[0].n
    verifica(dupa === 0, `mutant ${k} cu blocarea din r3 (FROM PUBLIC): A comite și dreptul PUBLIC dat în fereastră DISPARE (${dupa} intrări PUBLIC după) — defectul review-ului r3, reprodus`)
  })
}
// r4: recitirea ACL-ului COMPLET e plasa a doua. Pe c, regula nu vede PUBLIC (detaliul T3 = doar anon), deci recitirea ACL o prinde; fără ea
// (mutant) refuză abia sonda (tabelul nou primește SELECT prin PUBLIC). Pe a, fără recitirea regulii, o prinde recitirea ACL.
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await caRunner(d, NUME.a, mig.a)
  const FARA_ACL_C = ['  IF v_dif IS NOT NULL THEN\n    RAISE EXCEPTION \'20261218c: ACL complet schimbat concurent', '  IF false THEN\n    RAISE EXCEPTION \'20261218c: ACL complet schimbat concurent']
  await trebuieSaRefuze(caRunner(d, NUME.c, aplica(mig.c, [[PUB.c[1], PUB.c[0] + '\n' + PUB.c[1]], FARA_ACL_C])), 'obiecte-sonda',
    'mutant c fără recitirea ACL complet: dreptul implicit PUBLIC dat în fereastră e prins abia de sondă')
})
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  const FARA_REG_A = ["  IF v_dif IS NOT NULL THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta", "  IF false THEN\n    RAISE EXCEPTION '20261218a: schimbare concurenta"]
  await trebuieSaRefuze(caRunner(d, NUME.a, aplica(mig.a, [[PUB.a[1], PUB.a[0] + '\n' + PUB.a[1]], FARA_REG_A])), 'ACL complet schimbat concurent',
    'a fără recitirea regulii: dreptul PUBLIC dat în fereastră e prins de recitirea ACL complet')
  await trebuieSaRefuze(caRunner(d, NUME.a, aplica(mig.a, [[PUB.a[1], 'GRANT SELECT ON SEQUENCE public.t_identity_id_seq TO authenticated WITH GRANT OPTION;\n' + PUB.a[1]]])),
    'ACL complet schimbat concurent', 'a: un drept nou pentru ALT rol pe o țintă, între calcul și blocare => refuz (ACL complet)')
})
// r4 (review r3 P1, T2): o politică pentru anon creată între recitire și REVOKE. În PGlite (o conexiune, aceeași tranzacție) lock-ul ACCESS
// SHARE nu se poate proba (îl probează R6 pe clonă); aici: postcondiția b1 refuză, iar fără ea (mutant) apare exact defectul din review
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await caRunner(d, NUME.a, mig.a)
  const POL = `  EXECUTE 'CREATE POLICY p_cursa ON public.t_identity FOR SELECT TO anon USING (true)';\n` + REV_B_IN
  await trebuieSaRefuze(caRunner(d, NUME.b, aplica(mig.b, [[REV_B_IN, POL]])), 'politica pentru anon / PUBLIC (aparuta concurent sau regula gresita)',
    'cursa b (R6): politică pentru anon creată între recitire și REVOKE => refuz la postcondiția b1')
  const FARA_B1 = ["  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218b post: obiecte din jurnal cu politica", "  IF false THEN RAISE EXCEPTION '20261218b post: obiecte din jurnal cu politica"]
  await caRunner(d, NUME.b, aplica(mig.b, [[REV_B_IN, POL], FARA_B1]))
  const pol = (await d.query(`SELECT count(*)::int n FROM pg_policy WHERE polname = 'p_cursa'`)).rows[0].n
  const jur = (await d.query(`SELECT count(*)::int n FROM securitate_intern.anon_revocari WHERE migrare = '20261218b' AND eticheta = 'tabel public.t_identity'`)).rows[0].n
  const x = await caAnon(d, 'SELECT * FROM public.t_identity')
  verifica(pol === 1 && jur === 1 && !x.ok && x.code === '42501',
    `mutant b fără postcondiția b1: A comite, politica există (${pol}), tabelul e în jurnal (${jur}), SELECT ca anon = ${x.code || 'ok'} — defectul review-ului r3, reprodus`)
})
// r4: santinela nu rămâne și nu poate fi ocupată dinainte
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await d.exec('CREATE ROLE gazpet_santinela_20261218a NOLOGIN;')
  await trebuieSaRefuze(caRunner(d, NUME.a, mig.a), 'rolul gazpet_santinela_20261218a exista deja', 'a: numele santinelei ocupat => refuz înainte de orice scriere')
  await d.exec('DROP ROLE gazpet_santinela_20261218a;')
  await caRunner(d, NUME.a, mig.a); await caRunner(d, NUME.b, mig.b); await caRunner(d, NUME.c, mig.c)
  const r = (await d.query(`SELECT count(*)::int n FROM pg_roles WHERE rolname LIKE 'gazpet_santinela_%'`)).rows[0].n
  verifica(r === 0, 'după a + b + c: niciun rol-santinelă rămas')
})
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await trebuieSaRefuze(caRunner(d, NUME.a, aplica(mig.a, [['  DROP ROLE gazpet_santinela_20261218a;', '  NULL;']])), 'rolul-santinela inca exista',
    'mutant a fără DROP ROLE: postcondiția refuză (santinela nu poate rămâne)')
})
await cuBaza(async (d) => {
  const { mig } = await migrariCuBaseline(d)
  await caRunner(d, NUME.a, mig.a)
  await d.exec('ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON TABLES TO anon;')
  await trebuieSaRefuze(caRunner(d, NUME.c, mig.c), 'implicite GLOBALE', 'c: un drept implicit GLOBAL al lui postgres pentru anon')
})
// pct. 1: un obiect FOLOSIT de o pagină publică (declarat în regulă, aceeași schimbare în citire și migrare) NU se retrage, cu tot ce citește
await cuBaza(async (d) => {
  const P = [[PASTRATE_GOL, PASTRATE_FORMULAR]]
  const { mig, citire: c } = await migrariCuBaseline(d, { citireText: aplica(CITIRE, P), mig: { a: aplica(MIG.a, P), b: aplica(MIG.b, P), c: aplica(MIG.c, P) } })
  const o = sectiune(c, 'OBIECT')
  verifica(['vedere public.v_formular_public', 'tabel public.formular_public', 'secventa public.formular_public_id_seq']
    .every(e => o.some(x => x.eticheta === e && x.treapta === 'RAMANE')), 'pct. 1: vederea folosită, tabelul citit de ea și secvența lui (DEFAULT nextval) rămân')
  await caRunner(d, NUME.a, mig.a); await caRunner(d, NUME.b, mig.b); await caRunner(d, NUME.c, mig.c)
  let x = await caAnon(d, `INSERT INTO public.formular_public (nume) VALUES ('din pagina')`)
  verifica(x.ok, 'pct. 1: INSERT-ul paginii publice ca anon merge după T1+T2+T3' + (x.ok ? '' : ' — ' + x.mesaj))
  x = await caAnon(d, 'SELECT * FROM public.v_formular_public')
  verifica(x.ok, 'pct. 1: citirea vederii publice ca anon merge după T1+T2+T3' + (x.ok ? '' : ' — ' + x.mesaj))
})
// mutant: obiectul păstrat doar în citire (baseline), nu și în migrare -> listele diferă -> refuz
await cuBaza(async (d) => {
  const { mig: normal } = await migrariCuBaseline(d)
  const { mig } = await migrariCuBaseline(d, { citireText: aplica(CITIRE, [[PASTRATE_GOL, PASTRATE_FORMULAR]]) })
  await caRunner(d, NUME.a, normal.a)
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'difera de BASELINE', 'mutant: regula din migrare diferă de cea din citire (pct. 1 doar într-una)')
})
// mutant pe REGULĂ: fără prudența secvențelor tabelelor cu politică INSERT -> INSERT-ul permis de politică pică (verificarea principală l-ar prinde)
await cuBaza(async (d) => {
  const R = [['SELECT d.refobjid FROM (SELECT i.oid FROM anon_pastrate_inchise i UNION SELECT p.oid FROM anon_insert_politici p) i',
              'SELECT d.refobjid FROM (SELECT i.oid FROM anon_pastrate_inchise i) i']]
  const { mig } = await migrariCuBaseline(d, { citireText: aplica(CITIRE, R), mig: { a: aplica(MIG.a, R), b: aplica(MIG.b, R), c: aplica(MIG.c, R) } })
  await caRunner(d, NUME.a, mig.a)
  const x = await caAnon(d, `INSERT INTO public.formular_public (nume) VALUES ('fara cont')`)
  verifica(!x.ok && x.code === '42501', 'mutant regulă fără secvențele tabelelor cu politică INSERT: INSERT-ul anon chiar pică (verificarea principală l-ar prinde)')
})
// mutanți pe migrare / revenire: fiecare TREBUIE să pice la verificarea lui
const MUTANTI = [
  ['a fără REVOKE', 'a', [["EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM anon';", 'NULL;']], 'anon mai are drepturi'],
  // r4: prins acum mai devreme, de ACL-ul complet (b2), înaintea amprentei ALTE_ROLURI
  ['b retrage și de la authenticated', 'b', [["EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';", "EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon, authenticated';"]], 'ACL-ul complet nu difera EXACT prin intrarile lui anon'],
  ['b retrage și de la authenticated, fără b2', 'b', [["EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';", "EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon, authenticated';"],
    ["  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218b post: ACL-ul complet", "  IF false THEN RAISE EXCEPTION '20261218b post: ACL-ul complet"]], 'drepturile altor roluri'],
  ['b retrage doar SELECT (coloanele rămân)', 'b', [["EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';", "EXECUTE 'REVOKE SELECT ON TABLE ' || v_lista || ' FROM anon';"]], 'anon mai are drepturi'],
  ['c fără secvențe', 'c', [['ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;', '']], 'obiecte-sonda'],
]
for (const [nume, k, inl, fragment] of MUTANTI) {
  await cuBaza(async (d) => {
    const { mig } = await migrariCuBaseline(d)
    if (k !== 'a') await caRunner(d, NUME.a, mig.a)
    await trebuieSaRefuze(caRunner(d, NUME[k], aplica(mig[k], inl)), fragment, 'mutant ' + nume)
  })
}
const MUTANTI_REV = [
  ['revenirea b fără coloane', 'b', [["EXECUTE format('GRANT %s (%s) ON TABLE %s TO anon', g.drept, g.coloane, g.tabel) || CASE WHEN g.optiune THEN ' WITH GRANT OPTION' ELSE '' END;", 'NULL;']], 'nu sunt exact cele din jurnal'],
  ['revenirea b dă și TRUNCATE', 'b', [["EXECUTE format('GRANT %s ON TABLE %s TO anon', g.simple, g.lista);", "EXECUTE format('GRANT %s, TRUNCATE ON TABLE %s TO anon', g.simple, g.lista);"]], 'nu sunt exact cele din jurnal'],
  ['revenirea a dă și lui authenticated', 'a', [["EXECUTE format('GRANT %s ON SEQUENCE %s TO anon', g.simple, g.lista);", "EXECUTE format('GRANT %s ON SEQUENCE %s TO anon', g.simple, g.lista); EXECUTE format('REVOKE UPDATE ON SEQUENCE %s FROM authenticated', g.lista);"]], 'drepturile altor roluri'],
  ['revenirea c fără secvențe', 'c', [["      FROM securitate_intern.anon_revocari j WHERE j.migrare = '20261218c'\n  LOOP",
    "      FROM securitate_intern.anon_revocari j WHERE j.migrare = '20261218c' AND j.eticheta = 'implicit postgres public r'\n  LOOP"]], 'nu sunt exact cele din jurnal'],
]
for (const [nume, k, inl, fragment] of MUTANTI_REV) {
  await cuBaza(async (d) => {
    const { mig } = await migrariCuBaseline(d)
    await caRunner(d, NUME.a, mig.a); await caRunner(d, NUME.b, mig.b); await caRunner(d, NUME.c, mig.c)
    if (k === 'a') { await caRunner(d, NUME.c + '_ROLLBACK', REV.c); await caRunner(d, NUME.b + '_ROLLBACK', REV.b) }
    await trebuieSaRefuze(caRunner(d, NUME[k] + '_ROLLBACK', aplica(REV[k], inl)), fragment, 'mutant ' + nume)
  })
}
// mutant pe REGULĂ (aceeași schimbare peste tot, deci baseline-ul o acceptă): tabelele cu politici intră în T2 -> verificarea independentă pică
await cuBaza(async (d) => {
  const R = [["                  WHEN r.politici_anon > 0 THEN 'RAMANE'\n", '']]
  const { mig } = await migrariCuBaseline(d, { citireText: aplica(CITIRE, R), mig: { a: aplica(MIG.a, R), b: aplica(MIG.b, R), c: aplica(MIG.c, R) } })
  await caRunner(d, NUME.a, mig.a)
  // r4: postcondiția b1 (niciun obiect din jurnal cu politică pentru anon / PUBLIC) prinde și o regulă greșită, nu doar cursa
  await trebuieSaRefuze(caRunner(d, NUME.b, mig.b), 'politica pentru anon / PUBLIC', 'mutant regulă fără excepția politicilor: refuz la postcondiția b1')
  await caRunner(d, NUME.b, aplica(mig.b, [["  IF v_dif IS NOT NULL THEN RAISE EXCEPTION '20261218b post: obiecte din jurnal cu politica", "  IF false THEN RAISE EXCEPTION '20261218b post: obiecte din jurnal cu politica"]]))
  const a = anonDin(await instantaneu(d))
  verifica(!a.some(l => l.startsWith('rel t_cu_politica ')), 'mutant regulă fără excepția politicilor și fără b1: tabelul cu politică chiar pierde dreptul (verificarea principală l-ar prinde)')
})

console.log(`\n${treceri} verificări trecute, ${esecuri} picate`)
process.exit(esecuri ? 1 : 0)
