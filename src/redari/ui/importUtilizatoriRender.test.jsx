// ImportUtilizatori (PR4b) — ecranul importului de utilizatori: flux complet cu un client Supabase simulat (previzualizare → confirmare → scriere
// → rezultat → al doilea import = 0 noi), garda de generație (L24), o singură scriere la dublu-click (L05), butonul inactiv fără previzualizare /
// versiune, eroarea scrierii afișată (L18). r2 (Jak PR1120): bifa separată pentru potrivirile HG, avertismentul pentru alte importuri, rezultatul
// nesigur (răspuns pierdut după COMMIT), contacte parțial comise, proiect schimbat în timpul scrierii, anularea pe lot (owner).
// Harness de hook-uri ca în importTgzRender.test.jsx, fără DOM; date fictive, fără PII.
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
import { executaAnulare, pregatesteAnulare } from '../importUtilizatoriAnulare.js'

// ── client Supabase simulat: filtre eq / is / in / gt / gte / like, keyset order + limit, insert (.select().single() sau await),
// update cu filtre (.eq / .is) + .select(), maybeSingle; created_at = updated_at la INSERT, updated_at nou la UPDATE (ca triggerul) ──
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function clientFals({ parcele, detinatori = [], loturiExistente = [], esueazaDetinatori = null, poartaCitire = null, pierdeRaspuns = null, esueazaContacteLa = 0, esueazaCitireLoturi = false } = {}) {
  const tabele = { red_parcele: parcele.map(p => ({ sters_la: null, ...p })), red_detinatori: detinatori.map(d => ({ sters_la: null, created_at: 't0', updated_at: 't0', ...d })),
    red_detinatori_contact: [], red_import_loturi: loturiExistente.map(l => ({ ...l })), red_convocari: [], red_raspunsuri: [], red_procese_verbale: [] }
  let n = 0, tic = 0, inserturiContact = 0, pierdut = false
  const ceas = () => `2020-01-01T10:00:${String(++tic).padStart(4, '0')}`   // în trecut: loturile create în test nu sunt „recente” (pct. 1c)
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
    q.gte = (c, v) => { f.push(r => String(r[c]) >= String(v)); return q }
    q.like = (c, model) => { const re = new RegExp('^' + model.split('%').map(esc).join('.*') + '$'); f.push(r => re.test(String(r[c] ?? ''))); return q }
    q.order = (c) => { q._ord = q._ord || c; return q }
    q.limit = async (k) => {
      if (tab === 'red_parcele' && poartaCitire?.promisiune) { const p = poartaCitire.promisiune; poartaCitire.promisiune = null; await p }
      if (tab === 'red_import_loturi' && esueazaCitireLoturi) return { data: null, error: { code: '42501', message: 'citire loturi refuzată (simulat)' } }
      const c = q._ord || 'id'
      return { data: rows().sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0)).slice(0, k), error: null }
    }
    q.maybeSingle = () => { unul = true; return q }
    q.then = (ok, ko) => Promise.resolve(unul ? { data: rows()[0] ?? null, error: null } : { data: rows(), error: null }).then(ok, ko)
    q.insert = (v) => {
      const la = ceas()
      const arr = (Array.isArray(v) ? v : [v]).map(r => tab === 'red_detinatori_contact' ? { updated_at: la, ...r } : { id: `${tab}-${String(++n).padStart(4, '0')}`, sters_la: null, created_at: la, updated_at: la, ...r })
      let rez = { data: arr, error: null }
      if (tab === 'red_detinatori' && esueazaDetinatori) rez = { data: null, error: esueazaDetinatori }
      else if (tab === 'red_detinatori_contact' && esueazaContacteLa && ++inserturiContact === esueazaContacteLa) rez = { data: null, error: { code: '23514', message: 'contact refuzat (simulat)' } }
      else {
        tabele[tab].push(...arr); jurnal.push(['insert', tab, arr.length])
        if (tab === pierdeRaspuns && !pierdut) { pierdut = true; rez = { data: null, error: { message: 'TypeError: Failed to fetch' } } }   // comis, răspuns pierdut
      }
      return { select: () => ({ single: async () => ({ data: rez.data?.[0] ?? null, error: rez.error }) }), then: (ok, ko) => Promise.resolve(rez).then(ok, ko) }
    }
    q.update = (v) => {
      const ff = []
      const b = {
        eq: (c, val) => { ff.push(r => r[c] === val); return b },
        is: (c, val) => { ff.push(r => (r[c] ?? null) === val); return b },
        select: () => b,
        then: (ok, ko) => {
          const rs = (tabele[tab] || []).filter(r => ff.every(x => x(r)))
          for (const r of rs) Object.assign(r, v, tab === 'red_detinatori' ? { updated_at: ceas() } : {})
          jurnal.push(['update', tab, rs.length])
          return Promise.resolve({ data: rs.map(r => ({ id: r.id })), error: null }).then(ok, ko)
        },
      }
      return b
    }
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
  rand({ hg: '10', tarla: '5', cad: '100', nume: 'IONESCU ANA (fictiv)', adresa: ADR }),           // 4: nou (cheie)
  rand({ uat: '06Bâlvănești', hg: '7', cad: '700', nume: 'IONESCU ANA (fictiv)', adresa: ADR }),  // 5: nou, același om pe altă parcelă
  rand({ hg: '20', cad: 'ALT', nume: 'ȘTEFĂNESCU ȚICU (fictiv)', adresa: ADR }),                  // 6: nou, potrivit după poziția HG
  rand({ hg: '10', tarla: '5', cad: '100', nume: 'POPESCU ION (fictiv)', adresa: ADR }),          // 7: deja proprietar
  rand({ uat: '18Armeniș', hg: '1', cad: '1', nume: 'ALTCINEVA (fictiv)' }),                      // 8: în afara proiectului
  rand({ hg: '99', cad: '999', nume: 'NEGASIT (fictiv)', adresa: ADR }),                          // 9: parcelă negăsită
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
const bifaHg = tree => elemente(tree, n => n.type === 'input' && n.props?.type === 'checkbox')[0]
const asteapta = () => new Promise(r => setTimeout(r, 0))
const amanat = () => { let rezolva; const promisiune = new Promise(r => { rezolva = r }); return { promisiune, rezolva } }
// descărcarea CSV fără DOM: Blob-ul trimis la URL.createObjectURL e capturat
function capteazaDescarcari() {
  const blobs = []
  vi.stubGlobal('URL', { createObjectURL: b => { blobs.push(b); return 'blob:fictiv' }, revokeObjectURL: () => {} })
  vi.stubGlobal('document', { createElement: () => ({ click: () => {} }) })
  return blobs
}

