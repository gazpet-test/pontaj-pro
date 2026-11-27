import { describe, it, expect } from 'vitest'
import cazuri from './izoNdt.cazuri.json'
import {
  normalizeazaRandBuletin, comparaCitiri, starePeSudura, stareMetoda, comparaMetode, coloaneCentralizator,
  verificaExport, normalizeazaMetoda, normalizeazaRezultat, dataIso, dataRo,
} from './izoNdt.js'

// Toate datele sunt inventate (repo public): numere de buletin, serii, șarje, km.

// ── 1. normalizarea ─────────────────────────────────────────────────────
describe('normalizeazaRandBuletin — setul comun', () => {
  for (const c of cazuri.cazuri) {
    it(`${JSON.stringify(c.in)} pe tronsonul ${JSON.stringify(c.tronson)}`, () => {
      const r = normalizeazaRandBuletin(c.in, c.tronson)
      for (const [k, v] of Object.entries(c.asteptat)) expect(r[k], k).toEqual(v)
    })
  }
  it('nu aruncă pe intrări ciudate', () => {
    for (const x of [undefined, 0, {}, [], 'S', 'TR12', '   ']) {
      expect(() => normalizeazaRandBuletin(x, 12)).not.toThrow()
      expect(normalizeazaRandBuletin(x, 12).stare).toBe('nepotrivit')
    }
  })
  it('sufixul A e sudură distinctă de cea fără sufix; R e aceeași sudură', () => {
    const a = normalizeazaRandBuletin('T17S50A', 17), b = normalizeazaRandBuletin('T17S50', 17), r = normalizeazaRandBuletin('T17S50R', 17)
    expect(a.cheie).not.toBe(b.cheie)
    expect(r.cheie).toBe(b.cheie)
    expect(r.refacuta).toBe(true)
  })
})

describe('valori', () => {
  it('metoda', () => {
    expect(normalizeazaMetoda('pa ut')).toBe('PA-UT')
    expect(normalizeazaMetoda('PAUT')).toBe('PA-UT')
    expect(normalizeazaMetoda(' pm ')).toBe('PM')
    expect(normalizeazaMetoda('rt')).toBe('RT')
    expect(normalizeazaMetoda('')).toBe(null)
  })
  it('rezultatul (ancorat, nu subșir)', () => {
    expect(normalizeazaRezultat('Accepted')).toBe('acceptat')
    expect(normalizeazaRezultat('RESPINS')).toBe('respins')
    expect(normalizeazaRezultat('Not accepted')).toBe('necunoscut')
    expect(normalizeazaRezultat('')).toBe(null)
  })
  it('data ISO fără fus orar', () => {
    expect(dataIso('2026-10-20')).toBe('2026-10-20')
    expect(dataIso('20.10.2026')).toBe('2026-10-20')
    expect(dataIso('2026-02-30')).toEqual({ invalid: '2026-02-30' })
    expect(dataIso('')).toBe(null)
    expect(dataRo('2026-10-20')).toBe('20.10.2026')
  })
})

// ── 2. comparația a două citiri ─────────────────────────────────────────
const rand = (cod_raw, rezultat = 'Accepted', data_inspectie = '2026-10-20', ind = {}) => ({
  cod_raw, rezultat, data_inspectie, start_mm: null, end_mm: null, lungime_mm: null, inaltime_mm: null, adancime_mm: null, ...ind,
})
const citire = (randuri, antet = { numar: '77', data: '2026-10-28' }) => ({ antet: { firma: 'LAB TEST', metoda: 'PA-UT', ...antet }, randuri, incerte: [] })
const respinsInd = { start_mm: 850, end_mm: 920, lungime_mm: 70, inaltime_mm: 1, adancime_mm: 8.8 }

