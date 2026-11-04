// Panoul „Convocatoare în masă”: randare pe niveluri (SSR) + ciclul de viață sub StrictMode (setup → cleanup → setup) cu un harness de hook-uri.
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
const lot = vi.hoisted(() => ({ pregatit: null, apeluri: 0 }))
vi.mock('../convocatoareMasa.js', async original => {
  const real = await original()
  return { ...real, pregatesteLot: vi.fn(async (_c, { esteCurent }) => { lot.apeluri++; expect(typeof esteCurent).toBe('function'); return lot.pregatit }) }
})
afterEach(() => { hooks.current = null; lot.apeluri = 0 })

import ConvocatoareMasa from './ConvocatoareMasa.jsx'

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

describe('ConvocatoareMasa — randare', () => {
  it('viewer nu vede panoul; editor vede butonul', () => {
    expect(renderToString(<ConvocatoareMasa proiect={proiect} uats={uats} nivel="viewer" show={show} />)).toBe('')
    const h = renderToString(<ConvocatoareMasa proiect={proiect} uats={uats} nivel="editor" show={show} />)
    expect(h).toContain('Generează convocatoarele UAT-ului')
    expect(h).toContain('include și cele deja generate')
  })
})

describe('ConvocatoareMasa — StrictMode (P2)', () => {
  it('după setup → cleanup → setup, „Verifică” aplică rezultatul (montat repus pe true)', async () => {
    lot.pregatit = { blocat: null, plan: [{ actiune: 'nou', rand: { id_parcela: 'TST-0001', nume: 'X' } }], exclusi: [], protectie: false }
    const h = harness()
    const props = { proiect, uats, nivel: 'editor', show }
    let el = h.randeaza(props)
    h.strict()
    gaseste(el, e => e.type === 'select').props.onChange({ target: { value: 'u1' } })
    el = h.randeaza(props)
    await gaseste(el, e => e.type === 'button' && text(e) === 'Verifică').props.onClick()
    expect(lot.apeluri).toBe(1)
    el = h.randeaza(props)
    const t = text(el)
    expect(t).toContain('În lotul ăsta')
    expect(t).toContain('Protecția la generarea simultană')   // avertismentul vizibil fără migrarea 20261130l
  })
  it('după demontare, un răspuns întârziat nu se aplică', async () => {
    let elibereaza
    lot.pregatit = new Promise(r => { elibereaza = r })
    const h = harness()
    const props = { proiect, uats, nivel: 'editor', show }
    let el = h.randeaza(props)
    const efecte = []
    // primul efect = montarea; îi păstrăm cleanup-ul ca să simulăm demontarea
    hooks.current.effect = f => efecte.push(f)
    el = h.randeaza(props)
    gaseste(el, e => e.type === 'select').props.onChange({ target: { value: 'u1' } })
    el = h.randeaza(props)
    const cleanup = efecte[0]()
    const p = gaseste(el, e => e.type === 'button' && text(e) === 'Verifică').props.onClick()
    cleanup()
    elibereaza({ blocat: null, plan: [], exclusi: [], protectie: true })
    await p
    el = h.randeaza(props)
    expect(text(el)).not.toContain('În lotul ăsta')
  })
})