const props = (id = 'proiect-A', extra = {}) => ({ proiect: { id, cod: id === 'proiect-A' ? 'TEST-A' : 'TEST-B', convocare_utilizatori_aprobata: false }, uats: UATS, nivel: 'editor', show: vi.fn(), onImportat: vi.fn(), ...extra })
const scrisiUtil = () => bd.client.tabele.red_detinatori.filter(d => d.calitate === CALITATE_UTILIZATOR)

// deschide secțiunea, alege fișierul, completează versiunea → arborele curent
function pregateste(h, p, { fisier = fisierFals(), versiune = 'TGZ 01.01.2026 utilizatori (fictiv)' } = {}) {
  h.render(ImportUtilizatori, p)
  buton(h.render(ImportUtilizatori, p), 'Deschide').props.onClick()
  const tree = h.render(ImportUtilizatori, p)
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
  it('previzualizare → confirmare → scriere (fără HG) → rezultat din BD; al doilea import cu bifa HG; al treilea = 0 noi', async () => {
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
    expect(text(elemente(tree, n => n.props?.['data-plafon'] === 'lista'))).toMatch(/cel mult 100 de rânduri pe categorie.*raportul CSV/)
    // r2 pct. 5: bifa HG nebifată implicit → butonul numără doar rândurile pe cheie exactă
    expect(bifaHg(tree).props.checked).toBe(false)
    const b = buton(tree, '📥')
    expect(text(b)).toBe('📥 Importă 2 utilizatori pe 2 parcele (fără potrivirile după HG: 1)')
    expect(b.props.disabled).toBe(false)
    await b.props.onClick()
    tree = h.render(ImportUtilizatori, p)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toMatch(/2 utilizatori \(1 persoane\) pe 2 parcele, lista „TGZ 01\.01\.2026 utilizatori \(fictiv\)”/)
    expect(confirm.mock.calls[0][0]).toMatch(/1 potriviți după poziția HG NU se importă acum/)
    expect(scrisiUtil().map(d => d.parcela_id).sort()).toEqual(['p1', 'p2'])
    expect(bd.client.tabele.red_detinatori_contact).toHaveLength(2)
    const lot1 = bd.client.tabele.red_import_loturi[0]
    expect(lot1).toMatchObject({ sursa: SURSA_UTILIZATORI, stare: 'finalizat', detinatori_noi: 2, fisier_nume: 'utilizatori.xlsx', versiune_lista_tgz: 'TGZ 01.01.2026 utilizatori (fictiv)' })
    // r2 pct. 6: evidența exactă pe lot (id-urile create + contactele), HG neconfirmate consemnate
    expect(lot1.diferente.scrise.map(s => s.id).sort()).toEqual(scrisiUtil().map(d => d.id).sort())
    expect(lot1.diferente.contacte_scrise.sort()).toEqual(scrisiUtil().map(d => d.id).sort())
    expect(lot1.diferente.hg_neconfirmate.map(x => x.rand)).toEqual([6])
    expect(scrisiUtil().every(d => d.sursa_date.endsWith(`; lot ${lot1.id}`))).toBe(true)
    expect(elemente(tree, n => n.props?.['data-rezultat'] === 'ok')).toHaveLength(1)
    expect(text(tree)).toContain('Recitit din BD: 2 din 2 rânduri confirmate sunt scrise de această operație')
    expect(text(tree)).toContain('HG neconfirmate (neimportate)1')
    expect(text(tree)).toContain('lot finalizat')
    expect(buton(tree, '📥')).toBeUndefined()                                       // planul confirmat nu mai poate fi retrimis
    expect(p.onImportat).toHaveBeenCalledTimes(1)
    expect(p.show.mock.calls.at(-1)).toEqual(['Import terminat: 2 utilizatori și 2 contacte noi.', 'success'])
    // raportul după scriere: id-urile din BD, rândul HG „neimportat … neconfirmată”
    const blobs = capteazaDescarcari()
    buton(tree, '⬇ Raportul după scriere').props.onClick()
    const csv = await blobs[0].text()
    const d4 = scrisiUtil().find(d => d.parcela_id === 'p1')
    expect(csv.split('\r\n').find(l => l.startsWith('4;'))).toContain(`;scris de această operație;${d4.id};da`)
    expect(csv.split('\r\n').find(l => l.startsWith('6;'))).toContain(';neimportat: potrivire după poziția HG, neconfirmată')

    // al doilea import: rămâne doar rândul HG; cu bifa se importă
    tree = await previzualizeaza(h, p)
    expect(text(tree)).toContain('Noi (rânduri)1'); expect(text(tree)).toContain('Deja deținători3')
    expect(buton(tree, '📥').props.disabled).toBe(true)                            // doar HG, nebifat → nimic de scris
    expect(text(tree)).toContain('Rămân doar potriviri după poziția HG')
    bifaHg(tree).props.onChange({ target: { checked: true } })
    tree = h.render(ImportUtilizatori, p)
    expect(text(buton(tree, '📥'))).toBe('📥 Importă 1 utilizatori pe 1 parcele')
    await buton(tree, '📥').props.onClick()
    expect(confirm.mock.calls.at(-1)[0]).toMatch(/1 potriviți după poziția HG sunt INCLUȘI/)
    expect(scrisiUtil().map(d => d.parcela_id).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(bd.client.tabele.red_import_loturi).toHaveLength(2)

    // al treilea: 0 noi, toți cei scriși sunt „deja deținători”, nimic de scris
    tree = await previzualizeaza(h, p)
    expect(text(tree)).toContain('Noi (rânduri)0'); expect(text(tree)).toContain('Deja deținători4')
    expect(buton(tree, '📥')).toBeUndefined()
    expect(text(tree)).toContain('Nimic nou de importat.')
  })
})

