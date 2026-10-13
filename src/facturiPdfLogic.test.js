import { describe, it, expect } from 'vitest'
import { numereDinNume, potriveste, cheieStorage, caleNas, numeSigur, sha256Hex } from './facturiPdfLogic.js'

describe('numărul din numele fișierului', () => {
  it('formatele de pe NAS', () => {
    expect(numereDinNume('factura GAZPET SERIA GAZ -332 TRANSGAZ- Prunisor sit.5 12.01.2026.pdf')).toEqual([332])
    expect(numereDinNume('factura GAZPET SERIA GAZ 351-CFI 23.04.2026 INCHIRIERE COMPRESOR.pdf')).toEqual([351])
    expect(numereDinNume('Factura_GAZPET_GAZ-410_ADI_IALOMITA.pdf')).toEqual([410])
    expect(numereDinNume('Factura GAZPET_GAZ 368_DRAGASANI.pdf')).toEqual([368])
    expect(numereDinNume('factura GAZPET SERIA GAZ -336 MACHINERY HUB S.R.L.  30.01.2026 VANZARE AUTO VW TOUAREG PH24AAZ.pdf')).toEqual([336])
  })
  it('fără număr / numere multiple', () => {
    expect(numereDinNume('poza.pdf')).toEqual([])
    expect(numereDinNume('Factura_GAZPET_GAZ-380_storno_ff_gaz378.pdf')).toEqual([380, 378])
  })
})

const facturi = [
  { id: 7, nr: 332, nr_complet: 'GAZ-332', serie: 'GAZ', an: 2026, pdf_path: null },
  { id: 8, nr: 333, nr_complet: 'GAZ-333', serie: 'GAZ', an: 2026, pdf_path: null },
  { id: 32, nr: 363, nr_complet: 'GAZ-363', serie: 'GAZ', an: 2026, pdf_path: '2026/x.pdf' },
  { id: 90, nr: 333, nr_complet: 'PH-333', serie: 'PH', an: 2026, pdf_path: null },
]
const f = (name) => ({ name, size: 100 })

describe('potrivire', () => {
  it('ok / nepotrivit / are_pdf; .xls ignorat; altă serie ignorată', () => {
    const r = potriveste([f('SERIA GAZ -332 a.pdf'), f('SERIA GAZ -332 a.xls'), f('GAZ-999 x.pdf'), f('GAZ-363 y.pdf'), f('GAZ -333 z.pdf')], facturi)
    expect(r.map(x => x.stare)).toEqual(['ok', 'nepotrivit', 'are_pdf', 'ok'])
    expect(r[3].factura.id).toBe(8)
  })
  it('două fișiere pe aceeași factură → ambele ambigue', () => {
    const r = potriveste([f('GAZ -332 v1.pdf'), f('GAZ -332 v2.pdf')], facturi)
    expect(r.map(x => x.stare)).toEqual(['ambiguu', 'ambiguu'])
  })
  it('număr dublat în ERP → ambiguu', () => {
    const r = potriveste([f('GAZ -332.pdf')], [...facturi, { id: 100, nr: 332, serie: 'GAZ', pdf_path: null }])
    expect(r[0].stare).toBe('ambiguu')
  })
  it('mai multe numere în nume → ambiguu', () => {
    expect(potriveste([f('GAZ-332_storno_GAZ-333.pdf')], facturi)[0].stare).toBe('ambiguu')
  })
})

describe('căi', () => {
  it('cheie Storage ASCII sub an, cale NAS cu numele original', () => {
    expect(cheieStorage(facturi[0], 'factura GAZPET SERIA GAZ -332 TRANSGAZ- Prunișor sit.5 12.01.2026.pdf'))
      .toBe('2026/GAZ-332_factura_GAZPET_SERIA_GAZ_-332_TRANSGAZ-_Prunisor_sit.5_12.01.2026.pdf')
    expect(caleNas(facturi[0], 'factura GAZPET SERIA GAZ -332 X.pdf')).toBe('/data/facturi/Facturi 2026/factura GAZPET SERIA GAZ -332 X.pdf')
  })
  it('nume sigur', () => {
    expect(numeSigur('a b.pdf')).toBe(true)
    expect(numeSigur('../x.pdf')).toBe(false)
    expect(numeSigur('a\\b.pdf')).toBe(false)
    expect(numeSigur('')).toBe(false)
  })
  it('sha256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('test'))).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
  })
})
