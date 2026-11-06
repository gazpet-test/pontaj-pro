import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
vi.mock('../../lib/supabase.js', () => ({ supabase: {} }))
import { GrupuriDetinatori } from './FisaParcela.jsx'
import FiltruRol from './FiltruRol.jsx'
import NotificariEcran from './NotificariEcran.jsx'

const h = el => renderToString(el).replace(/<!-- -->/g, '')
it('Fișa: proprietari și utilizatori/arendași în grupuri separate, inclusiv istoricul șters', () => {
  const detinatori = [
    { id: 'p', nume: 'FICTIV P', calitate: 'coproprietar' },
    { id: 'u', nume: 'FICTIV U', calitate: 'utilizator' },
    { id: 'a', nume: 'FICTIV A', calitate: 'arendas' },
    { id: 's', nume: 'FICTIV S', calitate: 'utilizator', sters_la: '2026-11-05' },
  ]
  const html = h(<GrupuriDetinatori detinatori={detinatori} renderDetinator={d => <b key={d.id}>{d.nume}</b>} />)
  const [proprietari, utilizatori] = html.split('<section aria-label="Utilizatori / arendași">')
  expect(proprietari).toContain('Proprietari / moștenitori (1)')
  expect(proprietari).toContain('FICTIV P')
  expect(proprietari).not.toContain('FICTIV U')
  expect(utilizatori).toContain('Utilizatori / arendași (2)')
  for (const nume of ['FICTIV U', 'FICTIV A', 'FICTIV S']) expect(utilizatori).toContain(nume)
})
it.each(['toti', 'proprietar', 'utilizator'])('selector accesibil, alegere curentă %s', valoare => {
  expect(h(<FiltruRol valoare={valoare} onChange={() => {}} />)).toContain(`<option value="${valoare}" selected="">`)
  expect(h(<FiltruRol valoare={valoare} onChange={() => {}} disabled />)).toContain('disabled=""')
})
it('Notificări: o parcelă închisă prin utilizator, cu două perechi; filtrul de rol este prezent', () => {
  const randuri = [
    { parcela_id: 'p', detinator_id: 'd1', uat_id: 'u', calitate: 'proprietar', stare: 'PV_A_ACOPERIT_PARCELA', nume: 'FICTIV P' },
    { parcela_id: 'p', detinator_id: 'd2', uat_id: 'u', calitate: 'utilizator', stare: 'PV_A_SEMNAT', nume: 'FICTIV U' },
  ]
  const html = h(<NotificariEcran proiect={{ id: 'proiect' }} uats={[{ id: 'u', nume: 'FICTIV' }]} nivel="viewer" subtabInitial="centralizator"
    dateInitiale={{ ghid: {}, centralizator: { randuri, convocari: [], raspunsuri: [], pvs: [], avertismente: [] } }} />)
  expect(html).toContain('aria-label="Rol"')
  expect(html).toContain('Deținătorii pe filtrul ales (2)')
  expect(html).toContain('Parcele închise (PV A sau B)')
})
