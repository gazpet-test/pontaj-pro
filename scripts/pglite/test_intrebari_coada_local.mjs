// Proba LOCALĂ a acțiunii „coada” (edge intrebari-tehnice-worker, 14.11.2026) pe PGlite (Postgres în WASM, în memorie) — NU atinge
// nicio bază reală. Paritate L19 pe ACELAȘI tabel de cazuri ca vitest (scripts/intrebari/coada_cazuri.mjs):
//   pentru fiecare caz, într-o tranzacție: rândurile cazului → coadaDePreluat (logic.js, filtrele traduse 1:1 în SQL: eq '=',
//   lt '<', gte '>=') cu „acum” = now() din BD → fn_intrebari_preia COPIATĂ din migrarea 20261131e (are de lucru = întoarce o
//   întrebare SAU închide una expirată) → ROLLBACK.
//   Cerință: „coada” = `asteptat` (scris de mână) și NICIODATĂ „goală” când `preia` are de lucru; singura abatere permisă e
//   marja de 60 s (`marja: true`: „coada” spune „are ceva”, `preia` încă nu face nimic).
//   Plus mutanți (logica fără expirate / fără scăderea amânatelor / ziua mutată cu o oră / fără „noua”): fiecare trebuie prins.
// Schema de aici e minimă (doar coloanele citite / scrise de fn_intrebari_preia), nu înlocuiește dry-run-ul pe clonă.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_intrebari_coada_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { coadaDePreluat } from '../../supabase/functions/intrebari-tehnice-worker/logic.js'
import { CAZURI_COADA } from '../intrebari/coada_cazuri.mjs'

const R = new URL('../../', import.meta.url)
const MIG = readFileSync(new URL('supabase/migrations/20261131e_intrebari_cercetare_surse.sql', R), 'utf8').replace(/\r\n/g, '\n')
const i0 = MIG.indexOf('CREATE OR REPLACE FUNCTION public.fn_intrebari_preia()'), i1 = MIG.indexOf('-- Amânare CERTĂ')
if (i0 < 0 || i1 < i0) throw new Error('fn_intrebari_preia nu e în migrare')
const PREIA = MIG.slice(i0, i1)

const SCHEMA = `
CREATE TABLE public.intrebari_tehnice (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, autor uuid, titlu text NOT NULL DEFAULT 'titlu', intrebare text NOT NULL DEFAULT 'intrebare',
  context text, atasamente jsonb NOT NULL DEFAULT '[]', stare text NOT NULL, raspuns_md text, model text, tokeni jsonb, eroare text,
  incercari smallint NOT NULL DEFAULT 0, incercare_id uuid, creat_la timestamptz NOT NULL DEFAULT now(), preluat_la timestamptz,
  raspuns_la timestamptz, surse jsonb NOT NULL DEFAULT '[]', de_verificat_la timestamptz, interogari_web jsonb NOT NULL DEFAULT '[]');
CREATE TABLE public.intrebari_preluari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, intrebare_id bigint NOT NULL REFERENCES public.intrebari_tehnice(id),
  incercare_id uuid UNIQUE, preluat_la timestamptz NOT NULL DEFAULT now(), inchis_la timestamptz,
  rezultat text CHECK (rezultat IS NULL OR rezultat IN ('raspuns', 'eroare', 'amanat', 'expirat')), tokeni jsonb,
  interogari_web jsonb NOT NULL DEFAULT '[]', din_istoric boolean NOT NULL DEFAULT false);
CREATE TABLE public.notifications (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid, type text, modul text,
  title text, message text, link_to text);
`
const OP = { eq: '=', lt: '<', gte: '>=' }
let esec = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) esec++ }

const db = new PGlite()
console.log('server:', (await db.query('SHOW server_version')).rows[0].server_version)
await db.exec(SCHEMA)
await db.exec(PREIA)

