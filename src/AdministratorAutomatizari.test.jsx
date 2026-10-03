import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
import AdministratorAutomatizari, { filtreazaAutomatizari, fisaIncompleta } from './AdministratorAutomatizari.jsx'

const complet = { citeste_extern: 'nu', ce_scrie: 'tabelul x', identitate: 'postgres', cine_porneste: 'pg_cron', confirmare_umana: 'nimic' }
const rows = [
  { id: 1, cod: 'cron_a', nume: 'Sincronizare OLX', tip: 'cron_bd', stare: 'activ', unde: 'Supabase pg_cron', ce_face: 'aduce aplicările', referinta: 'olx_aplicari_sync_30min', ...complet },
  { id: 2, cod: 'rutina_b', nume: 'Rutina zilnică', tip: 'rutina_claude', stare: 'activ', unde: 'Claude Routines', ce_face: 'tichete și recap', referinta: 'trig_01P2', ...complet, cine_porneste: 'necompletat în registru — de verificat' },
  { id: 3, cod: 'script_c', nume: 'Scan acte', tip: 'script_pc', stare: 'oprit', unde: 'PC Răzvan', ce_face: 'scanează NAS', ...complet, identitate: null },
]

describe('Administrator › Automatizări', () => {
  it('filtrează după tip, stare și text', () => {
    expect(filtreazaAutomatizari(rows, { tip: 'cron_bd' }).map(r => r.id)).toEqual([1])
    expect(filtreazaAutomatizari(rows, { stare: 'oprit' }).map(r => r.id)).toEqual([3])
    expect(filtreazaAutomatizari(rows, { cauta: 'trig_01' }).map(r => r.id)).toEqual([2])
    expect(filtreazaAutomatizari(rows, { cauta: '  NAS ' }).map(r => r.id)).toEqual([3])
    expect(filtreazaAutomatizari(rows).length).toBe(3)
    expect(filtreazaAutomatizari(null)).toEqual([])
  })
  it('fișa e incompletă dacă lipsește un punct a–e sau e marcat de verificat', () => {
    expect(fisaIncompleta(rows[0])).toBe(false)
    expect(fisaIncompleta(rows[1])).toBe(true)
    expect(fisaIncompleta(rows[2])).toBe(true)
  })
  it('non-owner: nu randează lista', () => {
    const html = renderToStaticMarkup(<AdministratorAutomatizari profile={{ id: 'x', is_owner: false }} />)
    expect(html).toContain('vizibil doar ownerilor')
    expect(html).not.toContain('Automatizări active')
  })
  it('owner: randează metricile și nota despre secrete', () => {
    const html = renderToStaticMarkup(<AdministratorAutomatizari profile={{ id: 'x', is_owner: true }} />)
    expect(html).toContain('Automatizări active')
    expect(html).toContain('Valorile secretelor nu apar niciodată aici')
  })
})
