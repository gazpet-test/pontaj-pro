// Regresie (armături, 16.11.2026): modelele în formatul de dinainte trebuie să se citească și să se DESENEZE exact ca înainte.
// Referința (nodSchema3d.regresie.json) a fost calculată cu codul de dinainte de armături (origin/main 66b3b867), pe două modele:
// exemplul din documentație (toate tipurile vechi, două grupuri amplasate, unul la 30°) și o fundație în formatul vechi
// (410 elemente: barele ca țevi, îndoirile ca coturi; două grupuri amplasate). Aici se recalculează cu codul curent și se compară:
// citirea, „Toată instalația”, cutiile, amplasarea și scena (fiecare obiect, geometrie, material, camera după încadrare).
// Partea de scenă cere jsdom (nu e dependență; tiparul din NodSchema3D.test.jsx): fără el e SĂRITĂ VIZIBIL.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as THREE_REAL from 'three'
import * as THREE_SCENA from './nodSchema3dThree.js'
import { construiesteScena } from './NodSchema3D.jsx'
import { parseModel3d, instalatia, cutieGrup, aplicaAmplasare } from './nodSchema3dLogica.js'
import { sha, amprentaScena } from './nodSchema3dAmprenta.testutil.js'
import REF from './nodSchema3d.regresie.json'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[nodSchema3dRegresie.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

// mediul scenei: Three.js real, renderer și controale false (jsdom nu are WebGL); identic cu cel care a calculat referința
function mediu() {
  const j = new JSDOM('<!doctype html><div id="g"></div>', { pretendToBeVisual: true })
  Object.assign(globalThis, { window: j.window, document: j.window.document, ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: cb => setTimeout(cb, 0), cancelAnimationFrame: id => clearTimeout(id) })
  const d = j.window.document
  class RendererFals { constructor() { this.domElement = d.createElement('canvas') } getContext() { return {} } setPixelRatio() {} setClearColor() {} setSize() {} render() {} dispose() {} forceContextLoss() {} }
  const controale = []
  class Controale {
    constructor(camera) { this.camera = camera; this.target = new THREE_REAL.Vector3(); controale.push(this) }
    addEventListener() {} removeEventListener() {} dispose() {} update() { this.camera.lookAt(this.target) }
  }
  j.window.HTMLCanvasElement.prototype.getContext = function (t) {
    return t === '2d' ? { font: '', fillStyle: '', textBaseline: '', measureText: s => ({ width: String(s).length * 20 }), fillRect() {}, fillText() {} } : null
  }
  const gazda = d.getElementById('g')
  Object.defineProperty(gazda, 'clientWidth', { value: 800 }); Object.defineProperty(gazda, 'clientHeight', { value: 600 })
  const scene = [], camere = []
  const THREE = { ...THREE_SCENA, WebGLRenderer: RendererFals,
    Scene: class extends THREE_REAL.Scene { constructor() { super(); scene.push(this) } },
    PerspectiveCamera: class extends THREE_REAL.PerspectiveCamera { constructor(...a) { super(...a); camere.push(this) } } }
  return { THREE, Controale, gazda, scene, camere, controale }
}
function amprentaGrup(grup) {
  const m = mediu()
  const s = construiesteScena(m.THREE, m.Controale, m.gazda, grup, () => {})
  const a = amprentaScena(m.scene[0], m.camere[0], m.controale[0].target)
  s.dispose()
  return a
}

describe('regresie: modelele vechi se citesc la fel (referința = codul de dinainte de armături)', () => {
  for (const [k, model] of Object.entries(REF.intrari)) {
    it(`${k}: citirea, „Toată instalația”, cutiile și amplasarea au aceleași amprente`, () => {
      const ref = REF.amprente[k]
      const p = parseModel3d(structuredClone(model))
      expect(p.erori).toHaveLength(ref.erori)
      expect(p.grupuri).toHaveLength(ref.grupuri)
      expect(p.grupuri.some(g => 'armare' in g)).toBe(false)          // grupurile vechi nu primesc câmpuri noi
      expect(sha(p)).toBe(ref.parse)
      const inst = instalatia(p)
      expect(inst ? sha(inst) : null).toBe(ref.instalatie)
      expect(p.grupuri.map(g => sha(cutieGrup(g)))).toEqual(ref.cutii)
      expect(p.grupuri.map(g => sha(aplicaAmplasare(g)))).toEqual(ref.amplasate)
    })
  }
})

dom(JSDOM ? 'regresie: modelele vechi se desenează la fel (jsdom + Three.js real)' : `regresie: scena modelelor vechi — ${MOTIV_SARIT}`, () => {
  for (const [k, model] of Object.entries(REF.intrari)) {
    it(`${k}: fiecare scenă (pe grup și „Toată instalația”) are aceeași amprentă și aceeași cameră`, () => {
      const p = parseModel3d(structuredClone(model))
      const inst = instalatia(p)
      const acum = [...p.grupuri.map(amprentaGrup), ...(inst ? [amprentaGrup(inst)] : [])]
      expect(acum).toEqual(REF.amprente[k].scene)
    })
  }
})
