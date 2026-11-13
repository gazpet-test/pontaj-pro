// DOAR pentru test_motor.py / test_worker.py (nu e în manifest, nu rulează în producție): un proces care vorbește protocolul
// motorului cu motorul REAL (motor_protocol.mjs) și se strică la cererea a N-a, într-un mod ales — ca workerul să fie verificat pe
// fiecare cale de eroare a procesului.
// Argumente: <mod> <la> <salut.json> <url motor_protocol.mjs> [jurnalul operațiilor]
//   la = 0: defectul e chiar la salut; la = -1: niciun defect (mod „numara”: scrie operațiile în jurnal).
//   moduri: cade, doarme, trunchiat, schema, mare, json, utf8, id, eroare, salut_protocol, salut_node, salut_unicode,
//           salut_amprenta, salut_chei, numara, nu_citeste (r5: salut valid, apoi NU citește deloc intrarea — scrierea cererii
//           se blochează când se umple pipe-ul)
import { appendFileSync } from 'node:fs'

const [mod, laText, salutText, urlProtocol, jurnal] = process.argv.slice(2)
const la = Number(laText)
const salut = JSON.parse(salutText)
const { trateaza, creeazaSesiune } = await import(urlProtocol)
const scrie = (s, dupa) => process.stdout.write(s, dupa)

function defect(id) {
  switch (mod) {
    case 'cade': process.exit(1); break
    case 'doarme': setInterval(() => {}, 1000); break
    case 'trunchiat': scrie(`{"v":1,"id":${id},"ok":tr`, () => process.exit(0)); break
    case 'schema': scrie(JSON.stringify({ v: 1, id, ok: true, rez: { text: 5, afisat: 7, motiv: 'x', n: 'x', tip: 'poate' } }) + '\n'); break
    case 'mare': scrie(JSON.stringify({ v: 1, id, ok: true, rez: { text: 'x'.repeat(3 * 1024 * 1024) } }) + '\n'); break
    case 'json': scrie('nu e json\n'); break
    case 'utf8': scrie(Buffer.from([0xff, 0xfe, 0x7b, 0x0a])); break
    case 'id': scrie(JSON.stringify({ v: 1, id: (id ?? 0) + 7, ok: true, rez: {} }) + '\n'); break
    case 'eroare': scrie(JSON.stringify({ v: 1, id, ok: false, eroare: 'motor' }) + '\n'); break
    default: process.exit(2)
  }
}

const SALUTURI = {
  salut_protocol: { ...salut, protocol: 2, v: 2 },
  salut_node: { ...salut, node: '23.11.0' },
  salut_unicode: { ...salut, unicode: '15.1' },
  salut_amprenta: { ...salut, amprente: { ...salut.amprente, 'src/intrebariMascare.js': '0'.repeat(64) } },
  salut_chei: { ...salut, extra: 1 },
}
if (la === 0 && !SALUTURI[mod]) defect(null)
else scrie(JSON.stringify(SALUTURI[mod] || salut) + '\n')

const sesiune = creeazaSesiune()
let n = 0, buf = ''
if (mod === 'nu_citeste') setInterval(() => {}, 1000)          // trăiește, dar nu atașează niciun cititor pe intrare
else process.stdin.setEncoding('utf8')
if (mod !== 'nu_citeste') process.stdin.on('data', d => {
  buf += d
  let k
  while ((k = buf.indexOf('\n')) >= 0) {
    const c = JSON.parse(buf.slice(0, k))
    buf = buf.slice(k + 1)
    n++
    if (jurnal) appendFileSync(jurnal, c.op + '\n')
    if (n === la) { defect(c.id); continue }
    const r = trateaza(sesiune, c)
    if (sesiune.gata) { scrie(JSON.stringify(r) + '\n', () => process.exit(0)); return }
    scrie(JSON.stringify(r) + '\n')
  }
})
if (mod !== 'nu_citeste') process.stdin.on('end', () => process.exit(0))
