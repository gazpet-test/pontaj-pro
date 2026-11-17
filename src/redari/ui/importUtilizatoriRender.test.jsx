// ImportUtilizatori (PR4b) — ecranul importului de utilizatori: flux complet cu un client Supabase simulat (previzualizare → confirmare → scriere
// → rezultat → al doilea import = 0 noi), garda de generație (L24), o singură scriere la dublu-click (L05), butonul inactiv fără previzualizare /
// versiune, eroarea scrierii afișată (L18). Harness de hook-uri ca în importTgzRender.test.jsx, fără DOM; date fictive, fără PII.
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as XLSX from 'xlsx-js-style'

const hooks = vi.hoisted(() => ({ current: null }))
const bd = vi.hoisted(() => ({ client: null }))
vi.mock('react', async original => {
  const real = await original()
  return { ...real,
    useState: v => hooks.current ? hooks.current.state(v) : real.useState(v),
    useRef: v => hooks.current ? hooks.current.ref(v) : real.useRef(v),
    useEffect: (f, d) => hooks.current ? hooks.current.effect(f, d) : real.useEffect(f, d),
    useMemo: (f, d) => hooks.current ? f() : real.useMemo(f, d),
  }
})
vi.mock('../../lib/supabase.js', () => ({ supabase: { from: (...a) => bd.client.from(...a) } }))
afterEach(() => { hooks.current = null; vi.unstubAllGlobals() })

import ImportUtilizatori from './ImportUtilizatori.jsx'
import { COL, SURSA_UTILIZATORI, CALITATE_UTILIZATOR } from '../importUtilizatori.js'

// ── client Supabase simulat: filtre eq / is / in / gt, keyset order + limit, insert (.select().single() sau await), update().eq(), maybeSingle ──
function clientFals({ parcele, detinatori = [], esueazaDetinatori = null, poartaCitire = null } = {}) {
  const tabele = { red_parcele: parcele.map(p => ({ sters_la: null, ...p })), red_detinatori: detinatori.map(d => ({ sters_la: null, ...d })), red_detinatori_contact: [], red_import_loturi: [] }
  let n = 0
  const jurnal = []
  const from = (tab) => {
    const f = []
    let unul = false
    const rows = () => (tabele[tab] || []).filter(r => f.every(x => x(r)))
    const q = {}
    q.select = () => q
    q.eq = (c, v) => { f.push(r => r[c] === v); return q }
    q.is = (c, v) => { f.push(r => (r[c] ?? null) === v); return q }
    q.in = (c, vs) => { f.push(r => vs.includes(r[c])); return q }
    q.gt = (c, v) => { f.push(r => String(r[c]) > String(v)); return q }
    q.order = (c) => { q._ord = c; return q }
    q.limit = async (k) => {
      if (tab === 'red_parcele' && poartaCitire?.promisiune) { const p = poartaCitire.promisiune; poartaCitire.promisiune = null; await p }
      const c = q._ord || 'id'
      return { data: rows().sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0)).slice(0, k), error: null }
    }
    q.maybeSingle = () => { unul = true; return q }
    q.then = (ok, ko) => Promise.resolve(unul ? { data: rows()[0] ?? null, error: null } : { data: rows(), error: null }).then(ok, ko)
    q.insert = (v) => {
      const arr = (Array.isArray(v) ? v : [v]).map(r => tab === 'red_detinatori_contact' ? { ...r } : { id: `${tab}-${String(++n).padStart(4, '0')}`, sters_la: null, ...r })
      let rez = { data: arr, error: null }
      if (tab === 'red_detinatori' && esueazaDetinatori) rez = { data: null, error: esueazaDetinatori }
      else { tabele[tab].push(...arr); jurnal.push(['insert', tab, arr.length]) }
      return { select: () => ({ single: async () => ({ data: rez.data?.[0] ?? null, error: rez.error }) }), then: (ok, ko) => Promise.resolve(rez).then(ok, ko) }
    }
    q.update = (v) => ({ eq: async (c, val) => { const r = tabele[tab].find(x => x[c] === val); if (r) Object.assign(r, v); jurnal.push(['update', tab]); return { data: null, error: null } } })
    return q
  }
  return { from, tabele, jurnal }
}

