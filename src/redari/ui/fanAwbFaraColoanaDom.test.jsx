// Runda 3 pe PR #1135 (verdictul Jakarinos pe f4d1fd46, P2 „ordinea publicare / migrare”): ecranul „AWB FAN” montat REAL (react-dom în jsdom) pe o
// bază FĂRĂ coloana `red_fan_loturi.opod` (migrarea 20261227a neaplicată, codul publicat înainte): „1. Propune”, „2c. Aprobă” și „3. Generează AWB”
// sunt dezactivate cu motivul lor (MESAJ_OPOD_NEINSTALAT_PASI), bifa oPOD e dezactivată „neinstalată”, iar marcajul TEST și „Lista de evenimente FAN”
// (acțiuni fără rezultate noi) rămân active. Cu coloana instalată (opod = false), „1. Propune 1 plicuri” devine activ. Clientul Supabase e simulat:
// PostgREST răspunde 42703 la orice select care cere `opod` cât coloana lipsește (ca pe o bază reală, și când lotul n-are rând).
// jsdom nu e dependență a proiectului (ca în notificariDom.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR; fără el suita e SĂRITĂ vizibil.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const { stare, LOT_ID } = vi.hoisted(() => ({ stare: { cuColoana: false, cereri: [] }, LOT_ID: '11111111-2222-4333-8444-555555555555' }))
// client fals: fiecare tabel întoarce rândurile lui la prima pagină și [] la pagina următoare (.gt = keyset); red_fan_loturi: 42703 când se cere `opod` fără coloană
vi.mock('../../lib/supabase.js', () => {
  const RANDURI = {
    red_convocari: [{ id: 'c1', plic_id: 'pl1', detinator_id: 'd1' }],
    red_detinatori_contact: [{ detinator_id: 'd1', telefon: '0700000001', adresa_strada: 'Str. Fictivă 1', adresa_sat: 'Sat Fictiv', adresa_comuna: null, adresa_judet: 'Prahova', cod_postal: null }],
    red_fan_awb: [],
  }
  const randLot = () => ({ lot_id: LOT_ID, test: true, prima_aprobare_la: null, tiraj_cheie: null, tiraj_nr: 0, tiraj_la: null, tiraj_oprit_la: null, ...(stare.cuColoana ? { opod: false } : {}) })
  const builder = tabel => {
    const st = { filtre: [], cols: '' }
    const b = new Proxy({}, { get: (_, k) => {
      if (k === 'then') {
        const pagUrm = st.filtre.includes('gt')
        return res => res({ data: pagUrm ? [] : (RANDURI[tabel] || []), error: null })
      }
      if (k === 'maybeSingle') return async () => {
        if (tabel === 'red_fan_setari') return { data: { limita_lot: 20 }, error: null }
        if (tabel === 'red_fan_loturi') {
          stare.cereri.push(st.cols)
          if (!stare.cuColoana && /\bopod\b/.test(st.cols)) return { data: null, error: { code: '42703', message: 'column red_fan_loturi.opod does not exist' } }
          return { data: randLot(), error: null }
        }
        return { data: null, error: null }
      }
      return (...a) => { st.filtre.push(k); if (k === 'select') st.cols = a[0] || ''; return b }
    } })
    return b
  }
  return { supabase: { from: t => builder(t), rpc: () => { throw new Error('fără RPC în test') }, functions: { invoke: () => { throw new Error('fără funcție edge în test') } } } }
})

import FanAwbPrevizualizare from './FanAwbPrevizualizare.jsx'
import { MESAJ_OPOD_NEINSTALAT_PASI, MESAJ_OPOD_NEINSTALAT, TEXT_OPOD } from '../fanLot.js'

let JSDOM = null
for (const s of [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)) {
  try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ }
}
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[fanAwbFaraColoanaDom.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = [] })

