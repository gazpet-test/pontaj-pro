import { describe, it, expect } from 'vitest'
import { rcNecitite, etichetaRc, STARI_ROSU } from './ofertareRcNecitit.js'

// Cazul real: Racari lic. 15 — RC3 (doc 1654) + doc 1655 aduse pe 14.10.2026 17:42 RO, neprocesate; termen 26.10.2026 16:00 RO
const TERMEN = '2026-10-26T13:00:00+00:00'
const RC3 = { id: 1654, nume_original: 'RC3.pdf', stare: 'necitit', in_alerta: true, created_at: '2026-10-14T14:42:00Z' }
const RC4 = { id: 1655, nume_original: 'RC4.pdf', stare: 'necitit', in_alerta: true, created_at: '2026-10-14T14:43:00Z' }

describe('rcNecitite (banner „răspuns necitit”)', () => {
  it('Racari 19.10: 2 răspunsuri necitite de 5 zile, 7 zile până la depunere → roșu', () => {
    const r = rcNecitite([RC3, RC4, { id: 1, stare: 'citit', in_alerta: false, created_at: '2026-09-16T08:00:00Z' }], TERMEN, '2026-10-19T09:00:00Z')
    expect(r.rosu).toBe(true)
    expect(r.necitite.map(d => d.id)).toEqual([1654, 1655])
    expect(r.deLa).toBe('2026-10-14')
    expect(r.zileNecitit).toBe(5)
    expect(r.zilePanaLaDepunere).toBe(7)
  })
  it('roșu = in_alerta din RPC (aceeași funcție ca alerta zilnică); partial portocaliu doar când nu e în alertă; lipsă = roșu', () => {
    const r = rcNecitite([{ ...RC3, stare: 'perechi_necitite', in_alerta: true }, { ...RC4, stare: 'text_neverificat', in_alerta: true },
      { ...RC3, id: 9, stare: 'citit', in_alerta: false }, { ...RC3, id: 10, stare: 'partial', in_alerta: false }], TERMEN, '2026-10-19T09:00:00Z')
    expect(r.necitite.map(d => d.id)).toEqual([1654, 1655])
    expect(r.partiale.map(d => d.id)).toEqual([10])
    expect(rcNecitite([{ ...RC3, stare: 'citit', in_alerta: false }], TERMEN)).toBeNull()
    expect(rcNecitite([], TERMEN)).toBeNull()
    // fail-closed: răspuns fără in_alerta (format neașteptat) → roșu
    expect(rcNecitite([{ id: 5, stare: 'citit', created_at: '2026-10-14T14:42:00Z' }], TERMEN, '2026-10-19T09:00:00Z').rosu).toBe(true)
    expect(STARI_ROSU).toEqual(['necitit', 'perechi_necitite', 'text_neverificat'])
  })
  it('citit parțial (pagini necitite) → semnal portocaliu, nu roșu', () => {
    const r = rcNecitite([{ ...RC3, stare: 'partial', in_alerta: false }], TERMEN, '2026-10-19T09:00:00Z')
    expect(r.rosu).toBe(false)
    expect(r.partiale.length).toBe(1)
  })
  it('fără termen sau cu stare lipsă: tot apare (stare lipsă = necitit, fail-closed), zilele până la depunere = null', () => {
    const r = rcNecitite([{ ...RC3, stare: null, in_alerta: undefined }], null, '2026-10-19T09:00:00Z')
    expect(r.rosu).toBe(true)
    expect(r.zilePanaLaDepunere).toBeNull()
  })
  it('ziua pe ora României: adus la 23:30 RO (20:30 UTC) contează pe ziua aceea', () => {
    const r = rcNecitite([{ ...RC3, created_at: '2026-10-14T20:30:00Z' }], TERMEN, '2026-10-15T06:00:00Z')
    expect(r.deLa).toBe('2026-10-14')
    expect(r.zileNecitit).toBe(1)
  })
})

describe('review r1 (Copilot / Gemini)', () => {
  it('stare necunoscută = necitit (fail-closed)', () => {
    expect(rcNecitite([{ ...RC3, stare: 'stare_noua', in_alerta: true }], TERMEN, '2026-10-19T09:00:00Z').rosu).toBe(true)
  })
  it('termenTrecut pe ora exactă: în ziua depunerii, după ora-limită → trecut; înainte → nu', () => {
    expect(rcNecitite([RC3], TERMEN, '2026-10-26T16:00:00Z').termenTrecut).toBe(true)
    const r = rcNecitite([RC3], TERMEN, '2026-10-26T09:00:00Z')
    expect(r.termenTrecut).toBe(false)
    expect(r.zilePanaLaDepunere).toBe(0)
  })
  it('termen doar cu dată: în ziua depunerii NU e trecut (e „AZI”); din ziua următoare e trecut', () => {
    expect(rcNecitite([RC3], '2026-10-26', '2026-10-26T09:00:00Z').termenTrecut).toBe(false)
    expect(rcNecitite([RC3], '2026-10-26', '2026-10-26T20:00:00Z').termenTrecut).toBe(false)
    expect(rcNecitite([RC3], '2026-10-26', '2026-10-27T06:00:00Z').termenTrecut).toBe(true)
  })
})

describe('20261104a: eticheta în banner', () => {
  it('numele + motivul stării', () => {
    expect(etichetaRc({ id: 1624, nume_original: 'Raspuns 2.pdf', stare: 'perechi_necitite' })).toBe('Raspuns 2.pdf (perechile întrebare – răspuns necitite)')
    expect(etichetaRc({ id: 1654, nume_original: 'RC3.pdf', stare: 'text_neverificat' })).toBe('RC3.pdf (text OCR local neverificat)')
    expect(etichetaRc({ id: 7, stare: 'necitit' })).toBe('#7')
  })
})
