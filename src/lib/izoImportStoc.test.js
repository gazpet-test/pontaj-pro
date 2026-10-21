import { describe, it, expect } from 'vitest'
import {
  dataExcel, pereteDinDescriere, unghiDinDescriere, clasificaSerieTeava, tronsonIesire, citesteFoaie, evalueaza,
  depozitPropus, construiestePayload, serieCanon,
} from './izoImportStoc.js'

const coduri = { JUP: 9, ORN: 10, TOP: 11 }
const tronsoane = { T12: 16, T13: 17, T16: 20, T17: 21 }
const DESC71 = 'ţeavă izolată exterior cu polietilenă tip HDPE B3; ø 610 x7.1 mm L360NE, SR EN ISO 3183-2020 PSL2 SAW L=12m'
const DESC88 = 'ţeavă izolată exterior cu polietilenă tip HDPE B3; ø 610 x 8,8 mm L360NE, SR EN ISO 3183-2020 PSL2 SAW L=12m'

// rând „TEAVA 7.1 TOPLET” (A..AA)
const rT71 = (o = {}) => {
  const r = Array(27).fill(null)
  Object.assign(r, { 0: 1, 1: '247EK08603', 2: DESC71, 3: 'SA07348', 4: 1404, 5: 144016, 6: 46139, 7: 12.28, 8: 'M.L', 9: 46141, 13: 'LOT 2', 14: 'ORSOVA\r\n', 22: 36463, 23: 46141 })
  for (const [k, v] of Object.entries(o)) r[k] = v
  return r
}
// rând standard (A..X)
const rStd = (o = {}) => {
  const r = Array(24).fill(null)
  Object.assign(r, { 0: 1, 1: '264DB00025', 2: DESC88, 3: 'SA03585', 4: 1726, 5: 26070304, 6: 46205, 7: 12.41, 8: 'm.l.', 9: 56458, 10: 46208, 14: 'LOT 2', 15: 'DM JUPANESTI' })
  for (const [k, v] of Object.entries(o)) r[k] = v
  return r
}
const foaie = (foaie, randuri, start) => citesteFoaie({ fisier: 'X.xlsx', foaie, rows: [...Array(start).fill([]), ...randuri] })

describe('celulele', () => {
  it('data Excel din serial, fără fus orar', () => {
    expect(dataExcel(46140)).toBe('2026-04-28')
    expect(dataExcel(46191)).toBe('2026-06-18')
    expect(dataExcel('19/08/2026')).toBe('2026-08-19')
    expect(dataExcel('6/12.2026')).toEqual({ invalid: '6/12.2026' })
    expect(dataExcel(null)).toBe(null)
  })
  it('peretele din descriere (țeavă și curbă)', () => {
    expect(pereteDinDescriere(DESC71)).toBe(7.1)
    expect(pereteDinDescriere(DESC88)).toBe(8.8)
    expect(pereteDinDescriere('Curbe CMFØ 610/8/L360NE/6,1 - 20˚')).toBe(8)
    expect(pereteDinDescriere('Curbe CMFØ 610/12,5/L360NE/6,1 - 90˚')).toBe(12.5)
    expect(pereteDinDescriere('altceva')).toBe(null)
  })
  it('unghiul curbei', () => {
    expect(unghiDinDescriere('Curbe CMFØ 610/8/L360NE/6,1 - 20˚')).toBe(20)
    expect(unghiDinDescriere('Curbe CMFØ 610/8/L360NE/6,1 - 7,5°')).toBe(7.5)
    expect(unghiDinDescriere('fără')).toBe(null)
  })
  it.each([
    ['247EK08603', 'ok'], ['247EK0', 'placeholder'], ['264DB00', 'placeholder'], ['254CA10', 'placeholder'], ['SBD', 'test'],
    ['2545CA09771', 'conflict_2545CA'], ['254CA0977', 'format'], ['', 'gol'],
  ])('seria %s → %s', (s, c) => expect(clasificaSerieTeava(s).clasa).toBe(c))
  it('propunerea pentru 2545CA scoate un singur „5”', () => expect(clasificaSerieTeava('2545CA09771').propunere).toBe('254CA09771'))
  it('tronsonul de ieșire', () => {
    expect(tronsonIesire(17)).toEqual({ nr: 17 })
    expect(tronsonIesire('TR 12')).toEqual({ nr: 12 })
    expect(tronsonIesire('16-17')).toEqual({ ambiguu: '16-17' })
    expect(tronsonIesire(' ')).toBe(null)
  })
  it('serie canonică', () => expect(serieCanon(' 254-ca.09771 ')).toBe('254CA09771'))
})

