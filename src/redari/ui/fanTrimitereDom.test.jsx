// Runda 2 pe PR #1136 (verdictul Jakarinos pe ccbf456e): ecranul „Trimite la curier” montat REAL (react-dom în jsdom, localStorage-ul paginii).
// P1 #1 — registrul local al intenției NU se șterge pe dovezi vechi: după un răspuns ambiguu (503 după o comandă scrisă în BD), lista `intentii` e cea
//   citită ÎNAINTEA apăsării (fără cheia nouă), iar recitirea exactă a cheii din BD vine cu întârziere; intrarea trebuie să rămână și „Reia trimiterea”
//   să fie vizibil. Și: un răspuns „încheiat” al funcției edge nu e crezut dacă BD-ul arată cheia în curs (P1 #2 văzut din ecran).
// P2 #3 — foile AWB și pagina de control NU se descarcă după invalidarea acțiunii (lotul schimbat / ecranul închis cât răspundea funcția edge sau cât se
//   construia pagina de control).
// Runda 3 (verdictul Jakarinos pe 1126875c, P1 rămas): „Reia” cu răspunsul SUSPENDAT + o listă proaspătă fără cheie → curățarea nu folosește copia
//   memorată a intrării (apasat_la vechi) și nu atinge o cheie cu apel în curs; pagina închisă înaintea răspunsului lasă cheia în registru. Și: lista
//   citită cât apelul era în zbor nu dovedește absența nici după răspuns (terminat_la); un apel vechi nu lămurește o apăsare mai nouă din alt tab.
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
import { PREFIX_REGISTRU_FAN, registruIntentii } from '../fanLot.js'

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
  snapshotVechi: [['Date.now(), intentiiCititeLa, APELURI_FAN_IN_CURS)) sterse++', 'Date.now(), Date.now() + 36e5, APELURI_FAN_IN_CURS)) sterse++']],
  // P1 #1 / #2: răspunsul funcției edge crezut fără citirea cheii din BD
  raspunsCrezut: [["else if (curenta.apasat_la === intrare?.apasat_la && decizieDupaApel({ intrare: curenta, corp, dinBd, cititLaMs: cititLa }) === 'sterge') reg.sterge(cheie)", "else if (corp?.cod === 'ok' && corp.incheiata === true) reg.sterge(cheie)"]],
  // P2 #3: descărcarea fără garda generației (după răspunsul funcției edge)
  faraGardaDupaEdge: [["    if (!curent()) return OPRIT   // L24 (Jakarinos #1136 r1 P2): după răspuns, înaintea rezultatului și a oricărei descărcări", ''],
    ["    if (!curent()) return `\\n${OPRIT} Foile AWB nu s-au descărcat aici: „Descarcă AWB-urile” pe lotul lor.`", '']],
  // P2 #3: pagina de control descărcată fără reverificarea generației după construirea ei (pas asincron)
  faraGardaDupaControl: [["    if (!curent()) return `\\n${OPRIT} Pagina de control nu s-a descărcat: „Descarcă AWB-urile” o aduce din nou.`", '']],
  // runda 3 (Jakarinos r2 P1): forma de pe 1126875c — efectul decide pe copia memorată `locale`, iar „Reia” nu o împrospătează
  forma1126875c: [["for (const e of locale) if (stergeDacaLamurita(reg, e.cheie, intentii.find(i => i.cheie === e.cheie) || null, Date.now(), intentiiCititeLa, APELURI_FAN_IN_CURS)) sterse++",
    "for (const e of locale) if (deciziaIntentiei(e, intentii.find(i => i.cheie === e.cheie) || null, Date.now(), intentiiCititeLa) === 'sterge') { reg.sterge(e.cheie); sterse++ }"],
    ['      setTick(t => t + 1)   // ecranul afișează apăsarea nouă (nu copia memorată)', '']],
  // r2 P1: intrarea recitită, dar fără garda apelului în curs (un apel ținut peste arendă)
  faraGardaInCurs: [['Date.now(), intentiiCititeLa, APELURI_FAN_IN_CURS)) sterse++', 'Date.now(), intentiiCititeLa, null)) sterse++']],
  // r2 P1: sfârșitul apelului nenotat (o listă citită cât apelul era în zbor socotită dovadă după răspuns)
  faraTerminat: [['      if (intrare) reg.termina(cheie)   // fără efect dacă intrarea a ieșit (nu o recreează)', '']],
  // r2 P1: răspunsul unui apel mai vechi lămurește intrarea deși alt tab a apăsat între timp cu aceeași cheie
  faraApasareNoua: [['else if (curenta.apasat_la === intrare?.apasat_la && decizieDupaApel(', 'else if (decizieDupaApel(']],
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

