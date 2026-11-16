// Teste pe date SINTETICE (serii inventate „SX…”, tronson fictiv T1, km 1+000 – 1+030).
// Valorile așteptate sunt calculate de mână din intrări (L25), nu din codul testat.
import { describe, it, expect } from 'vitest'
import {
  kmInMm, mmDinMetri, fmtKmMm, calculeazaSursa, comparaSurse, reconciliazaTronson, foiDinPlatforma, limiteTronson,
} from './conductaTronsonLogica.js'
import { uneste, goluri } from './probeTronsoaneLogica.js'

const T = { cod: 'T1', km_start_m: 1000, km_end_m: 1030 }
// rând de schemă: km = capătul din aval al piesei
const r = (rand, serie, lungime, km, sudura = '', extra = {}) => ({ rand, poz: rand, fel: 'teava', serie, tip: 'L360', lungime, km, sudura, ...extra })
const foaie = (id, randuri, extra = {}) => ({ id, cod: id, revizie: 0, stare: 'test', conventieKm: 'km_capat_pe_rand', conventieConfirmata: true, randuri, ...extra })
const schema = foi => calculeazaSursa({ sursa: 'schema', foi, tronson: T })
const coduri = rez => rez.anomalii.map(a => a.cod).sort()
const stari = rez => rez.banda.map(s => [s.de_la_m, s.pana_la_m, s.stare])

describe('kmInMm / mmDinMetri / fmtKmMm', () => {
  it('citește km strict', () => {
    expect(kmInMm('24+012.46')).toBe(24012460)
    expect(kmInMm('24+012,46')).toBe(24012460)
    expect(kmInMm('24+024.9')).toBe(24024900)
    expect(kmInMm('1+010')).toBe(1010000)
    expect(kmInMm(1010.5)).toBe(1010500)
    expect(kmInMm('')).toBe(null)
    expect(kmInMm(null)).toBe(null)
  })
  it('refuză km ambigui sau stricați (nu repară)', () => {
    expect(kmInMm('27.598.97')).toBeNaN()
    expect(kmInMm('1+10')).toBeNaN()
    expect(kmInMm('1+010.1234')).toBeNaN()
    expect(kmInMm('+010')).toBeNaN()
    expect(kmInMm('1+010+5')).toBeNaN()
    expect(kmInMm(-3)).toBeNaN()
  })
  it('lungimi în mm, RO și EN', () => {
    expect(mmDinMetri('12,34')).toBe(12340)
    expect(mmDinMetri('12.400')).toBe(12400)
    expect(mmDinMetri(12.46)).toBe(12460)
    expect(mmDinMetri('')).toBe(null)
    expect(mmDinMetri('-1')).toBeNaN()
    expect(mmDinMetri('abc')).toBeNaN()
    expect(mmDinMetri('1.23456')).toBeNaN()
  })
  it('formatează km', () => {
    expect(fmtKmMm(24012460)).toBe('24+012.46')
    expect(fmtKmMm(1000000)).toBe('1+000.00')
    expect(fmtKmMm(null)).toBe('—')
  })
  it('limitele tronsonului', () => {
    expect(limiteTronson(T)).toEqual({ a: 1000000, b: 1030000 })
    expect(limiteTronson({ cod: 'T1', km_start_m: 1000, km_end_m: null })).toBe(null)
    expect(limiteTronson({ cod: 'T1', km_start_m: 1030, km_end_m: 1000 })).toBe(null)
  })
})

