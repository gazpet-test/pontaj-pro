// Opțiunea „Nu particip — am obiecții” retrasă pentru răspunsuri NOI (decizia Răzvan 17.11.2026, juridic#046), dar afișabilă la
// răspunsurile vechi. Randare server-side pe date fictive; supabase e simulat (fără rețea).
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('fără BD în test') }, rpc: () => { throw new Error('fără BD în test') } } }))

import { ListaOptiuni, Rezumat, OPTIUNI_NOI, titluOptiune } from '../../RedariRaspunsPublic.jsx'
import { ModalRaspunsTelefon } from '../../Redari.jsx'
import { OPTIUNI_RASPUNS, OPTIUNI_RASPUNS_NOI, etichetaOptiune } from './comune.jsx'
import { calculeazaStare } from '../stare.js'
import { randRegistru } from '../exportXlsx.js'

const h = el => renderToString(el).replace(/<!-- -->/g, '')
const RETRASA = 'nu_particip_cu_obiectii'
// cele trei opțiuni din modelul de convocator (juridic#046 pct. 1), în ordine
const TREI = ['particip', 'nu_particip_fara_obiectii', 'constatare_teren']

describe('formularul public', () => {
  it('oferă exact trei variante, fără opțiunea retrasă', () => {
    expect(OPTIUNI_NOI.map(o => o.cod)).toEqual(TREI)
    const x = h(<ListaOptiuni optiune="" onAlege={() => {}} />)
    expect([...x.matchAll(/data-optiune="([^"]+)"/g)].map(m => m[1])).toEqual(TREI)
    expect(x).not.toContain(RETRASA)
    expect(x).not.toContain('Nu particip — am obiecții')
  })
  it('opțiunea a doua: textul din model („spre semnare, electronic”), fără „întocmit în lipsa mea”', () => {
    const x = h(<ListaOptiuni optiune="nu_particip_fara_obiectii" onAlege={() => {}} />)
    expect(x).toContain('Sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.')
    expect(x).not.toContain('întocmit în lipsa mea')
    expect(x).toContain('aria-checked="true"')
  })
  it('un răspuns cu codul vechi se afișează în continuare (titlu + obiecții)', () => {
    expect(titluOptiune(RETRASA)).toBe('Nu particip — am obiecții')
    const x = h(<Rezumat inst={{ optiune: RETRASA, obiectii: 'Gard nerefăcut (text fictiv)', la: new Date('2026-11-17T10:00:00Z') }} />)
    expect(x).toContain('Nu particip — am obiecții')
    expect(x).toContain('Gard nerefăcut (text fictiv)')
    expect(x).toContain('Obiecții')
  })
})

describe('ecranul intern (răspuns înregistrat de operator)', () => {
  const rand = { detinator_id: 'd1', uat_id: 'u1', nume: 'FICTIV UNU', uat3: 'TST' }
  const uats = [{ id: 'u1', nume: 'UAT Test', sesiune_zi1: '2026-12-10', program_zi1: '09:00 – 16:00' }]
  const modal = (u = uats) => h(<ModalRaspunsTelefon rand={rand} profile={{}} uats={u} proiect={{}} show={() => {}} onClose={() => {}} onGata={() => {}} />)
  it('lista de opțiuni nu mai are „Nu particip, cu obiecții” (cu și fără zile de sesiune)', () => {
    expect(OPTIUNI_RASPUNS_NOI.map(o => o.cod)).toEqual(TREI)
    for (const u of [uats, [{ id: 'u1', nume: 'UAT Test' }]]) {
      const x = modal(u)
      const optiuni = [...x.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(v => [...TREI, RETRASA].includes(v))
      expect(optiuni).toEqual(TREI)
      expect(x).not.toContain('Nu particip, cu obiecții')
    }
  })
  it('eticheta codului vechi rămâne pentru registru, fișă și export; starea îl tratează ca obiecții', () => {
    expect(OPTIUNI_RASPUNS.map(o => o.cod)).toContain(RETRASA)
    expect(etichetaOptiune(RETRASA)).toBe('Nu particip, cu obiecții')
    expect(calculeazaStare({ calitate: 'proprietar', adresa_cunoscuta: true, convocari: [], raspunsuri: [{ optiune: RETRASA, data: '2026-11-20T10:00:00Z', seq: 1 }] }).stare).toBe('OBIECTII_DE_TRATAT')
    const r = randRegistru({ parcela: { id: 'p1', id_parcela: 'TEST-1' }, uat: { id: 'u1', nume: 'UAT Fictiv' }, detinator: { id: 'd1', nume: 'FICTIV UNU', calitate: 'proprietar' },
      convocari: [], raspunsuri: [{ detinator_id: 'd1', data: '2026-11-20', seq: 1, optiune: RETRASA, obiectii_text: 'X' }], stare: 'OBIECTII_DE_TRATAT' })
    expect(r.X).toBe('Nu particip, cu obiecții')
  })
})
