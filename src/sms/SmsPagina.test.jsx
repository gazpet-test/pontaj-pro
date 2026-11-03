import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import SmsPagina from './SmsPagina.jsx'
import RedariSmsButon from './RedariSmsButon.jsx'

describe('Administrator › 📱 SMS', () => {
  it('non-owner: nu randează nimic din modul', () => {
    const html = renderToStaticMarkup(<SmsPagina profile={{ id: 'x', is_owner: false }} />)
    expect(html).toContain('vizibil doar owner-ului')
    expect(html).not.toContain('Compune')
  })
  it('owner: secțiunile și nota despre convocarea scrisă', () => {
    const html = renderToStaticMarkup(<SmsPagina profile={{ id: 'x', is_owner: true }} />)
    for (const t of ['Compune', 'Istoric loturi', 'Setări', 'Opt-out', 'Previzualizează', 'Creează lot (draft)']) expect(html).toContain(t)
    expect(html).toContain('nu înlocuiește convocarea scrisă')
  })
})

describe('Redări › 📱 SMS proprietari', () => {
  const proiect = { id: 'p1', cod: 'TEST-PROIECT' }
  it('blocat cu mesajul „Așteaptă autorizarea scrisă Transgaz” cât comutatorul e oprit', () => {
    const html = renderToStaticMarkup(<RedariSmsButon proiect={proiect} uats={[]} panouInitial={{ redari_autorizat: false }} />)
    expect(html).toContain('Așteaptă autorizarea scrisă Transgaz')
    expect(html).toContain('disabled')
  })
  it('activ după autorizare', () => {
    const html = renderToStaticMarkup(<RedariSmsButon proiect={proiect} uats={[]} panouInitial={{ redari_autorizat: true }} />)
    expect(html).not.toContain('Așteaptă autorizarea')
    expect(html).not.toContain('disabled')
  })
})
