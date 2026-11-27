import { describe, it, expect } from 'vitest'
import {
  parseazaCoordonate, verificaDistante, propuneCoduri, rezumat, lantSuduri, punctePentruVerificare, codPachet,
  STARI_COORDONATE,
} from './izoCoordonate.js'

// Date inventate: tronsonul 99, coduri T99S…, coordonate rotunde (distanțele se calculează de mână, 3-4-5 / 5-12-13).
const dupaLinie = (rr, linie) => rr.find(r => r.linie === linie)

describe('parseazaCoordonate — stările', () => {
  const text = [
    'T99S1 1000.000 2000.000 300.000',      // 1 ok
    'T99S2 1003.000 2004.000 300.000 ',     // 2 ok (spațiu la final, ca în fișierele reale)
    'T99S3\t1006.000\t2008.000\t300.000',   // 3 ok (tab)
    'T99S88?1 1009.000 2012.000 300.000',   // 4 nesigur (?)
    'T99S12?? 1012.000 2016.000 300.000',   // 5 nesigur (??)
    'T99S143.1 1015.000 2020.000 300.000',  // 6 nesigur (alt format)
    'T98S7 1018.000 2024.000 300.000',      // 7 nepotrivit (alt tronson)
    'T99S8 1021.000 2028.000',              // 8 ilizibil (3 câmpuri)
    'T99S9 1024.000 2032.000 300.000 1',    // 9 ilizibil (5 câmpuri)
    'T99S10 1027.000 20x6.000 300.000',     // 10 ilizibil (număr nevalid)
    '',                                     // 11 gol — nu e dată
    'T99S11 1030.000 2040.000 300.000',     // 12 ok, apoi repetată identic
    'T99S11 1030.000 2040.000 300.000',     // 13 repetata
    'T99S12 1033.000 2044.000 300.000',     // 14 dublura
    'T99S12 1033.500 2044.000 300.000',     // 15 dublura
    '205 1036.000 2048.000 300.000',        // 16 nesigur (doar un număr de punct)
    'T99S13 1,039 2052 300',                // 17 ok (virgulă zecimală)
  ].join('\r\n')
  const rr = parseazaCoordonate(text, 'T99')

  it('fiecare rând nevid apare exact o dată, cu numărul liniei din fișier', () => {
    expect(rr.map(r => r.linie)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17])
  })
  it('ok: cod + 3 numere, cheia de identitate a sudurii', () => {
    expect(dupaLinie(rr, 1)).toMatchObject({ stare: 'ok', cheie: '99|1|', x: 1000, y: 2000, z: 300, motiv: null })
    expect(dupaLinie(rr, 2)).toMatchObject({ stare: 'ok', cheie: '99|2|', z: 300 })
    expect(dupaLinie(rr, 3)).toMatchObject({ stare: 'ok', cheie: '99|3|' })
    expect(dupaLinie(rr, 17)).toMatchObject({ stare: 'ok', x: 1.039, y: 2052, z: 300 })
  })
  it('nesigur: „?”, alt format, doar număr — coordonatele se păstrează pentru propunere', () => {
    expect(dupaLinie(rr, 4)).toMatchObject({ stare: 'nesigur', motiv: 'semn_intrebare', cheie: null, x: 1009 })
    expect(dupaLinie(rr, 5)).toMatchObject({ stare: 'nesigur', motiv: 'semn_intrebare' })
    expect(dupaLinie(rr, 6)).toMatchObject({ stare: 'nesigur', motiv: 'cod_format', cheie: null, x: 1015 })
    expect(dupaLinie(rr, 16)).toMatchObject({ stare: 'nesigur', motiv: 'doar_numar' })
  })
  it('nepotrivit: cod de pe alt tronson', () => {
    expect(dupaLinie(rr, 7)).toMatchObject({ stare: 'nepotrivit', motiv: 'tronson_98' })
  })
  it('ilizibil: câmpuri greșite / număr nevalid, fără coordonate', () => {
    expect(dupaLinie(rr, 8)).toMatchObject({ stare: 'ilizibil', motiv: 'campuri_3', x: null })
    expect(dupaLinie(rr, 9)).toMatchObject({ stare: 'ilizibil', motiv: 'campuri_5' })
    expect(dupaLinie(rr, 10)).toMatchObject({ stare: 'ilizibil', motiv: 'numar', x: null, y: null, z: null })
  })
  it('repetata: aceeași cheie, aceleași coordonate → prima ok, a doua repetata', () => {
    expect(dupaLinie(rr, 12).stare).toBe('ok')
    expect(dupaLinie(rr, 13)).toMatchObject({ stare: 'repetata', motiv: 'repeta_linia_12' })
  })
  it('dublura: aceeași cheie cu coordonate diferite → AMBELE dublura', () => {
    expect(dupaLinie(rr, 14).stare).toBe('dublura')
    expect(dupaLinie(rr, 15).stare).toBe('dublura')
  })
  it('refacerea (R) e aceeași sudură: aceeași cheie ca sudura de bază', () => {
    const r = parseazaCoordonate('T99S5 1 2 3\nT99S5R 1 2 4', 99)
    expect(r.map(x => x.stare)).toEqual(['dublura', 'dublura'])
    expect(r[1]).toMatchObject({ cheie: '99|5|', refacuta: true })
  })
  it('sufixul de cuplare (A) e o sudură distinctă', () => {
    const r = parseazaCoordonate('T99S5 1 2 3\nT99S5A 1 2 4', 99)
    expect(r.map(x => x.stare)).toEqual(['ok', 'ok'])
    expect(r[1].cheie).toBe('99|5|A')
  })
  it('BOM la început și finaluri de linie LF / CR', () => {
    const r = parseazaCoordonate(String.fromCharCode(0xFEFF) + 'T99S1 1 2 3\rT99S2 4 5 6\n', 99)
    expect(r.map(x => [x.linie, x.stare, x.cheie])).toEqual([[1, 'ok', '99|1|'], [2, 'ok', '99|2|']])
  })
  it('fără tronson de încărcare = eroare de apel (nu se poate verifica „nepotrivit”)', () => {
    expect(() => parseazaCoordonate('T99S1 1 2 3', null)).toThrow()
  })
  it('lista stărilor e închisă', () => {
    for (const r of rr) expect(STARI_COORDONATE).toContain(r.stare)
  })
})