describe('citesteFoaie', () => {
  it('Topleț 7.1: livrată pe tronson, sursa rândului, placeholder exclus', () => {
    const r = foaie('TEAVA 7.1 TOPLET', [rT71({ 17: 'CJPT-O 0033', 18: '247EK08603', 21: 17 }), rT71({ 1: '247EK0' })], 11)
    expect(r.randuri.length).toBe(1)
    expect(r.excluse).toEqual([{ sursa: { fisier: 'X.xlsx', foaie: 'TEAVA 7.1 TOPLET', rand: 13 }, serie: '247EK0', motiv: 'placeholder' }])
    expect(r.randuri[0]).toMatchObject({ serie: '247EK08603', lungime_mm: 12280, aviz_iesire: 'CJPT-O 0033', tronson_iesire: { nr: 17 }, dt_os: 'ORSOVA', sursa: { rand: 12 } })
  })
  it('curbele LOT 1 / LOT 3 sunt excluse la citire', () => {
    const r = Array(25).fill(null); Object.assign(r, { 1: 870, 2: 'Curbe CMFØ 610/8/L360NE/6,1 - 20˚', 3: 2520914, 12: 'LOT 3' })
    expect(foaie('CURBE LOT 2', [r], 12).excluse[0].motiv).toBe('curbă LOT 3')
  })
  it('rândul doar cu POZ se ignoră; fără serie dar cu material → fara_serie (blocant)', () => {
    const goal = Array(24).fill(null); goal[0] = 7
    const r = foaie('TEAVA 8.8 MM', [rStd({ 1: null }), rStd(), goal], 12)
    expect(r.randuri.length).toBe(1)
    expect(r.fara_serie).toEqual([{ sursa: { fisier: 'X.xlsx', foaie: 'TEAVA 8.8 MM', rand: 13 }, campuri: ['desc', 'sarja', 'kg', 'nrAviz', 'cant'] }])
    const { blocante_globale } = evalueaza(r.randuri, { coduri, tronsoane, faraSerie: r.fara_serie })
    expect(blocante_globale.length).toBe(1)
    const dec = { excluderi: [{ fisier: 'X.xlsx', foaie: 'TEAVA 8.8 MM', rand: 13, motiv: 'rând de test' }] }
    expect(evalueaza(r.randuri, { decizii: dec, coduri, tronsoane, faraSerie: r.fara_serie }).blocante_globale).toEqual([])
  })
  it('foaia trebuie să fie în workbook-ul ei', () => {
    expect(citesteFoaie({ fisier: 'J.xlsx', foaie: 'TEAVA 7.1 TOPLET', rows: [], tipFisier: 'jupanesti' }).foaie_gresita).toBe(true)
    expect(citesteFoaie({ fisier: 'T.xlsx', foaie: 'TEAVA 7.1 TOPLET', rows: [], tipFisier: 'toplet' }).foaie_gresita).toBeUndefined()
  })
  it('șarja normalizată fără spații (aceeași cheie ca la import)', () => {
    expect(foaie('TEAVA 8.8 MM', [rStd({ 3: ' sa 03585 ' })], 12).randuri[0]).toMatchObject({ sarja: 'SA03585', sarja_bruta: 'sa 03585' })
  })
})

