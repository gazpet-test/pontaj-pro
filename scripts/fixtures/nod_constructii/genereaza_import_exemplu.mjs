// Regenerează SQL-urile de import SINTETICE folosite de scripts/test_executie_noduri_constructii.sql (pasul T14):
//   node scripts/fixtures/nod_constructii/genereaza_import_exemplu.mjs
// Date inventate (proiectul 1, nodul fictiv NOD-TEST-IMPORT). Testul vitest verifică că fișierele sunt la zi cu generatorul.
//   1 = lista de bază (F6-1 cu stadiu inițial, F6-2, SPC-1, IPB-1); 2 = listă revizuită (SPC-1 scos, F6-2 cu alte etape, IPB-1 112,5 m, FSI-1 nou);
//   3 = lipsește F6-2 (bifat) -> oprire; 4 = F6-2 cu etape care nu păstrează bifarea -> oprire; 5 = alt stadiu pe F6-1 (bifat) -> oprire.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { genereazaSql } from '../../noduri_constructii_import_sql.mjs'

const f = n => fileURLToPath(new URL(`./${n}`, import.meta.url))
const citeste = n => readFileSync(f(n), 'utf8')
// prima linie (cu ora generării) se scoate, ca fișierul să fie determinist
const fara1 = sql => sql.slice(sql.indexOf('\n') + 1)
export const ANTET = '-- FIXTURE SINTETIC pentru harness (date inventate), generat de genereaza_import_exemplu.mjs.\n'

export function importuriExemplu() {
  const out = {}
  for (const [i, csv] of [[1, 'lista_exemplu.csv'], [2, 'lista_exemplu_2.csv'], [3, 'lista_exemplu_3.csv'], [4, 'lista_exemplu_4.csv'], [5, 'lista_exemplu_5.csv']]) {
    out[`import_exemplu_${i}.sql`] = ANTET + fara1(genereazaSql({ proiect: 1, nod: 'NOD-TEST-IMPORT', listaCsv: citeste(csv), surse: { lista: `exemplu${i}`.repeat(8) } }).sql)
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const [n, sql] of Object.entries(importuriExemplu())) { writeFileSync(f(n), sql, 'utf8'); console.log('scris ' + n) }
}
