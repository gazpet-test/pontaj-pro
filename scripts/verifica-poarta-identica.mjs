#!/usr/bin/env node
// Poarta pe cheltuială (poarta.ts) există în DOUĂ copii — deploy-ul pe folder nu garantează ../_shared.
// Copiile trebuie să fie identice octet cu octet; altfel o funcție ar putea lăsa să treacă pe cine cealaltă oprește.
// Rulare: node scripts/verifica-poarta-identica.mjs  (cod 1 dacă diferă sau lipsește vreuna)
import { readFileSync } from 'node:fs'

const COPII = [
  'supabase/functions/ofertare-plansa-citeste/poarta.ts',
  'supabase/functions/ofertare-cantitati-extrage/poarta.ts',
]
let ref = null
for (const p of COPII) {
  let t
  try { t = readFileSync(p, 'utf8') } catch { console.error(`❌ lipsește ${p}`); process.exit(1) }
  if (ref === null) { ref = t; continue }
  if (t !== ref) {
    console.error(`❌ ${p} diferă de ${COPII[0]} — ține copiile poarta.ts identice.`)
    process.exit(1)
  }
}
console.log(`✅ poarta.ts identică în ${COPII.length} copii`)