describe('ImportUtilizatori — butonul de scriere', () => {
  it('fără previzualizare nu există; fără versiune e inactiv; viewer-ul nu îl vede (nici bifa HG)', async () => {
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
    expect(bifaHg(tree)).toBeUndefined()
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
    expect(scrisiUtil()).toHaveLength(2)
    expect(p.show.mock.calls.some(c => /încă rulează/.test(c[0]))).toBe(true)
  })
  it('reluare după un import întrerupt (utilizatori scriși, contacte lipsă): „Reia doar completarea” completează contactele; a doua oară NU creează lot', async () => {
    const scrisi = [
      { id: 'd-u1', parcela_id: 'p1', nume_normalizat: 'IONESCU ANA (FICTIV)', calitate: CALITATE_UTILIZATOR, sursa_date: `${SURSA_UTILIZATORI}: rândul 4` },
      { id: 'd-u2', parcela_id: 'p2', nume_normalizat: 'IONESCU ANA (FICTIV)', calitate: CALITATE_UTILIZATOR, sursa_date: `${SURSA_UTILIZATORI}: rândul 5` },
      { id: 'd-u3', parcela_id: 'p3', nume_normalizat: 'STEFANESCU TICU (FICTIV)', calitate: CALITATE_UTILIZATOR, sursa_date: `${SURSA_UTILIZATORI}: rândul 6` },
    ]
    bd.client = clientFals({ parcele: PARCELE(), detinatori: [...DETINATORI(), ...scrisi] })
    const confirm = vi.fn(() => true); vi.stubGlobal('window', { confirm })
    const h = harness(); const p = props()
    pregateste(h, p)
    let tree = await previzualizeaza(h, p)
    expect(buton(tree, '📥')).toBeUndefined()
    await buton(tree, 'Reia doar completarea contactelor').props.onClick()
    expect(confirm.mock.calls[0][0]).toMatch(/doar pentru completarea contactelor lipsă/)
    expect(bd.client.tabele.red_detinatori_contact.map(c => c.detinator_id).sort()).toEqual(['d-u1', 'd-u2', 'd-u3'])   // proprietarul (d-prop) neatins
    expect(bd.client.tabele.red_detinatori).toHaveLength(4)
    expect(bd.client.tabele.red_import_loturi).toHaveLength(1)
    expect(bd.client.tabele.red_import_loturi[0]).toMatchObject({ stare: 'finalizat', detinatori_noi: 0 })
    expect(text(h.render(ImportUtilizatori, p))).toContain('Contacte completate3')
    expect(p.onImportat).toHaveBeenCalledTimes(1)
    // r2 pct. 8: a doua completare, fără nimic de completat → niciun lot nou (pe 4f98f4a0: încă un lot)
    tree = await previzualizeaza(h, p)
    await buton(tree, 'Reia doar completarea contactelor').props.onClick()
    expect(bd.client.tabele.red_import_loturi).toHaveLength(1)
    expect(p.show.mock.calls.at(-1)).toEqual(['Nimic de completat: utilizatorii au deja contact. Nu s-a creat niciun lot.', 'info'])
    expect(p.onImportat).toHaveBeenCalledTimes(1)
  })
  it('renunțarea la confirmare nu scrie nimic', async () => {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI() })
    vi.stubGlobal('window', { confirm: () => false })
    const h = harness(); const p = props()
    pregateste(h, p)
    await buton(await previzualizeaza(h, p), '📥').props.onClick()
    expect(bd.client.jurnal).toEqual([])
    expect(buton(h.render(ImportUtilizatori, p), '📥').props.disabled).toBe(false)
  })
})

