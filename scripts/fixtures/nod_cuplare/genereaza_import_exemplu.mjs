// Regenerează SQL-ul de import SINTETIC folosit de scripts/test_executie_noduri_suduri.sql (pasul T14):
//   node scripts/fixtures/nod_cuplare/genereaza_import_exemplu.mjs
// Date inventate (proiectul 1, nodul fictiv NOD-TEST-IMPORT). Testul vitest verifică că fișierele sunt la zi cu generatorul.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { genereazaSql } from '../../noduri_cuplare_import_sql.mjs'

const f = n => fileURLToPath(new URL(`./${n}`, import.meta.url))
const citeste = n => readFileSync(f(n), 'utf8')
// prima linie (cu ora generării) se scoate, ca fișierul să fie determinist
const fara1 = sql => sql.slice(sql.indexOf('\n') + 1)

export function importuriExemplu() {
  const comun = { proiect: 1, nod: 'NOD-TEST-IMPORT' }
  return {
    'import_exemplu_1.sql': fara1(genereazaSql({ ...comun, listaCsv: citeste('lista_exemplu.csv'), puncteCsv: citeste('puncte_exemplu.csv'),
      manifest: JSON.parse(citeste('vederi_exemplu.json')), surse: { lista: 'exemplu1'.repeat(8) } }).sql),
    'import_exemplu_2.sql': fara1(genereazaSql({ ...comun, listaCsv: citeste('lista_exemplu_2.csv'), surse: { lista: 'exemplu2'.repeat(8) } }).sql),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const [n, sql] of Object.entries(importuriExemplu())) { writeFileSync(f(n), '-- FIXTURE SINTETIC pentru harness (date inventate), generat de genereaza_import_exemplu.mjs.\n' + sql, 'utf8'); console.log('scris ' + n) }
}
