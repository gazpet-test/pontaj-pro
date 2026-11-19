// Lucrătorul probei de COST (scripts/pglite/test_redari_mail_link_local.mjs, secțiunea 7): încarcă baza PGlite pregătită de probă (dumpDataDir, migrarea deja
// aplicată) și rulează corpul supabase/tests/20261131i_redari_mail_link_cost.sql (între marcajele COST-CORP) cu parametrii dați. Rulează într-un worker_thread
// ca proba să-l poată OPRI la prag (PGlite nu are statement_timeout: fără timere în WASM) — un mutant lent nu ține proba minute întregi.
import { parentPort, workerData } from 'node:worker_threads'
import { PGlite } from '@electric-sql/pglite'

const { dump, corp, parametri } = workerData
const lit = s => `'${String(s).replace(/'/g, "''")}'`
try {
  const db = new PGlite({ loadDataDir: new Blob([dump]) })
  await db.waitReady
  const note = []
  const set = Object.entries(parametri).map(([k, v]) => `SELECT set_config(${lit('cost.' + k)}, ${lit(v)}, true);`).join('\n')
  await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED;\n${set}`)
  const t0 = Date.now()
  await db.exec(corp, { onNotice: n => note.push(n.message) })
  const durata = Date.now() - t0
  await db.exec('ROLLBACK')
  await db.close()
  parentPort.postMessage({ note, durata })
} catch (e) {
  parentPort.postMessage({ eroare: `${e.code || ''} ${e.message}`.trim() })
}