dom(JSDOM ? 'AWB FAN montat fără coloana opod (jsdom)' : `AWB FAN DOM — ${MOTIV_SARIT}`, () => {
  async function monteaza(cuColoana) {
    stare.cuColoana = cuColoana; stare.cereri = []
    const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
    const vechi = { window: globalThis.window, document: globalThis.document }
    Object.assign(globalThis, { window: j.window, document: j.window.document })
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const root = createRoot(j.window.document.getElementById('r'))
    curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
    const plicuri = [{ id: 'pl1', nr_plic: 'PL-TST-0001', destinatar_nume: 'PERSOANA FICTIVA', stare: 'activ' }]
    await act(async () => { root.render(<FanAwbPrevizualizare proiect={{ id: 'P', cod: 'TEST-RAZVAN' }} lot={{ id: LOT_ID, nr_lot: 'PP-0001' }} plicuri={plicuri} esteOwner poateScrie onClose={() => {}} />) })
    // citirile sunt asincrone (paginare + lot + setări): se așteaptă până apare rândul plicului
    const d = j.window.document
    for (let i = 0; i < 40 && !/gata pentru FAN/.test(d.body.textContent); i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(d.body.textContent).toMatch(/1 din 1 plicuri au toate datele cerute de FAN/)
    const buton = inceput => { const b = [...d.querySelectorAll('button')].find(x => x.textContent.startsWith(inceput)); expect(b, inceput).toBeTruthy(); return b }
    // (bifa se caută pe atributul citit, nu printr-un selector CSS cu textul: parantezele / „+” din etichetă nu trec prin parserul de selectori al jsdom)
    const bifaOpod = () => { const b = [...d.querySelectorAll('input[type="checkbox"]')].find(x => x.getAttribute('aria-label') === TEXT_OPOD); expect(b, 'bifa oPOD').toBeTruthy(); return b }
    return { d, buton, bifaOpod }
  }
  it('FĂRĂ coloană: „1. Propune” / „2c. Aprobă” / „3. Generează AWB” dezactivate cu motivul coloanei; bifa oPOD dezactivată „neinstalată”; marcajul și lista de evenimente active', async () => {
    const { d, buton, bifaOpod } = await monteaza(false)
    // PostgREST a fost întrebat cu `opod` și apoi fără (recitirea comună): coloana lipsă e confirmată de citire, nu presupusă
    expect(stare.cereri.some(c => /\bopod\b/.test(c)) && stare.cereri.some(c => !/\bopod\b/.test(c))).toBe(true)
    for (const [inceput, motiv] of [['1. Propune 1 plicuri', MESAJ_OPOD_NEINSTALAT_PASI], ['2c. Aprobă', MESAJ_OPOD_NEINSTALAT_PASI], ['3. Generează AWB', MESAJ_OPOD_NEINSTALAT_PASI]]) {
      const b = buton(inceput)
      expect([inceput, b.disabled]).toEqual([inceput, true])
      expect([inceput, b.title]).toEqual([inceput, expect.stringContaining(motiv)])
    }
    // cardurile pașilor arată același motiv (vizibil, nu doar în tooltip)
    expect(d.body.textContent.split(MESAJ_OPOD_NEINSTALAT_PASI).length - 1).toBeGreaterThanOrEqual(3)
    const bifa = bifaOpod()
    expect(bifa.disabled).toBe(true); expect(bifa.checked).toBe(false)
    expect(bifa.closest('label').title).toContain(MESAJ_OPOD_NEINSTALAT)
    // acțiunile fără rezultate noi rămân ale owner-ului: marcajul TEST (lot marcat TEST, neaprobat) și lista de evenimente
    expect(buton('2a. Marchează TEST').disabled).toBe(false)
    expect(buton('Lista de evenimente FAN').disabled).toBe(false)
    expect(buton('2b. Marchează real').disabled).toBe(true)   // Testul 1: oprit de garda „doar TEST”, ca înainte
  })
  it('CU coloana instalată (opod = false): „1. Propune 1 plicuri” activ; aprobarea / generarea așteaptă propunerea, nu coloana', async () => {
    const { d, buton, bifaOpod } = await monteaza(true)
    expect(stare.cereri.every(c => /\bopod\b/.test(c))).toBe(true)   // o singură citire, cu coloana
    expect(buton('1. Propune 1 plicuri').disabled).toBe(false)
    expect(buton('2c. Aprobă').disabled).toBe(true); expect(buton('2c. Aprobă').title).toContain('niciun plic propus')
    expect(buton('3. Generează AWB').disabled).toBe(true); expect(buton('3. Generează AWB').title).toContain('niciun plic aprobat')
    expect(d.body.textContent).not.toContain(MESAJ_OPOD_NEINSTALAT_PASI)
    const bifa = bifaOpod()
    expect(bifa.disabled).toBe(false); expect(bifa.checked).toBe(false)   // owner, lot marcat, neaprobat: alegerea e deschisă, implicit fără oPOD
  })
})
