// Alocarea diurnelor pe plafonul lunar (regula Răzvan, 30.09.2026) — verificată pe fixture-ul
// extras read-only din BD pentru septembrie 2026 (test-fixtures/diurne_sept_2026.json, fără CNP/IBAN).
import { describe, it, expect } from 'vitest'
import { alocaDiurneTransa, segmenteLunare, zileLucratoareLuna } from './diurneAlocare.js'
import FX from '../test-fixtures/diurne_sept_2026.json'

const AMT = FX.diurna_amount
const LEGAL = new Set(FX.legal)
const TRANSE = FX.transe
// înregistrări de pontaj în forma din BD: câte un rând pe zi (diurnă și/sau normă)
const recsDin = (emps) => {
  const recs = []
  for (const e of emps) {
    const zile = new Set([...e.diurna, ...Object.keys(e.norme)])
    for (const d of zile) recs.push({ employee_id: e.id, date: d, diurna: e.diurna.includes(d), norma: e.norme[d] || null })
  }
  return recs
}
const RECS = recsDin(FX.employees)
const aloca = (df, dt, recs = RECS) => alocaDiurneTransa({ recsLuna: recs, df, dt, legalSet: LEGAL, diurnaAmt: AMT })
const surplusPeTranse = (id, recs = RECS) => TRANSE.map(([df, dt]) => aloca(df, dt, recs).get(id)?.sumaSalariu || 0)

// Regula de referință (verif_diurne.py, varianta „LL nu scade"): plafon = zile lucr. − CO pe zile lucr.,
// toate bifele consumă plafonul cronologic, surplusul în tranșa unde se depășește.
const referinta = (e) => {
  const zl = new Set(zileLucratoareLuna('2026-09-01', LEGAL))
  const plafon = zl.size - Object.entries(e.norme).filter(([d, n]) => n === 'CO' && zl.has(d)).length
  let consumat = 0
  return TRANSE.map(([df, dt]) => {
    const n = e.diurna.filter(d => d >= df && d <= dt).length
    const platibile = Math.max(0, Math.min(n, plafon - consumat)); consumat += n
    return { plafon, n, diurna: platibile, salariu: n - platibile }
  })
}

