import React, { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'
vi.mock('react', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, useState: vi.fn(actual.useState) }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: {} }))
vi.mock('./comune.jsx', () => ({ S: {} }))
import MailLoturiEcran from './MailLoturiEcran.jsx'
describe('F2 UI owner', () => {
  it('non-owner nu are formular de creare/aprobare/trimitere', () => {
    expect(renderToStaticMarkup(<MailLoturiEcran proiect={{ id: 'fictiv' }} uats={[]} profile={{ is_owner: false }} />)).toBe('')
  })
  it('owner vede UAT/lot; pe un proiect REAL trimiterea e oprită explicit, cu motivul gărzii', () => {
    const html = renderToStaticMarkup(<MailLoturiEcran proiect={{ id: 'fictiv', cod: 'LOT1-REAL' }} uats={[{ id: 'uat-fictiv', nume: 'UAT Fictiv' }]} profile={{ is_owner: true }} />)
    expect(html).toContain('UAT Fictiv'); expect(html).toContain('Lot nou')
    expect(html).toContain('Trimiterea reală este oprită pe acest proiect'); expect(html).toContain('TEST-')
    expect(html).not.toContain('Proiect de TEST'); expect(html).not.toContain('Aprobă acest lot')
  })
  it('F2b: pe un proiect de TEST ecranul spune că trimiterea reală e permisă; căsuța se citește; fără cod de proiect = real', () => {
    const html = renderToStaticMarkup(<MailLoturiEcran proiect={{ id: 'fictiv', cod: 'TEST-RAZVAN' }} uats={[]} profile={{ is_owner: true }} />)
    expect(html).toContain('Proiect de TEST'); expect(html).toContain('Căsuța redari@gazpet.ro pentru trimitere'); expect(html).toContain('se citește')
    expect(renderToStaticMarkup(<MailLoturiEcran proiect={{ id: 'fictiv' }} uats={[]} profile={{ is_owner: true }} />)).toContain('Trimiterea reală este oprită pe acest proiect')
  })
  it('F2b: butonul „Trimite lotul” pe un lot aprobat al unui proiect real e dezactivat cu motivul; pe TEST fără căsuță = motivul căsuței', () => {
    const l = { id: 'lot-fictiv', uat_id: 'uat-fictiv', stare: 'aprobat', versiune: 2 }
    const randeaza = cod => {
      useState.mockImplementationOnce(() => React.useState('')).mockImplementationOnce(() => React.useState(l.id)).mockImplementationOnce(() => React.useState([l]))
      return renderToStaticMarkup(<MailLoturiEcran proiect={{ id: 'fictiv', cod }} uats={[{ id: 'uat-fictiv', nume: 'UAT' }]} profile={{ is_owner: true }} />)
    }
    expect(randeaza('LOT1-REAL')).toMatch(/<button[^>]*disabled=""[^>]*>Trimite lotul — transport doar pe proiecte de TEST/)
    expect(randeaza('TEST-RAZVAN')).toMatch(/<button[^>]*disabled=""[^>]*>Trimite lotul — căsuța nu e conectată/)
  })
  it('afișează UAT-ul lotului selectat și când filtrul UAT este gol', () => {
    const l = { id: 'lot-fictiv', uat_id: 'uat-fictiv', stare: 'incheiat' }
    useState.mockImplementationOnce(() => React.useState(''))
      .mockImplementationOnce(() => React.useState(l.id))
      .mockImplementationOnce(() => React.useState([l]))
    const html = renderToStaticMarkup(<MailLoturiEcran proiect={{ id: 'fictiv' }} uats={[{ id: 'uat-fictiv', nume: 'UAT al lotului' }]} profile={{ is_owner: true }} />)
    expect(html).toContain('UAT lot: UAT al lotului')
  })
})
