// Construiește indexul corpusului pentru workerul „❓ Întreabă echipa”.
// Rulare (pe serverul AI, din clona la zi pe main):
//   node scripts/intrebari/construieste_corpus.mjs C:\Users\Public\intrebari_worker\corpus_index.json
// La o schimbare în fișierele din CORPUS (dezvoltare, PR):
//   node scripts/intrebari/construieste_corpus.mjs <temp>.json --manifest worker/intrebari-tehnice/corpus_manifest.json
// Verificare fără scriere (manifestul din repo e la zi cu docs/?):
//   node scripts/intrebari/construieste_corpus.mjs --verifica worker/intrebari-tehnice/corpus_manifest.json
// Indexul e DETERMINIST (fără dată, sha256 pe text cu LF): aceleași fișiere → aceiași octeți → același sha256, pe orice mașină.
// Workerul refuză să preia întrebări dacă sha256(indexul de pe server) ≠ index_sha256 din manifestul copiat din repo (fail closed).
// Iese cu cod 1 dacă vreun fișier din CORPUS lipsește sau e stricat, ori (la --verifica) dacă manifestul nu se potrivește.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORPUS, construiesteIndex, sha256Text, sha256Octeti, manifestDin } from './corpus.mjs'

const arg = process.argv.slice(2)
const ia = nume => { const i = arg.indexOf(nume); if (i < 0) return null; const v = arg[i + 1]; arg.splice(i, 2); return v || '' }
const verifica = ia('--verifica'), manifestIesire = ia('--manifest')
const iesire = arg[0]
if (verifica === '' || manifestIesire === '' || (!iesire && verifica == null) || arg.length > 1) {
  console.error('Folosire: node scripts/intrebari/construieste_corpus.mjs <iesire.json> [--manifest <manifest.json>] | --verifica <manifest.json>')
  process.exit(2)
}
const radacina = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fisiere = []
let lipsa = 0
for (const cale of CORPUS) {
  try {
    const continut = readFileSync(join(radacina, cale), 'utf8')
    fisiere.push({ cale, continut, sha256: sha256Text(continut) })
  } catch { console.error(`lipsește: ${cale}`); lipsa++ }
}
const index = construiesteIndex(fisiere)
const stricate = index.fisiere.filter(f => f.eroare)
for (const f of stricate) console.error(`${f.cale}: ${f.eroare}`)
if (lipsa || stricate.length || !index.bucati.length) process.exit(1)
const octeti = Buffer.from(JSON.stringify(index), 'utf8')
const manifest = manifestDin(index, sha256Octeti(octeti))

if (verifica != null) {
  let m
  try { m = JSON.parse(readFileSync(verifica, 'utf8')) } catch { console.error(`manifest ilizibil: ${verifica}`); process.exit(1) }
  if (m.index_sha256 !== manifest.index_sha256) {
    console.error(`manifestul NU e la zi: ${m.index_sha256} ≠ ${manifest.index_sha256} (reconstruiește cu --manifest și pune-l în PR)`)
    process.exit(1)
  }
  console.log(`manifest la zi: ${manifest.index_sha256}`)
  process.exit(0)
}
writeFileSync(iesire, octeti)
if (manifestIesire) writeFileSync(manifestIesire, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`corpus: ${index.fisiere.length} fișiere, ${index.bucati.length} bucăți → ${iesire} (sha256 ${manifest.index_sha256})`)