describe('septembrie 2026 — fixture real', () => {
  it('(1) Matei 64 / Tharindu 133 / Mititelu Paul 69: surplus la salariu 50 / 150 / 200 lei, doar în tranșa 26–30', () => {
    expect(surplusPeTranse(64)).toEqual([0, 0, 0, 0, 50])
    expect(surplusPeTranse(133)).toEqual([0, 0, 0, 0, 150])
    expect(surplusPeTranse(69)).toEqual([0, 0, 0, 0, 200])
    // plafoanele lor: 22 − 10 CO = 12, 22 − 5 = 17, 22 − 10 = 12
    const t5 = aloca('2026-09-26', '2026-09-30')
    expect(t5.get(64).C).toBe(12); expect(t5.get(133).C).toBe(17); expect(t5.get(69).C).toBe(12)
    // tranșa 26–30 la Tharindu: 4 bifate, 1 diurnă + 3 salariu
    expect(t5.get(133)).toMatchObject({ N: 4, zileDiurna: 1, zileSalariu: 3, sumaDiurna: 50, sumaSalariu: 150 })
  })
  it('(1b) aceeași alocare indiferent de apelant (export / savePayment / BT primesc aceleași intrări)', () => {
    const a = aloca('2026-09-26', '2026-09-30'), b = aloca('2026-09-26', '2026-09-30'), c = aloca('2026-09-26', '2026-09-30')
    for (const id of [64, 133, 69]) { expect(b.get(id)).toEqual(a.get(id)); expect(c.get(id)).toEqual(a.get(id)) }
  })
  it('(2) toți cei 84 de angajați: identic cu regula de referință pe toate cele 5 tranșe', () => {
    let identici = 0
    for (const e of FX.employees) {
      const ref = referinta(e)
      const got = TRANSE.map(([df, dt]) => { const r = aloca(df, dt).get(e.id); return { plafon: r ? r.C : ref[0].plafon, n: r?.N || 0, diurna: r?.zileDiurna || 0, salariu: r?.zileSalariu || 0 } })
      expect(got, e.name).toEqual(ref)
      identici++
    }
    expect(identici).toBe(84)
    // doar 3 au surplus față de vechiul savePayment (bugetul fix de 22 zile): 64, 133, 69
    const cuSurplusNou = FX.employees.filter(e => { const s = surplusPeTranse(e.id).reduce((a, b) => a + b, 0); const vechi = Math.max(0, e.diurna.length - 22) * AMT; return s !== vechi }).map(e => e.id).sort((a, b) => a - b)
    expect(cuSurplusNou).toEqual([64, 69, 133])
  })
  it('(2b) reconciliere: sumaDiurnaAnterior = ce s-a plătit efectiv în 82–85 pentru 80 de angajați; diferă la cei 3 cu încetare (17/57/166, excluși de vechiul filtru active=true) și la Mitrache 71 (tranșa 83 nesalvată)', () => {
    const t5 = aloca('2026-09-26', '2026-09-30')
    const diferente = []
    for (const e of FX.employees) {
      const platit = Object.values(FX.saved[e.id] || {}).reduce((s, x) => s + x.amount, 0)
      const r = t5.get(e.id)
      const asteptat = r ? r.sumaDiurnaAnterior : 0
      if (platit !== asteptat) diferente.push([e.id, platit, asteptat])
    }
    expect(diferente).toEqual([[17, 0, 450], [57, 700, 1050], [71, 400, 700], [166, 450, 650]])
  })
  it('(4) Verbal 129: 30 bife → 22 diurnă + 8 salariu, 150 lei T4 + 250 lei T5, independent de împărțirea în tranșe', () => {
    expect(surplusPeTranse(129)).toEqual([0, 0, 0, 150, 250])
    const peTranse = TRANSE.map(([df, dt]) => aloca(df, dt).get(129))
    expect(peTranse.reduce((s, r) => s + r.zileDiurna, 0)).toBe(22)
    expect(peTranse.reduce((s, r) => s + r.zileSalariu, 0)).toBe(8)
    const luna = aloca('2026-09-01', '2026-09-30').get(129)
    expect(luna).toMatchObject({ N: 30, zileDiurna: 22, zileSalariu: 8, sumaDiurna: 1100, sumaSalariu: 400 })
    // altă împărțire (două jumătăți) — aceleași totaluri
    const j1 = aloca('2026-09-01', '2026-09-15').get(129), j2 = aloca('2026-09-16', '2026-09-30').get(129)
    expect(j1.zileDiurna + j2.zileDiurna).toBe(22); expect(j1.zileSalariu + j2.zileSalariu).toBe(8)
  })
})

