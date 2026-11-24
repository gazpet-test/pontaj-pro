// Proba LOCALĂ a migrării 20270108a (Execuție → registrul DCC, PR1) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Planul: docs/superpowers/plans/2026-11-24-registru-dcc-pr1.md (runda 4). Baza: schema falsă supabase/tests/20270108a_executie_dcc_registru_schelet.sql
//   + lanțul de drept pe proiect extras EXACT din 20261209a (amprentele = constantele din migrare) + identitățile sintetice. Aplicarea: ca runnerul
//   (marcaj + plafonul EXTINS + pasul „înainte” L15 v2 generat de scripts/livrare_amprenta_gen.sh). Fiecare bloc pornește de pe o copie curată a
//   bazei (instantaneu PGlite): fără fixtură (testele de RPC își creează datele prin RPC) sau cu fix_baza (rânduri inserate direct ca postgres).
// Registrul blocurilor: {nume, task, cere: [secțiuni], cere_absent?, fixtura, fn}. `--pana-la tN` rulează blocurile cu task <= N; un bloc căruia
//   îi lipsește o secțiune cerută = BLOC_DEPENDENTA_LIPSA (ieșire 1). Blocurile de STARE INTERMEDIARĂ (cere_absent) stau într-un registru ÎNCHIS,
//   cu succesorii lor cumulativi: rulează doar cât secțiunile interzise lipsesc, apoi sunt SĂRITE vizibil (BLOC_STARE_INTERMEDIARA_SARIT).
// Rulare (din rădăcina repo-ului; cere bash în PATH, PGlite instalat fără salvare):
//   npm install --no-save @electric-sql/pglite@0.3 && node scripts/pglite/test_executie_dcc_registru_local.mjs [--pana-la tN] [--doar <bloc>]
import { bazaGoala, dinInstantaneu, caRunner, citeste, abateri, sqlLant, pentruPglite, PID_REAL, PID_PGLITE, NUME, CALE_MIG, ROOT } from './dcc_registru/baza.mjs'
import { FIX_BAZA } from './dcc_registru/fixtura.mjs'
import { BLOCURI_T2 } from './dcc_registru/blocuri_t2.mjs'
import { BLOCURI_T3 } from './dcc_registru/blocuri_t3.mjs'
import { BLOCURI_T4 } from './dcc_registru/blocuri_t4.mjs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const PANA_LA = opt('--pana-la')
const DOAR = opt('--doar')
if (PANA_LA && !/^t[1-9]$/.test(PANA_LA)) { console.log('argument --pana-la invalid: ' + PANA_LA); process.exit(2) }
const LIMITA = PANA_LA ? Number(PANA_LA.slice(1)) : 99

const MIG = citeste(CALE_MIG)
// secțiunile prezente în migrare: markerii „-- ─── N.” / „-- ─── Na.” (fiecare cel mult o dată)
const SECTIUNI = new Set()
for (const m of MIG.matchAll(/^-- ─── ([0-9])([a-d])?\. /gm)) {
  const s = m[1] + (m[2] || '')
  if (SECTIUNI.has(s)) { console.log(`MARCAJ_DUBLAT ${s}`); process.exit(1) }
  SECTIUNI.add(s); SECTIUNI.add(m[1])
}

const BLOCURI = [...BLOCURI_T2, ...BLOCURI_T3, ...BLOCURI_T4]
// registrul ÎNCHIS al blocurilor de stare intermediară: {bloc: succesori cumulativi}
const INTERMEDIARE = { t2_select_inainte_de_politici: ['t3_grant', 't3_rls_fixtura'] }
// succesorii pot lipsi din lista blocurilor DOAR cât commit-ul nu are încă secțiunea care face blocul sărit (la Task 2 nu există t3_*)
function verificaRegistru() {
  for (const b of BLOCURI) {
    if (b.cere_absent && !INTERMEDIARE[b.nume]) { console.log(`BLOC_INTERMEDIAR_NEDECLARAT ${b.nume}`); process.exit(1) }
  }
  for (const [nume, succ] of Object.entries(INTERMEDIARE)) {
    const b = BLOCURI.find(x => x.nume === nume)
    if (!b) { console.log(`BLOC_FARA_SUCCESOR ${nume} (blocul lipsește)`); process.exit(1) }
    const devineSarit = Math.min(...b.cere_absent.map(Number))
    if (b.cere_absent.some(s => SECTIUNI.has(s))) {
      for (const s of succ) {
        const x = BLOCURI.find(y => y.nume === s)
        if (!x || x.task > devineSarit || x.cere_absent) { console.log(`BLOC_FARA_SUCCESOR ${nume} -> ${s}`); process.exit(1) }
      }
    }
  }
  for (const b of BLOCURI) if (b.task <= LIMITA) for (const s of b.cere) if (!SECTIUNI.has(s)) { console.log(`BLOC_DEPENDENTA_LIPSA ${b.nume} ${s}`); process.exit(1) }
  const nume = BLOCURI.map(b => b.nume)
  if (new Set(nume).size !== nume.length) { console.log('BLOC_DUBLAT'); process.exit(1) }
}

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

