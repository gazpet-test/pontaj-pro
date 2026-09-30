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

// ════════════════════════════════════════════════════════════════
// R3 (după NO-GO Copilot pe validarea cap-coadă): validare intrări, conflicte anterioare tranșei,
// snapshot comun cu client Supabase mock (aceleași rânduri → export / save / BT aceleași sume).
// ════════════════════════════════════════════════════════════════
import { vi } from 'vitest'
import { incarcaSnapshotDiurne, alocaDinSnapshot, platitAnteriorPeLuni, rezumatAlocare, valideazaIntrariDiurne, LIMITA_PAGINARE } from './diurneAlocare.js'

describe('validarea intrărilor (throw cu mesaj clar)', () => {
  const recs = recsDin([{ id: 1, diurna: ['2026-09-01'], norme: {} }])
  const call = (o) => () => alocaDiurneTransa({ recsLuna: recs, df: '2026-09-01', dt: '2026-09-04', legalSet: LEGAL, diurnaAmt: AMT, ...o })
  it('tarif invalid: undefined / null / "" / "abc" / -50 / Infinity / 0 → throw', () => {
    for (const bad of [undefined, null, '', 'abc', -50, Infinity, 0, NaN, '0']) expect(call({ diurnaAmt: bad }), String(bad)).toThrow(/Tarif diurnă invalid/)
    expect(call({ diurnaAmt: '50' })().get(1).sumaDiurna).toBe(50)   // string numeric din settings e acceptat
  })
  it('interval inversat sau date invalide → throw', () => {
    expect(call({ df: '2026-09-10', dt: '2026-09-04' })).toThrow(/Interval inversat/)
    expect(call({ df: '2026-13-01' })).toThrow(/Interval invalid/)
    expect(call({ df: undefined })).toThrow(/Interval invalid/)
    expect(call({ dt: '04.09.2026' })).toThrow(/Interval invalid/)
  })
  it('calendar neîncărcat (undefined/null/array) ≠ „fără sărbători" → throw; Set gol e explicit OK', () => {
    expect(call({ legalSet: undefined })).toThrow(/Calendarul/)
    expect(call({ legalSet: null })).toThrow(/Calendarul/)
    expect(call({ legalSet: [] })).toThrow(/Calendarul/)
    expect(call({ legalSet: new Set() })().get(1).C).toBe(22)
    expect(valideazaIntrariDiurne({ df: '2026-09-01', dt: '2026-09-01', legalSet: new Set(), diurnaAmt: 50 })).toBe(50)
  })
})

describe('conflict CO + diurnă ANTERIOR tranșei', () => {
  it('CO+diurnă pe 01.09 cu tranșa 26–30 → în deVerificatAnterior, nu în deVerificat', () => {
    const e = { id: 7, diurna: ['2026-09-01', '2026-09-28'], norme: { '2026-09-01': 'CO' } }
    const r = aloca('2026-09-26', '2026-09-30', recsDin([e])).get(7)
    expect(r.deVerificatAnterior).toEqual(['2026-09-01'])
    expect(r.deVerificat).toEqual([])
    // ziua de CO scade plafonul (C=21) și tot consumă ca bifă anterioară (B=1) — de asta se semnalează
    expect(r).toMatchObject({ C: 21, B: 1, N: 1, zileDiurna: 1 })
    // aceeași zi, dar tranșa o cuprinde → deVerificat
    const r2 = aloca('2026-09-01', '2026-09-04', recsDin([e])).get(7)
    expect(r2.deVerificat).toEqual(['2026-09-01']); expect(r2.deVerificatAnterior).toEqual([])
  })
})

// ── Client Supabase mock: tabele în memorie + lanțul select/or/in/gte/lte/range/order, awaitable ──
function mockSupabase(tables, { fail = {}, limitPage = 1000 } = {}) {
  const calls = []
  const build = (t) => {
    const f = { gte: [], lte: [], in: [], or: null, range: null, order: null, select: '*' }
    const q = {
      select(c) { f.select = c; return q },
      gte(col, v) { f.gte.push([col, v]); return q },
      lte(col, v) { f.lte.push([col, v]); return q },
      in(col, v) { f.in.push([col, new Set(v)]); return q },
      or(expr) { f.or = expr; return q },
      order(col) { f.order = col; return q },
      range(a, b) { f.range = [a, b]; return q },
      then(res, rej) {
        calls.push({ t, ...f })
        if (fail[t]) return Promise.resolve({ data: null, error: { message: fail[t] } }).then(res, rej)
        let rows = (tables[t] || []).slice()
        for (const [c, v] of f.gte) rows = rows.filter(r => r[c] >= v)
        for (const [c, v] of f.lte) rows = rows.filter(r => r[c] <= v)
        for (const [c, set] of f.in) rows = rows.filter(r => set.has(r[c]))
        if (f.or) { // 'active.eq.true,termination_date.gte.YYYY-MM-DD'
          const m = f.or.match(/^active\.eq\.true,termination_date\.gte\.(\S+)$/)
          rows = rows.filter(r => r.active === true || (r.termination_date && r.termination_date >= m[1]))
        }
        if (f.order) rows.sort((a, b) => String(a[f.order]).localeCompare(String(b[f.order])))
        if (f.range) rows = rows.slice(f.range[0], Math.min(f.range[1] + 1, f.range[0] + limitPage))
        return Promise.resolve({ data: rows, error: null }).then(res, rej)
      },
    }
    return q
  }
  return { from: build, calls }
}
const SETTINGS = [{ key: 'diurna_amount', value: '50' }, { key: 'iban_firma', value: 'RO00TEST' }]
const empsFx = FX.employees.map(e => ({ id: e.id, name: e.name, active: true, termination_date: null, site_id: 1 }))
const pontajFx = RECS.map((r, i) => ({ id: i + 1, ...r, site_id: 1 }))
const T5 = { df: '2026-09-26', dt: '2026-09-30' }

