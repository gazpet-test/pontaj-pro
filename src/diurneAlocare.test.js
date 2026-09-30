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
import { incarcaSnapshotDiurne, alocaDinSnapshot, platitAnteriorPeLuni, diferentaInregistratRecalculat, rezumatAlocare, valideazaIntrariDiurne, LIMITA_PAGINARE, PAGINA_PONTAJ } from './diurneAlocare.js'
import { alocareDinSnapshot, construiestePayloadPlata, construiesteRanduriBT, construiesteRanduriExport, textDeVerificat, bicDinIban } from './diurneFlux.js'

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

describe('conflict CO + diurnă ULTERIOR tranșei, în aceeași lună', () => {
  it('22 bife până la 25.09 + CO+diurnă pe 30.09 cu tranșa 01–25.09 → în deVerificatUlterior; C scade la 21, nu se rezolvă automat', () => {
    const zl = zileLucratoareLuna('2026-09-01', LEGAL).filter(d => d <= '2026-09-25')   // 19 zile lucr. până la 25
    const bife = [...zl, '2026-09-05', '2026-09-06', '2026-09-12'].slice(0, 22)            // 22 bife distincte ≤ 25.09
    const e = { id: 9, diurna: [...bife, '2026-09-30'], norme: { '2026-09-30': 'CO' } }
    const r = aloca('2026-09-01', '2026-09-25', recsDin([e])).get(9)
    expect(r.deVerificatUlterior).toEqual(['2026-09-30'])
    expect(r.deVerificat).toEqual([]); expect(r.deVerificatAnterior).toEqual([])
    expect(r).toMatchObject({ C: 21, B: 0, N: 22, zileDiurna: 21, zileSalariu: 1 })   // CO-ul de pe 30 scade plafonul tranșei
    expect(rezumatAlocare(new Map([[9, r]]), [{ id: 9 }])).toMatchObject({ conflicte: 0, conflicteAnterior: 0, conflicteUlterior: 1 })
    expect(textDeVerificat(r)).toBe('ult.: 30.09')
    // fără CO pe 30 → niciun conflict, C=22
    const r2 = aloca('2026-09-01', '2026-09-25', recsDin([{ ...e, norme: {} }])).get(9)
    expect(r2.deVerificatUlterior).toEqual([]); expect(r2.C).toBe(22)
  })
})

// ── Client Supabase mock: tabele în memorie + lanțul select/or/in/gte/lte/range/order (înlănțuit), count/head ──
// limitPage = mărimea MAXIMĂ de pagină pe care o servește serverul (PostgREST max-rows) — se respectă range-ul cerut,
// dar nu mai mult de limitPage rânduri per răspuns.
function mockSupabase(tables, { fail = {}, limitPage = 1000 } = {}) {
  const calls = [], sortCache = new Map()
  const build = (t) => {
    const f = { gte: [], lte: [], in: [], or: null, range: null, order: [], select: '*', count: null, head: false }
    const q = {
      select(c, o) { f.select = c; if (o) { f.count = o.count || null; f.head = !!o.head } return q },
      gte(col, v) { f.gte.push([col, v]); return q },
      lte(col, v) { f.lte.push([col, v]); return q },
      in(col, v) { f.in.push([col, new Set(v)]); return q },
      or(expr) { f.or = expr; return q },
      order(col) { f.order.push(col); return q },
      range(a, b) { f.range = [a, b]; return q },
      then(res, rej) {
        calls.push({ t, ...f })
        if (fail[t]) return Promise.resolve({ data: null, error: { message: fail[t] }, count: null }).then(res, rej)
        let rows = (tables[t] || []).slice()
        for (const [c, v] of f.gte) rows = rows.filter(r => r[c] >= v)
        for (const [c, v] of f.lte) rows = rows.filter(r => r[c] <= v)
        for (const [c, set] of f.in) rows = rows.filter(r => set.has(r[c]))
        if (f.or) { // 'active.eq.true,termination_date.gte.YYYY-MM-DD'
          const m = f.or.match(/^active\.eq\.true,termination_date\.gte\.(\S+)$/)
          rows = rows.filter(r => r.active === true || (r.termination_date && r.termination_date >= m[1]))
        }
        const total = rows.length
        if (f.head) return Promise.resolve({ data: null, error: null, count: f.count ? total : null }).then(res, rej)
        if (f.order.length) {   // sortare stabilă pe cheile cerute; cache per tabel+chei+număr de rânduri (200k rânduri × 200 pagini)
          const k = `${t}|${f.order.join(',')}|${total}`
          if (!sortCache.has(k)) { for (const c of [...f.order].reverse()) rows.sort((a, b) => a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0); sortCache.set(k, rows) }
          rows = sortCache.get(k)
        }
        if (f.range) rows = rows.slice(f.range[0], Math.min(f.range[1] + 1, f.range[0] + limitPage))
        return Promise.resolve({ data: rows, error: null, count: f.count ? total : null }).then(res, rej)
      },
    }
    return q
  }
  return { from: build, calls }
}
const SETTINGS = [{ key: 'diurna_amount', value: '50' }, { key: 'iban_firma', value: 'RO00TEST' }]
const empsFx = FX.employees.map(e => ({ id: e.id, name: e.name, active: true, termination_date: null, site_id: 1, iban: e.id % 3 ? `RO49BTRL${String(e.id).padStart(16, '0')}` : null }))
const pontajFx = RECS.map((r, i) => ({ id: i + 1, ...r, site_id: 1 }))
const T5 = { df: '2026-09-26', dt: '2026-09-30' }
const G = { scopGlobal: true }

