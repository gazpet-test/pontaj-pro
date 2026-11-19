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

// 19.11.2026: rândurile „de verificat” (posibilă coloană decalată) NU blochează importul, dar confirmarea cere bifa „am verificat rândurile
// semnalate”, legată de previzualizarea curentă; lista nu arată valori
describe('ImportTgz — bifa pentru rândurile de verificat', () => {
  const I_VERIFICAT = 19   // ultimul hook (după cele 12 useState, 5 useRef și 2 useEffect)
  const semnal = { rand: 4, uat: 'FIC', nr_crt: '1', cheie_parcela: 'FIC:1', camp: 'tarla', motive: ['nume'], motiv: 'tarla / nr. topo: pare numele deținătorului' }
  const cuSemnal = () => ({ parcele: [{ cheie: 'FIC:1', cheie_sursa: 'FIC|HG 1||', ambigua: false }], detinatori: [], contacte: [], erori: [], ambigue: [], fara_cheie: [], de_verificat: [semnal],
    statistici: { parcele_de_importat: 1, detinatori_de_importat: 1, contacte_de_importat: 1, de_verificat: 1, randuri_de_verificat: 1 }, proiect_id_previzualizare: 'proiect-A' })
  const bifa = tree => elemente(tree, 'input').find(e => e.props.type === 'checkbox')
  const pregateste = (preview) => {
    amanate.import = amanat(); amanate.apeluriImport.length = 0
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const show = vi.fn(); const p = props('proiect-A', 'TEST-A', show)
    h.render(ImportTgz, p)
    h.valori[I.versiune] = 'v-fictiv'; h.valori[I.preview] = preview
    return { h, show, p }
  }
  it('fără bifă: butonul e dezactivat, iar handlerul refuză (nimic la scrieImport); cu bifă: importul pornește', async () => {
    const { h, show, p } = pregateste(cuSemnal())
    const tree = h.render(ImportTgz, p)
    expect(buton(tree, '📥 Importă').props.disabled).toBe(true)
    expect(bifa(tree).props.checked).toBe(false)
    await buton(tree, '📥 Importă').props.onClick()
    expect(amanate.apeluriImport).toEqual([])
    expect(show.mock.calls.at(-1)[0]).toMatch(/de verificat/)
    bifa(tree).props.onChange({ target: { checked: true } })
    const tree2 = h.render(ImportTgz, p)
    expect(bifa(tree2).props.checked).toBe(true)
    expect(buton(tree2, '📥 Importă').props.disabled).toBe(false)
    const gata = buton(tree2, '📥 Importă').props.onClick()
    amanate.import.rezolva({ lotId: 'lot-fictiv', parceleNoi: 1, detinatoriNoi: 1, diferente: {} }); await gata
    expect(amanate.apeluriImport).toHaveLength(1)
  })
  it('bifa e legată de previzualizare: o previzualizare nouă (alt obiect) cere bifa din nou', () => {
    const { h, p } = pregateste(cuSemnal())
    h.render(ImportTgz, p)
    h.valori[I_VERIFICAT] = h.valori[I.preview]   // bifat pe previzualizarea veche
    expect(buton(h.render(ImportTgz, p), '📥 Importă').props.disabled).toBe(false)
    h.valori[I.preview] = cuSemnal()               // refăcută: alt obiect, aceleași date
    const tree = h.render(ImportTgz, p)
    expect(bifa(tree).props.checked).toBe(false)
    expect(buton(tree, '📥 Importă').props.disabled).toBe(true)
  })
  it('statistica lipsă nu scutește de bifă (se numără lista); fără semnale nu apare nicio bifă', () => {
    const pv = cuSemnal(); delete pv.statistici.randuri_de_verificat
    const { h, p } = pregateste(pv)
    expect(buton(h.render(ImportTgz, p), '📥 Importă').props.disabled).toBe(true)
    const fara = { ...cuSemnal(), de_verificat: [], statistici: { parcele_de_importat: 1, detinatori_de_importat: 1, contacte_de_importat: 1 } }
    const r = pregateste(fara)
    const tree = r.h.render(ImportTgz, r.p)
    expect(bifa(tree)).toBeUndefined()
    expect(buton(tree, '📥 Importă').props.disabled).toBe(false)
  })
  it('tab-ul „De verificat” arată doar rândul, UAT, Nr.Crt., câmpul și motivul (lista albă, fără valoare)', () => {
    const { h, p } = pregateste(cuSemnal())
    h.render(ImportTgz, p)
    h.valori[9] = 'de_verificat'   // subTab
    // TabelPreview e o componentă internă (harness-ul nu o randează): se verifică rândurile primite
    const gaseste = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(gaseste) : [...(n.type?.name === 'TabelPreview' ? [n] : []), ...gaseste(n.props?.children)]
    const [tabel] = gaseste(h.render(ImportTgz, p))
    expect(tabel.props.randuri).toEqual([{ rand: 4, uat: 'FIC', nr_crt: '1', camp: 'tarla', motiv: 'tarla / nr. topo: pare numele deținătorului' }])
  })
})

