// Manifestul MOTORULUI UNIC al „Întreabă echipa” (r4, PR #1086): sha256 (cu finaluri de linie LF) pentru motor și TOATE
// fișierele lui locale + protocolul, versiunea motorului, versiunea majoră Node (24, ca package.json) și versiunea Unicode a Node-ului
// care rulează (serverul: Node 24.20 = Unicode 17.0). Workerul (motor.py) îl verifică la pornire și refuză orice diferență.
// La orice schimbare în motor / protocol / JSON-urile lui (PR):
//   node scripts/intrebari/manifest_motor.mjs            → rescrie worker/intrebari-tehnice/motor_manifest.json
//   node scripts/intrebari/manifest_motor.mjs --verifica → cod 1 dacă manifestul din repo nu e la zi (testul vitest face la fel)
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MOTOR_VERSIUNE } from '../../src/intrebariMascare.js'

export const FISIERE = ['src/intrebariMascare.js', 'worker/intrebari-tehnice/motor_protocol.mjs', 'worker/intrebari-tehnice/motor_cli.mjs',
  'worker/intrebari-tehnice/nemascate.json', 'worker/intrebari-tehnice/vocabular_web.json', 'worker/intrebari-tehnice/cuvinte_comune.json']
export const INTRARE = 'worker/intrebari-tehnice/motor_cli.mjs'
export const IESIRE = 'worker/intrebari-tehnice/motor_manifest.json'
const radacina = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** sha256 pe octeții fișierului cu CRLF → LF (checkout-ul Windows are CRLF, serverul copiază din repo). */
export function amprenta(octeti) {
  return createHash('sha256').update(Buffer.from(octeti.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')).digest('hex')
}

export function manifest(rad = radacina) {
  return {
    _despre: 'Generat de scripts/intrebari/manifest_motor.mjs — NU se editează de mână. Verificat de worker/intrebari-tehnice/motor.py la pornire.',
    versiune: 1, protocol: 1, motor: MOTOR_VERSIUNE, node_major: 24, unicode: process.versions.unicode, intrare: INTRARE,
    fisiere: Object.fromEntries(FISIERE.map(f => [f, amprenta(readFileSync(join(rad, f)))])),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = manifest()
  const text = JSON.stringify(m, null, 2) + '\n'
  if (process.argv.includes('--verifica')) {
    const vechi = readFileSync(join(radacina, IESIRE), 'utf8').replace(/\r\n/g, '\n')
    if (vechi !== text) { console.error('motor_manifest.json NU e la zi: rulează node scripts/intrebari/manifest_motor.mjs'); process.exit(1) }
    console.log('motor_manifest.json la zi')
  } else {
    writeFileSync(join(radacina, IESIRE), text, 'utf8')
    console.log(`scris ${IESIRE}`)
  }
}
