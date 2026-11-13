// Procesul MOTORULUI UNIC (r4, PR #1086) — pornit de motor.py, câte unul pe speță, DIRECT (fără shell), cu
//   node --permission --allow-fs-read=<instantaneul> --disallow-code-generation-from-strings motor_cli.mjs
// (permisiunile Node opresc scrierea pe disc, procesele copil, workerii și modulele native; citirea e doar din instantaneul
// verificat). Rețeaua: motorul și protocolul nu importă nimic în afara propriilor fișiere (testul static din motor.test.js), iar
// aici, ÎNAINTE de importul motorului, se scot și funcțiile de rețea globale.
// Ieșirea standard e DOAR pentru protocol; în stderr nu se scrie nimic (nici la erori neprevăzute: ieșire cu cod, fără mesaj).
// La pornire: versiunea Node (24.x, ca package.json) și amprentele sha256 (LF) ale fișierelor citite, trimise în salut —
// motor.py le compară cu motor_manifest.json și oprește procesul la orice diferență.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.on('uncaughtException', () => process.exit(70))
process.on('unhandledRejection', () => process.exit(70))
for (const k of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Request', 'Response', 'Headers']) {
  try { delete globalThis[k] } catch { process.exit(70) }
}

export const NODE_MAJOR = 24
export const FISIERE = ['src/intrebariMascare.js', 'worker/intrebari-tehnice/motor_protocol.mjs', 'worker/intrebari-tehnice/motor_cli.mjs',
  'worker/intrebari-tehnice/nemascate.json', 'worker/intrebari-tehnice/vocabular_web.json', 'worker/intrebari-tehnice/cuvinte_comune.json']
const MAX_INTRARE = 64 * 1024 * 1024      // octeți pe o linie de cerere (dicționarul e cea mai mare)
const MAX_IESIRE = 16 * 1024 * 1024       // octeți pe o linie de răspuns
const TERMEN_TOTAL_MS = 35 * 60 * 1000    // procesul unei spețe nu trăiește mai mult (motor.py are și el termenul lui)

if (Number(String(process.versions.node).split('.')[0]) !== NODE_MAJOR) process.exit(71)
setTimeout(() => process.exit(74), TERMEN_TOTAL_MS).unref()

const radacina = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const amprente = {}
for (const f of FISIERE) {
  const b = readFileSync(join(radacina, f)).toString('latin1').replace(/\r\n/g, '\n')
  amprente[f] = createHash('sha256').update(Buffer.from(b, 'latin1')).digest('hex')
}
const { trateaza, creeazaSesiune, PROTOCOL } = await import('./motor_protocol.mjs')
const { MOTOR_VERSIUNE } = await import('../../src/intrebariMascare.js')

const utf8 = new TextDecoder('utf-8', { fatal: true })
let iesind = false
function scrie(obj, cod = null) {
  let linie = JSON.stringify(obj) + '\n'
  if (Buffer.byteLength(linie, 'utf8') > MAX_IESIRE) { linie = JSON.stringify({ v: PROTOCOL, id: obj.id ?? null, ok: false, eroare: 'iesire_mare' }) + '\n'; cod = 75 }
  if (cod !== null) { iesind = true; process.stdout.write(linie, () => process.exit(cod)) }
  else process.stdout.write(linie)
}

scrie({ v: PROTOCOL, tip: 'salut', protocol: PROTOCOL, motor: MOTOR_VERSIUNE, node: process.versions.node,
  unicode: process.versions.unicode, amprente })

const sesiune = creeazaSesiune()
let tampon = Buffer.alloc(0)
process.stdin.on('data', bucata => {
  if (iesind) return
  tampon = tampon.length ? Buffer.concat([tampon, bucata]) : bucata
  let k
  while (!iesind && (k = tampon.indexOf(10)) >= 0) {
    const linie = tampon.subarray(0, k)
    tampon = tampon.subarray(k + 1)
    if (linie.length > MAX_INTRARE) return scrie({ v: PROTOCOL, id: null, ok: false, eroare: 'intrare_mare' }, 72)
    let c
    try { c = JSON.parse(utf8.decode(linie)) } catch { return scrie({ v: PROTOCOL, id: null, ok: false, eroare: 'json' }, 73) }
    const r = trateaza(sesiune, c)
    if (!r.ok) return scrie(r, 76)                  // orice eroare oprește sesiunea (fail closed)
    if (sesiune.gata) return scrie(r, 0)
    scrie(r)
  }
  if (tampon.length > MAX_INTRARE) scrie({ v: PROTOCOL, id: null, ok: false, eroare: 'intrare_mare' }, 72)
})
process.stdin.on('end', () => { if (!iesind) process.exit(0) })
