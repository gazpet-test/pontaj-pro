// Randare server-side (react-dom/server) a liniei de avertisment „constatare pe teren în 5 zile” (plan pct. 4.6) din Fișa parcelei.
// Componenta e pură (props → markup); supabase e simulat doar ca importul FisaParcela.jsx să nu atingă rețeaua.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('fără BD în test') }, rpc: () => { throw new Error('fără BD în test') } } }))

import { AvertismentConstatare } from './FisaParcela.jsx'
import { G } from './comune.jsx'

const uat = { sesiune_zi1: '2026-12-08', program_zi1: '09:00 – 16:00', sesiune_zi2: '2026-12-10', program_zi2: '09:00 – 16:00' }
const det = { id: 7, nume: 'TEST DETINATOR' }
const cerere = { id: 1, seq: 1, detinator_id: 7, optiune: 'constatare_teren', data: '2026-12-01' }
const html = (props) => renderToString(<AvertismentConstatare uat={uat} detinator={det} raspunsuri={[cerere]} pvs={[]} {...props} />).replace(/<!-- -->/g, '')

describe('FisaParcela — AvertismentConstatare', () => {
  it('termen în curs: galben, cu data-limită', () => {
    const h = html({ azi: '2026-12-15' })
    expect(h).toContain('data-testid="avertisment-constatare"')
    expect(h).toContain('termen 15.12.2026')
    expect(h).toContain(`color:${G.yellow}`)
    expect(h).not.toContain('termen depășit')
  })
  it('termen depășit: roșu', () => {
    const h = html({ azi: '2026-12-16' })
    expect(h).toContain('termen depășit')
    expect(h).toContain(`color:${G.red}`)
  })
  it('dispare după PV A semnat (teren în termen sau sediu), fără cerere și pentru deținător șters', () => {
    const pv = (constatare_mod) => ({ id: 9, tip: 'A', detinator_id: 7, stare: 'semnat', sters_la: null, constatare_mod, data_pv: '2026-12-12' })
    expect(html({ azi: '2026-12-20', pvs: [pv('teren')] })).toBe('')
    expect(html({ azi: '2026-12-20', pvs: [pv('sediu')] })).toBe('')
    expect(html({ azi: '2026-12-20', raspunsuri: [] })).toBe('')
    expect(html({ azi: '2026-12-20', detinator: { ...det, sters_la: '2026-12-01' } })).toBe('')
  })
})