// filtrele din logic.js, traduse 1:1 (nume de tabel / coloană pe lista albă, valorile ca parametri)
const numaraSql = async (tabel, filtre) => {
  if (!/^intrebari_(tehnice|preluari)$/.test(tabel)) throw new Error('tabel')
  const w = filtre.map(([op, col], i) => {
    if (!OP[op] || !/^[a-z_]+$/.test(col)) throw new Error('filtru')
    return `${col} ${OP[op]} $${i + 1}`
  })
  const r = await db.query(`SELECT count(*)::int AS n FROM public.${tabel}${w.length ? ' WHERE ' + w.join(' AND ') : ''}`, filtre.map(f => f[2]))
  return { count: r.rows[0].n, error: null }
}

async function ruleaza(caz, numara = numaraSql) {
  await db.exec('BEGIN')
  try {
    const f = (await db.query(`INSERT INTO public.intrebari_tehnice (stare) VALUES ('raspuns') RETURNING id`)).rows[0].id   // ținta jurnalului
    for (const q of caz.intrebari) {
      await db.query(`INSERT INTO public.intrebari_tehnice (stare, preluat_la)
                      VALUES ($1, CASE WHEN $2::float8 IS NULL THEN NULL ELSE now() - make_interval(secs => $2::float8 * 60) END)`,
                     [q.stare, q.min ?? null])
    }
    for (const p of caz.preluari) {
      await db.query(`INSERT INTO public.intrebari_preluari (intrebare_id, rezultat, preluat_la)
                      VALUES ($1, $2, (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')
                                      + make_interval(mins => $3::int))`, [f, p.rezultat, p.zi])
    }
    const acum = (await db.query('SELECT now() AS t')).rows[0].t
    const coada = await coadaDePreluat(numara, acum instanceof Date ? acum : new Date(acum))
    const pr = (await db.query('SELECT public.fn_intrebari_preia() AS r')).rows[0].r
    const inchise = (await db.query(`SELECT count(*)::int AS n FROM public.intrebari_tehnice WHERE eroare LIKE 'Procesarea a fost întreruptă%'`)).rows[0].n
    return { coada, preia: pr !== null || inchise > 0 }
  } finally {
    await db.exec('ROLLBACK')
  }
}

// 1) paritatea pe cazurile comune
for (const caz of CAZURI_COADA) {
  const { coada, preia } = await ruleaza(caz)
  ok(coada === caz.asteptat, `coada = ${caz.asteptat}: ${caz.nume}`)
  ok(caz.marja ? (coada === true && preia === false) : preia === caz.asteptat, `preia ${caz.marja ? 'încă nimic (marja)' : '= ' + caz.asteptat}: ${caz.nume}`)
  ok(!(coada === false && preia === true), `niciodată „goală” când preia are de lucru: ${caz.nume}`)
}

// 2) mutanții: fiecare trebuie să strice măcar un caz (altfel cazurile nu-l acoperă)
const mutanti = {
  'fără expirate': (t, f) => (f.some(x => x[0] === 'lt') ? { count: 0, error: null } : numaraSql(t, f)),
  'fără scăderea amânatelor': (t, f) => (f.some(x => x[2] === 'amanat') ? { count: 0, error: null } : numaraSql(t, f)),
  'ziua cu o oră mai devreme': (t, f) => numaraSql(t, f.map(x => (x[0] === 'gte' ? [x[0], x[1], new Date(Date.parse(x[2]) - 3600e3).toISOString()] : x))),
  'fără „noua”': (t, f) => (f.some(x => x[2] === 'noua') ? { count: 0, error: null } : numaraSql(t, f)),
}
for (const [nume, m] of Object.entries(mutanti)) {
  let prins = false
  for (const caz of CAZURI_COADA) {
    const { coada } = await ruleaza(caz, m)
    if (coada !== caz.asteptat) { prins = true; break }
  }
  ok(prins, `mutantul „${nume}” e prins de cazuri`)
}

console.log(esec ? `\n${esec} EȘECURI` : '\nTOATE OK')
process.exit(esec ? 1 : 0)
