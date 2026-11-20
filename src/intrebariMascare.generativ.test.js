import { describe, it, expect } from 'vitest'
import { parseAst } from 'vite'
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import { join, resolve, dirname, relative } from 'node:path'
import * as E from './intrebariMascare.js'
import * as G from '../worker/intrebari-tehnice/generativ.mjs'

// Criteriul de acceptare r5 (L25): matricea GENERATIVĂ pe produsul complet al dimensiunilor contractului, pe domeniul finit și
// publicat din worker/intrebari-tehnice/generativ.mjs (și docs/intrebari/MASCARE_SI_VERDICT.md, „Matricea generativă”).
// ACELEAȘI loturi rulează:
//   (1) în vitest: pe fire de lucru (worker_threads) pornite de acest test, plus un eșantion direct pe modulul importat aici;
//   (2) în procesul Node REAL, cu flagurile din motor.py (--permission, citire doar din repo, fără generare de cod din text).
// Pe fiecare lot: zero eșecuri ale oracolului în ambele rulări și ACEEAȘI amprentă sha256 a ieșirilor. Date INVENTATE.
//
// r8 (CI: produsul complet, de două ori, nu încăpea în 900 s pe mașina GitHub cu 4 nuclee):
//   - pe FIECARE rulare (npm test, toate PR-urile): eșantionul ACOPERITOR (G.indiciEsantion: familiile mici complet, la cele mari
//     toate tripletele de valori pe oricare trei dimensiuni), în ambele rulări, cu aceeași amprentă pe fiecare lot;
//   - PRODUSUL COMPLET (testul de mai jos, neschimbat) rulează cu INTREBARI_GENERATIV_COMPLET=1, în jobul separat
//     .github/workflows/intrebari-generativ.yml — pe orice PR care atinge un fișier de care depinde rezultatul (închiderea
//     importurilor, verificată aici), noaptea și la cerere; împărțit în părți (INTREBARI_GENERATIV_PARTE = „s/N”: loturile i % N = s).
const RAD = resolve('.')
const PROC = join(RAD, 'worker/intrebari-tehnice/generativ_proces.mjs')
const WORKFLOW = '.github/workflows/intrebari-generativ.yml'
const LOTURI = G.loturi()
const K = Math.max(2, Math.min(8, cpus().length - 2))
const imparte = idx => Array.from({ length: K }, (_, k) => idx.filter((_, j) => j % K === k)).filter(b => b.length)
const TOATE = LOTURI.map((_, i) => i)
const COMPLET = process.env.INTREBARI_GENERATIV_COMPLET === '1'
function parteDin(s) {
  if (s === undefined || s === '') return { s: 0, n: 1 }
  const m = /^([0-9]+)\/([1-9][0-9]*)$/.exec(s)
  if (!m || Number(m[1]) >= Number(m[2])) throw new Error(`INTREBARI_GENERATIV_PARTE invalid: ${s}`)    // fără tăcere: altfel ar rula altceva
  return { s: Number(m[1]), n: Number(m[2]) }
}
const PARTE = parteDin(process.env.INTREBARI_GENERATIV_PARTE)
const PARTEA = TOATE.filter(i => i % PARTE.n === PARTE.s)

function peFire(toate, mod) {
  return Promise.all(imparte(toate).map(indici => new Promise((ok, nu) => {
    const w = new Worker(PROC, { workerData: { indici, mod } })
    w.once('message', ok); w.once('error', nu)
    w.once('exit', c => { if (c !== 0) nu(new Error(`fir oprit cu ${c}`)) })
  }))).then(x => x.flat())
}
function inProcese(toate, mod) {
  return Promise.all(imparte(toate).map(indici => new Promise((ok, nu) => {
    const p = spawn(process.execPath, ['--permission', `--allow-fs-read=${RAD}`, '--disallow-code-generation-from-strings', PROC, JSON.stringify(indici), mod],
      { env: {} })
    let out = '', err = ''
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
    p.on('close', c => c === 0 ? ok(JSON.parse(out)) : nu(new Error(`proces ${c}: ${err.slice(0, 500)}`)))
  }))).then(x => x.flat())
}
/** Ambele rulări pe aceiași indici de lot: zero eșecuri, aceleași loturi, aceeași amprentă pe fiecare lot. */
async function ambele(indici, mod) {
  const [fire, procese] = await Promise.all([peFire(indici, mod), inProcese(indici, mod)])
  const pe = r => new Map(r.map(x => [x.i, x]))
  const F = pe(fire), P = pe(procese)
  expect([...F.keys()].sort((a, b) => a - b)).toEqual(indici)
  expect([...P.keys()].sort((a, b) => a - b)).toEqual(indici)
  expect([...F.values(), ...P.values()].every(x => x.mod === mod)).toBe(true)
  const esecuri = [...F.values(), ...P.values()].filter(x => x.esecuri).map(x => ({ familie: x.familie, lot: x.lot, esecuri: x.esecuri, primele: x.primele.slice(0, 3) }))
  expect(esecuri).toEqual([])
  for (const i of indici) expect([P.get(i).cazuri, P.get(i).excluse, P.get(i).sha256], `lotul ${i}`).toEqual([F.get(i).cazuri, F.get(i).excluse, F.get(i).sha256])
  return F
}
// cifrele indicelui în baza mixtă a dimensiunilor, calculate AICI (nu cu funcția generatorului)
const cifreDin = (d, i) => { const o = new Array(d.length); for (let k = d.length - 1; k >= 0; k--) { o[k] = i % d[k]; i = Math.floor(i / d[k]) } return o }

