// TKT-2026-0355 — valorile așteptate sunt BIC-urile publicate de bănci (registrul SWIFT), nu cele din cod
import { describe, it, expect } from 'vitest'
import { bicDinIban } from './bicBanca.js'

// IBAN-uri de test construite (cod de bancă real, cont fictiv) — nu sunt conturi ale cuiva
const iban = cod => `RO49${cod}1B31007593840000`

describe('bicDinIban', () => {
  it('Intesa Sanpaolo (WBAN) = WBANRO22XXX — cazul din tichet', () => {
    expect(bicDinIban(iban('WBAN'))).toEqual({ bic: 'WBANRO22XXX', cunoscut: true })
  })
  it('BIC-urile au 11 caractere (nu 10 ca înainte)', () => {
    for (const cod of ['BTRL', 'WBAN', 'INGB', 'RNCB', 'BRDE', 'BACX', 'RZBR', 'CECE', 'BRMA', 'UGBI', 'OTPV', 'BREL', 'PIRB', 'MIRO']) {
      const { bic, cunoscut } = bicDinIban(iban(cod))
      expect(cunoscut).toBe(true)
      expect(bic).toHaveLength(11)
      expect(bic.startsWith(cod)).toBe(true)
    }
    expect(bicDinIban(iban('INGB')).bic).toBe('INGBROBUXXX')
    expect(bicDinIban(iban('BTRL')).bic).toBe('BTRLRO22XXX')
  })
  it('spații și litere mici în IBAN', () => {
    expect(bicDinIban('ro49 wban 1b31 0075 9384 0000').bic).toBe('WBANRO22XXX')
  })
  it('cod necunoscut: valoare de rezervă, marcată de verificat', () => {
    expect(bicDinIban(iban('ZZZZ'))).toEqual({ bic: 'ZZZZROBUXXX', cunoscut: false })
  })
  it('fără IBAN: gol (lipsa IBAN-ului e raportată separat)', () => {
    expect(bicDinIban('')).toEqual({ bic: '', cunoscut: true })
    expect(bicDinIban(null)).toEqual({ bic: '', cunoscut: true })
  })
  it('IBAN prea scurt / cod cu cifre: fără BIC ghicit', () => {
    expect(bicDinIban('RO49')).toEqual({ bic: '', cunoscut: false })
    expect(bicDinIban('RO4912341B31')).toEqual({ bic: '', cunoscut: false })
  })
})