describe('incarcaSnapshotDiurne — adaptorul comun al celor 3 fluxuri (Supabase mock)', () => {
  it('aceleași rânduri → export / savePayment / BT produc aceleași sume (Tharindu 133: 50 diurnă / 150 salariu)', async () => {
    const sb = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: empsFx, pontaj_records: pontajFx })
    // export citește '*,sites(name)', save/BT doar coloanele alocării — aceleași sume
    const sExport = await incarcaSnapshotDiurne(sb, { ...T5, ...G, recsSelect: '*,sites(name)' })
    const sSave = await incarcaSnapshotDiurne(sb, { ...T5, ...G })
    const sBT = await incarcaSnapshotDiurne(sb, { ...T5, siteIds: [1] })
    expect(sSave.diurnaAmt).toBe(50); expect(sSave.ibanFirma).toBe('RO00TEST'); expect(sSave.emps.length).toBe(84); expect(sSave.recs.length).toBe(RECS.length)
    expect(sSave.monthStart).toBe('2026-09-01'); expect(sSave.monthEnd).toBe('2026-09-30')
    expect(sSave.completitudine).toEqual({ citite: RECS.length, inBD: RECS.length })
    const [aE, aS, aB] = [sExport, sSave, sBT].map(alocaDinSnapshot)
    for (const id of [64, 133, 69, 129]) { expect(aS.get(id)).toEqual(aE.get(id)); expect(aB.get(id)).toEqual(aE.get(id)) }
    expect(aS.get(133)).toMatchObject({ sumaDiurna: 50, sumaSalariu: 150 })
    // ce salvează savePayment (zileDiurna × tarif) == ce trimite BT (sumaDiurna) == „Diurnă Max. Admisă" din export
    const save = [...aS].filter(([, a]) => a.N > 0).map(([id, a]) => [id, a.zileDiurna * sSave.diurnaAmt])
    const bt = [...aB].filter(([, a]) => a.N > 0).map(([id, a]) => [id, a.sumaDiurna])
    expect(bt).toEqual(save)
    // pontajul s-a citit pe LUNA ÎNTREAGĂ, cu paginare deterministă (employee_id, date, id) și pagină explicită
    const pag = sb.calls.filter(c => c.t === 'pontaj_records' && !c.head)
    expect(pag.every(c => c.gte[0][1] === '2026-09-01' && c.lte[0][1] === '2026-09-30')).toBe(true)
    expect(pag.every(c => c.order.join(',') === 'employee_id,date,id' && c.range[1] - c.range[0] + 1 === PAGINA_PONTAJ)).toBe(true)
    expect(pag.length).toBeGreaterThan(3)   // 3 fluxuri × ≥1 pagină (fixture-ul are >1000 rânduri → ≥2 pagini fiecare)
    // + câte o verificare de completitudine (count exact, head) per flux, cu aceleași filtre
    const cnt = sb.calls.filter(c => c.t === 'pontaj_records' && c.head)
    expect(cnt.length).toBe(3); expect(cnt.every(c => c.count === 'exact' && c.gte[0][1] === '2026-09-01' && c.in.length === 1)).toBe(true)
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
      await expect(incarcaSnapshotDiurne(sb, { ...T5, ...G }), t).rejects.toThrow(re)
    }
    // setarea diurna_amount lipsă / invalidă → throw
    await expect(incarcaSnapshotDiurne(mockSupabase({ ...base, settings: [] }), { ...T5, ...G })).rejects.toThrow(/diurna_amount/)
    await expect(incarcaSnapshotDiurne(mockSupabase({ ...base, settings: [{ key: 'diurna_amount', value: 'abc' }] }), { ...T5, ...G })).rejects.toThrow(/Tarif diurnă invalid/)
    await expect(incarcaSnapshotDiurne(mockSupabase(base), { df: '2026-09-30', dt: '2026-09-26', ...G })).rejects.toThrow(/Interval inversat/)
  })
  it('snapshot limitat la tranșă (doar bifele din T5 pentru Tharindu) → 200/0 în loc de 50/150: de asta luna întreagă e obligatorie', () => {
    const doarT5 = pontajFx.filter(r => r.employee_id === 133 && r.date >= T5.df && r.date <= T5.dt)
    const gresit = alocaDiurneTransa({ recsLuna: doarT5, ...T5, legalSet: LEGAL, diurnaAmt: 50 }).get(133)
    expect(gresit).toMatchObject({ B: 0, C: 22, sumaDiurna: 200, sumaSalariu: 0 })   // nu vede CO-ul (C) și nici bifele anterioare (B)
    const corect = alocaDiurneTransa({ recsLuna: pontajFx.filter(r => r.employee_id === 133), ...T5, legalSet: LEGAL, diurnaAmt: 50 }).get(133)
    expect(corect).toMatchObject({ B: 16, C: 17, sumaDiurna: 50, sumaSalariu: 150 })
  })
})