describe('ImportUtilizatori — r2 pct. 1c: alt import al proiectului în curs / recent', () => {
  const inCurs = { id: 'lot-altul', proiect_id: 'proiect-A', sursa: 'TGZ', stare: 'in_curs', versiune_lista_tgz: 'TGZ fictiv', created_at: '2020-01-01T00:00:00Z' }
  it('există un lot „in_curs” → a doua confirmare, explicită; refuzată = nimic scris; acceptată = scrie', async () => {
    for (const accepta of [false, true]) {
      bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), loturiExistente: [inCurs] })
      const raspunsuri = [true, accepta]
      const confirm = vi.fn(() => raspunsuri.shift()); vi.stubGlobal('window', { confirm })
      const h = harness(); const p = props()
      pregateste(h, p)
      await buton(await previzualizeaza(h, p), '📥').props.onClick()
      expect(confirm).toHaveBeenCalledTimes(2)
      expect(confirm.mock.calls[1][0]).toMatch(/^ATENȚIE: în TEST-A există 1 import\(uri\) în curs sau pornite în ultimele 15 minute:\n• 2020-01-01 00:00 · TGZ · in_curs/)
      expect(scrisiUtil()).toHaveLength(accepta ? 2 : 0)
      expect(bd.client.jurnal.some(j => j[0] === 'insert')).toBe(accepta)
    }
  })
  it('un lot pornit în ultimele minute (finalizat) contează și el; fără niciun lot recent = o singură confirmare', async () => {
    const recent = { id: 'lot-recent', proiect_id: 'proiect-A', sursa: SURSA_UTILIZATORI, stare: 'finalizat', versiune_lista_tgz: 'v', created_at: new Date(Date.now() - 60000).toISOString() }
    for (const [loturiExistente, nr] of [[[recent], 2], [[{ ...recent, created_at: '2020-01-01T00:00:00Z' }, { ...inCurs, proiect_id: 'proiect-B' }], 1]]) {
      bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), loturiExistente })
      const confirm = vi.fn(() => true); vi.stubGlobal('window', { confirm })
      const h = harness(); const p = props()
      pregateste(h, p)
      await buton(await previzualizeaza(h, p), '📥').props.onClick()
      expect(confirm).toHaveBeenCalledTimes(nr)
    }
  })
  it('citirea loturilor eșuează → importul NU pornește, eroarea e afișată (L18)', async () => {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), esueazaCitireLoturi: true })
    const confirm = vi.fn(() => true); vi.stubGlobal('window', { confirm })
    const h = harness(); const p = props()
    pregateste(h, p)
    await buton(await previzualizeaza(h, p), '📥').props.onClick()
    expect(confirm).not.toHaveBeenCalled()
    expect(bd.client.jurnal).toEqual([])
    expect(p.show.mock.calls.at(-1)).toEqual([expect.stringMatching(/Nu am putut verifica dacă rulează alt import în TEST-A: citire loturi refuzată.*Importul NU a pornit/), 'error'])
    expect(buton(h.render(ImportUtilizatori, p), '📥').props.disabled).toBe(false)
  })
})

