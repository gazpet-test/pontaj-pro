// ImportTgz — Copilot PR #981 r2 P2-02: rezultatele async (istoricul loturilor, finalizarea importului) pornite pe proiectul A
// NU se aplică după ce ecranul a trecut pe proiectul B. Harness de hook-uri ca în importPostalRender.test.jsx, fără DOM; date fictive.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const hooks = vi.hoisted(() => ({ current: null }))
const amanate = vi.hoisted(() => ({ loturi: null, import: null, apeluriImport: [] }))
const amanat = () => { let rezolva; const promisiune = new Promise(r => { rezolva = r }); return { promisiune, rezolva } }
vi.mock('react', async original => {
  const real = await original()
  return { ...real,
    useState: v => hooks.current ? hooks.current.state(v) : real.useState(v),
    useRef: v => hooks.current ? hooks.current.ref(v) : real.useRef(v),
    useEffect: (f, d) => hooks.current ? hooks.current.effect(f, d) : real.useEffect(f, d),
    useMemo: (f, d) => hooks.current ? f() : real.useMemo(f, d),
  }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: { from: tabel => {
  let unul = false
  const q = { then: (ok, ko) => (unul
    ? Promise.resolve({ data: { id: 'lot-fictiv', stare: 'finalizat' }, error: null })
    : amanate.loturi.promisiune).then(ok, ko) }
  for (const op of ['select', 'eq', 'order', 'limit']) q[op] = () => q
  q.maybeSingle = () => { unul = true; return q }
  return q
} } }))
vi.mock('../importTgz.js', async original => ({ ...(await original()), scrieImport: (sb, preview, opt) => { amanate.apeluriImport.push({ preview, opt }); return amanate.import.promisiune } }))
afterEach(() => { hooks.current = null; vi.unstubAllGlobals() })

import ImportTgz from './ImportTgz.jsx'

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
    unmount: () => { for (const e of efecte) e?.curata?.() },   // cleanup-ul tuturor efectelor, ca la demontarea componentei
  }
  return h
}
const elemente = (node, tip) => {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(n => elemente(n, tip))
  return [...(node.type === tip ? [node] : []), ...elemente(node.props?.children, tip)]
}
const textButon = b => [].concat(b.props.children).join('')
const buton = (tree, inceput) => elemente(tree, 'button').find(b => textButon(b).startsWith(inceput))
const asteapta = () => new Promise(r => setTimeout(r, 0))

// ordinea useState în ImportTgz: fisier, versiune, sursa, tronsonPeUat, preview, nota, lucru, progres, raport, subTab, loturi, loturiStare
const I = { versiune: 1, preview: 4, lucru: 6, raport: 8, loturi: 10 }
const props = (id, cod, show) => ({ proiect: { id, cod }, uats: [{ id: 'uat-fictiv', nume: 'Comuna Fictivă', uat3: 'FIC' }], nivel: 'editor', show, onImportat: vi.fn() })
const LOT_A = [{ id: 'lot-A', created_at: '2026-11-04T10:00:00', stare: 'finalizat', versiune_lista_tgz: 'v-A', sursa: 'TGZ', randuri_total: 1, diferente: { erori: [{ rand: 4, motiv: 'Nr.Crt. invalid „x”' }] } }]

describe('ImportTgz — istoricul loturilor nu se aplică peste alt proiect', () => {
  const porneste = (schimba) => {
    amanate.loturi = amanat()
    const h = harness(); const show = vi.fn()
    const tree = h.render(ImportTgz, props('proiect-A', 'TEST-A', show))
    buton(tree, 'Arată loturile').props.onClick()
    if (schimba) h.render(ImportTgz, props('proiect-B', 'TEST-B', show))
    return h
  }
  it('control: fără schimbare de proiect, lista se aplică', async () => {
    const h = porneste(false)
    amanate.loturi.rezolva({ data: LOT_A, error: null }); await asteapta()
    expect(h.valori[I.loturi].map(l => [l.id, l.puseDeoparte])).toEqual([['lot-A', 1]])
  })
  it('cererea pornită pe A și terminată după trecerea pe B → ignorată', async () => {
    const h = porneste(true)
    amanate.loturi.rezolva({ data: LOT_A, error: null }); await asteapta()
    expect(h.valori[I.loturi]).toBeNull()
  })
})

describe('ImportTgz — finalizarea unui import pornit pe A nu scrie raportul în B', () => {
  const preview = { parcele: [{ cheie: 'FIC:1', cheie_sursa: 'FIC|HG 1||', ambigua: false }], detinatori: [], contacte: [], erori: [], ambigue: [], fara_cheie: [],
    statistici: { parcele_de_importat: 1, detinatori_de_importat: 1, contacte_de_importat: 1 }, proiect_id_previzualizare: 'proiect-A' }
  const porneste = async (mod) => {
    amanate.import = amanat(); amanate.apeluriImport.length = 0
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const show = vi.fn()
    const pA = props('proiect-A', 'TEST-A', show)
    h.render(ImportTgz, pA)
    h.valori[I.versiune] = 'v-fictiv'; h.valori[I.preview] = preview
    const tree = h.render(ImportTgz, pA)
    const gata = buton(tree, '📥 Importă').props.onClick()
    if (mod === 'B') { h.render(ImportTgz, props('proiect-B', 'TEST-B', show)); h.valori[I.lucru] = true }   // B pornește propria operație
    if (mod === 'unmount') h.unmount()
    amanate.import.rezolva({ lotId: 'lot-fictiv', parceleNoi: 1, detinatoriNoi: 1, diferente: {} })
    await gata
    return { h, show, pA }
  }
  it('control: pe același proiect raportul se afișează', async () => {
    const { h, pA } = await porneste('acelasi')
    expect(h.valori[I.raport]).toMatchObject({ lotId: 'lot-fictiv', esuat: false })
    expect(h.valori[I.lucru]).toBe(false)
    expect(pA.onImportat).toHaveBeenCalledTimes(1)
  })
  it('după trecerea pe B: raportul NU se scrie, doar un mesaj care numește proiectul A', async () => {
    const { h, show } = await porneste('B')
    expect(h.valori[I.raport]).toBeNull()
    expect(h.valori[I.lucru]).toBe(true)   // r5 (C-P2-03): finally-ul importului A nu resetează starea lui B
    expect(show.mock.calls.at(-1)[0]).toMatch(/Importul în TEST-A s-a terminat/)
  })
  it('Copilot r3 P2-03: componenta demontată în timpul importului → nicio actualizare locală, niciun onImportat', async () => {
    const { h, show, pA } = await porneste('unmount')
    expect(h.valori[I.raport]).toBeNull()
    expect(h.valori[I.lucru]).toBe(true)   // starea ecranului demontat nu mai e atinsă (nici în finally)
    expect(pA.onImportat).not.toHaveBeenCalled()
    expect(show.mock.calls.at(-1)[0]).toMatch(/Importul în TEST-A s-a terminat/)
  })
})