describe('paginare deterministă + completitudine (blocker 2)', () => {
  const multe = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, employee_id: 1 + (i % 3), date: '2026-09-' + String(1 + (i % 28)).padStart(2, '0'), diurna: true, norma: null }))
  const emps3 = [1, 2, 3].map(id => ({ id, name: 'E' + id, active: true, site_id: 1 }))
  it('server care servește pagini de 500 (sub PAGINA_PONTAJ) → throw „Snapshot incomplet", niciodată snapshot trunchiat în tăcere', async () => {
    const sb = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: emps3, pontaj_records: multe(2300) }, { limitPage: 500 })
    await expect(incarcaSnapshotDiurne(sb, { df: '2026-09-01', dt: '2026-09-04', ...G })).rejects.toThrow(/Snapshot incomplet: 500 rânduri citite din 2300/)
  })
  it('server care servește pagini întregi → încarcă tot (2300 rânduri, 3 pagini + count) cu ordonare pe cheie unică', async () => {
    const sb = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: emps3, pontaj_records: multe(2300) })
    const s = await incarcaSnapshotDiurne(sb, { df: '2026-09-01', dt: '2026-09-04', ...G })
    expect(s.recs.length).toBe(2300); expect(s.completitudine).toEqual({ citite: 2300, inBD: 2300 })
    const pag = sb.calls.filter(c => c.t === 'pontaj_records' && !c.head)
    expect(pag.map(c => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(pag.every(c => c.order.join(',') === 'employee_id,date,id')).toBe(true)
    // exact PAGINA_PONTAJ rânduri (multiplu exact) → o pagină goală în plus confirmă sfârșitul
    const sb2 = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: emps3, pontaj_records: multe(2000) })
    const s2 = await incarcaSnapshotDiurne(sb2, { df: '2026-09-01', dt: '2026-09-04', ...G })
    expect(s2.recs.length).toBe(2000)
    expect(sb2.calls.filter(c => c.t === 'pontaj_records' && !c.head).length).toBe(3)
  })
  it('count-ul din BD ≠ rândurile citite (rând apărut între pagini) → throw', async () => {
    const tables = { settings: SETTINGS, calendar_days: [], employees: emps3, pontaj_records: multe(1500) }
    const sb = mockSupabase(tables)
    const from = sb.from
    let n = 0
    sb.from = (t) => { if (t === 'pontaj_records' && ++n === 3) tables.pontaj_records = multe(1501); return from(t) }   // rând inserat după ultima pagină, înainte de count
    await expect(incarcaSnapshotDiurne(sb, { df: '2026-09-01', dt: '2026-09-04', ...G })).rejects.toThrow(/Snapshot incomplet: 1500 rânduri citite din 1501/)
  })
  it('LIMITA_PAGINARE + 1 rânduri (200.001) → throw limita de paginare, chiar dacă ultima pagină e scurtă', async () => {
    const sb = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: [{ id: 1, name: 'X', active: true }], pontaj_records: Array.from({ length: LIMITA_PAGINARE + 1 }, (_, i) => ({ id: i + 1, employee_id: 1, date: '2026-09-01', diurna: true, norma: null })) })
    await expect(incarcaSnapshotDiurne(sb, { ...T5, ...G })).rejects.toThrow(/limita de paginare/)
    // exact la limită → OK
    const sb2 = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: [{ id: 1, name: 'X', active: true }], pontaj_records: Array.from({ length: LIMITA_PAGINARE }, (_, i) => ({ id: i + 1, employee_id: 1, date: '2026-09-01', diurna: true, norma: null })) })
    await expect(incarcaSnapshotDiurne(sb2, { ...T5, ...G })).resolves.toMatchObject({ completitudine: { citite: LIMITA_PAGINARE, inBD: LIMITA_PAGINARE } })
  })
})

