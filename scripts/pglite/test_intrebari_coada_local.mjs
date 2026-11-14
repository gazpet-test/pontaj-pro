// Proba LOCALĂ a acțiunii „coada” (edge intrebari-tehnice-worker, 14.11.2026; r3 15.11.2026) pe PGlite (Postgres în WASM, în
// memorie) — NU atinge nicio bază reală. Paritate L19 pe ACELAȘI tabel de cazuri ca vitest (scripts/intrebari/coada_cazuri.mjs):
//   pentru fiecare caz, într-o tranzacție: rândurile cazului → coadaDePreluat (logic.js; condiția `oricare` tradusă 1:1 în UN
//   SINGUR SELECT count(*) cu OR, ca cererea PostgREST; ceasul JS mutat cu `ceas` secunde pe durata apelului — r3: fără efect)
//   → fn_intrebari_preia COPIATĂ din migrarea 20261131e (are de lucru = întoarce o întrebare SAU închide una expirată) → ROLLBACK.
//   Cerință: „coada” = `asteptat` și `preia` = `preia` (ambele scrise de mână) și NICIODATĂ „goală” când `preia` are de lucru.
//   Plus mutanți (fără „noua” / fără „in_lucru” / pragul de vechime pus la loc / toate stările / plafonul de dinainte de r2):
//   fiecare trebuie prins de măcar un caz.
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
const OP = { eq: '=' }
let esec = 0
const ok = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) esec++ }

const db = new PGlite()
console.log('server:', (await db.query('SHOW server_version')).rows[0].server_version)
await db.exec(SCHEMA)
await db.exec(PREIA)

// `oricare` (OR de condiții) tradus 1:1 într-UN SINGUR SELECT (nume de coloană pe lista albă, valorile ca parametri) — ca cererea
// PostgREST `or=(...)`: un singur statement = un singur instantaneu.
const numaraSql = async ({ tabel, oricare }) => {
  if (tabel !== 'intrebari_tehnice') throw new Error('tabel')
  const p = []
  const where = oricare.map(([op, col, v]) => {
    if (!OP[op] || !/^[a-z_]+$/.test(col)) throw new Error('filtru')
    p.push(v)
    return `${col} ${OP[op]} $${p.length}`
  }).join(' OR ')
  const r = await db.query(`SELECT count(*)::int AS n FROM public.intrebari_tehnice WHERE ${where}`, p)
  return { count: r.rows[0].n, error: null }
}

// Ceasul JS mutat cu `sec` secunde DOAR pe durata apelului „coada” (ceasul „edge-ului”); ceasul BD rămâne al PGlite.
async function cuCeasMutat(sec, f) {
  if (!sec) return f()
  const Real = Date
  const Mutat = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + sec * 1e3) }
    static now() { return Real.now() + sec * 1e3 }
  }
  globalThis.Date = Mutat
  try { return await f() } finally { globalThis.Date = Real }
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
    const coada = await cuCeasMutat(caz.ceas ?? 0, () => coadaDePreluat(numara))
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

// 2) mutanții: fiecare trebuie să strice măcar un caz (altfel cazurile nu-l acoperă)
const fara = stare => cerere => numaraSql({ ...cerere, oricare: cerere.oricare.filter(c => c[2] !== stare) })
const sql = text => async () => ({ count: (await db.query(text)).rows[0].n, error: null })
const mutanti = {
  'fără „noua”': fara('noua'),
  'fără „in_lucru”': fara('in_lucru'),
  'pragul de vechime pus la loc (forma r2: „in_lucru” doar peste 29 de minute)': sql(`SELECT count(*)::int AS n FROM public.intrebari_tehnice
     WHERE stare = 'noua' OR (stare = 'in_lucru' AND preluat_la < now() - interval '29 minutes')`),
  'toate stările (fără filtru)': sql(`SELECT count(*)::int - 1 AS n FROM public.intrebari_tehnice`),   // − ținta jurnalului
  'plafonul de dinainte de r2 pus la loc (40 / zi locală, fără amânări)': async cerere => {
    const pl = (await db.query(`SELECT count(*)::int AS n FROM public.intrebari_preluari
       WHERE preluat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')
         AND rezultat IS DISTINCT FROM 'amanat'`)).rows[0].n
    const exp = (await db.query(`SELECT count(*)::int AS n FROM public.intrebari_tehnice
       WHERE stare = 'in_lucru' AND preluat_la < now() - interval '30 minutes'`)).rows[0].n
    return pl >= 40 && exp === 0 ? { count: 0, error: null } : numaraSql(cerere)
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
