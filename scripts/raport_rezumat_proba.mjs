// Proba rezumatului raportului zilnic: citește ieșirea lui scripts/raport_rezumat_proba.sql (JSON) și scrie rezumatele cu regula din
// src/raportRezumat.js — DOAR local, fără rețea, fără bază de date. Ieșirea (text) rămâne la coordonator: poate conține nume din textele libere.
// Rulare: node scripts/raport_rezumat_proba.mjs <intrari_rezumat.json>
import { readFileSync } from 'node:fs'
import { rezumatRaport } from '../src/raportRezumat.js'

const f = process.argv[2]
if (!f) { console.error('folosire: node scripts/raport_rezumat_proba.mjs <intrari_rezumat.json>'); process.exit(2) }
// psql -A -t poate lăsa un rând gol la final; BOM-ul (dacă fișierul a trecut printr-un editor) se scoate
const BOM = String.fromCharCode(0xFEFF)
let text = readFileSync(f, 'utf8').trim()
if (text.startsWith(BOM)) text = text.slice(1).trim()
let lista
try { lista = JSON.parse(text) } catch (e) { console.error('JSON invalid: ' + e.message); process.exit(1) }
if (!Array.isArray(lista)) { console.error('aștept o listă de rapoarte'); process.exit(1) }
for (const r of lista) {
  console.log(`── raport #${r.id} · șantier ${r.site_id} · ${r.data}`)
  console.log(rezumatRaport(r.intrare))
  console.log('')
}
console.error(`${lista.length} rezumate`)
