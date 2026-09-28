import { describe, it, expect, vi } from 'vitest'
vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
import { rezumatPuncte } from './OfertareClarificariPuncte.jsx'

describe('R05 — rezoluția clarificării pe puncte', () => {
  it('2 din 3 rezolvate → nu e închisă', () => {
    const r = rezumatPuncte([{ rezolutie: 'rezolvat' }, { rezolutie: 'rezolvat' }, { rezolutie: 'deschis' }])
    expect(r).toMatchObject({ n: 3, rezolvate: 2, deschise: 1, inchisa: false })
  })
  it('parțial ține clarificarea deschisă', () => {
    expect(rezumatPuncte([{ rezolutie: 'partial' }]).inchisa).toBe(false)
  })
  it('toate tratate (rezolvat/nerezolvat explicit) → închisă, nerezolvatele numărate', () => {
    expect(rezumatPuncte([{ rezolutie: 'rezolvat' }, { rezolutie: 'nerezolvat' }])).toMatchObject({ inchisa: true, nerezolvate: 1 })
  })
  it('fără puncte nu e „închisă” — răspunsul singur nu e rezoluție', () => {
    expect(rezumatPuncte([]).inchisa).toBe(false)
  })
})