describe('piesa comună la frontiera dintre două foi', () => {
  const A = foaie('A', [r(1, 'SX001', 10, '1+010', 'T1S1'), r(2, 'SX002', 12, '1+022', '0')], { ordine: 1 })
  const B = foaie('B', [r(1, 'SX002', 12, '1+022', 'T1S2'), r(2, 'SX003', 8, '1+030', 'T1S3')], { ordine: 2 })
  const rez = schema([B, A]) // ordinea foilor vine din `ordine`, nu din listă

  it('o singură piesă, cu sudura păstrată și ambele rânduri în proveniență', () => {
    expect(rez.inainte.piese).toBe(4)
    expect(rez.inainte.lungime_m).toBe(42)
    expect(rez.dupa.piese).toBe(3)
    expect(rez.dupa.lungime_m).toBe(30)
    expect(rez.frontiere).toEqual([{ piesa: 'schema:A:2', serie: 'SX002', lungime_m: 12, km_mm: 1022000, sudura: 'T1S2', randuri: ['A#2', 'B#1'] }])
    const p = rez.piese.find(x => x.serie === 'SX002')
    expect(p.sudura.canon).toBe('TR1S2')
    expect(p.provenienta.map(x => `${x.foaie}#${x.rand}`)).toEqual(['A#2', 'B#1'])
    expect(rez.dupa.suduri_cu_cod).toBe(3)
    expect(rez.dupa.capete_fara_cod).toBe(0)
  })
  it('banda: totul realizat, fără suprapuneri, fără anomalii', () => {
    expect(rez.dupa.realizat_m).toBe(30)
    expect(rez.dupa.necunoscut_m).toBe(0)
    expect(rez.dupa.suprapuneri_m).toBe(0)
    expect(rez.anomalii).toEqual([])
    expect(stari(rez)).toEqual([[1000, 1010, 'realizat'], [1010, 1022, 'realizat'], [1022, 1030, 'realizat']])
  })
  it('aceeași serie la frontieră, dar altă poziție: NU se unește', () => {
    const B2 = foaie('B', [r(1, 'SX002', 12, '1+025', 'T1S2')], { ordine: 2 })
    const x = schema([A, B2])
    expect(x.dupa.piese).toBe(3)
    expect(x.frontiere).toEqual([])
    expect(coduri(x)).toContain('frontiera_neconfirmata')
  })
  it('suduri diferite pe cele două apariții: nu se alege una', () => {
    const A2 = foaie('A', [r(1, 'SX001', 10, '1+010', 'T1S1'), r(2, 'SX002', 12, '1+022', 'T1S9')], { ordine: 1 })
    const x = schema([A2, B])
    expect(x.dupa.piese).toBe(3)
    expect(coduri(x)).toEqual(['frontiera_suduri_diferite'])
    expect(x.piese.find(p => p.serie === 'SX002').sudura.stare).toBe('necunoscuta')
  })
})

describe('suprapunere reziduală', () => {
  const rez = schema([foaie('A', [r(1, 'SX001', 10, '1+010', 'T1S1'), r(2, 'SX002', 11, '1+020', 'T1S2'), r(3, 'SX003', 10, '1+030', 'T1S3')])])
  it('se vede, nu se ascunde', () => {
    // SX002 = [1009, 1020): 1 m peste SX001
    expect(rez.dupa.lungime_m).toBe(31)
    expect(rez.dupa.realizat_m).toBe(30)
    expect(rez.dupa.suprapuneri_m).toBe(1)
    const s = rez.banda.find(x => x.suprapunere)
    expect([s.de_la_m, s.pana_la_m, s.stare, s.piese]).toEqual([1009, 1010, 'realizat', ['schema:A:1', 'schema:A:2']])
    expect(rez.anomalii.map(a => [a.cod, a.nivel, a.mesaj])).toEqual([['suprapunere', 'blocant', 'Piese suprapuse pe km 1+009.00–1+010.00 (1,00 m)']])
  })
})

describe('gol necunoscut', () => {
  const rez = schema([foaie('A', [r(1, 'SX001', 10, '1+010', 'T1S1'), r(2, 'SX002', 15, '1+030', 'T1S2')])])
  it('golul e „necunoscut”, nu „restant”', () => {
    expect(stari(rez)).toEqual([[1000, 1010, 'realizat'], [1010, 1015, 'necunoscut'], [1015, 1030, 'realizat']])
    expect(rez.banda[1].motiv).toBe('fara_date')
    expect(rez.dupa.realizat_m).toBe(25)
    expect(rez.dupa.necunoscut_m).toBe(5)
    expect(rez.dupa.restant_m).toBe(0)
  })
  it('restant doar din intervale confirmate explicit; peste piese = conflict', () => {
    const x = calculeazaSursa({ sursa: 'schema', foi: [foaie('A', [r(1, 'SX001', 10, '1+010', 'T1S1'), r(2, 'SX002', 15, '1+030', 'T1S2')])], tronson: T,
      restanteConfirmate: [{ de_la_m: 1008, pana_la_m: 1015 }] })
    expect(stari(x)).toEqual([[1000, 1008, 'realizat'], [1008, 1010, 'necunoscut'], [1010, 1015, 'restant'], [1015, 1030, 'realizat']])
    expect(x.banda[1].motiv).toBe('conflict')
    expect(x.dupa.restant_m).toBe(5)
    expect(coduri(x)).toEqual(['conflict_restant_realizat'])
  })
})

