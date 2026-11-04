// D4 (audit 04.11.2026): starea „convocator generat, neexpediat” — Registru + gardă la număr nou în ModalConvocator.
import { describe, it, expect } from 'vitest'
import { COL_CONV_NEEXPEDIAT, filtruNeexpediate, fabricaNeexpediate, grupeazaNeexpediate, etichetaNeexpediat, textConfirmareNumarNou, poateGeneraNou } from './convocatorNeexpediat.js'

// fake PostgREST: înregistrează lanțul de apeluri
const lant = () => {
  const apeluri = []
  const q = new Proxy({}, { get: (_, m) => (...a) => { apeluri.push([m, ...a]); return q } })
  return { q, apeluri }
}

describe('convocatorNeexpediat', () => {
  it('filtrul: activ, neexpediat, neșters', () => {
    const { q, apeluri } = lant()
    filtruNeexpediate(q)
    expect(apeluri).toEqual([['eq', 'stare', 'activ'], ['is', 'data_expediere', null], ['is', 'sters_la', null]])
  })

  it('fabrica: interogare nouă la fiecare apel, pe red_convocari, fără PII, ordonare stabilă (pentru paginare)', () => {
    const tabele = []
    const supabase = { from: (t) => { tabele.push(t); const { q, apeluri } = lant(); q.__apeluri = apeluri; return { select: (c) => { apeluri.push(['select', c]); return q } } } }
    const f = fabricaNeexpediate(supabase)
    f(); f()
    expect(tabele).toEqual(['red_convocari', 'red_convocari'])
    expect(COL_CONV_NEEXPEDIAT).not.toMatch(/adresa|telefon|token|email/)
    expect(COL_CONV_NEEXPEDIAT).toMatch(/nr_document/)
    expect(COL_CONV_NEEXPEDIAT).toMatch(/fisier_convocator_path/)
  })

  it('grupare pe deținător, cea mai recentă prima; rândurile fără deținător se ignoră', () => {
    const h = grupeazaNeexpediate([
      { id: 'a', detinator_id: 'd1', nr_document: 'C-0001', created_at: '2026-11-01T10:00:00Z' },
      { id: 'b', detinator_id: 'd1', nr_document: 'C-0003', created_at: '2026-11-04T01:58:00Z' },
      { id: 'c', detinator_id: 'd2', nr_document: 'C-0002', created_at: '2026-11-02T10:00:00Z' },
      { id: 'x', detinator_id: null, nr_document: 'C-9999' },
    ])
    expect([...h.keys()]).toEqual(['d1', 'd2'])
    expect(h.get('d1').map(c => c.nr_document)).toEqual(['C-0003', 'C-0001'])
    expect(grupeazaNeexpediate(null).size).toBe(0)
  })

  it('eticheta din Registru', () => {
    expect(etichetaNeexpediat([])).toBe('')
    expect(etichetaNeexpediat(undefined)).toBe('')
    expect(etichetaNeexpediat([{ nr_document: 'C-0002', fisier_convocator_path: 'P/HUS/x/C-0002-v1.docx' }])).toBe('Convocator generat C-0002 (neexpediat)')
    expect(etichetaNeexpediat([{ nr_document: 'C-0002', fisier_convocator_path: null }, { nr_document: 'C-0001', fisier_convocator_path: 'p' }]))
      .toBe('Convocator generat C-0002 (neexpediat, fișier neîncărcat) +1')
  })

  it('număr nou: blocat cât se citește și la eroare (fail-closed); liber fără existente; cu existente doar cu confirmare', () => {
    expect(poateGeneraNou({ existente: null })).toBe(false)
    expect(poateGeneraNou({ existente: null, confirmat: true })).toBe(false)
    expect(poateGeneraNou({ existente: [], eroare: 'rețea' })).toBe(false)
    expect(poateGeneraNou({ existente: [{ nr_document: 'C-0002' }], eroare: 'x', confirmat: true })).toBe(false)
    expect(poateGeneraNou({ existente: [] })).toBe(true)
    expect(poateGeneraNou({ existente: [{ nr_document: 'C-0002' }] })).toBe(false)
    expect(poateGeneraNou({ existente: [{ nr_document: 'C-0002' }], confirmat: 'da' })).toBe(false)
    expect(poateGeneraNou({ existente: [{ nr_document: 'C-0002' }], confirmat: true })).toBe(true)
  })

  it('textul confirmării numește numerele existente și consumul unui număr nou', () => {
    const t = textConfirmareNumarNou([{ nr_document: 'C-0002' }])
    expect(t).toMatch(/număr C-nnnn NOU/)
    expect(t).toMatch(/2 convocatoare active neexpediate/)
    expect(t).toMatch(/există deja: C-0002/)
  })
})
