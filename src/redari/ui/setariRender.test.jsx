// Randare server-side (react-dom/server) a ecranelor UAT + Setări proiect: prinde erorile de randare și verifică ce vede fiecare nivel.
// Efectele (cererile Supabase) nu rulează la renderToString; supabase e oricum simulat.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => { const q = { then: r => Promise.resolve({ data: [], error: null, count: 0 }).then(r) }
  for (const op of ['select', 'eq', 'is', 'not', 'update', 'insert', 'order']) q[op] = () => q; return q } } }))

import UatEcran from './UatEcran.jsx'
import SetariProiect from './SetariProiect.jsx'
import FormularCampuri from './FormularCampuri.jsx'
import { CAMPURI_UAT } from '../setari.js'

const proiect = { id: 'p1', cod: 'TEST-PR', denumire: 'Proiect test', text_gdpr: 'Text GDPR de test', text_declaratie: 'Declarație de test', contact_email: 'test@example.invalid' }
const uats = [
  { id: 'u1', proiect_id: 'p1', nume: 'Test UAT', uat3: 'TST', judet: 'Test', sesiune_zi1: '2026-12-10', program_zi1: '09:00 – 16:00', reprezentant_uat_nume: 'Repr test' },
  { id: 'u2', proiect_id: 'p1', nume: 'Alt UAT', uat3: 'ALT' },
]
const show = () => {}

describe('ecranul UAT', () => {
  it('admin: tabelul cu ambele UAT-uri și butonul de UAT nou', () => {
    const h = renderToString(<UatEcran proiect={proiect} uats={uats} nivel="admin" show={show} onSchimbat={() => {}} />)
    expect(h).toContain('Test UAT')
    expect(h).toContain('Alt UAT')
    expect(h).toContain('10.12')
    expect(h).toContain('UAT nou')
    expect(h).toContain('nicio zi de sesiune cu program')        // u2 nu e gata
    expect(h).toContain('proiect fără nr./dată contract')        // proiectul de test nu are contract
  })
  it('viewer: fără butonul de UAT nou', () => {
    const h = renderToString(<UatEcran proiect={proiect} uats={uats} nivel="viewer" show={show} onSchimbat={() => {}} />)
    expect(h).not.toContain('UAT nou')
    expect(h).toContain('Doar administratorul modifică UAT-urile')
  })
  it('fără UAT-uri: mesaj gol', () => {
    expect(renderToString(<UatEcran proiect={proiect} uats={[]} nivel="admin" show={show} onSchimbat={() => {}} />)).toContain('Proiectul nu are UAT-uri')
  })
})

describe('FormularCampuri', () => {
  it('blocat = toate input-urile dezactivate (salvare în curs, Jakarinos f2 r2 P2)', () => {
    const h = renderToString(<FormularCampuri campuri={CAMPURI_UAT} form={{}} onChange={() => {}} blocat />)
    const inputuri = h.match(/<input[^>]*>/g) || []
    expect(inputuri.length).toBe(CAMPURI_UAT.length)
    expect(inputuri.every(i => /disabled=""/.test(i))).toBe(true)
  })
  it('neblocat = editabil', () => {
    const h = renderToString(<FormularCampuri campuri={CAMPURI_UAT} form={{}} onChange={() => {}} />)
    expect(/disabled/.test(h)).toBe(false)
  })
})

describe('ecranul Setări proiect', () => {
  it('admin: câmpuri editabile + butonul Salvează + lipsurile pentru convocator', () => {
    const h = renderToString(<SetariProiect proiect={proiect} nivel="admin" show={show} onSchimbat={() => {}} />)
    expect(h).toContain('TEST-PR')
    expect(h).toContain('<textarea')
    expect(h).toContain('Salvează')
    expect(h).toContain('Pentru convocări lipsește')
    expect(h).toContain('Reprezentant A.P.M.')
  })
  it('editor: citire, fără input-uri și fără Salvează', () => {
    const h = renderToString(<SetariProiect proiect={proiect} nivel="editor" show={show} onSchimbat={() => {}} />)
    expect(h).not.toContain('<input')
    expect(h).not.toContain('<textarea')
    expect(h).not.toContain('Salvează')
    expect(h).toContain('Text GDPR de test')
  })
})
