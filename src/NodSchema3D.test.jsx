// Eliberarea resurselor scenei 3D (review r2): Three.js REAL (geometrii, materiale, scenă), dar renderer și OrbitControls FALSE
// (jsdom nu are WebGL), ca să vedem ce se eliberează: la ieșire normală ȘI când construcția pică la jumătate (renderer.setSize aruncă,
// după ce controalele, ascultătorii și ResizeObserver-ul sunt deja create). jsdom nu e dependență: se caută în node_modules sau în
// REDARI_JSDOM_DIR (tiparul din NodCuplareSchema.test.jsx); fără el, suita e SĂRITĂ VIZIBIL.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as THREE_REAL from './nodSchema3dThree.js'
import { construiesteScena } from './NodSchema3D.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[NodSchema3D.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

const GRUP = {
  id: 'rez', titlu: 'Test', prefixe: ['CR'], terenZ: 0,
  elemente: [
    { tip: 'teava', a: [0, 0, 0], b: [1000, 0, 0], dn: 250, cert: 'desen' },
    { tip: 'cot', a: [1000, 0, 0], c: [1381, 0, 0], b: [1381, 0, 381], dn: 250, cert: 'desen' },
    { tip: 'robinet', a: [1381, 0, 500], b: [1381, 0, 1068], dn: 250, et: 'RAM 10', cert: 'estimat' },
    { tip: 'rezervor', a: [-2450, 0, 1516], b: [2450, 0, 1516], d: 1200, cert: 'desen' },
  ],
  suduri: [{ cod: 'CR-001', p: [1000, 0, 0], cert: 'desen' }],
  faraPozitie: [],
}

let vechi = null
afterEach(() => { if (vechi) Object.assign(globalThis, vechi); vechi = null; vi.restoreAllMocks() })

function mediu({ picaLaSetSize = false } = {}) {
  const j = new JSDOM('<!doctype html><div id="g"></div>', { pretendToBeVisual: true })
  vechi = { window: globalThis.window, document: globalThis.document, ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame }
  const observatoare = []
  class RO { constructor(cb) { this.cb = cb; this.observa = 0; this.deconectat = 0; observatoare.push(this) } observe() { this.observa++ } disconnect() { this.deconectat++ } }
  Object.assign(globalThis, { window: j.window, document: j.window.document, ResizeObserver: RO,
    requestAnimationFrame: cb => setTimeout(cb, 0), cancelAnimationFrame: id => clearTimeout(id) })
  const d = j.window.document
  const randere = []
  class RendererFals {
    constructor() {
      this.domElement = d.createElement('canvas')
      this.dispose = vi.fn(); this.forceContextLoss = vi.fn(); this.render = vi.fn()
      randere.push(this)
    }
    getContext() { return {} }
    setPixelRatio() {}
    setClearColor() {}
    setSize() { if (picaLaSetSize) throw new Error('setSize a picat (test)') }
  }
  const controale = []
  class ControaleFalse {
    constructor(camera, el) {
      this.target = new THREE_REAL.Vector3(); this.el = el; this.asc = new Map(); this.dispose = vi.fn()
      controale.push(this)
    }
    addEventListener(t, f) { this.asc.set(t, (this.asc.get(t) || 0) + 1) }
    removeEventListener(t) { this.asc.set(t, (this.asc.get(t) || 0) - 1) }
    update() {}
  }
  const THREE = { ...THREE_REAL, WebGLRenderer: RendererFals }
  const gazda = d.getElementById('g')
  // ascultătorii de pe canvas: se numără adăugările și scoaterile (controalele false nu pun ascultători, deci sunt doar ai scenei)
  const contor = { add: 0, rem: 0 }
  const origAdd = j.window.HTMLCanvasElement.prototype.addEventListener
  const origRem = j.window.HTMLCanvasElement.prototype.removeEventListener
  j.window.HTMLCanvasElement.prototype.addEventListener = function (t, f, o) { if (t.startsWith('pointer')) contor.add++; return origAdd.call(this, t, f, o) }
  j.window.HTMLCanvasElement.prototype.removeEventListener = function (t, f, o) { if (t.startsWith('pointer')) contor.rem++; return origRem.call(this, t, f, o) }
  return { THREE, ControaleFalse, gazda, randere, controale, observatoare, contor }
}

dom(JSDOM ? 'NodSchema3D — eliberarea resurselor (jsdom + Three.js real)' : `NodSchema3D — eliberarea resurselor — ${MOTIV_SARIT}`, () => {
  it('ieșire normală: dispose eliberează rendererul, canvas-ul, controalele, ascultătorii, observatorul', async () => {
    const m = mediu()
    const s = construiesteScena(m.THREE, m.ControaleFalse, m.gazda, GRUP, () => {})
    expect(m.gazda.querySelectorAll('canvas')).toHaveLength(1)
    expect(m.observatoare[0].observa).toBe(1)
    s.aplicaPuncte([{ cheie: '3d:CR-001', p: [1000, 0, 0], cert: 'desen', puncte: [{ sudura: { id: 1, stare: 'sudat', dn: 250 } }] }], null)
    s.dispose()
    expect(m.randere[0].dispose).toHaveBeenCalledTimes(1)
    expect(m.randere[0].forceContextLoss).toHaveBeenCalledTimes(1)
    expect(m.gazda.querySelectorAll('canvas')).toHaveLength(0)
    expect(m.controale[0].dispose).toHaveBeenCalledTimes(1)
    expect(m.controale[0].asc.get('change')).toBe(0)
    expect(m.observatoare[0].deconectat).toBe(1)
    expect(m.contor.add).toBe(4)
    expect(m.contor.rem).toBe(4)
  })

  it('review r2: construcția pică la renderer.setSize (după controale / ascultători / observator) = tot ce s-a creat se eliberează', () => {
    const m = mediu({ picaLaSetSize: true })
    expect(() => construiesteScena(m.THREE, m.ControaleFalse, m.gazda, GRUP, () => {})).toThrow('setSize a picat (test)')
    expect(m.observatoare).toHaveLength(1)
    expect(m.observatoare[0].deconectat).toBe(1)                // observatorul nu mai ține scena căzută
    expect(m.controale[0].dispose).toHaveBeenCalledTimes(1)
    expect(m.controale[0].asc.get('change')).toBe(0)
    expect(m.contor.add).toBe(4)
    expect(m.contor.rem).toBe(4)                                 // cei patru ascultători ai scenei sunt scoși
    expect(m.randere[0].dispose).toHaveBeenCalledTimes(1)
    expect(m.randere[0].forceContextLoss).toHaveBeenCalledTimes(1)
    expect(m.gazda.querySelectorAll('canvas')).toHaveLength(0)
  })
})
