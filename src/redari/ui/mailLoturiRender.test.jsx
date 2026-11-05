import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/supabase.js', () => ({ supabase: {} }))
vi.mock('./comune.jsx', () => ({ S: {} }))
import MailLoturiEcran from './MailLoturiEcran.jsx'
describe('F2 UI owner', () => {
  it('non-owner nu are formular de creare/aprobare/trimitere', () => {
    expect(renderToStaticMarkup(<MailLoturiEcran proiect={{ id: 'fictiv' }} uats={[]} profile={{ is_owner: false }} />)).toBe('')
  })
  it('owner vede UAT/lot și oprirea explicită', () => {
    const html = renderToStaticMarkup(<MailLoturiEcran proiect={{ id: 'fictiv' }} uats={[{ id: 'uat-fictiv', nume: 'UAT Fictiv' }]} profile={{ is_owner: true }} />)
    expect(html).toContain('UAT Fictiv'); expect(html).toContain('Lot nou')
    expect(html).toContain('Trimiterea reală este oprită')
    expect(html).not.toContain('Aprobă acest lot')
  })
})