describe('verificaDistante — distanța din coordonate vs lungimea elementului', () => {
  // (0,0,0) → (3,4,0): 5 m; → (3,4,12): 12 m; → (8,16,12): 13 m (5-12-13)
  const p = [
    { cheie: 'a', x: 0, y: 0, z: 0 }, { cheie: 'b', x: 3, y: 4, z: 0 },
    { cheie: 'c', x: 3, y: 4, z: 12 }, { cheie: 'd', x: 8, y: 16, z: 12 },
  ]
  it('în toleranță: nicio abatere', () => {
    const r = verificaDistante(p, [{ lungime_m: 5 }, { lungime_m: 12 }, { lungime_m: 13 }])
    expect(r).toMatchObject({ verificate: 3, avertismente: [], neverificate: [] })
  })
  it('abatere peste max(0,5 m, 5%) → avertisment cu ambele valori', () => {
    // 12 vs 11: abatere 1 > max(0,5; 0,55)
    const r = verificaDistante(p, [{ lungime_m: 5 }, { lungime_m: 11 }, { lungime_m: 13 }])
    expect(r.avertismente).toHaveLength(1)
    expect(r.avertismente[0]).toMatchObject({ de: 'b', pana: 'c', lungime: 11 })
    expect(r.avertismente[0].distanta).toBeCloseTo(12, 9)
    expect(r.avertismente[0].abatere).toBeCloseTo(1, 9)
  })
  it('pragul: 0,5 m la elemente scurte, 5% la cele lungi', () => {
    const doua = (d, l) => verificaDistante([{ cheie: 'a', x: 0, y: 0, z: 0 }, { cheie: 'b', x: d, y: 0, z: 0 }], [{ lungime_m: l }]).avertismente.length
    expect(doua(4.45, 4)).toBe(0)   // 0,45 ≤ 0,5
    expect(doua(4.55, 4)).toBe(1)   // 0,55 > 0,5
    expect(doua(20.9, 20)).toBe(0)  // 0,9 ≤ 1,0 (5%)
    expect(doua(21.1, 20)).toBe(1)  // 1,1 > 1,0
    expect(doua(4.5, 4)).toBe(0)    // exact pe prag = în toleranță (strict „peste”)
    expect(doua(4.51, 4)).toBe(1)
    expect(doua(3.49, 4)).toBe(1)   // și sub lungime
  })
  it('perechile fără coordonate / fără lungime nu dispar: neverificate cu motiv', () => {
    const q = [{ cheie: 'a', x: 0, y: 0, z: 0 }, { cheie: 'b', x: null, y: null, z: null }, { cheie: 'c', x: 0, y: 0, z: 5 }, { cheie: 'd', x: 0, y: 0, z: 9 }]
    const r = verificaDistante(q, [{ lungime_m: 1 }, { lungime_m: 1 }, { lungime_m: null }])
    expect(r.verificate).toBe(0)
    expect(r.neverificate.map(x => x.motiv)).toEqual(['fara_coordonate', 'fara_coordonate', 'fara_lungime'])
  })
  it('mai multe elemente între două suduri: lungimile se adună', () => {
    const r = verificaDistante([{ cheie: 'a', x: 0, y: 0, z: 0 }, { cheie: 'b', x: 12, y: 0, z: 0 }], [[{ lungime_m: 6 }, { lungime_m: 6 }]])
    expect(r).toMatchObject({ verificate: 1, avertismente: [] })
  })
  it('numărul de elemente nepotrivit cu sudurile e semnalat', () => {
    const r = verificaDistante(p, [{ lungime_m: 5 }])
    expect(r.neverificate[0].motiv).toBe('elemente_1_pentru_4_suduri')
  })
})

