// Runda 18 a runnerului (22.11.2026, plafonul EXTINS; docs/LIVRARE_L15_V2.md §9): verificarea FERESTREI PE SERVER (fisierul 1a_fereastra.sql,
// generat de scripts/livrare_amprenta.sh: ag_fereastra_sql) pe PGlite (Postgres in WASM, in memorie) — NU atinge nicio baza reala.
// Textul SQL vine EXCLUSIV din biblioteca livrata (L19); testul doar il ruleaza. Expected scris aici, de mana (L25):
//   1. textul real (transaction_timestamp()) ruleaza pe PGlite (fusul Europe/Bucharest e cunoscut serverului) si da verdictul orei REALE:
//      NOTICE PLAFON_EXTINS … in fereastra, sau exceptia PLAFON_EXTINS_FEREASTRA; ora tiparita de server = ora calculata de biblioteca (regula UE)
//      pentru acelasi moment (transaction_timestamp = momentul BEGIN, luat din server);
//   2. momente FIXE: transaction_timestamp() inlocuit EXACT o data cu un literal timestamptz => in fereastra: 21:30 EEST (vara), 21:00:00 si 05:59:59
//      (granite), 02:59:59 / 04:00:00 in jurul trecerii la ora de vara (29.03.2026 01:00 UTC), 03:59:59 / 03:00:00 la trecerea la ora de iarna
//      (25.10.2026); in afara ferestrei: 14:00 (22.11.2026 12:00 UTC), 06:00:00, 20:59:59 — exceptie cu ora in mesaj; pentru fiecare moment ora
//      serverului (AT TIME ZONE, tzdata PostgreSQL) = ora bibliotecii (regula UE in bash) — doua implementari independente ale aceleiasi reguli;
//   3. nimic nu ramane dupa pas (niciun obiect, nicio setare de sesiune), iar exceptia anuleaza tranzactia (nimic comis dupa ea);
//   4. MUTANTI pe text (fiecare inlocuire exact o data): OR -> AND (21:30 refuzat), >= -> > (21:00:00 refuzat), < -> <= (06:00:00 acceptat),
//      fusul UTC in loc de Europe/Bucharest (21:30 EEST devine 18:30, refuzat), granita de inceput 20:00:00 (20:59:59 acceptat) — toti prinsi.
// Rulare: node scripts/pglite/test_plafon_extins_local.mjs   (cere bash in PATH si @electric-sql/pglite in node_modules)
import { PGlite } from '@electric-sql/pglite'
import { execFileSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
let esecuri = 0
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { esecuri++; console.log('  ESEC ' + m) } }
const LIB = join(ROOT, 'scripts/livrare_amprenta.sh')
const bash = (cmd, ...a) => execFileSync('bash', ['-c', `. "$1"; shift; ${cmd} "$@"`, '_', LIB, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const NUME = '20990101a_plafon_extins'
const SQL = bash('ag_fereastra_sql', NUME)
const PLX = bash('printf %s "$AG_PLAFON_EXTINS_MS"')
ok(PLX === '15000', `AG_PLAFON_EXTINS_MS = ${PLX} (asteptat 15000)`)
ok(SQL.includes('DO $plafon_fereastra$') && SQL.includes(`Livrare ${NUME}: PLAFON_EXTINS_FEREASTRA`), 'textul serverului generat de biblioteca')
const oraBash = (epoch) => bash('ag_ora_bucuresti', String(epoch)).trim()

// ruleaza pasul intr-o tranzactie: {ora, in} din NOTICE / exceptie; dupa pas, incearca o scriere si ROLLBACK (nimic comis)
async function pas(db, text) {
  const jurnal = []
  let eroare = null
  await db.exec('BEGIN')
  try { await db.exec(text, { onNotice: n => jurnal.push(n.message) }) } catch (e) { eroare = e.message }
  let scris = null
  try { await db.exec('CREATE TEMP TABLE t_dupa_pas (x int)'); scris = 'ok' } catch (e) { scris = e.message }
  await db.exec('ROLLBACK')
  const n = jurnal.find(m => m.startsWith(`PLAFON_EXTINS ${NUME}: plafon ${PLX} ms; ora serverului in Europe/Bucharest `))
  // ora serverului e tip time (cu fractiuni de secunda la momentul real); se compara HH:MM:SS
  if (eroare) {
    const m = /PLAFON_EXTINS_FEREASTRA: ora serverului in Europe\/Bucharest \((\d\d:\d\d:\d\d)(?:\.\d+)?\) e in afara ferestrei 21:00:00-06:00:00/.exec(eroare)
    return { in: false, ora: m ? m[1] : null, eroare, scris }
  }
  const m = n ? /Europe\/Bucharest (\d\d:\d\d:\d\d)(?:\.\d+)? in fereastra 21:00:00-06:00:00$/.exec(n) : null
  return { in: true, ora: m ? m[1] : null, notice: n, scris }
}

const db = new PGlite()
// 1. textul real, pe ora reala a serverului (momentul BEGIN, citit din server in aceeasi tranzactie pentru comparatie)
{
  await db.exec('BEGIN')
  const { rows } = await db.query('SELECT floor(extract(epoch from transaction_timestamp()))::bigint::text AS e')
  let eroare = null; const j = []
  try { await db.exec(SQL, { onNotice: n => j.push(n.message) }) } catch (e) { eroare = e.message }
  await db.exec('ROLLBACK')
  const h = oraBash(rows[0].e)
  const inBash = execFileSync('bash', ['-c', '. "$1"; if ag_fereastra_in "$2"; then echo in; else echo afara; fi', '_', LIB, h], { encoding: 'utf8' }).trim()
  const oraServer = eroare ? (/\((\d\d:\d\d:\d\d)(?:\.\d+)?\) e in afara/.exec(eroare) || [])[1] : (/Bucharest (\d\d:\d\d:\d\d)(?:\.\d+)? in fereastra/.exec(j.join('\n')) || [])[1]
  ok((inBash === 'in') === !eroare, `textul real la ora reala: biblioteca spune „${inBash}” (${h}), serverul ${eroare ? 'REFUZA (PLAFON_EXTINS_FEREASTRA)' : 'accepta (NOTICE PLAFON_EXTINS)'}`)
  ok(oraServer === h, `ora serverului (${oraServer}) = ora bibliotecii (${h}) pentru acelasi moment (tzdata PostgreSQL vs regula UE in bash)`)
  ok(!eroare || /PLAFON_EXTINS_FEREASTRA/.test(eroare), 'refuzul (daca e) poarta eticheta PLAFON_EXTINS_FEREASTRA')
}
// 2. momente fixe: transaction_timestamp() inlocuit exact o data
const FIX = [
  ['2026-07-15 18:30:00+00', '21:30:00', true, 'vara (EEST), in fereastra'],
  ['2026-01-15 19:00:00+00', '21:00:00', true, 'granita de inceput, iarna (EET)'],
  ['2026-01-15 18:59:59+00', '20:59:59', false, 'o secunda inaintea ferestrei'],
  ['2026-01-15 03:59:59+00', '05:59:59', true, 'ultima secunda a ferestrei'],
  ['2026-01-15 04:00:00+00', '06:00:00', false, 'granita de sfarsit (exclusa)'],
  ['2026-11-22 12:00:00+00', '14:00:00', false, 'ziua de lucru (masuratoarea din 22.11)'],
  ['2026-03-29 00:59:59+00', '02:59:59', true, 'ultima secunda inaintea trecerii la ora de vara'],
  ['2026-03-29 01:00:00+00', '04:00:00', true, 'prima secunda a orei de vara (02:59:59 -> 04:00:00)'],
  ['2026-10-25 00:59:59+00', '03:59:59', true, 'ultima secunda a orei de vara'],
  ['2026-10-25 01:00:00+00', '03:00:00', true, 'prima secunda a orei de iarna (03:59:59 -> 03:00:00)'],
  ['2027-03-28 01:00:00+00', '04:00:00', true, 'trecerea la ora de vara 2027'],
  ['2027-10-31 00:59:59+00', '03:59:59', true, 'ultima secunda a orei de vara 2027'],
  ['2025-12-31 22:00:00+00', '00:00:00', true, 'miezul noptii (fereastra trece peste el)'],
]
const DIN = 'pg_catalog.transaction_timestamp()'
ok(SQL.split(DIN).length === 2, 'transaction_timestamp() apare exact o data in text (inlocuirea de test e fara ambiguitate)')
const cuMoment = (text, m) => text.replace(DIN, `'${m}'::pg_catalog.timestamptz`)
for (const [m, ora, inF, et] of FIX) {
  const r = await pas(db, cuMoment(SQL, m))
  const e = Math.floor(Date.parse(m.replace(' ', 'T').replace('+00', 'Z')) / 1000)
  const hb = oraBash(e)
  ok(r.ora === ora && r.in === inF, `${m} => server ${r.ora} ${r.in ? 'in' : 'afara'} (asteptat ${ora} ${inF ? 'in' : 'afara'}): ${et}`)
  ok(hb === ora, `  biblioteca (regula UE, bash) pentru acelasi moment: ${hb}`)
  ok(r.scris === (r.in ? 'ok' : r.scris) && (r.in || /current transaction is aborted/.test(r.scris)), `  ${r.in ? 'pasul nu lasa tranzactia anulata' : 'exceptia anuleaza tranzactia (nimic comis dupa ea)'}`)
}
// 3. nimic ramas: niciun obiect in pg_temp / public, nicio setare schimbata
{
  const inainte = (await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace IN (pg_my_temp_schema(), 'public'::regnamespace)")).rows[0].n
  const tz0 = (await db.query('SHOW TimeZone')).rows[0].TimeZone
  await pas(db, cuMoment(SQL, FIX[0][0]))
  const dupa = (await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace IN (pg_my_temp_schema(), 'public'::regnamespace)")).rows[0].n
  const tz1 = (await db.query('SHOW TimeZone')).rows[0].TimeZone
  ok(inainte === dupa && tz0 === tz1, `nimic ramas dupa pas (obiecte ${inainte} -> ${dupa}, TimeZone ${tz0} -> ${tz1})`)
}
// 4. mutantii textului (fiecare aplicat exact o data): verdictul se schimba pe cazul care il deosebeste
const MUT = [
  ['OR -> AND (ambele conditii cerute)', '::pg_catalog.time OR v_ora OPERATOR', '::pg_catalog.time AND v_ora OPERATOR', '2026-07-15 18:30:00+00', true],
  ['>= -> > (21:00:00 exclus)', "OPERATOR(pg_catalog.>=) '21:00:00'", "OPERATOR(pg_catalog.>) '21:00:00'", '2026-01-15 19:00:00+00', true],
  ['< -> <= (06:00:00 inclus)', "OPERATOR(pg_catalog.<) '06:00:00'", "OPERATOR(pg_catalog.<=) '06:00:00'", '2026-01-15 04:00:00+00', false],
  ['fusul UTC in loc de Europe/Bucharest', "AT TIME ZONE 'Europe/Bucharest'", "AT TIME ZONE 'UTC'", '2026-07-15 18:30:00+00', true],
  ['granita de inceput 20:00:00', "'21:00:00'::pg_catalog.time", "'20:00:00'::pg_catalog.time", '2026-01-15 18:59:59+00', false],
]
for (const [et, din, in_, m, asteptatOriginal] of MUT) {
  if (SQL.split(din).length !== 2) { ok(false, `mutantul „${et}”: textul '${din}' nu apare exact o data`); continue }
  const r0 = await pas(db, cuMoment(SQL, m)), r1 = await pas(db, cuMoment(SQL.replace(din, in_), m))
  ok(r0.in === asteptatOriginal && r1.in !== r0.in, `mutantul „${et}” PRINS la ${m}: original ${r0.in ? 'in' : 'afara'}, mutant ${r1.in ? 'in' : 'afara'}`)
}
await db.close()
if (esecuri) { console.log(`ESEC: ${esecuri} verificari picate`); process.exit(1) }
console.log('TOTUL OK test_plafon_extins_local')