// ── fișierul sintetic (foaia 1, antet pe 3 rânduri) ──
const rand = ({ uat = '02Husnicioara', hg = '', tarla = '', cad = '', nume = '', adresa = '' }) => {
  const r = Array(27).fill(''); r[COL.uat] = uat; r[COL.poz_hg] = hg; r[COL.tarla] = tarla; r[COL.nr_cadastral] = cad; r[COL.nume] = nume; r[COL.adresa] = adresa; return r
}
const xlsx = (date) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([Array(27).fill('A'), Array(27).fill('B'), Array(27).fill('C'), ...date]), 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}
const ADR = 'Jud. Mehedinti, Com. Husnicioara, Sat Fictiv'
const DATE = [
  rand({ hg: '10', tarla: '5', cad: '100', nume: 'IONESCU ANA (fictiv)', adresa: ADR }),           // nou (cheie)
  rand({ uat: '06Bâlvănești', hg: '7', cad: '700', nume: 'IONESCU ANA (fictiv)', adresa: ADR }),  // nou, același om pe altă parcelă
  rand({ hg: '20', cad: 'ALT', nume: 'ȘTEFĂNESCU ȚICU (fictiv)', adresa: ADR }),                  // nou, potrivit după poziția HG
  rand({ hg: '10', tarla: '5', cad: '100', nume: 'POPESCU ION (fictiv)', adresa: ADR }),          // deja proprietar
  rand({ uat: '18Armeniș', hg: '1', cad: '1', nume: 'ALTCINEVA (fictiv)' }),                      // în afara proiectului
  rand({ hg: '99', cad: '999', nume: 'NEGASIT (fictiv)', adresa: ADR }),                          // parcelă negăsită
]
const fisierFals = (nume = 'utilizatori.xlsx', continut = xlsx(DATE)) => ({ name: nume, arrayBuffer: async () => continut })
const PARCELE = () => [
  { id: 'p1', proiect_id: 'proiect-A', cheie_sursa: 'HUS|10|100|5', id_parcela: 'T1-HUS-0010', poz_hg: '10', red_uat: { uat3: 'HUS' } },
  { id: 'p2', proiect_id: 'proiect-A', cheie_sursa: 'BAL|7|700|', id_parcela: 'T1-BAL-0007', poz_hg: '7', red_uat: { uat3: 'BAL' } },
  { id: 'p3', proiect_id: 'proiect-A', cheie_sursa: 'HUS|20|200|', id_parcela: 'T1-HUS-0020', poz_hg: '20', red_uat: { uat3: 'HUS' } },
]
const DETINATORI = () => [{ id: 'd-prop', parcela_id: 'p1', nume_normalizat: 'POPESCU ION (FICTIV)', calitate: 'proprietar', sursa_date: 'TGZ' }]
const UATS = [{ id: 'u1', nume: 'Husnicioara', uat3: 'HUS' }, { id: 'u2', nume: 'Bâlvănești', uat3: 'BAL' }]

// ── harness de hook-uri (ca în importTgzRender.test.jsx) ──
function harness() {
  const valori = [], efecte = []
  let index = 0
  const h = {
    state: initial => { const i = index++; if (!(i in valori)) valori[i] = typeof initial === 'function' ? initial() : initial; return [valori[i], v => { valori[i] = typeof v === 'function' ? v(valori[i]) : v }] },
    ref: initial => { const i = index++; return valori[i] || (valori[i] = { current: initial }) },
    effect: (f, deps) => { const i = index++; if (!efecte[i] || deps.some((v, j) => v !== efecte[i].deps[j])) { efecte[i]?.curata?.(); efecte[i] = { deps, curata: f() } } },
    render: (component, props) => { index = 0; hooks.current = h; return component(props) },
    unmount: () => { for (const e of efecte) e?.curata?.() },
  }
  return h
}
const elemente = (node, tip) => {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(n => elemente(n, tip))
  return [...(tip(node) ? [node] : []), ...elemente(node.props?.children, tip)]
}
const text = (node) => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  return text(node.props?.children)
}
const butoane = tree => elemente(tree, n => n.type === 'button')
const buton = (tree, inceput) => butoane(tree).find(b => text(b).startsWith(inceput))
const inputuri = tree => elemente(tree, n => n.type === 'input')
const asteapta = () => new Promise(r => setTimeout(r, 0))
const amanat = () => { let rezolva; const promisiune = new Promise(r => { rezolva = r }); return { promisiune, rezolva } }

const props = (id = 'proiect-A', extra = {}) => ({ proiect: { id, cod: id === 'proiect-A' ? 'TEST-A' : 'TEST-B', convocare_utilizatori_aprobata: false }, uats: UATS, nivel: 'editor', show: vi.fn(), onImportat: vi.fn(), ...extra })

