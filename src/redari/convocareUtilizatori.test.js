import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { motivPoartaUtilizatori, motivConvocatorUtilizator, salveazaPoartaUtilizatori } from './convocareUtilizatori.js'
import { genereazaConvocator } from './docx.js'
import PoartaUtilizatori from './ui/PoartaUtilizatori.jsx'

// Expected independente: proprietarul ramane permis; ambele calitati noi cer aprobarea EXACT true.
const cazuri = [
  ['proprietar', false, null], ['coproprietar', false, null],
  ['utilizator', false, 'utilizator - convocare neaprobata'], ['arendas', false, 'utilizator - convocare neaprobata'],
  ['utilizator', null, 'utilizator - convocare neaprobata'], ['arendas', undefined, 'utilizator - convocare neaprobata'],
  ['utilizator', true, null], ['arendas', true, null],
]
describe('PR3a — poarta utilizatorilor', () => {
  it.each(cazuri)('%s / %s -> %s', (calitate, flag, motiv) => {
    expect(motivPoartaUtilizatori({ convocare_utilizatori_aprobata: flag }, { calitate })).toBe(motiv)
  })
  it.each(['utilizator', 'arendas'])('generatorul refuza %s inainte de sablon, inclusiv previzualizarea', async calitate => {
    for (const permiteIncomplet of [false, true]) {
      await expect(genereazaConvocator({ detinator: { calitate }, proiect: {}, permiteIncomplet }))
        .rejects.toThrow('utilizator - convocare neaprobata')
    }
    expect(motivConvocatorUtilizator({ convocare_utilizatori_aprobata: true }, { calitate })).toMatch(/PR3b/)
    await expect(genereazaConvocator({ detinator: { calitate }, proiect: { convocare_utilizatori_aprobata: true } }))
      .rejects.toThrow('șablonul convocatorului lipsește')
  })
  it('comutatorul este vizibil doar owner-ului si ramane inchis implicit', () => {
    const p = { id: 'fictiv', versiune: 1, convocare_utilizatori_aprobata: false }
    expect(renderToStaticMarkup(React.createElement(PoartaUtilizatori, { proiect: p, esteOwner: false }))).toBe('')
    const html = renderToStaticMarkup(React.createElement(PoartaUtilizatori, { proiect: p, esteOwner: true }))
    expect(html).toContain('role="switch"')
    expect(html).not.toContain('checked=""')
  })
  it('CAS scrie doar flagul; 0 randuri = conflict; eroarea serverului se propaga', async () => {
    const jurnal = [], server = { data: [{ id: 'fictiv' }], error: null }
    const q = { update: v => { jurnal.push(v); return q }, eq: (k, v) => { jurnal.push([k, v]); return q }, select: async () => server }
    const client = { from: () => q }, proiect = { id: 'fictiv', versiune: 4, convocare_utilizatori_aprobata: false }
    await salveazaPoartaUtilizatori(client, proiect, true)
    expect(jurnal).toEqual([{ convocare_utilizatori_aprobata: true }, ['id', 'fictiv'], ['versiune', 4], ['convocare_utilizatori_aprobata', false]])
    server.data = []
    await expect(salveazaPoartaUtilizatori(client, proiect, true)).rejects.toThrow('Proiect modificat')
    server.error = { code: '42501', message: 'doar owner-ul' }
    await expect(salveazaPoartaUtilizatori(client, proiect, true)).rejects.toEqual(server.error)
  })
})
