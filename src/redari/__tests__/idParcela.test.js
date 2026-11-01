import { describe, it, expect } from 'vitest'
import { uat3, idParcela, idParcelaProvizoriu, normalizeazaNume, faraDiacritice } from '../idParcela.js'

describe('idParcelaProvizoriu', () => {
  it('T{tronson}-{uat3}-????', () => {
    expect(idParcelaProvizoriu(3, 'HUS')).toBe('T3-HUS-????')
    expect(() => idParcelaProvizoriu(0, 'HUS')).toThrow(/tronson/)
    expect(() => idParcelaProvizoriu(3, 'hus')).toThrow(/uat3/)
  })
})

describe('uat3', () => {
  it('cele 7 UAT-uri din brief', () => {
    expect(uat3('Prunișor')).toBe('PRU')
    expect(uat3('Godeanu')).toBe('GOD')
    expect(uat3('Husnicioara')).toBe('HUS')
    expect(uat3('Căzănești')).toBe('CAZ')
    expect(uat3('Ilovăț')).toBe('ILO')
    expect(uat3('Bâlvănești')).toBe('BAL')
    expect(uat3('Șișești')).toBe('SIS')
  })
  it('ș/ț cu sedilă (U+015F/U+0163) se tratează la fel ca virgula', () => {
    expect(uat3('Şişeşti')).toBe('SIS')
    expect(uat3('Ţara')).toBe('TAR')
  })
  it('ignoră spațiile și cratimele, litere mici', () => {
    expect(uat3('târgu jiu')).toBe('TAR')
    expect(uat3('B-ălvănești')).toBe('BAL')
  })
  it('override explicit câștigă și se normalizează', () => {
    expect(uat3('Husnicioara', 'hsn')).toBe('HSN')
    expect(uat3('Husnicioara', ' Hus ')).toBe('HUS')
    expect(() => uat3('Husnicioara', 'HUSN')).toThrow(/override/)
    expect(() => uat3('Husnicioara', 'H1')).toThrow(/override/)
  })
  it('nume prea scurt → eroare', () => {
    expect(() => uat3('Ab')).toThrow()
    expect(() => uat3('')).toThrow()
    expect(() => uat3(null)).toThrow()
  })
})

describe('idParcela', () => {
  it('format T{tronson}-{uat3}-{nnnn}', () => {
    expect(idParcela(3, 'HUS', 1)).toBe('T3-HUS-0001')
    expect(idParcela(11, 'PRU', 2728)).toBe('T11-PRU-2728')
    expect(idParcela('7', 'GOD', '42')).toBe('T7-GOD-0042')
    expect(idParcela(1, 'SIS', 12345)).toBe('T1-SIS-12345')
  })
  it('validări', () => {
    expect(() => idParcela(0, 'HUS', 1)).toThrow(/tronson/)
    expect(() => idParcela(12, 'HUS', 1)).toThrow(/tronson/)
    expect(() => idParcela(3.5, 'HUS', 1)).toThrow(/tronson/)
    expect(() => idParcela(3, 'hus', 1)).toThrow(/uat3/)
    expect(() => idParcela(3, 'HUSN', 1)).toThrow(/uat3/)
    expect(() => idParcela(3, 'HUS', 0)).toThrow(/număr/)
    expect(() => idParcela(3, 'HUS', 1.5)).toThrow(/număr/)
  })
})

describe('normalizeazaNume', () => {
  it('majuscule, fără diacritice, spații simple, trim', () => {
    expect(normalizeazaNume('  Popescu   Ion ')).toBe('POPESCU ION')
    expect(normalizeazaNume('Ștefănescu Țărână')).toBe('STEFANESCU TARANA')
    expect(normalizeazaNume('ionescu\tvasile\n')).toBe('IONESCU VASILE')
  })
  it('fără punctuație dublă, fără spațiu înaintea punctuației', () => {
    expect(normalizeazaNume('Popescu I.. Ion,, jr .')).toBe('POPESCU I. ION, JR.')
    expect(normalizeazaNume('Ion -- Maria')).toBe('ION - MARIA')
    expect(normalizeazaNume('A , B')).toBe('A, B')
  })
  it('intrare goală / null', () => {
    expect(normalizeazaNume('')).toBe('')
    expect(normalizeazaNume(null)).toBe('')
    expect(normalizeazaNume(undefined)).toBe('')
  })
  it('deduplicare: variantele aceluiași nume dau aceeași cheie', () => {
    const chei = new Set(['Popescu Ion', 'POPESCU ION', 'popescu  ion', 'Popescu Ion '].map(normalizeazaNume))
    expect(chei.size).toBe(1)
  })
  it('faraDiacritice păstrează lungimea și literele de bază', () => {
    expect(faraDiacritice('ăâîșț ĂÂÎȘȚ')).toBe('aaist AAIST')
    expect(faraDiacritice(null)).toBe('')
  })
})