describe('evalueaza', () => {
  const ev = (rows, foaieNume, start, decizii = {}) => evalueaza(foaie(foaieNume, rows, start).randuri, { decizii, coduri, tronsoane })
  it('Jupânești în stoc cu PV → receptionat la JUP; livrată → pe_tronson T12', () => {
    const { randuri } = ev([rStd(), rStd({ 1: '264DB00026', 16: 'CJPJ 0038', 17: 12, 18: '264DB00026', 19: 12.41, 20: 12.41, 21: 0 })], 'TEAVA 8.8 MM', 12)
    expect(randuri[0]).toMatchObject({ stare: 'receptionat', depozit_id: 9, perete_mm: 8.8, probleme: [] })
    expect(randuri[1]).toMatchObject({ stare: 'pe_tronson', tronson_id: 16, depozit_id: 9, probleme: [] })
  })
  it('Topleț: ORSOVA / CJPT-O → ORN; TOPLET → TOP; altceva → de decis', () => {
    expect(depozitPropus({ sursa: { foaie: 'TEAVA 7.1 TOPLET' }, dt_os: 'ORSOVA', aviz_iesire: null }, coduri)).toEqual({ cod: 'ORN', id: 10 })
    expect(depozitPropus({ sursa: { foaie: '8,8 TOPLET' }, dt_os: 'TOPLET', aviz_iesire: null }, coduri)).toEqual({ cod: 'TOP', id: 11 })
    expect(depozitPropus({ sursa: { foaie: 'TEAVA 7.1 TOPLET' }, dt_os: '', aviz_iesire: 'CJPT-O 0028' }, coduri)).toEqual({ cod: 'ORN', id: 10 })
    expect(depozitPropus({ sursa: { foaie: 'TEAVA 7.1 TOPLET' }, dt_os: 'ORSOVA (TOPLET)', aviz_iesire: null }, coduri).grup).toMatch(/ORSOVA \(TOPLET\)/)
  })
  it('grup de depozit neclar → problemă; decizia pe grup o rezolvă', () => {
    const rows = [rT71({ 14: 'ORSOVA (TOPLET)' })]
    expect(ev(rows, 'TEAVA 7.1 TOPLET', 11).randuri[0].probleme[0]).toMatch(/depozit neclar/)
    const d = ev(rows, 'TEAVA 7.1 TOPLET', 11, { depozit_grup: { 'Topleț · DT/OS „ORSOVA (TOPLET)”': 'TOP' } }).randuri[0]
    expect(d).toMatchObject({ depozit_cod: 'TOP', depozit_id: 11, probleme: [] })
  })
  it('2545CA blochează; corecția din decizii o rezolvă și păstrează seria brută', () => {
    const rows = [rStd({ 1: '2545CA09771', 2: DESC71 })]
    expect(ev(rows, 'TEAVA 7.1 MM', 12).randuri[0].probleme[0]).toMatch(/2545CA/)
    const b = ev(rows, 'TEAVA 7.1 MM', 12, { corectii_serie: { '2545CA09771': '254CA09771' } }).randuri[0]
    expect(b).toMatchObject({ serie: '254CA09771', serie_corectata_din: '2545CA09771', probleme: [] })
  })
  it('peretele foii diferit de descriere → blochează', () => {
    expect(ev([rStd({ 2: DESC71 })], 'TEAVA 8.8 MM', 12).randuri[0].probleme.join()).toMatch(/perete/)
  })
  it('neconformitatea blochează până la decizie; excluderea o scoate', () => {
    const rows = [rT71({ 14: 'TOPLET', 15: 'LIPSA MARCAJ' })]
    expect(ev(rows, 'TEAVA 7.1 TOPLET', 11).randuri[0].probleme.join()).toMatch(/neconformitate/)
    const r = ev(rows, 'TEAVA 7.1 TOPLET', 11, { excluderi: [{ fisier: 'X.xlsx', foaie: 'TEAVA 7.1 TOPLET', rand: 12, motiv: 'refuzat la recepție' }] })
    expect(r.randuri.length).toBe(0)
    expect(r.excluse[0].motiv).toMatch(/refuzat/)
  })
  it('debitarea parțială blochează', () => {
    expect(ev([rStd({ 16: 'CJPJ 1', 17: 12, 20: 6, 21: 6.41 })], 'TEAVA 8.8 MM', 12).randuri[0].probleme.join()).toMatch(/debitare parțială/)
  })
  it('aceeași serie de două ori în import → coliziune pe ambele rânduri', () => {
    const { randuri } = ev([rStd(), rStd({ 0: 2 })], 'TEAVA 8.8 MM', 12)
    expect(randuri.every(b => b.probleme.some(p => /coliziune/.test(p)))).toBe(true)
  })
})