describe('incarcaSnapshotDiurne — adaptorul comun al celor 3 fluxuri (Supabase mock)', () => {
  it('aceleași rânduri → export / savePayment / BT produc aceleași sume (Tharindu 133: 50 diurnă / 150 salariu)', async () => {
    const sb = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: empsFx, pontaj_records: pontajFx })
    // export citește '*,sites(name)', save/BT doar coloanele alocării — aceleași sume
    const sExport = await incarcaSnapshotDiurne(sb, { ...T5, recsSelect: '*,sites(name)' })
    const sSave = await incarcaSnapshotDiurne(sb, { ...T5 })
    const sBT = await incarcaSnapshotDiurne(sb, { ...T5, siteIds: [1] })
    expect(sSave.diurnaAmt).toBe(50); expect(sSave.emps.length).toBe(84); expect(sSave.recs.length).toBe(RECS.length)
    expect(sSave.monthStart).toBe('2026-09-01'); expect(sSave.monthEnd).toBe('2026-09-30')
    const [aE, aS, aB] = [sExport, sSave, sBT].map(alocaDinSnapshot)
    for (const id of [64, 133, 69, 129]) { expect(aS.get(id)).toEqual(aE.get(id)); expect(aB.get(id)).toEqual(aE.get(id)) }
    expect(aS.get(133)).toMatchObject({ sumaDiurna: 50, sumaSalariu: 150 })
    // ce salvează savePayment (zileDiurna × tarif) == ce trimite BT (sumaDiurna) == „Diurnă Max. Admisă" din export
    const save = [...aS].filter(([, a]) => a.N > 0).map(([id, a]) => [id, a.zileDiurna * sSave.diurnaAmt])
    const bt = [...aB].filter(([, a]) => a.N > 0).map(([id, a]) => [id, a.sumaDiurna])
    expect(bt).toEqual(save)
    // pontajul s-a citit pe LUNA ÎNTREAGĂ, cu paginare
    const pag = sb.calls.filter(c => c.t === 'pontaj_records')
    expect(pag.every(c => c.gte[0][1] === '2026-09-01' && c.lte[0][1] === '2026-09-30')).toBe(true)
    expect(pag.length).toBeGreaterThan(3)   // 3 fluxuri × ≥1 pagină (fixture-ul are >1000 rânduri → ≥2 pagini fiecare)
    // rezumatul pentru confirmarea de salvare
    const rz = rezumatAlocare(aS, sSave.emps)
    expect(rz.angajati).toBeGreaterThan(0)
    expect(rz.sumaDiurna).toBe(save.reduce((s, [, v]) => s + v, 0))
    expect(rz.sumaSalariu).toBe([...aS.values()].reduce((s, a) => s + a.sumaSalariu, 0))
    expect(rz.conflicte + rz.conflicteAnterior).toBe([...aS.values()].filter(a => a.N > 0 && (a.deVerificat.length || a.deVerificatAnterior.length)).length)
  })
  it('citire eșuată (angajați / pontaj / calendar / settings) → throw, nu continuare cu []', async () => {
    const base = { settings: SETTINGS, calendar_days: [], employees: empsFx, pontaj_records: pontajFx }
    for (const [t, re] of [['employees', /angajații/], ['pontaj_records', /pontajul/], ['calendar_days', /calendarul/], ['settings', /setările/]]) {
      const sb = mockSupabase(base, { fail: { [t]: 'boom ' + t } })
      await expect(incarcaSnapshotDiurne(sb, T5), t).rejects.toThrow(re)
    }
    // setarea diurna_amount lipsă / invalidă → throw
    await expect(incarcaSnapshotDiurne(mockSupabase({ ...base, settings: [] }), T5)).rejects.toThrow(/diurna_amount/)
    await expect(incarcaSnapshotDiurne(mockSupabase({ ...base, settings: [{ key: 'diurna_amount', value: 'abc' }] }), T5)).rejects.toThrow(/Tarif diurnă invalid/)
    await expect(incarcaSnapshotDiurne(mockSupabase(base), { df: '2026-09-30', dt: '2026-09-26' })).rejects.toThrow(/Interval inversat/)
  })
  it('paginarea oprită la limită → throw (nu rezultat trunchiat)', async () => {
    const multe = Array.from({ length: LIMITA_PAGINARE + 2001 }, (_, i) => ({ id: i, employee_id: 1, date: '2026-09-01', diurna: true, norma: null }))
    const sb = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: [{ id: 1, name: 'X', active: true }], pontaj_records: multe })
    await expect(incarcaSnapshotDiurne(sb, T5)).rejects.toThrow(/limita de paginare/)
  })
  it('snapshot limitat la tranșă (doar bifele din T5 pentru Tharindu) → 200/0 în loc de 50/150: de asta luna întreagă e obligatorie', () => {
    const doarT5 = pontajFx.filter(r => r.employee_id === 133 && r.date >= T5.df && r.date <= T5.dt)
    const gresit = alocaDiurneTransa({ recsLuna: doarT5, ...T5, legalSet: LEGAL, diurnaAmt: 50 }).get(133)
    expect(gresit).toMatchObject({ B: 0, C: 22, sumaDiurna: 200, sumaSalariu: 0 })   // nu vede CO-ul (C) și nici bifele anterioare (B)
    const corect = alocaDiurneTransa({ recsLuna: pontajFx.filter(r => r.employee_id === 133), ...T5, legalSet: LEGAL, diurnaAmt: 50 }).get(133)
    expect(corect).toMatchObject({ B: 16, C: 17, sumaDiurna: 50, sumaSalariu: 150 })
  })
  it('tranșă 26.09–02.10 salvată, apoi tranșa următoare de octombrie → cei 100 lei din 01–02.10 sunt ai lunii octombrie în reconciliere', async () => {
    const sept = Array.from({ length: 22 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
    const zile = [...sept, '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06']
    const pontaj = zile.map((d, i) => ({ id: i, employee_id: 1, date: d, diurna: true, norma: null }))
    const sb = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: [{ id: 1, name: 'X', active: true }], pontaj_records: pontaj })
    // 1) tranșa 26.09–02.10: 0 zile în sept (plafon atins), 2 în oct → se salvează 100 lei
    const s1 = await incarcaSnapshotDiurne(sb, { df: '2026-09-26', dt: '2026-10-02' })
    const a1 = alocaDinSnapshot(s1).get(1)
    expect(a1).toMatchObject({ sumaDiurna: 100, sumaSalariu: 250 })
    const platit = { id: 90, period_from: '2026-09-26', period_to: '2026-10-02', diurna_payment_details: [{ employee_id: 1, amount: a1.sumaDiurna }] }
    // 2) tranșa următoare, 03–09.10: snapshotul se extinde de la 26.09 (luna plății reconciliate) ca să recalculeze segmentele ei
    const s2 = await incarcaSnapshotDiurne(sb, { df: '2026-10-03', dt: '2026-10-09', extindeDeLa: platit.period_from })
    expect(s2.monthStart).toBe('2026-09-01'); expect(s2.monthStartTransa).toBe('2026-10-01')
    const a2 = alocaDinSnapshot(s2).get(1)
    expect(a2).toMatchObject({ B: 2, N: 2, sumaDiurnaAnterior: 100, zileDiurna: 2 })
    const pl = platitAnteriorPeLuni({ plati: [platit], recsLuna: s2.recs, df: '2026-10-03', dt: '2026-10-09', legalSet: s2.legalSet, diurnaAmt: s2.diurnaAmt })
    expect(pl.get(1)).toBe(100)                       // partea de octombrie a plății 26.09–02.10
    expect(pl.get(1) - a2.sumaDiurnaAnterior).toBe(0) // diferență înregistrat − recalculat = 0
    // plată într-o singură lună: suma înregistrată intră întreagă; plată de după df nu se ia; diferența de sumă rămâne în luna de start
    const doarSept = { period_from: '2026-09-19', period_to: '2026-09-25', diurna_payment_details: [{ employee_id: 1, amount: 350 }] }
    expect(platitAnteriorPeLuni({ plati: [doarSept, platit], recsLuna: s2.recs, df: '2026-10-03', dt: '2026-10-09', legalSet: s2.legalSet, diurnaAmt: 50 }).get(1)).toBe(100)
    expect(platitAnteriorPeLuni({ plati: [doarSept], recsLuna: s2.recs, df: '2026-09-26', dt: '2026-09-30', legalSet: s2.legalSet, diurnaAmt: 50 }).get(1)).toBe(350)
    // 50 lei în plus înregistrați în plata pornită în septembrie → rămân în septembrie (luna de start), nu ajung în reconcilierea lui octombrie
    const inregistratGresit = { ...platit, diurna_payment_details: [{ employee_id: 1, amount: 150 }] }
    expect(platitAnteriorPeLuni({ plati: [inregistratGresit], recsLuna: s2.recs, df: '2026-10-03', dt: '2026-10-09', legalSet: s2.legalSet, diurnaAmt: 50 }).get(1)).toBe(100)
  })
})
