// TKT-2026-0355 — valorile așteptate sunt BIC-urile publicate de bănci (registrul SWIFT), scrise literal aici, nu luate din cod
import { describe, it, expect } from 'vitest'
import { bicDinIban, CODURI_RECUNOSCUTE, CODURI_DE_VERIFICAT } from './bicBanca.js'

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
  TCCL: 'TCCLGB3L',
}
// Bănci desființate / preluate / nesigure: fără BIC, de verificat
const DE_VERIFICAT = ['PIRB', 'DAFB', 'BPOS', 'VBBU', 'MILB', 'CRDZ', 'OTPV', 'BRMA']

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
  it('cod necunoscut: valoare de rezervă, marcată de verificat', () => {
    const r = bicDinIban(iban('ZZZZ'))
    expect(r.bic).toBe('ZZZZROBUXXX')
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