describe('reguli sintetice', () => {
  const emp = (id, diurna, norme = {}) => ({ id, diurna, norme })
  const TOT = zileLucratoareLuna('2026-09-01', LEGAL).length // 22
  const C_de = (e) => aloca('2026-09-01', '2026-09-30', recsDin([e])).get(e.id).C
  it('(3) LL pe zi lucrătoare, CO pe weekend, CM/BO pe zile lucrătoare — nu schimbă C; CO pe zi lucrătoare îl scade', () => {
    expect(TOT).toBe(22)
    expect(C_de(emp(1, ['2026-09-01'], { '2026-09-11': 'LL', '2026-09-25': 'LL' }))).toBe(22)
    expect(C_de(emp(1, ['2026-09-01'], { '2026-09-05': 'CO', '2026-09-06': 'CO' }))).toBe(22)
    expect(C_de(emp(1, ['2026-09-01'], { '2026-09-07': 'CM', '2026-09-08': 'BO', '2026-09-09': 'CFP' }))).toBe(22)
    expect(C_de(emp(1, ['2026-09-01'], { '2026-09-07': 'CO', '2026-09-08': 'CO' }))).toBe(20)
    // sărbătoare legală într-o zi de luni scade zilele lucrătoare, iar un CO pe sărbătoare nu mai scade nimic
    const r = alocaDiurneTransa({ recsLuna: recsDin([emp(1, ['2026-09-01'], { '2026-09-07': 'CO' })]), df: '2026-09-01', dt: '2026-09-30', legalSet: new Set(['2026-09-07']), diurnaAmt: AMT })
    expect(r.get(1).C).toBe(21)
  })
  it('(5) tranșă peste 1 ale lunii (26.09–02.10): fiecare zi se alocă în luna ei', () => {
    // septembrie plin (22 zile bifate 1–22 → plafon atins), plus 26–30.09 și 01–02.10
    const sept = Array.from({ length: 22 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
    const e = emp(1, [...sept, '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
    expect(segmenteLunare('2026-09-26', '2026-10-02')).toEqual([{ df: '2026-09-26', dt: '2026-09-30' }, { df: '2026-10-01', dt: '2026-10-02' }])
    const r = aloca('2026-09-26', '2026-10-02', recsDin([e])).get(1)
    expect(r.segmente).toEqual([
      { luna: '2026-09', C: 22, B: 22, N: 5, zileDiurna: 0, zileSalariu: 5 },
      { luna: '2026-10', C: 22, B: 0, N: 2, zileDiurna: 2, zileSalariu: 0 },
    ])
    expect(r).toMatchObject({ N: 7, zileDiurna: 2, zileSalariu: 5, sumaDiurna: 100, sumaSalariu: 250, sumaDiurnaAnterior: 1100 })
  })
  it('(6) plafon 0, atingere exactă, depășire cu o zi: sume nenegative, total conservat', () => {
    const zl = zileLucratoareLuna('2026-09-01', LEGAL)
    const coTot = Object.fromEntries(zl.map(d => [d, 'CO']))
    const r0 = aloca('2026-09-05', '2026-09-06', recsDin([emp(1, ['2026-09-05', '2026-09-06'], coTot)])).get(1)
    expect(r0).toMatchObject({ C: 0, N: 2, zileDiurna: 0, zileSalariu: 2, sumaDiurna: 0, sumaSalariu: 100 })
    // exact 22 bifate → tot diurnă; 23 → una la salariu, în tranșa în care se depășește
    const ex = emp(2, zl)
    const rex = aloca('2026-09-01', '2026-09-30', recsDin([ex])).get(2)
    expect(rex).toMatchObject({ zileDiurna: 22, zileSalariu: 0 })
    const peste = emp(3, [...zl, '2026-09-26'])
    const t1 = aloca('2026-09-01', '2026-09-25', recsDin([peste])).get(3), t2 = aloca('2026-09-26', '2026-09-30', recsDin([peste])).get(3)
    expect(t1).toMatchObject({ zileDiurna: 19, zileSalariu: 0 })
    expect(t2).toMatchObject({ B: 19, N: 4, zileDiurna: 3, zileSalariu: 1, sumaDiurna: 150, sumaSalariu: 50 })
    for (const r of [r0, rex, t1, t2]) {
      expect(r.zileDiurna).toBeGreaterThanOrEqual(0); expect(r.zileSalariu).toBeGreaterThanOrEqual(0)
      expect(r.zileDiurna + r.zileSalariu).toBe(r.N); expect(r.sumaDiurna + r.sumaSalariu).toBe(r.N * AMT)
    }
  })
  it('(7) o zi pe două șantiere = o singură zi (și în B, și în N)', () => {
    const recs = [
      { employee_id: 1, date: '2026-09-01', diurna: true, norma: null, site_id: 1 },
      { employee_id: 1, date: '2026-09-01', diurna: true, norma: null, site_id: 2 },
      { employee_id: 1, date: '2026-09-02', diurna: true, norma: null, site_id: 1 },
      { employee_id: 1, date: '2026-09-02', diurna: true, norma: null, site_id: 2 },
    ]
    expect(aloca('2026-09-02', '2026-09-02', recs).get(1)).toMatchObject({ B: 1, N: 1, zileDiurna: 1 })
    expect(aloca('2026-09-01', '2026-09-02', recs).get(1)).toMatchObject({ B: 0, N: 2, zileDiurna: 2 })
  })
  it('zi cu CO și diurnă bifată simultan → semnalată în deVerificat, nu rezolvată automat', () => {
    const r = aloca('2026-09-01', '2026-09-04', recsDin([emp(1, ['2026-09-01', '2026-09-02'], { '2026-09-02': 'CO' })])).get(1)
    expect(r.deVerificat).toEqual(['2026-09-02'])
    expect(r).toMatchObject({ C: 21, N: 2, zileDiurna: 2 })
  })
})
