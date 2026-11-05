// Panoul „Convocatoare în masă”: randare pe niveluri (SSR) + ciclul de viață sub StrictMode (setup → cleanup → setup) și generația / identitatea
// la finalizarea generării și după ZIP (r3 P2-7), cu un harness de hook-uri.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToString } from 'react-dom/server'

const hooks = vi.hoisted(() => ({ current: null }))
vi.mock('react', async original => {
  const real = await original()
  return { ...real,
    useState: v => hooks.current ? hooks.current.state(v) : real.useState(v),
    useRef: v => hooks.current ? hooks.current.ref(v) : real.useRef(v),
    useEffect: (f, d) => hooks.current ? hooks.current.effect(f, d) : real.useEffect(f, d),
  }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('fără BD în test') }, rpc: () => { throw new Error('fără BD în test') } } }))
const lot = vi.hoisted(() => ({ pregatit: null, apeluri: 0, executie: null, zip: null }))
vi.mock('../convocatoareMasa.js', async original => {
  const real = await original()
  return { ...real,
    pregatesteLot: vi.fn(async (_c, { esteCurent }) => { lot.apeluri++; expect(typeof esteCurent).toBe('function'); return lot.pregatit }),
    executaLot: vi.fn(async () => lot.executie),
    construiesteZip: vi.fn(async () => lot.zip),
  }
})
const desc = vi.hoisted(() => ({ apeluri: [] }))
vi.mock('../docx.js', async original => ({ ...(await original()), descarcaBlob: (b, n) => { desc.apeluri.push(n) } }))
afterEach(() => { hooks.current = null; lot.apeluri = 0; desc.apeluri = [] })

import ConvocatoareMasa from './ConvocatoareMasa.jsx'
import { MESAJ_FARA_PROTECTIE } from '../convocatoareMasa.js'

const proiect = { id: 'p1', cod: 'TEST-RAZVAN' }
const uats = [{ id: 'u1', nume: 'Testeni', uat3: 'TST' }]
const show = vi.fn()

// harness minimal: stare pe index, ref-uri persistente, efectele de la prima randare rulate „ca StrictMode” (setup, cleanup, setup)
function harness() {
  const stari = [], refuri = []
  let i = 0, j = 0, efecte = []
  hooks.current = {
    state(v) { const k = i++; if (!(k in stari)) stari[k] = typeof v === 'function' ? v() : v; return [stari[k], nv => { stari[k] = typeof nv === 'function' ? nv(stari[k]) : nv }] },
    ref(v) { const k = j++; if (!(k in refuri)) refuri[k] = { current: v }; return refuri[k] },
    effect(f) { efecte.push(f) },
  }
  const randeaza = (props) => { i = 0; j = 0; efecte = []; return ConvocatoareMasa(props) }
  const strict = () => { for (const f of efecte) { const c = f(); if (typeof c === 'function') c(); f() } }
  return { randeaza, strict, refuri }
}
const gaseste = (el, pred) => {
  if (!el || typeof el !== 'object') return null
  if (Array.isArray(el)) { for (const x of el) { const g = gaseste(x, pred); if (g) return g } return null }
  if (pred(el)) return el
  return gaseste(el.props?.children, pred)
}
const text = (el) => !el ? '' : typeof el === 'string' || typeof el === 'number' ? String(el) : Array.isArray(el) ? el.map(text).join('') : text(el.props?.children)
const buton = (el, t) => gaseste(el, e => e.type === 'button' && text(e).includes(t))

describe('ConvocatoareMasa — randare', () => {
  it('viewer nu vede panoul; editor vede butonul', () => {
    expect(renderToString(<ConvocatoareMasa proiect={proiect} uats={uats} nivel="viewer" show={show} />)).toBe('')
    const h = renderToString(<ConvocatoareMasa proiect={proiect} uats={uats} nivel="editor" show={show} />)
    expect(h).toContain('Generează convocatoarele UAT-ului')
    expect(h).toContain('include și cele deja generate')
  })
})