// r5 (Copilot r4 P1-03): previzualizarea calculată pentru A nu poate fi importată în B
describe('ImportTgz — previzualizarea e legată de proiect', () => {
  const preview = { parcele: [{ cheie: 'FIC:1', cheie_sursa: 'FIC|HG 1||', ambigua: false }], detinatori: [], contacte: [], erori: [], ambigue: [], fara_cheie: [],
    statistici: { parcele_de_importat: 1, detinatori_de_importat: 1, contacte_de_importat: 1 }, proiect_id_previzualizare: 'proiect-A' }
  it('preview A → trecere pe B: previzualizarea se golește, butonul nu mai există, nimic nu ajunge la scrieImport', async () => {
    amanate.import = amanat(); amanate.apeluriImport.length = 0
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const show = vi.fn()
    h.render(ImportTgz, props('proiect-A', 'TEST-A', show))
    h.valori[I.versiune] = 'v-fictiv'; h.valori[I.preview] = preview
    const treeA = h.render(ImportTgz, props('proiect-A', 'TEST-A', show))
    const butonA = buton(treeA, '📥 Importă')
    expect(butonA.props.disabled).toBe(false)
    h.render(ImportTgz, props('proiect-B', 'TEST-B', show))   // efectul [proiect.id] golește starea (harness: efectul rulează în render)
    const treeB = h.render(ImportTgz, props('proiect-B', 'TEST-B', show))   // re-render-ul de după setState, ca în React
    expect(h.valori[I.preview]).toBeNull()
    expect(buton(treeB, '📥 Importă')).toBeUndefined()
    // chiar dacă cineva ar reinjecta previzualizarea lui A în B: butonul e dezactivat, iar handlerul refuză
    h.valori[I.preview] = preview
    const treeB2 = h.render(ImportTgz, props('proiect-B', 'TEST-B', show))
    const butonB = buton(treeB2, '📥 Importă')
    expect(butonB.props.disabled).toBe(true)
    await butonB.props.onClick()
    expect(amanate.apeluriImport).toEqual([])
    expect(show.mock.calls.at(-1)[0]).toMatch(/alt proiect/)
  })
  it('control: pe proiectul A importul trimite previzualizarea cu proiectul A', async () => {
    amanate.import = amanat(); amanate.apeluriImport.length = 0
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const show = vi.fn()
    h.render(ImportTgz, props('proiect-A', 'TEST-A', show))
    h.valori[I.versiune] = 'v-fictiv'; h.valori[I.preview] = preview
    const gata = buton(h.render(ImportTgz, props('proiect-A', 'TEST-A', show)), '📥 Importă').props.onClick()
    amanate.import.rezolva({ lotId: 'lot-fictiv', parceleNoi: 1, detinatoriNoi: 1, diferente: {} }); await gata
    expect(amanate.apeluriImport.map(a => [a.preview.proiect_id_previzualizare, a.opt.proiectId])).toEqual([['proiect-A', 'proiect-A']])
  })
})

// r6 (Jakarinos r5 P3, Copilot r5 P2-03): parsarea asincronă terminată după unmount nu mai atinge ecranul
describe('ImportTgz — previzualizarea terminată după unmount', () => {
  const porneste = async (demonteaza) => {
    const citire = amanat()
    const h = harness(); const show = vi.fn()
    const p = props('proiect-A', 'TEST-A', show)
    h.render(ImportTgz, p)
    h.valori[0] = { arrayBuffer: () => citire.promisiune }   // fișierul ales (starea `fisier`)
    h.valori[I.versiune] = 'v-fictiv'
    const gata = buton(h.render(ImportTgz, p), '🔍 Previzualizează').props.onClick()
    if (demonteaza) h.unmount()
    citire.rezolva(new ArrayBuffer(8))   // nu e Excel: parserul întoarce o eroare, fără excepție
    await gata
    return { h, show }
  }
  it('control: montat → previzualizarea (cu eroarea de fișier) se aplică și se anunță', async () => {
    const { h, show } = await porneste(false)
    expect(h.valori[I.preview]).toMatchObject({ proiect_id_previzualizare: 'proiect-A' })
    expect(show).toHaveBeenCalled()
  })
  it('demontat înainte de terminarea citirii → nicio previzualizare, niciun mesaj', async () => {
    const { h, show } = await porneste(true)
    expect(h.valori[I.preview]).toBeNull()
    expect(show).not.toHaveBeenCalled()
  })
})
