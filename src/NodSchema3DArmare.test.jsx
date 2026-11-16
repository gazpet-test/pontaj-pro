// Scena 3D cu armături (16.11.2026): Three.js REAL (geometrii, materiale), renderer și controale false (jsdom nu are WebGL).
// Pe modelul fundației F6: sub-grupurile pe marcă / beton / piese înglobate, ascunderea, culoarea pe marcă sau pe diametru,
// diametrul real al barelor (acoperirea de 50 mm la fundul blocului iese din geometria desenată) și eliberarea resurselor.
// jsdom nu e dependență: se caută în node_modules sau în REDARI_JSDOM_DIR; fără el, suita e SĂRITĂ VIZIBIL.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as THREE_REAL from 'three'
import * as THREE_SCENA from './nodSchema3dThree.js'
import { construiesteScena } from './NodSchema3D.jsx'
import { parseModel3d } from './nodSchema3dLogica.js'
import { culoareDiametru, CULORI_MARCA } from './nodSchema3dArmare.js'
import F6 from './nodSchema3d.fundatie-F6.json'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[NodSchema3DArmare.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

function mediu() {
  const j = new JSDOM('<!doctype html><div id="g"></div>', { pretendToBeVisual: true })
  Object.assign(globalThis, { window: j.window, document: j.window.document, ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: cb => setTimeout(cb, 0), cancelAnimationFrame: id => clearTimeout(id) })
  const d = j.window.document
  class RendererFals { constructor() { this.domElement = d.createElement('canvas') } getContext() { return {} } setPixelRatio() {} setClearColor() {} setSize() {} render() {} dispose() {} forceContextLoss() {} }
  class Controale {
    constructor(camera) { this.camera = camera; this.target = new THREE_REAL.Vector3() }
    addEventListener() {} removeEventListener() {} dispose() {} update() { this.camera.lookAt(this.target) }
  }
  j.window.HTMLCanvasElement.prototype.getContext = function (t) {
    return t === '2d' ? { font: '', fillStyle: '', textBaseline: '', measureText: s => ({ width: String(s).length * 20 }), fillRect() {}, fillText() {} } : null
  }
  const gazda = d.getElementById('g')
  const scene = []
  const THREE = { ...THREE_SCENA, WebGLRenderer: RendererFals, Scene: class extends THREE_REAL.Scene { constructor() { super(); scene.push(this) } } }
  return { THREE, Controale, gazda, scene }
}
// partea = grupul al cărui prim copil e grupul etichetelor; sub-grupurile ei se găsesc după nume (marca:1, beton, inglobate…)
const parteDin = scena => scena.children.find(o => o.isGroup && o.children[0]?.isGroup)
const cutie = o => new THREE_REAL.Box3().setFromObject(o)

dom(JSDOM ? 'NodSchema3D — armături (jsdom + Three.js real)' : `NodSchema3D — armături — ${MOTIV_SARIT}`, () => {
  const construieste = () => {
    const m = mediu()
    const grup = parseModel3d(structuredClone(F6)).grupuri[0]
    const s = construiesteScena(m.THREE, m.Controale, m.gazda, grup, () => {})
    const parte = parteDin(m.scene[0])
    const [m1, m2, m3, beton, piese] = ['marca:1', 'marca:2', 'marca:3', 'beton', 'inglobate'].map(n => parte.children.find(o => o.name === n))
    return { s, scena: m.scene[0], parte, m1, m2, m3, beton, piese }
  }

  it('sub-grupuri separate: o marcă = un grup (barele lipite într-o plasă); betonul cu muchii; piesele înglobate separat', () => {
    const { s, parte, m1, m2, m3, beton, piese } = construieste()
    expect(parte.children).toHaveLength(6)
    for (const g of [m1, m2, m3]) { expect(g.children).toHaveLength(1); expect(g.children[0].isMesh).toBe(true) }
    expect(beton.children.filter(o => o.isLineSegments)).toHaveLength(6)   // muchiile celor 6 cutii
    expect(beton.children.filter(o => o.isMesh)).toHaveLength(1)           // cutiile lipite (același material)
    expect(beton.children.find(o => o.isMesh).material.transparent).toBe(true)
    expect(piese.children.filter(o => o.isMesh)).toHaveLength(2)           // buloanele (o plasă) + plăcile (alta)
    for (const o of piese.children) expect(o.material.opacity).toBeLessThan(1) // poziție estimată = mai deschis
    s.dispose()
  })

  it('diametrul real: fundul barelor Ø14 la −1,000 (acoperire 50 mm peste −1,05); etrierii Ø8 încep la −0,154', () => {
    const { s, m1, m3 } = construieste()
    expect(cutie(m1).min.y).toBeCloseTo(-1.0, 3)                          // ax la −993 mm, rază 7 mm
    expect(cutie(m3).min.y).toBeCloseTo(-0.154, 3)                        // ax la −150 mm, rază 4 mm
    // vârful mustăților: fundul barei −1,000 + piciorul de 1350 (pe exterior), setul Y așezat peste setul X (+14) = +0,364
    expect(cutie(m1).max.y).toBeCloseTo(0.364, 3)
    s.dispose()
  })

  it('ascunderea pe marcă, a betonului și a pieselor; culoarea pe diametru și înapoi pe marcă', () => {
    const { s, m1, m2, m3, beton, piese } = construieste()
    s.armare({ ascunseMarci: new Set(['2']), beton: false, inglobate: false, culoare: 'marca' })
    expect([m1.visible, m2.visible, m3.visible, beton.visible, piese.visible]).toEqual([true, false, true, false, false])
    s.armare({ ascunseMarci: new Set(), culoare: 'diametru' })
    expect([m2.visible, beton.visible, piese.visible]).toEqual([true, true, true])
    const hex = o => '#' + o.children[0].material.color.getHexString().toUpperCase()
    expect([hex(m1), hex(m2), hex(m3)]).toEqual([culoareDiametru(14), culoareDiametru(14), culoareDiametru(8)].map(c => c.toUpperCase()))
    s.armare({ culoare: 'marca' })
    expect([hex(m1), hex(m2), hex(m3)]).toEqual(CULORI_MARCA.slice(0, 3).map(c => c.toUpperCase()))
    s.dispose()
  })

  it('la ieșire se eliberează fiecare geometrie și fiecare material (bare, beton, muchii, piese)', () => {
    const { s, scena } = construieste()
    const geometrii = new Set(), materiale = new Set()
    scena.traverse(o => { if (o.geometry) geometrii.add(o.geometry); if (o.material) materiale.add(o.material) })
    const eliberate = new Set()
    for (const x of [...geometrii, ...materiale]) x.addEventListener('dispose', () => { eliberate.add(x) })
    expect(geometrii.size).toBeGreaterThan(10)
    s.dispose()
    expect([...geometrii].filter(g => !eliberate.has(g))).toEqual([])
    expect([...materiale].filter(x => !eliberate.has(x))).toEqual([])
  })
})