// r2 (Jakarinos #1140 P1, decizia Răzvan 19.11.2026 = B): câmpul semnalat al parcelei semnalate e ascuns în TOATE taburile, în raportul de
// după import, în CSV-ul de după import și în cel din istoric (lista „de verificat” e păstrată în lot); valorile nesemnalate rămân vizibile.
// Date FICTIVE. Pe 87425697 (fără mascare în taburi / fără listă în lot) testele de mai jos pică.
describe('ImportTgz — valorile semnalate ascunse peste tot', () => {
  const NUME_TARLA = 'POPESCU FICTIV'; const NUME_CADASTRU = 'IONESCU FICTIV'   // „coloana decalată”: nume ajunse în tarla / cadastru
  const SENSIBILE = [NUME_TARLA, NUME_CADASTRU]
  const ASCUNS = '[ascuns: de verificat]'
  const SEMNALE = [
    { rand: 4, uat: 'FIC', nr_crt: '1', cheie_parcela: 'FIC:1', camp: 'tarla', motive: ['nume'], motiv: 'tarla / nr. topo: pare numele deținătorului' },
    { rand: 7, uat: 'FIC', nr_crt: '3', cheie_parcela: 'FIC:3', camp: 'nr_cadastral', motive: ['nume'], motiv: 'nr. cadastral / parcelă: pare numele deținătorului' },
  ]
  const CS1 = `FIC|HG 1|CF 77|${NUME_TARLA}`; const CS3 = `FIC|HG 3|${NUME_CADASTRU}|T 3`
  const DET1 = `tarla: „${NUME_TARLA}” / „T 1”; cadastru: „CF 77” / „CF 7”`
  const MOTIV_CS = 'cadastru suspect (posibilă valoare-umplutură) — de verificat'
  const previewMascare = () => ({
    parcele: [
      { cheie: 'FIC:1', cheie_sursa: CS1, poz_hg: 'HG 1', nr_cadastral: 'CF 77', tarla: NUME_TARLA, ambigua: true, rand: 4 },
      { cheie: 'FIC:2', cheie_sursa: 'FIC|HG 2|CF 78|T 9', poz_hg: 'HG 2', nr_cadastral: 'CF 78', tarla: 'T 9', ambigua: false, rand: 6 },
      { cheie: 'FIC:3', cheie_sursa: CS3, poz_hg: 'HG 3', nr_cadastral: NUME_CADASTRU, tarla: 'T 3', ambigua: false, rand: 7 },
    ],
    detinatori: [{ cheie: 'FIC:1|TEST UNU', cheie_parcela: 'FIC:1', nr_crt: '1', nume: 'Test Unu', rand: 4 }, { cheie: 'FIC:3|TEST TREI', cheie_parcela: 'FIC:3', nr_crt: '3', nume: 'Test Trei', rand: 7 }],
    contacte: [{ cheie_detinator: 'FIC:1|TEST UNU', adresa_strada: 'Str. Fictivă 1' }],
    dubluri: [{ rand: 5, cheie_parcela: 'FIC:1', nr_crt: '1', nume: 'Test Unu', rand_original: 4 }],
    neidentificati: [], fara_cheie: [{ rand: 8, nr_crt: '4', nume: 'Test Patru', uat: 'FIC', cheie_parcela: 'FIC:4' }],
    ambigue: [{ rand: 4, nr_crt: '1', nume: 'Test Unu', uat: 'FIC', cheie_parcela: 'FIC:1', cheie_sursa: CS1, motiv: 'identitate contradictorie sub același Nr.Crt.', detaliu: DET1 }],
    cadastru_suspect: [
      { rand: 4, uat: 'FIC', nr_crt: '1', cheie_parcela: 'FIC:1', cheie_sursa: CS1, valoare: '##', stare: 'parcela NU se importă (ambiguă)', motiv: MOTIV_CS, detaliu: 'cadastru: „##”; parcela NU se importă (ambiguă)' },
      { rand: 7, uat: 'FIC', nr_crt: '3', cheie_parcela: 'FIC:3', cheie_sursa: CS3, valoare: NUME_CADASTRU, stare: 'eligibilă', motiv: MOTIV_CS, detaliu: `cadastru: „${NUME_CADASTRU}”; eligibilă` },
    ],
    de_verificat: SEMNALE, erori: [{ rand: 9, motiv: 'Nume deținător gol', uat: 'FIC', nr_crt: '5' }],
    statistici: { parcele_de_importat: 2, detinatori_de_importat: 1, contacte_de_importat: 0, de_verificat: 2, randuri_de_verificat: 2 }, proiect_id_previzualizare: 'proiect-A',
  })
  const gaseste = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(gaseste) : [...(n.type?.name === 'TabelPreview' ? [n] : []), ...gaseste(n.props?.children)]
  const texte = n => n == null || typeof n === 'boolean' ? [] : (typeof n === 'string' || typeof n === 'number') ? [String(n)] : Array.isArray(n) ? n.flatMap(texte) : texte(n.props?.children)
  const pregateste = () => {
    const h = harness(); const show = vi.fn(); const p = props('proiect-A', 'TEST-A', show)
    h.render(ImportTgz, p); h.valori[I.versiune] = 'v-fictiv'; h.valori[I.preview] = previewMascare()
    return { h, p, show }
  }
  const randuriTab = (h, p, tab) => { h.valori[9] = tab; const [t] = gaseste(h.render(ImportTgz, p)); return t.props.randuri }
  const csvuri = []
  const prindeCsv = () => {
    csvuri.length = 0
    vi.stubGlobal('URL', { createObjectURL: b => { csvuri.push(b); return 'blob:fictiv' }, revokeObjectURL: () => {} })
    vi.stubGlobal('document', { createElement: () => ({ click: () => {} }) })
  }

  it('fiecare tab: câmpul semnalat al parcelei semnalate e ascuns, restul valorilor se văd; previzualizarea însăși rămâne neatinsă', () => {
    const { h, p } = pregateste()
    for (const tab of ['parcele', 'detinatori', 'contacte', 'dubluri', 'neidentificati', 'fara_cheie', 'ambigue', 'cadastru_suspect']) {
      const json = JSON.stringify(randuriTab(h, p, tab))
      for (const v of SENSIBILE) expect(json, `${tab}: ${v}`).not.toContain(v)
    }
    const parcele = randuriTab(h, p, 'parcele')
    expect(parcele.map(x => [x.cheie_sursa, x.poz_hg, x.nr_cadastral, x.tarla])).toEqual([
      [`FIC|HG 1|CF 77|${ASCUNS}`, 'HG 1', 'CF 77', ASCUNS],   // doar tarla (semnalată) ascunsă
      ['FIC|HG 2|CF 78|T 9', 'HG 2', 'CF 78', 'T 9'],          // parcelă fără semnal: neschimbată
      [`FIC|HG 3|${ASCUNS}|T 3`, 'HG 3', ASCUNS, 'T 3'],
    ])
    expect(randuriTab(h, p, 'ambigue')[0]).toMatchObject({ cheie_sursa: `FIC|HG 1|CF 77|${ASCUNS}`, detaliu: `tarla: ${ASCUNS}; cadastru: „CF 77” / „CF 7”`, nume: 'Test Unu' })
    expect(randuriTab(h, p, 'cadastru_suspect').map(x => [x.valoare, x.detaliu])).toEqual([
      ['##', 'cadastru: „##”; parcela NU se importă (ambiguă)'],   // cadastrul parcelei 1 nu e semnalat: se vede
      [ASCUNS, `cadastru: ${ASCUNS}; eligibilă`],
    ])
    expect(h.valori[I.preview].parcele[0].tarla).toBe(NUME_TARLA)   // valoarea se importă așa cum e (decizia B, nu C)
    // tab-ul erorilor (randat direct): nimic de ascuns acolo, dar trece prin aceeași funcție
    h.valori[9] = 'erori'
    expect(texte(h.render(ImportTgz, p)).join(' ')).toContain('Nume deținător gol')
  })
  it('CSV-ul previzualizării ascunde aceleași câmpuri', () => {
    prindeCsv()
    const { h, p } = pregateste()
    return (async () => {
      buton(h.render(ImportTgz, p), '⬇ Descarcă rândurile de tratat').props.onClick()
      const csv = await csvuri[0].text()
      for (const v of SENSIBILE) expect(csv).not.toContain(v)
      expect(csv).toContain(`FIC|HG 1|CF 77|${ASCUNS}`)
    })()
  })
  it('după import: raportul (tabelul ambigue) și CSV-ul „după import” ascund câmpul semnalat, cu lista păstrată în lot', async () => {
    prindeCsv()
    amanate.import = amanat(); amanate.apeluriImport.length = 0
    vi.stubGlobal('window', { confirm: () => true })
    const { h, p } = pregateste()
    h.valori[19] = h.valori[I.preview]   // bifa „am verificat”, pe previzualizarea curentă
    const gata = buton(h.render(ImportTgz, p), '📥 Importă').props.onClick()
    const pv = previewMascare()
    amanate.import.rezolva({ lotId: 'lot-fictiv', parceleNoi: 2, detinatoriNoi: 1, ambigue: pv.ambigue,
      diferente: { erori: [], fara_cheie: [], ambigue: pv.ambigue, cadastru_suspect: pv.cadastru_suspect, de_verificat: SEMNALE, contacte_noi: 0 } })
    await gata
    const tree = h.render(ImportTgz, p)
    const txt = texte(tree).join(' ')
    for (const v of SENSIBILE) expect(txt).not.toContain(v)
    expect(txt).toContain(`FIC|HG 1|CF 77|${ASCUNS}`)
    expect(txt).toContain('2 rânduri de verificat — valorile semnalate sunt ascunse în CSV')
    buton(tree, '⬇ Rândurile de tratat după import').props.onClick()
    const csv = await csvuri.at(-1).text()
    for (const v of SENSIBILE) expect(csv).not.toContain(v)
    expect(csv).toContain(`cadastru: ${ASCUNS}; eligibilă`)
  })
  it('istoric: lotul cu listă ascunde câmpurile semnalate în CSV; lotul vechi fără listă rămâne neschimbat și e marcat „fără verificarea fixă”', async () => {
    prindeCsv()
    amanate.loturi = amanat()
    const h = harness(); const show = vi.fn(); const p = props('proiect-A', 'TEST-A', show)
    buton(h.render(ImportTgz, p), 'Arată loturile').props.onClick()
    const pv = previewMascare()
    const dif = { erori: [], fara_cheie: [], ambigue: pv.ambigue, cadastru_suspect: pv.cadastru_suspect }
    amanate.loturi.rezolva({ data: [
      { id: 'lot-nou', created_at: '2026-11-19T10:00:00', stare: 'finalizat', versiune_lista_tgz: 'v-nou', sursa: 'TGZ', randuri_total: 9, diferente: { ...dif, de_verificat: SEMNALE } },
      { id: 'lot-vechi', created_at: '2026-11-01T10:00:00', stare: 'finalizat', versiune_lista_tgz: 'v-vechi', sursa: 'TGZ', randuri_total: 9, diferente: dif },
    ], error: null })
    await asteapta()
    const [nou, vechi] = h.valori[I.loturi]
    expect([nou.verificare, vechi.verificare]).toEqual([2, null])
    for (const v of SENSIBILE) expect(JSON.stringify(nou.randuri)).not.toContain(v)
    expect(nou.randuri.find(r => r.rand === 4).cheie_sursa).toBe(`FIC|HG 1|CF 77|${ASCUNS}`)
    expect(vechi.randuri.find(r => r.rand === 4).cheie_sursa).toBe(CS1)   // comportament neschimbat pentru loturile vechi
    const tree = h.render(ImportTgz, p)
    const txt = texte(tree).join(' ')
    expect(txt).toContain('fără verificarea fixă (lot dinainte de 19.11.2026')
    expect(txt).toContain('2 rânduri de verificat — valorile semnalate sunt ascunse în CSV')
    elemente(tree, 'button').filter(b => textButon(b).startsWith('⬇ CSV'))[0].props.onClick()
    const csv = await csvuri.at(-1).text()
    for (const v of SENSIBILE) expect(csv).not.toContain(v)
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
