// Teste de componentă pentru RubricaRezumat (20261216a): componenta reală montată cu react-dom în jsdom; clientul Supabase e înlocuit
// cu promisiuni eliberate manual de test (ordinea răspunsurilor controlată). Fără rețea, fără librării noi: jsdom se caută în node_modules
// sau în REDARI_JSDOM_DIR (tiparul din OameniSantierButon.test.jsx); fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const cereri = []   // fiecare UPDATE: { patch, eq: [[col, val]…], res }
vi.mock('./lib/supabase.js', () => {
  const update = (patch) => {
    const c = { patch, eq: [] }
    const lant = {
      eq(col, val) { c.eq.push([col, val]); return lant },
      select() { return new Promise((res) => { c.res = res; cereri.push(c) }) },
    }
    return lant
  }
  const profiles = { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: 'NUME TEST' }, error: null }) }) }) }
  return { supabase: { from: (t) => (t === 'profiles' ? profiles : { update }) } }
})
import RubricaRezumat from './RubricaRezumat.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[RubricaRezumat.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = []; cereri.length = 0; vi.restoreAllMocks() })

const RAPORT = {
  id: 7, versiune_salvare: 3, rezumat_text: 'Șantier X · 10.11.2026\nOameni: 4', rezumat_sursa: 'automat',
  rezumat_la: '2026-11-10T15:00:00+00:00', rezumat_de: null, updated_at: '2026-11-10T15:00:00+00:00',
}

async function monteaza(props) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator }
  const copiate = []
  Object.defineProperty(j.window.navigator, 'clipboard', { value: { writeText: async (t) => { copiate.push(t) } }, configurable: true })
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  Object.defineProperty(globalThis, 'navigator', { value: j.window.navigator, configurable: true })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  j.window.confirm = () => true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }) }
  const actualizari = []
  const randeaza = async (p) => {
    await act(async () => { root.render(<RubricaRezumat poateEdita onActualizat={(r) => actualizari.push(r)} {...p} />) })
    await asteapta()
  }
  await randeaza(props)
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, { window: vechi.window, document: vechi.document }); Object.defineProperty(globalThis, 'navigator', { value: vechi.navigator, configurable: true }) })
  const q = (a) => d.querySelector(`[data-rezumat-${a}]`)
  const apasa = async (a) => { await act(async () => { q(a).dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (t) => {
    const ta = q('editor')
    const setter = Object.getOwnPropertyDescriptor(j.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => { setter.call(ta, t); ta.dispatchEvent(new j.window.Event('input', { bubbles: true })) })
    await asteapta()
  }
  const elibereaza = async (i, rezultat) => { await act(async () => { cereri[i].res(rezultat) }); await asteapta() }
  return { d, q, apasa, scrie, elibereaza, randeaza, copiate, actualizari }
}

dom(numeDom('RubricaRezumat'), () => {
  it('fără coloanele rezumatului (migrarea neaplicată) nu apare nimic', async () => {
    const { id, versiune_salvare } = RAPORT
    const u = await monteaza({ raport: { id, versiune_salvare } })
    expect(u.d.getElementById('r').innerHTML).toBe('')
  })
  it('automat: textul, eticheta, copierea; fără drept = fără corectură', async () => {
    const u = await monteaza({ raport: RAPORT, poateEdita: false })
    expect(u.q('text').textContent).toBe(RAPORT.rezumat_text)
    expect(u.q('eticheta').textContent).toContain('generat automat')
    expect(u.q('corecteaza')).toBe(null)
    expect(u.q('automat')).toBe(null)
    await u.apasa('copiaza')
    expect(u.copiate).toEqual([RAPORT.rezumat_text])
    expect(u.q('copiat').textContent).toBe('Copiat ✓')
  })
  it('corectura: UPDATE cu CAS pe id + versiune, sursa editat; rândul întors ajunge la părinte', async () => {
    const u = await monteaza({ raport: RAPORT })
    await u.apasa('corecteaza')
    await u.scrie('Text corectat')
    await u.apasa('salveaza')
    expect(cereri.length).toBe(1)
    expect(cereri[0].patch).toEqual({ rezumat_text: 'Text corectat', rezumat_sursa: 'editat' })
    expect(cereri[0].eq).toEqual([['id', 7], ['versiune_salvare', 3]])
    const rand = { ...RAPORT, rezumat_text: 'Text corectat', rezumat_sursa: 'editat', versiune_salvare: 4 }
    await u.elibereaza(0, { data: [rand], error: null })
    expect(u.actualizari).toEqual([rand])
    expect(u.q('editor')).toBe(null)
  })
  it('0 rânduri (conflict / fără drept) și eroarea serverului se arată; nimic nu ajunge la părinte (L18)', async () => {
    const u = await monteaza({ raport: RAPORT })
    await u.apasa('corecteaza'); await u.scrie('A'); await u.apasa('salveaza')
    await u.elibereaza(0, { data: [], error: null })
    expect(u.q('eroare').textContent).toContain('s-a modificat între timp')
    await u.apasa('salveaza')
    await u.elibereaza(1, { data: null, error: { message: 'rezumat: nu ai drept de scriere pe raportul acestui șantier' } })
    expect(u.q('eroare').textContent).toBe('Nu s-a salvat: rezumat: nu ai drept de scriere pe raportul acestui șantier')
    expect(u.actualizari).toEqual([])
    expect(u.q('editor')).not.toBe(null)   // textul omului rămâne în editor
  })
  it('text gol = refuz local, fără cerere', async () => {
    const u = await monteaza({ raport: RAPORT })
    await u.apasa('corecteaza'); await u.scrie('   '); await u.apasa('salveaza')
    expect(cereri.length).toBe(0)
    expect(u.q('eroare').textContent).toMatch(/gol/)
  })
  it('răspunsul unei cereri pentru alt raport nu se aplică după schimbarea raportului (L24)', async () => {
    const u = await monteaza({ raport: RAPORT })
    await u.apasa('corecteaza'); await u.scrie('Pentru 7'); await u.apasa('salveaza')
    await u.randeaza({ raport: { ...RAPORT, id: 8, rezumat_text: 'Raportul 8' } })
    await u.elibereaza(0, { data: [{ ...RAPORT, rezumat_text: 'Pentru 7', rezumat_sursa: 'editat' }], error: null })
    expect(u.actualizari).toEqual([])
    expect(u.q('text').textContent).toBe('Raportul 8')
  })
  it('editat: autorul, „Revino la automat” (sursa automat, textul îl scrie serverul), avertisment la corectură mai veche decât raportul', async () => {
    const r = { ...RAPORT, rezumat_sursa: 'editat', rezumat_de: '00000000-0000-4000-8000-000000000002',
      rezumat_la: '2026-11-10T15:00:00+00:00', updated_at: '2026-11-10T16:00:00+00:00' }
    const u = await monteaza({ raport: r })
    expect(u.q('eticheta').textContent).toContain('editat de NUME TEST')
    expect(u.q('veche')).not.toBe(null)
    await u.apasa('automat')
    expect(cereri[0].patch).toEqual({ rezumat_sursa: 'automat' })
  })
  it('raport vechi fără rezumat: „Generează” cere sursa automat', async () => {
    const u = await monteaza({ raport: { ...RAPORT, rezumat_text: null, rezumat_sursa: null, rezumat_la: null } })
    await u.apasa('genereaza')
    expect(cereri[0].patch).toEqual({ rezumat_sursa: 'automat' })
    expect(cereri[0].eq).toEqual([['id', 7], ['versiune_salvare', 3]])
  })
})