describe('piesa doar în schemă / doar în platformă', () => {
  const s = schema([foaie('S', [r(1, 'SX001', 10, '1+010', 'T1S1'), r(2, 'SX002', 10, '1+020', 'T1S2'), r(3, 'SX003', 10, '1+030', 'T1S3')])])
  const p = calculeazaSursa({ sursa: 'platforma', tronson: T, foi: [foaie('P', [r(1, 'SX001', 10, '1+010', 'T1S1'), r(2, 'SX002', 10, '1+020', 'T1S2'), r(3, 'SX004', 10, '1+030', 'T1S4')])] })
  const d = comparaSurse(s, p)
  it('lipsă = bucată cu cheie fără pereche', () => {
    expect(d.doar_schema).toEqual(['schema:S:3'])
    expect(d.doar_platforma).toEqual(['platforma:P:3'])
    expect(d.rezumat.perechi).toBe(2)
    expect(d.rezumat.identice).toBe(2)
    expect(d.suduri_doar_schema).toEqual(['TR1S3'])
    expect(d.suduri_doar_platforma).toEqual(['TR1S4'])
  })
  it('serii distincte ≠ bucăți: o serie tăiată în două bucăți', () => {
    const s2 = schema([foaie('S', [r(1, 'SX001', 5, '1+005', 'T1S1'), r(2, 'SX001', 7, '1+012', 'T1S2')])])
    const p2 = calculeazaSursa({ sursa: 'platforma', tronson: T, foi: [foaie('P', [r(1, 'SX001', 7, '1+012', 'T1S2')])] })
    const x = comparaSurse(s2, p2)
    expect(x.rezumat.serii_doar_schema).toBe(0)      // pe serii nu lipsește nimic…
    expect(x.rezumat.doar_schema).toBe(1)            // …dar o bucată lipsește
    expect(x.doar_schema).toEqual(['schema:S:1'])    // cea de 5 m (perechea se face întâi pe lungime egală)
    expect(s2.dupa.bucati_aceeasi_serie).toBe(2)
    expect(coduri(s2)).not.toContain('dublura_identitate')
  })
  it('aceeași serie, aceeași lungime, în două locuri = dublură de decis', () => {
    const x = schema([foaie('S', [r(1, 'SX001', 5, '1+005', 'T1S1'), r(2, 'SX001', 5, '1+010', 'T1S2')])])
    expect(coduri(x)).toEqual(['dublura_identitate'])
  })
  it('piesă mutată și sudură diferită', () => {
    const p3 = calculeazaSursa({ sursa: 'platforma', tronson: T, foi: [foaie('P', [r(1, 'SX001', 10, '1+012', 'T1S7')])] })
    const s3 = schema([foaie('S', [r(1, 'SX001', 10, '1+010', 'T1S1')])])
    const x = comparaSurse(s3, p3)
    expect(x.perechi).toEqual([{ schema: 'schema:S:1', platforma: 'platforma:P:1', serie: 'SX001', tip: 'L360', dif: ['mutat', 'sudura'], delta_m: 2, lungime_schema_m: 10, lungime_platforma_m: 10, sudura_schema: 'T1S1', sudura_platforma: 'T1S7' }])
  })
  it('piese fără serie: necomparabile, nu lipsă', () => {
    const p4 = calculeazaSursa({ sursa: 'platforma', tronson: T, foi: [foaie('P', [{ rand: 1, fel: 'curba', serie: '', tip: 'CIC', lungime: 2, km: '1+002', sudura: 'T1S1' }])] })
    const x = comparaSurse(schema([]), p4)
    expect(x.rezumat.necomparabile_platforma).toBe(1)
    expect(x.rezumat.doar_platforma).toBe(0)
  })
})

describe('km neparsabil', () => {
  const rez = schema([foaie('A', [r(1, 'SX001', 10, '1+010', 'T1S1'), r(2, 'SX002', 10, '1.020.00', 'T1S2'), r(3, 'SX003', 10, '1+030', 'T1S3')])])
  it('piesa rămâne fără poziție, zona e necunoscută, nimic nu se mută', () => {
    const p = rez.piese.find(x => x.serie === 'SX002')
    expect([p.a_mm, p.b_mm, p.anomalii]).toEqual([null, null, ['km_neparsabil']])
    expect(rez.piese.find(x => x.serie === 'SX003').a_mm).toBe(1020000)
    expect(stari(rez)).toEqual([[1000, 1010, 'realizat'], [1010, 1020, 'necunoscut'], [1020, 1030, 'realizat']])
    expect(rez.dupa.lungime_m).toBe(30)
    expect(rez.dupa.realizat_m).toBe(20)
    expect(rez.dupa.piese_fara_pozitie).toBe(1)
    expect(rez.anomalii.map(a => [a.cod, a.nivel, a.valoare])).toEqual([['km_neparsabil', 'blocant', '1.020.00']])
  })
})

