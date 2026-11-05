// #939 r3: CAS-ul formularului de autorizare Transgaz — rândul din BD trebuie să fie exact cel văzut de formular
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/supabase.js', () => ({ supabase: {} }))
import { autorizareSchimbata, caleAutorizare } from './AutorizareTgz.jsx'

describe('AutorizareTgz — CAS și calea PDF-ului', () => {
  const baza = { versiune: 7, autorizare_tgz_nr: '1', autorizare_tgz_data: '2026-11-05', autorizare_tgz_fisier: 'LOT1-PRUNISOR-JUPA/autorizare_tgz/1_a.pdf' }
  it('același rând → nu e schimbat; orice câmp / versiune diferită sau rând lipsă → schimbat', () => {
    expect(autorizareSchimbata(baza, { ...baza, id: 'x', cod: 'LOT1-PRUNISOR-JUPA' })).toBe(false)
    expect(autorizareSchimbata(baza, { ...baza, versiune: 8 })).toBe(true)
    for (const k of ['autorizare_tgz_nr', 'autorizare_tgz_data', 'autorizare_tgz_fisier']) expect(autorizareSchimbata(baza, { ...baza, [k]: null }), k).toBe(true)
    expect(autorizareSchimbata(baza, null)).toBe(true)
    expect(autorizareSchimbata({ versiune: 1 }, { versiune: 1, autorizare_tgz_nr: undefined })).toBe(false)
  })
  it('calea respectă CHECK-ul din 20261130m: <cod>/autorizare_tgz/<nume>.pdf, doar [A-Za-z0-9_.-], fără „..”', () => {
    const rx = /^[A-Za-z0-9_-]+\/autorizare_tgz\/[A-Za-z0-9_.-]+[.]pdf$/
    for (const n of ['Autorizare TGZ nr. 12/2026.pdf', 'ăîșțâ.PDF', '../../x.pdf', '', '...pdf']) {
      const c = caleAutorizare('LOT1-PRUNISOR-JUPA', n, 1)
      expect(c, n).toMatch(rx)
      expect(c.includes('..'), n).toBe(false)
    }
  })
})
