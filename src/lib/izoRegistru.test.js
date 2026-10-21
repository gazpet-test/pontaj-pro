import { describe, it, expect } from 'vitest'
import { serieCanon, dimensiuneDinRegistru, patchDinRegistru, indexFolosite, sugestiiRegistru } from './izoRegistru.js'

describe('serieCanon — aceeași regulă ca serie_canon din registru', () => {
  it('scoate spații / . _ / - și face majuscule', () => {
    expect(serieCanon('254-ca 09.771')).toBe('254CA09771')
    expect(serieCanon(' 247ek_08/603 ')).toBe('247EK08603')
  })
  it('gol / null → șir gol', () => {
    expect(serieCanon(null)).toBe('')
    expect(serieCanon(undefined)).toBe('')
  })
})

describe('dimensiuneDinRegistru', () => {
  it('țeava: DIAMETRUXPERETE, ca rândurile existente', () => {
    expect(dimensiuneDinRegistru({ tip_cod: 'teava', diametru_mm: 610, perete_mm: '7.1' })).toBe('610X7.1')
  })
  it('curba: plus unghiul, citibil de extractUnghi', () => {
    const d = dimensiuneDinRegistru({ tip_cod: 'curba', diametru_mm: 610, perete_mm: 8, unghi_curba: '30.0' })
    expect(d).toBe('610X8 30°')
    expect(d.match(/(\d+)\s*[°˚]/)[1]).toBe('30')
  })
  it('fără diametru și perete → null (nu suprascrie)', () => {
    expect(dimensiuneDinRegistru({ tip_cod: 'teava' })).toBeNull()
  })
})

describe('patchDinRegistru', () => {
  it('țeava: serie, șarjă, lungime în m, dimensiune', () => {
    expect(patchDinRegistru({ tip_cod: 'teava', serie: '254CA09771', sarja: 'SA0818', lungime_mm: 12280, diametru_mm: 610, perete_mm: 7.1 }))
      .toEqual({ serie_unica: '254CA09771', sarja: 'SA0818', lungime_m: 12.28, dimensiune: '610X7.1' })
  })
  it('curba: fără lungime; șarja lipsă nu se scrie', () => {
    expect(patchDinRegistru({ tip_cod: 'curba', serie: '870', sarja: null, lungime_mm: null, diametru_mm: 610, perete_mm: 8, unghi_curba: 20 }))
      .toEqual({ serie_unica: '870', dimensiune: '610X8 20°' })
  })
})

describe('sugestiiRegistru', () => {
  const registru = [
    { id: 1, serie: '254CA09771', tip_cod: 'teava' },
    { id: 2, serie: '247EK08603', tip_cod: 'teava' },
    { id: 3, serie: '254CA00001', tip_cod: 'teava' },
  ]
  const folosite = indexFolosite([
    { id: 10, serie_unica: '254-CA 09771', pachet: { cod_document_full: '43_GAZ_CTG2_DWG_00001' } },
    { id: 11, serie_unica: '247EK08603', pachet: { cod_document_full: '43_GAZ_CTG2_DWG_00002' } },
  ])
  it('fără text: toate, cele folosite în alt rând la final și marcate', () => {
    const l = sugestiiRegistru(registru, folosite, '', 99)
    expect(l.map(x => x.b.id)).toEqual([3, 2, 1])
    expect(l[2].alte[0].cod).toBe('43_GAZ_CTG2_DWG_00001')
  })
  it('rândul curent nu se marchează pe el însuși', () => {
    const l = sugestiiRegistru(registru, folosite, '09771', 10)
    expect(l).toHaveLength(1)
    expect(l[0].alte).toHaveLength(0)
  })
  it('filtrul e canonic („254-ca” găsește 254CA…)', () => {
    expect(sugestiiRegistru(registru, folosite, '254-ca', 99).map(x => x.b.id).sort()).toEqual([1, 3])
  })
})
