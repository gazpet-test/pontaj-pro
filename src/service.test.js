import { describe, it, expect } from 'vitest'
import { calcUrmService, urmServiceLevel, PRAG_ZILE, PRAG_KM } from './lib/service.js'

// Data de azi + n zile, în format ISO (ca urmatoarea_data din fișă)
const peste = (zile) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + zile)
  return d.toISOString().slice(0, 10)
}

describe('calcUrmService — TKT-0152: nu mai compară zile cu km', () => {
  it('alege KM când mașina ajunge la km mult înainte de dată', () => {
    // 500 km rămași (jumătate din prag) vs 90 zile (de 3x pragul) → km e mai urgent.
    // Înainte de fix: 90 < 500 numeric, deci ieșea „90 zile" și km dispăreau.
    const u = calcUrmService(
      { urmatoarea_km: 100500, urmatoarea_data: peste(90) },
      100000, null,
    )
    expect(u.tip).toBe('km')
    expect(u.ramas).toBe(500)
  })

  it('alege data când ea chiar e mai aproape decât km-ii', () => {
    // 5 zile (1/6 din prag) vs 5000 km (5x pragul)
    const u = calcUrmService(
      { urmatoarea_km: 105000, urmatoarea_data: peste(5) },
      100000, null,
    )
    expect(u.tip).toBe('data')
  })

  it('păstrează toate scadențele definite, cea mai urgentă prima', () => {
    const u = calcUrmService(
      { urmatoarea_km: 100500, urmatoarea_data: peste(90) },
      100000, null,
    )
    expect(u.toate.map(t => t.tip)).toEqual(['km', 'data'])
    expect(u.toate.find(t => t.tip === 'data').ramas).toBe(90)
  })

  it('o singură scadență definită → aia e, cu toate de lungime 1', () => {
    const u = calcUrmService({ urmatoarea_data: peste(10) }, null, null)
    expect(u.tip).toBe('data')
    expect(u.toate).toHaveLength(1)
  })

  it('km fără kmLive nu produce scadență (nu avem cu ce compara)', () => {
    const u = calcUrmService({ urmatoarea_km: 100500 }, null, null)
    expect(u).toBeNull()
  })

  it('fără fișă → null', () => {
    expect(calcUrmService(null, 1, 1)).toBeNull()
  })

  it('depășitul rămâne depășit, indiferent de unitate', () => {
    const u = calcUrmService({ urmatoarea_km: 99000 }, 100000, null)
    expect(u.ramas).toBe(-1000)
    expect(urmServiceLevel(u)).toBe('depasit')
    expect(u.label).toContain('depășiți')
  })

  it('un km depășit bate o dată încă validă', () => {
    const u = calcUrmService(
      { urmatoarea_km: 99000, urmatoarea_data: peste(20) },
      100000, null,
    )
    expect(u.tip).toBe('km')
    expect(urmServiceLevel(u)).toBe('depasit')
  })

  it('urgenta e raportată la pragul propriu al fiecărei unități', () => {
    const u = calcUrmService(
      { urmatoarea_km: 100000 + PRAG_KM, urmatoarea_data: peste(PRAG_ZILE) },
      100000, null,
    )
    // ambele exact la prag → urgență 1, ordinea nu mai contează, dar ambele apar
    expect(u.toate).toHaveLength(2)
    for (const t of u.toate) expect(t.urgenta).toBeCloseTo(1, 5)
  })
})