describe('propuneCoduri — codul pentru rândurile nesigure', () => {
  // lanț: s1 (0,0,0) — 12 m — s2 (fără) — 12 m — s3 (24,0,0) — 10 m — s4 (fără, la capăt)
  const puncte = {
    punctePeOrdine: [
      { cheie: 's1', x: 0, y: 0, z: 0 }, { cheie: 's2', x: null, y: null, z: null },
      { cheie: 's3', x: 24, y: 0, z: 0 }, { cheie: 's4', x: null, y: null, z: null },
    ],
    elemente: [{ lungime_m: 12 }, { lungime_m: 12 }, { lungime_m: 10 }],
  }
  it('propune sudura fără coordonate cea mai apropiată, cu distanța, fără să aplice nimic', () => {
    const nesigur = { linie: 7, codRaw: 'T99S2?', stare: 'nesigur', x: 12.3, y: 0.4, z: 0 }
    const { propuneri } = propuneCoduri([nesigur], ['s2', 's4'], puncte)
    expect(propuneri[0]).toMatchObject({ linie: 7, cheie: 's2', metoda: 'interpolare', conflict: false })
    expect(propuneri[0].distanta).toBeCloseTo(0.5, 9) // 0,3-0,4-0,5
    expect(propuneri[0].urmatoarea.cheie).toBe('s4')
    expect(nesigur.stare).toBe('nesigur')
  })
  it('interpolarea urmează lungimile, nu mijlocul (6 m + 18 m → la 6 m de prima)', () => {
    const asim = { ...puncte, elemente: [{ lungime_m: 6 }, { lungime_m: 18 }, { lungime_m: 10 }] }
    const { propuneri } = propuneCoduri([{ linie: 3, codRaw: 'x', x: 6, y: 0, z: 0 }], ['s2'], asim)
    expect(propuneri[0].cheie).toBe('s2')
    expect(propuneri[0].distanta).toBeCloseTo(0, 9)
  })
  it('la capătul lanțului: prelungire pe direcția ultimilor doi vecini', () => {
    const { propuneri } = propuneCoduri([{ linie: 9, codRaw: 'x', x: 34, y: 0.1, z: 0 }], ['s2', 's4'], puncte)
    expect(propuneri[0]).toMatchObject({ cheie: 's4', metoda: 'prelungire' })
    expect(propuneri[0].distanta).toBeCloseTo(0.1, 9)
  })
  it('aceeași sudură propusă pentru două rânduri = conflict', () => {
    const { propuneri } = propuneCoduri([{ linie: 1, x: 12, y: 0, z: 0 }, { linie: 2, x: 12.2, y: 0, z: 0 }], ['s2'], puncte)
    expect(propuneri.map(p => [p.cheie, p.conflict])).toEqual([['s2', true], ['s2', true]])
  })
  it('lungime lipsă pe drum = fără estimare (nu se ghicește)', () => {
    const r = propuneCoduri([{ linie: 1, x: 12, y: 0, z: 0 }], ['s2'], { ...puncte, elemente: [{ lungime_m: null }, { lungime_m: 12 }, { lungime_m: 10 }] })
    expect(r.propuneri[0].cheie).toBeNull()
    expect(r.neestimate).toEqual(['s2'])
  })
})