// deschide secțiunea, alege fișierul, completează versiunea → arborele curent
function pregateste(h, p, { fisier = fisierFals(), versiune = 'TGZ 01.01.2026 utilizatori (fictiv)' } = {}) {
  h.render(ImportUtilizatori, p)
  buton(h.render(ImportUtilizatori, p), 'Deschide').props.onClick()
  let tree = h.render(ImportUtilizatori, p)
  const [fis, ver] = inputuri(tree)
  fis.props.onChange({ target: { files: [fisier] } })
  if (versiune) ver.props.onChange({ target: { value: versiune } })
  return h.render(ImportUtilizatori, p)
}
async function previzualizeaza(h, p) {
  await buton(h.render(ImportUtilizatori, p), '🔍').props.onClick()
  return h.render(ImportUtilizatori, p)
}

describe('ImportUtilizatori — fluxul complet cu client simulat', () => {
  it('previzualizare → confirmare dublă → scriere → rezultat din BD; al doilea import al aceluiași fișier = 0 noi', async () => {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI() })
    const confirm = vi.fn(() => true); vi.stubGlobal('window', { confirm })
    const h = harness(); const p = props()
    pregateste(h, p)
    let tree = await previzualizeaza(h, p)
    expect(bd.client.jurnal.filter(j => j[0] === 'insert')).toEqual([])          // previzualizarea nu scrie nimic
    const t = text(tree)
    expect(t).toContain('Noi (rânduri)3'); expect(t).toContain('Persoane noi2'); expect(t).toContain('Deja deținători1')
    expect(t).toContain('Parcelă negăsită1'); expect(t).toContain('În afara proiectului1'); expect(t).toContain('Potrivite după poziția HG1')
    expect(elemente(tree, n => n.props?.['data-marcaj'] === 'hg')).toHaveLength(1)   // marcajul vizibil la potrivirea după HG
    const b = buton(tree, '📥')
    expect(text(b)).toBe('📥 Importă 3 utilizatori pe 3 parcele')
    expect(b.props.disabled).toBe(false)
    await b.props.onClick()
    tree = h.render(ImportUtilizatori, p)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toMatch(/3 utilizatori \(2 persoane\) pe 3 parcele, lista „TGZ 01\.01\.2026 utilizatori \(fictiv\)”/)
    const scrisi = bd.client.tabele.red_detinatori.filter(d => d.calitate === CALITATE_UTILIZATOR)
    expect(scrisi.map(d => d.parcela_id).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(bd.client.tabele.red_detinatori_contact).toHaveLength(3)
    expect(bd.client.tabele.red_import_loturi).toHaveLength(1)
    expect(bd.client.tabele.red_import_loturi[0]).toMatchObject({ sursa: SURSA_UTILIZATORI, stare: 'finalizat', detinatori_noi: 3, fisier_nume: 'utilizatori.xlsx', versiune_lista_tgz: 'TGZ 01.01.2026 utilizatori (fictiv)' })
    expect(elemente(tree, n => n.props?.['data-rezultat'] === 'ok')).toHaveLength(1)
    expect(text(tree)).toContain('Recitit din BD: 3 din 3 rânduri noi sunt acum utilizatori activi pe parcelă')
    expect(text(tree)).toContain('lot finalizat')
    expect(buton(tree, '📥')).toBeUndefined()                                       // planul confirmat nu mai poate fi retrimis
    expect(p.onImportat).toHaveBeenCalledTimes(1)
    expect(p.show.mock.calls.at(-1)).toEqual(['Import terminat: 3 utilizatori și 3 contacte noi.', 'success'])

    // al doilea import al aceluiași fișier: 0 noi, toți cei scriși sunt „deja deținători”, nimic de scris
    tree = await previzualizeaza(h, p)
    expect(text(tree)).toContain('Noi (rânduri)0'); expect(text(tree)).toContain('Deja deținători4')
    expect(buton(tree, '📥')).toBeUndefined()
    expect(text(tree)).toContain('Nimic nou de importat.')
    expect(bd.client.tabele.red_import_loturi).toHaveLength(1)
  })
})