describe('comparaCitiri', () => {
  const A = citire([
    rand('GAZPET TR12 S10'),
    rand('GAZPET TR12 S11'),
    rand('GAZPET TR12 S12', 'Rejected', '2026-10-20', respinsInd),
    rand('GAZPET TR12 S12R', 'Accepted', '2026-10-27'),
    rand('GAZPET TR12 S13'),
  ])
  // B: altă ordine, S11 cu altă dată, S13 lipsă, S14 în plus, indicațiile ca text
  const B = citire([
    rand('GAZPET TR12 S12R', 'Accepted', '2026-10-27'),
    rand('TR12 S10'),
    rand('GAZPET TR12 S12', 'Rejected', '2026-10-20', { start_mm: '850', end_mm: '920', lungime_mm: '70', inaltime_mm: '1', adancime_mm: '8.8' }),
    rand('GAZPET TR12 S11', 'Accepted', '2026-10-21'),
    rand('GAZPET TR12 S14'),
  ], { numar: ' 77 ', data: '28.10.2026' })
  const r = comparaCitiri(A, B, { tronson: 12 })
  const dupa = cod => r.randuri.find(x => x.cod === cod && !x.refacuta)

  it('potrivire pe cheie, nu pe poziție; numerele comparate numeric (8.8 = "8.8")', () => {
    expect(r.ok).toBe(true)
    expect(dupa('T12S10').stare).toBe('potrivit')
    expect(dupa('T12S12').stare).toBe('potrivit')
    expect(r.randuri.find(x => x.cod === 'T12S12' && x.refacuta).stare).toBe('potrivit')
  })
  it('rând diferit, cu ambele variante și câmpul care diferă', () => {
    const d = dupa('T12S11')
    expect(d.stare).toBe('diferit')
    expect(d.campuri).toEqual(['data_inspectie'])
    expect(d.a.data_inspectie).toBe('2026-10-20')
    expect(d.b.data_inspectie).toBe('2026-10-21')
  })
  it('rânduri doar într-o citire', () => {
    expect(dupa('T12S13').stare).toBe('doar_in_A')
    expect(dupa('T12S14').stare).toBe('doar_in_B')
  })
  it('rezumat și antet (dată în alt format = aceeași)', () => {
    expect(r.rezumat).toMatchObject({ potrivit: 3, diferit: 1, doar_in_A: 1, doar_in_B: 1, dublat: 0 })
    expect(r.randuri).toHaveLength(6)
    expect(r.antet.numar).toEqual({ a: '77', b: '77', egal: true })
    expect(r.antet.data.egal).toBe(true)
  })
  it('refacerea R nu se împerechează cu originalul', () => {
    const x = comparaCitiri(citire([rand('T12S12', 'Rejected')]), citire([rand('T12S12R', 'Rejected')]), { tronson: 12 })
    expect(x.randuri.map(y => y.stare).sort()).toEqual(['doar_in_A', 'doar_in_B'])
  })
  it('valoare numerică diferită', () => {
    const x = comparaCitiri(citire([rand('T12S12', 'Rejected', '2026-10-20', respinsInd)]),
      citire([rand('T12S12', 'Rejected', '2026-10-20', { ...respinsInd, adancime_mm: 3.8 })]), { tronson: 12 })
    expect(x.randuri[0].stare).toBe('diferit')
    expect(x.randuri[0].campuri).toEqual(['adancime_mm'])
  })
  it('aceeași sudură de două ori într-o citire → dublat (decide omul)', () => {
    const x = comparaCitiri(citire([rand('T12S10'), rand('T12S10', 'Rejected')]), citire([rand('T12S10')]), { tronson: 12 })
    expect(x.randuri).toHaveLength(1)
    expect(x.randuri[0].stare).toBe('dublat')
    expect(x.randuri[0].a).toHaveLength(2)
  })
  it('cod nepotrivit rămâne în listă, marcat', () => {
    const x = comparaCitiri(citire([rand('GAZPET TR13 S5'), rand('-')]), citire([rand('GAZPET TR13 S 5')]), { tronson: 12 })
    expect(x.rezumat.nepotrivit).toBe(2)
    expect(x.randuri.find(y => y.motiv === 'alt_tronson').stare).toBe('potrivit')
    expect(x.randuri.find(y => y.motiv === 'format').stare).toBe('doar_in_A')
  })
  it('rezultat ilizibil identic în ambele → incert, nu potrivit', () => {
    const x = comparaCitiri(citire([rand('T12S10', 'Acc?')]), citire([rand('T12S10', 'Acc?')]), { tronson: 12 })
    expect(x.randuri[0].stare).toBe('incert')
    expect(x.randuri[0].incert).toContain('rezultat')
  })
  it('citire invalidă → eroare, nu listă goală', () => {
    const x = comparaCitiri(citire([rand('T12S10')]), { antet: {} }, { tronson: 12 })
    expect(x.ok).toBe(false)
    expect(x.erori).toEqual(['citire_b_invalida'])
  })
  it('fără tronson în context, tronsonul vine din cod', () => {
    const x = comparaCitiri(citire([rand('GAZPET TR12 S10')]), citire([rand('T12S10')]))
    expect(x.randuri[0].stare).toBe('potrivit')
  })
})

