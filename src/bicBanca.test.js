// TKT-2026-0355 — valorile așteptate sunt BIC-urile publicate de bănci (registrul SWIFT), scrise literal aici, nu luate din cod
import { describe, it, expect } from 'vitest'
import { bicDinIban, CODURI_RECUNOSCUTE, CODURI_DE_VERIFICAT, ibanRoValid, imparteExportBanca } from './bicBanca.js'

// IBAN-uri de test construite (cod de bancă real, cont fictiv) — nu sunt conturi ale cuiva
const iban = cod => `RO49${cod}1B31007593840000`

// Valoarea completă așteptată pentru FIECARE bancă recunoscută (scrisă independent de tabelul din bicBanca.js)
const ASTEPTAT = {
  BTRL: 'BTRLRO22XXX',
  WBAN: 'WBANRO22XXX',
  INGB: 'INGBROBUXXX',
  RNCB: 'RNCBROBUXXX',
  BRDE: 'BRDEROBUXXX',
  BACX: 'BACXROBUXXX',
  RZBR: 'RZBRROBUXXX',
  CECE: 'CECEROBUXXX',
  UGBI: 'UGBIROBUXXX',
  BREL: 'BRELROBUXXX',
  MIRO: 'MIROROBUXXX',
  BRMA: 'BRMAROBUXXX',
  TCCL: 'TCCLGB3L',
}
// Bănci desființate / preluate / nesigure: fără BIC, de verificat
const DE_VERIFICAT = ['PIRB', 'DAFB', 'BPOS', 'VBBU', 'MILB', 'CRDZ', 'OTPV']

describe('bicDinIban', () => {
  it('Intesa Sanpaolo (WBAN) = WBANRO22XXX — cazul din tichet', () => {
    expect(bicDinIban(iban('WBAN'))).toEqual({ bic: 'WBANRO22XXX', cunoscut: true, motiv: '' })
  })
  for (const [cod, bic] of Object.entries(ASTEPTAT)) {
    it(`${cod} → ${bic}`, () => {
      expect(bicDinIban(iban(cod))).toEqual({ bic, cunoscut: true, motiv: '' })
    })
  }
  it('tabelul nu are bănci netestate (și nici lipsă)', () => {
    expect([...CODURI_RECUNOSCUTE].sort()).toEqual(Object.keys(ASTEPTAT).sort())
    expect([...CODURI_DE_VERIFICAT].sort()).toEqual([...DE_VERIFICAT].sort())
  })
  it('First Bank (PIRB): fără BIC, de verificat, cu IBAN-ul nou de la Intesa', () => {
    const r = bicDinIban(iban('PIRB'))
    expect(r.bic).toBe('')
    expect(r.cunoscut).toBe(false)
    expect(r.motiv).toContain('First Bank')
    expect(r.motiv).toContain('IBAN-ul nou')
    expect(r.motiv).toContain('Intesa')
  })
  for (const cod of DE_VERIFICAT) {
    it(`${cod}: bancă desființată / preluată / nesigură → fără BIC ghicit`, () => {
      const r = bicDinIban(iban(cod))
      expect(r.bic).toBe('')
      expect(r.cunoscut).toBe(false)
      expect(r.motiv.length).toBeGreaterThan(20)
    })
  }
  it('spații și litere mici în IBAN', () => {
    expect(bicDinIban('ro49 wban 1b31 0075 9384 0000')).toEqual({ bic: 'WBANRO22XXX', cunoscut: true, motiv: '' })
    expect(bicDinIban(' ro49 pirb 1b31 0075 9384 0000 ').bic).toBe('')
    expect(bicDinIban(' ro49 pirb 1b31 0075 9384 0000 ').cunoscut).toBe(false)
  })
  it('Exim Banca Românească (BRMA) = BRMAROBUXXX — recunoscută (r3)', () => {
    expect(bicDinIban(iban('BRMA'))).toEqual({ bic: 'BRMAROBUXXX', cunoscut: true, motiv: '' })
  })
  it('OTP Bank (OTPV): de verificat, cu IBAN-ul nou de la Banca Transilvania', () => {
    const r = bicDinIban(iban('OTPV'))
    expect(r).toEqual({ bic: '', cunoscut: false, motiv: 'cont OTP Bank (bancă preluată de Banca Transilvania) — cereți IBAN-ul nou, de la Banca Transilvania' })
  })
  it('cod necunoscut: BIC gol (nu se inventează), marcat de verificat', () => {
    const r = bicDinIban(iban('ZZZZ'))
    expect(r.bic).toBe('')
    expect(r.cunoscut).toBe(false)
    expect(r.motiv).toContain('ZZZZ')
  })
  it('fără IBAN (gol / null / doar spații): gol (lipsa IBAN-ului e raportată separat)', () => {
    expect(bicDinIban('')).toEqual({ bic: '', cunoscut: true, motiv: '' })
    expect(bicDinIban(null)).toEqual({ bic: '', cunoscut: true, motiv: '' })
    expect(bicDinIban(undefined)).toEqual({ bic: '', cunoscut: true, motiv: '' })
    expect(bicDinIban('   ')).toEqual({ bic: '', cunoscut: true, motiv: '' })
  })
  it('IBAN prea scurt / cod cu cifre: fără BIC ghicit', () => {
    expect(bicDinIban('RO49').bic).toBe('')
    expect(bicDinIban('RO49').cunoscut).toBe(false)
    expect(bicDinIban('RO4912341B31').bic).toBe('')
    expect(bicDinIban('RO4912341B31').cunoscut).toBe(false)
  })
})

