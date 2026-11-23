import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/supabase.js', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
import MailOauthRetur, { clasificaRetur, STATE_FORMA, textEsec } from './MailOauthRetur.jsx'

// pagina de întoarcere de la Google: parametrii din adresă sunt DATE; se clasifică, nu se execută
describe('F2b: /redari/mail-oauth', () => {
  const sp = o => new URLSearchParams(o)
  it('clasifică răspunsul Google: refuz / gol / formă invalidă / callback', () => {
    expect(clasificaRetur(sp({ error: 'access_denied' })).tip).toBe('refuzat')
    expect(clasificaRetur(sp({})).tip).toBe('gol')
    expect(clasificaRetur(sp({ code: 'abc', state: 'scurt' })).tip).toBe('invalid')
    expect(clasificaRetur(sp({ code: 'x'.repeat(600), state: 'f'.repeat(64) })).tip).toBe('invalid')
    const r = clasificaRetur(sp({ code: '4/0Ab-cd', state: 'f'.repeat(64) }))
    expect(r).toEqual({ tip: 'callback', code: '4/0Ab-cd', state: 'f'.repeat(64) })
    expect(STATE_FORMA.test('F'.repeat(64))).toBe(false)
  })
  it('mesajul de eșec e nuanțat (runda 2): „nimic salvat” doar la refuz dovedit; răspuns pierdut / salvare neconfirmată = stare de verificat', () => {
    expect(textEsec('casuta_gresita', 409)).toMatch(/REFUZATĂ.*Nimic nu a fost salvat.*cerut revocarea.*nu se poate ști/)
    expect(textEsec('id_token_forma', 409)).toMatch(/REFUZATĂ/); expect(textEsec('state_invalid', 409)).toMatch(/codul nu a fost schimbat/)
    expect(textEsec('salvare_neconfirmata', 503)).toMatch(/NU a putut confirma salvarea.*Starea reală/)
    expect(textEsec(null, null)).toMatch(/s-a pierdut.*nu se știe dacă căsuța a fost conectată, nici dacă serverul a apucat să revoce.*NU reîncărca/)
    expect(textEsec('eroare_neconfirmata', 503)).toMatch(/s-a pierdut/)
    for (const t of [textEsec(null, null), textEsec('salvare_neconfirmata', 503)]) expect(t).not.toMatch(/a fost revocat\b/)
  })
  it('randarea inițială nu afișează codul și are legătura înapoi la Redări', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/redari/mail-oauth?code=cod-secret-123&state=' + 'f'.repeat(64)]}><MailOauthRetur /></MemoryRouter>)
    expect(html).toContain('Conectarea căsuței'); expect(html).not.toContain('cod-secret-123'); expect(html).toContain('href="/redari"')
  })
})
