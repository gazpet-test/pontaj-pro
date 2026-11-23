// L15 v2, optimizarea calculului (17.11.2026): PARITATEA blocului AG_CATALOG v2 si a pasilor runnerului cu forma de DINAINTE
// (commit-ul fixat REF de mai jos = main pe care s-a facut diagnosticul; sha256 verificat), pe PGlite (Postgres in WASM, in
// memorie) — NU atinge nicio baza reala. Forma veche se ia din git (git show REF:...), cea noua din arborele de lucru.
// Ce dovedeste (expected = forma veche, sursa independenta de codul nou — L25):
//   1. vechi FULL JOIN nou pe (familie, eticheta), in ACEEASI interogare (aceeasi fotografie): 0 randuri doar intr-o parte,
//      0 randuri cu amprenta sau detaliu diferit, acelasi GLOBAL, amprenta = md5(detaliu); etichete unice in ambele;
//   2. la fel dupa schimbari reprezentative din fiecare familie atinsa (relatie, coloana, functie, tip, acl_sistem) si din
//      cateva neatinse (fiecare intr-un SAVEPOINT anulat); fiecare schimbare chiar schimba GLOBAL-ul vechi;
//   3. MUTANTII blocului nou (rand omis, camp omis, grantor omis, schema exclusa, regula randurilor atasate eliminata + cei ai
//      optimizarilor: ACL-ul unui tip de obiect nelegat, garda inversata, ordinea enum) sunt PRINSI de comparatie;
//   4. pasii runnerului vechi / nou (inainte, dupa, citire "-", aprobat, manifest bun / gresit) dau ACELEASI rezultate si
//      ACELEASI mesaje (fara timpi), inclusiv refuzurile de validare pe randuri invalide / duble injectate in set;
//   5. planul: legatura cu ag_acl e Hash Join (fara bucla pe CTE); validarile runnerului raman cele de dinainte (o trecere comuna
//      a fost retrasa la review r1-r2: la limite de resurse schimba ordinea refuzurilor; vezi validatorul izolat de la 4);
//   6. timpul (ORIENTATIV, PGlite nu e productia): blocul si pasii, vechi / nou, 5 rulari alternate pe un catalog sintetic.
// Punctele 1-3 ruleaza dintr-UN fisier SQL (BEGIN; obiectele de proba zz_l15_*; cazurile; ROLLBACK), acelasi pe care
// coordonatorul il ruleaza pe PostgreSQL 17 real (clona): --sql-clona <dosar nou> il scrie (cu antet psql) si iese.
// Rulare (din radacina repo-ului, cu istoricul git care contine REF; cere bash in PATH):
//   npm install --no-save @electric-sql/pglite && node scripts/pglite/test_amprenta_paritate_calcul.mjs
//   node scripts/pglite/test_amprenta_paritate_calcul.mjs --sql-clona <dosar nou>    (doar scrie cazuri_clona.sql)
import { PGlite } from '@electric-sql/pglite'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REF = 'a69ef1860794293c91e1e66f7238d2735031fc77'
const SHA_REF = {
  'scripts/amprenta_globala_v2.sql': '89dd33ecd09fedb212b58c82e3d07527744c6119cbb65d1d76a7c2ee7c0b1afc',
  'scripts/livrare_amprenta.sh': '266fd50f1051650759ecc8eee8cae61b20da4613cd280d6ff752e2552eb6cbed',
  'scripts/livrare_amprenta_gen.sh': '1bdb2d816662c54a9b042a606a3eb5d7878eb001265098005524437bfff4d60c',
}
const TMP = mkdtempSync(join(tmpdir(), 'ag_par_'))
let esecuri = 0
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { esecuri++; console.log('  ESEC ' + m) } }
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const lit = (s) => "'" + String(s).split("'").join("''") + "'"