describe('scopul pe șantiere — contract explicit (blocker 3)', () => {
  const emps = [{ id: 1, name: 'A', active: true, site_id: 1 }, { id: 2, name: 'B', active: true, site_id: 2 }, { id: 3, name: 'C', active: true, site_id: 3 }]
  const pontaj = [
    { id: 1, employee_id: 1, date: '2026-09-02', diurna: true, norma: null, site_id: 2 },   // angajat de pe șantierul 1, bifat pe șantierul 2, ÎNAINTE de tranșă
    { id: 2, employee_id: 1, date: '2026-09-03', diurna: true, norma: null, site_id: 3 },
    { id: 3, employee_id: 1, date: '2026-09-28', diurna: true, norma: null, site_id: 1 },
    { id: 4, employee_id: 2, date: '2026-09-28', diurna: true, norma: null, site_id: 2 },
    { id: 5, employee_id: 3, date: '2026-09-28', diurna: true, norma: null, site_id: 3 },
  ]
  const tables = { settings: SETTINGS, calendar_days: [], employees: emps, pontaj_records: pontaj }
  it('siteIds: [] → throw „niciun șantier permis" (nu „fără restricție"); fără scop → throw; scopGlobal + siteIds → throw', async () => {
    await expect(incarcaSnapshotDiurne(mockSupabase(tables), { ...T5, siteIds: [] })).rejects.toThrow(/Niciun șantier permis/)
    await expect(incarcaSnapshotDiurne(mockSupabase(tables), { ...T5 })).rejects.toThrow(/Scopul pe șantiere lipsește/)
    await expect(incarcaSnapshotDiurne(mockSupabase(tables), { ...T5, siteIds: null })).rejects.toThrow(/Scopul pe șantiere lipsește/)
    await expect(incarcaSnapshotDiurne(mockSupabase(tables), { ...T5, scopGlobal: true, siteIds: [1] })).rejects.toThrow(/Scop ambiguu/)
  })
  it('scopGlobal: true → toți; siteIds: [1,2] → exact aceia; fără .in() la global', async () => {
    const sb = mockSupabase(tables)
    expect((await incarcaSnapshotDiurne(sb, { ...T5, scopGlobal: true })).emps.map(e => e.id)).toEqual([1, 2, 3])
    expect(sb.calls.find(c => c.t === 'employees').in).toEqual([])
    expect((await incarcaSnapshotDiurne(sb, { ...T5, siteIds: [1, 2] })).emps.map(e => e.id)).toEqual([1, 2])
    expect((await incarcaSnapshotDiurne(sb, { ...T5, siteIds: [3] })).emps.map(e => e.id)).toEqual([3])
  })
  it('bifele ANTERIOARE de pe alte șantiere contează la consumul lunar (B) chiar cu restricție pe șantierul 1', async () => {
    const s = await incarcaSnapshotDiurne(mockSupabase(tables), { ...T5, siteIds: [1] })
    expect(s.emps.map(e => e.id)).toEqual([1])
    expect(s.recs.filter(r => r.employee_id === 1).length).toBe(3)              // pontajul NU e filtrat pe șantier
    expect(alocaDinSnapshot(s).get(1)).toMatchObject({ B: 2, N: 1, zileDiurna: 1 })
    expect(s.recs.some(r => r.employee_id === 2)).toBe(false)                   // dar doar pentru angajații din scop
  })
})

