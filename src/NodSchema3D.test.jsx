// Eliberarea resurselor scenei 3D (review r2): Three.js REAL (geometrii, materiale, scenă), dar renderer și OrbitControls FALSE
// (jsdom nu are WebGL), ca să vedem ce se eliberează: la ieșire normală ȘI când construcția pică la jumătate (renderer.setSize aruncă,
// după ce controalele, ascultătorii și ResizeObserver-ul sunt deja create). jsdom nu e dependență: se caută în node_modules sau în
// REDARI_JSDOM_DIR (tiparul din NodCuplareSchema.test.jsx); fără el, suita e SĂRITĂ VIZIBIL.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as THREE_REAL from 'three'
import * as THREE_SCENA from './nodSchema3dThree.js'
import { construiesteScena } from './NodSchema3D.jsx'
import { parseModel3d, instalatia } from './nodSchema3dLogica.js'

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

function mediu({ picaLaSetSize = 0 } = {}) {   // picaLaSetSize = al câtelea apel al lui setSize aruncă (0 = niciunul)
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
    setPixelRatio() { this.setSize(1, 1, false) }   // ca în Three.js: setPixelRatio apelează intern setSize (review r3)
    setClearColor() {}
    setSize() { this.apeluri = (this.apeluri || 0) + 1; if (this.apeluri === picaLaSetSize) throw new Error('setSize a picat (test)') }
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
  const THREE = { ...THREE_SCENA, WebGLRenderer: RendererFals }   // exact ce primește scena în aplicație (exporturile pe nume)
  const gazda = d.getElementById('g')
  // ascultătorii de pe canvas: se numără adăugările și scoaterile (controalele false nu pun ascultători, deci sunt doar ai scenei)
  const contor = { add: 0, rem: 0 }
  // jsdom nu are context 2D (fără pachetul canvas): unul fals, ca etichetele să se creeze (textul nu contează aici)
  j.window.HTMLCanvasElement.prototype.getContext = function (t) {
    return t === '2d' ? { font: '', fillStyle: '', textBaseline: '', measureText: s => ({ width: String(s).length * 20 }), fillRect() {}, fillText() {} } : null
  }
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

  it('review r3: primul setSize (din setPixelRatio, înaintea oricărei alte resurse) pică = rendererul tot se eliberează', () => {
    const m = mediu({ picaLaSetSize: 1 })
    expect(() => construiesteScena(m.THREE, m.ControaleFalse, m.gazda, GRUP, () => {})).toThrow('setSize a picat (test)')
    expect(m.randere[0].dispose).toHaveBeenCalledTimes(1)
    expect(m.randere[0].forceContextLoss).toHaveBeenCalledTimes(1)
    expect(m.gazda.querySelectorAll('canvas')).toHaveLength(0)
    expect(m.controale).toHaveLength(0)                         // nimic altceva n-a apucat să fie creat
    expect(m.observatoare).toHaveLength(0)
    expect(m.contor.add).toBe(0)
  })

  it('review r2: setSize din redimensionare pică (după controale / ascultători / observator) = tot ce s-a creat se eliberează', () => {
    const m = mediu({ picaLaSetSize: 2 })
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

  // ── varianta B: vederea „Toată instalația” (grup.parti), pe un model sintetic mic deja transformat ──
  const COMUN = () => {
    const a = {
      id: 'rez', titlu: 'Rezervoare',
      elemente: [
        { tip: 'teava', a: [0, 0, 0], b: [1000, 0, 0], dn: 250, cert: 'desen' },
        { tip: 'teava', a: [1000, 0, 0], b: [2000, 0, 0], dn: 250, cert: 'desen' },
        { tip: 'teava', a: [2000, 0, 0], b: [3000, 0, 0], dn: 250, cert: 'desen' },
        { tip: 'eticheta', p: [0, 0, 1000], text: 'A' },
      ],
      suduri: [{ cod: 'CR-001', p: [1000, 0, 0], cert: 'desen' }],
    }
    const b = {
      id: 'gara', titlu: 'Gara',
      elemente: [
        { tip: 'teava', a: [20000, 0, 0], b: [20000, 2000, 0], dn: 300, cert: 'desen' },
        { tip: 'robinet', a: [20000, 2000, 0], b: [20000, 2600, 0], dn: 300, cert: 'desen' },
        { tip: 'eticheta', p: [20000, 0, 1000], text: 'B' },
        { tip: 'eticheta', p: [20000, 2000, 1000], text: 'C' },
      ],
      suduri: [{ cod: 'CP-001', p: [20000, 2000, 0], cert: 'desen' }],
    }
    return { id: '_instalatie', titlu: 'Toată instalația', terenZ: 0, prefixe: ['CR', 'CP'], elemente: [...a.elemente, ...b.elemente],
      suduri: [...a.suduri, ...b.suduri], faraPozitie: [], parti: [a, b] }
  }
  const partiDin = scena => scena.children.filter(o => o.isGroup && o.children[0]?.isGroup)   // parte = grup cu sub-grupul de etichete
  const plase = o => o.children.filter(x => x.isMesh)

  it('fiecare grup e o parte a scenei; piesele se lipesc pe material; ascunde / etichete schimbă doar vizibilitatea', () => {
    const m = mediu()
    const scene = []
    const THREE = { ...m.THREE, Scene: class extends THREE_REAL.Scene { constructor() { super(); scene.push(this) } } }
    const s = construiesteScena(THREE, m.ControaleFalse, m.gazda, COMUN(), () => {})
    const [pa, pb] = partiDin(scene[0])
    expect(partiDin(scene[0])).toHaveLength(2)
    expect(plase(pa)).toHaveLength(1)                                // 3 țevi DN250, același material = o singură plasă
    expect(plase(pb)).toHaveLength(2)                                // țeava DN300 + corpul robinetului (alt material)
    expect(pa.children[0].children).toHaveLength(1)                  // etichetele de tip `eticheta`, în sub-grupul lor
    expect(pb.children[0].children).toHaveLength(2)
    s.ascunde(new Set(['gara']))
    expect([pa.visible, pb.visible]).toEqual([true, false])
    s.ascunde(new Set())
    expect([pa.visible, pb.visible]).toEqual([true, true])
    s.etichete(false)
    expect([pa.children[0].visible, pb.children[0].visible]).toEqual([false, false])
    expect(pa.visible).toBe(true)                                    // piesele rămân
    s.etichete(true)
    expect(pb.children[0].visible).toBe(true)
    s.dispose()
  })

  it('„du-mă la” pune ținta camerei pe centrul grupului; „Încadrează” revine pe toate; zoom-ul înapoi ajunge la toată instalația', () => {
    const m = mediu()
    const s = construiesteScena(m.THREE, m.ControaleFalse, m.gazda, COMUN(), () => {})
    const c = m.controale[0]
    // grupul „gara”: x = 20 m, y între 0 și 2,6 m, z = 0…1 m -> în scenă (x, z, -y) = (20, 0,5, -1,3)
    s.mergiLa('gara')
    expect(c.target.x).toBeCloseTo(20, 6); expect(c.target.y).toBeCloseTo(0.5, 6); expect(c.target.z).toBeCloseTo(-1.3, 6)
    const maxLaGrup = c.maxDistance
    // toată instalația: x între 0 și 20 m, z = 0…1 m, y între 0 și 2,6 m -> centrul (10, 0,5, -1,3)
    s.incadreaza()
    expect(c.target.x).toBeCloseTo(10, 6); expect(c.target.y).toBeCloseTo(0.5, 6); expect(c.target.z).toBeCloseTo(-1.3, 6)
    expect(maxLaGrup).toBeGreaterThanOrEqual(c.maxDistance)          // după „du-mă la”, zoom-ul înapoi nu e mai mic decât pe tot
    // cu un grup ascuns, „Încadrează” cuprinde doar grupurile vizibile
    s.ascunde(new Set(['gara']))
    s.incadreaza()
    expect(c.target.x).toBeCloseTo(1.5, 6)
    s.dispose()
  })

  it('vederea comună: la ieșire se eliberează toate geometriile din scenă (inclusiv plasele lipite) și materialele sferelor', () => {
    const m = mediu()
    const scene = []
    const THREE = { ...m.THREE, Scene: class extends THREE_REAL.Scene { constructor() { super(); scene.push(this) } } }
    const s = construiesteScena(THREE, m.ControaleFalse, m.gazda, COMUN(), () => {})
    const loc = (cheie, p, id, stare) => ({ cheie, p, cert: 'desen', puncte: [{ sudura: { id, stare, dn: 250 } }] })
    s.aplicaPuncte([loc('3d:CR-001', [1000, 0, 0], 1, 'sudat'), loc('3d:CP-001', [20000, 2000, 0], 2, 'sudat')], null)
    const geometrii = new Set(), materiale = new Set()
    scene[0].traverse(o => { if (o.geometry) geometrii.add(o.geometry); if (o.material) materiale.add(o.material) })
    // aceeași stare = același material pentru miez (și pentru contur): nu câte unul pe sferă
    const sfere = scene[0].children.find(o => o.isGroup && o.children.length === 4)
    expect(new Set(sfere.children.map(x => x.material)).size).toBe(2)
    const eliberate = new Set()
    for (const x of [...geometrii, ...materiale]) x.addEventListener('dispose', () => { eliberate.add(x) })
    expect(geometrii.size).toBeGreaterThan(5)
    s.dispose()
    expect([...geometrii].filter(g => !eliberate.has(g))).toEqual([])   // fiecare geometrie, nu doar „destule”
    expect([...materiale].filter(x => !eliberate.has(x))).toEqual([])
    expect(m.randere[0].dispose).toHaveBeenCalledTimes(1)
    expect(m.gazda.querySelectorAll('canvas')).toHaveLength(0)
  })

  // ── review r1 (P2): amplasări depărtate — planul îndepărtat al camerei trebuie să cuprindă toată scena încadrată ──
  // Model real trecut prin parseModel3d + instalatia (două grupuri valide la x = ±900 000 mm), ecran 4:3, controale care
  // îndreaptă camera spre țintă (ca OrbitControls.update). Verificarea e independentă de cod: fiecare punct al pieselor și
  // sudurilor, dus în scenă (x, z, -y) / 1000, trebuie să fie în piramida de vedere a camerei (frustum) după încadrare.
  const departat = () => {
    const grupDe = (id, prefix, x) => ({ id, prefixe: [prefix], teren_z: 0, amplasare: { origine: [x, 0, 0], rot_z: 0 },
      elemente: [{ tip: 'teava', a: [0, 0, 0], b: [3000, 0, 0], dn: 250 }, { tip: 'teava', a: [3000, 0, 0], b: [3000, 2000, 0], dn: 250 }],
      suduri: [{ cod: `${prefix}-001`, p: [3000, 0, 0], cert: 'desen' }] })
    const model = parseModel3d({ format: 'gazpet-nod-3d', versiune: 1, unitate: 'mm',
      grupuri: [grupDe('vest', 'CR', -900000), grupDe('est', 'CP', 900000)] })
    expect(model.erori).toEqual([])
    return instalatia(model)
  }
  const inVedere = (camera, grup) => {
    camera.updateMatrixWorld()
    const fr = new THREE_REAL.Frustum().setFromProjectionMatrix(new THREE_REAL.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const pts = [...grup.elemente.flatMap(e => [e.a, e.b, e.c, e.r, e.p].filter(Boolean)), ...grup.suduri.map(s => s.p)]
    return pts.filter(p => !fr.containsPoint(new THREE_REAL.Vector3(p[0] / 1000, p[2] / 1000, -p[1] / 1000))).length
  }
  const scenaCuCamera = grup => {
    const m = mediu()
    Object.defineProperty(m.gazda, 'clientWidth', { value: 800 }); Object.defineProperty(m.gazda, 'clientHeight', { value: 600 })
    const camere = []
    const THREE = { ...m.THREE, PerspectiveCamera: class extends THREE_REAL.PerspectiveCamera { constructor(...a) { super(...a); camere.push(this) } } }
    class Controale extends m.ControaleFalse {
      constructor(camera, el) { super(camera, el); this.camera = camera; this.fn = new Map() }
      addEventListener(t, f) { super.addEventListener(t, f); this.fn.set(t, f) }
      update() { this.camera.lookAt(this.target) }
      schimba() { this.update(); this.fn.get('change')?.() }       // ca OrbitControls după rotire / zoom: evenimentul „change”
    }
    const s = construiesteScena(THREE, Controale, m.gazda, grup, () => {})
    return { s, camera: camere[0], c: m.controale[0] }
  }

  it('review r1: două grupuri la x = ±900 m (ecran 4:3) = toate piesele și sudurile în vedere, nu tăiate de planul îndepărtat', () => {
    const grup = departat()
    const { s, camera, c } = scenaCuCamera(grup)
    expect(camera.aspect).toBeCloseTo(4 / 3, 9)
    expect(camera.position.distanceTo(c.target)).toBeGreaterThan(1000)   // premisa: încadrarea e dincolo de vechiul prag de 1000 m
    expect(inVedere(camera, grup)).toBe(0)
    // „du-mă la” pe un grup, apoi zoom-ul înapoi până la maxDistance (ca omul cu rotița): scena rămâne întreagă
    s.mergiLa('est')
    expect(inVedere(camera, { elemente: grup.parti[1].elemente, suduri: grup.parti[1].suduri })).toBe(0)
    s.incadreaza()
    const dir = camera.position.clone().sub(c.target).normalize()
    camera.position.copy(c.target).addScaledVector(dir, c.maxDistance)
    c.schimba()
    expect(inVedere(camera, grup)).toBe(0)
    s.dispose()
  })

  it('review r1: nodul mic obișnuit păstrează proiecția de dinainte (near 0,05 m, far 1000 m)', () => {
    const { s, camera } = scenaCuCamera(COMUN())
    expect([camera.near, camera.far]).toEqual([0.05, 1000])
    expect(inVedere(camera, COMUN())).toBe(0)
    s.dispose()
  })
})
