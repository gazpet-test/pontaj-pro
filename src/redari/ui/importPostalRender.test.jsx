// ImportPostal: expedierile după termenul de 10 zile (plan pct. 4.2) se văd în previzualizare și cer o confirmare care le numără;
// fără confirmare nu se scrie nimic (Copilot f-v2 r3 P2-01). Harness de hook-uri ca în setariRender.test.jsx, fără DOM.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToString } from 'react-dom/server'

const hooks = vi.hoisted(() => ({ current: null }))
const apeluri = vi.hoisted(() => [])
vi.mock('react', async original => {
  const real = await original()
  return { ...real,
    useState: v => hooks.current ? hooks.current.state(v) : real.useState(v),
    useRef: v => hooks.current ? hooks.current.ref(v) : real.useRef(v),
    useEffect: (f, d) => hooks.current ? hooks.current.effect(f, d) : real.useEffect(f, d),
  }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: { from: tabel => {
  apeluri.push(tabel)
  const q = { then: (ok, ko) => Promise.resolve({ data: [], error: null }).then(ok, ko) }
  for (const op of ['select', 'eq', 'neq', 'is', 'limit', 'update', 'order', 'gt', 'in']) q[op] = () => q
  return q
} } }))
afterEach(() => { hooks.current = null; apeluri.length = 0; vi.unstubAllGlobals() })

import ImportPostal from './ImportPostal.jsx'
import { propune } from '../importPostal.js'

function harness() {
  const valori = [], efecte = []
  let index = 0
  const h = {
    valori,
    state: initial => {
      const i = index++
      if (!(i in valori)) valori[i] = typeof initial === 'function' ? initial() : initial
      return [valori[i], v => { valori[i] = typeof v === 'function' ? v(valori[i]) : v }]
    },
    ref: initial => { const i = index++; return valori[i] || (valori[i] = { current: initial }) },
    effect: (f, deps) => {
      const i = index++
      if (!efecte[i] || deps.some((v, j) => v !== efecte[i].deps[j])) { efecte[i]?.curata?.(); efecte[i] = { deps, curata: f() } }
    },
    render: (component, props) => { index = 0; hooks.current = h; return component(props) },
  }
  return h
}
const elemente = (node, tip) => {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(n => elemente(n, tip))
  return [...(node.type === tip ? [node] : []), ...elemente(node.props?.children, tip)]
}
const textButon = b => [].concat(b.props.children).join('')

// ziua 1 = 10.12.2026 → limita 30.11.2026; un plic în termen, unul după termen
const uats = [{ id: 'uat-fictiv', nume: 'Comuna Fictivă', sesiune_zi1: '2026-12-10' }]
const plic = (id, nr) => ({ id, proiect_id: 'proiect-fictiv', uat_id: 'uat-fictiv', nr_plic: nr, lot_id: 'lot-fictiv', opis_path: `plicuri/${id}/opis.docx`, awb: null,
  data_expediere: null, data_ar: null, retur: null, retur_data: null, stare: 'activ', versiune: 1 })
const mapare = { nr_document: 'doc', nr_tracking: 'awb', data: 'data' }
const preview = propune([{ doc: 'PL-TST-0001', awb: 'AA1', data: '20.11.2026', __rand: 2 }, { doc: 'PL-TST-0002', awb: 'AA2', data: '03.12.2026', __rand: 3 }],
  mapare, 'expediere', [plic('p1', 'PL-TST-0001'), plic('p2', 'PL-TST-0002')], { uats })

function ecranCuPrevizualizare() {
  const h = harness()
  const props = { proiect: { id: 'proiect-fictiv', cod: 'TEST-PR' }, nivel: 'editor', onSchimbat: vi.fn() }
  h.render(ImportPostal, props)
  // starea `preview` este al 4-lea useState (fisier, mod, mapare, preview); se pune după primul efect (care resetează ecranul)
  h.valori[3] = preview
  return { h, props, tree: h.render(ImportPostal, props) }
}

describe('ImportPostal — termenul de 10 zile', () => {
  it('previzualizarea arată avertismentul doar pe rândul tardiv și numărul tardivelor', () => {
    const { tree } = ecranCuPrevizualizare()
    const html = renderToString(tree).replace(/<!-- -->/g, '')
    expect(html).toContain('După termenul de 10 zile: <b>1</b>')
    expect(html).toContain('⚠ Data expedierii (03.12.2026) e după termen')
    expect(html).not.toContain('Data expedierii (20.11.2026)')
  })
  it.each([[[false], 1], [[true, false], 2]])('confirmare refuzată (%j) → nu se aplică nimic', async (raspunsuri, nrConfirmari) => {
    const confirm = vi.fn(() => raspunsuri.shift())
    vi.stubGlobal('window', { confirm })
    const { tree } = ecranCuPrevizualizare()
    await elemente(tree, 'button').find(b => textButon(b).startsWith('4. Aplică')).props.onClick()
    expect(confirm).toHaveBeenCalledTimes(nrConfirmari)
    if (nrConfirmari === 2) expect(confirm.mock.calls[1][0]).toMatch(/^1 din 2 expedieri sunt DUPĂ termenul de convocare/)
    expect(apeluri).toEqual([])
  })
  it('ambele confirmări acceptate → se aplică (cererile pleacă spre red_plicuri)', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('window', { confirm })
    const { tree } = ecranCuPrevizualizare()
    await elemente(tree, 'button').find(b => textButon(b).startsWith('4. Aplică')).props.onClick()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(apeluri.length).toBeGreaterThan(0)
    expect(new Set(apeluri)).toEqual(new Set(['red_plicuri']))
  })
})
