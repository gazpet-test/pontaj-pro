// Audit D9 + Jakarinos #988 P2: un click pe fundal nu mai pierde un formular completat; după o salvare (cheieSalvare) sau cu `modificat` controlat
// de părinte, avertismentul nu mai e fals. Două niveluri:
//  (1) controlModal() — logica, fără DOM (rulează mereu);
//  (2) Modal montat real cu react-dom în jsdom: input / select / checkbox / fișier, confirm refuzat, mousedown în interior + mouseup pe fundal, reset.
//      jsdom nu e dependență a proiectului (nu instalăm pachete); se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suita (2) e SKIPPED.
import React, { useState } from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createRequire } from 'node:module'
import path from 'node:path'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => ({}) } }))

import { Modal, inchidePeFundal, controlModal, MESAJ_INCHIDE_MODAL } from './comune.jsx'

const fundal = { target: 'F', currentTarget: 'F' }, interior = { target: 'I', currentTarget: 'F' }

describe('Modal — închiderea pe fundal (logica)', () => {
  it('inchidePeFundal: neatins se închide fără întrebare; atins cere confirmare', () => {
    const onClose = vi.fn(), confirma = vi.fn(() => false)
    expect(inchidePeFundal({ atins: false, confirma, onClose })).toBe(true)
    expect(confirma).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1)
    expect(inchidePeFundal({ atins: true, confirma, onClose })).toBe(false)
    expect(confirma).toHaveBeenCalledWith(MESAJ_INCHIDE_MODAL); expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('controlModal: apăsare în interior + click pe fundal nu închide; schimbare → confirmare; cheie nouă → reset', () => {
    const c = controlModal(), onClose = vi.fn(), confirma = vi.fn(() => false)
    c.laApasare(interior); expect(c.laClick(fundal, { confirma, onClose })).toBe(false); expect(onClose).not.toHaveBeenCalled()
    c.laSchimbare(); expect(c.atins).toBe(true)
    c.laApasare(fundal); expect(c.laClick(fundal, { confirma, onClose })).toBe(false); expect(confirma).toHaveBeenCalledTimes(1)
    c.sincronizeazaCheie('salvat-1'); expect(c.atins).toBe(false)
    c.sincronizeazaCheie('salvat-1'); c.laSchimbare(); expect(c.atins).toBe(true)   // aceeași cheie nu resetează
    c.sincronizeazaCheie('salvat-2')
    c.laApasare(fundal); expect(c.laClick(fundal, { confirma, onClose })).toBe(true); expect(confirma).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('controlModal: `modificat` dat de părinte decide (false → fără confirmare chiar dacă atins; true → confirmare chiar neatins)', () => {
    const c = controlModal(), onClose = vi.fn(), confirma = vi.fn(() => false)
    c.laSchimbare()
    c.laApasare(fundal); expect(c.laClick(fundal, { modificat: false, confirma, onClose })).toBe(true); expect(confirma).not.toHaveBeenCalled()
    const d = controlModal()
    d.laApasare(fundal); expect(d.laClick(fundal, { modificat: true, confirma, onClose })).toBe(false); expect(confirma).toHaveBeenCalledTimes(1)
  })
  it('se randează cu titlul, conținutul și butonul ✕', () => {
    const html = renderToString(<Modal titlu="Titlu test" onClose={() => {}}><input defaultValue="x" /></Modal>)
    expect(html).toContain('Titlu test'); expect(html).toContain('✕'); expect(html).toContain('value="x"')
  })
})

// ── (2) DOM real ─────────────────────────────────────────────────────────────
let JSDOM = null
try {
  const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
  for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
} catch { JSDOM = null }

const dom = JSDOM ? describe : describe.skip
dom('Modal — montat în DOM (jsdom + react-dom)', () => {
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
    curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
    const w = j.window, d = w.document
    const fire = async (el, tip, Ctor = w.MouseEvent) => act(async () => { el.dispatchEvent(new Ctor(tip, { bubbles: true, cancelable: true })) })
    const clickFundal = async (start = d.querySelector('[data-modal-fundal]')) => {
      await fire(start, 'mousedown'); await fire(d.querySelector('[data-modal-fundal]'), 'click')
    }
    const scrie = async (el, v) => act(async () => {
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new w.Event('input', { bubbles: true }))
    })
    return { w, d, act, fire, clickFundal, scrie }
  }
  function Formular({ onClose, cheie }) {
    const [t, setT] = useState(''), [o, setO] = useState('a'), [b, setB] = useState(false)
    return <Modal titlu="F" onClose={onClose} cheieSalvare={cheie}>
      <input id="t" value={t} onChange={e => setT(e.target.value)} />
      <select id="s" value={o} onChange={e => setO(e.target.value)}><option value="a">a</option><option value="b">b</option></select>
      <input id="c" type="checkbox" checked={b} onChange={e => setB(e.target.checked)} />
      <input id="f" type="file" onChange={() => {}} />
    </Modal>
  }
  const cazuri = [
    ['input text', async (u) => u.scrie(u.d.getElementById('t'), 'abc')],
    ['select', async (u) => u.act(async () => { const s = u.d.getElementById('s'); s.value = 'b'; s.dispatchEvent(new u.w.Event('change', { bubbles: true })) })],
    ['checkbox', async (u) => u.fire(u.d.getElementById('c'), 'click')],
    ['fișier', async (u) => u.act(async () => { u.d.getElementById('f').dispatchEvent(new u.w.Event('change', { bubbles: true })) })],
  ]
  it('neatins: click pe fundal închide fără confirmare', async () => {
    const onClose = vi.fn(), u = await monteaza(<Formular onClose={onClose} />)
    u.w.confirm = vi.fn(() => false)
    await u.clickFundal()
    expect(u.w.confirm).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1)
  })
  for (const [nume, schimba] of cazuri) {
    it(`${nume}: marchează atins → confirm refuzat păstrează fereastra, confirm acceptat o închide`, async () => {
      const onClose = vi.fn(), u = await monteaza(<Formular onClose={onClose} />)
      u.w.confirm = vi.fn(() => false)
      await schimba(u)
      await u.clickFundal()
      expect(u.w.confirm).toHaveBeenCalledWith(MESAJ_INCHIDE_MODAL); expect(onClose).not.toHaveBeenCalled()
      u.w.confirm = vi.fn(() => true)
      await u.clickFundal()
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  }
  it('mousedown în interior + click pe fundal (selecție trasă afară) nu închide', async () => {
    const onClose = vi.fn(), u = await monteaza(<Formular onClose={onClose} />)
    u.w.confirm = vi.fn(() => true)
    await u.clickFundal(u.d.getElementById('t'))
    expect(onClose).not.toHaveBeenCalled(); expect(u.w.confirm).not.toHaveBeenCalled()
  })
  it('după reset (cheieSalvare nouă) fundalul închide fără confirmare', async () => {
    const onClose = vi.fn()
    let setCheie
    function Gazda() { const [k, sk] = useState(1); setCheie = sk; return <Formular onClose={onClose} cheie={k} /> }
    const u = await monteaza(<Gazda />)
    await u.scrie(u.d.getElementById('t'), 'abc')
    await u.act(async () => { setCheie(2) })   // „Salvează” reușit cu modalul deschis
    u.w.confirm = vi.fn(() => false)
    await u.clickFundal()
    expect(u.w.confirm).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('`modificat={false}` controlat de părinte: fără confirmare chiar după schimbări', async () => {
    const onClose = vi.fn()
    function G() { const [t, setT] = useState(''); return <Modal titlu="G" onClose={onClose} modificat={false}><input id="t" value={t} onChange={e => setT(e.target.value)} /></Modal> }
    const u = await monteaza(<G />)
    await u.scrie(u.d.getElementById('t'), 'x')
    u.w.confirm = vi.fn(() => false)
    await u.clickFundal()
    expect(u.w.confirm).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1)
  })
})