describe('lungime zero / lipsă', () => {
  it('curba de lungime 0 nu acoperă nimic (avertisment)', () => {
    const rez = schema([foaie('A', [r(1, 'SX001', 10, '1+010', 'T1S1'), { rand: 2, fel: 'curba', serie: 'C1', tip: 'CIC', lungime: 0, km: '1+010', sudura: 'T1S2' }, r(3, 'SX002', 20, '1+030', 'T1S3')])])
    const c = rez.piese.find(x => x.fel === 'curba')
    expect([c.lungime_mm, c.a_mm, c.b_mm]).toEqual([0, 1010000, 1010000])
    expect(rez.anomalii.map(a => [a.cod, a.nivel])).toEqual([['lungime_zero', 'avertisment']])
    expect(rez.dupa.realizat_m).toBe(30)
    expect(rez.dupa.curbe).toBe(1)
    expect(rez.dupa.suduri_cu_cod).toBe(3)
  })
  it('convenția cumulată: o lungime lipsă oprește lanțul (pozițiile următoare = necunoscute)', () => {
    const f = foaie('P', [r(1, 'SX001', 10), r(2, 'SX002', ''), r(3, 'SX003', 10)], { conventieKm: 'start_inceput_prima_piesa', kmStart: 1000 })
    const rez = schema([f])
    expect(rez.piese.map(p => [p.serie, p.a_mm, p.b_mm])).toEqual([['SX001', 1000000, 1010000], ['SX002', null, null], ['SX003', null, null]])
    expect(coduri(rez)).toEqual(['lant_intrerupt', 'lungime_lipsa'])
    expect(rez.dupa.necunoscut_m).toBe(20)
  })
})

describe('schema goală', () => {
  it('totul necunoscut, NU neexecutat', () => {
    for (const foi of [[], [foaie('A', [])]]) {
      const rez = schema(foi)
      expect(rez.dupa.piese).toBe(0)
      expect(stari(rez)).toEqual([[1000, 1030, 'necunoscut']])
      expect(rez.dupa.realizat_m).toBe(0)
      expect(rez.dupa.restant_m).toBe(0)
      expect(rez.dupa.necunoscut_m).toBe(30)
      expect(coduri(rez)).toEqual(['sursa_goala'])
    }
  })
  it('fără limite de tronson și fără piese: bandă goală, anomalie', () => {
    const rez = calculeazaSursa({ sursa: 'schema', foi: [], tronson: { cod: 'T1' } })
    expect(rez.banda).toEqual([])
    expect(coduri(rez)).toEqual(['limite_tronson_lipsa', 'sursa_goala'])
  })
})

