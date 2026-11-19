// Runda 2 pe PR #1136 (verdictul Jakarinos pe ccbf456e): ecranul „Trimite la curier” montat REAL (react-dom în jsdom, localStorage-ul paginii).
// P1 #1 — registrul local al intenției NU se șterge pe dovezi vechi: după un răspuns ambiguu (503 după o comandă scrisă în BD), lista `intentii` e cea
//   citită ÎNAINTEA apăsării (fără cheia nouă), iar recitirea exactă a cheii din BD vine cu întârziere; intrarea trebuie să rămână și „Reia trimiterea”
//   să fie vizibil. Și: un răspuns „încheiat” al funcției edge nu e crezut dacă BD-ul arată cheia în curs (P1 #2 văzut din ecran).
// P2 #3 — foile AWB și pagina de control NU se descarcă după invalidarea acțiunii (lotul schimbat / ecranul închis cât răspundea funcția edge sau cât se
//   construia pagina de control).
// Fiecare regulă are mutantul ei pe sursa componentei (copiată în src/redari/ui/.tmp/, ignorat de git): testul TREBUIE să pice pe mutant.
// jsdom nu e dependență a proiectului: se caută în node_modules sau în REDARI_JSDOM_DIR; fără el suita e SĂRITĂ vizibil.
import React from 'react'
import { afterAll, describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/supabase.js', () => ({ supabase: {} }))   // comune.jsx îl importă; secțiunea nu-l folosește (totul vine prin props)
import { createRequire } from 'node:module'
import path from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { webcrypto } from 'node:crypto'
import { pregatestePlicuriFan } from '../../../supabase/functions/_shared/redariFan.mjs'
import { PREFIX_REGISTRU_FAN } from '../fanLot.js'

let JSDOM = null
for (const s of [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)) {
  try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ }
}
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[fanTrimitereDom.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

// ── mutanții: sursa componentei, cu importurile relative mutate cu un nivel (fișierul stă în ui/.tmp/) ──
const SURSA = readFileSync('src/redari/ui/FanTrimitere.jsx', 'utf8')
const DIR = path.join(process.cwd(), 'src', 'redari', 'ui', '.tmp')
const adapteaza = t => t.replace("from './comune.jsx'", "from '../comune.jsx'").replace("from '../fanLot.js'", "from '../../fanLot.js'").replace("from '../docx.js'", "from '../../docx.js'")
let nrMutant = 0
const fisiere = []
afterAll(() => { for (const f of fisiere) rmSync(f, { force: true }) })
async function componenta(perechi) {
  if (!perechi) return (await import('./FanTrimitere.jsx')).default
  let t = SURSA
  for (const [din, in_] of perechi) {
    if (t.split(din).length !== 2) throw new Error(`mutația nu se aplică exact o dată: ${din}`)
    t = t.replace(din, in_)
  }
  mkdirSync(DIR, { recursive: true })
  const f = path.join(DIR, `fan_trimitere_mutant_${process.pid}_${++nrMutant}.jsx`)
  writeFileSync(f, adapteaza(t)); fisiere.push(f)
  return (await import(/* @vite-ignore */ pathToFileURL(f).href)).default
}
const MUTANTI = {
  // P1 #1: absența din lista citită înaintea apăsării socotită dovadă (comportamentul de pe ccbf456e)
  snapshotVechi: [["deciziaIntentiei(e, intentii.find(i => i.cheie === e.cheie) || null, Date.now(), intentiiCititeLa) === 'sterge'", "deciziaIntentiei(e, intentii.find(i => i.cheie === e.cheie) || null, Date.now(), Date.now() + 36e5) === 'sterge'"]],
  // P1 #1 / #2: răspunsul funcției edge crezut fără citirea cheii din BD
  raspunsCrezut: [["if (decizieDupaApel({ intrare, corp, dinBd, cititLaMs: cititLa }) === 'sterge') reg.sterge(cheie)", "if (corp?.cod === 'ok' && corp.incheiata === true) reg.sterge(cheie)"]],
  // P2 #3: descărcarea fără garda generației (după răspunsul funcției edge)
  faraGardaDupaEdge: [["    if (!curent()) return OPRIT   // L24 (Jakarinos #1136 r1 P2): după răspuns, înaintea rezultatului și a oricărei descărcări", ''],
    ["    if (!curent()) return `\\n${OPRIT} Foile AWB nu s-au descărcat aici: „Descarcă AWB-urile” pe lotul lor.`", '']],
  // P2 #3: pagina de control descărcată fără reverificarea generației după construirea ei (pas asincron)
  faraGardaDupaControl: [["    if (!curent()) return `\\n${OPRIT} Pagina de control nu s-a descărcat: „Descarcă AWB-urile” o aduce din nou.`", '']],
}

const LOT = { id: '11111111-2222-4333-8444-555555555555', nr_lot: 'PP-0001' }
const contact = { telefon: '0700 000 001', adresa_strada: 'Str. Fictivă nr. 1', adresa_sat: 'Sat Fictiv', adresa_comuna: 'Comuna Fictivă', adresa_judet: 'Prahova', cod_postal: '100000' }
async function pregatite() {
  const plicuri = [1, 2].map(i => ({ id: `30000000-0000-4000-8000-00000000000${i}`, nr_plic: `PL-TST-000${i}`, destinatar_nume: 'PERSOANA FICTIVA', stare: 'activ' }))
  return pregatestePlicuriFan({ plicuri, convocari: plicuri.map((p, i) => ({ id: `c${i}`, plic_id: p.id, detinator_id: `d${i}` })), contacte: plicuri.map((p, i) => ({ detinator_id: `d${i}`, ...contact })),
    proiectCod: 'TEST-RAZVAN', subtle: webcrypto.subtle })
}
const PDF = Buffer.from('%PDF-1.4\n% fictiv').toString('base64')
const inCurs = (cheie, o = {}) => ({ data: { cheie, lot_id: LOT.id, stare: 'in_curs', necunoscute: 0, ramase: 2, lucru_pana_la: new Date(Date.now() + 9 * 60000).toISOString(), inceput_la: new Date().toISOString(), ...o }, error: null })

/**
 * Montează secțiunea, apasă „Trimite la curier” și așteaptă mesajul. corp = răspunsul funcției edge; citire(cheie) = răspunsul citirii EXACTE a cheii,
 * venit după `intarziereMs`; invalideaza: 'edge' (lotul schimbat cât răspunde funcția edge) / 'control' (cât se construiește pagina de control).
 * Lista `intentii` e cea citită ÎNAINTEA apăsării (fără cheia nouă), cu momentul citirii în trecut — ca în ecranul real.
 */
async function apasa({ Comp, corp, citire, intarziereMs = 30, invalideaza = null }) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true, url: 'http://localhost/' })
  const vechi = { window: globalThis.window, document: globalThis.document, ls: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), cou: URL.createObjectURL, rou: URL.revokeObjectURL }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  Object.defineProperty(globalThis, 'localStorage', { value: j.window.localStorage, configurable: true, writable: true })
  const descarcate = []
  URL.createObjectURL = vi.fn(() => 'blob:fictiv'); URL.revokeObjectURL = vi.fn()
  j.window.HTMLAnchorElement.prototype.click = function () { descarcate.push(this.download) }
  j.window.confirm = () => true
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  const root = createRoot(j.window.document.getElementById('r'))
  // curățenia: la ieșirea din FIECARE montare (mai multe montări într-un test nu trebuie să împartă globalele window / document)
  const restaureaza = () => { Object.assign(globalThis, { window: vechi.window, document: vechi.document }); URL.createObjectURL = vechi.cou; URL.revokeObjectURL = vechi.rou
    if (vechi.ls) Object.defineProperty(globalThis, 'localStorage', vechi.ls); else delete globalThis.localStorage }
  try {
  let gen = 0
  const mesaje = [], ordine = []
  // garda părintelui (FanAwbPrevizualizare.ruleaza): generația de la pornire; „invalidarea” = generația crește (lot schimbat / ecran închis)
  const ruleaza = async fn => { const t = gen; const curent = () => gen === t; try { mesaje.push(await fn(curent)) } catch (e) { mesaje.push('EROARE ' + e.message) } }
  const edge = vi.fn(async (actiune, extra) => { ordine.push('edge:' + actiune); await new Promise(r => setTimeout(r, 5)); if (invalideaza === 'edge') gen++; ordine.push('edge-raspuns'); return { corp: typeof corp === 'function' ? corp(extra) : corp, mesaj: '' } })
  const citesteIntentie = vi.fn(async cheie => { ordine.push('citire'); await new Promise(r => setTimeout(r, intarziereMs)); return typeof citire === 'function' ? citire(cheie) : citire })
  const controlDocx = vi.fn(async () => { await new Promise(r => setTimeout(r, 5)); if (invalideaza === 'control') gen++; return new j.window.Blob(['control']) })
  const props = { proiect: { cod: 'TEST-RAZVAN' }, lot: LOT, fanLot: { lot_id: LOT.id, test: true, opod: false }, pregatite: await pregatite(), awb: [], esteOwner: false, esteOperator: true,
    evidentaInstalata: true, opodInstalat: true, plafon: { limita_zi: 20, aprobate: 0, incap: 20 }, intentii: [], intentiiCititeLa: Date.now() - 60000, cereri: [],
    lucru: false, ruleaza, edge, citesteIntentie, rpc: async () => ({}), controlDocx }
  await act(async () => { root.render(<Comp {...props} />) })
  const d = j.window.document
  const buton = [...d.querySelectorAll('button')].find(b => b.textContent.startsWith('Trimite la curier'))
  expect(buton, 'butonul Trimite la curier').toBeTruthy(); expect(buton.disabled).toBe(false)
  await act(async () => { buton.click() })
  for (let i = 0; i < 100 && !mesaje.length; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  // re-randarea părintelui cu ACEEAȘI listă veche (recitirea evidenței încă neterminată): efectul de lămurire rulează din nou pe ea
  await act(async () => { root.render(<Comp {...props} />) })
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  const cheie = edge.mock.calls[0]?.[1]?.intentie
  const inRegistru = !!cheie && j.window.localStorage.getItem(PREFIX_REGISTRU_FAN + cheie) !== null
  const rez = { cheie, inRegistru, mesaj: mesaje[0], ordine, descarcate, text: d.body.textContent, citesteIntentie, controlDocx }
  await act(async () => { root.unmount() })
  return rez
  } finally { restaureaza() }
}