// ── 3. starea pe sudură ─────────────────────────────────────────────────
const br = (cheie, metoda, numar, data_buletin, data_inspectie, rezultat, refacuta = false, extra = {}) =>
  ({ cheie, metoda, numar, data_buletin, data_inspectie, rezultat, refacuta, are_pdf: true, ...extra })

describe('starePeSudura', () => {
  it('refacere: S126 respins 20.10 + S126R acceptat 27.10 → acceptat, valabil = refacerea', () => {
    const s = starePeSudura([
      br('12|126|', 'PA-UT', '77', '2026-10-28', '2026-10-27', 'Accepted', true),
      br('12|126|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Rejected'),
    ])
    const m = stareMetoda(s, '12|126|', 'PA-UT')
    expect(m.stare).toBe('acceptat')
    expect(m.valabil.refacuta).toBe(true)
    expect(m.istoric).toHaveLength(2)
    expect(stareMetoda(s, '12|126|', 'PM').stare).toBe('lipsa')
  })
  it('refacere respinsă → respins_fara_refacere', () => {
    const s = starePeSudura([
      br('12|126|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Rejected'),
      br('12|126|', 'PA-UT', '78', '2026-11-05', '2026-11-03', 'Rejected', true),
    ])
    expect(stareMetoda(s, '12|126|', 'PA-UT').stare).toBe('respins_fara_refacere')
    expect(stareMetoda(s, '12|126|', 'PA-UT').valabil.numar).toBe('78')
  })
  it('aceeași dată de inspecție: refacerea bate originalul', () => {
    const s = starePeSudura([
      br('12|126|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted', true),
      br('12|126|', 'PM', '5', '2026-10-21', '2026-10-20', 'Rejected'),
    ])
    expect(stareMetoda(s, '12|126|', 'PM').stare).toBe('acceptat')
  })
  it('aceeași inspecție, refacere egală: buletinul mai recent bate', () => {
    const s = starePeSudura([
      br('12|30|', 'PM', '6', '2026-10-25', '2026-10-20', 'Accepted'),
      br('12|30|', 'PM', '5', '2026-10-21', '2026-10-20', 'Rejected'),
    ])
    expect(stareMetoda(s, '12|30|', 'PM').valabil.numar).toBe('6')
  })
  it('două buletine, aceeași dată pe toate criteriile → conflict (nu alege tacit)', () => {
    const s = starePeSudura([
      br('12|30|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
      br('12|30|', 'PM', '6', '2026-10-21', '2026-10-20', 'Rejected'),
    ])
    const m = stareMetoda(s, '12|30|', 'PM')
    expect(m.stare).toBe('conflict')
    expect(m.motiv).toBe('egalitate')
    expect(m.valabil).toBe(null)
  })
  it('conflict și când ambele spun „acceptat” (nu se știe ce buletin se citează)', () => {
    const s = starePeSudura([
      br('12|30|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
      br('12|30|', 'PM', '6', '2026-10-21', '2026-10-20', 'Accepted'),
    ])
    expect(stareMetoda(s, '12|30|', 'PM').stare).toBe('conflict')
  })
  it('același rând de două ori din același buletin → nu e conflict', () => {
    const s = starePeSudura([
      br('12|30|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted', false, { buletin_id: 9 }),
      br('12|30|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted', false, { buletin_id: 9 }),
    ])
    expect(stareMetoda(s, '12|30|', 'PM').stare).toBe('acceptat')
  })
  it('fără dată de inspecție în grup cu mai multe rânduri → conflict', () => {
    const s = starePeSudura([
      br('12|30|', 'PM', '5', '2026-10-21', null, 'Accepted'),
      br('12|30|', 'PM', '6', '2026-10-22', '2026-10-20', 'Rejected'),
    ])
    expect(stareMetoda(s, '12|30|', 'PM')).toMatchObject({ stare: 'conflict', motiv: 'data_inspectie_lipsa' })
  })
  it('sufixul A e altă sudură', () => {
    const s = starePeSudura([
      br('17|50|', 'PM', '5', '2026-10-21', '2026-10-20', 'Rejected'),
      br('17|50|A', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
    ])
    expect(stareMetoda(s, '17|50|', 'PM').stare).toBe('respins_fara_refacere')
    expect(stareMetoda(s, '17|50|A', 'PM').stare).toBe('acceptat')
  })
  it('cheia din cod + tronson; rândurile fără cheie / neconfirmate sunt raportate, nu pierdute', () => {
    const s = starePeSudura([
      { cod: 'GAZPET TR12 S40', tronson: 12, metoda: 'pm', numar: '5', data_buletin: '2026-10-21', data_inspectie: '2026-10-20', rezultat: 'Accepted' },
      { cod: 'GAZPET TR13 S40', tronson: 12, metoda: 'PM', numar: '5', data_buletin: '2026-10-21', data_inspectie: '2026-10-20', rezultat: 'Accepted' },
      br('12|41|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted', false, { buletin_stare: 'anulat' }),
      br('12|42|', '', '5', '2026-10-21', '2026-10-20', 'Accepted'),
    ])
    expect(stareMetoda(s, '12|40|', 'PM').stare).toBe('acceptat')
    expect(s.ignorate.map(i => i.motiv)).toEqual(['cheie_sudura', 'buletin_neconfirmat', 'metoda_lipsa'])
  })
  it('rezultat necunoscut → conflict', () => {
    const s = starePeSudura([br('12|30|', 'PM', '5', '2026-10-21', '2026-10-20', 'Acc?')])
    expect(stareMetoda(s, '12|30|', 'PM')).toMatchObject({ stare: 'conflict', motiv: 'rezultat_necunoscut' })
  })
})

// ── 4. comparația între metode ──────────────────────────────────────────
describe('comparaMetode', () => {
  it('PA-UT vs PM', () => {
    const s = starePeSudura([
      br('12|10|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted'),
      br('12|10|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
      br('12|11|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted'),
      br('12|9|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Rejected'),
      br('12|12|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
    ])
    expect(comparaMetode(s, 'PA-UT', 'pm')).toEqual({ metodaA: 'PA-UT', metodaB: 'PM', doar_in_A: ['12|9|', '12|11|'], doar_in_B: ['12|12|'] })
  })
})

// ── 5. coloanele din centralizator ──────────────────────────────────────
describe('coloaneCentralizator', () => {
  const s = starePeSudura([
    br('12|126|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Rejected'),
    br('12|126|', 'PA-UT', '78', '2026-11-02', '2026-10-27', 'Accepted', true),
    br('12|126|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
    br('12|30|', 'UT', '9', '2026-10-21', '2026-10-20', 'Accepted'),
    br('12|30|', 'UT', '10', '2026-10-21', '2026-10-20', 'Accepted'),
  ])
  it('nr/ZZ.LL.AAAA din buletinul valabil (refacerea acceptată)', () => {
    expect(coloaneCentralizator({ tip_rand: 'teava', sudura_cod: 'T12S126', sudura_refacuta: true }, s, 12))
      .toEqual({ pm: '5/21.10.2026', pa_ut: '78/02.11.2026', ut: null })
  })
  it('separator, țeavă ultimă fără sudură, cod din alt tronson → null-uri', () => {
    const gol = { pm: null, pa_ut: null, ut: null }
    expect(coloaneCentralizator({ tip_rand: 'separator', sudura_cod: 'T12S126' }, s, 12)).toEqual(gol)
    expect(coloaneCentralizator({ tip_rand: 'teava', sudura_cod: null }, s, 12)).toEqual(gol)
    expect(coloaneCentralizator({ tip_rand: 'teava', sudura_cod: 'T13S126' }, s, 12)).toEqual(gol)
  })
  it('conflict → null (nu se alege tacit)', () => {
    expect(coloaneCentralizator({ tip_rand: 'teava', sudura_cod: 'T12S30' }, s, 12).ut).toBe(null)
  })
})

// ── 6. verificarea înainte de export ────────────────────────────────────
const teava = (poz, serie, sudura_cod, extra = {}) => ({
  poz_in_pachet: poz, tip_rand: 'teava', serie_unica: serie, tip: 'TEAVA', dimensiune: 'DN 100x5', sarja: `SJ${poz}`, lungime_m: 11.5, sudura_cod, ...extra,
})
describe('verificaExport', () => {
  const stareBuna = starePeSudura([
    br('12|1|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted'),
    br('12|2|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted'),
    br('12|1|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
    br('12|2|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
  ])
  const pachet = { km_start_m: 1000, total_lungime_m: 34.5, tronson_cod: 'T12' }
  const randuriBune = [
    teava(1, 'X-001', 'T12S1'),
    { poz_in_pachet: 2, tip_rand: 'separator' },
    teava(3, 'X-002', 'T12S2'),
    teava(4, 'X-003', null),                   // țeava ultimă, fără sudură
  ]
  const v = (o = {}) => verificaExport({ pachet, randuri: randuriBune, stare: stareBuna, metodeObligatorii: ['PA-UT', 'PM'], pachetAnterior: null, ...o })
  const coduri = l => l.map(e => e.cod)

  it('pachet complet → fără blocaje; UT neobligatoriu → avertismente', () => {
    const r = v()
    expect(r.blocaje).toEqual([])
    expect(r.blocajeDeblocabile).toEqual([])
    expect(r.avertismente.map(e => [e.cod, e.rand])).toEqual([['metoda_neobligatorie_lipsa', 1], ['metoda_neobligatorie_lipsa', 3]])
  })
  it('km start lipsă → blocaj', () => {
    expect(coduri(v({ pachet: { ...pachet, km_start_m: null } }).blocaje)).toEqual(['km_start_lipsa'])
    expect(coduri(v({ pachet: { ...pachet, km_start_m: '' } }).blocaje)).toEqual(['km_start_lipsa'])
  })
  it('serie dublată și sudură dublată → blocaje pe rândul al doilea', () => {
    const r = v({ randuri: [teava(1, 'X-001', 'T12S1'), teava(2, 'x-001', 'T12S1')] })
    expect(r.blocaje.map(e => [e.cod, e.rand])).toEqual([['serie_dublata', 2], ['sudura_dublata', 2]])
  })
  it('sudură R și A: R e aceeași sudură (dublată), A nu', () => {
    expect(coduri(v({ randuri: [teava(1, 'X-001', 'T12S1'), teava(2, 'X-002', 'T12S1R')] }).blocaje)).toEqual(['sudura_dublata'])
    expect(coduri(v({ randuri: [teava(1, 'X-001', 'T12S1'), teava(2, 'X-002', 'T12S1A')] }).blocaje)).toEqual([])
  })
  it('țeavă / curbă fără serie, șarjă, lungime sau dimensiune', () => {
    const r = v({ randuri: [
      teava(1, '', 'T12S1', { sarja: ' ', lungime_m: 0 }),
      { poz_in_pachet: 2, tip_rand: 'curba', serie_unica: 'C-1', sarja: 'SJ', lungime_m: '1,2', dimensiune: '', sudura_cod: 'T12S2' },
    ] })
    expect(r.blocaje.map(e => [e.cod, e.rand, e.mesaj])).toEqual([
      ['element_incomplet', 1, 'Țeavă fără serie, șarjă, lungime.'],
      ['element_incomplet', 2, 'Curbă fără dimensiune.'],
    ])
  })
  it('lipsă buletin la metodă obligatorie → deblocabil', () => {
    const r = v({ metodeObligatorii: ['PA-UT', 'PM', 'UT'] })
    expect(r.blocajeDeblocabile.map(e => [e.cod, e.rand])).toEqual([['buletin_lipsa', 1], ['buletin_lipsa', 3]])
    expect(r.blocaje).toEqual([])
  })
  it('respins fără refacere → deblocabil, și pe metodă neobligatorie', () => {
    const s = starePeSudura([...[
      br('12|1|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted'),
      br('12|2|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted'),
      br('12|1|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
      br('12|2|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
    ], br('12|2|', 'UT', '9', '2026-10-21', '2026-10-20', 'Rejected')])
    const r = v({ stare: s })
    expect(r.blocajeDeblocabile.map(e => [e.cod, e.rand])).toEqual([['respins_fara_refacere', 3]])
  })
  it('refacere acceptată → nu blochează', () => {
    const s = starePeSudura([
      br('12|1|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Rejected'),
      br('12|1|', 'PA-UT', '77', '2026-10-28', '2026-10-27', 'Accepted', true),
      br('12|2|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted'),
    ])
    expect(v({ stare: s, metodeObligatorii: ['PA-UT'] }).blocajeDeblocabile).toEqual([])
  })
  it('buletin fără PDF → un singur deblocabil pe buletin', () => {
    const s = starePeSudura([
      br('12|1|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted', false, { are_pdf: false }),
      br('12|2|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted', false, { are_pdf: undefined }),
    ])
    const r = v({ stare: s, metodeObligatorii: ['PA-UT'] })
    expect(r.blocajeDeblocabile.map(e => [e.cod, e.rand, e.mesaj])).toEqual([['buletin_fara_pdf', 1, 'Buletinul PA-UT 77/28.10.2026 n-are PDF.']])
  })
  it('PDF necunoscut = lipsă (L18); calea din Storage = are PDF', () => {
    const s = starePeSudura([
      br('12|1|', 'PA-UT', '77', '2026-10-28', '2026-10-20', 'Accepted', false, { are_pdf: undefined }),
      br('12|2|', 'PA-UT', '79', '2026-10-29', '2026-10-20', 'Accepted', false, { are_pdf: undefined, cale_pdf: 'p/1.pdf' }),
    ])
    const r = v({ stare: s, metodeObligatorii: ['PA-UT'] })
    expect(r.blocajeDeblocabile.map(e => [e.cod, e.rand])).toEqual([['buletin_fara_pdf', 1]])
  })
  it('conflict pe metodă obligatorie → deblocabil', () => {
    const s = starePeSudura([
      br('12|1|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
      br('12|1|', 'PM', '6', '2026-10-21', '2026-10-20', 'Accepted'),
      br('12|2|', 'PM', '5', '2026-10-21', '2026-10-20', 'Accepted'),
    ])
    expect(coduri(v({ stare: s, metodeObligatorii: ['PM'] }).blocajeDeblocabile)).toEqual(['buletin_conflict'])
  })
  it('cod de sudură nerecunoscut în pachet → deblocabil, nu dispare', () => {
    const r = v({ randuri: [teava(1, 'X-001', '-'), teava(2, 'X-002', 'T13S5')] })
    expect(r.blocajeDeblocabile.map(e => [e.cod, e.rand])).toEqual([['sudura_cod_nerecunoscut', 1], ['sudura_cod_nerecunoscut', 2]])
  })
  it('sudură în șanț → avertisment', () => {
    const r = v({ randuri: [teava(1, 'X-001', 'T12S1', { sudura_sant_pending: true })] })
    expect(coduri(r.avertismente)).toContain('sudura_in_sant')
  })
  it('gol de km față de pachetul anterior (toleranță 1 m)', () => {
    const ant = { km_start_m: 900, total_lungime_m: 98.5 }        // se termină la 998,5
    expect(coduri(v({ pachetAnterior: ant }).avertismente)).toContain('gol_km')          // gol 1,5 m
    expect(coduri(v({ pachetAnterior: { ...ant, total_lungime_m: 99 } }).avertismente)).not.toContain('gol_km')   // exact 1 m
    expect(coduri(v({ pachetAnterior: { ...ant, total_lungime_m: 100.4 } }).avertismente)).not.toContain('gol_km')
    const supr = v({ pachetAnterior: { ...ant, total_lungime_m: 105 } }).avertismente.find(e => e.cod === 'gol_km')
    expect(supr.mesaj).toMatch(/^Suprapunere de 5 m/)
    expect(coduri(v({ pachetAnterior: { km_start_m: 900 } }).avertismente)).toContain('km_anterior_necunoscut')
  })
  it('setări necunoscute → blocaj, nu „totul e bine”', () => {
    expect(coduri(v({ metodeObligatorii: undefined }).blocaje)).toEqual(['setare_metode_lipsa'])
    expect(coduri(v({ stare: null }).blocaje)).toEqual(['stare_buletine_lipsa'])
    expect(coduri(v({ randuri: null }).blocaje)).toEqual(['randuri_lipsa'])
    expect(coduri(v({ pachet: { km_start_m: 1000 } }).blocaje)).toEqual(['tronson_lipsa'])
  })
  it('lista goală de metode obligatorii = nicio metodă obligatorie', () => {
    const r = v({ metodeObligatorii: [], stare: starePeSudura([]) })
    expect(r.blocajeDeblocabile).toEqual([])
    expect(coduri(r.avertismente).filter(c => c === 'metoda_neobligatorie_lipsa')).toHaveLength(6)
  })
})