describe('reconciliere — înregistrat vs recalculat, strict separate (blocker 1)', () => {
  // angajat 1: 22 bife în sept (plafon atins) + 26–30.09 + 01,02,05,06.10
  const sept = Array.from({ length: 22 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
  const zile = [...sept, '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06']
  const pontaj = zile.map((d, i) => ({ id: i + 1, employee_id: 1, date: d, diurna: true, norma: null }))
  const tables = { settings: SETTINGS, calendar_days: [], employees: [{ id: 1, name: 'X', active: true }], pontaj_records: pontaj }
  const T = { df: '2026-10-03', dt: '2026-10-09' }
  const plata = amount => ({ id: 90, period_from: '2026-09-26', period_to: '2026-10-02', diurna_payment_details: [{ employee_id: 1, amount }] })
  const reconc = (plati, recs, amt = 50) => platitAnteriorPeLuni({ plati, recsLuna: recs, ...T, legalSet: new Set(), diurnaAmt: amt }).get(1)

  it('plată 26.09–02.10 cu total salvat 0 / 50 / 100 / 150: înregistrat = exact ce s-a salvat, recalculat = 100, diferența pe toată plata; partea de octombrie NEDETERMINATĂ', async () => {
    const s = await incarcaSnapshotDiurne(mockSupabase(tables), { ...T, ...G, extindeDeLa: '2026-09-26' })
    expect(s.monthStart).toBe('2026-09-01'); expect(s.monthStartTransa).toBe('2026-10-01')
    expect(alocaDinSnapshot(s).get(1)).toMatchObject({ B: 2, N: 2, sumaDiurnaAnterior: 100, zileDiurna: 2 })
    for (const salvat of [0, 50, 100, 150]) {
      const r = reconc([plata(salvat)], s.recs)
      expect(r, `salvat ${salvat}`).toMatchObject({ inregistratTotal: salvat, recalculatTotal: 100, diferentaTotal: salvat - 100, nedeterminat: true, invalid: false, inregistratLuni: null })
      expect(r.plati[0]).toMatchObject({ id: 90, inregistrat: salvat, recalculat: 100, diferenta: salvat - 100, nedeterminat: true })
      expect(r.plati[0].luni['2026-10'].inregistrat).toBeNull()      // NU se reconstruiește „100 pentru octombrie" din recalcul
      expect(r.plati[0].luni['2026-10'].recalculat).toBe(100)
      expect(r.plati[0].luni['2026-09'].inregistrat).toBeNull()      // și nu se aruncă diferența în luna de start
      const dif = diferentaInregistratRecalculat(r, 100)
      expect(dif.valoare).toBeNull(); expect(dif.text).toMatch(/nedeterminat/); expect(dif.text).toContain(`înregistrat ${salvat} / recalculat 100`)
    }
  })
  it('istoricul înregistrat NU se schimbă când se schimbă CO / pontajul / tariful; doar recalculatul și diferența', async () => {
    const s = await incarcaSnapshotDiurne(mockSupabase(tables), { ...T, ...G, extindeDeLa: '2026-09-26' })
    const inainte = reconc([plata(150)], s.recs)
    expect(inainte).toMatchObject({ inregistratTotal: 150, recalculatTotal: 100, diferentaTotal: 50 })
    // (a) CO pe 01.10 → octombrie pierde o zi de plafon, dar bifa de pe 01.10 tot consumă → recalculat 100 (C=21, B=0, N=2 în oct) — neschimbat aici
    //     CO pe 02.10 ȘI bifa ștearsă de pe 02.10 → recalculat 50
    const recsCO = s.recs.filter(r => r.date !== '2026-10-02').concat([{ id: 999, employee_id: 1, date: '2026-10-02', diurna: false, norma: 'CO' }])
    const dupaCO = reconc([plata(150)], recsCO)
    expect(dupaCO).toMatchObject({ inregistratTotal: 150, recalculatTotal: 50, diferentaTotal: 100 })
    // (b) pontaj: bife de septembrie șterse (plafonul nu mai e atins) → recalculat crește (5 zile în sept + 2 în oct = 350)
    const recsFaraSept = s.recs.filter(r => r.date < '2026-09-01' || r.date > '2026-09-22')
    const dupaPontaj = reconc([plata(150)], recsFaraSept)
    expect(dupaPontaj).toMatchObject({ inregistratTotal: 150, recalculatTotal: 350, diferentaTotal: -200 })
    // (c) tarif 60 → recalculat 120; înregistrat rămâne 150
    const dupaTarif = reconc([plata(150)], s.recs, 60)
    expect(dupaTarif).toMatchObject({ inregistratTotal: 150, recalculatTotal: 120, diferentaTotal: 30 })
    for (const r of [inainte, dupaCO, dupaPontaj, dupaTarif]) expect(r.plati[0].inregistrat).toBe(150)
  })
  it('sumă înregistrată nenumerică (\'abc\', null) → INVALID, nu 0; nu se adună', async () => {
    const s = await incarcaSnapshotDiurne(mockSupabase(tables), { ...T, ...G, extindeDeLa: '2026-09-26' })
    for (const bad of ['abc', null, undefined, '', NaN]) {
      const r = reconc([plata(bad)], s.recs)
      expect(r, String(bad)).toMatchObject({ invalid: true, inregistratTotal: null, diferentaTotal: null, inregistratLuni: null, recalculatTotal: 100 })
      expect(r.plati[0]).toMatchObject({ invalid: true, inregistrat: null, diferenta: null })
      const dif = diferentaInregistratRecalculat(r, 100)
      expect(dif.valoare).toBeNull(); expect(dif.text).toMatch(/INVALID/)
    }
    expect(reconc([plata('150')], s.recs).inregistratTotal).toBe(150)   // string numeric din BD e OK
  })
  it('plată într-o singură lună a tranșei → determinată: înregistratul intră întreg în luna ei; plata de după df / din altă lună nu se ia', async () => {
    const s = await incarcaSnapshotDiurne(mockSupabase(tables), { ...T, ...G, extindeDeLa: '2026-09-26' })
    const doarSept = { id: 80, period_from: '2026-09-19', period_to: '2026-09-25', diurna_payment_details: [{ employee_id: 1, amount: 350 }] }
    const dupa = { id: 81, period_from: '2026-10-10', period_to: '2026-10-16', diurna_payment_details: [{ employee_id: 1, amount: 999 }] }
    // tranșa 26–30.09: plata 19–25.09 e în luna ei → înregistrat 350; recalculat cu pontajul curent: 19–25.09 are 4 bife lucr. (21,22 + 19? nu) → verificăm doar separarea
    const r = platitAnteriorPeLuni({ plati: [doarSept, dupa], recsLuna: s.recs, df: '2026-09-26', dt: '2026-09-30', legalSet: new Set(), diurnaAmt: 50 }).get(1)
    expect(r).toMatchObject({ nedeterminat: false, invalid: false, inregistratLuni: 350, inregistratTotal: 350 })
    expect(r.plati.map(p => p.id)).toEqual([80])
    expect(r.plati[0].luni['2026-09']).toEqual({ inregistrat: 350, recalculat: r.recalculatTotal })
    expect(diferentaInregistratRecalculat(r, 1100)).toEqual({ valoare: -750, text: '-750' })
    // pentru tranșa din octombrie, plata doar-septembrie nu atinge lunile tranșei → nu apare
    expect(reconc([doarSept], s.recs)).toBeUndefined()
    // fără nicio plată anterioară → diferența = −sumaDiurnaAnterior (tranșă nesalvată)
    expect(diferentaInregistratRecalculat(undefined, 100)).toEqual({ valoare: -100, text: '' })
  })
  it('defalcare SALVATĂ pe luni (amount_luni) verificabilă → determinată; sumă care nu bate → nedeterminat', async () => {
    const s = await incarcaSnapshotDiurne(mockSupabase(tables), { ...T, ...G, extindeDeLa: '2026-09-26' })
    const cu = { ...plata(150), diurna_payment_details: [{ employee_id: 1, amount: 150, amount_luni: { '2026-09': 50, '2026-10': 100 } }] }
    const r = reconc([cu], s.recs)
    expect(r).toMatchObject({ nedeterminat: false, inregistratLuni: 100, inregistratTotal: 150, recalculatTotal: 100, diferentaTotal: 50 })
    expect(diferentaInregistratRecalculat(r, 100)).toEqual({ valoare: 0, text: '' })
    const stricat = { ...cu, diurna_payment_details: [{ employee_id: 1, amount: 150, amount_luni: { '2026-09': 50, '2026-10': 50 } }] }
    expect(reconc([stricat], s.recs)).toMatchObject({ nedeterminat: true, inregistratLuni: null, inregistratTotal: 150 })
  })
})

describe('diurneFlux — export / payload salvare / BT din UN singur snapshot + o singură alocare (blocker 5)', () => {
  it('rândurile exportului, payload-ul persistat și sumele BT vin din aceeași alocare (Tharindu 133: 50)', async () => {
    const sb = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: empsFx, pontaj_records: pontajFx.map(r => ({ ...r, sites: { name: 'S1' } })) })
    const snap = await incarcaSnapshotDiurne(sb, { ...T5, ...G, recsSelect: '*,sites(name)' })
    const alocare = alocareDinSnapshot(snap)
    const exp = construiesteRanduriExport({ snap, alocare, platitPeLuni: new Map() })
    const { plata, detalii } = construiestePayloadPlata({ snap, alocare, paymentDate: '2026-10-01', createdBy: 'u1' })
    const bt = construiesteRanduriBT({ snap, alocare, ibanFirma: snap.ibanFirma, dataValuta: '01/10/2026' })
    // payload: aceleași zile/sume ca alocarea; totalurile plății = Σ detalii
    expect(plata).toMatchObject({ period_from: '2026-09-26', period_to: '2026-09-30', payment_date: '2026-10-01', created_by: 'u1', total_employees: detalii.length })
    expect(plata.total_amount).toBe(detalii.reduce((s, d) => s + d.amount, 0)); expect(plata.total_days).toBe(detalii.reduce((s, d) => s + d.days, 0))
    const d133 = detalii.find(d => d.employee_id === 133); expect(d133).toMatchObject({ days: 1, amount: 50, employee_name: expect.any(String) })
    for (const d of detalii) expect(d.amount).toBe(alocare.get(d.employee_id).sumaDiurna)
    // BT: doar sume > 0, aceleași ca în payload; Σ BT == Σ payload (amount>0)
    const btPeNume = new Map(bt.rows.map(r => [r[3], r[6]]))
    for (const d of detalii) { if (d.amount > 0) expect(btPeNume.get(d.employee_name)).toBe(d.amount); else expect(btPeNume.has(d.employee_name)).toBe(false) }
    expect(bt.total).toBe(plata.total_amount)
    expect(bt.rows.every(r => r[1] === 'RO00TEST' && r[10] === 'F' && r[9] === '01/10/2026')).toBe(true)
    expect(bt.faraIBAN.length).toBe(detalii.filter(d => d.amount > 0 && !empsFx.find(e => e.id === d.employee_id).iban).length)
    // export: „Diurnă Max. Admisă" × tarif == amount din payload, per angajat
    const numeDin = id => empsFx.find(e => e.id === id).name
    for (const d of detalii) {
      const e = exp.find(x => `${x.nume} ${x.prenume}` === numeDin(d.employee_id))
      expect(e, numeDin(d.employee_id)).toBeTruthy(); expect(e.diurnaMax * snap.diurnaAmt).toBe(d.amount); expect(e.totalZile).toBe(alocare.get(d.employee_id).N)
    }
    expect(exp.length).toBe(detalii.length)
    expect(exp.reduce((s, e) => s + e.diurnaMax, 0)).toBe(plata.total_days)
    const e133 = exp.find(e => `${e.nume} ${e.prenume}` === numeDin(133))
    expect(e133).toMatchObject({ diurnaMax: 1, pesteLimita: 3, totalZile: 4, normeCumulate: 17, zilePlatiteAnterior: 16, sites: [{ name: 'S1', zile: 4, val: 200 }] })
    expect(bicDinIban('RO49BTRL0000000000000133')).toBe('BTRLRO22XXX'); expect(bicDinIban('RO49XXXX0')).toBe('XXXXROBUXX'); expect(bicDinIban(null)).toBe('')
  })
  it('snapshot eșuat (citire pontaj / incomplet / fără șantiere) → throw ÎNAINTE de alocare: niciun payload, niciun rând BT/export', async () => {
    const base = { settings: SETTINGS, calendar_days: [], employees: empsFx, pontaj_records: pontajFx }
    const cazuri = [
      [mockSupabase(base, { fail: { pontaj_records: 'boom' } }), { ...T5, ...G }, /pontajul/],
      [mockSupabase(base, { limitPage: 300 }), { ...T5, ...G }, /Snapshot incomplet/],
      [mockSupabase(base), { ...T5, siteIds: [] }, /Niciun șantier permis/],
    ]
    for (const [sb, opt, re] of cazuri) {
      let snap = null, payload = null, bt = null, exp = null
      try { snap = await incarcaSnapshotDiurne(sb, opt); const a = alocareDinSnapshot(snap); payload = construiestePayloadPlata({ snap, alocare: a, paymentDate: 'x' }); bt = construiesteRanduriBT({ snap, alocare: a, ibanFirma: 'X', dataValuta: 'x' }); exp = construiesteRanduriExport({ snap, alocare: a }) }
      catch (e) { expect(e.message).toMatch(re) }
      expect([snap, payload, bt, exp]).toEqual([null, null, null, null])
    }
    // snapshot null / alocare lipsă → throw, nu payload gol
    expect(() => alocareDinSnapshot(null)).toThrow(/Snapshot lipsă/)
    expect(() => construiestePayloadPlata({ snap: null, alocare: new Map() })).toThrow(/lipsă/)
    expect(() => construiesteRanduriBT({ snap: { emps: [] }, alocare: new Map(), ibanFirma: null })).toThrow(/IBAN-ul firmei/)
  })
  it('fără diurne în perioadă → throw explicit (nu payload cu 0 angajați); BT fără sume confirmate → throw', async () => {
    const sb = mockSupabase({ settings: SETTINGS, calendar_days: [], employees: empsFx, pontaj_records: pontajFx })
    const snap = await incarcaSnapshotDiurne(sb, { df: '2026-09-01', dt: '2026-09-30', ...G })
    // tranșă în care nimeni n-are bife: mutăm tranșa în octombrie (fixture-ul e doar septembrie)
    const snapOct = await incarcaSnapshotDiurne(sb, { df: '2026-10-01', dt: '2026-10-02', ...G })
    const aOct = alocareDinSnapshot(snapOct)
    expect(() => construiestePayloadPlata({ snap: snapOct, alocare: aOct, paymentDate: 'x' })).toThrow(/Nu există diurne în perioadă/)
    expect(() => construiesteRanduriExport({ snap: snapOct, alocare: aOct })).toThrow(/Nu există diurne în perioadă/)
    expect(() => construiesteRanduriBT({ snap: snapOct, alocare: aOct, ibanFirma: 'X', dataValuta: 'x' })).toThrow(/Nu există diurne confirmate/)
    // luna întreagă: Σ diurnaMax export == Σ days payload == Σ BT / tarif
    const a = alocareDinSnapshot(snap)
    const { plata } = construiestePayloadPlata({ snap, alocare: a, paymentDate: 'x' })
    const bt = construiesteRanduriBT({ snap, alocare: a, ibanFirma: 'X', dataValuta: 'x' })
    expect(bt.total).toBe(plata.total_amount); expect(construiesteRanduriExport({ snap, alocare: a }).reduce((s, e) => s + e.diurnaMax, 0)).toBe(plata.total_days)
  })
  it('coloana „De verificat": în tranșă / ant. / ult. apar toate trei', () => {
    expect(textDeVerificat({ deVerificat: ['2026-09-03'], deVerificatAnterior: ['2026-09-01'], deVerificatUlterior: ['2026-09-30'] })).toBe('CO+diurnă: 03.09 · ant.: 01.09 · ult.: 30.09')
    expect(textDeVerificat({})).toBe('')
  })
})
