import { describe, it, expect } from 'vitest'
import { mesajEroareCitire, mesajFaraText, MESAJ_TIMEOUT_UI } from './ofertareCitireDoc.js'

describe('mesajEroareCitire — Răcari 06.10.2026', () => {
  it('eroarea de business din corp are prioritate', () => {
    expect(mesajEroareCitire({ message: 'x', context: { status: 504 } }, { error: 'Fișier prea mare' })).toBe('Fișier prea mare')
  })
  it('504 / 546 de la gateway → mesajul de timeout cu calea pe felii', () => {
    expect(mesajEroareCitire({ message: 'Edge Function returned a non-2xx status code', context: { status: 504 } }, null)).toBe(MESAJ_TIMEOUT_UI)
    expect(mesajEroareCitire({ message: 'x', context: { status: 546 } }, null)).toBe(MESAJ_TIMEOUT_UI)
    expect(MESAJ_TIMEOUT_UI).toMatch(/Procesează/)
  })
  it('timeout în mesaj fără status → tot mesajul de timeout', () => {
    expect(mesajEroareCitire({ message: 'request timed out' }, undefined)).toBe(MESAJ_TIMEOUT_UI)
  })
  it('altă eroare → mesajul ei; nimic → „eroare necunoscută”', () => {
    expect(mesajEroareCitire({ message: 'nu ai acces la modulul Ofertare', context: { status: 403 } }, null)).toBe('nu ai acces la modulul Ofertare')
    expect(mesajEroareCitire(null, null)).toBe('eroare necunoscută')
  })
})

describe('mesajFaraText — necitit ≠ scanat', () => {
  it('neprocesat / necunoscut → „Încă necitit”', () => {
    expect(mesajFaraText('neprocesat')).toMatch(/^Încă necitit/)
    expect(mesajFaraText(null)).toMatch(/^Încă necitit/)
  })
  it('procesat fără text → poate e scanat; eroare / ignorat → mesaj propriu', () => {
    expect(mesajFaraText('procesat')).toMatch(/poate e scanat/)
    expect(mesajFaraText('partial')).toMatch(/poate e scanat/)
    expect(mesajFaraText('eroare')).toMatch(/eroare/)
    expect(mesajFaraText('ignorat')).toMatch(/ignorat/)
  })
})