describe('convențiile km ale pachetelor din platformă (se declară, nu se ghicesc)', () => {
  const pachete = [{ id: 7, cod_document_full: 'DOC-A', revizie: 0, status: 'draft', km_start_m: '1000.00' }]
  const tevi = [
    { id: 3, pachet_id: 7, poz_in_pachet: 2, tip_rand: 'teava', serie_unica: 'SX002', tip: 'L360', lungime_m: '12.000', sudura_cod: 'T1S2', sudura_refacuta: true, sudura_sant_pending: false },
    { id: 2, pachet_id: 7, poz_in_pachet: 1, tip_rand: 'teava', serie_unica: 'SX001', tip: 'L360', lungime_m: '10.000', sudura_cod: 'T1S1', sudura_refacuta: false, sudura_sant_pending: false },
    { id: 4, pachet_id: 7, poz_in_pachet: 3, tip_rand: 'teava', serie_unica: 'SX003', tip: 'L360', lungime_m: '8.000', sudura_cod: null, sudura_refacuta: false, sudura_sant_pending: true },
    { id: 5, pachet_id: 7, poz_in_pachet: 4, tip_rand: 'separator', serie_unica: null, lungime_m: null },
    { id: 6, pachet_id: 7, poz_in_pachet: 5, tip_rand: 'teava', serie_unica: null, lungime_m: null, sudura_cod: null },
  ]
  it('început = începutul primei piese', () => {
    const rez = calculeazaSursa({ sursa: 'platforma', tronson: T, foi: foiDinPlatforma(pachete, tevi) })
    expect(rez.piese.map(p => [p.serie, p.a_mm / 1000, p.b_mm / 1000])).toEqual([['SX001', 1000, 1010], ['SX002', 1010, 1022], ['SX003', 1022, 1030]])
    expect(rez.suduri.map(s => [s.original, s.stare, s.refacuta])).toEqual([['T1S1', 'sudata', false], ['T1S2', 'sudata', true], ['', 'restanta', false]])
    expect(rez.ignorate.map(i => i.motiv)).toEqual(['separator', 'rand_gol'])
    expect(coduri(rez)).toEqual(['conventie_km_neconfirmata'])
    expect(rez.dupa.suduri_restante).toBe(1)
  })
  it('început = prima sudură (capătul primei piese)', () => {
    const rez = calculeazaSursa({ sursa: 'platforma', tronson: T, foi: foiDinPlatforma(pachete, tevi, { conventie: 'start_capat_prima_piesa' }) })
    expect(rez.piese.map(p => [p.a_mm / 1000, p.b_mm / 1000])).toEqual([[990, 1000], [1000, 1012], [1012, 1020]])
    expect(rez.dupa.in_afara_limitelor_m).toBe(10)
    expect(coduri(rez)).toEqual(['conventie_km_neconfirmata', 'in_afara_limitelor'])
  })
  it('cod de sudură + marcaj „în șanț” pe același rând = contradicție', () => {
    const t2 = [{ id: 1, pachet_id: 7, poz_in_pachet: 1, tip_rand: 'teava', serie_unica: 'SX001', tip: 'L360', lungime_m: '10', sudura_cod: 'T1S1', sudura_sant_pending: true }]
    const rez = calculeazaSursa({ sursa: 'platforma', tronson: T, foi: foiDinPlatforma(pachete, t2, { confirmata: true }) })
    expect(rez.suduri[0].stare).toBe('necunoscuta')
    expect(coduri(rez)).toEqual(['sudura_contradictorie'])
  })
  it('sudură ilizibilă nu se repară', () => {
    const rez = schema([foaie('A', [r(1, 'SX001', 10, '1+010', 'TTS1R')])])
    expect(rez.suduri[0]).toMatchObject({ original: 'TTS1R', canon: null, stare: 'necunoscuta' })
    expect(coduri(rez)).toEqual(['sudura_ilizibila'])
  })
})

describe('paritate cu reuniunea existentă (probeTronsoaneLogica.uneste / goluri)', () => {
  it('realizat = reuniunea, necunoscut = golurile, suprapuneri = material − reuniune', () => {
    // 40 de piese pseudo-aleatoare (generator determinist), cu goluri și suprapuneri
    let s = 7
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    const randuri = []
    let km = 1000000
    for (let i = 1; i <= 40; i++) {
      const L = 500 + Math.floor(rnd() * 900)                 // 0,5 … 1,4 m
      km += Math.floor(rnd() * 400) - 150                      // gol sau suprapunere de până la 0,25 m
      const b = km + L
      randuri.push(r(i, `SX${i}`, L / 1000, `1+${String(Math.floor((b - 1000000) / 1000)).padStart(3, '0')}.${String(b % 1000).padStart(3, '0')}`, `T1S${i}`))
      km = b
    }
    const rez = schema([foaie('A', randuri)])
    const iv = rez.piese.map(p => ({ de_la: Math.max(p.a_mm, 1000000), pana_la: Math.min(p.b_mm, 1030000) })).filter(x => x.pana_la > x.de_la)
    expect(rez.dupa.in_afara_limitelor_m).toBeGreaterThan(0)   // setul trece și de capătul tronsonului
    const u = uneste(iv), g = goluri(1000000, 1030000, iv)
    const sum = l => l.reduce((t, x) => t + x.pana_la - x.de_la, 0)
    expect(rez.dupa.realizat_m).toBe(sum(u) / 1000)
    expect(rez.dupa.necunoscut_m).toBe(sum(g) / 1000)
    expect(Math.round(rez.dupa.suprapuneri_m * 1000)).toBe(sum(iv) - sum(u))
    expect(rez.dupa.piese_fara_pozitie).toBe(0)
    expect(rez.dupa.suprapuneri_m).toBeGreaterThan(0)          // setul chiar are suprapuneri…
    expect(g.length).toBeGreaterThan(1)                         // …și goluri interioare
  })
})

describe('reconciliazaTronson', () => {
  it('fără platformă: doar schema, fără raport de diferențe', () => {
    const x = reconciliazaTronson({ tronson: T, schema: [foaie('A', [r(1, 'SX001', 30, '1+030', 'T1S1')])] })
    expect(x.platforma).toBe(null)
    expect(x.diferente).toBe(null)
    expect(x.schema.dupa.realizat_m).toBe(30)
  })
})
