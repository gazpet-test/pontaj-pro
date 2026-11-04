// Randare server-side a tabului 📬 Notificări (ghid, canale, centralizator) pe date fictive; supabase e simulat (fără rețea).
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('fără BD în test') }, rpc: () => { throw new Error('fără BD în test') } } }))

import NotificariEcran, { TabelCentralizator, TabelCanale, citesteCentralizator } from './NotificariEcran.jsx'
import { agregaDetinatori, centralizeaza } from '../notificari.js'

const h = el => renderToString(el).replace(/<!-- -->/g, '')
const ID = '00000001-0000-4000-8000-000000000000'
const proiect = { id: 'p', cod: 'TEST-X', contract_nr: '1', contract_data: '2025-01-01', text_gdpr: 'g', contact_nume: 'C' }
const uats = [{ id: 'u1', nume: 'Alfa', uat3: 'ALF' }]
const centralizator = {
  randuri: [{ parcela_id: 'p1', detinator_id: ID, uat_id: 'u1', uat3: 'ALF', uat_nume: 'Alfa', id_parcela: 'T1-ALF-0001', tronson: 1, nume: 'Persoana Unu', calitate: 'proprietar', adresa_cunoscuta: false, stare: 'FARA_ADRESA_AFISARE' }],
  convocari: [], raspunsuri: [], pvs: [], sms: null, cuTelefon: null, avertismente: ['SMS: function fn_red_sms_stare does not exist'],
}

describe('NotificariEcran', () => {
  it('ghidul: toate modelele, cu starea și lipsurile proiectului', () => {
    const x = h(<NotificariEcran proiect={proiect} uats={uats} nivel="viewer" dateInitiale={{ ghid: { corespondenta: [{ cod: 'A1', ordine: 1, destinatar: 'Transgaz', subiect: 'Planul', stare: 'la_avocat' }] }, centralizator }} />)
    for (const c of ['convocator', 'plic', 'ar', 'borderou', 'formular', 'gdpr', 'pv_a', 'pv_b', 'pv_c', 'adresa_uat', 'afisare', 'cerere_imputernicire', 'coresp', 'sms', 'mail_proprietari'])
      expect(x).toContain(`data-model="${c}"`)
    expect(x).toContain('proiect fără nr./dată împuternicire Transgaz')
    expect(x).toContain('data-stare="nelivrat"')
    expect(x).toContain('data-coresp="A1"')
    expect(x).toContain('La avocat')
  })
  it('centralizatorul: sursa SMS căzută = „?” + avertisment, nu 0 (L18); fără telefoane', () => {
    const x = h(<NotificariEcran proiect={proiect} uats={uats} nivel="viewer" subtabInitial="centralizator" dateInitiale={{ ghid: {}, centralizator }} />)
    expect(x).toContain('fn_red_sms_stare does not exist')
    expect(x).toContain('data-total="1"')
    expect(x).toContain('title="sursa nu s-a putut citi"')
    expect(x).toContain('Persoana Unu')
    expect(x).toContain('fără adresă')
    expect(x).toContain('Export xlsx (fără telefoane)')
  })
  it('canalele de răspuns: cele 6 canale, cu cifre', () => {
    const x = h(<TabelCanale statistici={{ toate: { telefon: 3 }, ultim: { telefon: 2 } }} />)
    for (const c of ['online', 'telefon', 'sesiune', 'scris', 'sms', 'email']) expect(x).toContain(`data-canal="${c}"`)
    expect(x).toContain('PR #987')
    expect(h(<TabelCanale statistici={null} />)).toContain('…')
  })
  it('fără date inițiale: „Se încarcă” până la citire (fără rețea în randarea pe server)', () => {
    expect(h(<NotificariEcran proiect={proiect} uats={uats} nivel="admin" subtabInitial="centralizator" />)).toContain('Se încarcă')
  })
  it('Jak #992 P2-5: un UAT ales din alt proiect nu golește lista (se ignoră, selectorul arată „Toate”)', () => {
    const x = h(<NotificariEcran proiect={proiect} uats={uats} nivel="viewer" subtabInitial="centralizator" uatInitial="uat-din-proiectul-A" dateInitiale={{ ghid: {}, centralizator }} />)
    expect(x).toContain('Persoana Unu')
    expect(x).toContain('Deținătorii pe filtrul ales (1)')
    expect(x).toMatch(/<option value="" selected="">Toate UAT-urile<\/option>/)
  })
  it('Jak #992 P1-1: „de trimis” necunoscut apare ca „?” în listă, nu „da”', () => {
    const x = h(<NotificariEcran proiect={proiect} uats={uats} nivel="viewer" subtabInitial="centralizator" dateInitiale={{ ghid: {}, centralizator }} />)
    expect(x).toContain('data-de-trimis="null"')
    expect(x).not.toContain('data-de-trimis="true"')
  })
  it('tabelul centralizatorului randat din agregare', () => {
    const x = h(<TabelCentralizator cent={centralizeaza(agregaDetinatori({ ...centralizator, sms: new Map(), cuTelefon: new Set(), uats }))} />)
    expect(x).toContain('data-uat="u1"')
    expect(x).not.toContain('title="sursa nu s-a putut citi"')
  })
})

describe('citesteCentralizator', () => {
  // client fals: înregistrează cererile; red_v_stare_parcela are 1 rând, restul tabelelor gol
  function client({ eroareSms = false, eroareConv = false } = {}) {
    const cereri = []
    const builder = (tabel) => {
      const st = { tabel, filtre: [] }
      const b = new Proxy({}, { get: (_, k) => {
        if (k === 'then') {
          const data = st.tabel === 'red_v_stare_parcela' && !st.filtre.some(f => f[0] === 'or') ? centralizator.randuri : []
          if (st.tabel === 'red_convocari' && eroareConv) return (res) => res({ data: null, error: { message: 'permission denied' } })
          return (res) => res({ data, error: null })
        }
        return (...a) => { st.filtre.push([k, ...a]); if (k === 'select') cereri.push([tabel, a[0]]); return b }
      } })
      return b
    }
    return { cereri, from: builder, rpc: () => builder(eroareSms ? 'rpc_err' : 'rpc') }
  }
  it('viewer: fără citire de contact; SMS citit (listă goală = fără SMS)', async () => {
    const c = client()
    const d = await citesteCentralizator(c, 'p', { poateContact: false }, () => true)
    expect(d.randuri).toHaveLength(1)
    expect(c.cereri.map(x => x[0])).not.toContain('red_detinatori_contact')
    expect(d.cuTelefon).toBeNull()
    expect(d.sms).toBeInstanceOf(Map)
  })
  it('admin: contactul se citește DOAR ca detinator_id (fără telefon în memorie)', async () => {
    const c = client()
    const d = await citesteCentralizator(c, 'p', { poateContact: true }, () => true)
    expect(c.cereri).toContainEqual(['red_detinatori_contact', 'detinator_id'])
    expect(d.cuTelefon).toBeInstanceOf(Set)
  })
  it('eroarea unei surse obligatorii aruncă (nu devine „gol”)', async () => {
    await expect(citesteCentralizator(client({ eroareConv: true }), 'p', { poateContact: false }, () => true)).rejects.toMatchObject({ message: 'permission denied' })
  })
})