// IBAN-uri de test VALIDE (cifra de control calculată o dată, scrisă literal; cont fictiv)
const V = {
  BTRL: 'RO39BTRL1B31007593840000',
  WBAN: 'RO85WBAN1B31007593840000',
  INGB: 'RO28INGB1B31007593840000',
  BRMA: 'RO78BRMA1B31007593840000',
  OTPV: 'RO44OTPV1B31007593840000',
  PIRB: 'RO10PIRB1B31007593840000',
  ZZZZ: 'RO18ZZZZ1B31007593840000',
}

describe('ibanRoValid', () => {
  it('IBAN-uri valide (exemplul public RO49AAAA… și cele de test)', () => {
    expect(ibanRoValid('RO49AAAA1B31007593840000')).toBe(true)
    expect(ibanRoValid('ro49 aaaa 1b31 0075 9384 0000')).toBe(true)
    for (const x of Object.values(V)) expect(ibanRoValid(x)).toBe(true)
  })
  it('cifră de control greșită, lungime greșită, altă țară, gol', () => {
    expect(ibanRoValid('RO48AAAA1B31007593840000')).toBe(false)
    expect(ibanRoValid('RO49AAAA1B3100759384000')).toBe(false)
    expect(ibanRoValid('RO49AAAA1B310075938400000')).toBe(false)
    expect(ibanRoValid('DE89370400440532013000')).toBe(false)
    expect(ibanRoValid('')).toBe(false)
    expect(ibanRoValid(null)).toBe(false)
  })
})

describe('imparteExportBanca — de exportat / de verificat, înainte de salvare', () => {
  it('5 angajați × 50 lei, 2 de verificat → 3 rânduri, 150 lei exportați, 100 lei lăsați pe dinafară', () => {
    const r = imparteExportBanca([
      { name: 'A', iban: V.BTRL, suma: 50 },
      { name: 'B', iban: V.PIRB, suma: 50 },
      { name: 'C', iban: V.WBAN, suma: 50 },
      { name: 'D', iban: V.OTPV, suma: 50 },
      { name: 'E', iban: V.BRMA, suma: 50 },
    ])
    expect(r.deExportat).toEqual([
      { name: 'A', iban: V.BTRL, bic: 'BTRLRO22XXX', suma: 50 },
      { name: 'C', iban: V.WBAN, bic: 'WBANRO22XXX', suma: 50 },
      { name: 'E', iban: V.BRMA, bic: 'BRMAROBUXXX', suma: 50 },
    ])
    expect(r.deVerificat.map(x => [x.name, x.suma])).toEqual([['B', 50], ['D', 50]])
    expect(r.deVerificat[1].motiv).toContain('Banca Transilvania')
    expect(r.totalExportat).toBe(150)
    expect(r.totalLasat).toBe(100)
  })
  it('toți de verificat → niciun rând de exportat (nu se salvează fișier)', () => {
    const r = imparteExportBanca([
      { name: 'A', iban: '', suma: 50 },
      { name: 'B', iban: null, suma: 50 },
      { name: 'C', iban: 'RO48AAAA1B31007593840000', suma: 50 },
      { name: 'D', iban: V.ZZZZ, suma: 50 },
      { name: 'E', iban: V.PIRB, suma: 50 },
    ])
    expect(r.deExportat).toEqual([])
    expect(r.totalExportat).toBe(0)
    expect(r.totalLasat).toBe(250)
    expect(r.deVerificat.map(x => x.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(r.deVerificat[0].motiv).toContain('IBAN lipsă')
    expect(r.deVerificat[1].motiv).toContain('IBAN lipsă')
    expect(r.deVerificat[2].motiv).toContain('IBAN invalid')
    expect(r.deVerificat[3].motiv).toContain('ZZZZ')
    expect(r.deVerificat[4].motiv).toContain('First Bank')
  })
  it('niciunul de verificat → toți exportați (comportamentul de azi, fără confirmare)', () => {
    const r = imparteExportBanca([
      { name: 'A', iban: V.BTRL, suma: 50 },
      { name: 'B', iban: 'ro28 ingb 1b31 0075 9384 0000', suma: 75.5 },
    ])
    expect(r.deVerificat).toEqual([])
    expect(r.deExportat).toEqual([
      { name: 'A', iban: V.BTRL, bic: 'BTRLRO22XXX', suma: 50 },
      { name: 'B', iban: V.INGB, bic: 'INGBROBUXXX', suma: 75.5 },
    ])
    expect(r.totalExportat).toBe(125.5)
    expect(r.totalLasat).toBe(0)
  })
  it('niciun rând exportat fără BIC (orice cod din tabelul de verificat sau necunoscut)', () => {
    const r = imparteExportBanca(Object.entries(V).map(([cod, x]) => ({ name: cod, iban: x, suma: 10 })))
    for (const x of r.deExportat) expect(x.bic.length === 8 || x.bic.length === 11).toBe(true)
    expect(r.deExportat.map(x => x.name)).toEqual(['BTRL', 'WBAN', 'INGB', 'BRMA'])
    expect(r.deVerificat.map(x => x.name)).toEqual(['OTPV', 'PIRB', 'ZZZZ'])
  })
  it('listă goală / lipsă', () => {
    expect(imparteExportBanca([])).toEqual({ deExportat: [], deVerificat: [], totalExportat: 0, totalLasat: 0 })
    expect(imparteExportBanca(null)).toEqual({ deExportat: [], deVerificat: [], totalExportat: 0, totalLasat: 0 })
  })
})