describe('ImportUtilizatori — butonul de scriere', () => {
  it('fără previzualizare nu există; fără versiune e inactiv; viewer-ul nu îl vede', async () => {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI() })
    const h = harness(); const p = props()
    let tree = pregateste(h, p, { versiune: '' })
    expect(buton(tree, '📥')).toBeUndefined()
    tree = await previzualizeaza(h, p)
    expect(buton(tree, '📥').props.disabled).toBe(true)
    expect(text(tree)).toContain('Completează versiunea listei.')
    inputuri(tree)[1].props.onChange({ target: { value: '   ' } })                       // doar spații = tot lipsă
    expect(buton(h.render(ImportUtilizatori, p), '📥').props.disabled).toBe(true)
    inputuri(tree)[1].props.onChange({ target: { value: 'v-fictiv' } })
    expect(buton(h.render(ImportUtilizatori, p), '📥').props.disabled).toBe(false)

    const hv = harness(); const pv = props('proiect-A', { nivel: 'viewer' })
    pregateste(hv, pv)
    tree = await previzualizeaza(hv, pv)
    expect(buton(tree, '📥')).toBeUndefined()
    expect(text(tree)).toContain('Doar admin / editor pot importa.')
  })
  it('L05: dublu-click (al doilea înainte de re-render) = o singură scriere, o singură confirmare', async () => {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI() })
    const confirm = vi.fn(() => true); vi.stubGlobal('window', { confirm })
    const h = harness(); const p = props()
    pregateste(h, p)
    const b = buton(await previzualizeaza(h, p), '📥')
    const unu = b.props.onClick(), doi = b.props.onClick()
    await Promise.all([unu, doi])
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(bd.client.tabele.red_import_loturi).toHaveLength(1)
    expect(bd.client.tabele.red_detinatori.filter(d => d.calitate === CALITATE_UTILIZATOR)).toHaveLength(3)
    expect(p.show.mock.calls.some(c => /încă rulează/.test(c[0]))).toBe(true)
  })
  it('reluare după un import întrerupt (utilizatori scriși, contacte lipsă): 0 noi → „Reia doar completarea contactelor” completează doar contactele', async () => {
    const scrisi = [
      { id: 'd-u1', parcela_id: 'p1', nume_normalizat: 'IONESCU ANA (FICTIV)', calitate: CALITATE_UTILIZATOR, sursa_date: `${SURSA_UTILIZATORI}: rândul 4` },
      { id: 'd-u2', parcela_id: 'p2', nume_normalizat: 'IONESCU ANA (FICTIV)', calitate: CALITATE_UTILIZATOR, sursa_date: `${SURSA_UTILIZATORI}: rândul 5` },
      { id: 'd-u3', parcela_id: 'p3', nume_normalizat: 'STEFANESCU TICU (FICTIV)', calitate: CALITATE_UTILIZATOR, sursa_date: `${SURSA_UTILIZATORI}: rândul 6` },
    ]
    bd.client = clientFals({ parcele: PARCELE(), detinatori: [...DETINATORI(), ...scrisi] })
    const confirm = vi.fn(() => true); vi.stubGlobal('window', { confirm })
    const h = harness(); const p = props()
    pregateste(h, p)
    const tree = await previzualizeaza(h, p)
    expect(buton(tree, '📥')).toBeUndefined()
    await buton(tree, 'Reia doar completarea contactelor').props.onClick()
    expect(confirm.mock.calls[0][0]).toMatch(/doar pentru completarea contactelor lipsă/)
    expect(bd.client.tabele.red_detinatori_contact.map(c => c.detinator_id).sort()).toEqual(['d-u1', 'd-u2', 'd-u3'])   // proprietarul (d-prop) neatins
    expect(bd.client.tabele.red_detinatori).toHaveLength(4)
    expect(bd.client.tabele.red_import_loturi[0]).toMatchObject({ stare: 'finalizat', detinatori_noi: 0 })
  })
  it('renunțarea la a doua confirmare nu scrie nimic', async () => {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI() })
    vi.stubGlobal('window', { confirm: () => false })
    const h = harness(); const p = props()
    pregateste(h, p)
    await buton(await previzualizeaza(h, p), '📥').props.onClick()
    expect(bd.client.jurnal).toEqual([])
    expect(buton(h.render(ImportUtilizatori, p), '📥').props.disabled).toBe(false)
  })
})