dom(JSDOM ? 'Trimite la curier montat (jsdom): registrul local și descărcările (Jakarinos #1136 r1)' : `Trimite la curier DOM — ${MOTIV_SARIT}`, () => {
  // regulile, ca funcții pe un rezultat — rulate pe componenta reală (trebuie să treacă) și pe mutanți (trebuie să pice)
  const R = {
    // P1 #1, scenariul recenzentului: 503 după comandă + listă veche + recitire întârziată → intrarea rămâne, „Reia trimiterea” vizibil
    async ambiguuCuRecitireIntarziata(Comp) {
      const r = await apasa({ Comp, corp: { cod: 'comanda_neconfirmata', cod_bd: null }, citire: cheie => inCurs(cheie, { lucru_pana_la: new Date(Date.now() - 1000).toISOString() }), intarziereMs: 60 })
      return r.inRegistru && /Reia trimiterea/.test(r.text) && r.ordine.indexOf('citire') > r.ordine.indexOf('edge-raspuns') && r.citesteIntentie.mock.calls[0][0] === r.cheie
    },
    // răspuns ambiguu și cheia ABSENTĂ în citirea de după (cererea poate fi încă în zbor) → rămâne
    async ambiguuCheieAbsenta(Comp) { return (await apasa({ Comp, corp: { cod: 'comanda_neconfirmata' }, citire: { data: null, error: null } })).inRegistru },
    // citirea cheii a picat → nimic dovedit, rămâne
    async citireEsuata(Comp) { return (await apasa({ Comp, corp: { cod: 'ok', incheiata: true, nimic_de_trimis: true }, citire: { data: null, error: { code: '500' } } })).inRegistru },
    // P1 #2 văzut din ecran: funcția edge spune „încheiat”, BD-ul arată cheia în curs → rămâne
    async incheiatDarInCursInBd(Comp) { return (await apasa({ Comp, corp: { cod: 'ok', incheiata: true, nimic_de_trimis: true, generate: 0 }, citire: cheie => inCurs(cheie) })).inRegistru },
    // căile legitime: încheiată în BD → iese; refuz determinist + cheie absentă → iese
    async incheiataInBdIese(Comp) { return !(await apasa({ Comp, corp: { cod: 'ok', incheiata: true, generate: 0, nimic_de_trimis: true }, citire: cheie => ({ data: { ...inCurs(cheie).data, stare: 'incheiata' }, error: null }) })).inRegistru },
    async refuzDeterministIese(Comp) { return !(await apasa({ Comp, corp: { cod: 'cerere_invalida' }, citire: { data: null, error: null } })).inRegistru },
    // P2 #3: lotul schimbat cât răspundea funcția edge → nicio foaie, nicio pagină de control
    async invalidatLaEdge(Comp) {
      const r = await apasa({ Comp, corp: { cod: 'ok', incheiata: true, generate: 2, pdf_parti: [PDF], tiraj: { id: 'ABCD1234', nr: 1, cheie: 'c'.repeat(64), inceput_la: '2026-11-19T10:00:00Z' }, manifest_cheie: 'm' },
        citire: cheie => ({ data: { ...inCurs(cheie).data, stare: 'incheiata' }, error: null }), invalideaza: 'edge' })
      return r.descarcate.length === 0 && r.controlDocx.mock.calls.length === 0 && /^Oprit/.test(r.mesaj || '')
    },
    // P2 #3: invalidat cât se construia pagina de control → foaia AWB (descărcată înainte) da, pagina de control NU
    async invalidatLaControl(Comp) {
      const r = await apasa({ Comp, corp: { cod: 'ok', incheiata: true, generate: 2, pdf_parti: [PDF], tiraj: { id: 'ABCD1234', nr: 1, cheie: 'c'.repeat(64), inceput_la: '2026-11-19T10:00:00Z' }, manifest_cheie: 'm' },
        citire: cheie => ({ data: { ...inCurs(cheie).data, stare: 'incheiata' }, error: null }), invalideaza: 'control' })
      return r.descarcate.length === 1 && /_etichete/.test(r.descarcate[0]) && /Pagina de control nu s-a descărcat/.test(r.mesaj || '')
    },
    // martorul: fără invalidare, foaia + pagina de control se descarcă
    async faraInvalidareDescarca(Comp) {
      const r = await apasa({ Comp, corp: { cod: 'ok', incheiata: true, generate: 2, pdf_parti: [PDF], tiraj: { id: 'ABCD1234', nr: 1, cheie: 'c'.repeat(64), inceput_la: '2026-11-19T10:00:00Z' }, manifest_cheie: 'm' },
        citire: cheie => ({ data: { ...inCurs(cheie).data, stare: 'incheiata' }, error: null }) })
      return r.descarcate.length === 2 && !r.inRegistru
    },
  }
  it('componenta reală respectă TOATE regulile (P1 #1, P1 #2 din ecran, căile legitime, P2 #3, martorul)', async () => {
    const Comp = await componenta(null)
    const rez = {}
    for (const [n, f] of Object.entries(R)) rez[n] = await f(Comp)
    expect(rez).toEqual(Object.fromEntries(Object.keys(R).map(n => [n, true])))
  })
  it.each([
    ['snapshotVechi', 'ambiguuCuRecitireIntarziata'], ['snapshotVechi', 'ambiguuCheieAbsenta'],
    ['raspunsCrezut', 'incheiatDarInCursInBd'], ['raspunsCrezut', 'citireEsuata'],
    ['faraGardaDupaEdge', 'invalidatLaEdge'], ['faraGardaDupaControl', 'invalidatLaControl'],
  ])('mutantul „%s” e prins de regula „%s”', async (mutant, regula) => {
    const Comp = await componenta(MUTANTI[mutant])
    expect(await R[regula](Comp)).toBe(false)
  })
})