describe('construiestePayload', () => {
  it('refuză cât există probleme; altfel dă formatul funcției de import', () => {
    const { randuri } = evalueaza(foaie('TEAVA 8.8 MM', [rStd()], 12).randuri, { coduri, tronsoane })
    const p = construiestePayload(randuri, [{ fisier: 'X.xlsx', sha256: 'a'.repeat(64) }], 'test')
    expect(p.bucati[0]).toMatchObject({ tip: 'teava', serie: '264DB00025', sarja: 'SA03585', lungime_mm: 12410, perete_mm: 8.8, stare: 'receptionat',
      depozit_id: 9, izolatie: 'PEHD', sursa: { fisier: 'X.xlsx', foaie: 'TEAVA 8.8 MM', rand: 13 } })
    const rau = evalueaza(foaie('TEAVA 8.8 MM', [rStd({ 1: '2545CA00001' })], 12).randuri, { coduri, tronsoane }).randuri
    expect(() => construiestePayload(rau, [], 'x')).toThrow(/neaplicabil/)
  })
  it('blocantele globale opresc payload-ul', () => {
    const { randuri } = evalueaza(foaie('TEAVA 8.8 MM', [rStd()], 12).randuri, { coduri, tronsoane })
    expect(() => construiestePayload(randuri, [], 'x', [{ sursa: {}, problema: 'rând fără serie' }])).toThrow(/neaplicabil/)
  })
  it('corecția (obiect cu notă) + neconformitatea acceptată ajung în observații; NRCD și ieșirea în atribute', () => {
    const dec = { corectii_serie: { '2545CA09771': { serie: '254CA09771', nota: 'corectat din 2545CA' } },
                  accepta_neconformitate: [{ fisier: 'X.xlsx', foaie: 'TEAVA 7.1 TOPLET', rand: 12 }] }
    const { randuri } = evalueaza(foaie('TEAVA 7.1 TOPLET', [rT71({ 1: '2545CA09771', 15: 'MARCAJ', 22: null, 23: null })], 11).randuri, { decizii: dec, coduri, tronsoane })
    expect(randuri[0].probleme).toEqual([])
    const b = construiestePayload(randuri, [], 't').bucati[0]
    expect(b).toMatchObject({ serie: '254CA09771', stare: 'receptionat', nrcd: { data: '2026-04-29' }, observatii: 'NECONFORM: MARCAJ · corectat din 2545CA',
      sursa: { serie_bruta: '2545CA09771' } })
    expect(b.pv_receptie).toBeUndefined()
  })
  it('pe tronson: doar tronson_id, depozitul de plecare ca depozit_origine_id (locul exclusiv)', () => {
    const { randuri } = evalueaza(foaie('TEAVA 8.8 MM', [rStd({ 1: '264DB00026', 16: 'CJPJ 0038', 17: 12, 18: '264DB00026', 19: 12.41, 20: 12.41, 21: 0 })], 12).randuri, { coduri, tronsoane })
    const b = construiestePayload(randuri, [{ fisier: 'X.xlsx', sha256: 'a'.repeat(64) }], 'test').bucati[0]
    expect(b).toMatchObject({ stare: 'pe_tronson', tronson_id: 16, depozit_origine_id: 9 })
    expect(b.depozit_id).toBeUndefined()
  })
})

