// Mediul DOM minim al scenei 3D în teste (review r2 pe armături, 16.11.2026): fără jsdom, deci testele scenei RULEAZĂ peste tot
// (local și în CI), nu mai sunt sărite când lipsește jsdom (care nu e dependență a proiectului).
// Scena folosește din DOM doar: window.devicePixelRatio, document.createElement('canvas') (pânza etichetelor, cu context 2D),
// canvas.style / appendChild / remove / addEventListener / removeEventListener / getBoundingClientRect, gazda.clientWidth / clientHeight,
// ResizeObserver, requestAnimationFrame / cancelAnimationFrame. Rendererul și controalele sunt false (nu există WebGL în Node).
// Contextul 2D fals măsoară textul la 20 px pe caracter (la fel ca în mediul cu care s-au calculat amprentele de referință).
import * as THREE_REAL from 'three'
import * as THREE_SCENA from './nodSchema3dThree.js'

/** Un element DOM fals: copii, stil, ascultători numărați (doar cei `pointer*`, adică ai scenei), context 2D fals pe canvas. */
function elementFals(tag, contor) {
  const el = {
    tagName: String(tag).toUpperCase(), style: {}, parentNode: null, childNodes: [], width: 300, height: 150, clientWidth: 0, clientHeight: 0,
    appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = el; el.childNodes.push(c); return c },
    remove() { const p = el.parentNode; if (p) { p.childNodes = p.childNodes.filter(x => x !== el); el.parentNode = null } },
    addEventListener(t) { if (String(t).startsWith('pointer')) contor.add++ },
    removeEventListener(t) { if (String(t).startsWith('pointer')) contor.rem++ },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }),
    getContext: t => (t === '2d' && el.tagName === 'CANVAS'
      ? { font: '', fillStyle: '', textBaseline: '', measureText: s => ({ width: String(s).length * 20 }), fillRect() {}, fillText() {} }
      : null),
    /** Doar selectorul pe nume de tag (ex. 'canvas'), în toți descendenții. */
    querySelectorAll(sel) {
      const out = [], T = String(sel).toUpperCase()
      const umbla = n => { for (const c of n.childNodes) { if (c.tagName === T) out.push(c); umbla(c) } }
      umbla(el)
      return out
    },
  }
  return el
}

/**
 * Pune globalele DOM false (window, document, ResizeObserver, requestAnimationFrame) și întoarce { gazda, contor, refa }.
 * `refa()` pune înapoi globalele de dinainte. `ResizeObserver` poate fi înlocuit (ex. ca testul să numere observatoarele).
 */
export function instaleazaDomFals({ latime = 0, inaltime = 0, ResizeObserver } = {}) {
  const contor = { add: 0, rem: 0 }
  const chei = ['window', 'document', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame']
  const vechi = Object.fromEntries(chei.map(k => [k, globalThis[k]]))
  const document = { createElement: tag => elementFals(tag, contor) }
  Object.assign(globalThis, {
    window: { devicePixelRatio: 1, document }, document,
    ResizeObserver: ResizeObserver || class { observe() {} disconnect() {} },
    requestAnimationFrame: cb => setTimeout(cb, 0), cancelAnimationFrame: id => clearTimeout(id),
  })
  const gazda = document.createElement('div')
  gazda.clientWidth = latime; gazda.clientHeight = inaltime
  return { gazda, contor, refa: () => Object.assign(globalThis, vechi) }
}

/**
 * Mediul complet al unei scene: Three.js REAL (geometrii, materiale), renderer fals, controale false care îndreaptă camera spre țintă
 * (ca OrbitControls.update); scenele și camerele create se adună în liste (pentru amprente și verificări).
 */
export function mediuScena(opt = {}) {
  const dom = instaleazaDomFals(opt)
  class RendererFals {
    constructor() { this.domElement = globalThis.document.createElement('canvas') }
    getContext() { return {} } setPixelRatio() {} setClearColor() {} setSize() {} render() {} dispose() {} forceContextLoss() {}
  }
  const controale = []
  class Controale {
    constructor(camera) { this.camera = camera; this.target = new THREE_REAL.Vector3(); controale.push(this) }
    addEventListener() {} removeEventListener() {} dispose() {} update() { this.camera.lookAt(this.target) }
  }
  const scene = [], camere = []
  const THREE = { ...THREE_SCENA, WebGLRenderer: RendererFals,
    Scene: class extends THREE_REAL.Scene { constructor() { super(); scene.push(this) } },
    PerspectiveCamera: class extends THREE_REAL.PerspectiveCamera { constructor(...a) { super(...a); camere.push(this) } } }
  return { THREE, Controale, gazda: dom.gazda, contor: dom.contor, refa: dom.refa, scene, camere, controale }
}