// forma VECHE: fisierele din REF, intr-un dosar temporar (aceeasi structura, ca gen-ul sa-si gaseasca blocul)
mkdirSync(join(TMP, 'ref', 'scripts'), { recursive: true })
for (const [f, h] of Object.entries(SHA_REF)) {
  const b = execFileSync('git', ['-C', ROOT, 'show', `${REF}:${f}`])
  if (sha256(b) !== h) throw new Error(`REF ${f}: sha256 ${sha256(b)} <> ${h}`)
  writeFileSync(join(TMP, 'ref', f), b)
}
const genDin = (dir) => (...a) => execFileSync('bash', [join(dir, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const GEN = { vechi: genDin(join(TMP, 'ref')), nou: genDin(ROOT) }
const CAT = { vechi: GEN.vechi('bloc', 'AG_CATALOG v2'), nou: GEN.nou('bloc', 'AG_CATALOG v2') }
const GUC = GEN.nou('guc_local')
if (GUC !== GEN.vechi('guc_local')) throw new Error('GUC-urile canonice difera intre forme')
if (CAT.vechi === CAT.nou) throw new Error('blocul nou e identic cu cel vechi: testul n-ar dovedi nimic')
const GLOB = (rel) => GEN.nou('global', rel).trim()
if (GLOB('x') !== GEN.vechi('global', 'x').trim()) throw new Error('formula GLOBAL difera intre forme')
const exprGlob = (rel) => `(${GLOB(rel).replace(/ AS global_md5, .*$/, '')} FROM ${rel} a)`   // doar expresia, pe CTE

// --- paritatea blocului: o singura interogare (aceeasi fotografie) -----------------------------------------------------
const sqlParitate = (vechi, nou) => `WITH vechi AS MATERIALIZED (
${vechi}
), nou AS MATERIALIZED (
${nou}
), j AS MATERIALIZED (SELECT v.familie AS fv, v.eticheta AS ev, v.amprenta AS av, v.detaliu AS dv, n.familie AS fn, n.eticheta AS en, n.amprenta AS an, n.detaliu AS dn
  FROM vechi v FULL JOIN nou n ON n.familie = v.familie AND n.eticheta = v.eticheta)
SELECT (SELECT count(*) FROM vechi) AS n_vechi, (SELECT count(*) FROM nou) AS n_nou,
  (SELECT count(*) FROM (SELECT 1 FROM vechi GROUP BY familie, eticheta HAVING count(*) > 1) d) AS duble_vechi,
  (SELECT count(*) FROM (SELECT 1 FROM nou GROUP BY familie, eticheta HAVING count(*) > 1) d) AS duble_nou,
  (SELECT count(*) FROM j WHERE j.ev IS NULL) AS doar_nou, (SELECT count(*) FROM j WHERE j.en IS NULL) AS doar_vechi,
  (SELECT count(*) FROM j WHERE j.ev IS NOT NULL AND j.en IS NOT NULL AND (j.av IS DISTINCT FROM j.an OR j.dv IS DISTINCT FROM j.dn)) AS diferite,
  (SELECT count(*) FROM j WHERE j.dn IS NOT NULL AND j.an IS DISTINCT FROM md5(j.dn)) AS amprenta_nou_gresita,
  (SELECT string_agg(coalesce(j.ev, j.en), ' | ' ORDER BY coalesce(j.ev, j.en)) FROM (SELECT * FROM j WHERE j.ev IS NULL OR j.en IS NULL
     OR j.av IS DISTINCT FROM j.an OR j.dv IS DISTINCT FROM j.dn LIMIT 4) j) AS exemple,
  ${exprGlob('vechi')} AS global_vechi, ${exprGlob('nou')} AS global_nou`

// un caz = un rand (caz, tip, verdict OK / ESEC, detalii); tip: egal | schimbare (egal + GLOBAL-ul vechi difera de baza) | mutant
const COND = {
  egal: 'r.doar_nou + r.doar_vechi + r.diferite = 0 AND r.n_vechi = r.n_nou AND r.duble_vechi = 0 AND r.duble_nou = 0 AND r.amprenta_nou_gresita = 0 AND r.global_vechi = r.global_nou AND r.n_vechi > 0',
  mutant: 'r.doar_nou + r.doar_vechi + r.diferite > 0 AND r.global_vechi IS DISTINCT FROM r.global_nou',
}
COND.schimbare = COND.egal + ' AND r.global_vechi IS DISTINCT FROM (SELECT b.global_vechi FROM pg_temp.zz_l15_baza b)'
const DETALII = `concat(r.n_vechi, '/', r.n_nou, ' randuri, doar_vechi ', r.doar_vechi, ', doar_nou ', r.doar_nou, ', diferite ', r.diferite,
  ', duble ', r.duble_vechi, '/', r.duble_nou, ', GLOBAL ', CASE WHEN r.global_vechi = r.global_nou THEN 'egal ' || left(r.global_vechi, 8) ELSE 'DIFERIT' END,
  CASE WHEN r.exemple IS NOT NULL THEN ' | ' || r.exemple END)`
const sqlCaz = (caz, tip, sursa) => `SELECT ${lit(caz)} AS caz, ${lit(tip)} AS tip, CASE WHEN ${COND[tip]} THEN 'OK' ELSE 'ESEC' END AS verdict, ${DETALII} AS detalii
  FROM (${sursa}) r;`

// --- obiectele de proba (prefix zz_l15_; pe clona: in tranzactia cazurilor, anulata la final). Rolurile API (anon,
// authenticated, service_role) exista pe clona; in PGlite le creeaza ROLURI_API. Acopera: ACL-uri cu grantori diferiti,
// PUBLIC, roluri cu nume ciudate / numerice, optiuni de relatie / coloana FDW, transformari (protrftypes), enum cu ordine
// neliniara + enum gol, ACL-uri explicite in schemele de sistem, randuri atasate dupa initdb unui parinte de la initdb,
// obiecte create in pg_catalog. Cere superuser (pe clona: supabase_admin).
const S = 'zz_l15_proba', A = 'zz_l15_app', G1 = 'zz_l15_g1', G2 = 'zz_l15_g2', RC = '"zz_l15 Rol Ciudat"', RN = '"20261117"'
const ROLURI_API = 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;'
const FIXTURE = `
CREATE ROLE ${G1} NOLOGIN; CREATE ROLE ${G2} NOLOGIN; CREATE ROLE ${RC} NOLOGIN; CREATE ROLE ${RN} NOLOGIN;
CREATE SCHEMA ${S}; CREATE SCHEMA ${A}; GRANT USAGE ON SCHEMA ${S} TO PUBLIC; GRANT USAGE ON SCHEMA ${A} TO anon;
CREATE TYPE ${S}.stare AS ENUM ('activ', 'inchis'); ALTER TYPE ${S}.stare ADD VALUE 'nou' BEFORE 'inchis';
CREATE TYPE ${S}.gol AS ENUM ();
CREATE DOMAIN ${S}.cod AS text CHECK (VALUE ~ '^[A-Z]+$'); REVOKE USAGE ON DOMAIN ${S}.cod FROM PUBLIC;
CREATE TYPE ${S}.interval_zile AS RANGE (subtype = date);
CREATE TYPE ${S}.compus AS (a int, b text); GRANT USAGE ON TYPE ${S}.stare TO anon;
CREATE TABLE ${S}.sites (id bigint PRIMARY KEY, activ boolean DEFAULT true, stare ${S}.stare, cod ${S}.cod) WITH (fillfactor = 70, autovacuum_enabled = false);
CREATE TABLE ${S}.copil (id int PRIMARY KEY, site_id bigint REFERENCES ${S}.sites(id));
CREATE TABLE ${S}.t_gr (id int, c int);
GRANT SELECT ON ${S}.t_gr TO ${G1}, ${G2} WITH GRANT OPTION; GRANT UPDATE (c) ON ${S}.t_gr TO ${G1} WITH GRANT OPTION;
SET ROLE ${G1}; GRANT SELECT ON ${S}.t_gr TO anon; GRANT UPDATE (c) ON ${S}.t_gr TO anon; RESET ROLE;
SET ROLE ${G2}; GRANT SELECT ON ${S}.t_gr TO authenticated; RESET ROLE;
GRANT SELECT ON ${S}.sites TO PUBLIC; GRANT ALL ON ${S}.copil TO service_role; GRANT SELECT ON ${S}.copil TO ${RC}, ${RN};
CREATE SEQUENCE ${S}.s_own OWNED BY ${S}.copil.id; GRANT USAGE ON SEQUENCE ${S}.s_own TO anon;
CREATE TABLE ${S}.jurnal (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, x text);
CREATE VIEW ${S}.v_sites WITH (security_invoker = on) AS SELECT id FROM ${S}.sites; GRANT SELECT ON ${S}.v_sites TO authenticated;
CREATE MATERIALIZED VIEW ${S}.mv AS SELECT 1 AS x;
CREATE TABLE ${S}.part (id int, d date) PARTITION BY RANGE (d);
CREATE TABLE ${S}.part_2026 PARTITION OF ${S}.part FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE INDEX sites_stare ON ${S}.sites (stare) WITH (fillfactor = 80);
CREATE TABLE ${A}.t (id int, v text); ALTER TABLE ${A}.t OWNER TO ${G1};
CREATE FOREIGN DATA WRAPPER zz_l15_fdw; CREATE SERVER zz_l15_srv FOREIGN DATA WRAPPER zz_l15_fdw;
CREATE FOREIGN TABLE ${S}.ext_ag (id int OPTIONS (coloana 'x'), b text) SERVER zz_l15_srv OPTIONS (tabel 'x');
CREATE FUNCTION ${S}.f1() RETURNS int LANGUAGE sql AS 'SELECT 1';
REVOKE ALL ON FUNCTION ${S}.f1() FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${S}.f1() TO authenticated;
CREATE FUNCTION ${S}.f2(x int DEFAULT 2) RETURNS int LANGUAGE sql AS 'SELECT x';
GRANT EXECUTE ON FUNCTION ${S}.f2(int) TO ${G1} WITH GRANT OPTION; SET ROLE ${G1}; GRANT EXECUTE ON FUNCTION ${S}.f2(int) TO anon; RESET ROLE;
CREATE FUNCTION ${S}.f3() RETURNS int LANGUAGE sql AS 'SELECT 3'; ALTER FUNCTION ${S}.f3() OWNER TO ${G2};
CREATE FUNCTION ${A}.f4() RETURNS int LANGUAGE sql AS 'SELECT 4';
CREATE TRANSFORM FOR int4 LANGUAGE sql (FROM SQL WITH FUNCTION gtsvector_compress(internal), TO SQL WITH FUNCTION int4recv(internal));
CREATE FUNCTION ${S}.f_trf(int) RETURNS int LANGUAGE sql TRANSFORM FOR TYPE int4 AS 'SELECT 1';
GRANT SELECT ON pg_catalog.pg_authid TO ${G1}; GRANT SELECT (rolname) ON pg_catalog.pg_authid TO ${G1};
GRANT EXECUTE ON FUNCTION pg_catalog.pg_reload_conf() TO ${G1}; GRANT USAGE ON TYPE pg_catalog.int4 TO ${G1};
GRANT SELECT ON information_schema.tables TO ${G1} WITH GRANT OPTION; GRANT SELECT ON pg_catalog.pg_class TO ${G2};
CREATE FUNCTION ${S}.refuza_insert() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END';
CREATE TRIGGER zz_l15_refuza BEFORE INSERT ON information_schema.sql_features FOR EACH ROW EXECUTE FUNCTION ${S}.refuza_insert();
ALTER TABLE information_schema.sql_features ALTER COLUMN comments SET DEFAULT 'x';
CREATE FUNCTION pg_catalog.zz_l15_umbra(bigint) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE POLICY p_sites ON ${S}.sites FOR SELECT TO authenticated USING (id > 0); ALTER TABLE ${S}.sites ENABLE ROW LEVEL SECURITY;
`
const SCHIMBARI = [
  ['relatie', `GRANT INSERT ON ${S}.sites TO anon`], ['relatie', `ALTER TABLE ${S}.sites RESET (fillfactor, autovacuum_enabled)`],
  ['relatie', `ALTER TABLE ${S}.sites SET (fillfactor = 50)`], ['relatie', `REVOKE SELECT ON ${S}.v_sites FROM authenticated`],
  ['relatie', `ALTER TABLE ${S}.t_gr OWNER TO ${G2}`], ['relatie', `ALTER SEQUENCE ${S}.s_own OWNED BY NONE`],
  ['relatie', `CREATE TABLE ${S}.nou (x int)`], ['relatie', `DROP VIEW ${S}.v_sites`],
  ['relatie', `SET ROLE ${G2}; REVOKE SELECT ON ${S}.t_gr FROM authenticated; RESET ROLE; SET ROLE ${G1}; GRANT SELECT ON ${S}.t_gr TO authenticated; RESET ROLE`],
  ['relatie', `ALTER VIEW ${S}.v_sites SET (security_barrier = true)`],
  ['coloana', `GRANT SELECT (activ) ON ${S}.sites TO anon`], ['coloana', `REVOKE UPDATE (c) ON ${S}.t_gr FROM ${G1} CASCADE`],
  ['coloana', `ALTER FOREIGN TABLE ${S}.ext_ag ALTER COLUMN b OPTIONS (ADD z 'y')`], ['coloana', `ALTER FOREIGN TABLE ${S}.ext_ag ALTER COLUMN id OPTIONS (DROP coloana)`],
  ['functie', `REVOKE EXECUTE ON FUNCTION ${S}.f3() FROM PUBLIC`], ['functie', `GRANT EXECUTE ON FUNCTION ${S}.f1() TO ${RN}`],
  ['functie', `ALTER FUNCTION ${S}.f1() OWNER TO ${G1}`], ['functie', `CREATE FUNCTION ${S}.f5() RETURNS int LANGUAGE sql AS $f$ SELECT 5 $f$`],
  ['functie', `SET ROLE ${G1}; REVOKE EXECUTE ON FUNCTION ${S}.f2(int) FROM anon; RESET ROLE; GRANT EXECUTE ON FUNCTION ${S}.f2(int) TO anon`],
  ['functie', `DROP FUNCTION ${S}.f_trf(int)`],
  ['tip', `ALTER TYPE ${S}.stare ADD VALUE 'zz' AFTER 'activ'`], ['tip', `CREATE TYPE ${S}.e2 AS ENUM ('b', 'a')`],
  ['tip', `GRANT USAGE ON TYPE ${S}.compus TO anon`], ['tip', `ALTER TYPE ${S}.gol ADD VALUE 'unu'`], ['tip', `ALTER TYPE ${S}.compus OWNER TO ${G1}`],
  ['acl_sistem', `GRANT SELECT ON pg_catalog.pg_proc TO ${G1}`], ['acl_sistem', `REVOKE SELECT ON pg_catalog.pg_authid FROM ${G1}`],
  ['acl_sistem', `GRANT SELECT (oid) ON pg_catalog.pg_class TO ${G1}`], ['acl_sistem', `REVOKE SELECT ON pg_catalog.pg_class FROM ${G2}`],
  ['schema', `GRANT CREATE ON SCHEMA ${A} TO ${G2}`], ['politica', `ALTER POLICY p_sites ON ${S}.sites USING (true)`],
  ['trigger', `ALTER TABLE ${S}.sites DISABLE TRIGGER ALL`], ['constrangere', `ALTER TABLE ${S}.sites ADD CONSTRAINT ck_id CHECK (id > 0)`],
  ['sistem_initdb', 'ALTER FUNCTION pg_catalog.quote_nullable(text) STRICT'], ['rol', `ALTER ROLE ${G1} BYPASSRLS`],
]
const inloc = (s, a, b) => { if (s.split(a).length !== 2) throw new Error('mutant: textul nu apare exact o data: ' + a.slice(0, 80)); return s.split(a).join(b) }
const inBucata = (s, de, pana, a, b) => {
  const i = s.indexOf(de), j = s.indexOf(pana, i + 1)
  if (i < 0 || j < 0) throw new Error('mutant: bucata nu s-a gasit: ' + de)
  return s.slice(0, i) + inloc(s.slice(i, j), a, b) + s.slice(j)
}
const N = CAT.nou
const MUTANTI = [
  [`rand omis (relatie ${S}.sites)`, inloc(N, ' WHERE g.ok = 1 OFFSET 0', ` WHERE g.ok = 1 AND r.eticheta <> 'relatie ${S}.sites' OFFSET 0`)],
  ['camp omis (relforcerowsecurity in relatie)', inloc(N, 'c.relrowsecurity, c.relforcerowsecurity, c.relpersistence::text', 'c.relrowsecurity, c.relpersistence::text')],
  ['grantor omis (serializarea comuna ag_acl)', inBucata(N, 'ag_acl AS MATERIALIZED (', 'ag_enum AS (', ', a.grantor::regrole::text) AS v', ') AS v')],
  [`schema exclusa (${A})`, inloc(N, "WHERE g.ok = 1 AND n.nspname <> 'pg_toast'", `WHERE g.ok = 1 AND n.nspname <> '${A}' AND n.nspname <> 'pg_toast'`)],
  ['regula randurilor atasate eliminata (ag_par)', inloc(N, 'THEN 0 ELSE x.prag_schema END AS oid) AS prag', 'THEN 0 ELSE 4294967295 END AS oid) AS prag')],
  ['ACL-ul functiilor nelegat in ag_acl', inloc(N, 'UNION SELECT x.acl FROM ag_acl_fn x ', '')],
  ['ACL-ul relatiilor de sistem nelegat in ag_acl', inloc(N, '\n          UNION SELECT x.acl FROM ag_acl_sis x) k', ') k')],
  ['intrarea ACL a tipurilor fara acldefault', inloc(N, "coalesce(t.typacl, acldefault('T', t.typowner)) AS acl", 't.typacl AS acl')],
  ['garda reloptions inversata', inloc(N, 'CASE WHEN c.reloptions IS NOT NULL THEN', 'CASE WHEN c.reloptions IS NULL THEN')],
  ['garda attacl inversata', inloc(N, 'CASE WHEN a.attacl IS NOT NULL THEN', 'CASE WHEN a.attacl IS NULL THEN')],
  ['garda attfdwoptions inversata', inloc(N, 'CASE WHEN a.attfdwoptions IS NOT NULL THEN', 'CASE WHEN a.attfdwoptions IS NULL THEN')],
  ['garda protrftypes inversata', inloc(N, 'CASE WHEN p.protrftypes IS NOT NULL THEN', 'CASE WHEN p.protrftypes IS NULL THEN')],
  ['enum ordonat dupa eticheta', inloc(N, 'ORDER BY e.enumsortorder) AS j', 'ORDER BY e.enumlabel) AS j')],
  ['enum fara legatura', inloc(N, 'LEFT JOIN ag_enum en ON en.enumtypid = t.oid', 'LEFT JOIN ag_enum en ON false')],
]
// verificari directe pe detaliul nou (aceeasi tranzactie): enum in ordinea enumsortorder (indexul 17 al detaliului tipului),
// enum gol => null; protrftypes nenul serializat (indexul 19 al detaliului functiei)
const VERIF = [
  ['enum: ordinea enumsortorder (activ, nou, inchis); enum gol => null',
    `(SELECT (x.detaliu::jsonb -> 17) = '["activ", "nou", "inchis"]'::jsonb FROM pg_temp.zz_l15_n0 x WHERE x.eticheta = 'tip ${S}.stare')
     AND (SELECT (x.detaliu::jsonb -> 17) = 'null'::jsonb FROM pg_temp.zz_l15_n0 x WHERE x.eticheta = 'tip ${S}.gol')`],
  ['protrftypes nenul: ["integer"] in detaliul functiei cu TRANSFORM',
    `(SELECT (x.detaliu::jsonb -> 19) = '["integer"]'::jsonb FROM pg_temp.zz_l15_n0 x WHERE x.eticheta = 'functie ${S}.f_trf(integer)')`],
  ['ACL-ul cu grantor diferit (t_gr: anon de la g1, authenticated de la g2) in detaliul relatiei',
    `(SELECT x.detaliu LIKE '%["anon", "SELECT", false, "${G1}"]%' AND x.detaliu LIKE '%["authenticated", "SELECT", false, "${G2}"]%' FROM pg_temp.zz_l15_n0 x WHERE x.eticheta = 'relatie ${S}.t_gr')`],
]
// fisierul cazurilor: o tranzactie, anulata la final; fara meta-comenzi psql (antetul psql il adauga --sql-clona)
function sqlCazuri() {
  const L = ['BEGIN;', FIXTURE, GUC,
    `CREATE TEMP TABLE zz_l15_baza AS SELECT r.* FROM (${sqlParitate(CAT.vechi, CAT.nou)}) r;`,
    sqlCaz('baza: catalogul + obiectele de proba', 'egal', 'SELECT * FROM pg_temp.zz_l15_baza'),
    `CREATE TEMP TABLE zz_l15_n0 AS ${CAT.nou};`]
  for (const [nume, cond] of VERIF) L.push(`SELECT ${lit('verificare: ' + nume)} AS caz, 'verificare' AS tip, CASE WHEN ${cond} THEN 'OK' ELSE 'ESEC' END AS verdict, '' AS detalii;`)
  for (const [fam, sql] of SCHIMBARI) {
    L.push('SAVEPOINT zz_l15;', sql + ';', GUC, sqlCaz(`schimbare ${fam}: ${sql}`, 'schimbare', sqlParitate(CAT.vechi, CAT.nou)), 'ROLLBACK TO SAVEPOINT zz_l15;')
  }
  for (const [nume, m] of MUTANTI) L.push(sqlCaz(`mutant ${nume}`, 'mutant', sqlParitate(CAT.vechi, m)))
  L.push('ROLLBACK;')
  return L.join('\n')
}

// --- pasii runnerului: aceeasi tranzactie, tag fix; injectii optionale in setul sesiunii (inainte / in "migrare") ------
async function livrare(db, forma, { aprobat, manifest = null, migrare = '', injInainte = '', pre = '', T = randomBytes(8).toString('hex') }) {
  let man = '-'
  if (manifest !== null) { man = join(TMP, `m_${forma}_${T}.l15.tsv`); writeFileSync(man, manifest) }
  let ina = GEN[forma]('inainte', T, aprobat)
  if (injInainte) {
    const k = ina.indexOf(`DO $ag_pas_${T}$`)
    if (k < 0) throw new Error('pasul inainte: DO-ul final nu s-a gasit')
    ina = ina.slice(0, k) + injInainte.split('$T').join(T) + '\n' + ina.slice(k)
  }
  const sql = ina + '\n' + migrare.split('$T').join(T) + '\n;\n' + GEN[forma]('dupa', T, aprobat, man)
  const notices = []
  await db.exec('BEGIN')
  try {
    if (pre) await db.exec(pre)
    await db.exec(sql, { onNotice: (n) => notices.push(n.message) })
    await db.exec('ROLLBACK')
    return { ok: true, err: '', notices }
  } catch (e) {
    await db.exec('ROLLBACK')
    return { ok: false, err: String(e.message), notices }
  }
}
const faraTimp = (s) => s.replace(/calcul \d+ ms, la \d+ ms de la BEGIN/g, 'calcul X')
const la = (r) => JSON.stringify({ ok: r.ok, err: r.err, n: r.notices.map(faraTimp) })
const manifestDin = (notices) => notices.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
const globalCitit = (notices) => (notices.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]

async function main() {
  const iSql = process.argv.indexOf('--sql-clona')
  if (iSql > 0) {
    const dir = process.argv[iSql + 1]
    if (!dir || existsSync(dir)) throw new Error('--sql-clona: dosar NOU')
    mkdirSync(dir, { recursive: true })
    const antet = ['-- generat de scripts/pglite/test_amprenta_paritate_calcul.mjs --sql-clona; REF ' + REF + ' (forma veche) / arborele de lucru (forma noua)',
      '-- O tranzactie, ANULATA la final (ROLLBACK): obiectele de proba zz_l15_* nu raman. Cere superuser (supabase_admin pe clona).',
      '\\set ON_ERROR_STOP 1', '\\pset format unaligned', '\\pset tuples_only on', "\\pset fieldsep '\\t'"].join('\n')
    writeFileSync(join(dir, 'cazuri_clona.sql'), antet + '\n' + sqlCazuri() + '\n')
    console.log(`scris ${join(dir, 'cazuri_clona.sql')}: ${1 + VERIF.length + SCHIMBARI.length + MUTANTI.length} cazuri`)
    rmSync(TMP, { recursive: true, force: true })
    return
  }

  console.log(`PGlite ${(await db0()).ver}; REF ${REF.slice(0, 8)} (sha256 verificat)`)
  console.log('1-3. fisierul cazurilor (acelasi ca pe clona): paritatea, verificarile directe, schimbarile, mutantii')
  {
    const db = new PGlite()
    await db.exec(ROLURI_API)
    const rez = await db.exec(sqlCazuri())
    const randuri = rez.filter(r => r.fields && r.fields.map(f => f.name).join() === 'caz,tip,verdict,detalii').flatMap(r => r.rows)
    const asteptat = 1 + VERIF.length + SCHIMBARI.length + MUTANTI.length
    ok(randuri.length === asteptat, `randuri de caz: ${randuri.length} (asteptat ${asteptat})`)
    for (const r of randuri) ok(r.verdict === 'OK', `[${r.tip}] ${r.caz.slice(0, 90)}${r.detalii ? ' => ' + r.detalii : ''}`)
    const ramas = (await db.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE 'zz_l15%'")).rows[0].n
    ok(ramas === 0, 'dupa fisier nu ramane nimic (tranzactia anulata)')
    await db.close()
  }

  const db = new PGlite()
  await db.exec(ROLURI_API + FIXTURE)
  console.log('4. pasii runnerului: forma veche si cea noua dau aceleasi rezultate si aceleasi mesaje (fara timpi)')
  const pereche = async (nume, opt, asteptat) => {
    const T = randomBytes(8).toString('hex')
    const v = await livrare(db, 'vechi', { ...opt, T }), n = await livrare(db, 'nou', { ...opt, T })
    const okA = asteptat === 'ok' ? v.ok : (!v.ok && v.err.includes(asteptat))
    ok(okA && la(v) === la(n), `${nume}: ${v.ok ? 'trece' : 'refuz ' + v.err.slice(0, 90)} | nou ${la(v) === la(n) ? 'IDENTIC' : 'DIFERIT: ' + (n.err || faraTimp(n.notices.join(' / '))).slice(0, 160)}`)
    return { v, n }
  }
  const { v: c0 } = await pereche('citire "-" (generatorul de manifest), fara migrare', { aprobat: '-', manifest: null }, 'ok')
  const G0 = globalCitit(c0.notices)
  ok(/^[0-9a-f]{32}$/.test(G0 || ''), `GLOBAL citit ${G0}`)
  await pereche('aprobat corect + manifest gol', { aprobat: G0, manifest: '' }, 'ok')
  await pereche('aprobat gresit (refuzul „inainte”, cu md5-ul pe familii in mesaj)', { aprobat: '0'.repeat(32), manifest: '' }, 'AMPRENTA_GLOBALA_INAINTE')
  const MIG = `CREATE TABLE ${S}.meteo_nou (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, site_id bigint REFERENCES ${S}.sites(id));
GRANT SELECT ON ${S}.meteo_nou TO authenticated; CREATE FUNCTION ${S}.fn_nou() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;
REVOKE ALL ON FUNCTION ${S}.fn_nou() FROM PUBLIC; ALTER TYPE ${S}.stare ADD VALUE 'arhivat'; GRANT SELECT ON pg_catalog.pg_type TO anon;
ALTER TABLE ${S}.sites SET (fillfactor = 60);`
  const { v: d0 } = await pereche('citire "-" cu o migrare (diferenta L15_DIF / L15_DET tiparita)', { aprobat: '-', manifest: null, migrare: MIG }, 'ok')
  const MAN = manifestDin(d0.notices)
  ok(MAN.split('\n').filter(Boolean).length >= 10, `manifestul generat: ${MAN.split('\n').filter(Boolean).length} linii`)
  await pereche('aprobat + migrarea + manifestul generat => trece', { aprobat: G0, manifest: MAN, migrare: MIG }, 'ok')
  const linii = MAN.split('\n').filter(Boolean)
  await pereche('manifest cu un rand lipsa => refuz NEDECLARAT', { aprobat: G0, manifest: linii.slice(1).join('\n') + '\n', migrare: MIG }, 'NEDECLARAT')
  await pereche('manifest cu alta amprenta => refuz ALTFEL', { aprobat: G0, manifest: [linii[0].replace(/[0-9a-f]{32}$/, 'f'.repeat(32)), ...linii.slice(1)].join('\n') + '\n', migrare: MIG }, 'ALTFEL')
  // injectii in set (randuri ale „sesiunii” = UNION ALL cu catalogul): validarea trebuie sa refuze IDENTIC
  const INV = [
    ['familie NULL', "(NULL, 'x', md5('x'), 'x')"], ['eticheta NULL', "('sesiune', NULL, md5('x'), 'x')"],
    ['amprenta NULL', "('sesiune', 'x', NULL, 'x')"], ['familie cu majuscula', "('Sesiune', 'x', md5('x'), 'x')"],
    ['familie goala', "('', 'x', md5('x'), 'x')"], ['familie cu LF la final', "('sesiune' || chr(10), 'x', md5('x'), 'x')"],
    ['amprenta de 31 hex', "('sesiune', 'x', left(md5('x'), 31), 'x')"], ['amprenta cu majuscule', "('sesiune', 'x', upper(md5('x')), 'x')"],
    ['amprenta cu LF la final', "('sesiune', 'x', md5('x') || chr(10), 'x')"], ['familie cu cifra', "('sesiune2', 'x', md5('x'), 'x')"],
  ]
  for (const [nume, rand] of INV) {
    await pereche(`rand invalid injectat inainte (${nume})`, { aprobat: G0, manifest: '', injInainte: `INSERT INTO pg_temp.ag_ses_$T VALUES ${rand};` }, 'AMPRENTA_GLOBALA_INVALIDA (inainte)')
  }
  const DUB = [
    ['o eticheta dubla (cu un rand al catalogului)', `('relatie', 'relatie ${S}.sites', md5('x'), 'x')`, 'AMPRENTA_GLOBALA_DUBLURA (inainte)'],
    ['doua etichete duble', `('relatie', 'relatie ${S}.sites', md5('x'), 'x'), ('tip', 'tip ${S}.stare', md5('y'), 'y'), ('tip', 'tip ${S}.stare', md5('z'), 'z')`, 'AMPRENTA_GLOBALA_DUBLURA (inainte)'],
    ['dubla in familia sesiune', "('sesiune', 'sesiune DateStyle', md5('x'), 'x')", 'AMPRENTA_GLOBALA_DUBLURA (inainte)'],
    ['eticheta egala dar alta familie (NU e dubla)', `('functie', 'relatie ${S}.sites', md5('x'), 'x')`, 'AMPRENTA_GLOBALA_INAINTE'],
  ]
  for (const [nume, rand, motiv] of DUB) await pereche(nume, { aprobat: G0, manifest: '', injInainte: `INSERT INTO pg_temp.ag_ses_$T VALUES ${rand};` }, motiv)
  await pereche('invalid SI dublu: refuzul randului invalid vine intai', { aprobat: G0, manifest: '',
    injInainte: `INSERT INTO pg_temp.ag_ses_$T VALUES ('relatie', 'relatie ${S}.sites', md5('x'), 'x'), ('sesiune', 'x', 'nu-e-md5', 'x');` }, 'AMPRENTA_GLOBALA_INVALIDA (inainte)')
  // review r1 (Jakarinos): randuri invalide MULTE + memorie mica + fara fisiere temporare: refuzul randului invalid vine
  // inaintea oricarei sortari (care aici ar esua cu 53400) - acelasi mesaj ca forma veche
  // Validatorul IZOLAT (ca in review): corpul validarilor extras din pasul generat (intre crearea setului si comparatia cu
  // valoarea aprobata), vechi si nou, rulat pe acelasi tabel ag_ina_<T> pregatit de test.
  const validator = (forma, T) => {
    const s = GEN[forma]('inainte', T, '0'.repeat(32))
    const a = s.indexOf(`FROM pg_temp.ag_cat_${T}() c;\n`), b = s.indexOf("  IF v_g IS DISTINCT FROM '")
    if (a < 0 || b < a) throw new Error('validatorul nu s-a gasit in pasul ' + forma)
    return `DO $v$ DECLARE v_g text; v_n bigint; v_f text; BEGIN\n${s.slice(s.indexOf('\n', a) + 1, b)}END $v$;`
  }
  for (const [nume, randuri] of [
    ['2000 de randuri invalide (familie NULL, eticheta de 1000 de caractere)', "SELECT NULL::text, lpad(i::text, 1000, 'x'), md5('x'), 'x' FROM generate_series(1, 2000) i"],
    ['2000 de randuri valide cu o dubla la capat', "SELECT 'relatie', lpad(i::text, 1000, 'x'), md5('x'), 'x' FROM generate_series(1, 2000) i UNION ALL SELECT 'relatie', lpad('7', 1000, 'x'), md5('y'), 'y'"],
    // review r2: putine grupuri (aceeasi eticheta de 2000 de ori) - forma veche refuza cu DUBLURA; o sortare comuna ar fi picat cu 53400
    ['2000 de randuri cu ACEEASI eticheta (contraexemplul review r2)', "SELECT 'relatie', 'x', md5(i::text), 'x' FROM generate_series(1, 2000) i"],
    ['2000 de randuri cu doua etichete de 1000 de caractere (review r2)', "SELECT 'relatie', lpad((i % 2)::text, 1000, 'x'), md5(i::text), 'x' FROM generate_series(1, 2000) i"]]) {
    const T = randomBytes(8).toString('hex'), r = {}
    for (const forma of ['vechi', 'nou']) {
      await db.exec('BEGIN')
      try {
        await db.exec(`CREATE TEMP TABLE ag_ina_${T} (familie text, eticheta text, amprenta text, detaliu text); INSERT INTO pg_temp.ag_ina_${T} ${randuri};`)
        await db.exec("SET LOCAL work_mem = '64kB'; SET LOCAL temp_file_limit = 0;")
        await db.exec(validator(forma, T)); r[forma] = 'fara refuz'
      } catch (e) { r[forma] = `${e.code} ${e.message}` } finally { await db.exec('ROLLBACK') }
    }
    const asteptat = nume.includes('invalide') ? 'AMPRENTA_GLOBALA_INVALIDA' : nume.includes('review r2') ? 'AMPRENTA_GLOBALA_DUBLURA' : '53400'
    ok(r.vechi === r.nou && r.vechi.includes(asteptat), `validatorul izolat, work_mem 64kB, temp_file_limit 0 (review r1), ${nume}: vechi [${r.vechi.slice(0, 90)}] | nou ${r.vechi === r.nou ? 'IDENTIC' : '[' + r.nou.slice(0, 90) + ']'}`)
  }
  // in pasul „dupa”: injectia vine din „migrare” (dupa fotografia de dinainte, care ramane intacta)
  await pereche('rand invalid aparut dupa (pasul „dupa”)', { aprobat: G0, manifest: '', migrare: "INSERT INTO pg_temp.ag_ses_$T VALUES ('sesiune', 'y', 'nu-e-md5', 'y')" }, 'AMPRENTA_GLOBALA_INVALIDA (dupa)')
  await pereche('eticheta dubla aparuta dupa (pasul „dupa”)', { aprobat: G0, manifest: '', migrare: `INSERT INTO pg_temp.ag_ses_$T VALUES ('relatie', 'relatie ${S}.sites', md5('x'), 'x')` }, 'AMPRENTA_GLOBALA_DUBLURA (dupa)')
  await pereche('fotografia de dinainte modificata in tranzactie (integritatea „dupa”)', { aprobat: G0, manifest: '', migrare: "DELETE FROM pg_temp.ag_ina_$T WHERE familie = 'tip'" }, 'AMPRENTA_GLOBALA_DUPA: fotografia de dinainte')

  console.log('5. planul: legatura cu ag_acl prin hash')
  {
    await db.exec('BEGIN'); await db.exec(GUC)
    const plan = (await db.query(`EXPLAIN (FORMAT JSON) ${CAT.nou}`)).rows[0]['QUERY PLAN']
    const noduri = []
    const umbla = (n) => { noduri.push(n); (n.Plans || []).forEach(umbla) }
    umbla((typeof plan === 'string' ? JSON.parse(plan) : plan)[0].Plan)
    // (EXPLAIN redenumeste aliasurile repetate intre ramuri: ka_1, ar_2 ...)
    const peAcl = noduri.filter(n => /\b(ka|ar)(_\d+)?\.acl\b/.test(JSON.stringify({ c: n['Hash Cond'], j: n['Join Filter'], m: n['Merge Cond'] })))
    ok(peAcl.length >= 4 && peAcl.every(n => n['Node Type'] === 'Hash Join'), `legaturile pe cheia ACL: [${peAcl.map(n => n['Node Type'])}] (asteptat Hash Join)`)
    await db.exec('ROLLBACK')
  }
  await db.close()

  console.log('6. timpul (ORIENTATIV: PGlite, nu productia) pe un catalog sintetic, 5 rulari alternate')
  {
    const mare = new PGlite()
    await mare.exec(ROLURI_API + FIXTURE)
    let s = ''
    for (let i = 0; i < 300; i++) {
      s += `CREATE TABLE public.t${i} (id bigint PRIMARY KEY, a text, b int, c numeric, d timestamptz DEFAULT now(), e boolean DEFAULT false, f jsonb, g uuid);
CREATE INDEX t${i}_b ON public.t${i} (b); ALTER TABLE public.t${i} ENABLE ROW LEVEL SECURITY;
CREATE POLICY p${i} ON public.t${i} FOR SELECT TO authenticated USING (id > 0); GRANT SELECT ON public.t${i} TO authenticated;\n`
      if (i % 4 === 0) s += `GRANT INSERT ON public.t${i} TO service_role; GRANT UPDATE (a) ON public.t${i} TO anon;\n`
      if (i % 6 === 0) s += `CREATE VIEW public.v${i} WITH (security_invoker = on) AS SELECT id, a, b FROM public.t${i} WHERE b > 0;\n`
    }
    for (let i = 0; i < 1500; i++) {
      s += `CREATE FUNCTION public.fn${i}(p bigint) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT p > ${i} $f$;\n`
      if (i % 3 === 0) s += `REVOKE ALL ON FUNCTION public.fn${i}(bigint) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.fn${i}(bigint) TO authenticated;\n`
    }
    for (let i = 0; i < 40; i++) s += `CREATE TYPE public.en${i} AS ENUM ('a', 'b', 'c');\n`
    await mare.exec(s)
    await mare.exec('BEGIN'); await mare.exec(GUC)
    const rp = (await mare.query(sqlCaz('catalogul sintetic', 'egal', sqlParitate(CAT.vechi, CAT.nou)))).rows[0]
    await mare.exec('ROLLBACK')
    ok(rp.verdict === 'OK', `paritatea si pe catalogul sintetic: ${rp.detalii}`)
    const blocMs = async (cat) => {
      await mare.exec('BEGIN'); await mare.exec(GUC)
      const t0 = performance.now()
      await mare.query(`SELECT count(*), md5(string_agg(x.amprenta, '' ORDER BY x.familie COLLATE "C", x.eticheta COLLATE "C")) FROM (${cat}) x`)
      const t = performance.now() - t0
      await mare.exec('ROLLBACK'); return t
    }
    const pasiMs = async (forma) => {
      const t0 = performance.now(); const r = await livrare(mare, forma, { aprobat: '-', manifest: null }); const t = performance.now() - t0
      if (!r.ok) throw new Error('pasii ' + forma + ': ' + r.err); return t
    }
    await blocMs(CAT.vechi); await blocMs(CAT.nou); await pasiMs('vechi'); await pasiMs('nou')   // incalzire
    const T = { bv: [], bn: [], pv: [], pn: [] }
    for (let i = 0; i < 5; i++) {
      T.bv.push(await blocMs(CAT.vechi)); T.bn.push(await blocMs(CAT.nou))
      T.pv.push(await pasiMs('vechi')); T.pn.push(await pasiMs('nou'))
    }
    const med = (a) => [...a].sort((x, y) => x - y)[2]
    const f = (a) => a.map(x => Math.round(x)).join(' ')
    console.log(`     blocul: vechi ${f(T.bv)} ms (mediana ${Math.round(med(T.bv))}), nou ${f(T.bn)} ms (mediana ${Math.round(med(T.bn))}), ${Math.round(100 * (med(T.bn) / med(T.bv) - 1))}%`)
    console.log(`     pasii inainte + dupa: vechi ${f(T.pv)} ms (mediana ${Math.round(med(T.pv))}), nou ${f(T.pn)} ms (mediana ${Math.round(med(T.pn))}), ${Math.round(100 * (med(T.pn) / med(T.pv) - 1))}%`)
    ok(med(T.bn) < med(T.bv), 'blocul nou nu e mai lent decat cel vechi (orientativ, PGlite)')
    await mare.close()
  }

  rmSync(TMP, { recursive: true, force: true })
  if (esecuri) { console.log(`ESEC test_amprenta_paritate_calcul: ${esecuri} verificari picate`); process.exit(1) }
  console.log('PASS test_amprenta_paritate_calcul')
}
async function db0() { const d = new PGlite(); const ver = (await d.query('SHOW server_version_num')).rows[0].server_version_num; await d.close(); return { ver } }
main().catch((e) => { console.error(e); process.exit(1) })
