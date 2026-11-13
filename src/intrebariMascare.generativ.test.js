import { describe, it, expect } from 'vitest'
import { parseAst } from 'vite'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import { join, resolve } from 'node:path'
import * as E from './intrebariMascare.js'
import * as G from '../worker/intrebari-tehnice/generativ.mjs'

// Criteriul de acceptare r5 (L25): matricea GENERATIVĂ pe produsul complet al dimensiunilor contractului, pe domeniul finit și
// publicat din worker/intrebari-tehnice/generativ.mjs (și docs/intrebari/MASCARE_SI_VERDICT.md, „Matricea generativă”).
// ACELEAȘI loturi rulează:
//   (1) în vitest: pe fire de lucru (worker_threads) pornite de acest test, plus un eșantion direct pe modulul importat aici;
//   (2) în procesul Node REAL, cu flagurile din motor.py (--permission, citire doar din repo, fără generare de cod din text).
// Pe fiecare lot: zero eșecuri ale oracolului în ambele rulări și ACEEAȘI amprentă sha256 a ieșirilor. Date INVENTATE.
const RAD = resolve('.')
const PROC = join(RAD, 'worker/intrebari-tehnice/generativ_proces.mjs')
const LOTURI = G.loturi()
const K = Math.max(2, Math.min(8, cpus().length - 2))
const imparte = idx => Array.from({ length: K }, (_, k) => idx.filter((_, j) => j % K === k)).filter(b => b.length)
const TOATE = LOTURI.map((_, i) => i)

function peFire() {
  return Promise.all(imparte(TOATE).map(indici => new Promise((ok, nu) => {
    const w = new Worker(PROC, { workerData: { indici } })
    w.once('message', ok); w.once('error', nu)
    w.once('exit', c => { if (c !== 0) nu(new Error(`fir oprit cu ${c}`)) })
  }))).then(x => x.flat())
}
function inProcese() {
  return Promise.all(imparte(TOATE).map(indici => new Promise((ok, nu) => {
    const p = spawn(process.execPath, ['--permission', `--allow-fs-read=${RAD}`, '--disallow-code-generation-from-strings', PROC, JSON.stringify(indici)],
      { env: {} })
    let out = '', err = ''
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
    p.on('close', c => c === 0 ? ok(JSON.parse(out)) : nu(new Error(`proces ${c}: ${err.slice(0, 500)}`)))
  }))).then(x => x.flat())
}

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

  it('eșantion direct pe modulul importat de vitest (fiecare al 97-lea caz din fiecare lot): zero eșecuri', () => {
    const esecuri = []
    let n = 0
    for (const l of LOTURI) {
      const D = E.Dictionar.dinRaspuns(G.dictionarFamilie(l.familie))
      const { cazuri } = G.cazuriLot(l)
      for (let i = 0; i < cazuri.length; i += 97) {
        const c = cazuri[i], m = new E.Mascare(D)
        if (c.invata) m.invata(c.t)
        const o = m.mascheaza(c.t, false)
        const v = G.verifica(c, o, m.demascheaza(o))
        n++
        if (v && esecuri.length < 10) esecuri.push({ v, t: c.t, o })
      }
    }
    expect(n).toBeGreaterThan(60000)
    expect(esecuri).toEqual([])
  }, 300000)

  it('ACELEAȘI cazuri în vitest (fire de lucru) și în procesul Node real (flagurile motor.py): zero eșecuri, aceeași amprentă pe fiecare lot', async () => {
    const [fire, procese] = await Promise.all([peFire(), inProcese()])
    const pe = r => new Map(r.map(x => [x.i, x]))
    const F = pe(fire), P = pe(procese)
    expect([...F.keys()].sort((a, b) => a - b)).toEqual(TOATE)
    expect([...P.keys()].sort((a, b) => a - b)).toEqual(TOATE)
    const esecuri = [...F.values(), ...P.values()].filter(x => x.esecuri).map(x => ({ familie: x.familie, lot: x.lot, esecuri: x.esecuri, primele: x.primele.slice(0, 3) }))
    expect(esecuri).toEqual([])
    for (const i of TOATE) expect([P.get(i).cazuri, P.get(i).sha256], `lotul ${i}`).toEqual([F.get(i).cazuri, F.get(i).sha256])
    const total = [...F.values()].reduce((s, x) => s + x.cazuri, 0)
    const excluse = [...F.values()].reduce((s, x) => s + x.excluse, 0)
    expect(total + excluse).toBe(G.rezumat().reduce((s, f) => s + f.produs, 0))
    console.log(`matricea generativă: ${total} cazuri în ${TOATE.length} loturi (fire: ${K}, procese: ${K})`)
  }, 900000)
})
