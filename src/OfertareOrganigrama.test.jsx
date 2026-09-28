import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
import { SpecView } from './OfertareOrganigrama.jsx'

describe('R16 — organigrama distinge necunoscut de false în UI', () => {
  it.each([{}, { obligatorie: null }])('câmp omis/null → verifică documentația', spec => {
    const html = renderToStaticMarkup(<SpecView spec={spec} />)
    expect(html).toContain('nu s-a putut stabili — verifică documentația')
    expect(html).not.toContain('Organigrama nu e cerută explicit')
    expect(html).toContain('asociați (?)')
  })
  it('false explicit → nu e cerută explicit', () => {
    const html = renderToStaticMarkup(<SpecView spec={{ obligatorie: false, linii_cerute: { asociati: false } }} />)
    expect(html).toContain('Organigrama nu e cerută explicit (se depune oricum)')
    expect(html).not.toContain('asociați (?)')
  })
  it('true explicit → cerută explicit', () => {
    const html = renderToStaticMarkup(<SpecView spec={{ obligatorie: true }} />)
    expect(html).toContain('Organigrama e cerută explicit')
    expect(html).not.toContain('Organigrama nu e cerută explicit')
  })
})
