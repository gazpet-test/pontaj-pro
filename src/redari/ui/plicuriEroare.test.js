import { describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/supabase.js', () => ({ supabase: {} }))
import { eroareScriere } from './PlicuriEcran.jsx'

// E2E Redări 06.11.2026 (TEST-RAZVAN): fn_red_plic_creeaza a refuzat cu RD008 „calitatea s-a schimbat - regenereaza”,
// iar ecranul arăta „Rezultat neconfirmat. Reîncarcă…” — operatorul nu afla motivul.
describe('PlicuriEcran — eroareScriere', () => {
  it('RD008 (refuz de business) arată motivul serverului + ce e de făcut', () => {
    const m = eroareScriere({ code: 'RD008', message: 'calitatea s-a schimbat - regenereaza' })
    expect(m).toMatch(/^calitatea s-a schimbat - regenereaza — /)
    expect(m).toMatch(/Regenerează același număr/)
    expect(m).not.toMatch(/Rezultat neconfirmat/)
  })
  it('alt cod RDnnn arată motivul, fără sugestie inventată', () => {
    expect(eroareScriere({ code: 'RD001', message: 'exista deja convocare activa' })).toBe('exista deja convocare activa')
  })
  it('comportamentul existent rămâne: coduri cunoscute, acces refuzat, concurență, necunoscut', () => {
    expect(eroareScriere({ code: '23514', message: 'motiv' })).toBe('motiv')
    expect(eroareScriere({ code: '42501', message: 'x' })).toBe('Accesul de scriere a fost refuzat.')
    expect(eroareScriere({ code: '55P03', message: 'blocat' })).toMatch(/^Operație concurentă: blocat/)
    expect(eroareScriere(new TypeError('Failed to fetch'))).toMatch(/^Rezultat neconfirmat/)
    expect(eroareScriere({ code: 'RDX', message: 'x' })).toMatch(/^Rezultat neconfirmat/)
    expect(eroareScriere(null)).toMatch(/^Rezultat neconfirmat/)
  })
})