describe('review #807', () => {
  const ev = (rows, foaieNume, start, decizii = {}) => evalueaza(foaie(foaieNume, rows, start).randuri, { decizii, coduri, tronsoane })
  it('date calendaristic imposibile → invalide', () => {
    expect(dataExcel('31/02/2026')).toEqual({ invalid: '31/02/2026' })
    expect(dataExcel('29.02.2025')).toEqual({ invalid: '29.02.2025' })
    expect(dataExcel('29.02.2024')).toBe('2024-02-29')
  })
  it('NRCD fără PV → receptionat; fără NRCD și fără PV → sosit; NRCD necitit → blocant', () => {
    expect(ev([rT71({ 22: null, 23: null })], 'TEAVA 7.1 TOPLET', 11).randuri[0].stare).toBe('receptionat')
    expect(ev([rT71({ 9: null, 22: null, 23: null })], 'TEAVA 7.1 TOPLET', 11).randuri[0].stare).toBe('sosit')
    expect(ev([rT71({ 9: '31/02/2026', 22: null, 23: null })], 'TEAVA 7.1 TOPLET', 11).randuri[0].probleme.join()).toMatch(/NRCD necitită/)
  })
  it('seria la ieșire diferită de a rândului → blocant', () => {
    const r = ev([rT71({ 17: 'CJPT-O 0033', 18: '247EK09999', 21: 17 })], 'TEAVA 7.1 TOPLET', 11).randuri[0]
    expect(r.probleme.join()).toMatch(/seria la ieșire/)
  })
  it('ieșire fără aviz: tronson sau altă cantitate → blocant; seria/cantitatea precompletate cu ale rândului → nu', () => {
    expect(ev([rT71({ 21: 17 })], 'TEAVA 7.1 TOPLET', 11).randuri[0].probleme.join()).toMatch(/fără aviz de ieșire/)
    expect(ev([rStd({ 18: '264DB00025', 19: 12.41 })], 'TEAVA 8.8 MM', 12).randuri[0].probleme).toEqual([])
    expect(ev([rStd({ 18: '264DB00025', 19: 6.2 })], 'TEAVA 8.8 MM', 12).randuri[0].probleme.join()).toMatch(/fără aviz de ieșire/)
  })
  it('pe tronson cu depozit de origine neclar → blocant (originea nu se pierde)', () => {
    const r = ev([rT71({ 14: 'ALTCEVA', 17: 'CJPT 0033', 18: '247EK08603', 21: 17 })], 'TEAVA 7.1 TOPLET', 11).randuri[0]
    expect(r.stare).toBe('pe_tronson')
    expect(r.probleme.join()).toMatch(/depozit neclar/)
  })
  it('corecția de serie greșit tastată → blocant', () => {
    const r = ev([rT71({ 1: '2545CA09771' })], 'TEAVA 7.1 TOPLET', 11, { corectii_serie: { '2545CA09771': '254CA0977' } }).randuri[0]
    expect(r.probleme.join()).toMatch(/nu respectă formatul/)
  })
})