describe('ImportUtilizatori — L18 / L05: eroarea scrierii, rezultatul nesigur, contacte parțiale', () => {
  it('INSERT refuzat (cod SQL) → „Import eșuat”, lotul eșuat citit din BD, nimic declarat scris, fără reîncărcare', async () => {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), esueazaDetinatori: { code: '42501', message: 'refuz simulat' } })
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const p = props()
    pregateste(h, p)
    await buton(await previzualizeaza(h, p), '📥').props.onClick()
    const tree = h.render(ImportUtilizatori, p)
    expect(elemente(tree, n => n.props?.['data-rezultat'] === 'esuat')).toHaveLength(1)
    expect(text(tree)).toMatch(/inserare utilizatori: refuz simulat/)
    expect(text(tree)).toContain('lot esuat')
    expect(text(tree)).toContain('Recitit din BD: 0 din 2 rânduri confirmate')
    expect(bd.client.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', detinatori_noi: 0 })
    expect(buton(tree, '📥')).toBeUndefined()                // planul vechi nu se mai poate trimite: se reface previzualizarea
    expect(buton(tree, '🔍').props.disabled).toBe(false)      // nu rămâne blocat „în lucru”
    expect(p.show.mock.calls.at(-1)[1]).toBe('error')
    expect(p.onImportat).not.toHaveBeenCalled()
  })
  it('r2 pct. 3: INSERT comis, răspuns pierdut → „Rezultat nesigur” cu ce s-a găsit în bază, modulul anunțat, raport descărcabil cu ID-urile', async () => {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), pierdeRaspuns: 'red_detinatori' })
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const p = props()
    pregateste(h, p)
    await buton(await previzualizeaza(h, p), '📥').props.onClick()
    const tree = h.render(ImportUtilizatori, p)
    expect(elemente(tree, n => n.props?.['data-rezultat'] === 'ambiguu')).toHaveLength(1)
    expect(text(tree)).toContain('Rezultat nesigur: nu știm sigur ce s-a scris — iată ce am găsit în bază')
    expect(text(tree)).toContain('Scriși de această operație2')
    expect(text(tree)).toContain('… din care contact lipsă2')
    expect(p.onImportat).toHaveBeenCalledTimes(1)                                   // pe 4f98f4a0: neapelat
    expect(bd.client.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', detinatori_noi: 2 })
    const blobs = capteazaDescarcari()
    buton(tree, '⬇ Raportul după scriere').props.onClick()
    const csv = await blobs[0].text()
    for (const d of scrisiUtil()) expect(csv).toContain(`;scris de această operație — contact lipsă;${d.id};nu`)
  })
  it('contacte parțial comise (a doua bucată de contacte refuzată) → eșuat; 200 cu contact, 1 „contact lipsă”; modulul anunțat', async () => {
    const N = 201
    const parcele = Array.from({ length: N }, (_, i) => ({ id: `q${String(i).padStart(3, '0')}`, proiect_id: 'proiect-A', cheie_sursa: `HUS|${100 + i}|${1000 + i}|`, id_parcela: `T1-HUS-${String(100 + i).padStart(4, '0')}`, poz_hg: String(100 + i), red_uat: { uat3: 'HUS' } }))
    const date = Array.from({ length: N }, (_, i) => rand({ hg: String(100 + i), cad: String(1000 + i), nume: `PERSOANA ${i} (fictiv)`, adresa: ADR }))
    bd.client = clientFals({ parcele, esueazaContacteLa: 2 })
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const p = props()
    pregateste(h, p, { fisier: fisierFals('mare.xlsx', xlsx(date)) })
    await buton(await previzualizeaza(h, p), '📥').props.onClick()
    const tree = h.render(ImportUtilizatori, p)
    expect(elemente(tree, n => n.props?.['data-rezultat'] === 'esuat')).toHaveLength(1)
    expect(scrisiUtil()).toHaveLength(N)
    expect(bd.client.tabele.red_detinatori_contact).toHaveLength(200)
    expect(text(tree)).toContain(`Scriși de această operație${N}`)
    expect(text(tree)).toContain('… din care contact lipsă1')
    expect(bd.client.tabele.red_import_loturi[0].diferente.contacte_scrise).toHaveLength(200)
    expect(p.onImportat).toHaveBeenCalledTimes(1)
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
      else expect(text(buton(tree, '📥'))).toBe('📥 Importă 2 utilizatori pe 2 parcele (fără potrivirile după HG: 1)')
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
  it('r2: proiectul schimbat în timpul SCRIERII, componenta încă montată → scrierea se termină pentru A, rezultatul nu apare în B', async () => {
    const poarta = amanat()
    const ctrl = { promisiune: null }
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), poartaCitire: ctrl })
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const pA = props('proiect-A')
    pregateste(h, pA)
    const b = buton(await previzualizeaza(h, pA), '📥')
    ctrl.promisiune = poarta.promisiune                       // scrierea se oprește la recitirea parcelelor (înaintea primei bucăți)
    const gata = b.props.onClick()
    await asteapta(); await asteapta()
    const pB = props('proiect-B', { show: pA.show, onImportat: pA.onImportat })
    h.render(ImportUtilizatori, pB)                            // aceeași instanță, alt proiect
    poarta.rezolva(); await gata
    const tree = h.render(ImportUtilizatori, pB)
    expect(scrisiUtil()).toHaveLength(2)                       // scrierea lui A s-a terminat (proiectul capturat)
    expect(elemente(tree, n => n.props?.['data-rezultat'])).toHaveLength(0)
    expect(text(tree)).not.toContain('Previzualizare')
    expect(pA.show.mock.calls.at(-1)[0]).toMatch(/Importul utilizatorilor în TEST-A s-a terminat/)
    expect(pA.onImportat).not.toHaveBeenCalled()               // B nu primește semnalul lui A
    expect(buton(tree, '🔍').props.disabled).toBe(true)        // B: fără fișier, dar nu „în lucru” din cauza lui A
    expect(text(buton(tree, '🔍'))).toBe('🔍 2. Citește și previzualizează')
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
    await asteapta(); await asteapta()
    h.unmount()
    poarta.rezolva(); await gata
    expect(p.onImportat).not.toHaveBeenCalled()
    expect(p.show.mock.calls.at(-1)[0]).toMatch(/Importul utilizatorilor în TEST-A s-a terminat/)
  })
})

