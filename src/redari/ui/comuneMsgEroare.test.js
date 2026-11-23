import { describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => ({}), storage: { from: () => ({}) } } }))
import { msgEroare } from './comune.jsx'
describe('msgEroare: nu afișează details / hint (review #1140 r4)', () => {
  it('fără message → fallback + cod; details nu apare', () => {
    expect(msgEroare({ code: '23514', details: 'ana@example.ro' })).toBe('Eroare necunoscută (cod 23514)')
    expect(msgEroare({ details: 'ana@example.ro', hint: 'x' }, 'Nu am putut salva')).toBe('Nu am putut salva')
    expect(msgEroare({ message: 'mesaj server', details: 'ana@example.ro' })).toBe('mesaj server')
    expect(msgEroare({ error_description: 'token expirat' })).toBe('token expirat')
    expect(msgEroare('text simplu')).toBe('text simplu')
    expect(msgEroare(null)).toBe('Eroare necunoscută')
  })
})
