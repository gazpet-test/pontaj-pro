// Verificarea prin MUTAȚII a suitei J04×J07: rulează suita (scripts/pg/test_j04xj07.mjs) câte o dată pentru FIECARE mutant
// din fixtures/j04xj07_mutanti.mjs (SQL + edge), în paralel, fiecare pe baza lui de unică folosință (JX_BAZA), pe același
// PostgreSQL 16 LOCAL.
//
//   PGURI_ADMIN=postgres://postgres@127.0.0.1:5440/postgres node scripts/pg/test_j04xj07_mutanti.mjs [regex-mutanți]
//   (sau: bash scripts/test_j04xj07.sh --mutanti)
//
// Variabile (opționale): JX_PARALEL (implicit 4) · JX_JURNALE (director pentru jurnalul fiecărui mutant; implicit
//   <tmp>/j04xj07_mutanti) · JX_REZUMAT (fișier JSON: mutant → aplicat / ucis / testele care l-au prins) ·
//   JX_FILTRU_FISIERE (regex pe fișierele de test, trecut runner-ului).
// PASS (exit 0) ⇔ fiecare mutant e APLICAT și UCIS de cel puțin un test funcțional (JX-00, care compară definițiile, nu
// contează), iar controlul negativ M00_noop e aplicat și SUPRAVIEȚUIEȘTE (detectorul nu dă ucideri false).
// Mutant neaplicat (ancoră lipsă, eroare de setup) = FAIL, niciodată „ucis”.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { MUTANTI, MUTANTI_EDGE, CONTROL_NEGATIV } from './fixtures/j04xj07_mutanti.mjs'

assert.ok(process.env.PGURI_ADMIN, 'Setează PGURI_ADMIN=postgres://postgres@127.0.0.1:<port>/postgres (PG16 local)')
const RUNNER = fileURLToPath(new URL('./test_j04xj07.mjs', import.meta.url))
const PARALEL = Math.max(1, Number(process.env.JX_PARALEL || 4))
const JURNALE = process.env.JX_JURNALE || join(tmpdir(), 'j04xj07_mutanti')
const filtru = new RegExp(process.argv[2] || '')
const toti = [...Object.keys(MUTANTI).map(n => [n, 'sql']), ...Object.keys(MUTANTI_EDGE).map(n => [n, 'edge'])]
const lista = toti.filter(([n]) => filtru.test(n) || n === CONTROL_NEGATIV)
assert.ok(lista.length > 1, 'Niciun mutant pentru filtrul ' + filtru)
mkdirSync(JURNALE, { recursive: true })

function ruleaza([nume, fel], i) {
  return new Promise(res => {
    const env = { ...process.env, JX_MUTANT: nume, JX_BAZA: `jakv0407_test_m${i}` }
    const args = [RUNNER, ...(process.env.JX_FILTRU_FISIERE ? [process.env.JX_FILTRU_FISIERE] : [])]
    const p = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { out += d })
    p.on('close', cod => {
      writeFileSync(join(JURNALE, nume + '.log'), out)
      const aplicat = new RegExp(`^MUTANT aplicat: ${nume}\\b`, 'm').test(out) && !/^FAIL setup/m.test(out)
      const ucigasi = [...out.matchAll(/^FAIL (JX-[\w-]+) — /gm)].map(m => m[1]).filter(id => id !== 'JX-00')
      const verdict = (out.match(new RegExp(`^MUTANT ${nume}: (UCIS|SUPRAVIEȚUIEȘTE)`, 'm')) || [])[1] || 'NEAPLICAT'
      res({ nume, fel, cod, aplicat, verdict: aplicat ? verdict : 'NEAPLICAT', ucigasi,
        eroare: aplicat ? null : ((out.match(/^FAIL setup: .*$/m) || [''])[0].slice(0, 300) || out.trim().split('\n').slice(-3).join(' | ')) })
    })
  })
}

const t0 = Date.now()
// Controlul negativ rulează PRIMUL și singur: creează, la nevoie, rolurile de test la nivel de cluster (anon,
// authenticated, service_role, jx_actor), ca rulările paralele de după să nu se întreacă pe CREATE ROLE.
lista.sort(([a], [b]) => (b === CONTROL_NEGATIV) - (a === CONTROL_NEGATIV))
const rezultate = new Array(lista.length)
rezultate[0] = await ruleaza(lista[0], 0)
let urmator = 1
await Promise.all(Array.from({ length: Math.min(PARALEL, lista.length - 1) }, async () => {
  while (urmator < lista.length) { const i = urmator++; rezultate[i] = await ruleaza(lista[i], i) }
}))

let esecuri = 0
for (const r of rezultate) {
  const negativ = r.nume === CONTROL_NEGATIV
  const ok = r.aplicat && (negativ ? r.verdict === 'SUPRAVIEȚUIEȘTE' : r.verdict === 'UCIS' && r.ucigasi.length > 0)
  if (!ok) esecuri++
  const eticheta = negativ ? 'CONTROL NEGATIV' : r.verdict
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.nume.padEnd(46)} ${r.fel.padEnd(4)} ${eticheta.padEnd(16)}` +
    (r.ucigasi.length ? ` ← ${r.ucigasi.join(', ')}` : '') + (r.eroare ? ` — ${r.eroare}` : '') +
    (!ok && negativ ? ' — controlul negativ trebuia să SUPRAVIEȚUIASCĂ (ucidere falsă)' : ''))
}
if (process.env.JX_REZUMAT) writeFileSync(process.env.JX_REZUMAT, JSON.stringify(rezultate, null, 1) + '\n')
const n = rezultate.length - 1
console.log(`\n${esecuri ? 'FAIL' : 'PASS'} mutanți J04×J07: ${rezultate.filter(r => r.nume !== CONTROL_NEGATIV && r.verdict === 'UCIS').length}/${n} uciși` +
  ` (${rezultate.filter(r => r.fel === 'sql' && r.nume !== CONTROL_NEGATIV).length} SQL + ${rezultate.filter(r => r.fel === 'edge').length} edge),` +
  ` control negativ ${rezultate.find(r => r.nume === CONTROL_NEGATIV)?.verdict}; ${Math.round((Date.now() - t0) / 1000)} s, ${PARALEL} în paralel. Jurnale: ${JURNALE}`)
process.exitCode = esecuri ? 1 : 0
