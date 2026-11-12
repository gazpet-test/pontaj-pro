// Teste de componentă pentru RezumatZiModal (r2, rezumatul zilei): componenta reală montată cu react-dom în jsdom; clientul Supabase e
// înlocuit cu un tabel în memorie (filtrele in / eq / gt aplicate ca pe server), cu „porți” pe zi ca ordinea răspunsurilor să fie controlată.
// jsdom se caută în node_modules sau în REDARI_JSDOM_DIR (tiparul din RubricaRezumat.test.jsx); fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const S = vi.hoisted(() => ({ rapoarte: [], linii: [], eroare: null, porti: {}, cereri: [] }))
vi.mock('./lib/supabase.js', () => ({
  supabase: {
    from(t) {
      const c = { t, f: [] }; S.cereri.push(c)
      const q = {
        select() { return q }, order() { return q },
        in(k, v) { c.f.push(['in', k, v]); return q }, eq(k, v) { c.f.push(['eq', k, v]); return q }, gt(k, v) { c.f.push(['gt', k, v]); return q },
        limit(n) { c.lim = n; return q },
        then(rez, rej) {
          const zi = (c.f.find(f => f[0] === 'eq' && f[1] === 'data') || [])[2]
          const poarta = (t === 'rapoarte_zilnice' && S.porti[zi]) || Promise.resolve()
          return poarta.then(() => {
            if (S.eroare === t) return { data: null, error: new Error('permission denied') }
            const r = (t === 'rapoarte_zilnice' ? S.rapoarte : S.linii)
              .filter(x => c.f.every(([op, k, v]) => (op === 'in' ? v.includes(x[k]) : op === 'eq' ? x[k] === v : x[k] > v)))
              .sort((a, b) => a.id - b.id)
            return { data: r.slice(0, c.lim || 1000), error: null }
          }).then(rez, rej)
        },
      }
      return q
    },
  },
}))
import RezumatZiModal from './RezumatZiModal.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[RezumatZiModal.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

let curata = []
afterEach(() => {
  curata.forEach(f => f()); curata = []
  Object.assign(S, { rapoarte: [], linii: [], eroare: null, porti: {}, cereri: [] })
})

const SITES = [{ id: 1, name: 'Lot 1', raport_zilnic_necesar: true }, { id: 2, name: 'Domnești' }, { id: 3, name: 'Birou', raport_zilnic_necesar: false }]

async function monteaza(props) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator }
  const copiate = []
  Object.defineProperty(j.window.navigator, 'clipboard', { value: { writeText: async (t) => { copiate.push(t) } }, configurable: true })
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  Object.defineProperty(globalThis, 'navigator', { value: j.window.navigator, configurable: true })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  let inchis = 0
  await act(async () => { root.render(<RezumatZiModal sites={SITES} onClose={() => { inchis++ }} {...props} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, { window: vechi.window, document: vechi.document }); Object.defineProperty(globalThis, 'navigator', { value: vechi.navigator, configurable: true }) })
  const q = (a) => d.querySelector(`[data-rezumat-zi-${a}]`)
  const apasa = async (a) => { await act(async () => { q(a).dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const alegeZi = async (zi) => {
    const el = q('data')
    const setter = Object.getOwnPropertyDescriptor(j.window.HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(el, zi); el.dispatchEvent(new j.window.Event('input', { bubbles: true })) })
    await asteapta()
  }
  return { d, q, apasa, alegeZi, asteapta, act, copiate, inchis: () => inchis }
}

dom(numeDom('RezumatZiModal'), () => {
  it('ziua aleasă: textul zilei pe șantierele din ecran (nume din ecran), lipsă cele de raportat; copierea', async () => {
    S.rapoarte = [
      { id: 5, site_id: 2, data: '2026-11-11', personal_snapshot: { total: 3 }, utilaje_snapshot: [], lucrari_efectuate: 'Montaj' },
      { id: 6, site_id: 9, data: '2026-11-11', personal_snapshot: { total: 50 } },   // nu e în ecran: nu se cere
      { id: 7, site_id: 2, data: '2026-11-10', personal_snapshot: { total: 8 } },
    ]
    const u = await monteaza({ ziInitiala: '2026-11-11' })
    const text = [
      'Rapoarte șantiere — 11.11.2026: 1 șantier, 3 oameni, 0 utilaje',
      '',
      '• Domnești: 3 oameni · 0 utilaje',
      '  Lucrări: Montaj',
      '',
      'Fără raport (1): Lot 1',
    ].join('\n')
    expect(u.q('text').value).toBe(text)
    expect(S.cereri.find(c => c.t === 'rapoarte_zilnice').f.slice(0, 2)).toEqual([['in', 'site_id', [1, 2, 3]], ['eq', 'data', '2026-11-11']])
    await u.apasa('copiaza')
    expect(u.copiate).toEqual([text])
  })
  it('o eroare de citire se vede (nu „niciun raport”); fără zi = „Alege ziua”, nicio cerere', async () => {
    S.eroare = 'raport_lucrari'
    S.rapoarte = [{ id: 5, site_id: 1, data: '2026-11-11', personal_snapshot: { total: 3 } }]
    const u = await monteaza({ ziInitiala: '2026-11-11' })
    expect(u.d.querySelector('[role="alert"]').textContent).toContain('Nu s-au putut citi rapoartele zilei')
    expect(u.q('text')).toBe(null)
    expect(u.q('copiaza').disabled).toBe(true)
    curata.forEach(f => f()); curata = []; S.cereri.length = 0; S.eroare = null
    const g = await monteaza({ ziInitiala: '' })
    expect(g.d.body.textContent).toContain('Alege ziua.')
    expect(S.cereri.length).toBe(0)
  })
  it('L24: răspunsul întârziat pentru ziua veche nu suprascrie ziua aleasă după', async () => {
    S.rapoarte = [
      { id: 1, site_id: 1, data: '2026-11-11', personal_snapshot: { total: 11 } },
      { id: 2, site_id: 1, data: '2026-11-10', personal_snapshot: { total: 10 } },
    ]
    let elibereaza
    S.porti['2026-11-11'] = new Promise(r => { elibereaza = r })
    const u = await monteaza({ ziInitiala: '2026-11-11' })
    expect(u.d.body.textContent).toContain('Se citesc rapoartele')
    await u.alegeZi('2026-11-10')
    expect(u.q('text').value).toContain('10.11.2026: 1 șantier, 10 oameni')
    await u.act(async () => { elibereaza() })
    await u.asteapta()
    expect(u.q('text').value).toContain('10.11.2026: 1 șantier, 10 oameni')
    expect(u.q('text').value).not.toContain('11 oameni')
  })
})
