// Randare server-side a coloanei „SMS” și a filtrului SMS din Registru + rândul „SMS:” din Fișa parcelei (20261130i).
// supabase e simulat doar ca importurile să nu atingă rețeaua.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('fără BD în test') }, rpc: () => { throw new Error('fără BD în test') } } }))

import { CelulaSms, FiltruSms } from './SmsRegistru.jsx'
import { RandSms } from './FisaParcela.jsx'
import { hartaSms } from '../smsStare.js'

const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const harta = hartaSms([{ detinator_id: ID1, nr_trimise: 3, nr_livrate: 1, nr_esuate: 1, nr_in_curs: 0, ultima_stare: 'livrat',
  ultima_trimitere: '2026-11-04T10:00:00Z', ultima_livrare: '2026-11-04T10:01:00Z', loturi: 2, categorie: 'livrat' }])
const h = (el) => renderToString(el).replace(/<!-- -->/g, '')

describe('Registru — coloana SMS', () => {
  it('deținător cu SMS: badge cu ultima stare, ×N, data și tooltip cu cifrele', () => {
    const x = h(<CelulaSms sms={{ harta, eroare: null }} detinatorId={ID1} />)
    expect(x).toContain('data-sms="livrat"')
    expect(x).toContain('✅ livrat ×3 · 04.11.2026')
    expect(x).toContain('title="trimise 3 · livrate 1 · eșuate 1 · loturi 2')
  })
  it('fără SMS: „—”', () => {
    expect(h(<CelulaSms sms={{ harta, eroare: null }} detinatorId={ID2} />)).toContain('data-sms="fara"')
  })
  it('eroare de citire: „eroare”, NU „—” (L18); încărcare: „…”', () => {
    const e = h(<CelulaSms sms={{ harta: null, eroare: 'function fn_red_sms_stare does not exist' }} detinatorId={ID1} />)
    expect(e).toContain('data-sms="eroare"')
    expect(e).toContain('does not exist')
    expect(e).not.toContain('—')
    expect(h(<CelulaSms sms={{ harta: null, eroare: null }} detinatorId={ID1} />)).toContain('data-sms="incarcare"')
  })
})

describe('Registru — filtrul SMS', () => {
  it('opțiunile cerute, activ când harta e citită', () => {
    const x = h(<FiltruSms valoare="" onChange={() => {}} sms={{ harta, eroare: null }} />)
    for (const t of ['SMS: toate', 'SMS: fără SMS', 'SMS: trimis, nelivrat', 'SMS: livrat', 'SMS: eșuat']) expect(x).toContain(t)
    expect(x).not.toContain('disabled')
  })
  it('dezactivat la eroare (nu filtrează pe o hartă lipsă), dar rămâne activ dacă e deja ales (se poate reseta)', () => {
    expect(h(<FiltruSms valoare="" onChange={() => {}} sms={{ harta: null, eroare: 'x' }} />)).toContain('disabled')
    expect(h(<FiltruSms valoare="livrat" onChange={() => {}} sms={{ harta: null, eroare: 'x' }} />)).not.toContain('disabled')
  })
})

describe('Fișa parcelei — rândul SMS', () => {
  it('cifre, niciun SMS, eroare', () => {
    expect(h(<RandSms sms={{ harta, eroare: null }} detinatorId={ID1} />)).toContain('trimise 3 · livrate 1 · eșuate 1 · loturi 2')
    expect(h(<RandSms sms={{ harta, eroare: null }} detinatorId={ID2} />)).toContain('SMS: niciun SMS')
    expect(h(<RandSms sms={{ harta: null, eroare: 'refuz' }} detinatorId={ID1} />)).toContain('starea nu s-a putut citi (refuz)')
  })
})
