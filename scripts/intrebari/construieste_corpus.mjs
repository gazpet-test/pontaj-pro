// Construiește indexul corpusului pentru workerul „❓ Întreabă echipa”.
// Rulare (pe serverul AI, din clona la zi pe main):  node scripts/intrebari/construieste_corpus.mjs C:\Users\Public\intrebari_worker\corpus_index.json
// Iese cu cod 1 dacă vreun fișier din CORPUS lipsește sau e stricat — workerul refuză să răspundă fără index (fail closed).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORPUS, construiesteIndex } from './corpus.mjs'

const iesire = process.argv[2]
if (!iesire) { console.error('Folosire: node scripts/intrebari/construieste_corpus.mjs <iesire.json>'); process.exit(2) }
const radacina = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fisiere = []
let lipsa = 0
for (const cale of CORPUS) {
  try {
    const date = readFileSync(join(radacina, cale))
    fisiere.push({ cale, continut: date.toString('utf8'), sha256: createHash('sha256').update(date).digest('hex') })
  } catch { console.error(`lipsește: ${cale}`); lipsa++ }
}
const index = construiesteIndex(fisiere, new Date().toISOString())
const stricate = index.fisiere.filter(f => f.eroare)
for (const f of stricate) console.error(`${f.cale}: ${f.eroare}`)
if (lipsa || stricate.length || !index.bucati.length) process.exit(1)
writeFileSync(iesire, JSON.stringify(index), 'utf8')
console.log(`corpus: ${index.fisiere.length} fișiere, ${index.bucati.length} bucăți → ${iesire}`)
