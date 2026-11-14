// Proba LOCALĂ a acțiunii „coada” (edge intrebari-tehnice-worker, 14.11.2026; r2 15.11.2026) pe PGlite (Postgres în WASM, în
// memorie) — NU atinge nicio bază reală. Paritate L19 pe ACELAȘI tabel de cazuri ca vitest (scripts/intrebari/coada_cazuri.mjs):
//   pentru fiecare caz, într-o tranzacție: rândurile cazului → coadaDePreluat (logic.js; condiția `oricare` tradusă 1:1 în UN
//   SINGUR SELECT count(*) cu OR, ca cererea PostgREST) cu ceasul edge-ului = now() din BD + `ceas` → fn_intrebari_preia COPIATĂ
//   din migrarea 20261131e (are de lucru = întoarce o întrebare SAU închide una expirată) → ROLLBACK.
//   Cerință: „coada” = `asteptat` și `preia` = `preia` (ambele scrise de mână) și NICIODATĂ „goală” când `preia` are de lucru.
//   Cazul peste marjă (ceasul edge-ului în urmă > 60 s): „goală” acum, „are ceva” la rularea următoare (+2 minute).
//   Plus mutanți (fără „noua” / fără expirate / fără marjă / AND→OR în grupul expiratelor / plafonul de dinainte de r2 pus la loc):
//   fiecare trebuie prins de măcar un caz.
// Schema de aici e minimă (doar coloanele citite / scrise de fn_intrebari_preia), nu înlocuiește dry-run-ul pe clonă.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_intrebari_coada_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { coadaDePreluat } from '../../supabase/functions/intrebari-tehnice-worker/logic.js'
import { CAZURI_COADA, CAZ_PESTE_MARJA } from '../intrebari/coada_cazuri.mjs'

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
  raspuns_la timestamptz, surse jsonb NOT NULL DEFAULT '[]', de_verificat_la timestamptz, interogari_web jsonb NOT NULL DEFAULT '[]',
  CHECK (stare IN ('noua', 'in_lucru', 'raspuns', 'eroare', 'de_verificat')));
CREATE TABLE public.intrebari_preluari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, intrebare_id bigint NOT NULL REFERENCES public.intrebari_tehnice(id),
  incercare_id uuid UNIQUE, preluat_la timestamptz NOT NULL DEFAULT now(), inchis_la timestamptz,
  rezultat text CHECK (rezultat IS NULL OR rezultat IN ('raspuns', 'eroare', 'amanat', 'expirat')), tokeni jsonb,
  interogari_web jsonb NOT NULL DEFAULT '[]', din_istoric boolean NOT NULL DEFAULT false);
CREATE TABLE public.notifications (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid, type text, modul text,
  title text, message text, link_to text);
`
const OP = { eq: '=', lt: '<' }
let esec = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) esec++ }

const db = new PGlite()
console.log('server:', (await db.query('SHOW server_version')).rows[0].server_version)
await db.exec(SCHEMA)
await db.exec(PREIA)

// `oricare` (OR de grupuri AND) tradus 1:1 într-UN SINGUR SELECT (nume de coloană pe lista albă, valorile ca parametri) — ca
// cererea PostgREST `or=(...)`: un singur statement = un singur instantaneu.
const sqlOricare = oricare => {
  const p = []
  const grupuri = oricare.map(g => '(' + g.map(([op, col, v]) => {
    if (!OP[op] || !/^[a-z_]+$/.test(col)) throw new Error('filtru')
    p.push(v)
    return `${col} ${OP[op]} $${p.length}`
  }).join(' AND ') + ')')
  return { where: grupuri.join(' OR '), p }
}
const numaraSql = async ({ tabel, oricare }) => {
  if (tabel !== 'intrebari_tehnice') throw new Error('tabel')
  const { where, p } = sqlOricare(oricare)
  const r = await db.query(`SELECT count(*)::int AS n FROM public.intrebari_tehnice WHERE ${where}`, p)
  return { count: r.rows[0].n, error: null }
}

async function ruleaza(caz, numara = numaraSql, decalajSec = 0) {
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
    const t = (await db.query('SELECT now() AS t')).rows[0].t
    const acumBd = t instanceof Date ? t : new Date(t)
    const coada = await coadaDePreluat(numara, new Date(acumBd.getTime() + ((caz.ceas ?? 0) + decalajSec) * 1e3))
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
  ok(preia === caz.preia, `preia = ${caz.preia}: ${caz.nume}`)
  ok(!(coada === false && preia === true), `niciodată „goală” când preia are de lucru: ${caz.nume}`)
}

// 2) peste marjă: întârziere de o rulare, nu pierdere. Rularea următoare = rândurile „îmbătrânesc” 2 minute (ceasul BD e fix în
//    tranzacție, deci decalăm ceasul edge-ului cu +2 min; `preia` ar vedea și ea rândul expirat, deja expirat acum).
{
  const c = CAZ_PESTE_MARJA
  const acum = await ruleaza(c)
  ok(acum.coada === c.asteptat && acum.preia === c.preia, `${c.nume} — acum: coada ${acum.coada}, preia ${acum.preia}`)
  const urm = await ruleaza(c, numaraSql, c.rulareUrmatoareSec)
  ok(urm.coada === c.asteptatUrmator, `${c.nume} — rularea următoare: coada ${urm.coada}`)
}

// 3) mutanții: fiecare trebuie să strice măcar un caz (altfel cazurile nu-l acoperă)
const fara = pred => cerere => numaraSql({ ...cerere, oricare: cerere.oricare.filter(g => !pred(g)) })
const mutanti = {
  'fără „noua”': fara(g => g.some(x => x[2] === 'noua')),
  'fără expirate': fara(g => g.some(x => x[0] === 'lt')),
  'fără marjă (pragul exact 30 min pe ceasul edge-ului)': cerere => numaraSql({ ...cerere, oricare: cerere.oricare.map(g =>
    g.map(x => (x[0] === 'lt' ? [x[0], x[1], new Date(Date.parse(x[2]) - 60e3).toISOString()] : x))) }),
  'AND → OR în grupul expiratelor': cerere => numaraSql({ ...cerere, oricare: cerere.oricare.flatMap(g => g.map(x => [x])) }),
  'plafonul de dinainte de r2 pus la loc (40 / zi locală, fără amânări)': async cerere => {
    const pl = (await db.query(`SELECT count(*)::int AS n FROM public.intrebari_preluari
       WHERE preluat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')
         AND rezultat IS DISTINCT FROM 'amanat'`)).rows[0].n
    const exp = await numaraSql({ ...cerere, oricare: cerere.oricare.filter(g => g.some(x => x[0] === 'lt')) })
    return pl >= 40 && exp.count === 0 ? { count: 0, error: null } : numaraSql(cerere)
  },
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