describe('review #807 r2 + răspunsurile MP', () => {
  const ev = (rows, foaieNume, start, decizii = {}) => evalueaza(foaie(foaieNume, rows, start).randuri, { decizii, coduri, tronsoane })
  const curba = (o = {}) => { const r = Array(25).fill(null); Object.assign(r, { 1: '362', 2: 'Curbe CMFØ 610/8/L360NE/6,1 - 20˚', 3: '2520914', 12: 'LOT 2', 13: 'TOPLET', 16: 'CJPT 0026', 17: 46259 }, o); return r }
  it('ieșire parțială cu aviz → blocant', () => {
    expect(ev([rStd({ 16: 'CJPJ 0038', 17: 12, 18: '264DB00025', 19: 6.2 })], 'TEAVA 8.8 MM', 12).randuri[0].probleme.join()).toMatch(/ieșire parțială/)
  })
  it('dată completată dar necitită → blocant (aviz, PV chiar cu număr)', () => {
    expect(ev([rStd({ 6: '31/02/2026' })], 'TEAVA 8.8 MM', 12).randuri[0].probleme.join()).toMatch(/data avizului necitită/)
    expect(ev([rStd({ 10: '31/02/2026' })], 'TEAVA 8.8 MM', 12).randuri[0].probleme.join()).toMatch(/data PV necitită/)
  })
  it('izolația: PEHD din descriere; fără mențiune → necunoscută (nu „neizolata” ghicit)', () => {
    const t = construiestePayload(ev([rStd()], 'TEAVA 8.8 MM', 12).randuri, [], 'x').bucati[0]
    expect(t.izolatie).toBe('PEHD')
    const c = construiestePayload(ev([curba({ 16: null, 17: null })], 'CURBE LOT 2', 12).randuri, [], 'x').bucati[0]
    expect(c.izolatie).toBeUndefined()
  })
  it('tronson din decizie: aviz+serie are prioritate, apoi aviz (TR lipsă / ambiguu)', () => {
    const dec = { tronson_aviz: { 'CJPT 0026': 17 }, tronson_aviz_serie: { 'CJPT 0026|362': 16 } }
    const tr = { ...tronsoane, T16: 20, T17: 21 }
    const a = evalueaza(foaie('CURBE LOT 2', [curba()], 12).randuri, { decizii: dec, coduri, tronsoane: tr }).randuri[0]
    expect(a).toMatchObject({ stare: 'pe_tronson', tronson_cod: 'T16' })
    const b = evalueaza(foaie('CURBE LOT 2', [curba({ 1: '102', 20: '16-17' })], 12).randuri, { decizii: dec, coduri, tronsoane: tr }).randuri[0]
    expect(b).toMatchObject({ stare: 'pe_tronson', tronson_cod: 'T17' })
  })
  it('ignora_iesire: câmpurile de ieșire fără aviz nu mai blochează, bucata rămâne în stoc', () => {
    const r = curba({ 1: '1198', 16: null, 17: null, 20: 16 })
    expect(ev([r], 'CURBE LOT 2', 12).randuri[0].probleme.join()).toMatch(/fără aviz de ieșire/)
    const ok = ev([r], 'CURBE LOT 2', 12, { ignora_iesire: [{ fisier: 'X.xlsx', foaie: 'CURBE LOT 2', rand: 13, motiv: 'încă în stoc' }] }).randuri[0]
    expect(ok.probleme).toEqual([])
    expect(ok.stare).toBe('sosit')
    expect(ok.corectii[0]).toMatchObject({ camp: 'iesire', motiv: 'încă în stoc' })
  })
  it('corectii_camp: pe rânduri / pe aviz, dată validată, fără wildcard, urmă în sursă', () => {
    const dec = { corectii_camp: [{ foaie: 'TEAVA 8.8 MM', randuri: [13], camp: 'pv_nr', valoare: '86188', motiv: 'MP' },
                                  { camp: 'data_aviz', valoare: '2026-01-01' }] }
    const b = ev([rStd({ 9: null })], 'TEAVA 8.8 MM', 12, dec).randuri[0]
    expect(b.pv_nr).toBe('86188')
    expect(b.corectii).toEqual([{ camp: 'pv_nr', inainte: null, dupa: '86188', motiv: 'MP' }])
    expect(construiestePayload([b], [], 'x').bucati[0].sursa.corectii.length).toBe(1)
    const rau = ev([rStd()], 'TEAVA 8.8 MM', 12, { corectii_camp: [{ randuri: [13], camp: 'data_iesire', valoare: '2026-02-31' }] }).randuri[0]
    expect(rau.probleme.join()).toMatch(/nu e o dată/)
    const nepermis = ev([rStd()], 'TEAVA 8.8 MM', 12, { corectii_camp: [{ randuri: [13], camp: 'serie', valoare: 'X' }] }).randuri[0]
    expect(nepermis.probleme.join()).toMatch(/câmp nepermis/)
  })
  it('depozit_grup cu notă și neconformitate acceptată cu notă → observații', () => {
    const dec = { depozit_grup: { 'Topleț · DT/OS „ALTCEVA”': { cod: 'TOP', nota: 'descărcate excepțional' } },
                  accepta_neconformitate: [{ fisier: 'X.xlsx', foaie: 'TEAVA 7.1 TOPLET', rand: 12, nota: 'carantină' }] }
    const b = ev([rT71({ 14: 'ALTCEVA', 15: 'MARCAJ' })], 'TEAVA 7.1 TOPLET', 11, dec).randuri[0]
    expect(b.probleme).toEqual([])
    expect(construiestePayload([b], [], 'x').bucati[0].observatii).toBe('NECONFORM: MARCAJ — carantină · descărcate excepțional')
  })
})

describe('accepta_iesire_integrala', () => {
  it('diferența de rotunjire acceptată doar pe rândul numit, cu urmă', () => {
    const r = rStd({ 16: 'CJPJ 0038', 17: 12, 18: '264DB00025', 19: 12.40 })
    const ev = d => evalueaza(foaie('TEAVA 8.8 MM', [r], 12).randuri, { decizii: d, coduri, tronsoane }).randuri[0]
    expect(ev({}).probleme.join()).toMatch(/ieșire parțială/)
    const ok = ev({ accepta_iesire_integrala: [{ fisier: 'X.xlsx', foaie: 'TEAVA 8.8 MM', rand: 13, motiv: 'rotunjire' }] })
    expect(ok.probleme).toEqual([])
    expect(ok.corectii[0]).toMatchObject({ camp: 'cant_iesire', inainte: 12.4, dupa: 12.41, motiv: 'rotunjire' })
  })
})
