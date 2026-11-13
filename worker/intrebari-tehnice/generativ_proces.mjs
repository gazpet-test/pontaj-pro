// Rularea matricei generative (generativ.mjs) pe MOTORUL UNIC — DOAR pentru teste (nu e în manifest, nu rulează în producție).
// Același fișier rulează în două feluri, pe aceleași loturi:
//   - fir de lucru (worker_threads) pornit din vitest (src/intrebariMascare.generativ.test.js): partea „în vitest”, paralelă;
//   - proces Node separat, cu ACELEAȘI flaguri ca motor.py:
//       node --permission --allow-fs-read=<repo> --disallow-code-generation-from-strings generativ_proces.mjs '<[indici de lot]>'
//     (procesul Node real; rezultatul pe ieșirea standard, JSON).
// Pentru fiecare lot: câte cazuri, câte combinații neaplicabile, eșecurile oracolului (primele 10, cu textul — nume INVENTATE) și
// sha256 al ieșirilor (textul mascat + textul demascat al fiecărui caz) — testul cere aceeași amprentă în ambele rulări.
import { createHash } from 'node:crypto'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'

const E = await import('../../src/intrebariMascare.js')
const G = await import('./generativ.mjs')
const D = E.Dictionar.dinRaspuns(G.DICTIONAR)
const S1 = String.fromCharCode(1), S2 = String.fromCharCode(2)

export function ruleaza(indici) {
  const toate = G.loturi()
  return indici.map(i => {
    const l = toate[i]
    const { cazuri, excluse } = G.cazuriLot(l)
    const h = createHash('sha256')
    const esecuri = []
    let nrEsecuri = 0
    for (const c of cazuri) {
      const m = new E.Mascare(D)
      if (c.invata) m.invata(c.t)
      const o = m.mascheaza(c.t, false)
      const r = m.demascheaza(o)
      h.update(o + S1 + r + S2)
      const v = G.verifica(c, o, r)
      if (v) { nrEsecuri++; if (esecuri.length < 10) esecuri.push({ motiv: v, text: c.t, iesire: o }) }
    }
    return { i, familie: l.familie, lot: l.lot, cazuri: cazuri.length, excluse, esecuri: nrEsecuri, primele: esecuri, sha256: h.digest('hex') }
  })
}

if (isMainThread) {
  if (process.argv[2]) process.stdout.write(JSON.stringify(ruleaza(JSON.parse(process.argv[2]))))
} else {
  parentPort.postMessage(ruleaza(workerData.indici))
}