/**
 * Runda 3 (Jakarinos #1136 r2 P1), reproducerea recenzentului: lista inițială citită acum 21 de minute, intrarea locală pornită acum 20 de minute (fără
 * răspuns de atunci); „Reia trimiterea” scrie apasat_la = acum, iar răspunsul funcției edge rămâne SUSPENDAT. Ceasul (doar Date) e fix: T0 = apăsarea.
 * listaLaMin = minutul (față de T0) la care sosește o listă `intentii` PROASPĂTĂ fără cheie (citirea ei pornește atunci); altTabLaMin = alt tab apasă cu
 * aceeași cheie cât apelul e în zbor; raspuns = { laMin, corp, citire } (lipsă = răspunsul se pierde: pagina se închide înainte); listaDupaMin = o listă
 * fără cheie citită după răspuns. Întoarce prezența cheii în registru în fiecare fază.
 */
const T0 = Date.parse('2026-11-20T10:00:00.000Z')
async function reiaInZbor({ Comp, listaLaMin, altTabLaMin = null, raspuns = null, listaDupaMin = null }) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0)
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true, url: 'http://localhost/' })
  const vechi = { window: globalThis.window, document: globalThis.document, ls: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  Object.defineProperty(globalThis, 'localStorage', { value: j.window.localStorage, configurable: true, writable: true })
  j.window.confirm = () => true
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const restaureaza = () => { Object.assign(globalThis, { window: vechi.window, document: vechi.document })
    if (vechi.ls) Object.defineProperty(globalThis, 'localStorage', vechi.ls); else delete globalThis.localStorage; vi.useRealTimers() }
  try {
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const asteapta = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
    const ls = j.window.localStorage, reg = registruIntentii(ls)
    const cheie = webcrypto.randomUUID()   // cheie nouă la fiecare montare: un apel lăsat suspendat nu atinge alt scenariu
    const prg = await pregatite(), plicIds = prg.map(p => p.plic.id)
    const minIso = m => new Date(T0 + m * 60000).toISOString()
    expect(reg.scrie(cheie, { lot_id: LOT.id, plic_ids: plicIds, hash_cerere: 'a'.repeat(64), inceput_la: minIso(-20), apasat_la: minIso(-20) })).toBe(true)
    const inRegistru = () => ls.getItem(PREFIX_REGISTRU_FAN + cheie) !== null
    const mesaje = []
    const ruleaza = async fn => { try { mesaje.push(await fn(() => true)) } catch (e) { mesaje.push('EROARE ' + e.message) } }
    let elibereaza = null
    const edge = vi.fn(() => new Promise(r => { elibereaza = r }))
    const citesteIntentie = vi.fn(async () => { await new Promise(r => setTimeout(r, 5)); return raspuns?.citire })
    const props = { proiect: { cod: 'TEST-RAZVAN' }, lot: LOT, fanLot: { lot_id: LOT.id, test: true, opod: false }, pregatite: prg, awb: [], esteOwner: false, esteOperator: true,
      evidentaInstalata: true, opodInstalat: true, plafon: { limita_zi: 20, aprobate: 0, incap: 20 }, intentii: [], intentiiCititeLa: T0 - 21 * 60000, cereri: [],
      lucru: false, ruleaza, edge, citesteIntentie, rpc: async () => ({}), controlDocx: async () => null }
    const root = createRoot(j.window.document.getElementById('r'))
    await act(async () => { root.render(<Comp {...props} />) }); await asteapta()
    const rez = { initial: inRegistru() }
    const buton = [...j.window.document.querySelectorAll('button')].find(b => b.textContent === 'Reia trimiterea')
    expect(buton, 'butonul Reia trimiterea').toBeTruthy()
    await act(async () => { buton.click() })
    for (let i = 0; i < 100 && !edge.mock.calls.length; i++) await asteapta(1)
    rez.edgeCheie = edge.mock.calls[0]?.[1]?.intentie === cheie
    rez.apasatNou = reg.citeste(cheie)?.apasat_la === minIso(0)
    if (altTabLaMin !== null) { vi.setSystemTime(T0 + altTabLaMin * 60000); expect(registruIntentii(ls).apasa(cheie)).toBe(true) }
    // lista proaspătă, fără cheie, cât apelul e în zbor
    vi.setSystemTime(T0 + listaLaMin * 60000)
    await act(async () => { root.render(<Comp {...props} intentii={[]} intentiiCititeLa={Date.now()} />) }); await asteapta()
    rez.inZbor = inRegistru()
    if (raspuns) {
      vi.setSystemTime(T0 + raspuns.laMin * 60000)
      await act(async () => { elibereaza({ corp: raspuns.corp, mesaj: '' }) })
      for (let i = 0; i < 100 && !mesaje.length; i++) await asteapta(1)
      await asteapta()
      rez.dupaRaspuns = inRegistru()
      // aceeași listă (citită în timpul apelului) re-randată după răspuns
      await act(async () => { root.render(<Comp {...props} intentii={[]} intentiiCititeLa={T0 + listaLaMin * 60000} />) }); await asteapta()
      rez.listaDinZborDupaRaspuns = inRegistru()
      if (listaDupaMin !== null) {
        vi.setSystemTime(T0 + listaDupaMin * 60000)
        await act(async () => { root.render(<Comp {...props} intentii={[]} intentiiCititeLa={Date.now()} />) }); await asteapta()
        rez.listaDupa = inRegistru()
      }
    }
    // pagina se închide (fără răspuns, dacă `raspuns` lipsește)
    await act(async () => { root.unmount() })
    rez.dupaInchidere = inRegistru()
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
    // ── runda 3 (Jakarinos r2 P1): „Reia” cu răspunsul suspendat ──
    // reproducerea: listă PROASPĂTĂ fără cheie în timpul reluării → cheia rămâne; pagina închisă înaintea răspunsului → cheia tot acolo
    async reiaListaProaspataInZbor(Comp) {
      const r = await reiaInZbor({ Comp, listaLaMin: 0.5 })
      return r.initial && r.edgeCheie && r.apasatNou && r.inZbor && r.dupaInchidere
    },
    // apelul ținut peste arendă: o listă citită la 11 minute după apăsare, fără cheie, cât apelul e încă în zbor → cheia rămâne
    async reiaPesteArendaInZbor(Comp) { const r = await reiaInZbor({ Comp, listaLaMin: 11 }); return r.inZbor && r.dupaInchidere },
    // după răspuns (ambiguu, recitirea picată): lista citită CÂT apelul era în zbor nu dovedește absența (apelul putea scrie după ea)
    async listaDinZborDupaRaspuns(Comp) {
      const r = await reiaInZbor({ Comp, listaLaMin: 11, raspuns: { laMin: 12, corp: { cod: 'comanda_neconfirmata' }, citire: { data: null, error: { code: '500' } } } })
      return r.inZbor && r.dupaRaspuns && r.listaDinZborDupaRaspuns && r.dupaInchidere
    },
    // calea legitimă: o listă fără cheie citită DUPĂ sfârșitul apelului și după arendă → intrarea iese
    async listaDupaSfarsitIese(Comp) {
      const r = await reiaInZbor({ Comp, listaLaMin: 11, raspuns: { laMin: 12, corp: { cod: 'comanda_neconfirmata' }, citire: { data: null, error: { code: '500' } } }, listaDupaMin: 13 })
      return r.dupaRaspuns && r.listaDinZborDupaRaspuns && r.listaDupa === false
    },
    // alt tab apasă cu aceeași cheie cât apelul nostru e în zbor; refuzul determinist al apelului NOSTRU nu lămurește apăsarea lui → rămâne
    async altTabApasaInZbor(Comp) {
      const r = await reiaInZbor({ Comp, listaLaMin: 0.6, altTabLaMin: 0.5, raspuns: { laMin: 1, corp: { cod: 'cerere_invalida' }, citire: { data: null, error: null } } })
      return r.inZbor && r.dupaRaspuns && r.dupaInchidere
    },
    // martorul lui: fără alt tab, același refuz determinist + cheie absentă → iese (și la „Reia”)
    async reiaRefuzDeterministIese(Comp) {
      const r = await reiaInZbor({ Comp, listaLaMin: 0.6, raspuns: { laMin: 1, corp: { cod: 'cerere_invalida' }, citire: { data: null, error: null } } })
      return r.inZbor && r.dupaRaspuns === false
    },
  }
  it('componenta reală respectă TOATE regulile (P1 #1, P1 #2 din ecran, căile legitime, P2 #3, martorul, „Reia” în zbor din runda 3)', async () => {
    const Comp = await componenta(null)
    const rez = {}
    for (const [n, f] of Object.entries(R)) rez[n] = await f(Comp)
    expect(rez).toEqual(Object.fromEntries(Object.keys(R).map(n => [n, true])))
  })
  it.each([
    ['snapshotVechi', 'ambiguuCuRecitireIntarziata'], ['snapshotVechi', 'ambiguuCheieAbsenta'],
    ['raspunsCrezut', 'incheiatDarInCursInBd'], ['raspunsCrezut', 'citireEsuata'],
    ['faraGardaDupaEdge', 'invalidatLaEdge'], ['faraGardaDupaControl', 'invalidatLaControl'],
    // runda 3 (Jakarinos r2 P1)
    ['forma1126875c', 'reiaListaProaspataInZbor'], ['faraGardaInCurs', 'reiaPesteArendaInZbor'], ['faraGardaInCurs', 'listaDinZborDupaRaspuns'],
    ['faraTerminat', 'listaDinZborDupaRaspuns'], ['faraApasareNoua', 'altTabApasaInZbor'],
  ])('mutantul „%s” e prins de regula „%s”', async (mutant, regula) => {
    const Comp = await componenta(MUTANTI[mutant])
    expect(await R[regula](Comp)).toBe(false)
  })
  // reproducerea recenzentului pe forma 1126875c, fază cu fază: cheia e ștearsă CÂT apelul e în zbor și lipsește după închiderea paginii
  it('forma 1126875c reproduce pierderea cheii (ștearsă în zbor, lipsă după închidere); componenta reală o păstrează în ambele faze', async () => {
    const vechi = await reiaInZbor({ Comp: await componenta(MUTANTI.forma1126875c), listaLaMin: 0.5 })
    expect(vechi).toMatchObject({ initial: true, edgeCheie: true, apasatNou: true, inZbor: false, dupaInchidere: false })
    const nou = await reiaInZbor({ Comp: await componenta(null), listaLaMin: 0.5 })
    expect(nou).toMatchObject({ initial: true, edgeCheie: true, apasatNou: true, inZbor: true, dupaInchidere: true })
  })
  it.each([
    ['faraGardaInCurs', 'reiaPesteArendaInZbor', { listaLaMin: 11 }, { inZbor: false }],
    ['faraTerminat', 'listaDinZborDupaRaspuns', { listaLaMin: 11, raspuns: { laMin: 12, corp: { cod: 'comanda_neconfirmata' }, citire: { data: null, error: { code: '500' } } } }, { inZbor: true, listaDinZborDupaRaspuns: false }],
    ['faraApasareNoua', 'altTabApasaInZbor', { listaLaMin: 0.6, altTabLaMin: 0.5, raspuns: { laMin: 1, corp: { cod: 'cerere_invalida' }, citire: { data: null, error: null } } }, { inZbor: true, dupaRaspuns: false }],
  ])('mutantul „%s” pică regula „%s” în faza așteptată', async (mutant, _regula, arg, faza) => {
    expect(await reiaInZbor({ Comp: await componenta(MUTANTI[mutant]), ...arg })).toMatchObject(faza)
  })
})
