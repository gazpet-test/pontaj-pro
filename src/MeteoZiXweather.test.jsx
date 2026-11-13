// Teste de componentă pentru MeteoZiXweather (blocul „Vremea zilei” din raportul zilnic, 20261221a, r2 după review P2):
// întâi se află dacă vederea / rândul există, abia apoi se alege mesajul. Migrarea neaplicată (vederea lipsește) = blocul NU apare deloc,
// nici titlul, nici eroarea, nici promisiunea „după miezul nopții” — în orice zi. Altă eroare rămâne eroare (L18).
// jsdom nu e dependență a proiectului: se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import MeteoZiXweather from './MeteoZiXweather.jsx'
import { aziBuc, TEXT_IN_CURS, TEXT_FARA } from './meteoXweatherUtil.js'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[MeteoZiXweather.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const AZI = aziBuc()
const IERI = new Date(Date.parse(AZI + 'T12:00:00Z') - 86400e3).toISOString().slice(0, 10)
const LIPSA = { code: 'PGRST205', message: "Could not find the table 'public.v_meteo_zilnic_xweather' in the schema cache", details: null, hint: null }
const R = {
  site_id: 10, data: IERI, versiune: 1, versiuni: 1, tmin_c: 1.2, tmax_c: 9.46, tmed_c: 5.04, precipitatii_mm: 4.6, zapada_cm: 0,
  vant_max_kmh: 31.5, rafala_max_kmh: 52.3, vant_dir: 'NW', vant_dir_grade: 315, umiditate_med: 81.4, descriere: 'Light Rain',
  lat: 44.94, lng: 26.02, observatii_stare: 'ok', statie_id: 'LRBS', statie_nume: 'Bucuresti/Baneasa', statie_distanta_km: 12.37,
  preluat_la: '2026-11-13T04:05:10Z', prima_preluare_la: '2026-11-13T04:05:10Z',
}
// client fals: rândurile vederii sau o eroare; numără cererile
function clientFals({ randuri = [], eroare = null } = {}) {
  const cereri = []
  return {
    cereri,
    from(t) {
      const f = {}
      const q = {
        select: () => q, limit: () => q,
        eq: (c, v) => { f[c] = v; return q },
        then: (res, rej) => {
          cereri.push({ t, ...f })
          return Promise.resolve(eroare ? { data: null, error: eroare } : { data: randuri.filter(r => r.site_id === f.site_id && r.data === f.data), error: null }).then(res, rej)
        },
      }
      return q
    },
  }
}

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = [] })

async function monteaza(props) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  await act(async () => { root.render(<MeteoZiXweather {...props} />) })
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const d = j.window.document
  return { d, text: () => d.getElementById('r').textContent, stare: () => d.querySelector('[data-meteo-zi]')?.getAttribute('data-meteo-zi') ?? null }
}
const cadru = (c) => <section data-cadru="1"><h4>Vremea zilei (titlu)</h4>{c}</section>

dom(numeDom('MeteoZiXweather — ordinea verificărilor (jsdom + react-dom)'), () => {
  it('migrarea NEAPLICATĂ, ziua în curs: nimic afișat (nici „după miezul nopții”, nici eroare, nici titlul cadrului)', async () => {
    const c = clientFals({ eroare: LIPSA })
    const u = await monteaza({ siteId: 10, data: AZI, client: c, cadru })
    expect(c.cereri.length).toBe(1)          // s-a verificat întâi existența
    expect(u.stare()).toBeNull()
    expect(u.text()).toBe('')
    expect(u.d.querySelector('[data-cadru]')).toBeNull()
  })
  it('migrarea NEAPLICATĂ, zi trecută: nimic afișat', async () => {
    const u = await monteaza({ siteId: 10, data: IERI, client: clientFals({ eroare: { code: '42P01', message: 'relation "public.v_meteo_zilnic_xweather" does not exist' } }), compact: true })
    expect(u.text()).toBe('')
  })
  it('migrarea APLICATĂ, azi fără rând: „după miezul nopții”, în cadru', async () => {
    const u = await monteaza({ siteId: 10, data: AZI, client: clientFals(), cadru })
    expect(u.stare()).toBe('in_curs')
    expect(u.text()).toContain(TEXT_IN_CURS)
    expect(u.d.querySelector('[data-cadru]')).not.toBeNull()
  })
  it('migrarea APLICATĂ, zi trecută fără rând: „fără rezumat”', async () => {
    const u = await monteaza({ siteId: 10, data: IERI, client: clientFals() })
    expect(u.stare()).toBe('fara_date')
    expect(u.text()).toContain(TEXT_FARA)
  })
  it('migrarea APLICATĂ, cu rând: valorile + sursa', async () => {
    const u = await monteaza({ siteId: 10, data: IERI, client: clientFals({ randuri: [R] }) })
    expect(u.stare()).toBe('date')
    expect(u.text()).toContain('Ploaie slabă')
    expect(u.text()).toContain('Sursa: Vaisala Xweather')
  })
  it('altă eroare (drepturi / rețea): se arată ca eroare, nu ca „fără date” și nu ascunsă (L18)', async () => {
    const u = await monteaza({ siteId: 10, data: IERI, client: clientFals({ eroare: { code: '42501', message: 'permission denied for view v_meteo_zilnic_xweather' } }) })
    expect(u.stare()).toBe('eroare')
    expect(u.text()).toContain('vremea zilei nu se poate citi: permission denied for view v_meteo_zilnic_xweather')
    expect(u.text().match(/nu se poate citi/g)).toHaveLength(1)
  })
})