describe('ImportUtilizatori — L18: eroarea scrierii afișată, starea coerentă', () => {
  it('INSERT refuzat → „Import eșuat” cu mesajul, lotul eșuat citit din BD, nimic declarat scris, previzualizarea trebuie refăcută', async () => {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), esueazaDetinatori: { code: '42501', message: 'refuz simulat' } })
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const p = props()
    pregateste(h, p)
    await buton(await previzualizeaza(h, p), '📥').props.onClick()
    const tree = h.render(ImportUtilizatori, p)
    expect(elemente(tree, n => n.props?.['data-rezultat'] === 'esuat')).toHaveLength(1)
    expect(text(tree)).toMatch(/inserare utilizatori: refuz simulat/)
    expect(text(tree)).toContain('lot esuat')
    expect(text(tree)).toContain('Recitit din BD: 0 din 3 rânduri noi')
    expect(bd.client.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', detinatori_noi: 0 })
    expect(buton(tree, '📥')).toBeUndefined()                // planul vechi nu se mai poate trimite: se reface previzualizarea
    expect(buton(tree, '🔍').props.disabled).toBe(false)      // nu rămâne blocat „în lucru”
    expect(p.show.mock.calls.at(-1)[1]).toBe('error')
    expect(p.onImportat).not.toHaveBeenCalled()
  })
  it('„două parcele active cu aceeași cheie” → eroare vizibilă la previzualizare, nimic de importat', async () => {
    bd.client = clientFals({ parcele: [...PARCELE(), { id: 'p9', proiect_id: 'proiect-A', cheie_sursa: 'HUS|10|100|5', id_parcela: 'T1-HUS-0099', poz_hg: '10', red_uat: { uat3: 'HUS' } }], detinatori: DETINATORI() })
    const h = harness(); const p = props()
    pregateste(h, p)
    const tree = await previzualizeaza(h, p)
    expect(text(elemente(tree, n => n.props?.['data-eroare'] === 'citire'))).toMatch(/Două parcele active cu aceeași cheie HUS\|10\|100\|5; nimic nu se importă/)
    expect(buton(tree, '📥')).toBeUndefined()
  })
  it('fișier greșit (nu .xlsx / fără rânduri în format) → mesaj clar', async () => {
    bd.client = clientFals({ parcele: PARCELE() })
    const h = harness(); const p = props()
    pregateste(h, p, { fisier: fisierFals('lista.csv') })
    expect(text(await previzualizeaza(h, p))).toMatch(/trebuie să fie Excel \.xlsx/)
    const h2 = harness()
    pregateste(h2, p, { fisier: fisierFals('alt.xlsx', xlsx([])) })
    expect(text(await previzualizeaza(h2, p))).toMatch(/nu are rânduri de date în formatul așteptat/)
  })
})

describe('ImportUtilizatori — L24: garda de generație', () => {
  it('fișierul schimbat în timpul citirii → rezultatul citirii vechi nu se aplică (control: fără schimbare se aplică)', async () => {
    for (const schimba of [false, true]) {
      bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI() })
      const citire = amanat()
      const h = harness(); const p = props()
      pregateste(h, p, { fisier: { name: 'vechi.xlsx', arrayBuffer: () => citire.promisiune } })
      const gata = buton(h.render(ImportUtilizatori, p), '🔍').props.onClick()
      if (schimba) inputuri(h.render(ImportUtilizatori, p))[0].props.onChange({ target: { files: [fisierFals('nou.xlsx')] } })
      citire.rezolva(xlsx(DATE)); await gata
      const tree = h.render(ImportUtilizatori, p)
      if (schimba) { expect(buton(tree, '📥')).toBeUndefined(); expect(text(tree)).not.toContain('Previzualizare'); expect(buton(tree, '🔍').props.disabled).toBe(false) }
      else expect(text(buton(tree, '📥'))).toBe('📥 Importă 3 utilizatori pe 3 parcele')
    }
  })
  it('proiectul schimbat în timpul citirii parcelelor → previzualizarea lui A nu apare în B', async () => {
    const poarta = amanat()
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), poartaCitire: { promisiune: poarta.promisiune } })
    const h = harness(); const pA = props('proiect-A')
    pregateste(h, pA)
    const gata = buton(h.render(ImportUtilizatori, pA), '🔍').props.onClick()
    await asteapta()
    const pB = props('proiect-B', { show: pA.show })
    h.render(ImportUtilizatori, pB)
    poarta.rezolva(); await gata
    const tree = h.render(ImportUtilizatori, pB)
    expect(buton(tree, '📥')).toBeUndefined()
    expect(text(tree)).not.toContain('Previzualizare')
    expect(pA.show).not.toHaveBeenCalled()
  })
  it('demontat în timpul scrierii → nicio actualizare a ecranului, doar un mesaj care numește proiectul', async () => {
    const poarta = amanat()
    const ctrl = { promisiune: null }
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), poartaCitire: ctrl })
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const p = props()
    pregateste(h, p)
    const b = buton(await previzualizeaza(h, p), '📥')
    ctrl.promisiune = poarta.promisiune                       // scrierea se oprește la recitirea parcelelor
    const gata = b.props.onClick()
    await asteapta()
    h.unmount()
    poarta.rezolva(); await gata
    expect(p.onImportat).not.toHaveBeenCalled()
    expect(p.show.mock.calls.at(-1)[0]).toMatch(/Importul utilizatorilor în TEST-A s-a terminat/)
  })
})
