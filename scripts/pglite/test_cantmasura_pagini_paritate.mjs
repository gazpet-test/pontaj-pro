// Proba de PARITATE (L19) între citirea paginilor din edge (supabase/functions/_shared/cantMasura.ts: numarPagini / paginaText / limitaPagini)
// și funcțiile SQL REALE din 20270112a (fn_ofertare_masura_pagini, fn_ofertare_masura_pagina, fn_ofertare_masura_pagini_permise), pe tabelele
// comune supabase/tests/20270112a_cazuri_pagini.json și 20270112a_cazuri_plafon.json. Partea SQL rulează pe PGlite (fără bază reală); partea
// TypeScript e în cantMasura_test.ts (Deno), pe ACELEAȘI fișiere. Review Jakarinos r3 P2 (TKT-2026-0329 A, PR-extragere).
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_cantmasura_pagini_paritate.mjs
//   sau cu PGlite instalat separat: PGLITE_DIR=<folder cu node_modules/@electric-sql/pglite> node scripts/pglite/test_cantmasura_pagini_paritate.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const rad = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
const modul = process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href : '@electric-sql/pglite'
const { PGlite } = await import(modul)

const MIG = readFileSync(path.join(rad, 'supabase', 'migrations', '20270112a_ofertare_cantitati_masuratori.sql'), 'utf8').replace(/\r\n/g, '\n')
const corp = (nume) => {
  const i = MIG.indexOf('CREATE FUNCTION public.' + nume + '(')
  if (i < 0) throw new Error('functia ' + nume + ' nu e in migrare')
  const j = MIG.indexOf('$f$;', i)
  return MIG.slice(i, j + 4)
}
const citeste = (f) => JSON.parse(readFileSync(path.join(rad, 'supabase', 'tests', f), 'utf8'))
const PAGINI = citeste('20270112a_cazuri_pagini.json'), PLAFON = citeste('20270112a_cazuri_plafon.json')

const db = await PGlite.create()
for (const fn of ['fn_ofertare_masura_pagini', 'fn_ofertare_masura_pagina', 'fn_ofertare_masura_pagini_permise']) await db.exec(corp(fn))

let ok = 0, rau = 0
const verifica = (nume, conditie, detaliu) => { if (conditie) { ok++; console.log('OK   ' + nume) } else { rau++; console.log('FAIL ' + nume + (detaliu ? ': ' + detaliu : '')) } }
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b)

for (const c of PAGINI.cazuri) {
  const n = (await db.query('SELECT public.fn_ofertare_masura_pagini($1) AS n', [c.text])).rows[0].n
  verifica(`pagini: ${c.nume}`, n === c.pagini, `SQL ${n}, tabel ${c.pagini}`)
  for (const [p, asteptat] of Object.entries(c.pagina)) {
    const t = (await db.query('SELECT public.fn_ofertare_masura_pagina($1, $2::int) AS t', [c.text, Number(p)])).rows[0].t
    verifica(`pagina ${p}: ${c.nume}`, egal(t, asteptat), `SQL ${JSON.stringify(t)}, tabel ${JSON.stringify(asteptat)}`)
  }
}
for (const c of PLAFON.cazuri) {
  const docs = c.documente.map((d) => ({ id: d.id, pagini: d.pagini }))
  const r = (await db.query('SELECT public.fn_ofertare_masura_pagini_permise($1::jsonb, $2::int) AS r', [JSON.stringify(docs), c.plafon])).rows[0].r
  verifica(`plafon: ${c.nume}`, egal(r.limita, c.limita) && r.plafon_atins === c.plafon_atins, `SQL ${JSON.stringify(r)}`)
  // felia permisă ⇔ pagina_pana_la ≤ ultima_pagina_permisa a documentului (definiția comună)
  for (const f of c.felii) {
    const u = (r.limita.find((x) => x.document_id === f.document_id) || { ultima_pagina_permisa: 0 }).ultima_pagina_permisa
    verifica(`felie ${f.document_id}:${f.pagina_de_la}-${f.pagina_pana_la}: ${c.nume}`, (f.pagina_pana_la <= u) === f.permisa)
  }
}
await db.close()
console.log(rau ? `${rau} FAIL / ${ok} OK` : `TOTUL OK (${ok} verificari)`)
process.exit(rau ? 1 : 0)