describe('ImportUtilizatori — r2 pct. 7: anularea pe lot (owner)', () => {
  async function importa(extra = {}) {
    bd.client = clientFals({ parcele: PARCELE(), detinatori: DETINATORI(), ...extra })
    vi.stubGlobal('window', { confirm: () => true })
    const h = harness(); const p = props('proiect-A', { profile: { id: 'owner-fictiv', is_owner: true } })
    pregateste(h, p)
    await buton(await previzualizeaza(h, p), '📥').props.onClick()
    await buton(h.render(ImportUtilizatori, p), 'Arată loturile').props.onClick()
    return { h, p, lotId: bd.client.tabele.red_import_loturi[0].id }
  }
  it('previzualizare (cine se poate / cine rămâne) → motiv → confirmare → ștergere logică exactă; reluarea nu dublează nimic', async () => {
    const { h, p, lotId } = await importa()
    const [dA, dB] = scrisiUtil().sort((a, b) => a.parcela_id.localeCompare(b.parcela_id))   // p1, p2
    bd.client.tabele.red_convocari.push({ id: 'cv1', detinator_id: dB.id })                 // dB are deja convocare → rămâne
    let tree = h.render(ImportUtilizatori, p)
    await buton(tree, 'Anulează importul').props.onClick()
    tree = h.render(ImportUtilizatori, p)
    const sect = elemente(tree, n => n.props?.['data-sectiune'] === 'anulare')
    expect(text(sect)).toContain('Se pot anula1'); expect(text(sect)).toContain('Rămân (urme / modificați)1')
    expect(text(sect)).toContain('are convocare (inclusiv anulată sau în plic)')
    const bAnul = buton(tree, 'Anulează 1 utilizatori')
    expect(bAnul.props.disabled).toBe(true)                                                  // fără motiv
    elemente(tree, n => n.type === 'textarea')[0].props.onChange({ target: { value: 'import de probă, fictiv' } })
    tree = h.render(ImportUtilizatori, p)
    expect(buton(tree, 'Anulează 1 utilizatori').props.disabled).toBe(false)
    const confirm = vi.fn(() => true); vi.stubGlobal('window', { confirm })
    const unu = buton(tree, 'Anulează 1 utilizatori').props.onClick(), doi = buton(tree, 'Anulează 1 utilizatori').props.onClick()
    await Promise.all([unu, doi])
    expect(confirm).toHaveBeenCalledTimes(1)                                                 // L05: o singură anulare
    expect(dA).toMatchObject({ sters_de: 'owner-fictiv', sters_motiv: `Anulare import utilizatori (lot ${lotId}): import de probă, fictiv` })
    expect(dA.sters_la).toBeTruthy(); expect(dB.sters_la).toBeNull()
    expect(bd.client.jurnal.filter(j => j[0] === 'update' && j[1] === 'red_detinatori')).toEqual([['update', 'red_detinatori', 1]])
    const lot = bd.client.tabele.red_import_loturi[0]
    expect(lot.diferente.anulari).toHaveLength(1)
    expect(lot.diferente.anulari[0]).toMatchObject({ anulati: [dA.id], raman: [{ id: dB.id }], motiv: 'import de probă, fictiv', de: 'owner-fictiv' })
    tree = h.render(ImportUtilizatori, p)
    expect(text(elemente(tree, n => n.props?.['data-rezultat-anulare'] === '1'))).toContain('Anulați acum1')
    expect(p.onImportat).toHaveBeenCalledTimes(2)                                            // import + anulare
    // reluare: nimic nou de anulat, cel anulat apare „deja anulat”
    await buton(tree, '↻ Verifică din nou').props.onClick()
    tree = h.render(ImportUtilizatori, p)
    expect(text(elemente(tree, n => n.props?.['data-sectiune'] === 'anulare'))).toContain('Deja anulați / șterși1')
    expect(buton(tree, 'Anulează 0 utilizatori').props.disabled).toBe(true)
  })
  it('modificat de un om după import / contact schimbat / PV B după import → rămâne; non-owner nu vede butonul', async () => {
    const { h, p } = await importa()
    const [dA, dB] = scrisiUtil().sort((a, b) => a.parcela_id.localeCompare(b.parcela_id))
    dA.updated_at = '2026-11-18T09:00:00'                                                    // editat în Fișa parcelei
    bd.client.tabele.red_procese_verbale.push({ id: 'pvb', parcela_id: 'p2', tip: 'B', created_at: '2099-01-01' })
    await buton(h.render(ImportUtilizatori, p), 'Anulează importul').props.onClick()
    const sect = text(elemente(h.render(ImportUtilizatori, p), n => n.props?.['data-sectiune'] === 'anulare'))
    expect(sect).toContain('Se pot anula0')
    expect(sect).toContain('modificat după import'); expect(sect).toContain('parcela are PV B generat după import')
    expect(dB.sters_la).toBeNull()
    const hv = harness(); const pv = props('proiect-A', { profile: { id: 'editor-fictiv', is_owner: false } })
    pregateste(hv, pv)
    await buton(hv.render(ImportUtilizatori, pv), 'Arată loturile').props.onClick()
    expect(buton(hv.render(ImportUtilizatori, pv), 'Anulează importul')).toBeUndefined()
  })
  it('executaAnulare: un rând modificat între previzualizare și execuție NU se anulează (CAS pe updated_at); motiv scurt = refuz', async () => {
    const { lotId } = await importa()
    const [dA, dB] = scrisiUtil().sort((a, b) => a.parcela_id.localeCompare(b.parcela_id))
    const aratat = await pregatesteAnulare(bd.client, { proiectId: 'proiect-A', lotId })
    expect(aratat.anulabili.map(a => a.id).sort()).toEqual([dA.id, dB.id].sort())
    await expect(executaAnulare(bd.client, { proiectId: 'proiect-A', lotId, aratat, motiv: 'abc' })).rejects.toThrow(/minim 5/)
    dB.updated_at = 'modificat-intre-timp'
    const r = await executaAnulare(bd.client, { proiectId: 'proiect-A', lotId, aratat, motiv: 'probă fictivă', profilId: 'o' })
    expect(r.anulati.map(a => a.id)).toEqual([dA.id])
    expect(r.raman.find(x => x.id === dB.id).motive.join()).toMatch(/modificat după import/)
    expect(dB.sters_la).toBeNull()
  })
})
