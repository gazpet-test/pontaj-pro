import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// TKT-2026-0375: nota din HR → Recomandări trimite recomandările pentru societate la Ofertare → Experiență similară.
// Numele citate în notă se verifică în Ofertare (sursa reală), ca nota să nu rămână cu un nume vechi.
const hr = readFileSync(new URL('./HrRecomandari.jsx', import.meta.url), 'utf8')
const of = readFileSync(new URL('./OfertareLicitatii.jsx', import.meta.url), 'utf8')

describe('nota pentru recomandările societății (TKT-2026-0375)', () => {
  it('nota e în tab-ul Recomandări', () => {
    expect(hr).toContain('Recomandare pentru societate (de la un beneficiar)? Se urcă la <b>Ofertare → Experiență similară</b>, în fișa lucrării, la „Recomandare beneficiar (PDF)”.')
  })
  it('numele citate există în Ofertare: tab-ul „Experiență similară” și câmpul „Recomandare beneficiar (PDF)”', () => {
    expect(of).toContain("['experienta', '📚 Experiență similară']")
    expect(of).toContain("['recomandare_path', 'Recomandare beneficiar (PDF)']")
  })
})