async function main() {
  const t0 = Date.now()
  console.log(`secțiuni prezente: ${[...SECTIUNI].sort().join(' ')}; limita: ${PANA_LA || 'toate'}${DOAR ? '; doar ' + DOAR : ''}`)
  verificaRegistru()
  // 0. lanțul de drept (amprentele = constantele din migrare) și validatorul runnerului pe migrare
  console.log('0. preliminare')
  for (const [nume, calc, amp] of sqlLant().amprente) ok(calc === amp && MIG.includes(`'${amp}'`), `lanțul ${nume}: ${calc}`)
  {
    let out
    try {
      out = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), join(ROOT, CALE_MIG), 'reg_0123456789abcdef',
        '--plafon-tranzactie-ms', '15000', '--plafon-extins'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    } catch (e) { out = 'REFUZ ' + String(e.stderr || e.message).trim() }
    ok(/^OK \d+ /.test(out), 'validatorul runnerului pe migrare (plafon extins): ' + out.slice(0, 200))
  }
  // instantaneele: B0 = baza + migrarea; B1 = B0 + fix_baza
  const P = pentruPglite(MIG)
  console.log(`PGLITE_PID: ${P.aparitii} apariții „${PID_REAL}” -> „${PID_PGLITE}” (doar în copia aplicată pe PGlite)`)
  ok(P.aparitii >= 1, 'predicatul pid-ului apare în migrare (substituția PGlite are ce înlocui)')
  const db0 = await bazaGoala()
  try { await caRunner(db0, NUME, P.text) } catch (e) { console.log('APLICAREA MIGRARII A ESUAT: ' + e.message + '\n' + (e.jurnal || []).join('\n')); process.exit(1) }
  const B0 = await db0.dumpDataDir('none')
  try { await db0.exec(FIX_BAZA) } catch (e) { console.log('FIXTURA fix_baza REFUZATA: ' + e.message); process.exit(1) }
  const B1 = await db0.dumpDataDir('none')
  await db0.close()
  console.log(`migrarea aplicată și instantaneele gata în ${Date.now() - t0} ms`)

  let rulate = 0
  for (const b of BLOCURI) {
    if (b.task > LIMITA) continue
    if (DOAR && b.nume !== DOAR) continue
    if (b.cere_absent && b.cere_absent.some(s => SECTIUNI.has(s))) {
      console.log(`BLOC_STARE_INTERMEDIARA_SARIT ${b.nume} ${b.cere_absent.filter(s => SECTIUNI.has(s)).join(',')}`)
      continue
    }
    const t = Date.now()
    const db = await dinInstantaneu(b.fixtura ? B1 : B0)
    const A = abateri()
    try { await b.fn(db, A) } catch (e) { A.ab.push('EXCEPTIE ' + (e.stack || e.message)) }
    await db.close()
    rulate++
    ok(A.ab.length === 0, `${b.nume} (task ${b.task}, ${Date.now() - t} ms)${A.ab.length ? '\n        ' + A.ab.slice(0, 40).join('\n        ') + (A.ab.length > 40 ? `\n        … încă ${A.ab.length - 40}` : '') : ''}`)
  }
  if (DOAR && rulate === 0) { console.log('BLOC_NECUNOSCUT ' + DOAR); process.exit(1) }
  console.log(`\n${rulate} blocuri rulate, ${esec} eșecuri, ${Math.round((Date.now() - t0) / 1000)} s`)
  process.exit(esec ? 1 : 0)
}
main().catch(e => { console.log('EROARE ' + (e.stack || e.message)); process.exit(1) })