describe('ConvocatoareMasa — StrictMode și generații', () => {
  it('după setup → cleanup → setup, „Verifică” aplică rezultatul; fără migrare → lot blocat cu mesajul', async () => {
    lot.pregatit = { blocat: MESAJ_FARA_PROTECTIE, plan: [], exclusi: [], protectie: false }
    const h = harness()
    const props = { proiect, uats, nivel: 'editor', show }
    let el = h.randeaza(props)
    h.strict()
    gaseste(el, e => e.type === 'select').props.onChange({ target: { value: 'u1' } })
    el = h.randeaza(props)
    await buton(el, 'Verifică').props.onClick()
    expect(lot.apeluri).toBe(1)
    el = h.randeaza(props)
    expect(text(el)).toContain('protecția la concurență nu e activă — aplicați migrarea 20261131c')
    expect(buton(el, 'Generează').props.disabled).toBe(true)
  })
  it('după demontare, un răspuns întârziat nu se aplică', async () => {
    let elibereaza
    lot.pregatit = new Promise(r => { elibereaza = r })
    const h = harness()
    const props = { proiect, uats, nivel: 'editor', show }
    let el = h.randeaza(props)
    const efecte = []
    hooks.current.effect = f => efecte.push(f)
    el = h.randeaza(props)
    gaseste(el, e => e.type === 'select').props.onChange({ target: { value: 'u1' } })
    el = h.randeaza(props)
    const cleanup = efecte[0]()
    const p = buton(el, 'Verifică').props.onClick()
    cleanup()
    elibereaza({ blocat: null, plan: [], exclusi: [], protectie: true })
    await p
    el = h.randeaza(props)
    expect(text(el)).not.toContain('În lotul ăsta')
  })
  it('r3 P2-7: proiectul se schimbă cât rulează generarea → nici raport, nici onSchimbat, nici zip', async () => {
    globalThis.window = { confirm: () => true }
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })
    const plan = [{ actiune: 'nou', rand: { id_parcela: 'TST-0001', nume: 'X' } }]
    lot.pregatit = { blocat: null, plan, exclusi: [], protectie: true }
    let elibereaza
    lot.executie = new Promise(r => { elibereaza = r })
    lot.zip = new Blob(['z'])
    const onSchimbat = vi.fn()
    const h = harness()
    let props = { proiect, uats, nivel: 'editor', show, onSchimbat }
    let el = h.randeaza(props); h.strict()
    gaseste(el, e => e.type === 'select').props.onChange({ target: { value: 'u1' } })
    el = h.randeaza(props)
    await buton(el, 'Verifică').props.onClick()
    el = h.randeaza(props)
    const p = buton(el, 'Generează').props.onClick()
    await new Promise(r => setTimeout(r, 0))
    props = { ...props, proiect: { id: 'p2', cod: 'ALT' } }   // alt proiect afișat (aceeași componentă montată)
    el = h.randeaza(props)
    elibereaza({ fisiere: [{ nume: 'C-0001_TST-0001.docx', blob: new Blob(['d']) }], raport: [{ rand: plan[0].rand, actiune: 'nou', stare: 'ok', nrDocument: 'C-0001', motiv: '' }] })
    await p
    expect(onSchimbat).not.toHaveBeenCalled()
    expect(desc.apeluri).toEqual([])
    el = h.randeaza(props)
    expect(text(el)).not.toContain('Descarcă din nou')
  })
  it('r3 P2-7: aceeași identitate → raport, onSchimbat și zip descărcat o dată', async () => {
    globalThis.window = { confirm: () => true }
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })
    const plan = [{ actiune: 'nou', rand: { id_parcela: 'TST-0001', nume: 'X' } }]
    lot.pregatit = { blocat: null, plan, exclusi: [], protectie: true }
    lot.executie = { fisiere: [{ nume: 'C-0001_TST-0001.docx', blob: new Blob(['d']) }], raport: [{ rand: plan[0].rand, actiune: 'nou', stare: 'ok', nrDocument: 'C-0001', motiv: '' }] }
    lot.zip = new Blob(['z'])
    const onSchimbat = vi.fn()
    const h = harness()
    const props = { proiect, uats, nivel: 'editor', show, onSchimbat }
    let el = h.randeaza(props); h.strict()
    gaseste(el, e => e.type === 'select').props.onChange({ target: { value: 'u1' } })
    el = h.randeaza(props)
    await buton(el, 'Verifică').props.onClick()
    el = h.randeaza(props)
    await buton(el, 'Generează').props.onClick()
    expect(onSchimbat).toHaveBeenCalledTimes(1)
    expect(desc.apeluri).toHaveLength(1)
    expect(desc.apeluri[0]).toMatch(/^convocatoare_TEST-RAZVAN_TST_/)
  })
})