describe('matricea generativă r5 (L25): produsul complet al dimensiunilor contractului', () => {
  it('domeniul e finit și publicat; loturi de cel mult 100.000 de cazuri; fără plafon total (toate loturile rulează)', () => {
    expect(G.LOT_MAX).toBe(100000)
    const r = G.rezumat()
    expect(r.map(x => x.familie)).toEqual(['firme_nume_intreg', 'firme_reprezentare', 'conflict_entitate_publica', 'firme_componenta_singura',
      'persoane_nume_intreg', 'persoane_componenta_singura', 'persoane_alaturate', 'persoane_trei', 'persoana_si_componenta_comuna',
      'context_si_propagare', 'exceptii', 'titlu_persoane_alaturate', 'titlu_necunoscut_si_lista', 'nume_incluse_alaturate', 'forme_ambigue_si_punti'])
    for (const f of r) {
      const loturi = LOTURI.filter(l => l.familie === f.familie)
      expect(loturi.length, f.familie).toBe(f.loturi)
      expect(loturi.every(l => l.pana_la - l.de_la <= G.LOT_MAX), f.familie).toBe(true)
      expect(loturi.reduce((s, l) => s + l.pana_la - l.de_la, 0), f.familie).toBe(f.produs)     // produsul complet, nimic tăiat
    }
    const doc = readFileSync('docs/intrebari/MASCARE_SI_VERDICT.md', 'utf8')
    for (const f of r) expect(doc, f.familie).toContain(`\`${f.familie}\``)
    // r6 (review r5 P3): documentul declară domeniul EXACT — fiecare familie cu numărul ei de cazuri, plus totalul
    const cifre = n => n.toLocaleString('de-DE')
    for (const f of r) expect(doc, f.familie).toMatch(new RegExp('\\| `' + f.familie + '` \\|[^\\n]*\\| ' + cifre(f.produs).replace(/\./g, '\\.') + ' \\| ' + f.loturi + ' \\|'))
    expect(doc).toContain(`| **Total** | | **${cifre(r.reduce((s, f) => s + f.produs, 0))}** | **${r.reduce((s, f) => s + f.loturi, 0)}** |`)
  })
  it('r6 (review r5 P3): domeniul conține ce declară — fiecare formă juridică din contract (despărțită / lipită, cu / fără puncte), literele late încrucișate cu formele lipite, „SC”, flexiunile și invizibilele, persoanele alăturate', () => {
    for (const f of ['SRL', 'SA', 'PFA', 'II', 'IF', 'SNC', 'SCS']) {
      const p = f.split('').join('.') + '.'
      for (const v of [' ' + f, ' ' + p, '+' + f, '+' + p]) expect(G.FORME_JURIDICE, v).toContain(v)
    }
    expect(G.FORME_JURIDICE.length).toBe(37)
    const fam = n => G.FAMILII.find(x => x.nume === n).dims()
    const rep = fam('firme_reprezentare')
    expect(rep[1]).toEqual(['L', 'F'])
    for (const [i, d] of [[3, G.FORME_JURIDICE], [4, G.PREFIXE_SC], [5, G.FLEXIUNI], [6, G.INVIZIBILE]]) expect(rep[i]).toEqual(d)
    expect(fam('firme_nume_intreg')[2]).toEqual(G.FORME_JURIDICE)
    expect(fam('firme_componenta_singura')[1]).toEqual(G.REPREZENTARI)
    expect(G.lata('Varnitec S.R.L.')).toBe('Ｖａｒｎｉｔｅｃ Ｓ．Ｒ．Ｌ．')
    const { cazuri } = G.cazuriLot(G.loturi().find(l => l.familie === 'persoane_alaturate'))
    expect(cazuri.every(c => c.diferite && c.spatii.length === 2)).toBe(true)
    expect(cazuri.some(c => /vlădescu ana mare ion/.test(c.t))).toBe(true)          // fără separator, scrise mic (cazul recenzentului, în formă)
  })

  it('oracolul NU refolosește motorul: generativ.mjs nu are niciun import (static sau dinamic)', () => {
    const ast = parseAst(readFileSync('worker/intrebari-tehnice/generativ.mjs', 'utf8'))
    const tipuri = []
    const viziteaza = n => {
      if (!n || typeof n.type !== 'string') return
      tipuri.push(n.type)
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(viziteaza)
        else if (v && typeof v === 'object' && typeof v.type === 'string') viziteaza(v)
      }
    }
    viziteaza(ast)
    expect(tipuri.filter(t => /^Import|^ExportAll/.test(t))).toEqual([])
  })

  it('oracolul prinde fiecare clasă de defect: (a) interval nemascat sau mascat parțial / text atins în afara lui, (b) scurgere, (c) restaurare, (d) negativ schimbat', () => {
    const poz = { t: 'Ieri AlfaSRL a livrat marfa.', spatii: [[5, 12]], distinctive: [] }
    expect(G.verifica(poz, poz.t, poz.t)).toBe('interval_nemascat')                  // „AlfaSRL” n-are componentă distinctivă: (b) n-ar vedea nimic
    expect(G.verifica(poz, 'Ieri [FIRMA_1] a livrat marfa.', poz.t)).toBe(null)
    expect(G.verifica(poz, 'Ieri [FIRMA_1]SRL a livrat marfa.', poz.t)).toBe('in_afara_intervalului')
    expect(G.verifica(poz, '[FIRMA_1] [FIRMA_2] a livrat marfa.', poz.t)).toBe('in_afara_intervalului')
    expect(G.verifica(poz, 'Ieri [FIRMA_1] a livrat marfa.', 'Ieri Alfa SRL a livrat marfa.')).toBe('restaurare')
    const dist = { t: 'Ieri Lumivo Servicii SRL a livrat.', spatii: [[5, 24]], distinctive: ['lumivo'] }
    expect(G.verifica(dist, 'Ieri [FIRMA_1] a livrat.', dist.t)).toBe(null)
    expect(G.verifica({ ...dist, spatii: [[12, 24]] }, 'Ieri Lumivo [FIRMA_1] a livrat.', dist.t)).toBe('scurgere:lumivo')
    const neg = { t: 'Ieri Alfa a livrat marfa.', spatii: [], distinctive: [] }
    expect(G.verifica(neg, neg.t, neg.t)).toBe(null)
    expect(G.verifica(neg, 'Ieri [FIRMA_1] a livrat marfa.', neg.t)).toBe('negativ_schimbat')
    // (e) r6: două persoane diferite pe aceeași entitate (sau o „persoană” din patru cuvinte)
    const dif = { t: 'ana maria ion mare a venit.', spatii: [[0, 9], [10, 18]], distinctive: [], diferite: true }
    expect(G.verifica(dif, '[PERSOANA_1] [PERSOANA_2] a venit.', dif.t)).toBe(null)
    expect(G.verifica(dif, '[PERSOANA_1] [PERSOANA_1_F2] a venit.', dif.t)).toBe('aceeasi_entitate')
    expect(G.verifica(dif, '[PERSOANA_1] mare a venit.', dif.t)).toBe('interval_nemascat')
    expect(G.verifica({ ...dif, spatii: [[0, 18]] }, '[PERSOANA_1] a venit.', dif.t)).toBe(null)   // oracolul cere intervalele declarate de caz
  })

  it('eșantion direct pe modulul importat de vitest (fiecare al 97-lea indice din produsul fiecărei familii): zero eșecuri', () => {
    // r8: indicii se aleg din produs (G.cazuriIndici), fără să mai fie generat tot produsul doar ca să se ia fiecare al 97-lea caz
    const esecuri = []
    let n = 0
    for (const f of G.rezumat()) {
      const D = E.Dictionar.dinRaspuns(G.dictionarFamilie(f.familie))
      const { cazuri } = G.cazuriIndici(f.familie, Array.from({ length: Math.ceil(f.produs / 97) }, (_, k) => k * 97))
      for (const c of cazuri) {
        const m = new E.Mascare(D)
        if (c.invata) m.invata(c.t)
        const o = m.mascheaza(c.t, false)
        const v = G.verifica(c, o, m.demascheaza(o))
        n++
        if (v && esecuri.length < 10) esecuri.push({ v, t: c.t, o })
      }
    }
    expect(n).toBeGreaterThan(300000)
    expect(esecuri).toEqual([])
  }, 300000)

  it('r8: eșantionul acoperitor — familiile mici complet, la cele mari TOATE tripletele de valori pe oricare trei dimensiuni', () => {
    let total = 0
    for (const f of G.rezumat()) {
      const ix = G.indiciEsantion(f.familie), d = f.valori
      total += ix.length
      expect(ix.every((x, k) => Number.isInteger(x) && x >= 0 && x < f.produs && (k === 0 || x > ix[k - 1])), f.familie).toBe(true)
      if (f.produs <= G.LOT_MAX) { expect(ix.length, f.familie).toBe(f.produs); continue }       // familia mică: toate cazurile
      expect(G.ESANTION_COMPLET_PANA_LA).toBe(G.LOT_MAX)
      // fiecare triplet (dimensiuni a < b < c, valori va, vb, vc) apare în cel puțin un indice al eșantionului
      const cif = ix.map(i => cifreDin(d, i))
      for (let a = 0; a < d.length; a++) for (let b = a + 1; b < d.length; b++) for (let c = b + 1; c < d.length; c++) {
        const vazut = new Uint8Array(d[a] * d[b] * d[c])
        for (const x of cif) vazut[(x[a] * d[b] + x[b]) * d[c] + x[c]] = 1
        expect(vazut.every(v => v === 1), `${f.familie} dimensiunile ${a}, ${b}, ${c}`).toBe(true)
      }
      // familiile mari nu au combinații neaplicabile: fiecare indice al eșantionului e un caz real
      expect(G.cazuriIndici(f.familie, ix.filter((_, k) => k % 50 === 0)).excluse, f.familie).toBe(0)
    }
    expect(total).toBeGreaterThan(500000)
    expect(total).toBeLessThan(1000000)
  }, 120000)

  it('r8: ACELEAȘI cazuri ale eșantionului acoperitor în vitest (fire de lucru) și în procesul Node real (flagurile motor.py): zero eșecuri, aceeași amprentă pe fiecare lot', async () => {
    const F = await ambele(TOATE, 'esantion')
    for (const i of TOATE) {
      const l = LOTURI[i]
      const asteptat = G.indiciEsantion(l.familie).filter(x => x >= l.de_la && x < l.pana_la).length
      expect(F.get(i).cazuri + F.get(i).excluse, `lotul ${i}`).toBe(asteptat)
    }
    const total = [...F.values()].reduce((s, x) => s + x.cazuri, 0)
    expect(total + [...F.values()].reduce((s, x) => s + x.excluse, 0)).toBe(G.rezumat().reduce((s, f) => s + G.indiciEsantion(f.familie).length, 0))
    console.log(`matricea generativă (eșantion acoperitor): ${total} cazuri în ${TOATE.length} loturi (fire: ${K}, procese: ${K})`)
  }, 600000)

  it.runIf(COMPLET)('ACELEAȘI cazuri în vitest (fire de lucru) și în procesul Node real (flagurile motor.py): zero eșecuri, aceeași amprentă pe fiecare lot — PRODUSUL COMPLET (INTREBARI_GENERATIV_COMPLET=1)', async () => {
    const F = await ambele(PARTEA, 'complet')
    const total = [...F.values()].reduce((s, x) => s + x.cazuri, 0)
    const excluse = [...F.values()].reduce((s, x) => s + x.excluse, 0)
    expect(total + excluse).toBe(PARTEA.reduce((s, i) => s + LOTURI[i].pana_la - LOTURI[i].de_la, 0))
    if (PARTE.n === 1) expect(total + excluse).toBe(G.rezumat().reduce((s, f) => s + f.produs, 0))
    console.log(`matricea generativă (produsul complet, partea ${PARTE.s}/${PARTE.n}): ${total} cazuri în ${PARTEA.length} loturi (fire: ${K}, procese: ${K})`)
  }, 3600000)

  it('r8: jobul produsului complet există, rulează pe toate părțile și pornește pe orice PR care atinge un fișier de care depinde rezultatul', () => {
    const y = readFileSync(WORKFLOW, 'utf8').replace(/\r/g, '')
    // închiderea importurilor (statice, dinamice cu text fix, re-exporturi) a testului și a procesului, în repo
    const inchidere = new Set(), coada = ['src/intrebariMascare.generativ.test.js', relative(RAD, PROC).replace(/\\/g, '/')]
    while (coada.length) {
      const f = coada.pop()
      if (inchidere.has(f)) continue
      expect(existsSync(f), f).toBe(true)
      inchidere.add(f)
      if (f.endsWith('.json')) continue
      const surse = []
      const viziteaza = n => {
        if (!n || typeof n.type !== 'string') return
        if (/^(ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration|ImportExpression)$/.test(n.type) && n.source) {
          expect(n.source.type, `${f}: import cu sursă calculată`).toBe('Literal')
          surse.push(n.source.value)
        }
        for (const v of Object.values(n)) {
          if (Array.isArray(v)) v.forEach(viziteaza)
          else if (v && typeof v === 'object' && typeof v.type === 'string') viziteaza(v)
        }
      }
      viziteaza(parseAst(readFileSync(f, 'utf8')))
      for (const s of surse) if (s.startsWith('.')) coada.push(relative(RAD, resolve(dirname(f), s)).replace(/\\/g, '/'))
        else expect(/^(node:|vitest$|vite$)/.test(s), `${f}: pachet ${s} (se adaugă package*.json / calea lui în filtru)`).toBe(true)
    }
    expect(inchidere.has('src/intrebariMascare.js')).toBe(true)
    expect(inchidere.has('worker/intrebari-tehnice/generativ.mjs')).toBe(true)
    const pr = /\n {2}pull_request:\n {4}paths:\n((?: {6}- '[^']+'\n)+)/.exec(y)
    expect(pr, 'pull_request.paths').not.toBe(null)
    const cai = [...pr[1].matchAll(/'([^']+)'/g)].map(m => m[1])
    for (const f of [...inchidere, 'docs/intrebari/MASCARE_SI_VERDICT.md', WORKFLOW, 'package.json', 'package-lock.json']) expect(cai, f).toContain(f)
    expect(y).toMatch(/\n {2}schedule:\n {4}- cron: '[^']+'/)
    expect(y).toContain('\n  workflow_dispatch:')
    // părțile: matricea 0..N-1 și INTREBARI_GENERATIV_PARTE = „parte/N” cu același N → reuniunea părților = toate loturile
    const m = /\n {8}parte: \[([0-9, ]+)\]\n/.exec(y)
    expect(m, 'strategy.matrix.parte').not.toBe(null)
    const parti = m[1].split(',').map(x => Number(x.trim()))
    expect(parti).toEqual(parti.map((_, k) => k))
    expect(y).toContain(`INTREBARI_GENERATIV_PARTE: \${{ matrix.parte }}/${parti.length}\n`)
    expect(y).toContain("INTREBARI_GENERATIV_COMPLET: '1'\n")
    expect(y).toContain('fail-fast: false')
    expect(y).toMatch(/\n {8}run: npx vitest run src\/intrebariMascare\.generativ\.test\.js(?: --reporter=verbose)?\n/)   // fără -t / alt filtru
    expect(y).not.toMatch(/continue-on-error|if: /)
    // același Node ca jobul „verificare” care rulează npm test (rezultatul depinde de tabelele Unicode ale lui Node)
    const nodeVerificare = /node-version: '([0-9]+)'/.exec(readFileSync('.github/workflows/admin-alerte.yml', 'utf8'))[1]
    expect(y).toContain(`node-version: '${nodeVerificare}'`)
    // o parte invalidă oprește rularea (nu rulează în tăcere altceva)
    for (const s of ['4/4', '1', 'a/2', '0/0', '-1/2']) expect(() => parteDin(s), s).toThrow()
    expect(parteDin('3/4')).toEqual({ s: 3, n: 4 })
    expect(parteDin(undefined)).toEqual({ s: 0, n: 1 })
  })
})
