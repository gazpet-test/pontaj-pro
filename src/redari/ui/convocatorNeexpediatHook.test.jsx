// Copilot #991 r4 P2-03: useConvocariNeexpediate montat real (react-dom) sub <React.StrictMode> (setup → cleanup → setup).
// jsdom nu e dependență a proiectului (ca la comuneModal.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR.
// Fără el, suita e SĂRITĂ VIZIBIL (mesaj în output + în numele suitei).
import React, { StrictMode, useState } from 'react'
import { afterEach, describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { useConvocariNeexpediate } from '../convocatorNeexpediat.js'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[convocatorNeexpediatHook.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => JSDOM ? t : `${t} — ${MOTIV_SARIT}`

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = [] })
async function monteaza(element) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react-dom/test-utils')
  const root = createRoot(j.window.document.getElementById('r'))
  await act(async () => { root.render(element) })
  let montat = true
  const demonteaza = () => { if (montat) { montat = false; act(() => root.unmount()) } }
  curata.push(() => { demonteaza(); Object.assign(globalThis, vechi) })
  return { d: j.window.document, act, demonteaza }
}

// citire controlată: fiecare apel se rezolvă manual
const citireManuala = () => {
  const apeluri = []
  const citeste = (det) => new Promise((res, rej) => apeluri.push({ det, res, rej }))
  return { apeluri, citeste }
}

function Sonda({ det, citeste, laCitire, expune }) {
  const r = useConvocariNeexpediate(det, citeste, { laCitire })
  expune?.(r)
  return <div id="s">{r.eroare ? `eroare:${r.eroare.message}` : r.existente === null ? 'se-citeste' : `lista:${r.existente.map(c => c.nr_document).join(',')}`}</div>
}

dom(numeDom('useConvocariNeexpediate — React.StrictMode (jsdom + react-dom)'), () => {
  it('sub StrictMode nu rămâne blocat la „se citește”: ultima citire (setup-ul al doilea) se aplică', async () => {
    const { apeluri, citeste } = citireManuala()
    const u = await monteaza(<StrictMode><Sonda det="d1" citeste={citeste} /></StrictMode>)
    expect(apeluri.length).toBeGreaterThanOrEqual(2)   // StrictMode: setup → cleanup → setup
    expect(u.d.getElementById('s').textContent).toBe('se-citeste')
    // răspunsurile în ordine inversă: cel mai nou primul, apoi cele vechi (ale setup-urilor invalidate) — ignorate
    await u.act(async () => { apeluri.at(-1).res([{ id: '1', nr_document: 'C-0002' }]) })
    for (const a of apeluri.slice(0, -1)) await u.act(async () => { a.res([]) })
    expect(u.d.getElementById('s').textContent).toBe('lista:C-0002')
  })

  it('reciteste după setup-ul StrictMode merge (cititorul curent nu e cel închis la cleanup)', async () => {
    const { apeluri, citeste } = citireManuala()
    let api
    const u = await monteaza(<StrictMode><Sonda det="d1" citeste={citeste} expune={r => { api = r }} /></StrictMode>)
    await u.act(async () => { apeluri.at(-1).res([]) })
    expect(u.d.getElementById('s').textContent).toBe('lista:')
    const inainte = apeluri.length
    await u.act(async () => { api.reciteste() })
    expect(apeluri.length).toBe(inainte + 1)
    expect(u.d.getElementById('s').textContent).toBe('se-citeste')
    await u.act(async () => { apeluri.at(-1).res([{ id: '9', nr_document: 'C-0009' }]) })
    expect(u.d.getElementById('s').textContent).toBe('lista:C-0009')
  })

  it('schimbarea deținătorului: rezultatul vechi (d1) nu se aplică pentru d2; eroarea curentă se arată', async () => {
    const { apeluri, citeste } = citireManuala()
    let schimba
    function Gazda() { const [det, setDet] = useState('d1'); schimba = setDet; return <Sonda det={det} citeste={citeste} /> }
    const u = await monteaza(<Gazda />)
    const vechi = apeluri.at(-1)
    await u.act(async () => { schimba('d2') })
    await u.act(async () => { vechi.res([{ id: '1', nr_document: 'C-0001' }]) })
    expect(u.d.getElementById('s').textContent).toBe('se-citeste')
    await u.act(async () => { apeluri.at(-1).rej(new Error('rețea')) })
    expect(apeluri.at(-1).det).toBe('d2')
    expect(u.d.getElementById('s').textContent).toBe('eroare:rețea')
  })

  it('după demontare: reciteste nu mai citește, iar răspunsul întârziat nu mai e aplicat', async () => {
    const { apeluri, citeste } = citireManuala()
    let api, aplicariDupa = 0
    const u = await monteaza(<Sonda det="d1" citeste={citeste} expune={r => { api = r }} laCitire={() => { aplicariDupa++ }} />)
    const intarziat = apeluri.at(-1)
    u.demonteaza()
    const n = apeluri.length, a = aplicariDupa
    await api.reciteste()
    intarziat.res([{ id: '1', nr_document: 'C-0001' }])
    await Promise.resolve()
    expect(apeluri.length).toBe(n)
    expect(aplicariDupa).toBe(a)
  })
})