describe('rezumat', () => {
  it('număr pe stări + listele de rezolvat; gol ≠ curat', () => {
    const rr = parseazaCoordonate('T99S1 0 0 0\nT99S2? 1 1 1\nT99S3 0 0\nT99S4 5 5 5\nT99S4 6 6 6', 99)
    const z = rezumat({ randuri: rr, suduriPachet: ['99|1|', '99|7|'] })
    expect(z.total).toBe(5)
    expect(z.peStari).toEqual({ ok: 1, repetata: 0, dublura: 2, nesigur: 1, nepotrivit: 0, ilizibil: 1 })
    expect(z.deRezolvat.nesigure.map(x => x.linie)).toEqual([2])
    expect(z.deRezolvat.dubluri.map(x => x.linie)).toEqual([4, 5])
    expect(z.deRezolvat.ilizibile.map(x => x.linie)).toEqual([3])
    expect(z.deRezolvat.inPacheteFaraCoordonate).toEqual(['99|7|'])
    expect(z.curat).toBe(false)
    expect(rezumat([]).curat).toBe(false)
    expect(rezumat(parseazaCoordonate('T99S1 0 0 0', 99)).curat).toBe(true)
  })
})

// rândurile de pachet (forma executie_tevi), inventate
const teava = (poz, sud, serie, lung, extra = {}) => ({ poz_in_pachet: poz, tip_rand: 'teava', serie_unica: serie, sarja: 'SJ' + poz, dimensiune: '610X7.1', lungime_m: lung, sudura_cod: sud, ...extra })

describe('lantSuduri — amonte / aval', () => {
  const pachete = [
    { cod_document_full: 'PCH-A', revizie: 1, tronson: 'T99', tevi: [teava(1, 'T99S1', 'S-A1', 12), teava(2, 'T99S2', 'S-A2', 11)] },
    { cod_document_full: 'PCH-B', revizie: 0, tronson: 'T99', tevi: [
      { poz_in_pachet: 1, tip_rand: 'separator' }, teava(2, 'T99S3', 'S-B1', 10), teava(3, null, 'S-B2', 9),
    ] },
  ]
  const { suduri, probleme } = lantSuduri(pachete)
  it('amonte = elementul rândului, aval = următorul element, peste granița de pachet și peste separator', () => {
    expect(suduri.map(s => [s.nrSudura, s.amonte?.serie_unica, s.aval?.serie_unica])).toEqual([
      ['T99S1', 'S-A1', 'S-A2'], ['T99S2', 'S-A2', 'S-B1'], ['T99S3', 'S-B1', 'S-B2'],
    ])
    expect(probleme).toEqual([])
  })
  it('codul pachetului poartă revizia doar când e > 0', () => {
    expect(suduri.map(s => s.pachet)).toEqual(['PCH-A rev.1', 'PCH-A rev.1', 'PCH-B'])
    expect(codPachet({})).toBe('')
  })
  it('legare: sudura fără element propriu ia amonte elementul de dinainte', () => {
    const r = lantSuduri([{ tronson: 99, tevi: [teava(1, 'T99S1', 'E1', 12), { poz_in_pachet: 2, tip_rand: 'legare', sudura_cod: 'T99S2' }, teava(3, 'T99S3', 'E3', 12)] }])
    expect(r.suduri.map(s => [s.nrSudura, s.amonte?.serie_unica, s.aval?.serie_unica])).toEqual([
      ['T99S1', 'E1', 'E3'], ['T99S2', 'E1', 'E3'], ['T99S3', 'E3', undefined],
    ])
    expect(r.suduri[0].intreUrmatoarea).toEqual([]) // nicio piesă între S1 și S2 → verificarea o arată, nu o ghicește
  })
  it('sudura de două ori în pachete și codul nevalid ies în probleme, nu în lanț', () => {
    const r = lantSuduri([{ tronson: 99, tevi: [teava(1, 'T99S1', 'E1', 12), teava(2, 'T99S1', 'E2', 12), teava(3, 'T99S?', 'E3', 12)] }])
    expect(r.suduri).toEqual([])
    expect(r.probleme.map(p => p.motiv)).toEqual(['cod_sudura_nevalid', 'sudura_dublata_in_pachete', 'sudura_dublata_in_pachete'])
  })
  it('punctePentruVerificare: elementul dintre suduri vecine + coordonatele confirmate', () => {
    const coord = new Map([['99|1|', { x: 0, y: 0, z: 0 }], ['99|2|', { x: 11, y: 0, z: 0 }]])
    const pv = punctePentruVerificare(suduri, coord)
    expect(pv.elemente.map(e => e.map(x => x.serie_unica))).toEqual([['S-A2'], ['S-B1']])
    const r = verificaDistante(pv.punctePeOrdine, pv.elemente)
    expect(r.verificate).toBe(1)
    expect(r.avertismente).toEqual([])
    expect(r.neverificate.map(x => x.motiv)).toEqual(['fara_coordonate'])
  })
})
