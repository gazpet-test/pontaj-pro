import { describe, it, expect } from 'vitest'
import { normalizeazaDomeniuISC, normalizeazaDomeniiISC, acoperaDomeniul, domeniiDinText } from './iscRte.js'

// Valorile REALE din hr_autorizatii.domenii (14.09.2026), nu inventate.
describe('normalizeazaDomeniiISC — ce e scris liber în HR', () => {
  it('„8.4 (D) SI 8.5" → 8.4D + 8.5', () => expect(normalizeazaDomeniiISC(['8.4 (D) SI 8.5']).coduri).toEqual(['8.4D', '8.5']))
  it('„8.4 (T)", „8.5" → 8.4T + 8.5', () => expect(normalizeazaDomeniiISC(['8.4 (T)', '8.5']).coduri).toEqual(['8.4T', '8.5']))
  it('„8.4T" lipit', () => expect(normalizeazaDomeniuISC('8.4T').coduri).toEqual(['8.4T']))
  it('„8.4(T)" fără spațiu', () => expect(normalizeazaDomeniuISC('8.4(T)').coduri).toEqual(['8.4T']))
  it('„6.3", „8.4 (D)"', () => expect(normalizeazaDomeniiISC(['6.3', '8.4 (D)']).coduri).toEqual(['6.3', '8.4D']))
  it('„Construcții civile", „1.1 SI 9.1" → 1.1 + 9.1 (fără dublură)', () => expect(normalizeazaDomeniiISC(['Construcții civile', '1.1 SI 9.1']).coduri).toEqual(['1.1', '9.1']))
  it('cifre romane = schema veche, NU se echivalează', () => {
    const r = normalizeazaDomeniiISC(['I', 'IX'])
    expect(r.coduri).toEqual([]); expect(r.vechi).toEqual(['I', 'IX'])
  })
  it('„II.3", „V", „VII"', () => expect(normalizeazaDomeniiISC(['II.3', 'V', 'VII']).vechi).toEqual(['II.3', 'V', 'VII']))
  it('null / gol', () => { expect(normalizeazaDomeniiISC(null).coduri).toEqual([]); expect(normalizeazaDomeniiISC([]).coduri).toEqual([]) })
  it('„8.4" fără variantă rămâne 8.4 (nespecificat)', () => expect(normalizeazaDomeniuISC('8.4').coduri).toEqual(['8.4']))
})

describe('acoperaDomeniul', () => {
  it('9.1 cerut, autorizație 1.1+9.1 → da (Domnești, Dădulescu)', () => expect(acoperaDomeniul('9.1', ['1.1', '9.1'])).toBe(true))
  it('8.2 cerut, autorizație 9.1 → NU (edilitare ≠ rețele termice/sanitare)', () => expect(acoperaDomeniul('8.2', ['9.1'])).toBe(false))
  it('8.4D cerut, autorizație 8.4T → NU (distribuție ≠ transport)', () => expect(acoperaDomeniul('8.4D', ['8.4T'])).toBe(false))
  it('8.4 nespecificat cerut → orice variantă acoperă', () => { expect(acoperaDomeniul('8.4', ['8.4T'])).toBe(true); expect(acoperaDomeniul('8.4', ['8.4D'])).toBe(true) })
  it('nimic cerut → fals', () => expect(acoperaDomeniul('', ['9.1'])).toBe(false))
})

describe('domeniiDinText — obiectul contractului vs cuvintele-cheie din nomenclator', () => {
  const N = [
    { cod: '8.2', cuvinte_cheie_lucrari: ['alimentare cu apa', 'canalizare', 'retea apa'] },
    { cod: '9.1', cuvinte_cheie_lucrari: ['edilitare', 'alimentare cu apa', 'statie de pompare'] },
    { cod: '2.1', cuvinte_cheie_lucrari: ['drumuri', 'refacere sistem rutier', 'asfalt'] },
    { cod: '8.4', cuvinte_cheie_lucrari: ['distributie gaze', 'conducta gaze'] },
  ]
  it('Domnești: „Extindere rețele alimentare cu apă potabilă" → 8.2 și 9.1', () =>
    expect(domeniiDinText('Extindere rețele alimentare cu apă potabilă, comuna Domnești', N)).toEqual(['8.2', '9.1']))
  it('Laza: apă + refacere sistem rutier → apare și 2.1 (practica comisiei)', () =>
    expect(domeniiDinText('Alimentare cu apă Râșnița, inclusiv refacere sistem rutier', N)).toContain('2.1'))
  it('gaze → 8.4', () => expect(domeniiDinText('Conductă gaze naturale DN 300', N)).toEqual(['8.4']))
})
